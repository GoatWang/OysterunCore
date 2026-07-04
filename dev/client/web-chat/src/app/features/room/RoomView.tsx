import React, { useCallback, useRef } from 'react';
import { Box, Text, config } from 'folds';
import { EventType } from 'matrix-js-sdk/lib/@types/event';
import { ReactEditor } from 'slate-react';
import { isKeyHotkey } from 'is-hotkey';
import { useStateEvent } from '../../hooks/useStateEvent';
import { StateEvent } from '../../../types/matrix/room';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useEditor } from '../../components/editor';
import { RoomInputPlaceholder } from './RoomInputPlaceholder';
import { RoomTimeline } from './RoomTimeline';
import { RoomViewTyping } from './RoomViewTyping';
import { RoomTombstone } from './RoomTombstone';
import { RoomInput } from './RoomInput';
import { RoomViewFollowing, RoomViewFollowingPlaceholder } from './RoomViewFollowing';
import { Page } from '../../components/page';
import { useKeyDown } from '../../hooks/useKeyDown';
import { editableActiveElement } from '../../utils/dom';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoom } from '../../hooks/useRoom';
import { hasOysterunHostSessionRoute } from '../../../oysterun/OysterunHostClient';
import { useOysterunRouteCRespondingState } from '../../../oysterun/OysterunMessageLifecycle';

const FN_KEYS_REGEX = /^F\d+$/;
const OYSTERUN_COMPOSER_BACKGROUND = 'rgba(255, 252, 247, 0.92)';
const shouldFocusMessageField = (evt: KeyboardEvent): boolean => {
  const { code } = evt;
  if (evt.metaKey || evt.altKey || evt.ctrlKey) {
    return false;
  }

  if (FN_KEYS_REGEX.test(code)) return false;

  if (
    code.startsWith('OS') ||
    code.startsWith('Meta') ||
    code.startsWith('Shift') ||
    code.startsWith('Alt') ||
    code.startsWith('Control') ||
    code.startsWith('Arrow') ||
    code.startsWith('Page') ||
    code.startsWith('End') ||
    code.startsWith('Home') ||
    code === 'Tab' ||
    code === 'Space' ||
    code === 'Enter' ||
    code === 'NumLock' ||
    code === 'ScrollLock'
  ) {
    return false;
  }

  return true;
};

function shouldShowOysterunFollowingConversationBar(routeCChatShell: boolean): boolean {
  // Route C preserves provider typing/status above the composer and removes read-receipt follow text.
  return !routeCChatShell;
}

export function RoomView({ eventId }: { eventId?: string }) {
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);

  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const room = useRoom();
  const { roomId } = room;
  const editor = useEditor();

  const mx = useMatrixClient();

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canMessage = permissions.event(EventType.RoomMessage, mx.getSafeUserId());
  const routeCChatShell = hasOysterunHostSessionRoute();
  const showFollowingConversationBar = shouldShowOysterunFollowingConversationBar(routeCChatShell);
  const routeCRespondingState = useOysterunRouteCRespondingState(room);

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (editableActiveElement()) return;
        const portalContainer = document.getElementById('portalContainer');
        if (portalContainer && portalContainer.children.length > 0) {
          return;
        }
        if (shouldFocusMessageField(evt) || isKeyHotkey('mod+v', evt)) {
          ReactEditor.focus(editor);
        }
      },
      [editor]
    )
  );

  return (
    <Page
      ref={roomViewRef}
      data-testid="oysterun-routec-room-view-root"
      data-oysterun-clean-session-testid="oysterun-clean-session-room-view-root"
      data-oysterun-room-id={roomId}
    >
      <Box grow="Yes" direction="Column">
        <RoomTimeline
          key={roomId}
          room={room}
          eventId={eventId}
          roomInputRef={roomInputRef}
          editor={editor}
          routeCRespondingState={routeCRespondingState}
        />
        <RoomViewTyping room={room} routeCRespondingState={routeCRespondingState} />
      </Box>
      <Box shrink="No" direction="Column">
        <div
          style={{
            padding: `0 ${config.space.S400}`,
            backgroundColor: routeCChatShell ? OYSTERUN_COMPOSER_BACKGROUND : undefined,
          }}
        >
          {tombstoneEvent ? (
            <RoomTombstone
              roomId={roomId}
              body={tombstoneEvent.getContent().body}
              replacementRoomId={tombstoneEvent.getContent().replacement_room}
            />
          ) : (
            <>
              {canMessage && (
                <RoomInput
                  room={room}
                  editor={editor}
                  roomId={roomId}
                  fileDropContainerRef={roomViewRef}
                  routeCRespondingState={routeCRespondingState}
                  ref={roomInputRef}
                />
              )}
              {!canMessage && (
                <RoomInputPlaceholder
                  style={{ padding: config.space.S200 }}
                  alignItems="Center"
                  justifyContent="Center"
                >
                  <Text align="Center">You do not have permission to post in this room</Text>
                </RoomInputPlaceholder>
              )}
            </>
          )}
        </div>
        {showFollowingConversationBar &&
          (hideActivity ? <RoomViewFollowingPlaceholder /> : <RoomViewFollowing room={room} />)}
      </Box>
    </Page>
  );
}
