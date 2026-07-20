import React, { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { Box, Button, Spinner, Text, config } from 'folds';

import {
  classifyOysterunSemanticRowReadout,
  getOysterunToolEventDetail,
  recordOysterunProof,
  recordOysterunProviderControlProof,
  recordOysterunSemanticDiagnostic,
  respondOysterunProviderControl,
  type OysterunMcpElicitationResponse,
  type OysterunProviderControlAction,
  type OysterunToolEventDetailResponse,
  type OysterunToolLifecycleInvocation,
} from './OysterunHostClient';

export const OYSTERUN_SEMANTIC_NAMESPACE = 'org.oysterun.semantic.v1';
export const OYSTERUN_PROVIDER_COMPLETION_MARKER =
  'oysterun_provider_complete_message_notification_v1';
export const OYSTERUN_PROVIDER_COMPLETION_PENDING_STATE = 'pending_turn_completion';
export const OYSTERUN_TOOL_STORAGE_GENERATION_SQLITE = 'sqlite_continuation_v1';

const OYSTERUN_PROVIDER_COMPLETION_TERMINAL_STATES = new Set([
  'turn_completed',
  'turn_failed',
  'turn_interrupted',
]);

export type OysterunSemanticPayload = {
  schema_version?: number | string;
  semantic_id?: string;
  semantic_type?: string;
  semantic_category?: string;
  lifecycle?: string;
  semantic_lifecycle?: string;
  body?: string;
  created_at?: string;
  host_session_id?: string;
  host_message_id?: string;
  host_outbox_id?: string;
  client_request_id?: string;
  matrix_room_id?: string;
  source_user_event_id?: string;
  source_user_event_id_hash?: string;
  source_user_event_id_hash_kind?: string;
  target_user_event_id?: string;
  target_user_event_id_hash?: string;
  target_user_event_id_hash_kind?: string;
  target_event_id?: string;
  target_event_id_kind?: string;
  target_id?: string;
  target_turn_id?: string;
  target_session_id?: string;
  source_id?: string;
  source_label?: string;
  provider_id?: string;
  provider?: string;
  provider_turn_id?: string;
  provider_turn_id_kind?: string;
  semantic_contract?: string;
  cancel_outcome?: string;
  control_request_id?: string;
  control_outcome_id?: string;
  control_outcome?: string;
  control_kind?: string;
  control_family?: string;
  control_origin?: string;
  control_payload?: unknown;
  outcome?: string;
  actor?: string;
  matrix_event_sender?: string;
  matrix_event_sender_actor_key?: string;
  matrix_event_sender_actor_kind?: string;
  matrix_event_sender_display_name?: string;
  matrix_event_sender_source?: string;
  matrix_sender_semantic_role_distinct?: boolean;
  tool_name?: string;
  tool_call_id?: string;
  tool_input?: unknown;
  tool_content?: unknown;
  tool_is_error?: boolean | null;
  terminal_exec_id?: string;
  command?: string;
  cwd?: string;
  started_at?: string;
  completed_at?: string;
  stdout?: string;
  stderr?: string;
  stdout_truncated?: boolean;
  stderr_truncated?: boolean;
  exit_code?: number | null;
  duration_ms?: number | null;
  timed_out?: boolean;
  interrupted?: boolean;
  interrupt_reason?: string | null;
  requested_by?: string | null;
  normal_message_user_sent?: boolean;
  browser_shell_execution?: boolean;
  provider_delivery_attempted?: boolean;
  host_db_transcript_product_truth?: boolean;
  allowed_actions?: string[];
  durable?: boolean;
  replay_policy?: string;
  body_fallback_present?: boolean;
  agent_turn_started?: boolean;
  host2_intake_state?: string;
  provider_receives_canceled_user_event?: boolean;
  provider_received_event?: boolean;
  provider_started_event?: boolean;
  provider_started_for_target_event?: boolean;
  same_event_both_canceled_and_started?: boolean;
  duplicate_user_row_count?: number | null;
  outbox_delivery_state?: string;
  ambiguous_state?: string;
  assistant_content_hash?: string;
  duplicate_assistant_row_count?: number | null;
  provider_response_marker?: string;
  provider_completion_marker?: string;
  provider_completion_state?: string;
  provider_completion_status?: string;
  provider_completion_success?: boolean | null;
  provider_completion_success_required?: boolean | null;
  provider_completion_turn_id?: string;
  large_tool_notice?: boolean;
  large_tool_notice_kind?: string;
  consecutive_run_index?: number | null;
  matrix_retained_tool_event_count?: number | null;
  tool_event_count_label?: string;
  tool_storage_generation?: string;
  detail_available?: boolean;
  tool_detail_available?: boolean;
  tool_detail_storage_kind?: string;
  tool_transfer_projection?: unknown;
  search_indexed?: boolean;
  direct_matrix_harness_write_used?: boolean;
  real_codex_e2e_claimed?: boolean;
  full_provider_parity_claimed?: boolean;
  renderer?: string;
};

export function getOysterunSemanticPayload(content: unknown): OysterunSemanticPayload | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const payload = (content as Record<string, unknown>)[OYSTERUN_SEMANTIC_NAMESPACE];
  if (!payload || typeof payload !== 'object') return undefined;
  return payload as OysterunSemanticPayload;
}

function normalizeOysterunSemanticString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function isOysterunProviderCompletionMarkerPayload(
  payload: OysterunSemanticPayload | undefined,
): boolean {
  if (!payload) return false;
  const semanticType = normalizeOysterunSemanticString(
    payload.semantic_type ?? payload.semantic_category,
  );
  if (semanticType !== 'session_lifecycle') return false;
  if (
    normalizeOysterunSemanticString(payload.provider_completion_marker) !==
    OYSTERUN_PROVIDER_COMPLETION_MARKER
  ) {
    return false;
  }
  const completionState = normalizeOysterunSemanticString(payload.provider_completion_state);
  return (
    completionState !== OYSTERUN_PROVIDER_COMPLETION_PENDING_STATE &&
    OYSTERUN_PROVIDER_COMPLETION_TERMINAL_STATES.has(completionState)
  );
}

export function isOysterunProviderCompletionMarkerContent(content: unknown): boolean {
  return isOysterunProviderCompletionMarkerPayload(getOysterunSemanticPayload(content));
}

export type OysterunSemanticControlOutcome = {
  controlRequestId: string;
  controlOutcome: string;
  controlOutcomeId?: string;
  semanticId?: string;
  matrixRoomId?: string;
  hostSessionId?: string;
  eventId?: string;
  actor?: string;
  matrixEventSender?: string;
  matrixEventSenderActorKey?: string;
  matrixEventSenderActorKind?: string;
  replayPolicy?: string;
  durable?: boolean;
};

export type OysterunSemanticBodyRenderer = (props: {
  body: string;
  customBody?: string;
}) => ReactNode;

export type OysterunToolCompressionDetail = {
  eventId?: string;
  semanticId?: string;
  semanticType: string;
  hostSessionId?: string;
  matrixRoomId?: string;
  targetTurnId?: string;
  providerTurnId?: string;
  providerTurnIdKind?: string;
  toolName?: string;
  toolCallId?: string;
  toolIsError?: boolean | null;
  payload: unknown;
  fallbackBody?: string;
  matrixEventSender?: string;
  matrixEventSenderActorKey?: string;
  matrixEventSenderActorKind?: string;
  detailAvailable?: boolean;
  detailStorageKind?: string;
  toolStorageGeneration?: string;
  toolTransferProjection?: unknown;
  ts?: number;
};

export type OysterunToolCompression = {
  compressionKind?: 'tool_run' | 'tool_output_batch' | 'tool_semantic_stream_page';
  totalCount: number;
  compressedCount: number;
  groupStartEventId?: string;
  groupEndEventId?: string;
  groupingKeyKind?: string;
  groupingKey?: string;
  batchIndex?: number;
  batchCount?: number;
  batchSize?: number;
  batchStartIndex?: number;
  batchEndIndex?: number;
  providerTurnId?: string;
  providerTurnIdKind?: string;
  matrixEventSender?: string;
  matrixEventSenderActorKey?: string;
  matrixEventSenderActorKind?: string;
  details: OysterunToolCompressionDetail[];
  retainedRunDetails?: OysterunToolCompressionDetail[];
};

const TOOL_SEMANTIC_TYPES = new Set([
  'tool.call',
  'tool.update',
  'tool.output',
  'tool.result',
  'tool.failure',
]);
const TERMINAL_SEMANTIC_TYPES = new Set(['terminal.command.started', 'terminal.command.result']);
const TOOL_PREVIEW_ROW_LIMIT = 5;
const TOOL_CODE_LINE_HEIGHT = 1.45;
const OYSTERUN_ROUTE_C_TOOL_EXPANSION_EVENT_PAGE_SIZE = 10;
const OYSTERUN_ROUTE_C_SELECTED_DETAIL_TOP_LIMIT_BYTES = 1024 * 1024;

export function isOysterunToolSemanticType(semanticType: string | undefined): boolean {
  return typeof semanticType === 'string' && TOOL_SEMANTIC_TYPES.has(semanticType);
}

export function isOysterunTerminalSemanticType(semanticType: string | undefined): boolean {
  return typeof semanticType === 'string' && TERMINAL_SEMANTIC_TYPES.has(semanticType);
}

const toolBoxStyle: CSSProperties = {
  marginTop: config.space.S100,
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: config.radii.R300,
  padding: config.space.S300,
  background: 'rgba(15, 23, 42, 0.04)',
};

const toolCodeBaseStyle: CSSProperties = {
  display: 'block',
  margin: 0,
  marginTop: config.space.S200,
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
  overflowX: 'auto',
  whiteSpace: 'pre',
  wordBreak: 'normal',
  overflowWrap: 'normal',
  lineHeight: String(TOOL_CODE_LINE_HEIGHT),
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

const toolPreviewCodeStyle: CSSProperties = {
  ...toolCodeBaseStyle,
  maxHeight: `calc(${TOOL_CODE_LINE_HEIGHT}em * ${TOOL_PREVIEW_ROW_LIMIT})`,
  overflowY: 'hidden',
};

const toolDetailCodeStyle: CSSProperties = {
  ...toolCodeBaseStyle,
  maxHeight: '480px',
  overflowY: 'auto',
};

const toolDetailBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'center',
  padding: 'min(16px, 4vw)',
  background: 'rgba(15, 23, 42, 0.45)',
  overflow: 'auto',
};

const toolDetailPanelStyle: CSSProperties = {
  width: 'min(960px, calc(100vw - 32px))',
  minWidth: 0,
  maxHeight: 'calc(100dvh - 32px)',
  boxSizing: 'border-box',
  overflowX: 'hidden',
  overflowY: 'auto',
  borderRadius: config.radii.R400,
  padding: config.space.S400,
  background: 'rgb(255, 255, 255)',
  color: 'rgb(15, 23, 42)',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  boxShadow: '0 24px 80px rgba(15, 23, 42, 0.35)',
};

const toolDetailEntryStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: config.radii.R300,
  padding: config.space.S300,
};

