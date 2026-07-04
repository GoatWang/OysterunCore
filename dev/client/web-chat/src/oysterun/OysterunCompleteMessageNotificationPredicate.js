export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER =
  'oysterun_provider_complete_message_notification_v1';

export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE = 'pending_turn_completion';
export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE = 'turn_completed';
export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_FAILED_STATE = 'turn_failed';
export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_INTERRUPTED_STATE = 'turn_interrupted';

const FAILED_PROVIDER_COMPLETION_STATUSES = new Set(['failed', 'error', 'errored']);
const INTERRUPTED_PROVIDER_COMPLETION_STATUSES = new Set([
  'interrupted',
  'interrupt',
  'canceled',
  'cancelled',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function semanticTypeOf(payload) {
  return normalizeString(payload?.semantic_type) || normalizeString(payload?.semantic_category);
}

function stringifyNotificationValue(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyNotificationValue(entry).trim())
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
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
  return '';
}

function truncateNotificationBody(text) {
  const normalized = normalizeString(text).replace(/\s+/g, ' ');
  if (!normalized) return 'Assistant reply is complete.';
  return normalized.length > 180 ? `${normalized.slice(0, 177).trimEnd()}...` : normalized;
}

function buildNotificationBody({ contentBody, semanticPayload, semanticType }) {
  const normalizedContentBody = normalizeString(contentBody);
  const normalizedSemanticBody = semanticPayloadNotificationBody(semanticPayload);
  const source = normalizedContentBody || normalizedSemanticBody;
  if (source) return truncateNotificationBody(source);
  if (semanticType === 'thinking.reasoning') return '';
  return truncateNotificationBody('');
}

function getNotificationTitle(sessionName, windowHost) {
  const normalized = normalizeString(sessionName).replace(/\s+/g, '-');
  if (normalized) return `Oysterun-${normalized}`;
  const host = normalizeString(windowHost);
  return host ? `Oysterun-${host}` : 'Oysterun';
}

export function isCompleteMessageNotifiableSemanticType(semanticType) {
  return (
    semanticType === 'message.assistant' ||
    semanticType === 'tool.result' ||
    semanticType === 'tool.failure' ||
    semanticType === 'thinking.reasoning'
  );
}

function providerCompletionStateForStatus(value) {
  const status = normalizeString(value).toLowerCase() || 'completed';
  if (FAILED_PROVIDER_COMPLETION_STATUSES.has(status)) {
    return COMPLETE_MESSAGE_PROVIDER_COMPLETION_FAILED_STATE;
  }
  if (INTERRUPTED_PROVIDER_COMPLETION_STATUSES.has(status)) {
    return COMPLETE_MESSAGE_PROVIDER_COMPLETION_INTERRUPTED_STATE;
  }
  return COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE;
}

function isSuccessfulProviderCompletionStatus(value) {
  return providerCompletionStateForStatus(value) === COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE;
}

export function normalizeOysterunCompleteMessageNotificationCandidateInput({
  eventType,
  matrixEventId,
  matrixRoomId,
  hostSessionId,
  roomId,
  contentBody,
  contentDelta = false,
  semanticPayload,
  sessionName,
  url,
  windowHost,
} = {}) {
  const normalizedEventType = normalizeString(eventType);
  if (normalizedEventType && normalizedEventType !== 'm.room.message') {
    return { accepted: false, reason: 'not_matrix_room_message' };
  }
  if (!semanticPayload || typeof semanticPayload !== 'object') {
    return { accepted: false, reason: 'semantic_payload_missing' };
  }
  const semanticType = semanticTypeOf(semanticPayload);
  if (!isCompleteMessageNotifiableSemanticType(semanticType)) {
    return { accepted: false, reason: 'semantic_type_not_notifiable' };
  }
  if (contentDelta === true || semanticPayload.delta === true) {
    return { accepted: false, reason: 'provider_output_delta_not_final' };
  }

  const eventId = normalizeString(matrixEventId);
  if (!eventId) return { accepted: false, reason: 'matrix_event_id_missing' };
  if (eventId.startsWith('~')) return { accepted: false, reason: 'matrix_event_id_local_echo' };

  const normalizedRoomId = normalizeString(roomId);
  const normalizedMatrixRoomId =
    normalizeString(matrixRoomId) || normalizeString(semanticPayload.matrix_room_id) || normalizedRoomId;
  if (!normalizedMatrixRoomId) return { accepted: false, reason: 'matrix_room_id_missing' };

  const normalizedHostSessionId =
    normalizeString(hostSessionId) || normalizeString(semanticPayload.host_session_id);
  if (!normalizedHostSessionId) return { accepted: false, reason: 'host_session_id_missing' };

  const providerTurnId = normalizeString(semanticPayload.provider_turn_id);
  if (!providerTurnId) return { accepted: false, reason: 'provider_turn_id_missing' };

  if (
    normalizeString(semanticPayload.provider_completion_marker) !==
    COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER
  ) {
    return { accepted: false, reason: 'provider_completion_marker_missing' };
  }
  if (
    normalizeString(semanticPayload.provider_completion_state) !==
    COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE
  ) {
    return { accepted: false, reason: 'provider_completion_state_not_pending' };
  }

  const body = buildNotificationBody({ contentBody, semanticPayload, semanticType });
  if (semanticType === 'thinking.reasoning' && !body) {
    return { accepted: false, reason: 'thinking_reasoning_body_missing' };
  }
  const key = [
    semanticType === 'message.assistant'
      ? 'matrix-committed-assistant'
      : 'matrix-committed-provider-output',
    eventId,
  ].join(':');
  return {
    accepted: true,
    reason: 'accepted',
    candidate: {
      source: 'matrix_committed_event',
      key,
      roomId: normalizedRoomId || normalizedMatrixRoomId,
      eventId,
      matrixEventId: eventId,
      matrixRoomId: normalizedMatrixRoomId,
      hostSessionId: normalizedHostSessionId,
      sessionId: normalizedHostSessionId,
      semanticId: normalizeString(semanticPayload.semantic_id),
      assistantContentHash: normalizeString(
        semanticPayload.assistant_content_hash || semanticPayload.semantic_body_hash
      ),
      providerTurnId,
      semanticType,
      semantic_type: semanticType,
      notifiableOutputType: semanticType,
      notifiable_output_type: semanticType,
      title: getNotificationTitle(sessionName, windowHost),
      body,
      url,
    },
  };
}

export function normalizeOysterunCompleteMessageNotificationReleaseInput({
  eventType,
  matrixEventId,
  matrixRoomId,
  hostSessionId,
  roomId,
  semanticPayload,
} = {}) {
  const normalizedEventType = normalizeString(eventType);
  if (normalizedEventType && normalizedEventType !== 'm.room.message') {
    return { accepted: false, reason: 'not_matrix_room_message' };
  }
  if (!semanticPayload || typeof semanticPayload !== 'object') {
    return { accepted: false, reason: 'semantic_payload_missing' };
  }
  if (
    normalizeString(semanticPayload.provider_completion_marker) !==
    COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER
  ) {
    return { accepted: false, reason: 'provider_completion_marker_missing' };
  }
  const state = normalizeString(semanticPayload.provider_completion_state);
  if (!state || state === COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE) {
    return { accepted: false, reason: 'provider_completion_state_not_terminal' };
  }
  const providerTurnId =
    normalizeString(semanticPayload.provider_completion_turn_id) ||
    normalizeString(semanticPayload.provider_turn_id);
  if (!providerTurnId) return { accepted: false, reason: 'provider_turn_id_missing' };

  const eventId = normalizeString(matrixEventId);
  if (!eventId) return { accepted: false, reason: 'matrix_event_id_missing' };
  if (eventId.startsWith('~')) return { accepted: false, reason: 'matrix_event_id_local_echo' };

  const normalizedMatrixRoomId =
    normalizeString(matrixRoomId) || normalizeString(semanticPayload.matrix_room_id) || normalizeString(roomId);
  if (!normalizedMatrixRoomId) return { accepted: false, reason: 'matrix_room_id_missing' };

  const normalizedHostSessionId =
    normalizeString(hostSessionId) || normalizeString(semanticPayload.host_session_id);
  if (!normalizedHostSessionId) return { accepted: false, reason: 'host_session_id_missing' };

  const status = normalizeString(semanticPayload.provider_completion_status) || 'completed';
  const expectedState = providerCompletionStateForStatus(status);
  const successful =
    state === COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE &&
    semanticPayload.provider_completion_success === true &&
    isSuccessfulProviderCompletionStatus(status);

  return {
    accepted: true,
    reason: successful ? 'provider_turn_completed' : 'provider_turn_not_successful',
    release: {
      source: 'matrix_provider_completion_marker',
      matrixEventId: eventId,
      matrixRoomId: normalizedMatrixRoomId,
      hostSessionId: normalizedHostSessionId,
      sessionId: normalizedHostSessionId,
      providerTurnId,
      status,
      state,
      expectedState,
      successful,
    },
  };
}
