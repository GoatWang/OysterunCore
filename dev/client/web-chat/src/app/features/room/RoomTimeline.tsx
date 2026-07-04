/* eslint-disable react/destructuring-assignment */
import React, {
  Dispatch,
  KeyboardEventHandler,
  MouseEventHandler,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Direction,
  EventTimeline,
  EventTimelineSet,
  EventTimelineSetHandlerMap,
  IContent,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import classNames from 'classnames';
import { ReactEditor } from 'slate-react';
import { Editor } from 'slate';
import { SessionMembershipData } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import to from 'await-to-js';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Badge,
  Box,
  Chip,
  ContainerColor,
  Icon,
  Icons,
  Line,
  Scroll,
  Text,
  as,
  color,
  config,
  toRem,
} from 'folds';
import { isKeyHotkey } from 'is-hotkey';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useTranslation } from 'react-i18next';
import { eventWithShortcode, factoryEventSentBy, getMxIdLocalPart } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useVirtualPaginator, ItemRange } from '../../hooks/useVirtualPaginator';
import { useAlive } from '../../hooks/useAlive';
import { editableActiveElement, isIntersectingScrollView, scrollToBottom } from '../../utils/dom';
import {
  DefaultPlaceholder,
  CompactPlaceholder,
  Reply,
  MessageBase,
  MessageUnsupportedContent,
  Time,
  MessageNotDecryptedContent,
  RedactedContent,
  MSticker,
  ImageContent,
  EventContent,
} from '../../components/message';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import {
  canEditEvent,
  decryptAllTimelineEvent,
  getEditedEvent,
  getEventReactions,
  getLatestEditableEvt,
  getMemberDisplayName,
  getReactionContent,
  isMembershipChanged,
  reactionOrEditEvent,
} from '../../utils/room';
import { useSetting } from '../../state/hooks/settings';
import { MessageLayout, settingsAtom } from '../../state/settings';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { Reactions, Message, Event, EncryptedContent } from './message';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomIntro } from '../../components/room-intro';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { markAsRead } from '../../utils/notifications';
import { useDebounce } from '../../hooks/useDebounce';
import { getResizeObserverEntry, useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from './RoomTimeline.css';
import { inSameDay, minuteDifference, timeDayMonthYear, today, yesterday } from '../../utils/time';
import { createMentionElement, isEmptyEditor, moveCursor } from '../../components/editor';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../types/matrix/room';
import { useKeyDown } from '../../hooks/useKeyDown';
import { useDocumentFocusChange } from '../../hooks/useDocumentFocusChange';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { buildOysterunTimelineRootProofAttributes } from '../../../oysterun/OysterunProofFields';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useTheme } from '../../hooks/useTheme';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import {
  cancelOysterunHost2Intake,
  commitOysterunCancelSemanticSourceHooks,
  getOysterunHostSessionChatPath,
  getOysterunHostSessionBrowserPathOrTargetFallback,
  getOysterunHostSessionRouteSearch,
  recordOysterunCancelControlProof,
  subscribeOysterunActiveRoomTimelineFocus,
} from '../../../oysterun/OysterunHostClient';
import {
  isOysterunCancelControlRenderStatus,
  isOysterunHost2CancelableProof,
  rememberOysterunHost2IntakeProof,
  useOysterunHost2CancelControlPolling,
  type OysterunHost2CancelControlState,
  type OysterunRouteCRespondingState,
} from '../../../oysterun/OysterunMessageLifecycle';
import { isOysterunCapacitorIOSRuntime } from '../../../oysterun/OysterunNotificationRuntime';
import type {
  OysterunSemanticControlOutcome,
  OysterunSemanticPayload,
  OysterunToolCompression,
  OysterunToolCompressionDetail,
} from '../../../oysterun/OysterunSemanticRenderer';
import {
  isOysterunProviderCompletionMarkerContent,
  isOysterunToolSemanticType,
} from '../../../oysterun/OysterunSemanticRenderer';

const OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED = false;
const OYSTERUN_SEMANTIC_NAMESPACE = 'org.oysterun.semantic.v1';
const OYSTERUN_HOST2_CANCEL_CANDIDATE_LIMIT = 10;
const OYSTERUN_HOST2_CANCEL_RENDERED_CANDIDATE_LIMIT = 20;
const OYSTERUN_ROUTE_C_EMPTY_COMPOSER_GUIDANCE_ROWS = [
  { key: '@', description: 'Path autocomplete' },
  { key: '/', description: 'Oysterun commands' },
  { key: '!', description: 'Run terminal command' },
  { key: '!!', description: 'Stop current task' },
] as const;

const TimelineFloat = as<'div', css.TimelineFloatVariants>(
  ({ position, className, ...props }, ref) => (
    <Box
      className={classNames(css.TimelineFloat({ position }), className)}
      justifyContent="Center"
      alignItems="Center"
      gap="200"
      {...props}
      ref={ref}
    />
  )
);

const TimelineDivider = as<'div', { variant?: ContainerColor | 'Inherit' }>(
  ({ variant, children, ...props }, ref) => (
    <Box gap="100" justifyContent="Center" alignItems="Center" {...props} ref={ref}>
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
      {children}
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
    </Box>
  )
);

type RouteCEmptyComposerGuidanceProps = {
  displayItemsLength: number;
  displayRange: ItemRange;
};

