import { createHash } from "crypto";
import Database from "better-sqlite3";
import { StringDecoder } from "string_decoder";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";

export const MATRIX_SQLITE_SCHEMA_VERSION = 1;
export const MATRIX_SQLITE_SCHEMA_NAME =
  "routec.host_owned_matrix_sqlite_storage.v1";
export const MATRIX_SQLITE_TABLE_DEFINITIONS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS matrix_schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS matrix_rooms (
    room_id TEXT PRIMARY KEY,
    host_session_id TEXT NOT NULL,
    host_agent_id TEXT NOT NULL,
    matrix_user_id TEXT NOT NULL,
    actor_registry_version TEXT NOT NULL,
    actor_registry_source_of_truth TEXT NOT NULL,
    committed_sender_truth TEXT NOT NULL,
    semantic_role_is_sender INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS matrix_room_actors (
    room_id TEXT NOT NULL,
    actor_key TEXT NOT NULL,
    actor_kind TEXT NOT NULL,
    matrix_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    provider_id TEXT,
    membership TEXT NOT NULL,
    browser_send_allowed INTEGER NOT NULL,
    sender_source TEXT NOT NULL,
    PRIMARY KEY(room_id, actor_key),
    FOREIGN KEY(room_id) REFERENCES matrix_rooms(room_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS matrix_events (
    event_id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    type TEXT NOT NULL,
    sender TEXT NOT NULL,
    stream_seq INTEGER NOT NULL,
    state_key TEXT,
    is_state INTEGER NOT NULL,
    origin_server_ts INTEGER NOT NULL,
    semantic_type TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    content_json TEXT NOT NULL,
    unsigned_json TEXT NOT NULL,
    FOREIGN KEY(room_id) REFERENCES matrix_rooms(room_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS matrix_room_state (
    room_id TEXT NOT NULL,
    type TEXT NOT NULL,
    state_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    PRIMARY KEY(room_id, type, state_key),
    FOREIGN KEY(room_id) REFERENCES matrix_rooms(room_id) ON DELETE CASCADE,
    FOREIGN KEY(event_id) REFERENCES matrix_events(event_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS matrix_txn_map (
    room_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    txn_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    PRIMARY KEY(room_id, event_type, txn_id),
    FOREIGN KEY(event_id) REFERENCES matrix_events(event_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS matrix_event_search (
    event_id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    stream_seq INTEGER NOT NULL,
    search_text TEXT NOT NULL,
    FOREIGN KEY(event_id) REFERENCES matrix_events(event_id) ON DELETE CASCADE
  )`,
]);

export const MATRIX_SQLITE_INDEX_DEFINITIONS = Object.freeze([
  `CREATE INDEX IF NOT EXISTS idx_matrix_events_room_seq ON matrix_events(room_id, stream_seq)`,
  `CREATE INDEX IF NOT EXISTS idx_matrix_events_room_sender_seq ON matrix_events(room_id, sender, stream_seq)`,
  `CREATE INDEX IF NOT EXISTS idx_matrix_events_room_type_seq ON matrix_events(room_id, type, stream_seq)`,
  `CREATE INDEX IF NOT EXISTS idx_matrix_events_room_state ON matrix_events(room_id, is_state, type, state_key)`,
  `CREATE INDEX IF NOT EXISTS idx_matrix_event_search_room_seq ON matrix_event_search(room_id, stream_seq)`,
]);

const LEGACY_JSON_SCHEMA_VERSION = "routec.host_owned_matrix_storage.v1";
const LEGACY_DELTA_SCHEMA_VERSION =
  "routec.host_owned_matrix_storage.delta.v1";
const OYSTERUN_SEMANTIC_NAMESPACE = "org.oysterun.semantic.v1";
const MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE = "m.room.pinned_events";
const STATE_KEY_SEPARATOR = "\u001f";
const MIGRATION_LOCK_STALE_MS = 5 * 60 * 1000;
const MIGRATION_JSON_READ_CHUNK_BYTES = 64 * 1024;
const MIGRATION_SQLITE_WRITE_BATCH_ROWS = 500;

const dbCache = new Map();
let lastMigrationProof = null;
const migrationDiagnostics = {
  snapshotFullReadJsonParseCount: 0,
  snapshotStreamingEntryParseCount: 0,
  roomMetadataStreamingEntryParseCount: 0,
  roomEventIdsArraySkippedCount: 0,
  nonAllocatingJsonSkipCount: 0,
  nonAllocatingJsonSkipCharCount: 0,
  sqliteWriteBatchCommitCount: 0,
  deltaStreamingRecordParseCount: 0,
  readinessFullFileSignatureCount: 0,
  readinessMetadataOnlySignatureCount: 0,
  fileSignatureReadMode: "streaming_chunks",
  readinessSignatureMode: "bounded_stat_metadata_path_hash",
  snapshotImportMode: "streaming_top_level_entries",
  roomImportMode: "streaming_room_metadata_skip_event_ids",
  skippedJsonValueMode: "streaming_non_allocating",
  sqliteWriteBatchRows: MIGRATION_SQLITE_WRITE_BATCH_ROWS,
  deltaImportMode: "streaming_jsonl_lines",
  readChunkBytes: MIGRATION_JSON_READ_CHUNK_BYTES,
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonString(value, fieldName) {
  const encoded = JSON.stringify(value ?? {});
  if (encoded === undefined) {
    throw new Error(`Route C Matrix SQLite ${fieldName} is not JSON serializable`);
  }
  return encoded;
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  return JSON.parse(value);
}

function fileSignature(path) {
  if (!existsSync(path)) {
    return { exists: false, path, size: null, mtimeMs: null, sha256: null };
  }
  const stats = statSync(path);
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(MIGRATION_JSON_READ_CHUNK_BYTES);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return {
    exists: true,
    path,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    sha256: hash.digest("hex"),
  };
}

function fileReadinessMetadata(path) {
  migrationDiagnostics.readinessMetadataOnlySignatureCount += 1;
  if (!existsSync(path)) {
    return {
      exists: false,
      path,
      path_hash: sha256(path),
      size: null,
      mtimeMs: null,
      readiness_metadata_only: true,
      content_sha256_computed: false,
    };
  }
  const stats = statSync(path);
  return {
    exists: true,
    path,
    path_hash: sha256(path),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    readiness_metadata_only: true,
    content_sha256_computed: false,
  };
}

function sqlitePathForJsonPath(jsonStoragePath) {
  return join(dirname(jsonStoragePath), "homeserver.sqlite");
}

function migrationProofPath(sqlitePath) {
  return `${sqlitePath}.migration-proof.json`;
}

function lockPath(sqlitePath) {
  return `${sqlitePath}.migration.lock`;
}

function stateStoreKey(eventType, stateKey = "") {
  return `${eventType}${STATE_KEY_SEPARATOR}${stateKey}`;
}

function splitTxnKey(txnKey) {
  const parts = String(txnKey || "").split("\u001f");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Route C Matrix SQLite txn key must be room/event/txn");
  }
  return {
    room_id: parts[0],
    event_type: parts[1],
    txn_id: parts[2],
  };
}

function streamSeqForEvent(event) {
  const seq = event?.routec_stream_seq ?? event?.routec_state_seq;
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error(
      `Route C Matrix SQLite event missing stream seq: ${event?.event_id || "unknown"}`
    );
  }
  return seq;
}

function semanticTypeForEvent(event) {
  const semantic = isObject(event?.content?.[OYSTERUN_SEMANTIC_NAMESPACE])
    ? event.content[OYSTERUN_SEMANTIC_NAMESPACE]
    : {};
  const candidates = [
    semantic.semantic_type,
    semantic.semantic_category,
    event?.content?.semantic_type,
    event?.content?.semantic_category,
    event?.type,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function searchableTextForEvent(event) {
  const content = isObject(event?.content) ? event.content : {};
  const semantic = isObject(content[OYSTERUN_SEMANTIC_NAMESPACE])
    ? content[OYSTERUN_SEMANTIC_NAMESPACE]
    : {};
  return [content.body, semantic.body, semantic.text, semantic.summary]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .toLowerCase();
}

function roomActorRows(room) {
  const registry = isObject(room?.routec_matrix_actor_registry)
    ? room.routec_matrix_actor_registry
    : {};
  const actors = Array.isArray(registry.actors) ? registry.actors : [];
  return actors.map((actor) => ({
    room_id: room.room_id,
    actor_key: String(actor.actor_key || ""),
    actor_kind: String(actor.actor_kind || ""),
    matrix_user_id: String(actor.matrix_user_id || ""),
    display_name: String(actor.display_name || ""),
    provider_id:
      actor.provider_id === null || actor.provider_id === undefined
        ? null
        : String(actor.provider_id),
    membership: String(actor.membership || "join"),
    browser_send_allowed: actor.browser_send_allowed === true ? 1 : 0,
    sender_source: String(actor.sender_source || ""),
  }));
}

function normalizeRoom(row, actorRows, stateRows) {
  return {
    room_id: row.room_id,
    host_session_id: row.host_session_id,
    host_agent_id: row.host_agent_id,
    matrix_user_id: row.matrix_user_id,
    routec_matrix_actor_registry: {
      registry_version: row.actor_registry_version,
      source_of_truth: row.actor_registry_source_of_truth,
      committed_sender_truth: row.committed_sender_truth,
      semantic_role_is_sender: row.semantic_role_is_sender === 1,
      actors: actorRows.map((actor) => ({
        actor_key: actor.actor_key,
        actor_kind: actor.actor_kind,
        provider_id: actor.provider_id,
        matrix_user_id: actor.matrix_user_id,
        display_name: actor.display_name,
        membership: actor.membership,
        browser_send_allowed: actor.browser_send_allowed === 1,
        sender_source: actor.sender_source,
      })),
    },
    created_at: row.created_at,
    created_at_ms: row.created_at_ms,
    state_events: Object.fromEntries(
      stateRows.map((event) => [stateStoreKey(event.type, event.state_key || ""), event])
    ),
    event_ids: [],
  };
}

function eventFromRow(row) {
  const event = {
    type: row.type,
    room_id: row.room_id,
    sender: row.sender,
    content: parseJson(row.content_json, {}),
    event_id: row.event_id,
    origin_server_ts: row.origin_server_ts,
    unsigned: parseJson(row.unsigned_json, {}),
  };
  if (row.state_key !== null && row.state_key !== undefined) {
    event.state_key = row.state_key;
  }
  if (row.is_state === 1) {
    event.routec_state_seq = row.stream_seq;
  } else {
    event.routec_stream_seq = row.stream_seq;
  }
  return event;
}

function nextStreamSeqFromDb(db) {
  const nextStreamSeqMeta = Number(
    db.prepare("SELECT value FROM matrix_schema_meta WHERE key = ?").get("next_stream_seq")
      ?.value
  );
  const nextFromRows =
    db.prepare("SELECT COALESCE(MAX(stream_seq), 0) + 1 AS seq FROM matrix_events").get()
      .seq || 1;
  return Number.isSafeInteger(nextStreamSeqMeta) && nextStreamSeqMeta >= nextFromRows
    ? nextStreamSeqMeta
    : nextFromRows;
}

function setNextStreamSeq(db, nextSeq) {
  if (!Number.isSafeInteger(nextSeq) || nextSeq < 1) {
    throw new Error(`Route C Matrix SQLite next_stream_seq is invalid: ${nextSeq}`);
  }
  db.prepare(
    `INSERT INTO matrix_schema_meta(key, value) VALUES ('next_stream_seq', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(nextSeq));
  db.prepare(
    `INSERT INTO matrix_schema_meta(key, value) VALUES ('updated_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(new Date().toISOString());
}

function timelineWhereClause({
  roomId,
  beforeSeq = null,
  atOrAfterSeq = null,
  afterSeq = null,
  atOrBeforeSeq = null,
  sender = null,
  type = null,
}) {
  const clauses = ["room_id = @roomId", "is_state = 0"];
  const params = { roomId };
  if (beforeSeq !== null) {
    clauses.push("stream_seq < @beforeSeq");
    params.beforeSeq = beforeSeq;
  }
  if (atOrAfterSeq !== null) {
    clauses.push("stream_seq >= @atOrAfterSeq");
    params.atOrAfterSeq = atOrAfterSeq;
  }
  if (afterSeq !== null) {
    clauses.push("stream_seq > @afterSeq");
    params.afterSeq = afterSeq;
  }
  if (atOrBeforeSeq !== null) {
    clauses.push("stream_seq <= @atOrBeforeSeq");
    params.atOrBeforeSeq = atOrBeforeSeq;
  }
  if (sender !== null) {
    clauses.push("sender = @sender");
    params.sender = sender;
  }
  if (type !== null) {
    clauses.push("type = @type");
    params.type = type;
  }
  return { where: clauses.join(" AND "), params };
}

export function initializeSchema(db) {
  db.pragma("journal_mode = DELETE");
  db.pragma("foreign_keys = ON");
  for (const definition of MATRIX_SQLITE_TABLE_DEFINITIONS) {
    db.exec(definition);
  }
  for (const definition of MATRIX_SQLITE_INDEX_DEFINITIONS) {
    db.exec(definition);
  }
  const setMeta = db.prepare(
    `INSERT INTO matrix_schema_meta(key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  setMeta.run("schema_name", MATRIX_SQLITE_SCHEMA_NAME);
  setMeta.run("schema_version", String(MATRIX_SQLITE_SCHEMA_VERSION));
}

export function assertSchemaCompatible(db) {
  const schemaName = db
    .prepare("SELECT value FROM matrix_schema_meta WHERE key = ?")
    .get("schema_name")?.value;
  const schemaVersion = db
    .prepare("SELECT value FROM matrix_schema_meta WHERE key = ?")
    .get("schema_version")?.value;
  if (schemaName !== MATRIX_SQLITE_SCHEMA_NAME) {
    throw new Error(
      `Route C Matrix SQLite schema name mismatch: ${schemaName || "missing"}`
    );
  }
  if (Number(schemaVersion) !== MATRIX_SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `Route C Matrix SQLite schema version mismatch: ${schemaVersion || "missing"}`
    );
  }
}

function openDatabase(sqlitePath) {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath);
  initializeSchema(db);
  assertSchemaCompatible(db);
  return db;
}

function acquireMigrationLock(sqlitePath, sourcePath) {
  const path = lockPath(sqlitePath);
  const now = Date.now();
  if (existsSync(path)) {
    const stats = statSync(path);
    let lock = {};
    try {
      lock = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      lock = {};
    }
    const ageMs = now - stats.mtimeMs;
    const pid = Number(lock.pid);
    const pidAlive =
      Number.isInteger(pid) && pid > 0
        ? (() => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          })()
        : false;
    if (ageMs < MIGRATION_LOCK_STALE_MS || pidAlive) {
      throw new Error(`Route C Matrix SQLite migration lock is active: ${path}`);
    }
    unlinkSync(path);
  }
  const fd = openSync(path, "wx");
  closeSync(fd);
  writeFileSync(
    path,
    JSON.stringify(
      {
        schema_version: "routec.matrix_sqlite_migration_lock.v1",
        pid: process.pid,
        started_at: new Date().toISOString(),
        source_path_hash: sha256(sourcePath),
        target_path: sqlitePath,
      },
      null,
      2
    ) + "\n"
  );
  return path;
}

function releaseMigrationLock(path) {
  if (path && existsSync(path)) unlinkSync(path);
}

class ChunkedJsonReader {
  constructor(path) {
    this.path = path;
    this.fd = openSync(path, "r");
    this.buffer = Buffer.allocUnsafe(MIGRATION_JSON_READ_CHUNK_BYTES);
    this.decoder = new StringDecoder("utf8");
    this.text = "";
    this.position = 0;
    this.ended = false;
    this.pushback = [];
  }

  close() {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  readChar() {
    if (this.pushback.length > 0) return this.pushback.pop();
    while (this.position >= this.text.length) {
      if (this.ended) return null;
      const bytesRead = readSync(this.fd, this.buffer, 0, this.buffer.length, null);
      if (bytesRead === 0) {
        this.text = this.decoder.end();
        this.position = 0;
        this.ended = true;
        if (this.text.length === 0) return null;
        break;
      }
      this.text = this.decoder.write(this.buffer.subarray(0, bytesRead));
      this.position = 0;
      if (this.text.length === 0) continue;
    }
    return this.text[this.position++];
  }

  unreadChar(char) {
    if (char !== null && char !== undefined) this.pushback.push(char);
  }

  skipWhitespace() {
    while (true) {
      const char = this.readChar();
      if (char === null) return null;
      if (!/\s/.test(char)) return char;
    }
  }

  expectChar(expected) {
    const char = this.skipWhitespace();
    if (char !== expected) {
      throw new Error(
        `Route C Matrix legacy JSON expected ${expected} in ${this.path}`
      );
    }
  }
}

function readJsonString(reader) {
  const start = reader.skipWhitespace();
  if (start !== '"') {
    throw new Error("Route C Matrix legacy JSON expected string");
  }
  let raw = '"';
  let escaped = false;
  while (true) {
    const char = reader.readChar();
    if (char === null) {
      throw new Error("Route C Matrix legacy JSON unterminated string");
    }
    raw += char;
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      return JSON.parse(raw);
    }
  }
}

function readJsonValueRaw(reader, firstChar = null) {
  let char = firstChar ?? reader.skipWhitespace();
  if (char === null) {
    throw new Error("Route C Matrix legacy JSON missing value");
  }
  let raw = "";
  if (char === '"' || char === "{" || char === "[") {
    const stack = [];
    let inString = char === '"';
    let escaped = false;
    if (char === "{") stack.push("}");
    if (char === "[") stack.push("]");
    raw += char;
    if (char === '"') {
      while (true) {
        char = reader.readChar();
        if (char === null) {
          throw new Error("Route C Matrix legacy JSON unterminated string value");
        }
        raw += char;
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          return raw;
        }
      }
    }
    while (stack.length > 0) {
      char = reader.readChar();
      if (char === null) {
        throw new Error("Route C Matrix legacy JSON unterminated structured value");
      }
      raw += char;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === stack[stack.length - 1]) {
        stack.pop();
      }
    }
    return raw;
  }

  while (char !== null && char !== "," && char !== "}" && char !== "]") {
    raw += char;
    char = reader.readChar();
  }
  reader.unreadChar(char);
  return raw.trim();
}

function skipJsonValue(reader, firstChar = null) {
  let char = firstChar ?? reader.skipWhitespace();
  if (char === null) {
    throw new Error("Route C Matrix legacy JSON missing value");
  }
  migrationDiagnostics.nonAllocatingJsonSkipCount += 1;
  let skippedChars = 1;
  if (char === '"') {
    let escaped = false;
    while (true) {
      char = reader.readChar();
      if (char === null) {
        throw new Error("Route C Matrix legacy JSON unterminated skipped string");
      }
      skippedChars += 1;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        migrationDiagnostics.nonAllocatingJsonSkipCharCount += skippedChars;
        return;
      }
    }
  }
  if (char === "{" || char === "[") {
    const stack = [char === "{" ? "}" : "]"];
    let inString = false;
    let escaped = false;
    while (stack.length > 0) {
      char = reader.readChar();
      if (char === null) {
        throw new Error("Route C Matrix legacy JSON unterminated skipped value");
      }
      skippedChars += 1;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === stack[stack.length - 1]) {
        stack.pop();
      }
    }
    migrationDiagnostics.nonAllocatingJsonSkipCharCount += skippedChars;
    return;
  }

  while (char !== null && char !== "," && char !== "}" && char !== "]") {
    char = reader.readChar();
    if (char !== null && char !== "," && char !== "}" && char !== "]") {
      skippedChars += 1;
    }
  }
  reader.unreadChar(char);
  migrationDiagnostics.nonAllocatingJsonSkipCharCount += skippedChars;
}

function withLegacyJsonReader(path, callback) {
  const reader = new ChunkedJsonReader(path);
  try {
    return callback(reader);
  } finally {
    reader.close();
  }
}

function findTopLevelValue(path, targetKey, callback) {
  return withLegacyJsonReader(path, (reader) => {
    reader.expectChar("{");
    while (true) {
      const char = reader.skipWhitespace();
      if (char === "}") return false;
      reader.unreadChar(char);
      const key = readJsonString(reader);
      reader.expectChar(":");
      const firstValueChar = reader.skipWhitespace();
      if (key === targetKey) {
        callback(reader, firstValueChar);
        return true;
      }
      skipJsonValue(reader, firstValueChar);
      const separator = reader.skipWhitespace();
      if (separator === "}") return false;
      if (separator !== ",") {
        throw new Error("Route C Matrix legacy JSON top-level separator invalid");
      }
    }
  });
}

function readTopLevelJsonValue(path, key) {
  let value;
  const found = findTopLevelValue(path, key, (reader, firstValueChar) => {
    value = JSON.parse(readJsonValueRaw(reader, firstValueChar));
  });
  if (!found) {
    throw new Error(`Route C Matrix legacy JSON missing ${key}`);
  }
  return value;
}

function forEachTopLevelObjectEntry(path, topLevelKey, callback) {
  const found = findTopLevelValue(path, topLevelKey, (reader, firstValueChar) => {
    if (firstValueChar !== "{") {
      throw new Error(
        `Route C Matrix legacy JSON ${topLevelKey} must be an object`
      );
    }
    while (true) {
      const char = reader.skipWhitespace();
      if (char === "}") return;
      reader.unreadChar(char);
      const entryKey = readJsonString(reader);
      reader.expectChar(":");
      const rawValue = readJsonValueRaw(reader);
      migrationDiagnostics.snapshotStreamingEntryParseCount += 1;
      callback(entryKey, JSON.parse(rawValue));
      const separator = reader.skipWhitespace();
      if (separator === "}") return;
      if (separator !== ",") {
        throw new Error(
          `Route C Matrix legacy JSON ${topLevelKey} separator invalid`
        );
      }
    }
  });
  if (!found) {
    throw new Error(`Route C Matrix legacy JSON missing ${topLevelKey}`);
  }
}

function readLegacyRoomMetadataValue(reader, firstValueChar) {
  if (firstValueChar !== "{") {
    throw new Error("Route C Matrix legacy room must be object");
  }
  const room = { event_ids: [] };
  const parseKeys = new Set([
    "room_id",
    "host_session_id",
    "host_agent_id",
    "matrix_user_id",
    "routec_matrix_actor_registry",
    "created_at",
    "created_at_ms",
    "state_events",
  ]);
  while (true) {
    const char = reader.skipWhitespace();
    if (char === "}") return room;
    reader.unreadChar(char);
    const key = readJsonString(reader);
    reader.expectChar(":");
    const valueFirstChar = reader.skipWhitespace();
    if (key === "event_ids") {
      migrationDiagnostics.roomEventIdsArraySkippedCount += 1;
      skipJsonValue(reader, valueFirstChar);
    } else if (parseKeys.has(key)) {
      room[key] = JSON.parse(readJsonValueRaw(reader, valueFirstChar));
    } else {
      skipJsonValue(reader, valueFirstChar);
    }
    const separator = reader.skipWhitespace();
    if (separator === "}") return room;
    if (separator !== ",") {
      throw new Error("Route C Matrix legacy room separator invalid");
    }
  }
}

function forEachTopLevelRoomMetadataEntry(path, callback) {
  const found = findTopLevelValue(path, "rooms", (reader, firstValueChar) => {
    if (firstValueChar !== "{") {
      throw new Error("Route C Matrix legacy JSON rooms must be an object");
    }
    while (true) {
      const char = reader.skipWhitespace();
      if (char === "}") return;
      reader.unreadChar(char);
      const roomId = readJsonString(reader);
      reader.expectChar(":");
      const firstRoomChar = reader.skipWhitespace();
      const room = readLegacyRoomMetadataValue(reader, firstRoomChar);
      migrationDiagnostics.snapshotStreamingEntryParseCount += 1;
      migrationDiagnostics.roomMetadataStreamingEntryParseCount += 1;
      callback(roomId, room);
      const separator = reader.skipWhitespace();
      if (separator === "}") return;
      if (separator !== ",") {
        throw new Error("Route C Matrix legacy JSON rooms separator invalid");
      }
    }
  });
  if (!found) {
    throw new Error("Route C Matrix legacy JSON missing rooms");
  }
}

function forEachJsonLine(path, callback) {
  if (!existsSync(path)) return;
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(MIGRATION_JSON_READ_CHUNK_BYTES);
  const decoder = new StringDecoder("utf8");
  let carry = "";
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      carry += decoder.write(buffer.subarray(0, bytesRead));
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) callback(trimmed);
      }
    }
    carry += decoder.end();
    const trimmed = carry.trim();
    if (trimmed) callback(trimmed);
  } finally {
    closeSync(fd);
  }
}

