import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { completeSchedulerSessionSetupPayloadForRuntime } from "./scheduler-setup-snapshot-contract.mjs";
import { deriveBrowserRootProjectId } from "./browser-root-project-index.mjs";
import {
  computeNextScheduleRunAt,
  getHostSystemTimezone,
  normalizeScheduleRule,
} from "./scheduler-rule-model.mjs";

export const PORTABLE_SCHEDULER_STORAGE_OWNER =
  "agent_folder_oysterun_schedulers_json";
export const PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER =
  "host_config_oysterun_sqlite_runtime";
export const PORTABLE_SCHEDULER_FILE_VERSION = 1;

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

function deepCloneJson(value, fieldName) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    throw new Error(`${fieldName} must be JSON serializable: ${err.message}`);
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

function projectPortableSetupSnapshot(value) {
  const snapshot = {};
  for (const key of [
    "provider",
    "session_name",
    "interface_type",
    "model",
    "reasoning_effort",
    "permission_mode",
    "approval_policy",
    "web_access",
    "notifications_enabled",
  ]) {
    const normalized = normalizeOptionalString(value[key]);
    if (normalized) snapshot[key] = normalized;
  }
  for (const key of [
    "allow_dangerously_skip_permissions",
    "dangerous_mode",
    "search_enabled",
    "image_input_enabled",
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      snapshot[key] = value[key] === true;
    }
  }
  const allowedPaths = normalizeStringArray(
    value.allowed_paths,
    "setup_snapshot.allowed_paths"
  );
  if (allowedPaths) snapshot.allowed_paths = allowedPaths;
  if (isObjectRecord(value.runtime_capabilities)) {
    snapshot.runtime_capabilities = deepCloneJson(
      value.runtime_capabilities,
      "setup_snapshot.runtime_capabilities"
    );
  }
  if (isObjectRecord(value.capabilities)) {
    snapshot.capabilities = deepCloneJson(
      value.capabilities,
      "setup_snapshot.capabilities"
    );
  }
  if (isObjectRecord(value.workspace_policy)) {
    const workspacePolicy = {};
    const workspaceAllowed = normalizeStringArray(
      value.workspace_policy.allowed_paths,
      "setup_snapshot.workspace_policy.allowed_paths"
    );
    if (workspaceAllowed) workspacePolicy.allowed_paths = workspaceAllowed;
    if (Object.keys(workspacePolicy).length > 0) {
      snapshot.workspace_policy = workspacePolicy;
    }
  }
  return snapshot;
}

export function normalizePortableSetupSnapshot(value) {
  if (!isObjectRecord(value)) {
    throw new Error("setup_snapshot must be an object");
  }
  return projectPortableSetupSnapshot(value);
}

function normalizePortableMetadata(value) {
  if (!isObjectRecord(value)) return value;
  const {
    target_binding: _runtimeTargetBinding,
    portable_agent_folder: _runtimeAgentFolder,
    portable_schedulers_json_path: _runtimeSchedulersPath,
    ...portableMetadata
  } = value;
  return deepCloneJson(portableMetadata, "portable scheduler metadata");
}

function normalizePortableScheduleForFile(input, { now, agentFolder }) {
  if (!isObjectRecord(input)) {
    throw new Error("portable scheduler definition must be an object");
  }
  const canonicalFolder = realpathSync(
    normalizeRequiredString(agentFolder, "agentFolder")
  );
  const expectedAgentId = deriveBrowserRootProjectId(basename(canonicalFolder));
  const inputAgentId = normalizeRequiredString(input.agent_id, "agent_id");
  if (inputAgentId !== expectedAgentId) {
    const err = new Error(
      `portable scheduler agent_id must match Browser Root project id ${expectedAgentId}`
    );
    err.code = "portable_scheduler_agent_id_mismatch";
    throw err;
  }
  const portableSetupSnapshot = normalizePortableSetupSnapshot(
    input.setup_snapshot
  );
  const setupSnapshot = completeSchedulerSessionSetupPayloadForRuntime({
    agentFolder: canonicalFolder,
    sessionPayload: {
      ...portableSetupSnapshot,
      agent_folder: canonicalFolder,
      cwd: canonicalFolder,
    },
    label: "portable scheduler",
    requireExplicitRuntimeProof: true,
  }).sessionPayload;
  const enabled = input.enabled === true;
  const scheduleRule = isObjectRecord(input.schedule_rule)
    ? deepCloneJson(input.schedule_rule, "schedule_rule")
    : null;
  if (!scheduleRule) throw new Error("schedule_rule is required");
  const id = normalizeOptionalString(input.id) || randomUUID();
  const commandText = normalizeOptionalString(input.command_text);
  if (!commandText) throw new Error("command_text is required");
  const createdAt = normalizeOptionalString(input.created_at) || now;
  const metadata = isObjectRecord(input.metadata)
    ? normalizePortableMetadata(input.metadata)
    : {};
  return {
    id,
    agent_id: expectedAgentId,
    created_by:
      normalizeOptionalString(input.created_by) || "oysterun-host",
    command_text: commandText,
    normalized_command:
      normalizeOptionalString(input.normalized_command) || commandText,
    enabled,
    status: enabled ? "active" : "paused",
    schedule_rule: scheduleRule,
    timezone:
      normalizeOptionalString(input.timezone) ||
      normalizeOptionalString(scheduleRule.timezone),
    setup_snapshot: setupSnapshot,
    portable_setup_snapshot: portableSetupSnapshot,
    metadata,
    created_at: createdAt,
    updated_at: normalizeOptionalString(input.updated_at) || now,
    storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
    source_session_references_present: false,
    run_logs_persisted_in_file: false,
  };
}

