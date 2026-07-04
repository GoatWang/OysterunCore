import Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { getConfigDir, getHostDbPath } from "./config.mjs";

export const HOST_LOGIN_BOOTSTRAP_TOKEN_TTL_MS = 15 * 60 * 1000;
export const HOST_LOGIN_BOOTSTRAP_QR_TYPE =
  "oysterun.stage1.direct_host_login";
export const HOST_LOGIN_BOOTSTRAP_COMPACT_QR_TYPE = "odh1";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hashToken(token) {
  const normalized = normalizeString(token);
  if (!normalized) {
    throw new Error("bootstrap token required");
  }
  return createHash("sha256").update(normalized, "utf-8").digest("hex");
}

function formatIsoTime(ms) {
  return new Date(ms).toISOString();
}

export function buildDirectHostLoginQrPayload({
  hostId,
  directHostUrl,
  bootstrapToken,
  expiresAt,
}) {
  const normalizedHostId = normalizeString(hostId);
  const normalizedDirectHostUrl = normalizeString(directHostUrl);
  const normalizedBootstrapToken = normalizeString(bootstrapToken);
  const normalizedExpiresAt = normalizeString(expiresAt);
  if (!normalizedHostId) throw new Error("host_id required for login QR");
  if (!normalizedDirectHostUrl) {
    throw new Error("direct_host_url required for login QR");
  }
  if (!normalizedBootstrapToken) {
    throw new Error("bootstrap_token required for login QR");
  }
  if (!normalizedExpiresAt || Number.isNaN(Date.parse(normalizedExpiresAt))) {
    throw new Error("expires_at required for login QR");
  }
  return {
    type: HOST_LOGIN_BOOTSTRAP_QR_TYPE,
    host_id: normalizedHostId,
    direct_host_url: normalizedDirectHostUrl,
    bootstrap_token: normalizedBootstrapToken,
    expires_at: normalizedExpiresAt,
  };
}

export function buildCompactDirectHostLoginQrPayload({
  hostId,
  directHostUrl,
  bootstrapToken,
  expiresAt,
}) {
  const verbose = buildDirectHostLoginQrPayload({
    hostId,
    directHostUrl,
    bootstrapToken,
    expiresAt,
  });
  return {
    t: HOST_LOGIN_BOOTSTRAP_COMPACT_QR_TYPE,
    h: verbose.host_id,
    u: verbose.direct_host_url,
    b: verbose.bootstrap_token,
    e: Math.floor(Date.parse(verbose.expires_at) / 1000),
  };
}

export class HostLoginBootstrapTokenStore {
  constructor({
    dbPath = null,
    configDir = getConfigDir(),
    clock = () => Date.now(),
  } = {}) {
    this.dbPath = dbPath || getHostDbPath(configDir);
    this.clock = clock;
    this.db = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return this;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS host_login_bootstrap_tokens (
        token_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        consumed_at_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_host_login_bootstrap_tokens_expires
        ON host_login_bootstrap_tokens(expires_at_ms);
    `);
    this.statements = {
      insert: this.db.prepare(`
        INSERT INTO host_login_bootstrap_tokens (
          token_id,
          token_hash,
          created_at_ms,
          expires_at_ms,
          consumed_at_ms
        ) VALUES (?, ?, ?, ?, NULL)
      `),
      findByHash: this.db.prepare(`
        SELECT token_id, token_hash, created_at_ms, expires_at_ms, consumed_at_ms
        FROM host_login_bootstrap_tokens
        WHERE token_hash = ?
      `),
      consume: this.db.prepare(`
        UPDATE host_login_bootstrap_tokens
        SET consumed_at_ms = ?
        WHERE token_hash = ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
      `),
      cleanupExpired: this.db.prepare(`
        DELETE FROM host_login_bootstrap_tokens
        WHERE expires_at_ms <= ?
      `),
    };
    this.initialized = true;
    return this;
  }

  createToken({ ttlMs = HOST_LOGIN_BOOTSTRAP_TOKEN_TTL_MS } = {}) {
    this.initialize();
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("bootstrap token ttlMs must be a positive integer");
    }
    const nowMs = this.clock();
    const expiresAtMs = nowMs + ttlMs;
    const token = randomBytes(16).toString("base64url");
    const tokenId = randomUUID();
    this.statements.insert.run(tokenId, hashToken(token), nowMs, expiresAtMs);
    return {
      token_id: tokenId,
      token,
      expires_at: formatIsoTime(expiresAtMs),
      expires_at_ms: expiresAtMs,
      ttl_ms: ttlMs,
    };
  }

  consumeToken(token) {
    this.initialize();
    const tokenHash = hashToken(token);
    const nowMs = this.clock();
    const result = this.statements.consume.run(nowMs, tokenHash, nowMs);
    if (result.changes === 1) {
      const row = this.statements.findByHash.get(tokenHash);
      return {
        ok: true,
        token_id: row.token_id,
        consumed_at: formatIsoTime(nowMs),
      };
    }
    const row = this.statements.findByHash.get(tokenHash);
    if (!row) {
      return { ok: false, reason: "unknown_token" };
    }
    if (row.consumed_at_ms !== null && row.consumed_at_ms !== undefined) {
      return { ok: false, reason: "already_consumed" };
    }
    if (row.expires_at_ms <= nowMs) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "not_consumed" };
  }

  cleanupExpiredTokens({ olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
    this.initialize();
    const cutoffMs = this.clock() - olderThanMs;
    return this.statements.cleanupExpired.run(cutoffMs).changes;
  }

  close() {
    if (this.db) {
      this.db.close();
    }
    this.db = null;
    this.statements = null;
    this.initialized = false;
  }
}

let singletonStore = null;

export function getHostLoginBootstrapTokenStore() {
  if (!singletonStore) {
    singletonStore = new HostLoginBootstrapTokenStore();
  }
  return singletonStore;
}

export function createHostLoginBootstrapToken(options = {}) {
  const store = getHostLoginBootstrapTokenStore();
  store.cleanupExpiredTokens();
  return store.createToken(options);
}

export function consumeHostLoginBootstrapToken(token) {
  return getHostLoginBootstrapTokenStore().consumeToken(token);
}
