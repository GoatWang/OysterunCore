import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getConfigDir } from "./config.mjs";
import { writeAtomicJsonFile } from "./atomic-file.mjs";

const STORE_VERSION = 1;
const DEVICE_STORE_FILE = "apns.devices.json";
const TOKEN_SUFFIX_LENGTH = 8;

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function redactApnsToken(token) {
  const normalized = normalizeString(token);
  if (!normalized) return "";
  if (normalized.length <= TOKEN_SUFFIX_LENGTH) return `...${normalized}`;
  return `...${normalized.slice(-TOKEN_SUFFIX_LENGTH)}`;
}

export function getApnsDeviceStorePath(configDir = getConfigDir()) {
  return join(configDir, DEVICE_STORE_FILE);
}

function apnsDeviceFreshnessMs(device) {
  const updatedAt = Date.parse(device?.updated_at || "");
  if (Number.isFinite(updatedAt)) return updatedAt;
  const registeredAt = Date.parse(device?.registered_at || "");
  return Number.isFinite(registeredAt) ? registeredAt : 0;
}

export function dedupeApnsDevicesByToken(devices) {
  if (!Array.isArray(devices)) return [];
  const byToken = new Map();
  for (const device of devices) {
    const token = normalizeString(device?.token);
    if (!token) throw new Error("APNs device token required");
    const topic = normalizeString(device.topic);
    const environment = normalizeString(device.environment);
    const key = `${topic}\n${environment}\n${token}`;
    const previous = byToken.get(key);
    if (!previous || apnsDeviceFreshnessMs(device) >= apnsDeviceFreshnessMs(previous)) {
      byToken.set(key, device);
    }
  }
  return Array.from(byToken.values());
}

function normalizeStoreDocument(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: STORE_VERSION, devices: [] };
  }
  const devices = Array.isArray(raw.devices)
    ? raw.devices.filter((device) => device && typeof device === "object")
    : [];
  return { version: STORE_VERSION, devices };
}

export class ApnsDeviceStore {
  constructor({ configDir = getConfigDir(), storePath = null } = {}) {
    this.configDir = configDir;
    this.storePath = storePath || getApnsDeviceStorePath(configDir);
  }

  read() {
    if (!existsSync(this.storePath)) {
      return { version: STORE_VERSION, devices: [] };
    }
    return normalizeStoreDocument(JSON.parse(readFileSync(this.storePath, "utf-8")));
  }

  write(store) {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeAtomicJsonFile(this.storePath, normalizeStoreDocument(store));
  }

  upsertDevice({
    userId,
    installationId,
    token,
    topic,
    environment,
    platform = "ios",
    deviceName = null,
    appVersion = null,
  }) {
    const normalizedUserId = normalizeString(userId);
    const normalizedInstallationId = normalizeString(installationId);
    const normalizedToken = normalizeString(token);
    const normalizedTopic = normalizeString(topic);
    const normalizedEnvironment = normalizeString(environment);
    if (!normalizedUserId) throw new Error("user_id required");
    if (!normalizedInstallationId) throw new Error("installation_id required");
    if (!normalizedToken) throw new Error("APNs token required");
    if (!normalizedTopic) throw new Error("APNs topic required");
    if (!normalizedEnvironment) throw new Error("APNs environment required");

    const store = this.read();
    const timestamp = nowIso();
    const existing = store.devices.find(
      (device) =>
        device.user_id === normalizedUserId &&
        device.installation_id === normalizedInstallationId
    );
    const nextDevice = {
      installation_id: normalizedInstallationId,
      user_id: normalizedUserId,
      platform,
      token: normalizedToken,
      token_suffix: redactApnsToken(normalizedToken),
      topic: normalizedTopic,
      environment: normalizedEnvironment,
      device_name: normalizeString(deviceName) || null,
      app_version: normalizeString(appVersion) || null,
      registered_at: existing?.registered_at || timestamp,
      updated_at: timestamp,
      last_push_at: existing?.last_push_at || null,
      last_error_code: null,
      disabled_at: null,
    };

    if (existing) {
      Object.assign(existing, nextDevice);
    } else {
      store.devices.push(nextDevice);
    }
    this.write(store);
    return nextDevice;
  }

  unregisterDevice({ userId, installationId }) {
    const normalizedUserId = normalizeString(userId);
    const normalizedInstallationId = normalizeString(installationId);
    if (!normalizedUserId) throw new Error("user_id required");
    if (!normalizedInstallationId) throw new Error("installation_id required");
    const store = this.read();
    const before = store.devices.length;
    store.devices = store.devices.filter(
      (device) =>
        !(
          device.user_id === normalizedUserId &&
          device.installation_id === normalizedInstallationId
        )
    );
    this.write(store);
    return { removed: before - store.devices.length };
  }

  listDevices({ userId = null, topic = null, environment = null, includeDisabled = false } = {}) {
    const normalizedUserId = normalizeString(userId);
    const normalizedTopic = normalizeString(topic);
    const normalizedEnvironment = normalizeString(environment);
    return this.read().devices.filter((device) => {
      if (!includeDisabled && device.disabled_at) return false;
      if (normalizedUserId && device.user_id !== normalizedUserId) return false;
      if (normalizedTopic && device.topic !== normalizedTopic) return false;
      if (normalizedEnvironment && device.environment !== normalizedEnvironment) return false;
      return true;
    });
  }

  markPushResult({ installationId, userId, ok, errorCode = null }) {
    const store = this.read();
    const timestamp = nowIso();
    const device = store.devices.find(
      (entry) => entry.installation_id === installationId && entry.user_id === userId
    );
    if (!device) return null;
    if (ok) {
      device.last_push_at = timestamp;
      device.last_error_code = null;
    } else {
      device.last_error_code = normalizeString(errorCode) || "apns_error";
      if (["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(device.last_error_code)) {
        device.disabled_at = timestamp;
      }
    }
    this.write(store);
    return device;
  }
}

export function serializeApnsDevice(device) {
  return {
    installation_id: device.installation_id,
    user_id: device.user_id,
    platform: device.platform,
    token_suffix: device.token_suffix || redactApnsToken(device.token),
    topic: device.topic,
    environment: device.environment,
    device_name: device.device_name || null,
    app_version: device.app_version || null,
    registered_at: device.registered_at || null,
    updated_at: device.updated_at || null,
    last_push_at: device.last_push_at || null,
    last_error_code: device.last_error_code || null,
    disabled_at: device.disabled_at || null,
  };
}
