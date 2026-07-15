import React, {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Editor, Transforms } from 'slate';
import { Box, color, config, MenuItem, Text } from 'folds';
import { MsgType, Room } from 'matrix-js-sdk';
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
  getOysterunRouteCProviderSkillStatus,
  listOysterunRouteCAgentCommands,
  type OysterunRouteCAgentCommand,
  type OysterunRouteCProviderSkillStatusResponse,
} from '../../../oysterun/OysterunHostClient';
import { sendOysterunMatrixMessage } from '../../../oysterun/OysterunSendAdapter';

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

type RouteCSlashCommandSource = 'oysterun_builtin' | 'agent_self_defined' | 'oysterun_status';

type RouteCSlashCommandCandidate = {
  name: string;
  displayName: string;
  description: string;
  source: RouteCSlashCommandSource;
  insertText?: string;
  skillName?: string;
  localCommand?: boolean;
  localActionText?: string;
  disabled?: boolean;
};

const ROUTE_C_PROVIDER_SKILL_HELPER_INSERT_ONLY_CONTRACT =
  'p88_provider_skill_helper_insert_only_visible_option_v1';
const ROUTE_C_LOCAL_PROVIDER_SKILL_INSTALL_COMMAND_CONTRACT =
  'p181_local_provider_skill_install_visible_composer_dispatch_v1';
const getRouteCAutocompleteOptionStyle = (active: boolean): CSSProperties => ({
  height: 'unset',
  backgroundColor: active ? color.SurfaceVariant.ContainerActive : undefined,
  boxShadow: active ? `inset 0 0 0 ${config.borderWidth.B400} ${color.Primary.Main}` : undefined,
  outline: 'none',
});

