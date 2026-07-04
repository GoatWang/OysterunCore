import React from 'react';
import {
  Outlet,
  Route,
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
  redirect,
} from 'react-router-dom';

import { ClientConfig } from '../hooks/useClientConfig';
import { AuthLayout, Login, Register, ResetPassword } from './auth';
import {
  DIRECT_PATH,
  EXPLORE_PATH,
  HOME_PATH,
  LOGIN_PATH,
  INBOX_PATH,
  REGISTER_PATH,
  RESET_PASSWORD_PATH,
  SPACE_PATH,
  _CREATE_PATH,
  _FEATURED_PATH,
  _INVITES_PATH,
  _JOIN_PATH,
  _LOBBY_PATH,
  _NOTIFICATIONS_PATH,
  _ROOM_PATH,
  _SEARCH_PATH,
  _SERVER_PATH,
  CREATE_PATH,
} from './paths';
import {
  getExploreFeaturedPath,
  getHomePath,
  getInboxNotificationsPath,
  getSpaceLobbyPath,
} from './pathUtils';
import { ClientBindAtoms, ClientLayout, ClientRoot } from './client';
import { Home, HomeRouteRoomProvider, HomeSearch } from './client/home';
import { Direct, DirectCreate, DirectRouteRoomProvider } from './client/direct';
import { RouteSpaceProvider, Space, SpaceRouteRoomProvider, SpaceSearch } from './client/space';
import { Explore, FeaturedRooms, PublicRooms } from './client/explore';
import { Notifications, Inbox, Invites } from './client/inbox';
import { Room } from '../features/room';
import { Lobby } from '../features/lobby';
import { WelcomePage } from './client/WelcomePage';
import { SidebarNav } from './client/SidebarNav';
import { PageRoot } from '../components/page';
import { ScreenSize } from '../hooks/useScreenSize';
import { MobileFriendlyPageNav, MobileFriendlyClientNav } from './MobileFriendly';
import { ClientInitStorageAtom } from './client/ClientInitStorageAtom';
import { ClientNonUIFeatures } from './client/ClientNonUIFeatures';
import { AuthRouteThemeManager, UnAuthRouteThemeManager } from './ThemeManager';
import { ReceiveSelfDeviceVerification } from '../components/DeviceVerification';
import { AutoRestoreBackupOnVerification } from '../components/BackupRestore';
import { RoomSettingsRenderer } from '../features/room-settings';
import { ClientRoomsNotificationPreferences } from './client/ClientRoomsNotificationPreferences';
import { SpaceSettingsRenderer } from '../features/space-settings';
import { UserRoomProfileRenderer } from '../components/UserRoomProfileRenderer';
import { CreateRoomModalRenderer } from '../features/create-room';
import { HomeCreateRoom } from './client/home/CreateRoom';
import { Create } from './client/create';
import { CreateSpaceModalRenderer } from '../features/create-space';
import { SearchModalRenderer } from '../features/search';
import { CallStatusRenderer } from './CallStatusRenderer';
import { CallEmbedProvider } from '../components/CallEmbedProvider';
import {
  getOysterunHostSessionRouteSearch,
  getOysterunRouteCRoomEntryBindingProof,
  hasOysterunHostSessionRoute,
  isOysterunCleanSessionChatPath,
} from '../../oysterun/OysterunHostClient';
import { OysterunRecoveryPage } from '../../oysterun/OysterunRecoveryPage';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { IsDirectRoomProvider, RoomProvider } from '../hooks/useRoom';

const getHomePathWithOysterunHostSessionRoute = (): string | undefined => {
  const routeSearch = getOysterunHostSessionRouteSearch();
  return routeSearch ? `${getHomePath()}${routeSearch}` : undefined;
};

const OYSTERUN_NO_SESSION_PATH = '/oysterun-no-session/';
const OYSTERUN_CLEAN_SESSION_CHAT_PATH = '/app/sessions/:sessionId/chat';

const getOysterunNoSessionPath = (): string => OYSTERUN_NO_SESSION_PATH;

