import {
  readMatrixTranscriptLatestPreview,
  readMatrixTranscriptPreviewCheckpoint,
} from "./matrix-transcript-read-adapter.mjs";

function requireRoomId(binding) {
  const roomId =
    typeof binding?.matrix_room_id === "string"
      ? binding.matrix_room_id.trim()
      : "";
  if (!roomId) {
    throw new Error("Session preview binding requires matrix_room_id");
  }
  return roomId;
}

function readyResult(value, cacheStatus) {
  return {
    status: value.last_message_preview ? "ready" : "empty",
    last_message_preview: value.last_message_preview || null,
    latest_committed_seq: value.latest_committed_seq || 0,
    cache_status: cacheStatus,
    dedicated_preview_query: true,
    full_transcript_pagination_used: false,
    room_aggregate_query_used: false,
    global_sequence_query_used: false,
    error_code: null,
  };
}

export class SessionListPreviewService {
  constructor({
    readCheckpoint = readMatrixTranscriptPreviewCheckpoint,
    readPreview = readMatrixTranscriptLatestPreview,
  } = {}) {
    this.readCheckpoint = readCheckpoint;
    this.readPreview = readPreview;
    this.cache = new Map();
  }

  invalidateRoom(roomId) {
    const normalizedRoomId = typeof roomId === "string" ? roomId.trim() : "";
    if (!normalizedRoomId) return false;
    return this.cache.delete(normalizedRoomId);
  }

  clear() {
    this.cache.clear();
  }

  readForBinding(binding) {
    const roomId = requireRoomId(binding);
    const cached = this.cache.get(roomId) || null;
    let checkpoint;
    try {
      checkpoint = this.readCheckpoint({ binding });
    } catch {
      if (cached) {
        return {
          ...readyResult(cached, "stale_cache_after_checkpoint_failure"),
          status: "stale",
          error_code: "session_preview_checkpoint_unavailable",
        };
      }
      return {
        status: "unavailable",
        last_message_preview: null,
        latest_committed_seq: 0,
        cache_status: "miss",
        dedicated_preview_query: true,
        full_transcript_pagination_used: false,
        room_aggregate_query_used: false,
        global_sequence_query_used: false,
        error_code: "session_preview_checkpoint_unavailable",
      };
    }

    const latestCommittedSeq = Number(checkpoint?.latest_committed_seq) || 0;
    if (cached && cached.latest_committed_seq === latestCommittedSeq) {
      return readyResult(cached, "hit");
    }

    try {
      const preview = this.readPreview({ binding });
      const value = {
        last_message_preview: preview?.last_message_preview || null,
        latest_committed_seq:
          Number(preview?.latest_committed_seq) || latestCommittedSeq,
      };
      this.cache.set(roomId, value);
      return readyResult(value, cached ? "refreshed" : "miss");
    } catch {
      if (cached) {
        return {
          ...readyResult(cached, "stale_cache_after_preview_failure"),
          status: "stale",
          error_code: "session_preview_read_failed",
        };
      }
      return {
        status: "unavailable",
        last_message_preview: null,
        latest_committed_seq: latestCommittedSeq,
        cache_status: "miss",
        dedicated_preview_query: true,
        full_transcript_pagination_used: false,
        room_aggregate_query_used: false,
        global_sequence_query_used: false,
        error_code: "session_preview_read_failed",
      };
    }
  }

  readForBindings(bindings) {
    const resultByRoomId = new Map();
    for (const binding of bindings) {
      const roomId = requireRoomId(binding);
      if (!resultByRoomId.has(roomId)) {
        resultByRoomId.set(roomId, this.readForBinding(binding));
      }
    }
    return resultByRoomId;
  }
}
