import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  watch,
} from "fs";
import { basename, join, relative, resolve } from "path";
import { resolveDefaultBrowsePath } from "./config.mjs";

export const BROWSER_ROOT_PROJECT_INDEX_SCHEMA =
  "oysterun.browser_root_project_index.v1";
export const BROWSER_ROOT_PROJECT_WATCH_DEBOUNCE_MS = 1000;
export const BROWSER_ROOT_PROJECT_RECONCILE_MS = 60_000;

export function removeObsoleteAgentRegistry(configDir, removeFn = rmSync) {
  const obsoletePath = join(configDir, "agent-registry.json");
  const existed = existsSync(obsoletePath);
  removeFn(obsoletePath, { force: true });
  return { path: obsoletePath, removed: existed };
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isObjectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPathInsideRoot(candidate, root) {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.startsWith("/"))
  );
}

function readJsonObject(filePath, label) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isObjectRecord(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed;
}

function inspectJsonMarker(filePath, label, validate = null) {
  if (!existsSync(filePath)) {
    return { present: false, valid: null, error: null };
  }
  try {
    const value = readJsonObject(filePath, label);
    if (validate) validate(value);
    return { present: true, valid: true, error: null };
  } catch (err) {
    return {
      present: true,
      valid: false,
      error: err.message || String(err),
    };
  }
}

function isPhysicalDirectory(path) {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  return Boolean(stats?.isDirectory() && !stats.isSymbolicLink());
}

export function deriveBrowserRootProjectId(folderName) {
  const normalized = String(folderName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "agent";
}

function inspectProject(realRoot, childPath, displayName) {
  const realFolder = realpathSync(childPath);
  if (!isPathInsideRoot(realFolder, realRoot)) {
    return {
      ignored: true,
      diagnostic: {
        code: "project_symlink_escape",
        path: childPath,
        message: "Project real path escapes Default Browse Root",
      },
    };
  }

  const oysterunDir = join(realFolder, ".oysterun");
  const oysterunStats = lstatSync(oysterunDir, { throwIfNoEntry: false });
  if (!oysterunStats) return { ignored: true };
  if (oysterunStats.isSymbolicLink()) {
    return {
      ignored: true,
      diagnostic: {
        code: "project_marker_symlink_ignored",
        path: oysterunDir,
        message: "Browser Root project .oysterun markers must be physical directories",
      },
    };
  }
  if (!oysterunStats.isDirectory()) return { ignored: true };

  const config = inspectJsonMarker(
    join(oysterunDir, "config.json"),
    "agent config"
  );
  if (config.valid === true) {
    const sharedConfig = readJsonObject(
      join(oysterunDir, "config.json"),
      "agent config"
    );
    config.web_configured = Object.prototype.hasOwnProperty.call(
      sharedConfig,
      "web"
    );
  } else {
    config.web_configured = false;
  }
  const schedulers = inspectJsonMarker(
    join(oysterunDir, "schedulers.json"),
    "portable schedulers",
    (value) => {
      if (value.version !== 1) {
        throw new Error(`portable schedulers has unsupported version ${value.version}`);
      }
      if (!Array.isArray(value.schedulers)) {
        throw new Error("portable schedulers schedulers must be an array");
      }
    }
  );
  const loops = inspectJsonMarker(
    join(oysterunDir, "loops.json"),
    "session loops"
  );
  const diagnostics = [];
  for (const [feature, marker] of Object.entries({ config, schedulers, loops })) {
    if (marker.valid === false) {
      diagnostics.push({
        code: `${feature}_invalid`,
        feature,
        path: join(oysterunDir, `${feature}.json`),
        message: marker.error,
      });
    }
  }

  return {
    ignored: false,
    project: {
      project_id: deriveBrowserRootProjectId(displayName),
      agent_id: deriveBrowserRootProjectId(displayName),
      display_name: displayName,
      agent_folder: realFolder,
      oysterun_dir: oysterunDir,
      source: "browser_root",
      status: diagnostics.length > 0 ? "invalid" : "ready",
      conflict: false,
      diagnostics,
      markers: {
        config,
        local: { present: existsSync(join(oysterunDir, "local.json")) },
        schedulers,
        loops,
        site: {
          present: isPhysicalDirectory(join(oysterunDir, "site")),
          index_present: existsSync(join(oysterunDir, "site", "index.html")),
        },
        provider_skills: {
          claude: isPhysicalDirectory(join(realFolder, ".claude", "skills")),
          codex: isPhysicalDirectory(join(realFolder, ".codex", "skills")),
        },
      },
    },
  };
}

export function scanBrowserRootProjects(rootPath) {
  const requestedRoot = resolve(normalizeString(rootPath) || "");
  const rootStats = lstatSync(requestedRoot, { throwIfNoEntry: false });
  if (!rootStats?.isDirectory()) {
    throw new Error(`Default Browse Root is not a directory: ${requestedRoot}`);
  }
  const realRoot = realpathSync(requestedRoot);
  const projects = [];
  const diagnostics = [];
  const entries = readdirSync(realRoot, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of entries) {
    const childPath = join(realRoot, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        code: "project_symlink_ignored",
        path: childPath,
        message: "Browser Root project entries must be physical directories",
      });
      continue;
    }
    if (!entry.isDirectory()) continue;
    try {
      const inspected = inspectProject(realRoot, childPath, entry.name);
      if (inspected.diagnostic) diagnostics.push(inspected.diagnostic);
      if (!inspected.ignored) projects.push(inspected.project);
    } catch (err) {
      diagnostics.push({
        code: "project_scan_failed",
        path: childPath,
        message: err.message || String(err),
      });
    }
  }

  const projectsById = new Map();
  for (const project of projects) {
    const grouped = projectsById.get(project.project_id) || [];
    grouped.push(project);
    projectsById.set(project.project_id, grouped);
  }
  for (const [projectId, grouped] of projectsById.entries()) {
    if (grouped.length < 2) continue;
    const folders = grouped.map((project) => project.agent_folder);
    diagnostics.push({
      code: "project_id_collision",
      project_id: projectId,
      folders,
      message: `Multiple Browser Root folders normalize to project id ${projectId}`,
    });
    for (const project of grouped) {
      project.status = "conflict";
      project.conflict = true;
      project.diagnostics.push({
        code: "project_id_collision",
        project_id: projectId,
        folders,
        message: "Rename one folder to create a unique project id",
      });
    }
  }

  return {
    schema: BROWSER_ROOT_PROJECT_INDEX_SCHEMA,
    root: realRoot,
    generated_at: new Date().toISOString(),
    projects,
    diagnostics,
  };
}

