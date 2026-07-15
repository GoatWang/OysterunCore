import { spawn } from "child_process";
import { EventEmitter } from "events";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "fs";
import { basename, dirname, join, normalize, resolve } from "path";
import { fileURLToPath } from "url";

import {
  resolveClaudeCliAuthCommand,
  resolveManagedClaudeAcpRunner,
} from "../claude-acp-model-discovery.mjs";
import { getDefaultProviderModel, normalizeClaudeModel } from "../config.mjs";
import { isWorkspaceAllowedPathPolicyDisabled } from "../workspace-policy.mjs";

const HOST_SERVICE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const JSONRPC_VERSION = "2.0";
const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 15000;
const ACP_TERMINAL_TOOL_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "success",
  "succeeded",
  "fail",
  "failed",
  "failure",
  "error",
  "cancel",
  "canceled",
  "cancelled",
  "declined",
]);
const ACP_ERROR_TOOL_STATUSES = new Set([
  "fail",
  "failed",
  "failure",
  "error",
  "cancel",
  "canceled",
  "cancelled",
  "declined",
]);

function stableJson(value) {
  return JSON.stringify(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactObject(value) {
  const output = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (entry !== undefined && entry !== null && entry !== "") {
      output[key] = entry;
    }
  }
  return output;
}

function textFromValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => textFromValue(entry)).filter(Boolean).join("");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
    if (value.content) {
      return textFromValue(value.content);
    }
    if (value.delta) {
      return textFromValue(value.delta);
    }
  }
  return "";
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function acpClaudeToolName(update) {
  return firstString(
    update?._meta?.claudeCode?.toolName,
    update?.toolName,
    update?.tool_name,
    update?.name,
    update?.title,
    update?.kind,
    "tool"
  );
}

function acpToolInput(update) {
  return update?.rawInput ?? update?.input ?? null;
}

function acpToolContent(update) {
  return update?.rawOutput ?? update?.output ?? update?.content ?? update?.text ?? null;
}

function acpProviderMessageId(update) {
  return firstString(update?.messageId, update?.message_id);
}

function acpProviderMessageMetadata(update) {
  const providerMessageId = acpProviderMessageId(update);
  return providerMessageId ? { provider_message_id: providerMessageId } : {};
}

function buildPromptBlocks(text) {
  return [{ type: "text", text: String(text ?? "") }];
}

function extractCurrentModel(configOptions) {
  for (const option of asArray(configOptions)) {
    const id = String(option?.id ?? option?.key ?? option?.name ?? "").toLowerCase();
    const label = String(option?.label ?? option?.title ?? "").toLowerCase();
    if (!id.includes("model") && !label.includes("model")) {
      continue;
    }
    const current = firstString(
      option?.currentValue,
      option?.current_value,
      option?.value,
      option?.defaultValue,
      option?.default_value,
    );
    if (current) {
      return current;
    }
  }
  return "";
}

function configOptionsFromResult(result) {
  const direct = result?.configOptions || result?.config_options;
  if (Array.isArray(direct)) return direct;
  const nested =
    result?.session?.configOptions ||
    result?.session?.config_options ||
    result?.agent?.configOptions ||
    result?.agent?.config_options;
  return Array.isArray(nested) ? nested : [];
}

function findModelConfigOption(configOptions) {
  for (const option of asArray(configOptions)) {
    const id = String(option?.id ?? option?.key ?? option?.name ?? "");
    const label = String(option?.label ?? option?.title ?? "").toLowerCase();
    if (id.toLowerCase().includes("model") || label.includes("model")) {
      return option;
    }
  }
  return null;
}

function configOptionValues(option) {
  const values = option?.options || option?.values || option?.choices;
  if (Array.isArray(values)) return values;
  if (values && typeof values === "object") {
    return Object.entries(values).map(([id, value]) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? { id, ...value }
        : { id, label: String(value) }
    );
  }
  return [];
}

function modelOptionRawValue(entry) {
  return firstString(
    entry?.id,
    entry?.value,
    entry?.name,
    entry?.model,
    entry?.label
  );
}

function normalizeModelOptionEntries(option) {
  const currentValue = firstString(
    option?.currentValue,
    option?.current_value,
    option?.value,
    option?.defaultValue,
    option?.default_value
  );
  return configOptionValues(option)
    .map((entry) => {
      const rawValue =
        typeof entry === "string" ? entry : modelOptionRawValue(entry);
      if (!rawValue) return null;
      return {
        rawValue,
        normalizedRawValue: rawValue.trim().toLowerCase(),
        canonicalModel: normalizeClaudeModel(rawValue),
        isDefault:
          entry?.isDefault === true ||
          entry?.is_default === true ||
          (currentValue &&
            rawValue.trim().toLowerCase() === currentValue.toLowerCase()),
      };
    })
    .filter(Boolean);
}

function resolveAcpModelConfigValue(configOptions, configuredModel) {
  const option = findModelConfigOption(configOptions);
  if (!option) {
    return {
      available: false,
      reason: "model_config_unavailable",
      model: configuredModel,
      configOptionId: "",
      value: "",
      values: [],
    };
  }
  const configOptionId =
    String(option.id ?? option.key ?? option.name ?? "model").trim() || "model";
  const configuredRaw = firstString(configuredModel);
  const canonicalModel =
    normalizeClaudeModel(configuredRaw) || getDefaultProviderModel("claude");
  const values = normalizeModelOptionEntries(option);
  if (!values.length) {
    return {
      available: true,
      reason: "model_config_without_enumerated_values",
      model: canonicalModel,
      configOptionId,
      value: configuredRaw || canonicalModel,
      values: [],
    };
  }
  const normalizedConfigured = configuredRaw.toLowerCase();
  const exact = values.find(
    (entry) => entry.normalizedRawValue === normalizedConfigured
  );
  if (exact) {
    return {
      available: true,
      reason: "exact_acp_model_value",
      model: canonicalModel,
      configOptionId,
      value: exact.rawValue,
      values,
    };
  }
  const defaultModel = getDefaultProviderModel("claude");
  if (canonicalModel === defaultModel) {
    const defaultEntry = values.find(
      (entry) =>
        entry.normalizedRawValue === "default" || entry.isDefault === true
    );
    if (defaultEntry) {
      return {
        available: true,
        reason: "canonical_default_to_acp_default",
        model: canonicalModel,
        configOptionId,
        value: defaultEntry.rawValue,
        values,
      };
    }
  }
  const canonicalMatch = values.find(
    (entry) => entry.canonicalModel === canonicalModel
  );
  if (canonicalMatch) {
    return {
      available: true,
      reason: "canonical_model_alias",
      model: canonicalModel,
      configOptionId,
      value: canonicalMatch.rawValue,
      values,
    };
  }
  return {
    available: false,
    reason: "model_config_value_unavailable",
    model: canonicalModel,
    configOptionId,
    value: "",
    values,
  };
}

function normalizeStopStatus(stopReason) {
  const normalized = String(stopReason ?? "").toLowerCase();
  if (!normalized) {
    return "completed";
  }
  if (["cancelled", "canceled", "interrupted"].includes(normalized)) {
    return "interrupted";
  }
  if (["error", "failed"].includes(normalized)) {
    return "error";
  }
  return "completed";
}

