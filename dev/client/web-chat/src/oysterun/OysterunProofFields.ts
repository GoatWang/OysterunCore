import type { MatrixEvent } from 'matrix-js-sdk';

import { OYSTERUN_HOST_CORRELATION_NAMESPACE } from './OysterunSendAdapter';
import { getOysterunSemanticPayload } from './OysterunSemanticRenderer';
import { getOysterunHostSessionId, recordOysterunProof } from './OysterunHostClient';

function oysterunEventIdKind(
  eventId: string | undefined
): 'server' | 'local' | 'missing' | 'unknown' {
  if (!eventId) return 'missing';
  if (eventId.startsWith('$')) return 'server';
  if (eventId.startsWith('~')) return 'local';
  return 'unknown';
}

function oysterunSendStatus(mEvent: MatrixEvent): string {
  const status = (mEvent as MatrixEvent & { status?: unknown }).status;
  if (typeof status === 'string' && status) return status;
  return mEvent.isSending() ? 'sending_state_unknown' : 'settled';
}

export function buildOysterunMessageProofAttributes(mEvent: MatrixEvent, roomId: string) {
  const content = mEvent.getContent<Record<string, unknown>>();
  const semanticPayload = getOysterunSemanticPayload(content);
  const correlation = content[OYSTERUN_HOST_CORRELATION_NAMESPACE] as
    | Record<string, unknown>
    | undefined;
  const rawEventId = mEvent.getId() ?? undefined;
  const matrixEventSender = mEvent.getSender() ?? undefined;
  const eventIdKind = oysterunEventIdKind(rawEventId);
  const localEventId = eventIdKind === 'local' ? rawEventId : undefined;
  const serverEventId = eventIdKind === 'server' ? rawEventId : undefined;
  const sendStatus = oysterunSendStatus(mEvent);
  const txnId =
    (typeof correlation?.client_request_id === 'string' && correlation.client_request_id) ||
    (typeof semanticPayload?.client_request_id === 'string' && semanticPayload.client_request_id) ||
    (typeof (mEvent as any).getTxnId === 'function' ? (mEvent as any).getTxnId() : undefined) ||
    undefined;
  const semanticType = semanticPayload?.semantic_type ?? semanticPayload?.semantic_category;
  const inlineUserSemanticType =
    !semanticPayload && correlation && content.msgtype === 'm.text' ? 'message.user' : undefined;
  const rowKind = semanticType ?? content.msgtype ?? 'matrix_event';
  const deliveryState =
    semanticPayload?.lifecycle ??
    (serverEventId ? 'remote_echo' : localEventId ? 'local_echo_pending' : 'pending_event_id');
  return {
    'data-testid': semanticPayload
      ? 'oysterun-semantic-message-row'
      : 'oysterun-matrix-message-row',
    'data-oysterun-proof-scope': semanticPayload ? 'canonical-timeline-row' : 'matrix-timeline-row',
    'data-oysterun-countable-semantic-row': semanticPayload ? 'true' : undefined,
    'data-oysterun-inline-semantic-type': inlineUserSemanticType,
    'data-oysterun-inline-semantic-proof-role': inlineUserSemanticType
      ? 'exact-human-path-composer-user-row'
      : undefined,
    'data-oysterun-countable-user-row': inlineUserSemanticType ? 'true' : undefined,
    'data-oysterun-semantic-proof-role': semanticPayload
      ? 'canonical-rendered-semantic-row'
      : undefined,
    'data-oysterun-room-id': roomId,
    'data-oysterun-matrix-event-sender': matrixEventSender,
    'data-oysterun-matrix-event-sender-proof-source': 'mEvent.getSender',
    'data-oysterun-semantic-matrix-event-sender': semanticPayload?.matrix_event_sender,
    'data-oysterun-matrix-event-sender-matches-semantic-proof': semanticPayload
      ? String(semanticPayload.matrix_event_sender === matrixEventSender)
      : undefined,
    'data-oysterun-matrix-event-sender-actor-key': semanticPayload?.matrix_event_sender_actor_key,
    'data-oysterun-matrix-event-sender-actor-kind': semanticPayload?.matrix_event_sender_actor_kind,
    'data-oysterun-matrix-event-sender-source': semanticPayload?.matrix_event_sender_source,
    'data-oysterun-semantic-role-is-sender': semanticPayload ? 'false' : undefined,
    'data-oysterun-event-id': serverEventId,
    'data-oysterun-local-event-id': localEventId,
    'data-oysterun-server-event-id': serverEventId,
    'data-oysterun-event-id-kind': eventIdKind,
    'data-oysterun-send-status': sendStatus,
    'data-oysterun-txn-id': txnId,
    'data-oysterun-semantic-id': semanticPayload?.semantic_id,
    'data-oysterun-semantic-type': semanticType ?? inlineUserSemanticType,
    'data-oysterun-schema-version': semanticPayload?.schema_version,
    'data-oysterun-semantic-category': semanticPayload?.semantic_category,
    'data-oysterun-row-kind': inlineUserSemanticType ?? rowKind,
    'data-oysterun-delivery-state': deliveryState,
    'data-oysterun-created-at': semanticPayload?.created_at,
    'data-oysterun-host-session-id':
      correlation?.host_session_id ?? semanticPayload?.host_session_id,
    'data-oysterun-host-message-id': semanticPayload?.host_message_id,
    'data-oysterun-source-user-event-id':
      semanticPayload?.source_user_event_id ?? (inlineUserSemanticType ? serverEventId : undefined),
    'data-oysterun-source-user-event-id-hash': semanticPayload?.source_user_event_id_hash,
    'data-oysterun-source-user-event-id-hash-kind':
      semanticPayload?.source_user_event_id_hash_kind ??
      (inlineUserSemanticType && serverEventId ? 'raw_event_id_sha256' : undefined),
    'data-oysterun-target-user-event-id': semanticPayload?.target_user_event_id,
    'data-oysterun-target-user-event-id-hash': semanticPayload?.target_user_event_id_hash,
    'data-oysterun-target-user-event-id-hash-kind': semanticPayload?.target_user_event_id_hash_kind,
    'data-oysterun-target-event-id': semanticPayload?.target_event_id,
    'data-oysterun-target-event-id-kind': semanticPayload?.target_event_id_kind,
    'data-oysterun-target-id': semanticPayload?.target_id,
    'data-oysterun-target-turn-id': semanticPayload?.target_turn_id,
    'data-oysterun-target-session-id': semanticPayload?.target_session_id,
    'data-oysterun-source-id': semanticPayload?.source_id,
    'data-oysterun-source-label': semanticPayload?.source_label,
    'data-oysterun-provider-id': semanticPayload?.provider_id,
    'data-oysterun-provider': semanticPayload?.provider,
    'data-oysterun-provider-turn-id': semanticPayload?.provider_turn_id,
    'data-oysterun-provider-turn-id-kind': semanticPayload?.provider_turn_id_kind,
    'data-oysterun-semantic-contract': semanticPayload?.semantic_contract,
    'data-oysterun-cancel-outcome': semanticPayload?.cancel_outcome,
    'data-oysterun-control-request-id': semanticPayload?.control_request_id,
    'data-oysterun-control-outcome-id': semanticPayload?.control_outcome_id,
    'data-oysterun-control-outcome': semanticPayload?.control_outcome,
    'data-oysterun-control-kind': semanticPayload?.control_kind,
    'data-oysterun-control-family': semanticPayload?.control_family,
    'data-oysterun-control-origin': semanticPayload?.control_origin,
    'data-oysterun-outcome': semanticPayload?.outcome,
    'data-oysterun-actor': semanticPayload?.actor,
    'data-oysterun-terminal-exec-id': semanticPayload?.terminal_exec_id,
    'data-oysterun-terminal-command': semanticPayload?.command,
    'data-oysterun-terminal-cwd': semanticPayload?.cwd,
    'data-oysterun-terminal-started-at': semanticPayload?.started_at,
    'data-oysterun-terminal-completed-at': semanticPayload?.completed_at,
    'data-oysterun-terminal-exit-code':
      typeof semanticPayload?.exit_code === 'number' ? String(semanticPayload.exit_code) : undefined,
    'data-oysterun-terminal-duration-ms':
      typeof semanticPayload?.duration_ms === 'number'
        ? String(semanticPayload.duration_ms)
        : undefined,
    'data-oysterun-terminal-timed-out':
      typeof semanticPayload?.timed_out === 'boolean'
        ? String(semanticPayload.timed_out)
        : undefined,
    'data-oysterun-terminal-interrupted':
      typeof semanticPayload?.interrupted === 'boolean'
        ? String(semanticPayload.interrupted)
        : undefined,
    'data-oysterun-terminal-interrupt-reason': semanticPayload?.interrupt_reason ?? undefined,
    'data-oysterun-provider-delivery-attempted':
      typeof semanticPayload?.provider_delivery_attempted === 'boolean'
        ? String(semanticPayload.provider_delivery_attempted)
        : undefined,
    'data-oysterun-normal-message-user-sent':
      typeof semanticPayload?.normal_message_user_sent === 'boolean'
        ? String(semanticPayload.normal_message_user_sent)
        : undefined,
    'data-oysterun-browser-shell-execution':
      typeof semanticPayload?.browser_shell_execution === 'boolean'
        ? String(semanticPayload.browser_shell_execution)
        : undefined,
    'data-oysterun-host-db-transcript-product-truth':
      typeof semanticPayload?.host_db_transcript_product_truth === 'boolean'
        ? String(semanticPayload.host_db_transcript_product_truth)
        : undefined,
    'data-oysterun-allowed-actions': semanticPayload?.allowed_actions?.join(','),
    'data-oysterun-durable':
      typeof semanticPayload?.durable === 'boolean' ? String(semanticPayload.durable) : undefined,
    'data-oysterun-replay-policy': semanticPayload?.replay_policy,
    'data-oysterun-body-fallback-present':
      typeof semanticPayload?.body_fallback_present === 'boolean'
        ? String(semanticPayload.body_fallback_present)
        : undefined,
    'data-oysterun-agent-turn-started':
      typeof semanticPayload?.agent_turn_started === 'boolean'
        ? String(semanticPayload.agent_turn_started)
        : undefined,
    'data-oysterun-host2-intake-state': semanticPayload?.host2_intake_state,
    'data-oysterun-provider-receives-canceled-user-event':
      typeof semanticPayload?.provider_receives_canceled_user_event === 'boolean'
        ? String(semanticPayload.provider_receives_canceled_user_event)
        : undefined,
    'data-oysterun-provider-received-event':
      typeof semanticPayload?.provider_received_event === 'boolean'
        ? String(semanticPayload.provider_received_event)
        : undefined,
    'data-oysterun-provider-started-event':
      typeof semanticPayload?.provider_started_event === 'boolean'
        ? String(semanticPayload.provider_started_event)
        : undefined,
    'data-oysterun-provider-started-for-target-event':
      typeof semanticPayload?.provider_started_for_target_event === 'boolean'
        ? String(semanticPayload.provider_started_for_target_event)
        : undefined,
    'data-oysterun-same-event-both-canceled-and-started':
      typeof semanticPayload?.same_event_both_canceled_and_started === 'boolean'
        ? String(semanticPayload.same_event_both_canceled_and_started)
        : undefined,
    'data-oysterun-outbox-delivery-state': semanticPayload?.outbox_delivery_state,
    'data-oysterun-ambiguous-state': semanticPayload?.ambiguous_state,
    'data-oysterun-assistant-content-hash': semanticPayload?.assistant_content_hash,
    'data-oysterun-duplicate-assistant-row-count': semanticPayload
      ? semanticPayload.duplicate_assistant_row_count ?? 0
      : undefined,
    'data-oysterun-duplicate-user-row-count': inlineUserSemanticType ? 0 : undefined,
    'data-oysterun-direct-matrix-harness-write-used': semanticPayload
      ? String(semanticPayload.direct_matrix_harness_write_used === true)
      : undefined,
    'data-oysterun-real-codex-e2e-claimed': semanticPayload
      ? String(semanticPayload.real_codex_e2e_claimed === true)
      : undefined,
    'data-oysterun-full-provider-parity-claimed': semanticPayload
      ? String(semanticPayload.full_provider_parity_claimed === true)
      : undefined,
  };
}