export class BrowserRootProjectIndex {
  constructor({
    resolveRoot = resolveDefaultBrowsePath,
    scan = scanBrowserRootProjects,
    watchFn = watch,
    debounceMs = BROWSER_ROOT_PROJECT_WATCH_DEBOUNCE_MS,
    reconcileMs = BROWSER_ROOT_PROJECT_RECONCILE_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    logger = console,
  } = {}) {
    this.resolveRoot = resolveRoot;
    this.scan = scan;
    this.watchFn = watchFn;
    this.debounceMs = debounceMs;
    this.reconcileMs = reconcileMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.logger = logger;
    this.snapshot = {
      schema: BROWSER_ROOT_PROJECT_INDEX_SCHEMA,
      root: null,
      generated_at: null,
      projects: [],
      diagnostics: [],
    };
    this.running = false;
    this.refreshing = false;
    this.refreshQueued = false;
    this.debounceTimer = null;
    this.reconcileTimer = null;
    this.watchers = [];
    this.refreshListeners = new Set();
    this.reportedCollisionSignatures = new Set();
    this.generation = 0;
    this.lastReason = null;
  }

  start() {
    if (this.running) return this.getSnapshot();
    this.running = true;
    this.refresh({ reason: "startup", rebuildWatchers: true });
    this.reconcileTimer = this.setIntervalFn(
      () => this.requestRefresh("fallback_reconciliation"),
      this.reconcileMs
    );
    this.reconcileTimer?.unref?.();
    return this.getSnapshot();
  }

  stop() {
    this.running = false;
    if (this.debounceTimer) {
      this.clearTimeoutFn(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.reconcileTimer) {
      this.clearIntervalFn(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.closeWatchers();
  }

  closeWatchers() {
    for (const watcher of this.watchers.splice(0)) {
      try {
        watcher.close();
      } catch {
        // Closing an already-closed fs watcher is harmless.
      }
    }
  }

  requestRefresh(reason = "watcher") {
    if (!this.running) return;
    this.lastReason = reason;
    if (this.debounceTimer) this.clearTimeoutFn(this.debounceTimer);
    this.debounceTimer = this.setTimeoutFn(() => {
      this.debounceTimer = null;
      this.refresh({ reason, rebuildWatchers: true });
    }, this.debounceMs);
    this.debounceTimer?.unref?.();
  }

  subscribeToRefresh(listener) {
    if (typeof listener !== "function") {
      throw new Error("Browser Root refresh listener must be a function");
    }
    this.refreshListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.refreshListeners.delete(listener);
    };
  }

  notifyRefreshListeners() {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.refreshListeners]) {
      try {
        listener(snapshot);
      } catch (err) {
        this.logger.error?.(
          "[browser-root-project-index] refresh listener failed",
          err
        );
      }
    }
  }

