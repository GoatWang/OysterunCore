import { randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

export const HOST_RESTART_RESTORE_STATE_FILE = "restart-restore-state.json";
export const HOST_RESTART_RESTORE_STATE_SCHEMA =
  "oysterun_host_restart_restore_state";
export const HOST_RESTART_RESTORE_STATE_VERSION = 1;
export const HOST_RESTART_RESTORE_STORAGE_OWNER =
  "host_config_dir_restart_restore_state_json";
export const HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY =
  "never_replay_prompts_or_terminal_commands";
export const HOST_RESTART_RESTORE_DASHBOARD_AUTH_POLICY =
  "reauthentication_safe_after_process_restart";

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|dashboard_password_hash)/i;
const MAX_STRING_LENGTH = 4096;

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function nowIso(clock = () => new Date()) {
  const value = clock();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactRestartSnapshotValue(value, key = "") {
  if (SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (Array.isArray(value)) {
    return value.map((entry) => redactRestartSnapshotValue(entry, key));
  }
  if (isObjectRecord(value)) {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactRestartSnapshotValue(childValue, childKey);
    }
    return out;
  }
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}...`;
  }
  return value;
}

function readJsonFile(file) {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function writeJsonFileAtomic(file, payload) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

export function getHostRestartRestoreStatePath(configDir) {
  const normalizedConfigDir = normalizeString(configDir);
  if (!normalizedConfigDir) {
    throw new Error("configDir is required for Host restart restore state");
  }
  return join(normalizedConfigDir, HOST_RESTART_RESTORE_STATE_FILE);
}

export function readHostRestartRestoreState({ configDir }) {
  return readJsonFile(getHostRestartRestoreStatePath(configDir));
}

export function validateConsumableHostRestartRestoreState({
  transaction,
  stackName = null,
}) {
  if (!transaction) {
    return { status: "not_found", valid: false, transaction: null };
  }
  if (transaction.schema !== HOST_RESTART_RESTORE_STATE_SCHEMA) {
    return { status: "ignored_schema_mismatch", valid: false, transaction };
  }
  if (transaction.version !== HOST_RESTART_RESTORE_STATE_VERSION) {
    return { status: "ignored_version_mismatch", valid: false, transaction };
  }
  if (transaction.state !== "prepared") {
    return { status: "already_consumed", valid: false, transaction };
  }
  const expectedStack = normalizeString(stackName);
  if (expectedStack && transaction.stack_name !== expectedStack) {
    return { status: "ignored_stack_mismatch", valid: false, transaction };
  }
  return { status: "prepared", valid: true, transaction };
}

export function buildHostRestartRestoreSummary(transaction = null) {
  if (!isObjectRecord(transaction)) {
    return {
      status: "not_prepared",
      available: false,
      storage_owner: HOST_RESTART_RESTORE_STORAGE_OWNER,
    };
  }
  const snapshot = isObjectRecord(transaction.runtime_snapshot)
    ? transaction.runtime_snapshot
    : {};
  return {
    status: transaction.state || "unknown",
    available: transaction.state === "prepared",
    schema: transaction.schema || null,
    version: transaction.version || null,
    restart_id: transaction.restart_id || null,
    trigger: transaction.trigger || null,
    stack_name: transaction.stack_name || null,
    created_at: transaction.created_at || null,
    consumed_at: transaction.consumed_at || null,
    storage_owner: transaction.storage_owner || HOST_RESTART_RESTORE_STORAGE_OWNER,
    prompt_replay_policy:
      transaction.prompt_replay_policy ||
      HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY,
    dashboard_auth_policy:
      transaction.dashboard_auth_policy ||
      HOST_RESTART_RESTORE_DASHBOARD_AUTH_POLICY,
    operation_log_path: transaction.operation_log?.path || null,
    counts: {
      sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions.length : 0,
      loops: Array.isArray(snapshot.loops?.runtime_sessions)
        ? snapshot.loops.runtime_sessions.length
        : 0,
      scheduler_active_runs: Array.isArray(snapshot.scheduler?.active_runs)
        ? snapshot.scheduler.active_runs.length
        : 0,
      terminal_sessions: Array.isArray(snapshot.terminal?.sessions)
        ? snapshot.terminal.sessions.length
        : 0,
      shell_execs: Array.isArray(snapshot.shell_execs)
        ? snapshot.shell_execs.length
        : 0,
    },
  };
}

export function prepareHostRestartRestoreState({
  configDir,
  stackName,
  trigger,
  runtimeSnapshot,
  operationLogPath = null,
  clock = () => new Date(),
}) {
  const normalizedStackName = normalizeString(stackName);
  if (!normalizedStackName) {
    throw new Error("stackName is required for Host restart restore prepare");
  }
  const normalizedTrigger = normalizeString(trigger) || "host_restart";
  const createdAt = nowIso(clock);
  const transaction = {
    schema: HOST_RESTART_RESTORE_STATE_SCHEMA,
    version: HOST_RESTART_RESTORE_STATE_VERSION,
    state: "prepared",
    restart_id: randomUUID(),
    trigger: normalizedTrigger,
    stack_name: normalizedStackName,
    host_config_dir: normalizeString(configDir),
    storage_owner: HOST_RESTART_RESTORE_STORAGE_OWNER,
    prompt_replay_policy: HOST_RESTART_RESTORE_NO_PROMPT_REPLAY_POLICY,
    dashboard_auth_policy: HOST_RESTART_RESTORE_DASHBOARD_AUTH_POLICY,
    created_at: createdAt,
    consumed_at: null,
    runtime_snapshot: redactRestartSnapshotValue(runtimeSnapshot || {}),
    operation_log: {
      path: normalizeString(operationLogPath),
      created_at: createdAt,
      message:
        "Prepared planned Host restart restore transaction; prompts and terminal commands will not be replayed.",
    },
  };
  writeJsonFileAtomic(getHostRestartRestoreStatePath(configDir), transaction);
  return transaction;
}

export function consumeHostRestartRestoreState({
  configDir,
  stackName,
  restoreResult = null,
  clock = () => new Date(),
}) {
  const transaction = readHostRestartRestoreState({ configDir });
  const validation = validateConsumableHostRestartRestoreState({
    transaction,
    stackName,
  });
  if (!validation.valid) {
    return { status: validation.status, transaction: validation.transaction };
  }
  const consumedAt = nowIso(clock);
  const consumed = {
    ...transaction,
    state: "consumed",
    consumed_at: consumedAt,
    restore_result: redactRestartSnapshotValue(restoreResult || {}),
  };
  writeJsonFileAtomic(getHostRestartRestoreStatePath(configDir), consumed);
  return { status: "consumed", transaction: consumed };
}
