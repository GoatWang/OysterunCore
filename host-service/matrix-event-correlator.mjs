import { createHash, randomUUID } from "crypto";
import {
  readRouteCRuntimeProofJsonArtifact,
  writeRouteCRuntimeProofJsonArtifact,
} from "./routec-artifacts.mjs";
import {
  attemptCancelTargetEvent,
  buildCancelOutcomeSemantic,
  buildCancelRequestSemantic,
  collectDeliveryProofForTarget,
  proveProviderNonReceipt,
  ROUTEC_CANCEL_OUTCOMES,
  ROUTEC_HOST2_INTAKE_STATES,
  transitionHost2IntakeState,
} from "./routec-host2-intake-state.mjs";

const sendCorrelations = new Map();

const OYSTERUN_MATRIX_INTAKE_MARKER =
  "oysterun_matrix_correlated_host2_intake_cancelability";
const OYSTERUN_PROVIDER_RESPONSE_MARKER =
  "oysterun_provider_fake_response_matrix_semantic_event";
const OYSTERUN_SEMANTIC_NAMESPACE = "org.oysterun.semantic.v1";
export const ROUTEC_RAW_EVENT_ID_HASH_KIND = "raw_event_id_sha256";
export const ROUTEC_EVENT_ID_CONTENT_HASH_KIND =
  "hashMatrixContent_event_id_object";

const HOST2_INTAKE_STATES = Object.freeze({
  MATRIX_EVENT_PENDING: "matrix_event_pending",
  HOST2_QUEUED: "host2_queued",
  CANCELED: "canceled",
  AGENT_TURN_STARTING: "agent_turn_starting",
  AGENT_TURN_STARTED: "agent_turn_started",
  COMPLETED: "completed",
  TIMEOUT_FAIL_CLOSED: "timeout_fail_closed",
});

const HOST2_PROVIDER_BLOCKING_CANCEL_OUTCOMES = new Set([
  "accepted",
  "already_canceled",
  "canceled",
]);

const FORBIDDEN_PROVIDER_TURN_ID_KINDS = new Set([
  "deterministic_host2_delivery_claim_id",
]);

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

