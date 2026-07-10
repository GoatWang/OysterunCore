import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { MatrixClient } from 'matrix-js-sdk/lib/client';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { RoomEvent } from 'matrix-js-sdk/lib/models/room';
import { useMatrixClient } from '../app/hooks/useMatrixClient';
import { MessageEvent } from '../types/matrix/room';
import {
  getOysterunHost2IntakeProof,
  getOysterunHostSessionRouteSearch,
  getOysterunHostSessionSnapshot,
  recordOysterunCancelControlProof,
  subscribeOysterunRouteCOptimisticProviderResponding,
  type OysterunHost2IntakeProof,
  type OysterunHostSessionSnapshotResponse,
  type OysterunRouteCOptimisticProviderRespondingEvent,
} from './OysterunHostClient';
import {
  getOysterunSemanticPayload,
  isOysterunProviderCompletionMarkerPayload,
  type OysterunSemanticPayload,
} from './OysterunSemanticRenderer';
import {
  isOysterunHost2CancelableProof,
  isOysterunHost2CancelPollingTerminalProof,
  isOysterunProviderLifecycleActive,
  isOysterunProviderLifecycleTerminal,
  selectOysterunRouteCRespondingState,
  selectPollingNeeded,
  type OysterunHost2CancelControlState,
  type OysterunMessageLifecycleRawStatus,
  type OysterunMessageLifecycleSemanticActivity,
  type OysterunRouteCRespondingState,
} from './OysterunMessageLifecycleSelectors';

const OYSTERUN_ROUTE_C_PROVIDER_TYPING_POLL_MS = 1000;
const OYSTERUN_ROUTE_C_SNAPSHOT_TRANSIENT_FAILURE_LIMIT = 3;
const OYSTERUN_SEMANTIC_TERMINAL_TYPES = new Set(['message.assistant', 'control.outcome']);
const OYSTERUN_SEMANTIC_ACTIVE_TYPES = new Set([
  'thinking.reasoning',
  'tool.call',
  'tool.output',
  'tool.result',
  'tool.failure',
  'control.request',
]);
const OYSTERUN_HOST2_CANCEL_POLL_MIN_MS = 750;
const OYSTERUN_HOST2_CANCEL_POLL_MAX_MS = 5000;
const OYSTERUN_HOST2_CANCEL_MAX_HIDDEN_POLLS = 8;
const OYSTERUN_MESSAGE_LIFECYCLE_TERMINAL_TTL_MS = 30 * 60 * 1000;
const OYSTERUN_MESSAGE_LIFECYCLE_MAX_TERMINAL_RECORDS = 256;

type Room = any;
type OysterunRouteCTimelineEventHandler = (
  mEvent: MatrixEvent,
  eventRoom: Room | undefined,
  toStartOfTimeline: boolean | undefined,
  removed: boolean,
  data: { liveEvent?: boolean }
) => void;
type OysterunRouteCRoomEventHandler = (event: MatrixEvent, room: Room) => void;

type OysterunMessageLifecycleCacheRecord = OysterunMessageLifecycleRawStatus & {
  cacheKey: string;
  lastSeenAt: number;
  terminalAt?: number;
};

type OysterunHost2ProofCacheRecord = {
  cacheKey: string;
  roomId: string;
  eventId: string;
  proof: OysterunHost2IntakeProof;
  lastSeenAt: number;
  terminalAt?: number;
};

const rawLifecycleCache = new Map<string, OysterunMessageLifecycleCacheRecord>();
const rawHost2ProofCache = new Map<string, OysterunHost2ProofCacheRecord>();

function lifecycleCacheKey(roomId: string, sessionId?: string): string {
  return `${sessionId || 'no-session'}\u001f${roomId}`;
}

function host2ProofCacheKey(roomId: string, eventId: string, sessionId?: string): string {
  return `${sessionId || 'no-session'}\u001f${roomId}\u001f${eventId}`;
}

function pruneTerminalRecords<T extends { terminalAt?: number; lastSeenAt: number }>(
  cache: Map<string, T>,
  now = Date.now()
): void {
  for (const [key, record] of cache.entries()) {
    if (
      record.terminalAt !== undefined &&
      now - record.terminalAt > OYSTERUN_MESSAGE_LIFECYCLE_TERMINAL_TTL_MS
    ) {
      cache.delete(key);
    }
  }
  const terminalRecords = [...cache.entries()]
    .filter(([, record]) => record.terminalAt !== undefined)
    .sort(([, a], [, b]) => a.lastSeenAt - b.lastSeenAt);
  while (terminalRecords.length > OYSTERUN_MESSAGE_LIFECYCLE_MAX_TERMINAL_RECORDS) {
    const [oldestKey] = terminalRecords.shift()!;
    cache.delete(oldestKey);
  }
}