type RouteCAgentCommandsState = {
  provider: string | null;
  commands: OysterunRouteCAgentCommand[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  providerSkillStatus: OysterunRouteCProviderSkillStatusResponse | null;
  errorMessage?: string;
};

const ROUTE_C_LOOP_COMMAND: RouteCSlashCommandCandidate = {
  name: 'loop',
  displayName: '/loop <interval> <prompt>',
  description: 'Create or enable an in-session Loop definition.',
  source: 'oysterun_builtin',
};

const ROUTE_C_INSTALL_OYSTERUN_SKILL_COMMAND = 'install_oysterun_skill';
const ROUTE_C_UPDATE_OYSTERUN_SKILL_COMMAND = 'update_oysterun_skill';

const ROUTE_C_OYSTERUN_SKILL_HELPERS = [
  ['oysterun_sessions_skill', 'oysterun-sessions'],
  ['oysterun_session_chat_skill', 'oysterun-session-chat'],
  ['oysterun_find_context_skill', 'oysterun-find-context'],
  ['oysterun_scheduler_skill', 'oysterun-scheduler'],
  ['oysterun_mail_skill', 'oysterun-mail'],
  ['oysterun_notifications_skill', 'oysterun-notifications'],
  ['oysterun_website_skill', 'oysterun-website'],
  ['oysterun_telegram_skill', 'oysterun-telegram'],
] as const;

const ROUTE_C_BUILT_IN_COMMAND_NAMES = new Set<string>([
  'loop',
  ROUTE_C_INSTALL_OYSTERUN_SKILL_COMMAND,
  ROUTE_C_UPDATE_OYSTERUN_SKILL_COMMAND,
  ...ROUTE_C_OYSTERUN_SKILL_HELPERS.map(([name]) => name),
]);

const getOysterunProviderSkillRoot = (provider: string | null): string =>
  provider?.trim().toLocaleLowerCase() === 'claude' ? '.claude/skills' : '.codex/skills';

const getOysterunSkillHelperCandidates = (provider: string | null): RouteCSlashCommandCandidate[] =>
  ROUTE_C_OYSTERUN_SKILL_HELPERS.map(([name, skillName]) => ({
    name,
    displayName: `/${name}`,
    description: `Insert ${skillName} provider skill path.`,
    source: 'oysterun_builtin',
    skillName,
    insertText: `@${getOysterunProviderSkillRoot(provider)}/Oysterun/modules/${skillName}/SKILL.md`,
  }));

const ROUTE_C_INSTALL_OYSTERUN_SKILL_CANDIDATE: RouteCSlashCommandCandidate = {
  name: ROUTE_C_INSTALL_OYSTERUN_SKILL_COMMAND,
  displayName: '/install_oysterun_skill',
  description: 'Install Oysterun skills through Host.',
  source: 'oysterun_builtin',
  localCommand: true,
  localActionText: '/install_oysterun_skill',
};

const ROUTE_C_UPDATE_OYSTERUN_SKILL_CANDIDATE: RouteCSlashCommandCandidate = {
  name: ROUTE_C_UPDATE_OYSTERUN_SKILL_COMMAND,
  displayName: '/update_oysterun_skill',
  description: 'Update the installed Oysterun skill set from the Host package.',
  source: 'oysterun_builtin',
  localCommand: true,
  localActionText: '/install_oysterun_skill --update',
};

const getRouteCCommandKey = (candidate: RouteCSlashCommandCandidate): string =>
  `${candidate.source}:${candidate.name}`;

const normalizeRouteCSlashCommandName = (name: string): string =>
  name.trim().replace(/^\/+/, '').toLocaleLowerCase();

const routeCCommandMatchesQuery = (
  candidate: RouteCSlashCommandCandidate,
  normalizedQuery: string
): boolean => {
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const searchText = [
    candidate.name,
    candidate.displayName,
    candidate.description,
    candidate.skillName,
    candidate.insertText,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .replace(/[_/.-]+/g, ' ')
    .toLocaleLowerCase();
  return terms.every((term) => searchText.includes(term.replace(/[_/.-]+/g, ' ')));
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
      providerSkillStatus: null,
    });
  const {
    provider: routeCProvider,
    commands: routeCAgentCommands,
    status: routeCAgentCommandStatus,
    providerSkillStatus: routeCProviderSkillStatus,
    errorMessage: routeCCommandErrorMessage,
  } = routeCAgentCommandsState;
  const [selectedRouteCIndex, setSelectedRouteCIndex] = useState(0);
  const routeCKeyboardFocusIndexRef = useRef<number | null>(null);
  const routeCLocalActionInFlightRef = useRef(false);

  const [result, search, resetSearch] = useAsyncSearch(
    commandNames,
    useCallback((commandName: string) => commandName, []),
    SEARCH_OPTIONS
  );

  const routeCAutoCompleteNames = useMemo(
    () =>
      commandNames.filter((commandName) => {
        const normalizedCommand = commandName.toLocaleLowerCase();
        if (normalizedQuery && normalizedCommand === normalizedQuery) return false;
        return normalizedCommand.startsWith(normalizedQuery);
      }),
    [commandNames, normalizedQuery]
  );

  const autoCompleteNames = useMemo(() => {
    if (routeCActiveTokenMode) return routeCAutoCompleteNames;
    if (result) return result.items;
    return commandNames;
  }, [commandNames, result, routeCActiveTokenMode, routeCAutoCompleteNames]);

  useEffect(() => {
    if (!routeCActiveTokenMode) {
      setRouteCAgentCommandsState({
        provider: null,
        commands: [],
        status: 'idle',
        providerSkillStatus: null,
      });
      return undefined;
    }

    let canceled = false;
    setRouteCAgentCommandsState((current) => ({
      provider: current.provider,
      commands: current.commands,
      status: 'loading',
      providerSkillStatus: current.providerSkillStatus,
    }));
    listOysterunRouteCAgentCommands()
      .then(async (response) => {
        const providerSkillStatus = await getOysterunRouteCProviderSkillStatus(response.provider);
        if (canceled) return;
        setRouteCAgentCommandsState({
          provider: response.provider,
          commands: response.commands,
          status: 'loaded',
          providerSkillStatus,
        });
      })
      .catch((err: unknown) => {
        if (canceled) return;
        setRouteCAgentCommandsState({
          provider: null,
          commands: [],
          status: 'error',
          providerSkillStatus: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      canceled = true;
    };
  }, [routeCActiveTokenMode]);

  const routeCBuiltInCandidates = useMemo(() => {
    if (!routeCActiveTokenMode) return [];
    if (routeCAgentCommandStatus === 'loading' || routeCAgentCommandStatus === 'idle') {
      return [
        {
          name: 'oysterun_skill_status_loading',
          displayName: 'Loading Oysterun commands...',
          description: 'Checking the current agent folder skill installation.',
          source: 'oysterun_status' as const,
          disabled: true,
        },
      ];
    }
    if (routeCAgentCommandStatus === 'error') {
      return [
        {
          name: 'oysterun_skill_status_error',
          displayName: 'Oysterun commands unavailable',
          description: routeCCommandErrorMessage || 'Could not check provider skill status.',
          source: 'oysterun_status' as const,
          disabled: true,
        },
      ];
    }
    if (!routeCProviderSkillStatus) {
      return [ROUTE_C_INSTALL_OYSTERUN_SKILL_CANDIDATE];
    }
    if (routeCProviderSkillStatus.provider_supported === false) {
      return [
        {
          name: 'oysterun_skill_status_unsupported_provider',
          displayName: 'Oysterun skills unavailable',
          description: `Provider skill folder is unsupported for ${
            routeCProviderSkillStatus.provider || routeCProvider || 'this provider'
          }.`,
          source: 'oysterun_status' as const,
          disabled: true,
        },
      ];
    }
    if (!routeCProviderSkillStatus.installed) {
      return [ROUTE_C_INSTALL_OYSTERUN_SKILL_CANDIDATE];
    }
    if (!routeCProviderSkillStatus.ownership_marker_valid) {
      return [
        {
          name: 'oysterun_skill_status_unowned',
          displayName: 'Oysterun skill folder is not managed',
          description:
            'The existing Oysterun skill folder is not marker-owned; handle it manually before update.',
          source: 'oysterun_status' as const,
          disabled: true,
        },
      ];
    }
    const candidates: RouteCSlashCommandCandidate[] = [
      ROUTE_C_LOOP_COMMAND,
      ROUTE_C_UPDATE_OYSTERUN_SKILL_CANDIDATE,
      ...getOysterunSkillHelperCandidates(routeCProvider),
    ];
    return candidates.filter((candidate) => routeCCommandMatchesQuery(candidate, normalizedQuery));
  }, [
    normalizedQuery,
    routeCAgentCommandStatus,
    routeCCommandErrorMessage,
    routeCActiveTokenMode,
    routeCProvider,
    routeCProviderSkillStatus,
  ]);

  const routeCSelfDefinedCandidates = useMemo(() => {
    if (!routeCActiveTokenMode) return [];
    if (routeCProvider?.trim().toLocaleLowerCase() !== 'claude') return [];
    if (
      !routeCProviderSkillStatus?.installed ||
      !routeCProviderSkillStatus.ownership_marker_valid
    ) {
      return [];
    }
    return routeCAgentCommands
      .map(toRouteCSelfDefinedCandidate)
      .filter((candidate): candidate is RouteCSlashCommandCandidate => Boolean(candidate))
      .filter((candidate) => !ROUTE_C_BUILT_IN_COMMAND_NAMES.has(candidate.name))
      .filter((candidate) => routeCCommandMatchesQuery(candidate, normalizedQuery));
  }, [
    normalizedQuery,
    routeCActiveTokenMode,
    routeCAgentCommands,
    routeCProvider,
    routeCProviderSkillStatus,
  ]);

  const routeCSelectableCandidates = useMemo(
    () => [...routeCBuiltInCandidates, ...routeCSelfDefinedCandidates],
    [routeCBuiltInCandidates, routeCSelfDefinedCandidates]
  );
  const routeCEnabledCandidates = useMemo(
    () => routeCSelectableCandidates.filter((candidate) => !candidate.disabled),
    [routeCSelectableCandidates]
  );
  const selectedRouteCCandidate =
    routeCEnabledCandidates[selectedRouteCIndex] ?? routeCEnabledCandidates[0];

  useEffect(() => {
    if (!routeCActiveTokenMode) return;
    if (routeCKeyboardFocusIndexRef.current !== selectedRouteCIndex) return;
    routeCKeyboardFocusIndexRef.current = null;
    const activeElement = document.querySelector<HTMLElement>(
      `[data-oysterun-routec-slash-command-enabled-index="${selectedRouteCIndex}"]`
    );
    activeElement?.focus({ preventScroll: true });
    activeElement?.scrollIntoView({ block: 'nearest' });
  }, [routeCActiveTokenMode, routeCEnabledCandidates.length, selectedRouteCIndex]);

  useEffect(() => {
    setSelectedRouteCIndex((currentIndex) => {
      if (routeCEnabledCandidates.length === 0) return 0;
      if (currentIndex < 0) return 0;
      return Math.min(currentIndex, routeCEnabledCandidates.length - 1);
    });
  }, [routeCEnabledCandidates.length]);

  const moveRouteCKeyboardSelection = useCallback(
    (delta: number) => {
      const candidateCount = routeCEnabledCandidates.length;
      if (candidateCount === 0) return;
      const currentIndex =
        selectedRouteCIndex >= 0 && selectedRouteCIndex < candidateCount ? selectedRouteCIndex : 0;
      const nextIndex = (currentIndex + delta + candidateCount) % candidateCount;
      routeCKeyboardFocusIndexRef.current = nextIndex;
      setSelectedRouteCIndex(nextIndex);
    },
    [routeCEnabledCandidates.length, selectedRouteCIndex]
  );

  useEffect(() => {
    if (routeCActiveTokenMode) return;
    if (query.text) search(query.text);
    else resetSearch();
  }, [query.text, routeCActiveTokenMode, search, resetSearch]);

  const handleAutocomplete = useCallback(
    (commandNameOrCandidate: string | RouteCSlashCommandCandidate) => {
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
      if (routeCCandidate?.disabled) return;
      if (routeCActiveTokenMode && routeCCandidate?.localActionText) {
        if (routeCLocalActionInFlightRef.current) return;
        routeCLocalActionInFlightRef.current = true;
        Transforms.select(editor, query.range);
        Transforms.delete(editor);
        Transforms.collapse(editor, { edge: 'end' });
        requestClose();
        sendOysterunMatrixMessage(mx, room.roomId, {
          msgtype: MsgType.Text,
          body: routeCCandidate.localActionText,
        })
          .catch(() => undefined)
          .finally(() => {
            routeCLocalActionInFlightRef.current = false;
          });
        return;
      }
      if (routeCActiveTokenMode && routeCCandidate?.insertText) {
        Transforms.select(editor, query.range);
        Transforms.delete(editor);
        Transforms.insertText(editor, `${routeCCandidate.insertText} `);
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
    },
    [editor, mx, query.range, requestClose, room.roomId, routeCActiveTokenMode]
  );

  useEffect(() => {
    if (!routeCActiveTokenMode) return undefined;
    const handleRouteCKeyDown = (evt: KeyboardEvent) => {
      if (evt.isComposing || routeCEnabledCandidates.length === 0) return;
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        evt.stopPropagation();
        moveRouteCKeyboardSelection(1);
        return;
      }
      if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        evt.stopPropagation();
        moveRouteCKeyboardSelection(-1);
        return;
      }
      if (evt.key === 'Enter' || evt.key === 'Tab') {
        evt.preventDefault();
        evt.stopPropagation();
        if (!selectedRouteCCandidate) return;
        handleAutocomplete(selectedRouteCCandidate);
      }
    };
    window.addEventListener('keydown', handleRouteCKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleRouteCKeyDown, true);
    };
  }, [
    handleAutocomplete,
    moveRouteCKeyboardSelection,
    routeCActiveTokenMode,
    routeCEnabledCandidates.length,
    selectedRouteCCandidate,
  ]);

  useKeyDown(window, (evt: KeyboardEvent) => {
    if (routeCActiveTokenMode) return;
    onTabPress(evt, () => {
      const commandName = autoCompleteNames[0];
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
        {routeCBuiltInCandidates.map((candidate) => {
          const active = selectedRouteCCandidate
            ? getRouteCCommandKey(selectedRouteCCandidate) === getRouteCCommandKey(candidate)
            : false;
          const enabledIndex = routeCEnabledCandidates.findIndex(
            (enabledCandidate) =>
              getRouteCCommandKey(enabledCandidate) === getRouteCCommandKey(candidate)
          );
          return (
            <MenuItem
              key={getRouteCCommandKey(candidate)}
              as="button"
              radii="300"
              style={getRouteCAutocompleteOptionStyle(active)}
              aria-disabled={candidate.disabled || undefined}
              aria-selected={active}
              data-testid="oysterun-routec-slash-command-option"
              data-oysterun-routec-slash-command={candidate.name}
              data-oysterun-routec-slash-command-source={candidate.source}
              data-oysterun-routec-slash-command-insert-text={candidate.insertText}
              data-oysterun-routec-slash-command-active={String(active)}
              data-oysterun-routec-slash-command-enabled-index={
                enabledIndex >= 0 ? String(enabledIndex) : undefined
              }
              data-oysterun-routec-slash-command-disabled={String(Boolean(candidate.disabled))}
              data-oysterun-routec-provider-skill-status={routeCAgentCommandsState.status}
              data-oysterun-routec-provider-skill-installed={String(
                Boolean(routeCAgentCommandsState.providerSkillStatus?.installed)
              )}
              data-oysterun-routec-provider-skill-owned={String(
                Boolean(routeCAgentCommandsState.providerSkillStatus?.ownership_marker_valid)
              )}
              data-oysterun-routec-provider-skill-helper={
                candidate.insertText
                  ? ROUTE_C_PROVIDER_SKILL_HELPER_INSERT_ONLY_CONTRACT
                  : undefined
              }
              data-oysterun-routec-local-command-dispatch={
                candidate.localCommand
                  ? ROUTE_C_LOCAL_PROVIDER_SKILL_INSTALL_COMMAND_CONTRACT
                  : undefined
              }
              data-oysterun-routec-runtime-provider={routeCAgentCommandsState.provider ?? undefined}
              data-oysterun-routec-p185-stale-range-guard={
                OYSTERUN_P185_STALE_AUTOCOMPLETE_RANGE_GUARD
              }
              onMouseEnter={() => {
                if (candidate.disabled) return;
                const nextIndex = routeCEnabledCandidates.findIndex(
                  (enabledCandidate) =>
                    getRouteCCommandKey(enabledCandidate) === getRouteCCommandKey(candidate)
                );
                setSelectedRouteCIndex(Math.max(0, nextIndex));
              }}
              onFocus={() => {
                if (candidate.disabled) return;
                const nextIndex = routeCEnabledCandidates.findIndex(
                  (enabledCandidate) =>
                    getRouteCCommandKey(enabledCandidate) === getRouteCCommandKey(candidate)
                );
                setSelectedRouteCIndex(Math.max(0, nextIndex));
              }}
              onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
                onTabPress(evt, () => !candidate.disabled && handleAutocomplete(candidate))
              }
              onClick={() => !candidate.disabled && handleAutocomplete(candidate)}
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
          );
        })}
        {routeCSelfDefinedCandidates.length > 0 && (
          <Box style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}>
            <Text size="T200" priority="300">
              Self-Defined Commands
            </Text>
          </Box>
        )}
        {routeCSelfDefinedCandidates.map((candidate) => {
          const active = selectedRouteCCandidate
            ? getRouteCCommandKey(selectedRouteCCandidate) === getRouteCCommandKey(candidate)
            : false;
          const enabledIndex = routeCEnabledCandidates.findIndex(
            (enabledCandidate) =>
              getRouteCCommandKey(enabledCandidate) === getRouteCCommandKey(candidate)
          );
          return (
            <MenuItem
              key={getRouteCCommandKey(candidate)}
              as="button"
              radii="300"
              style={getRouteCAutocompleteOptionStyle(active)}
              aria-selected={active}
              data-testid="oysterun-routec-slash-command-option"
              data-oysterun-routec-slash-command={candidate.name}
              data-oysterun-routec-slash-command-source={candidate.source}
              data-oysterun-routec-slash-command-active={String(active)}
              data-oysterun-routec-slash-command-enabled-index={String(enabledIndex)}
              data-oysterun-routec-runtime-provider={routeCAgentCommandsState.provider ?? undefined}
              data-oysterun-routec-agent-command-status={routeCAgentCommandsState.status}
              data-oysterun-routec-p185-stale-range-guard={
                OYSTERUN_P185_STALE_AUTOCOMPLETE_RANGE_GUARD
              }
              onMouseEnter={() => {
                const nextIndex = routeCEnabledCandidates.findIndex(
                  (enabledCandidate) =>
                    getRouteCCommandKey(enabledCandidate) === getRouteCCommandKey(candidate)
                );
                setSelectedRouteCIndex(Math.max(0, nextIndex));
              }}
              onFocus={() => {
                const nextIndex = routeCEnabledCandidates.findIndex(
                  (enabledCandidate) =>
                    getRouteCCommandKey(enabledCandidate) === getRouteCCommandKey(candidate)
                );
                setSelectedRouteCIndex(Math.max(0, nextIndex));
              }}
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
          );
        })}
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
