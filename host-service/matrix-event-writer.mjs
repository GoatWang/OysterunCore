import { createHash, randomUUID } from "crypto";
import { COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER } from "./provider-completion-notification-contract.mjs";

export const OYSTERUN_SEMANTIC_NAMESPACE = "org.oysterun.semantic.v1";
export const ROUTEC_RAW_EVENT_ID_HASH_KIND = "raw_event_id_sha256";

export const OYSTERUN_SEMANTIC_CATEGORIES = Object.freeze([
  "message.user",
  "message.assistant",
  "thinking.reasoning",
  "tool.call",
  "tool.update",
  "tool.output",
  "tool.result",
  "tool.failure",
  "control.request",
  "control.outcome",
  "control.cancel.request",
  "control.cancel.outcome",
  "terminal.command.started",
  "terminal.command.result",
  "runtime.error",
  "session_lifecycle",
  "outbox.delivery",
  "ambiguous.stalled",
]);

export const OYSTERUN_CANCEL_OUTCOMES = Object.freeze([
  "accepted",
  "too_late_to_cancel",
  "already_canceled",
  "already_completed",
  "not_found",
  "timeout",
  "internal_error",
  "host2_intake_not_found",
  "matrix_event_not_stable_for_cancel",
  "host2_intake_not_cancelable",
]);

export const OYSTERUN_CONTROL_KINDS = Object.freeze([
  "command",
  "patch",
  "permissions",
  "user_input",
  "mcp_elicitation",
  "exit_plan",
  "stop",
  "interrupt",
  "resume",
  "cancel",
]);

export const OYSTERUN_CONTROL_OUTCOMES = Object.freeze([
  "accepted",
  "rejected",
  "noop",
  "timeout",
  "too_late",
  "already_completed",
  "already_canceled",
  "not_found",
  "failed",
]);

const OYSTERUN_PROVIDER_CONTROL_KINDS = new Set([
  "command",
  "patch",
  "permissions",
  "user_input",
  "mcp_elicitation",
  "exit_plan",
]);

const OYSTERUN_SESSION_CONTROL_KINDS = new Set([
  "stop",
  "interrupt",
  "resume",
  "cancel",
]);

const CONTROL_KIND_COMPATIBILITY_MAP = new Map([
  ["command_execution", "command"],
  ["commandExecution", "command"],
  ["file_change", "patch"],
  ["fileChange", "patch"],
  ["permission", "permissions"],
  ["permissions_request", "permissions"],
  ["can_use_tool", "permissions"],
  ["user-input", "user_input"],
  ["mcp-elicitation", "mcp_elicitation"],
  ["exitplan", "exit_plan"],
  ["exit_plan_mode", "exit_plan"],
]);

const CONTROL_OUTCOME_COMPATIBILITY_MAP = new Map([
  ["approved", "accepted"],
  ["approve", "accepted"],
  ["allow", "accepted"],
  ["allowed", "accepted"],
  ["denied", "rejected"],
  ["deny", "rejected"],
  ["declined", "rejected"],
  ["disallow", "rejected"],
  ["too_late_to_cancel", "too_late"],
  ["internal_error", "failed"],
  ["host2_intake_not_cancelable", "failed"],
  ["matrix_event_not_stable_for_cancel", "failed"],
  ["host2_intake_not_found", "not_found"],
]);

function routeCSemanticHash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOptionalTerminalOutput(value) {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (value === null || value === undefined) return null;
  return String(value);
}

function normalizeOptionalFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeOptionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeOptionalJsonValue(value) {
  if (value === undefined || value === null) return null;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Route C semantic JSON payload is not serializable");
  }
  return JSON.parse(encoded);
}

const FORBIDDEN_PROVIDER_TURN_ID_KINDS = new Set([
  "deterministic_host2_delivery_claim_id",
]);
const FORBIDDEN_PROVIDER_TURN_ID_PREFIXES = Object.freeze([
  "oysterun_provider_response_",
]);