function rememberRawLifecycle(rawLifecycle: OysterunMessageLifecycleRawStatus): void {
  const now = Date.now();
  const cacheKey = lifecycleCacheKey(rawLifecycle.roomId, rawLifecycle.sessionId);
  rawLifecycleCache.set(cacheKey, {
    ...rawLifecycle,
    cacheKey,
    lastSeenAt: now,
    terminalAt: isOysterunProviderLifecycleTerminal(rawLifecycle.providerLifecycle)
      ? now
      : undefined,
  });
  pruneTerminalRecords(rawLifecycleCache, now);
}

export function rememberOysterunHost2IntakeProof({
  roomId,
  eventId,
  sessionId,
  proof,
}: {
  roomId: string;
  eventId: string;
  sessionId?: string;
  proof: OysterunHost2IntakeProof;
}): void {
  const now = Date.now();
  const cacheKey = host2ProofCacheKey(roomId, eventId, sessionId);
  rawHost2ProofCache.set(cacheKey, {
    cacheKey,
    roomId,
    eventId,
    proof,
    lastSeenAt: now,
    terminalAt: isOysterunHost2CancelPollingTerminalProof(proof, eventId) ? now : undefined,
  });
  pruneTerminalRecords(rawHost2ProofCache, now);
}

function getOysterunHostSessionIdFromRouteSearch(routeSearch: string | undefined): string {
  if (!routeSearch) {
    throw new Error('Route C lifecycle cache requires a query-bound Host session.');
  }
  const params = new URLSearchParams(routeSearch);
  const sessionId = params.get('session_id')?.trim() || params.get('host_session_id')?.trim();
  if (!sessionId) {
    throw new Error('Route C lifecycle cache missing session_id or host_session_id.');
  }
  return sessionId;
}

function isOysterunRouteCUserTextEvent(mx: MatrixClient, mEvent: MatrixEvent): boolean {
  const eventId = mEvent.getId();
  const content = mEvent.getContent();
  return (
    Boolean(eventId?.startsWith('$')) &&
    mEvent.getType() === MessageEvent.RoomMessage &&
    mEvent.getSender() === mx.getUserId() &&
    !getOysterunSemanticPayload(content) &&
    content?.msgtype === 'm.text' &&
    typeof content?.body === 'string' &&
    content.body.trim().length > 0
  );
}

function normalizedOysterunLabel(value: string | null | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return undefined;
  if (normalized.toLowerCase() === 'codex') return 'Codex';
  if (normalized.toLowerCase() === 'claude') return 'Claude';
  return normalized;
}

function normalizedOysterunSemanticValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isOysterunRouteCTerminalSemantic(
  payload: OysterunSemanticPayload,
  semanticType: string
): boolean {
  if (OYSTERUN_SEMANTIC_TERMINAL_TYPES.has(semanticType)) return true;
  if (isOysterunProviderCompletionMarkerPayload(payload)) return true;
  if (semanticType !== 'session_lifecycle') return false;
  const lifecycle = normalizedOysterunSemanticValue(
    payload.lifecycle ?? payload.semantic_lifecycle
  );
  if (lifecycle === 'completed') return true;
  return normalizedOysterunSemanticValue(payload.body) === 'Provider turn completed.';
}

function getOysterunTypingDisplayName(payload: OysterunSemanticPayload): string | undefined {
  return (
    normalizedOysterunLabel(payload.matrix_event_sender_display_name) ??
    normalizedOysterunLabel(payload.provider) ??
    normalizedOysterunLabel(payload.provider_id) ??
    normalizedOysterunLabel(payload.actor)
  );
}

function semanticPayloadTargetsSourceUserEvent(
  payload: OysterunSemanticPayload,
  sourceUserEventId: string
): boolean {
  return (
    payload.source_user_event_id === sourceUserEventId ||
    payload.target_user_event_id === sourceUserEventId ||
    payload.target_event_id === sourceUserEventId
  );
}

