import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  getConfigPath,
  readRawConfigSource,
} from "../config.mjs";

export const P86_CLI_CONTRACT = "p86_product_cli_module_action_v1";
export const P86_CLI_PROFILE_CONTRACT = "p86_cli_profile_0600_token_fallback_v1";
export const P86_CLI_OPERATION_INTERFACE_SPEC =
  "docs/routec/oysterun_operation_interface_spec.md";

export const PRODUCT_CLI_MODULES = new Set([
  "auth",
  "sessions",
  "chat",
  "scheduler",
  "mail",
  "notifications",
  "website",
  "telegram",
]);

const SECRET_KEY_PATTERN =
  /(token|password|secret|cookie|authorization|auth[_-]?header|bot[_-]?token)/i;
const DEFAULT_PROFILE_NAME = "default";
const DANGEROUS_OPERATIONS = new Set([
  "sessions stop",
  "sessions interrupt",
  "sessions restart",
  "chat loop delete",
  "scheduler delete",
  "scheduler disable",
  "mail delete",
  "website access set",
  "website password set",
]);
const CHAT_SEARCH_DEFAULT_LIMIT = 20;
const CHAT_SEARCH_MAX_LIMIT = 100;
const CHAT_SEARCH_PAGE_LIMIT = 100;
const CHAT_SEARCH_MAX_PAGES = 50;
const CHAT_MESSAGES_AROUND_DEFAULT_RADIUS = 5;
const CHAT_MESSAGES_AROUND_MAX_RADIUS = 25;
const CHAT_MESSAGES_AROUND_PAGE_LIMIT = 100;
const CHAT_MESSAGES_AROUND_MAX_PAGES = 50;

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function toSnakeCase(value) {
  return String(value || "").replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function optionValue(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return options[key];
    }
  }
  return undefined;
}

function requireOption(options, label, ...keys) {
  const value = optionValue(options, ...keys);
  const normalized = normalizeString(value);
  if (!normalized) fail(`${label} is required`);
  return normalized;
}

function optionalOption(options, ...keys) {
  const value = optionValue(options, ...keys);
  return value === undefined ? "" : normalizeString(value);
}

function positiveIntegerOption(options, fallback, max, label, ...keys) {
  const raw = optionValue(options, ...keys);
  if (raw === undefined || raw === null || raw === "") return fallback;
  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) fail(`${label} must be a positive integer`);
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`${label} must be a positive integer`);
  }
  return Math.min(parsed, max);
}

function nonNegativeIntegerOption(options, fallback, max, label, ...keys) {
  const raw = optionValue(options, ...keys);
  if (raw === undefined || raw === null || raw === "") return fallback;
  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) fail(`${label} must be a non-negative integer`);
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return Math.min(parsed, max);
}

