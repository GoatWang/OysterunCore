import { createHash } from "crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

export const ROUTEC_LARGE_TOOL_EVENT_THRESHOLD = 10;
export const ROUTEC_LARGE_TOOL_JSONL_PAGE_SIZE = 10;
export const ROUTEC_LARGE_TOOL_EVENT_COUNT_LABEL = String(
  ROUTEC_LARGE_TOOL_EVENT_THRESHOLD
);
export const ROUTEC_LARGE_TOOL_NOTICE_BODY =
  "More than 10 tool events were generated. Additional tool events are not shown in this chat. Open this tool message to view the details.";
export const ROUTEC_LARGE_TOOL_NOTICE_KIND = "tool_event_spillover_10_plus";
export const ROUTEC_LARGE_TOOL_INDEX_SCHEMA_VERSION =
  "routec.large_tool_output.index.v1";
export const ROUTEC_LARGE_TOOL_EVENT_SCHEMA_VERSION =
  "routec.large_tool_event.v1";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function shouldResetRouteCToolRunAfterSemanticWrite({
  semanticType,
  writeResult,
} = {}) {
  return Boolean(
    normalizeString(semanticType) &&
      writeResult?.semantic_matrix_event_committed === true
  );
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function cloneJson(value, label) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error(`${label} is not JSON serializable`);
  }
  return JSON.parse(encoded);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function sanitizePathSegment(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized.replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmpPath, path);
}

function readJsonFile(path, label) {
  return JSON.parse(readFileSync(path, "utf8"), (key, value) => value);
}

function buildLargeToolRef(identity) {
  return `ltc_${sha256(
    [
      identity.source_host_session_id,
      identity.source_matrix_room_id,
      identity.provider_turn_id || "",
      identity.target_turn_id || "",
      identity.grouping_key || "",
      identity.consecutive_run_index,
    ].join("\u001f")
  ).slice(0, 24)}`;
}

function buildEventKey({ event, semanticType, toolEventIndex }) {
  const delivery = event?.routec_matrix_delivery || {};
  return sha256(
    [
      semanticType,
      normalizePositiveInteger(delivery.provider_runtime_event_index) ||
        normalizePositiveInteger(event?.provider_runtime_event_index) ||
        toolEventIndex,
      normalizeString(delivery.source_user_event_id) || "",
      normalizeString(event?.tool_call_id) ||
        normalizeString(event?.call_id) ||
        normalizeString(event?.id) ||
        "",
    ].join("\u001f")
  );
}

function toolPayloadForJsonl(event, semanticType) {
  if (semanticType === "tool.call") {
    return event?.tool_input ?? event?.input ?? null;
  }
  if (semanticType === "tool.update") {
    const input = event?.tool_input ?? event?.input ?? null;
    const content =
      event?.tool_content ??
      event?.content ??
      event?.output ??
      event?.text ??
      null;
    if (input !== null && content !== null) return { input, content };
    return input ?? content;
  }
  return (
    event?.tool_content ??
    event?.content ??
    event?.output ??
    event?.error ??
    event?.text ??
    null
  );
}

function buildJsonlRow({ event, semanticType, identity, toolEventIndex }) {
  const delivery = event?.routec_matrix_delivery || {};
  const pageIndex =
    Math.floor(
      (toolEventIndex - (ROUTEC_LARGE_TOOL_EVENT_THRESHOLD + 1)) /
        ROUTEC_LARGE_TOOL_JSONL_PAGE_SIZE
    ) + 1;
  const offsetInPage =
    (toolEventIndex - (ROUTEC_LARGE_TOOL_EVENT_THRESHOLD + 1)) %
    ROUTEC_LARGE_TOOL_JSONL_PAGE_SIZE;
  return {
    schema_version: ROUTEC_LARGE_TOOL_EVENT_SCHEMA_VERSION,
    tool_event_index: toolEventIndex,
    jsonl_page_index: pageIndex,
    page_index: pageIndex,
    offset_in_page: offsetInPage,
    semantic_type: semanticType,
    source_host_session_id: identity.source_host_session_id,
    source_matrix_room_id: identity.source_matrix_room_id,
    provider:
      normalizeString(event?.provider) ||
      normalizeString(delivery.provider_id),
    provider_turn_id:
      normalizeString(delivery.provider_turn_id) ||
      normalizeString(event?.provider_turn_id) ||
      identity.provider_turn_id,
    provider_turn_id_kind:
      normalizeString(delivery.provider_turn_id_kind) ||
      normalizeString(event?.provider_turn_id_kind),
    target_turn_id:
      normalizeString(event?.target_turn_id) ||
      normalizeString(delivery.target_turn_id) ||
      identity.target_turn_id,
    provider_runtime_event_index:
      normalizePositiveInteger(delivery.provider_runtime_event_index) ||
      normalizePositiveInteger(event?.provider_runtime_event_index),
    source_user_event_id: normalizeString(delivery.source_user_event_id),
    tool_name: normalizeString(event?.tool_name) || normalizeString(event?.name),
    tool_call_id:
      normalizeString(event?.tool_call_id) ||
      normalizeString(event?.call_id) ||
      normalizeString(event?.id),
    tool_is_error:
      semanticType === "tool.failure"
        ? true
        : typeof event?.tool_is_error === "boolean"
        ? event.tool_is_error
        : typeof event?.is_error === "boolean"
        ? event.is_error
        : null,
    tool_update_kind:
      semanticType === "tool.update"
        ? normalizeString(event?.tool_update_kind) ||
          normalizeString(event?.update_kind)
        : null,
    payload: cloneJson(toolPayloadForJsonl(event, semanticType), "tool payload"),
    body:
      normalizeString(event?.semantic_body) ||
      normalizeString(event?.body) ||
      normalizeString(event?.display_text) ||
      normalizeString(event?.text) ||
      null,
    created_at: new Date().toISOString(),
    search_indexed: false,
  };
}

