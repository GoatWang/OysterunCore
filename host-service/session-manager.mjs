import { createHash, randomUUID } from "crypto";
import { EventEmitter } from "events";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { ClaudeCodeAdapter } from "./adapters/claude-code-adapter.mjs";
import { CodexAppServerAdapter } from "./adapters/codex-app-server-adapter.mjs";
import { DebugFixtureProviderAdapter } from "./adapters/debug-fixture-provider-adapter.mjs";
import { DebugLargeToolSpilloverProviderAdapter } from "./adapters/debug-large-tool-spillover-provider-adapter.mjs";
import { DebugP135CodexReplayProviderAdapter } from "./adapters/debug-p135-codex-replay-provider-adapter.mjs";
import { DebugRouteCStructuralReplayProviderAdapter } from "./adapters/debug-routec-structural-replay-provider-adapter.mjs";
import { readConfig } from "./config.mjs";
import {
  createProviderUnavailableError,
  getConfiguredProviderCommand,
  isConfiguredCommandAvailable,
  requireProvider,
} from "./provider-registry.mjs";
import {
  deleteSessionRecord,
  saveSessionRecord,
  updateSessionRecord,
} from "./session-history.mjs";
import {
  buildSessionNameConflictMessage,
  buildUniqueDefaultSessionName,
  normalizeSessionName,
} from "./session-name.mjs";
import { getSessionNameCounterStore } from "./session-name-counter-store.mjs";
import {
  buildProviderStartupLifecycleEvent,
  logProviderStartupEvent,
} from "./provider-startup-preflight.mjs";
import {
  ensureProviderTrustedAgentRoot,
  getProviderTrustedFolderStatus,
} from "./provider-trust.mjs";
import { normalizeAssetReadablePaths } from "./workspace-policy.mjs";
import {
  blockRouteCHost2IntakeProviderDelivery,
  claimRouteCHost2IntakeForProviderDelivery,
  getRouteCHost2IntakeProof,
  markRouteCHost2IntakeAgentTurnStarted,
  recordRouteCProviderDeliveryFailure,
} from "./matrix-event-correlator.mjs";

const OYSTERUN_REAL_CODEX_DELIVERY_MARKER =
  "oysterun_real_codex_host_provider_delivery_no_pass";
const OYSTERUN_REAL_CLAUDE_DELIVERY_MARKER =
  "oysterun_real_claude_host_provider_delivery_no_pass";
const OYSTERUN_REAL_CODEX_SEMANTIC_CONTRACT =
  "real_codex_e2e_semantic_contract";
const OYSTERUN_REAL_CLAUDE_SEMANTIC_CONTRACT =
  "real_claude_e2e_semantic_contract_no_pass";
const PROVIDER_TURN_FAILED_NO_OUTPUT_CLASSIFICATION =
  "provider_turn_failed_without_output";
const PROVIDER_SESSION_AUTH_FAILURE_CLASSIFICATION =
  "provider_session_authentication_failed";
const PROVIDER_TURN_FAILED_NO_OUTPUT_MESSAGE =
  "The provider turn failed before producing a response. This session may be stale or the provider runtime may be unavailable. Start a new session or re-authenticate the provider, then try again.";
const PROVIDER_SESSION_AUTH_FAILURE_MESSAGE = [
  "Provider login is required before this session can continue.",
  "",
  "1. Use machine terminal to login the agent provider",
  "2. If remote terminal is unavailable, [Open Terminal](/app/terminal)",
  "",
  "and run the provider login command:",
  "",
  "- codex /login for Codex or",
  "- claude /login for Claude.",
  "",
  "then use Restart session to resume this chat.",
].join("\n");
// TODO(P313): Prefer adapter-supplied structured auth metadata such as
// error_scope="provider_authentication" over regex text classification.
const PROVIDER_AUTH_FAILURE_PATTERN =
  /\b(auth|authentication|authenticated|credential|credentials|login|logged\s*out|session\s+expired|session\s+invalid|unauthorized|forbidden|401|403)\b/i;
const PRODUCT_SKILL_COPY_CONTRACT =
  "p54_product_skill_source_of_truth_split_v1";
const OYSTERUN_PROVIDER_SKILL_SET_NAME = "Oysterun";
const OYSTERUN_PROVIDER_SKILL_SET_MARKER =
  "<!-- oysterun-skill-set: true -->";
const OYSTERUN_PROVIDER_SKILL_COPY_CONTRACT =
  "p88_provider_skill_installation_controller_v1";
const DEFAULT_CLAUDE_CLAIMED_TURN_NO_OUTPUT_TIMEOUT_MS = 45000;
const PRODUCT_SKILL_NAMES = Object.freeze([
  "oysterun-sessions",
  "oysterun-session-chat",
  "oysterun-find-context",
  "oysterun-scheduler",
  "oysterun-mail",
  "oysterun-notifications",
  "oysterun-website",
  "oysterun-telegram",
]);
const PRODUCT_SKILL_NAME_SET = new Set(PRODUCT_SKILL_NAMES);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRODUCT_SKILL_ROOTS = Object.freeze({
  sourceRoot: resolve(__dirname, "..", "skills"),
  codexMirrorRoot: resolve(__dirname, "..", ".codex", "skills"),
  hostAssetRoot: resolve(__dirname, "assets", "product-skills"),
});
const PROVIDER_SKILL_ROOT_SEGMENTS = Object.freeze({
  claude: [".claude", "skills"],
  codex: [".codex", "skills"],
});

class ProductSkillRequirementError extends Error {
  constructor(message, { statusCode = 409, reason = "product_skill_error" } = {}) {
    super(message);
    this.name = "ProductSkillRequirementError";
    this.code = "PRODUCT_SKILL_REQUIREMENT_ERROR";
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

function normalizeProductSkillRoots(value = {}) {
  return {
    sourceRoot: resolve(value.sourceRoot || DEFAULT_PRODUCT_SKILL_ROOTS.sourceRoot),
    codexMirrorRoot: resolve(
      value.codexMirrorRoot || DEFAULT_PRODUCT_SKILL_ROOTS.codexMirrorRoot
    ),
    hostAssetRoot: resolve(
      value.hostAssetRoot || DEFAULT_PRODUCT_SKILL_ROOTS.hostAssetRoot
    ),
  };
}

function cloneJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeHostRestartString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeHostRestartNotificationConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const storageOwner =
    normalizeHostRestartString(value.storageOwner) ||
    normalizeHostRestartString(value.storage_owner) ||
    "agent_config_notifications_enabled";
  const configKey =
    normalizeHostRestartString(value.configKey) ||
    normalizeHostRestartString(value.config_key) ||
    "notifications.enabled";
  return {
    enabled: value.enabled !== false && value.notifications_enabled !== false,
    storageOwner,
    configKey,
    currentSessionOnly:
      value.currentSessionOnly === true || value.current_session_only === true,
  };
}

function serializeHostRestartNotificationConfig(value) {
  const normalized = normalizeHostRestartNotificationConfig(value);
  if (!normalized) return null;
  return {
    enabled: normalized.enabled !== false,
    storage_owner: normalized.storageOwner,
    config_key: normalized.configKey,
    current_session_only: normalized.currentSessionOnly === true,
  };
}

function productSkillError(message, options = {}) {
  return new ProductSkillRequirementError(message, options);
}

function normalizeRequiredProductSkills(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw productSkillError("required_product_skills must be an array", {
      statusCode: 400,
      reason: "invalid_required_product_skills",
    });
  }
  const seen = new Set();
  const skills = [];
  for (const rawSkill of value) {
    const skillName = typeof rawSkill === "string" ? rawSkill.trim() : "";
    if (!skillName) {
      throw productSkillError(
        "required_product_skills entries must be non-empty strings",
        {
          statusCode: 400,
          reason: "invalid_required_product_skills",
        }
      );
    }
    if (!PRODUCT_SKILL_NAME_SET.has(skillName)) {
      throw productSkillError(`unknown required product skill: ${skillName}`, {
        statusCode: 400,
        reason: "unknown_required_product_skill",
      });
    }
    if (seen.has(skillName)) {
      throw productSkillError(`duplicate required product skill: ${skillName}`, {
        statusCode: 400,
        reason: "duplicate_required_product_skill",
      });
    }
    seen.add(skillName);
    skills.push(skillName);
  }
  return skills;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sortedDirEntries(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

function buildProductSkillFileManifest(skillRoot) {
  const files = [];
  const stack = [skillRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of sortedDirEntries(current)) {
      const entryPath = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw productSkillError(
          `product skill trees must not contain symlinks: ${entryPath}`,
          { statusCode: 409, reason: "product_skill_symlink" }
        );
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        throw productSkillError(
          `product skill trees must contain only files/directories: ${entryPath}`,
          { statusCode: 409, reason: "invalid_product_skill_entry" }
        );
      }
      const stats = statSync(entryPath);
      files.push({
        path: relative(skillRoot, entryPath),
        size: stats.size,
        sha256: sha256File(entryPath),
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function buildProductSkillManifest(root, skillName) {
  const skillRoot = join(root, skillName);
  if (!existsSync(skillRoot)) {
    return { skillName, root: skillRoot, exists: false, files: [] };
  }
  if (!statSync(skillRoot).isDirectory()) {
    throw productSkillError(`product skill path is not a directory: ${skillRoot}`, {
      statusCode: 409,
      reason: "invalid_product_skill_root",
    });
  }
  return {
    skillName,
    root: skillRoot,
    exists: true,
    files: buildProductSkillFileManifest(skillRoot),
  };
}

function productSkillManifestSignature(manifest) {
  return JSON.stringify(manifest.files);
}

function assertManifestMatches(source, mirror, label) {
  if (!source.exists) {
    throw productSkillError(`missing product skill source: ${source.root}`, {
      statusCode: 409,
      reason: "missing_product_skill_source",
    });
  }
  if (!mirror.exists) {
    throw productSkillError(`missing ${label} product skill asset: ${mirror.root}`, {
      statusCode: 409,
      reason: "missing_product_skill_asset",
    });
  }
  if (productSkillManifestSignature(source) !== productSkillManifestSignature(mirror)) {
    throw productSkillError(
      `stale product skill mirror for ${source.skillName}: ${label}`,
      { statusCode: 409, reason: "product_skill_mirror_drift" }
    );
  }
}

function assertProductSkillMirrorsCurrent(productSkillRoots) {
  for (const skillName of PRODUCT_SKILL_NAMES) {
    const source = buildProductSkillManifest(productSkillRoots.sourceRoot, skillName);
    assertManifestMatches(
      source,
      buildProductSkillManifest(productSkillRoots.codexMirrorRoot, skillName),
      ".codex mirror"
    );
    assertManifestMatches(
      source,
      buildProductSkillManifest(productSkillRoots.hostAssetRoot, skillName),
      "Host packaged"
    );
  }
}

function assertPathInside(parentPath, childPath, label) {
  const relativePath = relative(parentPath, childPath);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw productSkillError(`${label} must stay inside the agent folder`, {
      statusCode: 400,
      reason: "product_skill_target_escape",
    });
  }
}

function normalizeProviderSkillProvider(providerId) {
  const normalized =
    typeof providerId === "string" && providerId.trim()
      ? providerId.trim().toLowerCase()
      : "claude";
  return Object.prototype.hasOwnProperty.call(
    PROVIDER_SKILL_ROOT_SEGMENTS,
    normalized
  )
    ? normalized
    : null;
}

function providerSkillTargetRootForAgent(agentRoot, providerId) {
  const provider = normalizeProviderSkillProvider(providerId);
  if (!provider) return null;
  return resolve(agentRoot, ...PROVIDER_SKILL_ROOT_SEGMENTS[provider]);
}

function oysterunProviderSkillSourceRoot(productSkillRoots) {
  return join(productSkillRoots.hostAssetRoot, OYSTERUN_PROVIDER_SKILL_SET_NAME);
}

function assertOysterunProviderSkillPackagedSourceCurrent(productSkillRoots) {
  const aggregateHostAssetRoot = oysterunProviderSkillSourceRoot(
    productSkillRoots
  );
  const skillFile = join(aggregateHostAssetRoot, "SKILL.md");
  if (!existsSync(skillFile) || !statSync(skillFile).isFile()) {
    throw productSkillError("missing packaged Oysterun aggregate skill", {
      statusCode: 409,
      reason: "missing_oysterun_skill_set",
    });
  }
  if (!readFileSync(skillFile, "utf8").includes(OYSTERUN_PROVIDER_SKILL_SET_MARKER)) {
    throw productSkillError("missing packaged Oysterun ownership marker", {
      statusCode: 409,
      reason: "missing_oysterun_skill_set_marker",
    });
  }
  for (const skillName of PRODUCT_SKILL_NAMES) {
    const moduleSkill = join(
      aggregateHostAssetRoot,
      "modules",
      skillName,
      "SKILL.md"
    );
    if (!existsSync(moduleSkill) || !statSync(moduleSkill).isFile()) {
      throw productSkillError(
        `missing packaged Oysterun module skill: ${skillName}`,
        { statusCode: 409, reason: "missing_oysterun_skill_set_module" }
      );
    }
  }
  buildProductSkillFileManifest(aggregateHostAssetRoot);
}

export function getOysterunProviderSkillInstallationStatus({
  cwd,
  provider,
  productSkillRoots = DEFAULT_PRODUCT_SKILL_ROOTS,
}) {
  const roots = normalizeProductSkillRoots(productSkillRoots);
  const agentRoot = resolve(cwd || "");
  if (!existsSync(agentRoot) || !statSync(agentRoot).isDirectory()) {
    throw productSkillError(`agent folder does not exist: ${agentRoot}`, {
      statusCode: 400,
      reason: "missing_agent_folder",
    });
  }
  const normalizedProvider = normalizeProviderSkillProvider(provider);
  const sourceRoot = oysterunProviderSkillSourceRoot(roots);
  if (!normalizedProvider) {
    return {
      contract: OYSTERUN_PROVIDER_SKILL_COPY_CONTRACT,
      provider: typeof provider === "string" ? provider.trim() : "",
      provider_supported: false,
      target_root: null,
      skill_set_target: null,
      source: sourceRoot,
      source_validation: "packaged_host_asset",
      installed: false,
      ownership_marker_valid: false,
      can_install: false,
      default_checked: false,
      disabled: true,
      reason: "unsupported_provider_skill_root",
      marker: OYSTERUN_PROVIDER_SKILL_SET_MARKER,
    };
  }
  assertOysterunProviderSkillPackagedSourceCurrent(roots);
  const targetRoot = providerSkillTargetRootForAgent(agentRoot, normalizedProvider);
  const skillSetTarget = resolve(targetRoot, OYSTERUN_PROVIDER_SKILL_SET_NAME);
  assertPathInside(agentRoot, targetRoot, "provider skill target root");
  assertPathInside(agentRoot, skillSetTarget, "provider skill target");
  if (!existsSync(skillSetTarget)) {
    return {
      contract: OYSTERUN_PROVIDER_SKILL_COPY_CONTRACT,
      provider: normalizedProvider,
      provider_supported: true,
      target_root: targetRoot,
      skill_set_target: skillSetTarget,
      source: sourceRoot,
      source_validation: "packaged_host_asset",
      installed: false,
      ownership_marker_valid: false,
      can_install: true,
      default_checked: true,
      disabled: false,
      reason: "missing_oysterun_skill_set",
      marker: OYSTERUN_PROVIDER_SKILL_SET_MARKER,
    };
  }
  const stats = statSync(skillSetTarget);
  const skillFile = join(skillSetTarget, "SKILL.md");
  const markerValid =
    stats.isDirectory() &&
    existsSync(skillFile) &&
    statSync(skillFile).isFile() &&
    readFileSync(skillFile, "utf8").includes(OYSTERUN_PROVIDER_SKILL_SET_MARKER);
  return {
    contract: OYSTERUN_PROVIDER_SKILL_COPY_CONTRACT,
    provider: normalizedProvider,
    provider_supported: true,
    target_root: targetRoot,
    skill_set_target: skillSetTarget,
    source: sourceRoot,
    source_validation: "packaged_host_asset",
    installed: true,
    ownership_marker_valid: markerValid,
    can_install: markerValid,
    default_checked: false,
    disabled: !markerValid,
    reason: markerValid
      ? "existing_owned_oysterun_skill_set"
      : "existing_unowned_oysterun_skill_set",
    marker: OYSTERUN_PROVIDER_SKILL_SET_MARKER,
  };
}

export function installOysterunProviderSkillSet({
  cwd,
  provider,
  productSkillRoots = DEFAULT_PRODUCT_SKILL_ROOTS,
  overwrite = true,
}) {
  const roots = normalizeProductSkillRoots(productSkillRoots);
  const status = getOysterunProviderSkillInstallationStatus({
    cwd,
    provider,
    productSkillRoots: roots,
  });
  if (!status.can_install) {
    throw productSkillError(
      `Oysterun provider skill set cannot be installed: ${status.reason}`,
      { statusCode: 409, reason: status.reason }
    );
  }
  if (status.installed && status.ownership_marker_valid && overwrite !== true) {
    return {
      ...status,
      installed_now: false,
      skipped: true,
      reason: "existing_owned_oysterun_skill_set_requires_overwrite",
      copied: [],
    };
  }
  rmSync(status.skill_set_target, { recursive: true, force: true });
  mkdirSync(dirname(status.skill_set_target), { recursive: true });
  copyProductSkillDirectory(status.source, status.skill_set_target);
  return {
    ...getOysterunProviderSkillInstallationStatus({
      cwd,
      provider,
      productSkillRoots: roots,
    }),
    installed_now: true,
    skipped: false,
    reason: status.installed
      ? "overwrote_owned_oysterun_skill_set"
      : "installed_missing_oysterun_skill_set",
    copied: buildProductSkillFileManifest(status.skill_set_target),
  };
}

function formatOysterunProviderSkillInstallOutcomeBody({ state, reason, error }) {
  if (state !== "completed") {
    const detail = error || reason || "unknown_error";
    return `Oysterun skill install/update failed: ${detail}. Provider delivery suppressed.`;
  }
  if (reason === "installed_missing_oysterun_skill_set") {
    return "Oysterun skills installed for this agent folder. Provider delivery suppressed.";
  }
  if (reason === "overwrote_owned_oysterun_skill_set") {
    return "Oysterun skills updated for this agent folder. Provider delivery suppressed.";
  }
  if (reason === "existing_owned_oysterun_skill_set_requires_overwrite") {
    return "Oysterun skills are already installed. Use /update_oysterun_skill to refresh them. Provider delivery suppressed.";
  }
  return "Oysterun skill install/update finished. Provider delivery suppressed.";
}

function copyProductSkillDirectory(sourceDir, targetDir) {
  copyDirectoryContents(sourceDir, targetDir);
}

function copyDirectoryContents(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of sortedDirEntries(sourceDir)) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw productSkillError(`refusing to copy product skill symlink: ${sourcePath}`, {
        statusCode: 409,
        reason: "product_skill_symlink",
      });
    }
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) {
      throw productSkillError(
        `refusing to copy non-file product skill entry: ${sourcePath}`,
        { statusCode: 409, reason: "invalid_product_skill_entry" }
      );
    }
    const stats = statSync(sourcePath);
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, stats.mode & 0o777);
  }
}

function copyRequiredProductSkillsToAgent({
  cwd,
  requiredProductSkills,
  productSkillRoots,
}) {
  const skills = normalizeRequiredProductSkills(requiredProductSkills);
  if (skills === null) {
    return {
      provided: false,
      contract: null,
      skills: [],
      copied: [],
    };
  }
  const agentRoot = resolve(cwd);
  if (!existsSync(agentRoot) || !statSync(agentRoot).isDirectory()) {
    throw productSkillError(`agent folder does not exist: ${agentRoot}`, {
      statusCode: 400,
      reason: "missing_agent_folder",
    });
  }
  assertProductSkillMirrorsCurrent(productSkillRoots);
  const targetRoot = resolve(agentRoot, ".claude", "skills");
  assertPathInside(agentRoot, targetRoot, "product skill target root");
  const copied = [];
  for (const skillName of skills) {
    const sourceDir = join(productSkillRoots.hostAssetRoot, skillName);
    const targetDir = resolve(targetRoot, skillName);
    assertPathInside(agentRoot, targetDir, "product skill target");
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(dirname(targetDir), { recursive: true });
    copyDirectoryContents(sourceDir, targetDir);
    copied.push({
      skill: skillName,
      source: sourceDir,
      target: targetDir,
      files: buildProductSkillFileManifest(targetDir),
    });
  }
  return {
    provided: true,
    contract: PRODUCT_SKILL_COPY_CONTRACT,
    skills,
    targetRoot,
    copied,
  };
}

