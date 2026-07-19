const OYSTERUN_SEMANTIC_NAMESPACE = "org.oysterun.semantic.v1";

export const ROUTEC_UNIFIED_TOOL_DETAIL_SCHEMA_VERSION =
  "routec.unified_tool_lifecycle_detail.v1";
export const ROUTEC_UNIFIED_TOOL_DETAIL_PAGE_SIZE = 10;
export const ROUTEC_UNIFIED_TOOL_DETAIL_SELECTED_LIMIT_BYTES = 1024 * 1024;

const TOOL_SEMANTIC_TYPES = new Set([
  "tool.call",
  "tool.update",
  "tool.output",
  "tool.result",
  "tool.failure",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function detailFieldValue(detailRecord, fieldName) {
  const field = detailRecord?.fields?.find((entry) => entry?.field === fieldName);
  return field ? cloneJson(field.value) : null;
}

function matrixPayload(semanticType, semantic, detailRecord) {
  const storedInput = detailFieldValue(detailRecord, "semantic.tool_input");
  const storedContent = detailFieldValue(detailRecord, "semantic.tool_content");
  const storedStdout = detailFieldValue(detailRecord, "semantic.stdout");
  const storedStderr = detailFieldValue(detailRecord, "semantic.stderr");
  const input = storedInput ?? semantic.tool_input ?? null;
  const content = storedContent ?? semantic.tool_content ?? null;
  if (semanticType === "tool.call") return cloneJson(input);
  if (semanticType === "tool.update") {
    if (input !== null && content !== null) {
      return { input: cloneJson(input), content: cloneJson(content) };
    }
    return cloneJson(input ?? content);
  }
  if (content !== null) return cloneJson(content);
  if (storedStdout !== null || storedStderr !== null) {
    return {
      stdout: cloneJson(storedStdout),
      stderr: cloneJson(storedStderr),
    };
  }
  return null;
}

export function isUnifiedToolSemanticType(value) {
  return TOOL_SEMANTIC_TYPES.has(normalizeString(value));
}

export function normalizeMatrixToolPhysicalRecord({
  event,
  physicalIndex,
  detailRecord = null,
}) {
  const content = isObject(event?.content) ? event.content : {};
  const semantic = isObject(content[OYSTERUN_SEMANTIC_NAMESPACE])
    ? content[OYSTERUN_SEMANTIC_NAMESPACE]
    : {};
  const semanticType = normalizeString(
    semantic.semantic_type || semantic.semantic_category
  );
  if (!TOOL_SEMANTIC_TYPES.has(semanticType)) return null;
  return {
    physical_event_index:
      normalizePositiveInteger(physicalIndex) ||
      normalizePositiveInteger(semantic.provider_runtime_event_index) ||
      normalizePositiveInteger(event?.routec_stream_seq),
    provider_runtime_event_index: normalizePositiveInteger(
      semantic.provider_runtime_event_index
    ),
    semantic_type: semanticType,
    source: "matrix",
    matrix_event_id: normalizeString(event?.event_id),
    provider: normalizeString(semantic.provider_id || semantic.provider),
    provider_turn_id: normalizeString(semantic.provider_turn_id),
    target_turn_id: normalizeString(semantic.target_turn_id),
    source_user_event_id: normalizeString(semantic.source_user_event_id),
    tool_name: normalizeString(semantic.tool_name),
    tool_call_id: normalizeString(semantic.tool_call_id),
    tool_is_error:
      semanticType === "tool.failure"
        ? true
        : typeof semantic.tool_is_error === "boolean"
        ? semantic.tool_is_error
        : null,
    tool_update_kind: normalizeString(semantic.tool_update_kind),
    status: normalizeString(semantic.lifecycle || semantic.status),
    payload: matrixPayload(semanticType, semantic, detailRecord),
    body: normalizeString(content.body || semantic.body),
    received_at:
      Number.isFinite(Number(event?.origin_server_ts)) &&
      Number(event.origin_server_ts) > 0
        ? new Date(Number(event.origin_server_ts)).toISOString()
        : null,
  };
}

export function normalizeContinuationToolPhysicalRecord(row) {
  const semanticType = normalizeString(row?.semantic_type);
  if (!TOOL_SEMANTIC_TYPES.has(semanticType)) return null;
  return {
    physical_event_index: normalizePositiveInteger(row.tool_event_index),
    provider_runtime_event_index: normalizePositiveInteger(
      row.provider_runtime_event_index
    ),
    semantic_type: semanticType,
    source: "host_sqlite",
    matrix_event_id: null,
    provider: normalizeString(row.provider),
    provider_turn_id: normalizeString(row.provider_turn_id),
    target_turn_id: normalizeString(row.target_turn_id),
    source_user_event_id: normalizeString(row.source_user_event_id),
    tool_name: normalizeString(row.tool_name),
    tool_call_id: normalizeString(row.tool_call_id),
    tool_is_error:
      semanticType === "tool.failure"
        ? true
        : typeof row.tool_is_error === "boolean"
        ? row.tool_is_error
        : null,
    tool_update_kind: normalizeString(row.tool_update_kind),
    status: normalizeString(row.status),
    payload: cloneJson(row.payload),
    body: normalizeString(row.body),
    received_at: normalizeString(row.created_at),
  };
}

function mergeInput(previous, next) {
  if (next === null || next === undefined) return cloneJson(previous);
  if (previous === null || previous === undefined) return cloneJson(next);
  if (isObject(previous) && isObject(next)) {
    const merged = { ...cloneJson(previous) };
    for (const [key, value] of Object.entries(next)) {
      merged[key] = mergeInput(merged[key], value);
    }
    return merged;
  }
  return cloneJson(next);
}

function updateInput(record) {
  if (record.semantic_type !== "tool.update") return null;
  if (isObject(record.payload) && Object.prototype.hasOwnProperty.call(record.payload, "input")) {
    return record.payload.input;
  }
  if (record.tool_update_kind === "input_refinement") return record.payload;
  return null;
}

function updateContent(record) {
  if (isObject(record.payload) && Object.prototype.hasOwnProperty.call(record.payload, "content")) {
    return record.payload.content;
  }
  return record.payload;
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return "";
}

function completeOutputFromResult(payload) {
  if (!isObject(payload)) return textValue(payload) || null;
  if (typeof payload.aggregatedOutput === "string" && payload.aggregatedOutput) {
    return payload.aggregatedOutput;
  }
  const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
  if (stdout || stderr) {
    return stderr ? { stdout, stderr } : stdout;
  }
  if (payload.output !== undefined && payload.output !== null) {
    return cloneJson(payload.output);
  }
  return null;
}

function resultMetadata(record) {
  if (!record) return null;
  if (!isObject(record.payload)) {
    return {
      status: record.status,
      is_error: record.tool_is_error === true,
    };
  }
  const metadata = cloneJson(record.payload);
  delete metadata.stdout;
  delete metadata.stderr;
  delete metadata.aggregatedOutput;
  delete metadata.output;
  return {
    ...metadata,
    status: metadata.status ?? record.status,
    is_error: record.tool_is_error === true,
  };
}

function truncateValue(value, limitBytes) {
  if (value === null || value === undefined) {
    return { value: null, truncated: false };
  }
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text, "utf8") <= limitBytes) {
    return { value: cloneJson(value), truncated: false };
  }
  const buffer = Buffer.from(text, "utf8").subarray(0, limitBytes);
  return {
    value: buffer.toString("utf8").replace(/\uFFFD$/, ""),
    truncated: true,
  };
}