function formatToolPayload(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isOysterunRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isProjectedToolTransferSummary(value: unknown): boolean {
  if (!isOysterunRecord(value)) return false;
  return (
    value.summary_kind === 'routec_tool_transfer_summary' ||
    value.projected === true ||
    value.schema_version === 'routec.tool_message_transfer_projection.v1'
  );
}

function isProjectedToolResultSummaryDetail(detail: OysterunToolCompressionDetail): boolean {
  if (detail.semanticType !== 'tool.result' && detail.semanticType !== 'tool.failure') {
    return false;
  }
  return (
    isProjectedToolTransferSummary(detail.toolTransferProjection) ||
    isProjectedToolTransferSummary(detail.payload)
  );
}

function projectedToolPreviewSuppressionScope(
  detail: OysterunToolCompressionDetail,
  isToolOutputBatch: boolean,
): string {
  if (isToolOutputBatch) return 'tool_output_batch_summary_only';
  if (isProjectedToolResultSummaryDetail(detail)) {
    return detail.semanticType === 'tool.failure'
      ? 'projected_tool_failure_summary_only'
      : 'projected_tool_result_summary_only';
  }
  return 'none';
}

function getToolDetailRenderablePayload(detail: OysterunToolCompressionDetail): unknown {
  if (detail.payload !== null && detail.payload !== undefined) return detail.payload;
  const fallbackBody = detail.fallbackBody?.trim();
  if (!fallbackBody || fallbackBody === detail.semanticType) return undefined;
  return fallbackBody;
}

function hasToolDetailIdentity(detail: OysterunToolCompressionDetail | undefined): boolean {
  return Boolean(
    detail?.detailAvailable === true &&
      detail.hostSessionId &&
      detail.matrixRoomId &&
      detail.eventId,
  );
}

function isPreferredLazyToolDetail(detail: OysterunToolCompressionDetail | undefined): boolean {
  return (
    hasToolDetailIdentity(detail) &&
    (detail?.semanticType === 'tool.result' || detail?.semanticType === 'tool.failure')
  );
}

function getPreferredLazyToolDetail(
  details: OysterunToolCompressionDetail[],
): OysterunToolCompressionDetail | undefined {
  for (let index = details.length - 1; index >= 0; index -= 1) {
    if (isPreferredLazyToolDetail(details[index])) {
      return details[index];
    }
  }
  for (let index = details.length - 1; index >= 0; index -= 1) {
    if (hasToolDetailIdentity(details[index])) {
      return details[index];
    }
  }
  return undefined;
}

function getLazyToolDetailFetchIdentity({
  details,
  retainedMatrixDetails,
}: {
  details: OysterunToolCompressionDetail[];
  retainedMatrixDetails: OysterunToolCompressionDetail[];
}): {
  detail: OysterunToolCompressionDetail | undefined;
  source: string;
} {
  const detailAvailableGroupDetail = getPreferredLazyToolDetail(details);
  if (detailAvailableGroupDetail) {
    return {
      detail: detailAvailableGroupDetail,
      source: 'detail-available-compressed-group-result-or-failure',
    };
  }
  const detailAvailableRetainedDetail = getPreferredLazyToolDetail(retainedMatrixDetails);
  if (detailAvailableRetainedDetail) {
    return {
      detail: detailAvailableRetainedDetail,
      source: 'detail-available-retained-result-or-failure',
    };
  }
  const groupIdentity = details.find(
    (detail) => detail.hostSessionId && detail.matrixRoomId && detail.eventId,
  );
  if (groupIdentity) {
    return { detail: groupIdentity, source: 'compressed-group-identity-fallback' };
  }
  return {
    detail: retainedMatrixDetails.find(
      (detail) => detail.hostSessionId && detail.matrixRoomId && detail.eventId,
    ),
    source: 'retained-matrix-identity-fallback',
  };
}

function getPrimaryToolSummaryDetail(
  details: OysterunToolCompressionDetail[],
  fallback: OysterunToolCompressionDetail,
): OysterunToolCompressionDetail {
  const preferredLazyDetail = getPreferredLazyToolDetail(details);
  if (preferredLazyDetail) {
    return preferredLazyDetail;
  }
  for (let index = details.length - 1; index >= 0; index -= 1) {
    if (
      details[index]?.semanticType === 'tool.result' ||
      details[index]?.semanticType === 'tool.failure'
    ) {
      return details[index];
    }
  }
  for (let index = details.length - 1; index >= 0; index -= 1) {
    if (details[index]?.semanticType === 'tool.call') {
      return details[index];
    }
  }
  return details[details.length - 1] ?? fallback;
}

function getFirstToolMessageSummaryDetail(
  details: OysterunToolCompressionDetail[],
  fallback: OysterunToolCompressionDetail,
): OysterunToolCompressionDetail {
  return details[0] ?? fallback;
}

function getFirstToolMessageBodyPayload(detail: OysterunToolCompressionDetail): string {
  return typeof detail.fallbackBody === 'string' ? detail.fallbackBody : '';
}

function clipToolPayloadRows(value: string): {
  text: string;
  clipped: boolean;
  rowCount: number;
} {
  if (!value) {
    return { text: '', clipped: false, rowCount: 0 };
  }
  const rows = value.split(/\r?\n/);
  return {
    text: rows.slice(0, TOOL_PREVIEW_ROW_LIMIT).join('\n'),
    clipped: rows.length > TOOL_PREVIEW_ROW_LIMIT,
    rowCount: rows.length,
  };
}

function toolTitleForSemanticType(semanticType: string, toolIsError: boolean | null | undefined) {
  if (semanticType === 'tool.call') return 'Tool Call';
  if (semanticType === 'tool.update') return 'Tool Update';
  if (semanticType === 'tool.failure' || toolIsError === true) return 'Tool Error';
  if (semanticType === 'tool.output') return 'Tool Output';
  return 'Tool Result';
}

function buildToolDetailFromPayload({
  semanticType,
  payload,
  fallbackBody,
  sourceEventId,
}: {
  semanticType: string;
  payload: OysterunSemanticPayload;
  fallbackBody: string;
  sourceEventId?: string;
}): OysterunToolCompressionDetail {
  const fallbackPayload =
    fallbackBody.trim() && fallbackBody.trim() !== semanticType ? fallbackBody : undefined;
  return {
    eventId: sourceEventId,
    semanticId: typeof payload.semantic_id === 'string' ? payload.semantic_id : undefined,
    semanticType,
    hostSessionId: payload.host_session_id,
    matrixRoomId: payload.matrix_room_id,
    targetTurnId: payload.target_turn_id,
    providerTurnId: payload.provider_turn_id,
    providerTurnIdKind: payload.provider_turn_id_kind,
    toolName: payload.tool_name,
    toolCallId: payload.tool_call_id,
    toolIsError: payload.tool_is_error,
    payload:
      semanticType === 'tool.call'
        ? payload.tool_input ?? fallbackPayload
        : payload.tool_content ?? payload.tool_input ?? fallbackPayload,
    fallbackBody,
    matrixEventSender: payload.matrix_event_sender,
    matrixEventSenderActorKey: payload.matrix_event_sender_actor_key,
    matrixEventSenderActorKind: payload.matrix_event_sender_actor_kind,
    detailAvailable: payload.tool_detail_available === true || payload.detail_available === true,
    detailStorageKind:
      typeof payload.tool_detail_storage_kind === 'string'
        ? payload.tool_detail_storage_kind
        : undefined,
    toolStorageGeneration:
      typeof payload.tool_storage_generation === 'string'
        ? payload.tool_storage_generation
        : undefined,
    toolTransferProjection: payload.tool_transfer_projection,
  };
}

function OysterunToolDetailView({
  compression,
  details,
  onClose,
}: {
  compression?: OysterunToolCompression;
  details: OysterunToolCompressionDetail[];
  onClose: () => void;
}) {
  const isToolOutputBatch = compression?.compressionKind === 'tool_output_batch';
  const isToolSemanticStreamPage = compression?.compressionKind === 'tool_semantic_stream_page';
  const isFlatToolPage = isToolOutputBatch || isToolSemanticStreamPage;
  const detailLimit = isFlatToolPage ? compression?.batchSize ?? details.length : 'none';
  const detailTitle = isToolSemanticStreamPage
    ? 'Tool Message Group'
    : isToolOutputBatch
    ? 'Tool Output Batch'
    : 'Tool Usage';
  const retainedMatrixDetails = compression?.retainedRunDetails?.length
    ? compression.retainedRunDetails
    : details;
  const retainedMatrixPageDetails = details.slice(
    0,
    OYSTERUN_ROUTE_C_TOOL_EXPANSION_EVENT_PAGE_SIZE,
  );
  const lazyDetailFetchIdentity = getLazyToolDetailFetchIdentity({
    details,
    retainedMatrixDetails,
  });
  const retainedIdentity = lazyDetailFetchIdentity.detail;
  const retainedHostSessionId = retainedIdentity?.hostSessionId ?? '';
  const retainedMatrixRoomId = retainedIdentity?.matrixRoomId ?? '';
  const retainedMatrixEventId = retainedIdentity?.eventId ?? '';
  const retainedToolStorageGeneration = retainedIdentity?.toolStorageGeneration ?? '';
  const [toolEventDetailPage, setToolEventDetailPage] = useState(1);
  const [knownToolEventDetailPageCount, setKnownToolEventDetailPageCount] = useState(1);
  const [toolEventDetail, setToolEventDetail] = useState<OysterunToolEventDetailResponse | null>(
    null,
  );
  const [toolEventDetailLoading, setToolEventDetailLoading] = useState(false);
  const [toolEventDetailError, setToolEventDetailError] = useState('');
  const canLoadToolEventDetail = Boolean(
    retainedHostSessionId &&
      retainedMatrixRoomId &&
      retainedMatrixEventId &&
      retainedToolStorageGeneration === OYSTERUN_TOOL_STORAGE_GENERATION_SQLITE,
  );
  const toolEventDetailRequestKey = canLoadToolEventDetail
    ? JSON.stringify([
        retainedHostSessionId,
        retainedMatrixRoomId,
        retainedMatrixEventId,
        retainedToolStorageGeneration,
        toolEventDetailPage,
      ])
    : '';
  const activeToolEventDetailRequestKeyRef = useRef('');
  const toolEventDetailResponseCacheRef = useRef(
    new Map<string, OysterunToolEventDetailResponse>(),
  );
  const toolEventDetailRequestCacheRef = useRef(
    new Map<string, Promise<OysterunToolEventDetailResponse>>(),
  );

  useEffect(() => {
    let canceled = false;
    activeToolEventDetailRequestKeyRef.current = toolEventDetailRequestKey;
    if (canLoadToolEventDetail) {
      const cachedResponse = toolEventDetailResponseCacheRef.current.get(toolEventDetailRequestKey);
      if (cachedResponse) {
        setToolEventDetail(cachedResponse);
        setKnownToolEventDetailPageCount(cachedResponse.page_count ?? 1);
        setToolEventDetailError('');
        setToolEventDetailLoading(false);
        return () => {
          canceled = true;
        };
      }

      setToolEventDetailLoading(true);
      setToolEventDetailError('');
      let request = toolEventDetailRequestCacheRef.current.get(toolEventDetailRequestKey);
      if (!request) {
        request = getOysterunToolEventDetail({
          sessionId: retainedHostSessionId,
          matrixRoomId: retainedMatrixRoomId,
          matrixEventId: retainedMatrixEventId,
          toolStorageGeneration: OYSTERUN_TOOL_STORAGE_GENERATION_SQLITE,
          page: toolEventDetailPage,
        });
        toolEventDetailRequestCacheRef.current.set(toolEventDetailRequestKey, request);
        request.then(
          () => {
            if (toolEventDetailRequestCacheRef.current.get(toolEventDetailRequestKey) === request) {
              toolEventDetailRequestCacheRef.current.delete(toolEventDetailRequestKey);
            }
          },
          () => {
            if (toolEventDetailRequestCacheRef.current.get(toolEventDetailRequestKey) === request) {
              toolEventDetailRequestCacheRef.current.delete(toolEventDetailRequestKey);
            }
          },
        );
      }
      request
        .then((response) => {
          toolEventDetailResponseCacheRef.current.set(toolEventDetailRequestKey, response);
          if (
            canceled ||
            activeToolEventDetailRequestKeyRef.current !== toolEventDetailRequestKey
          ) {
            return;
          }
          setToolEventDetail(response);
          setKnownToolEventDetailPageCount(response.page_count ?? 1);
          setToolEventDetailLoading(false);
        })
        .catch((err: unknown) => {
          if (
            canceled ||
            activeToolEventDetailRequestKeyRef.current !== toolEventDetailRequestKey
          ) {
            return;
          }
          setToolEventDetailError(err instanceof Error ? err.message : String(err));
          setToolEventDetailLoading(false);
        });
    } else {
      setToolEventDetail(null);
      setKnownToolEventDetailPageCount(1);
      setToolEventDetailError('');
      setToolEventDetailLoading(false);
    }
    return () => {
      canceled = true;
    };
  }, [
    canLoadToolEventDetail,
    retainedHostSessionId,
    retainedMatrixRoomId,
    retainedMatrixEventId,
    retainedToolStorageGeneration,
    toolEventDetailPage,
    toolEventDetailRequestKey,
  ]);

  const detailMatchesRequestedPage = toolEventDetail?.page === toolEventDetailPage;
  const invocations: OysterunToolLifecycleInvocation[] =
    detailMatchesRequestedPage && !toolEventDetailError ? toolEventDetail?.invocations ?? [] : [];
  const toolEventDetailPageCount = knownToolEventDetailPageCount;
  const showToolEventDetailControls =
    canLoadToolEventDetail && (toolEventDetailPageCount > 1 || toolEventDetailPage > 1);
  const toolEventDetailFallbackReason =
    invocations.length > 0
      ? 'logical_invocations_loaded'
      : canLoadToolEventDetail && toolEventDetailLoading
      ? 'waiting_for_lazy_endpoint'
      : canLoadToolEventDetail && toolEventDetailError
      ? 'lazy_endpoint_error_without_retained_summary_fallback'
      : canLoadToolEventDetail && toolEventDetail && invocations.length === 0
      ? 'lazy_endpoint_empty_without_retained_summary_fallback'
      : canLoadToolEventDetail
      ? 'lazy_endpoint_pending_without_retained_summary_fallback'
      : 'no_detail_available_fetch_identity';
  const toolEventDetailFallbackAllowed = !canLoadToolEventDetail;
  const toolEventDetailDisplaySource =
    invocations.length > 0
      ? 'p011_unified_tool_lifecycle_detail_endpoint'
      : toolEventDetailFallbackAllowed
      ? 'retained_matrix_without_lazy_detail'
      : toolEventDetailLoading
      ? 'p131_tool_event_detail_loading'
      : toolEventDetailError
      ? 'p131_tool_event_detail_error'
      : toolEventDetail && invocations.length === 0
      ? 'p131_tool_event_detail_empty'
      : 'p131_tool_event_detail_pending';
  const p153FlatPageEntrySource =
    invocations.length > 0 ? 'p011_logical_invocation_page' : 'retained_matrix_flat_tool_page';
  const selectedDetailLimitBytes =
    toolEventDetail?.selected_detail_limit_bytes ??
    OYSTERUN_ROUTE_C_SELECTED_DETAIL_TOP_LIMIT_BYTES;
  const selectedDetailTruncated = toolEventDetail?.selected_detail_truncated === true;
  const debugToolDetailSourceUiEnabled =
    toolEventDetail?.debug_tool_detail_source_ui_enabled === true;
  const displayRows: OysterunToolCompressionDetail[] = canLoadToolEventDetail
    ? []
    : retainedMatrixPageDetails;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${detailTitle} detail`}
      style={toolDetailBackdropStyle}
      data-testid="oysterun-routec-tool-detail-view"
      data-oysterun-clean-session-testid="oysterun-clean-session-tool-detail-view"
      data-oysterun-selectable-message-content="true"
      data-oysterun-tool-detail-view={
        isToolSemanticStreamPage
          ? 'current-tool-semantic-stream-page'
          : isToolOutputBatch
          ? 'current-tool-output-batch'
          : 'all-compressed-tool-messages'
      }
      data-oysterun-tool-detail-total-count={String(compression?.totalCount ?? details.length)}
      data-oysterun-tool-detail-compressed-count={String(compression?.compressedCount ?? 0)}
      data-oysterun-tool-detail-limit={String(detailLimit)}
      data-oysterun-tool-detail-visible-count={String(details.length)}
      data-oysterun-large-tool-retained-page1-count={String(retainedMatrixDetails.length)}
      data-oysterun-large-tool-page1-source="retained-matrix-run"
      data-oysterun-tool-output-batch={String(isToolOutputBatch)}
      data-oysterun-p153-tool-semantic-stream-page={String(isToolSemanticStreamPage)}
      data-oysterun-p153-flat-page-size={String(OYSTERUN_ROUTE_C_TOOL_EXPANSION_EVENT_PAGE_SIZE)}
      data-oysterun-p153-flat-page-visible-count={String(retainedMatrixPageDetails.length)}
      data-oysterun-p153-flat-page-entry-source={p153FlatPageEntrySource}
      data-oysterun-p017-sqlite-continuation-order="endpoint-response-order"
      data-oysterun-p017-tool-storage-generation={retainedIdentity?.toolStorageGeneration}
      data-oysterun-p153-p131-detail-row-scoped="true"
      data-oysterun-p153-p131-detail-replaces-flat-page="false"
      data-oysterun-tool-output-batch-index={compression?.batchIndex}
      data-oysterun-tool-output-batch-count={compression?.batchCount}
      data-oysterun-tool-output-batch-size={compression?.batchSize}
      data-oysterun-tool-output-batch-start-index={compression?.batchStartIndex}
      data-oysterun-tool-output-batch-end-index={compression?.batchEndIndex}
      data-oysterun-p011-logical-detail-page={String(toolEventDetailPage)}
      data-oysterun-p011-logical-detail-page-count={String(toolEventDetailPageCount)}
      data-oysterun-p011-logical-invocation-count={String(
        toolEventDetail?.logical_invocation_count ?? invocations.length,
      )}
      data-oysterun-p011-physical-event-count={String(
        toolEventDetail?.physical_event_count ?? retainedMatrixDetails.length,
      )}
      data-oysterun-p011-local-tool-paths-preserved={String(
        toolEventDetail?.tool_payload_local_paths_preserved === true,
      )}
      data-oysterun-p131-tool-detail-available={String(canLoadToolEventDetail)}
      data-oysterun-p131-tool-detail-loading={String(toolEventDetailLoading)}
      data-oysterun-p131-tool-detail-page={String(toolEventDetailPage)}
      data-oysterun-p131-tool-detail-page-count={String(toolEventDetailPageCount)}
      data-oysterun-p131-tool-detail-fetch-event-id={retainedIdentity?.eventId}
      data-oysterun-p131-tool-detail-fetch-semantic-type={retainedIdentity?.semanticType}
      data-oysterun-p131-tool-detail-fetch-identity-source={lazyDetailFetchIdentity.source}
      data-oysterun-p131-tool-detail-fetch-storage-kind={retainedIdentity?.detailStorageKind}
      data-oysterun-p131-tool-detail-fetched-row-count={String(invocations.length)}
      data-oysterun-p131-tool-detail-retained-fallback-row-count={String(
        retainedMatrixDetails.length,
      )}
      data-oysterun-p131-tool-detail-fallback-allowed={String(toolEventDetailFallbackAllowed)}
      data-oysterun-p131-tool-detail-fallback-reason={toolEventDetailFallbackReason}
      data-oysterun-p131-tool-detail-display-source={toolEventDetailDisplaySource}
      data-oysterun-p143-expansion-event-page-size={String(
        OYSTERUN_ROUTE_C_TOOL_EXPANSION_EVENT_PAGE_SIZE,
      )}
      data-oysterun-p143-detail-source-selection={toolEventDetailDisplaySource}
      data-oysterun-p143-retained-summary-fallback-masking="false"
      data-oysterun-p143-selected-detail-top-only="true"
      data-oysterun-p143-selected-detail-limit-bytes={String(selectedDetailLimitBytes)}
      data-oysterun-p143-selected-detail-truncated={String(selectedDetailTruncated)}
      data-oysterun-p143-debug-source-ui-enabled={String(debugToolDetailSourceUiEnabled)}
      data-oysterun-p143-safe-text-rendering="react-text-node"
    >
      <Box direction="Column" gap="300" style={toolDetailPanelStyle}>
        <Box justifyContent="SpaceBetween" alignItems="Center" gap="300">
          <Box direction="Column" gap="100">
            <Text as="strong" size="H4">
              {detailTitle}
            </Text>
            <Text as="span" size="T200" priority="300">
              {toolEventDetail
                ? `${
                    toolEventDetail.logical_invocation_count ?? invocations.length
                  } tool invocations / ${
                    toolEventDetail.physical_event_count ?? displayRows.length
                  } events`
                : `${displayRows.length} tool messages`}
            </Text>
          </Box>
          <Button type="button" size="300" variant="Secondary" radii="300" onClick={onClose}>
            <Text as="span" size="T300">
              Close
            </Text>
          </Button>
        </Box>
        {showToolEventDetailControls && (
          <Box alignItems="Center" gap="200" wrap="Wrap">
            <Button
              type="button"
              size="300"
              variant="Secondary"
              radii="300"
              disabled={toolEventDetailPage <= 1}
              onClick={() => setToolEventDetailPage((page) => Math.max(1, page - 1))}
              data-oysterun-p131-tool-detail-page-prev="lazy-detail-navigation"
            >
              <Text as="span" size="T300">
                Previous
              </Text>
            </Button>
            <Text as="span" size="T200" priority="300">
              {`Page ${toolEventDetailPage} of ${toolEventDetailPageCount}`}
            </Text>
            <Button
              type="button"
              size="300"
              variant="Secondary"
              radii="300"
              disabled={toolEventDetailPage >= toolEventDetailPageCount}
              onClick={() => setToolEventDetailPage((page) => page + 1)}
              data-oysterun-p131-tool-detail-page-next="lazy-detail-navigation"
            >
              <Text as="span" size="T300">
                Next
              </Text>
            </Button>
          </Box>
        )}
        {toolEventDetailLoading && (
          <Text as="span" size="T200" priority="300">
            Loading full tool detail...
          </Text>
        )}
        {toolEventDetailError && (
          <Text as="span" size="T200" priority="300">
            {toolEventDetailError}
          </Text>
        )}
        <Box direction="Column" gap="300">
          {invocations.length > 0
            ? invocations.map((invocation, index) => {
                const sections = [
                  { label: 'Call', value: invocation.call },
                  {
                    label: `Updates (${invocation.updates.length})`,
                    value: invocation.updates.length > 0 ? invocation.updates : null,
                  },
                  { label: 'Output', value: invocation.output },
                  { label: 'Result', value: invocation.result },
                ].filter((section) => section.value !== null && section.value !== undefined);
                return (
                  <article
                    key={`${invocation.provider_turn_id ?? 'turn'}-${invocation.tool_call_id}`}
                    style={toolDetailEntryStyle}
                    data-testid="oysterun-routec-tool-invocation-detail"
                    data-oysterun-p011-logical-invocation-index={String(index)}
                    data-oysterun-tool-call-id={invocation.tool_call_id}
                    data-oysterun-tool-name={invocation.tool_name ?? undefined}
                    data-oysterun-tool-invocation-state={invocation.state}
                    data-oysterun-tool-physical-event-count={String(
                      invocation.physical_event_count,
                    )}
                    data-oysterun-tool-late-update-count={String(invocation.late_update_count)}
                  >
                    <Box direction="Column" gap="300">
                      <Box alignItems="Center" gap="200" wrap="Wrap">
                        <Text as="strong" size="T300">
                          Tool Invocation
                        </Text>
                        {invocation.tool_name && (
                          <Text as="code" size="T200">
                            {invocation.tool_name}
                          </Text>
                        )}
                        <Text as="span" size="T200" priority="300">
                          {invocation.tool_call_id}
                        </Text>
                        <Text as="span" size="T200" priority="300">
                          {invocation.state}
                        </Text>
                      </Box>
                      {sections.map((section) => {
                        const sectionCode = formatToolPayload(section.value);
                        return (
                          <section key={section.label}>
                            <Text as="strong" size="T200">
                              {section.label}
                            </Text>
                            {sectionCode && (
                              <pre style={toolDetailCodeStyle}>
                                <code>{sectionCode}</code>
                              </pre>
                            )}
                          </section>
                        );
                      })}
                    </Box>
                  </article>
                );
              })
            : displayRows.map((detail, index) => {
                const fullCode = formatToolPayload(getToolDetailRenderablePayload(detail));
                return (
                  <article
                    key={detail.eventId ?? detail.semanticId ?? `${detail.semanticType}-${index}`}
                    style={toolDetailEntryStyle}
                    data-testid="oysterun-routec-tool-detail-entry"
                    data-oysterun-clean-session-testid="oysterun-clean-session-tool-detail-entry"
                    data-oysterun-tool-detail-entry-index={String(index)}
                    data-oysterun-p131-tool-detail-entry-source={p153FlatPageEntrySource}
                    data-oysterun-p153-flat-page-entry-source={p153FlatPageEntrySource}
                    data-oysterun-tool-semantic-type={detail.semanticType}
                    data-oysterun-host-session-id={detail.hostSessionId}
                    data-oysterun-target-turn-id={detail.targetTurnId}
                    data-oysterun-provider-turn-id={detail.providerTurnId}
                    data-oysterun-provider-turn-id-kind={detail.providerTurnIdKind}
                    data-oysterun-tool-name={detail.toolName}
                    data-oysterun-tool-call-id={detail.toolCallId}
                    data-oysterun-matrix-event-id={detail.eventId}
                    data-oysterun-matrix-room-id={detail.matrixRoomId}
                    data-oysterun-matrix-event-sender={detail.matrixEventSender}
                    data-oysterun-matrix-event-sender-actor-key={detail.matrixEventSenderActorKey}
                    data-oysterun-matrix-event-sender-actor-kind={detail.matrixEventSenderActorKind}
                  >
                    <Box direction="Column" gap="200">
                      <Box alignItems="Center" gap="200" wrap="Wrap">
                        <Text as="strong" size="T300">
                          {toolTitleForSemanticType(detail.semanticType, detail.toolIsError)}
                        </Text>
                        {detail.toolName && (
                          <Text as="code" size="T200">
                            {detail.toolName}
                          </Text>
                        )}
                        {detail.toolCallId && (
                          <Text as="span" size="T200" priority="300">
                            {detail.toolCallId}
                          </Text>
                        )}
                      </Box>
                      {fullCode && (
                        <pre style={toolDetailCodeStyle}>
                          <code>{fullCode}</code>
                        </pre>
                      )}
                    </Box>
                  </article>
                );
              })}
        </Box>
      </Box>
    </div>
  );
}

function OysterunToolSemanticBox({
  semanticType,
  payload,
  fallbackBody,
  sourceEventId,
  compression,
}: {
  semanticType: string;
  payload: OysterunSemanticPayload;
  fallbackBody: string;
  sourceEventId?: string;
  compression?: OysterunToolCompression;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const currentDetail = buildToolDetailFromPayload({
    semanticType,
    payload,
    fallbackBody,
    sourceEventId,
  });
  const details = compression?.details.length ? compression.details : [currentDetail];
  const isToolOutputBatch = compression?.compressionKind === 'tool_output_batch';
  const isToolSemanticStreamPage = compression?.compressionKind === 'tool_semantic_stream_page';
  const primaryDetail = isToolSemanticStreamPage
    ? getFirstToolMessageSummaryDetail(details, currentDetail)
    : getPrimaryToolSummaryDetail(details, currentDetail);
  const payloadCode = isToolSemanticStreamPage
    ? formatToolPayload(getFirstToolMessageBodyPayload(primaryDetail))
    : formatToolPayload(getToolDetailRenderablePayload(primaryDetail));
  const rawPreview = clipToolPayloadRows(payloadCode);
  const previewSuppressionScope = isToolSemanticStreamPage
    ? 'none'
    : projectedToolPreviewSuppressionScope(primaryDetail, isToolOutputBatch);
  const projectedToolPreviewSuppressed = previewSuppressionScope !== 'none';
  const preview = projectedToolPreviewSuppressed
    ? { text: '', clipped: false, rowCount: 0 }
    : rawPreview;
  const previewSuppressed = projectedToolPreviewSuppressed && rawPreview.text.length > 0;
  const toolOutputBatchPreviewSuppressed = isToolOutputBatch && previewSuppressed;
  const toolTitle = isToolSemanticStreamPage
    ? 'Tool Message Group'
    : isToolOutputBatch
    ? 'Tool Output Batch'
    : toolTitleForSemanticType(primaryDetail.semanticType, primaryDetail.toolIsError);
  const totalCount = compression?.totalCount ?? details.length;
  const compressedCount = compression?.compressedCount ?? Math.max(0, totalCount - 1);
  const isCompressedGroup = isToolSemanticStreamPage || totalCount > 1 || compressedCount > 0;
  const hasToolDetailFetchIdentity = Boolean(
    primaryDetail.hostSessionId &&
      primaryDetail.matrixRoomId &&
      primaryDetail.eventId &&
      primaryDetail.toolStorageGeneration === OYSTERUN_TOOL_STORAGE_GENERATION_SQLITE,
  );
  const hasDetailView =
    isCompressedGroup ||
    preview.clipped ||
    primaryDetail.detailAvailable === true ||
    hasToolDetailFetchIdentity;

  return (
    <Box
      direction="Column"
      gap="200"
      style={toolBoxStyle}
      data-testid="oysterun-routec-tool-semantic-message-box"
      data-oysterun-clean-session-testid="oysterun-clean-session-tool-semantic-message-box"
      data-oysterun-selectable-message-content="true"
      data-oysterun-tool-renderer="tool-special-message-box"
      data-oysterun-tool-json-render-path="pre_code_pretty_json"
      data-oysterun-tool-preview-row-limit={String(TOOL_PREVIEW_ROW_LIMIT)}
      data-oysterun-tool-preview-clipped={String(preview.clipped)}
      data-oysterun-tool-preview-row-count={String(preview.rowCount)}
      data-oysterun-tool-preview-suppressed={String(previewSuppressed)}
      data-oysterun-tool-output-batch-preview-suppressed={String(toolOutputBatchPreviewSuppressed)}
      data-oysterun-projected-tool-result-preview-suppressed={String(
        previewSuppressionScope === 'projected_tool_result_summary_only',
      )}
      data-oysterun-projected-tool-failure-preview-suppressed={String(
        previewSuppressionScope === 'projected_tool_failure_summary_only',
      )}
      data-oysterun-tool-preview-suppression-scope={previewSuppressionScope}
      data-oysterun-tool-code-block-width="full"
      data-oysterun-tool-code-wrap="false"
      data-oysterun-tool-raw-body-rendered="false"
      data-oysterun-tool-semantic-type={primaryDetail.semanticType}
      data-oysterun-tool-primary-summary-source={
        isToolSemanticStreamPage
          ? 'first-tool-message-body'
          : isPreferredLazyToolDetail(primaryDetail)
          ? 'detail-available-tool-result-or-failure'
          : primaryDetail.semanticType === 'tool.call'
          ? 'last-tool-call'
          : 'last-available-tool-event'
      }
      data-oysterun-p153-first-message-preview-source={
        isToolSemanticStreamPage ? 'first-message-body-only' : undefined
      }
      data-oysterun-host-session-id={primaryDetail.hostSessionId ?? payload.host_session_id}
      data-oysterun-target-turn-id={primaryDetail.targetTurnId ?? payload.target_turn_id}
      data-oysterun-provider-turn-id={
        primaryDetail.providerTurnId ?? compression?.providerTurnId ?? payload.provider_turn_id
      }
      data-oysterun-provider-turn-id-kind={
        primaryDetail.providerTurnIdKind ??
        compression?.providerTurnIdKind ??
        payload.provider_turn_id_kind
      }
      data-oysterun-tool-name={primaryDetail.toolName}
      data-oysterun-tool-call-id={primaryDetail.toolCallId}
      data-oysterun-tool-storage-generation={primaryDetail.toolStorageGeneration}
      data-oysterun-tool-is-error={
        typeof primaryDetail.toolIsError === 'boolean'
          ? String(primaryDetail.toolIsError)
          : undefined
      }
      data-oysterun-tool-compressed={String(isCompressedGroup)}
      data-oysterun-tool-total-count={String(totalCount)}
      data-oysterun-tool-compressed-count={String(compressedCount)}
      data-oysterun-tool-compression-limit={
        isToolOutputBatch || isToolSemanticStreamPage
          ? String(compression?.batchSize ?? details.length)
          : 'none'
      }
      data-oysterun-tool-compression-kind={compression?.compressionKind ?? 'single_tool_message'}
      data-oysterun-tool-output-batch={String(isToolOutputBatch)}
      data-oysterun-p153-tool-semantic-stream-page={String(isToolSemanticStreamPage)}
      data-oysterun-tool-output-batch-index={compression?.batchIndex}
      data-oysterun-tool-output-batch-count={compression?.batchCount}
      data-oysterun-tool-output-batch-size={compression?.batchSize}
      data-oysterun-tool-output-batch-start-index={compression?.batchStartIndex}
      data-oysterun-tool-output-batch-end-index={compression?.batchEndIndex}
      data-oysterun-tool-compression-group-start-event-id={compression?.groupStartEventId}
      data-oysterun-tool-compression-group-end-event-id={compression?.groupEndEventId}
      data-oysterun-tool-compression-grouping-key-kind={compression?.groupingKeyKind}
      data-oysterun-tool-compression-grouping-key={compression?.groupingKey}
      data-oysterun-p131-tool-detail-available={String(primaryDetail.detailAvailable === true)}
      data-oysterun-p131-tool-detail-storage-kind={primaryDetail.detailStorageKind}
      data-oysterun-matrix-event-sender={
        primaryDetail.matrixEventSender ?? payload.matrix_event_sender ?? undefined
      }
      data-oysterun-matrix-event-sender-actor-key={
        primaryDetail.matrixEventSenderActorKey ??
        payload.matrix_event_sender_actor_key ??
        undefined
      }
      data-oysterun-matrix-event-sender-actor-kind={
        primaryDetail.matrixEventSenderActorKind ??
        payload.matrix_event_sender_actor_kind ??
        undefined
      }
    >
      <Box alignItems="Center" gap="200" wrap="Wrap">
        <Text as="strong" size="T300">
          {toolTitle}
        </Text>
        {primaryDetail.toolName && (
          <Text as="code" size="T200">
            {primaryDetail.toolName}
          </Text>
        )}
        {primaryDetail.toolCallId && (
          <Text as="span" size="T200" priority="300">
            {primaryDetail.toolCallId}
          </Text>
        )}
        {isCompressedGroup && (
          <Text as="span" size="T200" priority="300">
            {`${compressedCount} compressed / ${totalCount} total`}
          </Text>
        )}
      </Box>
      {preview.text && (
        <pre
          style={toolPreviewCodeStyle}
          data-oysterun-tool-code-block-width="full"
          data-oysterun-tool-code-wrap="false"
          data-oysterun-selectable-message-content="true"
          data-oysterun-tool-preview-row-limit={String(TOOL_PREVIEW_ROW_LIMIT)}
          data-oysterun-tool-preview-clipped={String(preview.clipped)}
          data-oysterun-tool-preview-visual-row-limit={String(TOOL_PREVIEW_ROW_LIMIT)}
        >
          <code>{preview.text}</code>
        </pre>
      )}
      {hasDetailView && (
        <Box alignItems="Center" gap="200">
          <Button
            type="button"
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            onClick={() => setDetailOpen(true)}
            data-testid="oysterun-routec-tool-detail-open"
            data-oysterun-clean-session-testid="oysterun-clean-session-tool-detail-open"
            data-oysterun-tool-detail-open={
              isToolSemanticStreamPage
                ? 'current-tool-semantic-stream-page'
                : isToolOutputBatch
                ? 'current-tool-output-batch'
                : 'all-compressed-tool-messages'
            }
            data-oysterun-tool-detail-count={String(totalCount)}
            data-oysterun-tool-compressed-count={String(compressedCount)}
            data-oysterun-tool-output-batch={String(isToolOutputBatch)}
            data-oysterun-tool-output-batch-index={compression?.batchIndex}
            data-oysterun-tool-output-batch-count={compression?.batchCount}
          >
            <Text as="span" size="T300">
              View details
            </Text>
          </Button>
          {preview.clipped && (
            <Text as="span" size="T200" priority="300">
              {`${preview.rowCount} rows`}
            </Text>
          )}
        </Box>
      )}
      {detailOpen && (
        <OysterunToolDetailView
          compression={compression}
          details={details}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </Box>
  );
}

function terminalTitleForSemanticType(semanticType: string): string {
  return semanticType === 'terminal.command.started'
    ? 'Terminal Command Started'
    : 'Terminal Result';
}

function terminalStatusForPayload(semanticType: string, payload: OysterunSemanticPayload): string {
  if (semanticType === 'terminal.command.started') return 'started';
  if (payload.timed_out === true) return 'timed out';
  if (payload.interrupted === true) return 'interrupted';
  if (payload.exit_code === 0) return 'exited 0';
  if (typeof payload.exit_code === 'number') return `exited ${payload.exit_code}`;
  return 'completed';
}

function OysterunTerminalSemanticBox({
  semanticType,
  payload,
  fallbackBody,
}: {
  semanticType: string;
  payload: OysterunSemanticPayload;
  fallbackBody: string;
}) {
  const stdout = typeof payload.stdout === 'string' ? payload.stdout : '';
  const stderr = typeof payload.stderr === 'string' ? payload.stderr : '';
  const hasOutput = Boolean(stdout || stderr);
  const status = terminalStatusForPayload(semanticType, payload);

  return (
    <Box
      direction="Column"
      gap="200"
      style={toolBoxStyle}
      data-testid="oysterun-routec-terminal-semantic-message-box"
      data-oysterun-clean-session-testid="oysterun-clean-session-terminal-semantic-message-box"
      data-oysterun-selectable-message-content="true"
      data-oysterun-terminal-renderer="matrix-terminal-command"
      data-oysterun-terminal-render-source="matrix-semantic-payload"
      data-oysterun-terminal-semantic-type={semanticType}
      data-oysterun-terminal-exec-id={payload.terminal_exec_id}
      data-oysterun-terminal-command={payload.command}
      data-oysterun-terminal-cwd={payload.cwd}
      data-oysterun-terminal-started-at={payload.started_at}
      data-oysterun-terminal-completed-at={payload.completed_at}
      data-oysterun-terminal-exit-code={
        typeof payload.exit_code === 'number' ? String(payload.exit_code) : undefined
      }
      data-oysterun-terminal-duration-ms={
        typeof payload.duration_ms === 'number' ? String(payload.duration_ms) : undefined
      }
      data-oysterun-terminal-timed-out={
        typeof payload.timed_out === 'boolean' ? String(payload.timed_out) : undefined
      }
      data-oysterun-terminal-interrupted={
        typeof payload.interrupted === 'boolean' ? String(payload.interrupted) : undefined
      }
      data-oysterun-terminal-interrupt-reason={payload.interrupt_reason ?? undefined}
      data-oysterun-terminal-stdout-truncated={
        typeof payload.stdout_truncated === 'boolean' ? String(payload.stdout_truncated) : undefined
      }
      data-oysterun-terminal-stderr-truncated={
        typeof payload.stderr_truncated === 'boolean' ? String(payload.stderr_truncated) : undefined
      }
      data-oysterun-provider-delivery-attempted={String(
        payload.provider_delivery_attempted === true,
      )}
      data-oysterun-normal-message-user-sent={String(payload.normal_message_user_sent === true)}
      data-oysterun-browser-shell-execution={String(payload.browser_shell_execution === true)}
      data-oysterun-host-db-transcript-product-truth={String(
        payload.host_db_transcript_product_truth === true,
      )}
      data-oysterun-terminal-matrix-message-user-sent="false"
      data-oysterun-terminal-provider-delivery-attempted="false"
      data-oysterun-terminal-host-db-transcript-product-truth="false"
      data-oysterun-terminal-body-fallback-rendered={String(!hasOutput)}
    >
      <Box alignItems="Center" gap="200" wrap="Wrap">
        <Text as="strong" size="T300">
          {terminalTitleForSemanticType(semanticType)}
        </Text>
        <Text as="code" size="T200">
          {payload.terminal_exec_id ?? 'terminal'}
        </Text>
        <Text as="span" size="T200" priority="300">
          {status}
        </Text>
      </Box>
      {payload.command && (
        <pre
          style={toolCodeBaseStyle}
          data-oysterun-terminal-command-block="true"
          data-oysterun-terminal-code-wrap="false"
          data-oysterun-selectable-message-content="true"
        >
          <code>{`$ ${payload.command}`}</code>
        </pre>
      )}
      {payload.cwd && (
        <Text as="span" size="T200" priority="300">
          {payload.cwd}
        </Text>
      )}
      {stdout && (
        <pre
          style={toolCodeBaseStyle}
          data-oysterun-terminal-stream="stdout"
          data-oysterun-terminal-code-wrap="false"
          data-oysterun-selectable-message-content="true"
        >
          <code>{stdout}</code>
        </pre>
      )}
      {stderr && (
        <pre
          style={toolCodeBaseStyle}
          data-oysterun-terminal-stream="stderr"
          data-oysterun-terminal-code-wrap="false"
          data-oysterun-selectable-message-content="true"
        >
          <code>{stderr}</code>
        </pre>
      )}
      {!hasOutput && fallbackBody && (
        <Text as="span" size="T200" priority="300">
          {fallbackBody}
        </Text>
      )}
    </Box>
  );
}

function isOysterunSemanticControlOutcome(
  value: OysterunSemanticControlOutcome | undefined,
  requestId: string | undefined,
): value is OysterunSemanticControlOutcome {
  return Boolean(value && requestId && value.controlRequestId === requestId);
}

function requiredSemanticPayloadString(value: string | undefined, field: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`Oysterun semantic renderer payload missing required field: ${field}.`);
}

type OysterunMcpElicitationPayload = {
  serverName: string;
  mode: 'form' | 'openai/form' | 'url';
  message: string;
  requestedSchema?: Record<string, unknown>;
  url?: string;
  meta: unknown;
};

type OysterunPluginInstallSuggestion = {
  toolId: string;
  toolName: string;
  reason: string;
  marketplace: string;
};

function normalizeMcpElicitationPayload(value: unknown): OysterunMcpElicitationPayload | undefined {
  if (!isOysterunRecord(value)) return undefined;
  const { mode } = value;
  if (mode !== 'form' && mode !== 'openai/form' && mode !== 'url') return undefined;
  const serverName = typeof value.serverName === 'string' ? value.serverName.trim() : '';
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!serverName || !message) return undefined;
  return {
    serverName,
    mode,
    message,
    requestedSchema: isOysterunRecord(value.requestedSchema) ? value.requestedSchema : undefined,
    url: typeof value.url === 'string' ? value.url.trim() : undefined,
    meta: value._meta ?? null,
  };
}

function safeMcpElicitationUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function requiredPluginSuggestionMetaString(
  meta: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizePluginInstallSuggestion(
  payload: OysterunMcpElicitationPayload,
): OysterunPluginInstallSuggestion | undefined {
  if (payload.serverName !== 'codex_apps' || payload.mode !== 'form') return undefined;
  if (!isOysterunRecord(payload.meta)) return undefined;
  if (
    payload.meta.codex_approval_kind !== 'tool_suggestion' ||
    payload.meta.tool_type !== 'plugin' ||
    payload.meta.suggest_type !== 'install'
  ) {
    return undefined;
  }
  const toolId = requiredPluginSuggestionMetaString(payload.meta, 'tool_id');
  const toolName = requiredPluginSuggestionMetaString(payload.meta, 'tool_name');
  const reason = requiredPluginSuggestionMetaString(payload.meta, 'suggest_reason');
  if (!toolId || !toolName || !reason) return undefined;
  const separatorIndex = toolId.lastIndexOf('@');
  const marketplace = separatorIndex >= 0 ? toolId.slice(separatorIndex + 1) : 'Codex';
  return { toolId, toolName, reason, marketplace };
}

function OysterunPluginSuggestionPanel({
  requestId,
  payload,
  suggestion,
  disabled,
  finalOutcome,
  controlError,
  onDecline,
}: {
  requestId: string;
  payload: OysterunMcpElicitationPayload;
  suggestion: OysterunPluginInstallSuggestion;
  disabled: boolean;
  finalOutcome?: string;
  controlError: string | null;
  onDecline: (response: OysterunMcpElicitationResponse) => Promise<boolean>;
}) {
  const [pendingTerminal, setPendingTerminal] = useState<'oysterun' | 'host' | null>(null);

  useEffect(() => {
    setPendingTerminal(null);
  }, [requestId]);

  const declineResponse: OysterunMcpElicitationResponse = {
    action: 'decline',
    content: null,
    _meta: payload.meta,
  };

  const useTerminal = async (terminal: 'oysterun' | 'host') => {
    if (disabled || pendingTerminal) return;
    setPendingTerminal(terminal);
    const declined = await onDecline(declineResponse);
    if (!declined) {
      setPendingTerminal(null);
      return;
    }
    if (terminal === 'oysterun') {
      window.location.assign(new URL('/app/terminal', window.location.origin).toString());
    }
  };

  const actionDisabled = disabled || pendingTerminal !== null;

  return (
    <Box
      direction="Column"
      gap="200"
      data-testid="oysterun-routec-plugin-suggestion-surface"
      data-oysterun-control-request-id={requestId}
      data-oysterun-plugin-suggestion-stage="external-setup-required"
      data-oysterun-plugin-id={suggestion.toolId}
    >
      <Text as="strong" size="T300">
        Codex suggests installing {suggestion.toolName}
      </Text>
      <Text as="span" size="T300">
        {suggestion.reason}
      </Text>
      <Text as="span" size="T200" priority="300">
        Source: {suggestion.marketplace}
      </Text>
      <Text as="span" size="T300">
        Install and authorize this plugin in the Codex TUI. Open a terminal on the Host, run{' '}
        <code>codex</code>, enter <code>/plugins</code>, then select the plugin and complete its
        installation and authorization.
      </Text>
      <Text as="span" size="T200" priority="300">
        On desktop, use the terminal on the Host. On phone, use Oysterun Terminal. The Host
        Terminal must be opened manually because a web page cannot launch it. Retry the task in a
        new prompt after setup.
      </Text>

      {!finalOutcome && (
        <Box alignItems="Center" gap="200" wrap="Wrap">
          <Button
            type="button"
            size="300"
            variant="Primary"
            fill="Soft"
            radii="300"
            disabled={actionDisabled}
            before={
              pendingTerminal === 'oysterun' ? <Spinner size="100" variant="Primary" /> : undefined
            }
            onClick={() => useTerminal('oysterun')}
            data-testid="oysterun-routec-plugin-open-terminal-button"
          >
            <Text as="span" size="T300">
              {pendingTerminal === 'oysterun'
                ? 'Opening Oysterun Terminal...'
                : 'Open Oysterun Terminal'}
            </Text>
          </Button>
          <Button
            type="button"
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            disabled={actionDisabled}
            before={
              pendingTerminal === 'host' ? <Spinner size="100" variant="Primary" /> : undefined
            }
            onClick={() => useTerminal('host')}
            data-testid="oysterun-routec-plugin-use-host-terminal-button"
          >
            <Text as="span" size="T300">
              {pendingTerminal === 'host' ? 'Preparing Host Terminal...' : 'Use Host Terminal'}
            </Text>
          </Button>
          <Button
            type="button"
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            disabled={actionDisabled}
            onClick={() => onDecline(declineResponse)}
            data-testid="oysterun-routec-plugin-continue-without-button"
          >
            <Text as="span" size="T300">
              Continue without plugin
            </Text>
          </Button>
        </Box>
      )}

      {controlError && (
        <Text as="span" size="T200" priority="300">
          {controlError}
        </Text>
      )}
      {finalOutcome && (
        <Text as="span" size="T200" priority="300">
          Plugin request closed. In a Host terminal, run codex and use /plugins to complete setup,
          then retry when ready.
        </Text>
      )}
    </Box>
  );
}

function initialMcpFormValues(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || !isOysterunRecord(schema.properties)) return {};
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, rawField]) => {
      const field = isOysterunRecord(rawField) ? rawField : {};
      if (field.default !== undefined) return [name, field.default];
      if (field.type === 'boolean') return [name, false];
      if (field.type === 'array') return [name, []];
      return [name, ''];
    }),
  );
}

type OysterunMcpFieldOption = { value: string; label: string };

function mcpFieldOptions(
  field: Record<string, unknown>,
  multiple: boolean,
): OysterunMcpFieldOption[] {
  const source = multiple && isOysterunRecord(field.items) ? field.items : field;
  if (Array.isArray(source.enum)) {
    return source.enum
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => ({ value: entry, label: entry }));
  }
  const variants = multiple ? source.anyOf : source.oneOf;
  if (!Array.isArray(variants)) return [];
  return variants.flatMap((entry) => {
    if (!isOysterunRecord(entry) || typeof entry.const !== 'string') return [];
    return [
      {
        value: entry.const,
        label: typeof entry.title === 'string' ? entry.title : entry.const,
      },
    ];
  });
}

function mcpFieldInputType(field: Record<string, unknown>): string {
  if (field.format === 'email') return 'email';
  if (field.format === 'uri') return 'url';
  if (field.format === 'date') return 'date';
  if (field.format === 'date-time') return 'datetime-local';
  return field.type === 'number' || field.type === 'integer' ? 'number' : 'text';
}

function OysterunMcpElicitationPanel({
  requestId,
  payload,
  disabled,
  pendingAction,
  finalOutcome,
  error,
  onSubmit,
  onReject,
}: {
  requestId: string;
  payload: OysterunMcpElicitationPayload;
  disabled: boolean;
  pendingAction: OysterunProviderControlAction | null;
  finalOutcome?: string;
  error: string | null;
  onSubmit: (response: OysterunMcpElicitationResponse) => void;
  onReject: (response: OysterunMcpElicitationResponse) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialMcpFormValues(payload.requestedSchema),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const schema = payload.requestedSchema;
  const properties = schema && isOysterunRecord(schema.properties) ? schema.properties : undefined;
  const requiredFields = new Set(
    schema && Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [],
  );
  const safeUrl = safeMcpElicitationUrl(payload.url);
  const formSupported = payload.mode === 'url' || Boolean(properties);
  const fieldStyle: CSSProperties = {
    width: '100%',
    minHeight: '36px',
    boxSizing: 'border-box',
    border: '1px solid rgba(148, 163, 184, 0.55)',
    borderRadius: config.radii.R300,
    padding: `${config.space.S100} ${config.space.S200}`,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
  };

  const submit = () => {
    setValidationError(null);
    if (payload.mode === 'url') {
      if (!safeUrl) {
        setValidationError('This MCP request contains an invalid URL.');
        return;
      }
      onSubmit({ action: 'accept', content: null, _meta: payload.meta });
      return;
    }
    if (!properties) {
      setValidationError('This MCP request does not contain a supported form schema.');
      return;
    }
    const content: Record<string, unknown> = {};
    let fieldError: string | null = null;
    Object.entries(properties).forEach(([name, rawField]) => {
      if (fieldError || !isOysterunRecord(rawField)) return;
      const rawValue = values[name];
      const title =
        typeof rawField.title === 'string' && rawField.title.trim() ? rawField.title : name;
      if (rawField.type === 'boolean') {
        content[name] = rawValue === true;
        return;
      }
      if (rawField.type === 'array') {
        const entries = Array.isArray(rawValue) ? rawValue : [];
        if (requiredFields.has(name) && entries.length === 0) {
          fieldError = `Answer required for "${title}".`;
          return;
        }
        if (entries.length > 0) content[name] = entries;
        return;
      }
      const text = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();
      if (!text) {
        if (requiredFields.has(name)) {
          fieldError = `Answer required for "${title}".`;
        }
        return;
      }
      if (rawField.type === 'number' || rawField.type === 'integer') {
        const numeric =
          rawField.type === 'integer' ? Number.parseInt(text, 10) : Number.parseFloat(text);
        if (!Number.isFinite(numeric)) {
          fieldError = `"${title}" must be a valid number.`;
          return;
        }
        content[name] = numeric;
      } else {
        content[name] = text;
      }
    });
    if (fieldError) {
      setValidationError(fieldError);
      return;
    }
    onSubmit({ action: 'accept', content, _meta: payload.meta });
  };

  let submitLabel = payload.mode === 'url' ? 'Continue' : 'Send response';
  if (finalOutcome === 'accepted') submitLabel = 'Submitted';
  if (pendingAction === 'submit') submitLabel = 'Sending...';
  let rejectLabel = 'Reject';
  if (finalOutcome === 'rejected') rejectLabel = 'Rejected';
  if (pendingAction === 'reject') rejectLabel = 'Rejecting...';

  return (
    <Box
      direction="Column"
      gap="200"
      data-testid="oysterun-routec-mcp-elicitation-surface"
      data-oysterun-control-request-id={requestId}
      data-oysterun-mcp-mode={payload.mode}
    >
      <Text as="strong" size="T300">
        {payload.serverName}
      </Text>
      <Text as="span" size="T300">
        {payload.message}
      </Text>
      {payload.mode === 'url' && safeUrl && (
        <a href={safeUrl} target="_blank" rel="noopener noreferrer">
          Open requested page
        </a>
      )}
      {payload.mode !== 'url' && properties && (
        <Box direction="Column" gap="300">
          {Object.entries(properties).map(([name, rawField]) => {
            if (!isOysterunRecord(rawField)) return null;
            const title =
              typeof rawField.title === 'string' && rawField.title.trim() ? rawField.title : name;
            const description =
              typeof rawField.description === 'string' ? rawField.description.trim() : '';
            const options = mcpFieldOptions(rawField, rawField.type === 'array');
            const value = values[name];
            const fieldId = `oysterun-mcp-${requestId}-${name.replace(/[^a-z0-9_-]/gi, '-')}`;
            let fieldControl: ReactNode;
            if (rawField.type === 'boolean') {
              fieldControl = (
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [name]: event.target.checked }))
                  }
                />
              );
            } else if (rawField.type === 'array' && options.length > 0) {
              fieldControl = (
                <Box direction="Column" gap="100">
                  {options.map((option, optionIndex) => {
                    const selected = Array.isArray(value) && value.includes(option.value);
                    const optionId = `${fieldId}-${optionIndex}`;
                    return (
                      <label
                        key={option.value}
                        htmlFor={optionId}
                        style={{ display: 'flex', gap: config.space.S100 }}
                      >
                        <input
                          id={optionId}
                          type="checkbox"
                          value={option.value}
                          checked={selected}
                          disabled={disabled}
                          onChange={(event) =>
                            setValues((current) => {
                              const existing = Array.isArray(current[name])
                                ? (current[name] as unknown[]).filter(
                                    (entry): entry is string => typeof entry === 'string',
                                  )
                                : [];
                              return {
                                ...current,
                                [name]: event.target.checked
                                  ? [...existing, option.value]
                                  : existing.filter((entry) => entry !== option.value),
                              };
                            })
                          }
                        />
                        <Text as="span" size="T200">
                          {option.label}
                        </Text>
                      </label>
                    );
                  })}
                </Box>
              );
            } else if (options.length > 0) {
              fieldControl = (
                <select
                  id={fieldId}
                  value={typeof value === 'string' ? value : ''}
                  disabled={disabled}
                  style={fieldStyle}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [name]: event.target.value }))
                  }
                >
                  <option value="">Select...</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              );
            } else {
              fieldControl = (
                <input
                  id={fieldId}
                  type={mcpFieldInputType(rawField)}
                  value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                  disabled={disabled}
                  style={fieldStyle}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [name]: event.target.value }))
                  }
                />
              );
            }
            return (
              <label
                key={name}
                htmlFor={fieldId}
                style={{ display: 'grid', gap: config.space.S100 }}
              >
                <Text as="span" size="T200">
                  {title}
                  {requiredFields.has(name) ? ' *' : ''}
                </Text>
                {description && (
                  <Text as="span" size="T200" priority="300">
                    {description}
                  </Text>
                )}
                {fieldControl}
              </label>
            );
          })}
        </Box>
      )}
      {!formSupported && (
        <Text as="span" size="T200" priority="300">
          This MCP request does not contain a supported form schema.
        </Text>
      )}
      <Box alignItems="Center" gap="200" wrap="Wrap">
        <Button
          type="button"
          size="300"
          variant={finalOutcome === 'accepted' ? 'Success' : 'Secondary'}
          fill="Soft"
          radii="300"
          disabled={disabled || !formSupported || (payload.mode === 'url' && !safeUrl)}
          onClick={submit}
          data-testid="oysterun-routec-mcp-elicitation-submit-button"
        >
          <Text as="span" size="T300">
            {submitLabel}
          </Text>
        </Button>
        <Button
          type="button"
          size="300"
          variant={finalOutcome === 'rejected' ? 'Critical' : 'Secondary'}
          fill="Soft"
          radii="300"
          disabled={disabled}
          onClick={() => onReject({ action: 'decline', content: null, _meta: payload.meta })}
          data-testid="oysterun-routec-mcp-elicitation-reject-button"
        >
          <Text as="span" size="T300">
            {rejectLabel}
          </Text>
        </Button>
      </Box>
      {(validationError || error) && (
        <Text as="span" size="T200" priority="300">
          {validationError || error}
        </Text>
      )}
    </Box>
  );
}

export function OysterunSemanticRenderer({
  content,
  fallbackBody,
  sourceEventId,
  controlOutcome,
  formattedBody,
  renderBody,
  toolCompression,
}: {
  content: unknown;
  fallbackBody: string;
  sourceEventId?: string;
  controlOutcome?: OysterunSemanticControlOutcome;
  formattedBody?: string;
  renderBody?: OysterunSemanticBodyRenderer;
  toolCompression?: OysterunToolCompression;
}) {
  const [pendingAction, setPendingAction] = useState<OysterunProviderControlAction | null>(null);
  const [submittedAction, setSubmittedAction] = useState<OysterunProviderControlAction | null>(
    null,
  );
  const [controlError, setControlError] = useState<string | null>(null);
  const payload = getOysterunSemanticPayload(content);
  if (!payload) return null;
  const semanticId = requiredSemanticPayloadString(payload.semantic_id, 'semantic_id');
  const semanticType = requiredSemanticPayloadString(
    payload.semantic_type ?? payload.semantic_category,
    'semantic_type',
  );
  const category = requiredSemanticPayloadString(payload.semantic_category, 'semantic_category');
  const toolOrTerminalSemantic =
    isOysterunToolSemanticType(semanticType) || isOysterunTerminalSemanticType(semanticType);
  const renderSemanticBody = () =>
    renderBody ? renderBody({ body: fallbackBody, customBody: formattedBody }) : fallbackBody;
  const semanticMessageBodyWrapStyle: CSSProperties = {
    maxWidth: '100%',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  };
  const lifecycle = payload.lifecycle ?? 'unknown';
  const proofPayload = {
    semantic_id: semanticId,
    semantic_type: semanticType,
    semantic_category: category,
    lifecycle,
    schema_version: payload.schema_version ?? null,
    created_at: payload.created_at ?? null,
    renderer: 'OysterunSemanticRenderer',
    renderer_scope: 'browser-semantic-detail-readout',
    matrix_room_id: payload.matrix_room_id ?? null,
    host_session_id: payload.host_session_id ?? null,
    host_message_id: payload.host_message_id ?? null,
    client_request_id: payload.client_request_id ?? null,
    source_user_event_id: payload.source_user_event_id ?? null,
    source_user_event_id_hash: payload.source_user_event_id_hash ?? null,
    source_user_event_id_hash_kind: payload.source_user_event_id_hash_kind ?? null,
    target_user_event_id: payload.target_user_event_id ?? null,
    target_user_event_id_hash: payload.target_user_event_id_hash ?? null,
    target_user_event_id_hash_kind: payload.target_user_event_id_hash_kind ?? null,
    target_event_id: payload.target_event_id ?? null,
    target_event_id_kind: payload.target_event_id_kind ?? null,
    target_id: payload.target_id ?? null,
    target_turn_id: payload.target_turn_id ?? null,
    target_session_id: payload.target_session_id ?? null,
    source_id: payload.source_id ?? null,
    source_label: payload.source_label ?? null,
    provider_id: payload.provider_id ?? null,
    provider: payload.provider ?? null,
    provider_turn_id: payload.provider_turn_id ?? null,
    provider_turn_id_kind: payload.provider_turn_id_kind ?? null,
    semantic_contract: payload.semantic_contract ?? null,
    cancel_outcome: payload.cancel_outcome ?? null,
    control_request_id: payload.control_request_id ?? null,
    control_outcome_id: payload.control_outcome_id ?? null,
    control_outcome: payload.control_outcome ?? null,
    control_kind: payload.control_kind ?? null,
    control_family: payload.control_family ?? null,
    control_origin: payload.control_origin ?? null,
    outcome: payload.outcome ?? null,
    actor: payload.actor ?? null,
    terminal_exec_id: payload.terminal_exec_id ?? null,
    command: payload.command ?? null,
    cwd: payload.cwd ?? null,
    started_at: payload.started_at ?? null,
    completed_at: payload.completed_at ?? null,
    exit_code: payload.exit_code ?? null,
    duration_ms: payload.duration_ms ?? null,
    timed_out: typeof payload.timed_out === 'boolean' ? payload.timed_out : null,
    interrupted: typeof payload.interrupted === 'boolean' ? payload.interrupted : null,
    interrupt_reason: payload.interrupt_reason ?? null,
    requested_by: payload.requested_by ?? null,
    normal_message_user_sent:
      typeof payload.normal_message_user_sent === 'boolean'
        ? payload.normal_message_user_sent
        : null,
    browser_shell_execution:
      typeof payload.browser_shell_execution === 'boolean' ? payload.browser_shell_execution : null,
    provider_delivery_attempted:
      typeof payload.provider_delivery_attempted === 'boolean'
        ? payload.provider_delivery_attempted
        : null,
    host_db_transcript_product_truth:
      typeof payload.host_db_transcript_product_truth === 'boolean'
        ? payload.host_db_transcript_product_truth
        : null,
    matrix_event_sender: payload.matrix_event_sender ?? null,
    matrix_event_sender_actor_key: payload.matrix_event_sender_actor_key ?? null,
    matrix_event_sender_actor_kind: payload.matrix_event_sender_actor_kind ?? null,
    matrix_event_sender_display_name: payload.matrix_event_sender_display_name ?? null,
    matrix_event_sender_source: payload.matrix_event_sender_source ?? null,
    matrix_sender_semantic_role_distinct: payload.matrix_sender_semantic_role_distinct === true,
    allowed_actions: payload.allowed_actions ?? null,
    durable: typeof payload.durable === 'boolean' ? payload.durable : null,
    replay_policy: payload.replay_policy ?? null,
    body_fallback_present:
      typeof payload.body_fallback_present === 'boolean' ? payload.body_fallback_present : null,
    agent_turn_started: payload.agent_turn_started === true,
    host2_intake_state: payload.host2_intake_state ?? null,
    provider_receives_canceled_user_event:
      typeof payload.provider_receives_canceled_user_event === 'boolean'
        ? payload.provider_receives_canceled_user_event
        : null,
    provider_received_event:
      typeof payload.provider_received_event === 'boolean' ? payload.provider_received_event : null,
    provider_started_event:
      typeof payload.provider_started_event === 'boolean' ? payload.provider_started_event : null,
    provider_started_for_target_event:
      typeof payload.provider_started_for_target_event === 'boolean'
        ? payload.provider_started_for_target_event
        : null,
    same_event_both_canceled_and_started: payload.same_event_both_canceled_and_started === true,
    outbox_delivery_state: payload.outbox_delivery_state ?? null,
    ambiguous_state: payload.ambiguous_state ?? null,
    assistant_content_hash: payload.assistant_content_hash ?? null,
    duplicate_user_row_count: payload.duplicate_user_row_count ?? null,
    duplicate_assistant_row_count: payload.duplicate_assistant_row_count ?? 0,
    provider_response_marker: payload.provider_response_marker ?? null,
    proof_scope: 'semantic-detail-readout',
    countable_semantic_row: false,
    direct_dom_injection: false,
    direct_cinny_store_injection: false,
    direct_matrix_harness_write_used: payload.direct_matrix_harness_write_used === true,
    screenshot_only_proof: false,
    readiness_claimed: false,
    foundation_pass_claimed: false,
    real_codex_e2e_claimed: payload.real_codex_e2e_claimed === true,
    full_provider_parity_claimed: payload.full_provider_parity_claimed === true,
  };
  const proofClassification = classifyOysterunSemanticRowReadout(proofPayload);
  const controlRequestId =
    typeof payload.control_request_id === 'string' && payload.control_request_id.trim()
      ? payload.control_request_id.trim()
      : undefined;
  const allowedActions = Array.isArray(payload.allowed_actions)
    ? payload.allowed_actions.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
  const mcpElicitationPayload =
    semanticType === 'control.request' && payload.control_kind === 'mcp_elicitation'
      ? normalizeMcpElicitationPayload(payload.control_payload)
      : undefined;
  const pluginInstallSuggestion = mcpElicitationPayload
    ? normalizePluginInstallSuggestion(mcpElicitationPayload)
    : undefined;
  const matrixBackedControlRequest =
    semanticType === 'control.request' &&
    Boolean(controlRequestId) &&
    Boolean(payload.matrix_room_id) &&
    Boolean(payload.host_session_id) &&
    payload.direct_matrix_harness_write_used !== true;
  const matchedControlOutcome = isOysterunSemanticControlOutcome(controlOutcome, controlRequestId)
    ? controlOutcome
    : undefined;
  const finalOutcome = matchedControlOutcome?.controlOutcome;
  const controlDisabled = Boolean(finalOutcome || pendingAction || submittedAction);
  const canAccept =
    matrixBackedControlRequest &&
    allowedActions.includes('accept') &&
    semanticType === 'control.request';
  const canReject =
    matrixBackedControlRequest &&
    allowedActions.includes('reject') &&
    semanticType === 'control.request';
  const canSubmitMcp =
    matrixBackedControlRequest &&
    allowedActions.includes('submit') &&
    Boolean(mcpElicitationPayload) &&
    semanticType === 'control.request';
  const handleControlAction = async (
    action: OysterunProviderControlAction,
    elicitationResponse?: OysterunMcpElicitationResponse,
  ): Promise<boolean> => {
    if (!controlRequestId || controlDisabled) return false;
    setPendingAction(action);
    setControlError(null);
    recordOysterunProviderControlProof(
      {
        semantic_id: semanticId,
        semantic_type: semanticType,
        control_request_id: controlRequestId,
        control_action: action,
        host_session_id: payload.host_session_id ?? null,
        matrix_room_id: payload.matrix_room_id ?? null,
        control_kind: payload.control_kind ?? null,
        control_family: payload.control_family ?? null,
        control_origin: payload.control_origin ?? null,
        allowed_actions: allowedActions.join(','),
        matrix_event_sender: payload.matrix_event_sender ?? null,
        matrix_event_sender_actor_key: payload.matrix_event_sender_actor_key ?? null,
        semantic_role_is_sender: false,
        has_matrix_outcome_before_click: Boolean(finalOutcome),
      },
      'click_requested',
    );
    try {
      const response = await respondOysterunProviderControl({
        requestId: controlRequestId,
        action,
        matrixRoomId: payload.matrix_room_id ?? null,
        semanticId,
        controlKind: payload.control_kind ?? null,
        controlFamily: payload.control_family ?? null,
        controlOrigin: payload.control_origin ?? null,
        elicitationResponse: elicitationResponse ?? null,
      });
      setSubmittedAction(action);
      recordOysterunProviderControlProof(
        {
          semantic_id: semanticId,
          semantic_type: semanticType,
          control_request_id: controlRequestId,
          control_action: action,
          host_session_id: payload.host_session_id ?? null,
          matrix_room_id: payload.matrix_room_id ?? null,
          matrix_event_sender: payload.matrix_event_sender ?? null,
          matrix_event_sender_actor_key: payload.matrix_event_sender_actor_key ?? null,
          semantic_role_is_sender: false,
          control_kind: response.control_kind,
          control_family: response.control_family,
          control_origin: response.control_origin,
          control_outcome: response.control_outcome,
          control_response_forwarded: response.control_response_forwarded,
          provider_control_outcome_event_emitted: response.provider_control_outcome_event_emitted,
          approval_resolution_persisted: response.approval_resolution_persisted,
          matrix_backed_outcome_truth: response.matrix_backed_outcome_truth,
        },
        'host_response_accepted',
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setControlError(message);
      recordOysterunProviderControlProof(
        {
          semantic_id: semanticId,
          semantic_type: semanticType,
          control_request_id: controlRequestId,
          control_action: action,
          host_session_id: payload.host_session_id ?? null,
          matrix_room_id: payload.matrix_room_id ?? null,
          error: message,
        },
        'click_failed',
      );
      return false;
    } finally {
      setPendingAction(null);
    }
  };
  let controlState = 'ready';
  if (finalOutcome) {
    controlState = 'matrix_outcome_visible';
  } else if (pendingAction) {
    controlState = 'submitting';
  } else if (submittedAction) {
    controlState = 'submitted_waiting_for_matrix_outcome';
  }
  let acceptLabel = 'Accept';
  if (finalOutcome === 'accepted') {
    acceptLabel = 'Accepted';
  } else if (pendingAction === 'accept') {
    acceptLabel = 'Accepting';
  }
  let rejectLabel = 'Reject';
  if (finalOutcome === 'rejected') {
    rejectLabel = 'Rejected';
  } else if (pendingAction === 'reject') {
    rejectLabel = 'Rejecting';
  }
  let controlPanel: ReactNode = null;
  if (mcpElicitationPayload && pluginInstallSuggestion && canSubmitMcp) {
    controlPanel = (
      <Box
        style={{ marginTop: config.space.S200 }}
        direction="Column"
        gap="200"
        data-testid="oysterun-routec-provider-control-surface"
        data-oysterun-control-surface="plugin-install-suggestion"
        data-oysterun-control-request-id={controlRequestId}
        data-oysterun-control-state={controlState}
        data-oysterun-browser-local-state-final-truth="false"
        data-oysterun-direct-matrix-browser-write-used="false"
      >
        <OysterunPluginSuggestionPanel
          requestId={controlRequestId ?? ''}
          payload={mcpElicitationPayload}
          suggestion={pluginInstallSuggestion}
          disabled={controlDisabled}
          finalOutcome={finalOutcome}
          controlError={controlError}
          onDecline={(response) => handleControlAction('reject', response)}
        />
        {submittedAction && !finalOutcome && (
          <Text as="span" size="T200" priority="300">
            Waiting for Matrix outcome.
          </Text>
        )}
      </Box>
    );
  } else if (mcpElicitationPayload && canSubmitMcp) {
    controlPanel = (
      <Box
        style={{ marginTop: config.space.S200 }}
        direction="Column"
        gap="200"
        data-testid="oysterun-routec-provider-control-surface"
        data-oysterun-control-surface="mcp-elicitation-request"
        data-oysterun-control-request-id={controlRequestId}
        data-oysterun-control-state={controlState}
        data-oysterun-browser-local-state-final-truth="false"
        data-oysterun-direct-matrix-browser-write-used="false"
      >
        <OysterunMcpElicitationPanel
          requestId={controlRequestId ?? ''}
          payload={mcpElicitationPayload}
          disabled={controlDisabled}
          pendingAction={pendingAction}
          finalOutcome={finalOutcome}
          error={controlError}
          onSubmit={(response) => handleControlAction('submit', response)}
          onReject={(response) => handleControlAction('reject', response)}
        />
        {submittedAction && !finalOutcome && (
          <Text as="span" size="T200" priority="300">
            Waiting for Matrix outcome.
          </Text>
        )}
      </Box>
    );
  } else if (canAccept || canReject) {
    controlPanel = (
      <Box
        style={{ marginTop: config.space.S200 }}
        direction="Column"
        gap="200"
        data-testid="oysterun-routec-provider-control-surface"
        data-oysterun-clean-session-testid="oysterun-clean-session-provider-control-surface"
        data-oysterun-control-surface="provider-control-request"
        data-oysterun-control-surface-owner="oysterun-app"
        data-oysterun-control-source="matrix-backed-semantic-row"
        data-oysterun-control-request-id={controlRequestId}
        data-oysterun-matrix-event-sender={payload.matrix_event_sender ?? undefined}
        data-oysterun-matrix-event-sender-actor-key={
          payload.matrix_event_sender_actor_key ?? undefined
        }
        data-oysterun-matrix-event-sender-actor-kind={
          payload.matrix_event_sender_actor_kind ?? undefined
        }
        data-oysterun-semantic-role-is-sender="false"
        data-oysterun-control-outcome={finalOutcome ?? undefined}
        data-oysterun-control-outcome-id={matchedControlOutcome?.controlOutcomeId}
        data-oysterun-matrix-outcome-event-id={matchedControlOutcome?.eventId}
        data-oysterun-control-state={controlState}
        data-oysterun-browser-local-state-final-truth="false"
        data-oysterun-direct-matrix-browser-write-used="false"
        data-oysterun-local-transcript-replay-shortcut-used="false"
        data-oysterun-generic-cinny-action-menu-primary-surface="false"
      >
        <Box alignItems="Center" gap="200">
          {canAccept && (
            <Button
              type="button"
              size="300"
              variant={finalOutcome === 'accepted' ? 'Success' : 'Secondary'}
              fill="Soft"
              radii="300"
              disabled={controlDisabled}
              aria-disabled={controlDisabled}
              aria-label={`Accept provider control request ${controlRequestId}`}
              title="Accept provider control request"
              data-testid="oysterun-routec-provider-control-accept-button"
              data-oysterun-clean-session-testid="oysterun-clean-session-provider-control-accept-button"
              data-oysterun-control-action="accept"
              data-oysterun-control-request-id={controlRequestId}
              data-oysterun-control-kind={payload.control_kind ?? undefined}
              data-oysterun-control-family={payload.control_family ?? undefined}
              data-oysterun-control-origin={payload.control_origin ?? undefined}
              data-oysterun-control-outcome={finalOutcome ?? undefined}
              data-oysterun-control-enabled={String(!controlDisabled)}
              data-oysterun-allowed-actions={allowedActions.join(',')}
              data-oysterun-host-session-id={payload.host_session_id ?? undefined}
              data-oysterun-room-id={payload.matrix_room_id ?? undefined}
              data-oysterun-matrix-event-sender={payload.matrix_event_sender ?? undefined}
              data-oysterun-matrix-event-sender-actor-key={
                payload.matrix_event_sender_actor_key ?? undefined
              }
              data-oysterun-browser-local-state-final-truth="false"
              onClick={() => {
                handleControlAction('accept');
              }}
            >
              <Text as="span" size="T300">
                {acceptLabel}
              </Text>
            </Button>
          )}
          {canReject && (
            <Button
              type="button"
              size="300"
              variant={finalOutcome === 'rejected' ? 'Critical' : 'Secondary'}
              fill="Soft"
              radii="300"
              disabled={controlDisabled}
              aria-disabled={controlDisabled}
              aria-label={`Reject provider control request ${controlRequestId}`}
              title="Reject provider control request"
              data-testid="oysterun-routec-provider-control-reject-button"
              data-oysterun-clean-session-testid="oysterun-clean-session-provider-control-reject-button"
              data-oysterun-control-action="reject"
              data-oysterun-control-request-id={controlRequestId}
              data-oysterun-control-kind={payload.control_kind ?? undefined}
              data-oysterun-control-family={payload.control_family ?? undefined}
              data-oysterun-control-origin={payload.control_origin ?? undefined}
              data-oysterun-control-outcome={finalOutcome ?? undefined}
              data-oysterun-control-enabled={String(!controlDisabled)}
              data-oysterun-allowed-actions={allowedActions.join(',')}
              data-oysterun-host-session-id={payload.host_session_id ?? undefined}
              data-oysterun-room-id={payload.matrix_room_id ?? undefined}
              data-oysterun-matrix-event-sender={payload.matrix_event_sender ?? undefined}
              data-oysterun-matrix-event-sender-actor-key={
                payload.matrix_event_sender_actor_key ?? undefined
              }
              data-oysterun-browser-local-state-final-truth="false"
              onClick={() => {
                handleControlAction('reject');
              }}
            >
              <Text as="span" size="T300">
                {rejectLabel}
              </Text>
            </Button>
          )}
        </Box>
        {submittedAction && !finalOutcome && (
          <Text as="span" size="T200" priority="300">
            Waiting for Matrix outcome.
          </Text>
        )}
        {controlError && (
          <Text as="span" size="T200" priority="300">
            {controlError}
          </Text>
        )}
      </Box>
    );
  }

  if (proofClassification.current_source_proof_eligible) {
    recordOysterunProof('semanticRows', {
      ...proofPayload,
      semantic_proof_status: proofClassification.semantic_proof_status,
      current_source_proof_eligible: true,
      semantic_success_countable: true,
    });
  } else {
    recordOysterunSemanticDiagnostic({
      ...proofPayload,
      semantic_proof_status: proofClassification.semantic_proof_status,
      current_source_proof_eligible: false,
      semantic_success_countable: false,
      missing_identity_fields: proofClassification.missing_identity_fields.join(','),
      invalid_identity_fields: proofClassification.invalid_identity_fields.join(','),
      diagnostic_reason: 'semantic_readout_not_eligible_for_current_source_success',
    });
  }
  let semanticBodyRenderPath = 'plain_text_fallback';
  if (toolOrTerminalSemantic) {
    semanticBodyRenderPath = 'tool_terminal_special_renderer_no_markdown_body';
  } else if (renderBody) {
    semanticBodyRenderPath = 'shared_message_render_body';
  }

  let semanticContent: ReactNode;
  if (isOysterunTerminalSemanticType(semanticType)) {
    semanticContent = (
      <OysterunTerminalSemanticBox
        semanticType={semanticType}
        payload={payload}
        fallbackBody={fallbackBody}
      />
    );
  } else if (isOysterunToolSemanticType(semanticType)) {
    semanticContent = (
      <OysterunToolSemanticBox
        semanticType={semanticType}
        payload={payload}
        fallbackBody={fallbackBody}
        sourceEventId={sourceEventId}
        compression={toolCompression}
      />
    );
  } else if (mcpElicitationPayload) {
    semanticContent = <strong>MCP request</strong>;
  } else {
    semanticContent = (
      <>
        <strong>{semanticType}</strong>
        <div
          data-oysterun-local-path-semantic-wrap="message_text_body_parity"
          data-oysterun-selectable-message-content="true"
          style={semanticMessageBodyWrapStyle}
        >
          {renderSemanticBody()}
        </div>
      </>
    );
  }

  return (
    <section
      data-testid="oysterun-semantic-detail-readout"
      data-oysterun-proof-scope="semantic-detail-readout"
      data-oysterun-countable-semantic-row="false"
      data-oysterun-semantic-proof-role="renderer-detail-readout"
      data-oysterun-selectable-message-content="true"
      data-oysterun-renderer="OysterunSemanticRenderer"
      data-oysterun-renderer-scope="browser-semantic-detail-readout"
      data-oysterun-semantic-proof-status={proofClassification.semantic_proof_status}
      data-oysterun-current-source-proof-eligible={
        proofClassification.current_source_proof_eligible ? 'true' : 'false'
      }
      data-oysterun-semantic-success-countable={
        proofClassification.semantic_success_countable ? 'true' : 'false'
      }
      data-oysterun-missing-identity-fields={
        proofClassification.missing_identity_fields.join(',') || undefined
      }
      data-oysterun-invalid-identity-fields={
        proofClassification.invalid_identity_fields.join(',') || undefined
      }
      data-oysterun-semantic-id={semanticId}
      data-oysterun-semantic-type={semanticType}
      data-oysterun-schema-version={payload.schema_version ?? undefined}
      data-oysterun-detail-kind={semanticType}
      data-oysterun-semantic-category={category}
      data-oysterun-delivery-state={lifecycle}
      data-oysterun-created-at={payload.created_at ?? undefined}
      data-oysterun-room-id={payload.matrix_room_id ?? undefined}
      data-oysterun-txn-id={payload.client_request_id ?? undefined}
      data-oysterun-host-session-id={payload.host_session_id ?? undefined}
      data-oysterun-host-message-id={payload.host_message_id ?? undefined}
      data-oysterun-source-user-event-id={payload.source_user_event_id ?? undefined}
      data-oysterun-source-user-event-id-hash={payload.source_user_event_id_hash ?? undefined}
      data-oysterun-source-user-event-id-hash-kind={
        payload.source_user_event_id_hash_kind ?? undefined
      }
      data-oysterun-target-user-event-id={payload.target_user_event_id ?? undefined}
      data-oysterun-target-user-event-id-hash={payload.target_user_event_id_hash ?? undefined}
      data-oysterun-target-user-event-id-hash-kind={
        payload.target_user_event_id_hash_kind ?? undefined
      }
      data-oysterun-target-event-id={payload.target_event_id ?? undefined}
      data-oysterun-target-event-id-kind={payload.target_event_id_kind ?? undefined}
      data-oysterun-target-id={payload.target_id ?? undefined}
      data-oysterun-target-turn-id={payload.target_turn_id ?? undefined}
      data-oysterun-target-session-id={payload.target_session_id ?? undefined}
      data-oysterun-source-id={payload.source_id ?? undefined}
      data-oysterun-source-label={payload.source_label ?? undefined}
      data-oysterun-provider-id={payload.provider_id ?? undefined}
      data-oysterun-provider={payload.provider ?? undefined}
      data-oysterun-provider-turn-id={payload.provider_turn_id ?? undefined}
      data-oysterun-provider-turn-id-kind={payload.provider_turn_id_kind ?? undefined}
      data-oysterun-semantic-contract={payload.semantic_contract ?? undefined}
      data-oysterun-cancel-outcome={payload.cancel_outcome ?? undefined}
      data-oysterun-control-request-id={payload.control_request_id ?? undefined}
      data-oysterun-control-outcome-id={payload.control_outcome_id ?? undefined}
      data-oysterun-control-outcome={payload.control_outcome ?? undefined}
      data-oysterun-matched-control-outcome={matchedControlOutcome?.controlOutcome}
      data-oysterun-matched-control-outcome-id={matchedControlOutcome?.controlOutcomeId}
      data-oysterun-matched-control-outcome-event-id={matchedControlOutcome?.eventId}
      data-oysterun-control-kind={payload.control_kind ?? undefined}
      data-oysterun-control-family={payload.control_family ?? undefined}
      data-oysterun-control-origin={payload.control_origin ?? undefined}
      data-oysterun-outcome={payload.outcome ?? undefined}
      data-oysterun-actor={payload.actor ?? undefined}
      data-oysterun-terminal-exec-id={payload.terminal_exec_id ?? undefined}
      data-oysterun-terminal-command={payload.command ?? undefined}
      data-oysterun-terminal-cwd={payload.cwd ?? undefined}
      data-oysterun-terminal-started-at={payload.started_at ?? undefined}
      data-oysterun-terminal-completed-at={payload.completed_at ?? undefined}
      data-oysterun-terminal-exit-code={
        typeof payload.exit_code === 'number' ? String(payload.exit_code) : undefined
      }
      data-oysterun-terminal-duration-ms={
        typeof payload.duration_ms === 'number' ? String(payload.duration_ms) : undefined
      }
      data-oysterun-terminal-timed-out={
        typeof payload.timed_out === 'boolean' ? String(payload.timed_out) : undefined
      }
      data-oysterun-terminal-interrupted={
        typeof payload.interrupted === 'boolean' ? String(payload.interrupted) : undefined
      }
      data-oysterun-terminal-interrupt-reason={payload.interrupt_reason ?? undefined}
      data-oysterun-normal-message-user-sent={
        typeof payload.normal_message_user_sent === 'boolean'
          ? String(payload.normal_message_user_sent)
          : undefined
      }
      data-oysterun-browser-shell-execution={
        typeof payload.browser_shell_execution === 'boolean'
          ? String(payload.browser_shell_execution)
          : undefined
      }
      data-oysterun-provider-delivery-attempted={
        typeof payload.provider_delivery_attempted === 'boolean'
          ? String(payload.provider_delivery_attempted)
          : undefined
      }
      data-oysterun-host-db-transcript-product-truth={
        typeof payload.host_db_transcript_product_truth === 'boolean'
          ? String(payload.host_db_transcript_product_truth)
          : undefined
      }
      data-oysterun-matrix-event-sender={payload.matrix_event_sender ?? undefined}
      data-oysterun-matrix-event-sender-actor-key={
        payload.matrix_event_sender_actor_key ?? undefined
      }
      data-oysterun-matrix-event-sender-actor-kind={
        payload.matrix_event_sender_actor_kind ?? undefined
      }
      data-oysterun-matrix-event-sender-display-name={
        payload.matrix_event_sender_display_name ?? undefined
      }
      data-oysterun-matrix-event-sender-source={payload.matrix_event_sender_source ?? undefined}
      data-oysterun-matrix-sender-semantic-role-distinct={
        typeof payload.matrix_sender_semantic_role_distinct === 'boolean'
          ? String(payload.matrix_sender_semantic_role_distinct)
          : undefined
      }
      data-oysterun-semantic-role-is-sender="false"
      data-oysterun-allowed-actions={payload.allowed_actions?.join(',') ?? undefined}
      data-oysterun-durable={
        typeof payload.durable === 'boolean' ? String(payload.durable) : undefined
      }
      data-oysterun-replay-policy={payload.replay_policy ?? undefined}
      data-oysterun-body-fallback-present={
        typeof payload.body_fallback_present === 'boolean'
          ? String(payload.body_fallback_present)
          : undefined
      }
      data-oysterun-agent-turn-started={
        typeof payload.agent_turn_started === 'boolean'
          ? String(payload.agent_turn_started)
          : undefined
      }
      data-oysterun-host2-intake-state={payload.host2_intake_state ?? undefined}
      data-oysterun-provider-receives-canceled-user-event={
        typeof payload.provider_receives_canceled_user_event === 'boolean'
          ? String(payload.provider_receives_canceled_user_event)
          : undefined
      }
      data-oysterun-provider-received-event={
        typeof payload.provider_received_event === 'boolean'
          ? String(payload.provider_received_event)
          : undefined
      }
      data-oysterun-provider-started-event={
        typeof payload.provider_started_event === 'boolean'
          ? String(payload.provider_started_event)
          : undefined
      }
      data-oysterun-provider-started-for-target-event={
        typeof payload.provider_started_for_target_event === 'boolean'
          ? String(payload.provider_started_for_target_event)
          : undefined
      }
      data-oysterun-same-event-both-canceled-and-started={
        typeof payload.same_event_both_canceled_and_started === 'boolean'
          ? String(payload.same_event_both_canceled_and_started)
          : undefined
      }
      data-oysterun-outbox-delivery-state={payload.outbox_delivery_state ?? undefined}
      data-oysterun-ambiguous-state={payload.ambiguous_state ?? undefined}
      data-oysterun-assistant-content-hash={payload.assistant_content_hash ?? undefined}
      data-oysterun-direct-matrix-harness-write-used={
        payload.direct_matrix_harness_write_used === true ? 'true' : 'false'
      }
      data-oysterun-real-codex-e2e-claimed={
        payload.real_codex_e2e_claimed === true ? 'true' : 'false'
      }
      data-oysterun-full-provider-parity-claimed={
        payload.full_provider_parity_claimed === true ? 'true' : 'false'
      }
      data-oysterun-duplicate-assistant-row-count={payload.duplicate_assistant_row_count ?? 0}
      data-oysterun-duplicate-user-row-count={payload.duplicate_user_row_count ?? undefined}
      data-oysterun-semantic-body-render-path={semanticBodyRenderPath}
    >
      {semanticContent}
      {controlPanel}
    </section>
  );
}
