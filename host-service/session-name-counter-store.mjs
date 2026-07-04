import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { getConfigDir, getHostDbPath } from "./config.mjs";

export function getSessionNameCounterDbPath(configDir = getConfigDir()) {
  return getHostDbPath(configDir);
}

export class SessionNameCounterStore {
  constructor({ dbPath = getSessionNameCounterDbPath() } = {}) {
    this.dbPath = dbPath;
    this.db = null;
    this.initialized = false;
  }

  getDbPath() {
    return this.dbPath;
  }

  initialize() {
    if (this.initialized) return this;

    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_name_counters (
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('agent', 'branch')),
        scope_key TEXT NOT NULL,
        next_value INTEGER NOT NULL,
        PRIMARY KEY (scope_kind, scope_key)
      );
    `);
    this.statements = {
      counterRead: this.db.prepare(`
        SELECT next_value
        FROM session_name_counters
        WHERE scope_kind = ? AND scope_key = ?
      `),
      counterUpsert: this.db.prepare(`
        INSERT INTO session_name_counters (scope_kind, scope_key, next_value)
        VALUES (?, ?, ?)
        ON CONFLICT (scope_kind, scope_key) DO UPDATE SET next_value = excluded.next_value
      `),
    };
    this.initialized = true;
    return this;
  }

  ensureInitialized() {
    if (!this.initialized) this.initialize();
    return this;
  }

  // Monotonic, never-recycled counter for session/branch naming.
  // Returns the value to USE (1, 2, 3, ...); the next call for the same scope
  // returns the next higher value, even if sessions have been deleted.
  nextNameCounter(scopeKind, scopeKey) {
    this.ensureInitialized();
    const take = this.db.transaction(() => {
      const row = this.statements.counterRead.get(scopeKind, scopeKey);
      const current =
        row && Number.isFinite(row.next_value) ? row.next_value : 1;
      this.statements.counterUpsert.run(scopeKind, scopeKey, current + 1);
      return current;
    });
    return take();
  }

  nextAgentSessionCounter(agentId) {
    return this.nextNameCounter("agent", String(agentId));
  }

  nextBranchCounter(parentSessionId) {
    return this.nextNameCounter("branch", String(parentSessionId));
  }

  // Peek the value `nextNameCounter` WOULD return for this scope, without
  // bumping. Used for UI pre-fill of branch defaults.
  peekNameCounter(scopeKind, scopeKey) {
    this.ensureInitialized();
    const row = this.statements.counterRead.get(scopeKind, scopeKey);
    return row && Number.isFinite(row.next_value) ? row.next_value : 1;
  }

  peekBranchCounter(parentSessionId) {
    return this.peekNameCounter("branch", String(parentSessionId));
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }
}

let defaultSessionNameCounterStore = null;

export function getSessionNameCounterStore() {
  if (!defaultSessionNameCounterStore) {
    defaultSessionNameCounterStore = new SessionNameCounterStore();
  }
  return defaultSessionNameCounterStore;
}
