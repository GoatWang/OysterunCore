import { createHash, randomUUID } from "crypto";
import { realpathSync, statSync } from "fs";
import {
  ensureRouteCSpike0ArtifactPlaceholders,
  appendRouteCJsonlArtifact,
  appendRouteCRuntimeProofJsonlArtifact,
  safelyRunOptionalRouteCArtifact,
  writeRouteCJsonArtifact,
  writeRouteCRuntimeProofJsonArtifact,
  writeRouteCRuntimeProofTextArtifact,
} from "./routec-artifacts.mjs";
import {
  appendHostRuntimeDiagnostic,
  serializeRuntimeError,
} from "./host-runtime-diagnostics.mjs";
import {
  createRouteCMatrixRoomBinding,
  getRouteCMatrixActorByKey,
  getRouteCMatrixBindingStorePath,
  getRouteCMatrixActorByUserId,
  getRouteCMatrixActorRegistry,
  requireRouteCMatrixRoomBinding,
  resolveRouteCMatrixActorForSemantic,
} from "./matrix-room-binding.mjs";
import {
  authenticateRouteCMatrixFacadeRequest,
  hashRouteCFacadeToken,
  issueRouteCMatrixFacadeCredential,
  listRouteCFacadeTokenProofs,
} from "./matrix-credential-issuer.mjs";
import {
  registerRouteCOutboxCorrelation,
  recordRouteCSendResponse,
  recordRouteCRemoteEcho,
  recordRouteCRemoteEchoFromSync,
  buildRouteCHost2IntakeProof,
  recordRouteCProviderAssistantSemanticResponse,
  writeRouteCContentEquivalenceProof,
  writeRouteCRoomRowCountTrace,
  hashMatrixContent,
  hashRouteCEventId,
  ROUTEC_EVENT_ID_CONTENT_HASH_KIND,
  ROUTEC_RAW_EVENT_ID_HASH_KIND,
} from "./matrix-event-correlator.mjs";
import {
  buildOysterunSemanticMatrixContent,
  OYSTERUN_SEMANTIC_NAMESPACE,
  OYSTERUN_SEMANTIC_CATEGORIES,
  OYSTERUN_CONTROL_KINDS,
  OYSTERUN_CONTROL_OUTCOMES,
} from "./matrix-event-writer.mjs";
import { writeRouteCRuntimeEnvPreflightProof } from "./routec-runtime-env-preflight.mjs";
import {
  deferRouteCMatrixStorageBatchSideEffect,
  ensureRouteCMatrixRoomStorage,
  handleRouteCMatrixStorageRequest,
  runRouteCMatrixStorageWriteBatch,
} from "./routec-matrix-storage-adapter.mjs";
import {
  RouteCMatrixMediaClientError,
  buildRouteCMatrixMediaConfigBody,
  createRouteCMatrixMediaUpload,
  readRouteCMatrixMediaDownload,
  resolveRouteCMatrixMediaContentUri,
} from "./routec-matrix-media-store.mjs";
import {
  readRouteCMatrixReadAuthorityMessages,
  recordRouteCMatrixReadAuthorityEvent,
  ROUTEC_MATRIX_DURABLE_SOURCE,
  ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT,
  ROUTEC_MATRIX_READ_AUTHORITY_INTERFACE,
  ROUTEC_MATRIX_READ_AUTHORITY_SOURCE,
} from "./matrix-read-authority.mjs";
import {
  attachRouteCMatrixContentAssetLinkAnnotations,
  attachRouteCProviderSemanticMarkdownLinkAnnotationsForContent,
} from "./routec-link-annotation-policy.mjs";
import { getSessionHistory } from "./session-history.mjs";
import { readConfig } from "./config.mjs";
import { projectToolEventForClientTransfer } from "./tool-event-transfer-projection.mjs";
import {
  COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER,
  COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE,
  isSuccessfulProviderCompletionStatus,
  normalizeProviderCompletionStatus,
  providerCompletionStateForStatus,
} from "./provider-completion-notification-contract.mjs";

const SUPPORTED_MATRIX_ENDPOINTS = Object.freeze([
  "GET /_matrix/client/versions",
  "GET /_matrix/client/v3/capabilities",
  "GET /_matrix/media/v3/config",
  "POST /_matrix/media/v3/upload",
  "GET /_matrix/media/v3/download/:serverName/:mediaId",
  "GET /_matrix/media/v3/thumbnail/:serverName/:mediaId",
  "GET /_matrix/client/v3/room_keys/version",
  "GET /_matrix/client/v3/voip/turnServer",
  "GET /_matrix/client/v3/pushrules/",
  "GET /_matrix/client/v3/profile/:userId",
  "POST /_matrix/client/v3/user/:userId/filter",
  "GET /_matrix/client/v3/user/:userId/filter/:filterId",
  "GET /_matrix/client/v3/sync",
  "POST /_matrix/client/v3/search",
  "GET /_matrix/client/v3/rooms/:roomId/members",
  "GET /_matrix/client/v3/rooms/:roomId/messages",
  "GET /_matrix/client/v3/rooms/:roomId/context/:eventId",
  "GET /_matrix/client/v3/rooms/:roomId/event/:eventId",
  "GET /_matrix/client/v3/rooms/:roomId/state/m.room.pinned_events/",
  "PUT /_matrix/client/v3/rooms/:roomId/state/m.room.pinned_events/",
  "PUT /_matrix/client/v3/rooms/:roomId/send/m.room.message/:txnId",
  "PUT /_matrix/client/v3/rooms/:roomId/typing/:userId",
  "POST /_matrix/client/v3/rooms/:roomId/receipt/m.read/:eventId",
  "POST /_matrix/client/v3/rooms/:roomId/read_markers",
]);

const OYSTERUN_BOUND_ROOM_FILTER_ID = "oysterun_bound_room_lazyload_filter";
const OYSTERUN_BOUND_ROOM_FILTER_ID_SOURCE =
  "oysterun_deterministic_bound_room_filter";
const OYSTERUN_PUBLIC_VERSIONS_DISCOVERY_MARKER =
  "routec_public_versions_discovery_no_token_no_synapse_proxy_no_pass";
const OYSTERUN_PUBLIC_LOGIN_FLOWS_PATH = "/_matrix/client/v3/login";
const OYSTERUN_PUBLIC_REGISTER_PATH = "/_matrix/client/v3/register";
const OYSTERUN_PUBLIC_LOGIN_FLOWS_MARKER =
  "oysterun_public_login_flows_password_only_no_token_no_synapse_proxy_no_pass";
const OYSTERUN_PUBLIC_REGISTER_DISABLED_MARKER =
  "oysterun_public_register_disabled_no_account_no_token_no_synapse_proxy_no_pass";
const OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_MARKER =
  "oysterun_host_scoped_cinny_session_bootstrap_existing_host_session_oysterun_facade_no_credentials_no_pass";
const OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_ROUTE =
  "oysterun_host_scoped_cinny_session_bootstrap";
const OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_PATH =
  "/routec/matrix/host-scoped-cinny-session-bootstrap";
const OYSTERUN_CLIENT_AUTH_LOSS_DIAGNOSTIC_PATH =
  "/routec/matrix/client-auth-loss-diagnostic";
const OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_MARKER =
  "oysterun-clean-session-setup-transcript-preview-matrix-room-timeline";
const OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_SOURCE =
  "host_matrix_facade_host_owned_json_timeline_read";
const OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_LIMIT = 20;
const OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_MAX_LIMIT = 50;
const OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_BODY_LIMIT = 500;
const ROUTEC_TOOL_CALL_BODY_SUMMARY_LIMIT =
  OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_BODY_LIMIT;
const ROUTEC_TOOL_CALL_BODY_VALUE_LIMIT = 240;
const ROUTEC_TOOL_CALL_BODY_ARRAY_LIMIT = 12;
const ROUTEC_TOOL_CALL_BODY_OBJECT_KEY_LIMIT = 24;
const ROUTEC_TOOL_CALL_BODY_DEPTH_LIMIT = 3;
const ROUTEC_TOOL_CALL_BODY_REDACTED_VALUE = "[redacted]";
const ROUTEC_TOOL_CALL_BODY_REDACTED_PATH = "[redacted-local-path]";
const ROUTEC_TOOL_CALL_BODY_REDACTED_DETAIL_PATH =
  "[redacted-tool-detail-path]";
const ROUTEC_TOOL_CALL_BODY_SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|bearer[_-]?token)/i;
const OYSTERUN_ALLOWED_CINNY_SESSION_ROUTE_SOURCES = new Set([
  "query_session_id",
  "query_host_session_id",
  "clean_session_path",
  "session_storage_host_session_id",
]);
const OYSTERUN_MSC2965_AUTH_METADATA_PATH =
  "/_matrix/client/unstable/org.matrix.msc2965/auth_metadata";
const OYSTERUN_MSC2965_AUTH_METADATA_NEGATIVE_PROOF_MARKER =
  "routec_msc2965_auth_metadata_fail_closed_no_synapse_proxy_no_oidc_no_pass";
const OYSTERUN_MSC2965_AUTH_ISSUER_PATH =
  "/_matrix/client/unstable/org.matrix.msc2965/auth_issuer";
const OYSTERUN_MSC2965_AUTH_ISSUER_NEGATIVE_PROOF_MARKER =
  "routec_msc2965_auth_issuer_fail_closed_no_synapse_proxy_no_oidc_no_pass";
const OYSTERUN_SEMANTIC_RETRY_MARKER =
  "routec_semantic_category_schema_pacing_retry_backoff_same_txn_same_semantic_proof";
const OYSTERUN_SEMANTIC_RETRY_MAX_ATTEMPTS = 3;
const OYSTERUN_SEMANTIC_RETRY_MAX_RETRIES = 2;
const OYSTERUN_SEMANTIC_RETRY_MAX_BACKOFF_MS = 5000;
const OYSTERUN_SEMANTIC_RETRY_TOTAL_WAIT_BUDGET_MS = 10000;
const OYSTERUN_TERMINAL_SEMANTIC_OUTPUT_MAX_CHARS = 12000;
const OYSTERUN_PROFILE_COMPATIBILITY_MARKER =
  "oysterun_bound_profile_compatibility_metadata_no_raw_token";
const OYSTERUN_MEMBERS_COMPATIBILITY_MARKER =
  "oysterun_bound_members_compatibility_metadata_no_raw_token";
const ROUTEC_FACADE_REQUEST_ID_HEADER = "X-Oysterun-Facade-Request-Id";
const ROUTEC_FACADE_REQUEST_ID_KIND =
  "host_generated_non_secret_facade_request_id";
const ROUTEC_FACADE_REQUEST_ID_REQ_PROPERTY = "__routecFacadeRequestId";
const ROUTEC_FACADE_TRANSCRIPT_ARTIFACT =
  "matrix_facade_request_response_transcript.jsonl";
const ROUTEC_AUTH_LOSS_DIAGNOSTIC_ARTIFACT =
  "routec_auth_loss_diagnostics.jsonl";
const ROUTEC_PROCESS_STARTED_AT = new Date().toISOString();
const ROUTEC_FACADE_TRANSCRIPT_MAX_STRING_CHARS = 2048;
const ROUTEC_FACADE_TRANSCRIPT_MAX_ARRAY_ITEMS = 8;
const ROUTEC_FACADE_TRANSCRIPT_MAX_OBJECT_KEYS = 80;
const ROUTEC_FACADE_TRANSCRIPT_MAX_DEPTH = 8;
const ROUTEC_FACADE_TRANSCRIPT_DEFAULT_MAX_BYTES = 262144;
const ROUTEC_FACADE_TRANSCRIPT_DEFAULT_MAX_FILES = 3;

const OYSTERUN_CONTROL_OUTCOME_COMPATIBILITY = new Map([
  ["approved", "accepted"],
  ["approve", "accepted"],
  ["allow", "accepted"],
  ["allowed", "accepted"],
  ["denied", "rejected"],
  ["deny", "rejected"],
  ["declined", "rejected"],
  ["too_late_to_cancel", "too_late"],
  ["internal_error", "failed"],
  ["host2_intake_not_cancelable", "failed"],
  ["matrix_event_not_stable_for_cancel", "failed"],
  ["host2_intake_not_found", "not_found"],
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

const ROUTEC_PROVIDER_DELIVERABLE_MEDIA_MSGTYPES = new Set([
  "m.image",
  "m.file",
  "m.video",
  "m.audio",
]);

const ROUTEC_MEDIA_METADATA_NAMESPACE = "org.oysterun.media.v1";
const ROUTEC_MULTI_MEDIA_MSGTYPE = "org.oysterun.multi_media";
const ROUTEC_MULTI_MEDIA_CONTRACT = "routec_multi_media_product_message_v1";

function matrixJsonError(errcode, error) {
  return { errcode, error };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getRouteCMediaContentUri(content) {
  if (typeof content?.url === "string" && content.url.trim()) {
    return content.url.trim();
  }
  if (
    isObject(content?.file) &&
    typeof content.file.url === "string" &&
    content.file.url.trim()
  ) {
    return content.file.url.trim();
  }
  return null;
}

function getRouteCMediaProviderPromptUserMessage(content) {
  const metadata = isObject(content?.[ROUTEC_MEDIA_METADATA_NAMESPACE])
    ? content[ROUTEC_MEDIA_METADATA_NAMESPACE]
    : null;
  return typeof metadata?.provider_prompt_user_message === "string" &&
    metadata.provider_prompt_user_message.trim()
    ? metadata.provider_prompt_user_message.trim()
    : "";
}

function getRouteCMediaCaptionText(content, mediaEntry) {
  const providerPromptUserMessage =
    getRouteCMediaProviderPromptUserMessage(content);
  if (providerPromptUserMessage) {
    return providerPromptUserMessage;
  }
  if (typeof content?.body === "string" && content.body.trim()) {
    return content.body.trim();
  }
  if (typeof content?.filename === "string" && content.filename.trim()) {
    return content.filename.trim();
  }
  if (
    typeof mediaEntry?.original_filename === "string" &&
    mediaEntry.original_filename.trim()
  ) {
    return mediaEntry.original_filename.trim();
  }
  if (typeof mediaEntry?.filename === "string" && mediaEntry.filename.trim()) {
    return mediaEntry.filename.trim();
  }
  return "Attached file";
}

function buildRouteCMediaProviderPrompt({ content, mediaEntry }) {
  const userMessage = getRouteCMediaCaptionText(content, mediaEntry);
  return {
    promptText: `[Attached files]\n${mediaEntry.saved_path}\n\nUser message:\n${userMessage}`,
    userMessage,
  };
}

function getRouteCMediaMetadata(content) {
  return isObject(content?.[ROUTEC_MEDIA_METADATA_NAMESPACE])
    ? content[ROUTEC_MEDIA_METADATA_NAMESPACE]
    : null;
}

function normalizeRouteCLinkAnnotationAgentRoot(agentRoot) {
  if (typeof agentRoot !== "string" || !agentRoot.trim()) return "";
  const stats = statSync(agentRoot.trim(), { throwIfNoEntry: false });
  if (!stats?.isDirectory()) return "";
  return realpathSync(agentRoot.trim());
}

function getRouteCSessionHistoryAgentFolder({ binding }) {
  const sessionId =
    typeof binding?.host_session_id === "string"
      ? binding.host_session_id.trim()
      : "";
  if (!sessionId) return "";
  const agentId =
    typeof binding?.host_agent_id === "string" ? binding.host_agent_id.trim() : "";
  const record = getSessionHistory().find(
    (entry) =>
      entry.session_id === sessionId &&
      (!agentId || !entry.agent_id || entry.agent_id === agentId)
  );
  return normalizeRouteCLinkAnnotationAgentRoot(record?.agent_folder);
}

function normalizeRouteCMultiMediaAttachmentRecord({
  attachment,
  expectedIndex,
  binding,
}) {
  if (!isObject(attachment)) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media Send requires object attachment records."
    );
  }
  if (attachment.attachment_index !== expectedIndex) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media attachment records must be ordered by visible attachment index."
    );
  }
  if (typeof attachment.content_uri !== "string" || !attachment.content_uri) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media attachment record requires content_uri."
    );
  }
  const mediaMapping = resolveRouteCMatrixMediaContentUri({
    contentUri: attachment.content_uri,
    binding,
  });
  if (
    typeof attachment.saved_path === "string" &&
    attachment.saved_path &&
    attachment.saved_path !== mediaMapping.entry.saved_path
  ) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media attachment saved_path does not match Host media mapping."
    );
  }
  return {
    attachment_index: expectedIndex,
    filename:
      typeof attachment.filename === "string" && attachment.filename.trim()
        ? attachment.filename.trim()
        : mediaMapping.entry.filename,
    content_uri: attachment.content_uri,
    saved_path: mediaMapping.entry.saved_path,
    saved_path_source: "host_owned_routec_matrix_media_store",
    mimetype:
      typeof attachment.mimetype === "string" && attachment.mimetype.trim()
        ? attachment.mimetype.trim()
        : mediaMapping.entry.mimetype,
    byte_size: Number.isFinite(attachment.byte_size)
      ? attachment.byte_size
      : mediaMapping.entry.byte_size,
    sha256:
      typeof attachment.sha256 === "string" && attachment.sha256.trim()
        ? attachment.sha256.trim()
        : mediaMapping.entry.sha256,
    event_id:
      typeof attachment.event_id === "string" && attachment.event_id.trim()
        ? attachment.event_id.trim()
        : null,
  };
}

function normalizeRouteCMultiMediaProductAttachmentRecord({
  attachment,
  expectedIndex,
  binding,
}) {
  if (!isObject(attachment)) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message requires object attachment records."
    );
  }
  if (attachment.index !== expectedIndex) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message attachments must be ordered by index."
    );
  }
  if (typeof attachment.content_uri !== "string" || !attachment.content_uri) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message attachment requires content_uri."
    );
  }
  const mediaMapping = resolveRouteCMatrixMediaContentUri({
    contentUri: attachment.content_uri,
    binding,
  });
  if (
    typeof attachment.saved_path === "string" &&
    attachment.saved_path &&
    attachment.saved_path !== mediaMapping.entry.saved_path
  ) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message attachment saved_path does not match Host media mapping."
    );
  }
  const filename =
    typeof attachment.filename === "string" && attachment.filename.trim()
      ? attachment.filename.trim()
      : mediaMapping.entry.filename;
  const mimetype =
    typeof attachment.mimetype === "string" && attachment.mimetype.trim()
      ? attachment.mimetype.trim()
      : mediaMapping.entry.mimetype;
  const byteSize = Number.isFinite(attachment.byte_size)
    ? attachment.byte_size
    : mediaMapping.entry.byte_size;
  if (!filename || !mimetype || !Number.isFinite(byteSize)) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message attachment requires filename, mimetype, and byte_size."
    );
  }
  return {
    index: expectedIndex,
    filename,
    content_uri: attachment.content_uri,
    saved_path: mediaMapping.entry.saved_path,
    saved_path_source: "host_owned_routec_matrix_media_store",
    mimetype,
    byte_size: byteSize,
    sha256:
      typeof attachment.sha256 === "string" && attachment.sha256.trim()
        ? attachment.sha256.trim()
        : mediaMapping.entry.sha256,
    msgtype:
      typeof attachment.msgtype === "string" && attachment.msgtype.trim()
        ? attachment.msgtype.trim()
        : null,
    info: isObject(attachment.info) ? attachment.info : {},
  };
}

function getRouteCMultiMediaProductCaptionText({ content, metadata }) {
  const caption = isObject(metadata?.caption) ? metadata.caption : null;
  if (typeof caption?.body === "string" && caption.body.trim()) {
    return caption.body.trim();
  }
  if (typeof metadata?.provider_prompt_user_message === "string" &&
    metadata.provider_prompt_user_message.trim()) {
    return metadata.provider_prompt_user_message.trim();
  }
  if (typeof content?.body === "string" && content.body.trim()) {
    return content.body.trim();
  }
  return "Attached files";
}

function buildRouteCMultiMediaProductProviderPrompt({
  content,
  metadata,
  binding,
}) {
  if (content?.msgtype !== ROUTEC_MULTI_MEDIA_MSGTYPE) return null;
  if (!metadata || metadata.contract !== ROUTEC_MULTI_MEDIA_CONTRACT) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message requires the P160 contract metadata."
    );
  }
  if (!Array.isArray(metadata.attachments) || metadata.attachments.length < 2) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message requires at least two attachments."
    );
  }
  const attachments = metadata.attachments.map((attachment, index) =>
    normalizeRouteCMultiMediaProductAttachmentRecord({
      attachment,
      expectedIndex: index,
      binding,
    })
  );
  const uniqueContentUris = new Set(
    attachments.map((attachment) => attachment.content_uri)
  );
  if (uniqueContentUris.size !== attachments.length) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media product message attachments must not duplicate content_uri values."
    );
  }

  const userMessage = getRouteCMultiMediaProductCaptionText({
    content,
    metadata,
  });
  const savedPaths = attachments
    .map((attachment) => attachment.saved_path)
    .join("\n");
  const promptText = `[Attached files]\n${savedPaths}\n\nUser message:\n${userMessage}`;
  return {
    deliver: true,
    text: promptText,
    providerText: promptText,
    proof: {
      routec_provider_delivery_kind:
        "matrix_multi_media_product_message_saved_path_prompt",
      routec_phase160_multi_media_product_message: true,
      routec_multi_media_contract: ROUTEC_MULTI_MEDIA_CONTRACT,
      one_explicit_send_commits_one_matrix_media_event: true,
      one_explicit_send_commits_one_matrix_media_event_per_file: false,
      one_provider_prompt_for_whole_send: true,
      split_text_event_created: false,
      provider_prompt_shape:
        "[Attached files]\\n<saved_path>...\\n\\nUser message:\\n<caption/text>",
      provider_prompt_saved_paths: attachments.map(
        (attachment) => attachment.saved_path
      ),
      provider_prompt_user_message: userMessage,
      routec_multi_media_attachment_count: attachments.length,
      routec_multi_media_attachments: attachments,
      matrix_media_msgtype: content.msgtype,
    },
  };
}

function buildRouteCMultiMediaProviderPrompt({
  content,
  mediaEntry,
  metadata,
  binding,
}) {
  if (!metadata) return null;
  if (metadata.routec_phase29_multi_media_send !== true) return null;

  const groupId =
    typeof metadata.multi_media_group_id === "string" &&
    metadata.multi_media_group_id.trim()
      ? metadata.multi_media_group_id.trim()
      : null;
  const attachmentIndex = metadata.multi_media_attachment_index;
  const attachmentCount = metadata.multi_media_attachment_count;
  if (
    !groupId ||
    !Number.isInteger(attachmentIndex) ||
    !Number.isInteger(attachmentCount) ||
    attachmentCount < 2 ||
    attachmentIndex < 0 ||
    attachmentIndex >= attachmentCount
  ) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media Send requires a valid group id, attachment index, and attachment count."
    );
  }

  if (metadata.multi_media_provider_delivery !== "deliver_group_on_final_media_event") {
    return {
      deliver: false,
      reason: "routec_multi_media_provider_delivery_deferred_until_final_event",
      proof: {
        routec_provider_delivery_kind: "matrix_multi_media_message_deferred",
        routec_phase29_multi_media_send: true,
        routec_multi_media_group_id: groupId,
        routec_multi_media_attachment_index: attachmentIndex,
        routec_multi_media_attachment_count: attachmentCount,
        provider_delivery_deferred_until_final_media_event: true,
        foundation_pass_claimed: false,
      },
    };
  }

  if (attachmentIndex !== attachmentCount - 1) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media provider delivery can only be requested by the final media event."
    );
  }
  if (!Array.isArray(metadata.multi_media_attachments)) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media final event requires the full attachment list."
    );
  }
  if (metadata.multi_media_attachments.length !== attachmentCount) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media attachment list length must match attachment count."
    );
  }

  const attachments = metadata.multi_media_attachments.map((attachment, index) =>
    normalizeRouteCMultiMediaAttachmentRecord({
      attachment,
      expectedIndex: index,
      binding,
    })
  );
  const currentContentUri = getRouteCMediaContentUri(content);
  const currentAttachment = attachments[attachmentIndex];
  if (currentAttachment.content_uri !== currentContentUri) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C multi-media final event content_uri must match the final attachment record."
    );
  }

  const userMessage = getRouteCMediaCaptionText(content, mediaEntry);
  const savedPaths = attachments
    .map((attachment) => attachment.saved_path)
    .join("\n");
  const promptText = `[Attached files]\n${savedPaths}\n\nUser message:\n${userMessage}`;
  return {
    deliver: true,
    text: promptText,
    providerText: promptText,
    proof: {
      routec_provider_delivery_kind:
        "matrix_multi_media_message_saved_path_prompt",
      routec_phase17_3_media_send_commit: true,
      routec_phase29_multi_media_send: true,
      one_explicit_send_commits_one_matrix_media_event: false,
      one_explicit_send_commits_one_matrix_media_event_per_file: true,
      one_provider_prompt_for_whole_send: true,
      split_text_event_created: false,
      provider_prompt_shape:
        "[Attached files]\\n<saved_path>...\\n\\nUser message:\\n<caption/text>",
      provider_prompt_saved_paths: attachments.map(
        (attachment) => attachment.saved_path
      ),
      provider_prompt_user_message: userMessage,
      routec_multi_media_group_id: groupId,
      routec_multi_media_attachment_index: attachmentIndex,
      routec_multi_media_attachment_count: attachmentCount,
      routec_multi_media_attachments: attachments,
      matrix_media_msgtype: content.msgtype,
      content_uri: currentContentUri,
    },
  };
}

function describeRouteCSendProviderDelivery({ content, binding }) {
  if (
    content?.msgtype === "m.text" &&
    typeof content?.body === "string" &&
    content.body.trim()
  ) {
    return {
      ok: true,
      deliver: true,
      text: content.body,
      proof: {
        routec_provider_delivery_kind: "matrix_text_message",
        routec_phase17_3_media_send_commit: false,
      },
    };
  }

  const metadata = getRouteCMediaMetadata(content);
  const multiMediaProductPrompt = buildRouteCMultiMediaProductProviderPrompt({
    content,
    metadata,
    binding,
  });
  if (multiMediaProductPrompt) {
    return {
      ok: true,
      ...multiMediaProductPrompt,
    };
  }

  if (!ROUTEC_PROVIDER_DELIVERABLE_MEDIA_MSGTYPES.has(content?.msgtype)) {
    return {
      ok: true,
      deliver: false,
      reason: "matrix_send_not_successful_or_not_text_or_media_message",
    };
  }

  const contentUri = getRouteCMediaContentUri(content);
  if (!contentUri) {
    return {
      ok: false,
      status: 400,
      body: matrixJsonError(
        "M_INVALID_PARAM",
        "Route C media Send requires a Host-owned mxc:// content URI."
      ),
    };
  }

  const mediaMapping = resolveRouteCMatrixMediaContentUri({
    contentUri,
    binding,
  });
  const multiMediaPrompt = buildRouteCMultiMediaProviderPrompt({
    content,
    mediaEntry: mediaMapping.entry,
    metadata,
    binding,
  });
  if (multiMediaPrompt) {
    return {
      ok: true,
      ...multiMediaPrompt,
    };
  }
  const { promptText, userMessage } = buildRouteCMediaProviderPrompt({
    content,
    mediaEntry: mediaMapping.entry,
  });
  return {
    ok: true,
    deliver: true,
    text: promptText,
    providerText: promptText,
    proof: {
      routec_provider_delivery_kind: "matrix_media_message_saved_path_prompt",
      routec_phase17_3_media_send_commit: true,
      one_explicit_send_commits_one_matrix_media_event: true,
      split_text_event_created: false,
      provider_prompt_shape:
        "[Attached files]\\n<saved_path>\\n\\nUser message:\\n<caption/text>",
      provider_prompt_saved_path: mediaMapping.entry.saved_path,
      provider_prompt_user_message: userMessage,
      matrix_media_msgtype: content.msgtype,
      content_uri: contentUri,
      filename:
        typeof content.filename === "string" && content.filename.trim()
          ? content.filename.trim()
          : mediaMapping.entry.filename,
      media_mapping_proof: mediaMapping.proof,
      client_media_metadata: metadata,
    },
  };
}

function getRouteCLinkAnnotationContext({ binding, sessionManager }) {
  const session = sessionManager.getSession(binding.host_session_id);
  const liveAgentRoot = normalizeRouteCLinkAnnotationAgentRoot(session?.cwd);
  const historyAgentRoot = liveAgentRoot
    ? ""
    : getRouteCSessionHistoryAgentFolder({ binding });
  return {
    agentId: binding.host_agent_id,
    agentRoot: liveAgentRoot || historyAgentRoot,
    workspacePolicy: session?.workspacePolicy,
    assetReadablePaths: session?.assetReadablePaths,
  };
}

function attachRouteCChatAssetLinkAnnotations({ content, binding, sessionManager }) {
  return attachRouteCMatrixContentAssetLinkAnnotations({
    content,
    ...getRouteCLinkAnnotationContext({ binding, sessionManager }),
  });
}

function attachRouteCProviderSemanticMarkdownLinkAnnotations({
  content,
  binding,
  sessionManager,
  semanticType,
  body,
}) {
  return attachRouteCProviderSemanticMarkdownLinkAnnotationsForContent({
    content,
    semanticType,
    body,
    ...getRouteCLinkAnnotationContext({ binding, sessionManager }),
  });
}

function hostOriginFromRequest(req) {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto =
    typeof protoHeader === "string" && protoHeader.trim()
      ? protoHeader.split(",")[0].trim()
      : "http";
  const host = req.headers["host"];
  if (!host) {
    throw new Error("Host header is required for Route C Matrix bootstrap");
  }
  return `${proto}://${host}`;
}

function createRouteCFacadeRequestId() {
  return `oysterun-facade-request-${randomUUID()}`;
}

function attachRouteCFacadeRequestId({ req, res, facadeRequestId }) {
  Object.defineProperty(req, ROUTEC_FACADE_REQUEST_ID_REQ_PROPERTY, {
    value: facadeRequestId,
    enumerable: false,
    configurable: true,
  });
  res.setHeader(ROUTEC_FACADE_REQUEST_ID_HEADER, facadeRequestId);
}

function facadeRequestIdProofFields(req) {
  const facadeRequestId = req?.[ROUTEC_FACADE_REQUEST_ID_REQ_PROPERTY] || null;
  return {
    facade_request_id: facadeRequestId,
    facade_request_id_kind: facadeRequestId
      ? ROUTEC_FACADE_REQUEST_ID_KIND
      : null,
  };
}

function matrixEndpointKey(req, path) {
  if (req.method === "GET" && path === "/_matrix/client/versions") {
    return "GET /_matrix/client/versions";
  }
  if (req.method === "GET" && path === OYSTERUN_PUBLIC_LOGIN_FLOWS_PATH) {
    return `GET ${OYSTERUN_PUBLIC_LOGIN_FLOWS_PATH}`;
  }
  if (req.method === "POST" && path === OYSTERUN_PUBLIC_REGISTER_PATH) {
    return `POST ${OYSTERUN_PUBLIC_REGISTER_PATH}`;
  }
  if (req.method === "GET" && path === OYSTERUN_MSC2965_AUTH_METADATA_PATH) {
    return `GET ${OYSTERUN_MSC2965_AUTH_METADATA_PATH}`;
  }
  if (req.method === "GET" && path === OYSTERUN_MSC2965_AUTH_ISSUER_PATH) {
    return `GET ${OYSTERUN_MSC2965_AUTH_ISSUER_PATH}`;
  }
  if (req.method === "GET" && path === "/_matrix/client/v3/capabilities") {
    return "GET /_matrix/client/v3/capabilities";
  }
  if (req.method === "GET" && path === "/_matrix/media/v3/config") {
    return "GET /_matrix/media/v3/config";
  }
  if (req.method === "POST" && path === "/_matrix/media/v3/upload") {
    return "POST /_matrix/media/v3/upload";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/media\/v3\/download\/[^/]+\/[^/]+$/.test(path)
  ) {
    return "GET /_matrix/media/v3/download/:serverName/:mediaId";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/media\/v3\/thumbnail\/[^/]+\/[^/]+$/.test(path)
  ) {
    return "GET /_matrix/media/v3/thumbnail/:serverName/:mediaId";
  }
  if (req.method === "GET" && path === "/_matrix/client/v3/room_keys/version") {
    return "GET /_matrix/client/v3/room_keys/version";
  }
  if (req.method === "GET" && path === "/_matrix/client/v3/voip/turnServer") {
    return "GET /_matrix/client/v3/voip/turnServer";
  }
  if (req.method === "GET" && path === "/_matrix/client/v3/pushrules/") {
    return "GET /_matrix/client/v3/pushrules/";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/client\/v3\/profile\/[^/]+$/.test(path)
  ) {
    return "GET /_matrix/client/v3/profile/:userId";
  }
  if (
    req.method === "POST" &&
    /^\/_matrix\/client\/v3\/user\/[^/]+\/filter$/.test(path)
  ) {
    return "POST /_matrix/client/v3/user/:userId/filter";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/client\/v3\/user\/[^/]+\/filter\/[^/]+$/.test(path)
  ) {
    return "GET /_matrix/client/v3/user/:userId/filter/:filterId";
  }
  if (req.method === "GET" && path === "/_matrix/client/v3/sync") {
    return "GET /_matrix/client/v3/sync";
  }
  if (req.method === "POST" && path === "/_matrix/client/v3/search") {
    return "POST /_matrix/client/v3/search";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/members$/.test(path)
  ) {
    return "GET /_matrix/client/v3/rooms/:roomId/members";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/messages$/.test(path)
  ) {
    return "GET /_matrix/client/v3/rooms/:roomId/messages";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/context\/[^/]+$/.test(path)
  ) {
    return "GET /_matrix/client/v3/rooms/:roomId/context/:eventId";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/event\/[^/]+$/.test(path)
  ) {
    return "GET /_matrix/client/v3/rooms/:roomId/event/:eventId";
  }
  if (
    req.method === "GET" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/state\/m\.room\.pinned_events\/?$/.test(
      path
    )
  ) {
    return "GET /_matrix/client/v3/rooms/:roomId/state/m.room.pinned_events/";
  }
  if (
    req.method === "PUT" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/state\/m\.room\.pinned_events\/?$/.test(
      path
    )
  ) {
    return "PUT /_matrix/client/v3/rooms/:roomId/state/m.room.pinned_events/";
  }
  if (
    req.method === "PUT" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/send\/m\.room\.message\/[^/]+$/.test(
      path
    )
  ) {
    return "PUT /_matrix/client/v3/rooms/:roomId/send/m.room.message/:txnId";
  }
  if (
    req.method === "PUT" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/typing\/[^/]+$/.test(path)
  ) {
    return "PUT /_matrix/client/v3/rooms/:roomId/typing/:userId";
  }
  if (
    req.method === "POST" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/receipt\/m\.read\/[^/]+$/.test(path)
  ) {
    return "POST /_matrix/client/v3/rooms/:roomId/receipt/m.read/:eventId";
  }
  if (
    req.method === "POST" &&
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/read_markers$/.test(path)
  ) {
    return "POST /_matrix/client/v3/rooms/:roomId/read_markers";
  }
  return `${req.method} ${path}`;
}

