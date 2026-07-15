import React, {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Room, RoomMember } from 'matrix-js-sdk';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { Box, color, config, Icon, Icons, MenuItem, Text } from 'folds';

import {
  AutocompleteMenu,
  AutocompleteQuery,
  OYSTERUN_P185_STALE_AUTOCOMPLETE_RANGE_GUARD,
  isAutocompleteRangeCurrent,
} from '../../components/editor';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { onTabPress } from '../../utils/keyboard';
import { Membership } from '../../../types/matrix/room';
import {
  getOysterunRouteCMatrixActorRegistry,
  getOysterunRouteCPathMemory,
  getOysterunRouteCHostPathRoots,
  getOysterunRouteCHostSessionStatus,
  listOysterunRouteCBrowseEntries,
  type OysterunBrowseEntry,
} from '../../../oysterun/OysterunHostClient';

type RouteCPathAutocompleteProps = {
  room: Room;
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
  requestMemberMode: () => void;
  requestRefresh: () => void;
};

type RouteCPathSuggestion = {
  id: string;
  path: string;
  kind: 'directory' | 'file';
  sourceLabel: string;
  action: 'select-current-folder' | 'open-directory' | 'insert-file';
};

type RouteCPathStatus = {
  kind: 'loading' | 'error' | 'empty' | 'pending';
  message: string;
};

type ParsedPathQuery = {
  path: string;
  quoted: boolean;
  invalid: boolean;
  usesHomeAlias: boolean;
};

type BrowseQueryTarget = {
  path: string;
  query: string;
  excludePath?: string;
  exactDirectoryAutoEnter?: boolean;
};

const ROUTE_C_PATH_BROWSE_LIMIT = 40;
const getRouteCPathOptionStyle = (active: boolean): CSSProperties => ({
  height: 'unset',
  backgroundColor: active ? color.SurfaceVariant.ContainerActive : undefined,
  boxShadow: active ? `inset 0 0 0 ${config.borderWidth.B400} ${color.Primary.Main}` : undefined,
  outline: 'none',
});

const withAllowedMembership = (member: RoomMember): boolean =>
  member.membership === Membership.Join ||
  member.membership === Membership.Invite ||
  member.membership === Membership.Knock;

const normalizePathKey = (path: string): string =>
  path.trim().replace(/\/+$/, '').toLocaleLowerCase();

const ensureDirectorySuffix = (path: string): string => (path.endsWith('/') ? path : `${path}/`);

const getPathBasename = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  const lastSlashIndex = trimmed.lastIndexOf('/');
  return lastSlashIndex >= 0 ? trimmed.slice(lastSlashIndex + 1) : trimmed;
};

const normalizeAbsolutePath = (path: string): string => {
  const absolute = path.startsWith('/');
  const segments: string[] = [];
  path.split('/').forEach((segment) => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      segments.pop();
      return;
    }
    segments.push(segment);
  });
  if (absolute) return segments.length > 0 ? `/${segments.join('/')}` : '/';
  return segments.join('/');
};

const resolveRelativePathAgainstBase = (basePath: string, relativePath: string): string => {
  const normalizedBase = basePath.trim().replace(/\/+$/, '') || '/';
  return normalizeAbsolutePath(`${normalizedBase}/${relativePath}`);
};

const escapeQuotedPath = (path: string): string => path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const formatInsertedPath = (path: string): string =>
  /\s/.test(path) ? `"${escapeQuotedPath(path)}"` : path;

const formatOpenDirectoryToken = (path: string): string =>
  `@${formatInsertedPath(ensureDirectorySuffix(path))}`;

const parsePathQuery = (text: string): ParsedPathQuery => {
  const raw = text.trimStart();
  if (!raw) {
    return {
      path: '',
      quoted: false,
      invalid: false,
      usesHomeAlias: false,
    };
  }

  if (raw.startsWith('"')) {
    let escaped = false;
    let value = '';
    for (let index = 1; index < raw.length; index += 1) {
      const char = raw[index];
      if (escaped) {
        value += char ?? '';
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        const remainder = raw.slice(index + 1).trim();
        return {
          path: value,
          quoted: true,
          invalid: Boolean(remainder),
          usesHomeAlias: value === '~' || value.startsWith('~/'),
        };
      }
      value += char ?? '';
    }
    return {
      path: value,
      quoted: true,
      invalid: false,
      usesHomeAlias: value === '~' || value.startsWith('~/'),
    };
  }

  return {
    path: raw,
    quoted: false,
    invalid: /\s/.test(raw),
    usesHomeAlias: raw === '~' || raw.startsWith('~/') || /^~[^/]/.test(raw),
  };
};