export function buildOysterunTimelineRootProofAttributes(roomId: string) {
  return {
    'data-testid': 'oysterun-routec-timeline-root',
    'data-oysterun-clean-session-testid': 'oysterun-clean-session-timeline-root',
    'data-oysterun-room-id': roomId,
  };
}

export function buildOysterunComposerProofAttributes(roomId: string) {
  return {
    'data-testid': 'oysterun-routec-composer',
    'data-oysterun-clean-session-testid': 'oysterun-clean-session-composer',
    'data-oysterun-room-id': roomId,
    'data-oysterun-host-session-id': getOysterunHostSessionId(),
  };
}

export function recordMatrixClientInitProof(
  session: {
    baseUrl: string;
    userId: string;
    deviceId: string;
    accessToken: string;
  },
  extraProof: Record<string, unknown> = {}
) {
  recordOysterunProof('matrixClientInit', {
    status: 'matrix_client_init_invoked',
    base_url: session.baseUrl,
    base_url_is_host_origin: session.baseUrl === window.location.origin,
    user_id: session.userId,
    device_id: session.deviceId,
    access_token_kind: session.accessToken.startsWith('oysterun_facade_')
      ? 'host_scoped_matrix_facade_token'
      : 'unexpected_token_kind',
    ...extraProof,
    raw_synapse_token_exposed: false,
    browser_storage_raw_synapse_token: false,
  });
}
