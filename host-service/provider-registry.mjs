import { execFileSync } from "child_process";
import { existsSync } from "fs";
import {
  getProviderApprovalPolicyOptions,
  getDefaultProviderModel,
  getDefaultProviderReasoningEffort,
  getProviderModelCatalogSeed,
  getProviderPermissionModeOptions,
  getProviderReasoningEffortOptions,
  readDebugConfig,
} from "./config.mjs";
import { loadProviderModelCatalogState } from "./provider-model-params.mjs";

const PROVIDERS = {
  claude: {
    id: "claude",
    label: "Claude Code",
    runtimeSupported: true,
    coderSessionSupported: true,
    auth: {
      supported: true,
      startLoginSupported: true,
    },
    capabilities: {
      interactiveSession: true,
      resume: true,
      fork: true,
      permissionResponses: true,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
      nativeArgs: true,
      nativeCommands: true,
      configOverrides: false,
      search: false,
      imageInput: true,
      machineReadableStream: true,
    },
    controls: {
      model: true,
      reasoningEffort: true,
      approvalPolicy: false,
      sandboxMode: false,
      dangerousMode: true,
      additionalPaths: true,
      searchEnabled: false,
      imageInputEnabled: true,
      nativeArgs: true,
      nativeCommands: true,
      configOverrides: false,
    },
    nativeConfig: {
      sessionCommandDir: ".claude/commands",
    },
  },
  codex: {
    id: "codex",
    label: "Codex",
    runtimeSupported: true,
    coderSessionSupported: true,
    auth: {
      supported: false,
      startLoginSupported: false,
    },
    capabilities: {
      interactiveSession: true,
      resume: true,
      fork: true,
      permissionResponses: true,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
      nativeArgs: true,
      nativeCommands: false,
      configOverrides: true,
      search: true,
      imageInput: true,
      machineReadableStream: true,
    },
    controls: {
      model: true,
      reasoningEffort: true,
      approvalPolicy: true,
      sandboxMode: false,
      dangerousMode: true,
      additionalPaths: true,
      searchEnabled: true,
      imageInputEnabled: true,
      nativeArgs: true,
      nativeCommands: false,
      configOverrides: true,
    },
    nativeConfig: {
      authPath: "~/.codex/auth.json",
      configPath: "~/.codex/config.toml",
      sessionPath: "~/.codex/sessions",
    },
  },
  "debug-fixture": {
    id: "debug-fixture",
    label: "Fake",
    runtimeSupported: true,
    coderSessionSupported: true,
    commandRequired: false,
    auth: {
      supported: false,
      startLoginSupported: false,
    },
    capabilities: {
      interactiveSession: true,
      resume: false,
      fork: false,
      permissionResponses: false,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
      search: false,
      imageInput: false,
      machineReadableStream: true,
    },
    controls: {
      model: true,
      reasoningEffort: false,
      approvalPolicy: false,
      sandboxMode: false,
      dangerousMode: false,
      additionalPaths: true,
      searchEnabled: false,
      imageInputEnabled: false,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
    },
    nativeConfig: {},
  },
  "debug-large-tool-spillover": {
    id: "debug-large-tool-spillover",
    label: "Spillover Fake",
    runtimeSupported: true,
    coderSessionSupported: true,
    commandRequired: false,
    auth: {
      supported: false,
      startLoginSupported: false,
    },
    capabilities: {
      interactiveSession: true,
      resume: false,
      fork: false,
      permissionResponses: false,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
      search: false,
      imageInput: false,
      machineReadableStream: true,
    },
    controls: {
      model: true,
      reasoningEffort: false,
      approvalPolicy: false,
      sandboxMode: false,
      dangerousMode: false,
      additionalPaths: true,
      searchEnabled: false,
      imageInputEnabled: false,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
    },
    nativeConfig: {},
  },
  "debug-p135-codex-replay": {
    id: "debug-p135-codex-replay",
    label: "P135 Codex Replay",
    runtimeSupported: true,
    coderSessionSupported: true,
    commandRequired: false,
    auth: {
      supported: false,
      startLoginSupported: false,
    },
    capabilities: {
      interactiveSession: true,
      resume: false,
      fork: false,
      permissionResponses: false,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
      search: false,
      imageInput: false,
      machineReadableStream: true,
    },
    controls: {
      model: true,
      reasoningEffort: false,
      approvalPolicy: false,
      sandboxMode: false,
      dangerousMode: false,
      additionalPaths: true,
      searchEnabled: false,
      imageInputEnabled: false,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
    },
    nativeConfig: {},
  },
  "debug-routec-structural-replay": {
    id: "debug-routec-structural-replay",
    label: "Route C Structural Replay",
    runtimeSupported: true,
    coderSessionSupported: true,
    commandRequired: false,
    auth: {
      supported: false,
      startLoginSupported: false,
    },
    capabilities: {
      interactiveSession: true,
      resume: true,
      fork: false,
      permissionResponses: false,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
      search: false,
      imageInput: false,
      machineReadableStream: true,
    },
    controls: {
      model: true,
      reasoningEffort: false,
      approvalPolicy: false,
      sandboxMode: false,
      dangerousMode: false,
      additionalPaths: true,
      searchEnabled: false,
      imageInputEnabled: false,
      nativeArgs: false,
      nativeCommands: false,
      configOverrides: false,
    },
    nativeConfig: {},
  },
};