function validateIndex(index, indexPath) {
  if (!index || typeof index !== "object" || Array.isArray(index)) {
    throw new Error(`Invalid large tool index root: ${indexPath}`);
  }
  if (index.schema_version !== ROUTEC_LARGE_TOOL_INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported large tool index schema: ${indexPath}`);
  }
  for (const field of [
    "large_tool_ref",
    "source_host_session_id",
    "source_matrix_room_id",
  ]) {
    if (!normalizeString(index[field])) {
      throw new Error(`Large tool index missing ${field}: ${indexPath}`);
    }
  }
  if (!Array.isArray(index.retained_matrix_event_ids)) {
    throw new Error(
      `Large tool index missing retained_matrix_event_ids: ${indexPath}`
    );
  }
  if (!Array.isArray(index.pages)) {
    throw new Error(`Large tool index missing pages: ${indexPath}`);
  }
  if (!Array.isArray(index.jsonl_event_keys)) {
    throw new Error(`Large tool index missing jsonl_event_keys: ${indexPath}`);
  }
}

function publicSummaryFromIndex(index) {
  const summary = {
    status: "ok",
    has_continuation: index.total_jsonl_tool_event_count > 0,
    continuation_state: index.spillover_state || "available",
    page_size: index.page_size,
    page_count: index.page_count,
    matrix_retained_tool_event_count: index.matrix_retained_tool_event_count,
    total_tool_event_count: index.total_tool_event_count,
    total_jsonl_tool_event_count: index.total_jsonl_tool_event_count,
    notice_sent: index.notice_sent === true,
    notice_matrix_event_id: index.notice_matrix_event_id || null,
    tool_event_count_label: ROUTEC_LARGE_TOOL_EVENT_COUNT_LABEL,
    search_indexed: false,
    matrix_large_tool_ref: false,
    resolver_path_fields_exposed: false,
    tool_payload_local_paths_preserved: true,
  };
  return summary;
}

export function createLargeToolCallStore({ configDir }) {
  if (!normalizeString(configDir)) {
    throw new Error("large_tool_calls store requires configDir");
  }
  const root = join(configDir, "large_tool_calls");

  function sessionDir(sessionId) {
    return join(root, sanitizePathSegment(sessionId, "session_id"));
  }

  function indexPath(sessionId, largeToolRef) {
    return join(sessionDir(sessionId), `${sanitizePathSegment(largeToolRef, "large_tool_ref")}.index.json`);
  }

  function jsonlPath(sessionId, largeToolRef) {
    return join(sessionDir(sessionId), `${sanitizePathSegment(largeToolRef, "large_tool_ref")}.jsonl`);
  }

  function loadIndex(sessionId, largeToolRef) {
    const path = indexPath(sessionId, largeToolRef);
    if (!existsSync(path)) return null;
    const parsed = readJsonFile(path, "large tool index");
    validateIndex(parsed, path);
    return parsed;
  }

  function saveIndex(index) {
    validateIndex(index, "large tool index");
    writeJsonAtomic(indexPath(index.source_host_session_id, index.large_tool_ref), index);
  }

  function createOrLoadIndex({ identity, retainedMatrixEventIds = [] }) {
    const largeToolRef = buildLargeToolRef(identity);
    const existing = loadIndex(identity.source_host_session_id, largeToolRef);
    if (existing) return existing;
    const now = new Date().toISOString();
    const index = {
      schema_version: ROUTEC_LARGE_TOOL_INDEX_SCHEMA_VERSION,
      large_tool_ref: largeToolRef,
      source_host_session_id: identity.source_host_session_id,
      source_matrix_room_id: identity.source_matrix_room_id,
      provider_turn_id: identity.provider_turn_id || null,
      target_turn_id: identity.target_turn_id || null,
      grouping_key: identity.grouping_key || null,
      grouping_key_kind: identity.grouping_key_kind || null,
      consecutive_run_index: identity.consecutive_run_index,
      matrix_retained_tool_event_count: ROUTEC_LARGE_TOOL_EVENT_THRESHOLD,
      retained_matrix_event_ids: [...retainedMatrixEventIds].filter(Boolean),
      jsonl_start_tool_event_index: ROUTEC_LARGE_TOOL_EVENT_THRESHOLD + 1,
      page_size: ROUTEC_LARGE_TOOL_JSONL_PAGE_SIZE,
      total_jsonl_tool_event_count: 0,
      total_tool_event_count: ROUTEC_LARGE_TOOL_EVENT_THRESHOLD,
      page_count: 1,
      notice_sent: false,
      notice_matrix_event_id: null,
      spillover_state: "available",
      search_indexed: false,
      jsonl_event_keys: [],
      pages: [],
      created_at: now,
      updated_at: now,
    };
    saveIndex(index);
    return index;
  }

  function appendToolEvent({ identity, retainedMatrixEventIds, event, semanticType, toolEventIndex }) {
    const index = createOrLoadIndex({ identity, retainedMatrixEventIds });
    const eventKey = buildEventKey({ event, semanticType, toolEventIndex });
    if (index.jsonl_event_keys.includes(eventKey)) {
      return {
        status: "large_tool_event_duplicate_ignored",
        large_tool_ref: index.large_tool_ref,
        appended: false,
        index: publicSummaryFromIndex(index),
      };
    }
    const row = buildJsonlRow({ event, semanticType, identity, toolEventIndex });
    const path = jsonlPath(index.source_host_session_id, index.large_tool_ref);
    mkdirSync(dirname(path), { recursive: true });
    const byteOffset = existsSync(path) ? statSync(path).size : 0;
    appendFileSync(path, `${JSON.stringify(row)}\n`);
    const page = row.jsonl_page_index;
    let pageEntry = index.pages.find((entry) => entry.page === page);
    if (!pageEntry) {
      pageEntry = {
        page,
        start_tool_event_index: row.tool_event_index,
        end_tool_event_index: row.tool_event_index,
        byte_offset: byteOffset,
        line_count: 0,
      };
      index.pages.push(pageEntry);
    }
    pageEntry.end_tool_event_index = row.tool_event_index;
    pageEntry.line_count += 1;
    index.jsonl_event_keys.push(eventKey);
    index.total_jsonl_tool_event_count += 1;
    index.total_tool_event_count = Math.max(
      index.total_tool_event_count,
      row.tool_event_index
    );
    index.page_count = 1 + Math.max(0, ...index.pages.map((entry) => entry.page));
    index.updated_at = new Date().toISOString();
    saveIndex(index);
    return {
      status: "large_tool_event_spilled_to_jsonl",
      large_tool_ref: index.large_tool_ref,
      appended: true,
      tool_event_index: row.tool_event_index,
      jsonl_page_index: row.jsonl_page_index,
      index: publicSummaryFromIndex(index),
    };
  }

  function markNoticeSent({ sessionId, largeToolRef, noticeMatrixEventId }) {
    const index = loadIndex(sessionId, largeToolRef);
    if (!index) {
      throw new Error("Cannot mark missing large tool index notice sent");
    }
    index.notice_sent = true;
    index.notice_matrix_event_id = normalizeString(noticeMatrixEventId);
    index.updated_at = new Date().toISOString();
    saveIndex(index);
    return publicSummaryFromIndex(index);
  }

  function listSessionIndexes(sessionId) {
    const dir = sessionDir(sessionId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((entry) => entry.endsWith(".index.json"))
      .map((entry) => {
        const parsed = readJsonFile(join(dir, entry), "large tool index");
        validateIndex(parsed, join(dir, entry));
        return parsed;
      });
  }

  function resolveIndex({
    sessionId,
    matrixRoomId,
    largeToolRef = null,
    retainedMatrixEventId = null,
    providerTurnId = null,
    targetTurnId = null,
    groupingKey = null,
  }) {
    if (largeToolRef) {
      const index = loadIndex(sessionId, largeToolRef);
      if (!index) return { status: "unavailable", matches: [] };
      if (index.source_matrix_room_id !== matrixRoomId) {
        return { status: "forbidden", matches: [] };
      }
      return { status: "ok", matches: [index] };
    }
    const matches = listSessionIndexes(sessionId).filter((index) => {
      if (index.source_matrix_room_id !== matrixRoomId) return false;
      if (
        retainedMatrixEventId &&
        !index.retained_matrix_event_ids.includes(retainedMatrixEventId)
      ) {
        return false;
      }
      if (providerTurnId && index.provider_turn_id !== providerTurnId) {
        return false;
      }
      if (targetTurnId && index.target_turn_id !== targetTurnId) {
        return false;
      }
      if (groupingKey && index.grouping_key !== groupingKey) {
        return false;
      }
      return true;
    });
    if (matches.length === 0) return { status: "unavailable", matches };
    if (matches.length > 1) return { status: "ambiguous", matches };
    return { status: "ok", matches };
  }

  function readJsonlPage(index, userFacingPage) {
    if (userFacingPage <= 1) return [];
    const jsonlPage = userFacingPage - 1;
    const pageEntry = index.pages.find((entry) => entry.page === jsonlPage);
    if (!pageEntry) return [];
    const path = jsonlPath(index.source_host_session_id, index.large_tool_ref);
    if (!existsSync(path)) {
      throw new Error("large output file unavailable");
    }
    const start = pageEntry.start_tool_event_index;
    const end = pageEntry.end_tool_event_index;
    return readFileSync(path, "utf8")
      .split(/\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (row) =>
          row.tool_event_index >= start &&
          row.tool_event_index <= end &&
          row.jsonl_page_index === jsonlPage
      );
  }

  function readAllJsonlRows(index) {
    const path = jsonlPath(index.source_host_session_id, index.large_tool_ref);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split(/\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort((left, right) => left.tool_event_index - right.tool_event_index);
  }

  function resolveLargeToolRun(options) {
    const sessionId = normalizeString(options?.sessionId);
    const matrixRoomId = normalizeString(options?.matrixRoomId);
    if (!sessionId || !matrixRoomId) {
      throw new Error("session_id and matrix_room_id are required");
    }
    const resolved = resolveIndex({
      sessionId,
      matrixRoomId,
      largeToolRef: normalizeString(options?.largeToolRef),
      retainedMatrixEventId: normalizeString(options?.retainedMatrixEventId),
      providerTurnId: normalizeString(options?.providerTurnId),
      targetTurnId: normalizeString(options?.targetTurnId),
      groupingKey: normalizeString(options?.groupingKey),
    });
    if (resolved.status !== "ok") {
      return { status: resolved.status, matches: resolved.matches.length };
    }
    const index = resolved.matches[0];
    return {
      status: "ok",
      summary: publicSummaryFromIndex(index),
      retained_matrix_event_ids: [...index.retained_matrix_event_ids],
      continuation_records: readAllJsonlRows(index),
      provider_turn_id: index.provider_turn_id,
      target_turn_id: index.target_turn_id,
      grouping_key: index.grouping_key,
      large_tool_ref: index.large_tool_ref,
    };
  }

  function resolveLargeToolOutput(options) {
    const sessionId = normalizeString(options?.sessionId);
    const matrixRoomId = normalizeString(options?.matrixRoomId);
    const page = normalizePositiveInteger(options?.page) || 1;
    if (!sessionId || !matrixRoomId) {
      throw new Error("session_id and matrix_room_id are required");
    }
    const resolved = resolveIndex({
      sessionId,
      matrixRoomId,
      largeToolRef: normalizeString(options?.largeToolRef),
      retainedMatrixEventId: normalizeString(options?.retainedMatrixEventId),
      providerTurnId: normalizeString(options?.providerTurnId),
      targetTurnId: normalizeString(options?.targetTurnId),
      groupingKey: normalizeString(options?.groupingKey),
    });
    if (resolved.status !== "ok") {
      return {
        status: resolved.status,
        has_continuation: false,
        continuation_state: resolved.status,
        page,
        matches: resolved.matches.length,
        resolver_path_fields_exposed: false,
      };
    }
    const index = resolved.matches[0];
    const summary = publicSummaryFromIndex(index);
    const response = {
      ...summary,
      page,
      large_tool_ref: index.large_tool_ref,
      items: page <= 1 ? [] : readJsonlPage(index, page),
      jsonl_loaded: page > 1,
      detail_page_1_matrix_retained: page === 1,
      explicit_detail_navigation_required: true,
    };
    return response;
  }

  return {
    root,
    appendToolEvent,
    markNoticeSent,
    resolveLargeToolRun,
    resolveLargeToolOutput,
    createOrLoadIndex,
  };
}
