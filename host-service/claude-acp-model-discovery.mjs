import { spawn } from "child_process";
import { execFileSync } from "child_process";
import { EventEmitter } from "events";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readConfig } from "./config.mjs";
import { normalizeProviderModelCatalog } from "./provider-model-params.mjs";

export const CLAUDE_ACP_RUNNER_PACKAGE =
  "@agentclientprotocol/claude-agent-acp";
export const CLAUDE_ACP_RUNNER_VERSION = "0.44.0";
export const CLAUDE_ACP_RUNNER_BIN = "claude-agent-acp";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_MS = 5000;

export class ClaudeAcpModelDiscoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ClaudeAcpModelDiscoveryError";
    this.code = code;
    this.details = details;
  }
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nodeModulePackagePath(packageName) {
  return join(...packageName.split("/"));
}

function readJsonFile(path, options = {}) {
  const readFileSyncFn = options.readFileSyncFn || readFileSync;
  try {
    return JSON.parse(readFileSyncFn(path, "utf-8"));
  } catch (err) {
    const reason = normalizeString(err?.code) || normalizeString(err?.name) || "read_error";
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_package_metadata_unreadable",
      `Claude ACP package metadata is unreadable (${reason})`
    );
  }
}

export function readManagedClaudeAcpDependencyState(options = {}) {
  const hostServiceDir = options.hostServiceDir || MODULE_DIR;
  const packageJsonPath =
    options.packageJsonPath || join(hostServiceDir, "package.json");
  const packageLockPath =
    options.packageLockPath || join(hostServiceDir, "package-lock.json");
  const packageJson = readJsonFile(packageJsonPath, options);
  const packageLock = readJsonFile(packageLockPath, options);
  const dependencyVersion =
    normalizeString(packageJson.dependencies?.[CLAUDE_ACP_RUNNER_PACKAGE]) ||
    null;
  const lockBlock =
    packageLock.packages?.[`node_modules/${CLAUDE_ACP_RUNNER_PACKAGE}`] || null;
  const lockVersion = normalizeString(lockBlock?.version);
  const lockBin = lockBlock?.bin?.[CLAUDE_ACP_RUNNER_BIN] || null;
  return {
    package_name: CLAUDE_ACP_RUNNER_PACKAGE,
    expected_version: CLAUDE_ACP_RUNNER_VERSION,
    dependency_version: dependencyVersion,
    lock_version: lockVersion,
    lock_bin_present: typeof lockBin === "string" && lockBin.trim().length > 0,
    pinned:
      dependencyVersion === CLAUDE_ACP_RUNNER_VERSION &&
      lockVersion === CLAUDE_ACP_RUNNER_VERSION,
  };
}

function readManagedClaudeAcpPackageDependencyState(options = {}) {
  const hostServiceDir = options.hostServiceDir || MODULE_DIR;
  const packageJsonPath =
    options.packageJsonPath || join(hostServiceDir, "package.json");
  const packageJson = readJsonFile(packageJsonPath, options);
  const dependencyVersion =
    normalizeString(packageJson.dependencies?.[CLAUDE_ACP_RUNNER_PACKAGE]) ||
    null;
  return {
    package_name: CLAUDE_ACP_RUNNER_PACKAGE,
    expected_version: CLAUDE_ACP_RUNNER_VERSION,
    dependency_version: dependencyVersion,
    lock_version: null,
    lock_bin_present: null,
    pinned: dependencyVersion === CLAUDE_ACP_RUNNER_VERSION,
  };
}

function assertManagedClaudeAcpDependencyPinned(options = {}) {
  const state = readManagedClaudeAcpDependencyState(options);
  if (state.dependency_version !== CLAUDE_ACP_RUNNER_VERSION) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_dependency_unpinned",
      `Managed Claude ACP runner dependency must be pinned to ${CLAUDE_ACP_RUNNER_VERSION}`,
      state
    );
  }
  if (state.lock_version !== CLAUDE_ACP_RUNNER_VERSION) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_lock_unpinned",
      `Managed Claude ACP runner lock entry must be pinned to ${CLAUDE_ACP_RUNNER_VERSION}`,
      state
    );
  }
  if (state.lock_bin_present !== true) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_lock_bin_missing",
      "Managed Claude ACP runner lock entry does not expose a claude-agent-acp bin",
      state
    );
  }
  return state;
}