function classifyEndpoint(req, path) {
  const key = matrixEndpointKey(req, path);
  if (SUPPORTED_MATRIX_ENDPOINTS.includes(key)) return "supported";
  if (req.method === "GET" && path === OYSTERUN_MSC2965_AUTH_METADATA_PATH) {
    return "blocked_msc2965_auth_metadata_fail_closed";
  }
  if (req.method === "GET" && path === OYSTERUN_MSC2965_AUTH_ISSUER_PATH) {
    return "blocked_msc2965_auth_issuer_fail_closed";
  }
  if (path.startsWith("/_matrix/media/"))
    return "blocked_media_wildcard_rejected";
  if (/^\/_matrix\/client\/v3\/rooms\/[^/]+\/send\/[^/]+\/[^/]+$/.test(path)) {
    return "blocked_send_event_type_not_allowlisted";
  }
  if (isRouteCBlockedCryptoEndpoint(path))
    return "blocked_crypto_security_contract_required";
  if (isRouteCRoomStateMemberReadEndpoint(req, path)) {
    return "blocked_room_state_member_read_not_allowlisted";
  }
  return "blocker";
}

function isRouteCBlockedCryptoEndpoint(path) {
  if (path === "/_matrix/client/v3/room_keys/version") return false;
  return (
    path.startsWith("/_matrix/client/v3/room_keys/") ||
    path.startsWith("/_matrix/client/v3/keys/") ||
    path.startsWith("/_matrix/client/v3/sendToDevice/") ||
    path.startsWith("/_matrix/client/unstable/org.matrix.msc3814")
  );
}

function isRouteCRoomStateMemberReadEndpoint(req, path) {
  if (req.method !== "GET") return false;
  return (
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/state(?:\/|$)/.test(path) ||
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/members$/.test(path) ||
    /^\/_matrix\/client\/v3\/rooms\/[^/]+\/joined_members$/.test(path)
  );
}

function extractRoomSendPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/(m\.room\.message)\/([^/]+)$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    eventType: decodeURIComponent(match[2]),
    txnId: decodeURIComponent(match[3]),
  };
}

function extractUserFilterCreatePathParts(path) {
  const match = path.match(/^\/_matrix\/client\/v3\/user\/([^/]+)\/filter$/);
  if (!match) return null;
  return {
    userId: decodeURIComponent(match[1]),
  };
}

function extractUserFilterReadPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/user\/([^/]+)\/filter\/([^/]+)$/
  );
  if (!match) return null;
  return {
    userId: decodeURIComponent(match[1]),
    filterId: decodeURIComponent(match[2]),
  };
}

function extractTypingPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/typing\/([^/]+)$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    userId: decodeURIComponent(match[2]),
  };
}

function extractReceiptPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/receipt\/(m\.read)\/([^/]+)$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    receiptType: decodeURIComponent(match[2]),
    eventId: decodeURIComponent(match[3]),
  };
}

function extractReadMarkersPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/read_markers$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
  };
}

function extractProfilePathParts(path) {
  const match = path.match(/^\/_matrix\/client\/v3\/profile\/([^/]+)$/);
  if (!match) return null;
  return {
    userId: decodeURIComponent(match[1]),
  };
}

function extractMembersPathParts(path) {
  const match = path.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/members$/);
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
  };
}

function extractUserScopedPathParts(path) {
  const match = path.match(/^\/_matrix\/client\/v3\/user\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return {
    userId: decodeURIComponent(match[1]),
    scope: "user_scoped_matrix_facade_path",
  };
}

function respondRouteCMatrixStorageUnavailable({ res, respond, err }) {
  const detail = err?.message || String(err);
  console.warn(`[routec] Matrix storage unavailable: ${detail}`);
  return respond(res, 503, {
    error: "Route C Matrix storage is unavailable",
    code: "matrix_storage_unavailable",
    detail,
    routec_matrix_storage_repair_required: true,
    raw_synapse_token_exposed: false,
    pass_claimed: false,
  });
}

function extractEventPathParts(path) {
  const match = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/event\/([^/]+)$/
  );
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    eventId: decodeURIComponent(match[2]),
  };
}

function extractRoomScopedPathParts(path) {
  const match = path.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    scope: "room_scoped_matrix_facade_path",
  };
}

function extractMatrixMediaDownloadPathParts(path) {
  const match = path.match(
    /^\/_matrix\/media\/v3\/(download|thumbnail)\/([^/]+)\/([^/]+)$/
  );
  if (!match) return null;
  return {
    endpoint:
      match[1] === "thumbnail"
        ? "GET /_matrix/media/v3/thumbnail/:serverName/:mediaId"
        : "GET /_matrix/media/v3/download/:serverName/:mediaId",
    serverName: decodeURIComponent(match[2]),
    mediaId: decodeURIComponent(match[3]),
  };
}

function isMatrixMediaUploadRequest(req, path) {
  return req.method === "POST" && path === "/_matrix/media/v3/upload";
}

function isMatrixMediaDownloadRequest(req, path) {
  return req.method === "GET" && extractMatrixMediaDownloadPathParts(path);
}

async function readMaybeJsonBody(req, readBody) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return null;
  return readBody(req);
}

