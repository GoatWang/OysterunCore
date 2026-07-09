import { execFileSync, spawn } from "child_process";
import { existsSync } from "fs";
import { basename, delimiter, join } from "path";
import { homedir } from "os";
import { performance } from "perf_hooks";
import {
  getConfiguredProviderCommand,
  requireProvider,
} from "./provider-registry.mjs";
import { resolveManagedClaudeAcpRunner } from "./claude-acp-model-discovery.mjs";

export const PROVIDER_STARTUP_LOG_PREFIX = "[provider-startup]";
export const PROVIDER_STARTUP_LOG_PATH = "~/.oysterun/logs/oysterun-host.log";
export const PROVIDER_STARTUP_LOG_QUERY =
  "grep '\\[provider-startup\\]' ~/.oysterun/logs/oysterun-host.log | tail -n 80";

const DEFAULT_CODEX_PREFLIGHT_TIMEOUT_MS = 5000;
const EARLY_EXIT_AFTER_READY_GRACE_MS = 2500;
const MAX_TAIL_CHARS = 1800;

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function compactObject(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === undefined) continue;
    out[key] = entry;
  }
  return out;
}

export function redactProviderStartupText(value, maxChars = MAX_TAIL_CHARS) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const noAnsi = raw
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const redacted = noAnsi
    .replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g,
      "[REDACTED_SECRET]"
    )
    .replace(
      /\b(token|api[_-]?key|password|secret|authorization|cookie)(\s*[:=]\s*)([^\s'",;]+)/gi,
      "$1$2[REDACTED]"
    );
  if (redacted.length <= maxChars) return redacted;
  return `${redacted.slice(0, maxChars)}...<truncated>`;
}

function pathSummary(pathValue = process.env.PATH || "") {
  const entries = String(pathValue || "")
    .split(delimiter)
    .filter(Boolean);
  const home = homedir();
  const summarize = (entry) =>
    entry.startsWith(home) ? entry.replace(home, "~") : entry;
  return {
    entry_count: entries.length,
    first_entries: entries.slice(0, 4).map(summarize),
    last_entry: entries.length ? summarize(entries[entries.length - 1]) : null,
    truncated: entries.length > 5,
  };
}

function providerHome(provider, env = process.env) {
  const home = env.HOME || homedir();
  if (provider === "codex") {
    return env.CODEX_HOME || join(home, ".codex");
  }
  if (provider === "claude") {
    return env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  }
  return null;
}

function defaultProviderCommand(provider) {
  if (provider === "claude") return "claude";
  if (provider === "codex") return "codex";
  return null;
}

function configuredCommandForProvider(config, provider) {
  return (
    getConfiguredProviderCommand(config || {}, provider) ||
    defaultProviderCommand(provider)
  );
}

function resolveCommand(command) {
  const configured = normalizeString(command);
  if (!configured) {
    return {
      configured_command: null,
      resolved_command: null,
      available: false,
      error_code: "provider_command_missing",
      message: "Provider command is not configured.",
    };
  }
  if (configured.includes("/")) {
    return existsSync(configured)
      ? {
          configured_command: configured,
          resolved_command: configured,
          available: true,
        }
      : {
          configured_command: configured,
          resolved_command: null,
          available: false,
          error_code: "provider_command_missing",
          message: `Configured provider command does not exist: ${configured}`,
        };
  }
  try {
    const resolved = execFileSync("which", [configured], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (resolved) {
      return {
        configured_command: configured,
        resolved_command: resolved,
        available: true,
      };
    }
  } catch {
    // Returned below as a structured preflight failure.
  }
  return {
    configured_command: configured,
    resolved_command: null,
    available: false,
    error_code: "provider_command_missing",
    message: `Configured provider command could not be resolved: ${configured}`,
  };
}

function buildBaseDiagnostic({
  attemptId,
  provider,
  agentId,
  cwd,
  sessionIdCandidate = null,
  configuredCommand = null,
  resolvedCommand = null,
  phase,
  success = null,
  durationMs = null,
  historyWritten = false,
  ready = false,
  errorCode = null,
  message = null,
  stdoutTail = "",
  stderrTail = "",
  exitCode = null,
  signal = null,
  env = process.env,
}) {
  return compactObject({
    attempt_id: attemptId,
    created_at: nowIso(),
    provider,
    agent_id: agentId,
    cwd,
    session_id: sessionIdCandidate || null,
    session_id_candidate: sessionIdCandidate || null,
    configured_command: configuredCommand,
    resolved_command: resolvedCommand,
    command_name: resolvedCommand ? basename(resolvedCommand) : null,
    home: env.HOME || homedir(),
    path_summary: pathSummary(env.PATH),
    provider_home: providerHome(provider, env),
    phase,
    duration_ms:
      Number.isFinite(durationMs) && durationMs >= 0
        ? Math.round(durationMs)
        : null,
    success,
    error_code: errorCode,
    message: message ? redactProviderStartupText(message, 800) : null,
    stdout_tail_redacted: redactProviderStartupText(stdoutTail || ""),
    stderr_tail_redacted: redactProviderStartupText(stderrTail || ""),
    exit_code: exitCode,
    signal: signal || null,
    history_written: historyWritten === true,
    ready: ready === true,
  });
}

export function logProviderStartupEvent(event) {
  const payload = { ...event };
  if (!payload.created_at) payload.created_at = nowIso();
  if (payload.message) {
    payload.message = redactProviderStartupText(payload.message, 800);
  }
  if (payload.stdout_tail_redacted) {
    payload.stdout_tail_redacted = redactProviderStartupText(
      payload.stdout_tail_redacted
    );
  }
  if (payload.stderr_tail_redacted) {
    payload.stderr_tail_redacted = redactProviderStartupText(
      payload.stderr_tail_redacted
    );
  }
  console.error(`${PROVIDER_STARTUP_LOG_PREFIX} ${JSON.stringify(payload)}`);
}

function buildPreflightFailureResponse(diagnostic) {
  const safeDiagnostic = {
    ...diagnostic,
    log_path: PROVIDER_STARTUP_LOG_PATH,
    log_query: PROVIDER_STARTUP_LOG_QUERY,
    secret_fields_redacted: true,
  };
  return {
    error: "Provider startup failed before the session was created.",
    code: "provider_startup_preflight_failed",
    provider: diagnostic.provider,
    phase: diagnostic.phase,
    provider_startup: safeDiagnostic,
    provider_error_message: diagnostic.message || null,
    log_path: PROVIDER_STARTUP_LOG_PATH,
    log_query: PROVIDER_STARTUP_LOG_QUERY,
    history_written: false,
    ready: false,
  };
}

function passResult(diagnostic, extra = {}) {
  return {
    ok: true,
    diagnostic: {
      ...diagnostic,
      success: true,
      history_written: false,
      ready: false,
      ...extra,
    },
  };
}

function failResult(diagnostic, statusCode = 503) {
  const failureDiagnostic = {
    ...diagnostic,
    success: false,
    history_written: false,
    ready: false,
  };
  return {
    ok: false,
    statusCode,
    diagnostic: failureDiagnostic,
    response: buildPreflightFailureResponse(failureDiagnostic),
  };
}

function buildClaudeAcpStartupReadiness() {
  try {
    const runner = resolveManagedClaudeAcpRunner();
    return {
      claude_acp_readiness_checked: true,
      claude_acp_startup_ready: true,
      claude_acp_runner_available: true,
      claude_acp_runner_source: runner.runner_source || null,
      claude_acp_runner_package: runner.package_name || null,
      claude_acp_runner_version: runner.package_version || null,
      claude_acp_runner_path_configured:
        typeof runner.runner_path === "string" && runner.runner_path.length > 0,
      claude_acp_session_new_required: true,
    };
  } catch (err) {
    return {
      claude_acp_readiness_checked: true,
      claude_acp_startup_ready: false,
      claude_acp_runner_available: false,
      claude_acp_readiness_error_code:
        err?.code || "claude_acp_startup_readiness_failed",
      claude_acp_readiness_error: redactProviderStartupText(
        err?.message || String(err),
        800
      ),
      claude_acp_session_new_required: true,
    };
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);
}

class JsonRpcLinePreflightClient {
  constructor(proc) {
    this.proc = proc;
    this.stdoutBuffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutTail = "";
    this.stderrTail = "";
    this.exitCode = null;
    this.signal = null;
    proc.stdout.on("data", (chunk) => {
      const text = String(chunk ?? "");
      this.stdoutTail = `${this.stdoutTail}${text}`.slice(-MAX_TAIL_CHARS);
      this.consumeStdout(text);
    });
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk ?? "");
      this.stderrTail = `${this.stderrTail}${text}`.slice(-MAX_TAIL_CHARS);
    });
    proc.on("exit", (code, signal) => {
      this.exitCode = Number.isInteger(code) ? code : null;
      this.signal = signal || null;
      const error = new Error(
        `Codex app-server exited before initialize response (code=${
          code ?? "none"
        }, signal=${signal || "none"})`
      );
      error.code = "codex_app_server_exit_before_initialize";
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    proc.on("error", (err) => {
      const error = new Error(err.message || String(err));
      error.code = "codex_app_server_spawn_error";
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  consumeStdout(text) {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        const error = new Error(`Malformed Codex app-server JSON: ${err.message}`);
        error.code = "codex_app_server_malformed_json";
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (
      message?.id === undefined ||
      (!Object.prototype.hasOwnProperty.call(message, "result") &&
        !Object.prototype.hasOwnProperty.call(message, "error"))
    ) {
      return;
    }
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    if (message.error) {
      const error = new Error(
        message.error.message || JSON.stringify(message.error)
      );
      error.code = "codex_app_server_initialize_error";
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  request(method, params = {}) {
    const id = String(this.nextId++);
    this.writeJson({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method, params = {}) {
    this.writeJson({ jsonrpc: "2.0", method, params });
  }

  writeJson(payload) {
    if (!this.proc.stdin?.writable) {
      const error = new Error("Codex app-server stdin is not writable");
      error.code = "codex_app_server_stdin_unavailable";
      throw error;
    }
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  close() {
    if (typeof this.proc.kill === "function" && this.proc.killed !== true) {
      this.proc.kill("SIGTERM");
    }
  }
}

async function runCodexInitializePreflight({
  attemptId,
  provider,
  agentId,
  cwd,
  sessionIdCandidate,
  configuredCommand,
  resolvedCommand,
  env,
  spawnFn = spawn,
  timeoutMs = DEFAULT_CODEX_PREFLIGHT_TIMEOUT_MS,
}) {
  const startedAt = performance.now();
  const proc = spawnFn(resolvedCommand, ["app-server", "--listen", "stdio://"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  const client = new JsonRpcLinePreflightClient(proc);
  try {
    await withTimeout(
      client.request("initialize", {
        clientInfo: {
          name: "oysterun",
          title: "Oysterun Host",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      }),
      timeoutMs,
      "Codex app-server initialize"
    );
    client.notify("initialized", {});
    return passResult(
      buildBaseDiagnostic({
        attemptId,
        provider,
        agentId,
        cwd,
        sessionIdCandidate,
        configuredCommand,
        resolvedCommand,
        phase: "codex_app_server_initialize",
        durationMs: performance.now() - startedAt,
        stdoutTail: client.stdoutTail,
        stderrTail: client.stderrTail,
        exitCode: client.exitCode,
        signal: client.signal,
        env,
      })
    );
  } catch (err) {
    return failResult(
      buildBaseDiagnostic({
        attemptId,
        provider,
        agentId,
        cwd,
        sessionIdCandidate,
        configuredCommand,
        resolvedCommand,
        phase: "codex_app_server_initialize",
        durationMs: performance.now() - startedAt,
        success: false,
        errorCode: err.code || "codex_app_server_initialize_failed",
        message: err.message || String(err),
        stdoutTail: client.stdoutTail,
        stderrTail: client.stderrTail,
        exitCode: client.exitCode,
        signal: client.signal,
        env,
      })
    );
  } finally {
    client.close();
  }
}

async function runClaudeCommandAuthPreflight({
  attemptId,
  provider,
  agentId,
  cwd,
  sessionIdCandidate,
  configuredCommand,
  resolvedCommand,
  config,
  providerAuthManager,
  env,
}) {
  const startedAt = performance.now();
  let authStatus = null;
  let authStatusError = null;
  if (providerAuthManager && typeof providerAuthManager.getStatus === "function") {
    try {
      authStatus = await providerAuthManager.getStatus(provider, {
        ...(config || {}),
        claude_command: configuredCommand,
      });
    } catch (err) {
      authStatusError = err;
    }
  }
  const diagnostic = buildBaseDiagnostic({
    attemptId,
    provider,
    agentId,
    cwd,
    sessionIdCandidate,
    configuredCommand,
    resolvedCommand,
    phase: "claude_command_auth_status",
    durationMs: performance.now() - startedAt,
    message: authStatusError ? authStatusError.message : authStatus?.message,
    env,
  });
  const acpReadiness = buildClaudeAcpStartupReadiness();
  if (acpReadiness.claude_acp_startup_ready !== true) {
    return failResult({
      ...diagnostic,
      phase: "claude_acp_startup_readiness",
      error_code: acpReadiness.claude_acp_readiness_error_code,
      message: acpReadiness.claude_acp_readiness_error,
      ...acpReadiness,
    });
  }
  return passResult(diagnostic, {
    auth_state: authStatus?.state || "unknown",
    auth_supported: authStatus?.supported === true,
    auth_command_available: authStatus?.commandAvailable !== false,
    auth_required_preserved: authStatus?.state === "required",
    auth_status_error: authStatusError
      ? redactProviderStartupText(authStatusError.message || String(authStatusError), 800)
      : null,
    ...acpReadiness,
  });
}

export async function preflightProviderStartup(options = {}) {
  const {
    provider,
    agentId,
    cwd,
    config = {},
    providerAuthManager,
    attemptId,
    sessionIdCandidate = null,
    env = process.env,
    spawnFn = spawn,
  } = options;
  const normalizedProvider = normalizeString(provider);
  const providerInfo = requireProvider(normalizedProvider, { config });
  if (providerInfo.commandRequired === false) {
    return passResult(
      buildBaseDiagnostic({
        attemptId,
        provider: normalizedProvider,
        agentId,
        cwd,
        sessionIdCandidate,
        phase: "provider_command_not_required",
        env,
      })
    );
  }
  const configuredCommand = configuredCommandForProvider(config, normalizedProvider);
  const commandResolution = resolveCommand(configuredCommand);
  logProviderStartupEvent({
    event: "preflight_start",
    ...buildBaseDiagnostic({
      attemptId,
      provider: normalizedProvider,
      agentId,
      cwd,
      sessionIdCandidate,
      configuredCommand: commandResolution.configured_command,
      resolvedCommand: commandResolution.resolved_command,
      phase: "command_resolution",
      success: null,
      env,
    }),
  });
  if (!commandResolution.available) {
    return failResult(
      buildBaseDiagnostic({
        attemptId,
        provider: normalizedProvider,
        agentId,
        cwd,
        sessionIdCandidate,
        configuredCommand: commandResolution.configured_command,
        resolvedCommand: commandResolution.resolved_command,
        phase: "command_resolution",
        success: false,
        errorCode: commandResolution.error_code,
        message: commandResolution.message,
        env,
      })
    );
  }
  if (normalizedProvider === "codex") {
    return runCodexInitializePreflight({
      attemptId,
      provider: normalizedProvider,
      agentId,
      cwd,
      sessionIdCandidate,
      configuredCommand: commandResolution.configured_command,
      resolvedCommand: commandResolution.resolved_command,
      env,
      spawnFn,
    });
  }
  if (normalizedProvider === "claude") {
    return runClaudeCommandAuthPreflight({
      attemptId,
      provider: normalizedProvider,
      agentId,
      cwd,
      sessionIdCandidate,
      configuredCommand: commandResolution.configured_command,
      resolvedCommand: commandResolution.resolved_command,
      config,
      providerAuthManager,
      env,
    });
  }
  return passResult(
    buildBaseDiagnostic({
      attemptId,
      provider: normalizedProvider,
      agentId,
      cwd,
      sessionIdCandidate,
      configuredCommand: commandResolution.configured_command,
      resolvedCommand: commandResolution.resolved_command,
      phase: "provider_command_resolution",
      env,
    })
  );
}

export function buildProviderStartupLifecycleEvent({ session, event }) {
  const type = event?.type;
  if (!session || !type) return null;
  const readyAt = session.providerStartupReadyAt || null;
  const now = Date.now();
  let providerStartupEvent = null;
  if (type === "session.ready") {
    providerStartupEvent = "session_ready";
    session.providerStartupReadyAt = now;
  } else if (type === "runtime.error" && !readyAt) {
    providerStartupEvent = "runtime_error_before_ready";
  } else if (type === "session.exit" && !readyAt) {
    providerStartupEvent = "early_exit_before_ready";
  } else if (
    type === "session.exit" &&
    readyAt &&
    now - readyAt <= EARLY_EXIT_AFTER_READY_GRACE_MS
  ) {
    providerStartupEvent = "early_exit_after_ready_grace";
  }
  if (!providerStartupEvent) return null;
  return {
    event: providerStartupEvent,
    ...buildBaseDiagnostic({
      attemptId: session.providerStartupAttemptId || null,
      provider: event.provider || session.provider || session.adapterId || null,
      agentId: session.agentId || null,
      cwd: session.cwd || null,
      sessionIdCandidate: session.id || null,
      configuredCommand: session.providerStartupConfiguredCommand || null,
      resolvedCommand: session.providerStartupResolvedCommand || null,
      phase: type,
      success:
        type === "session.ready"
          ? true
          : type === "runtime.error" || type === "session.exit"
          ? false
          : null,
      errorCode:
        event.error?.code ||
        event.error_code ||
        event.exit_reason ||
        event.subtype ||
        null,
      message:
        event.display_text ||
        event.error?.message ||
        event.error ||
        event.message ||
        null,
      stderrTail: event.text || event.stderr || event.stderr_tail || "",
      exitCode: event.code ?? event.exit_code ?? null,
      signal: event.signal || null,
      historyWritten: Boolean(session.historyRecordId),
      ready: type === "session.ready" || Boolean(session.providerStartupReadyAt),
    }),
  };
}
