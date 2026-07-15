import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { completeSchedulerSessionSetupPayloadForRuntime } from "./scheduler-setup-snapshot-contract.mjs";

export const PORTABLE_SCHEDULER_STORAGE_OWNER =
  "agent_folder_oysterun_schedulers_json";
export const PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER =
  "host_config_oysterun_sqlite_runtime";
export const PORTABLE_SCHEDULER_FILE_VERSION = 1;

const FORBIDDEN_SETUP_KEYS = new Set([
  "host_session_id",
  "hostSessionId",
  "saved_session_id",
  "savedSessionId",
  "session_setup_record_id",
  "sessionSetupRecordId",
  "session_id",
  "sessionId",
  "source_session_id",
  "sourceSessionId",
  "history_session_id",
  "historySessionId",
  "matrix_room_id",
  "matrixRoomId",
  "room_id",
  "roomId",
  "provider_resume_id",
  "providerResumeId",
  "transcript",
  "messages",
  "run_logs",
  "runLogs",
]);

function nowIso(clock = () => new Date()) {
  const value = clock();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value).trim() || null;
  return value.trim() || null;
}

function normalizeScheduleStatus(value, enabled) {
  const status = normalizeOptionalString(value);
  if (status) {
    if (!["active", "paused", "stopped", "failed", "draft"].includes(status)) {
      throw new Error(`Unsupported portable scheduler status: ${status}`);
    }
    return status;
  }
  return enabled === true ? "active" : "paused";
}

function deepCloneJson(value, fieldName) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    throw new Error(`${fieldName} must be JSON serializable: ${err.message}`);
  }
}

function assertNoForbiddenSetupKeys(value, path = "setup_snapshot") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoForbiddenSetupKeys(entry, `${path}[${index}]`)
    );
    return;
  }
  if (!isObjectRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SETUP_KEYS.has(key)) {
      throw new Error(`${path}.${key} cannot be stored in schedulers.json`);
    }
    assertNoForbiddenSetupKeys(entry, `${path}.${key}`);
  }
}

function normalizeStringArray(value, fieldName) {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((entry) => normalizeRequiredString(entry, fieldName));
}

export function getPortableSchedulersJsonPath(agentFolder) {
  return join(
    normalizeRequiredString(agentFolder, "agentFolder"),
    ".oysterun",
    "schedulers.json"
  );
}

export function hashPortableScheduleDefinition(definition) {
  return createHash("sha256")
    .update(JSON.stringify(definition))
    .digest("hex");
}

export function normalizePortableSetupSnapshot(value) {
  if (!isObjectRecord(value)) {
    throw new Error("setup_snapshot must be an object");
  }
  assertNoForbiddenSetupKeys(value);
  const source = deepCloneJson(value, "setup_snapshot");
  const snapshot = {};
  for (const key of [
    "provider",
    "session_name",
    "interface_type",
    "model",
    "reasoning_effort",
    "permission_mode",
    "approval_policy",
    "agent_folder",
    "cwd",
    "web_access",
    "notifications_enabled",
  ]) {
    const normalized = normalizeOptionalString(source[key]);
    if (normalized) snapshot[key] = normalized;
  }
  for (const key of [
    "allow_dangerously_skip_permissions",
    "dangerous_mode",
    "search_enabled",
    "image_input_enabled",
  ]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      snapshot[key] = source[key] === true;
    }
  }
  const allowedPaths = normalizeStringArray(
    source.allowed_paths,
    "setup_snapshot.allowed_paths"
  );
  if (allowedPaths) snapshot.allowed_paths = allowedPaths;
  if (isObjectRecord(source.runtime_capabilities)) {
    snapshot.runtime_capabilities = deepCloneJson(
      source.runtime_capabilities,
      "setup_snapshot.runtime_capabilities"
    );
  }
  if (isObjectRecord(source.capabilities)) {
    snapshot.capabilities = deepCloneJson(
      source.capabilities,
      "setup_snapshot.capabilities"
    );
  }
  if (isObjectRecord(source.workspace_policy)) {
    const workspacePolicy = {};
    const workspaceAllowed = normalizeStringArray(
      source.workspace_policy.allowed_paths,
      "setup_snapshot.workspace_policy.allowed_paths"
    );
    if (workspaceAllowed) workspacePolicy.allowed_paths = workspaceAllowed;
    if (Object.keys(workspacePolicy).length > 0) {
      snapshot.workspace_policy = workspacePolicy;
    }
  }
  const agentFolder = normalizeOptionalString(snapshot.agent_folder);
  if (!agentFolder) {
    throw new Error("setup_snapshot.agent_folder is required");
  }
  if (!snapshot.cwd) snapshot.cwd = agentFolder;
  return snapshot;
}