async function readRawMatrixRequestBody(req, readRawBody) {
  if (typeof readRawBody === "function") {
    const buffer = await readRawBody(req);
    if (Buffer.isBuffer(buffer)) return buffer;
    if (buffer === null || buffer === undefined) return Buffer.alloc(0);
    return Buffer.from(buffer);
  }
  if (!req || typeof req.on !== "function") {
    throw new Error("Route C Matrix media upload requires a raw body reader");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function headerValue(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeContentDispositionFilename(filename) {
  return String(filename || "download.bin").replace(/["\\\r\n]/g, "_");
}

function respondMatrixMediaDownload(res, download) {
  const headers = {
    "Content-Type": download.contentType || "application/octet-stream",
    "Content-Length": String(download.buffer.length),
    "Content-Disposition": `inline; filename="${safeContentDispositionFilename(
      download.filename
    )}"`,
    "Cache-Control": "private, no-store",
    "X-Oysterun-RouteC-Media-Storage": "host-owned",
  };
  if (typeof res.writeHead === "function") {
    res.writeHead(200, headers);
  } else if (typeof res.setHeader === "function") {
    Object.entries(headers).forEach(([name, value]) => {
      res.setHeader(name, value);
    });
  }
  if (typeof res.end === "function") {
    res.end(download.buffer);
  }
  return {
    status: 200,
    headers,
    body: download.proof,
    buffer: download.buffer,
  };
}

async function routeCMatrixStorageRequest({
  req,
  path,
  url,
  body,
  binding,
  tokenRecord,
  senderMatrixUserId = null,
  senderActorKey = null,
}) {
  return handleRouteCMatrixStorageRequest({
    req,
    path,
    url,
    body,
    binding,
    tokenRecord,
    senderMatrixUserId,
    senderActorKey,
  });
}

function normalizeSessionSetupTranscriptPreviewLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_LIMIT;
  }
  return Math.min(
    Math.max(Math.floor(numeric), 1),
    OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_MAX_LIMIT
  );
}

function normalizeSessionSetupTranscriptPreviewMode(value) {
  if (value === null || value === undefined || value === "") return "resume";
  const normalized = String(value).trim();
  if (normalized === "resume" || normalized === "branch") return normalized;
  throw new Error("mode must be resume or branch");
}

function routeCMatrixPreviewHash(kind, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

function routeCMatrixEventContent(event) {
  return isObject(event?.content) ? event.content : {};
}

function routeCMatrixSemanticPayload(content) {
  const semantic = content[OYSTERUN_SEMANTIC_NAMESPACE];
  return isObject(semantic) ? semantic : null;
}

function routeCMatrixPreviewSenderLabel({ binding, sender }) {
  const actor = getRouteCMatrixActorByUserId(binding, sender);
  if (actor?.display_name) return actor.display_name;
  if (actor?.actor_key) return actor.actor_key;
  return "Unknown Matrix sender";
}

function routeCMatrixPreviewRole(semanticType, actor) {
  if (semanticType === "message.user" || actor?.actor_kind === "human") {
    return "user";
  }
  if (
    semanticType === "tool.call" ||
    semanticType === "tool.update" ||
    semanticType === "tool.output" ||
    semanticType === "tool.result" ||
    semanticType === "tool.failure" ||
    actor?.actor_kind === "tool"
  ) {
    return "tool";
  }
  if (
    semanticType === "control.request" ||
    semanticType === "control.outcome" ||
    semanticType === "control.cancel.outcome" ||
    semanticType === "terminal.command.started" ||
    semanticType === "terminal.command.result" ||
    semanticType === "runtime.error" ||
    semanticType === "session_lifecycle" ||
    semanticType === "outbox.delivery" ||
    actor?.actor_kind === "control" ||
    actor?.actor_kind === "host"
  ) {
    return "control-status";
  }
  return "assistant";
}

function routeCMatrixPreviewMessageType(semanticType) {
  if (semanticType === "runtime.error") return "runtime_error";
  if (semanticType === "session_lifecycle") return "session_lifecycle";
  if (semanticType?.startsWith("tool.")) return "tool";
  if (semanticType?.startsWith("control.")) return "control_status";
  if (semanticType?.startsWith("terminal.")) return "terminal";
  return "message";
}

function routeCMatrixPreviewSemanticSummary(semanticType) {
  if (!semanticType) return null;
  if (
    semanticType === "runtime.error" ||
    semanticType === "session_lifecycle" ||
    semanticType === "outbox.delivery" ||
    semanticType?.startsWith("terminal.") ||
    semanticType.startsWith("tool.") ||
    semanticType.startsWith("control.")
  ) {
    return semanticType;
  }
  return null;
}

function routeCFirstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function routeCTruncateToolCallBodyText(value, limit) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trim()}…`;
}

function routeCRedactToolCallBodyText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(
      /\b(authorization|cookie|set-cookie)\s*[:=]\s*["']?[^"'\s,;}\]]+/gi,
      `$1: ${ROUTEC_TOOL_CALL_BODY_REDACTED_VALUE}`
    )
    .replace(
      /\b(access_token|refresh_token|id_token|api_key|password|secret)\s*[:=]\s*["']?[^"'\s,;}\]]+/gi,
      `$1: ${ROUTEC_TOOL_CALL_BODY_REDACTED_VALUE}`
    )
    .replace(
      /[^\s"'<>)]*large_tool_calls[^\s"'<>)]*/gi,
      ROUTEC_TOOL_CALL_BODY_REDACTED_DETAIL_PATH
    )
    .replace(
      /(?:\/Users|\/Volumes|\/private\/var|\/var\/folders|\/tmp)\/[^\s"'<>)]*/g,
      ROUTEC_TOOL_CALL_BODY_REDACTED_PATH
    );
}

function routeCNormalizeToolCallBodyString(value, limit) {
  return routeCTruncateToolCallBodyText(
    routeCRedactToolCallBodyText(value),
    limit
  );
}

function routeCSummarizeToolCallValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return routeCNormalizeToolCallBodyString(
      value,
      ROUTEC_TOOL_CALL_BODY_VALUE_LIMIT
    );
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  if (depth >= ROUTEC_TOOL_CALL_BODY_DEPTH_LIMIT) return "[truncated]";
  seen.add(value);
  if (Array.isArray(value)) {
    const entries = value
      .slice(0, ROUTEC_TOOL_CALL_BODY_ARRAY_LIMIT)
      .map((entry) => routeCSummarizeToolCallValue(entry, depth + 1, seen));
    if (value.length > ROUTEC_TOOL_CALL_BODY_ARRAY_LIMIT) {
      entries.push(`[${value.length - ROUTEC_TOOL_CALL_BODY_ARRAY_LIMIT} more]`);
    }
    return entries;
  }
  const summary = {};
  const entries = Object.entries(value).slice(
    0,
    ROUTEC_TOOL_CALL_BODY_OBJECT_KEY_LIMIT
  );
  for (const [key, entryValue] of entries) {
    summary[key] = ROUTEC_TOOL_CALL_BODY_SENSITIVE_KEY_PATTERN.test(key)
      ? ROUTEC_TOOL_CALL_BODY_REDACTED_VALUE
      : routeCSummarizeToolCallValue(entryValue, depth + 1, seen);
  }
  const omitted =
    Object.keys(value).length - ROUTEC_TOOL_CALL_BODY_OBJECT_KEY_LIMIT;
  if (omitted > 0) summary.__omitted_keys = omitted;
  return summary;
}

function routeCJsonToolCallBodyText(value) {
  try {
    const summarized = routeCSummarizeToolCallValue(value);
    const encoded = JSON.stringify(summarized, null, 2);
    if (!encoded || encoded === "{}" || encoded === "[]" || encoded === "null") {
      return null;
    }
    return routeCNormalizeToolCallBodyString(
      encoded,
      ROUTEC_TOOL_CALL_BODY_SUMMARY_LIMIT
    );
  } catch {
    return null;
  }
}

function routeCToolCallCommandBodyFromInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const command = routeCFirstNonEmptyString([
    input.command,
    input.cmd,
    input.shell_command,
  ]);
  if (!command) return null;
  const cwd = routeCNormalizeToolCallBodyString(
    routeCFirstNonEmptyString([
      input.cwd,
      input.working_directory,
      input.workingDir,
    ]) || "",
    ROUTEC_TOOL_CALL_BODY_VALUE_LIMIT
  );
  const safeCommand = routeCNormalizeToolCallBodyString(
    command,
    ROUTEC_TOOL_CALL_BODY_VALUE_LIMIT
  );
  if (!safeCommand) return null;
  const lines = [safeCommand];
  if (cwd && cwd !== "." && cwd !== safeCommand) lines.push(`cwd: ${cwd}`);
  return routeCTruncateToolCallBodyText(
    lines.join("\n"),
    ROUTEC_TOOL_CALL_BODY_SUMMARY_LIMIT
  );
}

function routeCToolCallBodyFromInput(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") {
    return routeCNormalizeToolCallBodyString(
      input,
      ROUTEC_TOOL_CALL_BODY_SUMMARY_LIMIT
    );
  }
  const commandBody = routeCToolCallCommandBodyFromInput(input);
  if (commandBody) return commandBody;
  return routeCJsonToolCallBodyText(input);
}

function routeCToolCallBodyFromMetadata({
  toolName,
  name,
  toolCallId,
  callId,
  id,
} = {}) {
  const resolvedToolName = routeCNormalizeToolCallBodyString(
    routeCFirstNonEmptyString([toolName, name]) || "",
    ROUTEC_TOOL_CALL_BODY_VALUE_LIMIT
  );
  const resolvedToolCallId = routeCNormalizeToolCallBodyString(
    routeCFirstNonEmptyString([toolCallId, callId, id]) || "",
    ROUTEC_TOOL_CALL_BODY_VALUE_LIMIT
  );
  if (resolvedToolName && resolvedToolCallId) {
    return routeCTruncateToolCallBodyText(
      `Tool call ${resolvedToolName} (${resolvedToolCallId}).`,
      ROUTEC_TOOL_CALL_BODY_SUMMARY_LIMIT
    );
  }
  if (resolvedToolName) return `Tool call ${resolvedToolName}.`;
  if (resolvedToolCallId) return `Tool call ${resolvedToolCallId}.`;
  return null;
}

export function routeCBuildToolCallSameEventFallbackBody({
  semanticType,
  explicitBodies = [],
  toolInput,
  input,
  toolName,
  name,
  toolCallId,
  callId,
  id,
} = {}) {
  if (semanticType !== "tool.call") return null;
  const explicitBody = routeCFirstNonEmptyString(explicitBodies);
  if (explicitBody) return explicitBody;
  for (const candidate of [toolInput, input]) {
    const body = routeCToolCallBodyFromInput(candidate);
    if (body) return body;
  }
  const metadataBody = routeCToolCallBodyFromMetadata({
    toolName,
    name,
    toolCallId,
    callId,
    id,
  });
  if (metadataBody) return metadataBody;
  return routeCMatrixPreviewSemanticSummary(semanticType);
}

function routeCMatrixPreviewBody({ event, content, semanticType }) {
  const body = typeof content.body === "string" ? content.body.trim() : "";
  if (body) return body;
  const semantic = routeCMatrixSemanticPayload(content);
  const toolCallBody = routeCBuildToolCallSameEventFallbackBody({
    semanticType,
    explicitBodies: [semantic?.body],
    toolInput: semantic?.tool_input,
    input: semantic?.input ?? content?.input,
    toolName: semantic?.tool_name,
    name: semantic?.name ?? content?.name,
    toolCallId: semantic?.tool_call_id,
    callId: semantic?.call_id,
    id: semantic?.id,
  });
  if (toolCallBody) return toolCallBody;
  const filename =
    typeof content.filename === "string" ? content.filename.trim() : "";
  if (filename) return filename;
  return routeCMatrixPreviewSemanticSummary(semanticType);
}

function routeCMatrixPreviewBoundedBody({ event, content, semanticType }) {
  const body = routeCMatrixPreviewBody({ event, content, semanticType });
  if (!body) return null;
  const normalizedBody = body.replace(/\s+/g, " ").trim();
  if (
    normalizedBody.length <=
    OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_BODY_LIMIT
  ) {
    return normalizedBody;
  }
  return `${normalizedBody.slice(
    0,
    OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_BODY_LIMIT - 1
  )}…`;
}

function routeCMatrixPreviewHasAttachment(content) {
  return Boolean(
    content?.url ||
      content?.file ||
      content?.info?.mimetype ||
      content?.msgtype === "m.image" ||
      content?.msgtype === "m.video" ||
      content?.msgtype === "m.file"
  );
}

function routeCMatrixPreviewCreatedAt(event) {
  const ts = Number(event?.origin_server_ts);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts).toISOString();
}

function routeCMatrixPreviewEntry({ binding, event, index }) {
  const content = routeCMatrixEventContent(event);
  const semantic = routeCMatrixSemanticPayload(content);
  const semanticType =
    typeof semantic?.semantic_type === "string" && semantic.semantic_type.trim()
      ? semantic.semantic_type.trim()
      : null;
  const actor = getRouteCMatrixActorByUserId(binding, event?.sender);
  const senderLabel = routeCMatrixPreviewSenderLabel({
    binding,
    sender: event?.sender,
  });
  const bodyPreview = routeCMatrixPreviewBoundedBody({
    event,
    content,
    semanticType,
  });
  if (!bodyPreview) return null;
  const semanticRole = routeCMatrixPreviewRole(semanticType, actor);
  const eventIdHash = routeCMatrixPreviewHash(
    "matrix_event_id",
    event?.event_id
  );
  const text = `${senderLabel}: ${bodyPreview}`;
  return {
    id: eventIdHash || `matrix-preview-${index + 1}`,
    seq:
      Number(event?.unsigned?.routec_stream_seq) ||
      Number(event?.routec_stream_seq) ||
      index + 1,
    role: semanticRole,
    text,
    content: text,
    event_id_hash: eventIdHash,
    created_at: routeCMatrixPreviewCreatedAt(event),
    origin_server_ts: Number.isFinite(Number(event?.origin_server_ts))
      ? Number(event.origin_server_ts)
      : null,
    message_type: routeCMatrixPreviewMessageType(semanticType),
    sender_label: senderLabel,
    sender_avatar_label: senderLabel.slice(0, 1).toUpperCase(),
    semantic_role: semanticRole,
    semantic_type: semanticType,
    body_preview: bodyPreview,
    has_attachment: routeCMatrixPreviewHasAttachment(content),
    preview_source: OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_SOURCE,
    host_db_transcript_product_truth: false,
  };
}

async function readSessionSetupTranscriptPreviewViaHostMatrixFacade({
  binding,
  limit,
}) {
  const authorityRead = readRouteCMatrixReadAuthorityMessages({
    binding,
    limit,
    direction: "b",
  });
  return {
    chunk: Array.isArray(authorityRead.chunk) ? authorityRead.chunk : [],
    timeline_end: authorityRead.end || null,
    returned_event_count: Number(authorityRead.chunk?.length) || 0,
    routec_messages_checkpoint_proof:
      authorityRead.routec_messages_checkpoint_proof || null,
    read_authority_source: authorityRead.read_authority_source,
    durable_matrix_source: authorityRead.durable_matrix_source,
    facade_read_interface: authorityRead.facade_read_interface,
    host_owned_matrix_json_timeline_read:
      authorityRead.host_owned_matrix_json_timeline_read === true,
    preview_read_only: authorityRead.preview_read_only === true,
    storage_adapter_call_graph_used:
      authorityRead.storage_adapter_call_graph_used === true,
    storage_adapter_call_graph_role:
      authorityRead.storage_adapter_call_graph_role || null,
    memory_authority_cache_used:
      authorityRead.memory_authority_cache_used === true,
    memory_authority_cache_event_count:
      Number(authorityRead.memory_authority_cache_event_count) || 0,
    actual_matrix_transport: authorityRead.actual_matrix_transport || null,
    actual_synapse_client_server_request:
      authorityRead.actual_synapse_client_server_request === true,
    synapse_proxy_attempted: authorityRead.synapse_proxy_attempted === true,
    matrix_client_endpoint_equivalent:
      authorityRead.matrix_client_endpoint_equivalent,
  };
}

function buildSessionSetupTranscriptPreviewError({
  status = 404,
  errorCode,
  message,
  mode,
  sourceSessionId = null,
}) {
  return {
    ok: false,
    status,
    body: {
      ok: false,
      route: "oysterun_routec_session_setup_transcript_preview",
      marker: OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_MARKER,
      source: OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_SOURCE,
      preview_source: OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_SOURCE,
      source_session_id: sourceSessionId,
      mode,
      error_code: errorCode,
      message,
      error: message,
      mutation_performed: false,
      session_created: false,
      provider_started: false,
      copy_replay_performed: false,
      matrix_timeline_copy_or_replay_performed: false,
      host_session_created: false,
      host_db_transcript_product_truth: false,
      local_storage_adapter_product_truth: false,
      storage_adapter_call_graph_used: false,
      forbidden_storage_adapter_call_graph_used: false,
      host_owned_matrix_read_authority: true,
      read_authority_source: ROUTEC_MATRIX_READ_AUTHORITY_SOURCE,
      durable_matrix_source: ROUTEC_MATRIX_DURABLE_SOURCE,
      facade_read_interface: ROUTEC_MATRIX_READ_AUTHORITY_INTERFACE,
      matrix_client_endpoint_equivalent:
        ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT,
      host_owned_matrix_json_timeline_read: false,
      preview_read_only: true,
      direct_synapse_db_read: false,
      direct_db_read: false,
      actual_synapse_client_server_request: false,
      synapse_proxy_attempted: false,
      browser_direct_synapse_query: false,
      second_dashboard_matrix_sdk_lifecycle: false,
      raw_synapse_token_exposed: false,
      local_synapse_port_exposed: false,
      internal_matrix_storage_details_exposed: false,
    },
  };
}

async function buildSessionSetupTranscriptPreview({ binding, limit, mode }) {
  try {
    const matrixMessages =
      await readSessionSetupTranscriptPreviewViaHostMatrixFacade({
        binding,
        limit,
      });
    const chunk = Array.isArray(matrixMessages.chunk)
      ? matrixMessages.chunk
      : [];
    const messages = chunk
      .map((event, index) =>
        routeCMatrixPreviewEntry({ binding, event, index })
      )
      .filter((entry) => entry !== null);
    const matrixRoomIdHash = routeCMatrixPreviewHash(
      "matrix_room_id",
      binding.matrix_room_id
    );
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        route: "oysterun_routec_session_setup_transcript_preview",
        marker: OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_MARKER,
        source: OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_SOURCE,
        preview_source: OYSTERUN_SESSION_SETUP_TRANSCRIPT_PREVIEW_SOURCE,
        committed_transcript_truth: "matrix_room_timeline",
        matrix_client_endpoint_equivalent:
          ROUTEC_MATRIX_READ_AUTHORITY_ENDPOINT_EQUIVALENT,
        facade_read_interface:
          matrixMessages.facade_read_interface ||
          ROUTEC_MATRIX_READ_AUTHORITY_INTERFACE,
        read_authority_source:
          matrixMessages.read_authority_source ||
          ROUTEC_MATRIX_READ_AUTHORITY_SOURCE,
        durable_matrix_source:
          matrixMessages.durable_matrix_source || ROUTEC_MATRIX_DURABLE_SOURCE,
        host_owned_matrix_read_authority: true,
        host_owned_matrix_json_timeline_read:
          matrixMessages.host_owned_matrix_json_timeline_read === true,
        actual_matrix_transport:
          matrixMessages.actual_matrix_transport ||
          ROUTEC_MATRIX_DURABLE_SOURCE,
        actual_synapse_client_server_request:
          matrixMessages.actual_synapse_client_server_request === true,
        synapse_proxy_attempted:
          matrixMessages.synapse_proxy_attempted === true,
        preview_read_only: matrixMessages.preview_read_only === true,
        second_matrix_client_lifecycle_created: false,
        second_dashboard_matrix_sdk_lifecycle: false,
        host_db_transcript_product_truth: false,
        local_storage_adapter_product_truth: false,
        storage_adapter_call_graph_used:
          matrixMessages.storage_adapter_call_graph_used === true,
        storage_adapter_call_graph_role:
          matrixMessages.storage_adapter_call_graph_role || null,
        forbidden_storage_adapter_call_graph_used: false,
        memory_authority_cache_used:
          matrixMessages.memory_authority_cache_used === true,
        memory_authority_cache_event_count:
          Number(matrixMessages.memory_authority_cache_event_count) || 0,
        product_local_transcript_replay_shortcut_used: false,
        direct_synapse_db_read: false,
        direct_db_read: false,
        browser_direct_synapse_query: false,
        mutation_performed: false,
        session_created: false,
        provider_started: false,
        copy_replay_performed: false,
        matrix_timeline_copy_or_replay_performed: false,
        host_session_created: false,
        source_session_id: binding.host_session_id,
        mode,
        matrix_room_id_hash: matrixRoomIdHash,
        event_count: messages.length,
        timeline_direction: "backward_from_live",
        timeline_end: matrixMessages.timeline_end,
        source_event_count: matrixMessages.returned_event_count,
        displayable_event_count: messages.length,
        empty_reason:
          messages.length === 0 ? "no_displayable_matrix_timeline_rows" : null,
        rows: messages,
        messages,
        host_session_id: binding.host_session_id,
        limit,
        routec_matrix_actor_registry_version:
          getRouteCMatrixActorRegistry(binding).registry_version,
        routec_messages_checkpoint_proof: {
          checkpoint_token_format:
            matrixMessages.routec_messages_checkpoint_proof
              ?.checkpoint_token_format || "routec_s<N>",
          current_next_batch:
            matrixMessages.routec_messages_checkpoint_proof
              ?.current_next_batch || null,
          limit,
          returned_event_count: messages.length,
          matrix_room_id_hash: matrixRoomIdHash,
          host_session_room_binding_preserved:
            matrixMessages.routec_messages_checkpoint_proof
              ?.host_session_room_binding_preserved === true,
          read_authority_source:
            matrixMessages.routec_messages_checkpoint_proof
              ?.read_authority_source || ROUTEC_MATRIX_READ_AUTHORITY_SOURCE,
          durable_matrix_source:
            matrixMessages.routec_messages_checkpoint_proof
              ?.durable_matrix_source || ROUTEC_MATRIX_DURABLE_SOURCE,
          facade_read_interface:
            matrixMessages.routec_messages_checkpoint_proof
              ?.facade_read_interface || ROUTEC_MATRIX_READ_AUTHORITY_INTERFACE,
          host_owned_matrix_read_authority:
            matrixMessages.routec_messages_checkpoint_proof
              ?.host_owned_matrix_read_authority === true,
          host_owned_matrix_json_timeline_read:
            matrixMessages.routec_messages_checkpoint_proof
              ?.host_owned_matrix_json_timeline_read === true,
          preview_read_only:
            matrixMessages.routec_messages_checkpoint_proof
              ?.preview_read_only === true,
          storage_adapter_call_graph_used:
            matrixMessages.routec_messages_checkpoint_proof
              ?.storage_adapter_call_graph_used === true,
          storage_adapter_call_graph_role:
            matrixMessages.routec_messages_checkpoint_proof
              ?.storage_adapter_call_graph_role || null,
          memory_authority_cache_used:
            matrixMessages.routec_messages_checkpoint_proof
              ?.memory_authority_cache_used === true,
          memory_authority_cache_event_count:
            Number(
              matrixMessages.routec_messages_checkpoint_proof
                ?.memory_authority_cache_event_count
            ) || 0,
          host_db_transcript_product_truth: false,
          local_storage_adapter_product_truth: false,
          actual_synapse_client_server_request: false,
          mutation_performed: false,
        },
        raw_synapse_token_exposed: false,
        local_synapse_port_exposed: false,
        internal_matrix_storage_details_exposed: false,
      },
    };
  } catch (err) {
    const message =
      err?.message && String(err.message).trim()
        ? String(err.message).trim()
        : "Route C Matrix timeline preview is unavailable.";
    return buildSessionSetupTranscriptPreviewError({
      status: Number.isInteger(err?.status) ? err.status : 404,
      errorCode: err?.error_code || "facade_read_failed",
      message,
      mode,
      sourceSessionId: binding.host_session_id,
    });
  }
}

function parseRetryAfterHeaderMs(retryAfterHeader) {
  if (typeof retryAfterHeader !== "string" || !retryAfterHeader.trim())
    return null;
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const dateMs = Date.parse(retryAfterHeader);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

function parseMatrixRetryAfterMs(proxied) {
  const bodyRetryAfterMs = Number(proxied?.body?.retry_after_ms);
  if (Number.isFinite(bodyRetryAfterMs) && bodyRetryAfterMs >= 0) {
    return Math.ceil(bodyRetryAfterMs);
  }
  return parseRetryAfterHeaderMs(proxied?.retry_after_header);
}

function hashCleanSessionChatBindingField(kind, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

function buildCleanSessionChatPath(sessionId) {
  return `/app/sessions/${encodeURIComponent(sessionId)}/chat`;
}

function isMatrixRateLimitResponse(proxied) {
  return (
    proxied?.status === 429 || proxied?.body?.errcode === "M_LIMIT_EXCEEDED"
  );
}

function semanticRetryDefaultBackoffMs(attemptIndex) {
  return Math.min(OYSTERUN_SEMANTIC_RETRY_MAX_BACKOFF_MS, attemptIndex * 500);
}

function semanticRetryBackoffMs({ proxied, attemptIndex, totalWaitMs }) {
  const retryAfterMs = parseMatrixRetryAfterMs(proxied);
  const requestedBackoffMs =
    retryAfterMs ?? semanticRetryDefaultBackoffMs(attemptIndex);
  const normalizedRequestedBackoffMs =
    requestedBackoffMs > 0
      ? requestedBackoffMs
      : semanticRetryDefaultBackoffMs(attemptIndex);
  const remainingBudgetMs = Math.max(
    0,
    OYSTERUN_SEMANTIC_RETRY_TOTAL_WAIT_BUDGET_MS - totalWaitMs
  );
  return Math.min(
    normalizedRequestedBackoffMs,
    OYSTERUN_SEMANTIC_RETRY_MAX_BACKOFF_MS,
    remainingBudgetMs
  );
}

function waitForSemanticRetry(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function semanticTerminalReason({
  proxied,
  finalAttempt,
  retryBudgetExhausted,
}) {
  if (proxied?.status >= 200 && proxied.status < 300 && proxied?.body?.event_id)
    return null;
  if (retryBudgetExhausted)
    return "semantic_matrix_rate_limit_retry_budget_exhausted";
  if (finalAttempt && isMatrixRateLimitResponse(proxied))
    return "semantic_matrix_rate_limit_retries_exhausted";
  if (
    proxied?.status >= 200 &&
    proxied.status < 300 &&
    !proxied?.body?.event_id
  ) {
    return "semantic_matrix_send_response_missing_event_id";
  }
  return "semantic_matrix_event_not_committed";
}

async function sendSemanticEventWithRetryBackoff({
  path,
  content,
  txnId,
  binding,
  senderMatrixUserId = null,
  senderActorKey = null,
}) {
  const semanticId = content[OYSTERUN_SEMANTIC_NAMESPACE].semantic_id;
  const contentHash = hashMatrixContent(content);
  const retryLedger = [];
  let finalProxied = null;
  let totalWaitMs = 0;

  for (
    let attemptIndex = 1;
    attemptIndex <= OYSTERUN_SEMANTIC_RETRY_MAX_ATTEMPTS;
    attemptIndex += 1
  ) {
    const proxied = await routeCMatrixStorageRequest({
      req: { method: "PUT" },
      path,
      url: new URL("http://localhost/"),
      body: content,
      binding,
      senderMatrixUserId,
      senderActorKey,
    });
    finalProxied = proxied;

    const retryAfterMs = parseMatrixRetryAfterMs(proxied);
    const retryableRateLimit = isMatrixRateLimitResponse(proxied);
    const retriesUsed = attemptIndex - 1;
    const retryLimitReached =
      retriesUsed >= OYSTERUN_SEMANTIC_RETRY_MAX_RETRIES;
    const success =
      proxied.status >= 200 &&
      proxied.status < 300 &&
      Boolean(proxied.body?.event_id);
    const retryBudgetExhausted =
      retryableRateLimit &&
      !retryLimitReached &&
      totalWaitMs >= OYSTERUN_SEMANTIC_RETRY_TOTAL_WAIT_BUDGET_MS;
    const shouldRetry =
      retryableRateLimit &&
      !success &&
      !retryLimitReached &&
      !retryBudgetExhausted;
    const backoffMs = shouldRetry
      ? semanticRetryBackoffMs({ proxied, attemptIndex, totalWaitMs })
      : 0;
    const finalAttempt =
      success ||
      !shouldRetry ||
      attemptIndex === OYSTERUN_SEMANTIC_RETRY_MAX_ATTEMPTS;
    const terminalNonPassReason = finalAttempt
      ? semanticTerminalReason({
          proxied,
          finalAttempt,
          retryBudgetExhausted:
            retryBudgetExhausted || (shouldRetry && backoffMs <= 0),
        })
      : null;

    retryLedger.push({
      attempt_index: attemptIndex,
      http_status: proxied.status,
      errcode: proxied.body?.errcode || null,
      retry_after_ms: retryAfterMs,
      backoff_ms: backoffMs,
      txn_id: txnId,
      semantic_id: semanticId,
      matrix_room_id: binding.matrix_room_id,
      host_session_id: binding.host_session_id,
      matrix_user_id: binding.matrix_user_id,
      matrix_event_sender: senderMatrixUserId || binding.matrix_user_id,
      routec_matrix_actor_key: senderActorKey || "human",
      content_hash: contentHash,
      same_txn_id: true,
      same_semantic_id: true,
      same_room_id: true,
      same_host_session_id: true,
      same_matrix_user_id: true,
      same_content_hash: true,
      final_attempt: finalAttempt,
      final_event_id: proxied.body?.event_id || null,
      terminal_non_pass_reason: terminalNonPassReason,
      retry_marker: OYSTERUN_SEMANTIC_RETRY_MARKER,
      max_attempts: OYSTERUN_SEMANTIC_RETRY_MAX_ATTEMPTS,
      max_retries: OYSTERUN_SEMANTIC_RETRY_MAX_RETRIES,
      max_backoff_ms: OYSTERUN_SEMANTIC_RETRY_MAX_BACKOFF_MS,
      total_wait_budget_ms: OYSTERUN_SEMANTIC_RETRY_TOTAL_WAIT_BUDGET_MS,
      fake_row_injected: false,
      direct_dom_injection: false,
      direct_cinny_store_injection: false,
      host_only_transcript_truth: false,
      foundation_pass_claimed: false,
      raw_synapse_token_exposed: false,
    });

    if (!shouldRetry || backoffMs <= 0) break;
    totalWaitMs += backoffMs;
    await waitForSemanticRetry(backoffMs);
  }

  if (
    finalProxied?.status >= 200 &&
    finalProxied.status < 300 &&
    typeof finalProxied.body?.event_id === "string"
  ) {
    const recordReadAuthorityEvent = () =>
      recordRouteCMatrixReadAuthorityEvent({
        binding,
        eventId: finalProxied.body.event_id,
        eventType: "m.room.message",
        senderMatrixUserId,
        senderActorKey,
        content,
        txnId,
      });
    if (!deferRouteCMatrixStorageBatchSideEffect(recordReadAuthorityEvent)) {
      recordReadAuthorityEvent();
    }
  }

  return {
    proxied: finalProxied,
    retryLedger,
    retryProof: {
      retry_marker: OYSTERUN_SEMANTIC_RETRY_MARKER,
      max_attempts: OYSTERUN_SEMANTIC_RETRY_MAX_ATTEMPTS,
      max_retries: OYSTERUN_SEMANTIC_RETRY_MAX_RETRIES,
      max_backoff_ms: OYSTERUN_SEMANTIC_RETRY_MAX_BACKOFF_MS,
      total_wait_budget_ms: OYSTERUN_SEMANTIC_RETRY_TOTAL_WAIT_BUDGET_MS,
      total_wait_ms: totalWaitMs,
      attempt_count: retryLedger.length,
      txn_id: txnId,
      semantic_id: semanticId,
      matrix_room_id: binding.matrix_room_id,
      host_session_id: binding.host_session_id,
      matrix_user_id: binding.matrix_user_id,
      matrix_event_sender: senderMatrixUserId || binding.matrix_user_id,
      routec_matrix_actor_key: senderActorKey || "human",
      content_hash: contentHash,
      same_txn_id: true,
      same_semantic_id: true,
      same_room_id: true,
      same_host_session_id: true,
      same_matrix_user_id: true,
      same_content_hash: true,
      final_event_id: finalProxied?.body?.event_id || null,
      terminal_non_pass_reason:
        retryLedger.at(-1)?.terminal_non_pass_reason || null,
      fake_row_injected: false,
      direct_dom_injection: false,
      direct_cinny_store_injection: false,
      host_only_transcript_truth: false,
      foundation_pass_claimed: false,
      raw_synapse_token_exposed: false,
    },
  };
}

function responseStatusClass(responseStatus) {
  if (responseStatus >= 200 && responseStatus < 300) return "success";
  if (responseStatus >= 400 && responseStatus < 500) return "client_error";
  if (responseStatus >= 500) return "server_error";
  return "other";
}

function facadeTokenHashOrNull(tokenRecord) {
  if (!tokenRecord?.access_token) return null;
  return hashFacadeToken(tokenRecord.access_token);
}

function buildRouteCPublicVersionsBody() {
  return {
    versions: [
      "r0.6.1",
      "v1.1",
      "v1.2",
      "v1.3",
      "v1.4",
      "v1.5",
      "v1.6",
      "v1.7",
      "v1.8",
    ],
    unstable_features: {
      "org.oysterun.routec.matrix_facade": true,
    },
  };
}

function isRouteCPublicVersionsDiscoveryRequest(req, path) {
  return req.method === "GET" && path === "/_matrix/client/versions";
}

function isRouteCPhase1PublicLoginFlowsRequest(req, path) {
  return req.method === "GET" && path === OYSTERUN_PUBLIC_LOGIN_FLOWS_PATH;
}

function isRouteCPhase1PublicRegisterDisabledRequest(req, path) {
  return req.method === "POST" && path === OYSTERUN_PUBLIC_REGISTER_PATH;
}

function isRouteCMsc2965AuthMetadataRequest(req, path) {
  return req.method === "GET" && path === OYSTERUN_MSC2965_AUTH_METADATA_PATH;
}

function isRouteCMsc2965AuthIssuerRequest(req, path) {
  return req.method === "GET" && path === OYSTERUN_MSC2965_AUTH_ISSUER_PATH;
}

function buildRouteCPublicVersionsDiscoveryProof({ req, path }) {
  return {
    method: req.method,
    path,
    endpoint_key: "GET /_matrix/client/versions",
    endpoint_class: "supported_public_versions",
    allowlist_decision: "allow_unauthenticated_public_versions",
    host_action: "serve_public_matrix_versions_without_synapse_proxy",
    public_discovery_marker: OYSTERUN_PUBLIC_VERSIONS_DISCOVERY_MARKER,
    auth_required: false,
    auth_present: false,
    auth_result: "not_required_for_public_versions",
    facade_token_required: false,
    facade_token_hash: null,
    host_session_id: null,
    matrix_room_id: null,
    matrix_user_id: null,
    requested_matrix_room_id: null,
    bound_matrix_room_id: null,
    requested_matrix_user_id: null,
    bound_matrix_user_id: null,
    request_scope: "public_matrix_discovery_endpoint",
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    browser_storage_raw_synapse_token: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function buildRouteCPhase1PublicLoginFlowsBody() {
  return {
    flows: [
      {
        type: "m.login.password",
      },
    ],
  };
}

function buildRouteCPhase1PublicRegisterDisabledBody() {
  return matrixJsonError(
    "M_FORBIDDEN",
    "Registration is disabled for Route C Phase 1."
  );
}

function normalizeRouteCPhase1SessionRouteSource(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!OYSTERUN_ALLOWED_CINNY_SESSION_ROUTE_SOURCES.has(trimmed)) return null;
  return trimmed;
}

function buildRouteCPhase1PublicLoginFlowsProof({ req, path }) {
  return {
    method: req.method,
    path,
    endpoint_key: `GET ${OYSTERUN_PUBLIC_LOGIN_FLOWS_PATH}`,
    endpoint_class: "supported_public_login_flows",
    allowlist_decision: "allow_unauthenticated_public_login_flows",
    host_action: "serve_public_matrix_login_flows_without_synapse_proxy",
    public_auth_flow_marker: OYSTERUN_PUBLIC_LOGIN_FLOWS_MARKER,
    response_body_shape: "flows_password_only",
    flows_count: 1,
    login_flow_types: ["m.login.password"],
    auth_required: false,
    auth_present: requestHasBearerAuth(req),
    auth_result: "not_required_for_public_login_flows",
    facade_token_required: false,
    facade_token_hash: null,
    host_session_created: false,
    host_session_id: null,
    matrix_room_id: null,
    matrix_user_id: null,
    requested_matrix_room_id: null,
    bound_matrix_room_id: null,
    requested_matrix_user_id: null,
    bound_matrix_user_id: null,
    request_scope: "public_matrix_auth_flow_endpoint",
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    browser_storage_raw_synapse_token: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_readiness_claimed: false,
    foundation_pass_claimed: false,
    pass_claimed: false,
  };
}

function buildRouteCPhase1HostScopedCinnySessionBootstrapProof({
  req,
  path,
  sessionRouteSource,
  session,
  binding,
  credential,
  placeholders,
}) {
  const hostOrigin = hostOriginFromRequest(req);
  const requestOrigin =
    typeof req.headers.origin === "string" ? req.headers.origin : null;
  return {
    route: OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_ROUTE,
    method: req.method,
    path,
    endpoint_key: `POST ${OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_PATH}`,
    endpoint_class: "host_scoped_cinny_session_bootstrap_existing_host_session",
    allowlist_decision:
      "allow_existing_host_session_bootstrap_without_raw_credentials",
    host_action:
      "issue_oysterun_facade_token_for_existing_host_session_without_login_or_registration",
    bootstrap_marker: OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_MARKER,
    session_route_source: sessionRouteSource,
    host_origin: hostOrigin,
    request_origin: requestOrigin,
    same_origin_request: !requestOrigin || requestOrigin === hostOrigin,
    host_session_id: binding.host_session_id,
    host_agent_id: binding.host_agent_id,
    host_session_name: session.sessionName || null,
    matrix_room_id: binding.matrix_room_id,
    matrix_room_ready: binding.matrix_room_ready,
    matrix_user_id: binding.matrix_user_id,
    routec_matrix_actor_registry: binding.routec_matrix_actor_registry,
    routec_facade_sender_actor_key: credential.routeCFacadeSenderActorKey,
    routec_facade_sender_restriction: credential.routeCFacadeSenderRestriction,
    semantic_role_is_sender: false,
    committed_transcript_truth: binding.committed_transcript_truth,
    binding_source: binding.binding_source,
    binding_store_path: getRouteCMatrixBindingStorePath(),
    artifact_root: placeholders.artifact_root,
    base_url_is_host_origin: credential.baseUrl === hostOrigin,
    token_kind: credential.tokenKind,
    token_prefix: "oysterun_facade_",
    raw_token_retained_in_artifact: false,
    raw_credentials_retained_in_artifact: false,
    raw_synapse_token_exposed: false,
    browser_storage_raw_synapse_token: false,
    login_credential_typed: false,
    credential_entry_or_submission: false,
    successful_matrix_password_login: false,
    api_backdoor_session_created: false,
    host_session_created: false,
    registration_enabled: false,
    registration_session_created: false,
    synthetic_account_created: false,
    matrix_event_committed: false,
    composer_send_attempted: false,
    provider_proof_attempted: false,
    host2_runtime_proof_claimed: false,
    matrix_intake_runtime_proof_claimed: false,
    foundation_readiness_claimed: false,
    pass_claimed: false,
  };
}

function buildRouteCPhase1PublicRegisterDisabledProof({ req, path }) {
  return {
    method: req.method,
    path,
    endpoint_key: `POST ${OYSTERUN_PUBLIC_REGISTER_PATH}`,
    endpoint_class: "registration_disabled_fail_closed",
    allowlist_decision: "disable_public_registration_no_account_creation",
    host_action:
      "reject_registration_without_synapse_proxy_or_session_creation",
    public_auth_flow_marker: OYSTERUN_PUBLIC_REGISTER_DISABLED_MARKER,
    response_errcode: "M_FORBIDDEN",
    registration_enabled: false,
    registration_session_created: false,
    guest_registration_allowed: false,
    request_body_present: requestHasBodyHeaders(req),
    request_body_read: false,
    request_body_redacted: requestHasBodyHeaders(req)
      ? "[not_read_registration_disabled_probe]"
      : null,
    auth_required: false,
    auth_present: requestHasBearerAuth(req),
    auth_result: "not_required_for_registration_disabled_probe",
    facade_token_required: false,
    facade_token_hash: null,
    host_session_created: false,
    host_session_id: null,
    matrix_room_id: null,
    matrix_user_id: null,
    requested_matrix_room_id: null,
    bound_matrix_room_id: null,
    requested_matrix_user_id: null,
    bound_matrix_user_id: null,
    request_scope: "public_matrix_registration_disabled_probe",
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    browser_storage_raw_synapse_token: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_readiness_claimed: false,
    foundation_pass_claimed: false,
    pass_claimed: false,
  };
}

function requestHasBearerAuth(req) {
  const authHeader = req.headers["authorization"];
  return (
    typeof authHeader === "string" && authHeader.trim().startsWith("Bearer ")
  );
}

function requestHasBodyHeaders(req) {
  const contentLength = req.headers["content-length"];
  if (typeof contentLength === "string") {
    const parsedLength = Number.parseInt(contentLength, 10);
    return Number.isFinite(parsedLength) && parsedLength > 0;
  }
  const transferEncoding = req.headers["transfer-encoding"];
  return typeof transferEncoding === "string" && transferEncoding.trim() !== "";
}

function buildRouteCMsc2965AuthMetadataNegativeProof({ req, path }) {
  return {
    method: req.method,
    path,
    endpoint_key: `GET ${OYSTERUN_MSC2965_AUTH_METADATA_PATH}`,
    endpoint_class: "blocked_msc2965_auth_metadata_fail_closed",
    class: "blocked_msc2965_auth_metadata_fail_closed",
    allowlist_decision: "blocked_msc2965_auth_metadata_fail_closed",
    host_action: "reject_without_synapse_proxy",
    msc2965_auth_metadata_negative_proof_marker:
      OYSTERUN_MSC2965_AUTH_METADATA_NEGATIVE_PROOF_MARKER,
    auth_required: false,
    auth_present: requestHasBearerAuth(req),
    auth_result: "not_required_for_blocked_msc2965_auth_metadata_fail_closed",
    facade_token_required: false,
    facade_token_hash: null,
    host_session_id: null,
    matrix_room_id: null,
    matrix_user_id: null,
    requested_matrix_room_id: null,
    bound_matrix_room_id: null,
    requested_matrix_user_id: null,
    bound_matrix_user_id: null,
    requested_event_type: null,
    requested_txn_id: null,
    requested_host_session_id: null,
    bound_host_session_id: null,
    request_scope: "msc2965_auth_metadata_startup_discovery",
    oidc_metadata_synthesized: false,
    oidc_support_claimed: false,
    wildcard_unstable_support_claimed: false,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    browser_storage_raw_synapse_token: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function buildRouteCMsc2965AuthMetadataFailClosedBody(proof) {
  return {
    ...matrixJsonError(
      "M_UNRECOGNIZED",
      "MSC2965 auth metadata is not supported by the Route C Spike 0 Matrix facade."
    ),
    ...proof,
    endpoint_classification: proof,
  };
}

function buildRouteCMsc2965AuthIssuerNegativeProof({ req, path }) {
  return {
    method: req.method,
    path,
    endpoint_key: `GET ${OYSTERUN_MSC2965_AUTH_ISSUER_PATH}`,
    endpoint_class: "blocked_msc2965_auth_issuer_fail_closed",
    class: "blocked_msc2965_auth_issuer_fail_closed",
    allowlist_decision: "blocked_msc2965_auth_issuer_fail_closed",
    host_action: "reject_without_synapse_proxy",
    msc2965_auth_issuer_negative_proof_marker:
      OYSTERUN_MSC2965_AUTH_ISSUER_NEGATIVE_PROOF_MARKER,
    auth_required: false,
    auth_present: requestHasBearerAuth(req),
    auth_result: "not_required_for_blocked_msc2965_auth_issuer_fail_closed",
    facade_token_required: false,
    facade_token_hash: null,
    host_session_id: null,
    matrix_room_id: null,
    matrix_user_id: null,
    requested_matrix_room_id: null,
    bound_matrix_room_id: null,
    requested_matrix_user_id: null,
    bound_matrix_user_id: null,
    requested_event_type: null,
    requested_txn_id: null,
    requested_host_session_id: null,
    bound_host_session_id: null,
    request_scope: "msc2965_auth_issuer_startup_discovery",
    oidc_issuer_synthesized: false,
    oidc_metadata_synthesized: false,
    oidc_support_claimed: false,
    wildcard_unstable_support_claimed: false,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    browser_storage_raw_synapse_token: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function buildRouteCMsc2965AuthIssuerFailClosedBody(proof) {
  return {
    ...matrixJsonError(
      "M_UNRECOGNIZED",
      "MSC2965 auth issuer discovery is not supported by the Route C Spike 0 Matrix facade."
    ),
    ...proof,
    endpoint_classification: proof,
  };
}

function logRouteCMsc2965AuthMetadataFailClosedTranscript({
  req,
  path,
  responseBody,
}) {
  const proof = buildRouteCMsc2965AuthMetadataNegativeProof({ req, path });
  appendFacadeTranscriptArtifact({
    at: new Date().toISOString(),
    ...facadeRequestIdProofFields(req),
    ...proof,
    request_body_present: false,
    request_body_redacted: null,
    filter_id_source: null,
    requested_filter_id: null,
    bound_filter_id: null,
    sync_filter_handling_decision: null,
    response_status: 501,
    response_status_class: "server_error",
    response_body_redacted: redactMatrixResponseBody(responseBody),
  });
  writeEndpointAllowlistProof({
    endpoint: proof.endpoint_key,
    decision: proof.allowlist_decision,
    blocked_endpoint_negative_proof: proof,
  });
  writeRouteCJsonArtifact("msc2965_auth_metadata_negative_proof.json", {
    checked_at: new Date().toISOString(),
    matrix_style_error: true,
    response_status: 501,
    response_errcode: "M_UNRECOGNIZED",
    rejection_reason: "blocked_msc2965_auth_metadata_fail_closed",
    ...proof,
  });
  writeRouteCJsonArtifact("unauthorized_negative_proof.json", {
    checked_at: new Date().toISOString(),
    matrix_style_error: true,
    response_status: 501,
    response_errcode: "M_UNRECOGNIZED",
    rejection_reason: "blocked_msc2965_auth_metadata_fail_closed",
    ...proof,
  });
}

function logRouteCMsc2965AuthIssuerFailClosedTranscript({
  req,
  path,
  responseBody,
}) {
  const proof = buildRouteCMsc2965AuthIssuerNegativeProof({ req, path });
  appendFacadeTranscriptArtifact({
    at: new Date().toISOString(),
    ...facadeRequestIdProofFields(req),
    ...proof,
    request_body_present: false,
    request_body_redacted: null,
    filter_id_source: null,
    requested_filter_id: null,
    bound_filter_id: null,
    sync_filter_handling_decision: null,
    response_status: 501,
    response_status_class: "server_error",
    response_body_redacted: redactMatrixResponseBody(responseBody),
  });
  writeEndpointAllowlistProof({
    endpoint: proof.endpoint_key,
    decision: proof.allowlist_decision,
    blocked_endpoint_negative_proof: proof,
  });
  writeRouteCJsonArtifact("msc2965_auth_issuer_negative_proof.json", {
    checked_at: new Date().toISOString(),
    matrix_style_error: true,
    response_status: 501,
    response_errcode: "M_UNRECOGNIZED",
    rejection_reason: "blocked_msc2965_auth_issuer_fail_closed",
    ...proof,
  });
}

function logRouteCPublicVersionsDiscoveryTranscript({
  req,
  path,
  responseBody,
}) {
  const proof = buildRouteCPublicVersionsDiscoveryProof({ req, path });
  appendFacadeTranscriptArtifact({
    at: new Date().toISOString(),
    ...facadeRequestIdProofFields(req),
    ...proof,
    request_body_present: false,
    request_body_redacted: null,
    filter_id_source: null,
    requested_filter_id: null,
    bound_filter_id: null,
    sync_filter_handling_decision: null,
    requested_host_session_id: null,
    bound_host_session_id: null,
    response_status: 200,
    response_status_class: "success",
    response_body_redacted: redactMatrixResponseBody(responseBody),
  });
  writeEndpointAllowlistProof({
    endpoint: "GET /_matrix/client/versions",
    decision: proof.allowlist_decision,
    public_versions_discovery_proof: proof,
  });
  writeRouteCJsonArtifact(
    "matrix_facade_public_versions_discovery_proof.json",
    {
      checked_at: new Date().toISOString(),
      response_versions_count: responseBody.versions.length,
      unstable_feature_keys: Object.keys(responseBody.unstable_features || {}),
      ...proof,
    }
  );
}

function logRouteCPhase1PublicLoginFlowsTranscript({
  req,
  path,
  responseBody,
}) {
  const proof = buildRouteCPhase1PublicLoginFlowsProof({ req, path });
  appendFacadeTranscriptArtifact({
    at: new Date().toISOString(),
    ...facadeRequestIdProofFields(req),
    ...proof,
    request_body_present: false,
    request_body_redacted: null,
    filter_id_source: null,
    requested_filter_id: null,
    bound_filter_id: null,
    sync_filter_handling_decision: null,
    requested_host_session_id: null,
    bound_host_session_id: null,
    response_status: 200,
    response_status_class: "success",
    response_body_redacted: redactMatrixResponseBody(responseBody),
  });
  writeEndpointAllowlistProof({
    endpoint: proof.endpoint_key,
    decision: proof.allowlist_decision,
    public_login_flows_proof: proof,
  });
  writeRouteCJsonArtifact("matrix_auth_flow_login_proof.json", {
    checked_at: new Date().toISOString(),
    response_status: 200,
    ...proof,
  });
}

function logRouteCPhase1PublicRegisterDisabledTranscript({
  req,
  path,
  responseBody,
}) {
  const proof = buildRouteCPhase1PublicRegisterDisabledProof({ req, path });
  appendFacadeTranscriptArtifact({
    at: new Date().toISOString(),
    ...facadeRequestIdProofFields(req),
    ...proof,
    filter_id_source: null,
    requested_filter_id: null,
    bound_filter_id: null,
    sync_filter_handling_decision: null,
    requested_host_session_id: null,
    bound_host_session_id: null,
    response_status: 403,
    response_status_class: "client_error",
    response_body_redacted: redactMatrixResponseBody(responseBody),
  });
  writeEndpointAllowlistProof({
    endpoint: proof.endpoint_key,
    decision: proof.allowlist_decision,
    public_register_disabled_proof: proof,
  });
  writeRouteCJsonArtifact("matrix_auth_flow_register_disabled_proof.json", {
    checked_at: new Date().toISOString(),
    matrix_style_error: true,
    response_status: 403,
    ...proof,
  });
}

function proofFieldFromResponseBody(responseBody, fieldName, fallback = null) {
  if (!isObject(responseBody)) return fallback;
  if (Object.prototype.hasOwnProperty.call(responseBody, fieldName))
    return responseBody[fieldName];
  if (
    isObject(responseBody.endpoint_classification) &&
    Object.prototype.hasOwnProperty.call(
      responseBody.endpoint_classification,
      fieldName
    )
  ) {
    return responseBody.endpoint_classification[fieldName];
  }
  if (
    isObject(responseBody.routec_noop_endpoint_proof) &&
    Object.prototype.hasOwnProperty.call(
      responseBody.routec_noop_endpoint_proof,
      fieldName
    )
  ) {
    return responseBody.routec_noop_endpoint_proof[fieldName];
  }
  if (
    isObject(responseBody.routec_filter_proof) &&
    Object.prototype.hasOwnProperty.call(
      responseBody.routec_filter_proof,
      fieldName
    )
  ) {
    return responseBody.routec_filter_proof[fieldName];
  }
  if (
    isObject(responseBody.routec_sync_filter_proof) &&
    Object.prototype.hasOwnProperty.call(
      responseBody.routec_sync_filter_proof,
      fieldName
    )
  ) {
    return responseBody.routec_sync_filter_proof[fieldName];
  }
  return fallback;
}

function endpointAllowlistDecision(endpointClass) {
  if (endpointClass === "supported") return "allowlisted_explicit";
  if (endpointClass === "blocked_media_wildcard_rejected")
    return "blocked_media_wildcard_rejected";
  if (endpointClass === "blocked_send_event_type_not_allowlisted") {
    return "blocked_send_event_type_not_allowlisted";
  }
  if (endpointClass === "blocked_crypto_security_contract_required") {
    return "blocked_crypto_security_contract_required";
  }
  if (endpointClass === "blocked_room_state_member_read_not_allowlisted") {
    return "blocked_room_state_member_read_not_allowlisted";
  }
  return "blocked_unknown_matrix_endpoint_fail_closed";
}

function endpointHostAction(endpointClass) {
  if (endpointClass === "supported")
    return "handle_allowlisted_matrix_facade_endpoint";
  return "reject_without_synapse_proxy";
}

function blockedEndpointRequestedProofFields({ req, path, tokenRecord }) {
  const roomScope = extractRoomScopedPathParts(path);
  const userScope = extractUserScopedPathParts(path);
  const filterCreateParts = extractUserFilterCreatePathParts(path);
  const filterReadParts = extractUserFilterReadPathParts(path);
  const typingParts = extractTypingPathParts(path);
  const roomSendMatch = path.match(
    /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/([^/]+)\/([^/]+)$/
  );
  return {
    requested_matrix_room_id: roomScope?.roomId || null,
    bound_matrix_room_id: tokenRecord?.matrix_room_id || null,
    requested_matrix_user_id:
      userScope?.userId ||
      filterCreateParts?.userId ||
      filterReadParts?.userId ||
      typingParts?.userId ||
      null,
    bound_matrix_user_id: tokenRecord?.matrix_user_id || null,
    requested_event_type: roomSendMatch
      ? decodeURIComponent(roomSendMatch[2])
      : null,
    requested_txn_id: roomSendMatch
      ? decodeURIComponent(roomSendMatch[3])
      : null,
    request_scope:
      roomScope?.scope || userScope?.scope || "matrix_facade_endpoint",
  };
}

function buildBlockedEndpointNegativeProof({
  req,
  path,
  endpointClass,
  tokenRecord,
}) {
  const requestedProof = blockedEndpointRequestedProofFields({
    req,
    path,
    tokenRecord,
  });
  return {
    method: req.method,
    path,
    class: endpointClass,
    endpoint_key: matrixEndpointKey(req, path),
    allowlist_decision: endpointAllowlistDecision(endpointClass),
    host_action: endpointHostAction(endpointClass),
    host_session_id: tokenRecord?.host_session_id || null,
    matrix_room_id: tokenRecord?.matrix_room_id || null,
    matrix_user_id: tokenRecord?.matrix_user_id || null,
    facade_token_hash: facadeTokenHashOrNull(tokenRecord),
    ...requestedProof,
    supported_endpoints: SUPPORTED_MATRIX_ENDPOINTS,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
  };
}

function logFacadeTranscript({
  req,
  path,
  endpointClass,
  requestBody,
  responseStatus,
  responseBody,
  tokenRecord,
}) {
  const requestedProof = blockedEndpointRequestedProofFields({
    req,
    path,
    tokenRecord,
  });
  appendFacadeTranscriptArtifact({
    at: new Date().toISOString(),
    ...facadeRequestIdProofFields(req),
    method: req.method,
    path,
    endpoint_key: matrixEndpointKey(req, path),
    endpoint_class: endpointClass,
    allowlist_decision: proofFieldFromResponseBody(
      responseBody,
      "allowlist_decision",
      endpointAllowlistDecision(endpointClass)
    ),
    host_action: proofFieldFromResponseBody(
      responseBody,
      "host_action",
      endpointHostAction(endpointClass)
    ),
    host_session_id: tokenRecord?.host_session_id || null,
    matrix_room_id: tokenRecord?.matrix_room_id || null,
    matrix_user_id: tokenRecord?.matrix_user_id || null,
    facade_token_hash: facadeTokenHashOrNull(tokenRecord),
    ...requestedProof,
    request_body_present: requestBody !== null,
    request_body_redacted: requestBody
      ? redactMatrixRequestBody(requestBody)
      : null,
    filter_id_source: proofFieldFromResponseBody(
      responseBody,
      "filter_id_source",
      null
    ),
    requested_filter_id: proofFieldFromResponseBody(
      responseBody,
      "requested_filter_id",
      null
    ),
    bound_filter_id: proofFieldFromResponseBody(
      responseBody,
      "bound_filter_id",
      null
    ),
    sync_filter_handling_decision: proofFieldFromResponseBody(
      responseBody,
      "sync_filter_handling_decision",
      null
    ),
    requested_host_session_id: proofFieldFromResponseBody(
      responseBody,
      "requested_host_session_id",
      null
    ),
    bound_host_session_id: proofFieldFromResponseBody(
      responseBody,
      "bound_host_session_id",
      null
    ),
    response_status: responseStatus,
    response_status_class: responseStatusClass(responseStatus),
    response_body_redacted: redactMatrixResponseBody(responseBody),
    synapse_proxy_attempted: proofFieldFromResponseBody(
      responseBody,
      "synapse_proxy_attempted",
      endpointClass === "supported" ? null : false
    ),
    browser_direct_synapse_dependency: proofFieldFromResponseBody(
      responseBody,
      "browser_direct_synapse_dependency",
      false
    ),
    host_outbox_correlation_created: proofFieldFromResponseBody(
      responseBody,
      "host_outbox_correlation_created",
      null
    ),
    matrix_event_committed: proofFieldFromResponseBody(
      responseBody,
      "matrix_event_committed",
      null
    ),
    cinny_timeline_row_created: proofFieldFromResponseBody(
      responseBody,
      "cinny_timeline_row_created",
      null
    ),
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: proofFieldFromResponseBody(
      responseBody,
      "foundation_pass_claimed",
      false
    ),
  });
}

function boundedRedactedMatrixValue(value, { key = null, depth = 0 } = {}) {
  if (key === "access_token" && value) return "[redacted]";
  if (typeof value === "string") {
    if (value.length <= ROUTEC_FACADE_TRANSCRIPT_MAX_STRING_CHARS) {
      return value;
    }
    return {
      routec_transcript_truncated_string: true,
      original_length: value.length,
      prefix: value.slice(0, ROUTEC_FACADE_TRANSCRIPT_MAX_STRING_CHARS),
    };
  }
  if (!value || typeof value !== "object") return value;
  if (depth >= ROUTEC_FACADE_TRANSCRIPT_MAX_DEPTH) {
    return {
      routec_transcript_truncated_depth: true,
      value_kind: Array.isArray(value) ? "array" : "object",
      item_count: Array.isArray(value) ? value.length : Object.keys(value).length,
    };
  }
  if (Array.isArray(value)) {
    const visible = value
      .slice(0, ROUTEC_FACADE_TRANSCRIPT_MAX_ARRAY_ITEMS)
      .map((entry) =>
        boundedRedactedMatrixValue(entry, { depth: depth + 1 })
      );
    if (value.length > visible.length) {
      visible.push({
        routec_transcript_truncated_array: true,
        original_length: value.length,
        omitted_items: value.length - visible.length,
      });
    }
    return visible;
  }

  const result = {};
  const entries = Object.entries(value);
  for (const [entryKey, entryValue] of entries.slice(
    0,
    ROUTEC_FACADE_TRANSCRIPT_MAX_OBJECT_KEYS
  )) {
    result[entryKey] = boundedRedactedMatrixValue(entryValue, {
      key: entryKey,
      depth: depth + 1,
    });
  }
  if (entries.length > ROUTEC_FACADE_TRANSCRIPT_MAX_OBJECT_KEYS) {
    result.routec_transcript_truncated_object = true;
    result.routec_transcript_original_key_count = entries.length;
    result.routec_transcript_omitted_key_count =
      entries.length - ROUTEC_FACADE_TRANSCRIPT_MAX_OBJECT_KEYS;
  }
  return result;
}

function normalizeFacadeTranscriptPositiveInteger(value, fallback) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : Number.parseInt(value, 10);
  return parsed > 0 ? parsed : fallback;
}

function resolveFacadeTranscriptArtifactConfig() {
  const config = readConfig();
  return {
    enabled:
      config.debug_host_artifact_writes_enabled === true &&
      config.debug_routec_facade_transcript_enabled === true,
    rotate: config.debug_routec_facade_transcript_rotation_enabled !== false,
    maxBytes: normalizeFacadeTranscriptPositiveInteger(
      config.debug_routec_facade_transcript_max_bytes,
      ROUTEC_FACADE_TRANSCRIPT_DEFAULT_MAX_BYTES
    ),
    maxFiles: normalizeFacadeTranscriptPositiveInteger(
      config.debug_routec_facade_transcript_max_files,
      ROUTEC_FACADE_TRANSCRIPT_DEFAULT_MAX_FILES
    ),
  };
}

function appendFacadeTranscriptArtifact(payload) {
  return safelyRunOptionalRouteCArtifact(
    () => {
      const artifactConfig = resolveFacadeTranscriptArtifactConfig();
      if (!artifactConfig.enabled) return null;
      return appendRouteCJsonlArtifact(ROUTEC_FACADE_TRANSCRIPT_ARTIFACT, payload, {
          rotate: artifactConfig.rotate,
          maxBytes: artifactConfig.maxBytes,
          maxFiles: artifactConfig.maxFiles,
        }
      );
    },
    {
      surface: "matrix_facade_transcript",
      artifact: ROUTEC_FACADE_TRANSCRIPT_ARTIFACT,
      request_path: payload?.path || null,
      request_id: payload?.facade_request_id || null,
    }
  );
}

function routeCAuthLossDiagnosticsEnabled(config = readConfig()) {
  return config.debug_routec_auth_loss_diagnostics_enabled === true;
}

function routeCChatLivenessDiagnosticsEnabled(config = readConfig()) {
  return config.debug_routec_chat_liveness_diagnostics_enabled === true;
}

function boundedDiagnosticString(value, maxLength = 500) {
  const normalized = Array.isArray(value) ? value.join(", ") : value;
  if (typeof normalized !== "string") return null;
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}...`
    : trimmed;
}

function isAllowedRouteCAuthLossDiagnosticOrigin(requestOrigin, hostOrigin) {
  if (!requestOrigin || requestOrigin === hostOrigin) return true;
  return (
    requestOrigin === "capacitor://localhost" ||
    requestOrigin === "ionic://localhost"
  );
}

function normalizeRouteCClientDiagnosticEvent(body) {
  const event =
    body && typeof body === "object" && !Array.isArray(body)
      ? boundedDiagnosticString(body.event, 120)
      : null;
  if (event && /^[a-z0-9_.:-]+$/i.test(event)) return event;
  return "routec_client_auth_loss_diagnostic";
}

function routeCRequestDiagnosticFields(req) {
  return {
    pid: process.pid,
    process_started_at: ROUTEC_PROCESS_STARTED_AT,
    process_uptime_ms: Math.round(process.uptime() * 1000),
    user_agent: boundedDiagnosticString(req.headers["user-agent"]),
    origin: boundedDiagnosticString(req.headers.origin),
    referer: boundedDiagnosticString(req.headers.referer),
    x_forwarded_for: boundedDiagnosticString(req.headers["x-forwarded-for"]),
    x_forwarded_host: boundedDiagnosticString(req.headers["x-forwarded-host"]),
    x_forwarded_proto: boundedDiagnosticString(req.headers["x-forwarded-proto"]),
    remote_address: boundedDiagnosticString(req.socket?.remoteAddress),
    raw_secret_material_exposed: false,
  };
}

function appendRouteCAuthLossDiagnostic(payload) {
  return safelyRunOptionalRouteCArtifact(
    () => {
      const config = readConfig();
      if (!routeCAuthLossDiagnosticsEnabled(config)) return null;
      return appendRouteCJsonlArtifact(
        ROUTEC_AUTH_LOSS_DIAGNOSTIC_ARTIFACT,
        {
          at: new Date().toISOString(),
          routec_auth_loss_diagnostic_schema: "routec.auth_loss_diagnostic.v1",
          ...payload,
          raw_secret_material_exposed: false,
        },
        {
          rotate: config.debug_routec_facade_transcript_rotation_enabled !== false,
          maxBytes: config.debug_routec_facade_transcript_max_bytes,
          maxFiles: config.debug_routec_facade_transcript_max_files,
        }
      );
    },
    {
      surface: "matrix_facade_auth_loss_diagnostic",
      artifact: ROUTEC_AUTH_LOSS_DIAGNOSTIC_ARTIFACT,
      event: payload?.event || null,
      request_path: payload?.request_path || null,
    }
  );
}

function redactMatrixRequestBody(body) {
  return boundedRedactedMatrixValue(body);
}

function redactMatrixResponseBody(body) {
  return boundedRedactedMatrixValue(body);
}

function writeUnauthorizedNegativeProof({
  req,
  path,
  reason,
  requestedRoomId = null,
  boundRoomId = null,
  requestedUserId = null,
  boundUserId = null,
  authDiagnostics = null,
}) {
  return safelyRunOptionalRouteCArtifact(
    () =>
      writeRouteCJsonArtifact("unauthorized_negative_proof.json", {
        checked_at: new Date().toISOString(),
        request_method: req.method,
        request_path: path,
        matrix_style_error: true,
        rejection_reason: reason,
        requested_matrix_room_id: requestedRoomId,
        bound_matrix_room_id: boundRoomId,
        requested_matrix_user_id: requestedUserId,
        bound_matrix_user_id: boundUserId,
        ...(routeCAuthLossDiagnosticsEnabled() && authDiagnostics
          ? {
              presented_token_kind: authDiagnostics.presented_token_kind,
              presented_facade_token_hash:
                authDiagnostics.presented_facade_token_hash,
              active_facade_token_count:
                authDiagnostics.active_facade_token_count,
              active_facade_token_hashes:
                authDiagnostics.active_facade_token_hashes,
            }
          : {}),
        synapse_proxy_attempted: false,
        host_outbox_correlation_created: false,
        matrix_event_committed: false,
        cinny_timeline_row_created: false,
        raw_synapse_token_exposed: false,
      }),
    {
      surface: "matrix_facade_unauthorized_negative_proof",
      artifact: "unauthorized_negative_proof.json",
      request_path: path,
      rejection_reason: reason,
    }
  );
}

function writeEndpointAllowlistProof(payload) {
  return safelyRunOptionalRouteCArtifact(
    () =>
      writeRouteCJsonArtifact(
        "matrix_facade_endpoint_allowlist_proof.json",
        {
          checked_at: new Date().toISOString(),
          route: "oysterun_matrix_facade_explicit_endpoint_allowlist",
          raw_synapse_token_exposed: false,
          foundation_pass_claimed: false,
          ...payload,
        }
      ),
    {
      surface: "matrix_facade_endpoint_allowlist_proof",
      artifact: "matrix_facade_endpoint_allowlist_proof.json",
      endpoint: payload?.endpoint || null,
    }
  );
}

function recordOptionalMatrixFacadeSideEffect(operation, context = {}) {
  return safelyRunOptionalRouteCArtifact(operation, {
    surface: "matrix_facade_optional_side_effect",
    ...context,
  });
}

function respondRouteCMatrixFacadeInternalError({ req, res, path, respond, err }) {
  const facadeRequestId = getRouteCFacadeRequestId(req);
  appendHostRuntimeDiagnostic({
    level: "error",
    kind: "routec_matrix_facade_internal_exception",
    request_method: req?.method || null,
    request_path: path || null,
    facade_request_id: facadeRequestId,
    error: serializeRuntimeError(err),
    response_kind: res?.headersSent || res?.writableEnded ? "diagnostic_only" : "matrix_500",
  });
  console.error("[routec-matrix-facade] internal exception", {
    path,
    facade_request_id: facadeRequestId,
    error: err?.message || String(err),
  });
  if (res.headersSent || res.writableEnded) return null;
  res.setHeader("X-Oysterun-Matrix-Facade-Internal-Error", "unexpected_exception");
  return respond(res, 500, {
    ...matrixJsonError("M_UNKNOWN", "Oysterun Matrix facade internal error"),
    oysterun_diagnostic_code: "routec_matrix_facade_internal_error",
    facade_request_id: facadeRequestId,
    raw_secret_material_exposed: false,
  });
}

function rejectWrongBoundRoom({
  req,
  path,
  endpointClass,
  requestBody,
  tokenRecord,
  requestedRoomId,
  respond,
  res,
}) {
  const body = {
    ...matrixJsonError(
      "M_FORBIDDEN",
      "Route C Matrix facade token is bound to a different Matrix room."
    ),
    endpoint_classification: {
      method: req.method,
      path,
      class: endpointClass,
      authorization: "bound_room_mismatch",
      requested_matrix_room_id: requestedRoomId,
      bound_matrix_room_id: tokenRecord.matrix_room_id,
      synapse_proxy_attempted: false,
      host_outbox_correlation_created: false,
    },
  };
  writeUnauthorizedNegativeProof({
    req,
    path,
    reason: "bound_room_mismatch",
    requestedRoomId,
    boundRoomId: tokenRecord.matrix_room_id,
  });
  logFacadeTranscript({
    req,
    path,
    endpointClass,
    requestBody,
    responseStatus: 403,
    responseBody: body,
    tokenRecord,
  });
  return respond(res, 403, body);
}

function rejectWrongBoundUser({
  req,
  path,
  endpointClass,
  requestBody,
  tokenRecord,
  requestedUserId,
  respond,
  res,
}) {
  const body = {
    ...matrixJsonError(
      "M_FORBIDDEN",
      "Route C Matrix facade token is bound to a different Matrix user."
    ),
    endpoint_classification: {
      method: req.method,
      path,
      class: endpointClass,
      authorization: "bound_user_mismatch",
      requested_matrix_user_id: requestedUserId,
      bound_matrix_user_id: tokenRecord.matrix_user_id,
      synapse_proxy_attempted: false,
      host_outbox_correlation_created: false,
    },
  };
  writeUnauthorizedNegativeProof({
    req,
    path,
    reason: "bound_user_mismatch",
    requestedUserId,
    boundUserId: tokenRecord.matrix_user_id,
  });
  logFacadeTranscript({
    req,
    path,
    endpointClass,
    requestBody,
    responseStatus: 403,
    responseBody: body,
    tokenRecord,
  });
  return respond(res, 403, body);
}

function roomMapOnlyBoundRoom(roomMap, boundRoomId) {
  if (!isObject(roomMap)) {
    return {
      roomMap: {},
      removedRoomIds: [],
      boundRoomPresent: false,
    };
  }
  const roomIds = Object.keys(roomMap);
  const boundRoomPresent = Object.prototype.hasOwnProperty.call(
    roomMap,
    boundRoomId
  );
  const nextMap = boundRoomPresent
    ? { [boundRoomId]: roomMap[boundRoomId] }
    : {};
  return {
    roomMap: nextMap,
    removedRoomIds: roomIds.filter((roomId) => roomId !== boundRoomId),
    boundRoomPresent,
  };
}

function filterSyncResponseToBoundRoom(responseBody, boundRoomId) {
  if (!isObject(responseBody) || !isObject(responseBody.rooms)) {
    return {
      body: responseBody,
      scopeProof: {
        sync_filter_applied: true,
        sync_rooms_present: false,
        bound_matrix_room_id: boundRoomId,
        removed_room_ids: [],
        bound_room_present: false,
      },
    };
  }
  const rooms = responseBody.rooms;
  const join = roomMapOnlyBoundRoom(rooms.join, boundRoomId);
  const invite = roomMapOnlyBoundRoom(rooms.invite, boundRoomId);
  const leave = roomMapOnlyBoundRoom(rooms.leave, boundRoomId);
  const knock = roomMapOnlyBoundRoom(rooms.knock, boundRoomId);
  const removedRoomIds = [
    ...join.removedRoomIds,
    ...invite.removedRoomIds,
    ...leave.removedRoomIds,
    ...knock.removedRoomIds,
  ];
  return {
    body: {
      ...responseBody,
      rooms: {
        ...rooms,
        join: join.roomMap,
        invite: invite.roomMap,
        leave: leave.roomMap,
        knock: knock.roomMap,
      },
    },
    scopeProof: {
      sync_filter_applied: true,
      sync_rooms_present: true,
      bound_matrix_room_id: boundRoomId,
      removed_room_ids: removedRoomIds,
      removed_room_count: removedRoomIds.length,
      bound_room_present:
        join.boundRoomPresent ||
        invite.boundRoomPresent ||
        leave.boundRoomPresent ||
        knock.boundRoomPresent,
    },
  };
}

function hashFacadeToken(accessToken) {
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error(
      "Route C startup endpoint proof requires tokenRecord.access_token"
    );
  }
  return createHash("sha256").update(accessToken).digest("hex");
}

function buildRouteCStartupEndpointProof({
  tokenRecord,
  behavior,
  syntheticReason,
}) {
  return {
    route: "oysterun_matrix_facade_depth_startup_endpoint",
    behavior,
    host_action: "synthesize_matrix_js_sdk_startup_endpoint_response",
    synthetic_reason: syntheticReason,
    facade_token_hash: hashFacadeToken(tokenRecord.access_token),
    host_session_id: tokenRecord.host_session_id,
    matrix_room_id: tokenRecord.matrix_room_id,
    matrix_user_id: tokenRecord.matrix_user_id,
    requires_host_scoped_facade_token: true,
    requires_bound_host_session: true,
    requires_bound_matrix_room: true,
    synapse_proxy_attempted: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    independent_host_transcript_truth: false,
    raw_synapse_token_exposed: false,
    browser_direct_synapse_dependency: false,
    foundation_pass_claimed: false,
  };
}

function routeCCompatibilityDisplayName(tokenRecord) {
  const userLocalpart = String(tokenRecord.matrix_user_id || "")
    .replace(/^@/, "")
    .split(":")[0]
    .replace(/[_-]+/g, " ")
    .trim();
  if (!userLocalpart) return "Host Owner";
  return userLocalpart
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function routeCActorDisplayName(actor, tokenRecord) {
  if (actor?.display_name) return actor.display_name;
  return routeCCompatibilityDisplayName(tokenRecord);
}

function buildRouteCProfileCompatibilityProof({
  tokenRecord,
  requestedUserId,
  session,
  actor,
}) {
  return {
    endpoint_family: "oysterun_profile_members_compatibility",
    endpoint_name: "GET /_matrix/client/v3/profile/:userId",
    profile_compatibility_marker: OYSTERUN_PROFILE_COMPATIBILITY_MARKER,
    response_source: "host_facade_bound_session_profile_compatibility_metadata",
    authorization:
      actor?.actor_key === "human"
        ? "requested_user_matches_bound_matrix_user"
        : "requested_user_matches_bound_room_actor",
    requested_matrix_user_id: requestedUserId,
    bound_matrix_user_id: tokenRecord.matrix_user_id,
    matrix_event_sender: actor?.matrix_user_id || tokenRecord.matrix_user_id,
    routec_matrix_actor_key: actor?.actor_key || "human",
    routec_matrix_actor_kind: actor?.actor_kind || "human",
    routec_matrix_actor_display_name: routeCActorDisplayName(
      actor,
      tokenRecord
    ),
    routec_matrix_actor_registry_version:
      getRouteCMatrixActorRegistry(tokenRecord).registry_version,
    facade_send_restricted_to_human_actor: true,
    host_session_id: tokenRecord.host_session_id,
    bound_host_session_id: tokenRecord.host_session_id,
    matrix_room_id: tokenRecord.matrix_room_id,
    bound_matrix_room_id: tokenRecord.matrix_room_id,
    live_host_session_required: true,
    live_host_session_present: Boolean(session),
    requires_host_scoped_facade_token: true,
    requires_bound_host_session: true,
    requires_bound_matrix_room: true,
    requires_bound_matrix_user: actor?.actor_key === "human",
    requires_bound_room_actor: actor?.actor_key !== "human",
    compatibility_metadata_not_transcript_truth: true,
    chat_transcript_truth_source: "matrix_room_timeline",
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    timeline_row_created: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_readiness_claimed: false,
    foundation_pass_claimed: false,
    pass_claimed: false,
    facade_token_hash: hashFacadeToken(tokenRecord.access_token),
  };
}

function buildRouteCProfileCompatibilityBody({ tokenRecord, actor }) {
  return {
    displayname: routeCActorDisplayName(actor, tokenRecord),
    avatar_url: "",
  };
}

function buildRouteCMembersCompatibilityProof({
  tokenRecord,
  requestedRoomId,
  url,
  session,
  chunk,
}) {
  return {
    endpoint_family: "oysterun_profile_members_compatibility",
    endpoint_name: "GET /_matrix/client/v3/rooms/:roomId/members",
    members_compatibility_marker: OYSTERUN_MEMBERS_COMPATIBILITY_MARKER,
    response_source: "host_facade_bound_room_members_compatibility_metadata",
    authorization: "requested_room_matches_bound_matrix_room",
    requested_matrix_room_id: requestedRoomId,
    bound_matrix_room_id: tokenRecord.matrix_room_id,
    host_session_id: tokenRecord.host_session_id,
    bound_host_session_id: tokenRecord.host_session_id,
    matrix_user_id: tokenRecord.matrix_user_id,
    bound_matrix_user_id: tokenRecord.matrix_user_id,
    routec_matrix_actor_registry_version:
      getRouteCMatrixActorRegistry(tokenRecord).registry_version,
    routec_matrix_actor_count: chunk.length,
    live_host_session_required: true,
    live_host_session_present: Boolean(session),
    accepted_query_shape: {
      not_membership_values: url.searchParams.getAll("not_membership"),
      at_present: url.searchParams.has("at"),
      at_value_redacted: url.searchParams.has("at") ? "[present]" : null,
    },
    member_chunk_count: chunk.length,
    member_state_keys: chunk.map((event) => event.state_key),
    senders_needed_for_timeline_replay: chunk.map((event) => event.state_key),
    requires_host_scoped_facade_token: true,
    requires_bound_host_session: true,
    requires_bound_matrix_room: true,
    requires_bound_matrix_user: false,
    requires_bound_room_actor_registry: true,
    compatibility_metadata_not_transcript_truth: true,
    chat_transcript_truth_source: "matrix_room_timeline",
    synthetic_chat_transcript_events_created: false,
    synapse_proxy_attempted: false,
    browser_direct_synapse_dependency: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    timeline_row_created: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_readiness_claimed: false,
    foundation_pass_claimed: false,
    pass_claimed: false,
    facade_token_hash: hashFacadeToken(tokenRecord.access_token),
  };
}

function buildRouteCMembersCompatibilityBody({ tokenRecord }) {
  const actors = getRouteCMatrixActorRegistry(tokenRecord).actors;
  return {
    chunk: actors.map((actor) => {
      const eventIdHash = createHash("sha256")
        .update(
          `${tokenRecord.matrix_room_id}\n${actor.matrix_user_id}\nroutec-members-compatibility`
        )
        .digest("hex")
        .slice(0, 32);
      return {
        type: "m.room.member",
        room_id: tokenRecord.matrix_room_id,
        sender: actor.matrix_user_id,
        state_key: actor.matrix_user_id,
        origin_server_ts: Number.isInteger(tokenRecord.issued_at_ms)
          ? tokenRecord.issued_at_ms
          : 0,
        event_id: `$routec_member_compat_${eventIdHash}:localhost`,
        content: {
          membership: "join",
          displayname: routeCActorDisplayName(actor, tokenRecord),
        },
        unsigned: {
          routec_membership_compatibility_metadata: true,
          routec_matrix_actor_key: actor.actor_key,
          routec_matrix_actor_kind: actor.actor_kind,
          routec_matrix_actor_sender_source: actor.sender_source,
          compatibility_metadata_not_transcript_truth: true,
          chat_transcript_truth_source: "matrix_room_timeline",
        },
      };
    }),
  };
}

function buildRouteCBoundRoomFilter(tokenRecord) {
  return {
    event_fields: [
      "type",
      "event_id",
      "sender",
      "origin_server_ts",
      "content",
      "room_id",
      "unsigned",
    ],
    room: {
      rooms: [tokenRecord.matrix_room_id],
      timeline: {
        limit: 30,
        lazy_load_members: true,
      },
      state: {
        lazy_load_members: true,
      },
      ephemeral: {
        types: [],
      },
      account_data: {
        types: [],
      },
    },
    presence: {
      types: [],
    },
    account_data: {
      types: [],
    },
  };
}

function buildRouteCFilterProof({
  tokenRecord,
  userId,
  filterId,
  action,
  accepted,
}) {
  return {
    action,
    endpoint_family: "oysterun_bound_user_filter",
    host_session_id: tokenRecord.host_session_id,
    requested_host_session_id: tokenRecord.host_session_id,
    bound_host_session_id: tokenRecord.host_session_id,
    matrix_user_id: userId,
    requested_matrix_user_id: userId,
    bound_matrix_user_id: tokenRecord.matrix_user_id,
    matrix_room_id: tokenRecord.matrix_room_id,
    requested_matrix_room_id: null,
    bound_matrix_room_id: tokenRecord.matrix_room_id,
    filter_id: filterId,
    filter_id_source: OYSTERUN_BOUND_ROOM_FILTER_ID_SOURCE,
    accepted,
    requires_host_scoped_facade_token: true,
    requires_bound_host_session: true,
    requires_bound_matrix_room: true,
    requires_bound_matrix_user: true,
    synapse_proxy_attempted: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
    facade_token_hash: hashFacadeToken(tokenRecord.access_token),
  };
}

function buildRouteCSyncFilterProof({
  tokenRecord,
  requestedFilterId,
  handlingDecision,
  accepted,
  synapseProxyAttempted,
  syntheticFilterForwardedUnchanged,
}) {
  return {
    action: "handle_bound_room_sync_filter",
    endpoint_family: "oysterun_bound_sync_filter",
    sync_filter_handling_decision: handlingDecision,
    requested_filter_id: requestedFilterId,
    bound_filter_id: OYSTERUN_BOUND_ROOM_FILTER_ID,
    filter_id_source:
      requestedFilterId === OYSTERUN_BOUND_ROOM_FILTER_ID
        ? OYSTERUN_BOUND_ROOM_FILTER_ID_SOURCE
        : "client_inline_or_unknown_filter",
    accepted,
    host_session_id: tokenRecord.host_session_id,
    requested_host_session_id: tokenRecord.host_session_id,
    bound_host_session_id: tokenRecord.host_session_id,
    matrix_room_id: tokenRecord.matrix_room_id,
    requested_matrix_room_id: null,
    bound_matrix_room_id: tokenRecord.matrix_room_id,
    matrix_user_id: tokenRecord.matrix_user_id,
    requested_matrix_user_id: null,
    bound_matrix_user_id: tokenRecord.matrix_user_id,
    requires_host_scoped_facade_token: true,
    requires_bound_host_session: true,
    requires_bound_matrix_room: true,
    requires_bound_matrix_user: true,
    synapse_proxy_attempted: synapseProxyAttempted,
    synthetic_filter_forwarded_to_synapse_unchanged:
      syntheticFilterForwardedUnchanged,
    browser_direct_synapse_dependency: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
    facade_token_hash: hashFacadeToken(tokenRecord.access_token),
  };
}

function isRouteCInlineSyncFilter(filterValue) {
  if (typeof filterValue !== "string") return false;
  const trimmed = filterValue.trim();
  return trimmed.startsWith("{");
}

function buildUrlWithRouteCInlineSyncFilter(url, tokenRecord) {
  const nextUrl = new URL(url.toString());
  nextUrl.searchParams.set(
    "filter",
    JSON.stringify(buildRouteCBoundRoomFilter(tokenRecord))
  );
  return nextUrl;
}

function buildRouteCNoopEndpointProof({
  tokenRecord,
  endpointName,
  details = {},
}) {
  return {
    endpoint_family: "oysterun_bound_noop_matrix_side_effect_endpoint",
    endpoint_name: endpointName,
    matrix_room_id: tokenRecord.matrix_room_id,
    matrix_user_id: tokenRecord.matrix_user_id,
    no_op_response: true,
    non_pass_support: true,
    synapse_proxy_attempted: false,
    host_outbox_correlation_created: false,
    matrix_event_committed: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    foundation_pass_claimed: false,
    facade_token_hash: hashFacadeToken(tokenRecord.access_token),
    ...details,
  };
}

function boundFacadeContextOrError({ sessionManager, tokenRecord }) {
  const session = sessionManager.getSession(tokenRecord.host_session_id);
  if (!session) {
    return {
      ok: false,
      body: {
        ...matrixJsonError(
          "M_FORBIDDEN",
          "Route C Matrix facade token is not bound to a live Host session."
        ),
        endpoint_classification: {
          authorization: "bound_host_session_missing",
          host_session_id: tokenRecord.host_session_id,
          matrix_room_id: tokenRecord.matrix_room_id,
          synapse_proxy_attempted: false,
          host_outbox_correlation_created: false,
        },
        raw_synapse_token_exposed: false,
      },
    };
  }
  if (!tokenRecord.matrix_room_id) {
    return {
      ok: false,
      body: {
        ...matrixJsonError(
          "M_FORBIDDEN",
          "Route C Matrix facade token is missing bound Matrix room context."
        ),
        endpoint_classification: {
          authorization: "bound_matrix_room_missing",
          host_session_id: tokenRecord.host_session_id,
          matrix_room_id: null,
          synapse_proxy_attempted: false,
          host_outbox_correlation_created: false,
        },
        raw_synapse_token_exposed: false,
      },
    };
  }
  return { ok: true, session };
}

function normalizeRouteCSemanticString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRouteCPositiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function routeCProviderRuntimeSemanticIdentityRequiresOrdinal(semanticType) {
  return (
    semanticType === "message.assistant" ||
    semanticType === "thinking.reasoning" ||
    String(semanticType || "").startsWith("tool.")
  );
}

function routeCStreamedAssistantDeltaKeyForRuntimeEvent(event) {
  const delivery = event?.routec_matrix_delivery;
  if (!delivery || typeof delivery !== "object") return null;
  const sessionId = normalizeRouteCSemanticString(delivery.host_session_id);
  const matrixRoomId = normalizeRouteCSemanticString(delivery.matrix_room_id);
  const sourceUserEventId = normalizeRouteCSemanticString(
    delivery.source_user_event_id
  );
  const providerId =
    normalizeRouteCSemanticString(delivery.provider_id) ||
    normalizeRouteCSemanticString(event?.provider);
  const providerTurnId =
    normalizeRouteCSemanticString(delivery.provider_turn_id) ||
    normalizeRouteCSemanticString(event?.provider_turn_id) ||
    normalizeRouteCSemanticString(event?.turn_id) ||
    normalizeRouteCSemanticString(event?.turnId) ||
    normalizeRouteCSemanticString(event?.provider_completion_turn_id) ||
    normalizeRouteCSemanticString(event?.target_turn_id);
  if (
    !sessionId ||
    !matrixRoomId ||
    !sourceUserEventId ||
    !providerId ||
    !providerTurnId
  ) {
    return null;
  }
  return {
    key: [
      sessionId,
      matrixRoomId,
      sourceUserEventId,
      providerId,
      providerTurnId,
    ].join("\u001f"),
    sessionId,
    matrixRoomId,
    sourceUserEventId,
    providerId,
    providerTurnId,
    providerTurnIdKind:
      normalizeRouteCSemanticString(delivery.provider_turn_id_kind) ||
      normalizeRouteCSemanticString(event?.provider_turn_id_kind),
    delivery,
  };
}

function routeCStreamedAssistantDeltaText(event) {
  const candidates = [
    event?.text,
    event?.delta_text,
    event?.deltaText,
    event?.body,
    event?.display_text,
    event?.semantic_body,
    event?.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === "object") return JSON.stringify(candidate);
    return String(candidate);
  }
  return "";
}

function routeCSemanticTypeForRuntimeEvent(event, forcedSemanticType = null) {
  const explicit =
    normalizeRouteCSemanticString(forcedSemanticType) ||
    normalizeRouteCSemanticString(event?.semantic_type) ||
    normalizeRouteCSemanticString(event?.semanticType);
  if (explicit === "control.cancel.request") return "control.request";
  if (explicit === "control.cancel.outcome") return "control.outcome";
  if (explicit) return explicit;
  switch (event?.type) {
    case "message.assistant":
      return "message.assistant";
    case "message.thinking":
      return "thinking.reasoning";
    case "tool.call":
      return "tool.call";
    case "tool.update":
      return "tool.update";
    case "tool.output":
    case "stderr":
      return "tool.output";
    case "tool.result":
      return event?.is_error === true ? "tool.failure" : "tool.result";
    case "control.request":
      return "control.request";
    case "control.outcome":
      return "control.outcome";
    case "shell.start":
    case "terminal.command.started":
      return "terminal.command.started";
    case "shell.result":
    case "terminal.command.result":
      return "terminal.command.result";
    case "runtime.error":
      return "runtime.error";
    case "turn.completed":
      return "session_lifecycle";
    case "session.lifecycle":
    case "session.ready":
    case "session.exit":
      return "session_lifecycle";
    default:
      return null;
  }
}

function isRouteCPositiveSemanticType(semanticType) {
  return OYSTERUN_SEMANTIC_CATEGORIES.includes(semanticType);
}

function isRouteCCompleteNotificationCandidateSemanticType(semanticType) {
  return (
    semanticType === "message.assistant" ||
    semanticType === "tool.result" ||
    semanticType === "tool.failure" ||
    semanticType === "thinking.reasoning"
  );
}

function normalizeRouteCTerminalOutput(value) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (text.length <= OYSTERUN_TERMINAL_SEMANTIC_OUTPUT_MAX_CHARS) {
    return {
      text,
      truncated: false,
    };
  }
  return {
    text: text.slice(0, OYSTERUN_TERMINAL_SEMANTIC_OUTPUT_MAX_CHARS),
    truncated: true,
  };
}

