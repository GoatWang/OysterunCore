import { spawn } from "child_process";
import { createRequire } from "module";
import { createServer } from "http";
import {
  appendFile,
  createReadStream,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  existsSync,
  statSync,
  realpathSync,
  mkdirSync,
} from "fs";
import { join, dirname, basename, resolve, extname, relative } from "path";
import { fileURLToPath } from "url";
import { createHash, randomUUID } from "crypto";
import { performance } from "perf_hooks";
import { brotliCompressSync, gzipSync } from "zlib";
import { WebSocketServer } from "ws";
import { SessionManager } from "./session-manager.mjs";
import { createTunnelAgent } from "./tunnel-agent-factory.mjs";
import {
  buildInitialSharedAgentConfig,
  getConfigDir,
  getConfigPath,
  getConfigSource,
  getDefaultConfig,
  getDefaultHostDisplayName,
  getDefaultProviderPermissionPolicy,
  getDefaultSharedAllowedPaths,
  getDefaultSessionDefaults,
  getConfigValue,
  isProviderPermissionDebugModeEnabled,
  normalizeClaudePermissionMode,
  normalizeProviderModel,
  normalizeProviderPermissionPolicy,
  normalizeProviderReasoningEffort,
  normalizeSessionDefaults,
  normalizeHostDefaultInterfaceType,
  normalizePublicBaseUrlInput,
  readConfig,
  writeConfig,
  resolveDefaultBrowsePath,
  resolveDirectoryPath,
  resolveHomePath,
  buildCloudApiUrl,
  resolveCloudBackendStage,
} from "./config.mjs";
import {
  hashDashboardPassword,
  verifyDashboardPassword,
} from "./dashboard-password.mjs";
import {
  buildCompactDirectHostLoginQrPayload,
  buildDirectHostLoginQrPayload,
  consumeHostLoginBootstrapToken,
  createHostLoginBootstrapToken,
} from "./host-login-bootstrap-tokens.mjs";
import {
  FULL_DISK_ACCESS_SETTINGS_URI,
  openFullDiskAccessSettings,
  supportsMacFolderAccessPermissions,
} from "./macos-permissions.mjs";
import { authenticateRequest, verifyAccessToken } from "./jwt-auth.mjs";
import {
  readAgentConfigLayers,
  resolveAgentSessionProfileConfig,
  resolveAgentNotificationConfigFromLayers,
  resolveAgentTelegramConfigFromLayers,
  resolveAgentWebConfig,
  resolveAgentRuntimeConfig,
  serializeAgentNotificationConfig,
  serializeAgentTelegramConfig,
  resolveSharedAllowedPaths,
  resolveWorkspacePolicy,
  summarizeAgentConfig,
} from "./agent-config.mjs";
import {
  getAgentFolder,
  setAgentFolder,
  updateAgentSession,
  readAgentRegistry,
} from "./agent-registry.mjs";
import { buildLinkAnnotations } from "./link-annotations.mjs";
import { hasAgentAccess, hasAgentCapability } from "./host-authz.mjs";
import {
  createProviderUnavailableError,
  getConfiguredProviderCommand,
  isDebugFixtureProviderEnabled,
  isProviderCommandAvailable,
  listProviders,
  requireProvider,
} from "./provider-registry.mjs";
import { ProviderModelRefreshRunner } from "./provider-model-refresh-runner.mjs";
import {
  ProviderAuthManager,
  serializeProviderAuthStatus,
} from "./provider-auth.mjs";
import { getSessionHistory } from "./session-history.mjs";
import {
  buildDefaultBranchName,
  buildSessionNameConflictMessage,
  buildUniqueDefaultBranchName,
  buildUniqueDefaultSessionName,
  normalizeSessionName,
} from "./session-name.mjs";
import { getSessionNameCounterStore } from "./session-name-counter-store.mjs";
import { createFolder, listFolderPage } from "./folder-browser.mjs";
import { attachRuntimeTurnId } from "./runtime-turn-events.mjs";
import { TerminalSessionManager } from "./terminal-session-manager.mjs";
import {
  HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY,
  buildHostRestartRestoreSummary,
  consumeHostRestartRestoreState,
  getHostRestartRestoreStatePath,
  prepareHostRestartRestoreState,
  readHostRestartRestoreState,
  validateConsumableHostRestartRestoreState,
} from "./restart-restore-state.mjs";
import {
  LOCAL_SERVICE_CONTROL_HEADER,
  ensureLocalServiceControlToken,
  isLoopbackRemoteAddress,
  verifyLocalServiceControlToken,
} from "./service-control-token.mjs";
import {
  getUpdateOperationStatePath,
  markUpdateVersionNoticed,
  readUpdateOperationState,
  readUpdateReminderState,
  updateReminderState,
  writeUpdateOperationState,
} from "./update-reminder-state.mjs";
import {
  appendHostRuntimeDiagnostic,
  readHostRuntimeMetadataStatus,
  serializeRuntimeError,
  writeHostRuntimeMetadata,
} from "./host-runtime-diagnostics.mjs";
import { createRouteCMatrixFacade } from "./matrix-facade.mjs";
import {
  createRouteCMatrixRoomBinding,
  getRouteCMatrixRoomBinding,
  requireRouteCMatrixRoomBinding,
} from "./matrix-room-binding.mjs";
import {
  readMatrixTranscriptLatestCommittedSeq,
  readMatrixTranscriptMessagesAfter,
  readMatrixTranscriptPage,
} from "./matrix-transcript-read-adapter.mjs";
import {
  checkRouteCMatrixStorageHealth,
  copyRouteCMatrixRoomTimeline,
  ensureRouteCMatrixRoomStorage,
  getRouteCMatrixRoomTimelineReplaySourceProof,
  readRouteCMatrixToolEventDetail,
  runRouteCMatrixStorageWriteBatch,
} from "./routec-matrix-storage-adapter.mjs";
import {
  cancelRouteCHost2IntakeForMatrixEvent,
  getRouteCHost2IntakeProof,
} from "./matrix-event-correlator.mjs";
import {
  buildDemotedLoopStopCommandResponse,
  isDemotedLoopStopCommandInput,
  SchedulerService,
} from "./scheduler-service.mjs";
import {
  ROUTEC_LARGE_TOOL_EVENT_THRESHOLD,
  ROUTEC_LARGE_TOOL_EVENT_COUNT_LABEL,
  ROUTEC_LARGE_TOOL_JSONL_PAGE_SIZE,
  ROUTEC_LARGE_TOOL_NOTICE_BODY,
  ROUTEC_LARGE_TOOL_NOTICE_KIND,
  createLargeToolCallStore,
} from "./large-tool-call-store.mjs";
import {
  ROUTEC_TOOL_EVENT_DETAIL_PAGE_SIZE_BYTES,
  ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES,
  createToolEventDetailStore,
} from "./tool-event-detail-store.mjs";
import { SchedulerRunner } from "./scheduler-runner.mjs";
import { runSchedulerDirectProviderCommand } from "./scheduler-direct-provider-runner.mjs";
import { getHostSystemTimezone } from "./scheduler-rule-model.mjs";
import {
  DEFAULT_HOST_APP_USER_ID,
  MAIL_CREATE_SCOPE,
  MailStore,
} from "./mail-store.mjs";
import {
  readApnsLocalConfig,
  serializeApnsLocalConfigStatus,
} from "./apns-config.mjs";
import {
  ApnsDeviceStore,
  serializeApnsDevice,
} from "./apns-device-store.mjs";
import { ApnsCompleteMessageDispatcher } from "./apns-complete-message-dispatcher.mjs";
import {
  ApnsMailNotificationDispatcher,
  buildCommittedMailNotificationCandidate,
} from "./mail-notification-dispatcher.mjs";
import {
  createTelegramBotApiAdapter,
  createTelegramMockAdapter,
} from "./telegram-adapter.mjs";
import { createTelegramBridgeManager } from "./telegram-bridge.mjs";

// ── Dashboard static file ────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const QRCode = require("qrcode-terminal/vendor/QRCode");
const QRErrorCorrectLevel = require(
  "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel"
);
const REPO_ROOT = resolve(__dirname, "..");
const STATIC_ROOT = join(__dirname, "..", "static");
const ROUTEC_WEB_CHAT_DIST_ROOT = resolve(
  __dirname,
  "..",
  "dev",
  "client",
  "web-chat",
  "dist"
);
const ROUTEC_WEB_CHAT_INDEX_PATH = join(
  ROUTEC_WEB_CHAT_DIST_ROOT,
  "index.html"
);
const WEB_CHAT_ASSET_BASE_PATH = "/app/chat-assets/";
const WEB_CHAT_STATIC_PREWARM_MANIFEST_PATH = `${WEB_CHAT_ASSET_BASE_PATH}static-prewarm-manifest.json`;
const WEB_CHAT_SERVICE_WORKER_ALLOWED_PATH = "/app/sessions/";
const LEGACY_ROUTE_C_ASSET_BASE_PATH = "/route-c/";
const LEGACY_ROUTE_C_ROOT_REDIRECT_LOCATION =
  "/app/sessions?notice=legacy_route_c";
const ROUTEC_STATIC_PREWARM_SCHEMA_VERSION =
  "routec.static_prewarm_manifest.v1";
const ROUTEC_WEB_CHAT_IMMUTABLE_STATIC_CACHE_CONTROL =
  "public, max-age=31536000, immutable";
const ROUTEC_WEB_CHAT_STATIC_PREWARM_SECONDARY_LIMIT = 24;
const DASHBOARD_NOTIFICATION_SW_PATH = join(
  __dirname,
  "..",
  "dev",
  "client",
  "web",
  "notification-sw.js"
);
const STATIC_CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});
const ROUTEC_COMPRESSIBLE_STATIC_EXTENSIONS = Object.freeze(
  new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt"])
);
const ROUTEC_IDENTITY_STATIC_EXTENSIONS = Object.freeze(
  new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".ico",
    ".ogg",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".pdf",
    ".wasm",
  ])
);
let dashboardHtml;
let dashboardNotificationServiceWorker;
const HOST_DEFAULT_SESSION_DEFAULTS_JSON_PLACEHOLDER =
  "__HOST_DEFAULT_SESSION_DEFAULTS_JSON__";
const HOST_DEFAULT_SHARED_ALLOWED_PATHS_JSON_PLACEHOLDER =
  "__HOST_DEFAULT_SHARED_ALLOWED_PATHS_JSON__";
const HOST_SYSTEM_TIMEZONE_JSON_PLACEHOLDER = "__HOST_SYSTEM_TIMEZONE_JSON__";
const ROUTEC_AUTH_LOSS_DIAGNOSTICS_ENABLED_JSON_PLACEHOLDER =
  "__HOST_ROUTEC_AUTH_LOSS_DIAGNOSTICS_ENABLED_JSON__";
try {
  dashboardHtml = readFileSync(
    join(__dirname, "..", "dev", "client", "web", "index.html"),
    "utf-8"
  );
} catch {
  dashboardHtml = "<h1>Dashboard not found</h1>";
  console.warn(
    "[oysterun-host] Dashboard HTML not found at dev/client/web/index.html"
  );
}
try {
  dashboardNotificationServiceWorker = readFileSync(
    DASHBOARD_NOTIFICATION_SW_PATH,
    "utf-8"
  );
} catch {
  dashboardNotificationServiceWorker = "";
  console.warn(
    "[oysterun-host] Dashboard notification service worker not found at dev/client/web/notification-sw.js"
  );
}

// ── Config (env vars take precedence over ~/.oysterun/config.json) ──

const DEFAULT_HOST_CONFIG = getDefaultConfig();
const CONNECTION_MODE =
  getConfigValue("connection_mode", "OYSTERUN_CONNECTION_MODE") === "cloud"
    ? "cloud"
    : "direct";
const PORT = parseInt(
  getConfigValue("port", "OYSTERUN_PORT") || String(DEFAULT_HOST_CONFIG.port),
  10
);
let localServiceControlReady = false;
try {
  ensureLocalServiceControlToken({ configDir: getConfigDir() });
  localServiceControlReady = true;
} catch (err) {
  console.warn(
    `[oysterun-host] Local service-control token unavailable: ${err.message}`
  );
}
// Mutable so a first-run auto-registration (ensureHostCloudRegistration below)
// can refresh them after writing the provisioned device_token to cloud_identity.json —
// closures that read these names pick up the new values automatically.
let BACKEND_URL =
  getConfigValue("backend_url", "OYSTERUN_BACKEND_URL") ||
  DEFAULT_HOST_CONFIG.backend_url;
let BACKEND_STAGE = resolveCloudBackendStage();
let DEVICE_ID = getConfigValue("device_id", "OYSTERUN_DEVICE_ID");
let DEVICE_SIGNING_PUBLIC_KEY =
  getConfigValue(
    "device_signing_public_key",
    "OYSTERUN_DEVICE_SIGNING_PUBLIC_KEY"
  ) || getConfigValue("cloud_public_key", "OYSTERUN_CLOUD_PUBLIC_KEY");
let DEVICE_SIGNING_KID = getConfigValue(
  "device_signing_kid",
  "OYSTERUN_DEVICE_SIGNING_KID"
);
let DEVICE_TOKEN = getConfigValue("device_token", "OYSTERUN_DEVICE_TOKEN");
let DIRECT_HOST_URL =
  getConfigValue("direct_host_url", "OYSTERUN_DIRECT_HOST_URL") ||
  getConfigValue("public_base_url", "OYSTERUN_PUBLIC_BASE_URL");
const HOST_RUNTIME_STARTED_AT = new Date().toISOString();
const TUNNEL_PROVIDER = getConfigValue("tunnel_provider", "OYSTERUN_TUNNEL_PROVIDER") || "frp";
const NGROK_DOMAIN = getConfigValue("ngrok_domain", "OYSTERUN_NGROK_DOMAIN");
const FRP_SERVER_ADDR = getConfigValue("frp_server_addr", "OYSTERUN_FRP_SERVER_ADDR");
const FRP_SERVER_PORT = parseInt(getConfigValue("frp_server_port", "OYSTERUN_FRP_SERVER_PORT") || "0", 10);
const FRP_TOKEN = getConfigValue("frp_token", "OYSTERUN_FRP_TOKEN");
const FRP_SUBDOMAIN = getConfigValue("frp_subdomain", "OYSTERUN_FRP_SUBDOMAIN");
const FRP_SUBDOMAIN_HOST = getConfigValue("frp_subdomain_host", "OYSTERUN_FRP_SUBDOMAIN_HOST");
const HEARTBEAT_INTERVAL = parseInt(
  process.env.OYSTERUN_HEARTBEAT_INTERVAL || "60000",
  10
);
const PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE_ENV =
  "OYSTERUN_PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE";
const SHELL_EXEC_TIMEOUT_MS = 30000;
const SHELL_EXEC_FORCE_KILL_GRACE_MS = 2000;
const DEPRECATED_SESSION_UPLOADS_ROUTE_ERROR =
  "The deprecated /session/uploads product upload route is disabled.";
const DEV_FILE_PREVIEW_MAX_BYTES = 64 * 1024;
const DEV_FILE_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
const DEV_FILE_DOWNLOAD_LIMIT_CODE = "file_download_size_limit";
const DEV_FILE_TEXT_SNIFF_BYTES = 4096;
const DEV_FILE_MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const DEV_FILE_HTML_EXTENSIONS = new Set([".html", ".htm"]);
const DEV_FILE_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const DEV_FILE_CODE_LANGUAGE_BY_EXTENSION = Object.freeze({
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".html": "html",
  ".htm": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sh": "bash",
  ".sql": "sql",
  ".svg": "xml",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".vue": "xml",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "bash",
});
const DEV_FILE_CODE_LANGUAGE_BY_BASENAME = Object.freeze({
  dockerfile: "dockerfile",
  makefile: "makefile",
});
const DEV_FILE_TEXT_EXTENSIONS = new Set([
  ".cfg",
  ".conf",
  ".csv",
  ".env",
  ".gitignore",
  ".ini",
  ".lock",
  ".log",
  ".npmrc",
  ".text",
  ".toml",
  ".txt",
  ".xml",
]);
const DEV_FILE_CONTENT_TYPES = Object.freeze({
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".sh": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
});
const DELIVERABLE_CONTENT_TYPES = Object.freeze({
  ...DEV_FILE_CONTENT_TYPES,
  ".csv": "text/csv; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
});

// ── Dashboard Auth (config-file credentials, temporary until Cloud) ──

/** @type {Map<string, { issuedAtMs: number }>} Active dashboard session records */
const dashboardSessions = new Map();
const DASHBOARD_COOKIE_NAME = "oysterun_dashboard_token";
const DELIVERABLE_COOKIE_NAME = "oysterun_deliverable_token";
/** @type {Map<string, { agentId: string }>} */
const deliverableTokens = new Map();
const BROWSER_HANDOFF_TTL_MS = 60 * 1000;
/** @type {Map<string, { routePrefix: string, agentId: string, targetPath: string, expiresAtMs: number }>} */
const browserHandoffTokens = new Map();
const TRANSCRIPT_PAGE_DEFAULT_LIMIT = 20;
const TRANSCRIPT_PAGE_MAX_LIMIT = 100;

function getCurrentTimeMs() {
  const configuredNowFile = process.env.OYSTERUN_TEST_NOW_FILE;
  if (!configuredNowFile) {
    return Date.now();
  }
  if (!existsSync(configuredNowFile)) {
    return Date.now();
  }
  const rawNow = readFileSync(configuredNowFile, "utf-8").trim();
  if (!rawNow) {
    return Date.now();
  }
  const parsedNow = Number(rawNow);
  if (!Number.isInteger(parsedNow)) {
    throw new Error(
      `Invalid OYSTERUN_TEST_NOW_FILE value in ${configuredNowFile}`
    );
  }
  return parsedNow;
}

function renderDashboardHtml() {
  return dashboardHtml
    .replace(
      HOST_DEFAULT_SESSION_DEFAULTS_JSON_PLACEHOLDER,
      JSON.stringify(getDefaultSessionDefaults())
    )
    .replace(
      HOST_DEFAULT_SHARED_ALLOWED_PATHS_JSON_PLACEHOLDER,
      JSON.stringify(getDefaultSharedAllowedPaths())
    )
    .replace(
      HOST_SYSTEM_TIMEZONE_JSON_PLACEHOLDER,
      JSON.stringify(getHostSystemTimezone())
    )
    .replace(
      ROUTEC_AUTH_LOSS_DIAGNOSTICS_ENABLED_JSON_PLACEHOLDER,
      JSON.stringify(
        readConfig().debug_routec_auth_loss_diagnostics_enabled === true
      )
    );
}

function normalizeAcceptEncodingHeader(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((value) => typeof value === "string").join(",");
  }
  return typeof rawValue === "string" ? rawValue : "";
}

function getAcceptEncodingQuality(rawHeader, encoding) {
  const normalizedEncoding = String(encoding || "").toLowerCase();
  if (!normalizedEncoding) return 0;
  const rawAcceptEncoding = normalizeAcceptEncodingHeader(rawHeader);
  if (!rawAcceptEncoding.trim()) return 0;

  let explicitQuality = null;
  let wildcardQuality = null;
  for (const rawEntry of rawAcceptEncoding.split(",")) {
    const parts = rawEntry
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;
    const entryEncoding = parts[0].toLowerCase();
    let quality = 1;
    for (const param of parts.slice(1)) {
      const separatorIndex = param.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = param.slice(0, separatorIndex).trim().toLowerCase();
      if (key !== "q") continue;
      const parsedQuality = Number.parseFloat(
        param.slice(separatorIndex + 1).trim()
      );
      quality =
        Number.isFinite(parsedQuality) && parsedQuality >= 0
          ? Math.min(parsedQuality, 1)
          : 0;
    }
    if (entryEncoding === normalizedEncoding) {
      explicitQuality = quality;
    } else if (entryEncoding === "*") {
      wildcardQuality = quality;
    }
  }

  return explicitQuality ?? wildcardQuality ?? 0;
}

function chooseRouteCStaticContentEncoding(req) {
  const acceptEncoding = req?.headers?.["accept-encoding"];
  if (
    typeof brotliCompressSync === "function" &&
    getAcceptEncodingQuality(acceptEncoding, "br") > 0
  ) {
    return "br";
  }
  if (getAcceptEncodingQuality(acceptEncoding, "gzip") > 0) {
    return "gzip";
  }
  return null;
}

function isRouteCCompressibleStaticResponse(contentType, assetPath = null) {
  const extension =
    typeof assetPath === "string" ? extname(assetPath).toLowerCase() : "";
  if (ROUTEC_IDENTITY_STATIC_EXTENSIONS.has(extension)) return false;
  if (ROUTEC_COMPRESSIBLE_STATIC_EXTENSIONS.has(extension)) return true;
  if (extension) return false;

  const normalizedContentType = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return (
    normalizedContentType.startsWith("text/") ||
    normalizedContentType === "application/json" ||
    normalizedContentType === "image/svg+xml"
  );
}

function getHeaderValue(headers, headerName) {
  const normalizedHeaderName = String(headerName || "").toLowerCase();
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === normalizedHeaderName
  );
  return key ? headers[key] : null;
}

function removeHeader(headers, headerName) {
  const normalizedHeaderName = String(headerName || "").toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) {
      delete headers[key];
    }
  }
}

function addVaryAcceptEncoding(headers) {
  const varyKey =
    Object.keys(headers).find((key) => key.toLowerCase() === "vary") || "Vary";
  const existingValue =
    typeof headers[varyKey] === "string" ? headers[varyKey] : "";
  const existingTokens = existingValue
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (existingTokens.includes("*") || existingTokens.includes("accept-encoding")) {
    return;
  }
  headers[varyKey] = existingValue
    ? `${existingValue}, Accept-Encoding`
    : "Accept-Encoding";
}

function buildRouteCStaticResponse(req, body, headers, { assetPath = null } = {}) {
  const responseHeaders = { ...headers };
  const rawBody = Buffer.isBuffer(body)
    ? body
    : Buffer.from(String(body ?? ""), "utf-8");
  const contentType = getHeaderValue(responseHeaders, "Content-Type");
  if (!isRouteCCompressibleStaticResponse(contentType, assetPath)) {
    return { body: rawBody, headers: responseHeaders, encoding: null };
  }

  const encoding = chooseRouteCStaticContentEncoding(req);
  if (!encoding) {
    return { body: rawBody, headers: responseHeaders, encoding: null };
  }

  const encodedBody =
    encoding === "br" ? brotliCompressSync(rawBody) : gzipSync(rawBody);
  responseHeaders["Content-Encoding"] = encoding;
  addVaryAcceptEncoding(responseHeaders);
  removeHeader(responseHeaders, "Content-Length");
  return { body: encodedBody, headers: responseHeaders, encoding };
}

function createRouteCStaticSha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function serveDashboardHtml(req, res, extraHeaders = {}) {
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    ...extraHeaders,
  };
  const response = buildRouteCStaticResponse(req, renderDashboardHtml(), headers);
  res.writeHead(200, response.headers);
  res.end(response.body);
}

function serveDashboardNotificationServiceWorker(req, res) {
  if (!dashboardNotificationServiceWorker) {
    return respondText(
      res,
      503,
      "Dashboard notification service worker unavailable",
      {
        "Cache-Control": "no-store",
      }
    );
  }
  const headers = {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Service-Worker-Allowed": "/app/",
  };
  const response = buildRouteCStaticResponse(
    req,
    dashboardNotificationServiceWorker,
    headers
  );
  res.writeHead(200, response.headers);
  res.end(response.body);
  return true;
}

function isRouteCMatrixBindingNotFoundError(err) {
  return (
    err instanceof Error &&
    err.message.includes("Route C Matrix room binding not found")
  );
}

const LAST_MESSAGE_PREVIEW_MAX_LENGTH = 80;
const LAST_MESSAGE_PREVIEW_MATRIX_PAGE_LIMIT = 20;
const LAST_MESSAGE_PREVIEW_SKIPPED_MESSAGE_TYPES = new Set([
  "control_status",
  "runtime_error",
  "session_lifecycle",
  "transport_error",
]);

function formatLastMessagePreviewText(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > LAST_MESSAGE_PREVIEW_MAX_LENGTH
    ? trimmed.slice(0, LAST_MESSAGE_PREVIEW_MAX_LENGTH) + "…"
    : trimmed;
}

function previewTextFromTranscriptMessage(msg) {
  const raw =
    typeof msg?.content === "string" && msg.content.trim()
      ? msg.content
      : typeof msg?.tool_summary === "string" && msg.tool_summary.trim()
      ? msg.tool_summary
      : typeof msg?.text === "string" && msg.text.trim()
      ? msg.text
      : null;
  return formatLastMessagePreviewText(raw);
}

function getLastMatrixMessagePreviewForBinding(binding) {
  const page = readMatrixTranscriptPage({
    binding,
    limit: LAST_MESSAGE_PREVIEW_MATRIX_PAGE_LIMIT,
  });
  const messages = Array.isArray(page?.messages) ? page.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (LAST_MESSAGE_PREVIEW_SKIPPED_MESSAGE_TYPES.has(msg?.message_type)) {
      continue;
    }
    if (msg?.role === "control-status") {
      continue;
    }
    const preview = previewTextFromTranscriptMessage(msg);
    if (preview) return preview;
  }
  return null;
}

function getLastMessagePreview(agentFolder, agentId, sessionId) {
  const binding = getRouteCMatrixRoomBinding(sessionId);
  if (binding) {
    if (agentId && binding.host_agent_id !== agentId) return null;
    try {
      return getLastMatrixMessagePreviewForBinding(binding);
    } catch {
      return null;
    }
  }
  return null;
}

function parseTranscriptPageLimit(rawLimit) {
  if (rawLimit === null || rawLimit === undefined || rawLimit === "") {
    return TRANSCRIPT_PAGE_DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("limit query param must be a positive integer");
  }
  return Math.min(parsed, TRANSCRIPT_PAGE_MAX_LIMIT);
}

function parseTranscriptAfterSeq(rawAfterSeq) {
  if (rawAfterSeq === null || rawAfterSeq === undefined || rawAfterSeq === "") {
    return 0;
  }
  const parsed = Number.parseInt(String(rawAfterSeq), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("after_seq query param must be a non-negative integer");
  }
  return parsed;
}

function encodeTranscriptPageCursor(cursor) {
  if (!cursor) return null;
  return Buffer.from(
    JSON.stringify([cursor.created_at, cursor.seq]),
    "utf-8"
  ).toString("base64url");
}

function decodeTranscriptPageCursor(rawCursor) {
  if (rawCursor === null || rawCursor === undefined || rawCursor === "") {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(String(rawCursor), "base64url").toString("utf-8")
    );
    const [createdAt, seq] = decoded;
    if (
      !Array.isArray(decoded) ||
      typeof createdAt !== "string" ||
      Number.isNaN(Date.parse(createdAt)) ||
      !Number.isInteger(seq) ||
      seq < 1
    ) {
      throw new Error("invalid cursor");
    }
    return { created_at: createdAt, seq };
  } catch {
    throw new Error("before query param must be a valid transcript cursor");
  }
}

function parseOptionalBooleanQuery(rawValue, queryName) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  throw new Error(`${queryName} query param must be a boolean`);
}

function resolveStaticAssetPath(requestPath) {
  if (typeof requestPath !== "string" || !requestPath.startsWith("/static/")) {
    return null;
  }
  const relativePath = requestPath.slice("/static/".length);
  if (!relativePath) {
    return null;
  }
  const assetPath = resolve(STATIC_ROOT, relativePath);
  const assetRelativePath = relative(STATIC_ROOT, assetPath);
  if (!assetRelativePath || assetRelativePath.startsWith("..")) {
    return null;
  }
  return assetPath;
}

function serveStaticAsset(req, res, requestPath) {
  const assetPath = resolveStaticAssetPath(requestPath);
  if (!assetPath || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
    return false;
  }
  const contentType =
    STATIC_CONTENT_TYPES[extname(assetPath).toLowerCase()] ||
    "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=300",
  };
  const response = buildRouteCStaticResponse(req, readFileSync(assetPath), headers, {
    assetPath,
  });
  res.writeHead(200, response.headers);
  res.end(response.body);
  return true;
}

function getWebChatAppContentType(realPath) {
  return (
    STATIC_CONTENT_TYPES[extname(realPath).toLowerCase()] ||
    "application/octet-stream"
  );
}

function normalizeWebChatDistRelativePath(rawRelativePath) {
  return String(rawRelativePath || "").replace(/\\/g, "/");
}

function getWebChatDistRelativePath(realPath) {
  return normalizeWebChatDistRelativePath(
    relative(ROUTEC_WEB_CHAT_DIST_ROOT, realPath)
  );
}

function isRouteCSafeWebChatStaticPrewarmRelativePath(relativePath) {
  const normalizedRelativePath =
    normalizeWebChatDistRelativePath(relativePath);
  if (!normalizedRelativePath.startsWith("assets/")) return false;
  const extension = extname(normalizedRelativePath).toLowerCase();
  if (extension !== ".js" && extension !== ".css") return false;
  return /-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(
    basename(normalizedRelativePath)
  );
}

function getWebChatAppAssetCacheControl(
  readableAssetPath,
  { legacyRouteCAsset = false } = {}
) {
  if (legacyRouteCAsset) return "no-store";
  const assetRelativePath = getWebChatDistRelativePath(readableAssetPath);
  return isRouteCSafeWebChatStaticPrewarmRelativePath(assetRelativePath)
    ? ROUTEC_WEB_CHAT_IMMUTABLE_STATIC_CACHE_CONTROL
    : "no-store";
}

function getWebChatPrewarmAssetKind(realPath) {
  const extension = extname(realPath).toLowerCase();
  if (extension === ".js") return "javascript";
  if (extension === ".css") return "stylesheet";
  return "static";
}

function listWebChatDistFiles(dir = ROUTEC_WEB_CHAT_DIST_ROOT) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listWebChatDistFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function extractWebChatPrewarmCriticalPaths(indexHtml) {
  const criticalPaths = new Set();
  const html = String(indexHtml || "");
  const tagPattern = /<(script|link)\b[^>]+(?:src|href)="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const assetPath = match[2];
    if (!assetPath.startsWith(WEB_CHAT_ASSET_BASE_PATH)) continue;
    const relativePath = normalizeWebChatDistRelativePath(
      assetPath.slice(WEB_CHAT_ASSET_BASE_PATH.length)
    );
    if (isRouteCSafeWebChatStaticPrewarmRelativePath(relativePath)) {
      criticalPaths.add(relativePath);
    }
  }
  return Array.from(criticalPaths).sort();
}

function buildWebChatPrewarmAssetEntry(relativePath, role) {
  const normalizedRelativePath = normalizeWebChatDistRelativePath(relativePath);
  const assetPath = resolve(ROUTEC_WEB_CHAT_DIST_ROOT, normalizedRelativePath);
  const assetRelativePath = getWebChatDistRelativePath(assetPath);
  if (
    assetRelativePath !== normalizedRelativePath ||
    assetRelativePath.startsWith("..") ||
    !existsSync(assetPath) ||
    !statSync(assetPath).isFile()
  ) {
    return null;
  }
  const body = readFileSync(assetPath);
  const contentType = getWebChatAppContentType(assetPath);
  const cachePolicy = getWebChatAppAssetCacheControl(assetPath);
  return {
    path: `${WEB_CHAT_ASSET_BASE_PATH}${assetRelativePath}`,
    kind: getWebChatPrewarmAssetKind(assetPath),
    role,
    content_type: contentType,
    raw_bytes: body.byteLength,
    sha256: createRouteCStaticSha256(body),
    fingerprinted:
      isRouteCSafeWebChatStaticPrewarmRelativePath(assetRelativePath),
    cache_policy: cachePolicy,
    compression_candidate: isRouteCCompressibleStaticResponse(
      contentType,
      assetPath
    ),
    prewarm: cachePolicy === ROUTEC_WEB_CHAT_IMMUTABLE_STATIC_CACHE_CONTROL,
  };
}

function buildWebChatStaticPrewarmManifest() {
  const indexHtml = readFileSync(ROUTEC_WEB_CHAT_INDEX_PATH, "utf-8");
  const criticalRelativePaths = extractWebChatPrewarmCriticalPaths(indexHtml);
  const criticalPathSet = new Set(criticalRelativePaths);
  const secondaryRelativePaths = listWebChatDistFiles()
    .map((filePath) => getWebChatDistRelativePath(filePath))
    .filter(
      (relativePath) =>
        isRouteCSafeWebChatStaticPrewarmRelativePath(relativePath) &&
        !criticalPathSet.has(relativePath)
    )
    .sort()
    .slice(0, ROUTEC_WEB_CHAT_STATIC_PREWARM_SECONDARY_LIMIT);

  const critical = criticalRelativePaths
    .map((relativePath) => buildWebChatPrewarmAssetEntry(relativePath, "critical"))
    .filter(Boolean);
  const secondary = secondaryRelativePaths
    .map((relativePath) =>
      buildWebChatPrewarmAssetEntry(relativePath, "secondary")
    )
    .filter(Boolean);
  const buildMaterial = JSON.stringify({
    index_sha256: createRouteCStaticSha256(Buffer.from(indexHtml, "utf-8")),
    critical: critical.map((asset) => ({
      path: asset.path,
      sha256: asset.sha256,
      raw_bytes: asset.raw_bytes,
    })),
    secondary: secondary.map((asset) => ({
      path: asset.path,
      sha256: asset.sha256,
      raw_bytes: asset.raw_bytes,
    })),
  });

  return {
    schema_version: ROUTEC_STATIC_PREWARM_SCHEMA_VERSION,
    app: "routec-web-chat",
    asset_base_path: WEB_CHAT_ASSET_BASE_PATH,
    build_id: createRouteCStaticSha256(buildMaterial).slice(0, 32),
    critical,
    secondary,
    raw_tokens_or_secrets: false,
    session_scoped: false,
    unsafe_exclusions: [
      "dashboard_documents",
      "clean_chat_documents",
      "auth_session_provider_catalog_history_endpoints",
      "matrix_tool_media_user_content",
      "capacitor_bootstrap_login_page",
    ],
  };
}

function serveWebChatStaticPrewarmManifest(req, res) {
  if (!ensureWebChatStaticBuildAvailable(res)) {
    return true;
  }
  const manifest = buildWebChatStaticPrewarmManifest();
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Oysterun-RouteC-App": "routec-web-chat",
    "X-Oysterun-RouteC-Static-Prewarm-Manifest": "true",
    "X-Oysterun-RouteC-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
    "X-Oysterun-Web-Chat-Asset-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
  };
  const response = buildRouteCStaticResponse(req, body, headers, {
    assetPath: WEB_CHAT_STATIC_PREWARM_MANIFEST_PATH,
  });
  res.writeHead(200, response.headers);
  res.end(response.body);
  return true;
}

function resolveWebChatAppAssetPath(
  requestPath,
  { basePath = WEB_CHAT_ASSET_BASE_PATH } = {}
) {
  if (
    typeof requestPath !== "string" ||
    typeof basePath !== "string" ||
    !basePath.endsWith("/") ||
    !requestPath.startsWith(basePath)
  ) {
    return null;
  }
  const rawRelativePath = requestPath.slice(basePath.length);
  if (
    !rawRelativePath ||
    rawRelativePath.endsWith("/") ||
    rawRelativePath === "index.html"
  ) {
    return null;
  }
  const assetPath = resolve(ROUTEC_WEB_CHAT_DIST_ROOT, rawRelativePath);
  const assetRelativePath = relative(ROUTEC_WEB_CHAT_DIST_ROOT, assetPath);
  if (!assetRelativePath || assetRelativePath.startsWith("..")) {
    return null;
  }
  return assetPath;
}

function isCleanSessionChatAppShellPath(requestPath) {
  return /^\/app\/sessions\/[^/]+\/chat\/?$/.test(requestPath);
}

function getCleanSessionChatAppShellSessionId(requestPath) {
  const match =
    typeof requestPath === "string"
      ? requestPath.match(/^\/app\/sessions\/([^/]+)\/chat\/?$/)
      : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function buildStaleCleanSessionChatRedirectLocation() {
  return "/app/sessions?notice=stale_clean_chat";
}

function isLegacyRouteCRootPath(requestPath) {
  return (
    requestPath === "/route-c" ||
    requestPath === "/route-c/" ||
    requestPath === "/route-c/index.html"
  );
}

function getWebChatAppAssetHeaders(
  readableAssetPath,
  { legacyRouteCAsset = false } = {}
) {
  const headers = {
    "Content-Type": getWebChatAppContentType(readableAssetPath),
    "Cache-Control": getWebChatAppAssetCacheControl(readableAssetPath, {
      legacyRouteCAsset,
    }),
    "X-Oysterun-RouteC-App": "routec-web-chat",
    "X-Oysterun-RouteC-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
    "X-Oysterun-Web-Chat-Asset-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
  };
  if (relative(ROUTEC_WEB_CHAT_DIST_ROOT, readableAssetPath) === "sw.js") {
    headers["Service-Worker-Allowed"] = WEB_CHAT_SERVICE_WORKER_ALLOWED_PATH;
  }
  if (legacyRouteCAsset) {
    headers["X-Oysterun-Legacy-RouteC-Asset"] = "compatibility";
  }
  return headers;
}

function ensureWebChatStaticBuildAvailable(res) {
  if (
    !existsSync(ROUTEC_WEB_CHAT_INDEX_PATH) ||
    !statSync(ROUTEC_WEB_CHAT_INDEX_PATH).isFile()
  ) {
    respondText(res, 503, "ROUTEC_WEB_CHAT_STATIC_APP_BUILD_REQUIRED", {
      "Cache-Control": "no-store",
      "X-Oysterun-RouteC-App": "routec-web-chat",
      "X-Oysterun-RouteC-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
      "X-Oysterun-Web-Chat-Asset-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
      "X-Oysterun-RouteC-Classification":
        "ROUTEC_WEB_CHAT_STATIC_APP_BUILD_REQUIRED",
    });
    return false;
  }
  return true;
}

function serveWebChatAppDocument(req, res) {
  if (!ensureWebChatStaticBuildAvailable(res)) {
    return true;
  }

  const response = buildRouteCStaticResponse(
    req,
    readFileSync(ROUTEC_WEB_CHAT_INDEX_PATH),
    getWebChatAppAssetHeaders(ROUTEC_WEB_CHAT_INDEX_PATH),
    { assetPath: ROUTEC_WEB_CHAT_INDEX_PATH }
  );
  res.writeHead(200, response.headers);
  res.end(response.body);
  return true;
}

function serveWebChatAppAsset(
  req,
  res,
  requestPath,
  { basePath = WEB_CHAT_ASSET_BASE_PATH, legacyRouteCAsset = false } = {}
) {
  if (!ensureWebChatStaticBuildAvailable(res)) {
    return true;
  }

  const assetPath = resolveWebChatAppAssetPath(requestPath, { basePath });
  const assetExists =
    assetPath && existsSync(assetPath) && statSync(assetPath).isFile();
  if (!assetExists) {
    return false;
  }

  const response = buildRouteCStaticResponse(
    req,
    readFileSync(assetPath),
    getWebChatAppAssetHeaders(assetPath, { legacyRouteCAsset }),
    { assetPath }
  );
  res.writeHead(200, response.headers);
  res.end(response.body);
  return true;
}

function readFirstHeaderValue(rawValue) {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function deriveRequestHostOrigin(req) {
  const proto =
    readFirstHeaderValue(req.headers["x-forwarded-proto"]) || "http";
  const host =
    readFirstHeaderValue(req.headers["x-forwarded-host"]) ||
    readFirstHeaderValue(req.headers.host);
  if (!host) return null;
  return `${proto}://${host}`;
}

function serveRouteCWellKnownMatrixClient(req, res) {
  const hostOrigin = deriveRequestHostOrigin(req);
  if (!hostOrigin) {
    respond(res, 400, {
      error: "Host header is required for Route C Matrix client discovery",
    });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Oysterun-RouteC-App": "routec-web-chat",
    "X-Oysterun-RouteC-Public-Discovery": "matrix-client-well-known",
  });
  res.end(
    JSON.stringify({
      "m.homeserver": {
        base_url: hostOrigin,
      },
    })
  );
}

function getDefaultModelForProvider(providerId) {
  return providerId === "codex" ? "gpt-5-codex" : "opus";
}

function parseCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader.trim()) {
    return {};
  }
  const cookies = {};
  for (const entry of cookieHeader.split(";")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function getDashboardCookieToken(req) {
  const cookies = parseCookieHeader(req.headers["cookie"]);
  return cookies[DASHBOARD_COOKIE_NAME] || null;
}

function buildDashboardCookie(token, { clear = false } = {}) {
  const parts = [
    `${DASHBOARD_COOKIE_NAME}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (clear) {
    parts.push("Max-Age=0");
    return parts.join("; ");
  }
  const ttlHours = readConfig().debug_dashboard_session_ttl_hours;
  if (ttlHours !== -1) {
    parts.push(`Max-Age=${ttlHours * 60 * 60}`);
  }
  return parts.join("; ");
}

function issueDashboardLoginSession(res) {
  const token = randomUUID();
  dashboardSessions.set(token, { issuedAtMs: getCurrentTimeMs() });
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": buildDashboardCookie(token),
  });
  res.end(JSON.stringify({ token }));
  return token;
}

function getDashboardSessionRecord(token) {
  if (!token) return null;
  const record = dashboardSessions.get(token);
  if (!record) return null;
  if (!Number.isInteger(record.issuedAtMs) || record.issuedAtMs < 0) {
    dashboardSessions.delete(token);
    return null;
  }
  const ttlHours = readConfig().debug_dashboard_session_ttl_hours;
  if (ttlHours === -1) {
    return record;
  }
  const expiresAtMs = record.issuedAtMs + ttlHours * 60 * 60 * 1000;
  if (getCurrentTimeMs() >= expiresAtMs) {
    dashboardSessions.delete(token);
    return null;
  }
  return record;
}

function dashboardAuthenticate(req) {
  const authHeader = req.headers["authorization"];
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : getDashboardCookieToken(req);
  if (!token) return null;
  if (!getDashboardSessionRecord(token)) return null;
  return {
    user_id: "dashboard-admin",
    device_id: DEVICE_ID || "local",
    agent_ids: [],
    _dashboardAuth: true,
  };
}

function dashboardAuthenticateToken(token) {
  if (!getDashboardSessionRecord(token)) return null;
  return {
    user_id: "dashboard-admin",
    device_id: DEVICE_ID || "local",
    agent_ids: [],
    _dashboardAuth: true,
  };
}

function getNamedCookieToken(req, cookieName) {
  const cookies = parseCookieHeader(req.headers["cookie"]);
  return cookies[cookieName] || null;
}

function getDeliverableCookieToken(req) {
  return getNamedCookieToken(req, DELIVERABLE_COOKIE_NAME);
}

function createDeliverableSession(agentId) {
  const token = randomUUID();
  deliverableTokens.set(token, { agentId });
  return token;
}

function createBrowserHandoffToken({ routePrefix, agentId, targetPath }) {
  const token = randomUUID();
  const expiresAtMs = getCurrentTimeMs() + BROWSER_HANDOFF_TTL_MS;
  browserHandoffTokens.set(token, {
    routePrefix,
    agentId,
    targetPath,
    expiresAtMs,
  });
  return {
    token,
    expiresAtMs,
  };
}

function consumeBrowserHandoffToken(token) {
  const record = browserHandoffTokens.get(token);
  browserHandoffTokens.delete(token);
  if (!record) return null;
  if (
    !Number.isInteger(record.expiresAtMs) ||
    getCurrentTimeMs() >= record.expiresAtMs
  ) {
    return null;
  }
  return record;
}

function authenticateDeliverableSession(req, agentId) {
  const token = getDeliverableCookieToken(req);
  if (!token) return false;
  const record = deliverableTokens.get(token);
  return record?.agentId === agentId;
}

function clearDeliverableSession(req) {
  const token = getDeliverableCookieToken(req);
  if (token) {
    deliverableTokens.delete(token);
  }
}

const DOCUMENT_LIKE_SITE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".txt",
]);

function isDocumentLikeDeliverablePath(rawRelativePath, pathname) {
  if (!rawRelativePath || pathname.endsWith("/")) return true;
  const extension = extname(rawRelativePath).toLowerCase();
  return extension === "" || DOCUMENT_LIKE_SITE_EXTENSIONS.has(extension);
}

function getDeliverableCacheControl(accessMode) {
  return accessMode === "public" ? "public, max-age=300" : "no-store";
}

function verifyAgentWebsitePassword(candidate, configuredPassword) {
  const password = typeof candidate === "string" ? candidate.trim() : "";
  const expected =
    typeof configuredPassword === "string" ? configuredPassword.trim() : "";
  return Boolean(password && expected && password === expected);
}

function buildServedSiteBasePath(routePrefix, agentId) {
  return `${routePrefix}${encodeURIComponent(agentId)}/`;
}

function buildAgentSiteBasePath(agentId) {
  return buildServedSiteBasePath("/sites/", agentId);
}

function normalizeServedSiteNextPath(routePrefix, agentId, candidate) {
  const fallback = buildServedSiteBasePath(routePrefix, agentId);
  const normalized = normalizeString(candidate);
  if (!normalized) return fallback;
  return normalized.startsWith(fallback) ? normalized : fallback;
}

function normalizeAgentSiteNextPath(agentId, candidate) {
  return normalizeServedSiteNextPath("/sites/", agentId, candidate);
}

function buildBrowserHandoffPath(token) {
  return `/browser-handoff/${encodeURIComponent(token)}`;
}

function buildServedSitePasswordCookie(
  routePrefix,
  token,
  agentId,
  { clear = false } = {}
) {
  const parts = [
    `${DELIVERABLE_COOKIE_NAME}=${clear ? "" : encodeURIComponent(token)}`,
    `Path=${buildServedSiteBasePath(routePrefix, agentId)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (clear) {
    parts.push("Max-Age=0");
  }
  return parts.join("; ");
}

function buildAgentSitePasswordCookie(token, agentId, { clear = false } = {}) {
  return buildServedSitePasswordCookie("/sites/", token, agentId, { clear });
}

function renderServedSitePasswordPage(
  agentId,
  {
    routePrefix = "/sites/",
    next = null,
    error = null,
    title = "Unlock Website",
    description = "Enter the password to view this agent website.",
    submitLabel = "Open Website",
  } = {}
) {
  const normalizedNext =
    normalizeString(next) || buildServedSiteBasePath(routePrefix, agentId);
  const action = `${buildServedSiteBasePath(routePrefix, agentId)}__auth`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #f5efe7 0%, #efe4d7 100%);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #24160f;
    }
    .card {
      width: min(420px, calc(100vw - 32px));
      background: rgba(255,255,255,0.92);
      border: 1px solid rgba(92, 51, 23, 0.12);
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 24px 80px rgba(54, 28, 12, 0.12);
    }
    h1 { margin: 0 0 10px; font-size: 1.45rem; }
    p { margin: 0 0 16px; line-height: 1.5; }
    label { display: block; font-weight: 600; margin-bottom: 8px; }
    input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(92, 51, 23, 0.2);
      background: white;
      font: inherit;
    }
    button {
      margin-top: 14px;
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 12px 14px;
      background: #3f6b58;
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .error {
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: #fde8e8;
      color: #8a1c1c;
    }
    .meta { margin-top: 12px; color: #6a574c; font-size: 0.92rem; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="${escapeHtml(action)}">
      <input type="hidden" name="next" value="${escapeHtml(normalizedNext)}">
      <label for="website-password">Password</label>
      <input id="website-password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">${escapeHtml(submitLabel)}</button>
    </form>
    <div class="meta">Agent: ${escapeHtml(agentId)}</div>
  </main>
</body>
</html>`;
}

function renderServedSiteLoginRequiredPage(
  agentId,
  requestedPath,
  routePrefix = "/sites/"
) {
  const appPath = "/app";
  const title = "Owner Login Required";
  const description =
    "This website is restricted to the Host owner. Sign in to Oysterun, then reopen this URL.";
  const canonicalPath = normalizeServedSiteNextPath(
    routePrefix,
    agentId,
    requestedPath
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f6f1eb;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #24160f;
    }
    .card {
      width: min(460px, calc(100vw - 32px));
      padding: 24px;
      border-radius: 18px;
      background: white;
      border: 1px solid rgba(92, 51, 23, 0.12);
      box-shadow: 0 24px 80px rgba(54, 28, 12, 0.08);
    }
    h1 { margin: 0 0 10px; font-size: 1.45rem; }
    p { line-height: 1.5; }
    a {
      display: inline-block;
      margin-top: 12px;
      padding: 10px 14px;
      border-radius: 12px;
      background: #3f6b58;
      color: white;
      text-decoration: none;
      font-weight: 700;
    }
    code { background: #f4ede7; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p>Requested path: <code>${escapeHtml(canonicalPath)}</code></p>
    <p>Agent: <code>${escapeHtml(agentId)}</code></p>
    <a href="${escapeHtml(appPath)}">Open Oysterun</a>
  </main>
</body>
</html>`;
}

function resolveBrowserHandoffTarget(rawTarget) {
  const normalizedTarget = normalizeString(rawTarget);
  if (!normalizedTarget) {
    throw new Error("target is required");
  }
  if (!normalizedTarget.startsWith("/")) {
    throw new Error("Browser handoff target must be a Host-relative path");
  }
  let targetUrl;
  try {
    targetUrl = new URL(normalizedTarget, "http://oysterun.local");
  } catch {
    throw new Error("Browser handoff target is not a valid path");
  }
  const pathname = targetUrl.pathname;
  if (!pathname.startsWith("/sites/")) {
    throw new Error("Browser handoff target must start with /sites/");
  }
  const route = parseAgentSiteRoute(pathname);
  if (!route || route.error) {
    throw new Error(route?.error || "Invalid website route");
  }
  if (!isDocumentLikeDeliverablePath(route.rawRelativePath, pathname)) {
    throw new Error(
      "Browser handoff target must resolve to a browser-displayable document"
    );
  }
  if (
    route.rawRelativePath === "__login" ||
    route.rawRelativePath === "__auth" ||
    route.rawRelativePath === "__logout"
  ) {
    throw new Error(
      "Browser handoff target cannot point at website auth controls"
    );
  }
  const agentFolder = resolveAgentFolderForSite(route.agentId);
  const site = resolveSiteRoot(agentFolder, route.agentId);
  const asset = resolveSiteAsset(
    site.rootPath,
    route.rawRelativePath,
    pathname,
    targetUrl.search
  );
  return {
    routePrefix: "/sites/",
    agentId: route.agentId,
    targetPath: asset.redirectTo || `${pathname}${targetUrl.search}`,
  };
}

// ── Debug Event Buffer (per live session, not user-facing chat history) ──

const MESSAGE_BUFFER_SIZE = 500;
const TRANSCRIPT_TOOL_EVENT_LIMIT = 100;
/** @type {Map<string, Array<object>>} sessionId → messages */
const messageBuffers = new Map();

function bufferMessage(sessionId, payload) {
  if (!sessionId) return;
  if (!messageBuffers.has(sessionId)) {
    messageBuffers.set(sessionId, []);
  }
  const buf = messageBuffers.get(sessionId);
  buf.push(payload);
  if (buf.length > MESSAGE_BUFFER_SIZE) {
    buf.splice(0, buf.length - MESSAGE_BUFFER_SIZE);
  }
}

function persistApprovalResolutionForSession(
  session,
  pendingRequest,
  responsePayload
) {
  return false;
}

function resolvePendingControlRequest(session, requestId) {
  if (typeof requestId !== "string" || !requestId.trim()) {
    throw new Error("control response requires request_id");
  }
  if (!session || typeof session.getPendingControlRequests !== "function") {
    return null;
  }
  return (
    session
      .getPendingControlRequests()
      .find((entry) => entry.request_id === requestId.trim()) || null
  );
}

function submitProviderControlResponse(
  session,
  payload,
  { requirePendingRequest = false } = {}
) {
  if (!session?.id) {
    throw new Error("control response requires live session");
  }
  if (typeof session.respondToControl !== "function") {
    throw new Error(
      `Session ${session.id} does not support provider control responses`
    );
  }
  const requestId =
    typeof payload?.request_id === "string" && payload.request_id.trim()
      ? payload.request_id.trim()
      : typeof payload?.requestId === "string" && payload.requestId.trim()
      ? payload.requestId.trim()
      : "";
  if (!requestId) {
    return {
      status: 400,
      body: {
        error: "request_id required",
        foundation_pass_claimed: false,
      },
    };
  }
  const pendingRequest = resolvePendingControlRequest(session, requestId);
  if (!pendingRequest && requirePendingRequest) {
    return {
      status: 404,
      body: {
        error: "Pending control request not found",
        session_id: session.id,
        request_id: requestId,
        control_response_forwarded: false,
        provider_control_outcome_event_emitted: false,
        browser_local_state_final_truth: false,
        foundation_pass_claimed: false,
      },
    };
  }

  session.respondToControl({
    requestId,
    allow: payload.allow,
    answers: payload.answers,
    response: payload.response,
    grantSuggestion: payload.grant_suggestion ?? payload.grantSuggestion,
  });

  let providerControlOutcomeEventEmitted = false;
  let approvalResolutionPersisted = false;
  let controlKind = null;
  let allowedActions = [];
  const responsePayload = {
    allow: payload.allow,
    response: payload.response,
  };
  if (pendingRequest) {
    controlKind =
      sessionManager.providerControlKindFromPendingRequest(pendingRequest);
    allowedActions = sessionManager.providerControlAllowedActions(controlKind);
    sessionManager.emitProviderControlOutcomeEvent(
      session,
      pendingRequest,
      responsePayload
    );
    providerControlOutcomeEventEmitted = true;
    approvalResolutionPersisted = persistApprovalResolutionForSession(
      session,
      pendingRequest,
      responsePayload
    );
  }
  const outcome = payload.allow === false ? "rejected" : "accepted";
  return {
    status: 200,
    body: {
      status: "routec_provider_control_response_accepted",
      route: "routec_provider_control_response",
      session_id: session.id,
      agent_id: session.agentId,
      provider: session.provider || session.adapterId || "claude",
      request_id: requestId,
      subtype: pendingRequest?.subtype || null,
      control_kind: controlKind,
      control_family: pendingRequest ? "provider_request" : null,
      control_origin: pendingRequest ? "user" : null,
      allowed_actions: allowedActions,
      control_outcome: outcome,
      control_response_forwarded: true,
      provider_control_outcome_event_emitted:
        providerControlOutcomeEventEmitted,
      approval_resolution_persisted: approvalResolutionPersisted,
      matrix_backed_outcome_truth: "control.outcome",
      browser_local_state_final_truth: false,
      direct_matrix_browser_write_used: false,
      local_transcript_replay_shortcut_used: false,
      foundation_pass_claimed: false,
    },
  };
}

function resolveEventSourceId(event) {
  const explicitSource = normalizeString(event?.source_id);
  if (explicitSource) {
    return explicitSource;
  }
  const providerSource = normalizeString(event?.provider);
  if (providerSource) {
    return providerSource;
  }
  return "oysterun";
}

function resolveEventSourceLabel(sourceId) {
  switch ((sourceId || "").toLowerCase()) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "oysterun":
      return "Oysterun";
    default:
      if (!sourceId) return "Oysterun";
      return sourceId.charAt(0).toUpperCase() + sourceId.slice(1);
  }
}

function buildRuntimeErrorDisplayText(event) {
  const sourceLabel = resolveEventSourceLabel(resolveEventSourceId(event));
  const scope = event?.error_scope === "transport" ? "transport" : "runtime";
  const prefix = `${sourceLabel} ${scope} error: `;
  const error = event?.error;
  const message =
    normalizeString(error) ||
    normalizeString(error?.message) ||
    normalizeString(event?.message) ||
    `${scope} error`;
  return message.startsWith(prefix) ? message : `${prefix}${message}`;
}

function buildSessionLifecycleDisplayText(event) {
  const sourceLabel = resolveEventSourceLabel(resolveEventSourceId(event));
  if (event?.subtype === "resume") {
    return `${sourceLabel} session resumed.`;
  }
  if (event?.subtype === "start") {
    return `${sourceLabel} session started.`;
  }
  if (event?.subtype === "rename") {
    return `${sourceLabel} session renamed.`;
  }
  if (event?.type === "session.exit") {
    const hasCode =
      event.code !== undefined &&
      event.code !== null &&
      String(event.code).trim() !== "";
    const diagnostic =
      normalizeString(event?.exit_diagnostic?.summary) ||
      normalizeString(event?.exit_reason);
    if (diagnostic) {
      return hasCode
        ? `${sourceLabel} session exited (${String(event.code).trim()}): ${diagnostic}.`
        : `${sourceLabel} session exited: ${diagnostic}.`;
    }
    return hasCode
      ? `${sourceLabel} session exited (${String(event.code).trim()}).`
      : `${sourceLabel} session exited.`;
  }
  return `${sourceLabel} session event.`;
}

function isSessionLifecycleEvent(event) {
  return event?.type === "session.exit" || event?.type === "session.lifecycle";
}

function ensurePersistableEventFields(event) {
  if (!event || typeof event !== "object") return event;
  const createdAt =
    normalizeString(event.created_at) || new Date().toISOString();
  const sourceId = resolveEventSourceId(event);
  const sourceLabel = resolveEventSourceLabel(sourceId);
  const nextEvent = {
    ...event,
    created_at: createdAt,
    source_id: sourceId,
    source_label: sourceLabel,
  };
  if (nextEvent.type === "runtime.error") {
    nextEvent.error_scope = normalizeString(nextEvent.error_scope) || "runtime";
    nextEvent.error_origin =
      normalizeString(nextEvent.error_origin) ||
      (sourceId === "oysterun" ? "host" : "provider");
    nextEvent.display_text =
      normalizeString(nextEvent.display_text) ||
      buildRuntimeErrorDisplayText(nextEvent);
    nextEvent.message_id =
      normalizeString(nextEvent.message_id) ||
      `system:${nextEvent.type}:${randomUUID()}`;
    return nextEvent;
  }
  if (isSessionLifecycleEvent(nextEvent)) {
    nextEvent.display_text =
      normalizeString(nextEvent.display_text) ||
      buildSessionLifecycleDisplayText(nextEvent);
    nextEvent.message_id =
      normalizeString(nextEvent.message_id) ||
      `system:${nextEvent.type}:${randomUUID()}`;
    return nextEvent;
  }
  return nextEvent;
}

function logPersistableEvent(event) {
  if (!event?.type) return;
  const createdAt =
    normalizeString(event.created_at) || new Date().toISOString();
  if (event.type === "runtime.error") {
    const sessionId =
      normalizeString(event.sessionId) ||
      normalizeString(event.session_id) ||
      "unknown-session";
    const agentId =
      normalizeString(event.agentId) ||
      normalizeString(event.agent_id) ||
      "unknown-agent";
    const scope = normalizeString(event.error_scope) || "runtime";
    const origin = normalizeString(event.error_origin) || "unknown";
    console.error(
      `[oysterun-host] ${createdAt} session=${sessionId} agent=${agentId} source=${
        event.source_id || "oysterun"
      } scope=${scope} origin=${origin} ${
        event.display_text || event.error || "Runtime error"
      }`
    );
    return;
  }
  if (isSessionLifecycleEvent(event)) {
    const sessionId =
      normalizeString(event.sessionId) ||
      normalizeString(event.session_id) ||
      "unknown-session";
    const agentId =
      normalizeString(event.agentId) ||
      normalizeString(event.agent_id) ||
      "unknown-agent";
    console.log(
      `[oysterun-host] ${createdAt} session=${sessionId} agent=${agentId} source=${
        event.source_id || "oysterun"
      } ${event.display_text || "Session event."}`
    );
  }
}

// ── State ─────────────────────────────────────────────────────

function buildSchedulerManagedSessionName({ schedule, target, messageId }) {
  const sourceName = normalizeSessionName(target?.sessionPayload?.session_name);
  const scheduleId = normalizeString(schedule?.id) || "schedule";
  const suffix =
    String(messageId || "")
      .replace(/[^a-z0-9]/gi, "")
      .slice(-8) || randomUUID().slice(0, 8);
  return (
    normalizeSessionName(
      `${sourceName || `Scheduler ${scheduleId.slice(0, 8)}`} ${suffix}`
    ) || `Scheduler ${suffix}`
  );
}

async function dispatchHostScheduleThroughSessionRuntime(
  activeSessionManager,
  { schedule, targetBinding, text, messageId, mailCapability = null }
) {
  const target = resolveSchedulerTargetToDirectProviderRun({
    schedule,
    targetBinding,
  });
  const runtime = target.resolved.runtime;
  if (runtime.provider !== "claude") {
    throw new Error(
      "Scheduler ACP session runtime dispatch requires a Claude setup snapshot target"
    );
  }
  const startedAt = new Date().toISOString();
  const sessionId = randomUUID();
  const session = activeSessionManager.start({
    agentId: target.agentId,
    cwd: target.agentFolder,
    sessionId,
    sessionName: buildSchedulerManagedSessionName({
      schedule,
      target,
      messageId,
    }),
    provider: runtime.provider,
    model: runtime.model,
    reasoningEffort: runtime.reasoningEffort,
    reasoningEffortSource: runtime.reasoningEffortSource,
    permissionMode: runtime.permissionMode,
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    dangerousMode: runtime.dangerousMode,
    allowDangerouslySkipPermissions: runtime.allowDangerouslySkipPermissions,
    searchEnabled: runtime.searchEnabled,
    imageInputEnabled: runtime.imageInputEnabled,
    native: runtime.native,
    workspacePolicy: runtime.workspacePolicy,
    runtimeCapabilities: mailCapability ? { [MAIL_CREATE_SCOPE]: true } : {},
    runtimeCapabilityEnv: mailCapability?.env || {},
    runtimeCapabilityGrant: mailCapability?.metadata || null,
    runtimeCapabilityRedactionValues: mailCapability?.redactionValues || [],
    requiredProductSkills: target.sessionPayload?.required_product_skills,
    installOysterunSkills:
      target.sessionPayload?.install_oysterun_skills === true,
  });
  const queuedMessage = activeSessionManager.sendToSession(
    session.id,
    "oysterun-scheduler",
    "Oysterun Scheduler",
    text,
    { messageId }
  );
  const completedAt = new Date().toISOString();
  return {
    ok: true,
    message_id: queuedMessage?.id || messageId,
    provider: runtime.provider,
    command_label: "acp session runtime",
    host_dispatch_path: "schedulerSessionRuntime.acp-session",
    exit_code: 0,
    signal: null,
    started_at: startedAt,
    completed_at: completedAt,
    stdout: "Scheduler prompt queued to managed ACP session runtime\n",
    stderr: "",
    log_summary: "Scheduler prompt queued to managed ACP session runtime",
    target_source: target.source,
    agent_id: target.agentId,
  };
}

function createSchedulerSessionDispatcher(
  activeSessionManager,
  { getMatrixFacade = () => null } = {}
) {
  return {
    async dispatchHostScheduleDirect({
      schedule,
      targetBinding,
      text,
      messageId,
      mailCapability = null,
    }) {
      const target = resolveSchedulerTargetToDirectProviderRun({
        schedule,
        targetBinding,
      });
      const result = await runSchedulerDirectProviderCommand({
        runtime: target.resolved.runtime,
        cwd: target.agentFolder,
        prompt: text,
        messageId,
        env: mailCapability?.env || {},
        redactionValues: mailCapability?.redactionValues || [],
      });
      return {
        ...result,
        target_source: target.source,
        agent_id: target.agentId,
      };
    },
    async dispatchHostScheduleSessionRuntime({
      schedule,
      targetBinding,
      text,
      messageId,
      mailCapability = null,
    }) {
      return await dispatchHostScheduleThroughSessionRuntime(
        activeSessionManager,
        {
          schedule,
          targetBinding,
          text,
          messageId,
          mailCapability,
        }
      );
    },
    getSessionState({ sessionId }) {
      const session = activeSessionManager.getSession(sessionId);
      if (!session) {
        return {
          available: false,
          busy: true,
          reason: "session_not_found",
        };
      }
      if (session.alive !== true) {
        return {
          available: false,
          busy: true,
          reason: "session_not_alive",
        };
      }
      const delivery = activeSessionManager.getDeliverySummary(session.id);
      const busy =
        delivery.state !== "ready" ||
        Boolean(delivery.active_message_id) ||
        delivery.queued_count > 0;
      return {
        available: true,
        busy,
        reason: busy ? "session_delivery_busy" : null,
      };
    },
    async dispatchLoopMatrixEvent({
      sessionId,
      userId,
      nickname,
      text,
      messageId,
      schedule,
      triggeredAt,
    }) {
      const session = activeSessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const matrixFacade = getMatrixFacade();
      if (typeof matrixFacade?.deliverLoopExecutionFromScheduler !== "function") {
        throw new Error("Route C Matrix Loop dispatcher is unavailable");
      }
      return await matrixFacade.deliverLoopExecutionFromScheduler({
        sessionId: session.id,
        userId,
        nickname,
        text,
        messageId,
        schedule,
        triggeredAt,
      });
    },
  };
}

function buildLoopSchedulerResponse(loopResult, session) {
  return {
    status:
      loopResult.status === "enabled_existing"
        ? "scheduler_loop_enabled_existing"
        : "scheduler_loop_created",
    session_id: session.id,
    agent_id: session.agentId,
    dispatch_queued: false,
    duplicate_prevented: loopResult.duplicate_prevented === true,
    schedule: loopResult.schedule,
    parsed: loopResult.parsed,
    storage_owner: loopResult.storage_owner || null,
    runtime_state_owner: loopResult.runtime_state_owner || null,
    host_owned_scheduler_db: false,
  };
}

function classifyLoopFeedbackAction({ result, before = null, deleted = false }) {
  if (deleted) return "deleted";
  if (result?.status === "created") return "created";
  if (result?.status === "enabled_existing") return "enabled";
  if (result?.status === "already_exists") return "already exists";
  if (!before) return "updated";
  const schedule = result?.schedule || {};
  const beforeEnabled = before.enabled === true;
  const afterEnabled = schedule.enabled === true;
  const unchangedFields =
    before.interval_token === schedule.interval_token &&
    before.command_text === schedule.command_text &&
    (before.start_at || null) === (schedule.start_at || null) &&
    (before.end_at || null) === (schedule.end_at || null);
  if (unchangedFields && beforeEnabled !== afterEnabled) {
    return afterEnabled ? "enabled" : "disabled";
  }
  return "updated";
}

async function writeLoopFeedbackOrThrow({ session, action, schedule }) {
  const result = await routeCMatrixFacade.writeLoopSystemSemanticEvent({
    sessionId: session.id,
    action,
    schedule,
  });
  if (result?.semantic_matrix_event_committed !== true || !result?.event_id) {
    const err = new Error("Loop feedback Matrix event was not committed");
    err.statusCode = 424;
    err.loopFeedbackCommit = result || null;
    throw err;
  }
  return result;
}

function getSessionLoopCrudErrorStatus(err) {
  if (err?.statusCode) return err.statusCode;
  const message = err?.message || String(err);
  if (/not found/i.test(message)) return 404;
  if (/already exists/i.test(message)) return 409;
  return 400;
}

function getHostSchedulerCrudErrorStatus(err) {
  const message = err?.message || String(err);
  if (/not found/i.test(message)) return 404;
  if (/already exists/i.test(message)) return 409;
  return 400;
}

function isObjectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function getBodyRecord(body, key) {
  return body && isObjectRecord(body[key]) ? body[key] : {};
}

function getOptionalBodyRecord(body, key) {
  return body && isObjectRecord(body[key]) ? body[key] : null;
}

function hasBodyField(body, key) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key));
}

function buildHostSchedulerRuleFromBody(body) {
  const rule = getBodyRecord(body, "rule");
  const type =
    normalizeString(rule.type) ||
    normalizeString(rule.frequency) ||
    normalizeString(body.rule_type) ||
    normalizeString(body.frequency) ||
    "daily";
  if (type === "once") {
    return {
      type,
      at:
        normalizeString(rule.at) ||
        normalizeString(rule.run_at) ||
        normalizeString(body.run_at) ||
        normalizeString(body.once_at),
      timezone:
        normalizeString(rule.timezone) || normalizeString(body.timezone),
    };
  }
  if (type === "weekly" || type === "every_tuesday") {
    const selectedWeekdays =
      rule.weekdays ||
      rule.selected_weekdays ||
      body.weekdays ||
      body.selected_weekdays;
    return {
      type,
      weekdays: Array.isArray(selectedWeekdays) ? selectedWeekdays : undefined,
      weekday:
        normalizeString(rule.weekday) ||
        normalizeString(rule.day) ||
        normalizeString(body.weekday),
      selected_weekdays: Array.isArray(selectedWeekdays)
        ? selectedWeekdays
        : undefined,
      time:
        normalizeString(rule.time) ||
        normalizeString(rule.local_time) ||
        normalizeString(body.time),
      timezone:
        normalizeString(rule.timezone) || normalizeString(body.timezone),
    };
  }
  return {
    type: "daily",
    time:
      normalizeString(rule.time) ||
      normalizeString(rule.local_time) ||
      normalizeString(body.time),
    timezone: normalizeString(rule.timezone) || normalizeString(body.timezone),
  };
}

function buildHostSchedulerTargetBindingFromBody(body) {
  const target = getBodyRecord(body, "target");
  const targetKind =
    normalizeString(target.kind) ||
    normalizeString(body.target_kind) ||
    normalizeString(body.targetKind);
  if (targetKind === "running_session") {
    throw new Error("outside_scheduler_running_session_target_forbidden");
  }
  if (targetKind === "saved_session") {
    const setupPayload =
      getOptionalBodyRecord(target, "session_setup_payload") ||
      getOptionalBodyRecord(body, "session_setup_payload");
    return {
      targetBinding: {
        kind: targetKind,
        saved_session_id:
          normalizeString(target.saved_session_id) ||
          normalizeString(target.savedSessionId) ||
          normalizeString(body.saved_session_id) ||
          normalizeString(body.savedSessionId),
        agent_id:
          normalizeString(target.agent_id) ||
          normalizeString(target.agentId) ||
          normalizeString(body.agent_id) ||
          normalizeString(body.agentId),
        session_setup_payload: setupPayload ? { ...setupPayload } : null,
      },
      hostSessionId: null,
      agentId:
        normalizeString(body.agent_id) ||
        normalizeString(body.agentId) ||
        normalizeString(target.agent_id) ||
        normalizeString(target.agentId),
    };
  }
  if (targetKind === "session_setup_record") {
    const setupFields = getBodyRecord(target, "session_setup_fields");
    const setupPayload =
      getOptionalBodyRecord(target, "session_setup_payload") ||
      getOptionalBodyRecord(body, "session_setup_payload");
    return {
      targetBinding: {
        kind: targetKind,
        session_setup_record_id:
          normalizeString(target.session_setup_record_id) ||
          normalizeString(target.sessionSetupRecordId) ||
          normalizeString(body.session_setup_record_id) ||
          normalizeString(body.sessionSetupRecordId),
        agent_id:
          normalizeString(target.agent_id) ||
          normalizeString(target.agentId) ||
          normalizeString(body.agent_id) ||
          normalizeString(body.agentId),
        session_setup_payload: setupPayload ? { ...setupPayload } : null,
        session_setup_fields: {
          provider:
            normalizeString(setupFields.provider) ||
            normalizeString(body.provider),
          model:
            normalizeString(setupFields.model) || normalizeString(body.model),
          agent_folder:
            normalizeString(setupFields.agent_folder) ||
            normalizeString(setupFields.agentFolder) ||
            normalizeString(body.agent_folder) ||
            normalizeString(body.agentFolder),
          permission_mode:
            normalizeString(setupFields.permission_mode) ||
            normalizeString(setupFields.permissionMode) ||
            normalizeString(body.permission_mode) ||
            normalizeString(body.permissionMode),
          approval_policy:
            normalizeString(setupFields.approval_policy) ||
            normalizeString(setupFields.approvalPolicy) ||
            normalizeString(body.approval_policy) ||
            normalizeString(body.approvalPolicy),
        },
      },
      hostSessionId: null,
      agentId:
        normalizeString(body.agent_id) ||
        normalizeString(body.agentId) ||
        normalizeString(target.agent_id) ||
        normalizeString(target.agentId),
    };
  }
  if (targetKind === "setup_snapshot") {
    const setupSnapshot =
      getOptionalBodyRecord(target, "setup_snapshot") ||
      getOptionalBodyRecord(target, "session_setup_payload") ||
      getOptionalBodyRecord(body, "setup_snapshot") ||
      getOptionalBodyRecord(body, "session_setup_payload");
    return {
      targetBinding: {
        kind: targetKind,
        agent_id:
          normalizeString(target.agent_id) ||
          normalizeString(target.agentId) ||
          normalizeString(body.agent_id) ||
          normalizeString(body.agentId),
        setup_snapshot: setupSnapshot ? { ...setupSnapshot } : null,
      },
      hostSessionId: null,
      agentId:
        normalizeString(body.agent_id) ||
        normalizeString(body.agentId) ||
        normalizeString(target.agent_id) ||
        normalizeString(target.agentId),
    };
  }
  throw new Error("Unsupported scheduler target kind");
}

function bodyHasHostSchedulerTarget(body) {
  const target = getOptionalBodyRecord(body, "target");
  if (target && Object.keys(target).length > 0) return true;
  return [
    "target_kind",
    "targetKind",
    "saved_session_id",
    "savedSessionId",
    "session_setup_record_id",
    "sessionSetupRecordId",
    "setup_snapshot",
    "session_setup_payload",
  ].some((field) => hasBodyField(body, field));
}

function bodyHasHostSchedulerRule(body) {
  const rule = getOptionalBodyRecord(body, "rule");
  if (rule && Object.keys(rule).length > 0) return true;
  return [
    "rule_type",
    "frequency",
    "run_at",
    "once_at",
    "weekdays",
    "selected_weekdays",
    "weekday",
    "time",
  ].some((field) => hasBodyField(body, field));
}

function bodyHasHostSchedulerPrompt(body) {
  return [
    "command_text",
    "prompt_text",
    "prompt",
    "execute_command",
  ].some((field) => hasBodyField(body, field));
}

function buildPortableSchedulerSetupSnapshotFromTargetBinding(targetBinding) {
  if (targetBinding.kind === "setup_snapshot") {
    return {
      agentId: normalizeString(targetBinding.agent_id),
      targetBinding: {
        kind: "setup_snapshot",
        agent_id: normalizeString(targetBinding.agent_id),
        setup_snapshot: { ...(targetBinding.setup_snapshot || {}) },
      },
    };
  }
  if (targetBinding.kind === "session_setup_record") {
    const setupPayload =
      buildSchedulerSetupPayloadFromTargetBinding(targetBinding);
    const setupFields = isObjectRecord(targetBinding.session_setup_fields)
      ? targetBinding.session_setup_fields
      : {};
    const agentFolder =
      normalizeString(setupPayload.agent_folder) ||
      normalizeString(setupFields.agent_folder) ||
      normalizeString(setupFields.agentFolder);
    if (agentFolder) setupPayload.agent_folder = agentFolder;
    return {
      agentId: normalizeString(targetBinding.agent_id),
      targetBinding: {
        kind: "setup_snapshot",
        agent_id: normalizeString(targetBinding.agent_id),
        setup_snapshot: setupPayload,
        setup_snapshot_source: "session_setup_record_copy",
        source_session_references_removed: true,
      },
    };
  }
  if (targetBinding.kind === "saved_session") {
    const savedSessionId = requireSchedulerTargetString(
      targetBinding.saved_session_id,
      "saved_session target saved_session_id"
    );
    const sourceRecord =
      getSessionHistory().find((entry) => entry.session_id === savedSessionId) ||
      null;
    if (!sourceRecord) {
      const err = new Error("saved_session_history_not_found");
      err.code = "saved_session_history_not_found";
      throw err;
    }
    const agentId =
      normalizeString(targetBinding.agent_id) ||
      requireSchedulerTargetString(sourceRecord.agent_id, "saved_session agent_id");
    const setupPayload = isObjectRecord(targetBinding.session_setup_payload)
      ? buildSchedulerSetupPayloadFromTargetBinding(targetBinding)
      : buildSavedSessionSetupPayloadFromHistory(sourceRecord);
    if (!setupPayload.agent_folder) {
      setupPayload.agent_folder = requireSchedulerTargetString(
        sourceRecord.agent_folder,
        "saved_session source agent_folder"
      );
    }
    return {
      agentId,
      targetBinding: {
        kind: "setup_snapshot",
        agent_id: agentId,
        setup_snapshot: setupPayload,
        setup_snapshot_source: "saved_session_copy",
        source_session_references_removed: true,
      },
    };
  }
  return { targetBinding };
}

function buildHostSchedulerPayloadFromBody(body) {
  const target = buildHostSchedulerTargetBindingFromBody(body);
  const portableTarget = buildPortableSchedulerSetupSnapshotFromTargetBinding(
    target.targetBinding
  );
  return {
    ...target,
    targetBinding: portableTarget.targetBinding,
    agentId: portableTarget.agentId || target.agentId,
    prompt:
      normalizeString(body.command_text) ||
      normalizeString(body.prompt_text) ||
      normalizeString(body.prompt) ||
      normalizeString(body.execute_command),
    rule: buildHostSchedulerRuleFromBody(body),
    timezone: normalizeString(body.timezone),
    enabled: body.enabled === true,
  };
}

function buildHostSchedulerPatchPayloadFromBody(body) {
  const payload = {};
  if (bodyHasHostSchedulerTarget(body)) {
    const target = buildHostSchedulerTargetBindingFromBody(body);
    const portableTarget = buildPortableSchedulerSetupSnapshotFromTargetBinding(
      target.targetBinding
    );
    payload.targetBinding = portableTarget.targetBinding;
    payload.hostSessionId = target.hostSessionId;
    payload.agentId = portableTarget.agentId || target.agentId;
  }
  if (bodyHasHostSchedulerPrompt(body)) {
    payload.prompt =
      normalizeString(body.command_text) ||
      normalizeString(body.prompt_text) ||
      normalizeString(body.prompt) ||
      normalizeString(body.execute_command);
  }
  if (bodyHasHostSchedulerRule(body)) {
    payload.rule = buildHostSchedulerRuleFromBody(body);
  }
  if (hasBodyField(body, "timezone")) {
    payload.timezone = normalizeString(body.timezone);
  }
  if (hasBodyField(body, "enabled")) {
    payload.enabled = body.enabled === true;
  }
  return payload;
}

function getSchedulerMailHostOrigin() {
  return `http://127.0.0.1:${PORT}`;
}

function getBearerToken(req) {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice(7).trim();
}

function pickMailBodyString(body, snakeKey, camelKey = null) {
  return (
    normalizeString(body?.[snakeKey]) ||
    (camelKey ? normalizeString(body?.[camelKey]) : "")
  );
}

function normalizeMailLinksForStore(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("links must be an array");
  }
  return value.map((entry) => ({
    id: pickMailBodyString(entry, "id"),
    label: pickMailBodyString(entry, "label"),
    href: pickMailBodyString(entry, "href"),
    linkType: pickMailBodyString(entry, "link_type", "linkType") || "external",
  }));
}

function assertGrantBoundMailField({ value, expected, fieldName }) {
  const normalizedValue = normalizeString(value);
  const normalizedExpected = normalizeString(expected);
  if (normalizedValue && normalizedExpected && normalizedValue !== normalizedExpected) {
    const err = new Error(`${fieldName} does not match capability grant`);
    err.code = "mail_capability_scope_mismatch";
    throw err;
  }
}

function buildMailCreateInputFromBody(body, grant) {
  const recipientUserId =
    pickMailBodyString(body, "recipient_user_id", "recipientUserId") ||
    grant.recipient_user_id;
  const boundSessionId = normalizeString(grant?.constraints?.session_id);
  const sessionId = pickMailBodyString(body, "session_id", "sessionId");
  const scheduleId = pickMailBodyString(body, "schedule_id", "scheduleId");
  const scheduleRunId = pickMailBodyString(
    body,
    "schedule_run_id",
    "scheduleRunId"
  );
  const agentId = pickMailBodyString(body, "agent_id", "agentId");
  assertGrantBoundMailField({
    value: recipientUserId,
    expected: grant.recipient_user_id,
    fieldName: "recipient_user_id",
  });
  assertGrantBoundMailField({
    value: scheduleId,
    expected: grant.schedule_id,
    fieldName: "schedule_id",
  });
  assertGrantBoundMailField({
    value: scheduleRunId,
    expected: grant.schedule_run_id,
    fieldName: "schedule_run_id",
  });
  assertGrantBoundMailField({
    value: agentId,
    expected: grant.agent_id,
    fieldName: "agent_id",
  });
  assertGrantBoundMailField({
    value: sessionId,
    expected: boundSessionId,
    fieldName: "session_id",
  });
  return {
    id: pickMailBodyString(body, "id"),
    recipientUserId,
    recipientSynapseUserId: pickMailBodyString(
      body,
      "recipient_synapse_user_id",
      "recipientSynapseUserId"
    ),
    title: pickMailBodyString(body, "title"),
    summary: pickMailBodyString(body, "summary"),
    bodyFormat: pickMailBodyString(body, "body_format", "bodyFormat"),
    bodyMarkdown: pickMailBodyString(body, "body_markdown", "bodyMarkdown"),
    bodyHtml: pickMailBodyString(body, "body_html", "bodyHtml"),
    sourceType: pickMailBodyString(body, "source_type", "sourceType"),
    sourceName: pickMailBodyString(body, "source_name", "sourceName"),
    sourceRef: pickMailBodyString(body, "source_ref", "sourceRef"),
    agentId: grant.agent_id || agentId,
    sessionId: boundSessionId || sessionId,
    scheduleId: grant.schedule_id || scheduleId,
    scheduleRunId: grant.schedule_run_id || scheduleRunId,
    siteUrl: pickMailBodyString(body, "site_url", "siteUrl"),
    severity: pickMailBodyString(body, "severity"),
    tags: body.tags,
    metadata: body.metadata,
    idempotencyKey: pickMailBodyString(body, "idempotency_key", "idempotencyKey"),
    links: normalizeMailLinksForStore(body.links || []),
    actorType: "capability",
    actorId:
      grant.actor_id ||
      boundSessionId ||
      grant.schedule_run_id ||
      grant.schedule_id,
  };
}

function buildDashboardMailCreateInputFromBody(body, actorId) {
  return {
    id: pickMailBodyString(body, "id"),
    recipientUserId:
      pickMailBodyString(body, "recipient_user_id", "recipientUserId") ||
      DEFAULT_HOST_APP_USER_ID,
    recipientSynapseUserId: pickMailBodyString(
      body,
      "recipient_synapse_user_id",
      "recipientSynapseUserId"
    ),
    title: pickMailBodyString(body, "title"),
    summary: pickMailBodyString(body, "summary"),
    bodyFormat: pickMailBodyString(body, "body_format", "bodyFormat"),
    bodyMarkdown: pickMailBodyString(body, "body_markdown", "bodyMarkdown"),
    bodyHtml: pickMailBodyString(body, "body_html", "bodyHtml"),
    sourceType: pickMailBodyString(body, "source_type", "sourceType") || "cli",
    sourceName:
      pickMailBodyString(body, "source_name", "sourceName") || "Oysterun CLI",
    sourceRef: pickMailBodyString(body, "source_ref", "sourceRef"),
    agentId: pickMailBodyString(body, "agent_id", "agentId"),
    sessionId: pickMailBodyString(body, "session_id", "sessionId"),
    scheduleId: pickMailBodyString(body, "schedule_id", "scheduleId"),
    scheduleRunId: pickMailBodyString(
      body,
      "schedule_run_id",
      "scheduleRunId"
    ),
    siteUrl: pickMailBodyString(body, "site_url", "siteUrl"),
    severity: pickMailBodyString(body, "severity"),
    tags: body.tags,
    metadata: body.metadata,
    idempotencyKey: pickMailBodyString(body, "idempotency_key", "idempotencyKey"),
    links: normalizeMailLinksForStore(body.links || []),
    actorType: "dashboard",
    actorId,
  };
}

function buildMailUpdateInputFromBody(body) {
  const update = {};
  const fieldMap = [
    ["title", "title"],
    ["summary", "summary"],
    ["bodyFormat", "body_format", "bodyFormat"],
    ["bodyMarkdown", "body_markdown", "bodyMarkdown"],
    ["bodyHtml", "body_html", "bodyHtml"],
    ["sourceName", "source_name", "sourceName"],
    ["sourceRef", "source_ref", "sourceRef"],
    ["agentId", "agent_id", "agentId"],
    ["sessionId", "session_id", "sessionId"],
    ["scheduleId", "schedule_id", "scheduleId"],
    ["scheduleRunId", "schedule_run_id", "scheduleRunId"],
    ["siteUrl", "site_url", "siteUrl"],
    ["severity", "severity"],
  ];
  for (const [outputKey, snakeKey, camelKey] of fieldMap) {
    if (
      Object.prototype.hasOwnProperty.call(body, snakeKey) ||
      (camelKey && Object.prototype.hasOwnProperty.call(body, camelKey))
    ) {
      update[outputKey] = pickMailBodyString(body, snakeKey, camelKey);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "tags")) {
    update.tags = body.tags;
  }
  if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
    update.metadata = body.metadata;
  }
  if (Object.prototype.hasOwnProperty.call(body, "links")) {
    update.links = normalizeMailLinksForStore(body.links);
  }
  update.actorType = "dashboard";
  update.actorId = "dashboard-admin";
  return update;
}

function getMailApiErrorStatus(err) {
  if (err?.code === "mail_capability_scope_mismatch") return 403;
  if (/not found/i.test(err?.message || "")) return 404;
  return 400;
}

function respondMailApiError(res, err) {
  return respond(res, getMailApiErrorStatus(err), {
    error: err.message || String(err),
    mail_api: true,
  });
}

function authenticateMailCreateCapability(req, res) {
  const token = getBearerToken(req);
  const verification = mailStore.verifyCapabilityToken(token, {
    scope: MAIL_CREATE_SCOPE,
  });
  if (!verification.ok) {
    const status = verification.reason === "missing_token" ? 401 : 403;
    respond(res, status, {
      error: "Mail create capability required",
      capability_scope: MAIL_CREATE_SCOPE,
      reason: verification.reason,
      raw_token_returned: false,
    });
    return null;
  }
  const grant = verification.grant;
  if (grant.grant_kind === "live_session") {
    const sessionId = normalizeString(grant?.constraints?.session_id);
    const session = sessionId ? sessionManager.getSession(sessionId) : null;
    if (!session) {
      respond(res, 403, {
        error: "Mail create capability disabled",
        capability_scope: MAIL_CREATE_SCOPE,
        reason: "live_session_not_running",
        raw_token_returned: false,
      });
      return null;
    }
    if (session.runtimeCapabilities?.[MAIL_CREATE_SCOPE] !== true) {
      respond(res, 403, {
        error: "Mail create capability disabled",
        capability_scope: MAIL_CREATE_SCOPE,
        reason: "runtime_capability_disabled",
        session_id: session.id,
        raw_token_returned: false,
      });
      return null;
    }
  }
  return grant;
}

function requireSchedulerTargetString(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) {
    const err = new Error(`${label} required`);
    err.code = "scheduler_target_required_field_missing";
    throw err;
  }
  return normalized;
}

function buildSchedulerSetupPayloadFromTargetBinding(targetBinding) {
  const setupPayload = isObjectRecord(targetBinding.setup_snapshot)
    ? { ...targetBinding.setup_snapshot }
    : isObjectRecord(targetBinding.session_setup_payload)
    ? { ...targetBinding.session_setup_payload }
    : {};
  const setupFields = isObjectRecord(targetBinding.session_setup_fields)
    ? targetBinding.session_setup_fields
    : {};
  const provider =
    normalizeString(setupPayload.provider) ||
    normalizeString(setupFields.provider);
  const model =
    normalizeString(setupPayload.model) || normalizeString(setupFields.model);
  if (provider) setupPayload.provider = provider;
  if (model) setupPayload.model = model;
  const agentFolder =
    normalizeString(setupPayload.agent_folder) ||
    normalizeString(setupPayload.cwd) ||
    normalizeString(setupFields.agent_folder) ||
    normalizeString(setupFields.agentFolder);
  if (agentFolder) {
    setupPayload.agent_folder = agentFolder;
    if (!setupPayload.cwd) setupPayload.cwd = agentFolder;
  }
  const permissionPolicy =
    normalizeString(setupPayload.approval_policy) ||
    normalizeString(setupPayload.permission_mode) ||
    normalizeString(setupFields.approval_policy) ||
    normalizeString(setupFields.approvalPolicy) ||
    normalizeString(setupFields.permission_mode) ||
    normalizeString(setupFields.permissionMode);
  if (provider === "codex" && permissionPolicy) {
    setupPayload.approval_policy = permissionPolicy;
  } else if (provider === "claude" && permissionPolicy) {
    setupPayload.permission_mode = permissionPolicy;
  }
  return setupPayload;
}

function resolveSchedulerSetupSnapshotDirectTarget({ targetBinding }) {
  const sessionPayload =
    buildSchedulerSetupPayloadFromTargetBinding(targetBinding);
  const agentId = requireSchedulerTargetString(
    targetBinding.agent_id,
    "setup_snapshot target agent_id"
  );
  const agentFolder = requireSchedulerTargetString(
    sessionPayload.agent_folder || sessionPayload.cwd,
    "setup_snapshot agent_folder"
  );
  const runtimeResolution = resolveSchedulerSessionSetupRuntime({
    agentFolder,
    sessionPayload,
  });
  return {
    source: "portable_scheduler_setup_snapshot",
    agentId,
    agentFolder,
    sessionPayload,
    resolved: runtimeResolution.resolved,
    explicitProvider: runtimeResolution.explicitProvider,
  };
}

function buildSavedSessionSetupPayloadFromHistory(sourceRecord) {
  const agentFolder = requireSchedulerTargetString(
    sourceRecord?.agent_folder,
    "saved_session source agent_folder"
  );
  const provider = requireSchedulerTargetString(
    sourceRecord?.runtime,
    "saved_session source runtime"
  );
  const seedPayload = {
    provider,
    model: normalizeString(sourceRecord.model) || undefined,
  };
  const resolved = resolveAgentRuntimeConfig(
    agentFolder,
    buildRuntimeOverridesFromBody(seedPayload, provider)
  );
  const sessionPayload = {
    provider,
    model: seedPayload.model || resolved.runtime.model,
    session_name: normalizeSessionName(sourceRecord.session_name) || undefined,
  };
  if (resolved.runtime.reasoningEffort) {
    sessionPayload.reasoning_effort = resolved.runtime.reasoningEffort;
  }
  if (provider === "codex") {
    sessionPayload.approval_policy = resolved.runtime.approvalPolicy;
  } else if (provider === "claude") {
    sessionPayload.permission_mode = resolved.runtime.permissionMode;
  }
  return sessionPayload;
}

function resolveSchedulerSessionSetupRuntime({ agentFolder, sessionPayload }) {
  const explicitProvider = readExplicitRequestedProvider(sessionPayload);
  if (explicitProvider.error) {
    const err = new Error(explicitProvider.error);
    err.code = "scheduler_session_setup_provider_invalid";
    throw err;
  }
  const resolved = resolveAgentRuntimeConfig(
    agentFolder,
    buildRuntimeOverridesFromBody(
      sessionPayload,
      explicitProvider.requestedProvider ?? undefined
    )
  );
  if (
    explicitProvider.requestedProvider &&
    resolved.runtime.provider !== explicitProvider.requestedProvider
  ) {
    const err = new Error(
      providerMismatchResponse(
        explicitProvider.requestedProvider,
        resolved.runtime.provider
      ).error
    );
    err.code = "scheduler_session_setup_provider_mismatch";
    throw err;
  }
  if (!resolved.runtime.providerInfo.runtimeSupported) {
    const err = new Error(
      `Provider "${resolved.runtime.provider}" is not runtime-supported yet`
    );
    err.code = "scheduler_session_setup_provider_unsupported";
    throw err;
  }
  const proofFields = buildSessionSetupProviderModelPermissionFields({
    body: sessionPayload,
    requestedProvider: explicitProvider.requestedProvider,
    resolved,
  });
  if (!proofFields.request_response_provider_model_permission_match) {
    const err = new Error(
      "Session setup provider/model/Oysterun permission proof mismatch"
    );
    err.code = "session_setup_provider_model_permission_mismatch";
    throw err;
  }
  return {
    explicitProvider,
    resolved,
  };
}

function resolveSchedulerSessionSetupRecordDirectTarget({ targetBinding }) {
  const sessionPayload =
    buildSchedulerSetupPayloadFromTargetBinding(targetBinding);
  const agentId = requireSchedulerTargetString(
    targetBinding.agent_id,
    "session_setup_record target agent_id"
  );
  const setupFields = isObjectRecord(targetBinding.session_setup_fields)
    ? targetBinding.session_setup_fields
    : {};
  const agentFolder =
    normalizeString(sessionPayload.agent_folder) ||
    normalizeString(setupFields.agent_folder) ||
    normalizeString(setupFields.agentFolder);
  const runtimeResolution = resolveSchedulerSessionSetupRuntime({
    agentFolder,
    sessionPayload,
  });
  return {
    source: "session_setup_record_direct_provider",
    agentId,
    agentFolder,
    sessionPayload,
    resolved: runtimeResolution.resolved,
    explicitProvider: runtimeResolution.explicitProvider,
  };
}

function resolveSchedulerSavedSessionDirectTarget({ targetBinding }) {
  const savedSessionId = requireSchedulerTargetString(
    targetBinding.saved_session_id,
    "saved_session target saved_session_id"
  );
  const sourceRecord =
    getSessionHistory().find((entry) => entry.session_id === savedSessionId) ||
    null;
  if (!sourceRecord) {
    return {
      available: false,
      reason: "saved_session_history_not_found",
    };
  }
  const agentId =
    normalizeString(targetBinding.agent_id) ||
    requireSchedulerTargetString(
      sourceRecord.agent_id,
      "saved_session agent_id"
    );
  if (sourceRecord.agent_id !== agentId) {
    const err = new Error("Saved session source agent does not match target");
    err.code = "saved_session_agent_mismatch";
    throw err;
  }
  const sessionPayload = isObjectRecord(targetBinding.session_setup_payload)
    ? buildSchedulerSetupPayloadFromTargetBinding(targetBinding)
    : buildSavedSessionSetupPayloadFromHistory(sourceRecord);
  const setupFields = isObjectRecord(targetBinding.session_setup_fields)
    ? targetBinding.session_setup_fields
    : {};
  const agentFolder =
    normalizeString(sessionPayload.agent_folder) ||
    normalizeString(setupFields.agent_folder) ||
    normalizeString(setupFields.agentFolder) ||
    sourceRecord.agent_folder;
  const runtimeResolution = resolveSchedulerSessionSetupRuntime({
    agentFolder,
    sessionPayload,
  });
  return {
    source: "saved_session_direct_provider_snapshot",
    agentId,
    agentFolder,
    sessionPayload,
    resolved: runtimeResolution.resolved,
    explicitProvider: runtimeResolution.explicitProvider,
  };
}

function resolveSchedulerTargetToDirectProviderRun({ targetBinding }) {
  if (targetBinding.kind === "setup_snapshot") {
    return resolveSchedulerSetupSnapshotDirectTarget({ targetBinding });
  }
  if (targetBinding.kind === "session_setup_record") {
    return resolveSchedulerSessionSetupRecordDirectTarget({ targetBinding });
  }
  if (targetBinding.kind === "saved_session") {
    const target = resolveSchedulerSavedSessionDirectTarget({ targetBinding });
    if (target.available === false) {
      const err = new Error(target.reason || "schedule_target_unavailable");
      err.code = target.reason || "schedule_target_unavailable";
      throw err;
    }
    return target;
  }
  const err = new Error("unsupported_schedule_target_kind");
  err.code = "unsupported_schedule_target_kind";
  throw err;
}

const sessionManager = new SessionManager();
const apnsDeviceStore = new ApnsDeviceStore({ configDir: getConfigDir() });
const apnsCompleteMessageDispatcher = new ApnsCompleteMessageDispatcher({
  configDir: getConfigDir(),
  getSession: (sessionId) => sessionManager.getSession(sessionId),
  isSessionNotificationEnabled: (session_id, matrix_room_id) =>
    isSessionNotificationEnabledFromConfig(
      session_id,
      matrix_room_id
    ),
});
const apnsMailNotificationDispatcher = new ApnsMailNotificationDispatcher({
  configDir: getConfigDir(),
  getHostConfig: readConfig,
});
const mailStore = new MailStore({ configDir: getConfigDir() });
const largeToolCallStore = createLargeToolCallStore({
  configDir: getConfigDir(),
});
const toolEventDetailStore = createToolEventDetailStore({
  configDir: getConfigDir(),
});
const schedulerService = new SchedulerService({
  mailStore,
  getHostOrigin: getSchedulerMailHostOrigin,
  getKnownAgentFolders: listHostKnownSchedulerAgentFolders,
});
let routeCMatrixFacade = null;
routeCMatrixFacade = createRouteCMatrixFacade({
  sessionManager,
  getSessionNotificationSettings: ({ sessionId, matrixRoomId }) =>
    buildSessionNotificationSettingsPayload({
      sessionId,
      matrixRoomId,
      session: sessionManager.getSession(sessionId),
    }),
  toolEventDetailStore,
  onMatrixBindingReady: async ({ binding }) => {
    const session = sessionManager.getSession(binding.host_session_id);
    if (session) {
      await refreshTelegramBridgeSession(session, "matrix_binding_ready");
    }
  },
  onCommittedMatrixEvent: async (matrixEvent) => {
    const result =
      await apnsCompleteMessageDispatcher.dispatchCommittedMatrixEvent(matrixEvent);
    if (result?.notificationReleased === true && result?.candidate) {
      broadcastCompleteMessageNotificationCandidate(result.candidate);
    }
  },
});
const schedulerSessionDispatcher = createSchedulerSessionDispatcher(
  sessionManager,
  {
    getMatrixFacade: () => routeCMatrixFacade,
  }
);
const schedulerRunner = new SchedulerRunner({
  service: schedulerService,
  sessionDispatcher: schedulerSessionDispatcher,
});
const providerModelRefreshRunner = new ProviderModelRefreshRunner(
  buildProviderModelRefreshRunnerOptions()
);
const providerModelRefreshStartupStatus = providerModelRefreshRunner.start();
if (providerModelRefreshStartupStatus?.status === "disabled") {
  console.log(
    `[provider-model-refresh] Background refresh disabled (${providerModelRefreshStartupStatus.reason}); explicit refresh remains available.`
  );
}
const providerAuthManager = new ProviderAuthManager({
  getCurrentConfig: readConfig,
});
const terminalSessionManager = new TerminalSessionManager();
let lastHostRestartRestoreStatus = null;
const telegramRealAdapter = createTelegramBotApiAdapter();
const telegramMockAdapter = createTelegramMockAdapter();
const telegramMockDebugGateClosedAdapter = {
  kind: "mock",
  async getBotIdentity() {
    throw new Error("Telegram Mock runtime debug gate is disabled");
  },
  async getUpdates() {
    throw new Error("Telegram Mock runtime debug gate is disabled");
  },
  async sendMessage() {
    throw new Error("Telegram Mock runtime debug gate is disabled");
  },
};
const telegramMockRuntimeSessionIds = new Set();
const telegramBridgeManager = createTelegramBridgeManager({
  adapter: telegramRealAdapter,
  selectAdapter: ({ session, defaultAdapter }) =>
    session?.id && telegramMockRuntimeSessionIds.has(session.id)
      ? isTelegramMockRuntimeDebugGateOpen()
        ? telegramMockAdapter
        : telegramMockDebugGateClosedAdapter
      : defaultAdapter,
  getSession: (sessionId) => sessionManager.getSession(sessionId),
  getBinding: (sessionId) => getRouteCMatrixRoomBinding(sessionId),
  commitMatrixUserMessage: async ({
    session,
    text,
    nickname,
    clientRequestId,
    telegram,
  }) =>
    routeCMatrixFacade.writeHostUserMessageSemanticEvent({
      session,
      text,
      nickname,
      clientRequestId,
      sourceId: "oysterun-telegram",
      sourceLabel: "telegram_runtime_bridge_inbound",
      telegram,
    }),
  deliverMatrixUserEvent: async ({
    session,
    binding,
    eventId,
    txnId,
    matrixUserId,
    text,
    providerText,
    nickname,
  }) =>
    sessionManager.deliverRouteCMatrixUserEventToProvider({
      sessionId: session.id,
      matrixUserId,
      matrixRoomId: binding.matrix_room_id,
      serverEventId: eventId,
      txnId,
      text,
      providerText,
      nickname,
    }),
  interruptSession: async ({ session }) =>
    interruptSessionFromTelegramBridge(session),
  runTerminalCommand: async ({ session, command }) =>
    runTerminalCommandFromTelegramBridge(session, command),
  readTranscriptMessagesAfter: ({ binding, afterSeq, limit }) =>
    readMatrixTranscriptMessagesAfter({ binding, afterSeq, limit }),
  readLatestCommittedSeq: ({ binding }) =>
    readMatrixTranscriptLatestCommittedSeq({ binding }),
  logger: console,
});
let tunnelAgent = null;

/**
 * WebSocket subscribers per live session.
 * @type {Map<string, Set<import("ws").WebSocket>>}
 */
const sessionSubscribers = new Map();
const completeMessageNotificationSubscribers = new Set();
const mailNotificationSubscribers = new Set();

function broadcastCompleteMessageNotificationCandidate(candidate) {
  if (!candidate || candidate.source !== "matrix_committed_event") return;
  if (!isCompleteMessageCandidateNotificationEnabled(candidate)) return;
  const payload = JSON.stringify({
    type: "complete_message_notification",
    source: "matrix_committed_event",
    candidate,
  });
  for (const ws of [...completeMessageNotificationSubscribers]) {
    if (ws.readyState !== 1) {
      completeMessageNotificationSubscribers.delete(ws);
      continue;
    }
    try {
      ws.send(payload);
    } catch {
      completeMessageNotificationSubscribers.delete(ws);
    }
  }
}

function broadcastMailNotificationCandidate(candidate) {
  if (!candidate || candidate.source !== "mail_item_committed") return;
  const payload = JSON.stringify({
    type: "mail_notification",
    source: "mail_item_committed",
    candidate,
  });
  for (const ws of [...mailNotificationSubscribers]) {
    if (ws.readyState !== 1) {
      mailNotificationSubscribers.delete(ws);
      continue;
    }
    try {
      ws.send(payload);
    } catch {
      mailNotificationSubscribers.delete(ws);
    }
  }
}

function emitCommittedMailNotification(mail) {
  const candidate = buildCommittedMailNotificationCandidate(mail);
  if (!candidate) return;
  broadcastMailNotificationCandidate(candidate);
  void apnsMailNotificationDispatcher
    .dispatchMailNotificationCandidate(candidate)
    .catch((err) => {
      console.warn("[mail-notification] APNs dispatch failed after Mail commit", {
        mail_id: candidate.mailId,
        error: err.message || String(err),
      });
    });
}

function buildRouteCSemanticBridgeFailureEvent(enrichedEvent, err) {
  return ensurePersistableEventFields({
    type: "runtime.error",
    sessionId: enrichedEvent.sessionId || enrichedEvent.session_id || null,
    agentId: enrichedEvent.agentId || enrichedEvent.agent_id || null,
    provider: enrichedEvent.provider || null,
    source_id: "oysterun",
    error_scope: "runtime",
    error_origin: "host",
    error: `Route C provider semantic bridge failed: ${
      err.message || String(err)
    }`,
    routec_matrix_delivery: enrichedEvent.routec_matrix_delivery || null,
    semantic_matrix_event_committed: false,
    matrix_commit_failure_unmasked: true,
    transcript_db_fallback_used: false,
  });
}

const ROUTEC_P67_TOOL_OUTPUT_STRESS_SCENARIO_ID =
  "p67-10000-tool-output-batches";
const ROUTEC_P67_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS = 500;
const ROUTEC_P67_SEMANTIC_BRIDGE_BATCH_FLUSH_DELAY_MS = 2000;
const ROUTEC_P135_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS = 25;
const ROUTEC_P135_SEMANTIC_BRIDGE_FLUSH_DELAY_MS = 50;
const routeCP67SemanticBridgeQueues = new Map();
const routeCP67SemanticBridgeTurnIds = new Set();
const routeCP135SemanticBridgeQueues = new Map();
const ROUTEC_P82_TOOL_SEMANTIC_TYPES = new Set([
  "tool.call",
  "tool.output",
  "tool.result",
  "tool.failure",
]);
const routeCP82LargeToolRunStates = new Map();
const routeCP82LargeToolRunIndexes = new Map();
const routeCP82SemanticBridgeWriteChains = new Map();

function routeCSemanticBridgeSessionId(event) {
  return (
    normalizeString(event?.routec_matrix_delivery?.host_session_id) ||
    normalizeString(event?.sessionId) ||
    normalizeString(event?.session_id)
  );
}

function routeCSemanticBridgeRoomId(event) {
  return normalizeString(event?.routec_matrix_delivery?.matrix_room_id);
}

function routeCSemanticBridgeTurnId(event) {
  return (
    normalizeString(event?.routec_matrix_delivery?.provider_turn_id) ||
    normalizeString(event?.provider_turn_id) ||
    normalizeString(event?.turn_id)
  );
}

function routeCSemanticBridgeTargetTurnId(event) {
  return (
    normalizeString(event?.target_turn_id) ||
    normalizeString(event?.routec_matrix_delivery?.target_turn_id) ||
    routeCSemanticBridgeTurnId(event)
  );
}

function routeCP82RuntimeToolSemanticType(event) {
  if (event?.type === "tool.call") return "tool.call";
  if (event?.type === "tool.output" || event?.type === "stderr") {
    return "tool.output";
  }
  if (event?.type === "tool.result") {
    return event?.is_error === true ? "tool.failure" : "tool.result";
  }
  return null;
}

function routeCSemanticBridgeSemanticType(event) {
  const runtimeToolSemanticType = routeCP82RuntimeToolSemanticType(event);
  if (runtimeToolSemanticType) return runtimeToolSemanticType;
  const explicit =
    normalizeString(event?.semantic_type) ||
    normalizeString(event?.semanticType) ||
    normalizeString(event?.routec_matrix_delivery?.semantic_type);
  if (explicit) return explicit;
  if (event?.type === "turn.completed") return "session_lifecycle";
  if (event?.type === "message.assistant") return "message.assistant";
  if (event?.type === "message.thinking") return "thinking.reasoning";
  if (event?.type === "runtime.error") return "runtime.error";
  if (
    event?.type === "session.lifecycle" ||
    event?.type === "session.ready" ||
    event?.type === "session.exit"
  ) {
    return "session_lifecycle";
  }
  return normalizeString(event?.type);
}

function routeCP82GroupingKeyForEvent(event) {
  const sessionId = routeCSemanticBridgeSessionId(event) || "unknown-session";
  const roomId = routeCSemanticBridgeRoomId(event) || "unknown-room";
  const providerTurnId = routeCSemanticBridgeTurnId(event);
  if (providerTurnId) {
    return {
      key: `${sessionId}\u001f${roomId}\u001fprovider_turn_id\u001f${providerTurnId}`,
      kind: "provider_turn_id",
      value: providerTurnId,
    };
  }
  const targetTurnId = routeCSemanticBridgeTargetTurnId(event);
  if (targetTurnId) {
    return {
      key: `${sessionId}\u001f${roomId}\u001ftarget_turn_id\u001f${targetTurnId}`,
      kind: "target_turn_id",
      value: targetTurnId,
    };
  }
  const sender =
    normalizeString(event?.matrix_event_sender) ||
    normalizeString(event?.routec_matrix_delivery?.matrix_user_id) ||
    "host-provider";
  return {
    key: `${sessionId}\u001f${roomId}\u001fmatrix_event_sender\u001f${sender}`,
    kind: "matrix_event_sender",
    value: sender,
  };
}

function routeCP82NextRunIndex(groupKey) {
  const next = (routeCP82LargeToolRunIndexes.get(groupKey) || 0) + 1;
  routeCP82LargeToolRunIndexes.set(groupKey, next);
  return next;
}

function routeCP82GetOrCreateToolRunState(event) {
  const grouping = routeCP82GroupingKeyForEvent(event);
  let state = routeCP82LargeToolRunStates.get(grouping.key);
  if (!state) {
    state = {
      key: grouping.key,
      groupingKeyKind: grouping.kind,
      groupingKey: grouping.value,
      consecutiveRunIndex: routeCP82NextRunIndex(grouping.key),
      sessionId: routeCSemanticBridgeSessionId(event),
      matrixRoomId: routeCSemanticBridgeRoomId(event),
      providerTurnId: routeCSemanticBridgeTurnId(event),
      targetTurnId: routeCSemanticBridgeTargetTurnId(event),
      count: 0,
      retainedMatrixEventIds: [],
      largeToolRef: null,
      noticeSent: false,
      noticeMatrixEventId: null,
    };
    routeCP82LargeToolRunStates.set(grouping.key, state);
  }
  return state;
}

function routeCP82ResetToolRunState(event) {
  const grouping = routeCP82GroupingKeyForEvent(event);
  routeCP82LargeToolRunStates.delete(grouping.key);
}

function routeCP82ToolRunIdentity(state) {
  return {
    source_host_session_id: state.sessionId,
    source_matrix_room_id: state.matrixRoomId,
    provider_turn_id: state.providerTurnId,
    target_turn_id: state.targetTurnId,
    grouping_key: state.groupingKey,
    grouping_key_kind: state.groupingKeyKind,
    consecutive_run_index: state.consecutiveRunIndex,
  };
}

function routeCP82BuildNoticeEvent(sourceEvent, state) {
  const delivery = sourceEvent.routec_matrix_delivery || {};
  return {
    ...sourceEvent,
    type: "session.lifecycle",
    semantic_type: "session_lifecycle",
    semantic_body: ROUTEC_LARGE_TOOL_NOTICE_BODY,
    body: ROUTEC_LARGE_TOOL_NOTICE_BODY,
    display_text: ROUTEC_LARGE_TOOL_NOTICE_BODY,
    provider: sourceEvent.provider || delivery.provider_id || null,
    routec_matrix_delivery: {
      ...delivery,
      semantic_type: "session_lifecycle",
      provider_runtime_event_index: null,
      large_tool_notice: true,
      large_tool_notice_kind: ROUTEC_LARGE_TOOL_NOTICE_KIND,
      consecutive_run_index: state.consecutiveRunIndex,
      matrix_retained_tool_event_count: ROUTEC_LARGE_TOOL_EVENT_THRESHOLD,
      tool_event_count_label: ROUTEC_LARGE_TOOL_EVENT_COUNT_LABEL,
      detail_available: true,
      search_indexed: true,
    },
    large_tool_notice: true,
    large_tool_notice_kind: ROUTEC_LARGE_TOOL_NOTICE_KIND,
    consecutive_run_index: state.consecutiveRunIndex,
    matrix_retained_tool_event_count: ROUTEC_LARGE_TOOL_EVENT_THRESHOLD,
    tool_event_count_label: ROUTEC_LARGE_TOOL_EVENT_COUNT_LABEL,
    detail_available: true,
    search_indexed: true,
    durable: true,
    replay_policy: "always",
  };
}

async function routeCP82WriteNoticeIfNeeded(sourceEvent, state) {
  if (state.noticeSent) {
    return {
      status: "large_tool_notice_already_sent",
      event_id: state.noticeMatrixEventId,
    };
  }
  const result = await routeCMatrixFacade.writeProviderSemanticEventFromRuntime({
    event: routeCP82BuildNoticeEvent(sourceEvent, state),
  });
  state.noticeSent = true;
  state.noticeMatrixEventId = result?.event_id || null;
  if (state.largeToolRef) {
    largeToolCallStore.markNoticeSent({
      sessionId: state.sessionId,
      largeToolRef: state.largeToolRef,
      noticeMatrixEventId: state.noticeMatrixEventId,
    });
  }
  return result;
}

function routeCP82NoteRetainedMatrixEvent(state, result) {
  if (
    result?.status === "provider_semantic_matrix_event_committed" &&
    result?.event_id
  ) {
    state.retainedMatrixEventIds.push(result.event_id);
  }
}

async function routeCP82WriteSemanticBridgeEvent(enrichedEvent) {
  const semanticType = routeCSemanticBridgeSemanticType(enrichedEvent);
  if (!ROUTEC_P82_TOOL_SEMANTIC_TYPES.has(semanticType)) {
    if (semanticType) {
      routeCP82ResetToolRunState(enrichedEvent);
    }
    return routeCMatrixFacade.writeProviderSemanticEventFromRuntime({
      event: enrichedEvent,
    });
  }

  const state = routeCP82GetOrCreateToolRunState(enrichedEvent);
  state.count += 1;
  if (state.count <= ROUTEC_LARGE_TOOL_EVENT_THRESHOLD) {
    const result = await routeCMatrixFacade.writeProviderSemanticEventFromRuntime({
      event: enrichedEvent,
    });
    routeCP82NoteRetainedMatrixEvent(state, result);
    return result;
  }

  const appendResult = largeToolCallStore.appendToolEvent({
    identity: routeCP82ToolRunIdentity(state),
    retainedMatrixEventIds: state.retainedMatrixEventIds,
    event: enrichedEvent,
    semanticType,
    toolEventIndex: state.count,
  });
  state.largeToolRef = appendResult.large_tool_ref || state.largeToolRef;
  if (state.count === ROUTEC_LARGE_TOOL_EVENT_THRESHOLD + 1) {
    const noticeResult = await routeCP82WriteNoticeIfNeeded(
      enrichedEvent,
      state
    );
    return {
      status: "large_tool_event_spilled_with_matrix_notice",
      semantic_matrix_event_committed: false,
      spillover_jsonl_written: appendResult.appended === true,
      notice_result: noticeResult,
      large_tool_summary: appendResult.index,
      matrix_large_ref_written: false,
      matrix_large_tool_ref_written: false,
      raw_path_exposed: false,
    };
  }
  return {
    status: "large_tool_event_spilled_to_jsonl_only",
    semantic_matrix_event_committed: false,
    spillover_jsonl_written: appendResult.appended === true,
    large_tool_summary: appendResult.index,
    matrix_large_ref_written: false,
    matrix_large_tool_ref_written: false,
    raw_path_exposed: false,
  };
}

function routeCP82EnqueueSemanticBridgeWrite(enrichedEvent) {
  const grouping = routeCP82GroupingKeyForEvent(enrichedEvent);
  const previous =
    routeCP82SemanticBridgeWriteChains.get(grouping.key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => routeCP82WriteSemanticBridgeEvent(enrichedEvent))
    .finally(() => {
      if (routeCP82SemanticBridgeWriteChains.get(grouping.key) === next) {
        routeCP82SemanticBridgeWriteChains.delete(grouping.key);
      }
    });
  routeCP82SemanticBridgeWriteChains.set(grouping.key, next);
  return next;
}

function routeCSemanticBridgeQueueKey(event) {
  const sessionId = routeCSemanticBridgeSessionId(event) || "unknown-session";
  const roomId = routeCSemanticBridgeRoomId(event) || "unknown-room";
  const turnId = routeCSemanticBridgeTurnId(event) || "unknown-turn";
  return `${sessionId}\u001f${roomId}\u001f${turnId}`;
}

function isP67ToolOutputStressSemanticBridgeEvent(event) {
  const delivery = event?.routec_matrix_delivery || {};
  const turnId = routeCSemanticBridgeTurnId(event);
  if (
    event?.p67_stress_scenario === ROUTEC_P67_TOOL_OUTPUT_STRESS_SCENARIO_ID ||
    event?.debug_fixture_pattern_id ===
      ROUTEC_P67_TOOL_OUTPUT_STRESS_SCENARIO_ID ||
    delivery.p67_stress_scenario ===
      ROUTEC_P67_TOOL_OUTPUT_STRESS_SCENARIO_ID ||
    delivery.debug_fixture_pattern_id ===
      ROUTEC_P67_TOOL_OUTPUT_STRESS_SCENARIO_ID
  ) {
    if (turnId) {
      routeCP67SemanticBridgeTurnIds.add(turnId);
    }
    return true;
  }
  return (
    event?.type === "turn.completed" &&
    Boolean(turnId && routeCP67SemanticBridgeTurnIds.has(turnId))
  );
}

function broadcastRouteCSemanticBridgeFailure(enrichedEvent, err) {
  console.error(
    `[routec] provider semantic bridge failed: ${err.message || err}`
  );
  const sessionId = enrichedEvent.sessionId || enrichedEvent.session_id || null;
  if (sessionId) {
    broadcast(sessionId, {
      type: "event",
      event: buildRouteCSemanticBridgeFailureEvent(enrichedEvent, err),
    });
  }
}

function getRouteCP67SemanticBridgeQueue(enrichedEvent) {
  const key = routeCSemanticBridgeQueueKey(enrichedEvent);
  let queue = routeCP67SemanticBridgeQueues.get(key);
  if (!queue) {
    queue = {
      key,
      events: [],
      timer: null,
      flushing: false,
      flushAfterCurrent: false,
    };
    routeCP67SemanticBridgeQueues.set(key, queue);
  }
  return queue;
}

function getRouteCP135SemanticBridgeQueue(enrichedEvent) {
  const key = routeCSemanticBridgeQueueKey(enrichedEvent);
  let queue = routeCP135SemanticBridgeQueues.get(key);
  if (!queue) {
    queue = {
      key,
      events: [],
      timer: null,
      flushing: false,
      flushAfterCurrent: false,
      batchIndex: 0,
    };
    routeCP135SemanticBridgeQueues.set(key, queue);
  }
  return queue;
}

function scheduleRouteCP135SemanticBridgeQueueFlush(queue, delayMs) {
  if (queue.timer || queue.flushing) return;
  queue.timer = setTimeout(() => {
    queue.timer = null;
    void flushRouteCP135SemanticBridgeQueue(queue);
  }, delayMs);
  if (typeof queue.timer.unref === "function") {
    queue.timer.unref();
  }
}

async function flushRouteCP135SemanticBridgeQueue(queue) {
  if (queue.flushing) return;
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }
  const events = queue.events.splice(
    0,
    ROUTEC_P135_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS
  );
  if (events.length === 0) {
    routeCP135SemanticBridgeQueues.delete(queue.key);
    return;
  }
  queue.flushing = true;
  queue.batchIndex += 1;
  const batchIndex = queue.batchIndex;
  const queuedAt = new Date().toISOString();
  const diagnosticsEnabled = isRouteCChatLivenessDiagnosticsEnabled();
  try {
    await runRouteCMatrixStorageWriteBatch(async () => {
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (diagnosticsEnabled) {
          event.routec_semantic_write_pacing = {
            p135_active_run_liveness_repair: true,
            schema: "routec.p135_provider_semantic_bridge_pacing.v1",
            queue_key_present: true,
            queue_key_hash: routeCStableHash(queue.key).slice(0, 16),
            batch_index: batchIndex,
            batch_event_count: events.length,
            batch_event_index: index + 1,
            batch_max_events: ROUTEC_P135_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS,
            flush_delay_ms: ROUTEC_P135_SEMANTIC_BRIDGE_FLUSH_DELAY_MS,
            serialized_per_host_session_source_event: true,
            storage_batch_commit_used: true,
            individual_durable_matrix_events_preserved: true,
            provider_lifecycle_policy_changed: false,
            matrix_budget_semantics_changed: false,
            p135_matrix_budget_bytes_changed: false,
            rejected_p134_256k_cap_recreated: false,
            payload_drop_or_truncation_used: false,
            raw_provider_or_tool_payload_logged: false,
            queued_at: queuedAt,
          };
        } else {
          delete event.routec_semantic_write_pacing;
        }
        await routeCP82WriteSemanticBridgeEvent(event);
      }
    });
  } catch (err) {
    for (const event of events) {
      broadcastRouteCSemanticBridgeFailure(event, err);
    }
  } finally {
    queue.flushing = false;
    if (queue.events.length > 0) {
      const flushImmediately =
        queue.flushAfterCurrent ||
        queue.events.length >= ROUTEC_P135_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS;
      queue.flushAfterCurrent = false;
      scheduleRouteCP135SemanticBridgeQueueFlush(
        queue,
        flushImmediately ? 0 : ROUTEC_P135_SEMANTIC_BRIDGE_FLUSH_DELAY_MS
      );
    } else {
      routeCP135SemanticBridgeQueues.delete(queue.key);
    }
  }
}

function scheduleRouteCP67SemanticBridgeQueueFlush(queue, delayMs) {
  if (queue.timer || queue.flushing) return;
  queue.timer = setTimeout(() => {
    queue.timer = null;
    void flushRouteCP67SemanticBridgeQueue(queue);
  }, delayMs);
}

async function flushRouteCP67SemanticBridgeQueue(queue) {
  if (queue.flushing) return;
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }
  const events = queue.events.splice(
    0,
    ROUTEC_P67_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS
  );
  if (events.length === 0) {
    routeCP67SemanticBridgeQueues.delete(queue.key);
    return;
  }
  queue.flushing = true;
  try {
    for (const event of events) {
      await routeCP82EnqueueSemanticBridgeWrite(event);
    }
  } catch (err) {
    for (const event of events) {
      broadcastRouteCSemanticBridgeFailure(event, err);
    }
  } finally {
    queue.flushing = false;
    if (queue.events.length > 0) {
      const flushImmediately =
        queue.flushAfterCurrent ||
        queue.events.length >= ROUTEC_P67_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS;
      queue.flushAfterCurrent = false;
      const nextDelay =
        flushImmediately ? 0 : ROUTEC_P67_SEMANTIC_BRIDGE_BATCH_FLUSH_DELAY_MS;
      scheduleRouteCP67SemanticBridgeQueueFlush(queue, nextDelay);
    } else {
      routeCP67SemanticBridgeQueues.delete(queue.key);
    }
  }
}

function scheduleRouteCSemanticBridgeWrite(enrichedEvent) {
  if (isP67ToolOutputStressSemanticBridgeEvent(enrichedEvent)) {
    const queue = getRouteCP67SemanticBridgeQueue(enrichedEvent);
    queue.events.push(enrichedEvent);
    if (
      enrichedEvent.type === "turn.completed" ||
      queue.events.length >= ROUTEC_P67_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS
    ) {
      if (queue.flushing) {
        queue.flushAfterCurrent = true;
      } else {
        void flushRouteCP67SemanticBridgeQueue(queue);
      }
    } else {
      scheduleRouteCP67SemanticBridgeQueueFlush(
        queue,
        ROUTEC_P67_SEMANTIC_BRIDGE_BATCH_FLUSH_DELAY_MS
      );
    }
    if (enrichedEvent.type === "turn.completed") {
      const turnId = routeCSemanticBridgeTurnId(enrichedEvent);
      if (turnId) {
        routeCP67SemanticBridgeTurnIds.delete(turnId);
      }
    }
    return;
  }
  const queue = getRouteCP135SemanticBridgeQueue(enrichedEvent);
  queue.events.push(enrichedEvent);
  if (
    enrichedEvent.type === "turn.completed" ||
    queue.events.length >= ROUTEC_P135_SEMANTIC_BRIDGE_BATCH_MAX_EVENTS
  ) {
    if (queue.flushing) {
      queue.flushAfterCurrent = true;
    } else {
      void flushRouteCP135SemanticBridgeQueue(queue);
    }
    return;
  }
  scheduleRouteCP135SemanticBridgeQueueFlush(
    queue,
    ROUTEC_P135_SEMANTIC_BRIDGE_FLUSH_DELAY_MS
  );
}

// ── Session Manager Events → WebSocket Broadcast ──────────────

sessionManager.on("runtimeEvent", (agentId, event) => {
  const enrichedEvent = ensurePersistableEventFields(
    attachRuntimeTurnId(event, () => null)
  );
  const routeCSemanticRuntimeTypes = new Set([
    "message.assistant",
    "message.thinking",
    "tool.call",
    "tool.output",
    "tool.result",
    "control.request",
    "control.outcome",
    "runtime.error",
    "turn.completed",
    "session.lifecycle",
    "session.ready",
    "session.exit",
    "routec.semantic.absence",
  ]);
  if (
    enrichedEvent.routec_matrix_delivery &&
    (routeCSemanticRuntimeTypes.has(enrichedEvent.type) ||
      (typeof enrichedEvent.semantic_type === "string" &&
        enrichedEvent.semantic_type.trim()))
  ) {
    scheduleRouteCSemanticBridgeWrite(enrichedEvent);
  }
  broadcast(enrichedEvent.sessionId || enrichedEvent.session_id || null, {
    type: "event",
    event: enrichedEvent,
  });
  if (enrichedEvent.type === "session.started") {
    reportSessionState(agentId, enrichedEvent.sessionId, "active");
  } else if (enrichedEvent.type === "session.exit") {
    telegramBridgeManager.stopSession(
      enrichedEvent.sessionId || enrichedEvent.session_id,
      "session_exit"
    );
    clearTelegramMockRuntimeForSession(
      enrichedEvent.sessionId || enrichedEvent.session_id,
      "session_exit"
    );
    reportSessionState(agentId, enrichedEvent.sessionId, "closed");
  }
});

function broadcast(sessionId, payload) {
  const routedSessionId =
    sessionId ||
    payload?.event?.sessionId ||
    payload?.event?.session_id ||
    null;
  if (!routedSessionId) return;
  bufferMessage(routedSessionId, payload);
  const subs = sessionSubscribers.get(routedSessionId);
  if (!subs) return;
  const json = JSON.stringify(payload);
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) {
      ws.send(json);
    }
  }
}

function createUserEvent(agentId, sessionId, userId, nickname, text) {
  return {
    type: "event",
    event: {
      type: "message.user",
      agentId,
      sessionId,
      provider: null,
      user_id: userId,
      nickname,
      text,
    },
  };
}

async function refreshTelegramBridgeSession(session, reason) {
  if (!session?.id) return null;
  if (
    telegramMockRuntimeSessionIds.has(session.id) &&
    !isTelegramMockRuntimeDebugGateOpen()
  ) {
    telegramBridgeManager.stopSession(session.id, "telegram_mock_debug_gate_closed");
    return buildTelegramMockRuntimeProof(session, {
      status: "telegram_mock_runtime_debug_gate_closed",
      listening: false,
      reason,
    });
  }
  try {
    return await telegramBridgeManager.ensureSession(session, reason);
  } catch (err) {
    console.warn(
      `[telegram-bridge] refresh failed for session ${session.id}: ${
        err?.message || err
      }`
    );
    return {
      status: "telegram_bridge_refresh_failed",
      session_id: session.id,
      token_redacted: true,
      allowed_users_redacted: true,
    };
  }
}

function buildSessionTelegramRuntimeStatusPayload(session) {
  const sessionId = normalizeString(session?.id || session?.sessionId);
  if (!sessionId) return null;
  const runtime = telegramBridgeManager.runtimeStatus(sessionId);
  const status =
    normalizeString(runtime?.status) ||
    (runtime?.disabled === true
      ? "telegram_listener_disabled"
      : runtime?.listening === true
      ? "telegram_listener_active"
      : "telegram_listener_inactive");
  return {
    status,
    listening: runtime?.listening === true,
    disabled: runtime?.disabled === true,
    disabled_reason: normalizeString(runtime?.disabled_reason),
    owner_session_id: normalizeString(runtime?.owner_session_id),
    listener_count: Number.isInteger(runtime?.listener_count)
      ? runtime.listener_count
      : 0,
    adapter_kind:
      runtime?.adapter_kind === "real" || runtime?.adapter_kind === "mock"
        ? runtime.adapter_kind
        : null,
    bot_username_configured: runtime?.bot_username_configured === true,
    bound_chat: runtime?.bound_chat === true,
    send_tool_messages: runtime?.send_tool_messages === true,
    latest_transcript_seq: Number.isInteger(runtime?.latest_transcript_seq)
      ? runtime.latest_transcript_seq
      : null,
    token_redacted: true,
    allowed_users_redacted: true,
  };
}

const TELEGRAM_MOCK_RUNTIME_DEBUG_GATE = "debug_fixture_provider_enabled";
const TELEGRAM_MOCK_RUNTIME_PERSISTENCE = "none";
const TELEGRAM_MOCK_RUNTIME_SLASH_COMMAND_BEHAVIOR =
  "slash_as_chat_when_routeSlashCommand_unbound";

function isTelegramMockRuntimeDebugGateOpen() {
  try {
    return isDebugFixtureProviderEnabled(readConfig());
  } catch {
    return isDebugFixtureProviderEnabled({});
  }
}

function requireTelegramMockRuntimeDebugGate(claims, res) {
  if (!requireDashboardMode(claims, res)) return false;
  if (isTelegramMockRuntimeDebugGateOpen()) return true;
  respond(res, 403, {
    error: "Telegram Mock runtime debug gate is disabled",
    status: "telegram_mock_runtime_debug_gate_closed",
    debug_gate: TELEGRAM_MOCK_RUNTIME_DEBUG_GATE,
    mock_runtime_available: false,
    real_telegram_network_attempted: false,
    token_redacted: true,
    allowed_users_redacted: true,
  });
  return false;
}

function buildTelegramMockRuntimeProof(session, extra = {}) {
  const sessionId = normalizeString(session?.id || session?.sessionId);
  const runtime = sessionId
    ? buildSessionTelegramRuntimeStatusPayload(session)
    : null;
  return {
    session_id: sessionId,
    agent_id: normalizeString(session?.agentId),
    debug_gate: TELEGRAM_MOCK_RUNTIME_DEBUG_GATE,
    debug_gate_open: isTelegramMockRuntimeDebugGateOpen(),
    adapter_kind: "mock",
    mock_runtime_bound:
      Boolean(sessionId) && telegramMockRuntimeSessionIds.has(sessionId),
    persistence: TELEGRAM_MOCK_RUNTIME_PERSISTENCE,
    config_persisted: false,
    routeSlashCommand_bound: false,
    slash_command_behavior: TELEGRAM_MOCK_RUNTIME_SLASH_COMMAND_BEHAVIOR,
    real_telegram_network_attempted: false,
    token_redacted: true,
    allowed_users_redacted: true,
    telegram_runtime: runtime,
    ...extra,
  };
}

function ensureTelegramMockRouteCMatrixBinding(session, reason) {
  if (!session?.id || !session?.agentId) {
    throw new Error("Telegram Mock runtime requires a live Host session");
  }
  let binding = getRouteCMatrixRoomBinding(session.id);
  const bindingCreated = !binding;
  if (!binding) {
    binding = createRouteCMatrixRoomBinding({
      session,
      agentId: session.agentId,
    });
  }
  const matrixStorage = ensureRouteCMatrixRoomStorage({ binding });
  return {
    routec_matrix_binding_ready: true,
    routec_matrix_binding_materialized_from_live_session: bindingCreated,
    host_session_id: binding.host_session_id,
    matrix_room_id: binding.matrix_room_id,
    binding_source: binding.binding_source,
    matrix_storage: matrixStorage,
    reason,
    session_created: false,
    provider_started: false,
    real_telegram_network_attempted: false,
    token_redacted: true,
    allowed_users_redacted: true,
    raw_synapse_token_exposed: false,
  };
}

function materializeRouteCMatrixBindingForSessionSend(session) {
  if (!session || typeof session !== "object") {
    throw new Error("Route C clean-chat send requires a live Host session");
  }
  const sessionId = typeof session.id === "string" ? session.id.trim() : "";
  const agentId =
    typeof session.agentId === "string" ? session.agentId.trim() : "";
  if (!sessionId) {
    throw new Error("Route C clean-chat send requires session.id");
  }
  if (!agentId) {
    throw new Error("Route C clean-chat send requires session.agentId");
  }

  let binding = getRouteCMatrixRoomBinding(sessionId);
  const materializedFromLiveSession = !binding;
  if (!binding) {
    binding = createRouteCMatrixRoomBinding({
      session,
      agentId,
    });
  }
  if (!binding || binding.host_session_id !== sessionId) {
    throw new Error(
      "Route C clean-chat send could not materialize a session binding"
    );
  }
  if (binding.host_agent_id !== agentId) {
    throw new Error(
      "Route C clean-chat send binding agent did not match the live session"
    );
  }
  if (
    typeof binding.matrix_room_id !== "string" ||
    !binding.matrix_room_id.trim()
  ) {
    throw new Error("Route C clean-chat send binding is missing matrix_room_id");
  }

  const matrixStorage = ensureRouteCMatrixRoomStorage({ binding });
  return {
    status: "routec_matrix_binding_ready_for_session_send",
    binding,
    matrix_storage: matrixStorage,
    routec_matrix_binding_materialized_from_live_session:
      materializedFromLiveSession,
    routec_matrix_binding_reused: materializedFromLiveSession !== true,
    provider_delivery_attempted: false,
    transcript_db_fallback_used: false,
    host_db_transcript_product_truth: false,
  };
}

function clearTelegramMockRuntimeForSession(sessionId, reason) {
  const normalizedSessionId = normalizeString(sessionId);
  if (!normalizedSessionId) {
    return {
      mock_runtime_was_bound: false,
      mock_capture_cleared: false,
      mock_updates_cleared: false,
    };
  }
  const wasBound = telegramMockRuntimeSessionIds.delete(normalizedSessionId);
  if (wasBound) {
    telegramMockAdapter.clear();
  }
  return {
    mock_runtime_was_bound: wasBound,
    mock_capture_cleared: wasBound,
    mock_updates_cleared: wasBound,
    reason,
  };
}

function requireTelegramMockBoundSession(claims, sessionId, capability, res) {
  const session = requireSessionCapability(claims, sessionId, capability, res);
  if (!session) return null;
  if (!telegramMockRuntimeSessionIds.has(session.id)) {
    respond(res, 409, {
      error: "Telegram Mock runtime is not bound for this session",
      status: "telegram_mock_runtime_not_bound",
      session_id: session.id,
      debug_gate: TELEGRAM_MOCK_RUNTIME_DEBUG_GATE,
      real_telegram_network_attempted: false,
      token_redacted: true,
      allowed_users_redacted: true,
    });
    return null;
  }
  return session;
}

function normalizeTelegramMockMessageRequest(body = {}) {
  if (isPlainObject(body.update)) {
    return {
      kind: "update",
      update: body.update,
    };
  }
  const text = normalizeString(body.text);
  if (!text) {
    throw new Error("text required for mock Telegram message");
  }
  const updateId =
    Number.isSafeInteger(Number(body.update_id)) && Number(body.update_id) > 0
      ? Number(body.update_id)
      : Date.now();
  const chatId = normalizeString(body.chat_id) || "telegram-mock-chat";
  const fromId = normalizeString(body.from_id) || "telegram-mock-user";
  const username = normalizeString(body.username) || "owner";
  const chatType = normalizeString(body.chat_type) || "private";
  const messageId =
    Number.isSafeInteger(Number(body.message_id)) && Number(body.message_id) > 0
      ? Number(body.message_id)
      : null;
  const memberCount =
    Number.isSafeInteger(Number(body.member_count)) && Number(body.member_count) > 0
      ? Number(body.member_count)
      : null;
  return {
    kind: "message",
    message: {
      updateId,
      chatId,
      chatType,
      text,
      fromId,
      username,
      messageId,
      replyToBot: body.reply_to_bot === true,
      memberCount,
    },
  };
}

function serializeTelegramMockSentMessages() {
  return telegramMockAdapter.getSentMessages().map((entry, index) => ({
    index,
    operation: normalizeString(entry.operation) || "sendMessage",
    message_id:
      Number.isSafeInteger(Number(entry.message_id))
        ? Number(entry.message_id)
        : index + 1,
    text: typeof entry.text === "string" ? entry.text : "",
    final: entry.final === true,
    kind: normalizeString(entry.kind) || "message",
    parse_mode: normalizeString(entry.parse_mode) || null,
    reply_markup_present: Boolean(entry.reply_markup),
    message_effect_id_present: Boolean(normalizeString(entry.message_effect_id)),
    reply_to_message_id_present:
      entry.reply_to_message_id !== null &&
      entry.reply_to_message_id !== undefined,
    chat_id_redacted: true,
    token_redacted: true,
    allowed_users_redacted: true,
    raw_chat_id_exposed: false,
  }));
}

async function interruptSessionFromTelegramBridge(session) {
  if (!session?.id) {
    throw new Error("Telegram interrupt requires a live session");
  }
  const controlRequestId = createRouteCSessionControlRequestId(
    "telegram_interrupt",
    session.id
  );
  await requireRouteCSessionControlSemanticCommit({
    session,
    stage: "telegram_interrupt_action",
    event: {
      type: "control.request",
      control_request_id: controlRequestId,
      control_kind: "interrupt",
      control_family: "session_control",
      control_origin: "telegram",
      actor: "telegram",
      target_id: session.id,
      target_session_id: session.id,
      allowed_actions: ["interrupt"],
      semantic_body: "Telegram interrupt requested for session.",
      source_label: "telegram_runtime_bridge_interrupt",
      durable: true,
      replay_policy: "latest_state_only",
    },
  });
  const interruptedShellExecIds = interruptActiveShellExecs(
    session.id,
    "telegram_interrupt"
  );
  if (interruptedShellExecIds.length === 0) {
    sessionManager.interruptSession(session.id);
  }
  await requireRouteCSessionControlSemanticCommit({
    session,
    stage: "telegram_interrupt_accepted",
    event: {
      type: "control.outcome",
      control_request_id: controlRequestId,
      control_kind: "interrupt",
      control_family: "session_control",
      control_origin: "telegram",
      actor: "telegram",
      outcome: "accepted",
      control_outcome: "accepted",
      target_id: session.id,
      target_session_id: session.id,
      semantic_body: interruptedShellExecIds.length
        ? "Telegram interrupt accepted for active shell execution."
        : "Telegram interrupt accepted for session.",
      source_label: "telegram_runtime_bridge_interrupt",
      durable: true,
      replay_policy: "always",
    },
  });
  return {
    status: "telegram_interrupt_accepted",
    session_id: session.id,
    shell_exec_ids: interruptedShellExecIds,
  };
}

async function runTerminalCommandFromTelegramBridge(session, command) {
  if (!session?.id) {
    throw new Error("Telegram terminal command requires a live session");
  }
  const normalizedCommand = normalizeString(command);
  if (!normalizedCommand) {
    throw new Error("Telegram terminal command requires command");
  }
  const cwd = getSessionExecutionCwd(session.id);
  if (!cwd) {
    throw new Error("No live session cwd available");
  }
  const execId = randomUUID();
  const startedAt = new Date().toISOString();
  const startEnvelope = createShellStartEvent(
    session.agentId,
    session.id,
    execId,
    normalizedCommand,
    cwd,
    startedAt
  );
  startEnvelope.event.route = "telegram_runtime_bridge_terminal_command";
  const startedSemanticCommit =
    await requireRouteCTerminalCommandStartedSemanticCommit({
      session,
      event: startEnvelope.event,
      stage: "telegram_before_shell_execution",
    });
  runShellCommand(session.id, normalizedCommand, cwd, {
    execId,
    startedAt,
    startedSemanticCommit,
    matrixTerminalSemanticDurabilityRequired: true,
  });
  return {
    status: "telegram_terminal_command_started",
    session_id: session.id,
    exec_id: execId,
    terminal_exec_id: execId,
    command: normalizedCommand,
    cwd,
    terminal_command_started_matrix_event_id: startedSemanticCommit.event_id,
    terminal_command_result_matrix_event_required: true,
    provider_delivery_attempted: false,
  };
}

function emitSessionLifecycleEvent(session, subtype, extra = {}) {
  if (!session?.id) return null;
  const event = ensurePersistableEventFields({
    type: "session.lifecycle",
    subtype,
    sessionId: session.id,
    agentId: session.agentId,
    provider: session.provider || "claude",
    ...extra,
  });
  broadcast(session.id, { type: "event", event });
  return event;
}

function createRouteCSessionControlRequestId(controlKind, sessionId) {
  return `routec_control_${controlKind}_${sessionId}_${randomUUID()}`;
}

async function writeRouteCSessionControlSemanticEvent(session, event) {
  try {
    return await routeCMatrixFacade.writeHostControlSemanticEvent({
      session,
      event,
    });
  } catch (err) {
    console.error(
      `[routec] host control semantic write failed: ${err.message || err}`
    );
    return {
      status: "routec_control_semantic_write_failed",
      semantic_matrix_event_committed: false,
      error: err.message || String(err),
      readiness_claimed: false,
      foundation_pass_claimed: false,
    };
  }
}

function classifyRouteCSessionControlSemanticWriteFailure(result) {
  const status = typeof result?.status === "string" ? result.status : "";
  if (status === "routec_control_semantic_binding_missing") {
    return "missing_routec_matrix_binding";
  }
  if (status === "control_semantic_matrix_event_not_committed") {
    const terminalReason =
      typeof result?.semantic_retry_proof?.terminal_non_pass_reason === "string"
        ? result.semantic_retry_proof.terminal_non_pass_reason
        : "";
    if (terminalReason === "semantic_matrix_send_response_missing_event_id") {
      return "matrix_send_event_id_missing";
    }
    if (terminalReason.startsWith("semantic_matrix_rate_limit")) {
      return "matrix_send_rate_limit_not_committed";
    }
    return "matrix_send_not_committed";
  }
  if (status === "routec_control_semantic_write_failed") {
    return "semantic_writer_exception";
  }
  if (!result || typeof result !== "object") {
    return "semantic_writer_result_missing";
  }
  return "semantic_matrix_event_not_committed";
}

function createRouteCSessionControlSemanticCommitError({
  session,
  event,
  result,
  stage,
}) {
  const reason = classifyRouteCSessionControlSemanticWriteFailure(result);
  const controlKind = event?.control_kind || "session_control";
  const semanticType =
    event?.type || event?.semantic_type || "control.semantic";
  const err = new Error(
    `Route C ${controlKind} ${semanticType} Matrix semantic commit required before ${stage}: ${reason}`
  );
  err.statusCode = 424;
  err.routeCControlSemanticCommitError = true;
  err.routeCControlSemanticCommit = {
    error: "routec_control_semantic_matrix_commit_required",
    reason,
    stage,
    host_session_id: session?.id || null,
    control_kind: controlKind,
    semantic_type: semanticType,
    control_request_id: event?.control_request_id || null,
    control_outcome_id:
      result?.control_outcome_id || event?.control_outcome_id || null,
    semantic_write_status: result?.status || null,
    semantic_write_error: result?.error || result?.skipped_reason || null,
    semantic_terminal_non_pass_reason:
      result?.semantic_retry_proof?.terminal_non_pass_reason || null,
    semantic_matrix_event_committed:
      result?.semantic_matrix_event_committed === true,
    matrix_event_id: result?.event_id || null,
    missing_routec_matrix_binding: reason === "missing_routec_matrix_binding",
    matrix_send_event_id_missing: reason === "matrix_send_event_id_missing",
    matrix_send_failure: reason.startsWith("matrix_send_"),
    semantic_writer_exception: reason === "semantic_writer_exception",
    user_visible_success_suppressed: true,
    readiness_claimed: false,
    foundation_pass_claimed: false,
  };
  return err;
}

async function requireRouteCSessionControlSemanticCommit({
  session,
  event,
  stage,
}) {
  const result = await writeRouteCSessionControlSemanticEvent(session, event);
  if (result?.semantic_matrix_event_committed !== true || !result?.event_id) {
    throw createRouteCSessionControlSemanticCommitError({
      session,
      event,
      result,
      stage,
    });
  }
  return result;
}

function isRouteCSessionControlMissingBindingCommitError(err) {
  return (
    err?.routeCControlSemanticCommitError === true &&
    err.routeCControlSemanticCommit?.reason === "missing_routec_matrix_binding"
  );
}

function buildRouteCUnboundStopCleanupMetadata({
  semanticError,
  stage,
  controlRequestId,
}) {
  const proof = semanticError?.routeCControlSemanticCommit || {};
  return {
    status: "routec_control_semantic_unbound_stop_cleanup",
    reason: "missing_routec_matrix_binding",
    stage,
    control_request_id: controlRequestId || proof.control_request_id || null,
    semantic_write_status: proof.semantic_write_status || null,
    semantic_write_error: proof.semantic_write_error || null,
    semantic_matrix_event_committed: false,
    matrix_event_id: null,
    missing_routec_matrix_binding: true,
    matrix_send_failure: false,
    semantic_writer_exception: false,
    transcript_db_fallback_used: false,
    host_db_transcript_product_truth: false,
    matrix_transcript_truth_claimed: false,
    readiness_claimed: false,
    foundation_pass_claimed: false,
  };
}

async function requireRouteCStopRequestSemanticCommitOrUnboundCleanup({
  session,
  event,
  stage,
}) {
  try {
    const commit = await requireRouteCSessionControlSemanticCommit({
      session,
      event,
      stage,
    });
    return { commit, unboundCleanup: null };
  } catch (err) {
    if (
      event?.type === "control.request" &&
      event?.control_kind === "stop" &&
      (stage === "stop_session_action" ||
        stage === "force_stop_session_action") &&
      isRouteCSessionControlMissingBindingCommitError(err)
    ) {
      return {
        commit: null,
        unboundCleanup: buildRouteCUnboundStopCleanupMetadata({
          semanticError: err,
          stage,
          controlRequestId: event.control_request_id,
        }),
      };
    }
    throw err;
  }
}

function routeCSessionControlSemanticErrorResponse(err) {
  if (err?.routeCControlSemanticCommitError === true) {
    return {
      statusCode: err.statusCode || 424,
      body: err.routeCControlSemanticCommit,
    };
  }
  return null;
}

async function writeRouteCTerminalCommandSemanticEvent(session, event) {
  if (!routeCMatrixFacade || typeof routeCMatrixFacade.writeHostTerminalSemanticEvent !== "function") {
    return {
      status: "routec_terminal_semantic_facade_unavailable",
      semantic_matrix_event_committed: false,
      semantic_type: event?.type || null,
      error: "routec_matrix_facade_unavailable",
    };
  }
  try {
    return await routeCMatrixFacade.writeHostTerminalSemanticEvent({
      session,
      event,
    });
  } catch (err) {
    return {
      status: "routec_terminal_semantic_writer_exception",
      semantic_matrix_event_committed: false,
      semantic_type: event?.type || null,
      error: err?.message || String(err),
    };
  }
}

function routeCTerminalCommandSemanticFailureReason(result) {
  if (!result) return "semantic_writer_empty_result";
  if (result.semantic_matrix_event_committed === true && result.event_id) {
    return null;
  }
  const status = String(result.status || "");
  if (status.includes("binding_missing")) {
    return "missing_routec_matrix_binding";
  }
  if (status.includes("room_mismatch")) {
    return "matrix_room_mismatch";
  }
  if (status.includes("facade_unavailable")) {
    return "routec_matrix_facade_unavailable";
  }
  if (status.includes("writer_exception")) {
    return "semantic_writer_exception";
  }
  if (result.semantic_matrix_event_committed === true && !result.event_id) {
    return "matrix_send_event_id_missing";
  }
  if (result.semantic_retry_proof?.terminal_non_pass_reason) {
    return `matrix_send_${result.semantic_retry_proof.terminal_non_pass_reason}`;
  }
  if (status) {
    return status;
  }
  return result.error || result.skipped_reason || "matrix_send_not_committed";
}

function createRouteCTerminalCommandSemanticCommitError({
  session,
  event,
  result,
  stage,
}) {
  const reason = routeCTerminalCommandSemanticFailureReason(result);
  const err = new Error(
    `Route C terminal Matrix semantic commit failed before shell execution: ${reason}`
  );
  err.routeCTerminalSemanticCommitError = true;
  err.statusCode = 424;
  err.routeCTerminalSemanticCommit = {
    error: "routec_terminal_semantic_matrix_commit_required",
    reason,
    stage,
    host_session_id: session?.id || event?.sessionId || event?.session_id || null,
    terminal_exec_id: event?.terminal_exec_id || event?.exec_id || null,
    command: event?.command || null,
    cwd: event?.cwd || null,
    semantic_type: event?.type || null,
    semantic_write_status: result?.status || null,
    semantic_write_error: result?.error || result?.skipped_reason || null,
    semantic_terminal_non_pass_reason:
      result?.semantic_retry_proof?.terminal_non_pass_reason || null,
    semantic_matrix_event_committed:
      result?.semantic_matrix_event_committed === true,
    matrix_event_id: result?.event_id || null,
    missing_routec_matrix_binding: reason === "missing_routec_matrix_binding",
    matrix_room_mismatch: reason === "matrix_room_mismatch",
    matrix_send_event_id_missing: reason === "matrix_send_event_id_missing",
    matrix_send_failure: String(reason || "").startsWith("matrix_send_"),
    semantic_writer_exception: reason === "semantic_writer_exception",
    matrix_commit_failure_unmasked: true,
    shell_execution_started: false,
    transcript_db_fallback_used: false,
    host_db_transcript_product_truth: false,
    normal_message_user_sent: false,
    browser_shell_execution: false,
    provider_delivery_attempted: false,
    user_visible_success_suppressed: true,
    readiness_claimed: false,
    foundation_pass_claimed: false,
  };
  return err;
}

async function requireRouteCTerminalCommandStartedSemanticCommit({
  session,
  event,
  stage,
}) {
  const result = await writeRouteCTerminalCommandSemanticEvent(session, event);
  if (result?.semantic_matrix_event_committed !== true || !result?.event_id) {
    throw createRouteCTerminalCommandSemanticCommitError({
      session,
      event,
      result,
      stage,
    });
  }
  return result;
}

function routeCTerminalCommandSemanticErrorResponse(err) {
  if (err?.routeCTerminalSemanticCommitError === true) {
    return {
      statusCode: err.statusCode || 424,
      body: err.routeCTerminalSemanticCommit,
    };
  }
  return null;
}

function createShellStartEvent(
  agentId,
  sessionId,
  execId,
  command,
  cwd,
  startedAt
) {
  return {
    type: "event",
    event: {
      type: "shell.start",
      agentId,
      sessionId,
      provider: null,
      exec_id: execId,
      terminal_exec_id: execId,
      command,
      cwd,
      started_at: startedAt,
      normal_message_user_sent: false,
      browser_shell_execution: false,
      provider_delivery_attempted: false,
      host_db_transcript_product_truth: false,
    },
  };
}

function getShellStderrSeverity(exitCode, stderr) {
  if (typeof stderr !== "string" || stderr.trim() === "") return null;
  return exitCode === 0 ? "info" : "error";
}

function createShellResultEvent(
  agentId,
  sessionId,
  execId,
  command,
  cwd,
  stdout,
  stderr,
  exitCode,
  durationMs,
  timedOut,
  completedAt
) {
  const stderrSeverity = getShellStderrSeverity(exitCode, stderr);
  return {
    type: "event",
    event: {
      type: "shell.result",
      agentId,
      sessionId,
      provider: null,
      exec_id: execId,
      terminal_exec_id: execId,
      command,
      cwd,
      completed_at: completedAt || null,
      stdout,
      stderr,
      stderr_severity: stderrSeverity,
      exitCode,
      exit_code: exitCode,
      duration: durationMs,
      duration_ms: durationMs,
      timed_out: timedOut === true,
      interrupted: false,
      interrupt_reason: null,
      normal_message_user_sent: false,
      browser_shell_execution: false,
      provider_delivery_attempted: false,
      host_db_transcript_product_truth: false,
    },
  };
}

const activeShellExecsBySession = new Map();

function getActiveShellExecMap(sessionId, create = false) {
  const existing = activeShellExecsBySession.get(sessionId);
  if (existing || !create) return existing || null;
  const next = new Map();
  activeShellExecsBySession.set(sessionId, next);
  return next;
}

function registerShellExec(sessionId, execState) {
  const execs = getActiveShellExecMap(sessionId, true);
  execs.set(execState.execId, execState);
}

function unregisterShellExec(sessionId, execId) {
  const execs = getActiveShellExecMap(sessionId, false);
  if (!execs) return;
  execs.delete(execId);
  if (execs.size === 0) {
    activeShellExecsBySession.delete(sessionId);
  }
}

function interruptActiveShellExecs(sessionId, reason = "interrupt") {
  const execs = getActiveShellExecMap(sessionId, false);
  if (!execs || execs.size === 0) return [];
  const interrupted = [];
  for (const execState of execs.values()) {
    if (execState.interrupt(reason)) {
      interrupted.push(execState.execId);
    }
  }
  return interrupted;
}

function getSessionExecutionCwd(sessionId) {
  const session = sessionManager.getSession(sessionId);
  return session?.cwd || null;
}

function runShellCommand(sessionId, command, cwd, options = {}) {
  const execId = options.execId || randomUUID();
  const session = sessionManager.getSession(sessionId);
  const agentId = session?.agentId || null;
  const startedAt = options.startedAt || new Date().toISOString();
  const startedAtMs = Date.now();
  const startedSemanticCommit = options.startedSemanticCommit || null;
  const matrixTerminalSemanticDurabilityRequired =
    options.matrixTerminalSemanticDurabilityRequired === true;
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let finished = false;
  let proc = null;
  let timeoutHandle = null;
  let forceKillHandle = null;

  const execState = {
    execId,
    interruptReason: null,
    interrupt(reason = "interrupt") {
      if (finished) return false;
      this.interruptReason = reason;
      if (!proc || proc.killed === true) return false;
      try {
        proc.kill("SIGTERM");
      } catch {
        return false;
      }
      if (!forceKillHandle) {
        forceKillHandle = setTimeout(() => {
          if (!finished) {
            try {
              proc.kill("SIGKILL");
            } catch {}
          }
        }, SHELL_EXEC_FORCE_KILL_GRACE_MS);
      }
      return true;
    },
  };

  const finalize = async (code, signal, error = null) => {
    if (finished) return;
    finished = true;
    unregisterShellExec(sessionId, execId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (forceKillHandle) {
      clearTimeout(forceKillHandle);
      forceKillHandle = null;
    }

    const durationMs = Date.now() - startedAtMs;
    let finalStderr = stderr;
    if (error) {
      finalStderr = finalStderr
        ? `${finalStderr}${finalStderr.endsWith("\n") ? "" : "\n"}${
            error.message
          }`
        : error.message;
    }
    if (timedOut) {
      const timeoutMessage = `Command timed out after ${SHELL_EXEC_TIMEOUT_MS}ms and was terminated${
        signal ? ` (${signal})` : ""
      }.`;
      finalStderr = finalStderr
        ? `${finalStderr}${
            finalStderr.endsWith("\n") ? "" : "\n"
          }${timeoutMessage}`
        : timeoutMessage;
    } else if (execState.interruptReason === "interrupt") {
      const interruptMessage = `Command interrupted by /stop(esc)${
        signal ? ` (${signal})` : ""
      }.`;
      finalStderr = finalStderr
        ? `${finalStderr}${
            finalStderr.endsWith("\n") ? "" : "\n"
          }${interruptMessage}`
        : interruptMessage;
    } else if (execState.interruptReason === "stop") {
      const stopMessage = `Command stopped because the session was stopped${
        signal ? ` (${signal})` : ""
      }.`;
      finalStderr = finalStderr
        ? `${finalStderr}${
            finalStderr.endsWith("\n") ? "" : "\n"
          }${stopMessage}`
        : stopMessage;
    } else if (signal) {
      const signalMessage = `Command terminated by signal ${signal}.`;
      finalStderr = finalStderr
        ? `${finalStderr}${
            finalStderr.endsWith("\n") ? "" : "\n"
          }${signalMessage}`
        : signalMessage;
    }
    const interrupted = execState.interruptReason !== null;
    const exitCode = timedOut ? 124 : interrupted ? 130 : code ?? 1;
    const completedAt = new Date().toISOString();
    const resultEvent = createShellResultEvent(
      agentId,
      sessionId,
      execId,
      command,
      cwd,
      stdout,
      finalStderr,
      exitCode,
      durationMs,
      timedOut,
      completedAt
    );
    resultEvent.event.interrupted = interrupted;
    resultEvent.event.interrupt_reason = execState.interruptReason;
    if (matrixTerminalSemanticDurabilityRequired) {
      const resultCommit = await writeRouteCTerminalCommandSemanticEvent(
        session,
        resultEvent.event
      );
      resultEvent.event.routec_terminal_command_result_semantic_commit =
        resultCommit;
      resultEvent.event.terminal_command_result_semantic_matrix_event_committed =
        resultCommit?.semantic_matrix_event_committed === true &&
        Boolean(resultCommit?.event_id);
      resultEvent.event.terminal_command_result_matrix_event_id =
        resultCommit?.event_id || null;
      resultEvent.event.terminal_command_result_matrix_commit_failure_unmasked =
        resultEvent.event
          .terminal_command_result_semantic_matrix_event_committed !== true;
      resultEvent.event.transcript_db_fallback_used = false;
    }
    broadcast(sessionId, resultEvent);
  };

  const startEvent = createShellStartEvent(
    agentId,
    sessionId,
    execId,
    command,
    cwd,
    startedAt
  );
  if (startedSemanticCommit) {
    startEvent.event.routec_terminal_command_started_semantic_commit =
      startedSemanticCommit;
    startEvent.event.terminal_command_started_semantic_matrix_event_committed =
      startedSemanticCommit?.semantic_matrix_event_committed === true &&
      Boolean(startedSemanticCommit?.event_id);
    startEvent.event.terminal_command_started_matrix_event_id =
      startedSemanticCommit?.event_id || null;
    startEvent.event.terminal_command_result_matrix_event_required =
      matrixTerminalSemanticDurabilityRequired;
    startEvent.event.transcript_db_fallback_used = false;
  }
  broadcast(sessionId, startEvent);

  try {
    proc = spawn("bash", ["-lc", command], {
      cwd,
    });
  } catch (err) {
    void finalize(null, null, err);
    return execId;
  }
  registerShellExec(sessionId, execState);

  timeoutHandle = setTimeout(() => {
    if (!finished) {
      timedOut = true;
      execState.interrupt(null);
    }
  }, SHELL_EXEC_TIMEOUT_MS);

  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  proc.on("error", (err) => {
    void finalize(null, null, err);
  });

  proc.on("close", (code, signal) => {
    void finalize(code, signal, null);
  });

  return execId;
}

// ── Cloud Session State Reporter ─────────────────────────────

/**
 * Report session state change to Cloud. Fire-and-forget — never blocks session ops.
 * @param {string} agentId
 * @param {string} sessionId
 * @param {"active"|"closed"|"restarting"} state
 */
function reportSessionState(agentId, sessionId, state) {
  if (CONNECTION_MODE !== "cloud") {
    return;
  }
  if (!BACKEND_URL || !DEVICE_ID || !DEVICE_TOKEN) {
    console.warn(
      `[session-state] Cannot report: missing Host Cloud identity`
    );
    return;
  }

  const url = buildCloudApiUrl(
    BACKEND_URL,
    `/api/device/${DEVICE_ID}/session-state`,
    BACKEND_STAGE
  );
  fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEVICE_TOKEN}`,
    },
    body: JSON.stringify({ agent_id: agentId, session_id: sessionId, state }),
  })
    .then((resp) => {
      if (!resp.ok) {
        resp.text().then((text) => {
          console.error(
            `[session-state] Report failed (${resp.status}): ${text}`
          );
        });
      } else {
        console.log(
          `[session-state] Reported: agent=${agentId} session=${sessionId} state=${state}`
        );
      }
    })
    .catch((err) => {
      console.error(`[session-state] Report error: ${err.message}`);
    });
}

// ── HTTP Helpers ──────────────────────────────────────────────

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function readBody(req) {
  return readRawBody(req).then((buffer) => {
    try {
      return JSON.parse(buffer.toString());
    } catch {
      throw new Error("Invalid JSON body");
    }
  });
}

function readJsonBody(req) {
  return readBody(req);
}

function respond(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function respondDeprecatedSessionUploadsRoute(res) {
  return respond(res, 410, {
    error: DEPRECATED_SESSION_UPLOADS_ROUTE_ERROR,
    code: "session_uploads_deprecated",
  });
}

function respondText(res, status, text, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(text);
}

function respondHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    ...headers,
  });
  res.end(html);
}

function redirect(res, status, location, headers = {}) {
  res.writeHead(status, {
    Location: location,
    ...headers,
  });
  res.end();
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function routeCStableHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeBooleanEnvFlag(value, fieldName) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (["1", "true", "yes", "on"].includes(lower)) return true;
  if (["0", "false", "no", "off"].includes(lower)) return false;
  throw new Error(`${fieldName} must be one of true/false/1/0/yes/no/on/off`);
}

function buildProviderModelRefreshRunnerOptions() {
  const rawEnable =
    process.env[PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE_ENV] || null;
  const explicitEnable = normalizeBooleanEnvFlag(
    rawEnable,
    PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE_ENV
  );
  return {
    backgroundRefreshEnabled: explicitEnable === true,
    backgroundRefreshSource:
      explicitEnable === null
        ? "default_served_host_readiness_no_provider_child"
        : PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE_ENV,
    backgroundRefreshDisabledReason:
      explicitEnable === false
        ? "disabled_by_explicit_env"
        : "served_host_readiness_no_provider_child",
  };
}

function resolveTerminalLaunchCwd(rawCwd) {
  const normalized = normalizeString(rawCwd);
  if (!normalized) {
    return resolveDefaultBrowsePath();
  }
  return resolveDirectoryPath(normalized, "Terminal launch path");
}

function resolveRequestedSessionName(rawValue, agentId, sessionManager) {
  const normalized = normalizeSessionName(rawValue);
  if (normalized) {
    return normalized;
  }
  return buildUniqueDefaultSessionName(
    agentId,
    (candidate) => sessionManager.hasRunningSessionName(candidate),
    () => getSessionNameCounterStore().nextAgentSessionCounter(agentId)
  );
}

function resolveRequestedBranchName(
  rawValue,
  parentSessionId,
  parentSessionName,
  sessionManager
) {
  const normalized = normalizeSessionName(rawValue);
  if (normalized) {
    return normalized;
  }
  return buildUniqueDefaultBranchName(
    parentSessionName,
    (candidate) => sessionManager.hasRunningSessionName(candidate),
    () => getSessionNameCounterStore().nextBranchCounter(parentSessionId)
  );
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeTelegramBooleanInput(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new Error(`telegram.${fieldName} must be boolean`);
  }
  return value;
}

function normalizeTelegramBotTokenInput(value) {
  if (typeof value !== "string") {
    throw new Error("telegram.bot_token must be string");
  }
  return value.trim();
}

function normalizeTelegramAllowedUsersInput(value) {
  const values =
    typeof value === "string"
      ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
      : value;
  if (!Array.isArray(values)) {
    throw new Error("telegram.allowed_users must be a string array");
  }
  const normalized = [];
  for (const [index, entry] of values.entries()) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(
        `telegram.allowed_users[${index}] must be a non-empty string`
      );
    }
    const trimmed = entry.trim();
    if (!normalized.includes(trimmed)) normalized.push(trimmed);
  }
  if (normalized.length === 0) {
    throw new Error("telegram.allowed_users must include at least one user id");
  }
  return normalized;
}

function normalizeTelegramConfigPayload(body = {}) {
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(body, "telegram")) {
    if (!isPlainObject(body.telegram)) {
      throw new Error("telegram must be an object");
    }
    const allowedTelegramKeys = new Set([
      "enabled",
      "send_tool_messages",
      "bot_token",
      "allowed_users",
    ]);
    for (const key of Object.keys(body.telegram)) {
      if (!allowedTelegramKeys.has(key)) {
        throw new Error(`Unsupported telegram key: telegram.${key}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body.telegram, "enabled")) {
      normalized.telegram_enabled = normalizeTelegramBooleanInput(
        body.telegram.enabled,
        "enabled"
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        body.telegram,
        "send_tool_messages"
      )
    ) {
      normalized.telegram_send_tool_messages = normalizeTelegramBooleanInput(
        body.telegram.send_tool_messages,
        "send_tool_messages"
      );
    }
    if (Object.prototype.hasOwnProperty.call(body.telegram, "bot_token")) {
      normalized.telegram_bot_token = normalizeTelegramBotTokenInput(
        body.telegram.bot_token
      );
    }
    if (Object.prototype.hasOwnProperty.call(body.telegram, "allowed_users")) {
      normalized.telegram_allowed_users = normalizeTelegramAllowedUsersInput(
        body.telegram.allowed_users
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegram_enabled")) {
    normalized.telegram_enabled = normalizeTelegramBooleanInput(
      body.telegram_enabled,
      "enabled"
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegramEnabled")) {
    normalized.telegram_enabled = normalizeTelegramBooleanInput(
      body.telegramEnabled,
      "enabled"
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegram_send_tool_messages")) {
    normalized.telegram_send_tool_messages = normalizeTelegramBooleanInput(
      body.telegram_send_tool_messages,
      "send_tool_messages"
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegramSendToolMessages")) {
    normalized.telegram_send_tool_messages = normalizeTelegramBooleanInput(
      body.telegramSendToolMessages,
      "send_tool_messages"
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegram_bot_token")) {
    normalized.telegram_bot_token = normalizeTelegramBotTokenInput(
      body.telegram_bot_token
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegramBotToken")) {
    normalized.telegram_bot_token = normalizeTelegramBotTokenInput(
      body.telegramBotToken
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegram_allowed_users")) {
    normalized.telegram_allowed_users = normalizeTelegramAllowedUsersInput(
      body.telegram_allowed_users
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegramAllowedUsers")) {
    normalized.telegram_allowed_users = normalizeTelegramAllowedUsersInput(
      body.telegramAllowedUsers
    );
  }
  return normalized;
}

function hasTelegramConfigUpdate(body = {}) {
  return (
    Object.prototype.hasOwnProperty.call(body, "telegram_enabled") ||
    Object.prototype.hasOwnProperty.call(body, "telegram_send_tool_messages") ||
    Object.prototype.hasOwnProperty.call(body, "telegram_bot_token") ||
    Object.prototype.hasOwnProperty.call(body, "telegram_allowed_users")
  );
}

function hasLocalTelegramConfigUpdate(body = {}) {
  return (
    Object.prototype.hasOwnProperty.call(body, "telegram_bot_token") ||
    Object.prototype.hasOwnProperty.call(body, "telegram_allowed_users")
  );
}

function buildSessionTelegramRuntimeConfig(config = {}) {
  const allowedUsers = Array.isArray(config.allowedUsers)
    ? [...config.allowedUsers]
    : [];
  return {
    enabled: config.enabled === true,
    sendToolMessages: config.sendToolMessages === true,
    botToken: typeof config.botToken === "string" ? config.botToken : "",
    allowedUsers,
    botTokenConfigured:
      config.botTokenConfigured === true ||
      normalizeString(config.botToken) !== null,
    allowedUsersConfigured:
      config.allowedUsersConfigured === true || allowedUsers.length > 0,
    allowedUsersAllowAll:
      config.allowedUsersAllowAll === true || allowedUsers.includes("."),
    allowedUsersCount: Number.isInteger(config.allowedUsersCount)
      ? config.allowedUsersCount
      : allowedUsers.length,
  };
}

function buildResolvedSessionTelegramConfig(layers = {}) {
  return buildSessionTelegramRuntimeConfig(
    resolveAgentTelegramConfigFromLayers(layers)
  );
}

const P95_TELEGRAM_TEST_MESSAGE_TEXT = "Oysterun Telegram test message.";

function buildEffectiveTelegramRuntimeConfig(
  baseConfig = {},
  normalizedTelegram = {}
) {
  const effective = buildSessionTelegramRuntimeConfig(baseConfig || {});
  if (
    Object.prototype.hasOwnProperty.call(normalizedTelegram, "telegram_enabled")
  ) {
    effective.enabled = normalizedTelegram.telegram_enabled === true;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      normalizedTelegram,
      "telegram_send_tool_messages"
    )
  ) {
    effective.sendToolMessages =
      normalizedTelegram.telegram_send_tool_messages === true;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      normalizedTelegram,
      "telegram_bot_token"
    )
  ) {
    effective.botToken = normalizedTelegram.telegram_bot_token;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      normalizedTelegram,
      "telegram_allowed_users"
    )
  ) {
    effective.allowedUsers = [...normalizedTelegram.telegram_allowed_users];
  }
  effective.botTokenConfigured = normalizeString(effective.botToken) !== null;
  effective.allowedUsersConfigured = effective.allowedUsers.length > 0;
  effective.allowedUsersAllowAll = effective.allowedUsers.includes(".");
  effective.allowedUsersCount = effective.allowedUsers.length;
  return buildSessionTelegramRuntimeConfig(effective);
}

function assertTelegramEnabledSetupReady(config = {}) {
  const effective = buildSessionTelegramRuntimeConfig(config);
  if (effective.enabled !== true) return;
  if (!normalizeString(effective.botToken)) {
    throw new Error("Telegram Bot Token is required when Telegram is enabled.");
  }
  if (!Array.isArray(effective.allowedUsers) || effective.allowedUsers.length === 0) {
    throw new Error("Telegram Allowed Users are required when Telegram is enabled.");
  }
}

function assertTelegramTestSendReady(config = {}) {
  const effective = buildSessionTelegramRuntimeConfig(config);
  if (!normalizeString(effective.botToken)) {
    throw new Error("Telegram Bot Token is required for Test Send.");
  }
  if (!Array.isArray(effective.allowedUsers) || effective.allowedUsers.length === 0) {
    throw new Error("Telegram Allowed Users are required for Test Send.");
  }
}

function resolveTelegramTestSendTarget(config = {}) {
  const effective = buildSessionTelegramRuntimeConfig(config);
  const target = effective.allowedUsers.find(
    (entry) => normalizeString(entry) && normalizeString(entry) !== "."
  );
  if (!target) {
    throw new Error(
      "Telegram Test Send requires an explicit allowed user or chat id."
    );
  }
  return target;
}

function buildTelegramTestSendResponse(base = {}) {
  return {
    contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
    message_text: P95_TELEGRAM_TEST_MESSAGE_TEXT,
    token_redacted: true,
    allowed_users_redacted: true,
    raw_token_returned: false,
    raw_allowed_users_returned: false,
    mock_fallback_used: false,
    provider_session_started: false,
    provider_delivery_attempted: false,
    provider_tool_response_created: false,
    matrix_timeline_mutated: false,
    matrix_send_path_used: false,
    timeline_chat_row_created: false,
    ...base,
  };
}

function applySessionTelegramConfigRequest(session, normalizedTelegram = {}) {
  if (!session || !hasTelegramConfigUpdate(normalizedTelegram)) return;
  const current = buildSessionTelegramRuntimeConfig(session.telegramConfig || {});
  if (
    Object.prototype.hasOwnProperty.call(normalizedTelegram, "telegram_enabled")
  ) {
    current.enabled = normalizedTelegram.telegram_enabled === true;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      normalizedTelegram,
      "telegram_send_tool_messages"
    )
  ) {
    current.sendToolMessages =
      normalizedTelegram.telegram_send_tool_messages === true;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      normalizedTelegram,
      "telegram_bot_token"
    )
  ) {
    current.botToken = normalizedTelegram.telegram_bot_token;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      normalizedTelegram,
      "telegram_allowed_users"
    )
  ) {
    current.allowedUsers = [...normalizedTelegram.telegram_allowed_users];
  }
  current.botTokenConfigured = normalizeString(current.botToken) !== null;
  current.allowedUsersConfigured = current.allowedUsers.length > 0;
  current.allowedUsersAllowAll = current.allowedUsers.includes(".");
  current.allowedUsersCount = current.allowedUsers.length;
  session.telegramConfig = buildSessionTelegramRuntimeConfig(current);
}

const AGENT_RUNTIME_CAPABILITY_NAMES = Object.freeze([
  "mail:create",
  "session:list",
  "session:read_status",
  "session:send",
  "session:create",
  "session:read_transcript",
  "scheduler:run",
  "scheduler:update",
  "website:read",
  "website:update",
  "telegram:read",
  "telegram:update",
]);
const PROHIBITED_RUNTIME_CAPABILITY_NAMES = Object.freeze([
  "host:restart",
  "host:update",
  "host:admin_config",
  "host:runtime_config",
  "credentials:read",
  "credentials:write",
  "provider:auth",
  "provider_skill:install",
  "provider_skill:update",
  "provider_skill:remove",
  "filesystem:unrestricted",
]);

function assertNoProhibitedRuntimeCapabilities() {
  const prohibited = new Set(PROHIBITED_RUNTIME_CAPABILITY_NAMES);
  for (const name of AGENT_RUNTIME_CAPABILITY_NAMES) {
    if (prohibited.has(name)) {
      throw new Error(`Prohibited runtime capability: ${name}`);
    }
  }
}
assertNoProhibitedRuntimeCapabilities();

const AGENT_RUNTIME_CAPABILITY_BACKED_API = Object.freeze({
  "mail:create": true,
  "session:list": true,
  "session:read_status": true,
  "session:send": true,
  "session:create": false,
  "session:read_transcript": true,
  "scheduler:run": false,
  "scheduler:update": false,
  "website:read": true,
  "website:update": true,
  "telegram:read": true,
  "telegram:update": true,
});
const DEFAULT_AGENT_RUNTIME_CAPABILITIES = Object.freeze(
  Object.fromEntries(AGENT_RUNTIME_CAPABILITY_NAMES.map((name) => [name, true]))
);

function cloneRuntimeCapabilityState(state = DEFAULT_AGENT_RUNTIME_CAPABILITIES) {
  return Object.fromEntries(
    AGENT_RUNTIME_CAPABILITY_NAMES.map((name) => [name, state[name] === true])
  );
}

function normalizeRuntimeCapabilityState(value, { baseState = null } = {}) {
  const normalized = cloneRuntimeCapabilityState(
    baseState || DEFAULT_AGENT_RUNTIME_CAPABILITIES
  );
  if (value === undefined || value === null) return normalized;

  if (Array.isArray(value)) {
    for (const name of AGENT_RUNTIME_CAPABILITY_NAMES) {
      normalized[name] = false;
    }
    for (const entry of value) {
      const capability = normalizeString(entry);
      if (!capability || !AGENT_RUNTIME_CAPABILITY_NAMES.includes(capability)) {
        throw new Error(`Unsupported runtime capability: ${String(entry)}`);
      }
      normalized[capability] = true;
    }
    return normalized;
  }

  if (typeof value !== "object") {
    throw new Error("runtime_capabilities must be an object or array");
  }

  for (const [key, enabled] of Object.entries(value)) {
    const capability = normalizeString(key);
    if (!capability || !AGENT_RUNTIME_CAPABILITY_NAMES.includes(capability)) {
      throw new Error(`Unsupported runtime capability: ${String(key)}`);
    }
    if (typeof enabled !== "boolean") {
      throw new Error(`runtime_capabilities.${capability} must be boolean`);
    }
    normalized[capability] = enabled;
  }
  return normalized;
}

function resolveConfiguredRuntimeCapabilities(config = {}) {
  const rawCapabilities =
    config?.runtime_capabilities ??
    config?.runtimeCapabilities ??
    config?.interface?.runtime_capabilities ??
    config?.interface?.runtimeCapabilities;
  return normalizeRuntimeCapabilityState(rawCapabilities);
}

function resolveRuntimeCapabilitiesForSessionStart(config = {}, body = {}) {
  const hasRuntimeCapabilityBody =
    Object.prototype.hasOwnProperty.call(body, "runtime_capabilities") ||
    Object.prototype.hasOwnProperty.call(body, "runtimeCapabilities");
  if (!hasRuntimeCapabilityBody) {
    return cloneRuntimeCapabilityState(DEFAULT_AGENT_RUNTIME_CAPABILITIES);
  }
  const configured = resolveConfiguredRuntimeCapabilities(config);
  if (Object.prototype.hasOwnProperty.call(body, "runtime_capabilities")) {
    return normalizeRuntimeCapabilityState(body.runtime_capabilities, {
      baseState: configured,
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "runtimeCapabilities")) {
    return normalizeRuntimeCapabilityState(body.runtimeCapabilities, {
      baseState: configured,
    });
  }
}

function listEnabledRuntimeCapabilities(capabilities = {}) {
  return AGENT_RUNTIME_CAPABILITY_NAMES.filter(
    (name) => capabilities[name] === true
  );
}

function serializeRuntimeCapabilities(capabilities = {}, grantMetadata = null) {
  const state = normalizeRuntimeCapabilityState(capabilities);
  return {
    capabilities: state,
    scopes: AGENT_RUNTIME_CAPABILITY_NAMES.map((name) => ({
      name,
      enabled: state[name] === true,
      backed_api: AGENT_RUNTIME_CAPABILITY_BACKED_API[name] === true,
    })),
    enabled_scopes: listEnabledRuntimeCapabilities(state),
    default_on_for_new_sessions: true,
    config_key: "runtime_capabilities",
    host_owned_grants: true,
    raw_token_returned: false,
    raw_token_persisted: false,
    grant: grantMetadata || null,
  };
}

function buildLiveSessionRuntimeCapabilityGrant({
  sessionId,
  agentId,
  capabilities,
}) {
  const state = normalizeRuntimeCapabilityState(capabilities);
  const enabledScopes = listEnabledRuntimeCapabilities(state);
  const backedEnabledScopes = enabledScopes.filter(
    (name) => AGENT_RUNTIME_CAPABILITY_BACKED_API[name] === true
  );
  if (backedEnabledScopes.length === 0) {
    return {
      env: {},
      redactionValues: [],
      metadata: {
        grant_kind: "live_session",
        scopes: enabledScopes,
        session_id: sessionId,
        agent_id: agentId,
        env_vars: [],
        mail_create_enabled: false,
        raw_token_returned: false,
        raw_token_persisted: false,
        env_token_redacted: true,
      },
    };
  }

  const hostOrigin = normalizeString(getSchedulerMailHostOrigin());
  if (!hostOrigin) {
    throw new Error("OYSTERUN_HOST_ORIGIN is required for live sessions");
  }
  const { token, grant } = mailStore.createCapabilityGrant({
    grantKind: "live_session",
    actorType: "session",
    actorId: sessionId,
    recipientUserId: DEFAULT_HOST_APP_USER_ID,
    agentId,
    scopes: enabledScopes,
    constraints: {
      session_id: sessionId,
      grant_source: "live_session_runtime_capabilities",
    },
  });
  return {
    env: {
      OYSTERUN_HOST_ORIGIN: hostOrigin,
      OYSTERUN_CAPABILITY_TOKEN: token,
      OYSTERUN_MAIL_WRITE_TOKEN: token,
      OYSTERUN_SESSION_ID: sessionId,
      OYSTERUN_AGENT_ID: agentId,
    },
    redactionValues: [token],
    metadata: {
      grant_kind: grant.grant_kind,
      token_hash: grant.token_hash,
      scopes: grant.scopes,
      recipient_user_id: grant.recipient_user_id,
      session_id: sessionId,
      agent_id: grant.agent_id,
      expires_at: grant.expires_at,
      env_vars: [
        "OYSTERUN_HOST_ORIGIN",
        "OYSTERUN_CAPABILITY_TOKEN",
        "OYSTERUN_MAIL_WRITE_TOKEN",
        "OYSTERUN_SESSION_ID",
        "OYSTERUN_AGENT_ID",
      ],
      mail_create_enabled: state[MAIL_CREATE_SCOPE] === true,
      raw_token_returned: false,
      raw_token_persisted: false,
      env_token_redacted: true,
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildQrSvgDataUri(value) {
  const qrcode = new QRCode(-1, QRErrorCorrectLevel.L);
  qrcode.addData(value);
  qrcode.make();
  const moduleCount = qrcode.getModuleCount();
  const quietZone = 4;
  const size = moduleCount + quietZone * 2;
  const cells = [];
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qrcode.isDark(row, col)) continue;
      cells.push(
        `<rect x="${col + quietZone}" y="${row + quietZone}" width="1" height="1"/>`
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${cells.join("")}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function getActiveStackName() {
  return (
    normalizeString(process.env.OYSTERUN_ROUTEC_STACK_NAME) ||
    normalizeString(process.env.OYSTERUN_STACK_NAME) ||
    normalizeString(process.env.OYSTERUN_STACK) ||
    null
  );
}

const OYSTERUN_NPM_PACKAGE_NAME = "oysterun";
const OYSTERUN_UPDATE_DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const OYSTERUN_UPDATE_RELEASE_CHANNEL = "latest";
const OYSTERUN_UPDATE_AUTOMATIC_COOLDOWN_MS = 30 * 60 * 1000;
let lastOysterunUpdateStatus = null;

function readOysterunPackageVersion() {
  for (const packagePath of [
    join(REPO_ROOT, "package.json"),
    join(REPO_ROOT, "host-service", "package.json"),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, "utf-8"));
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Best-effort diagnostics must not break Host Preferences.
    }
  }
  return "unknown";
}

function normalizeOysterunUpdateChannel() {
  return OYSTERUN_UPDATE_RELEASE_CHANNEL;
}

function normalizeOysterunUpdateSource(value, fallback = "manual") {
  const normalized = normalizeString(value || fallback);
  if (normalized === "automatic") return "automatic";
  if (normalized === "manual") return "manual";
  if (normalized === "update_run") return "update_run";
  if (normalized === "status") return "status";
  return fallback;
}

function compareVersionStrings(a, b) {
  const normalize = (value) =>
    String(value || "")
      .replace(/^v/, "")
      .split(/[-+.]/)
      .map((part) => {
        const number = Number.parseInt(part, 10);
        return Number.isNaN(number) ? part : number;
      });
  const left = normalize(a);
  const right = normalize(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (typeof l === "number" && typeof r === "number" && l !== r) {
      return l > r ? 1 : -1;
    }
    const ls = String(l);
    const rs = String(r);
    if (ls !== rs) return ls > rs ? 1 : -1;
  }
  return 0;
}

function resolveOysterunUpdateRegistry() {
  const override = normalizeString(process.env.OYSTERUN_UPDATE_REGISTRY_URL);
  const registryUrl = override || OYSTERUN_UPDATE_DEFAULT_REGISTRY_URL;
  let parsed;
  try {
    parsed = new URL(registryUrl);
  } catch {
    throw new Error("OYSTERUN_UPDATE_REGISTRY_URL must be an absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OYSTERUN_UPDATE_REGISTRY_URL must use http or https.");
  }
  return {
    url: parsed.toString().replace(/\/$/, ""),
    source: override ? "override" : "npm",
    override_active: Boolean(override),
  };
}

function isRouteCUpdateVerificationStackName(stackName) {
  return /^test[0-9]+$/.test(stackName) || /^test_w[0-9]+$/.test(stackName);
}

function isOysterunUpdateSupported({ registry = null } = {}) {
  const stackName = getActiveStackName();
  if (stackName === "production") return true;
  if (!isRouteCUpdateVerificationStackName(stackName)) return false;
  if (registry) return registry.override_active === true;
  try {
    return resolveOysterunUpdateRegistry().override_active === true;
  } catch {
    return false;
  }
}

function assertOysterunPackageUpdateSupported({ registry = null } = {}) {
  if (isOysterunUpdateSupported({ registry })) return;
  throw new Error(
    "Oysterun package update is only available on the production npm Host stack or a Route C verification stack with OYSTERUN_UPDATE_REGISTRY_URL."
  );
}

function buildOysterunPackageMetadataUrl(registryUrl) {
  const base = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;
  return new URL(encodeURIComponent(OYSTERUN_NPM_PACKAGE_NAME), base).toString();
}

function buildUpdateLogPath(kind) {
  const logDir = join(getConfigDir(), "operation_logs");
  mkdirSync(logDir, { recursive: true });
  const safeKind = String(kind || "update").replace(/[^a-z0-9_-]/gi, "-");
  return join(
    logDir,
    `oysterun-${safeKind}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
}

function redactUpdateLogValue(value) {
  return String(value || "")
    .replace(/(\/\/[^:\s/]+:)[^@\s/]+@/g, "$1[redacted]@")
    .replace(/(token|password|authorization|cookie|_authToken)=\S+/gi, "$1=[redacted]");
}

function writeOysterunUpdateOperationLog(kind, entries = {}) {
  const logPath = buildUpdateLogPath(kind);
  const lines = [
    `[oysterun-update] ${kind}`,
    `written_at=${new Date().toISOString()}`,
  ];
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}=${redactUpdateLogValue(value)}`);
  }
  lines.push("redacted=true", "");
  writeFileSync(logPath, lines.join("\n"), "utf8");
  return {
    written: true,
    path_returned: false,
    redacted: true,
  };
}

function getCachedNewestVersion(source = "status") {
  const reminder = readUpdateReminderState({ configDir: getConfigDir() });
  if (lastOysterunUpdateStatus?.newest_version) {
    return lastOysterunUpdateStatus.newest_version;
  }
  if (source === "automatic") return reminder.last_automatic_newest_version;
  return reminder.last_manual_newest_version || reminder.last_automatic_newest_version;
}

function reconcileOysterunUpdateOperation(currentVersion) {
  const operation = readUpdateOperationState({ configDir: getConfigDir() });
  if (!operation.operation_id) return null;
  const targetVersion = normalizeString(operation.target_version);
  const restartRestore = readHostRestartRestoreState({ configDir: getConfigDir() });
  const restartRestoreConsumed =
    operation.running === true &&
    operation.status === "restart_scheduled" &&
    normalizeString(operation.restart_id) &&
    restartRestore?.state === "consumed" &&
    restartRestore?.restart_id === operation.restart_id &&
    restartRestore?.trigger === "host_preferences_update_restart";
  if (
    operation.running === true &&
    targetVersion &&
    compareVersionStrings(currentVersion, targetVersion) >= 0
  ) {
    return writeUpdateOperationState(
      {
        ...operation,
        status: "update_complete",
        phase: "Updated",
        running: false,
        final_observed_version: currentVersion,
        error: null,
        error_redacted: true,
      },
      { configDir: getConfigDir() }
    );
  }
  if (restartRestoreConsumed && targetVersion) {
    return writeUpdateOperationState(
      {
        ...operation,
        status: "version_mismatch",
        phase: "Restart complete, version mismatch",
        running: false,
        final_observed_version: currentVersion,
        error: "Host restart completed but observed package version does not match requested update target.",
        error_redacted: true,
      },
      { configDir: getConfigDir() }
    );
  }
  if (
    operation.status === "update_complete" &&
    targetVersion &&
    compareVersionStrings(currentVersion, targetVersion) < 0
  ) {
    return writeUpdateOperationState(
      {
        ...operation,
        status: "version_mismatch",
        phase: "Restart complete, version mismatch",
        running: false,
        final_observed_version: currentVersion,
        error: "Observed package version does not match requested update target.",
        error_redacted: true,
      },
      { configDir: getConfigDir() }
    );
  }
  return operation;
}

function serializeOysterunUpdateOperation(operation) {
  if (!operation?.operation_id) return null;
  return {
    operation_id: operation.operation_id,
    status: operation.status,
    phase: operation.phase,
    running: operation.running === true,
    requested_at: operation.requested_at,
    updated_at: operation.updated_at,
    source: operation.source,
    target_version: operation.target_version,
    newest_version: operation.newest_version,
    registry_source: operation.registry_source,
    npm_command_redacted: operation.npm_command_redacted,
    restart_id: operation.restart_id,
    final_observed_version: operation.final_observed_version,
    error: operation.error,
    error_redacted: operation.error_redacted === true,
    log_path_returned: false,
  };
}

function buildOysterunUpdateStatusPayload(extra = {}) {
  const currentVersion = readOysterunPackageVersion();
  const channel = normalizeOysterunUpdateChannel(extra.channel, currentVersion);
  const source = normalizeOysterunUpdateSource(extra.source, "status");
  const reminder = readUpdateReminderState({ configDir: getConfigDir() });
  const newestVersion =
    normalizeString(extra.newest_version || extra.latest_version) ||
    getCachedNewestVersion(source);
  const operation = reconcileOysterunUpdateOperation(currentVersion);
  const updateAvailable = newestVersion
    ? compareVersionStrings(newestVersion, currentVersion) > 0
    : false;
  const payload = {
    status: extra.status || "update_status",
    package_name: OYSTERUN_NPM_PACKAGE_NAME,
    current_version: currentVersion,
    channel,
    newest_version: newestVersion || null,
    latest_version: newestVersion || null,
    update_available: updateAvailable,
    update_supported: isOysterunUpdateSupported(),
    active_stack: getActiveStackName(),
    noticed_version:
      normalizeString(extra.noticed_version) || reminder.noticed_version || null,
    should_notify: extra.should_notify === true,
    source,
    checked_at: extra.checked_at || null,
    error: extra.error || null,
    automatic_cooldown_seconds: Math.floor(
      OYSTERUN_UPDATE_AUTOMATIC_COOLDOWN_MS / 1000
    ),
    registry_source: extra.registry_source || null,
    registry_override_active: extra.registry_override_active === true,
    operation_log:
      extra.operation_log && typeof extra.operation_log === "object"
        ? {
            written: extra.operation_log.written === true,
            path_returned: false,
            redacted: true,
          }
        : null,
    log_path: null,
    log_path_returned: false,
    resolved_version:
      normalizeString(extra.resolved_version || newestVersion) || null,
    update_operation: serializeOysterunUpdateOperation(operation),
    restart_restore:
      extra.restart_restore && typeof extra.restart_restore === "object"
        ? extra.restart_restore
        : null,
  };
  if (payload.status !== "update_status") {
    lastOysterunUpdateStatus = { ...payload };
  }
  return payload;
}

async function checkOysterunNpmUpdate({ source = "manual" } = {}) {
  const resolvedChannel = normalizeOysterunUpdateChannel();
  const resolvedSource = normalizeOysterunUpdateSource(source, "manual");
  const checkedAt = new Date().toISOString();
  const reminder = readUpdateReminderState({ configDir: getConfigDir() });
  if (resolvedSource === "automatic" && !isOysterunUpdateSupported()) {
    return buildOysterunUpdateStatusPayload({
      status: "update_check_skipped_unsupported_stack",
      channel: resolvedChannel,
      source: resolvedSource,
      checked_at: checkedAt,
      should_notify: false,
    });
  }
  if (resolvedSource === "automatic" && reminder.last_automatic_check_at) {
    const lastAutomatic = Date.parse(reminder.last_automatic_check_at);
    if (
      Number.isFinite(lastAutomatic) &&
      Date.now() - lastAutomatic < OYSTERUN_UPDATE_AUTOMATIC_COOLDOWN_MS
    ) {
      return buildOysterunUpdateStatusPayload({
        status: "update_check_cooldown",
        channel: resolvedChannel,
        source: resolvedSource,
        newest_version: reminder.last_automatic_newest_version,
        checked_at: reminder.last_automatic_check_at,
        should_notify: false,
      });
    }
  }
  const registry = resolveOysterunUpdateRegistry();
  let metadata;
  try {
    const resp = await fetch(buildOysterunPackageMetadataUrl(registry.url), {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`npm registry returned HTTP ${resp.status}`);
    }
    metadata = await resp.json();
  } catch (err) {
    if (resolvedSource === "automatic") {
      updateReminderState(
        (state) => ({
          ...state,
          last_automatic_check_at: checkedAt,
          last_automatic_failure_at: checkedAt,
          last_automatic_failure_hidden: true,
        }),
        { configDir: getConfigDir() }
      );
      return buildOysterunUpdateStatusPayload({
        status: "update_check_automatic_failed_hidden",
        channel: resolvedChannel,
        source: resolvedSource,
        checked_at: checkedAt,
        should_notify: false,
      });
    }
    const operationLog = writeOysterunUpdateOperationLog("manual-check-failed", {
      requested_at: checkedAt,
      source: resolvedSource,
      channel: resolvedChannel,
      current_version: readOysterunPackageVersion(),
      error: err.message,
    });
    const error = new Error(err.message);
    error.updatePayload = buildOysterunUpdateStatusPayload({
      status: "update_check_failed",
      channel: resolvedChannel,
      source: resolvedSource,
      checked_at: checkedAt,
      error: "Could not check for updates.",
      operation_log: operationLog,
      registry_source: registry.source,
      registry_override_active: registry.override_active,
    });
    throw error;
  }
  const newestVersion = normalizeString(metadata?.["dist-tags"]?.[resolvedChannel]);
  if (!newestVersion) {
    const distTagError = new Error(`npm dist-tag not found: ${resolvedChannel}`);
    if (resolvedSource === "automatic") {
      updateReminderState(
        (state) => ({
          ...state,
          last_automatic_check_at: checkedAt,
          last_automatic_failure_at: checkedAt,
          last_automatic_failure_hidden: true,
        }),
        { configDir: getConfigDir() }
      );
      return buildOysterunUpdateStatusPayload({
        status: "update_check_automatic_failed_hidden",
        channel: resolvedChannel,
        source: resolvedSource,
        checked_at: checkedAt,
        should_notify: false,
      });
    }
    throw distTagError;
  }
  const currentVersion = readOysterunPackageVersion();
  const updateAvailable = compareVersionStrings(newestVersion, currentVersion) > 0;
  let shouldNotify = false;
  let noticedVersion = reminder.noticed_version;
  if (updateAvailable) {
    if (resolvedSource === "automatic") {
      shouldNotify = newestVersion !== reminder.noticed_version;
      if (shouldNotify) {
        const next = markUpdateVersionNoticed({
          version: newestVersion,
          source: resolvedSource,
          noticedAt: checkedAt,
          configDir: getConfigDir(),
        });
        noticedVersion = next.noticed_version;
      }
    } else if (resolvedSource === "manual") {
      const next = markUpdateVersionNoticed({
        version: newestVersion,
        source: resolvedSource,
        noticedAt: checkedAt,
        configDir: getConfigDir(),
      });
      noticedVersion = next.noticed_version;
    }
  }
  updateReminderState(
    (state) => ({
      ...state,
      ...(resolvedSource === "automatic"
        ? {
            last_automatic_check_at: checkedAt,
            last_automatic_newest_version: newestVersion,
            last_automatic_update_available: updateAvailable,
            last_automatic_failure_at: null,
            last_automatic_failure_hidden: false,
          }
        : {
            last_manual_check_at: checkedAt,
            last_manual_newest_version: newestVersion,
            last_manual_update_available: updateAvailable,
          }),
    }),
    { configDir: getConfigDir() }
  );
  const operationLog =
    resolvedSource === "manual"
      ? writeOysterunUpdateOperationLog("manual-check", {
          requested_at: checkedAt,
          source: resolvedSource,
          current_version: currentVersion,
          newest_version: newestVersion,
          update_available: updateAvailable,
          registry_source: registry.source,
        })
      : null;
  return buildOysterunUpdateStatusPayload({
    status: "update_check",
    channel: resolvedChannel,
    source: resolvedSource,
    newest_version: newestVersion,
    noticed_version: noticedVersion,
    should_notify: shouldNotify,
    checked_at: checkedAt,
    operation_log: operationLog,
    registry_source: registry.source,
    registry_override_active: registry.override_active,
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeLaunchctlLabelComponent(value, fallback = "unknown") {
  const normalized = normalizeString(value)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function buildOysterunUpdateRestartJobLabel({ stackName, operationId }) {
  return [
    "com.oysterun.update-restart",
    normalizeLaunchctlLabelComponent(stackName, "stack"),
    normalizeLaunchctlLabelComponent(operationId, "operation"),
  ].join(".");
}

function buildUpdateOperationStateShellCommand(statePatch) {
  const statePath = getUpdateOperationStatePath(getConfigDir());
  const payload = {
    ...statePatch,
    updated_at: "__NOW__",
    error_redacted: true,
  };
  const script = [
    "const fs = require('fs');",
    "const path = require('path');",
    `const statePath = ${JSON.stringify(statePath)};`,
    `const payload = ${JSON.stringify(payload)};`,
    "payload.updated_at = new Date().toISOString();",
    "fs.mkdirSync(path.dirname(statePath), { recursive: true });",
    "fs.writeFileSync(statePath, JSON.stringify(payload, null, 2) + '\\n', 'utf8');",
  ].join(" ");
  return `node -e ${shellQuote(script)}`;
}

function buildActiveShellExecRestartSnapshot() {
  const execs = [];
  for (const [sessionId, sessionExecs] of activeShellExecsBySession.entries()) {
    for (const execState of sessionExecs.values()) {
      execs.push({
        session_id: sessionId,
        exec_id: execState.execId,
        interrupt_policy: "mark_interrupted_no_command_replay",
        command_replay: false,
      });
    }
  }
  return execs;
}

function buildActiveShellExecRuntimeStatus() {
  const commands = [];
  for (const [sessionId, sessionExecs] of activeShellExecsBySession.entries()) {
    for (const execState of sessionExecs.values()) {
      commands.push({
        session_id: sessionId,
        exec_id: execState.execId,
        status: "running",
        command_redacted: true,
        command_replay: false,
      });
    }
  }
  return {
    count: commands.length,
    commands,
    redacted: true,
    command_replay_policy: "never_replay_shell_commands",
  };
}

function markHostRestartInterruptedShellExecs(
  shellExecs = [],
  { restartId = null, interruptedAt = null } = {}
) {
  const timestamp = interruptedAt || new Date().toISOString();
  const interrupted = [];
  for (const entry of Array.isArray(shellExecs) ? shellExecs : []) {
    const sessionId = normalizeString(entry?.session_id);
    const execId = normalizeString(entry?.exec_id);
    if (!sessionId || !execId) {
      interrupted.push({
        session_id: sessionId,
        exec_id: execId,
        status: "skipped",
        reason: "missing_session_or_exec_id",
        command_replay: false,
        terminal_output_replay: false,
      });
      continue;
    }
    interrupted.push({
      session_id: sessionId,
      exec_id: execId,
      status: "interrupted",
      interrupted_by: "host_restart_restore",
      restart_id: restartId,
      interrupted_at: timestamp,
      command_redacted: true,
      command_replay: false,
      terminal_output_replay: false,
      matrix_transcript_mutation: false,
    });
  }
  return {
    interrupted,
    interrupted_at: timestamp,
    command_replay: false,
    terminal_output_replay: false,
  };
}

function buildProviderReplyRuntimeStatus() {
  const replies = [];
  let queuedCount = 0;
  for (const session of sessionManager.list()) {
    const delivery = sessionManager.getDeliverySummary(session.sessionId);
    queuedCount += delivery.queued_count || 0;
    if (!delivery.active_message_id) continue;
    replies.push({
      session_id: session.sessionId,
      agent_id: session.agentId || null,
      provider: session.provider || null,
      active_message_id: delivery.active_message_id,
      active_message_state: delivery.active_message_state,
      provider_reply_in_progress:
        delivery.active_message_state === "running",
      prompt_redacted: true,
      prompt_replay: false,
    });
  }
  return {
    in_progress_count: replies.filter(
      (reply) => reply.provider_reply_in_progress
    ).length,
    active_message_count: replies.length,
    queued_count: queuedCount,
    replies,
    redacted: true,
    prompt_replay_policy: HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY,
  };
}

function buildActiveLoopRuntimeStatus() {
  const snapshot = schedulerService.snapshotSessionLoopRestartState();
  const loops = [];
  for (const runtime of Array.isArray(snapshot.runtime_sessions)
    ? snapshot.runtime_sessions
    : []) {
    for (const loop of Array.isArray(runtime.loops) ? runtime.loops : []) {
      loops.push({
        host_session_id: runtime.host_session_id || null,
        agent_id: runtime.agent_id || null,
        loop_id: loop.loop_id || null,
        enabled: loop.enabled === true,
        status: loop.status || null,
        next_run_at: loop.next_run_at || null,
        last_status: loop.last_status || null,
        runtime_state_owner: loop.runtime_state_owner || null,
      });
    }
  }
  return {
    count: loops.length,
    loops,
    writes_runtime_state_to_loops_json:
      snapshot.writes_runtime_state_to_loops_json === true,
    redacted: true,
  };
}

function buildActiveSchedulerRuntimeStatus() {
  const snapshot = schedulerService.snapshotHostRestartState();
  const activeRuns = Array.isArray(snapshot.active_runs)
    ? snapshot.active_runs
    : [];
  return {
    count: activeRuns.length,
    active_runs: activeRuns,
    parallel_scheduler_store: snapshot.parallel_scheduler_store === true,
    redacted: true,
  };
}

function buildActiveTerminalRuntimeStatus() {
  const snapshot = terminalSessionManager.snapshotHostRestartState();
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  return {
    count: sessions.length,
    sessions: sessions.map((session) => ({
      terminal_id: session.terminal_id || null,
      owner_id: session.owner_id || null,
      cwd: session.cwd || null,
      state: session.state || null,
      started_at: session.started_at || null,
      updated_at: session.updated_at || null,
      command_replay: false,
      pane_text_redacted: true,
      extracted_links_redacted: true,
    })),
    replay_policy:
      snapshot.replay_policy || "never_replay_terminal_commands",
    redacted: true,
  };
}

function buildHostActiveRuntimeStatusSummary() {
  return {
    provider_replies: buildProviderReplyRuntimeStatus(),
    shell_execs: buildActiveShellExecRuntimeStatus(),
    terminal_sessions: buildActiveTerminalRuntimeStatus(),
    scheduler_runs: buildActiveSchedulerRuntimeStatus(),
    in_session_loops: buildActiveLoopRuntimeStatus(),
    secret_fields_redacted: true,
    prompt_replay_policy: HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY,
    terminal_command_replay: false,
  };
}

function buildHostRestartRuntimeSnapshot({ trigger }) {
  return {
    trigger,
    captured_at: new Date().toISOString(),
    sessions: sessionManager.snapshotHostRestartState(),
    loops: schedulerService.snapshotSessionLoopRestartState(),
    scheduler: schedulerService.snapshotHostRestartState(),
    terminal: terminalSessionManager.snapshotHostRestartState(),
    shell_execs: buildActiveShellExecRestartSnapshot(),
    prompt_replay_policy: HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY,
    matrix_transcript_mutation: false,
  };
}

function buildHostRestartOperationLogPath() {
  const logDir = join(getConfigDir(), "operation_logs");
  mkdirSync(logDir, { recursive: true });
  return join(
    logDir,
    `host-restart-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
}

function assertHostRestartSchedulingAvailable() {
  const stackName = getActiveStackName();
  if (!stackName) {
    throw new Error(
      "Host restart is unavailable because the active stack name is not known."
    );
  }
  const restartScript = join(REPO_ROOT, "tool_scripts", "restart_oysterun.sh");
  if (!existsSync(restartScript)) {
    throw new Error(`Host restart script is missing: ${restartScript}`);
  }
  return { stackName, restartScript };
}

function writeHostRestartOperationLog({ trigger, transaction }) {
  const logPath = transaction.operation_log?.path;
  if (!logPath) return null;
  writeFileSync(
    logPath,
    [
      `[host-restart-restore] prepared ${transaction.restart_id}`,
      `trigger=${trigger}`,
      `stack=${transaction.stack_name}`,
      `created_at=${transaction.created_at}`,
      `prompt_replay_policy=${transaction.prompt_replay_policy}`,
      "",
    ].join("\n"),
    "utf8"
  );
  return logPath;
}

function appendHostRestartRestoreOperationLog({ transaction, restoreResult }) {
  const logPath = transaction?.operation_log?.path;
  if (!logPath) return null;
  const summary = buildHostRestartRestoreSummary(transaction);
  appendFileSync(
    logPath,
    [
      `[host-restart-restore] consumed ${transaction.restart_id}`,
      `consumed_at=${transaction.consumed_at || new Date().toISOString()}`,
      `status=${transaction.state || "unknown"}`,
      `restore_summary=${JSON.stringify(summary.counts || {})}`,
      `restore_result=${JSON.stringify(restoreResult || {})}`,
      "",
    ].join("\n"),
    "utf8"
  );
  return logPath;
}

function prepareHostRestartRestore({ trigger }) {
  const stackName = getActiveStackName();
  if (!stackName) {
    throw new Error(
      "Host restart restore prepare is unavailable because the active stack name is not known."
    );
  }
  const runtimeSnapshot = buildHostRestartRuntimeSnapshot({ trigger });
  const operationLogPath = buildHostRestartOperationLogPath();
  const transaction = prepareHostRestartRestoreState({
    configDir: getConfigDir(),
    stackName,
    trigger,
    runtimeSnapshot,
    operationLogPath,
  });
  writeHostRestartOperationLog({ trigger, transaction });
  return {
    status: "restart_restore_prepared",
    restart_restore: buildHostRestartRestoreSummary(transaction),
  };
}

function buildHostRuntimeMetadataStatus() {
  return readHostRuntimeMetadataStatus(getConfigDir());
}

function buildHostRuntimeStatusPayload() {
  const transaction = readHostRestartRestoreState({ configDir: getConfigDir() });
  return {
    status: "runtime_status",
    active_stack: getActiveStackName(),
    sessions: sessionManager.list().length,
    restart_restore: buildHostRestartRestoreSummary(transaction),
    last_restart_restore: lastHostRestartRestoreStatus,
    active_runtime: buildHostActiveRuntimeStatusSummary(),
    provider_model_refresh: providerModelRefreshRunner.getStatus(),
    host_runtime_metadata: buildHostRuntimeMetadataStatus(),
    prompt_replay_policy: HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY,
    restart_restore_state_path: getHostRestartRestoreStatePath(getConfigDir()),
    secret_fields_redacted: true,
  };
}

async function scheduleOysterunPackageUpdate() {
  const stackName = getActiveStackName();
  const resolvedChannel = normalizeOysterunUpdateChannel();
  const registry = resolveOysterunUpdateRegistry();
  assertOysterunPackageUpdateSupported({ registry });
  const updateCheck = await checkOysterunNpmUpdate({
    source: "update_run",
  });
  const exactVersion = normalizeString(updateCheck.newest_version);
  if (!exactVersion) {
    throw new Error(`Could not resolve exact Oysterun package version for ${resolvedChannel}`);
  }
  const currentVersion = readOysterunPackageVersion();
  const restartRestore = prepareHostRestartRestore({
    trigger: "host_preferences_update_restart",
  });
  const logDir = join(getConfigDir(), "operation_logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(
    logDir,
    `oysterun-update-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
  const packageSpec = `${OYSTERUN_NPM_PACKAGE_NAME}@${exactVersion}`;
  const registryArg = registry.override_active
    ? ` --registry ${shellQuote(registry.url)}`
    : "";
  const redactedInstallCommand = `npm install -g ${packageSpec} --prefer-online${
    registry.override_active ? " --registry [redacted-update-registry]" : ""
  }`;
  const operationState = writeUpdateOperationState(
    {
      status: "update_restart_scheduled",
      phase: "Installing...",
      running: true,
      source: "manual",
      current_version: currentVersion,
      target_version: exactVersion,
      newest_version: exactVersion,
      registry_source: registry.source,
      npm_command_redacted: redactedInstallCommand,
      restart_id: normalizeString(restartRestore.restart_restore?.restart_id),
      error_redacted: true,
    },
    { configDir: getConfigDir() }
  );
  const operationLog = writeOysterunUpdateOperationLog("update-restart", {
    requested_at: operationState.requested_at,
    source: "manual",
    current_version: currentVersion,
    newest_version: exactVersion,
    resolved_target_version: exactVersion,
    npm_command: redactedInstallCommand,
    restart_id: operationState.restart_id,
    registry_source: registry.source,
  });
  const installFailedStateCommand = buildUpdateOperationStateShellCommand({
    ...operationState,
    status: "install_failed",
    phase: "Install failed",
    running: false,
    error: "npm install failed before restart.",
  });
  const restartPhaseStateCommand = buildUpdateOperationStateShellCommand({
    ...operationState,
    status: "restart_scheduled",
    phase: "Restarting...",
    running: true,
    error: null,
  });
  const restartFailedStateCommand = buildUpdateOperationStateShellCommand({
    ...operationState,
    status: "restart_schedule_failed",
    phase: "Updated, restart required",
    running: false,
    error: "npm install succeeded but Host restart scheduling failed.",
  });
  const restartJobLabel = buildOysterunUpdateRestartJobLabel({
    stackName,
    operationId: operationState.operation_id,
  });
  const restartJobCommand = [
    "set -euo pipefail",
    'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    `export OYSTERUN_RELEASE_STACK=${shellQuote(stackName)}`,
    `export OYSTERUN_STACK=${shellQuote(stackName)}`,
    `echo "[oysterun-update] restart job start $(date -Is)"`,
    "oysterun service:restart",
  ].join("\n");
  const command = [
    "set -euo pipefail",
    'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    `echo "[oysterun-update] start $(date -Is)"`,
    `npm install -g ${shellQuote(packageSpec)} --prefer-online${registryArg} || { ${installFailedStateCommand}; exit 1; }`,
    `echo "[oysterun-update] npm install complete $(date -Is)"`,
    restartPhaseStateCommand,
    `echo "[oysterun-update] scheduling restart job ${restartJobLabel} $(date -Is)"`,
    `launchctl submit -l ${shellQuote(restartJobLabel)} -o ${shellQuote(logPath)} -e ${shellQuote(logPath)} -- /bin/zsh -lc ${shellQuote(restartJobCommand)} || { ${restartFailedStateCommand}; exit 1; }`,
    `echo "[oysterun-update] restart job scheduled ${restartJobLabel} $(date -Is)"`,
  ].join("\n");
  setTimeout(() => {
    const child = spawn("bash", ["-lc", `${command} >> ${shellQuote(logPath)} 2>&1`], {
      cwd: REPO_ROOT,
      detached: true,
      env: { ...process.env, OYSTERUN_RELEASE_STACK: stackName, OYSTERUN_STACK: stackName },
      stdio: "ignore",
    });
    child.unref();
  }, 500).unref();
  return buildOysterunUpdateStatusPayload({
    status: "update_scheduled",
    channel: resolvedChannel,
    source: "manual",
    newest_version: exactVersion,
    operation_log: operationLog,
    registry_source: registry.source,
    registry_override_active: registry.override_active,
    restart_restore: restartRestore.restart_restore,
  });
}

function scheduleHostRestart({ redirectUrl = null, restartRestore = null } = {}) {
  const { stackName, restartScript } = assertHostRestartSchedulingAvailable();
  setTimeout(() => {
    const child = spawn(restartScript, ["--stack", stackName], {
      cwd: REPO_ROOT,
      detached: true,
      env: {
        ...process.env,
        OYSTERUN_STACK: stackName,
      },
      stdio: "ignore",
    });
    child.unref();
  }, 500).unref();
  return {
    status: "restart_scheduled",
    stack_name: stackName,
    redirect_url: normalizeString(redirectUrl),
    restart_restore: restartRestore,
  };
}

function buildBrowseRoots() {
  return {
    home: resolveHomePath(),
    default: resolveDefaultBrowsePath(),
  };
}

function buildAllowedPathDebugPayload(config = {}) {
  const policy =
    config?.allowed_path && typeof config.allowed_path === "object"
      ? config.allowed_path
      : {};
  return {
    disabled: policy.disabled !== false,
    debug_ui_enabled: policy.debug_ui_enabled === true,
  };
}

function buildProviderPermissionDebugPayload(config = {}) {
  const providerPermission =
    config?.provider_permission && typeof config.provider_permission === "object"
      ? config.provider_permission
      : {};
  return {
    debug_mode_dropdown_enable:
      providerPermission.debug_mode_dropdown_enable === true,
  };
}

function getProviderPermissionRequestField(providerId) {
  if (providerId === "claude") return "permission_mode";
  if (providerId === "codex") return "approval_policy";
  return null;
}

function getProviderPermissionRequest(body = {}, providerId) {
  const field = getProviderPermissionRequestField(providerId);
  if (!field || !Object.prototype.hasOwnProperty.call(body, field)) return null;
  return {
    field,
    rawValue: body[field],
    normalizedValue: normalizeProviderPermissionPolicy(providerId, body[field]),
  };
}

function isProviderPermissionConfirmPresent(body = {}) {
  return (
    body.confirm_beta_provider_permission_mode === true ||
    body.confirmBetaProviderPermissionMode === true
  );
}

function validateProviderPermissionRequest({
  body = {},
  providerId,
  config = readConfig(),
  source = "request",
} = {}) {
  const request = getProviderPermissionRequest(body, providerId);
  if (!request) return;
  const defaultValue = getDefaultProviderPermissionPolicy(providerId);
  if (!request.normalizedValue) {
    throw new Error(
      `${request.field} must be a valid ${providerId} provider permission value`
    );
  }
  if (request.normalizedValue === defaultValue) return;
  if (!isProviderPermissionDebugModeEnabled(config)) {
    throw new Error(
      `${request.field} non-default value requires provider_permission.debug_mode_dropdown_enable=true in config.debug.json`
    );
  }
  if (!isProviderPermissionConfirmPresent(body)) {
    throw new Error(
      `${request.field} non-default value requires confirm_beta_provider_permission_mode=true`
    );
  }
  return {
    source,
    provider: providerId,
    field: request.field,
    value: request.normalizedValue,
    confirmed: true,
  };
}

function validateSessionDefaultsProviderPermissionRequest({
  sessionDefaults = {},
  config = readConfig(),
} = {}) {
  const confirmBody = {
    confirm_beta_provider_permission_mode:
      sessionDefaults.confirm_beta_provider_permission_mode === true ||
      sessionDefaults.confirmBetaProviderPermissionMode === true,
  };
  for (const providerId of ["claude", "codex"]) {
    const providerDefaults =
      sessionDefaults?.[providerId] &&
      typeof sessionDefaults[providerId] === "object" &&
      !Array.isArray(sessionDefaults[providerId])
        ? sessionDefaults[providerId]
        : {};
    const field = getProviderPermissionRequestField(providerId);
    if (!field || !Object.prototype.hasOwnProperty.call(providerDefaults, field)) {
      continue;
    }
    validateProviderPermissionRequest({
      body: { ...confirmBody, [field]: providerDefaults[field] },
      providerId,
      config,
      source: "session_defaults",
    });
  }
}

function buildHostPreferencesPayload() {
  const config = readConfig();
  const configuredDirectHostUrl = normalizeString(
    config.direct_host_url || config.public_base_url
  );
  const activeDirectHostUrl = normalizeString(DIRECT_HOST_URL);
  const payload = {
    connection_mode: CONNECTION_MODE,
    platform: process.platform,
    folder_access_settings_supported: supportsMacFolderAccessPermissions(),
    debug_host_preferences_full_disk_access_block_enabled:
      config.debug_host_preferences_full_disk_access_block_enabled === true,
    folder_access_settings_uri: supportsMacFolderAccessPermissions()
      ? FULL_DISK_ACCESS_SETTINGS_URI
      : null,
    display_name: config.display_name || getDefaultHostDisplayName(),
    notification_sound_web_enabled:
      config.notification_sound_web_enabled !== false,
    notification_sound_app_enabled:
      config.notification_sound_app_enabled !== false,
    debug_show_capability_ui: config.debug_show_capability_ui === true,
    show_interface_style_in_session_setup_profile:
      config.show_interface_style_in_session_setup_profile === true,
    allowed_path: buildAllowedPathDebugPayload(config),
    provider_permission: buildProviderPermissionDebugPayload(config),
    public_base_url: configuredDirectHostUrl,
    direct_host_url: configuredDirectHostUrl,
    active_direct_host_url: activeDirectHostUrl,
    direct_host_url_restart_required:
      Boolean(configuredDirectHostUrl) &&
      Boolean(activeDirectHostUrl) &&
      configuredDirectHostUrl !== activeDirectHostUrl,
    host_restart_supported: Boolean(getActiveStackName()),
    claude_command: getConfiguredProviderCommand(config, "claude"),
    codex_command: getConfiguredProviderCommand(config, "codex"),
    local_url: `http://localhost:${PORT}`,
    default_browse_path: normalizeString(config.default_browse_path),
    resolved_default_browse_path: null,
    home_path: resolveHomePath(),
    default_shared_allowed_paths: getDefaultSharedAllowedPaths(),
    config_path: getConfigPath(),
    config_dir: getConfigDir(),
    config_source: getConfigSource(),
    update: buildOysterunUpdateStatusPayload(),
    restart_restore: buildHostRestartRestoreSummary(
      readHostRestartRestoreState({ configDir: getConfigDir() })
    ),
    ios_push: buildApnsPushStatusPayload("dashboard-admin"),
    session_defaults: config.session_defaults,
    error: null,
  };
  try {
    payload.resolved_default_browse_path = resolveDefaultBrowsePath();
  } catch (err) {
    payload.error = err.message;
  }
  return payload;
}

function resolveSessionNotificationMatrixRoomId({
  sessionId,
  matrixRoomId = null,
}) {
  const binding = getRouteCMatrixRoomBinding(sessionId);
  return (
    normalizeString(binding?.matrix_room_id) ||
    normalizeString(matrixRoomId) ||
    null
  );
}

function hasNotificationConfigRequest(body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, "notifications_enabled")) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "notificationsEnabled")) {
    return true;
  }
  if (
    body.notifications &&
    typeof body.notifications === "object" &&
    !Array.isArray(body.notifications) &&
    Object.prototype.hasOwnProperty.call(body.notifications, "enabled")
  ) {
    return true;
  }
  return false;
}

function normalizeNotificationConfigPayload(body = {}) {
  if (!hasNotificationConfigRequest(body)) return {};
  const rawValue =
    body.notifications_enabled ??
    body.notificationsEnabled ??
    body.notifications?.enabled;
  if (typeof rawValue !== "boolean") {
    throw new Error("notifications.enabled must be boolean");
  }
  return {
    notifications_enabled: rawValue,
  };
}

function buildResolvedSessionNotificationConfig(layers = {}) {
  if (layers?.notifications) {
    return {
      ...layers.notifications,
      storageOwner: "agent_config_notifications_enabled",
      configKey: "notifications.enabled",
    };
  }
  return resolveAgentNotificationConfigFromLayers({
    sharedConfig: layers?.config || layers?.sharedConfig || {},
  });
}

function applySessionNotificationConfigRequest(session, body = {}) {
  if (!session || !hasNotificationConfigRequest(body)) return;
  const payload = normalizeNotificationConfigPayload(body);
  const configAlreadyUpdated =
    body.update_config === true ||
    body.persist_config === true ||
    body.persist_shared_config === true;
  session.notificationConfig = {
    enabled: payload.notifications_enabled !== false,
    storageOwner: "agent_config_notifications_enabled",
    configKey: "notifications.enabled",
    currentSessionOnly: configAlreadyUpdated !== true,
  };
  session.notificationConfigUpdatedAt = new Date().toISOString();
}

function buildSessionNotificationSettingsPayload({
  sessionId,
  matrixRoomId = null,
  session = null,
}) {
  const resolvedMatrixRoomId = resolveSessionNotificationMatrixRoomId({
    sessionId,
    matrixRoomId,
  });
  const liveSession = session || sessionManager.getSession(sessionId);
  const notificationConfig = liveSession?.notificationConfig || {
    enabled: true,
    storageOwner: "agent_config_notifications_enabled",
    configKey: "notifications.enabled",
  };
  const serialized = serializeAgentNotificationConfig(notificationConfig);
  const normalizedSessionId = normalizeString(sessionId);
  return {
    session_id: normalizedSessionId,
    matrix_room_id: resolvedMatrixRoomId,
    matrix_room_bound: Boolean(resolvedMatrixRoomId),
    ...serialized,
    is_default: liveSession?.notificationConfig ? false : true,
    updated_at: liveSession?.notificationConfigUpdatedAt || null,
    current_session_only:
      liveSession?.notificationConfig?.currentSessionOnly === true,
    policy_source: "notifications.enabled",
    compatibility_endpoint: true,
  };
}

function updateSessionNotificationSettingsPayload({
  sessionId,
  matrixRoomId = null,
  notificationsEnabled,
}) {
  if (typeof notificationsEnabled !== "boolean") {
    throw new Error("notifications_enabled must be a boolean");
  }
  const session = sessionManager.getSession(sessionId);
  if (session) {
    session.notificationConfig = {
      enabled: notificationsEnabled,
      storageOwner: "agent_config_notifications_enabled",
      configKey: "notifications.enabled",
      currentSessionOnly: true,
    };
    session.notificationConfigUpdatedAt = new Date().toISOString();
  }
  return buildSessionNotificationSettingsPayload({
    sessionId,
    matrixRoomId,
    session,
  });
}

function isSessionNotificationEnabledFromConfig(session_id, matrix_room_id) {
  const payload = buildSessionNotificationSettingsPayload({
    sessionId: session_id,
    matrixRoomId: matrix_room_id,
  });
  return payload.per_session_notification_enabled !== false;
}

function isCompleteMessageCandidateNotificationEnabled(candidate) {
  const session_id =
    normalizeString(candidate?.sessionId) ||
    normalizeString(candidate?.session_id) ||
    normalizeString(candidate?.hostSessionId) ||
    normalizeString(candidate?.host_session_id);
  const matrix_room_id =
    normalizeString(candidate?.matrixRoomId) ||
    normalizeString(candidate?.matrix_room_id) ||
    normalizeString(candidate?.roomId) ||
    normalizeString(candidate?.room_id);
  return isSessionNotificationEnabledFromConfig(session_id, matrix_room_id);
}

function buildApnsPushStatusPayload(userId = "dashboard-admin") {
  const config = readApnsLocalConfig(getConfigDir());
  const devices = apnsDeviceStore.listDevices({
    userId,
    topic: config.topic,
    environment: config.environment,
    includeDisabled: true,
  });
  const status = {
    config: serializeApnsLocalConfigStatus(config),
    devices: devices.map(serializeApnsDevice),
  };
  // Cloud-mediated push: when the Host is cloud-registered, push delivery is
  // owned by Cloud (the .p8 lives there). Local apns.local.json is not needed.
  // P207 moves APNs token registration to the app installation credential, so
  // Host status no longer lists Cloud-owned phone tokens.
  if (BACKEND_URL && DEVICE_TOKEN) {
    const hostConfig = readConfig();
    status.config = {
      ...status.config,
      enabled: true,
      error: null,
      cloud_delivery: true,
      cloud_api_url: BACKEND_URL,
      cloud_api_stage: BACKEND_STAGE,
      host_id: normalizeString(hostConfig.host_id || hostConfig.device_id || DEVICE_ID) || null,
    };
  }
  return status;
}

async function sendApnsTestNotification() {
  // Cloud holds the APNs p8 and signs; the Host only posts a test candidate.
  const backendUrl = normalizeString(BACKEND_URL).replace(/\/+$/, "");
  const deviceToken = normalizeString(DEVICE_TOKEN);
  if (!backendUrl || !deviceToken) {
    throw new Error(
      "Cloud push is not configured (missing Host Cloud identity). Run setup with --enable-cloud-direct."
    );
  }
  const response = await fetch(buildCloudApiUrl(backendUrl, "/api/notifications/candidates", BACKEND_STAGE), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({
      dedupe_key: `apns-test-${Date.now()}`,
      session_id: "apns-test",
      semantic_type: "test",
      title: "Oysterun",
      body: "This iPhone can receive Oysterun APNs notifications from this Host.",
      route: "/app",
    }),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const ok = response.ok && data?.accepted !== false;
  if (!ok) {
    throw new Error(
      data?.reason || `Cloud rejected the test candidate (HTTP ${response.status})`
    );
  }
  return [
    {
      ok: true,
      delivery: "cloud",
      status_code: response.status,
      selected_token_count: data?.selected_token_count ?? null,
    },
  ];
}

function getDashboardCredentialConfig() {
  const config = readConfig();
  return {
    username: normalizeString(config.dashboard_user),
    passwordHash:
      typeof config.dashboard_password_hash === "string" &&
      config.dashboard_password_hash.trim()
        ? config.dashboard_password_hash.trim()
        : null,
  };
}

function getDashboardCredentialError() {
  const credentials = getDashboardCredentialConfig();
  if (!credentials.username || !credentials.passwordHash) {
    return "Dashboard credentials are not configured. Run `node host-service/setup.mjs` and set a username/password first.";
  }
  return null;
}

function createDirectHostLoginBootstrapQr() {
  const config = readConfig();
  const hostId = normalizeString(config.host_id || config.device_id || DEVICE_ID);
  const directHostUrl = normalizeString(
    config.direct_host_url || config.public_base_url || DIRECT_HOST_URL
  );
  if (config.connection_mode !== "direct") {
    throw new Error("Direct Host login QR is only available in direct mode.");
  }
  if (!hostId) {
    throw new Error("host_id is required to create a Direct Host login QR.");
  }
  if (!directHostUrl) {
    throw new Error(
      "direct_host_url is required to create a Direct Host login QR."
    );
  }
  const bootstrap = createHostLoginBootstrapToken();
  const qrPayload = buildDirectHostLoginQrPayload({
    hostId,
    directHostUrl,
    bootstrapToken: bootstrap.token,
    expiresAt: bootstrap.expires_at,
  });
  const compactQrPayload = buildCompactDirectHostLoginQrPayload({
    hostId,
    directHostUrl,
    bootstrapToken: bootstrap.token,
    expiresAt: bootstrap.expires_at,
  });
  const qrPayloadCompactText = JSON.stringify(compactQrPayload);
  return {
    status: "bootstrap_token_created",
    host_id: hostId,
    direct_host_url: directHostUrl,
    expires_at: bootstrap.expires_at,
    ttl_seconds: Math.round(bootstrap.ttl_ms / 1000),
    qr_payload: qrPayload,
    qr_payload_compact: compactQrPayload,
    qr_payload_compact_text: qrPayloadCompactText,
    qr_svg_data_uri: buildQrSvgDataUri(qrPayloadCompactText),
  };
}

async function createCloudNotificationBootstrap() {
  const config = readConfig();
  const backendUrl = normalizeString(config.backend_url || BACKEND_URL)?.replace(
    /\/+$/,
    ""
  );
  const hostCredential = normalizeString(
    config.host_credential || config.device_token || DEVICE_TOKEN
  );
  const hostId = normalizeString(config.host_id || config.device_id || DEVICE_ID);
  if (!backendUrl || !hostCredential || !hostId) {
    throw new Error(
      "Cloud notification pairing is not configured. Run setup with --enable-cloud-direct."
    );
  }

  const response = await fetch(buildCloudApiUrl(backendUrl, "/api/host-installations/bootstrap-token", BACKEND_STAGE), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hostCredential}`,
    },
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(
      data?.detail ||
        data?.error ||
        `Cloud pairing bootstrap failed (HTTP ${response.status})`
    );
  }
  return {
    status: "notification_bootstrap_created",
    host_id: data.host_id || hostId,
    cloud_api_url: backendUrl,
    cloud_api_stage: BACKEND_STAGE,
    notification_registration_token: data.notification_registration_token,
    expires_at: data.expires_at,
    ttl_seconds: data.ttl_seconds,
  };
}

function normalizeHostPreferencesSessionDefaults(
  currentSessionDefaults = {},
  requestedSessionDefaults = {},
  options = {}
) {
  const providerPermissionDebugModeEnabled =
    options.providerPermissionDebugModeEnabled === true;
  const currentWebDefaults =
    currentSessionDefaults.web &&
    typeof currentSessionDefaults.web === "object" &&
    !Array.isArray(currentSessionDefaults.web)
      ? currentSessionDefaults.web
      : {};
  const currentNotificationDefaults =
    currentSessionDefaults.notifications &&
    typeof currentSessionDefaults.notifications === "object" &&
    !Array.isArray(currentSessionDefaults.notifications)
      ? currentSessionDefaults.notifications
      : {};
  const requestedNotificationDefaults =
    requestedSessionDefaults.notifications &&
    typeof requestedSessionDefaults.notifications === "object" &&
    !Array.isArray(requestedSessionDefaults.notifications)
      ? requestedSessionDefaults.notifications
      : {};
  const requestedRuntimeCapabilities =
    requestedSessionDefaults.runtime_capabilities ??
    requestedSessionDefaults.runtimeCapabilities;
  const currentRuntimeCapabilities =
    currentSessionDefaults.runtime_capabilities ??
    currentSessionDefaults.runtimeCapabilities;
  return normalizeSessionDefaults({
    ...currentSessionDefaults,
    ...requestedSessionDefaults,
    interface_type: Object.prototype.hasOwnProperty.call(
      requestedSessionDefaults,
      "interface_type"
    )
      ? normalizeHostDefaultInterfaceType(
          requestedSessionDefaults.interface_type
        )
      : currentSessionDefaults.interface_type,
    claude: {
      ...(currentSessionDefaults.claude || {}),
      ...(requestedSessionDefaults.claude || {}),
      permission_mode: providerPermissionDebugModeEnabled
        ? requestedSessionDefaults.claude?.permission_mode ??
          currentSessionDefaults.claude?.permission_mode
        : getDefaultProviderPermissionPolicy("claude"),
    },
    codex: {
      ...(currentSessionDefaults.codex || {}),
      ...(requestedSessionDefaults.codex || {}),
      approval_policy: providerPermissionDebugModeEnabled
        ? requestedSessionDefaults.codex?.approval_policy ??
          currentSessionDefaults.codex?.approval_policy
        : getDefaultProviderPermissionPolicy("codex"),
    },
    web: {
      ...currentWebDefaults,
      enabled: currentWebDefaults.enabled === true,
      access: normalizeAgentWebAccess(
        currentWebDefaults.access || "owner_only"
      ),
    },
    notifications: {
      ...currentNotificationDefaults,
      ...requestedNotificationDefaults,
      enabled: Object.prototype.hasOwnProperty.call(
        requestedNotificationDefaults,
        "enabled"
      )
        ? requestedNotificationDefaults.enabled === true
        : currentNotificationDefaults.enabled !== false,
    },
    runtime_capabilities:
      requestedRuntimeCapabilities !== undefined
        ? normalizeRuntimeCapabilityState(requestedRuntimeCapabilities, {
            baseState: normalizeRuntimeCapabilityState(currentRuntimeCapabilities),
          })
        : normalizeRuntimeCapabilityState(currentRuntimeCapabilities),
  });
}

function readWritableAgentConfig(
  configPath,
  interfaceType = "coding",
  kind = "shared"
) {
  if (!existsSync(configPath)) {
    if (kind === "local") {
      return {};
    }
    const sessionDefaults = readConfig().session_defaults;
    const scaffold = buildInitialSharedAgentConfig(sessionDefaults);
    scaffold.interface.type =
      interfaceType || scaffold.interface.type || "coding";
    scaffold.ui.default_surface =
      interfaceType || scaffold.ui.default_surface || "coding";
    return scaffold;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${configPath}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid agent config root object in ${configPath}`);
  }

  return parsed;
}

function readExplicitRequestedProvider(body = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, "provider")) {
    return { requestedProvider: null, hasExplicitProvider: false };
  }
  if (typeof body.provider !== "string" || !body.provider.trim()) {
    return {
      error: "provider must be a non-empty string",
      requestedProvider: null,
      hasExplicitProvider: true,
    };
  }
  const normalizedProvider = body.provider.trim();
  try {
    return {
      requestedProvider: requireProvider(normalizedProvider, {
        config: readConfig(),
      }).id,
      hasExplicitProvider: true,
    };
  } catch (err) {
    return {
      error: err.message,
      requestedProvider: null,
      hasExplicitProvider: true,
    };
  }
}

const ROUTEC_RESUMABLE_HISTORY_RUNTIMES = new Set(["claude", "codex"]);

function resolveProviderResumeMetadataFromHistory(sourceRecord, resumeAdapter) {
  const runtime = normalizeString(sourceRecord?.runtime);
  if (!runtime || !ROUTEC_RESUMABLE_HISTORY_RUNTIMES.has(runtime)) {
    return {
      ok: false,
      reason: "unsupported_runtime",
      message: `Unsupported resume runtime: ${runtime || "missing"}`,
    };
  }

  if (
    typeof resumeAdapter?.supportsResume !== "function" ||
    resumeAdapter.supportsResume() !== true
  ) {
    return {
      ok: false,
      reason: "provider_resume_unsupported",
      message: `Provider "${runtime}" does not support Resume`,
    };
  }

  const providerResumeId =
    runtime === "codex"
      ? normalizeString(sourceRecord.provider_thread_id) ||
        normalizeString(sourceRecord.provider_resume_id)
      : normalizeString(sourceRecord.provider_resume_id);
  if (!providerResumeId) {
    return {
      ok: false,
      reason: "provider_resume_metadata_missing",
      message: "Source session is missing provider resume metadata",
    };
  }

  return {
    ok: true,
    runtime,
    providerResumeId,
  };
}

function buildRuntimeOverridesFromBody(
  body = {},
  requestedProvider = undefined
) {
  const overrides = {};

  if (requestedProvider !== undefined) overrides.provider = requestedProvider;
  else if (Object.prototype.hasOwnProperty.call(body, "provider"))
    overrides.provider = body.provider;
  if (Object.prototype.hasOwnProperty.call(body, "model"))
    overrides.model = body.model;
  if (Object.prototype.hasOwnProperty.call(body, "reasoning_effort")) {
    const providerId = requestedProvider || body.provider || "claude";
    overrides.reasoningEffort = normalizeProviderReasoningEffort(
      providerId,
      body.reasoning_effort
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "permission_mode")) {
    overrides.permissionMode = normalizeProviderPermissionPolicy(
      "claude",
      body.permission_mode
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "approval_policy")) {
    overrides.approvalPolicy = normalizeProviderPermissionPolicy(
      "codex",
      body.approval_policy
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "allowed_paths")) {
    overrides.allowedPaths = normalizeStringArray(body.allowed_paths);
  }
  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "allow_dangerously_skip_permissions"
    )
  ) {
    overrides.allowDangerouslySkipPermissions =
      body.allow_dangerously_skip_permissions;
  }
  if (Object.prototype.hasOwnProperty.call(body, "dangerous_mode")) {
    overrides.dangerousMode = body.dangerous_mode;
  }
  if (Object.prototype.hasOwnProperty.call(body, "search_enabled")) {
    overrides.searchEnabled = body.search_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, "image_input_enabled")) {
    overrides.imageInputEnabled = body.image_input_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_args")) {
    overrides.providerArgs = body.provider_args;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_config_overrides")) {
    overrides.providerConfigOverrides = body.provider_config_overrides;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_commands")) {
    overrides.providerCommands = body.provider_commands;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_profile")) {
    overrides.providerProfile = body.provider_profile;
  }

  return overrides;
}

function providerMismatchResponse(requestedProvider, resolvedProvider) {
  return {
    error: `Resolved runtime provider mismatch: requested "${requestedProvider}" but resolved "${resolvedProvider}"`,
    requested_provider: requestedProvider,
    resolved_provider: resolvedProvider,
  };
}

const OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT =
  "oysterun_session_setup_provider_model_permission_v1";

function getSessionSetupOysterunPermissionPolicyKind(providerId) {
  if (providerId === "codex") return "approval_policy";
  if (providerId === "claude") return "permission_mode";
  return "none";
}

function getSessionSetupRequestOysterunPermissionPolicy(body = {}, providerId) {
  const kind = getSessionSetupOysterunPermissionPolicyKind(providerId);
  if (kind === "approval_policy")
    return normalizeString(body.approval_policy) || null;
  if (kind === "permission_mode")
    return normalizeString(body.permission_mode) || null;
  return null;
}

function getSessionSetupResolvedOysterunPermissionPolicy(
  runtime = {},
  providerId
) {
  const kind = getSessionSetupOysterunPermissionPolicyKind(providerId);
  if (kind === "approval_policy") return runtime.approvalPolicy || null;
  if (kind === "permission_mode") return runtime.permissionMode || null;
  return null;
}

function buildSessionSetupProviderModelPermissionFields({
  body = {},
  requestedProvider = null,
  resolved,
  session = null,
}) {
  const provider = session?.provider || resolved.runtime.provider;
  const model = session?.model || resolved.runtime.model || null;
  const permissionPolicyKind =
    getSessionSetupOysterunPermissionPolicyKind(provider);
  const requestPermissionPolicy =
    getSessionSetupRequestOysterunPermissionPolicy(body, provider);
  const responsePermissionPolicy =
    getSessionSetupResolvedOysterunPermissionPolicy(resolved.runtime, provider);
  const requestedModel = normalizeString(body.model) || null;
  const requestedModelCanonical = requestedModel
    ? normalizeProviderModel(provider, requestedModel)
    : null;
  const modelMatches =
    Boolean(requestedModel) &&
    (requestedModel === model ||
      (Boolean(requestedModelCanonical) && requestedModelCanonical === model));
  const permissionPolicyMatches =
    permissionPolicyKind === "none"
      ? requestPermissionPolicy === null && responsePermissionPolicy === null
      : Boolean(requestPermissionPolicy) &&
        Boolean(responsePermissionPolicy) &&
        requestPermissionPolicy === responsePermissionPolicy;
  return {
    provider,
    model,
    permissionPolicyKind,
    requestPermissionPolicy,
    responsePermissionPolicy,
    requestedProvider: requestedProvider || null,
    requestedModel,
    requestedModelCanonical,
    request_response_provider_model_permission_match:
      Boolean(requestedProvider) &&
      requestedProvider === provider &&
      modelMatches &&
      permissionPolicyMatches,
  };
}

function sessionSetupProviderModelPermissionMismatchResponse(fields) {
  return {
    error: "Session setup provider/model/Oysterun permission proof mismatch",
    code: "session_setup_provider_model_permission_mismatch",
    contract: OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
    request_provider: fields.requestedProvider,
    response_provider: fields.provider,
    request_model: fields.requestedModel,
    request_model_canonical: fields.requestedModelCanonical,
    response_model: fields.model,
    request_oysterun_permission_policy_kind: fields.permissionPolicyKind,
    request_oysterun_permission_policy: fields.requestPermissionPolicy,
    response_oysterun_permission_policy: fields.responsePermissionPolicy,
    request_response_provider_model_permission_match: false,
  };
}

function sessionSetupProviderModelPermissionProofMismatchResponse(proof) {
  return {
    error: "Session setup provider/model/Oysterun permission proof mismatch",
    code: "session_setup_provider_model_permission_mismatch",
    contract: OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
    proof_surface: proof.proof_surface,
    response_status: proof.response_status,
    session_id: proof.session_id,
    request_provider: proof.request_provider,
    response_provider: proof.provider,
    request_model: proof.request_model,
    request_model_canonical: proof.request_model_canonical,
    response_model: proof.model,
    request_oysterun_permission_policy_kind:
      proof.request_oysterun_permission_policy_kind,
    request_oysterun_permission_policy:
      proof.request_oysterun_permission_policy,
    response_oysterun_permission_policy:
      proof.response_oysterun_permission_policy ?? proof.oysterun_permission_policy,
    request_response_provider_model_permission_match: false,
  };
}

function buildSessionSetupProviderModelPermissionProof({
  body = {},
  requestedProvider = null,
  resolved,
  session,
  proofSurface = "host_session_start_response",
  responseStatus = "session_started",
  sessionStartResponseContractCountable = true,
}) {
  const fields = buildSessionSetupProviderModelPermissionFields({
    body,
    requestedProvider,
    resolved,
    session,
  });
  return {
    contract: OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
    proof_surface: proofSurface,
    response_status: responseStatus,
    session_id: session.id,
    request_provider: fields.requestedProvider,
    request_model: fields.requestedModel,
    request_model_canonical: fields.requestedModelCanonical,
    request_oysterun_permission_policy_kind: fields.permissionPolicyKind,
    request_oysterun_permission_policy: fields.requestPermissionPolicy,
    provider: fields.provider,
    model: fields.model,
    oysterun_permission_policy_kind: fields.permissionPolicyKind,
    oysterun_permission_policy: fields.responsePermissionPolicy,
    response_oysterun_permission_policy: fields.responsePermissionPolicy,
    permission_source_of_truth: "oysterun_session_setup",
    provider_native_permission_fields_derived_from_oysterun_policy: true,
    provider_native_permission_fields: {
      permission_mode: resolved.runtime.permissionMode || null,
      approval_policy: resolved.runtime.approvalPolicy || null,
      sandbox_mode: resolved.runtime.sandboxMode || null,
    },
    request_response_provider_model_permission_match:
      fields.request_response_provider_model_permission_match,
    session_start_response_contract_countable:
      sessionStartResponseContractCountable === true,
    resume_session_setup_runtime_gate_countable:
      proofSurface === "host_sessions_resume_response" ? false : undefined,
    request_must_be_visible_ui_click: true,
    visible_click_runtime_proof_required: true,
    visible_click_runtime_proof_present: false,
    direct_session_start_api_substitute_runtime_proof_required: true,
    direct_session_start_api_substitute_source_static_countable: false,
    source_static_proof_satisfies_direct_api_substitute_predicate: false,
    real_codex_non_substitution_required: fields.provider === "codex",
    delivery_gate_accepted: false,
    closeout_readiness_claimed: false,
    phase2_handoff_claimed: false,
  };
}

function isProviderUnavailableError(err) {
  return err?.code === "provider_unavailable";
}

function serializeProviderUnavailableError(err) {
  return {
    error: err.message,
    code: "provider_unavailable",
    provider: err.providerId || null,
    configured_command: err.command || null,
    config_key: err.configKey || null,
  };
}

function isProductSkillRequirementError(err) {
  return err?.code === "PRODUCT_SKILL_REQUIREMENT_ERROR";
}

function serializeProductSkillRequirementError(err) {
  return {
    error: err.message,
    code: "product_skill_requirement_failed",
    reason: err.reason || null,
    product_skill_copy_contract: "p54_product_skill_source_of_truth_split_v1",
  };
}

const AGENT_WEB_ACCESS_VALUES = new Set(["owner_only", "password", "public"]);

function normalizeAgentWebAccess(value) {
  const access = normalizeString(value);
  if (!access || !AGENT_WEB_ACCESS_VALUES.has(access)) {
    throw new Error(
      `web_access must be one of ${[...AGENT_WEB_ACCESS_VALUES].join(", ")}`
    );
  }
  return access;
}

function hasAgentWebEnabledRequest(body = {}) {
  return (
    Object.prototype.hasOwnProperty.call(body, "web_enabled") ||
    Object.prototype.hasOwnProperty.call(body, "webEnabled")
  );
}

function hasSessionProfileAllowedPathsRequest(body = {}) {
  return (
    Object.prototype.hasOwnProperty.call(body, "allowed_paths") ||
    Object.prototype.hasOwnProperty.call(body, "allowedPaths")
  );
}

function normalizeSessionProfileAllowedPathsRequest(body = {}) {
  return normalizeStringArray(body.allowed_paths ?? body.allowedPaths);
}

function normalizeAgentWebEnabled(value) {
  if (typeof value !== "boolean") {
    throw new Error("web_enabled must be boolean");
  }
  return value === true;
}

function requireConfiguredProvider(providerId = "claude") {
  return requireProvider(providerId || "claude", { config: readConfig() });
}

function serializeConfiguredProvider(providerId = "claude") {
  return serializeProvider(requireConfiguredProvider(providerId));
}

function serializeProviderAuthRequiredError(
  providerId,
  providerInfo,
  providerAuthStatus
) {
  return {
    error: providerAuthStatus.message,
    code: "provider_auth_required",
    provider: providerId,
    provider_info: serializeProvider(providerInfo),
    provider_auth: serializeProviderAuthStatus(providerAuthStatus),
  };
}

function resolveSlashCommandName(text) {
  const trimmed = normalizeString(text);
  if (!trimmed || !trimmed.startsWith("/")) {
    return "";
  }
  return trimmed.slice(1).split(/\s+/)[0].toLowerCase();
}

function isClaudeLoginSlashCommand(session, text) {
  const providerId = session.provider || session.adapterId || "claude";
  if (providerId !== "claude") {
    return false;
  }
  return resolveSlashCommandName(text) === "login";
}

async function buildClaudeLoginSlashCommandResponse(session) {
  const providerId = "claude";
  const result = await providerAuthManager.startLogin(providerId);
  const providerAuthStatus = await providerAuthManager.getStatus(providerId);
  const authJob = result.job;
  let status = "provider_auth_required";
  if (providerAuthStatus.state === "authenticated") {
    status = "provider_authenticated";
  } else if (authJob?.state === "running") {
    status = "provider_auth_started";
  }
  return {
    status,
    session_id: session.id,
    agent_id: session.agentId,
    provider: providerId,
    command: "login",
    provider_auth: serializeProviderAuthStatus(providerAuthStatus),
    auth_job: authJob,
  };
}

function buildNormalizedConfigPayload(body = {}, runtime) {
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(body, "interface_type")) {
    normalized.interface_type =
      normalizeString(body.interface_type) || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider")) {
    normalized.provider = runtime.provider;
  }
  if (Object.prototype.hasOwnProperty.call(body, "model")) {
    normalized.model = runtime.model;
  }
  if (Object.prototype.hasOwnProperty.call(body, "reasoning_effort")) {
    normalized.reasoning_effort = runtime.reasoningEffort ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, "permission_mode")) {
    normalized.permission_mode = runtime.permissionMode ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, "approval_policy")) {
    normalized.approval_policy = runtime.approvalPolicy ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, "sandbox_mode")) {
    normalized.sandbox_mode = runtime.sandboxMode ?? undefined;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "allow_dangerously_skip_permissions"
    )
  ) {
    normalized.allow_dangerously_skip_permissions =
      runtime.allowDangerouslySkipPermissions === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "dangerous_mode")) {
    normalized.dangerous_mode = runtime.dangerousMode === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "search_enabled")) {
    normalized.search_enabled = runtime.searchEnabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "image_input_enabled")) {
    normalized.image_input_enabled = runtime.imageInputEnabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_args")) {
    normalized.provider_args = runtime.native?.args || [];
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_config_overrides")) {
    normalized.provider_config_overrides =
      runtime.native?.configOverrides || {};
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_commands")) {
    normalized.provider_commands = runtime.native?.commands || [];
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_profile")) {
    normalized.provider_profile = runtime.native?.profile || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, "runtime_capabilities")) {
    normalized.runtime_capabilities = normalizeRuntimeCapabilityState(
      body.runtime_capabilities
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "runtimeCapabilities")) {
    normalized.runtime_capabilities = normalizeRuntimeCapabilityState(
      body.runtimeCapabilities
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "allowed_paths")) {
    normalized.allowed_paths = normalizeStringArray(body.allowed_paths);
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "web_access") ||
    Object.prototype.hasOwnProperty.call(body, "webAccess")
  ) {
    normalized.web_access = normalizeAgentWebAccess(
      body.web_access ?? body.webAccess
    );
  }
  if (hasAgentWebEnabledRequest(body)) {
    normalized.web_enabled = normalizeAgentWebEnabled(
      body.web_enabled ?? body.webEnabled
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "web_password") ||
    Object.prototype.hasOwnProperty.call(body, "webPassword")
  ) {
    const password = normalizeString(body.web_password ?? body.webPassword);
    if (password) {
      normalized.web_password = password;
    }
  }
  Object.assign(normalized, normalizeNotificationConfigPayload(body));
  if (Object.prototype.hasOwnProperty.call(body, "local_allowed_paths")) {
    normalized.local_allowed_paths = normalizeStringArray(
      body.local_allowed_paths
    );
  }
  Object.assign(normalized, normalizeTelegramConfigPayload(body));

  return normalized;
}

function ensureConfigBranch(config, key) {
  if (
    !config[key] ||
    typeof config[key] !== "object" ||
    Array.isArray(config[key])
  ) {
    config[key] = {};
  }
  return config[key];
}

function pruneEmptyConfigBranch(config, key) {
  const branch = config[key];
  if (!branch || typeof branch !== "object" || Array.isArray(branch))
    return false;
  if (Object.keys(branch).length > 0) return false;
  delete config[key];
  return true;
}

function stripSandboxModeConfig(config) {
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(config, "sandbox_mode")) {
    delete config.sandbox_mode;
    changed = true;
  }
  const interfaceConfig = config.interface;
  if (
    interfaceConfig &&
    typeof interfaceConfig === "object" &&
    !Array.isArray(interfaceConfig)
  ) {
    if (Object.prototype.hasOwnProperty.call(interfaceConfig, "sandbox_mode")) {
      delete interfaceConfig.sandbox_mode;
      changed = true;
    }
    if (Object.keys(interfaceConfig).length === 0) {
      delete config.interface;
      changed = true;
    }
  }
  return changed;
}

function applySharedConfigUpdates(config, body = {}) {
  let changed = stripSandboxModeConfig(config);

  if (Object.prototype.hasOwnProperty.call(body, "session_name")) {
    config.session_name = normalizeSessionName(body.session_name) || undefined;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "model")) {
    config.model = body.model || undefined;
    ensureConfigBranch(config, "interface").model = body.model || undefined;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "reasoning_effort")) {
    const providerId =
      normalizeString(body.provider) ||
      normalizeString(config?.interface?.provider) ||
      "claude";
    const reasoningEffort =
      normalizeProviderReasoningEffort(providerId, body.reasoning_effort) ||
      undefined;
    config.reasoning_effort = reasoningEffort;
    ensureConfigBranch(config, "interface").reasoning_effort = reasoningEffort;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider")) {
    ensureConfigBranch(config, "interface").provider =
      normalizeString(body.provider) || undefined;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "permission_mode")) {
    const permissionMode =
      normalizeClaudePermissionMode(body.permission_mode) || undefined;
    config.permission_mode = permissionMode;
    ensureConfigBranch(config, "interface").permission_mode = permissionMode;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "approval_policy")) {
    ensureConfigBranch(config, "interface").approval_policy =
      normalizeString(body.approval_policy) || undefined;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "sandbox_mode")) {
    changed = stripSandboxModeConfig(config) || changed;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "allow_dangerously_skip_permissions"
    )
  ) {
    const interfaceConfig = ensureConfigBranch(config, "interface");
    interfaceConfig.allow_dangerously_skip_permissions =
      body.allow_dangerously_skip_permissions === true;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "dangerous_mode")) {
    ensureConfigBranch(config, "interface").dangerous_mode =
      body.dangerous_mode === true;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "search_enabled")) {
    ensureConfigBranch(config, "interface").search_enabled =
      body.search_enabled === true;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "image_input_enabled")) {
    ensureConfigBranch(config, "interface").image_input_enabled =
      body.image_input_enabled === true;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "interface_type")) {
    ensureConfigBranch(config, "interface").type =
      body.interface_type || undefined;
    ensureConfigBranch(config, "ui").default_surface =
      body.interface_type || undefined;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "runtime_capabilities")) {
    config.runtime_capabilities = normalizeRuntimeCapabilityState(
      body.runtime_capabilities
    );
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "allowed_paths")) {
    const permissions = ensureConfigBranch(config, "permissions");
    if (Array.isArray(body.allowed_paths) && body.allowed_paths.length > 0) {
      permissions.allowed_paths = body.allowed_paths;
    } else {
      delete permissions.allowed_paths;
      pruneEmptyConfigBranch(config, "permissions");
    }
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "web_access")) {
    ensureConfigBranch(config, "web").access = body.web_access;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "web_enabled")) {
    ensureConfigBranch(config, "web").enabled = body.web_enabled === true;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "notifications_enabled")) {
    ensureConfigBranch(config, "notifications").enabled =
      body.notifications_enabled !== false;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegram_enabled")) {
    ensureConfigBranch(config, "telegram").enabled =
      body.telegram_enabled === true;
    changed = true;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "telegram_send_tool_messages"
    )
  ) {
    ensureConfigBranch(config, "telegram").send_tool_messages =
      body.telegram_send_tool_messages === true;
    changed = true;
  }

  return changed;
}

function applyLocalConfigUpdates(config, body = {}) {
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(body, "provider_args")) {
    ensureConfigBranch(config, "interface").provider_args =
      normalizeStringArray(body.provider_args);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_config_overrides")) {
    ensureConfigBranch(config, "interface").provider_config_overrides =
      normalizeObject(body.provider_config_overrides);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_commands")) {
    ensureConfigBranch(config, "interface").provider_commands =
      normalizeStringArray(body.provider_commands);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "provider_profile")) {
    ensureConfigBranch(config, "interface").provider_profile =
      normalizeString(body.provider_profile) || undefined;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "local_allowed_paths")) {
    ensureConfigBranch(config, "permissions").local_allowed_paths =
      body.local_allowed_paths;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "web_password")) {
    ensureConfigBranch(config, "web").password = body.web_password;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegram_bot_token")) {
    ensureConfigBranch(config, "telegram").bot_token = body.telegram_bot_token;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "telegram_allowed_users")) {
    ensureConfigBranch(config, "telegram").allowed_users = [
      ...body.telegram_allowed_users,
    ];
    changed = true;
  }

  return changed;
}

function mergeConfigObjects(base = {}, overlay = {}) {
  const merged = JSON.parse(JSON.stringify(base || {}));
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeConfigObjects(merged[key], value);
      continue;
    }
    merged[key] = JSON.parse(JSON.stringify(value));
  }
  return merged;
}

function persistAgentConfigUpdates(folder, body = {}) {
  const layers = readAgentConfigLayers(folder);
  const sharedConfig = readWritableAgentConfig(
    layers.configPath,
    body.interface_type || "coding",
    "shared"
  );
  const localConfig = readWritableAgentConfig(
    layers.localConfigPath,
    body.interface_type || "coding",
    "local"
  );
  const sharedChanged = applySharedConfigUpdates(sharedConfig, body);
  const localChanged = applyLocalConfigUpdates(localConfig, body);

  if (sharedChanged || localChanged) {
    resolveWorkspacePolicy(
      folder,
      mergeConfigObjects(sharedConfig, localConfig)
    );
    mkdirSync(layers.configDirPath, { recursive: true });
    mkdirSync(layers.sitePath, { recursive: true });

    if (sharedChanged) {
      const cleanShared = JSON.parse(JSON.stringify(sharedConfig));
      writeFileSync(
        layers.configPath,
        JSON.stringify(cleanShared, null, 2) + "\n"
      );
    }
    if (localChanged) {
      const cleanLocal = JSON.parse(JSON.stringify(localConfig));
      writeFileSync(
        layers.localConfigPath,
        JSON.stringify(cleanLocal, null, 2) + "\n"
      );
    }

    const resolved = resolveAgentRuntimeConfig(folder);
    return {
      changed: true,
      config: resolved.config,
      configPath: layers.configPath,
      localConfigPath: layers.localConfigPath,
    };
  }

  return {
    changed: false,
    config: layers.config,
    configPath: layers.configPath,
    localConfigPath: layers.localConfigPath,
  };
}

function serializeProvider(provider, config = readConfig()) {
  return {
    id: provider.id,
    label: provider.label,
    default_model:
      typeof provider.defaultModel === "string" ? provider.defaultModel : null,
    default_model_available: provider.defaultModelAvailable === true,
    saved_default_model:
      typeof provider.savedDefaultModel === "string"
        ? provider.savedDefaultModel
        : null,
    saved_default_model_available:
      provider.savedDefaultModelAvailable === true,
    default_reasoning_effort:
      typeof provider.defaultReasoningEffort === "string"
        ? provider.defaultReasoningEffort
        : null,
    model_options: Array.isArray(provider.modelOptions)
      ? [...provider.modelOptions]
      : [],
    reasoning_effort_options: Array.isArray(provider.reasoningEffortOptions)
      ? [...provider.reasoningEffortOptions]
      : [],
    permission_mode_options: Array.isArray(provider.permissionModeOptions)
      ? [...provider.permissionModeOptions]
      : [],
    approval_policy_options: Array.isArray(provider.approvalPolicyOptions)
      ? [...provider.approvalPolicyOptions]
      : [],
    models: Array.isArray(provider.models)
      ? provider.models.map((entry) => ({
          id: entry.id,
          label: entry.label,
          hidden: entry.hidden === true,
          is_default: entry.isDefault === true,
          default_reasoning_effort:
            typeof entry.defaultReasoningEffort === "string"
              ? entry.defaultReasoningEffort
              : null,
          reasoning_effort_options: Array.isArray(entry.reasoningEffortOptions)
            ? [...entry.reasoningEffortOptions]
            : [],
        }))
      : [],
    runtime_supported: provider.runtimeSupported === true,
    command_available: isProviderCommandAvailable(config, provider.id),
    coder_session_supported: provider.coderSessionSupported === true,
    auth_supported: provider.auth?.supported === true,
    auth_start_supported: provider.auth?.startLoginSupported === true,
    capabilities: provider.capabilities,
    controls: provider.controls,
    native_config: provider.nativeConfig,
    provider_runtime_status: provider.providerRuntimeStatus || null,
    model_catalog_status: provider.modelCatalogStatus || null,
  };
}

function serializeSessionProfileConfig(profile, overrides = {}) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }
  const notificationConfig =
    overrides.notifications &&
    typeof overrides.notifications === "object" &&
    !Array.isArray(overrides.notifications)
      ? overrides.notifications
      : profile.notifications || {};
  const fields =
    profile.fields &&
    typeof profile.fields === "object" &&
    !Array.isArray(profile.fields)
      ? profile.fields
      : {};
  const serializeField = (entry) => ({
    supported: entry?.supported === true,
    value:
      typeof entry?.value === "string" && entry.value.trim()
        ? entry.value.trim()
        : null,
  });
  return {
    provider:
      typeof profile.provider === "string" && profile.provider.trim()
        ? profile.provider.trim()
        : null,
    notifications: serializeAgentNotificationConfig(notificationConfig),
    telegram: serializeAgentTelegramConfig(profile.telegram || {}),
    fields: {
      model: serializeField(fields.model),
      reasoning_effort: serializeField(fields.reasoning_effort),
      permission_mode: serializeField(fields.permission_mode),
      approval_policy: serializeField(fields.approval_policy),
      sandbox_mode: serializeField(fields.sandbox_mode),
    },
  };
}

function buildSessionProfileConfigPayload(
  folderPath,
  providerId,
  modelId = null,
  overrides = {}
) {
  if (typeof folderPath !== "string" || !folderPath.trim()) {
    return null;
  }
  try {
    return serializeSessionProfileConfig(
      resolveAgentSessionProfileConfig(folderPath, providerId, modelId),
      overrides
    );
  } catch (err) {
    console.error(
      `[session-profile] Failed to read ${folderPath}: ${err.message}`
    );
    return null;
  }
}

function buildLiveSessionProfileConfigPayload(session) {
  if (!session) return null;
  return buildSessionProfileConfigPayload(
    session.cwd,
    session.provider || "claude",
    session.model || null,
    { notifications: session.notificationConfig }
  );
}

async function serializeProviderCatalogEntry(provider, config = readConfig()) {
  return {
    ...serializeProvider(provider, config),
    auth_status: serializeProviderAuthStatus(
      await providerAuthManager.getStatus(provider.id, config)
    ),
  };
}

async function getBlockingProviderAuthStatus(
  providerId,
  config = readConfig()
) {
  const provider = requireProvider(providerId, { config });
  if (
    provider.auth?.supported !== true ||
    provider.auth?.startLoginSupported !== true
  ) {
    return null;
  }
  const status = await providerAuthManager.getStatus(providerId, config);
  return status.state === "required" ? status : null;
}

function buildNativePayload(runtime) {
  return {
    args: runtime?.native?.args || [],
    config_overrides: runtime?.native?.configOverrides || {},
    commands: runtime?.native?.commands || [],
    profile: runtime?.native?.profile || null,
  };
}

function buildCoderSettings(runtime) {
  const workspacePolicy = serializeWorkspacePolicy(runtime?.workspacePolicy);
  return {
    model: runtime?.model ?? null,
    reasoning_effort: runtime?.reasoningEffort ?? null,
    approval_policy: runtime?.approvalPolicy ?? null,
    sandbox_mode: runtime?.sandboxMode ?? null,
    dangerous_mode: runtime?.dangerousMode === true,
    additional_paths:
      workspacePolicy?.allowed_path_policy?.disabled === true
        ? []
        : workspacePolicy?.allowed_paths || [],
    search_enabled: runtime?.searchEnabled === true,
    image_input_enabled: runtime?.imageInputEnabled === true,
  };
}

// ── Auth Helpers ──────────────────────────────────────────────

/**
 * Authenticate an HTTP request via Bearer JWT (ES256 access_token from Cloud).
 * Returns decoded claims on success, or sends error response and returns null.
 */
function authenticate(req, res) {
  // Try dashboard auth first
  const dashClaims = dashboardAuthenticate(req);
  if (dashClaims) return dashClaims;

  const runtimeCapabilityClaims = authenticateRuntimeCapabilityRequest(req);
  if (runtimeCapabilityClaims) return runtimeCapabilityClaims;

  if (CONNECTION_MODE !== "cloud") {
    respond(res, 401, { error: "Authentication required" });
    return null;
  }

  // Fall back to ES256 JWT (Cloud auth)
  if (!DEVICE_SIGNING_PUBLIC_KEY) {
    respond(res, 401, { error: "Authentication required" });
    return null;
  }
  if (!DEVICE_ID) {
    respond(res, 401, { error: "Authentication required" });
    return null;
  }
  try {
    return authenticateRequest(
      req,
      DEVICE_SIGNING_PUBLIC_KEY,
      DEVICE_SIGNING_KID,
      DEVICE_ID
    );
  } catch (err) {
    respond(res, 401, { error: err.message });
    return null;
  }
}

function authenticateRuntimeCapabilityRequest(req) {
  const authMode = normalizeString(
    req.headers["x-oysterun-capability-auth"]
  );
  if (authMode?.toLowerCase() !== "runtime") return null;
  const token = getBearerToken(req);
  if (!token) return null;
  return {
    user_id: "runtime-capability",
    device_id: DEVICE_ID || "local",
    agent_ids: [],
    _runtimeCapabilityAuth: true,
    _runtimeCapabilityToken: token,
  };
}

function getCleanSessionChatAppShellClaims(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const queryTokenClaims = dashboardAuthenticateToken(
    url.searchParams.get("token")
  );
  if (queryTokenClaims) return queryTokenClaims;

  const dashClaims = dashboardAuthenticate(req);
  if (dashClaims) return dashClaims;

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  if (CONNECTION_MODE !== "cloud") {
    return null;
  }
  if (!DEVICE_SIGNING_PUBLIC_KEY || !DEVICE_ID) {
    return null;
  }

  try {
    return authenticateRequest(
      req,
      DEVICE_SIGNING_PUBLIC_KEY,
      DEVICE_SIGNING_KID,
      DEVICE_ID
    );
  } catch (err) {
    console.warn(
      `[dashboard] Clean chat shell bearer auth rejected: ${err.message}`
    );
    return null;
  }
}

function authenticateContentRequest(req, res, url, routeToken = null) {
  const queryToken = url.searchParams.get("token");
  const contentToken = routeToken || queryToken;
  let claims = dashboardAuthenticateToken(contentToken);
  if (claims) return claims;

  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7);
    claims = dashboardAuthenticateToken(bearerToken);
    if (claims) return claims;

    if (CONNECTION_MODE === "cloud" && DEVICE_SIGNING_PUBLIC_KEY && DEVICE_ID) {
      try {
        return verifyAccessToken(
          bearerToken,
          DEVICE_SIGNING_PUBLIC_KEY,
          DEVICE_SIGNING_KID,
          DEVICE_ID
        );
      } catch (err) {
        respond(res, 401, { error: err.message });
        return null;
      }
    }
  }

  if (contentToken) {
    if (
      CONNECTION_MODE !== "cloud" ||
      !DEVICE_SIGNING_PUBLIC_KEY ||
      !DEVICE_ID
    ) {
      respond(res, 401, { error: "Authentication required" });
      return null;
    }
    try {
      return verifyAccessToken(
        contentToken,
        DEVICE_SIGNING_PUBLIC_KEY,
        DEVICE_SIGNING_KID,
        DEVICE_ID
      );
    } catch (err) {
      respond(res, 401, { error: err.message });
      return null;
    }
  }

  return authenticate(req, res);
}

/**
 * Check that the JWT grants access to the given agent_id.
 * Returns true if allowed, or sends 403 and returns false.
 */
function checkAgentAccess(claims, agentId, res) {
  if (hasAgentAccess(claims, agentId)) return true;
  respond(res, 403, { error: "Access denied: not a member of this agent" });
  return false;
}

function requireAgentCapability(claims, agentId, capability, res) {
  if (hasAgentCapability(claims, agentId, capability)) return true;
  if (!hasAgentAccess(claims, agentId)) {
    respond(res, 403, { error: "Access denied: not a member of this agent" });
  } else {
    respond(res, 403, { error: `Access denied: missing ${capability}` });
  }
  return false;
}

function requireSessionCapability(claims, sessionId, capability, res) {
  if (!sessionId) {
    respond(res, 400, { error: "session_id required" });
    return null;
  }
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    respond(res, 404, { error: "Session not found" });
    return null;
  }
  if (!requireAgentCapability(claims, session.agentId, capability, res)) {
    return null;
  }
  return session;
}

function serializeWorkspacePolicy(workspacePolicy) {
  if (!workspacePolicy) return null;
  const allowedPathPolicy =
    workspacePolicy.allowedPathPolicy || workspacePolicy.allowed_path_policy || {};
  return {
    root: workspacePolicy.root,
    allowed_paths: workspacePolicy.allowedPaths.map((entry) => entry.path),
    allowed_path_entries: workspacePolicy.allowedPaths,
    allowed_path_policy: {
      disabled: allowedPathPolicy.disabled === true,
      debug_ui_enabled:
        allowedPathPolicy.debugUiEnabled === true ||
        allowedPathPolicy.debug_ui_enabled === true,
    },
  };
}

function serializePendingControlRequests(session) {
  if (!session || typeof session.getPendingControlRequests !== "function")
    return [];
  const pendingRequests = session.getPendingControlRequests();
  if (!Array.isArray(pendingRequests)) {
    throw new Error(
      `Session ${session.id} returned invalid pending control request state`
    );
  }
  return pendingRequests.map((entry) => ({
    agentId: session.agentId,
    sessionId: session.id,
    provider: session.provider || "claude",
    request_id: entry.request_id,
    subtype: entry.subtype,
    payload: entry.payload,
  }));
}

function getEffectiveProviderResumeId(session) {
  if (!session) return null;
  return session.providerResumeId || session.resumeSessionId || null;
}

function isDashboardOnly(claims) {
  return claims?._dashboardAuth === true;
}

function isRuntimeCapabilityOnly(claims) {
  return claims?._runtimeCapabilityAuth === true;
}

function requireDashboardMode(claims, res) {
  if (isDashboardOnly(claims)) return true;
  respond(res, 403, { error: "Dashboard-only endpoint" });
  return false;
}

function authenticateLocalServiceControlRequest(req) {
  if (!localServiceControlReady) return null;
  const remoteAddress = req.socket?.remoteAddress || "";
  if (!isLoopbackRemoteAddress(remoteAddress)) return null;
  const token = req.headers[LOCAL_SERVICE_CONTROL_HEADER];
  if (typeof token !== "string" || !token.trim()) return null;
  if (!verifyLocalServiceControlToken({ configDir: getConfigDir(), token })) {
    return null;
  }
  return {
    user_id: "local-service-control",
    device_id: DEVICE_ID || "local",
    agent_ids: [],
    _localServiceControlAuth: true,
  };
}

function respondRuntimeCapabilityDenied(res, status, payload = {}) {
  respond(res, status, {
    error: "Runtime capability required",
    runtime_capability_auth: true,
    raw_token_returned: false,
    ...payload,
  });
}

function requireRuntimeCapability(claims, res, { scope, sessionId, agentId }) {
  if (!isRuntimeCapabilityOnly(claims)) {
    respondRuntimeCapabilityDenied(res, 403, { reason: "not_runtime_capability_auth" });
    return null;
  }
  const normalizedScope = normalizeString(scope);
  if (!normalizedScope || AGENT_RUNTIME_CAPABILITY_BACKED_API[normalizedScope] !== true) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "runtime_capability_unbacked",
      capability_scope: normalizedScope || null,
    });
    return null;
  }
  const verification = mailStore.verifyCapabilityToken(
    claims._runtimeCapabilityToken,
    { scope: normalizedScope }
  );
  if (!verification.ok) {
    respondRuntimeCapabilityDenied(res, verification.reason === "missing_token" ? 401 : 403, {
      reason: verification.reason,
      capability_scope: normalizedScope,
    });
    return null;
  }
  const grant = verification.grant;
  if (grant.grant_kind !== "live_session") {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "grant_kind_not_live_session",
      capability_scope: normalizedScope,
    });
    return null;
  }
  const boundSessionId = normalizeString(grant?.constraints?.session_id);
  const requestedSessionId = normalizeString(sessionId);
  if (!boundSessionId) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "grant_missing_session_binding",
      capability_scope: normalizedScope,
    });
    return null;
  }
  if (requestedSessionId && requestedSessionId !== boundSessionId) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "session_scope_mismatch",
      capability_scope: normalizedScope,
    });
    return null;
  }
  const session = sessionManager.getSession(boundSessionId);
  if (!session) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "live_session_not_running",
      capability_scope: normalizedScope,
      session_id: boundSessionId,
    });
    return null;
  }
  if (session.runtimeCapabilities?.[normalizedScope] !== true) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "runtime_capability_disabled",
      capability_scope: normalizedScope,
      session_id: session.id,
    });
    return null;
  }
  const boundAgentId = normalizeString(grant.agent_id);
  const requestedAgentId = normalizeString(agentId);
  if (boundAgentId && session.agentId !== boundAgentId) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "grant_agent_session_mismatch",
      capability_scope: normalizedScope,
      session_id: session.id,
    });
    return null;
  }
  if (requestedAgentId && requestedAgentId !== session.agentId) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "agent_scope_mismatch",
      capability_scope: normalizedScope,
      session_id: session.id,
    });
    return null;
  }
  return { mode: "runtime_capability", grant, session, scope: normalizedScope };
}

function requireDashboardOrRuntimeCapability(
  claims,
  res,
  { scope, sessionId = "", agentId = "" } = {}
) {
  if (isDashboardOnly(claims)) {
    return { mode: "dashboard" };
  }
  if (isRuntimeCapabilityOnly(claims)) {
    return requireRuntimeCapability(claims, res, { scope, sessionId, agentId });
  }
  if (requireDashboardMode(claims, res)) {
    return { mode: "dashboard" };
  }
  return null;
}

function requireSessionCapabilityOrRuntimeScope(
  claims,
  sessionId,
  dashboardCapability,
  runtimeScope,
  res
) {
  if (isRuntimeCapabilityOnly(claims)) {
    const auth = requireRuntimeCapability(claims, res, {
      scope: runtimeScope,
      sessionId,
    });
    return auth?.session || null;
  }
  return requireSessionCapability(claims, sessionId, dashboardCapability, res);
}

function requireRuntimeWebsiteFolderMatchesSession(auth, body, res) {
  if (!auth || auth.mode !== "runtime_capability") return true;
  const requestedFolder =
    normalizeString(body?.agent_folder) || normalizeString(body?.agentFolder);
  if (!requestedFolder) return true;
  if (!auth.session?.cwd) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "live_session_folder_unavailable",
      session_id: auth.session?.id || null,
    });
    return false;
  }
  if (requestedFolder !== auth.session.cwd) {
    respondRuntimeCapabilityDenied(res, 403, {
      reason: "agent_folder_scope_mismatch",
      session_id: auth.session.id,
    });
    return false;
  }
  return true;
}

const WEBSITE_PASSWORD_NOT_CONFIGURED_OWNER_COPY = [
  "Website Access: password",
  "Password status: Not configured on this Host",
  "This agent is configured to require a website password, but this Host does not have the local password yet.",
  "Save the website password in .oysterun/local.json only. Do not put website passwords in .oysterun/config.json or shared agent config.",
].join("\n\n");

const WEBSITE_UNAVAILABLE_MESSAGES = Object.freeze({
  agent_folder_missing: "Agent folder is not known to this Host.",
  web_config_missing: "Agent website config is missing.",
  invalid_web_config: "Agent website config is invalid.",
  web_root_outside_agent_folder:
    "Configured website root must stay inside the agent folder.",
  web_root_missing: "Configured website root does not exist.",
  web_root_not_directory: "Configured website root is not a directory.",
  website_disabled: "Agent website is disabled.",
  index_missing: "Configured website entry index.html does not exist.",
  password_not_configured: WEBSITE_PASSWORD_NOT_CONFIGURED_OWNER_COPY,
  unavailable: "Website is unavailable.",
});

function buildUnavailableWebsiteMetadata(
  agentId,
  {
    reason,
    root = null,
    access = null,
    configured = false,
    enabled = configured === true,
    passwordConfigured = false,
  } = {}
) {
  const reasonCode = reason || "unavailable";
  const entryPath = buildAgentSiteBasePath(agentId);
  return {
    enabled: enabled === true,
    configured: configured === true,
    available: false,
    availability:
      reasonCode === "website_disabled" && configured === true
        ? "disabled"
        : configured === true
        ? "unavailable"
        : "unconfigured",
    reason: reasonCode,
    reason_message:
      WEBSITE_UNAVAILABLE_MESSAGES[reasonCode] ||
      WEBSITE_UNAVAILABLE_MESSAGES.unavailable,
    entry_path: entryPath,
    canonical_entry_path: entryPath,
    route_prefix: "/sites/",
    root,
    access,
    password_configured: passwordConfigured === true,
  };
}

function classifyWebsiteMetadataError(err) {
  const message = err?.message || "";
  if (/Unknown agent folder/.test(message)) return "agent_folder_missing";
  if (err?.code === "WEBSITE_DISABLED" || /Website is disabled/.test(message)) {
    return "website_disabled";
  }
  if (/Unsupported web\.access|web\.access must|Invalid .*config|Invalid web object|Forbidden .*web key|Invalid JSON/.test(message)) {
    return "invalid_web_config";
  }
  if (/outside the agent folder/.test(message)) {
    return "web_root_outside_agent_folder";
  }
  if (/Website root does not exist/.test(message)) return "web_root_missing";
  if (/Website root is not a directory/.test(message)) {
    return "web_root_not_directory";
  }
  return "unavailable";
}

function buildAvailableWebsiteMetadata(agentId, webConfig) {
  const entryPath = buildAgentSiteBasePath(agentId);
  return {
    enabled: true,
    configured: true,
    available: true,
    availability: "available",
    reason: null,
    reason_message: null,
    entry_path: entryPath,
    canonical_entry_path: entryPath,
    route_prefix: "/sites/",
    root: webConfig.root,
    access: webConfig.access,
    password_configured: webConfig.passwordConfigured === true,
  };
}

function buildAgentCatalogBaseEntry(agentId, record = {}, source = "registry") {
  const folderPath = record?.agent_folder || null;
  return {
    agent_id: agentId,
    display_name:
      record?.display_name || (folderPath ? basename(folderPath) : agentId),
    agent_folder: folderPath,
    last_known_session_id: record?.last_known_session_id || null,
    last_used_at: record?.last_used_at || null,
    source,
    active: false,
    ready: false,
    alive: false,
    interface_type: "coding",
    provider: "claude",
    provider_info: serializeConfiguredProvider("claude"),
    has_oysterun_config: false,
    model: null,
    reasoning_effort: null,
    permission_mode: null,
    approval_policy: null,
    sandbox_mode: null,
    allow_dangerously_skip_permissions: false,
    dangerous_mode: false,
    search_enabled: false,
    image_input_enabled: false,
    runtime_capabilities: serializeRuntimeCapabilities(),
    native: buildNativePayload(null),
    workspace_policy: null,
    website: buildAgentWebsiteMetadata(agentId, folderPath),
    provider_resume_id: null,
    provider_thread_id: null,
    provider_transport: null,
    config_path: folderPath ? join(folderPath, ".oysterun", "config.json") : null,
  };
}

function hydrateAgentCatalogEntryFromConfig(base, record = {}) {
  const folderPath = base.agent_folder;
  if (!folderPath || !existsSync(folderPath)) return base;
  try {
    const summary = summarizeAgentConfig(folderPath);
    const resolved = resolveAgentRuntimeConfig(summary.folderPath);
    return {
      ...base,
      display_name: record?.display_name || basename(summary.folderPath),
      agent_folder: summary.folderPath,
      interface_type: summary.interfaceType,
      provider: resolved.runtime.provider,
      provider_info: serializeProvider(resolved.runtime.providerInfo),
      has_oysterun_config: summary.hasConfig,
      model: resolved.runtime.model,
      reasoning_effort: resolved.runtime.reasoningEffort,
      permission_mode: resolved.runtime.permissionMode,
      approval_policy: resolved.runtime.approvalPolicy,
      sandbox_mode: resolved.runtime.sandboxMode,
      allow_dangerously_skip_permissions:
        resolved.runtime.allowDangerouslySkipPermissions === true,
      dangerous_mode: resolved.runtime.dangerousMode === true,
      search_enabled: resolved.runtime.searchEnabled === true,
      image_input_enabled: resolved.runtime.imageInputEnabled === true,
      runtime_capabilities: serializeRuntimeCapabilities(
        resolveConfiguredRuntimeCapabilities(resolved.config)
      ),
      native: buildNativePayload(resolved.runtime),
      workspace_policy: serializeWorkspacePolicy(resolved.runtime.workspacePolicy),
      config_path: summary.configPath,
      website: buildAgentWebsiteMetadata(base.agent_id, summary.folderPath),
    };
  } catch (err) {
    console.warn(
      `[agents/catalog] Failed to summarize ${folderPath}: ${err.message}`
    );
    return base;
  }
}

function buildAgentWebsiteCatalog(agents) {
  return agents
    .filter((entry) => entry.website?.configured === true)
    .map((entry) => ({
      agent_id: entry.agent_id,
      display_name: entry.display_name,
      source: entry.source,
      active: entry.active === true,
      ready: entry.ready === true,
      alive: entry.alive === true,
      last_known_session_id: entry.last_known_session_id || null,
      last_used_at: entry.last_used_at || null,
      website: entry.website,
    }));
}

function buildAgentCatalog(claims) {
  const registry = readAgentRegistry();
  const entries = new Map();

  for (const [agentId, record] of Object.entries(registry)) {
    const base = buildAgentCatalogBaseEntry(agentId, record, "registry");
    entries.set(agentId, hydrateAgentCatalogEntryFromConfig(base, record));
  }

  for (const record of getSessionHistory()) {
    const agentId =
      typeof record?.agent_id === "string" ? record.agent_id.trim() : "";
    if (!agentId || entries.has(agentId)) continue;
    const base = buildAgentCatalogBaseEntry(
      agentId,
      {
        agent_folder: record.agent_folder || null,
        display_name: record.session_name || null,
        last_known_session_id: record.session_id || null,
        last_used_at: record.last_active_at || record.created_at || null,
      },
      "history"
    );
    entries.set(agentId, hydrateAgentCatalogEntryFromConfig(base, {}));
  }

  for (const session of sessionManager.list()) {
    const providerId = session.provider || "claude";
    const providerInfo = serializeConfiguredProvider(providerId);
    const existing = entries.get(session.agentId);
    const folderPath = session.cwd || existing?.agent_folder || null;
    const overlay = {
      agent_id: session.agentId,
      display_name:
        existing?.display_name ||
        (folderPath ? basename(folderPath) : session.agentId),
      agent_folder: folderPath,
      last_known_session_id:
        session.sessionId || existing?.last_known_session_id || null,
      last_used_at: existing?.last_used_at || null,
      source: existing?.source || "live",
      active: true,
      ready: session.ready === true,
      alive: session.alive === true,
      interface_type: existing?.interface_type || "coding",
      provider: providerId,
      provider_info: providerInfo,
      has_oysterun_config: existing?.has_oysterun_config === true,
      model: session.model ?? existing?.model ?? null,
      reasoning_effort:
        session.reasoningEffort ?? existing?.reasoning_effort ?? null,
      permission_mode:
        session.permissionMode ?? existing?.permission_mode ?? null,
      approval_policy:
        session.approvalPolicy ?? existing?.approval_policy ?? null,
      sandbox_mode: session.sandboxMode ?? existing?.sandbox_mode ?? null,
      allow_dangerously_skip_permissions:
        session.allowDangerouslySkipPermissions === true,
      dangerous_mode: session.dangerousMode === true,
      search_enabled: session.searchEnabled === true,
      image_input_enabled: session.imageInputEnabled === true,
      runtime_capabilities: serializeRuntimeCapabilities(
        session.runtimeCapabilities ||
          existing?.runtime_capabilities?.capabilities ||
          DEFAULT_AGENT_RUNTIME_CAPABILITIES,
        session.runtimeCapabilityGrant || null
      ),
      native: session.native || existing?.native || buildNativePayload(null),
      workspace_policy:
        serializeWorkspacePolicy(session.workspacePolicy) ||
        existing?.workspace_policy ||
        null,
      website: buildSessionWebsiteMetadata(session),
      provider_resume_id: session.providerResumeId || null,
      provider_thread_id: session.providerThreadId || null,
      provider_transport: session.transport || null,
      config_path:
        existing?.config_path ||
        (folderPath ? join(folderPath, ".oysterun", "config.json") : null),
    };
    entries.set(
      session.agentId,
      existing ? { ...existing, ...overlay } : overlay
    );
  }

  let result = [...entries.values()];
  if (!isDashboardOnly(claims)) {
    result = result.filter((entry) =>
      claims.agent_ids.includes(entry.agent_id)
    );
  }

  result.sort((a, b) => {
    const aTime = a.last_used_at ? Date.parse(a.last_used_at) : 0;
    const bTime = b.last_used_at ? Date.parse(b.last_used_at) : 0;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return bTime - aTime || a.agent_id.localeCompare(b.agent_id);
  });

  return result;
}

function listHostKnownSchedulerAgentFolders() {
  const entries = [];
  const pushEntry = (agentId, agentFolder) => {
    const normalizedFolder = normalizeString(agentFolder);
    if (!normalizedFolder) return;
    entries.push({
      agent_id: normalizeString(agentId) || null,
      agent_folder: normalizedFolder,
    });
  };
  const registry = readAgentRegistry();
  for (const [agentId, record] of Object.entries(registry)) {
    pushEntry(agentId, record?.agent_folder);
  }
  for (const record of getSessionHistory()) {
    pushEntry(record?.agent_id, record?.agent_folder);
  }
  for (const session of sessionManager.list()) {
    pushEntry(session?.agentId || session?.agent_id, session?.cwd);
  }
  return entries;
}

function resolveDevFilePath(rawPath) {
  if (!rawPath || !rawPath.trim()) {
    throw new Error("path query param required");
  }

  const requestedPath = rawPath.trim();
  const parsedLineSuffix = parseDevFileLineSuffix(requestedPath);
  let resolvedPath = resolve(requestedPath);
  const stats = statSync(resolvedPath, { throwIfNoEntry: false });
  const effectiveLineSuffix = stats ? "" : parsedLineSuffix.lineSuffix;
  const effectiveLine = stats ? null : parsedLineSuffix.line;
  if (!stats && effectiveLineSuffix) {
    resolvedPath = resolve(parsedLineSuffix.path);
  }
  const effectiveStats = stats || statSync(resolvedPath, { throwIfNoEntry: false });
  if (!effectiveStats) {
    throw new Error(`File does not exist: ${resolvedPath}`);
  }
  if (!effectiveStats.isFile()) {
    throw new Error(`Path is not a file: ${resolvedPath}`);
  }

  const realPath = realpathSync(resolvedPath);
  return {
    resolvedPath,
    realPath,
    stats: effectiveStats,
    line: effectiveLine,
    line_suffix: effectiveLineSuffix,
    requested_path: effectiveLineSuffix ? `${realPath}${effectiveLineSuffix}` : realPath,
  };
}

function parseDevFileLineSuffix(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(.*):([1-9][0-9]*)$/);
  if (!match || !match[1]) {
    return {
      path: normalized,
      line: null,
      lineSuffix: "",
    };
  }
  return {
    path: match[1],
    line: Number(match[2]),
    lineSuffix: `:${match[2]}`,
  };
}

function readDevFilePreview(rawPath) {
  const { realPath, stats, line, line_suffix, requested_path } = resolveDevFilePath(rawPath);
  const content = readFileSync(realPath);
  const preview = classifyDevFilePreview(realPath, content);
  const textPreview =
    preview.text_available === true
      ? readDevFilePreviewText(content)
      : { truncated: false, content: "" };
  const linkAnnotations =
    preview.preview_kind === "markdown"
      ? buildLinkAnnotations({
          text: textPreview.content,
          sourceFilePath: realPath,
          resolveAgentFolderForSite: resolveAgentFolderForSite,
        })
      : [];

  return {
    path: requested_path,
    base_path: realPath,
    line,
    line_suffix,
    name: basename(realPath),
    size_bytes: stats.size,
    preview_kind: preview.preview_kind,
    content_type: preview.content_type,
    language: preview.language,
    text_available: preview.text_available,
    truncated: textPreview.truncated,
    content: textPreview.content,
    link_annotations: linkAnnotations,
    asset_root_path: preview.asset_root_path,
    asset_relative_path: preview.asset_relative_path,
    unsupported_reason: preview.unsupported_reason,
  };
}

function readDevFileTextContent(rawPath) {
  const { realPath, stats, line, line_suffix, requested_path } = resolveDevFilePath(rawPath);
  const content = readFileSync(realPath);
  const preview = classifyDevFilePreview(realPath, content);
  if (preview.text_available !== true) {
    throw new Error(
      `Text content is not available for this file: ${basename(realPath)}`
    );
  }

  return {
    path: requested_path,
    base_path: realPath,
    line,
    line_suffix,
    name: basename(realPath),
    size_bytes: stats.size,
    preview_kind: preview.preview_kind,
    content_type: preview.content_type,
    language: preview.language,
    content: content.toString("utf-8"),
  };
}

function sanitizeDevFileDownloadFilename(value) {
  const candidate = basename(String(value || "download").trim() || "download");
  const safe = candidate.replace(/[\r\n"\\]/g, "_").trim();
  return safe || "download";
}

function encodeDevFileDownloadFilename(value) {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

function buildDevFileDownload(rawPath) {
  const { realPath, stats, requested_path } = resolveDevFilePath(rawPath);
  if (stats.size > DEV_FILE_DOWNLOAD_MAX_BYTES) {
    const filename = basename(realPath);
    const err = new Error(
      `File is larger than the 50 MiB download limit: ${filename}`
    );
    err.status = 413;
    err.body = {
      error: err.message,
      code: DEV_FILE_DOWNLOAD_LIMIT_CODE,
      path: requested_path,
      size_bytes: stats.size,
      max_bytes: DEV_FILE_DOWNLOAD_MAX_BYTES,
    };
    throw err;
  }
  const filename = sanitizeDevFileDownloadFilename(realPath);
  return {
    path: requested_path,
    realPath,
    filename,
    contentType: getDevFileContentType(realPath),
    sizeBytes: stats.size,
  };
}

function respondDevFileDownload(res, download) {
  const encodedFilename = encodeDevFileDownloadFilename(download.filename);
  const stream = createReadStream(download.realPath);
  stream.on("error", (err) => {
    console.error("[oysterun-host] Failed to stream dev file download", err);
    if (!res.headersSent) {
      respond(res, 500, { error: "Failed to stream file download" });
      return;
    }
    res.destroy(err);
  });
  res.writeHead(200, {
    "Content-Type": download.contentType || "application/octet-stream",
    "Content-Length": String(download.sizeBytes),
    "Content-Disposition": `attachment; filename="${download.filename}"; filename*=UTF-8''${encodedFilename}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  stream.pipe(res);
}

function isProbablyTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return true;
  const maxBytes = Math.min(buffer.length, DEV_FILE_TEXT_SNIFF_BYTES);
  let suspiciousBytes = 0;
  for (let index = 0; index < maxBytes; index += 1) {
    const value = buffer[index];
    if (value === 0) {
      return false;
    }
    const isAllowedControl =
      value === 9 || value === 10 || value === 13 || value === 27;
    if (!isAllowedControl && value < 32) {
      suspiciousBytes += 1;
    }
  }
  return suspiciousBytes / maxBytes < 0.05;
}

function readDevFilePreviewText(buffer) {
  const previewBuffer = buffer.subarray(0, DEV_FILE_PREVIEW_MAX_BYTES);
  return {
    truncated: buffer.length > DEV_FILE_PREVIEW_MAX_BYTES,
    content: previewBuffer.toString("utf-8"),
  };
}

function getDevFileLanguage(realPath) {
  const extension = extname(realPath).toLowerCase();
  if (
    Object.prototype.hasOwnProperty.call(
      DEV_FILE_CODE_LANGUAGE_BY_EXTENSION,
      extension
    )
  ) {
    return DEV_FILE_CODE_LANGUAGE_BY_EXTENSION[extension];
  }
  const lowerBasename = basename(realPath).toLowerCase();
  if (
    Object.prototype.hasOwnProperty.call(
      DEV_FILE_CODE_LANGUAGE_BY_BASENAME,
      lowerBasename
    )
  ) {
    return DEV_FILE_CODE_LANGUAGE_BY_BASENAME[lowerBasename];
  }
  return null;
}

function getDevFileContentType(realPath, buffer = null) {
  const extension = extname(realPath).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(DEV_FILE_CONTENT_TYPES, extension)) {
    return DEV_FILE_CONTENT_TYPES[extension];
  }
  if (buffer && isProbablyTextBuffer(buffer)) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

function classifyDevFilePreview(realPath, buffer) {
  const extension = extname(realPath).toLowerCase();
  if (DEV_FILE_MARKDOWN_EXTENSIONS.has(extension)) {
    return {
      preview_kind: "markdown",
      content_type: getDevFileContentType(realPath, buffer),
      language: "markdown",
      text_available: true,
      asset_root_path: dirname(realPath),
      asset_relative_path: basename(realPath),
      unsupported_reason: null,
    };
  }
  if (DEV_FILE_HTML_EXTENSIONS.has(extension)) {
    return {
      preview_kind: "html",
      content_type: getDevFileContentType(realPath, buffer),
      language: "html",
      text_available: true,
      asset_root_path: dirname(realPath),
      asset_relative_path: basename(realPath),
      unsupported_reason: null,
    };
  }
  if (DEV_FILE_IMAGE_EXTENSIONS.has(extension)) {
    return {
      preview_kind: "image",
      content_type: getDevFileContentType(realPath, buffer),
      language: null,
      text_available: false,
      asset_root_path: dirname(realPath),
      asset_relative_path: basename(realPath),
      unsupported_reason: null,
    };
  }
  const language = getDevFileLanguage(realPath);
  if (language) {
    return {
      preview_kind: "code",
      content_type: getDevFileContentType(realPath, buffer),
      language,
      text_available: true,
      asset_root_path: null,
      asset_relative_path: null,
      unsupported_reason: null,
    };
  }
  if (DEV_FILE_TEXT_EXTENSIONS.has(extension) || isProbablyTextBuffer(buffer)) {
    return {
      preview_kind: "text",
      content_type: getDevFileContentType(realPath, buffer),
      language: null,
      text_available: true,
      asset_root_path: null,
      asset_relative_path: null,
      unsupported_reason: null,
    };
  }
  return {
    preview_kind: "unsupported",
    content_type: getDevFileContentType(realPath, buffer),
    language: null,
    text_available: false,
    asset_root_path: null,
    asset_relative_path: null,
    unsupported_reason: `Binary file preview is not supported: ${basename(
      realPath
    )}`,
  };
}

function decodeRoutePath(pathname) {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function readDevFsAsset(rawRootKey, rawRelativePath) {
  if (!rawRootKey || !rawRootKey.trim()) {
    throw new Error("root path key required");
  }
  if (!rawRelativePath || !rawRelativePath.trim()) {
    throw new Error("relative path required");
  }

  const rootPath = resolve(decodeURIComponent(rawRootKey));
  const rootStats = statSync(rootPath, { throwIfNoEntry: false });
  if (!rootStats) {
    const err = new Error(`Preview root does not exist: ${rootPath}`);
    err.code = "ENOENT";
    throw err;
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Preview root is not a directory: ${rootPath}`);
  }

  const realRootPath = realpathSync(rootPath);
  const relativePath = decodeRoutePath(rawRelativePath);
  const requestedPath = resolve(realRootPath, relativePath);
  const requestedStats = statSync(requestedPath, { throwIfNoEntry: false });
  if (!requestedStats) {
    const err = new Error(`Preview asset does not exist: ${requestedPath}`);
    err.code = "ENOENT";
    throw err;
  }
  if (!requestedStats.isFile()) {
    throw new Error(`Preview asset is not a file: ${requestedPath}`);
  }

  const realFilePath = realpathSync(requestedPath);
  if (
    realFilePath !== realRootPath &&
    !realFilePath.startsWith(`${realRootPath}/`)
  ) {
    throw new Error("Preview asset is outside the allowed root");
  }

  const content = readFileSync(realFilePath);
  return {
    path: realFilePath,
    contentType: getDevFileContentType(realFilePath, content),
    content,
  };
}

async function readFormBody(req) {
  const buffer = await readRawBody(req);
  const params = new URLSearchParams(buffer.toString("utf-8"));
  const body = {};
  for (const [key, value] of params.entries()) {
    body[key] = value;
  }
  return body;
}

function parseServedSiteRoute(routePrefix, pathname) {
  if (!pathname.startsWith(routePrefix)) return null;
  const routeRemainder = pathname.slice(routePrefix.length);
  if (!routeRemainder) {
    return { error: "agent_id path segment required" };
  }

  const [rawAgentId, ...remainingParts] = routeRemainder.split("/");
  if (!rawAgentId) {
    return { error: "agent_id path segment required" };
  }

  return {
    agentId: decodeURIComponent(rawAgentId),
    rawRelativePath: remainingParts.join("/"),
  };
}

function parseAgentSiteRoute(pathname) {
  return parseServedSiteRoute("/sites/", pathname);
}

function resolveAgentFolderForSite(agentId) {
  const registeredFolder = getAgentFolder(agentId);
  if (registeredFolder) return registeredFolder;
  const liveSession = sessionManager.getAgentSession(agentId);
  return liveSession?.cwd || null;
}

function resolveSiteRoot(agentFolder, agentId, options = {}) {
  if (!agentFolder) {
    const err = new Error(`Unknown agent folder for ${agentId}`);
    err.code = "ENOENT";
    throw err;
  }

  const agentRoot = realpathSync(agentFolder);
  const webConfig = resolveAgentWebConfig(agentRoot);
  if (
    webConfig.enabled !== true &&
    options.allowInferredDisabledMetadataProbe !== true
  ) {
    const err = new Error("Website is disabled");
    err.code = "WEBSITE_DISABLED";
    throw err;
  }
  const configuredRoot = resolve(agentRoot, webConfig.root);
  if (
    configuredRoot !== agentRoot &&
    !configuredRoot.startsWith(`${agentRoot}/`)
  ) {
    throw new Error(
      `Configured web.root is outside the agent folder: ${webConfig.root}`
    );
  }

  const rootStats = statSync(configuredRoot, { throwIfNoEntry: false });
  if (!rootStats) {
    const err = new Error(`Website root does not exist: ${configuredRoot}`);
    err.code = "ENOENT";
    throw err;
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Website root is not a directory: ${configuredRoot}`);
  }

  const realRootPath = realpathSync(configuredRoot);
  if (realRootPath !== agentRoot && !realRootPath.startsWith(`${agentRoot}/`)) {
    throw new Error(
      `Resolved website root is outside the agent folder: ${realRootPath}`
    );
  }

  return {
    agentRoot,
    rootPath: realRootPath,
    web: webConfig,
  };
}

function resolveSiteAsset(rootPath, rawRelativePath, pathname, urlSearch = "") {
  const decodedRelativePath = rawRelativePath
    ? decodeRoutePath(rawRelativePath)
    : "";
  if (!decodedRelativePath && !pathname.endsWith("/")) {
    return { redirectTo: `${pathname}/${urlSearch}` };
  }

  const requestedPath = decodedRelativePath
    ? resolve(rootPath, decodedRelativePath)
    : rootPath;
  if (requestedPath !== rootPath && !requestedPath.startsWith(`${rootPath}/`)) {
    throw new Error("Website asset is outside the allowed root");
  }

  const requestedStats = statSync(requestedPath, { throwIfNoEntry: false });
  if (!requestedStats) {
    const err = new Error(`Website asset does not exist: ${requestedPath}`);
    err.code = "ENOENT";
    throw err;
  }

  if (requestedStats.isDirectory()) {
    if (!pathname.endsWith("/")) {
      return { redirectTo: `${pathname}/${urlSearch}` };
    }
    const indexPath = join(requestedPath, "index.html");
    const indexStats = statSync(indexPath, { throwIfNoEntry: false });
    if (!indexStats || !indexStats.isFile()) {
      const err = new Error(`Website entry does not exist: ${indexPath}`);
      err.code = "ENOENT";
      throw err;
    }
    const realFilePath = realpathSync(indexPath);
    if (realFilePath !== rootPath && !realFilePath.startsWith(`${rootPath}/`)) {
      throw new Error("Website asset is outside the allowed root");
    }
    const content = readFileSync(realFilePath);
    return {
      path: realFilePath,
      contentType: getDeliverableContentType(realFilePath, content),
      content,
    };
  }

  if (!requestedStats.isFile()) {
    throw new Error(`Website asset is not a file: ${requestedPath}`);
  }

  const realFilePath = realpathSync(requestedPath);
  if (realFilePath !== rootPath && !realFilePath.startsWith(`${rootPath}/`)) {
    throw new Error("Website asset is outside the allowed root");
  }

  const content = readFileSync(realFilePath);
  return {
    path: realFilePath,
    contentType: getDeliverableContentType(realFilePath, content),
    content,
  };
}

function buildAgentWebsiteMetadata(agentId, folderPath = null) {
  const resolvedFolder = folderPath || resolveAgentFolderForSite(agentId);
  if (!resolvedFolder) {
    return buildUnavailableWebsiteMetadata(agentId, {
      reason: "agent_folder_missing",
    });
  }

  try {
    const layers = readAgentConfigLayers(resolvedFolder);
    const sharedWebConfigured = Object.prototype.hasOwnProperty.call(
      layers.sharedConfig || {},
      "web"
    );
    const sharedWeb = isPlainObject(layers.sharedConfig?.web)
      ? layers.sharedConfig.web
      : {};
    const hasExplicitSharedWebEnabled =
      Object.prototype.hasOwnProperty.call(sharedWeb, "enabled");
    const webConfig = layers.web;
    const configured = sharedWebConfigured || webConfig.enabled === true;
    if (hasExplicitSharedWebEnabled && sharedWeb.enabled !== true) {
      return buildUnavailableWebsiteMetadata(agentId, {
        reason: "website_disabled",
        root: webConfig.root,
        access: webConfig.access,
        configured: true,
        enabled: false,
        passwordConfigured: webConfig.passwordConfigured,
      });
    }
    if (webConfig.enabled !== true && !configured) {
      return buildUnavailableWebsiteMetadata(agentId, {
        reason: "web_config_missing",
        root: webConfig.root,
        access: webConfig.access,
        configured: false,
        enabled: false,
        passwordConfigured: webConfig.passwordConfigured,
      });
    }

    const site = resolveSiteRoot(resolvedFolder, agentId, {
      allowInferredDisabledMetadataProbe:
        configured === true && hasExplicitSharedWebEnabled === false,
    });
    const indexPath = join(site.rootPath, "index.html");
    const available =
      statSync(indexPath, { throwIfNoEntry: false })?.isFile() === true;
    if (!available) {
      return buildUnavailableWebsiteMetadata(agentId, {
        reason: "index_missing",
        root: site.web.root,
        access: site.web.access,
        configured: true,
        enabled: site.web.enabled === true,
        passwordConfigured: site.web.passwordConfigured,
      });
    }
    if (site.web.access === "password" && !site.web.passwordConfigured) {
      return buildUnavailableWebsiteMetadata(agentId, {
        reason: "password_not_configured",
        root: site.web.root,
        access: site.web.access,
        configured: true,
        enabled: site.web.enabled === true,
        passwordConfigured: false,
      });
    }
    return buildAvailableWebsiteMetadata(agentId, site.web);
  } catch (err) {
    const reason = classifyWebsiteMetadataError(err);
    console.warn(
      `[website/metadata] ${agentId} unavailable: ${reason}: ${err.message}`
    );
    let configured = false;
    let root = null;
    let access = null;
    let enabled = false;
    let passwordConfigured = false;
    try {
      const layers = readAgentConfigLayers(resolvedFolder);
      configured = Object.prototype.hasOwnProperty.call(
        layers.sharedConfig || {},
        "web"
      ) || layers.web.enabled === true;
      root = layers.web.root;
      access = layers.web.access;
      enabled = layers.web.enabled === true;
      passwordConfigured = layers.web.passwordConfigured;
    } catch (readErr) {
      console.warn(
        `[website/metadata] ${agentId} config unavailable: ${readErr.message}`
      );
    }
    return buildUnavailableWebsiteMetadata(agentId, {
      reason,
      root,
      access,
      configured,
      enabled,
      passwordConfigured,
    });
  }
}

function buildSessionWebsiteMetadata(session) {
  const metadata = buildAgentWebsiteMetadata(
    session?.agentId || null,
    session?.cwd || null
  );
  const accessOverride = normalizeString(session?.websiteAccessOverride);
  const enabledOverride =
    typeof session?.websiteEnabledOverride === "boolean"
      ? session.websiteEnabledOverride
      : null;
  const base = {
    ...metadata,
    current_session_only: Boolean(accessOverride || enabledOverride !== null),
    live_session_access_override: Boolean(accessOverride),
    live_session_enabled_override: enabledOverride !== null,
    config_backed_access: metadata.access || null,
    config_backed_enabled: metadata.enabled === true,
  };
  const withAccess = accessOverride ? { ...base, access: accessOverride } : base;
  if (enabledOverride === false) {
    return {
      ...withAccess,
      enabled: false,
      available: false,
      availability: "disabled",
      reason: "website_disabled",
      reason_message: WEBSITE_UNAVAILABLE_MESSAGES.website_disabled,
    };
  }
  if (enabledOverride === true) {
    return {
      ...withAccess,
      enabled: true,
      reason: withAccess.available === true ? null : withAccess.reason,
    };
  }
  if (!accessOverride) {
    return base;
  }
  return {
    ...withAccess,
  };
}

const P86_PRODUCT_CLI_ENDPOINT_CONTRACT = "p86_product_cli_host_endpoint_v1";
const P94_AGENT_SITE_TEMPLATE_PATH = join(
  __dirname,
  "templates",
  "agent-site",
  "index.html"
);

function readJsonObjectIfPresent(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return {};
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object at ${path}`);
  }
  return parsed;
}

function resolveP86WebsiteAgentFolder(agentId, body = {}) {
  const requestedFolder =
    normalizeString(body.agent_folder) || normalizeString(body.agentFolder);
  const session = sessionManager.getAgentSession(agentId);
  const folder = requestedFolder || session?.cwd || getAgentFolder(agentId);
  if (!folder) {
    throw new Error(
      "agent_folder is required when no running session or registered folder exists"
    );
  }
  return folder;
}

function persistP86WebsiteAgentFolder(agentId, body = {}) {
  const requestedFolder =
    normalizeString(body.agent_folder) || normalizeString(body.agentFolder);
  if (requestedFolder) {
    setAgentFolder(agentId, requestedFolder);
  }
}

function buildP86WebsiteStatusPayload(agentId, folder) {
  return {
    status: "website_status",
    contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
    agent_id: agentId,
    agent_folder: folder,
    website: buildAgentWebsiteMetadata(agentId, folder),
    raw_local_path_returned: false,
  };
}

function readP94AgentSiteTemplate() {
  return readFileSync(P94_AGENT_SITE_TEMPLATE_PATH, "utf-8");
}

function ensureP94AgentWebsiteScaffold({
  agentId,
  folder,
  access = "owner_only",
  persistConfig = false,
  createAssetsDir = false,
  dryRun = false,
  status = dryRun ? "website_scaffold_dry_run" : "website_scaffolded",
  contract = null,
}) {
  const normalizedAccess = normalizeAgentWebAccess(access || "owner_only");
  const configDir = join(folder, ".oysterun");
  const siteDir = join(configDir, "site");
  const assetsDir = join(siteDir, "assets");
  const configPath = join(configDir, "config.json");
  const indexPath = join(siteDir, "index.html");
  const plan = {
    status,
    ...(contract ? { contract } : {}),
    agent_id: agentId,
    agent_folder: folder,
    config_path: configPath,
    site_root: ".oysterun/site",
    ...(createAssetsDir ? { assets_dir: assetsDir } : {}),
    index_path: indexPath,
    template_path: P94_AGENT_SITE_TEMPLATE_PATH,
    access: normalizedAccess,
    web_enabled: true,
    overwrite_existing_index: false,
    delete_existing_site_files: false,
  };
  if (dryRun) return plan;

  mkdirSync(createAssetsDir ? assetsDir : siteDir, { recursive: true });
  let indexCreated = false;
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, readP94AgentSiteTemplate(), "utf-8");
    indexCreated = true;
  }
  if (persistConfig === true) {
    const config = readJsonObjectIfPresent(configPath);
    config.web = {
      ...(config.web || {}),
      root: ".oysterun/site",
      access: normalizedAccess,
      enabled: true,
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  }
  return {
    ...plan,
    index_created: indexCreated,
    website: buildAgentWebsiteMetadata(agentId, folder),
  };
}

function applyP86WebsiteScaffold({ agentId, folder, access, dryRun = false }) {
  const result = ensureP94AgentWebsiteScaffold({
    agentId,
    folder,
    access,
    persistConfig: !dryRun,
    createAssetsDir: true,
    dryRun,
    status: dryRun ? "website_init_dry_run" : "website_initialized",
    contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
  });
  if (!dryRun) {
    setAgentFolder(agentId, folder);
  }
  return result;
}

function buildP86TelegramStatusPayload() {
  const sessions = sessionManager.list().map((summary) => {
    const liveSession = sessionManager.getSession(summary.sessionId);
    return {
      session_id: summary.sessionId,
      agent_id: summary.agentId,
      telegram: serializeAgentTelegramConfig(liveSession?.telegramConfig || {}),
      telegram_runtime: buildSessionTelegramRuntimeStatusPayload(liveSession),
      token_redacted: true,
      allowed_users_redacted: true,
    };
  });
  return {
    status: "telegram_status",
    contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
    setup_owner: "per_session",
    telegram_enabled_default: false,
    sessions,
  };
}

function applySessionWebsiteAccessRequest(session, body = {}) {
  if (
    !session ||
    (!Object.prototype.hasOwnProperty.call(body, "web_access") &&
      !Object.prototype.hasOwnProperty.call(body, "webAccess") &&
      !hasAgentWebEnabledRequest(body))
  ) {
    return;
  }
  const hasAccessRequest =
    Object.prototype.hasOwnProperty.call(body, "web_access") ||
    Object.prototype.hasOwnProperty.call(body, "webAccess");
  const requestedAccess = hasAccessRequest
    ? normalizeAgentWebAccess(body.web_access ?? body.webAccess)
    : null;
  const requestedEnabled = hasAgentWebEnabledRequest(body)
    ? normalizeAgentWebEnabled(body.web_enabled ?? body.webEnabled)
    : null;
  const configAlreadyUpdated =
    body.update_config === true ||
    body.persist_config === true ||
    body.persist_shared_config === true;
  if (configAlreadyUpdated) {
    if (hasAccessRequest) delete session.websiteAccessOverride;
    if (requestedEnabled !== null) delete session.websiteEnabledOverride;
    return;
  }
  if (hasAccessRequest) session.websiteAccessOverride = requestedAccess;
  if (requestedEnabled !== null) {
    session.websiteEnabledOverride = requestedEnabled;
  }
}

function ensureRequestedWebsiteScaffoldBeforeSession({
  agentId,
  folder,
  body = {},
  resolved,
}) {
  const requestedWebsiteEnabled = hasAgentWebEnabledRequest(body)
    ? normalizeAgentWebEnabled(body.web_enabled ?? body.webEnabled)
    : resolved?.layers?.web?.enabled === true;
  if (requestedWebsiteEnabled !== true) return null;
  return ensureP94AgentWebsiteScaffold({
    agentId,
    folder,
    access:
      body.web_access ??
      body.webAccess ??
      resolved?.layers?.web?.access ??
      "owner_only",
    persistConfig: false,
  });
}

function getDeliverableContentType(realPath, buffer = null) {
  const extension = extname(realPath).toLowerCase();
  if (
    Object.prototype.hasOwnProperty.call(DELIVERABLE_CONTENT_TYPES, extension)
  ) {
    return DELIVERABLE_CONTENT_TYPES[extension];
  }
  if (buffer && isProbablyTextBuffer(buffer)) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

const ROUTEC_REQUEST_TRAFFIC_SAFE_QUERY_VALUES = new Set([
  "dir",
  "limit",
  "timeout",
]);

const ROUTEC_REQUEST_TRAFFIC_SENSITIVE_QUERY_KEYS = [
  "access_token",
  "authorization",
  "cookie",
  "jwt",
  "password",
  "secret",
  "token",
];

const ROUTEC_REQUEST_TRAFFIC_LOG_BATCH_MAX_RECORDS = 50;
const ROUTEC_REQUEST_TRAFFIC_LOG_FLUSH_DELAY_MS = 250;
const routeCRequestTrafficLogQueues = new Map();

function classifyRouteCRequestTrafficEndpoint(method, requestPath) {
  if (requestPath === "/_matrix/client/v3/sync") return "matrix_sync";
  if (/^\/_matrix\/client\/v3\/rooms\/[^/]+\/messages$/.test(requestPath)) {
    return "matrix_room_messages";
  }
  if (requestPath.startsWith("/_matrix/")) return "matrix_facade";
  if (
    requestPath === "/routec/matrix/host-scoped-cinny-session-bootstrap"
  ) {
    return "matrix_bootstrap";
  }
  if (requestPath === "/session/snapshot") return "session_snapshot";
  if (requestPath === "/session/messages") return "session_messages";
  if (requestPath === "/session/status") return "session_status";
  if (requestPath === "/session/chat-binding") return "session_chat_binding";
  if (requestPath === "/session/start") return "session_start";
  if (requestPath === "/session/send") return "session_send";
  if (requestPath === "/session/stop") return "session_stop";
  if (requestPath === "/sessions/history") return "sessions_history";
  if (requestPath === "/sessions") return "sessions";
  if (/^\/app\/sessions\/[^/]+\/chat\/?$/.test(requestPath)) {
    return "chat_shell_document";
  }
  if (requestPath === "/app" || requestPath === "/app/") return "app_shell";
  if (requestPath.startsWith("/app/chat-assets/")) return "chat_asset";
  if (requestPath.startsWith("/static/")) return "static_asset";
  return method ? `${method.toLowerCase()}_request` : "request";
}

function buildRouteCRequestTrafficQuerySummary(url) {
  const summary = {};
  for (const [key, value] of url.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (
      ROUTEC_REQUEST_TRAFFIC_SENSITIVE_QUERY_KEYS.some((sensitiveKey) =>
        normalizedKey.includes(sensitiveKey)
      )
    ) {
      summary[`${key}_present`] = true;
      continue;
    }
    if (ROUTEC_REQUEST_TRAFFIC_SAFE_QUERY_VALUES.has(normalizedKey)) {
      summary[key] = value.slice(0, 80);
      continue;
    }
    summary[`${key}_present`] = true;
    summary[`${key}_length`] = value.length;
  }
  return summary;
}

function getRouteCRequestTrafficChunkBytes(chunk, encoding) {
  if (chunk === null || chunk === undefined || typeof chunk === "function") {
    return 0;
  }
  if (Buffer.isBuffer(chunk)) return chunk.length;
  if (typeof chunk === "string") {
    return Buffer.byteLength(
      chunk,
      typeof encoding === "string" ? encoding : "utf8"
    );
  }
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  return 0;
}

function getRouteCRequestTrafficLogQueue(logPath) {
  let queue = routeCRequestTrafficLogQueues.get(logPath);
  if (!queue) {
    queue = {
      records: [],
      flushTimer: null,
      flushing: false,
    };
    routeCRequestTrafficLogQueues.set(logPath, queue);
  }
  return queue;
}

function flushRouteCRequestTrafficQueue(logPath) {
  const queue = routeCRequestTrafficLogQueues.get(logPath);
  if (!queue || queue.flushing) return;
  if (queue.flushTimer) {
    clearTimeout(queue.flushTimer);
    queue.flushTimer = null;
  }
  if (!queue.records.length) return;
  const records = queue.records.splice(0, ROUTEC_REQUEST_TRAFFIC_LOG_BATCH_MAX_RECORDS);
  const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  queue.flushing = true;
  appendFile(logPath, payload, "utf8", (err) => {
    queue.flushing = false;
    if (err) {
      console.error(
        `[routec-request-traffic] failed to write diagnostics: ${err.message}`
      );
    }
    if (queue.records.length >= ROUTEC_REQUEST_TRAFFIC_LOG_BATCH_MAX_RECORDS) {
      flushRouteCRequestTrafficQueue(logPath);
      return;
    }
    if (queue.records.length) {
      scheduleRouteCRequestTrafficFlush(logPath, queue);
    }
  });
}

function scheduleRouteCRequestTrafficFlush(logPath, queue) {
  if (queue.flushTimer) return;
  queue.flushTimer = setTimeout(() => {
    queue.flushTimer = null;
    flushRouteCRequestTrafficQueue(logPath);
  }, ROUTEC_REQUEST_TRAFFIC_LOG_FLUSH_DELAY_MS);
  if (typeof queue.flushTimer.unref === "function") {
    queue.flushTimer.unref();
  }
}

function appendRouteCRequestTrafficRecord(logPath, record) {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const queue = getRouteCRequestTrafficLogQueue(logPath);
    queue.records.push(record);
    if (
      !queue.flushing &&
      queue.records.length >= ROUTEC_REQUEST_TRAFFIC_LOG_BATCH_MAX_RECORDS
    ) {
      flushRouteCRequestTrafficQueue(logPath);
      return;
    }
    scheduleRouteCRequestTrafficFlush(logPath, queue);
  } catch (err) {
    console.error(
      `[routec-request-traffic] failed to queue diagnostics: ${err.message}`
    );
  }
}

function isRouteCChatLivenessDiagnosticsEnabled() {
  return readConfig().debug_routec_chat_liveness_diagnostics_enabled === true;
}

function attachRouteCRequestTrafficLogger(req, res, url, requestPath) {
  if (!isRouteCChatLivenessDiagnosticsEnabled()) return;
  const logPath = normalizeString(
    process.env.OYSTERUN_ROUTEC_REQUEST_TRAFFIC_LOG_PATH
  );
  if (!logPath) return;

  const startedAt = new Date();
  const startedMs = Date.now();
  const startedCpuUsage = process.cpuUsage();
  const startedEventLoopUtilization = performance.eventLoopUtilization();
  const requestId = randomUUID();
  const endpoint = classifyRouteCRequestTrafficEndpoint(
    req.method,
    requestPath
  );
  const query = buildRouteCRequestTrafficQuerySummary(url);
  let responseBytes = 0;
  let logged = false;

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = function writeWithRouteCTrafficBytes(chunk, encoding, callback) {
    responseBytes += getRouteCRequestTrafficChunkBytes(chunk, encoding);
    return originalWrite(chunk, encoding, callback);
  };

  res.end = function endWithRouteCTrafficBytes(chunk, encoding, callback) {
    responseBytes += getRouteCRequestTrafficChunkBytes(chunk, encoding);
    return originalEnd(chunk, encoding, callback);
  };

  const writeRecord = (event) => {
    if (logged) return;
    logged = true;
    const endedAt = new Date();
    const cpuUsage = process.cpuUsage(startedCpuUsage);
    const eventLoopUtilization = performance.eventLoopUtilization(
      startedEventLoopUtilization
    );
    appendRouteCRequestTrafficRecord(logPath, {
      schema: "routec.request_traffic.v1",
      request_id: requestId,
      event,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_ms: Date.now() - startedMs,
      method: req.method,
      endpoint,
      path: requestPath,
      query,
      status_code: res.statusCode || null,
      response_bytes: responseBytes,
      writable_ended: Boolean(res.writableEnded),
      request_aborted: Boolean(req.aborted),
      p135_host_liveness_diagnostics: true,
      process_cpu_user_us: cpuUsage.user,
      process_cpu_system_us: cpuUsage.system,
      event_loop_utilization: {
        idle_ms: Number(eventLoopUtilization.idle.toFixed(3)),
        active_ms: Number(eventLoopUtilization.active.toFixed(3)),
        utilization: Number(eventLoopUtilization.utilization.toFixed(6)),
      },
      raw_request_body_logged: false,
      raw_response_body_logged: false,
      stack_name: getActiveStackName(),
      port: PORT,
    });
  };

  res.once("finish", () => writeRecord("finish"));
  res.once("close", () => writeRecord("close"));
}

// ── HTTP Routes ──────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS headers for browser clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Oysterun-RouteC, X-Oysterun-Service-Control-Token"
  );

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  attachRouteCRequestTrafficLogger(req, res, url, path);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── GET /health (no auth required) ─────────────────────
    if (req.method === "GET" && path === "/health") {
      const matrixStorage = checkRouteCMatrixStorageHealth();
      const healthy = matrixStorage.status === "ok";

      return respond(res, 200, {
        status: healthy ? "ok" : "degraded",
        connection_mode: CONNECTION_MODE,
        sessions: sessionManager.sessions.size,
        tunnel: tunnelAgent ? {
          provider: TUNNEL_PROVIDER,
          alive: tunnelAgent.alive,
          publicUrl: tunnelAgent.publicUrl,
        } : null,
        device_id: DEVICE_ID,
        matrix_storage: matrixStorage,
      });
    }

    // ── GET /static/* (serves web client static assets) ────────────
    if (req.method === "GET" && path.startsWith("/static/")) {
      if (serveStaticAsset(req, res, path)) {
        return;
      }
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end("Static asset not found");
      return;
    }

    if (req.method === "GET" && path === "/app/oysterun-notifications-sw.js") {
      return serveDashboardNotificationServiceWorker(req, res);
    }

    if (req.method === "GET" && path === WEB_CHAT_STATIC_PREWARM_MANIFEST_PATH) {
      return serveWebChatStaticPrewarmManifest(req, res);
    }

    // ── GET /app/chat-assets/* (normal internal web-chat asset base) ──
    if (req.method === "GET" && path.startsWith(WEB_CHAT_ASSET_BASE_PATH)) {
      if (serveWebChatAppAsset(req, res, path)) {
        return;
      }
      return respondText(res, 404, "Web chat asset not found", {
        "Cache-Control": "no-store",
        "X-Oysterun-Web-Chat-Asset": "not-found",
        "X-Oysterun-Web-Chat-Asset-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
      });
    }

    // ── GET /route-c root (legacy product entry, no normal app document) ──
    if (req.method === "GET" && isLegacyRouteCRootPath(path)) {
      return redirect(res, 308, LEGACY_ROUTE_C_ROOT_REDIRECT_LOCATION, {
        "Cache-Control": "no-store",
        "X-Oysterun-Legacy-RouteC-Root": "app-sessions",
        "X-Oysterun-Web-Chat-Asset-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
      });
    }

    // ── GET /route-c/* (concrete stale asset compatibility only) ──
    if (req.method === "GET" && path.startsWith(LEGACY_ROUTE_C_ASSET_BASE_PATH)) {
      if (
        serveWebChatAppAsset(req, res, path, {
          basePath: LEGACY_ROUTE_C_ASSET_BASE_PATH,
          legacyRouteCAsset: true,
        })
      ) {
        return;
      }
      return respondText(res, 404, "Legacy Route C asset not found", {
        "Cache-Control": "no-store",
        "X-Oysterun-Legacy-RouteC-Asset": "not-found",
        "X-Oysterun-Web-Chat-Asset-Base-Path": WEB_CHAT_ASSET_BASE_PATH,
      });
    }

    // ── GET /app/sessions/:session_id/chat (serves Route C shell behind clean URL) ──
    if (req.method === "GET" && isCleanSessionChatAppShellPath(path)) {
      const cleanChatClaims = getCleanSessionChatAppShellClaims(req);
      if (!cleanChatClaims) {
        return serveDashboardHtml(req, res, {
          "X-Oysterun-Clean-Chat-Auth-Guard": "dashboard-login-required",
          "X-Oysterun-Clean-Chat-Shell": "dashboard-login",
        });
      }
      const cleanChatSessionId = getCleanSessionChatAppShellSessionId(path);
      if (!cleanChatSessionId || !sessionManager.getSession(cleanChatSessionId)) {
        return redirect(
          res,
          303,
          buildStaleCleanSessionChatRedirectLocation(),
          {
            "Cache-Control": "no-store",
            "X-Oysterun-Clean-Chat-Stale-Redirect": "sessions",
            "X-Oysterun-Clean-Chat-Shell": "stale-session-redirect",
          }
        );
      }
      return serveWebChatAppDocument(req, res);
    }

    // ── GET /.well-known/matrix/client (exact public Route C Host-origin discovery only) ──
    if (req.method === "GET" && path === "/.well-known/matrix/client") {
      return serveRouteCWellKnownMatrixClient(req, res);
    }

    // ── GET /app* (serves dashboard HTML, no auth — login page is in the HTML) ──
    if (
      req.method === "GET" &&
      (path === "/app" || path === "/app/" || path.startsWith("/app/"))
    ) {
      serveDashboardHtml(req, res);
      return;
    }

    // Deprecated/forbidden P16.2 upload routes: retained only to reject legacy callers.
    if (path === "/session/uploads" || path === "/session/uploads/content") {
      return respondDeprecatedSessionUploadsRoute(res);
    }

    if (req.method === "GET" && path.startsWith("/browser-handoff/")) {
      const rawToken = path.slice("/browser-handoff/".length);
      const token = normalizeString(rawToken);
      if (!token || token.includes("/")) {
        return respondText(res, 400, "Invalid browser handoff token", {
          "Cache-Control": "no-store",
        });
      }
      const record = consumeBrowserHandoffToken(token);
      if (!record) {
        return respondText(
          res,
          410,
          "Browser handoff link is invalid or expired",
          {
            "Cache-Control": "no-store",
          }
        );
      }
      const siteToken = createDeliverableSession(record.agentId);
      return redirect(res, 302, record.targetPath, {
        "Cache-Control": "no-store",
        "Set-Cookie": buildServedSitePasswordCookie(
          record.routePrefix,
          siteToken,
          record.agentId
        ),
      });
    }

    if (path === "/deliverables" || path.startsWith("/deliverables/")) {
      return respondText(
        res,
        404,
        "Website route removed; use /sites/<agent_id>/"
      );
    }

    if (path.startsWith("/sites/")) {
      const routePrefix = "/sites/";
      const route = parseAgentSiteRoute(path);
      if (!route || route.error) {
        return respondText(res, 400, route?.error || "Invalid website route");
      }

      const { agentId, rawRelativePath } = route;
      const basePath = buildServedSiteBasePath(routePrefix, agentId);
      const requestedPath = `${path}${url.search}`;
      const wantsDocument = isDocumentLikeDeliverablePath(
        rawRelativePath,
        path
      );
      const isLoginPath = rawRelativePath === "__login";
      const isAuthPath = rawRelativePath === "__auth";
      const isLogoutPath = rawRelativePath === "__logout";

      let site;
      try {
        const agentFolder = resolveAgentFolderForSite(agentId);
        site = resolveSiteRoot(agentFolder, agentId);
      } catch (err) {
        const status = err.code === "ENOENT" ? 404 : 400;
        return respondText(res, status, err.message);
      }

      const ownerClaims = dashboardAuthenticate(req);
      const ownerAuthenticated = ownerClaims?._dashboardAuth === true;
      const siteAuthenticated = authenticateDeliverableSession(req, agentId);
      const ownerGateSatisfied = ownerAuthenticated || siteAuthenticated;
      const passwordGateSatisfied = ownerAuthenticated || siteAuthenticated;
      const normalizeNextPath = (candidate) =>
        normalizeServedSiteNextPath(routePrefix, agentId, candidate);
      const buildPasswordCookie = (token, { clear = false } = {}) =>
        buildAgentSitePasswordCookie(token, agentId, { clear });
      const renderPasswordPage = (options = {}) =>
        renderServedSitePasswordPage(agentId, { routePrefix, ...options });
      const renderLoginRequiredPage = () =>
        renderServedSiteLoginRequiredPage(
          agentId,
          requestedPath,
          routePrefix
        );

      if (req.method === "GET" && isLoginPath) {
        if (site.web.access !== "password") {
          return respondText(
            res,
            404,
            "Password login is not enabled for this website"
          );
        }
        if (!site.web.passwordConfigured) {
          return respondText(
            res,
            503,
            WEBSITE_PASSWORD_NOT_CONFIGURED_OWNER_COPY
          );
        }
        const next = normalizeNextPath(url.searchParams.get("next"));
        if (passwordGateSatisfied) {
          return redirect(res, 302, next, { "Cache-Control": "no-store" });
        }
        return respondHtml(res, 200, renderPasswordPage({ next }), {
          "Cache-Control": "no-store",
        });
      }

      if (req.method === "POST" && isAuthPath) {
        if (site.web.access !== "password") {
          return respondText(
            res,
            404,
            "Password login is not enabled for this website"
          );
        }
        if (!site.web.passwordConfigured) {
          return respondText(
            res,
            503,
            WEBSITE_PASSWORD_NOT_CONFIGURED_OWNER_COPY
          );
        }
        const body = await readFormBody(req);
        const next = normalizeNextPath(body.next);
        const password = typeof body.password === "string" ? body.password : "";
        const verified = verifyAgentWebsitePassword(password, site.web.password);
        if (!verified) {
          return respondHtml(
            res,
            401,
            renderPasswordPage({
              next,
              error: "Incorrect password",
            }),
            {
              "Cache-Control": "no-store",
            }
          );
        }
        const token = createDeliverableSession(agentId);
        return redirect(res, 302, next, {
          "Cache-Control": "no-store",
          "Set-Cookie": buildPasswordCookie(token),
        });
      }

      if (req.method === "POST" && isLogoutPath) {
        clearDeliverableSession(req);
        return redirect(res, 302, `${basePath}__login`, {
          "Set-Cookie": buildPasswordCookie("", { clear: true }),
        });
      }

      if (isLoginPath || isAuthPath || isLogoutPath) {
        return respondText(res, 405, "Unsupported website auth method");
      }

      if (site.web.access === "password" && !site.web.passwordConfigured) {
        return respondText(
          res,
          503,
          WEBSITE_PASSWORD_NOT_CONFIGURED_OWNER_COPY
        );
      }

      if (site.web.access === "owner_only" && !ownerGateSatisfied) {
        if (wantsDocument) {
          return respondHtml(res, 401, renderLoginRequiredPage(), {
            "Cache-Control": "no-store",
          });
        }
        return respondText(res, 401, "Owner login required");
      }

      if (site.web.access === "password" && !passwordGateSatisfied) {
        if (wantsDocument) {
          return redirect(
            res,
            302,
            `${basePath}__login?next=${encodeURIComponent(requestedPath)}`,
            { "Cache-Control": "no-store" }
          );
        }
        return respondText(res, 401, "Website password required");
      }

      if (req.method !== "GET") {
        return respondText(res, 405, "Method not allowed");
      }

      try {
        const asset = resolveSiteAsset(
          site.rootPath,
          rawRelativePath,
          path,
          url.search
        );
        if (asset.redirectTo) {
          return redirect(res, 302, asset.redirectTo);
        }
        res.writeHead(200, {
          "Content-Type": asset.contentType,
          "Cache-Control": getDeliverableCacheControl(site.web.access),
        });
        res.end(asset.content);
        return;
      } catch (err) {
        const status = err.code === "ENOENT" ? 404 : 400;
        return respondText(res, status, err.message);
      }
    }

    if (req.method === "GET" && path.startsWith("/dev/fs-auth/")) {
      const routeRemainder = path.slice("/dev/fs-auth/".length);
      const firstSlashIndex = routeRemainder.indexOf("/");
      if (firstSlashIndex < 0) {
        return respond(res, 400, { error: "auth token required" });
      }
      const authToken = decodeURIComponent(
        routeRemainder.slice(0, firstSlashIndex)
      );
      const authPathRemainder = routeRemainder.slice(firstSlashIndex + 1);
      const rootSlashIndex = authPathRemainder.indexOf("/");
      if (rootSlashIndex < 0) {
        return respond(res, 400, { error: "relative path required" });
      }
      const rootKey = authPathRemainder.slice(0, rootSlashIndex);
      const relativePath = authPathRemainder.slice(rootSlashIndex + 1);

      const claims = authenticateContentRequest(req, res, url, authToken);
      if (!claims) return;
      if (!requireDashboardMode(claims, res)) return;

      try {
        const asset = readDevFsAsset(rootKey, relativePath);
        res.writeHead(200, {
          "Content-Type": asset.contentType,
          "Cache-Control": "private, max-age=300",
        });
        res.end(asset.content);
        return;
      } catch (err) {
        if (err.code === "ENOENT") {
          return respond(res, 404, { error: err.message });
        }
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path.startsWith("/dev/fs/")) {
      const claims = authenticateContentRequest(req, res, url);
      if (!claims) return;
      if (!requireDashboardMode(claims, res)) return;

      const routeRemainder = path.slice("/dev/fs/".length);
      const slashIndex = routeRemainder.indexOf("/");
      if (slashIndex < 0) {
        return respond(res, 400, { error: "relative path required" });
      }
      const rootKey = routeRemainder.slice(0, slashIndex);
      const relativePath = routeRemainder.slice(slashIndex + 1);

      try {
        const asset = readDevFsAsset(rootKey, relativePath);
        res.writeHead(200, {
          "Content-Type": asset.contentType,
          "Cache-Control": "private, max-age=300",
        });
        res.end(asset.content);
        return;
      } catch (err) {
        if (err.code === "ENOENT") {
          return respond(res, 404, { error: err.message });
        }
        return respond(res, 400, { error: err.message });
      }
    }

    // ── Host-origin Route C Matrix facade (Host-scoped facade auth, no dashboard token required) ──
    if (path.startsWith("/_matrix/")) {
      return await routeCMatrixFacade.handleMatrixRequest({
        req,
        res,
        url,
        path,
        respond,
        readBody,
        readRawBody,
      });
    }

    // ── GET /routec/runtime-env-preflight (redacted harness preflight; no auth required) ──
    if (req.method === "GET" && path === "/routec/runtime-env-preflight") {
      return await routeCMatrixFacade.handleRuntimeEnvPreflight({
        res,
        respond,
      });
    }

    // ── POST /routec/matrix/host-scoped-cinny-session-bootstrap (existing Host session only; no auth credentials) ──
    if (
      req.method === "POST" &&
      path === "/routec/matrix/host-scoped-cinny-session-bootstrap"
    ) {
      const body = await readBody(req);
      return await routeCMatrixFacade.handleHostScopedCinnySessionBootstrap({
        req,
        res,
        body,
        respond,
      });
    }

    // ── POST /routec/matrix/client-auth-loss-diagnostic (debug-only, redacted) ──
    if (
      req.method === "POST" &&
      path === "/routec/matrix/client-auth-loss-diagnostic"
    ) {
      const body = await readBody(req);
      return await routeCMatrixFacade.handleClientAuthLossDiagnostic({
        req,
        res,
        body,
        respond,
      });
    }

    // ── POST /auth/login (no auth required) ────────────────
    if (req.method === "POST" && path === "/auth/login") {
      const body = await readBody(req);
      const bootstrapToken =
        typeof body.bootstrap_token === "string" ? body.bootstrap_token : "";
      if (bootstrapToken.trim()) {
        const consumed = consumeHostLoginBootstrapToken(bootstrapToken);
        if (consumed.ok) {
          issueDashboardLoginSession(res);
          console.log(
            `[dashboard] Login successful with one-time bootstrap token ${consumed.token_id}`
          );
          return;
        }
        console.warn(
          `[dashboard] Bootstrap token login failed: ${consumed.reason}`
        );
        return respond(res, 401, {
          error: "Invalid or expired login QR",
          reason: consumed.reason,
        });
      }
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      const credentialsError = getDashboardCredentialError();
      if (credentialsError) {
        console.warn(
          "[dashboard] Login rejected because dashboard credentials are not configured"
        );
        return respond(res, 503, { error: credentialsError });
      }
      const credentials = getDashboardCredentialConfig();
      if (
        username === credentials.username &&
        password.trim() &&
        verifyDashboardPassword(password, credentials.passwordHash)
      ) {
        issueDashboardLoginSession(res);
        console.log(`[dashboard] Login successful for user "${username}"`);
        return;
      }
      console.warn(`[dashboard] Login failed for user "${username}"`);
      return respond(res, 401, { error: "Invalid credentials" });
    }

    if (req.method === "POST" && path === "/admin/restart-prepare") {
      const serviceControlClaims = authenticateLocalServiceControlRequest(req);
      let restartPrepareClaims = serviceControlClaims;
      if (!restartPrepareClaims) {
        restartPrepareClaims = authenticate(req, res);
        if (!restartPrepareClaims) return;
        if (!requireDashboardMode(restartPrepareClaims, res)) return;
      }
      try {
        const body = await readJsonBody(req);
        return respond(
          res,
          201,
          prepareHostRestartRestore({
            trigger:
              normalizeString(body.trigger) ||
              (serviceControlClaims
                ? "cli_service_restart_restore_sessions"
                : "admin_restart_prepare"),
          })
        );
      } catch (err) {
        return respond(res, 409, { error: err.message });
      }
    }

    // ── POST /mail/items (capability-scoped agent/scheduler Mail create) ──
    if (req.method === "POST" && path === "/mail/items") {
      const grant = authenticateMailCreateCapability(req, res);
      if (!grant) return;
      const body = await readBody(req);
      try {
        const result = mailStore.createMailItem(
          buildMailCreateInputFromBody(body, grant)
        );
        if (result.created) {
          emitCommittedMailNotification(result.mail);
        }
        return respond(res, result.created ? 201 : 200, {
          ok: true,
          status: "mail_item_created",
          mail_id: result.mail.id,
          url: `/app/mail/${encodeURIComponent(result.mail.id)}`,
          created: result.created,
          mail: result.mail,
          capability_scope: MAIL_CREATE_SCOPE,
          token_redacted: true,
          storage_owner: "host_config_oysterun_sqlite",
          browser_local_storage_owner: false,
          matrix_db_owner: false,
        });
      } catch (err) {
        return respondMailApiError(res, err);
      }
    }

    // ── Authenticate all other routes ──────────────────────
    const claims = authenticate(req, res);
    if (!claims) return;

    // ── POST /routec/matrix/bootstrap ─────────────────────
    if (req.method === "POST" && path === "/routec/matrix/bootstrap") {
      const body = await readBody(req);
      return routeCMatrixFacade.handleBootstrap({
        req,
        res,
        claims,
        body,
        respond,
      });
    }

    // ── GET /routec/matrix/binding?session_id=… ───────────
    if (req.method === "GET" && path === "/routec/matrix/binding") {
      return routeCMatrixFacade.handleBindingRead({
        url,
        res,
        claims,
        respond,
      });
    }

    // ── GET /routec/matrix/session-transcript-preview?session_id=… ───────────
    if (
      req.method === "GET" &&
      path === "/routec/matrix/session-transcript-preview"
    ) {
      return routeCMatrixFacade.handleSessionSetupTranscriptPreview({
        url,
        res,
        claims,
        respond,
      });
    }

    // ── GET /session/chat-binding?session_id=… (clean app chat readiness) ──
    if (req.method === "GET" && path === "/session/chat-binding") {
      return routeCMatrixFacade.handleCleanSessionChatBindingRead({
        url,
        res,
        claims,
        respond,
      });
    }

    // ── GET /session/large-tool-output?session_id=…&matrix_room_id=… ─────
    if (req.method === "GET" && path === "/session/large-tool-output") {
      const sessionId = normalizeString(url.searchParams.get("session_id"));
      const matrixRoomId = normalizeString(
        url.searchParams.get("matrix_room_id") || url.searchParams.get("room_id")
      );
      if (!sessionId || !matrixRoomId) {
        return respond(res, 400, {
          error: "session_id and matrix_room_id required",
          raw_path_exposed: false,
        });
      }
      const session = requireSessionCapability(
        claims,
        sessionId,
        "can_chat",
        res
      );
      if (!session) return;
      let binding = null;
      try {
        binding = requireRouteCMatrixRoomBinding(sessionId);
      } catch {
        binding = null;
      }
      if (binding && binding.matrix_room_id !== matrixRoomId) {
        return respond(res, 403, {
          error: "large tool output room binding does not match session",
          raw_path_exposed: false,
        });
      }
      const page = Number(url.searchParams.get("page") || "1");
      if (!Number.isSafeInteger(page) || page < 1) {
        return respond(res, 400, {
          error: "page must be a positive integer",
          raw_path_exposed: false,
        });
      }
      try {
        const output = largeToolCallStore.resolveLargeToolOutput({
          sessionId,
          matrixRoomId,
          page,
          retainedMatrixEventId: normalizeString(
            url.searchParams.get("retained_event_id") ||
              url.searchParams.get("event_id") ||
              url.searchParams.get("matrix_event_id")
          ),
          providerTurnId: normalizeString(url.searchParams.get("provider_turn_id")),
          targetTurnId: normalizeString(url.searchParams.get("target_turn_id")),
          groupingKey: normalizeString(url.searchParams.get("grouping_key")),
          largeToolRef: normalizeString(url.searchParams.get("large_tool_ref")),
        });
        const status =
          output.status === "ambiguous"
            ? 409
            : output.status === "forbidden"
            ? 403
            : 200;
        return respond(res, status, {
          ...output,
          session_id: sessionId,
          matrix_room_id: matrixRoomId,
          page_size: output.page_size || ROUTEC_LARGE_TOOL_JSONL_PAGE_SIZE,
          committed_transcript_truth: "matrix_room_timeline",
          host_local_large_tool_calls_jsonl: true,
          matrix_large_ref_written: false,
          matrix_large_tool_ref_written: false,
          raw_path_exposed: false,
          matrix_chat_search_includes_jsonl: false,
          explicit_detail_navigation_required: true,
          debug_tool_detail_source_ui_enabled:
            readConfig().debug_routec_tool_detail_source_ui_enabled === true,
        });
      } catch (err) {
        return respond(res, 503, {
          status: "unavailable",
          error: err.message || String(err),
          continuation_state: "unavailable",
          raw_path_exposed: false,
        });
      }
    }

    // ── GET /session/tool-event-detail?session_id=…&matrix_room_id=…&matrix_event_id=… ─────
    if (req.method === "GET" && path === "/session/tool-event-detail") {
      const sessionId = normalizeString(url.searchParams.get("session_id"));
      const matrixRoomId = normalizeString(
        url.searchParams.get("matrix_room_id") || url.searchParams.get("room_id")
      );
      const matrixEventId = normalizeString(
        url.searchParams.get("matrix_event_id") ||
          url.searchParams.get("event_id")
      );
      if (!sessionId || !matrixRoomId || !matrixEventId) {
        return respond(res, 400, {
          status: "missing_identity",
          error: "session_id, matrix_room_id, and matrix_event_id required",
          raw_path_exposed: false,
        });
      }
      const session = requireSessionCapability(
        claims,
        sessionId,
        "can_chat",
        res
      );
      if (!session) return;
      let binding = null;
      try {
        binding = requireRouteCMatrixRoomBinding(sessionId);
      } catch {
        binding = null;
      }
      if (!binding) {
        return respond(res, 404, {
          status: "unavailable",
          error: "tool event detail room binding not found",
          raw_path_exposed: false,
        });
      }
      if (binding && binding.matrix_room_id !== matrixRoomId) {
        return respond(res, 403, {
          status: "forbidden",
          error: "tool event detail room binding does not match session",
          raw_path_exposed: false,
        });
      }
      const page = Number(url.searchParams.get("page") || "1");
      if (!Number.isSafeInteger(page) || page < 1) {
        return respond(res, 400, {
          status: "invalid_page",
          error: "page must be a positive integer",
          raw_path_exposed: false,
        });
      }
      try {
        let detail = toolEventDetailStore.resolveToolEventDetail({
          sessionId,
          matrixRoomId,
          matrixEventId,
          page,
          pageSizeBytes: ROUTEC_TOOL_EVENT_DETAIL_PAGE_SIZE_BYTES,
        });
        if (detail.status === "unavailable" && binding) {
          detail = readRouteCMatrixToolEventDetail({
            binding,
            eventId: matrixEventId,
            page,
          });
        }
        const status =
          detail.status === "forbidden"
            ? 403
            : detail.status === "missing_identity"
            ? 400
            : detail.status === "unavailable"
            ? 404
            : detail.status === "ambiguous"
            ? 409
            : 200;
        return respond(res, status, {
          ...detail,
          session_id: sessionId,
          matrix_room_id: matrixRoomId,
          matrix_event_id: matrixEventId,
          committed_transcript_truth: "matrix_room_timeline",
          detail_identity_kind: "session_room_event",
          selected_detail_top_only: true,
          selected_detail_limit_bytes:
            detail.selected_detail_limit_bytes ||
            ROUTEC_TOOL_EVENT_DETAIL_SELECTED_DETAIL_LIMIT_BYTES,
          debug_tool_detail_source_ui_enabled:
            readConfig().debug_routec_tool_detail_source_ui_enabled === true,
          raw_path_exposed: false,
        });
      } catch (err) {
        return respond(res, 503, {
          status: "unavailable",
          error: err.message || String(err),
          raw_path_exposed: false,
        });
      }
    }

    // ── GET /routec/matrix/host2-intake?session_id=…&room_id=…&event_id=… ──
    if (req.method === "GET" && path === "/routec/matrix/host2-intake") {
      const sessionId = url.searchParams.get("session_id")?.trim() || "";
      const matrixRoomId = (
        url.searchParams.get("matrix_room_id") ||
        url.searchParams.get("room_id") ||
        ""
      ).trim();
      const serverEventId = (
        url.searchParams.get("event_id") ||
        url.searchParams.get("server_event_id") ||
        ""
      ).trim();
      if (!sessionId || !matrixRoomId || !serverEventId) {
        return respond(res, 400, {
          error:
            "session_id, matrix_room_id/room_id, and event_id/server_event_id required",
          foundation_pass_claimed: false,
        });
      }
      const session = requireSessionCapability(
        claims,
        sessionId,
        "can_chat",
        res
      );
      if (!session) return;
      const proof = getRouteCHost2IntakeProof({
        hostSessionId: session.id,
        matrixRoomId,
        serverEventId,
      });
      if (!proof) {
        return respond(res, 404, {
          error: "Route C Host2 intake proof not found for Matrix event.",
          host_session_id: session.id,
          matrix_room_id: matrixRoomId,
          host2_receipt_target_event_id: serverEventId,
          foundation_pass_claimed: false,
        });
      }
      return respond(res, 200, {
        status: "host2_intake_proof_found",
        proof,
        foundation_pass_claimed: false,
      });
    }

    // ── POST /routec/matrix/host2-intake/cancel ───────────
    if (
      req.method === "POST" &&
      path === "/routec/matrix/host2-intake/cancel"
    ) {
      const body = await readBody(req);
      const sessionId =
        typeof body.session_id === "string" ? body.session_id.trim() : "";
      const matrixRoomId =
        typeof body.matrix_room_id === "string"
          ? body.matrix_room_id.trim()
          : typeof body.room_id === "string"
          ? body.room_id.trim()
          : "";
      const serverEventId =
        typeof body.event_id === "string"
          ? body.event_id.trim()
          : typeof body.server_event_id === "string"
          ? body.server_event_id.trim()
          : "";
      if (!sessionId || !matrixRoomId || !serverEventId) {
        return respond(res, 400, {
          error:
            "session_id, matrix_room_id/room_id, and event_id/server_event_id required",
          foundation_pass_claimed: false,
        });
      }
      const session = requireSessionCapability(
        claims,
        sessionId,
        "can_chat",
        res
      );
      if (!session) return;
      const result = cancelRouteCHost2IntakeForMatrixEvent({
        hostSessionId: session.id,
        matrixRoomId,
        serverEventId,
      });
      return respond(res, result.status, {
        ...result.body,
        foundation_pass_claimed: false,
      });
    }

    // ── POST /routec/provider-control-response ────────────
    if (req.method === "POST" && path === "/routec/provider-control-response") {
      const body = await readBody(req);
      const sessionId =
        typeof body.session_id === "string" ? body.session_id.trim() : "";
      const requestId =
        typeof body.request_id === "string" ? body.request_id.trim() : "";
      if (!sessionId || !requestId) {
        return respond(res, 400, {
          error: "session_id and request_id required",
          control_response_forwarded: false,
          provider_control_outcome_event_emitted: false,
          browser_local_state_final_truth: false,
          foundation_pass_claimed: false,
        });
      }
      if (typeof body.allow !== "boolean") {
        return respond(res, 400, {
          error: "allow boolean required",
          session_id: sessionId,
          request_id: requestId,
          control_response_forwarded: false,
          provider_control_outcome_event_emitted: false,
          browser_local_state_final_truth: false,
          foundation_pass_claimed: false,
        });
      }
      const session = requireSessionCapability(
        claims,
        sessionId,
        "can_chat",
        res
      );
      if (!session) return;
      const result = submitProviderControlResponse(
        session,
        {
          request_id: requestId,
          allow: body.allow,
          answers: body.answers,
          response: body.response,
          grant_suggestion: body.grant_suggestion,
        },
        { requirePendingRequest: true }
      );
      return respond(res, result.status, result.body);
    }

    // ── POST /routec/matrix/semantic-events ───────────────
    if (req.method === "POST" && path === "/routec/matrix/semantic-events") {
      const body = await readBody(req);
      return routeCMatrixFacade.handleSemanticEventWrite({
        res,
        claims,
        body,
        respond,
      });
    }

    // ── GET /auth/status (P86 CLI authenticated profile check) ──
    if (req.method === "GET" && path === "/auth/status") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(res, 200, {
        status: "authenticated",
        authenticated: true,
        user_id: claims.user_id || "dashboard-admin",
        contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        token_redacted: true,
      });
    }

    // ── POST /auth/logout ──────────────────────────────────
    if (req.method === "POST" && path === "/auth/logout") {
      const authHeader = req.headers["authorization"];
      const cookieToken = getDashboardCookieToken(req);
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        dashboardSessions.delete(token);
      }
      if (cookieToken) {
        dashboardSessions.delete(cookieToken);
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": buildDashboardCookie("", { clear: true }),
      });
      res.end(JSON.stringify({ status: "logged_out" }));
      return;
    }

    // ── POST /auth/bootstrap-token (dashboard-authenticated QR generation) ──
    if (req.method === "POST" && path === "/auth/bootstrap-token") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        return respond(res, 201, createDirectHostLoginBootstrapQr());
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    // ── POST /cloud/notification-bootstrap (P206 app-to-cloud pairing) ──
    if (req.method === "POST" && path === "/cloud/notification-bootstrap") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        return respond(res, 201, await createCloudNotificationBootstrap());
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    // ── Host restart restore runtime status/prepare (dashboard-authenticated) ──
    if (req.method === "GET" && path === "/admin/runtime-status") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(res, 200, buildHostRuntimeStatusPayload());
    }

    // ── POST /dev/restart-host (dashboard-authenticated Host restart) ──
    if (req.method === "POST" && path === "/dev/restart-host") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const config = readConfig();
        const redirectUrl = normalizeString(
          config.direct_host_url || config.public_base_url || DIRECT_HOST_URL
        );
        assertHostRestartSchedulingAvailable();
        const restartRestore = prepareHostRestartRestore({
          trigger: "host_preferences_restart_host",
        });
        return respond(
          res,
          202,
          scheduleHostRestart({
            redirectUrl,
            restartRestore: restartRestore.restart_restore,
          })
        );
      } catch (err) {
        return respond(res, 409, { error: err.message });
      }
    }

    // ── Oysterun npm package update status/control (dashboard-authenticated) ──
    if (req.method === "GET" && path === "/admin/update-status") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(res, 200, buildOysterunUpdateStatusPayload());
    }

    if (req.method === "POST" && path === "/admin/update-check") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readJsonBody(req);
        return respond(
          res,
          200,
          await checkOysterunNpmUpdate({ source: body.source })
        );
      } catch (err) {
        return respond(
          res,
          409,
          err.updatePayload ||
            buildOysterunUpdateStatusPayload({
              status: "update_check_failed",
              source: "manual",
              error: err.message,
            })
        );
      }
    }

    if (req.method === "POST" && path === "/admin/update-run") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readJsonBody(req);
        return respond(
          res,
          202,
          await scheduleOysterunPackageUpdate()
        );
      } catch (err) {
        return respond(res, 409, { error: err.message });
      }
    }

    // ── Authenticated Mail dashboard APIs (P34.2 source only) ──
    if (req.method === "POST" && path === "/mail/send") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      try {
        const result = mailStore.createMailItem(
          buildDashboardMailCreateInputFromBody(
            body,
            claims.user_id || "dashboard-admin"
          )
        );
        if (result.created) {
          emitCommittedMailNotification(result.mail);
        }
        return respond(res, result.created ? 201 : 200, {
          ok: true,
          status: "mail_sent",
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
          mail_id: result.mail.id,
          url: `/app/mail/${encodeURIComponent(result.mail.id)}`,
          created: result.created,
          mail: result.mail,
          storage_owner: "host_config_oysterun_sqlite",
          browser_local_storage_owner: false,
          matrix_db_owner: false,
        });
      } catch (err) {
        return respondMailApiError(res, err);
      }
    }

    if (req.method === "GET" && path === "/mail/unread-count") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(res, 200, {
        status: "mail_unread_count",
        unread_count: mailStore.getUnreadCount(),
        storage_owner: "host_config_oysterun_sqlite",
        browser_local_storage_owner: false,
        matrix_db_owner: false,
      });
    }

    if (req.method === "GET" && path === "/mail/items") {
      if (!requireDashboardMode(claims, res)) return;
      const requestedLimit = Number(url.searchParams.get("limit") || 50);
      const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 100)
          : 50;
      try {
        const filter = normalizeString(url.searchParams.get("filter")) || "inbox";
        return respond(res, 200, {
          status: "mail_items",
          filter,
          limit,
          items: mailStore.listMailItems({ filter, limit }),
          storage_owner: "host_config_oysterun_sqlite",
          browser_local_storage_owner: false,
          matrix_db_owner: false,
        });
      } catch (err) {
        return respondMailApiError(res, err);
      }
    }

    const mailStateMatch = path.match(
      /^\/mail\/items\/([^/]+)\/(read|unread|archive|unarchive)$/
    );
    if (mailStateMatch) {
      if (!requireDashboardMode(claims, res)) return;
      if (req.method !== "POST") {
        return respond(res, 405, { error: "Unsupported Mail state method" });
      }
      const mailId = decodeURIComponent(mailStateMatch[1]);
      const action = mailStateMatch[2];
      try {
        const actor = {
          actorType: "dashboard",
          actorId: claims.user_id || "dashboard-admin",
        };
        const mail =
          action === "read"
            ? mailStore.markMailItemRead(mailId, actor)
            : action === "unread"
            ? mailStore.markMailItemUnread(mailId, actor)
            : action === "archive"
            ? mailStore.archiveMailItem(mailId, actor)
            : mailStore.unarchiveMailItem(mailId, actor);
        return respond(res, 200, {
          status: `mail_item_${action}`,
          mail,
          storage_owner: "host_config_oysterun_sqlite",
          browser_local_storage_owner: false,
          matrix_db_owner: false,
        });
      } catch (err) {
        return respondMailApiError(res, err);
      }
    }

    const mailItemMatch = path.match(/^\/mail\/items\/([^/]+)$/);
    if (mailItemMatch) {
      if (!requireDashboardMode(claims, res)) return;
      const mailId = decodeURIComponent(mailItemMatch[1]);
      if (req.method === "GET") {
        const mail = mailStore.getMailItem(mailId);
        if (!mail) return respond(res, 404, { error: "Mail item not found" });
        return respond(res, 200, {
          status: "mail_item",
          mail,
          storage_owner: "host_config_oysterun_sqlite",
          browser_local_storage_owner: false,
          matrix_db_owner: false,
        });
      }
      if (req.method === "PATCH") {
        const body = await readBody(req);
        try {
          const mail = mailStore.updateMailItem(mailId, {
            ...buildMailUpdateInputFromBody(body),
            actorId: claims.user_id || "dashboard-admin",
          });
          return respond(res, 200, {
            status: "mail_item_updated",
            mail,
              storage_owner: "host_config_oysterun_sqlite",
            browser_local_storage_owner: false,
            matrix_db_owner: false,
          });
        } catch (err) {
          return respondMailApiError(res, err);
        }
      }
      if (req.method === "DELETE") {
        try {
          const mail = mailStore.deleteMailItem(mailId, {
            actorType: "dashboard",
            actorId: claims.user_id || "dashboard-admin",
          });
          return respond(res, 200, {
            status: "mail_item_deleted",
            mail_id: mail.id,
            deleted_at: mail.deleted_at,
            storage_owner: "host_config_oysterun_sqlite",
            browser_local_storage_owner: false,
            matrix_db_owner: false,
          });
        } catch (err) {
          return respondMailApiError(res, err);
        }
      }
    }

    if (req.method === "POST" && path === "/api/browser/handoff") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const rawTarget = body["target"];
      if (typeof rawTarget !== "string" || !rawTarget.trim()) {
        return respond(res, 400, { error: "target required" });
      }
      let target;
      try {
        target = resolveBrowserHandoffTarget(rawTarget);
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      const handoff = createBrowserHandoffToken(target);
      return respond(res, 200, {
        launch_url: buildBrowserHandoffPath(handoff.token),
        expires_at: new Date(handoff.expiresAtMs).toISOString(),
        target_path: target.targetPath,
      });
    }

    if (req.method === "POST" && path === "/auth/change-password") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const credentialsError = getDashboardCredentialError();
        if (credentialsError) {
          return respond(res, 503, { error: credentialsError });
        }
        const body = await readBody(req);
        const oldPassword =
          typeof body.old_password === "string" ? body.old_password : "";
        const newPassword =
          typeof body.new_password === "string" ? body.new_password : "";
        if (!oldPassword.trim()) {
          return respond(res, 400, { error: "Current password required" });
        }
        if (!newPassword.trim()) {
          return respond(res, 400, { error: "New password required" });
        }
        const credentials = getDashboardCredentialConfig();
        if (!verifyDashboardPassword(oldPassword, credentials.passwordHash)) {
          console.warn(
            `[dashboard] Password change rejected for user "${credentials.username}" due to incorrect current password`
          );
          return respond(res, 401, { error: "Current password is incorrect" });
        }
        writeConfig({
          dashboard_password_hash: hashDashboardPassword(newPassword),
        });
        dashboardSessions.clear();
        console.log(
          `[dashboard] Password changed for user "${credentials.username}" and dashboard sessions were invalidated`
        );
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": buildDashboardCookie("", { clear: true }),
        });
        res.end(JSON.stringify({ status: "password_changed" }));
        return;
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/agents/catalog") {
      try {
        const agents = buildAgentCatalog(claims);
        return respond(res, 200, {
          agents,
          websites: buildAgentWebsiteCatalog(agents),
          roots: buildBrowseRoots(),
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/providers") {
      const config = readConfig();
      return respond(res, 200, {
        providers: await Promise.all(
          listProviders({ config }).map((provider) =>
            serializeProviderCatalogEntry(provider, config)
          )
        ),
      });
    }

    if (req.method === "GET" && path === "/telegram/status") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(res, 200, buildP86TelegramStatusPayload());
    }

    if (req.method === "POST" && path === "/telegram/test-send") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const sessionId = normalizeString(body.session_id ?? body.sessionId);
      let session = null;
      if (sessionId) {
        session = requireSessionCapability(
          claims,
          sessionId,
          "can_start_session",
          res
        );
        if (!session) return;
      }
      const agentId = normalizeString(
        body.agent_id ?? body.agentId ?? session?.agentId
      );
      if (!agentId) {
        return respond(res, 400, { error: "agent_id or session_id required" });
      }
      if (
        !session &&
        !requireAgentCapability(claims, agentId, "can_start_session", res)
      ) {
        return;
      }
      const folder =
        session?.cwd ||
        (claims._dashboardAuth
          ? normalizeString(body.agent_folder ?? body.agentFolder)
          : null) ||
        getAgentFolder(agentId);
      if (!folder) {
        return respond(res, 400, {
          error: "agent_folder or live session folder required for Telegram Test Send",
          telegram_test_send: true,
          config_mutated: false,
        });
      }

      let effectiveTelegramConfig;
      let targetChatId;
      try {
        const normalizedTelegram = normalizeTelegramConfigPayload(body);
        const baseTelegramConfig = session?.telegramConfig
          ? buildSessionTelegramRuntimeConfig(session.telegramConfig)
          : buildResolvedSessionTelegramConfig(
              resolveAgentRuntimeConfig(folder).layers
            );
        effectiveTelegramConfig = buildEffectiveTelegramRuntimeConfig(
          baseTelegramConfig,
          normalizedTelegram
        );
        assertTelegramTestSendReady(effectiveTelegramConfig);
        targetChatId = resolveTelegramTestSendTarget(effectiveTelegramConfig);
      } catch (err) {
        return respond(
          res,
          400,
          buildTelegramTestSendResponse({
            status: "telegram_test_send_rejected",
            error: err.message,
            agent_id: agentId,
            session_id: session?.id || null,
            config_mutated: false,
          })
        );
      }

      try {
        await telegramRealAdapter.sendMessage({
          botToken: effectiveTelegramConfig.botToken,
          chatId: targetChatId,
          text: P95_TELEGRAM_TEST_MESSAGE_TEXT,
        });
        return respond(
          res,
          200,
          buildTelegramTestSendResponse({
            status: "telegram_test_send_sent",
            agent_id: agentId,
            session_id: session?.id || null,
            target_rule: "first_explicit_allowed_user",
            target_count: 1,
            target_redacted: true,
            config_mutated: false,
          })
        );
      } catch (err) {
        console.warn(
          `[telegram/test-send] failed agent_id=${agentId} session_id=${
            session?.id || "none"
          }: ${err.message}`
        );
        return respond(
          res,
          502,
          buildTelegramTestSendResponse({
            status: "telegram_test_send_failed",
            error: "Telegram Test Send failed.",
            agent_id: agentId,
            session_id: session?.id || null,
            target_rule: "first_explicit_allowed_user",
            target_redacted: true,
            config_mutated: false,
          })
        );
      }
    }

    if (req.method === "GET" && path === "/website/status") {
      const agentId = normalizeString(url.searchParams.get("agent_id"));
      if (!agentId) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      const auth = requireDashboardOrRuntimeCapability(claims, res, {
        scope: "website:read",
        agentId,
      });
      if (!auth) return;
      try {
        const folder = resolveP86WebsiteAgentFolder(agentId);
        return respond(res, 200, buildP86WebsiteStatusPayload(agentId, folder));
      } catch (err) {
        return respond(res, 404, {
          error: err.message,
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        });
      }
    }

    if (req.method === "GET" && path === "/website/access") {
      const agentId = normalizeString(url.searchParams.get("agent_id"));
      if (!agentId) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      const auth = requireDashboardOrRuntimeCapability(claims, res, {
        scope: "website:read",
        agentId,
      });
      if (!auth) return;
      try {
        const folder = resolveP86WebsiteAgentFolder(agentId);
        const metadata = buildAgentWebsiteMetadata(agentId, folder);
        return respond(res, 200, {
          status: "website_access",
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
          agent_id: agentId,
          agent_folder: folder,
          access: metadata.access || null,
          password_configured: metadata.passwordConfigured === true,
          raw_password_returned: false,
        });
      } catch (err) {
        return respond(res, 404, {
          error: err.message,
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        });
      }
    }

    if (req.method === "POST" && path === "/website/validate") {
      try {
        const body = await readBody(req);
        const agentId = normalizeString(body.agent_id || body.agentId);
        if (!agentId) {
          return respond(res, 400, { error: "agent_id required" });
        }
        const auth = requireDashboardOrRuntimeCapability(claims, res, {
          scope: "website:read",
          agentId,
        });
        if (!auth) return;
        if (!requireRuntimeWebsiteFolderMatchesSession(auth, body, res)) return;
        const folder = resolveP86WebsiteAgentFolder(agentId, body);
        const metadata = buildAgentWebsiteMetadata(agentId, folder);
        return respond(res, 200, {
          status: metadata.available ? "website_valid" : "website_unavailable",
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
          agent_id: agentId,
          agent_folder: folder,
          website: metadata,
          raw_local_path_returned: false,
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        });
      }
    }

    if (req.method === "POST" && path === "/website/init") {
      try {
        const body = await readBody(req);
        const agentId = normalizeString(body.agent_id || body.agentId);
        if (!agentId) {
          return respond(res, 400, { error: "agent_id required" });
        }
        const auth = requireDashboardOrRuntimeCapability(claims, res, {
          scope: "website:update",
          agentId,
        });
        if (!auth) return;
        if (!requireRuntimeWebsiteFolderMatchesSession(auth, body, res)) return;
        const folder = resolveP86WebsiteAgentFolder(agentId, body);
        return respond(
          res,
          body.dry_run === true ? 200 : 201,
          applyP86WebsiteScaffold({
            agentId,
            folder,
            access: body.access || body.web_access,
            dryRun: body.dry_run === true,
          })
        );
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        });
      }
    }

    if (req.method === "PATCH" && path === "/website/access") {
      try {
        const body = await readBody(req);
        const agentId = normalizeString(body.agent_id || body.agentId);
        if (!agentId) {
          return respond(res, 400, { error: "agent_id required" });
        }
        const auth = requireDashboardOrRuntimeCapability(claims, res, {
          scope: "website:update",
          agentId,
        });
        if (!auth) return;
        if (!requireRuntimeWebsiteFolderMatchesSession(auth, body, res)) return;
        const folder = resolveP86WebsiteAgentFolder(agentId, body);
        const access = normalizeAgentWebAccess(body.access || body.web_access);
        if (body.dry_run === true) {
          return respond(res, 200, {
            status: "website_access_dry_run",
            contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
            agent_id: agentId,
            agent_folder: folder,
            access,
          });
        }
        const result = persistAgentConfigUpdates(folder, { web_access: access });
        persistP86WebsiteAgentFolder(agentId, body);
        return respond(res, 200, {
          status: "website_access_updated",
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
          agent_id: agentId,
          agent_folder: folder,
          access,
          config_mutated: result.changed === true,
          website: buildAgentWebsiteMetadata(agentId, folder),
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        });
      }
    }

    if (req.method === "POST" && path === "/website/password") {
      try {
        const body = await readBody(req);
        const agentId = normalizeString(body.agent_id || body.agentId);
        const password = normalizeString(body.web_password || body.password);
        if (!agentId) {
          return respond(res, 400, { error: "agent_id required" });
        }
        const auth = requireDashboardOrRuntimeCapability(claims, res, {
          scope: "website:update",
          agentId,
        });
        if (!auth) return;
        if (!requireRuntimeWebsiteFolderMatchesSession(auth, body, res)) return;
        if (!password) {
          return respond(res, 400, { error: "password required" });
        }
        const folder = resolveP86WebsiteAgentFolder(agentId, body);
        if (body.dry_run === true) {
          return respond(res, 200, {
            status: "website_password_dry_run",
            contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
            agent_id: agentId,
            agent_folder: folder,
            raw_password_returned: false,
          });
        }
        const result = persistAgentConfigUpdates(folder, {
          web_password: password,
        });
        persistP86WebsiteAgentFolder(agentId, body);
        return respond(res, 200, {
          status: "website_password_updated",
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
          agent_id: agentId,
          agent_folder: folder,
          config_mutated: result.changed === true,
          raw_password_returned: false,
          website: buildAgentWebsiteMetadata(agentId, folder),
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        });
      }
    }

    if (req.method === "GET" && path === "/provider-auth/status") {
      if (!requireDashboardMode(claims, res)) return;
      const providerId = normalizeString(url.searchParams.get("provider"));
      if (!providerId) {
        return respond(res, 400, { error: "provider required" });
      }
      try {
        const status = await providerAuthManager.getStatus(providerId);
        return respond(res, 200, {
          provider: providerId,
          provider_auth: serializeProviderAuthStatus(status),
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/provider-auth/start") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const providerId = normalizeString(body.provider);
      if (!providerId) {
        return respond(res, 400, { error: "provider required" });
      }
      try {
        const result = await providerAuthManager.startLogin(providerId);
        return respond(res, 200, {
          provider: providerId,
          provider_auth: serializeProviderAuthStatus(result.status),
          auth_job: result.job,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/provider-auth/job") {
      if (!requireDashboardMode(claims, res)) return;
      const jobId = normalizeString(url.searchParams.get("job_id"));
      if (!jobId) {
        return respond(res, 400, { error: "job_id required" });
      }
      const job = providerAuthManager.getJob(jobId);
      if (!job) {
        return respond(res, 404, { error: "Provider auth job not found" });
      }
      return respond(res, 200, {
        auth_job: job,
      });
    }

    if (req.method === "POST" && path === "/provider-auth/cancel") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const jobId = normalizeString(body.job_id);
      if (!jobId) {
        return respond(res, 400, { error: "job_id required" });
      }
      const job = providerAuthManager.cancelJob(jobId);
      if (!job) {
        return respond(res, 404, { error: "Provider auth job not found" });
      }
      return respond(res, 200, {
        status: "canceled",
        auth_job: job,
      });
    }

    if (req.method === "POST" && path === "/provider-auth/input") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const jobId = normalizeString(body.job_id);
      const inputText =
        typeof body.input_text === "string" ? body.input_text : "";
      if (!jobId) {
        return respond(res, 400, { error: "job_id required" });
      }
      try {
        const job = providerAuthManager.sendInput(jobId, inputText);
        if (!job) {
          return respond(res, 404, { error: "Provider auth job not found" });
        }
        return respond(res, 200, {
          status: "submitted",
          auth_job: job,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/terminal/start") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      try {
        const terminal = await terminalSessionManager.startSession(
          claims.user_id || "dashboard-admin",
          resolveTerminalLaunchCwd(body.cwd),
          { restart: body.restart === true }
        );
        return respond(res, 200, {
          terminal,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/terminal/session") {
      if (!requireDashboardMode(claims, res)) return;
      const terminalId = normalizeString(url.searchParams.get("terminal_id"));
      if (!terminalId) {
        return respond(res, 400, { error: "terminal_id required" });
      }
      try {
        const terminal = await terminalSessionManager.refreshSession(
          terminalId,
          claims.user_id || "dashboard-admin"
        );
        if (!terminal) {
          return respond(res, 404, { error: "Terminal session not found" });
        }
        return respond(res, 200, {
          terminal,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/terminal/input") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const terminalId = normalizeString(body.terminal_id);
      const text = typeof body.text === "string" ? body.text : "";
      if (!terminalId) {
        return respond(res, 400, { error: "terminal_id required" });
      }
      try {
        const terminal = await terminalSessionManager.sendText(
          terminalId,
          claims.user_id || "dashboard-admin",
          text,
          { pressEnter: body.press_enter === true }
        );
        if (!terminal) {
          return respond(res, 404, { error: "Terminal session not found" });
        }
        return respond(res, 200, {
          terminal,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/terminal/key") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const terminalId = normalizeString(body.terminal_id);
      const key = normalizeString(body.key);
      if (!terminalId) {
        return respond(res, 400, { error: "terminal_id required" });
      }
      if (!key) {
        return respond(res, 400, { error: "key required" });
      }
      try {
        const terminal = await terminalSessionManager.sendKey(
          terminalId,
          claims.user_id || "dashboard-admin",
          key
        );
        if (!terminal) {
          return respond(res, 404, { error: "Terminal session not found" });
        }
        return respond(res, 200, {
          terminal,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/terminal/close") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      const terminalId = normalizeString(body.terminal_id);
      if (!terminalId) {
        return respond(res, 400, { error: "terminal_id required" });
      }
      try {
        const terminal = await terminalSessionManager.closeSession(
          terminalId,
          claims.user_id || "dashboard-admin"
        );
        if (!terminal) {
          return respond(res, 404, { error: "Terminal session not found" });
        }
        return respond(res, 200, {
          terminal,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/dev/folders") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        return respond(
          res,
          200,
          await listFolderPage({
            path: url.searchParams.get("path"),
            offset: url.searchParams.get("offset"),
            limit: url.searchParams.get("limit"),
            q: url.searchParams.get("q"),
          })
        );
      } catch (err) {
        if (err?.code === "folder_access_denied") {
          return respond(res, 403, {
            code: "folder_access_denied",
            error: err.message,
            path: err.path || "",
            platform: err.platform || process.platform,
            reason: err.reason || "timeout",
            settings_uri: err.settings_uri,
            suggested_permission: err.suggested_permission,
          });
        }
        return respond(res, err?.status || 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/dev/folders/create") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readBody(req);
        return respond(
          res,
          201,
          await createFolder({
            parentPath: body.parent_path,
            folderName: body.folder_name,
          })
        );
      } catch (err) {
        const payload = { error: err.message };
        if (err?.code) {
          payload.code = err.code;
        }
        return respond(res, err?.status || 400, payload);
      }
    }

    if (req.method === "POST" && path === "/dev/open-permissions-settings") {
      if (!requireDashboardMode(claims, res)) return;
      if (!supportsMacFolderAccessPermissions()) {
        return respond(res, 501, {
          error:
            "macOS Full Disk Access settings are unavailable on this platform",
        });
      }
      try {
        await openFullDiskAccessSettings();
        return respond(res, 200, {
          status: "opened",
          settings_uri: FULL_DISK_ACCESS_SETTINGS_URI,
        });
      } catch (err) {
        return respond(res, 500, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/devices/push/status") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(
        res,
        200,
        buildApnsPushStatusPayload(claims.user_id || "dashboard-admin")
      );
    }

    if (req.method === "POST" && path === "/devices/push/register") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readBody(req);
        const apnsToken = String(body.apns_token || body.token || "").trim().toLowerCase();

        // P207: Cloud-mediated registration is owned by the app installation
        // credential. The Host no longer proxies APNs tokens to Cloud using
        // device_token. When the Host is not cloud-registered, fall back to the
        // legacy local store (offline mode).
        if (BACKEND_URL && DEVICE_TOKEN) {
          return respond(res, 410, {
            error: "cloud_app_push_registration_required",
            message:
              "Cloud APNs token registration must use the app installation credential.",
          });
        }

        // Offline fallback: no cloud relationship → legacy local store.
        const config = readApnsLocalConfig(getConfigDir());
        if (!config.enabled) {
          return respond(res, 400, {
            error: config.error || "APNs local config is not enabled",
            push: buildApnsPushStatusPayload(claims.user_id || "dashboard-admin"),
          });
        }
        const device = apnsDeviceStore.upsertDevice({
          userId: claims.user_id || "dashboard-admin",
          installationId: body.installation_id,
          token: apnsToken,
          topic: config.topic,
          environment: config.environment,
          platform: "ios",
          deviceName: body.device_name,
          appVersion: body.app_version,
        });
        return respond(res, 200, {
          status: "registered",
          device: serializeApnsDevice(device),
          push: buildApnsPushStatusPayload(claims.user_id || "dashboard-admin"),
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/devices/push/unregister") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readBody(req);
        const result = apnsDeviceStore.unregisterDevice({
          userId: claims.user_id || "dashboard-admin",
          installationId: body.installation_id,
        });
        return respond(res, 200, {
          status: "unregistered",
          ...result,
          push: buildApnsPushStatusPayload(claims.user_id || "dashboard-admin"),
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && path === "/devices/push/test") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readBody(req);
        const results = await sendApnsTestNotification({
          userId: claims.user_id || "dashboard-admin",
          installationId:
            typeof body.installation_id === "string" ? body.installation_id : "",
        });
        return respond(res, 200, {
          status: "sent",
          results,
          push: buildApnsPushStatusPayload(claims.user_id || "dashboard-admin"),
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          push: buildApnsPushStatusPayload(claims.user_id || "dashboard-admin"),
        });
      }
    }

    if (req.method === "GET" && path === "/notifications/status") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(res, 200, {
        status: "notifications_status",
        contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
        cloud_configured: Boolean(BACKEND_URL && DEVICE_TOKEN),
        push: buildApnsPushStatusPayload(claims.user_id || "dashboard-admin"),
        token_redacted: true,
      });
    }

    if (req.method === "POST" && path === "/notifications/send") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readBody(req);
        const title = normalizeString(body.title) || "Oysterun";
        const message = normalizeString(body.body || body.text);
        const route = normalizeString(body.url || body.route) || "/app";
        if (!message) {
          return respond(res, 400, { error: "body is required" });
        }
        const payload = {
          dedupe_key:
            normalizeString(body.dedupe_key || body.dedupeKey) ||
            `cli-notification-${Date.now()}`,
          session_id: "cli-notification",
          semantic_type: "cli_notification",
          title,
          body: message,
          route,
        };
        if (body.dry_run === true) {
          return respond(res, 200, {
            status: "notification_send_dry_run",
            contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
            request: payload,
            token_redacted: true,
          });
        }
        const backendUrl = normalizeString(BACKEND_URL).replace(/\/+$/, "");
        const deviceToken = normalizeString(DEVICE_TOKEN);
        if (!backendUrl || !deviceToken) {
          return respond(res, 409, {
            error: "notification_delivery_target_unavailable",
            message:
              "Cloud push is not configured. Use notifications status for setup details.",
            contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
            push: buildApnsPushStatusPayload(
              claims.user_id || "dashboard-admin"
            ),
            token_redacted: true,
          });
        }
        const response = await fetch(
          buildCloudApiUrl(
            backendUrl,
            "/api/notifications/candidates",
            BACKEND_STAGE
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${deviceToken}`,
            },
            body: JSON.stringify(payload),
          }
        );
        let data = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (!response.ok || data?.accepted === false) {
          return respond(res, response.ok ? 502 : response.status, {
            error:
              data?.reason ||
              `Cloud notification candidate failed (HTTP ${response.status})`,
            contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
            token_redacted: true,
          });
        }
        return respond(res, 200, {
          status: "notification_sent",
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
          delivery: "cloud",
          status_code: response.status,
          selected_token_count: data?.selected_token_count ?? null,
          token_redacted: true,
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          contract: P86_PRODUCT_CLI_ENDPOINT_CONTRACT,
          token_redacted: true,
        });
      }
    }

    if (req.method === "GET" && path === "/dev/preferences") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        return respond(res, 200, buildHostPreferencesPayload());
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "PUT" && path === "/dev/preferences") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readBody(req);
        const currentConfig = readConfig();
        if (
          !Object.prototype.hasOwnProperty.call(body, "display_name") &&
          !Object.prototype.hasOwnProperty.call(
            body,
            "notification_sound_web_enabled"
          ) &&
          !Object.prototype.hasOwnProperty.call(
            body,
            "notification_sound_app_enabled"
          ) &&
          !Object.prototype.hasOwnProperty.call(body, "default_browse_path") &&
          !Object.prototype.hasOwnProperty.call(body, "public_base_url") &&
          !Object.prototype.hasOwnProperty.call(body, "direct_host_url") &&
          !Object.prototype.hasOwnProperty.call(body, "claude_command") &&
          !Object.prototype.hasOwnProperty.call(body, "codex_command") &&
          !Object.prototype.hasOwnProperty.call(body, "session_defaults")
        ) {
          return respond(res, 400, {
            error:
              "display_name, notification_sound_web_enabled, notification_sound_app_enabled, default_browse_path, direct_host_url, claude_command, codex_command, or session_defaults required",
          });
        }

        const updates = {};

        if (Object.prototype.hasOwnProperty.call(body, "display_name")) {
          const rawDisplayName = body.display_name;
          if (
            rawDisplayName !== null &&
            rawDisplayName !== undefined &&
            typeof rawDisplayName !== "string"
          ) {
            return respond(res, 400, {
              error: "display_name must be a string or null",
            });
          }
          updates.display_name =
            typeof rawDisplayName === "string" && rawDisplayName.trim()
              ? rawDisplayName.trim()
              : getDefaultHostDisplayName();
        }

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "notification_sound_web_enabled"
          )
        ) {
          if (typeof body.notification_sound_web_enabled !== "boolean") {
            return respond(res, 400, {
              error: "notification_sound_web_enabled must be a boolean",
            });
          }
          updates.notification_sound_web_enabled =
            body.notification_sound_web_enabled;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "notification_sound_app_enabled"
          )
        ) {
          if (typeof body.notification_sound_app_enabled !== "boolean") {
            return respond(res, 400, {
              error: "notification_sound_app_enabled must be a boolean",
            });
          }
          updates.notification_sound_app_enabled =
            body.notification_sound_app_enabled;
        }

        if (Object.prototype.hasOwnProperty.call(body, "default_browse_path")) {
          const rawPath = body.default_browse_path;
          if (typeof rawPath !== "string") {
            return respond(res, 400, {
              error: "default_browse_path must be a non-empty string",
            });
          }
          if (!rawPath.trim()) {
            return respond(res, 400, {
              error: "Default Browse Root is required",
            });
          }

          updates.default_browse_path = resolveDirectoryPath(rawPath);
        }

        if (Object.prototype.hasOwnProperty.call(body, "claude_command")) {
          const rawClaudeCommand = body.claude_command;
          if (
            rawClaudeCommand !== null &&
            rawClaudeCommand !== undefined &&
            typeof rawClaudeCommand !== "string"
          ) {
            return respond(res, 400, {
              error: "claude_command must be a string or null",
            });
          }
          updates.claude_command =
            typeof rawClaudeCommand === "string" && rawClaudeCommand.trim()
              ? rawClaudeCommand.trim()
              : null;
        }

        if (Object.prototype.hasOwnProperty.call(body, "codex_command")) {
          const rawCodexCommand = body.codex_command;
          if (
            rawCodexCommand !== null &&
            rawCodexCommand !== undefined &&
            typeof rawCodexCommand !== "string"
          ) {
            return respond(res, 400, {
              error: "codex_command must be a string or null",
            });
          }
          updates.codex_command =
            typeof rawCodexCommand === "string" && rawCodexCommand.trim()
              ? rawCodexCommand.trim()
              : null;
        }

        if (
          Object.prototype.hasOwnProperty.call(body, "direct_host_url") ||
          Object.prototype.hasOwnProperty.call(body, "public_base_url")
        ) {
          const normalizedDirectHostUrl = normalizePublicBaseUrlInput(
            Object.prototype.hasOwnProperty.call(body, "direct_host_url")
              ? body.direct_host_url
              : body.public_base_url
          );
          updates.direct_host_url = normalizedDirectHostUrl;
          updates.public_base_url = normalizedDirectHostUrl;
        }

        if (Object.prototype.hasOwnProperty.call(body, "session_defaults")) {
          if (
            !body.session_defaults ||
            typeof body.session_defaults !== "object" ||
            Array.isArray(body.session_defaults)
          ) {
            return respond(res, 400, {
              error: "session_defaults must be an object",
            });
          }
          validateSessionDefaultsProviderPermissionRequest({
            sessionDefaults: {
              ...body.session_defaults,
              confirm_beta_provider_permission_mode:
                body.confirm_beta_provider_permission_mode === true ||
                body.confirmBetaProviderPermissionMode === true ||
                body.session_defaults.confirm_beta_provider_permission_mode ===
                  true ||
                body.session_defaults.confirmBetaProviderPermissionMode === true,
            },
            config: currentConfig,
          });
          updates.session_defaults = normalizeHostPreferencesSessionDefaults(
            currentConfig.session_defaults || {},
            body.session_defaults,
            {
              providerPermissionDebugModeEnabled:
                isProviderPermissionDebugModeEnabled(currentConfig),
            }
          );
        }

        writeConfig(updates);
        return respond(res, 200, {
          status: "updated",
          preferences: buildHostPreferencesPayload(),
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/dev/file") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        return respond(
          res,
          200,
          readDevFilePreview(url.searchParams.get("path"))
        );
      } catch (err) {
        console.error("[oysterun-host] Failed to read dev file preview", err);
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/dev/file-download") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        return respondDevFileDownload(
          res,
          buildDevFileDownload(url.searchParams.get("path"))
        );
      } catch (err) {
        console.error("[oysterun-host] Failed to download dev file", err);
        return respond(res, err.status || 400, err.body || { error: err.message });
      }
    }

    if (req.method === "PUT" && path === "/dev/file") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        const body = await readBody(req);
        const filePath = body.path;
        const content = body.content;
        if (!filePath || typeof filePath !== "string") {
          return respond(res, 400, { error: "path is required" });
        }
        if (typeof content !== "string") {
          return respond(res, 400, { error: "content must be a string" });
        }
        const { realPath, requested_path } = resolveDevFilePath(filePath);
        writeFileSync(realPath, content, "utf-8");
        const newStats = statSync(realPath);
        return respond(res, 200, {
          path: requested_path,
          base_path: realPath,
          size_bytes: newStats.size,
        });
      } catch (err) {
        console.error("[oysterun-host] Failed to write dev file", err);
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/dev/file-text") {
      if (!requireDashboardMode(claims, res)) return;
      try {
        return respond(
          res,
          200,
          readDevFileTextContent(url.searchParams.get("path"))
        );
      } catch (err) {
        console.error("[oysterun-host] Failed to read dev file text", err);
        return respond(res, 400, { error: err.message });
      }
    }

    if (req.method === "GET" && path === "/dev/folder-config") {
      if (!requireDashboardMode(claims, res)) return;
      const folderPath = url.searchParams.get("path");
      const providerOverride = normalizeString(
        url.searchParams.get("provider")
      );
      if (!folderPath) {
        return respond(res, 400, { error: "path query param required" });
      }
      try {
        const summary = summarizeAgentConfig(folderPath);
        const resolved = resolveAgentRuntimeConfig(
          folderPath,
          providerOverride ? { provider: providerOverride } : {}
        );
        return respond(res, 200, {
          agent_folder: summary.folderPath,
          hasConfig: summary.hasConfig,
          hasLocalConfig: summary.hasLocalConfig,
          hasDefaultConfig: summary.hasDefaultConfig,
          configPath: summary.configPath,
          localConfigPath: summary.localConfigPath,
          defaultConfigPath: summary.defaultConfigPath,
          interfaceType: summary.interfaceType,
          provider: resolved.runtime.provider,
          providerInfo: serializeProvider(resolved.runtime.providerInfo),
          model: resolved.runtime.model,
          reasoningEffort: resolved.runtime.reasoningEffort,
          permissionMode: resolved.runtime.permissionMode,
          approvalPolicy: resolved.runtime.approvalPolicy,
          sandboxMode: resolved.runtime.sandboxMode,
          dangerousMode: resolved.runtime.dangerousMode === true,
          allowDangerouslySkipPermissions:
            resolved.runtime.allowDangerouslySkipPermissions === true,
          searchEnabled: resolved.runtime.searchEnabled === true,
          imageInputEnabled: resolved.runtime.imageInputEnabled === true,
          webAccess: resolved.layers.web.access,
          webEnabled: resolved.layers.web.enabled === true,
          notifications: serializeAgentNotificationConfig(
            resolved.layers.notifications
          ),
          telegram: serializeAgentTelegramConfig(
            resolveAgentTelegramConfigFromLayers(resolved.layers)
          ),
          website: buildAgentWebsiteMetadata("preview", summary.folderPath),
          runtime_capabilities: serializeRuntimeCapabilities(
            resolveConfiguredRuntimeCapabilities(resolved.config)
          ),
          sharedAllowedPaths: resolveSharedAllowedPaths(
            resolved.layers.sharedConfig
          ),
          workspacePolicy: serializeWorkspacePolicy(
            resolved.runtime.workspacePolicy
          ),
          rawConfig: resolved.config,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    // ── GET /agent/config?agent_id=… ───────────────────────
    if (req.method === "GET" && path === "/agent/config") {
      const agent_id = url.searchParams.get("agent_id");
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id query param required" });
      }

      const session = sessionManager.getAgentSession(agent_id);
      const folder = session?.cwd || getAgentFolder(agent_id);
      if (!folder) {
        if (!checkAgentAccess(claims, agent_id, res)) return;
        return respond(res, 200, {
          agent_id,
          config: null,
          hasConfig: false,
          interfaceType: "coding",
          provider: "claude",
          providerInfo: serializeConfiguredProvider("claude"),
          allowDangerouslySkipPermissions: false,
          runtime_capabilities: serializeRuntimeCapabilities(),
          coderSettings: buildCoderSettings(null),
          native: buildNativePayload(null),
        });
      }

      try {
        if (!checkAgentAccess(claims, agent_id, res)) return;
        const summary = summarizeAgentConfig(folder);
        const resolved = resolveAgentRuntimeConfig(folder);
        return respond(res, 200, {
          agent_id,
          agent_folder: summary.folderPath,
          hasConfig: summary.hasConfig,
          hasLocalConfig: summary.hasLocalConfig,
          hasDefaultConfig: summary.hasDefaultConfig,
          interfaceType: summary.interfaceType,
          provider: resolved.runtime.provider,
          providerInfo: serializeProvider(resolved.runtime.providerInfo),
          allowDangerouslySkipPermissions:
            resolved.runtime.allowDangerouslySkipPermissions === true,
          configPath: summary.configPath,
          localConfigPath: summary.localConfigPath,
          defaultConfigPath: summary.defaultConfigPath,
          model: resolved.runtime.model,
          reasoningEffort: resolved.runtime.reasoningEffort,
          permissionMode: resolved.runtime.permissionMode,
          approvalPolicy: resolved.runtime.approvalPolicy,
          sandboxMode: resolved.runtime.sandboxMode,
          dangerousMode: resolved.runtime.dangerousMode === true,
          searchEnabled: resolved.runtime.searchEnabled === true,
          imageInputEnabled: resolved.runtime.imageInputEnabled === true,
          webAccess: resolved.layers.web.access,
          webEnabled: resolved.layers.web.enabled === true,
          notifications: serializeAgentNotificationConfig(
            resolved.layers.notifications
          ),
          telegram: serializeAgentTelegramConfig(
            resolveAgentTelegramConfigFromLayers(resolved.layers)
          ),
          website: buildAgentWebsiteMetadata(agent_id, summary.folderPath),
          runtime_capabilities: serializeRuntimeCapabilities(
            resolveConfiguredRuntimeCapabilities(resolved.config)
          ),
          coderSettings: buildCoderSettings(resolved.runtime),
          native: buildNativePayload(resolved.runtime),
          sharedAllowedPaths: resolveSharedAllowedPaths(
            resolved.layers.sharedConfig
          ),
          workspacePolicy: serializeWorkspacePolicy(
            resolved.runtime.workspacePolicy
          ),
          rawConfig: resolved.config,
        });
      } catch (err) {
        if (!checkAgentAccess(claims, agent_id, res)) return;
        return respond(res, 200, {
          agent_id,
          error: err.message,
          agent_folder: folder,
          provider: session?.provider || null,
          workspacePolicy: serializeWorkspacePolicy(
            session?.workspacePolicy ?? null
          ),
        });
      }
    }

    // ── PUT /agent/config ─────────────────────────────────
    // Update .oysterun config for coder session provider/runtime settings
    if (req.method === "PUT" && path === "/agent/config") {
      const body = await readBody(req);
      const { agent_id } = body;
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id required" });
      }
      if (!requireAgentCapability(claims, agent_id, "can_manage_config", res))
        return;

      const session = sessionManager.getAgentSession(agent_id);
      const folder =
        session?.cwd || getAgentFolder(agent_id) || body.agent_folder || null;
      if (!folder) {
        return respond(res, 404, {
          error:
            "No folder mapping found for this agent. Provide agent_folder or start a session first.",
        });
      }

      const explicitProvider = readExplicitRequestedProvider(body);
      if (explicitProvider.error) {
        return respond(res, 400, { error: explicitProvider.error });
      }
      const resolved = resolveAgentRuntimeConfig(
        folder,
        buildRuntimeOverridesFromBody(
          body,
          explicitProvider.requestedProvider ?? undefined
        )
      );
      try {
        validateProviderPermissionRequest({
          body,
          providerId: resolved.runtime.provider,
          config: readConfig(),
          source: "agent_config",
        });
      } catch (err) {
        return respond(res, 400, { error: err.message, config_mutated: false });
      }
      if (
        explicitProvider.requestedProvider &&
        resolved.runtime.provider !== explicitProvider.requestedProvider
      ) {
        return respond(
          res,
          500,
          providerMismatchResponse(
            explicitProvider.requestedProvider,
            resolved.runtime.provider
          )
        );
      }
      let normalizedConfigPayload;
      let result;
      try {
        normalizedConfigPayload = buildNormalizedConfigPayload(
          body,
          resolved.runtime
        );
        if (hasTelegramConfigUpdate(normalizedConfigPayload)) {
          assertTelegramEnabledSetupReady(
            buildEffectiveTelegramRuntimeConfig(
              buildResolvedSessionTelegramConfig(resolved.layers),
              normalizedConfigPayload
            )
          );
        }
        result = persistAgentConfigUpdates(folder, normalizedConfigPayload);
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          config_mutated: false,
        });
      }
      return respond(res, 200, { status: "updated", config: result.config });
    }

    // ── GET /agent/commands?agent_id=… ──────────────────────
    // Read slash commands from .claude/commands/ in the agent folder
    if (req.method === "GET" && path === "/agent/commands") {
      const agent_id = url.searchParams.get("agent_id");
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      if (!requireAgentCapability(claims, agent_id, "can_chat", res)) return;

      const session = sessionManager.getAgentSession(agent_id);
      const folder = session?.cwd || getAgentFolder(agent_id);
      let providerId = session?.provider || null;
      if (!providerId && folder && existsSync(folder)) {
        try {
          providerId = summarizeAgentConfig(folder).provider;
        } catch {
          providerId = null;
        }
      }
      providerId = providerId || "claude";

      if (providerId !== "claude") {
        return respond(res, 200, {
          agent_id,
          provider: providerId,
          commands: [],
          note: "Provider-native commands are only wired for Claude in Phase 1",
        });
      }

      if (!session) {
        return respond(res, 200, {
          agent_id,
          provider: providerId,
          commands: [],
        });
      }

      const commandsDir = join(session.cwd, ".claude", "commands");
      const commands = [];
      try {
        const files = readdirSync(commandsDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const name = file.replace(/\.md$/, "");
          try {
            const content = readFileSync(join(commandsDir, file), "utf-8");
            // Extract first line as title (strip # prefix)
            const firstLine = content.split("\n").find((l) => l.trim()) || name;
            const title = firstLine.replace(/^#+\s*/, "").trim();
            commands.push({ name, title, file });
          } catch {
            commands.push({ name, title: name, file });
          }
        }
      } catch {
        // No commands directory
      }

      return respond(res, 200, { agent_id, provider: providerId, commands });
    }

    // ── GET /agent/provider-skill-status?agent_id=… ─────────
    if (req.method === "GET" && path === "/agent/provider-skill-status") {
      const agent_id = url.searchParams.get("agent_id");
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      if (!requireAgentCapability(claims, agent_id, "can_start_session", res))
        return;
      let folder = getAgentFolder(agent_id);
      const requestedFolder = normalizeString(url.searchParams.get("agent_folder"));
      if (claims._dashboardAuth && requestedFolder) {
        folder = requestedFolder;
      }
      if (!folder) {
        return respond(res, 400, {
          error: "No local folder mapping configured for this agent",
        });
      }
      const requestedProvider = normalizeString(url.searchParams.get("provider"));
      let providerId = requestedProvider || null;
      if (!providerId) {
        try {
          providerId = summarizeAgentConfig(folder).provider;
        } catch {
          providerId = "claude";
        }
      }
      try {
        const status = sessionManager.getOysterunProviderSkillInstallationStatus({
          cwd: folder,
          provider: providerId,
        });
        return respond(res, 200, {
          agent_id,
          agent_folder: folder,
          ...status,
        });
      } catch (err) {
        if (isProductSkillRequirementError(err)) {
          return respond(
            res,
            err.statusCode || 409,
            serializeProductSkillRequirementError(err)
          );
        }
        throw err;
      }
    }

    // ── GET /agent/provider-trust-status?agent_id=… ────────
    if (req.method === "GET" && path === "/agent/provider-trust-status") {
      const agent_id = url.searchParams.get("agent_id");
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      if (!requireAgentCapability(claims, agent_id, "can_start_session", res))
        return;
      let folder = getAgentFolder(agent_id);
      const requestedFolder = normalizeString(url.searchParams.get("agent_folder"));
      if (claims._dashboardAuth && requestedFolder) {
        folder = requestedFolder;
      }
      if (!folder) {
        return respond(res, 400, {
          error: "No local folder mapping configured for this agent",
        });
      }
      const requestedProvider = normalizeString(url.searchParams.get("provider"));
      let providerId = requestedProvider || null;
      if (!providerId) {
        try {
          providerId = summarizeAgentConfig(folder).provider;
        } catch {
          providerId = "claude";
        }
      }
      const status = sessionManager.getProviderTrustedFolderStatus({
        cwd: folder,
        provider: providerId,
      });
      return respond(res, 200, {
        agent_id,
        agent_folder: folder,
        ...status,
      });
    }

    // ── GET /session/history?session_id=… ─────────────────
    if (req.method === "GET" && path === "/session/history") {
      const session_id = url.searchParams.get("session_id");
      const session = requireSessionCapabilityOrRuntimeScope(
        claims,
        session_id,
        "can_chat",
        "session:read_transcript",
        res
      );
      if (!session) return;

      const messages = messageBuffers.get(session.id) || [];
      return respond(res, 200, {
        session_id: session.id,
        agent_id: session.agentId,
        messages,
      });
    }

    // ── Current-session in-session loop CRUD (P12.3 GUI) ──────
    if (req.method === "GET" && path === "/session/loops") {
      const session_id = url.searchParams.get("session_id");
      const session = requireSessionCapabilityOrRuntimeScope(
        claims,
        session_id,
        "can_chat",
        "session:send",
        res
      );
      if (!session) return;
      return respond(res, 200, {
        status: "session_loop_schedules",
        session_id: session.id,
        agent_id: session.agentId,
        schedules: schedulerService.listSessionLoopSchedulesForGui({
          hostSessionId: session.id,
          agentId: session.agentId,
          agentFolder: session.cwd,
        }),
        serialization_scope: "authenticated_current_session_loop_gui",
        storage_owner: "agent_folder_oysterun_loops_json",
        runtime_state_owner: "host_session_memory_only",
        host_owned_scheduler_db: false,
        generic_cli_serialization_remains_redacted: true,
        browser_local_storage_owner: false,
        matrix_db_owner: false,
      });
    }

    if (req.method === "POST" && path === "/session/loops") {
      const body = await readBody(req);
      const session = requireSessionCapability(
        claims,
        body.session_id,
        "can_chat",
        res
      );
      if (!session) return;
      try {
        const result = schedulerService.createSessionLoopScheduleForGui({
          hostSessionId: session.id,
          agentId: session.agentId,
          agentFolder: session.cwd,
          createdBy: claims.user_id,
          interval: body.interval,
          prompt: body.command_text ?? body.prompt_text ?? body.prompt,
          startAt: body.start_at ?? null,
          endAt: body.end_at ?? null,
          enabled: body.enabled === true,
        });
        const feedback = await writeLoopFeedbackOrThrow({
          session,
          action: classifyLoopFeedbackAction({ result }),
          schedule: result.feedback_schedule || result.schedule,
        });
        return respond(res, result.status === "created" ? 201 : 200, {
          ...result,
          session_id: session.id,
          agent_id: session.agentId,
          serialization_scope: "authenticated_current_session_loop_gui",
          matrix_feedback: feedback,
        });
      } catch (err) {
        return respond(res, getSessionLoopCrudErrorStatus(err), {
          error: err.message,
          scheduler_command: "session_loop_gui",
        });
      }
    }

    const sessionLoopMatch = path.match(/^\/session\/loops\/([^/]+)$/);
    if (
      sessionLoopMatch &&
      (req.method === "PATCH" || req.method === "DELETE")
    ) {
      const scheduleId = decodeURIComponent(sessionLoopMatch[1]);
      const body = await readBody(req);
      const session = requireSessionCapability(
        claims,
        body.session_id,
        "can_chat",
        res
      );
      if (!session) return;
      try {
        const before = schedulerService
          .listSessionLoopSchedulesForGui({
            hostSessionId: session.id,
            agentId: session.agentId,
            agentFolder: session.cwd,
          })
          .find((row) => row.id === scheduleId);
        if (req.method === "DELETE") {
          const result = schedulerService.deleteSessionLoopScheduleForGui({
            hostSessionId: session.id,
            agentId: session.agentId,
            agentFolder: session.cwd,
            scheduleId,
          });
          const feedback = await writeLoopFeedbackOrThrow({
            session,
            action: classifyLoopFeedbackAction({
              result,
              before,
              deleted: true,
            }),
            schedule: result.feedback_schedule || before || result,
          });
          return respond(res, 200, { ...result, matrix_feedback: feedback });
        }
        const result = schedulerService.updateSessionLoopScheduleForGui({
          hostSessionId: session.id,
          agentId: session.agentId,
          agentFolder: session.cwd,
          scheduleId,
          interval: body.interval,
          prompt: body.command_text ?? body.prompt_text ?? body.prompt,
          startAt: body.start_at ?? null,
          endAt: body.end_at ?? null,
          enabled: body.enabled === true,
          runtimeOnly: body.runtime_only === true,
        });
        const feedback = await writeLoopFeedbackOrThrow({
          session,
          action: classifyLoopFeedbackAction({ result, before }),
          schedule: result.feedback_schedule || result.schedule,
        });
        return respond(res, 200, {
          ...result,
          session_id: session.id,
          agent_id: session.agentId,
          serialization_scope: "authenticated_current_session_loop_gui",
          matrix_feedback: feedback,
        });
      } catch (err) {
        return respond(res, getSessionLoopCrudErrorStatus(err), {
          error: err.message,
          scheduler_command: "session_loop_gui",
        });
      }
    }

    // ── Host scheduler dashboard CRUD (P12.5 Scheduler tab) ──────
    if (req.method === "GET" && path === "/scheduler/schedules") {
      if (!requireDashboardMode(claims, res)) return;
      return respond(res, 200, {
        status: "host_scheduler_schedules",
        host_timezone: getHostSystemTimezone(),
        schedules: schedulerService.listHostSchedulesForDashboard(),
        serialization_scope: "authenticated_dashboard_host_scheduler_ui",
        storage_owner: "agent_folder_oysterun_schedulers_json",
        browser_local_storage_owner: false,
        matrix_db_owner: false,
      });
    }

    if (req.method === "POST" && path === "/scheduler/schedules") {
      if (!requireDashboardMode(claims, res)) return;
      const body = await readBody(req);
      try {
        const result = schedulerService.createHostScheduleForDashboard({
          ...buildHostSchedulerPayloadFromBody(body),
          createdBy: claims.user_id || "dashboard-admin",
        });
        return respond(res, 201, {
          ...result,
          serialization_scope: "authenticated_dashboard_host_scheduler_ui",
        });
      } catch (err) {
        return respond(res, getHostSchedulerCrudErrorStatus(err), {
          error: err.message,
          scheduler_command: "host_scheduler_ui",
        });
      }
    }

    const hostSchedulerRunLogMatch = path.match(
      /^\/scheduler\/schedules\/([^/]+)\/runs\/([^/]+)\/log$/
    );
    if (hostSchedulerRunLogMatch) {
      if (!requireDashboardMode(claims, res)) return;
      const scheduleId = decodeURIComponent(hostSchedulerRunLogMatch[1]);
      const runId = decodeURIComponent(hostSchedulerRunLogMatch[2]);
      if (req.method === "GET") {
        try {
          return respond(res, 200, {
            status: "host_scheduler_run_log",
            schedule_id: scheduleId,
            run_id: runId,
            log: schedulerService.getHostScheduleRunLogForDashboard({
              scheduleId,
              runId,
            }),
            scheduler_command: "host_scheduler_run_log",
            serialization_scope: "authenticated_dashboard_host_scheduler_ui",
            storage_owner: "agent_folder_oysterun_schedulers_json",
            browser_local_storage_owner: false,
            matrix_db_owner: false,
          });
        } catch (err) {
          return respond(res, getHostSchedulerCrudErrorStatus(err), {
            error: err.message,
            scheduler_command: "host_scheduler_run_log",
          });
        }
      }
    }

    const hostSchedulerRunsMatch = path.match(
      /^\/scheduler\/schedules\/([^/]+)\/runs$/
    );
    if (hostSchedulerRunsMatch) {
      if (!requireDashboardMode(claims, res)) return;
      const scheduleId = decodeURIComponent(hostSchedulerRunsMatch[1]);
      if (req.method === "GET") {
        const requestedLimit = Number(url.searchParams.get("limit") || 25);
        const limit =
          Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, 100)
            : 25;
        try {
          return respond(res, 200, {
            status: "host_scheduler_runs",
            schedule_id: scheduleId,
            runs: schedulerService.listHostScheduleRunsForDashboard(scheduleId, {
              limit,
            }),
            scheduler_command: "host_scheduler_runs",
            serialization_scope: "authenticated_dashboard_host_scheduler_ui",
            storage_owner: "agent_folder_oysterun_schedulers_json",
            browser_local_storage_owner: false,
            matrix_db_owner: false,
          });
        } catch (err) {
          return respond(res, getHostSchedulerCrudErrorStatus(err), {
            error: err.message,
            scheduler_command: "host_scheduler_runs",
          });
        }
      }
    }

    const hostSchedulerTestRunMatch = path.match(
      /^\/scheduler\/schedules\/([^/]+)\/test-run$/
    );
    if (hostSchedulerTestRunMatch) {
      if (!requireDashboardMode(claims, res)) return;
      const scheduleId = decodeURIComponent(hostSchedulerTestRunMatch[1]);
      if (req.method === "POST") {
        try {
          const result = await schedulerService.runHostScheduleTestForDashboard({
            scheduleId,
            dispatcher: schedulerSessionDispatcher,
          });
          return respond(res, 200, {
            ...result,
            scheduler_command: "host_scheduler_test_run",
            serialization_scope: "authenticated_dashboard_host_scheduler_ui",
            storage_owner: "agent_folder_oysterun_schedulers_json",
            browser_local_storage_owner: false,
            matrix_db_owner: false,
          });
        } catch (err) {
          return respond(res, getHostSchedulerCrudErrorStatus(err), {
            error: err.message,
            scheduler_command: "host_scheduler_test_run",
          });
        }
      }
    }

    const hostSchedulerMatch = path.match(/^\/scheduler\/schedules\/([^/]+)$/);
    if (hostSchedulerMatch) {
      if (!requireDashboardMode(claims, res)) return;
      const scheduleId = decodeURIComponent(hostSchedulerMatch[1]);
      if (req.method === "GET") {
        try {
          return respond(res, 200, {
            status: "host_scheduler_schedule",
            schedule: schedulerService.getHostScheduleForDashboard(scheduleId),
            serialization_scope: "authenticated_dashboard_host_scheduler_ui",
          });
        } catch (err) {
          return respond(res, getHostSchedulerCrudErrorStatus(err), {
            error: err.message,
            scheduler_command: "host_scheduler_ui",
          });
        }
      }
      if (req.method === "PATCH") {
        const body = await readBody(req);
        try {
          const result = schedulerService.updateHostScheduleForDashboard({
            scheduleId,
            ...buildHostSchedulerPatchPayloadFromBody(body),
          });
          return respond(res, 200, {
            ...result,
            serialization_scope: "authenticated_dashboard_host_scheduler_ui",
          });
        } catch (err) {
          return respond(res, getHostSchedulerCrudErrorStatus(err), {
            error: err.message,
            scheduler_command: "host_scheduler_ui",
          });
        }
      }
      if (req.method === "DELETE") {
        try {
          return respond(
            res,
            200,
            schedulerService.deleteHostScheduleForDashboard({ scheduleId })
          );
        } catch (err) {
          return respond(res, getHostSchedulerCrudErrorStatus(err), {
            error: err.message,
            scheduler_command: "host_scheduler_ui",
          });
        }
      }
    }

    // ── POST /session/start ────────────────────────────────
    if (req.method === "POST" && path === "/session/start") {
      const body = await readBody(req);
      const { agent_id, agent_folder, interface_type, session_name } = body;

      if (!agent_id) {
        return respond(res, 400, { error: "agent_id required" });
      }
      if (!requireAgentCapability(claims, agent_id, "can_start_session", res))
        return;

      let resolvedFolder = getAgentFolder(agent_id);
      if (claims._dashboardAuth && agent_folder) {
        resolvedFolder = agent_folder;
        setAgentFolder(agent_id, resolvedFolder);
      }
      if (!resolvedFolder) {
        return respond(res, 400, {
          error: "No local folder mapping configured for this agent",
        });
      }

      const explicitProvider = readExplicitRequestedProvider(body);
      if (explicitProvider.error) {
        return respond(res, 400, { error: explicitProvider.error });
      }
      const resolved = resolveAgentRuntimeConfig(
        resolvedFolder,
        buildRuntimeOverridesFromBody(
          body,
          explicitProvider.requestedProvider ?? undefined
        )
      );
      try {
        validateProviderPermissionRequest({
          body,
          providerId: resolved.runtime.provider,
          config: readConfig(),
          source: "session_start",
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      if (
        explicitProvider.requestedProvider &&
        resolved.runtime.provider !== explicitProvider.requestedProvider
      ) {
        console.error(
          `[session/start] provider mismatch requested=${explicitProvider.requestedProvider} resolved=${resolved.runtime.provider}`
        );
        return respond(
          res,
          500,
          providerMismatchResponse(
            explicitProvider.requestedProvider,
            resolved.runtime.provider
          )
        );
      }
      if (!resolved.runtime.providerInfo.runtimeSupported) {
        return respond(res, 501, {
          error: `Provider "${resolved.runtime.provider}" is not runtime-supported yet`,
          provider: resolved.runtime.provider,
          provider_info: serializeProvider(resolved.runtime.providerInfo),
          coder_settings: buildCoderSettings(resolved.runtime),
          native: buildNativePayload(resolved.runtime),
        });
      }
      const startProofFields = buildSessionSetupProviderModelPermissionFields({
        body,
        requestedProvider: explicitProvider.requestedProvider,
        resolved,
      });
      if (!startProofFields.request_response_provider_model_permission_match) {
        console.error(
          `[session/start] proof mismatch requested_provider=${
            startProofFields.requestedProvider || "missing"
          }` +
            ` resolved_provider=${startProofFields.provider || "missing"}` +
            ` requested_model=${startProofFields.requestedModel || "missing"}` +
            ` resolved_model=${startProofFields.model || "missing"}`
        );
        return respond(
          res,
          409,
          sessionSetupProviderModelPermissionMismatchResponse(startProofFields)
        );
      }
      let resolvedSessionName;
      try {
        resolvedSessionName = resolveRequestedSessionName(
          session_name,
          agent_id,
          sessionManager
        );
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      if (sessionManager.hasRunningSessionName(resolvedSessionName)) {
        return respond(res, 409, {
          error: buildSessionNameConflictMessage(resolvedSessionName),
        });
      }
      const sessionRuntimeCapabilities =
        resolveRuntimeCapabilitiesForSessionStart(resolved.config, body);
      let telegramSessionConfigRequest;
      try {
        telegramSessionConfigRequest = normalizeTelegramConfigPayload(body);
        assertTelegramEnabledSetupReady(
          buildEffectiveTelegramRuntimeConfig(
            buildResolvedSessionTelegramConfig(resolved.layers),
            telegramSessionConfigRequest
          )
        );
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      try {
        ensureRequestedWebsiteScaffoldBeforeSession({
          agentId: agent_id,
          folder: resolvedFolder,
          body,
          resolved,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      const sessionId = randomUUID();
      const runtimeCapabilityGrant = buildLiveSessionRuntimeCapabilityGrant({
        sessionId,
        agentId: agent_id,
        capabilities: sessionRuntimeCapabilities,
      });
      let session;
      try {
        session = sessionManager.start({
          agentId: agent_id,
          cwd: resolvedFolder,
          sessionId,
          sessionName: resolvedSessionName,
          provider: resolved.runtime.provider,
          model: resolved.runtime.model,
          reasoningEffort: resolved.runtime.reasoningEffort,
          reasoningEffortSource: resolved.runtime.reasoningEffortSource,
          permissionMode: resolved.runtime.permissionMode,
          approvalPolicy: resolved.runtime.approvalPolicy,
          sandboxMode: resolved.runtime.sandboxMode,
          dangerousMode: resolved.runtime.dangerousMode,
          allowDangerouslySkipPermissions:
            resolved.runtime.allowDangerouslySkipPermissions,
          searchEnabled: resolved.runtime.searchEnabled,
          imageInputEnabled: resolved.runtime.imageInputEnabled,
          native: resolved.runtime.native,
          workspacePolicy: resolved.runtime.workspacePolicy,
          runtimeCapabilities: sessionRuntimeCapabilities,
          runtimeCapabilityEnv: runtimeCapabilityGrant.env,
          runtimeCapabilityGrant: runtimeCapabilityGrant.metadata,
          runtimeCapabilityRedactionValues:
            runtimeCapabilityGrant.redactionValues,
          requiredProductSkills: Object.prototype.hasOwnProperty.call(
            body,
            "required_product_skills"
          )
            ? body.required_product_skills
            : undefined,
          installOysterunSkills: body.install_oysterun_skills === true,
        });
      } catch (err) {
        if (isProviderUnavailableError(err)) {
          return respond(
            res,
            err.statusCode || 503,
            serializeProviderUnavailableError(err)
          );
        }
        if (isProductSkillRequirementError(err)) {
          return respond(
            res,
            err.statusCode || 409,
            serializeProductSkillRequirementError(err)
          );
        }
        throw err;
      }
      applySessionWebsiteAccessRequest(session, body);
      session.notificationConfig = buildResolvedSessionNotificationConfig(
        resolved.layers
      );
      applySessionNotificationConfigRequest(session, body);
      session.telegramConfig = buildResolvedSessionTelegramConfig(
        resolved.layers
      );
      applySessionTelegramConfigRequest(session, telegramSessionConfigRequest);
      void refreshTelegramBridgeSession(session, "session_start");
      const bookkeepingWarnings = [...(session.bookkeepingWarnings || [])];
      try {
        setAgentFolder(agent_id, resolvedFolder, session.id);
      } catch (err) {
        const warning = `registry.folder_write_failed: ${err.message}`;
        bookkeepingWarnings.push(warning);
        console.error(`[session/start] ${agent_id} ${warning}`);
      }
      try {
        updateAgentSession(agent_id, session.id);
      } catch (err) {
        const warning = `registry.session_write_failed: ${err.message}`;
        bookkeepingWarnings.push(warning);
        console.error(`[session/start] ${agent_id} ${warning}`);
      }

      let summary = null;
      try {
        summary = summarizeAgentConfig(resolvedFolder);
      } catch (err) {
        console.error(
          `[session/start] Failed to summarize ${resolvedFolder}: ${err.message}`
        );
        summary = null;
      }
      const sessionSetupProof = buildSessionSetupProviderModelPermissionProof({
        body,
        requestedProvider: explicitProvider.requestedProvider,
        resolved,
        session,
      });
      if (
        sessionSetupProof.request_response_provider_model_permission_match !==
        true
      ) {
        console.error(
          `[session/start] post-start proof mismatch session_id=${session.id}`
        );
        try {
          await sessionManager.killSession(session.id);
        } catch (err) {
          console.error(
            `[session/start] Failed to kill mismatched session ${session.id}: ${err.message}`
          );
        }
        return respond(
          res,
          409,
          sessionSetupProviderModelPermissionProofMismatchResponse(
            sessionSetupProof
          )
        );
      }

      return respond(res, 200, {
        success: true,
        session_id: session.id,
        session_name: session.sessionName,
        agent_id,
        provider: session.provider || "claude",
        permission_mode: session.permissionMode ?? null,
        provider_resume_id: getEffectiveProviderResumeId(session),
        provider_thread_id: session.threadId || null,
        provider_transport: session.transport || null,
        model: session.model,
        reasoning_effort: session.reasoningEffort,
        provider_info: serializeProvider(resolved.runtime.providerInfo),
        agent_folder: resolvedFolder,
        interface_type: summary?.interfaceType || interface_type || "coding",
        allow_dangerously_skip_permissions:
          resolved.runtime.allowDangerouslySkipPermissions === true,
        approval_policy: resolved.runtime.approvalPolicy,
        sandbox_mode: resolved.runtime.sandboxMode,
        dangerous_mode: resolved.runtime.dangerousMode === true,
        session_setup_proof_contract:
          OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
        oysterun_permission_policy_kind:
          sessionSetupProof.oysterun_permission_policy_kind,
        oysterun_permission_policy:
          sessionSetupProof.oysterun_permission_policy,
        session_setup_provider_model_permission_proof: sessionSetupProof,
        search_enabled: resolved.runtime.searchEnabled === true,
        image_input_enabled: resolved.runtime.imageInputEnabled === true,
        runtime_capabilities: serializeRuntimeCapabilities(
          session.runtimeCapabilities,
          session.runtimeCapabilityGrant || null
        ),
        notification_settings: buildSessionNotificationSettingsPayload({
          sessionId: session.id,
          session,
        }),
        required_product_skills: Array.isArray(session.requiredProductSkills)
          ? session.requiredProductSkills
          : [],
        product_skill_copy_contract: session.productSkillCopyContract || null,
        oysterun_provider_skill_install:
          session.oysterunProviderSkillInstall || null,
        provider_trusted_folder: session.providerTrustedFolder || null,
        provider_trust_warning:
          session.providerTrustedFolder?.warning || null,
        native: buildNativePayload(resolved.runtime),
        website: buildSessionWebsiteMetadata(session),
        telegram: serializeAgentTelegramConfig(session.telegramConfig),
        telegram_runtime: buildSessionTelegramRuntimeStatusPayload(session),
        profile_config: buildLiveSessionProfileConfigPayload(session),
        alive: session.alive,
        ready: session._ready,
        capabilities: session.capabilities || {},
        workspace_policy: serializeWorkspacePolicy(session.workspacePolicy),
        bookkeeping_warning: bookkeepingWarnings.length
          ? bookkeepingWarnings.join("; ")
          : null,
      });
    }

    // ── POST /session/send ─────────────────────────────────
    if (req.method === "POST" && path === "/session/send") {
      const body = await readBody(req);
      const { session_id, text } = body;

      if (!session_id || !text) {
        return respond(res, 400, { error: "session_id and text required" });
      }
      const clientMessageId =
        typeof body.client_message_id === "string"
          ? body.client_message_id.trim()
          : "";
      if (body.client_message_id !== undefined && !clientMessageId) {
        return respond(res, 400, {
          error: "client_message_id must be a non-empty string when provided",
        });
      }
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;

      if (isClaudeLoginSlashCommand(session, text)) {
        try {
          return respond(
            res,
            200,
            await buildClaudeLoginSlashCommandResponse(session)
          );
        } catch (err) {
          return respond(res, 400, { error: err.message });
        }
      }

      if (isDemotedLoopStopCommandInput(text)) {
        return respond(res, 400, {
          ...buildDemotedLoopStopCommandResponse(),
          session_id: session.id,
          agent_id: session.agentId,
        });
      }

      try {
        const loopResult = schedulerService.createOrEnableLoopFromInput({
          hostSessionId: session.id,
          agentId: session.agentId,
          agentFolder: session.cwd,
          createdBy: claims.user_id,
          inputText: text,
        });
        if (loopResult) {
          const feedback = await writeLoopFeedbackOrThrow({
            session,
            action: classifyLoopFeedbackAction({ result: loopResult }),
            schedule: loopResult.feedback_schedule || loopResult.schedule,
          });
          return respond(
            res,
            200,
            {
              ...buildLoopSchedulerResponse(loopResult, session),
              matrix_feedback: feedback,
            }
          );
        }
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          scheduler_command: "loop",
        });
      }

      const nickname = body.nickname || "User";
      let routeCMatrixBindingProof;
      try {
        routeCMatrixBindingProof =
          materializeRouteCMatrixBindingForSessionSend(session);
      } catch (err) {
        return respond(res, 424, {
          error: "routec_session_send_matrix_binding_required",
          status: "routec_session_send_matrix_binding_required",
          reason: err.message || String(err),
          session_id: session.id,
          agent_id: session.agentId,
          provider_delivery_attempted: false,
          routec_matrix_delivery: null,
          routec_matrix_binding: null,
          routec_matrix_binding_materialized_from_live_session: false,
          transcript_db_fallback_used: false,
          host_db_transcript_product_truth: false,
        });
      }
      const routeCMatrixBinding = routeCMatrixBindingProof.binding;
      let committedMatrixUserEvent = null;
      try {
        committedMatrixUserEvent =
          await routeCMatrixFacade.writeHostUserMessageSemanticEvent({
            session,
            text,
            nickname,
            clientRequestId: clientMessageId || null,
            sourceId: "oysterun-host-clean-chat",
            sourceLabel: "clean_chat_session_send",
          });
      } catch (err) {
        return respond(res, 424, {
          error: "routec_session_send_matrix_commit_required",
          status: "routec_session_send_matrix_commit_required",
          reason: err.message || String(err),
          session_id: session.id,
          agent_id: session.agentId,
          routec_matrix_binding_materialization: routeCMatrixBindingProof,
          provider_delivery_attempted: false,
          routec_matrix_delivery: null,
          transcript_db_fallback_used: false,
          host_db_transcript_product_truth: false,
        });
      }

      const committedEventId =
        typeof committedMatrixUserEvent?.event_id === "string"
          ? committedMatrixUserEvent.event_id.trim()
          : "";
      if (
        committedMatrixUserEvent?.semantic_matrix_event_committed !== true ||
        !committedEventId
      ) {
        return respond(res, 424, {
          error: "routec_session_send_matrix_commit_required",
          status: "routec_session_send_matrix_commit_required",
          semantic_write_status: committedMatrixUserEvent?.status || null,
          semantic_matrix_event_committed:
            committedMatrixUserEvent?.semantic_matrix_event_committed === true,
          session_id: session.id,
          agent_id: session.agentId,
          routec_matrix_binding_materialization: routeCMatrixBindingProof,
          matrix_room_id:
            committedMatrixUserEvent?.matrix_room_id ||
            routeCMatrixBinding.matrix_room_id,
          matrix_event_id: null,
          provider_delivery_attempted: false,
          routec_matrix_delivery: null,
          transcript_db_fallback_used: false,
          host_db_transcript_product_truth: false,
        });
      }

      let providerDelivery;
      try {
        providerDelivery = sessionManager.deliverRouteCMatrixUserEventToProvider({
          sessionId: session.id,
          matrixUserId:
            committedMatrixUserEvent.matrix_user_id ||
            routeCMatrixBinding.matrix_user_id,
          matrixRoomId:
            committedMatrixUserEvent.matrix_room_id ||
            routeCMatrixBinding.matrix_room_id,
          serverEventId: committedEventId,
          txnId: committedMatrixUserEvent.txn_id || clientMessageId || null,
          text,
          providerText: null,
          nickname,
        });
      } catch (err) {
        return respond(res, 424, {
          error: "routec_session_send_provider_delivery_required",
          status: "routec_session_send_provider_delivery_required",
          reason: err.message || String(err),
          session_id: session.id,
          agent_id: session.agentId,
          routec_matrix_binding_materialization: routeCMatrixBindingProof,
          matrix_user_event: committedMatrixUserEvent,
          provider_delivery: null,
          provider_delivery_attempted: false,
          routec_matrix_delivery: null,
          transcript_db_fallback_used: false,
          host_db_transcript_product_truth: false,
        });
      }
      const localOysterunSkillCommand =
        providerDelivery?.message_id &&
        providerDelivery?.delivered === false &&
        providerDelivery?.provider_delivery_attempted === false &&
        providerDelivery?.provider_delivery_blocked_reason ===
          "local_oysterun_skill_install_command";
      if (localOysterunSkillCommand) {
        const queuedMessage = sessionManager.getOutboxMessage(
          session,
          providerDelivery.message_id
        );
        return respond(res, 200, {
          status:
            queuedMessage?.state === "failed"
              ? "local_oysterun_skill_command_failed"
              : "local_oysterun_skill_command_completed",
          session_id: session.id,
          agent_id: session.agentId,
          message_id: providerDelivery.message_id,
          state: queuedMessage?.state || null,
          local_command: queuedMessage?.localCommand === true,
          provider_delivery_suppressed:
            queuedMessage?.providerDeliverySuppressed === true,
          routec_matrix_binding_materialization: routeCMatrixBindingProof,
          routec_matrix_binding_materialized_from_live_session:
            routeCMatrixBindingProof
              .routec_matrix_binding_materialized_from_live_session === true,
          routec_matrix_user_event: committedMatrixUserEvent,
          provider_delivery: providerDelivery,
          routec_matrix_delivery: queuedMessage?.routeCMatrixDelivery || null,
          oysterun_provider_skill_install:
            queuedMessage?.oysterunProviderSkillInstall || null,
          provider_delivery_attempted: false,
          matrix_first_session_send: true,
          transcript_db_fallback_used: false,
          host_db_transcript_product_truth: false,
        });
      }
      if (
        providerDelivery?.delivered !== true ||
        typeof providerDelivery?.message_id !== "string" ||
        !providerDelivery.message_id
      ) {
        return respond(res, 424, {
          error: "routec_session_send_provider_delivery_required",
          status: "routec_session_send_provider_delivery_required",
          session_id: session.id,
          agent_id: session.agentId,
          routec_matrix_binding_materialization: routeCMatrixBindingProof,
          matrix_user_event: committedMatrixUserEvent,
          provider_delivery: providerDelivery || null,
          provider_delivery_attempted: false,
          routec_matrix_delivery: null,
          transcript_db_fallback_used: false,
          host_db_transcript_product_truth: false,
        });
      }
      const queuedMessage = sessionManager.getOutboxMessage(
        session,
        providerDelivery.message_id
      );
      if (!queuedMessage?.routeCMatrixDelivery) {
        return respond(res, 424, {
          error: "routec_session_send_matrix_delivery_required",
          status: "routec_session_send_matrix_delivery_required",
          session_id: session.id,
          agent_id: session.agentId,
          message_id: providerDelivery.message_id,
          routec_matrix_binding_materialization: routeCMatrixBindingProof,
          matrix_user_event: committedMatrixUserEvent,
          provider_delivery: providerDelivery,
          provider_delivery_attempted: false,
          routec_matrix_delivery: null,
          transcript_db_fallback_used: false,
          host_db_transcript_product_truth: false,
        });
      }
      return respond(res, 200, {
        status: "queued",
        session_id: session.id,
        agent_id: session.agentId,
        message_id: queuedMessage.id,
        state: queuedMessage.state,
        routec_matrix_binding_materialization: routeCMatrixBindingProof,
        routec_matrix_binding_materialized_from_live_session:
          routeCMatrixBindingProof
            .routec_matrix_binding_materialized_from_live_session === true,
        routec_matrix_user_event: committedMatrixUserEvent,
        provider_delivery: providerDelivery,
        routec_matrix_delivery: queuedMessage.routeCMatrixDelivery,
        provider_delivery_attempted:
          queuedMessage.routeCMatrixDelivery.provider_delivery_attempted ===
          true,
        matrix_first_session_send: true,
        transcript_db_fallback_used: false,
        host_db_transcript_product_truth: false,
      });
    }

    // ── POST /session/terminal-command ─────────────────────
    if (req.method === "POST" && path === "/session/terminal-command") {
      const body = await readBody(req);
      const { session_id } = body;
      const command =
        typeof body.command === "string" ? body.command.trim() : "";
      const route =
        typeof body.route === "string" && body.route.trim()
          ? body.route.trim()
          : "host_session_terminal_command_api";
      if (!command) {
        return respond(res, 400, { error: "command required" });
      }
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;
      const cwd = getSessionExecutionCwd(session.id);
      if (!cwd) {
        return respond(res, 409, { error: "No live session cwd available" });
      }

      const execId = randomUUID();
      const startedAt = new Date().toISOString();
      const startEnvelope = createShellStartEvent(
        session.agentId,
        session.id,
        execId,
        command,
        cwd,
        startedAt
      );
      startEnvelope.event.route = route;
      if (typeof body.matrix_room_id === "string" && body.matrix_room_id.trim()) {
        startEnvelope.event.matrix_room_id = body.matrix_room_id.trim();
      }
      let startedSemanticCommit;
      try {
        startedSemanticCommit =
          await requireRouteCTerminalCommandStartedSemanticCommit({
            session,
            event: startEnvelope.event,
            stage: "before_shell_execution",
          });
      } catch (err) {
        const semanticResponse = routeCTerminalCommandSemanticErrorResponse(err);
        if (semanticResponse) {
          return respond(
            res,
            semanticResponse.statusCode,
            semanticResponse.body
          );
        }
        throw err;
      }

      runShellCommand(session.id, command, cwd, {
        execId,
        startedAt,
        startedSemanticCommit,
        matrixTerminalSemanticDurabilityRequired: true,
      });
      return respond(res, 200, {
        status: "started",
        session_id: session.id,
        agent_id: session.agentId,
        exec_id: execId,
        terminal_exec_id: execId,
        command,
        cwd,
        route,
        terminal_command_started_semantic_type: "terminal.command.started",
        terminal_command_started_matrix_event_id:
          startedSemanticCommit.event_id,
        terminal_command_started_semantic_matrix_event_committed: true,
        terminal_command_result_matrix_event_required: true,
        expected_matrix_backed_semantic_truth:
          "terminal.command.started/terminal.command.result",
        normal_message_user_sent: false,
        browser_shell_execution: false,
        provider_delivery_attempted: false,
        transcript_db_fallback_used: false,
        host_db_transcript_product_truth: false,
      });
    }

    // ── Debug-only Telegram Mock runtime controls ─────────────
    if (req.method === "POST" && path === "/debug/telegram-mock/bind") {
      if (!requireTelegramMockRuntimeDebugGate(claims, res)) return;
      const body = await readBody(req);
      const session = requireSessionCapability(
        claims,
        body.session_id,
        "can_start_session",
        res
      );
      if (!session) return;
      telegramMockRuntimeSessionIds.add(session.id);
      let telegramConfigRequest = {};
      try {
        telegramConfigRequest = normalizeTelegramConfigPayload(body);
      } catch (err) {
        telegramMockRuntimeSessionIds.delete(session.id);
        return respond(res, 400, {
          error: err.message,
          status: "telegram_mock_runtime_bind_rejected",
          debug_gate: TELEGRAM_MOCK_RUNTIME_DEBUG_GATE,
          token_redacted: true,
          allowed_users_redacted: true,
        });
      }
      if (hasTelegramConfigUpdate(telegramConfigRequest)) {
        applySessionTelegramConfigRequest(session, telegramConfigRequest);
      }
      let routeCMatrixBinding;
      try {
        routeCMatrixBinding = ensureTelegramMockRouteCMatrixBinding(
          session,
          "debug_telegram_mock_bind"
        );
      } catch (err) {
        telegramMockRuntimeSessionIds.delete(session.id);
        return respond(res, 409, {
          error: err.message || String(err),
          status: "telegram_mock_runtime_bind_rejected",
          reason: "routec_matrix_binding_unavailable",
          debug_gate: TELEGRAM_MOCK_RUNTIME_DEBUG_GATE,
          real_telegram_network_attempted: false,
          token_redacted: true,
          allowed_users_redacted: true,
        });
      }
      const refresh = await refreshTelegramBridgeSession(
        session,
        "debug_telegram_mock_bind"
      );
      return respond(res, 200, {
        status: "telegram_mock_runtime_bound",
        ...buildTelegramMockRuntimeProof(session, {
          refresh,
          routec_matrix_binding: routeCMatrixBinding,
          current_session_only: true,
        }),
      });
    }

    if (req.method === "POST" && path === "/debug/telegram-mock/update") {
      if (!requireTelegramMockRuntimeDebugGate(claims, res)) return;
      const body = await readBody(req);
      const session = requireTelegramMockBoundSession(
        claims,
        body.session_id,
        "can_chat",
        res
      );
      if (!session) return;
      let request;
      try {
        request = normalizeTelegramMockMessageRequest(body);
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          status: "telegram_mock_update_rejected",
          token_redacted: true,
          allowed_users_redacted: true,
        });
      }
      if (request.kind === "update") {
        telegramMockAdapter.queueUpdate(request.update);
      } else {
        telegramMockAdapter.queueMessage(request.message);
      }
      return respond(res, 200, {
        status: "telegram_mock_update_queued",
        session_id: session.id,
        update_id:
          request.kind === "message" ? request.message.updateId : null,
        raw_update_supplied: request.kind === "update",
        chat_id_redacted: true,
        from_id_redacted: true,
        token_redacted: true,
        allowed_users_redacted: true,
        real_telegram_network_attempted: false,
        ...buildTelegramMockRuntimeProof(session),
      });
    }

    if (req.method === "POST" && path === "/debug/telegram-mock/poll") {
      if (!requireTelegramMockRuntimeDebugGate(claims, res)) return;
      const body = await readBody(req);
      const session = requireTelegramMockBoundSession(
        claims,
        body.session_id,
        "can_chat",
        res
      );
      if (!session) return;
      const poll = await telegramBridgeManager.pollSession(session.id, {
        timeoutSeconds: 0,
      });
      return respond(res, 200, {
        status: "telegram_mock_poll_complete",
        poll,
        deterministic_poll: true,
        long_poll_timeout_seconds: 0,
        capture_count: telegramMockAdapter.getSentMessages().length,
        ...buildTelegramMockRuntimeProof(session),
      });
    }

    if (req.method === "GET" && path === "/debug/telegram-mock/capture") {
      if (!requireTelegramMockRuntimeDebugGate(claims, res)) return;
      const sessionId = normalizeString(url.searchParams.get("session_id"));
      const session = requireTelegramMockBoundSession(
        claims,
        sessionId,
        "can_chat",
        res
      );
      if (!session) return;
      const sent_messages = serializeTelegramMockSentMessages();
      return respond(res, 200, {
        status: "telegram_mock_capture_read",
        sent_messages,
        capture_count: sent_messages.length,
        ...buildTelegramMockRuntimeProof(session),
      });
    }

    if (req.method === "POST" && path === "/debug/telegram-mock/clear") {
      if (!requireTelegramMockRuntimeDebugGate(claims, res)) return;
      const body = await readBody(req);
      const session = requireSessionCapability(
        claims,
        body.session_id,
        "can_start_session",
        res
      );
      if (!session) return;
      telegramBridgeManager.stopSession(session.id, "debug_telegram_mock_clear");
      const cleanup = clearTelegramMockRuntimeForSession(
        session.id,
        "debug_telegram_mock_clear"
      );
      return respond(res, 200, {
        status: "telegram_mock_runtime_cleared",
        ...buildTelegramMockRuntimeProof(session, {
          ...cleanup,
          mock_runtime_bound: false,
          telegram_runtime: buildSessionTelegramRuntimeStatusPayload(session),
        }),
      });
    }

    // ── POST /session/stop ─────────────────────────────────
    if (req.method === "POST" && path === "/session/stop") {
      const body = await readBody(req);
      const { session_id, force } = body;
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_start_session",
        res
      );
      if (!session) return;
      const controlRequestId = createRouteCSessionControlRequestId(
        "stop",
        session.id
      );
      const stopSemanticStage = force
        ? "force_stop_session_action"
        : "stop_session_action";
      const stopOutcomeSemanticStage = force
        ? "force_stop_http_200_success"
        : "stop_http_200_success";
      const stopSemanticRequest =
        await requireRouteCStopRequestSemanticCommitOrUnboundCleanup({
          session,
          stage: stopSemanticStage,
          event: {
            type: "control.request",
            control_request_id: controlRequestId,
            control_kind: "stop",
            control_family: "session_control",
            control_origin: "user",
            actor: claims.user_id || "oysterun-ui",
            target_id: session.id,
            target_session_id: session.id,
            allowed_actions: ["stop"],
            semantic_body: force
              ? "Force stop requested for session."
              : "Stop requested for session.",
            source_label: "host_session_stop_api",
            durable: true,
            replay_policy: "latest_state_only",
          },
        });
      const routeCUnboundStopCleanup =
        stopSemanticRequest.unboundCleanup || null;
      interruptActiveShellExecs(session.id, "stop");
      telegramBridgeManager.stopSession(session.id, stopSemanticStage);
      clearTelegramMockRuntimeForSession(session.id, stopSemanticStage);

      let sessionLoopRuntimeCleanup = null;
      try {
        if (force) {
          await sessionManager.killSession(session.id);
        } else {
          await sessionManager.stopSession(session.id);
        }
        sessionLoopRuntimeCleanup =
          schedulerService.clearSessionLoopRuntimeState({
            hostSessionId: session.id,
            reason: stopSemanticStage,
          });
      } catch (err) {
        if (!routeCUnboundStopCleanup) {
          await writeRouteCSessionControlSemanticEvent(session, {
            type: "control.outcome",
            control_request_id: controlRequestId,
            control_kind: "stop",
            control_family: "session_control",
            control_origin: "user",
            actor: claims.user_id || "oysterun-ui",
            outcome: "failed",
            control_outcome: "failed",
            target_id: session.id,
            target_session_id: session.id,
            semantic_body: `Stop failed for session: ${err.message || err}`,
            source_label: "host_session_stop_api",
            error_origin: "host",
            error_scope: "session_stop",
            durable: true,
            replay_policy: "always",
          });
        }
        throw err;
      }
      if (!routeCUnboundStopCleanup) {
        await requireRouteCSessionControlSemanticCommit({
          session,
          stage: stopOutcomeSemanticStage,
          event: {
            type: "control.outcome",
            control_request_id: controlRequestId,
            control_kind: "stop",
            control_family: "session_control",
            control_origin: "user",
            actor: claims.user_id || "oysterun-ui",
            outcome: "accepted",
            control_outcome: "accepted",
            target_id: session.id,
            target_session_id: session.id,
            semantic_body: force
              ? "Force stop accepted for session."
              : "Stop accepted for session.",
            source_label: "host_session_stop_api",
            durable: true,
            replay_policy: "always",
          },
        });
      }

      return respond(res, 200, {
        status: force ? "killed" : "stopped",
        session_id: session.id,
        agent_id: session.agentId,
        session_loop_runtime_cleanup: sessionLoopRuntimeCleanup,
        ...(routeCUnboundStopCleanup
          ? {
              routec_control_semantic_unbound_cleanup:
                routeCUnboundStopCleanup,
            }
          : {}),
      });
    }

    // ── POST /session/rename ───────────────────────────────
    if (req.method === "POST" && path === "/session/rename") {
      const body = await readBody(req);
      const { session_id, session_name } = body;
      if (!session_id) {
        return respond(res, 400, { error: "session_id required" });
      }
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_start_session",
        res
      );
      if (!session) return;
      const persistSharedConfig =
        body.update_config === true ||
        body.persist_config === true ||
        body.persist_shared_config === true;
      if (persistSharedConfig) {
        if (
          !requireAgentCapability(
            claims,
            session.agentId,
            "can_manage_config",
            res
          )
        ) {
          return;
        }
        if (!session.cwd) {
          return respond(res, 400, {
            error: "session rename config save requires a session folder",
          });
        }
      }

      try {
        const resolvedSessionName = normalizeSessionName(session_name);
        if (!resolvedSessionName) {
          throw new Error("session_name required");
        }
        if (
          sessionManager.hasRunningSessionName(resolvedSessionName, {
            excludeSessionId: session_id,
          })
        ) {
          throw new Error(buildSessionNameConflictMessage(resolvedSessionName));
        }
        const configPersistResult = persistSharedConfig
          ? persistAgentConfigUpdates(session.cwd, {
              session_name: resolvedSessionName,
            })
          : null;
        const { session: renamedSession, changed } =
          sessionManager.renameSession(session_id, resolvedSessionName);
        return respond(res, 200, {
          renamed: changed,
          session_id: renamedSession.id,
          session_name: renamedSession.sessionName || null,
          agent_id: renamedSession.agentId,
          current_session_only: !persistSharedConfig,
          config_mutated: persistSharedConfig,
          shared_config_mutated: persistSharedConfig,
          shared_config_changed: configPersistResult?.changed === true,
        });
      } catch (err) {
        const message = err.message || String(err);
        const status = message.includes(
          "is already in use by a running session"
        )
          ? 409
          : 400;
        return respond(res, status, { error: message });
      }
    }

    // ── POST /session/interrupt ────────────────────────────
    if (req.method === "POST" && path === "/session/interrupt") {
      const body = await readBody(req);
      const { session_id } = body;
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;
      const controlRequestId = createRouteCSessionControlRequestId(
        "interrupt",
        session.id
      );
      await requireRouteCSessionControlSemanticCommit({
        session,
        stage: "interrupt_action",
        event: {
          type: "control.request",
          control_request_id: controlRequestId,
          control_kind: "interrupt",
          control_family: "session_control",
          control_origin: "user",
          actor: claims.user_id || "oysterun-ui",
          target_id: session.id,
          target_session_id: session.id,
          allowed_actions: ["interrupt"],
          semantic_body: "Interrupt requested for session.",
          source_label: "host_session_interrupt_api",
          durable: true,
          replay_policy: "latest_state_only",
        },
      });
      const interruptedShellExecIds = interruptActiveShellExecs(
        session.id,
        "interrupt"
      );
      if (interruptedShellExecIds.length > 0) {
        await requireRouteCSessionControlSemanticCommit({
          session,
          stage: "shell_interrupt_http_200_success",
          event: {
            type: "control.outcome",
            control_request_id: controlRequestId,
            control_kind: "interrupt",
            control_family: "session_control",
            control_origin: "user",
            actor: claims.user_id || "oysterun-ui",
            outcome: "accepted",
            control_outcome: "accepted",
            target_id: session.id,
            target_session_id: session.id,
            semantic_body: "Interrupt accepted for active shell execution.",
            source_label: "host_session_interrupt_api",
            durable: true,
            replay_policy: "always",
          },
        });
        return respond(res, 200, {
          status: "interrupted",
          session_id: session.id,
          agent_id: session.agentId,
          shell_exec_ids: interruptedShellExecIds,
        });
      }

      try {
        sessionManager.interruptSession(session.id);
      } catch (err) {
        await writeRouteCSessionControlSemanticEvent(session, {
          type: "control.outcome",
          control_request_id: controlRequestId,
          control_kind: "interrupt",
          control_family: "session_control",
          control_origin: "user",
          actor: claims.user_id || "oysterun-ui",
          outcome: "failed",
          control_outcome: "failed",
          target_id: session.id,
          target_session_id: session.id,
          semantic_body: `Interrupt failed for session: ${err.message || err}`,
          source_label: "host_session_interrupt_api",
          error_origin: "host",
          error_scope: "session_interrupt",
          durable: true,
          replay_policy: "always",
        });
        throw err;
      }
      await requireRouteCSessionControlSemanticCommit({
        session,
        stage: "session_interrupt_http_200_success",
        event: {
          type: "control.outcome",
          control_request_id: controlRequestId,
          control_kind: "interrupt",
          control_family: "session_control",
          control_origin: "user",
          actor: claims.user_id || "oysterun-ui",
          outcome: "accepted",
          control_outcome: "accepted",
          target_id: session.id,
          target_session_id: session.id,
          semantic_body: "Interrupt accepted for session.",
          source_label: "host_session_interrupt_api",
          durable: true,
          replay_policy: "always",
        },
      });
      return respond(res, 200, {
        status: "interrupted",
        session_id: session.id,
        agent_id: session.agentId,
      });
    }

    // ── POST /session/outbox/cancel ───────────────────────
    if (req.method === "POST" && path === "/session/outbox/cancel") {
      const body = await readBody(req);
      const { session_id, message_id } = body;
      if (!session_id || !message_id) {
        return respond(res, 400, {
          error: "session_id and message_id required",
        });
      }
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;

      const message = sessionManager.cancelOutboxMessage(
        session.id,
        message_id
      );
      return respond(res, 200, {
        status: "canceled",
        session_id: session.id,
        agent_id: session.agentId,
        message_id: message.id,
        state: message.state,
      });
    }

    // ── POST /session/outbox/retry ────────────────────────
    if (req.method === "POST" && path === "/session/outbox/retry") {
      const body = await readBody(req);
      const { session_id, message_id } = body;
      if (!session_id || !message_id) {
        return respond(res, 400, {
          error: "session_id and message_id required",
        });
      }
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;

      const message = sessionManager.retryOutboxMessage(session.id, message_id);
      return respond(res, 200, {
        status: "queued",
        session_id: session.id,
        agent_id: session.agentId,
        message_id: message.id,
        state: message.state,
      });
    }

    // ── POST /session/outbox/skip ─────────────────────────
    if (req.method === "POST" && path === "/session/outbox/skip") {
      const body = await readBody(req);
      const { session_id, message_id } = body;
      if (!session_id || !message_id) {
        return respond(res, 400, {
          error: "session_id and message_id required",
        });
      }
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;

      const message = sessionManager.skipOutboxMessage(session.id, message_id);
      return respond(res, 200, {
        status: "skipped",
        session_id: session.id,
        agent_id: session.agentId,
        message_id: message.id,
        state: message.state,
      });
    }

    // ── POST /session/client-error ─────────────────────────
    if (req.method === "POST" && path === "/session/client-error") {
      const body = await readBody(req);
      const session_id = normalizeString(body.session_id);
      const errorMessage = normalizeString(body.error);
      if (!session_id || !errorMessage) {
        return respond(res, 400, { error: "session_id and error required" });
      }
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;

      const createdAt =
        normalizeString(body.created_at) || new Date().toISOString();
      const event = ensurePersistableEventFields({
        type: "runtime.error",
        sessionId: session.id,
        agentId: session.agentId,
        provider: session.provider || "claude",
        created_at: createdAt,
        error: errorMessage,
        error_scope: "transport",
        error_origin: normalizeString(body.error_origin) || "client",
        source_id: normalizeString(body.source_id) || "oysterun",
      });
      logPersistableEvent(event);
      return respond(res, 200, {
        status: "recorded",
        session_id: session.id,
        agent_id: session.agentId,
        created_at: event.created_at,
        message_id: event.message_id,
      });
    }

    // ── POST /session/restart ──────────────────────────────
    if (req.method === "POST" && path === "/session/restart") {
      const body = await readBody(req);
      const {
        session_id,
        provider,
        model,
        reasoning_effort,
        permission_mode,
        approval_policy,
        allow_dangerously_skip_permissions,
        dangerous_mode,
        search_enabled,
        image_input_enabled,
        provider_args,
        provider_config_overrides,
        provider_commands,
        provider_profile,
      } = body;

      const currentSession = requireSessionCapability(
        claims,
        session_id,
        "can_start_session",
        res
      );
      if (!currentSession) return;

      // Report restarting before the stop/start cycle
      reportSessionState(
        currentSession.agentId,
        currentSession.id,
        "restarting"
      );

      // Build overrides from request body
      const explicitProvider = readExplicitRequestedProvider(body);
      if (explicitProvider.error) {
        return respond(res, 400, { error: explicitProvider.error });
      }
      const overrides = {};
      if (explicitProvider.requestedProvider)
        overrides.provider = explicitProvider.requestedProvider;
      if (model) overrides.model = model;
      if (reasoning_effort) overrides.reasoningEffort = reasoning_effort;
      if (permission_mode) overrides.permissionMode = permission_mode;
      if (approval_policy) overrides.approvalPolicy = approval_policy;
      if (allow_dangerously_skip_permissions !== undefined) {
        overrides.allowDangerouslySkipPermissions =
          allow_dangerously_skip_permissions === true;
      }
      if (dangerous_mode !== undefined)
        overrides.dangerousMode = dangerous_mode === true;
      if (search_enabled !== undefined)
        overrides.searchEnabled = search_enabled === true;
      if (image_input_enabled !== undefined)
        overrides.imageInputEnabled = image_input_enabled === true;
      if (provider_args !== undefined) overrides.providerArgs = provider_args;
      if (provider_config_overrides !== undefined) {
        overrides.providerConfigOverrides = provider_config_overrides;
      }
      if (provider_commands !== undefined)
        overrides.providerCommands = provider_commands;
      if (provider_profile !== undefined)
        overrides.providerProfile = provider_profile;

      // Re-resolve workspace policy if config may have changed
      if (currentSession) {
        try {
          const restartProvider =
            overrides.provider ||
            currentSession.provider ||
            currentSession.adapterId ||
            "claude";
          const resolved = resolveAgentRuntimeConfig(currentSession.cwd, {
            ...overrides,
            provider: restartProvider,
          });
          try {
            validateProviderPermissionRequest({
              body,
              providerId: resolved.runtime.provider,
              config: readConfig(),
              source: "session_restart",
            });
          } catch (err) {
            return respond(res, 400, { error: err.message });
          }
          if (
            explicitProvider.requestedProvider &&
            resolved.runtime.provider !== explicitProvider.requestedProvider
          ) {
            return respond(
              res,
              500,
              providerMismatchResponse(
                explicitProvider.requestedProvider,
                resolved.runtime.provider
              )
            );
          }
          if (!resolved.runtime.providerInfo.runtimeSupported) {
            return respond(res, 501, {
              error: `Provider "${resolved.runtime.provider}" is not runtime-supported yet`,
              provider: resolved.runtime.provider,
              provider_info: serializeProvider(resolved.runtime.providerInfo),
              coder_settings: buildCoderSettings(resolved.runtime),
              native: buildNativePayload(resolved.runtime),
            });
          }
          overrides.workspacePolicy = resolved.runtime.workspacePolicy;
          if (!overrides.model) overrides.model = resolved.runtime.model;
          if (!overrides.reasoningEffort)
            overrides.reasoningEffort = resolved.runtime.reasoningEffort;
          if (!overrides.reasoningEffortSource) {
            overrides.reasoningEffortSource =
              resolved.runtime.reasoningEffortSource;
          }
          if (!overrides.permissionMode)
            overrides.permissionMode = resolved.runtime.permissionMode;
          if (!overrides.approvalPolicy)
            overrides.approvalPolicy = resolved.runtime.approvalPolicy;
          overrides.sandboxMode = resolved.runtime.sandboxMode;
          if (overrides.dangerousMode === undefined)
            overrides.dangerousMode = resolved.runtime.dangerousMode;
          if (overrides.searchEnabled === undefined)
            overrides.searchEnabled = resolved.runtime.searchEnabled;
          if (overrides.imageInputEnabled === undefined) {
            overrides.imageInputEnabled = resolved.runtime.imageInputEnabled;
          }
          if (!overrides.native) overrides.native = resolved.runtime.native;
          if (!overrides.provider) overrides.provider = restartProvider;
        } catch (err) {
          console.error(
            `[restart] Failed to re-resolve config: ${err.message}`
          );
        }
      }

      let restarted;
      try {
        restarted = await sessionManager.restartSession(
          currentSession.id,
          overrides
        );
      } catch (err) {
        if (isProviderUnavailableError(err)) {
          return respond(
            res,
            err.statusCode || 503,
            serializeProviderUnavailableError(err)
          );
        }
        throw err;
      }
      restarted.notificationConfig = currentSession?.notificationConfig || {
        enabled: true,
        storageOwner: "agent_config_notifications_enabled",
        configKey: "notifications.enabled",
      };
      restarted.notificationConfigUpdatedAt =
        currentSession?.notificationConfigUpdatedAt || null;
      emitSessionLifecycleEvent(restarted, "resume");
      // "started" event will fire and report "active" automatically

      return respond(res, 200, {
        session_id: restarted.id,
        session_name: restarted.sessionName || null,
        agent_id: restarted.agentId,
        provider: restarted.provider || "claude",
        model: restarted.model || null,
        permission_mode: restarted.permissionMode ?? null,
        approval_policy: restarted.approvalPolicy ?? null,
        sandbox_mode: restarted.sandboxMode ?? null,
        provider_resume_id: getEffectiveProviderResumeId(restarted),
        provider_thread_id: restarted.threadId || null,
        provider_transport: restarted.transport || null,
        provider_info: serializeConfiguredProvider(
          restarted.provider || "claude"
        ),
        reasoning_effort: restarted.reasoningEffort ?? null,
        native: restarted.native || buildNativePayload(null),
        cwd: restarted.cwd || null,
        website: buildSessionWebsiteMetadata(restarted),
        telegram: serializeAgentTelegramConfig(restarted.telegramConfig),
        telegram_runtime: buildSessionTelegramRuntimeStatusPayload(restarted),
        profile_config: buildLiveSessionProfileConfigPayload(restarted),
        allow_dangerously_skip_permissions:
          restarted.allowDangerouslySkipPermissions === true,
        alive: restarted.alive,
        ready: restarted._ready,
        capabilities: restarted.capabilities || {},
        runtime_capabilities: serializeRuntimeCapabilities(
          restarted.runtimeCapabilities,
          restarted.runtimeCapabilityGrant || null
        ),
        notification_settings: buildSessionNotificationSettingsPayload({
          sessionId: restarted.id,
          session: restarted,
        }),
        resumed: true,
      });
    }

    // ── GET /session/status?session_id=… ───────────────────
    if (req.method === "GET" && path === "/session/status") {
      const session_id = url.searchParams.get("session_id");
      const session = requireSessionCapabilityOrRuntimeScope(
        claims,
        session_id,
        "can_chat",
        "session:read_status",
        res
      );
      if (!session) return;

      return respond(res, 200, {
        agent_id: session.agentId,
        session_id: session.id,
        session_name: session.sessionName || null,
        provider: session.provider || "claude",
        model: session.model || null,
        reasoning_effort: session.reasoningEffort || null,
        permission_mode: session.permissionMode ?? null,
        approval_policy: session.approvalPolicy ?? null,
        sandbox_mode: session.sandboxMode ?? null,
        native: session.native || buildNativePayload(null),
        provider_resume_id: getEffectiveProviderResumeId(session),
        provider_thread_id: session.threadId || null,
        provider_transport: session.transport || null,
        provider_info: serializeConfiguredProvider(session.provider || "claude"),
        cwd: session.cwd || null,
        website: buildSessionWebsiteMetadata(session),
        telegram: serializeAgentTelegramConfig(session.telegramConfig),
        telegram_runtime: buildSessionTelegramRuntimeStatusPayload(session),
        profile_config: buildLiveSessionProfileConfigPayload(session),
        provider_trusted_folder: session.providerTrustedFolder || null,
        provider_trust_warning:
          session.providerTrustedFolder?.warning || null,
        active: true,
        alive: session.alive,
        ready: session._ready,
        capabilities: session.capabilities || {},
        runtime_capabilities: serializeRuntimeCapabilities(
          session.runtimeCapabilities,
          session.runtimeCapabilityGrant || null
        ),
        notification_settings: buildSessionNotificationSettingsPayload({
          sessionId: session.id,
          session,
        }),
        workspace_policy: serializeWorkspacePolicy(session.workspacePolicy),
        pending_control_requests: serializePendingControlRequests(session),
      });
    }

    // ── PATCH /session/profile-config ──────────────────────
    if (req.method === "PATCH" && path === "/session/profile-config") {
      const body = await readBody(req);
      try {
        const hasWebAccessRequest =
          Object.prototype.hasOwnProperty.call(body, "web_access") ||
          Object.prototype.hasOwnProperty.call(body, "webAccess");
        const hasWebsitePasswordRequest =
          Object.prototype.hasOwnProperty.call(body, "web_password") ||
          Object.prototype.hasOwnProperty.call(body, "webPassword");
        const hasWebsiteEnabledRequest = hasAgentWebEnabledRequest(body);
        const notificationConfigRequest = normalizeNotificationConfigPayload(body);
        const hasNotificationRequest = hasNotificationConfigRequest(body);
        const hasRuntimeCapabilityRequest =
          Object.prototype.hasOwnProperty.call(body, "runtime_capabilities") ||
          Object.prototype.hasOwnProperty.call(body, "runtimeCapabilities") ||
          Object.prototype.hasOwnProperty.call(body, "capabilities");
        const hasAllowedPathsRequest =
          hasSessionProfileAllowedPathsRequest(body);
        const telegramConfigRequest = normalizeTelegramConfigPayload(body);
        const hasTelegramRequest = hasTelegramConfigUpdate(telegramConfigRequest);
        if (
          !hasWebAccessRequest &&
          !hasWebsiteEnabledRequest &&
          !hasWebsitePasswordRequest &&
          !hasNotificationRequest &&
          !hasRuntimeCapabilityRequest &&
          !hasAllowedPathsRequest &&
          !hasTelegramRequest
        ) {
          throw new Error(
            "web_access, web_enabled, web_password, notifications, runtime_capabilities, allowed_paths, or telegram settings required"
          );
        }
        const persistSharedConfig =
          body.update_config === true ||
          body.persist_config === true ||
          body.persist_shared_config === true;
        const runtimeScope = hasTelegramRequest
          ? "telegram:update"
          : hasWebAccessRequest ||
            hasWebsiteEnabledRequest ||
            hasWebsitePasswordRequest
          ? "website:update"
          : "";
        if (isRuntimeCapabilityOnly(claims)) {
          if (
            !runtimeScope ||
            persistSharedConfig ||
            hasNotificationRequest ||
            hasRuntimeCapabilityRequest ||
            hasAllowedPathsRequest
          ) {
            respondRuntimeCapabilityDenied(res, 403, {
              reason: "runtime_profile_update_scope_not_allowed",
              capability_scope: runtimeScope || null,
            });
            return;
          }
        }
        const session = requireSessionCapabilityOrRuntimeScope(
          claims,
          body.session_id,
          "can_start_session",
          runtimeScope,
          res
        );
        if (!session) return;
        const nextWebAccess = hasWebAccessRequest
          ? normalizeAgentWebAccess(body.web_access ?? body.webAccess)
          : null;
        const nextWebEnabled = hasWebsiteEnabledRequest
          ? normalizeAgentWebEnabled(body.web_enabled ?? body.webEnabled)
          : null;
        const nextWebsitePassword = hasWebsitePasswordRequest
          ? normalizeString(body.web_password ?? body.webPassword)
          : null;
        const nextRuntimeCapabilities = hasRuntimeCapabilityRequest
          ? normalizeRuntimeCapabilityState(
              body.runtime_capabilities ??
                body.runtimeCapabilities ??
                body.capabilities,
              {
                baseState:
                  session.runtimeCapabilities || DEFAULT_AGENT_RUNTIME_CAPABILITIES,
              }
            )
          : null;
        const nextAllowedPaths = hasAllowedPathsRequest
          ? normalizeSessionProfileAllowedPathsRequest(body)
          : null;
        if (hasAllowedPathsRequest && !session.cwd) {
          throw new Error(
            "session profile allowed_paths update requires a session folder"
          );
        }
        const nextWorkspacePolicy = hasAllowedPathsRequest
          ? resolveWorkspacePolicy(
              session.cwd,
              readAgentConfigLayers(session.cwd).config,
              {
                allowedPaths: nextAllowedPaths,
              }
            )
          : null;
        if (nextWebEnabled === true) {
          if (!session.cwd) {
            throw new Error(
              "session profile website enable requires a session folder"
            );
          }
          ensureP94AgentWebsiteScaffold({
            agentId: session.agentId,
            folder: session.cwd,
            access:
              nextWebAccess ||
              session.websiteAccessOverride ||
              buildSessionWebsiteMetadata(session).access ||
              "owner_only",
            persistConfig: false,
          });
        }
        if (persistSharedConfig) {
          if (
            !requireAgentCapability(
              claims,
              session.agentId,
              "can_manage_config",
              res
            )
          ) {
            return;
          }
          if (!session.cwd) {
            throw new Error(
              "session profile config save requires a session folder"
            );
          }
          persistAgentConfigUpdates(session.cwd, {
            ...(hasWebAccessRequest ? { web_access: nextWebAccess } : {}),
            ...(hasWebsiteEnabledRequest ? { web_enabled: nextWebEnabled } : {}),
            ...(nextWebsitePassword ? { web_password: nextWebsitePassword } : {}),
            ...notificationConfigRequest,
            ...(hasRuntimeCapabilityRequest
              ? { runtime_capabilities: nextRuntimeCapabilities }
              : {}),
            ...(hasAllowedPathsRequest ? { allowed_paths: nextAllowedPaths } : {}),
            ...telegramConfigRequest,
          });
          if (hasWebAccessRequest) {
            delete session.websiteAccessOverride;
          }
          if (hasWebsiteEnabledRequest) {
            delete session.websiteEnabledOverride;
          }
          if (
            hasNotificationRequest ||
            hasRuntimeCapabilityRequest ||
            hasAllowedPathsRequest ||
            hasTelegramRequest
          ) {
            const resolved = resolveAgentRuntimeConfig(session.cwd);
            if (hasNotificationRequest) {
              session.notificationConfig = buildResolvedSessionNotificationConfig(
                resolved.layers
              );
              session.notificationConfigUpdatedAt = new Date().toISOString();
            }
            if (hasRuntimeCapabilityRequest) {
              sessionManager.updateRuntimeCapabilities(
                session.id,
                resolveConfiguredRuntimeCapabilities(resolved.config)
              );
            }
            if (hasAllowedPathsRequest) {
              session.workspacePolicy = resolved.runtime.workspacePolicy;
            }
            if (hasTelegramRequest) {
              session.telegramConfig = buildResolvedSessionTelegramConfig(
                resolved.layers
              );
            }
          }
          if (hasTelegramRequest) {
            void refreshTelegramBridgeSession(
              session,
              "session_profile_config_persisted"
            );
          }
        } else {
          if (hasWebAccessRequest) {
            session.websiteAccessOverride = nextWebAccess;
          }
          if (hasWebsiteEnabledRequest) {
            session.websiteEnabledOverride = nextWebEnabled;
          }
          if (hasNotificationRequest) {
            applySessionNotificationConfigRequest(session, {
              ...notificationConfigRequest,
              update_config: false,
            });
          }
          if (hasRuntimeCapabilityRequest) {
            sessionManager.updateRuntimeCapabilities(
              session.id,
              nextRuntimeCapabilities
            );
          }
          if (hasAllowedPathsRequest) {
            session.workspacePolicy = nextWorkspacePolicy;
          }
          applySessionTelegramConfigRequest(session, telegramConfigRequest);
          if (hasTelegramRequest) {
            void refreshTelegramBridgeSession(
              session,
              "session_profile_config_runtime_only"
            );
          }
        }
        const website = buildSessionWebsiteMetadata(session);
        const localTelegramConfigMutated =
          persistSharedConfig && hasLocalTelegramConfigUpdate(telegramConfigRequest);
        const localWebsitePasswordMutated =
          persistSharedConfig && Boolean(nextWebsitePassword);
        const localConfigMutated =
          localTelegramConfigMutated || localWebsitePasswordMutated;
        return respond(res, 200, {
          status: "session_profile_config_updated",
          session_id: session.id,
          agent_id: session.agentId,
          provider: session.provider || "claude",
          model: session.model || null,
          cwd: session.cwd || null,
          web_access: nextWebAccess,
          web_enabled: nextWebEnabled,
          website,
          notifications: serializeAgentNotificationConfig(
            session.notificationConfig || {}
          ),
          notification_settings: buildSessionNotificationSettingsPayload({
            sessionId: session.id,
            session,
          }),
          workspace_policy: serializeWorkspacePolicy(session.workspacePolicy),
          telegram: serializeAgentTelegramConfig(session.telegramConfig),
          telegram_runtime: buildSessionTelegramRuntimeStatusPayload(session),
          profile_config: buildLiveSessionProfileConfigPayload(session),
          runtime_capabilities: serializeRuntimeCapabilities(
            session.runtimeCapabilities,
            session.runtimeCapabilityGrant || null
          ),
          current_session_only: !persistSharedConfig,
          config_mutated: persistSharedConfig,
          shared_config_mutated: persistSharedConfig,
          local_config_mutated: localConfigMutated,
          private_config_mutated: localConfigMutated,
          private_local_material_serialized: localConfigMutated,
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          session_profile_config: true,
          config_mutated: false,
        });
      }
    }

    // ── GET/PATCH /session/notification-settings ──────────────
    if (req.method === "GET" && path === "/session/notification-settings") {
      const session_id = url.searchParams.get("session_id");
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;
      const matrixRoomId = url.searchParams.get("matrix_room_id");
      return respond(res, 200, {
        status: "ok",
        session_id: session.id,
        notification_settings: buildSessionNotificationSettingsPayload({
          sessionId: session.id,
          matrixRoomId,
          session,
        }),
      });
    }

    if (req.method === "PATCH" && path === "/session/notification-settings") {
      const body = await readBody(req);
      const session = requireSessionCapability(
        claims,
        body.session_id,
        "can_start_session",
        res
      );
      if (!session) return;
      try {
        if (typeof body.notifications_enabled !== "boolean") {
          throw new Error("notifications_enabled must be a boolean");
        }
        const notificationSettings = updateSessionNotificationSettingsPayload({
          sessionId: session.id,
          matrixRoomId: body.matrix_room_id,
          notificationsEnabled: body.notifications_enabled,
        });
        return respond(res, 200, {
          status: "session_notification_settings_updated",
          session_id: session.id,
          agent_id: session.agentId,
          notification_settings: notificationSettings,
          current_session_only: true,
          storage_owner: "agent_config_notifications_enabled",
          policy_source: "notifications.enabled",
          config_mutated: false,
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          notification_settings: true,
        });
      }
    }

    // ── PATCH /session/runtime-capabilities ─────────────────
    if (req.method === "PATCH" && path === "/session/runtime-capabilities") {
      const body = await readBody(req);
      const session = requireSessionCapability(
        claims,
        body.session_id,
        "can_start_session",
        res
      );
      if (!session) return;
      try {
        const hasRuntimeCapabilityBody =
          Object.prototype.hasOwnProperty.call(body, "runtime_capabilities") ||
          Object.prototype.hasOwnProperty.call(body, "runtimeCapabilities") ||
          Object.prototype.hasOwnProperty.call(body, "capabilities");
        if (!hasRuntimeCapabilityBody) {
          throw new Error("runtime_capabilities required");
        }
        const nextCapabilities = normalizeRuntimeCapabilityState(
          body.runtime_capabilities ??
            body.runtimeCapabilities ??
            body.capabilities,
          {
            baseState:
              session.runtimeCapabilities || DEFAULT_AGENT_RUNTIME_CAPABILITIES,
          }
        );
        sessionManager.updateRuntimeCapabilities(
          session.id,
          nextCapabilities
        );
        return respond(res, 200, {
          status: "runtime_capabilities_updated",
          session_id: session.id,
          agent_id: session.agentId,
          provider: session.provider || "claude",
          model: session.model || null,
          permission_mode: session.permissionMode ?? null,
          approval_policy: session.approvalPolicy ?? null,
          sandbox_mode: session.sandboxMode ?? null,
          profile_config: buildLiveSessionProfileConfigPayload(session),
          runtime_capabilities: serializeRuntimeCapabilities(
            session.runtimeCapabilities,
            session.runtimeCapabilityGrant || null
          ),
          current_session_only: true,
          config_mutated: false,
        });
      } catch (err) {
        return respond(res, 400, {
          error: err.message,
          runtime_capabilities: true,
        });
      }
    }

    // ── GET /session/snapshot?session_id=… ─────────────────
    if (req.method === "GET" && path === "/session/snapshot") {
      const session_id = normalizeString(url.searchParams.get("session_id"));
      const session = requireSessionCapability(
        claims,
        session_id,
        "can_chat",
        res
      );
      if (!session) return;

      let latestCommittedSeq = 0;
      let matrixTranscriptRead = null;
      try {
        const binding = requireRouteCMatrixRoomBinding(session.id);
        const latestResult = readMatrixTranscriptLatestCommittedSeq({
          binding,
        });
        latestCommittedSeq = latestResult.latest_committed_seq;
        matrixTranscriptRead = latestResult.matrix_transcript_read;
      } catch (err) {
        if (isRouteCMatrixBindingNotFoundError(err)) {
          return respond(res, 404, {
            error: "Matrix transcript read binding not available for session",
            committed_transcript_truth: "matrix_room_timeline",
            host_db_transcript_product_truth: false,
          });
        }
        throw err;
      }

      const pendingControlRequests = serializePendingControlRequests(session);

      return respond(res, 200, {
        agent_id: session.agentId,
        session_id: session.id,
        session_name: session.sessionName || null,
        provider: session.provider || "claude",
        provider_resume_id: getEffectiveProviderResumeId(session),
        provider_thread_id: session.threadId || null,
        provider_transport: session.transport || null,
        active: true,
        alive: session.alive,
        ready: session._ready,
        latest_committed_seq: latestCommittedSeq,
        committed_transcript_truth: "matrix_room_timeline",
        host_db_transcript_product_truth: false,
        transcript_surface_classification: "product_matrix_path",
        matrix_product_transcript_truth: true,
        legacy_debug_transcript_read: false,
        product_legacy_transcript_caller_allowed: false,
        matrix_transcript_read: matrixTranscriptRead,
        delivery: sessionManager.getDeliverySummary(session.id),
        outbox: sessionManager.getOutboxSnapshot(session.id),
        pending_control_requests: pendingControlRequests,
        provider_lifecycle: sessionManager.getRouteCProviderLifecycle(
          session.id,
          { pendingControlRequests }
        ),
      });
    }

    // ── GET /session/messages?session_id=…&agent_id=… ──────
    if (req.method === "GET" && path === "/session/messages") {
      const session_id = normalizeString(url.searchParams.get("session_id"));
      if (!session_id) {
        return respond(res, 400, { error: "session_id query param required" });
      }
      const agent_id = normalizeString(url.searchParams.get("agent_id"));
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      if (isRuntimeCapabilityOnly(claims)) {
        const auth = requireRuntimeCapability(claims, res, {
          scope: "session:read_transcript",
          sessionId: session_id,
          agentId: agent_id,
        });
        if (!auth) return;
      } else if (!requireAgentCapability(claims, agent_id, "can_chat", res)) {
        return;
      }

      let limit;
      let afterSeq;
      try {
        limit = parseTranscriptPageLimit(url.searchParams.get("limit"));
        afterSeq = parseTranscriptAfterSeq(url.searchParams.get("after_seq"));
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }

      let syncResult;
      try {
        const binding = requireRouteCMatrixRoomBinding(session_id);
        if (binding.host_agent_id !== agent_id) {
          return respond(res, 403, {
            error: "Matrix transcript read binding does not match agent",
            committed_transcript_truth: "matrix_room_timeline",
            host_db_transcript_product_truth: false,
          });
        }
        syncResult = readMatrixTranscriptMessagesAfter({
          binding,
          afterSeq,
          limit,
        });
      } catch (err) {
        if (isRouteCMatrixBindingNotFoundError(err)) {
          return respond(res, 404, {
            error: "Matrix transcript read binding not available for session",
            committed_transcript_truth: "matrix_room_timeline",
            host_db_transcript_product_truth: false,
          });
        }
        throw err;
      }

      return respond(res, 200, {
        agent_id,
        session_id,
        messages: syncResult.messages,
        sync: syncResult.sync,
        committed_transcript_truth: "matrix_room_timeline",
        host_db_transcript_product_truth: false,
        transcript_surface_classification: "product_matrix_path",
        matrix_product_transcript_truth: true,
        legacy_debug_transcript_read: false,
        product_legacy_transcript_caller_allowed: false,
        matrix_transcript_read: syncResult.matrix_transcript_read,
      });
    }

    // ── GET /sessions/history ──────────────────────────────
    if (req.method === "GET" && path === "/sessions/history") {
      const history = getSessionHistory()
        .filter((s) => s.agent_folder && existsSync(s.agent_folder))
        .map((s) => ({
          ...s,
          last_message_preview: getLastMessagePreview(
            s.agent_folder,
            s.agent_id,
            s.session_id
          ),
        }));
      return respond(res, 200, { sessions: history });
    }

    // ── GET /sessions/default-name?agent_id=…&mode=branch&source_session_id=… ──
    // Returns the counter-based `${parent}-branch-N` default a subsequent
    // `/sessions/resume` branch would resolve, WITHOUT bumping the counter.
    // Branch-only: "newly created" open-mode defaults are generated client-
    // side as `${agentId}-${uuid5hex}` (Jeremy's 4/1 design). The counter
    // suffix is retained for BRANCH only so list rows can display
    // `-branch-N` and users can distinguish branches from originals
    // (Jeremy 2026-04-24 09:12 comment).
    if (req.method === "GET" && path === "/sessions/default-name") {
      const agentId = normalizeString(url.searchParams.get("agent_id"));
      if (!agentId) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      if (!requireAgentCapability(claims, agentId, "can_start_session", res))
        return;

      const mode = normalizeString(url.searchParams.get("mode"));
      if (mode !== "branch") {
        return respond(res, 400, {
          error: "mode must be 'branch' (open-mode defaults are client-side)",
        });
      }
      const sourceSessionId = normalizeString(
        url.searchParams.get("source_session_id")
      );
      if (!sourceSessionId) {
        return respond(res, 400, {
          error: "source_session_id required when mode=branch",
        });
      }
      const sourceRecord =
        getSessionHistory().find(
          (entry) => entry.session_id === sourceSessionId
        ) || null;
      if (!sourceRecord || !sourceRecord.session_name) {
        // Parent unknown or deleted — fall back to `${agentId}-branch-1` off
        // the requested agent id so the client still has a real suggestion.
        return respond(res, 200, {
          default_name: buildDefaultBranchName(agentId, 1),
          source_not_found: true,
        });
      }
      const counter =
        getSessionNameCounterStore().peekBranchCounter(sourceSessionId);
      return respond(res, 200, {
        default_name: buildDefaultBranchName(
          sourceRecord.session_name,
          counter
        ),
      });
    }

    // ── GET /session/transcript?session_id=…&agent_id=… ────
    if (req.method === "GET" && path === "/session/transcript") {
      const session_id = normalizeString(url.searchParams.get("session_id"));
      if (!session_id) {
        return respond(res, 400, { error: "session_id query param required" });
      }
      const agent_id = normalizeString(url.searchParams.get("agent_id"));
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      if (isRuntimeCapabilityOnly(claims)) {
        const auth = requireRuntimeCapability(claims, res, {
          scope: "session:read_transcript",
          sessionId: session_id,
          agentId: agent_id,
        });
        if (!auth) return;
      } else if (!requireAgentCapability(claims, agent_id, "can_chat", res)) {
        return;
      }

      let limit;
      let before;
      try {
        limit = parseTranscriptPageLimit(url.searchParams.get("limit"));
        before = decodeTranscriptPageCursor(url.searchParams.get("before"));
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }

      let pageResult;
      try {
        const binding = requireRouteCMatrixRoomBinding(session_id);
        if (binding.host_agent_id !== agent_id) {
          return respond(res, 403, {
            error: "Matrix transcript read binding does not match agent",
            committed_transcript_truth: "matrix_room_timeline",
            host_db_transcript_product_truth: false,
          });
        }
        pageResult = readMatrixTranscriptPage({
          binding,
          limit,
          before,
        });
      } catch (err) {
        if (isRouteCMatrixBindingNotFoundError(err)) {
          return respond(res, 404, {
            error: "Matrix transcript read binding not available for session",
            committed_transcript_truth: "matrix_room_timeline",
            host_db_transcript_product_truth: false,
          });
        }
        throw err;
      }

      return respond(res, 200, {
        agent_id,
        session_id,
        messages: pageResult.messages,
        page: {
          limit: pageResult.page.limit,
          next_before: encodeTranscriptPageCursor(pageResult.page.next_before),
          has_more: pageResult.page.has_more,
        },
        committed_transcript_truth: "matrix_room_timeline",
        host_db_transcript_product_truth: false,
        transcript_surface_classification: "product_matrix_path",
        matrix_product_transcript_truth: true,
        legacy_debug_transcript_read: false,
        product_legacy_transcript_caller_allowed: false,
        matrix_transcript_read: pageResult.matrix_transcript_read,
      });
    }

    // ── GET /sessions/matrix-transcripts?agent_id=… ────────
    if (req.method === "GET" && path === "/sessions/matrix-transcripts") {
      const agent_id = url.searchParams.get("agent_id");
      if (!agent_id) {
        return respond(res, 400, { error: "agent_id query param required" });
      }
      if (!requireAgentCapability(claims, agent_id, "can_chat", res)) return;

      const transcripts = [];
      for (const record of getSessionHistory()) {
        if (record.agent_id !== agent_id || !record.session_id) continue;
        const binding = getRouteCMatrixRoomBinding(record.session_id);
        if (!binding) continue;
        try {
          const proof = getRouteCMatrixRoomTimelineReplaySourceProof({
            sourceBinding: binding,
          });
          if (!proof || proof.source_event_count <= 0) continue;
          transcripts.push({
            session_id: record.session_id,
            session_name: record.session_name || record.session_id,
            matrix_room_id: binding.matrix_room_id,
            source_event_count: proof.source_event_count,
            committed_transcript_truth: "matrix_room_timeline",
            db_transcript_copy_product_truth: false,
          });
        } catch (err) {
          continue;
        }
      }

      return respond(res, 200, {
        agent_id,
        transcripts,
        matrix_timeline_membership_source: "routec_matrix_room_timeline",
        matrix_timeline_replay_required: true,
        committed_transcript_truth: "matrix_room_timeline",
        host_db_transcript_product_truth: false,
        transcript_surface_classification: "product_matrix_path",
        matrix_product_transcript_truth: true,
        product_legacy_transcript_caller_allowed: false,
        legacy_debug_transcript_read: false,
      });
    }

    // ── POST /sessions/resume ──────────────────────────────
    if (req.method === "POST" && path === "/sessions/resume") {
      const body = await readBody(req);
      const { source_session_id, agent_id, agent_folder, session_name } = body;

      if (!agent_id) {
        return respond(res, 400, { error: "agent_id required" });
      }
      const sourceSessionId = normalizeString(source_session_id);
      if (!sourceSessionId) {
        return respond(res, 400, { error: "source_session_id required" });
      }
      if (!requireAgentCapability(claims, agent_id, "can_start_session", res))
        return;

      const sourceRecord =
        getSessionHistory().find(
          (entry) => entry.session_id === sourceSessionId
        ) || null;
      if (!sourceRecord) {
        return respond(res, 404, {
          error: "Source session history record not found",
        });
      }
      if (sourceRecord.agent_id !== agent_id) {
        return respond(res, 400, {
          error: "Resume source agent does not match requested agent",
        });
      }

      let resolvedFolder =
        sourceRecord.agent_folder || getAgentFolder(agent_id);
      if (claims._dashboardAuth && agent_folder) {
        resolvedFolder = agent_folder;
      }
      if (!resolvedFolder) {
        return respond(res, 400, {
          error: "No local folder mapping configured for this agent",
        });
      }

      let sourceCanonicalFolder;
      let requestedCanonicalFolder;
      try {
        sourceCanonicalFolder = realpathSync(sourceRecord.agent_folder);
        requestedCanonicalFolder = realpathSync(resolvedFolder);
      } catch (err) {
        return respond(res, 400, {
          error: `Resume folder validation failed: ${err.message}`,
        });
      }
      if (sourceCanonicalFolder !== requestedCanonicalFolder) {
        return respond(res, 400, {
          error: "Resume source folder does not match requested folder",
        });
      }

      const explicitProvider = readExplicitRequestedProvider(body);
      if (explicitProvider.error) {
        return respond(res, 400, { error: explicitProvider.error });
      }
      const resolved = resolveAgentRuntimeConfig(
        resolvedFolder,
        buildRuntimeOverridesFromBody(
          body,
          explicitProvider.requestedProvider ?? undefined
        )
      );
      try {
        validateProviderPermissionRequest({
          body,
          providerId: resolved.runtime.provider,
          config: readConfig(),
          source: "sessions_resume",
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      if (
        explicitProvider.requestedProvider &&
        resolved.runtime.provider !== explicitProvider.requestedProvider
      ) {
        return respond(
          res,
          500,
          providerMismatchResponse(
            explicitProvider.requestedProvider,
            resolved.runtime.provider
          )
        );
      }
      if (!resolved.runtime.providerInfo.runtimeSupported) {
        return respond(res, 501, {
          error: `Provider "${resolved.runtime.provider}" is not runtime-supported yet`,
          provider: resolved.runtime.provider,
          provider_info: serializeProvider(resolved.runtime.providerInfo),
          coder_settings: buildCoderSettings(resolved.runtime),
          native: buildNativePayload(resolved.runtime),
        });
      }
      const resumeProofFields = buildSessionSetupProviderModelPermissionFields({
        body,
        requestedProvider: explicitProvider.requestedProvider,
        resolved,
      });
      if (!resumeProofFields.request_response_provider_model_permission_match) {
        console.error(
          `[sessions/resume] proof mismatch requested_provider=${
            resumeProofFields.requestedProvider || "missing"
          }` +
            ` resolved_provider=${resumeProofFields.provider || "missing"}` +
            ` requested_model=${
              resumeProofFields.requestedModel || "missing"
            }` +
            ` resolved_model=${resumeProofFields.model || "missing"}`
        );
        return respond(
          res,
          409,
          sessionSetupProviderModelPermissionMismatchResponse(resumeProofFields)
        );
      }
      if (resolved.runtime.provider !== sourceRecord.runtime) {
        return respond(res, 409, {
          error: `Source session runtime "${sourceRecord.runtime}" does not match requested runtime "${resolved.runtime.provider}"`,
          source_runtime: sourceRecord.runtime,
          requested_runtime: resolved.runtime.provider,
        });
      }

      const resumeAdapter = sessionManager.getAdapter(
        resolved.runtime.provider
      );
      const forkSourceProviderMetadata =
        resolveProviderResumeMetadataFromHistory(sourceRecord, resumeAdapter);
      if (forkSourceProviderMetadata.reason === "unsupported_runtime") {
        return respond(res, 409, { error: forkSourceProviderMetadata.message });
      }
      if (forkSourceProviderMetadata.reason === "provider_resume_unsupported") {
        return respond(res, 409, {
          error: `Provider "${resolved.runtime.provider}" does not support branch/copy Resume`,
          code: "branch_copy_resume_provider_unsupported",
        });
      }
      if (
        forkSourceProviderMetadata.reason === "provider_resume_metadata_missing"
      ) {
        return respond(res, 409, {
          error: "Source session is missing provider resume metadata",
        });
      }

      let sourceMatrixBinding;
      let sourceMatrixReplayProof;
      try {
        sourceMatrixBinding = requireRouteCMatrixRoomBinding(sourceSessionId);
        sourceMatrixReplayProof = getRouteCMatrixRoomTimelineReplaySourceProof({
          sourceBinding: sourceMatrixBinding,
        });
      } catch (err) {
        return respond(res, 409, {
          error: `Source session Matrix room timeline is required for branch/copy: ${err.message}`,
          source_session_id: sourceSessionId,
          matrix_timeline_replay_required: true,
          committed_transcript_truth: "matrix_room_timeline",
          db_transcript_copy_product_truth: false,
          transcript_surface_classification: "product_matrix_path",
          matrix_product_transcript_truth: true,
          product_local_transcript_replay_shortcut_used: false,
          direct_matrix_harness_write_used: false,
          routec_host_owned_matrix_storage: true,
        });
      }
      let resolvedSessionName;
      try {
        // Fork path (branch): name defaults to `${parent}-branch-N` via a
        // per-parent counter, so branches are visually distinguishable from
        // fresh sessions of the same agent. If the caller supplied an
        // explicit session_name, it is preserved (per Q5 decision: resume
        // payload's name is authoritative).
        resolvedSessionName = resolveRequestedBranchName(
          session_name,
          sourceSessionId,
          sourceRecord.session_name,
          sessionManager
        );
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      if (sessionManager.hasRunningSessionName(resolvedSessionName)) {
        return respond(res, 409, {
          error: buildSessionNameConflictMessage(resolvedSessionName),
        });
      }

      const sessionRuntimeCapabilities =
        resolveRuntimeCapabilitiesForSessionStart(resolved.config, body);
      try {
        ensureRequestedWebsiteScaffoldBeforeSession({
          agentId: agent_id,
          folder: resolvedFolder,
          body,
          resolved,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      const childSessionId = randomUUID();
      const runtimeCapabilityGrant = buildLiveSessionRuntimeCapabilityGrant({
        sessionId: childSessionId,
        agentId: agent_id,
        capabilities: sessionRuntimeCapabilities,
      });
      let session;
      try {
        session = sessionManager.start({
          agentId: agent_id,
          cwd: resolvedFolder,
          sessionId: childSessionId,
          sessionName: resolvedSessionName,
          provider: resolved.runtime.provider,
          parentSessionId: sourceSessionId,
          resumeSessionId: forkSourceProviderMetadata.providerResumeId,
          resume: true,
          fork: true,
          model: resolved.runtime.model,
          reasoningEffort: resolved.runtime.reasoningEffort,
          reasoningEffortSource: resolved.runtime.reasoningEffortSource,
          permissionMode: resolved.runtime.permissionMode,
          approvalPolicy: resolved.runtime.approvalPolicy,
          sandboxMode: resolved.runtime.sandboxMode,
          dangerousMode: resolved.runtime.dangerousMode,
          allowDangerouslySkipPermissions:
            resolved.runtime.allowDangerouslySkipPermissions,
          searchEnabled: resolved.runtime.searchEnabled,
          imageInputEnabled: resolved.runtime.imageInputEnabled,
          native: resolved.runtime.native,
          workspacePolicy: resolved.runtime.workspacePolicy,
          runtimeCapabilities: sessionRuntimeCapabilities,
          runtimeCapabilityEnv: runtimeCapabilityGrant.env,
          runtimeCapabilityGrant: runtimeCapabilityGrant.metadata,
          runtimeCapabilityRedactionValues:
            runtimeCapabilityGrant.redactionValues,
          installOysterunSkills: body.install_oysterun_skills === true,
        });
      } catch (err) {
        if (isProviderUnavailableError(err)) {
          return respond(
            res,
            err.statusCode || 503,
            serializeProviderUnavailableError(err)
          );
        }
        throw err;
      }
      applySessionWebsiteAccessRequest(session, body);
      session.notificationConfig = buildResolvedSessionNotificationConfig(
        resolved.layers
      );
      applySessionNotificationConfigRequest(session, body);
      const bookkeepingWarnings = [...(session.bookkeepingWarnings || [])];
      try {
        setAgentFolder(agent_id, resolvedFolder, session.id);
      } catch (err) {
        const warning = `registry.folder_write_failed: ${err.message}`;
        bookkeepingWarnings.push(warning);
        console.error(`[sessions/resume] ${agent_id} ${warning}`);
      }
      try {
        updateAgentSession(agent_id, session.id);
      } catch (err) {
        const warning = `registry.session_write_failed: ${err.message}`;
        bookkeepingWarnings.push(warning);
        console.error(`[sessions/resume] ${agent_id} ${warning}`);
      }
      let childMatrixBinding;
      let childMatrixStorageProof;
      let matrixTimelineReplayProof;
      try {
        childMatrixBinding = createRouteCMatrixRoomBinding({
          session,
          agentId: agent_id,
        });
        childMatrixStorageProof = ensureRouteCMatrixRoomStorage({
          binding: childMatrixBinding,
        });
        matrixTimelineReplayProof = copyRouteCMatrixRoomTimeline({
          sourceBinding: sourceMatrixBinding,
          targetBinding: childMatrixBinding,
          parentSessionId: sourceSessionId,
          childSessionId: session.id,
        });
      } catch (err) {
        console.error(
          `[sessions/resume] Route C Matrix branch/copy replay failed for ${session.id}: ${err.message}`
        );
        try {
          await sessionManager.killSession(session.id);
        } catch (killErr) {
          console.error(
            `[sessions/resume] Failed to kill branch/copy child ${session.id}: ${killErr.message}`
          );
        }
        return respond(res, 500, {
          error: `Route C branch/copy Matrix timeline replay failed: ${err.message}`,
          source_session_id: sourceSessionId,
          session_id: session.id,
          source_matrix_room_id: sourceMatrixBinding.matrix_room_id,
          matrix_timeline_replay_required: true,
          committed_transcript_truth: "matrix_room_timeline",
          db_transcript_copy_product_truth: false,
          transcript_surface_classification: "product_matrix_path",
          matrix_product_transcript_truth: true,
          product_local_transcript_replay_shortcut_used: false,
          direct_matrix_harness_write_used: false,
          routec_host_owned_matrix_storage: true,
        });
      }
      emitSessionLifecycleEvent(session, "resume", {
        parent_session_id: sourceSessionId,
      });
      const sessionSetupProof = buildSessionSetupProviderModelPermissionProof({
        body,
        requestedProvider: explicitProvider.requestedProvider,
        resolved,
        session,
        proofSurface: "host_sessions_resume_response",
        responseStatus: "session_resumed",
        sessionStartResponseContractCountable: false,
      });
      if (
        sessionSetupProof.request_response_provider_model_permission_match !==
        true
      ) {
        console.error(
          `[sessions/resume] post-start proof mismatch session_id=${session.id}`
        );
        try {
          await sessionManager.killSession(session.id);
        } catch (err) {
          console.error(
            `[sessions/resume] Failed to kill mismatched session ${session.id}: ${err.message}`
          );
        }
        return respond(
          res,
          409,
          sessionSetupProviderModelPermissionProofMismatchResponse(
            sessionSetupProof
          )
        );
      }

      return respond(res, 200, {
        success: true,
        session_id: session.id,
        session_name: session.sessionName,
        parent_session_id: sourceSessionId,
        agent_id,
        provider: session.provider || "claude",
        permission_mode: session.permissionMode ?? null,
        approval_policy: session.approvalPolicy ?? null,
        sandbox_mode: session.sandboxMode ?? null,
        provider_resume_id: getEffectiveProviderResumeId(session),
        provider_thread_id: session.threadId || null,
        provider_transport: session.transport || null,
        model: session.model,
        reasoning_effort: session.reasoningEffort,
        provider_info: serializeConfiguredProvider(session.provider || "claude"),
        session_setup_proof_contract:
          OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
        oysterun_permission_policy_kind:
          sessionSetupProof.oysterun_permission_policy_kind,
        oysterun_permission_policy:
          sessionSetupProof.oysterun_permission_policy,
        session_setup_provider_model_permission_proof: sessionSetupProof,
        native: session.native || buildNativePayload(null),
        runtime_capabilities: serializeRuntimeCapabilities(
          session.runtimeCapabilities,
          session.runtimeCapabilityGrant || null
        ),
        notification_settings: buildSessionNotificationSettingsPayload({
          sessionId: session.id,
          session,
        }),
        website: buildSessionWebsiteMetadata(session),
        telegram: serializeAgentTelegramConfig(session.telegramConfig),
        telegram_runtime: buildSessionTelegramRuntimeStatusPayload(session),
        profile_config: buildLiveSessionProfileConfigPayload(session),
        oysterun_provider_skill_install:
          session.oysterunProviderSkillInstall || null,
        provider_trusted_folder: session.providerTrustedFolder || null,
        provider_trust_warning:
          session.providerTrustedFolder?.warning || null,
        transcript_message_count: matrixTimelineReplayProof.copied_event_count,
        matrix_room_id: childMatrixBinding.matrix_room_id,
        parent_matrix_room_id: sourceMatrixBinding.matrix_room_id,
        matrix_timeline_replay_count:
          matrixTimelineReplayProof.copied_event_count,
        matrix_timeline_replay_proof: matrixTimelineReplayProof,
        matrix_timeline_replay_source_proof: sourceMatrixReplayProof,
        matrix_storage: childMatrixStorageProof,
        child_matrix_binding: childMatrixBinding,
        parent_matrix_binding: sourceMatrixBinding,
        committed_transcript_truth: "matrix_room_timeline",
        db_transcript_copy_product_truth: false,
        transcript_surface_classification: "product_matrix_path",
        matrix_product_transcript_truth: true,
        product_local_transcript_replay_shortcut_used: false,
        direct_matrix_harness_write_used: false,
        alive: session.alive,
        ready: session._ready,
        capabilities: session.capabilities || {},
        workspace_policy: serializeWorkspacePolicy(session.workspacePolicy),
        bookkeeping_warning: bookkeepingWarnings.length
          ? bookkeepingWarnings.join("; ")
          : null,
      });
    }

    // ── POST /session/resume ───────────────────────────────
    // Same-session Resume for Phase 3.2.2: preserve the Host session id and
    // therefore the Route C Matrix room binding key. Branch/fork creation stays
    // on /sessions/resume.
    if (req.method === "POST" && path === "/session/resume") {
      const body = await readBody(req);
      const {
        session_id,
        source_session_id,
        agent_id,
        agent_folder,
        session_name,
      } = body;

      if (!agent_id) {
        return respond(res, 400, { error: "agent_id required" });
      }
      const requestedSessionId = normalizeString(session_id);
      const sourceSessionId = normalizeString(source_session_id || session_id);
      if (!requestedSessionId) {
        return respond(res, 400, { error: "session_id required" });
      }
      if (!sourceSessionId) {
        return respond(res, 400, { error: "source_session_id required" });
      }
      if (requestedSessionId !== sourceSessionId) {
        return respond(res, 409, {
          error:
            "Same-session Resume requires session_id to equal source_session_id",
          code: "same_session_resume_id_mismatch",
          session_id: requestedSessionId,
          source_session_id: sourceSessionId,
        });
      }
      if (!requireAgentCapability(claims, agent_id, "can_start_session", res))
        return;
      if (sessionManager.getSession(sourceSessionId)) {
        return respond(res, 409, {
          error:
            "Source session is already live; same-session Resume requires a stopped session",
          code: "same_session_resume_live_session_conflict",
          session_id: sourceSessionId,
        });
      }

      const sourceRecord =
        getSessionHistory().find(
          (entry) => entry.session_id === sourceSessionId
        ) || null;
      if (!sourceRecord) {
        return respond(res, 404, {
          error: "Source session history record not found",
          code: "same_session_resume_source_history_missing",
        });
      }
      if (sourceRecord.agent_id !== agent_id) {
        return respond(res, 400, {
          error: "Resume source agent does not match requested agent",
        });
      }

      let resolvedFolder =
        sourceRecord.agent_folder || getAgentFolder(agent_id);
      if (claims._dashboardAuth && agent_folder) {
        resolvedFolder = agent_folder;
      }
      if (!resolvedFolder) {
        return respond(res, 400, {
          error: "No local folder mapping configured for this agent",
        });
      }

      let sourceCanonicalFolder;
      let requestedCanonicalFolder;
      try {
        sourceCanonicalFolder = realpathSync(sourceRecord.agent_folder);
        requestedCanonicalFolder = realpathSync(resolvedFolder);
      } catch (err) {
        return respond(res, 400, {
          error: `Resume folder validation failed: ${err.message}`,
        });
      }
      if (sourceCanonicalFolder !== requestedCanonicalFolder) {
        return respond(res, 400, {
          error: "Resume source folder does not match requested folder",
        });
      }

      const explicitProvider = readExplicitRequestedProvider(body);
      if (explicitProvider.error) {
        return respond(res, 400, { error: explicitProvider.error });
      }
      const resolved = resolveAgentRuntimeConfig(
        resolvedFolder,
        buildRuntimeOverridesFromBody(
          body,
          explicitProvider.requestedProvider ?? undefined
        )
      );
      try {
        validateProviderPermissionRequest({
          body,
          providerId: resolved.runtime.provider,
          config: readConfig(),
          source: "session_resume",
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      if (
        explicitProvider.requestedProvider &&
        resolved.runtime.provider !== explicitProvider.requestedProvider
      ) {
        return respond(
          res,
          500,
          providerMismatchResponse(
            explicitProvider.requestedProvider,
            resolved.runtime.provider
          )
        );
      }
      if (!resolved.runtime.providerInfo.runtimeSupported) {
        return respond(res, 501, {
          error: `Provider "${resolved.runtime.provider}" is not runtime-supported yet`,
          provider: resolved.runtime.provider,
          provider_info: serializeProvider(resolved.runtime.providerInfo),
          coder_settings: buildCoderSettings(resolved.runtime),
          native: buildNativePayload(resolved.runtime),
        });
      }
      if (resolved.runtime.provider !== sourceRecord.runtime) {
        return respond(res, 409, {
          error: `Source session runtime "${sourceRecord.runtime}" does not match requested runtime "${resolved.runtime.provider}"`,
          source_runtime: sourceRecord.runtime,
          requested_runtime: resolved.runtime.provider,
        });
      }

      const resumeProofFields = buildSessionSetupProviderModelPermissionFields({
        body,
        requestedProvider: explicitProvider.requestedProvider,
        resolved,
      });
      if (!resumeProofFields.request_response_provider_model_permission_match) {
        console.error(
          `[session/resume] proof mismatch requested_provider=${
            resumeProofFields.requestedProvider || "missing"
          }` +
            ` resolved_provider=${resumeProofFields.provider || "missing"}` +
            ` requested_model=${
              resumeProofFields.requestedModel || "missing"
            }` +
            ` resolved_model=${resumeProofFields.model || "missing"}`
        );
        return respond(
          res,
          409,
          sessionSetupProviderModelPermissionMismatchResponse(resumeProofFields)
        );
      }

      const resumeAdapter = sessionManager.getAdapter(
        resolved.runtime.provider
      );
      if (
        typeof resumeAdapter.supportsResume !== "function" ||
        resumeAdapter.supportsResume() !== true
      ) {
        return respond(res, 409, {
          error: `Provider "${resolved.runtime.provider}" does not support same-session Resume`,
          code: "same_session_resume_provider_unsupported",
        });
      }

      const sourceProviderMetadata = resolveProviderResumeMetadataFromHistory(
        sourceRecord,
        resumeAdapter
      );
      if (sourceProviderMetadata.reason === "unsupported_runtime") {
        return respond(res, 409, { error: sourceProviderMetadata.message });
      }
      if (sourceProviderMetadata.reason === "provider_resume_unsupported") {
        return respond(res, 409, {
          error: `Provider "${resolved.runtime.provider}" does not support same-session Resume`,
          code: "same_session_resume_provider_unsupported",
        });
      }
      if (
        sourceProviderMetadata.reason === "provider_resume_metadata_missing"
      ) {
        return respond(res, 409, {
          error: "Source session is missing provider resume metadata",
          code: "provider_resume_metadata_missing",
          session_id: sourceSessionId,
        });
      }

      let sourceMatrixBinding;
      let sourceMatrixReplayProof;
      try {
        sourceMatrixBinding = requireRouteCMatrixRoomBinding(sourceSessionId);
        sourceMatrixReplayProof = getRouteCMatrixRoomTimelineReplaySourceProof({
          sourceBinding: sourceMatrixBinding,
        });
      } catch (err) {
        return respond(res, 409, {
          error: `Source session Matrix room timeline is required for same-session Resume: ${err.message}`,
          code: "same_session_resume_matrix_timeline_missing",
          source_session_id: sourceSessionId,
          matrix_timeline_replay_required: true,
          committed_transcript_truth: "matrix_room_timeline",
          host_db_transcript_product_truth: false,
          transcript_surface_classification: "product_matrix_path",
          matrix_product_transcript_truth: true,
          product_local_transcript_replay_shortcut_used: false,
          direct_matrix_harness_write_used: false,
          routec_host_owned_matrix_storage: true,
        });
      }

      const resolvedSessionName =
        normalizeSessionName(session_name) ||
        normalizeSessionName(sourceRecord.session_name) ||
        sourceSessionId;
      if (
        sessionManager.hasRunningSessionName(resolvedSessionName, {
          excludeSessionId: sourceSessionId,
        })
      ) {
        return respond(res, 409, {
          error: buildSessionNameConflictMessage(resolvedSessionName),
        });
      }

      const sessionRuntimeCapabilities =
        resolveRuntimeCapabilitiesForSessionStart(resolved.config, body);
      try {
        ensureRequestedWebsiteScaffoldBeforeSession({
          agentId: agent_id,
          folder: resolvedFolder,
          body,
          resolved,
        });
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
      const runtimeCapabilityGrant = buildLiveSessionRuntimeCapabilityGrant({
        sessionId: sourceSessionId,
        agentId: agent_id,
        capabilities: sessionRuntimeCapabilities,
      });
      let session;
      try {
        session = sessionManager.start({
          agentId: agent_id,
          cwd: resolvedFolder,
          sessionId: sourceSessionId,
          sessionName: resolvedSessionName,
          provider: resolved.runtime.provider,
          parentSessionId: sourceRecord.parent_session_id || null,
          resumeSessionId: sourceProviderMetadata.providerResumeId,
          resume: true,
          fork: false,
          model: resolved.runtime.model,
          reasoningEffort: resolved.runtime.reasoningEffort,
          reasoningEffortSource: resolved.runtime.reasoningEffortSource,
          permissionMode: resolved.runtime.permissionMode,
          approvalPolicy: resolved.runtime.approvalPolicy,
          sandboxMode: resolved.runtime.sandboxMode,
          dangerousMode: resolved.runtime.dangerousMode,
          allowDangerouslySkipPermissions:
            resolved.runtime.allowDangerouslySkipPermissions,
          searchEnabled: resolved.runtime.searchEnabled,
          imageInputEnabled: resolved.runtime.imageInputEnabled,
          native: resolved.runtime.native,
          workspacePolicy: resolved.runtime.workspacePolicy,
          runtimeCapabilities: sessionRuntimeCapabilities,
          runtimeCapabilityEnv: runtimeCapabilityGrant.env,
          runtimeCapabilityGrant: runtimeCapabilityGrant.metadata,
          runtimeCapabilityRedactionValues:
            runtimeCapabilityGrant.redactionValues,
          installOysterunSkills: body.install_oysterun_skills === true,
        });
      } catch (err) {
        if (isProviderUnavailableError(err)) {
          return respond(
            res,
            err.statusCode || 503,
            serializeProviderUnavailableError(err)
          );
        }
        throw err;
      }

      if (session.id !== sourceSessionId) {
        try {
          await sessionManager.killSession(session.id);
        } catch (err) {
          console.error(
            `[session/resume] Failed to kill mismatched session ${session.id}: ${err.message}`
          );
        }
        return respond(res, 409, {
          error: "Same-session Resume did not preserve source session id",
          code: "same_session_resume_id_not_preserved",
          session_id: session.id,
          source_session_id: sourceSessionId,
        });
      }

      applySessionWebsiteAccessRequest(session, body);
      session.notificationConfig = buildResolvedSessionNotificationConfig(
        resolved.layers
      );
      applySessionNotificationConfigRequest(session, body);
      const bookkeepingWarnings = [...(session.bookkeepingWarnings || [])];
      try {
        setAgentFolder(agent_id, resolvedFolder, session.id);
      } catch (err) {
        const warning = `registry.folder_write_failed: ${err.message}`;
        bookkeepingWarnings.push(warning);
        console.error(`[session/resume] ${agent_id} ${warning}`);
      }
      try {
        updateAgentSession(agent_id, session.id);
      } catch (err) {
        const warning = `registry.session_write_failed: ${err.message}`;
        bookkeepingWarnings.push(warning);
        console.error(`[session/resume] ${agent_id} ${warning}`);
      }

      emitSessionLifecycleEvent(session, "resume", {
        source_session_id: sourceSessionId,
        same_session_resume: true,
      });
      const sessionSetupProof = buildSessionSetupProviderModelPermissionProof({
        body,
        requestedProvider: explicitProvider.requestedProvider,
        resolved,
        session,
        proofSurface: "host_sessions_resume_response",
        responseStatus: "same_session_resumed",
        sessionStartResponseContractCountable: false,
      });
      if (
        sessionSetupProof.request_response_provider_model_permission_match !==
        true
      ) {
        console.error(
          `[session/resume] post-start proof mismatch session_id=${session.id}`
        );
        try {
          await sessionManager.killSession(session.id);
        } catch (err) {
          console.error(
            `[session/resume] Failed to kill mismatched session ${session.id}: ${err.message}`
          );
        }
        return respond(
          res,
          409,
          sessionSetupProviderModelPermissionProofMismatchResponse(
            sessionSetupProof
          )
        );
      }

      return respond(res, 200, {
        success: true,
        session_id: session.id,
        source_session_id: sourceSessionId,
        session_name: session.sessionName,
        parent_session_id: session.parentSessionId || null,
        agent_id,
        provider: session.provider || "claude",
        permission_mode: session.permissionMode ?? null,
        approval_policy: session.approvalPolicy ?? null,
        sandbox_mode: session.sandboxMode ?? null,
        provider_resume_id: getEffectiveProviderResumeId(session),
        provider_thread_id: session.threadId || null,
        provider_transport: session.transport || null,
        model: session.model,
        reasoning_effort: session.reasoningEffort,
        provider_info: serializeConfiguredProvider(session.provider || "claude"),
        session_setup_proof_contract:
          OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
        oysterun_permission_policy_kind:
          sessionSetupProof.oysterun_permission_policy_kind,
        oysterun_permission_policy:
          sessionSetupProof.oysterun_permission_policy,
        session_setup_provider_model_permission_proof: sessionSetupProof,
        native: session.native || buildNativePayload(null),
        runtime_capabilities: serializeRuntimeCapabilities(
          session.runtimeCapabilities,
          session.runtimeCapabilityGrant || null
        ),
        notification_settings: buildSessionNotificationSettingsPayload({
          sessionId: session.id,
          session,
        }),
        website: buildSessionWebsiteMetadata(session),
        telegram: serializeAgentTelegramConfig(session.telegramConfig),
        telegram_runtime: buildSessionTelegramRuntimeStatusPayload(session),
        profile_config: buildLiveSessionProfileConfigPayload(session),
        oysterun_provider_skill_install:
          session.oysterunProviderSkillInstall || null,
        provider_trusted_folder: session.providerTrustedFolder || null,
        provider_trust_warning:
          session.providerTrustedFolder?.warning || null,
        matrix_room_id: sourceMatrixBinding.matrix_room_id,
        matrix_timeline_replay_source_proof: sourceMatrixReplayProof,
        committed_transcript_truth: "matrix_room_timeline",
        host_db_transcript_product_truth: false,
        transcript_surface_classification: "product_matrix_path",
        matrix_product_transcript_truth: true,
        product_legacy_transcript_caller_allowed: false,
        product_local_transcript_replay_shortcut_used: false,
        direct_matrix_harness_write_used: false,
        routec_host_owned_matrix_storage: true,
        same_session_resume: true,
        routec_matrix_binding_key: session.id,
        copied_transcript_to_child_session: false,
        alive: session.alive,
        ready: session._ready,
        capabilities: session.capabilities || {},
        workspace_policy: serializeWorkspacePolicy(session.workspacePolicy),
        bookkeeping_warning: bookkeepingWarnings.length
          ? bookkeepingWarnings.join("; ")
          : null,
      });
    }

    // ── GET /sessions ──────────────────────────────────────
    if (req.method === "GET" && path === "/sessions") {
      const allSessions = sessionManager.list();
      const accessible = claims._dashboardAuth
        ? allSessions
        : allSessions.filter((s) => claims.agent_ids.includes(s.agentId));
      return respond(res, 200, {
        sessions: accessible.map((session) => {
          const sessionId = session.id || session.sessionId;
          const liveSession = sessionId
            ? sessionManager.getSession(sessionId) || session
            : session;
          return {
            ...session,
            runtime_capabilities: serializeRuntimeCapabilities(
              session.runtimeCapabilities,
              session.runtimeCapabilityGrant || null
            ),
            notification_settings: sessionId
              ? buildSessionNotificationSettingsPayload({
                  sessionId,
                  session: liveSession,
                })
              : null,
            website: buildSessionWebsiteMetadata(liveSession),
            telegram: serializeAgentTelegramConfig(liveSession.telegramConfig),
            telegram_runtime:
              buildSessionTelegramRuntimeStatusPayload(liveSession),
            profile_config: liveSession
              ? buildLiveSessionProfileConfigPayload(liveSession)
              : buildSessionProfileConfigPayload(
                  session.cwd,
                  session.provider || "claude",
                  session.model || null
                ),
            lastMessagePreview: getLastMessagePreview(
              session.cwd,
              session.agentId,
              sessionId
            ),
          };
        }),
      });
    }

    // ── 404 ────────────────────────────────────────────────
    respond(res, 404, { error: "Not found" });
  } catch (err) {
    const routeCControlSemanticError =
      routeCSessionControlSemanticErrorResponse(err);
    if (routeCControlSemanticError) {
      return respond(
        res,
        routeCControlSemanticError.statusCode,
        routeCControlSemanticError.body
      );
    }
    appendHostRuntimeDiagnostic({
      level: "error",
      kind: "host_http_request_exception",
      request_method: req.method,
      request_path: path,
      response_kind:
        res.headersSent || res.writableEnded
          ? "diagnostic_only_after_response_started"
          : "host_500",
      error: serializeRuntimeError(err),
      raw_secret_material_exposed: false,
    });
    console.error("[server]", err);
    if (res.headersSent || res.writableEnded) {
      return;
    }
    respond(res, 500, {
      error: "Oysterun Host request failed.",
      diagnostic_code: "host_request_internal_error",
      raw_secret_material_exposed: false,
    });
  }
});

// ── WebSocket: /session/stream ───────────────────────────────

const notificationWss = new WebSocketServer({ noServer: true });
const mailNotificationWss = new WebSocketServer({ noServer: true });
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/notifications/complete-message") {
    notificationWss.handleUpgrade(req, socket, head, (ws) => {
      notificationWss.emit("connection", ws, req);
    });
    return;
  }
  if (url.pathname === "/notifications/mail") {
    mailNotificationWss.handleUpgrade(req, socket, head, (ws) => {
      mailNotificationWss.emit("connection", ws, req);
    });
    return;
  }
  if (url.pathname === "/session/stream") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});

function authenticateDashboardNotificationWebSocket(req, url) {
  let claims = dashboardAuthenticateToken(url.searchParams.get("token"));

  if (!claims) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const proto =
      typeof req.headers["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"].split(",")[0].trim()
        : req.socket.encrypted
          ? "https"
          : "http";
    const expectedOrigin = host ? `${proto}://${host}` : "";
    if (!origin || origin === expectedOrigin) {
      claims = dashboardAuthenticate(req);
    }
  }
  return claims;
}

notificationWss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const claims = authenticateDashboardNotificationWebSocket(req, url);

  if (!claims?._dashboardAuth) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Dashboard authentication required",
      })
    );
    ws.close(4001, "Authentication failed");
    return;
  }

  completeMessageNotificationSubscribers.add(ws);
  ws.send(
    JSON.stringify({
      type: "status",
      source: "matrix_committed_event",
      active: true,
    })
  );
  ws.on("close", () => {
    completeMessageNotificationSubscribers.delete(ws);
  });
  ws.on("error", () => {
    completeMessageNotificationSubscribers.delete(ws);
  });
});

mailNotificationWss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const claims = authenticateDashboardNotificationWebSocket(req, url);

  if (!claims?._dashboardAuth) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Dashboard authentication required",
      })
    );
    ws.close(4001, "Authentication failed");
    return;
  }

  mailNotificationSubscribers.add(ws);
  ws.send(
    JSON.stringify({
      type: "status",
      source: "mail_item_committed",
      active: true,
    })
  );
  ws.on("close", () => {
    mailNotificationSubscribers.delete(ws);
  });
  ws.on("error", () => {
    mailNotificationSubscribers.delete(ws);
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get("session_id");
  const replayMode = url.searchParams.get("replay") === "off" ? "off" : "all";

  if (!sessionId) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: "session_id query param required",
      })
    );
    ws.close(4000, "Missing session_id");
    return;
  }

  // Authenticate: try dashboard token first, then same-origin dashboard cookie,
  // then Authorization header, then ?token= JWT.
  let claims;
  const token = url.searchParams.get("token");

  // Try dashboard token from query param
  claims = dashboardAuthenticateToken(token);

  if (!claims) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const proto =
      typeof req.headers["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"].split(",")[0].trim()
        : req.socket.encrypted
          ? "https"
          : "http";
    const expectedOrigin = host ? `${proto}://${host}` : "";
    if (!origin || origin === expectedOrigin) {
      claims = dashboardAuthenticate(req);
    }
  }

  if (!claims) {
    // Try Authorization header (JWT)
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      // Could be dashboard token or JWT
      const bearerToken = authHeader.slice(7);
      claims = dashboardAuthenticateToken(bearerToken);
    }
  }

  if (!claims) {
    // Try JWT auth
    try {
      if (token) {
        claims = verifyAccessToken(
          token,
          DEVICE_SIGNING_PUBLIC_KEY,
          DEVICE_SIGNING_KID,
          DEVICE_ID
        );
      } else {
        claims = authenticateRequest(
          req,
          DEVICE_SIGNING_PUBLIC_KEY,
          DEVICE_SIGNING_KID,
          DEVICE_ID
        );
      }
    } catch (err) {
      ws.send(
        JSON.stringify({ type: "error", error: `Auth failed: ${err.message}` })
      );
      ws.close(4001, "Authentication failed");
      return;
    }
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", error: "Session not found" }));
    ws.close(4004, "Session not found");
    return;
  }
  const agentId = session.agentId;

  // Check agent access
  if (!hasAgentCapability(claims, agentId, "can_chat")) {
    if (!hasAgentAccess(claims, agentId)) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: "Access denied: not a member of this agent",
        })
      );
      ws.close(4003, "Access denied");
      return;
    }
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Access denied: missing can_chat",
      })
    );
    ws.close(4003, "Access denied");
    return;
  }

  // Subscribe to session messages
  if (!sessionSubscribers.has(sessionId)) {
    sessionSubscribers.set(sessionId, new Set());
  }
  sessionSubscribers.get(sessionId).add(ws);

  console.log(
    `[ws] Client ${claims.user_id} subscribed to session ${sessionId}`
  );

  // Send current session status on connect
  ws.send(
    JSON.stringify({
      type: "status",
      agentId,
      active: !!session,
      alive: session?.alive ?? false,
      ready: session?._ready ?? false,
      provider: session?.provider || null,
      model: session?.model || null,
      reasoning_effort: session?.reasoningEffort || null,
      permission_mode: session?.permissionMode ?? null,
      approval_policy: session?.approvalPolicy ?? null,
      sandbox_mode: session?.sandboxMode ?? null,
      native: session?.native || buildNativePayload(null),
      provider_info: session?.provider
        ? serializeConfiguredProvider(session.provider)
        : null,
      capabilities: session?.capabilities || {},
      runtime_capabilities: serializeRuntimeCapabilities(
        session?.runtimeCapabilities || DEFAULT_AGENT_RUNTIME_CAPABILITIES,
        session?.runtimeCapabilityGrant || null
      ),
      notification_settings: session
        ? buildSessionNotificationSettingsPayload({ sessionId: session.id, session })
        : null,
      session_id: session?.id ?? null,
      provider_resume_id: getEffectiveProviderResumeId(session),
      provider_thread_id: session?.threadId || null,
      provider_transport: session?.transport || null,
      cwd: session?.cwd || null,
      website: session
        ? buildSessionWebsiteMetadata(session)
        : buildAgentWebsiteMetadata(agentId, null),
      telegram: session
        ? serializeAgentTelegramConfig(session.telegramConfig)
        : serializeAgentTelegramConfig({}),
      telegram_runtime: session
        ? buildSessionTelegramRuntimeStatusPayload(session)
        : null,
      profile_config: session
        ? buildLiveSessionProfileConfigPayload(session)
        : buildSessionProfileConfigPayload(
            session?.cwd || null,
            session?.provider || "claude",
            session?.model || null
          ),
      workspace_policy: serializeWorkspacePolicy(
        session?.workspacePolicy ?? null
      ),
      pending_control_requests: serializePendingControlRequests(session),
    })
  );
  if (replayMode !== "off") {
    const replayMessages = messageBuffers.get(sessionId) || [];
    for (const payload of replayMessages) {
      ws.send(JSON.stringify(payload));
    }
  }

  // Handle incoming messages from WebSocket clients
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "send") {
        if (!hasAgentCapability(claims, agentId, "can_chat")) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Access denied: missing can_chat",
            })
          );
          return;
        }
        const nickname = msg.nickname || "User";
        const liveSession = sessionManager.getSession(sessionId);
        if (!liveSession) {
          ws.send(
            JSON.stringify({ type: "error", error: "Session not found" })
          );
          return;
        }

        if (isDemotedLoopStopCommandInput(msg.text)) {
          ws.send(
            JSON.stringify({
              type: "scheduler.loop.demoted",
              ...buildDemotedLoopStopCommandResponse(),
              session_id: liveSession.id,
              agent_id: liveSession.agentId,
            })
          );
          return;
        }

        try {
          const loopResult = schedulerService.createOrEnableLoopFromInput({
            hostSessionId: liveSession.id,
            agentId: liveSession.agentId,
            agentFolder: liveSession.cwd,
            createdBy: claims.user_id,
            inputText: msg.text,
          });
          if (loopResult) {
            const feedback = await writeLoopFeedbackOrThrow({
              session: liveSession,
              action: classifyLoopFeedbackAction({ result: loopResult }),
              schedule: loopResult.feedback_schedule || loopResult.schedule,
            });
            ws.send(
              JSON.stringify({
                type: "scheduler.loop",
                ...buildLoopSchedulerResponse(loopResult, liveSession),
                matrix_feedback: feedback,
              })
            );
            return;
          }
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: err.message,
              scheduler_command: "loop",
            })
          );
          return;
        }

        sessionManager.sendToSession(
          liveSession.id,
          claims.user_id,
          nickname,
          msg.text
        );
      } else if (msg.type === "exec") {
        if (!isDashboardOnly(claims)) {
          ws.send(
            JSON.stringify({ type: "error", error: "Dashboard-only endpoint" })
          );
          return;
        }

        const targetSessionId =
          typeof msg.sessionId === "string" && msg.sessionId.trim()
            ? msg.sessionId.trim()
            : sessionId;
        if (targetSessionId !== sessionId) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "sessionId must match the subscribed stream",
            })
          );
          return;
        }

        const command =
          typeof msg.command === "string" ? msg.command.trim() : "";
        if (!command) {
          ws.send(JSON.stringify({ type: "error", error: "command required" }));
          return;
        }

        const cwd = getSessionExecutionCwd(sessionId);
        if (!cwd) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "No live session cwd available",
            })
          );
          return;
        }

        runShellCommand(sessionId, command, cwd);
      } else if (msg.type === "control_response") {
        const liveSession = sessionManager.getSession(sessionId);
        if (liveSession) {
          submitProviderControlResponse(liveSession, {
            request_id: msg.request_id,
            allow: msg.allow,
            answers: msg.answers,
            response: msg.response,
            grant_suggestion: msg.grant_suggestion,
          });
        }
      }
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: "Invalid message: " + err.message,
        })
      );
    }
  });

  ws.on("close", () => {
    const subs = sessionSubscribers.get(sessionId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) {
        sessionSubscribers.delete(sessionId);
      }
    }
    console.log(
      `[ws] Client ${claims.user_id} unsubscribed from session ${sessionId}`
    );
  });
});

// ── Start ────────────────────────────────────────────────────

/**
 * Build the per-provider opts object for createTunnelAgent().
 * Returns null when required config for the chosen provider is missing
 * so server.mjs can log a clear "skipping tunnel" message instead of
 * throwing on incomplete bootstrap.
 */
function buildTunnelAgentOpts(provider) {
  const sharedOpts = {
    deviceId: DEVICE_ID,
    backendUrl: BACKEND_URL,
    backendStage: BACKEND_STAGE,
    localPort: PORT,
    heartbeatInterval: HEARTBEAT_INTERVAL,
    appVersion: "0.1.0",
    deviceToken: DEVICE_TOKEN,
  };

  if (provider === "frp") {
    if (!FRP_SERVER_ADDR || !FRP_SERVER_PORT || !FRP_TOKEN || !FRP_SUBDOMAIN || !FRP_SUBDOMAIN_HOST) {
      return null;
    }
    return {
      ...sharedOpts,
      frpServerAddr: FRP_SERVER_ADDR,
      frpServerPort: FRP_SERVER_PORT,
      frpToken: FRP_TOKEN,
      frpSubdomain: FRP_SUBDOMAIN,
      frpSubdomainHost: FRP_SUBDOMAIN_HOST,
      configDir: join(getConfigDir(), "frp"),
    };
  }

  if (provider === "ngrok") {
    if (!NGROK_DOMAIN) return null;
    return {
      ...sharedOpts,
      ngrokDomain: NGROK_DOMAIN,
    };
  }

  throw new Error(`Unknown tunnel provider: ${provider}`);
}

// First-run Cloud onboarding. A Host that has a Cloud backend but no device_token
// cannot deliver Cloud-mediated push (the dispatcher skips with
// cloud_delivery_not_configured). A non-technical user would never discover the
// `setup.mjs --enable-cloud` step, so register automatically on first boot.
// Idempotent: only runs when device_token is missing, persists the token to
// cloud_identity.json so later boots skip it, and refreshes the in-process
// identity so push status and dispatch payloads see the token without a restart.
// Bounded by a timeout so an unreachable Cloud cannot block startup.
async function ensureHostCloudRegistration() {
  if (normalizeString(DEVICE_TOKEN)) return; // already provisioned
  const backendUrl = normalizeString(BACKEND_URL);
  if (!backendUrl) return; // nothing to register against
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(buildCloudApiUrl(backendUrl, "/api/device/register", BACKEND_STAGE), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_type: "macmini",
        display_name: normalizeString(readConfig().display_name) || "Oysterun Host",
        app_version: "0.1.0",
        local_service_port: PORT,
        connection_mode: CONNECTION_MODE,
        direct_host_url: CONNECTION_MODE === "direct" ? normalizeString(DIRECT_HOST_URL) : null,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      console.warn(
        `[oysterun-host] Auto cloud registration failed (HTTP ${resp.status}) at ${backendUrl}`
      );
      return;
    }
    const data = await resp.json();
    const hostId = data.host_id || data.device_id;
    const hostCredential = data.host_credential || data.device_token;
    writeConfig({
      host_id: hostId,
      host_credential: hostCredential,
      device_id: hostId,
      device_token: hostCredential,
      device_signing_public_key: data.device_signing_public_key,
      device_signing_kid: data.device_signing_kid,
      cloud_public_key: data.device_signing_public_key,
      backend_url: backendUrl,
      direct_host_url: data.direct_host_url || normalizeString(DIRECT_HOST_URL),
      registered_at: new Date().toISOString(),
    });
    BACKEND_URL = backendUrl;
    BACKEND_STAGE = resolveCloudBackendStage();
    DEVICE_ID = hostId;
    DEVICE_TOKEN = hostCredential;
    DIRECT_HOST_URL = data.direct_host_url || normalizeString(DIRECT_HOST_URL);
    DEVICE_SIGNING_PUBLIC_KEY = data.device_signing_public_key;
    DEVICE_SIGNING_KID = data.device_signing_kid;
    console.log(
      `[oysterun-host] Auto-registered with Cloud at ${backendUrl} (host ${hostId})`
    );
  } catch (err) {
    console.warn(
      `[oysterun-host] Auto cloud registration error at ${backendUrl}: ${err.message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

function reconcileHostRestartRestoreOnBoot() {
  const existing = readHostRestartRestoreState({ configDir: getConfigDir() });
  const activeStack = getActiveStackName();
  const validation = validateConsumableHostRestartRestoreState({
    transaction: existing,
    stackName: activeStack,
  });
  if (!validation.valid) {
    lastHostRestartRestoreStatus = {
      status: validation.status,
      consumed: false,
      restart_restore: buildHostRestartRestoreSummary(existing),
    };
    return lastHostRestartRestoreStatus;
  }
  const snapshot = existing.runtime_snapshot || {};
  const restoredAt = new Date().toISOString();
  const sessionRestore = sessionManager.restoreHostRestartState(
    snapshot.sessions || [],
    {
      restartId: existing.restart_id,
      restoredAt,
      buildRuntimeCapabilityGrant: ({ sessionId, agentId, capabilities }) =>
        buildLiveSessionRuntimeCapabilityGrant({
          sessionId,
          agentId,
          capabilities,
        }),
    }
  );
  const loopRestore = schedulerService.restoreSessionLoopRestartState(
    snapshot.loops || {},
    {
      restartId: existing.restart_id,
      restoredAt,
    }
  );
  const schedulerRestore = schedulerService.markHostRestartInterruptedRuns({
    restartId: existing.restart_id,
    interruptedAt: restoredAt,
  });
  const terminalRestore = terminalSessionManager.markHostRestartInterrupted({
    restartId: existing.restart_id,
    interruptedAt: restoredAt,
  });
  const shellExecRestore = markHostRestartInterruptedShellExecs(
    snapshot.shell_execs || [],
    {
      restartId: existing.restart_id,
      interruptedAt: restoredAt,
    }
  );
  const restoreResult = {
    restored_at: restoredAt,
    session_restore: sessionRestore,
    loop_restore: loopRestore,
    scheduler_restore: schedulerRestore,
    terminal_restore: terminalRestore,
    shell_exec_restore: shellExecRestore,
    prompt_replay: false,
    terminal_command_replay: false,
    matrix_transcript_mutation: false,
    idempotent_consume: true,
  };
  const consumed = consumeHostRestartRestoreState({
    configDir: getConfigDir(),
    stackName: getActiveStackName(),
    restoreResult,
  });
  const operationLogPath =
    consumed.status === "consumed"
      ? appendHostRestartRestoreOperationLog({
          transaction: consumed.transaction,
          restoreResult,
        })
      : null;
  lastHostRestartRestoreStatus = {
    status: consumed.status,
    consumed: consumed.status === "consumed",
    restart_restore: buildHostRestartRestoreSummary(consumed.transaction),
    session_restore: sessionRestore,
    loop_restore: loopRestore,
    scheduler_restore: schedulerRestore,
    terminal_restore: terminalRestore,
    shell_exec_restore: shellExecRestore,
    operation_log_path: operationLogPath,
  };
  if (consumed.status === "consumed") {
    console.log(
      `[oysterun-host] Consumed Host restart restore transaction ${existing.restart_id}`
    );
  } else {
    console.warn(
      `[oysterun-host] Host restart restore transaction not consumed: ${consumed.status}`
    );
  }
  return lastHostRestartRestoreStatus;
}

reconcileHostRestartRestoreOnBoot();
schedulerRunner.start();

await ensureHostCloudRegistration();

if (!normalizeString(DEVICE_TOKEN)) {
  console.warn(
    "[oysterun-host] ⚠️  Cloud push DISABLED: device_token not provisioned — " +
      "notifications will NOT be delivered. " +
      (normalizeString(BACKEND_URL)
        ? `Auto-registration with ${BACKEND_URL} did not complete; ensure the backend is reachable, or run setup.mjs --enable-cloud.`
        : "Set OYSTERUN_BACKEND_URL only for local Cloud development and restart, or run setup.mjs --enable-cloud.")
  );
}

server.listen(PORT, () => {
  try {
    const runtimeMetadata = writeHostRuntimeMetadata({
      startedAt: HOST_RUNTIME_STARTED_AT,
      port: PORT,
      repoRoot: REPO_ROOT,
      hostDir: __dirname,
      stackName: getActiveStackName(),
      launchLabel:
        process.env.OYSTERUN_LAUNCH_LABEL ||
        process.env.OYSTERUN_RELEASE_STACK ||
        process.env.OYSTERUN_STACK ||
        null,
      connectionMode: CONNECTION_MODE,
      directHostUrl: CONNECTION_MODE === "direct" ? DIRECT_HOST_URL : null,
    });
    console.log(
      `[oysterun-host] Runtime metadata written to ${runtimeMetadata.path}`
    );
  } catch (err) {
    appendHostRuntimeDiagnostic({
      level: "warning",
      kind: "host_runtime_metadata_write_failed",
      response_kind: "startup_continues",
      error: serializeRuntimeError(err),
      raw_secret_material_exposed: false,
    });
    console.warn(
      `[oysterun-host] Runtime metadata write failed: ${err.message}`
    );
  }
  console.log(`[oysterun-host] Listening on http://localhost:${PORT}`);
  console.log(
    `[oysterun-host] WebSocket at ws://localhost:${PORT}/session/stream`
  );
  console.log(`[oysterun-host] Connection mode: ${CONNECTION_MODE}`);
  if (CONNECTION_MODE === "cloud") {
    console.log(`[oysterun-host] Backend URL: ${BACKEND_URL}`);
    if (DEVICE_SIGNING_PUBLIC_KEY) {
      console.log(
        `[oysterun-host] JWT auth enabled (device_signing_public_key loaded)`
      );
    } else {
      console.warn(
        `[oysterun-host] WARNING: device_signing_public_key not configured — Cloud auth will fail`
      );
    }
  } else {
    console.log(`[oysterun-host] Direct mode enabled (local Host login only)`);
  }

  // Start tunnel agent (frp / ngrok) only in Cloud mode when device is registered
  if (CONNECTION_MODE === "cloud" && DEVICE_ID) {
    const tunnelOpts = buildTunnelAgentOpts(TUNNEL_PROVIDER);
    if (tunnelOpts) {
      tunnelAgent = createTunnelAgent(TUNNEL_PROVIDER, tunnelOpts);

      tunnelAgent.on("ready", (url) => {
        console.log(`[oysterun-host] Tunnel ready (${TUNNEL_PROVIDER}): ${url}`);
      });

      tunnelAgent.on("exit", (code) => {
        console.error(`[oysterun-host] Tunnel exited (${TUNNEL_PROVIDER}, code=${code}). Tunnel is down.`);
      });

      Promise.resolve(tunnelAgent.start()).catch((err) => {
        console.error(`[oysterun-host] Tunnel start failed: ${err.message}`);
      });
    } else {
      console.log(
        `[oysterun-host] Tunnel provider "${TUNNEL_PROVIDER}" missing required config — skipping tunnel start`,
      );
    }
  } else if (CONNECTION_MODE === "cloud") {
    console.log(
      `[oysterun-host] Cloud mode selected but device registration is not configured`
    );
  } else {
    console.log(`[oysterun-host] Running without Cloud registration`);
  }
});

let fatalRuntimeExitScheduled = false;

function handleFatalRuntimeEscape(kind, err) {
  appendHostRuntimeDiagnostic({
    level: "fatal",
    kind,
    response_kind: "controlled_exit",
    error: serializeRuntimeError(err),
    controlled_exit: true,
    raw_secret_material_exposed: false,
  });
  console.error(`[oysterun-host] Fatal runtime ${kind}:`, err);
  if (fatalRuntimeExitScheduled) return;
  fatalRuntimeExitScheduled = true;
  const timer = setTimeout(() => {
    process.exit(1);
  }, 25);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

process.on("uncaughtException", (err) => {
  handleFatalRuntimeEscape("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  handleFatalRuntimeEscape("unhandledRejection", reason);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[oysterun-host] Shutting down...");
  if (tunnelAgent) tunnelAgent.stop();
  schedulerRunner.stop();
  providerModelRefreshRunner.stop();
  schedulerService.close();
  sessionManager.stopAll();
  wss.close();
  server.close(() => {
    console.log("[oysterun-host] Bye.");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  if (tunnelAgent) tunnelAgent.stop();
  schedulerRunner.stop();
  providerModelRefreshRunner.stop();
  schedulerService.close();
  sessionManager.stopAll();
  wss.close();
  server.close(() => process.exit(0));
});