function normalizePortableScheduleForFile(input, { now }) {
  if (!isObjectRecord(input)) {
    throw new Error("portable scheduler definition must be an object");
  }
  const setupSnapshot = completeSchedulerSessionSetupPayloadForRuntime({
    agentFolder: input.setup_snapshot?.agent_folder || input.setup_snapshot?.cwd,
    sessionPayload: normalizePortableSetupSnapshot(input.setup_snapshot),
    label: "portable scheduler",
    requireExplicitRuntimeProof: true,
  }).sessionPayload;
  const agentFolder = normalizeRequiredString(
    setupSnapshot.agent_folder,
    "setup_snapshot.agent_folder"
  );
  const enabled = input.enabled === true;
  const scheduleRule = isObjectRecord(input.schedule_rule)
    ? deepCloneJson(input.schedule_rule, "schedule_rule")
    : null;
  if (!scheduleRule) throw new Error("schedule_rule is required");
  const id = normalizeOptionalString(input.id) || randomUUID();
  const commandText =
    normalizeOptionalString(input.command_text) ||
    normalizeOptionalString(input.prompt) ||
    normalizeOptionalString(input.input_text);
  if (!commandText) throw new Error("command_text is required");
  const createdAt = normalizeOptionalString(input.created_at) || now;
  const metadata = isObjectRecord(input.metadata)
    ? deepCloneJson(input.metadata, "metadata")
    : {};
  return {
    id,
    agent_id: normalizeRequiredString(input.agent_id, "agent_id"),
    created_by:
      normalizeOptionalString(input.created_by) || "oysterun-host",
    command_text: commandText,
    normalized_command:
      normalizeOptionalString(input.normalized_command) || commandText,
    enabled,
    status: normalizeScheduleStatus(input.status, enabled),
    next_run_at: normalizeOptionalString(input.next_run_at),
    schedule_rule: scheduleRule,
    timezone:
      normalizeOptionalString(input.timezone) ||
      normalizeOptionalString(scheduleRule.timezone),
    setup_snapshot: setupSnapshot,
    metadata,
    created_at: createdAt,
    updated_at: normalizeOptionalString(input.updated_at) || now,
    storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
    source_session_references_present: false,
    run_logs_persisted_in_file: false,
  };
}