export function hashMatrixContent(content) {
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

export function hashRouteCEventId(eventId) {
  return eventId
    ? createHash("sha256").update(String(eventId)).digest("hex")
    : null;
}

function routeCEventIdHashProof(eventId) {
  return {
    raw_hash: hashRouteCEventId(eventId),
    raw_hash_kind: eventId ? ROUTEC_RAW_EVENT_ID_HASH_KIND : null,
    content_hash: eventId ? hashMatrixContent({ event_id: eventId }) : null,
    content_hash_kind: eventId ? ROUTEC_EVENT_ID_CONTENT_HASH_KIND : null,
  };
}

function routeCControlRequestId(record) {
  return `routec_cancel_${hashMatrixContent({
    host_session_id: record.host_session_id,
    matrix_room_id: record.matrix_room_id,
    server_event_id: record.server_event_id,
    created_at: record.created_at,
  }).slice(0, 32)}`;
}

function buildRouteCCancelSemanticEventSourceHook({
  record,
  semanticType,
  controlRequestId,
  outcome = null,
  status,
}) {
  const sourceUserEventId =
    record.source_user_event_id || record.server_event_id || null;
  const content =
    semanticType === "control.cancel.request"
      ? buildCancelRequestSemantic({
          record,
          controlRequestId,
          requestedBy: "oysterun-ui",
        })
      : buildCancelOutcomeSemantic({
          record,
          controlRequestId,
          outcome: outcome || record.cancel_outcome || null,
          reason: status,
        });
  return {
    status,
    semantic_type: semanticType,
    matrix_backed_semantic_source_hook: true,
    matrix_write_required_for_runtime_acceptance: true,
    endpoint_path: "/routec/matrix/semantic-events",
    target_event_id: sourceUserEventId,
    target_event_id_kind: sourceUserEventId ? "server" : null,
    control_request_id: controlRequestId,
    outcome: outcome || null,
    content,
    direct_matrix_harness_write_used: false,
    phase1_pass_claimed: false,
    closeout_readiness_claimed: false,
  };
}

function recordRouteCCancelSemanticHooks(record, outcome, status) {
  const controlRequestId =
    record.control_request_id || routeCControlRequestId(record);
  record.control_request_id = controlRequestId;
  record.control_outcome = outcome || status || null;
  record.cancel_request_semantic_event_source_hook =
    buildRouteCCancelSemanticEventSourceHook({
      record,
      semanticType: "control.cancel.request",
      controlRequestId,
      outcome: "requested",
      status: "cancel_request_source_hook_ready",
    });
  record.cancel_outcome_semantic_event_source_hook =
    buildRouteCCancelSemanticEventSourceHook({
      record,
      semanticType: "control.cancel.outcome",
      controlRequestId,
      outcome,
      status: "cancel_outcome_source_hook_ready",
    });
}

function assignRouteCSourceUserEventId(record, eventId) {
  const proof = routeCEventIdHashProof(eventId);
  record.source_user_event_id = eventId || null;
  record.source_user_event_id_hash = proof.content_hash;
  record.source_user_event_id_hash_kind = proof.content_hash_kind;
  record.source_user_event_id_raw_hash = proof.raw_hash;
  record.source_user_event_id_raw_hash_kind = proof.raw_hash_kind;
  record.source_user_event_id_content_hash = proof.content_hash;
  record.source_user_event_id_content_hash_kind = proof.content_hash_kind;
}

function assignRouteCAssistantSemanticEventId(record, eventId) {
  const proof = routeCEventIdHashProof(eventId);
  record.assistant_semantic_event_id = eventId || null;
  record.assistant_semantic_event_id_hash = proof.content_hash;
  record.assistant_semantic_event_id_hash_kind = proof.content_hash_kind;
  record.assistant_semantic_event_id_raw_hash = proof.raw_hash;
  record.assistant_semantic_event_id_raw_hash_kind = proof.raw_hash_kind;
  record.assistant_semantic_event_id_content_hash = proof.content_hash;
  record.assistant_semantic_event_id_content_hash_kind =
    proof.content_hash_kind;
}

export function registerRouteCOutboxCorrelation({
  hostSessionId,
  matrixUserId = null,
  matrixRoomId,
  txnId,
  eventType,
  clientRequestId = null,
  clientContent,
}) {
  if (!hostSessionId)
    throw new Error("hostSessionId required for Route C outbox correlation");
  if (!matrixRoomId)
    throw new Error("matrixRoomId required for Route C outbox correlation");
  if (!txnId) throw new Error("txnId required for Route C outbox correlation");
  const correlationId = clientRequestId || `routec_${randomUUID()}`;
  const key = `${matrixRoomId}::${txnId}`;
  const record = {
    host_session_id: hostSessionId,
    matrix_user_id: matrixUserId,
    matrix_room_id: matrixRoomId,
    txnId,
    client_request_id: correlationId,
    host_outbox_id: correlationId,
    event_type: eventType,
    local_event_id: `local_${txnId}`,
    server_event_id: null,
    remote_echo_event_id: null,
    client_content_hash: hashMatrixContent(clientContent),
    forwarded_content_hash: null,
    committed_content_hash: null,
    row_count_before_send: null,
    row_count_after_local_echo: null,
    row_count_after_send_response: null,
    row_count_after_sync: null,
    row_count_after_reload: null,
    duplicate_user_row_count: null,
    host2_receipt_seen: false,
    host2_receipt_user_id: null,
    host2_receipt_target_event_id: null,
    host2_receipt_is_agent_turn_started: false,
    host2_intake_state: HOST2_INTAKE_STATES.MATRIX_EVENT_PENDING,
    host2_intake_state_reason: "local_sending_before_matrix_confirmation",
    host2_queue_position: null,
    agent_turn_started: false,
    cancelable: false,
    cancel_outcome: null,
    canceled_at: null,
    too_late_to_cancel_at: null,
    agent_turn_starting_at: null,
    agent_turn_started_at: null,
    local_sending_before_matrix_confirmation_out_of_cancel_scope: true,
    single_check_matrix_committed_server_event_id: null,
    double_check_host2_receipt_seen: false,
    provider_busy: false,
    provider_busy_queue_policy:
      "queue_without_delivering_next_user_message_into_active_provider_session",
    provider_delivery_attempted: false,
    provider_delivery_permitted: false,
    provider_delivery_claimed: false,
    provider_delivery_claim_id: null,
    provider_delivery_blocked_reason: null,
    provider_delivery_error: null,
    provider_id: null,
    provider_turn_id: null,
    provider_turn_id_kind: null,
    next_user_message_delivered_to_active_provider_session: false,
    provider_response_marker: OYSTERUN_PROVIDER_RESPONSE_MARKER,
    source_user_event_id: null,
    source_user_event_id_hash: null,
    source_user_event_id_hash_kind: null,
    source_user_event_id_raw_hash: null,
    source_user_event_id_raw_hash_kind: null,
    source_user_event_id_content_hash: null,
    source_user_event_id_content_hash_kind: null,
    assistant_semantic_event_id: null,
    assistant_semantic_event_id_hash: null,
    assistant_semantic_event_id_hash_kind: null,
    assistant_semantic_event_id_raw_hash: null,
    assistant_semantic_event_id_raw_hash_kind: null,
    assistant_semantic_event_id_content_hash: null,
    assistant_semantic_event_id_content_hash_kind: null,
    assistant_semantic_txn_id: null,
    assistant_semantic_type: null,
    assistant_semantic_id: null,
    assistant_semantic_content_hash: null,
    assistant_body_hash: null,
    duplicate_assistant_row_count: null,
    assistant_delivery_state: null,
    same_event_canceled_and_started: false,
    host2_state_machine_state: ROUTEC_HOST2_INTAKE_STATES.CONFIGURED,
    host2_state_transition_history: [
      {
        from: null,
        to: ROUTEC_HOST2_INTAKE_STATES.CONFIGURED,
        at: new Date().toISOString(),
        reason: "matrix_outbox_correlation_configured",
      },
    ],
    control_request_id: null,
    control_outcome: null,
    cancel_request_semantic_event_source_hook: null,
    cancel_outcome_semantic_event_source_hook: null,
    host2_cancelability_marker: OYSTERUN_MATRIX_INTAKE_MARKER,
    foundation_pass_claimed: false,
    state: "local_echo_pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  sendCorrelations.set(key, record);
  writeRouteCHostOutboxCorrelationProof();
  writeRouteCHost2IntakeCancelabilityProof();
  return record;
}

export function recordRouteCSendResponse({
  matrixRoomId,
  txnId,
  responseBody,
  forwardedContent,
}) {
  const key = `${matrixRoomId}::${txnId}`;
  const record = sendCorrelations.get(key);
  if (!record) return null;
  record.server_event_id = responseBody?.event_id || null;
  record.forwarded_content_hash = hashMatrixContent(forwardedContent);
  record.state = record.server_event_id
    ? "send_response_received"
    : "send_response_missing_event_id";
  if (record.server_event_id) {
    transitionHost2IntakeState(
      record,
      ROUTEC_HOST2_INTAKE_STATES.MATRIX_COMMITTED,
      {
        reason: "matrix_server_event_committed",
      }
    );
    record.single_check_matrix_committed_server_event_id =
      record.server_event_id;
    recordRouteCHost2IntakeReceiptForRecord(record);
  }
  record.updated_at = new Date().toISOString();
  writeRouteCSendReconciliationTrace();
  writeRouteCHostOutboxCorrelationProof();
  return record;
}

function routeCHost2ActiveIntakeExists(hostSessionId, excludeServerEventId) {
  return [...sendCorrelations.values()].some(
    (entry) =>
      entry.host_session_id === hostSessionId &&
      entry.server_event_id !== excludeServerEventId &&
      (entry.host2_intake_state === HOST2_INTAKE_STATES.AGENT_TURN_STARTING ||
        entry.host2_intake_state === HOST2_INTAKE_STATES.AGENT_TURN_STARTED)
  );
}

function routeCHost2QueuedPosition(hostSessionId, serverEventId) {
  const queued = [...sendCorrelations.values()]
    .filter(
      (entry) =>
        entry.host_session_id === hostSessionId &&
        entry.host2_receipt_seen === true &&
        entry.host2_intake_state === HOST2_INTAKE_STATES.HOST2_QUEUED
    )
    .sort((left, right) =>
      String(left.updated_at).localeCompare(String(right.updated_at))
    );
  const index = queued.findIndex(
    (entry) => entry.server_event_id === serverEventId
  );
  return index >= 0 ? index + 1 : null;
}

function routeCHost2FindCorrelation({
  hostSessionId,
  matrixRoomId,
  serverEventId,
}) {
  if (!hostSessionId)
    throw new Error("hostSessionId required for Route C Host2 intake lookup");
  if (!matrixRoomId)
    throw new Error("matrixRoomId required for Route C Host2 intake lookup");
  if (!serverEventId)
    throw new Error("serverEventId required for Route C Host2 intake lookup");
  return (
    [...sendCorrelations.values()].find(
      (entry) =>
        entry.host_session_id === hostSessionId &&
        entry.matrix_room_id === matrixRoomId &&
        entry.server_event_id === serverEventId
    ) || null
  );
}

function assertRouteCHost2IntakeInvariant(record) {
  record.same_event_canceled_and_started =
    record.host2_intake_state === HOST2_INTAKE_STATES.CANCELED &&
    record.agent_turn_started === true;
  record.same_event_both_canceled_and_started =
    record.same_event_canceled_and_started;
  if (record.same_event_canceled_and_started) {
    throw new Error(
      `Route C Host2 intake invariant violated for Matrix event ${record.server_event_id}`
    );
  }
  if (
    record.host2_state_machine_state === ROUTEC_HOST2_INTAKE_STATES.CANCELED &&
    record.agent_turn_started === true
  ) {
    throw new Error(
      `Route C Host2 intake invariant violated for Matrix event ${record.server_event_id}`
    );
  }
}

function recordRouteCHost2IntakeReceiptForRecord(record) {
  if (!record.server_event_id) return null;
  if (HOST2_PROVIDER_BLOCKING_CANCEL_OUTCOMES.has(record.cancel_outcome)) {
    assertRouteCHost2IntakeInvariant(record);
    return buildRouteCHost2IntakeProof(record);
  }
  if (record.agent_turn_started === true) {
    assertRouteCHost2IntakeInvariant(record);
    return buildRouteCHost2IntakeProof(record);
  }

  record.host2_receipt_seen = true;
  record.host2_receipt_user_id = record.matrix_user_id || null;
  record.host2_receipt_target_event_id = record.server_event_id;
  record.host2_receipt_is_agent_turn_started = false;
  transitionHost2IntakeState(record, ROUTEC_HOST2_INTAKE_STATES.HOST2_QUEUED, {
    reason: "host2_exact_event_intake_queued",
  });
  record.host2_intake_state = HOST2_INTAKE_STATES.HOST2_QUEUED;
  record.host2_intake_state_reason =
    "matrix_committed_server_event_id_host2_intake_queued";
  record.double_check_host2_receipt_seen = true;
  record.agent_turn_started = false;
  record.cancelable = true;
  record.cancel_outcome = null;
  record.duplicate_user_row_count = 0;
  record.provider_busy = routeCHost2ActiveIntakeExists(
    record.host_session_id,
    record.server_event_id
  );
  record.provider_delivery_attempted = false;
  record.provider_delivery_permitted = false;
  record.next_user_message_delivered_to_active_provider_session = false;
  record.host2_queue_position = routeCHost2QueuedPosition(
    record.host_session_id,
    record.server_event_id
  );
  record.updated_at = new Date().toISOString();
  assertRouteCHost2IntakeInvariant(record);
  writeRouteCHost2IntakeCancelabilityProof();
  return buildRouteCHost2IntakeProof(record);
}

export function buildRouteCHost2IntakeProof(record) {
  if (!record) return null;
  const sourceUserEventId =
    record.source_user_event_id || record.server_event_id || null;
  const sourceUserEventHashProof = routeCEventIdHashProof(sourceUserEventId);
  const assistantSemanticEventHashProof = routeCEventIdHashProof(
    record.assistant_semantic_event_id
  );
  const cancelAccepted =
    record.host2_intake_state === HOST2_INTAKE_STATES.CANCELED &&
    HOST2_PROVIDER_BLOCKING_CANCEL_OUTCOMES.has(record.cancel_outcome);
  return {
    marker: OYSTERUN_MATRIX_INTAKE_MARKER,
    host_session_id: record.host_session_id,
    matrix_room_id: record.matrix_room_id,
    matrix_user_id: record.matrix_user_id || null,
    matrix_txn_id: record.txnId,
    client_request_id: record.client_request_id,
    host_outbox_id: record.host_outbox_id,
    client_content_hash: record.client_content_hash,
    forwarded_content_hash: record.forwarded_content_hash,
    committed_content_hash: record.committed_content_hash,
    matrix_server_event_id: record.server_event_id || null,
    host2_receipt_seen: record.host2_receipt_seen === true,
    host2_receipt_user_id: record.host2_receipt_user_id || null,
    host2_receipt_target_event_id: record.host2_receipt_target_event_id || null,
    host2_receipt_exact_user_event:
      record.host2_receipt_seen === true &&
      record.host2_receipt_target_event_id === record.server_event_id &&
      Boolean(record.host2_receipt_user_id),
    host2_receipt_is_agent_turn_started: false,
    host2_intake_state: record.host2_intake_state,
    host2_intake_state_reason: record.host2_intake_state_reason || null,
    host2_state_machine_state: record.host2_state_machine_state || null,
    host2_state_transition_history: Array.isArray(
      record.host2_state_transition_history
    )
      ? record.host2_state_transition_history
      : [],
    host2_queue_position: record.host2_queue_position,
    agent_turn_started: record.agent_turn_started === true,
    cancelable: record.cancelable === true,
    cancel_outcome: record.cancel_outcome || null,
    duplicate_user_row_count: record.duplicate_user_row_count,
    same_event_both_canceled_and_started:
      record.same_event_canceled_and_started === true,
    control_request_id: record.control_request_id || null,
    control_outcome: record.control_outcome || null,
    cancel_request_semantic_event_source_hook:
      record.cancel_request_semantic_event_source_hook || null,
    cancel_outcome_semantic_event_source_hook:
      record.cancel_outcome_semantic_event_source_hook || null,
    local_sending_before_matrix_confirmation_out_of_cancel_scope: true,
    single_check_matrix_committed_server_event_id:
      record.single_check_matrix_committed_server_event_id || null,
    double_check_host2_receipt_seen:
      record.double_check_host2_receipt_seen === true,
    provider_busy: record.provider_busy === true,
    provider_busy_queue_policy: record.provider_busy_queue_policy,
    provider_id: record.provider_id || null,
    provider_turn_id: record.provider_turn_id || null,
    provider_turn_id_kind: record.provider_turn_id_kind || null,
    provider_delivery_claimed: record.provider_delivery_claimed === true,
    provider_delivery_claim_id: record.provider_delivery_claim_id || null,
    provider_delivery_blocked_reason:
      record.provider_delivery_blocked_reason || null,
    provider_delivery_error: record.provider_delivery_error || null,
    provider_delivery_attempted: record.provider_delivery_attempted === true,
    provider_delivery_permitted: record.provider_delivery_permitted === true,
    next_user_message_delivered_to_active_provider_session:
      record.next_user_message_delivered_to_active_provider_session === true,
    provider_receives_canceled_user_event: cancelAccepted ? false : null,
    provider_received_event: proveProviderNonReceipt({ record })
      .provider_received_event,
    provider_started_event: proveProviderNonReceipt({ record })
      .provider_started_event,
    provider_response_marker: OYSTERUN_PROVIDER_RESPONSE_MARKER,
    source_user_event_id: sourceUserEventId,
    source_user_event_id_hash:
      record.source_user_event_id_hash || sourceUserEventHashProof.content_hash,
    source_user_event_id_hash_kind:
      record.source_user_event_id_hash_kind ||
      sourceUserEventHashProof.content_hash_kind,
    source_user_event_id_raw_hash:
      record.source_user_event_id_raw_hash || sourceUserEventHashProof.raw_hash,
    source_user_event_id_raw_hash_kind:
      record.source_user_event_id_raw_hash_kind ||
      sourceUserEventHashProof.raw_hash_kind,
    source_user_event_id_content_hash:
      record.source_user_event_id_content_hash ||
      record.source_user_event_id_hash ||
      sourceUserEventHashProof.content_hash,
    source_user_event_id_content_hash_kind:
      record.source_user_event_id_content_hash_kind ||
      record.source_user_event_id_hash_kind ||
      sourceUserEventHashProof.content_hash_kind,
    assistant_semantic_event_id: record.assistant_semantic_event_id || null,
    assistant_semantic_event_id_hash:
      record.assistant_semantic_event_id_hash ||
      assistantSemanticEventHashProof.content_hash,
    assistant_semantic_event_id_hash_kind:
      record.assistant_semantic_event_id_hash_kind ||
      assistantSemanticEventHashProof.content_hash_kind,
    assistant_semantic_event_id_raw_hash:
      record.assistant_semantic_event_id_raw_hash ||
      assistantSemanticEventHashProof.raw_hash,
    assistant_semantic_event_id_raw_hash_kind:
      record.assistant_semantic_event_id_raw_hash_kind ||
      assistantSemanticEventHashProof.raw_hash_kind,
    assistant_semantic_event_id_content_hash:
      record.assistant_semantic_event_id_content_hash ||
      record.assistant_semantic_event_id_hash ||
      assistantSemanticEventHashProof.content_hash,
    assistant_semantic_event_id_content_hash_kind:
      record.assistant_semantic_event_id_content_hash_kind ||
      record.assistant_semantic_event_id_hash_kind ||
      assistantSemanticEventHashProof.content_hash_kind,
    assistant_semantic_txn_id: record.assistant_semantic_txn_id || null,
    assistant_semantic_type: record.assistant_semantic_type || null,
    assistant_semantic_id: record.assistant_semantic_id || null,
    assistant_semantic_content_hash:
      record.assistant_semantic_content_hash || null,
    assistant_body_hash: record.assistant_body_hash || null,
    assistant_delivery_state: record.assistant_delivery_state || null,
    duplicate_assistant_row_count: record.duplicate_assistant_row_count,
    allowed_race_transitions: [
      "host2_queued->canceled",
      "host2_queued->agent_turn_starting->agent_turn_started",
    ],
    too_late_to_cancel_if_start_wins: true,
    same_event_canceled_and_started:
      record.same_event_canceled_and_started === true,
    canceled_at: record.canceled_at || null,
    too_late_to_cancel_at: record.too_late_to_cancel_at || null,
    agent_turn_starting_at: record.agent_turn_starting_at || null,
    agent_turn_started_at: record.agent_turn_started_at || null,
    foundation_pass_claimed: false,
    phase1_pass_claimed: false,
    closeout_readiness_claimed: false,
    delivery_proof_columns: collectDeliveryProofForTarget({
      record,
      targetEventId: sourceUserEventId,
    }),
  };
}

function routeCProviderDeliveryClaimId(record) {
  return `oysterun_provider_response_${hashMatrixContent({
    host_session_id: record.host_session_id,
    matrix_room_id: record.matrix_room_id,
    server_event_id: record.server_event_id,
  }).slice(0, 32)}`;
}

function applyCanonicalProviderTurnId(
  record,
  providerTurnId,
  providerTurnIdKind = null
) {
  const normalizedProviderTurnId =
    typeof providerTurnId === "string" && providerTurnId.trim()
      ? providerTurnId.trim()
      : typeof record.provider_turn_id === "string" &&
        record.provider_turn_id.trim()
      ? record.provider_turn_id.trim()
      : null;
  if (!normalizedProviderTurnId) {
    record.provider_turn_id = null;
    record.provider_turn_id_kind = null;
    return null;
  }
  const normalizedKind =
    typeof providerTurnIdKind === "string" && providerTurnIdKind.trim()
      ? providerTurnIdKind.trim()
      : typeof record.provider_turn_id_kind === "string" &&
        record.provider_turn_id_kind.trim()
      ? record.provider_turn_id_kind.trim()
      : "provider_reported_turn_id";
  if (FORBIDDEN_PROVIDER_TURN_ID_KINDS.has(normalizedKind)) {
    throw new Error(
      `Forbidden proof id kind used as provider_turn_id_kind: ${normalizedKind}`
    );
  }
  record.provider_turn_id = normalizedProviderTurnId;
  record.provider_turn_id_kind = normalizedKind;
  return normalizedProviderTurnId;
}

export function blockRouteCHost2IntakeProviderDelivery({
  hostSessionId,
  matrixRoomId,
  serverEventId,
  reason,
  providerId = null,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId,
  });
  if (!record) return null;
  record.provider_id = providerId || record.provider_id || null;
  record.provider_delivery_blocked_reason =
    reason || "provider_delivery_blocked";
  record.provider_delivery_permitted = false;
  record.provider_delivery_attempted = false;
  record.next_user_message_delivered_to_active_provider_session = false;
  record.updated_at = new Date().toISOString();
  assertRouteCHost2IntakeInvariant(record);
  writeRouteCHost2IntakeCancelabilityProof();
  writeRouteCProviderAssistantSemanticResponseProof();
  return buildRouteCHost2IntakeProof(record);
}

export function claimRouteCHost2IntakeForProviderDelivery({
  hostSessionId,
  matrixRoomId,
  serverEventId,
  providerId,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId,
  });
  if (!record) {
    return {
      claimed: false,
      status: "host2_intake_not_found",
      proof: null,
    };
  }
  if (
    record.host2_receipt_seen !== true ||
    record.host2_receipt_target_event_id !== serverEventId
  ) {
    record.provider_delivery_blocked_reason =
      "matrix_event_not_stable_for_provider_delivery";
    record.provider_delivery_permitted = false;
    record.updated_at = new Date().toISOString();
    writeRouteCHost2IntakeCancelabilityProof();
    writeRouteCProviderAssistantSemanticResponseProof();
    return {
      claimed: false,
      status: record.provider_delivery_blocked_reason,
      proof: buildRouteCHost2IntakeProof(record),
    };
  }
  if (
    record.host2_intake_state === HOST2_INTAKE_STATES.CANCELED ||
    HOST2_PROVIDER_BLOCKING_CANCEL_OUTCOMES.has(record.cancel_outcome)
  ) {
    record.provider_delivery_blocked_reason =
      "host2_queued_canceled_before_provider_delivery";
    record.provider_delivery_permitted = false;
    record.provider_delivery_attempted = false;
    record.next_user_message_delivered_to_active_provider_session = false;
    record.updated_at = new Date().toISOString();
    assertRouteCHost2IntakeInvariant(record);
    writeRouteCHost2IntakeCancelabilityProof();
    writeRouteCProviderAssistantSemanticResponseProof();
    return {
      claimed: false,
      status: record.provider_delivery_blocked_reason,
      proof: buildRouteCHost2IntakeProof(record),
    };
  }
  if (record.host2_intake_state !== HOST2_INTAKE_STATES.HOST2_QUEUED) {
    return {
      claimed: false,
      status: "host2_intake_already_claimed_or_not_queued",
      proof: buildRouteCHost2IntakeProof(record),
    };
  }

  const now = new Date().toISOString();
  transitionHost2IntakeState(
    record,
    ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTING,
    {
      now,
      reason: "provider_delivery_claimed_before_agent_turn_started",
    }
  );
  record.host2_intake_state = HOST2_INTAKE_STATES.AGENT_TURN_STARTING;
  record.host2_intake_state_reason =
    "host2_queued_won_cancel_race_provider_delivery_claimed";
  record.cancelable = false;
  record.provider_id = providerId || null;
  record.provider_delivery_claimed = true;
  record.provider_delivery_claim_id = routeCProviderDeliveryClaimId(record);
  record.provider_delivery_permitted = true;
  record.provider_delivery_attempted = true;
  record.provider_delivery_blocked_reason = null;
  record.agent_turn_starting_at = now;
  assignRouteCSourceUserEventId(record, record.server_event_id);
  record.updated_at = now;
  assertRouteCHost2IntakeInvariant(record);
  writeRouteCHost2IntakeCancelabilityProof();
  writeRouteCProviderAssistantSemanticResponseProof();
  return {
    claimed: true,
    status: "provider_delivery_claimed",
    claim_id: record.provider_delivery_claim_id,
    proof: buildRouteCHost2IntakeProof(record),
  };
}

