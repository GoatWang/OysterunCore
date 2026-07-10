import React, {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Editor, Transforms } from 'slate';
import { Box, config, MenuItem, Text } from 'folds';
import { Room } from 'matrix-js-sdk';
import { Command, useCommands } from '../../hooks/useCommands';
import {
  AutocompleteMenu,
  AutocompleteQuery,
  OYSTERUN_P185_STALE_AUTOCOMPLETE_RANGE_GUARD,
  createCommandElement,
  isAutocompleteRangeCurrent,
  moveCursor,
  replaceWithElement,
} from '../../components/editor';
import { UseAsyncSearchOptions, useAsyncSearch } from '../../hooks/useAsyncSearch';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useKeyDown } from '../../hooks/useKeyDown';
import { onTabPress } from '../../utils/keyboard';
import {
  isOysterunRouteCCompactProvider,
  listOysterunRouteCAgentCommands,
  type OysterunRouteCAgentCommand,
} from '../../../oysterun/OysterunHostClient';

type CommandAutocompleteProps = {
  room: Room;
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
  routeCActiveTokenMode?: boolean;
};

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  matchOptions: {
    contain: true,
  },
};

const ROUTE_C_SEARCH_OPTIONS: UseAsyncSearchOptions = {
  matchOptions: {
    contain: false,
  },
};

type RouteCSlashCommandSource = 'oysterun_builtin' | 'agent_self_defined';

type RouteCSlashCommandCandidate = {
  name: string;
  displayName: string;
  description: string;
  source: RouteCSlashCommandSource;
  insertText?: string;
};

const ROUTE_C_PROVIDER_SKILL_HELPER_INSERT_ONLY_CONTRACT =
  'p88_provider_skill_helper_insert_only_visible_option_v1';
const ROUTE_C_LOCAL_PROVIDER_SKILL_INSTALL_COMMAND_CONTRACT =
  'p181_local_provider_skill_install_visible_composer_dispatch_v1';