function normalizeRuntimeEnv(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof key !== "string" || !key.trim()) continue;
    if (rawValue === undefined || rawValue === null) continue;
    env[key] = String(rawValue);
  }
  return env;
}

export function prepareProviderRuntimeWorkspace({
  cwd,
  provider,
  requiredProductSkills,
  productSkillRoots = DEFAULT_PRODUCT_SKILL_ROOTS,
  installOysterunSkills = false,
  runtimeCapabilityEnv,
  ensureTrustedAgentRoot = ensureProviderTrustedAgentRoot,
}) {
  const roots = normalizeProductSkillRoots(productSkillRoots);
  const productSkillCopy = copyRequiredProductSkillsToAgent({
    cwd,
    requiredProductSkills,
    productSkillRoots: roots,
  });
  const oysterunProviderSkillInstall =
    installOysterunSkills === true
      ? installOysterunProviderSkillSet({
          cwd,
          provider,
          overwrite: true,
          productSkillRoots: roots,
        })
      : null;
  const normalizedRuntimeEnv = normalizeRuntimeEnv(runtimeCapabilityEnv);
  const providerTrustedFolder = ensureTrustedAgentRoot({
    cwd,
    provider,
    env: {
      ...process.env,
      ...normalizedRuntimeEnv,
    },
  });
  return {
    normalizedRuntimeEnv,
    productSkillCopy,
    oysterunProviderSkillInstall,
    providerTrustedFolder,
  };
}

function normalizeRedactionValues(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : String(entry || "")))
    .filter((entry) => entry.length > 0);
}

function redactRuntimeCapabilityText(value, tokens) {
  let redacted = String(value);
  for (const token of tokens) {
    redacted = redacted.split(token).join("[redacted]");
  }
  return redacted;
}

function redactRuntimeCapabilityPayload(value, tokens, seen = new WeakSet()) {
  if (!tokens.length) return value;
  if (typeof value === "string") {
    return redactRuntimeCapabilityText(value, tokens);
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) =>
      redactRuntimeCapabilityPayload(entry, tokens, seen)
    );
  }
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = redactRuntimeCapabilityPayload(entry, tokens, seen);
  }
  return next;
}

function routeCRealProviderDeliveryMarker(providerId) {
  if (providerId === "codex") return OYSTERUN_REAL_CODEX_DELIVERY_MARKER;
  if (providerId === "claude") return OYSTERUN_REAL_CLAUDE_DELIVERY_MARKER;
  if (providerId === "debug-fixture")
    return "oysterun_debug_fixture_host_provider_delivery_no_pass";
  if (providerId === "debug-large-tool-spillover")
    return "oysterun_debug_large_tool_spillover_host_provider_delivery_no_pass";
  if (providerId === "debug-p135-codex-replay")
    return "oysterun_debug_p135_codex_replay_host_provider_delivery_no_pass";
  if (providerId === "debug-routec-structural-replay")
    return "oysterun_debug_routec_structural_replay_host_provider_delivery_no_pass";
  return null;
}

function routeCRealProviderSemanticContract(providerId) {
  if (providerId === "codex") return OYSTERUN_REAL_CODEX_SEMANTIC_CONTRACT;
  if (providerId === "claude") return OYSTERUN_REAL_CLAUDE_SEMANTIC_CONTRACT;
  if (providerId === "debug-fixture")
    return "debug_fixture_semantic_contract";
  if (providerId === "debug-large-tool-spillover")
    return "debug_large_tool_spillover_semantic_contract";
  if (providerId === "debug-p135-codex-replay")
    return "debug_p135_codex_replay_semantic_contract";
  if (providerId === "debug-routec-structural-replay")
    return "debug_routec_structural_replay_semantic_contract";
  return null;
}

function normalizeProviderMetadataId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTimeoutMs(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return numeric;
}

/**
 * Manages multiple agent sessions through a pluggable interface adapter.
 * The current default adapter is Claude Code.
 *
 * Adapted from CCSessions/session-manager.mjs for Oysterun host service.
 * Key addition: agent-level session mapping (agent_id → session).
 */