function buildInvalidPortableScheduleDefinition(
  input,
  { now, error, index, filePath, agentFolder }
) {
  const source = isObjectRecord(input) ? input : {};
  const rawSetupSnapshot = isObjectRecord(source.setup_snapshot)
    ? deepCloneJson(source.setup_snapshot, "invalid setup_snapshot")
    : {};
  const sourceMetadata = isObjectRecord(source.metadata)
    ? deepCloneJson(source.metadata, "invalid metadata")
    : {};
  const sourceTargetBinding = isObjectRecord(sourceMetadata.target_binding)
    ? sourceMetadata.target_binding
    : {};
  const sourceTargetSnapshot = isObjectRecord(
    sourceTargetBinding.setup_snapshot
  )
    ? sourceTargetBinding.setup_snapshot
    : {};
  const setupSnapshot = {
    ...sourceTargetSnapshot,
    ...rawSetupSnapshot,
  };
  if (!setupSnapshot.agent_folder) setupSnapshot.agent_folder = agentFolder;
  if (!setupSnapshot.cwd) setupSnapshot.cwd = setupSnapshot.agent_folder;
  const errorMessage = error?.message || String(error);
  const errorCode =
    normalizeOptionalString(error?.code) ||
    "portable_scheduler_definition_invalid";
  const stableIdHash = createHash("sha256")
    .update(`${filePath}:${index}`)
    .digest("hex")
    .slice(0, 12);
  const id =
    normalizeOptionalString(source.id) ||
    `invalid_portable_scheduler_${stableIdHash}`;
  const agentId =
    normalizeOptionalString(source.agent_id) ||
    normalizeOptionalString(sourceTargetBinding.agent_id) ||
    normalizeOptionalString(setupSnapshot.agent_id) ||
    "invalid-portable-scheduler";
  const scheduleRule = isObjectRecord(source.schedule_rule)
    ? deepCloneJson(source.schedule_rule, "invalid schedule_rule")
    : null;
  const commandText =
    normalizeOptionalString(source.command_text) ||
    normalizeOptionalString(source.prompt) ||
    normalizeOptionalString(source.input_text) ||
    `Invalid portable scheduler definition: ${errorMessage}`;
  return {
    id,
    agent_id: agentId,
    created_by:
      normalizeOptionalString(source.created_by) ||
      "portable_scheduler_validation",
    enabled: false,
    status: "failed",
    schedule_rule: scheduleRule,
    timezone:
      normalizeOptionalString(source.timezone) ||
      normalizeOptionalString(scheduleRule?.timezone),
    setup_snapshot: setupSnapshot,
    command_text: commandText,
    normalized_command: normalizeOptionalString(source.normalized_command),
    next_run_at: null,
    created_at: normalizeOptionalString(source.created_at) || now,
    updated_at: now,
    metadata: {
      ...sourceMetadata,
      source: "p72_agent_folder_schedulers_json",
      schedule_rule: scheduleRule,
      timezone:
        normalizeOptionalString(source.timezone) ||
        normalizeOptionalString(scheduleRule?.timezone),
      target_binding: {
        kind: "setup_snapshot",
        agent_id: agentId,
        setup_snapshot: setupSnapshot,
      },
      target_binding_scope: "portable_setup_snapshot",
      portable_scheduler_validation_failed: true,
      portable_scheduler_validation_error: errorMessage,
      portable_scheduler_validation_error_code: errorCode,
      portable_scheduler_index: index,
      portable_schedulers_json_path: filePath,
      storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
      runtime_state_owner: PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
    },
  };
}

