import { createHash, randomBytes, randomUUID } from "crypto";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { getConfigDir, getHostDbPath } from "./config.mjs";

export const DEFAULT_HOST_APP_USER_ID = "host_owner";
export const MAIL_CREATE_SCOPE = "mail:create";

export function getMailDbPath(configDir = getConfigDir()) {
  return getHostDbPath(configDir);
}

export function hashCapabilityToken(token) {
  const normalizedToken = normalizeRequiredString(token, "capability token");
  return createHash("sha256")
    .update(`oysterun-mail-capability-v1:${normalizedToken}`)
    .digest("hex");
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

function normalizeOptionalString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return String(value).trim() || fallback;
  return value.trim() || fallback;
}

function normalizeTimestamp(value, fieldName) {
  const normalized = normalizeRequiredString(value, fieldName);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return new Date(parsed).toISOString();
}

function serializePayload(value, fieldName, fallbackValue) {
  const effectiveValue = value === undefined ? fallbackValue : value;
  try {
    return JSON.stringify(effectiveValue);
  } catch (err) {
    throw new Error(`${fieldName} must be JSON serializable: ${err.message}`);
  }
}

function parsePayload(value, fallbackValue) {
  if (value === null || value === undefined || value === "") {
    return fallbackValue;
  }
  return JSON.parse(value);
}

function normalizeTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("tags must be an array");
  return value.map((entry) => normalizeRequiredString(entry, "tag"));
}

function normalizeScopes(value) {
  const scopes = value === undefined || value === null ? [MAIL_CREATE_SCOPE] : value;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("capability scopes must be a non-empty array");
  }
  return scopes.map((entry) => normalizeRequiredString(entry, "capability scope"));
}

function normalizeBodyFormat(value, { bodyMarkdown, bodyHtml } = {}) {
  const format = normalizeOptionalString(value, "markdown").toLowerCase();
  if (format === "trusted_html") return "html";
  if (format === "html" || format === "markdown") return format;
  if (format === "auto") {
    const htmlSource = normalizeOptionalString(bodyHtml);
    const markdownSource = normalizeOptionalString(bodyMarkdown);
    if (htmlSource || looksLikeDocumentHtml(markdownSource)) return "html";
    return "markdown";
  }
  throw new Error(`Unsupported mail body_format: ${format}`);
}

function looksLikeDocumentHtml(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  return (
    normalized.startsWith("<!doctype html") ||
    normalized.startsWith("<html") ||
    normalized.startsWith("<body")
  );
}

function normalizeMailFilter(value) {
  const filter = normalizeOptionalString(value, "inbox");
  if (!["inbox", "unread", "archived", "all"].includes(filter)) {
    throw new Error(`Unsupported mail filter: ${filter}`);
  }
  return filter;
}

function normalizePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return value;
}

function mapHostAppUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_kind: row.user_kind,
    display_name: row.display_name,
    synapse_user_id: row.synapse_user_id,
    default_matrix_actor_key: row.default_matrix_actor_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at,
  };
}

function mapMailLinkRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    mail_id: row.mail_id,
    label: row.label,
    href: row.href,
    link_type: row.link_type,
    created_at: row.created_at,
  };
}

function mapMailEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    mail_id: row.mail_id,
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    details: parsePayload(row.details_json, {}),
    created_at: row.created_at,
  };
}

function mapMailItemRow(row, { links = [], events = [] } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    recipient_user_id: row.recipient_user_id,
    recipient_synapse_user_id: row.recipient_synapse_user_id,
    mailbox: row.mailbox,
    title: row.title,
    summary: row.summary,
    body_format: row.body_format,
    body_markdown: row.body_markdown,
    body_html: row.body_html,
    source_type: row.source_type,
    source_name: row.source_name,
    source_ref: row.source_ref,
    agent_id: row.agent_id,
    session_id: row.session_id,
    schedule_id: row.schedule_id,
    schedule_run_id: row.schedule_run_id,
    site_url: row.site_url,
    severity: row.severity,
    tags: parsePayload(row.tags_json, []),
    metadata: parsePayload(row.metadata_json, {}),
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    read_at: row.read_at,
    archived_at: row.archived_at,
    deleted_at: row.deleted_at,
    links,
    events,
  };
}