function getOysterunRouteCTypingActivity(
  mx: MatrixClient,
  room: Room
): OysterunMessageLifecycleSemanticActivity | undefined {
  const liveEvents = room.getLiveTimeline().getEvents() as MatrixEvent[];
  let latestUserIndex = -1;
  let latestUserEvent: MatrixEvent | undefined;
  for (let eventIndex = liveEvents.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const candidateEvent = liveEvents[eventIndex];
    if (isOysterunRouteCUserTextEvent(mx, candidateEvent)) {
      latestUserIndex = eventIndex;
      latestUserEvent = candidateEvent;
      break;
    }
  }
  const sourceUserEventId = latestUserEvent?.getId();
  if (!sourceUserEventId || latestUserIndex < 0) return undefined;

  let latestSourceBoundSemanticType: string | undefined;
  let semanticActiveAfterUser = false;
  let sourceBoundTerminalAfterUser = false;
  let displayName = 'Agent';
  let latestSemanticType: string | undefined;
  liveEvents.slice(latestUserIndex + 1).forEach((mEvent) => {
    const payload = getOysterunSemanticPayload(mEvent.getContent());
    const semanticType = payload?.semantic_type ?? payload?.semantic_category;
    if (!payload || !semanticType) return;
    const sourceBound = semanticPayloadTargetsSourceUserEvent(payload, sourceUserEventId);
    if (!sourceBound) return;
    latestSemanticType = semanticType;
    latestSourceBoundSemanticType = semanticType;
    if (isOysterunRouteCTerminalSemantic(payload, semanticType)) {
      semanticActiveAfterUser = false;
      sourceBoundTerminalAfterUser = true;
      return;
    }
    if (OYSTERUN_SEMANTIC_ACTIVE_TYPES.has(semanticType)) {
      semanticActiveAfterUser = true;
      sourceBoundTerminalAfterUser = false;
      displayName = getOysterunTypingDisplayName(payload) ?? displayName;
    }
  });

  return {
    sourceUserEventId,
    displayName,
    semanticActiveAfterUser,
    fallbackFinalResultForSource: latestSourceBoundSemanticType
      ? sourceBoundTerminalAfterUser
      : false,
    latestSemanticType,
  };
}

