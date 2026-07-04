import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Line } from 'folds';
import { useParams } from 'react-router-dom';
import { isKeyHotkey } from 'is-hotkey';
import { useAtomValue } from 'jotai';
import type { Room as MatrixRoom } from 'matrix-js-sdk';
import { RoomView } from './RoomView';
import { MembersDrawer } from './MembersDrawer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useKeyDown } from '../../hooks/useKeyDown';
import { markAsRead } from '../../utils/notifications';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { CallView } from '../call/CallView';
import { RoomViewHeader } from './RoomViewHeader';
import { callChatAtom } from '../../state/callEmbed';
import { CallChatView } from './CallChatView';
import {
  getOysterunHostSessionChatFocusEventId,
  getOysterunHostSessionChatPath,
  hasOysterunHostSessionRoute,
  navigateOysterunHostSessionsPage,
} from '../../../oysterun/OysterunHostClient';
import { useOysterunCapacitorSwipeBack } from '../../../oysterun/useOysterunCapacitorSwipeBack';

function RoomMembersDrawer({ room }: { room: MatrixRoom }) {
  const mx = useMatrixClient();
  const members = useRoomMembers(mx, room.roomId);

  return (
    <>
      <Line variant="Background" direction="Vertical" size="300" />
      <MembersDrawer key={room.roomId} room={room} members={members} />
    </>
  );
}

export function Room() {
  const { eventId } = useParams();
  const routeCInitialFocusEventIdRef = useRef(getOysterunHostSessionChatFocusEventId());
  const room = useRoom();
  const mx = useMatrixClient();

  const [isDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const chat = useAtomValue(callChatAtom);
  const routeCChatShell = hasOysterunHostSessionRoute();
  const focusedEventId = eventId ?? routeCInitialFocusEventIdRef.current;
  const handleRouteCPreviousPage = useCallback(() => {
    if (routeCChatShell) navigateOysterunHostSessionsPage();
  }, [routeCChatShell]);

  useEffect(() => {
    if (!routeCChatShell || eventId || !routeCInitialFocusEventIdRef.current) return;
    const cleanChatPath = getOysterunHostSessionChatPath();
    if (cleanChatPath) {
      window.history.replaceState(window.history.state, '', cleanChatPath);
    }
  }, [eventId, routeCChatShell]);

  useOysterunCapacitorSwipeBack({
    enabled: routeCChatShell,
    onBack: handleRouteCPreviousPage,
  });

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          markAsRead(mx, room.roomId, hideActivity);
        }
      },
      [mx, room.roomId, hideActivity]
    )
  );

  const callView = room.isCallRoom();

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes">
        {callView && (screenSize === ScreenSize.Desktop || !chat) && (
          <Box grow="Yes" direction="Column">
            <RoomViewHeader callView />
            <Box grow="Yes">
              <CallView />
            </Box>
          </Box>
        )}
        {!callView && (
          <Box grow="Yes" direction="Column">
            <RoomViewHeader />
            <Box grow="Yes">
              <RoomView eventId={focusedEventId} />
            </Box>
          </Box>
        )}

        {callView && chat && (
          <>
            {screenSize === ScreenSize.Desktop && (
              <Line variant="Background" direction="Vertical" size="300" />
            )}
            <CallChatView />
          </>
        )}
        {!routeCChatShell && !callView && screenSize === ScreenSize.Desktop && isDrawer && (
          <RoomMembersDrawer room={room} />
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
