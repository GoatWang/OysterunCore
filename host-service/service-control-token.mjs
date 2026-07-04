import { randomBytes, timingSafeEqual } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

export const LOCAL_SERVICE_CONTROL_TOKEN_FILE = "service-control-token.json";
export const LOCAL_SERVICE_CONTROL_TOKEN_SCHEMA =
  "oysterun_local_service_control_token";
export const LOCAL_SERVICE_CONTROL_TOKEN_VERSION = 1;
export const LOCAL_SERVICE_CONTROL_HEADER =
  "x-oysterun-service-control-token";

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function nowIso() {
  return new Date().toISOString();
}

function createToken() {
  return randomBytes(32).toString("base64url");
}

function writeJsonFile0600(file, payload) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

function parseTokenRecord(raw) {
  const parsed = JSON.parse(raw);
  if (
    parsed?.schema !== LOCAL_SERVICE_CONTROL_TOKEN_SCHEMA ||
    parsed?.version !== LOCAL_SERVICE_CONTROL_TOKEN_VERSION ||
    !normalizeString(parsed?.token)
  ) {
    throw new Error("Invalid local service-control token file");
  }
  return {
    schema: parsed.schema,
    version: parsed.version,
    token: normalizeString(parsed.token),
    created_at: normalizeString(parsed.created_at),
  };
}

function readTokenRecord(file) {
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  if (!stat.isFile()) {
    throw new Error(`Local service-control token path is not a file: ${file}`);
  }
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    chmodSync(file, 0o600);
  }
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) return null;
  return parseTokenRecord(raw);
}

export function getLocalServiceControlTokenPath(configDir) {
  const normalizedConfigDir = normalizeString(configDir);
  if (!normalizedConfigDir) {
    throw new Error("configDir is required for local service-control token");
  }
  return join(normalizedConfigDir, LOCAL_SERVICE_CONTROL_TOKEN_FILE);
}

export function ensureLocalServiceControlToken({ configDir }) {
  const file = getLocalServiceControlTokenPath(configDir);
  try {
    const existing = readTokenRecord(file);
    if (existing?.token) {
      return { ...existing, path: file, created: false };
    }
  } catch {
    // A corrupt local-control token should not prevent Host startup; rotate it.
  }
  const record = {
    schema: LOCAL_SERVICE_CONTROL_TOKEN_SCHEMA,
    version: LOCAL_SERVICE_CONTROL_TOKEN_VERSION,
    token: createToken(),
    created_at: nowIso(),
  };
  writeJsonFile0600(file, record);
  return { ...record, path: file, created: true };
}

export function readLocalServiceControlToken({ configDir }) {
  const file = getLocalServiceControlTokenPath(configDir);
  const record = readTokenRecord(file);
  if (!record?.token) {
    throw new Error(
      `Local service-control token is not available at ${file}; restart the Host once with the updated version before using restore-aware service restart.`
    );
  }
  return { ...record, path: file };
}

export function verifyLocalServiceControlToken({ configDir, token }) {
  const candidate = normalizeString(token);
  if (!candidate) return false;
  let stored;
  try {
    stored = readLocalServiceControlToken({ configDir }).token;
  } catch {
    return false;
  }
  const candidateBytes = Buffer.from(candidate, "utf8");
  const storedBytes = Buffer.from(stored, "utf8");
  if (candidateBytes.length !== storedBytes.length) return false;
  return timingSafeEqual(candidateBytes, storedBytes);
}

export function isLoopbackRemoteAddress(remoteAddress) {
  const value = normalizeString(remoteAddress);
  if (!value) return false;
  return (
    value === "::1" ||
    value === "127.0.0.1" ||
    value.startsWith("127.") ||
    value === "::ffff:127.0.0.1" ||
    value.startsWith("::ffff:127.")
  );
}
