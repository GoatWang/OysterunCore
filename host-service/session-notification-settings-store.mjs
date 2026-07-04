import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getConfigDir } from "./config.mjs";
import { writeAtomicJsonFile } from "./atomic-file.mjs";

const STORE_VERSION = 1;
const SESSION_NOTIFICATION_SETTINGS_FILE =
  "session-notification-settings.json";
const COMPATIBILITY_POLICY_SOURCE = "notifications.enabled";

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeEntry(sessionId, entry = {}) {
  const normalizedSessionId = normalizeString(sessionId);
  const notificationsEnabled = entry.notifications_enabled !== false;
  const matrixRoomId = normalizeString(entry.matrix_room_id) || null;
  const updatedAt = normalizeString(entry.updated_at) || null;
  return {
    notifications_enabled: notificationsEnabled,
    matrix_room_id: matrixRoomId,
    updated_at: updatedAt,
  };
}

function normalizeStoreDocument(raw) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rawSettings =
    source.session_notification_settings &&
    typeof source.session_notification_settings === "object" &&
    !Array.isArray(source.session_notification_settings)
      ? source.session_notification_settings
      : {};
  const session_notification_settings = {};
  for (const [sessionId, entry] of Object.entries(rawSettings)) {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) continue;
    session_notification_settings[normalizedSessionId] = normalizeEntry(
      normalizedSessionId,
      entry
    );
  }
  return {
    version: STORE_VERSION,
    session_notification_settings,
  };
}

export function getSessionNotificationSettingsStorePath(
  configDir = getConfigDir()
) {
  return join(configDir, SESSION_NOTIFICATION_SETTINGS_FILE);
}

export function serializeSessionNotificationSetting({
  sessionId,
  matrixRoomId = null,
  entry = null,
  isDefault = false,
}) {
  const normalizedSessionId = normalizeString(sessionId);
  if (!normalizedSessionId) throw new Error("session_id required");
  const normalizedEntry = entry ? normalizeEntry(normalizedSessionId, entry) : null;
  const notifications_enabled =
    normalizedEntry?.notifications_enabled !== false;
  const resolvedMatrixRoomId =
    normalizeString(matrixRoomId) ||
    normalizeString(normalizedEntry?.matrix_room_id) ||
    null;
  return {
    session_id: normalizedSessionId,
    matrix_room_id: resolvedMatrixRoomId,
    matrix_room_bound: Boolean(resolvedMatrixRoomId),
    notifications_enabled,
    per_session_notification_enabled: notifications_enabled,
    is_default: isDefault === true,
    updated_at: normalizedEntry?.updated_at || null,
    storage_owner: "agent_config_notifications_enabled",
    legacy_storage_owner: "host_config_session_notification_settings",
    policy_source: COMPATIBILITY_POLICY_SOURCE,
    compatibility_store_only: true,
    matrix_timeline_owner: false,
    host_transcript_db_owner: false,
    browser_local_storage_owner: false,
  };
}

export class SessionNotificationSettingsStore {
  constructor({ configDir = getConfigDir(), storePath = null } = {}) {
    this.configDir = configDir;
    this.storePath =
      storePath || getSessionNotificationSettingsStorePath(configDir);
  }

  read() {
    if (!existsSync(this.storePath)) {
      return {
        version: STORE_VERSION,
        session_notification_settings: {},
      };
    }
    return normalizeStoreDocument(JSON.parse(readFileSync(this.storePath, "utf8")));
  }

  write(store) {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeAtomicJsonFile(this.storePath, normalizeStoreDocument(store));
  }

  getSetting({ sessionId, matrixRoomId = null }) {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) throw new Error("session_id required");
    const store = this.read();
    const entry = store.session_notification_settings[normalizedSessionId] || null;
    return serializeSessionNotificationSetting({
      sessionId: normalizedSessionId,
      matrixRoomId,
      entry,
      isDefault: !entry,
    });
  }

  setSetting({ sessionId, matrixRoomId = null, notificationsEnabled }) {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) throw new Error("session_id required");
    if (typeof notificationsEnabled !== "boolean") {
      throw new Error("notifications_enabled must be a boolean");
    }
    const store = this.read();
    const previous =
      store.session_notification_settings[normalizedSessionId] || {};
    const nextEntry = {
      notifications_enabled: notificationsEnabled,
      matrix_room_id:
        normalizeString(matrixRoomId) ||
        normalizeString(previous.matrix_room_id) ||
        null,
      updated_at: nowIso(),
    };
    store.session_notification_settings[normalizedSessionId] = nextEntry;
    this.write(store);
    return serializeSessionNotificationSetting({
      sessionId: normalizedSessionId,
      matrixRoomId,
      entry: nextEntry,
      isDefault: false,
    });
  }
}

export function isSessionNotificationEnabled(
  notificationSettingsStore,
  session_id,
  matrix_room_id
) {
  if (!notificationSettingsStore) throw new Error("notification_settings store required");
  const setting = notificationSettingsStore.getSetting({
    sessionId: session_id,
    matrixRoomId: matrix_room_id,
  });
  return setting.per_session_notification_enabled !== false;
}
