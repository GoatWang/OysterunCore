import { execFileSync } from "child_process";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  realpathSync,
} from "fs";
import {
  mkdir as mkdirAsync,
  realpath as realpathAsync,
  stat as statAsync,
} from "fs/promises";
import { join, resolve } from "path";
import { homedir, hostname as osHostname } from "os";
import {
  hashDashboardPassword,
  normalizeDashboardPasswordHash,
} from "./dashboard-password.mjs";
import { writeAtomicTextFile } from "./atomic-file.mjs";

/**
 * Persistent local config for the Oysterun host service.
 * Product config is stored at ~/.oysterun/config.json.
 * Moved debug-only controls are stored at ~/.oysterun/config.debug.json.
 */

export function getConfigDir() {
  return process.env.OYSTERUN_CONFIG_DIR || join(homedir(), ".oysterun");
}

export function getHostDbPath(configDir = getConfigDir()) {
  return join(configDir, "oysterun.sqlite");
}

export function getConfigSource() {
  return process.env.OYSTERUN_CONFIG_DIR
    ? "OYSTERUN_CONFIG_DIR"
    : "HOME_DEFAULT";
}

function getResolvedConfigPath() {
  return join(getConfigDir(), "config.json");
}

function getResolvedCloudIdentityPath() {
  return join(getConfigDir(), "cloud_identity.json");
}

function getResolvedDebugConfigPath() {
  return join(getConfigDir(), "config.debug.json");
}

const DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER_ENV_KEY =
  "OYSTERUN_DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER";
let syncedDebugLargeToolSpilloverProviderPreviousEnvValue;
let syncedDebugLargeToolSpilloverProviderFromConfig = false;

function getResolvedLegacyDefaultAgentConfigPath() {
  return join(homedir(), ".oysterun", "default-agent-config.json");
}

function normalizeHostNameSegment(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, "-");
}

function resolveSystemLocalHostName() {
  try {
    const localHostName = execFileSync("scutil", ["--get", "LocalHostName"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const normalized = normalizeHostNameSegment(localHostName);
    if (normalized) return normalized;
  } catch {
    // macOS Host installs should have scutil; fall back for non-mac or reduced test environments.
  }
  return normalizeHostNameSegment(osHostname()) || "localhost";
}

export function deriveProductDefaultBrowsePath(homeDir = homedir()) {
  return resolve(join(homeDir, "OysterunAgents"));
}

export function ensureProductDefaultBrowsePath() {
  const defaultRoot = deriveProductDefaultBrowsePath();
  mkdirSync(defaultRoot, { recursive: true });
  return realpathSync(defaultRoot);
}

const DEFAULT_HOST_DISPLAY_NAME = `oysterun-${resolveSystemLocalHostName()}`;

export const PRODUCTION_HOST_PORT = 8802;
export const STAGING_HOST_PORT = 9902;
export const TEST_HOST_PORTS = Object.freeze({
  test1: 3022,
  test2: 3302,
  test3: 4022,
  test4: 4402,
});
export const LEGACY_FALLBACK_HOST_PORT = 3456;
export const PRODUCT_CLOUD_BACKEND_URL = "https://api.oysterun.com";
export const PRODUCT_CLOUD_BACKEND_STAGE = "prod";
export const CLOUD_BACKEND_STAGE_QUERY_PARAM = "oysterun_stage";
export const CLOUD_BACKEND_STAGE_OPTIONS = Object.freeze(["prod", "beta", "dev"]);
const DEFAULT_SHARED_ALLOWED_PATHS = Object.freeze(["/"]);
export const CLAUDE_MAIN_MODEL_OPTIONS = Object.freeze([
  "opus",
  "sonnet",
  "haiku",
]);
const CLAUDE_REASONING_EFFORT_OPTIONS = Object.freeze([
  "auto",
  "low",
  "medium",
  "high",
  "max",
]);
const CODEX_SAFE_REASONING_EFFORT_OPTIONS = Object.freeze([
  "low",
  "medium",
  "high",
]);
const CODEX_MAX_REASONING_EFFORT_OPTIONS = Object.freeze([
  "low",
  "medium",
  "high",
  "max",
]);
const CLAUDE_PERMISSION_MODE_OPTIONS = Object.freeze([
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);
const CLAUDE_PERMISSION_MODE_OPTION_SET = new Set(CLAUDE_PERMISSION_MODE_OPTIONS);
const CODEX_APPROVAL_POLICY_OPTIONS = Object.freeze([
  "on-request",
  "never",
]);
const CODEX_APPROVAL_POLICY_OPTION_SET = new Set(CODEX_APPROVAL_POLICY_OPTIONS);
const CLAUDE_PERMISSION_MODE_ALIASES = Object.freeze({
  autoeditapprove: "acceptEdits",
  acceptedits: "acceptEdits",
  bypasspermissions: "bypassPermissions",
  default: "default",
  plan: "plan",
});
const SHARED_REASONING_EFFORT_ALIASES = Object.freeze({
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
  xhigh: "max",
});
const CLAUDE_REASONING_EFFORT_ALIASES = Object.freeze({
  auto: "auto",
  ...SHARED_REASONING_EFFORT_ALIASES,
});
const CODEX_REASONING_EFFORT_ALIASES = Object.freeze({
  ...SHARED_REASONING_EFFORT_ALIASES,
});

function freezeModelCatalog(entries) {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        ...entry,
        label: entry.label || entry.id,
        reasoningEffortOptions: Object.freeze([
          ...(entry.reasoningEffortOptions || []),
        ]),
        defaultReasoningEffort: entry.defaultReasoningEffort || null,
        hidden: entry.hidden === true,
        isDefault: entry.isDefault === true,
      })
    )
  );
}

const CLAUDE_MODEL_CATALOG = freezeModelCatalog(
  CLAUDE_MAIN_MODEL_OPTIONS.map((id, index) => ({
    id,
    label: id,
    reasoningEffortOptions: CLAUDE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
    isDefault: index === 0,
  }))
);

const CODEX_MODEL_CATALOG = freezeModelCatalog([
  {
    id: "gpt-5.5",
    reasoningEffortOptions: CODEX_MAX_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "max",
    isDefault: true,
  },
  {
    id: "gpt-5.4",
    reasoningEffortOptions: CODEX_MAX_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "max",
  },
  {
    id: "gpt-5.4-mini",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.3-codex",
    reasoningEffortOptions: CODEX_MAX_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "max",
  },
  {
    id: "gpt-5.3-codex-spark",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.2-codex",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.2",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.1-codex-max",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.1-codex",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-oss-120b",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-oss-20b",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.1",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5-codex",
    hidden: true,
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.1-codex-mini",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5-codex-mini",
    reasoningEffortOptions: CODEX_SAFE_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: "high",
  },
]);

const DEBUG_FIXTURE_MODEL_CATALOG = freezeModelCatalog([
  {
    id: "0.5s",
    label: "0.5s",
    reasoningEffortOptions: [],
    defaultReasoningEffort: null,
  },
  {
    id: "1s",
    label: "1s",
    reasoningEffortOptions: [],
    defaultReasoningEffort: null,
    isDefault: true,
  },
  {
    id: "5s",
    label: "5s",
    reasoningEffortOptions: [],
    defaultReasoningEffort: null,
  },
  {
    id: "10s",
    label: "10s",
    reasoningEffortOptions: [],
    defaultReasoningEffort: null,
  },
]);

const DEBUG_P135_CODEX_REPLAY_MODEL_CATALOG = freezeModelCatalog([
  {
    id: "p135-codex-replay-default",
    label: "P135 Codex Replay",
    reasoningEffortOptions: [],
    defaultReasoningEffort: null,
    isDefault: true,
  },
]);

const PROVIDER_MODEL_CATALOG = Object.freeze({
  claude: CLAUDE_MODEL_CATALOG,
  codex: CODEX_MODEL_CATALOG,
  "debug-fixture": DEBUG_FIXTURE_MODEL_CATALOG,
  "debug-large-tool-spillover": Object.freeze([
    {
      id: "spillover-fake",
      label: "Spillover Fake",
      reasoningEffortOptions: [],
      defaultReasoningEffort: null,
      isDefault: true,
    },
  ]),
  "debug-p135-codex-replay": DEBUG_P135_CODEX_REPLAY_MODEL_CATALOG,
});