function normalizeProviderTurnId(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  if (
    FORBIDDEN_PROVIDER_TURN_ID_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix)
    )
  ) {
    throw new Error(
      `Forbidden proof id used as provider_turn_id: ${normalized}`
    );
  }
  return normalized;
}

function normalizeProviderTurnIdKind(value, providerTurnId) {
  if (!providerTurnId) return null;
  const normalized =
    normalizeOptionalString(value) || "provider_reported_turn_id";
  if (FORBIDDEN_PROVIDER_TURN_ID_KINDS.has(normalized)) {
    throw new Error(
      `Forbidden proof id kind used as provider_turn_id_kind: ${normalized}`
    );
  }
  return normalized;
}

function normalizeSemanticType(semanticType, category) {
  const candidate = semanticType || category;
  if (candidate === "control.cancel.request") return "control.request";
  if (candidate === "control.cancel.outcome") return "control.outcome";
  if (!OYSTERUN_SEMANTIC_CATEGORIES.includes(candidate)) {
    throw new Error(`Unsupported Route C semantic type: ${candidate}`);
  }
  return candidate;
}

function normalizeCancelOutcome(semanticType, value) {
  const normalized = normalizeOptionalString(value);
  if (semanticType !== "control.cancel.outcome") {
    return normalized;
  }
  if (!OYSTERUN_CANCEL_OUTCOMES.includes(normalized)) {
    throw new Error(
      `Unsupported Route C cancel outcome: ${normalized || "missing"}`
    );
  }
  return normalized;
}

function normalizeControlKind(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const mapped = CONTROL_KIND_COMPATIBILITY_MAP.get(normalized) || normalized;
  if (!OYSTERUN_CONTROL_KINDS.includes(mapped)) {
    throw new Error(`Unsupported Route C control kind: ${normalized}`);
  }
  return mapped;
}

function inferControlKind({
  semanticType,
  originalSemanticType,
  correlation,
  targetUserEventId,
}) {
  const explicit = normalizeControlKind(
    correlation.control_kind ||
      correlation.controlKind ||
      correlation.subtype ||
      correlation.request_subtype
  );
  if (explicit) return explicit;
  if (
    originalSemanticType === "control.cancel.request" ||
    originalSemanticType === "control.cancel.outcome" ||
    normalizeOptionalString(correlation.cancel_outcome) ||
    normalizeOptionalString(correlation.control_request_id)?.startsWith(
      "routec_cancel_"
    ) ||
    (semanticType === "control.request" &&
      targetUserEventId &&
      correlation.cancel_request === true)
  ) {
    return "cancel";
  }
  if (
    semanticType === "control.request" ||
    semanticType === "control.outcome"
  ) {
    throw new Error(
      `Route C ${semanticType} requires a supported control_kind`
    );
  }
  return null;
}

function normalizeControlFamily(value, controlKind) {
  const normalized = normalizeOptionalString(value);
  if (normalized) {
    if (normalized !== "provider_request" && normalized !== "session_control") {
      throw new Error(`Unsupported Route C control family: ${normalized}`);
    }
    return normalized;
  }
  if (!controlKind) return null;
  if (OYSTERUN_PROVIDER_CONTROL_KINDS.has(controlKind))
    return "provider_request";
  if (OYSTERUN_SESSION_CONTROL_KINDS.has(controlKind)) return "session_control";
  throw new Error(
    `Route C control family missing for unsupported control kind: ${controlKind}`
  );
}

function normalizeControlOrigin(value, controlKind, semanticType) {
  const normalized = normalizeOptionalString(value);
  if (normalized) {
    if (
      normalized !== "provider" &&
      normalized !== "user" &&
      normalized !== "host"
    ) {
      throw new Error(`Unsupported Route C control origin: ${normalized}`);
    }
    return normalized;
  }
  if (!controlKind) return null;
  if (semanticType === "control.outcome") return "host";
  return OYSTERUN_PROVIDER_CONTROL_KINDS.has(controlKind) ? "provider" : "user";
}

