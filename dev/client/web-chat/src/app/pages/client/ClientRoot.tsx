import {
  Box,
  config,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
} from 'folds';
import { HttpApiEvent, HttpApiEventHandlerMap, MatrixClient, Room, RoomEvent } from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import React, {
  MouseEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  clearCacheAndReload,
  clearLoginData,
  initClient,
  logoutClient,
  redirectToOysterunCapacitorBootstrapAfterWebChatAuthLoss,
} from '../../../client/initMatrix';
import { SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { SpecVersions } from './SpecVersions';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useSyncState } from '../../hooks/useSyncState';
import { stopPropagation } from '../../utils/keyboard';
import { SyncStatus } from './SyncStatus';
import { AuthMetadataProvider } from '../../hooks/useAuthMetadata';
import type { Session } from '../../state/sessions';
import { AutoDiscovery } from './AutoDiscovery';
import {
  getOysterunRouteCMatrixCacheScope,
  loadOysterunMatrixBootstrap,
  resetOysterunMatrixBootstrap,
  startOysterunMatrixClient,
} from '../../../oysterun/OysterunMatrixSessionProvider';
import {
  buildOysterunRouteCMatrixRecoveryDebugDetail,
  getOysterunHostSessionRouteSearch,
  getOysterunRouteCRoomEntryBindingProof,
  isOysterunRouteCMatrixRecoveryDebugDetail,
  isOysterunRouteCMatrixRecoveryDebugTriggerEnabled,
  isOysterunCleanSessionChatPath,
  OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT,
  recordOysterunRouteCClientAuthLossDiagnostic,
  recordOysterunRouteCMatrixRecoveryTriggerProof,
  ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM,
  type OysterunRouteCMatrixRecoveryDebugTriggerKind,
} from '../../../oysterun/OysterunHostClient';
import { OysterunRecoveryPage } from '../../../oysterun/OysterunRecoveryPage';
import { getHomeRoomPath, getHomeSearchPath } from '../pathUtils';
import { isRouteCRoomEntryTimelineUsable } from './RouteCRoomEntry';

type RouteCRoomEntryState =
  | 'bootstrap_pending'
  | 'matrix_client_prepared_pending'
  | 'bound_room_missing_after_sync'
  | 'bound_room_ready'
  | 'matrix_client_error';

type RouteCBootstrapErrorState = 'host_scoped_bootstrap_failed' | 'matrix_client_start_failed';

type OysterunHostRequestError = Error & {
  status?: number;
  data?: {
    code?: string;
    stale_clean_chat_target?: boolean;
  };
};

const STALE_CLEAN_SESSION_CHAT_RECOVERY_PATH = '/app/sessions?notice=stale_clean_chat';
const ROUTEC_MATRIX_RECOVERY_EVENT = 'oysterun-routec-matrix-resume';

const isStaleCleanChatBootstrapError = (error: Error): boolean => {
  const hostError = error as OysterunHostRequestError;
  return (
    hostError.status === 404 &&
    (hostError.data?.code === 'live_session_missing' ||
      hostError.data?.stale_clean_chat_target === true)
  );
};

const normalizeRoutePath = (pathname: string): string =>
  pathname.endsWith('/') ? pathname : `${pathname}/`;

const hasMatchingHostSessionRouteSearch = (routeSearch: string, currentSearch: string): boolean => {
  const routeParams = new URLSearchParams(routeSearch);
  const currentParams = new URLSearchParams(currentSearch);
  const routeSessionId = routeParams.get('session_id');
  if (routeSessionId) return currentParams.get('session_id') === routeSessionId;
  const routeHostSessionId = routeParams.get('host_session_id');
  if (routeHostSessionId) return currentParams.get('host_session_id') === routeHostSessionId;
  return false;
};

const buildRouteCHostSessionSearchWithHandoff = (
  routeSearch: string,
  currentSearch: string
): string => {
  const targetParams = new URLSearchParams(routeSearch);
  const currentParams = new URLSearchParams(currentSearch);
  const insertPath = currentParams.get('insert_path');
  if (insertPath) {
    targetParams.set('insert_path', insertPath);
  }
  const matrixRecoveryDebug = currentParams.get(ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM);
  if (matrixRecoveryDebug) {
    targetParams.set(ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM, matrixRecoveryDebug);
  }
  return `?${targetParams.toString()}`;
};

