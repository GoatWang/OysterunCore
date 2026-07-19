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
import { editableActiveElement, scrollToBottom } from '../../utils/dom';
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
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import {
  cancelOysterunHost2Intake,
  commitOysterunCancelSemanticSourceHooks,
  getOysterunHostOwnerMessageNeighbors,
  getOysterunHostSessionChatFocusEventId,
  getOysterunHostSessionChatFocusPath,
  getOysterunHostSessionChatPath,
  getOysterunHostSessionBrowserPathOrTargetFallback,
  getOysterunHostSessionRouteSearch,
  isOysterunRouteCViewportGeometryDiagnosticsEnabled,
  recordOysterunCancelControlProof,
  recordOysterunRouteCViewportGeometryDiagnostic,
  requestOysterunActiveRoomTimelineFocus,
  subscribeOysterunActiveRoomTimelineFocus,
  type OysterunHostOwnerMessageNeighborsResponse,
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
import { normalizeOysterunInternalAppRouteTarget } from '../../../oysterun/OysterunInternalAppRoute';
import { useOysterunIOSRemotePaginationTransaction } from '../../../oysterun/useOysterunIOSRemotePaginationTransaction';
import type {
  OysterunSemanticControlOutcome,
  OysterunSemanticPayload,
} from '../../../oysterun/OysterunSemanticRenderer';
import { isOysterunProviderCompletionMarkerContent } from '../../../oysterun/OysterunSemanticRenderer';

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
  ),
);

const TimelineDivider = as<'div', { variant?: ContainerColor | 'Inherit' }>(
  ({ variant, children, ...props }, ref) => (
    <Box gap="100" justifyContent="Center" alignItems="Center" {...props} ref={ref}>
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
      {children}
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
    </Box>
  ),
);

type RouteCEmptyComposerGuidanceProps = {
  rawEventCount: number;
  rawEventRange: ItemRange;
  productVisibleEventCount: number;
};

function RouteCEmptyComposerGuidance({
  rawEventCount,
  rawEventRange,
  productVisibleEventCount,
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
      data-oysterun-routec-empty-guidance-raw-events={String(rawEventCount)}
      data-oysterun-clean-session-empty-guidance-raw-events={String(rawEventCount)}
      data-oysterun-routec-empty-guidance-range={`${rawEventRange.start}-${rawEventRange.end}`}
      data-oysterun-clean-session-empty-guidance-range={`${rawEventRange.start}-${rawEventRange.end}`}
      data-oysterun-routec-empty-guidance-product-visible-events={String(productVisibleEventCount)}
      data-oysterun-clean-session-empty-guidance-product-visible-events={String(
        productVisibleEventCount,
      )}
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
  direction: Direction,
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
  index: number,
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
  eventId: string,
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
const OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR = 'a[data-oysterun-inline-link-kind]';
const OYSTERUN_ROUTE_C_LOCAL_PATH_DISCLOSURE_SELECTOR = `${OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR}[data-oysterun-local-path-disclosure]`;
const OYSTERUN_ROUTE_C_HOST_OWNER_NEIGHBOR_LOOKUP_DEBOUNCE_MS = 320;
const OYSTERUN_ROUTE_C_HOST_OWNER_FOCUS_SCROLL_GUARD_MS = 1600;
const OYSTERUN_ROUTE_C_VIEWPORT_DIAGNOSTIC_SCROLL_WINDOW_MS = 1_200;
const OYSTERUN_ROUTE_C_VIEWPORT_DIAGNOSTIC_SCROLL_THROTTLE_MS = 100;

type RouteCLiveBottomTransaction = {
  revision: number;
  matrixEventId?: string;
  previousMaxScrollTop: number;
};

type RouteCLiveBottomTransactionDiagnostic = {
  phase: 'queued' | 'committed' | 'cancelled';
  revision: number;
  matrixEventId?: string;
  previousMaxScrollTop: number;
  currentMaxScrollTop?: number;
  behavior?: 'instant' | 'smooth';
};

type RouteCHostOwnerNeighborAnchor =
  | {
      kind: 'event';
      eventId: string;
      source: 'focus_event_id' | 'viewport_center' | 'latest_visible';
    }
  | {
      kind: 'latest';
      source: 'anchor_position_latest';
    };

type RouteCHostOwnerNeighborState = {
  loading: boolean;
  error: string | null;
  response: OysterunHostOwnerMessageNeighborsResponse | null;
  anchorKey: string | null;
  disabledReason: string | null;
};

type OysterunRouteCInlineLinkKind =
  'file_preview_link' | 'directory_link' | 'browser_link' | 'internal_app_route' | 'external_url';

function isOysterunRouteCInlineLinkKind(
  value: string | null,
): value is OysterunRouteCInlineLinkKind {
  return (
    value === 'file_preview_link' ||
    value === 'directory_link' ||
    value === 'browser_link' ||
    value === 'internal_app_route' ||
    value === 'external_url'
  );
}

function isOysterunCleanSessionRoutePath(
  pathname: string,
  expectedSurface: 'file-preview' | 'explorer',
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
  kind: OysterunRouteCInlineLinkKind,
): string | undefined {
  if (kind === 'external_url') return undefined;
  const rawTarget =
    anchor.getAttribute('data-oysterun-inline-link-target') || anchor.getAttribute('href');
  if (!rawTarget) return undefined;
  if (kind === 'internal_app_route') {
    return normalizeOysterunInternalAppRouteTarget(rawTarget, window.location.origin);
  }
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
  window.open(
    new URL(routeTarget, window.location.origin).toString(),
    '_blank',
    'noopener,noreferrer',
  );
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
      `${OYSTERUN_ROUTE_C_INLINE_LINK_SELECTOR}[data-oysterun-inline-link-expanded="true"]`,
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
    ].join(','),
  );
}

type Timeline = {
  linkedTimelines: EventTimeline[];
  range: ItemRange;
};

type RouteCProductVisibleEventOptions = {
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
};

function isRouteCProductVisibleTimelineEvent(
  mEvent: MatrixEvent,
  {
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
  }: RouteCProductVisibleEventOptions,
): boolean {
  const sender = mEvent.getSender();
  if (sender && ignoredUsersSet.has(sender)) return false;
  if (isOysterunProviderCompletionMarkerContent(mEvent.getContent())) return false;
  if (mEvent.isRedacted()) return showHiddenEvents;
  if (reactionOrEditEvent(mEvent)) return false;

  const eventType = mEvent.getType();
  if (eventType === StateEvent.RoomMember) {
    return isMembershipChanged(mEvent) ? !hideMembershipEvents : !hideNickAvatarEvents;
  }
  if (
    eventType === MessageEvent.RoomMessage ||
    eventType === MessageEvent.RoomMessageEncrypted ||
    eventType === MessageEvent.Sticker ||
    eventType === StateEvent.RoomName ||
    eventType === StateEvent.RoomTopic ||
    eventType === StateEvent.RoomAvatar
  ) {
    return true;
  }
  if (eventType === StateEvent.GroupCallMemberPrefix) {
    const content = mEvent.getContent<SessionMembershipData>();
    return !(content.application && 'application' in mEvent.getPrevContent());
  }
  if (!showHiddenEvents) return false;
  if (typeof mEvent.getStateKey() === 'string') return true;
  if (Object.keys(mEvent.getContent()).length === 0) return false;
  if (mEvent.getRelation() || mEvent.isRedaction()) return false;
  return true;
}