function normalizeControlOutcome(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const mapped =
    CONTROL_OUTCOME_COMPATIBILITY_MAP.get(normalized) || normalized;
  if (!OYSTERUN_CONTROL_OUTCOMES.includes(mapped)) {
    throw new Error(`Unsupported Route C control outcome: ${normalized}`);
  }
  return mapped;
}

function defaultAllowedActionsForControlKind(controlKind) {
  switch (controlKind) {
    case "command":
    case "patch":
    case "permissions":
    case "exit_plan":
      return ["accept", "reject"];
    case "user_input":
    case "mcp_elicitation":
      return ["submit", "reject"];
    case "stop":
      return ["stop"];
    case "interrupt":
      return ["interrupt"];
    case "resume":
      return ["resume"];
    case "cancel":
      return ["cancel"];
    default:
      return null;
  }
}

function normalizeAllowedActions(value, controlKind, semanticType) {
  const candidates = Array.isArray(value)
    ? value.map((entry) => normalizeOptionalString(entry)).filter(Boolean)
    : null;
  const actions = candidates?.length
    ? candidates
    : defaultAllowedActionsForControlKind(controlKind);
  if (
    semanticType === "control.request" &&
    (!actions || actions.length === 0)
  ) {
    throw new Error(
      `Route C control.request requires allowed_actions for ${
        controlKind || "unknown control kind"
      }`
    );
  }
  return actions;
}

function normalizeTargetId(correlation, targetUserEventId, providerTurnId) {
  return (
    normalizeOptionalString(correlation.target_id) ||
    normalizeOptionalString(correlation.targetId) ||
    normalizeOptionalString(correlation.target_event_id) ||
    targetUserEventId ||
    normalizeOptionalString(correlation.target_turn_id) ||
    providerTurnId ||
    normalizeOptionalString(correlation.control_request_id) ||
    normalizeOptionalString(correlation.host_session_id)
  );
}

function normalizeReplayPolicy(value, semanticType) {
  const normalized = normalizeOptionalString(value);
  if (normalized) return normalized;
  if (semanticType === "control.request") return "latest_state_only";
  if (semanticType === "control.outcome") return "always";
  if (semanticType === "terminal.command.started") return "always";
  if (semanticType === "terminal.command.result") return "always";
  return null;
}

function buildControlOutcomeId({
  correlation,
  controlRequestId,
  outcome,
  targetId,
}) {
  const explicit = normalizeOptionalString(correlation.control_outcome_id);
  if (explicit) return explicit;
  if (!controlRequestId || !outcome) return null;
  return `routec_control_outcome_${routeCSemanticHash(
    JSON.stringify({
      host_session_id: correlation.host_session_id || null,
      control_request_id: controlRequestId,
      outcome,
      target_id: targetId || null,
    })
  ).slice(0, 32)}`;
}

