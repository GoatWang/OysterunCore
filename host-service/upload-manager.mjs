import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import { getAgentFolderBucket, getUploadRoot, sanitizePathSegment } from "./session-assets.mjs";

function sanitizeUploadFilename(filename) {
  const rawName = basename(String(filename || "").replace(/\\/g, "/"));
  const ext = extname(rawName).toLowerCase().replace(/[^.a-z0-9]+/g, "");
  const stem = rawName.slice(0, rawName.length - ext.length);
  const safeStem = sanitizePathSegment(stem, "upload");
  return `${safeStem}${ext}`;
}

export function getUploadDir(agentFolder, agentId) {
  return join(getUploadRoot(), getAgentFolderBucket(agentFolder, agentId));
}

export function saveUploadedFiles(agentFolder, agentId, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("saveUploadedFiles requires a non-empty files array");
  }

  const uploadDir = getUploadDir(agentFolder, agentId);
  mkdirSync(uploadDir, { recursive: true });

  const batchStamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return files.map((file, index) => {
    if (!file || typeof file !== "object") {
      throw new Error(`Upload file at index ${index} must be an object`);
    }
    if (!file.filename || typeof file.filename !== "string") {
      throw new Error(`Upload file at index ${index} requires filename`);
    }
    if (!Buffer.isBuffer(file.buffer)) {
      throw new Error(`Upload file at index ${index} requires buffer`);
    }

    const safeFilename = sanitizeUploadFilename(file.filename);
    const entropy = randomUUID().slice(0, 8);
    const savedName = `${batchStamp}_${entropy}_${String(index).padStart(2, "0")}_${safeFilename}`;
    const savedPath = join(uploadDir, savedName);
    writeFileSync(savedPath, file.buffer);
    return {
      original_name: file.filename,
      saved_path: savedPath,
      size: file.buffer.length,
    };
  });
}
