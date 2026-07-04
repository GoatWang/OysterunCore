import { spawn } from "child_process";
import {
  readConfig,
  toProviderNativeReasoningEffort,
} from "./config.mjs";
import {
  createProviderUnavailableError,
  getConfiguredProviderCommand,
  isConfiguredCommandAvailable,
} from "./provider-registry.mjs";

const DEFAULT_SCHEDULER_DIRECT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
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

function tomlString(value) {
  return JSON.stringify(String(value));
}

function collectAllowedDirs(runtime, cwd) {
  const root = normalizeString(cwd);
  const entries = Array.isArray(runtime?.workspacePolicy?.allowedPaths)
    ? runtime.workspacePolicy.allowedPaths
    : [];
  const seen = new Set();
  const dirs = [];
  for (const entry of entries) {
    const candidate = normalizeString(entry?.path || entry);
    if (!candidate || candidate === root || seen.has(candidate)) continue;
    seen.add(candidate);
    dirs.push(candidate);
  }
  return dirs;
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

function normalizeChildEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(env)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey || value === null || value === undefined) continue;
    normalized[normalizedKey] = String(value);
  }
  return normalized;
}

function normalizeRedactionValues(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function redactText(value, redactionValues) {
  let redacted = String(value || "");
  for (const token of redactionValues) {
    redacted = redacted.split(token).join("[redacted]");
  }
  return redacted;
}

function buildSummary({ commandLabel, exitCode, signal, stdout, stderr }) {
  const status =
    exitCode === 0
      ? "completed"
      : signal
      ? `failed signal=${signal}`
      : `failed exit=${exitCode}`;
  const output = compactOutput(stdout) || compactOutput(stderr);
  const suffix = output ? `; ${output.slice(0, MAX_SUMMARY_CHARS)}` : "";
  return `${commandLabel} ${status}${suffix}`;
}

function resolveProviderCommand(provider) {
  const config = readConfig();
  const command = getConfiguredProviderCommand(config, provider) || provider;
  if (!isConfiguredCommandAvailable(command)) {
    throw createProviderUnavailableError(provider, { command });
  }
  return command;
}

function addCodexConfigArg(args, key, value) {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) return;
  if (typeof value === "boolean") {
    args.push("-c", `${normalizedKey}=${value ? "true" : "false"}`);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    args.push("-c", `${normalizedKey}=${String(value)}`);
    return;
  }
  const normalizedValue = normalizeString(value);
  if (normalizedValue) {
    args.push("-c", `${normalizedKey}=${tomlString(normalizedValue)}`);
  }
}

function buildCodexExecArgs({ runtime, prompt, cwd }) {
  const args = ["exec", "--ephemeral", "--cd", cwd, "--json"];
  const nativeArgs = Array.isArray(runtime?.native?.args)
    ? runtime.native.args
    : [];
  args.push(...nativeArgs);
  const model = normalizeString(runtime?.model);
  if (model) args.push("--model", model);
  const profile = normalizeString(runtime?.native?.profile);
  if (profile) args.push("--profile", profile);
  const sandboxMode = normalizeString(runtime?.sandboxMode);
  if (sandboxMode) args.push("--sandbox", sandboxMode);
  const approvalPolicy = normalizeString(runtime?.approvalPolicy);
  if (approvalPolicy) {
    addCodexConfigArg(args, "approval_policy", approvalPolicy);
  }
  const effort = toProviderNativeReasoningEffort(
    "codex",
    runtime?.reasoningEffort,
    runtime?.model
  );
  if (effort && runtime?.reasoningEffortSource !== "native") {
    addCodexConfigArg(args, "model_reasoning_effort", effort);
  }
  addCodexConfigArg(
    args,
    "web_search",
    runtime?.searchEnabled === true ? "live" : "disabled"
  );
  if (runtime?.imageInputEnabled !== undefined) {
    addCodexConfigArg(
      args,
      "tools.view_image",
      runtime.imageInputEnabled === true
    );
  }
  if (runtime?.native?.configOverrides) {
    for (const [key, value] of Object.entries(runtime.native.configOverrides)) {
      if (key === "model_reasoning_effort") continue;
      addCodexConfigArg(args, key, value);
    }
  }
  for (const dir of collectAllowedDirs(runtime, cwd)) {
    args.push("--add-dir", dir);
  }
  args.push(prompt);
  return args;
}

function buildProviderCommand({ provider, runtime, prompt, cwd }) {
  if (provider === "claude") {
    throw new Error(
      "Scheduler direct Claude print-mode runtime was removed; start Claude through the ACP session runtime."
    );
  }
  if (provider === "codex") {
    return {
      command: resolveProviderCommand(provider),
      args: buildCodexExecArgs({ runtime, prompt, cwd }),
      commandLabel: "codex exec",
    };
  }
  throw new Error(`Unsupported Scheduler direct provider: ${provider}`);
}

export function buildSchedulerDirectProviderCommandForTest(input) {
  return buildProviderCommand(input);
}

export async function runSchedulerDirectProviderCommand({
  runtime,
  cwd,
  prompt,
  messageId,
  env = {},
  redactionValues = [],
  spawnFn = spawn,
  timeoutMs = DEFAULT_SCHEDULER_DIRECT_RUN_TIMEOUT_MS,
} = {}) {
  const provider = requireString(runtime?.provider, "provider");
  const resolvedCwd = requireString(cwd, "cwd");
  const inputText = requireString(prompt, "prompt");
  const { command, args, commandLabel } = buildProviderCommand({
    provider,
    runtime,
    prompt: inputText,
    cwd: resolvedCwd,
  });
  const childEnv = { ...process.env, ...normalizeChildEnv(env) };
  const redactionTokens = normalizeRedactionValues(redactionValues);
  const startedAt = new Date().toISOString();
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timeout = null;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const safeStdout = redactText(stdout, redactionTokens);
      const safeStderr = redactText(stderr, redactionTokens);
      resolve({
        ...result,
        provider,
        command_label: commandLabel,
        host_dispatch_path: `schedulerDirectProviderRunner.${commandLabel}`,
        message_id: normalizeString(messageId) || null,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        stdout: safeStdout,
        stderr: safeStderr,
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
        redacted_sensitive_env: redactionTokens.length > 0,
        log_summary: buildSummary({
          commandLabel,
          exitCode: result.exit_code,
          signal: result.signal,
          stdout: safeStdout,
          stderr: safeStderr,
        }),
      });
    };
    try {
      child = spawnFn(command, args, {
        cwd: resolvedCwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
    } catch (err) {
      reject(err);
      return;
    }
    if (!child || typeof child.on !== "function") {
      reject(
        new Error("Scheduler direct provider spawn did not return a process")
      );
      return;
    }
    child.stdout?.on?.("data", (chunk) => {
      const result = appendLimited(stdout, chunk.toString());
      stdout = result.value;
      stdoutTruncated = stdoutTruncated || result.truncated;
    });
    child.stderr?.on?.("data", (chunk) => {
      const result = appendLimited(stderr, chunk.toString());
      stderr = result.value;
      stderrTruncated = stderrTruncated || result.truncated;
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code, signal) => {
      finish({
        ok: code === 0,
        exit_code: typeof code === "number" ? code : null,
        signal: signal || null,
      });
    });
    child.on("exit", (code, signal) => {
      finish({
        ok: code === 0,
        exit_code: typeof code === "number" ? code : null,
        signal: signal || null,
      });
    });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        child.kill?.("SIGTERM");
        finish({
          ok: false,
          exit_code: null,
          signal: "timeout",
        });
      }, timeoutMs);
      timeout.unref?.();
    }
  });
}
