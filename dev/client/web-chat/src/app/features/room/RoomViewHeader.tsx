import React, { MouseEventHandler, forwardRef, useEffect, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Avatar,
  Text,
  Overlay,
  OverlayCenter,
  OverlayBackdrop,
  IconButton,
  Icon,
  Icons,
  Tooltip,
  TooltipProvider,
  Menu,
  MenuItem,
  toRem,
  config,
  Line,
  PopOut,
  RectCords,
  Badge,
  Spinner,
} from 'folds';
import { Link, useNavigate } from 'react-router-dom';
import { Room } from 'matrix-js-sdk';
import { useStateEvent } from '../../hooks/useStateEvent';
import { PageHeader } from '../../components/page';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { UseStateProvider } from '../../components/UseStateProvider';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { getHomeSearchPath, getSpaceSearchPath } from '../../pages/pathUtils';
import { getCanonicalAliasOrRoomId, isRoomAlias, mxcUrlToHttp } from '../../utils/matrix';
import * as css from './RoomViewHeader.css';
import { useRoomUnread } from '../../state/hooks/unread';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { markAsRead } from '../../utils/notifications';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { copyToClipboard } from '../../utils/dom';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../../hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { stopPropagation } from '../../utils/keyboard';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { BackRouteHandler } from '../../components/BackRouteHandler';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { RoomPinMenu } from './room-pin-menu';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import {
  getRoomNotificationMode,
  getRoomNotificationModeIcon,
  useRoomsNotificationPreferencesContext,
} from '../../hooks/useRoomsNotificationPreferences';
import { JumpToTime } from './jump-to-time';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { RoomSettingsPage } from '../../state/roomSettings';
import {
  getOysterunBootstrappedHostSessionName,
  getOysterunHostExplorerPath,
  getOysterunRouteCHostCurrentWebsiteTarget,
  getOysterunHostSessionChatPathForSession,
  getOysterunHostSessionChatPath,
  getOysterunHostSessionBrowserPath,
  getOysterunHostSessionProfilePath,
  getOysterunHostSessionLoopPath,
  getOysterunHostSessionsPath,
  getOysterunHostSessionRouteSearch,
  navigateOysterunHostSessionsPage,
  normalizeOysterunRouteCSiteBrowserTarget,
  restartOysterunHostSession,
  stopOysterunHostSession,
} from '../../../oysterun/OysterunHostClient';
import type { OysterunRouteCWebsiteTarget } from '../../../oysterun/OysterunHostClient';
import { isOysterunCapacitorIOSRuntime } from '../../../oysterun/OysterunNotificationRuntime';

const OYSTERUN_STOP_MENU_MIN_VISIBLE_PENDING_MS = 500;

const waitForOysterunStopMinimumVisiblePending = (startedAt: number) =>
  new Promise<void>((resolve) => {
    const elapsed = Date.now() - startedAt;
    const remaining = OYSTERUN_STOP_MENU_MIN_VISIBLE_PENDING_MS - elapsed;
    globalThis.setTimeout(resolve, Math.max(0, remaining));
  });

