import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import {
  AGENT_CONFIG_DIRNAME,
  AGENT_LOCAL_CONFIG_FILENAME,
  AGENT_SHARED_CONFIG_FILENAME,
  AGENT_SITE_DIRNAME,
  LEGACY_AGENT_LOCAL_CONFIG_FILENAME,
  getAgentConfigPaths,
  validateLocalAgentConfig,
  validateSharedAgentConfig,
} from "./agent-config.mjs";

function pathKind(targetPath) {
  const stats = statSync(targetPath, { throwIfNoEntry: false });
  if (!stats) return null;
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "other";
}

function readObjectFile(filePath, label) {
  const raw = readFileSync(filePath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} ${filePath}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} root object in ${filePath}`);
  }
  return parsed;
}

function readOptionalObjectFile(filePath, label) {
  if (!existsSync(filePath)) return null;
  return readObjectFile(filePath, label);
}

function readSessionHistoryAgentFolders(configDir) {
  const historyPath = join(configDir, "session-history.json");
  if (!existsSync(historyPath)) return [];
  const raw = readFileSync(historyPath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in session history ${historyPath}: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid session history root in ${historyPath}`);
  }
  return parsed
    .map((entry) => (entry && typeof entry === "object" ? entry.agent_folder : null))
    .filter((folderPath) => typeof folderPath === "string" && folderPath.trim())
    .map((folderPath) => resolve(folderPath.trim()));
}

function readConfiguredBrowseRoot(configDir) {
  const hostConfigPath = join(configDir, "config.json");
  if (!existsSync(hostConfigPath)) return null;
  const parsed = readObjectFile(hostConfigPath, "host config");
  const configured = typeof parsed.default_browse_path === "string" ? parsed.default_browse_path.trim() : "";
  if (!configured) return null;
  return resolve(configured);
}

function deriveDefaultBrowseRootPathForHome(configDir, homePath) {
  const resolvedHomePath = resolve(homePath);
  const resolvedConfigDir = resolve(configDir);
  const stacksRoot = resolve(join(resolvedHomePath, ".oysterun-stacks"));
  const parentDir = dirname(resolvedConfigDir);
  const grandparentDir = dirname(parentDir);
  if (basename(resolvedConfigDir) === "host" && grandparentDir === stacksRoot) {
    return resolve(join(resolvedHomePath, `OysterAgents_${basename(parentDir)}`));
  }
  return resolve(join(resolvedHomePath, "OysterAgents"));
}

