import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Session } from '../app/state/sessions';

export type OysterunMatrixBootstrapResponse = {
  route: 'oysterun_matrix_bootstrap' | 'oysterun_host_scoped_cinny_session_bootstrap';
  session: Session;
  binding: {
    host_session_id: string;
    host_agent_id: string;
    host_session_name?: string | null;
    matrix_room_id: string;
    matrix_room_ready: boolean;
    matrix_user_id: string;
    routec_matrix_actor_registry?: OysterunMatrixActorRegistry;
    committed_transcript_truth: 'matrix_room_timeline';
  };
  routec_matrix_actor_registry?: OysterunMatrixActorRegistry;
  routec_facade_sender_actor_key?: 'human';
  routec_facade_sender_restriction?: 'human_actor_only';
  room: {
    roomId: string;
    ready: boolean;
  };
  notification_settings?: OysterunSessionNotificationSettings | null;
  artifact_root: string;
  raw_synapse_token_exposed: false;
  session_route_source?: string;
  token_kind?: 'host_scoped_matrix_facade_token';
  browser_storage_raw_synapse_token?: false;
  login_credential_typed?: false;
  api_backdoor_session_created?: false;
  matrix_intake_runtime_proof_claimed?: false;
  foundation_readiness_claimed?: false;
  pass_claimed?: false;
};

export type OysterunMatrixActor = {
  actor_key: string;
  actor_kind: string;
  provider_id?: string | null;
  matrix_user_id: string;
  display_name: string;
  membership: 'join';
  browser_send_allowed: boolean;
  sender_source: string;
};

export type OysterunMatrixActorRegistry = {
  registry_version: string;
  source_of_truth: 'host_owned_routec_matrix_room_binding';
  committed_sender_truth: 'matrix_event_sender';
  semantic_role_is_sender: false;
  actors: OysterunMatrixActor[];
};

export type OysterunRouteCPathMemory = {
  explorer_paths?: Record<string, string>;
  preview_paths?: Record<string, string>;
};

export type OysterunRouteCPathMemorySnapshot = {
  explorerPath: string;
  previewPath: string;
};

export type OysterunRouteCActiveRoomTimelineFocusSource =
  | 'message_search_open'
  | 'pinned_message_open'
  | 'host_owner_neighbor_navigation';

export type OysterunRouteCActiveRoomTimelineFocusDetail = {
  hostSessionId: string;
  roomId: string;
  eventId: string;
  source: OysterunRouteCActiveRoomTimelineFocusSource;
  handled: boolean;
  handledBy: 'active_room_timeline' | null;
  samePageFocusCommand: true;
  primaryFocusLoader: 'RoomTimeline.handleOpenEvent/loadEventTimeline';
  cleanFocusUrlFallbackAvailable: boolean;
  appStaticShellReloadAllowed: false;
  genericHomeRouteAllowed: false;
  domOnlyFocusAllowed: false;
  jumpToBottomAllowed: false;
};

export type OysterunHostSessionStatus = {
  agent_id: string;
  session_id: string;
  session_name?: string | null;
  cwd?: string | null;
  active: boolean;
  alive: boolean;
  ready: boolean;
  notification_settings?: OysterunSessionNotificationSettings | null;
};

export type OysterunRouteCAgentCommand = {
  name: string;
  title?: string | null;
  file?: string | null;
};

export type OysterunRouteCAgentCommandsResponse = {
  agent_id: string;
  provider: string;
  commands: OysterunRouteCAgentCommand[];
  note?: string;
};

export type OysterunRouteCProviderSkillStatusResponse = {
  agent_id: string;
  agent_folder?: string | null;
  provider: string;
  provider_supported?: boolean;
  installed: boolean;
  ownership_marker_valid: boolean;
  can_install?: boolean;
  disabled?: boolean;
  reason?: string;
  skill_set_target?: string | null;
  target_root?: string | null;
};

export type OysterunSessionNotificationSettings = {
  session_id: string;
  matrix_room_id?: string | null;
  matrix_room_bound?: boolean;
  notifications_enabled: boolean;
  per_session_notification_enabled: boolean;
  is_default?: boolean;
  updated_at?: string | null;
  storage_owner?:
    | 'agent_config_notifications_enabled'
    | 'host_config_session_notification_settings'
    | string;
  policy_source?: 'notifications.enabled' | string;
  compatibility_endpoint?: boolean;
  matrix_timeline_owner?: false;
  host_transcript_db_owner?: false;
  browser_local_storage_owner?: false;
};

export type OysterunHostPathRoots = {
  home: string;
  default: string;
};

export type OysterunAgentWebsiteMetadata = {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  availability: 'available' | 'unavailable' | 'unconfigured';
  reason: string | null;
  reason_message: string | null;
  entry_path: string;
  canonical_entry_path: string;
  route_prefix: '/sites/';
  root: string | null;
  access: string | null;
  password_configured: boolean;
};

export type OysterunAgentCatalogEntry = {
  agent_id: string;
  display_name?: string | null;
  website?: OysterunAgentWebsiteMetadata | null;
};

export type OysterunAgentWebsiteCatalogEntry = {
  agent_id: string;
  display_name?: string | null;
  website?: OysterunAgentWebsiteMetadata | null;
};

export type OysterunAgentCatalogResponse = {
  roots: OysterunHostPathRoots;
  agents?: OysterunAgentCatalogEntry[];
  websites?: OysterunAgentWebsiteCatalogEntry[];
};

export type OysterunRouteCWebsiteTarget = {
  agentId: string;
  entryPath: string;
  source: 'agents_catalog_websites';
};

export type OysterunBrowseEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  has_oysterun_config?: boolean;
};

export type OysterunBrowsePage = {
  path: string;
  parent: string | null;
  query: string;
  offset: number;
  limit: number;
  entries: OysterunBrowseEntry[];
  has_more: boolean;
  next_offset: number | null;
  returned_count: number;
  matched_count: number;
  scan_truncated: boolean;
  warning: string | null;
};

export type OysterunLargeToolOutputItem = {
  schema_version: 'routec.large_tool_event.v1';
  tool_event_index: number;
  jsonl_page_index: number;
  semantic_type: string;
  provider_turn_id?: string | null;
  provider_turn_id_kind?: string | null;
  target_turn_id?: string | null;
  provider_runtime_event_index?: number | null;
  source_user_event_id?: string | null;
  tool_name?: string | null;
  tool_call_id?: string | null;
  tool_is_error?: boolean | null;
  payload?: unknown;
  body?: string | null;
  search_indexed?: false;
};

export type OysterunToolEventDetailItem = {
  field: string;
  source?: string | null;
  semantic_type: string;
  tool_name?: string | null;
  tool_call_id?: string | null;
  tool_is_error?: boolean | null;
  byte_count?: number | null;
  line_count?: number | null;
  original_byte_count?: number | null;
  original_line_count?: number | null;
  selected_detail_top_only?: boolean;
  selected_detail_limit_bytes?: number | null;
  selected_detail_truncated?: boolean;
  selected_detail_truncation_reason?: string | null;
  chunk_index?: number | null;
  chunk_count?: number | null;
  content?: unknown;
};

export type OysterunToolLifecycleUpdate = {
  physical_event_index: number;
  provider_runtime_event_index?: number | null;
  semantic_type: 'tool.update' | 'tool.output' | string;
  update_kind: string;
  payload?: unknown;
  late: boolean;
};

export type OysterunToolLifecycleInvocation = {
  tool_call_id: string;
  tool_name?: string | null;
  provider?: string | null;
  provider_turn_id?: string | null;
  target_turn_id?: string | null;
  first_event_sequence: number;
  last_event_sequence: number;
  physical_event_count: number;
  state: 'active' | 'succeeded' | 'failed' | 'incomplete';
  incomplete_reason?: string | null;
  call?: unknown;
  updates: OysterunToolLifecycleUpdate[];
  output?: unknown;
  result?: unknown;
  late_update_count: number;
  selected_detail_truncated: boolean;
  selected_detail_limit_bytes: number;
};

export type OysterunToolEventDetailResponse = {
  status: 'ok' | 'unavailable' | 'ambiguous' | 'forbidden' | 'missing_identity';
  session_id: string;
  matrix_room_id: string;
  matrix_event_id: string;
  schema_version?: 'routec.unified_tool_lifecycle_detail.v1' | string;
  semantic_type?: string | null;
  tool_name?: string | null;
  tool_call_id?: string | null;
  tool_is_error?: boolean | null;
  provider_turn_id?: string | null;
  target_turn_id?: string | null;
  source_user_event_id?: string | null;
  detail_storage_kind?: string | null;
  original_byte_count?: number | null;
  original_line_count?: number | null;
  page: number;
  page_size?: number;
  page_count?: number;
  page_size_bytes?: number;
  selected_detail_top_only?: boolean;
  selected_detail_limit_bytes?: number | null;
  selected_detail_truncated?: boolean;
  truncated_field_count?: number | null;
  items?: OysterunToolEventDetailItem[];
  physical_event_count?: number;
  logical_invocation_count?: number;
  invocations: OysterunToolLifecycleInvocation[];
  storage_sources?: string[];
  physical_event_order_preserved?: boolean;
  aggregation_key?: string;
  detail_identity_kind?: 'session_room_event' | string;
  debug_tool_detail_source_ui_enabled?: boolean;
  resolver_path_fields_exposed?: false;
  tool_payload_local_paths_preserved?: true;
};

export type OysterunToolEventDetailRequest = {
  sessionId: string;
  matrixRoomId: string;
  matrixEventId: string;
  page?: number;
};

export type OysterunHostOwnerMessageNeighborEvent = {
  event_id: string;
  routec_stream_seq: number;
  origin_server_ts: number | null;
};

export type OysterunHostOwnerMessageNeighborsResponse = {
  status: 'ok';
  session_id: string;
  matrix_room_id: string;
  anchor: {
    anchor_position: 'event' | 'latest';
    event_id: string | null;
    routec_stream_seq: number | null;
    host_owner_message: boolean;
  } | null;
  previous: OysterunHostOwnerMessageNeighborEvent | null;
  next: OysterunHostOwnerMessageNeighborEvent | null;
  boundaries: {
    no_host_owner_messages: boolean;
    at_first_host_owner_message: boolean;
    at_latest_host_owner_message: boolean;
    previous_window_exhausted?: boolean;
    next_window_exhausted?: boolean;
    previous_boundary_proven?: boolean;
    next_boundary_proven?: boolean;
  };
  proof: {
    schema_version:
      | 'routec.p180_host_owner_message_neighbors.v1'
      | 'routec.p324_host_owner_neighbor_bounded_scan.v1';
    lookup_source: 'routec_host_owned_matrix_storage_room_event_index';
    lookup_strategy?: 'bounded_short_circuit_scan';
    order_by: 'routec_stream_seq';
    actor_key: 'human';
    actor_kind: 'human';
    stable_actor_metadata_required: true;
    display_name_used_for_ownership: false;
    body_scan_used_for_ownership: false;
    raw_event_payload_returned: false;
    message_body_returned: false;
    total_event_count?: number;
    max_scan_events_per_direction?: number;
    previous_scanned_event_count?: number;
    next_scanned_event_count?: number;
    previous_window_exhausted?: boolean;
    next_window_exhausted?: boolean;
  };
  committed_transcript_truth?: 'matrix_room_timeline';
  routec_host_owner_neighbor_endpoint?: true;
  host_owner_lookup_actor_source?: 'routec_matrix_actor_key';
  host_owner_lookup_body_scan_used?: false;
  raw_event_payload_returned?: false;
  message_body_returned?: false;
};

export type OysterunHostOwnerMessageNeighborsRequest = {
  roomId: string;
  anchorEventId?: string;
  anchorPosition?: 'latest';
};

export type OysterunLargeToolOutputResponse = {
  status: 'ok' | 'unavailable' | 'ambiguous' | 'forbidden';
  has_continuation: boolean;
  continuation_state: string;
  page: number;
  page_size: number;
  page_count?: number;
  matrix_retained_tool_event_count?: number;
  total_tool_event_count?: number;
  total_jsonl_tool_event_count?: number;
  notice_sent?: boolean;
  notice_matrix_event_id?: string | null;
  tool_event_count_label?: '10' | string;
  large_tool_ref?: string | null;
  items: OysterunLargeToolOutputItem[];
  jsonl_loaded?: boolean;
  detail_page_1_matrix_retained?: boolean;
  explicit_detail_navigation_required?: boolean;
  matrix_large_ref_written?: false;
  matrix_large_tool_ref_written?: false;
  debug_tool_detail_source_ui_enabled?: boolean;
  resolver_path_fields_exposed?: false;
  tool_payload_local_paths_preserved?: true;
  matrix_chat_search_includes_jsonl?: false;
};

export type OysterunLargeToolOutputRequest = {
  sessionId: string;
  matrixRoomId: string;
  page?: number;
  retainedEventId?: string;
  providerTurnId?: string;
  targetTurnId?: string;
  groupingKey?: string;
};

type OysterunProofBucket = {
  matrixClientInit?: Record<string, unknown>;
  matrixClientRecovery?: Record<string, unknown>;
  matrixClientRecoveryTrigger?: Record<string, unknown>[];
  sendReconciliation?: Record<string, unknown>[];
  semanticRows?: Record<string, unknown>[];
  semanticDiagnostics?: Record<string, unknown>[];
  cancelControls?: Record<string, unknown>[];
  interruptControls?: Record<string, unknown>[];
  terminalCommands?: Record<string, unknown>[];
  schedulerCommands?: Record<string, unknown>[];
  providerControls?: Record<string, unknown>[];
};

export type OysterunHost2IntakeProof = {
  marker: string;
  host_session_id: string;
  matrix_room_id: string;
  matrix_server_event_id: string | null;
  host2_receipt_target_event_id: string | null;
  host2_receipt_exact_user_event: boolean;
  host2_intake_state: string;
  host2_intake_state_reason: string | null;
  agent_turn_started: boolean;
  cancelable: boolean;
  cancel_outcome: string | null;
  provider_delivery_claimed: boolean;
  provider_delivery_attempted: boolean;
  provider_delivery_permitted: boolean;
  provider_delivery_blocked_reason: string | null;
  next_user_message_delivered_to_active_provider_session: boolean;
  provider_receives_canceled_user_event?: boolean | null;
  provider_received_event?: boolean | null;
  provider_started_event?: boolean | null;
  delivery_proof_columns?: Record<string, unknown> | null;
  same_event_both_canceled_and_started?: boolean;
  control_request_id?: string | null;
  control_outcome_id?: string | null;
  control_outcome?: string | null;
  cancel_request_semantic_event_source_hook?: Record<string, unknown> | null;
  cancel_outcome_semantic_event_source_hook?: Record<string, unknown> | null;
  source_user_event_id: string | null;
  source_user_event_id_raw_hash: string | null;
  source_user_event_id_raw_hash_kind: string | null;
  target_user_event_id_hash_kind?: string | null;
  phase1_pass_claimed?: false;
  closeout_readiness_claimed?: false;
  foundation_pass_claimed?: false;
  [key: string]: unknown;
};

export type OysterunHost2IntakeResponse = {
  status: string;
  proof: OysterunHost2IntakeProof;
  foundation_pass_claimed: false;
};