const expandHomeAliasPath = (path: string, hostHomePath: string): string => {
  if (!hostHomePath) return path;
  const normalizedHome = hostHomePath.replace(/\/+$/, '');
  if (path === '~') return normalizedHome;
  if (path.startsWith('~/')) return `${normalizedHome}${path.slice(1)}`;
  if (/^~[^/]/.test(path)) return `${normalizedHome}/${path.slice(1)}`;
  return path;
};

const getRelativeBrowseQueryTarget = (
  queryPath: string,
  sessionCwd: string
): BrowseQueryTarget | undefined => {
  const normalized = queryPath.trim();
  if (!sessionCwd) return undefined;
  if (!normalized) {
    return {
      path: sessionCwd,
      query: '',
    };
  }

  if (normalized === '.' || normalized === './') {
    return {
      path: sessionCwd,
      query: '',
    };
  }

  if (normalized === '..' || normalized === '../') {
    return {
      path: resolveRelativePathAgainstBase(sessionCwd, '..'),
      query: '',
      excludePath: sessionCwd,
    };
  }

  if (normalized.includes('/')) {
    if (normalized.endsWith('/')) {
      return {
        path: resolveRelativePathAgainstBase(sessionCwd, normalized),
        query: '',
        exactDirectoryAutoEnter: false,
      };
    }
    const lastSlashIndex = normalized.lastIndexOf('/');
    const parentPath = normalized.slice(0, lastSlashIndex);
    return {
      path: resolveRelativePathAgainstBase(sessionCwd, parentPath || '.'),
      query: normalized.slice(lastSlashIndex + 1),
      exactDirectoryAutoEnter: true,
    };
  }

  return {
    path: sessionCwd,
    query: normalized,
    exactDirectoryAutoEnter: true,
  };
};

const getBrowseQueryTarget = (
  queryPath: string,
  sessionCwd: string,
  hostHomePath: string,
  usesHomeAlias: boolean
): BrowseQueryTarget | undefined => {
  if (usesHomeAlias) {
    if (!hostHomePath) return undefined;
    const normalizedHome = hostHomePath.replace(/\/+$/, '');
    if (queryPath === '~' || queryPath === '~/') {
      return {
        path: normalizedHome,
        query: '',
      };
    }
    const homeRelative = queryPath.startsWith('~/') ? queryPath.slice(2) : queryPath.slice(1);
    if (!homeRelative) {
      return {
        path: normalizedHome,
        query: '',
      };
    }
    if (!homeRelative.includes('/')) {
      return {
        path: normalizedHome,
        query: homeRelative,
        exactDirectoryAutoEnter: true,
      };
    }
    if (homeRelative.endsWith('/')) {
      return {
        path: `${normalizedHome}/${homeRelative}`,
        query: '',
      };
    }
    const lastSlashIndex = homeRelative.lastIndexOf('/');
    return {
      path:
        lastSlashIndex <= 0
          ? normalizedHome
          : `${normalizedHome}/${homeRelative.slice(0, lastSlashIndex)}`,
      query: homeRelative.slice(lastSlashIndex + 1),
      exactDirectoryAutoEnter: true,
    };
  }
  const normalized = expandHomeAliasPath(queryPath.trim(), hostHomePath);
  if (!normalized || !normalized.startsWith('/'))
    return getRelativeBrowseQueryTarget(normalized, sessionCwd);
  if (normalized.endsWith('/')) {
    return {
      path: normalized,
      query: '',
    };
  }
  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return {
      path: '/',
      query: normalized.slice(1),
      exactDirectoryAutoEnter: true,
    };
  }
  return {
    path: normalized.slice(0, lastSlashIndex),
    query: normalized.slice(lastSlashIndex + 1),
    exactDirectoryAutoEnter: true,
  };
};

const findExactDirectoryEntry = (
  entries: OysterunBrowseEntry[],
  queryText: string
): OysterunBrowseEntry | undefined => {
  const normalizedQuery = queryText.trim().replace(/\/+$/, '').toLocaleLowerCase();
  if (!normalizedQuery) return undefined;
  return entries.find(
    (entry) => entry.kind === 'directory' && entry.name.toLocaleLowerCase() === normalizedQuery
  );
};