function validateLegacyStore(store) {
  if (!isObject(store)) throw new Error("Route C Matrix JSON store must be object");
  if (store.schema_version !== LEGACY_JSON_SCHEMA_VERSION) {
    throw new Error(
      `Route C Matrix JSON schema mismatch: ${store.schema_version || "missing"}`
    );
  }
  for (const key of ["rooms", "events_by_id", "txn_to_event_id"]) {
    if (!isObject(store[key])) {
      throw new Error(`Route C Matrix JSON store missing ${key}`);
    }
  }
  if (!Number.isInteger(store.next_stream_seq) || store.next_stream_seq < 1) {
    throw new Error("Route C Matrix JSON store next_stream_seq is invalid");
  }
}

function validateDeltaRecord(record) {
  if (!isObject(record)) throw new Error("Route C Matrix delta must be object");
  if (record.schema_version !== LEGACY_JSON_SCHEMA_VERSION) {
    throw new Error("Route C Matrix delta record store schema mismatch");
  }
  if (record.delta_schema_version !== LEGACY_DELTA_SCHEMA_VERSION) {
    throw new Error("Route C Matrix delta record schema mismatch");
  }
  if (!Array.isArray(record.created_rooms)) {
    throw new Error("Route C Matrix delta created_rooms must be array");
  }
  if (!Array.isArray(record.events)) {
    throw new Error("Route C Matrix delta events must be array");
  }
}