function scanBrowseRootForLegacyAgentFolders(rootPath) {
  if (!rootPath || !existsSync(rootPath)) return [];
  if (pathKind(rootPath) !== "directory") return [];

  const discovered = [];
  for (const entry of readdirSync(resolve(rootPath), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const folderPath = resolve(rootPath, entry.name);
    const sharedKind = pathKind(join(folderPath, AGENT_CONFIG_DIRNAME));
    const localKind = pathKind(join(folderPath, LEGACY_AGENT_LOCAL_CONFIG_FILENAME));
    if (sharedKind === "directory" || sharedKind === "file" || localKind === "file") {
      discovered.push(folderPath);
    }
  }
  return discovered;
}

export function discoverHostConfigDirs({ homePath = homedir() } = {}) {
  const resolvedHomePath = resolve(homePath);
  const configDirs = new Set();
  const productionDir = join(resolvedHomePath, ".oysterun");
  if (pathKind(productionDir) === "directory") {
    configDirs.add(productionDir);
  }

  const stacksRoot = join(resolvedHomePath, ".oysterun-stacks");
  if (pathKind(stacksRoot) === "directory") {
    for (const entry of readdirSync(stacksRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const hostDir = join(stacksRoot, entry.name, "host");
      if (pathKind(hostDir) === "directory") {
        configDirs.add(hostDir);
      }
    }
  }

  return [...configDirs].sort((left, right) => left.localeCompare(right));
}

export function discoverAgentFoldersForMigration({ homePath = homedir() } = {}) {
  const discovered = new Set();
  const configDirs = discoverHostConfigDirs({ homePath });

  for (const configDir of configDirs) {
    for (const folderPath of readSessionHistoryAgentFolders(configDir)) {
      if (pathKind(folderPath) === "directory") {
        discovered.add(folderPath);
      }
    }

    const configuredBrowseRoot = readConfiguredBrowseRoot(configDir);
    const browseRoot = configuredBrowseRoot || deriveDefaultBrowseRootPathForHome(configDir, homePath);
    for (const folderPath of scanBrowseRootForLegacyAgentFolders(browseRoot)) {
      if (pathKind(folderPath) === "directory") {
        discovered.add(folderPath);
      }
    }
  }

  return [...discovered].sort((left, right) => left.localeCompare(right));
}

export function describeAgentConfigState(folderPath) {
  const paths = getAgentConfigPaths(folderPath);
  const configDirKind = pathKind(paths.configDirPath);
  const legacyLocalKind = pathKind(paths.legacyLocalConfigPath);
  return {
    folderPath: paths.folderPath,
    configDirPath: paths.configDirPath,
    configPath: paths.configPath,
    localConfigPath: paths.localConfigPath,
    sitePath: paths.sitePath,
    hasLegacySharedConfig: configDirKind === "file",
    hasLegacyLocalConfig: legacyLocalKind === "file",
    hasConfigDir: configDirKind === "directory",
    hasSharedConfig: pathKind(paths.configPath) === "file",
    hasLocalConfig: pathKind(paths.localConfigPath) === "file",
    hasSiteDir: pathKind(paths.sitePath) === "directory",
  };
}

export function shouldMigrateAgentFolderState(state) {
  if (state.hasLegacySharedConfig || state.hasLegacyLocalConfig) return true;
  if (state.hasConfigDir && (state.hasSharedConfig || state.hasLocalConfig) && !state.hasSiteDir) return true;
  return false;
}

function jsonEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeJsonFile(filePath, payload) {
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
}

export function migrateAgentFolder(folderPath) {
  const paths = getAgentConfigPaths(folderPath);
  const state = describeAgentConfigState(folderPath);
  const sharedConfig = readOptionalObjectFile(paths.configPath, "agent config")
    ?? (state.hasLegacySharedConfig ? readObjectFile(paths.legacyConfigPath, "legacy agent config") : null);
  const localConfig = readOptionalObjectFile(paths.localConfigPath, "agent local config")
    ?? (state.hasLegacyLocalConfig ? readObjectFile(paths.legacyLocalConfigPath, "legacy agent local config") : null);

  if (sharedConfig) {
    validateSharedAgentConfig(sharedConfig, state.hasSharedConfig ? paths.configPath : paths.legacyConfigPath);
  }
  if (localConfig) {
    validateLocalAgentConfig(localConfig, state.hasLocalConfig ? paths.localConfigPath : paths.legacyLocalConfigPath);
  }

  if (state.hasLegacySharedConfig && state.hasSharedConfig) {
    const legacySharedConfig = readObjectFile(paths.legacyConfigPath, "legacy agent config");
    validateSharedAgentConfig(legacySharedConfig, paths.legacyConfigPath);
    if (!jsonEquals(sharedConfig, legacySharedConfig)) {
      throw new Error(`Conflicting shared config values in ${folderPath}`);
    }
  }
  if (state.hasLegacyLocalConfig && state.hasLocalConfig) {
    const legacyLocalConfig = readObjectFile(paths.legacyLocalConfigPath, "legacy agent local config");
    validateLocalAgentConfig(legacyLocalConfig, paths.legacyLocalConfigPath);
    if (!jsonEquals(localConfig, legacyLocalConfig)) {
      throw new Error(`Conflicting local config values in ${folderPath}`);
    }
  }

  const stagedRenames = [];
  try {
    if (state.hasLegacySharedConfig) {
      const stagedSharedPath = join(paths.folderPath, `${AGENT_CONFIG_DIRNAME}.legacy-flat-backup`);
      renameSync(paths.legacyConfigPath, stagedSharedPath);
      stagedRenames.push({ stagedPath: stagedSharedPath, originalPath: paths.legacyConfigPath });
    }
    if (state.hasLegacyLocalConfig) {
      const stagedLocalPath = join(paths.folderPath, `${LEGACY_AGENT_LOCAL_CONFIG_FILENAME}.legacy-flat-backup`);
      renameSync(paths.legacyLocalConfigPath, stagedLocalPath);
      stagedRenames.push({ stagedPath: stagedLocalPath, originalPath: paths.legacyLocalConfigPath });
    }

    mkdirSync(paths.configDirPath, { recursive: true });
    mkdirSync(paths.sitePath, { recursive: true });

    if (sharedConfig) {
      writeJsonFile(paths.configPath, sharedConfig);
    }
    if (localConfig) {
      writeJsonFile(paths.localConfigPath, localConfig);
    } else if (existsSync(paths.localConfigPath)) {
      rmSync(paths.localConfigPath, { force: true });
    }

    for (const entry of stagedRenames) {
      rmSync(entry.stagedPath, { force: true });
    }

    return {
      folderPath: paths.folderPath,
      migratedSharedConfig: state.hasLegacySharedConfig,
      migratedLocalConfig: state.hasLegacyLocalConfig,
      wroteSharedConfig: Boolean(sharedConfig),
      wroteLocalConfig: Boolean(localConfig),
      createdSiteDir: true,
    };
  } catch (err) {
    for (const entry of stagedRenames.reverse()) {
      if (existsSync(entry.stagedPath) && !existsSync(entry.originalPath)) {
        renameSync(entry.stagedPath, entry.originalPath);
      }
    }
    throw err;
  }
}

export function runAgentConfigMigration({ homePath = homedir() } = {}) {
  const folders = discoverAgentFoldersForMigration({ homePath });
  const results = [];
  for (const folderPath of folders) {
    const state = describeAgentConfigState(folderPath);
    if (!shouldMigrateAgentFolderState(state)) continue;
    results.push(migrateAgentFolder(folderPath));
  }

  return {
    hostConfigDirs: discoverHostConfigDirs({ homePath }),
    discoveredFolders: folders,
    migratedFolders: results,
  };
}