const filterBrowseEntries = (
  entries: OysterunBrowseEntry[],
  excludedPath?: string
): OysterunBrowseEntry[] => {
  if (!excludedPath) return entries;
  const excludedKey = normalizePathKey(excludedPath);
  return entries.filter((entry) => normalizePathKey(entry.path) !== excludedKey);
};

const appendSuggestion = (
  suggestions: RouteCPathSuggestion[],
  seen: Set<string>,
  suggestion: RouteCPathSuggestion
) => {
  const normalizedPath = suggestion.path.trim();
  if (!normalizedPath) return;
  const key = normalizePathKey(normalizedPath);
  if (seen.has(key)) return;
  seen.add(key);
  suggestions.push({
    ...suggestion,
    path: normalizedPath,
  });
};

const shouldExcludeExactPathMatch = (candidatePath: string, queryPath: string): boolean => {
  if (!queryPath.trim()) return false;
  return normalizePathKey(candidatePath) === normalizePathKey(queryPath);
};

const buildSeedSuggestions = (
  queryPath: string,
  sessionCwd: string,
  browsePath: string,
  entries: OysterunBrowseEntry[],
  currentFolderSelectable: boolean
): RouteCPathSuggestion[] => {
  const memory = getOysterunRouteCPathMemory();
  const suggestions: RouteCPathSuggestion[] = [];
  const seen = new Set<string>();
  const normalizedQuery = queryPath.toLocaleLowerCase();
  const appendSeed = (path: string, kind: RouteCPathSuggestion['kind'], sourceLabel: string) => {
    if (!path.trim()) return;
    if (!normalizedQuery) return;
    if (normalizedQuery && !path.toLocaleLowerCase().startsWith(normalizedQuery)) return;
    if (shouldExcludeExactPathMatch(path, queryPath)) return;
    appendSuggestion(suggestions, seen, {
      id: `${sourceLabel}:${path}`,
      path,
      kind,
      action: kind === 'directory' ? 'open-directory' : 'insert-file',
      sourceLabel,
    });
  };

  if (browsePath && currentFolderSelectable) {
    appendSuggestion(suggestions, seen, {
      id: `current-folder:${browsePath}`,
      path: browsePath,
      kind: 'directory',
      sourceLabel: 'Current Folder',
      action: 'select-current-folder',
    });
  }

  appendSeed(memory.previewPath, 'file', 'Preview Path');
  appendSeed(memory.explorerPath, 'directory', 'Chat Explorer');
  appendSeed(sessionCwd, 'directory', 'Session Path');

  entries.forEach((entry) => {
    if (shouldExcludeExactPathMatch(entry.path, queryPath)) return;
    appendSuggestion(suggestions, seen, {
      id: `browse:${entry.path}`,
      path: entry.path,
      kind: entry.kind,
      action: entry.kind === 'directory' ? 'open-directory' : 'insert-file',
      sourceLabel: browsePath ? 'Host Browse' : 'Default Browse',
    });
  });

  return suggestions.sort((left, right) => {
    if (left.action === 'select-current-folder') return -1;
    if (right.action === 'select-current-folder') return 1;
    return left.path.localeCompare(right.path, undefined, { sensitivity: 'base' });
  });
};

const isSecondRealHumanMember = (member: RoomMember, currentUserId: string | null): boolean => {
  if (!withAllowedMembership(member)) return false;
  if (currentUserId && member.userId === currentUserId) return false;

  const registry = getOysterunRouteCMatrixActorRegistry();
  if (!registry) return false;

  const actors = registry.actors.filter((candidate) => candidate.matrix_user_id === member.userId);
  if (actors.length !== 1) return false;

  const [actor] = actors;
  if (!actor) return false;
  const actorKind = actor.actor_kind.toLocaleLowerCase();
  const actorKey = actor.actor_key.toLocaleLowerCase();

  return actorKind === 'human' || actorKey === 'human';
};

