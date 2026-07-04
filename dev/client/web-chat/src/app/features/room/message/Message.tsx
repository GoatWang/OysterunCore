import {
  Avatar,
  Box,
  Button,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Line,
  Menu,
  MenuItem,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  RectCords,
  Spinner,
  Text,
  as,
  color,
  config,
} from 'folds';
import React, {
  FormEventHandler,
  MouseEventHandler,
  ReactNode,
  useCallback,
  useState,
} from 'react';
import FocusTrap from 'focus-trap-react';
import { useHover, useFocusWithin } from 'react-aria';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import classNames from 'classnames';
import { RoomPinnedEventsEventContent } from 'matrix-js-sdk/lib/types';
import {
  AvatarBase,
  BubbleLayout,
  CompactLayout,
  MessageBase,
  ModernLayout,
  Time,
  Username,
  UsernameBold,
} from '../../../components/message';
import {
  canEditEvent,
  getEventEdits,
  getMemberAvatarMxc,
  getMemberDisplayName,
} from '../../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { MessageLayout, MessageSpacing } from '../../../state/settings';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRecentEmoji } from '../../../hooks/useRecentEmoji';
import * as css from './styles.css';
import { EventReaders } from '../../../components/event-readers';
import { TextViewer } from '../../../components/text-viewer';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { EmojiBoard } from '../../../components/emoji-board';
import { ReactionViewer } from '../reaction-viewer';
import { MessageEditor } from './MessageEditor';
import { UserAvatar } from '../../../components/user-avatar';
import { copyToClipboard } from '../../../utils/dom';
import { stopPropagation } from '../../../utils/keyboard';
import { getMatrixToRoomEvent } from '../../../plugins/matrix-to';
import { getViaServers } from '../../../plugins/via-servers';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRoomPinnedEvents } from '../../../hooks/useRoomPinnedEvents';
import { MemberPowerTag, StateEvent } from '../../../../types/matrix/room';
import { PowerIcon } from '../../../components/power';
import colorMXID from '../../../../util/colorMXID';
import { getPowerTagIconSrc } from '../../../hooks/useMemberPowerTag';
import { buildOysterunMessageProofAttributes } from '../../../../oysterun/OysterunProofFields';
import {
  getOysterunHostSessionChatFocusPath,
  getOysterunHostSessionRouteSearch,
  getOysterunRouteCComposerDraftHostSessionId,
  type OysterunHost2IntakeProof,
} from '../../../../oysterun/OysterunHostClient';
import { getOysterunRouteCMessageAvatarSrc } from '../../../../oysterun/OysterunAvatar';
import type { OysterunSemanticControlOutcome } from '../../../../oysterun/OysterunSemanticRenderer';
import {
  OYSTERUN_ROUTE_C_CLIPBOARD_HELPER_ID,
  OYSTERUN_ROUTE_C_CLIPBOARD_ROOT_SELECTOR,
  writeOysterunRouteCMessageTextToClipboard,
} from './oysterunClipboard';

export type ReactionHandler = (keyOrMxc: string, shortcode: string) => void;

const OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED = false;
const OYSTERUN_SEMANTIC_NAMESPACE = 'org.oysterun.semantic.v1';
const OYSTERUN_ROUTE_C_MESSAGE_DEBUG_INFO_SCHEMA = 'routec.message_debug_info.v1';

export type OysterunHost2CancelControl = {
  status: 'ready' | 'canceling' | 'accepted' | 'too_late' | 'error';
  proof: OysterunHost2IntakeProof;
  error?: string;
  onCancel: (eventId: string) => void;
};

function isOysterunRouteCUserTextEvent(mxUserId: string | undefined, mEvent: MatrixEvent): boolean {
  if (!mxUserId || mEvent.getType() !== 'm.room.message' || mEvent.getSender() !== mxUserId) {
    return false;
  }
  const content = mEvent.getContent();
  if (content?.[OYSTERUN_SEMANTIC_NAMESPACE]) return false;
  return content?.msgtype === 'm.text' && typeof content?.body === 'string';
}

function isOysterunHost2DoubleCheckProof(
  proof: OysterunHost2IntakeProof | undefined,
  eventId: string | undefined
): boolean {
  return (
    Boolean(eventId) &&
    proof?.matrix_server_event_id === eventId &&
    proof?.host2_receipt_target_event_id === eventId &&
    proof?.host2_receipt_exact_user_event === true &&
    proof?.double_check_host2_receipt_seen === true
  );
}

function getOysterunCopyMessageText(mEvent: MatrixEvent): string {
  if (mEvent.isRedacted()) return '';
  const content = mEvent.getContent<Record<string, unknown>>();
  const body = content?.body;
  return typeof body === 'string' && body.trim() ? body : '';
}

function getOysterunServerMatrixEventId(mEvent: MatrixEvent): string | undefined {
  const eventId = mEvent.getId();
  return typeof eventId === 'string' && eventId.startsWith('$') ? eventId : undefined;
}

function buildOysterunRouteCMessageDebugInfoPayload(
  room: Room,
  mEvent: MatrixEvent,
  eventId: string
): Record<string, string | number> | undefined {
  const hostSessionId = getOysterunRouteCComposerDraftHostSessionId();
  const chatFocusUrl = getOysterunHostSessionChatFocusPath(eventId);
  if (!hostSessionId || !chatFocusUrl) return undefined;

  const payload: Record<string, string | number> = {
    schema: OYSTERUN_ROUTE_C_MESSAGE_DEBUG_INFO_SCHEMA,
    host_origin: window.location.origin,
    host_session_id: hostSessionId,
    matrix_room_id: room.roomId,
    matrix_event_id: eventId,
    chat_focus_url: chatFocusUrl,
    event_id_kind: 'server',
  };
  const eventType = mEvent.getType();
  if (eventType) payload.event_type = eventType;
  const sender = mEvent.getSender();
  if (sender) payload.sender = sender;
  const originServerTs = mEvent.getTs();
  if (Number.isFinite(originServerTs)) payload.origin_server_ts = originServerTs;
  return payload;
}

