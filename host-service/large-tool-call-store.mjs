import { createHash } from "crypto";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import Database from "better-sqlite3";

export const ROUTEC_TOOL_STORAGE_GENERATION_LEGACY =
  "legacy_p142_matrix_retained";
export const ROUTEC_TOOL_STORAGE_GENERATION_SQLITE = "sqlite_continuation_v1";
export const ROUTEC_MATRIX_RETAINED_TOOL_EVENT_COUNT = 1;
// Compatibility name for the semantic bridge. The P017 contract retains one event.
export const ROUTEC_LARGE_TOOL_EVENT_THRESHOLD =
  ROUTEC_MATRIX_RETAINED_TOOL_EVENT_COUNT;
export const ROUTEC_TOOL_CONTINUATION_PAGE_SIZE = 10;
export const ROUTEC_LARGE_TOOL_INDEX_SCHEMA_VERSION =
  "routec.tool_event_continuation_sqlite.v2";
export const ROUTEC_LARGE_TOOL_EVENT_SCHEMA_VERSION =
  "routec.large_tool_event.v1";

const SQLITE_FILE_NAME = "routec-tool-events.sqlite";
const SQLITE_SCHEMA_NAME = "routec.tool_event_continuation_sqlite.v2";
const SQLITE_SCHEMA_VERSION = 2;
const RECOVERY_TABLE_NAME = "tool_event_continuations_recovery_v1";
const TOOL_SEMANTIC_TYPES = new Set([
  "tool.call",
  "tool.update",
  "tool.output",
  "tool.result",
  "tool.failure",
]);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function cloneJson(value, label) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error(`${label} is not JSON serializable`);
  }
  return JSON.parse(encoded);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  return JSON.parse(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function requireStorageGeneration(value) {
  const generation = normalizeString(value);
  if (generation !== ROUTEC_TOOL_STORAGE_GENERATION_SQLITE) {
    throw new Error(
      `tool storage generation must be ${ROUTEC_TOOL_STORAGE_GENERATION_SQLITE}`
    );
  }
  return generation;
}

function requireIdentity(identity) {
  const normalized = {
    source_host_session_id: normalizeString(identity?.source_host_session_id),
    source_matrix_room_id: normalizeString(identity?.source_matrix_room_id),
    provider_turn_id: normalizeString(identity?.provider_turn_id),
    target_turn_id: normalizeString(identity?.target_turn_id),
    grouping_key: normalizeString(identity?.grouping_key),
    grouping_key_kind: normalizeString(identity?.grouping_key_kind),
    consecutive_run_index: normalizePositiveInteger(
      identity?.consecutive_run_index
    ),
    storage_generation: requireStorageGeneration(identity?.storage_generation),
  };
  if (
    !normalized.source_host_session_id ||
    !normalized.source_matrix_room_id ||
    !normalized.grouping_key ||
    !normalized.grouping_key_kind ||
    !normalized.consecutive_run_index
  ) {
    throw new Error("tool run identity is incomplete");
  }
  return normalized;
}

function buildRunRef(identity, firstMatrixEventId) {
  return `ltc_${sha256(
    [
      identity.storage_generation,
      identity.source_host_session_id,
      identity.source_matrix_room_id,
      firstMatrixEventId,
      identity.provider_turn_id || "",
      identity.target_turn_id || "",
      identity.grouping_key_kind,
      identity.grouping_key,
      identity.consecutive_run_index,
    ].join("\u001f")
  ).slice(0, 24)}`;
}

function buildEventKey({ event, semanticType, toolEventIndex }) {
  const delivery = event?.routec_matrix_delivery || {};
  return sha256(
    [
      semanticType,
      normalizePositiveInteger(delivery.provider_runtime_event_index) ||
        normalizePositiveInteger(event?.provider_runtime_event_index) ||
        toolEventIndex,
      normalizeString(delivery.source_user_event_id) || "",
      normalizeString(event?.tool_call_id) ||
        normalizeString(event?.call_id) ||
        normalizeString(event?.id) ||
        "",
    ].join("\u001f")
  );
}

function toolPayload(event, semanticType) {
  if (semanticType === "tool.call") {
    return event?.tool_input ?? event?.input ?? null;
  }
  if (semanticType === "tool.update") {
    const input = event?.tool_input ?? event?.input ?? null;
    const content =
      event?.tool_content ??
      event?.content ??
      event?.output ??
      event?.text ??
      null;
    if (input !== null && content !== null) return { input, content };
    return input ?? content;
  }
  return (
    event?.tool_content ??
    event?.content ??
    event?.output ??
    event?.error ??
    event?.text ??
    null
  );
}

function tableExists(db, tableName) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );
}

function tableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return new Set();
  return new Set(
    db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((row) => row.name)
  );
}

function indexMatches(db, indexName, { unique, columns }) {
  const indexList = db
    .prepare("PRAGMA index_list(tool_runs)")
    .all()
    .find((row) => row.name === indexName);
  if (!indexList || Boolean(indexList.unique) !== unique) return false;
  const actualColumns = db
    .prepare(`PRAGMA index_info(${indexName})`)
    .all()
    .map((row) => row.name);
  return (
    actualColumns.length === columns.length &&
    actualColumns.every((column, position) => column === columns[position])
  );
}

function databaseIsWriteReady(db) {
  if (
    !tableExists(db, "tool_event_store_meta") ||
    !tableExists(db, "tool_runs") ||
    !tableExists(db, "tool_event_continuations")
  ) {
    return false;
  }
  const getMeta = db.prepare(
    "SELECT value FROM tool_event_store_meta WHERE key = ?"
  );
  return (
    getMeta.get("schema_name")?.value === SQLITE_SCHEMA_NAME &&
    Number(getMeta.get("schema_version")?.value) === SQLITE_SCHEMA_VERSION &&
    getMeta.get("migration_state")?.value === "complete" &&
    getMeta.get("write_generation")?.value ===
      ROUTEC_TOOL_STORAGE_GENERATION_SQLITE &&
    tableColumns(db, "tool_event_continuations").has("storage_generation") &&
    indexMatches(db, "idx_tool_runs_grouping", {
      unique: true,
      columns: [
        "storage_generation",
        "source_host_session_id",
        "source_matrix_room_id",
        "grouping_key_kind",
        "grouping_key",
        "consecutive_run_index",
      ],
    })
  );
}