  refresh({ reason = "explicit_refresh", rebuildWatchers = true } = {}) {
    if (this.refreshing) {
      this.refreshQueued = true;
      return this.getSnapshot();
    }
    this.refreshing = true;
    try {
      const root = this.resolveRoot();
      const scanned = this.scan(root);
      this.reportRegistrationIssues(scanned);
      this.generation += 1;
      this.lastReason = reason;
      this.snapshot = {
        ...scanned,
        generation: this.generation,
        refresh_reason: reason,
      };
      if (this.running && rebuildWatchers) this.rebuildWatchers();
    } catch (err) {
      this.logger.error?.("[browser-root-project-index] refresh failed", err);
      this.generation += 1;
      this.snapshot = {
        schema: BROWSER_ROOT_PROJECT_INDEX_SCHEMA,
        root: null,
        generated_at: new Date().toISOString(),
        refresh_reason: reason,
        generation: this.generation,
        projects: [],
        diagnostics: [
          {
            code: "browser_root_refresh_failed",
            message: err.message || String(err),
          },
        ],
      };
      if (this.running) this.closeWatchers();
    } finally {
      this.notifyRefreshListeners();
      this.refreshing = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        this.requestRefresh("queued_refresh");
      }
    }
    return this.getSnapshot();
  }

  reportRegistrationIssues(snapshot) {
    const currentSignatures = new Set();
    for (const diagnostic of snapshot?.diagnostics || []) {
      if (diagnostic?.code !== "project_id_collision") continue;
      const folders = Array.isArray(diagnostic.folders)
        ? [...diagnostic.folders].sort()
        : [];
      const signature = JSON.stringify([diagnostic.project_id, folders]);
      currentSignatures.add(signature);
      if (this.reportedCollisionSignatures.has(signature)) continue;
      this.logger.warn?.(
        `[browser-root-project-index] project registration conflict: ${diagnostic.project_id}; folders=${folders.join(", ")}`
      );
    }
    this.reportedCollisionSignatures = currentSignatures;
  }

  rebuildWatchers() {
    this.closeWatchers();
    const watchPaths = [
      this.snapshot.root,
      ...this.snapshot.projects.map((project) => project.oysterun_dir),
    ].filter(Boolean);
    for (const path of watchPaths) {
      try {
        const watcher = this.watchFn(path, () => this.requestRefresh("watcher"));
        watcher.on?.("error", (err) => {
          this.logger.warn?.(
            `[browser-root-project-index] watcher failed for ${path}: ${err.message}`
          );
          this.requestRefresh("watcher_error");
        });
        this.watchers.push(watcher);
      } catch (err) {
        this.logger.warn?.(
          `[browser-root-project-index] cannot watch ${path}: ${err.message}`
        );
      }
    }
  }

  getSnapshot() {
    return cloneJson(this.snapshot);
  }

  listProjects({ includeConflicts = true } = {}) {
    const projects = this.snapshot.projects || [];
    return cloneJson(
      includeConflicts
        ? projects
        : projects.filter((project) => project.conflict !== true)
    );
  }

  resolveProject(projectId, { allowInvalid = true } = {}) {
    const normalizedId = normalizeString(projectId);
    if (!normalizedId) throw new Error("project_id required");
    const matches = (this.snapshot.projects || []).filter(
      (project) => project.project_id === normalizedId
    );
    if (matches.length === 0) {
      const err = new Error(`Unknown Browser Root project: ${normalizedId}`);
      err.code = "browser_root_project_not_found";
      throw err;
    }
    if (matches.length > 1 || matches[0].conflict === true) {
      const err = new Error(`Browser Root project id is ambiguous: ${normalizedId}`);
      err.code = "browser_root_project_id_collision";
      throw err;
    }
    if (!allowInvalid && matches[0].status !== "ready") {
      const err = new Error(`Browser Root project is invalid: ${normalizedId}`);
      err.code = "browser_root_project_invalid";
      throw err;
    }
    return cloneJson(matches[0]);
  }

  resolveProjectFolder(projectId, options = {}) {
    return this.resolveProject(projectId, options).agent_folder;
  }

  getLifecycleState() {
    return {
      running: this.running,
      generation: this.generation,
      root: this.snapshot.root,
      project_count: this.snapshot.projects.length,
      watcher_count: this.watchers.length,
      refresh_listener_count: this.refreshListeners.size,
      debounce_pending: Boolean(this.debounceTimer),
      reconcile_timer_active: Boolean(this.reconcileTimer),
      reconcile_interval_ms: this.reconcileMs,
      debounce_ms: this.debounceMs,
      refresh_in_flight: this.refreshing,
      last_refresh_reason: this.lastReason,
    };
  }
}