const DEFAULT_SESSION_DEFAULTS = Object.freeze({
  default_provider: "claude",
  interface_type: "coding",
  web: Object.freeze({
    enabled: false,
    access: "owner_only",
  }),
  notifications: Object.freeze({
    enabled: true,
  }),
  runtime_capabilities: Object.freeze({}),
  claude: Object.freeze({
    model: CLAUDE_MAIN_MODEL_OPTIONS[0],
    reasoning_effort: "high",
    permission_mode: "bypassPermissions",
    allow_dangerously_skip_permissions: false,
    dangerous_mode: false,
    image_input_enabled: true,
  }),
  codex: Object.freeze({
    model: "gpt-5.5",
    reasoning_effort: "max",
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    dangerous_mode: false,
    search_enabled: false,
    image_input_enabled: false,
    provider_profile: null,
    provider_args: [],
    provider_commands: [],
    provider_config_overrides: {},
  }),
});

// These exact full-shape defaults should be rewritten through the config loader:
// legacy dangerous bootstrap variants plus older Codex defaults that predate
// Oysterun-owned permission control.
const STALE_PROVIDER_DEFAULTS = Object.freeze({
  claude: Object.freeze([
    Object.freeze({
      model: "opus",
      reasoning_effort: "high",
      permission_mode: "bypassPermissions",
      allow_dangerously_skip_permissions: true,
      dangerous_mode: true,
      image_input_enabled: true,
    }),
  ]),
  codex: Object.freeze([
    Object.freeze({
      model: "gpt-5-codex",
      reasoning_effort: "high",
      approval_policy: "never",
      sandbox_mode: "danger-full-access",
      dangerous_mode: false,
      search_enabled: false,
      image_input_enabled: false,
      provider_profile: null,
      provider_args: [],
      provider_commands: [],
      provider_config_overrides: {},
    }),
    Object.freeze({
      model: "gpt-5-codex",
      reasoning_effort: "high",
      approval_policy: "never",
      sandbox_mode: "workspace-write",
      dangerous_mode: false,
      search_enabled: false,
      image_input_enabled: false,
      provider_profile: null,
      provider_args: [],
      provider_commands: [],
      provider_config_overrides: {},
    }),
    Object.freeze({
      model: "gpt-5-codex",
      reasoning_effort: "high",
      approval_policy: "never",
      sandbox_mode: "danger-full-access",
      dangerous_mode: true,
      search_enabled: false,
      image_input_enabled: false,
      provider_profile: null,
      provider_args: [],
      provider_commands: [],
      provider_config_overrides: {},
    }),
    Object.freeze({
      model: "gpt-5-codex",
      reasoning_effort: "high",
      approval_policy: "never",
      sandbox_mode: "workspace-write",
      dangerous_mode: true,
      search_enabled: false,
      image_input_enabled: false,
      provider_profile: null,
      provider_args: [],
      provider_commands: [],
      provider_config_overrides: {},
    }),
    Object.freeze({
      model: "gpt-5-codex",
      reasoning_effort: "high",
      approval_policy: "on-request",
      sandbox_mode: "workspace-write",
      dangerous_mode: false,
      search_enabled: false,
      image_input_enabled: false,
      provider_profile: null,
      provider_args: [],
      provider_commands: [],
      provider_config_overrides: {},
    }),
    Object.freeze({
      model: "gpt-5.4",
      reasoning_effort: "max",
      approval_policy: "never",
      sandbox_mode: "danger-full-access",
      dangerous_mode: false,
      search_enabled: false,
      image_input_enabled: false,
      provider_profile: null,
      provider_args: [],
      provider_commands: [],
      provider_config_overrides: {},
    }),
  ]),
});

const DEFAULT_ALLOWED_PATH_DEBUG_CONFIG = Object.freeze({
  disabled: true,
  debug_ui_enabled: false,
});
const DEFAULT_PROVIDER_PERMISSION_DEBUG_CONFIG = Object.freeze({
  debug_mode_dropdown_enable: false,
});
const LEGACY_TELEGRAM_PRODUCT_FLAG_KEY = ["telegram", "feature", "enabled"].join(
  "_"
);

const DEFAULT_CONFIG = Object.freeze({
  connection_mode: "direct",
  port: PRODUCTION_HOST_PORT,
  // Product Cloud endpoint is a tracked code default, not a user preference.
  // config.json must not persist backend_url. Local Cloud development must use
  // OYSTERUN_BACKEND_URL or an explicit setup --backend-url override.
  backend_url: PRODUCT_CLOUD_BACKEND_URL,
  public_base_url: null,
  direct_host_url: null,
  host_id: null,
  host_credential: null,
  device_id: null,
  device_signing_public_key: null,
  device_signing_kid: null,
  cloud_public_key: null,
  device_token: null,
  tunnel_provider: "frp",
  ngrok_domain: null,
  dashboard_user: null,
  dashboard_password_hash: null,
  claude_command: null,
  codex_command: null,
  default_browse_path: null,
  show_hidden_files: true,
  notification_sound_web_enabled: true,
  notification_sound_app_enabled: true,
  daily_telemetry_enabled: false,
  daily_telemetry_consent_recorded_at: null,
  debug_fixture_provider_enabled: false,
  debug_large_tool_spillover_provider_enabled: false,
  debug_p135_codex_replay_provider_enabled: false,
  debug_show_capability_ui: false,
  show_interface_style_in_session_setup_profile: false,
  debug_dashboard_session_ttl_hours: -1,
  debug_routec_facade_token_ttl_ms: -1,
  debug_host_artifact_writes_enabled: false,
  debug_apns_runtime_observability_enabled: false,
  debug_routec_facade_transcript_enabled: false,
  debug_routec_auth_loss_diagnostics_enabled: false,
  debug_routec_runtime_proof_artifacts_enabled: false,
  debug_routec_chat_liveness_diagnostics_enabled: false,
  debug_routec_tool_detail_source_ui_enabled: false,
  debug_routec_facade_transcript_rotation_enabled: true,
  debug_routec_facade_transcript_max_bytes: 262144,
  debug_routec_facade_transcript_max_files: 3,
  debug_host_preferences_full_disk_access_block_enabled: false,
  debug_cloud_backend_stage: PRODUCT_CLOUD_BACKEND_STAGE,
  allowed_path: DEFAULT_ALLOWED_PATH_DEBUG_CONFIG,
  provider_permission: DEFAULT_PROVIDER_PERMISSION_DEBUG_CONFIG,
  routec_matrix_storage_cache_enabled: true,
  routec_matrix_sync_idle_long_poll_timeout_ms: 30000,
  routec_matrix_sync_active_coalesce_ms: 1000,
  transcript_retention_days: null,
  display_name: DEFAULT_HOST_DISPLAY_NAME,
  onboarding_token: null,
  onboarding_url: null,
  registered_at: null,
  session_defaults: DEFAULT_SESSION_DEFAULTS,
});

const DEBUG_CONFIG_KEYS = Object.freeze([
  "debug_fixture_provider_enabled",
  "debug_large_tool_spillover_provider_enabled",
  "debug_p135_codex_replay_provider_enabled",
  "debug_show_capability_ui",
  "show_interface_style_in_session_setup_profile",
  "debug_dashboard_session_ttl_hours",
  "debug_routec_facade_token_ttl_ms",
  "debug_host_artifact_writes_enabled",
  "debug_routec_facade_transcript_enabled",
  "debug_routec_auth_loss_diagnostics_enabled",
  "debug_routec_runtime_proof_artifacts_enabled",
  "debug_routec_chat_liveness_diagnostics_enabled",
  "debug_routec_tool_detail_source_ui_enabled",
  "debug_apns_runtime_observability_enabled",
  "debug_routec_facade_transcript_rotation_enabled",
  "debug_routec_facade_transcript_max_bytes",
  "debug_routec_facade_transcript_max_files",
  "debug_host_preferences_full_disk_access_block_enabled",
  "debug_cloud_backend_stage",
  "allowed_path",
  "provider_permission",
]);
const DEBUG_CONFIG_KEY_SET = new Set(DEBUG_CONFIG_KEYS);
const LEGACY_RUNTIME_DEBUG_CONFIG_KEYS = DEBUG_CONFIG_KEYS.filter(
  (key) => key !== "allowed_path" && key !== "provider_permission"
);