export function getRouteCHost2IntakeProof({
  hostSessionId,
  matrixRoomId,
  serverEventId,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId,
  });
  return record ? buildRouteCHost2IntakeProof(record) : null;
}

export function cancelRouteCHost2IntakeForMatrixEvent({
  hostSessionId,
  matrixRoomId,
  serverEventId,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId,
  });
  if (!record) {
    return {
      status: 404,
      body: {
        error: "Route C Host2 intake record not found for Matrix event.",
        host_session_id: hostSessionId,
        matrix_room_id: matrixRoomId,
        host2_receipt_target_event_id: serverEventId,
        cancel_outcome: ROUTEC_CANCEL_OUTCOMES.NOT_FOUND,
        foundation_pass_claimed: false,
      },
    };
  }
  record.control_request_id =
    record.control_request_id || routeCControlRequestId(record);
  if (
    record.host2_receipt_seen !== true ||
    record.host2_receipt_target_event_id !== serverEventId
  ) {
    record.cancelable = false;
    record.cancel_outcome = "matrix_event_not_stable_for_cancel";
    record.control_outcome = record.cancel_outcome;
    record.updated_at = new Date().toISOString();
    recordRouteCCancelSemanticHooks(
      record,
      record.cancel_outcome,
      "cancel_rejected_matrix_event_not_stable"
    );
    writeRouteCHost2IntakeCancelabilityProof();
    return {
      status: 409,
      body: {
        error:
          "Route C Host2 intake cancel requires a stable Matrix event and Host2 receipt.",
        proof: buildRouteCHost2IntakeProof(record),
      },
    };
  }
  if (
    record.host2_intake_state === HOST2_INTAKE_STATES.AGENT_TURN_STARTING ||
    record.host2_intake_state === HOST2_INTAKE_STATES.AGENT_TURN_STARTED ||
    record.agent_turn_started === true
  ) {
    record.cancelable = false;
    record.cancel_outcome = "too_late_to_cancel";
    record.control_outcome = record.cancel_outcome;
    record.too_late_to_cancel_at = new Date().toISOString();
    record.updated_at = new Date().toISOString();
    assertRouteCHost2IntakeInvariant(record);
    recordRouteCCancelSemanticHooks(
      record,
      record.cancel_outcome,
      "cancel_rejected_too_late_to_cancel"
    );
    writeRouteCHost2IntakeCancelabilityProof();
    return {
      status: 409,
      body: {
        error: "Route C Host2 intake already started the agent turn.",
        proof: buildRouteCHost2IntakeProof(record),
      },
    };
  }
  if (record.host2_intake_state === HOST2_INTAKE_STATES.CANCELED) {
    record.cancelable = false;
    record.cancel_outcome = record.cancel_outcome || "already_canceled";
    record.control_outcome = record.cancel_outcome;
    record.provider_delivery_blocked_reason =
      record.provider_delivery_blocked_reason ||
      "host2_queued_canceled_before_provider_delivery";
    record.provider_delivery_attempted = false;
    record.provider_delivery_permitted = false;
    record.next_user_message_delivered_to_active_provider_session = false;
    record.updated_at = new Date().toISOString();
    assertRouteCHost2IntakeInvariant(record);
    recordRouteCCancelSemanticHooks(
      record,
      record.cancel_outcome,
      "cancel_already_canceled"
    );
    writeRouteCHost2IntakeCancelabilityProof();
    return {
      status: 200,
      body: {
        status: "already_canceled",
        proof: buildRouteCHost2IntakeProof(record),
      },
    };
  }
  if (record.host2_intake_state !== HOST2_INTAKE_STATES.HOST2_QUEUED) {
    record.cancelable = false;
    record.cancel_outcome = "host2_intake_not_cancelable";
    record.control_outcome = record.cancel_outcome;
    record.updated_at = new Date().toISOString();
    recordRouteCCancelSemanticHooks(
      record,
      record.cancel_outcome,
      "cancel_rejected_host2_intake_not_cancelable"
    );
    writeRouteCHost2IntakeCancelabilityProof();
    return {
      status: 409,
      body: {
        error: "Route C Host2 intake is not cancelable in its current state.",
        proof: buildRouteCHost2IntakeProof(record),
      },
    };
  }

  const cancelAttempt = attemptCancelTargetEvent({
    records: [record],
    targetEventId: serverEventId,
    hostSessionId,
    matrixRoomId,
    controlRequestId: record.control_request_id,
    requestedBy: "oysterun-ui",
  });
  if (cancelAttempt.outcome !== ROUTEC_CANCEL_OUTCOMES.ACCEPTED) {
    record.cancel_outcome = cancelAttempt.outcome;
    record.control_outcome = cancelAttempt.outcome;
    record.updated_at = new Date().toISOString();
    recordRouteCCancelSemanticHooks(
      record,
      record.cancel_outcome,
      `cancel_${cancelAttempt.status}`
    );
    writeRouteCHost2IntakeCancelabilityProof();
    return {
      status: 409,
      body: {
        error: `Route C Host2 intake cancel failed closed: ${cancelAttempt.status}.`,
        status: cancelAttempt.status,
        proof: buildRouteCHost2IntakeProof(record),
      },
    };
  }
  record.host2_intake_state_reason =
    "host2_queued_cancel_accepted_before_agent_turn_started";
  record.cancel_outcome = ROUTEC_CANCEL_OUTCOMES.ACCEPTED;
  record.control_outcome = record.cancel_outcome;
  record.canceled_at = new Date().toISOString();
  record.provider_delivery_blocked_reason =
    "host2_queued_canceled_before_provider_delivery";
  record.provider_delivery_attempted = false;
  record.provider_delivery_permitted = false;
  record.provider_delivery_claimed = false;
  record.provider_delivery_claim_id = null;
  record.next_user_message_delivered_to_active_provider_session = false;
  record.updated_at = new Date().toISOString();
  assertRouteCHost2IntakeInvariant(record);
  recordRouteCCancelSemanticHooks(
    record,
    record.cancel_outcome,
    "cancel_accepted"
  );
  writeRouteCHost2IntakeCancelabilityProof();
  return {
    status: 200,
    body: {
      status: "cancel_accepted",
      proof: buildRouteCHost2IntakeProof(record),
    },
  };
}