export type OysterunRouteCProviderLifecycle = {
  schema_version: 'routec.provider_lifecycle.v1';
  source: 'host_session_outbox_pending_control' | string;
  host_owned_provider_lifecycle: boolean;
  frontend_timeline_source_event_required: false;
  raw_payload_exposed: false;
  session_id: string;
  room_id: string | null;
  provider_id: string | null;
  display_name: string;
  state:
    | 'idle'
    | 'queued'
    | 'dispatching'
    | 'running'
    | 'pending_control'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'canceled'
    | 'ambiguous'
    | 'stalled'
    | string;
  active: boolean;
  terminal: boolean;
  heartbeat_recommended: boolean;
  related_polling_allowed: boolean;
  cancelable: boolean;
  cancelability_source: 'host_outbox_state' | string;
  message_id: string | null;
  active_message_id: string | null;
  active_message_state: string | null;
  delivery_state: string | null;
  provider_delivery_claimed: boolean;
  provider_delivery_attempted: boolean;
  provider_delivery_state: string | null;
  host2_intake_state: string | null;
  agent_turn_started: boolean;
  source_user_event_id: string | null;
  source_user_event_id_hash: string | null;
  provider_turn_id: string | null;
  pending_control_request_count: number;
  updated_at: string | null;
};

export type OysterunHostSessionOutboxEntry = {
  id?: string;
  message_id?: string;
  state: string;
  delivery_state: string;
  can_cancel?: boolean;
  can_retry?: boolean;
  can_skip?: boolean;
  routec_matrix_delivery?: {
    source_user_event_id?: string | null;
    matrix_room_id?: string | null;
    provider_delivery_claimed?: boolean | null;
    provider_delivery_attempted?: boolean | null;
    provider_delivery_state?: string | null;
    host2_intake_proof?: Record<string, unknown> | null;
  } | null;
};

export type OysterunHostSessionSnapshotResponse = {
  agent_id: string;
  session_id: string;
  session_name?: string | null;
  provider?: string | null;
  latest_committed_seq?: number;
  delivery?: {
    state?: string | null;
    active_message_id?: string | null;
    active_message_state?: string | null;
    queued_count?: number;
  };
  outbox?: OysterunHostSessionOutboxEntry[];
  pending_control_requests?: unknown[];
  provider_lifecycle?: OysterunRouteCProviderLifecycle;
};

export type OysterunRouteCOptimisticProviderRespondingEvent = {
  status: 'accepted' | 'failed';
  roomId: string;
  sessionId: string | null;
  clientRequestId: string;
  eventId?: string | null;
  reason?: string | null;
  createdAt: number;
};

export const OYSTERUN_ROUTE_C_OPTIMISTIC_PROVIDER_RESPONDING_EVENT =
  'oysterun-routec-optimistic-provider-responding';

export function createOysterunRouteCOptimisticClientRequestId(): string {
  return `routec_optimistic_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

export function notifyOysterunRouteCOptimisticProviderResponding(
  detail: Omit<OysterunRouteCOptimisticProviderRespondingEvent, 'sessionId' | 'createdAt'> & {
    sessionId?: string | null;
    createdAt?: number;
  }
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OysterunRouteCOptimisticProviderRespondingEvent>(
      OYSTERUN_ROUTE_C_OPTIMISTIC_PROVIDER_RESPONDING_EVENT,
      {
        detail: {
          ...detail,
          sessionId: detail.sessionId ?? getOysterunHostSessionId() ?? null,
          createdAt: detail.createdAt ?? Date.now(),
        },
      }
    )
  );
}

export function subscribeOysterunRouteCOptimisticProviderResponding(
  listener: (detail: OysterunRouteCOptimisticProviderRespondingEvent) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    listener((event as CustomEvent<OysterunRouteCOptimisticProviderRespondingEvent>).detail);
  };
  window.addEventListener(OYSTERUN_ROUTE_C_OPTIMISTIC_PROVIDER_RESPONDING_EVENT, handler);
  return () =>
    window.removeEventListener(OYSTERUN_ROUTE_C_OPTIMISTIC_PROVIDER_RESPONDING_EVENT, handler);
}

export const OYSTERUN_RAW_EVENT_ID_HASH_KIND = 'raw_event_id_sha256';
export const OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT = 'post_bootstrap_room_entry_readiness_v1';

export type OysterunRouteCRoomEntryBindingProof = {
  contract: typeof OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT;
  host_session_id?: string;
  matrix_room_id?: string;
  matrix_room_ready: boolean;
  binding_source:
    | 'host_scoped_bootstrap'
    | 'host_session_route_without_bootstrap'
    | 'missing_host_session_route';
  direct_api_substitute_used: false;
  stale_text_selector_required: false;
  screenshot_identity_required: false;
};

const OYSTERUN_SEMANTIC_ROW_PROOF_IDENTITY_FIELDS = [
  'source_user_event_id_hash_kind',
  'source_user_event_id_hash',
  'matrix_room_id',
  'host_session_id',
  'source_user_event_id',
  'semantic_type',
  'semantic_category',
  'semantic_id',
  'renderer',
  'renderer_scope',
  'proof_scope',
  'countable_semantic_row',
  'provider_id',
  'provider_turn_id',
] as const;

const OYSTERUN_SEMANTIC_ROW_PROOF_OPTIONAL_IDENTITY_FIELDS = [
  'target_user_event_id_hash_kind',
  'target_user_event_id_hash',
  'cancel_outcome',
  'control_request_id',
  'control_outcome_id',
  'control_outcome',
  'control_kind',
  'control_family',
  'control_origin',
  'outcome',
  'actor',
  'allowed_actions',
  'durable',
  'replay_policy',
  'body_fallback_present',
  'target_id',
  'target_turn_id',
  'target_session_id',
  'source_id',
  'source_label',
  'agent_turn_started',
  'host2_intake_state',
  'provider_receives_canceled_user_event',
  'provider_received_event',
  'provider_started_event',
  'provider_started_for_target_event',
  'same_event_both_canceled_and_started',
  'duplicate_user_row_count',
  'outbox_delivery_state',
  'ambiguous_state',
] as const;

const OYSTERUN_SEMANTIC_DIAGNOSTIC_IDENTITY_FIELDS = [
  'semantic_id',
  'semantic_type',
  'semantic_category',
  'matrix_room_id',
  'host_session_id',
  'source_user_event_id',
  'source_user_event_id_hash',
  'source_user_event_id_hash_kind',
  'provider_id',
  'provider_turn_id',
  'semantic_proof_status',
] as const;

const OYSTERUN_SEMANTIC_ROW_PROOF_KEY_SEPARATOR = '\u001f';

declare global {
  interface Window {
    Capacitor?: {
      Plugins?: Record<string, unknown>;
      isPluginAvailable?: (name: string) => boolean;
      nativePromise?: (
        pluginName: string,
        methodName: string,
        options: Record<string, unknown>
      ) => Promise<unknown>;
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    __oysterunRouteCProofs?: OysterunProofBucket;
  }
}

let cachedBootstrap: OysterunMatrixBootstrapResponse | undefined;

const HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_PATH =
  '/routec/matrix/host-scoped-cinny-session-bootstrap';
const HOST_SESSION_SEND_PATH = '/session/send';
const HOST_SESSION_SNAPSHOT_PATH = '/session/snapshot';
const HOST_SESSION_INTERRUPT_PATH = '/session/interrupt';
const HOST_SESSION_RESTART_PATH = '/session/restart';
const HOST_SESSION_TERMINAL_COMMAND_PATH = '/session/terminal-command';
const HOST2_INTAKE_PROOF_PATH = '/routec/matrix/host2-intake';
const HOST2_INTAKE_CANCEL_PATH = '/routec/matrix/host2-intake/cancel';
const HOST_SEMANTIC_EVENTS_PATH = '/routec/matrix/semantic-events';
const ROUTEC_CLIENT_AUTH_LOSS_DIAGNOSTIC_PATH = '/routec/matrix/client-auth-loss-diagnostic';
const OYSTERUN_CLEAN_SESSION_APP_PREFIX = '/app/sessions';
const OYSTERUN_CLEAN_SESSION_CHAT_FOCUS_EVENT_QUERY_PARAM = 'focus_event_id';
const OYSTERUN_ROUTE_C_ACTIVE_ROOM_TIMELINE_FOCUS_EVENT =
  'oysterun-routec-active-room-timeline-focus';
const ROUTE_C_INSERT_PATH_QUERY_PARAM = 'insert_path';
const HOST_PROVIDER_CONTROL_RESPONSE_PATH = '/routec/provider-control-response';
const ROUTE_C_PATH_MEMORY_STORAGE_KEY = 'oysterun_routec_path_context_v1';
const OYSTERUN_DASHBOARD_TOKEN_STORAGE_KEY = 'oysterun_token';
const OYSTERUN_SEMANTIC_NAMESPACE = 'org.oysterun.semantic.v1';
const ROUTEC_MATRIX_RECOVERY_PROOF_SOURCE = 'routec_matrix_sync_budget_recovery';
export const ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM = 'routec_matrix_recovery_debug';
const ROUTEC_MATRIX_RECOVERY_DEBUG_ALLOWED_VALUES = new Set(['1', 'true', 'visible']);
const OYSTERUN_CANCEL_SEMANTIC_TYPES = new Set([
  'control.request',
  'control.outcome',
  'control.cancel.request',
  'control.cancel.outcome',
]);

function normalizeString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isOysterunLocalDebugOrigin(): boolean {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function isOysterunRouteCMatrixRecoveryDebugTriggerEnabled(): boolean {
  const debugValue = new URLSearchParams(window.location.search).get(
    ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM
  );
  return (
    isOysterunLocalDebugOrigin() &&
    ROUTEC_MATRIX_RECOVERY_DEBUG_ALLOWED_VALUES.has((debugValue ?? '').toLowerCase())
  );
}

export type OysterunRouteCMatrixRecoveryDebugTriggerKind =
  | 'debug_visible_notification_resume_fallback'
  | 'debug_visible_matrix_facade_recovery';

export type OysterunRouteCMatrixRecoveryDebugDetail = {
  reason: OysterunRouteCMatrixRecoveryDebugTriggerKind;
  source: 'debug_visible_fallback';
  targetUrl: string;
  sameUrl: true;
  force_recovery: true;
  debug_gate: typeof ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM;
  debug_gate_local_origin_only: true;
  real_notificationclick_claimed: false;
  synthetic_service_worker_message_used: false;
  dashboard_auth_cleared: false;
  local_storage_cleared: false;
  browser_storage_mutated: false;
  matrix_token_mutated: false;
  host_matrix_storage_mutated: false;
  raw_secret_material_exposed: false;
};

export function buildOysterunRouteCMatrixRecoveryDebugDetail(
  reason: OysterunRouteCMatrixRecoveryDebugTriggerKind
): OysterunRouteCMatrixRecoveryDebugDetail {
  return {
    reason,
    source: 'debug_visible_fallback',
    targetUrl: window.location.href,
    sameUrl: true,
    force_recovery: true,
    debug_gate: ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM,
    debug_gate_local_origin_only: true,
    real_notificationclick_claimed: false,
    synthetic_service_worker_message_used: false,
    dashboard_auth_cleared: false,
    local_storage_cleared: false,
    browser_storage_mutated: false,
    matrix_token_mutated: false,
    host_matrix_storage_mutated: false,
    raw_secret_material_exposed: false,
  };
}

export function isOysterunRouteCMatrixRecoveryDebugDetail(
  detail: unknown
): detail is OysterunRouteCMatrixRecoveryDebugDetail {
  const candidate = detail as Partial<OysterunRouteCMatrixRecoveryDebugDetail> | undefined;
  return (
    isOysterunRouteCMatrixRecoveryDebugTriggerEnabled() &&
    candidate?.source === 'debug_visible_fallback' &&
    candidate.force_recovery === true &&
    candidate.debug_gate === ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM &&
    candidate.synthetic_service_worker_message_used === false &&
    candidate.dashboard_auth_cleared === false &&
    candidate.local_storage_cleared === false &&
    candidate.browser_storage_mutated === false &&
    candidate.matrix_token_mutated === false &&
    candidate.host_matrix_storage_mutated === false &&
    candidate.raw_secret_material_exposed === false
  );
}

export function recordOysterunRouteCMatrixRecoveryTriggerProof(
  proof: Record<string, unknown>
): void {
  recordOysterunProof('matrixClientRecoveryTrigger', {
    schema_version: 'routec.matrix_recovery_debug_trigger.v1',
    source: ROUTEC_MATRIX_RECOVERY_PROOF_SOURCE,
    debug_gate: ROUTEC_MATRIX_RECOVERY_DEBUG_QUERY_PARAM,
    debug_gate_enabled: isOysterunRouteCMatrixRecoveryDebugTriggerEnabled(),
    debug_gate_local_origin_only: true,
    real_notificationclick_claimed: false,
    synthetic_service_worker_message_used: false,
    dashboard_auth_cleared: false,
    local_storage_cleared: false,
    browser_storage_mutated: false,
    matrix_token_mutated: false,
    host_matrix_storage_mutated: false,
    private_host_api_primary_proof: false,
    raw_secret_material_exposed: false,
    ...proof,
  });
}

function consumeOysterunDashboardTokenFromHash(): string | undefined {
  const rawHash = window.location.hash || '';
  if (!rawHash.includes(`${OYSTERUN_DASHBOARD_TOKEN_STORAGE_KEY}=`)) return undefined;

  const params = new URLSearchParams(rawHash.replace(/^#/, ''));
  const token = normalizeString(params.get(OYSTERUN_DASHBOARD_TOKEN_STORAGE_KEY));
  if (!token) return undefined;

  try {
    window.localStorage.setItem(OYSTERUN_DASHBOARD_TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage can be unavailable in constrained WebViews; keep the token for this request.
  }

  params.delete(OYSTERUN_DASHBOARD_TOKEN_STORAGE_KEY);
  const nextHash = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`
  );
  return token;
}

