import { spawn } from "child_process";
import { execFileSync } from "child_process";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { basename } from "path";
import { readConfig } from "./config.mjs";
import { normalizeProviderModelCatalog } from "./provider-model-params.mjs";

export class CodexModelDiscoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CodexModelDiscoveryError";
    this.code = code;
    this.details = details;
  }
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveCommandWithWhich(command, options = {}) {
  const existsSyncFn = options.existsSyncFn || existsSync;
  const execFileSyncFn = options.execFileSyncFn || execFileSync;
  if (!command) {
    throw new CodexModelDiscoveryError(
      "codex_command_unavailable",
      "Codex command is not configured"
    );
  }
  if (command.includes("/")) {
    if (!existsSyncFn(command)) {
      throw new CodexModelDiscoveryError(
        "codex_command_unavailable",
        "Configured Codex command path does not exist"
      );
    }
    return command;
  }
  try {
    const resolved = execFileSyncFn("which", [command], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (resolved) return resolved;
  } catch {
    // Converted below into a fail-closed discovery error.
  }
  throw new CodexModelDiscoveryError(
    "codex_command_unavailable",
    `Configured Codex command could not be resolved: ${command}`
  );
}

export function resolveCodexDiscoveryCommand(options = {}) {
  const config = options.config || readConfig();
  const command =
    normalizeString(options.command) || normalizeString(config.codex_command);
  return {
    configured_command_present: Boolean(command),
    resolved_command: resolveCommandWithWhich(command, options),
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new CodexModelDiscoveryError(
            "codex_discovery_timeout",
            `${label} timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);
}

class JsonRpcLineClient extends EventEmitter {
  constructor(proc) {
    super();
    this.proc = proc;
    this.stdoutBuffer = "";
    this.nextId = 1;
    this.pending = new Map();
    proc.stdout.on("data", (chunk) => this.consumeStdout(String(chunk)));
    proc.stderr.on("data", (chunk) => {
      this.emit("stderr", String(chunk));
    });
    proc.on("exit", (code, signal) => {
      const error = new CodexModelDiscoveryError(
        "codex_app_server_exit",
        `Codex app-server exited during discovery (code=${code}, signal=${signal || "none"})`
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
    proc.on("error", (err) => {
      const error = new CodexModelDiscoveryError(
        "codex_app_server_error",
        err.message
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
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
        this.failPending(
          new CodexModelDiscoveryError(
            "codex_app_server_malformed_json",
            `Malformed Codex app-server JSON: ${err.message}`
          )
        );
        continue;
      }
      this.handleMessage(message);
    }
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  handleMessage(message) {
    if (
      message?.id !== undefined &&
      (Object.prototype.hasOwnProperty.call(message, "result") ||
        Object.prototype.hasOwnProperty.call(message, "error"))
    ) {
      const id = String(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error) {
        pending.reject(
          new CodexModelDiscoveryError(
            "codex_app_server_rpc_error",
            message.error.message || JSON.stringify(message.error)
          )
        );
        return;
      }
      pending.resolve(message.result);
    }
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
      throw new CodexModelDiscoveryError(
        "codex_app_server_stdin_unavailable",
        "Codex app-server stdin is not writable"
      );
    }
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  close() {
    if (typeof this.proc.kill === "function") {
      this.proc.kill("SIGTERM");
    }
  }
}

function extractModelEntries(result) {
  const models = result?.models || result?.items || result?.data;
  if (!Array.isArray(models)) {
    throw new CodexModelDiscoveryError(
      "codex_model_list_malformed",
      "Codex model/list response did not include a models array"
    );
  }
  const nextCursor =
    normalizeString(result.next_cursor) ||
    normalizeString(result.nextCursor) ||
    normalizeString(result.next_page_token) ||
    normalizeString(result.nextPageToken) ||
    normalizeString(result.pagination?.next_cursor) ||
    null;
  return { models, nextCursor };
}

function normalizeCodexDiscoveryModel(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new CodexModelDiscoveryError(
      "codex_model_list_malformed",
      "Codex model/list returned an invalid model entry"
    );
  }
  return {
    id: entry.id || entry.name || entry.model || entry.slug,
    label: entry.label || entry.display_name || entry.name || entry.id,
    hidden: entry.hidden === true || entry.deprecated === true,
    isDefault: entry.isDefault === true || entry.is_default === true,
    defaultReasoningEffort:
      entry.defaultReasoningEffort ||
      entry.default_reasoning_effort ||
      entry.reasoning_effort ||
      entry.reasoningEffort,
    reasoningEffortOptions:
      entry.reasoningEffortOptions ||
      entry.reasoning_effort_options ||
      entry.supportedReasoningEfforts ||
      entry.supported_reasoning_efforts ||
      entry.reasoning_efforts,
  };
}

function redactCommand(command) {
  return normalizeString(command) ? basename(command) : null;
}

export async function discoverCodexProviderModels(options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs)
    ? options.timeoutMs
    : 5000;
  const maxPages = Number.isInteger(options.maxPages) ? options.maxPages : 20;
  const spawnFn = options.spawnFn || spawn;
  const commandResolution = resolveCodexDiscoveryCommand(options);
  const proc = spawnFn(commandResolution.resolved_command, [
    "app-server",
    "--listen",
    "stdio://",
  ], {
    cwd: options.cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(options.env || {}) },
  });
  const client = new JsonRpcLineClient(proc);
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
    const capabilities = await withTimeout(
      client.request("modelProvider/capabilities/read", {}),
      timeoutMs,
      "Codex model provider capabilities"
    );

    const rawModels = [];
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await withTimeout(
        client.request("model/list", cursor ? { cursor } : {}),
        timeoutMs,
        "Codex model list"
      );
      const extracted = extractModelEntries(result);
      rawModels.push(...extracted.models);
      cursor = extracted.nextCursor;
      if (!cursor) {
        const models = normalizeProviderModelCatalog(
          "codex",
          rawModels.map(normalizeCodexDiscoveryModel)
        );
        return {
          provider: "codex",
          command_available: true,
          resolved_command_redacted: redactCommand(
            commandResolution.resolved_command
          ),
          app_server_discovery_supported: true,
          capabilities,
          models,
        };
      }
    }
    throw new CodexModelDiscoveryError(
      "codex_model_list_pagination_limit",
      `Codex model/list exceeded ${maxPages} pages`
    );
  } finally {
    client.close();
  }
}