type RoomMenuProps = {
  room: Room;
  requestClose: () => void;
  routeCSearchPath?: string;
  routeCSessionProfilePath?: string;
  routeCLoopPath?: string;
  routeCWebsiteTarget?: OysterunRouteCWebsiteTarget;
  routeCWebsiteOpenPath?: string;
  routeCWebsiteBrowserPath?: string;
  routeCWebsiteRouteSurface?: 'app_browser' | 'browser_new_tab';
  routeCWebsiteNewTab?: boolean;
  routeCWebsiteUsesInternalBrowser?: boolean;
};
const RoomMenu = forwardRef<HTMLDivElement, RoomMenuProps>(
  (
    {
      room,
      requestClose,
      routeCSearchPath,
      routeCSessionProfilePath,
      routeCLoopPath,
      routeCWebsiteTarget,
      routeCWebsiteOpenPath,
      routeCWebsiteBrowserPath,
      routeCWebsiteRouteSurface,
      routeCWebsiteNewTab,
      routeCWebsiteUsesInternalBrowser,
    },
    ref
  ) => {
    const mx = useMatrixClient();
    const navigate = useNavigate();
    const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
    const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
    const powerLevels = usePowerLevelsContext();
    const creators = useRoomCreators(room);

    const permissions = useRoomPermissions(creators, powerLevels);
    const canInvite = permissions.action('invite', mx.getSafeUserId());
    const notificationPreferences = useRoomsNotificationPreferencesContext();
    const notificationMode = getRoomNotificationMode(notificationPreferences, room.roomId);
    const { navigateRoom } = useRoomNavigate();

    const [invitePrompt, setInvitePrompt] = useState(false);
    const [restartingRouteCSession, setRestartingRouteCSession] = useState(false);
    const [restartError, setRestartError] = useState<string>();
    const [stoppingRouteCSession, setStoppingRouteCSession] = useState(false);
    const [stopError, setStopError] = useState<string>();

    const handleMarkAsRead = () => {
      markAsRead(mx, room.roomId, hideActivity);
      requestClose();
    };

    const handleInvite = () => {
      setInvitePrompt(true);
    };

    const handleCopyLink = () => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, room.roomId);
      const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(room);
      copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
      requestClose();
    };

    const openSettings = useOpenRoomSettings();
    const parentSpace = useSpaceOptionally();
    const oysterunRouteSessionSearch = getOysterunHostSessionRouteSearch();
    const routeCChatShell = Boolean(oysterunRouteSessionSearch);
    const oysterunSearchReturnPath = getOysterunHostSessionChatPath();
    const handleOpenSettings = () => {
      openSettings(room.roomId, parentSpace?.roomId);
      requestClose();
    };
    const handleOpenRouteCSearch = () => {
      if (!routeCSearchPath) return;
      navigate(routeCSearchPath);
      requestClose();
    };
    const handleOpenRouteCSessionProfile = () => {
      if (!routeCSessionProfilePath) return;
      window.location.assign(routeCSessionProfilePath);
      requestClose();
    };
    const handleOpenRouteCLoop = () => {
      if (!routeCLoopPath) return;
      window.location.assign(routeCLoopPath);
      requestClose();
    };
    const handleOpenRouteCWebsite = () => {
      if (!routeCWebsiteOpenPath) return;
      requestClose();
    };
    const handleRestartRouteCSession = async () => {
      if (restartingRouteCSession) return;
      setRestartError(undefined);
      setRestartingRouteCSession(true);
      try {
        const response = await restartOysterunHostSession();
        requestClose();
        window.location.assign(getOysterunHostSessionChatPathForSession(response.session_id));
      } catch (err) {
        setRestartingRouteCSession(false);
        setRestartError(err instanceof Error ? err.message : String(err));
      }
    };
    const handleStopRouteCSession = async () => {
      if (stoppingRouteCSession) return;
      setStopError(undefined);
      const pendingStartedAt = Date.now();
      setStoppingRouteCSession(true);
      try {
        await stopOysterunHostSession();
        await waitForOysterunStopMinimumVisiblePending(pendingStartedAt);
        requestClose();
        window.location.assign(getOysterunHostSessionsPath() ?? '/app/sessions');
      } catch (err) {
        await waitForOysterunStopMinimumVisiblePending(pendingStartedAt);
        setStoppingRouteCSession(false);
        setStopError(err instanceof Error ? err.message : String(err));
      }
    };

    return (
      <Menu
        ref={ref}
        style={{ maxWidth: toRem(160), width: '100vw' }}
        data-oysterun-routec-chat-shell={String(routeCChatShell)}
        data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
        data-oysterun-routec-generic-room-actions-hidden={String(routeCChatShell)}
        data-oysterun-clean-session-generic-room-actions-hidden={String(routeCChatShell)}
      >
        {invitePrompt && (
          <InviteUserPrompt
            room={room}
            requestClose={() => {
              setInvitePrompt(false);
              requestClose();
            }}
          />
        )}
        {!routeCChatShell && (
          <>
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              <MenuItem
                onClick={handleMarkAsRead}
                size="300"
                after={<Icon size="100" src={Icons.CheckTwice} />}
                radii="300"
                disabled={!unread}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Mark as Read
                </Text>
              </MenuItem>
              <RoomNotificationModeSwitcher roomId={room.roomId} value={notificationMode}>
                {(handleOpen, opened, changing) => (
                  <MenuItem
                    size="300"
                    after={
                      changing ? (
                        <Spinner size="100" variant="Secondary" />
                      ) : (
                        <Icon size="100" src={getRoomNotificationModeIcon(notificationMode)} />
                      )
                    }
                    radii="300"
                    aria-pressed={opened}
                    onClick={handleOpen}
                  >
                    <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                      Notifications
                    </Text>
                  </MenuItem>
                )}
              </RoomNotificationModeSwitcher>
            </Box>
            <Line variant="Surface" size="300" />
          </>
        )}
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          {routeCChatShell && (
            <>
              {routeCSessionProfilePath && (
                <MenuItem
                  onClick={handleOpenRouteCSessionProfile}
                  size="300"
                  after={<Icon size="100" src={Icons.User} />}
                  radii="300"
                  data-testid="oysterun-routec-room-header-session-profile"
                  data-oysterun-clean-session-testid="oysterun-clean-session-room-header-session-profile"
                  data-oysterun-routec-session-profile-target={routeCSessionProfilePath}
                  data-oysterun-clean-session-session-profile-target={routeCSessionProfilePath}
                  data-oysterun-routec-session-profile-return-to="chat"
                  data-oysterun-clean-session-session-profile-return-to="chat"
                  data-oysterun-routec-profile-route-truth="clean_host_session_path"
                  data-oysterun-clean-session-profile-route-truth="clean_host_session_path"
                  data-oysterun-routec-url-mutation="dashboard_navigation"
                  data-oysterun-clean-session-url-mutation="dashboard_navigation"
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    Session Profile
                  </Text>
                </MenuItem>
              )}
              {routeCLoopPath && (
                <MenuItem
                  onClick={handleOpenRouteCLoop}
                  size="300"
                  after={<Icon size="100" src={Icons.RecentClock} />}
                  radii="300"
                  data-testid="oysterun-routec-room-header-loop"
                  data-oysterun-clean-session-testid="oysterun-clean-session-room-header-loop"
                  data-oysterun-routec-loop-target={routeCLoopPath}
                  data-oysterun-clean-session-loop-target={routeCLoopPath}
                  data-oysterun-routec-loop-return-to="chat"
                  data-oysterun-clean-session-loop-return-to="chat"
                  data-oysterun-routec-loop-route-truth="clean_host_session_path"
                  data-oysterun-clean-session-loop-route-truth="clean_host_session_path"
                  data-oysterun-routec-loop-gui-scope="current_host_session"
                  data-oysterun-clean-session-loop-gui-scope="current_host_session"
                  data-oysterun-routec-url-mutation="dashboard_navigation"
                  data-oysterun-clean-session-url-mutation="dashboard_navigation"
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    Loop
                  </Text>
                </MenuItem>
              )}
              {routeCSearchPath && (
                <MenuItem
                  onClick={handleOpenRouteCSearch}
                  size="300"
                  after={<Icon size="100" src={Icons.Search} />}
                  radii="300"
                  data-testid="oysterun-routec-room-header-menu-search"
                  data-oysterun-clean-session-testid="oysterun-clean-session-room-header-menu-search"
                  data-oysterun-routec-room-header-search="true"
                  data-oysterun-clean-session-room-header-search="true"
                  data-oysterun-routec-search-reachability="more_options_menu"
                  data-oysterun-clean-session-search-reachability="more_options_menu"
                  data-oysterun-routec-search-route-truth="query_only"
                  data-oysterun-clean-session-search-route-truth="query_only"
                  data-oysterun-routec-search-route-source="query_derived_host_session_route_search"
                  data-oysterun-clean-session-search-route-source="query_derived_host_session_route_search"
                  data-oysterun-routec-search-target={routeCSearchPath}
                  data-oysterun-clean-session-search-target={routeCSearchPath}
                  data-oysterun-routec-search-has-session-query={
                    oysterunRouteSessionSearch ? 'true' : 'false'
                  }
                  data-oysterun-clean-session-search-has-session-query={
                    oysterunRouteSessionSearch ? 'true' : 'false'
                  }
                  data-oysterun-routec-search-return-to="chat"
                  data-oysterun-clean-session-search-return-to="chat"
                  data-oysterun-routec-search-return-target={oysterunSearchReturnPath ?? ''}
                  data-oysterun-clean-session-search-return-target={oysterunSearchReturnPath ?? ''}
                  data-oysterun-routec-search-return-route-truth="clean_host_session_path"
                  data-oysterun-clean-session-search-return-route-truth="clean_host_session_path"
                  data-oysterun-room-id={room.roomId}
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    Search
                  </Text>
                </MenuItem>
              )}
              {routeCChatShell && routeCWebsiteTarget && routeCWebsiteOpenPath && (
                <MenuItem
                  as="a"
                  href={routeCWebsiteOpenPath}
                  target={routeCWebsiteUsesInternalBrowser ? undefined : '_blank'}
                  rel={routeCWebsiteUsesInternalBrowser ? undefined : 'noopener noreferrer'}
                  onClick={handleOpenRouteCWebsite}
                  size="300"
                  radii="300"
                  data-testid="oysterun-routec-room-header-website"
                  data-oysterun-clean-session-testid="oysterun-clean-session-room-header-menu-website"
                  data-oysterun-routec-room-header-website-menu="true"
                  data-oysterun-clean-session-room-header-website-menu="true"
                  data-oysterun-routec-website-menu-state="available"
                  data-oysterun-clean-session-website-menu-state="available"
                  data-oysterun-routec-room-header-website="available_agent_site"
                  data-oysterun-clean-session-room-header-website="available_agent_site"
                  data-oysterun-routec-room-header-website-availability-gate="available_only"
                  data-oysterun-clean-session-room-header-website-availability-gate="available_only"
                  data-oysterun-routec-website-reachability="more_options_menu"
                  data-oysterun-clean-session-website-reachability="more_options_menu"
                  data-oysterun-routec-website-target={routeCWebsiteTarget.entryPath}
                  data-oysterun-clean-session-website-target={routeCWebsiteTarget.entryPath}
                  data-oysterun-routec-website-open-target={routeCWebsiteOpenPath}
                  data-oysterun-clean-session-website-open-target={routeCWebsiteOpenPath}
                  data-oysterun-routec-website-browser-route={routeCWebsiteBrowserPath ?? ''}
                  data-oysterun-clean-session-website-browser-route={routeCWebsiteBrowserPath ?? ''}
                  data-oysterun-routec-website-route-surface={routeCWebsiteRouteSurface}
                  data-oysterun-clean-session-website-route-surface={
                    routeCWebsiteRouteSurface
                  }
                  data-oysterun-routec-website-new-tab={routeCWebsiteNewTab ? 'true' : 'false'}
                  data-oysterun-clean-session-website-new-tab={
                    routeCWebsiteNewTab ? 'true' : 'false'
                  }
                  data-oysterun-routec-website-return-to="chat"
                  data-oysterun-clean-session-website-return-to="chat"
                  data-oysterun-routec-website-agent-id={routeCWebsiteTarget.agentId}
                  data-oysterun-clean-session-website-agent-id={routeCWebsiteTarget.agentId}
                  data-oysterun-routec-website-route-prefix="/sites/"
                  data-oysterun-clean-session-website-route-prefix="/sites/"
                  data-oysterun-routec-website-origin="chat"
                  data-oysterun-clean-session-website-origin="chat"
                  data-oysterun-routec-website-source={routeCWebsiteTarget.source}
                  data-oysterun-clean-session-website-source={routeCWebsiteTarget.source}
                  data-oysterun-room-id={room.roomId}
                  after={
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      aria-hidden
                      focusable="false"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      data-oysterun-routec-room-header-website-icon="globe"
                      data-oysterun-clean-session-room-header-website-icon="globe"
                    >
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M3.5 12h17" />
                      <path d="M12 3.5c2.1 2.3 3.15 5.13 3.15 8.5S14.1 18.2 12 20.5" />
                      <path d="M12 3.5C9.9 5.8 8.85 8.63 8.85 12S9.9 18.2 12 20.5" />
                    </svg>
                  }
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    Website
                  </Text>
                </MenuItem>
              )}
            </>
          )}
          {!routeCChatShell && (
            <>
              <MenuItem
                onClick={handleInvite}
                variant="Primary"
                fill="None"
                size="300"
                after={<Icon size="100" src={Icons.UserPlus} />}
                radii="300"
                aria-pressed={invitePrompt}
                disabled={!canInvite}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Invite
                </Text>
              </MenuItem>
              <MenuItem
                onClick={handleCopyLink}
                size="300"
                after={<Icon size="100" src={Icons.Link} />}
                radii="300"
                data-testid="oysterun-routec-room-copy-link"
                data-oysterun-clean-session-testid="oysterun-clean-session-room-copy-link"
                data-oysterun-routec-chat-shell={String(routeCChatShell)}
                data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
                data-oysterun-routec-copy-link-clipboard-only="true"
                data-oysterun-clean-session-copy-link-clipboard-only="true"
                data-oysterun-routec-url-mutation="false"
                data-oysterun-clean-session-url-mutation="false"
                data-oysterun-room-id={room.roomId}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Copy Link
                </Text>
              </MenuItem>
              <MenuItem
                onClick={handleOpenSettings}
                size="300"
                after={<Icon size="100" src={Icons.Setting} />}
                radii="300"
                data-testid="oysterun-routec-room-settings"
                data-oysterun-clean-session-testid="oysterun-clean-session-room-settings"
                data-oysterun-routec-room-settings="modal_state_surface"
                data-oysterun-clean-session-room-settings="modal_state_surface"
                data-oysterun-routec-chat-shell={String(routeCChatShell)}
                data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
                data-oysterun-routec-route-truth="query_only"
                data-oysterun-clean-session-route-truth="query_only"
                data-oysterun-routec-session-query-present={String(routeCChatShell)}
                data-oysterun-clean-session-session-query-present={String(routeCChatShell)}
                data-oysterun-routec-url-mutation="false"
                data-oysterun-clean-session-url-mutation="false"
                data-oysterun-room-id={room.roomId}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Room Settings
                </Text>
              </MenuItem>
            </>
          )}
          <UseStateProvider initial={false}>
            {(promptJump, setPromptJump) => (
              <>
                <MenuItem
                  onClick={() => setPromptJump(true)}
                  size="300"
                  after={<Icon size="100" src={Icons.RecentClock} />}
                  radii="300"
                  aria-pressed={promptJump}
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    Jump to Time
                  </Text>
                </MenuItem>
                {promptJump && (
                  <JumpToTime
                    onSubmit={(eventId) => {
                      setPromptJump(false);
                      navigateRoom(room.roomId, eventId);
                      requestClose();
                    }}
                    onCancel={() => setPromptJump(false)}
                  />
                )}
              </>
            )}
          </UseStateProvider>
        </Box>
        {routeCChatShell && (
          <>
            <Line variant="Surface" size="300" />
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              <MenuItem
                onClick={handleRestartRouteCSession}
                fill="None"
                size="300"
                after={
                  restartingRouteCSession ? (
                    <Spinner size="100" variant="Secondary" />
                  ) : (
                    <Icon size="100" src={Icons.Reload} />
                  )
                }
                radii="300"
                disabled={restartingRouteCSession}
                data-testid="oysterun-routec-room-header-restart-session"
                data-oysterun-clean-session-testid="oysterun-clean-session-room-header-restart-session"
                data-oysterun-routec-restart-session="host_session_restart_api"
                data-oysterun-clean-session-restart-session="host_session_restart_api"
                data-oysterun-routec-restart-session-api="/session/restart"
                data-oysterun-clean-session-restart-session-api="/session/restart"
                data-oysterun-routec-restart-session-menu-position="above-stop"
                data-oysterun-clean-session-restart-session-menu-position="above-stop"
                data-oysterun-routec-restart-session-pending={String(restartingRouteCSession)}
                data-oysterun-routec-restart-session-response-session-id-authoritative="true"
                data-oysterun-routec-chat-shell={String(routeCChatShell)}
                data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
                data-oysterun-room-id={room.roomId}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  {restartingRouteCSession ? 'Restarting...' : 'Restart'}
                </Text>
              </MenuItem>
              {restartError && (
                <Text as="span" size="T200" priority="300">
                  {restartError}
                </Text>
              )}
              <MenuItem
                onClick={handleStopRouteCSession}
                variant="Critical"
                fill="None"
                size="300"
                after={
                  stoppingRouteCSession ? (
                    <Spinner size="100" variant="Secondary" />
                  ) : (
                    <Icon size="100" src={Icons.Power} />
                  )
                }
                radii="300"
                disabled={stoppingRouteCSession}
                data-testid="oysterun-routec-room-header-stop-session"
                data-oysterun-clean-session-testid="oysterun-clean-session-room-header-stop-session"
                data-oysterun-routec-stop-session="host_session_stop_api"
                data-oysterun-clean-session-stop-session="host_session_stop_api"
                data-oysterun-routec-stop-session-api="/session/stop"
                data-oysterun-clean-session-stop-session-api="/session/stop"
                data-oysterun-routec-stop-session-menu-position="last"
                data-oysterun-clean-session-stop-session-menu-position="last"
                data-oysterun-routec-stop-session-pending={String(stoppingRouteCSession)}
                data-oysterun-clean-session-stop-session-pending={String(stoppingRouteCSession)}
                data-oysterun-routec-stop-session-duplicate-suppressed={String(stoppingRouteCSession)}
                data-oysterun-routec-stop-session-min-visible-pending-ms={
                  OYSTERUN_STOP_MENU_MIN_VISIBLE_PENDING_MS
                }
                data-oysterun-routec-chat-shell={String(routeCChatShell)}
                data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
                data-oysterun-room-id={room.roomId}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  {stoppingRouteCSession ? 'Stopping...' : 'Stop'}
                </Text>
              </MenuItem>
              {stopError && (
                <Text as="span" size="T200" priority="300">
                  {stopError}
                </Text>
              )}
            </Box>
          </>
        )}
        {!routeCChatShell && (
          <>
            <Line variant="Surface" size="300" />
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              <UseStateProvider initial={false}>
                {(promptLeave, setPromptLeave) => (
                  <>
                    <MenuItem
                      onClick={() => setPromptLeave(true)}
                      variant="Critical"
                      fill="None"
                      size="300"
                      after={<Icon size="100" src={Icons.ArrowGoLeft} />}
                      radii="300"
                      aria-pressed={promptLeave}
                    >
                      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                        Leave Room
                      </Text>
                    </MenuItem>
                    {promptLeave && (
                      <LeaveRoomPrompt
                        roomId={room.roomId}
                        onDone={requestClose}
                        onCancel={() => setPromptLeave(false)}
                      />
                    )}
                  </>
                )}
              </UseStateProvider>
            </Box>
          </>
        )}
      </Menu>
    );
  }
);

