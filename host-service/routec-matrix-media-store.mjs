import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join } from "path";
import { getConfigDir } from "./config.mjs";

const MEDIA_SCHEMA_VERSION = "routec.host_owned_matrix_media_storage.v1";
const DEFAULT_MEDIA_SERVER_NAME = "oysterun.local";
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

export class RouteCMatrixMediaClientError extends Error {
  constructor(status, errcode, error) {
    super(error);
    this.name = "RouteCMatrixMediaClientError";
    this.status = status;
    this.body = matrixJsonError(errcode, error);
  }
}

function matrixJsonError(errcode, error) {
  return { errcode, error };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function stackRootFromConfigDir(configDir) {
  return basename(configDir) === "host" ? dirname(configDir) : configDir;
}

function configuredMediaRoot() {
  const configured = process.env.OYSTERUN_ROUTEC_MATRIX_MEDIA_ROOT;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  return join(stackRootFromConfigDir(getConfigDir()), "matrix", "media");
}

export function getRouteCMatrixMediaRoot() {
  return configuredMediaRoot();
}

export function getRouteCMatrixMediaIndexPath() {
  const configured = process.env.OYSTERUN_ROUTEC_MATRIX_MEDIA_INDEX_PATH;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  return join(getRouteCMatrixMediaRoot(), "media-index.json");
}

export function getRouteCMatrixMediaMaxUploadSize() {
  const configured = process.env.OYSTERUN_ROUTEC_MATRIX_MEDIA_MAX_UPLOAD_SIZE;
  if (typeof configured !== "string" || !configured.trim()) {
    return DEFAULT_MAX_UPLOAD_SIZE_BYTES;
  }
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `OYSTERUN_ROUTEC_MATRIX_MEDIA_MAX_UPLOAD_SIZE must be a positive integer, got ${configured}`
    );
  }
  return parsed;
}

export function getRouteCMatrixMediaServerName() {
  const configured = process.env.OYSTERUN_ROUTEC_MATRIX_MEDIA_SERVER_NAME;
  const serverName =
    typeof configured === "string" && configured.trim()
      ? configured.trim()
      : DEFAULT_MEDIA_SERVER_NAME;
  if (!/^[A-Za-z0-9_.:-]+$/.test(serverName)) {
    throw new Error(`Invalid Route C Matrix media server name: ${serverName}`);
  }
  return serverName;
}

function initialStore() {
  return {
    schema_version: MEDIA_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    media_by_content_uri: {},
    media_id_to_content_uri: {},
  };
}

function validateStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    throw new Error("Route C Matrix media store must be an object");
  }
  if (store.schema_version !== MEDIA_SCHEMA_VERSION) {
    throw new Error(
      `Route C Matrix media store schema mismatch: ${
        store.schema_version || "missing"
      }`
    );
  }
  if (
    !store.media_by_content_uri ||
    typeof store.media_by_content_uri !== "object" ||
    Array.isArray(store.media_by_content_uri)
  ) {
    throw new Error(
      "Route C Matrix media store missing media_by_content_uri object"
    );
  }
  if (
    !store.media_id_to_content_uri ||
    typeof store.media_id_to_content_uri !== "object" ||
    Array.isArray(store.media_id_to_content_uri)
  ) {
    throw new Error(
      "Route C Matrix media store missing media_id_to_content_uri object"
    );
  }
}

export function readRouteCMatrixMediaStore() {
  const indexPath = getRouteCMatrixMediaIndexPath();
  if (!existsSync(indexPath)) {
    return initialStore();
  }
  const store = JSON.parse(readFileSync(indexPath, "utf8"));
  validateStore(store);
  return store;
}

