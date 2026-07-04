import { createHash } from "crypto";
import { buildOysterunSemanticMatrixContent } from "./matrix-event-writer.mjs";

export const ROUTEC_HOST2_INTAKE_STATES = Object.freeze({
  CONFIGURED: "configured",
  MATRIX_COMMITTED: "matrix_committed",
  HOST2_QUEUED: "host2_queued",
  CANCELED: "canceled",
  AGENT_TURN_STARTING: "agent_turn_starting",
  AGENT_TURN_STARTED: "agent_turn_started",
  COMPLETED: "completed",
});

export const ROUTEC_CANCEL_OUTCOMES = Object.freeze({
  ACCEPTED: "accepted",
  TOO_LATE_TO_CANCEL: "too_late_to_cancel",
  ALREADY_CANCELED: "already_canceled",
  ALREADY_COMPLETED: "already_completed",
  NOT_FOUND: "not_found",
  INTERNAL_ERROR: "internal_error",
});

export const ROUTEC_REQUIRED_DELIVERY_PROOF_COLUMNS = Object.freeze([
  "matrix_event_id",
  "event_id_kind",
  "host_session_id",
  "matrix_room_id",
  "host2_receipt_seen",
  "host2_receipt_user_id",
  "host2_receipt_target_event_id",
  "host2_intake_state",
  "agent_turn_started",
  "provider_turn_id",
  "provider_turn_id_kind",
  "cancelable",
  "cancel_request_id",
  "cancel_outcome",
  "provider_received_event",
  "provider_started_event",
  "same_event_both_canceled_and_started",
  "duplicate_user_row_count",
]);

const FORBIDDEN_PROVIDER_TURN_ID_KINDS = new Set([
  "deterministic_host2_delivery_claim_id",
]);

const ALLOWED_STATE_TRANSITIONS = Object.freeze({
  [ROUTEC_HOST2_INTAKE_STATES.CONFIGURED]: Object.freeze([
    ROUTEC_HOST2_INTAKE_STATES.MATRIX_COMMITTED,
  ]),
  [ROUTEC_HOST2_INTAKE_STATES.MATRIX_COMMITTED]: Object.freeze([
    ROUTEC_HOST2_INTAKE_STATES.HOST2_QUEUED,
  ]),
  [ROUTEC_HOST2_INTAKE_STATES.HOST2_QUEUED]: Object.freeze([
    ROUTEC_HOST2_INTAKE_STATES.CANCELED,
    ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTING,
  ]),
  [ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTING]: Object.freeze([
    ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTED,
  ]),
  [ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTED]: Object.freeze([
    ROUTEC_HOST2_INTAKE_STATES.COMPLETED,
  ]),
  [ROUTEC_HOST2_INTAKE_STATES.CANCELED]: Object.freeze([]),
  [ROUTEC_HOST2_INTAKE_STATES.COMPLETED]: Object.freeze([]),
});

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function stableHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function hashRouteCEventId(eventId) {
  return eventId
    ? createHash("sha256").update(String(eventId)).digest("hex")
    : null;
}

export function hashMatrixContent(content) {
  return stableHash(content);
}

function ensureStateHistory(record, now) {
  if (Array.isArray(record.host2_state_transition_history)) return;
  record.host2_state_transition_history = [
    {
      from: null,
      to:
        record.host2_state_machine_state ||
        ROUTEC_HOST2_INTAKE_STATES.CONFIGURED,
      at: now,
      reason: "state_machine_initialized",
    },
  ];
}