function readOysterunDashboardTokenFromStorage(): string | undefined {
  try {
    return normalizeString(window.localStorage.getItem(OYSTERUN_DASHBOARD_TOKEN_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

async function sha256HexForOysterunDiagnostic(value: string | undefined): Promise<string | null> {
  if (!value || !window.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isOysterunCapacitorIOSRuntime(): boolean {
  const capacitor = window.Capacitor;
  return Boolean(
    capacitor &&
      typeof capacitor.isNativePlatform === 'function' &&
      capacitor.isNativePlatform() &&
      typeof capacitor.getPlatform === 'function' &&
      capacitor.getPlatform() === 'ios'
  );
}

function getOysterunDashboardTokenForHostRequest(path: string): string | undefined {
  let target: URL;
  try {
    target = new URL(path, window.location.origin);
  } catch {
    return undefined;
  }
  if (target.origin !== window.location.origin) return undefined;
  return consumeOysterunDashboardTokenFromHash() ?? readOysterunDashboardTokenFromStorage();
}

function buildOysterunHostJsonHeaders(path: string, initHeaders?: HeadersInit): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Oysterun-RouteC': 'foundation',
  });
  new Headers(initHeaders).forEach((value, key) => headers.set(key, value));
  const token = getOysterunDashboardTokenForHostRequest(path);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

function canonicalOysterunControlSemanticType(semanticType: string): string {
  if (semanticType === 'control.cancel.request') return 'control.request';
  if (semanticType === 'control.cancel.outcome') return 'control.outcome';
  return semanticType;
}

function canonicalOysterunControlOutcome(outcome: string | null | undefined): string | null {
  if (!outcome) return null;
  if (outcome === 'too_late_to_cancel') return 'too_late';
  if (
    outcome === 'internal_error' ||
    outcome === 'host2_intake_not_cancelable' ||
    outcome === 'matrix_event_not_stable_for_cancel'
  ) {
    return 'failed';
  }
  if (outcome === 'host2_intake_not_found') return 'not_found';
  return outcome;
}

type OysterunCancelSemanticCommitResponse = {
  status: 'semantic_matrix_event_committed' | 'semantic_matrix_event_not_committed';
  matrix_room_id: string;
  event_type: 'm.room.message';
  txn_id: string;
  event_id: string | null;
  semantic_type: string;
  content: Record<string, unknown>;
  committed_by: string;
  foundation_pass_claimed: false;
  [key: string]: unknown;
};

export type OysterunCancelSemanticCommitProof = {
  semantic_type: string;
  txn_id: string;
  event_id: string;
  matrix_room_id: string;
  target_user_event_id: string;
  control_request_id: string;
  committed_by: string;
};

type HostSessionRouteSource = 'query_session_id' | 'query_host_session_id' | 'clean_session_path';

type HostSessionRoute = {
  sessionId: string;
  source: HostSessionRouteSource;
  initialSource: HostSessionRouteSource;
};

function proofBucket(): OysterunProofBucket {
  window.__oysterunRouteCProofs ??= {
    sendReconciliation: [],
    semanticRows: [],
    semanticDiagnostics: [],
    cancelControls: [],
  };
  return window.__oysterunRouteCProofs;
}

export function getOysterunSemanticRowProofIdentityFields(): readonly string[] {
  return OYSTERUN_SEMANTIC_ROW_PROOF_IDENTITY_FIELDS;
}

function requiredSemanticRowProofIdentityValue(
  proof: Record<string, unknown>,
  field: typeof OYSTERUN_SEMANTIC_ROW_PROOF_IDENTITY_FIELDS[number]
): string {
  const value = proof[field];
  if (field === 'countable_semantic_row') {
    if (value !== false) {
      throw new Error('Oysterun semantic renderer proof requires countable_semantic_row=false.');
    }
    return 'false';
  }
  if (typeof value === 'string' && value.trim()) {
    if (field === 'source_user_event_id_hash_kind' && value !== OYSTERUN_RAW_EVENT_ID_HASH_KIND) {
      throw new Error(
        'Oysterun semantic renderer proof requires raw_event_id_sha256 source binding.'
      );
    }
    if (field === 'proof_scope' && value !== 'semantic-detail-readout') {
      throw new Error('Oysterun semantic renderer proof requires semantic-detail-readout scope.');
    }
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(`Oysterun semantic renderer proof missing required identity field: ${field}.`);
}

function optionalSemanticRowProofIdentityValue(
  proof: Record<string, unknown>,
  field: typeof OYSTERUN_SEMANTIC_ROW_PROOF_OPTIONAL_IDENTITY_FIELDS[number]
): string {
  const value = proof[field];
  if (value === undefined || value === null || value === '') return '';
  if (field === 'allowed_actions' && Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry !== 'string') {
          throw new Error('Oysterun semantic renderer proof has invalid allowed_actions entry.');
        }
        return entry.trim();
      })
      .filter((entry) => entry.length > 0)
      .join(',');
  }
  if (typeof value === 'string') {
    if (field === 'target_user_event_id_hash_kind' && value !== OYSTERUN_RAW_EVENT_ID_HASH_KIND) {
      throw new Error(
        'Oysterun semantic renderer proof requires raw_event_id_sha256 target binding when present.'
      );
    }
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  throw new Error(`Oysterun semantic renderer proof has invalid identity field: ${field}.`);
}

export function buildOysterunSemanticRowProofIdentityKey(proof: Record<string, unknown>): string {
  return [
    ...OYSTERUN_SEMANTIC_ROW_PROOF_IDENTITY_FIELDS.map((field) =>
      requiredSemanticRowProofIdentityValue(proof, field)
    ),
    ...OYSTERUN_SEMANTIC_ROW_PROOF_OPTIONAL_IDENTITY_FIELDS.map((field) =>
      optionalSemanticRowProofIdentityValue(proof, field)
    ),
  ].join(OYSTERUN_SEMANTIC_ROW_PROOF_KEY_SEPARATOR);
}

export type OysterunSemanticReadoutProofClassification = {
  current_source_proof_eligible: boolean;
  semantic_success_countable: boolean;
  semantic_proof_status:
    | 'current_source_raw_event_id_hash_kind_ready'
    | 'diagnostic_non_countable_pre_source_or_stale_readout'
    | 'blocked_current_source_missing_raw_event_id_hash_kind'
    | 'blocked_current_source_invalid_raw_event_id_hash_kind'
    | 'diagnostic_non_countable_incomplete_identity';
  proof_surface_mode: 'canonical_current_readout_by_identity' | 'diagnostic_non_countable_readout';
  missing_identity_fields: string[];
  invalid_identity_fields: string[];
};

function semanticProofStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function semanticProofFieldHasValue(value: unknown): boolean {
  if (value === false) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return semanticProofStringValue(value) !== undefined;
}

function collectSemanticRowIdentityIssues(proof: Record<string, unknown>): {
  missing_identity_fields: string[];
  invalid_identity_fields: string[];
} {
  const missing_identity_fields: string[] = [];
  const invalid_identity_fields: string[] = [];
  for (const field of OYSTERUN_SEMANTIC_ROW_PROOF_IDENTITY_FIELDS) {
    const value = proof[field];
    if (field === 'countable_semantic_row') {
      if (value !== false) invalid_identity_fields.push(field);
      continue;
    }
    if (field === 'source_user_event_id_hash_kind') {
      const hashKind = semanticProofStringValue(value);
      if (!hashKind) {
        missing_identity_fields.push(field);
      } else if (hashKind !== OYSTERUN_RAW_EVENT_ID_HASH_KIND) {
        invalid_identity_fields.push(field);
      }
      continue;
    }
    if (field === 'proof_scope') {
      const proofScope = semanticProofStringValue(value);
      if (!proofScope) {
        missing_identity_fields.push(field);
      } else if (proofScope !== 'semantic-detail-readout') {
        invalid_identity_fields.push(field);
      }
      continue;
    }
    if (!semanticProofFieldHasValue(value)) {
      missing_identity_fields.push(field);
    }
  }
  return { missing_identity_fields, invalid_identity_fields };
}

export function classifyOysterunSemanticRowReadout(
  proof: Record<string, unknown>
): OysterunSemanticReadoutProofClassification {
  const { missing_identity_fields, invalid_identity_fields } =
    collectSemanticRowIdentityIssues(proof);
  if (missing_identity_fields.length === 0 && invalid_identity_fields.length === 0) {
    return {
      current_source_proof_eligible: true,
      semantic_success_countable: true,
      semantic_proof_status: 'current_source_raw_event_id_hash_kind_ready',
      proof_surface_mode: 'canonical_current_readout_by_identity',
      missing_identity_fields,
      invalid_identity_fields,
    };
  }

  const hasSourceEventId = semanticProofStringValue(proof.source_user_event_id) !== undefined;
  const hasSourceEventHash =
    semanticProofStringValue(proof.source_user_event_id_hash) !== undefined;
  const sourceHashKind = semanticProofStringValue(proof.source_user_event_id_hash_kind);
  const hasSourceBinding = hasSourceEventId || hasSourceEventHash || sourceHashKind !== undefined;
  const missingHashKind = missing_identity_fields.includes('source_user_event_id_hash_kind');
  const invalidHashKind = invalid_identity_fields.includes('source_user_event_id_hash_kind');

  if (invalidHashKind && hasSourceBinding) {
    return {
      current_source_proof_eligible: false,
      semantic_success_countable: false,
      semantic_proof_status: 'blocked_current_source_invalid_raw_event_id_hash_kind',
      proof_surface_mode: 'diagnostic_non_countable_readout',
      missing_identity_fields,
      invalid_identity_fields,
    };
  }

  if (missingHashKind && hasSourceBinding) {
    return {
      current_source_proof_eligible: false,
      semantic_success_countable: false,
      semantic_proof_status: 'blocked_current_source_missing_raw_event_id_hash_kind',
      proof_surface_mode: 'diagnostic_non_countable_readout',
      missing_identity_fields,
      invalid_identity_fields,
    };
  }

  return {
    current_source_proof_eligible: false,
    semantic_success_countable: false,
    semantic_proof_status: hasSourceBinding
      ? 'diagnostic_non_countable_incomplete_identity'
      : 'diagnostic_non_countable_pre_source_or_stale_readout',
    proof_surface_mode: 'diagnostic_non_countable_readout',
    missing_identity_fields,
    invalid_identity_fields,
  };
}

function semanticDiagnosticIdentityValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function buildOysterunSemanticDiagnosticIdentityKey(proof: Record<string, unknown>): string {
  return OYSTERUN_SEMANTIC_DIAGNOSTIC_IDENTITY_FIELDS.map((field) =>
    semanticDiagnosticIdentityValue(proof[field])
  ).join(OYSTERUN_SEMANTIC_ROW_PROOF_KEY_SEPARATOR);
}

export function recordOysterunSemanticDiagnostic(proof: Record<string, unknown>) {
  const proofs = proofBucket();
  const now = new Date().toISOString();
  const diagnostic = {
    ...proof,
    at: now,
    proof_surface_mode: 'diagnostic_non_countable_readout',
    current_source_proof_eligible: false,
    semantic_success_countable: false,
    countable_semantic_row: false,
  };
  const identityKey = buildOysterunSemanticDiagnosticIdentityKey(diagnostic);
  const list = proofs.semanticDiagnostics ?? [];
  const existingIndex = list.findIndex(
    (item) => buildOysterunSemanticDiagnosticIdentityKey(item) === identityKey
  );
  if (existingIndex >= 0) {
    const existing = list[existingIndex];
    if (!existing) {
      throw new Error('Oysterun semantic diagnostic proof identity lookup failed.');
    }
    const existingObservationCount =
      typeof existing.proof_observation_count === 'number' ? existing.proof_observation_count : 1;
    list[existingIndex] = {
      ...existing,
      ...diagnostic,
      first_observed_at:
        typeof existing.first_observed_at === 'string'
          ? existing.first_observed_at
          : typeof existing.at === 'string'
          ? existing.at
          : now,
      last_observed_at: now,
      proof_observation_count: existingObservationCount + 1,
    };
  } else {
    list.push({
      ...diagnostic,
      first_observed_at: now,
      last_observed_at: now,
      proof_observation_count: 1,
    });
  }
  proofs.semanticDiagnostics = list;
}

function buildOysterunCleanSessionAppPath(
  sessionId: string,
  page: 'chat' | 'profile' | 'loop' | 'explorer' | 'file-preview',
  params?: URLSearchParams
): string {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error('Oysterun clean session route requires a Host session id.');
  }
  const cleanPath = `${OYSTERUN_CLEAN_SESSION_APP_PREFIX}/${encodeURIComponent(
    normalizedSessionId
  )}/${page}`;
  const query = params?.toString();
  return `${cleanPath}${query ? `?${query}` : ''}`;
}

function buildOysterunCleanSessionChatFocusPath(sessionId: string, eventId: string): string {
  const normalizedEventId = eventId.trim();
  if (!normalizedEventId) {
    throw new Error('Oysterun clean session chat focus requires a Matrix event id.');
  }
  const params = new URLSearchParams();
  params.set(OYSTERUN_CLEAN_SESSION_CHAT_FOCUS_EVENT_QUERY_PARAM, normalizedEventId);
  return buildOysterunCleanSessionAppPath(sessionId, 'chat', params);
}

function readCleanSessionRouteFromPathname(
  pathname = window.location.pathname
): HostSessionRoute | undefined {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 4 && parts[0] === 'app' && parts[1] === 'sessions' && parts[3] === 'chat') {
    const sessionId = decodeURIComponent(parts[2] ?? '').trim();
    if (sessionId) {
      return {
        sessionId,
        source: 'clean_session_path',
        initialSource: 'clean_session_path',
      };
    }
  }
  return undefined;
}

export function isOysterunCleanSessionChatPath(pathname = window.location.pathname): boolean {
  return readCleanSessionRouteFromPathname(pathname) !== undefined;
}

function readHostSessionRoute(): HostSessionRoute | undefined {
  const cleanSessionRoute = readCleanSessionRouteFromPathname();
  if (cleanSessionRoute) return cleanSessionRoute;
  const params = new URLSearchParams(window.location.search);
  const fromSessionIdQuery = params.get('session_id');
  if (fromSessionIdQuery?.trim()) {
    return {
      sessionId: fromSessionIdQuery.trim(),
      source: 'query_session_id',
      initialSource: 'query_session_id',
    };
  }
  const fromHostSessionIdQuery = params.get('host_session_id');
  if (fromHostSessionIdQuery?.trim()) {
    return {
      sessionId: fromHostSessionIdQuery.trim(),
      source: 'query_host_session_id',
      initialSource: 'query_host_session_id',
    };
  }
  return undefined;
}

function readOysterunRouteCPathMemoryStorage(): OysterunRouteCPathMemory {
  try {
    const rawValue = window.localStorage.getItem(ROUTE_C_PATH_MEMORY_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }
    const parsed = JSON.parse(rawValue) as OysterunRouteCPathMemory;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (err) {
    console.warn('[oysterun-routec] failed to read path helper memory', err);
    return {};
  }
}

function getOysterunRouteCPathMemorySessionId(): string | undefined {
  return getOysterunHostSessionId() ?? readHostSessionRoute()?.sessionId;
}

function getOysterunActiveTimelineFocusHostSessionId(): string | undefined {
  return getOysterunHostSessionId() ?? readHostSessionRoute()?.sessionId;
}

function isOysterunActiveRoomTimelineFocusDetail(
  value: unknown
): value is OysterunRouteCActiveRoomTimelineFocusDetail {
  const detail = value as Partial<OysterunRouteCActiveRoomTimelineFocusDetail> | undefined;
  return (
    typeof detail?.hostSessionId === 'string' &&
    detail.hostSessionId.trim().length > 0 &&
    typeof detail.roomId === 'string' &&
    detail.roomId.trim().length > 0 &&
    typeof detail.eventId === 'string' &&
    detail.eventId.trim().length > 0 &&
    (detail.source === 'message_search_open' ||
      detail.source === 'pinned_message_open' ||
      detail.source === 'host_owner_neighbor_navigation') &&
    detail.samePageFocusCommand === true &&
    detail.primaryFocusLoader === 'RoomTimeline.handleOpenEvent/loadEventTimeline'
  );
}

export function requestOysterunActiveRoomTimelineFocus({
  roomId,
  eventId,
  source,
}: {
  roomId: string;
  eventId: string;
  source: OysterunRouteCActiveRoomTimelineFocusSource;
}): boolean {
  const hostSessionId = getOysterunActiveTimelineFocusHostSessionId();
  if (!hostSessionId || typeof window === 'undefined') return false;
  const normalizedRoomId = roomId.trim();
  const normalizedEventId = eventId.trim();
  if (!normalizedRoomId || !normalizedEventId) return false;

  const detail: OysterunRouteCActiveRoomTimelineFocusDetail = {
    hostSessionId,
    roomId: normalizedRoomId,
    eventId: normalizedEventId,
    source,
    handled: false,
    handledBy: null,
    samePageFocusCommand: true,
    primaryFocusLoader: 'RoomTimeline.handleOpenEvent/loadEventTimeline',
    cleanFocusUrlFallbackAvailable: Boolean(getOysterunHostSessionChatFocusPath(normalizedEventId)),
    appStaticShellReloadAllowed: false,
    genericHomeRouteAllowed: false,
    domOnlyFocusAllowed: false,
    jumpToBottomAllowed: false,
  };

  window.dispatchEvent(
    new CustomEvent<OysterunRouteCActiveRoomTimelineFocusDetail>(
      OYSTERUN_ROUTE_C_ACTIVE_ROOM_TIMELINE_FOCUS_EVENT,
      { detail }
    )
  );
  return detail.handled === true;
}

export function subscribeOysterunActiveRoomTimelineFocus(
  roomId: string,
  onFocus: (eventId: string, detail: OysterunRouteCActiveRoomTimelineFocusDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const normalizedRoomId = roomId.trim();
  const handler = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    if (!isOysterunActiveRoomTimelineFocusDetail(detail)) return;
    const activeHostSessionId = getOysterunActiveTimelineFocusHostSessionId();
    if (!activeHostSessionId) return;
    if (detail.hostSessionId !== activeHostSessionId || detail.roomId !== normalizedRoomId) return;

    onFocus(detail.eventId, detail);
    detail.handled = true;
    detail.handledBy = 'active_room_timeline';
  };

  window.addEventListener(OYSTERUN_ROUTE_C_ACTIVE_ROOM_TIMELINE_FOCUS_EVENT, handler);
  return () =>
    window.removeEventListener(OYSTERUN_ROUTE_C_ACTIVE_ROOM_TIMELINE_FOCUS_EVENT, handler);
}

export function getOysterunRouteCPathMemory(): OysterunRouteCPathMemorySnapshot {
  const sessionId = getOysterunRouteCPathMemorySessionId();
  const memory = readOysterunRouteCPathMemoryStorage();
  return {
    explorerPath: sessionId ? memory.explorer_paths?.[sessionId] ?? '' : '',
    previewPath: sessionId ? memory.preview_paths?.[sessionId] ?? '' : '',
  };
}

export function getOysterunRouteCMatrixActorRegistry(): OysterunMatrixActorRegistry | undefined {
  return (
    cachedBootstrap?.routec_matrix_actor_registry ??
    cachedBootstrap?.binding.routec_matrix_actor_registry
  );
}

export function getOysterunHostSessionRouteSearch(): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  const params = new URLSearchParams();
  params.set(
    route.source === 'query_host_session_id' ? 'host_session_id' : 'session_id',
    route.sessionId
  );
  return `?${params.toString()}`;
}

export function getOysterunHostSessionsPath(): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  return '/app/sessions';
}

