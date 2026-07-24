import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { lstat, realpath, rename, rm, stat } from "fs/promises";
import { join, relative } from "path";
import { resolveDefaultBrowsePathAsync } from "./config.mjs";
import { deriveBrowserRootProjectId } from "./browser-root-project-index.mjs";

export const AGENT_STORE_DEMO_CLONE_TIMEOUT_MS = Math.max(
  1,
  Number.parseInt(
    process.env.OYSTERUN_AGENT_STORE_DEMO_CLONE_TIMEOUT_MS || "120000",
    10
  ) || 120000
);

const MAX_GIT_OUTPUT_BYTES = 64 * 1024;
const GIT_KILL_GRACE_MS = 1500;
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+$/;

function createAgentStoreError(message, status, code, detail = "") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function appendBoundedOutput(current, chunk) {
  if (current.length >= MAX_GIT_OUTPUT_BYTES) return current;
  return `${current}${String(chunk)}`.slice(0, MAX_GIT_OUTPUT_BYTES);
}

function summarizeGitError(stderr, stdout) {
  const value = normalizeString(stderr) || normalizeString(stdout);
  return value.slice(0, 2000);
}

async function pathExists(path) {
  return Boolean(await lstat(path).catch(() => null));
}

function assertDirectChild(candidate, root) {
  const relativePath = relative(root, candidate);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    relativePath.startsWith("/") ||
    relativePath.includes("/") ||
    relativePath.includes("\\")
  ) {
    throw createAgentStoreError(
      "Agent Store destination must be a direct child of Default Browse Root",
      400,
      "agent_store_destination_invalid"
    );
  }
}

export function parsePublicGitHubRepositoryUrl(rawValue) {
  const raw = normalizeString(rawValue);
  if (!raw) {
    throw createAgentStoreError(
      "GitHub Repository URL is required",
      400,
      "invalid_github_repository_url"
    );
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createAgentStoreError(
      "Enter a valid public GitHub HTTPS repository URL",
      400,
      "invalid_github_repository_url"
    );
  }

  if (!/^https:\/\/github\.com\//i.test(raw)) {
    throw createAgentStoreError(
      "Only public https://github.com/<owner>/<repo> URLs are supported",
      400,
      "invalid_github_repository_url"
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash
  ) {
    throw createAgentStoreError(
      "Only public https://github.com/<owner>/<repo> URLs are supported",
      400,
      "invalid_github_repository_url"
    );
  }

  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (!match) {
    throw createAgentStoreError(
      "GitHub URL must contain exactly one owner and repository",
      400,
      "invalid_github_repository_url"
    );
  }

  let owner;
  let repositorySegment;
  try {
    owner = decodeURIComponent(match[1]);
    repositorySegment = decodeURIComponent(match[2]);
  } catch {
    throw createAgentStoreError(
      "GitHub URL contains invalid path encoding",
      400,
      "invalid_github_repository_url"
    );
  }
  const repositoryName = repositorySegment.endsWith(".git")
    ? repositorySegment.slice(0, -4)
    : repositorySegment;

  if (
    !GITHUB_OWNER_PATTERN.test(owner) ||
    !GITHUB_REPOSITORY_PATTERN.test(repositoryName) ||
    repositoryName === "." ||
    repositoryName === ".."
  ) {
    throw createAgentStoreError(
      "GitHub owner or repository name is invalid",
      400,
      "invalid_github_repository_url"
    );
  }

  return {
    owner,
    repositoryName,
    repositoryUrl: `https://github.com/${owner}/${repositoryName}`,
    cloneUrl: `https://github.com/${owner}/${repositoryName}.git`,
    agentId: deriveBrowserRootProjectId(repositoryName),
  };
}

function terminateGitProcess(child, signal) {
  if (!child) return;
  if (process.platform !== "win32" && Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to the direct child when the process group is unavailable.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process may already have exited.
  }
}

export function runGitShallowClone({
  cloneUrl,
  destinationPath,
  timeoutMs = AGENT_STORE_DEMO_CLONE_TIMEOUT_MS,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawnImpl(
        "git",
        ["clone", "--depth", "1", "--", cloneUrl, destinationPath],
        {
          detached: process.platform !== "win32",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (err) {
      rejectPromise(
        createAgentStoreError(
          err?.code === "ENOENT"
            ? "Git is not available on this Host"
            : "Could not start Git clone",
          err?.code === "ENOENT" ? 503 : 502,
          err?.code === "ENOENT" ? "git_unavailable" : "agent_store_clone_failed"
        )
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceKillTimer = null;

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateGitProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        terminateGitProcess(child, "SIGKILL");
      }, GIT_KILL_GRACE_MS);
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };

    child.stdout?.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk);
    });
    child.once("error", (err) => {
      rejectOnce(
        createAgentStoreError(
          err?.code === "ENOENT"
            ? "Git is not available on this Host"
            : "Could not start Git clone",
          err?.code === "ENOENT" ? 503 : 502,
          err?.code === "ENOENT" ? "git_unavailable" : "agent_store_clone_failed"
        )
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timedOut) {
        rejectPromise(
          createAgentStoreError(
            "GitHub clone timed out",
            504,
            "agent_store_clone_timeout"
          )
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          createAgentStoreError(
            "Could not clone the GitHub repository",
            502,
            "agent_store_clone_failed",
            summarizeGitError(stderr, stdout) ||
              `git exited with code ${code ?? "unknown"}${
                signal ? ` (${signal})` : ""
              }`
          )
        );
        return;
      }
      resolvePromise({ stdout, stderr, exitCode: code });
    });
  });
}