type RouteCAgentCommandsState = {
  provider: string | null;
  commands: OysterunRouteCAgentCommand[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
};

const ROUTE_C_LOOP_COMMAND: RouteCSlashCommandCandidate = {
  name: 'loop',
  displayName: '/loop <interval> <prompt>',
  description: 'Create or enable an in-session Loop definition.',
  source: 'oysterun_builtin',
};

const ROUTE_C_COMPACT_COMMAND: RouteCSlashCommandCandidate = {
  name: 'compact',
  displayName: '/compact',
  description: 'Compact the active provider thread.',
  source: 'oysterun_builtin',
};

const ROUTE_C_OYSTERUN_SKILL_HELPERS = [
  ['oysterun_sessions_skill', 'oysterun-sessions'],
  ['oysterun_session_chat_skill', 'oysterun-session-chat'],
  ['oysterun_find_context_skill', 'oysterun-find-context'],
  ['oysterun_scheduler_skill', 'oysterun-scheduler'],
  ['oysterun_mail_skill', 'oysterun-mail'],
  ['oysterun_notification_skill', 'oysterun-notifications'],
  ['oysterun_notifications_skill', 'oysterun-notifications'],
  ['oysterun_website_skill', 'oysterun-website'],
  ['oysterun_telegram_skill', 'oysterun-telegram'],
] as const;

const ROUTE_C_BUILT_IN_COMMAND_NAMES = new Set<string>([
  'loop',
  'compact',
  'install_oysterun_skill',
  ...ROUTE_C_OYSTERUN_SKILL_HELPERS.map(([name]) => name),
]);

const getOysterunProviderSkillRoot = (provider: string | null): string =>
  provider?.trim().toLocaleLowerCase() === 'claude' ? '.claude/skills' : '.codex/skills';

const getOysterunSkillHelperCandidates = (
  provider: string | null
): RouteCSlashCommandCandidate[] =>
  ROUTE_C_OYSTERUN_SKILL_HELPERS.map(([name, skillName]) => ({
    name,
    displayName: `/${name}`,
    description: `Insert ${skillName} provider skill path.`,
    source: 'oysterun_builtin',
    insertText: `@${getOysterunProviderSkillRoot(
      provider
    )}/Oysterun/modules/${skillName}/SKILL.md`,
  }));

const getRouteCCommandKey = (candidate: RouteCSlashCommandCandidate): string =>
  `${candidate.source}:${candidate.name}`;

const normalizeRouteCSlashCommandName = (name: string): string =>
  name.trim().replace(/^\/+/, '').toLocaleLowerCase();

const routeCCommandMatchesQuery = (
  candidate: RouteCSlashCommandCandidate,
  normalizedQuery: string
): boolean => {
  const normalizedCommand = normalizeRouteCSlashCommandName(candidate.name);
  if (!normalizedCommand) return false;
  return normalizedCommand.startsWith(normalizedQuery);
};

const toRouteCSelfDefinedCandidate = (
  command: OysterunRouteCAgentCommand
): RouteCSlashCommandCandidate | undefined => {
  const normalizedName = normalizeRouteCSlashCommandName(command.name);
  if (!normalizedName) return undefined;
  return {
    name: normalizedName,
    displayName: `/${normalizedName}`,
    description: command.title?.trim() || 'Agent self-defined command.',
    source: 'agent_self_defined',
  };
};

export function CommandAutocomplete({
  room,
  editor,
  query,
  requestClose,
  routeCActiveTokenMode = false,
}: CommandAutocompleteProps) {
  const mx = useMatrixClient();
  const commands = useCommands(mx, room);
  const commandNames = useMemo(() => Object.keys(commands) as Command[], [commands]);
  const normalizedQuery = query.text.trim().toLocaleLowerCase();
  const [routeCAgentCommandsState, setRouteCAgentCommandsState] =
    useState<RouteCAgentCommandsState>({
      provider: null,
      commands: [],
      status: 'idle',
    });
  const routeCAtCommandPosition = useMemo(() => {
    if (!routeCActiveTokenMode) return false;
    return !Editor.string(editor, {
      anchor: Editor.start(editor, []),
      focus: query.range.anchor,
    }).trim();
  }, [editor, query.range.anchor, routeCActiveTokenMode]);

  const [result, search, resetSearch] = useAsyncSearch(
    commandNames,
    useCallback((commandName: string) => commandName, []),
    routeCActiveTokenMode ? ROUTE_C_SEARCH_OPTIONS : SEARCH_OPTIONS,
  );

  const routeCAutoCompleteNames = useMemo(
    () =>
      commandNames.filter((commandName) => {
        const normalizedCommand = commandName.toLocaleLowerCase();
        if (normalizedQuery && normalizedCommand === normalizedQuery) return false;
        return normalizedCommand.startsWith(normalizedQuery);
      }),
    [commandNames, normalizedQuery],
  );

  const autoCompleteNames = routeCActiveTokenMode
    ? routeCAutoCompleteNames
    : result
      ? result.items
      : commandNames;

  useEffect(() => {
    if (!routeCActiveTokenMode || !routeCAtCommandPosition) {
      setRouteCAgentCommandsState({
        provider: null,
        commands: [],
        status: 'idle',
      });
      return undefined;
    }

    let canceled = false;
    setRouteCAgentCommandsState((current) => ({
      provider: current.provider,
      commands: current.commands,
      status: 'loading',
    }));
    listOysterunRouteCAgentCommands()
      .then((response) => {
        if (canceled) return;
        setRouteCAgentCommandsState({
          provider: response.provider,
          commands: response.commands,
          status: 'loaded',
        });
      })
      .catch((err: unknown) => {
        if (canceled) return;
        console.warn('[oysterun-routec] slash command discovery failed', err);
        setRouteCAgentCommandsState({
          provider: null,
          commands: [],
          status: 'error',
        });
      });
    return () => {
      canceled = true;
    };
  }, [routeCActiveTokenMode, routeCAtCommandPosition]);

  const routeCBuiltInCandidates = useMemo(() => {
    if (!routeCAtCommandPosition) return [];
    const candidates: RouteCSlashCommandCandidate[] = [
      ROUTE_C_LOOP_COMMAND,
      {
        name: 'install_oysterun_skill',
        displayName: '/install_oysterun_skill',
        description: 'Install Oysterun skills through Host; add --update to overwrite an owned set.',
        source: 'oysterun_builtin' as const,
      },
      ...getOysterunSkillHelperCandidates(routeCAgentCommandsState.provider),
    ];
    if (isOysterunRouteCCompactProvider(routeCAgentCommandsState.provider)) {
      candidates.push(ROUTE_C_COMPACT_COMMAND);
    }
    return candidates.filter((candidate) => routeCCommandMatchesQuery(candidate, normalizedQuery));
  }, [normalizedQuery, routeCAgentCommandsState.provider, routeCAtCommandPosition]);

  const routeCSelfDefinedCandidates = useMemo(() => {
    if (!routeCAtCommandPosition) return [];
    if (routeCAgentCommandsState.provider?.trim().toLocaleLowerCase() !== 'claude') return [];
    return routeCAgentCommandsState.commands
      .map(toRouteCSelfDefinedCandidate)
      .filter((candidate): candidate is RouteCSlashCommandCandidate => Boolean(candidate))
      .filter((candidate) => !ROUTE_C_BUILT_IN_COMMAND_NAMES.has(candidate.name))
      .filter((candidate) => routeCCommandMatchesQuery(candidate, normalizedQuery));
  }, [
    normalizedQuery,
    routeCAgentCommandsState.commands,
    routeCAgentCommandsState.provider,
    routeCAtCommandPosition,
  ]);

  const routeCSelectableCandidates = useMemo(
    () => [...routeCBuiltInCandidates, ...routeCSelfDefinedCandidates],
    [routeCBuiltInCandidates, routeCSelfDefinedCandidates]
  );

  useEffect(() => {
    if (routeCActiveTokenMode) return;
    if (query.text) search(query.text);
    else resetSearch();
  }, [query.text, routeCActiveTokenMode, search, resetSearch]);

  const handleAutocomplete = (commandNameOrCandidate: string | RouteCSlashCommandCandidate) => {
    if (!isAutocompleteRangeCurrent(editor, query.range, '/')) {
      requestClose();
      return;
    }
    const routeCCandidate =
      typeof commandNameOrCandidate === 'string' ? undefined : commandNameOrCandidate;
    const commandName =
      typeof commandNameOrCandidate === 'string'
        ? commandNameOrCandidate
        : commandNameOrCandidate.name;
    if (routeCActiveTokenMode && routeCCandidate?.insertText) {
      Transforms.select(editor, query.range);
      Transforms.delete(editor);
      Transforms.insertText(editor, routeCCandidate.insertText);
      Transforms.collapse(editor, { edge: 'end' });
      requestClose();
      return;
    }
    const cmdEl = createCommandElement(commandName);
    if (
      routeCActiveTokenMode &&
      Editor.string(editor, {
        anchor: Editor.start(editor, []),
        focus: query.range.anchor,
      }).trim()
    ) {
      Transforms.select(editor, query.range);
      Transforms.delete(editor);
      Transforms.select(editor, Editor.start(editor, []));
      Transforms.insertNodes(editor, cmdEl);
      moveCursor(editor, true);
      requestClose();
      return;
    }
    replaceWithElement(editor, query.range, cmdEl);
    moveCursor(editor, true);
    requestClose();
  };

  useKeyDown(window, (evt: KeyboardEvent) => {
    onTabPress(evt, () => {
      const commandName = routeCActiveTokenMode
        ? routeCSelectableCandidates[0]
        : autoCompleteNames[0];
      if (!commandName) {
        return;
      }
      handleAutocomplete(commandName);
    });
  });

  if (routeCActiveTokenMode) {
    return routeCSelectableCandidates.length === 0 ? null : (
      <AutocompleteMenu
        headerContent={
          <Box grow="Yes" direction="Column" gap="100">
            <Text size="L400">Route C Commands</Text>
            <Text size="T200" priority="300">
              Oysterun commands only
            </Text>
          </Box>
        }
        requestClose={requestClose}
      >
        {routeCBuiltInCandidates.length > 0 && (
          <Box style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}>
            <Text size="T200" priority="300">
              Oysterun
            </Text>
          </Box>
        )}
        {routeCBuiltInCandidates.map((candidate) => (
          <MenuItem
            key={getRouteCCommandKey(candidate)}
            as="button"
            radii="300"
            style={{ height: 'unset' }}
            data-testid="oysterun-routec-slash-command-option"
            data-oysterun-routec-slash-command={candidate.name}
            data-oysterun-routec-slash-command-source={candidate.source}
            data-oysterun-routec-slash-command-insert-text={candidate.insertText}
            data-oysterun-routec-provider-skill-helper={
              candidate.insertText ? ROUTE_C_PROVIDER_SKILL_HELPER_INSERT_ONLY_CONTRACT : undefined
            }
            data-oysterun-routec-local-command-dispatch={
              candidate.name === 'install_oysterun_skill'
                ? ROUTE_C_LOCAL_PROVIDER_SKILL_INSTALL_COMMAND_CONTRACT
                : undefined
            }
            data-oysterun-routec-runtime-provider={routeCAgentCommandsState.provider ?? undefined}
            data-oysterun-routec-p185-stale-range-guard={
              OYSTERUN_P185_STALE_AUTOCOMPLETE_RANGE_GUARD
            }
            data-oysterun-routec-compact-supported={String(
              isOysterunRouteCCompactProvider(routeCAgentCommandsState.provider)
            )}
            onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
              onTabPress(evt, () => handleAutocomplete(candidate))
            }
            onClick={() => handleAutocomplete(candidate)}
          >
            <Box
              style={{ padding: `${config.space.S300} 0` }}
              grow="Yes"
              direction="Column"
              gap="100"
              justifyContent="SpaceBetween"
            >
              <Text style={{ flexGrow: 1 }} size="B400" truncate>
                {candidate.displayName}
              </Text>
              <Text truncate priority="300" size="T200">
                {candidate.description}
              </Text>
            </Box>
          </MenuItem>
        ))}
        {routeCSelfDefinedCandidates.length > 0 && (
          <Box style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}>
            <Text size="T200" priority="300">
              Self-Defined Commands
            </Text>
          </Box>
        )}
        {routeCSelfDefinedCandidates.map((candidate) => (
          <MenuItem
            key={getRouteCCommandKey(candidate)}
            as="button"
            radii="300"
            style={{ height: 'unset' }}
            data-testid="oysterun-routec-slash-command-option"
            data-oysterun-routec-slash-command={candidate.name}
            data-oysterun-routec-slash-command-source={candidate.source}
            data-oysterun-routec-runtime-provider={routeCAgentCommandsState.provider ?? undefined}
            data-oysterun-routec-agent-command-status={routeCAgentCommandsState.status}
            data-oysterun-routec-p185-stale-range-guard={
              OYSTERUN_P185_STALE_AUTOCOMPLETE_RANGE_GUARD
            }
            onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
              onTabPress(evt, () => handleAutocomplete(candidate))
            }
            onClick={() => handleAutocomplete(candidate)}
          >
            <Box
              style={{ padding: `${config.space.S300} 0` }}
              grow="Yes"
              direction="Column"
              gap="100"
              justifyContent="SpaceBetween"
            >
              <Text style={{ flexGrow: 1 }} size="B400" truncate>
                {candidate.displayName}
              </Text>
              <Text truncate priority="300" size="T200">
                {candidate.description}
              </Text>
            </Box>
          </MenuItem>
        ))}
      </AutocompleteMenu>
    );
  }

  return autoCompleteNames.length === 0 ? null : (
    <AutocompleteMenu
      headerContent={
        <Box grow="Yes" direction="Row" gap="200" justifyContent="SpaceBetween">
          <Text size="L400">Commands</Text>
        </Box>
      }
      requestClose={requestClose}
    >
      {autoCompleteNames.map((commandName) => {
        const command = commands[commandName];
        if (!command) return null;

        return (
          <MenuItem
            key={commandName}
            as="button"
            radii="300"
            style={{ height: 'unset' }}
            onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
              onTabPress(evt, () => handleAutocomplete(commandName))
            }
            onClick={() => handleAutocomplete(commandName)}
          >
            <Box
              style={{ padding: `${config.space.S300} 0` }}
              grow="Yes"
              direction="Column"
              gap="100"
              justifyContent="SpaceBetween"
            >
              <Text style={{ flexGrow: 1 }} size="B400" truncate>
                {`/${commandName}`}
              </Text>
              <Text truncate priority="300" size="T200">
                {command.description}
              </Text>
            </Box>
          </MenuItem>
        );
      })}
    </AutocompleteMenu>
  );
}