function publicUpdate(record, terminalSeen) {
  return {
    physical_event_index: record.physical_event_index,
    provider_runtime_event_index: record.provider_runtime_event_index,
    semantic_type: record.semantic_type,
    update_kind:
      record.tool_update_kind ||
      (record.semantic_type === "tool.output" ? "legacy_output_delta" : "progress"),
    payload: cloneJson(updateContent(record)),
    late: terminalSeen,
  };
}

function finalizeInvocation(invocation, selectedDetailLimitBytes) {
  const callRecords = invocation.records.filter(
    (record) => record.semantic_type === "tool.call"
  );
  const terminalRecords = invocation.records.filter(
    (record) =>
      record.semantic_type === "tool.result" ||
      record.semantic_type === "tool.failure"
  );
  const terminal = terminalRecords[terminalRecords.length - 1] || null;
  const toolOutputRecordCount = invocation.records.filter(
    (record) => record.semantic_type === "tool.output"
  ).length;
  let integratedInput = null;
  for (const record of callRecords) integratedInput = mergeInput(integratedInput, record.payload);
  for (const record of invocation.records) {
    integratedInput = mergeInput(integratedInput, updateInput(record));
  }

  let terminalSeen = false;
  const updates = [];
  const outputRecords = [];
  for (const record of invocation.records) {
    if (record.semantic_type === "tool.result" || record.semantic_type === "tool.failure") {
      terminalSeen = true;
      continue;
    }
    const legacyCodexDelta =
      record.semantic_type === "tool.output" &&
      (record.provider === "codex" ||
        (terminal !== null && toolOutputRecordCount > 1));
    if (record.semantic_type === "tool.update" || legacyCodexDelta) {
      updates.push(publicUpdate(record, terminalSeen));
      continue;
    }
    if (record.semantic_type === "tool.output") outputRecords.push(record);
  }

  let output = completeOutputFromResult(terminal?.payload);
  if (output === null && outputRecords.length > 0) {
    const strings = outputRecords.map((record) => textValue(record.payload));
    output = strings.every(Boolean)
      ? strings.join("")
      : cloneJson(outputRecords[outputRecords.length - 1].payload);
  }
  if (output === null) {
    const deltaText = updates
      .filter((update) =>
        ["output_delta", "legacy_output_delta"].includes(update.update_kind)
      )
      .map((update) => textValue(update.payload))
      .join("");
    output = deltaText || null;
  }

  const selectedOutput = truncateValue(output, selectedDetailLimitBytes);
  const selectedCall = truncateValue(integratedInput, selectedDetailLimitBytes);
  const lateUpdateCount = updates.filter((update) => update.late).length;
  const failed =
    terminal?.semantic_type === "tool.failure" || terminal?.tool_is_error === true;
  const state = terminal ? (failed ? "failed" : "succeeded") : "incomplete";
  return {
    tool_call_id: invocation.tool_call_id,
    tool_name: invocation.tool_name,
    provider: invocation.provider,
    provider_turn_id: invocation.provider_turn_id,
    target_turn_id: invocation.target_turn_id,
    first_event_sequence: invocation.first_event_sequence,
    last_event_sequence: invocation.last_event_sequence,
    physical_event_count: invocation.records.length,
    state,
    incomplete_reason:
      callRecords.length === 0
        ? "missing_tool_call"
        : terminal
        ? null
        : "missing_terminal_result",
    call: selectedCall.value,
    updates,
    output: selectedOutput.value,
    result: resultMetadata(terminal),
    late_update_count: lateUpdateCount,
    selected_detail_truncated:
      selectedCall.truncated || selectedOutput.truncated,
    selected_detail_limit_bytes: selectedDetailLimitBytes,
  };
}

