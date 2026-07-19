import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const HOST_RESTART_LOGIN_GATE_FILENAME = "restart-login-gate.json";
export const HOST_RESTART_LOGIN_GATE_SCHEMA =
  "oysterun_host_restart_login_gate";
export const HOST_RESTART_LOGIN_GATE_VERSION = 1;

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function requireConfigDir(configDir) {
  const normalized = normalizeString(configDir);
  if (!normalized) {
    throw new Error("configDir is required for Host restart login gate");
  }
  return normalized;
}

function nowIso(clock = () => new Date()) {
  const value = clock();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function writeJsonAtomic(file, payload) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

function validateGate(gate) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    throw new Error("Host restart login gate must be a JSON object");
  }
  if (gate.schema !== HOST_RESTART_LOGIN_GATE_SCHEMA) {
    throw new Error("Host restart login gate schema is unsupported");
  }
  if (gate.version !== HOST_RESTART_LOGIN_GATE_VERSION) {
    throw new Error("Host restart login gate version is unsupported");
  }
  if (gate.state !== "blocked" && gate.state !== "released") {
    throw new Error("Host restart login gate state is invalid");
  }
  if (!normalizeString(gate.gate_id)) {
    throw new Error("Host restart login gate id is required");
  }
  return gate;
}

export function getHostRestartLoginGatePath(configDir) {
  return join(
    requireConfigDir(configDir),
    HOST_RESTART_LOGIN_GATE_FILENAME
  );
}

export function readHostRestartLoginGate({ configDir }) {
  const file = getHostRestartLoginGatePath(configDir);
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) {
    throw new Error("Host restart login gate file is empty");
  }
  return validateGate(JSON.parse(raw));
}

export function activateHostRestartLoginGate({
  configDir,
  restartId = null,
  operationId = null,
  mode,
  handoffStartedAt,
  executeNotBefore,
  clock = () => new Date(),
}) {
  const normalizedMode = normalizeString(mode);
  if (!normalizedMode) {
    throw new Error("Host restart login gate mode is required");
  }
  const normalizedDeadline = normalizeString(executeNotBefore);
  if (!normalizedDeadline || !Number.isFinite(Date.parse(normalizedDeadline))) {
    throw new Error(
      "Host restart login gate execute_not_before must be a valid ISO timestamp"
    );
  }
  const gate = {
    schema: HOST_RESTART_LOGIN_GATE_SCHEMA,
    version: HOST_RESTART_LOGIN_GATE_VERSION,
    state: "blocked",
    gate_id: randomUUID(),
    restart_id: normalizeString(restartId),
    operation_id: normalizeString(operationId),
    mode: normalizedMode,
    created_at: nowIso(clock),
    handoff_started_at: normalizeString(handoffStartedAt),
    execute_not_before: normalizedDeadline,
    released_at: null,
    release_reason: null,
  };
  writeJsonAtomic(getHostRestartLoginGatePath(configDir), gate);
  return gate;
}

export function releaseHostRestartLoginGate({
  configDir,
  gateId = null,
  restartId = null,
  reason,
  clock = () => new Date(),
}) {
  const gate = readHostRestartLoginGate({ configDir });
  if (!gate || gate.state === "released") {
    return {
      released: false,
      reason: gate ? "already_released" : "not_found",
      gate,
    };
  }
  const expectedGateId = normalizeString(gateId);
  if (expectedGateId && gate.gate_id !== expectedGateId) {
    return { released: false, reason: "gate_id_mismatch", gate };
  }
  const expectedRestartId = normalizeString(restartId);
  if (expectedRestartId && gate.restart_id !== expectedRestartId) {
    return { released: false, reason: "restart_id_mismatch", gate };
  }
  const releaseReason = normalizeString(reason);
  if (!releaseReason) {
    throw new Error("Host restart login gate release reason is required");
  }
  const released = {
    ...gate,
    state: "released",
    released_at: nowIso(clock),
    release_reason: releaseReason,
  };
  writeJsonAtomic(getHostRestartLoginGatePath(configDir), released);
  return { released: true, reason: releaseReason, gate: released };
}

export function buildHostRestartLoginGateStatus({ configDir }) {
  const gate = readHostRestartLoginGate({ configDir });
  const blocked = gate?.state === "blocked";
  return {
    status: blocked ? "restart_in_progress" : "ready",
    login_blocked: blocked,
    code: blocked ? "host_restart_in_progress" : null,
    gate_id: gate?.gate_id || null,
    restart_id: gate?.restart_id || null,
    mode: gate?.mode || null,
    handoff_started_at: gate?.handoff_started_at || null,
    execute_not_before: gate?.execute_not_before || null,
    released_at: gate?.released_at || null,
    release_reason: gate?.release_reason || null,
    retry_after_seconds: blocked ? 1 : 0,
    secret_material_exposed: false,
  };
}
