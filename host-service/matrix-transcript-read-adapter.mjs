import { createHash } from "crypto";
import { getRouteCMatrixActorByUserId } from "./matrix-room-binding.mjs";
import { readRouteCMatrixRoomMessages } from "./routec-matrix-storage-adapter.mjs";
import { OYSTERUN_SEMANTIC_NAMESPACE } from "./matrix-event-writer.mjs";

const DEFAULT_MATRIX_TRANSCRIPT_LIMIT = 20;
const MAX_MATRIX_TRANSCRIPT_LIMIT = 100;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matrixTranscriptHash(kind, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

function normalizeLimit(limit) {
  const numeric = Number(limit);
  if (!Number.isInteger(numeric) || numeric < 1)
    return DEFAULT_MATRIX_TRANSCRIPT_LIMIT;
  return Math.min(numeric, MAX_MATRIX_TRANSCRIPT_LIMIT);
}

function eventStreamSeq(event, fallbackSeq) {
  const candidates = [
    event?.unsigned?.routec_stream_seq,
    event?.routec_stream_seq,
    fallbackSeq,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isSafeInteger(numeric) && numeric >= 1) return numeric;
  }
  return fallbackSeq;
}

function semanticPayload(content) {
  const semantic = content[OYSTERUN_SEMANTIC_NAMESPACE];
  return isObject(semantic) ? semantic : {};
}

function matrixContent(event) {
  return isObject(event?.content) ? event.content : {};
}

function messageRole(semanticType, actor) {
  if (semanticType === "message.user" || actor?.actor_kind === "human") {
    return "user";
  }
  if (
    semanticType === "tool.call" ||
    semanticType === "tool.output" ||
    semanticType === "tool.result" ||
    semanticType === "tool.failure" ||
    actor?.actor_kind === "tool"
  ) {
    return "tool";
  }
  if (
    semanticType === "control.request" ||
    semanticType === "control.outcome" ||
    semanticType === "control.cancel.outcome" ||
    semanticType === "runtime.error" ||
    semanticType === "session_lifecycle" ||
    semanticType === "outbox.delivery" ||
    actor?.actor_kind === "control" ||
    actor?.actor_kind === "host"
  ) {
    return "control-status";
  }
  return "assistant";
}

function messageType(semanticType) {
  if (semanticType === "runtime.error") return "runtime_error";
  if (semanticType === "session_lifecycle") return "session_lifecycle";
  if (semanticType?.startsWith("tool.")) return "tool";
  if (semanticType?.startsWith("control.")) return "control_status";
  return "message";
}

function eventCreatedAt(event) {
  const ts = Number(event?.origin_server_ts);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts).toISOString();
}

function bodyForEvent(content, semanticType) {
  const body = typeof content.body === "string" ? content.body.trim() : "";
  if (body) return body;
  const filename =
    typeof content.filename === "string" ? content.filename.trim() : "";
  if (filename) return filename;
  if (
    semanticType === "runtime.error" ||
    semanticType === "session_lifecycle" ||
    semanticType === "outbox.delivery" ||
    semanticType?.startsWith("tool.") ||
    semanticType?.startsWith("control.")
  ) {
    return semanticType;
  }
  return "";
}

function hasAttachment(content) {
  return Boolean(
    content?.url ||
      content?.file ||
      content?.info?.mimetype ||
      content?.msgtype === "m.image" ||
      content?.msgtype === "m.video" ||
      content?.msgtype === "m.file"
  );
}