export function transitionHost2IntakeState(
  record,
  nextState,
  { reason = "state_transition", now = new Date().toISOString() } = {}
) {
  if (!record || typeof record !== "object") {
    throw new Error("Route C Host2 state transition requires a record");
  }
  if (!Object.values(ROUTEC_HOST2_INTAKE_STATES).includes(nextState)) {
    throw new Error(
      `Unsupported Route C Host2 state: ${nextState || "missing"}`
    );
  }
  const current =
    record.host2_state_machine_state || ROUTEC_HOST2_INTAKE_STATES.CONFIGURED;
  ensureStateHistory(record, now);
  if (current === nextState) {
    record.host2_state_transition_history.push({
      from: current,
      to: nextState,
      at: now,
      reason,
      idempotent: true,
    });
    return record;
  }
  const allowed = ALLOWED_STATE_TRANSITIONS[current] || [];
  if (!allowed.includes(nextState)) {
    throw new Error(
      `Forbidden Route C Host2 transition: ${current} -> ${nextState}`
    );
  }
  record.host2_state_machine_state = nextState;
  record.host2_state_transition_history.push({
    from: current,
    to: nextState,
    at: now,
    reason,
  });
  return record;
}

function findRecord(
  records,
  targetEventId,
  hostSessionId = null,
  matrixRoomId = null
) {
  if (!records) return null;
  const matches = (record) =>
    (record.source_user_event_id === targetEventId ||
      record.server_event_id === targetEventId) &&
    (!hostSessionId || record.host_session_id === hostSessionId) &&
    (!matrixRoomId || record.matrix_room_id === matrixRoomId);
  if (records instanceof Map)
    return [...records.values()].find(matches) || null;
  if (Array.isArray(records)) return records.find(matches) || null;
  if (typeof records === "object") return matches(records) ? records : null;
  return null;
}

export function snapshotHost2IntakeState({
  records = null,
  record = null,
  targetEventId,
  hostSessionId = null,
  matrixRoomId = null,
} = {}) {
  const current =
    record || findRecord(records, targetEventId, hostSessionId, matrixRoomId);
  if (!current) {
    return {
      status: "not_found",
      target_event_id: targetEventId || null,
      current_target_event_proof: false,
      stale_candidate_used: false,
      phase1_pass_claimed: false,
    };
  }
  const targetMatches =
    (current.source_user_event_id === targetEventId ||
      current.server_event_id === targetEventId) &&
    (!hostSessionId || current.host_session_id === hostSessionId) &&
    (!matrixRoomId || current.matrix_room_id === matrixRoomId);
  return {
    status: targetMatches ? "current_target_event_proof" : "target_mismatch",
    current_target_event_proof: targetMatches,
    stale_candidate_used: false,
    matrix_event_id:
      current.source_user_event_id || current.server_event_id || null,
    event_id_kind:
      current.source_user_event_id || current.server_event_id ? "server" : null,
    host_session_id: current.host_session_id || null,
    matrix_room_id: current.matrix_room_id || null,
    host2_state_machine_state: current.host2_state_machine_state || null,
    host2_intake_state: current.host2_intake_state || null,
    agent_turn_started: current.agent_turn_started === true,
    cancelable: current.cancelable === true,
    cancel_outcome: current.cancel_outcome || null,
    provider_turn_id: current.provider_turn_id || null,
    provider_turn_id_kind: current.provider_turn_id_kind || null,
    same_event_both_canceled_and_started:
      current.same_event_both_canceled_and_started === true ||
      current.same_event_canceled_and_started === true,
    duplicate_user_row_count: Number.isFinite(
      Number(current.duplicate_user_row_count)
    )
      ? Number(current.duplicate_user_row_count)
      : null,
    phase1_pass_claimed: false,
    closeout_readiness_claimed: false,
  };
}

