import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { ROUTEC_TOOL_DETAIL_SCHEMA_VERSION } from "./tool-event-transfer-projection.mjs";

export const ROUTEC_TOOL_EVENT_DETAIL_STORE_SCHEMA_VERSION =
  "routec.tool_event_detail_store.v1";
export const ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES = 1024 * 1024;
export const ROUTEC_TOOL_EVENT_DETAIL_PAGE_SIZE_BYTES =
  ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES;

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function cloneJson(value, label) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return null;
  try {
    return JSON.parse(encoded);
  } catch (err) {
    throw new Error(
      `Route C tool detail ${label} must be JSON serializable: ${
        err?.message || String(err)
      }`
    );
  }
}

function assertNoRawPathInPublicValue(value, label) {
  const encoded = JSON.stringify(value);
  if (
    encoded.includes("/tool_event_details/") ||
    encoded.includes("\\tool_event_details\\")
  ) {
    throw new Error(`${label} must not expose raw tool_event_details paths`);
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmpPath, path);
}

function byteLength(value) {
  return Buffer.byteLength(
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    "utf8"
  );
}

function lineCount(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function requireIdentity({ sessionId, matrixRoomId, matrixEventId }) {
  const normalized = {
    sessionId: normalizeString(sessionId),
    matrixRoomId: normalizeString(matrixRoomId),
    matrixEventId: normalizeString(matrixEventId),
  };
  if (!normalized.sessionId || !normalized.matrixRoomId || !normalized.matrixEventId) {
    throw new Error("session_id, matrix_room_id, and matrix_event_id are required");
  }
  return normalized;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function recordPath(root, identity) {
  return join(
    root,
    sha256(identity.sessionId).slice(0, 24),
    `${sha256(`${identity.matrixRoomId}\u001f${identity.matrixEventId}`).slice(
      0,
      32
    )}.json`
  );
}

function normalizeDetailRecord({ detail, identity }) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new Error("Route C tool detail record must be an object");
  }
  if (
    detail.schema_version &&
    detail.schema_version !== ROUTEC_TOOL_DETAIL_SCHEMA_VERSION
  ) {
    throw new Error(`Unsupported Route C tool detail schema: ${detail.schema_version}`);
  }
  const fields = Array.isArray(detail.fields) ? detail.fields : [];
  if (fields.length === 0) {
    throw new Error("Route C tool detail record requires fields");
  }
  return {
    schema_version: ROUTEC_TOOL_EVENT_DETAIL_STORE_SCHEMA_VERSION,
    detail_schema_version: ROUTEC_TOOL_DETAIL_SCHEMA_VERSION,
    session_id: identity.sessionId,
    matrix_room_id: identity.matrixRoomId,
    matrix_event_id: identity.matrixEventId,
    semantic_type: normalizeString(detail.semantic_type),
    tool_name: normalizeString(detail.tool_name),
    tool_call_id: normalizeString(detail.tool_call_id),
    tool_is_error:
      typeof detail.tool_is_error === "boolean" ? detail.tool_is_error : null,
    provider_turn_id: normalizeString(detail.provider_turn_id),
    target_turn_id: normalizeString(detail.target_turn_id),
    source_user_event_id: normalizeString(detail.source_user_event_id),
    detail_storage_kind:
      normalizeString(detail.detail_storage_kind) || "host_tool_event_detail_store",
    fields: fields.map((field) => ({
      field: normalizeString(field.field) || "tool_detail",
      source: normalizeString(field.source) || "unknown",
      byte_count: normalizePositiveInteger(field.byte_count, byteLength(field.value)),
      line_count: normalizePositiveInteger(field.line_count, lineCount(field.value)),
      value: cloneJson(field.value, field.field || "field"),
    })),
    created_at: new Date().toISOString(),
    raw_path_exposed: false,
  };
}
function loadRecord(path) {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.schema_version !== ROUTEC_TOOL_EVENT_DETAIL_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Route C tool event detail store schema: ${parsed.schema_version}`
    );
  }
  return parsed;
}

function valueText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function topUtf8Text(value, maxBytes) {
  const text = String(value || "");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return {
      text,
      truncated: false,
    };
  }
  const buffer = Buffer.from(text, "utf8").subarray(0, maxBytes);
  return {
    text: buffer.toString("utf8").replace(/\uFFFD$/, ""),
    truncated: true,
  };
}

function paginateFields(record, page, pageSizeBytes) {
  const items = [];
  let currentPage = 1;
  let currentBytes = 0;
  for (const field of record.fields) {
    const text = valueText(field.value);
    const selected = topUtf8Text(text, pageSizeBytes);
    const itemBytes = Buffer.byteLength(selected.text, "utf8");
    if (currentBytes > 0 && currentBytes + itemBytes > pageSizeBytes) {
      currentPage += 1;
      currentBytes = 0;
    }
    if (currentPage === page) {
      items.push({
        field: field.field,
        source: field.source,
        semantic_type: record.semantic_type,
        tool_name: record.tool_name,
        tool_call_id: record.tool_call_id,
        tool_is_error: record.tool_is_error,
        byte_count: itemBytes,
        line_count: lineCount(selected.text),
        original_byte_count: field.byte_count,
        original_line_count: field.line_count,
        selected_detail_top_only: true,
        selected_detail_limit_bytes: pageSizeBytes,
        selected_detail_truncated: selected.truncated,
        selected_detail_truncation_reason: selected.truncated
          ? "selected_detail_exceeds_1_mib_top_limit"
          : null,
        chunk_index: 1,
        chunk_count: 1,
        content: selected.truncated ? selected.text : field.value,
      });
    }
    currentBytes += itemBytes;
  }
  const pageCount = Math.max(1, currentPage + (currentBytes > 0 ? 0 : -1));
  return {
    page,
    page_count: pageCount,
    items,
    selected_detail_truncated: record.fields.some(
      (field) => Number(field.byte_count || 0) > pageSizeBytes
    ),
    truncated_field_count: record.fields.filter(
      (field) => Number(field.byte_count || 0) > pageSizeBytes
    ).length,
  };
}

function publicResponse(record, page, pageSizeBytes) {
  const pageResult = paginateFields(record, page, pageSizeBytes);
  const response = {
    status: "ok",
    schema_version: ROUTEC_TOOL_EVENT_DETAIL_STORE_SCHEMA_VERSION,
    session_id: record.session_id,
    matrix_room_id: record.matrix_room_id,
    matrix_event_id: record.matrix_event_id,
    semantic_type: record.semantic_type,
    tool_name: record.tool_name,
    tool_call_id: record.tool_call_id,
    tool_is_error: record.tool_is_error,
    provider_turn_id: record.provider_turn_id,
    target_turn_id: record.target_turn_id,
    source_user_event_id: record.source_user_event_id,
    detail_storage_kind: record.detail_storage_kind,
    original_byte_count: record.fields.reduce(
      (total, field) => total + Number(field.byte_count || 0),
      0
    ),
    original_line_count: record.fields.reduce(
      (total, field) => total + Number(field.line_count || 0),
      0
    ),
    page: pageResult.page,
    page_size_bytes: pageSizeBytes,
    page_count: pageResult.page_count,
    selected_detail_top_only: true,
    selected_detail_limit_bytes: pageSizeBytes,
    selected_detail_truncated: pageResult.selected_detail_truncated,
    truncated_field_count: pageResult.truncated_field_count,
    items: pageResult.items,
    raw_path_exposed: false,
  };
  assertNoRawPathInPublicValue(response, "tool event detail response");
  return response;
}

export function createToolEventDetailStore({ configDir }) {
  const normalizedConfigDir = normalizeString(configDir);
  if (!normalizedConfigDir) {
    throw new Error("Route C tool event detail store requires configDir");
  }
  const root = join(normalizedConfigDir, "tool_event_details");

  function writeToolEventDetail({ sessionId, matrixRoomId, matrixEventId, detail }) {
    const identity = requireIdentity({ sessionId, matrixRoomId, matrixEventId });
    const record = normalizeDetailRecord({ detail, identity });
    const path = recordPath(root, identity);
    writeJsonAtomic(path, record);
    return {
      status: "tool_event_detail_stored",
      session_id: identity.sessionId,
      matrix_room_id: identity.matrixRoomId,
      matrix_event_id: identity.matrixEventId,
      semantic_type: record.semantic_type,
      field_count: record.fields.length,
      original_byte_count: record.fields.reduce(
        (total, field) => total + Number(field.byte_count || 0),
        0
      ),
      detail_storage_kind: "host_tool_event_detail_store",
      raw_path_exposed: false,
    };
  }

  function resolveToolEventDetail({
    sessionId,
    matrixRoomId,
    matrixEventId,
    page = 1,
    pageSizeBytes = ROUTEC_TOOL_EVENT_DETAIL_PAGE_SIZE_BYTES,
  }) {
    const identity = requireIdentity({ sessionId, matrixRoomId, matrixEventId });
    const record = loadRecord(recordPath(root, identity));
    const normalizedPage = normalizePositiveInteger(page, 1);
    const normalizedPageSize = Math.min(
      Math.max(normalizePositiveInteger(pageSizeBytes, ROUTEC_TOOL_EVENT_DETAIL_PAGE_SIZE_BYTES), 1024),
      ROUTEC_TOOL_EVENT_DETAIL_PAGE_SIZE_BYTES
    );
    if (!record) {
      return {
        status: "unavailable",
        session_id: identity.sessionId,
        matrix_room_id: identity.matrixRoomId,
        matrix_event_id: identity.matrixEventId,
        page: normalizedPage,
        items: [],
        raw_path_exposed: false,
      };
    }
    return publicResponse(record, normalizedPage, normalizedPageSize);
  }

  return {
    root,
    writeToolEventDetail,
    resolveToolEventDetail,
  };
}