function applyDeltaRecord(store, record) {
  validateDeltaRecord(record);
  for (const room of record.created_rooms) {
    if (!room?.room_id) throw new Error("Route C Matrix delta room missing room_id");
    store.rooms[room.room_id] ||= room;
  }
  for (const entry of record.events) {
    if (!isObject(entry) || !isObject(entry.event) || !entry.txn_key) {
      throw new Error("Route C Matrix delta event entry is invalid");
    }
    const event = entry.event;
    const room = store.rooms[event.room_id];
    if (!room) {
      throw new Error(`Route C Matrix delta references missing room: ${event.room_id}`);
    }
    store.events_by_id[event.event_id] = event;
    store.txn_to_event_id[entry.txn_key] = event.event_id;
    if (!Array.isArray(room.event_ids)) room.event_ids = [];
    if (!room.event_ids.includes(event.event_id)) room.event_ids.push(event.event_id);
  }
  store.next_stream_seq = Math.max(store.next_stream_seq, record.next_stream_seq_after);
  store.updated_at = record.recorded_at || store.updated_at || new Date().toISOString();
}

function readLegacyStoreWithDelta(jsonStoragePath) {
  migrationDiagnostics.snapshotFullReadJsonParseCount += 1;
  throw new Error(
    `Route C Matrix legacy full snapshot parse is disabled for migration: ${jsonStoragePath}`
  );
}