export function buildOysterunSemanticMatrixContent({
  semanticType = null,
  category,
  body,
  semanticId = null,
  lifecycle = "final",
  correlation = {},
}) {
  const originalSemanticType = semanticType || category;
  const normalizedSemanticType = normalizeSemanticType(semanticType, category);
  const resolvedSemanticId = semanticId || `routec_semantic_${randomUUID()}`;
  const resolvedBody =
    typeof body === "string" && body.trim() ? body : normalizedSemanticType;
  const sourceUserEventId = normalizeOptionalString(
    correlation.source_user_event_id
  );
  const targetUserEventId =
    normalizeOptionalString(correlation.target_user_event_id) ||
    normalizeOptionalString(correlation.target_event_id) ||
    (originalSemanticType?.startsWith("control.cancel.")
      ? sourceUserEventId
      : null);
  const providerTurnId = normalizeProviderTurnId(correlation.provider_turn_id);
  const providerTurnIdKind = normalizeProviderTurnIdKind(
    correlation.provider_turn_id_kind,
    providerTurnId
  );
  const providerCompletionMarker = normalizeOptionalString(
    correlation.provider_completion_marker
  );
  if (
    providerCompletionMarker &&
    providerCompletionMarker !== COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER
  ) {
    throw new Error(
      `Unsupported provider completion marker: ${providerCompletionMarker}`
    );
  }
  const providerCompletionTurnId = providerCompletionMarker
    ? normalizeProviderTurnId(
        correlation.provider_completion_turn_id || providerTurnId
      )
    : null;
  const cancelOutcome = normalizeCancelOutcome(
    normalizedSemanticType,
    correlation.cancel_outcome
  );
  const controlKind = inferControlKind({
    semanticType: normalizedSemanticType,
    originalSemanticType,
    correlation,
    targetUserEventId,
  });
  const controlFamily = normalizeControlFamily(
    correlation.control_family,
    controlKind
  );
  const controlOrigin = normalizeControlOrigin(
    correlation.control_origin,
    controlKind,
    normalizedSemanticType
  );
  const controlRequestId = normalizeOptionalString(
    correlation.control_request_id
  );
  if (normalizedSemanticType === "control.request" && !controlRequestId) {
    throw new Error("Route C control.request requires control_request_id");
  }
  if (normalizedSemanticType === "control.outcome" && !controlRequestId) {
    throw new Error("Route C control.outcome requires control_request_id");
  }
  const targetId = normalizeTargetId(
    correlation,
    targetUserEventId,
    providerTurnId
  );
  if (
    (normalizedSemanticType === "control.request" ||
      normalizedSemanticType === "control.outcome") &&
    !targetId
  ) {
    throw new Error(`Route C ${normalizedSemanticType} requires a target id`);
  }
  const controlOutcome = normalizeControlOutcome(
    correlation.outcome || correlation.control_outcome || cancelOutcome
  );
  if (normalizedSemanticType === "control.outcome" && !controlOutcome) {
    throw new Error("Route C control.outcome requires canonical outcome");
  }
  const controlOutcomeId = buildControlOutcomeId({
    correlation,
    controlRequestId,
    outcome: controlOutcome,
    targetId,
  });
  if (normalizedSemanticType === "control.outcome" && !controlOutcomeId) {
    throw new Error("Route C control.outcome requires control_outcome_id");
  }
  const actor =
    normalizeOptionalString(correlation.actor) ||
    (normalizedSemanticType === "control.outcome" ? "host" : null);
  if (normalizedSemanticType === "control.outcome" && !actor) {
    throw new Error("Route C control.outcome requires actor");
  }
  const allowedActions = normalizeAllowedActions(
    correlation.allowed_actions,
    controlKind,
    normalizedSemanticType
  );
  const durable =
    typeof correlation.durable === "boolean"
      ? correlation.durable
      : normalizedSemanticType === "control.request" ||
        normalizedSemanticType === "control.outcome" ||
        normalizedSemanticType === "terminal.command.started" ||
        normalizedSemanticType === "terminal.command.result"
      ? true
      : null;
  const replayPolicy = normalizeReplayPolicy(
    correlation.replay_policy,
    normalizedSemanticType
  );
  return {
    msgtype: "m.text",
    body: resolvedBody,
    [OYSTERUN_SEMANTIC_NAMESPACE]: {
      schema_version: 1,
      semantic_id: resolvedSemanticId,
      semantic_type: normalizedSemanticType,
      semantic_category: normalizedSemanticType,
      lifecycle,
      created_at:
        normalizeOptionalString(correlation.created_at) ||
        new Date().toISOString(),
      host_session_id: correlation.host_session_id || null,
      host_message_id:
        correlation.host_message_id || correlation.host_outbox_id || null,
      host_outbox_id: correlation.host_outbox_id || null,
      client_request_id: correlation.client_request_id || null,
      matrix_room_id: correlation.matrix_room_id || null,
      source_user_event_id: sourceUserEventId,
      source_user_event_id_hash: sourceUserEventId
        ? routeCSemanticHash(sourceUserEventId)
        : null,
      source_user_event_id_hash_kind: sourceUserEventId
        ? ROUTEC_RAW_EVENT_ID_HASH_KIND
        : null,
      target_user_event_id: targetUserEventId,
      target_user_event_id_hash: targetUserEventId
        ? routeCSemanticHash(targetUserEventId)
        : null,
      target_user_event_id_hash_kind: targetUserEventId
        ? ROUTEC_RAW_EVENT_ID_HASH_KIND
        : null,
      target_event_id: targetUserEventId,
      target_event_id_kind: targetUserEventId ? "server" : null,
      target_id: targetId,
      target_turn_id: normalizeOptionalString(correlation.target_turn_id),
      target_session_id:
        normalizeOptionalString(correlation.target_session_id) ||
        normalizeOptionalString(correlation.host_session_id),
      source_id:
        normalizeOptionalString(correlation.source_id) ||
        normalizeOptionalString(correlation.provider_id) ||
        "oysterun-host",
      source_label:
        normalizeOptionalString(correlation.source_label) ||
        "oysterun_host_control_semantic_writer",
      provider_id: correlation.provider_id || null,
      provider: correlation.provider || correlation.provider_id || null,
      provider_turn_id: providerTurnId,
      provider_turn_id_kind: providerTurnIdKind,
      semantic_contract:
        correlation.semantic_contract || "full_semantic_renderer_contract",
      cancel_outcome: cancelOutcome,
      control_request_id: controlRequestId,
      control_outcome_id: controlOutcomeId,
      control_outcome: controlOutcome,
      control_kind: controlKind,
      control_family: controlFamily,
      control_origin: controlOrigin,
      outcome: controlOutcome,
      actor,
      matrix_event_sender: normalizeOptionalString(
        correlation.matrix_event_sender
      ),
      matrix_event_sender_actor_key: normalizeOptionalString(
        correlation.matrix_event_sender_actor_key
      ),
      matrix_event_sender_actor_kind: normalizeOptionalString(
        correlation.matrix_event_sender_actor_kind
      ),
      matrix_event_sender_display_name: normalizeOptionalString(
        correlation.matrix_event_sender_display_name
      ),
      matrix_event_sender_source: normalizeOptionalString(
        correlation.matrix_event_sender_source
      ),
      matrix_sender_semantic_role_distinct: normalizeOptionalBoolean(
        correlation.matrix_sender_semantic_role_distinct
      ),
      tool_name: normalizeOptionalString(correlation.tool_name),
      tool_call_id: normalizeOptionalString(correlation.tool_call_id),
      tool_input: normalizeOptionalJsonValue(correlation.tool_input),
      tool_content: normalizeOptionalJsonValue(correlation.tool_content),
      tool_is_error: normalizeOptionalBoolean(correlation.tool_is_error),
      terminal_exec_id: normalizeOptionalString(correlation.terminal_exec_id),
      command: normalizeOptionalString(correlation.command),
      cwd: normalizeOptionalString(correlation.cwd),
      started_at: normalizeOptionalString(correlation.started_at),
      completed_at: normalizeOptionalString(correlation.completed_at),
      stdout: normalizeOptionalTerminalOutput(correlation.stdout),
      stderr: normalizeOptionalTerminalOutput(correlation.stderr),
      stdout_truncated: normalizeOptionalBoolean(correlation.stdout_truncated),
      stderr_truncated: normalizeOptionalBoolean(correlation.stderr_truncated),
      exit_code: normalizeOptionalFiniteNumber(correlation.exit_code),
      duration_ms: normalizeOptionalFiniteNumber(correlation.duration_ms),
      timed_out: normalizeOptionalBoolean(correlation.timed_out),
      interrupted: normalizeOptionalBoolean(correlation.interrupted),
      interrupt_reason: normalizeOptionalString(correlation.interrupt_reason),
      requested_by: normalizeOptionalString(correlation.requested_by),
      normal_message_user_sent: normalizeOptionalBoolean(
        correlation.normal_message_user_sent
      ),
      browser_shell_execution: normalizeOptionalBoolean(
        correlation.browser_shell_execution
      ),
      provider_delivery_attempted: normalizeOptionalBoolean(
        correlation.provider_delivery_attempted
      ),
      host_db_transcript_product_truth: normalizeOptionalBoolean(
        correlation.host_db_transcript_product_truth
      ),
      allowed_actions: allowedActions,
      durable,
      replay_policy: replayPolicy,
      body_fallback_present: resolvedBody.trim().length > 0,
      default_action: normalizeOptionalString(correlation.default_action),
      expires_at: normalizeOptionalString(correlation.expires_at),
      sensitive: normalizeOptionalBoolean(correlation.sensitive),
      noop_reason: normalizeOptionalString(correlation.noop_reason),
      timeout_reason: normalizeOptionalString(correlation.timeout_reason),
      too_late_reason: normalizeOptionalString(correlation.too_late_reason),
      already_completed_reason: normalizeOptionalString(
        correlation.already_completed_reason
      ),
      already_canceled_reason: normalizeOptionalString(
        correlation.already_canceled_reason
      ),
      failure_classification: normalizeOptionalString(
        correlation.failure_classification
      ),
      error_origin: normalizeOptionalString(correlation.error_origin),
      error_scope: normalizeOptionalString(correlation.error_scope),
      last_agent_message_present: normalizeOptionalBoolean(
        correlation.last_agent_message_present
      ),
      agent_turn_started: normalizeOptionalBoolean(
        correlation.agent_turn_started
      ),
      host2_intake_state: normalizeOptionalString(
        correlation.host2_intake_state
      ),
      provider_receives_canceled_user_event: normalizeOptionalBoolean(
        correlation.provider_receives_canceled_user_event
      ),
      provider_received_event: normalizeOptionalBoolean(
        correlation.provider_received_event
      ),
      provider_started_event: normalizeOptionalBoolean(
        correlation.provider_started_event
      ),
      provider_started_for_target_event: normalizeOptionalBoolean(
        correlation.provider_started_for_target_event ??
          correlation.provider_started_event
      ),
      same_event_both_canceled_and_started: normalizeOptionalBoolean(
        correlation.same_event_both_canceled_and_started
      ),
      duplicate_user_row_count: normalizeOptionalFiniteNumber(
        correlation.duplicate_user_row_count
      ),
      outbox_delivery_state: correlation.outbox_delivery_state || null,
      ambiguous_state: correlation.ambiguous_state || null,
      assistant_content_hash: routeCSemanticHash(resolvedBody),
      duplicate_assistant_row_count: null,
      provider_response_marker: correlation.provider_response_marker || null,
      provider_completion_marker: providerCompletionMarker,
      provider_completion_state: normalizeOptionalString(
        correlation.provider_completion_state
      ),
      provider_completion_status: normalizeOptionalString(
        correlation.provider_completion_status
      ),
      provider_completion_success: normalizeOptionalBoolean(
        correlation.provider_completion_success
      ),
      provider_completion_success_required: normalizeOptionalBoolean(
        correlation.provider_completion_success_required
      ),
      provider_completion_turn_id: providerCompletionTurnId,
      large_tool_notice: normalizeOptionalBoolean(
        correlation.large_tool_notice
      ),
      large_tool_notice_kind: normalizeOptionalString(
        correlation.large_tool_notice_kind
      ),
      consecutive_run_index: normalizeOptionalFiniteNumber(
        correlation.consecutive_run_index
      ),
      matrix_retained_tool_event_count: normalizeOptionalFiniteNumber(
        correlation.matrix_retained_tool_event_count
      ),
      tool_event_count_label: normalizeOptionalString(
        correlation.tool_event_count_label
      ),
      detail_available: normalizeOptionalBoolean(correlation.detail_available),
      search_indexed: normalizeOptionalBoolean(correlation.search_indexed),
      committed_transcript_truth: "matrix_room_timeline",
      renderer: "oysterun_semantic_renderer",
      direct_dom_injection: false,
      direct_cinny_store_injection: false,
      direct_host_send_used: false,
      direct_matrix_harness_write_used: false,
      screenshot_only_proof: false,
      readiness_claimed: false,
      foundation_pass_claimed: false,
      real_codex_e2e_claimed: false,
      full_provider_parity_claimed: false,
    },
  };
}