const isReadyRouteCNonRoomPath = (pathname: string): boolean =>
  normalizeRoutePath(pathname) === getHomeSearchPath();

function ClientRootLoading({
  hostSessionId,
  matrixRoomId,
  roomEntryState,
}: {
  hostSessionId?: string;
  matrixRoomId?: string;
  roomEntryState: RouteCRoomEntryState;
}) {
  return (
    <SplashScreen
      loadingStage={roomEntryState}
      loadingSurface="web_chat_room_entry"
      proofAttributes={{
        'data-testid': 'oysterun-routec-room-entry-unready',
        'data-oysterun-clean-session-testid': 'oysterun-clean-session-room-entry-unready',
        'data-oysterun-routec-room-entry-contract': OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT,
        'data-oysterun-clean-session-room-entry-contract': OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT,
        'data-oysterun-routec-room-entry-state': roomEntryState,
        'data-oysterun-clean-session-room-entry-state': roomEntryState,
        'data-oysterun-routec-room-entry-ready': 'false',
        'data-oysterun-clean-session-room-entry-ready': 'false',
        'data-oysterun-routec-room-entry-unready': 'true',
        'data-oysterun-clean-session-room-entry-unready': 'true',
        'data-oysterun-routec-bootstrap-state': roomEntryState,
        'data-oysterun-clean-session-bootstrap-state': roomEntryState,
        'data-oysterun-routec-route-truth': 'query_only',
        'data-oysterun-clean-session-route-truth': 'query_only',
        'data-oysterun-routec-session-storage-route-truth': 'false',
        'data-oysterun-clean-session-session-storage-route-truth': 'false',
        'data-oysterun-routec-host-scoped-matrix-session': String(Boolean(hostSessionId)),
        'data-oysterun-clean-session-host-scoped-matrix-session': String(Boolean(hostSessionId)),
        'data-oysterun-routec-raw-matrix-login-visible': 'false',
        'data-oysterun-clean-session-raw-matrix-login-visible': 'false',
        'data-oysterun-routec-manual-token-visible': 'false',
        'data-oysterun-clean-session-manual-token-visible': 'false',
        'data-oysterun-routec-homeserver-picker-visible': 'false',
        'data-oysterun-clean-session-homeserver-picker-visible': 'false',
        'data-oysterun-host-session-id': hostSessionId,
        'data-oysterun-room-id': matrixRoomId,
        'data-oysterun-routec-composer-send-valid-from-unready': 'false',
        'data-oysterun-clean-session-composer-send-valid-from-unready': 'false',
      }}
    />
  );
}

function ClientRootBootstrapError({
  hostSessionId,
  matrixRoomId,
  errorState,
  error,
  onRetry,
}: {
  hostSessionId?: string;
  matrixRoomId?: string;
  errorState: RouteCBootstrapErrorState;
  error: Error;
  onRetry: () => void;
}) {
  return (
    <OysterunRecoveryPage
      state="chat_bootstrap_failed"
      title="Could not open Oysterun chat"
      message="Oysterun could not prepare the Host-scoped chat session for this browser."
      testId="oysterun-routec-bootstrap-error"
      diagnosticMessage={error.message}
      retryAction={{
        label: 'Retry',
        onClick: onRetry,
        testId: 'oysterun-routec-bootstrap-retry',
        proofTarget: 'host_scoped_bootstrap',
        proofAttributes: {
          'data-oysterun-clean-session-testid': 'oysterun-clean-session-bootstrap-retry',
          'data-oysterun-routec-retry-route-truth': 'query_only',
          'data-oysterun-clean-session-retry-route-truth': 'query_only',
          'data-oysterun-routec-raw-matrix-login-fallback': 'false',
          'data-oysterun-clean-session-raw-matrix-login-fallback': 'false',
        },
      }}
      proofAttributes={{
        'data-oysterun-clean-session-testid': 'oysterun-clean-session-bootstrap-error',
        'data-oysterun-routec-bootstrap-state': errorState,
        'data-oysterun-clean-session-bootstrap-state': errorState,
        'data-oysterun-routec-route-truth': 'query_only',
        'data-oysterun-clean-session-route-truth': 'query_only',
        'data-oysterun-routec-session-storage-route-truth': 'false',
        'data-oysterun-clean-session-session-storage-route-truth': 'false',
        'data-oysterun-routec-host-scoped-matrix-session': String(Boolean(hostSessionId)),
        'data-oysterun-clean-session-host-scoped-matrix-session': String(Boolean(hostSessionId)),
        'data-oysterun-routec-retry-path': 'host_scoped_bootstrap',
        'data-oysterun-clean-session-retry-path': 'host_scoped_bootstrap',
        'data-oysterun-routec-raw-matrix-login-visible': 'false',
        'data-oysterun-clean-session-raw-matrix-login-visible': 'false',
        'data-oysterun-routec-manual-token-visible': 'false',
        'data-oysterun-clean-session-manual-token-visible': 'false',
        'data-oysterun-routec-homeserver-picker-visible': 'false',
        'data-oysterun-clean-session-homeserver-picker-visible': 'false',
        'data-oysterun-host-session-id': hostSessionId,
        'data-oysterun-room-id': matrixRoomId,
      }}
    />
  );
}

