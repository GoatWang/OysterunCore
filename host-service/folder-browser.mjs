import { spawn } from "child_process";
import { mkdir, realpath } from "fs/promises";
import { dirname, join } from "path";
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
const TCC_PROTECTED_FOLDER_NAMES = new Set(["Desktop", "Documents", "Downloads"]);

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
  const error = new Error("Folder access denied — grant permission in System Settings");
  error.status = 403;
  error.code = "folder_access_denied";
  error.path = path || "";
  error.platform = process.platform;
  error.reason = reason;
  error.settings_uri = MACOS_FULL_DISK_ACCESS_SETTINGS_URI;
  error.suggested_permission = "full_disk_access";
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

function isLikelyMacTccProtectedPath(path) {
  if (process.platform !== "darwin" || typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return false;
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length < 3) return false;
  return parts[0] === "Users" && TCC_PROTECTED_FOLDER_NAMES.has(parts[2]);
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
          if (isLikelyMacTccProtectedPath(targetPath)) {
            rejectPromise(buildFolderAccessDeniedError(targetPath, "timeout"));
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