function isClaudeAcpPromptOutputEvent(event) {
  if (!event || typeof event !== "object") return false;
  const eventType = typeof event.type === "string" ? event.type.trim() : "";
  if (
    eventType === "message.assistant" ||
    eventType === "message.thinking" ||
    eventType === "tool.call" ||
    eventType === "tool.result" ||
    eventType === "tool.failure" ||
    eventType === "control.request" ||
    eventType === "control.outcome" ||
    eventType === "runtime.error" ||
    eventType === "session.exit"
  ) {
    return true;
  }
  return eventType.startsWith("tool.");
}

function isClaudeAcpPromptFinalOutputEvent(event) {
  if (!event || typeof event !== "object") return false;
  const eventType = typeof event.type === "string" ? event.type.trim() : "";
  if (eventType === "message.assistant") {
    return event.delta !== true;
  }
  return (
    eventType === "control.request" ||
    eventType === "control.outcome" ||
    eventType === "runtime.error" ||
    eventType === "session.exit"
  );
}

function isClaudeAcpPromptAssistantOutputEvent(event) {
  if (!event || typeof event !== "object") return false;
  return typeof event.type === "string" && event.type.trim() === "message.assistant";
}

function isClaudeAcpAssistantSegmentBoundary(event) {
  if (!event || typeof event !== "object") return false;
  const eventType = typeof event.type === "string" ? event.type.trim() : "";
  return (
    eventType.startsWith("tool.") ||
    eventType === "control.request" ||
    eventType === "control.outcome" ||
    eventType === "runtime.error" ||
    eventType === "session.exit"
  );
}

export class ClaudeAcpAssistantMessageAssembler {
  constructor() {
    this.activeSegment = null;
    this.segmentCountByMessageId = new Map();
  }

  consume(event) {
    if (!event || typeof event !== "object") return [];
    if (event.type === "message.thinking") return [];
    if (event.type === "message.assistant" && event.delta === true) {
      const text = textFromValue(event.text ?? event.content ?? event.body);
      if (!text) return [event];
      const providerMessageId = firstString(event.provider_message_id);
      const output = [];
      if (
        this.activeSegment &&
        providerMessageId !== this.activeSegment.providerMessageId
      ) {
        const confirmed = this.flush();
        if (confirmed) output.push(confirmed);
      }
      if (!this.activeSegment) {
        this.activeSegment = {
          providerMessageId,
          chunks: [],
        };
      }
      this.activeSegment.chunks.push(text);
      output.push(event);
      return output;
    }

    const output = [];
    if (event.type === "message.assistant" && event.delta !== true) {
      const providerMessageId = firstString(event.provider_message_id);
      if (
        this.activeSegment &&
        providerMessageId &&
        this.activeSegment.providerMessageId &&
        providerMessageId !== this.activeSegment.providerMessageId
      ) {
        const confirmed = this.flush();
        if (confirmed) output.push(confirmed);
      } else {
        this.activeSegment = null;
      }
      output.push(event);
      return output;
    }
    if (isClaudeAcpAssistantSegmentBoundary(event)) {
      const confirmed = this.flush();
      if (confirmed) output.push(confirmed);
    }
    output.push(event);
    return output;
  }

  flush() {
    const segment = this.activeSegment;
    this.activeSegment = null;
    if (!segment) return null;
    const text = segment.chunks.join("");
    if (!text) return null;
    const messageIdKey = segment.providerMessageId || "missing-provider-message-id";
    const segmentIndex = (this.segmentCountByMessageId.get(messageIdKey) || 0) + 1;
    this.segmentCountByMessageId.set(messageIdKey, segmentIndex);
    return {
      type: "message.assistant",
      text,
      ...(segment.providerMessageId
        ? { provider_message_id: segment.providerMessageId }
        : {}),
      acp_stream_aggregate: true,
      acp_stream_chunk_count: segment.chunks.length,
      acp_message_segment_index: segmentIndex,
      source_label: "claude_acp_confirmed_assistant_segment",
    };
  }
}

function isClaudeAcpSuccessfulPromptStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "completed" || normalized === "complete" || normalized === "success";
}

function claudeAcpTracePath() {
  if (process.env.OYSTERUN_CLAUDE_ACP_TRACE === "0") return "";
  if (typeof process.env.OYSTERUN_CLAUDE_ACP_TRACE_PATH === "string") {
    const configured = process.env.OYSTERUN_CLAUDE_ACP_TRACE_PATH.trim();
    if (configured) return configured;
  }
  const configDir = process.env.OYSTERUN_CONFIG_DIR;
  if (!configDir) return "";
  return join(configDir, "operation_logs", "claude-acp-jsonrpc-trace.jsonl");
}

function redactAcpTraceText(value) {
  if (typeof value !== "string") return value;
  return {
    redacted: true,
    length: value.length,
  };
}

function compactAcpTraceValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactAcpTraceText(value);
  if (typeof value !== "object") return value;
  if (depth >= 4) {
    return Array.isArray(value)
      ? { type: "array", length: value.length }
      : { type: "object", keys: Object.keys(value).slice(0, 20) };
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, 4).map((entry) => compactAcpTraceValue(entry, depth + 1)),
    };
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/token|secret|password|credential|authorization/i.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    if (/text|content|result|output|stdout|stderr|thinking/i.test(key)) {
      output[key] = redactAcpTraceText(
        typeof entry === "string" ? entry : stableJson(entry)
      );
      continue;
    }
    output[key] = compactAcpTraceValue(entry, depth + 1);
  }
  return output;
}

function summarizeAcpTraceMessage(message) {
  if (!message || typeof message !== "object") return message;
  const params = message.params && typeof message.params === "object" ? message.params : null;
  const update = params?.update && typeof params.update === "object" ? params.update : null;
  return compactObject({
    id: message.id,
    method: message.method,
    has_result: Object.prototype.hasOwnProperty.call(message, "result"),
    has_error: Object.prototype.hasOwnProperty.call(message, "error"),
    session_id: params?.sessionId,
    update_type: update?.sessionUpdate || update?.type || update?.kind,
    update: update ? compactAcpTraceValue(update) : undefined,
    result: message.result ? compactAcpTraceValue(message.result) : undefined,
    error: message.error ? compactAcpTraceValue(message.error) : undefined,
  });
}