const PRODUCT_PROVIDER_IDS = Object.freeze(["claude", "codex"]);
const DEBUG_FIXTURE_PROVIDER_IDS = Object.freeze(["debug-fixture"]);
const DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER_IDS = Object.freeze([
  "debug-large-tool-spillover",
]);
const DEBUG_P135_CODEX_REPLAY_PROVIDER_IDS = Object.freeze([
  "debug-p135-codex-replay",
]);
const DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_IDS = Object.freeze([
  "debug-routec-structural-replay",
]);

const PROVIDER_COMMAND_CONFIG_KEYS = Object.freeze({
  claude: "claude_command",
  codex: "codex_command",
});

function findModelCatalogEntry(models, modelId) {
  if (typeof modelId !== "string" || !modelId.trim()) return null;
  return models.find((entry) => entry.id === modelId.trim().toLowerCase()) || null;
}

function getCatalogDefaultModel(providerId, models) {
  const configuredDefault = getDefaultProviderModel(providerId);
  if (findModelCatalogEntry(models, configuredDefault)) {
    return configuredDefault;
  }
  const entry = models.find((model) => model.isDefault === true);
  return entry?.id || configuredDefault;
}

function getProviderModelCatalogForRegistry(providerId, options = {}) {
  if (
    providerId === "debug-p135-codex-replay" ||
    providerId === "debug-routec-structural-replay"
  ) {
    return {
      models: getProviderModelCatalogSeed(providerId),
      status: {
        source:
          providerId === "debug-routec-structural-replay"
            ? "host_debug_routec_structural_replay_seed"
            : "host_debug_p135_codex_replay_seed",
        params_path: null,
        params_exists: false,
        available: true,
        stale: false,
        error: null,
      },
    };
  }
  const state = loadProviderModelCatalogState(providerId, {
    configDir: options.configDir,
    paramsPath: options.paramsPath,
  });
  return {
    models: state.models,
    status: state.status,
  };
}