function initializeDatabase(db, { onBeforeMigrationCommit = null } = {}) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (databaseIsWriteReady(db)) return;

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_event_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const oldColumns = tableColumns(db, "tool_event_continuations");
    if (oldColumns.size > 0 && !oldColumns.has("storage_generation")) {
      if (tableExists(db, RECOVERY_TABLE_NAME)) {
        throw new Error(
          "tool event SQLite cutover found both active v1 and recovery tables"
        );
      }
      db.exec(
        `ALTER TABLE tool_event_continuations RENAME TO ${RECOVERY_TABLE_NAME}`
      );
      db.exec(`
        DROP INDEX IF EXISTS idx_tool_event_continuations_session_room;
        DROP INDEX IF EXISTS idx_tool_event_continuations_retained_event;
        DROP INDEX IF EXISTS idx_tool_event_continuations_provider_turn;
        DROP INDEX IF EXISTS idx_tool_event_continuations_grouping;
      `);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_runs (
        run_ref TEXT PRIMARY KEY,
        storage_generation TEXT NOT NULL,
        source_host_session_id TEXT NOT NULL,
        source_matrix_room_id TEXT NOT NULL,
        first_retained_matrix_event_id TEXT NOT NULL,
        provider TEXT,
        provider_turn_id TEXT,
        target_turn_id TEXT,
        grouping_key TEXT NOT NULL,
        grouping_key_kind TEXT NOT NULL,
        consecutive_run_index INTEGER NOT NULL,
        run_state TEXT NOT NULL,
        last_tool_event_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        UNIQUE(
          storage_generation,
          source_host_session_id,
          source_matrix_room_id,
          first_retained_matrix_event_id
        )
      );
      CREATE INDEX IF NOT EXISTS idx_tool_runs_session_room
        ON tool_runs(
          storage_generation,
          source_host_session_id,
          source_matrix_room_id,
          first_retained_matrix_event_id
        );
      DROP INDEX IF EXISTS idx_tool_runs_grouping;
      CREATE UNIQUE INDEX idx_tool_runs_grouping
        ON tool_runs(
          storage_generation,
          source_host_session_id,
          source_matrix_room_id,
          grouping_key_kind,
          grouping_key,
          consecutive_run_index
        );
      CREATE TABLE IF NOT EXISTS tool_event_continuations (
        run_ref TEXT NOT NULL,
        storage_generation TEXT NOT NULL,
        tool_event_index INTEGER NOT NULL CHECK(tool_event_index >= 2),
        event_key TEXT NOT NULL,
        source_host_session_id TEXT NOT NULL,
        source_matrix_room_id TEXT NOT NULL,
        provider TEXT,
        provider_turn_id TEXT,
        provider_turn_id_kind TEXT,
        target_turn_id TEXT,
        provider_runtime_event_index INTEGER,
        source_user_event_id TEXT,
        semantic_type TEXT NOT NULL,
        tool_name TEXT,
        tool_call_id TEXT,
        tool_is_error INTEGER,
        tool_update_kind TEXT,
        payload_json TEXT NOT NULL,
        body TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_ref, tool_event_index),
        UNIQUE(run_ref, event_key),
        FOREIGN KEY(run_ref) REFERENCES tool_runs(run_ref) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tool_event_continuations_session_room
        ON tool_event_continuations(
          storage_generation,
          source_host_session_id,
          source_matrix_room_id,
          run_ref,
          tool_event_index
        );
      UPDATE tool_runs SET run_state = 'active' WHERE run_state = 'open';
    `);

    const setMeta = db.prepare(`
      INSERT INTO tool_event_store_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const getMeta = db.prepare(
      "SELECT value FROM tool_event_store_meta WHERE key = ?"
    );
    const now = new Date().toISOString();
    setMeta.run("migration_state", "running");
    setMeta.run("schema_name", SQLITE_SCHEMA_NAME);
    setMeta.run("schema_version", String(SQLITE_SCHEMA_VERSION));
    setMeta.run("write_generation", ROUTEC_TOOL_STORAGE_GENERATION_SQLITE);
    setMeta.run("legacy_jsonl_import", "disabled");
    setMeta.run("legacy_missing_marker_policy", "matrix_only");
    setMeta.run(
      "recovery_table",
      tableExists(db, RECOVERY_TABLE_NAME) ? RECOVERY_TABLE_NAME : "none"
    );
    if (!getMeta.get("cutover_started_at")?.value) {
      setMeta.run("cutover_started_at", now);
    }
    if (typeof onBeforeMigrationCommit === "function") {
      onBeforeMigrationCommit({ db, schemaVersion: SQLITE_SCHEMA_VERSION });
    }
    setMeta.run("cutover_completed_at", now);
    setMeta.run("migration_state", "complete");
  });

  migrate();
}

function assertSchema(db) {
  const getMeta = db.prepare("SELECT value FROM tool_event_store_meta WHERE key = ?");
  const schemaName = getMeta.get("schema_name")?.value;
  const schemaVersion = Number(getMeta.get("schema_version")?.value);
  const migrationState = getMeta.get("migration_state")?.value;
  const writeGeneration = getMeta.get("write_generation")?.value;
  if (
    schemaName !== SQLITE_SCHEMA_NAME ||
    schemaVersion !== SQLITE_SCHEMA_VERSION ||
    migrationState !== "complete" ||
    writeGeneration !== ROUTEC_TOOL_STORAGE_GENERATION_SQLITE
  ) {
    throw new Error(
      `Tool event SQLite schema is not write-ready: ${schemaName || "missing"}/${
        Number.isFinite(schemaVersion) ? schemaVersion : "missing"
      }/${migrationState || "missing"}/${writeGeneration || "missing"}`
    );
  }
}

function closeInterruptedRunsAfterRestart(db) {
  const now = new Date().toISOString();
  return db
    .prepare(`
      UPDATE tool_runs
      SET run_state = 'closed', updated_at = ?, closed_at = COALESCE(closed_at, ?)
      WHERE run_state = 'active'
    `)
    .run(now, now).changes;
}