export function getOysterunHostSessionChatPath(): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  return buildOysterunCleanSessionAppPath(route.sessionId, 'chat');
}

export function getOysterunHostSessionChatPathForSession(sessionId: string): string {
  return buildOysterunCleanSessionAppPath(sessionId, 'chat');
}

export function getOysterunHostSessionChatFocusPath(eventId: string): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  return buildOysterunCleanSessionChatFocusPath(route.sessionId, eventId);
}

export function normalizeOysterunRouteCSiteBrowserTarget(target: string): string | undefined {
  const trimmedTarget = target.trim();
  if (!trimmedTarget) return undefined;
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(trimmedTarget, window.location.origin);
  } catch {
    return undefined;
  }
  if (parsedTarget.origin !== window.location.origin) return undefined;
  if (!parsedTarget.pathname.startsWith('/sites/')) return undefined;
  return `${parsedTarget.pathname}${parsedTarget.search}${parsedTarget.hash}`;
}

export function getOysterunHostSessionBrowserPath(target: string): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  const normalizedTarget = normalizeOysterunRouteCSiteBrowserTarget(target);
  if (!normalizedTarget) return undefined;
  const params = new URLSearchParams();
  params.set('target', normalizedTarget);
  params.set('session_id', route.sessionId);
  params.set('source', 'chat');
  params.set('return_path', buildOysterunCleanSessionAppPath(route.sessionId, 'chat'));
  return `/app/browser?${params.toString()}`;
}

export function getOysterunHostBrowserPath(target: string): string | undefined {
  const normalizedTarget = normalizeOysterunRouteCSiteBrowserTarget(target);
  if (!normalizedTarget) return undefined;
  const params = new URLSearchParams();
  params.set('target', normalizedTarget);
  return `/app/browser?${params.toString()}`;
}

export type OysterunBrowserHandoffLaunch = {
  launchUrl: string;
  targetPath: string;
};

export async function createOysterunHostBrowserHandoffLaunch(
  target: string
): Promise<OysterunBrowserHandoffLaunch> {
  const normalizedTarget = normalizeOysterunRouteCSiteBrowserTarget(target);
  if (!normalizedTarget) {
    throw new Error('Only /sites/<agent_id>/ targets can use browser handoff.');
  }
  const payload = await hostJson<unknown>('/api/browser/handoff', {
    method: 'POST',
    body: JSON.stringify({ target: normalizedTarget }),
  });
  const data = payload as Record<string, unknown>;
  const rawLaunchUrl = typeof data.launch_url === 'string' ? data.launch_url.trim() : '';
  if (!rawLaunchUrl) {
    throw new Error('Browser handoff response missing launch_url.');
  }
  const launchUrl = new URL(rawLaunchUrl, window.location.origin);
  if (
    launchUrl.origin !== window.location.origin ||
    !launchUrl.pathname.startsWith('/browser-handoff/')
  ) {
    throw new Error('Browser handoff response returned an invalid launch_url.');
  }
  const rawTargetPath = typeof data.target_path === 'string' ? data.target_path : normalizedTarget;
  return {
    launchUrl: `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`,
    targetPath: normalizeOysterunRouteCSiteBrowserTarget(rawTargetPath) ?? normalizedTarget,
  };
}

export function getOysterunHostSessionBrowserPathOrTargetFallback(
  target: string
): string | undefined {
  return getOysterunHostSessionBrowserPath(target) ?? getOysterunHostBrowserPath(target);
}

function readSameOriginAppTarget(target: string, pathname: string): URL | undefined {
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target.trim(), window.location.origin);
  } catch {
    return undefined;
  }
  if (parsedTarget.origin !== window.location.origin) return undefined;
  if (parsedTarget.pathname !== pathname) return undefined;
  return parsedTarget;
}

export function getOysterunHostSessionFilePreviewPath(target: string): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  const parsedTarget = readSameOriginAppTarget(target, '/app/file-preview');
  if (!parsedTarget) return undefined;
  const path = parsedTarget.searchParams.get('path')?.trim();
  if (!path) return undefined;
  const params = new URLSearchParams();
  params.set('path', path);
  params.set('mode', parsedTarget.searchParams.get('mode') || 'rendered');
  params.set('return_path', buildOysterunCleanSessionAppPath(route.sessionId, 'chat'));
  return buildOysterunCleanSessionAppPath(route.sessionId, 'file-preview', params);
}

export function getOysterunHostSessionExplorerPathFromTarget(target: string): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  const parsedTarget = readSameOriginAppTarget(target, '/app/explorer');
  if (!parsedTarget) return undefined;
  const path = parsedTarget.searchParams.get('path')?.trim();
  if (!path) return undefined;
  const params = new URLSearchParams();
  params.set('path', path);
  const query = parsedTarget.searchParams.get('q') || '';
  if (query) params.set('q', query);
  return buildOysterunCleanSessionAppPath(route.sessionId, 'explorer', params);
}

export function getOysterunHostSessionChatFocusEventId(): string | undefined {
  if (!readHostSessionRoute()) return undefined;
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get(OYSTERUN_CLEAN_SESSION_CHAT_FOCUS_EVENT_QUERY_PARAM)?.trim();
  return eventId || undefined;
}

export function navigateOysterunHostSessionsPage(): void {
  const sessionsPath = getOysterunHostSessionsPath();
  if (!sessionsPath) {
    throw new Error('Route C previous page navigation requires a Host session route.');
  }
  const target = new URL(sessionsPath, window.location.origin);
  if (target.origin !== window.location.origin) {
    throw new Error('Route C previous page navigation must stay on the current Host origin.');
  }
  window.location.assign(`${target.pathname}${target.search}`);
}

export function getOysterunHostSessionProfilePath(roomId: string): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  const matrixRoomId = roomId.trim();
  if (!matrixRoomId) {
    throw new Error('Route C Session Profile requires the bound Matrix room id.');
  }
  return buildOysterunCleanSessionAppPath(route.sessionId, 'profile');
}

export function getOysterunHostSessionLoopPath(roomId: string): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  const matrixRoomId = roomId.trim();
  if (!matrixRoomId) {
    throw new Error('Route C Loop requires the bound Matrix room id.');
  }
  return buildOysterunCleanSessionAppPath(route.sessionId, 'loop');
}

export function getOysterunHostExplorerPath(roomId: string): string | undefined {
  const route = readHostSessionRoute();
  if (!route) return undefined;
  const matrixRoomId = roomId.trim();
  if (!matrixRoomId) {
    throw new Error('Route C Explorer requires the bound Matrix room id.');
  }
  return buildOysterunCleanSessionAppPath(route.sessionId, 'explorer');
}

