import React, { CSSProperties, ReactNode, useEffect, useState } from 'react';
import { Box, Button, Text, config } from 'folds';

import {
  classifyOysterunSemanticRowReadout,
  getOysterunLargeToolOutput,
  getOysterunToolEventDetail,
  recordOysterunProof,
  recordOysterunProviderControlProof,
  recordOysterunSemanticDiagnostic,
  respondOysterunProviderControl,
  type OysterunLargeToolOutputItem,
  type OysterunLargeToolOutputResponse,
  type OysterunProviderControlAction,
  type OysterunToolEventDetailItem,
  type OysterunToolEventDetailResponse,
} from './OysterunHostClient';

export const OYSTERUN_SEMANTIC_NAMESPACE = 'org.oysterun.semantic.v1';
export const OYSTERUN_PROVIDER_COMPLETION_MARKER =
  'oysterun_provider_complete_message_notification_v1';
export const OYSTERUN_PROVIDER_COMPLETION_PENDING_STATE = 'pending_turn_completion';

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
  payload: OysterunSemanticPayload | undefined
): boolean {
  if (!payload) return false;
  const semanticType = normalizeOysterunSemanticString(
    payload.semantic_type ?? payload.semantic_category
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

const TOOL_SEMANTIC_TYPES = new Set(['tool.call', 'tool.output', 'tool.result', 'tool.failure']);
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
  isToolOutputBatch: boolean
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
      detail.eventId
  );
}

function isPreferredLazyToolDetail(detail: OysterunToolCompressionDetail | undefined): boolean {
  return (
    hasToolDetailIdentity(detail) &&
    (detail?.semanticType === 'tool.result' || detail?.semanticType === 'tool.failure')
  );
}

function getPreferredLazyToolDetail(
  details: OysterunToolCompressionDetail[]
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
    (detail) => detail.hostSessionId && detail.matrixRoomId && detail.eventId
  );
  if (groupIdentity) {
    return { detail: groupIdentity, source: 'compressed-group-identity-fallback' };
  }
  return {
    detail: retainedMatrixDetails.find(
      (detail) => detail.hostSessionId && detail.matrixRoomId && detail.eventId
    ),
    source: 'retained-matrix-identity-fallback',
  };
}

function getPrimaryToolSummaryDetail(
  details: OysterunToolCompressionDetail[],
  fallback: OysterunToolCompressionDetail
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
  fallback: OysterunToolCompressionDetail
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
  if (semanticType === 'tool.failure' || toolIsError === true) return 'Tool Error';
  if (semanticType === 'tool.output') return 'Tool Output';
  return 'Tool Result';
}

