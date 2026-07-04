import { realpathSync, statSync } from "fs";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "path";

function requireNonEmptyPath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("Path must be a non-empty string");
  }
  return rawPath.trim();
}

function resolveCandidatePath(rawPath, baseDir) {
  const trimmedPath = requireNonEmptyPath(rawPath);
  if (typeof baseDir !== "string" || !baseDir.trim()) {
    throw new Error("baseDir must be a non-empty string");
  }
  return isAbsolute(trimmedPath)
    ? normalize(trimmedPath)
    : resolve(baseDir, trimmedPath);
}

function validateExistingPathType(candidatePath, stats, expectedType) {
  if (!expectedType) return;
  if (expectedType === "directory" && !stats.isDirectory()) {
    throw new Error(`Expected directory path: ${candidatePath}`);
  }
  if (expectedType === "file" && !stats.isFile()) {
    throw new Error(`Expected file path: ${candidatePath}`);
  }
}

function findNearestExistingAncestor(candidatePath) {
  const suffix = [];
  let currentPath = candidatePath;

  // Missing write targets still need a real-path containment check, so walk up
  // until we find the nearest existing ancestor and rebuild the suffix.
  while (true) {
    const stats = statSync(currentPath, { throwIfNoEntry: false });
    if (stats) {
      return { ancestorPath: currentPath, ancestorStats: stats, suffix };
    }
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Path does not exist: ${candidatePath}`);
    }
    suffix.unshift(basename(currentPath));
    currentPath = parentPath;
  }
}

function dedupePaths(paths = []) {
  const normalizedPaths = [];
  const seen = new Set();
  for (const entry of paths) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const nextPath = entry.trim();
    if (seen.has(nextPath)) continue;
    seen.add(nextPath);
    normalizedPaths.push(nextPath);
  }
  return normalizedPaths;
}

export function isWorkspaceAllowedPathPolicyDisabled(workspacePolicy) {
  const policy =
    workspacePolicy?.allowedPathPolicy ?? workspacePolicy?.allowed_path_policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return false;
  }
  return policy.disabled === true;
}

export function canonicalizePath(rawPath, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const allowMissingLeaf = options.allowMissingLeaf !== false;
  const expectedType = options.expectedType || null;
  const candidatePath = resolveCandidatePath(rawPath, baseDir);
  const stats = statSync(candidatePath, { throwIfNoEntry: false });

  if (stats) {
    validateExistingPathType(candidatePath, stats, expectedType);
    return realpathSync(candidatePath);
  }

  if (!allowMissingLeaf) {
    throw new Error(`Path does not exist: ${candidatePath}`);
  }

  if (expectedType === "directory") {
    throw new Error(`Directory does not exist: ${candidatePath}`);
  }

  const { ancestorPath, ancestorStats, suffix } = findNearestExistingAncestor(candidatePath);
  if (!ancestorStats.isDirectory()) {
    throw new Error(`Path parent is not a directory: ${ancestorPath}`);
  }

  let canonicalPath = realpathSync(ancestorPath);
  for (const segment of suffix) {
    canonicalPath = join(canonicalPath, segment);
  }
  return canonicalPath;
}

export function normalizeWorkspaceRootPaths(workspacePolicy) {
  const rawRoots = Array.isArray(workspacePolicy?.allowedPaths)
    ? workspacePolicy.allowedPaths.map((entry) => entry?.path)
    : [];
  return dedupePaths(rawRoots.map((entry) => canonicalizePath(entry, {
    allowMissingLeaf: false,
    expectedType: "directory",
  })));
}

export function normalizeAssetReadablePaths(assetReadablePaths = []) {
  if (!Array.isArray(assetReadablePaths)) return [];
  return dedupePaths(assetReadablePaths.map((entry) => canonicalizePath(entry, {
    allowMissingLeaf: false,
    expectedType: "file",
  })));
}

export function buildWorkspacePolicyContext({
  workspacePolicy,
  assetReadablePaths = [],
} = {}) {
  const allowedPathPolicyDisabled =
    isWorkspaceAllowedPathPolicyDisabled(workspacePolicy);
  const writableRoots = allowedPathPolicyDisabled
    ? []
    : normalizeWorkspaceRootPaths(workspacePolicy);
  const readableFiles = normalizeAssetReadablePaths(assetReadablePaths);
  return {
    mode: workspacePolicy?.mode || null,
    root: workspacePolicy?.root || null,
    allowedPathPolicyDisabled,
    readableRoots: writableRoots,
    writableRoots,
    readableFiles,
    readablePaths: dedupePaths([...writableRoots, ...readableFiles]),
  };
}

export function isPathWithinRoots(candidatePath, roots = []) {
  return roots.some((rootPath) => (
    candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${sep}`)
  ));
}

export function isReadablePathAllowed(context, rawPath, options = {}) {
  const candidatePath = canonicalizePath(rawPath, options);
  if (Array.isArray(context?.readableFiles) && context.readableFiles.includes(candidatePath)) {
    return true;
  }
  return isPathWithinRoots(candidatePath, context?.readableRoots || []);
}

export function isWritablePathAllowed(context, rawPath, options = {}) {
  const candidatePath = canonicalizePath(rawPath, options);
  return isPathWithinRoots(candidatePath, context?.writableRoots || []);
}

export function assertWorkspacePolicyCompatibility({
  provider,
  workspacePolicy,
  sandboxMode,
}) {
  if (isWorkspaceAllowedPathPolicyDisabled(workspacePolicy)) {
    return;
  }
  const includesSystemRoot = normalizeWorkspaceRootPaths(workspacePolicy).some((rootPath) => rootPath === sep);
  if (
    provider === "codex"
    && workspacePolicy?.mode === "allowlist"
    && sandboxMode === "danger-full-access"
    && !includesSystemRoot
  ) {
    throw new Error("Codex strict allowlist cannot be combined with danger-full-access");
  }
}