export function consumeOysterunRouteCInsertPathQuery(): string | undefined {
  if (!readHostSessionRoute()) return undefined;
  const params = new URLSearchParams(window.location.search);
  const insertPath = params.get(ROUTE_C_INSERT_PATH_QUERY_PARAM);
  if (!insertPath?.trim()) return undefined;
  params.delete(ROUTE_C_INSERT_PATH_QUERY_PARAM);
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${
    window.location.hash
  }`;
  window.history.replaceState(window.history.state, '', nextUrl);
  return insertPath;
}

function requiredHostSessionRoute(): HostSessionRoute {
  const route = readHostSessionRoute();
  if (route) return route;
  throw new Error('Route C requires a Host session id before MatrixClient initialization.');
}

export function hasOysterunHostSessionRoute(): boolean {
  return readHostSessionRoute() !== undefined;
}

export async function getOysterunRouteCHostSessionStatus(): Promise<OysterunHostSessionStatus> {
  const route = requiredHostSessionRoute();
  const params = new URLSearchParams();
  params.set('session_id', route.sessionId);
  return hostJson<OysterunHostSessionStatus>(`/session/status?${params.toString()}`, {
    method: 'GET',
  });
}

export function isOysterunRouteCCompactProvider(provider: unknown): boolean {
  return typeof provider === 'string' && provider.trim().toLocaleLowerCase() === 'codex';
}

export async function listOysterunRouteCAgentCommands(): Promise<OysterunRouteCAgentCommandsResponse> {
  const status = await getOysterunRouteCHostSessionStatus();
  const agentId = status.agent_id.trim();
  if (!agentId) {
    throw new Error('Route C slash command discovery requires a Host agent id.');
  }
  const params = new URLSearchParams();
  params.set('agent_id', agentId);
  const response = await hostJson<OysterunRouteCAgentCommandsResponse>(
    `/agent/commands?${params.toString()}`,
    {
      method: 'GET',
    }
  );
  if (response.agent_id !== agentId) {
    throw new Error('Route C slash command discovery returned mismatched agent_id.');
  }
  if (!Array.isArray(response.commands)) {
    throw new Error('Route C slash command discovery returned invalid commands.');
  }
  return response;
}

export async function getOysterunRouteCProviderSkillStatus(
  provider?: string | null
): Promise<OysterunRouteCProviderSkillStatusResponse> {
  const status = await getOysterunRouteCHostSessionStatus();
  const agentId = status.agent_id.trim();
  if (!agentId) {
    throw new Error('Route C provider skill status requires a Host agent id.');
  }
  const params = new URLSearchParams();
  params.set('agent_id', agentId);
  const normalizedProvider = typeof provider === 'string' ? provider.trim() : '';
  if (normalizedProvider) params.set('provider', normalizedProvider);
  const response = await hostJson<OysterunRouteCProviderSkillStatusResponse>(
    `/agent/provider-skill-status?${params.toString()}`,
    {
      method: 'GET',
    }
  );
  if (response.agent_id !== agentId) {
    throw new Error('Route C provider skill status returned mismatched agent_id.');
  }
  return response;
}

export function getOysterunBootstrappedSessionNotificationSettings():
  | OysterunSessionNotificationSettings
  | undefined {
  return cachedBootstrap?.notification_settings ?? undefined;
}

export async function getOysterunSessionNotificationSettings({
  sessionId,
  matrixRoomId,
}: {
  sessionId: string;
  matrixRoomId?: string;
}): Promise<OysterunSessionNotificationSettings> {
  const params = new URLSearchParams();
  params.set('session_id', sessionId);
  if (matrixRoomId) params.set('matrix_room_id', matrixRoomId);
  const response = await hostJson<{
    status: 'ok';
    session_id: string;
    notification_settings: OysterunSessionNotificationSettings;
  }>(`/session/notification-settings?${params.toString()}`, {
    method: 'GET',
  });
  if (
    cachedBootstrap?.binding.host_session_id === response.session_id ||
    cachedBootstrap?.binding.host_session_id === response.notification_settings.session_id
  ) {
    cachedBootstrap = {
      ...cachedBootstrap,
      notification_settings: response.notification_settings,
    };
  }
  return response.notification_settings;
}

export async function isOysterunCompleteMessageNotificationPolicyEnabled(candidate: {
  sessionId?: string;
  hostSessionId?: string;
  matrixRoomId?: string;
  roomId?: string;
}): Promise<boolean> {
  const session_id =
    normalizeString(candidate.sessionId) || normalizeString(candidate.hostSessionId);
  const matrix_room_id =
    normalizeString(candidate.matrixRoomId) || normalizeString(candidate.roomId);
  if (!session_id) return false;
  try {
    const notification_settings = await getOysterunSessionNotificationSettings({
      sessionId: session_id,
      matrixRoomId: matrix_room_id,
    });
    return notification_settings.per_session_notification_enabled !== false;
  } catch (err) {
    console.warn('Oysterun per-session notification policy check failed closed', err);
    return false;
  }
}

export async function getOysterunRouteCHostPathRoots(): Promise<OysterunHostPathRoots> {
  const response = await hostJson<OysterunAgentCatalogResponse>('/agents/catalog', {
    method: 'GET',
  });
  return response.roots;
}

function buildOysterunRouteCAgentSitePrefix(agentId: string): string {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    throw new Error('Route C website target requires a Host agent id.');
  }
  return `/sites/${encodeURIComponent(normalizedAgentId)}/`;
}

function normalizeOysterunRouteCWebsiteEntryPath(
  agentId: string,
  website: OysterunAgentWebsiteMetadata
): string | undefined {
  const rawEntryPath = (website.canonical_entry_path || website.entry_path).trim();
  if (!rawEntryPath.startsWith('/sites/')) return undefined;
  const agentSitePrefix = buildOysterunRouteCAgentSitePrefix(agentId);
  const target = new URL(rawEntryPath, window.location.origin);
  if (target.origin !== window.location.origin) return undefined;
  const targetPath = `${target.pathname}${target.search}${target.hash}`;
  if (targetPath !== agentSitePrefix && !targetPath.startsWith(agentSitePrefix)) {
    return undefined;
  }
  return targetPath;
}

export async function getOysterunRouteCHostCurrentWebsiteTarget(): Promise<
  OysterunRouteCWebsiteTarget | undefined
> {
  const status = await getOysterunRouteCHostSessionStatus();
  const agentId = status.agent_id.trim();
  if (!agentId) {
    throw new Error('Route C website target requires a current Host session agent id.');
  }
  const catalog = await hostJson<OysterunAgentCatalogResponse>('/agents/catalog', {
    method: 'GET',
  });
  const websiteCatalogEntry = (catalog.websites ?? []).find((entry) => entry.agent_id === agentId);
  const agentCatalogEntry = (catalog.agents ?? []).find((entry) => entry.agent_id === agentId);
  const website = websiteCatalogEntry?.website ?? agentCatalogEntry?.website;
  if (!website || website.available !== true) return undefined;

  const entryPath = normalizeOysterunRouteCWebsiteEntryPath(agentId, website);
  if (!entryPath) {
    throw new Error('Route C website target requires a canonical /sites/<agent_id>/ path.');
  }

  return {
    agentId,
    entryPath,
    source: 'agents_catalog_websites',
  };
}

export async function listOysterunRouteCBrowseEntries({
  path,
  query,
  limit,
}: {
  path: string;
  query?: string;
  limit?: number;
}): Promise<OysterunBrowsePage> {
  const params = new URLSearchParams();
  params.set('path', path);
  params.set('offset', '0');
  params.set('limit', String(limit ?? 40));
  if (query?.trim()) {
    params.set('q', query.trim());
  }
  return hostJson<OysterunBrowsePage>(`/dev/folders?${params.toString()}`, {
    method: 'GET',
  });
}

export async function getOysterunLargeToolOutput({
  sessionId,
  matrixRoomId,
  page = 1,
  retainedEventId,
  providerTurnId,
  targetTurnId,
  groupingKey,
}: OysterunLargeToolOutputRequest): Promise<OysterunLargeToolOutputResponse> {
  const params = new URLSearchParams();
  params.set('session_id', sessionId);
  params.set('matrix_room_id', matrixRoomId);
  params.set('page', String(page));
  if (retainedEventId) params.set('retained_event_id', retainedEventId);
  if (providerTurnId) params.set('provider_turn_id', providerTurnId);
  if (targetTurnId) params.set('target_turn_id', targetTurnId);
  if (groupingKey) params.set('grouping_key', groupingKey);
  return hostJson<OysterunLargeToolOutputResponse>(
    `/session/large-tool-output?${params.toString()}`,
    {
      method: 'GET',
    }
  );
}

export async function getOysterunToolEventDetail({
  sessionId,
  matrixRoomId,
  matrixEventId,
  page = 1,
}: OysterunToolEventDetailRequest): Promise<OysterunToolEventDetailResponse> {
  const params = new URLSearchParams();
  params.set('session_id', sessionId);
  params.set('matrix_room_id', matrixRoomId);
  params.set('matrix_event_id', matrixEventId);
  params.set('page', String(page));
  return hostJson<OysterunToolEventDetailResponse>(
    `/session/tool-event-detail?${params.toString()}`,
    {
      method: 'GET',
    }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOysterunHostOwnerMessageNeighborEvent(
  value: unknown
): value is OysterunHostOwnerMessageNeighborEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.event_id === 'string' &&
    value.event_id.trim().length > 0 &&
    Number.isSafeInteger(value.routec_stream_seq) &&
    (typeof value.origin_server_ts === 'number' || value.origin_server_ts === null)
  );
}

function assertOysterunHostOwnerMessageNeighborsResponse(
  value: unknown
): OysterunHostOwnerMessageNeighborsResponse {
  if (!isRecord(value)) {
    throw new Error('Route C Host Owner neighbor response must be an object.');
  }
  const proof = value.proof;
  const boundaries = value.boundaries;
  const anchor = value.anchor;
  const previous = value.previous;
  const next = value.next;
  const validAnchor =
    anchor === null ||
    (isRecord(anchor) &&
      (anchor.anchor_position === 'event' || anchor.anchor_position === 'latest') &&
      (typeof anchor.event_id === 'string' || anchor.event_id === null) &&
      (Number.isSafeInteger(anchor.routec_stream_seq) || anchor.routec_stream_seq === null) &&
      typeof anchor.host_owner_message === 'boolean');
  const validProof =
    isRecord(proof) &&
    (proof.schema_version === 'routec.p180_host_owner_message_neighbors.v1' ||
      proof.schema_version === 'routec.p324_host_owner_neighbor_bounded_scan.v1') &&
    proof.lookup_source === 'routec_host_owned_matrix_storage_room_event_index' &&
    proof.order_by === 'routec_stream_seq' &&
    proof.actor_key === 'human' &&
    proof.actor_kind === 'human' &&
    proof.stable_actor_metadata_required === true &&
    proof.display_name_used_for_ownership === false &&
    proof.body_scan_used_for_ownership === false &&
    proof.raw_event_payload_returned === false &&
    proof.message_body_returned === false &&
    (proof.schema_version !== 'routec.p324_host_owner_neighbor_bounded_scan.v1' ||
      (proof.lookup_strategy === 'bounded_short_circuit_scan' &&
        Number.isSafeInteger(proof.total_event_count) &&
        Number.isSafeInteger(proof.max_scan_events_per_direction) &&
        Number.isSafeInteger(proof.previous_scanned_event_count) &&
        Number.isSafeInteger(proof.next_scanned_event_count) &&
        typeof proof.previous_window_exhausted === 'boolean' &&
        typeof proof.next_window_exhausted === 'boolean'));
  if (
    value.status !== 'ok' ||
    typeof value.session_id !== 'string' ||
    typeof value.matrix_room_id !== 'string' ||
    !validAnchor ||
    !(previous === null || isOysterunHostOwnerMessageNeighborEvent(previous)) ||
    !(next === null || isOysterunHostOwnerMessageNeighborEvent(next)) ||
    !isRecord(boundaries) ||
    typeof boundaries.no_host_owner_messages !== 'boolean' ||
    typeof boundaries.at_first_host_owner_message !== 'boolean' ||
    typeof boundaries.at_latest_host_owner_message !== 'boolean' ||
    (typeof boundaries.previous_window_exhausted !== 'undefined' &&
      typeof boundaries.previous_window_exhausted !== 'boolean') ||
    (typeof boundaries.next_window_exhausted !== 'undefined' &&
      typeof boundaries.next_window_exhausted !== 'boolean') ||
    !validProof ||
    value.raw_event_payload_returned !== false ||
    value.message_body_returned !== false
  ) {
    throw new Error('Route C Host Owner neighbor response failed validation.');
  }
  return value as OysterunHostOwnerMessageNeighborsResponse;
}

export async function getOysterunHostOwnerMessageNeighbors({
  roomId,
  anchorEventId,
  anchorPosition,
}: OysterunHostOwnerMessageNeighborsRequest): Promise<OysterunHostOwnerMessageNeighborsResponse> {
  const route = readHostSessionRoute();
  if (!route) {
    throw new Error('Route C Host Owner neighbor navigation requires a Host session route.');
  }
  const normalizedRoomId = roomId.trim();
  const normalizedAnchorEventId = anchorEventId?.trim();
  if (!normalizedRoomId) {
    throw new Error('Route C Host Owner neighbor navigation requires a Matrix room id.');
  }
  if (!normalizedAnchorEventId && anchorPosition !== 'latest') {
    throw new Error(
      'Route C Host Owner neighbor navigation requires an anchor event id or latest anchor.'
    );
  }

  const params = new URLSearchParams();
  params.set('session_id', route.sessionId);
  params.set('matrix_room_id', normalizedRoomId);
  if (normalizedAnchorEventId) {
    params.set('anchor_event_id', normalizedAnchorEventId);
  } else {
    params.set('anchor_position', 'latest');
  }
  const payload = await hostJson<unknown>(
    `/session/host-owner-message-neighbors?${params.toString()}`,
    {
      method: 'GET',
    }
  );
  return assertOysterunHostOwnerMessageNeighborsResponse(payload);
}

async function hostJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: buildOysterunHostJsonHeaders(path, init.headers),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(
      `Route C Host request failed ${response.status}: ${payload.error ?? payload.errcode ?? path}`
    ) as Error & { status?: number; data?: unknown; path?: string };
    error.status = response.status;
    error.data = payload;
    error.path = path;
    throw error;
  }
  return payload as T;
}

export type OysterunPushRegisterBody = {
  apns_token?: string;
  topic?: string;
  environment?: string;
  permission_state?: 'authorized' | 'denied' | 'provisional';
};

type OysterunCloudNotificationBootstrapResponse = {
  status: 'notification_bootstrap_created';
  host_id: string;
  cloud_api_url: string;
  cloud_api_stage?: string | null;
  notification_registration_token: string;
  expires_at?: string | null;
  ttl_seconds?: number | null;
};

type OysterunCloudInstallationIdentity = {
  installation_id: string;
  installation_credential: string;
};

type OysterunCloudChallengeResponse = {
  challenge_id: string;
  challenge: string;
};

type OysterunAppAttestProof = {
  app_attest_key_id: string;
  attestation_object: string;
};

type OysterunAppAttestPlugin = {
  attest: (options: { challenge: string }) => Promise<OysterunAppAttestProof>;
  loadIdentity: (options: { key: string }) => Promise<{ identity?: string | null }>;
  saveIdentity: (options: { key: string; identity: string }) => Promise<unknown>;
  clearIdentity?: (options: { key: string }) => Promise<unknown>;
};

const OYSTERUN_CLOUD_INSTALLATION_IDENTITY_KEY_PREFIX = 'oysterun-cloud-installation-identity-v1';
const OYSTERUN_CLOUD_DEV_TEAM_ID = 'TEAMID1234';
const OYSTERUN_CLOUD_FALLBACK_BUNDLE_ID = 'com.example.oysteruncore.dev';

function normalizeOysterunCloudBundleId(bundleId?: string | null): string | null {
  const normalized = String(bundleId || '').trim();
  return normalized || null;
}

function getOysterunIOSAPNsEnvironmentForBundleId(bundleId: string): 'sandbox' | 'production' {
  return bundleId === 'com.example.oysteruncore' ? 'production' : 'sandbox';
}

async function getOysterunNativeBundleId(): Promise<string | null> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    return null;
  }
  try {
    const appInfo = await App.getInfo();
    return normalizeOysterunCloudBundleId(appInfo.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[oysterun-push] native app bundle id unavailable', err);
    return null;
  }
}

async function resolveOysterunCloudBundleId({
  body,
}: {
  body: OysterunPushRegisterBody;
}): Promise<string> {
  const nativeBundleId = await getOysterunNativeBundleId();
  if (nativeBundleId) return nativeBundleId;
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
    throw new Error(
      'Oysterun iOS bundle id is unavailable; App Attest registration requires App.getInfo().id from the native @capacitor/app plugin.'
    );
  }
  const explicitTopic = normalizeOysterunCloudBundleId(body.topic);
  if (explicitTopic) return explicitTopic;
  return OYSTERUN_CLOUD_FALLBACK_BUNDLE_ID;
}

function normalizeOysterunCloudStage(cloudApiStage?: string | null): string {
  const stage = String(cloudApiStage || '')
    .trim()
    .toLowerCase();
  return stage === 'beta' || stage === 'dev' ? stage : 'prod';
}

function getOysterunCloudInstallationIdentityKey(
  cloudApiUrl: string,
  cloudApiStage?: string | null
): string {
  return `${OYSTERUN_CLOUD_INSTALLATION_IDENTITY_KEY_PREFIX}:${normalizeOysterunCloudStage(
    cloudApiStage
  )}:${cloudApiUrl}`;
}

function loadOysterunCloudInstallationIdentity(
  cloudApiUrl: string,
  cloudApiStage?: string | null
): OysterunCloudInstallationIdentity | null {
  try {
    const raw = window.localStorage.getItem(
      getOysterunCloudInstallationIdentityKey(cloudApiUrl, cloudApiStage)
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OysterunCloudInstallationIdentity>;
    if (
      typeof parsed.installation_id === 'string' &&
      parsed.installation_id &&
      typeof parsed.installation_credential === 'string' &&
      parsed.installation_credential
    ) {
      return {
        installation_id: parsed.installation_id,
        installation_credential: parsed.installation_credential,
      };
    }
  } catch {
    /* ignore unreadable local identity */
  }
  return null;
}

function saveOysterunCloudInstallationIdentity(
  cloudApiUrl: string,
  cloudApiStage: string | null | undefined,
  identity: OysterunCloudInstallationIdentity
): void {
  try {
    window.localStorage.setItem(
      getOysterunCloudInstallationIdentityKey(cloudApiUrl, cloudApiStage),
      JSON.stringify(identity)
    );
  } catch {
    /* local identity persistence is best-effort */
  }
}

function parseOysterunCloudInstallationIdentity(
  raw: string | null | undefined
): OysterunCloudInstallationIdentity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OysterunCloudInstallationIdentity>;
    if (
      typeof parsed.installation_id === 'string' &&
      parsed.installation_id &&
      typeof parsed.installation_credential === 'string' &&
      parsed.installation_credential
    ) {
      return {
        installation_id: parsed.installation_id,
        installation_credential: parsed.installation_credential,
      };
    }
  } catch {
    /* ignore unreadable identity */
  }
  return null;
}

function getOysterunAppAttestPlugin(): OysterunAppAttestPlugin | null {
  const capacitor = window.Capacitor;
  if (!capacitor) return null;
  const plugin = capacitor.Plugins?.OysterunAppAttest as
    | Partial<OysterunAppAttestPlugin>
    | undefined;
  if (
    plugin &&
    typeof plugin.attest === 'function' &&
    typeof plugin.loadIdentity === 'function' &&
    typeof plugin.saveIdentity === 'function'
  ) {
    return plugin as OysterunAppAttestPlugin;
  }
  if (
    typeof capacitor.isPluginAvailable === 'function' &&
    capacitor.isPluginAvailable('OysterunAppAttest') &&
    typeof capacitor.nativePromise === 'function'
  ) {
    return {
      attest: (options) =>
        capacitor.nativePromise?.(
          'OysterunAppAttest',
          'attest',
          options
        ) as Promise<OysterunAppAttestProof>,
      loadIdentity: (options) =>
        capacitor.nativePromise?.('OysterunAppAttest', 'loadIdentity', options) as Promise<{
          identity?: string | null;
        }>,
      saveIdentity: (options) =>
        capacitor.nativePromise?.('OysterunAppAttest', 'saveIdentity', options) as Promise<unknown>,
      clearIdentity: (options) =>
        capacitor.nativePromise?.(
          'OysterunAppAttest',
          'clearIdentity',
          options
        ) as Promise<unknown>,
    };
  }
  return null;
}

async function loadOysterunCloudInstallationIdentityFromNative(
  cloudApiUrl: string,
  cloudApiStage?: string | null
): Promise<OysterunCloudInstallationIdentity | null> {
  const plugin = getOysterunAppAttestPlugin();
  if (!plugin) return null;
  const key = getOysterunCloudInstallationIdentityKey(cloudApiUrl, cloudApiStage);
  const result = await plugin.loadIdentity({ key });
  return parseOysterunCloudInstallationIdentity(result.identity);
}

async function saveOysterunCloudInstallationIdentityToNative(
  cloudApiUrl: string,
  cloudApiStage: string | null | undefined,
  identity: OysterunCloudInstallationIdentity
): Promise<boolean> {
  const plugin = getOysterunAppAttestPlugin();
  if (!plugin) return false;
  const key = getOysterunCloudInstallationIdentityKey(cloudApiUrl, cloudApiStage);
  await plugin.saveIdentity({ key, identity: JSON.stringify(identity) });
  return true;
}

async function cloudJson<T>(
  cloudApiUrl: string,
  cloudApiStage: string | null | undefined,
  path: string,
  init: RequestInit
): Promise<T> {
  const base = cloudApiUrl.replace(/\/+$/, '');
  const url = new URL(path, `${base}/`);
  const stage = normalizeOysterunCloudStage(cloudApiStage);
  if (stage !== 'prod') url.searchParams.set('oysterun_stage', stage);
  const { headers: initHeaders = {}, ...requestInit } = init;
  const response = await fetch(url.toString(), {
    ...requestInit,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(initHeaders as Record<string, string>),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(
      `Oysterun Cloud request failed ${response.status}: ${payload.detail ?? payload.error ?? path}`
    ) as Error & { status?: number; data?: unknown; path?: string };
    error.status = response.status;
    error.data = payload;
    error.path = path;
    throw error;
  }
  return payload as T;
}

async function createOysterunCloudNotificationBootstrap(): Promise<OysterunCloudNotificationBootstrapResponse> {
  return hostJson<OysterunCloudNotificationBootstrapResponse>('/cloud/notification-bootstrap', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

async function ensureOysterunCloudInstallationIdentity({
  cloudApiUrl,
  cloudApiStage,
  bundleId,
}: {
  cloudApiUrl: string;
  cloudApiStage?: string | null;
  bundleId: string;
}): Promise<OysterunCloudInstallationIdentity> {
  const nativeIdentity = await loadOysterunCloudInstallationIdentityFromNative(
    cloudApiUrl,
    cloudApiStage
  );
  if (nativeIdentity) return nativeIdentity;
  if (!getOysterunAppAttestPlugin()) {
    const existing = loadOysterunCloudInstallationIdentity(cloudApiUrl, cloudApiStage);
    if (existing) return existing;
  }
  const challenge = await cloudJson<OysterunCloudChallengeResponse>(
    cloudApiUrl,
    cloudApiStage,
    '/api/app-installations/challenge',
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
  const appAttestPlugin = getOysterunAppAttestPlugin();
  if (!appAttestPlugin) {
    throw new Error('Apple App Attest plugin is not available in this app build.');
  }
  const appAttest = await appAttestPlugin.attest({ challenge: challenge.challenge });
  const identity = await cloudJson<OysterunCloudInstallationIdentity>(
    cloudApiUrl,
    cloudApiStage,
    '/api/app-installations/register',
    {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        challenge: challenge.challenge,
        platform: 'ios',
        team_id: OYSTERUN_CLOUD_DEV_TEAM_ID,
        bundle_id: bundleId,
        app_attest_key_id: appAttest.app_attest_key_id,
        attestation_object: appAttest.attestation_object,
      }),
    }
  );
  const savedNative = await saveOysterunCloudInstallationIdentityToNative(
    cloudApiUrl,
    cloudApiStage,
    identity
  );
  if (!savedNative) {
    saveOysterunCloudInstallationIdentity(cloudApiUrl, cloudApiStage, identity);
  }
  return identity;
}

// Register (or remove on permission_state=denied) the device's APNs token.
// P207 ownership: the app obtains a Host-issued Cloud bootstrap token, ensures
// its own Cloud app installation credential, pairs to the Host, then registers
// the APNs token directly with Cloud. Host device_token is not used for this.
export async function registerOysterunPushToken(body: OysterunPushRegisterBody): Promise<unknown> {
  const bootstrap = await createOysterunCloudNotificationBootstrap();
  const bundleId = await resolveOysterunCloudBundleId({ body });
  const apnsEnvironment = getOysterunIOSAPNsEnvironmentForBundleId(bundleId);
  const identity = await ensureOysterunCloudInstallationIdentity({
    cloudApiUrl: bootstrap.cloud_api_url,
    cloudApiStage: bootstrap.cloud_api_stage,
    bundleId,
  });
  await cloudJson(
    bootstrap.cloud_api_url,
    bootstrap.cloud_api_stage,
    '/api/host-installations/pair',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.installation_credential}`,
      },
      body: JSON.stringify({
        host_id: bootstrap.host_id,
        notification_registration_token: bootstrap.notification_registration_token,
      }),
    }
  );
  return cloudJson(bootstrap.cloud_api_url, bootstrap.cloud_api_stage, '/api/push/register', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${identity.installation_credential}`,
    },
    body: JSON.stringify({
      ...body,
      host_id: bootstrap.host_id,
      topic: body.topic || bundleId,
      environment: apnsEnvironment,
    }),
  });
}

export function recordOysterunProof(
  bucket: keyof OysterunProofBucket,
  proof: Record<string, unknown>
) {
  const proofs = proofBucket();
  if (bucket === 'sendReconciliation') {
    const list = proofs[bucket] ?? [];
    list.push({
      at: new Date().toISOString(),
      ...proof,
    });
    proofs[bucket] = list;
    return;
  }
  if (bucket === 'semanticRows') {
    const now = new Date().toISOString();
    const identityKey = buildOysterunSemanticRowProofIdentityKey(proof);
    const list = proofs.semanticRows ?? [];
    const existingIndex = list.findIndex(
      (item) => buildOysterunSemanticRowProofIdentityKey(item) === identityKey
    );
    if (existingIndex >= 0) {
      const existing = list[existingIndex];
      if (!existing) {
        throw new Error('Oysterun semantic renderer proof identity lookup failed.');
      }
      const existingObservationCount =
        typeof existing.proof_observation_count === 'number' ? existing.proof_observation_count : 1;
      list[existingIndex] = {
        ...existing,
        ...proof,
        first_observed_at:
          typeof existing.first_observed_at === 'string'
            ? existing.first_observed_at
            : typeof existing.at === 'string'
            ? existing.at
            : now,
        last_observed_at: now,
        at: now,
        proof_observation_count: existingObservationCount + 1,
        proof_surface_mode: 'canonical_current_readout_by_identity',
      };
    } else {
      list.push({
        at: now,
        first_observed_at: now,
        last_observed_at: now,
        proof_observation_count: 1,
        proof_surface_mode: 'canonical_current_readout_by_identity',
        ...proof,
      });
    }
    proofs.semanticRows = list;
    return;
  }
  if (bucket === 'cancelControls') {
    const list = proofs.cancelControls ?? [];
    list.push({
      at: new Date().toISOString(),
      ...proof,
    });
    proofs.cancelControls = list;
    return;
  }
  if (bucket === 'interruptControls') {
    const list = proofs.interruptControls ?? [];
    list.push({
      at: new Date().toISOString(),
      ...proof,
    });
    proofs.interruptControls = list;
    return;
  }
  if (bucket === 'terminalCommands') {
    const list = proofs.terminalCommands ?? [];
    list.push({
      at: new Date().toISOString(),
      ...proof,
    });
    proofs.terminalCommands = list;
    return;
  }
  if (bucket === 'schedulerCommands') {
    const list = proofs.schedulerCommands ?? [];
    list.push({
      at: new Date().toISOString(),
      ...proof,
    });
    proofs.schedulerCommands = list;
    return;
  }
  if (bucket === 'matrixClientRecoveryTrigger') {
    const list = proofs.matrixClientRecoveryTrigger ?? [];
    list.push({
      at: new Date().toISOString(),
      ...proof,
    });
    proofs.matrixClientRecoveryTrigger = list;
    return;
  }
  if (bucket === 'providerControls') {
    const list = proofs.providerControls ?? [];
    list.push({
      at: new Date().toISOString(),
      ...proof,
    });
    proofs.providerControls = list;
    return;
  }
  const scalarProofs = proofs as Record<string, Record<string, unknown> | undefined>;
  scalarProofs[bucket] = {
    ...(scalarProofs[bucket] ?? {}),
    at: new Date().toISOString(),
    ...proof,
  };
}

export async function bootstrapOysterunMatrixSession(): Promise<OysterunMatrixBootstrapResponse> {
  if (cachedBootstrap) return cachedBootstrap;
  const sessionRoute = requiredHostSessionRoute();
  cachedBootstrap = await hostJson<OysterunMatrixBootstrapResponse>(
    HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_PATH,
    {
      method: 'POST',
      body: JSON.stringify({
        route: 'oysterun_host_scoped_cinny_session_bootstrap',
        session_id: sessionRoute.sessionId,
        session_route_source: sessionRoute.source,
      }),
    }
  );
  if (cachedBootstrap.raw_synapse_token_exposed !== false) {
    throw new Error('Route C bootstrap violated raw Synapse token exposure contract.');
  }
  if (!cachedBootstrap.session.accessToken.startsWith('oysterun_facade_')) {
    throw new Error('Route C bootstrap returned a non-Host-scoped Matrix facade token.');
  }
  if (cachedBootstrap.session.baseUrl !== window.location.origin) {
    throw new Error('Route C bootstrap returned a non-Host-origin Matrix baseUrl.');
  }
  recordOysterunProof('matrixClientInit', {
    status: 'bootstrap_received_before_matrix_client_init',
    route: cachedBootstrap.route,
    session_route_source: cachedBootstrap.session_route_source ?? sessionRoute.source,
    initial_session_route_source: sessionRoute.initialSource,
    bootstrap_request_route_source: cachedBootstrap.session_route_source ?? sessionRoute.source,
    host_session_id: cachedBootstrap.binding.host_session_id,
    matrix_room_id: cachedBootstrap.binding.matrix_room_id,
    matrix_user_id: cachedBootstrap.binding.matrix_user_id,
    routec_matrix_actor_registry_version:
      cachedBootstrap.routec_matrix_actor_registry?.registry_version ??
      cachedBootstrap.binding.routec_matrix_actor_registry?.registry_version,
    routec_matrix_actor_count:
      cachedBootstrap.routec_matrix_actor_registry?.actors.length ??
      cachedBootstrap.binding.routec_matrix_actor_registry?.actors.length,
    routec_facade_sender_actor_key: cachedBootstrap.routec_facade_sender_actor_key,
    routec_facade_sender_restriction: cachedBootstrap.routec_facade_sender_restriction,
    semantic_role_is_sender:
      cachedBootstrap.routec_matrix_actor_registry?.semantic_role_is_sender ??
      cachedBootstrap.binding.routec_matrix_actor_registry?.semantic_role_is_sender,
    base_url: cachedBootstrap.session.baseUrl,
    base_url_is_host_origin: cachedBootstrap.session.baseUrl === window.location.origin,
    token_kind: 'host_scoped_matrix_facade_token',
    raw_synapse_token_exposed: false,
    browser_storage_raw_synapse_token: false,
    login_credential_typed: false,
    api_backdoor_session_created: false,
    matrix_intake_runtime_proof_claimed: false,
    foundation_readiness_claimed: false,
    pass_claimed: false,
    artifact_root: cachedBootstrap.artifact_root,
  });
  return cachedBootstrap;
}

export function clearOysterunMatrixBootstrapCache(reason = 'matrix_facade_token_recovery'): void {
  const hadCachedBootstrap = Boolean(cachedBootstrap);
  cachedBootstrap = undefined;
  recordOysterunProof('matrixClientRecovery', {
    status: 'bootstrap_cache_cleared',
    reason,
    source: ROUTEC_MATRIX_RECOVERY_PROOF_SOURCE,
    had_cached_bootstrap: hadCachedBootstrap,
    dashboard_auth_cleared: false,
    local_storage_cleared: false,
    raw_secret_material_exposed: false,
    foundation_pass_claimed: false,
  });
}

export async function recordOysterunRouteCClientAuthLossDiagnostic({
  session,
  trigger,
}: {
  session?: {
    baseUrl: string;
    userId: string;
    deviceId: string;
    accessToken: string;
  };
  trigger: string;
}): Promise<void> {
  const sessionTokenHash = await sha256HexForOysterunDiagnostic(session?.accessToken);
  let fallbackTokenHash: string | null = null;
  try {
    fallbackTokenHash = await sha256HexForOysterunDiagnostic(
      window.localStorage.getItem('cinny_access_token') ?? undefined
    );
  } catch {
    fallbackTokenHash = null;
  }
  await hostJson<{ status: string }>(ROUTEC_CLIENT_AUTH_LOSS_DIAGNOSTIC_PATH, {
    method: 'POST',
    keepalive: true,
    body: JSON.stringify({
      event: 'web_chat_matrix_session_logged_out',
      trigger,
      href: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      hash_present: Boolean(window.location.hash),
      visibility_state: document.visibilityState,
      capacitor_ios_runtime: isOysterunCapacitorIOSRuntime(),
      dashboard_token_present: Boolean(readOysterunDashboardTokenFromStorage()),
      host_session_id: cachedBootstrap?.binding.host_session_id ?? null,
      matrix_room_id: cachedBootstrap?.binding.matrix_room_id ?? null,
      matrix_user_id: session?.userId ?? cachedBootstrap?.binding.matrix_user_id ?? null,
      device_id: session?.deviceId ?? cachedBootstrap?.session.deviceId ?? null,
      session_facade_token_hash: sessionTokenHash,
      session_facade_token_hash_available: Boolean(sessionTokenHash),
      fallback_facade_token_hash: fallbackTokenHash,
      fallback_facade_token_hash_available: Boolean(fallbackTokenHash),
      cached_bootstrap_present: Boolean(cachedBootstrap),
      raw_secret_material_exposed: false,
    }),
  });
}

export function getOysterunBootstrappedRoomId(): string | undefined {
  return cachedBootstrap?.binding.matrix_room_id;
}

export function getOysterunBootstrappedHostSessionId(): string | undefined {
  return cachedBootstrap?.binding.host_session_id;
}

export function getOysterunBootstrappedHostSessionName(): string | undefined {
  const name = cachedBootstrap?.binding.host_session_name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

export function getOysterunMatrixRoomId(): string | undefined {
  return getOysterunBootstrappedRoomId();
}

export function getOysterunHostSessionId(): string | undefined {
  return getOysterunBootstrappedHostSessionId();
}

export function getOysterunRouteCComposerDraftHostSessionId(): string | undefined {
  return getOysterunHostSessionId() ?? readHostSessionRoute()?.sessionId;
}

export function getOysterunRouteCRoomEntryBindingProof(): OysterunRouteCRoomEntryBindingProof {
  const sessionRoute = readHostSessionRoute();
  if (cachedBootstrap) {
    return {
      contract: OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT,
      host_session_id: cachedBootstrap.binding.host_session_id,
      matrix_room_id: cachedBootstrap.binding.matrix_room_id,
      matrix_room_ready:
        cachedBootstrap.room.ready === true && cachedBootstrap.binding.matrix_room_ready === true,
      binding_source: 'host_scoped_bootstrap',
      direct_api_substitute_used: false,
      stale_text_selector_required: false,
      screenshot_identity_required: false,
    };
  }
  if (sessionRoute) {
    return {
      contract: OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT,
      host_session_id: sessionRoute.sessionId,
      matrix_room_ready: false,
      binding_source: 'host_session_route_without_bootstrap',
      direct_api_substitute_used: false,
      stale_text_selector_required: false,
      screenshot_identity_required: false,
    };
  }
  return {
    contract: OYSTERUN_ROUTEC_ROOM_ENTRY_CONTRACT,
    matrix_room_ready: false,
    binding_source: 'missing_host_session_route',
    direct_api_substitute_used: false,
    stale_text_selector_required: false,
    screenshot_identity_required: false,
  };
}

function requiredOysterunHostSessionId(): string {
  return getOysterunHostSessionId() ?? requiredHostSessionRoute().sessionId;
}

function isOysterunRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredStringField(
  record: Record<string, unknown>,
  field: string,
  context: string
): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Route C ${context} missing required string field: ${field}`);
  }
  return value.trim();
}

