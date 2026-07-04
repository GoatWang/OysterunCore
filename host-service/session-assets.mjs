import { createHash } from "crypto";
import { realpathSync } from "fs";
import { basename, join, resolve } from "path";
import { getConfigDir } from "./config.mjs";

export function getSessionAssetHome() {
  return resolve(getConfigDir());
}

export function getTranscriptRoot() {
  return join(getSessionAssetHome(), "transcripts");
}

export function getUploadRoot() {
  return join(getSessionAssetHome(), "uploads");
}

export function sanitizePathSegment(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  return normalized || fallback;
}

export function getAgentFolderBucket(agentFolder, agentId) {
  if (!agentFolder || typeof agentFolder !== "string") {
    throw new Error("getAgentFolderBucket requires agentFolder");
  }
  if (!agentId || typeof agentId !== "string") {
    throw new Error("getAgentFolderBucket requires agentId");
  }

  const realFolder = realpathSync(agentFolder);
  const safeAgentId = sanitizePathSegment(agentId, "agent");
  const folderSlug = sanitizePathSegment(basename(realFolder), "folder");
  const folderHash = createHash("sha256").update(realFolder).digest("hex").slice(0, 12);
  return `${safeAgentId}__${folderSlug}__${folderHash}`;
}