function decorateProvider(provider, options = {}) {
  const config = options.config || {};
  const catalogState = getProviderModelCatalogForRegistry(provider.id, options);
  const models = catalogState.models;
  const providerRuntimeStatus = catalogState.status?.runtime || null;
  const { runtime: _runtime, ...catalogStatus } = catalogState.status || {};
  const defaultModel = getCatalogDefaultModel(provider.id, models);
  const defaultModelEntry = findModelCatalogEntry(models, defaultModel);
  const savedDefaultModel =
    typeof config?.session_defaults?.[provider.id]?.model === "string" &&
    config.session_defaults[provider.id].model.trim()
      ? config.session_defaults[provider.id].model.trim().toLowerCase()
      : null;
  const savedDefaultModelEntry = findModelCatalogEntry(models, savedDefaultModel);
  const defaultReasoningEffort =
    defaultModelEntry?.defaultReasoningEffort ||
    getDefaultProviderReasoningEffort(provider.id, defaultModel);
  return {
    ...provider,
    defaultModel,
    defaultModelAvailable: Boolean(defaultModelEntry),
    savedDefaultModel,
    savedDefaultModelAvailable: Boolean(savedDefaultModelEntry),
    defaultReasoningEffort,
    modelOptions: models.map((entry) => entry.id),
    reasoningEffortOptions: defaultModelEntry
      ? [...defaultModelEntry.reasoningEffortOptions]
      : provider.id === "codex"
      ? []
      : getProviderReasoningEffortOptions(provider.id, defaultModel),
    permissionModeOptions: getProviderPermissionModeOptions(provider.id),
    approvalPolicyOptions: getProviderApprovalPolicyOptions(provider.id),
    models,
    providerRuntimeStatus,
    modelCatalogStatus: {
      ...catalogStatus,
      default_model: defaultModel,
      default_model_available: Boolean(defaultModelEntry),
      saved_default_model: savedDefaultModel,
      saved_default_model_available: Boolean(savedDefaultModelEntry),
    },
    auth: { ...provider.auth },
    capabilities: { ...provider.capabilities },
    controls: { ...provider.controls },
    nativeConfig: { ...provider.nativeConfig },
  };
}