function appendClaudeAcpTrace(direction, message) {
  const tracePath = claudeAcpTracePath();
  if (!tracePath) return;
  try {
    mkdirSync(dirname(tracePath), { recursive: true });
    appendFileSync(
      tracePath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        direction,
        message: summarizeAcpTraceMessage(message),
      })}\n`
    );
  } catch {
    // Trace must never affect provider delivery.
  }
}

let claudeAcpRawTraceSequence = 0;
let claudeAcpRawTraceWriteErrorReported = false;

function claudeAcpRawTracePath() {
  if (process.env.OYSTERUN_CLAUDE_ACP_RAW_TRACE !== "1") return "";
  if (typeof process.env.OYSTERUN_CLAUDE_ACP_RAW_TRACE_PATH === "string") {
    const configured = process.env.OYSTERUN_CLAUDE_ACP_RAW_TRACE_PATH.trim();
    if (configured) return configured;
  }
  const configDir = process.env.OYSTERUN_CONFIG_DIR;
  if (!configDir) return "";
  return join(configDir, "operation_logs", "claude-acp-raw-events.jsonl");
}

export function appendClaudeAcpRawInboundTrace(message) {
  const tracePath = claudeAcpRawTracePath();
  if (!tracePath) return;
  try {
    mkdirSync(dirname(tracePath), { recursive: true, mode: 0o700 });
    appendFileSync(
      tracePath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        sequence: ++claudeAcpRawTraceSequence,
        direction: "in",
        message,
      })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    chmodSync(tracePath, 0o600);
  } catch (error) {
    if (!claudeAcpRawTraceWriteErrorReported) {
      claudeAcpRawTraceWriteErrorReported = true;
      console.warn(
        `[claude-acp] raw trace write failed: ${error?.message || String(error)}`
      );
    }
  }
}

function normalizePermissionOptions(options) {
  return asArray(options)
    .map((option, index) => {
      const id = firstString(option?.optionId, option?.id, option?.kind, option?.label) || `option-${index + 1}`;
      const label = firstString(option?.label, option?.name, option?.kind, id) || id;
      const kind = firstString(option?.kind, option?.type, id).toLowerCase();
      return {
        id,
        option_id: id,
        label,
        kind,
        raw: option,
      };
    })
    .filter((option) => option.id);
}

function selectPermissionOption(options, allow) {
  const normalized = normalizePermissionOptions(options);
  if (!normalized.length) {
    return allow ? "allow" : "deny";
  }
  const preferred = normalized.find((option) => {
    const haystack = `${option.id} ${option.label} ${option.kind}`.toLowerCase();
    return allow ? /allow|accept|approve|yes|once|always/.test(haystack) : /deny|reject|cancel|no|disallow/.test(haystack);
  });
  return (preferred ?? normalized[0]).id;
}

function collectAllowedDirectories({ cwd, workspacePolicy, assetReadablePaths } = {}) {
  const directories = new Set();
  const maybeAdd = (value) => {
    const candidate = typeof value === "string" ? value : value?.path ?? value?.value ?? value?.raw;
    if (!candidate || typeof candidate !== "string") {
      return;
    }
    directories.add(resolve(candidate));
  };
  if (!isWorkspaceAllowedPathPolicyDisabled(workspacePolicy)) {
    for (const entry of asArray(workspacePolicy?.allowedPaths ?? workspacePolicy?.allowed_paths)) {
      maybeAdd(entry);
    }
  }
  for (const entry of asArray(assetReadablePaths)) {
    maybeAdd(entry);
  }
  if (cwd) {
    directories.delete(resolve(cwd));
  }
  return [...directories];
}

function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function describeError(error) {
  if (!error) {
    return { message: "unknown error" };
  }
  return compactObject({
    code: error.code,
    message: error.message ?? String(error),
    rpc_method: error.rpc_method,
    request_id: error.request_id,
    data: error.data,
    stack: error.stack,
  });
}

function formatExitCode(code, signal) {
  const codeText =
    code === undefined || code === null || String(code).trim() === ""
      ? "none"
      : String(code).trim();
  const signalText =
    signal === undefined || signal === null || String(signal).trim() === ""
      ? "none"
      : String(signal).trim();
  return `code=${codeText}, signal=${signalText}`;
}

function buildClaudeAcpExitDiagnostic(session, code, signal) {
  const afterSessionStart = Boolean(session.providerSessionId);
  const beforeChatTurn = session._promptEverSent !== true;
  const earlyExit = !session.stopping && afterSessionStart;
  const reason = earlyExit
    ? beforeChatTurn
      ? "claude_acp_provider_exited_after_session_start_before_chat_turn"
      : "claude_acp_provider_exited_before_turn_completion"
    : session.stopping
    ? "claude_acp_provider_stopped"
    : "claude_acp_provider_exited";
  const summary = earlyExit
    ? beforeChatTurn
      ? `Claude ACP provider exited after session start before a chat turn was available (${formatExitCode(code, signal)})`
      : `Claude ACP provider exited before the active turn completed (${formatExitCode(code, signal)})`
    : `Claude ACP provider exited (${formatExitCode(code, signal)})`;
  return compactObject({
    reason,
    early_exit: earlyExit,
    after_session_start: afterSessionStart,
    before_chat_turn: beforeChatTurn,
    code,
    signal,
    provider_session_id: session.providerSessionId || null,
    provider_resume_id: session.providerResumeId || session.providerSessionId || null,
    runner_source: session.runnerResolution?.runner_source,
    claude_auth_source: session.claudeCliResolution?.source,
    last_runtime_error: session.lastRuntimeError,
    summary,
  });
}

class JsonRpcLineClient {
  constructor({ proc, onNotification, onRequest, onRuntimeError }) {
    this.proc = proc;
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    this.onRuntimeError = onRuntimeError;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.closed = false;
    this.expectedClose = false;
    this.processClosed = false;
    proc.stdout?.setEncoding?.("utf8");
    proc.stdout?.on("data", (chunk) => this.handleChunk(chunk));
    proc.on?.("exit", () => this.handleProcessClosed("exited"));
    proc.on?.("close", () => this.handleProcessClosed("closed"));
  }

  handleChunk(chunk) {
    this.buffer += String(chunk ?? "");
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) {
        this.handleLine(line);
      }
      index = this.buffer.indexOf("\n");
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.onRuntimeError?.(new Error(`Invalid Claude ACP JSON-RPC line: ${error.message}`), { line });
      return;
    }
    appendClaudeAcpRawInboundTrace(message);
    appendClaudeAcpTrace("in", message);
    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.onRuntimeError?.(new Error(`Unexpected Claude ACP response id ${message.id}`), { message });
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message ?? "Claude ACP request failed");
        error.code = message.error.code;
        error.data = message.error.data;
        error.rpc_method = pending.method;
        error.request_id = message.id;
        pending.reject(error);
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      this.onRequest?.(message);
      return;
    }
    if (message.method) {
      this.onNotification?.(message);
      return;
    }
    this.onRuntimeError?.(new Error("Unsupported Claude ACP JSON-RPC message"), { message });
  }

  request(method, params = {}) {
    if (this.closed) {
      return Promise.reject(new Error("Claude ACP JSON-RPC client is closed"));
    }
    const id = this.nextId++;
    const payload = { jsonrpc: JSONRPC_VERSION, id, method, params };
    const promise = new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { id, resolve: resolvePromise, reject: rejectPromise, method });
    });
    this.write(payload);
    return promise;
  }

  notify(method, params = {}) {
    if (!this.closed) {
      this.write({ jsonrpc: JSONRPC_VERSION, method, params });
    }
  }

  respond(id, result = {}) {
    if (!this.closed) {
      this.write({ jsonrpc: JSONRPC_VERSION, id, result });
    }
  }

  reject(id, code, message, data) {
    if (!this.closed) {
      this.write({ jsonrpc: JSONRPC_VERSION, id, error: compactObject({ code, message, data }) });
    }
  }

  write(payload) {
    appendClaudeAcpTrace("out", payload);
    this.proc.stdin?.write(`${JSON.stringify(payload)}\n`);
  }

  close() {
    this.closed = true;
    this.rejectAll(new Error("Claude ACP JSON-RPC client closed"));
  }

  expectClose() {
    this.expectedClose = true;
  }

  handleProcessClosed(kind) {
    if (this.processClosed) {
      return;
    }
    this.processClosed = true;
    if (this.expectedClose) {
      this.pending.clear();
      return;
    }
    this.rejectAll(new Error(`Claude ACP runner ${kind} before completing pending requests`));
  }

  rejectAll(error) {
    if (!this.pending.size) {
      return;
    }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) {
      const pendingError = new Error(error.message ?? String(error));
      pendingError.code = error.code;
      pendingError.data = error.data;
      pendingError.rpc_method = entry.method;
      pendingError.request_id = entry.id;
      entry.reject(pendingError);
    }
  }
}

export function normalizeClaudeSessionUpdate(params) {
  const update = params?.update ?? params?.sessionUpdate ?? params;
  if (!update || typeof update !== "object") {
    return [];
  }
  const type = update.sessionUpdate ?? update.type ?? update.kind;
  const events = [];
  if (type === "agent_message_chunk") {
    const text = textFromValue(update.content ?? update.delta ?? update.text);
    if (text) {
      events.push({
        type: "message.assistant",
        text,
        delta: true,
        ...acpProviderMessageMetadata(update),
      });
    }
    return events;
  }
  if (type === "agent_message" || type === "agent_message_complete") {
    const text = textFromValue(update.content ?? update.message ?? update.text);
    if (text) {
      events.push({
        type: "message.assistant",
        text,
        ...acpProviderMessageMetadata(update),
      });
    }
    return events;
  }
  if (type === "agent_thought_chunk") {
    return [];
  }
  if (type === "user_message_chunk") {
    const text = textFromValue(update.content ?? update.delta ?? update.text);
    if (text) {
      events.push({
        type: "message.user.echo",
        text,
        delta: true,
        ...acpProviderMessageMetadata(update),
      });
    }
    return events;
  }
  if (type === "tool_call") {
    const callId = update.toolCallId ?? update.tool_call_id ?? update.id ?? update.callId;
    const toolName = acpClaudeToolName(update);
    const input = acpToolInput(update);
    events.push({
      type: "tool.call",
      call_id: callId,
      tool_call_id: callId,
      name: toolName,
      tool_name: toolName,
      input,
      tool_input: input,
      status: update.status ?? "pending",
      ...acpProviderMessageMetadata(update),
    });
    return events;
  }
  if (type === "tool_call_update") {
    const callId = update.toolCallId ?? update.tool_call_id ?? update.id ?? update.callId;
    const status = firstString(update.status, update.state);
    const toolName = acpClaudeToolName(update);
    const input = acpToolInput(update);
    const content = acpToolContent(update);
    const text = textFromValue(content);
    const normalizedStatus = status.toLowerCase();
    const terminal = ACP_TERMINAL_TOOL_STATUSES.has(normalizedStatus);
    if (terminal) {
      const isError = ACP_ERROR_TOOL_STATUSES.has(normalizedStatus);
      events.push({
        type: "tool.result",
        call_id: callId,
        tool_call_id: callId,
        name: toolName,
        tool_name: toolName,
        output: text,
        content,
        tool_content: content ?? text,
        status: status || "updated",
        is_error: isError,
        ...acpProviderMessageMetadata(update),
      });
      return events;
    }
    events.push({
      type: "tool.update",
      call_id: callId,
      tool_call_id: callId,
      name: toolName,
      tool_name: toolName,
      input,
      tool_input: input,
      content,
      tool_content: content,
      update_kind: input
        ? "input_refinement"
        : content !== null && content !== undefined
        ? "output_delta"
        : "progress",
      status: status || "updated",
      ...acpProviderMessageMetadata(update),
    });
    return events;
  }
  if (type === "plan" || type === "plan_update" || type === "plan_removed") {
    events.push({ type: "session.notice", subtype: "plan", data: update });
    return events;
  }
  if (
    type === "available_commands_update" ||
    type === "current_mode_update" ||
    type === "config_option_update" ||
    type === "session_info_update" ||
    type === "usage_update"
  ) {
    events.push({ type: "session.notice", subtype: type, data: update });
    return events;
  }
  events.push({ type: "session.notice", subtype: "acp_update", data: update });
  return events;
}

function extractToolCallPayload(toolCall) {
  if (!toolCall || typeof toolCall !== "object") {
    return {};
  }
  return compactObject({
    tool_name: firstString(toolCall.title, toolCall.name, toolCall.kind, toolCall.type, "tool"),
    tool_call_id: toolCall.toolCallId ?? toolCall.id ?? toolCall.callId,
    input: toolCall.rawInput ?? toolCall.input ?? toolCall.content ?? null,
  });
}

function normalizePermissionRequest(message) {
  const params = message?.params ?? {};
  const requestId = String(message?.id ?? params.requestId ?? params.request_id ?? "");
  const toolCall = params.toolCall ?? params.tool_call ?? {};
  const options = normalizePermissionOptions(params.options);
  return {
    type: "control.request",
    request_id: requestId,
    subtype: "can_use_tool",
    tool_name: firstString(toolCall.title, toolCall.name, toolCall.kind, toolCall.type, "tool"),
    payload: compactObject({
      subtype: "can_use_tool",
      request_id: requestId,
      options,
      ...extractToolCallPayload(toolCall),
      tool_call: toolCall,
      raw_request: params,
    }),
  };
}

function isPathSensitiveTool(toolName) {
  return /write|edit|patch|delete|remove|move|rename|mkdir|touch|chmod|chown|cp|copy|mv|rm|bash|shell|command/i.test(
    String(toolName ?? ""),
  );
}

function extractCandidatePaths(value, output = []) {
  if (!value) {
    return output;
  }
  if (typeof value === "string") {
    const pathPattern = /(?:^|\s|["'`])((?:\.{1,2}|\/|~\/)[^\s"'`),;]+)/g;
    let match;
    while ((match = pathPattern.exec(value))) {
      output.push(match[1]);
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      extractCandidatePaths(entry, output);
    }
    return output;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (/path|file|dir|cwd|target|source/i.test(key)) {
        extractCandidatePaths(entry, output);
      }
    }
  }
  return output;
}