export function attemptCancelTargetEvent({
  records,
  targetEventId,
  hostSessionId = null,
  matrixRoomId = null,
  controlRequestId = null,
  requestedBy = "oysterun-ui",
  now = new Date().toISOString(),
} = {}) {
  const record = findRecord(
    records,
    targetEventId,
    hostSessionId,
    matrixRoomId
  );
  if (!record) {
    return {
      outcome: ROUTEC_CANCEL_OUTCOMES.NOT_FOUND,
      status: "not_found",
      control_request_id: controlRequestId || null,
      requested_by: requestedBy,
      proof: snapshotHost2IntakeState({
        targetEventId,
        hostSessionId,
        matrixRoomId,
      }),
    };
  }
  if (
    record.host2_state_machine_state === ROUTEC_HOST2_INTAKE_STATES.CANCELED
  ) {
    record.cancel_outcome =
      record.cancel_outcome || ROUTEC_CANCEL_OUTCOMES.ALREADY_CANCELED;
    return {
      outcome: ROUTEC_CANCEL_OUTCOMES.ALREADY_CANCELED,
      status: "already_canceled",
      control_request_id: controlRequestId || record.control_request_id || null,
      requested_by: requestedBy,
      proof: snapshotHost2IntakeState({ record, targetEventId }),
    };
  }
  if (
    record.host2_state_machine_state === ROUTEC_HOST2_INTAKE_STATES.COMPLETED
  ) {
    record.cancel_outcome = ROUTEC_CANCEL_OUTCOMES.ALREADY_COMPLETED;
    return {
      outcome: ROUTEC_CANCEL_OUTCOMES.ALREADY_COMPLETED,
      status: "already_completed",
      control_request_id: controlRequestId || record.control_request_id || null,
      requested_by: requestedBy,
      proof: snapshotHost2IntakeState({ record, targetEventId }),
    };
  }
  if (
    record.host2_state_machine_state ===
      ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTING ||
    record.host2_state_machine_state ===
      ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTED ||
    record.agent_turn_started === true
  ) {
    record.cancelable = false;
    record.cancel_outcome = ROUTEC_CANCEL_OUTCOMES.TOO_LATE_TO_CANCEL;
    record.control_outcome = ROUTEC_CANCEL_OUTCOMES.TOO_LATE_TO_CANCEL;
    return {
      outcome: ROUTEC_CANCEL_OUTCOMES.TOO_LATE_TO_CANCEL,
      status: "too_late_to_cancel",
      control_request_id: controlRequestId || record.control_request_id || null,
      requested_by: requestedBy,
      proof: snapshotHost2IntakeState({ record, targetEventId }),
    };
  }
  try {
    transitionHost2IntakeState(record, ROUTEC_HOST2_INTAKE_STATES.CANCELED, {
      now,
      reason: "atomic_cancel_current_state_reread_commit",
    });
    record.host2_intake_state = ROUTEC_HOST2_INTAKE_STATES.CANCELED;
    record.cancelable = false;
    record.cancel_outcome = ROUTEC_CANCEL_OUTCOMES.ACCEPTED;
    record.control_outcome = ROUTEC_CANCEL_OUTCOMES.ACCEPTED;
    record.control_request_id =
      controlRequestId ||
      record.control_request_id ||
      `routec_cancel_${stableHash({
        target_event_id: targetEventId,
        requested_by: requestedBy,
        now,
      }).slice(0, 32)}`;
    record.provider_delivery_blocked_reason =
      "host2_queued_canceled_before_provider_delivery";
    record.provider_delivery_attempted = false;
    record.provider_delivery_permitted = false;
    record.provider_delivery_claimed = false;
    record.provider_received_event = false;
    record.provider_started_event = false;
    return {
      outcome: ROUTEC_CANCEL_OUTCOMES.ACCEPTED,
      status: "cancel_accepted",
      control_request_id: record.control_request_id,
      requested_by: requestedBy,
      proof: snapshotHost2IntakeState({ record, targetEventId }),
    };
  } catch (error) {
    return {
      outcome: ROUTEC_CANCEL_OUTCOMES.INTERNAL_ERROR,
      status: "internal_error",
      control_request_id: controlRequestId || record.control_request_id || null,
      requested_by: requestedBy,
      error: error.message,
      proof: snapshotHost2IntakeState({ record, targetEventId }),
    };
  }
}

function semanticId(semanticType, record, controlRequestId, outcome = null) {
  return `${semanticType.replace(/[^a-z0-9]+/gi, "_")}_${stableHash({
    semantic_type: semanticType,
    control_request_id: controlRequestId,
    outcome,
    target_event_id: record.source_user_event_id || record.server_event_id,
  }).slice(0, 32)}`;
}