function readPortableFile(filePath) {
  if (!existsSync(filePath)) {
    return { version: PORTABLE_SCHEDULER_FILE_VERSION, schedulers: [] };
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isObjectRecord(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  if (parsed.version !== PORTABLE_SCHEDULER_FILE_VERSION) {
    throw new Error(`${filePath} has unsupported version ${parsed.version}`);
  }
  if (!Array.isArray(parsed.schedulers)) {
    throw new Error(`${filePath} schedulers must be an array`);
  }
  return parsed;
}

function writePortableFile(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmpPath, filePath);
}

function normalizeKnownFolderEntry(entry) {
  if (typeof entry === "string") {
    return { agent_id: null, agent_folder: entry };
  }
  if (!isObjectRecord(entry)) return null;
  const agentFolder =
    normalizeOptionalString(entry.agent_folder) ||
    normalizeOptionalString(entry.agentFolder) ||
    normalizeOptionalString(entry.folder) ||
    normalizeOptionalString(entry.cwd);
  if (!agentFolder) return null;
  return {
    agent_id:
      normalizeOptionalString(entry.agent_id) ||
      normalizeOptionalString(entry.agentId) ||
      null,
    agent_folder: agentFolder,
  };
}

export class PortableSchedulerDefinitionStore {
  constructor({
    runtimeStore,
    getKnownAgentFolders = () => [],
    clock = () => new Date(),
  } = {}) {
    if (!runtimeStore) {
      throw new Error("PortableSchedulerDefinitionStore requires runtimeStore");
    }
    this.runtimeStore = runtimeStore;
    this.getKnownAgentFolders = getKnownAgentFolders;
    this.clock = clock;
    this.memoryKnownFolders = new Map();
  }

  now() {
    return nowIso(this.clock);
  }

  getKnownFolders({ includeMemory = true } = {}) {
    const candidates = [];
    for (const entry of this.getKnownAgentFolders() || []) {
      const normalized = normalizeKnownFolderEntry(entry);
      if (normalized) candidates.push(normalized);
    }
    if (includeMemory) {
      for (const entry of this.memoryKnownFolders.values()) {
        candidates.push(entry);
      }
    }
    const seen = new Set();
    const result = [];
    for (const entry of candidates) {
      if (!existsSync(entry.agent_folder)) continue;
      const realFolder = realpathSync(entry.agent_folder);
      if (seen.has(realFolder)) continue;
      seen.add(realFolder);
      result.push({ ...entry, agent_folder: realFolder });
    }
    return result;
  }

  rememberKnownFolder(agentId, agentFolder) {
    const realFolder = realpathSync(
      normalizeRequiredString(agentFolder, "agentFolder")
    );
    this.memoryKnownFolders.set(realFolder, {
      agent_id: normalizeOptionalString(agentId),
      agent_folder: realFolder,
    });
    return realFolder;
  }

  assertHostKnownAgentFolder(
    agentFolder,
    { includeMemory = true, requireKnown = false } = {}
  ) {
    const realFolder = realpathSync(
      normalizeRequiredString(agentFolder, "agentFolder")
    );
    const knownFolders = this.getKnownFolders({ includeMemory });
    if (
      (requireKnown || knownFolders.length > 0) &&
      !knownFolders.some((entry) => entry.agent_folder === realFolder)
    ) {
      throw new Error("scheduler_agent_folder_not_host_known");
    }
    return realFolder;
  }

  readDefinitionsForFolder(agentFolder, { tolerateInvalid = false } = {}) {
    const realFolder = realpathSync(
      normalizeRequiredString(agentFolder, "agentFolder")
    );
    const filePath = getPortableSchedulersJsonPath(realFolder);
    const payload = readPortableFile(filePath);
    const now = this.now();
    return payload.schedulers.map((entry, index) => {
      try {
        return normalizePortableScheduleForFile(entry, { now });
      } catch (err) {
        if (!tolerateInvalid) throw err;
        return buildInvalidPortableScheduleDefinition(entry, {
          now,
          error: err,
          index,
          filePath,
          agentFolder: realFolder,
        });
      }
    });
  }

  writeDefinitionsForFolder(agentFolder, definitions) {
    const realFolder = this.assertHostKnownAgentFolder(agentFolder);
    const filePath = getPortableSchedulersJsonPath(realFolder);
    writePortableFile(filePath, {
      version: PORTABLE_SCHEDULER_FILE_VERSION,
      schedulers: definitions,
    });
    return filePath;
  }

  buildPortableHash(definition) {
    return hashPortableScheduleDefinition({
      id: definition.id,
      agent_id: definition.agent_id,
      command_text: definition.command_text,
      enabled: definition.enabled,
      status: definition.status,
      next_run_at: definition.next_run_at,
      schedule_rule: definition.schedule_rule,
      setup_snapshot: definition.setup_snapshot,
      metadata: definition.metadata,
    });
  }

  definitionToSchedule(definition, { agentFolder, ownerManaged = false } = {}) {
    const portableHash = this.buildPortableHash(definition);
    const runtimeState =
      this.runtimeStore.ensurePortableScheduleRuntimeState({
        scheduleId: definition.id,
        agentFolder,
        portableHash,
        ownerManaged,
      });
    const ownerActivated = Boolean(runtimeState?.owner_enabled_at) &&
      (!runtimeState?.owner_disabled_at ||
        runtimeState.owner_enabled_at > runtimeState.owner_disabled_at);
    const clonedDisabled = definition.enabled === true && !ownerActivated;
    const effectiveEnabled = definition.enabled === true && ownerActivated;
    const status =
      definition.status === "stopped" || definition.status === "failed"
        ? definition.status
        : effectiveEnabled
        ? "active"
        : "paused";
    const availabilityState = effectiveEnabled ? "active" : "paused";
    const availabilityReason = clonedDisabled
      ? "P72 cloned portable scheduler disabled until Owner enables it on this Host"
      : effectiveEnabled
      ? "P72 portable agent-folder scheduler is enabled"
      : "P72 portable agent-folder scheduler is disabled";
    return {
      id: definition.id,
      host_session_id: `portable:${agentFolder}`,
      agent_id: definition.agent_id,
      created_by: definition.created_by,
      schedule_kind: "host_schedule",
      status,
      input_text: definition.command_text,
      interval_ms: null,
      normalized_command: definition.normalized_command,
      next_run_at: effectiveEnabled ? definition.next_run_at : null,
      availability_state: availabilityState,
      availability_reason: availabilityReason,
      metadata: {
        ...definition.metadata,
        source: "p72_agent_folder_schedulers_json",
        schedule_rule: definition.schedule_rule,
        timezone: definition.timezone || definition.schedule_rule?.timezone,
        target_binding: {
          kind: "setup_snapshot",
          agent_id: definition.agent_id,
          setup_snapshot: definition.setup_snapshot,
        },
        target_binding_scope: "portable_setup_snapshot",
        missed_run_policy: "skip_without_catch_up",
        catch_up_burst: false,
        p12_5_scheduler_tab: true,
        p72_portable_scheduler: true,
        setup_snapshot_copied: true,
        source_session_references_present: false,
        storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
        runtime_state_owner: PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
        portable_agent_folder: agentFolder,
        portable_schedulers_json_path: getPortableSchedulersJsonPath(agentFolder),
        portable_definition_hash: portableHash,
        cloned_first_discovery_disabled: clonedDisabled,
        effective_enabled: effectiveEnabled,
      },
      created_at: definition.created_at,
      updated_at: definition.updated_at,
      last_triggered_at: runtimeState?.last_triggered_at || null,
      last_dispatched_message_id:
        runtimeState?.last_dispatched_message_id || null,
      last_skipped_at: runtimeState?.last_skipped_at || null,
      skip_count: runtimeState?.skip_count || 0,
      dispatch_count: runtimeState?.dispatch_count || 0,
      stopped_at: definition.status === "stopped" ? definition.updated_at : null,
      stopped_by: null,
      stop_reason: null,
    };
  }

  listSchedules() {
    const schedules = [];
    for (const entry of this.getKnownFolders()) {
      for (const definition of this.readDefinitionsForFolder(
        entry.agent_folder,
        { tolerateInvalid: true }
      )) {
        schedules.push(
          this.definitionToSchedule(definition, {
            agentFolder: entry.agent_folder,
          })
        );
      }
    }
    return schedules.sort((a, b) => {
      const aNext = a.next_run_at || "9999";
      const bNext = b.next_run_at || "9999";
      if (aNext !== bNext) return aNext.localeCompare(bNext);
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
  }

  getSchedule(scheduleId) {
    const normalizedId = normalizeRequiredString(scheduleId, "scheduleId");
    return (
      this.listSchedules().find((schedule) => schedule.id === normalizedId) ||
      null
    );
  }

  listDueSchedules(now, { limit = 50 } = {}) {
    const dueAt = normalizeRequiredString(now, "now");
    return this.listSchedules()
      .filter(
        (schedule) =>
          schedule.status === "active" &&
          schedule.next_run_at &&
          schedule.next_run_at <= dueAt
      )
      .slice(0, limit);
  }

  createSchedule(input) {
    const now = this.now();
    const definition = normalizePortableScheduleForFile(
      {
        ...input,
        id: input.id || randomUUID(),
        created_at: now,
        updated_at: now,
      },
      { now }
    );
    const agentFolder = this.assertHostKnownAgentFolder(
      definition.setup_snapshot.agent_folder,
      { includeMemory: false }
    );
    this.rememberKnownFolder(definition.agent_id, agentFolder);
    const existing = this.readDefinitionsForFolder(agentFolder);
    if (existing.some((entry) => entry.id === definition.id)) {
      throw new Error(`portable scheduler already exists: ${definition.id}`);
    }
    this.writeDefinitionsForFolder(agentFolder, [...existing, definition]);
    const portableHash = this.buildPortableHash(definition);
    this.runtimeStore.markPortableScheduleOwnerToggle({
      scheduleId: definition.id,
      agentFolder,
      portableHash,
      enabled: definition.enabled,
    });
    return this.definitionToSchedule(definition, {
      agentFolder,
      ownerManaged: true,
    });
  }

  updateSchedule(scheduleId, updates) {
    const existingSchedule = this.getSchedule(scheduleId);
    if (!existingSchedule) throw new Error("Host schedule not found");
    const agentFolder = existingSchedule.metadata.portable_agent_folder;
    const definitions = this.readDefinitionsForFolder(agentFolder);
    const index = definitions.findIndex((entry) => entry.id === scheduleId);
    if (index < 0) throw new Error("Host schedule not found");
    const now = this.now();
    const updated = normalizePortableScheduleForFile(
      {
        ...definitions[index],
        ...updates,
        id: scheduleId,
        created_at: definitions[index].created_at,
        updated_at: now,
      },
      { now }
    );
    const updatedFolder = this.assertHostKnownAgentFolder(
      updated.setup_snapshot.agent_folder,
      { includeMemory: false }
    );
    this.rememberKnownFolder(updated.agent_id, updatedFolder);
    if (updatedFolder !== agentFolder) {
      const oldDefinitions = definitions.filter((entry) => entry.id !== scheduleId);
      this.writeDefinitionsForFolder(agentFolder, oldDefinitions);
      const targetDefinitions = this.readDefinitionsForFolder(updatedFolder);
      this.writeDefinitionsForFolder(updatedFolder, [...targetDefinitions, updated]);
    } else {
      definitions[index] = updated;
      this.writeDefinitionsForFolder(agentFolder, definitions);
    }
    const portableHash = this.buildPortableHash(updated);
    this.runtimeStore.markPortableScheduleOwnerToggle({
      scheduleId,
      agentFolder: updatedFolder,
      portableHash,
      enabled: updated.enabled,
    });
    return this.definitionToSchedule(updated, {
      agentFolder: updatedFolder,
      ownerManaged: true,
    });
  }

  deleteSchedule(scheduleId) {
    const existing = this.getSchedule(scheduleId);
    if (!existing) throw new Error("Host schedule not found");
    const agentFolder = existing.metadata.portable_agent_folder;
    const definitions = this.readDefinitionsForFolder(agentFolder);
    this.writeDefinitionsForFolder(
      agentFolder,
      definitions.filter((entry) => entry.id !== scheduleId)
    );
    this.runtimeStore.deletePortableScheduleRuntimeState({
      scheduleId,
      agentFolder,
    });
    return existing;
  }

  recordScheduleDispatch(
    scheduleId,
    { triggeredAt, nextRunAt, dispatchedMessageId, status = null }
  ) {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule) throw new Error("Host schedule not found");
    const agentFolder = schedule.metadata.portable_agent_folder;
    const definitions = this.readDefinitionsForFolder(agentFolder);
    const index = definitions.findIndex((entry) => entry.id === scheduleId);
    if (index < 0) throw new Error("Host schedule not found");
    definitions[index] = {
      ...definitions[index],
      next_run_at: nextRunAt || null,
      enabled: status ? status === "active" : definitions[index].enabled,
      status: status || definitions[index].status,
      updated_at: this.now(),
    };
    this.writeDefinitionsForFolder(agentFolder, definitions);
    this.runtimeStore.recordPortableScheduleDispatch({
      scheduleId,
      agentFolder,
      portableHash: this.buildPortableHash(definitions[index]),
      triggeredAt,
      nextRunAt,
      dispatchedMessageId,
      status,
    });
    return this.getSchedule(scheduleId);
  }

  recordScheduleSkip(scheduleId, { triggeredAt, nextRunAt, status = null }) {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule) throw new Error("Host schedule not found");
    const agentFolder = schedule.metadata.portable_agent_folder;
    const definitions = this.readDefinitionsForFolder(agentFolder);
    const index = definitions.findIndex((entry) => entry.id === scheduleId);
    if (index < 0) throw new Error("Host schedule not found");
    definitions[index] = {
      ...definitions[index],
      next_run_at: nextRunAt || null,
      enabled: status ? status === "active" : definitions[index].enabled,
      status: status || definitions[index].status,
      updated_at: this.now(),
    };
    this.writeDefinitionsForFolder(agentFolder, definitions);
    this.runtimeStore.recordPortableScheduleSkip({
      scheduleId,
      agentFolder,
      portableHash: this.buildPortableHash(definitions[index]),
      triggeredAt,
      nextRunAt,
      status,
    });
    return this.getSchedule(scheduleId);
  }
}