function transcriptToolEvent({ semantic, semanticType, eventId }) {
  if (!semanticType?.startsWith("tool.")) return null;
  const isCall = semanticType === "tool.call";
  return {
    type: isCall ? "tool.call" : "tool.result",
    provider: semantic.provider_id || semantic.provider || null,
    call_id: semantic.tool_call_id || null,
    name: semantic.tool_name || null,
    input: isCall ? semantic.tool_input ?? null : null,
    content: isCall ? null : semantic.tool_content ?? semantic.body ?? null,
    is_error: semanticType === "tool.failure" || semantic.tool_is_error === true,
    session_id: semantic.host_session_id || null,
    matrix_room_id: semantic.matrix_room_id || null,
    matrix_event_id: eventId,
    detail_available:
      semantic.tool_detail_available === true ||
      semantic.detail_available === true,
    detail_storage_kind: semantic.tool_detail_storage_kind || null,
    tool_transfer_projection: semantic.tool_transfer_projection || null,
  };
}

function matrixEventToTranscriptMessage({ binding, event, index }) {
  const content = matrixContent(event);
  const semantic = semanticPayload(content);
  const semanticType =
    typeof semantic.semantic_type === "string" && semantic.semantic_type.trim()
      ? semantic.semantic_type.trim()
      : null;
  const actor = getRouteCMatrixActorByUserId(binding, event?.sender);
  const seq = eventStreamSeq(event, index + 1);
  const body = bodyForEvent(content, semanticType);
  const eventId = typeof event?.event_id === "string" ? event.event_id : null;
  const directToolEvents = Array.isArray(semantic.tool_events)
    ? semantic.tool_events
    : [];
  const projectedToolEvent = transcriptToolEvent({
    semantic,
    semanticType,
    eventId,
  });
  const linkAnnotations = Array.isArray(content.link_annotations)
    ? content.link_annotations
    : Array.isArray(semantic.link_annotations)
    ? semantic.link_annotations
    : [];
  return {
    id:
      semantic.message_id ||
      semantic.semantic_id ||
      matrixTranscriptHash("matrix_event_id", eventId) ||
      `matrix-transcript-${seq}`,
    seq,
    message_id: eventId,
    parent_message_id: semantic.parent_message_id || null,
    role: messageRole(semanticType, actor),
    content: body,
    text: body,
    tool_summary:
      typeof semantic.tool_summary === "string" ? semantic.tool_summary : null,
    tool_events:
      directToolEvents.length > 0
        ? directToolEvents
        : projectedToolEvent
        ? [projectedToolEvent]
        : [],
    tool_detail_available:
      semantic.tool_detail_available === true ||
      semantic.detail_available === true,
    tool_transfer_projection: semantic.tool_transfer_projection || null,
    link_annotations: linkAnnotations,
    message_type: messageType(semanticType),
    turn_id:
      typeof semantic.turn_id === "string" && semantic.turn_id.trim()
        ? semantic.turn_id.trim()
        : null,
    has_attachments: hasAttachment(content),
    attachments: [],
    media: Array.isArray(semantic.multi_media_attachments)
      ? semantic.multi_media_attachments
      : [],
    created_at: eventCreatedAt(event),
    matrix_event_id: eventId,
    matrix_event_id_hash: matrixTranscriptHash("matrix_event_id", eventId),
    matrix_room_id_hash: matrixTranscriptHash(
      "matrix_room_id",
      binding.matrix_room_id
    ),
    semantic_type: semanticType,
    committed_transcript_truth: "matrix_room_timeline",
    host_db_transcript_product_truth: false,
    product_local_transcript_replay_shortcut_used: false,
  };
}

function transcriptProof(readResult) {
  return {
    committed_transcript_truth: "matrix_room_timeline",
    host_db_transcript_product_truth: false,
    product_local_transcript_replay_shortcut_used: false,
    host_owned_matrix_read_authority: true,
    host_owned_matrix_json_timeline_read: true,
    preview_read_only: true,
    routec_messages_checkpoint_proof:
      readResult.routec_messages_checkpoint_proof || null,
  };
}

function latestSeq(readResult) {
  const proofLatestSeq = Number(
    readResult?.routec_messages_checkpoint_proof?.latest_bound_room_stream_seq
  );
  if (Number.isSafeInteger(proofLatestSeq) && proofLatestSeq >= 0) {
    return proofLatestSeq;
  }
  const chunk = Array.isArray(readResult.chunk) ? readResult.chunk : [];
  return chunk.reduce(
    (max, event, index) => Math.max(max, eventStreamSeq(event, index + 1)),
    0
  );
}

