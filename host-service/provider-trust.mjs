import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";

export const PROVIDER_TRUST_CONTRACT =
  "p111_provider_trusted_folder_mechanism_v1";

const SUPPORTED_TRUST_PROVIDERS = new Set(["claude", "codex"]);

class ProviderTrustError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ProviderTrustError";
    this.code = code;
  }
}

function normalizeProviderId(provider) {
  return typeof provider === "string" && provider.trim()
    ? provider.trim()
    : "claude";
}

function normalizeEnv(env) {
  return env && typeof env === "object" && !Array.isArray(env) ? env : {};
}

function providerHomeFromEnv(env) {
  const rawHome = typeof env.HOME === "string" && env.HOME.trim()
    ? env.HOME
    : homedir();
  return resolve(rawHome);
}

function timestampForPath(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return date.toISOString().replace(/[:.]/g, "");
}

function resolveAgentRootRealpath(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    throw new ProviderTrustError("agent root is required", "agent_root_missing");
  }
  const agentRoot = realpathSync(resolve(cwd));
  if (!statSync(agentRoot).isDirectory()) {
    throw new ProviderTrustError(
      "agent root must resolve to a directory",
      "agent_root_not_directory"
    );
  }
  return agentRoot;
}

function resolveProviderTrustConfigPath(provider, env) {
  if (provider === "codex") {
    const codexHome =
      typeof env.CODEX_HOME === "string" && env.CODEX_HOME.trim()
        ? resolve(env.CODEX_HOME)
        : join(providerHomeFromEnv(env), ".codex");
    return join(codexHome, "config.toml");
  }
  if (provider === "claude") {
    return join(providerHomeFromEnv(env), ".claude.json");
  }
  return null;
}

function buildBaseResult({ provider, agentRootRealpath, configPath }) {
  return {
    contract: PROVIDER_TRUST_CONTRACT,
    provider,
    supported: SUPPORTED_TRUST_PROVIDERS.has(provider),
    agent_root_realpath: agentRootRealpath,
    config_path: configPath,
    status: "needs_trust_write",
    reason: "trust_entry_missing",
    backup_path: null,
    written_at: null,
    error_code: null,
    warning: null,
    raw_secret_material_exposed: false,
  };
}

function buildUnsupportedResult({ provider, agentRootRealpath }) {
  return {
    ...buildBaseResult({
      provider,
      agentRootRealpath,
      configPath: null,
    }),
    supported: false,
    status: "trusted",
    reason: "provider_trust_unsupported_noop",
  };
}

function buildFailureResult(base, err, backupPath = null) {
  const errorCode = err?.code || "provider_trust_write_failed";
  return {
    ...base,
    status: "trust_write_failed",
    reason: errorCode,
    backup_path: backupPath,
    error_code: errorCode,
    warning:
      `Provider trusted-folder write failed for ${base.provider}; ` +
      "session start will continue and the provider may ask for folder trust.",
  };
}

function parseTomlQuotedKey(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new ProviderTrustError(
      "Codex project trust key is malformed",
      "codex_config_parse_failed"
    );
  }
}

function assertReadableCodexToml(source) {
  const lines = String(source || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("[")) continue;
    if (!/^(\[\[[^\[\]\n]+\]\]|\[[^\[\]\n]+\])$/.test(trimmed)) {
      throw new ProviderTrustError(
        "Codex config contains an unreadable table header",
        "codex_config_parse_failed"
      );
    }
    if (trimmed.startsWith("[projects.")) {
      const match = trimmed.match(/^\[projects\.("(?:[^"\\]|\\.)*")\]$/);
      if (!match) {
        throw new ProviderTrustError(
          "Codex project trust table is malformed",
          "codex_config_parse_failed"
        );
      }
      parseTomlQuotedKey(match[1]);
    }
  }
}

function codexProjectHeader(agentRootRealpath) {
  return `[projects.${JSON.stringify(agentRootRealpath)}]`;
}

function findCodexProjectBlock(source, agentRootRealpath) {
  const lines = String(source || "").split(/\r?\n/);
  const header = codexProjectHeader(agentRootRealpath);
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === header) {
      start = index;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("[")) {
      end = index;
      break;
    }
  }
  return { lines, start, end };
}

function codexConfigHasTrust(source, agentRootRealpath) {
  assertReadableCodexToml(source);
  const block = findCodexProjectBlock(source, agentRootRealpath);
  if (!block) return false;
  for (let index = block.start + 1; index < block.end; index += 1) {
    if (/^\s*trust_level\s*=\s*"trusted"\s*(?:#.*)?$/.test(block.lines[index])) {
      return true;
    }
  }
  return false;
}

function updateCodexTrustConfig(source, agentRootRealpath) {
  assertReadableCodexToml(source);
  const header = codexProjectHeader(agentRootRealpath);
  const block = findCodexProjectBlock(source, agentRootRealpath);
  if (!block) {
    const prefix = source && !source.endsWith("\n") ? `${source}\n` : source || "";
    return `${prefix}${prefix ? "\n" : ""}${header}\ntrust_level = "trusted"\n`;
  }
  let trustLineIndex = -1;
  for (let index = block.start + 1; index < block.end; index += 1) {
    if (/^\s*trust_level\s*=/.test(block.lines[index])) {
      trustLineIndex = index;
      break;
    }
  }
  if (trustLineIndex === -1) {
    block.lines.splice(block.start + 1, 0, 'trust_level = "trusted"');
  } else {
    block.lines[trustLineIndex] = 'trust_level = "trusted"';
  }
  return `${block.lines.join("\n")}${source.endsWith("\n") ? "\n" : ""}`;
}

function claudeConfigHasTrust(source, agentRootRealpath) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    const parseErr = new ProviderTrustError(
      "Claude settings JSON is malformed",
      "claude_config_parse_failed"
    );
    parseErr.cause = err;
    throw parseErr;
  }
  return (
    parsed &&
    typeof parsed === "object" &&
    parsed.projects &&
    typeof parsed.projects === "object" &&
    parsed.projects[agentRootRealpath] &&
    parsed.projects[agentRootRealpath].hasTrustDialogAccepted === true
  );
}