function syncDebugLargeToolSpilloverProviderEnv(config = {}) {
  if (config?.debug_large_tool_spillover_provider_enabled === true) {
    if (!syncedDebugLargeToolSpilloverProviderFromConfig) {
      syncedDebugLargeToolSpilloverProviderPreviousEnvValue =
        process.env[DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER_ENV_KEY];
      syncedDebugLargeToolSpilloverProviderFromConfig = true;
    }
    process.env[DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER_ENV_KEY] = "true";
    return;
  }

  if (!syncedDebugLargeToolSpilloverProviderFromConfig) return;
  if (syncedDebugLargeToolSpilloverProviderPreviousEnvValue === undefined) {
    delete process.env[DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER_ENV_KEY];
  } else {
    process.env[DEBUG_LARGE_TOOL_SPILLOVER_PROVIDER_ENV_KEY] =
      syncedDebugLargeToolSpilloverProviderPreviousEnvValue;
  }
  syncedDebugLargeToolSpilloverProviderPreviousEnvValue = undefined;
  syncedDebugLargeToolSpilloverProviderFromConfig = false;
}

const CLOUD_IDENTITY_KEYS = Object.freeze([
  "backend_url",
  "host_id",
  "host_credential",
  "device_id",
  "device_token",
  "registered_at",
  "cloud_registration_state",
  "onboarding_token",
  "onboarding_url",
  "device_signing_public_key",
  "device_signing_kid",
  "cloud_public_key",
]);
const CLOUD_IDENTITY_KEY_SET = new Set(CLOUD_IDENTITY_KEYS);

const DIRECT_SETUP_DEFAULTS = Object.freeze({
  display_name: DEFAULT_HOST_DISPLAY_NAME,
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cloneModelCatalogEntry(entry) {
  if (!entry) return null;
  return {
    ...entry,
    reasoningEffortOptions: [...entry.reasoningEffortOptions],
  };
}

function getProviderCatalog(providerId) {
  return PROVIDER_MODEL_CATALOG[providerId] || [];
}

function getProviderModelCatalogEntry(providerId, value) {
  const normalizedModel = normalizeString(value)?.toLowerCase();
  if (!normalizedModel) return null;
  return (
    getProviderCatalog(providerId).find(
      (entry) => entry.id === normalizedModel
    ) || null
  );
}

function getDefaultProviderModelCatalogEntry(providerId) {
  const providerCatalog = getProviderCatalog(providerId);
  return (
    providerCatalog.find((entry) => entry.isDefault) ||
    providerCatalog[0] ||
    null
  );
}

export function normalizeClaudeModel(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "default") {
    return CLAUDE_MAIN_MODEL_OPTIONS[0];
  }
  if (CLAUDE_MAIN_MODEL_OPTIONS.includes(lowered)) {
    return lowered;
  }
  const variantMatch = /^(opus|sonnet|haiku)\[[a-z0-9][a-z0-9._-]*\]$/.exec(
    lowered
  );
  if (variantMatch) {
    return variantMatch[1];
  }
  const aliasMatch = /^claude-(opus|sonnet|haiku)(?:-|$)/.exec(lowered);
  return aliasMatch ? aliasMatch[1] : null;
}

export function normalizeProviderModel(providerId, value) {
  if (providerId === "claude") {
    return normalizeClaudeModel(value);
  }
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function getProviderModelCatalog(providerId) {
  return getProviderCatalog(providerId).map((entry) =>
    cloneModelCatalogEntry(entry)
  );
}

export function getProviderModelCatalogSeed(providerId) {
  return getProviderModelCatalog(providerId);
}

export function getProviderReasoningEffortOptions(providerId, modelId = null) {
  if (providerId === "claude") {
    const entry =
      getProviderModelCatalogEntry(providerId, modelId) ||
      getDefaultProviderModelCatalogEntry(providerId);
    return entry
      ? [...entry.reasoningEffortOptions]
      : [...CLAUDE_REASONING_EFFORT_OPTIONS];
  }
  if (providerId === "codex") {
    const entry =
      getProviderModelCatalogEntry(providerId, modelId) ||
      getDefaultProviderModelCatalogEntry(providerId);
    return entry
      ? [...entry.reasoningEffortOptions]
      : [...CODEX_SAFE_REASONING_EFFORT_OPTIONS];
  }
  return [];
}

export function getProviderPermissionModeOptions(providerId) {
  if (providerId === "claude") {
    return [...CLAUDE_PERMISSION_MODE_OPTIONS];
  }
  return [];
}

export function getProviderApprovalPolicyOptions(providerId) {
  if (providerId === "codex") {
    return [...CODEX_APPROVAL_POLICY_OPTIONS];
  }
  return [];
}

export function getDefaultProviderReasoningEffort(providerId, modelId = null) {
  const defaults = DEFAULT_SESSION_DEFAULTS[providerId];
  const entry =
    getProviderModelCatalogEntry(providerId, modelId) ||
    getDefaultProviderModelCatalogEntry(providerId);
  return (
    entry?.defaultReasoningEffort ||
    (typeof defaults?.reasoning_effort === "string"
      ? defaults.reasoning_effort
      : null)
  );
}

export function normalizeProviderReasoningEffort(
  providerId,
  value,
  modelId = null
) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (providerId === "codex") {
    const aliased = CODEX_REASONING_EFFORT_ALIASES[lowered] || null;
    if (!aliased) return null;
    const supported = getProviderReasoningEffortOptions(providerId, modelId);
    if (supported.length > 0 && !supported.includes(aliased)) {
      return null;
    }
    return aliased;
  }
  if (providerId !== "claude") {
    return null;
  }
  const aliased = CLAUDE_REASONING_EFFORT_ALIASES[lowered] || null;
  if (!aliased) return null;
  const supported = getProviderReasoningEffortOptions(providerId, modelId);
  if (supported.length > 0 && !supported.includes(aliased)) {
    return null;
  }
  return aliased;
}

export function toProviderNativeReasoningEffort(
  providerId,
  value,
  modelId = null
) {
  const normalized = normalizeProviderReasoningEffort(
    providerId,
    value,
    modelId
  );
  if (!normalized) return null;
  if (providerId === "claude" && normalized === "auto") {
    return null;
  }
  if (providerId === "codex" && normalized === "max") {
    return "xhigh";
  }
  return normalized;
}

export function getProviderModelOptions(providerId) {
  return getProviderCatalog(providerId).map((entry) => entry.id);
}

export function getDefaultProviderModel(providerId) {
  return getDefaultProviderModelCatalogEntry(providerId)?.id || null;
}

function buildInitialInterfaceConfig(providerId, sessionDefaults) {
  const interfaceConfig = {
    provider: providerId,
    type: sessionDefaults.interface_type,
    model: sessionDefaults[providerId].model,
    reasoning_effort: sessionDefaults[providerId].reasoning_effort,
  };

  if (providerId === "claude") {
    interfaceConfig.permission_mode = sessionDefaults.claude.permission_mode;
    interfaceConfig.allow_dangerously_skip_permissions =
      sessionDefaults.claude.allow_dangerously_skip_permissions === true;
    interfaceConfig.dangerous_mode =
      sessionDefaults.claude.dangerous_mode === true;
    interfaceConfig.image_input_enabled =
      sessionDefaults.claude.image_input_enabled === true;
    return interfaceConfig;
  }

  interfaceConfig.approval_policy = sessionDefaults.codex.approval_policy;
  interfaceConfig.dangerous_mode =
    sessionDefaults.codex.dangerous_mode === true;
  interfaceConfig.search_enabled =
    sessionDefaults.codex.search_enabled === true;
  interfaceConfig.image_input_enabled =
    sessionDefaults.codex.image_input_enabled === true;
  return interfaceConfig;
}

export function buildInitialSharedAgentConfig(
  sessionDefaults = getDefaultSessionDefaults()
) {
  const normalizedSessionDefaults = normalizeSessionDefaults(sessionDefaults);
  const providerId = normalizedSessionDefaults.default_provider;
  return {
    interface: buildInitialInterfaceConfig(
      providerId,
      normalizedSessionDefaults
    ),
    workspace_policy: {
      root: ".",
    },
    permissions: {
      allowed_paths: getDefaultSharedAllowedPaths(),
    },
    ui: {
      default_surface: normalizedSessionDefaults.interface_type,
    },
  };
}

function normalizeProviderCommand(value, providerId) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return normalized;
}

function normalizeBooleanWithDefault(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback === true;
  }
  return normalizeBoolean(value);
}

