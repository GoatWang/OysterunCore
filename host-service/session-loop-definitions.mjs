import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";

export const SESSION_LOOP_DEFINITIONS_VERSION = 1;
export const SESSION_LOOP_DEFINITION_STORAGE_OWNER =
  "agent_folder_oysterun_loops_json";
export const SESSION_LOOP_RUNTIME_OWNER = "host_session_memory_only";
export const SESSION_LOOP_DEFINITION_KIND = "in_session_loop_definition";
export const SESSION_LOOP_ACTIVE_REASON =
  "P59 in-session Loop runtime state is enabled for this live session";
export const SESSION_LOOP_PAUSED_REASON =
  "P59 in-session Loop runtime state is disabled for this live session";
export const SESSION_LOOP_DUE_DISPATCH_PATH =
  "routec_matrix_loop_execution_event";

const LOOP_DEFINITION_ROOT_KEYS = new Set(["version", "loops"]);
const LOOP_DEFINITION_ALLOWED_KEYS = new Set([
  "id",
  "interval_token",
  "interval_ms",
  "command_text",
  "start_at",
  "end_at",
  "created_at",
  "updated_at",
  "source",
]);
const LOOP_DEFINITION_FORBIDDEN_RUNTIME_KEYS = new Set([
  "enabled",
  "default_enabled",
  "status",
  "next_run_at",
  "last_run_at",
  "last_status",
  "last_error",
  "run_count",
  "dispatch_count",
  "skip_count",
  "skipped_busy_count",
]);