function assertManagedClaudeAcpPackageDependencyPinned(options = {}) {
  const state = readManagedClaudeAcpPackageDependencyState(options);
  if (state.dependency_version !== CLAUDE_ACP_RUNNER_VERSION) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_dependency_unpinned",
      `Managed Claude ACP runner dependency must be pinned to ${CLAUDE_ACP_RUNNER_VERSION}`,
      state
    );
  }
  return state;
}

function resolvePackagedClaudeAcpRunner({
  hostServiceDir,
  binName,
  existsSyncFn,
  readFileSyncFn,
}) {
  const packageRootDir = dirname(hostServiceDir);
  const packageDir = join(
    packageRootDir,
    "node_modules",
    nodeModulePackagePath(CLAUDE_ACP_RUNNER_PACKAGE)
  );
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSyncFn(packageJsonPath)) return null;
  const packageJson = JSON.parse(readFileSyncFn(packageJsonPath, "utf-8"));
  if (
    packageJson.name !== CLAUDE_ACP_RUNNER_PACKAGE ||
    packageJson.version !== CLAUDE_ACP_RUNNER_VERSION
  ) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_packaged_runner_unpinned",
      "Packaged Claude ACP runner dependency does not match the pinned version",
      {
        package_json_path: packageJsonPath,
        package_name: packageJson.name || null,
        package_version: packageJson.version || null,
      }
    );
  }
  const declaredBin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.[CLAUDE_ACP_RUNNER_BIN];
  const runnerPath = declaredBin ? join(packageDir, declaredBin) : null;
  if (!runnerPath || !existsSyncFn(runnerPath)) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_packaged_runner_bin_missing",
      "Packaged Claude ACP runner declared bin target is missing",
      {
        package_json_path: packageJsonPath,
        declared_bin: declaredBin || null,
        runner_path: runnerPath,
      }
    );
  }
  return {
    runner_path: runnerPath,
    runner_source: "packaged_root_dependency",
    package_json_path: packageJsonPath,
    package_root_dir: packageRootDir,
  };
}

export function resolveManagedClaudeAcpRunner(options = {}) {
  const existsSyncFn = options.existsSyncFn || existsSync;
  const readFileSyncFn = options.readFileSyncFn || readFileSync;
  const hostServiceDir = options.hostServiceDir || MODULE_DIR;
  const binName =
    options.platform === "win32" || process.platform === "win32"
      ? `${CLAUDE_ACP_RUNNER_BIN}.cmd`
      : CLAUDE_ACP_RUNNER_BIN;
  const explicitRunnerPath = normalizeString(options.runnerPath);
  const hostServiceBinPath = join(hostServiceDir, "node_modules", ".bin", binName);
  const packageLockPath =
    options.packageLockPath || join(hostServiceDir, "package-lock.json");
  const hostLockAvailable = existsSyncFn(packageLockPath);
  let dependencyState = null;
  if (explicitRunnerPath) {
    dependencyState = assertManagedClaudeAcpDependencyPinned({
      ...options,
      hostServiceDir,
    });
    if (!existsSyncFn(explicitRunnerPath)) {
      throw new ClaudeAcpModelDiscoveryError(
        "claude_acp_runner_unavailable",
        "Configured managed Claude ACP runner path does not exist",
        {
          ...dependencyState,
          runner_available: false,
          runner_source: "explicit_runner_path",
          runner_path: explicitRunnerPath,
        }
      );
    }
    return {
      runner_path: explicitRunnerPath,
      runner_source: "explicit_runner_path",
      package_name: CLAUDE_ACP_RUNNER_PACKAGE,
      package_version: CLAUDE_ACP_RUNNER_VERSION,
      dependency_state: dependencyState,
    };
  }
  if (existsSyncFn(hostServiceBinPath)) {
    dependencyState = assertManagedClaudeAcpDependencyPinned({
      ...options,
      hostServiceDir,
    });
    return {
      runner_path: hostServiceBinPath,
      runner_source: "managed_host_dependency",
      package_name: CLAUDE_ACP_RUNNER_PACKAGE,
      package_version: CLAUDE_ACP_RUNNER_VERSION,
      dependency_state: dependencyState,
    };
  }
  if (hostLockAvailable) {
    dependencyState = assertManagedClaudeAcpDependencyPinned({
      ...options,
      hostServiceDir,
    });
  }
  const packagedRunner = resolvePackagedClaudeAcpRunner({
    hostServiceDir,
    binName,
    existsSyncFn,
    readFileSyncFn,
  });
  if (packagedRunner && !dependencyState) {
    dependencyState = assertManagedClaudeAcpPackageDependencyPinned({
      ...options,
      hostServiceDir,
    });
  }
  if (!packagedRunner) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_runner_unavailable",
      "Managed Claude ACP runner is not materialized in host-service/node_modules or package-root node_modules",
      {
        ...(dependencyState ||
          assertManagedClaudeAcpPackageDependencyPinned({
            ...options,
            hostServiceDir,
          })),
        runner_available: false,
        runner_sources_checked: [
          "managed_host_dependency",
          "packaged_root_dependency",
        ],
        host_service_runner_path: hostServiceBinPath,
        packaged_package_json_path: join(
          dirname(hostServiceDir),
          "node_modules",
          nodeModulePackagePath(CLAUDE_ACP_RUNNER_PACKAGE),
          "package.json"
        ),
      }
    );
  }
  return {
    ...packagedRunner,
    package_name: CLAUDE_ACP_RUNNER_PACKAGE,
    package_version: CLAUDE_ACP_RUNNER_VERSION,
    dependency_state: dependencyState,
  };
}