function RouteCEmptyComposerGuidance({
  displayItemsLength,
  displayRange,
}: RouteCEmptyComposerGuidanceProps) {
  return (
    <Box
      direction="Column"
      alignItems="Center"
      justifyContent="Center"
      style={{
        flexGrow: 1,
        minHeight: toRem(160),
        padding: `${config.space.S700} ${config.space.S400}`,
      }}
      data-testid="oysterun-routec-empty-composer-guidance"
      data-oysterun-clean-session-testid="oysterun-clean-session-empty-composer-guidance"
      data-oysterun-routec-empty-guidance="composer"
      data-oysterun-clean-session-empty-guidance="composer"
      data-oysterun-routec-empty-guidance-display-items={String(displayItemsLength)}
      data-oysterun-clean-session-empty-guidance-display-items={String(displayItemsLength)}
      data-oysterun-routec-empty-guidance-range={`${displayRange.start}-${displayRange.end}`}
      data-oysterun-clean-session-empty-guidance-range={`${displayRange.start}-${displayRange.end}`}
    >
      <Box
        direction="Column"
        gap="300"
        style={{
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: toRem(320),
          padding: `${config.space.S400} ${config.space.S500}`,
          border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
          borderRadius: config.radii.R400,
          backgroundColor: color.SurfaceVariant.Container,
          color: color.SurfaceVariant.OnContainer,
        }}
      >
        <Text size="T200" priority="400">
          Use the composer below to start.
        </Text>
        <Box direction="Column" gap="100">
          {OYSTERUN_ROUTE_C_EMPTY_COMPOSER_GUIDANCE_ROWS.map((row) => (
            <Box
              key={row.key}
              alignItems="Center"
              gap="300"
              data-oysterun-routec-empty-guidance-key={row.key}
              data-oysterun-clean-session-empty-guidance-key={row.key}
            >
              <Text
                as="span"
                size="T200"
                priority="500"
                style={{
                  width: toRem(28),
                  flexShrink: 0,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  lineHeight: toRem(18),
                }}
              >
                {row.key}
              </Text>
              <Text as="span" size="T200" priority="300">
                {row.description}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export const getLiveTimeline = (room: Room): EventTimeline =>
  room.getUnfilteredTimelineSet().getLiveTimeline();

export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined => {
  const timelineSet = room.getUnfilteredTimelineSet();
  return timelineSet.getTimelineForEvent(eventId) ?? undefined;
};

export const getFirstLinkedTimeline = (
  timeline: EventTimeline,
  direction: Direction
): EventTimeline => {
  const linkedTm = timeline.getNeighbouringTimeline(direction);
  if (!linkedTm) return timeline;
  return getFirstLinkedTimeline(linkedTm, direction);
};

export const getLinkedTimelines = (timeline: EventTimeline): EventTimeline[] => {
  const firstTimeline = getFirstLinkedTimeline(timeline, Direction.Backward);
  const timelines: EventTimeline[] = [];

  for (
    let nextTimeline: EventTimeline | null = firstTimeline;
    nextTimeline;
    nextTimeline = nextTimeline.getNeighbouringTimeline(Direction.Forward)
  ) {
    timelines.push(nextTimeline);
  }
  return timelines;
};

export const timelineToEventsCount = (t: EventTimeline) => t.getEvents().length;
export const getTimelinesEventsCount = (timelines: EventTimeline[]): number => {
  const timelineEventCountReducer = (count: number, tm: EventTimeline) =>
    count + timelineToEventsCount(tm);
  return timelines.reduce(timelineEventCountReducer, 0);
};

export const getTimelineAndBaseIndex = (
  timelines: EventTimeline[],
  index: number
): [EventTimeline | undefined, number] => {
  let uptoTimelineLen = 0;
  const timeline = timelines.find((t) => {
    uptoTimelineLen += t.getEvents().length;
    if (index < uptoTimelineLen) return true;
    return false;
  });
  if (!timeline) return [undefined, 0];
  return [timeline, uptoTimelineLen - timeline.getEvents().length];
};

export const getTimelineRelativeIndex = (absoluteIndex: number, timelineBaseIndex: number) =>
  absoluteIndex - timelineBaseIndex;

export const getTimelineEvent = (timeline: EventTimeline, index: number): MatrixEvent | undefined =>
  timeline.getEvents()[index];

export const getEventIdAbsoluteIndex = (
  timelines: EventTimeline[],
  eventTimeline: EventTimeline,
  eventId: string
): number | undefined => {
  const timelineIndex = timelines.findIndex((t) => t === eventTimeline);
  if (timelineIndex === -1) return undefined;
  const eventIndex = eventTimeline.getEvents().findIndex((evt) => evt.getId() === eventId);
  if (eventIndex === -1) return undefined;
  const baseIndex = timelines
    .slice(0, timelineIndex)
    .reduce((accValue, timeline) => timeline.getEvents().length + accValue, 0);
  return baseIndex + eventIndex;
};

type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  roomInputRef: RefObject<HTMLElement>;
  editor: Editor;
  routeCRespondingState: OysterunRouteCRespondingState;
};

const PAGINATION_LIMIT = 80;
// Keep Cinny's bottom anchor semantics, plus a small Route C distance tolerance for heavy renders.
const OYSTERUN_ROUTE_C_BOTTOM_ANCHOR_ROOT_MARGIN = '100px';
const OYSTERUN_ROUTE_C_NEAR_BOTTOM_THRESHOLD_PX = 160;
const OYSTERUN_ROUTE_C_PROGRAMMATIC_SCROLL_GUARD_MS = 300;
const OYSTERUN_ROUTE_C_IOS_SCROLL_PAINT_NUDGE_PX = 1;
const OYSTERUN_ROUTE_C_INITIAL_BOTTOM_SETTLE_MS = 1500;
const OYSTERUN_ROUTE_C_REMOTE_PAGINATION_SETTLE_MS = 600;
const OYSTERUN_ROUTE_C_COMPRESSED_TOOL_PLACEHOLDER_HEIGHT_PX = 0.25;
const OYSTERUN_ROUTE_C_DENSE_TOOL_PAGINATION_MAX_LIMIT = 240;
const OYSTERUN_ROUTE_C_DENSE_TOOL_PAGINATION_PADDING = 16;
const OYSTERUN_ROUTE_C_LOW_VISIBLE_PROGRESS_RETRY_LIMIT = 2;
const OYSTERUN_ROUTE_C_LOW_VISIBLE_PROGRESS_THRESHOLD_PX = 96;
const OYSTERUN_ROUTE_C_LOW_VISIBLE_PROGRESS_PLACEHOLDER_RATIO = 0.75;
const OYSTERUN_ROUTE_C_ESTIMATED_MATRIX_EVENT_PROGRESS_PX = 64;
const OYSTERUN_ROUTE_C_ESTIMATED_DIVIDER_PROGRESS_PX = 24;
const OYSTERUN_ROUTE_C_ESTIMATED_COMPRESSED_GROUP_PROGRESS_PX = 24;
const OYSTERUN_ROUTE_C_TOOL_OUTPUT_BATCH_SIZE = 10;
const OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR = 'a[data-oysterun-inline-link-kind]';
const OYSTERUN_ROUTE_C_LOCAL_PATH_DISCLOSURE_SELECTOR =
  `${OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR}[data-oysterun-local-path-disclosure]`;

type OysterunRouteCInlineLinkKind =
  | 'file_preview_link'
  | 'directory_link'
  | 'browser_link'
  | 'external_url';

function isOysterunRouteCInlineLinkKind(
  value: string | null
): value is OysterunRouteCInlineLinkKind {
  return (
    value === 'file_preview_link' ||
    value === 'directory_link' ||
    value === 'browser_link' ||
    value === 'external_url'
  );
}

function isOysterunCleanSessionRoutePath(
  pathname: string,
  expectedSurface: 'file-preview' | 'explorer'
): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return (
    parts.length === 4 &&
    parts[0] === 'app' &&
    parts[1] === 'sessions' &&
    parts[3] === expectedSurface
  );
}

function readOysterunRouteCInlineLinkTarget(
  anchor: HTMLAnchorElement,
  kind: OysterunRouteCInlineLinkKind
): string | undefined {
  if (kind === 'external_url') return undefined;
  const rawTarget =
    anchor.getAttribute('data-oysterun-inline-link-target') || anchor.getAttribute('href');
  if (!rawTarget) return undefined;
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawTarget, window.location.origin);
  } catch {
    return undefined;
  }
  if (targetUrl.origin !== window.location.origin) return undefined;

  if (kind === 'file_preview_link') {
    if (!isOysterunCleanSessionRoutePath(targetUrl.pathname, 'file-preview')) return undefined;
    if (!targetUrl.searchParams.get('path')?.trim()) return undefined;
    if ((targetUrl.searchParams.get('mode') || 'rendered') !== 'rendered') return undefined;
    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  }
  if (kind === 'directory_link') {
    if (!isOysterunCleanSessionRoutePath(targetUrl.pathname, 'explorer')) return undefined;
    if (!targetUrl.searchParams.get('path')?.trim()) return undefined;
    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  }
  if (kind === 'browser_link') {
    if (!targetUrl.pathname.startsWith('/sites/')) return undefined;
    const routeCSiteTarget = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    if (isOysterunCapacitorIOSRuntime()) {
      return getOysterunHostSessionBrowserPathOrTargetFallback(routeCSiteTarget);
    }
    return routeCSiteTarget;
  }
  return undefined;
}

function openOysterunRouteCInlineLinkTarget(routeTarget: string): void {
  if (isOysterunCapacitorIOSRuntime()) {
    window.location.assign(routeTarget);
    return;
  }
  window.open(new URL(routeTarget, window.location.origin).toString(), '_blank', 'noopener,noreferrer');
}

function isOysterunLocalPathDisclosureKind(kind: string | null): boolean {
  return kind === 'file_preview_link' || kind === 'directory_link';
}

function collapseOysterunLocalPathLink(anchor: HTMLAnchorElement): boolean {
  const link = anchor;
  if (link.getAttribute('data-oysterun-inline-link-expanded') !== 'true') return false;
  resetOysterunLocalPathLink(anchor);
  return true;
}

function resetOysterunLocalPathLink(anchor: HTMLAnchorElement): boolean {
  const link = anchor;
  const collapsedText = link.getAttribute('data-oysterun-inline-link-collapsed-text');
  const previousText = link.textContent;
  const previousExpanded = link.getAttribute('data-oysterun-inline-link-expanded');
  if (collapsedText && previousText !== collapsedText) link.textContent = collapsedText;
  link.setAttribute('data-oysterun-inline-link-expanded', 'false');
  link.setAttribute('aria-expanded', 'false');
  return previousText !== link.textContent || previousExpanded !== 'false';
}

function expandOysterunLocalPathLink(anchor: HTMLAnchorElement): void {
  const link = anchor;
  const expandedText = link.getAttribute('data-oysterun-inline-link-expanded-text');
  if (expandedText) link.textContent = expandedText;
  link.setAttribute('data-oysterun-inline-link-expanded', 'true');
  link.setAttribute('aria-expanded', 'true');
}

function collapseOysterunLocalPathLinks(root: Element, except?: HTMLAnchorElement): boolean {
  let collapsed = false;
  root
    .querySelectorAll<HTMLAnchorElement>(
      `${OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR}[data-oysterun-inline-link-expanded="true"]`
    )
    .forEach((anchor) => {
      if (anchor !== except && collapseOysterunLocalPathLink(anchor)) {
        collapsed = true;
      }
    });
  return collapsed;
}

function resetOysterunLocalPathLinks(root: Element): boolean {
  let reset = false;
  root
    .querySelectorAll<HTMLAnchorElement>(OYSTERUN_ROUTE_C_LOCAL_PATH_DISCLOSURE_SELECTOR)
    .forEach((anchor) => {
      if (resetOysterunLocalPathLink(anchor)) {
        reset = true;
      }
    });
  return reset;
}

function isOysterunLocalPathDisclosureDeadArea(target: Element): boolean {
  return !target.closest(
    [
      OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR,
      'a',
      'button',
      'input',
      'textarea',
      'select',
      'summary',
      '[role="button"]',
      '[role="menu"]',
      '[role="menuitem"]',
      '[role="dialog"]',
      '[contenteditable="true"]',
    ].join(',')
  );
}

type Timeline = {
  linkedTimelines: EventTimeline[];
  range: ItemRange;
  displayModelRevision: number;
};

type RouteCDisplayTimelineEventItem = {
  kind: 'matrix_event' | 'compressed_tool_group' | 'compressed_tool_placeholder';
  id: string;
  displayIndex: number;
  rawEventIndex: number;
  rawStartIndex: number;
  rawEndIndex: number;
  eventTimeline: EventTimeline;
  timelineSet: EventTimelineSet;
  mEvent: MatrixEvent;
  mEventId: string;
  collapse: boolean;
  sourceEventIds: string[];
  oysterunToolCompression?: OysterunToolCompression;
};

type RouteCDisplayTimelineDividerItem = {
  kind: 'day_divider' | 'new_messages_divider';
  id: string;
  displayIndex: number;
  sourceEventId: string;
  ts: number;
};

type RouteCDisplayTimelineItem = RouteCDisplayTimelineEventItem | RouteCDisplayTimelineDividerItem;

type RouteCDisplayTimelineItemInput =
  | Omit<RouteCDisplayTimelineEventItem, 'displayIndex'>
  | Omit<RouteCDisplayTimelineDividerItem, 'displayIndex'>;

type RouteCDisplayTimelineModel = {
  items: RouteCDisplayTimelineItem[];
  displayIndexByEventId: Map<string, number>;
  rawEventIndexByEventId: Map<string, number>;
  rawEventIndexToDisplayIndex: Map<number, number>;
  compressedToolGroupCount: number;
};

type RouteCDisplayTimelineBuildOptions = {
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  readUptoEventId: string | undefined;
  currentUserId: string | null;
};

function isRouteCDisplayTimelineEventItem(
  item: RouteCDisplayTimelineItem
): item is RouteCDisplayTimelineEventItem {
  return (
    item.kind === 'matrix_event' ||
    item.kind === 'compressed_tool_group' ||
    item.kind === 'compressed_tool_placeholder'
  );
}

function isOysterunCancelableUserTextEvent(mx: MatrixClient, mEvent: MatrixEvent): boolean {
  const eventId = mEvent.getId();
  if (!eventId || !eventId.startsWith('$')) return false;
  if (mEvent.getType() !== MessageEvent.RoomMessage) return false;
  if (mEvent.getSender() !== mx.getUserId()) return false;
  const content = mEvent.getContent();
  if (content?.[OYSTERUN_SEMANTIC_NAMESPACE]) return false;
  if (content?.msgtype !== 'm.text') return false;
  return typeof content?.body === 'string' && content.body.trim().length > 0;
}

function oysterunUniqueEventIds(eventIds: string[]): string[] {
  return Array.from(new Set(eventIds));
}

function isOysterunEventId(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function collectOysterunHost2TimelineCandidateEventIds(
  mx: MatrixClient,
  linkedTimelines: EventTimeline[]
): string[] {
  return oysterunUniqueEventIds(
    linkedTimelines.flatMap((linkedTimeline) =>
      linkedTimeline
        .getEvents()
        .filter((candidateEvent) => isOysterunCancelableUserTextEvent(mx, candidateEvent))
        .map((candidateEvent) => candidateEvent.getId())
        .filter(isOysterunEventId)
    )
  );
}

function collectOysterunHost2RenderedCandidateEventIds(
  mx: MatrixClient,
  renderedDisplayItems: RouteCDisplayTimelineItem[]
): string[] {
  return oysterunUniqueEventIds(
    renderedDisplayItems
      .filter(isRouteCDisplayTimelineEventItem)
      .map((item) => {
        const candidateEvent = item.mEvent;
        if (!candidateEvent || !isOysterunCancelableUserTextEvent(mx, candidateEvent)) {
          return undefined;
        }
        return candidateEvent.getId();
      })
      .filter(isOysterunEventId)
  );
}

function getOysterunEventSemanticPayload(mEvent: MatrixEvent): OysterunSemanticPayload | undefined {
  const content = mEvent.getContent();
  const payload = content?.[OYSTERUN_SEMANTIC_NAMESPACE];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return payload as OysterunSemanticPayload;
}

function getOysterunToolPayloadValue(
  payload: OysterunSemanticPayload,
  semanticType: string
): unknown {
  if (semanticType === 'tool.call') return payload.tool_input;
  return payload.tool_content ?? payload.tool_input;
}

function getOysterunToolCompressionDetail(
  mEvent: MatrixEvent
): OysterunToolCompressionDetail | undefined {
  if (mEvent.getType() !== MessageEvent.RoomMessage || mEvent.isRedacted()) return undefined;
  const payload = getOysterunEventSemanticPayload(mEvent);
  if (!payload) return undefined;
  const semanticType = payload.semantic_type ?? payload.semantic_category;
  if (typeof semanticType !== 'string' || !isOysterunToolSemanticType(semanticType)) {
    return undefined;
  }
  return {
    eventId: mEvent.getId() ?? undefined,
    semanticId: typeof payload?.semantic_id === 'string' ? payload.semantic_id : undefined,
    semanticType,
    hostSessionId:
      typeof payload?.host_session_id === 'string' ? payload.host_session_id : undefined,
    matrixRoomId: typeof payload?.matrix_room_id === 'string' ? payload.matrix_room_id : undefined,
    targetTurnId: typeof payload?.target_turn_id === 'string' ? payload.target_turn_id : undefined,
    providerTurnId:
      typeof payload?.provider_turn_id === 'string' ? payload.provider_turn_id : undefined,
    providerTurnIdKind:
      typeof payload?.provider_turn_id_kind === 'string'
        ? payload.provider_turn_id_kind
        : undefined,
    toolName: typeof payload?.tool_name === 'string' ? payload.tool_name : undefined,
    toolCallId: typeof payload?.tool_call_id === 'string' ? payload.tool_call_id : undefined,
    toolIsError: typeof payload?.tool_is_error === 'boolean' ? payload.tool_is_error : null,
    payload: getOysterunToolPayloadValue(payload, semanticType),
    fallbackBody:
      typeof mEvent.getContent().body === 'string' ? String(mEvent.getContent().body) : undefined,
    matrixEventSender:
      typeof payload?.matrix_event_sender === 'string'
        ? payload.matrix_event_sender
        : mEvent.getSender() ?? undefined,
    matrixEventSenderActorKey:
      typeof payload?.matrix_event_sender_actor_key === 'string'
        ? payload.matrix_event_sender_actor_key
        : undefined,
    matrixEventSenderActorKind:
      typeof payload?.matrix_event_sender_actor_kind === 'string'
        ? payload.matrix_event_sender_actor_kind
        : undefined,
    detailAvailable:
      payload?.tool_detail_available === true || payload?.detail_available === true,
    detailStorageKind:
      typeof payload?.tool_detail_storage_kind === 'string'
        ? payload.tool_detail_storage_kind
        : undefined,
    toolTransferProjection: payload?.tool_transfer_projection,
    ts: mEvent.getTs(),
  };
}

type OysterunToolCompressionGroupKey = {
  kind: 'provider_turn_id' | 'target_turn_id' | 'matrix_event_sender';
  value: string;
};

function buildOysterunToolCompression({
  details,
  retainedRunDetails,
  toolGroupKey,
  compressionKind = 'tool_semantic_stream_page',
  batchIndex,
  batchCount,
  batchSize,
  batchStartIndex,
  batchEndIndex,
}: {
  details: OysterunToolCompressionDetail[];
  retainedRunDetails?: OysterunToolCompressionDetail[];
  toolGroupKey: OysterunToolCompressionGroupKey;
  compressionKind?: OysterunToolCompression['compressionKind'];
  batchIndex?: number;
  batchCount?: number;
  batchSize?: number;
  batchStartIndex?: number;
  batchEndIndex?: number;
}): OysterunToolCompression {
  const currentDetail = details[0];
  return {
    compressionKind,
    totalCount: details.length,
    compressedCount: Math.max(0, details.length - 1),
    groupStartEventId: details[0]?.eventId,
    groupEndEventId: details[details.length - 1]?.eventId,
    groupingKeyKind: toolGroupKey.kind,
    groupingKey: toolGroupKey.value,
    batchIndex,
    batchCount,
    batchSize,
    batchStartIndex,
    batchEndIndex,
    providerTurnId: currentDetail?.providerTurnId,
    providerTurnIdKind: currentDetail?.providerTurnIdKind,
    matrixEventSender: currentDetail?.matrixEventSender,
    matrixEventSenderActorKey: currentDetail?.matrixEventSenderActorKey,
    matrixEventSenderActorKind: currentDetail?.matrixEventSenderActorKind,
    details,
    retainedRunDetails,
  };
}

function getOysterunToolCompressionGroupKey(
  mEvent: MatrixEvent
): OysterunToolCompressionGroupKey | undefined {
  const detail = getOysterunToolCompressionDetail(mEvent);
  if (!detail) return undefined;
  if (detail.providerTurnId) {
    return {
      kind: 'provider_turn_id',
      value: detail.providerTurnId,
    };
  }
  if (detail.targetTurnId) {
    return {
      kind: 'target_turn_id',
      value: detail.targetTurnId,
    };
  }
  const sender = detail.matrixEventSender || mEvent.getSender() || '';
  if (!sender) return undefined;
  return {
    kind: 'matrix_event_sender',
    value: sender,
  };
}

function isSameOysterunToolRunEvent(
  mEvent: MatrixEvent | undefined,
  groupKey: OysterunToolCompressionGroupKey
): boolean {
  if (!mEvent) return false;
  const candidateKey = getOysterunToolCompressionGroupKey(mEvent);
  return candidateKey?.kind === groupKey.kind && candidateKey.value === groupKey.value;
}

function collectOysterunProviderControlOutcomes(
  linkedTimelines: EventTimeline[]
): Record<string, OysterunSemanticControlOutcome> {
  const outcomes: Record<string, OysterunSemanticControlOutcome> = {};
  linkedTimelines.forEach((linkedTimeline) => {
    linkedTimeline.getEvents().forEach((mEvent) => {
      if (mEvent.getType() !== MessageEvent.RoomMessage) return;
      const payload = getOysterunEventSemanticPayload(mEvent);
      if (!payload) return;
      const semanticType = payload.semantic_type ?? payload.semantic_category;
      if (semanticType !== 'control.outcome') return;
      const controlRequestId =
        typeof payload.control_request_id === 'string' && payload.control_request_id.trim()
          ? payload.control_request_id.trim()
          : '';
      let controlOutcome = '';
      if (typeof payload.control_outcome === 'string' && payload.control_outcome.trim()) {
        controlOutcome = payload.control_outcome.trim();
      } else if (typeof payload.outcome === 'string' && payload.outcome.trim()) {
        controlOutcome = payload.outcome.trim();
      }
      if (!controlRequestId || !controlOutcome) return;
      outcomes[controlRequestId] = {
        controlRequestId,
        controlOutcome,
        controlOutcomeId:
          typeof payload.control_outcome_id === 'string' ? payload.control_outcome_id : undefined,
        semanticId: typeof payload.semantic_id === 'string' ? payload.semantic_id : undefined,
        matrixRoomId:
          typeof payload.matrix_room_id === 'string' ? payload.matrix_room_id : undefined,
        hostSessionId:
          typeof payload.host_session_id === 'string' ? payload.host_session_id : undefined,
        eventId: mEvent.getId() ?? undefined,
        actor: typeof payload.actor === 'string' ? payload.actor : undefined,
        matrixEventSender:
          typeof payload.matrix_event_sender === 'string' ? payload.matrix_event_sender : undefined,
        matrixEventSenderActorKey:
          typeof payload.matrix_event_sender_actor_key === 'string'
            ? payload.matrix_event_sender_actor_key
            : undefined,
        matrixEventSenderActorKind:
          typeof payload.matrix_event_sender_actor_kind === 'string'
            ? payload.matrix_event_sender_actor_kind
            : undefined,
        replayPolicy: typeof payload.replay_policy === 'string' ? payload.replay_policy : undefined,
        durable: typeof payload.durable === 'boolean' ? payload.durable : undefined,
      };
    });
  });
  return outcomes;
}

function getOysterunProviderControlOutcomeForEvent(
  mEvent: MatrixEvent,
  outcomes: Record<string, OysterunSemanticControlOutcome>
): OysterunSemanticControlOutcome | undefined {
  if (mEvent.getType() !== MessageEvent.RoomMessage) return undefined;
  const payload = getOysterunEventSemanticPayload(mEvent);
  if (!payload) return undefined;
  const semanticType = payload.semantic_type ?? payload.semantic_category;
  if (semanticType !== 'control.request') return undefined;
  const controlRequestId =
    typeof payload.control_request_id === 'string' && payload.control_request_id.trim()
      ? payload.control_request_id.trim()
      : '';
  if (!controlRequestId) return undefined;
  return outcomes[controlRequestId];
}

type RouteCDisplayTimelineSourceEvent = {
  rawEventIndex: number;
  eventTimeline: EventTimeline;
  timelineSet: EventTimelineSet;
  mEvent: MatrixEvent;
  mEventId: string;
};

function getOysterunRetainedToolRunDetails(
  sourceEvents: RouteCDisplayTimelineSourceEvent[],
  sourceIndex: number,
  toolGroupKey: OysterunToolCompressionGroupKey,
  isRenderableSourceEvent: (sourceEvent: RouteCDisplayTimelineSourceEvent) => boolean
): OysterunToolCompressionDetail[] {
  const anchorEvent = sourceEvents[sourceIndex];
  if (!anchorEvent) return [];
  const isRetainedRunSourceEvent = (candidate: RouteCDisplayTimelineSourceEvent) =>
    candidate.eventTimeline === anchorEvent.eventTimeline &&
    isRenderableSourceEvent(candidate) &&
    isSameOysterunToolRunEvent(candidate.mEvent, toolGroupKey) &&
    getOysterunToolCompressionDetail(candidate.mEvent) !== undefined;
  const reverseBeforeIndexes = sourceEvents
    .slice(0, sourceIndex)
    .map((_, offset) => sourceIndex - 1 - offset);
  const firstBreakBeforeIndex = reverseBeforeIndexes.find(
    (index) => !isRetainedRunSourceEvent(sourceEvents[index])
  );
  const startIndex = firstBreakBeforeIndex === undefined ? 0 : firstBreakBeforeIndex + 1;
  const forwardIndexes = sourceEvents.slice(sourceIndex).map((_, offset) => sourceIndex + offset);
  const firstBreakAfterIndex = forwardIndexes.find(
    (index) => !isRetainedRunSourceEvent(sourceEvents[index])
  );
  const endIndex = firstBreakAfterIndex === undefined ? sourceEvents.length : firstBreakAfterIndex;
  return sourceEvents
    .slice(startIndex, endIndex)
    .map((sourceEvent) => getOysterunToolCompressionDetail(sourceEvent.mEvent))
    .filter((detail): detail is OysterunToolCompressionDetail => detail !== undefined);
}

function isRouteCRenderableTimelineEvent({
  mEvent,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
}: {
  mEvent: MatrixEvent;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
}): boolean {
  const eventSender = mEvent.getSender();
  if (eventSender && ignoredUsersSet.has(eventSender)) return false;
  if (mEvent.isRedacted() && !showHiddenEvents) return false;
  if (reactionOrEditEvent(mEvent)) return false;
  if (isOysterunProviderCompletionMarkerContent(mEvent.getContent())) return false;

  switch (mEvent.getType()) {
    case MessageEvent.RoomMessage:
    case MessageEvent.RoomMessageEncrypted:
    case MessageEvent.Sticker:
    case StateEvent.RoomName:
    case StateEvent.RoomTopic:
    case StateEvent.RoomAvatar:
      return true;
    case StateEvent.RoomMember: {
      const membershipChanged = isMembershipChanged(mEvent);
      if (membershipChanged && hideMembershipEvents) return false;
      if (!membershipChanged && hideNickAvatarEvents) return false;
      return true;
    }
    case StateEvent.GroupCallMemberPrefix: {
      const content = mEvent.getContent<SessionMembershipData>();
      const prevContent = mEvent.getPrevContent() ?? {};
      return !(content.application && 'application' in prevContent);
    }
    default:
      if (!showHiddenEvents) return false;
      if (Object.keys(mEvent.getContent()).length === 0) return false;
      if (mEvent.getRelation()) return false;
      if (mEvent.isRedaction()) return false;
      return true;
  }
}

function collectRouteCDisplayTimelineSourceEvents(
  linkedTimelines: EventTimeline[]
): RouteCDisplayTimelineSourceEvent[] {
  const sourceEvents: RouteCDisplayTimelineSourceEvent[] = [];
  linkedTimelines.forEach((eventTimeline, timelineIndex) => {
    const timelineSet = eventTimeline.getTimelineSet();
    eventTimeline.getEvents().forEach((mEvent, eventIndex) => {
      const mEventId = mEvent.getId();
      if (!mEventId) return;
      const rawEventIndex =
        getTimelinesEventsCount(linkedTimelines.slice(0, timelineIndex)) + eventIndex;
      sourceEvents.push({
        rawEventIndex,
        eventTimeline,
        timelineSet,
        mEvent,
        mEventId,
      });
    });
  });
  return sourceEvents;
}

function getRouteCDisplayItemId(kind: RouteCDisplayTimelineItem['kind'], eventId: string): string {
  return `routec-display:${kind}:${eventId}`;
}

function addRouteCDisplayEventIndexMappings(
  item: RouteCDisplayTimelineEventItem,
  displayIndexByEventId: Map<string, number>,
  rawEventIndexToDisplayIndex: Map<number, number>
): void {
  item.sourceEventIds.forEach((eventId) => {
    if (!displayIndexByEventId.has(eventId)) {
      displayIndexByEventId.set(eventId, item.displayIndex);
    }
  });
  for (let rawIndex = item.rawStartIndex; rawIndex <= item.rawEndIndex; rawIndex += 1) {
    if (!rawEventIndexToDisplayIndex.has(rawIndex)) {
      rawEventIndexToDisplayIndex.set(rawIndex, item.displayIndex);
    }
  }
}

function buildRouteCDisplayTimelineModel({
  linkedTimelines,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
  readUptoEventId,
  currentUserId,
}: {
  linkedTimelines: EventTimeline[];
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  readUptoEventId: string | undefined;
  currentUserId: string | null;
}): RouteCDisplayTimelineModel {
  const items: RouteCDisplayTimelineItem[] = [];
  const displayIndexByEventId = new Map<string, number>();
  const rawEventIndexByEventId = new Map<string, number>();
  const rawEventIndexToDisplayIndex = new Map<number, number>();
  const sourceEvents = collectRouteCDisplayTimelineSourceEvents(linkedTimelines);
  sourceEvents.forEach((sourceEvent) => {
    rawEventIndexByEventId.set(sourceEvent.mEventId, sourceEvent.rawEventIndex);
  });
  let prevRenderedEvent: MatrixEvent | undefined;
  let compressedToolGroupCount = 0;

  const addItem = (item: RouteCDisplayTimelineItemInput) => {
    const displayIndex = items.length;
    items.push({ ...item, displayIndex } as RouteCDisplayTimelineItem);
    return displayIndex;
  };
  const isRenderableSourceEvent = (sourceEvent: RouteCDisplayTimelineSourceEvent): boolean =>
    isRouteCRenderableTimelineEvent({
      mEvent: sourceEvent.mEvent,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
    });

  for (let sourceIndex = 0; sourceIndex < sourceEvents.length; sourceIndex += 1) {
    const sourceEvent = sourceEvents[sourceIndex];
    if (!isRenderableSourceEvent(sourceEvent)) {
      continue;
    }

    let rawStartIndex = sourceEvent.rawEventIndex;
    let rawEndIndex = sourceEvent.rawEventIndex;
    let renderSourceEvent = sourceEvent;
    let sourceEventIds = [sourceEvent.mEventId];
    let oysterunToolCompression: OysterunToolCompression | undefined;
    let kind: RouteCDisplayTimelineEventItem['kind'] = 'matrix_event';
    let compressedToolPlaceholderSourceEvents: RouteCDisplayTimelineSourceEvent[] = [];
    const toolGroupKey = getOysterunToolCompressionGroupKey(sourceEvent.mEvent);

    if (toolGroupKey) {
      const retainedRunDetails = getOysterunRetainedToolRunDetails(
        sourceEvents,
        sourceIndex,
        toolGroupKey,
        isRenderableSourceEvent
      );
      const runDetails: OysterunToolCompressionDetail[] = [];
      const runSourceEvents: RouteCDisplayTimelineSourceEvent[] = [];
      let runEndSourceIndex = sourceIndex;
      while (runEndSourceIndex < sourceEvents.length) {
        const candidate = sourceEvents[runEndSourceIndex];
        if (candidate.eventTimeline !== sourceEvent.eventTimeline) break;
        if (!isSameOysterunToolRunEvent(candidate.mEvent, toolGroupKey)) break;
        if (!isRenderableSourceEvent(candidate)) break;
        const detail = getOysterunToolCompressionDetail(candidate.mEvent);
        if (!detail) break;
        runDetails.push(detail);
        runSourceEvents.push(candidate);
        runEndSourceIndex += 1;
      }

      const details = runDetails;
      const groupEndSourceIndex = runEndSourceIndex;

      if (details.length > 1) {
        const batchCount = Math.ceil(details.length / OYSTERUN_ROUTE_C_TOOL_OUTPUT_BATCH_SIZE);
        for (
          let batchStartIndex = 0;
          batchStartIndex < details.length;
          batchStartIndex += OYSTERUN_ROUTE_C_TOOL_OUTPUT_BATCH_SIZE
        ) {
          const batchEndIndex = Math.min(
            batchStartIndex + OYSTERUN_ROUTE_C_TOOL_OUTPUT_BATCH_SIZE,
            details.length
          );
          const batchDetails = details.slice(batchStartIndex, batchEndIndex);
          const batchSourceEvents = runSourceEvents.slice(batchStartIndex, batchEndIndex);
          const batchRenderSourceEvent = batchSourceEvents[0];
          if (!batchRenderSourceEvent) continue;
          const batchLastSourceEvent =
            batchSourceEvents[batchSourceEvents.length - 1] ?? batchRenderSourceEvent;
          const batchEventSender = batchRenderSourceEvent.mEvent.getSender();
          const shouldRenderNewDivider = Boolean(
            readUptoEventId &&
              prevRenderedEvent?.getId() === readUptoEventId &&
              batchEventSender !== currentUserId
          );
          const shouldRenderDayDivider =
            prevRenderedEvent !== undefined &&
            !inSameDay(prevRenderedEvent.getTs(), batchRenderSourceEvent.mEvent.getTs());

          if (shouldRenderNewDivider) {
            addItem({
              kind: 'new_messages_divider',
              id: getRouteCDisplayItemId('new_messages_divider', batchRenderSourceEvent.mEventId),
              sourceEventId: batchRenderSourceEvent.mEventId,
              ts: batchRenderSourceEvent.mEvent.getTs(),
            });
          }
          if (shouldRenderDayDivider) {
            addItem({
              kind: 'day_divider',
              id: getRouteCDisplayItemId('day_divider', batchRenderSourceEvent.mEventId),
              sourceEventId: batchRenderSourceEvent.mEventId,
              ts: batchRenderSourceEvent.mEvent.getTs(),
            });
          }

          const collapse =
            prevRenderedEvent !== undefined &&
            !shouldRenderDayDivider &&
            (!shouldRenderNewDivider || batchEventSender === currentUserId) &&
            prevRenderedEvent.getSender() === batchEventSender &&
            prevRenderedEvent.getType() === batchRenderSourceEvent.mEvent.getType() &&
            minuteDifference(prevRenderedEvent.getTs(), batchRenderSourceEvent.mEvent.getTs()) < 2;

          const displayIndex = addItem({
            kind: 'compressed_tool_group',
            id: getRouteCDisplayItemId('compressed_tool_group', batchRenderSourceEvent.mEventId),
            rawEventIndex: batchRenderSourceEvent.rawEventIndex,
            rawStartIndex: batchRenderSourceEvent.rawEventIndex,
            rawEndIndex: batchLastSourceEvent.rawEventIndex,
            eventTimeline: batchRenderSourceEvent.eventTimeline,
            timelineSet: batchRenderSourceEvent.timelineSet,
            mEvent: batchRenderSourceEvent.mEvent,
            mEventId: batchRenderSourceEvent.mEventId,
            collapse,
            sourceEventIds: batchSourceEvents.map((batchSourceEvent) => batchSourceEvent.mEventId),
            oysterunToolCompression: buildOysterunToolCompression({
              details: batchDetails,
              retainedRunDetails,
              toolGroupKey,
              compressionKind: 'tool_semantic_stream_page',
              batchIndex: Math.floor(batchStartIndex / OYSTERUN_ROUTE_C_TOOL_OUTPUT_BATCH_SIZE) + 1,
              batchCount,
              batchSize: OYSTERUN_ROUTE_C_TOOL_OUTPUT_BATCH_SIZE,
              batchStartIndex: batchStartIndex + 1,
              batchEndIndex,
            }),
          });

          const displayItem = items[displayIndex];
          if (displayItem && isRouteCDisplayTimelineEventItem(displayItem)) {
            addRouteCDisplayEventIndexMappings(
              displayItem,
              displayIndexByEventId,
              rawEventIndexToDisplayIndex
            );
          }
          compressedToolGroupCount += 1;
          prevRenderedEvent = batchLastSourceEvent.mEvent;
        }
        sourceIndex = groupEndSourceIndex - 1;
        continue;
      }
    }

    const eventSender = renderSourceEvent.mEvent.getSender();
    const shouldRenderNewDivider = Boolean(
      readUptoEventId &&
        prevRenderedEvent?.getId() === readUptoEventId &&
        eventSender !== currentUserId
    );
    const shouldRenderDayDivider =
      prevRenderedEvent !== undefined &&
      !inSameDay(prevRenderedEvent.getTs(), renderSourceEvent.mEvent.getTs());

    if (shouldRenderNewDivider) {
      addItem({
        kind: 'new_messages_divider',
        id: getRouteCDisplayItemId('new_messages_divider', renderSourceEvent.mEventId),
        sourceEventId: renderSourceEvent.mEventId,
        ts: renderSourceEvent.mEvent.getTs(),
      });
    }
    if (shouldRenderDayDivider) {
      addItem({
        kind: 'day_divider',
        id: getRouteCDisplayItemId('day_divider', renderSourceEvent.mEventId),
        sourceEventId: renderSourceEvent.mEventId,
        ts: renderSourceEvent.mEvent.getTs(),
      });
    }

    compressedToolPlaceholderSourceEvents.forEach((placeholderSourceEvent) => {
      const placeholderDisplayIndex = addItem({
        kind: 'compressed_tool_placeholder',
        id: getRouteCDisplayItemId('compressed_tool_placeholder', placeholderSourceEvent.mEventId),
        rawEventIndex: placeholderSourceEvent.rawEventIndex,
        rawStartIndex: placeholderSourceEvent.rawEventIndex,
        rawEndIndex: placeholderSourceEvent.rawEventIndex,
        eventTimeline: placeholderSourceEvent.eventTimeline,
        timelineSet: placeholderSourceEvent.timelineSet,
        mEvent: placeholderSourceEvent.mEvent,
        mEventId: placeholderSourceEvent.mEventId,
        collapse: true,
        sourceEventIds: [placeholderSourceEvent.mEventId],
      });
      const placeholderItem = items[placeholderDisplayIndex];
      if (placeholderItem && isRouteCDisplayTimelineEventItem(placeholderItem)) {
        addRouteCDisplayEventIndexMappings(
          placeholderItem,
          displayIndexByEventId,
          rawEventIndexToDisplayIndex
        );
      }
    });

    const collapse =
      prevRenderedEvent !== undefined &&
      !shouldRenderDayDivider &&
      (!shouldRenderNewDivider || eventSender === currentUserId) &&
      prevRenderedEvent.getSender() === eventSender &&
      prevRenderedEvent.getType() === renderSourceEvent.mEvent.getType() &&
      minuteDifference(prevRenderedEvent.getTs(), renderSourceEvent.mEvent.getTs()) < 2;

    const displayIndex = addItem({
      kind,
      id: getRouteCDisplayItemId(kind, renderSourceEvent.mEventId),
      rawEventIndex: renderSourceEvent.rawEventIndex,
      rawStartIndex,
      rawEndIndex,
      eventTimeline: renderSourceEvent.eventTimeline,
      timelineSet: renderSourceEvent.timelineSet,
      mEvent: renderSourceEvent.mEvent,
      mEventId: renderSourceEvent.mEventId,
      collapse,
      sourceEventIds,
      oysterunToolCompression,
    });

    const displayItem = items[displayIndex];
    if (displayItem && isRouteCDisplayTimelineEventItem(displayItem)) {
      addRouteCDisplayEventIndexMappings(
        displayItem,
        displayIndexByEventId,
        rawEventIndexToDisplayIndex
      );
    }
    prevRenderedEvent = renderSourceEvent.mEvent;
  }

  return {
    items,
    displayIndexByEventId,
    rawEventIndexByEventId,
    rawEventIndexToDisplayIndex,
    compressedToolGroupCount,
  };
}

function normalizeRouteCDisplayRange(range: ItemRange, count: number): ItemRange {
  if (count <= 0) return { start: 0, end: 0 };
  const requestedSize = Math.max(0, range.end - range.start);
  const end = Math.min(Math.max(range.end, 0), count);
  const start =
    range.end >= count ? Math.max(end - requestedSize, 0) : Math.min(Math.max(range.start, 0), end);
  return { start, end };
}

function getRouteCDisplayAnchorEventIds(item: RouteCDisplayTimelineItem | undefined): string[] {
  if (!item) return [];
  if (isRouteCDisplayTimelineEventItem(item)) return [...item.sourceEventIds].reverse();
  return [item.sourceEventId];
}

function findRouteCDisplayAnchorIndex(
  model: RouteCDisplayTimelineModel,
  anchorEventIds: string[],
  anchorItemId?: string
): number | undefined {
  if (anchorItemId) {
    const displayIndex = model.items.findIndex((item) => item.id === anchorItemId);
    if (displayIndex >= 0) return displayIndex;
  }
  for (const eventId of anchorEventIds) {
    const displayIndex = model.displayIndexByEventId.get(eventId);
    if (typeof displayIndex === 'number') return displayIndex;
  }
  return undefined;
}

function isRouteCCompressedToolBoundaryItem(item: RouteCDisplayTimelineItem | undefined): boolean {
  return Boolean(
    item &&
      isRouteCDisplayTimelineEventItem(item) &&
      (item.kind === 'compressed_tool_group' || item.kind === 'compressed_tool_placeholder')
  );
}

function getRouteCCompressedToolBoundaryCount(
  model: RouteCDisplayTimelineModel,
  itemIndex: number
): number {
  const item = model.items[itemIndex];
  if (!isRouteCCompressedToolBoundaryItem(item)) return 0;

  let firstBoundaryIndex = itemIndex;
  while (
    firstBoundaryIndex > 0 &&
    isRouteCCompressedToolBoundaryItem(model.items[firstBoundaryIndex - 1])
  ) {
    firstBoundaryIndex -= 1;
  }

  let lastBoundaryIndex = itemIndex;
  while (
    lastBoundaryIndex + 1 < model.items.length &&
    isRouteCCompressedToolBoundaryItem(model.items[lastBoundaryIndex + 1])
  ) {
    lastBoundaryIndex += 1;
  }

  let placeholderCount = 0;
  let largestCompressedGroupTotal = 0;
  for (let index = firstBoundaryIndex; index <= lastBoundaryIndex; index += 1) {
    const boundaryItem = model.items[index];
    if (!isRouteCDisplayTimelineEventItem(boundaryItem)) continue;
    if (boundaryItem.kind === 'compressed_tool_placeholder') {
      placeholderCount += 1;
      continue;
    }
    if (boundaryItem.kind === 'compressed_tool_group') {
      largestCompressedGroupTotal = Math.max(
        largestCompressedGroupTotal,
        boundaryItem.oysterunToolCompression?.totalCount ?? boundaryItem.sourceEventIds.length
      );
    }
  }

  return Math.max(placeholderCount, largestCompressedGroupTotal);
}

function getRouteCDenseCompressedToolPaginationLimit(
  baseLimit: number,
  snapshot: RouteCDisplayPaginationSnapshot
): number {
  if (snapshot.denseCompressedToolBoundaryCount <= baseLimit) return baseLimit;
  return Math.min(
    OYSTERUN_ROUTE_C_DENSE_TOOL_PAGINATION_MAX_LIMIT,
    Math.max(
      baseLimit,
      snapshot.denseCompressedToolBoundaryCount + OYSTERUN_ROUTE_C_DENSE_TOOL_PAGINATION_PADDING
    )
  );
}

function getRouteCInsertedDisplayItemsBeforeAnchor({
  snapshot,
  nextModel,
}: {
  snapshot: RouteCDisplayPaginationSnapshot;
  nextModel: RouteCDisplayTimelineModel;
}): RouteCDisplayTimelineItem[] {
  const nextAnchorIndex = findRouteCDisplayAnchorIndex(
    nextModel,
    snapshot.anchorEventIds,
    snapshot.anchorItemId
  );
  if (typeof nextAnchorIndex !== 'number') return [];
  const insertedItemCount = nextAnchorIndex - snapshot.anchorDisplayIndex;
  if (insertedItemCount <= 0) return [];
  return nextModel.items.slice(0, insertedItemCount);
}

function estimateRouteCDisplayItemVisibleProgressPx(item: RouteCDisplayTimelineItem): number {
  if (isRouteCDisplayTimelineEventItem(item)) {
    if (item.kind === 'compressed_tool_placeholder') {
      return OYSTERUN_ROUTE_C_COMPRESSED_TOOL_PLACEHOLDER_HEIGHT_PX;
    }
    if (item.kind === 'compressed_tool_group') {
      return OYSTERUN_ROUTE_C_ESTIMATED_COMPRESSED_GROUP_PROGRESS_PX;
    }
    return OYSTERUN_ROUTE_C_ESTIMATED_MATRIX_EVENT_PROGRESS_PX;
  }
  return OYSTERUN_ROUTE_C_ESTIMATED_DIVIDER_PROGRESS_PX;
}

function shouldRetryRouteCDenseToolLowVisibleProgress({
  snapshot,
  nextModel,
  retryCount,
}: {
  snapshot: RouteCDisplayPaginationSnapshot;
  nextModel: RouteCDisplayTimelineModel;
  retryCount: number;
}): boolean {
  if (retryCount >= OYSTERUN_ROUTE_C_LOW_VISIBLE_PROGRESS_RETRY_LIMIT) return false;
  const insertedItems = getRouteCInsertedDisplayItemsBeforeAnchor({ snapshot, nextModel });
  if (insertedItems.length === 0) return false;

  const compressedBoundaryItemCount = insertedItems.filter(
    isRouteCCompressedToolBoundaryItem
  ).length;
  if (compressedBoundaryItemCount === 0) return false;
  const compressedBoundaryRatio = compressedBoundaryItemCount / insertedItems.length;
  if (compressedBoundaryRatio < OYSTERUN_ROUTE_C_LOW_VISIBLE_PROGRESS_PLACEHOLDER_RATIO) {
    return false;
  }

  const estimatedProgressPx = insertedItems.reduce(
    (total, item) => total + estimateRouteCDisplayItemVisibleProgressPx(item),
    0
  );
  return estimatedProgressPx < OYSTERUN_ROUTE_C_LOW_VISIBLE_PROGRESS_THRESHOLD_PX;
}

type RouteCDisplayPaginationSnapshot = {
  previousRange: ItemRange;
  rangeSize: number;
  anchorDisplayIndex: number;
  anchorOffsetWithinRange: number;
  anchorItemId?: string;
  anchorEventIds: string[];
  denseCompressedToolBoundaryCount: number;
  anchorViewportOffset?: number;
};

type RouteCRemotePaginationScrollRestore = {
  anchorItemId?: string;
  anchorEventIds: string[];
  anchorViewportOffset: number;
};

function buildRouteCDisplayModelForPagination(
  linkedTimelines: EventTimeline[],
  options: RouteCDisplayTimelineBuildOptions
): RouteCDisplayTimelineModel {
  const model = buildRouteCDisplayTimelineModel({
    linkedTimelines,
    ignoredUsersSet: options.ignoredUsersSet,
    showHiddenEvents: options.showHiddenEvents,
    hideMembershipEvents: options.hideMembershipEvents,
    hideNickAvatarEvents: options.hideNickAvatarEvents,
    readUptoEventId: options.readUptoEventId,
    currentUserId: options.currentUserId,
  });
  assertRouteCDisplayTimelineModelInvariant(model);
  return model;
}

function captureRouteCDisplayPaginationSnapshot({
  previousModel,
  previousRange,
  backwards,
  getScrollElement,
  getItemElement,
}: {
  previousModel: RouteCDisplayTimelineModel;
  previousRange: ItemRange;
  backwards: boolean;
  getScrollElement?: () => HTMLElement | null;
  getItemElement?: (index: number) => HTMLElement | undefined;
}): RouteCDisplayPaginationSnapshot {
  const normalizedPreviousRange = normalizeRouteCDisplayRange(
    previousRange,
    previousModel.items.length
  );
  const rangeSize = Math.max(
    normalizedPreviousRange.end - normalizedPreviousRange.start,
    PAGINATION_LIMIT
  );
  const anchorPreviousIndex = backwards
    ? normalizedPreviousRange.start
    : Math.max(normalizedPreviousRange.end - 1, normalizedPreviousRange.start);
  let visibleAnchorIndex = anchorPreviousIndex;
  let anchorViewportOffset: number | undefined;

  const scrollElement = backwards ? getScrollElement?.() : undefined;
  if (scrollElement && getItemElement) {
    for (
      let itemIndex = normalizedPreviousRange.start;
      itemIndex < normalizedPreviousRange.end;
      itemIndex += 1
    ) {
      const itemElement = getItemElement(itemIndex);
      if (!itemElement || !isIntersectingScrollView(scrollElement, itemElement)) continue;
      visibleAnchorIndex = itemIndex;
      anchorViewportOffset = itemElement.offsetTop - scrollElement.scrollTop;
      break;
    }
  }

  const anchorOffsetWithinRange = visibleAnchorIndex - normalizedPreviousRange.start;
  const anchorItem = previousModel.items[visibleAnchorIndex];
  const anchorEventIds = getRouteCDisplayAnchorEventIds(anchorItem);
  const denseCompressedToolBoundaryCount = backwards
    ? getRouteCCompressedToolBoundaryCount(previousModel, visibleAnchorIndex)
    : 0;

  return {
    previousRange,
    rangeSize,
    anchorDisplayIndex: visibleAnchorIndex,
    anchorOffsetWithinRange,
    anchorItemId: anchorItem?.id,
    anchorEventIds,
    denseCompressedToolBoundaryCount,
    anchorViewportOffset,
  };
}

function recalibrateRouteCDisplayPaginationRange({
  snapshot,
  nextModel,
}: {
  snapshot: RouteCDisplayPaginationSnapshot;
  nextModel: RouteCDisplayTimelineModel;
}): ItemRange {
  const nextAnchorIndex = findRouteCDisplayAnchorIndex(
    nextModel,
    snapshot.anchorEventIds,
    snapshot.anchorItemId
  );

  if (typeof nextAnchorIndex !== 'number') {
    return normalizeRouteCDisplayRange(snapshot.previousRange, nextModel.items.length);
  }

  const nextStart = nextAnchorIndex - snapshot.anchorOffsetWithinRange;
  return normalizeRouteCDisplayRange(
    {
      start: nextStart,
      end: nextStart + snapshot.rangeSize,
    },
    nextModel.items.length
  );
}

function assertRouteCDisplayTimelineModelInvariant(model: RouteCDisplayTimelineModel): void {
  model.items.forEach((item, index) => {
    if (item.displayIndex !== index) {
      throw new Error(`Route C display item index mismatch at ${index}`);
    }
    if (!item.id) {
      throw new Error(`Route C display item ${index} is missing a stable id`);
    }
    if (item.kind === 'compressed_tool_group') {
      const allowsSingleEventToolPage =
        item.oysterunToolCompression?.compressionKind === 'tool_semantic_stream_page';
      if (
        !item.oysterunToolCompression ||
        item.sourceEventIds.length < 1 ||
        (!allowsSingleEventToolPage && item.sourceEventIds.length <= 1)
      ) {
        throw new Error(
          `Route C compressed tool display item ${item.id} is missing group metadata`
        );
      }
    }
    if (item.kind === 'compressed_tool_placeholder') {
      if (item.sourceEventIds.length !== 1 || item.oysterunToolCompression) {
        throw new Error(`Route C compressed tool placeholder ${item.id} must map one hidden event`);
      }
    }
  });
}

function mergeOysterunHost2CancelCandidateEventIds({
  timelineCandidateEventIds,
  renderedCandidateEventIds,
}: {
  timelineCandidateEventIds: string[];
  renderedCandidateEventIds: string[];
}): string[] {
  const timelineTail = timelineCandidateEventIds.slice(-OYSTERUN_HOST2_CANCEL_CANDIDATE_LIMIT);
  const renderedTail = renderedCandidateEventIds.slice(
    -OYSTERUN_HOST2_CANCEL_RENDERED_CANDIDATE_LIMIT
  );
  return oysterunUniqueEventIds([...timelineTail, ...renderedTail]);
}

const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], evtAbsIndex: number) => void,
  onError: (err: Error | null) => void,
  forceRouteCMatrixContextFocus: boolean
) => {
  const loadEventTimeline = useCallback(
    async (eventId: string) => {
      const timelineSet = forceRouteCMatrixContextFocus
        ? new EventTimelineSet(room, { timelineSupport: true }, mx)
        : room.getUnfilteredTimelineSet();
      const [err, replyEvtTimeline] = await to(
        mx.getEventTimeline(timelineSet, eventId)
      );
      if (!replyEvtTimeline) {
        onError(err ?? null);
        return;
      }
      const linkedTimelines = getLinkedTimelines(replyEvtTimeline);
      const absIndex = getEventIdAbsoluteIndex(linkedTimelines, replyEvtTimeline, eventId);

      if (absIndex === undefined) {
        onError(err ?? null);
        return;
      }

      onLoad(eventId, linkedTimelines, absIndex);
    },
    [forceRouteCMatrixContextFocus, mx, room, onLoad, onError]
  );

  return loadEventTimeline;
};

