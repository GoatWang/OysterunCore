import { createHash } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { homedir } from "os";
import {
  getRouteCMatrixActorByKey,
  getRouteCMatrixActorByUserId,
  getRouteCMatrixActorRegistry,
} from "./matrix-room-binding.mjs";
import { readConfig } from "./config.mjs";
import {
  buildToolEventDetailRecordFromMatrixEvent,
  projectToolEventForClientTransfer,
} from "./tool-event-transfer-projection.mjs";
import { ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES } from "./tool-event-detail-store.mjs";

const CONFIG_DIR =
  process.env.OYSTERUN_CONFIG_DIR || join(homedir(), ".oysterun");
const STORAGE_SCHEMA_VERSION = "routec.host_owned_matrix_storage.v1";
const STORAGE_DELTA_SCHEMA_VERSION =
  "routec.host_owned_matrix_storage.delta.v1";
const OYSTERUN_BRANCH_COPY_NAMESPACE = "org.oysterun.branch_copy.v1";
const ROUTEC_CHECKPOINT_TOKEN_PREFIX = "routec_s";
const DEFAULT_SYNC_TIMELINE_LIMIT = 30;
const DEFAULT_MESSAGES_LIMIT = 30;
const DEFAULT_CONTEXT_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_MATRIX_TIMELINE_LIMIT = 100;
const P135_MATRIX_CLIENT_TRANSFER_BUDGET_BYTES = 512 * 1024;
const P135_MATRIX_TRANSFER_BUDGET_SCHEMA_VERSION =
  "routec.p135_matrix_reentry_transfer_budget.v1";
const MAX_MATRIX_SYNC_LONG_POLL_TIMEOUT_MS = 30_000;
const MAX_MATRIX_SYNC_LONG_POLL_WAITERS_PER_ROOM = 8;
const OYSTERUN_SEMANTIC_NAMESPACE = "org.oysterun.semantic.v1";
const MATRIX_ROOM_CREATE_EVENT_TYPE = "m.room.create";
const MATRIX_ROOM_MESSAGE_EVENT_TYPE = "m.room.message";
const MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE = "m.room.pinned_events";
const MATRIX_ROOM_POWER_LEVELS_STATE_TYPE = "m.room.power_levels";
const MATRIX_STATE_KEY_SEPARATOR = "\u001f";
const ROUTEC_BODY_KEYWORD_SEARCH_CATEGORIES = Object.freeze([
  "message.user",
  "message.assistant",
  "tool.call",
  "tool.result",
  "status",
  "control.request",
  "control.outcome",
]);
const ROUTEC_BODY_KEYWORD_SEARCH_CATEGORY_SET = new Set(
  ROUTEC_BODY_KEYWORD_SEARCH_CATEGORIES
);
const ROUTEC_BODY_KEYWORD_SEARCH_CATEGORY_COMPATIBILITY = new Map([
  ["tool.output", "tool.result"],
  ["tool.failure", "tool.result"],
  ["session_lifecycle", "status"],
  ["runtime.error", "status"],
  ["outbox.delivery", "status"],
  ["ambiguous.stalled", "status"],
  ["control.cancel.request", "control.request"],
  ["control.cancel.outcome", "control.outcome"],
]);

function isRouteCChatLivenessDiagnosticsEnabled() {
  return readConfig().debug_routec_chat_liveness_diagnostics_enabled === true;
}

function routeCToolDetailText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function routeCTopToolDetailText(value) {
  const text = routeCToolDetailText(value);
  if (
    Buffer.byteLength(text, "utf8") <=
    ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES
  ) {
    return {
      text,
      truncated: false,
    };
  }
  const buffer = Buffer.from(text, "utf8").subarray(
    0,
    ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES
  );
  return {
    text: buffer.toString("utf8").replace(/\uFFFD$/, ""),
    truncated: true,
  };
}

let cachedStorePath = null;
let cachedStoreSize = null;
let cachedStoreMtimeMs = null;
let cachedStoreDeltaSize = null;
let cachedStoreDeltaMtimeMs = null;
let cachedStore = null;
let lastRouteCMatrixStorageRecoveryProof = null;
const storeWriteBatchScope = new AsyncLocalStorage();
let routeCMatrixSyncWakeCandidateCollector = null;
let nextRouteCMatrixSyncWaiterId = 1;
let nextRouteCMatrixSyncLongPollRequestId = 1;
const routeCMatrixSyncWaitersByKey = new Map();
const routeCMatrixSyncLastServedNextSeqByKey = new Map();
const routeCMatrixSyncLongPollDiagnostics = {
  registered: 0,
  coalesced_registered: 0,
  small_stale_lag_registered: 0,
  woken: 0,
  coalesced_woken: 0,
  small_stale_lag_woken: 0,
  timed_out: 0,
  coalesced_timed_out: 0,
  small_stale_lag_timed_out: 0,
  request_aborted: 0,
  coalesced_request_aborted: 0,
  small_stale_lag_request_aborted: 0,
  request_closed: 0,
  coalesced_request_closed: 0,
  small_stale_lag_request_closed: 0,
  cap_rejected: 0,
  cleaned: 0,
  coalesced_cleaned: 0,
  small_stale_lag_cleaned: 0,
  last_settlement: null,
};

function isRouteCMatrixStorageCacheEnabled() {
  return readConfig().routec_matrix_storage_cache_enabled !== false;
}

function routeCMatrixSyncIdleLongPollTimeoutMs() {
  return Math.min(
    readConfig().routec_matrix_sync_idle_long_poll_timeout_ms,
    MAX_MATRIX_SYNC_LONG_POLL_TIMEOUT_MS
  );
}

function routeCMatrixSyncActiveCoalesceMs() {
  return readConfig().routec_matrix_sync_active_coalesce_ms;
}

function clearStoreCache() {
  cachedStorePath = null;
  cachedStoreSize = null;
  cachedStoreMtimeMs = null;
  cachedStoreDeltaSize = null;
  cachedStoreDeltaMtimeMs = null;
  cachedStore = null;
}

function routeCMatrixSyncWaiterKey(binding) {
  requireBinding(binding);
  return [
    binding.host_session_id,
    binding.host_agent_id,
    binding.matrix_room_id,
    binding.matrix_user_id,
  ].join("\u001f");
}

function routeCMatrixSyncWaiterCount() {
  let count = 0;
  for (const waiters of routeCMatrixSyncWaitersByKey.values()) {
    count += waiters.size;
  }
  return count;
}

function routeCMatrixSyncCoalescedRequestCount() {
  let count = 0;
  for (const waiters of routeCMatrixSyncWaitersByKey.values()) {
    for (const waiter of waiters.values()) {
      for (const participant of waiter.participants.values()) {
        if (participant.coalesced) count += 1;
      }
    }
  }
  return count;
}

function routeCMatrixSyncActiveCoalescingGroupCount() {
  let count = 0;
  for (const waiters of routeCMatrixSyncWaitersByKey.values()) {
    for (const waiter of waiters.values()) {
      if ([...waiter.participants.values()].some((entry) => entry.coalesced)) {
        count += 1;
      }
    }
  }
  return count;
}

function routeCMatrixSyncSmallStaleLagRequestCount() {
  let count = 0;
  for (const waiters of routeCMatrixSyncWaitersByKey.values()) {
    for (const waiter of waiters.values()) {
      for (const participant of waiter.participants.values()) {
        if (participant.smallStaleLagCoalescing) count += 1;
      }
    }
  }
  return count;
}

function routeCMatrixSyncWaiterCountsByKey() {
  const counts = {};
  for (const [key, waiters] of routeCMatrixSyncWaitersByKey.entries()) {
    counts[key] = waiters.size;
  }
  return counts;
}

export function getRouteCMatrixSyncLongPollDiagnostics() {
  return {
    ...routeCMatrixSyncLongPollDiagnostics,
    pending_waiter_count: routeCMatrixSyncWaiterCount(),
    pending_coalesced_request_count: routeCMatrixSyncCoalescedRequestCount(),
    pending_small_stale_lag_request_count:
      routeCMatrixSyncSmallStaleLagRequestCount(),
    active_coalescing_group_count: routeCMatrixSyncActiveCoalescingGroupCount(),
    pending_waiter_counts_by_key: routeCMatrixSyncWaiterCountsByKey(),
    max_timeout_ms: MAX_MATRIX_SYNC_LONG_POLL_TIMEOUT_MS,
    idle_long_poll_timeout_ms: routeCMatrixSyncIdleLongPollTimeoutMs(),
    active_coalesce_ms: routeCMatrixSyncActiveCoalesceMs(),
    max_waiters_per_room: MAX_MATRIX_SYNC_LONG_POLL_WAITERS_PER_ROOM,
    host_owned_matrix_sync_long_poll: true,
    active_current_since_coalescing_window_ms:
      routeCMatrixSyncActiveCoalesceMs(),
  };
}

export function resetRouteCMatrixSyncLongPollDiagnosticsForTest() {
  const pending = routeCMatrixSyncWaiterCount();
  if (pending > 0) {
    throw new Error(
      `Cannot reset Route C Matrix sync long-poll diagnostics with ${pending} pending waiter(s)`
    );
  }
  routeCMatrixSyncLongPollDiagnostics.registered = 0;
  routeCMatrixSyncLongPollDiagnostics.coalesced_registered = 0;
  routeCMatrixSyncLongPollDiagnostics.small_stale_lag_registered = 0;
  routeCMatrixSyncLongPollDiagnostics.woken = 0;
  routeCMatrixSyncLongPollDiagnostics.coalesced_woken = 0;
  routeCMatrixSyncLongPollDiagnostics.small_stale_lag_woken = 0;
  routeCMatrixSyncLongPollDiagnostics.timed_out = 0;
  routeCMatrixSyncLongPollDiagnostics.coalesced_timed_out = 0;
  routeCMatrixSyncLongPollDiagnostics.small_stale_lag_timed_out = 0;
  routeCMatrixSyncLongPollDiagnostics.request_aborted = 0;
  routeCMatrixSyncLongPollDiagnostics.coalesced_request_aborted = 0;
  routeCMatrixSyncLongPollDiagnostics.small_stale_lag_request_aborted = 0;
  routeCMatrixSyncLongPollDiagnostics.request_closed = 0;
  routeCMatrixSyncLongPollDiagnostics.coalesced_request_closed = 0;
  routeCMatrixSyncLongPollDiagnostics.small_stale_lag_request_closed = 0;
  routeCMatrixSyncLongPollDiagnostics.cap_rejected = 0;
  routeCMatrixSyncLongPollDiagnostics.cleaned = 0;
  routeCMatrixSyncLongPollDiagnostics.coalesced_cleaned = 0;
  routeCMatrixSyncLongPollDiagnostics.small_stale_lag_cleaned = 0;
  routeCMatrixSyncLongPollDiagnostics.last_settlement = null;
}

function cloneRouteCMatrixSyncBinding(binding) {
  requireBinding(binding);
  return {
    ...binding,
  };
}

function normalizeMatrixSyncLongPollTimeout(rawTimeout) {
  if (rawTimeout === null || rawTimeout === undefined || rawTimeout === "") {
    return routeCMatrixSyncIdleLongPollTimeoutMs();
  }
  const numericTimeout = Number(rawTimeout);
  if (!Number.isFinite(numericTimeout) || !Number.isInteger(numericTimeout)) {
    throw invalidMatrixParam(
      "Route C Matrix storage sync timeout must be an integer millisecond value."
    );
  }
  if (numericTimeout <= 0) return 0;
  return Math.min(
    numericTimeout,
    routeCMatrixSyncIdleLongPollTimeoutMs(),
    MAX_MATRIX_SYNC_LONG_POLL_TIMEOUT_MS
  );
}

function matrixSyncLongPollProof({
  mode,
  reason,
  timeoutMs,
  waiterId = null,
  requestId = null,
  sinceSeq = null,
  wakeSeq = null,
  registered = false,
  coalesced = false,
  smallStaleLagCoalescing = false,
}) {
  return {
    routec_matrix_sync_long_poll: true,
    host_owned_matrix_sync_timeout_semantics: true,
    idle_long_poll_timeout_ms: routeCMatrixSyncIdleLongPollTimeoutMs(),
    active_coalesce_ms: routeCMatrixSyncActiveCoalesceMs(),
    active_current_since_coalescing_window_ms:
      routeCMatrixSyncActiveCoalesceMs(),
    mode,
    reason,
    timeout_ms: timeoutMs,
    requested_since_seq: sinceSeq,
    wake_since_seq: wakeSeq,
    waiter_id: waiterId,
    request_id: requestId,
    waiter_registered: registered,
    coalesced_request: coalesced,
    small_stale_lag_coalescing: smallStaleLagCoalescing,
    owner_waiter_id: waiterId,
    pending_waiter_count: routeCMatrixSyncWaiterCount(),
    pending_coalesced_request_count: routeCMatrixSyncCoalescedRequestCount(),
    pending_small_stale_lag_request_count:
      routeCMatrixSyncSmallStaleLagRequestCount(),
    active_coalescing_group_count: routeCMatrixSyncActiveCoalescingGroupCount(),
    max_timeout_ms: MAX_MATRIX_SYNC_LONG_POLL_TIMEOUT_MS,
    max_waiters_per_room: MAX_MATRIX_SYNC_LONG_POLL_WAITERS_PER_ROOM,
  };
}

function addRouteCMatrixSyncLongPollProof(body, proof) {
  return {
    ...body,
    routec_sync_long_poll_proof: proof,
  };
}

function removeRouteCMatrixSyncLongPollParticipant(participant, settlement) {
  const waiter = participant.waiter;
  waiter.participants.delete(participant.id);
  if (waiter.participants.size === 0) {
    const waiters = routeCMatrixSyncWaitersByKey.get(waiter.key);
    if (waiters) {
      waiters.delete(waiter.id);
      if (waiters.size === 0) {
        routeCMatrixSyncWaitersByKey.delete(waiter.key);
      }
    }
  }
  if (participant.timer) {
    clearTimeout(participant.timer);
    participant.timer = null;
  }
  if (typeof participant.removeRequestListeners === "function") {
    participant.removeRequestListeners();
    participant.removeRequestListeners = null;
  }
  if (participant.coalesced) {
    routeCMatrixSyncLongPollDiagnostics.coalesced_cleaned += 1;
  } else if (participant.smallStaleLagCoalescing) {
    routeCMatrixSyncLongPollDiagnostics.small_stale_lag_cleaned += 1;
  } else {
    routeCMatrixSyncLongPollDiagnostics.cleaned += 1;
  }
  routeCMatrixSyncLongPollDiagnostics.last_settlement = {
    waiter_id: waiter.id,
    request_id: participant.id,
    coalesced_request: participant.coalesced,
    small_stale_lag_coalescing: participant.smallStaleLagCoalescing,
    key: waiter.key,
    reason: settlement,
    pending_waiter_count: routeCMatrixSyncWaiterCount(),
    pending_coalesced_request_count: routeCMatrixSyncCoalescedRequestCount(),
    pending_small_stale_lag_request_count:
      routeCMatrixSyncSmallStaleLagRequestCount(),
  };
}

function settleRouteCMatrixSyncLongPollParticipant(participant, reason) {
  if (participant.settled) return false;
  participant.settled = true;
  removeRouteCMatrixSyncLongPollParticipant(participant, reason);
  const diagnosticsPrefix = participant.coalesced
    ? "coalesced_"
    : participant.smallStaleLagCoalescing
      ? "small_stale_lag_"
      : "";
  if (reason === "event_commit") {
    routeCMatrixSyncLongPollDiagnostics[`${diagnosticsPrefix}woken`] += 1;
  } else if (reason === "timeout") {
    routeCMatrixSyncLongPollDiagnostics[`${diagnosticsPrefix}timed_out`] += 1;
  } else if (reason === "request_aborted") {
    routeCMatrixSyncLongPollDiagnostics[
      `${diagnosticsPrefix}request_aborted`
    ] += 1;
  } else if (reason === "request_close") {
    routeCMatrixSyncLongPollDiagnostics[
      `${diagnosticsPrefix}request_closed`
    ] += 1;
  }

  if (reason === "event_commit" || reason === "timeout") {
    try {
      participant.resolve(
        response(
          addRouteCMatrixSyncLongPollProof(
            buildSyncBody({
              binding: participant.binding,
              sinceSeq: participant.sinceSeq,
              requestedSinceToken: participant.requestedSinceToken,
              timelineLimit: participant.timelineLimit,
            }),
            matrixSyncLongPollProof({
              mode: participant.mode,
              reason,
              timeoutMs: participant.timeoutMs,
              waiterId: participant.waiter.id,
              requestId: participant.id,
              sinceSeq: participant.sinceSeq,
              wakeSeq: participant.waiter.wakeSeq,
              registered: true,
              coalesced: participant.coalesced,
              smallStaleLagCoalescing: participant.smallStaleLagCoalescing,
            })
          )
        )
      );
    } catch (err) {
      participant.reject(err);
    }
    return true;
  }

  participant.resolve(
    response(
      addRouteCMatrixSyncLongPollProof(
        matrixJsonError(
          "M_UNKNOWN",
          "Route C Matrix storage sync long-poll request ended before response."
        ),
        matrixSyncLongPollProof({
          mode: participant.mode,
          reason,
          timeoutMs: participant.timeoutMs,
          waiterId: participant.waiter.id,
          requestId: participant.id,
          sinceSeq: participant.sinceSeq,
          wakeSeq: participant.waiter.wakeSeq,
          registered: true,
          coalesced: participant.coalesced,
          smallStaleLagCoalescing: participant.smallStaleLagCoalescing,
        })
      ),
      499
    )
  );
  return true;
}

