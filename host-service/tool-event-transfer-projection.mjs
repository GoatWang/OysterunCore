export const OYSTERUN_SEMANTIC_NAMESPACE = "org.oysterun.semantic.v1";
export const ROUTEC_TOOL_TRANSFER_PROJECTION_SCHEMA_VERSION =
  "routec.tool_message_transfer_projection.v1";
export const ROUTEC_TOOL_DETAIL_SCHEMA_VERSION =
  "routec.tool_event_detail.v1";
export const ROUTEC_TOOL_TRANSFER_INLINE_THRESHOLD_BYTES = 8192;
export const ROUTEC_TOOL_TRANSFER_PREVIEW_CHARS = 320;

const TOOL_SEMANTIC_TYPES = new Set([
  "tool.call",
  "tool.output",
  "tool.result",
  "tool.failure",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value, label = "value") {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return null;
  try {
    return JSON.parse(encoded);
  } catch (err) {
    throw new Error(
      `Route C tool transfer ${label} must be JSON serializable: ${
        err?.message || String(err)
      }`
    );
  }
}

function byteLength(value) {
  if (value === null || value === undefined) return 0;
  const encoded =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return Buffer.byteLength(String(encoded), "utf8");
}

function lineCount(value) {
  if (value === null || value === undefined) return 0;
  const encoded =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!encoded) return 0;
  return String(encoded).split(/\r?\n/).length;
}