function routeCTerminalExitCode(event) {
  if (Number.isFinite(Number(event?.exit_code))) return Number(event.exit_code);
  if (Number.isFinite(Number(event?.exitCode))) return Number(event.exitCode);
  return null;
}

function routeCTerminalDurationMs(event) {
  if (Number.isFinite(Number(event?.duration_ms))) return Number(event.duration_ms);
  if (Number.isFinite(Number(event?.duration))) return Number(event.duration);
  return null;
}

function routeCTerminalSemanticFieldsForRuntimeEvent(event, semanticType) {
  if (
    semanticType !== "terminal.command.started" &&
    semanticType !== "terminal.command.result"
  ) {
    return {};
  }
  const stdout = normalizeRouteCTerminalOutput(event?.stdout);
  const stderr = normalizeRouteCTerminalOutput(event?.stderr);
  return {
    terminal_exec_id:
      normalizeRouteCSemanticString(event?.terminal_exec_id) ||
      normalizeRouteCSemanticString(event?.exec_id),
    command: normalizeRouteCSemanticString(event?.command),
    cwd: normalizeRouteCSemanticString(event?.cwd),
    started_at: normalizeRouteCSemanticString(event?.started_at),
    completed_at: normalizeRouteCSemanticString(event?.completed_at),
    stdout: semanticType === "terminal.command.result" ? stdout.text : null,
    stderr: semanticType === "terminal.command.result" ? stderr.text : null,
    stdout_truncated:
      semanticType === "terminal.command.result" ? stdout.truncated : null,
    stderr_truncated:
      semanticType === "terminal.command.result" ? stderr.truncated : null,
    exit_code:
      semanticType === "terminal.command.result"
        ? routeCTerminalExitCode(event)
        : null,
    duration_ms:
      semanticType === "terminal.command.result"
        ? routeCTerminalDurationMs(event)
        : null,
    timed_out:
      semanticType === "terminal.command.result"
        ? event?.timed_out === true || event?.timedOut === true
        : null,
    interrupted:
      semanticType === "terminal.command.result"
        ? event?.interrupted === true
        : null,
    interrupt_reason: normalizeRouteCSemanticString(event?.interrupt_reason),
    requested_by:
      normalizeRouteCSemanticString(event?.requested_by) ||
      normalizeRouteCSemanticString(event?.actor) ||
      "host",
    normal_message_user_sent: false,
    browser_shell_execution: false,
    provider_delivery_attempted: false,
    host_db_transcript_product_truth: false,
  };
}

function routeCSemanticBodyForRuntimeEvent(event, semanticType) {
  if (event?.type === "turn.completed") {
    const explicitBody =
      normalizeRouteCSemanticString(event?.semantic_body) ||
      normalizeRouteCSemanticString(event?.body) ||
      normalizeRouteCSemanticString(event?.display_text);
    if (explicitBody) return explicitBody;
    const status = normalizeProviderCompletionStatus(event?.status);
    return `Provider turn ${status}.`;
  }
  if (semanticType === "control.request") {
    const controlKind =
      normalizeRouteCSemanticString(event?.control_kind) ||
      routeCControlKindFromSubtype(
        event?.subtype || event?.request_subtype,
        event
      ) ||
      "control";
    return `Control request ${controlKind} is awaiting action.`;
  }
  if (semanticType === "control.outcome") {
    const explicitBody =
      normalizeRouteCSemanticString(event?.semantic_body) ||
      normalizeRouteCSemanticString(event?.body) ||
      normalizeRouteCSemanticString(event?.display_text) ||
      normalizeRouteCSemanticString(event?.text);
    if (explicitBody) return explicitBody;
    const outcome =
      normalizeRouteCSemanticString(event?.outcome) ||
      normalizeRouteCSemanticString(event?.control_outcome) ||
      normalizeRouteCSemanticString(event?.cancel_outcome) ||
      "unknown";
    const controlKind =
      normalizeRouteCSemanticString(event?.control_kind) ||
      routeCControlKindFromSubtype(
        event?.subtype || event?.request_subtype,
        event
      ) ||
      "control";
    return `Control ${controlKind} outcome ${outcome}.`;
  }
  if (semanticType === "terminal.command.started") {
    const command = normalizeRouteCSemanticString(event?.command) || "unknown";
    const cwd = normalizeRouteCSemanticString(event?.cwd) || "unknown";
    return `Terminal command started.\n$ ${command}\ncwd: ${cwd}`;
  }
  if (semanticType === "terminal.command.result") {
    const command = normalizeRouteCSemanticString(event?.command) || "unknown";
    const exitCode = Number.isFinite(Number(event?.exit_code))
      ? Number(event.exit_code)
      : Number.isFinite(Number(event?.exitCode))
      ? Number(event.exitCode)
      : 1;
    const cwd = normalizeRouteCSemanticString(event?.cwd) || "unknown";
    const lines = [
      "Terminal command completed.",
      `$ ${command}`,
      `cwd: ${cwd}`,
      `exit code: ${exitCode}`,
    ];
    const stdout = normalizeRouteCTerminalOutput(event?.stdout).text;
    const stderr = normalizeRouteCTerminalOutput(event?.stderr).text;
    if (stdout) lines.push(`stdout:\n${stdout}`);
    if (stderr) lines.push(`stderr:\n${stderr}`);
    return lines.join("\n");
  }
  const toolCallBody = routeCBuildToolCallSameEventFallbackBody({
    semanticType,
    explicitBodies: [
      event?.semantic_body,
      event?.body,
      event?.display_text,
      event?.text,
      typeof event?.content === "string" ? event.content : null,
    ],
    toolInput: event?.tool_input,
    input: event?.input,
    toolName: event?.tool_name,
    name: event?.name,
    toolCallId: event?.tool_call_id,
    callId: event?.call_id,
    id: event?.id,
  });
  if (toolCallBody) return toolCallBody;
  const candidates = [
    event?.semantic_body,
    event?.body,
    event?.display_text,
    event?.text,
    event?.error,
    event?.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
    if (candidate && typeof candidate === "object")
      return JSON.stringify(candidate);
  }
  return semanticType;
}

function routeCToolSemanticFieldsForRuntimeEvent(event, semanticType) {
  if (!String(semanticType || "").startsWith("tool.")) {
    return {
      tool_name: null,
      tool_call_id: null,
      tool_input: null,
      tool_content: null,
      tool_is_error: null,
      tool_update_kind: null,
    };
  }
  const toolName =
    normalizeRouteCSemanticString(event?.tool_name) ||
    normalizeRouteCSemanticString(event?.name);
  const toolCallId =
    normalizeRouteCSemanticString(event?.tool_call_id) ||
    normalizeRouteCSemanticString(event?.call_id) ||
    normalizeRouteCSemanticString(event?.id);
  const hasToolInput =
    Object.prototype.hasOwnProperty.call(event || {}, "tool_input") ||
    Object.prototype.hasOwnProperty.call(event || {}, "input");
  const hasToolContent =
    Object.prototype.hasOwnProperty.call(event || {}, "tool_content") ||
    Object.prototype.hasOwnProperty.call(event || {}, "content") ||
    Object.prototype.hasOwnProperty.call(event || {}, "output") ||
    Object.prototype.hasOwnProperty.call(event || {}, "error");
  const toolInput = hasToolInput
    ? event.tool_input ?? event.input ?? null
    : null;
  const toolContent = hasToolContent
    ? event.tool_content ?? event.content ?? event.output ?? event.error ?? null
    : null;
  return {
    tool_name: toolName,
    tool_call_id: toolCallId,
    tool_input:
      semanticType === "tool.call" || semanticType === "tool.update"
        ? toolInput
        : null,
    tool_content: semanticType === "tool.call" ? null : toolContent,
    tool_is_error:
      semanticType === "tool.failure"
        ? true
        : typeof event?.tool_is_error === "boolean"
        ? event.tool_is_error
        : typeof event?.is_error === "boolean"
        ? event.is_error
        : null,
    tool_update_kind:
      semanticType === "tool.update"
        ? normalizeRouteCSemanticString(event?.tool_update_kind) ||
          normalizeRouteCSemanticString(event?.update_kind)
        : null,
  };
}

function routeCToolSemanticFieldsForEndpointBody(body, semanticType) {
  if (!String(semanticType || "").startsWith("tool.")) {
    return {
      tool_name: null,
      tool_call_id: null,
      tool_input: null,
      tool_content: null,
      tool_is_error: null,
      tool_update_kind: null,
    };
  }
  return {
    tool_name: body.tool_name || body.name || null,
    tool_call_id: body.tool_call_id || body.call_id || null,
    tool_input:
      semanticType === "tool.call" || semanticType === "tool.update"
        ? body.tool_input ?? body.input ?? null
        : null,
    tool_content:
      semanticType === "tool.call"
        ? null
        : body.tool_content ??
          body.content ??
          body.output ??
          body.error ??
          null,
    tool_is_error:
      semanticType === "tool.failure"
        ? true
        : typeof body.tool_is_error === "boolean"
        ? body.tool_is_error
        : typeof body.is_error === "boolean"
        ? body.is_error
        : null,
    tool_update_kind:
      semanticType === "tool.update"
        ? normalizeRouteCSemanticString(body.tool_update_kind) ||
          normalizeRouteCSemanticString(body.update_kind)
        : null,
  };
}