type MessageQuickReactionsProps = {
  onReaction: ReactionHandler;
};
export const MessageQuickReactions = as<'div', MessageQuickReactionsProps>(
  ({ onReaction, ...props }, ref) => {
    const mx = useMatrixClient();
    const recentEmojis = useRecentEmoji(mx, 4);

    if (recentEmojis.length === 0) return <span />;
    return (
      <>
        <Box
          style={{ padding: config.space.S200 }}
          alignItems="Center"
          justifyContent="Center"
          gap="200"
          {...props}
          ref={ref}
        >
          {recentEmojis.map((emoji) => (
            <IconButton
              key={emoji.unicode}
              className={css.MessageQuickReaction}
              size="300"
              variant="SurfaceVariant"
              radii="Pill"
              title={emoji.shortcode}
              aria-label={emoji.shortcode}
              onClick={() => onReaction(emoji.unicode, emoji.shortcode)}
            >
              <Text size="T500">{emoji.unicode}</Text>
            </IconButton>
          ))}
        </Box>
        <Line size="300" />
      </>
    );
  }
);

export const MessageAllReactionItem = as<
  'button',
  {
    room: Room;
    relations: Relations;
    onClose?: () => void;
  }
>(({ room, relations, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay
        onContextMenu={(evt: any) => {
          evt.stopPropagation();
        }}
        open={open}
        backdrop={<OverlayBackdrop />}
      >
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => handleClose(),
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal variant="Surface" size="300">
              <ReactionViewer
                room={room}
                relations={relations}
                requestClose={() => setOpen(false)}
              />
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.Smile} />}
        radii="300"
        onClick={() => setOpen(true)}
        {...props}
        ref={ref}
        aria-pressed={open}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          View Reactions
        </Text>
      </MenuItem>
    </>
  );
});

export const MessageReadReceiptItem = as<
  'button',
  {
    room: Room;
    eventId: string;
    onClose?: () => void;
  }
>(({ room, eventId, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal variant="Surface" size="300">
              <EventReaders room={room} eventId={eventId} requestClose={handleClose} />
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.CheckTwice} />}
        radii="300"
        onClick={() => setOpen(true)}
        {...props}
        ref={ref}
        aria-pressed={open}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Read Receipts
        </Text>
      </MenuItem>
    </>
  );
});

export const MessageSourceCodeItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  const getContent = (evt: MatrixEvent) =>
    evt.isEncrypted()
      ? {
          [`<== DECRYPTED_EVENT ==>`]: evt.getEffectiveEvent(),
          [`<== ORIGINAL_EVENT ==>`]: evt.event,
        }
      : evt.event;

  const getText = (): string => {
    const evtId = mEvent.getId()!;
    const evtTimeline = room.getTimelineForEvent(evtId);
    const edits =
      evtTimeline &&
      getEventEdits(evtTimeline.getTimelineSet(), evtId, mEvent.getType())?.getRelations();

    if (!edits) return JSON.stringify(getContent(mEvent), null, 2);

    const content: Record<string, unknown> = {
      '<== MAIN_EVENT ==>': getContent(mEvent),
    };

    edits.forEach((editEvt, index) => {
      content[`<== REPLACEMENT_EVENT_${index + 1} ==>`] = getContent(editEvt);
    });

    return JSON.stringify(content, null, 2);
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal variant="Surface" size="500">
              <TextViewer
                name="Source Code"
                langName="json"
                text={getText()}
                requestClose={handleClose}
              />
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.BlockCode} />}
        radii="300"
        onClick={() => setOpen(true)}
        {...props}
        ref={ref}
        aria-pressed={open}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          View Source
        </Text>
      </MenuItem>
    </>
  );
});

export const MessageCopyLinkItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const handleCopy = () => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    copyToClipboard(getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room)));
    onClose?.();
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Link} />}
      radii="300"
      onClick={handleCopy}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        Copy Link
      </Text>
    </MenuItem>
  );
});

export const MessageCopyMessageItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const eventId = mEvent.getId();
  const copyText = getOysterunCopyMessageText(mEvent);
  if (!copyText) return null;

  const handleCopy: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const copyRoot = evt.currentTarget.closest<HTMLElement>(
      OYSTERUN_ROUTE_C_CLIPBOARD_ROOT_SELECTOR
    );
    void writeOysterunRouteCMessageTextToClipboard(copyText, { copyRoot })
      .then(() => {
        onClose?.();
      })
      .catch((err: unknown) => {
        console.error('[oysterun-routec] Copy Message clipboard write failed', {
          roomId: room.roomId,
          eventId,
          err,
        });
      });
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Message} />}
      radii="300"
      onClick={handleCopy}
      data-oysterun-message-operation="copy_message"
      data-oysterun-copy-scope="whole_message"
      data-oysterun-copy-source="matrix_event_content_body"
      data-oysterun-copy-menu-label-exclusion="true"
      data-oysterun-copy-text-length={copyText.length}
      data-oysterun-copy-clipboard-helper={OYSTERUN_ROUTE_C_CLIPBOARD_HELPER_ID}
      data-oysterun-partial-text-selection-preserved="true"
      data-oysterun-room-id={room.roomId}
      data-oysterun-event-id={eventId}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        Copy Message
      </Text>
    </MenuItem>
  );
});

export const MessageCopyDebugInfoItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const eventId = getOysterunServerMatrixEventId(mEvent);
  if (!eventId) return null;
  const debugInfoPayload = buildOysterunRouteCMessageDebugInfoPayload(room, mEvent, eventId);
  if (!debugInfoPayload) return null;
  const copyText = JSON.stringify(debugInfoPayload, null, 2);

  const handleCopy: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const copyRoot = evt.currentTarget.closest<HTMLElement>(
      OYSTERUN_ROUTE_C_CLIPBOARD_ROOT_SELECTOR
    );
    void writeOysterunRouteCMessageTextToClipboard(copyText, { copyRoot })
      .then(() => {
        onClose?.();
      })
      .catch((err: unknown) => {
        console.error('[oysterun-routec] Copy Debug Info clipboard write failed', {
          roomId: room.roomId,
          eventId,
          err,
        });
      });
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Code} />}
      radii="300"
      onClick={handleCopy}
      data-oysterun-message-operation="copy_debug_info"
      data-oysterun-debug-info-schema={OYSTERUN_ROUTE_C_MESSAGE_DEBUG_INFO_SCHEMA}
      data-oysterun-debug-info-no-body="true"
      data-oysterun-debug-info-icon-fallback="code"
      data-oysterun-debug-info-event-id-kind="server"
      data-oysterun-debug-info-safe-fields="host_origin host_session_id matrix_room_id matrix_event_id chat_focus_url event_type sender origin_server_ts event_id_kind"
      data-oysterun-debug-info-excludes="tokens cookies auth_headers local_paths message_body attachments tool_output provider_payloads runtime_artifacts"
      data-oysterun-copy-clipboard-helper={OYSTERUN_ROUTE_C_CLIPBOARD_HELPER_ID}
      data-oysterun-copy-text-length={copyText.length}
      data-oysterun-room-id={room.roomId}
      data-oysterun-event-id={eventId}
      data-oysterun-host-session-id={debugInfoPayload.host_session_id}
      data-oysterun-chat-focus-url={debugInfoPayload.chat_focus_url}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        Copy Debug Info
      </Text>
    </MenuItem>
  );
});

export const MessagePinItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const mx = useMatrixClient();
  const pinnedEvents = useRoomPinnedEvents(room);
  const isPinned = pinnedEvents.includes(mEvent.getId() ?? '');

  const handlePin = () => {
    const eventId = mEvent.getId();
    const pinContent: RoomPinnedEventsEventContent = {
      pinned: Array.from(pinnedEvents).filter((id) => id !== eventId),
    };
    if (!isPinned && eventId) {
      pinContent.pinned.push(eventId);
    }
    mx.sendStateEvent(room.roomId, StateEvent.RoomPinnedEvents as any, pinContent);
    onClose?.();
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Pin} />}
      radii="300"
      onClick={handlePin}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {isPinned ? 'Unpin Message' : 'Pin Message'}
      </Text>
    </MenuItem>
  );
});

export const MessageDeleteItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const mx = useMatrixClient();
  const [open, setOpen] = useState(false);

  const [deleteState, deleteMessage] = useAsyncCallback(
    useCallback(
      (eventId: string, reason?: string) =>
        mx.redactEvent(room.roomId, eventId, undefined, reason ? { reason } : undefined),
      [mx, room]
    )
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const eventId = mEvent.getId();
    if (
      !eventId ||
      deleteState.status === AsyncStatus.Loading ||
      deleteState.status === AsyncStatus.Success
    )
      return;
    const target = evt.target as HTMLFormElement | undefined;
    const reasonInput = target?.reasonInput as HTMLInputElement | undefined;
    const reason = reasonInput && reasonInput.value.trim();
    deleteMessage(eventId, reason);
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Dialog variant="Surface">
              <Header
                style={{
                  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                  borderBottomWidth: config.borderWidth.B300,
                }}
                variant="Surface"
                size="500"
              >
                <Box grow="Yes">
                  <Text size="H4">Delete Message</Text>
                </Box>
                <IconButton size="300" onClick={handleClose} radii="300">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <Box
                as="form"
                onSubmit={handleSubmit}
                style={{ padding: config.space.S400 }}
                direction="Column"
                gap="400"
              >
                <Text priority="400">
                  This action is irreversible! Are you sure that you want to delete this message?
                </Text>
                <Box direction="Column" gap="100">
                  <Text size="L400">
                    Reason{' '}
                    <Text as="span" size="T200">
                      (optional)
                    </Text>
                  </Text>
                  <Input name="reasonInput" variant="Background" />
                  {deleteState.status === AsyncStatus.Error && (
                    <Text style={{ color: color.Critical.Main }} size="T300">
                      Failed to delete message! Please try again.
                    </Text>
                  )}
                </Box>
                <Button
                  type="submit"
                  variant="Critical"
                  before={
                    deleteState.status === AsyncStatus.Loading ? (
                      <Spinner fill="Solid" variant="Critical" size="200" />
                    ) : undefined
                  }
                  aria-disabled={deleteState.status === AsyncStatus.Loading}
                >
                  <Text size="B400">
                    {deleteState.status === AsyncStatus.Loading ? 'Deleting...' : 'Delete'}
                  </Text>
                </Button>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <Button
        variant="Critical"
        fill="None"
        size="300"
        after={<Icon size="100" src={Icons.Delete} />}
        radii="300"
        onClick={() => setOpen(true)}
        aria-pressed={open}
        {...props}
        ref={ref}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Delete
        </Text>
      </Button>
    </>
  );
});