const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Timeline,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number,
  displayTimelineBuildOptions: RouteCDisplayTimelineBuildOptions,
  getScrollElement?: () => HTMLElement | null,
  getItemElement?: (index: number) => HTMLElement | undefined,
  setRemoteScrollRestore?: (restore: RouteCRemotePaginationScrollRestore) => void,
  scheduleRemotePaginationCommit?: (backwards: boolean, commit: () => void) => void
) => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const alive = useAlive();

  const handleTimelinePagination = useMemo(() => {
    let fetching = false;

    const buildDisplayModel = (linkedTimelines: EventTimeline[]) =>
      buildRouteCDisplayModelForPagination(linkedTimelines, displayTimelineBuildOptions);
    const commitPagination = (backwards: boolean, commit: () => void) => {
      if (scheduleRemotePaginationCommit) {
        scheduleRemotePaginationCommit(backwards, commit);
        return;
      }
      commit();
    };
    const decryptFetchedTimeline = async (fetchedTimeline: EventTimeline) => {
      const roomId = fetchedTimeline.getRoomId();
      const room = roomId ? mx.getRoom(roomId) : null;

      if (room?.hasEncryptionStateEvent()) {
        await to(decryptAllTimelineEvent(mx, fetchedTimeline));
      }
    };

    const recalibratePagination = (
      linkedTimelines: EventTimeline[],
      snapshot: RouteCDisplayPaginationSnapshot
    ) => {
      const topTimeline = linkedTimelines[0];

      const newLTimelines = getLinkedTimelines(topTimeline);
      const nextDisplayModel = buildDisplayModel(newLTimelines);

      if (typeof snapshot.anchorViewportOffset === 'number' && snapshot.anchorEventIds.length > 0) {
        setRemoteScrollRestore?.({
          anchorItemId: snapshot.anchorItemId,
          anchorEventIds: snapshot.anchorEventIds,
          anchorViewportOffset: snapshot.anchorViewportOffset,
        });
      }

      setTimeline((currentTimeline) => ({
        linkedTimelines: newLTimelines,
        displayModelRevision: currentTimeline.displayModelRevision + 1,
        range: recalibrateRouteCDisplayPaginationRange({
          snapshot,
          nextModel: nextDisplayModel,
        }),
      }));
    };

    return async (backwards: boolean) => {
      if (fetching) return false;
      const { linkedTimelines: lTimelines, range: previousRange } = timelineRef.current;

      const timelineToPaginate = backwards ? lTimelines[0] : lTimelines[lTimelines.length - 1];
      if (!timelineToPaginate) return false;
      const previousDisplayModel = buildDisplayModel(lTimelines);
      const snapshot = captureRouteCDisplayPaginationSnapshot({
        previousModel: previousDisplayModel,
        previousRange,
        backwards,
        getScrollElement,
        getItemElement,
      });

      const paginationToken = timelineToPaginate.getPaginationToken(
        backwards ? Direction.Backward : Direction.Forward
      );
      if (
        !paginationToken &&
        getTimelinesEventsCount(lTimelines) !==
          getTimelinesEventsCount(getLinkedTimelines(timelineToPaginate))
      ) {
        commitPagination(backwards, () => recalibratePagination(lTimelines, snapshot));
        return true;
      }

      fetching = true;
      try {
        let timelineCursor = timelineToPaginate;
        let effectiveLimit = backwards
          ? getRouteCDenseCompressedToolPaginationLimit(limit, snapshot)
          : limit;
        let denseToolLowVisibleProgressRetryCount = 0;

        while (true) {
          const [err] = await to(
            mx.paginateEventTimeline(timelineCursor, {
              backwards,
              limit: effectiveLimit,
            })
          );
          if (err) return false;

          const fetchedTimeline =
            timelineCursor.getNeighbouringTimeline(
              backwards ? Direction.Backward : Direction.Forward
            ) ?? timelineCursor;
          // Decrypt all event ahead of render cycle.
          await decryptFetchedTimeline(fetchedTimeline);

          if (!backwards) break;

          const paginatedLinkedTimelines = getLinkedTimelines(timelineCursor);
          const nextDisplayModel = buildDisplayModel(paginatedLinkedTimelines);
          if (
            !shouldRetryRouteCDenseToolLowVisibleProgress({
              snapshot,
              nextModel: nextDisplayModel,
              retryCount: denseToolLowVisibleProgressRetryCount,
            })
          ) {
            break;
          }

          const nextTopTimeline = paginatedLinkedTimelines[0];
          if (!nextTopTimeline?.getPaginationToken(Direction.Backward)) break;
          denseToolLowVisibleProgressRetryCount += 1;
          timelineCursor = nextTopTimeline;
          effectiveLimit = limit;
        }

        if (alive()) {
          commitPagination(backwards, () => recalibratePagination(lTimelines, snapshot));
          return true;
        }
        return false;
      } finally {
        fetching = false;
      }
    };
  }, [
    mx,
    alive,
    setTimeline,
    limit,
    displayTimelineBuildOptions,
    getScrollElement,
    getItemElement,
    setRemoteScrollRestore,
    scheduleRemotePaginationCommit,
  ]);
  return handleTimelinePagination;
};