function resolveCommandWithWhich(command, options = {}) {
  const existsSyncFn = options.existsSyncFn || existsSync;
  const execFileSyncFn = options.execFileSyncFn || execFileSync;
  if (!command) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_cli_auth_command_unavailable",
      "Claude CLI command is not configured for auth compatibility"
    );
  }
  if (command.includes("/")) {
    if (!existsSyncFn(command)) {
      throw new ClaudeAcpModelDiscoveryError(
        "claude_cli_auth_command_unavailable",
        "Configured Claude CLI auth command path does not exist"
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
    // Converted below into a fail-visible discovery error.
  }
  throw new ClaudeAcpModelDiscoveryError(
    "claude_cli_auth_command_unavailable",
    `Configured Claude CLI auth command could not be resolved: ${command}`
  );
}

export function resolveClaudeCliAuthCommand(options = {}) {
  const config = options.config || readConfig();
  const command =
    normalizeString(options.claudeCommand) ||
    normalizeString(options.command) ||
    normalizeString(config.claude_command) ||
    "claude";
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
          new ClaudeAcpModelDiscoveryError(
            "claude_acp_discovery_timeout",
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
      const error = new ClaudeAcpModelDiscoveryError(
        "claude_acp_runner_exit",
        `Claude ACP runner exited during discovery (code=${code}, signal=${
          signal || "none"
        })`
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
    proc.on("error", (err) => {
      const error = new ClaudeAcpModelDiscoveryError(
        "claude_acp_runner_error",
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
          new ClaudeAcpModelDiscoveryError(
            "claude_acp_runner_malformed_json",
            `Malformed Claude ACP runner JSON: ${err.message}`
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
          new ClaudeAcpModelDiscoveryError(
            "claude_acp_runner_rpc_error",
            message.error.message || JSON.stringify(message.error),
            { rpc_code: message.error.code ?? null }
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
      throw new ClaudeAcpModelDiscoveryError(
        "claude_acp_runner_stdin_unavailable",
        "Claude ACP runner stdin is not writable"
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

function isModelConfigOption(option) {
  if (!option || typeof option !== "object" || Array.isArray(option)) {
    return false;
  }
  const haystack = [
    option.id,
    option.name,
    option.label,
    option.category,
    option.type,
    option.configId,
    option.config_id,
  ]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .join(" ");
  return /\bmodel\b/.test(haystack);
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

function normalizeClaudeModelOption(entry, currentValue = null) {
  if (typeof entry === "string") {
    return {
      id: entry,
      label: entry,
      isDefault: currentValue === entry,
    };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_config_options_malformed",
      "Claude ACP configOptions returned an invalid model option"
    );
  }
  const id =
    normalizeString(entry.id) ||
    normalizeString(entry.value) ||
    normalizeString(entry.name) ||
    normalizeString(entry.model) ||
    normalizeString(entry.label);
  if (!id) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_config_options_malformed",
      "Claude ACP model option did not include an id/value/name"
    );
  }
  return {
    id,
    label:
      normalizeString(entry.label) ||
      normalizeString(entry.name) ||
      normalizeString(entry.displayName) ||
      id,
    hidden: entry.hidden === true || entry.deprecated === true,
    isDefault:
      entry.isDefault === true ||
      entry.is_default === true ||
      currentValue === id,
  };
}

export function extractClaudeAcpModelConfig(configOptions = []) {
  if (!Array.isArray(configOptions)) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_config_options_malformed",
      "Claude ACP configOptions must be an array"
    );
  }
  const modelOption = configOptions.find(isModelConfigOption);
  if (!modelOption) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_model_config_missing",
      "Claude ACP did not expose a model config option"
    );
  }
  const values = configOptionValues(modelOption);
  if (values.length === 0) {
    throw new ClaudeAcpModelDiscoveryError(
      "claude_acp_model_config_empty",
      "Claude ACP model config option did not include selectable models"
    );
  }
  const currentValue =
    normalizeString(modelOption.currentValue) ||
    normalizeString(modelOption.current_value) ||
    null;
  return {
    model_config_id:
      normalizeString(modelOption.id) ||
      normalizeString(modelOption.configId) ||
      normalizeString(modelOption.config_id) ||
      "model",
    config_options_count: configOptions.length,
    models: normalizeProviderModelCatalog(
      "claude",
      values.map((entry) => normalizeClaudeModelOption(entry, currentValue))
    ),
  };
}

export async function discoverClaudeAcpProviderModels(options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs)
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const spawnFn = options.spawnFn || spawn;
  const config = options.config || readConfig();
  const runnerResolution =
    options.runnerResolution || resolveManagedClaudeAcpRunner(options);
  const claudeCliResolution =
    options.claudeCliResolution || resolveClaudeCliAuthCommand({ ...options, config });
  const proc = spawnFn(runnerResolution.runner_path, [], {
    cwd: options.cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.env || {}),
      OPENAB_AGENT_COMMAND: claudeCliResolution.resolved_command,
      CLAUDE_CODE_EXECUTABLE: claudeCliResolution.resolved_command,
    },
  });
  const client = new JsonRpcLineClient(proc);
  try {
    const initializeResult = await withTimeout(
      client.request("initialize", {
        protocolVersion: 1,
        clientInfo: {
          name: "oysterun",
          title: "Oysterun Host",
          version: "0.1.0",
        },
        capabilities: {},
      }),
      timeoutMs,
      "Claude ACP initialize"
    );
    client.notify("initialized", {});
    const sessionResult = await withTimeout(
      client.request("session/new", {
        cwd: options.workspaceCwd || options.cwd || process.cwd(),
        mcpServers: [],
      }),
      timeoutMs,
      "Claude ACP session/new"
    );
    const configOptions = [
      ...configOptionsFromResult(initializeResult),
      ...configOptionsFromResult(sessionResult),
    ];
    const modelConfig = extractClaudeAcpModelConfig(configOptions);
    return {
      provider: "claude",
      runner_available: true,
      runner_source: runnerResolution.runner_source,
      runner_package: runnerResolution.package_name,
      runner_version: runnerResolution.package_version,
      claude_cli_available: true,
      auth_compatibility_source: "claude_cli",
      acp_config_discovery_supported: true,
      config_options_count: modelConfig.config_options_count,
      model_config_id: modelConfig.model_config_id,
      models: modelConfig.models,
    };
  } finally {
    client.close();
  }
}