function writeStore(store) {
  validateStore(store);
  store.updated_at = new Date().toISOString();
  const indexPath = getRouteCMatrixMediaIndexPath();
  mkdirSync(dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(store, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(tempPath, indexPath);
}

function ensureStore() {
  writeStore(readRouteCMatrixMediaStore());
}

function sanitizeFilename(filename) {
  const fallback = "upload.bin";
  const raw =
    typeof filename === "string" && filename.trim()
      ? filename.trim()
      : fallback;
  const leaf = basename(raw.replace(/\\/g, "/"));
  const safeLeaf = leaf && leaf !== "." && leaf !== ".." ? leaf : fallback;
  const ext = extname(safeLeaf)
    .replace(/[^A-Za-z0-9.]/g, "")
    .slice(0, 32);
  const stem = safeLeaf.slice(0, safeLeaf.length - ext.length) || "upload";
  const safeStem =
    stem
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .replace(/^_+$/g, "")
      .slice(0, 96) || "upload";
  return `${safeStem}${ext}`;
}

function normalizeContentType(contentType) {
  if (typeof contentType !== "string") return "application/octet-stream";
  const baseType = contentType.split(";")[0].trim().toLowerCase();
  if (!baseType || /[\r\n]/.test(baseType)) {
    return "application/octet-stream";
  }
  if (
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(baseType)
  ) {
    return "application/octet-stream";
  }
  return baseType;
}

function mediaIdKey(serverName, mediaId) {
  return `${serverName}/${mediaId}`;
}

function parseContentUri(contentUri) {
  if (typeof contentUri !== "string" || !contentUri.trim()) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C Matrix media content_uri is required."
    );
  }
  const match = contentUri.trim().match(/^mxc:\/\/([^/]+)\/([^/?#]+)$/);
  if (!match) {
    throw new RouteCMatrixMediaClientError(
      400,
      "M_INVALID_PARAM",
      "Route C Matrix media content_uri must be an mxc:// server/media id."
    );
  }
  return {
    serverName: decodeURIComponent(match[1]),
    mediaId: decodeURIComponent(match[2]),
  };
}

function buildMediaSideEffectProof() {
  return {
    matrix_event_committed: false,
    provider_delivery_attempted: false,
    assistant_turn_created: false,
    host_outbox_correlation_created: false,
    chat_session_row_created: false,
    cinny_timeline_row_created: false,
    raw_synapse_token_exposed: false,
    synapse_proxy_attempted: false,
    foundation_pass_claimed: false,
  };
}

function responseEntry(entry) {
  return {
    content_uri: entry.content_uri,
    server_name: entry.server_name,
    media_id: entry.media_id,
    saved_path: entry.saved_path,
    saved_path_source: "host_owned_routec_matrix_media_store",
    filename: entry.filename,
    mimetype: entry.mimetype,
    byte_size: entry.byte_size,
    sha256: entry.sha256,
    host_session_id: entry.host_session_id,
    host_agent_id: entry.host_agent_id,
    matrix_room_id: entry.matrix_room_id,
    matrix_user_id: entry.matrix_user_id,
    routec_host_owned_matrix_media_storage: true,
    routec_media_mapping_created: true,
    ...buildMediaSideEffectProof(),
  };
}

export function getRouteCMatrixMediaStoreProof({ ensure = false } = {}) {
  if (ensure) ensureStore();
  return {
    storage_adapter: "host_owned_routec_matrix_media_storage",
    storage_schema_version: MEDIA_SCHEMA_VERSION,
    storage_path: getRouteCMatrixMediaIndexPath(),
    media_root: getRouteCMatrixMediaRoot(),
    storage_path_source: process.env.OYSTERUN_ROUTEC_MATRIX_MEDIA_INDEX_PATH
      ? "OYSTERUN_ROUTEC_MATRIX_MEDIA_INDEX_PATH"
      : "OYSTERUN_CONFIG_DIR_derived_stack_matrix_media_path",
    stack_owned_matrix_media_storage: true,
    max_upload_size_bytes: getRouteCMatrixMediaMaxUploadSize(),
    media_server_name: getRouteCMatrixMediaServerName(),
    media_wildcard_proxy: false,
    raw_synapse_base_url_required: false,
    raw_synapse_token_required: false,
    ...buildMediaSideEffectProof(),
  };
}

export function buildRouteCMatrixMediaConfigBody() {
  const proof = getRouteCMatrixMediaStoreProof({ ensure: true });
  return {
    "m.upload.size": proof.max_upload_size_bytes,
    routec_media_config_source: "host_owned_routec_matrix_media_facade_storage",
    media_upload_enabled: true,
    routec_host_owned_matrix_media_storage: true,
    matrix_media_upload_endpoint: "POST /_matrix/media/v3/upload",
    matrix_media_download_endpoint:
      "GET /_matrix/media/v3/download/:serverName/:mediaId",
    media_wildcard_proxy: false,
    max_upload_size_bytes: proof.max_upload_size_bytes,
    media_server_name: proof.media_server_name,
    storage_path: proof.storage_path,
    saved_path_mapping: "content_uri_to_saved_path",
    matrix_media_thumbnail_endpoint:
      "GET /_matrix/media/v3/thumbnail/:serverName/:mediaId",
    thumbnail_endpoint_returns_original_bytes_until_derivatives_exist: true,
    media_get_query_access_token_supported: true,
    ...buildMediaSideEffectProof(),
  };
}

export function createRouteCMatrixMediaUpload({
  bodyBuffer,
  filename,
  contentType,
  binding,
}) {
  if (!Buffer.isBuffer(bodyBuffer)) {
    throw new Error("Route C Matrix media upload requires a Buffer body");
  }
  const maxUploadSize = getRouteCMatrixMediaMaxUploadSize();
  if (bodyBuffer.length > maxUploadSize) {
    throw new RouteCMatrixMediaClientError(
      413,
      "M_TOO_LARGE",
      `Route C Matrix media upload exceeds ${maxUploadSize} bytes`
    );
  }
  if (!binding?.host_session_id || !binding?.matrix_room_id) {
    throw new RouteCMatrixMediaClientError(
      403,
      "M_FORBIDDEN",
      "Route C Matrix media upload requires a bound Host session and Matrix room."
    );
  }

  const mediaRoot = getRouteCMatrixMediaRoot();
  const serverName = getRouteCMatrixMediaServerName();
  const mediaId = randomUUID().replace(/-/g, "");
  const safeFilename = sanitizeFilename(filename);
  const directoryName = mediaId.slice(0, 2);
  const savedPath = join(
    mediaRoot,
    "content",
    directoryName,
    `${mediaId}-${safeFilename}`
  );
  const contentUri = `mxc://${serverName}/${mediaId}`;
  const entry = {
    content_uri: contentUri,
    server_name: serverName,
    media_id: mediaId,
    saved_path: savedPath,
    original_filename:
      typeof filename === "string" && filename.trim() ? filename.trim() : null,
    filename: safeFilename,
    mimetype: normalizeContentType(contentType),
    byte_size: bodyBuffer.length,
    sha256: sha256(bodyBuffer),
    created_at: new Date().toISOString(),
    host_session_id: binding.host_session_id,
    host_agent_id: binding.host_agent_id || null,
    matrix_room_id: binding.matrix_room_id,
    matrix_user_id: binding.matrix_user_id || null,
    routec_host_owned_matrix_media_storage: true,
    ...buildMediaSideEffectProof(),
  };

  mkdirSync(dirname(savedPath), { recursive: true });
  const tempPath = `${savedPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, bodyBuffer, { mode: 0o600 });
  renameSync(tempPath, savedPath);

  const store = readRouteCMatrixMediaStore();
  store.media_by_content_uri[contentUri] = entry;
  store.media_id_to_content_uri[mediaIdKey(serverName, mediaId)] = contentUri;
  writeStore(store);

  return {
    entry,
    response_body: responseEntry(entry),
  };
}

export function readRouteCMatrixMediaDownload({
  serverName,
  mediaId,
  binding,
}) {
  const store = readRouteCMatrixMediaStore();
  const contentUri =
    store.media_id_to_content_uri[mediaIdKey(serverName, mediaId)];
  if (!contentUri) {
    throw new RouteCMatrixMediaClientError(
      404,
      "M_NOT_FOUND",
      "Route C Matrix media not found in Host-owned storage."
    );
  }
  const entry = store.media_by_content_uri[contentUri];
  if (!entry) {
    throw new RouteCMatrixMediaClientError(
      404,
      "M_NOT_FOUND",
      "Route C Matrix media mapping is missing from Host-owned storage."
    );
  }
  if (
    entry.host_session_id !== binding.host_session_id ||
    entry.matrix_room_id !== binding.matrix_room_id
  ) {
    throw new RouteCMatrixMediaClientError(
      403,
      "M_FORBIDDEN",
      "Route C Matrix media is not bound to this Host session and Matrix room."
    );
  }
  const buffer = readFileSync(entry.saved_path);
  return {
    entry,
    buffer,
    contentType: entry.mimetype || "application/octet-stream",
    filename: entry.filename || "download.bin",
    proof: {
      ...responseEntry(entry),
      routec_media_mapping_resolved: true,
      downloaded_byte_size: buffer.length,
    },
  };
}

export function resolveRouteCMatrixMediaContentUri({ contentUri, binding }) {
  const { serverName, mediaId } = parseContentUri(contentUri);
  const store = readRouteCMatrixMediaStore();
  const storedContentUri =
    store.media_id_to_content_uri[mediaIdKey(serverName, mediaId)];
  if (!storedContentUri || storedContentUri !== contentUri) {
    throw new RouteCMatrixMediaClientError(
      404,
      "M_NOT_FOUND",
      "Route C Matrix media content_uri is not mapped in Host-owned storage."
    );
  }
  const entry = store.media_by_content_uri[storedContentUri];
  if (!entry) {
    throw new RouteCMatrixMediaClientError(
      404,
      "M_NOT_FOUND",
      "Route C Matrix media mapping is missing from Host-owned storage."
    );
  }
  if (
    entry.host_session_id !== binding.host_session_id ||
    entry.matrix_room_id !== binding.matrix_room_id
  ) {
    throw new RouteCMatrixMediaClientError(
      403,
      "M_FORBIDDEN",
      "Route C Matrix media is not bound to this Host session and Matrix room."
    );
  }
  return {
    entry,
    proof: {
      ...responseEntry(entry),
      routec_media_mapping_resolved: true,
      routec_phase17_3_saved_path_provider_prompt_ready: true,
    },
  };
}