function RouteCRoomEntryTimelineBoundary({
  enabled,
  room,
  children,
}: {
  enabled: boolean;
  room: Room | undefined;
  children: ReactNode;
}) {
  const liveTimelineRef = useRef(
    enabled && room ? room.getUnfilteredTimelineSet().getLiveTimeline() : undefined
  );
  const [liveTimelineGeneration, setLiveTimelineGeneration] = useState(0);

  useEffect(() => {
    if (!enabled || !room) return undefined;
    const syncLiveTimelineIdentity = () => {
      const nextLiveTimeline = room.getUnfilteredTimelineSet().getLiveTimeline();
      if (liveTimelineRef.current === nextLiveTimeline) return;
      liveTimelineRef.current = nextLiveTimeline;
      setLiveTimelineGeneration((generation) => generation + 1);
    };

    room.on(RoomEvent.TimelineReset, syncLiveTimelineIdentity);
    room.on(RoomEvent.TimelineRefresh, syncLiveTimelineIdentity);
    syncLiveTimelineIdentity();
    return () => {
      room.removeListener(RoomEvent.TimelineReset, syncLiveTimelineIdentity);
      room.removeListener(RoomEvent.TimelineRefresh, syncLiveTimelineIdentity);
    };
  }, [enabled, room]);

  const boundaryKey = enabled && room ? `${room.roomId}:${liveTimelineGeneration}` : 'generic';
  return <React.Fragment key={boundaryKey}>{children}</React.Fragment>;
}

function ClientRootOptions({ mx }: { mx?: MatrixClient }) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <IconButton
      style={{
        position: 'absolute',
        top: config.space.S100,
        right: config.space.S100,
      }}
      variant="Background"
      fill="None"
      onClick={handleToggle}
    >
      <Icon size="200" src={Icons.VerticalDots} />
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {mx && (
                  <MenuItem onClick={() => clearCacheAndReload(mx)} size="300" radii="300">
                    <Text as="span" size="T300" truncate>
                      Clear Cache and Reload
                    </Text>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    if (mx) {
                      logoutClient(mx);
                      return;
                    }
                    clearLoginData();
                  }}
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="None"
                >
                  <Text as="span" size="T300" truncate>
                    Logout
                  </Text>
                </MenuItem>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </IconButton>
  );
}

type RecoverMatrixClient = (trigger: string) => Promise<void>;

async function recoverFromRouteCMatrixFacadeTokenLoss({
  oysterunSession,
  recoverMatrixClient,
  trigger,
}: {
  oysterunSession: Session | undefined;
  recoverMatrixClient: RecoverMatrixClient;
  trigger: string;
}) {
  await recordOysterunRouteCClientAuthLossDiagnostic({
    session: oysterunSession,
    trigger,
  }).catch((err) => {
    console.warn('Route C auth-loss diagnostic failed', err);
  });
  await recoverMatrixClient(trigger);
}