function mapCapabilityGrantRow(row) {
  if (!row) return null;
  return {
    token_hash: row.token_hash,
    grant_kind: row.grant_kind,
    target_host_ref: row.target_host_ref,
    target_host_origin: row.target_host_origin,
    target_host_fingerprint: row.target_host_fingerprint,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    recipient_user_id: row.recipient_user_id,
    schedule_id: row.schedule_id,
    schedule_run_id: row.schedule_run_id,
    agent_id: row.agent_id,
    scopes: parsePayload(row.scopes_json, []),
    constraints: parsePayload(row.constraints_json, {}),
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    used_count: row.used_count,
  };
}

export class MailStore {
  constructor({
    configDir = getConfigDir(),
    dbPath = null,
    clock = () => new Date(),
  } = {}) {
    this.configDir = configDir;
    this.dbPath = dbPath || getMailDbPath(configDir);
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
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS host_app_users (
        id TEXT PRIMARY KEY,
        user_kind TEXT NOT NULL DEFAULT 'host_owner',
        display_name TEXT NOT NULL DEFAULT '',
        synapse_user_id TEXT NOT NULL DEFAULT '',
        default_matrix_actor_key TEXT NOT NULL DEFAULT 'human',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        disabled_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_host_app_users_synapse_user_id
        ON host_app_users(synapse_user_id)
        WHERE synapse_user_id != '';

      CREATE TABLE IF NOT EXISTS mail_items (
        id TEXT PRIMARY KEY,
        recipient_user_id TEXT NOT NULL DEFAULT 'host_owner',
        recipient_synapse_user_id TEXT NOT NULL DEFAULT '',
        mailbox TEXT NOT NULL DEFAULT 'inbox',
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body_format TEXT NOT NULL DEFAULT 'markdown',
        body_markdown TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        schedule_id TEXT NOT NULL DEFAULT '',
        schedule_run_id TEXT NOT NULL DEFAULT '',
        site_url TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'info',
        tags_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        read_at TEXT,
        archived_at TEXT,
        deleted_at TEXT,
        FOREIGN KEY(recipient_user_id) REFERENCES host_app_users(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_items_idempotency
        ON mail_items(idempotency_key)
        WHERE idempotency_key != '';

      CREATE INDEX IF NOT EXISTS idx_mail_items_inbox_created
        ON mail_items(recipient_user_id, mailbox, archived_at, deleted_at, created_at);

      CREATE INDEX IF NOT EXISTS idx_mail_items_unread
        ON mail_items(recipient_user_id, read_at, archived_at, deleted_at, created_at);

      CREATE INDEX IF NOT EXISTS idx_mail_items_schedule_run
        ON mail_items(schedule_id, schedule_run_id);

      CREATE TABLE IF NOT EXISTS mail_item_links (
        id TEXT PRIMARY KEY,
        mail_id TEXT NOT NULL,
        label TEXT NOT NULL,
        href TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT 'external',
        created_at TEXT NOT NULL,
        FOREIGN KEY(mail_id) REFERENCES mail_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_mail_item_links_mail_id
        ON mail_item_links(mail_id);

      CREATE TABLE IF NOT EXISTS mail_events (
        id TEXT PRIMARY KEY,
        mail_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'system',
        actor_id TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY(mail_id) REFERENCES mail_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_mail_events_mail_id_created
        ON mail_events(mail_id, created_at);

      CREATE TABLE IF NOT EXISTS host_capability_grants (
        token_hash TEXT PRIMARY KEY,
        grant_kind TEXT NOT NULL DEFAULT 'scheduler_run',
        target_host_ref TEXT NOT NULL DEFAULT 'local',
        target_host_origin TEXT NOT NULL DEFAULT '',
        target_host_fingerprint TEXT NOT NULL DEFAULT '',
        actor_type TEXT NOT NULL DEFAULT 'scheduler',
        actor_id TEXT NOT NULL DEFAULT '',
        recipient_user_id TEXT NOT NULL DEFAULT 'host_owner',
        schedule_id TEXT NOT NULL DEFAULT '',
        schedule_run_id TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL DEFAULT '',
        scopes_json TEXT NOT NULL DEFAULT '["mail:create"]',
        constraints_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        used_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    this.statements = this.prepareStatements();
    this.seedDefaultHostOwner();
    this.initialized = true;
    return this;
  }

  prepareStatements() {
    return {
      upsertHostOwner: this.db.prepare(`
        INSERT INTO host_app_users (
          id, user_kind, display_name, synapse_user_id,
          default_matrix_actor_key, created_at, updated_at, disabled_at
        )
        VALUES (
          @id, @user_kind, @display_name, @synapse_user_id,
          @default_matrix_actor_key, @created_at, @updated_at, NULL
        )
        ON CONFLICT(id) DO NOTHING
      `),
      getHostAppUser: this.db.prepare(`
        SELECT * FROM host_app_users WHERE id = ?
      `),
      insertMailItem: this.db.prepare(`
        INSERT INTO mail_items (
          id, recipient_user_id, recipient_synapse_user_id, mailbox, title,
          summary, body_format, body_markdown, body_html, source_type,
          source_name, source_ref, agent_id, session_id, schedule_id,
          schedule_run_id, site_url, severity, tags_json, metadata_json,
          idempotency_key, created_at, updated_at, read_at, archived_at,
          deleted_at
        )
        VALUES (
          @id, @recipient_user_id, @recipient_synapse_user_id, @mailbox, @title,
          @summary, @body_format, @body_markdown, @body_html, @source_type,
          @source_name, @source_ref, @agent_id, @session_id, @schedule_id,
          @schedule_run_id, @site_url, @severity, @tags_json, @metadata_json,
          @idempotency_key, @created_at, @updated_at, NULL, NULL, NULL
        )
      `),
      updateMailItem: this.db.prepare(`
        UPDATE mail_items
        SET title = @title,
            summary = @summary,
            body_format = @body_format,
            body_markdown = @body_markdown,
            body_html = @body_html,
            source_name = @source_name,
            source_ref = @source_ref,
            agent_id = @agent_id,
            session_id = @session_id,
            schedule_id = @schedule_id,
            schedule_run_id = @schedule_run_id,
            site_url = @site_url,
            severity = @severity,
            tags_json = @tags_json,
            metadata_json = @metadata_json,
            updated_at = @updated_at
        WHERE id = @id AND deleted_at IS NULL
      `),
      getMailItem: this.db.prepare(`
        SELECT * FROM mail_items WHERE id = ? AND deleted_at IS NULL
      `),
      getMailItemIncludingDeleted: this.db.prepare(`
        SELECT * FROM mail_items WHERE id = ?
      `),
      findMailByIdempotencyKey: this.db.prepare(`
        SELECT * FROM mail_items WHERE idempotency_key = ? LIMIT 1
      `),
      listMailLinks: this.db.prepare(`
        SELECT * FROM mail_item_links
        WHERE mail_id = ?
        ORDER BY created_at ASC, id ASC
      `),
      deleteMailLinks: this.db.prepare(`
        DELETE FROM mail_item_links WHERE mail_id = ?
      `),
      insertMailLink: this.db.prepare(`
        INSERT INTO mail_item_links (
          id, mail_id, label, href, link_type, created_at
        )
        VALUES (
          @id, @mail_id, @label, @href, @link_type, @created_at
        )
      `),
      insertMailEvent: this.db.prepare(`
        INSERT INTO mail_events (
          id, mail_id, event_type, actor_type, actor_id, details_json, created_at
        )
        VALUES (
          @id, @mail_id, @event_type, @actor_type, @actor_id, @details_json, @created_at
        )
      `),
      listMailEvents: this.db.prepare(`
        SELECT * FROM mail_events
        WHERE mail_id = ?
        ORDER BY created_at ASC, id ASC
      `),
      markMailRead: this.db.prepare(`
        UPDATE mail_items
        SET read_at = @read_at,
            updated_at = @updated_at
        WHERE id = @id AND deleted_at IS NULL
      `),
      markMailUnread: this.db.prepare(`
        UPDATE mail_items
        SET read_at = NULL,
            updated_at = @updated_at
        WHERE id = @id AND deleted_at IS NULL
      `),
      archiveMail: this.db.prepare(`
        UPDATE mail_items
        SET archived_at = @archived_at,
            updated_at = @updated_at
        WHERE id = @id AND deleted_at IS NULL
      `),
      unarchiveMail: this.db.prepare(`
        UPDATE mail_items
        SET archived_at = NULL,
            updated_at = @updated_at
        WHERE id = @id AND deleted_at IS NULL
      `),
      deleteMail: this.db.prepare(`
        UPDATE mail_items
        SET deleted_at = @deleted_at,
            updated_at = @updated_at
        WHERE id = @id AND deleted_at IS NULL
      `),
      insertCapabilityGrant: this.db.prepare(`
        INSERT INTO host_capability_grants (
          token_hash, grant_kind, target_host_ref, target_host_origin,
          target_host_fingerprint, actor_type, actor_id, recipient_user_id,
          schedule_id, schedule_run_id, agent_id, scopes_json,
          constraints_json, created_at, expires_at, revoked_at, used_count
        )
        VALUES (
          @token_hash, @grant_kind, @target_host_ref, @target_host_origin,
          @target_host_fingerprint, @actor_type, @actor_id, @recipient_user_id,
          @schedule_id, @schedule_run_id, @agent_id, @scopes_json,
          @constraints_json, @created_at, @expires_at, NULL, 0
        )
      `),
      getCapabilityGrant: this.db.prepare(`
        SELECT * FROM host_capability_grants WHERE token_hash = ?
      `),
      incrementCapabilityGrantUse: this.db.prepare(`
        UPDATE host_capability_grants
        SET used_count = used_count + 1
        WHERE token_hash = ?
      `),
      revokeCapabilityGrant: this.db.prepare(`
        UPDATE host_capability_grants
        SET revoked_at = @revoked_at
        WHERE token_hash = @token_hash
      `),
      schemaTables: this.db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'host_app_users',
            'mail_items',
            'mail_item_links',
            'mail_events',
            'host_capability_grants'
          )
        ORDER BY name ASC
      `),
    };
  }

  seedDefaultHostOwner() {
    const createdAt = nowIso(this.clock);
    this.statements.upsertHostOwner.run({
      id: DEFAULT_HOST_APP_USER_ID,
      user_kind: "host_owner",
      display_name: "Host Owner",
      synapse_user_id: "",
      default_matrix_actor_key: "human",
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  getHostAppUser(id = DEFAULT_HOST_APP_USER_ID) {
    this.initialize();
    return mapHostAppUserRow(
      this.statements.getHostAppUser.get(
        normalizeRequiredString(id, "host app user id")
      )
    );
  }

  requireHostAppUser(id = DEFAULT_HOST_APP_USER_ID) {
    const user = this.getHostAppUser(id);
    if (!user || user.disabled_at) {
      throw new Error(`Host app user is not available: ${id}`);
    }
    return user;
  }

  createMailItem(input = {}) {
    this.initialize();
    const normalized = this.normalizeMailItemInput(input);
    const existing = normalized.idempotency_key
      ? this.statements.findMailByIdempotencyKey.get(normalized.idempotency_key)
      : null;
    if (existing) {
      return {
        created: false,
        mail: this.getMailItem(existing.id, { includeDeleted: true }),
      };
    }

    const tx = this.db.transaction(() => {
      this.statements.insertMailItem.run(normalized);
      this.replaceMailLinks(normalized.id, input.links || [], normalized.created_at);
      this.recordMailEvent(normalized.id, "created", {
        actorType: input.actorType || "system",
        actorId: input.actorId || "",
        details: { idempotency_key: normalized.idempotency_key },
        createdAt: normalized.created_at,
      });
    });
    tx();
    return { created: true, mail: this.getMailItem(normalized.id) };
  }

  updateMailItem(id, input = {}) {
    this.initialize();
    const current = this.requireMailItem(id);
    const updatedAt = nowIso(this.clock);
    const bodyMarkdown =
      input.bodyMarkdown !== undefined
        ? normalizeOptionalString(input.bodyMarkdown)
        : current.body_markdown;
    const bodyHtml =
      input.bodyHtml !== undefined
        ? normalizeOptionalString(input.bodyHtml)
        : current.body_html;
    const bodyFormat = normalizeBodyFormat(
      input.bodyFormat || current.body_format,
      { bodyMarkdown, bodyHtml }
    );
    this.statements.updateMailItem.run({
      id: current.id,
      title:
        input.title !== undefined
          ? normalizeRequiredString(input.title, "mail title")
          : current.title,
      summary:
        input.summary !== undefined
          ? normalizeOptionalString(input.summary)
          : current.summary,
      body_format: bodyFormat,
      body_markdown: bodyMarkdown,
      body_html: bodyHtml,
      source_name:
        input.sourceName !== undefined
          ? normalizeOptionalString(input.sourceName)
          : current.source_name,
      source_ref:
        input.sourceRef !== undefined
          ? normalizeOptionalString(input.sourceRef)
          : current.source_ref,
      agent_id:
        input.agentId !== undefined
          ? normalizeOptionalString(input.agentId)
          : current.agent_id,
      session_id:
        input.sessionId !== undefined
          ? normalizeOptionalString(input.sessionId)
          : current.session_id,
      schedule_id:
        input.scheduleId !== undefined
          ? normalizeOptionalString(input.scheduleId)
          : current.schedule_id,
      schedule_run_id:
        input.scheduleRunId !== undefined
          ? normalizeOptionalString(input.scheduleRunId)
          : current.schedule_run_id,
      site_url:
        input.siteUrl !== undefined
          ? normalizeOptionalString(input.siteUrl)
          : current.site_url,
      severity:
        input.severity !== undefined
          ? normalizeOptionalString(input.severity, "info")
          : current.severity,
      tags_json: serializePayload(
        input.tags !== undefined ? normalizeTags(input.tags) : current.tags,
        "tags",
        []
      ),
      metadata_json: serializePayload(
        input.metadata !== undefined ? input.metadata : current.metadata,
        "metadata",
        {}
      ),
      updated_at: updatedAt,
    });
    if (input.links !== undefined) {
      this.replaceMailLinks(current.id, input.links, updatedAt);
    }
    this.recordMailEvent(current.id, "updated", {
      actorType: input.actorType || "system",
      actorId: input.actorId || "",
      details: input.eventDetails || {},
      createdAt: updatedAt,
    });
    return this.getMailItem(current.id);
  }

  getMailItem(id, { includeDeleted = false } = {}) {
    this.initialize();
    const row = includeDeleted
      ? this.statements.getMailItemIncludingDeleted.get(
          normalizeRequiredString(id, "mail id")
        )
      : this.statements.getMailItem.get(normalizeRequiredString(id, "mail id"));
    return this.mapMailItemWithChildren(row);
  }

  requireMailItem(id) {
    const mail = this.getMailItem(id);
    if (!mail) throw new Error(`Mail item not found: ${id}`);
    return mail;
  }

  listMailItems({
    recipientUserId = DEFAULT_HOST_APP_USER_ID,
    filter = "inbox",
    limit = 50,
  } = {}) {
    this.initialize();
    const normalizedRecipient = normalizeRequiredString(
      recipientUserId,
      "recipientUserId"
    );
    const normalizedFilter = normalizeMailFilter(filter);
    const normalizedLimit = normalizePositiveInteger(limit, "limit");
    let where = "recipient_user_id = ? AND deleted_at IS NULL";
    if (normalizedFilter === "inbox") {
      where += " AND mailbox = 'inbox' AND archived_at IS NULL";
    } else if (normalizedFilter === "unread") {
      where += " AND mailbox = 'inbox' AND archived_at IS NULL AND read_at IS NULL";
    } else if (normalizedFilter === "archived") {
      where += " AND archived_at IS NOT NULL";
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM mail_items
         WHERE ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(normalizedRecipient, normalizedLimit);
    return rows.map((row) => this.mapMailItemWithChildren(row));
  }

  getUnreadCount({ recipientUserId = DEFAULT_HOST_APP_USER_ID } = {}) {
    this.initialize();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM mail_items
         WHERE recipient_user_id = ?
           AND mailbox = 'inbox'
           AND read_at IS NULL
           AND archived_at IS NULL
           AND deleted_at IS NULL`
      )
      .get(normalizeRequiredString(recipientUserId, "recipientUserId"));
    return row.count;
  }

  markMailItemRead(id, opts = {}) {
    return this.transitionMailItem(id, "read", this.statements.markMailRead, {
      read_at: nowIso(this.clock),
      ...opts,
    });
  }

  markMailItemUnread(id, opts = {}) {
    return this.transitionMailItem(id, "unread", this.statements.markMailUnread, opts);
  }

  archiveMailItem(id, opts = {}) {
    return this.transitionMailItem(id, "archived", this.statements.archiveMail, {
      archived_at: nowIso(this.clock),
      ...opts,
    });
  }

  unarchiveMailItem(id, opts = {}) {
    return this.transitionMailItem(id, "unarchived", this.statements.unarchiveMail, opts);
  }

  deleteMailItem(id, opts = {}) {
    return this.transitionMailItem(id, "deleted", this.statements.deleteMail, {
      deleted_at: nowIso(this.clock),
      ...opts,
    });
  }

  createCapabilityGrant({
    token = null,
    tokenByteLength = 32,
    grantKind = "scheduler_run",
    targetHostRef = "local",
    targetHostOrigin = "",
    targetHostFingerprint = "",
    actorType = "scheduler",
    actorId = "",
    recipientUserId = DEFAULT_HOST_APP_USER_ID,
    scheduleId = "",
    scheduleRunId = "",
    agentId = "",
    scopes = [MAIL_CREATE_SCOPE],
    constraints = {},
    expiresAt = null,
  } = {}) {
    this.initialize();
    const rawToken =
      token || randomBytes(normalizePositiveInteger(tokenByteLength, "tokenByteLength")).toString("base64url");
    const normalizedScopes = normalizeScopes(scopes);
    const normalizedRecipient = normalizeRequiredString(
      recipientUserId,
      "recipientUserId"
    );
    this.requireHostAppUser(normalizedRecipient);
    const createdAt = nowIso(this.clock);
    const normalizedExpiresAt =
      expiresAt || new Date(Date.parse(createdAt) + 60 * 60 * 1000).toISOString();
    const tokenHash = hashCapabilityToken(rawToken);
    this.statements.insertCapabilityGrant.run({
      token_hash: tokenHash,
      grant_kind: normalizeRequiredString(grantKind, "grantKind"),
      target_host_ref: normalizeRequiredString(targetHostRef, "targetHostRef"),
      target_host_origin: normalizeOptionalString(targetHostOrigin),
      target_host_fingerprint: normalizeOptionalString(targetHostFingerprint),
      actor_type: normalizeRequiredString(actorType, "actorType"),
      actor_id: normalizeOptionalString(actorId),
      recipient_user_id: normalizedRecipient,
      schedule_id: normalizeOptionalString(scheduleId),
      schedule_run_id: normalizeOptionalString(scheduleRunId),
      agent_id: normalizeOptionalString(agentId),
      scopes_json: serializePayload(normalizedScopes, "scopes", []),
      constraints_json: serializePayload(constraints, "constraints", {}),
      created_at: createdAt,
      expires_at: normalizeTimestamp(normalizedExpiresAt, "expiresAt"),
    });
    return {
      token: rawToken,
      grant: this.getCapabilityGrantByHash(tokenHash),
    };
  }

  verifyCapabilityToken(token, { scope = MAIL_CREATE_SCOPE } = {}) {
    this.initialize();
    if (typeof token !== "string" || !token.trim()) {
      return { ok: false, reason: "missing_token" };
    }
    const tokenHash = hashCapabilityToken(token);
    const grant = this.getCapabilityGrantByHash(tokenHash);
    if (!grant) return { ok: false, reason: "unknown_token" };
    if (grant.revoked_at) return { ok: false, reason: "revoked" };
    if (Date.parse(grant.expires_at) <= Date.parse(nowIso(this.clock))) {
      return { ok: false, reason: "expired" };
    }
    const normalizedScope = normalizeRequiredString(scope, "capability scope");
    if (!grant.scopes.includes(normalizedScope)) {
      return { ok: false, reason: "missing_scope" };
    }
    this.statements.incrementCapabilityGrantUse.run(tokenHash);
    return {
      ok: true,
      grant: this.getCapabilityGrantByHash(tokenHash),
    };
  }

  revokeCapabilityGrant(token, { revokedAt = nowIso(this.clock) } = {}) {
    this.initialize();
    const tokenHash = hashCapabilityToken(token);
    this.statements.revokeCapabilityGrant.run({
      token_hash: tokenHash,
      revoked_at: normalizeTimestamp(revokedAt, "revokedAt"),
    });
    return this.getCapabilityGrantByHash(tokenHash);
  }

  getCapabilityGrantByHash(tokenHash) {
    this.initialize();
    return mapCapabilityGrantRow(
      this.statements.getCapabilityGrant.get(
        normalizeRequiredString(tokenHash, "capability token hash")
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

  normalizeMailItemInput(input) {
    const recipientUserId = normalizeOptionalString(
      input.recipientUserId,
      DEFAULT_HOST_APP_USER_ID
    );
    this.requireHostAppUser(recipientUserId);
    const bodyMarkdown = normalizeOptionalString(input.bodyMarkdown);
    const bodyHtml = normalizeOptionalString(input.bodyHtml);
    if (!bodyMarkdown && !bodyHtml) {
      throw new Error("mail body_markdown or body_html required");
    }
    const createdAt = nowIso(this.clock);
    return {
      id: normalizeOptionalString(input.id, `mail_${randomUUID()}`),
      recipient_user_id: recipientUserId,
      recipient_synapse_user_id: normalizeOptionalString(
        input.recipientSynapseUserId
      ),
      mailbox: "inbox",
      title: normalizeRequiredString(input.title, "mail title"),
      summary: normalizeOptionalString(input.summary),
      body_format: normalizeBodyFormat(input.bodyFormat, {
        bodyMarkdown,
        bodyHtml,
      }),
      body_markdown: bodyMarkdown,
      body_html: bodyHtml,
      source_type: normalizeRequiredString(input.sourceType, "sourceType"),
      source_name: normalizeOptionalString(input.sourceName),
      source_ref: normalizeOptionalString(input.sourceRef),
      agent_id: normalizeOptionalString(input.agentId),
      session_id: normalizeOptionalString(input.sessionId),
      schedule_id: normalizeOptionalString(input.scheduleId),
      schedule_run_id: normalizeOptionalString(input.scheduleRunId),
      site_url: normalizeOptionalString(input.siteUrl),
      severity: normalizeOptionalString(input.severity, "info"),
      tags_json: serializePayload(normalizeTags(input.tags), "tags", []),
      metadata_json: serializePayload(input.metadata, "metadata", {}),
      idempotency_key: normalizeOptionalString(input.idempotencyKey),
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  replaceMailLinks(mailId, links, createdAt = nowIso(this.clock)) {
    if (!Array.isArray(links)) throw new Error("links must be an array");
    this.statements.deleteMailLinks.run(mailId);
    for (const link of links) {
      this.statements.insertMailLink.run({
        id: normalizeOptionalString(link.id, `mail_link_${randomUUID()}`),
        mail_id: mailId,
        label: normalizeRequiredString(link.label, "link label"),
        href: normalizeRequiredString(link.href, "link href"),
        link_type: normalizeOptionalString(link.linkType, "external"),
        created_at: createdAt,
      });
    }
  }

  recordMailEvent(
    mailId,
    eventType,
    {
      actorType = "system",
      actorId = "",
      details = {},
      createdAt = nowIso(this.clock),
    } = {}
  ) {
    this.statements.insertMailEvent.run({
      id: `mail_event_${randomUUID()}`,
      mail_id: normalizeRequiredString(mailId, "mail id"),
      event_type: normalizeRequiredString(eventType, "mail event type"),
      actor_type: normalizeRequiredString(actorType, "mail event actorType"),
      actor_id: normalizeOptionalString(actorId),
      details_json: serializePayload(details, "mail event details", {}),
      created_at: createdAt,
    });
  }

  transitionMailItem(id, eventType, statement, opts = {}) {
    this.initialize();
    const mailId = normalizeRequiredString(id, "mail id");
    this.requireMailItem(mailId);
    const updatedAt = nowIso(this.clock);
    const payload = {
      id: mailId,
      updated_at: updatedAt,
    };
    if (Object.prototype.hasOwnProperty.call(opts, "read_at")) {
      payload.read_at = normalizeTimestamp(opts.read_at, "readAt");
    }
    if (Object.prototype.hasOwnProperty.call(opts, "archived_at")) {
      payload.archived_at = normalizeTimestamp(opts.archived_at, "archivedAt");
    }
    if (Object.prototype.hasOwnProperty.call(opts, "deleted_at")) {
      payload.deleted_at = normalizeTimestamp(opts.deleted_at, "deletedAt");
    }
    statement.run(payload);
    this.recordMailEvent(mailId, eventType, {
      actorType: opts.actorType || "system",
      actorId: opts.actorId || "",
      details: opts.eventDetails || {},
      createdAt: updatedAt,
    });
    return this.getMailItem(mailId, { includeDeleted: eventType === "deleted" });
  }

  mapMailItemWithChildren(row) {
    if (!row) return null;
    const links = this.statements.listMailLinks.all(row.id).map(mapMailLinkRow);
    const events = this.statements.listMailEvents.all(row.id).map(mapMailEventRow);
    return mapMailItemRow(row, { links, events });
  }
}