function updateClaudeTrustConfig(source, agentRootRealpath) {
  let parsed;
  try {
    parsed = source && source.trim() ? JSON.parse(source) : {};
  } catch (err) {
    const parseErr = new ProviderTrustError(
      "Claude settings JSON is malformed",
      "claude_config_parse_failed"
    );
    parseErr.cause = err;
    throw parseErr;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderTrustError(
      "Claude settings must be a JSON object",
      "claude_config_parse_failed"
    );
  }
  if (!parsed.projects || typeof parsed.projects !== "object") {
    parsed.projects = {};
  }
  const project = parsed.projects[agentRootRealpath];
  parsed.projects[agentRootRealpath] =
    project && typeof project === "object" && !Array.isArray(project)
      ? { ...project, hasTrustDialogAccepted: true }
      : { hasTrustDialogAccepted: true };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function readProviderTrustStatus(base) {
  if (!existsSync(base.config_path)) {
    return {
      ...base,
      status: "needs_trust_write",
      reason: "config_missing",
    };
  }
  const source = readFileSync(base.config_path, "utf8");
  if (base.provider === "codex") {
    return codexConfigHasTrust(source, base.agent_root_realpath)
      ? { ...base, status: "trusted", reason: "exact_agent_root_trusted" }
      : { ...base, status: "needs_trust_write", reason: "trust_entry_missing" };
  }
  if (base.provider === "claude") {
    return claudeConfigHasTrust(source, base.agent_root_realpath)
      ? { ...base, status: "trusted", reason: "exact_agent_root_trusted" }
      : { ...base, status: "needs_trust_write", reason: "trust_entry_missing" };
  }
  return { ...base, status: "trusted", reason: "provider_trust_unsupported_noop" };
}

function acquireTrustLock(configPath) {
  mkdirSync(dirname(configPath), { recursive: true });
  const lockPath = `${configPath}.oysterun-trust.lock`;
  let fd = null;
  try {
    fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, `${process.pid}\n`);
  } catch (err) {
    if (fd !== null) closeSync(fd);
    const lockErr = new ProviderTrustError(
      `Provider trust lock is busy: ${lockPath}`,
      "provider_trust_lock_busy"
    );
    lockErr.cause = err;
    throw lockErr;
  }
  return () => {
    try {
      if (fd !== null) closeSync(fd);
    } finally {
      rmSync(lockPath, { force: true });
    }
  };
}

function createBackup(configPath, now) {
  if (!existsSync(configPath)) return null;
  const backupPath = `${configPath}.oysterun-backup-${timestampForPath(now)}`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}

function restoreBackup(configPath, backupPath) {
  if (!backupPath) return;
  try {
    copyFileSync(backupPath, configPath);
  } catch {
    // The failure result already tells the caller the write did not complete.
  }
}

function writeAtomic(configPath, content) {
  mkdirSync(dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, content, { mode: 0o600 });
    renameSync(tempPath, configPath);
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }
}

function writeProviderTrust(base) {
  const existing = existsSync(base.config_path)
    ? readFileSync(base.config_path, "utf8")
    : "";
  if (base.provider === "codex") {
    writeAtomic(
      base.config_path,
      updateCodexTrustConfig(existing, base.agent_root_realpath)
    );
    return;
  }
  if (base.provider === "claude") {
    writeAtomic(
      base.config_path,
      updateClaudeTrustConfig(existing, base.agent_root_realpath)
    );
    return;
  }
  throw new ProviderTrustError(
    `Unsupported provider trust target: ${base.provider}`,
    "provider_trust_unsupported"
  );
}

function resolveProviderTrustBase({ provider, cwd, env = process.env }) {
  const normalizedProvider = normalizeProviderId(provider);
  const agentRootRealpath = resolveAgentRootRealpath(cwd);
  if (!SUPPORTED_TRUST_PROVIDERS.has(normalizedProvider)) {
    return buildUnsupportedResult({
      provider: normalizedProvider,
      agentRootRealpath,
    });
  }
  return buildBaseResult({
    provider: normalizedProvider,
    agentRootRealpath,
    configPath: resolveProviderTrustConfigPath(
      normalizedProvider,
      normalizeEnv(env)
    ),
  });
}

export function getProviderTrustedFolderStatus(options = {}) {
  const base = resolveProviderTrustBase(options);
  if (!base.supported) return base;
  try {
    return readProviderTrustStatus(base);
  } catch (err) {
    return buildFailureResult(base, err);
  }
}

export function ensureProviderTrustedAgentRoot(options = {}) {
  const base = resolveProviderTrustBase(options);
  if (!base.supported) return base;
  const currentStatus = getProviderTrustedFolderStatus(options);
  if (currentStatus.status === "trusted") {
    return currentStatus;
  }
  let releaseLock = null;
  let backupPath = null;
  try {
    releaseLock = acquireTrustLock(base.config_path);
    backupPath = createBackup(base.config_path, options.now);
    writeProviderTrust(base);
    return {
      ...base,
      status: "trusted",
      reason: "trust_entry_written",
      backup_path: backupPath,
      written_at: new Date().toISOString(),
    };
  } catch (err) {
    restoreBackup(base.config_path, backupPath);
    return buildFailureResult(base, err, backupPath);
  } finally {
    if (releaseLock) releaseLock();
  }
}