export function useOysterunRouteCRespondingState(room: Room): OysterunRouteCRespondingState {
  const mx = useMatrixClient();
  const routeCSessionSearch = getOysterunHostSessionRouteSearch();
  const routeCChatShell = Boolean(routeCSessionSearch);
  const [timelineVersion, setTimelineVersion] = useState(0);
  const [rawLifecycle, setRawLifecycle] = useState<OysterunMessageLifecycleRawStatus>({
    roomId: room.roomId,
  });
  const rawLifecycleRef = useRef<OysterunMessageLifecycleRawStatus>(rawLifecycle);
  const optimisticRef = useRef<OysterunRouteCOptimisticProviderRespondingEvent | undefined>();

  useEffect(() => {
    rawLifecycleRef.current = rawLifecycle;
  }, [rawLifecycle]);

  useEffect(() => {
    if (!routeCChatShell) return undefined;
    const bumpTimelineVersion = () => setTimelineVersion((current) => current + 1);
    const handleTimelineEvent: OysterunRouteCTimelineEventHandler = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId || !data.liveEvent) return;
      bumpTimelineVersion();
    };
    const handleLocalEcho: OysterunRouteCRoomEventHandler = (event, r) => {
      if (r.roomId !== room.roomId) return;
      bumpTimelineVersion();
    };
    const handleRedaction: OysterunRouteCRoomEventHandler = (event, r) => {
      if (r.roomId !== room.roomId) return;
      bumpTimelineVersion();
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    room.on(RoomEvent.Redaction, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
    };
  }, [room, routeCChatShell]);

  const routeCSessionId = routeCChatShell
    ? getOysterunHostSessionIdFromRouteSearch(routeCSessionSearch)
    : undefined;
  const semanticActivity = useMemo(
    () => (routeCChatShell ? getOysterunRouteCTypingActivity(mx, room) : undefined),
    [mx, room, routeCChatShell, timelineVersion]
  );

  useEffect(() => {
    if (!routeCChatShell) return undefined;
    return subscribeOysterunRouteCOptimisticProviderResponding((detail) => {
      if (detail.roomId !== room.roomId) return;
      if (detail.sessionId && routeCSessionId && detail.sessionId !== routeCSessionId) return;
      const nextOptimistic = detail.status === 'accepted' ? detail : undefined;
      optimisticRef.current = nextOptimistic;
      setRawLifecycle((current) => {
        const next = {
          ...current,
          roomId: room.roomId,
          sessionId: routeCSessionId,
          optimistic: nextOptimistic,
          semanticActivity,
        };
        rememberRawLifecycle(next);
        return next;
      });
    });
  }, [room.roomId, routeCChatShell, routeCSessionId, semanticActivity]);

  useEffect(() => {
    if (!routeCChatShell || !routeCSessionId) {
      const next = { roomId: room.roomId };
      rawLifecycleRef.current = next;
      setRawLifecycle(next);
      return undefined;
    }

    let stopped = false;
    let inFlight = false;
    let generation = 0;
    let transientFailureCount = 0;
    let timerId: number | undefined;
    const scheduleNextRefresh = () => {
      if (stopped) return;
      if (selectPollingNeeded(rawLifecycleRef.current)) {
        timerId = window.setTimeout(
          refreshCanonicalLifecycle,
          OYSTERUN_ROUTE_C_PROVIDER_TYPING_POLL_MS
        );
      }
    };
    const applyRawLifecycle = (
      snapshot: OysterunHostSessionSnapshotResponse | undefined,
      nextTransientFailureCount: number
    ) => {
      const next: OysterunMessageLifecycleRawStatus = {
        roomId: room.roomId,
        sessionId: routeCSessionId,
        snapshot,
        providerLifecycle: snapshot?.provider_lifecycle,
        optimistic: optimisticRef.current,
        semanticActivity,
        transientFailureCount: nextTransientFailureCount,
      };
      rawLifecycleRef.current = next;
      rememberRawLifecycle(next);
      setRawLifecycle(next);
    };
    const refreshCanonicalLifecycle = async () => {
      if (inFlight) return;
      inFlight = true;
      const requestGeneration = generation + 1;
      generation = requestGeneration;
      try {
        const snapshot = await getOysterunHostSessionSnapshot({ sessionId: routeCSessionId });
        inFlight = false;
        if (stopped || requestGeneration !== generation) return;
        transientFailureCount = 0;
        if (
          isOysterunProviderLifecycleActive(snapshot.provider_lifecycle) ||
          isOysterunProviderLifecycleTerminal(snapshot.provider_lifecycle)
        ) {
          optimisticRef.current = undefined;
        }
        applyRawLifecycle(snapshot, transientFailureCount);
        scheduleNextRefresh();
      } catch (err) {
        inFlight = false;
        if (stopped || requestGeneration !== generation) return;
        transientFailureCount += 1;
        const snapshot =
          transientFailureCount >= OYSTERUN_ROUTE_C_SNAPSHOT_TRANSIENT_FAILURE_LIMIT
            ? undefined
            : rawLifecycleRef.current.snapshot;
        applyRawLifecycle(snapshot, transientFailureCount);
        scheduleNextRefresh();
      }
    };

    applyRawLifecycle(rawLifecycleRef.current.snapshot, transientFailureCount);
    refreshCanonicalLifecycle();
    return () => {
      stopped = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [room.roomId, routeCChatShell, routeCSessionId, semanticActivity]);

  return selectOysterunRouteCRespondingState(rawLifecycle);
}

export function useOysterunHost2CancelControls({
  roomId,
  candidateEventIds,
  relatedPollingAllowed,
}: {
  roomId: string;
  candidateEventIds: string[];
  relatedPollingAllowed: boolean;
}): {
  cancelControlsByEventId: Record<string, OysterunHost2CancelControlState>;
  setCancelControlsByEventId: Dispatch<
    SetStateAction<Record<string, OysterunHost2CancelControlState>>
  >;
} {
  const [cancelControlsByEventId, setCancelControlsByEventId] = useState<
    Record<string, OysterunHost2CancelControlState>
  >({});
  useOysterunHost2CancelControlPolling({
    roomId,
    candidateEventIds,
    relatedPollingAllowed,
    setCancelControlsByEventId,
  });
  return { cancelControlsByEventId, setCancelControlsByEventId };
}

export function useOysterunHost2CancelControlPolling({
  roomId,
  candidateEventIds,
  relatedPollingAllowed,
  setCancelControlsByEventId,
}: {
  roomId: string;
  candidateEventIds: string[];
  relatedPollingAllowed: boolean;
  setCancelControlsByEventId: Dispatch<
    SetStateAction<Record<string, OysterunHost2CancelControlState>>
  >;
}): void {
  const candidateEventIdsKey = candidateEventIds.join('\u001f');

  useEffect(() => {
    if (relatedPollingAllowed === false) {
      setCancelControlsByEventId({});
      return undefined;
    }
    const eventIds = candidateEventIdsKey ? candidateEventIdsKey.split('\u001f') : [];
    if (!eventIds.length) return undefined;
    let stopped = false;
    let inFlight = false;
    let retryDelayMs = OYSTERUN_HOST2_CANCEL_POLL_MIN_MS;
    let timerId: number | undefined;
    const settledEventIds = new Set<string>();
    const hiddenPollCountsByEventId = new Map<string, number>();

    function scheduleNextRefresh() {
      if (stopped) return;
      const hasActiveCandidate = eventIds.some((eventId) => !settledEventIds.has(eventId));
      if (!hasActiveCandidate) return;
      timerId = window.setTimeout(refreshCancelControls, retryDelayMs);
    }

    async function refreshCancelControls() {
      if (stopped || inFlight) return;
      const activeCandidateEventIds = eventIds.filter((eventId) => !settledEventIds.has(eventId));
      if (!activeCandidateEventIds.length) return;
      inFlight = true;
      const results = await Promise.all(
        activeCandidateEventIds.map(async (eventId) => {
          try {
            const response = await getOysterunHost2IntakeProof({
              roomId,
              eventId,
            });
            rememberOysterunHost2IntakeProof({
              roomId,
              eventId,
              sessionId: response.proof.host_session_id || undefined,
              proof: response.proof,
            });
            return { eventId, proof: response.proof };
          } catch (err) {
            return {
              eventId,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );
      inFlight = false;
      if (stopped) return;
      let visibleCandidateCount = 0;
      const candidateSet = new Set(eventIds);
      setCancelControlsByEventId((current) => {
        const next: Record<string, OysterunHost2CancelControlState> = {};
        Object.entries(current).forEach(([existingEventId, existingState]) => {
          if (
            candidateSet.has(existingEventId) ||
            existingState.status === 'ready' ||
            existingState.status === 'canceling' ||
            existingState.status === 'accepted' ||
            existingState.status === 'error'
          ) {
            next[existingEventId] = existingState;
          }
        });
        results.forEach((result) => {
          const currentState = current[result.eventId];
          if ('error' in result) {
            const hiddenPollCount = (hiddenPollCountsByEventId.get(result.eventId) ?? 0) + 1;
            hiddenPollCountsByEventId.set(result.eventId, hiddenPollCount);
            if (hiddenPollCount >= OYSTERUN_HOST2_CANCEL_MAX_HIDDEN_POLLS) {
              settledEventIds.add(result.eventId);
            }
            if (currentState && currentState.status !== 'accepted') {
              next[result.eventId] = {
                ...currentState,
                status: 'error',
                error: result.error,
              };
            }
          } else {
            const visible = isOysterunHost2CancelableProof(result.proof, result.eventId);
            if (visible) {
              visibleCandidateCount += 1;
              hiddenPollCountsByEventId.delete(result.eventId);
              if (currentState?.status === 'canceling' || currentState?.status === 'accepted') {
                next[result.eventId] = currentState;
              } else {
                if (currentState?.status !== 'ready') {
                  recordOysterunCancelControlProof(
                    {
                      target_user_event_id: result.eventId,
                      target_user_event_id_hash: result.proof.source_user_event_id_raw_hash,
                      host_session_id: result.proof.host_session_id,
                      matrix_room_id: result.proof.matrix_room_id,
                      host2_intake_state_before_click: result.proof.host2_intake_state,
                      cancelable_before_click: result.proof.cancelable === true,
                      agent_turn_started_before_click: result.proof.agent_turn_started === true,
                      cancel_control_selector: 'data-testid:oysterun-routec-host2-cancel-button',
                      cancel_control_owner: 'oysterun-app',
                      same_event_both_canceled_and_started:
                        result.proof.same_event_both_canceled_and_started === true,
                    },
                    'visible_before_click'
                  );
                }
                next[result.eventId] = { status: 'ready', proof: result.proof };
              }
            } else if (currentState?.status === 'accepted' || currentState?.status === 'error') {
              next[result.eventId] = { ...currentState, proof: result.proof };
            } else {
              if (isOysterunHost2CancelPollingTerminalProof(result.proof, result.eventId)) {
                settledEventIds.add(result.eventId);
              } else {
                const hiddenPollCount = (hiddenPollCountsByEventId.get(result.eventId) ?? 0) + 1;
                hiddenPollCountsByEventId.set(result.eventId, hiddenPollCount);
                if (hiddenPollCount >= OYSTERUN_HOST2_CANCEL_MAX_HIDDEN_POLLS) {
                  settledEventIds.add(result.eventId);
                }
              }
              next[result.eventId] = { status: 'hidden', proof: result.proof };
            }
          }
        });
        return next;
      });
      retryDelayMs =
        visibleCandidateCount > 0
          ? OYSTERUN_HOST2_CANCEL_POLL_MIN_MS
          : Math.min(retryDelayMs * 2, OYSTERUN_HOST2_CANCEL_POLL_MAX_MS);
      scheduleNextRefresh();
    }

    refreshCancelControls();
    return () => {
      stopped = true;
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
    };
  }, [roomId, candidateEventIdsKey, relatedPollingAllowed]);
}