function optionalStringField(
  record: Record<string, unknown>,
  field: string,
  context: string
): string | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Route C ${context} field must be a string when present: ${field}`);
  }
  return value.trim() || null;
}

function optionalBooleanField(
  record: Record<string, unknown>,
  field: string,
  context: string
): boolean | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new Error(`Route C ${context} field must be a boolean when present: ${field}`);
  }
  return value;
}

function optionalFiniteNumberField(
  record: Record<string, unknown>,
  field: string,
  context: string
): number | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Route C ${context} field must be a finite number when present: ${field}`);
  }
  return value;
}

function readOysterunCancelSemanticHookContent(hook: Record<string, unknown>): {
  content: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const { content } = hook;
  if (!isOysterunRecord(content)) {
    throw new Error('Route C cancel semantic source hook missing Matrix content object.');
  }
  const payload = content[OYSTERUN_SEMANTIC_NAMESPACE];
  if (!isOysterunRecord(payload)) {
    throw new Error('Route C cancel semantic source hook missing Oysterun semantic payload.');
  }
  return { content, payload };
}

function buildOysterunCancelSemanticWriteBody(
  hook: Record<string, unknown>,
  proof: OysterunHost2IntakeProof
): Record<string, unknown> {
  const endpointPath = requiredStringField(hook, 'endpoint_path', 'cancel semantic source hook');
  if (endpointPath !== HOST_SEMANTIC_EVENTS_PATH) {
    throw new Error(`Route C cancel semantic source hook endpoint mismatch: ${endpointPath}`);
  }
  if (hook.matrix_backed_semantic_source_hook !== true) {
    throw new Error('Route C cancel semantic source hook is not marked Matrix-backed.');
  }
  if (hook.matrix_write_required_for_runtime_acceptance !== true) {
    throw new Error('Route C cancel semantic source hook is not marked Matrix-write-required.');
  }
  if (hook.direct_matrix_harness_write_used !== false) {
    throw new Error(
      'Route C cancel semantic source hook must not use direct Matrix harness writes.'
    );
  }

  const { content, payload } = readOysterunCancelSemanticHookContent(hook);
  const semanticType = requiredStringField(hook, 'semantic_type', 'cancel semantic source hook');
  if (!OYSTERUN_CANCEL_SEMANTIC_TYPES.has(semanticType)) {
    throw new Error(
      `Route C cancel semantic source hook has unsupported semantic_type: ${semanticType}`
    );
  }

  const payloadSemanticType = requiredStringField(
    payload,
    'semantic_type',
    'cancel semantic payload'
  );
  const canonicalSemanticType = canonicalOysterunControlSemanticType(semanticType);
  if (canonicalOysterunControlSemanticType(payloadSemanticType) !== canonicalSemanticType) {
    throw new Error(
      `Route C cancel semantic hook type mismatch: hook=${semanticType} payload=${payloadSemanticType}`
    );
  }

  const targetUserEventId = requiredStringField(
    hook,
    'target_event_id',
    'cancel semantic source hook'
  );
  if (hook.target_event_id_kind !== 'server') {
    throw new Error('Route C cancel semantic source hook target_event_id_kind must be server.');
  }
  const proofTargetEventId =
    proof.host2_receipt_target_event_id ??
    proof.matrix_server_event_id ??
    proof.source_user_event_id;
  if (proofTargetEventId && targetUserEventId !== proofTargetEventId) {
    throw new Error(
      `Route C cancel semantic hook target mismatch: hook=${targetUserEventId} proof=${proofTargetEventId}`
    );
  }

  const payloadTargetUserEventId = requiredStringField(
    payload,
    'target_user_event_id',
    'cancel semantic payload'
  );
  const payloadTargetEventId = requiredStringField(
    payload,
    'target_event_id',
    'cancel semantic payload'
  );
  if (
    payloadTargetUserEventId !== targetUserEventId ||
    payloadTargetEventId !== targetUserEventId
  ) {
    throw new Error('Route C cancel semantic payload target does not match source hook target.');
  }
  if (payload.target_event_id_kind !== 'server') {
    throw new Error('Route C cancel semantic payload target_event_id_kind must be server.');
  }

  const hostSessionId = requiredStringField(payload, 'host_session_id', 'cancel semantic payload');
  if (hostSessionId !== proof.host_session_id) {
    throw new Error('Route C cancel semantic payload host_session_id does not match Host2 proof.');
  }
  const matrixRoomId = requiredStringField(payload, 'matrix_room_id', 'cancel semantic payload');
  if (matrixRoomId !== proof.matrix_room_id) {
    throw new Error('Route C cancel semantic payload matrix_room_id does not match Host2 proof.');
  }

  const controlRequestId = requiredStringField(
    hook,
    'control_request_id',
    'cancel semantic source hook'
  );
  const payloadControlRequestId = requiredStringField(
    payload,
    'control_request_id',
    'cancel semantic payload'
  );
  if (payloadControlRequestId !== controlRequestId) {
    throw new Error(
      'Route C cancel semantic payload control_request_id does not match source hook.'
    );
  }

  const semanticId = requiredStringField(payload, 'semantic_id', 'cancel semantic payload');
  const sourceUserEventId = requiredStringField(
    payload,
    'source_user_event_id',
    'cancel semantic payload'
  );

  return {
    session_id: hostSessionId,
    semantic_type: canonicalSemanticType,
    category: canonicalOysterunControlSemanticType(
      optionalStringField(payload, 'semantic_category', 'cancel semantic payload') ?? semanticType
    ),
    body: requiredStringField(content, 'body', 'cancel semantic Matrix content'),
    semantic_id: semanticId,
    txn_id: semanticId,
    lifecycle: requiredStringField(payload, 'lifecycle', 'cancel semantic payload'),
    host_outbox_id: optionalStringField(payload, 'host_outbox_id', 'cancel semantic payload'),
    client_request_id: requiredStringField(payload, 'client_request_id', 'cancel semantic payload'),
    source_user_event_id: sourceUserEventId,
    target_user_event_id: payloadTargetUserEventId,
    provider_id: optionalStringField(payload, 'provider_id', 'cancel semantic payload'),
    provider_turn_id: optionalStringField(payload, 'provider_turn_id', 'cancel semantic payload'),
    provider_turn_id_kind: optionalStringField(
      payload,
      'provider_turn_id_kind',
      'cancel semantic payload'
    ),
    semantic_contract: requiredStringField(payload, 'semantic_contract', 'cancel semantic payload'),
    cancel_outcome: optionalStringField(payload, 'cancel_outcome', 'cancel semantic payload'),
    control_request_id: controlRequestId,
    control_kind: 'cancel',
    control_family: 'session_control',
    control_origin: 'user',
    actor: 'oysterun-ui',
    allowed_actions: ['cancel'],
    target_id: payloadTargetUserEventId,
    target_session_id: hostSessionId,
    durable: true,
    replay_policy: canonicalSemanticType === 'control.request' ? 'latest_state_only' : 'always',
    control_outcome: canonicalOysterunControlOutcome(
      optionalStringField(payload, 'control_outcome', 'cancel semantic payload')
    ),
    outcome: canonicalOysterunControlOutcome(
      optionalStringField(payload, 'outcome', 'cancel semantic payload')
    ),
    agent_turn_started: optionalBooleanField(
      payload,
      'agent_turn_started',
      'cancel semantic payload'
    ),
    host2_intake_state: optionalStringField(
      payload,
      'host2_intake_state',
      'cancel semantic payload'
    ),
    provider_receives_canceled_user_event: optionalBooleanField(
      payload,
      'provider_receives_canceled_user_event',
      'cancel semantic payload'
    ),
    provider_started_for_target_event: optionalBooleanField(
      payload,
      'provider_started_for_target_event',
      'cancel semantic payload'
    ),
    same_event_both_canceled_and_started: optionalBooleanField(
      payload,
      'same_event_both_canceled_and_started',
      'cancel semantic payload'
    ),
    duplicate_user_row_count: optionalFiniteNumberField(
      payload,
      'duplicate_user_row_count',
      'cancel semantic payload'
    ),
    outbox_delivery_state: optionalStringField(
      payload,
      'outbox_delivery_state',
      'cancel semantic payload'
    ),
    ambiguous_state: optionalStringField(payload, 'ambiguous_state', 'cancel semantic payload'),
    direct_matrix_harness_write_used: false,
  };
}

