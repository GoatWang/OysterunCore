import { createRequire } from "module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { getConfigDir, readConfig } from "./config.mjs";

const require = createRequire(import.meta.url);
const hostServicePackage = require("./package.json");

export const HOST_TELEMETRY_EVENT_NAME = "host_daily_telemetry_report";
export const HOST_TELEMETRY_SCHEMA_VERSION = 1;
export const HOST_TELEMETRY_RETENTION_DAYS = 30;
export const HOST_TELEMETRY_DEFAULT_POSTHOG_API_HOST =
  "https://us.i.posthog.com";
export const HOST_TELEMETRY_DEFAULT_POSTHOG_PROJECT_TOKEN =
  "phc_2c404JOxNanNDgJNdagtfwqc95BNVTIJVQLsMB75uh5";

export const HOST_TELEMETRY_COUNTER_KEYS = Object.freeze([
  "session_started_count",
  "session_resumed_count",
  "session_branch_resumed_count",
  "session_restarted_count",
  "session_stopped_count",
  "session_interrupted_count",
  "user_message_sent_count",
  "provider_turn_completed_count",
  "provider_auth_required_count",
  "provider_start_failed_count",
  "approval_request_count",
  "approval_accepted_count",
  "approval_rejected_count",
  "tool_call_count",
  "tool_result_count",
  "large_tool_output_count",
  "scheduler_schedule_created_count",
  "scheduler_schedule_updated_count",
  "scheduler_schedule_deleted_count",
  "scheduler_run_count",
  "scheduler_run_success_count",
  "scheduler_run_failed_count",
  "notification_send_requested_count",
  "notification_send_cloud_accepted_count",
  "notification_send_failed_count",
  "notification_bootstrap_created_count",
  "mail_created_count",
  "mail_read_count",
  "mail_archived_count",
  "mail_deleted_count",
  "website_init_count",
  "website_access_changed_count",
  "website_password_set_count",
  "terminal_opened_count",
  "terminal_input_sent_count",
  "file_explorer_opened_count",
  "file_preview_count",
  "html_preview_count",
  "folder_created_count",
  "demo_agent_created_count",
]);

export const HOST_TELEMETRY_FEATURE_KEYS = Object.freeze([
  "sessions",
  "session_setup",
  "chat",
  "file_explorer",
  "file_preview",
  "html_preview",
  "mail",
  "scheduler",
  "terminal",
  "host_preferences",
  "agent_profile",
  "browser_site",
  "website_settings",
  "telegram_settings",
  "notifications_settings",
  "tool_detail",
]);

const COUNTER_KEY_SET = new Set(HOST_TELEMETRY_COUNTER_KEYS);
const FEATURE_KEY_SET = new Set(HOST_TELEMETRY_FEATURE_KEYS);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function localDateString(date = new Date()) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 10);
}

function emptyCounters() {
  return Object.fromEntries(
    HOST_TELEMETRY_COUNTER_KEYS.map((key) => [key, 0])
  );
}

function emptyFeatureUsage() {
  return Object.fromEntries(
    HOST_TELEMETRY_FEATURE_KEYS.map((key) => [key, 0])
  );
}

function createEmptyStore() {
  return {
    schema_version: HOST_TELEMETRY_SCHEMA_VERSION,
    buckets: {},
  };
}

export function getHostTelemetryStorePath() {
  return (
    normalizeString(process.env.OYSTERUN_HOST_TELEMETRY_STORE_PATH) ||
    join(getConfigDir(), "telemetry", "daily-usage.json")
  );
}

function readStore() {
  const storePath = getHostTelemetryStorePath();
  if (!existsSync(storePath)) return createEmptyStore();
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return createEmptyStore();
    }
    const buckets =
      parsed.buckets && typeof parsed.buckets === "object"
        ? parsed.buckets
        : {};
    return {
      schema_version: HOST_TELEMETRY_SCHEMA_VERSION,
      buckets,
    };
  } catch {
    return createEmptyStore();
  }
}