export function markRouteCHost2IntakeAgentTurnStarting({
  hostSessionId,
  matrixRoomId,
  serverEventId,
  providerId = null,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId,
  });
  if (!record) return null;
  if (record.host2_intake_state !== HOST2_INTAKE_STATES.HOST2_QUEUED) {
    return buildRouteCHost2IntakeProof(record);
  }
  transitionHost2IntakeState(
    record,
    ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTING,
    {
      reason: "host2_intake_agent_turn_starting",
    }
  );
  record.host2_intake_state = HOST2_INTAKE_STATES.AGENT_TURN_STARTING;
  record.host2_intake_state_reason =
    "host2_queued_won_cancel_race_agent_turn_starting";
  record.cancelable = false;
  record.provider_id = providerId || record.provider_id || null;
  record.provider_delivery_claimed = true;
  record.provider_delivery_claim_id =
    record.provider_delivery_claim_id || routeCProviderDeliveryClaimId(record);
  record.provider_delivery_permitted = true;
  record.provider_delivery_attempted = true;
  record.provider_delivery_blocked_reason = null;
  assignRouteCSourceUserEventId(record, record.server_event_id);
  record.agent_turn_starting_at = new Date().toISOString();
  record.updated_at = new Date().toISOString();
  assertRouteCHost2IntakeInvariant(record);
  writeRouteCHost2IntakeCancelabilityProof();
  writeRouteCProviderAssistantSemanticResponseProof();
  return buildRouteCHost2IntakeProof(record);
}