function normalizeDebugFixtureEnvFlag(env = process.env) {
  const rawValue = env?.OYSTERUN_DEBUG_FIXTURE_PROVIDER;
  if (typeof rawValue !== "string") return false;
  const normalized = rawValue.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeDebugLargeToolSpilloverEnvFlag(env = process.env) {
  const rawValue = env?.OYSTERUN_DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER;
  if (typeof rawValue !== "string") return false;
  const normalized = rawValue.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function isDebugFixtureProviderEnabled(config = {}, env = process.env) {
  return (
    config?.debug_fixture_provider_enabled === true ||
    normalizeDebugFixtureEnvFlag(env)
  );
}

export function isDebugLargeToolSpilloverProviderEnabled(
  config = {},
  env = process.env
) {
  return (
    config?.debug_large_tool_spillover_provider_enabled === true ||
    normalizeDebugLargeToolSpilloverEnvFlag(env)
  );
}

export function isDebugP135CodexReplayProviderEnabled(config = {}) {
  return config?.debug_p135_codex_replay_provider_enabled === true;
}

export function isDebugRouteCStructuralReplayProviderEnabled(config = {}) {
  return config?.debug_routec_structural_replay_provider_enabled === true;
}

function shouldIncludeDebugFixtureProvider(options = {}) {
  if (options?.includeDebugFixtureProvider === true) return true;
  if (
    Object.prototype.hasOwnProperty.call(options || {}, "config") ||
    Object.prototype.hasOwnProperty.call(options || {}, "env")
  ) {
    return isDebugFixtureProviderEnabled(options.config || {}, options.env);
  }
  return false;
}

function shouldIncludeDebugLargeToolSpilloverProvider(options = {}) {
  if (options?.includeDebugLargeToolSpilloverProvider === true) return true;
  const hasConfig = Object.prototype.hasOwnProperty.call(
    options || {},
    "config"
  );
  const hasEnv = Object.prototype.hasOwnProperty.call(options || {}, "env");
  if (hasConfig || hasEnv) {
    return isDebugLargeToolSpilloverProviderEnabled(
      options.config || {},
      hasEnv ? options.env : {}
    );
  }
  return normalizeDebugLargeToolSpilloverEnvFlag(process.env);
}

function shouldIncludeDebugP135CodexReplayProvider(options = {}) {
  if (options?.includeDebugP135CodexReplayProvider === true) return true;
  if (Object.prototype.hasOwnProperty.call(options || {}, "config")) {
    return isDebugP135CodexReplayProviderEnabled(options.config || {});
  }
  return isDebugP135CodexReplayProviderEnabled(readDebugConfig());
}

function shouldIncludeDebugRouteCStructuralReplayProvider(options = {}) {
  if (options?.includeDebugRouteCStructuralReplayProvider === true) return true;
  if (Object.prototype.hasOwnProperty.call(options || {}, "config")) {
    return isDebugRouteCStructuralReplayProviderEnabled(options.config || {});
  }
  return isDebugRouteCStructuralReplayProviderEnabled(readDebugConfig());
}

function getAvailableProviderIds(options = {}) {
  const ids = [...PRODUCT_PROVIDER_IDS];
  if (shouldIncludeDebugFixtureProvider(options)) {
    ids.push(...DEBUG_FIXTURE_PROVIDER_IDS);
  }
  if (shouldIncludeDebugLargeToolSpilloverProvider(options)) {
    ids.push(...DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER_IDS);
  }
  if (shouldIncludeDebugP135CodexReplayProvider(options)) {
    ids.push(...DEBUG_P135_CODEX_REPLAY_PROVIDER_IDS);
  }
  if (shouldIncludeDebugRouteCStructuralReplayProvider(options)) {
    ids.push(...DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_IDS);
  }
  return ids;
}

export function listProviders(options = {}) {
  return getAvailableProviderIds(options).map((id) =>
    decorateProvider(PROVIDERS[id], options)
  );
}

export function getProvider(id, options = {}) {
  if (id === undefined || id === null)
    return decorateProvider(PROVIDERS.claude, options);
  if (typeof id !== "string") return null;
  const normalized = id.trim();
  if (!normalized) return null;
  if (!getAvailableProviderIds(options).includes(normalized)) return null;
  const provider = PROVIDERS[normalized] || null;
  return provider ? decorateProvider(provider, options) : null;
}

export function requireProvider(id, options = {}) {
  const provider = getProvider(id, options);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

export function getProviderCommandConfigKey(id, options = {}) {
  const provider = requireProvider(id, options);
  return PROVIDER_COMMAND_CONFIG_KEYS[provider.id] || null;
}

export function getConfiguredProviderCommand(config = {}, id) {
  const commandKey = getProviderCommandConfigKey(id, { config });
  if (!commandKey) {
    return null;
  }
  const rawValue = config?.[commandKey];
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }
  return rawValue.trim();
}

export function isConfiguredCommandAvailable(command) {
  if (typeof command !== "string" || !command.trim()) {
    return false;
  }
  const normalized = command.trim();
  if (normalized.includes("/")) {
    return existsSync(normalized);
  }
  try {
    const resolved = execFileSync("which", [normalized], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return Boolean(resolved);
  } catch {
    return false;
  }
}

export function isProviderCommandAvailable(config = {}, id) {
  const provider = requireProvider(id, { config });
  if (provider.commandRequired === false) {
    return true;
  }
  const command = getConfiguredProviderCommand(config, id);
  return isConfiguredCommandAvailable(command);
}

export function createProviderUnavailableError(id, details = {}) {
  const provider = requireProvider(id, { config: details.config || {} });
  const configuredCommand =
    typeof details.command === "string" && details.command.trim()
      ? details.command.trim()
      : null;
  const error = new Error(
    configuredCommand
      ? `Provider "${provider.label}" is unavailable because the configured command could not be resolved: ${configuredCommand}. Update Host Preferences or rerun host-service/setup.mjs.`
      : `Provider "${provider.label}" is unavailable on this Host. Run host-service/setup.mjs or set the provider command in Host Preferences.`
  );
  error.code = "provider_unavailable";
  error.statusCode = 503;
  error.providerId = provider.id;
  error.configKey = PROVIDER_COMMAND_CONFIG_KEYS[provider.id];
  error.command = configuredCommand;
  return error;
}

export function resolveProviderId(config = {}, overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, "provider")) {
    return requireProvider(overrides.provider, { config }).id;
  }
  const interfaceConfig = config?.interface ?? {};
  if (
    typeof interfaceConfig.provider === "string" &&
    interfaceConfig.provider.trim()
  ) {
    return requireProvider(interfaceConfig.provider, { config }).id;
  }
  return "claude";
}
