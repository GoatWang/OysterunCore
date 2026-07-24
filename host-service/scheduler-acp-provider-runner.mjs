import { randomUUID } from "crypto";
import { ClaudeCodeAdapter } from "./adapters/claude-code-adapter.mjs";
import { readConfig } from "./config.mjs";
import { getConfiguredProviderCommand } from "./provider-registry.mjs";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_GRACEFUL_EXIT_MS = 5_000;
const DEFAULT_FORCED_EXIT_MS = 2_000;
const MAX_CAPTURE_CHARS = 24_000;
const MAX_SUMMARY_CHARS = 700;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireString(value, fieldName) {
  const normalized = normalizeString(value);
  if (!normalized) throw new Error(`${fieldName} required`);
  return normalized;
}

function normalizeEnv(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey || rawValue === null || rawValue === undefined) continue;
    env[normalizedKey] = String(rawValue);
  }
  return env;
}

function normalizeRedactionValues(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function redactText(value, tokens) {
  let redacted = String(value || "");
  for (const token of tokens) {
    redacted = redacted.split(token).join("[redacted]");
  }
  return redacted;
}

function appendLimited(existing, chunk) {
  const next = `${existing}${chunk}`;
  if (next.length <= MAX_CAPTURE_CHARS) {
    return { value: next, truncated: false };
  }
  return {
    value: next.slice(next.length - MAX_CAPTURE_CHARS),
    truncated: true,
  };
}

function compactOutput(value) {
  return normalizeString(String(value || "").replace(/\s+/g, " "));
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function outputLineForEvent(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "message.assistant" && event.delta !== true) {
    return normalizeString(event.text) ? `${event.text}\n` : "";
  }
  if (event.type === "tool.call") {
    return `[tool.call] ${event.tool_name || event.name || "tool"} ${safeJson(
      event.tool_input ?? event.input ?? null
    )}\n`;
  }
  if (event.type === "tool.update") {
    return `[tool.update] ${event.tool_name || event.name || "tool"} ${safeJson(
      event.tool_content ?? event.content ?? event.tool_input ?? event.input ?? null
    )}\n`;
  }
  if (event.type === "tool.result" || event.type === "tool.failure") {
    return `[${event.type}] ${event.tool_name || event.name || "tool"} ${safeJson(
      event.tool_content ?? event.content ?? event.output ?? null
    )}\n`;
  }
  return "";
}

function errorTextFromEvent(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "runtime.stderr") {
    return String(event.text || "");
  }
  if (event.type === "runtime.error") {
    return `${
      event.error?.message || event.error || "Claude ACP runtime error"
    }\n`;
  }
  return "";
}

function buildSummary({ ok, terminalReason, stdout, stderr }) {
  const status = ok ? "completed" : `failed (${terminalReason})`;
  const output = compactOutput(stdout) || compactOutput(stderr);
  return `claude acp transient ${status}${
    output ? `; ${output.slice(0, MAX_SUMMARY_CHARS)}` : ""
  }`;
}

function waitForExit(session, timeoutMs) {
  if (!session?.alive) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.off?.("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!session.alive), timeoutMs);
    session.on?.("exit", onExit);
  });
}

async function disposeTransientSession({
  adapter,
  session,
  cancelPrompt,
  gracefulExitMs,
  forcedExitMs,
}) {
  if (!session) return { exited: true, force_killed: false };
  if (cancelPrompt && session.alive) {
    try {
      adapter.interruptSession?.(session);
    } catch {
      // Cleanup continues through process termination.
    }
  }
  try {
    adapter.stopSession?.(session);
  } catch {
    // Escalate to the force-kill path below.
  }
  if (await waitForExit(session, gracefulExitMs)) {
    return { exited: true, force_killed: false };
  }
  try {
    adapter.killSession?.(session);
  } catch {
    // The final exit proof below determines the cleanup result.
  }
  const exited = await waitForExit(session, forcedExitMs);
  return { exited, force_killed: true };
}

function createDefaultAdapter() {
  return new ClaudeCodeAdapter({
    getConfiguredCommand: () =>
      getConfiguredProviderCommand(readConfig(), "claude"),
  });
}