export function buildCancelRequestSemantic({
  record,
  controlRequestId,
  requestedBy = "oysterun-ui",
}) {
  if (!record) {
    throw new Error("Route C cancel request semantic requires a record");
  }
  const targetEventId = record.source_user_event_id || record.server_event_id;
  const semanticType = "control.cancel.request";
  return buildOysterunSemanticMatrixContent({
    semanticType,
    category: semanticType,
    body: `Route C cancel requested for Matrix event ${
      targetEventId || "unknown"
    }.`,
    semanticId: semanticId(semanticType, record, controlRequestId, "requested"),
    lifecycle: "cancel_request_committed",
    correlation: {
      target_event_id: targetEventId,
      target_event_id_kind: targetEventId ? "server" : null,
      target_user_event_id: targetEventId,
      target_user_event_id_hash: hashRouteCEventId(targetEventId),
      target_user_event_id_hash_kind: targetEventId
        ? "raw_event_id_sha256"
        : null,
      source_user_event_id: targetEventId,
      source_user_event_id_hash: hashRouteCEventId(targetEventId),
      source_user_event_id_hash_kind: targetEventId
        ? "raw_event_id_sha256"
        : null,
      host_session_id: record.host_session_id,
      matrix_room_id: record.matrix_room_id,
      requested_by: requestedBy,
      client_request_id: controlRequestId,
      control_request_id: controlRequestId,
      provider_turn_id: record.provider_turn_id || null,
      provider_turn_id_kind: record.provider_turn_id_kind || null,
      direct_matrix_harness_write_used: false,
      phase1_pass_claimed: false,
      closeout_readiness_claimed: false,
    },
  });
}

export function buildCancelOutcomeSemantic({
  record,
  controlRequestId,
  outcome,
  reason = null,
}) {
  if (!record) {
    throw new Error("Route C cancel outcome semantic requires a record");
  }
  const targetEventId = record.source_user_event_id || record.server_event_id;
  const semanticType = "control.cancel.outcome";
  return buildOysterunSemanticMatrixContent({
    semanticType,
    category: semanticType,
    body: `Route C cancel outcome ${outcome || "unknown"} for Matrix event ${
      targetEventId || "unknown"
    }.`,
    semanticId: semanticId(semanticType, record, controlRequestId, outcome),
    lifecycle: "cancel_outcome_committed",
    correlation: {
      target_event_id: targetEventId,
      target_event_id_kind: targetEventId ? "server" : null,
      target_user_event_id: targetEventId,
      target_user_event_id_hash: hashRouteCEventId(targetEventId),
      target_user_event_id_hash_kind: targetEventId
        ? "raw_event_id_sha256"
        : null,
      source_user_event_id: targetEventId,
      source_user_event_id_hash: hashRouteCEventId(targetEventId),
      source_user_event_id_hash_kind: targetEventId
        ? "raw_event_id_sha256"
        : null,
      host_session_id: record.host_session_id,
      matrix_room_id: record.matrix_room_id,
      client_request_id: controlRequestId,
      control_request_id: controlRequestId,
      outcome,
      cancel_outcome: outcome,
      control_outcome: outcome,
      agent_turn_started: record.agent_turn_started === true,
      host2_intake_state:
        record.host2_intake_state || record.host2_state_machine_state || null,
      provider_turn_id: record.provider_turn_id || null,
      provider_turn_id_kind: record.provider_turn_id_kind || null,
      provider_received_event: record.provider_received_event === true,
      provider_started_event:
        record.provider_started_event === true ||
        record.agent_turn_started === true,
      provider_receives_canceled_user_event:
        record.provider_received_event === true,
      reason,
      same_event_both_canceled_and_started:
        record.same_event_both_canceled_and_started === true ||
        record.same_event_canceled_and_started === true,
      direct_matrix_harness_write_used: false,
      phase1_pass_claimed: false,
      closeout_readiness_claimed: false,
    },
  });
}