function normalizePositiveIntegerWithDefault(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : Number.parseInt(value, 10);
  return parsed > 0 ? parsed : fallback;
}

function normalizeConnectionMode(value) {
  return value === "cloud" ? "cloud" : "direct";
}

function normalizeStoredPublicBaseUrl(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDisplayName(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_HOST_DISPLAY_NAME;
}

const SUPPORTED_HOST_DEFAULT_INTERFACE_TYPES = Object.freeze(["coding"]);

export function normalizeHostDefaultInterfaceType(value) {
  return SUPPORTED_HOST_DEFAULT_INTERFACE_TYPES.includes(value)
    ? value
    : DEFAULT_SESSION_DEFAULTS.interface_type;
}

function normalizeInterfaceType(value) {
  return normalizeHostDefaultInterfaceType(value);
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeTranscriptRetentionDays(_value) {
  return null;
}

function normalizeSessionDefaultWebAccess(value) {
  const normalized = normalizeString(value) || DEFAULT_SESSION_DEFAULTS.web.access;
  if (["owner_only", "password", "public"].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_SESSION_DEFAULTS.web.access;
}

function normalizeSessionDefaultWebConfig(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    enabled: source.enabled === true,
    access: normalizeSessionDefaultWebAccess(source.access),
  };
}

function normalizeSessionDefaultNotificationsConfig(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    enabled: normalizeBooleanWithDefault(
      source.enabled,
      DEFAULT_SESSION_DEFAULTS.notifications.enabled
    ),
  };
}

function normalizeSessionDefaultRuntimeCapabilities(value) {
  if (!isPlainObject(value)) return {};
  const normalized = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof key !== "string" || !key.trim()) continue;
    normalized[key.trim()] = enabled === true;
  }
  return normalized;
}

function normalizeDebugDashboardSessionTtlHours(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new Error("debug_dashboard_session_ttl_hours must be an integer");
  }
  if (numeric === -1) {
    return -1;
  }
  if (numeric < 1) {
    throw new Error(
      "debug_dashboard_session_ttl_hours must be -1 or a positive integer"
    );
  }
  return numeric;
}

function normalizeDebugRouteCFacadeTokenTtlMs(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new Error("debug_routec_facade_token_ttl_ms must be an integer");
  }
  if (numeric === -1) {
    return -1;
  }
  if (numeric < 1) {
    throw new Error(
      "debug_routec_facade_token_ttl_ms must be -1 or a positive integer"
    );
  }
  return numeric;
}

function normalizeSandboxMode(value) {
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "workspacewrite" || normalized === "workspace-write")
      return "workspace-write";
    if (normalized === "readonly" || normalized === "read-only")
      return "read-only";
    if (
      normalized === "dangerfullaccess" ||
      normalized === "danger-full-access"
    ) {
      return "danger-full-access";
    }
    return normalized;
  }
  return DEFAULT_SESSION_DEFAULTS.codex.sandbox_mode;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

export function normalizeClaudePermissionMode(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return CLAUDE_PERMISSION_MODE_ALIASES[normalized.toLowerCase()] || normalized;
}

export function normalizeCodexApprovalPolicy(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  return CODEX_APPROVAL_POLICY_OPTION_SET.has(normalized) ? normalized : null;
}

export function normalizeConfiguredCodexApprovalPolicy(
  value,
  label = "approval_policy"
) {
  if (value === undefined || value === null) return null;
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) {
    throw new Error(`${label} must be a valid Codex approval policy`);
  }
  if (!CODEX_APPROVAL_POLICY_OPTION_SET.has(normalized)) {
    throw new Error(
      `${label} must be one of: ${CODEX_APPROVAL_POLICY_OPTIONS.join(", ")}`
    );
  }
  return normalized;
}

export function getDefaultProviderPermissionPolicy(providerId) {
  if (providerId === "claude") {
    return DEFAULT_SESSION_DEFAULTS.claude.permission_mode;
  }
  if (providerId === "codex") {
    return DEFAULT_SESSION_DEFAULTS.codex.approval_policy;
  }
  return null;
}

export function normalizeProviderPermissionPolicy(providerId, value) {
  if (providerId === "claude") {
    const normalized = normalizeClaudePermissionMode(value);
    return CLAUDE_PERMISSION_MODE_OPTION_SET.has(normalized) ? normalized : null;
  }
  if (providerId === "codex") return normalizeCodexApprovalPolicy(value);
  return null;
}

export function isDefaultProviderPermissionPolicy(providerId, value) {
  const normalized = normalizeProviderPermissionPolicy(providerId, value);
  const defaultValue = getDefaultProviderPermissionPolicy(providerId);
  return Boolean(normalized && defaultValue && normalized === defaultValue);
}

export function isProviderPermissionDebugModeEnabled(config = {}) {
  return config?.provider_permission?.debug_mode_dropdown_enable === true;
}

function readOptionalObjectFile(configPath, label) {
  if (!existsSync(configPath)) return {};

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} ${configPath}: ${err.message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid ${label} root object in ${configPath}`);
  }

  return parsed;
}

function parseRequiredConfigJson(raw, configPath, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} ${configPath}: ${err.message}`);
  }
}

function normalizeProviderSessionDefaults(providerId, value) {
  const defaults = DEFAULT_SESSION_DEFAULTS[providerId];
  const source = isPlainObject(value) ? value : {};
  const model =
    normalizeProviderModel(providerId, source.model) || defaults.model;
  const defaultReasoningEffort =
    getDefaultProviderReasoningEffort(providerId, model) ||
    defaults.reasoning_effort;

  if (providerId === "claude") {
    return {
      model,
      reasoning_effort:
        normalizeProviderReasoningEffort(
          providerId,
          source.reasoning_effort,
          model
        ) || defaultReasoningEffort,
      permission_mode:
        normalizeClaudePermissionMode(source.permission_mode) ||
        defaults.permission_mode,
      allow_dangerously_skip_permissions: normalizeBoolean(
        source.allow_dangerously_skip_permissions
      ),
      dangerous_mode: normalizeBoolean(source.dangerous_mode),
      // Claude Host defaults previously persisted false here with no user-facing control.
      // Coerce legacy saved values and missing keys to the current canonical default.
      image_input_enabled: normalizeBooleanWithDefault(
        source.image_input_enabled === false
          ? undefined
          : source.image_input_enabled,
        defaults.image_input_enabled
      ),
    };
  }

  const providerConfigOverrides = normalizeObject(
    source.provider_config_overrides
  );
  delete providerConfigOverrides.model_reasoning_effort;

  return {
    model,
    reasoning_effort:
      normalizeProviderReasoningEffort(
        providerId,
        source.reasoning_effort,
        model
      ) ||
      normalizeProviderReasoningEffort(
        providerId,
        source.provider_config_overrides?.model_reasoning_effort,
        model
      ) ||
      defaultReasoningEffort,
    approval_policy:
      normalizeConfiguredCodexApprovalPolicy(
        source.approval_policy,
        `session_defaults.${providerId}.approval_policy`
      ) || defaults.approval_policy,
    sandbox_mode: normalizeSandboxMode(source.sandbox_mode),
    dangerous_mode: normalizeBoolean(source.dangerous_mode),
    search_enabled: normalizeBoolean(source.search_enabled),
    image_input_enabled: normalizeBooleanWithDefault(
      source.image_input_enabled,
      defaults.image_input_enabled
    ),
    provider_profile: normalizeString(source.provider_profile),
    provider_args: normalizeStringArray(source.provider_args),
    provider_commands: normalizeStringArray(source.provider_commands),
    provider_config_overrides: providerConfigOverrides,
  };
}

function dataShapeEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function migrateStaleSessionDefaults(sessionDefaults) {
  const next = cloneValue(sessionDefaults);
  const staleClaudeDefaults = STALE_PROVIDER_DEFAULTS.claude;
  const staleCodexDefaults = STALE_PROVIDER_DEFAULTS.codex;
  if (
    staleClaudeDefaults.some((entry) => dataShapeEquals(next.claude, entry))
  ) {
    next.claude = cloneValue(DEFAULT_SESSION_DEFAULTS.claude);
  }
  if (staleCodexDefaults.some((entry) => dataShapeEquals(next.codex, entry))) {
    next.codex = cloneValue(DEFAULT_SESSION_DEFAULTS.codex);
  }
  return next;
}

function normalizeDefaultBrowsePathConfigValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return ensureProductDefaultBrowsePath();
}

export function normalizeSessionDefaults(value) {
  const source = isPlainObject(value) ? value : {};
  const defaultProvider = normalizeString(source.default_provider);
  return {
    default_provider: defaultProvider === "codex" ? "codex" : "claude",
    interface_type: normalizeInterfaceType(source.interface_type),
    web: normalizeSessionDefaultWebConfig(source.web),
    notifications: normalizeSessionDefaultNotificationsConfig(source.notifications),
    runtime_capabilities: normalizeSessionDefaultRuntimeCapabilities(
      source.runtime_capabilities ?? source.runtimeCapabilities
    ),
    claude: normalizeProviderSessionDefaults("claude", source.claude),
    codex: normalizeProviderSessionDefaults("codex", source.codex),
  };
}

function mapLegacyHostDefaultsToSessionDefaults(legacyDefaults = {}) {
  const interfaceConfig = isPlainObject(legacyDefaults.interface)
    ? legacyDefaults.interface
    : {};
  return normalizeSessionDefaults({
    default_provider:
      normalizeString(interfaceConfig.provider) ||
      normalizeString(legacyDefaults.provider),
    interface_type:
      normalizeString(interfaceConfig.type) ||
      normalizeString(legacyDefaults.interface_type),
    web: legacyDefaults.web,
    notifications: legacyDefaults.notifications,
    runtime_capabilities:
      legacyDefaults.runtime_capabilities ?? legacyDefaults.runtimeCapabilities,
    claude: legacyDefaults.claude,
    codex: legacyDefaults.codex,
  });
}

function serializeConfig(config) {
  return JSON.stringify(config, null, 2) + "\n";
}

function normalizeCloudBackendUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function normalizeCloudBackendStage(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return CLOUD_BACKEND_STAGE_OPTIONS.includes(normalized)
    ? normalized
    : PRODUCT_CLOUD_BACKEND_STAGE;
}

function normalizeCloudIdentity(source = {}) {
  const identity = isPlainObject(source) ? source : {};
  const deviceId =
    normalizeString(identity.device_id) || normalizeString(identity.host_id);
  const deviceToken =
    normalizeString(identity.device_token) ||
    normalizeString(identity.host_credential);
  const backendUrl = normalizeCloudBackendUrl(identity.backend_url);
  const normalized = {
    version: 1,
  };
  if (backendUrl && backendUrl !== PRODUCT_CLOUD_BACKEND_URL) {
    normalized.backend_url = backendUrl;
  }
  if (deviceId) {
    normalized.device_id = deviceId;
    normalized.host_id = deviceId;
  }
  if (deviceToken) {
    normalized.device_token = deviceToken;
    normalized.host_credential = deviceToken;
  }
  for (const key of [
    "registered_at",
    "cloud_registration_state",
    "onboarding_token",
    "onboarding_url",
    "device_signing_public_key",
    "device_signing_kid",
    "cloud_public_key",
  ]) {
    const value = normalizeString(identity[key]);
    if (value) normalized[key] = value;
  }
  if (deviceId && deviceToken && !normalized.cloud_registration_state) {
    normalized.cloud_registration_state = "registered";
  }
  return normalized;
}

function hasCloudIdentityValue(identity = {}) {
  return [
    "backend_url",
    "device_id",
    "device_token",
    "registered_at",
    "cloud_registration_state",
    "onboarding_token",
    "onboarding_url",
    "device_signing_public_key",
    "device_signing_kid",
    "cloud_public_key",
  ].some((key) => normalizeString(identity[key]));
}

export function getCloudIdentityPath() {
  return getResolvedCloudIdentityPath();
}

export function readCloudIdentity() {
  const configPath = getResolvedCloudIdentityPath();
  if (!existsSync(configPath)) return {};
  const parsed = readOptionalObjectFile(configPath, "Host Cloud identity");
  return normalizeCloudIdentity(parsed);
}

export function writeCloudIdentity(updates = {}) {
  if (!isPlainObject(updates)) {
    throw new Error("cloud identity updates must be an object");
  }
  const current = readCloudIdentity();
  const merged = normalizeCloudIdentity({
    ...current,
    ...updates,
  });
  if (!hasCloudIdentityValue(merged)) {
    rmSync(getResolvedCloudIdentityPath(), { force: true });
    return {};
  }
  mkdirSync(getConfigDir(), { recursive: true });
  writeAtomicTextFile(getResolvedCloudIdentityPath(), serializeConfig(merged));
  return merged;
}

export function clearCloudIdentity() {
  rmSync(getResolvedCloudIdentityPath(), { force: true });
  return {};
}

function extractCloudIdentityUpdates(updates = {}) {
  const cloudIdentityUpdates = {};
  const runtimeUpdates = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (CLOUD_IDENTITY_KEY_SET.has(key)) {
      cloudIdentityUpdates[key] = value;
    } else {
      runtimeUpdates[key] = value;
    }
  }
  return {
    cloudIdentityUpdates,
    runtimeUpdates,
    hasCloudIdentityUpdates: Object.keys(cloudIdentityUpdates).length > 0,
    hasRuntimeUpdates: Object.keys(runtimeUpdates).length > 0,
  };
}

function migrateLegacyCloudIdentityFromConfig(config = {}) {
  if (!isPlainObject(config)) return;
  const hasLegacyToken =
    normalizeString(config.device_token) ||
    normalizeString(config.host_credential);
  const hasLegacyHost =
    normalizeString(config.device_id) || normalizeString(config.host_id);
  const hasCloudMaterial =
    hasLegacyToken ||
    hasLegacyHost ||
    normalizeString(config.onboarding_url) ||
    normalizeString(config.device_signing_public_key) ||
    normalizeString(config.registered_at);
  if (!hasCloudMaterial) return;

  const existingIdentity = readCloudIdentity();
  if (hasCloudIdentityValue(existingIdentity)) return;
  writeCloudIdentity({
    backend_url: hasLegacyToken ? config.backend_url : null,
    host_id: config.host_id,
    host_credential: config.host_credential,
    device_id: config.device_id,
    device_token: config.device_token,
    registered_at: config.registered_at,
    cloud_registration_state: hasLegacyToken ? "registered" : "unregistered",
    onboarding_token: config.onboarding_token,
    onboarding_url: config.onboarding_url,
    device_signing_public_key: config.device_signing_public_key,
    device_signing_kid: config.device_signing_kid,
    cloud_public_key: config.cloud_public_key,
  });
}

export function resolveCloudBackendUrl(config = null) {
  const envBackendUrl = normalizeCloudBackendUrl(process.env.OYSTERUN_BACKEND_URL);
  if (envBackendUrl) return envBackendUrl;
  const identityBackendUrl = normalizeCloudBackendUrl(
    readCloudIdentity().backend_url
  );
  if (identityBackendUrl) return identityBackendUrl;
  if (config && isPlainObject(config)) {
    const configBackendUrl = normalizeCloudBackendUrl(config.backend_url);
    if (configBackendUrl && configBackendUrl !== PRODUCT_CLOUD_BACKEND_URL) {
      return configBackendUrl;
    }
  }
  return PRODUCT_CLOUD_BACKEND_URL;
}

export function resolveCloudBackendStage(config = null) {
  const envStage = normalizeString(process.env.OYSTERUN_CLOUD_BACKEND_STAGE);
  if (envStage) return normalizeCloudBackendStage(envStage);
  const debugStage = normalizeString(readDebugConfig().debug_cloud_backend_stage);
  if (debugStage) return normalizeCloudBackendStage(debugStage);
  if (config && isPlainObject(config)) {
    return normalizeCloudBackendStage(config.debug_cloud_backend_stage);
  }
  return PRODUCT_CLOUD_BACKEND_STAGE;
}

export function buildCloudApiUrl(backendUrl, apiPath, stage = resolveCloudBackendStage()) {
  const normalizedBackendUrl = normalizeCloudBackendUrl(backendUrl);
  if (!normalizedBackendUrl) {
    throw new Error("Cloud backend URL is required");
  }
  const normalizedPath =
    typeof apiPath === "string" && apiPath.startsWith("/")
      ? apiPath
      : `/${String(apiPath || "").replace(/^\/+/, "")}`;
  const url = new URL(normalizedPath, `${normalizedBackendUrl}/`);
  const normalizedStage = normalizeCloudBackendStage(stage);
  if (normalizedStage !== PRODUCT_CLOUD_BACKEND_STAGE) {
    url.searchParams.set(CLOUD_BACKEND_STAGE_QUERY_PARAM, normalizedStage);
  }
  return url.toString();
}