function OysterunCleanSessionChatRoute() {
  const mx = useMatrixClient();
  const roomEntryBinding = getOysterunRouteCRoomEntryBindingProof();
  const matrixRoomId = roomEntryBinding.matrix_room_id;
  const room = matrixRoomId ? mx.getRoom(matrixRoomId) : undefined;

  if (!matrixRoomId || !room) {
    return (
      <OysterunRecoveryPage
        state="clean_chat_room_missing"
        title="Chat unavailable"
        message="Oysterun could not find the Matrix room for this Host session."
        testId="oysterun-routec-clean-chat-unavailable"
        proofAttributes={{
          'data-oysterun-routec-clean-session-path': 'true',
          'data-oysterun-clean-session-path': 'true',
          'data-oysterun-clean-session-testid': 'oysterun-clean-session-clean-chat-unavailable',
          'data-oysterun-routec-room-entry-contract': roomEntryBinding.contract,
          'data-oysterun-clean-session-room-entry-contract': roomEntryBinding.contract,
          'data-oysterun-routec-room-entry-state': 'bound_room_missing_after_sync',
          'data-oysterun-clean-session-room-entry-state': 'bound_room_missing_after_sync',
          'data-oysterun-routec-room-entry-ready': 'false',
          'data-oysterun-clean-session-room-entry-ready': 'false',
          'data-oysterun-routec-room-entry-unready': 'true',
          'data-oysterun-clean-session-room-entry-unready': 'true',
          'data-oysterun-routec-raw-matrix-login-visible': 'false',
          'data-oysterun-clean-session-raw-matrix-login-visible': 'false',
          'data-oysterun-routec-manual-token-visible': 'false',
          'data-oysterun-clean-session-manual-token-visible': 'false',
          'data-oysterun-routec-homeserver-picker-visible': 'false',
          'data-oysterun-clean-session-homeserver-picker-visible': 'false',
          'data-oysterun-host-session-id': roomEntryBinding.host_session_id,
          'data-oysterun-room-id': matrixRoomId,
        }}
      />
    );
  }

  return (
    <RoomProvider key={room.roomId} value={room}>
      <IsDirectRoomProvider value={false}>
        <Room />
      </IsDirectRoomProvider>
    </RoomProvider>
  );
}

function OysterunNoSessionRequired() {
  return (
    <OysterunRecoveryPage
      state="explicit_session_required"
      title="Session required"
      message="Open this chat from Oysterun Sessions or Session Setup so Oysterun can bind it to a current Host session."
      testId="oysterun-route-c-no-session"
      openSessionsAction={{
        testId: 'oysterun-route-c-no-session-open-sessions',
        proofAttributes: {
          'data-oysterun-routec-session-flow-target': 'sessions',
          'data-oysterun-clean-session-session-flow-target': 'sessions',
          'data-oysterun-routec-raw-matrix-login-target': 'false',
          'data-oysterun-clean-session-raw-matrix-login-target': 'false',
        },
      }}
      startSessionAction={{
        label: 'Start Session',
        href: '/app/session-setup',
        testId: 'oysterun-route-c-no-session-start-session',
        proofAttributes: {
          'data-oysterun-routec-session-flow-target': 'session_setup',
          'data-oysterun-clean-session-session-flow-target': 'session_setup',
          'data-oysterun-routec-raw-matrix-login-target': 'false',
          'data-oysterun-clean-session-raw-matrix-login-target': 'false',
        },
      }}
      proofAttributes={{
        'data-oysterun-routec-bootstrap-login-ux': 'no_query_fail_closed',
        'data-oysterun-clean-session-bootstrap-login-ux': 'no_query_fail_closed',
        'data-oysterun-routec-no-query-fail-closed': 'true',
        'data-oysterun-clean-session-no-query-fail-closed': 'true',
        'data-oysterun-routec-route-truth': 'query_only',
        'data-oysterun-clean-session-route-truth': 'query_only',
        'data-oysterun-routec-session-storage-route-truth': 'false',
        'data-oysterun-clean-session-session-storage-route-truth': 'false',
        'data-oysterun-routec-normal-entry-source': 'oysterun_session_flow',
        'data-oysterun-clean-session-normal-entry-source': 'oysterun_session_flow',
        'data-oysterun-routec-raw-matrix-login-visible': 'false',
        'data-oysterun-clean-session-raw-matrix-login-visible': 'false',
        'data-oysterun-routec-manual-token-visible': 'false',
        'data-oysterun-clean-session-manual-token-visible': 'false',
        'data-oysterun-routec-homeserver-picker-visible': 'false',
        'data-oysterun-clean-session-homeserver-picker-visible': 'false',
      }}
    />
  );
}