function getRouteCProductVisibleEventCount(
  linkedTimelines: EventTimeline[],
  options: RouteCProductVisibleEventOptions,
): number {
  return linkedTimelines.reduce(
    (count, linkedTimeline) =>
      count +
      linkedTimeline
        .getEvents()
        .filter((mEvent) => isRouteCProductVisibleTimelineEvent(mEvent, options)).length,
    0,
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

function isOysterunHostOwnerTimelineMessageEvent(mEvent: MatrixEvent): boolean {
  if (mEvent.getType() !== MessageEvent.RoomMessage) return false;
  const unsigned = mEvent.getUnsigned() as Record<string, unknown>;
  return (
    unsigned.routec_matrix_actor_key === 'human' && unsigned.routec_matrix_actor_kind === 'human'
  );
}

function getRouteCRawTimelineEventAtIndex(
  linkedTimelines: EventTimeline[],
  index: number,
): MatrixEvent | undefined {
  const [eventTimeline, baseIndex] = getTimelineAndBaseIndex(linkedTimelines, index);
  if (!eventTimeline) return undefined;
  return getTimelineEvent(eventTimeline, getTimelineRelativeIndex(index, baseIndex));
}

function getRouteCViewportCenterEventId(
  scrollElement: HTMLElement | null,
  linkedTimelines: EventTimeline[],
): string | undefined {
  if (!scrollElement) return undefined;
  const viewportRect = scrollElement.getBoundingClientRect();
  const viewportCenter = viewportRect.top + viewportRect.height / 2;
  let closest:
    | {
        distance: number;
        eventId: string;
      }
    | undefined;

  scrollElement.querySelectorAll<HTMLElement>('[data-message-item]').forEach((element) => {
    const index = Number(element.getAttribute('data-message-item'));
    if (!Number.isSafeInteger(index) || index < 0) return;
    const eventId = getRouteCRawTimelineEventAtIndex(linkedTimelines, index)?.getId();
    if (!eventId) return;
    const rect = element.getBoundingClientRect();
    if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom) return;
    const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
    if (!closest || distance < closest.distance) {
      closest = { distance, eventId };
    }
  });

  return closest?.eventId;
}

function getRouteCViewportVisibleEventIds(
  scrollElement: HTMLElement,
  linkedTimelines: EventTimeline[],
): {
  count: number;
  firstEventId?: string;
  centerEventId?: string;
  lastEventId?: string;
} {
  const viewportRect = scrollElement.getBoundingClientRect();
  const viewportCenter = viewportRect.top + viewportRect.height / 2;
  const visible: Array<{
    eventId: string;
    top: number;
    bottom: number;
    centerDistance: number;
  }> = [];
  scrollElement.querySelectorAll<HTMLElement>('[data-message-item]').forEach((element) => {
    const index = Number(element.getAttribute('data-message-item'));
    if (!Number.isSafeInteger(index) || index < 0) return;
    const eventId = getRouteCRawTimelineEventAtIndex(linkedTimelines, index)?.getId();
    if (!eventId) return;
    const rect = element.getBoundingClientRect();
    if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom) return;
    visible.push({
      eventId,
      top: rect.top,
      bottom: rect.bottom,
      centerDistance: Math.abs(rect.top + rect.height / 2 - viewportCenter),
    });
  });
  visible.sort((left, right) => left.top - right.top || left.bottom - right.bottom);
  const center = visible.reduce<(typeof visible)[number] | undefined>(
    (closest, current) =>
      !closest || current.centerDistance < closest.centerDistance ? current : closest,
    undefined,
  );
  return {
    count: visible.length,
    firstEventId: visible[0]?.eventId,
    centerEventId: center?.eventId,
    lastEventId: visible[visible.length - 1]?.eventId,
  };
}

function getRouteCHostOwnerNeighborAnchor({
  focusEventId,
  viewportEventId,
  linkedTimelines,
  visibleEventIndexes,
}: {
  focusEventId: string | undefined;
  viewportEventId: string | undefined;
  linkedTimelines: EventTimeline[];
  visibleEventIndexes: number[];
}): RouteCHostOwnerNeighborAnchor {
  if (focusEventId) {
    return {
      kind: 'event',
      eventId: focusEventId,
      source: 'focus_event_id',
    };
  }

  if (viewportEventId) {
    return {
      kind: 'event',
      eventId: viewportEventId,
      source: 'viewport_center',
    };
  }

  const visibleEvents = visibleEventIndexes
    .map((index) => getRouteCRawTimelineEventAtIndex(linkedTimelines, index))
    .filter((event): event is MatrixEvent => Boolean(event));
  const centerEventId = visibleEvents[Math.floor(visibleEvents.length / 2)]?.getId();
  if (centerEventId) {
    return {
      kind: 'event',
      eventId: centerEventId,
      source: 'viewport_center',
    };
  }

  for (let index = visibleEvents.length - 1; index >= 0; index -= 1) {
    const latestVisibleEventId = visibleEvents[index]?.getId();
    if (latestVisibleEventId) {
      return {
        kind: 'event',
        eventId: latestVisibleEventId,
        source: 'latest_visible',
      };
    }
  }

  return {
    kind: 'latest',
    source: 'anchor_position_latest',
  };
}

function getRouteCHostOwnerNeighborAnchorKey(anchor: RouteCHostOwnerNeighborAnchor): string {
  return anchor.kind === 'event'
    ? `${anchor.kind}:${anchor.eventId}:${anchor.source}`
    : `${anchor.kind}:${anchor.source}`;
}

function getRouteCHostOwnerNeighborWindowExhausted(
  response: OysterunHostOwnerMessageNeighborsResponse | null,
  direction: 'previous' | 'next',
): boolean {
  if (!response) return false;
  const boundaryValue =
    direction === 'previous'
      ? response.boundaries.previous_window_exhausted
      : response.boundaries.next_window_exhausted;
  const proofValue =
    direction === 'previous'
      ? response.proof.previous_window_exhausted
      : response.proof.next_window_exhausted;
  return boundaryValue === true || proofValue === true;
}

function getRouteCHostOwnerNeighborDisabledReason(
  response: OysterunHostOwnerMessageNeighborsResponse | null,
  direction: 'previous' | 'next',
  loading: boolean,
  fallback: string | null,
): string {
  if (loading) return 'loading';
  if (!response) return fallback ?? 'not_ready';
  const target = direction === 'previous' ? response.previous : response.next;
  if (target?.event_id) return '';
  if (getRouteCHostOwnerNeighborWindowExhausted(response, direction)) {
    return `${direction}_window_exhausted`;
  }
  if (response.boundaries.no_host_owner_messages) return 'no_host_owner_messages';
  if (direction === 'previous' && response.boundaries.at_first_host_owner_message) {
    return 'at_first_host_owner_message';
  }
  if (direction === 'next' && response.boundaries.at_latest_host_owner_message) {
    return 'at_latest_host_owner_message';
  }
  return `no_${direction}_host_owner_message`;
}

function getRouteCHostOwnerNeighborTitle({
  direction,
  disabledReason,
}: {
  direction: 'previous' | 'next';
  disabledReason: string;
}): string {
  if (!disabledReason) {
    return direction === 'previous' ? 'Previous Host Owner message' : 'Next Host Owner message';
  }
  if (disabledReason === 'loading') return 'Loading Host Owner messages';
  if (disabledReason === 'previous_window_exhausted') {
    return 'No nearby previous Host Owner message found. Scroll closer or use search.';
  }
  if (disabledReason === 'next_window_exhausted') {
    return 'No nearby next Host Owner message found. Scroll closer or use search.';
  }
  if (disabledReason === 'at_first_host_owner_message') {
    return 'Already at first Host Owner message';
  }
  if (disabledReason === 'at_latest_host_owner_message') {
    return 'Already at latest Host Owner message';
  }
  if (disabledReason === 'no_host_owner_messages') return 'No Host Owner messages found';
  return direction === 'previous'
    ? 'No previous Host Owner message found'
    : 'No next Host Owner message found';
}

function oysterunUniqueEventIds(eventIds: string[]): string[] {
  return Array.from(new Set(eventIds));
}