const useLiveEventArrive = (room: Room, onArrive: (mEvent: MatrixEvent) => void) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId || !data.liveEvent) return;
      onArrive(mEvent);
    };
    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onArrive(mEvent);
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    room.on(RoomEvent.Redaction, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
    };
  }, [room, onArrive]);
};

const useTimelineHydrationRefresh = (room: Room, onHydrate: () => void) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      _mEvent,
      eventRoom,
      _toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId || removed || data.liveEvent) return;
      onHydrate();
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [room, onHydrate]);
};

const useLiveTimelineRefresh = (room: Room, onRefresh: () => void) => {
  useEffect(() => {
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.TimelineRefresh] = (r) => {
      if (r.roomId !== room.roomId) return;
      onRefresh();
    };

    room.on(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    return () => {
      room.removeListener(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    };
  }, [room, onRefresh]);
};

const getInitialTimeline = (room: Room) => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const evLength = getTimelinesEventsCount(linkedTimelines);
  return {
    linkedTimelines,
    displayModelRevision: 0,
    range: {
      start: Math.max(evLength - PAGINATION_LIMIT, 0),
      end: evLength,
    },
  };
};

const getEmptyTimeline = () => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
  displayModelRevision: 0,
});

const refreshLiveTimelineSource = (room: Room, linkedTimelines: EventTimeline[]): EventTimeline[] =>
  linkedTimelines[linkedTimelines.length - 1] === getLiveTimeline(room)
    ? getLinkedTimelines(getLiveTimeline(room))
    : linkedTimelines;