function printable(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function preview(value, size = ROUTEC_TOOL_TRANSFER_PREVIEW_CHARS) {
  const text = printable(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= size) return text;
  return text.slice(0, size).trim();
}

function previewLast(value, size = ROUTEC_TOOL_TRANSFER_PREVIEW_CHARS) {
  const text = printable(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= size) return text;
  return text.slice(-size).trim();
}

function semanticPayload(content) {
  const semantic = isObject(content?.[OYSTERUN_SEMANTIC_NAMESPACE])
    ? content[OYSTERUN_SEMANTIC_NAMESPACE]
    : null;
  return semantic;
}

export function routeCToolSemanticTypeFromContent(content) {
  const semantic = semanticPayload(content);
  const semanticType =
    typeof semantic?.semantic_type === "string" && semantic.semantic_type.trim()
      ? semantic.semantic_type.trim()
      : typeof semantic?.semantic_category === "string" &&
        semantic.semantic_category.trim()
      ? semantic.semantic_category.trim()
      : null;
  return TOOL_SEMANTIC_TYPES.has(semanticType) ? semanticType : null;
}

function addField(fields, source, field, value) {
  if (value === null || value === undefined) return;
  const fieldPath = source === "semantic" ? `semantic.${field}` : field;
  const encodedBytes = byteLength(value);
  if (encodedBytes <= 0) return;
  fields.push({
    field: fieldPath,
    source,
    value: cloneJson(value, fieldPath),
    byte_count: encodedBytes,
    line_count: lineCount(value),
  });
}

function collectToolDetailFields(content, semanticType) {
  const semantic = semanticPayload(content);
  const fields = [];
  if (!semanticType || !semantic) return fields;
  addField(fields, "semantic", "tool_input", semantic.tool_input);
  addField(fields, "semantic", "tool_content", semantic.tool_content);
  addField(fields, "semantic", "stdout", semantic.stdout);
  addField(fields, "semantic", "stderr", semantic.stderr);
  addField(fields, "semantic", "body", semantic.body);
  addField(fields, "content", "body", content?.body);
  addField(fields, "content", "formatted_body", content?.formatted_body);
  return fields;
}

function choosePrimaryField(fields, semanticType) {
  const preferred =
    semanticType === "tool.call"
      ? "semantic.tool_input"
      : "semantic.tool_content";
  return (
    fields.find((field) => field.field === preferred) ||
    fields.find((field) => field.field === "semantic.stdout") ||
    fields.find((field) => field.field === "semantic.stderr") ||
    fields.find((field) => field.field === "content.body") ||
    fields[0] ||
    null
  );
}

function largestField(fields) {
  return [...fields].sort((left, right) => {
    if (right.byte_count !== left.byte_count) {
      return right.byte_count - left.byte_count;
    }
    return left.field.localeCompare(right.field);
  })[0] || null;
}

function detailRecordFromFields({ event, semanticType, fields, storageKind }) {
  const content = isObject(event?.content) ? event.content : {};
  const semantic = semanticPayload(content) || {};
  return {
    schema_version: ROUTEC_TOOL_DETAIL_SCHEMA_VERSION,
    semantic_type: semanticType,
    host_session_id:
      typeof semantic.host_session_id === "string"
        ? semantic.host_session_id
        : null,
    matrix_room_id:
      typeof semantic.matrix_room_id === "string"
        ? semantic.matrix_room_id
        : typeof event?.room_id === "string"
        ? event.room_id
        : null,
    matrix_event_id:
      typeof event?.event_id === "string" ? event.event_id : null,
    tool_name:
      typeof semantic.tool_name === "string" ? semantic.tool_name : null,
    tool_call_id:
      typeof semantic.tool_call_id === "string" ? semantic.tool_call_id : null,
    tool_is_error:
      typeof semantic.tool_is_error === "boolean"
        ? semantic.tool_is_error
        : null,
    provider_turn_id:
      typeof semantic.provider_turn_id === "string"
        ? semantic.provider_turn_id
        : null,
    target_turn_id:
      typeof semantic.target_turn_id === "string"
        ? semantic.target_turn_id
        : null,
    source_user_event_id:
      typeof semantic.source_user_event_id === "string"
        ? semantic.source_user_event_id
        : null,
    detail_storage_kind: storageKind,
    fields: fields.map((field) => ({
      field: field.field,
      source: field.source,
      byte_count: field.byte_count,
      line_count: field.line_count,
      value: cloneJson(field.value, field.field),
    })),
  };
}

function buildSummaryValue({
  semanticType,
  fields,
  largest,
  primary,
  storageKind,
  projectionReason,
}) {
  const originalByteCount = fields.reduce(
    (total, field) => total + field.byte_count,
    0
  );
  const originalLineCount = fields.reduce(
    (total, field) => total + field.line_count,
    0
  );
  const previewFirst = preview(primary?.value);
  const previewTail = previewLast(primary?.value);
  return {
    schema_version: ROUTEC_TOOL_TRANSFER_PROJECTION_SCHEMA_VERSION,
    summary_kind: "routec_tool_transfer_summary",
    semantic_type: semanticType,
    preview_first: previewFirst,
    preview_last: previewTail,
    preview_text: previewFirst || previewTail || "Tool detail available.",
    original_byte_count: originalByteCount,
    original_line_count: originalLineCount,
    detail_available: true,
    detail_truncated: true,
    detail_storage_kind: storageKind,
    projection_reason: projectionReason,
    largest_stripped_field: largest?.field || null,
    stripped_fields: fields.map((field) => field.field),
    threshold_bytes: ROUTEC_TOOL_TRANSFER_INLINE_THRESHOLD_BYTES,
  };
}

function summaryBody({ semanticType, summary, toolName }) {
  const label =
    semanticType === "tool.call"
      ? "Tool call"
      : semanticType === "tool.output"
      ? "Tool output"
      : semanticType === "tool.failure"
      ? "Tool failure"
      : "Tool result";
  const name = toolName ? ` ${toolName}` : "";
  return `${label}${name} detail available (${summary.original_byte_count} bytes). ${summary.preview_text}`;
}

export function projectToolEventForClientTransfer({
  event,
  storageKind = "matrix_legacy_inline",
  force = false,
} = {}) {
  if (!isObject(event)) {
    return {
      event,
      projected: false,
      detail_record: null,
      projection: null,
    };
  }
  const cloned = cloneJson(event, "matrix event");
  const content = isObject(cloned.content) ? cloned.content : {};
  const semanticType = routeCToolSemanticTypeFromContent(content);
  if (!semanticType) {
    return {
      event: cloned,
      projected: false,
      detail_record: null,
      projection: null,
    };
  }
  const semantic = semanticPayload(content);
  if (semantic?.tool_transfer_projection?.projected === true) {
    return {
      event: cloned,
      projected: false,
      already_projected: true,
      detail_record: null,
      projection: semantic.tool_transfer_projection,
    };
  }

  const fields = collectToolDetailFields(content, semanticType);
  const originalByteCount = fields.reduce(
    (total, field) => total + field.byte_count,
    0
  );
  if (
    !force &&
    originalByteCount <= ROUTEC_TOOL_TRANSFER_INLINE_THRESHOLD_BYTES
  ) {
    return {
      event: cloned,
      projected: false,
      detail_record: null,
      projection: null,
    };
  }
  if (fields.length === 0 || !semantic) {
    return {
      event: cloned,
      projected: false,
      detail_record: null,
      projection: null,
    };
  }

  const largest = largestField(fields);
  const primary = choosePrimaryField(fields, semanticType);
  const projectionReason =
    originalByteCount > ROUTEC_TOOL_TRANSFER_INLINE_THRESHOLD_BYTES
      ? "tool_payload_exceeds_transfer_threshold"
      : "forced_tool_transfer_projection";
  const summary = buildSummaryValue({
    semanticType,
    fields,
    largest,
    primary,
    storageKind,
    projectionReason,
  });
  const body = summaryBody({
    semanticType,
    summary,
    toolName:
      typeof semantic.tool_name === "string" && semantic.tool_name.trim()
        ? semantic.tool_name.trim()
        : null,
  });
  const projectedContent = {
    ...content,
    body,
    formatted_body: undefined,
    [OYSTERUN_SEMANTIC_NAMESPACE]: {
      ...semantic,
      body,
      detail_available: true,
      tool_detail_available: true,
      tool_detail_storage_kind: storageKind,
      tool_detail_identity_kind: "session_room_event",
      tool_detail_endpoint: "/session/tool-event-detail",
      tool_transfer_projection: {
        ...summary,
        projected: true,
        transferred_byte_count: null,
        matrix_event_id_present: typeof cloned.event_id === "string",
      },
      tool_input: semanticType === "tool.call" ? summary : null,
      tool_content: semanticType === "tool.call" ? null : summary,
      stdout: null,
      stderr: null,
      stdout_truncated: null,
      stderr_truncated: null,
    },
  };
  delete projectedContent.formatted_body;
  const projectedEvent = {
    ...cloned,
    content: projectedContent,
  };
  const transferredByteCount = byteLength(projectedEvent.content);
  projectedEvent.content[OYSTERUN_SEMANTIC_NAMESPACE].tool_transfer_projection = {
    ...projectedEvent.content[OYSTERUN_SEMANTIC_NAMESPACE]
      .tool_transfer_projection,
    transferred_byte_count: transferredByteCount,
  };
  const detailRecord = detailRecordFromFields({
    event: cloned,
    semanticType,
    fields,
    storageKind,
  });
  return {
    event: projectedEvent,
    projected: true,
    detail_record: detailRecord,
    projection:
      projectedEvent.content[OYSTERUN_SEMANTIC_NAMESPACE]
        .tool_transfer_projection,
  };
}

export function buildToolEventDetailRecordFromMatrixEvent({
  event,
  storageKind = "matrix_legacy_inline",
} = {}) {
  const content = isObject(event?.content) ? event.content : {};
  const semanticType = routeCToolSemanticTypeFromContent(content);
  if (!semanticType) return null;
  const fields = collectToolDetailFields(content, semanticType);
  if (fields.length === 0) return null;
  return detailRecordFromFields({ event, semanticType, fields, storageKind });
}