export function readMatrixTranscriptMessagesAfter({
  binding,
  afterSeq = 0,
  limit = DEFAULT_MATRIX_TRANSCRIPT_LIMIT,
}) {
  const normalizedAfterSeq = Math.max(Number(afterSeq) || 0, 0);
  const normalizedLimit = normalizeLimit(limit);
  const readResult = readRouteCMatrixRoomMessages({
    binding,
    limit: normalizedLimit,
    direction: "f",
    fromSeq: normalizedAfterSeq + 1,
    requestedFromToken: `routec_s${normalizedAfterSeq + 1}`,
    toSeq: null,
    requestedToToken: null,
  });
  const messages = (Array.isArray(readResult.chunk) ? readResult.chunk : [])
    .map((event, index) =>
      matrixEventToTranscriptMessage({ binding, event, index })
    )
    .filter((message) => message.content || message.message_type !== "message");
  const currentLatestSeq = latestSeq(readResult);
  return {
    messages,
    sync: {
      after_seq: normalizedAfterSeq,
      next_after_seq:
        messages.length > 0
          ? Math.max(...messages.map((message) => message.seq))
          : normalizedAfterSeq,
      latest_seq: currentLatestSeq,
      returned: messages.length,
      has_more:
        messages.length > 0 &&
        messages[messages.length - 1].seq < currentLatestSeq,
    },
    matrix_transcript_read: transcriptProof(readResult),
  };
}

export function readMatrixTranscriptPage({
  binding,
  limit = DEFAULT_MATRIX_TRANSCRIPT_LIMIT,
  before = null,
}) {
  const normalizedLimit = normalizeLimit(limit);
  const fromSeq = before?.seq ? Number(before.seq) : null;
  const readResult = readRouteCMatrixRoomMessages({
    binding,
    limit: normalizedLimit,
    direction: "b",
    fromSeq,
    requestedFromToken: fromSeq ? `routec_s${fromSeq}` : null,
    toSeq: null,
    requestedToToken: null,
  });
  const newestFirst = (
    Array.isArray(readResult.chunk) ? readResult.chunk : []
  )
    .map((event, index) =>
      matrixEventToTranscriptMessage({ binding, event, index })
    )
    .filter((message) => message.content || message.message_type !== "message");
  const messages = newestFirst.reverse();
  const oldestSeq =
    messages.length > 0
      ? Math.min(...messages.map((message) => message.seq))
      : null;
  const oldestMessage =
    oldestSeq === null
      ? null
      : messages.find((message) => message.seq === oldestSeq) || null;
  const proof = readResult.routec_messages_checkpoint_proof || {};
  const earliestBoundRoomStreamSeq = Number(
    proof.earliest_bound_room_stream_seq
  );
  const hasMore =
    oldestSeq !== null &&
    Number.isSafeInteger(earliestBoundRoomStreamSeq) &&
    oldestSeq > earliestBoundRoomStreamSeq;
  return {
    messages,
    page: {
      limit: normalizedLimit,
      next_before:
        hasMore && oldestMessage
          ? {
              created_at:
                oldestMessage.created_at || new Date(0).toISOString(),
              seq: oldestMessage.seq,
            }
          : null,
      has_more: hasMore,
    },
    matrix_transcript_read: transcriptProof(readResult),
  };
}

export function readMatrixTranscriptLatestCommittedSeq({ binding }) {
  const readResult = readRouteCMatrixRoomMessages({
    binding,
    limit: 1,
    direction: "b",
    fromSeq: null,
    requestedFromToken: null,
    toSeq: null,
    requestedToToken: null,
  });
  return {
    latest_committed_seq: latestSeq(readResult),
    matrix_transcript_read: transcriptProof(readResult),
  };
}
