import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute, join, normalize, resolve } from "path";
import {
  getConfigPath,
  getDefaultProviderModel,
  getDefaultProviderPermissionPolicy,
  getDefaultProviderReasoningEffort,
  getDefaultSharedAllowedPaths,
  isProviderPermissionDebugModeEnabled,
  normalizeClaudePermissionMode,
  normalizeConfiguredCodexApprovalPolicy,
  normalizeProviderModel,
  normalizeProviderPermissionPolicy,
  normalizeProviderReasoningEffort,
  readRawConfigSource,
  readConfig,
} from "./config.mjs";
import {
  isDebugFixtureProviderEnabled,
  requireProvider,
} from "./provider-registry.mjs";

const LOCAL_INTERFACE_KEYS = new Set([
  "provider_profile",
  "provider_args",
  "provider_commands",
  "provider_config_overrides",
]);
const LOCAL_PERMISSION_KEYS = new Set(["local_allowed_paths"]);
const LOCAL_WEB_KEYS = new Set(["password"]);
const SHARED_WEB_KEYS = new Set(["root", "access", "enabled"]);
const SHARED_NOTIFICATION_KEYS = new Set(["enabled"]);
const LOCAL_TELEGRAM_KEYS = new Set(["bot_token", "allowed_users"]);
const SHARED_TELEGRAM_KEYS = new Set(["enabled", "send_tool_messages"]);
const SYSTEM_ROOT_PATH = realpathSync("/");
const DEFAULT_AGENT_WEB_ROOT = ".oysterun/site";
const DEFAULT_AGENT_WEB_ACCESS = "owner_only";
export const AGENT_CONFIG_DIRNAME = ".oysterun";
export const AGENT_SHARED_CONFIG_FILENAME = "config.json";
export const AGENT_LOCAL_CONFIG_FILENAME = "local.json";
export const AGENT_SITE_DIRNAME = "site";
export const LEGACY_AGENT_LOCAL_CONFIG_FILENAME = ".oysterun.local";
const AGENT_WEB_ACCESS_VALUES = new Set(["owner_only", "password", "public"]);
function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeObjects(base = {}, overlay = {}) {
  const merged = isPlainObject(base) ? cloneValue(base) : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      const existing = isPlainObject(merged[key]) ? merged[key] : {};
      merged[key] = mergeObjects(existing, value);
      continue;
    }
    merged[key] = cloneValue(value);
  }
  return merged;
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