export class SessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    const getCurrentConfig =
      typeof options.getCurrentConfig === "function"
        ? options.getCurrentConfig
        : readConfig;
    const defaultAdapter =
      options.adapter ||
      new ClaudeCodeAdapter({
        getConfiguredCommand: () =>
          getConfiguredProviderCommand(getCurrentConfig(), "claude"),
      });
    const codexAdapter =
      options.codexAdapter ||
      new CodexAppServerAdapter({
        getConfiguredCommand: () =>
          getConfiguredProviderCommand(getCurrentConfig(), "codex"),
      });
    const debugFixtureAdapter =
      options.debugFixtureAdapter || new DebugFixtureProviderAdapter();
    const debugLargeToolSpilloverAdapter =
      options.debugLargeToolSpilloverAdapter ||
      new DebugLargeToolSpilloverProviderAdapter();
    const debugP135CodexReplayAdapter =
      options.debugP135CodexReplayAdapter ||
      new DebugP135CodexReplayProviderAdapter();
    const debugRouteCStructuralReplayAdapter =
      options.debugRouteCStructuralReplayAdapter ||
      new DebugRouteCStructuralReplayProviderAdapter();
    this.adapters = new Map([
      [defaultAdapter.providerId, defaultAdapter],
      [codexAdapter.providerId, codexAdapter],
      [debugFixtureAdapter.providerId, debugFixtureAdapter],
      [
        debugLargeToolSpilloverAdapter.providerId,
        debugLargeToolSpilloverAdapter,
      ],
      [debugP135CodexReplayAdapter.providerId, debugP135CodexReplayAdapter],
      [
        debugRouteCStructuralReplayAdapter.providerId,
        debugRouteCStructuralReplayAdapter,
      ],
    ]);
    this.getCurrentConfig = getCurrentConfig;
    this.productSkillRoots = normalizeProductSkillRoots(options.productSkillRoots);
    this.providerTrust = {
      getStatus:
        options.providerTrust && typeof options.providerTrust.getStatus === "function"
          ? options.providerTrust.getStatus
          : getProviderTrustedFolderStatus,
      ensure:
        options.providerTrust && typeof options.providerTrust.ensure === "function"
          ? options.providerTrust.ensure
          : ensureProviderTrustedAgentRoot,
    };
    this.claudeClaimedTurnNoOutputTimeoutMs = normalizeTimeoutMs(
      options.claudeClaimedTurnNoOutputTimeoutMs,
      DEFAULT_CLAUDE_CLAIMED_TURN_NO_OUTPUT_TIMEOUT_MS,
      "claudeClaimedTurnNoOutputTimeoutMs"
    );
    /** @type {Map<string, import("./adapters/claude-code-adapter.mjs").ClaudeCodeSession>} sessionId → Session */
    this.sessions = new Map();
    /** @type {Map<string, Set<string>>} agentId → sessionIds */
    this.agentSessions = new Map();
  }

  initializeDeliveryState(session) {
    session._deliveryState = session._ready === true ? "ready" : "starting";
    session._outbox = [];
    session._nextOutboxSequence = 1;
    session._activeOutboxMessageId = null;
    session._activeOutboxProgressSeen = false;
    session._activeOutboxProviderVisibleEventSeen = false;
    session._activeOutboxToolProgressSeen = false;
    session._claimedProviderTurnNoOutputTimer = null;
    session._claimedProviderTurnNoOutputMessageId = null;
    session._claimedProviderTurnNoOutputDeadlineAt = null;
    session._claimedProviderTurnNoOutputGeneration = 0;
    session._claimedProviderTurnNoOutputToolProgressSeen = false;
    session._claimedProviderTurnNoOutputFinalEventSeen = false;
    session._interruptResult = null;
  }

  getEffectiveProviderResumeId(session) {
    if (!session) return null;
    return session.providerResumeId || session.resumeSessionId || null;
  }

  getProviderTrustedFolderStatus({ cwd, provider, env = process.env }) {
    return this.providerTrust.getStatus({ cwd, provider, env });
  }

  ensureProviderTrustedAgentRoot({ cwd, provider, env = process.env }) {
    return this.providerTrust.ensure({ cwd, provider, env });
  }

  getOutboxMessage(session, messageId) {
    return (
      (session._outbox || []).find((entry) => entry.id === messageId) || null
    );
  }

  getActiveOutboxMessage(session) {
    if (!session._activeOutboxMessageId) return null;
    return this.getOutboxMessage(session, session._activeOutboxMessageId);
  }

  getNextQueuedOutboxMessage(session) {
    return (
      (session._outbox || []).find((entry) => entry.state === "queued") || null
    );
  }

  isRetryableOutboxState(state) {
    return state === "ambiguous" || state === "stalled" || state === "failed";
  }

  isSkippableOutboxState(state) {
    return state === "ambiguous" || state === "stalled";
  }

  canonicalDeliveryStateForMessageState(state) {
    switch (state) {
      case "queued":
        return "queued";
      case "running":
        return "running";
      case "completed":
        return "committed";
      case "failed":
      case "stalled":
      case "ambiguous":
        return "failed";
      default:
        return "queued";
    }
  }

  routeCProviderDisplayName(providerId) {
    const normalized =
      typeof providerId === "string" && providerId.trim()
        ? providerId.trim()
        : "agent";
    if (normalized === "claude") return "Claude";
    if (normalized === "codex") return "Codex";
    if (normalized === "debug-fixture") return "Fake";
    if (normalized === "debug-p135-codex-replay") return "P135 Codex Replay";
    if (normalized === "debug-routec-structural-replay")
      return "Route C Structural Replay";
    return normalized
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  routeCProviderLifecycleMessage(session) {
    const outbox = session?._outbox || [];
    const activeMessage = this.getActiveOutboxMessage(session);
    if (
      activeMessage &&
      ["queued", "dispatching", "running"].includes(activeMessage.state)
    ) {
      return activeMessage;
    }
    const queuedMessage = outbox.find((message) =>
      ["queued", "dispatching", "running"].includes(message.state)
    );
    if (queuedMessage) return queuedMessage;
    return [...outbox]
      .reverse()
      .find((message) =>
        [
          "completed",
          "failed",
          "interrupted",
          "canceled",
          "ambiguous",
          "stalled",
        ].includes(message.state)
      );
  }

  buildRouteCProviderLifecycle(session, { pendingControlRequests = [] } = {}) {
    const message = this.routeCProviderLifecycleMessage(session);
    const delivery = message?.routeCMatrixDelivery || null;
    const pendingControlRequestCount = Array.isArray(pendingControlRequests)
      ? pendingControlRequests.length
      : 0;
    const activeOutboxState = message
      ? ["queued", "dispatching", "running"].includes(message.state)
      : false;
    const active = activeOutboxState || pendingControlRequestCount > 0;
    const terminal = Boolean(
      !active &&
        message &&
        [
          "completed",
          "failed",
          "interrupted",
          "canceled",
          "ambiguous",
          "stalled",
        ].includes(message.state)
    );
    const state = active
      ? activeOutboxState
        ? message.state
        : "pending_control"
      : terminal
      ? message.state
      : "idle";
    const providerId =
      delivery?.provider_id || session.provider || session.adapterId || "agent";
    const sourceUserEventId =
      delivery?.source_user_event_id || delivery?.target_user_event_id || null;
    return {
      schema_version: "routec.provider_lifecycle.v1",
      source: "host_session_outbox_pending_control",
      host_owned_provider_lifecycle: true,
      frontend_timeline_source_event_required: false,
      raw_payload_exposed: false,
      session_id: session.id,
      room_id: delivery?.matrix_room_id || null,
      provider_id: providerId,
      display_name: this.routeCProviderDisplayName(providerId),
      state,
      active,
      terminal,
      heartbeat_recommended: active,
      related_polling_allowed: active,
      cancelable: message?.state === "queued",
      cancelability_source: "host_outbox_state",
      message_id: message?.id || null,
      active_message_id: session._activeOutboxMessageId || null,
      active_message_state: message?.state || null,
      delivery_state: message
        ? this.canonicalDeliveryStateForMessageState(message.state)
        : null,
      provider_delivery_claimed:
        delivery?.provider_delivery_claimed === true,
      provider_delivery_attempted:
        delivery?.provider_delivery_attempted === true,
      provider_delivery_state: delivery?.provider_delivery_state || null,
      host2_intake_state:
        delivery?.host2_intake_proof?.host2_intake_state || null,
      agent_turn_started:
        delivery?.host2_intake_proof?.agent_turn_started === true,
      source_user_event_id: sourceUserEventId,
      source_user_event_id_hash: delivery?.source_user_event_id_hash || null,
      provider_turn_id:
        delivery?.provider_turn_id || message?.providerTurnId || null,
      pending_control_request_count: pendingControlRequestCount,
      updated_at:
        message?.completedAt || message?.canceledAt || message?.createdAt || null,
    };
  }

  routeCStableHash(value) {
    return createHash("sha256")
      .update(String(value || ""))
      .digest("hex");
  }

  routeCHostGeneratedProviderTurnId(session, message, delivery) {
    const hash = this.routeCStableHash(
      JSON.stringify({
        host_session_id: delivery?.host_session_id || session?.id || null,
        matrix_room_id: delivery?.matrix_room_id || null,
        source_user_event_id: delivery?.source_user_event_id || null,
        outbox_message_id: message?.id || null,
        provider_id: delivery?.provider_id || session?.provider || null,
      })
    ).slice(0, 32);
    return `routec_host_provider_turn_${hash}`;
  }

  resolveOutboxProviderTurnId(
    session,
    message,
    delivery,
    { eventProviderTurnId = null, eventProviderTurnIdKind = null } = {}
  ) {
    if (!delivery || !message) {
      return { providerTurnId: null, providerTurnIdKind: null };
    }
    const normalizedEventProviderTurnId =
      typeof eventProviderTurnId === "string" && eventProviderTurnId.trim()
        ? eventProviderTurnId.trim()
        : null;
    const normalizedEventProviderTurnIdKind =
      typeof eventProviderTurnIdKind === "string" &&
      eventProviderTurnIdKind.trim()
        ? eventProviderTurnIdKind.trim()
        : null;
    if (normalizedEventProviderTurnId) {
      delivery.provider_turn_id = normalizedEventProviderTurnId;
      delivery.provider_turn_id_kind =
        normalizedEventProviderTurnIdKind || "provider_reported_turn_id";
      message.providerTurnId = normalizedEventProviderTurnId;
      message.providerTurnIdKind = delivery.provider_turn_id_kind;
      return {
        providerTurnId: delivery.provider_turn_id,
        providerTurnIdKind: delivery.provider_turn_id_kind,
      };
    }
    if (delivery.provider_turn_id) {
      message.providerTurnId = delivery.provider_turn_id;
      message.providerTurnIdKind =
        delivery.provider_turn_id_kind ||
        message.providerTurnIdKind ||
        "provider_reported_turn_id";
      delivery.provider_turn_id_kind = message.providerTurnIdKind;
      return {
        providerTurnId: delivery.provider_turn_id,
        providerTurnIdKind: delivery.provider_turn_id_kind,
      };
    }
    if (message.providerTurnId) {
      delivery.provider_turn_id = message.providerTurnId;
      delivery.provider_turn_id_kind =
        message.providerTurnIdKind || "provider_reported_turn_id";
      return {
        providerTurnId: delivery.provider_turn_id,
        providerTurnIdKind: delivery.provider_turn_id_kind,
      };
    }
    const generatedProviderTurnId = this.routeCHostGeneratedProviderTurnId(
      session,
      message,
      delivery
    );
    delivery.provider_turn_id = generatedProviderTurnId;
    delivery.provider_turn_id_kind = "host_generated_provider_turn_id";
    message.providerTurnId = generatedProviderTurnId;
    message.providerTurnIdKind = delivery.provider_turn_id_kind;
    return {
      providerTurnId: delivery.provider_turn_id,
      providerTurnIdKind: delivery.provider_turn_id_kind,
    };
  }

  routeCProviderRuntimeSemanticTypeForOutboxIndex(event) {
    if (!event || event.delta === true) return null;
    const explicit =
      typeof event.semantic_type === "string" && event.semantic_type.trim()
        ? event.semantic_type.trim()
        : typeof event.semanticType === "string" && event.semanticType.trim()
        ? event.semanticType.trim()
        : null;
    const semanticType =
      explicit ||
      (event.type === "message.assistant"
        ? "message.assistant"
        : event.type === "message.thinking"
        ? "thinking.reasoning"
        : event.type === "tool.call"
        ? "tool.call"
        : event.type === "tool.update"
        ? "tool.update"
        : event.type === "tool.output" || event.type === "stderr"
        ? "tool.output"
        : event.type === "tool.result"
        ? event.is_error === true
          ? "tool.failure"
          : "tool.result"
        : null);
    if (
      semanticType === "message.assistant" ||
      semanticType === "thinking.reasoning" ||
      String(semanticType || "").startsWith("tool.")
    ) {
      return semanticType;
    }
    return null;
  }

  normalizeRouteCMatrixDelivery(delivery) {
    if (!delivery || typeof delivery !== "object") return null;
    const hostSessionId =
      typeof delivery.host_session_id === "string"
        ? delivery.host_session_id.trim()
        : "";
    const matrixRoomId =
      typeof delivery.matrix_room_id === "string"
        ? delivery.matrix_room_id.trim()
        : "";
    const sourceUserEventId =
      typeof delivery.source_user_event_id === "string"
        ? delivery.source_user_event_id.trim()
        : "";
    if (!hostSessionId || !matrixRoomId || !sourceUserEventId) {
      throw new Error(
        "Route C Matrix delivery requires host_session_id, matrix_room_id, and source_user_event_id"
      );
    }
    const providerId =
      typeof delivery.provider_id === "string"
        ? delivery.provider_id.trim()
        : null;
    return {
      marker:
        typeof delivery.marker === "string" && delivery.marker.trim()
          ? delivery.marker.trim()
          : null,
      host_session_id: hostSessionId,
      matrix_room_id: matrixRoomId,
      matrix_user_id:
        typeof delivery.matrix_user_id === "string"
          ? delivery.matrix_user_id.trim()
          : null,
      matrix_txn_id:
        typeof delivery.matrix_txn_id === "string"
          ? delivery.matrix_txn_id.trim()
          : null,
      client_request_id:
        typeof delivery.client_request_id === "string" &&
        delivery.client_request_id.trim()
          ? delivery.client_request_id.trim()
          : null,
      source_user_event_id: sourceUserEventId,
      source_user_event_id_hash:
        typeof delivery.source_user_event_id_hash === "string" &&
        delivery.source_user_event_id_hash.trim()
          ? delivery.source_user_event_id_hash.trim()
          : this.routeCStableHash(sourceUserEventId),
      source_user_event_id_hash_kind: "raw_event_id_sha256",
      target_user_event_id:
        typeof delivery.target_user_event_id === "string" &&
        delivery.target_user_event_id.trim()
          ? delivery.target_user_event_id.trim()
          : null,
      provider_id: providerId,
      provider_delivery_idempotency_key:
        typeof delivery.provider_delivery_idempotency_key === "string" &&
        delivery.provider_delivery_idempotency_key.trim()
          ? delivery.provider_delivery_idempotency_key.trim()
          : null,
      provider_delivery_idempotency_key_kind:
        typeof delivery.provider_delivery_idempotency_key_kind === "string" &&
        delivery.provider_delivery_idempotency_key_kind.trim()
          ? delivery.provider_delivery_idempotency_key_kind.trim()
          : null,
      provider_delivery_claim_id:
        typeof delivery.provider_delivery_claim_id === "string"
          ? delivery.provider_delivery_claim_id.trim()
          : null,
      provider_delivery_claimed: delivery.provider_delivery_claimed === true,
      provider_delivery_permitted:
        delivery.provider_delivery_permitted === true,
      provider_delivery_attempted:
        delivery.provider_delivery_attempted === true,
      provider_delivery_blocked_reason:
        typeof delivery.provider_delivery_blocked_reason === "string" &&
        delivery.provider_delivery_blocked_reason.trim()
          ? delivery.provider_delivery_blocked_reason.trim()
          : null,
      provider_delivery_state:
        typeof delivery.provider_delivery_state === "string" &&
        delivery.provider_delivery_state.trim()
          ? delivery.provider_delivery_state.trim()
          : null,
      host_provider_delivery_path:
        typeof delivery.host_provider_delivery_path === "string" &&
        delivery.host_provider_delivery_path.trim()
          ? delivery.host_provider_delivery_path.trim()
          : null,
      provider_turn_id:
        typeof delivery.provider_turn_id === "string"
          ? delivery.provider_turn_id.trim()
          : null,
      provider_turn_id_kind:
        typeof delivery.provider_turn_id_kind === "string"
          ? delivery.provider_turn_id_kind.trim()
          : null,
      provider_runtime_event_index:
        Number.isSafeInteger(Number(delivery.provider_runtime_event_index)) &&
        Number(delivery.provider_runtime_event_index) > 0
          ? Number(delivery.provider_runtime_event_index)
          : null,
      diagnostic_host_delivery_claim_id:
        typeof delivery.diagnostic_host_delivery_claim_id === "string" &&
        delivery.diagnostic_host_delivery_claim_id.trim()
          ? delivery.diagnostic_host_delivery_claim_id.trim()
          : null,
      diagnostic_host_delivery_claim_id_kind:
        typeof delivery.diagnostic_host_delivery_claim_id_kind === "string" &&
        delivery.diagnostic_host_delivery_claim_id_kind.trim()
          ? delivery.diagnostic_host_delivery_claim_id_kind.trim()
          : null,
      semantic_type:
        typeof delivery.semantic_type === "string" &&
        delivery.semantic_type.trim()
          ? delivery.semantic_type.trim()
          : "message.assistant",
      same_event_both_canceled_and_started:
        delivery.same_event_both_canceled_and_started === true,
      semantic_contract:
        typeof delivery.semantic_contract === "string" &&
        delivery.semantic_contract.trim()
          ? delivery.semantic_contract.trim()
          : null,
      real_codex_host_delivery: delivery.real_codex_host_delivery === true,
      real_claude_host_delivery: delivery.real_claude_host_delivery === true,
      real_provider_host_delivery:
        delivery.real_provider_host_delivery === true,
      direct_host_send_used: false,
      direct_matrix_harness_write_used: false,
      storage_seeded: false,
      real_codex_e2e_claimed: false,
      full_provider_parity_claimed: false,
      readiness_claimed: false,
      foundation_pass_claimed: false,
    };
  }

  buildDeliverySummary(session) {
    const queuedCount = (session._outbox || []).filter(
      (entry) => entry.state === "queued"
    ).length;
    const active = this.getActiveOutboxMessage(session);
    return {
      state: session._deliveryState || "starting",
      queued_count: queuedCount,
      active_message_id: active?.id || null,
      active_message_state: active?.state || null,
    };
  }

  getOysterunProviderSkillInstallationStatus({ cwd, provider }) {
    return getOysterunProviderSkillInstallationStatus({
      cwd,
      provider,
      productSkillRoots: this.productSkillRoots,
    });
  }

  installOysterunProviderSkillSet({ cwd, provider, overwrite = true }) {
    return installOysterunProviderSkillSet({
      cwd,
      provider,
      overwrite,
      productSkillRoots: this.productSkillRoots,
    });
  }

  prepareProviderRuntimeWorkspace(options) {
    return prepareProviderRuntimeWorkspace({
      ...options,
      productSkillRoots: this.productSkillRoots,
      ensureTrustedAgentRoot: ({ cwd, provider, env }) =>
        this.ensureProviderTrustedAgentRoot({ cwd, provider, env }),
    });
  }

  getDeliverySummary(sessionId) {
    const session = this.requireSession(sessionId);
    this.enforceExpiredClaimedClaudeNoOutput(session);
    return this.buildDeliverySummary(session);
  }

  getRouteCProviderLifecycle(sessionId, options = {}) {
    const session = this.requireSession(sessionId);
    this.enforceExpiredClaimedClaudeNoOutput(session);
    return this.buildRouteCProviderLifecycle(session, options);
  }

  getOutboxSnapshot(sessionId) {
    const session = this.requireSession(sessionId);
    this.enforceExpiredClaimedClaudeNoOutput(session);
    return (session._outbox || []).map((message) => ({
      id: message.id,
      message_id: message.id,
      sequence: message.sequence,
      user_id: message.userId,
      nickname: message.nickname,
      text: message.rawText,
      state: message.state,
      delivery_state: this.canonicalDeliveryStateForMessageState(message.state),
      message_type: "message",
      text_entities: [],
      media: [],
      created_at: message.createdAt,
      completed_at: message.completedAt || null,
      canceled_at: message.canceledAt || null,
      can_cancel: message.state === "queued",
      can_retry: this.isRetryableOutboxState(message.state),
      can_skip: this.isSkippableOutboxState(message.state),
      ambiguity_reason: message.ambiguityReason || null,
      error: message.error || null,
      routec_matrix_delivery: message.routeCMatrixDelivery || null,
    }));
  }

  emitOutboxMessageEvent(session, message) {
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, {
        type: "outbox.message",
        provider: session.provider,
        message_id: message.id,
        sequence: message.sequence,
        user_id: message.userId,
        nickname: message.nickname,
        text: message.rawText,
        state: message.state,
        delivery_state: this.canonicalDeliveryStateForMessageState(
          message.state
        ),
        message_type: "message",
        text_entities: [],
        media: [],
        created_at: message.createdAt,
        can_cancel: message.state === "queued",
        can_retry: this.isRetryableOutboxState(message.state),
        can_skip: this.isSkippableOutboxState(message.state),
        ambiguity_reason: message.ambiguityReason || null,
        error: message.error || null,
        routec_matrix_delivery: message.routeCMatrixDelivery || null,
      })
    );
  }

  emitDeliveryStateNotice(session) {
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, {
        type: "session.notice",
        provider: session.provider,
        subtype: "delivery.state",
        payload: this.buildDeliverySummary(session),
      })
    );
  }

  clearClaimedProviderTurnNoOutputTimer(
    session,
    messageId = null,
    { resetState = true } = {}
  ) {
    if (!session) return;
    if (
      messageId &&
      session._claimedProviderTurnNoOutputMessageId &&
      session._claimedProviderTurnNoOutputMessageId !== messageId
    ) {
      return;
    }
    if (session._claimedProviderTurnNoOutputTimer) {
      clearTimeout(session._claimedProviderTurnNoOutputTimer);
    }
    session._claimedProviderTurnNoOutputTimer = null;
    session._claimedProviderTurnNoOutputMessageId = null;
    session._claimedProviderTurnNoOutputDeadlineAt = null;
    const message = messageId ? this.getOutboxMessage(session, messageId) : null;
    if (message) {
      message.claimedClaudeNoOutputDeadlineAt = null;
    }
    if (resetState) {
      session._claimedProviderTurnNoOutputToolProgressSeen = false;
      session._claimedProviderTurnNoOutputFinalEventSeen = false;
    }
  }

  isClaimedClaudeRouteCOutboxMessage(session, message) {
    if (!session || !message?.routeCMatrixDelivery) return false;
    const delivery = message.routeCMatrixDelivery;
    const providerId =
      delivery.provider_id || session.provider || session.adapterId || null;
    return providerId === "claude" && delivery.provider_delivery_claimed === true;
  }

  claimedClaudeProviderEventSemanticType(event) {
    if (!event || typeof event !== "object") return "";
    const candidates = [
      event.semantic_type,
      event.semanticType,
      event.semantic_category,
      event.semanticCategory,
      event.category,
      event.payload?.semantic_type,
      event.payload?.semanticType,
      event.payload?.semantic_category,
      event.payload?.semanticCategory,
      event.payload?.category,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return "";
  }

  normalizeClaimedClaudeProviderCompletionStatus(candidate) {
    if (typeof candidate !== "string" || !candidate.trim()) return "";
    const normalized = candidate.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (
      normalized === "completed" ||
      normalized === "complete" ||
      normalized === "succeeded" ||
      normalized === "success" ||
      normalized === "turn_completed" ||
      normalized === "provider_turn_completed"
    ) {
      return "completed";
    }
    if (
      normalized === "failed" ||
      normalized === "failure" ||
      normalized === "turn_failed" ||
      normalized === "provider_turn_failed"
    ) {
      return "failed";
    }
    if (normalized === "error" || normalized === "errored") return "error";
    if (
      normalized === "interrupted" ||
      normalized === "canceled" ||
      normalized === "cancelled" ||
      normalized === "turn_interrupted" ||
      normalized === "provider_turn_interrupted"
    ) {
      return "interrupted";
    }
    return normalized;
  }

  claimedClaudeProviderCompletionStatus(event) {
    if (!event || typeof event !== "object") return "";
    const delivery = this.eventRouteCMatrixDelivery(event);
    const candidates = [
      event.status,
      event.state,
      event.lifecycle,
      event.provider_completion_status,
      event.provider_completion_state,
      event.completion_status,
      event.completion_state,
      event.stop_reason === "end_turn" ? "completed" : null,
      event.payload?.status,
      event.payload?.state,
      event.payload?.lifecycle,
      event.payload?.provider_completion_status,
      event.payload?.provider_completion_state,
      event.payload?.completion_status,
      event.payload?.completion_state,
      delivery?.status,
      delivery?.state,
      delivery?.lifecycle,
      delivery?.provider_completion_status,
      delivery?.provider_completion_state,
      delivery?.completion_status,
      delivery?.completion_state,
    ];
    for (const candidate of candidates) {
      const normalized =
        this.normalizeClaimedClaudeProviderCompletionStatus(candidate);
      if (normalized) return normalized;
    }
    return "";
  }

  isClaimedClaudeToolProgressSemanticType(semanticType) {
    return (
      semanticType === "tool.call" ||
      semanticType === "tool.output" ||
      semanticType === "tool.result" ||
      semanticType === "tool.failure" ||
      semanticType.startsWith("tool.")
    );
  }

  isClaimedClaudeProviderCompletionEvent(event) {
    if (!event || typeof event !== "object") return false;
    const eventType = typeof event.type === "string" ? event.type.trim() : "";
    if (eventType === "turn.completed") return true;
    const semanticType = this.claimedClaudeProviderEventSemanticType(event);
    if (
      eventType !== "session.lifecycle" &&
      eventType !== "routec.semantic.event" &&
      semanticType !== "session_lifecycle"
    ) {
      return false;
    }
    const status = this.claimedClaudeProviderCompletionStatus(event);
    return (
      status === "completed" ||
      status === "complete" ||
      status === "succeeded" ||
      status === "success"
    );
  }

  isFailedClaimedClaudeProviderCompletionEvent(event) {
    if (!event || typeof event !== "object") return false;
    if (event.error) return true;
    const status = this.claimedClaudeProviderCompletionStatus(event);
    return status === "failed" || status === "error" || status === "errored";
  }

  isInterruptedClaimedClaudeProviderCompletionEvent(event) {
    if (!event || typeof event !== "object") return false;
    const status = this.claimedClaudeProviderCompletionStatus(event);
    return (
      status === "interrupted" ||
      status === "canceled" ||
      status === "cancelled"
    );
  }

  isClaimedClaudeCompletionSatisfyingEvent(event) {
    if (!event || typeof event !== "object") return false;
    const semanticType = this.claimedClaudeProviderEventSemanticType(event);
    if (
      this.isClaimedClaudeToolProgressSemanticType(semanticType) ||
      semanticType === "thinking.reasoning"
    ) {
      return false;
    }
    const eventType = typeof event.type === "string" ? event.type.trim() : "";
    if (
      eventType === "message.assistant" ||
      eventType === "control.request" ||
      eventType === "control.outcome" ||
      eventType === "runtime.error" ||
      eventType === "session.exit" ||
      eventType === "routec.semantic.absence"
    ) {
      return true;
    }
    return (
      semanticType === "message.assistant" ||
      semanticType === "control.request" ||
      semanticType === "control.outcome" ||
      semanticType === "runtime.error" ||
      semanticType === "session.exit" ||
      semanticType === "routec.semantic.absence"
    );
  }

  isAssistantMessageRuntimeEvent(event) {
    if (!event || typeof event !== "object") return false;
    const semanticType = this.claimedClaudeProviderEventSemanticType(event);
    const assistantEvent =
      event.type === "message.assistant" ||
      semanticType === "message.assistant";
    if (!assistantEvent) return false;
    const textCandidates = [
      event.text,
      event.body,
      event.display_text,
      event.semantic_body,
      event.content,
    ];
    return textCandidates.some(
      (candidate) => typeof candidate === "string" && candidate.trim()
    );
  }

  isToolProgressOutboxEvent(event) {
    if (!event || typeof event !== "object") return false;
    const semanticType = this.claimedClaudeProviderEventSemanticType(event);
    return (
      event.type === "tool.call" ||
      event.type === "tool.output" ||
      event.type === "tool.result" ||
      event.type === "stderr" ||
      this.isClaimedClaudeToolProgressSemanticType(semanticType)
    );
  }

  eventRouteCMatrixDelivery(event) {
    if (!event || typeof event !== "object") return null;
    const candidates = [
      event.routec_matrix_delivery,
      event.routeCMatrixDelivery,
      event.routecMatrixDelivery,
      event.payload?.routec_matrix_delivery,
      event.payload?.routeCMatrixDelivery,
      event.payload?.routecMatrixDelivery,
      event.delivery,
    ];
    return (
      candidates.find((candidate) => candidate && typeof candidate === "object") ||
      null
    );
  }

  eventProviderMetadataId(event, delivery, keys) {
    for (const key of keys) {
      const value = normalizeProviderMetadataId(event?.[key]);
      if (value) return value;
    }
    for (const key of keys) {
      const value = normalizeProviderMetadataId(delivery?.[key]);
      if (value) return value;
    }
    for (const key of keys) {
      const value = normalizeProviderMetadataId(event?.payload?.[key]);
      if (value) return value;
    }
    return null;
  }

  eventMatchesClaimedClaudeDelivery(session, message, event) {
    if (!this.isClaimedClaudeRouteCOutboxMessage(session, message)) return false;
    const delivery = message.routeCMatrixDelivery || null;
    const eventDelivery = this.eventRouteCMatrixDelivery(event);
    const eventProvider =
      this.eventProviderMetadataId(event, eventDelivery, [
        "provider",
        "provider_id",
        "adapterId",
      ]) || null;
    if (eventProvider && eventProvider !== "claude") return false;

    const eventHostSessionId = this.eventProviderMetadataId(
      event,
      eventDelivery,
      ["host_session_id", "session_id", "sessionId"]
    );
    if (
      eventHostSessionId &&
      eventHostSessionId !== session.id &&
      eventHostSessionId !== delivery?.host_session_id
    ) {
      return false;
    }

    const eventMatrixRoomId = this.eventProviderMetadataId(event, eventDelivery, [
      "matrix_room_id",
      "room_id",
      "roomId",
    ]);
    if (
      eventMatrixRoomId &&
      delivery?.matrix_room_id &&
      eventMatrixRoomId !== delivery.matrix_room_id
    ) {
      return false;
    }

    const matchPairs = [
      [
        this.eventProviderMetadataId(event, eventDelivery, ["outbox_message_id"]),
        message.id,
      ],
      [
        this.eventProviderMetadataId(event, eventDelivery, [
          "host_outbox_id",
          "host_message_id",
          "message_id",
        ]),
        message.id,
      ],
      [
        this.eventProviderMetadataId(event, eventDelivery, [
          "provider_delivery_claim_id",
          "delivery_claim_id",
        ]),
        delivery?.provider_delivery_claim_id || message.id,
      ],
      [
        this.eventProviderMetadataId(event, eventDelivery, [
          "source_user_event_id",
          "server_event_id",
          "event_id",
        ]),
        delivery?.source_user_event_id,
      ],
      [
        this.eventProviderMetadataId(event, eventDelivery, [
          "target_user_event_id",
        ]),
        delivery?.target_user_event_id,
      ],
      [
        this.eventProviderMetadataId(event, eventDelivery, [
          "provider_turn_id",
          "turn_id",
          "turnId",
          "provider_completion_turn_id",
          "target_turn_id",
          "targetTurnId",
        ]),
        delivery?.provider_turn_id || message.providerTurnId,
      ],
    ];

    return matchPairs.some(([eventValue, messageValue]) => {
      const normalizedMessageValue = normalizeProviderMetadataId(messageValue);
      return (
        eventValue &&
        normalizedMessageValue &&
        eventValue === normalizedMessageValue
      );
    });
  }

  findClaimedClaudeOutboxMessageForEvent(session, event, activeMessage = null) {
    if (
      activeMessage &&
      this.isClaimedClaudeRouteCOutboxMessage(session, activeMessage)
    ) {
      return activeMessage;
    }
    return (
      (session?._outbox || []).find((message) => {
        if (message.state === "failed" || message.state === "canceled") {
          return false;
        }
        return this.eventMatchesClaimedClaudeDelivery(session, message, event);
      }) || null
    );
  }

  claimedClaudeCompletionBelongsToSession(session, event) {
    if (!session || !event || typeof event !== "object") return false;
    const eventDelivery = this.eventRouteCMatrixDelivery(event);
    const eventProvider =
      this.eventProviderMetadataId(event, eventDelivery, [
        "provider",
        "provider_id",
        "adapterId",
      ]) || null;
    if (eventProvider && eventProvider !== "claude") return false;
    const eventHostSessionId = this.eventProviderMetadataId(
      event,
      eventDelivery,
      ["host_session_id", "session_id", "sessionId"]
    );
    return !eventHostSessionId || eventHostSessionId === session.id;
  }

  findOnlyUnresolvedClaimedClaudeOutboxMessage(session, event) {
    if (!this.claimedClaudeCompletionBelongsToSession(session, event)) {
      return null;
    }
    const candidates = (session?._outbox || []).filter((message) => {
      if (message.state === "failed" || message.state === "canceled") {
        return false;
      }
      if (!this.isClaimedClaudeRouteCOutboxMessage(session, message)) {
        return false;
      }
      return this.hasClaimedClaudeFinalCompletionEvent(session, message) !== true;
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  findClaimedClaudeOutboxMessageForCompletionEvent(
    session,
    event,
    activeMessage = null
  ) {
    const matched = this.findClaimedClaudeOutboxMessageForEvent(
      session,
      event,
      activeMessage
    );
    if (matched) return matched;
    if (!this.isClaimedClaudeProviderCompletionEvent(event)) return null;
    const messageId = session?._claimedProviderTurnNoOutputMessageId || null;
    if (messageId) {
      const message = (session?._outbox || []).find(
        (entry) => entry.id === messageId
      );
      if (
        message &&
        message.state !== "failed" &&
        message.state !== "canceled" &&
        this.isClaimedClaudeRouteCOutboxMessage(session, message) &&
        this.hasClaimedClaudeFinalCompletionEvent(session, message) !== true
      ) {
        return message;
      }
    }
    return this.findOnlyUnresolvedClaimedClaudeOutboxMessage(session, event);
  }

  claimedClaudeNoOutputReason(session, message) {
    return message?.claimedClaudeToolProgressSeen === true ||
      session?._activeOutboxToolProgressSeen === true ||
      session?._claimedProviderTurnNoOutputToolProgressSeen === true
      ? "claude_claimed_provider_turn_tool_result_no_assistant_completion"
      : "claude_claimed_provider_turn_no_output";
  }

  claimedClaudeNoOutputDeadlineForMessage(session, message) {
    if (!session || !message) return null;
    if (typeof message.claimedClaudeNoOutputDeadlineAt === "number") {
      return message.claimedClaudeNoOutputDeadlineAt;
    }
    if (
      session._claimedProviderTurnNoOutputMessageId === message.id &&
      typeof session._claimedProviderTurnNoOutputDeadlineAt === "number"
    ) {
      return session._claimedProviderTurnNoOutputDeadlineAt;
    }
    if (
      typeof message.claimedClaudeNoOutputArmedAt === "number" &&
      this.claudeClaimedTurnNoOutputTimeoutMs > 0
    ) {
      return (
        message.claimedClaudeNoOutputArmedAt +
        this.claudeClaimedTurnNoOutputTimeoutMs
      );
    }
    return null;
  }

  isClaimedClaudeNoOutputEnforceable(
    session,
    message,
    { nowMs = Date.now(), force = false } = {}
  ) {
    if (!this.isClaimedClaudeRouteCOutboxMessage(session, message)) return false;
    if (
      message.state === "queued" ||
      message.state === "failed" ||
      message.state === "canceled"
    ) {
      return false;
    }
    if (this.hasClaimedClaudeFinalCompletionEvent(session, message) === true) {
      return false;
    }
    if (force === true) return true;
    const deadlineAt = this.claimedClaudeNoOutputDeadlineForMessage(
      session,
      message
    );
    return deadlineAt !== null && deadlineAt <= nowMs;
  }

  findExpiredClaimedClaudeNoOutputMessage(session, nowMs = Date.now()) {
    if (!session) return null;
    const activeMessage = this.getActiveOutboxMessage(session);
    const sessionMessageId = session._claimedProviderTurnNoOutputMessageId || null;
    const candidates = [
      activeMessage,
      sessionMessageId ? this.getOutboxMessage(session, sessionMessageId) : null,
      ...(session._outbox || []),
    ];
    const seen = new Set();
    for (const message of candidates) {
      if (!message || seen.has(message.id)) continue;
      seen.add(message.id);
      if (
        this.isClaimedClaudeNoOutputEnforceable(session, message, {
          nowMs,
        })
      ) {
        return message;
      }
    }
    return null;
  }

  isProviderPromptInFlight(session) {
    if (!session) return false;
    if (typeof session.hasActivePromptInFlight === "function") {
      try {
        return session.hasActivePromptInFlight() === true;
      } catch {
        return false;
      }
    }
    if (
      session.activePromptState &&
      session.activePromptState.promptSlotReleased !== true &&
      session.activePromptState.completionEmitted !== true
    ) {
      return true;
    }
    return (
      typeof session.activePromptCount === "number" &&
      session.activePromptCount > 0
    );
  }

  emitClaimedClaudeInFlightTimeoutDiagnostic(
    session,
    message,
    {
      reason = "claude_claimed_provider_turn_no_output",
      phase = "claimed_provider_turn_timeout",
    } = {}
  ) {
    if (!this.isClaimedClaudeRouteCOutboxMessage(session, message)) return false;
    const generation = message.claimedClaudeNoOutputGeneration || 0;
    if (
      message.claimedClaudeInFlightTimeoutDiagnosticGeneration === generation
    ) {
      return true;
    }
    message.claimedClaudeInFlightTimeoutDiagnosticGeneration = generation;
    const diagnostic = this.buildClaimedClaudeNoOutputDiagnostic(
      session,
      message,
      reason
    );
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, {
        type: "session.notice",
        provider: "claude",
        subtype: "provider.turn_still_running",
        payload: {
          phase,
          reason,
          diagnostic,
          outbox_message_id: message.id,
          active_prompt_in_flight: true,
        },
        replay_policy: "latest_state_only",
      })
    );
    return true;
  }

  enforceClaimedClaudeNoOutputMessage(
    session,
    message,
    {
      nowMs = Date.now(),
      phase = "claimed_provider_turn_timeout",
      force = false,
    } = {}
  ) {
    if (
      !this.isClaimedClaudeNoOutputEnforceable(session, message, {
        nowMs,
        force,
      })
    ) {
      return false;
    }
    if (
      phase === "claimed_provider_turn_timeout" &&
      this.isProviderPromptInFlight(session)
    ) {
      return this.emitClaimedClaudeInFlightTimeoutDiagnostic(session, message, {
        reason: this.claimedClaudeNoOutputReason(session, message),
        phase,
      });
    }
    return this.emitClaimedClaudeNoOutputDiagnostic(session, message, {
      reason: this.claimedClaudeNoOutputReason(session, message),
      timedOut: true,
      phase,
      allowCompleted: true,
    });
  }

  enforceExpiredClaimedClaudeNoOutput(
    session,
    { nowMs = Date.now(), phase = "claimed_provider_turn_timeout" } = {}
  ) {
    const message = this.findExpiredClaimedClaudeNoOutputMessage(session, nowMs);
    if (!message) return false;
    return this.enforceClaimedClaudeNoOutputMessage(session, message, {
      nowMs,
      phase,
    });
  }

  claimedClaudeCompletedNoFinalReason(session, message) {
    return message?.claimedClaudeToolProgressSeen === true ||
      session?._activeOutboxToolProgressSeen === true ||
      session?._claimedProviderTurnNoOutputToolProgressSeen === true
      ? "claude_claimed_provider_turn_tool_result_no_assistant_completion"
      : "claude_claimed_provider_turn_completed_no_output";
  }

  hasClaimedClaudeFinalCompletionEvent(session, message) {
    if (!message) return false;
    if (message.claimedClaudeFinalEventSeen === true) return true;
    return (
      session?._claimedProviderTurnNoOutputMessageId === message.id &&
      session?._claimedProviderTurnNoOutputFinalEventSeen === true
    );
  }

  buildClaimedClaudeNoOutputDiagnostic(session, message, reason) {
    const delivery = message?.routeCMatrixDelivery || null;
    const toolOnly =
      reason === "claude_claimed_provider_turn_tool_result_no_assistant_completion";
    return {
      code: reason,
      message:
        toolOnly
          ? "Claude provider turn produced tool output but no assistant/control/error/exit completion after Host claimed delivery"
          : "Claude provider turn produced no assistant/tool/control/error/exit output after Host claimed delivery",
      provider: "claude",
      session_id: session?.id || null,
      outbox_message_id: message?.id || null,
      provider_delivery_claim_id:
        delivery?.provider_delivery_claim_id || message?.id || null,
      source_user_event_id: delivery?.source_user_event_id || null,
    };
  }

  providerTerminalFailureErrorText(event) {
    if (!event || typeof event !== "object") return "";
    const candidates = [
      event.error,
      event.error?.message,
      event.error?.code,
      event.error_code,
      event.error_message,
      event.reason,
      event.statusText,
      event.context?.error,
      event.context?.reason,
      event.payload?.error,
      event.payload?.error?.message,
      event.payload?.reason,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return "";
  }

  classifyProviderAuthFailure(_session, _message, event) {
    const errorText = this.providerTerminalFailureErrorText(event);
    if (errorText && PROVIDER_AUTH_FAILURE_PATTERN.test(errorText)) {
      return {
        failureClassification: PROVIDER_SESSION_AUTH_FAILURE_CLASSIFICATION,
        message: PROVIDER_SESSION_AUTH_FAILURE_MESSAGE,
        errorOrigin: "provider_runtime",
        errorScope: "provider_authentication",
      };
    }
    return null;
  }

  classifyProviderTerminalNoOutputFailure(_session, _message, event) {
    const authFailure = this.classifyProviderAuthFailure(_session, _message, event);
    if (authFailure) return authFailure;
    const errorText = this.providerTerminalFailureErrorText(event);
    if (errorText) return null;
    return {
      failureClassification: PROVIDER_TURN_FAILED_NO_OUTPUT_CLASSIFICATION,
      message: PROVIDER_TURN_FAILED_NO_OUTPUT_MESSAGE,
      errorOrigin: "provider_runtime",
      errorScope: "provider_turn",
    };
  }

  isProviderTerminalNoOutputFailureCandidate(session, message, event) {
    if (!session || !message?.routeCMatrixDelivery) return false;
    if (this.isFailedClaimedClaudeProviderCompletionEvent(event) !== true) {
      return false;
    }
    if (this.isInterruptedClaimedClaudeProviderCompletionEvent(event) === true) {
      return false;
    }
    if (message.providerTerminalNoOutputFailureEmitted === true) return false;
    if (message.providerAssistantMessageSeen === true) return false;
    if (message.claimedClaudeProviderVisibleEventSeen === true) return false;
    if (session._activeOutboxProviderVisibleEventSeen === true) return false;
    return Boolean(
      this.classifyProviderTerminalNoOutputFailure(session, message, event)
    );
  }

  applyProviderTerminalFailureClassification(
    session,
    message,
    event,
    classification,
    { normalizeToLifecycleEvent = false } = {}
  ) {
    if (!classification || !message?.routeCMatrixDelivery || !event) {
      return null;
    }
    const delivery = message.routeCMatrixDelivery || null;
    const providerId =
      delivery?.provider_id || event.provider || session.provider || "provider";
    const agentTurnStarted =
      delivery?.host2_intake_proof?.agent_turn_started === true ||
      delivery?.agent_turn_started === true ||
      session._activeOutboxProgressSeen === true;
    const lastAgentMessagePresent = message.providerAssistantMessageSeen === true;
    const originalRuntimeEventType = event.type || null;
    const originalRuntimeError =
      typeof event.error === "string"
        ? event.error
        : event.error?.message || event.error_code || event.error_message || null;
    message.providerTerminalNoOutputFailureEmitted = true;
    message.providerTerminalFailureClassification =
      classification.failureClassification;
    message.providerLastAgentMessagePresent = lastAgentMessagePresent;
    if (delivery) {
      delivery.provider_delivery_state = classification.failureClassification;
      delivery.provider_delivery_failure_reason =
        classification.failureClassification;
      delivery.diagnostic_reason = classification.failureClassification;
      delivery.failure_classification = classification.failureClassification;
      delivery.error_origin = classification.errorOrigin;
      delivery.error_scope = classification.errorScope;
      delivery.last_agent_message_present = lastAgentMessagePresent;
      delivery.agent_turn_started = agentTurnStarted;
      delivery.provider_started_for_target_event = agentTurnStarted;
      const proof = recordRouteCProviderDeliveryFailure({
        hostSessionId: delivery.host_session_id,
        matrixRoomId: delivery.matrix_room_id,
        serverEventId: delivery.source_user_event_id,
        providerId,
        error: classification.failureClassification,
      });
      if (proof) {
        delivery.host2_intake_proof = proof;
      }
    }
    Object.assign(event, {
      ...(normalizeToLifecycleEvent
        ? {
            type: "session.lifecycle",
            lifecycle: "failed",
            lifecycle_reason: "provider_authentication_failed",
          }
        : {}),
      status: "failed",
      provider_completion_status: "failed",
      provider_completion_success: false,
      provider_completion_success_required: false,
      failure_classification: classification.failureClassification,
      error_origin: classification.errorOrigin,
      error_scope: classification.errorScope,
      agent_turn_started: agentTurnStarted,
      provider_started_for_target_event: agentTurnStarted,
      last_agent_message_present: lastAgentMessagePresent,
      semantic_type: "session_lifecycle",
      semantic_body: classification.message,
      display_text: classification.message,
      body: classification.message,
      provider_auth_failure_original_runtime_event_type: originalRuntimeEventType,
      provider_auth_failure_original_error: originalRuntimeError,
      error:
        event.error || {
          code: classification.failureClassification,
          message: classification.message,
          provider: providerId,
          session_id: session.id || null,
          outbox_message_id: message.id || null,
          source_user_event_id: delivery?.source_user_event_id || null,
          provider_turn_id:
            delivery?.provider_turn_id || event.provider_turn_id || null,
        },
    });
    event.routec_matrix_delivery = {
      ...(event.routec_matrix_delivery || delivery || {}),
      ...(delivery || {}),
      outbox_message_id: message.id,
      provider_id: providerId,
      semantic_type: "session_lifecycle",
      failure_classification: classification.failureClassification,
      error_origin: classification.errorOrigin,
      error_scope: classification.errorScope,
      agent_turn_started: agentTurnStarted,
      provider_started_for_target_event: agentTurnStarted,
      last_agent_message_present: lastAgentMessagePresent,
      provider_delivery_failure_reason: classification.failureClassification,
    };
    return classification;
  }

  markProviderTerminalNoOutputFailure(session, message, event) {
    if (
      !this.isProviderTerminalNoOutputFailureCandidate(session, message, event)
    ) {
      return null;
    }
    const classification = this.classifyProviderTerminalNoOutputFailure(
      session,
      message,
      event
    );
    if (!classification) return null;
    return this.applyProviderTerminalFailureClassification(
      session,
      message,
      event,
      classification
    );
  }

  markProviderRuntimeAuthFailure(session, message, event) {
    if (!session || !message?.routeCMatrixDelivery || !event) return null;
    if (event.type !== "runtime.error") return null;
    if (message.providerTerminalNoOutputFailureEmitted === true) return null;
    const classification = this.classifyProviderAuthFailure(
      session,
      message,
      event
    );
    if (!classification) return null;
    return this.applyProviderTerminalFailureClassification(
      session,
      message,
      event,
      classification,
      { normalizeToLifecycleEvent: true }
    );
  }

  emitClaimedClaudeNoOutputDiagnostic(
    session,
    message,
    {
      reason = "claude_claimed_provider_turn_no_output",
      completionEvent = null,
      timedOut = false,
      phase = null,
      allowCompleted = false,
    } = {}
  ) {
    if (!this.isClaimedClaudeRouteCOutboxMessage(session, message)) return false;
    if (
      (message.state === "completed" && allowCompleted !== true) ||
      message.state === "failed" ||
      message.state === "canceled"
    ) {
      this.clearClaimedProviderTurnNoOutputTimer(session, message.id);
      return false;
    }
    this.clearClaimedProviderTurnNoOutputTimer(session, message.id);
    const diagnostic = this.buildClaimedClaudeNoOutputDiagnostic(
      session,
      message,
      reason
    );
    const delivery = message.routeCMatrixDelivery || null;
    if (delivery) {
      delivery.provider_delivery_state = reason;
      delivery.provider_delivery_failure_reason = reason;
      delivery.diagnostic_reason = reason;
      delivery.diagnostic_host_delivery_claim_id =
        delivery.provider_delivery_claim_id || message.id;
      delivery.diagnostic_host_delivery_claim_id_kind = "host_delivery_claim_id";
      const proof = recordRouteCProviderDeliveryFailure({
        hostSessionId: delivery.host_session_id,
        matrixRoomId: delivery.matrix_room_id,
        serverEventId: delivery.source_user_event_id,
        providerId: delivery.provider_id || session.provider || "claude",
        error: reason,
      });
      if (proof) {
        delivery.host2_intake_proof = proof;
      }
    }
    message.state = "failed";
    message.error = diagnostic.message;
    message.ambiguityReason = reason;
    message.completedAt = new Date().toISOString();
    session._activeOutboxMessageId = null;
    session._activeOutboxProgressSeen = false;
    session._activeOutboxProviderVisibleEventSeen = false;
    session._activeOutboxToolProgressSeen = false;
    this.emitOutboxMessageEvent(session, message);
    const runtimeErrorEvent = this.decorateEvent(session, {
      type: "runtime.error",
      provider: "claude",
      error: diagnostic,
      context: {
        phase: phase || (timedOut ? "claimed_provider_turn_timeout" : "turn.completed"),
        reason,
        provider_delivery_claim_id: diagnostic.provider_delivery_claim_id,
        source_user_event_id: diagnostic.source_user_event_id,
      },
      display_text: diagnostic.message,
      routec_matrix_delivery: delivery,
    });
    this.emit("runtimeEvent", session.agentId, runtimeErrorEvent);
    if (completionEvent) {
      completionEvent.status = "failed";
      completionEvent.provider_completion_status = "failed";
      completionEvent.provider_completion_success = false;
      completionEvent.error = diagnostic;
      completionEvent.diagnostic_reason = reason;
      completionEvent.routec_matrix_delivery = delivery;
    }
    this.emitDeliveryStateNotice(session);
    this.drainOutbox(session);
    return true;
  }

  armClaimedClaudeNoOutputTimer(
    session,
    message,
    { preserveProgress = false } = {}
  ) {
    if (!this.isClaimedClaudeRouteCOutboxMessage(session, message)) return;
    if (this.claudeClaimedTurnNoOutputTimeoutMs <= 0) return;
    const sameMessage =
      session._claimedProviderTurnNoOutputMessageId === message.id;
    const toolProgressSeen =
      message.claimedClaudeToolProgressSeen === true ||
      (preserveProgress === true &&
        sameMessage &&
        session._claimedProviderTurnNoOutputToolProgressSeen === true);
    this.clearClaimedProviderTurnNoOutputTimer(session, null, {
      resetState: false,
    });
    const messageId = message.id;
    const armedAt = Date.now();
    const deadlineAt = armedAt + this.claudeClaimedTurnNoOutputTimeoutMs;
    const generation = (session._claimedProviderTurnNoOutputGeneration || 0) + 1;
    session._claimedProviderTurnNoOutputMessageId = messageId;
    session._claimedProviderTurnNoOutputDeadlineAt = deadlineAt;
    session._claimedProviderTurnNoOutputGeneration = generation;
    session._claimedProviderTurnNoOutputToolProgressSeen = toolProgressSeen;
    session._claimedProviderTurnNoOutputFinalEventSeen = false;
    message.claimedClaudeNoOutputArmedAt = armedAt;
    message.claimedClaudeNoOutputDeadlineAt = deadlineAt;
    message.claimedClaudeNoOutputGeneration = generation;
    const enforceTimeout = () => {
      const liveSession = this.sessions.get(session.id);
      if (!liveSession) return;
      const activeMessage = this.getActiveOutboxMessage(liveSession);
      const targetMessage =
        activeMessage?.id === messageId
          ? activeMessage
          : (liveSession._outbox || []).find((entry) => entry.id === messageId);
      if (!targetMessage) return;
      if (
        liveSession._claimedProviderTurnNoOutputGeneration !== generation ||
        targetMessage.claimedClaudeNoOutputGeneration !== generation
      ) {
        return;
      }
      this.enforceClaimedClaudeNoOutputMessage(liveSession, targetMessage, {
        nowMs: Date.now(),
        phase: "claimed_provider_turn_timeout",
        force: true,
      });
    };
    const timer = setTimeout(
      enforceTimeout,
      this.claudeClaimedTurnNoOutputTimeoutMs
    );
    timer.unref?.();
    session._claimedProviderTurnNoOutputTimer = timer;
    const failsafeTimer = setTimeout(
      enforceTimeout,
      this.claudeClaimedTurnNoOutputTimeoutMs +
        Math.min(50, Math.max(1, this.claudeClaimedTurnNoOutputTimeoutMs))
    );
    failsafeTimer.unref?.();
  }

  providerControlKindFromPendingRequest(pendingRequest) {
    const subtype =
      typeof pendingRequest?.subtype === "string"
        ? pendingRequest.subtype.trim()
        : "";
    if (!subtype) {
      throw new Error("Provider control request is missing subtype");
    }
    if (subtype === "command" || subtype === "command_execution")
      return "command";
    if (subtype === "patch" || subtype === "file_change") return "patch";
    if (subtype === "permissions" || subtype === "permission")
      return "permissions";
    if (subtype === "user_input") return "user_input";
    if (subtype === "mcp_elicitation") return "mcp_elicitation";
    if (subtype === "exit_plan") return "exit_plan";
    if (subtype === "can_use_tool") {
      const toolName =
        typeof pendingRequest?.payload?.tool_name === "string"
          ? pendingRequest.payload.tool_name.trim()
          : "";
      if (toolName === "Bash") return "command";
      if (
        toolName === "Edit" ||
        toolName === "Write" ||
        toolName === "MultiEdit"
      )
        return "patch";
      if (toolName === "ExitPlanMode") return "exit_plan";
      return "permissions";
    }
    throw new Error(`Unsupported provider control subtype: ${subtype}`);
  }

  providerControlAllowedActions(controlKind) {
    switch (controlKind) {
      case "command":
      case "patch":
      case "permissions":
      case "exit_plan":
        return ["accept", "reject"];
      case "user_input":
      case "mcp_elicitation":
        return ["submit", "reject"];
      default:
        throw new Error(
          `Unsupported provider control kind for actions: ${controlKind}`
        );
    }
  }

  emitProviderControlOutcomeEvent(
    session,
    pendingRequest,
    responsePayload = {}
  ) {
    if (!session?.id || !pendingRequest?.request_id) {
      throw new Error(
        "Provider control outcome requires session and pending request id"
      );
    }
    const controlKind =
      this.providerControlKindFromPendingRequest(pendingRequest);
    const outcome = responsePayload.allow === false ? "rejected" : "accepted";
    const controlOutcomeId = `routec_control_outcome_${this.routeCStableHash(
      JSON.stringify({
        host_session_id: session.id,
        control_request_id: pendingRequest.request_id,
        outcome,
        provider: session.provider || session.adapterId || null,
      })
    ).slice(0, 32)}`;
    const event = {
      type: "control.outcome",
      provider: session.provider || session.adapterId || "claude",
      request_id: pendingRequest.request_id,
      control_request_id: pendingRequest.request_id,
      control_outcome_id: controlOutcomeId,
      control_kind: controlKind,
      control_family: "provider_request",
      control_origin: "user",
      actor: "oysterun-ui",
      outcome,
      control_outcome: outcome,
      target_id: pendingRequest.request_id,
      target_turn_id: session._activeOutboxMessageId || null,
      target_session_id: session.id,
      allowed_actions: this.providerControlAllowedActions(controlKind),
      sensitive: pendingRequest.sensitive === true,
      semantic_body:
        outcome === "accepted"
          ? `Provider control ${controlKind} accepted.`
          : `Provider control ${controlKind} rejected.`,
      source_label: "host_provider_control_response",
      durable: true,
      replay_policy: "always",
    };
    this.handleOutboxRuntimeEvent(session, event);
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, event)
    );
  }

  emitOutboxCancelControlEvent(
    session,
    message,
    { semanticType, outcome = null } = {}
  ) {
    if (!session?.id || !message?.id) {
      throw new Error(
        "Outbox cancel control event requires session and message"
      );
    }
    const delivery = message.routeCMatrixDelivery || null;
    if (!delivery) return;
    const controlRequestId = `routec_control_cancel_${this.routeCStableHash(
      JSON.stringify({
        host_session_id: session.id,
        message_id: message.id,
        created_at: message.createdAt,
      })
    ).slice(0, 32)}`;
    const targetEventId = delivery.source_user_event_id || null;
    const baseEvent = {
      type: semanticType,
      provider: session.provider || session.adapterId || "claude",
      request_id: controlRequestId,
      control_request_id: controlRequestId,
      control_kind: "cancel",
      control_family: "session_control",
      control_origin: "user",
      actor: "oysterun-ui",
      target_id: message.id,
      target_user_event_id: targetEventId,
      target_event_id: targetEventId,
      target_event_id_kind: targetEventId ? "server" : null,
      target_session_id: session.id,
      target_turn_id: message.providerTurnId || null,
      allowed_actions: ["cancel"],
      source_label: "host_outbox_cancel_control",
      durable: true,
      routec_matrix_delivery: {
        ...delivery,
        outbox_message_id: message.id,
        target_user_event_id: targetEventId,
      },
    };
    if (semanticType === "control.request") {
      this.emit(
        "runtimeEvent",
        session.agentId,
        this.decorateEvent(session, {
          ...baseEvent,
          semantic_body: `Cancel requested for queued message ${message.id}.`,
          replay_policy: "latest_state_only",
        })
      );
      return;
    }
    const controlOutcomeId = `routec_control_outcome_${this.routeCStableHash(
      JSON.stringify({
        host_session_id: session.id,
        control_request_id: controlRequestId,
        outcome,
        target_id: message.id,
      })
    ).slice(0, 32)}`;
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, {
        ...baseEvent,
        semantic_body: `Cancel ${outcome} for queued message ${message.id}.`,
        control_outcome_id: controlOutcomeId,
        control_outcome: outcome,
        outcome,
        replay_policy: "always",
      })
    );
  }

  parseSlashCommand(text) {
    if (typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;
    const commandName = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() || "";
    if (!commandName) return null;
    return {
      rawText: trimmed,
      commandName,
    };
  }

  enqueueOutboxMessage(
    session,
    userId,
    nickname,
    text,
    {
      messageId = null,
      routeCMatrixDelivery = null,
      providerTextOverride = null,
    } = {}
  ) {
    const normalizedMessageId =
      typeof messageId === "string" ? messageId.trim() : "";
    const normalizedProviderTextOverride =
      typeof providerTextOverride === "string" ? providerTextOverride : null;
    if (normalizedMessageId) {
      const existing = this.getOutboxMessage(session, normalizedMessageId);
      if (existing) {
        if (
          existing.userId !== userId ||
          existing.nickname !== nickname ||
          existing.rawText !== text
        ) {
          throw new Error(
            `Outbox message ${normalizedMessageId} conflicts with an existing payload`
          );
        }
        if (routeCMatrixDelivery) {
          existing.routeCMatrixDelivery =
            existing.routeCMatrixDelivery ||
            this.normalizeRouteCMatrixDelivery(routeCMatrixDelivery);
        }
        if (
          normalizedProviderTextOverride !== null &&
          existing.providerText !== normalizedProviderTextOverride
        ) {
          throw new Error(
            `Outbox message ${normalizedMessageId} conflicts with an existing provider prompt`
          );
        }
        return existing;
      }
    }
    const slashCommand = this.parseSlashCommand(text);
    if (slashCommand?.commandName === "install_oysterun_skill") {
      return this.handleOysterunProviderSkillInstallSlashCommand(
        session,
        userId,
        nickname,
        text,
        {
          messageId: normalizedMessageId,
          routeCMatrixDelivery,
        }
      );
    }
    const message = {
      id: normalizedMessageId || randomUUID(),
      sequence: session._nextOutboxSequence++,
      userId,
      nickname,
      rawText: text,
      isSlashCommand: Boolean(slashCommand),
      slashCommandName: slashCommand?.commandName || null,
      attributedText: `[${nickname}]: ${text}`,
      providerText:
        normalizedProviderTextOverride !== null
          ? normalizedProviderTextOverride
          : slashCommand
          ? slashCommand.rawText
          : `[${nickname}]: ${text}`,
      state: "queued",
      createdAt: new Date().toISOString(),
      completedAt: null,
      canceledAt: null,
      error: null,
      ambiguityReason: null,
      routeCMatrixDelivery:
        this.normalizeRouteCMatrixDelivery(routeCMatrixDelivery),
      providerRuntimeEventIndex: 0,
      providerTurnId: null,
      providerTurnIdKind: null,
      claimedClaudeProviderVisibleEventSeen: false,
      claimedClaudeToolProgressSeen: false,
      claimedClaudeFinalEventSeen: false,
      providerAssistantMessageSeen: false,
      providerTerminalNoOutputFailureEmitted: false,
      providerTerminalFailureClassification: null,
      providerLastAgentMessagePresent: false,
    };
    session._outbox.push(message);
    this.emitOutboxMessageEvent(session, message);
    this.emitDeliveryStateNotice(session);
    this.drainOutbox(session);
    return message;
  }

  cancelOutboxMessage(sessionId, messageId) {
    const session = this.requireSession(sessionId);
    const message = this.getOutboxMessage(session, messageId);
    if (!message) {
      throw new Error(`Outbox message ${messageId} not found`);
    }
    if (
      message.id === session._activeOutboxMessageId ||
      message.state !== "queued"
    ) {
      throw new Error(`Outbox message ${messageId} is not cancelable`);
    }
    this.emitOutboxCancelControlEvent(session, message, {
      semanticType: "control.request",
    });
    message.state = "canceled";
    message.canceledAt = new Date().toISOString();
    this.emitOutboxMessageEvent(session, message);
    this.emitOutboxCancelControlEvent(session, message, {
      semanticType: "control.outcome",
      outcome: "accepted",
    });
    this.emitDeliveryStateNotice(session);
    return message;
  }

  handleOysterunProviderSkillInstallSlashCommand(
    session,
    userId,
    nickname,
    text,
    { messageId = null, routeCMatrixDelivery = null } = {}
  ) {
    const normalizedText = typeof text === "string" ? text.trim() : "";
    const overwrite = /(?:^|\s)(--overwrite|overwrite|--update|update)(?:\s|$)/i.test(
      normalizedText
    );
    const delivery = this.normalizeRouteCMatrixDelivery(routeCMatrixDelivery);
    if (delivery) {
      delivery.provider_delivery_claimed = false;
      delivery.provider_delivery_permitted = false;
      delivery.provider_delivery_attempted = false;
      delivery.provider_delivery_blocked_reason =
        "local_oysterun_skill_install_command";
      delivery.provider_delivery_state = "local_command_intercepted";
    }
    let result;
    let state = "completed";
    let error = null;
    try {
      result = this.installOysterunProviderSkillSet({
        cwd: session.cwd,
        provider: session.provider || session.adapterId || "claude",
        overwrite,
      });
    } catch (err) {
      state = "failed";
      error = err.message || String(err);
      result = {
        contract: OYSTERUN_PROVIDER_SKILL_COPY_CONTRACT,
        provider: session.provider || session.adapterId || "claude",
        installed_now: false,
        skipped: false,
        reason: err.reason || "oysterun_skill_install_failed",
      };
    }
    const message = {
      id: messageId || randomUUID(),
      sequence: session._nextOutboxSequence++,
      userId,
      nickname,
      rawText: normalizedText,
      isSlashCommand: true,
      slashCommandName: "install_oysterun_skill",
      attributedText: `[${nickname}]: ${normalizedText}`,
      providerText: null,
      state,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      canceledAt: null,
      error,
      ambiguityReason: null,
      routeCMatrixDelivery: delivery,
      providerRuntimeEventIndex: 0,
      providerTurnId: null,
      providerTurnIdKind: null,
      localCommand: true,
      providerDeliverySuppressed: true,
      oysterunProviderSkillInstall: {
        contract: OYSTERUN_PROVIDER_SKILL_COPY_CONTRACT,
        provider: result.provider,
        target_root: result.target_root || null,
        skill_set_target: result.skill_set_target || null,
        installed_now: result.installed_now === true,
        skipped: result.skipped === true,
        reason: result.reason,
        file_count: Array.isArray(result.copied) ? result.copied.length : 0,
      },
    };
    const outcome = state === "completed" ? "accepted" : "failed";
    const localOutcomeMarker =
      "p181_visible_composer_local_command_provider_suppression_outcome_v1";
    const controlRequestId = `routec_local_oysterun_skill_install_${this.routeCStableHash(
      `${session.id}:${message.id}:${normalizedText}`
    ).slice(0, 32)}`;
    const controlOutcomeId = `routec_local_oysterun_skill_install_outcome_${this.routeCStableHash(
      `${session.id}:${message.id}:${normalizedText}:${outcome}`
    ).slice(0, 32)}`;
    const semanticBody = formatOysterunProviderSkillInstallOutcomeBody({
      state,
      reason: message.oysterunProviderSkillInstall.reason,
      error,
    });
    const localOutcomeDelivery = delivery
      ? {
          ...delivery,
          target_user_event_id: delivery.source_user_event_id,
          semantic_type: "control.outcome",
          semantic_contract: localOutcomeMarker,
          provider_delivery_claimed: false,
          provider_delivery_permitted: false,
          provider_delivery_attempted: false,
          provider_delivery_blocked_reason:
            "local_oysterun_skill_install_command",
          provider_delivery_state: "local_command_intercepted",
        }
      : null;
    session._outbox.push(message);
    this.emitOutboxMessageEvent(session, message);
    if (localOutcomeDelivery) {
      this.emit(
        "runtimeEvent",
        session.agentId,
        this.decorateEvent(session, {
          type: "control.outcome",
          semantic_type: "control.outcome",
          provider: session.provider || session.adapterId || "claude",
          subtype: "local_oysterun_skill_install",
          semantic_body: semanticBody,
          control_kind: "command",
          control_family: "provider_request",
          control_origin: "host",
          control_outcome: outcome,
          outcome,
          actor: "host",
          control_request_id: controlRequestId,
          control_outcome_id: controlOutcomeId,
          target_id: delivery.source_user_event_id || message.id,
          target_event_id: delivery.source_user_event_id,
          target_user_event_id: delivery.source_user_event_id,
          target_session_id: session.id,
          source_id: "oysterun-host",
          source_label: localOutcomeMarker,
          semantic_contract: localOutcomeMarker,
          durable: true,
          replay_policy: "always",
          provider_delivery_attempted: false,
          normal_message_user_sent: false,
          provider_received_event: false,
          provider_started_event: false,
          provider_started_for_target_event: false,
          routec_matrix_delivery: localOutcomeDelivery,
          payload: {
            ...message.oysterunProviderSkillInstall,
            command_name: "install_oysterun_skill",
            local_command: true,
            provider_delivery_suppressed: true,
            provider_delivery_attempted: false,
            normal_message_user_sent: false,
            browser_visible_outcome_marker: localOutcomeMarker,
          },
        })
      );
    }
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, {
        type: "session.notice",
        provider: session.provider || "claude",
        subtype: "provider_skill.install",
        payload: message.oysterunProviderSkillInstall,
        semantic_body: semanticBody,
        replay_policy: "latest_state_only",
      })
    );
    this.emitDeliveryStateNotice(session);
    return message;
  }

  retryOutboxMessage(sessionId, messageId) {
    const session = this.requireSession(sessionId);
    const message = this.getOutboxMessage(session, messageId);
    if (!message) {
      throw new Error(`Outbox message ${messageId} not found`);
    }
    if (
      message.id !== session._activeOutboxMessageId ||
      !this.isRetryableOutboxState(message.state)
    ) {
      throw new Error(`Outbox message ${messageId} is not retryable`);
    }
    this.clearClaimedProviderTurnNoOutputTimer(session, message.id);
    session._activeOutboxMessageId = null;
    session._activeOutboxProgressSeen = false;
    session._activeOutboxProviderVisibleEventSeen = false;
    session._activeOutboxToolProgressSeen = false;
    message.state = "queued";
    message.error = null;
    message.ambiguityReason = null;
    message.completedAt = null;
    this.emitOutboxMessageEvent(session, message);
    this.emitDeliveryStateNotice(session);
    this.drainOutbox(session);
    return message;
  }

  skipOutboxMessage(sessionId, messageId) {
    const session = this.requireSession(sessionId);
    const message = this.getOutboxMessage(session, messageId);
    if (!message) {
      throw new Error(`Outbox message ${messageId} not found`);
    }
    if (
      message.id !== session._activeOutboxMessageId ||
      !this.isSkippableOutboxState(message.state)
    ) {
      throw new Error(`Outbox message ${messageId} is not skippable`);
    }
    this.clearClaimedProviderTurnNoOutputTimer(session, message.id);
    session._activeOutboxMessageId = null;
    session._activeOutboxProgressSeen = false;
    session._activeOutboxProviderVisibleEventSeen = false;
    session._activeOutboxToolProgressSeen = false;
    message.state = "canceled";
    message.canceledAt = new Date().toISOString();
    this.emitOutboxMessageEvent(session, message);
    this.emitDeliveryStateNotice(session);
    this.drainOutbox(session);
    return message;
  }

  canDrainOutbox(session) {
    const providerId = session.provider || session.adapterId || "claude";
    const allowFreshClaudeStartupDispatch =
      providerId === "claude" &&
      session._deliveryState === "starting" &&
      !session.providerResumeId;
    const allowClaudeInterruptRespawnDispatch =
      providerId === "claude" &&
      session._deliveryState === "restarting" &&
      session.alive === true;
    return (
      session.alive === true &&
      (session._deliveryState === "ready" ||
        allowFreshClaudeStartupDispatch ||
        allowClaudeInterruptRespawnDispatch) &&
      !session._activeOutboxMessageId
    );
  }

  claimRouteCMatrixDeliveryForDispatch(session, message) {
    const delivery = message.routeCMatrixDelivery || null;
    if (!delivery) {
      return {
        claimed: true,
        status: "no_routec_matrix_delivery",
        proof: null,
      };
    }
    const providerId =
      delivery.provider_id || session.provider || session.adapterId || null;
    const claim = claimRouteCHost2IntakeForProviderDelivery({
      hostSessionId: delivery.host_session_id,
      matrixRoomId: delivery.matrix_room_id,
      serverEventId: delivery.source_user_event_id,
      providerId,
    });
    delivery.host2_intake_proof = claim.proof || null;
    delivery.provider_id = providerId;
    delivery.provider_delivery_state = claim.status;
    delivery.provider_delivery_claimed = claim.claimed === true;
    delivery.provider_delivery_permitted = claim.claimed === true;
    delivery.provider_delivery_attempted = claim.claimed === true;
    delivery.provider_delivery_claim_id =
      claim.claimed === true ? claim.claim_id : null;
    delivery.provider_delivery_blocked_reason =
      claim.claimed === true ? null : claim.status;
    if (claim.claimed === true) {
      this.resolveOutboxProviderTurnId(session, message, delivery);
    }
    return claim;
  }

  drainOutbox(session) {
    if (!this.canDrainOutbox(session)) return;
    const message = this.getNextQueuedOutboxMessage(session);
    if (!message) return;

    const adapter = this.getAdapter(
      session.provider || session.adapterId || "claude"
    );
    message.state = "dispatching";
    message.error = null;
    message.ambiguityReason = null;
    message.providerRuntimeEventIndex = 0;
    message.claimedClaudeProviderVisibleEventSeen = false;
    message.claimedClaudeToolProgressSeen = false;
    message.claimedClaudeFinalEventSeen = false;
    message.providerAssistantMessageSeen = false;
    message.providerTerminalNoOutputFailureEmitted = false;
    message.providerTerminalFailureClassification = null;
    message.providerLastAgentMessagePresent = false;
    session._activeOutboxMessageId = message.id;
    session._activeOutboxProgressSeen = false;
    session._activeOutboxProviderVisibleEventSeen = false;
    session._activeOutboxToolProgressSeen = false;
    this.emitOutboxMessageEvent(session, message);
    this.emitDeliveryStateNotice(session);

    try {
      const routeCClaim = this.claimRouteCMatrixDeliveryForDispatch(
        session,
        message
      );
      if (!routeCClaim.claimed) {
        session._activeOutboxMessageId = null;
        session._activeOutboxProgressSeen = false;
        session._activeOutboxProviderVisibleEventSeen = false;
        session._activeOutboxToolProgressSeen = false;
        if (
          routeCClaim.status ===
          "host2_queued_canceled_before_provider_delivery"
        ) {
          message.state = "canceled";
          message.canceledAt = new Date().toISOString();
          message.error = null;
        } else {
          message.state = "failed";
          message.error =
            routeCClaim.status ||
            "Route C Matrix provider delivery claim failed";
        }
        this.emitOutboxMessageEvent(session, message);
        this.emitDeliveryStateNotice(session);
        this.drainOutbox(session);
        return;
      }
      this.armClaimedClaudeNoOutputTimer(session, message);
      adapter.sendMessage(session, {
        userId: message.userId,
        nickname: message.nickname,
        text: message.providerText,
        rawText: message.rawText,
        isSlashCommand: message.isSlashCommand,
        slashCommandName: message.slashCommandName,
      });
      this.emit(
        "runtimeEvent",
        session.agentId,
        this.decorateEvent(session, {
          type: "message.user",
          provider: null,
          user_id: message.userId,
          nickname: message.nickname,
          text: message.rawText,
          message_id: message.id,
          created_at: message.createdAt,
          message_type: "message",
          text_entities: [],
          media: [],
          delivery_state: this.canonicalDeliveryStateForMessageState(
            message.state
          ),
        })
      );
    } catch (err) {
      this.clearClaimedProviderTurnNoOutputTimer(session, message.id);
      session._activeOutboxMessageId = null;
      session._activeOutboxProgressSeen = false;
      session._activeOutboxProviderVisibleEventSeen = false;
      session._activeOutboxToolProgressSeen = false;
      message.state = "queued";
      message.error = err.message || String(err);
      this.emitOutboxMessageEvent(session, message);
      this.emit(
        "runtimeEvent",
        session.agentId,
        this.decorateEvent(session, {
          type: "runtime.error",
          provider: session.provider,
          error: message.error,
        })
      );
      this.emitDeliveryStateNotice(session);
    }
  }

  noteOutboxProgress(session, event) {
    const activeMessage = this.getActiveOutboxMessage(session);
    const claimedClaudeMessage = this.findClaimedClaudeOutboxMessageForEvent(
      session,
      event,
      activeMessage
    );
    if (!activeMessage && !claimedClaudeMessage) return;

    if (this.isClaimedClaudeCompletionSatisfyingEvent(event)) {
      if (activeMessage) {
        session._activeOutboxProviderVisibleEventSeen = true;
        if (this.isAssistantMessageRuntimeEvent(event)) {
          activeMessage.providerAssistantMessageSeen = true;
          activeMessage.providerLastAgentMessagePresent = true;
        }
      }
      if (claimedClaudeMessage) {
        claimedClaudeMessage.claimedClaudeProviderVisibleEventSeen = true;
        if (this.isAssistantMessageRuntimeEvent(event)) {
          claimedClaudeMessage.providerAssistantMessageSeen = true;
          claimedClaudeMessage.providerLastAgentMessagePresent = true;
        }
        claimedClaudeMessage.claimedClaudeFinalEventSeen = true;
        session._claimedProviderTurnNoOutputFinalEventSeen = true;
        this.clearClaimedProviderTurnNoOutputTimer(
          session,
          claimedClaudeMessage.id,
          {
            resetState: false,
          }
        );
      }
    }
    if (this.isToolProgressOutboxEvent(event)) {
      if (activeMessage) {
        session._activeOutboxToolProgressSeen = true;
      }
      if (claimedClaudeMessage) {
        claimedClaudeMessage.claimedClaudeToolProgressSeen = true;
        claimedClaudeMessage.claimedClaudeFinalEventSeen = false;
        session._claimedProviderTurnNoOutputToolProgressSeen = true;
        session._claimedProviderTurnNoOutputFinalEventSeen = false;
        if (
          session._claimedProviderTurnNoOutputMessageId !==
            claimedClaudeMessage.id ||
          !session._claimedProviderTurnNoOutputTimer
        ) {
          this.armClaimedClaudeNoOutputTimer(session, claimedClaudeMessage, {
            preserveProgress: true,
          });
        }
      }
    }

    if (!activeMessage) return;

    if (event.type === "session.notice" && event.subtype === "turn.started") {
      activeMessage.state = "running";
      if (activeMessage.routeCMatrixDelivery) {
        const delivery = activeMessage.routeCMatrixDelivery;
        const eventProviderTurnId =
          typeof event.payload?.turn?.id === "string" &&
          event.payload.turn.id.trim()
            ? event.payload.turn.id.trim()
            : null;
        const eventProviderTurnIdKind = eventProviderTurnId
          ? "provider_reported_turn_id"
          : null;
        const { providerTurnId, providerTurnIdKind } =
          this.resolveOutboxProviderTurnId(session, activeMessage, delivery, {
            eventProviderTurnId,
            eventProviderTurnIdKind,
          });
        const providerId = delivery.provider_id || session.provider || null;
        const hostDeliveryClaimId =
          delivery.provider_delivery_claim_id || activeMessage.id;
        if (providerTurnId) {
          delivery.host2_intake_proof = markRouteCHost2IntakeAgentTurnStarted({
            hostSessionId: delivery.host_session_id,
            matrixRoomId: delivery.matrix_room_id,
            serverEventId: delivery.source_user_event_id,
            providerId,
            providerTurnId,
            providerTurnIdKind,
          });
        } else {
          delivery.diagnostic_host_delivery_claim_id = hostDeliveryClaimId;
          delivery.diagnostic_host_delivery_claim_id_kind =
            "host_delivery_claim_id";
          delivery.provider_turn_id = null;
          delivery.provider_turn_id_kind = null;
          delivery.host2_intake_start_blocked_reason =
            "provider_reported_turn_id_missing";
        }
      }
      session._activeOutboxProgressSeen = true;
      this.emitOutboxMessageEvent(session, activeMessage);
      this.emitDeliveryStateNotice(session);
      return;
    }

    if (
      this.isClaimedClaudeProviderCompletionEvent(event) &&
      activeMessage.routeCMatrixDelivery
    ) {
      const delivery = activeMessage.routeCMatrixDelivery;
      const providerId = delivery.provider_id || session.provider || null;
      const hostDeliveryClaimId =
        delivery.provider_delivery_claim_id || activeMessage.id;
      const eventProviderTurnId =
        typeof event.provider_turn_id === "string" &&
        event.provider_turn_id.trim()
          ? event.provider_turn_id.trim()
          : typeof event.turn_id === "string" && event.turn_id.trim()
          ? event.turn_id.trim()
          : typeof event.turnId === "string" && event.turnId.trim()
          ? event.turnId.trim()
          : typeof event.provider_completion_turn_id === "string" &&
            event.provider_completion_turn_id.trim()
          ? event.provider_completion_turn_id.trim()
          : typeof event.target_turn_id === "string" &&
            event.target_turn_id.trim()
          ? event.target_turn_id.trim()
          : null;
      const providerTurnId =
        this.resolveOutboxProviderTurnId(session, activeMessage, delivery, {
          eventProviderTurnId,
          eventProviderTurnIdKind: event.provider_turn_id_kind,
        }).providerTurnId;
      if (!providerTurnId) {
        delivery.diagnostic_host_delivery_claim_id = hostDeliveryClaimId;
        delivery.diagnostic_host_delivery_claim_id_kind =
          "host_delivery_claim_id";
      }
      event.routec_matrix_delivery = {
        ...delivery,
        outbox_message_id: activeMessage.id,
        provider_id: providerId,
        provider_turn_id: providerTurnId,
        provider_turn_id_kind: providerTurnId
          ? delivery.provider_turn_id_kind
          : null,
        provider_runtime_event_index: null,
        semantic_type: "session_lifecycle",
      };
      if (providerTurnId) {
        event.provider_turn_id = event.provider_turn_id || providerTurnId;
        event.provider_turn_id_kind =
          event.provider_turn_id_kind || delivery.provider_turn_id_kind;
      }
      return;
    }

    if (
      event.type === "message.assistant" ||
      event.type === "message.thinking" ||
      event.type === "tool.call" ||
      event.type === "tool.output" ||
      event.type === "tool.result" ||
      event.type === "control.request" ||
      event.type === "control.outcome" ||
      event.type === "runtime.error" ||
      event.type === "session.lifecycle" ||
      event.type === "session.ready" ||
      event.type === "session.exit" ||
      event.type === "routec.semantic.absence" ||
      event.type === "stderr" ||
      (typeof event.semantic_type === "string" && event.semantic_type.trim())
    ) {
      if (activeMessage.state !== "running") {
        activeMessage.state = "running";
        this.emitOutboxMessageEvent(session, activeMessage);
        this.emitDeliveryStateNotice(session);
      }
      if (activeMessage.routeCMatrixDelivery) {
        const delivery = activeMessage.routeCMatrixDelivery;
        const providerId = delivery.provider_id || session.provider || null;
        const providerRuntimeSemanticType =
          this.routeCProviderRuntimeSemanticTypeForOutboxIndex(event);
        const providerRuntimeEventIndex = providerRuntimeSemanticType
          ? (activeMessage.providerRuntimeEventIndex || 0) + 1
          : null;
        if (providerRuntimeEventIndex !== null) {
          activeMessage.providerRuntimeEventIndex = providerRuntimeEventIndex;
        }
        const hostDeliveryClaimId =
          delivery.provider_delivery_claim_id || activeMessage.id;
        const eventProviderTurnId =
          typeof event.provider_turn_id === "string" &&
          event.provider_turn_id.trim()
            ? event.provider_turn_id.trim()
            : typeof event.turn_id === "string" && event.turn_id.trim()
            ? event.turn_id.trim()
            : typeof event.turnId === "string" && event.turnId.trim()
            ? event.turnId.trim()
            : typeof event.provider_completion_turn_id === "string" &&
              event.provider_completion_turn_id.trim()
            ? event.provider_completion_turn_id.trim()
            : typeof event.target_turn_id === "string" &&
              event.target_turn_id.trim()
            ? event.target_turn_id.trim()
            : null;
        const providerTurnId =
          this.resolveOutboxProviderTurnId(session, activeMessage, delivery, {
            eventProviderTurnId,
            eventProviderTurnIdKind: event.provider_turn_id_kind,
          }).providerTurnId;
        if (!providerTurnId) {
          delivery.diagnostic_host_delivery_claim_id = hostDeliveryClaimId;
          delivery.diagnostic_host_delivery_claim_id_kind =
            "host_delivery_claim_id";
        }
        event.routec_matrix_delivery = {
          ...delivery,
          outbox_message_id: activeMessage.id,
          provider_id: providerId,
          provider_turn_id: providerTurnId,
          provider_turn_id_kind: providerTurnId
            ? delivery.provider_turn_id_kind
            : null,
          provider_runtime_event_index: providerRuntimeEventIndex,
          semantic_type: providerRuntimeSemanticType || delivery.semantic_type,
        };
        if (providerTurnId) {
          event.provider_turn_id = event.provider_turn_id || providerTurnId;
          event.provider_turn_id_kind =
            event.provider_turn_id_kind || delivery.provider_turn_id_kind;
        }
        if (providerRuntimeEventIndex !== null) {
          event.provider_runtime_event_index =
            event.provider_runtime_event_index || providerRuntimeEventIndex;
        }
      }
      session._activeOutboxProgressSeen = true;
    }
  }

  setActiveOutboxMessageState(session, nextState, extra = {}) {
    const activeMessage = this.getActiveOutboxMessage(session);
    if (!activeMessage) return;
    if (
      nextState === "completed" &&
      this.isClaimedClaudeRouteCOutboxMessage(session, activeMessage) &&
      this.hasClaimedClaudeFinalCompletionEvent(session, activeMessage) !== true
    ) {
      this.emitClaimedClaudeNoOutputDiagnostic(session, activeMessage, {
        reason: this.claimedClaudeCompletedNoFinalReason(session, activeMessage),
      });
      return;
    }
    activeMessage.state = nextState;
    activeMessage.error = extra.error || null;
    activeMessage.ambiguityReason = extra.ambiguityReason || null;
    if (
      nextState === "completed" ||
      nextState === "failed" ||
      nextState === "interrupted"
    ) {
      activeMessage.completedAt = new Date().toISOString();
    }
    if (nextState === "canceled") {
      activeMessage.canceledAt = new Date().toISOString();
    }
    const keepBlockingActive =
      nextState === "ambiguous" || nextState === "stalled";
    if (!keepBlockingActive) {
      session._activeOutboxMessageId = null;
      session._activeOutboxProgressSeen = false;
      session._activeOutboxProviderVisibleEventSeen = false;
      session._activeOutboxToolProgressSeen = false;
      this.clearClaimedProviderTurnNoOutputTimer(session, activeMessage.id);
    }
    this.emitOutboxMessageEvent(session, activeMessage);
    this.emitDeliveryStateNotice(session);
    if (!keepBlockingActive) {
      this.drainOutbox(session);
    }
  }

  handleOutboxRuntimeEvent(session, event) {
    if (event.type === "session.ready") {
      session._deliveryState = "ready";
      this.emitDeliveryStateNotice(session);
      this.drainOutbox(session);
      return;
    }

    if (
      event.type === "session.notice" &&
      event.subtype === "interrupt.requested"
    ) {
      session._deliveryState = "interrupting";
      this.emitDeliveryStateNotice(session);
      return;
    }

    if (
      event.type === "session.notice" &&
      event.subtype === "interrupt.resuming"
    ) {
      session._deliveryState = "restarting";
      this.emitDeliveryStateNotice(session);
      return;
    }

    if (
      event.type === "session.notice" &&
      event.subtype === "interrupt.respawned"
    ) {
      this.emitDeliveryStateNotice(session);
      this.drainOutbox(session);
      return;
    }

    if (event.type === "runtime.error") {
      const activeMessage = this.getActiveOutboxMessage(session);
      const authFailure = this.markProviderRuntimeAuthFailure(
        session,
        activeMessage,
        event
      );
      if (authFailure) {
        this.clearClaimedProviderTurnNoOutputTimer(session, activeMessage.id);
        this.setActiveOutboxMessageState(session, "failed", {
          error: authFailure.message,
          ambiguityReason: authFailure.failureClassification,
        });
        return;
      }
    }

    this.noteOutboxProgress(session, event);

    if (this.isClaimedClaudeProviderCompletionEvent(event)) {
      const activeMessage = this.getActiveOutboxMessage(session);
      const claimedClaudeMessage =
        this.findClaimedClaudeOutboxMessageForCompletionEvent(
          session,
          event,
          activeMessage
        );
      if (
        claimedClaudeMessage &&
        this.hasClaimedClaudeFinalCompletionEvent(
          session,
          claimedClaudeMessage
        ) !== true &&
        this.isFailedClaimedClaudeProviderCompletionEvent(event) !== true &&
        this.isInterruptedClaimedClaudeProviderCompletionEvent(event) !== true
      ) {
        const reason =
          this.claimedClaudeCompletedNoFinalReason(session, claimedClaudeMessage);
        this.emitClaimedClaudeNoOutputDiagnostic(session, claimedClaudeMessage, {
          reason,
          completionEvent: event,
          allowCompleted: true,
        });
        return;
      }
      const resumeDeliveryBeforeTerminalDrain =
        (session._deliveryState === "interrupting" ||
          session._deliveryState === "restarting") &&
        session.resuming !== true;
      if (resumeDeliveryBeforeTerminalDrain) {
        session._deliveryState = "ready";
      }
      if (this.isInterruptedClaimedClaudeProviderCompletionEvent(event)) {
        this.setActiveOutboxMessageState(
          session,
          session._activeOutboxProgressSeen ? "interrupted" : "canceled"
        );
      } else if (this.isFailedClaimedClaudeProviderCompletionEvent(event)) {
        const noOutputFailure = this.markProviderTerminalNoOutputFailure(
          session,
          activeMessage,
          event
        );
        this.setActiveOutboxMessageState(session, "failed", {
          error: noOutputFailure?.message || event.error || "Turn failed",
          ambiguityReason: noOutputFailure?.failureClassification || null,
        });
      } else {
        this.setActiveOutboxMessageState(session, "completed");
      }
      if (resumeDeliveryBeforeTerminalDrain) {
        this.emitDeliveryStateNotice(session);
        this.drainOutbox(session);
      }
    }
  }

  handleOutboxRuntimeError(session, err) {
    const activeMessage = this.getActiveOutboxMessage(session);
    if (!activeMessage) return;
    this.clearClaimedProviderTurnNoOutputTimer(session, activeMessage.id);
    const nextState = session._activeOutboxProgressSeen
      ? "ambiguous"
      : "failed";
    this.setActiveOutboxMessageState(session, nextState, {
      error: err.message || String(err),
      ambiguityReason: session._activeOutboxProgressSeen
        ? "provider_error_after_progress"
        : null,
    });
  }

  shouldSuppressExitDerivedRuntimeError(session, err) {
    const message = err?.message || String(err || "");
    return (
      session?.provider === "codex" &&
      session?.alive !== true &&
      /exited before response \(code=0, signal=none\)/.test(message)
    );
  }

  handleOutboxExit(session) {
    const activeMessage = this.getActiveOutboxMessage(session);
    if (!activeMessage) return;
    const reason = this.claimedClaudeNoOutputReason(session, activeMessage);
    if (
      this.isClaimedClaudeRouteCOutboxMessage(session, activeMessage) &&
      this.hasClaimedClaudeFinalCompletionEvent(session, activeMessage) !== true
    ) {
      this.emitClaimedClaudeNoOutputDiagnostic(session, activeMessage, {
        reason,
        phase: "provider_exit",
      });
      return;
    }
    this.clearClaimedProviderTurnNoOutputTimer(session, activeMessage.id);
    this.setActiveOutboxMessageState(session, "ambiguous", {
      ambiguityReason: "session_exited_before_turn_completed",
    });
  }

  syncSessionRuntimeState(session, event) {
    const nextProviderResumeId = normalizeProviderMetadataId(
      event.provider_resume_id
    );
    if (nextProviderResumeId) {
      session.providerResumeId = nextProviderResumeId;
    }
    const nextProviderThreadId = normalizeProviderMetadataId(
      event.provider_thread_id || event.thread_id
    );
    if (nextProviderThreadId) {
      session.threadId = nextProviderThreadId;
      if (
        !session.providerResumeId &&
        (session.provider || session.adapterId) === "codex"
      ) {
        session.providerResumeId = nextProviderThreadId;
      }
    }

    if (event.type === "session.ready") {
      session._ready = true;
      session.chatShellReady = true;
      session.providerReady = true;
      if (typeof event.model === "string" && event.model.trim()) {
        session.model = event.model.trim();
      }
      if (
        typeof event.permissionMode === "string" &&
        event.permissionMode.trim()
      ) {
        session.permissionMode = event.permissionMode.trim();
      }
      if (typeof event.cwd === "string" && event.cwd.trim()) {
        session.cwd = event.cwd.trim();
      }
      if (Number.isInteger(event.toolsCount) && event.toolsCount >= 0) {
        session.toolsCount = event.toolsCount;
      }
      return;
    }

    if (
      event.type === "session.notice" &&
      event.subtype === "permission_mode.updated" &&
      typeof event.payload?.permissionMode === "string" &&
      event.payload.permissionMode.trim()
    ) {
      session.permissionMode = event.payload.permissionMode.trim();
    }
  }

  getAdapter(providerId = "claude") {
    const provider = requireProvider(providerId, {
      config: this.getCurrentConfig(),
    });
    const adapter = this.adapters.get(provider.id) || null;
    if (!adapter) {
      throw new Error(
        `Provider "${provider.id}" is configured but runtime is not implemented yet`
      );
    }
    return adapter;
  }

  assertConfiguredProviderCommandAvailable(providerId, adapter) {
    if (!adapter || typeof adapter.getConfiguredCommand !== "function") {
      return;
    }
    const configuredCommand = adapter.getConfiguredCommand();
    if (!configuredCommand) {
      return;
    }
    if (isConfiguredCommandAvailable(configuredCommand)) {
      return;
    }
    throw createProviderUnavailableError(providerId, {
      command: configuredCommand,
    });
  }

  /**
   * Start a new interactive session for an agent.
   * @param {object} opts
   * @param {string} opts.agentId - Agent identifier
   * @param {string} opts.cwd - Working directory for the session
   * @param {string} [opts.sessionId] - Reuse a specific session ID (for resume)
   * @param {string} [opts.model] - Model override (e.g. "sonnet", "opus")
   * @param {boolean} [opts.resume] - Resume an existing session by sessionId
   * @param {string} [opts.permissionMode] - Permission mode (e.g. "default")
   * @param {boolean} [opts.allowDangerouslySkipPermissions]
   * @returns {Session}
   */
  start({
    agentId,
    cwd,
    provider = "claude",
    sessionId,
    sessionName,
    parentSessionId = null,
    resumeSessionId,
    fork = false,
    model,
    reasoningEffort,
    reasoningEffortSource,
    resume = false,
    permissionMode,
    approvalPolicy,
    sandboxMode,
    dangerousMode,
    allowDangerouslySkipPermissions,
    searchEnabled,
    imageInputEnabled,
    native,
    workspacePolicy,
    assetReadablePaths,
    runtimeCapabilities,
    runtimeCapabilityEnv,
    runtimeCapabilityGrant,
    runtimeCapabilityRedactionValues,
    requiredProductSkills,
    installOysterunSkills = false,
    providerStartupAttemptId = null,
    providerStartupConfiguredCommand = null,
    providerStartupResolvedCommand = null,
  }) {
    const id = sessionId || randomUUID();
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`);
    }
    const resolvedSessionName =
      normalizeSessionName(sessionName) ||
      buildUniqueDefaultSessionName(
        agentId,
        (candidate) => this.hasRunningSessionName(candidate),
        () => getSessionNameCounterStore().nextAgentSessionCounter(agentId)
      );
    if (this.hasRunningSessionName(resolvedSessionName)) {
      throw new Error(buildSessionNameConflictMessage(resolvedSessionName));
    }
    const adapter = this.getAdapter(provider);
    this.assertConfiguredProviderCommandAvailable(provider, adapter);
    const preparedRuntimeWorkspace = this.prepareProviderRuntimeWorkspace({
      cwd,
      provider,
      requiredProductSkills,
      installOysterunSkills,
      runtimeCapabilityEnv,
    });
    const {
      normalizedRuntimeEnv,
      productSkillCopy,
      oysterunProviderSkillInstall,
      providerTrustedFolder,
    } = preparedRuntimeWorkspace;
    const session = adapter.startSession({
      sessionId: id,
      cwd,
      agentId,
      resumeSessionId:
        resume === true ? resumeSessionId || sessionId : undefined,
      fork,
      model,
      reasoningEffort,
      reasoningEffortSource,
      permissionMode,
      approvalPolicy,
      sandboxMode,
      dangerousMode,
      allowDangerouslySkipPermissions,
      searchEnabled,
      imageInputEnabled,
      native,
      workspacePolicy,
      assetReadablePaths,
      runtimeEnv: normalizedRuntimeEnv,
    });
    session.adapterId = adapter.providerId;
    session.workspacePolicy = workspacePolicy ?? null;
    session.assetReadablePaths = normalizeAssetReadablePaths(
      assetReadablePaths || session.assetReadablePaths || []
    );
    session.runtimeCapabilities =
      runtimeCapabilities && typeof runtimeCapabilities === "object"
        ? JSON.parse(JSON.stringify(runtimeCapabilities))
        : {};
    session.runtimeCapabilityEnv = normalizedRuntimeEnv;
    session.runtimeCapabilityGrant =
      runtimeCapabilityGrant && typeof runtimeCapabilityGrant === "object"
        ? JSON.parse(JSON.stringify(runtimeCapabilityGrant))
        : null;
    session.runtimeCapabilityRedactionValues = normalizeRedactionValues(
      runtimeCapabilityRedactionValues
    );
    session.requiredProductSkills = productSkillCopy.skills;
    session.productSkillCopyContract = productSkillCopy.contract;
    session.productSkillCopyResult = productSkillCopy.provided
      ? {
          contract: productSkillCopy.contract,
          skills: productSkillCopy.skills,
          copied: productSkillCopy.copied.map((entry) => ({
            skill: entry.skill,
            file_count: entry.files.length,
          })),
        }
      : null;
    session.oysterunProviderSkillInstall =
      oysterunProviderSkillInstall && {
        contract: oysterunProviderSkillInstall.contract,
        provider: oysterunProviderSkillInstall.provider,
        target_root: oysterunProviderSkillInstall.target_root,
        skill_set_target: oysterunProviderSkillInstall.skill_set_target,
        installed_now: oysterunProviderSkillInstall.installed_now === true,
        reason: oysterunProviderSkillInstall.reason,
        file_count: Array.isArray(oysterunProviderSkillInstall.copied)
          ? oysterunProviderSkillInstall.copied.length
          : 0,
      };
    session.providerTrustedFolder = providerTrustedFolder || null;
    session.allowDangerouslySkipPermissions =
      allowDangerouslySkipPermissions === true;
    session.searchEnabled = searchEnabled === true;
    session.imageInputEnabled = imageInputEnabled === true;
    session.native = native ||
      session.native || { args: [], configOverrides: {}, profile: null };
    session.provider = session.provider || adapter.providerId;
    if (!session.provider) {
      throw new Error("Session provider is missing after adapter start");
    }
    session.transport =
      session.transport || (session.provider === "codex" ? "app-server" : null);
    session.resumeSessionId =
      resume === true
        ? resumeSessionId || session.resumeSessionId || sessionId || null
        : session.resumeSessionId || null;
    session.capabilities = session.capabilities || adapter.capabilities || {};
    session.model = session.model ?? model ?? null;
    session.reasoningEffort =
      session.reasoningEffort ?? reasoningEffort ?? null;
    session.reasoningEffortSource =
      session.reasoningEffortSource ?? reasoningEffortSource ?? null;
    session.permissionMode = session.permissionMode ?? permissionMode ?? null;
    session.toolsCount = Number.isInteger(session.toolsCount)
      ? session.toolsCount
      : null;
    session.chatShellReady = session.alive === true;
    session.providerReady = session._ready === true;
    // Claude accepts stdin before system.init arrives. Mark the session ready
    // immediately so chat opens and /login can be sent through the normal path,
    // while providerReady stays false until the ACP session.ready event arrives.
    if (
      session.provider === "claude" &&
      session.alive === true &&
      session._ready !== true
    ) {
      session._ready = true;
      session.providerReady = false;
    }
    session.approvalPolicy = session.approvalPolicy ?? approvalPolicy ?? null;
    session.sandboxMode = session.sandboxMode ?? sandboxMode ?? null;
    session.dangerousMode = dangerousMode === true;
    session.sessionName = resolvedSessionName;
    session.historyCreatedAt = new Date().toISOString();
    session.historyRecordId = session.id;
    session.parentSessionId = parentSessionId || null;
    session.bookkeepingWarnings = [];
    session.providerStartupAttemptId = providerStartupAttemptId || null;
    session.providerStartupConfiguredCommand =
      providerStartupConfiguredCommand || null;
    session.providerStartupResolvedCommand =
      providerStartupResolvedCommand || null;
    session.providerStartupReadyAt = null;

    const recordBookkeepingWarning = (subtype, err) => {
      const warning = `${subtype}: ${err.message}`;
      session.bookkeepingWarnings.push(warning);
      console.error(`[session-manager] ${agentId} ${warning}`);
      this.emit(
        "runtimeEvent",
        agentId,
        this.decorateEvent(session, {
          type: "session.notice",
          provider: session.provider,
          subtype,
          error: err.message,
        })
      );
    };
    if (session.providerTrustedFolder?.warning) {
      const warning = `provider_trust.write_failed: ${session.providerTrustedFolder.warning}`;
      session.bookkeepingWarnings.push(warning);
      this.emit(
        "runtimeEvent",
        agentId,
        this.decorateEvent(session, {
          type: "session.notice",
          provider: session.provider,
          subtype: "provider_trust.write_failed",
          payload: session.providerTrustedFolder,
          error: session.providerTrustedFolder.error_code || warning,
        })
      );
    }

    const buildHistoryRecord = (lastActiveAt = session.historyCreatedAt) => ({
      session_id: session.id,
      session_name: session.sessionName,
      parent_session_id: session.parentSessionId,
      agent_id: agentId,
      agent_folder: cwd,
      runtime: session.provider,
      model: session.model,
      provider_resume_id: this.getEffectiveProviderResumeId(session),
      provider_thread_id: session.threadId || null,
      provider_transport: session.transport || null,
      created_at: session.historyCreatedAt,
      last_active_at: lastActiveAt,
    });

    const buildHistoryMetadataSnapshot = () =>
      JSON.stringify({
        runtime: session.provider,
        model: session.model,
        provider_resume_id: this.getEffectiveProviderResumeId(session),
        provider_thread_id: session.threadId || null,
        provider_transport: session.transport || null,
      });

    session.historyMetadataSnapshot = null;
    session.lastActiveAt = session.historyCreatedAt || new Date().toISOString();
    this.initializeDeliveryState(session);

    // Relay events with agentId context
    session.on("event", (event) => {
      if (event.type === "session.exit") {
        session._lastProviderExitEvent = event;
      }
      const providerStartupLifecycleEvent = buildProviderStartupLifecycleEvent({
        session,
        event,
      });
      if (providerStartupLifecycleEvent) {
        logProviderStartupEvent(providerStartupLifecycleEvent);
      }
      this.handleOutboxRuntimeEvent(session, event);
      this.syncSessionRuntimeState(session, event);
      if (
        event.type === "message.user" ||
        event.type === "message.assistant" ||
        event.type === "turn.completed"
      ) {
        session.lastActiveAt = new Date().toISOString();
      }
      if (
        event.type === "session.ready" &&
        session.id !== session.historyRecordId
      ) {
        try {
          saveSessionRecord(buildHistoryRecord());
          deleteSessionRecord(session.historyRecordId);
          session.historyRecordId = session.id;
        } catch (err) {
          recordBookkeepingWarning("history.ready_sync_failed", err);
        }
      }
      const nextHistoryMetadata = buildHistoryMetadataSnapshot();
      if (
        event.type === "session.ready" ||
        event.type === "turn.completed" ||
        event.type === "session.exit" ||
        nextHistoryMetadata !== session.historyMetadataSnapshot
      ) {
        try {
          updateSessionRecord(
            session.historyRecordId || session.id,
            buildHistoryRecord(new Date().toISOString())
          );
          session.historyMetadataSnapshot = nextHistoryMetadata;
        } catch (err) {
          recordBookkeepingWarning("history.runtime_sync_failed", err);
        }
      }
      this.emit("runtimeEvent", agentId, this.decorateEvent(session, event));
    });
    session.on("error", (err) => {
      if (this.shouldSuppressExitDerivedRuntimeError(session, err)) {
        return;
      }
      const runtimeErrorEvent = {
        type: "runtime.error",
        provider: session.provider,
        error: err.message || String(err),
      };
      const providerStartupLifecycleEvent = buildProviderStartupLifecycleEvent({
        session,
        event: runtimeErrorEvent,
      });
      if (providerStartupLifecycleEvent) {
        logProviderStartupEvent(providerStartupLifecycleEvent);
      }
      const activeMessage = this.getActiveOutboxMessage(session);
      const authFailure = this.markProviderRuntimeAuthFailure(
        session,
        activeMessage,
        runtimeErrorEvent
      );
      if (authFailure) {
        this.clearClaimedProviderTurnNoOutputTimer(session, activeMessage.id);
        this.setActiveOutboxMessageState(session, "failed", {
          error: authFailure.message,
          ambiguityReason: authFailure.failureClassification,
        });
        this.emit(
          "runtimeEvent",
          agentId,
          this.decorateEvent(session, runtimeErrorEvent)
        );
        return;
      }
      this.handleOutboxRuntimeError(session, err);
      this.emit(
        "runtimeEvent",
        agentId,
        this.decorateEvent(session, runtimeErrorEvent)
      );
    });
    session.on("exit", (code) => {
      this.handleOutboxExit(session);
      this.sessions.delete(id);
      this.removeAgentSession(agentId, id);
      const providerExitEvent = session._lastProviderExitEvent || null;
      try {
        updateSessionRecord(
          session.historyRecordId || session.id,
          buildHistoryRecord(new Date().toISOString())
        );
      } catch (err) {
        this.emit(
          "runtimeEvent",
          agentId,
          this.decorateEvent(session, {
            type: "session.notice",
            provider: session.provider,
            subtype: "history.update_failed",
            error: err.message,
          })
        );
      }
      if (!providerExitEvent) {
        const providerStartupLifecycleEvent = buildProviderStartupLifecycleEvent({
          session,
          event: {
            type: "session.exit",
            provider: session.provider,
            code,
          },
        });
        if (providerStartupLifecycleEvent) {
          logProviderStartupEvent(providerStartupLifecycleEvent);
        }
        this.emit(
          "runtimeEvent",
          agentId,
          this.decorateEvent(session, {
            type: "session.exit",
            provider: session.provider,
            code,
          })
        );
      }
    });

    this.sessions.set(id, session);
    this.addAgentSession(agentId, id);
    try {
      saveSessionRecord(buildHistoryRecord());
      session.historyMetadataSnapshot = buildHistoryMetadataSnapshot();
    } catch (err) {
      recordBookkeepingWarning("history.start_write_failed", err);
    }
    this.emit(
      "runtimeEvent",
      agentId,
      this.decorateEvent(session, {
        type: "session.started",
        provider: session.provider,
      })
    );

    return session;
  }

  addAgentSession(agentId, sessionId) {
    if (!this.agentSessions.has(agentId)) {
      this.agentSessions.set(agentId, new Set());
    }
    this.agentSessions.get(agentId).add(sessionId);
  }

  removeAgentSession(agentId, sessionId) {
    const sessionIds = this.agentSessions.get(agentId);
    if (!sessionIds) return;
    sessionIds.delete(sessionId);
    if (sessionIds.size === 0) {
      this.agentSessions.delete(agentId);
    }
  }

  getAgentSessionId(agentId) {
    const sessionIds = this.agentSessions.get(agentId);
    if (!sessionIds || sessionIds.size === 0) return null;
    let latestSessionId = null;
    for (const candidateId of sessionIds) {
      if (this.sessions.has(candidateId)) {
        latestSessionId = candidateId;
      }
    }
    return latestSessionId;
  }

  requireSession(sessionId) {
    if (!sessionId) throw new Error("sessionId required");
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session;
  }

  /**
   * Send a user message to an agent's session.
   * Includes user attribution for shared chat.
   */
  sendToAgent(agentId, userId, nickname, text) {
    const session = this.getAgentSession(agentId);
    if (!session) throw new Error(`No active session for agent ${agentId}`);
    this.sendToSession(session.id, userId, nickname, text);
  }

  sendToSession(sessionId, userId, nickname, text, opts = {}) {
    const session = this.requireSession(sessionId);
    return this.enqueueOutboxMessage(session, userId, nickname, text, opts);
  }

  deliverRouteCMatrixUserEventToProvider({
    sessionId,
    matrixUserId = null,
    matrixRoomId,
    serverEventId,
    txnId = null,
    text,
    providerText = null,
    nickname = "Host Owner",
  }) {
    const session = this.requireSession(sessionId);
    const providerId = session.provider || session.adapterId || "unknown";
    const realProviderDeliveryMarker =
      routeCRealProviderDeliveryMarker(providerId);
    const providerDeliveryIdempotencyKey =
      normalizeProviderMetadataId(txnId) || serverEventId;
    if (!realProviderDeliveryMarker) {
      const proof = blockRouteCHost2IntakeProviderDelivery({
        hostSessionId: session.id,
        matrixRoomId,
        serverEventId,
        providerId,
        reason:
          "provider_delivery_unsupported_provider_for_routec_host_delivery",
      });
      return {
        status: "provider_delivery_blocked_unsupported_provider",
        delivered: false,
        proof,
      };
    }
    const delivery = {
      marker: realProviderDeliveryMarker,
      host_session_id: session.id,
      matrix_room_id: matrixRoomId,
      matrix_user_id: matrixUserId,
      matrix_txn_id: txnId,
      client_request_id: providerDeliveryIdempotencyKey,
      source_user_event_id: serverEventId,
      source_user_event_id_hash: this.routeCStableHash(serverEventId),
      provider_delivery_idempotency_key: providerDeliveryIdempotencyKey,
      provider_delivery_idempotency_key_kind:
        normalizeProviderMetadataId(txnId)
          ? "matrix_txn_or_client_request_id"
          : "matrix_server_event_id",
      provider_id: providerId,
      provider_delivery_claim_id: null,
      provider_delivery_claimed: false,
      provider_delivery_permitted: false,
      provider_delivery_attempted: false,
      provider_delivery_blocked_reason: null,
      provider_delivery_state: "provider_delivery_queued",
      host_provider_delivery_path: `host_session_outbox_${providerId}_adapter_real_provider`,
      semantic_type: "message.assistant",
      semantic_contract: routeCRealProviderSemanticContract(providerId),
      real_codex_host_delivery: providerId === "codex",
      real_claude_host_delivery: providerId === "claude",
      real_provider_host_delivery:
        providerId === "codex" || providerId === "claude",
      debug_fixture_host_delivery: providerId === "debug-fixture",
      debug_large_tool_spillover_host_delivery:
        providerId === "debug-large-tool-spillover",
      debug_p135_codex_replay_host_delivery:
        providerId === "debug-p135-codex-replay",
      debug_routec_structural_replay_host_delivery:
        providerId === "debug-routec-structural-replay",
      direct_matrix_harness_write_used: false,
      direct_host_send_used: false,
      real_codex_acceptance_claimed: false,
      real_codex_e2e_claimed: false,
      full_provider_parity_claimed: false,
    };
    const deterministicMessageId = `routec_host2_${this.routeCStableHash(
      `${session.id}:${matrixRoomId}:${providerDeliveryIdempotencyKey}`
    ).slice(0, 32)}`;
    try {
      const duplicateMessage = this.getOutboxMessage(
        session,
        deterministicMessageId
      );
      const queuedMessage = this.sendToSession(
        session.id,
        matrixUserId || "routec-matrix-user",
        nickname,
        text,
        {
          messageId: deterministicMessageId,
          routeCMatrixDelivery: delivery,
          providerTextOverride: providerText,
        }
      );
      const providerDeliveryDuplicatePrevented = duplicateMessage !== null;
      if (queuedMessage.localCommand === true) {
        return {
          status:
            queuedMessage.state === "failed"
              ? "local_oysterun_skill_command_failed"
              : "local_oysterun_skill_command_completed",
          delivered: false,
          provider_delivery_claimed: false,
          provider_delivery_permitted: false,
          provider_delivery_attempted: false,
          provider_delivery_duplicate_prevented:
            providerDeliveryDuplicatePrevented,
          provider_delivery_idempotency_key: providerDeliveryIdempotencyKey,
          provider_delivery_blocked_reason:
            queuedMessage.routeCMatrixDelivery
              ?.provider_delivery_blocked_reason ||
            "local_oysterun_skill_install_command",
          provider_id: providerId,
          message_id: queuedMessage.id,
          proof:
            queuedMessage.routeCMatrixDelivery?.host2_intake_proof ||
            getRouteCHost2IntakeProof({
              hostSessionId: session.id,
              matrixRoomId,
              serverEventId,
            }),
        };
      }
      return {
        status:
          providerId === "codex"
            ? "real_codex_provider_delivery_queued"
            : providerId === "claude"
            ? "real_claude_provider_delivery_queued"
            : "provider_delivery_queued",
        delivered: true,
        provider_delivery_claimed:
          queuedMessage.routeCMatrixDelivery?.provider_delivery_claimed ===
          true,
        provider_delivery_permitted:
          queuedMessage.routeCMatrixDelivery?.provider_delivery_permitted ===
          true,
        provider_delivery_attempted:
          queuedMessage.routeCMatrixDelivery?.provider_delivery_attempted ===
          true,
        provider_delivery_duplicate_prevented:
          providerDeliveryDuplicatePrevented,
        provider_delivery_idempotency_key: providerDeliveryIdempotencyKey,
        provider_delivery_blocked_reason:
          queuedMessage.routeCMatrixDelivery
            ?.provider_delivery_blocked_reason || null,
        provider_id: providerId,
        message_id: queuedMessage.id,
        proof:
          queuedMessage.routeCMatrixDelivery?.host2_intake_proof ||
          getRouteCHost2IntakeProof({
            hostSessionId: session.id,
            matrixRoomId,
            serverEventId,
          }),
      };
    } catch (err) {
      const proof = recordRouteCProviderDeliveryFailure({
        hostSessionId: session.id,
        matrixRoomId,
        serverEventId,
        providerId,
        error: err.message || String(err),
      });
      throw new Error(
        `Route C provider delivery failed for Matrix event ${serverEventId}: ${
          err.message || err
        }`,
        {
          cause: err,
        }
      );
    }
  }

  /**
   * Get newest live session for an agent.
   */
  getAgentSession(agentId) {
    const sessionId = this.getAgentSessionId(agentId);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) || null;
  }

  getSession(sessionId) {
    if (!sessionId) return null;
    return this.sessions.get(sessionId) || null;
  }

  updateRuntimeCapabilities(sessionId, runtimeCapabilities = {}) {
    const session = this.requireSession(sessionId);
    if (
      !runtimeCapabilities ||
      typeof runtimeCapabilities !== "object" ||
      Array.isArray(runtimeCapabilities)
    ) {
      throw new Error("runtimeCapabilities must be an object");
    }
    session.runtimeCapabilities = JSON.parse(
      JSON.stringify(runtimeCapabilities)
    );
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, {
        type: "session.notice",
        provider: session.provider || "claude",
        subtype: "runtime.capabilities.updated",
        payload: {
          session_id: session.id,
          current_session_only: true,
          config_mutated: false,
          runtime_capabilities: session.runtimeCapabilities,
        },
      })
    );
    return session.runtimeCapabilities;
  }

  renameSession(sessionId, sessionName) {
    const session = this.requireSession(sessionId);
    const resolvedSessionName = normalizeSessionName(sessionName);
    if (!resolvedSessionName) {
      throw new Error("session_name required");
    }
    const currentSessionName = normalizeSessionName(session.sessionName);
    if (currentSessionName === resolvedSessionName) {
      return { session, changed: false };
    }
    if (
      this.hasRunningSessionName(resolvedSessionName, {
        excludeSessionId: sessionId,
      })
    ) {
      throw new Error(buildSessionNameConflictMessage(resolvedSessionName));
    }

    updateSessionRecord(session.historyRecordId || session.id, {
      session_name: resolvedSessionName,
      last_active_at: new Date().toISOString(),
    });
    session.sessionName = resolvedSessionName;
    this.emit(
      "runtimeEvent",
      session.agentId,
      this.decorateEvent(session, {
        type: "session.notice",
        subtype: "session_name.updated",
        session_name: resolvedSessionName,
        payload: {
          sessionName: resolvedSessionName,
        },
      })
    );
    return { session, changed: true };
  }

  registerSessionAssetReadablePaths(sessionId, assetReadablePaths = []) {
    const session = this.requireSession(sessionId);
    session.assetReadablePaths = normalizeAssetReadablePaths([
      ...(Array.isArray(session.assetReadablePaths)
        ? session.assetReadablePaths
        : []),
      ...assetReadablePaths,
    ]);
    return session.assetReadablePaths;
  }

  getAgentSessions(agentId) {
    const sessionIds = this.agentSessions.get(agentId);
    if (!sessionIds || sessionIds.size === 0) return [];
    return [...sessionIds]
      .map((sessionId) => this.sessions.get(sessionId) || null)
      .filter(Boolean);
  }

  interruptAgent(agentId) {
    const session = this.getAgentSession(agentId);
    if (!session) throw new Error(`No active session for agent ${agentId}`);
    return this.interruptSession(session.id);
  }

  buildSessionInterruptResult(session, result = {}) {
    const provider = session.provider || session.adapterId || "claude";
    const accepted = result.accepted === true || result.status === "accepted";
    const status =
      typeof result.status === "string" && result.status.trim()
        ? result.status.trim()
        : accepted
        ? "accepted"
        : "unknown";
    return {
      schema_version: "routec.session_interrupt_result.v1",
      status,
      accepted,
      idempotent: result.idempotent === true,
      provider,
      provider_interrupt_attempted:
        result.provider_interrupt_attempted === true ||
        result.providerInterruptAttempted === true,
      provider_interrupt_method:
        typeof result.provider_interrupt_method === "string"
          ? result.provider_interrupt_method
          : typeof result.providerInterruptMethod === "string"
          ? result.providerInterruptMethod
          : null,
      reason:
        typeof result.reason === "string" && result.reason.trim()
          ? result.reason.trim()
          : null,
      raw_provider_response_exposed: false,
      provider_session_id_present: result.provider_session_id_present === true,
      provider_thread_id_present: result.provider_thread_id_present === true,
      provider_turn_id_present: result.provider_turn_id_present === true,
    };
  }

  interruptSession(sessionId) {
    const session = this.requireSession(sessionId);
    const adapter = this.getAdapter(
      session.provider || session.adapterId || "claude"
    );
    if (typeof adapter.interruptSession !== "function") {
      throw new Error(
        `Provider "${
          session.provider || session.adapterId || "claude"
        }" does not support interrupt`
      );
    }
    if (session._deliveryState === "interrupting") {
      const result = this.buildSessionInterruptResult(session, {
        status: "already_interrupting",
        accepted: true,
        idempotent: true,
        provider_interrupt_attempted: false,
        reason: "interrupt_already_in_flight",
      });
      session._interruptResult = result;
      this.emitDeliveryStateNotice(session);
      return result;
    }
    session._deliveryState = "interrupting";
    this.emitDeliveryStateNotice(session);
    const result = this.buildSessionInterruptResult(
      session,
      adapter.interruptSession(session) || {
        status: "accepted",
        accepted: true,
        provider_interrupt_attempted: true,
      }
    );
    session._interruptResult = result;
    if (result.accepted !== true) {
      session._deliveryState = "ready";
      this.emitDeliveryStateNotice(session);
    }
    return result;
  }

  waitForSessionExit(session, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!session.alive) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(`Timed out waiting for session ${session.id} to exit`)
        );
      }, timeoutMs);

      const onExit = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timer);
        session.off("exit", onExit);
      };

      session.on("exit", onExit);
    });
  }

  /**
   * Gracefully stop an agent's session.
   */
  async stopAgent(agentId) {
    const session = this.getAgentSession(agentId);
    if (!session) throw new Error(`No active session for agent ${agentId}`);
    await this.stopSession(session.id);
  }

  async stopSession(sessionId) {
    const session = this.requireSession(sessionId);
    const agentId = session.agentId;
    const adapter = this.getAdapter(
      session.provider || session.adapterId || "claude"
    );
    adapter.stopSession(session);
    try {
      await this.waitForSessionExit(session);
    } catch (err) {
      this.emit(
        "runtimeEvent",
        agentId,
        this.decorateEvent(session, {
          type: "session.notice",
          provider: session.provider,
          subtype: "stop.timeout",
          error: err.message,
        })
      );
      adapter.killSession(session);
      await this.waitForSessionExit(session, 5000);
    }
  }

  /**
   * Force kill an agent's session.
   */
  async killAgent(agentId) {
    const session = this.getAgentSession(agentId);
    if (!session) throw new Error(`No active session for agent ${agentId}`);
    await this.killSession(session.id);
  }

  async killSession(sessionId) {
    const session = this.requireSession(sessionId);
    const adapter = this.getAdapter(
      session.provider || session.adapterId || "claude"
    );
    adapter.killSession(session);
    await this.waitForSessionExit(session, 5000);
  }

  /**
   * Restart an agent's session with adapter-level resume support.
   * @param {string} agentId
   * @param {object} [overrides] - Optional overrides for model, permissionMode, allowDangerouslySkipPermissions, workspacePolicy
   */
  async restartAgent(agentId, overrides = {}) {
    const session = this.getAgentSession(agentId);
    if (!session) throw new Error(`No active session for agent ${agentId}`);
    return this.restartSession(session.id, overrides);
  }

  async restartSession(sessionId, overrides = {}) {
    const session = this.requireSession(sessionId);

    const cwd = session.cwd;
    const agentId = session.agentId;
    const currentProvider = session.provider || session.adapterId || "claude";
    const nextProvider = overrides.provider || currentProvider;
    const providerResumeId =
      nextProvider === currentProvider
        ? this.getEffectiveProviderResumeId(session) || session.id
        : undefined;
    const nextSessionId = session.id;
    const workspacePolicy =
      overrides.workspacePolicy ?? session.workspacePolicy;
    const assetReadablePaths =
      overrides.assetReadablePaths ?? session.assetReadablePaths ?? [];

    // Stop the session gracefully
    const adapter = this.getAdapter(
      session.provider || session.adapterId || "claude"
    );
    if (
      typeof adapter.supportsResume === "function" &&
      adapter.supportsResume() !== true
    ) {
      throw new Error(
        `Provider "${
          session.provider || session.adapterId || "claude"
        }" does not support restart/resume yet`
      );
    }
    adapter.stopSession(session);

    // Wait for exit
    await new Promise((resolve) => {
      if (!session.alive) return resolve();
      session.once("exit", resolve);
    });

    // Start new session with --resume (and optional overrides)
    return this.start({
      agentId,
      cwd,
      provider: nextProvider,
      sessionId: nextSessionId,
      sessionName: overrides.sessionName ?? session.sessionName,
      resumeSessionId: providerResumeId,
      resume: providerResumeId !== undefined,
      model: overrides.model,
      reasoningEffort: overrides.reasoningEffort ?? session.reasoningEffort,
      reasoningEffortSource:
        overrides.reasoningEffortSource ?? session.reasoningEffortSource,
      permissionMode: overrides.permissionMode,
      approvalPolicy: overrides.approvalPolicy,
      sandboxMode: overrides.sandboxMode,
      dangerousMode: overrides.dangerousMode,
      allowDangerouslySkipPermissions:
        overrides.allowDangerouslySkipPermissions ??
        session.allowDangerouslySkipPermissions,
      searchEnabled: overrides.searchEnabled ?? session.searchEnabled,
      imageInputEnabled:
        overrides.imageInputEnabled ?? session.imageInputEnabled,
      native: overrides.native ?? session.native,
      workspacePolicy,
      assetReadablePaths,
      runtimeCapabilities:
        overrides.runtimeCapabilities ?? session.runtimeCapabilities,
      runtimeCapabilityEnv:
        overrides.runtimeCapabilityEnv ?? session.runtimeCapabilityEnv,
      runtimeCapabilityGrant:
        overrides.runtimeCapabilityGrant ?? session.runtimeCapabilityGrant,
      runtimeCapabilityRedactionValues:
        overrides.runtimeCapabilityRedactionValues ??
        session.runtimeCapabilityRedactionValues,
    });
  }

  snapshotHostRestartState() {
    return [...this.sessions.entries()].map(([sessionId, session]) => ({
      session_id: sessionId,
      session_name: session.sessionName || null,
      agent_id: session.agentId,
      agent_folder: session.cwd,
      provider: session.provider || "claude",
      model: session.model ?? null,
      reasoning_effort: session.reasoningEffort ?? null,
      permission_mode: session.permissionMode ?? null,
      approval_policy: session.approvalPolicy ?? null,
      sandbox_mode: session.sandboxMode ?? null,
      dangerous_mode: session.dangerousMode === true,
      provider_resume_id: this.getEffectiveProviderResumeId(session),
      provider_thread_id: session.threadId || null,
      provider_transport: session.transport || null,
      runtime_capabilities: cloneJsonObject(session.runtimeCapabilities) || {},
      runtime_capability_grant: cloneJsonObject(session.runtimeCapabilityGrant),
      reasoning_effort_source: session.reasoningEffortSource || null,
      native: cloneJsonObject(session.native) || session.native || null,
      workspace_policy: cloneJsonObject(session.workspacePolicy),
      asset_readable_paths: Array.isArray(session.assetReadablePaths)
        ? [...session.assetReadablePaths]
        : [],
      notification_config: serializeHostRestartNotificationConfig(
        session.notificationConfig
      ),
      notification_config_updated_at: normalizeHostRestartString(
        session.notificationConfigUpdatedAt
      ),
      search_enabled: session.searchEnabled === true,
      image_input_enabled: session.imageInputEnabled === true,
      allow_dangerously_skip_permissions:
        session.allowDangerouslySkipPermissions === true,
      alive_before_restart: session.alive === true,
      ready_before_restart: session._ready === true,
      started_at: session.historyCreatedAt || session.startedAt || null,
      last_active_at:
        session.lastActiveAt || session.historyCreatedAt || session.startedAt || null,
      restore_policy: "provider_runtime_resume_on_boot",
      prompt_replay: false,
    }));
  }

  restoreHostRestartState(
    sessions = [],
    { restartId, restoredAt, buildRuntimeCapabilityGrant = null } = {}
  ) {
    const restored = [];
    const skipped = [];
    const failed = [];
    const timestamp = restoredAt || new Date().toISOString();
    for (const record of Array.isArray(sessions) ? sessions : []) {
      const id = typeof record?.session_id === "string" ? record.session_id : "";
      const agentId = typeof record?.agent_id === "string" ? record.agent_id : "";
      if (!id || !agentId) {
        skipped.push({ session_id: id || null, reason: "missing_session_or_agent_id" });
        continue;
      }
      if (this.sessions.has(id)) {
        skipped.push({ session_id: id, reason: "already_live" });
        continue;
      }
      const agentFolder =
        typeof record?.agent_folder === "string" ? record.agent_folder : "";
      if (!agentFolder) {
        failed.push({
          session_id: id,
          agent_id: agentId,
          reason: "missing_agent_folder",
        });
        continue;
      }
      const wasLiveOrReady =
        record.alive_before_restart === true ||
        record.ready_before_restart === true;
      if (!wasLiveOrReady) {
        skipped.push({
          session_id: id,
          agent_id: agentId,
          reason: "not_live_or_ready_before_restart",
        });
        continue;
      }
      const provider = record.provider || "claude";
      let adapter;
      try {
        adapter = this.getAdapter(provider);
      } catch (err) {
        failed.push({
          session_id: id,
          agent_id: agentId,
          provider,
          reason: "provider_adapter_unavailable",
          error: err.message || String(err),
        });
        continue;
      }
      if (
        typeof adapter.supportsResume !== "function" ||
        adapter.supportsResume() !== true
      ) {
        failed.push({
          session_id: id,
          agent_id: agentId,
          provider,
          reason: "provider_resume_unsupported",
        });
        continue;
      }
      const providerResumeId =
        provider === "codex"
          ? normalizeProviderMetadataId(record.provider_thread_id) ||
            normalizeProviderMetadataId(record.provider_resume_id)
          : normalizeProviderMetadataId(record.provider_resume_id);
      if (!providerResumeId) {
        failed.push({
          session_id: id,
          agent_id: agentId,
          provider,
          reason: "provider_resume_metadata_missing",
        });
        continue;
      }
      const runtimeCapabilities =
        record.runtime_capabilities && typeof record.runtime_capabilities === "object"
          ? JSON.parse(JSON.stringify(record.runtime_capabilities))
          : {};
      let runtimeGrant = { env: {}, metadata: null, redactionValues: [] };
      if (typeof buildRuntimeCapabilityGrant === "function") {
        try {
          runtimeGrant = buildRuntimeCapabilityGrant({
            sessionId: id,
            agentId,
            capabilities: runtimeCapabilities,
            record,
          }) || runtimeGrant;
        } catch (err) {
          failed.push({
            session_id: id,
            agent_id: agentId,
            provider,
            reason: "runtime_capability_grant_failed",
            error: err.message || String(err),
          });
          continue;
        }
      }
      const restoredNotificationConfig = normalizeHostRestartNotificationConfig(
        record.notification_config || record.notificationConfig
      );
      const restoredNotificationConfigUpdatedAt =
        normalizeHostRestartString(record.notification_config_updated_at) ||
        normalizeHostRestartString(record.notificationConfigUpdatedAt);
      let session;
      try {
        session = this.start({
          agentId,
          cwd: agentFolder,
          provider,
          sessionId: id,
          sessionName: record.session_name || id,
          resumeSessionId: providerResumeId,
          resume: true,
          fork: false,
          model: record.model ?? undefined,
          reasoningEffort: record.reasoning_effort ?? undefined,
          reasoningEffortSource:
            record.reasoning_effort_source ?? undefined,
          permissionMode: record.permission_mode ?? undefined,
          approvalPolicy: record.approval_policy ?? undefined,
          sandboxMode: record.sandbox_mode ?? undefined,
          dangerousMode: record.dangerous_mode === true,
          allowDangerouslySkipPermissions:
            record.allow_dangerously_skip_permissions === true,
          searchEnabled: record.search_enabled === true,
          imageInputEnabled: record.image_input_enabled === true,
          native: record.native || undefined,
          workspacePolicy: record.workspace_policy ?? undefined,
          assetReadablePaths: Array.isArray(record.asset_readable_paths)
            ? record.asset_readable_paths
            : [],
          runtimeCapabilities,
          runtimeCapabilityEnv: runtimeGrant.env || {},
          runtimeCapabilityGrant: runtimeGrant.metadata || null,
          runtimeCapabilityRedactionValues: runtimeGrant.redactionValues || [],
        });
      } catch (err) {
        failed.push({
          session_id: id,
          agent_id: agentId,
          provider,
          provider_resume_id: providerResumeId,
          reason: "provider_runtime_resume_start_failed",
          error: err.message || String(err),
        });
        continue;
      }
      if (restoredNotificationConfig) {
        session.notificationConfig = restoredNotificationConfig;
      }
      if (restoredNotificationConfigUpdatedAt) {
        session.notificationConfigUpdatedAt =
          restoredNotificationConfigUpdatedAt;
      }
      session.hostRestartRestore = {
        restart_id: restartId || null,
        restored_at: timestamp,
        restore_policy: "provider_runtime_resume_on_boot",
        restore_status:
          session._ready === true ? "provider_runtime_ready" : "provider_runtime_starting",
        prompt_replay: false,
        provider_transport_restore_attempted: true,
        provider_transport_restored: session._ready === true,
      };
      session.bookkeepingWarnings = [
        ...(session.bookkeepingWarnings || []),
        "host_restart_restore: provider runtime resume attempted on boot",
      ];
      if (record.started_at) {
        session.historyCreatedAt = record.started_at;
      }
      if (record.last_active_at) {
        session.lastActiveAt = record.last_active_at;
      }

      const markProviderRuntimeRestored = () => {
        if (!session.hostRestartRestore) return;
        session.hostRestartRestore.restore_status = "provider_runtime_ready";
        session.hostRestartRestore.provider_transport_restored = true;
      };
      const markProviderRuntimeFailed = (err) => {
        if (!session.hostRestartRestore) return;
        if (session.hostRestartRestore.provider_transport_restored === true) {
          return;
        }
        session.hostRestartRestore.restore_status =
          "provider_runtime_restore_failed";
        session.hostRestartRestore.provider_transport_restored = false;
        session.hostRestartRestore.restore_error =
          err?.message || String(err || "provider runtime restore failed");
      };
      if (session._ready === true) {
        markProviderRuntimeRestored();
      }
      session.on("event", (event) => {
        if (event?.type === "session.ready") {
          markProviderRuntimeRestored();
        }
      });
      session.on("error", markProviderRuntimeFailed);
      session.on("exit", () => {
        markProviderRuntimeFailed("provider runtime exited before restore ready");
      });

      try {
        updateSessionRecord(id, {
          session_id: id,
          session_name: session.sessionName,
          parent_session_id: session.parentSessionId || null,
          agent_id: agentId,
          agent_folder: session.cwd,
          runtime: session.provider,
          model: session.model,
          provider_resume_id: this.getEffectiveProviderResumeId(session),
          provider_thread_id: session.threadId || providerResumeId || null,
          provider_transport: session.transport || null,
          created_at: session.historyCreatedAt,
          last_active_at: timestamp,
        });
      } catch {
        // The normal start path already wrote the record when possible.
      }
      restored.push({
        session_id: id,
        agent_id: agentId,
        provider,
        provider_resume_id: this.getEffectiveProviderResumeId(session),
        provider_thread_id: session.threadId || providerResumeId || null,
        restore_policy: "provider_runtime_resume_on_boot",
        restored_as_runtime: true,
        provider_transport_restore_attempted: true,
        provider_transport_restored: session._ready === true,
        prompt_replay: false,
      });
    }
    return { restored, skipped, failed };
  }

  /**
   * Stop all sessions.
   */
  stopAll() {
    for (const session of [...this.sessions.values()]) {
      const adapter = this.getAdapter(
        session.provider || session.adapterId || "claude"
      );
      adapter.stopSession(session);
    }
  }

  /**
   * List active sessions with agent mapping.
   */
  list() {
    return [...this.sessions.entries()].map(([id, s]) => ({
      sessionId: id,
      sessionName: s.sessionName || null,
      agentId: s.agentId,
      provider: s.provider || "claude",
      cwd: s.cwd,
      model: s.model ?? null,
      reasoningEffort: s.reasoningEffort ?? null,
      permissionMode: s.permissionMode ?? null,
      approvalPolicy: s.approvalPolicy ?? null,
      sandboxMode: s.sandboxMode ?? null,
      dangerousMode: s.dangerousMode === true,
      alive: s.alive,
      ready: s._ready,
      capabilities: s.capabilities || {},
      runtimeCapabilities: s.runtimeCapabilities || {},
      runtimeCapabilityGrant: s.runtimeCapabilityGrant || null,
      allowDangerouslySkipPermissions:
        s.allowDangerouslySkipPermissions === true,
      searchEnabled: s.searchEnabled === true,
      imageInputEnabled: s.imageInputEnabled === true,
      native: s.native || {
        args: [],
        configOverrides: {},
        commands: [],
        profile: null,
      },
      workspacePolicy: s.workspacePolicy,
      providerResumeId: this.getEffectiveProviderResumeId(s),
      providerThreadId: s.threadId || null,
      transport: s.transport || null,
      toolsCount: Number.isInteger(s.toolsCount) ? s.toolsCount : null,
      startedAt: s.historyCreatedAt || null,
      lastActiveAt: s.lastActiveAt || s.historyCreatedAt || null,
      hostRestartRestore: s.hostRestartRestore || null,
    }));
  }

  hasRunningSessionName(sessionName, opts = {}) {
    const normalized = normalizeSessionName(sessionName);
    if (!normalized) return false;
    const excludeSessionId = opts.excludeSessionId || null;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (excludeSessionId && sessionId === excludeSessionId) continue;
      if (normalizeSessionName(session.sessionName) === normalized) {
        return true;
      }
    }
    return false;
  }

  decorateEvent(session, event) {
    const decorated = {
      agentId: session.agentId,
      sessionId: session.id,
      provider: session.provider || "claude",
      reasoning_effort: session.reasoningEffort ?? null,
      created_at: event.created_at || new Date().toISOString(),
      ...event,
    };
    return redactRuntimeCapabilityPayload(
      decorated,
      normalizeRedactionValues(session.runtimeCapabilityRedactionValues)
    );
  }
}