export async function clonePublicGitHubAgent({
  repositoryUrl,
  browseRoot = null,
  timeoutMs = AGENT_STORE_DEMO_CLONE_TIMEOUT_MS,
  runClone = runGitShallowClone,
  requestId = randomUUID(),
} = {}) {
  const repository = parsePublicGitHubRepositoryUrl(repositoryUrl);
  const requestedRoot = browseRoot || (await resolveDefaultBrowsePathAsync());
  const rootPath = await realpath(requestedRoot);
  const rootStats = await stat(rootPath);
  if (!rootStats.isDirectory()) {
    throw createAgentStoreError(
      "Default Browse Root is not a directory",
      400,
      "agent_store_browse_root_invalid"
    );
  }

  const finalPath = join(rootPath, repository.repositoryName);
  assertDirectChild(finalPath, rootPath);
  if (await pathExists(finalPath)) {
    throw createAgentStoreError(
      "Agent folder already exists",
      409,
      "agent_folder_already_exists"
    );
  }

  const stagingName = `.oysterun-agent-store-${repository.agentId}-${requestId}.partial`;
  const stagingPath = join(rootPath, stagingName);
  assertDirectChild(stagingPath, rootPath);
  if (await pathExists(stagingPath)) {
    throw createAgentStoreError(
      "Agent Store staging folder already exists",
      409,
      "agent_store_staging_conflict"
    );
  }

  let finalized = false;
  try {
    await runClone({
      cloneUrl: repository.cloneUrl,
      destinationPath: stagingPath,
      timeoutMs,
    });
    const stagingStats = await stat(stagingPath).catch(() => null);
    if (!stagingStats?.isDirectory()) {
      throw createAgentStoreError(
        "Git clone did not create an agent folder",
        502,
        "agent_store_clone_failed"
      );
    }
    if (await pathExists(finalPath)) {
      throw createAgentStoreError(
        "Agent folder already exists",
        409,
        "agent_store_clone_finalize_conflict"
      );
    }
    try {
      await rename(stagingPath, finalPath);
    } catch (err) {
      if (["EEXIST", "ENOTEMPTY"].includes(err?.code)) {
        throw createAgentStoreError(
          "Agent folder already exists",
          409,
          "agent_store_clone_finalize_conflict"
        );
      }
      throw err;
    }
    finalized = true;
    return {
      status: "agent_store_demo_clone_complete",
      repository_url: repository.repositoryUrl,
      repository_owner: repository.owner,
      repository_name: repository.repositoryName,
      agent_id: repository.agentId,
      agent_folder: await realpath(finalPath),
      clone_depth: 1,
    };
  } finally {
    if (!finalized) {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    }
  }
}
