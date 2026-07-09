import { spawn } from "child_process";
import { cp, mkdir, realpath, rename, rm, stat } from "fs/promises";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { resolveDefaultBrowsePathAsync, resolveDirectoryPathAsync } from "./config.mjs";
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

  try {
    await cp(templatePath, tempPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await rename(tempPath, targetPath);
  } catch (err) {
    await rm(tempPath, { recursive: true, force: true });
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
    copied_path: await realpath(targetPath),
    start_session_available: true,
  };
}