export function buildUnifiedToolLifecycleDetail({
  sessionId,
  matrixRoomId,
  matrixEventId,
  physicalRecords,
  page = 1,
  pageSize = ROUTEC_UNIFIED_TOOL_DETAIL_PAGE_SIZE,
  selectedDetailLimitBytes = ROUTEC_UNIFIED_TOOL_DETAIL_SELECTED_LIMIT_BYTES,
}) {
  const normalizedPage = normalizePositiveInteger(page) || 1;
  const normalizedPageSize = normalizePositiveInteger(pageSize) ||
    ROUTEC_UNIFIED_TOOL_DETAIL_PAGE_SIZE;
  const records = physicalRecords
    .filter(Boolean)
    .sort(
      (left, right) =>
        (left.physical_event_index || Number.MAX_SAFE_INTEGER) -
        (right.physical_event_index || Number.MAX_SAFE_INTEGER)
    );
  const invocations = new Map();
  for (const record of records) {
    const toolCallId = record.tool_call_id ||
      `incomplete:${record.physical_event_index || invocations.size + 1}`;
    const turnId = record.provider_turn_id || record.target_turn_id || "unknown-turn";
    const key = `${turnId}\u001f${toolCallId}`;
    let invocation = invocations.get(key);
    if (!invocation) {
      invocation = {
        tool_call_id: toolCallId,
        tool_name: record.tool_name,
        provider: record.provider,
        provider_turn_id: record.provider_turn_id,
        target_turn_id: record.target_turn_id,
        first_event_sequence: record.physical_event_index,
        last_event_sequence: record.physical_event_index,
        records: [],
      };
      invocations.set(key, invocation);
    }
    invocation.records.push(record);
    invocation.tool_name ||= record.tool_name;
    invocation.provider ||= record.provider;
    invocation.provider_turn_id ||= record.provider_turn_id;
    invocation.target_turn_id ||= record.target_turn_id;
    invocation.last_event_sequence = record.physical_event_index;
  }
  const logicalInvocations = [...invocations.values()]
    .sort((left, right) => left.first_event_sequence - right.first_event_sequence)
    .map((invocation) =>
      finalizeInvocation(invocation, selectedDetailLimitBytes)
    );
  const pageCount = Math.max(1, Math.ceil(logicalInvocations.length / normalizedPageSize));
  const pageStart = (normalizedPage - 1) * normalizedPageSize;
  const selected = logicalInvocations.slice(pageStart, pageStart + normalizedPageSize);
  return {
    status: "ok",
    schema_version: ROUTEC_UNIFIED_TOOL_DETAIL_SCHEMA_VERSION,
    session_id: sessionId,
    matrix_room_id: matrixRoomId,
    matrix_event_id: matrixEventId,
    page: normalizedPage,
    page_size: normalizedPageSize,
    page_count: pageCount,
    physical_event_count: records.length,
    logical_invocation_count: logicalInvocations.length,
    selected_detail_top_only: true,
    selected_detail_limit_bytes: selectedDetailLimitBytes,
    selected_detail_truncated: selected.some(
      (invocation) => invocation.selected_detail_truncated
    ),
    invocations: selected,
    storage_sources: [...new Set(records.map((record) => record.source))],
    physical_event_order_preserved: true,
    aggregation_key: "provider_turn_id/target_turn_id + tool_call_id",
    resolver_path_fields_exposed: false,
    tool_payload_local_paths_preserved: true,
  };
}
