import {
  COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE,
  COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER,
  COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE,
  isSuccessfulProviderCompletionStatus,
  providerCompletionStateForStatus,
} from "./provider-completion-notification-contract.mjs";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function semanticTypeOf(payload) {
  return (
    normalizeString(payload?.semantic_type) ||
    normalizeString(payload?.semantic_category)
  );
}

function stringifyNotificationValue(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyNotificationValue(entry).trim())
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function semanticPayloadNotificationBody(payload) {
  const candidates = [
    payload?.body,
    payload?.text,
    payload?.summary,
    payload?.display_text,
    payload?.tool_content,
    payload?.tool_output,
    payload?.tool_result,
    payload?.content,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeString(stringifyNotificationValue(candidate));
    if (normalized) return normalized;
  }
  return "";
}

function truncateNotificationBody(text) {
  const normalized = normalizeString(text).replace(/\s+/g, " ");
  if (!normalized) return "Assistant reply is complete.";
  return normalized.length > 180
    ? `${normalized.slice(0, 177).trimEnd()}...`
    : normalized;
}

function buildNotificationBody({ contentBody, semanticPayload, semanticType }) {
  const normalizedContentBody = normalizeString(contentBody);
  const normalizedSemanticBody = semanticPayloadNotificationBody(semanticPayload);
  const source = normalizedContentBody || normalizedSemanticBody;
  if (source) return truncateNotificationBody(source);
  if (semanticType === "thinking.reasoning") return "";
  return truncateNotificationBody("");
}

function getNotificationTitle(sessionName) {
  const normalized = normalizeString(sessionName).replace(/\s+/g, "-");
  return normalized ? `Oysterun-${normalized}` : "Oysterun";
}

function buildNotificationTapRoute({ sessionId, matrixEventId }) {
  const encodedSessionId = encodeURIComponent(sessionId);
  const encodedEventId = encodeURIComponent(matrixEventId);
  return `/app/sessions/${encodedSessionId}/chat?focus_event_id=${encodedEventId}`;
}

export function isCompleteMessageNotifiableSemanticType(semanticType) {
  return (
    semanticType === "message.assistant" ||
    semanticType === "tool.result" ||
    semanticType === "tool.failure" ||
    semanticType === "thinking.reasoning"
  );
}

export function normalizeCommittedProviderOutputMatrixNotificationCandidate({
  eventType,
  matrixEventId,
  matrixRoomId,
  hostSessionId,
  contentBody,
  contentDelta = false,
  semanticPayload,
  sessionName,
} = {}) {
  const normalizedEventType = normalizeString(eventType);
  if (normalizedEventType && normalizedEventType !== "m.room.message") {
    return { accepted: false, reason: "not_matrix_room_message" };
  }
  if (!semanticPayload || typeof semanticPayload !== "object") {
    return { accepted: false, reason: "semantic_payload_missing" };
  }
  const semanticType = semanticTypeOf(semanticPayload);
  if (!isCompleteMessageNotifiableSemanticType(semanticType)) {
    return { accepted: false, reason: "semantic_type_not_notifiable" };
  }
  if (contentDelta === true || semanticPayload.delta === true) {
    return { accepted: false, reason: "provider_output_delta_not_final" };
  }

  const eventId = normalizeString(matrixEventId);
  if (!eventId) return { accepted: false, reason: "matrix_event_id_missing" };
  if (eventId.startsWith("~")) {
    return { accepted: false, reason: "matrix_event_id_local_echo" };
  }

  const roomId =
    normalizeString(matrixRoomId) ||
    normalizeString(semanticPayload.matrix_room_id);
  if (!roomId) return { accepted: false, reason: "matrix_room_id_missing" };

  const sessionId =
    normalizeString(hostSessionId) ||
    normalizeString(semanticPayload.host_session_id);
  if (!sessionId) return { accepted: false, reason: "host_session_id_missing" };

  const providerTurnId = normalizeString(semanticPayload.provider_turn_id);
  if (!providerTurnId) {
    return { accepted: false, reason: "provider_turn_id_missing" };
  }

  if (
    normalizeString(semanticPayload.provider_completion_marker) !==
    COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER
  ) {
    return { accepted: false, reason: "provider_completion_marker_missing" };
  }
  if (
    normalizeString(semanticPayload.provider_completion_state) !==
    COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE
  ) {
    return {
      accepted: false,
      reason: "provider_completion_state_not_pending",
    };
  }

  const semanticId = normalizeString(semanticPayload.semantic_id);
  const assistantContentHash = normalizeString(
    semanticPayload.assistant_content_hash || semanticPayload.semantic_body_hash
  );
  const body = buildNotificationBody({
    contentBody,
    semanticPayload,
    semanticType,
  });
  if (semanticType === "thinking.reasoning" && !body) {
    return { accepted: false, reason: "thinking_reasoning_body_missing" };
  }
  const key = [
    semanticType === "message.assistant"
      ? "matrix-committed-assistant"
      : "matrix-committed-provider-output",
    eventId,
  ].join(":");

  return {
    accepted: true,
    reason: "accepted",
    candidate: {
      source: "matrix_committed_event",
      key,
      dedupeKey: key,
      matrixEventId: eventId,
      matrixRoomId: roomId,
      hostSessionId: sessionId,
      sessionId,
      semanticId,
      assistantContentHash,
      providerTurnId,
      semanticType,
      semantic_type: semanticType,
      notifiableOutputType: semanticType,
      notifiable_output_type: semanticType,
      title: getNotificationTitle(sessionName),
      body,
      url: buildNotificationTapRoute({ sessionId, matrixEventId: eventId }),
    },
  };
}