function resolvePathForPolicy(candidate, cwd) {
  if (!candidate || typeof candidate !== "string") {
    return "";
  }
  const expanded = candidate.startsWith("~/") ? join(process.env.HOME ?? "", candidate.slice(2)) : candidate;
  return resolve(cwd || process.cwd(), expanded);
}

function normalizePathForCompare(pathValue) {
  if (!pathValue) {
    return "";
  }
  try {
    return realpathSync(pathValue);
  } catch {
    try {
      return join(realpathSync(dirname(pathValue)), basename(pathValue));
    } catch {
      // Fall through to lexical normalization when no existing parent is available.
    }
    return normalize(pathValue);
  }
}

function isInsidePath(candidate, allowedPath) {
  const normalizedCandidate = normalizePathForCompare(candidate);
  const normalizedAllowed = normalizePathForCompare(allowedPath);
  return normalizedCandidate === normalizedAllowed || normalizedCandidate.startsWith(`${normalizedAllowed}/`);
}

function isWritablePath(pathValue) {
  try {
    const stat = statSync(pathValue);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

function getPendingControlMap(session) {
  if (session.pendingControls instanceof Map) {
    return session.pendingControls;
  }
  if (session._pendingControls instanceof Map) {
    return session._pendingControls;
  }
  session.pendingControls = new Map();
  return session.pendingControls;
}

function getPermissionSuggestionState(session) {
  if (session._permissionSuggestionState) {
    return session._permissionSuggestionState;
  }
  session._permissionSuggestionState = { acceptEdits: false, addedDirectories: [] };
  return session._permissionSuggestionState;
}

function isAgentFilePath(pathValue) {
  const normalized = normalize(String(pathValue ?? ""));
  if (!normalized) {
    return false;
  }
  const name = basename(normalized);
  return (
    normalized.includes("/.claude/") ||
    normalized.includes("\\.claude\\") ||
    name === "CLAUDE.md" ||
    name === "AGENTS.md"
  );
}

function hasSensitiveAgentFile(payload, cwd) {
  const candidatePaths = extractCandidatePaths(payload?.input ?? payload?.tool_call ?? payload?.raw_request ?? payload);
  return candidatePaths.some((candidate) => isAgentFilePath(resolvePathForPolicy(candidate, cwd)));
}

function normalizeAllowedPathEntries(entries) {
  return asArray(entries)
    .map((entry) => {
      const candidate = typeof entry === "string" ? entry : entry?.path ?? entry?.value ?? entry?.raw;
      return candidate ? resolve(String(candidate)) : "";
    })
    .filter(Boolean);
}

function writeAcpPermissionResponse(session, rpcId, outcome) {
  if (session.rpc?.respond) {
    session.rpc.respond(rpcId, { outcome });
    return;
  }
  session.proc?.stdin?.write?.(`${JSON.stringify({ jsonrpc: JSONRPC_VERSION, id: rpcId, result: { outcome } })}\n`);
}

function normalizeLegacyMessage(session, message) {
  if (message.type === "system" && message.subtype === "init") {
    const providerSessionId = message.session_id ?? message.sessionId;
    session.providerSessionId = providerSessionId;
    session.providerResumeId = providerSessionId;
    session.permissionMode = message.permissionMode ?? session.permissionMode;
    session.cwd = message.cwd ?? session.cwd;
    session.toolsCount = asArray(message.tools).length;
    return [
      {
        type: "session.ready",
        provider: session.provider ?? "claude",
        provider_session_id: providerSessionId,
        provider_resume_id: providerSessionId,
        model: message.model ?? session.model ?? null,
        permissionMode: session.permissionMode,
        cwd: session.cwd,
        toolsCount: session.toolsCount,
      },
    ];
  }
  if (message.type === "system" && message.subtype === "status") {
    if (message.permissionMode) {
      session.permissionMode = message.permissionMode;
      return [
        {
          type: "session.notice",
          subtype: "permission_mode.updated",
          payload: { permissionMode: message.permissionMode },
        },
      ];
    }
    return [{ type: "session.notice", subtype: "status", payload: message }];
  }
  if (message.type === "assistant") {
    const events = [];
    for (const block of asArray(message.message?.content ?? message.content)) {
      if (block?.type === "thinking") {
        continue;
      } else if (block?.type === "text") {
        const text = String(block.text ?? "").trim();
        if (text) {
          events.push({ type: "message.assistant", text });
        }
      } else if (block?.type === "tool_use") {
        events.push({
          type: "tool.call",
          call_id: block.id,
          name: block.name,
          input: block.input ?? null,
        });
      }
    }
    return events;
  }
  if (message.type === "user") {
    const events = [];
    for (const block of asArray(message.message?.content ?? message.content)) {
      if (block?.type === "tool_result") {
        events.push({
          type: "tool.result",
          provider: session.provider ?? "claude",
          call_id: block.tool_use_id ?? block.toolCallId,
          content: block.content,
          output: block.content,
          is_error: block.is_error === true,
        });
      }
    }
    return events;
  }
  if (message.type === "control_request") {
    const request = message.request ?? {};
    const requestId = String(message.request_id ?? message.requestId ?? "");
    const event = {
      type: "control.request",
      request_id: requestId,
      subtype: request.subtype ?? "can_use_tool",
      tool_name: request.tool_name ?? request.toolName ?? request.name,
      sensitive: hasSensitiveAgentFile(request, session.cwd),
      payload: {
        ...request,
        request_id: requestId,
      },
    };
    const pendingMap = getPendingControlMap(session);
    const autoApproval = session.shouldAutoApproveControlRequest?.(request);
    if (autoApproval) {
      const optionId = selectPermissionOption(request.options, true) || "allow";
      writeAcpPermissionResponse(session, requestId, { outcome: "selected", optionId });
      return [
        {
          type: "session.notice",
          subtype: "control.auto_allowed",
          request_id: requestId,
          reason: autoApproval.reason,
        },
      ];
    }
    pendingMap.set(requestId, {
      rpcId: requestId,
      event,
      options: request.options ?? [{ id: "allow", kind: "allow" }, { id: "deny", kind: "deny" }],
    });
    return [event];
  }
  if (message.type === "result") {
    return [
      {
        type: "turn.completed",
        status: "completed",
        usage: message.usage ?? null,
      },
    ];
  }
  return [];
}

export class ClaudeCodeSession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.id = options.sessionId || options.id || "";
    this.agentId = options.agentId || "";
    this.cwd = options.cwd || process.cwd();
    this.model = options.model || "";
    this.permissionMode = options.permissionMode || "default";
    this.sessionName = options.sessionName || "";
    this.resumeSessionId = options.resumeSessionId || "";
    this.bootstrapTimeoutMs = options.bootstrapTimeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;
    this.spawnFn = options.spawnFn || spawn;
    this.resolveRunnerFn = options.resolveRunnerFn || resolveManagedClaudeAcpRunner;
    this.resolveClaudeCliAuthCommandFn = options.resolveClaudeCliAuthCommandFn || resolveClaudeCliAuthCommand;
    this.hostServiceDir = options.hostServiceDir || HOST_SERVICE_DIR;
    this.runtimeEnv =
      options.runtimeEnv && typeof options.runtimeEnv === "object" && !Array.isArray(options.runtimeEnv)
        ? { ...options.runtimeEnv }
        : {};
    this.provider = "claude";
    this.capabilities = { interactiveSession: true, resume: true };
    this.providerSessionId = "";
    this.providerResumeId = "";
    this.configOptions = [];
    this.queue = [];
    this.pendingControls = new Map();
    this.seenUpdates = new Set();
    this.activePromptCount = 0;
    this.activePromptState = null;
    this._promptEverSent = false;
    this.lastRuntimeError = null;
    this.ready = false;
    this.alive = false;
    this.stopping = false;
    this.start();
  }

  start() {
    let runnerResolution;
    let claudeCliResolution;
    try {
      runnerResolution =
        this.options.runnerResolution ??
        this.resolveRunnerFn({
          hostServiceDir: this.hostServiceDir,
          packageRootDir: this.options.packageRootDir,
          runnerPath: this.options.runnerPath,
        });
      claudeCliResolution =
        this.options.claudeCliResolution ??
        this.resolveClaudeCliAuthCommandFn({
          command: this.options.authCommand || this.options.command || "claude",
          hostServiceDir: this.hostServiceDir,
        });
    } catch (error) {
      this.emitRuntimeError(error, { phase: "resolve" });
      return;
    }
    const env = {
      ...process.env,
      ...(this.options.env || {}),
      ...this.runtimeEnv,
      OPENAB_AGENT_COMMAND: claudeCliResolution.resolved_command,
      CLAUDE_CODE_EXECUTABLE: claudeCliResolution.resolved_command,
    };
    const proc = this.spawnFn(runnerResolution.runner_path, [], {
      cwd: this.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;
    this.runnerResolution = runnerResolution;
    this.claudeCliResolution = claudeCliResolution;
    this.alive = true;
    this.rpc = new JsonRpcLineClient({
      proc,
      onNotification: (message) => this.handleNotification(message),
      onRequest: (message) => this.handleAgentRequest(message),
      onRuntimeError: (error, context) => this.emitRuntimeError(error, context),
    });
    proc.stderr?.setEncoding?.("utf8");
    proc.stderr?.on("data", (chunk) => {
      this.emit("stderr", String(chunk ?? ""));
      this.emit("event", { type: "runtime.stderr", text: String(chunk ?? "") });
    });
    proc.on?.("error", (error) => this.emitRuntimeError(error, { phase: "process" }));
    proc.on?.("exit", (code, signal) => this.handleProcessExit(code, signal));
    this.bootstrapPromise = withTimeout(this.bootstrap(), this.bootstrapTimeoutMs, "Claude ACP bootstrap").catch((error) => {
      this.emitRuntimeError(error, { phase: "bootstrap" });
      this.stop();
    });
  }

  async bootstrap() {
    const initializeResult = await this.rpc.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: {
        name: "Oysterun Host",
        version: "routec-p106",
      },
      capabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
        terminal: false,
      },
    });
    this.agentCapabilities = initializeResult?.capabilities ?? {};
    this.rpc.notify("initialized", {});
    const baseParams = this.buildSessionParams();
    const sessionResult = this.resumeSessionId
      ? await this.rpc.request("session/load", {
          ...baseParams,
          sessionId: this.resumeSessionId,
        })
      : await this.rpc.request("session/new", baseParams);
    this.providerSessionId = sessionResult?.sessionId || this.resumeSessionId;
    this.providerResumeId = this.providerSessionId;
    this.configOptions = [
      ...configOptionsFromResult(initializeResult),
      ...configOptionsFromResult(sessionResult),
    ];
    if (!this.providerSessionId) {
      throw new Error("Claude ACP session did not return a sessionId");
    }
    await this.applyConfiguredModel();
    this.ready = true;
    this.emit("event", {
      type: "session.ready",
      provider: this.provider,
      provider_session_id: this.providerSessionId,
      provider_resume_id: this.providerResumeId,
      model: this.model || extractCurrentModel(this.configOptions),
      cwd: this.cwd,
      permissionMode: this.permissionMode,
      toolsCount: asArray(sessionResult?.commands).length,
      runtime: {
        protocol: "acp",
        runner_source: this.runnerResolution?.runner_source,
        runner_path: this.runnerResolution?.runner_path,
        claude_auth_source: this.claudeCliResolution?.source,
      },
    });
    const drain =
      typeof this.drainPromptQueue === "function"
        ? this.drainPromptQueue
        : ClaudeCodeSession.prototype.drainPromptQueue;
    drain.call(this);
  }

  buildSessionParams() {
    const additionalDirectories = collectAllowedDirectories({
      cwd: this.cwd,
      workspacePolicy: this.options.workspacePolicy,
      assetReadablePaths: this.options.assetReadablePaths,
    });
    return compactObject({
      cwd: this.cwd,
      mcpServers: [],
      additionalDirectories: additionalDirectories.length ? additionalDirectories : undefined,
    });
  }

  async applyConfiguredModel() {
    if (!this.model) {
      return;
    }
    const modelConfig = resolveAcpModelConfigValue(
      this.configOptions,
      this.model
    );
    if (modelConfig.reason === "model_config_unavailable") {
      this.emit("event", {
        type: "session.notice",
        subtype: "model_config_unavailable",
        model: this.model,
      });
      return;
    }
    if (!modelConfig.available) {
      const error = new Error(
        `Claude ACP model "${this.model}" is not available in config option "${modelConfig.configOptionId}"`
      );
      error.code = "claude_acp_model_config_value_unavailable";
      this.emitRuntimeError(error, {
        phase: "set_model",
        model: this.model,
        configOptionId: modelConfig.configOptionId,
        availableValues: modelConfig.values.map((entry) => entry.rawValue),
      });
      throw error;
    }
    this.emit("event", {
      type: "session.notice",
      subtype: "model_config_resolved",
      model: this.model,
      configOptionId: modelConfig.configOptionId,
      configOptionValue: modelConfig.value,
      mapping: modelConfig.reason,
    });
    try {
      await this.rpc.request("session/set_config_option", {
        sessionId: this.providerSessionId,
        configId: modelConfig.configOptionId,
        value: modelConfig.value,
      });
    } catch (error) {
      this.emitRuntimeError(error, {
        phase: "set_model",
        model: this.model,
        configId: modelConfig.configOptionId,
        configOptionId: modelConfig.configOptionId,
        configOptionValue: modelConfig.value,
        mapping: modelConfig.reason,
        rpc_method: error.rpc_method,
        request_id: error.request_id,
      });
      throw error;
    }
  }

  releasePromptSlot(promptState) {
    if (!promptState || promptState.promptSlotReleased) return;
    promptState.promptSlotReleased = true;
    this.activePromptCount = Math.max(0, this.activePromptCount - 1);
  }

  emitPromptCompletion(promptState, event) {
    if (!promptState || !event || promptState.completionEmitted) return;
    promptState.completionEmitted = true;
    this.emit("event", event);
    this.releasePromptSlot(promptState);
    if (this.activePromptState === promptState) {
      this.activePromptState = null;
    }
  }

  send(text) {
    const prompt = String(text ?? "");
    if (!Array.isArray(this.queue)) {
      this.queue = [];
    }
    this.queue.push(prompt);
    const drain =
      typeof this.drainPromptQueue === "function"
        ? this.drainPromptQueue
        : ClaudeCodeSession.prototype.drainPromptQueue;
    drain.call(this);
  }

  hasActivePromptInFlight() {
    return Boolean(
      this.activePromptState &&
        this.activePromptState.promptSlotReleased !== true &&
        this.activePromptState.completionEmitted !== true
    );
  }

  drainPromptQueue() {
    if (!this.ready) {
      return;
    }
    if (!this.alive || !this.providerSessionId) return;
    const activePromptInFlight =
      typeof this.hasActivePromptInFlight === "function"
        ? this.hasActivePromptInFlight()
        : ClaudeCodeSession.prototype.hasActivePromptInFlight.call(this);
    if (activePromptInFlight) {
      if (this.queue.length > 0 && this.activePromptState) {
        const requestId = this.activePromptState.requestId || null;
        if (this._queueWaitRequestId !== requestId) {
          this._queueWaitRequestId = requestId;
          this.emit("event", {
            type: "session.notice",
            provider: this.provider,
            subtype: "turn.queue_wait",
            payload: {
              session_id: this.providerSessionId,
              request_id: requestId,
              queued_prompt_count: this.queue.length,
            },
          });
        }
      }
      return;
    }
    const prompt = this.queue.shift();
    if (prompt === undefined) return;
    const dispatch =
      typeof this.dispatchPrompt === "function"
        ? this.dispatchPrompt
        : ClaudeCodeSession.prototype.dispatchPrompt;
    dispatch.call(this, prompt);
  }

  dispatchPrompt(prompt) {
    const promptState = {
      outputSeen: false,
      assistantOutputSeen: false,
      finalOutputSeen: false,
      completionEmitted: false,
      promptSlotReleased: false,
      cancelRequested: false,
      assistantMessageAssembler: new ClaudeAcpAssistantMessageAssembler(),
      requestId: null,
    };
    this.activePromptState = promptState;
    delete this._queueWaitRequestId;
    this._promptEverSent = true;
    this.activePromptCount += 1;
    const requestPromise = this.rpc.request("session/prompt", {
      sessionId: this.providerSessionId,
      prompt: buildPromptBlocks(prompt),
    });
    if (
      requestPromise &&
      typeof requestPromise === "object" &&
      Object.prototype.hasOwnProperty.call(requestPromise, "requestId")
    ) {
      promptState.requestId = requestPromise.requestId;
    }
    Promise.resolve(requestPromise)
      .then((result) => {
        if (promptState.completionEmitted) return;
        const status = promptState.cancelRequested
          ? "interrupted"
          : normalizeStopStatus(result?.stopReason);
        const completionEvent = {
          type: "turn.completed",
          status,
          stop_reason:
            result?.stopReason ||
            (promptState.cancelRequested ? "client_cancel" : null),
          usage: result?.usage ?? null,
        };
        if (isClaudeAcpSuccessfulPromptStatus(status)) {
          const confirmedEvent = promptState.assistantMessageAssembler.flush();
          if (confirmedEvent) {
            promptState.finalOutputSeen = true;
            this.emit("event", confirmedEvent);
          }
        }
        this.emitPromptCompletion(promptState, completionEvent);
      })
      .catch((error) => {
        if (promptState.completionEmitted) return;
        this.emitRuntimeError(error, { phase: "prompt" });
        this.emitPromptCompletion(promptState, {
          type: "turn.completed",
          status: "error",
          error: describeError(error),
        });
      })
      .finally(() => {
        this.releasePromptSlot(promptState);
        const drain =
          typeof this.drainPromptQueue === "function"
            ? this.drainPromptQueue
            : ClaudeCodeSession.prototype.drainPromptQueue;
        drain.call(this);
      });
  }

  handleNotification(message) {
    const normalizedEvents = this.normalizeMessage(message);
    const promptState = this.activePromptState;
    const events = promptState?.assistantMessageAssembler
      ? normalizedEvents.flatMap((event) =>
          promptState.assistantMessageAssembler.consume(event)
        )
      : normalizedEvents;
    for (const event of events) {
      if (promptState) {
        if (isClaudeAcpPromptOutputEvent(event)) {
          promptState.outputSeen = true;
        }
        if (isClaudeAcpPromptAssistantOutputEvent(event)) {
          promptState.assistantOutputSeen = true;
        }
        if (isClaudeAcpPromptFinalOutputEvent(event)) {
          promptState.finalOutputSeen = true;
        }
      }
      this.emit("event", event);
    }
  }

  handleAgentRequest(message) {
    if (message.method === "session/request_permission") {
      const event = normalizePermissionRequest(message);
      const requestId = event.request_id;
      getPendingControlMap(this).set(requestId, {
        rpcId: message.id,
        event,
        options: message.params?.options ?? [],
      });
      const autoApproval = this.shouldAutoApproveControlRequest(event.payload);
      if (autoApproval?.allow) {
        const optionId = selectPermissionOption(message.params?.options, true);
        if (optionId) {
          this.rpc.respond(message.id, { outcome: { outcome: "selected", optionId } });
          getPendingControlMap(this).delete(requestId);
          this.emit("event", {
            type: "control.auto_response",
            request_id: requestId,
            behavior: "allow",
            option_id: optionId,
            reason: autoApproval.reason,
          });
          return;
        }
      }
      this.emit("event", event);
      return;
    }
    this.rpc.reject(message.id, -32601, `Unsupported Claude ACP request method ${message.method}`);
    this.emit("event", {
      type: "runtime.error",
      phase: "agent_request",
      error: { message: `Unsupported Claude ACP request method ${message.method}` },
    });
  }

  normalizeMessage(message) {
    if (!message || typeof message !== "object") {
      return [];
    }
    if (message.method === "session/update") {
      const dedupeKey = stableJson(message.params ?? {});
      if (this.seenUpdates.has(dedupeKey)) {
        return [];
      }
      this.seenUpdates.add(dedupeKey);
      return normalizeClaudeSessionUpdate(message.params);
    }
    if (message.method === "session/request_permission") {
      return [normalizePermissionRequest(message)];
    }
    if (message.type) {
      return normalizeLegacyMessage(this, message);
    }
    return normalizeClaudeSessionUpdate(message);
  }

  respondToControl(payload = {}) {
    const requestId = String(payload.request_id ?? payload.requestId ?? payload.id ?? "");
    const pendingMap = getPendingControlMap(this);
    const pending = pendingMap.get(requestId);
    if (!pending) {
      return false;
    }
    const response = payload.response ?? payload;
    if (response.grantSuggestion || payload.grantSuggestion) {
      this.applyPermissionSuggestionGrant(response.grantSuggestion ?? payload.grantSuggestion);
    }
    const explicitOutcome = response.outcome && typeof response.outcome === "object" ? response.outcome : null;
    const optionId =
      response.optionId ??
      response.option_id ??
      response.selected_option_id ??
      selectPermissionOption(pending.options, response.allow !== false && response.behavior !== "deny");
    const outcome = explicitOutcome ?? (optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" });
    writeAcpPermissionResponse(this, pending.rpcId ?? requestId, outcome);
    pendingMap.delete(requestId);
    return true;
  }

  getPendingControlRequests() {
    return [...getPendingControlMap(this).entries()].map(([requestId, entry]) => ({
      request_id: requestId,
      subtype: entry.event?.subtype ?? entry.subtype,
      payload: entry.event?.payload ?? entry.payload,
      ...entry.event,
    }));
  }

  shouldAutoApproveControlRequest(payload = {}) {
    const subtype = payload.subtype ?? payload.type;
    if (subtype !== "can_use_tool") {
      return null;
    }
    const toolName = payload.tool_name ?? payload.toolName ?? payload.name;
    if (hasSensitiveAgentFile(payload, this.cwd)) {
      return null;
    }
    if (!isPathSensitiveTool(toolName)) {
      return { allow: true, reason: "nonSensitiveTool" };
    }
    if (this.permissionMode === "bypassPermissions") {
      return { allow: true, reason: "bypassPermissions" };
    }
    const candidatePaths = extractCandidatePaths(payload.input ?? payload.tool_call ?? payload.raw_request);
    if (!candidatePaths.length) {
      return null;
    }
    const suggestionState = getPermissionSuggestionState(this);
    const allowed = [
      ...collectAllowedDirectories({
        cwd: this.cwd,
        workspacePolicy: this.options?.workspacePolicy ?? this.workspacePolicy,
        assetReadablePaths: this.options?.assetReadablePaths ?? this.assetReadablePaths,
      }),
      ...normalizeAllowedPathEntries(suggestionState.addedDirectories),
    ];
    if (suggestionState.acceptEdits && this.cwd) {
      allowed.push(resolve(this.cwd));
    }
    if (!allowed.length) {
      return null;
    }
    for (const candidate of candidatePaths) {
      const resolved = resolvePathForPolicy(candidate, this.cwd);
      if (!allowed.some((allowedPath) => isInsidePath(resolved, allowedPath))) {
        return null;
      }
      if (this.permissionMode === "addDirectories" && !isWritablePath(dirname(resolved))) {
        return null;
      }
    }
    if (suggestionState.acceptEdits) {
      return { allow: true, reason: "acceptEdits" };
    }
    if (suggestionState.addedDirectories?.length) {
      return { allow: true, reason: "addDirectories" };
    }
    if (this.permissionMode === "acceptEdits" || this.permissionMode === "addDirectories") {
      return { allow: true, reason: this.permissionMode };
    }
    return null;
  }

  applyPermissionSuggestionGrant(suggestion = {}) {
    const state = getPermissionSuggestionState(this);
    if (suggestion.type === "setMode" && suggestion.mode === "acceptEdits") {
      state.acceptEdits = true;
      this.emit?.("event", {
        type: "session.notice",
        subtype: "control.permission_grant_applied",
        grant: suggestion,
      });
      return "acceptEdits";
    }
    const directories =
      suggestion.type === "addDirectories"
        ? asArray(suggestion.directories ?? suggestion.paths ?? suggestion.path)
        : [suggestion.path ?? suggestion.directory ?? suggestion.dir].filter(Boolean);
    if (!directories.length) {
      return null;
    }
    const resolvedDirectories = directories.map((entry) => resolvePathForPolicy(entry, this.cwd));
    for (const resolved of resolvedDirectories) {
      if (!state.addedDirectories.some((entry) => resolvePathForPolicy(entry, this.cwd) === resolved)) {
        state.addedDirectories.push(resolved);
      }
      const policy = this.options?.workspacePolicy ?? this.workspacePolicy;
      if (
        !isWorkspaceAllowedPathPolicyDisabled(policy) &&
        policy?.allowedPaths &&
        !policy.allowedPaths.some((entry) => resolvePathForPolicy(entry.path ?? entry, this.cwd) === resolved)
      ) {
        policy.allowedPaths.push({ raw: resolved, path: resolved });
      }
    }
    this.emit?.("event", {
      type: "session.notice",
      subtype: "control.permission_grant_applied",
      grant: suggestion,
      directories: resolvedDirectories,
    });
    return resolvedDirectories[0] ?? null;
  }

  interrupt() {
    if (!this.ready || !this.providerSessionId) {
      return {
        status: "not_ready",
        accepted: false,
        idempotent: true,
        provider: "claude",
        provider_interrupt_attempted: false,
        provider_interrupt_method: "session/cancel",
        provider_session_id_present: Boolean(this.providerSessionId),
        reason: "claude_acp_session_not_ready",
        raw_provider_response_exposed: false,
      };
    }
    const activePromptState = this.activePromptState;
    if (
      !activePromptState ||
      activePromptState.promptSlotReleased === true ||
      activePromptState.completionEmitted === true
    ) {
      return {
        status: "no_active_prompt",
        accepted: false,
        idempotent: true,
        provider: "claude",
        provider_interrupt_attempted: false,
        provider_interrupt_method: "session/cancel",
        provider_session_id_present: true,
        reason: "claude_acp_prompt_not_in_flight",
        raw_provider_response_exposed: false,
      };
    }
    if (activePromptState.cancelRequested === true) {
      return {
        status: "already_interrupting",
        accepted: true,
        idempotent: true,
        provider: "claude",
        provider_interrupt_attempted: false,
        provider_interrupt_method: "session/cancel",
        provider_session_id_present: true,
        reason: "claude_acp_cancel_already_requested",
        raw_provider_response_exposed: false,
      };
    }
    activePromptState.cancelRequested = true;
    this.rpc.notify("session/cancel", { sessionId: this.providerSessionId });
    return {
      status: "accepted",
      accepted: true,
      idempotent: false,
      provider: "claude",
      provider_interrupt_attempted: true,
      provider_interrupt_method: "session/cancel",
      provider_session_id_present: true,
      raw_provider_response_exposed: false,
    };
  }

  stop() {
    if (!this.proc || !this.alive) {
      return;
    }
    this.stopping = true;
    this.rpc?.expectClose?.();
    try {
      if (this.ready && this.providerSessionId && this.activePromptCount > 0) {
        this.rpc?.notify("session/cancel", { sessionId: this.providerSessionId });
      }
      this.proc.stdin?.end?.();
    } catch {
      // Best-effort shutdown only.
    }
    this.proc.kill?.("SIGTERM");
  }

  kill() {
    if (!this.proc || !this.alive) {
      return;
    }
    this.stopping = true;
    this.rpc?.expectClose?.();
    this.proc.kill?.("SIGKILL");
  }

  handleProcessExit(code, signal) {
    const exitDiagnostic = buildClaudeAcpExitDiagnostic(this, code, signal);
    this.alive = false;
    this.ready = false;
    this.rpc?.close?.();
    if (exitDiagnostic.early_exit) {
      const error = new Error(exitDiagnostic.summary);
      error.code = "claude_acp_provider_early_exit";
      error.data = exitDiagnostic;
      this.emitRuntimeError(error, {
        phase: "exit",
        ...exitDiagnostic,
      });
    }
    const payload = {
      type: "session.exit",
      code,
      signal,
      provider_session_id: this.providerSessionId || null,
      provider_resume_id: this.providerResumeId || this.providerSessionId || null,
      early_exit: exitDiagnostic.early_exit,
      exit_reason: exitDiagnostic.reason,
      exit_diagnostic: exitDiagnostic,
      display_text: exitDiagnostic.early_exit
        ? `${exitDiagnostic.summary}.`
        : undefined,
    };
    this.emit("event", payload);
    this.emit("exit", code, signal);
  }

  emitRuntimeError(error, context = {}) {
    if (
      this.stopping &&
      /Claude ACP (?:runner|JSON-RPC client) (?:exited|closed)/i.test(
        String(error?.message ?? "")
      )
    ) {
      return;
    }
    const diagnosticError = describeError(error);
    this.lastRuntimeError = compactObject({
      error: diagnosticError,
      context,
      created_at: new Date().toISOString(),
    });
    this.emit("event", {
      type: "runtime.error",
      provider: this.provider,
      error: diagnosticError,
      context,
    });
  }
}