function buildToolDetailFromPayload({
  semanticType,
  payload,
  fallbackBody,
}: {
  semanticType: string;
  payload: OysterunSemanticPayload;
  fallbackBody: string;
}): OysterunToolCompressionDetail {
  const fallbackPayload =
    fallbackBody.trim() && fallbackBody.trim() !== semanticType ? fallbackBody : undefined;
  return {
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
    OYSTERUN_ROUTE_C_TOOL_EXPANSION_EVENT_PAGE_SIZE
  );
  const lazyDetailFetchIdentity = getLazyToolDetailFetchIdentity({
    details,
    retainedMatrixDetails,
  });
  const retainedIdentity = lazyDetailFetchIdentity.detail;
  const [largeToolPage, setLargeToolPage] = useState(1);
  const [largeToolOutput, setLargeToolOutput] = useState<OysterunLargeToolOutputResponse | null>(
    null
  );
  const [largeToolError, setLargeToolError] = useState('');
  const [toolEventDetailPage, setToolEventDetailPage] = useState(1);
  const [toolEventDetail, setToolEventDetail] = useState<OysterunToolEventDetailResponse | null>(
    null
  );
  const [toolEventDetailLoading, setToolEventDetailLoading] = useState(false);
  const [toolEventDetailError, setToolEventDetailError] = useState('');
  const canLoadLargeToolOutput = Boolean(
    retainedIdentity?.hostSessionId && retainedIdentity.matrixRoomId
  );
  const canLoadToolEventDetail = Boolean(
    retainedIdentity?.detailAvailable &&
      retainedIdentity.hostSessionId &&
      retainedIdentity.matrixRoomId &&
      retainedIdentity.eventId
  );

  useEffect(() => {
    let canceled = false;
    if (canLoadLargeToolOutput && retainedIdentity) {
      setLargeToolError('');
      getOysterunLargeToolOutput({
        sessionId: retainedIdentity.hostSessionId ?? '',
        matrixRoomId: retainedIdentity.matrixRoomId ?? '',
        retainedEventId: retainedIdentity.eventId,
        providerTurnId: compression?.providerTurnId ?? retainedIdentity.providerTurnId,
        targetTurnId: retainedIdentity.targetTurnId,
        groupingKey: compression?.groupingKey,
        page: largeToolPage,
      })
        .then((response) => {
          if (canceled) return;
          setLargeToolOutput(response);
        })
        .catch((err: unknown) => {
          if (canceled) return;
          setLargeToolOutput(null);
          setLargeToolError(err instanceof Error ? err.message : String(err));
        });
    }
    return () => {
      canceled = true;
    };
  }, [
    canLoadLargeToolOutput,
    retainedIdentity,
    compression?.providerTurnId,
    compression?.groupingKey,
    largeToolPage,
  ]);

  useEffect(() => {
    let canceled = false;
    if (canLoadToolEventDetail && retainedIdentity) {
      setToolEventDetailLoading(true);
      setToolEventDetailError('');
      getOysterunToolEventDetail({
        sessionId: retainedIdentity.hostSessionId ?? '',
        matrixRoomId: retainedIdentity.matrixRoomId ?? '',
        matrixEventId: retainedIdentity.eventId ?? '',
        page: toolEventDetailPage,
      })
        .then((response) => {
          if (canceled) return;
          setToolEventDetail(response);
          setToolEventDetailLoading(false);
        })
        .catch((err: unknown) => {
          if (canceled) return;
          setToolEventDetail(null);
          setToolEventDetailError(err instanceof Error ? err.message : String(err));
          setToolEventDetailLoading(false);
        });
    } else {
      setToolEventDetail(null);
      setToolEventDetailError('');
      setToolEventDetailLoading(false);
    }
    return () => {
      canceled = true;
    };
  }, [canLoadToolEventDetail, retainedIdentity, toolEventDetailPage]);

  const continuationItems: OysterunLargeToolOutputItem[] =
    largeToolPage > 1 ? largeToolOutput?.items ?? [] : [];
  const isP82ContinuationPage = largeToolPage > 1;
  const pageCount = largeToolOutput?.page_count ?? 1;
  const hasContinuation = largeToolOutput?.has_continuation === true;
  const showContinuationControls = hasContinuation || largeToolPage > 1;
  const toolEventDetailItems: OysterunToolEventDetailItem[] = toolEventDetail?.items ?? [];
  const toolEventDetailPageCount = toolEventDetail?.page_count ?? 1;
  const showToolEventDetailControls =
    !isP82ContinuationPage &&
    canLoadToolEventDetail &&
    (toolEventDetailPageCount > 1 || toolEventDetailPage > 1);
  const p131DetailRows: OysterunToolCompressionDetail[] =
    canLoadToolEventDetail && toolEventDetailItems.length > 0
      ? toolEventDetailItems.map((item) => ({
          semanticType: item.semantic_type,
          hostSessionId: retainedIdentity?.hostSessionId,
          matrixRoomId: retainedIdentity?.matrixRoomId,
          targetTurnId: toolEventDetail?.target_turn_id ?? retainedIdentity?.targetTurnId,
          providerTurnId: toolEventDetail?.provider_turn_id ?? retainedIdentity?.providerTurnId,
          providerTurnIdKind: retainedIdentity?.providerTurnIdKind,
          toolName: item.tool_name ?? toolEventDetail?.tool_name ?? undefined,
          toolCallId: item.tool_call_id ?? toolEventDetail?.tool_call_id ?? undefined,
          toolIsError: item.tool_is_error ?? toolEventDetail?.tool_is_error ?? null,
          payload: item.content,
          fallbackBody: item.field,
          eventId: toolEventDetail?.matrix_event_id ?? retainedIdentity?.eventId,
          detailAvailable: true,
          detailStorageKind: toolEventDetail?.detail_storage_kind ?? undefined,
        }))
      : [];
  const toolEventDetailFallbackReason =
    isP82ContinuationPage
      ? 'p82_jsonl_continuation_selected'
      : p131DetailRows.length > 0
      ? 'endpoint_rows_loaded'
      : canLoadToolEventDetail && toolEventDetailLoading
      ? 'waiting_for_lazy_endpoint'
      : canLoadToolEventDetail && toolEventDetailError
      ? 'lazy_endpoint_error_without_retained_summary_fallback'
      : canLoadToolEventDetail && toolEventDetail && toolEventDetailItems.length === 0
      ? 'lazy_endpoint_empty_without_retained_summary_fallback'
      : canLoadToolEventDetail
      ? 'lazy_endpoint_pending_without_retained_summary_fallback'
      : 'no_detail_available_fetch_identity';
  const toolEventDetailFallbackAllowed = !canLoadToolEventDetail;
  const toolEventDetailDisplaySource = isP82ContinuationPage
    ? 'p82_jsonl_continuation_endpoint'
    : p131DetailRows.length > 0
    ? 'p131_tool_event_detail_endpoint'
    : toolEventDetailFallbackAllowed
    ? 'retained_matrix_without_lazy_detail'
    : toolEventDetailLoading
    ? 'p131_tool_event_detail_loading'
    : toolEventDetailError
    ? 'p131_tool_event_detail_error'
    : toolEventDetail && toolEventDetailItems.length === 0
    ? 'p131_tool_event_detail_empty'
    : 'p131_tool_event_detail_pending';
  const p153FlatPageEntrySource = isP82ContinuationPage
    ? 'p82_jsonl_continuation_endpoint_response_order'
    : 'retained_matrix_flat_tool_page';
  const selectedDetailLimitBytes =
    toolEventDetail?.selected_detail_limit_bytes ?? OYSTERUN_ROUTE_C_SELECTED_DETAIL_TOP_LIMIT_BYTES;
  const selectedDetailTruncated = toolEventDetail?.selected_detail_truncated === true;
  const debugToolDetailSourceUiEnabled =
    toolEventDetail?.debug_tool_detail_source_ui_enabled === true ||
    largeToolOutput?.debug_tool_detail_source_ui_enabled === true;
  const displayRows: OysterunToolCompressionDetail[] = isP82ContinuationPage
    ? continuationItems.map((item) => ({
        semanticType: item.semantic_type,
        hostSessionId: retainedIdentity?.hostSessionId,
        matrixRoomId: retainedIdentity?.matrixRoomId,
        targetTurnId: item.target_turn_id ?? retainedIdentity?.targetTurnId,
        providerTurnId: item.provider_turn_id ?? retainedIdentity?.providerTurnId,
        providerTurnIdKind: item.provider_turn_id_kind ?? retainedIdentity?.providerTurnIdKind,
        toolName: item.tool_name ?? undefined,
        toolCallId: item.tool_call_id ?? undefined,
        toolIsError: item.tool_is_error ?? null,
        payload: item.payload ?? item.body,
        fallbackBody: item.body ?? item.semantic_type,
      } as OysterunToolCompressionDetail))
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
      data-oysterun-p153-jsonl-continuation-order="endpoint-response-order"
      data-oysterun-p153-p131-detail-row-scoped="true"
      data-oysterun-p153-p131-detail-replaces-flat-page="false"
      data-oysterun-tool-output-batch-index={compression?.batchIndex}
      data-oysterun-tool-output-batch-count={compression?.batchCount}
      data-oysterun-tool-output-batch-size={compression?.batchSize}
      data-oysterun-tool-output-batch-start-index={compression?.batchStartIndex}
      data-oysterun-tool-output-batch-end-index={compression?.batchEndIndex}
      data-oysterun-large-tool-continuation={String(hasContinuation)}
      data-oysterun-large-tool-jsonl-loaded={String(largeToolPage > 1)}
      data-oysterun-large-tool-current-page={String(largeToolPage)}
      data-oysterun-large-tool-page-count={String(pageCount)}
      data-oysterun-large-tool-count-label={largeToolOutput?.tool_event_count_label ?? '10'}
      data-oysterun-large-tool-matrix-large-ref="false"
      data-oysterun-large-tool-raw-path-exposed="false"
      data-oysterun-p131-tool-detail-available={String(canLoadToolEventDetail)}
      data-oysterun-p131-tool-detail-loading={String(toolEventDetailLoading)}
      data-oysterun-p131-tool-detail-page={String(toolEventDetailPage)}
      data-oysterun-p131-tool-detail-page-count={String(toolEventDetailPageCount)}
      data-oysterun-p131-tool-detail-fetch-event-id={retainedIdentity?.eventId}
      data-oysterun-p131-tool-detail-fetch-semantic-type={retainedIdentity?.semanticType}
      data-oysterun-p131-tool-detail-fetch-identity-source={lazyDetailFetchIdentity.source}
      data-oysterun-p131-tool-detail-fetch-storage-kind={retainedIdentity?.detailStorageKind}
      data-oysterun-p131-tool-detail-fetched-row-count={String(p131DetailRows.length)}
      data-oysterun-p131-tool-detail-retained-fallback-row-count={String(retainedMatrixDetails.length)}
      data-oysterun-p131-tool-detail-fallback-allowed={String(toolEventDetailFallbackAllowed)}
      data-oysterun-p131-tool-detail-fallback-reason={toolEventDetailFallbackReason}
      data-oysterun-p131-tool-detail-display-source={toolEventDetailDisplaySource}
      data-oysterun-p143-expansion-event-page-size={String(
        OYSTERUN_ROUTE_C_TOOL_EXPANSION_EVENT_PAGE_SIZE
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
              {largeToolPage <= 1
                ? `${displayRows.length} tool messages`
                : `${continuationItems.length} continuation messages`}
            </Text>
          </Box>
          <Button type="button" size="300" variant="Secondary" radii="300" onClick={onClose}>
            <Text as="span" size="T300">
              Close
            </Text>
          </Button>
        </Box>
        {showContinuationControls && (
          <Box alignItems="Center" gap="200" wrap="Wrap">
            <Button
              type="button"
              size="300"
              variant="Secondary"
              radii="300"
              disabled={largeToolPage <= 1}
              onClick={() => setLargeToolPage((page) => Math.max(1, page - 1))}
              data-oysterun-large-tool-page-prev="explicit-detail-navigation"
            >
              <Text as="span" size="T300">
                Previous
              </Text>
            </Button>
            <Text as="span" size="T200" priority="300">
              {`Page ${largeToolPage} of ${pageCount}`}
            </Text>
            <Button
              type="button"
              size="300"
              variant="Secondary"
              radii="300"
              disabled={!hasContinuation || largeToolPage >= pageCount}
              onClick={() => setLargeToolPage((page) => page + 1)}
              data-oysterun-large-tool-page-next="explicit-jsonl-navigation"
            >
              <Text as="span" size="T300">
                Next
              </Text>
            </Button>
            {largeToolOutput?.total_tool_event_count && (
              <Text as="span" size="T200" priority="300">
                {`${largeToolOutput.total_tool_event_count} total`}
              </Text>
            )}
          </Box>
        )}
        {largeToolError && (
          <Text as="span" size="T200" priority="300">
            {largeToolError}
          </Text>
        )}
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
                Previous detail
              </Text>
            </Button>
            <Text as="span" size="T200" priority="300">
              {`Detail page ${toolEventDetailPage} of ${toolEventDetailPageCount}`}
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
                Next detail
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
          {displayRows.map((detail, index) => {
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
  compression,
}: {
  semanticType: string;
  payload: OysterunSemanticPayload;
  fallbackBody: string;
  compression?: OysterunToolCompression;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const currentDetail = buildToolDetailFromPayload({ semanticType, payload, fallbackBody });
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
  const hasDetailView =
    isCompressedGroup || preview.clipped || primaryDetail.detailAvailable === true;

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
      data-oysterun-tool-output-batch-preview-suppressed={String(
        toolOutputBatchPreviewSuppressed
      )}
      data-oysterun-projected-tool-result-preview-suppressed={String(
        previewSuppressionScope === 'projected_tool_result_summary_only'
      )}
      data-oysterun-projected-tool-failure-preview-suppressed={String(
        previewSuppressionScope === 'projected_tool_failure_summary_only'
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
  return semanticType === 'terminal.command.started' ? 'Terminal Command Started' : 'Terminal Result';
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
        payload.provider_delivery_attempted === true
      )}
      data-oysterun-normal-message-user-sent={String(payload.normal_message_user_sent === true)}
      data-oysterun-browser-shell-execution={String(payload.browser_shell_execution === true)}
      data-oysterun-host-db-transcript-product-truth={String(
        payload.host_db_transcript_product_truth === true
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
  requestId: string | undefined
): value is OysterunSemanticControlOutcome {
  return Boolean(value && requestId && value.controlRequestId === requestId);
}

function requiredSemanticPayloadString(value: string | undefined, field: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`Oysterun semantic renderer payload missing required field: ${field}.`);
}

export function OysterunSemanticRenderer({
  content,
  fallbackBody,
  controlOutcome,
  formattedBody,
  renderBody,
  toolCompression,
}: {
  content: unknown;
  fallbackBody: string;
  controlOutcome?: OysterunSemanticControlOutcome;
  formattedBody?: string;
  renderBody?: OysterunSemanticBodyRenderer;
  toolCompression?: OysterunToolCompression;
}) {
  const [pendingAction, setPendingAction] = useState<OysterunProviderControlAction | null>(null);
  const [submittedAction, setSubmittedAction] = useState<OysterunProviderControlAction | null>(
    null
  );
  const [controlError, setControlError] = useState<string | null>(null);
  const payload = getOysterunSemanticPayload(content);
  if (!payload) return null;
  const semanticId = requiredSemanticPayloadString(payload.semantic_id, 'semantic_id');
  const semanticType = requiredSemanticPayloadString(
    payload.semantic_type ?? payload.semantic_category,
    'semantic_type'
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
      typeof payload.browser_shell_execution === 'boolean'
        ? payload.browser_shell_execution
        : null,
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
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
      )
    : [];
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
  const handleControlAction = async (action: OysterunProviderControlAction) => {
    if (!controlRequestId || controlDisabled) return;
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
      'click_requested'
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
        'host_response_accepted'
      );
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
        'click_failed'
      );
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
  const controlPanel =
    canAccept || canReject ? (
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
    ) : null;

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
        compression={toolCompression}
      />
    );
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