export function markRouteCHost2IntakeAgentTurnStarted({
  hostSessionId,
  matrixRoomId,
  serverEventId,
  providerId = null,
  providerTurnId = null,
  providerTurnIdKind = null,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId,
  });
  if (!record) return null;
  if (record.host2_intake_state === HOST2_INTAKE_STATES.CANCELED) {
    assertRouteCHost2IntakeInvariant(record);
    return buildRouteCHost2IntakeProof(record);
  }
  if (
    record.host2_state_machine_state !==
    ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTING
  ) {
    transitionHost2IntakeState(
      record,
      ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTING,
      {
        reason: "host2_intake_agent_turn_started_requires_starting",
      }
    );
  }
  transitionHost2IntakeState(
    record,
    ROUTEC_HOST2_INTAKE_STATES.AGENT_TURN_STARTED,
    {
      reason: "host2_intake_agent_turn_started",
    }
  );
  record.host2_intake_state = HOST2_INTAKE_STATES.AGENT_TURN_STARTED;
  record.host2_intake_state_reason =
    "agent_turn_started_after_host2_intake_start_won_cancel_race";
  record.agent_turn_started = true;
  record.cancelable = false;
  record.provider_id = providerId || record.provider_id || null;
  applyCanonicalProviderTurnId(record, providerTurnId, providerTurnIdKind);
  record.provider_delivery_claimed = true;
  record.provider_delivery_claim_id =
    record.provider_delivery_claim_id || routeCProviderDeliveryClaimId(record);
  record.provider_delivery_permitted = true;
  record.provider_delivery_attempted = true;
  record.provider_delivery_blocked_reason = null;
  record.agent_turn_started_at = new Date().toISOString();
  record.updated_at = new Date().toISOString();
  assertRouteCHost2IntakeInvariant(record);
  writeRouteCHost2IntakeCancelabilityProof();
  writeRouteCProviderAssistantSemanticResponseProof();
  return buildRouteCHost2IntakeProof(record);
}