export function resolveCloudDeliveryConfig(config = readConfig()) {
  const identity = readCloudIdentity();
  const backendUrl = resolveCloudBackendUrl(config);
  const deviceId =
    normalizeString(process.env.OYSTERUN_DEVICE_ID) ||
    normalizeString(config?.host_id) ||
    normalizeString(config?.device_id) ||
    normalizeString(identity.host_id) ||
    normalizeString(identity.device_id);
  const deviceToken =
    normalizeString(process.env.OYSTERUN_DEVICE_TOKEN) ||
    normalizeString(config?.host_credential) ||
    normalizeString(config?.device_token) ||
    normalizeString(identity.host_credential) ||
    normalizeString(identity.device_token);
  if (!backendUrl || !deviceId || !deviceToken) return null;
  return {
    backendUrl,
    backendStage: resolveCloudBackendStage(config),
    deviceId,
    deviceToken,
  };
}

function getDebugConfigDefaults() {
  const defaults = {};
  for (const key of DEBUG_CONFIG_KEYS) {
    defaults[key] = cloneValue(DEFAULT_CONFIG[key]);
  }
  return defaults;
}

function normalizeDebugBooleanField(value, fieldPath, fallback) {
  if (value === undefined || value === null) return fallback === true;
  if (typeof value !== "boolean") {
    throw new Error(`${fieldPath} must be boolean in config.debug.json`);
  }
  return value === true;
}