const useLogoutListener = (
  mx: MatrixClient | undefined,
  oysterunSession: Session | undefined,
  recoverMatrixClient: RecoverMatrixClient
) => {
  useEffect(() => {
    const handleLogout: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut] = async () => {
      try {
        await recoverFromRouteCMatrixFacadeTokenLoss({
          oysterunSession,
          recoverMatrixClient,
          trigger: 'matrix_sdk_session_logged_out',
        });
      } catch (err) {
        console.warn('Route C Matrix facade-token recovery failed', err);
        if (redirectToOysterunCapacitorBootstrapAfterWebChatAuthLoss()) return;
        window.location.reload();
      }
    };

    mx?.on(HttpApiEvent.SessionLoggedOut, handleLogout);
    return () => {
      mx?.removeListener(HttpApiEvent.SessionLoggedOut, handleLogout);
    };
  }, [mx, oysterunSession, recoverMatrixClient]);
};

function RouteCMatrixRecoveryDebugTriggers({
  matrixClientRunning,
  oysterunSession,
  recoverMatrixClient,
  roomEntryReady,
}: {
  matrixClientRunning: boolean;
  oysterunSession: Session | undefined;
  recoverMatrixClient: RecoverMatrixClient;
  roomEntryReady: boolean;
}) {
  const debugTriggerEnabled = isOysterunRouteCMatrixRecoveryDebugTriggerEnabled();
  const triggerRecovery = useCallback(
    (triggerKind: OysterunRouteCMatrixRecoveryDebugTriggerKind) => {
      if (!isOysterunRouteCMatrixRecoveryDebugTriggerEnabled()) return;
      const detail = buildOysterunRouteCMatrixRecoveryDebugDetail(triggerKind);
      recordOysterunRouteCMatrixRecoveryTriggerProof({
        status: 'visible_debug_trigger_selected',
        trigger_kind: triggerKind,
        source: detail.source,
        same_url: detail.sameUrl,
        force_recovery: detail.force_recovery,
        matrix_client_running_before_recovery: matrixClientRunning,
        room_entry_ready_before_recovery: roomEntryReady,
      });
      if (triggerKind === 'debug_visible_notification_resume_fallback') {
        window.dispatchEvent(new CustomEvent(ROUTEC_MATRIX_RECOVERY_EVENT, { detail }));
        return;
      }
      void recoverFromRouteCMatrixFacadeTokenLoss({
        oysterunSession,
        recoverMatrixClient,
        trigger: triggerKind,
      }).catch((err) => {
        recordOysterunRouteCMatrixRecoveryTriggerProof({
          status: 'visible_debug_trigger_recovery_failed',
          trigger_kind: triggerKind,
          error_name: err instanceof Error ? err.name : 'unknown',
          error_message: err instanceof Error ? err.message : String(err),
        });
        console.warn('Route C debug-visible Matrix facade recovery failed', err);
      });
    },
    [matrixClientRunning, oysterunSession, recoverMatrixClient, roomEntryReady]
  );

  if (!debugTriggerEnabled) return null;

  return (
    <Box
      direction="Column"
      gap="200"
      data-testid="oysterun-routec-matrix-recovery-debug-triggers"
      data-oysterun-clean-session-testid="oysterun-clean-session-matrix-recovery-debug-triggers"
      data-oysterun-routec-matrix-recovery-debug-gate={ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM}
      data-oysterun-clean-session-matrix-recovery-debug-gate={
        ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM
      }
      data-oysterun-routec-matrix-recovery-debug-source="local-origin-query-param"
      data-oysterun-clean-session-matrix-recovery-debug-source="local-origin-query-param"
      data-oysterun-dashboard-auth-cleared="false"
      data-oysterun-local-storage-cleared="false"
      data-oysterun-matrix-token-mutated="false"
      data-oysterun-synthetic-service-worker-message-used="false"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 10,
        padding: 12,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      <button
        type="button"
        data-testid="oysterun-routec-notification-resume-debug-trigger"
        data-oysterun-clean-session-testid="oysterun-clean-session-notification-resume-debug-trigger"
        data-oysterun-trigger-kind="debug_visible_notification_resume_fallback"
        onClick={() => triggerRecovery('debug_visible_notification_resume_fallback')}
      >
        Resume chat
      </button>
      <button
        type="button"
        data-testid="oysterun-routec-facade-token-recovery-debug-trigger"
        data-oysterun-clean-session-testid="oysterun-clean-session-facade-token-recovery-debug-trigger"
        data-oysterun-trigger-kind="debug_visible_matrix_facade_recovery"
        onClick={() => triggerRecovery('debug_visible_matrix_facade_recovery')}
      >
        Recover Matrix
      </button>
    </Box>
  );
}