export function validateSharedAgentConfig(sharedConfig, configPath) {
  const webConfig = sharedConfig.web ?? {};
  if (!isPlainObject(webConfig)) {
    throw new Error(`Invalid web object in ${configPath}`);
  }
  for (const key of Object.keys(webConfig)) {
    if (!SHARED_WEB_KEYS.has(key)) {
      throw new Error(`Forbidden private web key in ${configPath}: web.${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(webConfig, "root")) {
    if (typeof webConfig.root !== "string" || !webConfig.root.trim()) {
      throw new Error(`web.root must be a non-empty string in ${configPath}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(webConfig, "access")) {
    const access = normalizeString(webConfig.access);
    if (!access || !AGENT_WEB_ACCESS_VALUES.has(access)) {
      throw new Error(
        `web.access must be one of ${[...AGENT_WEB_ACCESS_VALUES].join(
          ", "
        )} in ${configPath}`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(webConfig, "enabled")) {
    if (typeof webConfig.enabled !== "boolean") {
      throw new Error(`web.enabled must be boolean in ${configPath}`);
    }
  }

  const notificationConfig = sharedConfig.notifications ?? {};
  if (!isPlainObject(notificationConfig)) {
    throw new Error(`Invalid notifications object in ${configPath}`);
  }
  for (const key of Object.keys(notificationConfig)) {
    if (!SHARED_NOTIFICATION_KEYS.has(key)) {
      throw new Error(
        `Unsupported notifications key in ${configPath}: notifications.${key}`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(notificationConfig, "enabled")) {
    if (typeof notificationConfig.enabled !== "boolean") {
      throw new Error(`notifications.enabled must be boolean in ${configPath}`);
    }
  }

  const telegramConfig = sharedConfig.telegram ?? {};
  if (!isPlainObject(telegramConfig)) {
    throw new Error(`Invalid telegram object in ${configPath}`);
  }
  for (const key of Object.keys(telegramConfig)) {
    if (LOCAL_TELEGRAM_KEYS.has(key)) {
      throw new Error(
        `Forbidden private telegram key in ${configPath}: telegram.${key}`
      );
    }
    if (!SHARED_TELEGRAM_KEYS.has(key)) {
      throw new Error(`Unsupported telegram key in ${configPath}: telegram.${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(telegramConfig, "enabled")) {
    if (typeof telegramConfig.enabled !== "boolean") {
      throw new Error(`telegram.enabled must be boolean in ${configPath}`);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(telegramConfig, "send_tool_messages")
  ) {
    if (typeof telegramConfig.send_tool_messages !== "boolean") {
      throw new Error(
        `telegram.send_tool_messages must be boolean in ${configPath}`
      );
    }
  }
}

export function validateLocalAgentConfig(localConfig, configPath) {
  for (const key of Object.keys(localConfig)) {
    if (
      key !== "interface" &&
      key !== "permissions" &&
      key !== "web" &&
      key !== "telegram"
    ) {
      throw new Error(`Unsupported key in ${configPath}: ${key}`);
    }
  }

  const interfaceConfig = localConfig.interface ?? {};
  if (!isPlainObject(interfaceConfig)) {
    throw new Error(`Invalid interface object in ${configPath}`);
  }
  for (const key of Object.keys(interfaceConfig)) {
    if (!LOCAL_INTERFACE_KEYS.has(key)) {
      throw new Error(
        `Forbidden shared interface key in ${configPath}: interface.${key}`
      );
    }
  }

  const permissions = localConfig.permissions ?? {};
  if (!isPlainObject(permissions)) {
    throw new Error(`Invalid permissions object in ${configPath}`);
  }
  for (const key of Object.keys(permissions)) {
    if (!LOCAL_PERMISSION_KEYS.has(key)) {
      throw new Error(
        `Forbidden shared permission key in ${configPath}: permissions.${key}`
      );
    }
  }

  const webConfig = localConfig.web ?? {};
  if (!isPlainObject(webConfig)) {
    throw new Error(`Invalid web object in ${configPath}`);
  }
  for (const key of Object.keys(webConfig)) {
    if (!LOCAL_WEB_KEYS.has(key)) {
      throw new Error(`Forbidden shared web key in ${configPath}: web.${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(webConfig, "password")) {
    if (typeof webConfig.password !== "string") {
      throw new Error(`web.password must be string in ${configPath}`);
    }
  }

  const telegramConfig = localConfig.telegram ?? {};
  if (!isPlainObject(telegramConfig)) {
    throw new Error(`Invalid telegram object in ${configPath}`);
  }
  for (const key of Object.keys(telegramConfig)) {
    if (SHARED_TELEGRAM_KEYS.has(key)) {
      throw new Error(
        `Forbidden shared telegram key in ${configPath}: telegram.${key}`
      );
    }
    if (!LOCAL_TELEGRAM_KEYS.has(key)) {
      throw new Error(`Unsupported telegram key in ${configPath}: telegram.${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(telegramConfig, "bot_token")) {
    if (typeof telegramConfig.bot_token !== "string") {
      throw new Error(`telegram.bot_token must be string in ${configPath}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(telegramConfig, "allowed_users")) {
    validateTelegramAllowedUsers(telegramConfig.allowed_users, configPath);
  }
}

function isModelCompatibleWithProvider(model, providerId) {
  const normalized = normalizeProviderModel(providerId, model);
  if (!normalized) return false;
  if (providerId === "claude") {
    return true;
  }
  return normalizeProviderModel("claude", normalized) === null;
}

function normalizePathList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeAllowedPathPolicy(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    disabled: source.disabled !== false,
    debugUiEnabled:
      source.debugUiEnabled === true || source.debug_ui_enabled === true,
  };
}

function serializeAllowedPathPolicy(policy = {}) {
  const normalized = normalizeAllowedPathPolicy(policy);
  return {
    disabled: normalized.disabled,
    debug_ui_enabled: normalized.debugUiEnabled,
  };
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTelegramAllowedUsers(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (!normalized.includes(trimmed)) normalized.push(trimmed);
  }
  return normalized;
}

function validateTelegramAllowedUsers(value, configPath) {
  if (!Array.isArray(value)) {
    throw new Error(`telegram.allowed_users must be a string array in ${configPath}`);
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(
        `telegram.allowed_users[${index}] must be a non-empty string in ${configPath}`
      );
    }
  }
}

function normalizeCodexSandboxMode(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "workspacewrite" || lowered === "workspace-write")
    return "workspace-write";
  if (lowered === "readonly" || lowered === "read-only") return "read-only";
  if (lowered === "dangerfullaccess" || lowered === "danger-full-access") {
    return "danger-full-access";
  }
  return lowered;
}

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

function cloneObject(value) {
  return isPlainObject(value) ? cloneValue(value) : {};
}

function normalizeNativeConfig(interfaceConfig = {}) {
  return {
    args: normalizePathList(interfaceConfig.provider_args),
    configOverrides: normalizeObject(interfaceConfig.provider_config_overrides),
    commands: normalizePathList(interfaceConfig.provider_commands),
    profile: normalizeString(interfaceConfig.provider_profile),
  };
}

function buildSanitizedLocalConfig(localConfig = {}) {
  const sanitized = cloneObject(localConfig);
  if (isPlainObject(sanitized.web)) {
    delete sanitized.web.password;
    if (Object.keys(sanitized.web).length === 0) {
      delete sanitized.web;
    }
  }
  if (isPlainObject(sanitized.telegram)) {
    delete sanitized.telegram.bot_token;
    delete sanitized.telegram.allowed_users;
    if (Object.keys(sanitized.telegram).length === 0) {
      delete sanitized.telegram;
    }
  }
  return sanitized;
}

function resolveAgentWebConfigFromLayers(layers) {
  const sharedWeb = normalizeObject(layers?.sharedConfig?.web);
  const localWeb = normalizeObject(layers?.localConfig?.web);
  const root = normalizeString(sharedWeb.root) || DEFAULT_AGENT_WEB_ROOT;
  const access = normalizeString(sharedWeb.access) || DEFAULT_AGENT_WEB_ACCESS;
  if (!AGENT_WEB_ACCESS_VALUES.has(access)) {
    throw new Error(`Unsupported web.access value: ${access}`);
  }
  const password = normalizeString(localWeb.password);
  const siteIndexPaths = [];
  if (typeof layers?.folderPath === "string") {
    siteIndexPaths.push(join(resolve(layers.folderPath, root), "index.html"));
  }
  if (typeof layers?.sitePath === "string") {
    siteIndexPaths.push(join(layers.sitePath, "index.html"));
  }
  const enabled = Object.prototype.hasOwnProperty.call(sharedWeb, "enabled")
    ? sharedWeb.enabled === true
    : siteIndexPaths.some(
        (siteIndexPath) =>
          statSync(siteIndexPath, { throwIfNoEntry: false })?.isFile() === true
      );
  return {
    root,
    access,
    enabled,
    password,
    passwordConfigured: typeof password === "string" && password.length > 0,
  };
}

export function resolveAgentNotificationConfigFromLayers(layers = {}) {
  const sharedNotifications = normalizeObject(layers?.sharedConfig?.notifications);
  return {
    enabled: sharedNotifications.enabled !== false,
    storageOwner: "agent_config_notifications_enabled",
    configKey: "notifications.enabled",
  };
}

export function serializeAgentNotificationConfig(config = {}) {
  const notificationsEnabled = config.enabled !== false;
  return {
    notifications_enabled: notificationsEnabled,
    per_session_notification_enabled: notificationsEnabled,
    storage_owner:
      normalizeString(config.storageOwner) || "agent_config_notifications_enabled",
    config_key: normalizeString(config.configKey) || "notifications.enabled",
    matrix_timeline_owner: false,
    host_transcript_db_owner: false,
    browser_local_storage_owner: false,
    legacy_session_notification_settings_policy_owner: false,
  };
}

export function resolveAgentTelegramConfigFromLayers(layers = {}) {
  const sharedTelegram = normalizeObject(layers?.sharedConfig?.telegram);
  const localTelegram = normalizeObject(layers?.localConfig?.telegram);
  const botToken =
    typeof localTelegram.bot_token === "string" ? localTelegram.bot_token : "";
  const allowedUsers = normalizeTelegramAllowedUsers(
    localTelegram.allowed_users
  );
  return {
    enabled: sharedTelegram.enabled === true,
    sendToolMessages:
      Object.prototype.hasOwnProperty.call(
        sharedTelegram,
        "send_tool_messages"
      )
        ? sharedTelegram.send_tool_messages === true
        : false,
    botToken,
    allowedUsers,
    botTokenConfigured: normalizeString(botToken) !== null,
    allowedUsersConfigured: allowedUsers.length > 0,
    allowedUsersAllowAll: allowedUsers.includes("."),
    allowedUsersCount: allowedUsers.length,
  };
}

export function serializeAgentTelegramConfig(config = {}) {
  const allowedUsers = normalizeTelegramAllowedUsers(config.allowedUsers);
  const botTokenConfigured =
    config.botTokenConfigured === true ||
    normalizeString(config.botToken) !== null;
  const allowedUsersConfigured =
    config.allowedUsersConfigured === true || allowedUsers.length > 0;
  return {
    enabled: config.enabled === true,
    send_tool_messages: config.sendToolMessages === true,
    bot_token_configured: botTokenConfigured,
    allowed_users_configured: allowedUsersConfigured,
    allowed_users_allow_all:
      config.allowedUsersAllowAll === true || allowedUsers.includes("."),
    allowed_users_count: Number.isInteger(config.allowedUsersCount)
      ? config.allowedUsersCount
      : allowedUsers.length,
    bot_token_redacted: botTokenConfigured,
    allowed_users_redacted: allowedUsersConfigured,
  };
}

export function serializeAgentTelegramConfigFromLayers(layers = {}) {
  return serializeAgentTelegramConfig(resolveAgentTelegramConfigFromLayers(layers));
}

function resolveConfiguredProviderId(
  projectConfig,
  hostDefaults,
  overrides = {}
) {
  const providerOptions = {
    includeDebugFixtureProvider:
      hostDefaults?.debugFixtureProviderEnabled === true,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, "provider")) {
    if (typeof overrides.provider !== "string" || !overrides.provider.trim()) {
      throw new Error("provider must be a non-empty string");
    }
    return requireProvider(overrides.provider.trim(), providerOptions).id;
  }

  const interfaceConfig = projectConfig?.interface ?? {};
  if (
    typeof interfaceConfig.provider === "string" &&
    interfaceConfig.provider.trim()
  ) {
    return requireProvider(interfaceConfig.provider.trim(), providerOptions).id;
  }
  if (
    typeof projectConfig?.provider === "string" &&
    projectConfig.provider.trim()
  ) {
    return requireProvider(projectConfig.provider.trim(), providerOptions).id;
  }

  const defaultInterface = hostDefaults?.interface ?? {};
  if (
    typeof defaultInterface.provider === "string" &&
    defaultInterface.provider.trim()
  ) {
    return requireProvider(defaultInterface.provider.trim(), providerOptions)
      .id;
  }
  if (
    typeof hostDefaults?.provider === "string" &&
    hostDefaults.provider.trim()
  ) {
    return requireProvider(hostDefaults.provider.trim(), providerOptions).id;
  }

  return "claude";
}

function buildHostDefaultConfig(hostDefaults, providerId) {
  const config = {};
  const hostProvider =
    normalizeString(hostDefaults?.interface?.provider) ||
    normalizeString(hostDefaults?.provider);
  const hostInterfaceType = normalizeString(hostDefaults?.interface?.type);
  if (hostProvider) {
    config.interface = { provider: hostProvider };
  }
  if (hostInterfaceType) {
    config.interface = {
      ...(config.interface ?? {}),
      type: hostInterfaceType,
    };
  }

  const hostWebDefaults = normalizeObject(hostDefaults?.web);
  if (Object.prototype.hasOwnProperty.call(hostWebDefaults, "access")) {
    config.web = {
      ...(config.web ?? {}),
      access: normalizeString(hostWebDefaults.access) || DEFAULT_AGENT_WEB_ACCESS,
    };
  }

  const hostNotificationDefaults = normalizeObject(hostDefaults?.notifications);
  if (Object.prototype.hasOwnProperty.call(hostNotificationDefaults, "enabled")) {
    config.notifications = {
      ...(config.notifications ?? {}),
      enabled: hostNotificationDefaults.enabled !== false,
    };
  }

  const hostRuntimeCapabilities = normalizeObject(
    hostDefaults?.runtime_capabilities ?? hostDefaults?.runtimeCapabilities
  );
  if (Object.keys(hostRuntimeCapabilities).length > 0) {
    config.runtime_capabilities = {};
    for (const [key, enabled] of Object.entries(hostRuntimeCapabilities)) {
      config.runtime_capabilities[key] = enabled === true;
    }
  }

  const allowedPathPolicy = normalizeAllowedPathPolicy(
    hostDefaults?.allowedPathPolicy
  );
  config.allowed_path_policy = serializeAllowedPathPolicy(allowedPathPolicy);

  const providerDefaults = normalizeObject(hostDefaults?.[providerId]);
  const interfaceDefaults = {};

  if (Object.prototype.hasOwnProperty.call(providerDefaults, "model")) {
    interfaceDefaults.model =
      normalizeProviderModel(providerId, providerDefaults.model) || undefined;
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "reasoning_effort")
  ) {
    interfaceDefaults.reasoning_effort =
      normalizeProviderReasoningEffort(
        providerId,
        providerDefaults.reasoning_effort
      ) || undefined;
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "permission_mode")
  ) {
    interfaceDefaults.permission_mode =
      normalizeClaudePermissionMode(providerDefaults.permission_mode) ||
      undefined;
  }
  if (
    Object.prototype.hasOwnProperty.call(
      providerDefaults,
      "allow_dangerously_skip_permissions"
    )
  ) {
    interfaceDefaults.allow_dangerously_skip_permissions = normalizeBoolean(
      providerDefaults.allow_dangerously_skip_permissions
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "dangerous_mode")
  ) {
    interfaceDefaults.dangerous_mode = normalizeBoolean(
      providerDefaults.dangerous_mode
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "approval_policy")
  ) {
    interfaceDefaults.approval_policy =
      normalizeString(providerDefaults.approval_policy) || undefined;
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "search_enabled")
  ) {
    interfaceDefaults.search_enabled = normalizeBoolean(
      providerDefaults.search_enabled
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(
      providerDefaults,
      "image_input_enabled"
    )
  ) {
    interfaceDefaults.image_input_enabled = normalizeBoolean(
      providerDefaults.image_input_enabled
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "provider_profile")
  ) {
    interfaceDefaults.provider_profile =
      normalizeString(providerDefaults.provider_profile) || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(providerDefaults, "provider_args")) {
    interfaceDefaults.provider_args = normalizePathList(
      providerDefaults.provider_args
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "provider_commands")
  ) {
    interfaceDefaults.provider_commands = normalizePathList(
      providerDefaults.provider_commands
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(
      providerDefaults,
      "provider_config_overrides"
    )
  ) {
    interfaceDefaults.provider_config_overrides = normalizeObject(
      providerDefaults.provider_config_overrides
    );
  }

  if (Object.keys(interfaceDefaults).length > 0) {
    config.interface = {
      ...(config.interface ?? {}),
      ...interfaceDefaults,
    };
  }

  const defaultAllowedPaths = normalizePathList(
    hostDefaults?.permissions?.allowed_paths
  );
  if (defaultAllowedPaths.length > 0) {
    config.permissions = {
      ...(config.permissions ?? {}),
      allowed_paths: defaultAllowedPaths,
    };
  }

  return config;
}

function buildHostDefaultsFromConfig(config = {}) {
  const sessionDefaults = isPlainObject(config?.session_defaults)
    ? config.session_defaults
    : {};
  const configuredDefaultProvider = normalizeString(
    sessionDefaults.default_provider
  );
  return {
    interface: {
      provider: configuredDefaultProvider
        ? requireProvider(configuredDefaultProvider).id
        : "claude",
      type: normalizeString(sessionDefaults.interface_type) || "coding",
    },
    permissions: {
      allowed_paths: getDefaultSharedAllowedPaths(),
    },
    web: normalizeObject(sessionDefaults.web),
    notifications: normalizeObject(sessionDefaults.notifications),
    runtime_capabilities: normalizeObject(sessionDefaults.runtime_capabilities),
    claude: normalizeObject(sessionDefaults.claude),
    codex: normalizeObject(sessionDefaults.codex),
    debugFixtureProviderEnabled: isDebugFixtureProviderEnabled(config),
    providerPermissionDebugModeEnabled:
      isProviderPermissionDebugModeEnabled(config),
    allowedPathPolicy: normalizeAllowedPathPolicy(config?.allowed_path),
  };
}

function buildExplicitHostDefaultConfig(hostConfig, providerId) {
  const sessionDefaults = isPlainObject(hostConfig?.session_defaults)
    ? hostConfig.session_defaults
    : {};
  const providerDefaults = normalizeObject(sessionDefaults?.[providerId]);
  const interfaceDefaults = {};
  const config = {};

  const hostWebDefaults = normalizeObject(sessionDefaults.web);
  if (Object.prototype.hasOwnProperty.call(hostWebDefaults, "access")) {
    config.web = {
      access: normalizeString(hostWebDefaults.access) || DEFAULT_AGENT_WEB_ACCESS,
    };
  }

  const hostNotificationDefaults = normalizeObject(sessionDefaults.notifications);
  if (Object.prototype.hasOwnProperty.call(hostNotificationDefaults, "enabled")) {
    config.notifications = {
      enabled: hostNotificationDefaults.enabled !== false,
    };
  }

  const hostRuntimeCapabilities = normalizeObject(
    sessionDefaults.runtime_capabilities ?? sessionDefaults.runtimeCapabilities
  );
  if (Object.keys(hostRuntimeCapabilities).length > 0) {
    config.runtime_capabilities = {};
    for (const [key, enabled] of Object.entries(hostRuntimeCapabilities)) {
      config.runtime_capabilities[key] = enabled === true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(providerDefaults, "model")) {
    const normalizedModel =
      normalizeProviderModel(providerId, providerDefaults.model) || undefined;
    if (normalizedModel) {
      interfaceDefaults.model = normalizedModel;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "reasoning_effort")
  ) {
    const normalizedReasoningEffort =
      normalizeProviderReasoningEffort(
        providerId,
        providerDefaults.reasoning_effort
      ) || undefined;
    if (normalizedReasoningEffort) {
      interfaceDefaults.reasoning_effort = normalizedReasoningEffort;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "permission_mode")
  ) {
    const normalizedPermissionMode =
      normalizeClaudePermissionMode(providerDefaults.permission_mode) ||
      undefined;
    if (normalizedPermissionMode) {
      interfaceDefaults.permission_mode = normalizedPermissionMode;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "approval_policy")
  ) {
    const normalizedApprovalPolicy =
      normalizeString(providerDefaults.approval_policy) || undefined;
    if (normalizedApprovalPolicy) {
      interfaceDefaults.approval_policy = normalizedApprovalPolicy;
    }
  }
  if (Object.prototype.hasOwnProperty.call(providerDefaults, "sandbox_mode")) {
    const normalizedSandboxMode =
      normalizeCodexSandboxMode(providerDefaults.sandbox_mode) || undefined;
    if (normalizedSandboxMode) {
      interfaceDefaults.sandbox_mode = normalizedSandboxMode;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "provider_profile")
  ) {
    interfaceDefaults.provider_profile =
      normalizeString(providerDefaults.provider_profile) || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(providerDefaults, "provider_args")) {
    interfaceDefaults.provider_args = normalizePathList(
      providerDefaults.provider_args
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(providerDefaults, "provider_commands")
  ) {
    interfaceDefaults.provider_commands = normalizePathList(
      providerDefaults.provider_commands
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(
      providerDefaults,
      "provider_config_overrides"
    )
  ) {
    interfaceDefaults.provider_config_overrides = normalizeObject(
      providerDefaults.provider_config_overrides
    );
  }

  if (Object.keys(interfaceDefaults).length > 0) {
    config.interface = interfaceDefaults;
  }
  return config;
}

function resolveModel(config, overrides, providerId) {
  if (typeof overrides.model === "string" && overrides.model.trim()) {
    const overrideModel = normalizeProviderModel(providerId, overrides.model);
    if (!isModelCompatibleWithProvider(overrideModel, providerId)) {
      throw new Error(
        providerId === "codex"
          ? `Model "${overrideModel}" is not supported for Codex. Use a Codex-compatible model such as "${getDefaultProviderModel(
              "codex"
            )}".`
          : `Model "${overrides.model.trim()}" is not supported for Claude. Use one of: opus, sonnet, haiku.`
      );
    }
    return overrideModel;
  }

  const interfaceConfig = config?.interface ?? {};
  const configuredProvider = resolveConfiguredProviderId(config, {}, {});
  const providerSwitched = configuredProvider !== providerId;

  if (!providerSwitched) {
    if (
      typeof interfaceConfig.model === "string" &&
      interfaceConfig.model.trim()
    ) {
      const configuredModel = normalizeProviderModel(
        providerId,
        interfaceConfig.model
      );
      if (isModelCompatibleWithProvider(configuredModel, providerId)) {
        return configuredModel;
      }
    }
    if (typeof config?.model === "string" && config.model.trim()) {
      const configuredModel = normalizeProviderModel(providerId, config.model);
      if (isModelCompatibleWithProvider(configuredModel, providerId)) {
        return configuredModel;
      }
    }
  }

  return getDefaultProviderModel(providerId);
}

function resolveConfiguredModel(config, providerId) {
  const interfaceConfig = config?.interface ?? {};
  if (
    typeof interfaceConfig.model === "string" &&
    interfaceConfig.model.trim()
  ) {
    const configuredModel = normalizeProviderModel(
      providerId,
      interfaceConfig.model
    );
    if (isModelCompatibleWithProvider(configuredModel, providerId)) {
      return configuredModel;
    }
  }
  if (typeof config?.model === "string" && config.model.trim()) {
    const configuredModel = normalizeProviderModel(providerId, config.model);
    if (isModelCompatibleWithProvider(configuredModel, providerId)) {
      return configuredModel;
    }
  }
  return null;
}

function resolveConfiguredBaseAllowedPaths(config, overrides = {}) {
  const permissions = config?.permissions ?? {};
  const iface = config?.interface ?? {};
  if (Object.prototype.hasOwnProperty.call(overrides, "allowedPaths")) {
    return normalizePathList(overrides.allowedPaths);
  }
  const legacy = normalizePathList(config?.allowed_paths);
  const permissionPaths = normalizePathList(permissions.allowed_paths);
  const interfacePaths = normalizePathList(iface.allowed_paths);
  return permissionPaths.length > 0
    ? permissionPaths
    : interfacePaths.length > 0
    ? interfacePaths
    : legacy;
}

function resolveLocalAllowedPaths(config) {
  const permissions = config?.permissions ?? {};
  return normalizePathList(permissions.local_allowed_paths);
}

export function resolveSharedAllowedPaths(config) {
  const basePaths = resolveConfiguredBaseAllowedPaths(config);
  return basePaths.length > 0 ? basePaths : getDefaultSharedAllowedPaths();
}

function ensureDirectory(path, label) {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

function isBypassPermissionMode(value) {
  return (
    typeof value === "string" &&
    value.trim().toLowerCase() === "bypasspermissions"
  );
}

function resolveApprovalPolicy(
  config,
  overrides = {},
  providerId,
  providerPermissionDebugModeEnabled = false
) {
  if (providerId !== "codex") return null;
  const defaultPolicy = getDefaultProviderPermissionPolicy("codex");
  const interfaceConfig = config?.interface ?? {};
  const overridePolicy = normalizeConfiguredCodexApprovalPolicy(
    overrides.approvalPolicy,
    "approvalPolicy"
  );
  const interfacePolicy = normalizeConfiguredCodexApprovalPolicy(
    interfaceConfig.approval_policy,
    "interface.approval_policy"
  );
  const legacyPolicy = normalizeConfiguredCodexApprovalPolicy(
    config?.approval_policy,
    "approval_policy"
  );
  if (providerPermissionDebugModeEnabled !== true) return defaultPolicy;
  return (
    overridePolicy || interfacePolicy || legacyPolicy || defaultPolicy
  );
}

function resolveDangerousMode(config, overrides = {}, providerId) {
  const interfaceConfig = config?.interface ?? {};

  if (providerId === "claude") {
    if (
      typeof overrides.permissionMode === "string" &&
      overrides.permissionMode.trim()
    ) {
      return isBypassPermissionMode(overrides.permissionMode);
    }
    if (isBypassPermissionMode(interfaceConfig.permission_mode)) {
      return true;
    }
    if (isBypassPermissionMode(config?.permission_mode)) {
      return true;
    }
    const explicitDangerousMode =
      overrides.dangerousMode !== undefined
        ? normalizeBoolean(overrides.dangerousMode)
        : interfaceConfig.dangerous_mode !== undefined
        ? normalizeBoolean(interfaceConfig.dangerous_mode)
        : null;
    const explicitDangerousSkip =
      overrides.allowDangerouslySkipPermissions !== undefined
        ? normalizeBoolean(overrides.allowDangerouslySkipPermissions)
        : interfaceConfig.allow_dangerously_skip_permissions !== undefined
        ? normalizeBoolean(interfaceConfig.allow_dangerously_skip_permissions)
        : null;
    if (explicitDangerousMode === true || explicitDangerousSkip === true) {
      return true;
    }
    if (explicitDangerousMode === false) {
      return false;
    }
    if (explicitDangerousSkip === false) {
      return false;
    }
    return false;
  }

  if (overrides.dangerousMode !== undefined)
    return normalizeBoolean(overrides.dangerousMode);
  if (interfaceConfig.dangerous_mode !== undefined)
    return normalizeBoolean(interfaceConfig.dangerous_mode);
  return false;
}

function resolveProviderNative(config, overrides = {}) {
  const interfaceConfig = config?.interface ?? {};
  const native = normalizeNativeConfig(interfaceConfig);
  return {
    args: Array.isArray(overrides.providerArgs)
      ? normalizePathList(overrides.providerArgs)
      : native.args,
    configOverrides: isPlainObject(overrides.providerConfigOverrides)
      ? normalizeObject(overrides.providerConfigOverrides)
      : native.configOverrides,
    commands: Array.isArray(overrides.providerCommands)
      ? normalizePathList(overrides.providerCommands)
      : native.commands,
    profile: normalizeString(overrides.providerProfile) || native.profile,
  };
}

function resolveReasoningEffort(
  config,
  overrides = {},
  providerId,
  modelId,
  native = {}
) {
  const interfaceConfig = config?.interface ?? {};
  const explicitOverride = normalizeProviderReasoningEffort(
    providerId,
    overrides.reasoningEffort,
    modelId
  );
  if (explicitOverride) {
    return { value: explicitOverride, source: "override" };
  }
  const sharedInterfaceValue = normalizeProviderReasoningEffort(
    providerId,
    interfaceConfig.reasoning_effort,
    modelId
  );
  if (sharedInterfaceValue) {
    return { value: sharedInterfaceValue, source: "config" };
  }
  const legacyTopLevelValue = normalizeProviderReasoningEffort(
    providerId,
    config?.reasoning_effort,
    modelId
  );
  if (legacyTopLevelValue) {
    return { value: legacyTopLevelValue, source: "config" };
  }
  const nativeConfigValue = normalizeProviderReasoningEffort(
    providerId,
    native?.configOverrides?.model_reasoning_effort,
    modelId
  );
  if (nativeConfigValue) {
    return { value: nativeConfigValue, source: "native" };
  }
  return {
    value: getDefaultProviderReasoningEffort(providerId, modelId),
    source: "default",
  };
}

function resolveConfiguredReasoningEffort(
  config,
  providerId,
  modelId,
  native = {}
) {
  const interfaceConfig = config?.interface ?? {};
  const sharedInterfaceValue = normalizeProviderReasoningEffort(
    providerId,
    interfaceConfig.reasoning_effort,
    modelId
  );
  if (sharedInterfaceValue) {
    return sharedInterfaceValue;
  }
  const legacyTopLevelValue = normalizeProviderReasoningEffort(
    providerId,
    config?.reasoning_effort,
    modelId
  );
  if (legacyTopLevelValue) {
    return legacyTopLevelValue;
  }
  const nativeConfigValue = normalizeProviderReasoningEffort(
    providerId,
    native?.configOverrides?.model_reasoning_effort,
    modelId
  );
  if (nativeConfigValue) {
    return nativeConfigValue;
  }
  return null;
}

function workspacePolicyIncludesSystemRoot(workspacePolicy) {
  return (
    Array.isArray(workspacePolicy?.allowedPaths) &&
    workspacePolicy.allowedPaths.some(
      (entry) => entry?.path === SYSTEM_ROOT_PATH
    )
  );
}

function resolveConfiguredCodexSandboxMode(config, overrides = {}) {
  const interfaceConfig = config?.interface ?? {};
  return (
    normalizeCodexSandboxMode(overrides.sandboxMode) ||
    normalizeCodexSandboxMode(interfaceConfig.sandbox_mode) ||
    normalizeCodexSandboxMode(config?.sandbox_mode)
  );
}

function resolveCodexSandboxMode(
  config,
  overrides = {},
  workspacePolicy,
  dangerousMode
) {
  if (workspacePolicyIncludesSystemRoot(workspacePolicy)) {
    return "danger-full-access";
  }
  if (dangerousMode === true) {
    return "danger-full-access";
  }
  const configuredSandboxMode = resolveConfiguredCodexSandboxMode(
    config,
    overrides
  );
  if (configuredSandboxMode) {
    return configuredSandboxMode;
  }
  return "workspace-write";
}

function resolveProviderSpecificRuntime(
  providerId,
  config,
  overrides = {},
  normalizedRuntime,
  providerPermissionDebugModeEnabled = false
) {
  const interfaceConfig = config?.interface ?? {};

  if (providerId === "claude") {
    const explicitDangerousSkip =
      overrides.allowDangerouslySkipPermissions !== undefined
        ? normalizeBoolean(overrides.allowDangerouslySkipPermissions)
        : interfaceConfig.allow_dangerously_skip_permissions !== undefined
        ? normalizeBoolean(interfaceConfig.allow_dangerously_skip_permissions)
        : false;
    return {
      permissionMode:
        providerPermissionDebugModeEnabled === true
          ? normalizeProviderPermissionPolicy("claude", overrides.permissionMode) ||
            normalizeProviderPermissionPolicy(
              "claude",
              interfaceConfig.permission_mode
            ) ||
            normalizeProviderPermissionPolicy("claude", config?.permission_mode) ||
            getDefaultProviderPermissionPolicy("claude")
          : getDefaultProviderPermissionPolicy("claude"),
      allowDangerouslySkipPermissions:
        providerId === "claude" &&
        (normalizedRuntime.dangerousMode === true ||
          explicitDangerousSkip === true),
    };
  }

  return {
    permissionMode: null,
    allowDangerouslySkipPermissions: false,
  };
}

export function getAgentConfigPaths(folderPath) {
  ensureDirectory(folderPath, "agent folder");
  const resolvedFolder = realpathSync(folderPath);
  const configDirPath = join(resolvedFolder, AGENT_CONFIG_DIRNAME);
  return {
    folderPath: resolvedFolder,
    configDirPath,
    configPath: join(configDirPath, AGENT_SHARED_CONFIG_FILENAME),
    localConfigPath: join(configDirPath, AGENT_LOCAL_CONFIG_FILENAME),
    sitePath: join(configDirPath, AGENT_SITE_DIRNAME),
    legacyConfigPath: join(resolvedFolder, AGENT_CONFIG_DIRNAME),
    legacyLocalConfigPath: join(
      resolvedFolder,
      LEGACY_AGENT_LOCAL_CONFIG_FILENAME
    ),
    defaultConfigPath: getConfigPath(),
  };
}

export function readAgentConfigLayers(folderPath, overrides = {}) {
  const paths = getAgentConfigPaths(folderPath);
  const sharedConfig = readOptionalObjectFile(paths.configPath, "agent config");
  validateSharedAgentConfig(sharedConfig, paths.configPath);
  const localConfig = readOptionalObjectFile(
    paths.localConfigPath,
    "agent local config"
  );
  validateLocalAgentConfig(localConfig, paths.localConfigPath);
  const hostConfig = readConfig();
  const hostDefaults = buildHostDefaultsFromConfig(hostConfig);
  const sanitizedLocalConfig = buildSanitizedLocalConfig(localConfig);

  const projectConfig = mergeObjects(sharedConfig, sanitizedLocalConfig);
  const providerId = resolveConfiguredProviderId(
    projectConfig,
    hostDefaults,
    overrides
  );
  const defaultConfig = buildHostDefaultConfig(hostDefaults, providerId);
  const config = mergeObjects(
    mergeObjects(defaultConfig, sharedConfig),
    sanitizedLocalConfig
  );

  return {
    ...paths,
    hasConfig: existsSync(paths.configPath),
    hasLocalConfig: existsSync(paths.localConfigPath),
    hasDefaultConfig: existsSync(paths.defaultConfigPath),
    sharedConfig,
    localConfig,
    sanitizedLocalConfig,
    hostConfig,
    hostDefaults,
    defaultConfig,
    config,
    providerId,
    web: resolveAgentWebConfigFromLayers({
      sharedConfig: config,
      localConfig,
      folderPath: paths.folderPath,
      sitePath: paths.sitePath,
    }),
    notifications: resolveAgentNotificationConfigFromLayers({
      sharedConfig: config,
    }),
  };
}

export function readAgentConfig(folderPath, overrides = {}) {
  return readAgentConfigLayers(folderPath, overrides).config;
}

export function summarizeAgentConfig(folderPath) {
  const layers = readAgentConfigLayers(folderPath);
  const config = layers.config;
  const interfaceConfig = config?.interface ?? {};
  const providerId = layers.providerId;
  const providerPermissionDebugModeEnabled =
    layers.hostDefaults?.providerPermissionDebugModeEnabled === true;
  const approvalPolicy = resolveApprovalPolicy(
    config,
    {},
    providerId,
    providerPermissionDebugModeEnabled
  );
  const dangerousMode = resolveDangerousMode(config, {}, providerId);
  const providerRuntime = resolveProviderSpecificRuntime(
    providerId,
    config,
    {},
    {
      approvalPolicy,
      dangerousMode,
    },
    providerPermissionDebugModeEnabled
  );
  const native = normalizeNativeConfig(interfaceConfig);
  const model = resolveModel(config, {}, providerId);
  const reasoning = resolveReasoningEffort(
    config,
    {},
    providerId,
    model,
    native
  );
  const interfaceType =
    typeof interfaceConfig.type === "string" && interfaceConfig.type.trim()
      ? interfaceConfig.type.trim()
      : "coding";

  let workspacePolicy = null;
  try {
    workspacePolicy = resolveWorkspacePolicy(layers.folderPath, config);
  } catch {
    workspacePolicy = null;
  }

  return {
    folderPath: layers.folderPath,
    configPath: layers.configPath,
    localConfigPath: layers.localConfigPath,
    defaultConfigPath: layers.defaultConfigPath,
    hasConfig: layers.hasConfig,
    hasLocalConfig: layers.hasLocalConfig,
    hasDefaultConfig: layers.hasDefaultConfig,
    interfaceType,
    provider: providerId,
    providerInfo: requireProvider(providerId, {
      includeDebugFixtureProvider:
        layers.hostDefaults?.debugFixtureProviderEnabled === true,
    }),
    model,
    reasoningEffort: reasoning.value,
    reasoningEffortSource: reasoning.source,
    permissionMode: providerRuntime.permissionMode,
    approvalPolicy,
    sandboxMode:
      providerId === "codex"
        ? resolveCodexSandboxMode(config, {}, workspacePolicy, dangerousMode)
        : null,
    allowDangerouslySkipPermissions:
      providerRuntime.allowDangerouslySkipPermissions,
    dangerousMode,
    searchEnabled:
      providerId === "codex" &&
      normalizeBoolean(interfaceConfig.search_enabled),
    imageInputEnabled: normalizeBoolean(interfaceConfig.image_input_enabled),
    native,
    workspacePolicy,
    web: layers.web,
    notifications: layers.notifications,
    rawConfig: config,
  };
}

export function resolveWorkspacePolicy(
  folderPath,
  config = {},
  overrides = {}
) {
  ensureDirectory(folderPath, "agent folder");
  const agentRoot = realpathSync(folderPath);
  const configuredBasePaths = resolveConfiguredBaseAllowedPaths(
    config,
    overrides
  );
  const localAllowedPaths = resolveLocalAllowedPaths(config);
  const baseAllowedPaths =
    configuredBasePaths.length > 0
      ? configuredBasePaths
      : getDefaultSharedAllowedPaths();
  const effectiveAllowedPaths = [...baseAllowedPaths, ...localAllowedPaths];
  const resolvedAllowedPaths = [];

  for (const entry of effectiveAllowedPaths) {
    const candidate = isAbsolute(entry)
      ? normalize(entry)
      : resolve(agentRoot, entry);
    ensureDirectory(candidate, `allowed path "${entry}"`);
    resolvedAllowedPaths.push({
      raw: entry,
      path: realpathSync(candidate),
    });
  }

  const uniqueAllowedPaths = [];
  const seen = new Set();
  for (const entry of resolvedAllowedPaths) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    uniqueAllowedPaths.push(entry);
  }
  const allowedPathPolicy = normalizeAllowedPathPolicy(
    config?.allowed_path_policy ?? config?.allowedPathPolicy ?? config?.allowed_path
  );

  return {
    root: agentRoot,
    allowedPaths: uniqueAllowedPaths,
    allowedPathPolicy,
    allowed_path_policy: serializeAllowedPathPolicy(allowedPathPolicy),
  };
}

export function resolveAgentRuntimeConfig(folderPath, overrides = {}) {
  const layers = readAgentConfigLayers(folderPath, overrides);
  const config = layers.config;
  const interfaceConfig = config?.interface ?? {};
  const providerId = layers.providerId;
  const provider = requireProvider(providerId, {
    includeDebugFixtureProvider:
      layers.hostDefaults?.debugFixtureProviderEnabled === true,
  });
  const providerPermissionDebugModeEnabled =
    layers.hostDefaults?.providerPermissionDebugModeEnabled === true;
  const approvalPolicy = resolveApprovalPolicy(
    config,
    overrides,
    providerId,
    providerPermissionDebugModeEnabled
  );
  const dangerousMode = resolveDangerousMode(config, overrides, providerId);
  const native = resolveProviderNative(config, overrides);
  const model = resolveModel(config, overrides, provider.id);
  const reasoning = resolveReasoningEffort(
    config,
    overrides,
    providerId,
    model,
    native
  );
  const providerRuntime = resolveProviderSpecificRuntime(
    providerId,
    config,
    overrides,
    {
      approvalPolicy,
      dangerousMode,
    },
    providerPermissionDebugModeEnabled
  );
  const workspacePolicy = resolveWorkspacePolicy(folderPath, config, overrides);
  const runtime = {
    provider: provider.id,
    providerInfo: provider,
    model,
    reasoningEffort: reasoning.value,
    reasoningEffortSource: reasoning.source,
    approvalPolicy,
    sandboxMode:
      provider.id === "codex"
        ? resolveCodexSandboxMode(
            config,
            overrides,
            workspacePolicy,
            dangerousMode
          )
        : null,
    dangerousMode,
    searchEnabled:
      provider.id === "codex"
        ? overrides.searchEnabled !== undefined
          ? normalizeBoolean(overrides.searchEnabled)
          : normalizeBoolean(interfaceConfig.search_enabled)
        : false,
    imageInputEnabled:
      overrides.imageInputEnabled !== undefined
        ? normalizeBoolean(overrides.imageInputEnabled)
        : normalizeBoolean(interfaceConfig.image_input_enabled),
    native,
    permissionMode: providerRuntime.permissionMode,
    allowDangerouslySkipPermissions:
      providerRuntime.allowDangerouslySkipPermissions,
    workspacePolicy,
  };

  return {
    config,
    runtime,
    layers,
  };
}

export function resolveAgentSessionProfileConfig(
  folderPath,
  providerOverride = null,
  modelContext = null
) {
  const rawHostConfig = readRawConfigSource();
  const providerId = requireProvider(
    providerOverride || readAgentConfigLayers(folderPath).providerId,
    {
      includeDebugFixtureProvider:
        isDebugFixtureProviderEnabled(rawHostConfig),
    }
  ).id;
  const paths = getAgentConfigPaths(folderPath);
  const sharedConfig = readOptionalObjectFile(paths.configPath, "agent config");
  validateSharedAgentConfig(sharedConfig, paths.configPath);
  const localConfig = readOptionalObjectFile(
    paths.localConfigPath,
    "agent local config"
  );
  validateLocalAgentConfig(localConfig, paths.localConfigPath);
  const sanitizedLocalConfig = buildSanitizedLocalConfig(localConfig);
  const explicitHostDefaultConfig = buildExplicitHostDefaultConfig(
    rawHostConfig,
    providerId
  );
  const config = mergeObjects(
    mergeObjects(explicitHostDefaultConfig, sharedConfig),
    sanitizedLocalConfig
  );
  const native = resolveProviderNative(config);
  const configuredModel = resolveConfiguredModel(config, providerId);
  const reasoningModelId =
    configuredModel || normalizeProviderModel(providerId, modelContext) || null;
  const providerPermissionDebugModeEnabled =
    isProviderPermissionDebugModeEnabled(rawHostConfig);

  return {
    provider: providerId,
    notifications: serializeAgentNotificationConfig(
      resolveAgentNotificationConfigFromLayers({
        sharedConfig: config,
      })
    ),
    telegram: serializeAgentTelegramConfigFromLayers({
      sharedConfig,
      localConfig,
    }),
    fields: {
      model: {
        supported: true,
        value: configuredModel,
      },
      reasoning_effort: {
        supported: true,
        value: resolveConfiguredReasoningEffort(
          config,
          providerId,
          reasoningModelId,
          native
        ),
      },
      permission_mode: {
        supported: providerId === "claude",
        value:
          providerId === "claude"
            ? providerPermissionDebugModeEnabled === true
              ? normalizeProviderPermissionPolicy(
                  "claude",
                  config?.interface?.permission_mode
                ) ||
                normalizeProviderPermissionPolicy("claude", config?.permission_mode) ||
                getDefaultProviderPermissionPolicy("claude")
              : getDefaultProviderPermissionPolicy("claude")
            : null,
      },
      approval_policy: {
        supported: providerId === "codex",
        value:
          providerId === "codex"
            ? resolveApprovalPolicy(
                config,
                {},
                providerId,
                providerPermissionDebugModeEnabled
              )
            : null,
      },
      sandbox_mode: {
        supported: providerId === "codex",
        value:
          providerId === "codex"
            ? resolveConfiguredCodexSandboxMode(config, {})
            : null,
      },
    },
  };
}

export function resolveAgentWebConfig(folderPath) {
  return readAgentConfigLayers(folderPath).web;
}
