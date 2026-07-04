import { createHash } from "crypto";
import {
  getRouteCMatrixActorByKey,
  getRouteCMatrixActorByUserId,
  getRouteCMatrixActorRegistry,
} from "./matrix-room-binding.mjs";
import { readConfig } from "./config.mjs";
import { readRouteCMatrixRoomTimelinePreview } from "./routec-matrix-storage-adapter.mjs";
import { projectToolEventForClientTransfer } from "./tool-event-transfer-projection.mjs";

export const ROUTEC_MATRIX_READ_AUTHORITY_SOURCE =
  "host_matrix_facade_host_owned_json_timeline_read";
export const ROUTEC_MATRIX_READ_AUTHORITY_MEMORY_CACHE_SOURCE =
  "host_matrix_facade_server_side_read_authority_cache";
export const ROUTEC_MATRIX_DURABLE_SOURCE =
  "host_owned_routec_matrix_json_timeline";
export const ROUTEC_MATRIX_READ_AUTHORITY_INTERFACE =
  "host_matrix_facade_read_authority";
export const ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT =
  "GET /_matrix/client/v3/rooms/:roomId/messages";

const MATRIX_ROOM_MESSAGE_TYPE = "m.room.message";
const ROUTEC_MATRIX_READ_AUTHORITY_CHECKPOINT_PREFIX = "host_read_authority_s";