export function recordRouteCProviderDeliveryFailure({
  hostSessionId,
  matrixRoomId,
  serverEventId,
  providerId = null,
  error,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId,
  });
  if (!record) return null;
  record.provider_id = providerId || record.provider_id || null;
  record.provider_delivery_error = error || "provider_delivery_failed";
  record.provider_delivery_permitted = false;
  record.updated_at = new Date().toISOString();
  assertRouteCHost2IntakeInvariant(record);
  writeRouteCHost2IntakeCancelabilityProof();
  writeRouteCProviderAssistantSemanticResponseProof();
  return buildRouteCHost2IntakeProof(record);
}

export function recordRouteCProviderAssistantSemanticResponse({
  hostSessionId,
  matrixRoomId,
  sourceServerEventId,
  semanticEventId,
  semanticTxnId,
  semanticType,
  semanticId,
  semanticContent,
  assistantBody,
  providerId = null,
  providerTurnId = null,
  providerTurnIdKind = null,
}) {
  const record = routeCHost2FindCorrelation({
    hostSessionId,
    matrixRoomId,
    serverEventId: sourceServerEventId,
  });
  if (!record) return null;
  record.provider_id = providerId || record.provider_id || null;
  applyCanonicalProviderTurnId(record, providerTurnId, providerTurnIdKind);
  assignRouteCSourceUserEventId(record, sourceServerEventId);
  assignRouteCAssistantSemanticEventId(record, semanticEventId);
  record.assistant_semantic_txn_id = semanticTxnId || null;
  record.assistant_semantic_type = semanticType || null;
  record.assistant_semantic_id = semanticId || null;
  record.assistant_semantic_content_hash = semanticContent
    ? hashMatrixContent(semanticContent)
    : null;
  record.assistant_body_hash = hashMatrixContent({ body: assistantBody || "" });
  record.assistant_delivery_state = semanticEventId
    ? "remote_echo_pending"
    : "semantic_send_response_missing_event_id";
  record.duplicate_assistant_row_count = null;
  record.updated_at = new Date().toISOString();
  assertRouteCHost2IntakeInvariant(record);
  writeRouteCHost2IntakeCancelabilityProof();
  writeRouteCProviderAssistantSemanticResponseProof();
  return buildRouteCHost2IntakeProof(record);
}

