import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { getConfigDir, getHostDbPath } from "./config.mjs";

export const HOST_DB_FILENAME = "oysterun.sqlite";

export function getSchedulerRuntimeDir(configDir = getConfigDir()) {
  return configDir;
}

export function getSchedulerDbPath(configDir = getConfigDir()) {
  return getHostDbPath(configDir);
}

function nowIso(clock = () => new Date()) {
  const value = clock();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value).trim() || null;
  return value.trim() || null;
}

function normalizeOptionalInteger(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function normalizePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return value;
}

function serializePayload(value, fieldName) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch (err) {
    throw new Error(`${fieldName} must be JSON serializable: ${err.message}`);
  }
}

function parsePayload(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(value);
}

function normalizeScheduleStatus(value) {
  const status = normalizeOptionalString(value) || "draft";
  if (!["draft", "active", "paused", "stopped", "failed"].includes(status)) {
    throw new Error(`Unsupported schedule status: ${status}`);
  }
  return status;
}

function normalizeRunStatus(value) {
  const status = normalizeOptionalString(value) || "planned";
  if (
    ![
      "planned",
      "claimed",
      "dispatched",
      "skipped",
      "failed",
      "canceled",
    ].includes(status)
  ) {
    throw new Error(`Unsupported schedule run status: ${status}`);
  }
  return status;
}

function mapScheduleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    host_session_id: row.host_session_id,
    agent_id: row.agent_id,
    created_by: row.created_by,
    schedule_kind: row.schedule_kind,
    status: row.status,
    input_text: row.input_text,
    interval_ms: row.interval_ms,
    normalized_command: row.normalized_command,
    next_run_at: row.next_run_at,
    availability_state: row.availability_state,
    availability_reason: row.availability_reason,
    metadata: parsePayload(row.metadata_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_triggered_at: row.last_triggered_at,
    last_dispatched_message_id: row.last_dispatched_message_id,
    last_skipped_at: row.last_skipped_at,
    skip_count: row.skip_count,
    dispatch_count: row.dispatch_count,
    stopped_at: row.stopped_at,
    stopped_by: row.stopped_by,
    stop_reason: row.stop_reason,
  };
}

function mapRunRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    schedule_id: row.schedule_id,
    scheduled_for: row.scheduled_for,
    claimed_at: row.claimed_at,
    completed_at: row.completed_at,
    status: row.status,
    dispatched_message_id: row.dispatched_message_id,
    error: row.error,
    metadata: parsePayload(row.metadata_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRunLogRow(row) {
  if (!row) return null;
  return {
    run_id: row.run_id,
    schedule_id: row.schedule_id,
    attempt: row.attempt,
    stdout_text: row.stdout_text,
    stderr_text: row.stderr_text,
    stdout_truncated: row.stdout_truncated === 1,
    stderr_truncated: row.stderr_truncated === 1,
    captured_at: row.captured_at,
  };
}

function mapPortableRuntimeStateRow(row) {
  if (!row) return null;
  return {
    schedule_id: row.schedule_id,
    agent_folder: row.agent_folder,
    portable_hash: row.portable_hash,
    first_discovered_at: row.first_discovered_at,
    last_triggered_at: row.last_triggered_at,
    last_dispatched_message_id: row.last_dispatched_message_id,
    last_skipped_at: row.last_skipped_at,
    next_run_at: row.next_run_at,
    runtime_status: row.runtime_status,
    skip_count: row.skip_count,
    dispatch_count: row.dispatch_count,
    last_error: row.last_error,
    updated_at: row.updated_at,
  };
}

function hasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName);
}

function hasForeignKeys(db, tableName) {
  return db.prepare(`PRAGMA foreign_key_list(${tableName})`).all().length > 0;
}