export class ClaudeCodeAdapter {
  constructor(options = {}) {
    this.options = { ...options };
    if (
      !this.options.runnerPath &&
      typeof process.env.OYSTERUN_TEST_CLAUDE_ACP_RUNNER_PATH === "string" &&
      process.env.OYSTERUN_TEST_CLAUDE_ACP_RUNNER_PATH.trim()
    ) {
      this.options.runnerPath = process.env.OYSTERUN_TEST_CLAUDE_ACP_RUNNER_PATH.trim();
    }
    this.providerId = "claude";
    this.capabilities = { interactiveSession: true, resume: true };
    this.sessions = new Map();
  }

  supportsResume() {
    return true;
  }

  getConfiguredCommand() {
    if (typeof this.options.getConfiguredCommand === "function") {
      return this.options.getConfiguredCommand();
    }
    return this.options.authCommand || this.options.command || "claude";
  }

  startSession(options = {}) {
    const configuredCommand =
      options.authCommand ||
      this.getConfiguredCommand() ||
      this.options.authCommand ||
      this.options.command ||
      "claude";
    const session = new ClaudeCodeSession({
      ...this.options,
      ...options,
      authCommand: configuredCommand,
      hostServiceDir: this.options.hostServiceDir || HOST_SERVICE_DIR,
    });
    const key = options.sessionId || options.id || session.providerSessionId || `${Date.now()}-${Math.random()}`;
    this.sessions.set(key, session);
    session.on("exit", () => {
      this.sessions.delete(key);
    });
    return session;
  }

  sendMessage(session, message) {
    const text =
      typeof message === "string"
        ? message
        : message?.text ?? message?.rawText ?? message?.content ?? message?.prompt ?? "";
    session.send(text);
  }

  respondToControl(session, response) {
    return session.respondToControl(response);
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
}

export default ClaudeCodeAdapter;