function clearSqlite(db) {
  db.exec(`
    DELETE FROM matrix_event_search;
    DELETE FROM matrix_txn_map;
    DELETE FROM matrix_room_state;
    DELETE FROM matrix_events;
    DELETE FROM matrix_room_actors;
    DELETE FROM matrix_rooms;
    DELETE FROM matrix_schema_meta WHERE key NOT IN ('schema_name', 'schema_version');
  `);
}

function insertRoom(db, room) {
  if (!room?.room_id) throw new Error("Route C Matrix SQLite room missing room_id");
  const registry = isObject(room.routec_matrix_actor_registry)
    ? room.routec_matrix_actor_registry
    : {};
  db.prepare(
    `INSERT INTO matrix_rooms(
      room_id, host_session_id, host_agent_id, matrix_user_id,
      actor_registry_version, actor_registry_source_of_truth,
      committed_sender_truth, semantic_role_is_sender, created_at, created_at_ms
    ) VALUES (
      @room_id, @host_session_id, @host_agent_id, @matrix_user_id,
      @actor_registry_version, @actor_registry_source_of_truth,
      @committed_sender_truth, @semantic_role_is_sender, @created_at, @created_at_ms
    )
    ON CONFLICT(room_id) DO UPDATE SET
      host_session_id=excluded.host_session_id,
      host_agent_id=excluded.host_agent_id,
      matrix_user_id=excluded.matrix_user_id,
      actor_registry_version=excluded.actor_registry_version,
      actor_registry_source_of_truth=excluded.actor_registry_source_of_truth,
      committed_sender_truth=excluded.committed_sender_truth,
      semantic_role_is_sender=excluded.semantic_role_is_sender,
      created_at=excluded.created_at,
      created_at_ms=excluded.created_at_ms`
  ).run({
    room_id: room.room_id,
    host_session_id: String(room.host_session_id || ""),
    host_agent_id: String(room.host_agent_id || ""),
    matrix_user_id: String(room.matrix_user_id || ""),
    actor_registry_version: String(registry.registry_version || "unknown"),
    actor_registry_source_of_truth: String(registry.source_of_truth || "unknown"),
    committed_sender_truth: String(registry.committed_sender_truth || "matrix_event_sender"),
    semantic_role_is_sender: registry.semantic_role_is_sender === true ? 1 : 0,
    created_at: String(room.created_at || new Date().toISOString()),
    created_at_ms: Number.isFinite(room.created_at_ms) ? room.created_at_ms : Date.now(),
  });
  db.prepare("DELETE FROM matrix_room_actors WHERE room_id = ?").run(room.room_id);
  const insertActor = db.prepare(
    `INSERT INTO matrix_room_actors(
      room_id, actor_key, actor_kind, matrix_user_id, display_name,
      provider_id, membership, browser_send_allowed, sender_source
    ) VALUES (
      @room_id, @actor_key, @actor_kind, @matrix_user_id, @display_name,
      @provider_id, @membership, @browser_send_allowed, @sender_source
    )`
  );
  for (const actor of roomActorRows(room)) {
    insertActor.run(actor);
  }
}

function insertEvent(db, event, { isState = false, txnKey = null } = {}) {
  if (!event?.event_id || !event?.room_id || !event?.type || !event?.sender) {
    throw new Error("Route C Matrix SQLite event missing required identity");
  }
  const streamSeq = streamSeqForEvent(event);
  const searchText = searchableTextForEvent(event);
  db.prepare(
    `INSERT INTO matrix_events(
      event_id, room_id, type, sender, stream_seq, state_key, is_state,
      origin_server_ts, semantic_type, search_text, content_json, unsigned_json
    ) VALUES (
      @event_id, @room_id, @type, @sender, @stream_seq, @state_key, @is_state,
      @origin_server_ts, @semantic_type, @search_text, @content_json, @unsigned_json
    )
    ON CONFLICT(event_id) DO UPDATE SET
      room_id=excluded.room_id,
      type=excluded.type,
      sender=excluded.sender,
      stream_seq=excluded.stream_seq,
      state_key=excluded.state_key,
      is_state=excluded.is_state,
      origin_server_ts=excluded.origin_server_ts,
      semantic_type=excluded.semantic_type,
      search_text=excluded.search_text,
      content_json=excluded.content_json,
      unsigned_json=excluded.unsigned_json`
  ).run({
    event_id: event.event_id,
    room_id: event.room_id,
    type: event.type,
    sender: event.sender,
    stream_seq: streamSeq,
    state_key: isState ? event.state_key || "" : null,
    is_state: isState ? 1 : 0,
    origin_server_ts: Number.isFinite(event.origin_server_ts)
      ? event.origin_server_ts
      : Date.now(),
    semantic_type: semanticTypeForEvent(event),
    search_text: searchText,
    content_json: jsonString(event.content || {}, "event content"),
    unsigned_json: jsonString(event.unsigned || {}, "event unsigned"),
  });
  if (isState) {
    db.prepare(
      `INSERT INTO matrix_room_state(room_id, type, state_key, event_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, type, state_key) DO UPDATE SET event_id = excluded.event_id`
    ).run(event.room_id, event.type, event.state_key || "", event.event_id);
  } else {
    db.prepare(
      `INSERT INTO matrix_event_search(event_id, room_id, stream_seq, search_text)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         room_id=excluded.room_id,
         stream_seq=excluded.stream_seq,
         search_text=excluded.search_text`
    ).run(event.event_id, event.room_id, streamSeq, searchText);
  }
  if (txnKey) {
    const txn = splitTxnKey(txnKey);
    db.prepare(
      `INSERT INTO matrix_txn_map(room_id, event_type, txn_id, event_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, event_type, txn_id) DO UPDATE SET event_id = excluded.event_id`
    ).run(txn.room_id, txn.event_type, txn.txn_id, event.event_id);
  }
}

function storeCounts(db) {
  return {
    room_count: db.prepare("SELECT COUNT(*) AS count FROM matrix_rooms").get().count,
    timeline_event_count: db
      .prepare("SELECT COUNT(*) AS count FROM matrix_events WHERE is_state = 0")
      .get().count,
    state_event_count: db
      .prepare("SELECT COUNT(*) AS count FROM matrix_events WHERE is_state = 1")
      .get().count,
    actor_count: db.prepare("SELECT COUNT(*) AS count FROM matrix_room_actors").get()
      .count,
    txn_mapping_count: db.prepare("SELECT COUNT(*) AS count FROM matrix_txn_map").get()
      .count,
    latest_stream_seq:
      db.prepare("SELECT COALESCE(MAX(stream_seq), 0) AS seq FROM matrix_events").get()
        .seq + 1,
    search_row_count: db
      .prepare("SELECT COUNT(*) AS count FROM matrix_event_search")
      .get().count,
  };
}

function writeProof(proof, sqlitePath) {
  const proofPath = migrationProofPath(sqlitePath);
  writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n");
  lastMigrationProof = { ...proof, proof_path: proofPath };
  return lastMigrationProof;
}