function isOysterunEventId(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function collectOysterunHost2TimelineCandidateEventIds(
  mx: MatrixClient,
  linkedTimelines: EventTimeline[],
): string[] {
  return oysterunUniqueEventIds(
    linkedTimelines.flatMap((linkedTimeline) =>
      linkedTimeline
        .getEvents()
        .filter((candidateEvent) => isOysterunCancelableUserTextEvent(mx, candidateEvent))
        .map((candidateEvent) => candidateEvent.getId())
        .filter(isOysterunEventId),
    ),
  );
}

function collectOysterunHost2RenderedCandidateEventIds(
  mx: MatrixClient,
  linkedTimelines: EventTimeline[],
  renderedEventIndexes: number[],
): string[] {
  return oysterunUniqueEventIds(
    renderedEventIndexes
      .map((index) => {
        const candidateEvent = getRouteCRawTimelineEventAtIndex(linkedTimelines, index);
        if (!candidateEvent || !isOysterunCancelableUserTextEvent(mx, candidateEvent)) {
          return undefined;
        }
        return candidateEvent.getId();
      })
      .filter(isOysterunEventId),
  );
}

function getOysterunEventSemanticPayload(mEvent: MatrixEvent): OysterunSemanticPayload | undefined {
  const content = mEvent.getContent();
  const payload = content?.[OYSTERUN_SEMANTIC_NAMESPACE];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return payload as OysterunSemanticPayload;
}

function collectOysterunProviderControlOutcomes(
  linkedTimelines: EventTimeline[],
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
  outcomes: Record<string, OysterunSemanticControlOutcome>,
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

function mergeOysterunHost2CancelCandidateEventIds({
  timelineCandidateEventIds,
  renderedCandidateEventIds,
}: {
  timelineCandidateEventIds: string[];
  renderedCandidateEventIds: string[];
}): string[] {
  const timelineTail = timelineCandidateEventIds.slice(-OYSTERUN_HOST2_CANCEL_CANDIDATE_LIMIT);
  const renderedTail = renderedCandidateEventIds.slice(
    -OYSTERUN_HOST2_CANCEL_RENDERED_CANDIDATE_LIMIT,
  );
  return oysterunUniqueEventIds([...timelineTail, ...renderedTail]);
}

const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], evtAbsIndex: number) => void,
  onError: (err: Error | null) => void,
) => {
  const loadEventTimeline = useCallback(
    async (eventId: string) => {
      const [err, replyEvtTimeline] = await to(
        mx.getEventTimeline(room.getUnfilteredTimelineSet(), eventId),
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
    [mx, room, onLoad, onError],
  );

  return loadEventTimeline;
};

const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Timeline,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number,
  beforeCommit?: () => Promise<void>,
) => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const alive = useAlive();

  const handleTimelinePagination = useMemo(() => {
    let fetching = false;

    const recalibratePagination = (
      linkedTimelines: EventTimeline[],
      timelinesEventsCount: number[],
      backwards: boolean,
    ) => {
      const topTimeline = linkedTimelines[0];
      const timelineMatch = (mt: EventTimeline) => (t: EventTimeline) => t === mt;

      const newLTimelines = getLinkedTimelines(topTimeline);
      const topTmIndex = newLTimelines.findIndex(timelineMatch(topTimeline));
      const topAddedTm = topTmIndex === -1 ? [] : newLTimelines.slice(0, topTmIndex);

      const topTmAddedEvt =
        timelineToEventsCount(newLTimelines[topTmIndex]) - timelinesEventsCount[0];
      const offsetRange = getTimelinesEventsCount(topAddedTm) + (backwards ? topTmAddedEvt : 0);

      setTimeline((currentTimeline) => ({
        linkedTimelines: newLTimelines,
        range:
          offsetRange > 0
            ? {
                start: currentTimeline.range.start + offsetRange,
                end: currentTimeline.range.end + offsetRange,
              }
            : { ...currentTimeline.range },
      }));
    };

    return async (backwards: boolean) => {
      if (fetching) return false;
      const { linkedTimelines: lTimelines } = timelineRef.current;
      const timelinesEventsCount = lTimelines.map(timelineToEventsCount);

      const timelineToPaginate = backwards ? lTimelines[0] : lTimelines[lTimelines.length - 1];
      if (!timelineToPaginate) return false;

      const paginationToken = timelineToPaginate.getPaginationToken(
        backwards ? Direction.Backward : Direction.Forward,
      );
      if (
        !paginationToken &&
        getTimelinesEventsCount(lTimelines) !==
          getTimelinesEventsCount(getLinkedTimelines(timelineToPaginate))
      ) {
        await beforeCommit?.();
        if (!alive()) return false;
        recalibratePagination(lTimelines, timelinesEventsCount, backwards);
        return true;
      }

      fetching = true;
      try {
        const [err] = await to(
          mx.paginateEventTimeline(timelineToPaginate, {
            backwards,
            limit,
          }),
        );
        if (err) {
          // TODO: handle pagination error.
          return false;
        }
        const fetchedTimeline =
          timelineToPaginate.getNeighbouringTimeline(
            backwards ? Direction.Backward : Direction.Forward,
          ) ?? timelineToPaginate;
        // Decrypt all event ahead of render cycle
        const roomId = fetchedTimeline.getRoomId();
        const room = roomId ? mx.getRoom(roomId) : null;

        if (room?.hasEncryptionStateEvent()) {
          await to(decryptAllTimelineEvent(mx, fetchedTimeline));
        }

        const nextLinkedTimelines = getLinkedTimelines(timelineToPaginate);
        const changed =
          getTimelinesEventsCount(nextLinkedTimelines) !==
            timelinesEventsCount.reduce((total, eventCount) => total + eventCount, 0) ||
          nextLinkedTimelines.length !== lTimelines.length ||
          nextLinkedTimelines.some((linkedTimeline, index) => linkedTimeline !== lTimelines[index]);
        if (!alive() || !changed) return false;
        await beforeCommit?.();
        if (!alive()) return false;
        recalibratePagination(lTimelines, timelinesEventsCount, backwards);
        return true;
      } finally {
        fetching = false;
      }
    };
  }, [mx, alive, setTimeline, limit, beforeCommit]);
  return handleTimelinePagination;
};

const useLiveEventArrive = (room: Room, onArrive: (mEvent: MatrixEvent) => void) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data,
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
    range: {
      start: Math.max(evLength - PAGINATION_LIMIT, 0),
      end: evLength,
    },
  };
};

const getEmptyTimeline = () => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
});

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

