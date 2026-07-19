import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import {
  getConfigDir,
  getProviderModelCatalogSeed,
} from "./config.mjs";

export const PROVIDER_MODEL_PARAMS_VERSION = 1;
export const PROVIDER_MODEL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const CLAUDE_REASONING_EFFORT_OPTIONS = Object.freeze([
  "auto",
  "low",
  "medium",
  "high",
  "max",
]);
const CODEX_MAX_REASONING_EFFORT_OPTIONS = Object.freeze([
  "low",
  "medium",
  "high",
  "max",
]);
const CODEX_SAFE_REASONING_EFFORT_OPTIONS = Object.freeze([
  "low",
  "medium",
  "high",
]);
const REASONING_EFFORT_ALIASES = Object.freeze({
  auto: "auto",
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
  xhigh: "max",
});

const FORBIDDEN_PARAM_KEYS = new Set([
  "agent_config",
  "agent_registry",
  "apns_default_environment",
  "apns_default_topic",
  "apns_device_token",
  "apns_key_id",
  "apns_key_path",
  "apns_team_id",
  "auth",
  "auth_token",
  "capability_grants",
  "chat_messages",
  "chat_sessions",
  "cloud_private_key",
  "cloud_public_key",
  "codex_command",
  "command",
  "command_path",
  "command_paths",
  "configured_command",
  "dashboard_credentials",
  "dashboard_password",
  "dashboard_password_hash",
  "dashboard_user",
  "device_id",
  "device_signing_kid",
  "device_signing_public_key",
  "device_token",
  "mail",
  "matrix",
  "private_key",
  "resolved_command",
  "scheduler",
  "session_history",
  "transcript_db",
  "transcript_rows",
  "verification_artifacts",
]);
const FORBIDDEN_PARAM_KEY_COMPACTS = new Set(
  [...FORBIDDEN_PARAM_KEYS].map((key) => key.replace(/_/g, ""))
);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeParamKey(key) {
  return String(key)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

function isForbiddenParamKey(key) {
  const normalized = normalizeParamKey(key);
  const compact = normalized.replace(/_/g, "");
  if (normalized === "command_available" || compact === "commandavailable")
    return false;
  if (
    normalized === "configured_command_source" ||
    compact === "configuredcommandsource"
  )
    return false;
  if (
    FORBIDDEN_PARAM_KEYS.has(normalized) ||
    FORBIDDEN_PARAM_KEY_COMPACTS.has(compact)
  )
    return true;
  if (normalized.startsWith("apns_") || compact.startsWith("apns")) return true;
  if (normalized.startsWith("dashboard_") || compact.startsWith("dashboard"))
    return true;
  if (normalized.endsWith("_token") || compact.endsWith("token")) return true;
  if (normalized.endsWith("_secret") || compact.endsWith("secret")) return true;
  if (normalized.endsWith("_credentials") || compact.endsWith("credentials"))
    return true;
  if (normalized.endsWith("_private_key") || compact.endsWith("privatekey"))
    return true;
  if (normalized.endsWith("_command_path") || compact.endsWith("commandpath"))
    return true;
  if (normalized.endsWith("_command") || compact.endsWith("command"))
    return true;
  return false;
}

export function findForbiddenProviderModelParamsPaths(value, path = []) {
  if (!value || typeof value !== "object") return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (isForbiddenParamKey(key)) {
      found.push(nextPath.join("."));
      continue;
    }
    if (child && typeof child === "object") {
      found.push(...findForbiddenProviderModelParamsPaths(child, nextPath));
    }
  }
  return found;
}

export function getProviderModelParamsPath(configDir = getConfigDir()) {
  return join(configDir, "params.json");
}

function readRawParamsFile(paramsPath) {
  if (!existsSync(paramsPath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(paramsPath, "utf-8"));
  } catch (err) {
    throw new Error(`Invalid provider model params JSON in ${paramsPath}: ${err.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid provider model params root object in ${paramsPath}`);
  }
  return parsed;
}

function normalizeProviderReasoningEffortValue(providerId, value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const aliased = REASONING_EFFORT_ALIASES[normalized.toLowerCase()] || null;
  if (!aliased) return null;
  if (providerId === "codex" && aliased === "auto") return null;
  return aliased;
}

function defaultReasoningEffortOptions(providerId, entry = {}) {
  if (providerId === "claude") return [...CLAUDE_REASONING_EFFORT_OPTIONS];
  if (providerId !== "codex") return [];
  const explicitDefault = normalizeProviderReasoningEffortValue(
    providerId,
    entry.defaultReasoningEffort || entry.default_reasoning_effort
  );
  return explicitDefault === "max"
    ? [...CODEX_MAX_REASONING_EFFORT_OPTIONS]
    : [...CODEX_SAFE_REASONING_EFFORT_OPTIONS, "max"];
}