function routeCSemanticLifecycleForRuntimeEvent(event, semanticType) {
  const explicit =
    normalizeRouteCSemanticString(event?.semantic_lifecycle) ||
    normalizeRouteCSemanticString(event?.lifecycle) ||
    normalizeRouteCSemanticString(event?.delivery_state) ||
    normalizeRouteCSemanticString(event?.status);
  if (explicit) return explicit;
  if (semanticType === "message.assistant")
    return "provider_response_committed";
  if (event?.type === "turn.completed") return "provider_turn_completed";
  if (semanticType === "control.request") return "control_request_committed";
  if (semanticType === "control.outcome") return "control_outcome_committed";
  if (semanticType === "terminal.command.started")
    return "terminal_command_started";
  if (semanticType === "terminal.command.result")
    return "terminal_command_result";
  if (semanticType === "outbox.delivery") return "delivery_state";
  if (semanticType === "ambiguous.stalled") return "ambiguous_stalled";
  return "final";
}

function routeCSemanticIdPrefix(semanticType) {
  return String(semanticType || "semantic")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function routeCCancelOutcomeForRuntimeEvent(event, semanticType) {
  if (
    semanticType !== "control.outcome" &&
    normalizeRouteCSemanticString(event?.semantic_type) !==
      "control.cancel.outcome"
  ) {
    return normalizeRouteCSemanticString(event?.cancel_outcome);
  }
  return (
    normalizeRouteCSemanticString(event?.cancel_outcome) || "too_late_to_cancel"
  );
}

function routeCTargetUserEventForRuntimeEvent(event, delivery, semanticType) {
  return (
    normalizeRouteCSemanticString(event?.target_user_event_id) ||
    normalizeRouteCSemanticString(delivery?.target_user_event_id) ||
    normalizeRouteCSemanticString(event?.target_event_id) ||
    (normalizeRouteCSemanticString(event?.semantic_type)?.startsWith(
      "control.cancel."
    ) || normalizeRouteCSemanticString(event?.control_kind) === "cancel"
      ? normalizeRouteCSemanticString(delivery?.source_user_event_id)
      : null)
  );
}

function routeCControlKindFromSubtype(subtype, event = {}) {
  const normalized = normalizeRouteCSemanticString(subtype);
  if (!normalized) return null;
  if (OYSTERUN_CONTROL_KINDS.includes(normalized)) return normalized;
  if (normalized === "command_execution" || normalized === "commandExecution")
    return "command";
  if (normalized === "file_change" || normalized === "fileChange")
    return "patch";
  if (normalized === "permission" || normalized === "permissions_request")
    return "permissions";
  if (normalized === "user-input") return "user_input";
  if (normalized === "mcp-elicitation") return "mcp_elicitation";
  if (normalized === "exitplan" || normalized === "exit_plan_mode")
    return "exit_plan";
  if (normalized === "can_use_tool") {
    const toolName =
      normalizeRouteCSemanticString(event?.payload?.tool_name) ||
      normalizeRouteCSemanticString(event?.tool_name);
    if (["Edit", "Write", "MultiEdit"].includes(toolName)) return "patch";
    if (toolName === "Bash") return "command";
    if (toolName === "ExitPlanMode") return "exit_plan";
    return "permissions";
  }
  throw new Error(
    `Unsupported Route C provider control subtype: ${normalized}`
  );
}

function routeCIsControlSemanticType(semanticType) {
  const normalized = normalizeRouteCSemanticString(semanticType);
  return (
    normalized === "control.request" ||
    normalized === "control.outcome" ||
    normalized === "control.cancel.request" ||
    normalized === "control.cancel.outcome"
  );
}

function routeCControlKindForRuntimeEvent(event, semanticType) {
  const normalizedSemanticType = normalizeRouteCSemanticString(semanticType);
  if (!routeCIsControlSemanticType(normalizedSemanticType)) return null;
  const explicit = routeCControlKindFromSubtype(
    event?.control_kind ||
      event?.controlKind ||
      event?.subtype ||
      event?.request_subtype,
    event
  );
  if (explicit) return explicit;
  const explicitSemanticType = normalizeRouteCSemanticString(
    event?.semantic_type
  );
  if (
    normalizedSemanticType === "control.cancel.request" ||
    normalizedSemanticType === "control.cancel.outcome" ||
    explicitSemanticType === "control.cancel.request" ||
    explicitSemanticType === "control.cancel.outcome" ||
    normalizeRouteCSemanticString(event?.cancel_outcome) ||
    normalizeRouteCSemanticString(event?.control_request_id)?.startsWith(
      "routec_cancel_"
    )
  ) {
    return "cancel";
  }
  if (
    normalizedSemanticType === "control.request" ||
    normalizedSemanticType === "control.outcome"
  ) {
    throw new Error(
      `Route C ${semanticType} runtime event is missing control_kind`
    );
  }
  return null;
}

function routeCControlFamilyForKind(controlKind) {
  if (!controlKind) return null;
  if (OYSTERUN_PROVIDER_CONTROL_KINDS.has(controlKind))
    return "provider_request";
  if (OYSTERUN_SESSION_CONTROL_KINDS.has(controlKind)) return "session_control";
  throw new Error(
    `Unsupported Route C control kind for family: ${controlKind}`
  );
}

function routeCControlOriginForRuntimeEvent(event, semanticType, controlKind) {
  const explicit = normalizeRouteCSemanticString(event?.control_origin);
  if (explicit) return explicit;
  if (!controlKind) return null;
  if (semanticType === "control.outcome") return "host";
  return OYSTERUN_PROVIDER_CONTROL_KINDS.has(controlKind) ? "provider" : "user";
}

function routeCControlOutcomeForRuntimeEvent(
  event,
  semanticType,
  cancelOutcome
) {
  const candidate =
    normalizeRouteCSemanticString(event?.outcome) ||
    normalizeRouteCSemanticString(event?.control_outcome) ||
    cancelOutcome;
  if (!candidate) return null;
  const mapped =
    OYSTERUN_CONTROL_OUTCOME_COMPATIBILITY.get(candidate) || candidate;
  if (!OYSTERUN_CONTROL_OUTCOMES.includes(mapped)) {
    throw new Error(`Unsupported Route C control outcome: ${candidate}`);
  }
  if (semanticType === "control.outcome") return mapped;
  return mapped;
}

function routeCControlAllowedActionsForRuntimeEvent(
  event,
  controlKind,
  semanticType
) {
  if (Array.isArray(event?.allowed_actions)) {
    const actions = event.allowed_actions
      .map((entry) => normalizeRouteCSemanticString(entry))
      .filter(Boolean);
    if (actions.length) return actions;
  }
  if (semanticType !== "control.request") return null;
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
      throw new Error(
        `Route C control.request cannot infer allowed actions for ${
          controlKind || "missing kind"
        }`
      );
  }
}

function routeCControlTargetForRuntimeEvent(
  event,
  delivery,
  targetUserEventId,
  providerTurnId
) {
  return (
    normalizeRouteCSemanticString(event?.target_id) ||
    normalizeRouteCSemanticString(event?.target_event_id) ||
    targetUserEventId ||
    normalizeRouteCSemanticString(event?.target_turn_id) ||
    providerTurnId ||
    normalizeRouteCSemanticString(event?.request_id) ||
    normalizeRouteCSemanticString(event?.control_request_id) ||
    normalizeRouteCSemanticString(delivery?.host_session_id)
  );
}

function routeCControlOutcomeId({
  sessionId,
  controlRequestId,
  outcome,
  targetId,
}) {
  if (!controlRequestId || !outcome) return null;
  return `routec_control_outcome_${hashMatrixContent({
    host_session_id: sessionId || null,
    control_request_id: controlRequestId,
    outcome,
    target_id: targetId || null,
  }).slice(0, 32)}`;
}

function routeCMatrixSenderProof(actor) {
  return {
    matrix_event_sender: actor.matrix_user_id,
    matrix_event_sender_actor_key: actor.actor_key,
    matrix_event_sender_actor_kind: actor.actor_kind,
    matrix_event_sender_display_name: actor.display_name,
    matrix_event_sender_source: actor.sender_source,
    matrix_sender_semantic_role_distinct: true,
    semantic_role_is_sender: false,
  };
}

function routeCResolveSemanticSenderActor({
  binding,
  semanticType,
  providerId,
  controlOrigin,
  controlFamily,
}) {
  return resolveRouteCMatrixActorForSemantic({
    binding,
    semanticType,
    providerId,
    controlOrigin,
    controlFamily,
  });
}