export function RoomTimeline({
  room,
  eventId,
  roomInputRef,
  editor,
  routeCRespondingState,
}: RoomTimelineProps) {
  const mx = useMatrixClient();
  const routeCChatShell = Boolean(getOysterunHostSessionRouteSearch());
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
    powerLevelTags,
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
  const atBottomAnchorRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const routeCHostOwnerFocusUntilRef = useRef(0);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });
  const routeCViewportDiagnosticWindowUntilRef = useRef(0);
  const routeCViewportDiagnosticLastScrollAtRef = useRef(0);
  const routeCViewportDiagnosticWriteErrorReportedRef = useRef(false);
  const routeCLiveBottomTransactionRevisionRef = useRef(0);
  const routeCLiveBottomTransactionRef = useRef<RouteCLiveBottomTransaction>();
  const routeCLiveBottomTransactionFrameRef = useRef<number>();

  const [focusItem, setFocusItem] = useState<
    | {
        index: number;
        scrollTo: boolean;
        highlight: boolean;
      }
    | undefined
  >();
  const [routeCHostOwnerFocusedAnchorEventId, setRouteCHostOwnerFocusedAnchorEventId] =
    useState<string>();
  const [routeCHostOwnerViewportAnchorEventId, setRouteCHostOwnerViewportAnchorEventId] =
    useState<string>();
  const routeCHostOwnerViewportMeasureFrameRef = useRef<number>();
  const alive = useAlive();

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler)),
      ),
    }),
    [mx, room, mentionClickHandler],
  );
  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [mx, room, linkifyOpts, spoilerClickHandler, mentionClickHandler, useAuthentication],
  );
  const parseMemberEvent = useMemberEventParser();

  const [timeline, setTimeline] = useState<Timeline>(() =>
    eventId ? getEmptyTimeline() : getInitialTimeline(room),
  );
  const eventsLength = getTimelinesEventsCount(timeline.linkedTimelines);
  const routeCProductVisibleEventCount = getRouteCProductVisibleEventCount(
    timeline.linkedTimelines,
    {
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
    },
  );
  const [routeCHostOwnerNeighborState, setRouteCHostOwnerNeighborState] =
    useState<RouteCHostOwnerNeighborState>({
      loading: false,
      error: null,
      response: null,
      anchorKey: null,
      disabledReason: 'not_ready',
    });
  const [routeCHostOwnerNeighborInvalidationSeq, setRouteCHostOwnerNeighborInvalidationSeq] =
    useState(0);
  const routeCHostOwnerNeighborRequestSeqRef = useRef(0);
  const routeCHostOwnerNeighborActiveRequestRef = useRef(false);
  const routeCHostOwnerNeighborPendingRequestRef = useRef<
    | {
        anchor: RouteCHostOwnerNeighborAnchor;
        anchorKey: string;
      }
    | undefined
  >();
  const [oysterunCancelControlsByEventId, setOysterunCancelControlsByEventId] = useState<
    Record<string, OysterunHost2CancelControlState>
  >({});
  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const rangeAtStart = timeline.range.start === 0;
  const rangeAtEnd = timeline.range.end === eventsLength;
  const atLiveEndRef = useRef(liveTimelineLinked && rangeAtEnd);
  atLiveEndRef.current = liveTimelineLinked && rangeAtEnd;
  const routeCViewportGeometryDiagnosticsEnabled =
    routeCChatShell && isOysterunRouteCViewportGeometryDiagnosticsEnabled();
  const routeCViewportGeometryStateRef = useRef({
    linkedTimelines: timeline.linkedTimelines,
    rangeStart: timeline.range.start,
    rangeEnd: timeline.range.end,
    eventsLength,
    atBottom,
    liveTimelineLinked,
    rangeAtStart,
    rangeAtEnd,
  });
  routeCViewportGeometryStateRef.current = {
    linkedTimelines: timeline.linkedTimelines,
    rangeStart: timeline.range.start,
    rangeEnd: timeline.range.end,
    eventsLength,
    atBottom,
    liveTimelineLinked,
    rangeAtStart,
    rangeAtEnd,
  };

  const recordRouteCViewportGeometry = useCallback(
    (
      trigger: string,
      matrixEvent?: MatrixEvent,
      transaction?: RouteCLiveBottomTransactionDiagnostic,
    ) => {
      if (!routeCViewportGeometryDiagnosticsEnabled) return;
      const scrollElement = scrollRef.current;
      const scrollContent = scrollContentRef.current;
      const bottomAnchor = atBottomAnchorRef.current;
      if (!scrollElement || !scrollContent || !bottomAnchor) return;
      const state = routeCViewportGeometryStateRef.current;
      const viewportRect = scrollElement.getBoundingClientRect();
      const bottomAnchorRect = bottomAnchor.getBoundingClientRect();
      const visible = getRouteCViewportVisibleEventIds(scrollElement, state.linkedTimelines);
      const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      void recordOysterunRouteCViewportGeometryDiagnostic({
        trigger,
        matrix_event_id: matrixEvent?.getId(),
        matrix_event_type: matrixEvent?.getType(),
        matrix_event_sender: matrixEvent?.getSender(),
        client_recorded_at_ms: performance.now(),
        scroll_top: scrollElement.scrollTop,
        scroll_height: scrollElement.scrollHeight,
        client_height: scrollElement.clientHeight,
        max_scroll_top: maxScrollTop,
        distance_from_bottom: maxScrollTop - scrollElement.scrollTop,
        scroll_content_height: scrollContent.getBoundingClientRect().height,
        bottom_anchor_top: bottomAnchorRect.top,
        bottom_anchor_bottom: bottomAnchorRect.bottom,
        bottom_anchor_distance_from_viewport_bottom: viewportRect.bottom - bottomAnchorRect.bottom,
        timeline_range_start: state.rangeStart,
        timeline_range_end: state.rangeEnd,
        timeline_event_count: state.eventsLength,
        visible_rendered_count: visible.count,
        viewport_first_event_id: visible.firstEventId,
        viewport_center_event_id: visible.centerEventId,
        viewport_last_event_id: visible.lastEventId,
        scroll_to_bottom_request_count: scrollToBottomRef.current.count,
        scroll_to_bottom_smooth: scrollToBottomRef.current.smooth,
        live_bottom_transaction_phase: transaction?.phase,
        live_bottom_transaction_revision: transaction?.revision,
        live_bottom_transaction_event_id: transaction?.matrixEventId,
        live_bottom_previous_max_scroll_top: transaction?.previousMaxScrollTop,
        live_bottom_current_max_scroll_top: transaction?.currentMaxScrollTop,
        live_bottom_transaction_behavior: transaction?.behavior,
        at_bottom: state.atBottom,
        live_timeline_linked: state.liveTimelineLinked,
        range_at_start: state.rangeAtStart,
        range_at_end: state.rangeAtEnd,
        backward_placeholder_present: Boolean(
          scrollElement.querySelector('[data-paginator-anchor="B"]'),
        ),
        forward_placeholder_present: Boolean(
          scrollElement.querySelector('[data-paginator-anchor="F"]'),
        ),
        document_has_focus: document.hasFocus(),
      }).catch((error) => {
        if (routeCViewportDiagnosticWriteErrorReportedRef.current) return;
        routeCViewportDiagnosticWriteErrorReportedRef.current = true;
        console.warn('[oysterun-routec] viewport geometry diagnostic write failed', error);
      });
    },
    [routeCViewportGeometryDiagnosticsEnabled],
  );

  const scheduleRouteCViewportGeometryDiagnostics = useCallback(
    (matrixEvent: MatrixEvent) => {
      if (!routeCViewportGeometryDiagnosticsEnabled) return;
      routeCViewportDiagnosticWindowUntilRef.current =
        performance.now() + OYSTERUN_ROUTE_C_VIEWPORT_DIAGNOSTIC_SCROLL_WINDOW_MS;
      recordRouteCViewportGeometry('live_event_immediate', matrixEvent);
      window.requestAnimationFrame(() => {
        if (!alive()) return;
        recordRouteCViewportGeometry('live_event_raf_1', matrixEvent);
        window.requestAnimationFrame(() => {
          if (!alive()) return;
          recordRouteCViewportGeometry('live_event_raf_2', matrixEvent);
        });
      });
      window.setTimeout(() => {
        if (alive()) recordRouteCViewportGeometry('live_event_250ms', matrixEvent);
      }, 250);
      window.setTimeout(() => {
        if (alive()) recordRouteCViewportGeometry('live_event_750ms', matrixEvent);
      }, 750);
    },
    [alive, recordRouteCViewportGeometry, routeCViewportGeometryDiagnosticsEnabled],
  );

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
        'click_requested',
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
          (commit) => commit.semantic_type === 'control.request',
        );
        const outcomeSemanticCommit = semanticCommits.find(
          (commit) => commit.semantic_type === 'control.outcome',
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
              response.proof.cancel_request_semantic_event_source_hook,
            ),
            cancel_outcome_semantic_event_source_hook_present: Boolean(
              response.proof.cancel_outcome_semantic_event_source_hook,
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
          'click_resolved',
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
          'click_failed',
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
    [oysterunCancelControlsByEventId, room.roomId],
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const resetOysterunLocalPathDisclosures = useCallback(() => {
    const root = scrollContentRef.current ?? scrollRef.current;
    if (!root) return false;
    return resetOysterunLocalPathLinks(root);
  }, []);
  const routeCIOSRemotePaginationTransactionEnabled =
    routeCChatShell && isOysterunCapacitorIOSRuntime();
  const {
    beforeRemoteCommit: beforeRouteCIOSRemotePaginationCommit,
    paginateRemote: paginateRouteCIOSRemote,
    handleTouchStart: handleRouteCIOSRemotePaginationTouchStart,
    handleTouchEnd: handleRouteCIOSRemotePaginationTouchEnd,
  } = useOysterunIOSRemotePaginationTransaction({
    enabled: routeCIOSRemotePaginationTransactionEnabled,
    scopeKey: room.roomId,
    range: timeline.range,
    count: eventsLength,
    getScrollElement,
  });
  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    PAGINATION_LIMIT,
    beforeRouteCIOSRemotePaginationCommit,
  );
  const handlePaginatorEnd = useCallback(
    (backwards: boolean) => {
      if (routeCIOSRemotePaginationTransactionEnabled) {
        return paginateRouteCIOSRemote(backwards, handleTimelinePagination);
      }
      handleTimelinePagination(backwards);
      return undefined;
    },
    [
      handleTimelinePagination,
      paginateRouteCIOSRemote,
      routeCIOSRemotePaginationTransactionEnabled,
    ],
  );

  const beginRouteCHostOwnerUserFocus = useCallback((evtId: string) => {
    const focusUntil = performance.now() + OYSTERUN_ROUTE_C_HOST_OWNER_FOCUS_SCROLL_GUARD_MS;
    routeCHostOwnerFocusUntilRef.current = focusUntil;
    setRouteCHostOwnerFocusedAnchorEventId(evtId);
    setRouteCHostOwnerViewportAnchorEventId(undefined);
  }, []);
  const refreshRouteCHostOwnerViewportAnchor = useCallback(() => {
    const viewportEventId = getRouteCViewportCenterEventId(
      getScrollElement(),
      timeline.linkedTimelines,
    );
    setRouteCHostOwnerViewportAnchorEventId((current) =>
      current === viewportEventId ? current : viewportEventId,
    );
  }, [getScrollElement, timeline.linkedTimelines]);
  const scheduleRouteCHostOwnerViewportAnchorRefresh = useCallback(() => {
    if (routeCHostOwnerViewportMeasureFrameRef.current !== undefined) {
      window.cancelAnimationFrame(routeCHostOwnerViewportMeasureFrameRef.current);
    }
    routeCHostOwnerViewportMeasureFrameRef.current = window.requestAnimationFrame(() => {
      routeCHostOwnerViewportMeasureFrameRef.current = undefined;
      refreshRouteCHostOwnerViewportAnchor();
    });
  }, [refreshRouteCHostOwnerViewportAnchor]);
  const handleTimelineScroll = useCallback(() => {
    const now = performance.now();
    if (
      routeCViewportGeometryDiagnosticsEnabled &&
      now <= routeCViewportDiagnosticWindowUntilRef.current &&
      now - routeCViewportDiagnosticLastScrollAtRef.current >=
        OYSTERUN_ROUTE_C_VIEWPORT_DIAGNOSTIC_SCROLL_THROTTLE_MS
    ) {
      routeCViewportDiagnosticLastScrollAtRef.current = now;
      recordRouteCViewportGeometry('live_event_scroll');
    }
    if (performance.now() <= routeCHostOwnerFocusUntilRef.current) return;
    setRouteCHostOwnerFocusedAnchorEventId(undefined);
    scheduleRouteCHostOwnerViewportAnchorRefresh();
  }, [
    recordRouteCViewportGeometry,
    routeCViewportGeometryDiagnosticsEnabled,
    scheduleRouteCHostOwnerViewportAnchorRefresh,
  ]);

  const { getItems, scrollToItem, scrollToElement, observeBackAnchor, observeFrontAnchor } =
    useVirtualPaginator({
      count: eventsLength,
      limit: PAGINATION_LIMIT,
      range: timeline.range,
      onRangeChange: useCallback((r) => setTimeline((cs) => ({ ...cs, range: r })), []),
      getScrollElement,
      getItemElement: useCallback(
        (index: number) =>
          (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
          undefined,
        [],
      ),
      onEnd: handlePaginatorEnd,
      remoteEndTransaction: routeCIOSRemotePaginationTransactionEnabled,
    });
  const visibleEventIndexes = getItems();
  const shouldShowRouteCEmptyComposerGuidance =
    routeCChatShell &&
    routeCProductVisibleEventCount === 0 &&
    rangeAtStart &&
    rangeAtEnd &&
    !canPaginateBack &&
    liveTimelineLinked;
  const routeCHostOwnerVisibleEventIndexesKey = visibleEventIndexes.join(',');
  const routeCHostOwnerNeighborFocusEventIdFromUrl = routeCChatShell
    ? getOysterunHostSessionChatFocusEventId()
    : undefined;
  useEffect(() => {
    setRouteCHostOwnerFocusedAnchorEventId(undefined);
    setRouteCHostOwnerViewportAnchorEventId(undefined);
  }, [room.roomId]);
  useEffect(() => {
    if (!routeCChatShell) {
      setRouteCHostOwnerFocusedAnchorEventId(undefined);
      return;
    }
    if (routeCHostOwnerNeighborFocusEventIdFromUrl) {
      setRouteCHostOwnerFocusedAnchorEventId(routeCHostOwnerNeighborFocusEventIdFromUrl);
    }
  }, [routeCChatShell, routeCHostOwnerNeighborFocusEventIdFromUrl]);
  useLayoutEffect(() => {
    if (!routeCChatShell || routeCHostOwnerFocusedAnchorEventId) return undefined;
    scheduleRouteCHostOwnerViewportAnchorRefresh();
    return () => {
      if (routeCHostOwnerViewportMeasureFrameRef.current !== undefined) {
        window.cancelAnimationFrame(routeCHostOwnerViewportMeasureFrameRef.current);
        routeCHostOwnerViewportMeasureFrameRef.current = undefined;
      }
    };
  }, [
    routeCChatShell,
    routeCHostOwnerFocusedAnchorEventId,
    routeCHostOwnerVisibleEventIndexesKey,
    scheduleRouteCHostOwnerViewportAnchorRefresh,
    timeline.range.end,
    timeline.range.start,
  ]);
  const routeCHostOwnerNeighborAnchor = useMemo(
    () =>
      getRouteCHostOwnerNeighborAnchor({
        focusEventId: routeCHostOwnerFocusedAnchorEventId,
        viewportEventId: routeCHostOwnerViewportAnchorEventId,
        linkedTimelines: timeline.linkedTimelines,
        visibleEventIndexes,
      }),
    [
      routeCHostOwnerFocusedAnchorEventId,
      routeCHostOwnerViewportAnchorEventId,
      routeCHostOwnerVisibleEventIndexesKey,
      timeline.linkedTimelines,
    ],
  );
  const routeCHostOwnerNeighborAnchorKey = getRouteCHostOwnerNeighborAnchorKey(
    routeCHostOwnerNeighborAnchor,
  );

  const requestRouteCHostOwnerNeighbors = useCallback(
    async (anchor: RouteCHostOwnerNeighborAnchor, anchorKey: string) => {
      if (!routeCChatShell) return;
      if (routeCHostOwnerNeighborActiveRequestRef.current) {
        routeCHostOwnerNeighborPendingRequestRef.current = { anchor, anchorKey };
        setRouteCHostOwnerNeighborState((current) => ({
          ...current,
          loading: true,
          disabledReason: 'active_request_in_flight',
        }));
        return;
      }

      routeCHostOwnerNeighborActiveRequestRef.current = true;
      const requestSeq = routeCHostOwnerNeighborRequestSeqRef.current + 1;
      routeCHostOwnerNeighborRequestSeqRef.current = requestSeq;
      setRouteCHostOwnerNeighborState((current) => ({
        ...current,
        loading: true,
        error: null,
        anchorKey,
        disabledReason: 'loading',
      }));

      try {
        const response = await getOysterunHostOwnerMessageNeighbors({
          roomId: room.roomId,
          anchorEventId: anchor.kind === 'event' ? anchor.eventId : undefined,
          anchorPosition: anchor.kind === 'latest' ? 'latest' : undefined,
        });
        if (!alive() || routeCHostOwnerNeighborRequestSeqRef.current !== requestSeq) return;
        setRouteCHostOwnerNeighborState({
          loading: false,
          error: null,
          response,
          anchorKey,
          disabledReason: null,
        });
      } catch (err) {
        if (!alive() || routeCHostOwnerNeighborRequestSeqRef.current !== requestSeq) return;
        const message = err instanceof Error ? err.message : String(err);
        setRouteCHostOwnerNeighborState({
          loading: false,
          error: message,
          response: null,
          anchorKey,
          disabledReason: 'lookup_error',
        });
      } finally {
        routeCHostOwnerNeighborActiveRequestRef.current = false;
        const pending = routeCHostOwnerNeighborPendingRequestRef.current;
        routeCHostOwnerNeighborPendingRequestRef.current = undefined;
        if (pending && pending.anchorKey !== anchorKey) {
          window.setTimeout(() => {
            void requestRouteCHostOwnerNeighbors(pending.anchor, pending.anchorKey);
          }, 0);
        }
      }
    },
    [alive, room.roomId, routeCChatShell],
  );
  const requestRouteCHostOwnerNeighborsDebounced = useDebounce(requestRouteCHostOwnerNeighbors, {
    wait: OYSTERUN_ROUTE_C_HOST_OWNER_NEIGHBOR_LOOKUP_DEBOUNCE_MS,
  });

  useEffect(() => {
    if (!routeCChatShell) {
      setRouteCHostOwnerNeighborState({
        loading: false,
        error: null,
        response: null,
        anchorKey: null,
        disabledReason: 'not_route_c_chat_shell',
      });
      return;
    }
    if (eventsLength === 0) {
      setRouteCHostOwnerNeighborState({
        loading: false,
        error: null,
        response: null,
        anchorKey: null,
        disabledReason: 'empty_timeline',
      });
      return;
    }
    requestRouteCHostOwnerNeighborsDebounced(
      routeCHostOwnerNeighborAnchor,
      routeCHostOwnerNeighborAnchorKey,
    );
  }, [
    eventsLength,
    requestRouteCHostOwnerNeighborsDebounced,
    routeCChatShell,
    routeCHostOwnerNeighborAnchor,
    routeCHostOwnerNeighborAnchorKey,
    routeCHostOwnerNeighborInvalidationSeq,
  ]);

  const oysterunHost2TimelineCandidateEventIds = collectOysterunHost2TimelineCandidateEventIds(
    mx,
    timeline.linkedTimelines,
  );
  const oysterunHost2RenderedCandidateEventIds = collectOysterunHost2RenderedCandidateEventIds(
    mx,
    timeline.linkedTimelines,
    visibleEventIndexes,
  );
  const oysterunProviderControlOutcomesByRequestId = collectOysterunProviderControlOutcomes(
    timeline.linkedTimelines,
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
        const evLength = getTimelinesEventsCount(lTimelines);

        setFocusItem({
          index: evtAbsIndex,
          scrollTo: true,
          highlight: evtId !== readUptoEventIdRef.current,
        });
        setTimeline({
          linkedTimelines: lTimelines,
          range: {
            start: Math.max(evtAbsIndex - PAGINATION_LIMIT, 0),
            end: Math.min(evtAbsIndex + PAGINATION_LIMIT, evLength),
          },
        });
      },
      [alive],
    ),
    useCallback(() => {
      if (!alive()) return;
      setTimeline(getInitialTimeline(room));
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [alive, room]),
  );

  useLiveEventArrive(
    room,
    useCallback(
      (mEvt: MatrixEvent) => {
        if (isOysterunHostOwnerTimelineMessageEvent(mEvt)) {
          setRouteCHostOwnerNeighborInvalidationSeq((seq) => seq + 1);
        }
        // if user is at bottom of timeline
        // keep paginating timeline and conditionally mark as read
        // otherwise we update timeline without paginating
        // so timeline can be updated with evt like: edits, reactions etc
        if (atBottomRef.current) {
          if (document.hasFocus() && (!unreadInfo || mEvt.getSender() === mx.getUserId())) {
            // Check if the document is in focus (user is actively viewing the app),
            // and either there are no unread messages or the latest message is from the current user.
            // If either condition is met, trigger the markAsRead function to send a read receipt.
            requestAnimationFrame(() => markAsRead(mx, mEvt.getRoomId()!, hideActivity));
          }

          if (!document.hasFocus() && !unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }

          const scrollElement = scrollRef.current;
          const previousMaxScrollTop = scrollElement
            ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
            : 0;
          const previousTransaction = routeCLiveBottomTransactionRef.current;
          if (previousTransaction) {
            if (typeof routeCLiveBottomTransactionFrameRef.current === 'number') {
              window.cancelAnimationFrame(routeCLiveBottomTransactionFrameRef.current);
              routeCLiveBottomTransactionFrameRef.current = undefined;
            }
            recordRouteCViewportGeometry('live_bottom_transaction_cancelled', undefined, {
              phase: 'cancelled',
              revision: previousTransaction.revision,
              matrixEventId: previousTransaction.matrixEventId,
              previousMaxScrollTop: previousTransaction.previousMaxScrollTop,
              currentMaxScrollTop: previousMaxScrollTop,
            });
          }
          if (scrollElement) {
            scrollElement.scrollTo({
              top: Math.min(Math.max(0, scrollElement.scrollTop), previousMaxScrollTop),
              behavior: 'instant',
            });
          }
          const transaction: RouteCLiveBottomTransaction = {
            revision: routeCLiveBottomTransactionRevisionRef.current + 1,
            matrixEventId: mEvt.getId(),
            previousMaxScrollTop,
          };
          routeCLiveBottomTransactionRevisionRef.current = transaction.revision;
          routeCLiveBottomTransactionRef.current = transaction;
          recordRouteCViewportGeometry('live_bottom_transaction_queued', mEvt, {
            phase: 'queued',
            revision: transaction.revision,
            matrixEventId: transaction.matrixEventId,
            previousMaxScrollTop,
            currentMaxScrollTop: previousMaxScrollTop,
            behavior: 'instant',
          });
          scheduleRouteCViewportGeometryDiagnostics(mEvt);

          setTimeline((ct) => ({
            ...ct,
            range: {
              start: ct.range.start + 1,
              end: ct.range.end + 1,
            },
          }));
          return;
        }
        scheduleRouteCViewportGeometryDiagnostics(mEvt);
        setTimeline((ct) => ({ ...ct }));
        if (!unreadInfo) {
          setUnreadInfo(getRoomUnreadInfo(room));
        }
      },
      [
        hideActivity,
        mx,
        recordRouteCViewportGeometry,
        room,
        scheduleRouteCViewportGeometryDiagnostics,
        unreadInfo,
      ],
    ),
  );

  const handleOpenEvent = useCallback(
    async (
      evtId: string,
      highlight = true,
      onScroll: ((scrolled: boolean) => void) | undefined = undefined,
    ) => {
      const evtTimeline = getEventTimeline(room, evtId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(timeline.linkedTimelines, evtTimeline, evtId);

      if (typeof absoluteIndex === 'number') {
        const scrolled = scrollToItem(absoluteIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          index: absoluteIndex,
          scrollTo: false,
          highlight,
        });
      } else {
        setTimeline(getEmptyTimeline());
        loadEventTimeline(evtId);
      }
    },
    [room, timeline, scrollToItem, loadEventTimeline],
  );

  const handleRouteCHostOwnerNeighborNavigation = useCallback(
    (direction: 'previous' | 'next') => {
      const target =
        direction === 'previous'
          ? routeCHostOwnerNeighborState.response?.previous
          : routeCHostOwnerNeighborState.response?.next;
      const targetEventId = target?.event_id;
      if (!targetEventId) return;

      beginRouteCHostOwnerUserFocus(targetEventId);
      const samePageHandled = requestOysterunActiveRoomTimelineFocus({
        roomId: room.roomId,
        eventId: targetEventId,
        source: 'host_owner_neighbor_navigation',
      });
      if (samePageHandled) return;

      void handleOpenEvent(targetEventId);
      const cleanFocusPath = getOysterunHostSessionChatFocusPath(targetEventId);
      if (cleanFocusPath) {
        window.history.replaceState(window.history.state, '', cleanFocusPath);
      }
    },
    [
      beginRouteCHostOwnerUserFocus,
      handleOpenEvent,
      room.roomId,
      routeCHostOwnerNeighborState.response,
    ],
  );

  useEffect(() => {
    if (!routeCChatShell) return undefined;
    return subscribeOysterunActiveRoomTimelineFocus(room.roomId, (evtId) => {
      beginRouteCHostOwnerUserFocus(evtId);
      void handleOpenEvent(evtId);
    });
  }, [beginRouteCHostOwnerUserFocus, handleOpenEvent, room.roomId, routeCChatShell]);

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      if (liveTimelineLinked) {
        setTimeline(getInitialTimeline(room));
      }
    }, [room, liveTimelineLinked]),
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

        if (atBottomRef.current) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement, roomInputRef]),
    useCallback(() => roomInputRef.current, [roomInputRef]),
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
    useCallback((entry: IntersectionObserverEntry) => {
      if (!entry.isIntersecting) setAtBottom(false);
    }, []),
    { wait: 1000 },
  );
  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) debounceSetAtBottom(targetEntry);
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          setAtBottom(true);
          if (document.hasFocus()) {
            tryAutoMarkAsRead();
          }
        }
      },
      [debounceSetAtBottom, tryAutoMarkAsRead],
    ),
    useCallback(
      () => ({
        root: getScrollElement(),
        rootMargin: '100px',
      }),
      [getScrollElement],
    ),
    useCallback(() => atBottomAnchorRef.current, []),
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
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
      [tryAutoMarkAsRead, unreadInfo, handleOpenEvent],
    ),
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
            canEditEvent(mx, mEvt),
          );
          const editableEvtId = editableEvt?.getId();
          if (!editableEvtId) return;
          setEditId(editableEvtId);
          evt.preventDefault();
        }
      },
      [mx, room, editor],
    ),
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
    if (scrollEl) {
      scrollToBottom(scrollEl);
    }
  }, []);

  // if live timeline is linked and unreadInfo change
  // Scroll to last read message
  useLayoutEffect(() => {
    const { readUptoEventId, inLiveTimeline, scrollTo } = unreadInfo ?? {};
    if (readUptoEventId && inLiveTimeline && scrollTo) {
      const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const evtTimeline = getEventTimeline(room, readUptoEventId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(linkedTimelines, evtTimeline, readUptoEventId);
      if (absoluteIndex) {
        scrollToItem(absoluteIndex, {
          behavior: 'instant',
          align: 'start',
          stopInView: true,
        });
      }
    }
  }, [room, unreadInfo, scrollToItem]);

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

  // A live event can reduce the fixed raw window height when its former first row is removed.
  // Resolve bottom-follow in one transaction-owned frame after that range and DOM commit, so no
  // smooth scroll keeps an obsolete pre-commit destination on iOS WebKit.
  useLayoutEffect(() => {
    const transaction = routeCLiveBottomTransactionRef.current;
    if (!transaction) return;
    const scrollElement = scrollRef.current;
    const currentMaxScrollTop = scrollElement
      ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      : 0;
    if (!liveTimelineLinked) {
      routeCLiveBottomTransactionRef.current = undefined;
      recordRouteCViewportGeometry('live_bottom_transaction_cancelled', undefined, {
        phase: 'cancelled',
        revision: transaction.revision,
        matrixEventId: transaction.matrixEventId,
        previousMaxScrollTop: transaction.previousMaxScrollTop,
        currentMaxScrollTop,
      });
      return;
    }
    if (!rangeAtEnd || !scrollElement) return;
    if (typeof routeCLiveBottomTransactionFrameRef.current === 'number') return;

    routeCLiveBottomTransactionFrameRef.current = window.requestAnimationFrame(() => {
      routeCLiveBottomTransactionFrameRef.current = undefined;
      if (!alive()) return;
      const activeTransaction = routeCLiveBottomTransactionRef.current;
      if (!activeTransaction || activeTransaction.revision !== transaction.revision) return;
      const state = routeCViewportGeometryStateRef.current;
      const committedScrollElement = scrollRef.current;
      if (!state.liveTimelineLinked) {
        routeCLiveBottomTransactionRef.current = undefined;
        recordRouteCViewportGeometry('live_bottom_transaction_cancelled', undefined, {
          phase: 'cancelled',
          revision: activeTransaction.revision,
          matrixEventId: activeTransaction.matrixEventId,
          previousMaxScrollTop: activeTransaction.previousMaxScrollTop,
        });
        return;
      }
      if (!state.rangeAtEnd || !committedScrollElement) return;
      const committedMaxScrollTop = Math.max(
        0,
        committedScrollElement.scrollHeight - committedScrollElement.clientHeight,
      );
      const behavior = 'instant';
      scrollToBottomRef.current.smooth = false;
      scrollToBottom(committedScrollElement, behavior);
      routeCLiveBottomTransactionRef.current = undefined;
      recordRouteCViewportGeometry('live_bottom_transaction_committed', undefined, {
        phase: 'committed',
        revision: activeTransaction.revision,
        matrixEventId: activeTransaction.matrixEventId,
        previousMaxScrollTop: activeTransaction.previousMaxScrollTop,
        currentMaxScrollTop: committedMaxScrollTop,
        behavior,
      });
    });

    return () => {
      if (typeof routeCLiveBottomTransactionFrameRef.current !== 'number') return;
      window.cancelAnimationFrame(routeCLiveBottomTransactionFrameRef.current);
      routeCLiveBottomTransactionFrameRef.current = undefined;
    };
  }, [
    alive,
    eventsLength,
    liveTimelineLinked,
    rangeAtEnd,
    recordRouteCViewportGeometry,
    timeline.range.end,
    timeline.range.start,
  ]);

  // scroll to bottom of timeline
  const scrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (scrollToBottomCount > 0) {
      const scrollEl = scrollRef.current;
      if (scrollEl)
        scrollToBottom(scrollEl, scrollToBottomRef.current.smooth ? 'smooth' : 'instant');
    }
  }, [scrollToBottomCount]);

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
    routeCHostOwnerFocusUntilRef.current = 0;
    setRouteCHostOwnerFocusedAnchorEventId(undefined);
    if (eventId) {
      const routeCChatPath = routeCChatShell ? getOysterunHostSessionChatPath() : undefined;
      if (routeCChatPath) {
        window.history.replaceState(window.history.state, '', routeCChatPath);
      } else {
        navigateRoom(room.roomId, undefined, { replace: true });
      }
    }
    setTimeline(getInitialTimeline(room));
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
    [],
  );

  const handleOpenReply: MouseEventHandler = useCallback(
    async (evt) => {
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      handleOpenEvent(targetId);
    },
    [handleOpenEvent],
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
        evt.currentTarget.getBoundingClientRect(),
      );
    },
    [room, space, openUserRoomProfile],
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
          userId === mx.getUserId(),
        ),
      );
      ReactEditor.focus(editor);
      moveCursor(editor);
    },
    [mx, room, editor],
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
    [room, setReplyDraft, editor],
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
        getReactionContent(targetEventId, key, rShortcode),
      );
    },
    [mx, room],
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
    [editor],
  );
  const { t } = useTranslation();

  const renderMatrixEvent = useMatrixEventRenderer<
    [string, MatrixEvent, number, EventTimelineSet, boolean]
  >(
    {
      [MessageEvent.RoomMessage]: (mEventId, mEvent, item, timelineSet, collapse) => {
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
          oysterunProviderControlOutcomesByRequestId,
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
                oysterunSourceEventId={mEventId.startsWith('$') ? mEventId : undefined}
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
                    oysterunProviderControlOutcomesByRequestId,
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
                      oysterunSourceEventId={mEventId.startsWith('$') ? mEventId : undefined}
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
    },
  );

  let previousEvent: MatrixEvent | undefined;
  let previousEventRendered = false;
  let newMessagesDivider = false;
  let dayDivider = false;
  const renderRawTimelineEvent = (rawEventIndex: number) => {
    const [eventTimeline, baseIndex] = getTimelineAndBaseIndex(
      timeline.linkedTimelines,
      rawEventIndex,
    );
    if (!eventTimeline) return null;
    const timelineSet = eventTimeline.getTimelineSet();
    const mEvent = getTimelineEvent(
      eventTimeline,
      getTimelineRelativeIndex(rawEventIndex, baseIndex),
    );
    const mEventId = mEvent?.getId();
    if (!mEvent || !mEventId) return null;

    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) return null;
    if (mEvent.isRedacted() && !showHiddenEvents) return null;
    if (routeCChatShell && isOysterunProviderCompletionMarkerContent(mEvent.getContent())) {
      return null;
    }

    if (!newMessagesDivider && readUptoEventIdRef.current) {
      newMessagesDivider = previousEvent?.getId() === readUptoEventIdRef.current;
    }
    if (!dayDivider) {
      dayDivider = previousEvent ? !inSameDay(previousEvent.getTs(), mEvent.getTs()) : false;
    }

    const collapsed =
      previousEventRendered &&
      !dayDivider &&
      (!newMessagesDivider || eventSender === mx.getUserId()) &&
      previousEvent !== undefined &&
      previousEvent.getSender() === eventSender &&
      previousEvent.getType() === mEvent.getType() &&
      minuteDifference(previousEvent.getTs(), mEvent.getTs()) < 2;

    const eventJSX = reactionOrEditEvent(mEvent)
      ? null
      : renderMatrixEvent(
          mEvent.getType(),
          typeof mEvent.getStateKey() === 'string',
          mEventId,
          mEvent,
          rawEventIndex,
          timelineSet,
          collapsed,
        );
    previousEvent = mEvent;
    previousEventRendered = Boolean(eventJSX);

    const newMessagesDividerJSX =
      newMessagesDivider && eventJSX && eventSender !== mx.getUserId() ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider style={{ color: color.Success.Main }} variant="Inherit">
            <Badge as="span" size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">New Messages</Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;
    const dayDividerJSX =
      dayDivider && eventJSX ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider variant="Surface">
            <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
              <Text size="L400">
                {(() => {
                  if (today(mEvent.getTs())) return 'Today';
                  if (yesterday(mEvent.getTs())) return 'Yesterday';
                  return timeDayMonthYear(mEvent.getTs());
                })()}
              </Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    if (eventJSX && (newMessagesDividerJSX || dayDividerJSX)) {
      if (newMessagesDividerJSX) newMessagesDivider = false;
      if (dayDividerJSX) dayDivider = false;
      return (
        <React.Fragment key={mEventId}>
          {newMessagesDividerJSX}
          {dayDividerJSX}
          {eventJSX}
        </React.Fragment>
      );
    }

    return eventJSX;
  };

  const routeCHostOwnerPreviousEventId =
    routeCHostOwnerNeighborState.response?.previous?.event_id ?? '';
  const routeCHostOwnerNextEventId = routeCHostOwnerNeighborState.response?.next?.event_id ?? '';
  const routeCHostOwnerNeighborResponse = routeCHostOwnerNeighborState.response;
  const routeCHostOwnerNeighborProof = routeCHostOwnerNeighborResponse?.proof;
  const routeCHostOwnerPreviousWindowExhausted = getRouteCHostOwnerNeighborWindowExhausted(
    routeCHostOwnerNeighborResponse,
    'previous',
  );
  const routeCHostOwnerNextWindowExhausted = getRouteCHostOwnerNeighborWindowExhausted(
    routeCHostOwnerNeighborResponse,
    'next',
  );
  const routeCHostOwnerPreviousDisabledReason = getRouteCHostOwnerNeighborDisabledReason(
    routeCHostOwnerNeighborResponse,
    'previous',
    routeCHostOwnerNeighborState.loading,
    routeCHostOwnerNeighborState.disabledReason,
  );
  const routeCHostOwnerNextDisabledReason = getRouteCHostOwnerNeighborDisabledReason(
    routeCHostOwnerNeighborResponse,
    'next',
    routeCHostOwnerNeighborState.loading,
    routeCHostOwnerNeighborState.disabledReason,
  );
  const routeCHostOwnerPreviousTitle = getRouteCHostOwnerNeighborTitle({
    direction: 'previous',
    disabledReason: routeCHostOwnerPreviousDisabledReason,
  });
  const routeCHostOwnerNextTitle = getRouteCHostOwnerNeighborTitle({
    direction: 'next',
    disabledReason: routeCHostOwnerNextDisabledReason,
  });
  const routeCHostOwnerNeighborControlsVisible = routeCChatShell && eventsLength > 0;
  const routeCHostOwnerLookupState = routeCHostOwnerNeighborState.loading
    ? 'loading'
    : routeCHostOwnerNeighborState.error
      ? 'error'
      : routeCHostOwnerNeighborState.response
        ? 'ready'
        : 'idle';

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
        visibility="Hover"
        direction="Vertical"
        data-testid="oysterun-routec-timeline-scroll"
        data-oysterun-clean-session-testid="oysterun-clean-session-timeline-scroll"
        data-oysterun-routec-bottom-proof-surface="scroll_container"
        data-oysterun-clean-session-bottom-proof-surface="scroll_container"
        onScroll={handleTimelineScroll}
        onTouchStart={handleRouteCIOSRemotePaginationTouchStart}
        onTouchEnd={handleRouteCIOSRemotePaginationTouchEnd}
        onTouchCancel={handleRouteCIOSRemotePaginationTouchEnd}
        data-oysterun-routec-bottom-pinned={String(atBottom)}
        data-oysterun-clean-session-bottom-pinned={String(atBottom)}
        data-oysterun-routec-at-bottom={String(atBottom)}
        data-oysterun-clean-session-at-bottom={String(atBottom)}
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
          data-oysterun-routec-live-timeline-linked={String(liveTimelineLinked)}
          data-oysterun-clean-session-live-timeline-linked={String(liveTimelineLinked)}
          data-oysterun-routec-range-at-end={String(rangeAtEnd)}
          data-oysterun-clean-session-range-at-end={String(rangeAtEnd)}
          data-oysterun-routec-display-range={`${timeline.range.start}-${timeline.range.end}`}
          data-oysterun-clean-session-display-range={`${timeline.range.start}-${timeline.range.end}`}
          data-oysterun-routec-display-items-length={String(eventsLength)}
          data-oysterun-clean-session-display-items-length={String(eventsLength)}
          data-oysterun-routec-raw-event-range={`${timeline.range.start}-${timeline.range.end}`}
          data-oysterun-routec-raw-event-count={String(eventsLength)}
          data-oysterun-routec-product-visible-event-count={String(routeCProductVisibleEventCount)}
          onClick={handleOysterunInlineLinkClick}
          onKeyDown={handleOysterunInlineLinkKeyDown}
        >
          {!routeCChatShell &&
            !canPaginateBack &&
            rangeAtStart &&
            visibleEventIndexes.length > 0 && (
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
              rawEventCount={eventsLength}
              rawEventRange={timeline.range}
              productVisibleEventCount={routeCProductVisibleEventCount}
            />
          )}
          {(canPaginateBack || !rangeAtStart) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase>
                  <DefaultPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <DefaultPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
              </>
            ))}

          {visibleEventIndexes.map(renderRawTimelineEvent)}

          {(!liveTimelineLinked || !rangeAtEnd) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <DefaultPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={visibleEventIndexes.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={visibleEventIndexes.length} />
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
      {routeCHostOwnerNeighborControlsVisible && (
        <TimelineFloat
          position="BottomEnd"
          direction="Column"
          data-testid="oysterun-routec-host-owner-neighbor-nav"
          data-oysterun-routec-host-owner-neighbor-nav="true"
          data-oysterun-routec-host-owner-neighbor-endpoint="/session/host-owner-message-neighbors"
          data-oysterun-routec-host-owner-neighbor-anchor-source={
            routeCHostOwnerNeighborAnchor.source
          }
          data-oysterun-routec-host-owner-neighbor-anchor-key={routeCHostOwnerNeighborAnchorKey}
          data-oysterun-routec-host-owner-neighbor-lookup-state={routeCHostOwnerLookupState}
          data-oysterun-routec-host-owner-neighbor-disabled-reason={
            routeCHostOwnerNeighborState.disabledReason ?? ''
          }
          data-oysterun-routec-host-owner-neighbor-error={routeCHostOwnerNeighborState.error ?? ''}
          data-oysterun-routec-host-owner-neighbor-actor-key="human"
          data-oysterun-routec-host-owner-neighbor-actor-kind="human"
          data-oysterun-routec-host-owner-neighbor-body-scan-used="false"
          data-oysterun-routec-host-owner-neighbor-display-name-used="false"
          data-oysterun-routec-host-owner-neighbor-proof-schema={
            routeCHostOwnerNeighborProof?.schema_version ?? ''
          }
          data-oysterun-routec-host-owner-neighbor-lookup-strategy={
            routeCHostOwnerNeighborProof?.lookup_strategy ?? ''
          }
          data-oysterun-routec-host-owner-neighbor-total-event-count={
            routeCHostOwnerNeighborProof?.total_event_count ?? ''
          }
          data-oysterun-routec-host-owner-neighbor-max-scan-events-per-direction={
            routeCHostOwnerNeighborProof?.max_scan_events_per_direction ?? ''
          }
          data-oysterun-routec-host-owner-neighbor-previous-scanned-event-count={
            routeCHostOwnerNeighborProof?.previous_scanned_event_count ?? ''
          }
          data-oysterun-routec-host-owner-neighbor-next-scanned-event-count={
            routeCHostOwnerNeighborProof?.next_scanned_event_count ?? ''
          }
          data-oysterun-routec-host-owner-neighbor-previous-window-exhausted={String(
            routeCHostOwnerPreviousWindowExhausted,
          )}
          data-oysterun-routec-host-owner-neighbor-next-window-exhausted={String(
            routeCHostOwnerNextWindowExhausted,
          )}
          data-oysterun-routec-host-owner-neighbor-previous-disabled-reason={
            routeCHostOwnerPreviousDisabledReason
          }
          data-oysterun-routec-host-owner-neighbor-next-disabled-reason={
            routeCHostOwnerNextDisabledReason
          }
          data-oysterun-routec-host-owner-neighbor-placement="right_bottom_above_composer"
          data-oysterun-routec-host-owner-neighbor-layout="vertical"
        >
          <button
            type="button"
            aria-label={routeCHostOwnerPreviousTitle}
            title={routeCHostOwnerPreviousTitle}
            disabled={routeCHostOwnerNeighborState.loading || !routeCHostOwnerPreviousEventId}
            onClick={() => handleRouteCHostOwnerNeighborNavigation('previous')}
            data-testid="oysterun-routec-host-owner-neighbor-previous"
            data-oysterun-routec-host-owner-neighbor-control="previous"
            data-oysterun-routec-host-owner-neighbor-target-event-id={
              routeCHostOwnerPreviousEventId
            }
            data-oysterun-routec-host-owner-neighbor-window-exhausted={String(
              routeCHostOwnerPreviousWindowExhausted,
            )}
            data-oysterun-routec-host-owner-neighbor-disabled-reason={
              routeCHostOwnerPreviousDisabledReason
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              width: toRem(40),
              height: toRem(40),
              justifyContent: 'center',
              borderRadius: toRem(999),
              border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
              background: color.SurfaceVariant.Container,
              color: color.SurfaceVariant.OnContainer,
              padding: 0,
              cursor:
                routeCHostOwnerNeighborState.loading || !routeCHostOwnerPreviousEventId
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            <Icon size="50" src={Icons.ChevronTop} />
          </button>
          <button
            type="button"
            aria-label={routeCHostOwnerNextTitle}
            title={routeCHostOwnerNextTitle}
            disabled={routeCHostOwnerNeighborState.loading || !routeCHostOwnerNextEventId}
            onClick={() => handleRouteCHostOwnerNeighborNavigation('next')}
            data-testid="oysterun-routec-host-owner-neighbor-next"
            data-oysterun-routec-host-owner-neighbor-control="next"
            data-oysterun-routec-host-owner-neighbor-target-event-id={routeCHostOwnerNextEventId}
            data-oysterun-routec-host-owner-neighbor-window-exhausted={String(
              routeCHostOwnerNextWindowExhausted,
            )}
            data-oysterun-routec-host-owner-neighbor-disabled-reason={
              routeCHostOwnerNextDisabledReason
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              width: toRem(40),
              height: toRem(40),
              justifyContent: 'center',
              borderRadius: toRem(999),
              border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
              background: color.SurfaceVariant.Container,
              color: color.SurfaceVariant.OnContainer,
              padding: 0,
              cursor:
                routeCHostOwnerNeighborState.loading || !routeCHostOwnerNextEventId
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            <Icon size="50" src={Icons.ChevronBottom} />
          </button>
        </TimelineFloat>
      )}
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