export function proveProviderNonReceipt({ record, targetEventId = null } = {}) {
  if (!record) {
    throw new Error("Route C provider non-receipt proof requires a record");
  }
  const eventId =
    targetEventId || record.source_user_event_id || record.server_event_id;
  const canceled =
    record.cancel_outcome === ROUTEC_CANCEL_OUTCOMES.ACCEPTED ||
    record.host2_state_machine_state === ROUTEC_HOST2_INTAKE_STATES.CANCELED;
  return {
    target_event_id: eventId,
    target_event_id_kind: eventId ? "server" : null,
    provider_id: record.provider_id || null,
    provider_received_event: canceled
      ? false
      : record.provider_received_event === true,
    provider_started_event: canceled
      ? false
      : record.provider_started_event === true ||
        record.agent_turn_started === true,
    provider_receives_canceled_user_event: canceled ? false : null,
    phase1_pass_claimed: false,
  };
}

export function renderCancelControlForTarget(proof) {
  const targetEventId =
    proof?.host2_receipt_target_event_id ||
    proof?.matrix_server_event_id ||
    proof?.source_user_event_id;
  const exactServerTarget =
    Boolean(targetEventId) &&
    proof?.host2_receipt_exact_user_event === true &&
    proof?.source_user_event_id_raw_hash_kind === "raw_event_id_sha256";
  const visible =
    exactServerTarget &&
    proof?.host2_intake_state === ROUTEC_HOST2_INTAKE_STATES.HOST2_QUEUED &&
    proof?.cancelable === true &&
    proof?.agent_turn_started === false;
  return {
    visible,
    enabled: visible,
    target_event_id: targetEventId || null,
    target_event_id_kind: exactServerTarget ? "server" : null,
    stale_target_event_id_used: false,
    dom_only_pass_state: false,
  };
}

export function collectDeliveryProofForTarget({
  record,
  proof = null,
  targetEventId,
  requiredColumns = ROUTEC_REQUIRED_DELIVERY_PROOF_COLUMNS,
} = {}) {
  const source = proof || snapshotHost2IntakeState({ record, targetEventId });
  const providerProof = record
    ? proveProviderNonReceipt({ record, targetEventId })
    : {};
  const output = {
    matrix_event_id: source.matrix_event_id || targetEventId || null,
    event_id_kind: source.event_id_kind || (targetEventId ? "server" : null),
    host_session_id: source.host_session_id || record?.host_session_id || null,
    matrix_room_id: source.matrix_room_id || record?.matrix_room_id || null,
    host2_receipt_seen:
      record?.host2_receipt_seen === true ||
      source.current_target_event_proof === true,
    host2_receipt_user_id: record?.host2_receipt_user_id || null,
    host2_receipt_target_event_id:
      record?.host2_receipt_target_event_id || source.matrix_event_id || null,
    host2_intake_state:
      source.host2_intake_state || record?.host2_intake_state || null,
    agent_turn_started:
      source.agent_turn_started === true || record?.agent_turn_started === true,
    provider_turn_id:
      source.provider_turn_id || record?.provider_turn_id || null,
    provider_turn_id_kind:
      source.provider_turn_id_kind || record?.provider_turn_id_kind || null,
    cancelable: source.cancelable === true || record?.cancelable === true,
    cancel_request_id: record?.control_request_id || null,
    cancel_outcome: source.cancel_outcome || record?.cancel_outcome || null,
    provider_received_event: providerProof.provider_received_event ?? null,
    provider_started_event: providerProof.provider_started_event ?? null,
    same_event_both_canceled_and_started:
      source.same_event_both_canceled_and_started === true ||
      record?.same_event_both_canceled_and_started === true,
    duplicate_user_row_count:
      source.duplicate_user_row_count ??
      record?.duplicate_user_row_count ??
      null,
    phase1_pass_claimed: false,
    closeout_readiness_claimed: false,
  };
  if (FORBIDDEN_PROVIDER_TURN_ID_KINDS.has(output.provider_turn_id_kind)) {
    throw new Error(
      `Forbidden proof id kind used as provider_turn_id_kind: ${output.provider_turn_id_kind}`
    );
  }
  output.required_columns_present = requiredColumns.every((column) =>
    Object.prototype.hasOwnProperty.call(output, column)
  );
  output.missing_required_columns = requiredColumns.filter(
    (column) => !Object.prototype.hasOwnProperty.call(output, column)
  );
  return output;
}