function normalizeReasoningEffortOptions(providerId, value, entry = {}) {
  const source = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const item of source) {
    const effort = normalizeProviderReasoningEffortValue(providerId, item);
    if (effort && !normalized.includes(effort)) {
      normalized.push(effort);
    }
  }
  return normalized.length > 0
    ? normalized
    : defaultReasoningEffortOptions(providerId, entry);
}

function normalizeProviderModelEntry(providerId, entry) {
  const source =
    typeof entry === "string"
      ? { id: entry }
      : isPlainObject(entry)
      ? entry
      : null;
  if (!source) {
    throw new Error(`Invalid ${providerId} provider model entry`);
  }
  const id = normalizeString(source.id || source.name || source.model);
  if (!id) {
    throw new Error(`Invalid ${providerId} provider model entry id`);
  }
  const normalizedId = id.toLowerCase();
  const reasoningEffortOptions = normalizeReasoningEffortOptions(
    providerId,
    source.reasoningEffortOptions || source.reasoning_effort_options,
    source
  );
  const defaultReasoningEffort =
    normalizeProviderReasoningEffortValue(
      providerId,
      source.defaultReasoningEffort || source.default_reasoning_effort
    ) ||
    (reasoningEffortOptions.includes("max")
      ? providerId === "claude"
        ? "high"
        : "max"
      : reasoningEffortOptions[0] || null);

  return {
    id: normalizedId,
    label: normalizeString(source.label || source.display_name) || normalizedId,
    reasoningEffortOptions,
    defaultReasoningEffort: reasoningEffortOptions.includes(
      defaultReasoningEffort
    )
      ? defaultReasoningEffort
      : reasoningEffortOptions[0] || null,
    hidden: source.hidden === true,
    isDefault: source.isDefault === true || source.is_default === true,
  };
}

function mergeSeedModels(seedEntries, modelEntries) {
  const byId = new Map();
  const order = [];
  for (const entry of seedEntries) {
    byId.set(entry.id, entry);
    order.push(entry.id);
  }
  for (const entry of modelEntries) {
    if (!byId.has(entry.id)) {
      order.push(entry.id);
    }
    byId.set(entry.id, entry);
  }
  return order.map((id) => byId.get(id));
}

export function normalizeProviderModelCatalog(providerId, entries = []) {
  if (!Array.isArray(entries)) {
    throw new Error(`${providerId} provider model catalog must be an array`);
  }
  const normalized = entries.map((entry) =>
    normalizeProviderModelEntry(providerId, entry)
  );
  if (providerId !== "claude") {
    return normalized;
  }
  const seedEntries = getProviderModelCatalogSeed("claude").map((entry) =>
    normalizeProviderModelEntry("claude", entry)
  );
  return mergeSeedModels(seedEntries, normalized);
}

function normalizeProviderModelsRoot(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    throw new Error("provider_models must be an object");
  }
  return value;
}

function normalizeProviderModelBlock(providerId, value) {
  const source = isPlainObject(value) ? value : {};
  const modelsValue = Object.prototype.hasOwnProperty.call(source, "models")
    ? source.models
    : [];
  const models = normalizeProviderModelCatalog(providerId, modelsValue);
  return {
    ...cloneValue(source),
    source:
      normalizeString(source.source) ||
      (providerId === "claude" ? "host_seed_aliases" : "params_json"),
    models,
  };
}

function normalizeProviderRuntime(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    throw new Error("provider_runtime must be an object");
  }
  return cloneValue(value);
}

function normalizeRefresh(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    throw new Error("refresh must be an object");
  }
  return cloneValue(value);
}

export function normalizeProviderModelParams(raw = {}) {
  if (!isPlainObject(raw)) {
    throw new Error("provider model params must be an object");
  }
  const forbiddenPaths = findForbiddenProviderModelParamsPaths(raw);
  if (forbiddenPaths.length > 0) {
    throw new Error(
      `Forbidden provider model params fields: ${forbiddenPaths.join(", ")}`
    );
  }

  const providerModels = normalizeProviderModelsRoot(raw.provider_models);
  const normalizedProviderModels = {
    ...cloneValue(providerModels),
    claude: normalizeProviderModelBlock("claude", providerModels.claude),
    codex: normalizeProviderModelBlock("codex", providerModels.codex),
  };

  return {
    ...cloneValue(raw),
    version: PROVIDER_MODEL_PARAMS_VERSION,
    provider_models: normalizedProviderModels,
    provider_runtime: normalizeProviderRuntime(raw.provider_runtime),
    refresh: normalizeRefresh(raw.refresh),
  };
}

export function readProviderModelParams(options = {}) {
  const configDir = options.configDir || getConfigDir();
  const paramsPath =
    options.paramsPath || getProviderModelParamsPath(configDir);
  const exists = existsSync(paramsPath);
  const raw = readRawParamsFile(paramsPath);
  return {
    path: paramsPath,
    exists,
    params: normalizeProviderModelParams(raw),
  };
}

