import React, { useRef } from 'react';
import { Box, Icon, Icons, Text, Scroll, IconButton } from 'folds';
import { useAtomValue } from 'jotai';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { MessageSearch } from '../../../features/message-search';
import { useSpace } from '../../../hooks/useSpace';
import { useRecursiveChildRoomScopeFactory, useSpaceChildren } from '../../../state/hooks/roomList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { BackRouteHandler } from '../../../components/BackRouteHandler';
import { getOysterunHostSessionChatPath } from '../../../../oysterun/OysterunHostClient';

export function SpaceSearch() {
  const mx = useMatrixClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const space = useSpace();
  const screenSize = useScreenSizeContext();
  const routeCPreviousPageTarget = getOysterunHostSessionChatPath();

  const handleRouteCPreviousPage = () => {
    if (!routeCPreviousPageTarget) return;
    window.location.assign(routeCPreviousPageTarget);
  };

  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const rooms = useSpaceChildren(
    allRoomsAtom,
    space.roomId,
    useRecursiveChildRoomScopeFactory(mx, mDirects, roomToParents)
  );

  return (
    <Page>
      <PageHeader balance>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Box grow="Yes" basis="No">
            {routeCPreviousPageTarget ? (
              <IconButton
                onClick={handleRouteCPreviousPage}
                aria-label="Previous Page"
                title="Previous Page"
                data-testid="oysterun-routec-search-previous-page"
                data-oysterun-clean-session-testid="oysterun-clean-session-search-previous-page"
                data-oysterun-routec-search-previous-page-target={routeCPreviousPageTarget}
                data-oysterun-clean-session-search-previous-page-target={routeCPreviousPageTarget}
                data-oysterun-routec-search-previous-page-return-to="chat"
                data-oysterun-clean-session-search-previous-page-return-to="chat"
                data-oysterun-routec-search-previous-page-route-truth="clean_host_session_path"
                data-oysterun-clean-session-search-previous-page-route-truth="clean_host_session_path"
                data-oysterun-routec-search-previous-page-session-scope="current_host_session"
                data-oysterun-clean-session-search-previous-page-session-scope="current_host_session"
                data-oysterun-routec-search-previous-page-visible-form-factors="desktop_and_phone"
                data-oysterun-clean-session-search-previous-page-visible-form-factors="desktop_and_phone"
                data-oysterun-routec-url-mutation="dashboard_navigation"
                data-oysterun-clean-session-url-mutation="dashboard_navigation"
              >
                <Icon src={Icons.ArrowLeft} />
              </IconButton>
            ) : (
              screenSize === ScreenSize.Mobile && (
                <BackRouteHandler>
                  {(onBack) => (
                    <IconButton onClick={onBack}>
                      <Icon src={Icons.ArrowLeft} />
                    </IconButton>
                  )}
                </BackRouteHandler>
              )
            )}
          </Box>
          <Box justifyContent="Center" alignItems="Center" gap="200">
            {screenSize !== ScreenSize.Mobile && <Icon size="400" src={Icons.Search} />}
            <Text size="H3" truncate>
              Message Search
            </Text>
          </Box>
          <Box grow="Yes" basis="No" />
        </Box>
      </PageHeader>
      <Box style={{ position: 'relative' }} grow="Yes">
        <Scroll ref={scrollRef} hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <MessageSearch
                defaultRoomsFilterName={space.name}
                allowGlobal
                rooms={rooms}
                scrollRef={scrollRef}
              />
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