type ClientRootProps = {
  children: ReactNode;
};
export function ClientRoot({ children }: ClientRootProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [oysterunSession, setOysterunSession] = useState<Session>();
  const baseUrl = oysterunSession?.baseUrl ?? window.location.origin;
  const userId = oysterunSession?.userId ?? '@oysterun-routec-bootstrap:oysterun.local';
  const roomEntryBinding = getOysterunRouteCRoomEntryBindingProof();
  const hostSessionId = roomEntryBinding.host_session_id;
  const matrixRoomId = roomEntryBinding.matrix_room_id;

  const [loadState, loadMatrix] = useAsyncCallback<MatrixClient, Error, []>(
    useCallback(async () => {
      const bootstrap = await loadOysterunMatrixBootstrap();
      const session: Session = {
        ...bootstrap.session,
        fallbackSdkStores: false,
      };
      setOysterunSession(session);
      return initClient(session, getOysterunRouteCMatrixCacheScope(bootstrap));
    }, [])
  );
  const mx = loadState.status === AsyncStatus.Success ? loadState.data : undefined;
  const [startState, startMatrix] = useAsyncCallback<void, Error, [MatrixClient]>(
    useCallback((m) => startOysterunMatrixClient(m), [])
  );

  const recoverMatrixClient = useCallback(
    async (trigger: string) => {
      resetOysterunMatrixBootstrap(trigger);
      if (mx) {
        mx.stopClient();
      }
      setLoading(true);
      const nextMx = await loadMatrix();
      await startMatrix(nextMx);
    },
    [loadMatrix, mx, startMatrix]
  );

  useLogoutListener(mx, oysterunSession, recoverMatrixClient);

  useEffect(() => {
    if (loadState.status === AsyncStatus.Idle) {
      loadMatrix();
    }
  }, [loadState, loadMatrix]);

  useEffect(() => {
    if (mx && !mx.clientRunning) {
      startMatrix(mx);
    }
  }, [mx, startMatrix]);

  useSyncState(
    mx,
    useCallback((state) => {
      if (state === 'PREPARED') {
        setLoading(false);
      }
    }, [])
  );

  const boundMatrixRoom = mx && matrixRoomId ? mx.getRoom(matrixRoomId) : undefined;
  const boundMatrixTimelineUsable = isRouteCRoomEntryTimelineUsable(boundMatrixRoom, matrixRoomId);
  const roomEntryReady = Boolean(
    mx &&
      !loading &&
      hostSessionId &&
      matrixRoomId &&
      boundMatrixRoom &&
      roomEntryBinding.matrix_room_ready &&
      boundMatrixTimelineUsable
  );
  const routeCRoomEntryPending = Boolean(hostSessionId) && !roomEntryReady;
  const roomEntryState: RouteCRoomEntryState =
    loadState.status === AsyncStatus.Error || startState.status === AsyncStatus.Error
      ? 'matrix_client_error'
      : !matrixRoomId
      ? 'bootstrap_pending'
      : loading || !mx
      ? 'matrix_client_prepared_pending'
      : roomEntryReady
      ? 'bound_room_ready'
      : 'bound_room_missing_after_sync';
  const bootstrapErrorState: RouteCBootstrapErrorState | undefined =
    loadState.status === AsyncStatus.Error
      ? 'host_scoped_bootstrap_failed'
      : startState.status === AsyncStatus.Error
      ? 'matrix_client_start_failed'
      : undefined;
  const bootstrapError =
    loadState.status === AsyncStatus.Error
      ? loadState.error
      : startState.status === AsyncStatus.Error
      ? startState.error
      : undefined;
  const retryBootstrap = mx ? () => startMatrix(mx) : loadMatrix;
  const redirectingStaleCleanChat =
    Boolean(bootstrapError) &&
    isOysterunCleanSessionChatPath(location.pathname) &&
    isStaleCleanChatBootstrapError(bootstrapError as Error);

  useEffect(() => {
    if (!redirectingStaleCleanChat) return;
    window.location.replace(STALE_CLEAN_SESSION_CHAT_RECOVERY_PATH);
  }, [redirectingStaleCleanChat]);

  useEffect(() => {
    const handleMatrixResume = (event: Event) => {
      const detail =
        event instanceof CustomEvent && typeof event.detail === 'object' && event.detail !== null
          ? (event.detail as { reason?: unknown })
          : {};
      const reason =
        typeof detail.reason === 'string' && detail.reason.trim()
          ? detail.reason.trim()
          : 'service_worker_notification_resume';
      const debugVisibleRecovery = isOysterunRouteCMatrixRecoveryDebugDetail(detail);
      recordOysterunRouteCMatrixRecoveryTriggerProof({
        status: 'matrix_resume_event_received',
        trigger_kind: debugVisibleRecovery
          ? 'debug_visible_notification_resume_fallback'
          : 'service_worker_notification_resume',
        reason,
        same_url: (detail as { sameUrl?: unknown }).sameUrl === true,
        force_recovery: debugVisibleRecovery,
        matrix_client_running_before_recovery: mx?.clientRunning === true,
        room_entry_ready_before_recovery: roomEntryReady,
        real_notificationclick_claimed: !debugVisibleRecovery,
      });
      if (mx?.clientRunning && roomEntryReady && !debugVisibleRecovery) return;
      void recoverMatrixClient(reason).catch((err) => {
        console.warn('Route C Matrix resume recovery failed', err);
      });
    };
    window.addEventListener(ROUTEC_MATRIX_RECOVERY_EVENT, handleMatrixResume);
    return () => {
      window.removeEventListener(ROUTEC_MATRIX_RECOVERY_EVENT, handleMatrixResume);
    };
  }, [mx, recoverMatrixClient, roomEntryReady]);

  useEffect(() => {
    if (!roomEntryReady || !matrixRoomId) return;
    if (isOysterunCleanSessionChatPath(location.pathname)) return;
    const routeSearch = getOysterunHostSessionRouteSearch();
    if (!routeSearch) return;
    const targetSearch = buildRouteCHostSessionSearchWithHandoff(routeSearch, location.search);
    const targetPath = `${getHomeRoomPath(matrixRoomId)}${targetSearch}`;
    const currentPath = normalizeRoutePath(location.pathname);
    if (
      isReadyRouteCNonRoomPath(currentPath) &&
      hasMatchingHostSessionRouteSearch(routeSearch, location.search)
    ) {
      return;
    }
    const currentLocation = `${currentPath}${location.search}`;
    if (currentLocation !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [location.pathname, location.search, matrixRoomId, navigate, roomEntryReady]);

  return (
    <AutoDiscovery userId={userId!} baseUrl={baseUrl!}>
      <SpecVersions baseUrl={baseUrl!}>
        <>
          {mx && <SyncStatus mx={mx} />}
          {loading && <ClientRootOptions mx={mx} />}
          <RouteCMatrixRecoveryDebugTriggers
            matrixClientRunning={mx?.clientRunning === true}
            oysterunSession={oysterunSession}
            recoverMatrixClient={recoverMatrixClient}
            roomEntryReady={roomEntryReady}
          />
          {redirectingStaleCleanChat ? (
            <ClientRootLoading
              hostSessionId={hostSessionId}
              matrixRoomId={matrixRoomId}
              roomEntryState="bootstrap_pending"
            />
          ) : bootstrapErrorState && bootstrapError ? (
            <ClientRootBootstrapError
              hostSessionId={hostSessionId}
              matrixRoomId={matrixRoomId}
              errorState={bootstrapErrorState}
              error={bootstrapError}
              onRetry={retryBootstrap}
            />
          ) : loading || !mx || routeCRoomEntryPending ? (
            <ClientRootLoading
              hostSessionId={hostSessionId}
              matrixRoomId={matrixRoomId}
              roomEntryState={roomEntryState}
            />
          ) : (
            <RouteCRoomEntryTimelineBoundary
              enabled={Boolean(hostSessionId)}
              room={boundMatrixRoom}
            >
              <MatrixClientProvider value={mx}>
                <ServerConfigsLoader>
                  {(serverConfigs) => (
                    <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
                      <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
                        <AuthMetadataProvider value={serverConfigs.authMetadata}>
                          {children}
                        </AuthMetadataProvider>
                      </MediaConfigProvider>
                    </CapabilitiesProvider>
                  )}
                </ServerConfigsLoader>
              </MatrixClientProvider>
            </RouteCRoomEntryTimelineBoundary>
          )}
        </>
      </SpecVersions>
    </AutoDiscovery>
  );
}