export const MessageReportItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const mx = useMatrixClient();
  const [open, setOpen] = useState(false);

  const [reportState, reportMessage] = useAsyncCallback(
    useCallback(
      (eventId: string, score: number, reason: string) =>
        mx.reportEvent(room.roomId, eventId, score, reason),
      [mx, room]
    )
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const eventId = mEvent.getId();
    if (
      !eventId ||
      reportState.status === AsyncStatus.Loading ||
      reportState.status === AsyncStatus.Success
    )
      return;
    const target = evt.target as HTMLFormElement | undefined;
    const reasonInput = target?.reasonInput as HTMLInputElement | undefined;
    const reason = reasonInput && reasonInput.value.trim();
    if (reasonInput) reasonInput.value = '';
    reportMessage(eventId, reason ? -100 : -50, reason || 'No reason provided');
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Dialog variant="Surface">
              <Header
                style={{
                  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                  borderBottomWidth: config.borderWidth.B300,
                }}
                variant="Surface"
                size="500"
              >
                <Box grow="Yes">
                  <Text size="H4">Report Message</Text>
                </Box>
                <IconButton size="300" onClick={handleClose} radii="300">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <Box
                as="form"
                onSubmit={handleSubmit}
                style={{ padding: config.space.S400 }}
                direction="Column"
                gap="400"
              >
                <Text priority="400">
                  Report this message to server, which may then notify the appropriate people to
                  take action.
                </Text>
                <Box direction="Column" gap="100">
                  <Text size="L400">Reason</Text>
                  <Input name="reasonInput" variant="Background" required />
                  {reportState.status === AsyncStatus.Error && (
                    <Text style={{ color: color.Critical.Main }} size="T300">
                      Failed to report message! Please try again.
                    </Text>
                  )}
                  {reportState.status === AsyncStatus.Success && (
                    <Text style={{ color: color.Success.Main }} size="T300">
                      Message has been reported to server.
                    </Text>
                  )}
                </Box>
                <Button
                  type="submit"
                  variant="Critical"
                  before={
                    reportState.status === AsyncStatus.Loading ? (
                      <Spinner fill="Solid" variant="Critical" size="200" />
                    ) : undefined
                  }
                  aria-disabled={
                    reportState.status === AsyncStatus.Loading ||
                    reportState.status === AsyncStatus.Success
                  }
                >
                  <Text size="B400">
                    {reportState.status === AsyncStatus.Loading ? 'Reporting...' : 'Report'}
                  </Text>
                </Button>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <Button
        variant="Critical"
        fill="None"
        size="300"
        after={<Icon size="100" src={Icons.Warning} />}
        radii="300"
        onClick={() => setOpen(true)}
        aria-pressed={open}
        {...props}
        ref={ref}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Report
        </Text>
      </Button>
    </>
  );
});