const roomsByAuthorityKey = new Map();
let nextAuthoritySeq = 1;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonObject(value, fieldName) {
  if (!isObject(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    throw new Error(
      `Route C Matrix read authority ${fieldName} must be JSON serializable: ${
        err?.message || String(err)
      }`
    );
  }
}

function isRouteCChatLivenessDiagnosticsEnabled() {
  return readConfig().debug_routec_chat_liveness_diagnostics_enabled === true;
}

function requireBinding(binding) {
  if (!binding || typeof binding !== "object") {
    throw new Error("Route C Matrix read authority requires binding object");
  }
  for (const key of [
    "host_session_id",
    "host_agent_id",
    "matrix_room_id",
    "matrix_user_id",
  ]) {
    if (typeof binding[key] !== "string" || !binding[key].trim()) {
      throw new Error(`Route C Matrix read authority binding missing ${key}`);
    }
  }
}

function authorityKeyForBinding(binding) {
  requireBinding(binding);
  return `${binding.host_session_id}\u0000${binding.matrix_room_id}`;
}

function checkpointToken(seq) {
  return `${ROUTEC_MATRIX_READ_AUTHORITY_CHECKPOINT_PREFIX}${seq}`;
}

function roomRecordForBinding(binding) {
  const key = authorityKeyForBinding(binding);
  let room = roomsByAuthorityKey.get(key);
  if (!room) {
    room = {
      host_session_id: binding.host_session_id,
      host_agent_id: binding.host_agent_id,
      matrix_room_id: binding.matrix_room_id,
      matrix_room_id_hash: sha256(binding.matrix_room_id),
      events_by_id: new Map(),
      event_ids: [],
      created_at_ms: Date.now(),
    };
    roomsByAuthorityKey.set(key, room);
  }
  return room;
}

function resolveSenderActor({ binding, senderMatrixUserId, senderActorKey }) {
  if (senderActorKey) {
    const actor = getRouteCMatrixActorByKey(binding, senderActorKey);
    if (actor) return actor;
  }
  if (senderMatrixUserId) {
    const actor = getRouteCMatrixActorByUserId(binding, senderMatrixUserId);
    if (actor) return actor;
  }
  const fallback = getRouteCMatrixActorByKey(binding, "human");
  if (fallback) return fallback;
  return {
    actor_key: "human",
    actor_kind: "human",
    matrix_user_id: binding.matrix_user_id,
    display_name: "Host Owner",
    sender_source: "host_scoped_facade_human_actor",
  };
}

function normalizeEventId(eventId) {
  if (typeof eventId !== "string" || !eventId.trim()) {
    throw new Error("Route C Matrix read authority requires Matrix event_id");
  }
  return eventId.trim();
}

function normalizeOriginServerTs(originServerTs) {
  const ts = Number(originServerTs);
  if (Number.isFinite(ts) && ts > 0) return Math.trunc(ts);
  return Date.now();
}

function eventsInStreamOrder(room) {
  return room.event_ids.map((eventId) => {
    const event = room.events_by_id.get(eventId);
    if (!event) {
      throw new Error(
        `Route C Matrix read authority event index points to missing event: ${eventId}`
      );
    }
    return event;
  });
}

function eventForClient(event) {
  return projectToolEventForClientTransfer({
    event: JSON.parse(JSON.stringify(event)),
    storageKind: "matrix_legacy_inline",
  }).event;
}

function selectMessagesChunk({ events, direction, limit }) {
  if (direction === "f") return events.slice(0, limit);
  return [...events].reverse().slice(0, limit);
}

export function clearRouteCMatrixReadAuthorityForTests() {
  roomsByAuthorityKey.clear();
  nextAuthoritySeq = 1;
}

export function recordRouteCMatrixReadAuthorityEvent({
  binding,
  eventId,
  eventType = MATRIX_ROOM_MESSAGE_TYPE,
  senderMatrixUserId = null,
  senderActorKey = null,
  content = {},
  originServerTs = Date.now(),
  txnId = null,
}) {
  requireBinding(binding);
  if (eventType !== MATRIX_ROOM_MESSAGE_TYPE) {
    return {
      recorded: false,
      reason: "non_room_message_event_type",
      event_type: eventType,
      read_authority_source: ROUTEC_MATRIX_READ_AUTHORITY_SOURCE,
      storage_adapter_call_graph_used: false,
    };
  }

  const normalizedEventId = normalizeEventId(eventId);
  const actor = resolveSenderActor({
    binding,
    senderMatrixUserId,
    senderActorKey,
  });
  const room = roomRecordForBinding(binding);
  const existing = room.events_by_id.get(normalizedEventId);
  const seq =
    existing?.unsigned?.routec_stream_seq &&
    Number.isSafeInteger(existing.unsigned.routec_stream_seq)
      ? existing.unsigned.routec_stream_seq
      : nextAuthoritySeq++;
  const event = {
    type: eventType,
    room_id: binding.matrix_room_id,
    sender: senderMatrixUserId || actor.matrix_user_id,
    content: cloneJsonObject(content, "content"),
    event_id: normalizedEventId,
    origin_server_ts: normalizeOriginServerTs(originServerTs),
    unsigned: {
      ...(txnId ? { transaction_id: txnId } : {}),
      routec_stream_seq: seq,
      routec_host_owned_matrix_read_authority: true,
      host_matrix_read_authority_source:
        ROUTEC_MATRIX_READ_AUTHORITY_MEMORY_CACHE_SOURCE,
      matrix_client_endpoint_equivalent:
        ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT,
      host_session_id: binding.host_session_id,
      routec_matrix_actor_key: actor.actor_key,
      routec_matrix_actor_kind: actor.actor_kind,
      routec_matrix_actor_display_name: actor.display_name,
      routec_matrix_actor_sender_source: actor.sender_source || "host_owned",
      committed_transcript_truth: "matrix_room_timeline",
      local_storage_adapter_product_truth: false,
      host_db_transcript_product_truth: false,
      direct_synapse_db_read: false,
    },
  };

  if (!existing) room.event_ids.push(normalizedEventId);
  room.events_by_id.set(normalizedEventId, event);
  return {
    recorded: true,
    event_id_hash: sha256(normalizedEventId),
    routec_stream_seq: seq,
    matrix_room_id_hash: room.matrix_room_id_hash,
    read_authority_source: ROUTEC_MATRIX_READ_AUTHORITY_MEMORY_CACHE_SOURCE,
    memory_authority_cache_write: true,
    memory_authority_cache_product_truth: false,
    matrix_client_endpoint_equivalent:
      ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT,
    host_session_room_binding_preserved: true,
    storage_adapter_call_graph_used: false,
    local_storage_adapter_product_truth: false,
    host_db_transcript_product_truth: false,
    direct_synapse_db_read: false,
    mutation_performed_by_preview: false,
    raw_synapse_token_exposed: false,
  };
}

export function readRouteCMatrixReadAuthorityMessages({
  binding,
  limit,
  direction = "b",
}) {
  requireBinding(binding);
  if (direction !== "b" && direction !== "f") {
    throw new Error("Route C Matrix read authority direction must be b or f");
  }
  const normalizedLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 20;
  const memoryRoom = roomsByAuthorityKey.get(authorityKeyForBinding(binding));
  const memoryEventCount = memoryRoom ? memoryRoom.event_ids.length : 0;
  const durableRead = readRouteCMatrixRoomTimelinePreview({
    binding,
    limit: normalizedLimit,
  });
  const durableChunk = Array.isArray(durableRead.chunk)
    ? durableRead.chunk
    : [];
  const chunk = selectMessagesChunk({
    events: durableChunk,
    direction,
    limit: normalizedLimit,
  });
  const durableProof = durableRead.routec_messages_checkpoint_proof || {};
  const durableTransferBudgetProof =
    durableRead.routec_messages_transfer_budget_proof || null;
  const diagnosticsEnabled = isRouteCChatLivenessDiagnosticsEnabled();
  const currentNextBatch =
    durableProof.current_next_batch || checkpointToken(nextAuthoritySeq);
  const endToken = durableProof.end || currentNextBatch;
  const startToken = durableProof.start || currentNextBatch;
  return {
    start: startToken,
    end: endToken,
    chunk: chunk.map(eventForClient),
    state: [],
    read_authority_source: ROUTEC_MATRIX_READ_AUTHORITY_SOURCE,
    durable_matrix_source: ROUTEC_MATRIX_DURABLE_SOURCE,
    facade_read_interface: ROUTEC_MATRIX_READ_AUTHORITY_INTERFACE,
    matrix_client_endpoint_equivalent:
      ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT,
    routec_messages_checkpoint_proof: {
      checkpoint_token_format:
        durableProof.checkpoint_token_format || "routec_s<N>",
      requested_dir: direction,
      start: startToken,
      end: endToken,
      current_next_batch: currentNextBatch,
      limit: normalizedLimit,
      returned_event_count: chunk.length,
      total_bound_room_event_count:
        Number(durableProof.total_bound_room_event_count) ||
        durableChunk.length,
      matrix_room_id_hash: sha256(binding.matrix_room_id),
      routec_matrix_actor_registry_version:
        getRouteCMatrixActorRegistry(binding).registry_version,
      read_authority_source: ROUTEC_MATRIX_READ_AUTHORITY_SOURCE,
      durable_matrix_source: ROUTEC_MATRIX_DURABLE_SOURCE,
      facade_read_interface: ROUTEC_MATRIX_READ_AUTHORITY_INTERFACE,
      matrix_client_endpoint_equivalent:
        ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT,
      host_session_room_binding_preserved: true,
      host_owned_matrix_read_authority: true,
      host_owned_matrix_json_timeline_read: true,
      preview_read_only: true,
      storage_adapter_call_graph_used: true,
      storage_adapter_call_graph_role: "host_owned_matrix_json_timeline_read",
      memory_authority_cache_used: false,
      memory_authority_cache_event_count: memoryEventCount,
      ...(diagnosticsEnabled
        ? {
            p135_durable_messages_transfer_budget_proof:
              durableTransferBudgetProof,
            p135_reentry_host_liveness_repair:
              durableTransferBudgetProof?.p135_reentry_host_liveness_repair ===
              true,
            rejected_p134_messages_cap_recreated:
              durableTransferBudgetProof?.rejected_p134_messages_cap_recreated ===
              true,
          }
        : {}),
      local_storage_adapter_product_truth: false,
      host_db_transcript_product_truth: false,
      direct_synapse_db_read: false,
      actual_synapse_client_server_request: false,
      browser_direct_synapse_query: false,
      second_dashboard_matrix_sdk_lifecycle: false,
      mutation_performed: false,
      raw_synapse_token_exposed: false,
    },
    host_owned_matrix_read_authority: true,
    host_owned_matrix_json_timeline_read: true,
    ...(diagnosticsEnabled
      ? { routec_messages_transfer_budget_proof: durableTransferBudgetProof }
      : {}),
    preview_read_only: true,
    storage_adapter_call_graph_used: true,
    storage_adapter_call_graph_role: "host_owned_matrix_json_timeline_read",
    memory_authority_cache_used: false,
    memory_authority_cache_event_count: memoryEventCount,
    actual_matrix_transport: ROUTEC_MATRIX_DURABLE_SOURCE,
    actual_synapse_client_server_request: false,
    synapse_proxy_attempted: false,
    local_storage_adapter_product_truth: false,
    host_db_transcript_product_truth: false,
    direct_synapse_db_read: false,
    browser_direct_synapse_query: false,
    raw_synapse_token_exposed: false,
  };
}