export async function runSchedulerAcpProviderCommand({
  runtime,
  cwd,
  prompt,
  messageId,
  env = {},
  redactionValues = [],
  signal = null,
  adapterFactory = createDefaultAdapter,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  gracefulExitMs = DEFAULT_GRACEFUL_EXIT_MS,
  forcedExitMs = DEFAULT_FORCED_EXIT_MS,
  clock = () => new Date(),
} = {}) {
  const provider = requireString(runtime?.provider, "provider");
  if (provider !== "claude") {
    throw new Error("Scheduler transient ACP runner requires provider=claude");
  }
  const resolvedCwd = requireString(cwd, "cwd");
  const inputText = requireString(prompt, "prompt");
  const runtimeEnv = normalizeEnv(env);
  const redactionTokens = normalizeRedactionValues(redactionValues);
  const startedAt = clock().toISOString();
  const adapter = adapterFactory();
  let session = null;
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let promptSent = false;
  let lifecycleState = "starting";

  return await new Promise((resolve) => {
    let terminalStarted = false;
    let timeout = null;

    const appendStdout = (chunk) => {
      const appended = appendLimited(stdout, chunk);
      stdout = appended.value;
      stdoutTruncated = stdoutTruncated || appended.truncated;
    };
    const appendStderr = (chunk) => {
      const appended = appendLimited(stderr, chunk);
      stderr = appended.value;
      stderrTruncated = stderrTruncated || appended.truncated;
    };

    const finish = async ({
      ok,
      terminalReason,
      signalName = null,
      exitCode = ok ? 0 : 1,
      errorSummary = null,
    }) => {
      if (terminalStarted) return;
      terminalStarted = true;
      lifecycleState = "stopping";
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener?.("abort", onAbort);
      session?.off?.("event", onEvent);
      const cleanup = await disposeTransientSession({
        adapter,
        session,
        cancelPrompt: !ok,
        gracefulExitMs,
        forcedExitMs,
      });
      if (!cleanup.exited) {
        ok = false;
        terminalReason = "scheduler_provider_cleanup_failed";
        exitCode = 1;
        errorSummary = terminalReason;
        appendStderr("Claude ACP child did not exit after SIGKILL\n");
      }
      lifecycleState = ok ? "succeeded" : terminalReason;
      const safeStdout = redactText(stdout, redactionTokens);
      const safeStderr = redactText(stderr, redactionTokens);
      resolve({
        ok,
        provider,
        command_label: "claude acp transient",
        host_dispatch_path: "schedulerAcpProviderRunner.transient",
        message_id: normalizeString(messageId) || null,
        started_at: startedAt,
        completed_at: clock().toISOString(),
        exit_code: exitCode,
        signal: signalName,
        stdout: safeStdout,
        stderr: safeStderr,
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
        redacted_sensitive_env: redactionTokens.length > 0,
        lifecycle_state: lifecycleState,
        provider_process_exited: cleanup.exited,
        provider_force_killed: cleanup.force_killed,
        error_summary: ok ? null : errorSummary || terminalReason,
        log_summary: buildSummary({
          ok,
          terminalReason,
          stdout: safeStdout,
          stderr: safeStderr,
        }),
      });
    };

    const onAbort = () => {
      void finish({
        ok: false,
        terminalReason: "cancelled",
        signalName: "cancelled",
        exitCode: null,
        errorSummary: "scheduler_provider_run_cancelled",
      });
    };

    const onEvent = (event) => {
      if (terminalStarted || !event || typeof event !== "object") return;
      const output = outputLineForEvent(event);
      if (output) appendStdout(output);
      const errorOutput = errorTextFromEvent(event);
      if (errorOutput) appendStderr(errorOutput);

      if (event.type === "session.ready") {
        if (promptSent) {
          void finish({
            ok: false,
            terminalReason: "scheduler_provider_duplicate_ready",
          });
          return;
        }
        lifecycleState = "ready";
        promptSent = true;
        lifecycleState = "prompt_in_flight";
        try {
          adapter.sendMessage(session, inputText);
        } catch (error) {
          appendStderr(`${error?.message || String(error)}\n`);
          void finish({
            ok: false,
            terminalReason: "scheduler_provider_prompt_dispatch_failed",
          });
        }
        return;
      }
      if (event.type === "control.request") {
        try {
          adapter.respondToControl?.(session, {
            request_id: event.request_id,
            outcome: { outcome: "cancelled" },
          });
        } catch {
          // The runner still cancels and terminates the non-interactive run.
        }
        void finish({
          ok: false,
          terminalReason: "scheduler_provider_interaction_required",
          errorSummary: "scheduler_provider_interaction_required",
        });
        return;
      }
      if (event.type === "runtime.error") {
        void finish({
          ok: false,
          terminalReason: "scheduler_provider_runtime_error",
          errorSummary:
            event.error?.message ||
            event.error ||
            "scheduler_provider_runtime_error",
        });
        return;
      }
      if (event.type === "session.exit") {
        void finish({
          ok: false,
          terminalReason: "scheduler_provider_early_exit",
          signalName: event.signal || null,
          exitCode: Number.isInteger(event.code) ? event.code : 1,
          errorSummary:
            event.exit_diagnostic?.summary || "scheduler_provider_early_exit",
        });
        return;
      }
      if (event.type === "turn.completed") {
        const status = normalizeString(event.status).toLowerCase();
        const ok = ["completed", "complete", "success", "succeeded"].includes(
          status
        );
        void finish({
          ok,
          terminalReason: ok
            ? "succeeded"
            : status === "interrupted"
            ? "cancelled"
            : "scheduler_provider_prompt_failed",
          signalName: status === "interrupted" ? "cancelled" : null,
          exitCode: ok ? 0 : 1,
          errorSummary: ok
            ? null
            : event.error?.message ||
              event.error ||
              event.stop_reason ||
              "scheduler_provider_prompt_failed",
        });
      }
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        void finish({
          ok: false,
          terminalReason: "timed_out",
          signalName: "timeout",
          exitCode: null,
          errorSummary: "scheduler_provider_run_timed_out",
        });
      }, timeoutMs);
    }

    try {
      session = adapter.startSession({
        sessionId: `scheduler-${normalizeString(messageId) || randomUUID()}`,
        cwd: resolvedCwd,
        agentId: "oysterun-scheduler",
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        reasoningEffortSource: runtime.reasoningEffortSource,
        permissionMode: runtime.permissionMode,
        approvalPolicy: runtime.approvalPolicy,
        sandboxMode: runtime.sandboxMode,
        dangerousMode: runtime.dangerousMode,
        allowDangerouslySkipPermissions:
          runtime.allowDangerouslySkipPermissions,
        searchEnabled: runtime.searchEnabled,
        imageInputEnabled: runtime.imageInputEnabled,
        native: runtime.native,
        workspacePolicy: runtime.workspacePolicy,
        runtimeEnv,
      });
      session.on("event", onEvent);
      if (session.lastRuntimeError) {
        appendStderr(
          `${session.lastRuntimeError.error?.message || "Claude ACP startup failed"}\n`
        );
        void finish({
          ok: false,
          terminalReason: "scheduler_provider_startup_failed",
          errorSummary:
            session.lastRuntimeError.error?.message ||
            "scheduler_provider_startup_failed",
        });
        return;
      }
      if (session.ready === true) {
        onEvent({ type: "session.ready" });
      }
    } catch (error) {
      appendStderr(`${error?.message || String(error)}\n`);
      void finish({
        ok: false,
        terminalReason: "scheduler_provider_startup_failed",
        errorSummary: error?.message || "scheduler_provider_startup_failed",
      });
    }
  });
}

export class SchedulerAcpProviderRunner {
  constructor({ runCommand = runSchedulerAcpProviderCommand } = {}) {
    this.runCommand = runCommand;
    this.activeRuns = new Set();
  }

  async run(options = {}) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener?.("abort", abortFromExternal, {
      once: true,
    });
    const entry = { controller, promise: null };
    const promise = Promise.resolve(
      this.runCommand({ ...options, signal: controller.signal })
    );
    entry.promise = promise;
    this.activeRuns.add(entry);
    try {
      return await promise;
    } finally {
      externalSignal?.removeEventListener?.("abort", abortFromExternal);
      this.activeRuns.delete(entry);
    }
  }

  async stopAll() {
    const active = [...this.activeRuns];
    for (const entry of active) entry.controller.abort();
    await Promise.allSettled(active.map((entry) => entry.promise));
  }

  getActiveRunCount() {
    return this.activeRuns.size;
  }
}
