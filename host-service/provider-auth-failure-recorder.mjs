import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export const PROVIDER_AUTH_FAILURE_RECORDER_SCHEMA =
  "routec.provider_auth_failure_recorder.v1";

export const PROVIDER_AUTH_FAILURE_RECORDER_ENABLE_ENV =
  "OYSTERUN_PROVIDER_AUTH_FAILURE_RECORDER_ENABLED";

export const PROVIDER_AUTH_FAILURE_SCENARIOS = Object.freeze([
  "not_logged_in",
  "changed_login_account",
]);

export const PROVIDER_AUTH_FAILURE_PROVIDERS = Object.freeze([
  "codex",
  "claude",
]);

const SECRET_KEY_PATTERN =
  /(?:authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|secret|password|credential|credentials|qr|bootstrap|auth[_-]?json|raw[_-]?config)/i;

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|sess|ak|rk|pk|org|user|acct)-[A-Za-z0-9._-]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:refresh|access|id)_token[=:]\s*[^,\s;]+/gi,
  /\b(?:password|secret|credential|cookie|authorization)[=:]\s*[^,\s;]+/gi,
];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScenario(value) {
  const normalized = normalizeString(value);
  if (PROVIDER_AUTH_FAILURE_SCENARIOS.includes(normalized)) return normalized;
  throw new Error(`Unsupported provider auth failure scenario: ${value}`);
}

function normalizeProvider(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (PROVIDER_AUTH_FAILURE_PROVIDERS.includes(normalized)) return normalized;
  throw new Error(`Unsupported provider auth failure provider: ${value}`);
}

export function isProviderAuthFailureRecorderEnabled({
  env = process.env,
  config = null,
  explicit = false,
} = {}) {
  if (explicit === true) return true;
  if (config?.debug_provider_auth_failure_recorder_enabled === true) {
    return true;
  }
  const raw = env?.[PROVIDER_AUTH_FAILURE_RECORDER_ENABLE_ENV];
  return /^(1|true|yes|on)$/i.test(String(raw || "").trim());
}

export function redactProviderAuthFailureValue(value, key = "") {
  if (SECRET_KEY_PATTERN.test(String(key || ""))) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((entry) => redactProviderAuthFailureValue(entry, key));
  }
  if (value && typeof value === "object") {
    const redacted = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redacted[entryKey] = redactProviderAuthFailureValue(
        entryValue,
        entryKey
      );
    }
    return redacted;
  }
  if (typeof value !== "string") return value ?? null;
  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function buildProviderAuthFailureRecord(input = {}) {
  const scenario = normalizeScenario(input.scenario);
  const provider = normalizeProvider(input.provider);
  const timestamp =
    normalizeString(input.timestamp) || new Date().toISOString();
  return {
    schema: PROVIDER_AUTH_FAILURE_RECORDER_SCHEMA,
    timestamp,
    scenario,
    provider,
    host_session_id: normalizeString(input.host_session_id) || null,
    provider_thread_or_session_id:
      normalizeString(input.provider_thread_or_session_id) || null,
    request_or_turn_id: normalizeString(input.request_or_turn_id) || null,
    provider_method_or_event_name:
      normalizeString(input.provider_method_or_event_name) || null,
    completion_state: normalizeString(input.completion_state) || null,
    provider_error_status_fields: redactProviderAuthFailureValue(
      input.provider_error_status_fields || null,
      "provider_error_status_fields"
    ),
    oysterun_mapped_message_type:
      normalizeString(input.oysterun_mapped_message_type) || null,
    visible_chat_row_appeared: input.visible_chat_row_appeared === true,
  };
}

export function writeProviderAuthFailureRecord({
  outputPath,
  record,
  enabled = false,
} = {}) {
  if (!enabled) {
    return {
      written: false,
      reason: "recorder_disabled_default_off",
      output_path: outputPath || null,
    };
  }
  if (!outputPath || typeof outputPath !== "string") {
    throw new Error("provider auth failure recorder requires outputPath");
  }
  const safeRecord =
    record?.schema === PROVIDER_AUTH_FAILURE_RECORDER_SCHEMA
      ? record
      : buildProviderAuthFailureRecord(record || {});
  mkdirSync(dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(safeRecord)}\n`, "utf8");
  return {
    written: true,
    output_path: outputPath,
    schema: PROVIDER_AUTH_FAILURE_RECORDER_SCHEMA,
  };
}