function runFromRow(row) {
  return {
    large_tool_ref: row.run_ref,
    storage_generation: row.storage_generation,
    source_host_session_id: row.source_host_session_id,
    source_matrix_room_id: row.source_matrix_room_id,
    first_retained_matrix_event_id: row.first_retained_matrix_event_id,
    retained_matrix_event_ids: [row.first_retained_matrix_event_id],
    provider: row.provider,
    provider_turn_id: row.provider_turn_id,
    target_turn_id: row.target_turn_id,
    grouping_key: row.grouping_key,
    grouping_key_kind: row.grouping_key_kind,
    consecutive_run_index: row.consecutive_run_index,
    run_state: row.run_state,
    last_tool_event_index: row.last_tool_event_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
  };
}

function publicEventFromRow(row) {
  return {
    schema_version: ROUTEC_LARGE_TOOL_EVENT_SCHEMA_VERSION,
    storage_generation: row.storage_generation,
    tool_event_index: row.tool_event_index,
    semantic_type: row.semantic_type,
    source_host_session_id: row.source_host_session_id,
    source_matrix_room_id: row.source_matrix_room_id,
    provider: row.provider,
    provider_turn_id: row.provider_turn_id,
    provider_turn_id_kind: row.provider_turn_id_kind,
    target_turn_id: row.target_turn_id,
    provider_runtime_event_index: row.provider_runtime_event_index,
    source_user_event_id: row.source_user_event_id,
    tool_name: row.tool_name,
    tool_call_id: row.tool_call_id,
    tool_is_error:
      row.tool_is_error === null ? null : row.tool_is_error === 1,
    tool_update_kind: row.tool_update_kind,
    payload: parseJson(row.payload_json, null),
    body: row.body,
    created_at: row.created_at,
    search_indexed: false,
  };
}

function publicSummary(run) {
  const continuationCount = Math.max(0, run.last_tool_event_index - 1);
  return {
    status: "ok",
    storage_kind: "host_tool_event_continuation_sqlite",
    storage_generation: run.storage_generation,
    has_continuation: continuationCount > 0,
    continuation_state: continuationCount > 0 ? "available" : "not_required",
    page_size: ROUTEC_TOOL_CONTINUATION_PAGE_SIZE,
    page_count:
      1 + Math.ceil(continuationCount / ROUTEC_TOOL_CONTINUATION_PAGE_SIZE),
    matrix_retained_tool_event_count: 1,
    total_tool_event_count: run.last_tool_event_index,
    total_sqlite_tool_event_count: continuationCount,
    run_state: run.run_state,
    search_indexed: false,
    resolver_path_fields_exposed: false,
    tool_payload_local_paths_preserved: true,
  };
}

export function shouldResetRouteCToolRunAfterSemanticWrite({
  semanticType,
  writeResult,
} = {}) {
  const committed =
    writeResult?.status === "provider_semantic_matrix_event_committed" ||
    writeResult?.semantic_matrix_event_committed === true;
  return Boolean(normalizeString(semanticType) && committed);
}