export function normalizeProviderCompletionReleaseMarker({
  eventType,
  matrixEventId,
  matrixRoomId,
  hostSessionId,
  semanticPayload,
} = {}) {
  const normalizedEventType = normalizeString(eventType);
  if (normalizedEventType && normalizedEventType !== "m.room.message") {
    return { accepted: false, reason: "not_matrix_room_message" };
  }
  if (!semanticPayload || typeof semanticPayload !== "object") {
    return { accepted: false, reason: "semantic_payload_missing" };
  }
  if (
    normalizeString(semanticPayload.provider_completion_marker) !==
    COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER
  ) {
    return { accepted: false, reason: "provider_completion_marker_missing" };
  }

  const state = normalizeString(semanticPayload.provider_completion_state);
  if (!state || state === COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE) {
    return {
      accepted: false,
      reason: "provider_completion_state_not_terminal",
    };
  }

  const providerTurnId =
    normalizeString(semanticPayload.provider_completion_turn_id) ||
    normalizeString(semanticPayload.provider_turn_id);
  if (!providerTurnId) {
    return { accepted: false, reason: "provider_turn_id_missing" };
  }

  const eventId = normalizeString(matrixEventId);
  if (!eventId) return { accepted: false, reason: "matrix_event_id_missing" };
  if (eventId.startsWith("~")) {
    return { accepted: false, reason: "matrix_event_id_local_echo" };
  }

  const roomId =
    normalizeString(matrixRoomId) ||
    normalizeString(semanticPayload.matrix_room_id);
  if (!roomId) return { accepted: false, reason: "matrix_room_id_missing" };

  const sessionId =
    normalizeString(hostSessionId) ||
    normalizeString(semanticPayload.host_session_id);
  if (!sessionId) return { accepted: false, reason: "host_session_id_missing" };

  const status = normalizeString(semanticPayload.provider_completion_status);
  const expectedState = providerCompletionStateForStatus(status);
  const successful =
    state === COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE &&
    semanticPayload.provider_completion_success === true &&
    isSuccessfulProviderCompletionStatus(status);

  return {
    accepted: true,
    reason: successful
      ? "provider_turn_completed"
      : "provider_turn_not_successful",
    release: {
      source: "matrix_provider_completion_marker",
      matrixEventId: eventId,
      matrixRoomId: roomId,
      hostSessionId: sessionId,
      sessionId,
      providerTurnId,
      status: status || "completed",
      state,
      expectedState,
      successful,
    },
  };
}
