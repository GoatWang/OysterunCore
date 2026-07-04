import { readdir, realpath, stat } from "fs/promises";
import { dirname, join } from "path";
import {
  readConfig,
  resolveDefaultBrowsePathAsync,
  resolveDirectoryPathAsync,
} from "./config.mjs";

const MAX_SCAN_ENTRIES = 5000;

function sortEntries(a, b) {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

async function readInput() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
  }
  return raw.trim();
}

async function normalizePath(rawPath) {
  if (typeof rawPath === "string" && rawPath.trim()) {
    return resolveDirectoryPathAsync(rawPath);
  }
  return resolveDefaultBrowsePathAsync();
}

async function hasOysterunConfig(fullPath) {
  try {
    const candidate = join(fullPath, ".oysterun", "config.json");
    const fileStat = await stat(candidate);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function buildBrowseResult({
  path,
  offset,
  limit,
  q,
}) {
  const resolvedPath = await normalizePath(path);
  const query = typeof q === "string" ? q : "";
  const needle = query.toLowerCase();
  const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
  const showHiddenFiles = readConfig().show_hidden_files === true;

  const rawEntries = [];
  let scannedEntries = 0;
  let scanTruncated = false;

  for (const dirent of await readdir(resolvedPath, { withFileTypes: true })) {
    if (!showHiddenFiles && dirent.name.startsWith(".")) continue;
    scannedEntries += 1;
    if (scannedEntries > MAX_SCAN_ENTRIES) {
      scanTruncated = true;
      break;
    }

    const kind = dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : null;
    if (!kind) continue;
    if (needle && !dirent.name.toLowerCase().includes(needle)) continue;

    rawEntries.push({
      name: dirent.name,
      path: join(resolvedPath, dirent.name),
      kind,
    });
  }

  const entries = await Promise.all(rawEntries.map(async (entry) => ({
    ...entry,
    has_oysterun_config: entry.kind === "directory" ? await hasOysterunConfig(entry.path) : false,
  })));

  entries.sort(sortEntries);

  const pagedEntries = entries.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  const matchedCount = entries.length;
  const hasMore = normalizedOffset + normalizedLimit < matchedCount;

  return {
    path: resolvedPath,
    parent: resolvedPath === dirname(resolvedPath) ? null : dirname(resolvedPath),
    query,
    offset: normalizedOffset,
    limit: normalizedLimit,
    entries: pagedEntries,
    has_more: hasMore,
    next_offset: hasMore ? normalizedOffset + pagedEntries.length : null,
    returned_count: pagedEntries.length,
    matched_count: matchedCount,
    scan_truncated: scanTruncated,
    warning: scanTruncated
      ? `Large directory truncated to first ${MAX_SCAN_ENTRIES} visible entries. Refine search to narrow results.`
      : null,
  };
}

async function main() {
  try {
    const raw = await readInput();
    const payload = raw ? JSON.parse(raw) : {};
    const result = await buildBrowseResult(payload);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: {
        message: err.message || "Folder browse failed",
        code: err.code || null,
      },
    }));
    process.exitCode = 1;
  }
}

await main();