export function classifyOysterunSemanticContent(content) {
  if (!content || typeof content !== "object") {
    return {
      is_semantic: false,
      reason: "content_not_object",
    };
  }
  const payload = content[OYSTERUN_SEMANTIC_NAMESPACE];
  if (!payload || typeof payload !== "object") {
    return {
      is_semantic: false,
      reason: "semantic_namespace_absent",
    };
  }
  return {
    is_semantic: true,
    semantic_id: payload.semantic_id || null,
    semantic_type: payload.semantic_type || payload.semantic_category || null,
    semantic_category: payload.semantic_category || null,
    lifecycle: payload.lifecycle || null,
    schema_version: payload.schema_version ?? null,
    created_at: payload.created_at || null,
    host_session_id: payload.host_session_id || null,
    host_message_id: payload.host_message_id || null,
    matrix_room_id: payload.matrix_room_id || null,
    source_id: payload.source_id || null,
    source_label: payload.source_label || null,
    target_user_event_id: payload.target_user_event_id || null,
    target_user_event_id_hash: payload.target_user_event_id_hash || null,
    target_event_id: payload.target_event_id || null,
    target_event_id_kind: payload.target_event_id_kind || null,
    cancel_outcome: payload.cancel_outcome || null,
    control_request_id: payload.control_request_id || null,
    control_outcome_id: payload.control_outcome_id || null,
    control_kind: payload.control_kind || null,
    control_family: payload.control_family || null,
    control_origin: payload.control_origin || null,
    actor: payload.actor || null,
    matrix_event_sender: payload.matrix_event_sender || null,
    matrix_event_sender_actor_key:
      payload.matrix_event_sender_actor_key || null,
    matrix_event_sender_actor_kind:
      payload.matrix_event_sender_actor_kind || null,
    matrix_event_sender_display_name:
      payload.matrix_event_sender_display_name || null,
    matrix_event_sender_source: payload.matrix_event_sender_source || null,
    matrix_sender_semantic_role_distinct:
      payload.matrix_sender_semantic_role_distinct ?? null,
    allowed_actions: payload.allowed_actions || null,
    durable: payload.durable ?? null,
    replay_policy: payload.replay_policy || null,
    body_fallback_present: payload.body_fallback_present ?? null,
    outcome: payload.outcome || null,
    failure_classification: payload.failure_classification || null,
    error_origin: payload.error_origin || null,
    error_scope: payload.error_scope || null,
    last_agent_message_present: payload.last_agent_message_present ?? null,
    agent_turn_started: payload.agent_turn_started ?? null,
    host2_intake_state: payload.host2_intake_state || null,
    provider_receives_canceled_user_event:
      payload.provider_receives_canceled_user_event ?? null,
    provider_received_event: payload.provider_received_event ?? null,
    provider_started_event: payload.provider_started_event ?? null,
    provider_started_for_target_event:
      payload.provider_started_for_target_event ?? null,
    same_event_both_canceled_and_started:
      payload.same_event_both_canceled_and_started ?? null,
    duplicate_user_row_count: payload.duplicate_user_row_count ?? null,
    renderer: payload.renderer || null,
  };
}
