import { createHash } from "crypto";
import { SchedulerStore } from "./scheduler-store.mjs";
import {
  PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
  PORTABLE_SCHEDULER_STORAGE_OWNER,
  PortableSchedulerDefinitionStore,
  normalizePortableSetupSnapshot,
} from "./portable-scheduler-definitions.mjs";
import {
  computeNextScheduleRunAt,
  getHostSystemTimezone,
  normalizeScheduleRule,
  serializeScheduleRuleForSummary,
} from "./scheduler-rule-model.mjs";
import {
  DEFAULT_HOST_APP_USER_ID,
  MAIL_CREATE_SCOPE,
} from "./mail-store.mjs";
import {
  SESSION_LOOP_DEFINITION_STORAGE_OWNER,
  SESSION_LOOP_DUE_DISPATCH_PATH,
  SESSION_LOOP_RUNTIME_OWNER,
  SessionLoopDefinitionService,
} from "./session-loop-definitions.mjs";

const SCHEDULER_LOOP_ACTIVE_REASON =
  "P12.2 in-session loop CLI dispatch is enabled";
const SCHEDULER_LOOP_GUI_PAUSED_REASON =
  "P12.3 in-session loop GUI row is disabled";
const SCHEDULER_BUSY_RECHECK_MS = 5000;
const LOOP_SCHEDULE_KIND = "loop_interval";
const HOST_SCHEDULE_KIND = "host_schedule";
const LOOP_SCHEDULER_USER_ID = "oysterun-scheduler";
const LOOP_SCHEDULER_NICKNAME = "Oysterun Loop";
const HOST_SCHEDULER_NICKNAME = "Oysterun Scheduler";
const HOST_SCHEDULE_ACTIVE_REASON =
  "P12.4 Host scheduler model runner is enabled";
const HOST_SCHEDULE_UI_PAUSED_REASON =
  "P12.5 Host scheduler UI row is disabled";
export const DEMOTED_LOOP_STOP_COMMAND_ERROR =
  "Legacy /stoploop is no longer a Loop command. Open Loop to enable, disable, or delete rows.";

const INTERVAL_UNITS_MS = Object.freeze({
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
});

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

function normalizeLoopPrompt(value) {
  return normalizeRequiredString(value, "loop prompt").replace(/\s+/g, " ");
}

function buildLoopCommandForParser({ intervalToken, prompt }) {
  return `/loop ${normalizeRequiredString(
    intervalToken,
    "loop interval"
  )} ${normalizeRequiredString(prompt, "loop prompt")}`;
}

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSchedulerMessageId(schedule, triggeredAt) {
  const digest = hashText(`${schedule.id}:${triggeredAt}`).slice(0, 32);
  return `scheduler_loop_${digest}`;
}

function buildHostScheduleMessageId(schedule, triggeredAt) {
  const digest = hashText(`host_schedule:${schedule.id}:${triggeredAt}`).slice(
    0,
    32
  );
  return `scheduler_host_${digest}`;
}

function normalizeDispatcherState(value) {
  if (!value || typeof value !== "object") {
    return {
      available: false,
      busy: true,
      reason: "scheduler_dispatcher_state_missing",
    };
  }
  return {
    available: value.available === true,
    busy: value.busy === true,
    reason:
      typeof value.reason === "string" && value.reason.trim()
        ? value.reason.trim()
        : null,
  };
}

function normalizeHostSchedulePrompt(value) {
  return normalizeRequiredString(value, "schedule prompt").replace(/\s+/g, " ");
}