export class SchedulerStore {
  constructor({
    configDir = getConfigDir(),
    dbPath = null,
    clock = () => new Date(),
  } = {}) {
    this.configDir = configDir;
    this.dbPath = dbPath || getSchedulerDbPath(configDir);
    this.clock = clock;
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
    this.db.pragma("foreign_keys = OFF");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        host_session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        schedule_kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'stopped', 'failed')),
        input_text TEXT NOT NULL,
        interval_ms INTEGER,
        normalized_command TEXT NOT NULL DEFAULT '',
        next_run_at TEXT,
        availability_state TEXT NOT NULL,
        availability_reason TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_triggered_at TEXT,
        last_dispatched_message_id TEXT,
        last_skipped_at TEXT,
        skip_count INTEGER NOT NULL DEFAULT 0,
        dispatch_count INTEGER NOT NULL DEFAULT 0,
        stopped_at TEXT,
        stopped_by TEXT,
        stop_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_session_status_next_run
        ON schedules(host_session_id, status, next_run_at);

      CREATE INDEX IF NOT EXISTS idx_schedules_status_next_run
        ON schedules(status, next_run_at);

      CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('planned', 'claimed', 'dispatched', 'skipped', 'failed', 'canceled')),
        dispatched_message_id TEXT,
        error TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_owner TEXT NOT NULL DEFAULT 'host_runtime'
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_created
        ON schedule_runs(schedule_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_schedule_runs_status_scheduled
        ON schedule_runs(status, scheduled_for);

      CREATE TABLE IF NOT EXISTS schedule_run_logs (
        run_id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        stdout_text TEXT NOT NULL DEFAULT '',
        stderr_text TEXT NOT NULL DEFAULT '',
        stdout_truncated INTEGER NOT NULL DEFAULT 0,
        stderr_truncated INTEGER NOT NULL DEFAULT 0,
        captured_at TEXT NOT NULL,
        source_owner TEXT NOT NULL DEFAULT 'host_runtime'
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_run_logs_schedule
        ON schedule_run_logs(schedule_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS portable_schedule_runtime_state (
        schedule_id TEXT NOT NULL,
        agent_folder TEXT NOT NULL,
        portable_hash TEXT NOT NULL,
        first_discovered_at TEXT NOT NULL,
        last_triggered_at TEXT,
        last_dispatched_message_id TEXT,
        last_skipped_at TEXT,
        next_run_at TEXT,
        runtime_status TEXT,
        skip_count INTEGER NOT NULL DEFAULT 0,
        dispatch_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (schedule_id, agent_folder)
      );

      CREATE INDEX IF NOT EXISTS idx_portable_schedule_runtime_state_folder
        ON portable_schedule_runtime_state(agent_folder, updated_at DESC);
    `);
    this.applyMigrations();
    this.db.pragma("foreign_keys = ON");
    this.statements = this.prepareStatements();
    this.initialized = true;
    return this;
  }

  applyMigrations() {
    const migrations = [
      [
        "normalized_command",
        "ALTER TABLE schedules ADD COLUMN normalized_command TEXT NOT NULL DEFAULT ''",
      ],
      [
        "last_triggered_at",
        "ALTER TABLE schedules ADD COLUMN last_triggered_at TEXT",
      ],
      [
        "last_dispatched_message_id",
        "ALTER TABLE schedules ADD COLUMN last_dispatched_message_id TEXT",
      ],
      [
        "last_skipped_at",
        "ALTER TABLE schedules ADD COLUMN last_skipped_at TEXT",
      ],
      [
        "skip_count",
        "ALTER TABLE schedules ADD COLUMN skip_count INTEGER NOT NULL DEFAULT 0",
      ],
      [
        "dispatch_count",
        "ALTER TABLE schedules ADD COLUMN dispatch_count INTEGER NOT NULL DEFAULT 0",
      ],
    ];
    for (const [columnName, statement] of migrations) {
      if (!hasColumn(this.db, "schedules", columnName)) {
        this.db.exec(statement);
      }
    }
    if (!hasColumn(this.db, "schedule_runs", "source_owner")) {
      this.db.exec(
        "ALTER TABLE schedule_runs ADD COLUMN source_owner TEXT NOT NULL DEFAULT 'host_runtime'"
      );
    }
    if (!hasColumn(this.db, "schedule_run_logs", "source_owner")) {
      this.db.exec(
        "ALTER TABLE schedule_run_logs ADD COLUMN source_owner TEXT NOT NULL DEFAULT 'host_runtime'"
      );
    }
    if (!hasColumn(this.db, "portable_schedule_runtime_state", "next_run_at")) {
      this.db.exec(
        "ALTER TABLE portable_schedule_runtime_state ADD COLUMN next_run_at TEXT"
      );
    }
    if (!hasColumn(this.db, "portable_schedule_runtime_state", "runtime_status")) {
      this.db.exec(
        "ALTER TABLE portable_schedule_runtime_state ADD COLUMN runtime_status TEXT"
      );
    }
    if (hasForeignKeys(this.db, "schedule_runs")) {
      this.rebuildScheduleRunsWithoutForeignKeys();
    }
    if (hasForeignKeys(this.db, "schedule_run_logs")) {
      this.rebuildScheduleRunLogsWithoutForeignKeys();
    }
    this.db.exec(`
      UPDATE schedules
      SET normalized_command = input_text
      WHERE normalized_command IS NULL OR normalized_command = '';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_loop_identity
        ON schedules(host_session_id, schedule_kind, interval_ms, normalized_command);
    `);
  }

  rebuildScheduleRunsWithoutForeignKeys() {
    this.db.exec(`
      DROP TABLE IF EXISTS schedule_runs_p72_migration;
      CREATE TABLE schedule_runs_p72_migration (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('planned', 'claimed', 'dispatched', 'skipped', 'failed', 'canceled')),
        dispatched_message_id TEXT,
        error TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_owner TEXT NOT NULL DEFAULT 'host_runtime'
      );
      INSERT INTO schedule_runs_p72_migration (
        id, schedule_id, scheduled_for, claimed_at, completed_at, status,
        dispatched_message_id, error, metadata_json, created_at, updated_at,
        source_owner
      )
      SELECT
        id, schedule_id, scheduled_for, claimed_at, completed_at, status,
        dispatched_message_id, error, metadata_json, created_at, updated_at,
        source_owner
      FROM schedule_runs;
      DROP TABLE schedule_runs;
      ALTER TABLE schedule_runs_p72_migration RENAME TO schedule_runs;
      CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_created
        ON schedule_runs(schedule_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_schedule_runs_status_scheduled
        ON schedule_runs(status, scheduled_for);
    `);
  }

  rebuildScheduleRunLogsWithoutForeignKeys() {
    this.db.exec(`
      DROP TABLE IF EXISTS schedule_run_logs_p72_migration;
      CREATE TABLE schedule_run_logs_p72_migration (
        run_id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        stdout_text TEXT NOT NULL DEFAULT '',
        stderr_text TEXT NOT NULL DEFAULT '',
        stdout_truncated INTEGER NOT NULL DEFAULT 0,
        stderr_truncated INTEGER NOT NULL DEFAULT 0,
        captured_at TEXT NOT NULL,
        source_owner TEXT NOT NULL DEFAULT 'host_runtime'
      );
      INSERT INTO schedule_run_logs_p72_migration (
        run_id, schedule_id, attempt, stdout_text, stderr_text,
        stdout_truncated, stderr_truncated, captured_at, source_owner
      )
      SELECT
        run_id, schedule_id, attempt, stdout_text, stderr_text,
        stdout_truncated, stderr_truncated, captured_at, source_owner
      FROM schedule_run_logs;
      DROP TABLE schedule_run_logs;
      ALTER TABLE schedule_run_logs_p72_migration RENAME TO schedule_run_logs;
      CREATE INDEX IF NOT EXISTS idx_schedule_run_logs_schedule
        ON schedule_run_logs(schedule_id, captured_at DESC);
    `);
  }

  prepareStatements() {
    return {
      insertSchedule: this.db.prepare(`
        INSERT INTO schedules (
          id, host_session_id, agent_id, created_by, schedule_kind, status,
          input_text, interval_ms, normalized_command, next_run_at,
          availability_state, availability_reason, metadata_json,
          created_at, updated_at
        )
        VALUES (
          @id, @host_session_id, @agent_id, @created_by, @schedule_kind, @status,
          @input_text, @interval_ms, @normalized_command, @next_run_at,
          @availability_state, @availability_reason, @metadata_json,
          @created_at, @updated_at
        )
      `),
      getSchedule: this.db.prepare(`
        SELECT * FROM schedules WHERE id = ?
      `),
      listSchedulesForSession: this.db.prepare(`
        SELECT * FROM schedules
        WHERE host_session_id = ?
        ORDER BY created_at DESC, id DESC
      `),
      listSchedulesByKind: this.db.prepare(`
        SELECT * FROM schedules
        WHERE schedule_kind = ?
        ORDER BY next_run_at IS NULL ASC, next_run_at ASC, updated_at DESC, id DESC
      `),
      listDueSchedules: this.db.prepare(`
        SELECT * FROM schedules
        WHERE status = 'active'
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC, created_at ASC, id ASC
        LIMIT ?
      `),
      findScheduleByLoopKey: this.db.prepare(`
        SELECT * FROM schedules
        WHERE host_session_id = ?
          AND schedule_kind = ?
          AND interval_ms = ?
          AND normalized_command = ?
        LIMIT 1
      `),
      enableSchedule: this.db.prepare(`
        UPDATE schedules
        SET status = 'active',
            input_text = @input_text,
            interval_ms = @interval_ms,
            normalized_command = @normalized_command,
            next_run_at = @next_run_at,
            availability_state = @availability_state,
            availability_reason = @availability_reason,
            metadata_json = @metadata_json,
            stopped_at = NULL,
            stopped_by = NULL,
            stop_reason = NULL,
            updated_at = @updated_at
        WHERE id = @id
      `),
      updateScheduleForSessionLoopGui: this.db.prepare(`
        UPDATE schedules
        SET status = @status,
            input_text = @input_text,
            interval_ms = @interval_ms,
            normalized_command = @normalized_command,
            next_run_at = @next_run_at,
            availability_state = @availability_state,
            availability_reason = @availability_reason,
            metadata_json = @metadata_json,
            stopped_at = NULL,
            stopped_by = NULL,
            stop_reason = NULL,
            updated_at = @updated_at
        WHERE id = @id
      `),
      updateHostScheduleForDashboard: this.db.prepare(`
        UPDATE schedules
        SET host_session_id = @host_session_id,
            agent_id = @agent_id,
            status = @status,
            input_text = @input_text,
            interval_ms = NULL,
            normalized_command = @normalized_command,
            next_run_at = @next_run_at,
            availability_state = @availability_state,
            availability_reason = @availability_reason,
            metadata_json = @metadata_json,
            stopped_at = NULL,
            stopped_by = NULL,
            stop_reason = NULL,
            updated_at = @updated_at
        WHERE id = @id
      `),
      stopSchedule: this.db.prepare(`
        UPDATE schedules
        SET status = 'stopped',
            stopped_at = @stopped_at,
            stopped_by = @stopped_by,
            stop_reason = @stop_reason,
            updated_at = @updated_at
        WHERE id = @id
      `),
      recordDispatch: this.db.prepare(`
        UPDATE schedules
        SET next_run_at = @next_run_at,
            status = COALESCE(@status, status),
            last_triggered_at = @triggered_at,
            last_dispatched_message_id = @message_id,
            dispatch_count = dispatch_count + 1,
            updated_at = @updated_at
        WHERE id = @id
      `),
      recordSkip: this.db.prepare(`
        UPDATE schedules
        SET next_run_at = @next_run_at,
            status = COALESCE(@status, status),
            last_triggered_at = @triggered_at,
            last_skipped_at = @triggered_at,
            skip_count = skip_count + 1,
            updated_at = @updated_at
        WHERE id = @id
      `),
      insertRun: this.db.prepare(`
        INSERT INTO schedule_runs (
          id, schedule_id, scheduled_for, claimed_at, completed_at, status,
          dispatched_message_id, error, metadata_json, created_at, updated_at,
          source_owner
        )
        VALUES (
          @id, @schedule_id, @scheduled_for, @claimed_at, @completed_at, @status,
          @dispatched_message_id, @error, @metadata_json, @created_at, @updated_at,
          @source_owner
        )
      `),
      updateRun: this.db.prepare(`
        UPDATE schedule_runs
        SET completed_at = @completed_at,
            status = @status,
            dispatched_message_id = @dispatched_message_id,
            error = @error,
            metadata_json = @metadata_json,
            updated_at = @updated_at
        WHERE id = @id
      `),
      getRun: this.db.prepare(`
        SELECT * FROM schedule_runs WHERE id = ?
      `),
      insertRunLog: this.db.prepare(`
        INSERT OR REPLACE INTO schedule_run_logs (
          run_id, schedule_id, attempt, stdout_text, stderr_text,
          stdout_truncated, stderr_truncated, captured_at, source_owner
        )
        VALUES (
          @run_id, @schedule_id, @attempt, @stdout_text, @stderr_text,
          @stdout_truncated, @stderr_truncated, @captured_at, @source_owner
        )
      `),
      getRunLog: this.db.prepare(`
        SELECT * FROM schedule_run_logs
        WHERE schedule_id = ? AND run_id = ?
      `),
      listRunsForSchedule: this.db.prepare(`
        SELECT * FROM schedule_runs
        WHERE schedule_id = ?
        ORDER BY created_at ASC, id ASC
      `),
      listRecentRunsForSchedule: this.db.prepare(`
        SELECT * FROM schedule_runs
        WHERE schedule_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `),
      deleteSchedule: this.db.prepare(`
        DELETE FROM schedules WHERE id = ?
      `),
      schemaTables: this.db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'schedules',
            'schedule_runs',
            'schedule_run_logs',
            'portable_schedule_runtime_state'
          )
        ORDER BY name ASC
      `),
      getPortableScheduleRuntimeState: this.db.prepare(`
        SELECT * FROM portable_schedule_runtime_state
        WHERE schedule_id = ? AND agent_folder = ?
      `),
      insertPortableScheduleRuntimeState: this.db.prepare(`
        INSERT INTO portable_schedule_runtime_state (
          schedule_id, agent_folder, portable_hash, first_discovered_at,
          updated_at
        )
        VALUES (
          @schedule_id, @agent_folder, @portable_hash, @first_discovered_at,
          @updated_at
        )
      `),
      updatePortableScheduleRuntimeHash: this.db.prepare(`
        UPDATE portable_schedule_runtime_state
        SET portable_hash = @portable_hash,
            first_discovered_at = @first_discovered_at,
            next_run_at = NULL,
            runtime_status = NULL,
            updated_at = @updated_at
        WHERE schedule_id = @schedule_id AND agent_folder = @agent_folder
      `),
      recordPortableScheduleDispatch: this.db.prepare(`
        UPDATE portable_schedule_runtime_state
        SET portable_hash = @portable_hash,
            last_triggered_at = @triggered_at,
            last_dispatched_message_id = @message_id,
            next_run_at = @next_run_at,
            runtime_status = @runtime_status,
            dispatch_count = dispatch_count + 1,
            last_error = NULL,
            updated_at = @updated_at
        WHERE schedule_id = @schedule_id AND agent_folder = @agent_folder
      `),
      recordPortableScheduleSkip: this.db.prepare(`
        UPDATE portable_schedule_runtime_state
        SET portable_hash = @portable_hash,
            last_triggered_at = @triggered_at,
            last_skipped_at = @triggered_at,
            next_run_at = @next_run_at,
            runtime_status = @runtime_status,
            skip_count = skip_count + 1,
            last_error = @last_error,
            updated_at = @updated_at
        WHERE schedule_id = @schedule_id AND agent_folder = @agent_folder
      `),
      deletePortableScheduleRuntimeState: this.db.prepare(`
        DELETE FROM portable_schedule_runtime_state
        WHERE schedule_id = ? AND agent_folder = ?
      `),
    };
  }

  createSchedule({
    id = randomUUID(),
    hostSessionId,
    agentId,
    createdBy = "oysterun-host",
    scheduleKind = "skeleton_stub",
    inputText,
    intervalMs = null,
    normalizedCommand = null,
    nextRunAt = null,
    status = "draft",
    availabilityState = "stub_unavailable",
    availabilityReason = "P12.2 loop parser and dispatch semantics are not implemented",
    metadata = null,
  }) {
    this.initialize();
    const createdAt = nowIso(this.clock);
    const normalizedId = normalizeRequiredString(id, "schedule id");
    const normalizedInputText = normalizeRequiredString(inputText, "inputText");
    this.statements.insertSchedule.run({
      id: normalizedId,
      host_session_id: normalizeRequiredString(hostSessionId, "hostSessionId"),
      agent_id: normalizeRequiredString(agentId, "agentId"),
      created_by: normalizeRequiredString(createdBy, "createdBy"),
      schedule_kind: normalizeRequiredString(scheduleKind, "scheduleKind"),
      status: normalizeScheduleStatus(status),
      input_text: normalizedInputText,
      interval_ms: normalizeOptionalInteger(intervalMs, "intervalMs"),
      normalized_command:
        normalizeOptionalString(normalizedCommand) || normalizedInputText,
      next_run_at: normalizeOptionalString(nextRunAt),
      availability_state: normalizeRequiredString(
        availabilityState,
        "availabilityState"
      ),
      availability_reason: normalizeRequiredString(
        availabilityReason,
        "availabilityReason"
      ),
      metadata_json: serializePayload(metadata, "metadata"),
      created_at: createdAt,
      updated_at: createdAt,
    });
    return this.getSchedule(normalizedId);
  }

  getSchedule(id) {
    this.initialize();
    return mapScheduleRow(
      this.statements.getSchedule.get(
        normalizeRequiredString(id, "schedule id")
      )
    );
  }

  listSchedulesForSession(hostSessionId) {
    this.initialize();
    return this.statements.listSchedulesForSession
      .all(normalizeRequiredString(hostSessionId, "hostSessionId"))
      .map(mapScheduleRow);
  }

  listSchedulesByKind(scheduleKind) {
    this.initialize();
    return this.statements.listSchedulesByKind
      .all(normalizeRequiredString(scheduleKind, "scheduleKind"))
      .map(mapScheduleRow);
  }

  listDueSchedules(now = nowIso(this.clock), { limit = 50 } = {}) {
    this.initialize();
    return this.statements.listDueSchedules
      .all(
        normalizeRequiredString(now, "now"),
        normalizePositiveInteger(limit, "limit")
      )
      .map(mapScheduleRow);
  }

  findScheduleByLoopKey({
    hostSessionId,
    scheduleKind = "loop_interval",
    intervalMs,
    normalizedCommand,
  }) {
    this.initialize();
    return mapScheduleRow(
      this.statements.findScheduleByLoopKey.get(
        normalizeRequiredString(hostSessionId, "hostSessionId"),
        normalizeRequiredString(scheduleKind, "scheduleKind"),
        normalizePositiveInteger(intervalMs, "intervalMs"),
        normalizeRequiredString(normalizedCommand, "normalizedCommand")
      )
    );
  }

  enableSchedule(
    id,
    {
      inputText,
      intervalMs,
      normalizedCommand,
      nextRunAt,
      availabilityState,
      availabilityReason,
      metadata = null,
    }
  ) {
    this.initialize();
    const updatedAt = nowIso(this.clock);
    this.statements.enableSchedule.run({
      id: normalizeRequiredString(id, "schedule id"),
      input_text: normalizeRequiredString(inputText, "inputText"),
      interval_ms: normalizePositiveInteger(intervalMs, "intervalMs"),
      normalized_command: normalizeRequiredString(
        normalizedCommand,
        "normalizedCommand"
      ),
      next_run_at: normalizeRequiredString(nextRunAt, "nextRunAt"),
      availability_state: normalizeRequiredString(
        availabilityState,
        "availabilityState"
      ),
      availability_reason: normalizeRequiredString(
        availabilityReason,
        "availabilityReason"
      ),
      metadata_json: serializePayload(metadata, "metadata"),
      updated_at: updatedAt,
    });
    return this.getSchedule(id);
  }

  updateScheduleForSessionLoopGui(
    id,
    {
      inputText,
      intervalMs,
      normalizedCommand,
      nextRunAt,
      status,
      availabilityState,
      availabilityReason,
      metadata = null,
    }
  ) {
    this.initialize();
    const updatedAt = nowIso(this.clock);
    this.statements.updateScheduleForSessionLoopGui.run({
      id: normalizeRequiredString(id, "schedule id"),
      status: normalizeScheduleStatus(status),
      input_text: normalizeRequiredString(inputText, "inputText"),
      interval_ms: normalizePositiveInteger(intervalMs, "intervalMs"),
      normalized_command: normalizeRequiredString(
        normalizedCommand,
        "normalizedCommand"
      ),
      next_run_at: normalizeRequiredString(nextRunAt, "nextRunAt"),
      availability_state: normalizeRequiredString(
        availabilityState,
        "availabilityState"
      ),
      availability_reason: normalizeRequiredString(
        availabilityReason,
        "availabilityReason"
      ),
      metadata_json: serializePayload(metadata, "metadata"),
      updated_at: updatedAt,
    });
    return this.getSchedule(id);
  }

  updateHostScheduleForDashboard(
    id,
    {
      hostSessionId,
      agentId,
      inputText,
      normalizedCommand,
      nextRunAt,
      status,
      availabilityState,
      availabilityReason,
      metadata = null,
    }
  ) {
    this.initialize();
    const updatedAt = nowIso(this.clock);
    this.statements.updateHostScheduleForDashboard.run({
      id: normalizeRequiredString(id, "schedule id"),
      host_session_id: normalizeRequiredString(hostSessionId, "hostSessionId"),
      agent_id: normalizeRequiredString(agentId, "agentId"),
      status: normalizeScheduleStatus(status),
      input_text: normalizeRequiredString(inputText, "inputText"),
      normalized_command: normalizeRequiredString(
        normalizedCommand,
        "normalizedCommand"
      ),
      next_run_at: normalizeOptionalString(nextRunAt),
      availability_state: normalizeRequiredString(
        availabilityState,
        "availabilityState"
      ),
      availability_reason: normalizeRequiredString(
        availabilityReason,
        "availabilityReason"
      ),
      metadata_json: serializePayload(metadata, "metadata"),
      updated_at: updatedAt,
    });
    return this.getSchedule(id);
  }

  stopSchedule(id, { stoppedBy = "oysterun-host", reason = null } = {}) {
    this.initialize();
    const stoppedAt = nowIso(this.clock);
    this.statements.stopSchedule.run({
      id: normalizeRequiredString(id, "schedule id"),
      stopped_at: stoppedAt,
      stopped_by: normalizeRequiredString(stoppedBy, "stoppedBy"),
      stop_reason: normalizeOptionalString(reason),
      updated_at: stoppedAt,
    });
    return this.getSchedule(id);
  }

  deleteSchedule(id) {
    this.initialize();
    const scheduleId = normalizeRequiredString(id, "schedule id");
    const existing = this.getSchedule(scheduleId);
    this.statements.deleteSchedule.run(scheduleId);
    return existing;
  }

  recordScheduleDispatch(
    id,
    { triggeredAt, nextRunAt, dispatchedMessageId, status = null }
  ) {
    this.initialize();
    const updatedAt = nowIso(this.clock);
    this.statements.recordDispatch.run({
      id: normalizeRequiredString(id, "schedule id"),
      triggered_at: normalizeRequiredString(triggeredAt, "triggeredAt"),
      next_run_at: normalizeOptionalString(nextRunAt),
      status: normalizeOptionalString(status),
      message_id: normalizeRequiredString(
        dispatchedMessageId,
        "dispatchedMessageId"
      ),
      updated_at: updatedAt,
    });
    return this.getSchedule(id);
  }

  recordScheduleSkip(id, { triggeredAt, nextRunAt, status = null }) {
    this.initialize();
    const updatedAt = nowIso(this.clock);
    this.statements.recordSkip.run({
      id: normalizeRequiredString(id, "schedule id"),
      triggered_at: normalizeRequiredString(triggeredAt, "triggeredAt"),
      next_run_at: normalizeOptionalString(nextRunAt),
      status: normalizeOptionalString(status),
      updated_at: updatedAt,
    });
    return this.getSchedule(id);
  }

  createScheduleRun({
    id = randomUUID(),
    scheduleId,
    scheduledFor,
    claimedAt = null,
    completedAt = null,
    status = "planned",
    dispatchedMessageId = null,
    error = null,
    metadata = null,
    sourceOwner = "host_runtime",
  }) {
    this.initialize();
    const createdAt = nowIso(this.clock);
    const normalizedId = normalizeRequiredString(id, "schedule run id");
    this.statements.insertRun.run({
      id: normalizedId,
      schedule_id: normalizeRequiredString(scheduleId, "scheduleId"),
      scheduled_for: normalizeRequiredString(scheduledFor, "scheduledFor"),
      claimed_at: normalizeOptionalString(claimedAt),
      completed_at: normalizeOptionalString(completedAt),
      status: normalizeRunStatus(status),
      dispatched_message_id: normalizeOptionalString(dispatchedMessageId),
      error: normalizeOptionalString(error),
      metadata_json: serializePayload(metadata, "metadata"),
      created_at: createdAt,
      updated_at: createdAt,
      source_owner: normalizeRequiredString(sourceOwner, "sourceOwner"),
    });
    return this.listScheduleRuns(scheduleId).find(
      (run) => run.id === normalizedId
    );
  }

  updateScheduleRun(
    id,
    { completedAt = null, status, dispatchedMessageId = null, error = null, metadata = null }
  ) {
    this.initialize();
    const normalizedId = normalizeRequiredString(id, "schedule run id");
    const updatedAt = nowIso(this.clock);
    this.statements.updateRun.run({
      id: normalizedId,
      completed_at: normalizeOptionalString(completedAt),
      status: normalizeRunStatus(status),
      dispatched_message_id: normalizeOptionalString(dispatchedMessageId),
      error: normalizeOptionalString(error),
      metadata_json: serializePayload(metadata, "metadata"),
      updated_at: updatedAt,
    });
    return mapRunRow(this.statements.getRun.get(normalizedId));
  }

  listScheduleRuns(scheduleId) {
    this.initialize();
    return this.statements.listRunsForSchedule
      .all(normalizeRequiredString(scheduleId, "scheduleId"))
      .map(mapRunRow);
  }

  listRecentScheduleRuns(scheduleId, { limit = 25 } = {}) {
    this.initialize();
    return this.statements.listRecentRunsForSchedule
      .all(
        normalizeRequiredString(scheduleId, "scheduleId"),
        normalizePositiveInteger(limit, "limit")
      )
      .map(mapRunRow);
  }

  recordScheduleRunLog({
    runId,
    scheduleId,
    attempt = 1,
    stdout = "",
    stderr = "",
    stdoutTruncated = false,
    stderrTruncated = false,
    sourceOwner = "host_runtime",
  }) {
    this.initialize();
    const capturedAt = nowIso(this.clock);
    this.statements.insertRunLog.run({
      run_id: normalizeRequiredString(runId, "runId"),
      schedule_id: normalizeRequiredString(scheduleId, "scheduleId"),
      attempt: normalizePositiveInteger(attempt, "attempt"),
      stdout_text: String(stdout || ""),
      stderr_text: String(stderr || ""),
      stdout_truncated: stdoutTruncated === true ? 1 : 0,
      stderr_truncated: stderrTruncated === true ? 1 : 0,
      captured_at: capturedAt,
      source_owner: normalizeRequiredString(sourceOwner, "sourceOwner"),
    });
    return this.getScheduleRunLog({ scheduleId, runId });
  }

  getPortableScheduleRuntimeState({ scheduleId, agentFolder }) {
    this.initialize();
    return mapPortableRuntimeStateRow(
      this.statements.getPortableScheduleRuntimeState.get(
        normalizeRequiredString(scheduleId, "scheduleId"),
        normalizeRequiredString(agentFolder, "agentFolder")
      )
    );
  }

  ensurePortableScheduleRuntimeState({
    scheduleId,
    agentFolder,
    portableHash,
  }) {
    this.initialize();
    const normalizedScheduleId = normalizeRequiredString(
      scheduleId,
      "scheduleId"
    );
    const normalizedAgentFolder = normalizeRequiredString(
      agentFolder,
      "agentFolder"
    );
    const normalizedHash = normalizeRequiredString(
      portableHash,
      "portableHash"
    );
    const existing = this.getPortableScheduleRuntimeState({
      scheduleId: normalizedScheduleId,
      agentFolder: normalizedAgentFolder,
    });
    const updatedAt = nowIso(this.clock);
    if (!existing) {
      this.statements.insertPortableScheduleRuntimeState.run({
        schedule_id: normalizedScheduleId,
        agent_folder: normalizedAgentFolder,
        portable_hash: normalizedHash,
        first_discovered_at: updatedAt,
        updated_at: updatedAt,
      });
      return this.getPortableScheduleRuntimeState({
        scheduleId: normalizedScheduleId,
        agentFolder: normalizedAgentFolder,
      });
    }
    if (existing.portable_hash !== normalizedHash) {
      this.statements.updatePortableScheduleRuntimeHash.run({
        schedule_id: normalizedScheduleId,
        agent_folder: normalizedAgentFolder,
        portable_hash: normalizedHash,
        first_discovered_at: updatedAt,
        updated_at: updatedAt,
      });
    }
    return this.getPortableScheduleRuntimeState({
      scheduleId: normalizedScheduleId,
      agentFolder: normalizedAgentFolder,
    });
  }

  recordPortableScheduleDispatch({
    scheduleId,
    agentFolder,
    portableHash,
    triggeredAt,
    nextRunAt = null,
    dispatchedMessageId,
    status = null,
  }) {
    this.initialize();
    this.ensurePortableScheduleRuntimeState({
      scheduleId,
      agentFolder,
      portableHash,
    });
    this.statements.recordPortableScheduleDispatch.run({
      schedule_id: normalizeRequiredString(scheduleId, "scheduleId"),
      agent_folder: normalizeRequiredString(agentFolder, "agentFolder"),
      portable_hash: normalizeRequiredString(portableHash, "portableHash"),
      triggered_at: normalizeRequiredString(triggeredAt, "triggeredAt"),
      next_run_at: normalizeOptionalString(nextRunAt),
      runtime_status: normalizeOptionalString(status),
      message_id: normalizeRequiredString(
        dispatchedMessageId,
        "dispatchedMessageId"
      ),
      updated_at: nowIso(this.clock),
    });
    return this.getPortableScheduleRuntimeState({ scheduleId, agentFolder });
  }

  recordPortableScheduleSkip({
    scheduleId,
    agentFolder,
    portableHash,
    triggeredAt,
    nextRunAt = null,
    status = null,
    lastError = null,
  }) {
    this.initialize();
    this.ensurePortableScheduleRuntimeState({
      scheduleId,
      agentFolder,
      portableHash,
    });
    this.statements.recordPortableScheduleSkip.run({
      schedule_id: normalizeRequiredString(scheduleId, "scheduleId"),
      agent_folder: normalizeRequiredString(agentFolder, "agentFolder"),
      portable_hash: normalizeRequiredString(portableHash, "portableHash"),
      triggered_at: normalizeRequiredString(triggeredAt, "triggeredAt"),
      next_run_at: normalizeOptionalString(nextRunAt),
      runtime_status: normalizeOptionalString(status),
      last_error: normalizeOptionalString(lastError),
      updated_at: nowIso(this.clock),
    });
    return this.getPortableScheduleRuntimeState({ scheduleId, agentFolder });
  }

  deletePortableScheduleRuntimeState({ scheduleId, agentFolder }) {
    this.initialize();
    this.statements.deletePortableScheduleRuntimeState.run(
      normalizeRequiredString(scheduleId, "scheduleId"),
      normalizeRequiredString(agentFolder, "agentFolder")
    );
  }

  getScheduleRunLog({ scheduleId, runId }) {
    this.initialize();
    return mapRunLogRow(
      this.statements.getRunLog.get(
        normalizeRequiredString(scheduleId, "scheduleId"),
        normalizeRequiredString(runId, "runId")
      )
    );
  }

  getSchemaSummary() {
    this.initialize();
    return {
      db_path: this.dbPath,
      tables: this.statements.schemaTables.all().map((row) => row.name),
    };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }
}