function loopScheduleField(schedule, ...names) {
  for (const name of names) {
    const value = schedule?.[name] ?? schedule?.metadata?.[name] ?? null;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function loopSchedulePrompt(schedule) {
  return loopScheduleField(schedule, "command_text", "prompt_text", "input_text");
}

function loopSchedulePromptPreview(schedule) {
  const prompt = loopSchedulePrompt(schedule).replace(/\s+/g, " ").trim();
  if (!prompt) return "--";
  return prompt.length > 240 ? `${prompt.slice(0, 237)}...` : prompt;
}

function loopScheduleInterval(schedule) {
  return (
    loopScheduleField(schedule, "interval_token") ||
    (Number.isFinite(Number(schedule?.interval_ms))
      ? `${Math.round(Number(schedule.interval_ms) / 60000)}m`
      : "--")
  );
}

function loopScheduleEndTime(schedule) {
  return loopScheduleField(schedule, "end_at") || "No expiry";
}

function loopScheduleNextRun(schedule) {
  return loopScheduleField(schedule, "next_run_at") || "--";
}

function loopSystemMessageBody({ action, schedule }) {
  return [
    `Oysterun Loop ${action}.`,
    `Interval: ${loopScheduleInterval(schedule)}`,
    `Next run: ${loopScheduleNextRun(schedule)}`,
    `End: ${loopScheduleEndTime(schedule)}`,
    `Prompt: ${loopSchedulePromptPreview(schedule)}`,
  ].join("\n");
}

function loopExecutionMessageBody({ schedule, text }) {
  return [
    "Oysterun Loop executed.",
    `Interval: ${loopScheduleInterval(schedule)}`,
    `Prompt: ${String(text || loopSchedulePrompt(schedule)).trim()}`,
  ].join("\n");
}

function ensureLoopMatrixBinding({ session }) {
  if (!session?.id || !session?.agentId) {
    throw new Error("Loop Matrix write requires a live Host session");
  }
  let binding;
  try {
    binding = requireRouteCMatrixRoomBinding(session.id);
  } catch {
    binding = createRouteCMatrixRoomBinding({
      session,
      agentId: session.agentId,
    });
  }
  ensureRouteCMatrixRoomStorage({ binding });
  return binding;
}

function isRouteCMatrixBindingMissingError(err) {
  return /Route C Matrix room binding not found/.test(
    err?.message || String(err || "")
  );
}

export function createRouteCMatrixFacade({
  sessionManager,
  onCommittedMatrixEvent = null,
  onMatrixBindingReady = null,
  getSessionNotificationSettings = () => null,
  toolEventDetailStore = null,
}) {
  if (!sessionManager) {
    throw new Error("createRouteCMatrixFacade requires sessionManager");
  }

  const streamedAssistantDeltaBuffers = new Map();
  const streamedAssistantDeltaRuntimeIndexByKey = new Map();

  function noteStreamedAssistantDeltaRuntimeIndex(event) {
    const metadata = routeCStreamedAssistantDeltaKeyForRuntimeEvent(event);
    if (!metadata) return;
    const providerRuntimeEventIndex =
      normalizeRouteCPositiveInteger(
        event.routec_matrix_delivery?.provider_runtime_event_index
      ) || normalizeRouteCPositiveInteger(event.provider_runtime_event_index);
    if (!providerRuntimeEventIndex) return;
    const previous =
      streamedAssistantDeltaRuntimeIndexByKey.get(metadata.key) || 0;
    if (providerRuntimeEventIndex > previous) {
      streamedAssistantDeltaRuntimeIndexByKey.set(
        metadata.key,
        providerRuntimeEventIndex
      );
    }
    const buffer = streamedAssistantDeltaBuffers.get(metadata.key);
    if (
      buffer &&
      providerRuntimeEventIndex > buffer.maxProviderRuntimeEventIndex
    ) {
      buffer.maxProviderRuntimeEventIndex = providerRuntimeEventIndex;
    }
  }

  function bufferClaudeStreamedAssistantDelta(event) {
    if (event?.type !== "message.assistant" || event.delta !== true) {
      return null;
    }
    const metadata = routeCStreamedAssistantDeltaKeyForRuntimeEvent(event);
    if (!metadata || metadata.providerId !== "claude") return null;
    const deltaText = routeCStreamedAssistantDeltaText(event);
    if (!deltaText) {
      return {
        status: "semantic_delta_ignored_until_final",
        semantic_matrix_event_committed: false,
        streamed_assistant_delta_buffered: false,
        skipped_reason: "empty_assistant_delta",
        foundation_pass_claimed: false,
      };
    }
    let buffer = streamedAssistantDeltaBuffers.get(metadata.key);
    if (!buffer) {
      buffer = {
        key: metadata.key,
        sessionId: metadata.sessionId,
        matrixRoomId: metadata.matrixRoomId,
        sourceUserEventId: metadata.sourceUserEventId,
        providerId: metadata.providerId,
        providerTurnId: metadata.providerTurnId,
        providerTurnIdKind: metadata.providerTurnIdKind,
        delivery: { ...metadata.delivery },
        chunks: [],
        firstDeltaReceivedAt: new Date().toISOString(),
        lastDeltaReceivedAt: null,
        maxProviderRuntimeEventIndex:
          streamedAssistantDeltaRuntimeIndexByKey.get(metadata.key) || 0,
      };
      streamedAssistantDeltaBuffers.set(metadata.key, buffer);
    }
    buffer.chunks.push(deltaText);
    buffer.lastDeltaReceivedAt = new Date().toISOString();
    buffer.delivery = {
      ...buffer.delivery,
      ...metadata.delivery,
      semantic_type: "message.assistant",
    };
    return {
      status: "semantic_delta_buffered_until_successful_completion",
      semantic_matrix_event_committed: false,
      streamed_assistant_delta_buffered: true,
      delta_chunk_count: buffer.chunks.length,
      matrix_room_id: metadata.matrixRoomId,
      source_user_event_id: metadata.sourceUserEventId,
      provider_id: metadata.providerId,
      provider_turn_id: metadata.providerTurnId,
      provider_turn_id_kind: metadata.providerTurnIdKind,
      foundation_pass_claimed: false,
      readiness_claimed: false,
    };
  }

  function clearStreamedAssistantDeltaBufferForEvent(event) {
    const metadata = routeCStreamedAssistantDeltaKeyForRuntimeEvent(event);
    if (!metadata || metadata.providerId !== "claude") return;
    streamedAssistantDeltaBuffers.delete(metadata.key);
  }

  async function flushClaudeStreamedAssistantDeltaOnCompletion({
    event,
    writeProviderSemanticEvent,
  }) {
    if (event?.type !== "turn.completed") return null;
    const metadata = routeCStreamedAssistantDeltaKeyForRuntimeEvent(event);
    if (!metadata || metadata.providerId !== "claude") return null;
    const buffer = streamedAssistantDeltaBuffers.get(metadata.key);
    if (!buffer) {
      streamedAssistantDeltaRuntimeIndexByKey.delete(metadata.key);
      return null;
    }
    if (!isSuccessfulProviderCompletionStatus(event.status)) {
      streamedAssistantDeltaBuffers.delete(metadata.key);
      streamedAssistantDeltaRuntimeIndexByKey.delete(metadata.key);
      return {
        status: "streamed_assistant_delta_discarded_for_unsuccessful_completion",
        semantic_matrix_event_committed: false,
        streamed_assistant_delta_discarded: true,
        delta_chunk_count: buffer.chunks.length,
        provider_completion_status: normalizeProviderCompletionStatus(
          event.status
        ),
        matrix_room_id: metadata.matrixRoomId,
        source_user_event_id: metadata.sourceUserEventId,
        provider_id: metadata.providerId,
        provider_turn_id: metadata.providerTurnId,
        foundation_pass_claimed: false,
        readiness_claimed: false,
      };
    }
    const assistantBody = buffer.chunks.join("");
    if (!assistantBody) {
      streamedAssistantDeltaBuffers.delete(metadata.key);
      streamedAssistantDeltaRuntimeIndexByKey.delete(metadata.key);
      return {
        status: "streamed_assistant_delta_empty_at_completion",
        semantic_matrix_event_committed: false,
        streamed_assistant_delta_discarded: true,
        delta_chunk_count: buffer.chunks.length,
        matrix_room_id: metadata.matrixRoomId,
        source_user_event_id: metadata.sourceUserEventId,
        provider_id: metadata.providerId,
        provider_turn_id: metadata.providerTurnId,
        foundation_pass_claimed: false,
        readiness_claimed: false,
      };
    }
    const latestRuntimeIndex = Math.max(
      buffer.maxProviderRuntimeEventIndex || 0,
      streamedAssistantDeltaRuntimeIndexByKey.get(metadata.key) || 0
    );
    const providerRuntimeEventIndex = latestRuntimeIndex + 1;
    const providerTurnIdKind =
      metadata.providerTurnIdKind ||
      buffer.providerTurnIdKind ||
      "provider_reported_turn_id";
    const aggregateDelivery = {
      ...buffer.delivery,
      ...metadata.delivery,
      provider_id: metadata.providerId,
      provider_turn_id: metadata.providerTurnId,
      provider_turn_id_kind: providerTurnIdKind,
      provider_runtime_event_index: providerRuntimeEventIndex,
      semantic_type: "message.assistant",
    };
    const aggregateResult = await writeProviderSemanticEvent({
      type: "message.assistant",
      provider: metadata.providerId,
      text: assistantBody,
      provider_turn_id: metadata.providerTurnId,
      provider_turn_id_kind: providerTurnIdKind,
      provider_runtime_event_index: providerRuntimeEventIndex,
      routec_matrix_delivery: aggregateDelivery,
      routec_streamed_assistant_delta_aggregate: true,
      routec_streamed_assistant_delta_chunk_count: buffer.chunks.length,
      source_label:
        "host_provider_runtime_semantic_bridge_streamed_delta_aggregate",
      semantic_contract:
        "routec_claude_acp_streamed_assistant_delta_aggregate_v1",
    });
    if (
      aggregateResult?.status !== "provider_semantic_matrix_event_committed"
    ) {
      throw new Error(
        "Route C streamed assistant delta aggregate Matrix commit failed"
      );
    }
    streamedAssistantDeltaBuffers.delete(metadata.key);
    streamedAssistantDeltaRuntimeIndexByKey.delete(metadata.key);
    return {
      ...aggregateResult,
      routec_streamed_assistant_delta_flush: true,
      status: "streamed_assistant_delta_flushed_to_provider_semantic_matrix_event",
      semantic_matrix_event_committed: true,
      delta_chunk_count: buffer.chunks.length,
      provider_runtime_event_index: providerRuntimeEventIndex,
      assistant_content_hash: hashMatrixContent({ body: assistantBody }),
      first_delta_received_at: buffer.firstDeltaReceivedAt,
      last_delta_received_at: buffer.lastDeltaReceivedAt,
      foundation_pass_claimed: false,
      readiness_claimed: false,
    };
  }

  return {
    handleRuntimeEnvPreflight({ res, respond }) {
      return respond(res, 200, writeRouteCRuntimeEnvPreflightProof());
    },

    async handleBootstrap({ req, res, claims, body, respond }) {
      const envPreflight = writeRouteCRuntimeEnvPreflightProof();
      if (envPreflight.status !== "ready") {
        return respond(res, 503, envPreflight);
      }
      const sessionId =
        typeof body.session_id === "string" ? body.session_id.trim() : "";
      if (!sessionId) {
        return respond(res, 400, { error: "session_id required" });
      }
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return respond(res, 404, {
          error: "Route C bootstrap requires a live Host session",
        });
      }
      if (
        !claims?._dashboardAuth &&
        !claims?.agent_ids?.includes(session.agentId)
      ) {
        return respond(res, 403, {
          error: "Route C bootstrap forbidden for this session",
        });
      }
      const binding = createRouteCMatrixRoomBinding({
        session,
        agentId: session.agentId,
        requestedRoomId:
          typeof body.matrix_room_id === "string"
            ? body.matrix_room_id.trim()
            : null,
        matrixUserId:
          typeof body.matrix_user_id === "string"
            ? body.matrix_user_id.trim()
            : null,
      });
      let storageProof;
      try {
        storageProof = ensureRouteCMatrixRoomStorage({ binding });
      } catch (err) {
        return respondRouteCMatrixStorageUnavailable({ res, respond, err });
      }
      if (typeof onMatrixBindingReady === "function") {
        void onMatrixBindingReady({ binding }).catch((err) => {
          console.warn(
            `[routec] Matrix binding ready callback failed: ${
              err?.message || err
            }`
          );
        });
      }
      const notification_settings = getSessionNotificationSettings({
        sessionId: binding.host_session_id,
        matrixRoomId: binding.matrix_room_id,
      });
      const credential = issueRouteCMatrixFacadeCredential({
        binding,
        hostOrigin: hostOriginFromRequest(req),
        claims,
      });
      const placeholders = ensureRouteCSpike0ArtifactPlaceholders({
        host_session_id: binding.host_session_id,
        matrix_room_id: binding.matrix_room_id,
        matrix_room_ready: binding.matrix_room_ready,
        binding_store_path: getRouteCMatrixBindingStorePath(),
      });
      writeRouteCJsonArtifact("cinny_matrix_client_init_proof.json", {
        status: "bootstrap_ready_matrix_client_init_pending",
        host_session_id: binding.host_session_id,
        host_agent_id: binding.host_agent_id,
        matrix_room_id: binding.matrix_room_id,
        matrix_room_ready: binding.matrix_room_ready,
        routec_matrix_actor_registry: binding.routec_matrix_actor_registry,
        routec_facade_sender_actor_key: credential.routeCFacadeSenderActorKey,
        routec_facade_sender_restriction:
          credential.routeCFacadeSenderRestriction,
        base_url_is_host_origin: true,
        facade_token_kind: credential.tokenKind,
        matrix_storage: storageProof,
        routec_host_owned_matrix_storage: true,
        raw_synapse_token_exposed: false,
        browser_storage_raw_synapse_token: false,
        artifact_root: placeholders.artifact_root,
      });
      return respond(res, 200, {
        route: "oysterun_matrix_bootstrap",
        session: {
          baseUrl: credential.baseUrl,
          accessToken: credential.accessToken,
          userId: credential.userId,
          deviceId: credential.deviceId,
          expiresInMs: credential.expiresInMs,
          fallbackSdkStores: false,
        },
        binding,
        routec_matrix_actor_registry: binding.routec_matrix_actor_registry,
        routec_facade_sender_actor_key: credential.routeCFacadeSenderActorKey,
        routec_facade_sender_restriction:
          credential.routeCFacadeSenderRestriction,
        room: {
          roomId: binding.matrix_room_id,
          ready: binding.matrix_room_ready,
        },
        notification_settings,
        matrix_storage: storageProof,
        routec_host_owned_matrix_storage: true,
        artifact_root: placeholders.artifact_root,
        raw_synapse_token_exposed: false,
      });
    },

    async handleHostScopedCinnySessionBootstrap({ req, res, body, respond }) {
      const envPreflight = writeRouteCRuntimeEnvPreflightProof();
      if (envPreflight.status !== "ready") {
        return respond(res, 503, envPreflight);
      }
      if (body?.route !== OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_ROUTE) {
        return respond(res, 400, {
          error:
            "Route C host-scoped Cinny session bootstrap route marker required",
          raw_synapse_token_exposed: false,
          pass_claimed: false,
        });
      }
      const sessionRouteSource = normalizeRouteCPhase1SessionRouteSource(
        body.session_route_source
      );
      if (!sessionRouteSource) {
        return respond(res, 400, {
          error:
            "Route C host-scoped Cinny session bootstrap requires an allowed session_route_source",
          allowed_session_route_sources: [
            ...OYSTERUN_ALLOWED_CINNY_SESSION_ROUTE_SOURCES,
          ],
          raw_synapse_token_exposed: false,
          pass_claimed: false,
        });
      }
      const hostOrigin = hostOriginFromRequest(req);
      const requestOrigin =
        typeof req.headers.origin === "string" ? req.headers.origin : null;
      if (requestOrigin && requestOrigin !== hostOrigin) {
        return respond(res, 403, {
          error:
            "Route C host-scoped Cinny session bootstrap requires same-origin browser request",
          raw_synapse_token_exposed: false,
          pass_claimed: false,
        });
      }
      const sessionId =
        typeof body.session_id === "string" ? body.session_id.trim() : "";
      if (!sessionId) {
        return respond(res, 400, {
          error: "session_id required",
          raw_synapse_token_exposed: false,
          pass_claimed: false,
        });
      }
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return respond(res, 404, {
          error:
            "Route C host-scoped Cinny session bootstrap requires an existing live Host session",
          code: "live_session_missing",
          stale_clean_chat_target: true,
          host_session_created: false,
          raw_synapse_token_exposed: false,
          pass_claimed: false,
        });
      }
      const binding = createRouteCMatrixRoomBinding({
        session,
        agentId: session.agentId,
        requestedRoomId:
          typeof body.matrix_room_id === "string"
            ? body.matrix_room_id.trim()
            : null,
        matrixUserId:
          typeof body.matrix_user_id === "string"
            ? body.matrix_user_id.trim()
            : null,
      });
      let storageProof;
      try {
        storageProof = ensureRouteCMatrixRoomStorage({ binding });
      } catch (err) {
        return respondRouteCMatrixStorageUnavailable({ res, respond, err });
      }
      if (typeof onMatrixBindingReady === "function") {
        void onMatrixBindingReady({ binding }).catch((err) => {
          console.warn(
            `[routec] Matrix binding ready callback failed: ${
              err?.message || err
            }`
          );
        });
      }
      const notification_settings = getSessionNotificationSettings({
        sessionId: binding.host_session_id,
        matrixRoomId: binding.matrix_room_id,
      });
      const credential = issueRouteCMatrixFacadeCredential({
        binding,
        hostOrigin,
        claims: null,
      });
      appendRouteCAuthLossDiagnostic({
        event: "host_scoped_matrix_facade_token_issued",
        request_path: OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_PATH,
        host_session_id: binding.host_session_id,
        host_agent_id: binding.host_agent_id,
        matrix_room_id: binding.matrix_room_id,
        matrix_user_id: binding.matrix_user_id,
        issued_facade_token_hash: hashRouteCFacadeToken(
          credential.accessToken
        ),
        expires_in_ms: credential.expiresInMs,
        session_route_source: sessionRouteSource,
        ...routeCRequestDiagnosticFields(req),
      });
      const placeholders = ensureRouteCSpike0ArtifactPlaceholders({
        host_session_id: binding.host_session_id,
        matrix_room_id: binding.matrix_room_id,
        matrix_room_ready: binding.matrix_room_ready,
        binding_store_path: getRouteCMatrixBindingStorePath(),
      });
      const proof = buildRouteCPhase1HostScopedCinnySessionBootstrapProof({
        req,
        path: OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_PATH,
        sessionRouteSource,
        session,
        binding,
        credential,
        placeholders,
        matrix_storage: storageProof,
        routec_host_owned_matrix_storage: true,
      });
      writeRouteCJsonArtifact(
        "cinny_host_scoped_session_bootstrap_proof.json",
        {
          checked_at: new Date().toISOString(),
          ...proof,
        }
      );
      writeRouteCJsonArtifact("cinny_matrix_client_init_proof.json", {
        status: "bootstrap_ready_matrix_client_init_pending",
        route: OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_ROUTE,
        session_route_source: sessionRouteSource,
        host_session_id: binding.host_session_id,
        host_agent_id: binding.host_agent_id,
        matrix_room_id: binding.matrix_room_id,
        matrix_room_ready: binding.matrix_room_ready,
        routec_matrix_actor_registry: binding.routec_matrix_actor_registry,
        routec_facade_sender_actor_key: credential.routeCFacadeSenderActorKey,
        routec_facade_sender_restriction:
          credential.routeCFacadeSenderRestriction,
        base_url_is_host_origin: true,
        facade_token_kind: credential.tokenKind,
        matrix_storage: storageProof,
        routec_host_owned_matrix_storage: true,
        raw_synapse_token_exposed: false,
        browser_storage_raw_synapse_token: false,
        login_credential_typed: false,
        api_backdoor_session_created: false,
        matrix_intake_runtime_proof_claimed: false,
        foundation_readiness_claimed: false,
        pass_claimed: false,
        artifact_root: placeholders.artifact_root,
      });
      return respond(res, 200, {
        route: OYSTERUN_HOST_SCOPED_CINNY_SESSION_BOOTSTRAP_ROUTE,
        status: "ok",
        bootstrap_success: true,
        host_scoped_bootstrap_success: true,
        session: {
          baseUrl: credential.baseUrl,
          accessToken: credential.accessToken,
          userId: credential.userId,
          deviceId: credential.deviceId,
          expiresInMs: credential.expiresInMs,
          fallbackSdkStores: false,
        },
        binding,
        routec_matrix_actor_registry: binding.routec_matrix_actor_registry,
        routec_facade_sender_actor_key: credential.routeCFacadeSenderActorKey,
        routec_facade_sender_restriction:
          credential.routeCFacadeSenderRestriction,
        room: {
          roomId: binding.matrix_room_id,
          ready: binding.matrix_room_ready,
        },
        notification_settings,
        matrix_storage: storageProof,
        routec_host_owned_matrix_storage: true,
        artifact_root: placeholders.artifact_root,
        session_route_source: sessionRouteSource,
        token_kind: credential.tokenKind,
        raw_synapse_token_exposed: false,
        browser_storage_raw_synapse_token: false,
        login_credential_typed: false,
        api_backdoor_session_created: false,
        matrix_intake_runtime_proof_claimed: false,
        foundation_readiness_claimed: false,
        pass_claimed: false,
      });
    },

    async handleClientAuthLossDiagnostic({ req, res, body, respond }) {
      if (!routeCAuthLossDiagnosticsEnabled()) {
        return respond(res, 200, {
          status: "routec_auth_loss_diagnostics_disabled",
          raw_secret_material_exposed: false,
        });
      }
      const hostOrigin = hostOriginFromRequest(req);
      const requestOrigin =
        typeof req.headers.origin === "string" ? req.headers.origin : null;
      if (!isAllowedRouteCAuthLossDiagnosticOrigin(requestOrigin, hostOrigin)) {
        return respond(res, 403, {
          error:
            "Route C auth-loss diagnostics require same-origin or Capacitor bootstrap request",
          raw_secret_material_exposed: false,
        });
      }
      appendRouteCAuthLossDiagnostic({
        event: normalizeRouteCClientDiagnosticEvent(body),
        request_path: OYSTERUN_CLIENT_AUTH_LOSS_DIAGNOSTIC_PATH,
        client_payload:
          body && typeof body === "object" && !Array.isArray(body)
            ? boundedRedactedMatrixValue(body)
            : null,
        ...routeCRequestDiagnosticFields(req),
      });
      return respond(res, 200, {
        status: "routec_auth_loss_diagnostic_recorded",
        raw_secret_material_exposed: false,
      });
    },

    async handleBindingRead({ url, res, claims, respond }) {
      const sessionId =
        typeof url.searchParams.get("session_id") === "string"
          ? url.searchParams.get("session_id").trim()
          : "";
      if (!sessionId) {
        return respond(res, 400, {
          error: "session_id required",
          raw_synapse_token_exposed: false,
        });
      }
      let binding;
      let matrixStorage = null;
      let materializedFromLiveSession = false;
      try {
        binding = requireRouteCMatrixRoomBinding(sessionId);
      } catch (err) {
        if (!isRouteCMatrixBindingMissingError(err)) {
          throw err;
        }
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          return respond(res, 404, {
            error:
              err?.message ||
              "Route C Matrix binding was not found for this session",
            status: "routec_matrix_binding_missing",
            host_session_id: sessionId,
            live_session_present: false,
            raw_synapse_token_exposed: false,
            mutation_performed: false,
            session_created: false,
            provider_started: false,
          });
        }
        if (
          !claims?._dashboardAuth &&
          !claims?.agent_ids?.includes(session.agentId)
        ) {
          return respond(res, 403, {
            error: "Route C Matrix binding forbidden for this session",
            raw_synapse_token_exposed: false,
          });
        }
        binding = createRouteCMatrixRoomBinding({
          session,
          agentId: session.agentId,
        });
        matrixStorage = ensureRouteCMatrixRoomStorage({ binding });
        materializedFromLiveSession = true;
      }
      if (
        !claims?._dashboardAuth &&
        !claims?.agent_ids?.includes(binding.host_agent_id)
      ) {
        return respond(res, 403, {
          error: "Route C Matrix binding forbidden for this session",
        });
      }
      return respond(res, 200, {
        binding,
        routec_matrix_actor_registry: binding.routec_matrix_actor_registry,
        facade_token_proofs: listRouteCFacadeTokenProofs(),
        binding_store_path: getRouteCMatrixBindingStorePath(),
        matrix_storage: matrixStorage,
        routec_matrix_binding_materialized_from_live_session:
          materializedFromLiveSession,
        mutation_performed: materializedFromLiveSession,
        session_created: false,
        provider_started: false,
        raw_synapse_token_exposed: false,
      });
    },

    async handleCleanSessionChatBindingRead({ url, res, claims, respond }) {
      const sessionId = url.searchParams.get("session_id");
      let binding;
      try {
        binding = requireRouteCMatrixRoomBinding(sessionId);
      } catch (err) {
        return respond(res, 404, {
          ok: false,
          error:
            err?.message ||
            "Clean session chat binding was not found for this session",
          source: "host_session_matrix_binding",
          clean_session_route_contract: "host_session_id_only",
          host_session_id:
            typeof sessionId === "string" && sessionId.trim()
              ? sessionId.trim()
              : null,
          raw_matrix_room_id_exposed: false,
          raw_matrix_event_id_exposed: false,
          raw_synapse_token_exposed: false,
          mutation_performed: false,
          session_created: false,
          provider_started: false,
        });
      }
      if (
        !claims?._dashboardAuth &&
        !claims?.agent_ids?.includes(binding.host_agent_id)
      ) {
        return respond(res, 403, {
          ok: false,
          error: "Clean session chat binding forbidden for this session",
          source: "host_session_matrix_binding",
          raw_matrix_room_id_exposed: false,
          raw_matrix_event_id_exposed: false,
          raw_synapse_token_exposed: false,
          mutation_performed: false,
          session_created: false,
          provider_started: false,
        });
      }
      const session = sessionManager.getSession(binding.host_session_id);
      return respond(res, 200, {
        ok: true,
        route: "oysterun_clean_session_chat_binding",
        source: "host_session_matrix_binding",
        read_authority_source: "host_matrix_facade_server_side_binding",
        clean_session_route: buildCleanSessionChatPath(binding.host_session_id),
        clean_session_route_contract: "host_session_id_only",
        host_session_id: binding.host_session_id,
        host_agent_id: binding.host_agent_id,
        host_session_name:
          binding.host_session_name || session?.sessionName || null,
        matrix_room_ready: binding.matrix_room_ready === true,
        matrix_room_id_hash: hashCleanSessionChatBindingField(
          "matrix_room_id",
          binding.matrix_room_id
        ),
        matrix_room_id_exposed: false,
        raw_matrix_room_id_exposed: false,
        raw_matrix_event_id_exposed: false,
        raw_synapse_token_exposed: false,
        browser_storage_raw_synapse_token: false,
        internal_matrix_storage_details_exposed: false,
        storage_adapter_call_graph_used: false,
        host_db_transcript_product_truth: false,
        local_storage_adapter_product_truth: false,
        browser_direct_synapse_query: false,
        session_created: false,
        provider_started: false,
        copy_replay_performed: false,
        matrix_timeline_copy_or_replay_performed: false,
        mutation_performed: false,
      });
    },

    async handleSessionSetupTranscriptPreview({ url, res, claims, respond }) {
      const sessionId = url.searchParams.get("session_id");
      let mode;
      try {
        mode = normalizeSessionSetupTranscriptPreviewMode(
          url.searchParams.get("mode")
        );
      } catch (err) {
        const message =
          err?.message && String(err.message).trim()
            ? String(err.message).trim()
            : "mode must be resume or branch";
        const preview = buildSessionSetupTranscriptPreviewError({
          status: 400,
          errorCode: "invalid_mode",
          message,
          mode: null,
          sourceSessionId: sessionId,
        });
        return respond(res, preview.status, preview.body);
      }
      let binding;
      try {
        binding = requireRouteCMatrixRoomBinding(sessionId);
      } catch (err) {
        const message =
          err?.message && String(err.message).trim()
            ? String(err.message).trim()
            : "Route C Matrix room binding is unavailable for this source session.";
        const preview = buildSessionSetupTranscriptPreviewError({
          status: 404,
          errorCode: "missing_room_binding",
          message,
          mode,
          sourceSessionId: sessionId,
        });
        return respond(res, preview.status, preview.body);
      }
      if (
        !claims?._dashboardAuth &&
        !claims?.agent_ids?.includes(binding.host_agent_id)
      ) {
        const preview = buildSessionSetupTranscriptPreviewError({
          status: 403,
          errorCode: "forbidden",
          message:
            "Route C Matrix transcript preview forbidden for this session",
          mode,
          sourceSessionId: binding.host_session_id,
        });
        return respond(res, preview.status, preview.body);
      }
      const limit = normalizeSessionSetupTranscriptPreviewLimit(
        url.searchParams.get("limit")
      );
      const preview = await buildSessionSetupTranscriptPreview({
        binding,
        limit,
        mode,
      });
      return respond(res, preview.status, preview.body);
    },

    async writeProviderAssistantSemanticEventFromRuntime({ event }) {
      if (!event || event.type !== "message.assistant") {
        return null;
      }
      return this.writeProviderSemanticEventFromRuntime({
        event,
        forcedSemanticType: "message.assistant",
      });
    },

    async writeProviderSemanticEventsBatchFromRuntime({ events }) {
      if (!Array.isArray(events)) {
        throw new Error(
          "Route C provider semantic batch write requires events array"
        );
      }
      if (events.length === 0) {
        return {
          status: "provider_semantic_matrix_events_batch_empty",
          event_count: 0,
          results: [],
          routec_matrix_storage_batch_commit: true,
          durable_write_count: 0,
          per_event_full_store_write_eliminated: true,
        };
      }
      const batch = await runRouteCMatrixStorageWriteBatch(async () => {
        const results = [];
        for (const event of events) {
          results.push(
            await this.writeProviderSemanticEventFromRuntime({ event })
          );
        }
        return results;
      });
      return {
        status: "provider_semantic_matrix_events_batch_processed",
        event_count: events.length,
        results: batch.result,
        routec_matrix_storage_batch_commit:
          batch.routec_matrix_storage_batch_commit,
        storage_path: batch.storage_path,
        mutation_count: batch.mutation_count,
        durable_write_count: batch.durable_write_count,
        next_stream_seq_before: batch.next_stream_seq_before,
        next_stream_seq_after: batch.next_stream_seq_after,
        per_event_full_store_write_eliminated:
          batch.per_event_full_store_write_eliminated,
        delta_persistence_used: batch.delta_persistence_used === true,
        full_store_json_stringify_per_batch_eliminated:
          batch.full_store_json_stringify_per_batch_eliminated === true,
        full_store_snapshot_write_used:
          batch.full_store_snapshot_write_used === true,
        delta_path: batch.delta_path || null,
        delta_event_count: batch.delta_event_count || 0,
        delta_room_upsert_count: batch.delta_room_upsert_count || 0,
        delta_encoded_bytes: batch.delta_encoded_bytes || 0,
        individual_durable_matrix_events_preserved: true,
      };
    },

    async writeHostUserMessageSemanticEvent({
      session,
      text,
      nickname = "Host Owner",
      clientRequestId = null,
      sourceId = "oysterun-host",
      sourceLabel = "host_user_message_semantic_writer",
      telegram = null,
    }) {
      if (!session?.id || !session?.agentId) {
        throw new Error("Route C host user semantic write requires session");
      }
      const visibleBody = normalizeRouteCSemanticString(text);
      if (!visibleBody) {
        throw new Error("Route C host user semantic write requires text");
      }
      const binding = requireRouteCMatrixRoomBinding(session.id);
      ensureRouteCMatrixRoomStorage({ binding });
      const semanticType = "message.user";
      const semanticSenderActor =
        getRouteCMatrixActorByKey(binding, "human") ||
        routeCResolveSemanticSenderActor({
          binding,
          semanticType,
          providerId: session.provider || session.adapterId || null,
          controlOrigin: null,
          controlFamily: null,
        });
      const semanticSenderProof = routeCMatrixSenderProof(semanticSenderActor);
      const telegramProof =
        telegram && typeof telegram === "object"
          ? {
              source: "telegram",
              update_id: telegram.update_id ?? null,
              message_id: normalizeRouteCSemanticString(telegram.message_id),
              chat_id_hash:
                normalizeRouteCSemanticString(telegram.chat_id_hash) || null,
              from_id_hash:
                normalizeRouteCSemanticString(telegram.from_id_hash) || null,
              command_kind:
                normalizeRouteCSemanticString(telegram.command_kind) || null,
              token_redacted: true,
              allowed_users_redacted: true,
            }
          : null;
      const semanticHash = hashMatrixContent({
        session_id: session.id,
        matrix_room_id: binding.matrix_room_id,
        client_request_id: clientRequestId,
        body: visibleBody,
        source_id: sourceId,
        telegram: telegramProof,
      }).slice(0, 32);
      const txnId =
        normalizeRouteCSemanticString(clientRequestId) ||
        `routec_host_user_${semanticHash}`;
      const semanticId = `routec_host_user_${semanticHash}`;
      const baseContent = buildOysterunSemanticMatrixContent({
        semanticType,
        category: semanticType,
        body: visibleBody,
        semanticId,
        lifecycle: "final",
        correlation: {
          host_session_id: binding.host_session_id,
          matrix_room_id: binding.matrix_room_id,
          client_request_id: txnId,
          source_id: sourceId,
          source_label: sourceLabel,
          semantic_contract: "oysterun_host_matrix_backed_user_message",
          target_session_id: session.id,
          nickname: normalizeRouteCSemanticString(nickname) || "Host Owner",
          telegram_source: telegramProof,
          durable: true,
          replay_policy: "always",
          ...semanticSenderProof,
          direct_matrix_harness_write_used: false,
          direct_host_send_used: false,
          raw_telegram_token_exposed: false,
          telegram_allowed_users_exposed: false,
        },
      });
      const content = attachRouteCChatAssetLinkAnnotations({
        content: baseContent,
        binding,
        sessionManager,
      });
      registerRouteCOutboxCorrelation({
        hostSessionId: binding.host_session_id,
        matrixUserId: semanticSenderActor.matrix_user_id,
        matrixRoomId: binding.matrix_room_id,
        txnId,
        eventType: "m.room.message",
        clientRequestId: content[OYSTERUN_SEMANTIC_NAMESPACE].client_request_id,
        clientContent: content,
      });
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(
        binding.matrix_room_id
      )}/send/m.room.message/${encodeURIComponent(txnId)}`;
      const { proxied, retryLedger, retryProof } =
        await sendSemanticEventWithRetryBackoff({
          path,
          content,
          txnId,
          binding,
          senderMatrixUserId: semanticSenderActor.matrix_user_id,
          senderActorKey: semanticSenderActor.actor_key,
        });
      const sendCorrelation = recordRouteCSendResponse({
        matrixRoomId: binding.matrix_room_id,
        txnId,
        responseBody: proxied.body,
        forwardedContent: content,
      });
      const eventId = proxied.body?.event_id || null;
      if (
        eventId &&
        typeof onCommittedMatrixEvent === "function"
      ) {
        try {
          await onCommittedMatrixEvent({
            type: "m.room.message",
            room_id: binding.matrix_room_id,
            sender: semanticSenderActor.matrix_user_id,
            content,
            event_id: eventId,
            origin_server_ts: Date.now(),
            unsigned: {
              transaction_id: txnId,
            },
          });
        } catch (err) {
          console.warn(
            `[routec] host user Matrix commit observer failed: ${
              err?.message || err
            }`
          );
        }
      }
      return {
        status: eventId
          ? "host_user_matrix_event_committed"
          : "host_user_matrix_event_not_committed",
        semantic_matrix_event_committed: Boolean(eventId),
        matrix_room_id: binding.matrix_room_id,
        matrix_user_id: semanticSenderActor.matrix_user_id,
        event_type: "m.room.message",
        event_id: eventId,
        txn_id: txnId,
        semantic_type: semanticType,
        semantic_id: semanticId,
        semantic_retry_proof: retryProof,
        semantic_retry_ledger: retryLedger,
        matrix_host2_intake_proof: buildRouteCHost2IntakeProof(sendCorrelation),
        token_redacted: true,
        allowed_users_redacted: true,
        ...semanticSenderProof,
      };
    },

    async writeProviderSemanticEventFromRuntime({
      event,
      forcedSemanticType = null,
    }) {
      if (!event) {
        return null;
      }
      if (event.delta === true) {
        const bufferedDelta = bufferClaudeStreamedAssistantDelta(event);
        if (bufferedDelta) return bufferedDelta;
        return {
          status: "semantic_delta_ignored_until_final",
          semantic_matrix_event_committed: false,
          foundation_pass_claimed: false,
        };
      }
      const streamedAssistantDeltaFlushResult =
        event.type === "turn.completed"
          ? await flushClaudeStreamedAssistantDeltaOnCompletion({
              event,
              writeProviderSemanticEvent: (aggregateEvent) =>
                this.writeProviderSemanticEventFromRuntime({
                  event: aggregateEvent,
                }),
            })
          : null;
      if (event.type === "routec.semantic.absence") {
        return {
          status: "routec_semantic_negative_contract_absence_event_not_written",
          semantic_matrix_event_committed: false,
          semantic_negative_contract: event.negative_contract || null,
          foundation_pass_claimed: false,
          readiness_claimed: false,
        };
      }
      const semanticType = routeCSemanticTypeForRuntimeEvent(
        event,
        forcedSemanticType
      );
      if (!semanticType || !isRouteCPositiveSemanticType(semanticType)) {
        return {
          status: "routec_semantic_event_type_not_supported",
          semantic_type: semanticType,
          runtime_event_type: event.type || null,
          semantic_matrix_event_committed: false,
          foundation_pass_claimed: false,
          readiness_claimed: false,
        };
      }
      if (semanticType === "message.user") {
        return {
          status:
            "message_user_semantic_contract_uses_existing_exact_human_path_matrix_row",
          semantic_type: semanticType,
          semantic_matrix_event_committed: false,
          duplicate_user_row_created: false,
          direct_matrix_harness_write_used: false,
          foundation_pass_claimed: false,
          readiness_claimed: false,
        };
      }
      const delivery = event.routec_matrix_delivery;
      if (!delivery || typeof delivery !== "object") {
        return {
          status: "routec_matrix_delivery_context_missing",
          semantic_matrix_event_committed: false,
          foundation_pass_claimed: false,
        };
      }
      const sessionId =
        typeof delivery.host_session_id === "string"
          ? delivery.host_session_id.trim()
          : "";
      const sourceServerEventId =
        typeof delivery.source_user_event_id === "string"
          ? delivery.source_user_event_id.trim()
          : "";
      const matrixRoomId =
        typeof delivery.matrix_room_id === "string"
          ? delivery.matrix_room_id.trim()
          : "";
      if (!sessionId || !sourceServerEventId || !matrixRoomId) {
        throw new Error(
          "Route C provider semantic bridge requires exact Host session, room, and source event"
        );
      }
      const binding = requireRouteCMatrixRoomBinding(sessionId);
      if (binding.matrix_room_id !== matrixRoomId) {
        throw new Error(
          "Route C provider semantic bridge room binding mismatch"
        );
      }
      const semanticBody = routeCSemanticBodyForRuntimeEvent(
        event,
        semanticType
      );
      const providerId =
        (typeof delivery.provider_id === "string" &&
          delivery.provider_id.trim()) ||
        (typeof event.provider === "string" && event.provider.trim()) ||
        null;
      const deliveryProviderTurnId =
        typeof delivery.provider_turn_id === "string" &&
        delivery.provider_turn_id.trim()
          ? delivery.provider_turn_id.trim()
          : null;
      const eventProviderTurnId =
        typeof event.provider_turn_id === "string" &&
        event.provider_turn_id.trim()
          ? event.provider_turn_id.trim()
          : null;
      const providerTurnId =
        deliveryProviderTurnId || eventProviderTurnId || null;
      const isProviderCompletionRuntimeEvent = event.type === "turn.completed";
      if (isProviderCompletionRuntimeEvent && !providerTurnId) {
        throw new Error(
          "Route C provider completion marker requires provider_turn_id"
        );
      }
      const providerRuntimeEventIndex =
        normalizeRouteCPositiveInteger(delivery.provider_runtime_event_index) ||
        normalizeRouteCPositiveInteger(event.provider_runtime_event_index);
      const ordinalIdentityRequired =
        routeCProviderRuntimeSemanticIdentityRequiresOrdinal(semanticType);
      if (ordinalIdentityRequired && !providerTurnId) {
        throw new Error(
          "Route C provider semantic bridge requires provider_turn_id for runtime event identity"
        );
      }
      if (ordinalIdentityRequired && !providerRuntimeEventIndex) {
        throw new Error(
          "Route C provider semantic bridge requires provider_runtime_event_index for runtime event identity"
        );
      }
      noteStreamedAssistantDeltaRuntimeIndex({
        ...event,
        routec_matrix_delivery: {
          ...delivery,
          provider_runtime_event_index: providerRuntimeEventIndex,
        },
      });
      const providerTurnIdKind = providerTurnId
        ? (typeof delivery.provider_turn_id_kind === "string" &&
            delivery.provider_turn_id_kind.trim()) ||
          (typeof event.provider_turn_id_kind === "string" &&
            event.provider_turn_id_kind.trim()) ||
          "provider_reported_turn_id"
        : null;
      const targetUserEventId = routeCTargetUserEventForRuntimeEvent(
        event,
        delivery,
        semanticType
      );
      const failureClassification =
        normalizeRouteCSemanticString(event.failure_classification) ||
        normalizeRouteCSemanticString(delivery.failure_classification);
      const providerCompletionMarkerRequired =
        !failureClassification &&
        (isRouteCCompleteNotificationCandidateSemanticType(semanticType) ||
          isProviderCompletionRuntimeEvent);
      const cancelOutcome = routeCCancelOutcomeForRuntimeEvent(
        event,
        semanticType
      );
      const controlKind = routeCControlKindForRuntimeEvent(event, semanticType);
      const controlFamily =
        normalizeRouteCSemanticString(event.control_family) ||
        routeCControlFamilyForKind(controlKind);
      const controlOrigin = routeCControlOriginForRuntimeEvent(
        event,
        semanticType,
        controlKind
      );
      const controlOutcome = routeCControlOutcomeForRuntimeEvent(
        event,
        semanticType,
        cancelOutcome
      );
      const controlRequestId =
        normalizeRouteCSemanticString(event.control_request_id) ||
        normalizeRouteCSemanticString(event.request_id);
      const controlTargetId = routeCControlTargetForRuntimeEvent(
        event,
        delivery,
        targetUserEventId,
        providerTurnId
      );
      const controlOutcomeId =
        normalizeRouteCSemanticString(event.control_outcome_id) ||
        routeCControlOutcomeId({
          sessionId,
          controlRequestId,
          outcome: controlOutcome,
          targetId: controlTargetId,
        });
      const controlAllowedActions = routeCControlAllowedActionsForRuntimeEvent(
        event,
        controlKind,
        semanticType
      );
      const toolSemanticFields = routeCToolSemanticFieldsForRuntimeEvent(
        event,
        semanticType
      );
      const toolIdentityForSemanticHash = String(semanticType || "").startsWith(
        "tool."
      )
        ? {
            tool_name: toolSemanticFields.tool_name,
            tool_call_id: toolSemanticFields.tool_call_id,
            tool_input: toolSemanticFields.tool_input,
            tool_content: toolSemanticFields.tool_content,
            tool_is_error: toolSemanticFields.tool_is_error,
          }
        : null;
      const semanticContract =
        normalizeRouteCSemanticString(event.semantic_contract) ||
        normalizeRouteCSemanticString(delivery.semantic_contract) ||
        "real_codex_e2e_semantic_contract";
      const semanticSenderActor = routeCResolveSemanticSenderActor({
        binding,
        semanticType,
        providerId,
        controlOrigin,
        controlFamily,
      });
      const semanticSenderProof = routeCMatrixSenderProof(semanticSenderActor);
      const largeToolNoticeIdentityForSemanticHash =
        semanticType === "session_lifecycle" &&
        (event.large_tool_notice === true || delivery.large_tool_notice === true)
          ? {
              large_tool_notice: true,
              large_tool_notice_kind:
                normalizeRouteCSemanticString(event.large_tool_notice_kind) ||
                normalizeRouteCSemanticString(delivery.large_tool_notice_kind),
              consecutive_run_index:
                normalizeRouteCPositiveInteger(event.consecutive_run_index) ||
                normalizeRouteCPositiveInteger(delivery.consecutive_run_index),
              matrix_retained_tool_event_count:
                normalizeRouteCPositiveInteger(
                  event.matrix_retained_tool_event_count
                ) ||
                normalizeRouteCPositiveInteger(
                  delivery.matrix_retained_tool_event_count
                ),
              tool_event_count_label:
                normalizeRouteCSemanticString(event.tool_event_count_label) ||
                normalizeRouteCSemanticString(delivery.tool_event_count_label),
            }
          : null;
      const semanticIdentityHash = hashMatrixContent(
        ordinalIdentityRequired
          ? {
              session_id: sessionId,
              matrix_room_id: matrixRoomId,
              source_user_event_id: sourceServerEventId,
              semantic_type: semanticType,
              provider_turn_id: providerTurnId,
              provider_runtime_event_index: providerRuntimeEventIndex,
            }
          : {
              session_id: sessionId,
              matrix_room_id: matrixRoomId,
              source_user_event_id: sourceServerEventId,
              semantic_type: semanticType,
              provider_turn_id: providerTurnId,
              body: semanticBody,
              tool_identity: toolIdentityForSemanticHash,
              large_tool_notice_identity: largeToolNoticeIdentityForSemanticHash,
            }
      ).slice(0, 32);
      const semanticId = `routec_semantic_${routeCSemanticIdPrefix(
        semanticType
      )}_${semanticIdentityHash}`;
      const txnId = `routec_semantic_${routeCSemanticIdPrefix(
        semanticType
      )}_${semanticIdentityHash}`;
      const baseContent = buildOysterunSemanticMatrixContent({
        semanticType,
        category: semanticType,
        body: semanticBody,
        semanticId,
        lifecycle: routeCSemanticLifecycleForRuntimeEvent(event, semanticType),
        correlation: {
          host_session_id: binding.host_session_id,
          matrix_room_id: binding.matrix_room_id,
          host_outbox_id: delivery.outbox_message_id || null,
          client_request_id: txnId,
          source_user_event_id: sourceServerEventId,
          target_user_event_id: targetUserEventId,
          provider_id: providerId,
          provider_turn_id: providerTurnId,
          provider_turn_id_kind: providerTurnIdKind,
          provider_runtime_event_index: providerRuntimeEventIndex,
          provider_delivery_claim_id:
            delivery.provider_delivery_claim_id || null,
          source_id:
            normalizeRouteCSemanticString(event.source_id) ||
            providerId ||
            "oysterun-host",
          source_label:
            normalizeRouteCSemanticString(event.source_label) ||
            "host_provider_runtime_semantic_bridge",
          semantic_contract: semanticContract,
          cancel_outcome: cancelOutcome,
          control_request_id: controlRequestId,
          control_outcome_id: controlOutcomeId,
          control_kind: controlKind,
          control_family: controlFamily,
          control_origin: controlOrigin,
          control_outcome: controlOutcome,
          outcome: controlOutcome,
          actor:
            normalizeRouteCSemanticString(event.actor) ||
            (semanticType === "control.outcome" ? "host" : null),
          allowed_actions: controlAllowedActions,
          target_id: controlTargetId,
          target_turn_id:
            normalizeRouteCSemanticString(event.target_turn_id) ||
            providerTurnId,
          target_session_id:
            normalizeRouteCSemanticString(event.target_session_id) || sessionId,
          durable:
            typeof event.durable === "boolean"
              ? event.durable
              : semanticType === "control.request" ||
                semanticType === "control.outcome"
              ? true
              : null,
          replay_policy:
            normalizeRouteCSemanticString(event.replay_policy) ||
            (semanticType === "control.request"
              ? "latest_state_only"
              : semanticType === "control.outcome"
              ? "always"
              : null),
          default_action: normalizeRouteCSemanticString(event.default_action),
          expires_at: normalizeRouteCSemanticString(event.expires_at),
          sensitive:
            typeof event.sensitive === "boolean" ? event.sensitive : null,
          noop_reason: normalizeRouteCSemanticString(event.noop_reason),
          timeout_reason: normalizeRouteCSemanticString(event.timeout_reason),
          too_late_reason: normalizeRouteCSemanticString(event.too_late_reason),
          already_completed_reason: normalizeRouteCSemanticString(
            event.already_completed_reason
          ),
          already_canceled_reason: normalizeRouteCSemanticString(
            event.already_canceled_reason
          ),
          failure_classification: failureClassification,
          error_origin: normalizeRouteCSemanticString(event.error_origin),
          error_scope: normalizeRouteCSemanticString(event.error_scope),
          last_agent_message_present:
            typeof event.last_agent_message_present === "boolean"
              ? event.last_agent_message_present
              : typeof delivery.last_agent_message_present === "boolean"
              ? delivery.last_agent_message_present
              : null,
          agent_turn_started:
            event.agent_turn_started === true ||
            delivery.agent_turn_started === true,
          host2_intake_state:
            normalizeRouteCSemanticString(event.host2_intake_state) ||
            normalizeRouteCSemanticString(delivery.host2_intake_state),
          provider_receives_canceled_user_event:
            typeof event.provider_receives_canceled_user_event === "boolean"
              ? event.provider_receives_canceled_user_event
              : typeof delivery.provider_receives_canceled_user_event ===
                "boolean"
              ? delivery.provider_receives_canceled_user_event
              : null,
          provider_started_for_target_event:
            typeof event.provider_started_for_target_event === "boolean"
              ? event.provider_started_for_target_event
              : delivery.agent_turn_started === true,
          same_event_both_canceled_and_started:
            event.same_event_both_canceled_and_started === true ||
            delivery.same_event_both_canceled_and_started === true,
          duplicate_user_row_count: Number.isFinite(
            Number(event.duplicate_user_row_count)
          )
            ? Number(event.duplicate_user_row_count)
            : Number.isFinite(Number(delivery.duplicate_user_row_count))
            ? Number(delivery.duplicate_user_row_count)
            : null,
          normal_message_user_sent:
            typeof event.normal_message_user_sent === "boolean"
              ? event.normal_message_user_sent
              : null,
          provider_delivery_attempted:
            typeof event.provider_delivery_attempted === "boolean"
              ? event.provider_delivery_attempted
              : typeof delivery.provider_delivery_attempted === "boolean"
              ? delivery.provider_delivery_attempted
              : null,
          host_db_transcript_product_truth:
            typeof event.host_db_transcript_product_truth === "boolean"
              ? event.host_db_transcript_product_truth
              : null,
          outbox_delivery_state: normalizeRouteCSemanticString(
            event.outbox_delivery_state
          ),
          ambiguous_state: normalizeRouteCSemanticString(event.ambiguous_state),
          provider_completion_marker: providerCompletionMarkerRequired
            ? COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER
            : null,
          provider_completion_state: isProviderCompletionRuntimeEvent
            ? providerCompletionStateForStatus(event.status)
            : isRouteCCompleteNotificationCandidateSemanticType(semanticType)
            ? COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE
            : null,
          provider_completion_status: isProviderCompletionRuntimeEvent
            ? normalizeProviderCompletionStatus(event.status)
            : null,
          provider_completion_success: isProviderCompletionRuntimeEvent
            ? isSuccessfulProviderCompletionStatus(event.status)
            : null,
          provider_completion_success_required:
            isRouteCCompleteNotificationCandidateSemanticType(semanticType)
              ? true
              : null,
          provider_completion_turn_id:
            providerCompletionMarkerRequired || isProviderCompletionRuntimeEvent
              ? providerTurnId
              : null,
          large_tool_notice:
            event.large_tool_notice === true ||
            delivery.large_tool_notice === true,
          large_tool_notice_kind:
            normalizeRouteCSemanticString(event.large_tool_notice_kind) ||
            normalizeRouteCSemanticString(delivery.large_tool_notice_kind),
          consecutive_run_index:
            normalizeRouteCPositiveInteger(event.consecutive_run_index) ||
            normalizeRouteCPositiveInteger(delivery.consecutive_run_index),
          matrix_retained_tool_event_count:
            normalizeRouteCPositiveInteger(
              event.matrix_retained_tool_event_count
            ) ||
            normalizeRouteCPositiveInteger(
              delivery.matrix_retained_tool_event_count
            ),
          tool_event_count_label:
            normalizeRouteCSemanticString(event.tool_event_count_label) ||
            normalizeRouteCSemanticString(delivery.tool_event_count_label),
          detail_available:
            event.detail_available === true ||
            delivery.detail_available === true,
          search_indexed:
            typeof event.search_indexed === "boolean"
              ? event.search_indexed
              : typeof delivery.search_indexed === "boolean"
              ? delivery.search_indexed
              : null,
          ...semanticSenderProof,
          ...toolSemanticFields,
          direct_matrix_harness_write_used: false,
          real_codex_e2e_claimed: false,
          full_provider_parity_claimed: false,
        },
      });
      const annotatedContent = attachRouteCProviderSemanticMarkdownLinkAnnotations({
        content: baseContent,
        binding,
        sessionManager,
        semanticType,
        body: semanticBody,
      });
      const transferProjection = projectToolEventForClientTransfer({
        event: {
          type: "m.room.message",
          room_id: binding.matrix_room_id,
          content: annotatedContent,
        },
        storageKind: "host_tool_event_detail_store",
      });
      const content = transferProjection.event.content;
      if (providerRuntimeEventIndex) {
        content[OYSTERUN_SEMANTIC_NAMESPACE].provider_runtime_event_index =
          providerRuntimeEventIndex;
      }
      registerRouteCOutboxCorrelation({
        hostSessionId: binding.host_session_id,
        matrixUserId: semanticSenderActor.matrix_user_id,
        matrixRoomId: binding.matrix_room_id,
        txnId,
        eventType: "m.room.message",
        clientRequestId: content[OYSTERUN_SEMANTIC_NAMESPACE].client_request_id,
        clientContent: content,
      });
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(
        binding.matrix_room_id
      )}/send/m.room.message/${encodeURIComponent(txnId)}`;
      const { proxied, retryLedger, retryProof } =
        await sendSemanticEventWithRetryBackoff({
          path,
          content,
          txnId,
          binding,
          senderMatrixUserId: semanticSenderActor.matrix_user_id,
          senderActorKey: semanticSenderActor.actor_key,
        });
      const semanticSendCorrelation = recordRouteCSendResponse({
        matrixRoomId: binding.matrix_room_id,
        txnId,
        responseBody: proxied.body,
        forwardedContent: content,
      });
      const semanticEventId = proxied.body?.event_id || null;
      let toolDetailStoreProof = null;
      if (
        semanticEventId &&
        transferProjection.projected === true &&
        transferProjection.detail_record &&
        toolEventDetailStore &&
        typeof toolEventDetailStore.writeToolEventDetail === "function"
      ) {
        toolDetailStoreProof = toolEventDetailStore.writeToolEventDetail({
          sessionId,
          matrixRoomId: binding.matrix_room_id,
          matrixEventId: semanticEventId,
          detail: {
            ...transferProjection.detail_record,
            matrix_event_id: semanticEventId,
            detail_storage_kind: "host_tool_event_detail_store",
          },
        });
      }
      const sourceUserEventIdContentHash = hashMatrixContent({
        event_id: sourceServerEventId,
      });
      const targetUserEventIdContentHash = targetUserEventId
        ? hashMatrixContent({ event_id: targetUserEventId })
        : null;
      const semanticEventIdContentHash = semanticEventId
        ? hashMatrixContent({ event_id: semanticEventId })
        : null;
      const chatLivenessDiagnosticsEnabled =
        routeCChatLivenessDiagnosticsEnabled();
      const semanticWritePacingProof = chatLivenessDiagnosticsEnabled
        ? event.routec_semantic_write_pacing || {
            serialized_per_host_session_source_event: false,
            queue_key_present: false,
            pace_ms_after_write: 0,
          }
        : null;
      const commitStatus =
        proxied.status >= 200 && proxied.status < 300 && proxied.body?.event_id
          ? "provider_semantic_matrix_event_committed"
          : "provider_semantic_matrix_event_not_committed";
      const commitProof = {
        status: commitStatus,
        runtime_event_emitted: true,
        semantic_matrix_event_committed:
          commitStatus === "provider_semantic_matrix_event_committed",
        semantic_matrix_event_not_committed_reason:
          commitStatus === "provider_semantic_matrix_event_committed"
            ? null
            : retryProof?.terminal_non_pass_reason ||
              "semantic_matrix_event_id_missing",
        semantic_namespace: OYSTERUN_SEMANTIC_NAMESPACE,
        semantic_type: semanticType,
        semantic_id: semanticId,
        matrix_room_id: binding.matrix_room_id,
        source_user_event_id: sourceServerEventId,
        source_user_event_id_hash: sourceUserEventIdContentHash,
        source_user_event_id_hash_kind: ROUTEC_EVENT_ID_CONTENT_HASH_KIND,
        source_user_event_id_raw_hash: hashRouteCEventId(sourceServerEventId),
        source_user_event_id_raw_hash_kind: ROUTEC_RAW_EVENT_ID_HASH_KIND,
        source_user_event_id_content_hash: sourceUserEventIdContentHash,
        source_user_event_id_content_hash_kind:
          ROUTEC_EVENT_ID_CONTENT_HASH_KIND,
        target_user_event_id: targetUserEventId,
        target_user_event_id_hash: targetUserEventIdContentHash,
        target_user_event_id_hash_kind: targetUserEventId
          ? ROUTEC_EVENT_ID_CONTENT_HASH_KIND
          : null,
        target_user_event_id_raw_hash: hashRouteCEventId(targetUserEventId),
        target_user_event_id_raw_hash_kind: targetUserEventId
          ? ROUTEC_RAW_EVENT_ID_HASH_KIND
          : null,
        semantic_event_id: semanticEventId,
        semantic_event_id_hash: semanticEventIdContentHash,
        semantic_event_id_hash_kind: semanticEventId
          ? ROUTEC_EVENT_ID_CONTENT_HASH_KIND
          : null,
        semantic_event_id_raw_hash: hashRouteCEventId(semanticEventId),
        semantic_event_id_raw_hash_kind: semanticEventId
          ? ROUTEC_RAW_EVENT_ID_HASH_KIND
          : null,
        semantic_event_id_content_hash: semanticEventIdContentHash,
        semantic_event_id_content_hash_kind: semanticEventId
          ? ROUTEC_EVENT_ID_CONTENT_HASH_KIND
          : null,
        p131_tool_transfer_projection_applied:
          transferProjection.projected === true,
        p131_tool_transfer_projection:
          transferProjection.projection || null,
        p131_tool_detail_store: toolDetailStoreProof,
        assistant_semantic_event_id:
          semanticType === "message.assistant" ? semanticEventId : null,
        assistant_semantic_event_id_raw_hash:
          semanticType === "message.assistant"
            ? hashRouteCEventId(semanticEventId)
            : null,
        assistant_semantic_event_id_raw_hash_kind:
          semanticType === "message.assistant" && semanticEventId
            ? ROUTEC_RAW_EVENT_ID_HASH_KIND
            : null,
        provider_id: providerId,
        provider_turn_id: providerTurnId,
        provider_turn_id_kind: providerTurnIdKind,
        provider_runtime_event_index: providerRuntimeEventIndex,
        semantic_body_hash: hashMatrixContent({ body: semanticBody }),
        assistant_content_hash:
          semanticType === "message.assistant"
            ? hashMatrixContent({ body: semanticBody })
            : null,
        semantic_content_hash: hashMatrixContent(content),
        ...semanticSenderProof,
        source_host2_intake_proof: null,
        semantic_send_correlation: buildRouteCHost2IntakeProof(
          semanticSendCorrelation
        ),
        cancel_outcome: cancelOutcome,
        control_request_id: controlRequestId,
        control_outcome_id: controlOutcomeId,
        control_kind: controlKind,
        control_family: controlFamily,
        control_origin: controlOrigin,
        control_outcome: controlOutcome,
        outcome: controlOutcome || cancelOutcome,
        actor:
          normalizeRouteCSemanticString(event.actor) ||
          (semanticType === "control.outcome" ? "host" : null),
        allowed_actions: controlAllowedActions,
        target_id: controlTargetId,
        target_turn_id:
          normalizeRouteCSemanticString(event.target_turn_id) || providerTurnId,
        target_session_id:
          normalizeRouteCSemanticString(event.target_session_id) || sessionId,
        durable:
          typeof event.durable === "boolean"
            ? event.durable
            : semanticType === "control.request" ||
              semanticType === "control.outcome"
            ? true
            : null,
        replay_policy:
          normalizeRouteCSemanticString(event.replay_policy) ||
          (semanticType === "control.request"
            ? "latest_state_only"
            : semanticType === "control.outcome"
            ? "always"
            : null),
        failure_classification: failureClassification,
        error_origin: normalizeRouteCSemanticString(event.error_origin),
        error_scope: normalizeRouteCSemanticString(event.error_scope),
        last_agent_message_present:
          typeof event.last_agent_message_present === "boolean"
            ? event.last_agent_message_present
            : typeof delivery.last_agent_message_present === "boolean"
            ? delivery.last_agent_message_present
            : null,
        agent_turn_started:
          event.agent_turn_started === true ||
          delivery.agent_turn_started === true,
        host2_intake_state:
          normalizeRouteCSemanticString(event.host2_intake_state) ||
          normalizeRouteCSemanticString(delivery.host2_intake_state),
        provider_receives_canceled_user_event:
          typeof event.provider_receives_canceled_user_event === "boolean"
            ? event.provider_receives_canceled_user_event
            : typeof delivery.provider_receives_canceled_user_event ===
              "boolean"
            ? delivery.provider_receives_canceled_user_event
            : null,
        provider_started_for_target_event:
          typeof event.provider_started_for_target_event === "boolean"
            ? event.provider_started_for_target_event
            : delivery.agent_turn_started === true,
        same_event_both_canceled_and_started:
          event.same_event_both_canceled_and_started === true ||
          delivery.same_event_both_canceled_and_started === true,
        duplicate_user_row_count: Number.isFinite(
          Number(event.duplicate_user_row_count)
        )
          ? Number(event.duplicate_user_row_count)
          : Number.isFinite(Number(delivery.duplicate_user_row_count))
          ? Number(delivery.duplicate_user_row_count)
          : null,
        outbox_delivery_state: normalizeRouteCSemanticString(
          event.outbox_delivery_state
        ),
        ambiguous_state: normalizeRouteCSemanticString(event.ambiguous_state),
        provider_completion_marker:
          isRouteCCompleteNotificationCandidateSemanticType(semanticType) ||
          isProviderCompletionRuntimeEvent
            ? COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER
            : null,
        provider_completion_state: isProviderCompletionRuntimeEvent
          ? providerCompletionStateForStatus(event.status)
          : isRouteCCompleteNotificationCandidateSemanticType(semanticType)
          ? COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE
          : null,
        provider_completion_status: isProviderCompletionRuntimeEvent
          ? normalizeProviderCompletionStatus(event.status)
          : null,
        provider_completion_success: isProviderCompletionRuntimeEvent
          ? isSuccessfulProviderCompletionStatus(event.status)
          : null,
        provider_completion_success_required:
          isRouteCCompleteNotificationCandidateSemanticType(semanticType)
            ? true
            : null,
        provider_completion_turn_id:
          isRouteCCompleteNotificationCandidateSemanticType(semanticType) ||
          isProviderCompletionRuntimeEvent
            ? providerTurnId
            : null,
        ...(semanticWritePacingProof
          ? { semantic_write_pacing: semanticWritePacingProof }
          : {}),
        retry_proof: retryProof,
        retry_ledger: retryLedger,
        committed_by: "host2_provider_runtime_semantic_bridge",
        direct_host_send_used: false,
        direct_matrix_harness_write_used: false,
        direct_semantic_endpoint_as_proof_used: false,
        fake_dom_row_injected: false,
        fake_cinny_store_row_injected: false,
        screenshot_only_proof: false,
        raw_synapse_token_exposed: false,
        readiness_claimed: false,
        foundation_pass_claimed: false,
        real_codex_e2e_claimed: false,
        full_provider_parity_claimed: false,
      };
      let sourceHost2Proof = null;
      const runCommitSideEffects = async () => {
        appendRouteCRuntimeProofJsonlArtifact("provider_semantic_event_commit.jsonl", {
          recorded_at: new Date().toISOString(),
          ...commitProof,
          routec_batch_side_effects_after_durable_flush:
            sideEffectsDeferred === true,
        });
        writeRouteCRuntimeProofJsonArtifact(
          "provider_semantic_event_commit.json",
          commitProof
        );
        if (semanticType === "message.assistant") {
          sourceHost2Proof = recordRouteCProviderAssistantSemanticResponse({
            hostSessionId: binding.host_session_id,
            matrixRoomId: binding.matrix_room_id,
            sourceServerEventId,
            semanticEventId,
            semanticTxnId: txnId,
            semanticType,
            semanticId,
            semanticContent: content,
            assistantBody: semanticBody,
            providerId,
            providerTurnId,
            providerTurnIdKind,
            matrixEventSender: semanticSenderActor.matrix_user_id,
          });
          const assistantCommitProof = {
            ...commitProof,
            source_host2_intake_proof: sourceHost2Proof,
          };
          writeRouteCRuntimeProofJsonArtifact(
            "provider_semantic_event_commit.json",
            assistantCommitProof
          );
          writeRouteCRuntimeProofJsonArtifact(
            "provider_assistant_semantic_event_commit.json",
            {
              ...assistantCommitProof,
              status:
                commitStatus === "provider_semantic_matrix_event_committed"
                  ? "provider_assistant_semantic_matrix_event_committed"
                  : "provider_assistant_semantic_matrix_event_not_committed",
            }
          );
        }
        if (
          commitStatus === "provider_semantic_matrix_event_committed" &&
          typeof onCommittedMatrixEvent === "function"
        ) {
          try {
            await onCommittedMatrixEvent({
              type: "m.room.message",
              room_id: binding.matrix_room_id,
              sender: semanticSenderActor.matrix_user_id,
              content,
              event_id: semanticEventId,
              origin_server_ts: Date.now(),
              unsigned: {
                transaction_id: txnId,
                host_session_id: binding.host_session_id,
                committed_transcript_truth: "matrix_room_timeline",
                routec_matrix_actor_key: semanticSenderActor.actor_key,
                routec_matrix_actor_kind: semanticSenderActor.actor_kind,
                routec_matrix_actor_display_name: semanticSenderActor.display_name,
                routec_matrix_actor_sender_source:
                  semanticSenderActor.sender_source,
              },
            });
          } catch (err) {
            console.warn(
              `[routec] committed Matrix event observer failed: ${
                err?.message || err
              }`
            );
          }
        }
      };
      const sideEffectsDeferred =
        commitStatus === "provider_semantic_matrix_event_committed" &&
        deferRouteCMatrixStorageBatchSideEffect(runCommitSideEffects);
      if (!sideEffectsDeferred) {
        await runCommitSideEffects();
      }
      if (
        commitStatus === "provider_semantic_matrix_event_committed" &&
        semanticType === "message.assistant" &&
        event.delta !== true &&
        event.routec_streamed_assistant_delta_aggregate !== true
      ) {
        clearStreamedAssistantDeltaBufferForEvent(event);
      }
      return {
        status: commitStatus,
        matrix_room_id: binding.matrix_room_id,
        event_type: "m.room.message",
        txn_id: txnId,
        event_id: semanticEventId,
        event_id_raw_hash: hashRouteCEventId(semanticEventId),
        event_id_raw_hash_kind: semanticEventId
          ? ROUTEC_RAW_EVENT_ID_HASH_KIND
          : null,
        semantic_type: semanticType,
        semantic_id: semanticId,
        ...semanticSenderProof,
        source_user_event_id: sourceServerEventId,
        provider_turn_id: providerTurnId,
        provider_runtime_event_index: providerRuntimeEventIndex,
        source_user_event_id_raw_hash: hashRouteCEventId(sourceServerEventId),
        source_user_event_id_raw_hash_kind: ROUTEC_RAW_EVENT_ID_HASH_KIND,
        target_user_event_id: targetUserEventId,
        target_user_event_id_raw_hash: hashRouteCEventId(targetUserEventId),
        target_user_event_id_raw_hash_kind: targetUserEventId
          ? ROUTEC_RAW_EVENT_ID_HASH_KIND
          : null,
        source_host2_intake_proof: sourceHost2Proof,
        routec_batch_side_effects_deferred_until_durable_flush:
          sideEffectsDeferred,
        ...(streamedAssistantDeltaFlushResult
          ? {
              streamed_assistant_delta_flush_result:
                streamedAssistantDeltaFlushResult,
            }
          : {}),
        semantic_retry_proof: retryProof,
        semantic_retry_ledger: retryLedger,
        direct_host_send_used: false,
        direct_matrix_harness_write_used: false,
        raw_synapse_token_exposed: false,
        foundation_pass_claimed: false,
        readiness_claimed: false,
      };
    },

    async writeHostControlSemanticEvent({ session, event }) {
      if (!session?.id || !event) {
        throw new Error(
          "Route C host control semantic write requires session and event"
        );
      }
      let binding;
      try {
        binding = requireRouteCMatrixRoomBinding(session.id);
      } catch (err) {
        return {
          status: "routec_control_semantic_binding_missing",
          semantic_matrix_event_committed: false,
          host_session_id: session.id,
          skipped_reason: err.message || String(err),
          readiness_claimed: false,
          foundation_pass_claimed: false,
        };
      }
      const semanticType = routeCSemanticTypeForRuntimeEvent(event);
      if (
        semanticType !== "control.request" &&
        semanticType !== "control.outcome"
      ) {
        throw new Error(
          `Route C host control semantic write does not support ${
            semanticType || "missing semantic type"
          }`
        );
      }
      const providerId =
        normalizeRouteCSemanticString(event.provider) ||
        session.provider ||
        null;
      const providerTurnId =
        normalizeRouteCSemanticString(event.provider_turn_id) || null;
      const targetUserEventId = routeCTargetUserEventForRuntimeEvent(
        event,
        event.routec_matrix_delivery || {},
        semanticType
      );
      const cancelOutcome = routeCCancelOutcomeForRuntimeEvent(
        event,
        semanticType
      );
      const controlKind = routeCControlKindForRuntimeEvent(event, semanticType);
      const controlFamily =
        normalizeRouteCSemanticString(event.control_family) ||
        routeCControlFamilyForKind(controlKind);
      const controlOrigin = routeCControlOriginForRuntimeEvent(
        event,
        semanticType,
        controlKind
      );
      const controlOutcome = routeCControlOutcomeForRuntimeEvent(
        event,
        semanticType,
        cancelOutcome
      );
      const controlRequestId =
        normalizeRouteCSemanticString(event.control_request_id) ||
        normalizeRouteCSemanticString(event.request_id);
      const controlTargetId = routeCControlTargetForRuntimeEvent(
        event,
        { host_session_id: session.id },
        targetUserEventId,
        providerTurnId
      );
      const controlOutcomeId =
        normalizeRouteCSemanticString(event.control_outcome_id) ||
        routeCControlOutcomeId({
          sessionId: session.id,
          controlRequestId,
          outcome: controlOutcome,
          targetId: controlTargetId,
        });
      const txnId =
        normalizeRouteCSemanticString(event.txn_id) ||
        normalizeRouteCSemanticString(event.client_request_id) ||
        controlOutcomeId ||
        controlRequestId ||
        `routec_control_${Date.now()}`;
      const semanticBody = routeCSemanticBodyForRuntimeEvent(
        event,
        semanticType
      );
      const semanticIdentityHash = hashMatrixContent({
        session_id: session.id,
        matrix_room_id: binding.matrix_room_id,
        semantic_type: semanticType,
        control_request_id: controlRequestId,
        control_outcome_id: controlOutcomeId,
        outcome: controlOutcome,
        target_id: controlTargetId,
        body: semanticBody,
      }).slice(0, 32);
      const semanticId =
        normalizeRouteCSemanticString(event.semantic_id) ||
        `routec_semantic_${routeCSemanticIdPrefix(
          semanticType
        )}_${semanticIdentityHash}`;
      const semanticSenderActor = routeCResolveSemanticSenderActor({
        binding,
        semanticType,
        providerId,
        controlOrigin,
        controlFamily,
      });
      const semanticSenderProof = routeCMatrixSenderProof(semanticSenderActor);
      const content = buildOysterunSemanticMatrixContent({
        semanticType,
        category: semanticType,
        body: semanticBody,
        semanticId,
        lifecycle: routeCSemanticLifecycleForRuntimeEvent(event, semanticType),
        correlation: {
          created_at: normalizeRouteCSemanticString(event.created_at),
          host_session_id: binding.host_session_id,
          matrix_room_id: binding.matrix_room_id,
          client_request_id: txnId,
          source_user_event_id: targetUserEventId,
          target_user_event_id: targetUserEventId,
          provider_id: providerId,
          provider_turn_id: providerTurnId,
          provider_turn_id_kind: normalizeRouteCSemanticString(
            event.provider_turn_id_kind
          ),
          source_id:
            normalizeRouteCSemanticString(event.source_id) || "oysterun-host",
          source_label:
            normalizeRouteCSemanticString(event.source_label) ||
            "host_control_api_semantic_writer",
          cancel_outcome: cancelOutcome,
          control_request_id: controlRequestId,
          control_outcome_id: controlOutcomeId,
          control_kind: controlKind,
          control_family: controlFamily,
          control_origin: controlOrigin,
          control_outcome: controlOutcome,
          outcome: controlOutcome,
          actor:
            normalizeRouteCSemanticString(event.actor) ||
            (semanticType === "control.outcome" ? "host" : null),
          allowed_actions: routeCControlAllowedActionsForRuntimeEvent(
            event,
            controlKind,
            semanticType
          ),
          target_id: controlTargetId,
          target_turn_id:
            normalizeRouteCSemanticString(event.target_turn_id) ||
            providerTurnId,
          target_session_id:
            normalizeRouteCSemanticString(event.target_session_id) ||
            session.id,
          durable: typeof event.durable === "boolean" ? event.durable : true,
          replay_policy:
            normalizeRouteCSemanticString(event.replay_policy) ||
            (semanticType === "control.request"
              ? "latest_state_only"
              : "always"),
          failure_classification: normalizeRouteCSemanticString(
            event.failure_classification
          ),
          error_origin: normalizeRouteCSemanticString(event.error_origin),
          error_scope: normalizeRouteCSemanticString(event.error_scope),
          last_agent_message_present:
            typeof event.last_agent_message_present === "boolean"
              ? event.last_agent_message_present
              : null,
          ...semanticSenderProof,
          direct_matrix_harness_write_used: false,
          real_codex_e2e_claimed: false,
          full_provider_parity_claimed: false,
        },
      });
      registerRouteCOutboxCorrelation({
        hostSessionId: binding.host_session_id,
        matrixUserId: semanticSenderActor.matrix_user_id,
        matrixRoomId: binding.matrix_room_id,
        txnId,
        eventType: "m.room.message",
        clientRequestId: content[OYSTERUN_SEMANTIC_NAMESPACE].client_request_id,
        clientContent: content,
      });
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(
        binding.matrix_room_id
      )}/send/m.room.message/${encodeURIComponent(txnId)}`;
      const { proxied, retryLedger, retryProof } =
        await sendSemanticEventWithRetryBackoff({
          path,
          content,
          txnId,
          binding,
          senderMatrixUserId: semanticSenderActor.matrix_user_id,
          senderActorKey: semanticSenderActor.actor_key,
        });
      const semanticSendCorrelation = recordRouteCSendResponse({
        matrixRoomId: binding.matrix_room_id,
        txnId,
        responseBody: proxied.body,
        forwardedContent: content,
      });
      const eventId = proxied.body?.event_id || null;
      appendRouteCRuntimeProofJsonlArtifact("control_semantic_event_commit.jsonl", {
        recorded_at: new Date().toISOString(),
        status: eventId
          ? "control_semantic_matrix_event_committed"
          : "control_semantic_matrix_event_not_committed",
        semantic_type: semanticType,
        control_request_id: controlRequestId,
        control_outcome_id: controlOutcomeId,
        control_kind: controlKind,
        control_family: controlFamily,
        control_origin: controlOrigin,
        outcome: controlOutcome,
        ...semanticSenderProof,
        matrix_room_id: binding.matrix_room_id,
        event_id: eventId,
        txn_id: txnId,
        semantic_send_correlation: buildRouteCHost2IntakeProof(
          semanticSendCorrelation
        ),
        retry_proof: retryProof,
        retry_ledger: retryLedger,
        direct_api_substitute_proof_used: false,
        readiness_claimed: false,
        foundation_pass_claimed: false,
      });
      return {
        status: eventId
          ? "control_semantic_matrix_event_committed"
          : "control_semantic_matrix_event_not_committed",
        semantic_matrix_event_committed: Boolean(eventId),
        matrix_room_id: binding.matrix_room_id,
        event_type: "m.room.message",
        event_id: eventId,
        txn_id: txnId,
        ...semanticSenderProof,
        semantic_type: semanticType,
        control_request_id: controlRequestId,
        control_outcome_id: controlOutcomeId,
        control_kind: controlKind,
        outcome: controlOutcome,
        semantic_retry_proof: retryProof,
        semantic_retry_ledger: retryLedger,
        direct_matrix_harness_write_used: false,
        readiness_claimed: false,
        foundation_pass_claimed: false,
      };
    },

    async writeHostTerminalSemanticEvent({ session, event }) {
      if (!session?.id || !event) {
        throw new Error(
          "Route C host terminal semantic write requires session and event"
        );
      }
      let binding;
      try {
        binding = requireRouteCMatrixRoomBinding(session.id);
      } catch (err) {
        return {
          status: "routec_terminal_semantic_binding_missing",
          semantic_matrix_event_committed: false,
          host_session_id: session.id,
          skipped_reason: err.message || String(err),
          readiness_claimed: false,
          foundation_pass_claimed: false,
        };
      }
      const requestedRoomId = normalizeRouteCSemanticString(event.matrix_room_id);
      if (requestedRoomId && requestedRoomId !== binding.matrix_room_id) {
        return {
          status: "routec_terminal_semantic_room_mismatch",
          semantic_matrix_event_committed: false,
          host_session_id: session.id,
          matrix_room_id: binding.matrix_room_id,
          requested_matrix_room_id: requestedRoomId,
          readiness_claimed: false,
          foundation_pass_claimed: false,
        };
      }
      const semanticType = routeCSemanticTypeForRuntimeEvent(event);
      if (
        semanticType !== "terminal.command.started" &&
        semanticType !== "terminal.command.result"
      ) {
        throw new Error(
          `Route C host terminal semantic write does not support ${
            semanticType || "missing semantic type"
          }`
        );
      }
      const terminalFields = routeCTerminalSemanticFieldsForRuntimeEvent(
        event,
        semanticType
      );
      if (!terminalFields.terminal_exec_id) {
        throw new Error("Route C terminal semantic write requires terminal_exec_id");
      }
      if (!terminalFields.command) {
        throw new Error("Route C terminal semantic write requires command");
      }
      if (!terminalFields.cwd) {
        throw new Error("Route C terminal semantic write requires cwd");
      }
      const providerId = session.provider || session.adapterId || null;
      const semanticSenderActor = routeCResolveSemanticSenderActor({
        binding,
        semanticType,
        providerId,
        controlOrigin: null,
        controlFamily: null,
      });
      const semanticSenderProof = routeCMatrixSenderProof(semanticSenderActor);
      const semanticBody = routeCSemanticBodyForRuntimeEvent(event, semanticType);
      const semanticHash = hashMatrixContent({
        session_id: session.id,
        matrix_room_id: binding.matrix_room_id,
        semantic_type: semanticType,
        terminal_exec_id: terminalFields.terminal_exec_id,
        command: terminalFields.command,
        cwd: terminalFields.cwd,
        started_at: terminalFields.started_at,
        completed_at: terminalFields.completed_at,
        exit_code: terminalFields.exit_code,
        body: semanticBody,
      }).slice(0, 32);
      const semanticId =
        normalizeRouteCSemanticString(event.semantic_id) ||
        `routec_semantic_${routeCSemanticIdPrefix(
          semanticType
        )}_${semanticHash}`;
      const txnId =
        normalizeRouteCSemanticString(event.txn_id) ||
        normalizeRouteCSemanticString(event.client_request_id) ||
        `routec_terminal_${routeCSemanticIdPrefix(
          semanticType
        )}_${semanticHash}`;
      const content = buildOysterunSemanticMatrixContent({
        semanticType,
        category: semanticType,
        body: semanticBody,
        semanticId,
        lifecycle: routeCSemanticLifecycleForRuntimeEvent(event, semanticType),
        correlation: {
          created_at: normalizeRouteCSemanticString(event.created_at),
          host_session_id: binding.host_session_id,
          matrix_room_id: binding.matrix_room_id,
          client_request_id: txnId,
          source_id: "oysterun-host-terminal",
          source_label: "host_terminal_semantic_writer",
          semantic_contract: "routec_terminal_command_matrix_durability",
          actor: "host",
          target_id: terminalFields.terminal_exec_id,
          target_session_id: session.id,
          durable: true,
          replay_policy: "always",
          ...terminalFields,
          ...semanticSenderProof,
          direct_matrix_harness_write_used: false,
          real_codex_e2e_claimed: false,
          full_provider_parity_claimed: false,
        },
      });
      registerRouteCOutboxCorrelation({
        hostSessionId: binding.host_session_id,
        matrixUserId: semanticSenderActor.matrix_user_id,
        matrixRoomId: binding.matrix_room_id,
        txnId,
        eventType: "m.room.message",
        clientRequestId: content[OYSTERUN_SEMANTIC_NAMESPACE].client_request_id,
        clientContent: content,
      });
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(
        binding.matrix_room_id
      )}/send/m.room.message/${encodeURIComponent(txnId)}`;
      const { proxied, retryLedger, retryProof } =
        await sendSemanticEventWithRetryBackoff({
          path,
          content,
          txnId,
          binding,
          senderMatrixUserId: semanticSenderActor.matrix_user_id,
          senderActorKey: semanticSenderActor.actor_key,
        });
      const semanticSendCorrelation = recordRouteCSendResponse({
        matrixRoomId: binding.matrix_room_id,
        txnId,
        responseBody: proxied.body,
        forwardedContent: content,
      });
      const eventId = proxied.body?.event_id || null;
      const status = eventId
        ? "terminal_semantic_matrix_event_committed"
        : "terminal_semantic_matrix_event_not_committed";
      appendRouteCRuntimeProofJsonlArtifact("control_semantic_event_commit.jsonl", {
        recorded_at: new Date().toISOString(),
        status,
        semantic_type: semanticType,
        semantic_id: semanticId,
        terminal_exec_id: terminalFields.terminal_exec_id,
        command: terminalFields.command,
        cwd: terminalFields.cwd,
        exit_code: terminalFields.exit_code,
        timed_out: terminalFields.timed_out,
        interrupted: terminalFields.interrupted,
        provider_delivery_attempted: false,
        normal_message_user_sent: false,
        browser_shell_execution: false,
        host_db_transcript_product_truth: false,
        ...semanticSenderProof,
        matrix_room_id: binding.matrix_room_id,
        event_id: eventId,
        txn_id: txnId,
        semantic_send_correlation: buildRouteCHost2IntakeProof(
          semanticSendCorrelation
        ),
        retry_proof: retryProof,
        retry_ledger: retryLedger,
        direct_api_substitute_proof_used: false,
        readiness_claimed: false,
        foundation_pass_claimed: false,
      });
      return {
        status,
        semantic_matrix_event_committed: Boolean(eventId),
        matrix_room_id: binding.matrix_room_id,
        event_type: "m.room.message",
        event_id: eventId,
        txn_id: txnId,
        semantic_type: semanticType,
        semantic_id: semanticId,
        terminal_exec_id: terminalFields.terminal_exec_id,
        terminal_command_semantic_content: content,
        provider_delivery_attempted: false,
        normal_message_user_sent: false,
        browser_shell_execution: false,
        host_db_transcript_product_truth: false,
        semantic_retry_proof: retryProof,
        semantic_retry_ledger: retryLedger,
        ...semanticSenderProof,
      };
    },

    async writeLoopSystemSemanticEvent({ sessionId, action, schedule }) {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(`Loop semantic write requires live session ${sessionId}`);
      }
      const binding = ensureLoopMatrixBinding({ session });
      const semanticType = "session_lifecycle";
      const semanticSenderActor = routeCResolveSemanticSenderActor({
        binding,
        semanticType,
        providerId: session.provider || session.adapterId || null,
        controlOrigin: null,
        controlFamily: null,
      });
      const semanticSenderProof = routeCMatrixSenderProof(semanticSenderActor);
      const body = loopSystemMessageBody({ action, schedule });
      const semanticHash = hashMatrixContent({
        session_id: session.id,
        matrix_room_id: binding.matrix_room_id,
        schedule_id: schedule?.id || schedule?.schedule_id || null,
        action,
        body,
      }).slice(0, 32);
      const semanticId = `routec_loop_${action}_${semanticHash}`;
      const txnId = semanticId;
      const content = buildOysterunSemanticMatrixContent({
        semanticType,
        category: semanticType,
        body,
        semanticId,
        lifecycle: "final",
        correlation: {
          host_session_id: binding.host_session_id,
          matrix_room_id: binding.matrix_room_id,
          client_request_id: txnId,
          source_id: "oysterun-loop",
          source_label: "oysterun_loop_system_feedback",
          semantic_contract: "oysterun_loop_matrix_backed_system_feedback",
          actor: "host",
          target_session_id: session.id,
          durable: true,
          replay_policy: "always",
          ...semanticSenderProof,
          direct_matrix_harness_write_used: false,
        },
      });
      registerRouteCOutboxCorrelation({
        hostSessionId: binding.host_session_id,
        matrixUserId: semanticSenderActor.matrix_user_id,
        matrixRoomId: binding.matrix_room_id,
        txnId,
        eventType: "m.room.message",
        clientRequestId: content[OYSTERUN_SEMANTIC_NAMESPACE].client_request_id,
        clientContent: content,
      });
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(
        binding.matrix_room_id
      )}/send/m.room.message/${encodeURIComponent(txnId)}`;
      const { proxied, retryLedger, retryProof } =
        await sendSemanticEventWithRetryBackoff({
          path,
          content,
          txnId,
          binding,
          senderMatrixUserId: semanticSenderActor.matrix_user_id,
          senderActorKey: semanticSenderActor.actor_key,
        });
      const eventId = proxied.body?.event_id || null;
      appendRouteCRuntimeProofJsonlArtifact("loop_system_semantic_event_commit.jsonl", {
        recorded_at: new Date().toISOString(),
        status: eventId
          ? "loop_system_semantic_matrix_event_committed"
          : "loop_system_semantic_matrix_event_not_committed",
        action,
        semantic_type: semanticType,
        semantic_id: semanticId,
        matrix_room_id: binding.matrix_room_id,
        event_id: eventId,
        txn_id: txnId,
        retry_proof: retryProof,
        retry_ledger: retryLedger,
        provider_delivery_attempted: false,
        ...semanticSenderProof,
      });
      return {
        status: eventId
          ? "loop_system_semantic_matrix_event_committed"
          : "loop_system_semantic_matrix_event_not_committed",
        semantic_matrix_event_committed: Boolean(eventId),
        provider_delivery_attempted: false,
        matrix_room_id: binding.matrix_room_id,
        event_type: "m.room.message",
        event_id: eventId,
        txn_id: txnId,
        semantic_type: semanticType,
        semantic_id: semanticId,
        semantic_retry_proof: retryProof,
        semantic_retry_ledger: retryLedger,
        ...semanticSenderProof,
      };
    },

    async deliverLoopExecutionFromScheduler({
      sessionId,
      text,
      messageId,
      schedule,
      triggeredAt,
    }) {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(`Loop execution requires live session ${sessionId}`);
      }
      const binding = ensureLoopMatrixBinding({ session });
      const semanticType = "message.user";
      const semanticSenderActor =
        getRouteCMatrixActorByKey(binding, "host") ||
        routeCResolveSemanticSenderActor({
          binding,
          semanticType,
          providerId: session.provider || session.adapterId || null,
          controlOrigin: null,
          controlFamily: null,
        });
      const semanticSenderProof = routeCMatrixSenderProof(semanticSenderActor);
      const visibleBody = loopExecutionMessageBody({ schedule, text });
      const semanticHash = hashMatrixContent({
        session_id: session.id,
        matrix_room_id: binding.matrix_room_id,
        schedule_id: schedule?.id || schedule?.schedule_id || null,
        message_id: messageId,
        triggered_at: triggeredAt,
        body: visibleBody,
      }).slice(0, 32);
      const txnId =
        typeof messageId === "string" && messageId.trim()
          ? messageId.trim()
          : `routec_loop_execution_${semanticHash}`;
      const semanticId = `routec_loop_execution_${semanticHash}`;
      const content = buildOysterunSemanticMatrixContent({
        semanticType,
        category: semanticType,
        body: visibleBody,
        semanticId,
        lifecycle: "final",
        correlation: {
          host_session_id: binding.host_session_id,
          matrix_room_id: binding.matrix_room_id,
          client_request_id: txnId,
          source_id: "oysterun-loop",
          source_label: "oysterun_loop_due_execution",
          semantic_contract: "oysterun_loop_matrix_backed_provider_delivery",
          target_session_id: session.id,
          durable: true,
          replay_policy: "always",
          ...semanticSenderProof,
          direct_matrix_harness_write_used: false,
        },
      });
      registerRouteCOutboxCorrelation({
        hostSessionId: binding.host_session_id,
        matrixUserId: semanticSenderActor.matrix_user_id,
        matrixRoomId: binding.matrix_room_id,
        txnId,
        eventType: "m.room.message",
        clientRequestId: content[OYSTERUN_SEMANTIC_NAMESPACE].client_request_id,
        clientContent: content,
      });
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(
        binding.matrix_room_id
      )}/send/m.room.message/${encodeURIComponent(txnId)}`;
      const proxied = await routeCMatrixStorageRequest({
        req: { method: "PUT" },
        path,
        url: new URL("http://localhost/"),
        body: content,
        binding,
        senderMatrixUserId: semanticSenderActor.matrix_user_id,
        senderActorKey: semanticSenderActor.actor_key,
      });
      if (
        proxied.status >= 200 &&
        proxied.status < 300 &&
        typeof proxied.body?.event_id === "string"
      ) {
        recordRouteCMatrixReadAuthorityEvent({
          binding,
          eventId: proxied.body.event_id,
          eventType: "m.room.message",
          senderMatrixUserId: semanticSenderActor.matrix_user_id,
          senderActorKey: semanticSenderActor.actor_key,
          content,
          txnId,
        });
      }
      const sendCorrelation = recordRouteCSendResponse({
        matrixRoomId: binding.matrix_room_id,
        txnId,
        responseBody: proxied.body,
        forwardedContent: content,
      });
      const eventId = proxied.body?.event_id || null;
      if (!eventId) {
        return {
          status: "loop_execution_matrix_event_not_committed",
          delivered: false,
          matrix_room_id: binding.matrix_room_id,
          event_id: null,
          txn_id: txnId,
          semantic_type: semanticType,
          provider_delivery_attempted: false,
          matrix_host2_intake_proof:
            buildRouteCHost2IntakeProof(sendCorrelation),
          ...semanticSenderProof,
        };
      }
      const providerDeliveryProof =
        sessionManager.deliverRouteCMatrixUserEventToProvider({
          sessionId: binding.host_session_id,
          matrixUserId: semanticSenderActor.matrix_user_id,
          matrixRoomId: binding.matrix_room_id,
          serverEventId: eventId,
          txnId,
          text: visibleBody,
          providerText: String(text || "").trim() || loopSchedulePrompt(schedule),
          nickname: "Oysterun Loop",
        });
      appendRouteCRuntimeProofJsonlArtifact("loop_execution_matrix_delivery.jsonl", {
        recorded_at: new Date().toISOString(),
        status: "loop_execution_matrix_event_committed",
        matrix_room_id: binding.matrix_room_id,
        event_id: eventId,
        txn_id: txnId,
        semantic_type: semanticType,
        provider_delivery: providerDeliveryProof,
        matrix_host2_intake_proof: buildRouteCHost2IntakeProof(sendCorrelation),
        ...semanticSenderProof,
      });
      return {
        status: "loop_execution_matrix_event_committed",
        delivered: true,
        matrix_room_id: binding.matrix_room_id,
        event_id: eventId,
        txn_id: txnId,
        semantic_type: semanticType,
        message_id: providerDeliveryProof?.message_id || messageId || null,
        provider_delivery: providerDeliveryProof,
        provider_delivery_attempted: true,
        matrix_host2_intake_proof: buildRouteCHost2IntakeProof(sendCorrelation),
        ...semanticSenderProof,
      };
    },

    async handleSemanticEventWrite({ res, claims, body, respond }) {
      const sessionId =
        typeof body.session_id === "string" ? body.session_id.trim() : "";
      const binding = requireRouteCMatrixRoomBinding(sessionId);
      if (
        !claims?._dashboardAuth &&
        !claims?.agent_ids?.includes(binding.host_agent_id)
      ) {
        return respond(res, 403, {
          error: "Route C Matrix semantic write forbidden for this session",
        });
      }
      const semanticType = body.semantic_type || body.category;
      const endpointProviderId = body.provider_id || body.provider || null;
      const endpointToolSemanticFields =
        routeCToolSemanticFieldsForEndpointBody(body, semanticType);
      const endpointSemanticBody =
        routeCBuildToolCallSameEventFallbackBody({
          semanticType,
          explicitBodies: [body.body],
          toolInput: body.tool_input,
          input: body.input,
          toolName: body.tool_name,
          name: body.name,
          toolCallId: body.tool_call_id,
          callId: body.call_id,
          id: body.id,
        }) || body.body;
      const endpointSenderActor = routeCResolveSemanticSenderActor({
        binding,
        semanticType,
        providerId: endpointProviderId,
        controlOrigin: body.control_origin || null,
        controlFamily: body.control_family || null,
      });
      const endpointSenderProof = routeCMatrixSenderProof(endpointSenderActor);
      const content = buildOysterunSemanticMatrixContent({
        semanticType,
        category: body.category,
        body: endpointSemanticBody,
        semanticId: body.semantic_id || null,
        lifecycle: body.lifecycle || "final",
        correlation: {
          host_session_id: binding.host_session_id,
          matrix_room_id: binding.matrix_room_id,
          host_outbox_id: body.host_outbox_id || null,
          client_request_id: body.client_request_id || null,
          source_user_event_id: body.source_user_event_id || null,
          target_user_event_id: body.target_user_event_id || null,
          provider_id: body.provider_id || null,
          provider: body.provider || body.provider_id || null,
          provider_turn_id: body.provider_turn_id || null,
          provider_turn_id_kind: body.provider_turn_id_kind || null,
          source_id: body.source_id || body.provider_id || null,
          source_label:
            body.source_label || "matrix_facade_semantic_event_write",
          semantic_contract: body.semantic_contract || null,
          cancel_outcome: body.cancel_outcome || null,
          control_request_id: body.control_request_id || null,
          control_outcome_id: body.control_outcome_id || null,
          control_kind: body.control_kind || body.subtype || null,
          control_family: body.control_family || null,
          control_origin: body.control_origin || null,
          control_outcome: body.control_outcome || null,
          outcome: body.outcome || null,
          actor: body.actor || null,
          allowed_actions: Array.isArray(body.allowed_actions)
            ? body.allowed_actions
            : null,
          target_id:
            body.target_id ||
            body.target_event_id ||
            body.target_user_event_id ||
            null,
          target_turn_id: body.target_turn_id || null,
          target_session_id: body.target_session_id || body.session_id || null,
          durable: typeof body.durable === "boolean" ? body.durable : null,
          replay_policy: body.replay_policy || null,
          default_action: body.default_action || null,
          expires_at: body.expires_at || null,
          sensitive:
            typeof body.sensitive === "boolean" ? body.sensitive : null,
          noop_reason: body.noop_reason || null,
          timeout_reason: body.timeout_reason || null,
          too_late_reason: body.too_late_reason || null,
          already_completed_reason: body.already_completed_reason || null,
          already_canceled_reason: body.already_canceled_reason || null,
          error_origin: body.error_origin || null,
          error_scope: body.error_scope || null,
          agent_turn_started: body.agent_turn_started === true,
          host2_intake_state: body.host2_intake_state || null,
          provider_receives_canceled_user_event:
            typeof body.provider_receives_canceled_user_event === "boolean"
              ? body.provider_receives_canceled_user_event
              : null,
          provider_started_for_target_event:
            typeof body.provider_started_for_target_event === "boolean"
              ? body.provider_started_for_target_event
              : null,
          same_event_both_canceled_and_started:
            body.same_event_both_canceled_and_started === true,
          duplicate_user_row_count: Number.isFinite(
            Number(body.duplicate_user_row_count)
          )
            ? Number(body.duplicate_user_row_count)
            : null,
          outbox_delivery_state: body.outbox_delivery_state || null,
          ambiguous_state: body.ambiguous_state || null,
          ...endpointSenderProof,
          ...endpointToolSemanticFields,
          direct_matrix_harness_write_used: false,
          real_codex_e2e_claimed: false,
          full_provider_parity_claimed: false,
        },
      });
      const committedSemanticType =
        content[OYSTERUN_SEMANTIC_NAMESPACE].semantic_type;
      const txnId =
        typeof body.txn_id === "string" && body.txn_id.trim()
          ? body.txn_id.trim()
          : `routec_semantic_${Date.now()}`;
      registerRouteCOutboxCorrelation({
        hostSessionId: binding.host_session_id,
        matrixUserId: endpointSenderActor.matrix_user_id,
        matrixRoomId: binding.matrix_room_id,
        txnId,
        eventType: "m.room.message",
        clientRequestId: content[OYSTERUN_SEMANTIC_NAMESPACE].client_request_id,
        clientContent: content,
      });
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(
        binding.matrix_room_id
      )}/send/m.room.message/${encodeURIComponent(txnId)}`;
      const { proxied, retryLedger, retryProof } =
        await sendSemanticEventWithRetryBackoff({
          path,
          content,
          txnId,
          binding,
          senderMatrixUserId: endpointSenderActor.matrix_user_id,
          senderActorKey: endpointSenderActor.actor_key,
        });
      const semanticSendCorrelation = recordRouteCSendResponse({
        matrixRoomId: binding.matrix_room_id,
        txnId,
        responseBody: proxied.body,
        forwardedContent: content,
      });
      const semanticHost2IntakeProof = buildRouteCHost2IntakeProof(
        semanticSendCorrelation
      );
      writeRouteCRuntimeProofJsonArtifact("semantic_event_retry_backoff_ledger.json", {
        generated_at: new Date().toISOString(),
        semantic_type: semanticType,
        category: body.category,
        semantic_namespace: OYSTERUN_SEMANTIC_NAMESPACE,
        matrix_room_id: binding.matrix_room_id,
        matrix_user_id: binding.matrix_user_id,
        matrix_event_sender: endpointSenderActor.matrix_user_id,
        routec_matrix_actor_key: endpointSenderActor.actor_key,
        routec_matrix_actor_kind: endpointSenderActor.actor_kind,
        retry_proof: retryProof,
        retry_ledger: retryLedger,
      });
      writeRouteCRuntimeProofTextArtifact(
        "semantic_event_render_matrix.md",
        [
          "# Route C Semantic Event Render Matrix",
          "",
          `- last_write_at: ${new Date().toISOString()}`,
          `- semantic_namespace: ${OYSTERUN_SEMANTIC_NAMESPACE}`,
          `- last_semantic_type: ${committedSemanticType}`,
          `- last_category: ${body.category}`,
          `- last_semantic_id: ${content[OYSTERUN_SEMANTIC_NAMESPACE].semantic_id}`,
          `- last_matrix_room_id: ${binding.matrix_room_id}`,
          `- last_event_id: ${
            proxied.body?.event_id || "pending_or_unavailable"
          }`,
          `- retry_marker: ${OYSTERUN_SEMANTIC_RETRY_MARKER}`,
          `- retry_attempt_count: ${retryProof.attempt_count}`,
          `- retry_total_wait_ms: ${retryProof.total_wait_ms}`,
          `- retry_terminal_non_pass_reason: ${
            retryProof.terminal_non_pass_reason || "none"
          }`,
          "- direct_dom_injection: false",
          "- direct_cinny_store_injection: false",
          "- host_only_transcript_truth: false",
          "- skipped_categories: false",
          "- foundation_pass_claimed: false",
          "",
          "## Required Categories",
          "",
          ...OYSTERUN_SEMANTIC_CATEGORIES.map((category) => `- ${category}`),
          "",
        ].join("\n")
      );
      return respond(res, proxied.status, {
        status:
          proxied.status >= 200 && proxied.status < 300
            ? "semantic_matrix_event_committed"
            : "semantic_matrix_event_not_committed",
        matrix_room_id: binding.matrix_room_id,
        event_type: "m.room.message",
        txn_id: txnId,
        event_id: proxied.body?.event_id || null,
        semantic_type: committedSemanticType,
        ...endpointSenderProof,
        content,
        semantic_retry_proof: retryProof,
        semantic_retry_ledger: retryLedger,
        matrix_host2_intake_proof: semanticHost2IntakeProof,
        category_matrix: OYSTERUN_SEMANTIC_CATEGORIES,
        committed_by: "matrix_facade_send_endpoint",
        direct_dom_injection: false,
        direct_cinny_store_injection: false,
        host_only_transcript_truth: false,
        skipped_categories: false,
        raw_synapse_token_exposed: false,
        foundation_pass_claimed: false,
      });
    },

    async handleMatrixRequest({
      req,
      res,
      url,
      path,
      respond,
      readBody,
      readRawBody,
    }) {
      attachRouteCFacadeRequestId({
        req,
        res,
        facadeRequestId: createRouteCFacadeRequestId(),
      });
      try {
      if (isRouteCPublicVersionsDiscoveryRequest(req, path)) {
        const body = buildRouteCPublicVersionsBody();
        logRouteCPublicVersionsDiscoveryTranscript({
          req,
          path,
          responseBody: body,
        });
        return respond(res, 200, body);
      }
      if (isRouteCPhase1PublicLoginFlowsRequest(req, path)) {
        const body = buildRouteCPhase1PublicLoginFlowsBody();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Oysterun-RouteC-Public-Auth-Flow", "login");
        logRouteCPhase1PublicLoginFlowsTranscript({
          req,
          path,
          responseBody: body,
        });
        return respond(res, 200, body);
      }
      if (isRouteCPhase1PublicRegisterDisabledRequest(req, path)) {
        const body = buildRouteCPhase1PublicRegisterDisabledBody();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "X-Oysterun-RouteC-Public-Auth-Flow",
          "register-disabled"
        );
        logRouteCPhase1PublicRegisterDisabledTranscript({
          req,
          path,
          responseBody: body,
        });
        return respond(res, 403, body);
      }
      if (isRouteCMsc2965AuthMetadataRequest(req, path)) {
        const proof = buildRouteCMsc2965AuthMetadataNegativeProof({
          req,
          path,
        });
        const body = buildRouteCMsc2965AuthMetadataFailClosedBody(proof);
        logRouteCMsc2965AuthMetadataFailClosedTranscript({
          req,
          path,
          responseBody: body,
        });
        return respond(res, 501, body);
      }
      if (isRouteCMsc2965AuthIssuerRequest(req, path)) {
        const proof = buildRouteCMsc2965AuthIssuerNegativeProof({ req, path });
        const body = buildRouteCMsc2965AuthIssuerFailClosedBody(proof);
        logRouteCMsc2965AuthIssuerFailClosedTranscript({
          req,
          path,
          responseBody: body,
        });
        return respond(res, 501, body);
      }

      const auth = authenticateRouteCMatrixFacadeRequest(req, {
        url,
        allowQueryAccessToken: !!isMatrixMediaDownloadRequest(req, path),
      });
      const endpointClass = classifyEndpoint(req, path);
      if (!auth.ok) {
        writeUnauthorizedNegativeProof({
          req,
          path,
          reason: auth.reason,
          authDiagnostics: auth.diagnostics,
        });
        appendRouteCAuthLossDiagnostic({
          event: "matrix_facade_request_unauthorized",
          request_method: req.method,
          request_path: path,
          endpoint_key: matrixEndpointKey(req, path),
          endpoint_class: endpointClass,
          response_status: auth.status,
          matrix_error: auth.matrix_error,
          rejection_reason: auth.reason,
          ...(auth.diagnostics || {}),
          ...routeCRequestDiagnosticFields(req),
        });
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody: null,
          responseStatus: auth.status,
          responseBody: matrixJsonError(auth.matrix_error, auth.reason),
          tokenRecord: null,
        });
        return respond(
          res,
          auth.status,
          matrixJsonError(auth.matrix_error, auth.reason)
        );
      }

      const requestBody = isMatrixMediaUploadRequest(req, path)
        ? null
        : await readMaybeJsonBody(req, readBody);
      const roomScope = extractRoomScopedPathParts(path);
      if (roomScope && roomScope.roomId !== auth.token_record.matrix_room_id) {
        return rejectWrongBoundRoom({
          req,
          path,
          endpointClass,
          requestBody,
          tokenRecord: auth.token_record,
          requestedRoomId: roomScope.roomId,
          respond,
          res,
        });
      }
      const filterCreateParts = extractUserFilterCreatePathParts(path);
      const filterReadParts = extractUserFilterReadPathParts(path);
      const typingParts = extractTypingPathParts(path);
      const profileParts = extractProfilePathParts(path);
      const membersParts = extractMembersPathParts(path);
      const requestedUserId =
        profileParts?.userId ||
        filterCreateParts?.userId ||
        filterReadParts?.userId ||
        typingParts?.userId ||
        null;
      const requestedProfileActor = profileParts
        ? getRouteCMatrixActorByUserId(auth.token_record, profileParts.userId)
        : null;
      if (profileParts && !requestedProfileActor) {
        return rejectWrongBoundUser({
          req,
          path,
          endpointClass,
          requestBody,
          tokenRecord: auth.token_record,
          requestedUserId: profileParts.userId,
          respond,
          res,
        });
      }
      if (
        !profileParts &&
        requestedUserId &&
        requestedUserId !== auth.token_record.matrix_user_id
      ) {
        return rejectWrongBoundUser({
          req,
          path,
          endpointClass,
          requestBody,
          tokenRecord: auth.token_record,
          requestedUserId,
          respond,
          res,
        });
      }
      if (endpointClass !== "supported") {
        const endpointClassification = buildBlockedEndpointNegativeProof({
          req,
          path,
          endpointClass,
          tokenRecord: auth.token_record,
        });
        const body = {
          ...matrixJsonError(
            "M_UNRECOGNIZED",
            `Unsupported Route C Matrix facade endpoint: ${req.method} ${path}`
          ),
          allowlist_decision: endpointClassification.allowlist_decision,
          host_action: endpointClassification.host_action,
          matrix_user_id: endpointClassification.matrix_user_id,
          facade_token_hash: endpointClassification.facade_token_hash,
          requested_matrix_room_id:
            endpointClassification.requested_matrix_room_id,
          bound_matrix_room_id: endpointClassification.bound_matrix_room_id,
          requested_matrix_user_id:
            endpointClassification.requested_matrix_user_id,
          bound_matrix_user_id: endpointClassification.bound_matrix_user_id,
          browser_direct_synapse_dependency: false,
          synapse_proxy_attempted: false,
          host_outbox_correlation_created: false,
          matrix_event_committed: false,
          cinny_timeline_row_created: false,
          raw_synapse_token_exposed: false,
          foundation_pass_claimed: false,
          endpoint_classification: endpointClassification,
        };
        writeEndpointAllowlistProof({
          endpoint: matrixEndpointKey(req, path),
          decision: endpointClassification.allowlist_decision,
          blocked_endpoint_negative_proof: endpointClassification,
        });
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 501,
          responseBody: body,
          tokenRecord: auth.token_record,
        });
        return respond(res, 501, body);
      }

      if (profileParts) {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }
        const body = buildRouteCProfileCompatibilityBody({
          tokenRecord: auth.token_record,
          actor: requestedProfileActor,
        });
        const proof = buildRouteCProfileCompatibilityProof({
          tokenRecord: auth.token_record,
          requestedUserId: profileParts.userId,
          session: boundContext.session,
          actor: requestedProfileActor,
        });
        writeEndpointAllowlistProof({
          endpoint: "GET /_matrix/client/v3/profile/:userId",
          decision: "supported_bound_profile_compatibility_metadata",
          proof,
          response_body_shape: ["displayname", "avatar_url"],
        });
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: {
            ...body,
            ...proof,
            routec_profile_compatibility_proof: proof,
          },
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, body);
      }

      if (membersParts) {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }
        const body = buildRouteCMembersCompatibilityBody({
          tokenRecord: auth.token_record,
        });
        const proof = buildRouteCMembersCompatibilityProof({
          tokenRecord: auth.token_record,
          requestedRoomId: membersParts.roomId,
          url,
          session: boundContext.session,
          chunk: body.chunk,
        });
        writeEndpointAllowlistProof({
          endpoint: "GET /_matrix/client/v3/rooms/:roomId/members",
          decision: "supported_bound_room_members_compatibility_metadata",
          proof,
          response_body_shape: {
            chunk: [
              "type",
              "room_id",
              "sender",
              "state_key",
              "origin_server_ts",
              "event_id",
              "content.membership",
              "content.displayname",
            ],
          },
        });
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: {
            ...body,
            ...proof,
            routec_members_compatibility_proof: proof,
          },
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, body);
      }

      if (req.method === "GET" && path === "/_matrix/client/versions") {
        const body = buildRouteCPublicVersionsBody();
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: body,
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, body);
      }

      if (req.method === "GET" && path === "/_matrix/media/v3/config") {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }
        const body = buildRouteCMatrixMediaConfigBody();
        writeEndpointAllowlistProof({
          endpoint: "GET /_matrix/media/v3/config",
          decision: "supported_host_owned_media_storage_config",
          wildcard_media_proxy: false,
          host_owned_media_storage: true,
          response_shape: Object.keys(body).sort(),
        });
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: body,
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, body);
      }

      if (req.method === "POST" && path === "/_matrix/media/v3/upload") {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }
        try {
          const bodyBuffer = await readRawMatrixRequestBody(req, readRawBody);
          const uploaded = createRouteCMatrixMediaUpload({
            bodyBuffer,
            filename: url.searchParams.get("filename"),
            contentType: headerValue(req, "content-type"),
            binding: auth.token_record,
          });
          writeEndpointAllowlistProof({
            endpoint: "POST /_matrix/media/v3/upload",
            decision:
              "supported_host_owned_media_upload_storage_without_send_side_effects",
            host_owned_media_storage: true,
            matrix_event_committed: false,
            host_outbox_correlation_created: false,
            provider_delivery_attempted: false,
            cinny_timeline_row_created: false,
            response_shape: Object.keys(uploaded.response_body).sort(),
          });
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody: {
              routec_media_upload_body_redacted: true,
              byte_size: bodyBuffer.length,
              filename: url.searchParams.get("filename") || null,
              content_type: headerValue(req, "content-type"),
            },
            responseStatus: 200,
            responseBody: uploaded.response_body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 200, uploaded.response_body);
        } catch (err) {
          if (err instanceof RouteCMatrixMediaClientError) {
            logFacadeTranscript({
              req,
              path,
              endpointClass,
              requestBody: {
                routec_media_upload_body_redacted: true,
                filename: url.searchParams.get("filename") || null,
                content_type: headerValue(req, "content-type"),
              },
              responseStatus: err.status,
              responseBody: err.body,
              tokenRecord: auth.token_record,
            });
            return respond(res, err.status, err.body);
          }
          throw err;
        }
      }

      const mediaDownloadParts = extractMatrixMediaDownloadPathParts(path);
      if (req.method === "GET" && mediaDownloadParts) {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }
        try {
          const download = readRouteCMatrixMediaDownload({
            serverName: mediaDownloadParts.serverName,
            mediaId: mediaDownloadParts.mediaId,
            binding: auth.token_record,
          });
          writeEndpointAllowlistProof({
            endpoint: mediaDownloadParts.endpoint,
            decision:
              mediaDownloadParts.endpoint ===
              "GET /_matrix/media/v3/thumbnail/:serverName/:mediaId"
                ? "supported_host_owned_media_thumbnail_by_mapping"
                : "supported_host_owned_media_download_by_mapping",
            host_owned_media_storage: true,
            saved_path_mapping: "content_uri_to_saved_path",
            thumbnail_endpoint_returns_original_bytes_until_derivatives_exist:
              mediaDownloadParts.endpoint ===
              "GET /_matrix/media/v3/thumbnail/:serverName/:mediaId",
            query_access_token_media_get_supported: true,
            matrix_event_committed: false,
            host_outbox_correlation_created: false,
            provider_delivery_attempted: false,
            cinny_timeline_row_created: false,
          });
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 200,
            responseBody: download.proof,
            tokenRecord: auth.token_record,
          });
          return respondMatrixMediaDownload(res, download);
        } catch (err) {
          if (err instanceof RouteCMatrixMediaClientError) {
            logFacadeTranscript({
              req,
              path,
              endpointClass,
              requestBody,
              responseStatus: err.status,
              responseBody: err.body,
              tokenRecord: auth.token_record,
            });
            return respond(res, err.status, err.body);
          }
          throw err;
        }
      }

      if (req.method === "GET" && path === "/_matrix/client/v3/capabilities") {
        const body = {
          capabilities: {
            "m.room_versions": {
              default: "10",
              available: { 10: "stable" },
            },
            "org.oysterun.routec.facade": {
              enabled: true,
              semantic_namespace: OYSTERUN_SEMANTIC_NAMESPACE,
              committed_transcript_truth: "matrix_room_timeline",
            },
          },
        };
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: body,
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, body);
      }

      if (
        req.method === "GET" &&
        (path === "/_matrix/client/v3/room_keys/version" ||
          path === "/_matrix/client/v3/voip/turnServer" ||
          path === "/_matrix/client/v3/pushrules/")
      ) {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }

        if (path === "/_matrix/client/v3/room_keys/version") {
          const body = {
            ...matrixJsonError(
              "M_NOT_FOUND",
              "No Route C Spike 0 key backup is configured."
            ),
            no_key_backup_synthesized: true,
            key_backup_version_exists: false,
            key_backup_source: "oysterun_no_key_backup_synthesis",
            ...buildRouteCStartupEndpointProof({
              tokenRecord: auth.token_record,
              behavior: "synthesized_no_key_backup_response",
              syntheticReason:
                "matrix_js_sdk_startup_key_backup_probe_without_routec_key_backup",
            }),
          };
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 404,
            responseBody: body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 404, body);
        }

        if (path === "/_matrix/client/v3/voip/turnServer") {
          const body = {
            username: "",
            password: "",
            ttl: 0,
            uris: [],
            uris_count: 0,
            turn_credentials_issued: false,
            ...buildRouteCStartupEndpointProof({
              tokenRecord: auth.token_record,
              behavior: "synthesized_no_turn_available_response",
              syntheticReason:
                "matrix_js_sdk_startup_turn_probe_without_routec_turn_service",
            }),
          };
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 200,
            responseBody: body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 200, body);
        }

        const body = {
          global: {
            override: [],
            content: [],
            room: [],
            sender: [],
            underride: [],
          },
          pushrules_source: "oysterun_synthetic_noop_pushrules",
          global_override_count: 0,
          global_content_count: 0,
          global_room_count: 0,
          global_sender_count: 0,
          global_underride_count: 0,
          ...buildRouteCStartupEndpointProof({
            tokenRecord: auth.token_record,
            behavior: "synthesized_minimal_noop_pushrules_response",
            syntheticReason:
              "matrix_js_sdk_startup_pushrules_probe_without_routec_push_policy",
          }),
        };
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: body,
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, body);
      }

      if (filterCreateParts || filterReadParts) {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }
        if (filterCreateParts) {
          const proof = buildRouteCFilterProof({
            tokenRecord: auth.token_record,
            userId: filterCreateParts.userId,
            filterId: OYSTERUN_BOUND_ROOM_FILTER_ID,
            action: "create_bound_room_lazyload_filter",
            accepted: true,
          });
          writeEndpointAllowlistProof({
            endpoint: "POST /_matrix/client/v3/user/:userId/filter",
            decision: "supported_bound_user_filter_create",
            proof,
            request_filter_redacted: redactMatrixRequestBody(requestBody),
          });
          const body = { filter_id: OYSTERUN_BOUND_ROOM_FILTER_ID };
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 200,
            responseBody: { ...body, routec_filter_proof: proof },
            tokenRecord: auth.token_record,
          });
          return respond(res, 200, body);
        }
        if (filterReadParts.filterId !== OYSTERUN_BOUND_ROOM_FILTER_ID) {
          const proof = buildRouteCFilterProof({
            tokenRecord: auth.token_record,
            userId: filterReadParts.userId,
            filterId: filterReadParts.filterId,
            action: "read_unknown_bound_user_filter",
            accepted: false,
          });
          const body = {
            ...matrixJsonError(
              "M_NOT_FOUND",
              "Route C Matrix facade filter id is not recognized."
            ),
            filter_id: filterReadParts.filterId,
            routec_filter_proof: proof,
          };
          writeEndpointAllowlistProof({
            endpoint: "GET /_matrix/client/v3/user/:userId/filter/:filterId",
            decision: "rejected_unknown_filter_id",
            proof,
          });
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 404,
            responseBody: body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 404, body);
        }
        const filter = buildRouteCBoundRoomFilter(auth.token_record);
        const proof = buildRouteCFilterProof({
          tokenRecord: auth.token_record,
          userId: filterReadParts.userId,
          filterId: filterReadParts.filterId,
          action: "read_bound_room_lazyload_filter",
          accepted: true,
        });
        writeEndpointAllowlistProof({
          endpoint: "GET /_matrix/client/v3/user/:userId/filter/:filterId",
          decision: "supported_bound_user_filter_read",
          proof,
          filter,
        });
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: { ...filter, routec_filter_proof: proof },
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, filter);
      }

      const receiptParts = extractReceiptPathParts(path);
      const readMarkersParts = extractReadMarkersPathParts(path);
      if (typingParts || receiptParts || readMarkersParts) {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }
        const proof = buildRouteCNoopEndpointProof({
          tokenRecord: auth.token_record,
          endpointName: matrixEndpointKey(req, path),
          details: {
            request_path: path,
            request_method: req.method,
            typing_user_id: typingParts?.userId || null,
            receipt_type: receiptParts?.receiptType || null,
            receipt_event_id: receiptParts?.eventId || null,
            read_marker_event_ids_redacted:
              readMarkersParts && isObject(requestBody)
                ? {
                    "m.fully_read":
                      typeof requestBody["m.fully_read"] === "string"
                        ? "[present]"
                        : null,
                    "m.read":
                      typeof requestBody["m.read"] === "string"
                        ? "[present]"
                        : null,
                  }
                : null,
          },
        });
        writeEndpointAllowlistProof({
          endpoint: matrixEndpointKey(req, path),
          decision: "supported_bound_noop_non_pass_side_effect_endpoint",
          proof,
        });
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: 200,
          responseBody: { routec_noop_endpoint_proof: proof },
          tokenRecord: auth.token_record,
        });
        return respond(res, 200, {});
      }

      const sendParts = extractRoomSendPathParts(path);
      if (sendParts) {
        const matrixEventContent = attachRouteCChatAssetLinkAnnotations({
          content: requestBody,
          binding: auth.token_record,
          sessionManager,
        });
        let providerDeliveryDescriptor = null;
        try {
          providerDeliveryDescriptor = describeRouteCSendProviderDelivery({
            content: requestBody,
            binding: auth.token_record,
          });
        } catch (err) {
          if (err instanceof RouteCMatrixMediaClientError) {
            logFacadeTranscript({
              req,
              path,
              endpointClass,
              requestBody,
              responseStatus: err.status,
              responseBody: err.body,
              tokenRecord: auth.token_record,
            });
            return respond(res, err.status, err.body);
          }
          throw err;
        }
        if (!providerDeliveryDescriptor.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: providerDeliveryDescriptor.status,
            responseBody: providerDeliveryDescriptor.body,
            tokenRecord: auth.token_record,
          });
          return respond(
            res,
            providerDeliveryDescriptor.status,
            providerDeliveryDescriptor.body
          );
        }
        const clientRequestId =
          requestBody?.["org.oysterun.host_correlation.v1"]
            ?.client_request_id || null;
        registerRouteCOutboxCorrelation({
          hostSessionId: auth.token_record.host_session_id,
          matrixUserId: auth.token_record.matrix_user_id,
          matrixRoomId: sendParts.roomId,
          txnId: sendParts.txnId,
          eventType: sendParts.eventType,
          clientRequestId,
          clientContent: matrixEventContent,
        });
        const proxied = await routeCMatrixStorageRequest({
          req,
          path,
          url,
          body: matrixEventContent,
          tokenRecord: auth.token_record,
        });
        if (
          proxied.status >= 200 &&
          proxied.status < 300 &&
          typeof proxied.body?.event_id === "string"
        ) {
          recordRouteCMatrixReadAuthorityEvent({
            binding: auth.token_record,
            eventId: proxied.body.event_id,
            eventType: sendParts.eventType,
            senderMatrixUserId: auth.token_record.matrix_user_id,
            senderActorKey:
              auth.token_record.routec_facade_sender_actor_key || "human",
            content: matrixEventContent,
            txnId: sendParts.txnId,
          });
        }
        const sendCorrelation = recordRouteCSendResponse({
          matrixRoomId: sendParts.roomId,
          txnId: sendParts.txnId,
          responseBody: proxied.body,
          forwardedContent: matrixEventContent,
        });
        const host2IntakeProof = buildRouteCHost2IntakeProof(sendCorrelation);
        let providerDeliveryProof = null;
        if (
          proxied.status >= 200 &&
          proxied.status < 300 &&
          typeof proxied.body?.event_id === "string" &&
          providerDeliveryDescriptor.deliver === true
        ) {
          try {
            providerDeliveryProof =
              sessionManager.deliverRouteCMatrixUserEventToProvider({
                sessionId: auth.token_record.host_session_id,
                matrixUserId: auth.token_record.matrix_user_id,
                matrixRoomId: sendParts.roomId,
                serverEventId: proxied.body.event_id,
                txnId: sendParts.txnId,
                text: providerDeliveryDescriptor.text,
                providerText: providerDeliveryDescriptor.providerText || null,
                nickname: "Host Owner",
              });
            providerDeliveryProof = {
              ...providerDeliveryProof,
              ...providerDeliveryDescriptor.proof,
            };
          } catch (err) {
            providerDeliveryProof = {
              status: "provider_delivery_failed",
              delivered: false,
              error: err.message || String(err),
              foundation_pass_claimed: false,
              ...providerDeliveryDescriptor.proof,
            };
          }
        } else {
          providerDeliveryProof = {
            status: "provider_delivery_not_attempted",
            delivered: false,
            reason:
              providerDeliveryDescriptor.reason ||
              "matrix_send_not_successful_or_not_text_or_media_message",
            foundation_pass_claimed: false,
            ...(providerDeliveryDescriptor.proof || {}),
          };
        }
        if (
          providerDeliveryProof &&
          providerDeliveryDescriptor.proof?.routec_phase29_multi_media_send ===
            true &&
          typeof proxied.body?.event_id === "string"
        ) {
          providerDeliveryProof = {
            ...providerDeliveryProof,
            routec_current_matrix_event_id: proxied.body.event_id,
          };
        }
        recordOptionalMatrixFacadeSideEffect(
          () =>
            writeRouteCContentEquivalenceProof({
              clientContent: requestBody,
              forwardedContent: requestBody,
              committedContent: null,
            }),
          {
            operation: "write_routec_content_equivalence_proof",
            request_path: path,
          }
        );
        logFacadeTranscript({
          req,
          path,
          endpointClass,
          requestBody,
          responseStatus: proxied.status,
          responseBody: {
            ...proxied.body,
            matrix_host2_intake_proof: host2IntakeProof,
            provider_delivery_proof: providerDeliveryProof,
          },
          tokenRecord: auth.token_record,
        });
        return respond(res, proxied.status, proxied.body);
      }

      let proxyUrl = url;
      let syncFilterHandlingProof = null;
      if (path === "/_matrix/client/v3/sync") {
        const boundContext = boundFacadeContextOrError({
          sessionManager,
          tokenRecord: auth.token_record,
        });
        if (!boundContext.ok) {
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 403,
            responseBody: boundContext.body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 403, boundContext.body);
        }

        const requestedFilterId = url.searchParams.get("filter");
        if (requestedFilterId === OYSTERUN_BOUND_ROOM_FILTER_ID) {
          proxyUrl = buildUrlWithRouteCInlineSyncFilter(url, auth.token_record);
          syncFilterHandlingProof = buildRouteCSyncFilterProof({
            tokenRecord: auth.token_record,
            requestedFilterId,
            handlingDecision:
              "rewrite_synthetic_filter_to_inline_bound_room_filter_before_host_owned_matrix_storage",
            accepted: true,
            synapseProxyAttempted: false,
            syntheticFilterForwardedUnchanged: false,
          });
          writeEndpointAllowlistProof({
            endpoint: "GET /_matrix/client/v3/sync",
            decision: "synthetic_filter_rewritten_to_inline_bound_room_filter",
            proof: syncFilterHandlingProof,
          });
        } else if (
          requestedFilterId &&
          !isRouteCInlineSyncFilter(requestedFilterId)
        ) {
          syncFilterHandlingProof = buildRouteCSyncFilterProof({
            tokenRecord: auth.token_record,
            requestedFilterId,
            handlingDecision:
              "reject_unknown_or_mismatched_sync_filter_id_fail_closed",
            accepted: false,
            synapseProxyAttempted: false,
            syntheticFilterForwardedUnchanged: false,
          });
          const body = {
            ...matrixJsonError(
              "M_INVALID_PARAM",
              "Route C Matrix facade sync filter id is not recognized."
            ),
            allowlist_decision: "rejected_unknown_or_mismatched_sync_filter_id",
            host_action: "reject_without_synapse_proxy",
            routec_sync_filter_proof: syncFilterHandlingProof,
            browser_direct_synapse_dependency: false,
            synapse_proxy_attempted: false,
            host_outbox_correlation_created: false,
            matrix_event_committed: false,
            cinny_timeline_row_created: false,
            raw_synapse_token_exposed: false,
            foundation_pass_claimed: false,
          };
          writeEndpointAllowlistProof({
            endpoint: "GET /_matrix/client/v3/sync",
            decision: "rejected_unknown_or_mismatched_sync_filter_id",
            proof: syncFilterHandlingProof,
          });
          logFacadeTranscript({
            req,
            path,
            endpointClass,
            requestBody,
            responseStatus: 400,
            responseBody: body,
            tokenRecord: auth.token_record,
          });
          return respond(res, 400, body);
        } else {
          syncFilterHandlingProof = buildRouteCSyncFilterProof({
            tokenRecord: auth.token_record,
            requestedFilterId,
            handlingDecision: requestedFilterId
              ? "accept_client_inline_filter_with_bound_room_response_filtering"
              : "accept_missing_filter_with_bound_room_response_filtering",
            accepted: true,
            synapseProxyAttempted: false,
            syntheticFilterForwardedUnchanged: false,
          });
        }
      }

      let proxied = await routeCMatrixStorageRequest({
        req,
        path,
        url: proxyUrl,
        body: requestBody,
        tokenRecord: auth.token_record,
      });
      let syncScopeProof = null;
      let syncRemoteEchoProof = null;
      if (
        path === "/_matrix/client/v3/sync" &&
        proxied.status >= 200 &&
        proxied.status < 300
      ) {
        const filtered = filterSyncResponseToBoundRoom(
          proxied.body,
          auth.token_record.matrix_room_id
        );
        proxied = {
          ...proxied,
          body: filtered.body,
        };
        syncScopeProof = filtered.scopeProof;
        const boundRoomEvents =
          proxied.body?.rooms?.join?.[auth.token_record.matrix_room_id]
            ?.timeline?.events;
        syncRemoteEchoProof = recordOptionalMatrixFacadeSideEffect(
          () =>
            recordRouteCRemoteEchoFromSync({
              matrixRoomId: auth.token_record.matrix_room_id,
              matrixUserId: auth.token_record.matrix_user_id,
              syncBody: proxied.body,
              rowCountAfterSync: Array.isArray(boundRoomEvents)
                ? boundRoomEvents.length
                : null,
            }),
          {
            operation: "record_routec_remote_echo_from_sync",
            request_path: path,
          }
        );
      }
      const eventParts = extractEventPathParts(path);
      if (eventParts && proxied.status >= 200 && proxied.status < 300) {
        recordOptionalMatrixFacadeSideEffect(
          () =>
            recordRouteCRemoteEcho({
              matrixRoomId: eventParts.roomId,
              serverEventId: eventParts.eventId,
              eventContent: proxied.body?.content || {},
            }),
          {
            operation: "record_routec_remote_echo",
            request_path: path,
          }
        );
      }
      if (path === "/_matrix/client/v3/sync") {
        recordOptionalMatrixFacadeSideEffect(
          () =>
            writeRouteCRoomRowCountTrace({
              sync_seen_at: new Date().toISOString(),
              facade_proxy_ready: proxied.proxy_ready === true,
              sync_room_scope_enforced: true,
              sync_scope_proof: syncScopeProof || {
                sync_filter_applied: false,
                bound_matrix_room_id: auth.token_record.matrix_room_id,
              },
              sync_filter_handling_proof: syncFilterHandlingProof,
              sync_remote_echo_reconciliation_proof: syncRemoteEchoProof,
            }),
          {
            operation: "write_routec_room_row_count_trace",
            request_path: path,
          }
        );
      }
      const transcriptResponseBody =
        path === "/_matrix/client/v3/sync"
          ? {
              ...proxied.body,
              ...(syncFilterHandlingProof
                ? { routec_sync_filter_proof: syncFilterHandlingProof }
                : {}),
              ...(syncRemoteEchoProof
                ? {
                    routec_sync_remote_echo_reconciliation_proof:
                      syncRemoteEchoProof,
                  }
                : {}),
            }
          : proxied.body;
      logFacadeTranscript({
        req,
        path,
        endpointClass,
        requestBody,
        responseStatus: proxied.status,
        responseBody: transcriptResponseBody,
        tokenRecord: auth.token_record,
      });
      return respond(res, proxied.status, proxied.body);
      } catch (err) {
        return respondRouteCMatrixFacadeInternalError({
          req,
          res,
          path,
          respond,
          err,
        });
      }
    },
  };
}