export function recordRouteCRemoteEcho({
  matrixRoomId,
  serverEventId,
  eventContent,
  rowCountAfterSync = null,
}) {
  if (!serverEventId) return null;
  const record = [...sendCorrelations.values()].find(
    (entry) =>
      entry.matrix_room_id === matrixRoomId &&
      entry.server_event_id === serverEventId
  );
  if (!record) return null;
  record.remote_echo_event_id = serverEventId;
  record.committed_content_hash = hashMatrixContent(eventContent);
  record.row_count_after_sync = rowCountAfterSync;
  record.duplicate_user_row_count =
    record.local_event_id &&
    record.remote_echo_event_id &&
    record.server_event_id === record.remote_echo_event_id
      ? 0
      : null;
  record.state = "remote_echo_reconciled";
  record.updated_at = new Date().toISOString();
  writeRouteCSendReconciliationTrace();
  writeRouteCHostOutboxCorrelationProof();
  writeRouteCHost2IntakeCancelabilityProof();
  return record;
}

export function recordRouteCRemoteEchoFromSync({
  matrixRoomId,
  matrixUserId,
  syncBody,
  rowCountAfterSync = null,
}) {
  const roomTimelineEvents =
    syncBody?.rooms?.join?.[matrixRoomId]?.timeline?.events;
  if (!Array.isArray(roomTimelineEvents)) {
    return {
      status: "no_bound_room_timeline_events",
      matrix_room_id: matrixRoomId,
      matched_count: 0,
      matched_event_ids: [],
    };
  }

  const matches = [];
  for (const event of roomTimelineEvents) {
    const serverEventId =
      typeof event?.event_id === "string" ? event.event_id : null;
    const txnId =
      typeof event?.unsigned?.transaction_id === "string"
        ? event.unsigned.transaction_id
        : null;
    const content = event?.content;
    if (!serverEventId || !txnId || !content) continue;
    const record = [...sendCorrelations.values()].find(
      (entry) =>
        entry.matrix_room_id === matrixRoomId &&
        entry.txnId === txnId &&
        entry.server_event_id === serverEventId
    );
    if (!record) continue;

    const committedContentHash = hashMatrixContent(content);
    const senderMatches = event.sender === matrixUserId;
    const contentMatches =
      committedContentHash === record.forwarded_content_hash;
    const transactionMatches = txnId === record.txnId;
    const eventIdMatches = serverEventId === record.server_event_id;
    if (
      !senderMatches ||
      !contentMatches ||
      !transactionMatches ||
      !eventIdMatches
    ) {
      record.state = "remote_echo_reconciliation_rejected";
      record.remote_echo_rejected_reason = [
        senderMatches ? null : "sender_mismatch",
        contentMatches ? null : "content_hash_mismatch",
        transactionMatches ? null : "transaction_id_mismatch",
        eventIdMatches ? null : "server_event_id_mismatch",
      ]
        .filter(Boolean)
        .join(",");
      record.updated_at = new Date().toISOString();
      continue;
    }

    record.remote_echo_event_id = serverEventId;
    record.committed_content_hash = committedContentHash;
    record.row_count_after_sync = rowCountAfterSync;
    record.duplicate_user_row_count =
      record.local_event_id &&
      record.remote_echo_event_id &&
      record.server_event_id === record.remote_echo_event_id
        ? 0
        : null;
    record.sender_identity_matches = true;
    record.content_hash_matches = true;
    record.transaction_id_matches = true;
    record.remote_echo_match_source = "sync_timeline";
    record.remote_echo_transaction_id = txnId;
    record.state = "remote_echo_reconciled";
    record.updated_at = new Date().toISOString();
    const semanticPayload = content?.[OYSTERUN_SEMANTIC_NAMESPACE];
    if (
      semanticPayload?.semantic_type === "message.assistant" &&
      typeof semanticPayload.source_user_event_id === "string"
    ) {
      const sourceRecord = routeCHost2FindCorrelation({
        hostSessionId: semanticPayload.host_session_id,
        matrixRoomId,
        serverEventId: semanticPayload.source_user_event_id,
      });
      if (sourceRecord) {
        assignRouteCAssistantSemanticEventId(sourceRecord, serverEventId);
        sourceRecord.assistant_semantic_txn_id = txnId;
        sourceRecord.assistant_semantic_type = semanticPayload.semantic_type;
        sourceRecord.assistant_semantic_id =
          semanticPayload.semantic_id || sourceRecord.assistant_semantic_id;
        sourceRecord.assistant_semantic_content_hash = committedContentHash;
        sourceRecord.assistant_body_hash =
          semanticPayload.assistant_content_hash ||
          sourceRecord.assistant_body_hash;
        sourceRecord.assistant_delivery_state = "remote_echo";
        sourceRecord.duplicate_assistant_row_count = 0;
        sourceRecord.updated_at = new Date().toISOString();
      }
    }
    writeRouteCHost2IntakeCancelabilityProof();
    writeRouteCProviderAssistantSemanticResponseProof();
    matches.push({
      server_event_id: serverEventId,
      txnId,
      sender: event.sender,
      content_hash: committedContentHash,
    });
  }

  writeRouteCSendReconciliationTrace();
  writeRouteCHostOutboxCorrelationProof();
  return {
    status:
      matches.length > 0
        ? "sync_remote_echo_reconciled"
        : "sync_remote_echo_not_matched",
    matrix_room_id: matrixRoomId,
    matrix_user_id: matrixUserId,
    matched_count: matches.length,
    matched_event_ids: matches.map((match) => match.server_event_id),
    matches,
  };
}