function mergeProviderModelParamsPatch(raw, patch) {
  const next = {
    ...cloneValue(raw),
    ...cloneValue(patch),
  };
  if (isPlainObject(raw.provider_models) || isPlainObject(patch.provider_models)) {
    next.provider_models = {
      ...(isPlainObject(raw.provider_models) ? cloneValue(raw.provider_models) : {}),
      ...(isPlainObject(patch.provider_models)
        ? cloneValue(patch.provider_models)
        : {}),
    };
  }
  if (
    isPlainObject(raw.provider_runtime) ||
    isPlainObject(patch.provider_runtime)
  ) {
    next.provider_runtime = {
      ...(isPlainObject(raw.provider_runtime)
        ? cloneValue(raw.provider_runtime)
        : {}),
      ...(isPlainObject(patch.provider_runtime)
        ? cloneValue(patch.provider_runtime)
        : {}),
    };
  }
  if (isPlainObject(raw.refresh) || isPlainObject(patch.refresh)) {
    next.refresh = {
      ...(isPlainObject(raw.refresh) ? cloneValue(raw.refresh) : {}),
      ...(isPlainObject(patch.refresh) ? cloneValue(patch.refresh) : {}),
    };
  }
  return next;
}

export function writeProviderModelParams(patch = {}, options = {}) {
  if (!isPlainObject(patch)) {
    throw new Error("provider model params patch must be an object");
  }
  const configDir = options.configDir || getConfigDir();
  const paramsPath =
    options.paramsPath || getProviderModelParamsPath(configDir);
  const raw = readRawParamsFile(paramsPath);
  const normalized = normalizeProviderModelParams(
    mergeProviderModelParamsPatch(raw, patch)
  );
  mkdirSync(dirname(paramsPath), { recursive: true });
  const tempPath = `${paramsPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
  renameSync(tempPath, paramsPath);
  return {
    path: paramsPath,
    params: normalized,
  };
}

function statusTimestamp(params, providerId) {
  const providerModels = params.provider_models?.[providerId] || {};
  const providerRuntime = params.provider_runtime?.[providerId] || {};
  return (
    normalizeString(providerModels.refreshed_at) ||
    normalizeString(providerModels.last_success_at) ||
    normalizeString(providerRuntime.last_success_at) ||
    normalizeString(providerRuntime.last_attempt_at) ||
    normalizeString(params.refresh?.last_success_at) ||
    null
  );
}

function parseStatusTimestamp(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function nextProviderRefreshAt(params, providerId) {
  const refreshedAtMs = parseStatusTimestamp(statusTimestamp(params, providerId));
  if (!refreshedAtMs) return null;
  return new Date(refreshedAtMs + PROVIDER_MODEL_REFRESH_INTERVAL_MS).toISOString();
}

export function loadProviderModelCatalogState(providerId, options = {}) {
  if (
    providerId === "debug-fixture" ||
    providerId === "debug-large-tool-spillover" ||
    providerId === "debug-routec-structural-replay"
  ) {
    return {
      models: getProviderModelCatalogSeed(providerId),
      status: {
        source:
          providerId === "debug-routec-structural-replay"
            ? "host_debug_routec_structural_replay_seed"
            : providerId === "debug-large-tool-spillover"
            ? "host_debug_large_tool_spillover_seed"
            : "host_debug_fixture_seed",
        params_path: null,
        params_exists: false,
        available: true,
        stale: false,
        error: null,
      },
    };
  }

  try {
    const result = readProviderModelParams(options);
    const providerBlock = result.params.provider_models?.[providerId] || {};
    const providerRuntime = result.params.provider_runtime?.[providerId] || {};
    const models = Array.isArray(providerBlock.models)
      ? providerBlock.models
      : [];
    const paramsMissing = result.exists !== true;
    return {
      models,
      params: result.params,
      status: {
        source:
          providerId === "codex" && paramsMissing
            ? "params_missing"
            : providerBlock.source || "params_json",
        params_path: result.path,
        params_exists: result.exists === true,
        available: models.length > 0,
        stale:
          result.params.provider_runtime?.[providerId]?.probe_status ===
          "error",
        error:
          normalizeString(providerRuntime?.last_error) ||
          null,
        refreshed_at: statusTimestamp(result.params, providerId),
        next_refresh_at:
          nextProviderRefreshAt(result.params, providerId) ||
          normalizeString(result.params.refresh?.next_refresh_at),
        refresh_scheduling_authority: "provider_last_refresh_plus_interval",
        runtime: cloneValue(providerRuntime),
      },
    };
  } catch (err) {
    return {
      models: providerId === "claude" ? normalizeProviderModelCatalog("claude", []) : [],
      status: {
        source: "params_error",
        params_path: options.paramsPath || getProviderModelParamsPath(options.configDir),
        params_exists: true,
        available: providerId === "claude",
        stale: true,
        error: err.message,
      },
    };
  }
}