function settleRouteCMatrixSyncWaiter(waiter, reason) {
  let settled = false;
  for (const participant of [...waiter.participants.values()]) {
    settled =
      settleRouteCMatrixSyncLongPollParticipant(participant, reason) || settled;
  }
  return settled;
}

function addRouteCMatrixSyncRequestCleanup({ req, participant }) {
  const removers = [];
  const add = (target, eventName, handler) => {
    if (!target || typeof target.once !== "function") return;
    target.once(eventName, handler);
    removers.push(() => {
      if (typeof target.off === "function") {
        target.off(eventName, handler);
      } else if (typeof target.removeListener === "function") {
        target.removeListener(eventName, handler);
      }
    });
  };

  add(req, "aborted", () =>
    settleRouteCMatrixSyncLongPollParticipant(participant, "request_aborted")
  );
  if (req?.complete === false) {
    add(req, "close", () =>
      settleRouteCMatrixSyncLongPollParticipant(participant, "request_close")
    );
  }
  add(req?.socket, "close", () =>
    settleRouteCMatrixSyncLongPollParticipant(participant, "request_close")
  );

  return () => {
    for (const remove of removers.splice(0)) {
      remove();
    }
  };
}

function routeCMatrixSyncCoalescingWaiter({
  waiters,
  sinceSeq,
  wakeSeq,
  timelineLimit,
  now,
}) {
  const coalesceMs = routeCMatrixSyncActiveCoalesceMs();
  for (const waiter of waiters.values()) {
    if (
      waiter.sinceSeq === sinceSeq &&
      waiter.wakeSeq === wakeSeq &&
      waiter.timelineLimit === timelineLimit &&
      waiter.participants.size > 0 &&
      now - waiter.createdAtMs <= coalesceMs
    ) {
      return waiter;
    }
  }
  return null;
}

function createRouteCMatrixSyncLongPollParticipant({
  waiter,
  req,
  binding,
  sinceSeq,
  requestedSinceToken,
  timelineLimit,
  timeoutMs,
  resolve,
  reject,
  mode,
  coalesced,
  smallStaleLagCoalescing = false,
}) {
  const participant = {
    id: nextRouteCMatrixSyncLongPollRequestId++,
    waiter,
    binding: cloneRouteCMatrixSyncBinding(binding),
    sinceSeq,
    requestedSinceToken,
    timelineLimit,
    timeoutMs,
    resolve,
    reject,
    mode,
    coalesced,
    smallStaleLagCoalescing,
    settled: false,
    timer: null,
    removeRequestListeners: null,
  };
  waiter.participants.set(participant.id, participant);
  if (coalesced) {
    routeCMatrixSyncLongPollDiagnostics.coalesced_registered += 1;
  } else if (smallStaleLagCoalescing) {
    routeCMatrixSyncLongPollDiagnostics.small_stale_lag_registered += 1;
  } else {
    routeCMatrixSyncLongPollDiagnostics.registered += 1;
  }
  participant.removeRequestListeners = addRouteCMatrixSyncRequestCleanup({
    req,
    participant,
  });
  participant.timer = setTimeout(() => {
    settleRouteCMatrixSyncLongPollParticipant(participant, "timeout");
  }, timeoutMs);
  return participant;
}

function wakeRouteCMatrixSyncWaiters(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return;
  for (const candidate of candidates) {
    const key = routeCMatrixSyncWaiterKey(candidate.binding);
    const waiters = routeCMatrixSyncWaitersByKey.get(key);
    if (!waiters) continue;
    for (const waiter of [...waiters.values()]) {
      if (candidate.stream_seq >= waiter.wakeSeq) {
        settleRouteCMatrixSyncWaiter(waiter, "event_commit");
      }
    }
  }
}

function recordRouteCMatrixSyncLongPollWakeCandidate({ binding, event }) {
  if (!isObject(event)) return;
  const streamSeq = Number.isSafeInteger(event.routec_stream_seq)
    ? event.routec_stream_seq
    : event.routec_state_seq;
  if (!Number.isSafeInteger(streamSeq)) return;
  const candidate = {
    binding: cloneRouteCMatrixSyncBinding(binding),
    room_id: binding.matrix_room_id,
    stream_seq: streamSeq,
    event_id: event.event_id,
  };
  const activeBatch = storeWriteBatchScope.getStore();
  if (activeBatch) {
    activeBatch.syncWakeCandidates.push(candidate);
    return;
  }
  if (Array.isArray(routeCMatrixSyncWakeCandidateCollector)) {
    routeCMatrixSyncWakeCandidateCollector.push(candidate);
  }
}

function latestBoundRoomEvent(store, binding) {
  const events = boundRoomEventsInStreamOrder(store, binding);
  return events.length > 0 ? events[events.length - 1] : null;
}

function routeCMatrixSyncSmallStaleLagPlan({
  binding,
  store,
  sinceSeq,
  timeoutMs,
  now,
}) {
  const key = routeCMatrixSyncWaiterKey(binding);
  if (routeCMatrixSyncLastServedNextSeqByKey.get(key) !== sinceSeq) {
    return null;
  }
  const latestEvent = latestBoundRoomEvent(store, binding);
  if (!latestEvent || latestEvent.routec_stream_seq < sinceSeq) return null;
  const eventAgeMs = Math.max(0, now - (latestEvent.origin_server_ts || now));
  const coalesceMs = routeCMatrixSyncActiveCoalesceMs();
  if (eventAgeMs >= coalesceMs) return null;
  return {
    wakeSeq: store.next_stream_seq,
    timeoutMs: Math.max(1, Math.min(timeoutMs, coalesceMs - eventAgeMs)),
  };
}

function handleLongPollingSyncRequest({
  req,
  binding,
  sinceSeq,
  requestedSinceToken,
  timelineLimit,
  timeoutMs,
}) {
  const now = Date.now();
  const store = readStore();
  assertCheckpointWithinStore(sinceSeq, store, "since");
  if (sinceSeq === null) {
    return response(
      addRouteCMatrixSyncLongPollProof(
        buildSyncBody({ binding, sinceSeq, requestedSinceToken, timelineLimit }),
        matrixSyncLongPollProof({
          mode: "immediate",
          reason: "initial_sync_without_since",
          timeoutMs,
          sinceSeq,
          wakeSeq: sinceSeq,
        })
      )
    );
  }
  if (timeoutMs <= 0) {
    return response(
      addRouteCMatrixSyncLongPollProof(
        buildSyncBody({ binding, sinceSeq, requestedSinceToken, timelineLimit }),
        matrixSyncLongPollProof({
          mode: "immediate",
          reason: "non_positive_timeout",
          timeoutMs,
          sinceSeq,
          wakeSeq: sinceSeq,
        })
      )
    );
  }
  if (sinceSeq < store.next_stream_seq) {
    const staleLagPlan = routeCMatrixSyncSmallStaleLagPlan({
      binding,
      store,
      sinceSeq,
      timeoutMs,
      now,
    });
    if (staleLagPlan) {
      return registerRouteCMatrixSyncLongPoll({
        req,
        binding,
        sinceSeq,
        wakeSeq: staleLagPlan.wakeSeq,
        requestedSinceToken,
        timelineLimit,
        timeoutMs: staleLagPlan.timeoutMs,
        mode: "active_coalesce",
        smallStaleLagCoalescing: true,
        now,
      });
    }
    return response(
      addRouteCMatrixSyncLongPollProof(
        buildSyncBody({ binding, sinceSeq, requestedSinceToken, timelineLimit }),
        matrixSyncLongPollProof({
          mode: "immediate",
          reason: "stale_since",
          timeoutMs,
          sinceSeq,
          wakeSeq: sinceSeq,
        })
      )
    );
  }

  return registerRouteCMatrixSyncLongPoll({
    req,
    binding,
    sinceSeq,
    wakeSeq: sinceSeq,
    requestedSinceToken,
    timelineLimit,
    timeoutMs,
    mode: "long_poll",
    smallStaleLagCoalescing: false,
    now,
  });
}

function registerRouteCMatrixSyncLongPoll({
  req,
  binding,
  sinceSeq,
  wakeSeq,
  requestedSinceToken,
  timelineLimit,
  timeoutMs,
  mode,
  smallStaleLagCoalescing,
  now,
}) {
  const key = routeCMatrixSyncWaiterKey(binding);
  let waiters = routeCMatrixSyncWaitersByKey.get(key);
  if (!waiters) {
    waiters = new Map();
    routeCMatrixSyncWaitersByKey.set(key, waiters);
  }
  const coalescedWaiter = routeCMatrixSyncCoalescingWaiter({
    waiters,
    sinceSeq,
    wakeSeq,
    timelineLimit,
    now,
  });
  if (coalescedWaiter) {
    return new Promise((resolve, reject) => {
      createRouteCMatrixSyncLongPollParticipant({
        waiter: coalescedWaiter,
        req,
        binding,
        sinceSeq,
        requestedSinceToken,
        timelineLimit,
        timeoutMs,
        resolve,
        reject,
        mode,
        coalesced: true,
        smallStaleLagCoalescing,
      });
    });
  }
  if (waiters.size >= MAX_MATRIX_SYNC_LONG_POLL_WAITERS_PER_ROOM) {
    routeCMatrixSyncLongPollDiagnostics.cap_rejected += 1;
    return response(
      addRouteCMatrixSyncLongPollProof(
        matrixJsonError(
          "M_LIMIT_EXCEEDED",
          "Route C Matrix storage sync long-poll waiter cap exceeded."
        ),
        matrixSyncLongPollProof({
          mode: "rejected",
          reason: "waiter_cap_exceeded",
          timeoutMs,
          sinceSeq,
          wakeSeq,
        })
      ),
      429
    );
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      id: nextRouteCMatrixSyncWaiterId++,
      key,
      binding: cloneRouteCMatrixSyncBinding(binding),
      sinceSeq,
      wakeSeq,
      timelineLimit,
      createdAtMs: now,
      participants: new Map(),
    };
    waiters.set(waiter.id, waiter);
    createRouteCMatrixSyncLongPollParticipant({
      waiter,
      req,
      binding,
      sinceSeq,
      requestedSinceToken,
      timelineLimit,
      timeoutMs,
      resolve,
      reject,
      mode,
      coalesced: false,
      smallStaleLagCoalescing,
    });
  });
}

