import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { getConfigDir } from "./config.mjs";

export const UPDATE_NOTICED_VERSION_FILENAME = "update-noticed-version.json";
export const UPDATE_OPERATION_STATE_FILENAME = "update-operation-state.json";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsonObject(path, fallback = {}) {
  if (!existsSync(path)) return { ...fallback };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!isPlainObject(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

export function getUpdateNoticedVersionPath(configDir = getConfigDir()) {
  return join(configDir, UPDATE_NOTICED_VERSION_FILENAME);
}

export function getUpdateOperationStatePath(configDir = getConfigDir()) {
  return join(configDir, UPDATE_OPERATION_STATE_FILENAME);
}

export function readUpdateReminderState({ configDir = getConfigDir() } = {}) {
  const state = readJsonObject(getUpdateNoticedVersionPath(configDir), {});
  return {
    noticed_version: normalizeString(state.noticed_version),
    noticed_at: normalizeString(state.noticed_at),
    noticed_source: normalizeString(state.noticed_source),
    last_automatic_check_at: normalizeString(state.last_automatic_check_at),
    last_automatic_newest_version: normalizeString(
      state.last_automatic_newest_version
    ),
    last_automatic_update_available:
      state.last_automatic_update_available === true,
    last_automatic_failure_at: normalizeString(state.last_automatic_failure_at),
    last_automatic_failure_hidden:
      state.last_automatic_failure_hidden === true,
    last_manual_check_at: normalizeString(state.last_manual_check_at),
    last_manual_newest_version: normalizeString(state.last_manual_newest_version),
    last_manual_update_available: state.last_manual_update_available === true,
  };
}

export function writeUpdateReminderState(
  state,
  { configDir = getConfigDir() } = {}
) {
  const path = getUpdateNoticedVersionPath(configDir);
  const payload = {
    noticed_version: normalizeString(state.noticed_version),
    noticed_at: normalizeString(state.noticed_at),
    noticed_source: normalizeString(state.noticed_source),
    last_automatic_check_at: normalizeString(state.last_automatic_check_at),
    last_automatic_newest_version: normalizeString(
      state.last_automatic_newest_version
    ),
    last_automatic_update_available:
      state.last_automatic_update_available === true,
    last_automatic_failure_at: normalizeString(state.last_automatic_failure_at),
    last_automatic_failure_hidden:
      state.last_automatic_failure_hidden === true,
    last_manual_check_at: normalizeString(state.last_manual_check_at),
    last_manual_newest_version: normalizeString(state.last_manual_newest_version),
    last_manual_update_available: state.last_manual_update_available === true,
    updated_at: new Date().toISOString(),
  };
  writeJsonAtomic(path, payload);
  return payload;
}

export function updateReminderState(
  updater,
  { configDir = getConfigDir() } = {}
) {
  const current = readUpdateReminderState({ configDir });
  const next = updater({ ...current });
  return writeUpdateReminderState(next, { configDir });
}

export function markUpdateVersionNoticed({
  version,
  source,
  noticedAt = new Date().toISOString(),
  configDir = getConfigDir(),
}) {
  const normalizedVersion = normalizeString(version);
  if (!normalizedVersion) {
    throw new Error("noticed update version is required");
  }
  return updateReminderState(
    (state) => ({
      ...state,
      noticed_version: normalizedVersion,
      noticed_at: noticedAt,
      noticed_source: normalizeString(source) || "unknown",
    }),
    { configDir }
  );
}

export function readUpdateOperationState({ configDir = getConfigDir() } = {}) {
  const state = readJsonObject(getUpdateOperationStatePath(configDir), {});
  return {
    operation_id: normalizeString(state.operation_id),
    status: normalizeString(state.status),
    phase: normalizeString(state.phase),
    running: state.running === true,
    requested_at: normalizeString(state.requested_at),
    updated_at: normalizeString(state.updated_at),
    handoff_started_at: normalizeString(state.handoff_started_at),
    execute_not_before: normalizeString(state.execute_not_before),
    handoff_seconds: Number.isInteger(state.handoff_seconds)
      ? state.handoff_seconds
      : null,
    source: normalizeString(state.source),
    channel: normalizeString(state.channel),
    current_version: normalizeString(state.current_version),
    target_version: normalizeString(state.target_version),
    newest_version: normalizeString(state.newest_version),
    registry_source: normalizeString(state.registry_source),
    npm_command_redacted: normalizeString(state.npm_command_redacted),
    restart_id: normalizeString(state.restart_id),
    final_observed_version: normalizeString(state.final_observed_version),
    error: normalizeString(state.error),
    error_redacted: state.error_redacted === true,
  };
}

export function writeUpdateOperationState(
  state,
  { configDir = getConfigDir() } = {}
) {
  const now = new Date().toISOString();
  const payload = {
    operation_id: normalizeString(state.operation_id) || randomUUID(),
    status: normalizeString(state.status) || "unknown",
    phase: normalizeString(state.phase),
    running: state.running === true,
    requested_at: normalizeString(state.requested_at) || now,
    updated_at: now,
    handoff_started_at: normalizeString(state.handoff_started_at),
    execute_not_before: normalizeString(state.execute_not_before),
    handoff_seconds: Number.isInteger(state.handoff_seconds)
      ? state.handoff_seconds
      : null,
    source: normalizeString(state.source),
    channel: normalizeString(state.channel),
    current_version: normalizeString(state.current_version),
    target_version: normalizeString(state.target_version),
    newest_version: normalizeString(state.newest_version),
    registry_source: normalizeString(state.registry_source),
    npm_command_redacted: normalizeString(state.npm_command_redacted),
    restart_id: normalizeString(state.restart_id),
    final_observed_version: normalizeString(state.final_observed_version),
    error: normalizeString(state.error),
    error_redacted: state.error_redacted === true,
  };
  writeJsonAtomic(getUpdateOperationStatePath(configDir), payload);
  return payload;
}

export function updateOperationState(
  updater,
  { configDir = getConfigDir() } = {}
) {
  const current = readUpdateOperationState({ configDir });
  const next = updater({ ...current });
  return writeUpdateOperationState(next, { configDir });
}