function writeStore(store) {
  const storePath = getHostTelemetryStorePath();
  mkdirSync(dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  renameSync(tempPath, storePath);
}

function normalizeBucket(raw = {}) {
  return {
    counters: {
      ...emptyCounters(),
      ...(raw.counters && typeof raw.counters === "object"
        ? Object.fromEntries(
            Object.entries(raw.counters).filter(([key, value]) => {
              return COUNTER_KEY_SET.has(key) && Number.isFinite(Number(value));
            }).map(([key, value]) => [key, Math.max(0, Math.floor(Number(value)))])
          )
        : {}),
    },
    feature_usage: {
      ...emptyFeatureUsage(),
      ...(raw.feature_usage && typeof raw.feature_usage === "object"
        ? Object.fromEntries(
            Object.entries(raw.feature_usage).filter(([key, value]) => {
              return FEATURE_KEY_SET.has(key) && Number.isFinite(Number(value));
            }).map(([key, value]) => [key, Math.max(0, Math.floor(Number(value)))])
          )
        : {}),
    },
    sent_at: normalizeString(raw.sent_at),
    send_attempted_at: normalizeString(raw.send_attempted_at),
    send_error: normalizeString(raw.send_error),
    updated_at: normalizeString(raw.updated_at),
  };
}

function ensureBucket(store, date) {
  store.buckets[date] = normalizeBucket(store.buckets[date]);
  return store.buckets[date];
}

function pruneStore(store, keepDate) {
  const dates = Object.keys(store.buckets || {}).sort();
  const keep = new Set(dates.slice(-HOST_TELEMETRY_RETENTION_DAYS));
  keep.add(keepDate);
  for (const date of dates) {
    if (!keep.has(date)) {
      delete store.buckets[date];
    }
  }
}

function telemetryEnabled(config = readConfig()) {
  return config.daily_telemetry_enabled === true;
}

function safeWarn(logger, message) {
  try {
    logger?.warn?.(message);
  } catch {
    // best effort only
  }
}

function handleUnknownTelemetryKey(kind, key, logger) {
  const message = `[host-telemetry] unknown ${kind} ignored: ${key}`;
  if (
    process.env.OYSTERUN_HOST_TELEMETRY_STRICT === "1" ||
    process.env.NODE_ENV === "test"
  ) {
    throw new Error(message);
  }
  safeWarn(logger, message);
  return false;
}

export function recordHostTelemetryCounter(
  key,
  amount = 1,
  { now = new Date(), logger = console } = {}
) {
  if (!COUNTER_KEY_SET.has(key)) {
    return handleUnknownTelemetryKey("counter", key, logger);
  }
  let config;
  try {
    config = readConfig();
  } catch (err) {
    safeWarn(logger, `[host-telemetry] config read failed: ${err.message}`);
    return false;
  }
  if (!telemetryEnabled(config)) return false;
  const increment = Math.max(1, Math.floor(Number(amount) || 1));
  try {
    const date = localDateString(now);
    const store = readStore();
    const bucket = ensureBucket(store, date);
    bucket.counters[key] += increment;
    bucket.updated_at = now.toISOString();
    pruneStore(store, date);
    writeStore(store);
    return true;
  } catch (err) {
    safeWarn(logger, `[host-telemetry] counter write failed: ${err.message}`);
    return false;
  }
}

export function recordHostTelemetryFeature(
  key,
  { now = new Date(), logger = console } = {}
) {
  if (!FEATURE_KEY_SET.has(key)) {
    return handleUnknownTelemetryKey("feature", key, logger);
  }
  let config;
  try {
    config = readConfig();
  } catch (err) {
    safeWarn(logger, `[host-telemetry] config read failed: ${err.message}`);
    return false;
  }
  if (!telemetryEnabled(config)) return false;
  try {
    const date = localDateString(now);
    const store = readStore();
    const bucket = ensureBucket(store, date);
    bucket.feature_usage[key] += 1;
    bucket.updated_at = now.toISOString();
    pruneStore(store, date);
    writeStore(store);
    return true;
  } catch (err) {
    safeWarn(logger, `[host-telemetry] feature write failed: ${err.message}`);
    return false;
  }
}

export function buildHostDailyTelemetryPayload({
  date = localDateString(),
  config = readConfig(),
  store = readStore(),
} = {}) {
  const hostId = normalizeString(config.host_id);
  if (config.daily_telemetry_enabled !== true || !hostId) return null;
  const bucket = normalizeBucket(store.buckets?.[date]);
  return {
    schema_version: HOST_TELEMETRY_SCHEMA_VERSION,
    host_id: hostId,
    date,
    app_version: hostServicePackage.version || null,
    host_os: process.platform,
    host_arch: process.arch,
    node_major: Number.parseInt(process.versions.node.split(".")[0], 10),
    host_active_today: true,
    ...emptyCounters(),
    ...bucket.counters,
    feature_usage: {
      ...emptyFeatureUsage(),
      ...bucket.feature_usage,
    },
  };
}

function resolvePostHogConfig() {
  return {
    apiHost:
      normalizeString(process.env.OYSTERUN_HOST_POSTHOG_API_HOST) ||
      HOST_TELEMETRY_DEFAULT_POSTHOG_API_HOST,
    projectToken:
      normalizeString(process.env.OYSTERUN_HOST_POSTHOG_PROJECT_TOKEN) ||
      HOST_TELEMETRY_DEFAULT_POSTHOG_PROJECT_TOKEN,
  };
}

export function getHostTelemetryStatus({
  now = new Date(),
  config = readConfig(),
} = {}) {
  const date = localDateString(now);
  const store = readStore();
  const bucket = normalizeBucket(store.buckets?.[date]);
  return {
    enabled: config.daily_telemetry_enabled === true,
    host_id_present: Boolean(normalizeString(config.host_id)),
    current_date: date,
    store_path: getHostTelemetryStorePath(),
    last_sent_at: bucket.sent_at || null,
    send_attempted_at: bucket.send_attempted_at || null,
    send_error: bucket.send_error || null,
  };
}

export async function sendHostDailyTelemetry({
  now = new Date(),
  fetchImpl = globalThis.fetch,
  logger = console,
  force = false,
} = {}) {
  const config = readConfig();
  if (config.daily_telemetry_enabled !== true) {
    return { sent: false, reason: "disabled" };
  }
  if (!normalizeString(config.host_id)) {
    return { sent: false, reason: "missing_host_id" };
  }
  if (typeof fetchImpl !== "function") {
    return { sent: false, reason: "fetch_unavailable" };
  }

  const date = localDateString(now);
  const store = readStore();
  const bucket = ensureBucket(store, date);
  if (bucket.sent_at && !force) {
    return { sent: false, reason: "already_sent", sent_at: bucket.sent_at };
  }
  const payload = buildHostDailyTelemetryPayload({ date, config, store });
  if (!payload) {
    return { sent: false, reason: "payload_unavailable" };
  }
  const { apiHost, projectToken } = resolvePostHogConfig();
  const captureUrl = `${apiHost.replace(/\/+$/, "")}/capture/`;
  bucket.send_attempted_at = now.toISOString();
  bucket.send_error = null;
  writeStore(store);

  let response;
  try {
    response = await fetchImpl(captureUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: projectToken,
        event: HOST_TELEMETRY_EVENT_NAME,
        distinct_id: payload.host_id,
        properties: {
          ...payload,
          $lib: "oysterun-host",
        },
      }),
    });
  } catch (err) {
    bucket.send_error = err.message || "posthog_fetch_failed";
    writeStore(store);
    safeWarn(logger, `[host-telemetry] send failed: ${bucket.send_error}`);
    return { sent: false, reason: "send_failed", error: bucket.send_error };
  }

  if (!response.ok) {
    bucket.send_error = `posthog_http_${response.status}`;
    writeStore(store);
    safeWarn(logger, `[host-telemetry] send failed: ${bucket.send_error}`);
    return { sent: false, reason: "send_failed", error: bucket.send_error };
  }

  bucket.sent_at = now.toISOString();
  bucket.send_error = null;
  writeStore(store);
  return { sent: true, event: HOST_TELEMETRY_EVENT_NAME, date };
}

let schedulerHandle = null;

export function startHostTelemetryScheduler({ logger = console } = {}) {
  if (schedulerHandle) return schedulerHandle;
  const run = () => {
    sendHostDailyTelemetry({ logger }).catch((err) => {
      safeWarn(logger, `[host-telemetry] scheduled send failed: ${err.message}`);
    });
  };
  const startupTimer = setTimeout(run, 15000);
  if (typeof startupTimer.unref === "function") startupTimer.unref();
  const interval = setInterval(run, 60 * 60 * 1000);
  if (typeof interval.unref === "function") interval.unref();
  schedulerHandle = {
    stop() {
      clearTimeout(startupTimer);
      clearInterval(interval);
      schedulerHandle = null;
    },
  };
  return schedulerHandle;
}