export type MessageProps = {
  room: Room;
  mEvent: MatrixEvent;
  collapse: boolean;
  highlight: boolean;
  edit?: boolean;
  canDelete?: boolean;
  canSendReaction?: boolean;
  canPinEvent?: boolean;
  imagePackRooms?: Room[];
  relations?: Relations;
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  onUserClick: MouseEventHandler<HTMLButtonElement>;
  onUsernameClick: MouseEventHandler<HTMLButtonElement>;
  onReplyClick: (
    ev: Parameters<MouseEventHandler<HTMLButtonElement>>[0],
    startThread?: boolean
  ) => void;
  onEditId?: (eventId?: string) => void;
  onReactionToggle: (targetEventId: string, key: string, shortcode?: string) => void;
  reply?: ReactNode;
  reactions?: ReactNode;
  hideReadReceipts?: boolean;
  showDeveloperTools?: boolean;
  memberPowerTag?: MemberPowerTag;
  accessibleTagColors?: Map<string, string>;
  legacyUsernameColor?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
  oysterunCancelControl?: OysterunHost2CancelControl;
  oysterunHost2IntakeProof?: OysterunHost2IntakeProof;
  oysterunProviderControlOutcome?: OysterunSemanticControlOutcome;
};
export const Message = as<'div', MessageProps>(
  (
    {
      className,
      room,
      mEvent,
      collapse,
      highlight,
      edit,
      canDelete,
      canSendReaction,
      canPinEvent,
      imagePackRooms,
      relations,
      messageLayout,
      messageSpacing,
      onUserClick,
      onUsernameClick,
      onReplyClick,
      onReactionToggle,
      onEditId,
      reply,
      reactions,
      hideReadReceipts,
      showDeveloperTools,
      memberPowerTag,
      accessibleTagColors,
      legacyUsernameColor,
      hour24Clock,
      dateFormatString,
      oysterunCancelControl,
      oysterunHost2IntakeProof,
      oysterunProviderControlOutcome,
      children,
      ...props
    },
    ref
  ) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const senderId = mEvent.getSender() ?? '';

    const [hover, setHover] = useState(false);
    const { hoverProps } = useHover({ onHoverChange: setHover });
    const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const [emojiBoardAnchor, setEmojiBoardAnchor] = useState<RectCords>();

    const senderDisplayName =
      getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
    const senderAvatarMxc = getMemberAvatarMxc(room, senderId);
    const routeCChatShell = Boolean(getOysterunHostSessionRouteSearch());
    const oysterunRouteCMessageAvatarSrc = routeCChatShell
      ? getOysterunRouteCMessageAvatarSrc({
          content: mEvent.getContent(),
          senderDisplayName,
        })
      : undefined;
    const senderAvatarSrc =
      oysterunRouteCMessageAvatarSrc ??
      (senderAvatarMxc
        ? mxcUrlToHttp(mx, senderAvatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined
        : undefined);

    const tagColor = memberPowerTag?.color
      ? accessibleTagColors?.get(memberPowerTag.color)
      : undefined;
    const tagIconSrc = memberPowerTag?.icon
      ? getPowerTagIconSrc(mx, useAuthentication, memberPowerTag.icon)
      : undefined;

    const usernameColor = legacyUsernameColor ? colorMXID(senderId) : tagColor;

    const headerJSX = !collapse && (
      <Box
        gap="300"
        direction={messageLayout === MessageLayout.Compact ? 'RowReverse' : 'Row'}
        justifyContent="SpaceBetween"
        alignItems="Baseline"
        grow="Yes"
      >
        <Box alignItems="Center" gap="200">
          <Username
            as="button"
            style={{ color: usernameColor }}
            data-user-id={senderId}
            onContextMenu={onUserClick}
            onClick={onUsernameClick}
          >
            <Text
              as="span"
              size={messageLayout === MessageLayout.Bubble ? 'T300' : 'T400'}
              truncate
            >
              <UsernameBold>{senderDisplayName}</UsernameBold>
            </Text>
          </Username>
          {tagIconSrc && <PowerIcon size="100" iconSrc={tagIconSrc} />}
        </Box>
        <Box shrink="No" gap="100">
          {messageLayout === MessageLayout.Modern && hover && (
            <>
              <Text as="span" size="T200" priority="300">
                {senderId}
              </Text>
              <Text as="span" size="T200" priority="300">
                |
              </Text>
            </>
          )}
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        </Box>
      </Box>
    );

    const showAvatar = messageLayout !== MessageLayout.Compact && (!collapse || routeCChatShell);
    const avatarJSX = showAvatar && (
      <AvatarBase
        className={messageLayout === MessageLayout.Bubble ? css.BubbleAvatarBase : undefined}
      >
        <Avatar
          className={css.MessageAvatar}
          as="button"
          size="300"
          data-user-id={senderId}
          data-oysterun-routec-avatar-collapse-policy={
            routeCChatShell ? 'show_avatar_on_every_message' : undefined
          }
          data-oysterun-clean-session-avatar-collapse-policy={
            routeCChatShell ? 'show_avatar_on_every_message' : undefined
          }
          data-oysterun-routec-static-avatar-src={oysterunRouteCMessageAvatarSrc}
          data-oysterun-clean-session-static-avatar-src={oysterunRouteCMessageAvatarSrc}
          onClick={onUserClick}
        >
          <UserAvatar
            userId={senderId}
            src={senderAvatarSrc}
            alt={senderDisplayName}
            renderFallback={() => <Icon size="200" src={Icons.User} filled />}
          />
        </Avatar>
      </AvatarBase>
    );

    const cancelControlJSX = (() => {
      if (!oysterunCancelControl) return null;
      const { proof, status, onCancel } = oysterunCancelControl;
      const targetUserEventId =
        proof.host2_receipt_target_event_id ?? proof.matrix_server_event_id ?? '';
      if (!targetUserEventId) return null;
      const sourceOwnedServerTarget =
        proof.host2_receipt_exact_user_event === true &&
        proof.source_user_event_id_raw_hash_kind === 'raw_event_id_sha256';
      const queuedPreStart =
        sourceOwnedServerTarget &&
        proof.host2_intake_state === 'host2_queued' &&
        proof.cancelable === true &&
        proof.agent_turn_started === false;
      if (status === 'ready' && !queuedPreStart) return null;
      const disabled = status !== 'ready';
      const label = (() => {
        if (status === 'canceling') return 'Canceling';
        if (status === 'accepted') return 'Canceled';
        if (status === 'too_late') return 'Started';
        if (status === 'error') return 'Cancel failed';
        return 'Cancel';
      })();
      return (
        <Box style={{ marginTop: config.space.S200 }} alignItems="Center" gap="200">
          <Button
            type="button"
            size="300"
            variant={status === 'accepted' ? 'Success' : 'Secondary'}
            fill="Soft"
            radii="300"
            disabled={disabled}
            aria-label={`Cancel queued delivery for Matrix event ${targetUserEventId}`}
            aria-disabled={disabled}
            title="Cancel queued delivery"
            data-testid="oysterun-routec-host2-cancel-button"
            data-oysterun-clean-session-testid="oysterun-clean-session-host2-cancel-button"
            data-oysterun-cancel-control="host2-intake"
            data-oysterun-cancel-control-owner="oysterun-app"
            data-oysterun-cancel-control-visible="true"
            data-oysterun-cancel-control-interactive={String(!disabled)}
            data-oysterun-cancel-control-enabled={String(!disabled)}
            data-oysterun-cancel-control-status={status}
            data-oysterun-event-id-kind="server"
            data-oysterun-target-user-event-id={targetUserEventId}
            data-oysterun-target-user-event-id-hash={
              proof.source_user_event_id_raw_hash ?? undefined
            }
            data-oysterun-target-user-event-id-hash-kind={
              proof.source_user_event_id_raw_hash_kind ?? 'raw_event_id_sha256'
            }
            data-oysterun-source-owned-target-event={String(sourceOwnedServerTarget)}
            data-oysterun-stale-target-event-id-used="false"
            data-oysterun-dom-only-pass-state="false"
            data-oysterun-host-session-id={proof.host_session_id}
            data-oysterun-room-id={proof.matrix_room_id}
            data-oysterun-host2-intake-state={proof.host2_intake_state}
            data-oysterun-agent-turn-started={String(proof.agent_turn_started === true)}
            data-oysterun-cancelable={String(proof.cancelable === true)}
            data-oysterun-cancel-outcome={proof.cancel_outcome ?? undefined}
            data-oysterun-control-request-id={proof.control_request_id ?? undefined}
            data-oysterun-control-outcome={proof.control_outcome ?? undefined}
            data-oysterun-cancel-request-semantic-hook-present={String(
              Boolean(proof.cancel_request_semantic_event_source_hook)
            )}
            data-oysterun-cancel-outcome-semantic-hook-present={String(
              Boolean(proof.cancel_outcome_semantic_event_source_hook)
            )}
            data-oysterun-provider-delivery-claimed={String(
              proof.provider_delivery_claimed === true
            )}
            data-oysterun-provider-delivery-attempted={String(
              proof.provider_delivery_attempted === true
            )}
            data-oysterun-provider-receives-canceled-user-event={
              typeof proof.provider_receives_canceled_user_event === 'boolean'
                ? String(proof.provider_receives_canceled_user_event)
                : undefined
            }
            data-oysterun-same-event-both-canceled-and-started={String(
              proof.same_event_both_canceled_and_started === true
            )}
            data-oysterun-duplicate-user-row-count={proof.duplicate_user_row_count ?? undefined}
            data-oysterun-phase1-pass-claimed="false"
            data-oysterun-closeout-readiness-claimed="false"
            onClick={() => onCancel(targetUserEventId)}
          >
            <Text as="span" size="T300">
              {label}
            </Text>
          </Button>
          {status === 'error' && oysterunCancelControl.error && (
            <Text as="span" size="T200" priority="300">
              {oysterunCancelControl.error}
            </Text>
          )}
        </Box>
      );
    })();

    const deliveryReceiptJSX = (() => {
      if (!routeCChatShell || !isOysterunRouteCUserTextEvent(mx.getUserId() ?? undefined, mEvent)) {
        return null;
      }
      const eventId = mEvent.getId() ?? undefined;
      const singleCheck = Boolean(eventId?.startsWith('$'));
      const doubleCheck = isOysterunHost2DoubleCheckProof(oysterunHost2IntakeProof, eventId);
      let label = 'Sending';
      if (doubleCheck) {
        label = 'Agent intake received';
      } else if (singleCheck) {
        label = 'Matrix accepted';
      }
      const icon = doubleCheck ? Icons.CheckTwice : Icons.Check;

      return (
        <Box
          as="span"
          style={{ marginTop: config.space.S100, minHeight: '1rem' }}
          alignSelf="End"
          alignItems="Center"
          gap="100"
          title={label}
          aria-label={label}
          data-testid="oysterun-routec-delivery-receipt"
          data-oysterun-clean-session-testid="oysterun-clean-session-delivery-receipt"
          data-oysterun-delivery-receipt-ui="cinny-check"
          data-oysterun-delivery-receipt-semantics="oysterun-host2-proof"
          data-oysterun-single-check={String(singleCheck)}
          data-oysterun-single-check-source="matrix_server_event_id"
          data-oysterun-double-check={String(doubleCheck)}
          data-oysterun-double-check-source="host2_agent_intake_matrix_correlated_receipt"
          data-oysterun-matrix-server-event-id={singleCheck ? eventId : undefined}
          data-oysterun-host2-receipt-target-event-id={
            oysterunHost2IntakeProof?.host2_receipt_target_event_id ?? undefined
          }
          data-oysterun-host2-intake-state={
            oysterunHost2IntakeProof?.host2_intake_state ?? undefined
          }
          data-oysterun-agent-turn-started={
            typeof oysterunHost2IntakeProof?.agent_turn_started === 'boolean'
              ? String(oysterunHost2IntakeProof.agent_turn_started)
              : undefined
          }
        >
          {singleCheck ? (
            <Icon
              size="100"
              src={icon}
              style={{
                color: doubleCheck ? color.Success.Main : color.Secondary.Main,
                opacity: doubleCheck ? 1 : config.opacity.P500,
              }}
            />
          ) : (
            <Spinner size="50" variant="Secondary" fill="Soft" />
          )}
        </Box>
      );
    })();

    const msgContentJSX = (
      <Box direction="Column" alignSelf="Start" style={{ maxWidth: '100%' }}>
        {reply}
        {edit && onEditId ? (
          <MessageEditor
            style={{
              maxWidth: '100%',
              width: '100vw',
            }}
            roomId={room.roomId}
            room={room}
            mEvent={mEvent}
            imagePackRooms={imagePackRooms}
            onCancel={() => onEditId()}
          />
        ) : (
          children
        )}
        {deliveryReceiptJSX}
        {cancelControlJSX}
        {reactions}
      </Box>
    );

    const handleContextMenu: MouseEventHandler<HTMLDivElement> = (evt) => {
      if (evt.altKey || !window.getSelection()?.isCollapsed || edit) return;
      const tag = (evt.target as any).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'a') return;
      evt.preventDefault();
      setMenuAnchor({
        x: evt.clientX,
        y: evt.clientY,
        width: 0,
        height: 0,
      });
    };

    const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setMenuAnchor(target.getBoundingClientRect());
    };

    const closeMenu = () => {
      setMenuAnchor(undefined);
    };

    const handleOpenEmojiBoard: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setEmojiBoardAnchor(target.getBoundingClientRect());
    };
    const handleAddReactions: MouseEventHandler<HTMLButtonElement> = () => {
      const rect = menuAnchor;
      closeMenu();
      // open it with timeout because closeMenu
      // FocusTrap will return focus from emojiBoard

      setTimeout(() => {
        setEmojiBoardAnchor(rect);
      }, 100);
    };

    const isThreadedMessage = mEvent.threadRootId !== undefined;
    const canCopyMessage = getOysterunCopyMessageText(mEvent).length > 0;
    const canCopyDebugInfo = Boolean(getOysterunServerMatrixEventId(mEvent));
    const routeCApprovedOperationAvailable =
      canCopyMessage || canCopyDebugInfo || Boolean(canPinEvent);

    return (
      <MessageBase
        className={classNames(css.MessageBase, className, {
          [css.MessageBaseBubbleCollapsed]: messageLayout === MessageLayout.Bubble && collapse,
        })}
        tabIndex={0}
        space={messageSpacing}
        collapse={collapse}
        highlight={highlight}
        selected={!!menuAnchor || !!emojiBoardAnchor}
        {...props}
        {...hoverProps}
        {...focusWithinProps}
        {...buildOysterunMessageProofAttributes(mEvent, room.roomId)}
        data-oysterun-provider-control-outcome-request-id={
          oysterunProviderControlOutcome?.controlRequestId
        }
        data-oysterun-provider-control-outcome={oysterunProviderControlOutcome?.controlOutcome}
        data-oysterun-provider-control-outcome-id={oysterunProviderControlOutcome?.controlOutcomeId}
        data-oysterun-provider-control-outcome-event-id={oysterunProviderControlOutcome?.eventId}
        data-oysterun-provider-control-outcome-matrix-event-sender={
          oysterunProviderControlOutcome?.matrixEventSender
        }
        data-oysterun-provider-control-outcome-sender-actor-key={
          oysterunProviderControlOutcome?.matrixEventSenderActorKey
        }
        data-oysterun-provider-control-outcome-sender-actor-kind={
          oysterunProviderControlOutcome?.matrixEventSenderActorKind
        }
        data-oysterun-provider-control-final-truth={
          oysterunProviderControlOutcome ? 'matrix_control_outcome' : undefined
        }
        ref={ref}
      >
        {!edit &&
          (hover || !!menuAnchor || !!emojiBoardAnchor) &&
          (!routeCChatShell || routeCApprovedOperationAvailable) && (
            <div className={css.MessageOptionsBase}>
              <Menu className={css.MessageOptionsBar} variant="SurfaceVariant">
                <Box gap="100">
                  {!routeCChatShell && canSendReaction && (
                    <PopOut
                      position="Bottom"
                      align={emojiBoardAnchor?.width === 0 ? 'Start' : 'End'}
                      offset={emojiBoardAnchor?.width === 0 ? 0 : undefined}
                      anchor={emojiBoardAnchor}
                      content={
                        <EmojiBoard
                          imagePackRooms={imagePackRooms ?? []}
                          returnFocusOnDeactivate={false}
                          allowTextCustomEmoji
                          onEmojiSelect={(key) => {
                            onReactionToggle(mEvent.getId()!, key);
                            setEmojiBoardAnchor(undefined);
                          }}
                          onCustomEmojiSelect={(mxc, shortcode) => {
                            onReactionToggle(mEvent.getId()!, mxc, shortcode);
                            setEmojiBoardAnchor(undefined);
                          }}
                          requestClose={() => {
                            setEmojiBoardAnchor(undefined);
                          }}
                        />
                      }
                    >
                      <IconButton
                        onClick={handleOpenEmojiBoard}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                        aria-pressed={!!emojiBoardAnchor}
                      >
                        <Icon src={Icons.SmilePlus} size="100" />
                      </IconButton>
                    </PopOut>
                  )}
                  {!routeCChatShell && (
                    <IconButton
                      onClick={onReplyClick}
                      data-event-id={mEvent.getId()}
                      variant="SurfaceVariant"
                      size="300"
                      radii="300"
                    >
                      <Icon src={Icons.ReplyArrow} size="100" />
                    </IconButton>
                  )}
                  {!routeCChatShell && !isThreadedMessage && (
                    <IconButton
                      onClick={(ev: React.MouseEvent<HTMLButtonElement>) => onReplyClick(ev, true)}
                      data-event-id={mEvent.getId()}
                      variant="SurfaceVariant"
                      size="300"
                      radii="300"
                    >
                      <Icon src={Icons.ThreadPlus} size="100" />
                    </IconButton>
                  )}
                  {!routeCChatShell &&
                    OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED &&
                    canEditEvent(mx, mEvent) &&
                    onEditId && (
                      <IconButton
                        onClick={() => onEditId(mEvent.getId())}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                      >
                        <Icon src={Icons.Pencil} size="100" />
                      </IconButton>
                    )}
                  <PopOut
                    anchor={menuAnchor}
                    position="Bottom"
                    align={menuAnchor?.width === 0 ? 'Start' : 'End'}
                    offset={menuAnchor?.width === 0 ? 0 : undefined}
                    content={
                      <FocusTrap
                        focusTrapOptions={{
                          initialFocus: false,
                          onDeactivate: () => setMenuAnchor(undefined),
                          clickOutsideDeactivates: true,
                          isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                          isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                          escapeDeactivates: stopPropagation,
                        }}
                      >
                        <Menu>
                          {!routeCChatShell && canSendReaction && (
                            <MessageQuickReactions
                              onReaction={(key, shortcode) => {
                                onReactionToggle(mEvent.getId()!, key, shortcode);
                                closeMenu();
                              }}
                            />
                          )}
                          <Box
                            direction="Column"
                            gap="100"
                            className={css.MessageMenuGroup}
                            data-oysterun-routec-copy-root="message-menu"
                            data-oysterun-clean-session-copy-root="message-menu"
                          >
                            {routeCChatShell && canCopyMessage && (
                              <MessageCopyMessageItem
                                room={room}
                                mEvent={mEvent}
                                onClose={closeMenu}
                              />
                            )}
                            {routeCChatShell && canCopyDebugInfo && (
                              <MessageCopyDebugInfoItem
                                room={room}
                                mEvent={mEvent}
                                onClose={closeMenu}
                              />
                            )}
                            {!routeCChatShell && canSendReaction && (
                              <MenuItem
                                size="300"
                                after={<Icon size="100" src={Icons.SmilePlus} />}
                                radii="300"
                                onClick={handleAddReactions}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  Add Reaction
                                </Text>
                              </MenuItem>
                            )}
                            {!routeCChatShell && relations && (
                              <MessageAllReactionItem
                                room={room}
                                relations={relations}
                                onClose={closeMenu}
                              />
                            )}
                            {!routeCChatShell && (
                              <MenuItem
                                size="300"
                                after={<Icon size="100" src={Icons.ReplyArrow} />}
                                radii="300"
                                data-event-id={mEvent.getId()}
                                onClick={(evt: any) => {
                                  onReplyClick(evt);
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  Reply
                                </Text>
                              </MenuItem>
                            )}
                            {!routeCChatShell && !isThreadedMessage && (
                              <MenuItem
                                size="300"
                                after={<Icon src={Icons.ThreadPlus} size="100" />}
                                radii="300"
                                data-event-id={mEvent.getId()}
                                onClick={(evt: any) => {
                                  onReplyClick(evt, true);
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  Reply in Thread
                                </Text>
                              </MenuItem>
                            )}
                            {!routeCChatShell &&
                              OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED &&
                              canEditEvent(mx, mEvent) &&
                              onEditId && (
                                <MenuItem
                                  size="300"
                                  after={<Icon size="100" src={Icons.Pencil} />}
                                  radii="300"
                                  data-event-id={mEvent.getId()}
                                  onClick={() => {
                                    onEditId(mEvent.getId());
                                    closeMenu();
                                  }}
                                >
                                  <Text
                                    className={css.MessageMenuItemText}
                                    as="span"
                                    size="T300"
                                    truncate
                                  >
                                    Edit Message
                                  </Text>
                                </MenuItem>
                              )}
                            {!routeCChatShell && !hideReadReceipts && (
                              <MessageReadReceiptItem
                                room={room}
                                eventId={mEvent.getId() ?? ''}
                                onClose={closeMenu}
                              />
                            )}
                            {!routeCChatShell && showDeveloperTools && (
                              <MessageSourceCodeItem
                                room={room}
                                mEvent={mEvent}
                                onClose={closeMenu}
                              />
                            )}
                            {!routeCChatShell && (
                              <MessageCopyLinkItem
                                room={room}
                                mEvent={mEvent}
                                onClose={closeMenu}
                              />
                            )}
                            {canPinEvent && (
                              <MessagePinItem room={room} mEvent={mEvent} onClose={closeMenu} />
                            )}
                          </Box>
                          {!routeCChatShell &&
                            ((!mEvent.isRedacted() && canDelete) ||
                              mEvent.getSender() !== mx.getUserId()) && (
                              <>
                                <Line size="300" />
                                <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                                  {!mEvent.isRedacted() && canDelete && (
                                    <MessageDeleteItem
                                      room={room}
                                      mEvent={mEvent}
                                      onClose={closeMenu}
                                    />
                                  )}
                                  {mEvent.getSender() !== mx.getUserId() && (
                                    <MessageReportItem
                                      room={room}
                                      mEvent={mEvent}
                                      onClose={closeMenu}
                                    />
                                  )}
                                </Box>
                              </>
                            )}
                        </Menu>
                      </FocusTrap>
                    }
                  >
                    <IconButton
                      variant="SurfaceVariant"
                      size="300"
                      radii="300"
                      onClick={handleOpenMenu}
                      aria-pressed={!!menuAnchor}
                    >
                      <Icon src={Icons.VerticalDots} size="100" />
                    </IconButton>
                  </PopOut>
                </Box>
              </Menu>
            </div>
          )}
        {messageLayout === MessageLayout.Compact && (
          <CompactLayout before={headerJSX} onContextMenu={handleContextMenu}>
            {msgContentJSX}
          </CompactLayout>
        )}
        {messageLayout === MessageLayout.Bubble && (
          <BubbleLayout before={avatarJSX} header={headerJSX} onContextMenu={handleContextMenu}>
            {msgContentJSX}
          </BubbleLayout>
        )}
        {messageLayout !== MessageLayout.Compact && messageLayout !== MessageLayout.Bubble && (
          <ModernLayout before={avatarJSX} onContextMenu={handleContextMenu}>
            {headerJSX}
            {msgContentJSX}
          </ModernLayout>
        )}
      </MessageBase>
    );
  }
);

export type EventProps = {
  room: Room;
  mEvent: MatrixEvent;
  highlight: boolean;
  canDelete?: boolean;
  messageSpacing: MessageSpacing;
  hideReadReceipts?: boolean;
  showDeveloperTools?: boolean;
};
export const Event = as<'div', EventProps>(
  (
    {
      className,
      room,
      mEvent,
      highlight,
      canDelete,
      messageSpacing,
      hideReadReceipts,
      showDeveloperTools,
      children,
      ...props
    },
    ref
  ) => {
    const mx = useMatrixClient();
    const [hover, setHover] = useState(false);
    const { hoverProps } = useHover({ onHoverChange: setHover });
    const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const stateEvent = typeof mEvent.getStateKey() === 'string';
    const routeCChatShell = Boolean(getOysterunHostSessionRouteSearch());

    const handleContextMenu: MouseEventHandler<HTMLDivElement> = (evt) => {
      if (routeCChatShell) return;
      if (evt.altKey || !window.getSelection()?.isCollapsed) return;
      const tag = (evt.target as any).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'a') return;
      evt.preventDefault();
      setMenuAnchor({
        x: evt.clientX,
        y: evt.clientY,
        width: 0,
        height: 0,
      });
    };

    const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setMenuAnchor(target.getBoundingClientRect());
    };

    const closeMenu = () => {
      setMenuAnchor(undefined);
    };

    return (
      <MessageBase
        className={classNames(css.MessageBase, className)}
        tabIndex={0}
        space={messageSpacing}
        autoCollapse
        highlight={highlight}
        selected={!!menuAnchor}
        {...props}
        {...hoverProps}
        {...focusWithinProps}
        ref={ref}
      >
        {!routeCChatShell && (hover || !!menuAnchor) && (
          <div className={css.MessageOptionsBase}>
            <Menu className={css.MessageOptionsBar} variant="SurfaceVariant">
              <Box gap="100">
                <PopOut
                  anchor={menuAnchor}
                  position="Bottom"
                  align={menuAnchor?.width === 0 ? 'Start' : 'End'}
                  offset={menuAnchor?.width === 0 ? 0 : undefined}
                  content={
                    <FocusTrap
                      focusTrapOptions={{
                        initialFocus: false,
                        onDeactivate: () => setMenuAnchor(undefined),
                        clickOutsideDeactivates: true,
                        isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                        isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                        escapeDeactivates: stopPropagation,
                      }}
                    >
                      <Menu {...props} ref={ref}>
                        <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                          {!hideReadReceipts && (
                            <MessageReadReceiptItem
                              room={room}
                              eventId={mEvent.getId() ?? ''}
                              onClose={closeMenu}
                            />
                          )}
                          {showDeveloperTools && (
                            <MessageSourceCodeItem
                              room={room}
                              mEvent={mEvent}
                              onClose={closeMenu}
                            />
                          )}
                          <MessageCopyLinkItem room={room} mEvent={mEvent} onClose={closeMenu} />
                        </Box>
                        {((!mEvent.isRedacted() && canDelete && !stateEvent) ||
                          (mEvent.getSender() !== mx.getUserId() && !stateEvent)) && (
                          <>
                            <Line size="300" />
                            <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                              {!mEvent.isRedacted() && canDelete && (
                                <MessageDeleteItem
                                  room={room}
                                  mEvent={mEvent}
                                  onClose={closeMenu}
                                />
                              )}
                              {mEvent.getSender() !== mx.getUserId() && (
                                <MessageReportItem
                                  room={room}
                                  mEvent={mEvent}
                                  onClose={closeMenu}
                                />
                              )}
                            </Box>
                          </>
                        )}
                      </Menu>
                    </FocusTrap>
                  }
                >
                  <IconButton
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    onClick={handleOpenMenu}
                    aria-pressed={!!menuAnchor}
                  >
                    <Icon src={Icons.VerticalDots} size="100" />
                  </IconButton>
                </PopOut>
              </Box>
            </Menu>
          </div>
        )}
        <div onContextMenu={handleContextMenu}>{children}</div>
      </MessageBase>
    );
  }
);