export function RoomViewHeader({ callView }: { callView?: boolean }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const screenSize = useScreenSizeContext();
  const room = useRoom();
  const space = useSpaceOptionally();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [pinMenuAnchor, setPinMenuAnchor] = useState<RectCords>();
  const [routeCWebsiteTarget, setRouteCWebsiteTarget] = useState<OysterunRouteCWebsiteTarget>();
  const direct = useIsDirectRoom();

  const pinnedEvents = useRoomPinnedEvents(room);
  const encryptionEvent = useStateEvent(room, StateEvent.RoomEncryption);
  const encryptedRoom = !!encryptionEvent;
  const avatarMxc = useRoomAvatar(room, direct);
  const name = useRoomName(room);
  const topic = useRoomTopic(room);
  const oysterunRouteSessionSearch = getOysterunHostSessionRouteSearch();
  const routeCChatShell = Boolean(oysterunRouteSessionSearch);
  const displayName = routeCChatShell ? getOysterunBootstrappedHostSessionName() ?? name : name;
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  const [peopleDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');

  const oysterunSessionsPath = getOysterunHostSessionsPath();
  const oysterunSessionProfilePath = getOysterunHostSessionProfilePath(room.roomId);
  const oysterunLoopPath = getOysterunHostSessionLoopPath(room.roomId);
  const oysterunExplorerPath = getOysterunHostExplorerPath(room.roomId);
  const oysterunSearchReturnPath = getOysterunHostSessionChatPath();
  const routeCWebsiteUsesInternalBrowser = isOysterunCapacitorIOSRuntime();
  const routeCWebsiteBrowserPath = routeCWebsiteTarget
    ? getOysterunHostSessionBrowserPath(routeCWebsiteTarget.entryPath)
    : undefined;
  const routeCWebsiteDirectPath = routeCWebsiteTarget
    ? normalizeOysterunRouteCSiteBrowserTarget(routeCWebsiteTarget.entryPath)
    : undefined;
  const routeCWebsiteOpenPath = routeCWebsiteUsesInternalBrowser
    ? routeCWebsiteBrowserPath
    : routeCWebsiteDirectPath;
  const routeCWebsiteRouteSurface = routeCWebsiteUsesInternalBrowser
    ? 'app_browser'
    : 'browser_new_tab';
  const searchParams = new URLSearchParams(oysterunRouteSessionSearch ?? '');
  searchParams.set('rooms', room.roomId);
  const searchRoutePath = `${
    space ? getSpaceSearchPath(getCanonicalAliasOrRoomId(mx, space.roomId)) : getHomeSearchPath()
  }?${searchParams.toString()}`;

  useEffect(() => {
    let canceled = false;
    if (!routeCChatShell) {
      setRouteCWebsiteTarget(undefined);
      return () => {
        canceled = true;
      };
    }

    getOysterunRouteCHostCurrentWebsiteTarget()
      .then((target) => {
        if (!canceled) setRouteCWebsiteTarget(target);
      })
      .catch((err) => {
        console.warn('[oysterun-routec] failed to resolve website header target', err);
        if (!canceled) setRouteCWebsiteTarget(undefined);
      });

    return () => {
      canceled = true;
    };
  }, [routeCChatShell, oysterunRouteSessionSearch, room.roomId]);

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const handleOpenPinMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setPinMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const handlePreviousPage: MouseEventHandler<HTMLButtonElement> = () => {
    navigateOysterunHostSessionsPage();
  };

  const openSettings = useOpenRoomSettings();
  const parentSpace = useSpaceOptionally();
  const handleMemberToggle = () => {
    if (callView) {
      openSettings(room.roomId, parentSpace?.roomId, RoomSettingsPage.MembersPage);
      return;
    }
    setPeopleDrawer(!peopleDrawer);
  };

  return (
    <PageHeader
      className={ContainerColor({ variant: 'Surface' })}
      balance={screenSize === ScreenSize.Mobile}
      data-oysterun-routec-chat-shell={String(routeCChatShell)}
      data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
      data-oysterun-routec-right-members-drawer-hidden={String(routeCChatShell)}
      data-oysterun-clean-session-right-members-drawer-hidden={String(routeCChatShell)}
      data-oysterun-routec-members-toggle-hidden={String(routeCChatShell)}
      data-oysterun-clean-session-members-toggle-hidden={String(routeCChatShell)}
    >
      <Box grow="Yes" gap="300">
        {routeCChatShell && oysterunSessionsPath && (
          <Box shrink="No" alignItems="Center">
            <IconButton
              fill="None"
              onClick={handlePreviousPage}
              aria-label="Previous Page"
              title="Previous Page"
              data-testid="oysterun-routec-room-header-previous-page"
              data-oysterun-clean-session-testid="oysterun-clean-session-room-header-previous-page"
              data-oysterun-routec-previous-page-target={oysterunSessionsPath}
              data-oysterun-clean-session-previous-page-target={oysterunSessionsPath}
              data-oysterun-routec-previous-page-session-scope="current_host_session"
              data-oysterun-clean-session-previous-page-session-scope="current_host_session"
              data-oysterun-routec-previous-page-route-truth="host_sessions_root"
              data-oysterun-clean-session-previous-page-route-truth="host_sessions_root"
            >
              <Icon src={Icons.ArrowLeft} />
            </IconButton>
          </Box>
        )}
        {screenSize === ScreenSize.Mobile && !routeCChatShell && (
          <BackRouteHandler>
            {(onBack) => (
              <Box shrink="No" alignItems="Center">
                <IconButton fill="None" onClick={onBack}>
                  <Icon src={Icons.ArrowLeft} />
                </IconButton>
              </Box>
            )}
          </BackRouteHandler>
        )}
        <Box grow="Yes" alignItems="Center" gap="300">
          {screenSize !== ScreenSize.Mobile && !routeCChatShell && (
            <Avatar size="300">
              <RoomAvatar
                roomId={room.roomId}
                src={avatarUrl}
                alt={name}
                renderFallback={() => (
                  <RoomIcon size="200" joinRule={room.getJoinRule()} roomType={room.getType()} />
                )}
              />
            </Avatar>
          )}
          <Box direction="Column">
            <Text className={css.HeaderTitle} size={topic ? 'H5' : 'H3'} truncate>
              {displayName}
            </Text>
            {topic && (
              <UseStateProvider initial={false}>
                {(viewTopic, setViewTopic) => (
                  <>
                    <Overlay open={viewTopic} backdrop={<OverlayBackdrop />}>
                      <OverlayCenter>
                        <FocusTrap
                          focusTrapOptions={{
                            initialFocus: false,
                            clickOutsideDeactivates: true,
                            onDeactivate: () => setViewTopic(false),
                            escapeDeactivates: stopPropagation,
                          }}
                        >
                          <RoomTopicViewer
                            name={displayName}
                            topic={topic}
                            requestClose={() => setViewTopic(false)}
                          />
                        </FocusTrap>
                      </OverlayCenter>
                    </Overlay>
                    <Text
                      as="button"
                      type="button"
                      onClick={() => setViewTopic(true)}
                      className={css.HeaderTopic}
                      size="T200"
                      priority="300"
                      truncate
                    >
                      {topic}
                    </Text>
                  </>
                )}
              </UseStateProvider>
            )}
          </Box>
        </Box>

        <Box shrink="No">
          {!encryptedRoom && !routeCChatShell && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>Search</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  as={Link}
                  to={searchRoutePath}
                  fill="None"
                  ref={triggerRef}
                  aria-label="Search room messages"
                  title="Search room messages"
                  data-testid="oysterun-routec-room-header-search"
                  data-oysterun-clean-session-testid="oysterun-clean-session-room-header-search"
                  data-oysterun-routec-room-header-search="true"
                  data-oysterun-clean-session-room-header-search="true"
                  data-oysterun-routec-search-reachability="standard_header_action"
                  data-oysterun-clean-session-search-reachability="standard_header_action"
                  data-oysterun-routec-search-route-truth="query_only"
                  data-oysterun-clean-session-search-route-truth="query_only"
                  data-oysterun-routec-search-route-source="query_derived_host_session_route_search"
                  data-oysterun-clean-session-search-route-source="query_derived_host_session_route_search"
                  data-oysterun-routec-search-target={searchRoutePath}
                  data-oysterun-clean-session-search-target={searchRoutePath}
                  data-oysterun-routec-search-has-session-query={
                    oysterunRouteSessionSearch ? 'true' : 'false'
                  }
                  data-oysterun-clean-session-search-has-session-query={
                    oysterunRouteSessionSearch ? 'true' : 'false'
                  }
                  data-oysterun-routec-search-return-to="chat"
                  data-oysterun-clean-session-search-return-to="chat"
                  data-oysterun-routec-search-return-target={oysterunSearchReturnPath ?? ''}
                  data-oysterun-clean-session-search-return-target={oysterunSearchReturnPath ?? ''}
                  data-oysterun-routec-search-return-route-truth="clean_host_session_path"
                  data-oysterun-clean-session-search-return-route-truth="clean_host_session_path"
                  data-oysterun-room-id={room.roomId}
                >
                  <Icon size="400" src={Icons.Search} />
                </IconButton>
              )}
            </TooltipProvider>
          )}
          {routeCChatShell && oysterunExplorerPath && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>Explorer</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  as="a"
                  href={oysterunExplorerPath}
                  fill="None"
                  ref={triggerRef}
                  aria-label="Open Explorer"
                  title="Open Explorer"
                  data-testid="oysterun-routec-room-header-explorer"
                  data-oysterun-clean-session-testid="oysterun-clean-session-room-header-explorer"
                  data-oysterun-routec-explorer-target={oysterunExplorerPath}
                  data-oysterun-clean-session-explorer-target={oysterunExplorerPath}
                  data-oysterun-routec-explorer-origin="chat"
                  data-oysterun-clean-session-explorer-origin="chat"
                  data-oysterun-routec-explorer-return-to="chat"
                  data-oysterun-clean-session-explorer-return-to="chat"
                  data-oysterun-routec-explorer-route-truth="clean_host_session_path"
                  data-oysterun-clean-session-explorer-route-truth="clean_host_session_path"
                  data-oysterun-routec-explorer-icon="host_explorer_folder"
                  data-oysterun-clean-session-explorer-icon="host_explorer_folder"
                  data-oysterun-routec-url-mutation="dashboard_navigation"
                  data-oysterun-clean-session-url-mutation="dashboard_navigation"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable="false">
                    <path
                      d="M3 6.75A2.75 2.75 0 0 1 5.75 4h4.02a2.2 2.2 0 0 1 1.55.64l1.03 1.03c.23.23.54.36.87.36h5.03A2.75 2.75 0 0 1 21 8.78v8.47A2.75 2.75 0 0 1 18.25 20H5.75A2.75 2.75 0 0 1 3 17.25v-10.5Zm2.75-1.25A1.25 1.25 0 0 0 4.5 6.75v1.03h15V8.78c0-.69-.56-1.25-1.25-1.25h-5.03a2.2 2.2 0 0 1-1.55-.64l-1.03-1.03a.7.7 0 0 0-.49-.2H5.75Zm13.75 3.78h-15v7.97c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V9.28Z"
                      fill="currentColor"
                    />
                  </svg>
                </IconButton>
              )}
            </TooltipProvider>
          )}
          <TooltipProvider
            position="Bottom"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>Pinned Messages</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                style={{ position: 'relative' }}
                onClick={handleOpenPinMenu}
                ref={triggerRef}
                aria-pressed={!!pinMenuAnchor}
              >
                {pinnedEvents.length > 0 && (
                  <Badge
                    style={{
                      position: 'absolute',
                      left: toRem(3),
                      top: toRem(3),
                    }}
                    variant="Secondary"
                    size="400"
                    fill="Solid"
                    radii="Pill"
                  >
                    <Text as="span" size="L400">
                      {pinnedEvents.length}
                    </Text>
                  </Badge>
                )}
                <Icon size="400" src={Icons.Pin} filled={!!pinMenuAnchor} />
              </IconButton>
            )}
          </TooltipProvider>
          <PopOut
            anchor={pinMenuAnchor}
            position="Bottom"
            content={
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  returnFocusOnDeactivate: false,
                  onDeactivate: () => setPinMenuAnchor(undefined),
                  clickOutsideDeactivates: true,
                  isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                  isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                  escapeDeactivates: stopPropagation,
                }}
              >
                <RoomPinMenu room={room} requestClose={() => setPinMenuAnchor(undefined)} />
              </FocusTrap>
            }
          />

          {screenSize === ScreenSize.Desktop && !routeCChatShell && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  {callView ? (
                    <Text>Members</Text>
                  ) : (
                    <Text>{peopleDrawer ? 'Hide Members' : 'Show Members'}</Text>
                  )}
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton fill="None" ref={triggerRef} onClick={handleMemberToggle}>
                  <Icon size="400" src={Icons.User} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          <TooltipProvider
            position="Bottom"
            align="End"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>More Options</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                onClick={handleOpenMenu}
                ref={triggerRef}
                aria-pressed={!!menuAnchor}
                data-testid="oysterun-routec-room-header-more-options"
                data-oysterun-clean-session-testid="oysterun-clean-session-room-header-more-options"
                data-oysterun-routec-chat-shell={String(routeCChatShell)}
                data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
                data-oysterun-routec-route-truth="query_only"
                data-oysterun-clean-session-route-truth="query_only"
                data-oysterun-routec-session-query-present={String(
                  Boolean(oysterunRouteSessionSearch)
                )}
                data-oysterun-clean-session-session-query-present={String(
                  Boolean(oysterunRouteSessionSearch)
                )}
                data-oysterun-room-id={room.roomId}
              >
                <Icon size="400" src={Icons.VerticalDots} filled={!!menuAnchor} />
              </IconButton>
            )}
          </TooltipProvider>
          <PopOut
            anchor={menuAnchor}
            position="Bottom"
            align="End"
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
                <RoomMenu
                  room={room}
                  requestClose={() => setMenuAnchor(undefined)}
                  routeCSearchPath={!encryptedRoom && routeCChatShell ? searchRoutePath : undefined}
                  routeCSessionProfilePath={
                    routeCChatShell ? oysterunSessionProfilePath : undefined
                  }
                  routeCLoopPath={routeCChatShell ? oysterunLoopPath : undefined}
                  routeCWebsiteTarget={routeCChatShell ? routeCWebsiteTarget : undefined}
                  routeCWebsiteOpenPath={routeCChatShell ? routeCWebsiteOpenPath : undefined}
                  routeCWebsiteBrowserPath={routeCChatShell ? routeCWebsiteBrowserPath : undefined}
                  routeCWebsiteRouteSurface={
                    routeCChatShell ? routeCWebsiteRouteSurface : undefined
                  }
                  routeCWebsiteNewTab={
                    routeCChatShell ? !routeCWebsiteUsesInternalBrowser : undefined
                  }
                  routeCWebsiteUsesInternalBrowser={
                    routeCChatShell ? routeCWebsiteUsesInternalBrowser : undefined
                  }
                />
              </FocusTrap>
            }
          />
        </Box>
      </Box>
    </PageHeader>
  );
}