function OysterunPageNotFound() {
  return (
    <OysterunRecoveryPage
      state="page_not_found"
      title="Page not found"
      message="This Oysterun chat page could not be found."
      testId="oysterun-recovery-page-not-found"
      proofAttributes={{
        'data-oysterun-recovery-catch-all': 'true',
      }}
    />
  );
}

export const createRouter = (clientConfig: ClientConfig, screenSize: ScreenSize) => {
  const { hashRouter } = clientConfig;
  const mobile = screenSize === ScreenSize.Mobile;
  const routeCChatShell = hasOysterunHostSessionRoute();
  const cleanSessionChatPath = isOysterunCleanSessionChatPath();
  const leftNav = (node: React.ReactNode): React.ReactNode | undefined =>
    routeCChatShell ? undefined : node;

  const routes = createRoutesFromElements(
    <Route>
      <Route
        index
        loader={() => {
          const oysterunHomePath = getHomePathWithOysterunHostSessionRoute();
          return redirect(oysterunHomePath ?? getOysterunNoSessionPath());
        }}
      />
      <Route
        path={OYSTERUN_NO_SESSION_PATH}
        loader={() => {
          const oysterunHomePath = getHomePathWithOysterunHostSessionRoute();
          if (oysterunHomePath) return redirect(oysterunHomePath);
          return null;
        }}
        element={<OysterunNoSessionRequired />}
      />
      <Route
        loader={() => {
          const oysterunHomePath = getHomePathWithOysterunHostSessionRoute();
          return redirect(oysterunHomePath ?? getOysterunNoSessionPath());
        }}
        element={
          <>
            <AuthLayout />
            <UnAuthRouteThemeManager />
          </>
        }
      >
        <Route path={LOGIN_PATH} element={<Login />} />
        <Route path={REGISTER_PATH} element={<Register />} />
        <Route path={RESET_PASSWORD_PATH} element={<ResetPassword />} />
      </Route>

      <Route
        loader={() => {
          if (!hasOysterunHostSessionRoute()) return redirect(getOysterunNoSessionPath());
          return null;
        }}
        element={
          <AuthRouteThemeManager>
            <ClientRoot>
              <ClientInitStorageAtom>
                <ClientRoomsNotificationPreferences>
                  <ClientBindAtoms>
                    <ClientNonUIFeatures>
                      <CallEmbedProvider>
                        <ClientLayout
                          nav={leftNav(
                            <MobileFriendlyClientNav>
                              <SidebarNav />
                            </MobileFriendlyClientNav>,
                          )}
                        >
                          <Outlet />
                        </ClientLayout>
                        <CallStatusRenderer />
                      </CallEmbedProvider>
                      <SearchModalRenderer />
                      <UserRoomProfileRenderer />
                      <CreateRoomModalRenderer />
                      <CreateSpaceModalRenderer />
                      <RoomSettingsRenderer />
                      <SpaceSettingsRenderer />
                      <ReceiveSelfDeviceVerification />
                      <AutoRestoreBackupOnVerification />
                    </ClientNonUIFeatures>
                  </ClientBindAtoms>
                </ClientRoomsNotificationPreferences>
              </ClientInitStorageAtom>
            </ClientRoot>
          </AuthRouteThemeManager>
        }
      >
        <Route
          path={OYSTERUN_CLEAN_SESSION_CHAT_PATH}
          element={<OysterunCleanSessionChatRoute />}
        />
        <Route
          path={`${OYSTERUN_CLEAN_SESSION_CHAT_PATH}/`}
          element={<OysterunCleanSessionChatRoute />}
        />
        <Route
          path={HOME_PATH}
          element={
            <PageRoot
              nav={leftNav(
                <MobileFriendlyPageNav path={HOME_PATH}>
                  <Home />
                </MobileFriendlyPageNav>,
              )}
            >
              <Outlet />
            </PageRoot>
          }
        >
          {mobile ? null : <Route index element={<WelcomePage />} />}
          <Route path={_CREATE_PATH} element={<HomeCreateRoom />} />
          <Route path={_JOIN_PATH} element={<p>join</p>} />
          <Route path={_SEARCH_PATH} element={<HomeSearch />} />
          <Route
            path={_ROOM_PATH}
            element={
              <HomeRouteRoomProvider>
                <Room />
              </HomeRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={DIRECT_PATH}
          element={
            <PageRoot
              nav={leftNav(
                <MobileFriendlyPageNav path={DIRECT_PATH}>
                  <Direct />
                </MobileFriendlyPageNav>,
              )}
            >
              <Outlet />
            </PageRoot>
          }
        >
          {mobile ? null : <Route index element={<WelcomePage />} />}
          <Route path={_CREATE_PATH} element={<DirectCreate />} />
          <Route
            path={_ROOM_PATH}
            element={
              <DirectRouteRoomProvider>
                <Room />
              </DirectRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={SPACE_PATH}
          element={
            <RouteSpaceProvider>
              <PageRoot
                nav={leftNav(
                  <MobileFriendlyPageNav path={SPACE_PATH}>
                    <Space />
                  </MobileFriendlyPageNav>,
                )}
              >
                <Outlet />
              </PageRoot>
            </RouteSpaceProvider>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={({ params }) => {
                const { spaceIdOrAlias } = params;
                if (spaceIdOrAlias) {
                  return redirect(getSpaceLobbyPath(spaceIdOrAlias));
                }
                return null;
              }}
              element={<WelcomePage />}
            />
          )}
          <Route path={_LOBBY_PATH} element={<Lobby />} />
          <Route path={_SEARCH_PATH} element={<SpaceSearch />} />
          <Route
            path={_ROOM_PATH}
            element={
              <SpaceRouteRoomProvider>
                <Room />
              </SpaceRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={EXPLORE_PATH}
          element={
            <PageRoot
              nav={leftNav(
                <MobileFriendlyPageNav path={EXPLORE_PATH}>
                  <Explore />
                </MobileFriendlyPageNav>,
              )}
            >
              <Outlet />
            </PageRoot>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={() => redirect(getExploreFeaturedPath())}
              element={<WelcomePage />}
            />
          )}
          <Route path={_FEATURED_PATH} element={<FeaturedRooms />} />
          <Route path={_SERVER_PATH} element={<PublicRooms />} />
        </Route>
        <Route path={CREATE_PATH} element={<Create />} />
        <Route
          path={INBOX_PATH}
          element={
            <PageRoot
              nav={leftNav(
                <MobileFriendlyPageNav path={INBOX_PATH}>
                  <Inbox />
                </MobileFriendlyPageNav>,
              )}
            >
              <Outlet />
            </PageRoot>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={() => redirect(getInboxNotificationsPath())}
              element={<WelcomePage />}
            />
          )}
          <Route path={_NOTIFICATIONS_PATH} element={<Notifications />} />
          <Route path={_INVITES_PATH} element={<Invites />} />
        </Route>
      </Route>
      <Route path="/*" element={<OysterunPageNotFound />} />
    </Route>,
  );

  if (hashRouter?.enabled && !cleanSessionChatPath) {
    return createHashRouter(routes, { basename: hashRouter.basename });
  }
  return createBrowserRouter(routes, {
    basename: cleanSessionChatPath ? '/' : import.meta.env.BASE_URL,
  });
};