function normalizeOptionalStringArray(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array when provided`);
  }
  return value.map((entry) => normalizeRequiredString(entry, fieldName));
}

function normalizeSessionSetupPayload(value) {
  if (value === null || value === undefined) return null;
  if (!isObjectRecord(value)) {
    throw new Error("session setup payload must be an object when provided");
  }
  const payload = {};
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
    const normalized = normalizeOptionalString(value[key]);
    if (normalized) payload[key] = normalized;
  }
  for (const key of [
    "allow_dangerously_skip_permissions",
    "dangerous_mode",
    "search_enabled",
    "image_input_enabled",
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      payload[key] = value[key] === true;
    }
  }
  const allowedPaths = normalizeOptionalStringArray(
    value.allowed_paths,
    "session setup allowed_paths"
  );
  if (allowedPaths) payload.allowed_paths = allowedPaths;
  if (isObjectRecord(value.runtime_capabilities)) {
    payload.runtime_capabilities = JSON.parse(
      JSON.stringify(value.runtime_capabilities)
    );
  }
  if (isObjectRecord(value.capabilities)) {
    payload.capabilities = JSON.parse(JSON.stringify(value.capabilities));
  }
  return Object.keys(payload).length > 0 ? payload : null;
}

function normalizeScheduleTargetBinding(
  value,
  { hostSessionId, agentId } = {}
) {
  if (!isObjectRecord(value)) {
    throw new Error("schedule target binding must be an object");
  }
  const kind = normalizeRequiredString(
    value.kind || value.type,
    "schedule target kind"
  );
  if (kind === "running_session") {
    return {
      kind,
      host_session_id: normalizeRequiredString(
        value.host_session_id || value.hostSessionId || hostSessionId,
        "running session target host_session_id"
      ),
      agent_id:
        normalizeOptionalString(value.agent_id || value.agentId) ||
        normalizeOptionalString(agentId),
    };
  }
  if (kind === "saved_session") {
    return {
      kind,
      host_session_id: normalizeOptionalString(
        value.host_session_id || value.hostSessionId || hostSessionId
      ),
      saved_session_id: normalizeRequiredString(
        value.saved_session_id || value.savedSessionId || value.session_id,
        "saved_session target saved_session_id"
      ),
      agent_id:
        normalizeOptionalString(value.agent_id || value.agentId) ||
        normalizeOptionalString(agentId),
      session_setup_payload: normalizeSessionSetupPayload(
        value.session_setup_payload || value.sessionSetupPayload
      ),
    };
  }
  if (kind === "session_setup_record") {
    const setupFields = isObjectRecord(value.session_setup_fields)
      ? value.session_setup_fields
      : {};
    return {
      kind,
      host_session_id: normalizeOptionalString(
        value.host_session_id || value.hostSessionId || hostSessionId
      ),
      session_setup_record_id: normalizeRequiredString(
        value.session_setup_record_id ||
          value.sessionSetupRecordId ||
          value.setup_id,
        "session_setup_record target id"
      ),
      agent_id:
        normalizeOptionalString(value.agent_id || value.agentId) ||
        normalizeOptionalString(agentId),
      session_setup_fields: {
        provider: normalizeOptionalString(setupFields.provider),
        model: normalizeOptionalString(setupFields.model),
        agent_folder: normalizeOptionalString(setupFields.agent_folder),
        permission_mode: normalizeOptionalString(setupFields.permission_mode),
        approval_policy: normalizeOptionalString(setupFields.approval_policy),
      },
      session_setup_payload: normalizeSessionSetupPayload(
        value.session_setup_payload || value.sessionSetupPayload
      ),
    };
  }
  if (kind === "setup_snapshot") {
    const setupSnapshot = normalizePortableSetupSnapshot(
      value.setup_snapshot || value.session_setup_payload
    );
    return {
      kind,
      agent_id:
        normalizeOptionalString(value.agent_id || value.agentId) ||
        normalizeOptionalString(agentId),
      setup_snapshot: setupSnapshot,
    };
  }
  throw new Error(`Unsupported schedule target kind: ${kind}`);
}

function getTargetScheduleHostSessionId(targetBinding) {
  return (
    targetBinding.host_session_id ||
    targetBinding.saved_session_id ||
    targetBinding.session_setup_record_id
  );
}

function serializeTargetBindingBoundary(targetBinding) {
  return {
    kind: targetBinding.kind,
    host_session_id_present: Boolean(targetBinding.host_session_id),
    saved_session_id_present: Boolean(targetBinding.saved_session_id),
    session_setup_record_id_present: Boolean(
      targetBinding.session_setup_record_id
    ),
    session_setup_fields_present: Boolean(targetBinding.session_setup_fields),
    session_setup_payload_present: Boolean(targetBinding.session_setup_payload),
    setup_snapshot_present: Boolean(targetBinding.setup_snapshot),
    session_setup_payload_redacted: Boolean(
      targetBinding.session_setup_payload
    ),
    setup_snapshot_redacted: Boolean(targetBinding.setup_snapshot),
    raw_target_binding_redacted: true,
    cross_session_data: false,
  };
}

function addRedactionToken(tokens, value) {
  const normalized = normalizeOptionalString(value);
  if (normalized) tokens.add(normalized);
}

function collectRedactionTokensFromValue(tokens, value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRedactionTokensFromValue(tokens, entry);
    }
    return;
  }
  if (isObjectRecord(value)) {
    for (const entry of Object.values(value)) {
      collectRedactionTokensFromValue(tokens, entry);
    }
    return;
  }
  addRedactionToken(tokens, value);
}

function collectHostScheduleRedactionTokens(
  schedule,
  targetBinding,
  inputText
) {
  const tokens = new Set();
  addRedactionToken(tokens, schedule.host_session_id);
  addRedactionToken(tokens, targetBinding.host_session_id);
  addRedactionToken(tokens, targetBinding.saved_session_id);
  addRedactionToken(tokens, targetBinding.session_setup_record_id);
  addRedactionToken(tokens, targetBinding.agent_id);
  addRedactionToken(tokens, inputText);
  if (isObjectRecord(targetBinding.session_setup_fields)) {
    for (const value of Object.values(targetBinding.session_setup_fields)) {
      addRedactionToken(tokens, value);
    }
  }
  collectRedactionTokensFromValue(tokens, targetBinding.session_setup_payload);
  collectRedactionTokensFromValue(tokens, targetBinding.setup_snapshot);
  return [...tokens].sort((a, b) => b.length - a.length);
}

function redactHostScheduleTextForApi(value, tokens) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  let redacted = normalized;
  for (const token of tokens) {
    redacted = redacted.split(token).join("[redacted]");
  }
  return redacted;
}

function redactTextForTokens(value, tokens) {
  let redacted = String(value || "");
  for (const token of tokens || []) {
    if (!token) continue;
    redacted = redacted.split(token).join("[redacted]");
  }
  return redacted;
}

function computeDurationMs(startedAt, completedAt) {
  const started = Date.parse(startedAt || "");
  const completed = Date.parse(completedAt || "");
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  return Math.max(0, completed - started);
}

function getHostScheduleRunOutcome(run) {
  if (!run) return null;
  const metadata = isObjectRecord(run.metadata) ? run.metadata : {};
  if (typeof metadata.outcome === "string" && metadata.outcome.trim()) {
    return metadata.outcome.trim();
  }
  const exitCode = Number.isInteger(metadata.provider_exit_code)
    ? metadata.provider_exit_code
    : null;
  if (run.status === "failed") return "failed";
  if (run.status === "skipped") return "skipped";
  if (exitCode === 0) return "success";
  return run.status || null;
}

function buildProviderRunMetadata({
  providerRun,
  triggerType,
  targetBinding,
  fallbackLogSummary,
  extra = {},
}) {
  const exitCode = Number.isInteger(providerRun?.exit_code)
    ? providerRun.exit_code
    : null;
  const signal = normalizeOptionalString(providerRun?.signal);
  const outcome =
    providerRun?.ok === true && exitCode === 0 ? "success" : "failed";
  const startedAt = normalizeOptionalString(providerRun?.started_at);
  const completedAt = normalizeOptionalString(providerRun?.completed_at);
  return {
    ...extra,
    trigger_type: triggerType,
    outcome,
    target_kind: targetBinding?.kind || null,
    provider: providerRun?.provider || null,
    provider_command: providerRun?.command_label || null,
    provider_exit_code: exitCode,
    provider_signal: signal,
    provider_started_at: startedAt,
    provider_completed_at: completedAt,
    duration_ms: computeDurationMs(startedAt, completedAt),
    log_summary:
      providerRun?.log_summary ||
      fallbackLogSummary ||
      "Host scheduler direct provider run finished",
    ...(outcome === "failed"
      ? {
          error_summary:
            providerRun?.error_summary ||
            providerRun?.log_summary ||
            signal ||
            "scheduler_direct_provider_run_failed",
        }
      : {}),
  };
}

function serializeHostScheduleSessionBoundary(schedule) {
  return {
    host_session_id_present: Boolean(schedule.host_session_id),
    host_session_id_redacted: Boolean(schedule.host_session_id),
    raw_host_session_id_returned: false,
  };
}

function serializeHostScheduleAgentBoundary(schedule) {
  return {
    agent_id_present: Boolean(schedule.agent_id),
    agent_id_redacted: Boolean(schedule.agent_id),
    raw_agent_id_returned: false,
  };
}

function getScheduleRuleFromMetadata(schedule) {
  const metadata = isObjectRecord(schedule.metadata) ? schedule.metadata : {};
  if (!isObjectRecord(metadata.schedule_rule)) {
    throw new Error("Host schedule is missing schedule_rule metadata");
  }
  return metadata.schedule_rule;
}

function getTargetBindingFromMetadata(schedule) {
  const metadata = isObjectRecord(schedule.metadata) ? schedule.metadata : {};
  if (!isObjectRecord(metadata.target_binding)) {
    throw new Error("Host schedule is missing target_binding metadata");
  }
  return metadata.target_binding;
}

function getHostScheduleTargetProvider(targetBinding) {
  if (!isObjectRecord(targetBinding)) return null;
  const setupSnapshot = isObjectRecord(targetBinding.setup_snapshot)
    ? targetBinding.setup_snapshot
    : {};
  const setupPayload = isObjectRecord(targetBinding.session_setup_payload)
    ? targetBinding.session_setup_payload
    : {};
  const setupFields = isObjectRecord(targetBinding.session_setup_fields)
    ? targetBinding.session_setup_fields
    : {};
  return normalizeOptionalString(
    setupSnapshot.provider || setupPayload.provider || setupFields.provider
  );
}

function hostScheduleUsesSessionRuntime(targetBinding) {
  return (
    targetBinding?.kind === "setup_snapshot" &&
    getHostScheduleTargetProvider(targetBinding) === "claude"
  );
}

function getHostScheduleDispatchPlan(targetBinding) {
  const sessionRuntime = hostScheduleUsesSessionRuntime(targetBinding);
  return {
    sessionRuntime,
    methodName: sessionRuntime
      ? "dispatchHostScheduleSessionRuntime"
      : "dispatchHostScheduleDirect",
    pendingPath: sessionRuntime
      ? "schedulerSessionRuntime.pending"
      : "schedulerDirectProviderRunner.pending",
    defaultPath: sessionRuntime
      ? "schedulerSessionRuntime.acp-session"
      : "schedulerDirectProviderRunner.direct",
    unavailableReason: sessionRuntime
      ? "scheduler_session_runtime_dispatcher_unavailable"
      : "scheduler_direct_provider_runner_unavailable",
    unavailableLogSummary: sessionRuntime
      ? "Host scheduler ACP session runtime dispatcher unavailable; no immediate retry"
      : "Host scheduler direct provider runner unavailable; no immediate retry",
  };
}

function getHostScheduleDispatchMetadata(plan, extra = {}) {
  return {
    ...(plan.sessionRuntime
      ? { session_runtime_run: true, direct_provider_run: false }
      : { direct_provider_run: true }),
    ...extra,
  };
}

function assertOutsideSchedulerTargetBindingAllowed(targetBinding) {
  if (targetBinding?.kind === "running_session") {
    throw new Error("outside_scheduler_running_session_target_forbidden");
  }
}

export function parseLoopCommandInput(inputText) {
  if (typeof inputText !== "string") return null;
  const trimmed = inputText.trim();
  if (!/^\/loop(?:\s|$)/i.test(trimmed)) return null;
  const rest = trimmed.replace(/^\/loop/i, "").trim();
  if (!rest) {
    throw new Error(
      "Invalid /loop command: expected /loop <interval> <prompt>"
    );
  }
  const intervalMatch = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  const intervalToken = intervalMatch?.[1]?.toLowerCase() || "";
  const promptText = intervalMatch?.[2]?.trim() || "";
  const parsedInterval = intervalToken.match(/^([1-9][0-9]*)([smhd])$/);
  if (!parsedInterval) {
    throw new Error(
      "Invalid /loop interval: use a positive integer with unit s, m, h, or d"
    );
  }
  if (!promptText) {
    throw new Error("Invalid /loop command: prompt is required");
  }
  const intervalValue = Number(parsedInterval[1]);
  const intervalUnit = parsedInterval[2];
  const intervalMs = intervalValue * INTERVAL_UNITS_MS[intervalUnit];
  const normalizedPrompt = normalizeLoopPrompt(promptText);
  return {
    command: "loop",
    interval_token: `${intervalValue}${intervalUnit}`,
    interval_value: intervalValue,
    interval_unit: intervalUnit,
    interval_ms: intervalMs,
    prompt: promptText,
    normalized_command: normalizedPrompt,
    normalized_input: `/loop ${intervalValue}${intervalUnit} ${normalizedPrompt}`,
    prompt_sha256: hashText(normalizedPrompt),
    prompt_length: normalizedPrompt.length,
  };
}

export function isDemotedLoopStopCommandInput(inputText) {
  if (typeof inputText !== "string") return false;
  return /^\/stoploop(?:\s|$)/i.test(inputText.trim());
}

export function buildDemotedLoopStopCommandResponse() {
  return {
    status: "scheduler_loop_stop_demoted",
    error: DEMOTED_LOOP_STOP_COMMAND_ERROR,
    scheduler_command: "stoploop",
    scheduler_command_demoted: true,
    product_stop_semantics: false,
    canonical_stop_path: "scheduler_row_toggle_delete",
    dispatch_queued: false,
    provider_delivery_attempted: false,
    schedule_created: false,
    browser_scheduler_timer_used: false,
    host_owned_scheduler_db: false,
    storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
    runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
  };
}

export class SchedulerService {
  constructor({
    store = new SchedulerStore(),
    mailStore = null,
    getHostOrigin = () => null,
    getKnownAgentFolders = () => [],
    portableDefinitionStore = null,
    clock = () => new Date(),
    recheckMs = SCHEDULER_BUSY_RECHECK_MS,
    sessionLoopService = new SessionLoopDefinitionService({
      clock,
      recheckMs,
    }),
  } = {}) {
    this.store = store;
    this.portableDefinitionStore =
      portableDefinitionStore ||
      new PortableSchedulerDefinitionStore({
        runtimeStore: store,
        getKnownAgentFolders,
        clock,
      });
    this.mailStore = mailStore;
    this.sessionLoopService = sessionLoopService;
    this.getHostOrigin = getHostOrigin;
    this.clock = clock;
    this.recheckMs = recheckMs;
  }

  initialize() {
    this.store.initialize();
    return this;
  }

  close() {
    this.store.close();
    this.mailStore?.close?.();
  }

  snapshotSessionLoopRestartState() {
    return this.sessionLoopService.snapshotHostRestartRuntimeState();
  }

  restoreSessionLoopRestartState(snapshot = {}, opts = {}) {
    return this.sessionLoopService.restoreHostRestartRuntimeState(snapshot, opts);
  }

  snapshotHostRestartState() {
    this.initialize();
    const activeRuns = [];
    for (const schedule of this.portableDefinitionStore.listSchedules()) {
      const runs = this.store.listScheduleRuns(schedule.id);
      for (const run of runs) {
        if (run.status !== "claimed") continue;
        activeRuns.push({
          schedule_id: schedule.id,
          run_id: run.id,
          status: run.status,
          claimed_at: run.claimed_at,
          scheduled_for: run.scheduled_for,
          target_kind:
            run.metadata?.target_kind ||
            schedule.metadata?.target_binding?.kind ||
            null,
          storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
          runtime_state_owner: PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
          restore_policy: "mark_interrupted_no_duplicate_dispatch",
        });
      }
    }
    return {
      storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
      runtime_state_owner: PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
      parallel_scheduler_store: false,
      active_runs: activeRuns,
    };
  }

  markHostRestartInterruptedRuns({ restartId = null, interruptedAt = null } = {}) {
    this.initialize();
    const timestamp = interruptedAt || nowIso(this.clock);
    const interrupted = [];
    for (const schedule of this.portableDefinitionStore.listSchedules()) {
      const runs = this.store.listScheduleRuns(schedule.id);
      for (const run of runs) {
        if (run.status !== "claimed") continue;
        const nextRunAt = schedule.next_run_at || null;
        const updated = this.store.updateScheduleRun(run.id, {
          completedAt: timestamp,
          status: "failed",
          dispatchedMessageId: run.dispatched_message_id || null,
          error:
            "Host restarted during scheduler run; run was interrupted and not replayed.",
          metadata: {
            ...(run.metadata || {}),
            outcome: "interrupted",
            interrupted_by: "host_restart_restore",
            restart_id: restartId,
            interrupted_at: timestamp,
            prompt_replay: false,
            duplicate_dispatch_prevented: true,
            next_run_at: nextRunAt,
          },
        });
        this.recordHostScheduleProviderRunLog(updated, {
          ok: false,
          completed_at: timestamp,
          log_summary:
            "Host restart restore marked active scheduler run interrupted; no prompt replay.",
          error_summary: "host_restart_interrupted_scheduler_run",
          stdout: "",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        });
        interrupted.push({
          schedule_id: schedule.id,
          run_id: run.id,
          status: updated.status,
          restart_id: restartId,
          duplicate_dispatch_prevented: true,
        });
      }
    }
    return { interrupted, interrupted_at: timestamp };
  }

  getAvailabilityContract() {
    return {
      available: true,
      state: "p12_4_host_scheduler_model_enabled",
      reason: HOST_SCHEDULE_ACTIVE_REASON,
      parser_ready: true,
      dispatch_ready: true,
      p12_1_store_service_skeleton: true,
      p12_2_loop_cli_dispatch: true,
      p12_3_gui: true,
      p12_4_final_schedule_model: true,
      p12_5_scheduler_tab: true,
    };
  }

  createSkeletonSchedule({
    hostSessionId,
    agentId,
    createdBy = "oysterun-host",
    inputText,
    metadata = null,
  }) {
    this.initialize();
    return this.store.createSchedule({
      hostSessionId,
      agentId,
      createdBy,
      inputText,
      metadata,
      scheduleKind: "p12_1_skeleton_stub",
      status: "draft",
      availabilityState: "skeleton_only",
      availabilityReason:
        "P12.2 loop parser and dispatch semantics are not implemented",
    });
  }

  createOrEnableLoopFromInput({
    hostSessionId,
    agentId,
    agentFolder,
    createdBy = "oysterun-host",
    inputText,
  }) {
    const parsed = parseLoopCommandInput(inputText);
    if (!parsed) return null;
    const result = this.sessionLoopService.createOrEnableFromParsed({
      hostSessionId,
      agentId,
      agentFolder,
      createdBy,
      parsed,
    });
    return {
      ...result,
      parsed: this.serializeParsedCommand(parsed),
    };
  }

  listSchedulesForSession(hostSessionId) {
    this.initialize();
    return this.store
      .listSchedulesForSession(hostSessionId)
      .map((schedule) => this.serializeSchedule(schedule));
  }

  listSessionLoopSchedulesForGui({ hostSessionId, agentId, agentFolder }) {
    return this.sessionLoopService.listDefinitionsForGui({
      hostSessionId,
      agentId,
      agentFolder,
    });
  }

  createSessionLoopScheduleForGui({
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
    return this.sessionLoopService.createDefinitionForGui({
      hostSessionId,
      agentId,
      agentFolder,
      createdBy,
      interval,
      prompt,
      startAt,
      endAt,
      enabled,
    });
  }

  updateSessionLoopScheduleForGui({
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
    return this.sessionLoopService.updateDefinitionForGui({
      hostSessionId,
      agentId,
      agentFolder,
      scheduleId,
      interval,
      prompt,
      startAt,
      endAt,
      enabled,
      runtimeOnly,
    });
  }

  deleteSessionLoopScheduleForGui({ hostSessionId, agentId, agentFolder, scheduleId }) {
    return this.sessionLoopService.deleteDefinitionForGui({
      hostSessionId,
      agentId,
      agentFolder,
      scheduleId,
    });
  }

  clearSessionLoopRuntimeState({ hostSessionId, reason = "session_stop" }) {
    return this.sessionLoopService.clearRuntimeSession({
      hostSessionId,
      reason,
    });
  }

  buildGuiLoopMetadata({ parsed, startAt, endAt }) {
    return {
      source: "p12_3_session_loop_gui",
      parser: "p12_2_loop_cli",
      interval_token: parsed.interval_token,
      prompt_sha256: parsed.prompt_sha256,
      prompt_length: parsed.prompt_length,
      start_at: startAt,
      end_at: endAt,
      end_time_semantics: "p12_4_runner_expiry_pending",
    };
  }

  normalizeDashboardHostScheduleInput({
    targetBinding,
    hostSessionId = null,
    agentId,
    prompt,
    rule,
    timezone = getHostSystemTimezone(),
    enabled = true,
  }) {
    const normalizedRule = normalizeScheduleRule(rule, { timezone });
    const now = nowIso(this.clock);
    const nextRunAt = computeNextScheduleRunAt(normalizedRule, {
      after: now,
      timezone: normalizedRule.timezone,
    });
    if (!nextRunAt) {
      throw new Error("Host schedule must have a future next run");
    }
    assertOutsideSchedulerTargetBindingAllowed(targetBinding);
    const normalizedTargetBinding = normalizeScheduleTargetBinding(
      targetBinding,
      { hostSessionId, agentId }
    );
    assertOutsideSchedulerTargetBindingAllowed(normalizedTargetBinding);
    if (normalizedTargetBinding.kind !== "setup_snapshot") {
      throw new Error("outside_scheduler_requires_copied_setup_snapshot");
    }
    const normalizedAgentId = normalizeRequiredString(agentId, "agentId");
    const scheduleHostSessionId = `portable:${normalizedTargetBinding.setup_snapshot.agent_folder}`;
    const normalizedPrompt = normalizeHostSchedulePrompt(prompt);
    const active = enabled === true;
    return {
      hostSessionId: scheduleHostSessionId,
      agentId: normalizedAgentId,
      inputText: normalizedPrompt,
      normalizedCommand: normalizedPrompt,
      nextRunAt,
      status: active ? "active" : "paused",
      availabilityState: active ? "active" : "paused",
      availabilityReason: active
        ? HOST_SCHEDULE_ACTIVE_REASON
        : HOST_SCHEDULE_UI_PAUSED_REASON,
      metadata: {
        source: "p12_5_host_scheduler_dashboard_ui",
        schedule_rule: normalizedRule,
        timezone: normalizedRule.timezone,
        host_timezone_source:
          "Intl.DateTimeFormat().resolvedOptions().timeZone",
        target_binding: normalizedTargetBinding,
        target_binding_scope: "portable_setup_snapshot",
        setup_snapshot_copied: true,
        source_session_references_present: false,
        storage_owner: PORTABLE_SCHEDULER_STORAGE_OWNER,
        runtime_state_owner: PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
        missed_run_policy: "skip_without_catch_up",
        catch_up_burst: false,
        p12_5_scheduler_tab: true,
        p12_5_session_setup_scheduler_action: true,
      },
      scheduleRuleSummary: serializeScheduleRuleForSummary(normalizedRule),
    };
  }

  createHostScheduleForDashboard({
    targetBinding,
    hostSessionId = null,
    agentId,
    createdBy = "oysterun-host",
    prompt,
    rule,
    timezone = getHostSystemTimezone(),
    enabled = true,
  }) {
    this.initialize();
    const normalized = this.normalizeDashboardHostScheduleInput({
      targetBinding,
      hostSessionId,
      agentId,
      prompt,
      rule,
      timezone,
      enabled,
    });
    const schedule = this.portableDefinitionStore.createSchedule({
      host_session_id: normalized.hostSessionId,
      agentId: normalized.agentId,
      agent_id: normalized.agentId,
      created_by: createdBy,
      command_text: normalized.inputText,
      normalized_command: normalized.normalizedCommand,
      next_run_at: normalized.nextRunAt,
      status: normalized.status,
      enabled: normalized.status === "active",
      schedule_rule: normalized.metadata.schedule_rule,
      timezone: normalized.metadata.timezone,
      setup_snapshot: normalized.metadata.target_binding.setup_snapshot,
      metadata: normalized.metadata,
    });
    return {
      status: "created",
      schedule: this.serializeHostScheduleForDashboardUi(schedule),
      schedule_rule: normalized.scheduleRuleSummary,
    };
  }

  updateHostScheduleForDashboard(input = {}) {
    const { scheduleId } = input;
    const existing = this.requireHostSchedule(scheduleId);
    const inputHas = (field) =>
      Object.prototype.hasOwnProperty.call(input, field);
    const existingTargetBinding = getTargetBindingFromMetadata(existing);
    const existingRule = getScheduleRuleFromMetadata(existing);
    const targetBinding = inputHas("targetBinding")
      ? input.targetBinding
      : existingTargetBinding;
    const hostSessionId = inputHas("hostSessionId")
      ? input.hostSessionId
      : existing.host_session_id || null;
    const agentId = inputHas("agentId") ? input.agentId : existing.agent_id;
    const prompt = inputHas("prompt") ? input.prompt : existing.input_text;
    const rule = inputHas("rule") ? input.rule : existingRule;
    const timezone = inputHas("timezone")
      ? input.timezone
      : existing.timezone || existingRule.timezone || getHostSystemTimezone();
    const enabledProvided = inputHas("enabled");
    const enabled = enabledProvided
      ? input.enabled === true
      : existing.status === "active";
    const normalized = this.normalizeDashboardHostScheduleInput({
      targetBinding,
      hostSessionId,
      agentId,
      prompt,
      rule,
      timezone,
      enabled,
    });
    const preserveNextRunAt =
      !inputHas("rule") &&
      !inputHas("timezone") &&
      typeof existing.next_run_at === "string" &&
      existing.next_run_at.trim();
    const nextRunAt = preserveNextRunAt
      ? existing.next_run_at
      : normalized.nextRunAt;
    const status = enabledProvided
      ? normalized.status
      : existing.status || normalized.status;
    const schedule = this.portableDefinitionStore.updateSchedule(existing.id, {
      host_session_id: normalized.hostSessionId,
      agentId: normalized.agentId,
      agent_id: normalized.agentId,
      command_text: normalized.inputText,
      normalized_command: normalized.normalizedCommand,
      next_run_at: nextRunAt,
      status,
      enabled: status === "active",
      schedule_rule: normalized.metadata.schedule_rule,
      timezone: normalized.metadata.timezone,
      setup_snapshot: normalized.metadata.target_binding.setup_snapshot,
      metadata: normalized.metadata,
    });
    return {
      status: "updated",
      schedule: this.serializeHostScheduleForDashboardUi(schedule),
      schedule_rule: normalized.scheduleRuleSummary,
    };
  }

  deleteHostScheduleForDashboard({ scheduleId }) {
    const existing = this.requireHostSchedule(scheduleId);
    this.portableDefinitionStore.deleteSchedule(existing.id);
    return {
      status: "deleted",
      schedule_id: existing.id,
      schedule_kind: existing.schedule_kind,
    };
  }

  listHostSchedulesForDashboard() {
    this.initialize();
    return this.portableDefinitionStore
      .listSchedules()
      .map((schedule) => this.serializeHostScheduleForDashboardUi(schedule));
  }

  getHostScheduleForDashboard(scheduleId) {
    return this.serializeHostScheduleForDashboardUi(
      this.requireHostSchedule(scheduleId)
    );
  }

  listHostScheduleRunsForDashboard(scheduleId, { limit = 25 } = {}) {
    const schedule = this.requireHostSchedule(scheduleId);
    return this.store
      .listRecentScheduleRuns(schedule.id, { limit })
      .map((run) => this.serializeHostScheduleRunForDashboard(schedule, run));
  }

  getHostScheduleRunLogForDashboard({ scheduleId, runId }) {
    const schedule = this.requireHostSchedule(scheduleId);
    const run = this.store
      .listScheduleRuns(schedule.id)
      .find((candidate) => candidate.id === runId);
    if (!run) throw new Error("Scheduler run not found");
    const log = this.store.getScheduleRunLog({
      scheduleId: schedule.id,
      runId: run.id,
    });
    if (!log) throw new Error("Scheduler run log not found");
    return this.serializeHostScheduleRunLogForDashboard(schedule, run, log);
  }

  requireHostSchedule(scheduleId) {
    this.initialize();
    const schedule = this.portableDefinitionStore.getSchedule(scheduleId);
    if (!schedule || schedule.schedule_kind !== HOST_SCHEDULE_KIND) {
      throw new Error("Host schedule not found");
    }
    return schedule;
  }

  createHostSchedule({
    targetBinding,
    hostSessionId = null,
    agentId,
    createdBy = "oysterun-host",
    prompt,
    rule,
    timezone = getHostSystemTimezone(),
  }) {
    this.initialize();
    const normalized = this.normalizeDashboardHostScheduleInput({
      targetBinding,
      hostSessionId,
      agentId,
      prompt,
      rule,
      timezone,
      enabled: true,
    });
    const schedule = this.portableDefinitionStore.createSchedule({
      host_session_id: normalized.hostSessionId,
      agent_id: normalized.agentId,
      createdBy,
      created_by: createdBy,
      command_text: normalized.inputText,
      normalized_command: normalized.normalizedCommand,
      next_run_at: normalized.nextRunAt,
      status: normalized.status,
      enabled: true,
      schedule_rule: normalized.metadata.schedule_rule,
      timezone: normalized.metadata.timezone,
      setup_snapshot: normalized.metadata.target_binding.setup_snapshot,
      metadata: {
        ...normalized.metadata,
        source: "p72_portable_host_scheduler_model",
        p12_5_ui_pending: true,
      },
    });
    return {
      status: "created",
      schedule: this.serializeHostScheduleForApi(schedule),
      schedule_rule: normalized.scheduleRuleSummary,
    };
  }

  async drainDueSchedules({
    now = nowIso(this.clock),
    dispatcher,
    limit = 50,
  } = {}) {
    if (!dispatcher) {
      throw new Error("Scheduler dispatch requires dispatcher");
    }
    this.initialize();
    const dueLoopSchedules = this.sessionLoopService.listDueLoops({
      now,
      limit,
    });
    const dueHostSchedules = this.portableDefinitionStore
      .listDueSchedules(now, { limit })
      .filter((schedule) => schedule.schedule_kind === HOST_SCHEDULE_KIND)
      .slice(0, Math.max(0, limit - dueLoopSchedules.length));
    const hasHostSchedules = dueHostSchedules.length > 0;
    if (
      dueLoopSchedules.length > 0 &&
      typeof dispatcher.dispatchLoopMatrixEvent !== "function"
    ) {
      throw new Error(
        "Scheduler loop dispatch requires dispatchLoopMatrixEvent"
      );
    }
    if (
      dueLoopSchedules.length > 0 &&
      typeof dispatcher.getSessionState !== "function"
    ) {
      throw new Error("Scheduler loop dispatch requires getSessionState");
    }
    if (
      hasHostSchedules &&
      typeof dispatcher.dispatchHostScheduleDirect !== "function" &&
      typeof dispatcher.dispatchHostScheduleSessionRuntime !== "function"
    ) {
      throw new Error(
        "Host scheduler dispatch requires a provider runner or ACP session runtime dispatcher"
      );
    }
    const result = {
      due_count: dueLoopSchedules.length + dueHostSchedules.length,
      dispatched_count: 0,
      skipped_count: 0,
      failed_count: 0,
      runs: [],
      availability: this.getAvailabilityContract(),
    };
    for (const loopSchedule of dueLoopSchedules) {
      const run = await this.drainSingleSessionLoopDue(loopSchedule, {
        now,
        dispatcher,
      });
      result.runs.push(run);
      if (run.status === "dispatched") result.dispatched_count += 1;
      if (run.status === "skipped") result.skipped_count += 1;
      if (run.status === "failed") result.failed_count += 1;
    }
    for (const schedule of dueHostSchedules) {
      const run = await this.drainSingleDueSchedule(schedule, { now, dispatcher });
      result.runs.push(run);
      if (run.status === "dispatched") result.dispatched_count += 1;
      if (run.status === "skipped") result.skipped_count += 1;
      if (run.status === "failed") result.failed_count += 1;
    }
    return result;
  }

  async drainSingleDueSchedule(schedule, { now, dispatcher }) {
    if (schedule.schedule_kind === HOST_SCHEDULE_KIND) {
      return await this.drainSingleHostSchedule(schedule, { now, dispatcher });
    }
    return {
      status: "skipped",
      schedule_id: schedule?.id || null,
      reason: "p59_in_session_loop_db_rows_not_runtime_source",
      storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
      runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      host_owned_scheduler_db: false,
    };
  }

  async drainSingleSessionLoopDue(loopSchedule, { now, dispatcher }) {
    const { runtime, definition, state } = loopSchedule;
    const triggeredAt = normalizeRequiredString(now, "now");
    const serializedSchedule = this.sessionLoopService.serializeForFeedback({
      definition,
      runtime,
    });
    const sessionState = normalizeDispatcherState(
      dispatcher.getSessionState({
        sessionId: runtime.host_session_id,
        schedule: serializedSchedule,
      })
    );
    if (!sessionState.available || sessionState.busy) {
      const skipped = this.sessionLoopService.recordSkipped({
        runtime,
        definition,
        state,
        triggeredAt,
        reason: sessionState.reason || "session_busy",
      });
      return {
        status: "skipped",
        schedule_id: definition.id,
        next_run_at: skipped.next_run_at,
        recheck_ms: this.recheckMs,
        reason: skipped.last_error,
        storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
        runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      };
    }
    const messageId = buildSchedulerMessageId(definition, triggeredAt);
    try {
      const queuedMessage = await dispatcher.dispatchLoopMatrixEvent({
        sessionId: runtime.host_session_id,
        userId: LOOP_SCHEDULER_USER_ID,
        nickname: LOOP_SCHEDULER_NICKNAME,
        text: definition.command_text,
        messageId,
        schedule: serializedSchedule,
        triggeredAt,
      });
      const dispatchedMessageId =
        typeof queuedMessage?.id === "string" && queuedMessage.id.trim()
          ? queuedMessage.id.trim()
          : typeof queuedMessage?.message_id === "string" &&
            queuedMessage.message_id.trim()
          ? queuedMessage.message_id.trim()
          : typeof queuedMessage?.event_id === "string" &&
            queuedMessage.event_id.trim()
          ? queuedMessage.event_id.trim()
          : messageId;
      const nextRunAt = addMilliseconds(triggeredAt, definition.interval_ms);
      this.sessionLoopService.recordDispatched({
        runtime,
        definition,
        state,
        triggeredAt,
        nextRunAt,
        dispatchedMessageId,
      });
      return {
        status: "dispatched",
        schedule_id: definition.id,
        run_id: `runtime_${messageId}`,
        dispatched_message_id: dispatchedMessageId,
        next_run_at: nextRunAt,
        trigger_basis: "actual_trigger_time",
        host_dispatch_path: SESSION_LOOP_DUE_DISPATCH_PATH,
        matrix_event_id: queuedMessage?.event_id || null,
        matrix_room_id: queuedMessage?.matrix_room_id || null,
        storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
        runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      };
    } catch (err) {
      const failed = this.sessionLoopService.recordFailed({
        runtime,
        definition,
        state,
        triggeredAt,
        reason: err.message || String(err),
      });
      return {
        status: "failed",
        schedule_id: definition.id,
        error: failed.last_error,
        next_run_at: failed.next_run_at,
        storage_owner: SESSION_LOOP_DEFINITION_STORAGE_OWNER,
        runtime_state_owner: SESSION_LOOP_RUNTIME_OWNER,
      };
    }
  }

  async drainSingleHostSchedule(schedule, { now, dispatcher }) {
    const triggeredAt = normalizeRequiredString(now, "now");
    const targetBinding = getTargetBindingFromMetadata(schedule);
    assertOutsideSchedulerTargetBindingAllowed(targetBinding);
    const dispatchPlan = getHostScheduleDispatchPlan(targetBinding);
    const dispatchHostSchedule = dispatcher?.[dispatchPlan.methodName];
    if (typeof dispatchHostSchedule !== "function") {
      return this.recordHostScheduleFailedRun(schedule, {
        triggeredAt,
        reason: dispatchPlan.unavailableReason,
        logSummary: dispatchPlan.unavailableLogSummary,
      });
    }
    const messageId = buildHostScheduleMessageId(schedule, triggeredAt);
    const run = this.store.createScheduleRun({
      scheduleId: schedule.id,
      scheduledFor: schedule.next_run_at || triggeredAt,
      claimedAt: triggeredAt,
      status: "claimed",
      metadata: {
        trigger_type: "scheduled",
        outcome: "running",
        trigger_basis: "schedule_rule_after_actual_trigger_time",
        actual_triggered_at: triggeredAt,
        host_dispatch_path: dispatchPlan.pendingPath,
        target_kind: targetBinding.kind,
        live_run_row: true,
        ...getHostScheduleDispatchMetadata(dispatchPlan),
      },
    });
    const mailCapability = this.createRunScopedMailCapability({
      schedule,
      run,
      targetBinding,
      triggerType: "scheduled",
    });
    const claimedMetadata = {
      ...run.metadata,
      ...(mailCapability
        ? { mail_capability: mailCapability.metadata }
        : {}),
    };
    if (mailCapability) {
      this.store.updateScheduleRun(run.id, {
        status: "claimed",
        metadata: claimedMetadata,
      });
    }
    try {
      const providerRun = await dispatchHostSchedule.call(dispatcher, {
        schedule,
        targetBinding,
        text: schedule.input_text,
        messageId,
        mailCapability,
      });
      const safeProviderRun = this.redactProviderRunWithMailCapability(
        providerRun,
        mailCapability
      );
      if (safeProviderRun?.ok !== true) {
        const reason =
          safeProviderRun?.log_summary ||
          safeProviderRun?.error_summary ||
          (dispatchPlan.sessionRuntime
            ? "scheduler_session_runtime_run_failed"
            : "scheduler_direct_provider_run_failed");
        const nextRunAt = this.computeNextHostScheduleRun(schedule, triggeredAt);
        const statusAfter = nextRunAt ? "active" : "stopped";
        const failedRun = this.store.updateScheduleRun(run.id, {
          completedAt: safeProviderRun?.completed_at || triggeredAt,
          status: "failed",
          error: reason,
          metadata: {
            failure_reason: reason,
            ...(mailCapability
              ? { mail_capability: mailCapability.metadata }
              : {}),
            next_run_at: nextRunAt,
            missed_run_policy: "skip_without_catch_up",
            catch_up_burst: false,
            no_spin: true,
            ...buildProviderRunMetadata({
              providerRun: safeProviderRun,
              triggerType: "scheduled",
              targetBinding,
              fallbackLogSummary:
                dispatchPlan.sessionRuntime
                  ? "Host scheduler ACP session runtime dispatch failed; no spin retry"
                  : "Host scheduler direct provider run failed; no spin retry",
              extra: {
                ...getHostScheduleDispatchMetadata(dispatchPlan),
                missed_run_policy: "skip_without_catch_up",
                catch_up_burst: false,
                no_spin: true,
              },
            }),
          },
        });
        this.recordHostScheduleProviderRunLog(failedRun, safeProviderRun);
        this.recordHostScheduleSkip(schedule, {
          triggeredAt,
          nextRunAt,
          status: statusAfter,
        });
        return {
          status: "failed",
          schedule_id: schedule.id,
          run_id: failedRun.id,
          reason,
          next_run_at: nextRunAt,
          no_spin: true,
          catch_up_burst: false,
        };
      }
      const dispatchedMessageId =
        typeof safeProviderRun?.message_id === "string" &&
        safeProviderRun.message_id.trim()
          ? safeProviderRun.message_id.trim()
          : messageId;
      const nextRunAt = this.computeNextHostScheduleRun(schedule, triggeredAt);
      const statusAfter = nextRunAt ? "active" : "stopped";
      const completedRun = this.store.updateScheduleRun(run.id, {
        completedAt: safeProviderRun?.completed_at || triggeredAt,
        status: "dispatched",
        dispatchedMessageId,
        metadata: {
          trigger_basis: "schedule_rule_after_actual_trigger_time",
          actual_triggered_at: triggeredAt,
          next_run_at: nextRunAt,
          ...(mailCapability
            ? { mail_capability: mailCapability.metadata }
            : {}),
          host_dispatch_path:
            safeProviderRun.host_dispatch_path ||
            dispatchPlan.defaultPath,
          target_kind: targetBinding.kind,
          ...buildProviderRunMetadata({
            providerRun: safeProviderRun,
            triggerType: "scheduled",
            targetBinding,
            fallbackLogSummary:
              dispatchPlan.sessionRuntime
                ? "Dispatched Host schedule through ACP session runtime"
                : "Dispatched Host schedule through direct provider runner",
            extra: {
              ...getHostScheduleDispatchMetadata(dispatchPlan),
              missed_run_policy: "skip_without_catch_up",
              catch_up_burst: false,
            },
          }),
        },
      });
      this.recordHostScheduleProviderRunLog(completedRun, safeProviderRun);
      this.recordHostScheduleDispatch(schedule, {
        triggeredAt,
        nextRunAt,
        dispatchedMessageId,
        status: statusAfter,
      });
      return {
        status: "dispatched",
        schedule_id: schedule.id,
        run_id: completedRun.id,
        dispatched_message_id: dispatchedMessageId,
        next_run_at: nextRunAt,
        target_kind: targetBinding.kind,
        trigger_basis: "schedule_rule_after_actual_trigger_time",
        catch_up_burst: false,
      };
    } catch (err) {
      const reason = err.message || String(err);
      const nextRunAt = this.computeNextHostScheduleRun(schedule, triggeredAt);
      const statusAfter = nextRunAt ? "active" : "stopped";
      const failedRun = this.store.updateScheduleRun(run.id, {
        completedAt: triggeredAt,
        status: "failed",
        error: reason,
        metadata: {
          trigger_type: "scheduled",
          outcome: "failed",
          failure_reason: reason,
          ...(mailCapability
            ? { mail_capability: mailCapability.metadata }
            : {}),
          next_run_at: nextRunAt,
          missed_run_policy: "skip_without_catch_up",
          catch_up_burst: false,
          no_spin: true,
          target_kind: targetBinding.kind,
          host_dispatch_path: dispatchPlan.pendingPath,
          ...getHostScheduleDispatchMetadata(dispatchPlan),
          log_summary: "Host scheduler dispatch failed; no spin retry",
          error_summary: reason,
        },
      });
      this.recordHostScheduleProviderRunLog(failedRun, null);
      this.recordHostScheduleSkip(schedule, {
        triggeredAt,
        nextRunAt,
        status: statusAfter,
      });
      return {
        status: "failed",
        schedule_id: schedule.id,
        run_id: failedRun.id,
        reason,
        next_run_at: nextRunAt,
        no_spin: true,
        catch_up_burst: false,
      };
    }
  }

  async runHostScheduleTestForDashboard({
    scheduleId,
    dispatcher,
    now = nowIso(this.clock),
  }) {
    if (!dispatcher) {
      throw new Error("Scheduler test run requires dispatcher");
    }
    const schedule = this.requireHostSchedule(scheduleId);
    assertOutsideSchedulerTargetBindingAllowed(
      getTargetBindingFromMetadata(schedule)
    );
    const triggeredAt = normalizeRequiredString(now, "now");
    const targetBinding = getTargetBindingFromMetadata(schedule);
    const dispatchPlan = getHostScheduleDispatchPlan(targetBinding);
    const dispatchHostSchedule = dispatcher?.[dispatchPlan.methodName];
    if (typeof dispatchHostSchedule !== "function") {
      throw new Error(
        dispatchPlan.sessionRuntime
          ? "Scheduler test run requires ACP session runtime dispatcher"
          : "Scheduler test run requires direct provider runner"
      );
    }
    const messageId = buildHostScheduleMessageId(schedule, triggeredAt);
    const run = this.store.createScheduleRun({
      scheduleId: schedule.id,
      scheduledFor: schedule.next_run_at || triggeredAt,
      claimedAt: triggeredAt,
      status: "claimed",
      metadata: {
        source: "p12_5_dashboard_run_now_test_run",
        trigger_type: "manual_test",
        outcome: "running",
        trigger_basis: "manual_dashboard_test_run",
        actual_triggered_at: triggeredAt,
        next_run_at_preserved: schedule.next_run_at,
        host_dispatch_path: dispatchPlan.pendingPath,
        target_kind: targetBinding.kind,
        ...getHostScheduleDispatchMetadata(dispatchPlan),
        bounded_test_run: true,
        live_run_row: true,
      },
    });
    const mailCapability = this.createRunScopedMailCapability({
      schedule,
      run,
      targetBinding,
      triggerType: "manual_test",
    });
    const claimedMetadata = {
      ...run.metadata,
      ...(mailCapability
        ? { mail_capability: mailCapability.metadata }
        : {}),
    };
    if (mailCapability) {
      this.store.updateScheduleRun(run.id, {
        status: "claimed",
        metadata: claimedMetadata,
      });
    }
    try {
      const providerRun = await dispatchHostSchedule.call(dispatcher, {
        schedule,
        targetBinding,
        text: schedule.input_text,
        messageId,
        mailCapability,
      });
      const safeProviderRun = this.redactProviderRunWithMailCapability(
        providerRun,
        mailCapability
      );
      if (safeProviderRun?.ok !== true) {
        const reason =
          safeProviderRun?.log_summary ||
          safeProviderRun?.error_summary ||
          (dispatchPlan.sessionRuntime
            ? "scheduler_session_runtime_run_failed"
            : "scheduler_direct_provider_run_failed");
        const failedRun = this.store.updateScheduleRun(run.id, {
          completedAt: safeProviderRun?.completed_at || triggeredAt,
          status: "failed",
          error: reason,
          metadata: {
            source: "p12_5_dashboard_run_now_test_run",
            failure_reason: reason,
            ...(mailCapability
              ? { mail_capability: mailCapability.metadata }
              : {}),
            next_run_at_preserved: schedule.next_run_at,
            missed_run_policy: "skip_without_catch_up",
            catch_up_burst: false,
            bounded_test_run: true,
            no_spin: true,
            ...buildProviderRunMetadata({
              providerRun: safeProviderRun,
              triggerType: "manual_test",
              targetBinding,
              fallbackLogSummary:
                dispatchPlan.sessionRuntime
                  ? "Host scheduler dashboard test run ACP session runtime dispatch failed; no spin retry"
                  : "Host scheduler dashboard test run direct provider run failed; no spin retry",
              extra: {
                ...getHostScheduleDispatchMetadata(dispatchPlan),
                bounded_test_run: true,
              },
            }),
          },
        });
        this.recordHostScheduleProviderRunLog(failedRun, safeProviderRun);
        this.recordHostScheduleSkip(schedule, {
          triggeredAt,
          nextRunAt: schedule.next_run_at,
        });
        return {
          status: "test_run_failed",
          schedule_id: schedule.id,
          run: {
            status: "failed",
            schedule_id: schedule.id,
            run_id: failedRun.id,
            reason,
            next_run_at_preserved: schedule.next_run_at,
            bounded_test_run: true,
            no_spin: true,
            catch_up_burst: false,
          },
          schedule: this.serializeHostScheduleForDashboardUi(
            this.requireHostSchedule(schedule.id)
          ),
          dispatch_queued: false,
          ...getHostScheduleDispatchMetadata(dispatchPlan),
          bounded_test_run: true,
        };
      }
      const dispatchedMessageId =
        typeof safeProviderRun?.message_id === "string" &&
        safeProviderRun.message_id.trim()
          ? safeProviderRun.message_id.trim()
          : messageId;
      const completedRun = this.store.updateScheduleRun(run.id, {
        completedAt: safeProviderRun?.completed_at || triggeredAt,
        status: "dispatched",
        dispatchedMessageId,
        metadata: {
          source: "p12_5_dashboard_run_now_test_run",
          trigger_basis: "manual_dashboard_test_run",
          actual_triggered_at: triggeredAt,
          next_run_at_preserved: schedule.next_run_at,
          ...(mailCapability
            ? { mail_capability: mailCapability.metadata }
            : {}),
          host_dispatch_path:
            safeProviderRun.host_dispatch_path ||
            dispatchPlan.defaultPath,
          target_kind: targetBinding.kind,
          ...buildProviderRunMetadata({
            providerRun: safeProviderRun,
            triggerType: "manual_test",
            targetBinding,
            fallbackLogSummary:
              dispatchPlan.sessionRuntime
                ? "Dashboard test run dispatched Host schedule through ACP session runtime"
                : "Dashboard test run dispatched Host schedule through direct provider runner",
            extra: {
              ...getHostScheduleDispatchMetadata(dispatchPlan),
              bounded_test_run: true,
            },
          }),
        },
      });
      this.recordHostScheduleProviderRunLog(completedRun, safeProviderRun);
      this.recordHostScheduleDispatch(schedule, {
        triggeredAt,
        nextRunAt: schedule.next_run_at,
        dispatchedMessageId,
      });
      return {
        status: "test_run_dispatched",
        schedule_id: schedule.id,
        run: {
          status: "dispatched",
          schedule_id: schedule.id,
          run_id: completedRun.id,
          dispatched_message_id: dispatchedMessageId,
          target_kind: targetBinding.kind,
          trigger_basis: "manual_dashboard_test_run",
          next_run_at_preserved: schedule.next_run_at,
          ...getHostScheduleDispatchMetadata(dispatchPlan),
          bounded_test_run: true,
        },
        schedule: this.serializeHostScheduleForDashboardUi(
          this.requireHostSchedule(schedule.id)
        ),
        dispatch_queued: true,
        ...getHostScheduleDispatchMetadata(dispatchPlan),
        bounded_test_run: true,
      };
    } catch (err) {
      const reason = err.message || String(err);
      const failedRun = this.store.updateScheduleRun(run.id, {
        completedAt: triggeredAt,
        status: "failed",
        error: reason,
        metadata: {
          source: "p12_5_dashboard_run_now_test_run",
          trigger_type: "manual_test",
          outcome: "failed",
          failure_reason: reason,
          ...(mailCapability
            ? { mail_capability: mailCapability.metadata }
            : {}),
          next_run_at_preserved: schedule.next_run_at,
          missed_run_policy: "skip_without_catch_up",
          catch_up_burst: false,
          bounded_test_run: true,
          no_spin: true,
          target_kind: targetBinding.kind,
          host_dispatch_path: dispatchPlan.pendingPath,
          ...getHostScheduleDispatchMetadata(dispatchPlan),
          log_summary:
            "Host scheduler dashboard test run dispatch failed; no spin retry",
          error_summary: reason,
        },
      });
      this.recordHostScheduleProviderRunLog(failedRun, null);
      this.recordHostScheduleSkip(schedule, {
        triggeredAt,
        nextRunAt: schedule.next_run_at,
      });
      return {
        status: "test_run_failed",
        schedule_id: schedule.id,
        run: {
          status: "failed",
          schedule_id: schedule.id,
          run_id: failedRun.id,
          reason,
          next_run_at_preserved: schedule.next_run_at,
          bounded_test_run: true,
          no_spin: true,
          catch_up_burst: false,
        },
        schedule: this.serializeHostScheduleForDashboardUi(
          this.requireHostSchedule(schedule.id)
        ),
        dispatch_queued: false,
        ...getHostScheduleDispatchMetadata(dispatchPlan),
        bounded_test_run: true,
      };
    }
  }

  recordHostScheduleTestFailure(
    schedule,
    { triggeredAt, reason, logSummary, providerRun = null }
  ) {
    const targetBinding = getTargetBindingFromMetadata(schedule);
    const run = this.store.createScheduleRun({
      scheduleId: schedule.id,
      scheduledFor: schedule.next_run_at || triggeredAt,
      claimedAt: triggeredAt,
      completedAt: triggeredAt,
      status: "failed",
      error: reason,
      metadata: {
        source: "p12_5_dashboard_run_now_test_run",
        failure_reason: reason,
        next_run_at_preserved: schedule.next_run_at,
        missed_run_policy: "skip_without_catch_up",
        catch_up_burst: false,
        bounded_test_run: true,
        no_spin: true,
        ...(providerRun
          ? buildProviderRunMetadata({
              providerRun,
              triggerType: "manual_test",
              targetBinding,
              fallbackLogSummary: logSummary,
              extra: {
                direct_provider_run: true,
                bounded_test_run: true,
              },
            })
          : {
              trigger_type: "manual_test",
              outcome: "failed",
              log_summary: logSummary,
              error_summary: reason,
            }),
      },
    });
    this.recordHostScheduleProviderRunLog(run, providerRun);
    this.recordHostScheduleSkip(schedule, {
      triggeredAt,
      nextRunAt: schedule.next_run_at,
    });
    return {
      status: "failed",
      schedule_id: schedule.id,
      run_id: run.id,
      reason,
      next_run_at_preserved: schedule.next_run_at,
      bounded_test_run: true,
      no_spin: true,
      catch_up_burst: false,
    };
  }

  createRunScopedMailCapability({ schedule, run, targetBinding, triggerType }) {
    if (!this.mailStore) return null;
    const hostOrigin = normalizeRequiredString(
      this.getHostOrigin(),
      "OYSTERUN_HOST_ORIGIN"
    );
    const { token, grant } = this.mailStore.createCapabilityGrant({
      grantKind: "scheduler_run",
      actorType: "scheduler",
      actorId: schedule.id,
      recipientUserId: DEFAULT_HOST_APP_USER_ID,
      scheduleId: schedule.id,
      scheduleRunId: run.id,
      agentId: schedule.agent_id,
      scopes: [MAIL_CREATE_SCOPE],
      constraints: {
        trigger_type: triggerType,
        target_kind: targetBinding?.kind || null,
      },
    });
    return {
      env: {
        OYSTERUN_HOST_ORIGIN: hostOrigin,
        OYSTERUN_CAPABILITY_TOKEN: token,
        OYSTERUN_MAIL_WRITE_TOKEN: token,
        OYSTERUN_SCHEDULE_ID: schedule.id,
        OYSTERUN_SCHEDULE_RUN_ID: run.id,
        OYSTERUN_AGENT_ID: schedule.agent_id,
      },
      redactionValues: [token],
      metadata: {
        grant_kind: grant.grant_kind,
        token_hash: grant.token_hash,
        scopes: grant.scopes,
        recipient_user_id: grant.recipient_user_id,
        schedule_id: grant.schedule_id,
        schedule_run_id: grant.schedule_run_id,
        agent_id: grant.agent_id,
        expires_at: grant.expires_at,
        env_vars: [
          "OYSTERUN_HOST_ORIGIN",
          "OYSTERUN_CAPABILITY_TOKEN",
          "OYSTERUN_MAIL_WRITE_TOKEN",
          "OYSTERUN_SCHEDULE_ID",
          "OYSTERUN_SCHEDULE_RUN_ID",
          "OYSTERUN_AGENT_ID",
        ],
        raw_token_returned: false,
        raw_token_persisted: false,
        env_token_redacted: true,
      },
    };
  }

  redactProviderRunWithMailCapability(providerRun, mailCapability) {
    if (!providerRun || !mailCapability?.redactionValues?.length) {
      return providerRun;
    }
    const tokens = mailCapability.redactionValues;
    return {
      ...providerRun,
      stdout: redactTextForTokens(providerRun.stdout, tokens),
      stderr: redactTextForTokens(providerRun.stderr, tokens),
      log_summary: redactTextForTokens(providerRun.log_summary, tokens),
      error_summary: redactTextForTokens(providerRun.error_summary, tokens),
      redacted_sensitive_env: true,
    };
  }

  computeNextHostScheduleRun(schedule, triggeredAt) {
    const rule = getScheduleRuleFromMetadata(schedule);
    return computeNextScheduleRunAt(rule, {
      after: triggeredAt,
      timezone: rule.timezone,
    });
  }

  isPortableHostSchedule(schedule) {
    return (
      schedule?.schedule_kind === HOST_SCHEDULE_KIND &&
      schedule?.metadata?.storage_owner === PORTABLE_SCHEDULER_STORAGE_OWNER
    );
  }

  recordHostScheduleDispatch(
    schedule,
    { triggeredAt, nextRunAt, dispatchedMessageId, status = null }
  ) {
    if (this.isPortableHostSchedule(schedule)) {
      return this.portableDefinitionStore.recordScheduleDispatch(schedule.id, {
        triggeredAt,
        nextRunAt,
        dispatchedMessageId,
        status,
      });
    }
    return this.store.recordScheduleDispatch(schedule.id, {
      triggeredAt,
      nextRunAt,
      dispatchedMessageId,
      status,
    });
  }

  recordHostScheduleSkip(schedule, { triggeredAt, nextRunAt, status = null }) {
    if (this.isPortableHostSchedule(schedule)) {
      return this.portableDefinitionStore.recordScheduleSkip(schedule.id, {
        triggeredAt,
        nextRunAt,
        status,
      });
    }
    return this.store.recordScheduleSkip(schedule.id, {
      triggeredAt,
      nextRunAt,
      status,
    });
  }

  recordSkippedRun(schedule, { triggeredAt, reason }) {
    const recheckMs = Math.min(
      schedule.interval_ms || this.recheckMs,
      this.recheckMs
    );
    const nextRunAt = addMilliseconds(triggeredAt, recheckMs);
    const run = this.store.createScheduleRun({
      scheduleId: schedule.id,
      scheduledFor: schedule.next_run_at || triggeredAt,
      claimedAt: triggeredAt,
      completedAt: triggeredAt,
      status: "skipped",
      error: reason,
      metadata: {
        skip_reason: reason,
        recheck_ms: recheckMs,
        next_run_at: nextRunAt,
      },
    });
    this.recordHostScheduleSkip(schedule, {
      triggeredAt,
      nextRunAt,
    });
    return {
      status: "skipped",
      schedule_id: schedule.id,
      run_id: run.id,
      reason,
      next_run_at: nextRunAt,
      recheck_ms: recheckMs,
    };
  }

  recordHostScheduleFailedRun(
    schedule,
    { triggeredAt, reason, logSummary, providerRun = null, triggerType = "scheduled" }
  ) {
    const targetBinding = getTargetBindingFromMetadata(schedule);
    const nextRunAt = this.computeNextHostScheduleRun(schedule, triggeredAt);
    const statusAfter = nextRunAt ? "active" : "stopped";
    const run = this.store.createScheduleRun({
      scheduleId: schedule.id,
      scheduledFor: schedule.next_run_at || triggeredAt,
      claimedAt: triggeredAt,
      completedAt: triggeredAt,
      status: "failed",
      error: reason,
      metadata: {
        failure_reason: reason,
        next_run_at: nextRunAt,
        missed_run_policy: "skip_without_catch_up",
        catch_up_burst: false,
        no_spin: true,
        ...(providerRun
          ? buildProviderRunMetadata({
              providerRun,
              triggerType,
              targetBinding,
              fallbackLogSummary: logSummary,
              extra: {
                missed_run_policy: "skip_without_catch_up",
                catch_up_burst: false,
                no_spin: true,
              },
            })
          : {
              trigger_type: triggerType,
              outcome: "failed",
              log_summary: logSummary,
              error_summary: reason,
            }),
      },
    });
    this.recordHostScheduleProviderRunLog(run, providerRun);
    this.recordHostScheduleSkip(schedule, {
      triggeredAt,
      nextRunAt,
      status: statusAfter,
    });
    return {
      status: "failed",
      schedule_id: schedule.id,
      run_id: run.id,
      reason,
      next_run_at: nextRunAt,
      no_spin: true,
      catch_up_burst: false,
    };
  }

  recordFailedRun(schedule, { triggeredAt, reason }) {
    const nextRunAt = addMilliseconds(triggeredAt, this.recheckMs);
    const run = this.store.createScheduleRun({
      scheduleId: schedule.id,
      scheduledFor: schedule.next_run_at || triggeredAt,
      claimedAt: triggeredAt,
      completedAt: triggeredAt,
      status: "failed",
      error: reason,
      metadata: {
        failure_reason: reason,
        recheck_ms: this.recheckMs,
        next_run_at: nextRunAt,
      },
    });
    this.recordHostScheduleSkip(schedule, {
      triggeredAt,
      nextRunAt,
    });
    return {
      status: "failed",
      schedule_id: schedule.id,
      run_id: run.id,
      reason,
      next_run_at: nextRunAt,
      recheck_ms: this.recheckMs,
    };
  }

  drainDueSchedulesSkeleton({ now = nowIso(this.clock) } = {}) {
    this.initialize();
    const dueSchedules = this.store.listDueSchedules(now);
    return {
      dispatched_count: 0,
      due_count: dueSchedules.length,
      blocked_reason:
        "P12.2 loop parser and dispatch semantics are implemented; use drainDueSchedules with a dispatcher",
      availability: this.getAvailabilityContract(),
    };
  }

  serializeParsedCommand(parsed) {
    return {
      command: parsed.command,
      interval_token: parsed.interval_token,
      interval_ms: parsed.interval_ms,
      prompt_redacted: true,
      prompt_length: parsed.prompt_length,
      prompt_sha256: parsed.prompt_sha256,
    };
  }

  serializeSessionLoopScheduleForGui(schedule) {
    if (!schedule) return null;
    const runs = this.store.listScheduleRuns(schedule.id);
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
    const metadata = isObjectRecord(schedule.metadata) ? schedule.metadata : {};
    const startAt =
      typeof metadata.start_at === "string" && metadata.start_at.trim()
        ? metadata.start_at.trim()
        : schedule.next_run_at;
    const endAt =
      typeof metadata.end_at === "string" && metadata.end_at.trim()
        ? metadata.end_at.trim()
        : null;
    return {
      id: schedule.id,
      host_session_id: schedule.host_session_id,
      agent_id: schedule.agent_id,
      schedule_kind: schedule.schedule_kind,
      interval_ms: schedule.interval_ms,
      interval_token:
        typeof metadata.interval_token === "string"
          ? metadata.interval_token
          : "",
      command_text: schedule.input_text,
      prompt_text: schedule.input_text,
      enabled: schedule.status === "active",
      status: schedule.status,
      next_run_at: schedule.next_run_at,
      start_at: startAt,
      end_at: endAt,
      last_run_at: schedule.last_triggered_at,
      last_status: lastRun?.status ?? null,
      last_error: lastRun?.error ?? null,
      run_count: schedule.dispatch_count,
      skipped_busy_count: schedule.skip_count,
      dispatch_count: schedule.dispatch_count,
      skip_count: schedule.skip_count,
      created_at: schedule.created_at,
      updated_at: schedule.updated_at,
      serialization_scope: "authenticated_current_session_loop_gui",
      session_scoped: true,
      cross_session_data: false,
      browser_local_storage_owner: false,
      matrix_db_owner: false,
      host_dispatch_path: "routec_matrix_loop_execution_event",
      generic_cli_serialization_remains_redacted: true,
      p12_4_schedule_model: false,
    };
  }

  getHostScheduleRedactionTokens(schedule) {
    const inputText = normalizeRequiredString(
      schedule.input_text,
      "input_text"
    );
    const metadata = isObjectRecord(schedule.metadata) ? schedule.metadata : {};
    const targetBinding = isObjectRecord(metadata.target_binding)
      ? metadata.target_binding
      : {};
    return collectHostScheduleRedactionTokens(
      schedule,
      targetBinding,
      inputText
    );
  }

  recordHostScheduleProviderRunLog(run, providerRun) {
    if (!run?.id || !run?.schedule_id || !providerRun) return null;
    return this.store.recordScheduleRunLog({
      runId: run.id,
      scheduleId: run.schedule_id,
      stdout: providerRun.stdout || "",
      stderr: providerRun.stderr || "",
      stdoutTruncated: providerRun.stdout_truncated === true,
      stderrTruncated: providerRun.stderr_truncated === true,
    });
  }

  serializeHostScheduleRunForDashboard(schedule, run) {
    const metadata = isObjectRecord(run?.metadata) ? run.metadata : {};
    const tokens = this.getHostScheduleRedactionTokens(schedule);
    const exitCode = Number.isInteger(metadata.provider_exit_code)
      ? metadata.provider_exit_code
      : null;
    const outcome = getHostScheduleRunOutcome(run);
    const log = this.store.getScheduleRunLog({
      scheduleId: schedule.id,
      runId: run.id,
    });
    return {
      id: run.id,
      schedule_id: schedule.id,
      status: run.status,
      outcome,
      trigger_type: metadata.trigger_type || metadata.source || "scheduled",
      scheduled_for: run.scheduled_for,
      claimed_at: run.claimed_at,
      started_at: metadata.provider_started_at || run.claimed_at,
      completed_at: metadata.provider_completed_at || run.completed_at,
      duration_ms: Number.isInteger(metadata.duration_ms)
        ? metadata.duration_ms
        : computeDurationMs(run.claimed_at, run.completed_at),
      dispatched_message_id: run.dispatched_message_id,
      provider: metadata.provider || null,
      provider_command: metadata.provider_command || null,
      exit_code: exitCode,
      signal: metadata.provider_signal || null,
      log_summary: redactHostScheduleTextForApi(
        metadata.log_summary,
        tokens
      ),
      error_summary: redactHostScheduleTextForApi(
        metadata.error_summary ?? run.error,
        tokens
      ),
      has_log: Boolean(log),
    };
  }

  serializeHostScheduleRunLogForDashboard(schedule, run, log) {
    const runSummary = this.serializeHostScheduleRunForDashboard(schedule, run);
    return {
      ...runSummary,
      attempt: log.attempt,
      stdout: log.stdout_text || "",
      stderr: log.stderr_text || "",
      stdout_truncated: log.stdout_truncated === true,
      stderr_truncated: log.stderr_truncated === true,
      captured_at: log.captured_at,
      raw_log_dashboard_auth_only: true,
      generic_schedule_serialization_remains_redacted: true,
    };
  }

  serializeHostScheduleForApi(schedule) {
    if (!schedule) return null;
    if (schedule.schedule_kind !== HOST_SCHEDULE_KIND) {
      throw new Error("serializeHostScheduleForApi requires host_schedule");
    }
    const inputText = normalizeRequiredString(
      schedule.input_text,
      "input_text"
    );
    const metadata = isObjectRecord(schedule.metadata) ? schedule.metadata : {};
    const targetBinding = isObjectRecord(metadata.target_binding)
      ? metadata.target_binding
      : {};
    const runs = this.store.listScheduleRuns(schedule.id);
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
    const redactionTokens = collectHostScheduleRedactionTokens(
      schedule,
      targetBinding,
      inputText
    );
    return {
      id: schedule.id,
      host_session: serializeHostScheduleSessionBoundary(schedule),
      agent: serializeHostScheduleAgentBoundary(schedule),
      schedule_kind: schedule.schedule_kind,
      status: schedule.status,
      next_run_at: schedule.next_run_at,
      rule: metadata.schedule_rule
        ? serializeScheduleRuleForSummary(metadata.schedule_rule)
        : null,
      timezone: metadata.timezone || metadata.schedule_rule?.timezone || null,
      target_binding: serializeTargetBindingBoundary(targetBinding),
      input_text_redacted: true,
      input_text_length: inputText.length,
      input_text_sha256: hashText(inputText),
      last_run_at: schedule.last_triggered_at,
      last_status: lastRun?.status ?? null,
      last_outcome: getHostScheduleRunOutcome(lastRun),
      last_trigger_type: lastRun?.metadata?.trigger_type ?? null,
      last_exit_code: Number.isInteger(lastRun?.metadata?.provider_exit_code)
        ? lastRun.metadata.provider_exit_code
        : null,
      last_log_summary: redactHostScheduleTextForApi(
        lastRun?.metadata?.log_summary,
        redactionTokens
      ),
      last_error_summary: redactHostScheduleTextForApi(
        lastRun?.metadata?.error_summary ?? lastRun?.error,
        redactionTokens
      ),
      run_count: runs.length,
      dispatch_count: schedule.dispatch_count,
      skip_count: schedule.skip_count,
      run_history: runs.slice(-10).map((run) => ({
        id: run.id,
        scheduled_for: run.scheduled_for,
        status: run.status,
        outcome: getHostScheduleRunOutcome(run),
        trigger_type: run.metadata?.trigger_type ?? null,
        exit_code: Number.isInteger(run.metadata?.provider_exit_code)
          ? run.metadata.provider_exit_code
          : null,
        completed_at: run.completed_at,
        dispatched_message_id: run.dispatched_message_id,
        log_summary: redactHostScheduleTextForApi(
          run.metadata?.log_summary,
          redactionTokens
        ),
        error_summary: redactHostScheduleTextForApi(
          run.metadata?.error_summary ?? run.error,
          redactionTokens
        ),
      })),
      missed_run_policy: "skip_without_catch_up",
      catch_up_burst: false,
      storage_owner:
        metadata.storage_owner || PORTABLE_SCHEDULER_STORAGE_OWNER,
      runtime_state_owner:
        metadata.runtime_state_owner || PORTABLE_SCHEDULER_RUNTIME_STATE_OWNER,
      portable_agent_folder_present: Boolean(metadata.portable_agent_folder),
      portable_agent_folder_redacted: Boolean(metadata.portable_agent_folder),
      portable_schedulers_json_path_present: Boolean(
        metadata.portable_schedulers_json_path
      ),
      portable_schedulers_json_path_redacted: Boolean(
        metadata.portable_schedulers_json_path
      ),
      raw_portable_paths_returned: false,
      setup_snapshot_copied: metadata.setup_snapshot_copied === true,
      source_session_references_present:
        metadata.source_session_references_present === true,
      cloned_first_discovery_disabled:
        metadata.cloned_first_discovery_disabled === true,
      browser_local_storage_owner: false,
      matrix_db_owner: false,
      p12_5_scheduler_tab: true,
    };
  }

  serializeHostScheduleForDashboardUi(schedule) {
    if (!schedule) return null;
    if (schedule.schedule_kind !== HOST_SCHEDULE_KIND) {
      throw new Error(
        "serializeHostScheduleForDashboardUi requires host_schedule"
      );
    }
    const metadata = isObjectRecord(schedule.metadata) ? schedule.metadata : {};
    const targetBinding = isObjectRecord(metadata.target_binding)
      ? metadata.target_binding
      : {};
    return {
      ...this.serializeHostScheduleForApi(schedule),
      command_text: schedule.input_text,
      enabled: schedule.status === "active",
      editable_rule: metadata.schedule_rule || null,
      editable_target_binding: {
        kind: targetBinding.kind || null,
        host_session_id: targetBinding.host_session_id || null,
        saved_session_id: targetBinding.saved_session_id || null,
        session_setup_record_id: targetBinding.session_setup_record_id || null,
        agent_id: targetBinding.agent_id || schedule.agent_id || null,
        setup_snapshot: isObjectRecord(targetBinding.setup_snapshot)
          ? targetBinding.setup_snapshot
          : null,
        session_setup_fields: isObjectRecord(targetBinding.session_setup_fields)
          ? targetBinding.session_setup_fields
          : isObjectRecord(targetBinding.setup_snapshot)
          ? {
              provider: targetBinding.setup_snapshot.provider || null,
              model: targetBinding.setup_snapshot.model || null,
              agent_folder: targetBinding.setup_snapshot.agent_folder || null,
              permission_mode:
                targetBinding.setup_snapshot.permission_mode ||
                targetBinding.setup_snapshot.approval_policy ||
                null,
            }
          : null,
        session_setup_payload: isObjectRecord(
          targetBinding.session_setup_payload
        )
          ? targetBinding.session_setup_payload
          : isObjectRecord(targetBinding.setup_snapshot)
          ? targetBinding.setup_snapshot
          : null,
      },
      serialization_scope: "authenticated_dashboard_host_scheduler_ui",
      generic_schedule_serialization_remains_redacted: true,
      browser_local_storage_owner: false,
      matrix_db_owner: false,
      p12_5_scheduler_tab: true,
    };
  }

  serializeSchedule(schedule) {
    if (!schedule) return null;
    const inputText = normalizeRequiredString(
      schedule.input_text,
      "input_text"
    );
    return {
      id: schedule.id,
      created_by: schedule.created_by,
      schedule_kind: schedule.schedule_kind,
      status: schedule.status,
      interval_ms: schedule.interval_ms,
      normalized_command_sha256: hashText(schedule.normalized_command || ""),
      next_run_at: schedule.next_run_at,
      availability: {
        available: schedule.availability_state === "active",
        state: schedule.availability_state,
        reason: schedule.availability_reason,
      },
      input_text_redacted: true,
      input_text_length: inputText.length,
      input_text_sha256: hashText(inputText),
      metadata_redacted: schedule.metadata !== null,
      dispatch_count: schedule.dispatch_count,
      skip_count: schedule.skip_count,
      last_triggered_at: schedule.last_triggered_at,
      last_dispatched_message_id: schedule.last_dispatched_message_id,
      last_skipped_at: schedule.last_skipped_at,
      created_at: schedule.created_at,
      updated_at: schedule.updated_at,
      stopped_at: schedule.stopped_at,
      stop_reason: schedule.stop_reason,
      storage_owner:
        schedule.schedule_kind === HOST_SCHEDULE_KIND
          ? schedule.metadata?.storage_owner || PORTABLE_SCHEDULER_STORAGE_OWNER
          : "host_config_oysterun_sqlite",
      browser_local_storage_owner: false,
      matrix_db_owner: false,
      host_dispatch_path: "routec_matrix_loop_execution_event",
      p12_4_schedule_model:
        schedule.schedule_kind === HOST_SCHEDULE_KIND ? true : false,
      ...(schedule.schedule_kind === HOST_SCHEDULE_KIND
        ? {
            agent: serializeHostScheduleAgentBoundary(schedule),
            host_session: serializeHostScheduleSessionBoundary(schedule),
          }
        : {
            agent_id: schedule.agent_id,
            host_session_id: schedule.host_session_id,
          }),
    };
  }
}

export {
  HOST_SCHEDULE_ACTIVE_REASON,
  HOST_SCHEDULE_KIND,
  HOST_SCHEDULER_NICKNAME,
  LOOP_SCHEDULE_KIND,
  LOOP_SCHEDULER_NICKNAME,
  LOOP_SCHEDULER_USER_ID,
  SCHEDULER_BUSY_RECHECK_MS,
  SCHEDULER_LOOP_ACTIVE_REASON,
  SCHEDULER_LOOP_GUI_PAUSED_REASON,
};