function setSqliteMeta(db, key, value) {
  db.prepare(
    `INSERT INTO matrix_schema_meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function createMigrationSqliteBatcher(db) {
  let open = false;
  let pendingRows = 0;
  function begin() {
    if (!open) {
      db.exec("BEGIN IMMEDIATE");
      open = true;
      pendingRows = 0;
    }
  }
  function commit() {
    if (!open) return;
    db.exec("COMMIT");
    migrationDiagnostics.sqliteWriteBatchCommitCount += 1;
    open = false;
    pendingRows = 0;
  }
  function rollback() {
    if (!open) return;
    db.exec("ROLLBACK");
    open = false;
    pendingRows = 0;
  }
  return {
    run(fn, rowCount = 1) {
      begin();
      try {
        const result = fn();
        pendingRows += Math.max(1, rowCount);
        if (pendingRows >= MIGRATION_SQLITE_WRITE_BATCH_ROWS) commit();
        return result;
      } catch (err) {
        rollback();
        throw err;
      }
    },
    finish() {
      commit();
    },
    rollback,
  };
}

function insertStateEventsForRoom(db, room) {
  const stateEvents = isObject(room.state_events) ? room.state_events : {};
  for (const event of Object.values(stateEvents)) {
    insertEvent(db, event, { isState: true });
  }
}

function importLegacyJsonSnapshotIntoSQLiteStreaming(db, jsonStoragePath) {
  if (!existsSync(jsonStoragePath)) {
    throw new Error(`Route C Matrix legacy JSON source missing: ${jsonStoragePath}`);
  }
  const schemaVersion = readTopLevelJsonValue(jsonStoragePath, "schema_version");
  if (schemaVersion !== LEGACY_JSON_SCHEMA_VERSION) {
    throw new Error(
      `Route C Matrix JSON schema mismatch: ${schemaVersion || "missing"}`
    );
  }
  const createdAt = readTopLevelJsonValue(jsonStoragePath, "created_at");
  const updatedAt = readTopLevelJsonValue(jsonStoragePath, "updated_at");
  const nextStreamSeq = readTopLevelJsonValue(jsonStoragePath, "next_stream_seq");
  if (!Number.isInteger(nextStreamSeq) || nextStreamSeq < 1) {
    throw new Error("Route C Matrix JSON store next_stream_seq is invalid");
  }

  clearSqlite(db);
  const batcher = createMigrationSqliteBatcher(db);
  try {
    forEachTopLevelRoomMetadataEntry(jsonStoragePath, (roomId, room) => {
      if (room.room_id !== roomId) {
        throw new Error(`Route C Matrix JSON room key mismatch: ${roomId}`);
      }
      batcher.run(() => {
        insertRoom(db, room);
        insertStateEventsForRoom(db, room);
      });
    });
    forEachTopLevelObjectEntry(jsonStoragePath, "events_by_id", (eventId, event) => {
      if (!isObject(event) || event.event_id !== eventId) {
        throw new Error(`Route C Matrix JSON event key mismatch: ${eventId}`);
      }
      batcher.run(() => insertEvent(db, event, { isState: false }));
    });
    forEachTopLevelObjectEntry(jsonStoragePath, "txn_to_event_id", (txnKey, eventId) => {
      if (typeof eventId !== "string" || !eventId.trim()) {
        throw new Error(`Route C Matrix JSON txn mapping invalid: ${txnKey}`);
      }
      const txn = splitTxnKey(txnKey);
      batcher.run(() => {
        db.prepare(
          `INSERT INTO matrix_txn_map(room_id, event_type, txn_id, event_id)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(room_id, event_type, txn_id) DO UPDATE SET event_id = excluded.event_id`
        ).run(txn.room_id, txn.event_type, txn.txn_id, eventId);
      });
    });
    batcher.run(() => {
      setSqliteMeta(db, "created_at", createdAt);
      setSqliteMeta(db, "updated_at", updatedAt || new Date().toISOString());
      setSqliteMeta(db, "next_stream_seq", nextStreamSeq);
    });
    batcher.finish();
  } catch (err) {
    batcher.rollback();
    throw err;
  }
  return storeCounts(db);
}

function sqliteRoomExists(db, roomId) {
  return Boolean(
    db.prepare("SELECT 1 AS ok FROM matrix_rooms WHERE room_id = ?").get(roomId)
  );
}

function applyDeltaRecordToSQLite(db, record) {
  validateDeltaRecord(record);
  for (const room of record.created_rooms) {
    if (!room?.room_id) throw new Error("Route C Matrix delta room missing room_id");
    insertRoom(db, room);
    insertStateEventsForRoom(db, room);
  }
  for (const entry of record.events) {
    if (!isObject(entry) || !isObject(entry.event) || !entry.txn_key) {
      throw new Error("Route C Matrix delta event entry is invalid");
    }
    const event = entry.event;
    if (!sqliteRoomExists(db, event.room_id)) {
      throw new Error(`Route C Matrix delta references missing room: ${event.room_id}`);
    }
    insertEvent(db, event, { isState: false, txnKey: entry.txn_key });
  }
  const nextSeq = Math.max(nextStreamSeqFromDb(db), record.next_stream_seq_after);
  setSqliteMeta(db, "next_stream_seq", nextSeq);
  setSqliteMeta(db, "updated_at", record.recorded_at || new Date().toISOString());
}

function applyDeltaJsonlToSQLiteStreaming(db, deltaPath) {
  let deltaRecordCount = 0;
  forEachJsonLine(deltaPath, (line) => {
    migrationDiagnostics.deltaStreamingRecordParseCount += 1;
    const record = JSON.parse(line);
    applyDeltaRecordToSQLite(db, record);
    deltaRecordCount += 1;
  });
  return deltaRecordCount;
}

export function importLegacyStoreIntoSQLite(db, store) {
  validateLegacyStore(store);
  clearSqlite(db);
  const tx = db.transaction(() => {
    for (const room of Object.values(store.rooms)) {
      insertRoom(db, room);
      const stateEvents = isObject(room.state_events) ? room.state_events : {};
      for (const event of Object.values(stateEvents)) {
        insertEvent(db, event, { isState: true });
      }
    }
    for (const room of Object.values(store.rooms)) {
      const eventIds = Array.isArray(room.event_ids) ? room.event_ids : [];
      for (const eventId of eventIds) {
        const event = store.events_by_id[eventId];
        if (!event) {
          throw new Error(`Route C Matrix SQLite room references missing event: ${eventId}`);
        }
        const txnEntry = Object.entries(store.txn_to_event_id).find(
          ([, mappedEventId]) => mappedEventId === eventId
        );
        insertEvent(db, event, { isState: false, txnKey: txnEntry?.[0] || null });
      }
    }
    db.prepare(
      `INSERT INTO matrix_schema_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run("next_stream_seq", String(store.next_stream_seq));
    db.prepare(
      `INSERT INTO matrix_schema_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run("updated_at", String(store.updated_at || new Date().toISOString()));
  });
  tx();
  return storeCounts(db);
}

function migrateJsonToSQLite({ jsonStoragePath, sqlitePath }) {
  const sourceBefore = fileSignature(jsonStoragePath);
  const deltaPath = `${jsonStoragePath}.delta.jsonl`;
  const deltaBefore = fileSignature(deltaPath);
  const startedAt = new Date().toISOString();
  const lock = acquireMigrationLock(sqlitePath, jsonStoragePath);
  const tempPath = `${sqlitePath}.tmp-${process.pid}-${Date.now()}`;
  let db = null;
  try {
    db = openDatabase(tempPath);
    importLegacyJsonSnapshotIntoSQLiteStreaming(db, jsonStoragePath);
    const deltaRecordCount = applyDeltaJsonlToSQLiteStreaming(db, deltaPath);
    const sourceAfter = fileSignature(jsonStoragePath);
    const deltaAfter = fileSignature(deltaPath);
    if (
      sourceBefore.exists &&
      (sourceBefore.size !== sourceAfter.size ||
        sourceBefore.mtimeMs !== sourceAfter.mtimeMs)
    ) {
      throw new Error("Route C Matrix JSON source changed during migration");
    }
    if (
      deltaBefore.exists &&
      (deltaBefore.size !== deltaAfter.size ||
        deltaBefore.mtimeMs !== deltaAfter.mtimeMs)
    ) {
      throw new Error("Route C Matrix delta source changed during migration");
    }
    const counts = storeCounts(db);
    db.close();
    db = null;
    renameSync(tempPath, sqlitePath);
    const target = fileSignature(sqlitePath);
    return writeProof(
      {
        schema_version: "routec.matrix_sqlite_migration_proof.v1",
        status: "completed",
        storage_mode: "sqlite",
        sqlite_schema_version: MATRIX_SQLITE_SCHEMA_VERSION,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        source_json: sourceBefore,
        source_delta: deltaBefore,
        target_sqlite: target,
        migrated_counts: counts,
        migration_import_mode: migrationDiagnostics.snapshotImportMode,
        room_import_mode: migrationDiagnostics.roomImportMode,
        delta_import_mode: migrationDiagnostics.deltaImportMode,
        delta_record_count: deltaRecordCount,
        snapshot_full_read_json_parse_used: false,
        room_event_ids_array_skipped_count:
          migrationDiagnostics.roomEventIdsArraySkippedCount,
        skipped_json_value_mode: migrationDiagnostics.skippedJsonValueMode,
        non_allocating_json_skip_count:
          migrationDiagnostics.nonAllocatingJsonSkipCount,
        non_allocating_json_skip_char_count:
          migrationDiagnostics.nonAllocatingJsonSkipCharCount,
        sqlite_write_batch_commit_count:
          migrationDiagnostics.sqliteWriteBatchCommitCount,
        sqlite_write_batch_rows: MIGRATION_SQLITE_WRITE_BATCH_ROWS,
        read_chunk_bytes: MIGRATION_JSON_READ_CHUNK_BYTES,
      },
      sqlitePath
    );
  } catch (err) {
    if (db) db.close();
    if (existsSync(tempPath)) unlinkSync(tempPath);
    const proof = writeProof(
      {
        schema_version: "routec.matrix_sqlite_migration_proof.v1",
        status: "failed",
        storage_mode: "sqlite",
        sqlite_schema_version: MATRIX_SQLITE_SCHEMA_VERSION,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        source_json: sourceBefore,
        source_delta: deltaBefore,
        target_sqlite_path: sqlitePath,
        error: err?.message || String(err),
      },
      sqlitePath
    );
    throw new Error(`Route C Matrix SQLite migration failed: ${proof.error}`);
  } finally {
    releaseMigrationLock(lock);
  }
}

export function getRouteCMatrixSQLiteStoragePath(jsonStoragePath) {
  return sqlitePathForJsonPath(jsonStoragePath);
}

export function getLastRouteCMatrixSQLiteMigrationProof() {
  return lastMigrationProof;
}

export function getRouteCMatrixSQLiteMigrationDiagnosticsForTest() {
  return { ...migrationDiagnostics };
}

export function resetRouteCMatrixSQLiteMigrationDiagnosticsForTest() {
  migrationDiagnostics.snapshotFullReadJsonParseCount = 0;
  migrationDiagnostics.snapshotStreamingEntryParseCount = 0;
  migrationDiagnostics.roomMetadataStreamingEntryParseCount = 0;
  migrationDiagnostics.roomEventIdsArraySkippedCount = 0;
  migrationDiagnostics.nonAllocatingJsonSkipCount = 0;
  migrationDiagnostics.nonAllocatingJsonSkipCharCount = 0;
  migrationDiagnostics.sqliteWriteBatchCommitCount = 0;
  migrationDiagnostics.deltaStreamingRecordParseCount = 0;
  migrationDiagnostics.readinessFullFileSignatureCount = 0;
  migrationDiagnostics.readinessMetadataOnlySignatureCount = 0;
}

function migrationLockStatus(sqlitePath) {
  const path = lockPath(sqlitePath);
  if (!existsSync(path)) return { exists: false, path, path_hash: sha256(path) };
  const stats = statSync(path);
  let lock = {};
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    lock = {};
  }
  const pid = Number(lock.pid);
  const pidAlive =
    Number.isInteger(pid) && pid > 0
      ? (() => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        })()
      : false;
  const ageMs = Date.now() - stats.mtimeMs;
  return {
    exists: true,
    path,
    path_hash: sha256(path),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    age_ms: ageMs,
    stale: ageMs >= MIGRATION_LOCK_STALE_MS && !pidAlive,
    pid_alive: pidAlive,
    pid: Number.isInteger(pid) ? pid : null,
    started_at: typeof lock.started_at === "string" ? lock.started_at : null,
    target_path: typeof lock.target_path === "string" ? lock.target_path : null,
  };
}

function pendingMigrationReadiness({ jsonStoragePath, sqlitePath }) {
  const sourceJson = fileReadinessMetadata(jsonStoragePath);
  const sourceDelta = fileReadinessMetadata(`${jsonStoragePath}.delta.jsonl`);
  const lock = migrationLockStatus(sqlitePath);
  return {
    storage_mode: "sqlite",
    storage_ready: false,
    readiness_metadata_only: true,
    migration_proof_hashing_deferred: true,
    migration_readiness_source: "bounded_stat_metadata_path_hash",
    sqlite_schema_version: MATRIX_SQLITE_SCHEMA_VERSION,
    sqlite_schema_name: MATRIX_SQLITE_SCHEMA_NAME,
    sqlite_storage_path: sqlitePath,
    sqlite_storage_exists: existsSync(sqlitePath),
    legacy_json_path: jsonStoragePath,
    legacy_delta_path: `${jsonStoragePath}.delta.jsonl`,
    legacy_json_preserved: sourceJson.exists,
    legacy_delta_preserved: sourceDelta.exists,
    migration_status: lock.exists
      ? lock.stale
        ? "migration_interrupted_stale_lock_retry_required"
        : "migration_in_progress_or_locked"
      : "migration_required",
    migration_lock: lock,
    migration_proof_path: migrationProofPath(sqlitePath),
    migration_proof_summary: null,
    source_json: sourceJson,
    source_delta: sourceDelta,
    room_count: 0,
    timeline_event_count: 0,
    state_event_count: 0,
    actor_count: 0,
    txn_mapping_count: 0,
    latest_stream_seq: 0,
    search_row_count: 0,
  };
}

export function openRouteCMatrixSQLiteStore({ jsonStoragePath }) {
  const sqlitePath = sqlitePathForJsonPath(jsonStoragePath);
  if (!existsSync(sqlitePath) && existsSync(jsonStoragePath)) {
    migrateJsonToSQLite({ jsonStoragePath, sqlitePath });
  }
  if (!existsSync(sqlitePath)) {
    const db = openDatabase(sqlitePath);
    const counts = storeCounts(db);
    writeProof(
      {
        schema_version: "routec.matrix_sqlite_migration_proof.v1",
        status: "fresh_empty_sqlite_created",
        storage_mode: "sqlite",
        sqlite_schema_version: MATRIX_SQLITE_SCHEMA_VERSION,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        source_json: fileSignature(jsonStoragePath),
        source_delta: fileSignature(`${jsonStoragePath}.delta.jsonl`),
        target_sqlite: fileSignature(sqlitePath),
        migrated_counts: counts,
      },
      sqlitePath
    );
    db.close();
  }
  const cached = dbCache.get(sqlitePath);
  if (cached?.open) return cached;
  const db = openDatabase(sqlitePath);
  dbCache.set(sqlitePath, db);
  return db;
}

export function exportSQLiteStoreObject(db) {
  assertSchemaCompatible(db);
  const rooms = {};
  const roomRows = db.prepare("SELECT * FROM matrix_rooms ORDER BY room_id").all();
  const actorStmt = db.prepare(
    "SELECT * FROM matrix_room_actors WHERE room_id = ? ORDER BY actor_key"
  );
  const stateStmt = db.prepare(
    "SELECT * FROM matrix_events WHERE room_id = ? AND is_state = 1 ORDER BY type, state_key"
  );
  for (const row of roomRows) {
    rooms[row.room_id] = normalizeRoom(
      row,
      actorStmt.all(row.room_id),
      stateStmt.all(row.room_id).map(eventFromRow)
    );
  }
  const events_by_id = {};
  const eventRows = db
    .prepare("SELECT * FROM matrix_events WHERE is_state = 0 ORDER BY stream_seq")
    .all();
  for (const row of eventRows) {
    const event = eventFromRow(row);
    events_by_id[event.event_id] = event;
    if (rooms[event.room_id]) rooms[event.room_id].event_ids.push(event.event_id);
  }
  const txn_to_event_id = {};
  for (const row of db.prepare("SELECT * FROM matrix_txn_map").all()) {
    txn_to_event_id[[row.room_id, row.event_type, row.txn_id].join("\u001f")] =
      row.event_id;
  }
  const nextStreamSeqMeta = Number(
    db.prepare("SELECT value FROM matrix_schema_meta WHERE key = ?").get("next_stream_seq")
      ?.value
  );
  const nextFromRows =
    db.prepare("SELECT COALESCE(MAX(stream_seq), 0) + 1 AS seq FROM matrix_events").get()
      .seq || 1;
  return {
    schema_version: LEGACY_JSON_SCHEMA_VERSION,
    created_at:
      db.prepare("SELECT value FROM matrix_schema_meta WHERE key = ?").get("created_at")
        ?.value || new Date(0).toISOString(),
    updated_at:
      db.prepare("SELECT value FROM matrix_schema_meta WHERE key = ?").get("updated_at")
        ?.value || new Date().toISOString(),
    next_stream_seq:
      Number.isSafeInteger(nextStreamSeqMeta) && nextStreamSeqMeta >= nextFromRows
        ? nextStreamSeqMeta
        : nextFromRows,
    rooms,
    events_by_id,
    txn_to_event_id,
  };
}

export function readRouteCMatrixSQLiteNextStreamSeq(db) {
  assertSchemaCompatible(db);
  return nextStreamSeqFromDb(db);
}

export function readRouteCMatrixSQLiteRoom(db, { binding = null, roomId = null }) {
  assertSchemaCompatible(db);
  const effectiveRoomId = roomId || binding?.matrix_room_id;
  if (!effectiveRoomId) {
    throw new Error("Route C Matrix SQLite room read requires room id");
  }
  const row = db.prepare("SELECT * FROM matrix_rooms WHERE room_id = ?").get(effectiveRoomId);
  if (!row) return null;
  if (binding && row.host_session_id !== binding.host_session_id) {
    throw new Error(
      "Route C Matrix SQLite room is already bound to a different Host session"
    );
  }
  const actorRows = db
    .prepare("SELECT * FROM matrix_room_actors WHERE room_id = ? ORDER BY actor_key")
    .all(effectiveRoomId);
  const stateRows = db
    .prepare("SELECT e.* FROM matrix_room_state s JOIN matrix_events e ON e.event_id = s.event_id WHERE s.room_id = ? ORDER BY s.type, s.state_key")
    .all(effectiveRoomId);
  return normalizeRoom(row, actorRows, stateRows.map(eventFromRow));
}

export function upsertRouteCMatrixSQLiteRoom(db, room) {
  assertSchemaCompatible(db);
  insertRoom(db, room);
  return readRouteCMatrixSQLiteRoom(db, { roomId: room.room_id });
}

export function readRouteCMatrixSQLiteEvent(db, { roomId, eventId, includeState = false }) {
  assertSchemaCompatible(db);
  if (!roomId || !eventId) {
    throw new Error("Route C Matrix SQLite event read requires room id and event id");
  }
  const row = db
    .prepare(
      `SELECT * FROM matrix_events
       WHERE room_id = ? AND event_id = ? AND (? = 1 OR is_state = 0)`
    )
    .get(roomId, eventId, includeState ? 1 : 0);
  return row ? eventFromRow(row) : null;
}

export function readRouteCMatrixSQLiteContiguousSemanticEvents(
  db,
  { roomId, eventId, semanticTypes }
) {
  assertSchemaCompatible(db);
  if (!roomId || !eventId) {
    throw new Error(
      "Route C Matrix SQLite semantic run read requires room id and event id"
    );
  }
  const normalizedSemanticTypes = [
    ...new Set(
      (Array.isArray(semanticTypes) ? semanticTypes : [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    ),
  ];
  if (normalizedSemanticTypes.length === 0) {
    throw new Error(
      "Route C Matrix SQLite semantic run read requires semantic types"
    );
  }

  const anchor = db
    .prepare(
      `SELECT stream_seq, semantic_type
       FROM matrix_events
       WHERE room_id = ? AND event_id = ? AND is_state = 0`
    )
    .get(roomId, eventId);
  if (!anchor) return null;
  if (!normalizedSemanticTypes.includes(anchor.semantic_type)) return [];

  const placeholders = normalizedSemanticTypes.map(() => "?").join(", ");
  const previousBoundary = db
    .prepare(
      `SELECT MAX(stream_seq) AS boundary_seq
       FROM matrix_events
       WHERE room_id = ? AND is_state = 0 AND stream_seq < ?
         AND (semantic_type IS NULL OR semantic_type NOT IN (${placeholders}))`
    )
    .get(roomId, anchor.stream_seq, ...normalizedSemanticTypes).boundary_seq;
  const nextBoundary = db
    .prepare(
      `SELECT MIN(stream_seq) AS boundary_seq
       FROM matrix_events
       WHERE room_id = ? AND is_state = 0 AND stream_seq > ?
         AND (semantic_type IS NULL OR semantic_type NOT IN (${placeholders}))`
    )
    .get(roomId, anchor.stream_seq, ...normalizedSemanticTypes).boundary_seq;

  const where = [
    "room_id = ?",
    "is_state = 0",
    `semantic_type IN (${placeholders})`,
  ];
  const params = [roomId, ...normalizedSemanticTypes];
  if (previousBoundary !== null) {
    where.push("stream_seq > ?");
    params.push(previousBoundary);
  }
  if (nextBoundary !== null) {
    where.push("stream_seq < ?");
    params.push(nextBoundary);
  }
  return db
    .prepare(
      `SELECT * FROM matrix_events
       WHERE ${where.join(" AND ")}
       ORDER BY stream_seq ASC`
    )
    .all(...params)
    .map(eventFromRow);
}

export function readRouteCMatrixSQLiteStateEvent(
  db,
  { roomId, type = MATRIX_ROOM_PINNED_EVENTS_STATE_TYPE, stateKey = "" }
) {
  assertSchemaCompatible(db);
  const row = db
    .prepare(
      `SELECT e.*
       FROM matrix_room_state s
       JOIN matrix_events e ON e.event_id = s.event_id
       WHERE s.room_id = ? AND s.type = ? AND s.state_key = ?`
    )
    .get(roomId, type, stateKey);
  return row ? eventFromRow(row) : null;
}

export function writeRouteCMatrixSQLiteEvent(
  db,
  { event, txnKey = null, isState = false, nextStreamSeq = null }
) {
  assertSchemaCompatible(db);
  insertEvent(db, event, { isState, txnKey });
  if (nextStreamSeq !== null) {
    setNextStreamSeq(db, nextStreamSeq);
  }
  return event;
}

export function readRouteCMatrixSQLiteTxnEventId(
  db,
  { roomId, eventType, txnId }
) {
  assertSchemaCompatible(db);
  const row = db
    .prepare(
      `SELECT event_id FROM matrix_txn_map
       WHERE room_id = ? AND event_type = ? AND txn_id = ?`
    )
    .get(roomId, eventType, txnId);
  return row?.event_id || null;
}

export function insertRouteCMatrixSQLiteTxnMapping(
  db,
  { roomId, eventType, txnId, eventId }
) {
  assertSchemaCompatible(db);
  db.prepare(
    `INSERT INTO matrix_txn_map(room_id, event_type, txn_id, event_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(room_id, event_type, txn_id) DO UPDATE SET event_id = excluded.event_id`
  ).run(roomId, eventType, txnId, eventId);
}

export function readRouteCMatrixSQLiteTimelineStats(db, { roomId }) {
  assertSchemaCompatible(db);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(MIN(stream_seq), 0) AS earliest_stream_seq,
              COALESCE(MAX(stream_seq), 0) AS latest_stream_seq
       FROM matrix_events
       WHERE room_id = ? AND is_state = 0`
    )
    .get(roomId);
  return {
    count: row.count,
    earliest_stream_seq: row.earliest_stream_seq,
    latest_stream_seq: row.latest_stream_seq,
  };
}

export function readRouteCMatrixSQLiteLatestTimelineSeq(db, { roomId }) {
  assertSchemaCompatible(db);
  if (!roomId) {
    throw new Error("Route C Matrix latest timeline seq read requires room id");
  }
  const row = db
    .prepare(
      `SELECT stream_seq
       FROM matrix_events
       WHERE room_id = ? AND is_state = 0
       ORDER BY stream_seq DESC
       LIMIT 1`,
    )
    .get(roomId);
  return Number.isSafeInteger(row?.stream_seq) ? row.stream_seq : 0;
}

export function readRouteCMatrixSQLiteLatestPreviewRows(
  db,
  { roomId, limit = 20 },
) {
  assertSchemaCompatible(db);
  if (!roomId) {
    throw new Error("Route C Matrix latest preview read requires room id");
  }
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  return db
    .prepare(
      `SELECT event_id,
              room_id,
              type,
              sender,
              stream_seq,
              origin_server_ts,
              semantic_type,
              json_extract(content_json, '$.body') AS body,
              json_extract(content_json, '$.filename') AS filename,
              json_extract(
                content_json,
                '$."org.oysterun.semantic.v1".tool_summary'
              ) AS tool_summary
       FROM matrix_events
       WHERE room_id = ? AND is_state = 0
       ORDER BY stream_seq DESC
       LIMIT ?`,
    )
    .all(roomId, normalizedLimit);
}

export function readRouteCMatrixSQLiteTimelineEvents(
  db,
  {
    roomId,
    beforeSeq = null,
    atOrAfterSeq = null,
    afterSeq = null,
    atOrBeforeSeq = null,
    limit = 100,
    order = "asc",
    sender = null,
    type = null,
  }
) {
  assertSchemaCompatible(db);
  const normalizedLimit = Math.max(0, Math.min(Number(limit) || 0, 20_000));
  const { where, params } = timelineWhereClause({
    roomId,
    beforeSeq,
    atOrAfterSeq,
    afterSeq,
    atOrBeforeSeq,
    sender,
    type,
  });
  const orderSql = order === "desc" ? "DESC" : "ASC";
  return db
    .prepare(
      `SELECT * FROM matrix_events
       WHERE ${where}
       ORDER BY stream_seq ${orderSql}
       LIMIT @limit`
    )
    .all({ ...params, limit: normalizedLimit })
    .map(eventFromRow);
}

export function countRouteCMatrixSQLiteTimelineEvents(
  db,
  {
    roomId,
    beforeSeq = null,
    atOrAfterSeq = null,
    afterSeq = null,
    atOrBeforeSeq = null,
    sender = null,
    type = null,
  }
) {
  assertSchemaCompatible(db);
  const { where, params } = timelineWhereClause({
    roomId,
    beforeSeq,
    atOrAfterSeq,
    afterSeq,
    atOrBeforeSeq,
    sender,
    type,
  });
  return db.prepare(`SELECT COUNT(*) AS count FROM matrix_events WHERE ${where}`).get(params)
    .count;
}

export function readRouteCMatrixSQLiteMessagesWindow(
  db,
  { roomId, direction, startSeq, toSeq = null, limit }
) {
  assertSchemaCompatible(db);
  if (direction === "b") {
    const chunk = readRouteCMatrixSQLiteTimelineEvents(db, {
      roomId,
      beforeSeq: startSeq,
      atOrAfterSeq: toSeq,
      order: "desc",
      limit,
    });
    const candidateEventCount = countRouteCMatrixSQLiteTimelineEvents(db, {
      roomId,
      beforeSeq: startSeq,
      atOrAfterSeq: toSeq,
    });
    return { chunk, candidateEventCount };
  }
  const chunk = readRouteCMatrixSQLiteTimelineEvents(db, {
    roomId,
    atOrAfterSeq: startSeq,
    beforeSeq: toSeq,
    order: "asc",
    limit,
  });
  const candidateEventCount = countRouteCMatrixSQLiteTimelineEvents(db, {
    roomId,
    atOrAfterSeq: startSeq,
    beforeSeq: toSeq,
  });
  return { chunk, candidateEventCount };
}

export function readRouteCMatrixSQLiteSyncTimeline(
  db,
  { roomId, sinceSeq = null, limit }
) {
  assertSchemaCompatible(db);
  const totalBoundRoomEventCount = readRouteCMatrixSQLiteTimelineStats(db, {
    roomId,
  }).count;
  if (sinceSeq !== null) {
    const totalIncrementalEventCount = countRouteCMatrixSQLiteTimelineEvents(db, {
      roomId,
      atOrAfterSeq: sinceSeq,
    });
    return {
      totalBoundRoomEventCount,
      totalIncrementalEventCount,
      events: readRouteCMatrixSQLiteTimelineEvents(db, {
        roomId,
        atOrAfterSeq: sinceSeq,
        order: "desc",
        limit,
      }).reverse(),
    };
  }
  return {
    totalBoundRoomEventCount,
    totalIncrementalEventCount: null,
    events: readRouteCMatrixSQLiteTimelineEvents(db, {
      roomId,
      order: "desc",
      limit,
    }).reverse(),
  };
}

export function readRouteCMatrixSQLiteContextWindow(
  db,
  { roomId, eventId, beforeLimit, afterLimit }
) {
  assertSchemaCompatible(db);
  const target = readRouteCMatrixSQLiteEvent(db, { roomId, eventId });
  if (!target) return null;
  const targetSeq = streamSeqForEvent(target);
  return {
    target,
    before: readRouteCMatrixSQLiteTimelineEvents(db, {
      roomId,
      beforeSeq: targetSeq,
      order: "desc",
      limit: beforeLimit,
    }),
    after: readRouteCMatrixSQLiteTimelineEvents(db, {
      roomId,
      afterSeq: targetSeq,
      order: "asc",
      limit: afterLimit,
    }),
    totalBoundRoomEventCount: readRouteCMatrixSQLiteTimelineStats(db, { roomId }).count,
  };
}

export function searchRouteCMatrixSQLiteEvents(
  db,
  { roomId, searchTermLower, nextBatchSeq = null, senderFilter = null, limit }
) {
  assertSchemaCompatible(db);
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 1, 20_000));
  const clauses = ["s.room_id = @roomId", "e.is_state = 0", "s.search_text LIKE @pattern"];
  const params = {
    roomId,
    pattern: `%${String(searchTermLower).toLowerCase()}%`,
    limit: normalizedLimit,
  };
  if (nextBatchSeq !== null) {
    clauses.push("s.stream_seq < @nextBatchSeq");
    params.nextBatchSeq = nextBatchSeq;
  }
  if (Array.isArray(senderFilter) && senderFilter.length > 0) {
    senderFilter.forEach((sender, index) => {
      params[`sender${index}`] = sender;
    });
    clauses.push(
      `e.sender IN (${senderFilter.map((_, index) => `@sender${index}`).join(", ")})`
    );
  }
  const where = clauses.join(" AND ");
  const rows = db
    .prepare(
      `SELECT e.*
       FROM matrix_event_search s
       JOIN matrix_events e ON e.event_id = s.event_id
       WHERE ${where}
       ORDER BY s.stream_seq DESC
       LIMIT @limit`
    )
    .all(params)
    .map(eventFromRow);
  const count = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM matrix_event_search s
       JOIN matrix_events e ON e.event_id = s.event_id
       WHERE ${where}`
    )
    .get(params).count;
  return { events: rows, count };
}

export function replaceSQLiteStoreFromLegacyObject(db, store) {
  return importLegacyStoreIntoSQLite(db, store);
}

export function runRouteCMatrixSQLiteTransaction(db, fn) {
  return db.transaction(fn)();
}

export function getRouteCMatrixSQLiteStorageHealth({
  jsonStoragePath,
  migrateIfNeeded = false,
} = {}) {
  const sqlitePath = sqlitePathForJsonPath(jsonStoragePath);
  if (!existsSync(sqlitePath) && existsSync(jsonStoragePath) && !migrateIfNeeded) {
    return pendingMigrationReadiness({ jsonStoragePath, sqlitePath });
  }
  const db = openRouteCMatrixSQLiteStore({ jsonStoragePath });
  const counts = storeCounts(db);
  const proofPath = migrationProofPath(sqlitePath);
  const migrationProof = existsSync(proofPath)
    ? JSON.parse(readFileSync(proofPath, "utf8"))
    : lastMigrationProof;
  return {
    storage_mode: "sqlite",
    storage_ready: true,
    sqlite_schema_version: MATRIX_SQLITE_SCHEMA_VERSION,
    sqlite_schema_name: MATRIX_SQLITE_SCHEMA_NAME,
    sqlite_storage_path: sqlitePath,
    sqlite_storage_exists: existsSync(sqlitePath),
    legacy_json_path: jsonStoragePath,
    legacy_delta_path: `${jsonStoragePath}.delta.jsonl`,
    legacy_json_preserved: existsSync(jsonStoragePath),
    legacy_delta_preserved: existsSync(`${jsonStoragePath}.delta.jsonl`),
    migration_status: migrationProof?.status || "validated_existing_sqlite",
    migration_proof_path: proofPath,
    migration_proof_summary: migrationProof
      ? {
          status: migrationProof.status,
          started_at: migrationProof.started_at,
          completed_at: migrationProof.completed_at,
          migrated_counts: migrationProof.migrated_counts || null,
        }
      : null,
    ...counts,
  };
}

export function routeCMatrixSQLiteSchemaIntrospection({ jsonStoragePath }) {
  const db = openRouteCMatrixSQLiteStore({ jsonStoragePath });
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE 'matrix_%' ORDER BY name"
    )
    .all();
  const indexes = db
    .prepare(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_matrix_%' ORDER BY name"
    )
    .all();
  const columns = Object.fromEntries(
    tables.map((table) => [
      table.name,
      db.prepare(`PRAGMA table_info(${table.name})`).all().map((row) => row.name),
    ])
  );
  return {
    sqlite_schema_version: MATRIX_SQLITE_SCHEMA_VERSION,
    tables,
    indexes,
    columns,
  };
}