const getDisplayTimelineSource = (
  linkedTimelines: EventTimeline[],
  displayModelRevision: number
): EventTimeline[] => {
  if (!Number.isFinite(displayModelRevision)) return linkedTimelines;
  return linkedTimelines;
};

const getRoomUnreadInfo = (room: Room, scrollTo = false) => {
  const readUptoEventId = room.getEventReadUpTo(room.client.getUserId() ?? '');
  if (!readUptoEventId) return undefined;
  const evtTimeline = getEventTimeline(room, readUptoEventId);
  const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
  return {
    readUptoEventId,
    inLiveTimeline: latestTimeline === room.getLiveTimeline(),
    scrollTo,
  };
};

const getDistanceFromScrollBottom = (scrollElement: HTMLElement): number =>
  Math.max(0, scrollElement.scrollHeight - scrollElement.offsetHeight - scrollElement.scrollTop);

const isScrollAtOrNearBottom = (scrollElement: HTMLElement): boolean =>
  getDistanceFromScrollBottom(scrollElement) <= OYSTERUN_ROUTE_C_NEAR_BOTTOM_THRESHOLD_PX;

const isRouteCVisibleForSmoothBottomSettle = (): boolean =>
  document.visibilityState !== 'hidden' && document.hasFocus();

const nudgeOysterunIOSScrollPaint = (scrollElement: HTMLElement): boolean => {
  const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  if (maxScrollTop <= 0) return false;

  const originalScrollTop = scrollElement.scrollTop;
  const nudgeDirection =
    originalScrollTop >= maxScrollTop
      ? -OYSTERUN_ROUTE_C_IOS_SCROLL_PAINT_NUDGE_PX
      : OYSTERUN_ROUTE_C_IOS_SCROLL_PAINT_NUDGE_PX;
  const nudgedScrollTop = Math.max(0, Math.min(maxScrollTop, originalScrollTop + nudgeDirection));
  if (nudgedScrollTop === originalScrollTop) return false;

  scrollElement.scrollTop = nudgedScrollTop;
  scrollElement.scrollTop = originalScrollTop;
  return true;
};

