import { existsSync, readFileSync, statSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { getConfigDir } from "./config.mjs";

const APNS_LOCAL_CONFIG_FILE = "apns.local.json";
const APNS_ENVIRONMENTS = new Map([
  ["sandbox", "sandbox"],
  ["development", "sandbox"],
  ["dev", "sandbox"],
  ["production", "production"],
  ["prod", "production"],
]);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeEnvironment(value) {
  const normalized = normalizeString(value).toLowerCase();
  return APNS_ENVIRONMENTS.get(normalized) || "";
}

function resolveKeyPath(configDir, keyPath) {
  const normalized = normalizeString(keyPath);
  if (!normalized) return "";
  return isAbsolute(normalized) ? normalized : resolve(configDir, normalized);
}

function redactedKeyId(keyId) {
  const normalized = normalizeString(keyId);
  if (normalized.length <= 4) return normalized ? "****" : "";
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}

export function getApnsLocalConfigPath(configDir = getConfigDir()) {
  return join(configDir, APNS_LOCAL_CONFIG_FILE);
}

export function readApnsLocalConfig(configDir = getConfigDir()) {
  const configPath = getApnsLocalConfigPath(configDir);
  if (!existsSync(configPath)) {
    return {
      enabled: false,
      configured: false,
      configPath,
      error: null,
    };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    return {
      enabled: false,
      configured: true,
      configPath,
      error: `invalid APNs local config: ${err.message}`,
    };
  }

  const enabled = raw?.enabled === true;
  const environment = normalizeEnvironment(raw?.environment);
  const teamId = normalizeString(raw?.team_id);
  const keyId = normalizeString(raw?.key_id);
  const topic = normalizeString(raw?.topic);
  const keyPath = resolveKeyPath(configDir, raw?.key_path);

  const missing = [];
  if (enabled && !environment) missing.push("environment");
  if (enabled && !teamId) missing.push("team_id");
  if (enabled && !keyId) missing.push("key_id");
  if (enabled && !topic) missing.push("topic");
  if (enabled && !keyPath) missing.push("key_path");
  if (enabled && keyPath) {
    const stat = statSync(keyPath, { throwIfNoEntry: false });
    if (!stat?.isFile()) missing.push("key_path_file");
  }

  return {
    enabled: enabled && missing.length === 0,
    requestedEnabled: enabled,
    configured: true,
    configPath,
    environment,
    teamId,
    keyId,
    topic,
    keyPath,
    missing,
    error: missing.length ? `missing APNs config fields: ${missing.join(", ")}` : null,
  };
}
export function requireEnabledApnsLocalConfig(configDir = getConfigDir()) {
  const config = readApnsLocalConfig(configDir);
  if (!config.enabled) {
    throw new Error(config.error || "APNs local config is not enabled");
  }
  return config;
}

export function serializeApnsLocalConfigStatus(config = readApnsLocalConfig()) {
  return {
    enabled: config.enabled === true,
    configured: config.configured === true,
    requested_enabled: config.requestedEnabled === true,
    environment: config.environment || null,
    team_id: config.teamId || null,
    key_id: config.keyId ? redactedKeyId(config.keyId) : null,
    topic: config.topic || null,
    key_configured: Boolean(config.keyPath),
    key_file_present:
      Boolean(config.keyPath) &&
      statSync(config.keyPath, { throwIfNoEntry: false })?.isFile() === true,
    config_path: config.configPath,
    missing: Array.isArray(config.missing) ? config.missing : [],
    error: config.error || null,
  };
}
