import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SCRYPT_PREFIX = "scrypt";
const DEFAULT_SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  keylen: 32,
});

function assertNonEmptyPassword(password, label = "Password") {
  if (typeof password !== "string" || password.length === 0 || password.trim().length === 0) {
    throw new Error(`${label} required`);
  }
  return password;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid dashboard password hash ${label}`);
  }
  return parsed;
}

function parseDashboardPasswordHashParts(storedHash) {
  if (typeof storedHash !== "string" || !storedHash.trim()) {
    throw new Error("Dashboard password hash required");
  }
  const trimmed = storedHash.trim();
  const parts = trimmed.split("$");
  if (parts.length !== 4 || parts[0] !== SCRYPT_PREFIX) {
    throw new Error("Invalid dashboard password hash format");
  }

  const paramPairs = parts[1].split(",").map((entry) => entry.trim()).filter(Boolean);
  const params = {};
  for (const pair of paramPairs) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error("Invalid dashboard password hash parameters");
    }
    params[pair.slice(0, separatorIndex)] = pair.slice(separatorIndex + 1);
  }

  const parsedParams = {
    N: parsePositiveInteger(params.N, "N"),
    r: parsePositiveInteger(params.r, "r"),
    p: parsePositiveInteger(params.p, "p"),
    keylen: parsePositiveInteger(params.keylen, "keylen"),
  };

  let salt;
  let derivedKey;
  try {
    salt = Buffer.from(parts[2], "base64");
    derivedKey = Buffer.from(parts[3], "base64");
  } catch {
    throw new Error("Invalid dashboard password hash encoding");
  }

  if (salt.length === 0 || derivedKey.length !== parsedParams.keylen) {
    throw new Error("Invalid dashboard password hash payload");
  }

  return {
    normalized: `${SCRYPT_PREFIX}$N=${parsedParams.N},r=${parsedParams.r},p=${parsedParams.p},keylen=${parsedParams.keylen}$${salt.toString("base64")}$${derivedKey.toString("base64")}`,
    params: parsedParams,
    salt,
    derivedKey,
  };
}

export function normalizeDashboardPasswordHash(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return parseDashboardPasswordHashParts(value).normalized;
}

export function hashDashboardPassword(password) {
  const normalizedPassword = assertNonEmptyPassword(password);
  const salt = randomBytes(16);
  const derivedKey = scryptSync(normalizedPassword, salt, DEFAULT_SCRYPT_PARAMS.keylen, {
    N: DEFAULT_SCRYPT_PARAMS.N,
    r: DEFAULT_SCRYPT_PARAMS.r,
    p: DEFAULT_SCRYPT_PARAMS.p,
  });
  return `${SCRYPT_PREFIX}$N=${DEFAULT_SCRYPT_PARAMS.N},r=${DEFAULT_SCRYPT_PARAMS.r},p=${DEFAULT_SCRYPT_PARAMS.p},keylen=${DEFAULT_SCRYPT_PARAMS.keylen}$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

export function verifyDashboardPassword(password, storedHash) {
  const normalizedPassword = assertNonEmptyPassword(password);
  const parsed = parseDashboardPasswordHashParts(storedHash);
  const candidate = scryptSync(normalizedPassword, parsed.salt, parsed.params.keylen, {
    N: parsed.params.N,
    r: parsed.params.r,
    p: parsed.params.p,
  });
  if (candidate.length !== parsed.derivedKey.length) {
    return false;
  }
  return timingSafeEqual(candidate, parsed.derivedKey);
}