export function RoomTimeline({
  room,
  eventId,
  roomInputRef,
  editor,
  routeCRespondingState,
}: RoomTimelineProps) {
  const mx = useMatrixClient();
  const currentUserId = mx.getUserId();
  const screenSize = useScreenSizeContext();
  const mobileScrollbarVisible = screenSize === ScreenSize.Mobile;
  const routeCChatShell = Boolean(getOysterunHostSessionRouteSearch());
  const routeCIOSScrollPaintNudgeEnabled = routeCChatShell && isOysterunCapacitorIOSRuntime();
  const useAuthentication = useMediaAuthentication();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [messageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [messageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const direct = useIsDirectRoom();
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const ignoredUsersList = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsersList), [ignoredUsersList]);

  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

  const theme = useTheme();
  const accessiblePowerTagColors = useAccessiblePowerTagColors(
    theme.kind,
    creatorsTag,
    powerLevelTags
  );

  const permissions = useRoomPermissions(creators, powerLevels);

  const canRedact = permissions.action('redact', mx.getSafeUserId());
  const canDeleteOwn = permissions.event(MessageEvent.RoomRedaction, mx.getSafeUserId());
  const canSendReaction = permissions.event(MessageEvent.Reaction, mx.getSafeUserId());
  const canPinEvent = permissions.stateEvent(StateEvent.RoomPinnedEvents, mx.getSafeUserId());
  const [editId, setEditId] = useState<string>();

  const roomToParents = useAtomValue(roomToParentsAtom);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const { navigateRoom } = useRoomNavigate();
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();

  const imagePackRooms: Room[] = useImagePackRooms(room.roomId, roomToParents);

  const [unreadInfo, setUnreadInfo] = useState(() => getRoomUnreadInfo(room, true));
  const readUptoEventIdRef = useRef<string>();
  if (unreadInfo) {
    readUptoEventIdRef.current = unreadInfo.readUptoEventId;
  }
  const currentReadUptoEventId = unreadInfo?.readUptoEventId ?? readUptoEventIdRef.current;

  const atBottomAnchorRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;
  const followingLatestIntentRef = useRef(true);
  const backgroundBottomSettlePendingRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const programmaticScrollUntilRef = useRef(0);
  const initialBottomSettleUntilRef = useRef(0);
  const remotePaginationSettleUntilRef = useRef(0);
  const routeCTouchActiveRef = useRef(false);
  const remotePaginationTouchReleaseRequiredRef = useRef(false);
  const deferredRemotePaginationCommitRef = useRef<(() => void) | undefined>();
  const remotePaginationScrollRestoreRef = useRef<RouteCRemotePaginationScrollRestore>();
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<
    | {
        index: number;
        scrollTo: boolean;
        highlight: boolean;
      }
    | undefined
  >();
  const alive = useAlive();

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room, mentionClickHandler]
  );
  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [mx, room, linkifyOpts, spoilerClickHandler, mentionClickHandler, useAuthentication]
  );
  const parseMemberEvent = useMemberEventParser();

  const [timeline, setTimeline] = useState<Timeline>(() =>
    eventId ? getEmptyTimeline() : getInitialTimeline(room)
  );
  const displayTimelineModel = useMemo(
    () =>
      buildRouteCDisplayTimelineModel({
        linkedTimelines: getDisplayTimelineSource(
          timeline.linkedTimelines,
          timeline.displayModelRevision
        ),
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        readUptoEventId: currentReadUptoEventId,
        currentUserId,
      }),
    [
      timeline.linkedTimelines,
      timeline.displayModelRevision,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      currentReadUptoEventId,
      currentUserId,
    ]
  );
  assertRouteCDisplayTimelineModelInvariant(displayTimelineModel);
  const displayItems = displayTimelineModel.items;
  const displayItemsLength = displayItems.length;
  const displayRange = normalizeRouteCDisplayRange(timeline.range, displayItemsLength);
  const [oysterunCancelControlsByEventId, setOysterunCancelControlsByEventId] = useState<
    Record<string, OysterunHost2CancelControlState>
  >({});
  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const rangeAtStart = displayRange.start === 0;
  const rangeAtEnd = displayRange.end === displayItemsLength;
  const atLiveEndRef = useRef(liveTimelineLinked && rangeAtEnd);
  atLiveEndRef.current = liveTimelineLinked && rangeAtEnd;

  const handleOysterunHost2Cancel = useCallback(
    async (targetEventId: string) => {
      const currentState = oysterunCancelControlsByEventId[targetEventId];
      if (!currentState || !isOysterunHost2CancelableProof(currentState.proof, targetEventId))
        return;
      recordOysterunCancelControlProof(
        {
          target_user_event_id: targetEventId,
          target_user_event_id_hash: currentState.proof.source_user_event_id_raw_hash,
          host_session_id: currentState.proof.host_session_id,
          matrix_room_id: currentState.proof.matrix_room_id,
          host2_intake_state_before_click: currentState.proof.host2_intake_state,
          cancelable_before_click: currentState.proof.cancelable === true,
          agent_turn_started_before_click: currentState.proof.agent_turn_started === true,
          same_event_both_canceled_and_started:
            currentState.proof.same_event_both_canceled_and_started === true,
        },
        'click_requested'
      );
      setOysterunCancelControlsByEventId((current) => ({
        ...current,
        [targetEventId]: {
          ...currentState,
          status: 'canceling',
        },
      }));
      try {
        const response = await cancelOysterunHost2Intake({
          roomId: room.roomId,
          eventId: targetEventId,
        });
        rememberOysterunHost2IntakeProof({
          roomId: room.roomId,
          eventId: targetEventId,
          sessionId: response.proof.host_session_id || undefined,
          proof: response.proof,
        });
        const accepted = response.proof.cancel_outcome === 'accepted';
        const semanticCommits = accepted
          ? await commitOysterunCancelSemanticSourceHooks(response.proof)
          : [];
        const requestSemanticCommit = semanticCommits.find(
          (commit) => commit.semantic_type === 'control.request'
        );
        const outcomeSemanticCommit = semanticCommits.find(
          (commit) => commit.semantic_type === 'control.outcome'
        );
        recordOysterunCancelControlProof(
          {
            target_user_event_id: targetEventId,
            target_user_event_id_hash: response.proof.source_user_event_id_raw_hash,
            host_session_id: response.proof.host_session_id,
            matrix_room_id: response.proof.matrix_room_id,
            host2_intake_state_after_click: response.proof.host2_intake_state,
            cancel_outcome: response.proof.cancel_outcome,
            control_request_id: response.proof.control_request_id,
            control_outcome: response.proof.control_outcome,
            cancel_request_semantic_event_source_hook_present: Boolean(
              response.proof.cancel_request_semantic_event_source_hook
            ),
            cancel_outcome_semantic_event_source_hook_present: Boolean(
              response.proof.cancel_outcome_semantic_event_source_hook
            ),
            cancel_semantic_matrix_event_commit_count: semanticCommits.length,
            cancel_request_semantic_event_committed: Boolean(requestSemanticCommit),
            cancel_request_semantic_event_id: requestSemanticCommit?.event_id ?? null,
            cancel_request_semantic_txn_id: requestSemanticCommit?.txn_id ?? null,
            cancel_outcome_semantic_event_committed: Boolean(outcomeSemanticCommit),
            cancel_outcome_semantic_event_id: outcomeSemanticCommit?.event_id ?? null,
            cancel_outcome_semantic_txn_id: outcomeSemanticCommit?.txn_id ?? null,
            provider_receives_canceled_user_event:
              response.proof.provider_receives_canceled_user_event === false ? false : null,
            provider_delivery_claimed: response.proof.provider_delivery_claimed === true,
            same_event_both_canceled_and_started:
              response.proof.same_event_both_canceled_and_started === true,
          },
          'click_resolved'
        );
        setOysterunCancelControlsByEventId((current) => ({
          ...current,
          [targetEventId]: {
            status: accepted ? 'accepted' : 'too_late',
            proof: response.proof,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordOysterunCancelControlProof(
          {
            target_user_event_id: targetEventId,
            target_user_event_id_hash: currentState.proof.source_user_event_id_raw_hash,
            host_session_id: currentState.proof.host_session_id,
            matrix_room_id: currentState.proof.matrix_room_id,
            error: message,
          },
          'click_failed'
        );
        setOysterunCancelControlsByEventId((current) => ({
          ...current,
          [targetEventId]: {
            ...currentState,
            status: 'error',
            error: message,
          },
        }));
      }
    },
    [oysterunCancelControlsByEventId, room.roomId]
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const resetOysterunLocalPathDisclosures = useCallback(() => {
    const root = scrollContentRef.current ?? scrollRef.current;
    if (!root) return false;
    return resetOysterunLocalPathLinks(root);
  }, []);
  const getTimelineItemElement = useCallback(
    (index: number) =>
      (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
      undefined,
    []
  );
  const setRemoteScrollRestore = useCallback((restore: RouteCRemotePaginationScrollRestore) => {
    remotePaginationScrollRestoreRef.current = restore;
  }, []);
  const flushDeferredRemotePaginationCommit = useCallback(() => {
    const commit = deferredRemotePaginationCommitRef.current;
    deferredRemotePaginationCommitRef.current = undefined;
    if (commit) commit();
  }, []);
  const scheduleRemotePaginationCommit = useCallback((backwards: boolean, commit: () => void) => {
    if (!backwards || !routeCTouchActiveRef.current) {
      commit();
      return;
    }
    deferredRemotePaginationCommitRef.current = commit;
    remotePaginationTouchReleaseRequiredRef.current = true;
  }, []);
  const shouldSuppressPagination = useCallback((backwards: boolean) => {
    if (!backwards) return false;
    if (deferredRemotePaginationCommitRef.current) {
      return OYSTERUN_ROUTE_C_REMOTE_PAGINATION_SETTLE_MS;
    }

    if (remotePaginationTouchReleaseRequiredRef.current) {
      if (routeCTouchActiveRef.current) {
        return OYSTERUN_ROUTE_C_REMOTE_PAGINATION_SETTLE_MS;
      }
      remotePaginationTouchReleaseRequiredRef.current = false;
    }

    const settleRemainingMs = remotePaginationSettleUntilRef.current - performance.now();
    return settleRemainingMs > 0 ? Math.ceil(settleRemainingMs + 16) : false;
  }, []);

  const routeCDisplayTimelineBuildOptions = useMemo<RouteCDisplayTimelineBuildOptions>(
    () => ({
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      readUptoEventId: currentReadUptoEventId,
      currentUserId,
    }),
    [
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      currentReadUptoEventId,
      currentUserId,
    ]
  );
  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    PAGINATION_LIMIT,
    routeCDisplayTimelineBuildOptions,
    getScrollElement,
    getTimelineItemElement,
    setRemoteScrollRestore,
    scheduleRemotePaginationCommit
  );

  const isTimelineAtOrNearBottom = useCallback(() => {
    const scrollElement = getScrollElement();
    return scrollElement ? isScrollAtOrNearBottom(scrollElement) : atBottomRef.current;
  }, [getScrollElement]);
  const startInitialBottomSettle = useCallback(() => {
    followingLatestIntentRef.current = true;
    initialBottomSettleUntilRef.current =
      performance.now() + OYSTERUN_ROUTE_C_INITIAL_BOTTOM_SETTLE_MS;
  }, []);
  const isInitialBottomSettleActive = useCallback(
    () => performance.now() <= initialBottomSettleUntilRef.current,
    []
  );
  const shouldFollowTimelineBottom = useCallback(
    () =>
      followingLatestIntentRef.current ||
      isTimelineAtOrNearBottom() ||
      isInitialBottomSettleActive(),
    [isInitialBottomSettleActive, isTimelineAtOrNearBottom]
  );
  const handleTimelineScroll = useCallback(() => {
    if (performance.now() <= programmaticScrollUntilRef.current) return;
    const followingLatest = isTimelineAtOrNearBottom() || isInitialBottomSettleActive();
    followingLatestIntentRef.current = followingLatest;
    if (!followingLatest) {
      initialBottomSettleUntilRef.current = 0;
    }
  }, [isInitialBottomSettleActive, isTimelineAtOrNearBottom]);
  const nudgeOysterunIOSScrollPaintIfNeeded = useCallback(() => {
    if (!routeCIOSScrollPaintNudgeEnabled) return;

    requestAnimationFrame(() => {
      if (!alive() || !shouldFollowTimelineBottom()) return;
      requestAnimationFrame(() => {
        if (!alive() || !shouldFollowTimelineBottom()) return;
        const scrollElement = getScrollElement();
        if (!scrollElement || !isScrollAtOrNearBottom(scrollElement)) return;
        programmaticScrollUntilRef.current =
          performance.now() + OYSTERUN_ROUTE_C_PROGRAMMATIC_SCROLL_GUARD_MS;
        nudgeOysterunIOSScrollPaint(scrollElement);
      });
    });
  }, [alive, getScrollElement, routeCIOSScrollPaintNudgeEnabled, shouldFollowTimelineBottom]);
  const scrollToTimelineBottom = useCallback(
    (behavior: 'auto' | 'instant' | 'smooth' = 'instant') => {
      const scrollElement = getScrollElement();
      if (!scrollElement) return;

      const scrollOnce = (scrollBehavior: 'auto' | 'instant' | 'smooth') => {
        programmaticScrollUntilRef.current =
          performance.now() + OYSTERUN_ROUTE_C_PROGRAMMATIC_SCROLL_GUARD_MS;
        scrollToBottom(scrollElement, scrollBehavior);
      };

      scrollOnce(behavior);
      nudgeOysterunIOSScrollPaintIfNeeded();
      requestAnimationFrame(() => {
        if (!alive() || !shouldFollowTimelineBottom()) return;
        scrollOnce('instant');
        nudgeOysterunIOSScrollPaintIfNeeded();
        requestAnimationFrame(() => {
          if (!alive() || !shouldFollowTimelineBottom()) return;
          scrollOnce('instant');
          nudgeOysterunIOSScrollPaintIfNeeded();
        });
      });
    },
    [alive, getScrollElement, nudgeOysterunIOSScrollPaintIfNeeded, shouldFollowTimelineBottom]
  );

  const {
    getItems,
    scrollToItem,
    scrollToElement,
    observeBackAnchor,
    observeFrontAnchor,
    retrySuppressedPagination,
  } = useVirtualPaginator({
    count: displayItemsLength,
    limit: PAGINATION_LIMIT,
    range: displayRange,
    onRangeChange: useCallback((r) => setTimeline((cs) => ({ ...cs, range: r })), []),
    getScrollElement,
    getItemElement: getTimelineItemElement,
    onEnd: handleTimelinePagination,
    shouldSuppressPagination,
  });
  const visibleDisplayItems = getItems();
  const shouldShowRouteCEmptyComposerGuidance =
    routeCChatShell &&
    displayItemsLength === 0 &&
    rangeAtStart &&
    rangeAtEnd &&
    !canPaginateBack &&
    liveTimelineLinked;

  useLayoutEffect(() => {
    const restore = remotePaginationScrollRestoreRef.current;
    if (!restore) return;

    const scrollElement = getScrollElement();
    const anchorIndex = findRouteCDisplayAnchorIndex(
      displayTimelineModel,
      restore.anchorEventIds,
      restore.anchorItemId
    );
    if (!scrollElement || typeof anchorIndex !== 'number') {
      remotePaginationScrollRestoreRef.current = undefined;
      return;
    }

    const anchorElement = getTimelineItemElement(anchorIndex);
    if (!anchorElement) return;

    programmaticScrollUntilRef.current =
      performance.now() + OYSTERUN_ROUTE_C_PROGRAMMATIC_SCROLL_GUARD_MS;
    remotePaginationSettleUntilRef.current =
      performance.now() + OYSTERUN_ROUTE_C_REMOTE_PAGINATION_SETTLE_MS;
    remotePaginationTouchReleaseRequiredRef.current = routeCTouchActiveRef.current;
    scrollElement.scrollTo({
      top: Math.max(anchorElement.offsetTop - restore.anchorViewportOffset, 0),
      behavior: 'instant',
    });
    remotePaginationScrollRestoreRef.current = undefined;
  }, [displayRange, displayTimelineModel, getScrollElement, getTimelineItemElement]);

  const oysterunHost2TimelineCandidateEventIds = collectOysterunHost2TimelineCandidateEventIds(
    mx,
    timeline.linkedTimelines
  );
  const oysterunHost2RenderedCandidateEventIds = collectOysterunHost2RenderedCandidateEventIds(
    mx,
    visibleDisplayItems
      .map((itemIndex) => displayItems[itemIndex])
      .filter((item): item is RouteCDisplayTimelineItem => Boolean(item))
  );
  const oysterunProviderControlOutcomesByRequestId = collectOysterunProviderControlOutcomes(
    timeline.linkedTimelines
  );
  const oysterunHost2CandidateEventIds = mergeOysterunHost2CancelCandidateEventIds({
    timelineCandidateEventIds: oysterunHost2TimelineCandidateEventIds,
    renderedCandidateEventIds: oysterunHost2RenderedCandidateEventIds,
  });
  useOysterunHost2CancelControlPolling({
    roomId: room.roomId,
    candidateEventIds: oysterunHost2CandidateEventIds,
    relatedPollingAllowed: routeCRespondingState.relatedPollingAllowed,
    setCancelControlsByEventId: setOysterunCancelControlsByEventId,
  });

  const loadEventTimeline = useEventTimelineLoader(
    mx,
    room,
    useCallback(
      (evtId, lTimelines, evtAbsIndex) => {
        if (!alive()) return;
        const loadedDisplayTimelineModel = buildRouteCDisplayTimelineModel({
          linkedTimelines: lTimelines,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
          readUptoEventId: readUptoEventIdRef.current,
          currentUserId: mx.getUserId(),
        });
        assertRouteCDisplayTimelineModelInvariant(loadedDisplayTimelineModel);
        const displayIndex =
          loadedDisplayTimelineModel.displayIndexByEventId.get(evtId) ??
          loadedDisplayTimelineModel.rawEventIndexToDisplayIndex.get(evtAbsIndex) ??
          0;
        const displayLength = loadedDisplayTimelineModel.items.length;

        followingLatestIntentRef.current = false;
        backgroundBottomSettlePendingRef.current = false;
        atBottomRef.current = false;
        setAtBottom(false);
        programmaticScrollUntilRef.current =
          performance.now() + OYSTERUN_ROUTE_C_PROGRAMMATIC_SCROLL_GUARD_MS;

        setFocusItem({
          index: displayIndex,
          scrollTo: true,
          highlight: evtId !== readUptoEventIdRef.current,
        });
        setTimeline({
          linkedTimelines: lTimelines,
          displayModelRevision: 0,
          range: {
            start: Math.max(displayIndex - PAGINATION_LIMIT, 0),
            end: Math.min(displayIndex + PAGINATION_LIMIT, displayLength),
          },
        });
      },
      [alive, ignoredUsersSet, showHiddenEvents, hideMembershipEvents, hideNickAvatarEvents, mx]
    ),
    useCallback(() => {
      if (!alive()) return;
      setTimeline(getInitialTimeline(room));
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [alive, room]),
    routeCChatShell
  );

  useLiveEventArrive(
    room,
    useCallback(
      (mEvt: MatrixEvent) => {
        const sentByCurrentUser = mEvt.getSender() === mx.getUserId();
        const shouldFollowBottom = sentByCurrentUser || shouldFollowTimelineBottom();

        // If the user is at/near the bottom, keep paginating through layout settle.
        // Explicit sends also move to bottom even when the user had scrolled upward.
        // Otherwise update the timeline without moving the viewport, so edits/reactions still render.
        if (shouldFollowBottom) {
          followingLatestIntentRef.current = true;
          if (document.hasFocus() && (!unreadInfo || sentByCurrentUser)) {
            // Check if the document is in focus (user is actively viewing the app),
            // and either there are no unread messages or the latest message is from the current user.
            // If either condition is met, trigger the markAsRead function to send a read receipt.
            requestAnimationFrame(() => markAsRead(mx, mEvt.getRoomId()!, hideActivity));
          }

          if (!document.hasFocus() && !unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }

          const visibleForSmoothBottomSettle = isRouteCVisibleForSmoothBottomSettle();
          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = visibleForSmoothBottomSettle;
          backgroundBottomSettlePendingRef.current =
            backgroundBottomSettlePendingRef.current || !visibleForSmoothBottomSettle;

          if (sentByCurrentUser && !atLiveEndRef.current) {
            setTimeline(getInitialTimeline(room));
          } else {
            setTimeline((ct) => ({
              ...ct,
              linkedTimelines: refreshLiveTimelineSource(room, ct.linkedTimelines),
              displayModelRevision: ct.displayModelRevision + 1,
              range: {
                start: ct.range.start + 1,
                end: ct.range.end + 1,
              },
            }));
          }
          return;
        }
        setTimeline((ct) => ({
          ...ct,
          linkedTimelines: refreshLiveTimelineSource(room, ct.linkedTimelines),
          displayModelRevision: ct.displayModelRevision + 1,
        }));
        if (!unreadInfo) {
          setUnreadInfo(getRoomUnreadInfo(room));
        }
      },
      [mx, room, unreadInfo, hideActivity, shouldFollowTimelineBottom]
    )
  );

  const handleOpenEvent = useCallback(
    async (
      evtId: string,
      highlight = true,
      onScroll: ((scrolled: boolean) => void) | undefined = undefined
    ) => {
      const evtTimeline = getEventTimeline(room, evtId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(timeline.linkedTimelines, evtTimeline, evtId);
      const displayIndex =
        displayTimelineModel.displayIndexByEventId.get(evtId) ??
        (typeof absoluteIndex === 'number'
          ? displayTimelineModel.rawEventIndexToDisplayIndex.get(absoluteIndex)
          : undefined);

      if (typeof displayIndex === 'number') {
        const scrolled = scrollToItem(displayIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          index: displayIndex,
          scrollTo: false,
          highlight,
        });
      } else {
        setTimeline(getEmptyTimeline());
        loadEventTimeline(evtId);
      }
    },
    [room, timeline, displayTimelineModel, scrollToItem, loadEventTimeline]
  );

  useEffect(() => {
    if (!routeCChatShell) return undefined;
    return subscribeOysterunActiveRoomTimelineFocus(room.roomId, (evtId) => {
      void handleOpenEvent(evtId);
    });
  }, [handleOpenEvent, room.roomId, routeCChatShell]);

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      if (liveTimelineLinked) {
        setTimeline(getInitialTimeline(room));
      }
    }, [room, liveTimelineLinked])
  );

  useTimelineHydrationRefresh(
    room,
    useCallback(() => {
      if (eventId || displayItemsLength > 0) return;
      const hydratedTimeline = getInitialTimeline(room);
      const hydratedDisplayTimelineModel = buildRouteCDisplayTimelineModel({
        linkedTimelines: hydratedTimeline.linkedTimelines,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        readUptoEventId: readUptoEventIdRef.current,
        currentUserId: mx.getUserId(),
      });
      assertRouteCDisplayTimelineModelInvariant(hydratedDisplayTimelineModel);
      if (hydratedDisplayTimelineModel.items.length === 0) return;

      startInitialBottomSettle();
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
      setTimeline(hydratedTimeline);
    }, [
      eventId,
      displayItemsLength,
      room,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      mx,
      startInitialBottomSettle,
    ])
  );

  // Stay at bottom when room editor resize
  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      return (entries) => {
        if (!mounted) {
          // skip initial mounting call
          mounted = true;
          return;
        }
        if (!roomInputRef.current) return;
        const editorBaseEntry = getResizeObserverEntry(roomInputRef.current, entries);
        const scrollElement = getScrollElement();
        if (!editorBaseEntry || !scrollElement) return;

        if (shouldFollowTimelineBottom()) {
          scrollToTimelineBottom('instant');
        }
      };
    }, [getScrollElement, roomInputRef, scrollToTimelineBottom, shouldFollowTimelineBottom]),
    useCallback(() => roomInputRef.current, [roomInputRef])
  );

  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      return (entries) => {
        if (!mounted) {
          mounted = true;
          return;
        }
        const scrollContentElement = scrollContentRef.current;
        if (!scrollContentElement) return;
        const contentEntry = getResizeObserverEntry(scrollContentElement, entries);
        if (!contentEntry || !shouldFollowTimelineBottom()) return;
        scrollToTimelineBottom('instant');
      };
    }, [scrollToTimelineBottom, shouldFollowTimelineBottom]),
    useCallback(() => scrollContentRef.current, [])
  );

  const tryAutoMarkAsRead = useCallback(() => {
    const readUptoEventId = readUptoEventIdRef.current;
    if (!readUptoEventId) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideActivity));
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideActivity));
    }
  }, [mx, room, hideActivity]);

  const debounceSetAtBottom = useDebounce(
    useCallback(
      (entry: IntersectionObserverEntry) => {
        if (!entry.isIntersecting) {
          setAtBottom(false);
          if (!isTimelineAtOrNearBottom()) {
            followingLatestIntentRef.current = false;
          }
        }
      },
      [isTimelineAtOrNearBottom]
    ),
    { wait: 1000 }
  );
  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) debounceSetAtBottom(targetEntry);
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          followingLatestIntentRef.current = true;
          setAtBottom(true);
          if (document.hasFocus()) {
            tryAutoMarkAsRead();
          }
        }
      },
      [debounceSetAtBottom, tryAutoMarkAsRead]
    ),
    useCallback(
      () => ({
        root: getScrollElement(),
        rootMargin: OYSTERUN_ROUTE_C_BOTTOM_ANCHOR_ROOT_MARGIN,
      }),
      [getScrollElement]
    ),
    useCallback(() => atBottomAnchorRef.current, [])
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
        if (
          inFocus &&
          followingLatestIntentRef.current &&
          backgroundBottomSettlePendingRef.current
        ) {
          backgroundBottomSettlePendingRef.current = false;
          scrollToTimelineBottom('instant');
        }
        if (inFocus && atBottomRef.current) {
          if (unreadInfo?.inLiveTimeline) {
            handleOpenEvent(unreadInfo.readUptoEventId, false, (scrolled) => {
              // the unread event is already in view
              // so, try mark as read;
              if (!scrolled) {
                tryAutoMarkAsRead();
              }
            });
            return;
          }
          tryAutoMarkAsRead();
        }
      },
      [tryAutoMarkAsRead, unreadInfo, handleOpenEvent, scrollToTimelineBottom]
    )
  );

  useEffect(() => {
    resetOysterunLocalPathDisclosures();
    const handlePageShow = () => {
      resetOysterunLocalPathDisclosures();
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [resetOysterunLocalPathDisclosures]);

  useEffect(() => {
    const settleRouteCBackgroundBottomFollow = () => {
      if (
        document.visibilityState === 'visible' &&
        followingLatestIntentRef.current &&
        backgroundBottomSettlePendingRef.current
      ) {
        backgroundBottomSettlePendingRef.current = false;
        scrollToTimelineBottom('instant');
      }
    };

    document.addEventListener('visibilitychange', settleRouteCBackgroundBottomFollow);
    window.addEventListener('focus', settleRouteCBackgroundBottomFollow);
    return () => {
      document.removeEventListener('visibilitychange', settleRouteCBackgroundBottomFollow);
      window.removeEventListener('focus', settleRouteCBackgroundBottomFollow);
    };
  }, [scrollToTimelineBottom]);

  // Handle up arrow edit
  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (
          OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED &&
          isKeyHotkey('arrowup', evt) &&
          editableActiveElement() &&
          document.activeElement?.getAttribute('data-editable-name') === 'RoomInput' &&
          isEmptyEditor(editor)
        ) {
          const editableEvt = getLatestEditableEvt(room.getLiveTimeline(), (mEvt) =>
            canEditEvent(mx, mEvt)
          );
          const editableEvtId = editableEvt?.getId();
          if (!editableEvtId) return;
          setEditId(editableEvtId);
          evt.preventDefault();
        }
      },
      [mx, room, editor]
    )
  );

  useEffect(() => {
    if (eventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(eventId);
    }
  }, [eventId, loadEventTimeline]);

  // Scroll to bottom on initial timeline load
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl && !eventId) {
      startInitialBottomSettle();
      scrollToTimelineBottom('instant');
    }
  }, [eventId, scrollToTimelineBottom, startInitialBottomSettle]);

  // if live timeline is linked and unreadInfo change
  // Scroll to last read message
  useLayoutEffect(() => {
    const { readUptoEventId, inLiveTimeline, scrollTo } = unreadInfo ?? {};
    if (readUptoEventId && inLiveTimeline && scrollTo) {
      const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const evtTimeline = getEventTimeline(room, readUptoEventId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(linkedTimelines, evtTimeline, readUptoEventId);
      const displayIndex =
        displayTimelineModel.displayIndexByEventId.get(readUptoEventId) ??
        (typeof absoluteIndex === 'number'
          ? displayTimelineModel.rawEventIndexToDisplayIndex.get(absoluteIndex)
          : undefined);
      if (typeof displayIndex === 'number') {
        scrollToItem(displayIndex, {
          behavior: 'instant',
          align: 'start',
          stopInView: true,
        });
      }
    }
  }, [room, unreadInfo, displayTimelineModel, scrollToItem]);

  // scroll to focused message
  useLayoutEffect(() => {
    if (focusItem && focusItem.scrollTo) {
      scrollToItem(focusItem.index, {
        behavior: 'instant',
        align: 'center',
        stopInView: true,
      });
    }

    setTimeout(() => {
      if (!alive()) return;
      setFocusItem((currentItem) => {
        if (currentItem === focusItem) return undefined;
        return currentItem;
      });
    }, 2000);
  }, [alive, focusItem, scrollToItem]);

  // scroll to bottom of timeline
  const scrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (scrollToBottomCount > 0) {
      scrollToTimelineBottom(scrollToBottomRef.current.smooth ? 'smooth' : 'instant');
    }
  }, [scrollToBottomCount, scrollToTimelineBottom]);

  // Remove unreadInfo on mark as read
  useEffect(() => {
    if (!unread) {
      setUnreadInfo(undefined);
    }
  }, [unread]);

  // scroll out of view msg editor in view.
  useEffect(() => {
    if (editId) {
      const editMsgElement =
        (scrollRef.current?.querySelector(`[data-message-id="${editId}"]`) as HTMLElement) ??
        undefined;
      if (editMsgElement) {
        scrollToElement(editMsgElement, {
          align: 'center',
          behavior: 'smooth',
          stopInView: true,
        });
      }
    }
  }, [scrollToElement, editId]);

  const handleJumpToLatest = () => {
    followingLatestIntentRef.current = true;
    backgroundBottomSettlePendingRef.current = false;
    atBottomRef.current = true;
    setAtBottom(true);
    if (eventId) {
      const routeCChatPath = routeCChatShell ? getOysterunHostSessionChatPath() : undefined;
      if (routeCChatPath) {
        window.history.replaceState(window.history.state, '', routeCChatPath);
      } else {
        navigateRoom(room.roomId, undefined, { replace: true });
      }
    }
    setTimeline(getInitialTimeline(room));
    startInitialBottomSettle();
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  };

  const handleJumpToUnread = () => {
    if (unreadInfo?.readUptoEventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(unreadInfo.readUptoEventId);
    }
  };

  const handleMarkAsRead = () => {
    markAsRead(mx, room.roomId, hideActivity);
  };

  const handleRouteCTouchStart = useCallback(() => {
    routeCTouchActiveRef.current = true;
  }, []);

  const handleRouteCTouchEnd = useCallback(() => {
    routeCTouchActiveRef.current = false;
    remotePaginationTouchReleaseRequiredRef.current = false;
    flushDeferredRemotePaginationCommit();
    requestAnimationFrame(() => {
      if (!alive()) return;
      requestAnimationFrame(() => {
        if (!alive()) return;
        retrySuppressedPagination(true, true);
      });
    });
  }, [alive, flushDeferredRemotePaginationCommit, retrySuppressedPagination]);

  const handleOysterunInlineLinkClick: MouseEventHandler<HTMLDivElement> = useCallback((evt) => {
    if (!(evt.target instanceof Element)) return;
    const anchor = evt.target.closest<HTMLAnchorElement>(OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR);
    if (!anchor || !evt.currentTarget.contains(anchor)) {
      if (isOysterunLocalPathDisclosureDeadArea(evt.target)) {
        collapseOysterunLocalPathLinks(evt.currentTarget);
      }
      return;
    }
    const kind = anchor.getAttribute('data-oysterun-inline-link-kind');
    if (!isOysterunRouteCInlineLinkKind(kind)) return;
    if (
      isOysterunLocalPathDisclosureKind(kind) &&
      anchor.getAttribute('data-oysterun-inline-link-expanded') !== 'true'
    ) {
      evt.preventDefault();
      evt.stopPropagation();
      collapseOysterunLocalPathLinks(evt.currentTarget, anchor);
      expandOysterunLocalPathLink(anchor);
      return;
    }
    const routeTarget = readOysterunRouteCInlineLinkTarget(anchor, kind);
    if (!routeTarget) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (isOysterunLocalPathDisclosureKind(kind)) {
      resetOysterunLocalPathLinks(evt.currentTarget);
    }
    openOysterunRouteCInlineLinkTarget(routeTarget);
  }, []);

  const handleOysterunInlineLinkKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback(
    (evt) => {
      if (evt.key !== 'Escape') return;
      if (collapseOysterunLocalPathLinks(evt.currentTarget)) {
        evt.preventDefault();
        evt.stopPropagation();
      }
    },
    []
  );

  const handleOpenReply: MouseEventHandler = useCallback(
    async (evt) => {
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      handleOpenEvent(targetId);
    },
    [handleOpenEvent]
  );

  const handleUserClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      openUserRoomProfile(
        room.roomId,
        space?.roomId,
        userId,
        evt.currentTarget.getBoundingClientRect()
      );
    },
    [room, space, openUserRoomProfile]
  );
  const handleUsernameClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
      editor.insertNode(
        createMentionElement(
          userId,
          name.startsWith('@') ? name : `@${name}`,
          userId === mx.getUserId()
        )
      );
      ReactEditor.focus(editor);
      moveCursor(editor);
    },
    [mx, room, editor]
  );

  const handleReplyClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt, startThread = false) => {
      const replyId = evt.currentTarget.getAttribute('data-event-id');
      if (!replyId) {
        console.warn('Button should have "data-event-id" attribute!');
        return;
      }
      const replyEvt = room.findEventById(replyId);
      if (!replyEvt) return;
      const editedReply = getEditedEvent(replyId, replyEvt, room.getUnfilteredTimelineSet());
      const content: IContent = editedReply?.getContent()['m.new_content'] ?? replyEvt.getContent();
      const { body, formatted_body: formattedBody } = content;
      const { 'm.relates_to': relation } = startThread
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: replyId } }
        : replyEvt.getWireContent();
      const senderId = replyEvt.getSender();
      if (senderId && typeof body === 'string') {
        setReplyDraft({
          userId: senderId,
          eventId: replyId,
          body,
          formattedBody,
          relation,
        });
        setTimeout(() => ReactEditor.focus(editor), 100);
      }
    },
    [room, setReplyDraft, editor]
  );

  const handleReactionToggle = useCallback(
    (targetEventId: string, key: string, shortcode?: string) => {
      const relations = getEventReactions(room.getUnfilteredTimelineSet(), targetEventId);
      const allReactions = relations?.getSortedAnnotationsByKey() ?? [];
      const [, reactionsSet] = allReactions.find(([k]) => k === key) ?? [];
      const reactions = reactionsSet ? Array.from(reactionsSet) : [];
      const myReaction = reactions.find(factoryEventSentBy(mx.getUserId()!));

      if (myReaction && !!myReaction?.isRelation()) {
        mx.redactEvent(room.roomId, myReaction.getId()!);
        return;
      }
      const rShortcode =
        shortcode ||
        (reactions.find(eventWithShortcode)?.getContent().shortcode as string | undefined);
      mx.sendEvent(
        room.roomId,
        MessageEvent.Reaction as any,
        getReactionContent(targetEventId, key, rShortcode)
      );
    },
    [mx, room]
  );
  const handleEdit = useCallback(
    (editEvtId?: string) => {
      if (!OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED) {
        setEditId(undefined);
        return;
      }
      if (editEvtId) {
        setEditId(editEvtId);
        return;
      }
      setEditId(undefined);
      ReactEditor.focus(editor);
    },
    [editor]
  );
  const { t } = useTranslation();

  const renderMatrixEvent = useMatrixEventRenderer<
    [string, MatrixEvent, number, EventTimelineSet, boolean, OysterunToolCompression | undefined]
  >(
    {
      [MessageEvent.RoomMessage]: (
        mEventId,
        mEvent,
        item,
        timelineSet,
        collapse,
        oysterunToolCompression
      ) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const getContent = (() =>
          editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent()) as GetContentCallback;

        const senderId = mEvent.getSender() ?? '';
        const senderDisplayName =
          getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
        const oysterunCancelState = oysterunCancelControlsByEventId[mEventId];
        const oysterunCancelControl =
          oysterunCancelState && isOysterunCancelControlRenderStatus(oysterunCancelState.status)
            ? {
                status: oysterunCancelState.status,
                proof: oysterunCancelState.proof,
                error: oysterunCancelState.error,
                onCancel: handleOysterunHost2Cancel,
              }
            : undefined;
        const oysterunProviderControlOutcome = getOysterunProviderControlOutcomeForEvent(
          mEvent,
          oysterunProviderControlOutcomesByRequestId
        );

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED && editId === mEventId}
            canDelete={
              routeCChatShell
                ? false
                : canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())
            }
            canSendReaction={routeCChatShell ? false : canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={routeCChatShell ? undefined : hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED ? handleEdit : undefined}
            reply={
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              !routeCChatShell &&
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={routeCChatShell ? false : canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(senderId)}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
            oysterunCancelControl={oysterunCancelControl}
            oysterunHost2IntakeProof={oysterunCancelState?.proof}
            oysterunProviderControlOutcome={oysterunProviderControlOutcome}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <RenderMessageContent
                displayName={senderDisplayName}
                msgType={mEvent.getContent().msgtype ?? ''}
                ts={mEvent.getTs()}
                edited={!!editedEvent}
                getContent={getContent}
                mediaAutoLoad={mediaAutoLoad}
                urlPreview={showUrlPreview}
                htmlReactParserOptions={htmlReactParserOptions}
                linkifyOpts={linkifyOpts}
                outlineAttachment={messageLayout === MessageLayout.Bubble}
                oysterunControlOutcome={oysterunProviderControlOutcome}
                oysterunToolCompression={oysterunToolCompression}
              />
            )}
          </Message>
        );
      },
      [MessageEvent.RoomMessageEncrypted]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED && editId === mEventId}
            canDelete={
              routeCChatShell
                ? false
                : canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())
            }
            canSendReaction={routeCChatShell ? false : canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={routeCChatShell ? undefined : hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={OYSTERUN_ROUTE_C_PHASE1_EDIT_ENABLED ? handleEdit : undefined}
            reply={
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              !routeCChatShell &&
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={routeCChatShell ? false : canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            <EncryptedContent mEvent={mEvent}>
              {() => {
                if (mEvent.isRedacted()) return <RedactedContent />;
                if (mEvent.getType() === MessageEvent.Sticker)
                  return (
                    <MSticker
                      content={mEvent.getContent()}
                      renderImageContent={(props) => (
                        <ImageContent
                          {...props}
                          autoPlay={mediaAutoLoad}
                          renderImage={(p) => <Image {...p} loading="lazy" />}
                          renderViewer={(p) => <ImageViewer {...p} />}
                        />
                      )}
                    />
                  );
                if (mEvent.getType() === MessageEvent.RoomMessage) {
                  const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
                  const getContent = (() =>
                    editedEvent?.getContent()['m.new_content'] ??
                    mEvent.getContent()) as GetContentCallback;

                  const senderId = mEvent.getSender() ?? '';
                  const senderDisplayName =
                    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
                  const oysterunProviderControlOutcome = getOysterunProviderControlOutcomeForEvent(
                    mEvent,
                    oysterunProviderControlOutcomesByRequestId
                  );
                  return (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      msgType={mEvent.getContent().msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                      oysterunControlOutcome={oysterunProviderControlOutcome}
                    />
                  );
                }
                if (mEvent.getType() === MessageEvent.RoomMessageEncrypted)
                  return (
                    <Text>
                      <MessageNotDecryptedContent />
                    </Text>
                  );
                return (
                  <Text>
                    <MessageUnsupportedContent />
                  </Text>
                );
              }}
            </EncryptedContent>
          </Message>
        );
      },
      [MessageEvent.Sticker]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            canDelete={
              routeCChatShell
                ? false
                : canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())
            }
            canSendReaction={routeCChatShell ? false : canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={routeCChatShell ? undefined : hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            reactions={
              !routeCChatShell &&
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={routeCChatShell ? false : canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <MSticker
                content={mEvent.getContent()}
                renderImageContent={(props) => (
                  <ImageContent
                    {...props}
                    autoPlay={mediaAutoLoad}
                    renderImage={(p) => <Image {...p} loading="lazy" />}
                    renderViewer={(p) => <ImageViewer {...p} />}
                  />
                )}
              />
            )}
          </Message>
        );
      },
      [StateEvent.RoomMember]: (mEventId, mEvent, item) => {
        const membershipChanged = isMembershipChanged(mEvent);
        if (membershipChanged && hideMembershipEvents) return null;
        if (!membershipChanged && hideNickAvatarEvents) return null;

        const highlighted = focusItem?.index === item && focusItem.highlight;
        const parsed = parseMemberEvent(mEvent);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={routeCChatShell ? false : canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={parsed.icon}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    {parsed.body}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomName]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={routeCChatShell ? false : canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {t('Organisms.RoomCommon.changed_room_name')}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomTopic]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={routeCChatShell ? false : canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room topic'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomAvatar]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={routeCChatShell ? false : canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room avatar'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.GroupCallMemberPrefix]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const content = mEvent.getContent<SessionMembershipData>();
        const prevContent = mEvent.getPrevContent();

        const callJoined = content.application;
        if (callJoined && 'application' in prevContent) {
          return null;
        }

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={routeCChatShell ? false : canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={callJoined ? Icons.Phone : Icons.PhoneDown}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {callJoined ? ' joined the call' : ' ended the call'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={routeCChatShell ? false : canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' state event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      if (Object.keys(mEvent.getContent()).length === 0) return null;
      if (mEvent.getRelation()) return null;
      if (mEvent.isRedaction()) return null;

      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={routeCChatShell ? false : canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    }
  );

  const renderDisplayTimelineItem = (displayIndex: number) => {
    const displayItem = displayItems[displayIndex];
    if (!displayItem) {
      throw new Error(`Route C display item ${displayIndex} is missing from the display model`);
    }

    if (displayItem.kind === 'new_messages_divider') {
      return (
        <MessageBase
          key={displayItem.id}
          data-message-item={displayItem.displayIndex}
          space={messageSpacing}
        >
          <TimelineDivider style={{ color: color.Success.Main }} variant="Inherit">
            <Badge as="span" size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">New Messages</Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      );
    }

    if (displayItem.kind === 'day_divider') {
      return (
        <MessageBase
          key={displayItem.id}
          data-message-item={displayItem.displayIndex}
          space={messageSpacing}
        >
          <TimelineDivider variant="Surface">
            <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
              <Text size="L400">
                {(() => {
                  if (today(displayItem.ts)) return 'Today';
                  if (yesterday(displayItem.ts)) return 'Yesterday';
                  return timeDayMonthYear(displayItem.ts);
                })()}
              </Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      );
    }

    if (!isRouteCDisplayTimelineEventItem(displayItem)) {
      throw new Error(`Route C display item ${displayIndex} is not renderable as a matrix event`);
    }

    if (displayItem.kind === 'compressed_tool_placeholder') {
      return (
        <div
          key={displayItem.id}
          data-message-item={displayItem.displayIndex}
          data-message-id={displayItem.mEventId}
          data-oysterun-routec-compressed-tool-placeholder="true"
          data-oysterun-clean-session-compressed-tool-placeholder="true"
          aria-hidden="true"
          tabIndex={-1}
          style={{
            visibility: 'hidden',
            height: OYSTERUN_ROUTE_C_COMPRESSED_TOOL_PLACEHOLDER_HEIGHT_PX,
            minHeight: OYSTERUN_ROUTE_C_COMPRESSED_TOOL_PLACEHOLDER_HEIGHT_PX,
            maxHeight: OYSTERUN_ROUTE_C_COMPRESSED_TOOL_PLACEHOLDER_HEIGHT_PX,
            margin: 0,
            padding: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      );
    }

    return renderMatrixEvent(
      displayItem.mEvent.getType(),
      typeof displayItem.mEvent.getStateKey() === 'string',
      displayItem.mEventId,
      displayItem.mEvent,
      displayItem.displayIndex,
      displayItem.timelineSet,
      displayItem.collapse,
      displayItem.oysterunToolCompression
    );
  };

  return (
    <Box
      grow="Yes"
      style={{ position: 'relative' }}
      {...buildOysterunTimelineRootProofAttributes(room.roomId)}
    >
      {unreadInfo?.readUptoEventId && !unreadInfo?.inLiveTimeline && (
        <TimelineFloat position="Top">
          <Chip
            variant="Primary"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.MessageUnread} />}
            onClick={handleJumpToUnread}
          >
            <Text size="L400">Jump to Unread</Text>
          </Chip>

          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.CheckTwice} />}
            onClick={handleMarkAsRead}
          >
            <Text size="L400">Mark as Read</Text>
          </Chip>
        </TimelineFloat>
      )}
      <Scroll
        ref={scrollRef}
        visibility={mobileScrollbarVisible ? 'Always' : 'Hover'}
        size={mobileScrollbarVisible ? '300' : undefined}
        direction="Vertical"
        data-testid="oysterun-routec-timeline-scroll"
        data-oysterun-clean-session-testid="oysterun-clean-session-timeline-scroll"
        data-oysterun-routec-mobile-scrollbar-visible={String(mobileScrollbarVisible)}
        data-oysterun-clean-session-mobile-scrollbar-visible={String(mobileScrollbarVisible)}
        data-oysterun-routec-bottom-proof-surface="scroll_container"
        data-oysterun-clean-session-bottom-proof-surface="scroll_container"
        onScroll={handleTimelineScroll}
        onTouchStart={handleRouteCTouchStart}
        onTouchEnd={handleRouteCTouchEnd}
        onTouchCancel={handleRouteCTouchEnd}
        data-oysterun-routec-bottom-pinned={String(atBottom)}
        data-oysterun-clean-session-bottom-pinned={String(atBottom)}
        data-oysterun-routec-at-bottom={String(atBottom)}
        data-oysterun-clean-session-at-bottom={String(atBottom)}
        data-oysterun-routec-ios-scroll-paint-nudge-enabled={String(
          routeCIOSScrollPaintNudgeEnabled
        )}
        data-oysterun-clean-session-ios-scroll-paint-nudge-enabled={String(
          routeCIOSScrollPaintNudgeEnabled
        )}
      >
        <Box
          ref={scrollContentRef}
          direction="Column"
          justifyContent="End"
          style={{ minHeight: '100%', padding: `${config.space.S600} 0` }}
          data-testid="oysterun-routec-timeline-scroll-content"
          data-oysterun-clean-session-testid="oysterun-clean-session-timeline-scroll-content"
          data-oysterun-routec-bottom-proof-surface="scroll_content"
          data-oysterun-clean-session-bottom-proof-surface="scroll_content"
          onClick={handleOysterunInlineLinkClick}
          onKeyDown={handleOysterunInlineLinkKeyDown}
        >
          {!routeCChatShell &&
            !canPaginateBack &&
            rangeAtStart &&
            visibleDisplayItems.length > 0 && (
              <div
                style={{
                  padding: `${config.space.S700} ${config.space.S400} ${config.space.S600} ${
                    messageLayout === MessageLayout.Compact ? config.space.S400 : toRem(64)
                  }`,
                }}
              >
                <RoomIntro room={room} />
              </div>
            )}
          {shouldShowRouteCEmptyComposerGuidance && (
            <RouteCEmptyComposerGuidance
              displayItemsLength={displayItemsLength}
              displayRange={displayRange}
            />
          )}
          {(canPaginateBack || !rangeAtStart) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase>
                  <DefaultPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <DefaultPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
              </>
            ))}

          {visibleDisplayItems.map(renderDisplayTimelineItem)}

          {(!liveTimelineLinked || !rangeAtEnd) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <DefaultPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={visibleDisplayItems.length} />
                </MessageBase>
              </>
            ))}
          <span
            ref={atBottomAnchorRef}
            data-testid="oysterun-routec-timeline-bottom-anchor"
            data-oysterun-clean-session-testid="oysterun-clean-session-timeline-bottom-anchor"
            data-oysterun-routec-bottom-proof-surface="intersection_anchor"
            data-oysterun-clean-session-bottom-proof-surface="intersection_anchor"
            data-oysterun-routec-at-bottom={String(atBottom)}
            data-oysterun-clean-session-at-bottom={String(atBottom)}
          />
        </Box>
      </Scroll>
      {!atBottom && (
        <TimelineFloat position="Bottom">
          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.ArrowBottom} />}
            onClick={handleJumpToLatest}
            data-testid="oysterun-routec-jump-to-latest"
            data-oysterun-clean-session-testid="oysterun-clean-session-jump-to-latest"
            data-oysterun-routec-jump-control="latest"
            data-oysterun-clean-session-jump-control="latest"
            data-oysterun-routec-jump-visibility-gate="not_at_bottom"
            data-oysterun-clean-session-jump-visibility-gate="not_at_bottom"
            data-oysterun-routec-jump-target="timeline_bottom"
            data-oysterun-clean-session-jump-target="timeline_bottom"
            data-oysterun-routec-bottom-proof-surface="jump_to_latest_control"
            data-oysterun-clean-session-bottom-proof-surface="jump_to_latest_control"
          >
            <Text size="L400">Jump to Latest</Text>
          </Chip>
        </TimelineFloat>
      )}
    </Box>
  );
}