function serializePortableScheduleForFile(definition) {
  const serialized = deepCloneJson(definition, "portable scheduler definition");
  serialized.setup_snapshot = deepCloneJson(
    definition.portable_setup_snapshot || {},
    "portable setup_snapshot"
  );
  delete serialized.portable_setup_snapshot;
  delete serialized.next_run_at;
  delete serialized.status;
  serialized.metadata = normalizePortableMetadata(serialized.metadata || {});
  return serialized;
}

function buildInvalidPortableScheduleDefinition(
  input,
  { now, error, index, filePath, agentFolder }
) {
  const source = isObjectRecord(input) ? input : {};
  const rawSetupSnapshot = isObjectRecord(source.setup_snapshot)
    ? projectPortableSetupSnapshot(source.setup_snapshot)
    : {};
  const sourceMetadata = isObjectRecord(source.metadata)
    ? normalizePortableMetadata(source.metadata)
    : {};
  const setupSnapshot = {
    ...rawSetupSnapshot,
    agent_folder: agentFolder,
    cwd: agentFolder,
  };
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
    "invalid-portable-scheduler";
  const scheduleRule = isObjectRecord(source.schedule_rule)
    ? deepCloneJson(source.schedule_rule, "invalid schedule_rule")
    : null;
  const commandText =
    normalizeOptionalString(source.command_text) ||
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
      source: "browser_root_project_schedulers_json",
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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function existingTimezoneFields(schedule) {
  const fields = [];
  const add = (container, key, field) => {
    if (!isObjectRecord(container) || !hasOwn(container, key)) return;
    const timezone = normalizeOptionalString(container[key]);
    fields.push({ container, key, field, timezone });
  };
  add(schedule, "timezone", "definition.timezone");
  add(schedule.schedule_rule, "timezone", "definition.schedule_rule.timezone");
  add(schedule.metadata, "timezone", "definition.metadata.timezone");
  add(
    schedule.metadata?.schedule_rule,
    "timezone",
    "definition.metadata.schedule_rule.timezone"
  );
  return fields;
}

function buildPortableTimezoneCorrection({
  agentFolder,
  schedule,
  fields,
  filePath,
  hostTimezone,
  source,
}) {
  const mismatched = fields.find((field) => field.timezone !== hostTimezone);
  const firstKnown = fields.find((field) => field.timezone);
  const oldTimezone = mismatched?.timezone || firstKnown?.timezone || null;
  const timePreserved =
    normalizeOptionalString(schedule.schedule_rule?.time) ||
    normalizeOptionalString(schedule.metadata?.schedule_rule?.time) ||
    normalizeOptionalString(schedule.schedule_rule?.at) ||
    null;
  return {
    agent_folder: agentFolder,
    schedule_id: normalizeOptionalString(schedule.id) || null,
    old_timezone: oldTimezone,
    host_timezone: hostTimezone,
    time_preserved: timePreserved,
    portable_file_path: filePath,
    source,
    message: `Portable scheduler timezone normalized from ${
      oldTimezone || "unspecified"
    } to ${hostTimezone}; scheduled time preserved as ${
      timePreserved || "absolute timestamp"
    }.`,
  };
}

function recomputePortableNextRunAtForHost(schedule, { hostTimezone, now }) {
  if (!hasOwn(schedule, "next_run_at")) return schedule.next_run_at;
  if (!isObjectRecord(schedule.schedule_rule)) return schedule.next_run_at;
  const hostRule = { ...schedule.schedule_rule, timezone: hostTimezone };
  const normalizedRule = normalizeScheduleRule(hostRule, {
    timezone: hostTimezone,
  });
  if (normalizedRule.type === "once") {
    return normalizeOptionalString(schedule.next_run_at) || normalizedRule.at;
  }
  return computeNextScheduleRunAt(normalizedRule, {
    after: now,
    timezone: hostTimezone,
  });
}

export function normalizePortableSchedulerDefinitionsToHostTimezone(
  agentFolder,
  {
    hostTimezone = getHostSystemTimezone(),
    source = "browser_root_portable_scheduler_import",
    now = null,
    clock = () => new Date(),
  } = {}
) {
  const realFolder = realpathSync(
    normalizeRequiredString(agentFolder, "agentFolder")
  );
  const normalizedHostTimezone = normalizeScheduleRule(
    { type: "daily", time: "00:00", timezone: hostTimezone },
    { timezone: hostTimezone }
  ).timezone;
  const filePath = getPortableSchedulersJsonPath(realFolder);
  const payload = readPortableFile(filePath);
  const correctionTime = nowIso(now === null ? clock : () => now);
  let changed = false;
  const corrections = [];
  const schedulers = payload.schedulers.map((entry) => {
    if (!isObjectRecord(entry)) return entry;
    const schedule = deepCloneJson(entry, "portable scheduler definition");
    const fields = existingTimezoneFields(schedule);
    const mismatched = fields.filter(
      (field) => field.timezone !== normalizedHostTimezone
    );
    if (mismatched.length === 0) return schedule;

    for (const field of fields) {
      if (field.timezone !== normalizedHostTimezone) {
        field.container[field.key] = normalizedHostTimezone;
      }
    }
    if (hasOwn(schedule, "next_run_at")) {
      schedule.next_run_at = recomputePortableNextRunAtForHost(schedule, {
        hostTimezone: normalizedHostTimezone,
        now: correctionTime,
      });
    }
    schedule.updated_at = correctionTime;
    corrections.push(
      buildPortableTimezoneCorrection({
        agentFolder: realFolder,
        schedule,
        fields,
        filePath,
        hostTimezone: normalizedHostTimezone,
        source,
      })
    );
    changed = true;
    return schedule;
  });
  if (changed) {
    writePortableFile(filePath, {
      ...payload,
      schedulers,
    });
  }
  return {
    status: changed
      ? "portable_scheduler_timezone_normalized"
      : "portable_scheduler_timezone_already_host",
    agent_folder: realFolder,
    portable_file_path: filePath,
    host_timezone: normalizedHostTimezone,
    scheduler_count: payload.schedulers.length,
    corrected_count: corrections.length,
    corrections,
    changed,
  };
}

function normalizeBrowserRootProjectEntry(entry) {
  if (!isObjectRecord(entry)) {
    throw new Error("Browser Root project entry must be an object");
  }
  const projectId = normalizeRequiredString(entry.project_id, "project_id");
  const agentFolder = normalizeRequiredString(
    entry.agent_folder,
    "agent_folder"
  );
  return {
    project_id: projectId,
    agent_folder: agentFolder,
  };
}

export class PortableSchedulerDefinitionStore {
  constructor({
    runtimeStore,
    getBrowserRootProjects = () => [],
    getProjectIndexGeneration = () => null,
    clock = () => new Date(),
  } = {}) {
    if (!runtimeStore) {
      throw new Error("PortableSchedulerDefinitionStore requires runtimeStore");
    }
    this.runtimeStore = runtimeStore;
    this.getBrowserRootProjects = getBrowserRootProjects;
    this.getProjectIndexGeneration = getProjectIndexGeneration;
    this.clock = clock;
    this.cachedSchedules = null;
    this.cachedProjectIndexGeneration = null;
  }

  now() {
    return nowIso(this.clock);
  }

  invalidateScheduleCache() {
    this.cachedSchedules = null;
    this.cachedProjectIndexGeneration = null;
  }

  getBrowserRootProjectFolders() {
    const candidates = (this.getBrowserRootProjects() || []).map(
      normalizeBrowserRootProjectEntry
    );
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

  assertBrowserRootProjectFolder(agentFolder) {
    const realFolder = realpathSync(
      normalizeRequiredString(agentFolder, "agentFolder")
    );
    const knownFolders = this.getBrowserRootProjectFolders();
    if (!knownFolders.some((entry) => entry.agent_folder === realFolder)) {
      throw new Error("scheduler_agent_folder_not_host_known");
    }
    return realFolder;
  }

  readDefinitionsForFolder(agentFolder, { tolerateInvalid = false } = {}) {
    const realFolder = realpathSync(
      normalizeRequiredString(agentFolder, "agentFolder")
    );
    const filePath = getPortableSchedulersJsonPath(realFolder);
    const now = this.now();
    let payload;
    try {
      payload = readPortableFile(filePath);
    } catch (err) {
      if (!tolerateInvalid) throw err;
      return [
        buildInvalidPortableScheduleDefinition({}, {
          now,
          error: err,
          index: 0,
          filePath,
          agentFolder: realFolder,
        }),
      ];
    }
    return payload.schedulers.map((entry, index) => {
      try {
        return normalizePortableScheduleForFile(entry, {
          now,
          agentFolder: realFolder,
        });
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
    const realFolder = this.assertBrowserRootProjectFolder(agentFolder);
    const filePath = getPortableSchedulersJsonPath(realFolder);
    writePortableFile(filePath, {
      version: PORTABLE_SCHEDULER_FILE_VERSION,
      schedulers: definitions.map(serializePortableScheduleForFile),
    });
    this.invalidateScheduleCache();
    return filePath;
  }

  normalizeDefinitionsForFolderToHostTimezone(
    agentFolder,
    {
      hostTimezone = getHostSystemTimezone(),
      source = "browser_root_portable_scheduler_import",
    } = {}
  ) {
    const result = normalizePortableSchedulerDefinitionsToHostTimezone(
      agentFolder,
      {
        hostTimezone,
        source,
        clock: this.clock,
      }
    );
    if (result.changed) this.invalidateScheduleCache();
    return result;
  }

  normalizeBrowserRootPortableSchedulersToHostTimezone({
    hostTimezone = getHostSystemTimezone(),
    source = "browser_root_portable_scheduler_import",
  } = {}) {
    const projects = this.getBrowserRootProjectFolders();
    const results = [];
    const corrections = [];
    let schedulerCount = 0;
    for (const project of projects) {
      const result = this.normalizeDefinitionsForFolderToHostTimezone(
        project.agent_folder,
        { hostTimezone, source }
      );
      schedulerCount += result.scheduler_count;
      corrections.push(...result.corrections);
      results.push({
        project_id: project.project_id,
        agent_folder: project.agent_folder,
        portable_file_path: result.portable_file_path,
        scheduler_count: result.scheduler_count,
        corrected_count: result.corrected_count,
        status: result.status,
      });
    }
    return {
      status:
        corrections.length > 0
          ? "browser_root_portable_scheduler_timezone_normalized"
          : "browser_root_portable_scheduler_timezone_already_host",
      host_timezone: normalizeScheduleRule(
        { type: "daily", time: "00:00", timezone: hostTimezone },
        { timezone: hostTimezone }
      ).timezone,
      project_count: projects.length,
      scheduler_count: schedulerCount,
      corrected_count: corrections.length,
      corrections,
      results,
    };
  }

  buildPortableHash(definition) {
    return hashPortableScheduleDefinition({
      id: definition.id,
      agent_id: definition.agent_id,
      command_text: definition.command_text,
      enabled: definition.enabled,
      schedule_rule: definition.schedule_rule,
      setup_snapshot:
        definition.portable_setup_snapshot || definition.setup_snapshot,
      metadata: definition.metadata,
    });
  }

  definitionToSchedule(definition, { agentFolder } = {}) {
    const portableHash = this.buildPortableHash(definition);
    const runtimeState =
      this.runtimeStore.ensurePortableScheduleRuntimeState({
        scheduleId: definition.id,
        agentFolder,
        portableHash,
      });
    const effectiveEnabled = definition.enabled === true;
    const normalizedRule = normalizeScheduleRule(definition.schedule_rule, {
      timezone: definition.timezone || definition.schedule_rule?.timezone,
    });
    const status =
      definition.metadata?.portable_scheduler_validation_failed === true
        ? definition.status
        : !effectiveEnabled
        ? "paused"
        : runtimeState.runtime_status === "stopped" ||
          runtimeState.runtime_status === "failed"
        ? runtimeState.runtime_status
        : "active";
    const nextRunAt =
      status === "active"
        ? runtimeState.next_run_at ||
          computeNextScheduleRunAt(normalizedRule, {
            after: runtimeState.first_discovered_at,
            timezone: normalizedRule.timezone,
          })
        : null;
    const availabilityState = effectiveEnabled ? "active" : "paused";
    const availabilityReason = effectiveEnabled
      ? "Browser Root portable scheduler is enabled"
      : "Browser Root portable scheduler is disabled";
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
      next_run_at: nextRunAt,
      availability_state: availabilityState,
      availability_reason: availabilityReason,
      metadata: {
        ...definition.metadata,
        source: "browser_root_project_schedulers_json",
        schedule_rule: normalizedRule,
        timezone: normalizedRule.timezone,
        target_binding: {
          kind: "setup_snapshot",
          agent_id: definition.agent_id,
          setup_snapshot: definition.setup_snapshot,
        },
        target_binding_scope: "portable_setup_snapshot",
        missed_run_policy: "skip_without_catch_up",
        catch_up_burst: false,
        p12_5_scheduler_tab: true,
        setup_snapshot_copied: true,
        source_session_references_present: false,
        storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
        runtime_state_owner: PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
        portable_agent_folder: agentFolder,
        portable_schedulers_json_path: getPortableSchedulersJsonPath(agentFolder),
        portable_definition_hash: portableHash,
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
    const projectIndexGeneration = this.getProjectIndexGeneration();
    if (
      projectIndexGeneration !== null &&
      this.cachedSchedules &&
      this.cachedProjectIndexGeneration === projectIndexGeneration
    ) {
      return deepCloneJson(this.cachedSchedules, "cached portable schedules");
    }
    const schedules = [];
    for (const entry of this.getBrowserRootProjectFolders()) {
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
    const sortedSchedules = schedules.sort((a, b) => {
      const aNext = a.next_run_at || "9999";
      const bNext = b.next_run_at || "9999";
      if (aNext !== bNext) return aNext.localeCompare(bNext);
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
    if (projectIndexGeneration !== null) {
      this.cachedProjectIndexGeneration = projectIndexGeneration;
      this.cachedSchedules = deepCloneJson(
        sortedSchedules,
        "portable schedules"
      );
    }
    return sortedSchedules;
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

  createSchedule(input, { agentFolder } = {}) {
    const now = this.now();
    const canonicalAgentFolder = this.assertBrowserRootProjectFolder(
      agentFolder
    );
    const definition = normalizePortableScheduleForFile(
      {
        ...input,
        id: input.id || randomUUID(),
        created_at: now,
        updated_at: now,
      },
      { now, agentFolder: canonicalAgentFolder }
    );
    const existing = this.readDefinitionsForFolder(canonicalAgentFolder);
    if (existing.some((entry) => entry.id === definition.id)) {
      throw new Error(`portable scheduler already exists: ${definition.id}`);
    }
    this.writeDefinitionsForFolder(canonicalAgentFolder, [
      ...existing,
      definition,
    ]);
    return this.definitionToSchedule(definition, {
      agentFolder: canonicalAgentFolder,
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
      { now, agentFolder }
    );
    const updatedFolder = agentFolder;
    definitions[index] = updated;
    this.writeDefinitionsForFolder(agentFolder, definitions);
    return this.definitionToSchedule(updated, {
      agentFolder: updatedFolder,
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
    this.runtimeStore.recordPortableScheduleDispatch({
      scheduleId,
      agentFolder,
      portableHash: schedule.metadata.portable_definition_hash,
      triggeredAt,
      nextRunAt,
      dispatchedMessageId,
      status,
    });
    this.invalidateScheduleCache();
    return this.getSchedule(scheduleId);
  }

  recordScheduleSkip(scheduleId, { triggeredAt, nextRunAt, status = null }) {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule) throw new Error("Host schedule not found");
    const agentFolder = schedule.metadata.portable_agent_folder;
    this.runtimeStore.recordPortableScheduleSkip({
      scheduleId,
      agentFolder,
      portableHash: schedule.metadata.portable_definition_hash,
      triggeredAt,
      nextRunAt,
      status,
    });
    this.invalidateScheduleCache();
    return this.getSchedule(scheduleId);
  }
}
