import { spawn } from "child_process";
import { EventEmitter } from "events";
import { toProviderNativeReasoningEffort } from "../config.mjs";
import {
  assertWorkspacePolicyCompatibility,
  buildWorkspacePolicyContext,
  isWorkspaceAllowedPathPolicyDisabled,
  normalizeAssetReadablePaths,
} from "../workspace-policy.mjs";

function normalizeApprovalPolicy(policy, dangerousMode) {
  if (typeof policy === "string" && policy.trim()) {
    const normalized = policy.trim().toLowerCase();
    if (normalized === "on-request" || normalized === "never") {
      return normalized;
    }
    throw new Error(`Unsupported Codex approval policy: ${policy}`);
  }
  return dangerousMode === true ? "never" : null;
}

function normalizeSandboxMode(mode, dangerousMode) {
  if (typeof mode === "string" && mode.trim()) {
    const normalized = mode.trim().toLowerCase();
    if (normalized === "workspacewrite" || normalized === "workspace-write") return "workspace-write";
    if (normalized === "readonly" || normalized === "read-only") return "read-only";
    if (normalized === "dangerfullaccess" || normalized === "danger-full-access") {
      return "danger-full-access";
    }
    return normalized;
  }
  return dangerousMode === true ? "danger-full-access" : null;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

const CODEX_CONTROL_ACK_TIMEOUT_MS = 30000;
const CODEX_CONTROL_FOLLOWTHROUGH_TIMEOUT_MS = 120000;

function codexControlRequiresProviderResolution(kind) {
  return kind === "command" || kind === "patch";
}

function codexAcceptedControlAnswerInFlight(pending) {
  return (
    pending?.answer?.allow === true &&
    (pending.answerSent === true || pending.answerWriteInProgress === true)
  );
}

function codexControlFollowthroughItemType(kind) {
  if (kind === "command") return "commandExecution";
  if (kind === "patch") return "fileChange";
  return null;
}

function extractCodexControlItemId(params) {
  if (typeof params?.id === "string" && params.id.trim()) {
    return params.id.trim();
  }
  if (typeof params?.itemId === "string" && params.itemId.trim()) {
    return params.itemId.trim();
  }
  if (typeof params?.item_id === "string" && params.item_id.trim()) {
    return params.item_id.trim();
  }
  if (typeof params?.item?.id === "string" && params.item.id.trim()) {
    return params.item.id.trim();
  }
  return null;
}

function codexFollowthroughMatchesItem(pending, item) {
  if (!isPlainObject(pending) || !isPlainObject(item)) return false;
  const expectedType = codexControlFollowthroughItemType(pending.kind);
  if (!expectedType || item.type !== expectedType) return false;
  const expectedItemId =
    pending.itemId || extractCodexControlItemId(pending.params) || null;
  const actualItemId = typeof item.id === "string" && item.id.trim()
    ? item.id.trim()
    : null;
  if (!expectedItemId) return true;
  if (actualItemId === expectedItemId) return true;
  const expectedCommand = extractCodexApprovalCommandText(pending);
  const actualCommand = extractCodexCommandTextFromItem(item);
  return Boolean(expectedCommand && actualCommand && expectedCommand === actualCommand);
}

function codexAcceptedControlCandidateMatchesItem(pending, item) {
  if (!isPlainObject(pending) || !isPlainObject(item)) return false;
  const expectedType = codexControlFollowthroughItemType(pending.kind);
  if (!expectedType || item.type !== expectedType) return false;
  const expectedItemId =
    pending.itemId || extractCodexControlItemId(pending.params) || null;
  const actualItemId = typeof item.id === "string" && item.id.trim()
    ? item.id.trim()
    : null;
  const expectedCommand = extractCodexApprovalCommandText(pending);
  const actualCommand = extractCodexCommandTextFromItem(item);
  if (expectedItemId && actualItemId) {
    return (
      actualItemId === expectedItemId ||
      Boolean(expectedCommand && actualCommand && expectedCommand === actualCommand)
    );
  }
  return Boolean(expectedCommand && actualCommand && expectedCommand === actualCommand);
}

function codexToolResultIndicatesProviderFailure(event) {
  if (!event || event.type !== "tool.result") return false;
  if (event.is_error === true) return true;
  if (event.content?.success === false) return true;
  const status =
    typeof event.content?.status === "string"
      ? event.content.status.trim().toLowerCase()
      : "";
  return status === "failed" || status === "declined" || status === "cancelled" || status === "canceled";
}

function codexAcceptedControlMatchesTurnForFailure(pending, turn) {
  if (!codexControlRequiresProviderResolution(pending?.kind)) return false;
  const turnId =
    typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
  if (!turnId || !pending?.activeTurnId) return true;
  if (pending.activeTurnId === turnId) return true;
  return turn?.status === "failed";
}

function codexAcceptedControlTurnMismatch(pending, turn) {
  const turnId =
    typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
  return Boolean(turnId && pending?.activeTurnId && pending.activeTurnId !== turnId);
}

function codexTurnIsExplicitProviderFailure(turn) {
  return turn?.status === "failed" || Boolean(turn?.error);
}

function codexAcceptedControlIsBranch2ProviderFailure(pending, turn) {
  return (
    codexTurnIsExplicitProviderFailure(turn) &&
    pending?.answer?.allow === true &&
    Boolean(pending.acknowledged_at_ms) &&
    pending.answerWriteInProgress !== true &&
    !codexAcceptedControlTurnMismatch(pending, turn)
  );
}

function extractCodexServerRequestResolutionError(params) {
  if (!isPlainObject(params)) return "";
  if (typeof params.error === "string" && params.error.trim()) {
    return params.error.trim();
  }
  if (
    isPlainObject(params.error) &&
    typeof params.error.message === "string" &&
    params.error.message.trim()
  ) {
    return params.error.message.trim();
  }
  if (typeof params.errorMessage === "string" && params.errorMessage.trim()) {
    return params.errorMessage.trim();
  }
  if (params.ok === false || params.success === false) {
    return "Codex app-server reported control response resolution failure";
  }
  return "";
}

function firstNonEmptyCodexString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function extractCodexCommandTextFromItem(item) {
  if (!isPlainObject(item)) return "";
  const direct = firstNonEmptyCodexString([
    item.command,
    item.cmd,
    item.shellCommand,
    item.shell_command,
  ]);
  if (direct) return direct;
  return firstNonEmptyCodexString([
    item.input?.command,
    item.input?.cmd,
    item.payload?.command,
    item.payload?.cmd,
    item.commandExecution?.command,
    item.command_execution?.command,
  ]);
}

function extractCodexCommandTextFromParams(params) {
  if (!isPlainObject(params)) return "";
  const direct = firstNonEmptyCodexString([
    params.command,
    params.cmd,
    params.shellCommand,
    params.shell_command,
  ]);
  if (direct) return direct;
  for (const key of [
    "item",
    "input",
    "payload",
    "tool",
    "toolCall",
    "tool_call",
    "commandExecution",
    "command_execution",
  ]) {
    const nested = extractCodexCommandTextFromItem(params[key]);
    if (nested) return nested;
  }
  return "";
}

function extractCodexApprovalCommandText(pending, context = {}) {
  return firstNonEmptyCodexString([
    pending?.commandText,
    pending?.command_text,
    context.command_text,
    context.original_command_text,
    extractCodexCommandTextFromParams(pending?.params),
  ]);
}

function isCodexHighRiskStuckTrapCommand(commandText) {
  if (typeof commandText !== "string" || !commandText.trim()) return false;
  const text = commandText.toLowerCase();
  const routeOwnedMarkerRoot =
    /(?:oysterunagents\/p115_|oysterun-p115-marker|oysterun-p115-[0-9a-z_-]*markers|p115_[0-9a-z_-]*markers)/i.test(
      commandText
    );
  const recursiveRm =
    /\brm\s+-[a-z-]*r[a-z-]*/.test(text) ||
    /\brm\b(?=[^;&|\n]*\s-r(?:\s|$))/.test(text);
  const fakeGitTarget =
    /(?:^|[/"'\s])\.git(?:[/"'\s]|$)/.test(commandText) ||
    /\/\.git(?:[/"'\s]|$)/.test(commandText);
  const gitCleanDestructive =
    /\bgit\s+clean\b/.test(text) &&
    /\s-[a-z-]*f[a-z-]*/.test(text) &&
    /\s-[a-z-]*[dx][a-z-]*/.test(text);
  return (
    /\brm\s+-[a-z-]*r[a-z-]*f[a-z-]*/.test(text) ||
    /\brm\s+-[a-z-]*f[a-z-]*r[a-z-]*/.test(text) ||
    /\brm\b(?=[^;&|\n]*\s-r(?:\s|$))(?=[^;&|\n]*\s-f(?:\s|$))/.test(text) ||
    (recursiveRm && fakeGitTarget) ||
    (routeOwnedMarkerRoot && (recursiveRm || gitCleanDestructive))
  );
}

function formatCodexAcceptedControlFailure(pending, message, context = {}) {
  const accepted =
    pending?.answer?.allow === true || context.accepted_control_response === true;
  const rejectedTrapException =
    context.destructive_trap_exception === true &&
    pending?.kind === "command" &&
    pending?.answer?.allow === false;
  if (
    (!accepted && !rejectedTrapException) ||
    !codexControlRequiresProviderResolution(pending?.kind)
  ) {
    return {
      message,
      originalCommandText: null,
      stuckTrap: false,
      failVisibleReminder: false,
    };
  }

  const originalCommandText =
    pending?.kind === "command"
      ? extractCodexApprovalCommandText(pending, context)
      : "";
  const stuckTrap = isCodexHighRiskStuckTrapCommand(originalCommandText);
  const parts = [message];
  const decisionLabel = accepted ? "accepted" : "rejected";

  if (pending?.kind === "command") {
    if (originalCommandText) {
      parts.push(`Original Codex command: ${originalCommandText}`);
    } else {
      parts.push(
        "Original Codex command: unavailable; Oysterun could not recover the accepted command text for this provider failure."
      );
    }
  } else if (pending?.kind === "patch") {
    parts.push("Accepted Codex file-change approval did not reach provider completion.");
  }

  parts.push(
    "Recommended recovery: stop and resume the session before retrying."
  );
  parts.push(
    `The ${decisionLabel} Codex operation may have hit Codex hard-gating/stuck behavior with no-follow-through; Oysterun converted the stuck state into a visible error instead of leaving the turn typing indefinitely.`
  );
  if (stuckTrap) {
    parts.push(
      "High-risk stuck-trap reminder: this rm -rf-style accepted command is fail-visible evidence only and does not count as provider functionality PASS under Q26."
    );
  } else {
    parts.push(
      "This fail-visible reminder does not count as provider functionality PASS under Q26."
    );
  }

  return {
    message: parts.join(" "),
    originalCommandText: originalCommandText || null,
    stuckTrap,
    failVisibleReminder: true,
  };
}

function normalizeCodexUserInputAnswers(questions, rawAnswers) {
  if (!isPlainObject(rawAnswers)) {
    throw new Error("Codex user input response requires an answers object");
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Codex user input request is missing questions");
  }

  const normalized = {};
  const expectedIds = new Set();

  for (const question of questions) {
    if (!isPlainObject(question) || typeof question.id !== "string" || !question.id.trim()) {
      throw new Error("Codex user input request has an invalid question id");
    }
    const questionId = question.id;
    expectedIds.add(questionId);
    const answer = rawAnswers[questionId];
    if (!isPlainObject(answer)) {
      throw new Error(`Missing answer payload for Codex question "${questionId}"`);
    }
    if (!Array.isArray(answer.answers) || answer.answers.length === 0) {
      throw new Error(`Codex question "${questionId}" requires at least one answer`);
    }
    const values = answer.answers.map((entry) => {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new Error(`Codex question "${questionId}" includes an invalid answer value`);
      }
      return entry.trim();
    });
    normalized[questionId] = { answers: values };
  }

  for (const key of Object.keys(rawAnswers)) {
    if (!expectedIds.has(key)) {
      throw new Error(`Unexpected Codex user input answer key: ${key}`);
    }
  }

  return normalized;
}

function normalizeCodexElicitationResponse(params, rawResponse) {
  if (!isPlainObject(rawResponse)) {
    throw new Error("Codex MCP elicitation response requires a response object");
  }
  const action = typeof rawResponse.action === "string" ? rawResponse.action.trim() : "";
  if (!["accept", "decline", "cancel"].includes(action)) {
    throw new Error("Codex MCP elicitation response requires action accept, decline, or cancel");
  }

  const response = {
    action,
    content: rawResponse.content ?? null,
    _meta: rawResponse._meta ?? null,
  };

  if (params?.mode === "form" && action === "accept") {
    if (!isPlainObject(response.content)) {
      throw new Error("Codex MCP form elicitation requires object content when accepting");
    }
  }

  if (action !== "accept") {
    response.content = null;
  }

  return response;
}

function codexPendingControlKindToSubtype(kind) {
  if (kind === "user_input") return "user_input";
  if (kind === "mcp_elicitation") return "mcp_elicitation";
  if (kind === "command") return "command";
  if (kind === "patch") return "patch";
  if (kind === "permissions") return "permissions";
  throw new Error(`Unsupported Codex pending control kind: ${kind}`);
}

function buildUserInput(text) {
  return [{ type: "text", text }];
}

function normalizePendingMessage(payload) {
  if (typeof payload === "string") {
    return {
      text: payload,
      rawText: payload,
      isSlashCommand: false,
      slashCommandName: null,
    };
  }
  const text = typeof payload?.text === "string" ? payload.text : "";
  const rawText = typeof payload?.rawText === "string" ? payload.rawText : text;
  return {
    text,
    rawText,
    isSlashCommand: payload?.isSlashCommand === true,
    slashCommandName: typeof payload?.slashCommandName === "string" && payload.slashCommandName.trim()
      ? payload.slashCommandName.trim().toLowerCase()
      : null,
  };
}

function ensureReasoningState(reasoningStateMap, itemId) {
  if (!(reasoningStateMap instanceof Map) || typeof itemId !== "string" || !itemId) {
    return null;
  }
  const existing = reasoningStateMap.get(itemId);
  if (isPlainObject(existing)) {
    existing.sawDelta = existing.sawDelta === true;
    existing.summaryParts = Array.isArray(existing.summaryParts) ? existing.summaryParts : [];
    existing.emittedCompleteText = typeof existing.emittedCompleteText === "string" ? existing.emittedCompleteText : "";
    return existing;
  }
  const state = { sawDelta: false, summaryParts: [], emittedCompleteText: "" };
  reasoningStateMap.set(itemId, state);
  return state;
}

function extractReasoningText(value, seen = new Set()) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => extractReasoningText(entry, seen).trim())
      .filter(Boolean)
      .join("\n");
  }
  if (!isPlainObject(value)) {
    return "";
  }
  if (seen.has(value)) {
    return "";
  }
  seen.add(value);

  if (typeof value.text === "string") {
    return value.text;
  }

  const candidateKeys = [
    "delta",
    "content",
    "summary",
    "part",
    "summaryPart",
    "summary_part",
    "parts",
    "value",
  ];
  return candidateKeys
    .map((key) => extractReasoningText(value[key], seen).trim())
    .filter(Boolean)
    .join("\n");
}

function extractReasoningSummaryPartText(params) {
  if (!isPlainObject(params)) return "";
  const directCandidates = [
    params.summaryPart,
    params.summary_part,
    params.part,
    params.summary,
    params.content,
    params.text,
  ];
  for (const candidate of directCandidates) {
    const extracted = extractReasoningText(candidate).trim();
    if (extracted) {
      return extracted;
    }
  }
  return extractReasoningText(params).trim();
}

function extractCompletedReasoningText(item, state) {
  if (!isPlainObject(item)) return "";

  if (typeof item.text === "string" && item.text.trim()) {
    return item.text.trim();
  }

  const summaryText = extractReasoningText(item.summary).trim();
  if (summaryText) {
    return summaryText;
  }

  const accumulatedSummaryText = extractReasoningText(state?.summaryParts || []).trim();
  if (accumulatedSummaryText) {
    return accumulatedSummaryText;
  }

  return extractReasoningText(item.content).trim();
}

export class CodexAppServerAdapter {
  constructor(options = {}) {
    this.command = options.command || "codex";
    this.getConfiguredCommandFn = typeof options.getConfiguredCommand === "function"
      ? options.getConfiguredCommand
      : null;
    this.spawnFn = options.spawnFn || spawn;
    this.providerId = "codex";
    this.capabilities = {
      interactiveSession: true,
      resume: true,
      permissionResponses: true,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
    };
  }

  getConfiguredCommand() {
    if (!this.getConfiguredCommandFn) return null;
    const value = this.getConfiguredCommandFn();
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  resolveCommand() {
    return this.getConfiguredCommand() || this.command;
  }

  startSession({
    sessionId,
    cwd,
    agentId,
    resumeSessionId,
    fork = false,
    model,
    approvalPolicy,
    sandboxMode,
    dangerousMode,
    searchEnabled,
    imageInputEnabled,
    native,
    workspacePolicy,
    assetReadablePaths,
    runtimeEnv,
  }) {
    const normalizedSandboxMode = normalizeSandboxMode(sandboxMode, dangerousMode);
    assertWorkspacePolicyCompatibility({
      provider: this.providerId,
      workspacePolicy,
      sandboxMode: normalizedSandboxMode,
    });
    const extraArgs = Array.isArray(native?.args) ? native.args : [];
    const mergedEnv =
      runtimeEnv && typeof runtimeEnv === "object" && !Array.isArray(runtimeEnv)
        ? { ...process.env, ...runtimeEnv }
        : { ...process.env };
    const proc = this.spawnFn(this.resolveCommand(), [
      "app-server",
      "--listen",
      "stdio://",
      ...extraArgs,
    ], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: mergedEnv,
    });

    return new CodexAppServerSession(sessionId, proc, {
      cwd,
      agentId,
      resumeSessionId,
      fork,
      model,
      approvalPolicy,
      sandboxMode: normalizedSandboxMode,
      dangerousMode,
      searchEnabled,
      imageInputEnabled,
      native,
      workspacePolicy,
      assetReadablePaths,
    });
  }

  sendMessage(session, payload) {
    session.send(payload);
  }

  respondToControl(session, payload) {
    return session.respondToControl(payload);
  }

  stopSession(session) {
    session.stop();
  }

  interruptSession(session) {
    return session.interrupt();
  }

  killSession(session) {
    session.kill();
  }

  supportsInteractiveSession() {
    return true;
  }

  supportsResume() {
    return true;
  }

  supportsPermissionResponses() {
    return true;
  }
}

export class CodexAppServerSession extends EventEmitter {
  constructor(id, proc, options) {
    super();
    this.id = id;
    this.proc = proc;
    this.cwd = options.cwd;
    this.agentId = options.agentId;
    this.provider = "codex";
    this.transport = "app-server";
    this.capabilities = {
      interactiveSession: true,
      resume: true,
      permissionResponses: true,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
    };
    this.model = options.model || null;
    this.reasoningEffort = options.reasoningEffort || null;
    this.reasoningEffortSource = options.reasoningEffortSource || null;
    this.approvalPolicy = normalizeApprovalPolicy(options.approvalPolicy, options.dangerousMode);
    this.sandboxMode = normalizeSandboxMode(options.sandboxMode, options.dangerousMode);
    this.dangerousMode = options.dangerousMode === true;
    this.searchEnabled = options.searchEnabled === true;
    this.imageInputEnabled = options.imageInputEnabled === true;
    this.native = options.native || { args: [], configOverrides: {}, commands: [], profile: null };
    this.workspacePolicy = options.workspacePolicy || null;
    this.assetReadablePaths = normalizeAssetReadablePaths(options.assetReadablePaths || []);
    this.resumeSessionId = options.resumeSessionId || null;
    this.fork = options.fork === true;
    this.threadId = null;
    this.providerResumeId = null;
    this.activeTurnId = null;
    this.alive = true;
    this._ready = false;
    this._stdoutBuffer = "";
    this._nextRequestId = 1;
    this._pendingRequests = new Map();
    this._pendingMessages = [];
    this._pendingControls = new Map();
    this._pendingControlAckTimers = new Map();
    this._pendingControlFollowthroughs = new Map();
    this._acceptedControlResolutionTrackers = new Map();
    this._acceptedControlFailureFallbacks = new Map();
    this._acceptedControlFailureCandidates = new Map();
    this._acceptedControlFailureLedger = new Map();
    this._destructiveTrapControlOutcomes = new Map();
    this._acceptedDestructiveTrapFailureFallbacks = new Map();
    this._failedControlFollowthroughTurnIds = new Set();
    this._controlToolItems = new Map();
    this._agentMessageState = new Map();
    this._reasoningState = new Map();
    this._sending = false;
    this._steerWaitTurnId = null;
    this._awaitingTurnStart = false;
    this._terminatingIntentionally = false;

    proc.stdout.on("data", (chunk) => this.consumeStdout(chunk.toString()));
    proc.stderr.on("data", (chunk) => {
      this.emit("event", {
        type: "stderr",
        provider: this.provider,
        text: chunk.toString(),
      });
    });
    proc.on("exit", (code, signal) => {
      this.alive = false;
      if (this._terminatingIntentionally !== true) {
        this.failPendingControlsOnProviderTermination({
          phase: "provider.exit",
          code,
          signal: signal || null,
        });
      }
      this.clearPendingControlAckTimers();
      this.clearPendingControlFollowthroughs();
      this.clearAcceptedControlResolutionTrackers();
      this.clearAcceptedControlFailureLedgers();
      this.clearAcceptedDestructiveTrapFailureFallbacks();
      for (const pending of this._pendingRequests.values()) {
        pending.reject(new Error(`Codex app-server exited before response (code=${code}, signal=${signal || "none"})`));
      }
      this._pendingRequests.clear();
      this.emit("exit", code, signal);
    });
    proc.on("error", (err) => {
      this.alive = false;
      if (this._terminatingIntentionally !== true) {
        this.failPendingControlsOnProviderTermination({
          phase: "provider.error",
          error: err?.message || String(err),
        });
      }
      this.clearPendingControlAckTimers();
      this.clearPendingControlFollowthroughs();
      this.clearAcceptedControlResolutionTrackers();
      this.clearAcceptedControlFailureLedgers();
      this.clearAcceptedDestructiveTrapFailureFallbacks();
      this.emit("error", err);
    });

    this.initialize().catch((err) => this.emit("error", err));
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "oysterun",
        title: "Oysterun Host",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized", {});

    if (this.resumeSessionId && this.fork === true) {
      const result = await this.request("thread/fork", this.buildThreadForkParams(this.resumeSessionId));
      this.captureThread(result?.thread || null);
    } else if (this.resumeSessionId) {
      const result = await this.request("thread/resume", this.buildThreadResumeParams(this.resumeSessionId));
      this.captureThread(result?.thread || null);
    }

    this._ready = true;
    this.emitReady();
    this.drainPendingMessages();
  }

  buildThreadConfig() {
    const config = isPlainObject(this.native?.configOverrides)
      ? { ...this.native.configOverrides }
      : {};
    const translatedReasoningEffort = toProviderNativeReasoningEffort("codex", this.reasoningEffort, this.model);
    if (translatedReasoningEffort && this.reasoningEffortSource !== "native") {
      config.model_reasoning_effort = translatedReasoningEffort;
    }
    if (!Object.prototype.hasOwnProperty.call(config, "model_reasoning_summary")) {
      // Ask Codex to emit a readable reasoning summary instead of relying on encrypted-only
      // reasoning payloads that collapse to the "(reasoning)" placeholder in Oysterun.
      config.model_reasoning_summary = "detailed";
    }
    if (!Object.prototype.hasOwnProperty.call(config, "model_supports_reasoning_summaries")) {
      config.model_supports_reasoning_summaries = true;
    }
    if (this.native?.profile) {
      config.profile = this.native.profile;
    }
    config.web_search = this.searchEnabled === true ? "live" : "disabled";
    const tools = isPlainObject(config.tools) ? { ...config.tools } : {};
    tools.view_image = this.imageInputEnabled === true;
    config.tools = tools;
    return config;
  }

  buildThreadStartParams() {
    return {
      model: this.model || undefined,
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy || undefined,
      sandbox: this.sandboxMode || undefined,
      serviceName: "oysterun",
      config: this.buildThreadConfig(),
      persistExtendedHistory: true,
    };
  }

  buildThreadResumeParams(threadId) {
    return {
      threadId,
      model: this.model || undefined,
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy || undefined,
      sandbox: this.sandboxMode || undefined,
      config: this.buildThreadConfig(),
      persistExtendedHistory: true,
    };
  }

  buildThreadForkParams(threadId) {
    return {
      threadId,
      model: this.model || undefined,
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy || undefined,
      sandbox: this.sandboxMode || undefined,
      config: this.buildThreadConfig(),
      persistExtendedHistory: true,
    };
  }

  buildSandboxPolicy() {
    if (isWorkspaceAllowedPathPolicyDisabled(this.workspacePolicy)) {
      return null;
    }
    assertWorkspacePolicyCompatibility({
      provider: this.provider,
      workspacePolicy: this.workspacePolicy,
      sandboxMode: this.sandboxMode,
    });
    const policyContext = buildWorkspacePolicyContext({
      workspacePolicy: this.workspacePolicy,
      assetReadablePaths: this.assetReadablePaths,
    });
    if (this.sandboxMode === "danger-full-access") {
      return { type: "dangerFullAccess" };
    }
    if (this.sandboxMode === "read-only") {
      return {
        type: "readOnly",
        access: {
          type: "restricted",
          includePlatformDefaults: true,
          readableRoots: policyContext.readablePaths,
        },
        networkAccess: false,
      };
    }
    if (this.sandboxMode === "workspace-write") {
      return {
        type: "workspaceWrite",
        writableRoots: policyContext.writableRoots,
        permissionProfile: {
          type: "restricted",
          includePlatformDefaults: true,
          readableRoots: policyContext.readablePaths,
        },
        networkAccess: false,
      };
    }
    return null;
  }

  buildTurnStartParams(text) {
    return {
      threadId: this.threadId,
      input: buildUserInput(text),
      model: this.model || undefined,
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy || undefined,
      sandboxPolicy: this.buildSandboxPolicy() || undefined,
    };
  }

  captureThread(thread) {
    const nextThreadId = thread?.id || null;
    if (typeof nextThreadId === "string" && nextThreadId) {
      this.threadId = nextThreadId;
      this.providerResumeId = nextThreadId;
    }
  }

  emitReady() {
    this.emit("event", {
      type: "session.ready",
      provider: this.provider,
      session_id: this.id,
      thread_id: this.threadId,
      model: this.model,
      approval_policy: this.approvalPolicy,
      sandbox_mode: this.sandboxMode,
      provider_resume_id: this.providerResumeId,
      transport: this.transport,
    });
  }

  consumeStdout(text) {
    this._stdoutBuffer += text;
    const lines = this._stdoutBuffer.split("\n");
    this._stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit("event", {
          type: "session.notice",
          provider: this.provider,
          subtype: "raw_stdout",
          text: line,
        });
        continue;
      }
      this.handleMessage(msg);
    }
  }

  handleMessage(msg) {
    if (msg.id !== undefined && (Object.prototype.hasOwnProperty.call(msg, "result") || Object.prototype.hasOwnProperty.call(msg, "error"))) {
      const pending = this._pendingRequests.get(String(msg.id));
      if (!pending) return;
      this._pendingRequests.delete(String(msg.id));
      if (msg.error) {
        pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        return;
      }
      pending.resolve(msg.result);
      return;
    }

    if (typeof msg.method !== "string") return;

    if (msg.id !== undefined) {
      this.handleServerRequest(msg);
      return;
    }

    this.handleNotification(msg.method, msg.params || {});
  }

  ensurePendingControlAckTimers() {
    if (!(this._pendingControlAckTimers instanceof Map)) {
      this._pendingControlAckTimers = new Map();
    }
    return this._pendingControlAckTimers;
  }

  clearPendingControlAckTimer(requestId) {
    const timers =
      CodexAppServerSession.prototype.ensurePendingControlAckTimers.call(this);
    const timer = timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(requestId);
    }
  }

  clearPendingControlAckTimers() {
    const timers =
      CodexAppServerSession.prototype.ensurePendingControlAckTimers.call(this);
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  }

  ensurePendingControlFollowthroughs() {
    if (!(this._pendingControlFollowthroughs instanceof Map)) {
      this._pendingControlFollowthroughs = new Map();
    }
    return this._pendingControlFollowthroughs;
  }

  clearPendingControlFollowthrough(requestId) {
    const followthroughs =
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
      );
    const pending = followthroughs.get(requestId);
    if (pending?.timer) {
      clearTimeout(pending.timer);
    }
    followthroughs.delete(requestId);
  }

  clearPendingControlFollowthroughs() {
    const followthroughs =
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
      );
    for (const pending of followthroughs.values()) {
      if (pending?.timer) clearTimeout(pending.timer);
    }
    followthroughs.clear();
  }

  ensureAcceptedControlResolutionTrackers() {
    if (!(this._acceptedControlResolutionTrackers instanceof Map)) {
      this._acceptedControlResolutionTrackers = new Map();
    }
    return this._acceptedControlResolutionTrackers;
  }

  clearAcceptedControlResolutionTracker(requestId) {
    const trackers =
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      );
    trackers.delete(requestId);
  }

  clearAcceptedControlResolutionTrackers() {
    const trackers =
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      );
    trackers.clear();
    CodexAppServerSession.prototype.clearAcceptedControlFailureFallbacks.call(
      this
    );
    CodexAppServerSession.prototype.clearAcceptedControlFailureCandidates.call(
      this
    );
  }

  ensureAcceptedControlFailureFallbacks() {
    if (!(this._acceptedControlFailureFallbacks instanceof Map)) {
      this._acceptedControlFailureFallbacks = new Map();
    }
    return this._acceptedControlFailureFallbacks;
  }

  rememberAcceptedControlFailureFallback(requestId, pending) {
    if (!codexControlRequiresProviderResolution(pending?.kind)) return;
    if (pending?.answer?.allow !== true) return;
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
        this
      );
    fallbacks.set(requestId, {
      kind: pending.kind,
      params: pending.params || {},
      itemId: pending.itemId || extractCodexControlItemId(pending.params),
      commandText: extractCodexApprovalCommandText(pending),
      answer: pending.answer || null,
      activeTurnId: pending.activeTurnId || this.activeTurnId || null,
      acknowledged_at_ms: pending.acknowledged_at_ms || null,
      answer_sent_at_ms: pending.answer_sent_at_ms || pending.answer?.sent_at_ms || null,
      accepted_failure_fallback: true,
      followthroughCompleted: pending.followthroughCompleted === true,
    });
  }

  clearAcceptedControlFailureFallback(requestId) {
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
        this
      );
    fallbacks.delete(requestId);
  }

  clearAcceptedControlFailureFallbacks() {
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
        this
      );
    fallbacks.clear();
  }

  ensureAcceptedControlFailureCandidates() {
    if (!(this._acceptedControlFailureCandidates instanceof Map)) {
      this._acceptedControlFailureCandidates = new Map();
    }
    return this._acceptedControlFailureCandidates;
  }

  rememberAcceptedControlFailureCandidate(requestId, pending, context = {}) {
    if (!codexControlRequiresProviderResolution(pending?.kind)) return;
    if (pending?.answer?.allow !== true) return;
    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    const existing = candidates.get(requestId) || {};
    candidates.set(requestId, {
      ...existing,
      kind: pending.kind,
      params: pending.params || existing.params || {},
      itemId:
        pending.itemId ||
        extractCodexControlItemId(pending.params) ||
        existing.itemId ||
        null,
      commandText:
        extractCodexApprovalCommandText(pending, context) ||
        existing.commandText ||
        "",
      answer: pending.answer || existing.answer || null,
      activeTurnId:
        pending.activeTurnId ||
        existing.activeTurnId ||
        this.activeTurnId ||
        null,
      acknowledged_at_ms:
        pending.acknowledged_at_ms ||
        existing.acknowledged_at_ms ||
        (context.ackPayload ? Date.now() : null),
      answer_sent_at_ms:
        pending.answer_sent_at_ms ||
        pending.answer?.sent_at_ms ||
        existing.answer_sent_at_ms ||
        null,
      ackPayload: context.ackPayload || existing.ackPayload || null,
      answer_write_in_progress:
        context.answer_write_in_progress === true ||
        pending.answerWriteInProgress === true,
      accepted_failure_candidate: true,
      followthroughCompleted: pending.followthroughCompleted === true,
    });
  }

  clearAcceptedControlFailureCandidate(requestId) {
    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    candidates.delete(requestId);
  }

  clearAcceptedControlFailureCandidates() {
    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    candidates.clear();
  }

  ensureAcceptedControlFailureLedger() {
    if (!(this._acceptedControlFailureLedger instanceof Map)) {
      this._acceptedControlFailureLedger = new Map();
    }
    return this._acceptedControlFailureLedger;
  }

  rememberAcceptedControlFailureLedger(requestId, pending, context = {}) {
    if (!codexControlRequiresProviderResolution(pending?.kind)) return;
    if (pending?.answer?.allow !== true) return;
    const ledger =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      );
    const existing = ledger.get(requestId) || {};
    ledger.set(requestId, {
      ...existing,
      kind: pending.kind,
      params: pending.params || existing.params || {},
      itemId:
        pending.itemId ||
        extractCodexControlItemId(pending.params) ||
        existing.itemId ||
        null,
      commandText:
        extractCodexApprovalCommandText(pending, context) ||
        existing.commandText ||
        "",
      answer: pending.answer || existing.answer || null,
      activeTurnId:
        pending.activeTurnId ||
        existing.activeTurnId ||
        this.activeTurnId ||
        null,
      acknowledged_at_ms:
        pending.acknowledged_at_ms ||
        existing.acknowledged_at_ms ||
        (context.ackPayload ? Date.now() : null),
      answer_sent_at_ms:
        pending.answer_sent_at_ms ||
        pending.answer?.sent_at_ms ||
        existing.answer_sent_at_ms ||
        null,
      ackPayload: context.ackPayload || existing.ackPayload || null,
      answer_write_in_progress:
        context.answer_write_in_progress === true ||
        pending.answerWriteInProgress === true ||
        existing.answer_write_in_progress === true,
      accepted_failure_ledger: true,
      followthroughCompleted: pending.followthroughCompleted === true,
    });
  }

  clearAcceptedControlFailureLedger(requestId) {
    const ledger =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      );
    ledger.delete(requestId);
  }

  clearAcceptedControlFailureLedgers() {
    const ledger =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      );
    ledger.clear();
  }

  ensureDestructiveTrapControlOutcomes() {
    if (!(this._destructiveTrapControlOutcomes instanceof Map)) {
      this._destructiveTrapControlOutcomes = new Map();
    }
    return this._destructiveTrapControlOutcomes;
  }

  rememberDestructiveTrapControlOutcome(requestId, pending, context = {}) {
    if (pending?.kind !== "command") return null;
    const commandText = extractCodexApprovalCommandText(pending, context);
    if (!isCodexHighRiskStuckTrapCommand(commandText)) return null;
    const outcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    const existing = outcomes.get(requestId) || {};
    const outcome = {
      ...existing,
      kind: pending.kind,
      params: pending.params || existing.params || {},
      itemId:
        pending.itemId ||
        extractCodexControlItemId(pending.params) ||
        existing.itemId ||
        null,
      commandText: commandText || existing.commandText || "",
      answer: pending.answer || existing.answer || null,
      activeTurnId:
        pending.activeTurnId ||
        existing.activeTurnId ||
        this.activeTurnId ||
        null,
      acknowledged_at_ms:
        pending.acknowledged_at_ms ||
        existing.acknowledged_at_ms ||
        (context.ackPayload ? Date.now() : null),
      answer_sent_at_ms:
        pending.answer_sent_at_ms ||
        pending.answer?.sent_at_ms ||
        existing.answer_sent_at_ms ||
        null,
      ackPayload: context.ackPayload || existing.ackPayload || null,
      destructive_trap_control_outcome: true,
      followthroughCompleted: pending.followthroughCompleted === true,
      timer: existing.timer || null,
    };
    outcomes.set(requestId, outcome);
    return outcome;
  }

  clearDestructiveTrapControlOutcome(requestId) {
    const outcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    const outcome = outcomes.get(requestId);
    if (outcome?.timer) {
      clearTimeout(outcome.timer);
    }
    outcomes.delete(requestId);
  }

  clearDestructiveTrapControlOutcomes() {
    const outcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    for (const outcome of outcomes.values()) {
      if (outcome?.timer) clearTimeout(outcome.timer);
    }
    outcomes.clear();
  }

  ensureAcceptedDestructiveTrapFailureFallbacks() {
    if (!(this._acceptedDestructiveTrapFailureFallbacks instanceof Map)) {
      this._acceptedDestructiveTrapFailureFallbacks = new Map();
    }
    return this._acceptedDestructiveTrapFailureFallbacks;
  }

  rememberAcceptedDestructiveTrapFailureFallback(requestId, pending, context = {}) {
    if (pending?.kind !== "command") return null;
    if (pending?.answer?.allow !== true) return null;
    const commandText = extractCodexApprovalCommandText(pending, context);
    if (!isCodexHighRiskStuckTrapCommand(commandText)) return null;
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
        this
      );
    const existing = fallbacks.get(requestId) || {};
    const fallback = {
      ...existing,
      kind: pending.kind,
      params: pending.params || existing.params || {},
      itemId:
        pending.itemId ||
        extractCodexControlItemId(pending.params) ||
        existing.itemId ||
        null,
      commandText: commandText || existing.commandText || "",
      answer: pending.answer || existing.answer || null,
      activeTurnId:
        pending.activeTurnId ||
        existing.activeTurnId ||
        this.activeTurnId ||
        null,
      acknowledged_at_ms:
        pending.acknowledged_at_ms ||
        existing.acknowledged_at_ms ||
        (context.ackPayload ? Date.now() : null),
      answer_sent_at_ms:
        pending.answer_sent_at_ms ||
        pending.answer?.sent_at_ms ||
        existing.answer_sent_at_ms ||
        null,
      ackPayload: context.ackPayload || existing.ackPayload || null,
      accepted_destructive_trap_failure_fallback: true,
      followthroughCompleted: pending.followthroughCompleted === true,
    };
    fallbacks.set(requestId, fallback);
    return fallback;
  }

  clearAcceptedDestructiveTrapFailureFallback(requestId) {
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
        this
      );
    fallbacks.delete(requestId);
  }

  clearAcceptedDestructiveTrapFailureFallbacks() {
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
        this
      );
    fallbacks.clear();
  }

  findAcceptedDestructiveTrapControlForItem(item) {
    const itemCommandText = extractCodexCommandTextFromItem(item);
    const maps = [
      {
        name: "destructive_trap_control_outcome",
        map: CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
          this
        ),
      },
      {
        name: "post_ack_followthrough",
        map: CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
          this
        ),
      },
      {
        name: "accepted_resolution_tracker",
        map: CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
          this
        ),
      },
      {
        name: "accepted_control_failure_fallback",
        map: CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
          this
        ),
      },
      {
        name: "accepted_control_failure_candidate",
        map: CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
          this
        ),
      },
      {
        name: "accepted_control_failure_ledger",
        map: CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
          this
        ),
      },
      {
        name: "accepted_destructive_trap_failure_fallback",
        map: CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
          this
        ),
      },
    ];
    if (this._pendingControls instanceof Map) {
      maps.push({ name: "pending_control", map: this._pendingControls });
    }
    for (const { name, map } of maps) {
      for (const [requestId, pending] of [...map.entries()]) {
        if (pending?.kind !== "command") continue;
        if (pending?.answer?.allow !== true) continue;
        if (pending.followthroughCompleted === true) continue;
        if (!codexAcceptedControlCandidateMatchesItem(pending, item)) continue;
        const commandText =
          extractCodexApprovalCommandText(pending) || itemCommandText;
        if (!isCodexHighRiskStuckTrapCommand(commandText)) continue;
        return {
          requestId,
          pending: {
            ...pending,
            commandText,
          },
          source: name,
        };
      }
    }
    return null;
  }

  failAcceptedDestructiveTrapItemFailure(item, emittedEvents = []) {
    if (
      !emittedEvents.some((event) =>
        codexToolResultIndicatesProviderFailure(event)
      )
    ) {
      return false;
    }
    // Branch 2: an explicit provider/tool failure after an accepted control is
    // normal provider execution failure, not a stuck/no-follow-through reminder.
    return false;
  }

  trackAcceptedControlResolution(requestId, pending, context = {}) {
    if (!codexControlRequiresProviderResolution(pending?.kind)) return null;
    if (pending?.answer?.allow !== true) return null;
    const trackers =
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      );
    const remembered =
      CodexAppServerSession.prototype.getRememberedControlToolItemForPending.call(
        this,
        pending
      );
    const existing = trackers.get(requestId) || {};
    const tracker = {
      ...existing,
      kind: pending.kind,
      params: pending.params || existing.params || {},
      itemId:
        pending.itemId ||
        extractCodexControlItemId(pending.params) ||
        existing.itemId ||
        null,
      commandText:
        extractCodexApprovalCommandText(pending, context) ||
        extractCodexCommandTextFromItem(remembered) ||
        existing.commandText ||
        "",
      answer: pending.answer || existing.answer || null,
      activeTurnId:
        pending.activeTurnId ||
        existing.activeTurnId ||
        this.activeTurnId ||
        null,
      answer_sent_at_ms:
        pending.answer?.sent_at_ms || existing.answer_sent_at_ms || Date.now(),
      acknowledged_at_ms:
        existing.acknowledged_at_ms ||
        (context.ackPayload ? Date.now() : null),
      ackPayload: context.ackPayload || existing.ackPayload || null,
      followthroughCompleted: pending.followthroughCompleted === true,
    };
    trackers.set(requestId, tracker);
    CodexAppServerSession.prototype.rememberAcceptedControlFailureFallback.call(
      this,
      requestId,
      tracker
    );
    CodexAppServerSession.prototype.rememberAcceptedControlFailureCandidate.call(
      this,
      requestId,
      tracker,
      context
    );
    CodexAppServerSession.prototype.rememberAcceptedControlFailureLedger.call(
      this,
      requestId,
      tracker,
      context
    );
    CodexAppServerSession.prototype.rememberDestructiveTrapControlOutcome.call(
      this,
      requestId,
      tracker,
      context
    );
    CodexAppServerSession.prototype.rememberAcceptedDestructiveTrapFailureFallback.call(
      this,
      requestId,
      tracker,
      context
    );
    return tracker;
  }

  preparePendingControlAnswerWrite(requestId, pending, payload) {
    if (!codexControlRequiresProviderResolution(pending?.kind)) return;
    if (payload?.allow !== true) return;
    const sentAt = pending.answer?.sent_at_ms || Date.now();
    pending.answerWriteInProgress = true;
    pending.answer = {
      allow: true,
      sent_at_ms: sentAt,
      write_in_progress: true,
    };
    pending.activeTurnId = pending.activeTurnId || this.activeTurnId || null;
    pending.itemId = pending.itemId || extractCodexControlItemId(pending.params);
    if (pending.kind === "command" && !pending.commandText) {
      const remembered =
        CodexAppServerSession.prototype.getRememberedControlToolItemForPending.call(
          this,
          pending
        );
      pending.commandText =
        extractCodexCommandTextFromParams(pending.params) ||
        extractCodexCommandTextFromItem(remembered) ||
        "";
    }
    CodexAppServerSession.prototype.trackAcceptedControlResolution.call(
      this,
      requestId,
      pending,
      { answer_write_in_progress: true }
    );
  }

  clearPendingControlAnswerWrite(requestId, pending) {
    if (pending?.answerWriteInProgress === true) {
      delete pending.answerWriteInProgress;
      if (pending.answer?.write_in_progress === true) {
        delete pending.answer;
      }
    }
    CodexAppServerSession.prototype.clearAcceptedControlResolutionTracker.call(
      this,
      requestId
    );
    CodexAppServerSession.prototype.clearAcceptedControlFailureFallback.call(
      this,
      requestId
    );
    CodexAppServerSession.prototype.clearAcceptedControlFailureCandidate.call(
      this,
      requestId
    );
    CodexAppServerSession.prototype.clearAcceptedControlFailureLedger.call(
      this,
      requestId
    );
  }

  clearPendingControl(requestId) {
    CodexAppServerSession.prototype.clearPendingControlAckTimer.call(
      this,
      requestId
    );
    this._pendingControls.delete(requestId);
  }

  emitControlResponseFailure(requestId, pending, message, context = {}) {
    const formatted = formatCodexAcceptedControlFailure(
      pending,
      message,
      context
    );
    this.emit("event", {
      type: "runtime.error",
      provider: this.provider,
      request_id: requestId,
      subtype: "control.response_failure",
      error: formatted.message,
      context: {
        control_kind: pending?.kind || null,
        original_command_text: formatted.originalCommandText,
        stuck_trap_reminder: formatted.stuckTrap,
        fail_visible_reminder: formatted.failVisibleReminder,
        provider_functionality_pass: formatted.failVisibleReminder ? false : null,
        ...context,
      },
    });
    CodexAppServerSession.prototype.emitControlFailureCompletion.call(
      this,
      requestId,
      pending,
      formatted.message,
      {
        original_command_text: formatted.originalCommandText,
        stuck_trap_reminder: formatted.stuckTrap,
        fail_visible_reminder: formatted.failVisibleReminder,
        provider_functionality_pass: formatted.failVisibleReminder ? false : null,
        ...context,
      }
    );
    CodexAppServerSession.prototype.clearAcceptedControlResolutionTracker.call(
      this,
      requestId
    );
    CodexAppServerSession.prototype.clearAcceptedControlFailureFallback.call(
      this,
      requestId
    );
    CodexAppServerSession.prototype.clearAcceptedControlFailureCandidate.call(
      this,
      requestId
    );
    CodexAppServerSession.prototype.clearDestructiveTrapControlOutcome.call(
      this,
      requestId
    );
    CodexAppServerSession.prototype.clearAcceptedDestructiveTrapFailureFallback.call(
      this,
      requestId
    );
  }

  emitControlFailureCompletion(requestId, pending, message, context = {}) {
    if (!codexControlRequiresProviderResolution(pending?.kind)) return;
    const rejectedTrapException =
      context.destructive_trap_exception === true &&
      pending?.kind === "command" &&
      pending?.answer?.allow === false;
    if (pending?.answer && pending.answer.allow !== true && !rejectedTrapException) {
      return;
    }
    const turnId =
      context.turn_id ||
      pending?.activeTurnId ||
      this.activeTurnId ||
      null;
    if (!turnId) return;
    if (!(this._failedControlFollowthroughTurnIds instanceof Set)) {
      this._failedControlFollowthroughTurnIds = new Set();
    }
    const pendingActiveTurnId =
      typeof pending?.activeTurnId === "string" && pending.activeTurnId.trim()
        ? pending.activeTurnId.trim()
        : null;
    const failedTurnIds = [turnId];
    if (
      context.turn_id_mismatch === true &&
      pendingActiveTurnId &&
      pendingActiveTurnId !== turnId
    ) {
      failedTurnIds.push(pendingActiveTurnId);
    }
    if (
      failedTurnIds.some((id) => this._failedControlFollowthroughTurnIds.has(id))
    ) {
      return;
    }
    for (const id of failedTurnIds) {
      this._failedControlFollowthroughTurnIds.add(id);
    }
    if (
      failedTurnIds.includes(this.activeTurnId) ||
      (context.turn_id_mismatch === true &&
        pendingActiveTurnId &&
        this.activeTurnId === pendingActiveTurnId)
    ) {
      this.activeTurnId = null;
    }
    this._awaitingTurnStart = false;
    this._steerWaitTurnId = null;
    this.emit("event", {
      type: "turn.completed",
      provider: this.provider,
      thread_id: this.threadId,
      request_id: requestId,
      turn_id: turnId,
      provider_turn_id: turnId,
      status: "failed",
      provider_completion_status: "failed",
      provider_completion_success: false,
      error: message,
      display_text: message,
      body: message,
      text: message,
      semantic_body: message,
      control_response_failure: true,
      context: {
        control_kind: pending?.kind || null,
        ...context,
      },
      usage: null,
    });
  }

  writeControlResponse(requestId, pending, responsePayload) {
    try {
      this.writeJson(responsePayload);
    } catch (err) {
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        `Codex ${pending?.kind || "unknown"} control response write failed: ${
          err.message || String(err)
        }`,
        {
          phase: "control_response_write",
          accepted_control_response:
            responsePayload?.result?.decision === "accept",
          control_response_delivery_failure: true,
          control_response_delivery_correlation_failure: true,
          provider_execution_failure: false,
        }
      );
      throw err;
    }
  }

  rememberControlToolItem(item) {
    if (!isPlainObject(item)) return;
    const commandText = extractCodexCommandTextFromItem(item);
    const commandLike =
      item.type === "commandExecution" ||
      item.name === "exec_command" ||
      item.toolName === "exec_command" ||
      item.tool_name === "exec_command";
    const fileChangeLike = item.type === "fileChange";
    if (!commandLike && !fileChangeLike) return;
    const itemId = typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : null;
    if (!itemId) return;
    if (!(this._controlToolItems instanceof Map)) {
      this._controlToolItems = new Map();
    }
    this._controlToolItems.set(itemId, {
      ...item,
      type: commandLike ? "commandExecution" : item.type,
      commandText: commandText || null,
    });
    if (commandLike && commandText) {
      for (const pending of this._pendingControls?.values?.() || []) {
        const pendingItemId =
          pending?.itemId || extractCodexControlItemId(pending?.params);
        if (pendingItemId === itemId && !pending.commandText) {
          pending.commandText = commandText;
        }
      }
    }
  }

  forgetControlToolItem(item) {
    const itemId = extractCodexControlItemId(item);
    if (!itemId || !(this._controlToolItems instanceof Map)) return;
    this._controlToolItems.delete(itemId);
  }

  getRememberedControlToolItem(itemId) {
    if (!itemId || !(this._controlToolItems instanceof Map)) return null;
    return this._controlToolItems.get(itemId) || null;
  }

  getSingleRememberedControlToolItemForKind(kind) {
    if (!(this._controlToolItems instanceof Map)) return null;
    const candidates = [...this._controlToolItems.values()].filter((item) => {
      if (kind === "command") {
        return Boolean(extractCodexCommandTextFromItem(item));
      }
      if (kind === "patch") {
        return item?.type === "fileChange";
      }
      return false;
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  getRememberedControlToolItemForPending(pending) {
    const itemId = pending?.itemId || extractCodexControlItemId(pending?.params);
    const remembered =
      CodexAppServerSession.prototype.getRememberedControlToolItem.call(
        this,
        itemId
      );
    if (remembered) return remembered;
    return CodexAppServerSession.prototype.getSingleRememberedControlToolItemForKind.call(
      this,
      pending?.kind
    );
  }

  armPendingControlFollowthrough(requestId, pending, ackPayload = {}) {
    if (!codexControlRequiresProviderResolution(pending?.kind)) return;
    if (pending?.answer?.allow !== true) return;
    if (pending.followthroughCompleted === true) return;

    const acceptedTracker =
      CodexAppServerSession.prototype.trackAcceptedControlResolution.call(
        this,
        requestId,
        pending,
        { ackPayload }
      );
    const followthroughs =
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
      );
    CodexAppServerSession.prototype.clearPendingControlFollowthrough.call(
      this,
      requestId
    );
    const tracker = {
      kind: pending.kind,
      params: pending.params || {},
      itemId: pending.itemId || extractCodexControlItemId(pending.params),
      commandText:
        extractCodexApprovalCommandText(pending) ||
        acceptedTracker?.commandText ||
        "",
      answer: pending.answer || null,
      ackPayload,
      activeTurnId:
        pending.activeTurnId ||
        acceptedTracker?.activeTurnId ||
        this.activeTurnId ||
        null,
      acknowledged_at_ms: Date.now(),
      timer: null,
    };
    const timer = setTimeout(() => {
      CodexAppServerSession.prototype.emitControlFollowthroughFailure.call(
        this,
        requestId,
        tracker,
        `Codex accepted ${tracker.kind} control was acknowledged but no provider ${tracker.kind} completion arrived before timeout`,
        {
          phase: "post_ack_followthrough",
          timeout_ms: CODEX_CONTROL_FOLLOWTHROUGH_TIMEOUT_MS,
        }
      );
    }, CODEX_CONTROL_FOLLOWTHROUGH_TIMEOUT_MS);
    tracker.timer = timer;
    followthroughs.set(requestId, tracker);
  }

  emitControlFollowthroughFailure(requestId, pending, message, context = {}) {
    const turnId =
      pending?.activeTurnId || this.activeTurnId || context.turn_id || null;
    CodexAppServerSession.prototype.emitControlResponseFailure.call(
      this,
      requestId,
      pending,
      message,
      {
        phase: "post_ack_followthrough",
        item_id: pending?.itemId || null,
        turn_id: turnId,
        ...context,
      }
    );
    CodexAppServerSession.prototype.clearPendingControlFollowthrough.call(
      this,
      requestId
    );
  }

  failPendingControlFollowthroughsForTurn(turn, context = {}) {
    const followthroughs =
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
      );
    if (followthroughs.size === 0) return false;
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    const entries = [...followthroughs.entries()].filter(([, pending]) => {
      return codexAcceptedControlMatchesTurnForFailure(pending, turn);
    });
    if (entries.length === 0) return false;
    for (const [requestId, pending] of entries) {
      const deliveryCorrelationFailure =
        codexAcceptedControlTurnMismatch(pending, turn);
      CodexAppServerSession.prototype.emitControlFollowthroughFailure.call(
        this,
        requestId,
        pending,
        `Codex accepted ${pending.kind} control reached turn completion before provider ${pending.kind} completion`,
        {
          phase: "turn.completed",
          turn_id: turnId,
          turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
          accepted_control_active_turn_id: pending.activeTurnId || null,
          status: turn?.status || null,
          control_response_delivery_correlation_failure:
            deliveryCorrelationFailure,
          provider_execution_failure: deliveryCorrelationFailure ? false : null,
          ...context,
        }
      );
    }
    return true;
  }

  failAcceptedControlResolutionTrackersForTurn(turn, context = {}) {
    const trackers =
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      );
    if (trackers.size === 0) return false;
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    const entries = [...trackers.entries()].filter(([, pending]) => {
      if (pending.followthroughCompleted === true) return false;
      return codexAcceptedControlMatchesTurnForFailure(pending, turn);
    });
    if (entries.length === 0) return false;
    for (const [requestId, pending] of entries) {
      const deliveryCorrelationFailure =
        !pending.acknowledged_at_ms ||
        codexAcceptedControlTurnMismatch(pending, turn);
      const message = pending.acknowledged_at_ms
        ? `Codex accepted ${pending.kind} control reached turn completion before provider ${pending.kind} completion`
        : `Codex accepted ${pending.kind} control reached turn completion before app-server acknowledgement or provider ${pending.kind} completion`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          phase: "turn.completed",
          item_id: pending.itemId || null,
          turn_id: turnId,
          turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
          accepted_control_active_turn_id: pending.activeTurnId || null,
          status: turn?.status || null,
          accepted_resolution_tracker: true,
          awaiting_ack: !pending.acknowledged_at_ms,
          control_response_delivery_correlation_failure:
            deliveryCorrelationFailure,
          provider_execution_failure: deliveryCorrelationFailure ? false : null,
          ...context,
        }
      );
    }
    return true;
  }

  failAcceptedControlFailureFallbacksForTurn(turn, context = {}) {
    if (turn?.status !== "failed" && !turn?.error) return false;
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
        this
      );
    if (fallbacks.size === 0) return false;
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    const entries = [...fallbacks.entries()].filter(([, pending]) => {
      if (pending.followthroughCompleted === true) return false;
      return codexAcceptedControlMatchesTurnForFailure(pending, turn);
    });
    if (entries.length === 0) return false;
    for (const [requestId, pending] of entries) {
      const deliveryCorrelationFailure =
        !pending.acknowledged_at_ms ||
        codexAcceptedControlTurnMismatch(pending, turn);
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        `Codex accepted ${pending.kind} control reached failed turn completion before provider ${pending.kind} completion`,
        {
          phase: "turn.completed",
          item_id: pending.itemId || null,
          turn_id: turnId,
          turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
          accepted_control_active_turn_id: pending.activeTurnId || null,
          status: turn?.status || null,
          accepted_control_failure_fallback: true,
          control_response_delivery_correlation_failure:
            deliveryCorrelationFailure,
          provider_execution_failure: deliveryCorrelationFailure ? false : null,
          ...context,
        }
      );
      CodexAppServerSession.prototype.clearAcceptedControlFailureFallback.call(
        this,
        requestId
      );
    }
    return true;
  }

  failAcceptedControlFailureCandidatesForTurn(turn, context = {}) {
    if (turn?.status !== "failed" && !turn?.error) return false;
    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    if (candidates.size === 0) return false;
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    const entries = [...candidates.entries()].filter(([, pending]) => {
      if (pending.followthroughCompleted === true) return false;
      return codexAcceptedControlMatchesTurnForFailure(pending, turn);
    });
    if (entries.length === 0) return false;
    for (const [requestId, pending] of entries) {
      const deliveryCorrelationFailure =
        !pending.acknowledged_at_ms ||
        pending.answer_write_in_progress === true ||
        codexAcceptedControlTurnMismatch(pending, turn);
      const message = pending.acknowledged_at_ms
        ? `Codex accepted ${pending.kind} control reached failed turn lifecycle before matching provider ${pending.kind} completion or tool result`
        : `Codex accepted ${pending.kind} control reached failed turn lifecycle before app-server acknowledgement or matching provider ${pending.kind} completion/tool result`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          phase: "turn.completed",
          item_id: pending.itemId || null,
          turn_id: turnId,
          turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
          accepted_control_active_turn_id: pending.activeTurnId || null,
          status: turn?.status || null,
          accepted_control_failure_candidate: true,
          failed_lifecycle_without_matching_tool_result: true,
          missing_matching_completion: true,
          awaiting_ack: !pending.acknowledged_at_ms,
          answer_write_in_progress: pending.answer_write_in_progress === true,
          control_response_delivery_correlation_failure:
            deliveryCorrelationFailure,
          provider_execution_failure: deliveryCorrelationFailure ? false : null,
          ...context,
        }
      );
      CodexAppServerSession.prototype.clearAcceptedControlFailureCandidate.call(
        this,
        requestId
      );
    }
    return true;
  }

  failAcceptedControlFailureLedgersForTurn(turn, context = {}) {
    if (turn?.status !== "failed" && !turn?.error) return false;
    const ledger =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      );
    if (ledger.size === 0) return false;
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    const entries = [...ledger.entries()].filter(([, pending]) => {
      if (pending.followthroughCompleted === true) return false;
      return codexAcceptedControlMatchesTurnForFailure(pending, turn);
    });
    if (entries.length === 0) return false;
    for (const [requestId, pending] of entries) {
      const deliveryCorrelationFailure =
        !pending.acknowledged_at_ms ||
        pending.answer_write_in_progress === true ||
        codexAcceptedControlTurnMismatch(pending, turn);
      const message = pending.acknowledged_at_ms
        ? `Codex accepted ${pending.kind} control reached failed turn lifecycle after durable accepted outcome before matching provider ${pending.kind} completion or tool result`
        : `Codex accepted ${pending.kind} control reached failed turn lifecycle after durable accepted outcome before app-server acknowledgement or matching provider ${pending.kind} completion/tool result`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          phase: "turn.completed",
          item_id: pending.itemId || null,
          turn_id: turnId,
          turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
          accepted_control_active_turn_id: pending.activeTurnId || null,
          status: turn?.status || null,
          accepted_control_failure_ledger: true,
          durable_accepted_outcome: true,
          failed_lifecycle_without_matching_tool_result: true,
          missing_matching_completion: true,
          awaiting_ack: !pending.acknowledged_at_ms,
          answer_write_in_progress: pending.answer_write_in_progress === true,
          control_response_delivery_correlation_failure:
            deliveryCorrelationFailure,
          provider_execution_failure: deliveryCorrelationFailure ? false : null,
          ...context,
        }
      );
      CodexAppServerSession.prototype.clearAcceptedControlFailureLedger.call(
        this,
        requestId
      );
    }
    return true;
  }

  failAcceptedDestructiveTrapOutcomesForTurn(turn, context = {}) {
    const outcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    if (outcomes.size === 0) return false;
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    const entries = [...outcomes.entries()].filter(([, pending]) => {
      if (pending.followthroughCompleted === true) return false;
      if (pending?.answer?.allow !== true) return false;
      return codexAcceptedControlMatchesTurnForFailure(pending, turn);
    });
    if (entries.length === 0) return false;
    for (const [requestId, pending] of entries) {
      const failedLifecycle = turn?.status === "failed" || Boolean(turn?.error);
      const deliveryCorrelationFailure =
        !pending.acknowledged_at_ms ||
        codexAcceptedControlTurnMismatch(pending, turn);
      const message = failedLifecycle
        ? `Codex accepted destructive-trap command reached failed lifecycle before matching provider command completion/tool result`
        : `Codex accepted destructive-trap command reached turn completion before matching provider command completion/tool result`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          phase: "turn.completed",
          item_id: pending.itemId || null,
          turn_id: turnId,
          turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
          accepted_control_active_turn_id: pending.activeTurnId || null,
          status: turn?.status || null,
          destructive_trap_exception: true,
          accepted_control_response: true,
          destructive_trap_control_outcome: true,
          failed_lifecycle_without_matching_tool_result: failedLifecycle,
          missing_matching_completion: true,
          awaiting_ack: !pending.acknowledged_at_ms,
          control_response_delivery_correlation_failure:
            deliveryCorrelationFailure,
          provider_execution_failure: deliveryCorrelationFailure ? false : null,
          ...context,
        }
      );
    }
    return true;
  }

  failAcceptedDestructiveTrapFailureFallbacksForTurn(turn, context = {}) {
    if (turn?.status !== "failed" && !turn?.error) return false;
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
        this
      );
    if (fallbacks.size === 0) return false;
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    const entries = [...fallbacks.entries()].filter(([, pending]) => {
      if (pending.followthroughCompleted === true) return false;
      if (pending?.answer?.allow !== true) return false;
      return codexAcceptedControlMatchesTurnForFailure(pending, turn);
    });
    if (entries.length === 0) return false;
    for (const [requestId, pending] of entries) {
      const deliveryCorrelationFailure =
        !pending.acknowledged_at_ms ||
        codexAcceptedControlTurnMismatch(pending, turn);
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        `Codex accepted destructive-trap command reached failed lifecycle before matching provider command completion/tool result`,
        {
          phase: "turn.completed",
          item_id: pending.itemId || null,
          turn_id: turnId,
          turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
          accepted_control_active_turn_id: pending.activeTurnId || null,
          status: turn?.status || null,
          destructive_trap_exception: true,
          accepted_control_response: true,
          destructive_trap_control_outcome: true,
          accepted_destructive_trap_failure_fallback: true,
          failed_lifecycle_without_matching_tool_result: true,
          missing_matching_completion: true,
          awaiting_ack: !pending.acknowledged_at_ms,
          control_response_delivery_correlation_failure:
            deliveryCorrelationFailure,
          provider_execution_failure: deliveryCorrelationFailure ? false : null,
          ...context,
        }
      );
      CodexAppServerSession.prototype.clearAcceptedDestructiveTrapFailureFallback.call(
        this,
        requestId
      );
    }
    return true;
  }

  clearRejectedDestructiveTrapOutcomesForTurn(turn) {
    const outcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    if (outcomes.size === 0) return;
    for (const [requestId, pending] of [...outcomes.entries()]) {
      if (pending?.answer?.allow !== false) continue;
      if (!codexAcceptedControlMatchesTurnForFailure(pending, turn)) continue;
      CodexAppServerSession.prototype.clearDestructiveTrapControlOutcome.call(
        this,
        requestId
      );
    }
  }

  armRejectedDestructiveTrapNoFollowthrough(requestId, pending, ackPayload = {}) {
    if (pending?.kind !== "command") return null;
    if (pending?.answer?.allow !== false) return null;
    const outcome =
      CodexAppServerSession.prototype.rememberDestructiveTrapControlOutcome.call(
        this,
        requestId,
        pending,
        { ackPayload }
      );
    if (!outcome) return null;
    if (outcome.timer) {
      clearTimeout(outcome.timer);
      outcome.timer = null;
    }
    const timer = setTimeout(() => {
      const outcomes =
        CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
          this
        );
      const current = outcomes.get(requestId);
      if (!current || current.answer?.allow !== false) return;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        current,
        `Codex rejected destructive-trap command did not close provider turn before timeout`,
        {
          phase: "post_reject_no_followthrough",
          timeout_ms: CODEX_CONTROL_FOLLOWTHROUGH_TIMEOUT_MS,
          item_id: current.itemId || null,
          turn_id: current.activeTurnId || this.activeTurnId || null,
          destructive_trap_exception: true,
          rejected_control_response: true,
          destructive_trap_control_outcome: true,
          missing_matching_completion: true,
        }
      );
      if (typeof this.drainPendingMessages === "function") {
        this.drainPendingMessages();
      }
    }, CODEX_CONTROL_FOLLOWTHROUGH_TIMEOUT_MS);
    outcome.timer = timer;
    return outcome;
  }

  clearAcceptedControlFailureCandidatesForTurn(turn) {
    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    if (candidates.size === 0) return;
    for (const [requestId, pending] of [...candidates.entries()]) {
      if (codexAcceptedControlMatchesTurnForFailure(pending, turn)) {
        CodexAppServerSession.prototype.clearAcceptedControlFailureCandidate.call(
          this,
          requestId
        );
      }
    }
  }

  clearBranch2AcceptedControlFailureStateForTurn(turn) {
    if (!codexTurnIsExplicitProviderFailure(turn)) return false;
    let cleared = false;
    const maps = [
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
      ),
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      ),
      CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
        this
      ),
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      ),
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      ),
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      ),
      CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
        this
      ),
    ];
    const branch2RequestIds = new Set();
    for (const map of maps) {
      for (const [requestId, pending] of [...map.entries()]) {
        if (!codexAcceptedControlMatchesTurnForFailure(pending, turn)) continue;
        if (!codexAcceptedControlIsBranch2ProviderFailure(pending, turn)) continue;
        branch2RequestIds.add(requestId);
      }
    }
    const clearIfBranch2 = (requestId, pending, clearFn) => {
      if (!branch2RequestIds.has(requestId)) return;
      if (!codexAcceptedControlMatchesTurnForFailure(pending, turn)) return;
      if (pending?.answer?.allow !== true) return;
      if (pending.answerWriteInProgress === true) return;
      if (codexAcceptedControlTurnMismatch(pending, turn)) return;
      pending.followthroughCompleted = true;
      clearFn.call(this, requestId);
      cleared = true;
    };
    const followthroughs =
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
      );
    for (const [requestId, pending] of [...followthroughs.entries()]) {
      clearIfBranch2(
        requestId,
        pending,
        CodexAppServerSession.prototype.clearPendingControlFollowthrough
      );
    }
    const trackers =
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      );
    for (const [requestId, pending] of [...trackers.entries()]) {
      clearIfBranch2(
        requestId,
        pending,
        CodexAppServerSession.prototype.clearAcceptedControlResolutionTracker
      );
    }
    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
        this
      );
    for (const [requestId, pending] of [...fallbacks.entries()]) {
      clearIfBranch2(
        requestId,
        pending,
        CodexAppServerSession.prototype.clearAcceptedControlFailureFallback
      );
    }
    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    for (const [requestId, pending] of [...candidates.entries()]) {
      clearIfBranch2(
        requestId,
        pending,
        CodexAppServerSession.prototype.clearAcceptedControlFailureCandidate
      );
    }
    const ledger =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      );
    for (const [requestId, pending] of [...ledger.entries()]) {
      clearIfBranch2(
        requestId,
        pending,
        CodexAppServerSession.prototype.clearAcceptedControlFailureLedger
      );
    }
    const destructiveOutcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    for (const [requestId, pending] of [...destructiveOutcomes.entries()]) {
      clearIfBranch2(
        requestId,
        pending,
        CodexAppServerSession.prototype.clearDestructiveTrapControlOutcome
      );
    }
    const destructiveFallbacks =
      CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
        this
      );
    for (const [requestId, pending] of [...destructiveFallbacks.entries()]) {
      clearIfBranch2(
        requestId,
        pending,
        CodexAppServerSession.prototype.clearAcceptedDestructiveTrapFailureFallback
      );
    }
    return cleared;
  }

  failPendingAcceptedControlsForTurn(turn, context = {}) {
    const turnId =
      typeof turn?.id === "string" && turn.id.trim() ? turn.id.trim() : null;
    let failed = false;
    if (this._pendingControls instanceof Map) {
      for (const [requestId, pending] of [...this._pendingControls.entries()]) {
        if (
          !codexAcceptedControlAnswerInFlight(pending) ||
          !codexControlRequiresProviderResolution(pending.kind)
        ) {
          continue;
        }
        if (!codexAcceptedControlMatchesTurnForFailure(pending, turn)) {
          continue;
        }
        CodexAppServerSession.prototype.emitControlResponseFailure.call(
          this,
          requestId,
          pending,
          `Codex accepted ${pending.kind} control reached turn completion before app-server acknowledgement`,
          {
            phase: "turn.completed",
            item_id: extractCodexControlItemId(pending.params),
            turn_id: turnId,
            turn_id_mismatch: codexAcceptedControlTurnMismatch(pending, turn),
            accepted_control_active_turn_id: pending.activeTurnId || null,
            status: turn?.status || null,
            awaiting_ack: true,
            answer_write_in_progress: pending.answerWriteInProgress === true,
            control_response_delivery_failure: true,
            control_response_delivery_correlation_failure: true,
            provider_execution_failure: false,
            ...context,
          }
        );
        CodexAppServerSession.prototype.clearPendingControl.call(
          this,
          requestId
        );
        failed = true;
      }
    }
    CodexAppServerSession.prototype.clearBranch2AcceptedControlFailureStateForTurn.call(
      this,
      turn
    );
    const failedFollowthrough =
      CodexAppServerSession.prototype.failPendingControlFollowthroughsForTurn.call(
        this,
        turn,
        context
      );
    const failedAcceptedTracker =
      CodexAppServerSession.prototype.failAcceptedControlResolutionTrackersForTurn.call(
        this,
        turn,
        context
      );
    const failedAcceptedFallback =
      CodexAppServerSession.prototype.failAcceptedControlFailureFallbacksForTurn.call(
        this,
        turn,
        context
      );
    const failedAcceptedCandidate =
      CodexAppServerSession.prototype.failAcceptedControlFailureCandidatesForTurn.call(
        this,
        turn,
        context
      );
    const failedAcceptedLedger =
      CodexAppServerSession.prototype.failAcceptedControlFailureLedgersForTurn.call(
        this,
        turn,
        context
      );
    const failedDestructiveTrapOutcome =
      CodexAppServerSession.prototype.failAcceptedDestructiveTrapOutcomesForTurn.call(
        this,
        turn,
        context
      );
    const failedAcceptedDestructiveTrapFallback =
      CodexAppServerSession.prototype.failAcceptedDestructiveTrapFailureFallbacksForTurn.call(
        this,
        turn,
        context
      );
    return (
      failed ||
      failedFollowthrough ||
      failedAcceptedTracker ||
      failedAcceptedFallback ||
      failedAcceptedCandidate ||
      failedAcceptedLedger ||
      failedDestructiveTrapOutcome ||
      failedAcceptedDestructiveTrapFallback
    );
  }

  failPendingControlsOnProviderTermination(context = {}) {
    let failed = false;
    const phase =
      typeof context.phase === "string" && context.phase.trim()
        ? context.phase.trim()
        : "provider.terminated";
    const suffix =
      phase === "provider.error"
        ? ` because app-server errored${context.error ? `: ${context.error}` : ""}`
        : ` because app-server exited${context.signal ? ` with signal ${context.signal}` : ""}${
            context.code !== undefined && context.code !== null
              ? ` (code=${context.code})`
              : ""
          }`;

    if (this._pendingControls instanceof Map) {
      for (const [requestId, pending] of [...this._pendingControls.entries()]) {
        if (
          codexAcceptedControlAnswerInFlight(pending) &&
          codexControlRequiresProviderResolution(pending.kind)
        ) {
          CodexAppServerSession.prototype.emitControlResponseFailure.call(
            this,
            requestId,
            pending,
            `Codex accepted ${pending.kind} control was interrupted before app-server acknowledgement${suffix}`,
            {
              ...context,
              phase,
              item_id: extractCodexControlItemId(pending.params),
              turn_id: this.activeTurnId || null,
            }
          );
          CodexAppServerSession.prototype.clearPendingControl.call(
            this,
            requestId
          );
          failed = true;
        }
      }
    }

    const followthroughs =
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
      );
    for (const [requestId, pending] of [...followthroughs.entries()]) {
      CodexAppServerSession.prototype.emitControlFollowthroughFailure.call(
        this,
        requestId,
        pending,
        `Codex accepted ${pending.kind} control was interrupted before provider ${pending.kind} completion${suffix}`,
        {
          ...context,
          phase,
        }
      );
      failed = true;
    }

    const trackers =
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      );
    for (const [requestId, pending] of [...trackers.entries()]) {
      if (pending.followthroughCompleted === true) continue;
      const message = pending.acknowledged_at_ms
        ? `Codex accepted ${pending.kind} control was interrupted before provider ${pending.kind} completion${suffix}`
        : `Codex accepted ${pending.kind} control was interrupted before app-server acknowledgement or provider ${pending.kind} completion${suffix}`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          ...context,
          phase,
          item_id: pending.itemId || null,
          turn_id: pending.activeTurnId || this.activeTurnId || null,
          accepted_resolution_tracker: true,
          awaiting_ack: !pending.acknowledged_at_ms,
        }
      );
      failed = true;
    }

    const fallbacks =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureFallbacks.call(
        this
      );
    for (const [requestId, pending] of [...fallbacks.entries()]) {
      if (pending.followthroughCompleted === true) continue;
      const message = pending.acknowledged_at_ms
        ? `Codex accepted ${pending.kind} control was interrupted before provider ${pending.kind} completion${suffix}`
        : `Codex accepted ${pending.kind} control was interrupted before app-server acknowledgement or provider ${pending.kind} completion${suffix}`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          ...context,
          phase,
          item_id: pending.itemId || null,
          turn_id: pending.activeTurnId || this.activeTurnId || null,
          accepted_control_failure_fallback: true,
          awaiting_ack: !pending.acknowledged_at_ms,
        }
      );
      CodexAppServerSession.prototype.clearAcceptedControlFailureFallback.call(
        this,
        requestId
      );
      failed = true;
    }

    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    for (const [requestId, pending] of [...candidates.entries()]) {
      if (pending.followthroughCompleted === true) continue;
      const message = pending.acknowledged_at_ms
        ? `Codex accepted ${pending.kind} control was interrupted before matching provider ${pending.kind} completion or tool result${suffix}`
        : `Codex accepted ${pending.kind} control was interrupted before app-server acknowledgement or matching provider ${pending.kind} completion/tool result${suffix}`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          ...context,
          phase,
          item_id: pending.itemId || null,
          turn_id: pending.activeTurnId || this.activeTurnId || null,
          accepted_control_failure_candidate: true,
          missing_matching_completion: true,
          awaiting_ack: !pending.acknowledged_at_ms,
        }
      );
      CodexAppServerSession.prototype.clearAcceptedControlFailureCandidate.call(
        this,
        requestId
      );
      failed = true;
    }

    const ledger =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      );
    for (const [requestId, pending] of [...ledger.entries()]) {
      if (pending.followthroughCompleted === true) continue;
      const message = pending.acknowledged_at_ms
        ? `Codex accepted ${pending.kind} control was interrupted after durable accepted outcome before matching provider ${pending.kind} completion or tool result${suffix}`
        : `Codex accepted ${pending.kind} control was interrupted after durable accepted outcome before app-server acknowledgement or matching provider ${pending.kind} completion/tool result${suffix}`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          ...context,
          phase,
          item_id: pending.itemId || null,
          turn_id: pending.activeTurnId || this.activeTurnId || null,
          accepted_control_failure_ledger: true,
          durable_accepted_outcome: true,
          missing_matching_completion: true,
          awaiting_ack: !pending.acknowledged_at_ms,
        }
      );
      CodexAppServerSession.prototype.clearAcceptedControlFailureLedger.call(
        this,
        requestId
      );
      failed = true;
    }

    const destructiveOutcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    for (const [requestId, pending] of [...destructiveOutcomes.entries()]) {
      if (pending.followthroughCompleted === true) continue;
      const rejected = pending.answer?.allow === false;
      const message = rejected
        ? `Codex rejected destructive-trap command was interrupted before provider turn closure${suffix}`
        : `Codex accepted destructive-trap command was interrupted before matching provider command completion/tool result${suffix}`;
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        pending,
        message,
        {
          ...context,
          phase,
          item_id: pending.itemId || null,
          turn_id: pending.activeTurnId || this.activeTurnId || null,
          destructive_trap_exception: true,
          accepted_control_response: pending.answer?.allow === true,
          rejected_control_response: rejected,
          destructive_trap_control_outcome: true,
          missing_matching_completion: true,
          awaiting_ack: !pending.acknowledged_at_ms,
        }
      );
      failed = true;
    }

    return failed;
  }

  noteControlFollowthroughItemCompleted(item, emittedEvents = []) {
    if (!isPlainObject(item)) return;
    if (!emittedEvents.some((event) => event?.type === "tool.result")) return;
    if (
      CodexAppServerSession.prototype.failAcceptedDestructiveTrapItemFailure.call(
        this,
        item,
        emittedEvents
      )
    ) {
      return;
    }
    if (this._pendingControls instanceof Map) {
      for (const pending of this._pendingControls.values()) {
        if (
          pending?.answerSent === true &&
          pending?.answer?.allow === true &&
          codexFollowthroughMatchesItem(pending, item)
        ) {
          pending.followthroughCompleted = true;
        }
      }
    }
    const followthroughs =
      CodexAppServerSession.prototype.ensurePendingControlFollowthroughs.call(
        this
    );
    for (const [requestId, pending] of [...followthroughs.entries()]) {
      if (codexFollowthroughMatchesItem(pending, item)) {
        CodexAppServerSession.prototype.clearPendingControlFollowthrough.call(
          this,
          requestId
        );
        CodexAppServerSession.prototype.clearAcceptedControlResolutionTracker.call(
          this,
          requestId
        );
        CodexAppServerSession.prototype.clearAcceptedControlFailureFallback.call(
          this,
          requestId
        );
      }
    }
    const trackers =
      CodexAppServerSession.prototype.ensureAcceptedControlResolutionTrackers.call(
        this
      );
    for (const [requestId, pending] of [...trackers.entries()]) {
      if (codexFollowthroughMatchesItem(pending, item)) {
        pending.followthroughCompleted = true;
        CodexAppServerSession.prototype.clearAcceptedControlResolutionTracker.call(
          this,
          requestId
        );
        CodexAppServerSession.prototype.clearAcceptedControlFailureFallback.call(
          this,
          requestId
        );
      }
    }
    const candidates =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureCandidates.call(
        this
      );
    for (const [requestId, pending] of [...candidates.entries()]) {
      if (codexAcceptedControlCandidateMatchesItem(pending, item)) {
        pending.followthroughCompleted = true;
        CodexAppServerSession.prototype.clearAcceptedControlFailureCandidate.call(
          this,
          requestId
        );
      }
    }
    const ledger =
      CodexAppServerSession.prototype.ensureAcceptedControlFailureLedger.call(
        this
      );
    for (const [requestId, pending] of [...ledger.entries()]) {
      if (codexAcceptedControlCandidateMatchesItem(pending, item)) {
        pending.followthroughCompleted = true;
        CodexAppServerSession.prototype.clearAcceptedControlFailureLedger.call(
          this,
          requestId
        );
      }
    }
    const destructiveOutcomes =
      CodexAppServerSession.prototype.ensureDestructiveTrapControlOutcomes.call(
        this
      );
    for (const [requestId, pending] of [...destructiveOutcomes.entries()]) {
      if (codexAcceptedControlCandidateMatchesItem(pending, item)) {
        pending.followthroughCompleted = true;
        CodexAppServerSession.prototype.clearDestructiveTrapControlOutcome.call(
          this,
          requestId
        );
      }
    }
    const destructiveFallbacks =
      CodexAppServerSession.prototype.ensureAcceptedDestructiveTrapFailureFallbacks.call(
        this
      );
    for (const [requestId, pending] of [...destructiveFallbacks.entries()]) {
      if (codexAcceptedControlCandidateMatchesItem(pending, item)) {
        pending.followthroughCompleted = true;
        CodexAppServerSession.prototype.clearAcceptedDestructiveTrapFailureFallback.call(
          this,
          requestId
        );
      }
    }
  }

  markPendingControlAnswerSent(requestId, pending, payload) {
    pending.answerSent = true;
    delete pending.answerWriteInProgress;
    pending.answer = {
      allow: payload.allow === true,
      sent_at_ms: pending.answer?.sent_at_ms || Date.now(),
    };
    pending.activeTurnId = pending.activeTurnId || this.activeTurnId || null;
    pending.itemId = pending.itemId || extractCodexControlItemId(pending.params);
    if (pending.kind === "command" && !pending.commandText) {
      const remembered =
        CodexAppServerSession.prototype.getRememberedControlToolItemForPending.call(
          this,
          pending
        );
      pending.commandText =
        extractCodexCommandTextFromParams(pending.params) ||
        extractCodexCommandTextFromItem(remembered) ||
        "";
    }
    if (!codexControlRequiresProviderResolution(pending.kind)) return;
    if (pending.answer.allow === true) {
      CodexAppServerSession.prototype.trackAcceptedControlResolution.call(
        this,
        requestId,
        pending
      );
    }
    CodexAppServerSession.prototype.rememberDestructiveTrapControlOutcome.call(
      this,
      requestId,
      pending
    );

    const timers =
      CodexAppServerSession.prototype.ensurePendingControlAckTimers.call(this);
    CodexAppServerSession.prototype.clearPendingControlAckTimer.call(
      this,
      requestId
    );
    const timer = setTimeout(() => {
      const current = this._pendingControls.get(requestId);
      if (!current || current !== pending || current.answerSent !== true) {
        return;
      }
      const rejectedTrapException =
        current.answer?.allow === false &&
        Boolean(
          CodexAppServerSession.prototype.rememberDestructiveTrapControlOutcome.call(
            this,
            requestId,
            current
          )
        );
      CodexAppServerSession.prototype.emitControlResponseFailure.call(
        this,
        requestId,
        current,
        `Codex ${current.kind} control response was not acknowledged by app-server before timeout`,
        {
          phase: "serverRequest.resolved",
          timeout_ms: CODEX_CONTROL_ACK_TIMEOUT_MS,
          control_response_delivery_failure: true,
          control_response_delivery_correlation_failure: true,
          provider_execution_failure: false,
          destructive_trap_exception: rejectedTrapException,
          rejected_control_response: rejectedTrapException,
        }
      );
      CodexAppServerSession.prototype.clearPendingControl.call(this, requestId);
      this.drainPendingMessages();
    }, CODEX_CONTROL_ACK_TIMEOUT_MS);
    timers.set(requestId, timer);
  }

  handleServerRequest(msg) {
    const requestId = String(msg.id);
    const params = msg.params || {};

    if (msg.method === "item/commandExecution/requestApproval") {
      const itemId = extractCodexControlItemId(params);
      const remembered =
        CodexAppServerSession.prototype.getRememberedControlToolItem.call(
          this,
          itemId
        ) ||
        CodexAppServerSession.prototype.getSingleRememberedControlToolItemForKind.call(
          this,
          "command"
        );
      this._pendingControls.set(requestId, {
        kind: "command",
        params,
        itemId,
        commandText:
          extractCodexCommandTextFromParams(params) ||
          extractCodexCommandTextFromItem(remembered) ||
          "",
      });
      this.emit("event", {
        type: "control.request",
        provider: this.provider,
        request_id: requestId,
        subtype: "command",
        payload: params,
      });
      return;
    }

    if (msg.method === "item/fileChange/requestApproval") {
      this._pendingControls.set(requestId, {
        kind: "patch",
        params,
        itemId: extractCodexControlItemId(params),
      });
      this.emit("event", {
        type: "control.request",
        provider: this.provider,
        request_id: requestId,
        subtype: "patch",
        payload: params,
      });
      return;
    }

    if (msg.method === "item/permissions/requestApproval") {
      this._pendingControls.set(requestId, { kind: "permissions", params });
      this.emit("event", {
        type: "control.request",
        provider: this.provider,
        request_id: requestId,
        subtype: "permissions",
        payload: params,
      });
      return;
    }

    if (msg.method === "item/tool/requestUserInput") {
      this._pendingControls.set(requestId, { kind: "user_input", params });
      this.emit("event", {
        type: "control.request",
        provider: this.provider,
        request_id: requestId,
        subtype: "user_input",
        payload: params,
      });
      return;
    }

    if (msg.method === "mcpServer/elicitation/request") {
      this._pendingControls.set(requestId, { kind: "mcp_elicitation", params });
      this.emit("event", {
        type: "control.request",
        provider: this.provider,
        request_id: requestId,
        subtype: "mcp_elicitation",
        payload: params,
      });
      return;
    }

    this.writeJson({
      jsonrpc: "2.0",
      id: msg.id,
      error: {
        code: -32601,
        message: `Unsupported app-server request: ${msg.method}`,
      },
    });
    this.emit("event", {
      type: "runtime.error",
      provider: this.provider,
      error: `Unsupported app-server request: ${msg.method}`,
    });
  }

  handleNotification(method, params) {
    if (method === "thread/started") {
      this.captureThread(params.thread || null);
      if (this._ready) {
        this.emitReady();
      }
      return;
    }

    if (method === "thread/status/changed") {
      this.emit("event", {
        type: "session.notice",
        provider: this.provider,
        subtype: "thread.status_changed",
        payload: params,
      });
      return;
    }

    if (method === "turn/started") {
      const turnId = params?.turn?.id || null;
      if (typeof turnId === "string" && turnId) {
        this.activeTurnId = turnId;
        this._steerWaitTurnId = null;
      }
      this._awaitingTurnStart = false;
      this.emit("event", {
        type: "session.notice",
        provider: this.provider,
        subtype: "turn.started",
        payload: params,
      });
      return;
    }

    if (method === "turn/completed") {
      const turn = params?.turn || {};
      if (turn.id && turn.id === this.activeTurnId) {
        this.activeTurnId = null;
      }
      this._awaitingTurnStart = false;
      this._steerWaitTurnId = null;
      const failedAcceptedControl =
        CodexAppServerSession.prototype.failPendingAcceptedControlsForTurn.call(
          this,
          turn
        );
      if (failedAcceptedControl) {
        this.drainPendingMessages();
        return;
      }
      CodexAppServerSession.prototype.clearRejectedDestructiveTrapOutcomesForTurn.call(
        this,
        turn
      );
      if (turn.status !== "failed" && !turn.error) {
        CodexAppServerSession.prototype.clearAcceptedControlFailureCandidatesForTurn.call(
          this,
          turn
        );
      }
      if (
        turn.id &&
        this._failedControlFollowthroughTurnIds instanceof Set &&
        this._failedControlFollowthroughTurnIds.has(turn.id)
      ) {
        this._failedControlFollowthroughTurnIds.delete(turn.id);
        this.drainPendingMessages();
        return;
      }
      this.emit("event", {
        type: "turn.completed",
        provider: this.provider,
        thread_id: this.threadId,
        request_id: null,
        usage: turn.usage || null,
        status: turn.status || null,
        error: turn.error?.message || null,
      });
      if (turn.status === "failed" && turn.error?.message) {
        this.emit("event", {
          type: "runtime.error",
          provider: this.provider,
          error: turn.error.message,
        });
      }
      this.drainPendingMessages();
      return;
    }

    if (method === "thread/compacted") {
      this._awaitingTurnStart = false;
      this.emit("event", {
        type: "session.notice",
        provider: this.provider,
        subtype: "compact_boundary",
        payload: params,
      });
      return;
    }

    if (method === "item/started") {
      CodexAppServerSession.prototype.rememberControlToolItem.call(
        this,
        params.item || null
      );
      for (const event of CodexAppServerSession.prototype.normalizeItemStarted.call(
        this,
        params.item || null
      )) {
        this.emit("event", event);
      }
      return;
    }

    if (method === "item/completed") {
      const item = params.item || null;
      const events = CodexAppServerSession.prototype.normalizeItemCompleted.call(
        this,
        item
      );
      for (const event of events) {
        this.emit("event", event);
      }
      CodexAppServerSession.prototype.noteControlFollowthroughItemCompleted.call(
        this,
        item,
        events
      );
      CodexAppServerSession.prototype.forgetControlToolItem.call(this, item);
      return;
    }

    if (method === "item/agentMessage/delta") {
      const itemId = params.itemId || params.item_id || null;
      if (typeof itemId === "string" && itemId) {
        const state = this._agentMessageState.get(itemId) || { sawDelta: false };
        state.sawDelta = true;
        this._agentMessageState.set(itemId, state);
      }
      this.emit("event", {
        type: "message.assistant",
        provider: this.provider,
        text: typeof params.delta === "string" ? params.delta : "",
        delta: true,
      });
      return;
    }

    if (method === "item/commandExecution/outputDelta") {
      this.emit("event", {
        type: "tool.update",
        provider: this.provider,
        call_id: params.itemId || params.item_id || null,
        tool_call_id: params.itemId || params.item_id || null,
        update_kind: "output_delta",
        stream: null,
        text: typeof params.delta === "string" ? params.delta : "",
        content: typeof params.delta === "string" ? params.delta : "",
      });
      return;
    }

    if (method === "item/fileChange/outputDelta") {
      this.emit("event", {
        type: "tool.update",
        provider: this.provider,
        call_id: params.itemId || params.item_id || null,
        tool_call_id: params.itemId || params.item_id || null,
        update_kind: "output_delta",
        stream: null,
        text: typeof params.delta === "string" ? params.delta : "",
        content: typeof params.delta === "string" ? params.delta : "",
      });
      return;
    }

    if (method === "serverRequest/resolved") {
      const requestId = params.requestId !== undefined ? String(params.requestId) : null;
      if (requestId) {
        const pending = this._pendingControls.get(requestId);
        const resolutionError = extractCodexServerRequestResolutionError(params);
        if (pending && resolutionError) {
          const rejectedTrapException =
            pending.answer?.allow === false &&
            Boolean(
              CodexAppServerSession.prototype.rememberDestructiveTrapControlOutcome.call(
                this,
                requestId,
                pending,
                { ackPayload: params }
              )
            );
          CodexAppServerSession.prototype.emitControlResponseFailure.call(
            this,
            requestId,
            pending,
            `Codex ${pending.kind} control response acknowledgement failed: ${resolutionError}`,
            {
              phase: "serverRequest.resolved",
              control_response_delivery_failure: true,
              control_response_delivery_correlation_failure: true,
              provider_execution_failure: false,
              destructive_trap_exception: rejectedTrapException,
              rejected_control_response: rejectedTrapException,
            }
          );
        } else if (
          pending?.answerSent === true ||
          pending?.answerWriteInProgress === true
        ) {
          this.emit("event", {
            type: "session.notice",
            provider: this.provider,
            request_id: requestId,
            subtype: "control.response_acknowledged",
            payload: params,
          });
          CodexAppServerSession.prototype.armPendingControlFollowthrough.call(
            this,
            requestId,
            pending,
            params
          );
          CodexAppServerSession.prototype.armRejectedDestructiveTrapNoFollowthrough.call(
            this,
            requestId,
            pending,
            params
          );
        }
        CodexAppServerSession.prototype.clearPendingControl.call(
          this,
          requestId
        );
      }
      this.drainPendingMessages();
      return;
    }

    if (method === "item/reasoning/textDelta") {
      const itemId = params.itemId || params.item_id || null;
      const text = typeof params.delta === "string" ? params.delta : "";
      if (!text) {
        return;
      }
      if (typeof itemId === "string" && itemId) {
        const state = ensureReasoningState(this._reasoningState, itemId);
        if (state) {
          state.sawDelta = true;
        }
      }
      this.emit("event", {
        type: "message.thinking",
        provider: this.provider,
        text,
        delta: true,
        redacted: false,
      });
      return;
    }

    if (method === "item/reasoning/summaryTextDelta") {
      const itemId = params.itemId || params.item_id || null;
      const text = typeof params.delta === "string" ? params.delta : "";
      if (!text) {
        return;
      }
      if (typeof itemId === "string" && itemId) {
        const state = ensureReasoningState(this._reasoningState, itemId);
        if (state) {
          state.sawDelta = true;
        }
      }
      this.emit("event", {
        type: "message.thinking",
        provider: this.provider,
        text,
        delta: true,
        summary: true,
        redacted: false,
      });
      return;
    }

    if (method === "item/reasoning/summaryPartAdded") {
      const itemId = params.itemId || params.item_id || null;
      const text = extractReasoningSummaryPartText(params);
      if (!text) {
        return;
      }
      if (typeof itemId === "string" && itemId) {
        const state = ensureReasoningState(this._reasoningState, itemId);
        if (state) {
          state.sawDelta = true;
          state.summaryParts.push(text);
          state.emittedCompleteText = extractReasoningText(state.summaryParts).trim();
        }
      }
      this.emit("event", {
        type: "message.thinking",
        provider: this.provider,
        text,
        delta: false,
        summary: true,
        redacted: false,
      });
      return;
    }

    this.emit("event", {
      type: "session.notice",
      provider: this.provider,
      subtype: method.replace(/\//g, "."),
      payload: params,
    });
  }

  normalizeItemStarted(item) {
    if (!item || typeof item !== "object") return [];

    if (item.type === "commandExecution") {
      return [{
        type: "tool.call",
        provider: this.provider,
        call_id: item.id || null,
        tool_call_id: item.id || null,
        name: "exec_command",
        input: {
          command: item.command || "",
          cwd: item.cwd || null,
          command_actions: item.commandActions || [],
        },
      }];
    }

    if (item.type === "fileChange") {
      return [{
        type: "tool.call",
        provider: this.provider,
        call_id: item.id || null,
        tool_call_id: item.id || null,
        name: "apply_patch",
        input: {
          changes: item.changes || [],
        },
      }];
    }

    if (item.type === "reasoning") {
      return [{
        type: "thinking.started",
        provider: this.provider,
        item_id: item.id || null,
      }];
    }

    return [];
  }

  normalizeItemCompleted(item) {
    if (!item || typeof item !== "object") return [];

    if (item.type === "agentMessage") {
      const itemId = item.id || null;
      if (itemId) {
        this._agentMessageState.delete(itemId);
      }
      const text = typeof item.text === "string" ? item.text : "";
      if (!text) return [];
      return [{
        type: "message.assistant",
        provider: this.provider,
        text,
        delta: false,
      }];
    }

    if (item.type === "commandExecution") {
      return [{
        type: "tool.result",
        provider: this.provider,
        call_id: item.id || null,
        tool_call_id: item.id || null,
        name: "exec_command",
        content: {
          stdout: item.aggregatedOutput || "",
          stderr: "",
          exit_code: item.exitCode ?? null,
          success: item.status === "completed",
          status: item.status || null,
          duration_ms: item.durationMs ?? null,
          command: item.command || "",
          command_actions: item.commandActions || [],
        },
        is_error: item.status === "failed" || item.status === "declined",
      }];
    }

    if (item.type === "fileChange") {
      return [{
        type: "tool.result",
        provider: this.provider,
        call_id: item.id || null,
        tool_call_id: item.id || null,
        name: "apply_patch",
        content: {
          stdout: "",
          stderr: "",
          success: item.status === "completed",
          status: item.status || null,
          changes: item.changes || [],
        },
        is_error: item.status === "failed" || item.status === "declined",
      }];
    }

    if (item.type === "reasoning") {
      const itemId = item.id || null;
      const state = itemId ? this._reasoningState.get(itemId) : null;
      if (itemId) {
        this._reasoningState.delete(itemId);
      }
      const text = extractCompletedReasoningText(item, state);
      if (!text) return [];
      if (state?.emittedCompleteText && state.emittedCompleteText === text) {
        return [];
      }
      return [{
        type: "message.thinking",
        provider: this.provider,
        text,
        redacted: false,
      }];
    }

    return [];
  }

  send(payload) {
    if (!this.alive) throw new Error(`Session ${this.id} is not alive`);
    this._pendingMessages.push(normalizePendingMessage(payload));
    this.drainPendingMessages();
  }

  async ensureThreadStarted() {
    if (this.threadId) return;
    const result = await this.request("thread/start", this.buildThreadStartParams());
    this.captureThread(result?.thread || null);
    this.emitReady();
  }

  async drainPendingMessages() {
    if (!this._ready || !this.alive || this._sending) return;
    if (this._pendingMessages.length === 0) return;
    if (this._pendingControls.size > 0) return;
    if (this._awaitingTurnStart) return;

    this._sending = true;
    try {
      await this.ensureThreadStarted();
      if (this.activeTurnId) {
        if (this._steerWaitTurnId !== this.activeTurnId) {
          this._steerWaitTurnId = this.activeTurnId;
          this.emit("event", {
            type: "session.notice",
            provider: this.provider,
            subtype: "turn.queue_wait",
            payload: {
              thread_id: this.threadId,
              turn_id: this.activeTurnId,
            },
          });
        }
        return;
      } else {
        const nextMessage = this._pendingMessages[0];
        if (nextMessage?.isSlashCommand === true && nextMessage.slashCommandName === "compact") {
          this._awaitingTurnStart = true;
          await this.request("thread/compact/start", {
            threadId: this.threadId,
          });
        } else {
          const result = await this.request("turn/start", this.buildTurnStartParams(nextMessage?.text || ""));
          this.activeTurnId = result?.turn?.id || result?.turnId || this.activeTurnId;
          if (!this.activeTurnId) {
            this._awaitingTurnStart = true;
          }
        }
        this._pendingMessages.shift();
      }
    } catch (err) {
      this._awaitingTurnStart = false;
      if (this._pendingMessages.length > 0) {
        // Host-side delivery state owns retry/skip semantics. Do not keep replaying
        // the same provider payload forever after a fatal turn-start failure.
        this._pendingMessages.shift();
      }
      this.emit("error", err);
    } finally {
      this._sending = false;
      if (
        this._pendingMessages.length > 0
        && this.activeTurnId === null
        && this._pendingControls.size === 0
        && this._awaitingTurnStart === false
      ) {
        queueMicrotask(() => this.drainPendingMessages());
      }
    }
  }

  respondToControl(payload) {
    if (!this.alive) throw new Error(`Session ${this.id} is not alive`);
    if (!isPlainObject(payload)) {
      throw new Error("Codex control response payload must be an object");
    }
    const requestId = String(payload.requestId || payload.request_id || "");
    if (!requestId) {
      throw new Error("Codex control response is missing requestId");
    }
    const pending = this._pendingControls.get(requestId);
    if (!pending) {
      throw new Error(`Unknown Codex approval request: ${requestId}`);
    }

    if (pending.kind === "user_input") {
      const answers = normalizeCodexUserInputAnswers(pending.params.questions, payload.answers);
      CodexAppServerSession.prototype.writeControlResponse.call(this, requestId, pending, {
        jsonrpc: "2.0",
        id: requestId,
        result: {
          answers,
        },
      });
      CodexAppServerSession.prototype.clearPendingControl.call(this, requestId);
      return;
    }

    if (pending.kind === "mcp_elicitation") {
      const response = normalizeCodexElicitationResponse(pending.params, payload.response);
      CodexAppServerSession.prototype.writeControlResponse.call(this, requestId, pending, {
        jsonrpc: "2.0",
        id: requestId,
        result: response,
      });
      CodexAppServerSession.prototype.clearPendingControl.call(this, requestId);
      return;
    }

    if (typeof payload.allow !== "boolean") {
      throw new Error(`Codex ${pending.kind} control response requires boolean allow`);
    }

    if (pending.kind === "permissions") {
      CodexAppServerSession.prototype.writeControlResponse.call(this, requestId, pending, {
        jsonrpc: "2.0",
        id: requestId,
        result: {
          scope: "turn",
          permissions: payload.allow ? (pending.params.permissions || {}) : {},
        },
      });
      CodexAppServerSession.prototype.clearPendingControl.call(this, requestId);
      return;
    }

    CodexAppServerSession.prototype.preparePendingControlAnswerWrite.call(
      this,
      requestId,
      pending,
      payload
    );
    try {
      CodexAppServerSession.prototype.writeControlResponse.call(this, requestId, pending, {
        jsonrpc: "2.0",
        id: requestId,
        result: {
          decision: payload.allow ? "accept" : "decline",
        },
      });
    } catch (err) {
      CodexAppServerSession.prototype.clearPendingControlAnswerWrite.call(
        this,
        requestId,
        pending
      );
      throw err;
    }
    if (this._pendingControls.get(requestId) !== pending) {
      return;
    }
    CodexAppServerSession.prototype.markPendingControlAnswerSent.call(
      this,
      requestId,
      pending,
      payload
    );
  }

  getPendingControlRequests() {
    return [...this._pendingControls.entries()]
      .filter(
        ([, pending]) =>
          pending.answerSent !== true && pending.answerWriteInProgress !== true
      )
      .map(([requestId, pending]) => ({
        provider: this.provider,
        request_id: requestId,
        subtype: codexPendingControlKindToSubtype(pending.kind),
        payload: pending.params,
      }));
  }

  stop() {
    this._terminatingIntentionally = true;
    CodexAppServerSession.prototype.clearPendingControlAckTimers.call(this);
    CodexAppServerSession.prototype.clearPendingControlFollowthroughs.call(this);
    CodexAppServerSession.prototype.clearAcceptedControlResolutionTrackers.call(this);
    CodexAppServerSession.prototype.clearAcceptedControlFailureLedgers.call(this);
    CodexAppServerSession.prototype.clearDestructiveTrapControlOutcomes.call(this);
    CodexAppServerSession.prototype.clearAcceptedDestructiveTrapFailureFallbacks.call(this);
    if (this.proc.stdin.writable) {
      this.proc.stdin.end();
    }
    if (this.alive) {
      this.proc.kill("SIGTERM");
      setTimeout(() => {
        if (this.alive) this.proc.kill("SIGKILL");
      }, 5000);
    }
  }

  kill() {
    this._terminatingIntentionally = true;
    CodexAppServerSession.prototype.clearPendingControlAckTimers.call(this);
    CodexAppServerSession.prototype.clearPendingControlFollowthroughs.call(this);
    CodexAppServerSession.prototype.clearAcceptedControlResolutionTrackers.call(this);
    CodexAppServerSession.prototype.clearAcceptedControlFailureLedgers.call(this);
    CodexAppServerSession.prototype.clearDestructiveTrapControlOutcomes.call(this);
    CodexAppServerSession.prototype.clearAcceptedDestructiveTrapFailureFallbacks.call(this);
    this.proc.kill("SIGTERM");
    setTimeout(() => {
      if (this.alive) this.proc.kill("SIGKILL");
    }, 5000);
  }

  interrupt() {
    if (!this.alive) throw new Error(`Session ${this.id} is not alive`);
    if (!this.threadId || !this.activeTurnId) {
      return {
        status: "no_active_turn",
        accepted: false,
        idempotent: true,
        provider: "codex",
        provider_interrupt_attempted: false,
        provider_interrupt_method: "turn/interrupt",
        provider_thread_id_present: Boolean(this.threadId),
        provider_turn_id_present: Boolean(this.activeTurnId),
        reason: "codex_active_turn_missing",
        raw_provider_response_exposed: false,
      };
    }
    this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    }).catch((err) => this.emit("error", err));
    return {
      status: "accepted",
      accepted: true,
      idempotent: false,
      provider: "codex",
      provider_interrupt_attempted: true,
      provider_interrupt_method: "turn/interrupt",
      provider_thread_id_present: true,
      provider_turn_id_present: true,
      raw_provider_response_exposed: false,
    };
  }

  request(method, params) {
    const id = String(this._nextRequestId++);
    this.writeJson({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
    });
  }

  notify(method, params) {
    this.writeJson({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  writeJson(payload) {
    if (!this.proc.stdin.writable) {
      throw new Error("Codex app-server stdin is not writable");
    }
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }
}