export function RouteCPathAutocomplete({
  room,
  editor,
  query,
  requestClose,
  requestMemberMode,
  requestRefresh,
}: RouteCPathAutocompleteProps) {
  const mx = useMatrixClient();
  const roomMembers = useRoomMembers(mx, room.roomId);
  const [sessionCwd, setSessionCwd] = useState('');
  const [hostHomePath, setHostHomePath] = useState('');
  const [browsePath, setBrowsePath] = useState('');
  const [currentFolderSelectable, setCurrentFolderSelectable] = useState(false);
  const [browseEntries, setBrowseEntries] = useState<OysterunBrowseEntry[]>([]);
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);
  const pathKeyboardFocusIndexRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const parsedQuery = useMemo(() => parsePathQuery(query.text), [query.text]);
  const hasSecondRealHumanMember = roomMembers.some((member) =>
    isSecondRealHumanMember(member, mx.getUserId())
  );

  useEffect(() => {
    let disposed = false;
    Promise.all([getOysterunRouteCHostSessionStatus(), getOysterunRouteCHostPathRoots()])
      .then(([status, roots]) => {
        if (disposed) return;
        setSessionCwd(typeof status.cwd === 'string' ? status.cwd : '');
        setHostHomePath(typeof roots.home === 'string' ? roots.home : '');
      })
      .catch((err: unknown) => {
        console.warn('[oysterun-routec] failed to load Host path context for path helper', err);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (parsedQuery.invalid) {
      setBrowseEntries([]);
      setCurrentFolderSelectable(false);
      setLoading(false);
      setBrowseError('Path token is not parser-safe. Quote paths that contain spaces.');
      return undefined;
    }

    const target = getBrowseQueryTarget(
      parsedQuery.path,
      sessionCwd,
      hostHomePath,
      parsedQuery.usesHomeAlias
    );
    if (!target) {
      setBrowseEntries([]);
      setCurrentFolderSelectable(false);
      setLoading(false);
      setBrowseError('');
      return undefined;
    }
    let disposed = false;
    setLoading(true);
    setBrowseError('');
    listOysterunRouteCBrowseEntries({
      path: target.path,
      query: target.query,
      limit: ROUTE_C_PATH_BROWSE_LIMIT,
    })
      .then(async (page) => {
        if (disposed) return;
        let finalPage = page;
        let exactDirectoryEntered = false;
        if (target.exactDirectoryAutoEnter) {
          const exactDirectory = findExactDirectoryEntry(page.entries, target.query);
          if (exactDirectory) {
            finalPage = await listOysterunRouteCBrowseEntries({
              path: exactDirectory.path,
              query: '',
              limit: ROUTE_C_PATH_BROWSE_LIMIT,
            });
            exactDirectoryEntered = true;
            if (disposed) return;
          }
        }

        const entries = filterBrowseEntries(finalPage.entries, target.excludePath);
        setBrowsePath(finalPage.path);
        setCurrentFolderSelectable(!target.query || exactDirectoryEntered);
        setBrowseEntries(entries);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setBrowseEntries([]);
        setCurrentFolderSelectable(false);
        setBrowseError(err instanceof Error ? err.message : 'Path suggestions unavailable.');
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [hostHomePath, parsedQuery.invalid, parsedQuery.path, parsedQuery.usesHomeAlias, sessionCwd]);

  const pathSuggestions = useMemo(
    () =>
      buildSeedSuggestions(
        parsedQuery.path,
        sessionCwd,
        browsePath,
        browseEntries,
        currentFolderSelectable
      ),
    [browseEntries, browsePath, currentFolderSelectable, parsedQuery.path, sessionCwd]
  );

  const handlePathSelection = useCallback(
    (suggestion: RouteCPathSuggestion) => {
      if (!isAutocompleteRangeCurrent(editor, query.range, '@')) {
        requestClose();
        return;
      }
      const openDirectory = suggestion.action === 'open-directory';
      const insertion = openDirectory
        ? formatOpenDirectoryToken(suggestion.path)
        : `${formatInsertedPath(suggestion.path)} `;
      Transforms.select(editor, query.range);
      Transforms.insertText(editor, insertion);
      ReactEditor.focus(editor);
      if (openDirectory) {
        requestRefresh();
        return;
      }
      requestClose();
    },
    [editor, query.range, requestClose, requestRefresh]
  );

  useEffect(() => {
    setSelectedPathIndex((currentIndex) => {
      if (pathSuggestions.length === 0) return 0;
      if (currentIndex < 0) return 0;
      return Math.min(currentIndex, pathSuggestions.length - 1);
    });
  }, [pathSuggestions.length]);

  useEffect(() => {
    if (pathKeyboardFocusIndexRef.current !== selectedPathIndex) return;
    pathKeyboardFocusIndexRef.current = null;
    const activeElement = document.querySelector<HTMLElement>(
      `[data-oysterun-path-enabled-index="${selectedPathIndex}"]`
    );
    activeElement?.focus({ preventScroll: true });
    activeElement?.scrollIntoView({ block: 'nearest' });
  }, [pathSuggestions.length, selectedPathIndex]);

  const movePathKeyboardSelection = useCallback(
    (delta: number) => {
      const suggestionCount = pathSuggestions.length;
      if (suggestionCount === 0) return;
      const currentIndex =
        selectedPathIndex >= 0 && selectedPathIndex < suggestionCount ? selectedPathIndex : 0;
      const nextIndex = (currentIndex + delta + suggestionCount) % suggestionCount;
      pathKeyboardFocusIndexRef.current = nextIndex;
      setSelectedPathIndex(nextIndex);
    },
    [pathSuggestions.length, selectedPathIndex]
  );

  useEffect(() => {
    const handleKeyboardSelection = (evt: KeyboardEvent) => {
      if (pathSuggestions.length > 0 && evt.key === 'ArrowDown') {
        evt.preventDefault();
        evt.stopPropagation();
        movePathKeyboardSelection(1);
        return;
      }

      if (pathSuggestions.length > 0 && evt.key === 'ArrowUp') {
        evt.preventDefault();
        evt.stopPropagation();
        movePathKeyboardSelection(-1);
        return;
      }

      if (pathSuggestions.length > 0 && (evt.key === 'Enter' || evt.key === 'Tab')) {
        evt.preventDefault();
        evt.stopPropagation();
        handlePathSelection(pathSuggestions[selectedPathIndex] ?? pathSuggestions[0]);
        return;
      }

      if (evt.key === 'Enter' || evt.key === 'Tab') {
        evt.preventDefault();
        evt.stopPropagation();
        if (evt.key === 'Tab' && hasSecondRealHumanMember) {
          requestMemberMode();
        }
      }
    };

    window.addEventListener('keydown', handleKeyboardSelection, true);
    return () => {
      window.removeEventListener('keydown', handleKeyboardSelection, true);
    };
  }, [
    handlePathSelection,
    hasSecondRealHumanMember,
    movePathKeyboardSelection,
    pathSuggestions,
    requestMemberMode,
    selectedPathIndex,
  ]);

  const showEmptyState =
    !loading &&
    pathSuggestions.length === 0 &&
    !hasSecondRealHumanMember &&
    Boolean(query.text) &&
    (!parsedQuery.usesHomeAlias || Boolean(hostHomePath));

  const focusEditor = useCallback(() => {
    ReactEditor.focus(editor);
  }, [editor]);

  const pathStatus: RouteCPathStatus | undefined = useMemo(() => {
    if (pathSuggestions.length > 0 || hasSecondRealHumanMember) return undefined;
    if (loading) {
      return {
        kind: 'loading',
        message: 'Loading paths...',
      };
    }
    if (browseError) {
      return {
        kind: 'error',
        message: browseError,
      };
    }
    if (showEmptyState) {
      return {
        kind: 'empty',
        message: 'No matching files or folders.',
      };
    }
    return {
      kind: 'pending',
      message:
        parsedQuery.usesHomeAlias && !hostHomePath ? 'Resolving Host home...' : 'Loading paths...',
    };
  }, [
    browseError,
    hasSecondRealHumanMember,
    hostHomePath,
    loading,
    parsedQuery.usesHomeAlias,
    pathSuggestions.length,
    showEmptyState,
  ]);

  return (
    <AutocompleteMenu
      headerContent={
        <Box grow="Yes" direction="Row" gap="200" justifyContent="SpaceBetween">
          <Text size="L400">Paths</Text>
        </Box>
      }
      requestClose={requestClose}
    >
      <Box
        direction="Column"
        gap="100"
        data-testid="oysterun-routec-path-autocomplete"
        data-oysterun-clean-session-testid="oysterun-clean-session-path-autocomplete"
        data-oysterun-routec-path-query={query.text}
        data-oysterun-clean-session-path-query={query.text}
        data-oysterun-routec-home-query={String(parsedQuery.usesHomeAlias)}
        data-oysterun-clean-session-home-query={String(parsedQuery.usesHomeAlias)}
        data-oysterun-routec-host-home-path={parsedQuery.usesHomeAlias ? hostHomePath : undefined}
        data-oysterun-clean-session-host-home-path={
          parsedQuery.usesHomeAlias ? hostHomePath : undefined
        }
        data-oysterun-routec-home-alias-preserved="false"
        data-oysterun-clean-session-home-alias-preserved="false"
        data-oysterun-routec-home-alias-expansion="host_absolute_home"
        data-oysterun-clean-session-home-alias-expansion="host_absolute_home"
        data-oysterun-routec-ping-member-visible={String(hasSecondRealHumanMember)}
        data-oysterun-clean-session-ping-member-visible={String(hasSecondRealHumanMember)}
        data-oysterun-routec-p185-stale-range-guard={OYSTERUN_P185_STALE_AUTOCOMPLETE_RANGE_GUARD}
      >
        {pathSuggestions.map((suggestion, index) => {
          const active = pathSuggestions[selectedPathIndex]?.id === suggestion.id;
          return (
            <MenuItem
              key={suggestion.id}
              as="button"
              radii="300"
              style={getRouteCPathOptionStyle(active)}
              aria-selected={active}
              data-testid="oysterun-routec-path-autocomplete-option"
              data-oysterun-clean-session-testid="oysterun-clean-session-path-autocomplete-option"
              data-oysterun-path-action={suggestion.action}
              data-oysterun-path-active={String(active)}
              data-oysterun-path-enabled-index={String(index)}
              data-oysterun-path-kind={suggestion.kind}
              data-oysterun-path-source={suggestion.sourceLabel}
              data-oysterun-path-value={suggestion.path}
              onMouseEnter={() =>
                setSelectedPathIndex(
                  Math.max(
                    0,
                    pathSuggestions.findIndex((candidate) => candidate.id === suggestion.id)
                  )
                )
              }
              onFocus={() =>
                setSelectedPathIndex(
                  Math.max(
                    0,
                    pathSuggestions.findIndex((candidate) => candidate.id === suggestion.id)
                  )
                )
              }
              onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) => {
                if (evt.key === 'Enter' || evt.key === 'Tab') {
                  evt.preventDefault();
                  evt.stopPropagation();
                  handlePathSelection(suggestion);
                }
              }}
              onClick={() => handlePathSelection(suggestion)}
              before={
                <Icon
                  src={suggestion.kind === 'directory' ? Icons.Explore : Icons.File}
                  size="100"
                />
              }
            >
              <Box
                style={{ padding: `${config.space.S200} 0` }}
                grow="Yes"
                direction="Column"
                gap="100"
              >
                <Text style={{ flexGrow: 1 }} size="B400" truncate>
                  {suggestion.action === 'select-current-folder'
                    ? 'Select current folder'
                    : suggestion.kind === 'directory'
                    ? ensureDirectorySuffix(getPathBasename(suggestion.path) || suggestion.path)
                    : getPathBasename(suggestion.path) || suggestion.path}
                </Text>
                <Text truncate priority="300" size="T200">
                  {`${suggestion.sourceLabel} - ${suggestion.path}`}
                </Text>
              </Box>
            </MenuItem>
          );
        })}
        {hasSecondRealHumanMember && (
          <MenuItem
            as="button"
            radii="300"
            data-testid="oysterun-routec-ping-member-option"
            data-oysterun-clean-session-testid="oysterun-clean-session-ping-member-option"
            onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
              onTabPress(evt, requestMemberMode)
            }
            onClick={requestMemberMode}
            before={<Icon src={Icons.User} size="100" />}
          >
            <Text style={{ flexGrow: 1 }} size="B400">
              Ping member...
            </Text>
          </MenuItem>
        )}
        {pathStatus && (
          <MenuItem
            as="button"
            radii="300"
            style={{ height: 'unset' }}
            aria-disabled
            data-testid="oysterun-routec-path-autocomplete-status"
            data-oysterun-clean-session-testid="oysterun-clean-session-path-autocomplete-status"
            data-oysterun-path-status={pathStatus.kind}
            onClick={focusEditor}
          >
            <Text style={{ flexGrow: 1 }} priority="300" size="T200">
              {pathStatus.message}
            </Text>
          </MenuItem>
        )}
      </Box>
    </AutocompleteMenu>
  );
}