class RouteCMatrixStorageClientError extends Error {
  constructor(status, errcode, error) {
    super(error);
    this.name = "RouteCMatrixStorageClientError";
    this.status = status;
    this.body = matrixJsonError(errcode, error);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeStorageSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stackRootFromConfigDir() {
  return basename(CONFIG_DIR) === "host" ? dirname(CONFIG_DIR) : CONFIG_DIR;
}

export function getRouteCMatrixStoragePath() {
  const configured = process.env.OYSTERUN_ROUTEC_MATRIX_STORAGE_PATH;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  return join(stackRootFromConfigDir(), "matrix", "homeserver.db");
}

export function getRouteCMatrixStorageDeltaPath(
  storagePath = getRouteCMatrixStoragePath()
) {
  return `${storagePath}.delta.jsonl`;
}

export function getRouteCMatrixStorageProof({ ensure = false } = {}) {
  const storagePath = getRouteCMatrixStoragePath();
  if (ensure) {
    ensureStore();
  }
  return {
    storage_adapter: "host_owned_routec_matrix_storage",
    storage_schema_version: STORAGE_SCHEMA_VERSION,
    storage_delta_schema_version: STORAGE_DELTA_SCHEMA_VERSION,
    storage_path: storagePath,
    storage_delta_path: getRouteCMatrixStorageDeltaPath(storagePath),
    storage_path_source: process.env.OYSTERUN_ROUTEC_MATRIX_STORAGE_PATH
      ? "OYSTERUN_ROUTEC_MATRIX_STORAGE_PATH"
      : "OYSTERUN_CONFIG_DIR_derived_stack_matrix_path",
    stack_owned_matrix_storage: true,
    raw_synapse_base_url_required: false,
    raw_synapse_token_required: false,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function initialStore() {
  return {
    schema_version: STORAGE_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    next_stream_seq: 1,
    rooms: {},
    events_by_id: {},
    txn_to_event_id: {},
  };
}

function validateStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    throw new Error("Route C Matrix storage store must be an object");
  }
  if (store.schema_version !== STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `Route C Matrix storage schema mismatch: ${
        store.schema_version || "missing"
      }`
    );
  }
  if (
    !store.rooms ||
    typeof store.rooms !== "object" ||
    Array.isArray(store.rooms)
  ) {
    throw new Error("Route C Matrix storage missing rooms object");
  }
  if (
    !store.events_by_id ||
    typeof store.events_by_id !== "object" ||
    Array.isArray(store.events_by_id)
  ) {
    throw new Error("Route C Matrix storage missing events_by_id object");
  }
  if (
    !store.txn_to_event_id ||
    typeof store.txn_to_event_id !== "object" ||
    Array.isArray(store.txn_to_event_id)
  ) {
    throw new Error("Route C Matrix storage missing txn_to_event_id object");
  }
  if (!Number.isInteger(store.next_stream_seq) || store.next_stream_seq < 1) {
    throw new Error(
      "Route C Matrix storage next_stream_seq must be a positive integer"
    );
  }
}

function fileSignature(path) {
  if (!existsSync(path)) {
    return {
      exists: false,
      size: null,
      mtimeMs: null,
    };
  }
  const stats = statSync(path);
  return {
    exists: true,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function updateStoreCacheFromFiles(storagePath, store) {
  if (!isRouteCMatrixStorageCacheEnabled()) {
    clearStoreCache();
    return;
  }
  const storageSignature = fileSignature(storagePath);
  const deltaSignature = fileSignature(
    getRouteCMatrixStorageDeltaPath(storagePath)
  );
  cachedStorePath = storagePath;
  cachedStoreSize = storageSignature.size;
  cachedStoreMtimeMs = storageSignature.mtimeMs;
  cachedStoreDeltaSize = deltaSignature.size;
  cachedStoreDeltaMtimeMs = deltaSignature.mtimeMs;
  cachedStore = store;
}

function parseTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRouteCMatrixStorageDeltaRecordSupersededBySnapshot(store, record) {
  if (
    !Number.isInteger(record?.next_stream_seq_after) ||
    record.next_stream_seq_after > store.next_stream_seq
  ) {
    return false;
  }
  const storeUpdatedAtMs = parseTimestampMs(store.updated_at);
  const recordRecordedAtMs = parseTimestampMs(record.recorded_at);
  return (
    storeUpdatedAtMs !== null &&
    recordRecordedAtMs !== null &&
    recordRecordedAtMs <= storeUpdatedAtMs
  );
}

function isRouteCMatrixStorageDeltaLogSupersededBySnapshot(store, records) {
  return (
    records.length > 0 &&
    records.every((record) =>
      isRouteCMatrixStorageDeltaRecordSupersededBySnapshot(store, record)
    )
  );
}

function routeCMatrixStorageRecoveryTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeRouteCMatrixStorageDeltaQuarantineProof({
  storagePath,
  deltaPath,
  quarantinedPath,
  reason,
  issue,
  store,
  records,
  deltaSha256,
}) {
  const proof = {
    schema_version: "routec.matrix_storage_delta_quarantine.v1",
    recorded_at: new Date().toISOString(),
    action: "quarantined_stale_delta_log",
    reason,
    storage_path: storagePath,
    delta_path: deltaPath,
    quarantined_path: quarantinedPath,
    delta_sha256: deltaSha256,
    snapshot_next_stream_seq: store.next_stream_seq,
    snapshot_updated_at: store.updated_at,
    delta_record_count: records.length,
    delta_records: records.map((record, index) => ({
      index,
      recorded_at: record.recorded_at || null,
      next_stream_seq_before: record.next_stream_seq_before || null,
      next_stream_seq_after: record.next_stream_seq_after || null,
      created_room_count: Array.isArray(record.created_rooms)
        ? record.created_rooms.length
        : null,
      event_count: Array.isArray(record.events) ? record.events.length : null,
      superseded_by_snapshot:
        isRouteCMatrixStorageDeltaRecordSupersededBySnapshot(store, record),
    })),
    issue,
    routec_matrix_storage_recovered: true,
  };
  const proofPath = `${quarantinedPath}.proof.json`;
  writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n");
  return {
    ...proof,
    proof_path: proofPath,
  };
}

function quarantineRouteCMatrixStorageDeltaLog({
  storagePath,
  deltaPath,
  reason,
  issue,
  store,
  records,
}) {
  const recoveryDir = join(dirname(storagePath), "recovery");
  mkdirSync(recoveryDir, { recursive: true });
  const timestamp = routeCMatrixStorageRecoveryTimestamp();
  const deltaBytes = readFileSync(deltaPath);
  const deltaSha256 = sha256(deltaBytes);
  const quarantinedPath = join(
    recoveryDir,
    `${timestamp}-${process.pid}-${basename(deltaPath)}`
  );
  renameSync(deltaPath, quarantinedPath);
  clearStoreCache();
  lastRouteCMatrixStorageRecoveryProof =
    writeRouteCMatrixStorageDeltaQuarantineProof({
      storagePath,
      deltaPath,
      quarantinedPath,
      reason,
      issue,
      store,
      records,
      deltaSha256,
    });
  return lastRouteCMatrixStorageRecoveryProof;
}

function routeCMatrixDeltaRoomId(deltaRoom) {
  return normalizeNonEmptyString(deltaRoom?.room_id);
}

function applyRouteCMatrixStorageDeltaRoom(store, deltaRoom) {
  const roomId = routeCMatrixDeltaRoomId(deltaRoom);
  if (!roomId) {
    throw new Error("Route C Matrix storage delta room requires room_id");
  }
  const existing = store.rooms[roomId];
  if (existing) {
    if (existing.host_session_id !== deltaRoom.host_session_id) {
      throw new Error(
        "Route C Matrix storage delta room is bound to a different Host session"
      );
    }
    if (!Array.isArray(existing.event_ids)) {
      throw new Error("Route C Matrix storage room event_ids must be an array");
    }
    ensureRoomStateEventsStore(existing);
    return existing;
  }
  const cloned = cloneJsonObject(deltaRoom, "Route C Matrix storage delta room");
  if (!Array.isArray(cloned.event_ids)) {
    throw new Error("Route C Matrix storage delta room event_ids must be array");
  }
  ensureRoomStateEventsStore(cloned);
  store.rooms[roomId] = cloned;
  return cloned;
}

function validateRouteCMatrixStorageDeltaRecord(record) {
  if (!isObject(record)) {
    throw new Error("Route C Matrix storage delta record must be an object");
  }
  if (record.schema_version !== STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `Route C Matrix storage delta store schema mismatch: ${
        record.schema_version || "missing"
      }`
    );
  }
  if (record.delta_schema_version !== STORAGE_DELTA_SCHEMA_VERSION) {
    throw new Error(
      `Route C Matrix storage delta schema mismatch: ${
        record.delta_schema_version || "missing"
      }`
    );
  }
  if (!Array.isArray(record.created_rooms)) {
    throw new Error("Route C Matrix storage delta created_rooms must be array");
  }
  if (!Array.isArray(record.events)) {
    throw new Error("Route C Matrix storage delta events must be array");
  }
  if (
    !Number.isInteger(record.next_stream_seq_after) ||
    record.next_stream_seq_after < 1
  ) {
    throw new Error(
      "Route C Matrix storage delta next_stream_seq_after must be positive integer"
    );
  }
}

function analyzeRouteCMatrixStorageDeltaLogReplay(store, records) {
  const knownRoomIds = new Set(Object.keys(store.rooms || {}));
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    validateRouteCMatrixStorageDeltaRecord(record);
    for (const deltaRoom of record.created_rooms) {
      const roomId = routeCMatrixDeltaRoomId(deltaRoom);
      if (!roomId) {
        throw new Error("Route C Matrix storage delta room requires room_id");
      }
      knownRoomIds.add(roomId);
    }
    for (let eventIndex = 0; eventIndex < record.events.length; eventIndex += 1) {
      const entry = record.events[eventIndex];
      if (!isObject(entry)) {
        throw new Error(
          "Route C Matrix storage delta event entry must be object"
        );
      }
      const event = entry.event;
      if (!isObject(event)) {
        throw new Error("Route C Matrix storage delta event must be a JSON object");
      }
      const eventId = normalizeNonEmptyString(event.event_id);
      const roomId = normalizeNonEmptyString(event.room_id);
      const txnKey = normalizeNonEmptyString(entry.txn_key);
      if (!eventId || !roomId || !txnKey) {
        throw new Error(
          "Route C Matrix storage delta event requires event_id, room_id, and txn_key"
        );
      }
      if (!knownRoomIds.has(roomId)) {
        return {
          type: "missing_room",
          record_index: recordIndex,
          event_index: eventIndex,
          room_id: roomId,
          event_id: eventId,
          txn_key: txnKey,
          record_recorded_at: record.recorded_at || null,
          record_next_stream_seq_after: record.next_stream_seq_after || null,
        };
      }
    }
  }
  return null;
}

function applyRouteCMatrixStorageDeltaRecord(store, record) {
  validateRouteCMatrixStorageDeltaRecord(record);
  for (const deltaRoom of record.created_rooms) {
    applyRouteCMatrixStorageDeltaRoom(store, deltaRoom);
  }
  for (const entry of record.events) {
    if (!isObject(entry)) {
      throw new Error("Route C Matrix storage delta event entry must be object");
    }
    const event = cloneJsonObject(
      entry.event,
      "Route C Matrix storage delta event"
    );
    const eventId = normalizeNonEmptyString(event.event_id);
    const roomId = normalizeNonEmptyString(event.room_id);
    const txnKey = normalizeNonEmptyString(entry.txn_key);
    if (!eventId || !roomId || !txnKey) {
      throw new Error(
        "Route C Matrix storage delta event requires event_id, room_id, and txn_key"
      );
    }
    let room = store.rooms[roomId];
    if (!room) {
      throw new Error(
        `Route C Matrix storage delta references missing room: ${roomId}`
      );
    }
    if (store.events_by_id[eventId]) {
      if (!room.event_ids.includes(eventId)) {
        room.event_ids.push(eventId);
      }
      store.txn_to_event_id[txnKey] = eventId;
      continue;
    }
    store.events_by_id[eventId] = event;
    store.txn_to_event_id[txnKey] = eventId;
    if (!room.event_ids.includes(eventId)) {
      room.event_ids.push(eventId);
    }
  }
  store.next_stream_seq = Math.max(
    store.next_stream_seq,
    record.next_stream_seq_after
  );
  store.updated_at = record.recorded_at || new Date().toISOString();
}

function applyRouteCMatrixStorageDeltaLog(store, storagePath) {
  const deltaPath = getRouteCMatrixStorageDeltaPath(storagePath);
  if (!existsSync(deltaPath)) {
    return {
      delta_path: deltaPath,
      delta_record_count: 0,
      delta_event_count: 0,
    };
  }
  const lines = readFileSync(deltaPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const records = lines.map((line) => JSON.parse(line));
  const replayIssue = analyzeRouteCMatrixStorageDeltaLogReplay(store, records);
  if (replayIssue?.type === "missing_room") {
    if (isRouteCMatrixStorageDeltaLogSupersededBySnapshot(store, records)) {
      const recovery = quarantineRouteCMatrixStorageDeltaLog({
        storagePath,
        deltaPath,
        reason: "stale_delta_references_missing_room",
        issue: replayIssue,
        store,
        records,
      });
      return {
        delta_path: deltaPath,
        delta_record_count: 0,
        delta_event_count: 0,
        delta_quarantined: true,
        recovery,
      };
    }
    throw new Error(
      `Route C Matrix storage delta references missing room: ${replayIssue.room_id}`
    );
  }
  let deltaEventCount = 0;
  for (const record of records) {
    applyRouteCMatrixStorageDeltaRecord(store, record);
    deltaEventCount += record.events.length;
  }
  validateStore(store);
  return {
    delta_path: deltaPath,
    delta_record_count: lines.length,
    delta_event_count: deltaEventCount,
  };
}

function readStore() {
  const storagePath = getRouteCMatrixStoragePath();
  const activeBatch = storeWriteBatchScope.getStore();
  if (activeBatch) {
    if (activeBatch.storagePath !== storagePath) {
      throw new Error(
        "Route C Matrix storage batch cannot span multiple storage paths"
      );
    }
    return activeBatch.store;
  }
  const storageSignature = fileSignature(storagePath);
  const deltaSignature = fileSignature(
    getRouteCMatrixStorageDeltaPath(storagePath)
  );
  const cacheEnabled = isRouteCMatrixStorageCacheEnabled();
  if (
    cacheEnabled &&
    cachedStore &&
    cachedStorePath === storagePath &&
    cachedStoreSize === storageSignature.size &&
    cachedStoreMtimeMs === storageSignature.mtimeMs &&
    cachedStoreDeltaSize === deltaSignature.size &&
    cachedStoreDeltaMtimeMs === deltaSignature.mtimeMs
  ) {
    return cachedStore;
  }
  const parsed = storageSignature.exists
    ? JSON.parse(readFileSync(storagePath, "utf8"))
    : initialStore();
  validateStore(parsed);
  applyRouteCMatrixStorageDeltaLog(parsed, storagePath);
  updateStoreCacheFromFiles(storagePath, parsed);
  return parsed;
}

export function getLastRouteCMatrixStorageRecoveryProof() {
  return lastRouteCMatrixStorageRecoveryProof;
}

export function checkRouteCMatrixStorageHealth() {
  const storagePath = getRouteCMatrixStoragePath();
  const deltaPath = getRouteCMatrixStorageDeltaPath(storagePath);
  try {
    const store = readStore();
    return {
      status: "ok",
      code: "matrix_storage_ok",
      ...getRouteCMatrixStorageProof(),
      storage_exists: existsSync(storagePath),
      delta_exists: existsSync(deltaPath),
      room_count: Object.keys(store.rooms || {}).length,
      event_count: Object.keys(store.events_by_id || {}).length,
      next_stream_seq: store.next_stream_seq,
      updated_at: store.updated_at || null,
      recovery: lastRouteCMatrixStorageRecoveryProof,
    };
  } catch (err) {
    return {
      status: "degraded",
      code: "matrix_storage_unavailable",
      ...getRouteCMatrixStorageProof(),
      storage_exists: existsSync(storagePath),
      delta_exists: existsSync(deltaPath),
      error: err?.message || String(err),
      recovery: lastRouteCMatrixStorageRecoveryProof,
    };
  }
}

function removeRouteCMatrixStorageDeltaLog(storagePath) {
  const deltaPath = getRouteCMatrixStorageDeltaPath(storagePath);
  if (existsSync(deltaPath)) {
    unlinkSync(deltaPath);
  }
}

function writeStore(store) {
  validateStore(store);
  store.updated_at = new Date().toISOString();
  const storagePath = getRouteCMatrixStoragePath();
  mkdirSync(dirname(storagePath), { recursive: true });
  const tempPath = `${storagePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(store, null, 2) + "\n");
  renameSync(tempPath, storagePath);
  removeRouteCMatrixStorageDeltaLog(storagePath);
  updateStoreCacheFromFiles(storagePath, store);
}

function buildRouteCMatrixStorageDeltaRecord(batch) {
  return {
    schema_version: STORAGE_SCHEMA_VERSION,
    delta_schema_version: STORAGE_DELTA_SCHEMA_VERSION,
    recorded_at: new Date().toISOString(),
    routec_matrix_storage_delta_persistence: true,
    full_store_json_stringify_per_batch_eliminated: true,
    storage_path_hash: sha256(batch.storagePath),
    next_stream_seq_before: batch.nextStreamSeqBefore,
    next_stream_seq_after: batch.store.next_stream_seq,
    mutation_count: batch.mutationCount,
    created_rooms: [...batch.delta.createdRooms.values()].map((room) =>
      cloneJsonObject(room, "Route C Matrix storage delta created room")
    ),
    events: batch.delta.events.map((entry) => ({
      txn_key: entry.txnKey,
      event: cloneJsonObject(entry.event, "Route C Matrix storage delta event"),
    })),
  };
}

function writeRouteCMatrixStorageDeltaRecord(batch) {
  const record = buildRouteCMatrixStorageDeltaRecord(batch);
  validateRouteCMatrixStorageDeltaRecord(record);
  const deltaPath = getRouteCMatrixStorageDeltaPath(batch.storagePath);
  mkdirSync(dirname(deltaPath), { recursive: true });
  const encoded = `${JSON.stringify(record)}\n`;
  appendFileSync(deltaPath, encoded);
  updateStoreCacheFromFiles(batch.storagePath, batch.store);
  return {
    delta_path: deltaPath,
    delta_record_count: 1,
    delta_event_count: record.events.length,
    delta_room_upsert_count: record.created_rooms.length,
    delta_encoded_bytes: Buffer.byteLength(encoded),
    full_store_json_stringify_per_batch_eliminated: true,
  };
}

function recordRouteCMatrixStorageBatchRoomUpsert(room) {
  const activeBatch = storeWriteBatchScope.getStore();
  if (!activeBatch) return;
  const roomId = routeCMatrixDeltaRoomId(room);
  if (!roomId) {
    activeBatch.deltaEligible = false;
    activeBatch.deltaIneligibleReason =
      activeBatch.deltaIneligibleReason || "delta_room_missing_room_id";
    return;
  }
  if (!activeBatch.delta.createdRooms.has(roomId)) {
    activeBatch.delta.createdRooms.set(
      roomId,
      cloneJsonObject(room, "Route C Matrix storage batch delta room")
    );
  }
}

function recordRouteCMatrixStorageBatchCommittedEvent({ room, event, txnKey }) {
  const activeBatch = storeWriteBatchScope.getStore();
  if (!activeBatch) return;
  if (!isObject(event) || !normalizeNonEmptyString(txnKey)) {
    activeBatch.deltaEligible = false;
    activeBatch.deltaIneligibleReason =
      activeBatch.deltaIneligibleReason || "delta_event_missing_identity";
    return;
  }
  const eventId = normalizeNonEmptyString(event.event_id);
  const roomId = normalizeNonEmptyString(event.room_id);
  if (!eventId || !roomId || roomId !== routeCMatrixDeltaRoomId(room)) {
    activeBatch.deltaEligible = false;
    activeBatch.deltaIneligibleReason =
      activeBatch.deltaIneligibleReason || "delta_event_room_identity_mismatch";
    return;
  }
  activeBatch.delta.events.push({
    txnKey,
    event: cloneJsonObject(event, "Route C Matrix storage batch delta event"),
  });
  activeBatch.deltaMutationCount += 1;
}

function ensureStore() {
  const activeBatch = storeWriteBatchScope.getStore();
  if (activeBatch) {
    activeBatch.dirty = true;
    return;
  }
  writeStore(readStore());
}

function mutateStore(mutator) {
  const activeBatch = storeWriteBatchScope.getStore();
  if (activeBatch) {
    const store = readStore();
    const deltaMutationCountBefore = activeBatch.deltaMutationCount;
    const result = mutator(store);
    activeBatch.dirty = true;
    activeBatch.mutationCount += 1;
    if (activeBatch.deltaMutationCount === deltaMutationCountBefore) {
      activeBatch.deltaEligible = false;
      activeBatch.deltaIneligibleReason =
        activeBatch.deltaIneligibleReason ||
        "batch_mutation_without_supported_delta_record";
    }
    return result;
  }
  const store = readStore();
  const wakeCandidates = [];
  const previousWakeCandidateCollector = routeCMatrixSyncWakeCandidateCollector;
  routeCMatrixSyncWakeCandidateCollector = wakeCandidates;
  let result;
  try {
    result = mutator(store);
    writeStore(store);
  } finally {
    routeCMatrixSyncWakeCandidateCollector = previousWakeCandidateCollector;
  }
  wakeRouteCMatrixSyncWaiters(wakeCandidates);
  return result;
}

export async function runRouteCMatrixStorageWriteBatch(fn) {
  if (typeof fn !== "function") {
    throw new Error("Route C Matrix storage write batch requires callback");
  }
  const existingBatch = storeWriteBatchScope.getStore();
  if (existingBatch) {
    const result = await fn();
    return {
      result,
      routec_matrix_storage_batch_commit: true,
      nested_batch: true,
      storage_path: existingBatch.storagePath,
      mutation_count: 0,
      durable_write_count: 0,
      per_event_full_store_write_eliminated: true,
    };
  }
  const storagePath = getRouteCMatrixStoragePath();
  const store = readStore();
  const batch = {
    storagePath,
    store,
    dirty: false,
    mutationCount: 0,
    nextStreamSeqBefore: store.next_stream_seq,
    afterDurableFlushCallbacks: [],
    deltaEligible: true,
    deltaIneligibleReason: null,
    deltaMutationCount: 0,
    delta: {
      createdRooms: new Map(),
      events: [],
    },
    syncWakeCandidates: [],
  };
  try {
    const result = await storeWriteBatchScope.run(batch, fn);
    let durableWriteProof = null;
    if (batch.dirty) {
      if (batch.deltaEligible && batch.delta.events.length > 0) {
        durableWriteProof = writeRouteCMatrixStorageDeltaRecord(batch);
      } else {
        writeStore(batch.store);
        durableWriteProof = {
          delta_persistence_used: false,
          delta_ineligible_reason:
            batch.deltaIneligibleReason || "no_supported_delta_events",
          full_store_snapshot_write_used: true,
          full_store_json_stringify_per_batch_eliminated: false,
        };
      }
    }
    for (const callback of batch.afterDurableFlushCallbacks) {
      await callback();
    }
    wakeRouteCMatrixSyncWaiters(batch.syncWakeCandidates);
    return {
      result,
      routec_matrix_storage_batch_commit: true,
      nested_batch: false,
      storage_path: storagePath,
      mutation_count: batch.mutationCount,
      durable_write_count: batch.dirty ? 1 : 0,
      next_stream_seq_before: batch.nextStreamSeqBefore,
      next_stream_seq_after: batch.store.next_stream_seq,
      per_event_full_store_write_eliminated: true,
      delta_persistence_used:
        durableWriteProof?.full_store_json_stringify_per_batch_eliminated ===
        true,
      full_store_json_stringify_per_batch_eliminated:
        durableWriteProof?.full_store_json_stringify_per_batch_eliminated ===
        true,
      full_store_snapshot_write_used:
        durableWriteProof?.full_store_snapshot_write_used === true,
      delta_ineligible_reason:
        durableWriteProof?.delta_ineligible_reason || null,
      delta_path: durableWriteProof?.delta_path || null,
      delta_event_count: durableWriteProof?.delta_event_count || 0,
      delta_room_upsert_count:
        durableWriteProof?.delta_room_upsert_count || 0,
      delta_encoded_bytes: durableWriteProof?.delta_encoded_bytes || 0,
    };
  } catch (err) {
    clearStoreCache();
    throw err;
  }
}

export function isRouteCMatrixStorageWriteBatchActive() {
  return Boolean(storeWriteBatchScope.getStore());
}

export function deferRouteCMatrixStorageBatchSideEffect(callback) {
  if (typeof callback !== "function") {
    throw new Error("Route C Matrix storage batch side effect requires callback");
  }
  const activeBatch = storeWriteBatchScope.getStore();
  if (!activeBatch) {
    return false;
  }
  activeBatch.afterDurableFlushCallbacks.push(callback);
  return true;
}

function requireBinding(binding) {
  if (!binding || typeof binding !== "object") {
    throw new Error("Route C Matrix storage requires binding object");
  }
  for (const key of [
    "host_session_id",
    "host_agent_id",
    "matrix_room_id",
    "matrix_user_id",
  ]) {
    if (typeof binding[key] !== "string" || !binding[key].trim()) {
      throw new Error(`Route C Matrix storage binding missing ${key}`);
    }
  }
}

function routeCCheckpointToken(seq) {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error(
      `Route C Matrix storage checkpoint sequence must be a positive safe integer: ${seq}`
    );
  }
  return `${ROUTEC_CHECKPOINT_TOKEN_PREFIX}${seq}`;
}

function invalidMatrixParam(error) {
  return new RouteCMatrixStorageClientError(400, "M_INVALID_PARAM", error);
}

function parseRouteCCheckpointToken(token, fieldName) {
  if (typeof token !== "string" || !token.trim()) {
    throw invalidMatrixParam(
      `Route C Matrix storage ${fieldName} checkpoint token is required.`
    );
  }
  const trimmed = token.trim();
  const match = trimmed.match(/^routec_s([1-9]\d*)$/);
  if (!match) {
    throw invalidMatrixParam(
      `Route C Matrix storage ${fieldName} checkpoint token must match routec_s<N>.`
    );
  }
  const seq = Number(match[1]);
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw invalidMatrixParam(
      `Route C Matrix storage ${fieldName} checkpoint sequence must be a positive safe integer.`
    );
  }
  return seq;
}

function parseOptionalRouteCCheckpointToken(token, fieldName) {
  if (token === null || token === undefined) return null;
  return parseRouteCCheckpointToken(token, fieldName);
}

function optionalSearchParam(url, name) {
  if (!url?.searchParams?.has(name)) return null;
  return url.searchParams.get(name);
}

function assertCheckpointWithinStore(seq, store, fieldName) {
  if (seq === null) return;
  if (seq > store.next_stream_seq) {
    throw invalidMatrixParam(
      `Route C Matrix storage ${fieldName} checkpoint token is beyond the current stream checkpoint.`
    );
  }
}

function normalizeTimelineLimit(rawLimit, defaultLimit) {
  if (rawLimit === null || rawLimit === undefined || rawLimit === "")
    return defaultLimit;
  const numericLimit =
    typeof rawLimit === "number" ? rawLimit : Number(rawLimit);
  if (!Number.isInteger(numericLimit) || numericLimit <= 0) return defaultLimit;
  return Math.min(numericLimit, MAX_MATRIX_TIMELINE_LIMIT);
}

function normalizeContextLimit(rawLimit) {
  if (rawLimit === null || rawLimit === undefined || rawLimit === "")
    return DEFAULT_CONTEXT_LIMIT;
  const numericLimit =
    typeof rawLimit === "number" ? rawLimit : Number(rawLimit);
  if (!Number.isInteger(numericLimit) || numericLimit < 0)
    return DEFAULT_CONTEXT_LIMIT;
  return Math.min(numericLimit, MAX_MATRIX_TIMELINE_LIMIT);
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function cloneJsonObject(value, fieldName) {
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error(`${fieldName} is not JSON serializable`);
  }
  const parsed = JSON.parse(encoded);
  if (!isObject(parsed)) {
    throw new Error(`${fieldName} did not round-trip as a JSON object`);
  }
  return parsed;
}

function normalizeStringArrayOrNull(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw invalidMatrixParam(
      `Route C Matrix storage search ${fieldName} must be an array when supplied.`
    );
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw invalidMatrixParam(
        `Route C Matrix storage search ${fieldName} must contain non-empty strings.`
      );
    }
    return entry.trim();
  });
}

function syncTimelineLimitFromUrl(url) {
  const rawFilter = url?.searchParams?.get("filter");
  if (typeof rawFilter !== "string" || !rawFilter.trim()) {
    return DEFAULT_SYNC_TIMELINE_LIMIT;
  }
  const trimmedFilter = rawFilter.trim();
  if (!trimmedFilter.startsWith("{")) {
    return DEFAULT_SYNC_TIMELINE_LIMIT;
  }
  let filter;
  try {
    filter = JSON.parse(trimmedFilter);
  } catch (err) {
    throw invalidMatrixParam(
      "Route C Matrix storage sync filter must be valid JSON when supplied inline."
    );
  }
  return normalizeTimelineLimit(
    filter?.room?.timeline?.limit,
    DEFAULT_SYNC_TIMELINE_LIMIT
  );
}

function normalizedMessagesDirection(rawDirection) {
  if (
    rawDirection === null ||
    rawDirection === undefined ||
    rawDirection === ""
  )
    return "b";
  const direction = String(rawDirection).trim();
  if (direction !== "b" && direction !== "f") {
    throw invalidMatrixParam(
      "Route C Matrix storage messages dir must be b or f."
    );
  }
  return direction;
}

function eventStreamSeq(event) {
  if (
    !Number.isSafeInteger(event?.routec_stream_seq) ||
    event.routec_stream_seq < 1
  ) {
    throw new Error(
      `Route C Matrix storage event missing valid routec_stream_seq: ${
        event?.event_id || "unknown"
      }`
    );
  }
  return event.routec_stream_seq;
}

function roomMembershipEventForActor(binding, room, actor) {
  const eventId = `$routec_member_${sha256(
    `${binding.matrix_room_id}:${actor.matrix_user_id}`
  ).slice(0, 32)}`;
  return {
    type: "m.room.member",
    room_id: binding.matrix_room_id,
    sender: actor.matrix_user_id,
    state_key: actor.matrix_user_id,
    content: {
      membership: "join",
      displayname: actor.display_name,
    },
    event_id: eventId,
    origin_server_ts: room.created_at_ms,
    unsigned: {
      routec_host_owned_matrix_storage: true,
      routec_matrix_actor_key: actor.actor_key,
      routec_matrix_actor_kind: actor.actor_kind,
      routec_matrix_actor_registry_version:
        getRouteCMatrixActorRegistry(binding).registry_version,
      committed_transcript_truth: "matrix_room_timeline",
    },
  };
}

function roomMembershipEvents(binding, room) {
  return getRouteCMatrixActorRegistry(binding).actors.map((actor) =>
    roomMembershipEventForActor(binding, room, actor)
  );
}

function roomCreateEventForBinding(binding, room) {
  const eventId = `$routec_room_create_${sha256(binding.matrix_room_id).slice(
    0,
    32
  )}`;
  return {
    type: MATRIX_ROOM_CREATE_EVENT_TYPE,
    room_id: binding.matrix_room_id,
    sender: binding.matrix_user_id,
    state_key: "",
    content: {
      room_version: "11",
    },
    event_id: eventId,
    origin_server_ts: room.created_at_ms,
    unsigned: {
      routec_host_owned_matrix_storage: true,
      routec_room_create_source: "host_owned_routec_matrix_storage",
      host_session_id: binding.host_session_id,
      committed_transcript_truth: "matrix_room_state",
    },
  };
}

function roomNameEventForBinding(binding, room) {
  const name =
    normalizeNonEmptyString(binding.host_session_name) ||
    binding.host_session_id;
  const eventId = `$routec_room_name_${sha256(
    `${binding.matrix_room_id}:${name}`
  ).slice(0, 32)}`;
  return {
    type: "m.room.name",
    room_id: binding.matrix_room_id,
    sender: binding.matrix_user_id,
    state_key: "",
    content: {
      name,
    },
    event_id: eventId,
    origin_server_ts: room.created_at_ms,
    unsigned: {
      routec_host_owned_matrix_storage: true,
      routec_room_name_source: "host_session_name",
      host_session_id: binding.host_session_id,
      committed_transcript_truth: "matrix_room_timeline",
    },
  };
}

function roomPowerLevelsEventForBinding(binding, room) {
  const eventId = `$routec_room_power_levels_${sha256(
    binding.matrix_room_id
  ).slice(0, 32)}`;
  return {
    type: MATRIX_ROOM_POWER_LEVELS_STATE_TYPE,
    room_id: binding.matrix_room_id,
    sender: binding.matrix_user_id,
    state_key: "",
    content: {
      users_default: 0,
      state_default: 50,
      events_default: 0,
      invite: 0,
      redact: 50,
      kick: 50,
      ban: 50,
      events: {
        [MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE]: 0,
      },
    },
    event_id: eventId,
    origin_server_ts: room.created_at_ms,
    unsigned: {
      routec_host_owned_matrix_storage: true,
      routec_room_power_levels_source: "host_owned_routec_matrix_storage",
      routec_pin_messages_permission_source: "matrix_power_levels_state",
      host_session_id: binding.host_session_id,
      committed_transcript_truth: "matrix_room_state",
    },
  };
}

function ensureRoomStateEventsStore(room) {
  if (!room.state_events) {
    room.state_events = {};
  }
  if (
    typeof room.state_events !== "object" ||
    Array.isArray(room.state_events)
  ) {
    throw new Error(
      "Route C Matrix storage room state_events must be an object"
    );
  }
  return room.state_events;
}

function matrixStateStoreKey(eventType, stateKey = "") {
  return `${eventType}${MATRIX_STATE_KEY_SEPARATOR}${stateKey}`;
}

function persistedRoomStateEvents(room) {
  const stateEvents = ensureRoomStateEventsStore(room);
  return Object.values(stateEvents)
    .sort((left, right) => {
      const leftKey = `${left.type || ""}${MATRIX_STATE_KEY_SEPARATOR}${
        left.state_key || ""
      }`;
      const rightKey = `${right.type || ""}${MATRIX_STATE_KEY_SEPARATOR}${
        right.state_key || ""
      }`;
      return leftKey.localeCompare(rightKey);
    })
    .map(eventForClient);
}

function roomStateEvents(binding, room) {
  return [
    roomCreateEventForBinding(binding, room),
    roomPowerLevelsEventForBinding(binding, room),
    roomNameEventForBinding(binding, room),
    ...roomMembershipEvents(binding, room),
    ...persistedRoomStateEvents(room),
  ];
}

function buildRouteCMatrixRoomRecord(binding, now = Date.now()) {
  return {
    room_id: binding.matrix_room_id,
    host_session_id: binding.host_session_id,
    host_agent_id: binding.host_agent_id,
    matrix_user_id: binding.matrix_user_id,
    routec_matrix_actor_registry: getRouteCMatrixActorRegistry(binding),
    created_at: new Date(now).toISOString(),
    created_at_ms: now,
    state_events: {},
    event_ids: [],
  };
}

function validateBoundRoomRecord(room, binding) {
  if (room.host_session_id !== binding.host_session_id) {
    throw new Error(
      "Route C Matrix storage room is already bound to a different Host session"
    );
  }
  if (!Array.isArray(room.event_ids)) {
    throw new Error("Route C Matrix storage room event_ids must be an array");
  }
  ensureRoomStateEventsStore(room);
  return room;
}

function readRoomInStore(store, binding) {
  requireBinding(binding);
  const existing = store.rooms[binding.matrix_room_id];
  if (existing) {
    return validateBoundRoomRecord(existing, binding);
  }
  return buildRouteCMatrixRoomRecord(binding);
}

function ensureRoomInStore(store, binding) {
  requireBinding(binding);
  const existing = store.rooms[binding.matrix_room_id];
  if (existing) {
    return validateBoundRoomRecord(existing, binding);
  }
  const room = buildRouteCMatrixRoomRecord(binding);
  store.rooms[binding.matrix_room_id] = room;
  recordRouteCMatrixStorageBatchRoomUpsert(room);
  return room;
}

export function ensureRouteCMatrixRoomStorage({ binding }) {
  return mutateStore((store) => {
    const room = ensureRoomInStore(store, binding);
    return {
      ...getRouteCMatrixStorageProof(),
      room_id: room.room_id,
      host_session_id: room.host_session_id,
      matrix_user_id: room.matrix_user_id,
      routec_matrix_actor_registry: getRouteCMatrixActorRegistry(binding),
      room_ready: true,
    };
  });
}

function requireBranchCopySourceRoom(store, binding) {
  requireBinding(binding);
  const room = store.rooms[binding.matrix_room_id];
  if (!room) {
    throw new Error("Route C branch/copy source Matrix room storage not found");
  }
  if (room.host_session_id !== binding.host_session_id) {
    throw new Error(
      "Route C branch/copy source Matrix room is bound to a different Host session"
    );
  }
  if (!Array.isArray(room.event_ids)) {
    throw new Error(
      "Route C branch/copy source Matrix room event_ids must be an array"
    );
  }
  return room;
}

export function getRouteCMatrixRoomTimelineReplaySourceProof({
  sourceBinding,
}) {
  const store = readStore();
  const room = requireBranchCopySourceRoom(store, sourceBinding);
  const events = room.event_ids.map((eventId) => {
    const event = store.events_by_id[eventId];
    if (!event) {
      throw new Error(
        `Route C branch/copy source Matrix room references missing event: ${eventId}`
      );
    }
    return event;
  });
  boundRoomEventsInStreamOrder(store, sourceBinding);
  return {
    status: "routec_branch_copy_matrix_source_ready",
    source_host_session_id: sourceBinding.host_session_id,
    source_matrix_room_id: sourceBinding.matrix_room_id,
    source_event_count: events.length,
    committed_transcript_truth: "matrix_room_timeline",
    db_transcript_copy_product_truth: false,
    product_local_transcript_replay_shortcut_used: false,
    direct_matrix_harness_write_used: false,
    routec_host_owned_matrix_storage: true,
  };
}

export function readRouteCMatrixRoomTimelinePreview({
  binding,
  limit = DEFAULT_MESSAGES_LIMIT,
}) {
  const store = readStore();
  const room = requireBranchCopySourceRoom(store, binding);
  const normalizedLimit = normalizeTimelineLimit(limit, DEFAULT_MESSAGES_LIMIT);
  const events = room.event_ids.map((eventId) => {
    const event = store.events_by_id[eventId];
    if (!event) {
      throw new Error(
        `Route C Matrix preview source room references missing event: ${eventId}`
      );
    }
    return event;
  });
  let previousSeq = 0;
  for (const event of events) {
    const seq = eventStreamSeq(event);
    if (seq <= previousSeq) {
      throw new Error(
        "Route C Matrix preview source room events are not in strictly increasing stream order"
      );
    }
    previousSeq = seq;
  }
  const preBudgetChunk = events.slice(-normalizedLimit);
  const preBudgetClientEvents = preBudgetChunk.map(eventForClientMatrixRead);
  const budgeted = selectNewestClientEventsWithinTransferBudget({
    rawEvents: preBudgetChunk,
    clientEvents: preBudgetClientEvents,
  });
  const chunk = budgeted.rawEvents;
  const diagnosticsEnabled = isRouteCChatLivenessDiagnosticsEnabled();
  return {
    chunk: budgeted.clientEvents,
    routec_messages_checkpoint_proof: {
      checkpoint_token_format: "routec_s<N>",
      start: routeCCheckpointToken(
        chunk.length > 0 ? eventStreamSeq(chunk[0]) : store.next_stream_seq
      ),
      end: routeCCheckpointToken(store.next_stream_seq),
      current_next_batch: routeCCheckpointToken(store.next_stream_seq),
      current_next_batch_seq: store.next_stream_seq,
      limit: normalizedLimit,
      returned_event_count: chunk.length,
      total_bound_room_event_count: events.length,
      matrix_room_id_hash: sha256(binding.matrix_room_id),
      host_session_id: binding.host_session_id,
      committed_transcript_truth: "matrix_room_timeline",
      durable_matrix_source: "host_owned_routec_matrix_json_timeline",
      host_owned_matrix_json_timeline_read: true,
      storage_adapter_call_graph_used: true,
      storage_adapter_call_graph_role: "host_owned_matrix_json_timeline_read",
      preview_read_only: true,
      mutation_performed: false,
      host_db_transcript_product_truth: false,
    },
    ...(diagnosticsEnabled
      ? {
          routec_messages_transfer_budget_proof: {
            schema_version: P135_MATRIX_TRANSFER_BUDGET_SCHEMA_VERSION,
            budget_mode: budgeted.budgetLimited
              ? "post_projection_byte_budget_checkpoint_continuation"
              : "within_post_projection_byte_budget",
            budget_bytes: budgeted.budgetBytes,
            post_projection_budget: true,
            checkpoint_continuation_safe: true,
            preview_read_only: true,
            requested_limit: normalizedLimit,
            pre_budget_returned_event_count:
              budgeted.preBudgetReturnedEventCount,
            returned_event_count: budgeted.clientEvents.length,
            omitted_for_transfer_budget_event_count:
              budgeted.omittedForTransferBudgetEventCount,
            budget_limited: budgeted.budgetLimited,
            single_event_exceeds_budget: budgeted.singleEventExceedsBudget,
            projected_client_transfer_event_bytes:
              budgeted.projectedClientTransferBytes,
            largest_projected_client_event_bytes:
              budgeted.largestProjectedClientEventBytes,
            p131_projection_boundary_preserved: true,
            p132_gap_fill_semantics_preserved: true,
            p135_reentry_host_liveness_repair: true,
            rejected_p134_messages_cap_recreated: false,
            p134_rejected_cap_advanced: false,
            raw_secret_material_logged: false,
            full_tool_output_logged: false,
          },
        }
      : {}),
  };
}

function eventIdForCommit({ roomId, txnId, eventType, content }) {
  const contentHash = sha256(JSON.stringify(content || {}));
  return `$routec_${sha256(
    `${roomId}:${eventType}:${txnId}:${contentHash}`
  ).slice(0, 40)}`;
}

function resolveCommitSender({
  binding,
  senderMatrixUserId,
  senderActorKey,
  tokenRecord,
}) {
  const requestedSender = senderMatrixUserId || binding.matrix_user_id;
  if (tokenRecord && requestedSender !== tokenRecord.matrix_user_id) {
    throw invalidMatrixParam(
      "Route C Matrix facade token cannot send as a non-human actor."
    );
  }
  const actor = getRouteCMatrixActorByUserId(binding, requestedSender);
  if (!actor) {
    throw invalidMatrixParam(
      "Route C Matrix storage sender is not a bound room actor."
    );
  }
  if (senderActorKey && actor.actor_key !== senderActorKey) {
    throw invalidMatrixParam(
      "Route C Matrix storage sender actor key does not match sender user id."
    );
  }
  return actor;
}

function commitRoomEventInStore(
  store,
  {
    binding,
    roomId,
    txnId,
    eventType,
    content,
    senderMatrixUserId = null,
    senderActorKey = null,
    tokenRecord = null,
    branchCopyLineage = null,
  }
) {
  requireBinding(binding);
  if (roomId !== binding.matrix_room_id) {
    throw new Error(
      "Route C Matrix storage send room does not match bound room"
    );
  }
  if (!txnId || !eventType) {
    throw new Error("Route C Matrix storage send requires txnId and eventType");
  }
  const room = ensureRoomInStore(store, binding);
  const senderActor = resolveCommitSender({
    binding,
    senderMatrixUserId,
    senderActorKey,
    tokenRecord,
  });
  const txnKey = `${roomId}\u001f${eventType}\u001f${txnId}`;
  const existingEventId = store.txn_to_event_id[txnKey];
  if (existingEventId) {
    const existingEvent = store.events_by_id[existingEventId];
    if (!existingEvent) {
      throw new Error(
        "Route C Matrix storage txn index points to missing event"
      );
    }
    if (existingEvent.sender !== senderActor.matrix_user_id) {
      throw invalidMatrixParam(
        "Route C Matrix storage duplicate txn sender mismatch."
      );
    }
    return {
      event: existingEvent,
      duplicate_txn: true,
    };
  }
  const eventId = eventIdForCommit({ roomId, txnId, eventType, content });
  const lineage = branchCopyLineage
    ? cloneJsonObject(branchCopyLineage, "Route C branch/copy lineage")
    : null;
  const now = Date.now();
  const event = {
    type: eventType,
    room_id: roomId,
    sender: senderActor.matrix_user_id,
    content: content || {},
    event_id: eventId,
    origin_server_ts: now,
    unsigned: {
      transaction_id: txnId,
      routec_host_owned_matrix_storage: true,
      host_session_id: binding.host_session_id,
      routec_matrix_actor_key: senderActor.actor_key,
      routec_matrix_actor_kind: senderActor.actor_kind,
      routec_matrix_actor_display_name: senderActor.display_name,
      routec_matrix_actor_sender_source: senderActor.sender_source,
      committed_transcript_truth: "matrix_room_timeline",
      ...(lineage ? { routec_branch_copy_lineage: lineage } : {}),
    },
    routec_stream_seq: store.next_stream_seq,
  };
  store.next_stream_seq += 1;
  store.events_by_id[eventId] = event;
  store.txn_to_event_id[txnKey] = eventId;
  room.event_ids.push(eventId);
  recordRouteCMatrixStorageBatchCommittedEvent({ room, event, txnKey });
  recordRouteCMatrixSyncLongPollWakeCandidate({ binding, event });
  return {
    event,
    duplicate_txn: false,
  };
}

function commitRoomEvent(args) {
  return mutateStore((store) => commitRoomEventInStore(store, args));
}

function stateEventIdForCommit({ roomId, eventType, stateKey, content }) {
  const contentHash = sha256(JSON.stringify(content || {}));
  return `$routec_state_${sha256(
    `${roomId}:${eventType}:${stateKey}:${contentHash}`
  ).slice(0, 40)}`;
}

function normalizePinnedEventsContent(store, room, binding, content) {
  if (!isObject(content)) {
    throw invalidMatrixParam(
      "Route C Matrix pinned events state content must be a JSON object."
    );
  }
  const contentKeys = Object.keys(content);
  if (contentKeys.length !== 1 || contentKeys[0] !== "pinned") {
    throw invalidMatrixParam(
      "Route C Matrix pinned events state content must contain only pinned."
    );
  }
  if (!Array.isArray(content.pinned)) {
    throw invalidMatrixParam(
      "Route C Matrix pinned events content.pinned must be a string array."
    );
  }

  const seen = new Set();
  const pinned = content.pinned.map((eventId) => {
    if (
      typeof eventId !== "string" ||
      !eventId.trim() ||
      eventId.trim() !== eventId
    ) {
      throw invalidMatrixParam(
        "Route C Matrix pinned event IDs must be non-empty strings."
      );
    }
    if (seen.has(eventId)) {
      throw invalidMatrixParam(
        "Route C Matrix pinned event IDs must not contain duplicates."
      );
    }
    seen.add(eventId);
    const event = store.events_by_id[eventId];
    if (!event || !room.event_ids.includes(eventId)) {
      throw invalidMatrixParam(
        "Route C Matrix pinned event must exist in the bound room timeline."
      );
    }
    if (event.room_id !== binding.matrix_room_id) {
      throw invalidMatrixParam(
        "Route C Matrix pinned event must belong to the bound room."
      );
    }
    if (event.type !== MATRIX_ROOM_MESSAGE_EVENT_TYPE) {
      throw invalidMatrixParam(
        "Route C Matrix pinned event type is not allowed."
      );
    }
    if (
      event.unsigned?.redacted_because ||
      event.unsigned?.routec_redacted === true ||
      event.redacts
    ) {
      throw invalidMatrixParam(
        "Route C Matrix redacted events cannot be pinned."
      );
    }
    return eventId;
  });

  return { pinned };
}

function pinnedEventsStateProof({ binding, pinned, eventId }) {
  return {
    state_event_type: MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE,
    state_key: "",
    event_id: eventId,
    pinned_event_ids: pinned,
    pinned_event_count: pinned.length,
    bound_matrix_room_id: binding.matrix_room_id,
    host_session_id: binding.host_session_id,
    routec_host_owned_matrix_storage: true,
    committed_transcript_truth: "matrix_room_state",
    host_db_only_pin_truth: false,
    local_react_only_pin_truth: false,
    direct_matrix_bypass_write: false,
    unsafe_event_type_pinning: false,
  };
}

function writePinnedEventsState({ binding, roomId, content }) {
  return mutateStore((store) => {
    const room = ensureRoomInStore(store, binding);
    if (roomId !== binding.matrix_room_id) {
      throw invalidMatrixParam(
        "Route C Matrix pinned events state room does not match binding."
      );
    }
    const normalizedContent = normalizePinnedEventsContent(
      store,
      room,
      binding,
      content
    );
    const stateEvents = ensureRoomStateEventsStore(room);
    const eventId = stateEventIdForCommit({
      roomId,
      eventType: MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE,
      stateKey: "",
      content: normalizedContent,
    });
    const stateKey = matrixStateStoreKey(MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE, "");
    const previousStateEvent = stateEvents[stateKey] || null;
    const stateContentChanged =
      !previousStateEvent ||
      JSON.stringify(previousStateEvent.content || {}) !==
        JSON.stringify(normalizedContent);
    if (!stateContentChanged) {
      return {
        event_id: previousStateEvent.event_id,
        committed_transcript_truth: "matrix_room_state",
        routec_pinned_events_state_proof: pinnedEventsStateProof({
          binding,
          pinned: normalizedContent.pinned,
          eventId: previousStateEvent.event_id,
        }),
      };
    }
    const senderActor = getRouteCMatrixActorByUserId(
      binding,
      binding.matrix_user_id
    );
    if (!senderActor) {
      throw invalidMatrixParam(
        "Route C Matrix pinned events sender is not a bound room actor."
      );
    }
    const event = {
      type: MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE,
      room_id: roomId,
      sender: senderActor.matrix_user_id,
      state_key: "",
      content: normalizedContent,
      event_id: eventId,
      origin_server_ts: Date.now(),
      unsigned: {
        routec_host_owned_matrix_storage: true,
        routec_matrix_actor_key: senderActor.actor_key,
        routec_matrix_actor_kind: senderActor.actor_kind,
        routec_matrix_actor_display_name: senderActor.display_name,
        routec_matrix_actor_sender_source: senderActor.sender_source,
        host_session_id: binding.host_session_id,
        committed_transcript_truth: "matrix_room_state",
        host_db_only_pin_truth: false,
        local_react_only_pin_truth: false,
        direct_matrix_bypass_write: false,
        unsafe_event_type_pinning: false,
      },
      routec_state_seq: store.next_stream_seq,
    };
    store.next_stream_seq += 1;
    stateEvents[stateKey] = event;
    recordRouteCMatrixSyncLongPollWakeCandidate({ binding, event });
    return {
      event_id: eventId,
      committed_transcript_truth: "matrix_room_state",
      routec_pinned_events_state_proof: pinnedEventsStateProof({
        binding,
        pinned: normalizedContent.pinned,
        eventId,
      }),
    };
  });
}

function readPinnedEventsState({ binding, roomId }) {
  const store = readStore();
  const room = readRoomInStore(store, binding);
  if (roomId !== binding.matrix_room_id) {
    return {
      status: 403,
      body: matrixJsonError(
        "M_FORBIDDEN",
        "Route C Matrix pinned events state room does not match binding."
      ),
    };
  }
  const stateEvents = ensureRoomStateEventsStore(room);
  const event =
    stateEvents[matrixStateStoreKey(MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE, "")];
  if (!event) {
    return {
      status: 404,
      body: matrixJsonError(
        "M_NOT_FOUND",
        "Route C Matrix pinned events state not found."
      ),
    };
  }
  return {
    status: 200,
    body: cloneJsonObject(
      event.content,
      "Route C Matrix pinned events state content"
    ),
  };
}

function resolveBranchCopySourceActorKey({ sourceBinding, sourceEvent }) {
  const unsignedActorKey = normalizeNonEmptyString(
    sourceEvent?.unsigned?.routec_matrix_actor_key
  );
  if (unsignedActorKey) return unsignedActorKey;
  const sourceActor = getRouteCMatrixActorByUserId(
    sourceBinding,
    sourceEvent?.sender
  );
  if (!sourceActor) {
    throw new Error(
      `Route C branch/copy source Matrix sender is not a bound actor: ${
        sourceEvent?.sender || "missing"
      }`
    );
  }
  return sourceActor.actor_key;
}

function resolveBranchCopyTargetActor({ targetBinding, sourceActorKey }) {
  const targetActor = getRouteCMatrixActorByKey(targetBinding, sourceActorKey);
  if (!targetActor) {
    throw new Error(
      `Route C branch/copy target Matrix room is missing actor key: ${sourceActorKey}`
    );
  }
  return targetActor;
}

function buildBranchCopyLineage({
  sourceBinding,
  targetBinding,
  sourceEvent,
  sourceIndex,
}) {
  return {
    branch_copy_contract: "routec.p4_1.matrix_timeline_replay.v1",
    parent_session_id: sourceBinding.host_session_id,
    child_session_id: targetBinding.host_session_id,
    source_host_session_id: sourceBinding.host_session_id,
    target_host_session_id: targetBinding.host_session_id,
    source_matrix_room_id: sourceBinding.matrix_room_id,
    target_matrix_room_id: targetBinding.matrix_room_id,
    source_event_id: sourceEvent.event_id,
    source_event_type: sourceEvent.type,
    source_event_index: sourceIndex,
    source_origin_server_ts: sourceEvent.origin_server_ts ?? null,
    source_routec_stream_seq: sourceEvent.routec_stream_seq ?? null,
    committed_transcript_truth: "matrix_room_timeline",
    db_transcript_copy_product_truth: false,
    product_local_transcript_replay_shortcut_used: false,
    direct_matrix_harness_write_used: false,
  };
}

function rewriteBranchCopyContent({
  content,
  sourceBinding,
  targetBinding,
  targetActor,
  lineage,
}) {
  const cloned = cloneJsonObject(
    content,
    "Route C branch/copy Matrix event content"
  );
  const semantic = cloned[OYSTERUN_SEMANTIC_NAMESPACE];
  if (isObject(semantic)) {
    semantic.branch_copy_lineage = cloneJsonObject(
      lineage,
      "Route C branch/copy semantic lineage"
    );
    semantic.branch_copy_source_semantic_id = semantic.semantic_id || null;
    semantic.branch_copy_source_host_session_id = sourceBinding.host_session_id;
    semantic.branch_copy_source_matrix_room_id = sourceBinding.matrix_room_id;
    semantic.branch_copy_source_event_id = lineage.source_event_id;
    semantic.host_session_id = targetBinding.host_session_id;
    semantic.matrix_room_id = targetBinding.matrix_room_id;
    if (
      !normalizeNonEmptyString(semantic.target_session_id) ||
      semantic.target_session_id === sourceBinding.host_session_id
    ) {
      semantic.target_session_id = targetBinding.host_session_id;
    }
    semantic.matrix_event_sender = targetActor.matrix_user_id;
    semantic.matrix_event_sender_actor_key = targetActor.actor_key;
    semantic.matrix_event_sender_actor_kind = targetActor.actor_kind;
    semantic.matrix_event_sender_display_name = targetActor.display_name;
    semantic.matrix_event_sender_source = targetActor.sender_source;
    semantic.committed_transcript_truth = "matrix_room_timeline";
  }
  cloned[OYSTERUN_BRANCH_COPY_NAMESPACE] = cloneJsonObject(
    lineage,
    "Route C branch/copy content lineage"
  );
  return cloned;
}

export function copyRouteCMatrixRoomTimeline({
  sourceBinding,
  targetBinding,
  parentSessionId,
  childSessionId,
}) {
  requireBinding(sourceBinding);
  requireBinding(targetBinding);
  if (sourceBinding.host_session_id !== parentSessionId) {
    throw new Error(
      "Route C branch/copy source binding does not match parent_session_id"
    );
  }
  if (targetBinding.host_session_id !== childSessionId) {
    throw new Error(
      "Route C branch/copy target binding does not match child session id"
    );
  }
  if (sourceBinding.matrix_room_id === targetBinding.matrix_room_id) {
    throw new Error("Route C branch/copy requires a new Matrix room id");
  }
  return mutateStore((store) => {
    const sourceRoom = requireBranchCopySourceRoom(store, sourceBinding);
    const sourceEventIdsBefore = [...sourceRoom.event_ids];
    const sourceEvents = boundRoomEventsInStreamOrder(store, sourceBinding);
    const targetRoom = ensureRoomInStore(store, targetBinding);
    const copiedEvents = [];
    sourceEvents.forEach((sourceEvent, index) => {
      if (!sourceEvent?.event_id || !sourceEvent?.type) {
        throw new Error(
          "Route C branch/copy source Matrix event requires event_id and type"
        );
      }
      const sourceActorKey = resolveBranchCopySourceActorKey({
        sourceBinding,
        sourceEvent,
      });
      const targetActor = resolveBranchCopyTargetActor({
        targetBinding,
        sourceActorKey,
      });
      const lineage = buildBranchCopyLineage({
        sourceBinding,
        targetBinding,
        sourceEvent,
        sourceIndex: index,
      });
      const content = rewriteBranchCopyContent({
        content: sourceEvent.content,
        sourceBinding,
        targetBinding,
        targetActor,
        lineage,
      });
      const txnId = `routec_branch_copy_${sha256(
        JSON.stringify({
          parent_session_id: parentSessionId,
          child_session_id: childSessionId,
          source_event_id: sourceEvent.event_id,
          source_index: index,
        })
      ).slice(0, 32)}`;
      const committed = commitRoomEventInStore(store, {
        binding: targetBinding,
        roomId: targetBinding.matrix_room_id,
        txnId,
        eventType: sourceEvent.type,
        content,
        senderMatrixUserId: targetActor.matrix_user_id,
        senderActorKey: targetActor.actor_key,
        branchCopyLineage: lineage,
      });
      copiedEvents.push({
        source_event_id: sourceEvent.event_id,
        target_event_id: committed.event.event_id,
        source_event_type: sourceEvent.type,
        source_event_index: index,
        source_actor_key: sourceActorKey,
        target_actor_key: targetActor.actor_key,
        duplicate_txn: committed.duplicate_txn,
      });
    });
    const sourceRoomUnchanged =
      sourceRoom.event_ids.length === sourceEventIdsBefore.length &&
      sourceRoom.event_ids.every(
        (eventId, index) => eventId === sourceEventIdsBefore[index]
      );
    return {
      status: "routec_branch_copy_matrix_timeline_replayed",
      parent_session_id: parentSessionId,
      child_session_id: childSessionId,
      source_matrix_room_id: sourceBinding.matrix_room_id,
      target_matrix_room_id: targetBinding.matrix_room_id,
      source_event_count: sourceEvents.length,
      copied_event_count: copiedEvents.length,
      child_room_event_count: targetRoom.event_ids.length,
      source_room_unchanged: sourceRoomUnchanged,
      copied_events: copiedEvents,
      committed_transcript_truth: "matrix_room_timeline",
      db_transcript_copy_product_truth: false,
      product_local_transcript_replay_shortcut_used: false,
      direct_matrix_harness_write_used: false,
      routec_host_owned_matrix_storage: true,
    };
  });
}

function eventForClient(event) {
  const {
    routec_stream_seq: _routecStreamSeq,
    routec_state_seq: _routecStateSeq,
    ...clientEvent
  } = event;
  return projectToolEventForClientTransfer({
    event: clientEvent,
    storageKind: "matrix_legacy_inline",
  }).event;
}

function eventForClientMatrixRead(event) {
  const clientEvent = eventForClient(event);
  clientEvent.unsigned = {
    ...(clientEvent.unsigned || {}),
    routec_stream_seq: eventStreamSeq(event),
    routec_host_owned_matrix_storage: true,
    host_owned_matrix_json_timeline_read: true,
  };
  return clientEvent;
}

function summarizeClientTransferBytes(clientEvents) {
  const eventByteCounts = clientEvents
    .map((event) => safeJsonByteLength(event))
    .filter((count) => Number.isSafeInteger(count));
  return {
    projected_client_transfer_event_bytes: eventByteCounts.reduce(
      (total, count) => total + count,
      0
    ),
    largest_projected_client_event_bytes:
      eventByteCounts.length > 0 ? Math.max(...eventByteCounts) : 0,
  };
}

function selectNewestClientEventsWithinTransferBudget({
  rawEvents,
  clientEvents,
  budgetBytes = P135_MATRIX_CLIENT_TRANSFER_BUDGET_BYTES,
}) {
  const selectedRaw = [];
  const selectedClient = [];
  const selectedByteCounts = [];
  let projectedClientTransferBytes = 0;
  let budgetLimited = false;
  for (let index = clientEvents.length - 1; index >= 0; index -= 1) {
    const clientEvent = clientEvents[index];
    const byteCount = safeJsonByteLength(clientEvent) ?? 0;
    const wouldExceed =
      selectedClient.length > 0 &&
      projectedClientTransferBytes + byteCount > budgetBytes;
    if (wouldExceed) {
      budgetLimited = true;
      break;
    }
    selectedRaw.unshift(rawEvents[index]);
    selectedClient.unshift(clientEvent);
    selectedByteCounts.unshift(byteCount);
    projectedClientTransferBytes += byteCount;
  }
  const singleEventExceedsBudget =
    selectedByteCounts.length === 1 && selectedByteCounts[0] > budgetBytes;
  return {
    rawEvents: selectedRaw,
    clientEvents: selectedClient,
    budgetBytes,
    budgetLimited,
    singleEventExceedsBudget,
    projectedClientTransferBytes,
    largestProjectedClientEventBytes:
      selectedByteCounts.length > 0 ? Math.max(...selectedByteCounts) : 0,
    omittedForTransferBudgetEventCount:
      rawEvents.length - selectedRaw.length,
    preBudgetReturnedEventCount: rawEvents.length,
  };
}

export function readRouteCMatrixToolEventDetail({
  binding,
  eventId,
  page = 1,
}) {
  requireBinding(binding);
  const normalizedEventId =
    typeof eventId === "string" && eventId.trim() ? eventId.trim() : null;
  if (!normalizedEventId) {
    return {
      status: "missing_identity",
      items: [],
      page,
      raw_path_exposed: false,
    };
  }
  const store = readStore();
  const event = store.events_by_id[normalizedEventId];
  if (!event || event.room_id !== binding.matrix_room_id) {
    return {
      status: "unavailable",
      session_id: binding.host_session_id,
      matrix_room_id: binding.matrix_room_id,
      matrix_event_id: normalizedEventId,
      items: [],
      page,
      raw_path_exposed: false,
    };
  }
  const detail = buildToolEventDetailRecordFromMatrixEvent({
    event,
    storageKind: "matrix_legacy_inline",
  });
  if (!detail) {
    return {
      status: "unavailable",
      session_id: binding.host_session_id,
      matrix_room_id: binding.matrix_room_id,
      matrix_event_id: normalizedEventId,
      items: [],
      page,
      raw_path_exposed: false,
    };
  }
  return {
    status: "ok",
    schema_version: detail.schema_version,
    session_id: binding.host_session_id,
    matrix_room_id: binding.matrix_room_id,
    matrix_event_id: normalizedEventId,
    semantic_type: detail.semantic_type,
    tool_name: detail.tool_name,
    tool_call_id: detail.tool_call_id,
    tool_is_error: detail.tool_is_error,
    provider_turn_id: detail.provider_turn_id,
    target_turn_id: detail.target_turn_id,
    source_user_event_id: detail.source_user_event_id,
    detail_storage_kind: "matrix_legacy_inline",
    original_byte_count: detail.fields.reduce(
      (total, field) => total + Number(field.byte_count || 0),
      0
    ),
    original_line_count: detail.fields.reduce(
      (total, field) => total + Number(field.line_count || 0),
      0
    ),
    page: Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1,
    page_count: 1,
    selected_detail_top_only: true,
    selected_detail_limit_bytes: ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES,
    selected_detail_truncated: detail.fields.some(
      (field) =>
        Number(field.byte_count || 0) >
        ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES
    ),
    truncated_field_count: detail.fields.filter(
      (field) =>
        Number(field.byte_count || 0) >
        ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES
    ).length,
    items: detail.fields.map((field) => {
      const selected = routeCTopToolDetailText(field.value);
      return {
        field: field.field,
        source: field.source,
        semantic_type: detail.semantic_type,
        tool_name: detail.tool_name,
        tool_call_id: detail.tool_call_id,
        tool_is_error: detail.tool_is_error,
        byte_count: Buffer.byteLength(selected.text, "utf8"),
        line_count: selected.text ? selected.text.split(/\r?\n/).length : 0,
        original_byte_count: field.byte_count,
        original_line_count: field.line_count,
        selected_detail_top_only: true,
        selected_detail_limit_bytes:
          ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES,
        selected_detail_truncated: selected.truncated,
        selected_detail_truncation_reason: selected.truncated
          ? "selected_detail_exceeds_1_mib_top_limit"
          : null,
        chunk_index: 1,
        chunk_count: 1,
        content: selected.truncated ? selected.text : field.value,
      };
    }),
    raw_path_exposed: false,
  };
}

function normalizeRouteCSearchCategory(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) return null;
  if (ROUTEC_BODY_KEYWORD_SEARCH_CATEGORY_SET.has(normalized))
    return normalized;
  return (
    ROUTEC_BODY_KEYWORD_SEARCH_CATEGORY_COMPATIBILITY.get(normalized) || null
  );
}

function routeCSearchCategoryForEvent(event, binding) {
  const content = isObject(event?.content) ? event.content : {};
  const semantic = isObject(content[OYSTERUN_SEMANTIC_NAMESPACE])
    ? content[OYSTERUN_SEMANTIC_NAMESPACE]
    : {};
  const candidates = [
    semantic.semantic_category,
    semantic.semantic_type,
    content.semantic_category,
    content.semantic_type,
    content.category,
    content.type,
    event?.type,
  ];
  for (const candidate of candidates) {
    const category = normalizeRouteCSearchCategory(candidate);
    if (category) return category;
  }
  if (
    event?.type === "m.room.message" &&
    event?.sender === binding.matrix_user_id &&
    content.msgtype === "m.text" &&
    typeof content.body === "string"
  ) {
    return "message.user";
  }
  return null;
}

function addSearchableBody(values, value) {
  if (typeof value === "string" && value.trim()) {
    values.push(value);
  }
}

function routeCSearchableBodiesForEvent(event) {
  const content = isObject(event?.content) ? event.content : {};
  const semantic = isObject(content[OYSTERUN_SEMANTIC_NAMESPACE])
    ? content[OYSTERUN_SEMANTIC_NAMESPACE]
    : {};
  const bodies = [];
  addSearchableBody(bodies, content.body);
  addSearchableBody(bodies, semantic.body);
  addSearchableBody(bodies, semantic.text);
  addSearchableBody(bodies, semantic.summary);
  return [...new Set(bodies)];
}

function extractRoomEventsSearchRequest({ body, requestedNextBatchToken }) {
  if (!isObject(body)) {
    throw invalidMatrixParam(
      "Route C Matrix storage search body must be a JSON object."
    );
  }
  if (!isObject(body.search_categories)) {
    throw invalidMatrixParam(
      "Route C Matrix storage search_categories object is required."
    );
  }
  if (!isObject(body.search_categories.room_events)) {
    throw invalidMatrixParam(
      "Route C Matrix storage room_events search category is required."
    );
  }
  const roomEvents = body.search_categories.room_events;
  const searchTerm = normalizeNonEmptyString(roomEvents.search_term);
  if (!searchTerm) {
    throw invalidMatrixParam(
      "Route C Matrix storage room_events search_term is required."
    );
  }
  if (
    roomEvents.filter !== null &&
    roomEvents.filter !== undefined &&
    !isObject(roomEvents.filter)
  ) {
    throw invalidMatrixParam(
      "Route C Matrix storage room_events filter must be an object when supplied."
    );
  }
  const filter = isObject(roomEvents.filter) ? roomEvents.filter : {};
  const roomFilter = normalizeStringArrayOrNull(filter.rooms, "filter.rooms");
  const senderFilter = normalizeStringArrayOrNull(
    filter.senders,
    "filter.senders"
  );
  const bodyNextBatchToken =
    normalizeNonEmptyString(roomEvents.next_batch) || null;
  const effectiveNextBatchToken = requestedNextBatchToken ?? bodyNextBatchToken;
  const nextBatchSeq = parseOptionalRouteCCheckpointToken(
    effectiveNextBatchToken,
    "next_batch"
  );
  return {
    searchTerm,
    limit: normalizeTimelineLimit(filter.limit, DEFAULT_SEARCH_LIMIT),
    orderBy: normalizeNonEmptyString(roomEvents.order_by) || "recent",
    requestedNextBatchToken: effectiveNextBatchToken,
    nextBatchSeq,
    roomFilter,
    senderFilter,
  };
}

function searchEventMatches({
  event,
  binding,
  searchTermLower,
  roomFilterSet,
  senderFilterSet,
}) {
  if (roomFilterSet && !roomFilterSet.has(event.room_id)) return null;
  if (senderFilterSet && !senderFilterSet.has(event.sender)) return null;
  const category = routeCSearchCategoryForEvent(event, binding);
  if (!category) return null;
  const bodies = routeCSearchableBodiesForEvent(event);
  const matched = bodies.some((body) =>
    body.toLowerCase().includes(searchTermLower)
  );
  if (!matched) return null;
  return { event, category };
}

function buildSearchResult(match) {
  const seq = eventStreamSeq(match.event);
  return {
    rank: 1,
    result: eventForClient(match.event),
    context: {
      start: routeCCheckpointToken(seq),
      end: routeCCheckpointToken(seq + 1),
      events_before: [],
      events_after: [],
      profile_info: {},
    },
  };
}

function searchRoomEvents({ binding, body, requestedNextBatchToken }) {
  const store = readStore();
  const request = extractRoomEventsSearchRequest({
    body,
    requestedNextBatchToken,
  });
  assertCheckpointWithinStore(request.nextBatchSeq, store, "next_batch");
  const events = boundRoomEventsInStreamOrder(store, binding);
  const roomFilterSet = request.roomFilter ? new Set(request.roomFilter) : null;
  const senderFilterSet = request.senderFilter
    ? new Set(request.senderFilter)
    : null;
  const matches = events
    .slice()
    .reverse()
    .filter(
      (event) =>
        request.nextBatchSeq === null ||
        eventStreamSeq(event) < request.nextBatchSeq
    )
    .map((event) =>
      searchEventMatches({
        event,
        binding,
        searchTermLower: request.searchTerm.toLowerCase(),
        roomFilterSet,
        senderFilterSet,
      })
    )
    .filter(Boolean);
  const selected = matches.slice(0, request.limit);
  const nextBatch =
    matches.length > selected.length
      ? routeCCheckpointToken(eventStreamSeq(selected[selected.length - 1].event))
      : null;
  const matchedCategories = [
    ...new Set(matches.map((match) => match.category)),
  ].sort();
  const proof = {
    checkpoint_token_format: "routec_s<N>",
    requested_next_batch: request.requestedNextBatchToken,
    next_batch: nextBatch,
    order_by: request.orderBy,
    limit: request.limit,
    returned_event_count: selected.length,
    total_match_count: matches.length,
    total_bound_room_event_count: events.length,
    bound_matrix_room_id: binding.matrix_room_id,
    requested_room_filter: request.roomFilter,
    requested_room_filter_includes_bound_room: request.roomFilter
      ? request.roomFilter.includes(binding.matrix_room_id)
      : null,
    requested_sender_filter: request.senderFilter,
    searched_body_fields: [
      "content.body",
      "org.oysterun.semantic.v1.body",
      "org.oysterun.semantic.v1.text",
      "org.oysterun.semantic.v1.summary",
    ],
    searched_categories: ROUTEC_BODY_KEYWORD_SEARCH_CATEGORIES,
    matched_categories: matchedCategories,
    deterministic_event_ids_preserved: true,
    host_session_room_binding_preserved: true,
    product_local_transcript_replay_shortcut_used: false,
    foundation_pass_claimed: false,
  };
  return {
    search_categories: {
      room_events: {
        count: matches.length,
        highlights: [request.searchTerm],
        results: selected.map(buildSearchResult),
        state: {},
        groups: {},
        next_batch: nextBatch,
        routec_body_keyword_search_proof: proof,
      },
    },
    routec_body_keyword_search_proof: proof,
    routec_host_owned_matrix_storage: true,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function boundRoomEvents(store, binding) {
  const room = readRoomInStore(store, binding);
  return room.event_ids.map((eventId) => {
    const event = store.events_by_id[eventId];
    if (!event) {
      throw new Error(
        `Route C Matrix storage room index references missing event: ${eventId}`
      );
    }
    return event;
  });
}

function boundRoomEventsInStreamOrder(store, binding) {
  const events = boundRoomEvents(store, binding);
  let previousSeq = 0;
  for (const event of events) {
    const seq = eventStreamSeq(event);
    if (seq <= previousSeq) {
      throw new Error(
        "Route C Matrix storage room events are not in strictly increasing stream order"
      );
    }
    previousSeq = seq;
  }
  return events;
}

function emptyMessagesEndSeq({ direction, startSeq, toSeq }) {
  if (toSeq === null) return startSeq;
  if (direction === "b" && toSeq < startSeq) return toSeq;
  if (direction === "f" && toSeq > startSeq) return toSeq;
  return startSeq;
}

function selectMessagesChunk({ events, startSeq, toSeq, direction, limit }) {
  if (direction === "b") {
    const candidates = events
      .filter((event) => {
        const seq = eventStreamSeq(event);
        return seq < startSeq && (toSeq === null || seq >= toSeq);
      })
      .reverse();
    const chunk = candidates.slice(0, limit);
    const endSeq =
      chunk.length > 0
        ? eventStreamSeq(chunk[chunk.length - 1])
        : emptyMessagesEndSeq({ direction, startSeq, toSeq });
    return { chunk, endSeq };
  }

  const candidates = events.filter((event) => {
    const seq = eventStreamSeq(event);
    return seq >= startSeq && (toSeq === null || seq < toSeq);
  });
  const chunk = candidates.slice(0, limit);
  const endSeq =
    chunk.length > 0
      ? eventStreamSeq(chunk[chunk.length - 1]) + 1
      : emptyMessagesEndSeq({ direction, startSeq, toSeq });
  return { chunk, endSeq };
}

function selectMessagesChunkWithTransferBudget({
  events,
  startSeq,
  toSeq,
  direction,
  limit,
  budgetBytes = P135_MATRIX_CLIENT_TRANSFER_BUDGET_BYTES,
}) {
  const candidates =
    direction === "b"
      ? events
          .filter((event) => {
            const seq = eventStreamSeq(event);
            return seq < startSeq && (toSeq === null || seq >= toSeq);
          })
          .reverse()
      : events.filter((event) => {
          const seq = eventStreamSeq(event);
          return seq >= startSeq && (toSeq === null || seq < toSeq);
        });
  const countWindow = candidates.slice(0, limit);
  const clientEvents = countWindow.map(eventForClientMatrixRead);
  const selectedRaw = [];
  const selectedClient = [];
  const selectedByteCounts = [];
  let projectedClientTransferBytes = 0;
  let budgetLimited = false;
  for (let index = 0; index < clientEvents.length; index += 1) {
    const clientEvent = clientEvents[index];
    const byteCount = safeJsonByteLength(clientEvent) ?? 0;
    const wouldExceed =
      selectedClient.length > 0 &&
      projectedClientTransferBytes + byteCount > budgetBytes;
    if (wouldExceed) {
      budgetLimited = true;
      break;
    }
    selectedRaw.push(countWindow[index]);
    selectedClient.push(clientEvent);
    selectedByteCounts.push(byteCount);
    projectedClientTransferBytes += byteCount;
  }
  const budgeted = {
    rawEvents: selectedRaw,
    clientEvents: selectedClient,
    budgetBytes,
    budgetLimited,
    singleEventExceedsBudget:
      selectedByteCounts.length === 1 && selectedByteCounts[0] > budgetBytes,
    projectedClientTransferBytes,
    largestProjectedClientEventBytes:
      selectedByteCounts.length > 0 ? Math.max(...selectedByteCounts) : 0,
    omittedForTransferBudgetEventCount: countWindow.length - selectedRaw.length,
    preBudgetReturnedEventCount: countWindow.length,
  };
  const lastSelected = budgeted.rawEvents[budgeted.rawEvents.length - 1];
  const endSeq =
    budgeted.rawEvents.length > 0
      ? direction === "b"
        ? eventStreamSeq(lastSelected)
        : eventStreamSeq(lastSelected) + 1
      : emptyMessagesEndSeq({ direction, startSeq, toSeq });
  return {
    chunk: budgeted.rawEvents,
    clientChunk: budgeted.clientEvents,
    endSeq,
    candidateEventCount: candidates.length,
    countWindowEventCount: countWindow.length,
    countLimited: candidates.length > countWindow.length,
    transferBudget: budgeted,
  };
}

function eventSeqOrNull(event) {
  if (!event) return null;
  return eventStreamSeq(event);
}

function safeJsonByteLength(value) {
  try {
    const encoded = JSON.stringify(value);
    return Buffer.byteLength(encoded || "", "utf8");
  } catch {
    return null;
  }
}

function p131ProjectionSummaryForClientEvent(event) {
  const semantic = isObject(event?.content?.[OYSTERUN_SEMANTIC_NAMESPACE])
    ? event.content[OYSTERUN_SEMANTIC_NAMESPACE]
    : null;
  const projection = isObject(semantic?.tool_transfer_projection)
    ? semantic.tool_transfer_projection
    : null;
  return projection?.projected === true ? projection : null;
}

function applyTransferBudgetToSyncTimeline({
  timeline,
  clientEvents,
  budgetBytes = P135_MATRIX_CLIENT_TRANSFER_BUDGET_BYTES,
}) {
  const budgeted = selectNewestClientEventsWithinTransferBudget({
    rawEvents: timeline.events,
    clientEvents,
    budgetBytes,
  });
  if (!budgeted.budgetLimited) {
    return {
      timeline,
      clientEvents,
      transferBudget: {
        ...budgeted,
        limited: false,
      },
    };
  }

  const oldestReturnedSeq = eventSeqOrNull(budgeted.rawEvents[0]);
  const newestReturnedSeq = eventSeqOrNull(
    budgeted.rawEvents[budgeted.rawEvents.length - 1]
  );
  const byteBudgetOmittedStartSeq = eventSeqOrNull(timeline.events[0]);
  return {
    timeline: {
      ...timeline,
      events: budgeted.rawEvents,
      limited: true,
      prevBatchSeq: oldestReturnedSeq ?? timeline.prevBatchSeq,
      budgetMode: `${timeline.budgetMode}_post_projection_byte_budget`,
      omittedEventCount:
        timeline.omittedEventCount +
        budgeted.omittedForTransferBudgetEventCount,
      omittedStartSeq: timeline.omittedStartSeq ?? byteBudgetOmittedStartSeq,
      omittedEndSeq: oldestReturnedSeq ?? timeline.omittedEndSeq,
      oldestReturnedSeq,
      newestReturnedSeq,
    },
    clientEvents: budgeted.clientEvents,
    transferBudget: {
      ...budgeted,
      limited: true,
    },
  };
}

function clientTransferBudgetProof({
  timeline,
  clientEvents,
  sinceSeq,
  timelineLimit,
  totalBoundRoomEventCount,
  nextBatchSeq,
  transferBudget,
}) {
  const transferBytes = summarizeClientTransferBytes(clientEvents);
  const projectedSummaries = clientEvents
    .map(p131ProjectionSummaryForClientEvent)
    .filter(Boolean);
  const largestProjection = projectedSummaries
    .filter((projection) => Number.isSafeInteger(projection.original_byte_count))
    .sort(
      (left, right) => right.original_byte_count - left.original_byte_count
    )[0];
  const diagnosticsEnabled = isRouteCChatLivenessDiagnosticsEnabled();
  const diagnosticsProof = diagnosticsEnabled
    ? {
        p135_transfer_budget_schema_version:
          P135_MATRIX_TRANSFER_BUDGET_SCHEMA_VERSION,
        p135_post_projection_client_transfer_budget_bytes:
          transferBudget?.budgetBytes ?? P135_MATRIX_CLIENT_TRANSFER_BUDGET_BYTES,
        p135_post_projection_client_transfer_budget_limited:
          transferBudget?.limited === true,
        p135_pre_budget_returned_event_count:
          transferBudget?.preBudgetReturnedEventCount ?? clientEvents.length,
        p135_omitted_for_transfer_budget_event_count:
          transferBudget?.omittedForTransferBudgetEventCount ?? 0,
        p135_single_event_exceeds_transfer_budget:
          transferBudget?.singleEventExceedsBudget === true,
        p135_reentry_host_liveness_repair: true,
        rejected_p134_messages_cap_recreated: false,
        p134_rejected_cap_advanced: false,
      }
    : {};
  return {
    routec_matrix_sync_budget_recovery: true,
    sync_budget_schema_version: "routec.matrix_sync_budget_recovery.v1",
    sync_budget_mode: timeline.budgetMode,
    requested_since_seq: sinceSeq,
    timeline_limit_effective: timelineLimit,
    timeline_limited: timeline.limited,
    total_bound_room_event_count: totalBoundRoomEventCount,
    total_incremental_event_count: timeline.totalIncrementalEventCount,
    returned_event_count: clientEvents.length,
    omitted_event_count: timeline.omittedEventCount,
    omitted_start_seq: timeline.omittedStartSeq,
    omitted_end_seq: timeline.omittedEndSeq,
    oldest_returned_seq: timeline.oldestReturnedSeq,
    newest_returned_seq: timeline.newestReturnedSeq,
    prev_batch_seq: timeline.prevBatchSeq,
    next_batch_seq: nextBatchSeq,
    projected_client_transfer_event_bytes:
      transferBytes.projected_client_transfer_event_bytes,
    largest_projected_client_event_bytes:
      transferBytes.largest_projected_client_event_bytes,
    p131_projected_tool_event_count: projectedSummaries.length,
    largest_stripped_tool_field:
      largestProjection?.largest_stripped_field || null,
    full_tool_output_logged: false,
    raw_secret_material_logged: false,
    ...diagnosticsProof,
    messages_gap_fill_supported: timeline.limited === true,
    messages_gap_fill_from: timeline.limited
      ? routeCCheckpointToken(timeline.prevBatchSeq)
      : null,
    messages_gap_fill_direction: timeline.limited ? "b" : null,
    p117_current_since_long_poll_preserved: true,
    p131_projection_boundary_preserved: true,
    p82_large_tool_spillover_boundary_preserved: true,
    foundation_pass_claimed: false,
  };
}

function buildTimelineForSync({ events, sinceSeq, limit }) {
  if (sinceSeq !== null) {
    const incrementalEvents = events.filter(
      (event) => eventStreamSeq(event) >= sinceSeq
    );
    if (incrementalEvents.length > limit) {
      const tail = incrementalEvents.slice(-limit);
      const oldestReturnedSeq = eventSeqOrNull(tail[0]) ?? sinceSeq;
      const newestReturnedSeq = eventSeqOrNull(tail[tail.length - 1]);
      return {
        events: tail,
        limited: true,
        prevBatchSeq: oldestReturnedSeq,
        syncMode: "bounded_stale_incremental_catchup",
        budgetMode: "stale_incremental_timeline_limit",
        totalIncrementalEventCount: incrementalEvents.length,
        omittedEventCount: incrementalEvents.length - tail.length,
        omittedStartSeq: sinceSeq,
        omittedEndSeq: oldestReturnedSeq,
        oldestReturnedSeq,
        newestReturnedSeq,
      };
    }
    const oldestReturnedSeq = eventSeqOrNull(incrementalEvents[0]);
    const newestReturnedSeq = eventSeqOrNull(
      incrementalEvents[incrementalEvents.length - 1]
    );
    return {
      events: incrementalEvents,
      limited: false,
      prevBatchSeq: sinceSeq,
      syncMode: "incremental_since_checkpoint",
      budgetMode: "incremental_within_timeline_limit",
      totalIncrementalEventCount: incrementalEvents.length,
      omittedEventCount: 0,
      omittedStartSeq: null,
      omittedEndSeq: null,
      oldestReturnedSeq,
      newestReturnedSeq,
    };
  }

  const tail = events.slice(-limit);
  const oldestReturnedSeq = eventSeqOrNull(tail[0]);
  const newestReturnedSeq = eventSeqOrNull(tail[tail.length - 1]);
  return {
    events: tail,
    limited: events.length > tail.length,
    prevBatchSeq: oldestReturnedSeq ?? 1,
    syncMode: "bounded_initial_tail",
    budgetMode:
      events.length > tail.length
        ? "initial_timeline_limit"
        : "initial_within_timeline_limit",
    totalIncrementalEventCount: null,
    omittedEventCount: Math.max(0, events.length - tail.length),
    omittedStartSeq: events.length > tail.length ? 1 : null,
    omittedEndSeq:
      events.length > tail.length && oldestReturnedSeq !== null
        ? oldestReturnedSeq
        : null,
    oldestReturnedSeq,
    newestReturnedSeq,
  };
}

function buildSyncBody({
  binding,
  sinceSeq,
  requestedSinceToken,
  timelineLimit,
}) {
  const store = readStore();
  const room = readRoomInStore(store, binding);
  assertCheckpointWithinStore(sinceSeq, store, "since");
  const events = boundRoomEventsInStreamOrder(store, binding);
  const initialTimeline = buildTimelineForSync({
    events,
    sinceSeq,
    limit: timelineLimit,
  });
  const initialClientTimelineEvents = initialTimeline.events.map(eventForClient);
  const {
    timeline,
    clientEvents: clientTimelineEvents,
    transferBudget,
  } = applyTransferBudgetToSyncTimeline({
    timeline: initialTimeline,
    clientEvents: initialClientTimelineEvents,
  });
  const memberships = roomMembershipEvents(binding, room);
  const stateEvents = roomStateEvents(binding, room);
  const nextBatch = routeCCheckpointToken(store.next_stream_seq);
  const prevBatch = routeCCheckpointToken(timeline.prevBatchSeq);
  routeCMatrixSyncLastServedNextSeqByKey.set(
    routeCMatrixSyncWaiterKey(binding),
    store.next_stream_seq
  );
  const syncBudgetProof = clientTransferBudgetProof({
    timeline,
    clientEvents: clientTimelineEvents,
    sinceSeq,
    timelineLimit,
    totalBoundRoomEventCount: events.length,
    nextBatchSeq: store.next_stream_seq,
    transferBudget,
  });
  return {
    next_batch: nextBatch,
    rooms: {
      join: {
        [binding.matrix_room_id]: {
          timeline: {
            events: clientTimelineEvents,
            limited: timeline.limited,
            prev_batch: prevBatch,
          },
          state: {
            events: stateEvents,
          },
          ephemeral: {
            events: [],
          },
          account_data: {
            events: [],
          },
          unread_notifications: {
            notification_count: 0,
            highlight_count: 0,
          },
          summary: {
            "m.joined_member_count": memberships.length,
            "m.invited_member_count": 0,
          },
        },
      },
      invite: {},
      leave: {},
      knock: {},
    },
    presence: {
      events: [],
    },
    account_data: {
      events: [],
    },
    to_device: {
      events: [],
    },
    device_lists: {
      changed: [],
      left: [],
    },
    device_one_time_keys_count: {},
    routec_host_owned_matrix_storage: true,
    routec_sync_checkpoint_proof: {
      checkpoint_token_format: "routec_s<N>",
      requested_since: requestedSinceToken,
      since_seq: sinceSeq,
      next_batch: nextBatch,
      next_batch_seq: store.next_stream_seq,
      prev_batch: prevBatch,
      prev_batch_seq: timeline.prevBatchSeq,
      sync_mode: timeline.syncMode,
      timeline_limit: timelineLimit,
      returned_event_count: timeline.events.length,
      total_bound_room_event_count: events.length,
      sync_budget_mode: timeline.budgetMode,
      total_incremental_event_count: timeline.totalIncrementalEventCount,
      omitted_event_count: timeline.omittedEventCount,
      oldest_returned_seq: timeline.oldestReturnedSeq,
      newest_returned_seq: timeline.newestReturnedSeq,
      messages_gap_fill_supported: timeline.limited === true,
      bound_matrix_room_id: binding.matrix_room_id,
      routec_matrix_actor_registry_version:
        getRouteCMatrixActorRegistry(binding).registry_version,
      routec_matrix_actor_count: memberships.length,
      deterministic_event_ids_preserved: true,
      host_session_room_binding_preserved: true,
      product_local_transcript_replay_shortcut_used: false,
      foundation_pass_claimed: false,
    },
    routec_sync_budget_proof: syncBudgetProof,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function readEvent({ binding, eventId }) {
  const store = readStore();
  const event = store.events_by_id[eventId];
  if (!event || event.room_id !== binding.matrix_room_id) {
    return null;
  }
  return eventForClient(event);
}

export function readRouteCMatrixRoomMessages({
  binding,
  limit,
  direction,
  fromSeq,
  requestedFromToken,
  toSeq,
  requestedToToken,
  requestAborted = false,
}) {
  const store = readStore();
  requireBranchCopySourceRoom(store, binding);
  assertCheckpointWithinStore(fromSeq, store, "from");
  assertCheckpointWithinStore(toSeq, store, "to");
  const normalizedLimit = normalizeTimelineLimit(limit, DEFAULT_MESSAGES_LIMIT);
  const events = boundRoomEventsInStreamOrder(store, binding);
  const startSeq = fromSeq ?? (direction === "f" ? 1 : store.next_stream_seq);
  const selected = selectMessagesChunkWithTransferBudget({
    events,
    startSeq,
    toSeq,
    direction,
    limit: normalizedLimit,
  });
  const latestBoundRoomStreamSeq = events.reduce(
    (latest, event) => Math.max(latest, eventStreamSeq(event)),
    0
  );
  const earliestBoundRoomStreamSeq =
    events.length > 0 ? eventStreamSeq(events[0]) : 0;
  const start = routeCCheckpointToken(startSeq);
  const end = routeCCheckpointToken(selected.endSeq);
  const diagnosticsEnabled = isRouteCChatLivenessDiagnosticsEnabled();
  return {
    start,
    end,
    chunk: selected.clientChunk,
    state: [],
    routec_messages_checkpoint_proof: {
      checkpoint_token_format: "routec_s<N>",
      requested_from: requestedFromToken,
      requested_to: requestedToToken,
      requested_dir: direction,
      start,
      end,
      start_seq: startSeq,
      end_seq: selected.endSeq,
      current_next_batch: routeCCheckpointToken(store.next_stream_seq),
      current_next_batch_seq: store.next_stream_seq,
      limit: normalizedLimit,
      returned_event_count: selected.chunk.length,
      total_bound_room_event_count: events.length,
      earliest_bound_room_stream_seq: earliestBoundRoomStreamSeq,
      latest_bound_room_stream_seq: latestBoundRoomStreamSeq,
      bound_matrix_room_id: binding.matrix_room_id,
      deterministic_event_ids_preserved: true,
      host_session_room_binding_preserved: true,
      host_owned_matrix_json_timeline_read: true,
      host_db_transcript_product_truth: false,
      product_local_transcript_replay_shortcut_used: false,
      foundation_pass_claimed: false,
    },
    ...(diagnosticsEnabled
      ? {
          routec_messages_transfer_budget_proof: {
            schema_version: P135_MATRIX_TRANSFER_BUDGET_SCHEMA_VERSION,
            budget_mode: selected.transferBudget.budgetLimited
              ? "post_projection_byte_budget_checkpoint_continuation"
              : "within_post_projection_byte_budget",
            budget_bytes: selected.transferBudget.budgetBytes,
            post_projection_budget: true,
            checkpoint_continuation_safe: true,
            requested_limit: normalizedLimit,
            candidate_event_count: selected.candidateEventCount,
            count_window_event_count: selected.countWindowEventCount,
            count_limited: selected.countLimited,
            pre_budget_returned_event_count:
              selected.transferBudget.preBudgetReturnedEventCount,
            returned_event_count: selected.clientChunk.length,
            omitted_for_transfer_budget_event_count:
              selected.transferBudget.omittedForTransferBudgetEventCount,
            remaining_candidate_event_count:
              selected.candidateEventCount - selected.clientChunk.length,
            budget_limited: selected.transferBudget.budgetLimited,
            single_event_exceeds_budget:
              selected.transferBudget.singleEventExceedsBudget,
            projected_client_transfer_event_bytes:
              selected.transferBudget.projectedClientTransferBytes,
            largest_projected_client_event_bytes:
              selected.transferBudget.largestProjectedClientEventBytes,
            request_aborted_before_read: requestAborted === true,
            abort_aware_request_flag_recorded: true,
            p131_projection_boundary_preserved: true,
            p132_gap_fill_semantics_preserved: true,
            p135_reentry_host_liveness_repair: true,
            rejected_p134_messages_cap_recreated: false,
            p134_rejected_cap_advanced: false,
            raw_secret_material_logged: false,
            full_tool_output_logged: false,
          },
        }
      : {}),
    routec_host_owned_matrix_storage: true,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function readRouteCMatrixRoomContext({ binding, eventId, limit }) {
  const store = readStore();
  requireBranchCopySourceRoom(store, binding);
  const normalizedLimit = normalizeContextLimit(limit);
  const events = boundRoomEventsInStreamOrder(store, binding);
  const targetIndex = events.findIndex((event) => event.event_id === eventId);
  if (targetIndex === -1) return null;

  const beforeLimit = Math.floor(normalizedLimit / 2);
  const afterLimit = normalizedLimit - beforeLimit;
  const targetEvent = events[targetIndex];
  const beforeRaw = events
    .slice(Math.max(0, targetIndex - beforeLimit), targetIndex)
    .reverse();
  const afterRaw = events.slice(targetIndex + 1, targetIndex + 1 + afterLimit);
  const targetSeq = eventStreamSeq(targetEvent);
  const oldestBefore = beforeRaw[beforeRaw.length - 1];
  const newestAfter = afterRaw[afterRaw.length - 1];
  const startSeq = oldestBefore ? eventStreamSeq(oldestBefore) : targetSeq;
  const endSeq = newestAfter ? eventStreamSeq(newestAfter) + 1 : targetSeq + 1;
  const start = routeCCheckpointToken(startSeq);
  const end = routeCCheckpointToken(endSeq);

  return {
    start,
    end,
    state: roomStateEvents(binding, readRoomInStore(store, binding)),
    events_before: beforeRaw.map(eventForClientMatrixRead),
    events_after: afterRaw.map(eventForClientMatrixRead),
    event: eventForClientMatrixRead(targetEvent),
    routec_context_focus_proof: {
      checkpoint_token_format: "routec_s<N>",
      matrix_client_endpoint_equivalent:
        "GET /_matrix/client/v3/rooms/:roomId/context/:eventId",
      target_event_id: eventId,
      target_event_stream_seq: targetSeq,
      start,
      end,
      start_seq: startSeq,
      end_seq: endSeq,
      limit: normalizedLimit,
      events_before_count: beforeRaw.length,
      events_after_count: afterRaw.length,
      target_included_exactly_once: true,
      before_order: "newest_to_oldest",
      after_order: "oldest_to_newest",
      total_bound_room_event_count: events.length,
      bound_matrix_room_id: binding.matrix_room_id,
      deterministic_event_ids_preserved: true,
      host_session_room_binding_preserved: true,
      host_owned_matrix_json_timeline_read: true,
      product_local_transcript_replay_shortcut_used: false,
      host_db_transcript_product_truth: false,
      local_storage_adapter_product_truth: false,
      p131_projection_boundary_preserved: true,
      p135_transfer_budget_boundary_preserved: true,
      p153_display_grouping_boundary_preserved: true,
      raw_secret_material_logged: false,
      full_tool_output_logged: false,
    },
    routec_host_owned_matrix_storage: true,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function matrixJsonError(errcode, error) {
  return { errcode, error };
}

function extractRoomSendPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/([^/]+)\/([^/]+)$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    eventType: decodeURIComponent(match[2]),
    txnId: decodeURIComponent(match[3]),
  };
}

function extractPinnedEventsStatePathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/state\/m\.room\.pinned_events\/?$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    eventType: MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE,
    stateKey: "",
  };
}

function extractEventPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/event\/([^/]+)$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    eventId: decodeURIComponent(match[2]),
  };
}

function extractContextPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/context\/([^/]+)$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    eventId: decodeURIComponent(match[2]),
  };
}

function extractMessagesPathParts(path) {
  const match = path.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/messages$/);
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
  };
}

function response(body, status = 200) {
  return {
    status,
    body: {
      ...body,
      routec_host_owned_matrix_storage: true,
      synapse_proxy_attempted: false,
      browser_direct_synapse_dependency: false,
      raw_synapse_token_exposed: false,
      foundation_pass_claimed: false,
    },
    proxy_ready: true,
    retry_after_header: null,
  };
}

export async function handleRouteCMatrixStorageRequest({
  req,
  path,
  url,
  body,
  binding,
  tokenRecord,
  senderMatrixUserId = null,
  senderActorKey = null,
}) {
  const effectiveBinding = binding || {
    host_session_id: tokenRecord?.host_session_id,
    host_agent_id: tokenRecord?.host_agent_id,
    matrix_room_id: tokenRecord?.matrix_room_id,
    matrix_user_id: tokenRecord?.matrix_user_id,
    routec_matrix_actor_registry: tokenRecord?.routec_matrix_actor_registry,
  };
  requireBinding(effectiveBinding);

  try {
    if (req.method === "PUT") {
      const pinnedEventsStateParts = extractPinnedEventsStatePathParts(path);
      if (pinnedEventsStateParts) {
        const written = writePinnedEventsState({
          binding: effectiveBinding,
          roomId: pinnedEventsStateParts.roomId,
          content: body,
        });
        return response(written);
      }

      const sendParts = extractRoomSendPathParts(path);
      if (sendParts) {
        const committed = commitRoomEvent({
          binding: effectiveBinding,
          roomId: sendParts.roomId,
          txnId: sendParts.txnId,
          eventType: sendParts.eventType,
          content: body,
          senderMatrixUserId,
          senderActorKey,
          tokenRecord,
        });
        return response({
          event_id: committed.event.event_id,
          duplicate_txn: committed.duplicate_txn,
          matrix_event_sender: committed.event.sender,
          routec_matrix_actor_key:
            committed.event.unsigned.routec_matrix_actor_key,
          routec_matrix_actor_kind:
            committed.event.unsigned.routec_matrix_actor_kind,
          semantic_role_is_sender: false,
          committed_transcript_truth: "matrix_room_timeline",
          storage_path_hash: sha256(getRouteCMatrixStoragePath()),
        });
      }
    }

    if (req.method === "GET" && path === "/_matrix/client/v3/sync") {
      const requestedSinceToken = optionalSearchParam(url, "since");
      const sinceSeq = parseOptionalRouteCCheckpointToken(
        requestedSinceToken,
        "since"
      );
      const timelineLimit = syncTimelineLimitFromUrl(url);
      const timeoutMs = normalizeMatrixSyncLongPollTimeout(
        optionalSearchParam(url, "timeout")
      );
      return await handleLongPollingSyncRequest({
        req,
        binding: effectiveBinding,
        sinceSeq,
        requestedSinceToken,
        timelineLimit,
        timeoutMs,
      });
    }

    if (req.method === "POST" && path === "/_matrix/client/v3/search") {
      const requestedNextBatchToken = optionalSearchParam(url, "next_batch");
      return response(
        searchRoomEvents({
          binding: effectiveBinding,
          body,
          requestedNextBatchToken,
        })
      );
    }

    if (req.method === "GET") {
      const pinnedEventsStateParts = extractPinnedEventsStatePathParts(path);
      if (pinnedEventsStateParts) {
        const read = readPinnedEventsState({
          binding: effectiveBinding,
          roomId: pinnedEventsStateParts.roomId,
        });
        return response(read.body, read.status);
      }

      const eventParts = extractEventPathParts(path);
      if (eventParts) {
        if (eventParts.roomId !== effectiveBinding.matrix_room_id) {
          return response(
            matrixJsonError(
              "M_FORBIDDEN",
              "Route C Matrix storage event room does not match binding."
            ),
            403
          );
        }
        const event = readEvent({
          binding: effectiveBinding,
          eventId: eventParts.eventId,
        });
        if (!event) {
          return response(
            matrixJsonError(
              "M_NOT_FOUND",
              "Route C Matrix storage event not found."
            ),
            404
          );
        }
        return response(event);
      }
      const contextParts = extractContextPathParts(path);
      if (contextParts) {
        if (contextParts.roomId !== effectiveBinding.matrix_room_id) {
          return response(
            matrixJsonError(
              "M_FORBIDDEN",
              "Route C Matrix storage context room does not match binding."
            ),
            403
          );
        }
        const context = readRouteCMatrixRoomContext({
          binding: effectiveBinding,
          eventId: contextParts.eventId,
          limit: url?.searchParams?.get("limit"),
        });
        if (!context) {
          return response(
            matrixJsonError(
              "M_NOT_FOUND",
              "Route C Matrix storage context event not found."
            ),
            404
          );
        }
        return response(context);
      }
      const messagesParts = extractMessagesPathParts(path);
      if (messagesParts) {
        if (messagesParts.roomId !== effectiveBinding.matrix_room_id) {
          return response(
            matrixJsonError(
              "M_FORBIDDEN",
              "Route C Matrix storage messages room does not match binding."
            ),
            403
          );
        }
        const requestedFromToken = optionalSearchParam(url, "from");
        const requestedToToken = optionalSearchParam(url, "to");
        const fromSeq = parseOptionalRouteCCheckpointToken(
          requestedFromToken,
          "from"
        );
        const toSeq = parseOptionalRouteCCheckpointToken(
          requestedToToken,
          "to"
        );
        const direction = normalizedMessagesDirection(
          url?.searchParams?.get("dir")
        );
        const limit = url?.searchParams?.get("limit");
        return response(
          readRouteCMatrixRoomMessages({
            binding: effectiveBinding,
            limit,
            direction,
            fromSeq,
            requestedFromToken,
            toSeq,
            requestedToToken,
            requestAborted: req?.aborted === true,
          })
        );
      }
    }

    return response(
      matrixJsonError(
        "M_UNRECOGNIZED",
        `Unsupported Route C Host-owned Matrix storage endpoint: ${req.method} ${path}`
      ),
      501
    );
  } catch (err) {
    if (err instanceof RouteCMatrixStorageClientError) {
      return response(err.body, err.status);
    }
    throw err;
  }
}
