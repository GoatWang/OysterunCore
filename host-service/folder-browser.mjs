import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { resolveDefaultBrowsePathAsync, resolveDirectoryPathAsync } from "./config.mjs";
import { completeSchedulerSessionSetupPayloadForRuntime } from "./scheduler-setup-snapshot-contract.mjs";
import { FULL_DISK_ACCESS_SETTINGS_URI as MACOS_FULL_DISK_ACCESS_SETTINGS_URI } from "./macos-permissions.mjs";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
export const FOLDER_BROWSE_TIMEOUT_MS = Math.max(
  1,
  Number.parseInt(process.env.OYSTERUN_FOLDER_BROWSE_TIMEOUT_MS || "5000", 10) || 5000
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKER_PATH = join(__dirname, "folder-browser-worker.mjs");
const DEMO_AGENT_ID = "oysterun-github-tracker";
const DEMO_AGENT_BASE_FOLDER_NAME = "oysterun-github-tracker";
const DEMO_AGENT_TEMPLATE_ROOT = join(__dirname, "templates", "demo-agents");
const DEMO_AGENT_PATH_PLACEHOLDER = "__OYSTERUN_DEMO_AGENT_FOLDER__";
const NODE_FOLDER_ACCESS_PERMISSION = "node_folder_access";

function normalizeOffset(rawOffset) {
  const value = Number.parseInt(String(rawOffset ?? "0"), 10);
  if (Number.isNaN(value) || value < 0) return 0;
  return value;
}

function normalizeLimit(rawLimit) {
  const value = Number.parseInt(String(rawLimit ?? DEFAULT_LIMIT), 10);
  if (Number.isNaN(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function normalizeQuery(rawQuery) {
  return typeof rawQuery === "string" ? rawQuery.trim() : "";
}

function buildFolderAccessDeniedError(path, reason = "timeout") {
  const error = new Error("Folder access denied — allow Node.js to access this folder, then retry");
  error.status = 403;
  error.code = "folder_access_denied";
  error.path = path || "";
  error.platform = process.platform;
  error.reason = reason;
  error.settings_uri = MACOS_FULL_DISK_ACCESS_SETTINGS_URI;
  error.suggested_permission = NODE_FOLDER_ACCESS_PERMISSION;
  return error;
}

function buildFolderBrowseTimeoutError(path) {
  const error = new Error("Folder read timed out — macOS may be waiting for folder access permission");
  error.status = 504;
  error.code = "folder_browse_timeout";
  error.path = path || "";
  error.platform = process.platform;
  error.reason = "timeout";
  error.settings_uri = MACOS_FULL_DISK_ACCESS_SETTINGS_URI;
  error.suggested_permission = NODE_FOLDER_ACCESS_PERMISSION;
  return error;
}

function buildWorkerFailureError(message) {
  const error = new Error(message || "Folder browse worker failed");
  error.status = 500;
  error.code = "folder_browse_worker_failed";
  return error;
}

function buildFolderMutationError(message, status = 400, code = "invalid_folder_mutation") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function buildFolderValidationError(message, status = 400, code = "invalid_folder_path") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isObjectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function nowIso() {
  return new Date().toISOString();
}

function taipeiDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function computeNextTaipeiDailyRunAt(time = "11:30", now = new Date()) {
  const match = String(time || "11:30").match(/^(\d{1,2}):(\d{2})$/);
  const hour = match ? Number(match[1]) : 11;
  const minute = match ? Number(match[2]) : 30;
  const parts = taipeiDateParts(now);
  let targetUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour - 8,
    minute,
    0,
    0
  );
  if (targetUtc <= now.getTime()) targetUtc += 24 * 60 * 60 * 1000;
  return new Date(targetUtc).toISOString();
}

function replaceDemoAgentPathValues(value, copiedPath) {
  if (Array.isArray(value)) {
    return value.map((entry) => replaceDemoAgentPathValues(entry, copiedPath));
  }
  if (isObjectRecord(value)) {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = replaceDemoAgentPathValues(entry, copiedPath);
    }
    return next;
  }
  if (typeof value === "string" && value === DEMO_AGENT_PATH_PLACEHOLDER) {
    return copiedPath;
  }
  return value;
}

async function normalizeCopiedDemoAgentSchedulers(copiedPath) {
  const schedulersPath = join(copiedPath, ".oysterun", "schedulers.json");
  const raw = await readFile(schedulersPath, "utf8");
  const payload = JSON.parse(raw);
  if (!isObjectRecord(payload) || !Array.isArray(payload.schedulers)) {
    throw buildFolderMutationError(
      "Demo agent scheduler file is invalid",
      500,
      "demo_agent_scheduler_invalid"
    );
  }
  const timestamp = nowIso();
  const normalizedSchedulers = payload.schedulers.map((entry) => {
    const schedule = replaceDemoAgentPathValues(entry, copiedPath);
    const time =
      schedule?.schedule_rule?.timezone === "Asia/Taipei"
        ? schedule.schedule_rule.time
        : "11:30";
    const id = randomUUID();
    schedule.id = id;
    schedule.agent_id = schedule.agent_id || DEMO_AGENT_ID;
    schedule.created_by = "oysterun-demo-agent-copy";
    schedule.enabled = true;
    schedule.status = "active";
    schedule.next_run_at = computeNextTaipeiDailyRunAt(time);
    schedule.created_at = timestamp;
    schedule.updated_at = timestamp;
    if (isObjectRecord(schedule.setup_snapshot)) {
      schedule.setup_snapshot.agent_folder = copiedPath;
      schedule.setup_snapshot.cwd = copiedPath;
    }
    if (isObjectRecord(schedule.metadata?.target_binding?.setup_snapshot)) {
      schedule.metadata.target_binding.setup_snapshot.agent_folder = copiedPath;
      schedule.metadata.target_binding.setup_snapshot.cwd = copiedPath;
    }
    const completedSetup = completeSchedulerSessionSetupPayloadForRuntime({
      agentFolder: copiedPath,
      sessionPayload: schedule.setup_snapshot,
      label: `demo agent scheduler ${id}`,
      requireExplicitRuntimeProof: true,
    }).sessionPayload;
    schedule.setup_snapshot = completedSetup;
    if (isObjectRecord(schedule.metadata?.target_binding)) {
      schedule.metadata.target_binding.kind = "setup_snapshot";
      schedule.metadata.target_binding.agent_id = schedule.agent_id;
      schedule.metadata.target_binding.setup_snapshot = completedSetup;
    }
    return schedule;
  });
  await writeFile(
    schedulersPath,
    `${JSON.stringify({ version: 1, schedulers: normalizedSchedulers }, null, 2)}\n`
  );
  return {
    scheduler_count: normalizedSchedulers.length,
    scheduler_ids: normalizedSchedulers.map((entry) => entry.id),
  };
}

function isFolderPermissionErrorCode(code) {
  return code === "EACCES" || code === "EPERM";
}

function getFolderBrowseWorkerPath() {
  const override = typeof process.env.OYSTERUN_FOLDER_BROWSER_WORKER === "string"
    ? process.env.OYSTERUN_FOLDER_BROWSER_WORKER.trim()
    : "";
  return override || DEFAULT_WORKER_PATH;
}

function normalizeFolderName(rawFolderName) {
  const folderName = typeof rawFolderName === "string" ? rawFolderName.trim() : "";
  if (!folderName) {
    throw buildFolderMutationError("Folder name required");
  }
  if (folderName === "." || folderName === "..") {
    throw buildFolderMutationError("Folder name must not be . or ..");
  }
  if (folderName.includes("/") || folderName.includes("\\") || folderName.includes("\0")) {
    throw buildFolderMutationError("Folder name must be a single path segment");
  }
  return folderName;
}

async function resolveBrowseParentPath(parentPath) {
  if (typeof parentPath === "string" && parentPath.trim()) {
    return resolveDirectoryPathAsync(parentPath, "Parent folder");
  }
  return resolveDefaultBrowsePathAsync();
}

function normalizeAbsoluteFolderPath(rawPath) {
  const requestedPath = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!requestedPath) {
    throw buildFolderValidationError("Open Path requires an absolute local path");
  }
  if (!isAbsolute(requestedPath)) {
    throw buildFolderValidationError(
      "Open Path requires an absolute local path",
      400,
      "folder_path_must_be_absolute"
    );
  }
  return requestedPath;
}

function parseWorkerOutput(rawOutput) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (err) {
    throw buildWorkerFailureError(`Folder browse worker returned invalid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw buildWorkerFailureError("Folder browse worker returned an invalid payload");
  }
  return parsed;
}

function runFolderBrowseWorker(payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    const workerPath = getFolderBrowseWorkerPath();
    const child = spawn(process.execPath, [workerPath], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, FOLDER_BROWSE_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
    };

    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      settle(() => rejectPromise(buildWorkerFailureError(`Could not start folder browse worker: ${err.message}`)));
    });

    child.on("close", () => {
      settle(() => {
        if (timedOut) {
          const targetPath = payload.path || "";
          if (process.platform === "darwin") {
            rejectPromise(buildFolderBrowseTimeoutError(targetPath));
            return;
          }
          rejectPromise(buildWorkerFailureError(`Folder read timed out after ${FOLDER_BROWSE_TIMEOUT_MS}ms`));
          return;
        }

        const trimmedStdout = stdout.trim();
        if (!trimmedStdout) {
          const trimmedStderr = stderr.trim();
          rejectPromise(buildWorkerFailureError(trimmedStderr || "Folder browse worker returned no output"));
          return;
        }

        try {
          const parsed = parseWorkerOutput(trimmedStdout);
          if (parsed.ok === true) {
            resolvePromise(parsed.result);
            return;
          }
          if (
            process.platform === "darwin" &&
            isFolderPermissionErrorCode(parsed?.error?.code)
          ) {
            rejectPromise(
              buildFolderAccessDeniedError(
                payload.path || "",
                String(parsed.error.code).toLowerCase()
              )
            );
            return;
          }
          const workerError = new Error(parsed?.error?.message || "Folder browse worker failed");
          if (parsed?.error?.code) workerError.code = parsed.error.code;
          rejectPromise(workerError);
        } catch (err) {
          rejectPromise(err);
        }
      });
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

export async function listFolderPage({
  path,
  offset,
  limit,
  q,
} = {}) {
  return runFolderBrowseWorker({
    path: typeof path === "string" ? path : "",
    offset: normalizeOffset(offset),
    limit: normalizeLimit(limit),
    q: normalizeQuery(q),
  });
}

export async function validateFolderPath({
  path,
} = {}) {
  const requestedPath = normalizeAbsoluteFolderPath(path);
  const resolvedPath = await resolveDirectoryPathAsync(requestedPath, "Open Path");
  const page = await listFolderPage({
    path: resolvedPath,
    offset: 0,
    limit: 1,
    q: "",
  });
  return {
    status: "valid_directory",
    requested_path: requestedPath,
    path: page.path,
    readable: true,
    listable: true,
    returned_count_sample: page.returned_count,
    matched_count: page.matched_count,
    scan_truncated: page.scan_truncated === true,
    warning: page.warning || null,
  };
}

async function assertDemoTemplateDirectory(templatePath) {
  let templateStat;
  try {
    templateStat = await stat(templatePath);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw buildFolderMutationError(
        "Demo agent template is unavailable",
        500,
        "demo_agent_template_missing"
      );
    }
    throw err;
  }
  if (!templateStat.isDirectory()) {
    throw buildFolderMutationError(
      "Demo agent template is unavailable",
      500,
      "demo_agent_template_invalid"
    );
  }
}

async function findAvailableDemoFolderName(parentPath) {
  for (let index = 0; index < 1000; index++) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const folderName = `${DEMO_AGENT_BASE_FOLDER_NAME}${suffix}`;
    try {
      await stat(join(parentPath, folderName));
    } catch (err) {
      if (err?.code === "ENOENT") return folderName;
      throw err;
    }
  }
  throw buildFolderMutationError(
    "Could not choose a non-conflicting demo agent folder name",
    409,
    "demo_agent_name_exhausted"
  );
}

export async function createFolder({
  parentPath,
  folderName,
} = {}) {
  const resolvedParentPath = await resolveBrowseParentPath(parentPath);
  const normalizedFolderName = normalizeFolderName(folderName);
  const requestedPath = join(resolvedParentPath, normalizedFolderName);

  try {
    await mkdir(requestedPath, { recursive: false });
  } catch (err) {
    if (err?.code === "EEXIST") {
      throw buildFolderMutationError(`Folder already exists: ${normalizedFolderName}`, 409, "folder_already_exists");
    }
    if (err?.code === "EACCES" || err?.code === "EPERM") {
      throw buildFolderMutationError(`Permission denied while creating folder: ${requestedPath}`, 403, "folder_create_denied");
    }
    throw err;
  }

  return {
    created_path: await realpath(requestedPath),
    parent_path: resolvedParentPath,
    folder_name: normalizedFolderName,
  };
}

export async function copyDemoAgent({
  parentPath,
  demoId,
} = {}) {
  const normalizedDemoId = typeof demoId === "string" && demoId.trim()
    ? demoId.trim()
    : DEMO_AGENT_ID;
  if (normalizedDemoId !== DEMO_AGENT_ID) {
    throw buildFolderMutationError("Unknown demo agent template", 404, "demo_agent_not_found");
  }
  const resolvedParentPath = await resolveBrowseParentPath(parentPath);
  const templatePath = join(DEMO_AGENT_TEMPLATE_ROOT, normalizedDemoId);
  await assertDemoTemplateDirectory(templatePath);

  const folderName = await findAvailableDemoFolderName(resolvedParentPath);
  const targetPath = join(resolvedParentPath, folderName);
  const tempPath = join(
    resolvedParentPath,
    `.oysterun-demo-copy-${normalizedDemoId}-${process.pid}-${Date.now()}`
  );
  let copiedPath = "";
  let schedulerRegistration = {
    scheduler_count: 0,
    scheduler_ids: [],
  };

  try {
    await cp(templatePath, tempPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await rename(tempPath, targetPath);
    copiedPath = await realpath(targetPath);
    schedulerRegistration = await normalizeCopiedDemoAgentSchedulers(copiedPath);
  } catch (err) {
    await rm(tempPath, { recursive: true, force: true });
    if (copiedPath) {
      await rm(copiedPath, { recursive: true, force: true });
    }
    if (err?.code === "EEXIST") {
      throw buildFolderMutationError(
        `Folder already exists: ${folderName}`,
        409,
        "folder_already_exists"
      );
    }
    if (err?.code === "EACCES" || err?.code === "EPERM") {
      throw buildFolderMutationError(
        `Permission denied while copying demo agent into: ${resolvedParentPath}`,
        403,
        "demo_agent_copy_denied"
      );
    }
    throw err;
  }

  return {
    status: "demo_agent_copied",
    demo_id: normalizedDemoId,
    parent_path: resolvedParentPath,
    folder_name: folderName,
    copied_path: copiedPath,
    portable_scheduler_count: schedulerRegistration.scheduler_count,
    portable_scheduler_ids: schedulerRegistration.scheduler_ids,
    start_session_available: true,
  };
}