function parseBooleanOption(options, key, fallback = null) {
  if (!Object.prototype.hasOwnProperty.call(options, key)) return fallback;
  const value = options[key];
  if (typeof value === "boolean") return value;
  const normalized = normalizeString(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  fail(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be boolean`);
}

export function parseCliArgv(argv = []) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    if (!raw) fail("empty option name");
    if (raw.startsWith("no-")) {
      options[toSnakeCase(raw.slice(3))] = false;
      continue;
    }
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex >= 0) {
      const key = toSnakeCase(raw.slice(0, equalsIndex));
      options[key] = raw.slice(equalsIndex + 1);
      continue;
    }
    const key = toSnakeCase(raw);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { positionals, options };
}

export function redact(value) {
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(entry),
      ])
    );
  }
  if (typeof value === "string" && /Bearer\s+[A-Za-z0-9._~+/=-]+/.test(value)) {
    return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]");
  }
  return value;
}

function defaultProfilePath(env = process.env) {
  return (
    normalizeString(env.OYSTERUN_CLI_PROFILE_PATH) ||
    join(homedir(), ".oysterun", "cli-profiles.json")
  );
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`invalid JSON object in ${path}`);
  }
  return parsed;
}

function readProfiles(env = process.env) {
  const path = defaultProfilePath(env);
  const store = readJsonFile(path, {
    version: 1,
    contract: P86_CLI_PROFILE_CONTRACT,
    default_profile: DEFAULT_PROFILE_NAME,
    profiles: {},
  });
  if (!store.profiles || typeof store.profiles !== "object" || Array.isArray(store.profiles)) {
    store.profiles = {};
  }
  return { path, store };
}

function writeProfiles(path, store) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
  chmodSync(path, 0o600);
}

function resolveProfileName(options) {
  return optionalOption(options, "profile") || DEFAULT_PROFILE_NAME;
}

function resolveConfigOrigin() {
  try {
    const raw = readRawConfigSource();
    const direct = normalizeString(raw.direct_host_url);
    const pub = normalizeString(raw.public_base_url);
    if (direct) return direct.replace(/\/+$/, "");
    if (pub) return pub.replace(/\/+$/, "");
    const port = Number(raw.port);
    if (Number.isInteger(port) && port > 0) return `http://localhost:${port}`;
  } catch {
    return "";
  }
  return "";
}

export function resolveTarget({ options = {}, env = process.env } = {}) {
  const { store } = readProfiles(env);
  const profileName = resolveProfileName(options);
  const profile = store.profiles?.[profileName] || {};
  const origin =
    optionalOption(options, "host", "origin", "target") ||
    normalizeString(env.OYSTERUN_HOST_ORIGIN) ||
    normalizeString(profile.origin) ||
    resolveConfigOrigin();
  if (!origin) {
    fail(
      `Host origin is required. Pass --host, set OYSTERUN_HOST_ORIGIN, save a CLI profile, or configure ${getConfigPath()}.`
    );
  }
  return {
    origin: origin.replace(/\/+$/, ""),
    profileName,
    profile,
  };
}

function resolveAuthToken({ options = {}, env = process.env, target = null } = {}) {
  return (
    optionalOption(options, "token") ||
    normalizeString(env.OYSTERUN_DASHBOARD_TOKEN) ||
    normalizeString(target?.profile?.token)
  );
}

function resolveRuntimeCapabilityToken({ env = process.env } = {}) {
  return (
    normalizeString(env.OYSTERUN_CAPABILITY_TOKEN) ||
    normalizeString(env.OYSTERUN_MAIL_WRITE_TOKEN)
  );
}

function hasExplicitDashboardAuth({ options = {}, env = process.env } = {}) {
  return Boolean(
    optionalOption(options, "token") ||
      normalizeString(env.OYSTERUN_DASHBOARD_TOKEN)
  );
}

function hasLiveSessionRuntimeCapabilityEnv(env = process.env) {
  return Boolean(
    normalizeString(env.OYSTERUN_HOST_ORIGIN) &&
      resolveRuntimeCapabilityToken({ env }) &&
      normalizeString(env.OYSTERUN_SESSION_ID)
  );
}

function shouldPreferCurrentSessionRuntimeCapability(options = {}, env = process.env) {
  return (
    hasLiveSessionRuntimeCapabilityEnv(env) &&
    !hasExplicitDashboardAuth({ options, env })
  );
}

function resolveSessionId(options = {}, env = process.env) {
  return optionalOption(options, "sessionId") || normalizeString(env.OYSTERUN_SESSION_ID);
}

function requireSessionId(options = {}, env = process.env) {
  const value = resolveSessionId(options, env);
  if (!value) fail("session id is required");
  return value;
}

function resolveAgentId(options = {}, env = process.env) {
  return optionalOption(options, "agentId", "agent") || normalizeString(env.OYSTERUN_AGENT_ID);
}

function requireAgentId(options = {}, env = process.env) {
  const value = resolveAgentId(options, env);
  if (!value) fail("agent id is required");
  return value;
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiRequest({
  method,
  path,
  body,
  options = {},
  env = process.env,
  fetchFn = fetch,
  auth = true,
  allowRuntimeCapability = true,
  preferRuntimeCapability = false,
}) {
  const target = resolveTarget({ options, env });
  const runtimeCapabilityToken =
    auth && allowRuntimeCapability
      ? resolveRuntimeCapabilityToken({ env })
      : "";
  const usePreferredRuntimeCapability =
    Boolean(preferRuntimeCapability) && Boolean(runtimeCapabilityToken);
  const dashboardToken =
    auth && !usePreferredRuntimeCapability
      ? resolveAuthToken({ options, env, target })
      : "";
  const selectedRuntimeCapabilityToken =
    auth && !dashboardToken && runtimeCapabilityToken ? runtimeCapabilityToken : "";
  if (auth && !dashboardToken && !selectedRuntimeCapabilityToken) {
    fail("Dashboard token or scoped runtime capability token is required. Run `oysterun auth login`, pass --token, or run inside a Host session.");
  }
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    headers.Authorization = `Bearer ${dashboardToken || selectedRuntimeCapabilityToken}`;
    if (selectedRuntimeCapabilityToken) {
      headers["X-Oysterun-Capability-Auth"] = "runtime";
    }
  }
  const response = await fetchFn(`${target.origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readResponse(response);
  if (!response.ok) {
    const error = new Error(
      `${method} ${path} failed (${response.status}): ${
        data?.error || data?.message || JSON.stringify(redact(data))
      }`
    );
    error.exitCode = response.status >= 500 ? 1 : 2;
    error.response = data;
    throw error;
  }
  return { target, statusCode: response.status, data };
}

function jsonEnvelope({ ok = true, command, result, error = null }) {
  return {
    ok,
    command,
    contract: P86_CLI_CONTRACT,
    result: redact(result),
    error: error ? redact(error) : null,
  };
}

function writeOutput({ stdout, options, command, result }) {
  if (options.json === true) {
    stdout.write(`${JSON.stringify(jsonEnvelope({ command, result }), null, 2)}\n`);
    return;
  }
  const safe = redact(result);
  const status = normalizeString(safe?.status) || normalizeString(safe?.result?.status) || "ok";
  stdout.write(`${status}\n`);
  if (safe && typeof safe === "object") {
    for (const key of ["session_id", "mail_id", "url", "target_url", "origin", "profile", "schedule_id"]) {
      const value = safe[key] ?? safe.result?.[key];
      if (value !== undefined && value !== null && value !== "") {
        stdout.write(`${key}: ${value}\n`);
      }
    }
  }
}

function writeError({ stderr, options, command, error }) {
  const payload = jsonEnvelope({
    ok: false,
    command,
    result: null,
    error: {
      message: error.message || String(error),
      code: error.code || null,
    },
  });
  if (options.json === true) {
    stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    stderr.write(`oysterun: ${payload.error.message}\n`);
  }
}

export function requireConfirm(commandKey, options) {
  if (!DANGEROUS_OPERATIONS.has(commandKey)) return;
  if (options.dryRun === true) return;
  if (options.confirm === true) return;
  fail(`${commandKey} requires --confirm. Use --dry-run to preview without mutation.`);
}

function withDryRun(commandKey, options, request) {
  requireConfirm(commandKey, options);
  if (options.dryRun === true) {
    return {
      dry_run: true,
      command: commandKey,
      request: redact(request),
    };
  }
  return null;
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      search.set(key, String(value));
    }
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

function chatSearchTextFields(message) {
  const fields = [];
  for (const value of [message?.content, message?.text, message?.tool_summary]) {
    if (typeof value === "string" && value.trim()) fields.push(value);
  }
  return [...new Set(fields)];
}

function messageMatchesChatSearch(message, queryLower) {
  return chatSearchTextFields(message).some((value) =>
    value.toLowerCase().includes(queryLower)
  );
}

async function searchCurrentSessionChatMessages({ options, env, fetchFn }) {
  const sessionId = requireSessionId(options, env);
  const agentId = requireAgentId(options, env);
  const searchQuery = requireOption(options, "query", "query", "q");
  const queryLower = searchQuery.toLowerCase();
  const resultLimit = positiveIntegerOption(
    options,
    CHAT_SEARCH_DEFAULT_LIMIT,
    CHAT_SEARCH_MAX_LIMIT,
    "limit",
    "limit"
  );
  const matches = [];
  let afterSeq = 0;
  let latestSeq = null;
  let scannedMessages = 0;
  let scannedPages = 0;
  let hostReportedHasMore = true;
  let resultLimitReached = false;

  while (
    scannedPages < CHAT_SEARCH_MAX_PAGES &&
    hostReportedHasMore &&
    !resultLimitReached
  ) {
    const response = await apiRequest({
      method: "GET",
      path: `/session/messages${query({
        session_id: sessionId,
        agent_id: agentId,
        limit: CHAT_SEARCH_PAGE_LIMIT,
        after_seq: afterSeq,
      })}`,
      options,
      env,
      fetchFn,
    });
    scannedPages += 1;
    const body = response.data;
    const pageMessages = Array.isArray(body?.messages) ? body.messages : [];
    for (const message of pageMessages) {
      scannedMessages += 1;
      if (!messageMatchesChatSearch(message, queryLower)) continue;
      matches.push(message);
      if (matches.length >= resultLimit) {
        resultLimitReached = true;
        break;
      }
    }

    const sync = body?.sync && typeof body.sync === "object" ? body.sync : {};
    const nextAfterSeq = Number(sync.next_after_seq);
    const nextLatestSeq = Number(sync.latest_seq);
    if (Number.isSafeInteger(nextLatestSeq) && nextLatestSeq >= 0) {
      latestSeq = nextLatestSeq;
    }
    hostReportedHasMore = sync.has_more === true;
    if (
      !hostReportedHasMore ||
      pageMessages.length === 0 ||
      !Number.isSafeInteger(nextAfterSeq) ||
      nextAfterSeq <= afterSeq
    ) {
      hostReportedHasMore = false;
      break;
    }
    afterSeq = nextAfterSeq;
  }

  const boundedScanExhausted =
    hostReportedHasMore &&
    scannedPages >= CHAT_SEARCH_MAX_PAGES &&
    !resultLimitReached;

  return {
    status: "chat_search_results",
    session_id: sessionId,
    agent_id: agentId,
    query: searchQuery,
    limit: resultLimit,
    count: matches.length,
    messages: matches,
    matches,
    committed_transcript_truth: "matrix_room_timeline",
    matrix_product_transcript_truth: true,
    host_db_transcript_product_truth: false,
    legacy_transcript_search_used: false,
    legacy_transcript_search_endpoint_used: false,
    cross_session_search: false,
    search_surface: "session_messages_matrix_current_session",
    search_scan: {
      endpoint: "/session/messages",
      page_limit: CHAT_SEARCH_PAGE_LIMIT,
      max_pages: CHAT_SEARCH_MAX_PAGES,
      scanned_pages: scannedPages,
      scanned_messages: scannedMessages,
      next_after_seq: afterSeq,
      latest_seq: latestSeq,
      result_limit_reached: resultLimitReached,
      bounded_scan_exhausted: boundedScanExhausted,
      scan_complete: !hostReportedHasMore && !boundedScanExhausted,
    },
  };
}

function chatMessageIdentityValues(message) {
  if (!message || typeof message !== "object") return [];
  return [
    message.matrix_event_id,
    message.message_id,
    message.event_id,
    message.id,
    message.matrix_event_id_hash,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
}

function chatMessageMatchesContextTarget(message, targetId) {
  return chatMessageIdentityValues(message).includes(targetId);
}

async function readCurrentSessionMessagesAround({ options, env, fetchFn }) {
  const sessionId = requireSessionId(options, env);
  const agentId = requireAgentId(options, env);
  const targetId = requireOption(
    options,
    "event id",
    "eventId",
    "matrixEventId",
    "messageId",
    "id"
  );
  const beforeLimit = nonNegativeIntegerOption(
    options,
    CHAT_MESSAGES_AROUND_DEFAULT_RADIUS,
    CHAT_MESSAGES_AROUND_MAX_RADIUS,
    "before",
    "before"
  );
  const afterLimit = nonNegativeIntegerOption(
    options,
    CHAT_MESSAGES_AROUND_DEFAULT_RADIUS,
    CHAT_MESSAGES_AROUND_MAX_RADIUS,
    "after",
    "after"
  );
  const messages = [];
  let afterSeq = 0;
  let latestSeq = null;
  let scannedPages = 0;
  let scannedMessages = 0;
  let hostReportedHasMore = true;
  let targetIndex = -1;

  while (
    scannedPages < CHAT_MESSAGES_AROUND_MAX_PAGES &&
    hostReportedHasMore
  ) {
    const response = await apiRequest({
      method: "GET",
      path: `/session/messages${query({
        session_id: sessionId,
        agent_id: agentId,
        limit: CHAT_MESSAGES_AROUND_PAGE_LIMIT,
        after_seq: afterSeq,
      })}`,
      options,
      env,
      fetchFn,
    });
    scannedPages += 1;
    const body = response.data;
    const pageMessages = Array.isArray(body?.messages) ? body.messages : [];
    for (const message of pageMessages) {
      messages.push(message);
      scannedMessages += 1;
      if (
        targetIndex < 0 &&
        chatMessageMatchesContextTarget(message, targetId)
      ) {
        targetIndex = messages.length - 1;
      }
    }

    const sync = body?.sync && typeof body.sync === "object" ? body.sync : {};
    const nextAfterSeq = Number(sync.next_after_seq);
    const nextLatestSeq = Number(sync.latest_seq);
    if (Number.isSafeInteger(nextLatestSeq) && nextLatestSeq >= 0) {
      latestSeq = nextLatestSeq;
    }
    hostReportedHasMore = sync.has_more === true;
    const canAdvance =
      pageMessages.length > 0 &&
      Number.isSafeInteger(nextAfterSeq) &&
      nextAfterSeq > afterSeq;
    if (canAdvance) afterSeq = nextAfterSeq;
    if (targetIndex >= 0 && messages.length - targetIndex - 1 >= afterLimit) {
      hostReportedHasMore = false;
      break;
    }
    if (
      !hostReportedHasMore ||
      !canAdvance
    ) {
      hostReportedHasMore = false;
      break;
    }
  }

  const targetMessage = targetIndex >= 0 ? messages[targetIndex] : null;
  const beforeStart = targetIndex >= 0 ? Math.max(0, targetIndex - beforeLimit) : 0;
  const afterEnd =
    targetIndex >= 0
      ? Math.min(messages.length, targetIndex + 1 + afterLimit)
      : 0;
  const messagesBefore =
    targetIndex >= 0 ? messages.slice(beforeStart, targetIndex) : [];
  const messagesAfter =
    targetIndex >= 0 ? messages.slice(targetIndex + 1, afterEnd) : [];
  const boundedScanExhausted =
    targetIndex < 0 &&
    hostReportedHasMore &&
    scannedPages >= CHAT_MESSAGES_AROUND_MAX_PAGES;

  return {
    status: targetMessage
      ? "chat_messages_around"
      : "chat_messages_around_not_found",
    session_id: sessionId,
    agent_id: agentId,
    target_event_id: targetId,
    target_found: Boolean(targetMessage),
    before: beforeLimit,
    after: afterLimit,
    target_message: targetMessage,
    messages_before: messagesBefore,
    messages_after: messagesAfter,
    messages: targetMessage
      ? [...messagesBefore, targetMessage, ...messagesAfter]
      : [],
    committed_transcript_truth: "matrix_room_timeline",
    matrix_product_transcript_truth: true,
    host_db_transcript_product_truth: false,
    legacy_transcript_search_used: false,
    legacy_transcript_search_endpoint_used: false,
    cross_session_search: false,
    context_surface: "session_messages_matrix_current_session",
    context_scan: {
      endpoint: "/session/messages",
      page_limit: CHAT_MESSAGES_AROUND_PAGE_LIMIT,
      max_pages: CHAT_MESSAGES_AROUND_MAX_PAGES,
      scanned_pages: scannedPages,
      scanned_messages: scannedMessages,
      next_after_seq: afterSeq,
      latest_seq: latestSeq,
      bounded_scan_exhausted: boundedScanExhausted,
      target_identity_fields: targetMessage
        ? chatMessageIdentityValues(targetMessage)
        : [],
      returned_before: messagesBefore.length,
      returned_after: messagesAfter.length,
      window_complete_before: targetIndex >= 0 && targetIndex - beforeLimit >= 0,
      window_complete_after:
        targetIndex >= 0 && messages.length - targetIndex - 1 >= afterLimit,
    },
  };
}

function readTextInput(options, env = process.env) {
  return (
    optionalOption(options, "text", "body") ||
    normalizeString(env.OYSTERUN_CLI_TEXT)
  );
}

function boolPayload(options, sourceKey, targetKey, payload) {
  if (Object.prototype.hasOwnProperty.call(options, sourceKey)) {
    payload[targetKey] = parseBooleanOption(options, sourceKey);
  }
}

function sessionStartPayload(options) {
  const body = {
    agent_id: requireOption(options, "agent id", "agentId", "agent"),
  };
  const folder = optionalOption(options, "agentFolder", "folder");
  if (folder) body.agent_folder = folder;
  for (const [optionKey, fieldName] of [
    ["sessionName", "session_name"],
    ["provider", "provider"],
    ["model", "model"],
    ["reasoningEffort", "reasoning_effort"],
    ["permissionMode", "permission_mode"],
    ["approvalPolicy", "approval_policy"],
    ["sandboxMode", "sandbox_mode"],
    ["webAccess", "web_access"],
  ]) {
    const value = optionalOption(options, optionKey);
    if (value) body[fieldName] = value;
  }
  boolPayload(options, "notificationsEnabled", "notifications_enabled", body);
  boolPayload(
    options,
    "confirmBetaProviderPermissionMode",
    "confirm_beta_provider_permission_mode",
    body
  );
  boolPayload(options, "telegramEnabled", "telegram_enabled", body);
  boolPayload(options, "telegramSendToolMessages", "telegram_send_tool_messages", body);
  const telegramBotToken = optionalOption(options, "telegramBotToken");
  if (telegramBotToken) body.telegram_bot_token = telegramBotToken;
  const allowedUsers = optionalOption(options, "telegramAllowedUsers");
  if (allowedUsers) {
    body.telegram_allowed_users =
      allowedUsers === "." ? ["."] : allowedUsers.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return body;
}

async function runAuth({ action, options, env, fetchFn, stdout }) {
  const profileName = resolveProfileName(options);
  const { path: profilePath, store } = readProfiles(env);
  if (action === "login") {
    const target = resolveTarget({ options, env });
    const username =
      optionalOption(options, "username", "user") ||
      normalizeString(env.OYSTERUN_DASHBOARD_USERNAME);
    const password =
      optionalOption(options, "password") ||
      normalizeString(env.OYSTERUN_DASHBOARD_PASSWORD);
    const bootstrapToken =
      optionalOption(options, "bootstrapToken") ||
      normalizeString(env.OYSTERUN_DASHBOARD_BOOTSTRAP_TOKEN);
    if (!bootstrapToken && (!username || !password)) {
      fail("auth login requires --username/--password or --bootstrap-token");
    }
    const body = bootstrapToken ? { bootstrap_token: bootstrapToken } : { username, password };
    const response = await fetchFn(`${target.origin}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readResponse(response);
    if (!response.ok || !normalizeString(data.token)) {
      fail(`auth login failed (${response.status}): ${data.error || "missing token"}`);
    }
    store.contract = P86_CLI_PROFILE_CONTRACT;
    store.default_profile = profileName;
    store.profiles[profileName] = {
      origin: target.origin,
      token: data.token,
      updated_at: new Date().toISOString(),
      token_storage: "cli_profile_0600_fallback",
    };
    writeProfiles(profilePath, store);
    return {
      status: "auth_login_saved",
      profile: profileName,
      origin: target.origin,
      token_redacted: true,
      token_storage: "cli_profile_0600_fallback",
    };
  }
  if (action === "status") {
    const result = await apiRequest({
      method: "GET",
      path: "/auth/status",
      options,
      env,
      fetchFn,
      allowRuntimeCapability: false,
    });
    return {
      status: "auth_status",
      profile: profileName,
      origin: result.target.origin,
      authenticated: result.data.authenticated === true,
      user_id: result.data.user_id || null,
      token_redacted: true,
    };
  }
  if (action === "logout") {
    const target = resolveTarget({ options, env });
    const token = resolveAuthToken({ options, env, target });
    if (token) {
      await apiRequest({
        method: "POST",
        path: "/auth/logout",
        options,
        env,
        fetchFn,
        allowRuntimeCapability: false,
      });
    }
    if (store.profiles[profileName]) {
      delete store.profiles[profileName].token;
      store.profiles[profileName].updated_at = new Date().toISOString();
      writeProfiles(profilePath, store);
    }
    return {
      status: "auth_logged_out",
      profile: profileName,
      origin: target.origin,
    };
  }
  fail(`unknown auth action: ${action}`);
}

async function runSessions({ action, rest, options, env, fetchFn }) {
  if (action === "list") {
    return (await apiRequest({ method: "GET", path: "/sessions", options, env, fetchFn })).data;
  }
  if (action === "start") {
    return (await apiRequest({
      method: "POST",
      path: "/session/start",
      body: sessionStartPayload(options),
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "status") {
    const sessionId = requireSessionId(options, env);
    return (await apiRequest({
      method: "GET",
      path: `/session/status${query({ session_id: sessionId })}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "url") {
    const target = resolveTarget({ options, env });
    const sessionId = requireSessionId(options, env);
    return {
      status: "session_url",
      session_id: sessionId,
      target_url: `${target.origin}/app/sessions/${encodeURIComponent(sessionId)}/chat`,
    };
  }
  if (action === "rename") {
    return (await apiRequest({
      method: "POST",
      path: "/session/rename",
      body: {
        session_id: requireOption(options, "session id", "sessionId"),
        session_name: requireOption(options, "session name", "sessionName", "name"),
      },
      options,
      env,
      fetchFn,
    })).data;
  }
  for (const dangerous of ["stop", "interrupt", "restart"]) {
    if (action === dangerous) {
      const body = { session_id: requireOption(options, "session id", "sessionId") };
      boolPayload(
        options,
        "confirmBetaProviderPermissionMode",
        "confirm_beta_provider_permission_mode",
        body
      );
      const dry = withDryRun(`sessions ${dangerous}`, options, {
        method: "POST",
        path: `/session/${dangerous}`,
        body,
      });
      if (dry) return dry;
      return (await apiRequest({
        method: "POST",
        path: `/session/${dangerous}`,
        body,
        options,
        env,
        fetchFn,
      })).data;
    }
  }
  if (action === "resume" || action === "branch-resume") {
    const body = {
      session_id: optionalOption(options, "sessionId") || optionalOption(options, "sourceSessionId"),
      source_session_id: optionalOption(options, "sourceSessionId") || optionalOption(options, "sessionId"),
      agent_id: requireOption(options, "agent id", "agentId", "agent"),
    };
    const folder = optionalOption(options, "agentFolder", "folder");
    if (folder) body.agent_folder = folder;
    const name = optionalOption(options, "sessionName");
    if (name) body.session_name = name;
    boolPayload(
      options,
      "confirmBetaProviderPermissionMode",
      "confirm_beta_provider_permission_mode",
      body
    );
    return (await apiRequest({
      method: "POST",
      path: action === "branch-resume" ? "/sessions/resume" : "/session/resume",
      body,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "telegram") {
    const telegramAction = rest[0] || "";
    return runSessionTelegram({ action: telegramAction, options, env, fetchFn });
  }
  fail(`unknown sessions action: ${action}`);
}

async function runSessionTelegram({ action, options, env, fetchFn }) {
  const sessionId = requireSessionId(options, env);
  const preferRuntimeCapability = shouldPreferCurrentSessionRuntimeCapability(options, env);
  if (action === "get") {
    const status = (await apiRequest({
      method: "GET",
      path: `/session/status${query({ session_id: sessionId })}`,
      options,
      env,
      fetchFn,
      preferRuntimeCapability,
    })).data;
    return {
      status: "session_telegram",
      session_id: sessionId,
      telegram: status.telegram || {},
      telegram_runtime: status.telegram_runtime || {},
    };
  }
  if (!["enable", "disable", "update"].includes(action)) {
    fail(`unknown sessions telegram action: ${action}`);
  }
  const body = { session_id: sessionId };
  if (action === "enable") body.telegram_enabled = true;
  if (action === "disable") body.telegram_enabled = false;
  if (action === "update") {
    boolPayload(options, "telegramEnabled", "telegram_enabled", body);
    boolPayload(options, "telegramSendToolMessages", "telegram_send_tool_messages", body);
    const token = optionalOption(options, "telegramBotToken");
    if (token) body.telegram_bot_token = token;
    const allowed = optionalOption(options, "telegramAllowedUsers");
    if (allowed) {
      body.telegram_allowed_users =
        allowed === "." ? ["."] : allowed.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
  }
  return (await apiRequest({
    method: "PATCH",
    path: "/session/profile-config",
    body,
    options,
    env,
    fetchFn,
    preferRuntimeCapability,
  })).data;
}

async function runChat({ action, rest, options, env, fetchFn }) {
  if (action === "send") {
    return (await apiRequest({
      method: "POST",
      path: "/session/send",
      body: {
        session_id: requireSessionId(options, env),
        text: requireOption(options, "text", "text"),
        nickname: optionalOption(options, "nickname") || "Owner",
      },
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "recent") {
    return (await apiRequest({
      method: "GET",
      path: `/session/history${query({
        session_id: requireSessionId(options, env),
      })}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "messages") {
    return (await apiRequest({
      method: "GET",
      path: `/session/messages${query({
        session_id: requireSessionId(options, env),
        agent_id: requireAgentId(options, env),
        limit: optionalOption(options, "limit"),
        after_seq: optionalOption(options, "afterSeq"),
      })}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "messages-around") {
    return readCurrentSessionMessagesAround({ options, env, fetchFn });
  }
  if (action === "search") {
    return searchCurrentSessionChatMessages({ options, env, fetchFn });
  }
  if (action === "loop") {
    const loopAction = rest[0] || "";
    return runLoop({ action: loopAction, options, env, fetchFn });
  }
  fail(`unknown chat action: ${action}`);
}

async function runLoop({ action, options, env, fetchFn }) {
  if (action === "list") {
    return (await apiRequest({
      method: "GET",
      path: `/session/loops${query({
        session_id: requireSessionId(options, env),
      })}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "create") {
    return (await apiRequest({
      method: "POST",
      path: "/session/loops",
      body: {
        session_id: requireSessionId(options, env),
        interval: requireOption(options, "interval", "interval"),
        command_text: requireOption(options, "text", "text", "prompt"),
        start_at: optionalOption(options, "startAt") || null,
        end_at: optionalOption(options, "endAt") || null,
        enabled: parseBooleanOption(options, "enabled", true) !== false,
      },
      options,
      env,
      fetchFn,
    })).data;
  }
  if (["update", "enable", "disable", "delete"].includes(action)) {
    const scheduleId = requireOption(options, "loop id", "loopId", "scheduleId", "id");
    const body = {
      session_id: requireSessionId(options, env),
    };
    if (action === "enable") body.enabled = true;
    if (action === "disable") body.enabled = false;
    if (action === "update") {
      const interval = optionalOption(options, "interval");
      const text = optionalOption(options, "text", "prompt");
      if (interval) body.interval = interval;
      if (text) body.command_text = text;
      boolPayload(options, "enabled", "enabled", body);
    }
    const dry = withDryRun(`chat loop ${action}`, options, {
      method: action === "delete" ? "DELETE" : "PATCH",
      path: `/session/loops/${encodeURIComponent(scheduleId)}`,
      body,
    });
    if (dry) return dry;
    return (await apiRequest({
      method: action === "delete" ? "DELETE" : "PATCH",
      path: `/session/loops/${encodeURIComponent(scheduleId)}`,
      body,
      options,
      env,
      fetchFn,
    })).data;
  }
  fail(`unknown chat loop action: ${action}`);
}

function schedulerPayload(options) {
  const body = {};
  for (const [optionKey, fieldName] of [
    ["agentId", "agent_id"],
    ["agentFolder", "agent_folder"],
    ["name", "name"],
    ["prompt", "prompt"],
    ["text", "prompt"],
    ["interval", "interval"],
    ["startAt", "start_at"],
    ["endAt", "end_at"],
    ["provider", "provider"],
    ["model", "model"],
  ]) {
    const value = optionalOption(options, optionKey);
    if (value) body[fieldName] = value;
  }
  boolPayload(options, "enabled", "enabled", body);
  return body;
}

async function runScheduler({ action, options, env, fetchFn }) {
  if (action === "list") {
    return (await apiRequest({ method: "GET", path: "/scheduler/schedules", options, env, fetchFn })).data;
  }
  if (action === "create") {
    return (await apiRequest({
      method: "POST",
      path: "/scheduler/schedules",
      body: schedulerPayload(options),
      options,
      env,
      fetchFn,
    })).data;
  }
  const scheduleId = optionalOption(options, "scheduleId", "id");
  if (!scheduleId) fail("schedule id is required");
  if (action === "get") {
    return (await apiRequest({
      method: "GET",
      path: `/scheduler/schedules/${encodeURIComponent(scheduleId)}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (["update", "enable", "disable", "delete"].includes(action)) {
    const body = schedulerPayload(options);
    if (action === "enable") body.enabled = true;
    if (action === "disable") body.enabled = false;
    const dry = withDryRun(`scheduler ${action}`, options, {
      method: action === "delete" ? "DELETE" : "PATCH",
      path: `/scheduler/schedules/${encodeURIComponent(scheduleId)}`,
      body,
    });
    if (dry) return dry;
    return (await apiRequest({
      method: action === "delete" ? "DELETE" : "PATCH",
      path: `/scheduler/schedules/${encodeURIComponent(scheduleId)}`,
      body,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "test-run") {
    return (await apiRequest({
      method: "POST",
      path: `/scheduler/schedules/${encodeURIComponent(scheduleId)}/test-run`,
      body: {},
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "runs") {
    return (await apiRequest({
      method: "GET",
      path: `/scheduler/schedules/${encodeURIComponent(scheduleId)}/runs${query({
        limit: optionalOption(options, "limit"),
      })}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "run-log") {
    const runId = requireOption(options, "run id", "runId");
    return (await apiRequest({
      method: "GET",
      path: `/scheduler/schedules/${encodeURIComponent(scheduleId)}/runs/${encodeURIComponent(runId)}/log`,
      options,
      env,
      fetchFn,
    })).data;
  }
  fail(`unknown scheduler action: ${action}`);
}

function mailPayload(options, env) {
  return {
    title: optionalOption(options, "title"),
    summary: optionalOption(options, "summary"),
    body_markdown: readTextInput(options, env),
    body_format: optionalOption(options, "bodyFormat") || "markdown",
    source_type: optionalOption(options, "sourceType") || "cli",
    source_name: optionalOption(options, "sourceName") || "Oysterun CLI",
    source_ref: optionalOption(options, "sourceRef"),
    agent_id: optionalOption(options, "agentId", "agent"),
    session_id: optionalOption(options, "sessionId"),
    site_url: optionalOption(options, "siteUrl", "url"),
    severity: optionalOption(options, "severity"),
    idempotency_key: optionalOption(options, "idempotencyKey"),
  };
}

async function runMail({ action, options, env, fetchFn }) {
  if (action === "send") {
    const body = mailPayload(options, env);
    if (!body.title) fail("title is required");
    if (!body.body_markdown) fail("body/text is required");
    return (await apiRequest({ method: "POST", path: "/mail/send", body, options, env, fetchFn })).data;
  }
  if (action === "unread-count") {
    return (await apiRequest({ method: "GET", path: "/mail/unread-count", options, env, fetchFn })).data;
  }
  if (action === "list") {
    return (await apiRequest({
      method: "GET",
      path: `/mail/items${query({ filter: optionalOption(options, "filter"), limit: optionalOption(options, "limit") })}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  const mailId = optionalOption(options, "mailId", "id");
  if (!mailId) fail("mail id is required");
  if (action === "get") {
    return (await apiRequest({ method: "GET", path: `/mail/items/${encodeURIComponent(mailId)}`, options, env, fetchFn })).data;
  }
  if (["read", "unread", "archive", "unarchive"].includes(action)) {
    return (await apiRequest({ method: "POST", path: `/mail/items/${encodeURIComponent(mailId)}/${action}`, body: {}, options, env, fetchFn })).data;
  }
  if (action === "update") {
    return (await apiRequest({ method: "PATCH", path: `/mail/items/${encodeURIComponent(mailId)}`, body: mailPayload(options, env), options, env, fetchFn })).data;
  }
  if (action === "delete") {
    const dry = withDryRun("mail delete", options, { method: "DELETE", path: `/mail/items/${mailId}` });
    if (dry) return dry;
    return (await apiRequest({ method: "DELETE", path: `/mail/items/${encodeURIComponent(mailId)}`, options, env, fetchFn })).data;
  }
  fail(`unknown mail action: ${action}`);
}

async function runNotifications({ action, options, env, fetchFn }) {
  if (action === "status") {
    return (await apiRequest({ method: "GET", path: "/notifications/status", options, env, fetchFn })).data;
  }
  if (action === "send") {
    const body = {
      title: optionalOption(options, "title") || "Oysterun",
      body: readTextInput(options, env),
      url: optionalOption(options, "url") || "/app",
      dry_run: options.dryRun === true,
    };
    if (!body.body) fail("body/text is required");
    return (await apiRequest({ method: "POST", path: "/notifications/send", body, options, env, fetchFn })).data;
  }
  fail(`unknown notifications action: ${action}`);
}

async function runWebsite({ action, rest, options, env, fetchFn }) {
  if (action === "status" || action === "url") {
    return (await apiRequest({
      method: "GET",
      path: `/website/status${query({ agent_id: requireAgentId(options, env) })}`,
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "validate") {
    return (await apiRequest({
      method: "POST",
      path: "/website/validate",
      body: {
        agent_id: requireAgentId(options, env),
        agent_folder: optionalOption(options, "agentFolder", "folder"),
      },
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "init") {
    return (await apiRequest({
      method: "POST",
      path: "/website/init",
      body: {
        agent_id: requireAgentId(options, env),
        agent_folder: optionalOption(options, "agentFolder", "folder"),
        access: optionalOption(options, "access") || "owner_only",
        dry_run: options.dryRun === true,
      },
      options,
      env,
      fetchFn,
    })).data;
  }
  if (action === "access") {
    const accessAction = rest[0] || "";
    if (accessAction === "get") {
      return (await apiRequest({
        method: "GET",
        path: `/website/access${query({ agent_id: requireAgentId(options, env) })}`,
        options,
        env,
        fetchFn,
      })).data;
    }
    if (accessAction === "set") {
      const body = {
        agent_id: requireAgentId(options, env),
        agent_folder: optionalOption(options, "agentFolder", "folder"),
        access: requireOption(options, "access", "access"),
        dry_run: options.dryRun === true,
      };
      const dry = withDryRun("website access set", options, { method: "PATCH", path: "/website/access", body });
      if (dry) return dry;
      return (await apiRequest({ method: "PATCH", path: "/website/access", body, options, env, fetchFn })).data;
    }
  }
  if (action === "password" && rest[0] === "set") {
    const body = {
      agent_id: requireAgentId(options, env),
      agent_folder: optionalOption(options, "agentFolder", "folder"),
      web_password: requireOption(options, "password", "password"),
      dry_run: options.dryRun === true,
    };
    const dry = withDryRun("website password set", options, { method: "POST", path: "/website/password", body });
    if (dry) return dry;
    return (await apiRequest({ method: "POST", path: "/website/password", body, options, env, fetchFn })).data;
  }
  fail(`unknown website action: ${action} ${rest.join(" ")}`.trim());
}

async function runTelegram({ action, options, env, fetchFn }) {
  if (action !== "status") fail(`unknown telegram action: ${action}`);
  if (shouldPreferCurrentSessionRuntimeCapability(options, env)) {
    return runSessionTelegram({ action: "get", options, env, fetchFn });
  }
  return (await apiRequest({ method: "GET", path: "/telegram/status", options, env, fetchFn })).data;
}

export async function dispatchProductCommand({ module, action, rest, options, env, fetchFn }) {
  switch (module) {
    case "auth":
      return await runAuth({ action, options, env, fetchFn });
    case "sessions":
      return await runSessions({ action, rest, options, env, fetchFn });
    case "chat":
      return await runChat({ action, rest, options, env, fetchFn });
    case "scheduler":
      return await runScheduler({ action, options, env, fetchFn });
    case "mail":
      return await runMail({ action, options, env, fetchFn });
    case "notifications":
      return await runNotifications({ action, options, env, fetchFn });
    case "website":
      return await runWebsite({ action, rest, options, env, fetchFn });
    case "telegram":
      return await runTelegram({ action, options, env, fetchFn });
    default:
      fail(`unknown module: ${module}`);
  }
}

export async function runProductCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchFn = fetch,
} = {}) {
  const { positionals, options } = parseCliArgv(argv);
  const module = positionals[0] || "";
  const action = positionals[1] || "";
  const rest = positionals.slice(2);
  const command = [module, action, ...rest].filter(Boolean).join(" ");
  try {
    if (!PRODUCT_CLI_MODULES.has(module)) {
      fail(`unknown command: ${module || "(empty)"}`);
    }
    if (!action) fail(`${module} action is required`);
    const result = await dispatchProductCommand({
      module,
      action,
      rest,
      options,
      env,
      fetchFn,
    });
    writeOutput({ stdout, options, command, result });
    return 0;
  } catch (err) {
    writeError({ stderr, options, command, error: err });
    return err.exitCode || 1;
  }
}
