import React from 'react';
import { Box, Icon, IconButton, Icons, Text, as } from 'folds';
import classNames from 'classnames';
import { useSetAtom } from 'jotai';
import { roomIdToTypingMembersAtom } from '../../state/typingMembers';
import { TypingIndicator } from '../../components/typing-indicator';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import * as css from './RoomViewTyping.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import type { OysterunRouteCRespondingState } from '../../../oysterun/OysterunMessageLifecycle';

type Room = any;

export type RoomViewTypingProps = {
  room: Room;
  routeCRespondingState: OysterunRouteCRespondingState;
};
export const RoomViewTyping = as<'div', RoomViewTypingProps>(
  ({ className, room, routeCRespondingState, ...props }, ref) => {
    const setTypingMembers = useSetAtom(roomIdToTypingMembersAtom);
    const mx = useMatrixClient();
    const typingMembers = useRoomTypingMember(room.roomId);

    const nativeTypingNames = typingMembers
      .filter((receipt) => receipt.userId !== mx.getUserId())
      .map(
        (receipt) => getMemberDisplayName(room, receipt.userId) ?? getMxIdLocalPart(receipt.userId)
      )
      .reverse();

    const oysterunTypingName = routeCRespondingState.agentResponding
      ? routeCRespondingState.displayName ?? 'Agent'
      : undefined;
    const typingNames = oysterunTypingName
      ? [
          oysterunTypingName,
          ...nativeTypingNames.filter((typingName) => typingName !== oysterunTypingName),
        ]
      : nativeTypingNames;

    if (typingNames.length === 0) {
      return null;
    }

    const handleDropAll = () => {
      // some homeserver does not timeout typing status
      // we have given option so user can drop their typing status
      typingMembers.forEach((receipt) =>
        setTypingMembers({
          type: 'DELETE',
          roomId: room.roomId,
          userId: receipt.userId,
        })
      );
    };

    return (
      <div style={{ position: 'relative' }}>
        <Box
          className={classNames(css.RoomViewTyping, className)}
          alignItems="Center"
          gap="400"
          data-testid={oysterunTypingName ? 'oysterun-routec-provider-typing-status' : undefined}
          data-oysterun-clean-session-testid={oysterunTypingName ? 'oysterun-clean-session-provider-typing-status' : undefined}
          data-oysterun-routec-provider-typing={oysterunTypingName ? 'true' : undefined}
          data-oysterun-clean-session-provider-typing={oysterunTypingName ? 'true' : undefined}
          data-oysterun-typing-ui="cinny-typing-indicator"
          data-oysterun-typing-semantics={
            oysterunTypingName ? 'oysterun-provider-host-state' : 'matrix-typing'
          }
          data-oysterun-source-user-event-id={routeCRespondingState.sourceUserEventId}
          data-oysterun-host2-intake-state={routeCRespondingState.host2IntakeState}
          data-oysterun-agent-turn-started={
            typeof routeCRespondingState.agentTurnStarted === 'boolean'
              ? String(routeCRespondingState.agentTurnStarted)
              : undefined
          }
          data-oysterun-provider-delivery-claimed={
            typeof routeCRespondingState.providerDeliveryClaimed === 'boolean'
              ? String(routeCRespondingState.providerDeliveryClaimed)
              : undefined
          }
          data-oysterun-final-result-for-source={
            typeof routeCRespondingState.finalResultForSource === 'boolean'
              ? String(routeCRespondingState.finalResultForSource)
              : undefined
          }
          data-oysterun-outbox-message-state={routeCRespondingState.outboxMessageState}
          data-oysterun-outbox-delivery-state={routeCRespondingState.outboxDeliveryState}
          data-oysterun-outbox-active-message-state={
            routeCRespondingState.outboxActiveMessageState ?? undefined
          }
          data-oysterun-prompt-open-source={routeCRespondingState.promptOpenSource}
          data-oysterun-provider-lifecycle-source={routeCRespondingState.providerLifecycleSource}
          data-oysterun-provider-lifecycle-state={routeCRespondingState.providerLifecycleState}
          data-oysterun-provider-lifecycle-active={
            typeof routeCRespondingState.providerLifecycleActive === 'boolean'
              ? String(routeCRespondingState.providerLifecycleActive)
              : undefined
          }
          data-oysterun-provider-lifecycle-terminal={
            typeof routeCRespondingState.providerLifecycleTerminal === 'boolean'
              ? String(routeCRespondingState.providerLifecycleTerminal)
              : undefined
          }
          data-oysterun-provider-lifecycle-canonical-known={String(
            routeCRespondingState.canonicalLifecycleKnown
          )}
          data-oysterun-related-polling-allowed={String(
            routeCRespondingState.relatedPollingAllowed
          )}
          data-oysterun-optimistic-client-request-id={
            routeCRespondingState.optimisticClientRequestId
          }
          data-oysterun-pending-control-request-count={
            routeCRespondingState.pendingControlRequestCount === undefined
              ? undefined
              : String(routeCRespondingState.pendingControlRequestCount)
          }
          data-oysterun-latest-semantic-type={routeCRespondingState.latestSemanticType}
          data-oysterun-native-typing-count={String(nativeTypingNames.length)}
          {...props}
          ref={ref}
        >
          <TypingIndicator />
          <Text className={css.TypingText} size="T300" truncate>
            {typingNames.length === 1 && (
              <>
                <b>{typingNames[0]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {' is typing...'}
                </Text>
              </>
            )}
            {typingNames.length === 2 && (
              <>
                <b>{typingNames[0]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {' and '}
                </Text>
                <b>{typingNames[1]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {' are typing...'}
                </Text>
              </>
            )}
            {typingNames.length === 3 && (
              <>
                <b>{typingNames[0]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {', '}
                </Text>
                <b>{typingNames[1]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {' and '}
                </Text>
                <b>{typingNames[2]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {' are typing...'}
                </Text>
              </>
            )}
            {typingNames.length > 3 && (
              <>
                <b>{typingNames[0]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {', '}
                </Text>
                <b>{typingNames[1]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {', '}
                </Text>
                <b>{typingNames[2]}</b>
                <Text as="span" size="Inherit" priority="300">
                  {' and '}
                </Text>
                <b>{typingNames.length - 3} others</b>
                <Text as="span" size="Inherit" priority="300">
                  {' are typing...'}
                </Text>
              </>
            )}
          </Text>
          {nativeTypingNames.length > 0 && (
            <IconButton title="Drop Typing Status" size="300" radii="Pill" onClick={handleDropAll}>
              <Icon size="50" src={Icons.Cross} />
            </IconButton>
          )}
        </Box>
      </div>
    );
  }
);