function normalizeAllowedPathDebugConfig(
  value,
  fallback = DEFAULT_ALLOWED_PATH_DEBUG_CONFIG
) {
  const base = isPlainObject(fallback)
    ? fallback
    : DEFAULT_ALLOWED_PATH_DEBUG_CONFIG;
  if (value === undefined || value === null) {
    return {
      disabled: base.disabled !== false,
      debug_ui_enabled: base.debug_ui_enabled === true,
    };
  }
  if (!isPlainObject(value)) {
    throw new Error("allowed_path must be an object in config.debug.json");
  }
  const allowedKeys = new Set(["disabled", "debug_ui_enabled"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported config.debug.json key: allowed_path.${key}`);
    }
  }
  return {
    disabled: normalizeDebugBooleanField(
      value.disabled,
      "allowed_path.disabled",
      base.disabled
    ),
    debug_ui_enabled: normalizeDebugBooleanField(
      value.debug_ui_enabled,
      "allowed_path.debug_ui_enabled",
      base.debug_ui_enabled
    ),
  };
}

function normalizeProviderPermissionDebugConfig(
  value,
  fallback = DEFAULT_PROVIDER_PERMISSION_DEBUG_CONFIG
) {
  const base = isPlainObject(fallback)
    ? fallback
    : DEFAULT_PROVIDER_PERMISSION_DEBUG_CONFIG;
  if (value === undefined || value === null) {
    return {
      debug_mode_dropdown_enable:
        base.debug_mode_dropdown_enable === true,
    };
  }
  if (!isPlainObject(value)) {
    throw new Error("provider_permission must be an object in config.debug.json");
  }
  const allowedKeys = new Set(["debug_mode_dropdown_enable"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `Unsupported config.debug.json key: provider_permission.${key}`
      );
    }
  }
  return {
    debug_mode_dropdown_enable: normalizeDebugBooleanField(
      value.debug_mode_dropdown_enable,
      "provider_permission.debug_mode_dropdown_enable",
      base.debug_mode_dropdown_enable
    ),
  };
}

function normalizeDebugConfigValue(key, value, fallback = DEFAULT_CONFIG[key]) {
  if (key === "allowed_path") {
    return normalizeAllowedPathDebugConfig(value, fallback);
  }
  if (key === "provider_permission") {
    return normalizeProviderPermissionDebugConfig(value, fallback);
  }
  if (key === "debug_cloud_backend_stage") {
    return normalizeCloudBackendStage(value ?? fallback);
  }
  if (key === "debug_dashboard_session_ttl_hours") {
    return normalizeDebugDashboardSessionTtlHours(value, fallback);
  }
  if (key === "debug_routec_facade_token_ttl_ms") {
    return normalizeDebugRouteCFacadeTokenTtlMs(value, fallback);
  }
  if (
    key === "debug_routec_facade_transcript_max_bytes" ||
    key === "debug_routec_facade_transcript_max_files"
  ) {
    return normalizePositiveIntegerWithDefault(value, fallback);
  }
  return normalizeBooleanWithDefault(value, fallback);
}

export function normalizeDebugConfig(config, options = {}) {
  if (!isPlainObject(config)) {
    throw new Error(
      `Invalid debug host config root object in ${getResolvedDebugConfigPath()}`
    );
  }

  const includeDefaults = options.includeDefaults !== false;
  const normalized = includeDefaults ? getDebugConfigDefaults() : {};
  for (const key of Object.keys(config)) {
    if (key === LEGACY_TELEGRAM_PRODUCT_FLAG_KEY) continue;
    if (!DEBUG_CONFIG_KEY_SET.has(key)) {
      throw new Error(`Unsupported config.debug.json key: ${key}`);
    }
    normalized[key] = normalizeDebugConfigValue(
      key,
      config[key],
      DEFAULT_CONFIG[key]
    );
  }
  return normalized;
}

function readDebugConfigOverrides() {
  const debugConfigPath = getResolvedDebugConfigPath();
  if (!existsSync(debugConfigPath)) return {};
  return normalizeDebugConfig(
    readOptionalObjectFile(debugConfigPath, "debug host config"),
    { includeDefaults: false }
  );
}

export function readDebugConfig() {
  const debugConfigPath = getResolvedDebugConfigPath();
  if (!existsSync(debugConfigPath)) return getDebugConfigDefaults();
  return normalizeDebugConfig(
    readOptionalObjectFile(debugConfigPath, "debug host config")
  );
}

export function writeDebugConfig(updates) {
  if (!isPlainObject(updates)) {
    throw new Error("config.debug.json updates must be an object");
  }
  const merged = normalizeDebugConfig({
    ...readDebugConfig(),
    ...updates,
  });
  mkdirSync(getConfigDir(), { recursive: true });
  writeAtomicTextFile(getResolvedDebugConfigPath(), serializeConfig(merged));
  syncDebugLargeToolSpilloverProviderEnv(merged);
  return merged;
}

function splitDebugConfigUpdates(updates = {}) {
  const debugUpdates = {};
  const runtimeUpdates = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (DEBUG_CONFIG_KEY_SET.has(key)) {
      debugUpdates[key] = value;
    } else {
      runtimeUpdates[key] = value;
    }
  }
  return {
    debugUpdates,
    runtimeUpdates,
    hasDebugUpdates: Object.keys(debugUpdates).length > 0,
    hasRuntimeUpdates: Object.keys(runtimeUpdates).length > 0,
  };
}

export function mergeRuntimeConfigWithDebugOverrides(
  runtimeConfig,
  debugOverrides = readDebugConfigOverrides()
) {
  if (!isPlainObject(runtimeConfig)) {
    throw new Error("runtime config must be an object");
  }
  const normalizedDebugOverrides = normalizeDebugConfig(debugOverrides, {
    includeDefaults: false,
  });
  const merged = {
    ...runtimeConfig,
    ...normalizedDebugOverrides,
  };
  syncDebugLargeToolSpilloverProviderEnv(merged);
  return merged;
}

function normalizeConfigForStorage(config, existingRawConfig = {}) {
  const storedConfig = { ...config };
  for (const key of DEBUG_CONFIG_KEYS) {
    delete storedConfig[key];
  }
  for (const key of CLOUD_IDENTITY_KEYS) {
    delete storedConfig[key];
  }
  if (isPlainObject(existingRawConfig)) {
    for (const key of LEGACY_RUNTIME_DEBUG_CONFIG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(existingRawConfig, key)) {
        storedConfig[key] = config[key];
      }
    }
  }
  return storedConfig;
}

function writeConfigFile(config, existingRawConfig = {}) {
  mkdirSync(getConfigDir(), { recursive: true });
  writeAtomicTextFile(
    getResolvedConfigPath(),
    serializeConfig(normalizeConfigForStorage(config, existingRawConfig))
  );
}

function normalizeConfig(config) {
  if (!isPlainObject(config)) {
    throw new Error(`Invalid config format: ${getResolvedConfigPath()}`);
  }
  const migrated = !isPlainObject(config.session_defaults)
    ? (() => {
        const legacyDefaults = readOptionalObjectFile(
          getResolvedLegacyDefaultAgentConfigPath(),
          "legacy host default agent config"
        );
        if (!Object.keys(legacyDefaults).length) {
          return config;
        }
        return {
          ...config,
          session_defaults:
            mapLegacyHostDefaultsToSessionDefaults(legacyDefaults),
        };
      })()
    : config;

  const migratedCredentialConfig = { ...migrated };
  delete migratedCredentialConfig.routec_facade_transcript_bounded_logging_enabled;
  delete migratedCredentialConfig.apns_key_path;
  delete migratedCredentialConfig.apns_key_id;
  delete migratedCredentialConfig.apns_team_id;
  delete migratedCredentialConfig.apns_default_topic;
  delete migratedCredentialConfig.apns_default_environment;
  delete migratedCredentialConfig.dashboard_session_ttl_hours;
  delete migratedCredentialConfig.capacitor_app_id;
  delete migratedCredentialConfig.capacitor_app_name;
  delete migratedCredentialConfig.allowed_path;
  delete migratedCredentialConfig.provider_permission;
  delete migratedCredentialConfig[LEGACY_TELEGRAM_PRODUCT_FLAG_KEY];
  const cloudIdentity = readCloudIdentity();
  for (const key of CLOUD_IDENTITY_KEYS) {
    delete migratedCredentialConfig[key];
  }
  const legacyDashboardPassword =
    typeof migratedCredentialConfig.dashboard_password === "string" &&
    migratedCredentialConfig.dashboard_password.trim()
      ? migratedCredentialConfig.dashboard_password
      : null;
  const dashboardPasswordHash =
    normalizeDashboardPasswordHash(
      migratedCredentialConfig.dashboard_password_hash
    ) ||
    (legacyDashboardPassword
      ? hashDashboardPassword(legacyDashboardPassword)
      : null);
  delete migratedCredentialConfig.dashboard_password;
  const normalizedHostId =
    normalizeString(cloudIdentity.host_id) ||
    normalizeString(cloudIdentity.device_id);
  const normalizedHostCredential =
    normalizeString(cloudIdentity.host_credential) ||
    normalizeString(cloudIdentity.device_token);
  const normalizedDirectHostUrl = normalizeStoredPublicBaseUrl(
    migratedCredentialConfig.direct_host_url ||
      migratedCredentialConfig.public_base_url
  );
  const normalizedPublicBaseUrl = normalizeStoredPublicBaseUrl(
    migratedCredentialConfig.public_base_url ||
      migratedCredentialConfig.direct_host_url
  );

  return {
    ...DEFAULT_CONFIG,
    ...migratedCredentialConfig,
    backend_url: resolveCloudBackendUrl(),
    connection_mode: normalizeConnectionMode(
      migratedCredentialConfig.connection_mode
    ),
    public_base_url: normalizedPublicBaseUrl,
    direct_host_url: normalizedDirectHostUrl,
    host_id: normalizedHostId,
    host_credential: normalizedHostCredential,
    device_id: normalizedHostId,
    device_token: normalizedHostCredential,
    dashboard_user: normalizeString(migratedCredentialConfig.dashboard_user),
    dashboard_password_hash: dashboardPasswordHash,
    claude_command: normalizeProviderCommand(
      migratedCredentialConfig.claude_command,
      "claude"
    ),
    codex_command: normalizeProviderCommand(
      migratedCredentialConfig.codex_command,
      "codex"
    ),
    default_browse_path: normalizeDefaultBrowsePathConfigValue(
      migratedCredentialConfig.default_browse_path
    ),
    show_hidden_files: normalizeBooleanWithDefault(
      migratedCredentialConfig.show_hidden_files,
      DEFAULT_CONFIG.show_hidden_files
    ),
    notification_sound_web_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.notification_sound_web_enabled,
      DEFAULT_CONFIG.notification_sound_web_enabled
    ),
    notification_sound_app_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.notification_sound_app_enabled,
      DEFAULT_CONFIG.notification_sound_app_enabled
    ),
    daily_telemetry_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.daily_telemetry_enabled,
      DEFAULT_CONFIG.daily_telemetry_enabled
    ),
    daily_telemetry_consent_recorded_at: normalizeString(
      migratedCredentialConfig.daily_telemetry_consent_recorded_at
    ),
    debug_fixture_provider_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_fixture_provider_enabled,
      DEFAULT_CONFIG.debug_fixture_provider_enabled
    ),
    debug_show_capability_ui: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_show_capability_ui,
      DEFAULT_CONFIG.debug_show_capability_ui
    ),
    show_interface_style_in_session_setup_profile:
      normalizeBooleanWithDefault(
        migratedCredentialConfig.show_interface_style_in_session_setup_profile,
        DEFAULT_CONFIG.show_interface_style_in_session_setup_profile
      ),
    debug_host_artifact_writes_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_host_artifact_writes_enabled,
      DEFAULT_CONFIG.debug_host_artifact_writes_enabled
    ),
    debug_apns_runtime_observability_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_apns_runtime_observability_enabled,
      DEFAULT_CONFIG.debug_apns_runtime_observability_enabled
    ),
    debug_routec_facade_transcript_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_routec_facade_transcript_enabled,
      DEFAULT_CONFIG.debug_routec_facade_transcript_enabled
    ),
    debug_routec_auth_loss_diagnostics_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_routec_auth_loss_diagnostics_enabled,
      DEFAULT_CONFIG.debug_routec_auth_loss_diagnostics_enabled
    ),
    debug_routec_runtime_proof_artifacts_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_routec_runtime_proof_artifacts_enabled,
      DEFAULT_CONFIG.debug_routec_runtime_proof_artifacts_enabled
    ),
    debug_routec_chat_liveness_diagnostics_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_routec_chat_liveness_diagnostics_enabled,
      DEFAULT_CONFIG.debug_routec_chat_liveness_diagnostics_enabled
    ),
    debug_routec_tool_detail_source_ui_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.debug_routec_tool_detail_source_ui_enabled,
      DEFAULT_CONFIG.debug_routec_tool_detail_source_ui_enabled
    ),
    debug_routec_facade_transcript_rotation_enabled:
      normalizeBooleanWithDefault(
        migratedCredentialConfig.debug_routec_facade_transcript_rotation_enabled,
        DEFAULT_CONFIG.debug_routec_facade_transcript_rotation_enabled
      ),
    debug_routec_facade_transcript_max_bytes: normalizePositiveIntegerWithDefault(
      migratedCredentialConfig.debug_routec_facade_transcript_max_bytes,
      DEFAULT_CONFIG.debug_routec_facade_transcript_max_bytes
    ),
    debug_routec_facade_transcript_max_files: normalizePositiveIntegerWithDefault(
      migratedCredentialConfig.debug_routec_facade_transcript_max_files,
      DEFAULT_CONFIG.debug_routec_facade_transcript_max_files
    ),
    debug_host_preferences_full_disk_access_block_enabled:
      normalizeBooleanWithDefault(
        migratedCredentialConfig.debug_host_preferences_full_disk_access_block_enabled,
        DEFAULT_CONFIG.debug_host_preferences_full_disk_access_block_enabled
      ),
    debug_cloud_backend_stage: normalizeCloudBackendStage(
      migratedCredentialConfig.debug_cloud_backend_stage
    ),
    allowed_path: normalizeAllowedPathDebugConfig(
      migratedCredentialConfig.allowed_path,
      DEFAULT_CONFIG.allowed_path
    ),
    provider_permission: normalizeProviderPermissionDebugConfig(
      migratedCredentialConfig.provider_permission,
      DEFAULT_CONFIG.provider_permission
    ),
    routec_matrix_storage_cache_enabled: normalizeBooleanWithDefault(
      migratedCredentialConfig.routec_matrix_storage_cache_enabled,
      DEFAULT_CONFIG.routec_matrix_storage_cache_enabled
    ),
    routec_matrix_sync_idle_long_poll_timeout_ms:
      normalizePositiveIntegerWithDefault(
        migratedCredentialConfig.routec_matrix_sync_idle_long_poll_timeout_ms,
        DEFAULT_CONFIG.routec_matrix_sync_idle_long_poll_timeout_ms
      ),
    routec_matrix_sync_active_coalesce_ms: normalizePositiveIntegerWithDefault(
      migratedCredentialConfig.routec_matrix_sync_active_coalesce_ms,
      DEFAULT_CONFIG.routec_matrix_sync_active_coalesce_ms
    ),
    transcript_retention_days: normalizeTranscriptRetentionDays(
      migratedCredentialConfig.transcript_retention_days
    ),
    display_name: normalizeDisplayName(migratedCredentialConfig.display_name),
    onboarding_token: normalizeString(cloudIdentity.onboarding_token),
    onboarding_url: normalizeString(cloudIdentity.onboarding_url),
    registered_at: normalizeString(cloudIdentity.registered_at),
    device_signing_public_key: normalizeString(
      cloudIdentity.device_signing_public_key
    ),
    device_signing_kid: normalizeString(cloudIdentity.device_signing_kid),
    cloud_public_key: normalizeString(cloudIdentity.cloud_public_key),
    cloud_registration_state: normalizeString(
      cloudIdentity.cloud_registration_state
    ),
    session_defaults: migrateStaleSessionDefaults(
      normalizeSessionDefaults(migratedCredentialConfig.session_defaults)
    ),
  };
}

export function normalizePublicBaseUrlInput(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Public Host URL must be a string or null");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(
      `Public Host URL must be a valid http or https URL: ${trimmed}`
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Public Host URL must use http or https");
  }

  if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
    return parsed.origin;
  }

  return parsed.toString();
}

export function getDefaultConfig() {
  return normalizeConfig(cloneValue(DEFAULT_CONFIG));
}

export function getDefaultSessionDefaults() {
  return cloneValue(DEFAULT_SESSION_DEFAULTS);
}

export function getDefaultSharedAllowedPaths() {
  return cloneValue(DEFAULT_SHARED_ALLOWED_PATHS);
}

export function getDefaultHostDisplayName() {
  return DEFAULT_HOST_DISPLAY_NAME;
}

export function getDirectSetupDefaults() {
  return {
    ...getDefaultConfig(),
    ...cloneValue(DIRECT_SETUP_DEFAULTS),
  };
}

export function getConfigPath() {
  return getResolvedConfigPath();
}

export function getDebugConfigPath() {
  return getResolvedDebugConfigPath();
}

export function getLegacyDefaultAgentConfigPath() {
  return getResolvedLegacyDefaultAgentConfigPath();
}

export function readRawConfigSource() {
  const configPath = getResolvedConfigPath();
  return readOptionalObjectFile(configPath, "host config");
}

/**
 * Read the local config. Auto-creates ~/.oysterun/config.json when missing
 * and backfills newly introduced keys into older config files.
 */
export function readConfig() {
  const configPath = getResolvedConfigPath();
  if (!existsSync(configPath)) {
    const defaults = getDefaultConfig();
    writeConfigFile(defaults, {});
    return mergeRuntimeConfigWithDebugOverrides(defaults);
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseRequiredConfigJson(raw, configPath, "host config");
  migrateLegacyCloudIdentityFromConfig(parsed);
  let normalized;
  try {
    normalized = normalizeConfig(parsed);
  } catch (err) {
    throw new Error(`Invalid host config ${configPath}: ${err.message}`);
  }
  const normalizedForStorage = normalizeConfigForStorage(normalized, parsed);
  if (serializeConfig(parsed) !== serializeConfig(normalizedForStorage)) {
    writeConfigFile(normalized, parsed);
  }
  return mergeRuntimeConfigWithDebugOverrides(normalized);
}

/**
 * Write (merge) values into the local config.
 */
export function writeConfig(updates) {
  if (!isPlainObject(updates)) {
    throw new Error("config updates must be an object");
  }
  const {
    debugUpdates,
    runtimeUpdates: runtimeUpdatesWithCloudIdentity,
    hasDebugUpdates,
  } = splitDebugConfigUpdates(updates);
  if (hasDebugUpdates) {
    writeDebugConfig(debugUpdates);
  }
  const {
    cloudIdentityUpdates,
    runtimeUpdates,
    hasCloudIdentityUpdates,
    hasRuntimeUpdates,
  } = extractCloudIdentityUpdates(runtimeUpdatesWithCloudIdentity);
  if (hasCloudIdentityUpdates) {
    writeCloudIdentity(cloudIdentityUpdates);
  }

  const rawRuntimeConfig = readRawConfigSource();
  const currentRuntimeConfig = existsSync(getResolvedConfigPath())
    ? normalizeConfig(rawRuntimeConfig)
    : getDefaultConfig();
  let mergedRuntimeConfig = currentRuntimeConfig;
  if (hasRuntimeUpdates || !existsSync(getResolvedConfigPath())) {
    mergedRuntimeConfig = normalizeConfig({
      ...currentRuntimeConfig,
      ...runtimeUpdates,
      session_defaults: Object.prototype.hasOwnProperty.call(
        runtimeUpdates,
        "session_defaults"
      )
        ? runtimeUpdates.session_defaults
        : currentRuntimeConfig.session_defaults,
    });
    writeConfigFile(mergedRuntimeConfig, rawRuntimeConfig);
  }
  return readConfig();
}

/**
 * Get a single config value, with optional env var override.
 * Env var takes precedence over stored config.
 */
export function getConfigValue(key, envVar) {
  if (envVar && process.env[envVar]) return process.env[envVar];
  if (key === "backend_url") return resolveCloudBackendUrl();
  const config = readConfig();
  return config[key] ?? null;
}

function buildDirectoryError(label, suffix, resolvedPath) {
  if (label === "Path") {
    return `${label} ${suffix}: ${resolvedPath}`;
  }
  return `${label} ${suffix}: ${resolvedPath}`;
}

export function resolveDirectoryPath(rawPath, label = "Path") {
  const requested = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!requested) {
    throw new Error(`${label} required`);
  }
  const resolvedPath = resolve(requested);
  const stats = statSync(resolvedPath, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error(buildDirectoryError(label, "does not exist", resolvedPath));
  }
  if (!stats.isDirectory()) {
    throw new Error(
      buildDirectoryError(label, "is not a directory", resolvedPath)
    );
  }
  return realpathSync(resolvedPath);
}

export async function resolveDirectoryPathAsync(rawPath, label = "Path") {
  const requested = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!requested) {
    throw new Error(`${label} required`);
  }
  const resolvedPath = resolve(requested);
  const stats = await statAsync(resolvedPath).catch((err) => {
    if (err?.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  if (!stats) {
    throw new Error(buildDirectoryError(label, "does not exist", resolvedPath));
  }
  if (!stats.isDirectory()) {
    throw new Error(
      buildDirectoryError(label, "is not a directory", resolvedPath)
    );
  }
  return realpathAsync(resolvedPath);
}

export function resolveHomePath() {
  return realpathSync(homedir());
}

export async function resolveHomePathAsync() {
  return realpathAsync(homedir());
}

export function deriveDefaultBrowseRootPath(configDir = getConfigDir()) {
  void configDir;
  return deriveProductDefaultBrowsePath();
}

export function resolveBuiltInDefaultBrowsePath() {
  return ensureProductDefaultBrowsePath();
}

export async function resolveBuiltInDefaultBrowsePathAsync() {
  const defaultRoot = deriveDefaultBrowseRootPath();
  await mkdirAsync(defaultRoot, { recursive: true });
  return realpathAsync(defaultRoot);
}

export function resolveDefaultBrowsePath() {
  const configured = getConfigValue(
    "default_browse_path",
    "OYSTERUN_DEFAULT_BROWSE_PATH"
  );
  if (
    configured === null ||
    configured === undefined ||
    String(configured).trim() === ""
  ) {
    return resolveBuiltInDefaultBrowsePath();
  }
  return resolveDirectoryPath(
    String(configured),
    "Configured default browse path"
  );
}

export async function resolveDefaultBrowsePathAsync() {
  const configured = getConfigValue(
    "default_browse_path",
    "OYSTERUN_DEFAULT_BROWSE_PATH"
  );
  if (
    configured === null ||
    configured === undefined ||
    String(configured).trim() === ""
  ) {
    return resolveBuiltInDefaultBrowsePathAsync();
  }
  return resolveDirectoryPathAsync(
    String(configured),
    "Configured default browse path"
  );
}