async function commitOysterunCancelSemanticSourceHook(
  hook: Record<string, unknown>,
  proof: OysterunHost2IntakeProof
): Promise<OysterunCancelSemanticCommitProof> {
  const body = buildOysterunCancelSemanticWriteBody(hook, proof);
  const response = await hostJson<OysterunCancelSemanticCommitResponse>(HOST_SEMANTIC_EVENTS_PATH, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (response.status !== 'semantic_matrix_event_committed') {
    throw new Error(`Route C cancel semantic write did not commit: ${response.status}`);
  }
  const eventId = response.event_id;
  if (typeof eventId !== 'string' || !eventId.trim()) {
    throw new Error('Route C cancel semantic write response missing Matrix event_id.');
  }
  if (response.semantic_type !== body.semantic_type) {
    throw new Error('Route C cancel semantic write response semantic_type mismatch.');
  }
  if (response.event_type !== 'm.room.message') {
    throw new Error('Route C cancel semantic write response event_type mismatch.');
  }
  return {
    semantic_type: response.semantic_type,
    txn_id: response.txn_id,
    event_id: eventId,
    matrix_room_id: response.matrix_room_id,
    target_user_event_id: requiredStringField(
      body,
      'target_user_event_id',
      'cancel semantic write body'
    ),
    control_request_id: requiredStringField(
      body,
      'control_request_id',
      'cancel semantic write body'
    ),
    committed_by: response.committed_by,
  };
}

export async function commitOysterunCancelSemanticSourceHooks(
  proof: OysterunHost2IntakeProof
): Promise<OysterunCancelSemanticCommitProof[]> {
  const requestHook = proof.cancel_request_semantic_event_source_hook;
  if (!isOysterunRecord(requestHook)) {
    throw new Error('Route C cancel response missing request semantic source hook.');
  }
  const outcomeHook = proof.cancel_outcome_semantic_event_source_hook;
  if (!isOysterunRecord(outcomeHook)) {
    throw new Error('Route C cancel response missing outcome semantic source hook.');
  }
  return [
    await commitOysterunCancelSemanticSourceHook(requestHook, proof),
    await commitOysterunCancelSemanticSourceHook(outcomeHook, proof),
  ];
}

export async function getOysterunHost2IntakeProof({
  roomId,
  eventId,
}: {
  roomId: string;
  eventId: string;
}): Promise<OysterunHost2IntakeResponse> {
  const sessionId = requiredOysterunHostSessionId();
  const params = new URLSearchParams({
    session_id: sessionId,
    room_id: roomId,
    event_id: eventId,
  });
  return hostJson<OysterunHost2IntakeResponse>(`${HOST2_INTAKE_PROOF_PATH}?${params}`, {
    method: 'GET',
  });
}

export async function getOysterunHostSessionSnapshot({
  sessionId,
}: {
  sessionId?: string;
} = {}): Promise<OysterunHostSessionSnapshotResponse> {
  const params = new URLSearchParams({
    session_id: sessionId ?? requiredOysterunHostSessionId(),
  });
  return hostJson<OysterunHostSessionSnapshotResponse>(`${HOST_SESSION_SNAPSHOT_PATH}?${params}`, {
    method: 'GET',
    headers: {
      'X-Oysterun-RouteC': 'canonical-provider-lifecycle',
    },
  });
}

export type OysterunSessionInterruptResponse = {
  status: 'interrupted';
  session_id: string;
  agent_id: string;
  shell_exec_ids?: string[];
  interrupt_result?: {
    schema_version: 'routec.session_interrupt_result.v1';
    status: string;
    accepted: boolean;
    idempotent: boolean;
    provider: string;
    provider_interrupt_attempted: boolean;
    provider_interrupt_method: string | null;
    reason?: string | null;
    raw_provider_response_exposed: false;
    raw_secret_material_exposed?: false;
  };
  interrupt_outcome?: string;
  provider_interrupt_attempted?: boolean;
  interrupt_idempotent?: boolean;
  routec_p186_interrupt_diagnostic_proof?: {
    schema_version: 'routec.p186.interrupt_diagnostic_proof.v1';
    enabled_by_request: true;
    raw_provider_response_exposed: false;
    raw_secret_material_exposed: false;
    token_redacted: true;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type OysterunTerminalCommandResponse = {
  status: 'started';
  session_id: string;
  agent_id: string;
  exec_id: string;
  terminal_exec_id: string;
  command: string;
  cwd: string;
  route: string;
  terminal_command_started_semantic_type: 'terminal.command.started';
  terminal_command_started_matrix_event_id: string;
  terminal_command_started_semantic_matrix_event_committed: true;
  terminal_command_result_matrix_event_required: true;
  expected_matrix_backed_semantic_truth: 'terminal.command.started/terminal.command.result';
  normal_message_user_sent: false;
  browser_shell_execution: false;
  provider_delivery_attempted: false;
  transcript_db_fallback_used: false;
  host_db_transcript_product_truth: false;
  [key: string]: unknown;
};

export type OysterunLoopCliResponse = {
  status: 'scheduler_loop_created' | 'scheduler_loop_enabled_existing';
  session_id: string;
  agent_id: string;
  dispatch_queued: false;
  duplicate_prevented: boolean;
  schedule: {
    id: string;
    status: string;
    schedule_kind?: string;
    interval_ms?: number | null;
    normalized_command_hash?: string;
    input_text_redacted?: true;
    storage_owner?: 'agent_folder_oysterun_loops_json' | string;
    runtime_state_owner?: 'host_session_memory_only' | string;
    host_owned_scheduler_db?: false;
    [key: string]: unknown;
  };
  parsed: {
    command: 'loop';
    interval_token: string;
    interval_ms: number;
    prompt_sha256: string;
    prompt_length: number;
    input_text_redacted?: true;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export const OYSTERUN_LEGACY_STOPLOOP_DEMOTED_MESSAGE =
  'Legacy /stoploop is no longer a Loop command. Open Loop to enable, disable, or delete rows.';

export function isOysterunRouteCLoopCliCommand(command: string): boolean {
  return /^\/loop(?:\s|$)/i.test(command.trim());
}

export function isOysterunRouteCLegacyStopLoopCommand(command: string): boolean {
  return /^\/stoploop(?:\s|$)/i.test(command.trim());
}

export async function interruptOysterunHostSession({
  matrixRoomId,
  command,
}: {
  matrixRoomId: string;
  command: string;
}): Promise<OysterunSessionInterruptResponse> {
  const sessionId = requiredOysterunHostSessionId();
  recordOysterunProof('interruptControls', {
    state: 'before_host_session_interrupt_request',
    command,
    host_session_id: sessionId,
    matrix_room_id: matrixRoomId,
    endpoint_path: HOST_SESSION_INTERRUPT_PATH,
    normal_matrix_message_send_blocked: true,
    direct_matrix_browser_write_used: false,
    local_transcript_replay_shortcut_used: false,
  });
  try {
    const response = await hostJson<OysterunSessionInterruptResponse>(HOST_SESSION_INTERRUPT_PATH, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        command,
        matrix_room_id: matrixRoomId,
        route: 'routec_bang_bang_composer_interrupt',
      }),
    });
    if (response.status !== 'interrupted') {
      throw new Error(`Route C interrupt returned unexpected status: ${response.status}`);
    }
    if (response.session_id !== sessionId) {
      throw new Error('Route C interrupt returned mismatched session_id.');
    }
    recordOysterunProof('interruptControls', {
      state: 'after_host_session_interrupt_request',
      command,
      host_session_id: response.session_id,
      matrix_room_id: matrixRoomId,
      endpoint_path: HOST_SESSION_INTERRUPT_PATH,
      agent_id: response.agent_id,
      shell_exec_ids: response.shell_exec_ids ?? null,
      interrupt_outcome: response.interrupt_outcome ?? response.interrupt_result?.status ?? null,
      interrupt_idempotent: response.interrupt_idempotent === true,
      provider_interrupt_attempted: response.provider_interrupt_attempted === true,
      interrupt_result_schema_version: response.interrupt_result?.schema_version ?? null,
      raw_provider_response_exposed:
        response.interrupt_result?.raw_provider_response_exposed ?? false,
      diagnostic_proof_gated: response.routec_p186_interrupt_diagnostic_proof
        ? response.routec_p186_interrupt_diagnostic_proof.enabled_by_request === true
        : false,
      expected_matrix_backed_semantic_truth: 'control.request/control.outcome',
      normal_matrix_message_send_blocked: true,
      direct_matrix_browser_write_used: false,
      local_transcript_replay_shortcut_used: false,
    });
    return response;
  } catch (err) {
    recordOysterunProof('interruptControls', {
      state: 'host_session_interrupt_request_failed',
      command,
      host_session_id: sessionId,
      matrix_room_id: matrixRoomId,
      endpoint_path: HOST_SESSION_INTERRUPT_PATH,
      error: err instanceof Error ? err.message : String(err),
      normal_matrix_message_send_blocked: true,
      direct_matrix_browser_write_used: false,
      local_transcript_replay_shortcut_used: false,
    });
    throw err;
  }
}

export async function runOysterunHostTerminalCommand({
  matrixRoomId,
  command,
}: {
  matrixRoomId: string;
  command: string;
}): Promise<OysterunTerminalCommandResponse> {
  const sessionId = requiredOysterunHostSessionId();
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new Error('Route C terminal command requires non-empty command text.');
  }
  recordOysterunProof('terminalCommands', {
    state: 'before_host_session_terminal_command_request',
    command: normalizedCommand,
    host_session_id: sessionId,
    matrix_room_id: matrixRoomId,
    endpoint_path: HOST_SESSION_TERMINAL_COMMAND_PATH,
    route: 'routec_single_bang_terminal_command',
    normal_matrix_message_send_blocked: true,
    direct_matrix_browser_write_used: false,
    browser_shell_execution: false,
  });
  try {
    const response = await hostJson<OysterunTerminalCommandResponse>(
      HOST_SESSION_TERMINAL_COMMAND_PATH,
      {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          command: normalizedCommand,
          matrix_room_id: matrixRoomId,
          route: 'routec_single_bang_terminal_command',
        }),
      }
    );
    if (response.status !== 'started') {
      throw new Error(`Route C terminal command returned unexpected status: ${response.status}`);
    }
    if (response.session_id !== sessionId) {
      throw new Error('Route C terminal command returned mismatched session_id.');
    }
    if (response.command !== normalizedCommand) {
      throw new Error('Route C terminal command returned mismatched command.');
    }
    if (response.terminal_exec_id !== response.exec_id) {
      throw new Error('Route C terminal command returned mismatched terminal_exec_id.');
    }
    if (
      response.terminal_command_started_semantic_type !== 'terminal.command.started' ||
      response.terminal_command_started_semantic_matrix_event_committed !== true ||
      typeof response.terminal_command_started_matrix_event_id !== 'string' ||
      response.terminal_command_started_matrix_event_id.length === 0
    ) {
      throw new Error(
        'Route C terminal command did not prove Matrix terminal.command.started durability.'
      );
    }
    if (response.terminal_command_result_matrix_event_required !== true) {
      throw new Error(
        'Route C terminal command did not require terminal.command.result durability.'
      );
    }
    if (
      response.expected_matrix_backed_semantic_truth !==
      'terminal.command.started/terminal.command.result'
    ) {
      throw new Error('Route C terminal command returned unexpected semantic truth contract.');
    }
    if (response.normal_message_user_sent !== false) {
      throw new Error('Route C terminal command response did not block normal message.user send.');
    }
    if (response.browser_shell_execution !== false) {
      throw new Error('Route C terminal command response violated Host-owned shell execution.');
    }
    if (response.provider_delivery_attempted !== false) {
      throw new Error('Route C terminal command response attempted provider delivery.');
    }
    if (response.transcript_db_fallback_used !== false) {
      throw new Error('Route C terminal command response used transcript DB fallback.');
    }
    if (response.host_db_transcript_product_truth !== false) {
      throw new Error(
        'Route C terminal command response treated Host DB transcript as product truth.'
      );
    }
    recordOysterunProof('terminalCommands', {
      state: 'after_host_session_terminal_command_request',
      command: response.command,
      host_session_id: response.session_id,
      matrix_room_id: matrixRoomId,
      endpoint_path: HOST_SESSION_TERMINAL_COMMAND_PATH,
      route: response.route,
      agent_id: response.agent_id,
      exec_id: response.exec_id,
      terminal_exec_id: response.terminal_exec_id,
      cwd: response.cwd,
      terminal_command_started_semantic_type: response.terminal_command_started_semantic_type,
      terminal_command_started_matrix_event_id: response.terminal_command_started_matrix_event_id,
      terminal_command_started_semantic_matrix_event_committed:
        response.terminal_command_started_semantic_matrix_event_committed,
      terminal_command_result_matrix_event_required:
        response.terminal_command_result_matrix_event_required,
      expected_matrix_backed_semantic_truth: response.expected_matrix_backed_semantic_truth,
      normal_matrix_message_send_blocked: true,
      direct_matrix_browser_write_used: false,
      browser_shell_execution: false,
      provider_delivery_attempted: false,
      transcript_db_fallback_used: false,
      host_db_transcript_product_truth: false,
    });
    return response;
  } catch (err) {
    recordOysterunProof('terminalCommands', {
      state: 'host_session_terminal_command_request_failed',
      command: normalizedCommand,
      host_session_id: sessionId,
      matrix_room_id: matrixRoomId,
      endpoint_path: HOST_SESSION_TERMINAL_COMMAND_PATH,
      route: 'routec_single_bang_terminal_command',
      error: err instanceof Error ? err.message : String(err),
      normal_matrix_message_send_blocked: true,
      direct_matrix_browser_write_used: false,
      browser_shell_execution: false,
    });
    throw err;
  }
}