const INTERVAL_UNITS_MS = Object.freeze({
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
});

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashText(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function nowIso(clock = () => new Date()) {
  const value = clock();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function addMilliseconds(isoTimestamp, milliseconds) {
  const time = Date.parse(isoTimestamp);
  if (!Number.isFinite(time)) {
    throw new Error(`Invalid ISO timestamp: ${isoTimestamp}`);
  }
  return new Date(time + milliseconds).toISOString();
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalIsoTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be an ISO timestamp when provided`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return new Date(time).toISOString();
}

export function normalizeSessionLoopCommandText(value) {
  return normalizeRequiredString(value, "loop command text").replace(/\s+/g, " ");
}

export function parseSessionLoopIntervalToken(value) {
  const intervalToken = normalizeRequiredString(value, "loop interval").toLowerCase();
  const match = intervalToken.match(/^([1-9][0-9]*)([smhd])$/);
  if (!match) {
    throw new Error(
      "Loop interval must use a positive integer with unit s, m, h, or d"
    );
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return {
    interval_token: `${amount}${unit}`,
    interval_ms: amount * INTERVAL_UNITS_MS[unit],
  };
}

function normalizeAgentFolder(agentFolder) {
  const folder = normalizeRequiredString(agentFolder, "agent folder");
  const realFolder = realpathSync(folder);
  const stats = statSync(realFolder, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) {
    throw new Error("Loop definitions require a valid agent folder");
  }
  return realFolder;
}

function normalizeLoopDefinition(input, { now = null, existing = null } = {}) {
  if (!isObjectRecord(input)) {
    throw new Error("Loop definition entries must be objects");
  }
  for (const key of Object.keys(input)) {
    if (LOOP_DEFINITION_FORBIDDEN_RUNTIME_KEYS.has(key)) {
      throw new Error(`loops.json must not persist runtime field ${key}`);
    }
    if (!LOOP_DEFINITION_ALLOWED_KEYS.has(key)) {
      throw new Error(`loops.json contains unsupported loop field ${key}`);
    }
  }
  const interval = parseSessionLoopIntervalToken(input.interval_token);
  if (
    input.interval_ms !== undefined &&
    Number(input.interval_ms) !== interval.interval_ms
  ) {
    throw new Error("Loop definition interval_ms must match interval_token");
  }
  const createdAt =
    normalizeOptionalIsoTimestamp(input.created_at, "created_at") ||
    existing?.created_at ||
    now ||
    new Date().toISOString();
  const updatedAt =
    normalizeOptionalIsoTimestamp(input.updated_at, "updated_at") ||
    now ||
    createdAt;
  return {
    id: normalizeRequiredString(input.id || existing?.id, "loop id"),
    interval_token: interval.interval_token,
    interval_ms: interval.interval_ms,
    command_text: normalizeRequiredString(input.command_text, "loop command text"),
    start_at: normalizeOptionalIsoTimestamp(input.start_at, "start_at"),
    end_at: normalizeOptionalIsoTimestamp(input.end_at, "end_at"),
    created_at: createdAt,
    updated_at: updatedAt,
    source: normalizeRequiredString(input.source || existing?.source, "loop source"),
  };
}

function identityKey(definition) {
  return `${definition.interval_ms}:${normalizeSessionLoopCommandText(
    definition.command_text
  )}`;
}

function buildDefinitionId({ intervalMs, commandText }) {
  const digest = hashText(`${intervalMs}:${normalizeSessionLoopCommandText(commandText)}`)
    .slice(0, 16);
  return `loop_${digest}_${randomUUID().slice(0, 8)}`;
}

function serializeDefinitionsPayload(definitions) {
  return `${JSON.stringify(
    {
      version: SESSION_LOOP_DEFINITIONS_VERSION,
      loops: definitions.map((definition) => ({
        id: definition.id,
        interval_token: definition.interval_token,
        interval_ms: definition.interval_ms,
        command_text: definition.command_text,
        start_at: definition.start_at,
        end_at: definition.end_at,
        created_at: definition.created_at,
        updated_at: definition.updated_at,
        source: definition.source,
      })),
    },
    null,
    2
  )}\n`;
}

export class SessionLoopDefinitionStore {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
  }

  resolveLoopsPath(agentFolder) {
    const folder = normalizeAgentFolder(agentFolder);
    const oysterunDir = join(folder, ".oysterun");
    const loopsPath = join(oysterunDir, "loops.json");
    if (resolve(loopsPath) !== loopsPath || !loopsPath.startsWith(`${folder}/`)) {
      throw new Error("Loop definitions path escaped the agent folder");
    }
    return { agentFolder: folder, oysterunDir, loopsPath };
  }

  readDefinitions(agentFolder) {
    const paths = this.resolveLoopsPath(agentFolder);
    if (!existsSync(paths.loopsPath)) {
      return {
        ...paths,
        version: SESSION_LOOP_DEFINITIONS_VERSION,
        loops: [],
        file_exists: false,
      };
    }
    const payload = JSON.parse(readFileSync(paths.loopsPath, "utf-8"));
    if (!isObjectRecord(payload)) {
      throw new Error("loops.json root must be an object");
    }
    for (const key of Object.keys(payload)) {
      if (!LOOP_DEFINITION_ROOT_KEYS.has(key)) {
        throw new Error(`loops.json contains unsupported root field ${key}`);
      }
    }
    if (payload.version !== SESSION_LOOP_DEFINITIONS_VERSION) {
      throw new Error("loops.json version is unsupported");
    }
    if (!Array.isArray(payload.loops)) {
      throw new Error("loops.json loops must be an array");
    }
    const seen = new Set();
    const loops = payload.loops.map((entry) => {
      const definition = normalizeLoopDefinition(entry);
      const key = identityKey(definition);
      if (seen.has(key)) {
        throw new Error("loops.json contains duplicate interval/command definitions");
      }
      seen.add(key);
      return definition;
    });
    return {
      ...paths,
      version: payload.version,
      loops,
      file_exists: true,
    };
  }

  writeDefinitions(agentFolder, definitions) {
    const paths = this.resolveLoopsPath(agentFolder);
    const now = nowIso(this.clock);
    const normalized = definitions.map((entry) =>
      normalizeLoopDefinition(entry, { now, existing: entry })
    );
    const seen = new Set();
    for (const definition of normalized) {
      const key = identityKey(definition);
      if (seen.has(key)) {
        throw new Error("Loop definition duplicate identity is not allowed");
      }
      seen.add(key);
    }
    mkdirSync(paths.oysterunDir, { recursive: true });
    const tempPath = `${paths.loopsPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, serializeDefinitionsPayload(normalized));
    renameSync(tempPath, paths.loopsPath);
    return this.readDefinitions(paths.agentFolder);
  }

  createDefinition({
    agentFolder,
    intervalToken,
    intervalMs = null,
    commandText,
    startAt = null,
    endAt = null,
    source,
  }) {
    const current = this.readDefinitions(agentFolder);
    const interval = parseSessionLoopIntervalToken(intervalToken);
    if (intervalMs !== null && Number(intervalMs) !== interval.interval_ms) {
      throw new Error("Loop interval_ms must match interval token");
    }
    const now = nowIso(this.clock);
    const candidate = normalizeLoopDefinition(
      {
        id: buildDefinitionId({
          intervalMs: interval.interval_ms,
          commandText,
        }),
        interval_token: interval.interval_token,
        interval_ms: interval.interval_ms,
        command_text: commandText,
        start_at: startAt,
        end_at: endAt,
        created_at: now,
        updated_at: now,
        source,
      },
      { now }
    );
    const existing = current.loops.find((definition) => {
      return identityKey(definition) === identityKey(candidate);
    });
    if (existing) {
      return {
        status: "already_exists",
        duplicate_prevented: true,
        definition: existing,
        file_mutated: false,
        storage: current,
      };
    }
    const written = this.writeDefinitions(current.agentFolder, [
      ...current.loops,
      candidate,
    ]);
    return {
      status: "created",
      duplicate_prevented: false,
      definition: written.loops.find((definition) => definition.id === candidate.id),
      file_mutated: true,
      storage: written,
    };
  }

  updateDefinition({
    agentFolder,
    loopId,
    intervalToken,
    intervalMs = null,
    commandText,
    startAt = null,
    endAt = null,
    source = "session_loop_gui",
  }) {
    const current = this.readDefinitions(agentFolder);
    const existing = current.loops.find((definition) => definition.id === loopId);
    if (!existing) {
      throw new Error("Loop definition not found for this session");
    }
    const interval = parseSessionLoopIntervalToken(intervalToken);
    if (intervalMs !== null && Number(intervalMs) !== interval.interval_ms) {
      throw new Error("Loop interval_ms must match interval token");
    }
    const now = nowIso(this.clock);
    const updated = normalizeLoopDefinition(
      {
        id: existing.id,
        interval_token: interval.interval_token,
        interval_ms: interval.interval_ms,
        command_text: commandText,
        start_at: startAt,
        end_at: endAt,
        created_at: existing.created_at,
        updated_at: now,
        source: source || existing.source,
      },
      { now, existing }
    );
    const duplicate = current.loops.find(
      (definition) =>
        definition.id !== existing.id && identityKey(definition) === identityKey(updated)
    );
    if (duplicate) {
      throw new Error(
        "A loop definition with the same interval and command already exists for this agent folder"
      );
    }
    const written = this.writeDefinitions(
      current.agentFolder,
      current.loops.map((definition) =>
        definition.id === existing.id ? updated : definition
      )
    );
    return {
      status: "updated",
      definition: written.loops.find((definition) => definition.id === existing.id),
      file_mutated: true,
      storage: written,
    };
  }

  deleteDefinition({ agentFolder, loopId }) {
    const current = this.readDefinitions(agentFolder);
    const existing = current.loops.find((definition) => definition.id === loopId);
    if (!existing) {
      throw new Error("Loop definition not found for this session");
    }
    const written = this.writeDefinitions(
      current.agentFolder,
      current.loops.filter((definition) => definition.id !== loopId)
    );
    return {
      status: "deleted",
      schedule_id: existing.id,
      definition: existing,
      file_mutated: true,
      storage: written,
    };
  }
}

function createRuntimeState(definition) {
  return {
    id: definition.id,
    enabled: false,
    status: "paused",
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    dispatch_count: 0,
    skip_count: 0,
    last_dispatched_message_id: null,
  };
}

export class SessionLoopDefinitionService {
  constructor({
    store = new SessionLoopDefinitionStore(),
    clock = () => new Date(),
    recheckMs = 5000,
  } = {}) {
    this.store = store;
    this.clock = clock;
    this.recheckMs = recheckMs;
    this.sessions = new Map();
  }

  ensureRuntimeSession({ hostSessionId, agentId, agentFolder }) {
    const sessionId = normalizeRequiredString(hostSessionId, "hostSessionId");
    const normalizedAgentId = normalizeRequiredString(agentId, "agentId");
    const storage = this.store.readDefinitions(agentFolder);
    let runtime = this.sessions.get(sessionId);
    if (!runtime || runtime.agent_folder !== storage.agentFolder) {
      runtime = {
        host_session_id: sessionId,
        agent_id: normalizedAgentId,
        agent_folder: storage.agentFolder,
        loaded_at: nowIso(this.clock),
        states: new Map(),
      };
      this.sessions.set(sessionId, runtime);
    }
    const definitionIds = new Set(storage.loops.map((definition) => definition.id));
    for (const definition of storage.loops) {
      if (!runtime.states.has(definition.id)) {
        runtime.states.set(definition.id, createRuntimeState(definition));
      }
    }
    for (const loopId of [...runtime.states.keys()]) {
      if (!definitionIds.has(loopId)) {
        runtime.states.delete(loopId);
      }
    }
    return { runtime, storage };
  }

  listDefinitionsForGui({ hostSessionId, agentId, agentFolder }) {
    const { runtime, storage } = this.ensureRuntimeSession({
      hostSessionId,
      agentId,
      agentFolder,
    });
    return storage.loops.map((definition) =>
      this.serializeForGui({ definition, runtime })
    );
  }

  createDefinitionForGui({
    hostSessionId,
    agentId,
    agentFolder,
    createdBy = "oysterun-host",
    interval,
    prompt,
    startAt = null,
    endAt = null,
    enabled = false,
  }) {
    const result = this.store.createDefinition({
      agentFolder,
      intervalToken: interval,
      commandText: prompt,
      startAt,
      endAt,
      source: "session_loop_gui",
    });
    const { runtime } = this.ensureRuntimeSession({
      hostSessionId,
      agentId,
      agentFolder,
    });
    if (enabled === true && result.status === "created") {
      this.setRuntimeEnabled({ runtime, definition: result.definition, enabled: true });
    }
    return {
      status: result.status,
      duplicate_prevented: result.duplicate_prevented,
      created_by: createdBy,
      file_mutated: result.file_mutated,
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      schedule: this.serializeForGui({ definition: result.definition, runtime }),
      feedback_schedule: this.serializeForFeedback({
        definition: result.definition,
        runtime,
      }),
    };
  }

  updateDefinitionForGui({
    hostSessionId,
    agentId,
    agentFolder,
    scheduleId,
    interval,
    prompt,
    startAt = null,
    endAt = null,
    enabled,
    runtimeOnly = false,
  }) {
    const { runtime, storage } = this.ensureRuntimeSession({
      hostSessionId,
      agentId,
      agentFolder,
    });
    const beforeDefinition = storage.loops.find(
      (definition) => definition.id === scheduleId
    );
    if (!beforeDefinition) {
      throw new Error("Loop definition not found for this session");
    }
    if (runtimeOnly === true) {
      this.setRuntimeEnabled({
        runtime,
        definition: beforeDefinition,
        enabled: enabled === true,
      });
      return {
        status: "updated",
        file_mutated: false,
        storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
        runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
        schedule: this.serializeForGui({ definition: beforeDefinition, runtime }),
        feedback_schedule: this.serializeForFeedback({
          definition: beforeDefinition,
          runtime,
        }),
      };
    }
    const result = this.store.updateDefinition({
      agentFolder,
      loopId: scheduleId,
      intervalToken: interval,
      commandText: prompt,
      startAt,
      endAt,
      source: "session_loop_gui",
    });
    const refreshed = this.ensureRuntimeSession({
      hostSessionId,
      agentId,
      agentFolder,
    });
    if (typeof enabled === "boolean") {
      this.setRuntimeEnabled({
        runtime: refreshed.runtime,
        definition: result.definition,
        enabled,
      });
    }
    return {
      status: result.status,
      file_mutated: result.file_mutated,
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      schedule: this.serializeForGui({
        definition: result.definition,
        runtime: refreshed.runtime,
      }),
      feedback_schedule: this.serializeForFeedback({
        definition: result.definition,
        runtime: refreshed.runtime,
      }),
    };
  }

  deleteDefinitionForGui({ hostSessionId, agentId, agentFolder, scheduleId }) {
    const { runtime } = this.ensureRuntimeSession({
      hostSessionId,
      agentId,
      agentFolder,
    });
    const result = this.store.deleteDefinition({
      agentFolder,
      loopId: scheduleId,
    });
    runtime.states.delete(scheduleId);
    return {
      status: "deleted",
      schedule_id: result.schedule_id,
      host_session_id: hostSessionId,
      schedule_kind: SESSION_LOOP_DEFINITION_KIND,
      file_mutated: result.file_mutated,
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      feedback_schedule: this.serializeForFeedback({
        definition: result.definition,
        runtime,
      }),
    };
  }

  clearRuntimeSession({ hostSessionId, reason = "session_stop" }) {
    const sessionId = normalizeRequiredString(hostSessionId, "hostSessionId");
    const cleanupReason = normalizeRequiredString(reason, "cleanup reason");
    const runtime = this.sessions.get(sessionId) || null;
    const runtimeStateCount = runtime?.states?.size || 0;
    const removed = this.sessions.delete(sessionId);
    return {
      status: removed ? "cleared" : "already_clear",
      host_session_id: sessionId,
      removed,
      runtime_state_count: runtimeStateCount,
      reason: cleanupReason,
      file_mutated: false,
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
    };
  }

  createOrEnableFromParsed({
    hostSessionId,
    agentId,
    agentFolder,
    createdBy = "oysterun-host",
    parsed,
  }) {
    if (!parsed) return null;
    const result = this.store.createDefinition({
      agentFolder,
      intervalToken: parsed.interval_token,
      intervalMs: parsed.interval_ms,
      commandText: parsed.prompt,
      startAt: null,
      endAt: null,
      source: "routec_composer_loop_cli",
    });
    const { runtime } = this.ensureRuntimeSession({
      hostSessionId,
      agentId,
      agentFolder,
    });
    this.setRuntimeEnabled({
      runtime,
      definition: result.definition,
      enabled: true,
    });
    return {
      status: result.status === "created" ? "created" : "enabled_existing",
      duplicate_prevented: result.duplicate_prevented === true,
      created_by: createdBy,
      file_mutated: result.file_mutated,
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      schedule: this.serializeForCli({
        definition: result.definition,
        runtime,
      }),
      feedback_schedule: this.serializeForFeedback({
        definition: result.definition,
        runtime,
      }),
    };
  }

  setRuntimeEnabled({ runtime, definition, enabled }) {
    const state = runtime.states.get(definition.id) || createRuntimeState(definition);
    if (enabled === true) {
      const now = nowIso(this.clock);
      const startAtTime = Date.parse(definition.start_at || "");
      const nowTime = Date.parse(now);
      state.enabled = true;
      state.status = "active";
      state.next_run_at =
        Number.isFinite(startAtTime) && startAtTime > nowTime
          ? definition.start_at
          : addMilliseconds(now, definition.interval_ms);
      state.last_error = null;
    } else {
      state.enabled = false;
      state.status = "paused";
      state.next_run_at = null;
    }
    runtime.states.set(definition.id, state);
    return state;
  }

  listDueLoops({ now = nowIso(this.clock), limit = 50 } = {}) {
    const due = [];
    const nowMs = Date.parse(now);
    for (const runtime of this.sessions.values()) {
      const storage = this.store.readDefinitions(runtime.agent_folder);
      const definitionsById = new Map(
        storage.loops.map((definition) => [definition.id, definition])
      );
      for (const [loopId, state] of runtime.states.entries()) {
        const definition = definitionsById.get(loopId);
        if (!definition || state.enabled !== true || state.status !== "active") {
          continue;
        }
        const nextRunMs = Date.parse(state.next_run_at || "");
        const endAtMs = Date.parse(definition.end_at || "");
        if (
          Number.isFinite(endAtMs) &&
          Number.isFinite(nowMs) &&
          endAtMs <= nowMs
        ) {
          state.enabled = false;
          state.status = "expired";
          state.next_run_at = null;
          continue;
        }
        if (Number.isFinite(nextRunMs) && nextRunMs <= nowMs) {
          due.push({ runtime, definition, state });
          if (due.length >= limit) return due;
        }
      }
    }
    return due;
  }

  recordSkipped({ runtime, definition, state, triggeredAt, reason }) {
    state.skip_count += 1;
    state.last_run_at = triggeredAt;
    state.last_status = "skipped";
    state.last_error = reason;
    state.next_run_at = addMilliseconds(triggeredAt, this.recheckMs);
    runtime.states.set(definition.id, state);
    return state;
  }

  recordDispatched({
    runtime,
    definition,
    state,
    triggeredAt,
    nextRunAt,
    dispatchedMessageId,
  }) {
    state.dispatch_count += 1;
    state.last_run_at = triggeredAt;
    state.last_status = "dispatched";
    state.last_error = null;
    state.last_dispatched_message_id = dispatchedMessageId;
    state.next_run_at = nextRunAt;
    runtime.states.set(definition.id, state);
    return state;
  }

  recordFailed({ runtime, definition, state, triggeredAt, reason }) {
    state.last_run_at = triggeredAt;
    state.last_status = "failed";
    state.last_error = reason;
    state.next_run_at = addMilliseconds(triggeredAt, this.recheckMs);
    runtime.states.set(definition.id, state);
    return state;
  }

  snapshotHostRestartRuntimeState() {
    const runtimeSessions = [];
    for (const runtime of this.sessions.values()) {
      const storage = this.store.readDefinitions(runtime.agent_folder);
      const definitionsById = new Map(
        storage.loops.map((definition) => [definition.id, definition])
      );
      const loops = [];
      for (const [loopId, state] of runtime.states.entries()) {
        const definition = definitionsById.get(loopId);
        if (!definition || state.enabled !== true) continue;
        loops.push({
          loop_id: loopId,
          enabled: true,
          status: state.status || "active",
          next_run_at: state.next_run_at || null,
          last_run_at: state.last_run_at || null,
          last_status: state.last_status || null,
          last_error: state.last_error || null,
          dispatch_count: state.dispatch_count || 0,
          skip_count: state.skip_count || 0,
          interval_ms: definition.interval_ms,
          runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
          definition_storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
        });
      }
      if (loops.length > 0) {
        runtimeSessions.push({
          host_session_id: runtime.host_session_id,
          agent_id: runtime.agent_id,
          agent_folder: runtime.agent_folder,
          loops,
        });
      }
    }
    return {
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      writes_runtime_state_to_loops_json: false,
      runtime_sessions: runtimeSessions,
    };
  }

  restoreHostRestartRuntimeState(snapshot = {}, { restartId, restoredAt } = {}) {
    const runtimeSessions = Array.isArray(snapshot.runtime_sessions)
      ? snapshot.runtime_sessions
      : [];
    const restored = [];
    const skipped = [];
    const timestamp = restoredAt || nowIso(this.clock);
    for (const entry of runtimeSessions) {
      try {
        const { runtime, storage } = this.ensureRuntimeSession({
          hostSessionId: entry.host_session_id,
          agentId: entry.agent_id,
          agentFolder: entry.agent_folder,
        });
        const definitionsById = new Map(
          storage.loops.map((definition) => [definition.id, definition])
        );
        for (const loop of Array.isArray(entry.loops) ? entry.loops : []) {
          const definition = definitionsById.get(loop.loop_id);
          if (!definition) {
            skipped.push({
              host_session_id: entry.host_session_id,
              loop_id: loop.loop_id || null,
              reason: "definition_missing_after_restart",
            });
            continue;
          }
          const state = createRuntimeState(definition);
          state.enabled = true;
          state.status = "active";
          state.next_run_at =
            loop.next_run_at || addMilliseconds(timestamp, this.recheckMs);
          state.last_run_at = loop.last_run_at || timestamp;
          state.last_status =
            loop.last_status === "dispatched" ? "interrupted" : loop.last_status;
          state.last_error =
            loop.last_status === "dispatched"
              ? "Host restarted during loop dispatch; loop restored idle without replay."
              : loop.last_error || null;
          state.dispatch_count = Number.isInteger(loop.dispatch_count)
            ? loop.dispatch_count
            : 0;
          state.skip_count = Number.isInteger(loop.skip_count)
            ? loop.skip_count
            : 0;
          runtime.states.set(definition.id, state);
          restored.push({
            host_session_id: entry.host_session_id,
            loop_id: definition.id,
            restart_id: restartId || null,
            restored_enabled_idle: true,
            loops_json_mutated: false,
          });
        }
      } catch (err) {
        skipped.push({
          host_session_id: entry?.host_session_id || null,
          reason: err.message,
        });
      }
    }
    return { restored, skipped, restored_at: timestamp };
  }

  serializeForGui({ definition, runtime }) {
    const state = runtime.states.get(definition.id) || createRuntimeState(definition);
    return this.serializeDefinition({ definition, runtime, state, redacted: false });
  }

  serializeForCli({ definition, runtime }) {
    const state = runtime.states.get(definition.id) || createRuntimeState(definition);
    return this.serializeDefinition({ definition, runtime, state, redacted: true });
  }

  serializeForFeedback({ definition, runtime }) {
    const state = runtime.states.get(definition.id) || createRuntimeState(definition);
    return this.serializeDefinition({ definition, runtime, state, redacted: false });
  }

  serializeDefinition({ definition, runtime, state, redacted }) {
    const normalized = normalizeSessionLoopCommandText(definition.command_text);
    return {
      id: definition.id,
      host_session_id: runtime.host_session_id,
      agent_id: runtime.agent_id,
      schedule_kind: SESSION_LOOP_DEFINITION_KIND,
      interval_ms: definition.interval_ms,
      interval_token: definition.interval_token,
      ...(redacted
        ? {
            input_text_redacted: true,
            input_text_length: definition.command_text.length,
            input_text_sha256: hashText(definition.command_text),
          }
        : {
            command_text: definition.command_text,
            prompt_text: definition.command_text,
          }),
      normalized_command_sha256: hashText(normalized),
      enabled: state.enabled === true,
      status: state.status,
      next_run_at: state.next_run_at,
      start_at: definition.start_at,
      end_at: definition.end_at,
      last_run_at: state.last_run_at,
      last_status: state.last_status,
      last_error: state.last_error,
      run_count: state.dispatch_count,
      skipped_busy_count: state.skip_count,
      dispatch_count: state.dispatch_count,
      skip_count: state.skip_count,
      created_at: definition.created_at,
      updated_at: definition.updated_at,
      source: definition.source,
      serialization_scope: "authenticated_current_session_loop_gui",
      session_scoped: true,
      cross_session_data: false,
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      persisted_enabled_state: false,
      persisted_runtime_state: false,
      browser_local_storage_owner: false,
      matrix_db_owner: false,
      host_owned_scheduler_db: false,
      host_dispatch_path: SESSION_LOOP_DUE_DISPATCH_PATH,
      generic_cli_serialization_remains_redacted: true,
      p12_4_schedule_model: false,
    };
  }
}