export function writeRouteCSendReconciliationTrace() {
  return writeRouteCRuntimeProofJsonArtifact("send_reconciliation_trace.json", {
    status: "runtime_updates_required",
    duplicate_user_row_count_required: true,
    correlations: [...sendCorrelations.values()],
  });
}

export function writeRouteCHostOutboxCorrelationProof() {
  return writeRouteCRuntimeProofJsonArtifact("host_outbox_matrix_correlation.json", {
    status: "runtime_updates_required",
    host_outbox_is_correlation_only: true,
    committed_transcript_truth: "matrix_room_timeline",
    correlations: [...sendCorrelations.values()],
  });
}

export function writeRouteCHost2IntakeCancelabilityProof() {
  return writeRouteCRuntimeProofJsonArtifact(
    "host2_agent_intake_cancelability_proof.json",
    {
      status: "runtime_updates_required",
      marker: OYSTERUN_MATRIX_INTAKE_MARKER,
      matrix_read_receipt_is_host2_receipt: false,
      existing_host_outbox_cancel_is_host2_cancel: false,
      provider_turn_started_is_host2_receipt: false,
      local_sending_before_matrix_confirmation_out_of_cancel_scope: true,
      single_check_source: "matrix_committed_server_event_id",
      double_check_source: "host2_agent_intake_matrix_correlated_receipt",
      required_fields: [
        "host2_receipt_seen",
        "host2_receipt_user_id",
        "host2_receipt_target_event_id",
        "host2_intake_state",
        "host2_state_machine_state",
        "agent_turn_started",
        "cancelable",
        "cancel_outcome",
        "provider_received_event",
        "provider_started_event",
        "duplicate_user_row_count",
        "source_user_event_id_raw_hash",
        "source_user_event_id_raw_hash_kind",
        "same_event_both_canceled_and_started",
        "control_request_id",
        "control_outcome",
      ],
      proofs: [...sendCorrelations.values()].map(buildRouteCHost2IntakeProof),
      foundation_pass_claimed: false,
    }
  );
}

export function writeRouteCProviderAssistantSemanticResponseProof() {
  return writeRouteCRuntimeProofJsonArtifact(
    "provider_assistant_semantic_response_proof.json",
    {
      status: "runtime_updates_required",
      marker: OYSTERUN_PROVIDER_RESPONSE_MARKER,
      committed_transcript_truth: "matrix_room_timeline",
      direct_host_send_used: false,
      direct_matrix_harness_write_used: false,
      direct_semantic_endpoint_as_proof_used: false,
      fake_dom_row_injected: false,
      fake_cinny_store_row_injected: false,
      screenshot_only_proof: false,
      raw_synapse_token_exposed: false,
      readiness_claimed: false,
      foundation_pass_claimed: false,
      required_fields: [
        "source_user_event_id",
        "source_user_event_id_raw_hash",
        "source_user_event_id_raw_hash_kind",
        "assistant_semantic_event_id",
        "assistant_semantic_event_id_raw_hash",
        "assistant_semantic_event_id_raw_hash_kind",
        "assistant_semantic_type",
        "assistant_semantic_id",
        "provider_id",
        "provider_turn_id",
        "assistant_semantic_content_hash",
        "assistant_body_hash",
        "duplicate_assistant_row_count",
      ],
      proofs: [...sendCorrelations.values()].map(buildRouteCHost2IntakeProof),
    }
  );
}

export function writeRouteCContentEquivalenceProof({
  clientContent,
  forwardedContent,
  committedContent,
}) {
  const previous = readRouteCRuntimeProofJsonArtifact(
    "content_equality_or_semantic_equivalence.json",
    {
      checks: [],
    }
  );
  const check = {
    checked_at: new Date().toISOString(),
    client_content_hash: hashMatrixContent(clientContent),
    forwarded_content_hash: hashMatrixContent(forwardedContent),
    committed_content_hash: committedContent
      ? hashMatrixContent(committedContent)
      : null,
    host_mutates_render_relevant_content: false,
  };
  const checks = Array.isArray(previous.checks)
    ? [...previous.checks, check]
    : [check];
  return writeRouteCRuntimeProofJsonArtifact(
    "content_equality_or_semantic_equivalence.json",
    {
      status: "runtime_updates_required",
      checks,
    }
  );
}

export function writeRouteCRoomRowCountTrace(trace = {}) {
  return writeRouteCRuntimeProofJsonArtifact("room_row_count_trace.json", {
    status: "runtime_updates_required",
    requires_reload_reconciliation: true,
    ...trace,
  });
}