export async function createOysterunHostLoopSchedule({
  matrixRoomId,
  command,
  clientRequestId,
}: {
  matrixRoomId: string;
  command: string;
  clientRequestId?: string;
}): Promise<OysterunLoopCliResponse> {
  const sessionId = requiredOysterunHostSessionId();
  const normalizedCommand = command.trim();
  const normalizedClientRequestId =
    typeof clientRequestId === 'string' && clientRequestId.trim()
      ? clientRequestId.trim()
      : undefined;
  if (!isOysterunRouteCLoopCliCommand(normalizedCommand)) {
    throw new Error('Route C loop scheduler command must start with /loop.');
  }
  recordOysterunProof('schedulerCommands', {
    state: 'before_host_loop_scheduler_request',
    command: '/loop',
    host_session_id: sessionId,
    matrix_room_id: matrixRoomId,
    endpoint_path: HOST_SESSION_SEND_PATH,
    route: 'routec_composer_loop_cli',
    client_request_id: normalizedClientRequestId ?? null,
    normal_matrix_message_send_blocked: true,
    direct_matrix_browser_write_used: false,
    browser_scheduler_timer_used: false,
    host_owned_scheduler_db: false,
    storage_owner: 'agent_folder_oysterun_loops_json',
    runtime_state_owner: 'host_session_memory_only',
  });
  try {
    const response = await hostJson<OysterunLoopCliResponse>(HOST_SESSION_SEND_PATH, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        text: normalizedCommand,
        nickname: 'Host Owner',
        route: 'routec_composer_loop_cli',
        client_message_id: normalizedClientRequestId,
      }),
    });
    if (
      response.status !== 'scheduler_loop_created' &&
      response.status !== 'scheduler_loop_enabled_existing'
    ) {
      throw new Error(`Route C loop scheduler returned unexpected status: ${response.status}`);
    }
    if (response.session_id !== sessionId) {
      throw new Error('Route C loop scheduler returned mismatched session_id.');
    }
    if (response.dispatch_queued !== false) {
      throw new Error('Route C loop scheduler response allowed provider dispatch.');
    }
    recordOysterunProof('schedulerCommands', {
      state: 'after_host_loop_scheduler_request',
      command: '/loop',
      host_session_id: response.session_id,
      matrix_room_id: matrixRoomId,
      endpoint_path: HOST_SESSION_SEND_PATH,
      route: 'routec_composer_loop_cli',
      client_request_id: normalizedClientRequestId ?? null,
      status: response.status,
      agent_id: response.agent_id,
      schedule_id: response.schedule.id,
      duplicate_prevented: response.duplicate_prevented,
      interval_token: response.parsed.interval_token,
      interval_ms: response.parsed.interval_ms,
      prompt_sha256: response.parsed.prompt_sha256,
      prompt_length: response.parsed.prompt_length,
      normal_matrix_message_send_blocked: true,
      direct_matrix_browser_write_used: false,
      browser_scheduler_timer_used: false,
      host_owned_scheduler_db: false,
      storage_owner: response.schedule.storage_owner ?? 'agent_folder_oysterun_loops_json',
      runtime_state_owner: response.schedule.runtime_state_owner ?? 'host_session_memory_only',
    });
    return response;
  } catch (err) {
    recordOysterunProof('schedulerCommands', {
      state: 'host_loop_scheduler_request_failed',
      command: '/loop',
      host_session_id: sessionId,
      matrix_room_id: matrixRoomId,
      endpoint_path: HOST_SESSION_SEND_PATH,
      route: 'routec_composer_loop_cli',
      client_request_id: normalizedClientRequestId ?? null,
      error: err instanceof Error ? err.message : String(err),
      normal_matrix_message_send_blocked: true,
      direct_matrix_browser_write_used: false,
      browser_scheduler_timer_used: false,
      host_owned_scheduler_db: false,
      storage_owner: 'agent_folder_oysterun_loops_json',
      runtime_state_owner: 'host_session_memory_only',
    });
    throw err;
  }
}

export async function cancelOysterunHost2Intake({
  roomId,
  eventId,
}: {
  roomId: string;
  eventId: string;
}): Promise<OysterunHost2IntakeResponse> {
  const sessionId = requiredOysterunHostSessionId();
  return hostJson<OysterunHost2IntakeResponse>(HOST2_INTAKE_CANCEL_PATH, {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      matrix_room_id: roomId,
      event_id: eventId,
    }),
  });
}

export type OysterunProviderControlAction = 'accept' | 'reject';

export type OysterunHostSessionStopResponse = {
  status: 'stopped' | 'killed';
  session_id: string;
  agent_id: string;
};

export async function stopOysterunHostSession(): Promise<OysterunHostSessionStopResponse> {
  const sessionId = requiredOysterunHostSessionId();
  const response = await hostJson<OysterunHostSessionStopResponse>('/session/stop', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
    }),
  });
  if (response.session_id !== sessionId) {
    throw new Error('Route C stop session returned mismatched session_id.');
  }
  if (response.status !== 'stopped' && response.status !== 'killed') {
    throw new Error(`Route C stop session returned unexpected status: ${response.status}`);
  }
  return response;
}

export type OysterunHostSessionRestartResponse = {
  session_id: string;
  session_name?: string | null;
  agent_id: string;
  provider?: string | null;
  model?: string | null;
  provider_resume_id?: string | null;
  provider_thread_id?: string | null;
  alive?: boolean;
  ready?: boolean;
  resumed?: boolean;
};

export async function restartOysterunHostSession(): Promise<OysterunHostSessionRestartResponse> {
  const sessionId = requiredOysterunHostSessionId();
  const response = await hostJson<OysterunHostSessionRestartResponse>(HOST_SESSION_RESTART_PATH, {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
    }),
  });
  if (typeof response.session_id !== 'string' || !response.session_id.trim()) {
    throw new Error('Route C restart session returned missing session_id.');
  }
  if (response.resumed !== undefined && response.resumed !== true) {
    throw new Error('Route C restart session did not return resumed=true.');
  }
  return {
    ...response,
    session_id: response.session_id.trim(),
  };
}

export type OysterunProviderControlResponse = {
  status: 'routec_provider_control_response_accepted';
  route: 'routec_provider_control_response';
  session_id: string;
  agent_id: string;
  provider: string;
  request_id: string;
  subtype: string | null;
  control_kind: string | null;
  control_family: string | null;
  control_origin: string | null;
  allowed_actions: string[];
  control_outcome: 'accepted' | 'rejected';
  control_response_forwarded: boolean;
  provider_control_outcome_event_emitted: boolean;
  approval_resolution_persisted: boolean;
  matrix_backed_outcome_truth: 'control.outcome';
  browser_local_state_final_truth: false;
  direct_matrix_browser_write_used: false;
  local_transcript_replay_shortcut_used: false;
  foundation_pass_claimed: false;
};

export async function respondOysterunProviderControl({
  requestId,
  action,
  matrixRoomId,
  semanticId,
  controlKind,
  controlFamily,
  controlOrigin,
}: {
  requestId: string;
  action: OysterunProviderControlAction;
  matrixRoomId?: string | null;
  semanticId?: string | null;
  controlKind?: string | null;
  controlFamily?: string | null;
  controlOrigin?: string | null;
}): Promise<OysterunProviderControlResponse> {
  const sessionId = requiredOysterunHostSessionId();
  const response = await hostJson<OysterunProviderControlResponse>(
    HOST_PROVIDER_CONTROL_RESPONSE_PATH,
    {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        request_id: requestId,
        allow: action === 'accept',
        action,
        matrix_room_id: matrixRoomId ?? null,
        semantic_id: semanticId ?? null,
        control_kind: controlKind ?? null,
        control_family: controlFamily ?? null,
        control_origin: controlOrigin ?? null,
      }),
    }
  );
  if (response.status !== 'routec_provider_control_response_accepted') {
    throw new Error(`Route C provider control response was not accepted: ${response.status}`);
  }
  if (response.session_id !== sessionId) {
    throw new Error('Route C provider control response returned mismatched session_id.');
  }
  if (response.request_id !== requestId) {
    throw new Error('Route C provider control response returned mismatched request_id.');
  }
  if (response.control_response_forwarded !== true) {
    throw new Error('Route C provider control response was not forwarded to Host provider.');
  }
  if (response.provider_control_outcome_event_emitted !== true) {
    throw new Error('Route C provider control response did not emit a provider control outcome.');
  }
  if (response.browser_local_state_final_truth !== false) {
    throw new Error(
      'Route C provider control response violated browser-local final truth contract.'
    );
  }
  if (response.direct_matrix_browser_write_used !== false) {
    throw new Error('Route C provider control response used direct browser Matrix write.');
  }
  return response;
}

export function recordOysterunProviderControlProof(
  proof: Record<string, unknown>,
  stage:
    | 'visible_before_click'
    | 'click_requested'
    | 'host_response_accepted'
    | 'click_failed'
    | 'matrix_outcome_visible'
) {
  recordOysterunProof('providerControls', {
    stage,
    control_surface: 'routec_semantic_control_request',
    control_surface_owner: 'oysterun-app',
    host_control_api_path: HOST_PROVIDER_CONTROL_RESPONSE_PATH,
    matrix_backed_request_truth: true,
    matrix_backed_outcome_truth: 'control.outcome',
    browser_local_state_final_truth: false,
    direct_matrix_browser_write_used: false,
    local_transcript_replay_shortcut_used: false,
    raw_markdown_html_button_truth_used: false,
    matrix_reaction_truth_used: false,
    generic_cinny_message_action_menu_primary_surface: false,
    foundation_pass_claimed: false,
    ...proof,
  });
}

export function recordOysterunCancelControlProof(
  proof: Record<string, unknown>,
  stage: 'visible_before_click' | 'click_requested' | 'click_resolved' | 'click_failed'
) {
  recordOysterunProof('cancelControls', {
    stage,
    event_id_kind: 'server',
    target_user_event_id_hash_kind: OYSTERUN_RAW_EVENT_ID_HASH_KIND,
    phase1_pass_claimed: false,
    closeout_readiness_claimed: false,
    ...proof,
  });
}