export function createLargeToolCallStore({
  configDir,
  onBeforeMigrationCommit = null,
}) {
  if (!normalizeString(configDir)) {
    throw new Error("tool event continuation store requires configDir");
  }
  const dbPath = join(configDir, SQLITE_FILE_NAME);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  let closed = false;
  try {
    initializeDatabase(db, { onBeforeMigrationCommit });
    assertSchema(db);
    closeInterruptedRunsAfterRestart(db);
  } catch (err) {
    db.close();
    throw err;
  }

  const insertRun = db.prepare(`
    INSERT INTO tool_runs(
      run_ref, storage_generation, source_host_session_id,
      source_matrix_room_id, first_retained_matrix_event_id, provider,
      provider_turn_id, target_turn_id, grouping_key, grouping_key_kind,
      consecutive_run_index, run_state, last_tool_event_index,
      created_at, updated_at, closed_at
    ) VALUES (
      @run_ref, @storage_generation, @source_host_session_id,
      @source_matrix_room_id, @first_retained_matrix_event_id, @provider,
      @provider_turn_id, @target_turn_id, @grouping_key, @grouping_key_kind,
      @consecutive_run_index, @run_state, @last_tool_event_index,
      @created_at, @updated_at, @closed_at
    )
  `);
  const getRunByRef = db.prepare("SELECT * FROM tool_runs WHERE run_ref = ?");
  const getRunByRetainedEvent = db.prepare(`
    SELECT * FROM tool_runs
    WHERE storage_generation = ?
      AND source_host_session_id = ?
      AND source_matrix_room_id = ?
      AND first_retained_matrix_event_id = ?
  `);
  const insertContinuation = db.prepare(`
    INSERT INTO tool_event_continuations(
      run_ref, storage_generation, tool_event_index, event_key,
      source_host_session_id, source_matrix_room_id, provider,
      provider_turn_id, provider_turn_id_kind, target_turn_id,
      provider_runtime_event_index, source_user_event_id, semantic_type,
      tool_name, tool_call_id, tool_is_error, tool_update_kind,
      payload_json, body, created_at, updated_at
    ) VALUES (
      @run_ref, @storage_generation, @tool_event_index, @event_key,
      @source_host_session_id, @source_matrix_room_id, @provider,
      @provider_turn_id, @provider_turn_id_kind, @target_turn_id,
      @provider_runtime_event_index, @source_user_event_id, @semantic_type,
      @tool_name, @tool_call_id, @tool_is_error, @tool_update_kind,
      @payload_json, @body, @created_at, @updated_at
    )
  `);

  function getWriteGeneration() {
    assertSchema(db);
    return ROUTEC_TOOL_STORAGE_GENERATION_SQLITE;
  }

  function registerToolRun({
    identity,
    firstRetainedMatrixEventId,
    provider = null,
  }) {
    const normalizedIdentity = requireIdentity(identity);
    const firstEventId = normalizeString(firstRetainedMatrixEventId);
    if (!firstEventId) {
      throw new Error("first retained Matrix tool event id is required");
    }
    const runRef = buildRunRef(normalizedIdentity, firstEventId);
    const now = new Date().toISOString();
    const register = db.transaction(() => {
      const existing = getRunByRef.get(runRef);
      if (existing) {
        if (
          existing.storage_generation !== normalizedIdentity.storage_generation ||
          existing.first_retained_matrix_event_id !== firstEventId
        ) {
          throw new Error("tool run registration identity conflict");
        }
        return existing;
      }
      insertRun.run({
        run_ref: runRef,
        storage_generation: normalizedIdentity.storage_generation,
        source_host_session_id: normalizedIdentity.source_host_session_id,
        source_matrix_room_id: normalizedIdentity.source_matrix_room_id,
        first_retained_matrix_event_id: firstEventId,
        provider: normalizeString(provider),
        provider_turn_id: normalizedIdentity.provider_turn_id,
        target_turn_id: normalizedIdentity.target_turn_id,
        grouping_key: normalizedIdentity.grouping_key,
        grouping_key_kind: normalizedIdentity.grouping_key_kind,
        consecutive_run_index: normalizedIdentity.consecutive_run_index,
        run_state: "active",
        last_tool_event_index: 1,
        created_at: now,
        updated_at: now,
        closed_at: null,
      });
      return getRunByRef.get(runRef);
    });
    const run = runFromRow(register());
    return { ...publicSummary(run), large_tool_ref: run.large_tool_ref };
  }

  function appendToolEvent({
    identity,
    firstRetainedMatrixEventId,
    event,
    semanticType,
    toolEventIndex,
  }) {
    const normalizedIdentity = requireIdentity(identity);
    const firstEventId = normalizeString(firstRetainedMatrixEventId);
    const index = normalizePositiveInteger(toolEventIndex);
    if (!firstEventId) {
      throw new Error("first retained Matrix tool event id is required");
    }
    if (!index || index < 2) {
      throw new Error("tool continuation index must be >= 2");
    }
    if (!TOOL_SEMANTIC_TYPES.has(semanticType)) {
      throw new Error(`unsupported tool semantic type: ${semanticType}`);
    }
    const runRef = buildRunRef(normalizedIdentity, firstEventId);
    const eventKey = buildEventKey({ event, semanticType, toolEventIndex: index });
    const now = new Date().toISOString();
    const append = db.transaction(() => {
      const runRow = getRunByRef.get(runRef);
      if (!runRow) {
        throw new Error("tool continuation run is not registered");
      }
      if (runRow.storage_generation !== ROUTEC_TOOL_STORAGE_GENERATION_SQLITE) {
        throw new Error("tool continuation run generation mismatch");
      }
      const duplicate = db
        .prepare(
          "SELECT tool_event_index FROM tool_event_continuations WHERE run_ref = ? AND event_key = ?"
        )
        .get(runRef, eventKey);
      if (duplicate) {
        return { appended: false, run: runFromRow(runRow) };
      }
      const expectedIndex = Number(runRow.last_tool_event_index) + 1;
      if (index !== expectedIndex) {
        throw new Error(
          `tool continuation index gap for ${runRef}: expected ${expectedIndex}, got ${index}`
        );
      }
      const delivery = event?.routec_matrix_delivery || {};
      insertContinuation.run({
        run_ref: runRef,
        storage_generation: normalizedIdentity.storage_generation,
        tool_event_index: index,
        event_key: eventKey,
        source_host_session_id: normalizedIdentity.source_host_session_id,
        source_matrix_room_id: normalizedIdentity.source_matrix_room_id,
        provider:
          normalizeString(event?.provider) || normalizeString(delivery.provider_id),
        provider_turn_id:
          normalizeString(delivery.provider_turn_id) ||
          normalizeString(event?.provider_turn_id) ||
          normalizedIdentity.provider_turn_id,
        provider_turn_id_kind:
          normalizeString(delivery.provider_turn_id_kind) ||
          normalizeString(event?.provider_turn_id_kind),
        target_turn_id:
          normalizeString(event?.target_turn_id) ||
          normalizeString(delivery.target_turn_id) ||
          normalizedIdentity.target_turn_id,
        provider_runtime_event_index:
          normalizePositiveInteger(delivery.provider_runtime_event_index) ||
          normalizePositiveInteger(event?.provider_runtime_event_index),
        source_user_event_id: normalizeString(delivery.source_user_event_id),
        semantic_type: semanticType,
        tool_name:
          normalizeString(event?.tool_name) || normalizeString(event?.name),
        tool_call_id:
          normalizeString(event?.tool_call_id) ||
          normalizeString(event?.call_id) ||
          normalizeString(event?.id),
        tool_is_error:
          semanticType === "tool.failure"
            ? 1
            : typeof event?.tool_is_error === "boolean"
            ? event.tool_is_error
              ? 1
              : 0
            : typeof event?.is_error === "boolean"
            ? event.is_error
              ? 1
              : 0
            : null,
        tool_update_kind:
          semanticType === "tool.update"
            ? normalizeString(event?.tool_update_kind) ||
              normalizeString(event?.update_kind)
            : null,
        payload_json: JSON.stringify(
          cloneJson(toolPayload(event, semanticType), "tool continuation payload")
        ),
        body:
          normalizeString(event?.semantic_body) ||
          normalizeString(event?.body) ||
          normalizeString(event?.display_text) ||
          normalizeString(event?.text),
        created_at: now,
        updated_at: now,
      });
      db.prepare(`
        UPDATE tool_runs
        SET last_tool_event_index = ?, updated_at = ?
        WHERE run_ref = ?
      `).run(index, now, runRef);
      return { appended: true, run: runFromRow(getRunByRef.get(runRef)) };
    });
    const result = append();
    return {
      status: result.appended
        ? "tool_event_continuation_stored"
        : "tool_event_continuation_duplicate_ignored",
      large_tool_ref: runRef,
      appended: result.appended,
      tool_event_index: index,
      index: publicSummary(result.run),
    };
  }

  function closeToolRun({ largeToolRef, state = "closed" }) {
    const runRef = normalizeString(largeToolRef);
    if (!runRef) return false;
    const now = new Date().toISOString();
    return (
      db
        .prepare(`
          UPDATE tool_runs
          SET run_state = ?, updated_at = ?, closed_at = ?
          WHERE run_ref = ? AND run_state = 'active'
        `)
        .run(normalizeString(state) || "closed", now, now, runRef).changes > 0
    );
  }

  function resolveRun(options) {
    const generation = requireStorageGeneration(options?.storageGeneration);
    const sessionId = normalizeString(options?.sessionId);
    const matrixRoomId = normalizeString(options?.matrixRoomId);
    if (!sessionId || !matrixRoomId) {
      throw new Error("session_id and matrix_room_id are required");
    }
    const retainedEventId = normalizeString(options?.retainedMatrixEventId);
    const largeToolRef = normalizeString(options?.largeToolRef);
    let row = null;
    if (retainedEventId) {
      row = getRunByRetainedEvent.get(
        generation,
        sessionId,
        matrixRoomId,
        retainedEventId
      );
    } else if (largeToolRef) {
      row = getRunByRef.get(largeToolRef);
      if (
        row &&
        (row.storage_generation !== generation ||
          row.source_host_session_id !== sessionId ||
          row.source_matrix_room_id !== matrixRoomId)
      ) {
        return { status: "forbidden", run: null };
      }
    } else {
      throw new Error("retained Matrix event id or run ref is required");
    }
    return row
      ? { status: "ok", run: runFromRow(row) }
      : { status: "unavailable", run: null };
  }

  function readContinuationRows(runRef) {
    return db
      .prepare(`
        SELECT * FROM tool_event_continuations
        WHERE run_ref = ? AND storage_generation = ?
        ORDER BY tool_event_index
      `)
      .all(runRef, ROUTEC_TOOL_STORAGE_GENERATION_SQLITE)
      .map(publicEventFromRow);
  }

  function resolveLargeToolRun(options) {
    const resolved = resolveRun(options);
    if (resolved.status !== "ok") {
      return { status: resolved.status, matches: 0 };
    }
    const run = resolved.run;
    return {
      status: "ok",
      summary: publicSummary(run),
      retained_matrix_event_ids: [run.first_retained_matrix_event_id],
      continuation_records: readContinuationRows(run.large_tool_ref),
      provider_turn_id: run.provider_turn_id,
      target_turn_id: run.target_turn_id,
      grouping_key: run.grouping_key,
      large_tool_ref: run.large_tool_ref,
      storage_generation: run.storage_generation,
    };
  }

  function resolveLargeToolOutput(options) {
    const page = normalizePositiveInteger(options?.page) || 1;
    const resolved = resolveRun(options);
    if (resolved.status !== "ok") {
      return {
        status: resolved.status,
        has_continuation: false,
        continuation_state: resolved.status,
        page,
        matches: 0,
        resolver_path_fields_exposed: false,
      };
    }
    const run = resolved.run;
    const offset = Math.max(0, page - 2) * ROUTEC_TOOL_CONTINUATION_PAGE_SIZE;
    const items =
      page <= 1
        ? []
        : db
            .prepare(`
              SELECT * FROM tool_event_continuations
              WHERE run_ref = ? AND storage_generation = ?
              ORDER BY tool_event_index
              LIMIT ? OFFSET ?
            `)
            .all(
              run.large_tool_ref,
              ROUTEC_TOOL_STORAGE_GENERATION_SQLITE,
              ROUTEC_TOOL_CONTINUATION_PAGE_SIZE,
              offset
            )
            .map(publicEventFromRow);
    return {
      ...publicSummary(run),
      page,
      large_tool_ref: run.large_tool_ref,
      items,
      sqlite_loaded: page > 1,
      detail_page_1_matrix_retained: page === 1,
      explicit_detail_navigation_required: true,
    };
  }

  function deleteSession(sessionId) {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) return 0;
    const counts = db
      .prepare(`
        SELECT
          COUNT(*) AS run_count,
          COALESCE(SUM(last_tool_event_index - 1), 0) AS continuation_count
        FROM tool_runs
        WHERE source_host_session_id = ?
      `)
      .get(normalizedSessionId);
    db.prepare("DELETE FROM tool_runs WHERE source_host_session_id = ?").run(
      normalizedSessionId
    );
    return Number(counts.run_count) + Number(counts.continuation_count);
  }

  return {
    root: dbPath,
    dbPath,
    getWriteGeneration,
    registerToolRun,
    appendToolEvent,
    closeToolRun,
    resolveLargeToolRun,
    resolveLargeToolOutput,
    deleteSession,
    getSchemaStatus: () => ({
      schema_name: SQLITE_SCHEMA_NAME,
      schema_version: SQLITE_SCHEMA_VERSION,
      storage_generation: getWriteGeneration(),
      recovery_table_present: tableExists(db, RECOVERY_TABLE_NAME),
      legacy_jsonl_import: "disabled",
    }),
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
