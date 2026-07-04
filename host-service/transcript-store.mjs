import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, extname, join, resolve } from "path";
import { getConfigDir, getHostDbPath } from "./config.mjs";
import { readAgentRegistry } from "./agent-registry.mjs";
import { buildLinkAnnotations } from "./link-annotations.mjs";
import { getAgentFolderBucket, getTranscriptRoot } from "./session-assets.mjs";
import { getSessionHistory } from "./session-history.mjs";

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".gif",
]);
const UPLOAD_CONTENT_TYPES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".gif": "image/gif",
});
const TRANSCRIPT_CLEANUP_TABLES = Object.freeze({
  chat_sessions: {
    table: "chat_sessions",
    cleanup_scope: "legacy_transcript_session_metadata",
  },
  chat_messages: {
    table: "chat_messages",
    cleanup_scope: "legacy_transcript_message_rows",
  },
  chat_attachments: {
    table: "chat_attachments",
    cleanup_scope: "legacy_transcript_attachment_references",
  },
  legacy_transcript_migrations: {
    table: "legacy_transcript_migrations",
    cleanup_scope: "legacy_json_migration_bookkeeping",
  },
});
const PRESERVED_NON_CHAT_TABLES = Object.freeze([
  "host_app_users",
  "host_capability_grants",
  "mail_items",
  "mail_item_links",
  "mail_events",
  "schedules",
  "schedule_runs",
  "schedule_run_logs",
  "session_name_counters",
]);
const P39F_DO_NOT_CLEAN_STACK_NAME = "staging";
const P39F_DO_NOT_CLEAN_PORT = 9902;
const P39F_DO_NOT_CLEAN_REASON = "current live 9902 Host is staging stack";
const P39F_DISALLOWED_DB_PATH_MARKERS = Object.freeze([
  ".backup",
  ".bak",
  ".quarantine",
  ".pre_repair",
  "-backup",
  "-quarantine",
  "backup",
  "quarantine",
  "pre_repair",
]);
const P39F_TARGET_TABLE_ORDER = Object.freeze([
  "chat_attachments",
  "chat_messages",
  "chat_sessions",
  "legacy_transcript_migrations",
]);
const P39F_OWNER_APPROVED_STACK_DB_TARGETS = Object.freeze([
  "beta",
  "test2",
  "test3",
  "test4",
  "test_w29",
  "test_w30",
  "test_w31",
  "test_w6",
]);
const P39F_OWNER_EXCLUDED_DB_TARGETS = Object.freeze([
  {
    target_label: "beta_session_reset_backup_20260526_224252",
    path_segments: [
      ".oysterun-stacks",
      "beta",
      "host",
      "session-reset-backups",
      "20260526_224252",
      "oysterun.sqlite",
    ],
    reason: "backup_db_requires_separate_owner_approval",
  },
  {
    target_label: "test_w6_routec_292_quarantine_transcripts_db",
    path_segments: [
      ".oysterun-stacks",
      "test_w6",
      "host",
      "quarantine_20260523T015357Z_routec_292_obsolete_dbs",
      "transcripts.db",
    ],
    reason: "quarantine_db_requires_separate_owner_approval",
  },
]);

function buildTranscriptCleanupTableStatus(definition, count = null) {
  return {
    table: definition.table,
    count,
    cleanup_scope: definition.cleanup_scope,
    dry_run_status_only: true,
    destructive_cleanup: false,
  };
}

function normalizeGuardPath(value) {
  const resolved = resolve(String(value || ""));
  const real = statSync(resolved, { throwIfNoEntry: false })
    ? realpathSync(resolved)
    : resolved;
  return real.replace(/\/+$/, "");
}

function isPathWithinGuardRoot(candidate, root) {
  const normalizedCandidate = normalizeGuardPath(candidate);
  const normalizedRoot = normalizeGuardPath(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

function readHostPortFromConfigDir(configDir) {
  const configPath = join(configDir, "config.json");
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const port = Number(config?.port);
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}

function readStackOriginRecords(configDir) {
  const stackDir = dirname(configDir);
  const runDir = join(stackDir, "run");
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .filter((entry) => entry.endsWith(".origin.tsv"))
    .map((entry) => {
      const originPath = join(runDir, entry);
      try {
        const content = readFileSync(originPath, "utf8");
        return { origin_path: originPath, content };
      } catch {
        return { origin_path: originPath, content: "" };
      }
    });
}

function originRecordHasPort(record, port) {
  return record.content
    .split(/\r?\n/)
    .some((line) => line.trim() === `host_port\t${port}`);
}

function buildP39FDoNotCleanHostDir() {
  return join(
    homedir(),
    ".oysterun-stacks",
    P39F_DO_NOT_CLEAN_STACK_NAME,
    "host"
  );
}

function buildP39FOwnerApprovedDbTargets() {
  const home = homedir();
  return [
    {
      target_label: "legacy_default_transcripts_db",
      db_path: normalizeGuardPath(join(home, ".oysterun", "transcripts.db")),
      db_kind: "legacy_transcripts_db",
      owner_approved_first_cleanup_candidate: true,
      expected_legacy_tables: [...P39F_TARGET_TABLE_ORDER],
    },
    ...P39F_OWNER_APPROVED_STACK_DB_TARGETS.map((stackName) => ({
      target_label: `${stackName}_host_oysterun_sqlite`,
      stack_name: stackName,
      db_path: normalizeGuardPath(
        join(home, ".oysterun-stacks", stackName, "host", "oysterun.sqlite")
      ),
      db_kind: "host_oysterun_sqlite",
      owner_approved_first_cleanup_candidate: true,
      expected_legacy_tables: [...P39F_TARGET_TABLE_ORDER],
    })),
  ];
}

function buildP39FOwnerExcludedDbTargets() {
  const home = homedir();
  return P39F_OWNER_EXCLUDED_DB_TARGETS.map((target) => ({
    target_label: target.target_label,
    db_path: normalizeGuardPath(join(home, ...target.path_segments)),
    owner_approved_first_cleanup_candidate: false,
    excluded_without_separate_owner_approval: true,
    reason: target.reason,
  }));
}

function findP39FDbTarget(dbPath, targets) {
  const normalizedDbPath = normalizeGuardPath(dbPath);
  return targets.find((target) => target.db_path === normalizedDbPath) || null;
}

function buildP39FGuardState(dbPath) {
  const configDir = getConfigDir();
  const doNotCleanHostDir = buildP39FDoNotCleanHostDir();
  const hostPort = readHostPortFromConfigDir(configDir);
  const originRecords = readStackOriginRecords(configDir);
  const active9902OriginHits = originRecords
    .filter((record) => originRecordHasPort(record, P39F_DO_NOT_CLEAN_PORT))
    .map((record) => record.origin_path);
  const ownerApprovedDbTargets = buildP39FOwnerApprovedDbTargets();
  const ownerExcludedDbTargets = buildP39FOwnerExcludedDbTargets();
  const ownerApprovedTarget = findP39FDbTarget(dbPath, ownerApprovedDbTargets);
  const ownerExcludedTarget = findP39FDbTarget(dbPath, ownerExcludedDbTargets);
  const blockedReasons = [];

  if (isPathWithinGuardRoot(configDir, doNotCleanHostDir)) {
    blockedReasons.push("do_not_clean_staging_host_config_dir");
  }
  if (isPathWithinGuardRoot(dbPath, doNotCleanHostDir)) {
    blockedReasons.push("do_not_clean_staging_host_db_path");
  }
  if (hostPort === P39F_DO_NOT_CLEAN_PORT) {
    blockedReasons.push("active_9902_config_port");
  }
  if (active9902OriginHits.length > 0) {
    blockedReasons.push("active_9902_origin_match");
  }

  const lowerDbPath = normalizeGuardPath(dbPath).toLowerCase();
  if (ownerExcludedTarget) {
    blockedReasons.push("owner_excluded_without_separate_approval");
  }
  if (!ownerApprovedTarget) {
    blockedReasons.push("owner_unapproved_db_path");
  }
  if (lowerDbPath.includes("/matrix/")) {
    blockedReasons.push("matrix_db_path_excluded");
  }
  if (
    P39F_DISALLOWED_DB_PATH_MARKERS.some((marker) =>
      lowerDbPath.includes(marker)
    )
  ) {
    blockedReasons.push("backup_or_quarantine_db_path_excluded");
  }

  return {
    blocked_reasons: blockedReasons,
    host_config_dir: normalizeGuardPath(configDir),
    host_db_path: normalizeGuardPath(dbPath),
    host_port: hostPort,
    do_not_clean: {
      host_dir: normalizeGuardPath(doNotCleanHostDir),
      port: P39F_DO_NOT_CLEAN_PORT,
      reason: P39F_DO_NOT_CLEAN_REASON,
    },
    origin_files_checked: originRecords.map((record) => record.origin_path),
    active_9902_origin_hits: active9902OriginHits,
    owner_approved_target: ownerApprovedTarget,
    owner_excluded_target: ownerExcludedTarget,
    owner_approved_db_targets: ownerApprovedDbTargets,
    owner_excluded_db_targets: ownerExcludedDbTargets,
  };
}

function buildP39FGuardedDryRunTargets({
  dbPath,
  guardState,
  countsByTable,
}) {
  if (guardState.blocked_reasons.length > 0) return [];
  return P39F_TARGET_TABLE_ORDER.map((table) => {
    const definition = TRANSCRIPT_CLEANUP_TABLES[table];
    return {
      target_type: "sqlite_table_rows",
      host_db_path: normalizeGuardPath(dbPath),
      table,
      candidate_count: countsByTable[table],
      cleanup_scope: definition.cleanup_scope,
      dry_run_target_only: true,
      mutation_enabled: false,
      requires_owner_runtime_proof: true,
      p39f_guarded_destructive_cleanup_candidate: true,
      owner_approved_target_label:
        guardState.owner_approved_target?.target_label || null,
    };
  });
}

function buildP39FExcludedTargets(guardState) {
  return [
    {
      target_type: "host_config_dir",
      path: guardState.do_not_clean.host_dir,
      port: guardState.do_not_clean.port,
      excluded: true,
      reason: guardState.do_not_clean.reason,
    },
    {
      target_type: "active_9902_db_process_config_origin",
      excluded: true,
      matching_origin_files: guardState.active_9902_origin_hits,
      reason: "active_9902_hosts_are_do_not_clean",
    },
    {
      target_type: "backup_or_quarantine_databases",
      excluded: true,
      path_markers: [...P39F_DISALLOWED_DB_PATH_MARKERS],
    },
    {
      target_type: "matrix_databases",
      excluded: true,
      path_marker: "/matrix/",
    },
    {
      target_type: "uploads_media_files",
      excluded: true,
      reason: "P39F source step targets transcript DB rows only",
    },
    {
      target_type: "non_chat_host_tables",
      excluded: true,
      tables: [...PRESERVED_NON_CHAT_TABLES],
    },
  ];
}

function buildP39FGuardedCleanupPlan({
  dbPath,
  guardState,
  countsByTable,
  statusBlockedReason = null,
}) {
  const blockedReasons = [...guardState.blocked_reasons];
  if (statusBlockedReason) blockedReasons.push(statusBlockedReason);
  const effectiveGuardState = {
    ...guardState,
    blocked_reasons: blockedReasons,
  };
  const dryRunTargetList = buildP39FGuardedDryRunTargets({
    dbPath,
    guardState: effectiveGuardState,
    countsByTable,
  });
  return {
    source_step: "p39f_guarded_destructive_cleanup_target_planning",
    implementation_only: true,
    cleanup_execution: false,
    mutation_enabled: false,
    mutation_performed: false,
    destructive_cleanup_ready_for_runtime_proof: false,
    dry_run_target_list_required_before_mutation: true,
    target_list_blocked: blockedReasons.length > 0,
    blocked_reason_if_unsafe:
      blockedReasons.length > 0 ? blockedReasons.join(";") : null,
    hard_exclusion: guardState.do_not_clean,
    guard_state: effectiveGuardState,
    dry_run_target_list: dryRunTargetList,
    owner_approved_db_target_list: guardState.owner_approved_db_targets,
    owner_excluded_db_target_list: guardState.owner_excluded_db_targets,
    excluded_targets: buildP39FExcludedTargets(effectiveGuardState),
  };
}

function buildTranscriptCleanupBlockedStatus(dbPath, reason) {
  const blocked = {};
  for (const [key, definition] of Object.entries(TRANSCRIPT_CLEANUP_TABLES)) {
    blocked[key] = buildTranscriptCleanupTableStatus(definition, null);
  }
  const guardState = buildP39FGuardState(dbPath);
  return {
    status: "transcript_cleanup_status_blocked",
    cleanup_mode: "dry_run_status",
    destructive_cleanup: false,
    owner_gate_required_for_delete: true,
    host_db_transcript_product_truth: false,
    product_truth_unchanged: "matrix_room_timeline",
    ...blocked,
    referenced_upload_media_count: null,
    estimated_bytes: null,
    blocked_reason_if_unsafe: reason,
    preserved_non_chat_tables: [...PRESERVED_NON_CHAT_TABLES],
    p39f_guarded_destructive_cleanup: buildP39FGuardedCleanupPlan({
      dbPath,
      guardState,
      countsByTable: Object.fromEntries(
        Object.keys(TRANSCRIPT_CLEANUP_TABLES).map((table) => [table, null])
      ),
      statusBlockedReason: reason,
    }),
    safety_metadata: {
      db_path: dbPath,
      read_only: true,
      query_only: true,
      cleanup_execution: false,
      host_startup_cleanup_enabled: false,
      host_startup_cleanup_forbidden: true,
      p39f_destructive_cleanup_owner_gated: true,
      p39f_destructive_cleanup_implemented: false,
      deletes_rows_or_files: false,
    },
  };
}

function normalizeTurnEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Transcript entry must be an object");
  }
  if (
    entry.role !== "user" &&
    entry.role !== "assistant" &&
    entry.role !== "system"
  ) {
    throw new Error(
      `Transcript entry role must be "user", "assistant", or "system", got ${entry.role}`
    );
  }
  if (typeof entry.content !== "string") {
    throw new Error("Transcript entry content must be a string");
  }
  if (
    entry.message_id !== undefined &&
    (typeof entry.message_id !== "string" || !entry.message_id.trim())
  ) {
    throw new Error(
      "Transcript entry message_id must be a non-empty string when provided"
    );
  }
  if (
    entry.parent_message_id !== undefined &&
    entry.parent_message_id !== null &&
    (typeof entry.parent_message_id !== "string" ||
      !entry.parent_message_id.trim())
  ) {
    throw new Error(
      "Transcript entry parent_message_id must be a non-empty string when provided"
    );
  }
  if (entry.tool_events !== undefined && !Array.isArray(entry.tool_events)) {
    throw new Error(
      "Transcript entry tool_events must be an array when provided"
    );
  }
  if (
    entry.link_annotations !== undefined &&
    !Array.isArray(entry.link_annotations)
  ) {
    throw new Error(
      "Transcript entry link_annotations must be an array when provided"
    );
  }
  if (entry.media !== undefined && !Array.isArray(entry.media)) {
    throw new Error("Transcript entry media must be an array when provided");
  }
  return {
    role: entry.role,
    content: entry.content,
    timestamp: entry.timestamp || entry.created_at || new Date().toISOString(),
    ...(entry.message_id !== undefined
      ? { message_id: entry.message_id.trim() }
      : {}),
    ...(entry.parent_message_id !== undefined
      ? {
          parent_message_id:
            entry.parent_message_id === null
              ? null
              : entry.parent_message_id.trim(),
        }
      : {}),
    ...(entry.tool_summary !== undefined
      ? { tool_summary: entry.tool_summary }
      : {}),
    ...(entry.tool_events !== undefined
      ? { tool_events: entry.tool_events }
      : {}),
    ...(entry.link_annotations !== undefined
      ? { link_annotations: normalizeLinkAnnotations(entry.link_annotations) }
      : {}),
    ...(entry.media !== undefined
      ? { media: normalizeTranscriptMedia(entry.media) }
      : {}),
    ...(typeof entry.message_type === "string"
      ? { message_type: entry.message_type }
      : {}),
    ...(typeof entry.turn_id === "string" ? { turn_id: entry.turn_id } : {}),
  };
}

function normalizeTurnEntries(turnData) {
  return (Array.isArray(turnData) ? turnData : [turnData]).map(
    normalizeTurnEntry
  );
}

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value).trim();
  return value.trim();
}

function serializeToolSummary(toolSummary) {
  if (toolSummary === undefined) return null;
  return JSON.stringify(toolSummary);
}

function deserializeToolSummary(rawValue) {
  if (rawValue === null || rawValue === undefined) return undefined;
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function serializeToolEvents(toolEvents) {
  if (toolEvents === undefined) return null;
  return JSON.stringify(toolEvents);
}

function deserializeToolEvents(rawValue) {
  if (rawValue === null || rawValue === undefined) return undefined;
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function normalizeOptionalLinkAnnotationString(annotation, key) {
  if (!Object.hasOwn(annotation, key)) return undefined;
  const value = annotation[key];
  if (typeof value !== "string") {
    throw new Error(`Transcript link annotation ${key} must be a string when present`);
  }
  return value;
}

function normalizeOptionalLinkAnnotationDisplayKind(annotation) {
  if (!Object.hasOwn(annotation, "path_display_kind")) return undefined;
  const value = annotation.path_display_kind;
  const allowed = new Set(["agent_relative", "absolute", "markdown_label_preserved"]);
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(
      "Transcript link annotation path_display_kind must be a supported display kind"
    );
  }
  return value;
}

function normalizeLinkAnnotation(annotation) {
  if (!annotation || typeof annotation !== "object") {
    throw new Error("Transcript link annotation must be an object");
  }
  if (typeof annotation.kind !== "string" || !annotation.kind.trim()) {
    throw new Error(
      "Transcript link annotation kind must be a non-empty string"
    );
  }
  if (typeof annotation.source !== "string" || !annotation.source.trim()) {
    throw new Error(
      "Transcript link annotation source must be a non-empty string"
    );
  }
  if (!Number.isInteger(annotation.start_utf16) || annotation.start_utf16 < 0) {
    throw new Error(
      "Transcript link annotation start_utf16 must be a non-negative integer"
    );
  }
  if (
    !Number.isInteger(annotation.end_utf16) ||
    annotation.end_utf16 <= annotation.start_utf16
  ) {
    throw new Error(
      "Transcript link annotation end_utf16 must be an integer greater than start_utf16"
    );
  }
  if (typeof annotation.raw_text !== "string") {
    throw new Error("Transcript link annotation raw_text must be a string");
  }
  if (typeof annotation.target !== "string" || !annotation.target.trim()) {
    throw new Error(
      "Transcript link annotation target must be a non-empty string"
    );
  }
  if (
    typeof annotation.open_mode !== "string" ||
    !annotation.open_mode.trim()
  ) {
    throw new Error(
      "Transcript link annotation open_mode must be a non-empty string"
    );
  }
  const collapsedDisplayText = normalizeOptionalLinkAnnotationString(
    annotation,
    "collapsed_display_text"
  );
  const pathDisplayText = normalizeOptionalLinkAnnotationString(
    annotation,
    "path_display_text"
  );
  const pathDisplayKind = normalizeOptionalLinkAnnotationDisplayKind(annotation);
  return {
    kind: annotation.kind.trim(),
    source: annotation.source.trim(),
    display_text:
      typeof annotation.display_text === "string"
        ? annotation.display_text
        : annotation.raw_text,
    start_utf16: annotation.start_utf16,
    end_utf16: annotation.end_utf16,
    raw_text: annotation.raw_text,
    target: annotation.target.trim(),
    open_mode: annotation.open_mode.trim(),
    ...(collapsedDisplayText !== undefined
      ? { collapsed_display_text: collapsedDisplayText }
      : {}),
    ...(pathDisplayText !== undefined ? { path_display_text: pathDisplayText } : {}),
    ...(pathDisplayKind !== undefined ? { path_display_kind: pathDisplayKind } : {}),
  };
}

function normalizeLinkAnnotations(value) {
  return (Array.isArray(value) ? value : []).map(normalizeLinkAnnotation);
}

function serializeLinkAnnotations(linkAnnotations) {
  if (linkAnnotations === undefined) return null;
  return JSON.stringify(normalizeLinkAnnotations(linkAnnotations));
}

function deserializeLinkAnnotations(rawValue) {
  if (rawValue === null || rawValue === undefined) return undefined;
  try {
    return normalizeLinkAnnotations(JSON.parse(rawValue));
  } catch {
    return undefined;
  }
}

function isImageAttachmentPath(filePath) {
  return IMAGE_ATTACHMENT_EXTENSIONS.has(
    extname(String(filePath || "")).toLowerCase()
  );
}

function getAttachmentContentType(filePath) {
  return (
    UPLOAD_CONTENT_TYPES[extname(String(filePath || "")).toLowerCase()] || null
  );
}

function extractAttachmentPaths(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("[Attached files]")) return [];
  const lines = normalized.split("\n");
  if ((lines[0] || "").trim() !== "[Attached files]") return [];
  const paths = [];
  let index = 1;
  while (index < lines.length) {
    const trimmed = (lines[index] || "").trim();
    if (!trimmed) break;
    paths.push(trimmed);
    index += 1;
  }
  return paths;
}

function buildAttachmentMetadata(content, createdAt) {
  const attachmentPaths = extractAttachmentPaths(content);
  return attachmentPaths.map((filePath, index) => {
    const storedName = basename(filePath);
    const fileStats = statSync(filePath, { throwIfNoEntry: false });
    return {
      attachment_index: index,
      file_path: filePath,
      stored_name: storedName,
      original_name: null,
      content_type: getAttachmentContentType(filePath),
      size_bytes: fileStats?.isFile() ? fileStats.size : null,
      is_image: isImageAttachmentPath(filePath) ? 1 : 0,
      created_at: createdAt,
    };
  });
}

function normalizeTranscriptMediaEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Transcript media entry must be an object");
  }
  const resourceRef = normalizeString(entry.resource_ref ?? entry.file_path);
  if (!resourceRef) {
    throw new Error(
      "Transcript media entry resource_ref must be a non-empty string"
    );
  }
  const filename =
    normalizeString(
      entry.filename ?? entry.original_name ?? entry.stored_name
    ) || basename(resourceRef);
  const mimeType =
    normalizeString(entry.mime_type ?? entry.content_type) || null;
  const numericSize = Number(entry.byte_size ?? entry.size_bytes);
  const byteSize =
    Number.isFinite(numericSize) && numericSize >= 0
      ? Math.floor(numericSize)
      : null;
  const isImage =
    entry.is_image === true ||
    entry.is_image === 1 ||
    isImageAttachmentPath(resourceRef);
  return {
    resource_ref: resourceRef,
    filename,
    mime_type: mimeType,
    byte_size: byteSize,
    is_image: isImage,
  };
}

function normalizeTranscriptMedia(value) {
  return (Array.isArray(value) ? value : []).map(normalizeTranscriptMediaEntry);
}

function buildAttachmentMetadataFromExplicitMedia(media, createdAt) {
  return normalizeTranscriptMedia(media).map((entry, index) => ({
    attachment_index: index,
    file_path: entry.resource_ref,
    stored_name: entry.filename || basename(entry.resource_ref),
    original_name: entry.filename || null,
    content_type:
      entry.mime_type || getAttachmentContentType(entry.resource_ref),
    size_bytes: entry.byte_size,
    is_image: entry.is_image === true ? 1 : 0,
    created_at: createdAt,
  }));
}

function legacyTranscriptDir(agentFolder, agentId) {
  return join(getTranscriptRoot(), getAgentFolderBucket(agentFolder, agentId));
}

function legacyTranscriptPath(agentFolder, agentId, sessionId) {
  return join(legacyTranscriptDir(agentFolder, agentId), `${sessionId}.json`);
}

function readLegacyTranscriptFile(transcriptPath, { optional = false } = {}) {
  if (!existsSync(transcriptPath)) {
    if (optional) return [];
    return null;
  }
  const raw = readFileSync(transcriptPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Invalid transcript format: expected array in ${transcriptPath}`
    );
  }
  return parsed;
}

function listLegacyTranscriptFiles() {
  const transcriptRoot = getTranscriptRoot();
  if (!existsSync(transcriptRoot)) return [];
  return readdirSync(transcriptRoot)
    .map((bucketName) => {
      const bucketPath = join(transcriptRoot, bucketName);
      const bucketStats = statSync(bucketPath, { throwIfNoEntry: false });
      if (!bucketStats?.isDirectory()) return [];
      return readdirSync(bucketPath)
        .filter((name) => name.endsWith(".json"))
        .map((name) => join(bucketPath, name));
    })
    .flat();
}

function buildLegacyTranscriptSummary(
  agentFolder,
  agentId,
  migratedSessionIds = new Set()
) {
  const transcriptDir = legacyTranscriptDir(agentFolder, agentId);
  if (!existsSync(transcriptDir)) return [];
  return readdirSync(transcriptDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const sessionId = name.replace(/\.json$/, "");
      if (migratedSessionIds.has(sessionId)) return null;
      const path = join(transcriptDir, name);
      const stats = statSync(path, { throwIfNoEntry: false });
      if (!stats?.isFile()) return null;
      const entries = readLegacyTranscriptFile(path, { optional: true }) || [];
      return {
        session_id: sessionId,
        path,
        updated_at: stats.mtime.toISOString(),
        created_at: stats.birthtime.toISOString(),
        message_count: entries.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function readSessionHistoryRecord(sessionId) {
  return (
    getSessionHistory().find((entry) => entry.session_id === sessionId) || null
  );
}

function toPageCursor(row) {
  if (!row) return null;
  return {
    created_at: row.created_at,
    seq: row.seq,
  };
}

function serializeAttachmentForMessage(attachment) {
  return {
    file_path: attachment.file_path,
    stored_name: attachment.stored_name,
    original_name: attachment.original_name,
    content_type: attachment.content_type,
    size_bytes: attachment.size_bytes,
    is_image: Boolean(attachment.is_image),
  };
}

function canonicalMessageType(value) {
  const normalized = normalizeString(value);
  return normalized || "message";
}

function canonicalDeliveryState() {
  return "committed";
}

function serializeMediaForMessage(attachment) {
  return {
    resource_ref: attachment.file_path,
    filename:
      attachment.original_name ||
      attachment.stored_name ||
      basename(attachment.file_path),
    mime_type: attachment.content_type,
    byte_size: attachment.size_bytes,
    is_image: Boolean(attachment.is_image),
  };
}

function serializeClientFacingMessage({
  id = null,
  seq = null,
  messageId = null,
  parentMessageId = null,
  role,
  text,
  messageType = "message",
  turnId = null,
  toolSummary = null,
  toolEvents = null,
  textEntities = [],
  media = [],
  createdAt,
}) {
  return {
    ...(id !== null ? { id } : {}),
    ...(seq !== null ? { seq } : {}),
    message_id: messageId,
    parent_message_id: parentMessageId,
    role,
    message_type: canonicalMessageType(messageType),
    delivery_state: canonicalDeliveryState(),
    turn_id: turnId,
    text,
    text_entities: textEntities,
    media,
    tool_summary: toolSummary,
    tool_events: toolEvents,
    created_at: createdAt,
    // Temporary compatibility aliases for older callers while Phase 1 freezes the canonical names.
    content: text,
    link_annotations: textEntities,
    attachments: media.map((entry) => ({
      file_path: entry.resource_ref,
      stored_name: basename(entry.resource_ref),
      original_name: entry.filename,
      content_type: entry.mime_type,
      size_bytes: entry.byte_size,
      is_image: Boolean(entry.is_image),
    })),
  };
}

function serializeLegacyMessage(entry, seq, context = {}) {
  const createdAt = entry.created_at || entry.timestamp;
  const linkAnnotations = Array.isArray(entry.link_annotations)
    ? normalizeLinkAnnotations(entry.link_annotations)
    : resolveLinkAnnotationsForContent(entry.content, context);
  const attachments =
    entry.role === "user"
      ? buildAttachmentMetadata(entry.content, createdAt)
      : [];
  return serializeClientFacingMessage({
    id: seq,
    seq,
    messageId: entry.message_id ?? null,
    parentMessageId: entry.parent_message_id ?? null,
    role: entry.role,
    text: entry.content,
    messageType: entry.message_type ?? null,
    turnId: entry.turn_id ?? null,
    toolSummary: entry.tool_summary ?? null,
    toolEvents: entry.tool_events ?? null,
    textEntities: linkAnnotations,
    media: attachments.map(serializeMediaForMessage),
    createdAt,
  });
}

function buildGeneratedTranscriptMessageId(sessionId, seq) {
  const normalizedSessionId = normalizeString(sessionId) || randomUUID();
  return `message:${normalizedSessionId}:${seq}`;
}

function escapeLikePattern(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

function buildPreviewSnippet(
  content,
  query,
  { radius = 60, maxLength = 180 } = {}
) {
  const text = String(content || "")
    .replace(/\s+/g, " ")
    .trim();
  const needle = String(query || "").trim();
  if (!text) return "";
  if (!needle) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerNeedle);
  if (matchIndex < 0) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + needle.length + radius);
  let snippet = text.slice(start, end);
  if (snippet.length > maxLength) {
    snippet = snippet.slice(0, maxLength - 1).trimEnd() + "…";
  }
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length && !snippet.endsWith("…")) snippet = `${snippet}…`;
  return snippet;
}

function createSiteFolderResolver(currentAgentId, currentAgentRoot) {
  return (candidateAgentId) => {
    if (candidateAgentId === currentAgentId && currentAgentRoot) {
      return currentAgentRoot;
    }
    return readAgentRegistry()[candidateAgentId]?.agent_folder || null;
  };
}

function resolveLinkAnnotationsForContent(
  content,
  { agentId = "", agentRoot = "", sourceFilePath = "" } = {}
) {
  return buildLinkAnnotations({
    text: content,
    agentId,
    agentRoot,
    sourceFilePath,
    resolveAgentFolderForSite: createSiteFolderResolver(agentId, agentRoot),
  });
}

export class TranscriptStore {
  constructor({ logger = console, dbPath = getHostDbPath() } = {}) {
    this.logger = logger;
    this.dbPath = dbPath;
    this.db = null;
    this.initialized = false;
  }

  getDbPath() {
    return this.dbPath;
  }

  initialize() {
    if (this.initialized) return this;

    mkdirSync(getConfigDir(), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        agent_folder_canonical TEXT NOT NULL,
        agent_folder_bucket TEXT NOT NULL,
        parent_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        migrated_from_json INTEGER NOT NULL DEFAULT 0,
        transcript_json_path TEXT,
        FOREIGN KEY (parent_session_id) REFERENCES chat_sessions(session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent_bucket_updated
        ON chat_sessions(agent_folder_bucket, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent_id_updated
        ON chat_sessions(agent_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        message_id TEXT,
        parent_message_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        tool_summary TEXT,
        tool_events TEXT,
        link_annotations TEXT,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
        UNIQUE (session_id, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_desc
        ON chat_messages(session_id, created_at DESC, seq DESC);

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq
        ON chat_messages(session_id, seq);

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_has_attachments
        ON chat_messages(session_id, has_attachments, created_at DESC, seq DESC);

      CREATE TABLE IF NOT EXISTS chat_attachments (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_folder_bucket TEXT NOT NULL,
        attachment_index INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        stored_name TEXT,
        original_name TEXT,
        content_type TEXT,
        size_bytes INTEGER,
        is_image INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_attachments_session_message
        ON chat_attachments(session_id, message_id, attachment_index);

      CREATE INDEX IF NOT EXISTS idx_chat_attachments_bucket_path
        ON chat_attachments(agent_folder_bucket, file_path);

      CREATE INDEX IF NOT EXISTS idx_chat_attachments_session_is_image
        ON chat_attachments(session_id, is_image, created_at DESC);

      CREATE TABLE IF NOT EXISTS legacy_transcript_migrations (
        session_id TEXT PRIMARY KEY,
        transcript_json_path TEXT NOT NULL,
        migrated_at TEXT NOT NULL
      );

    `);
    this.ensureChatMessageColumns();
    this.statements = this.prepareStatements();
    this.initialized = true;
    return this;
  }

  ensureChatMessageColumns() {
    const columns = this.db.prepare("PRAGMA table_info(chat_messages)").all();
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("message_id")) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN message_id TEXT");
    }
    if (!columnNames.has("tool_events")) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN tool_events TEXT");
    }
    if (!columnNames.has("parent_message_id")) {
      this.db.exec(
        "ALTER TABLE chat_messages ADD COLUMN parent_message_id TEXT"
      );
    }
    if (!columnNames.has("message_type")) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN message_type TEXT");
    }
    if (!columnNames.has("turn_id")) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN turn_id TEXT");
    }
    if (!columnNames.has("link_annotations")) {
      this.db.exec(
        "ALTER TABLE chat_messages ADD COLUMN link_annotations TEXT"
      );
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_message_id
        ON chat_messages(session_id, message_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_turn_id
        ON chat_messages(turn_id)
    `);
    this.ensureChatMessageRoleSupport();
  }

  ensureChatMessageRoleSupport() {
    const tableDefinition = this.db
      .prepare(
        `
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'chat_messages'
    `
      )
      .get();
    const tableSQL =
      typeof tableDefinition?.sql === "string" ? tableDefinition.sql : "";
    if (
      !tableSQL.includes("role IN ('user', 'assistant')") ||
      tableSQL.includes("'system'")
    ) {
      return;
    }

    this.db.exec("PRAGMA foreign_keys = OFF");
    this.db.exec(
      "ALTER TABLE chat_messages RENAME TO chat_messages_legacy_role_constraint"
    );
    this.db.exec(`
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        message_id TEXT,
        parent_message_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        tool_summary TEXT,
        tool_events TEXT,
        link_annotations TEXT,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        message_type TEXT,
        turn_id TEXT,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
        UNIQUE (session_id, seq)
      )
    `);
    this.db.exec(`
      INSERT INTO chat_messages (
        id,
        session_id,
        seq,
        message_id,
        parent_message_id,
        role,
        content,
        tool_summary,
        tool_events,
        link_annotations,
        has_attachments,
        created_at,
        message_type,
        turn_id
      )
      SELECT
        id,
        session_id,
        seq,
        message_id,
        parent_message_id,
        role,
        content,
        tool_summary,
        tool_events,
        link_annotations,
        has_attachments,
        created_at,
        message_type,
        turn_id
      FROM chat_messages_legacy_role_constraint
    `);
    this.db.exec("DROP TABLE chat_messages_legacy_role_constraint");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  prepareStatements() {
    return {
      getSession: this.db.prepare(`
        SELECT *
        FROM chat_sessions
        WHERE session_id = ?
      `),
      insertSession: this.db.prepare(`
        INSERT INTO chat_sessions (
          session_id,
          agent_id,
          agent_folder_canonical,
          agent_folder_bucket,
          parent_session_id,
          created_at,
          updated_at,
          message_count,
          migrated_from_json,
          transcript_json_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateSessionMetadata: this.db.prepare(`
        UPDATE chat_sessions
        SET updated_at = ?,
            message_count = ?,
            parent_session_id = COALESCE(parent_session_id, ?),
            migrated_from_json = CASE WHEN ? > migrated_from_json THEN ? ELSE migrated_from_json END,
            transcript_json_path = COALESCE(transcript_json_path, ?)
        WHERE session_id = ?
      `),
      maxSeq: this.db.prepare(`
        SELECT COALESCE(MAX(seq), 0) AS max_seq
        FROM chat_messages
        WHERE session_id = ?
      `),
      insertMessage: this.db.prepare(`
        INSERT INTO chat_messages (
          session_id,
          seq,
          message_id,
          parent_message_id,
          role,
          content,
          tool_summary,
          tool_events,
          link_annotations,
          message_type,
          turn_id,
          has_attachments,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertAttachment: this.db.prepare(`
        INSERT INTO chat_attachments (
          message_id,
          session_id,
          agent_id,
          agent_folder_bucket,
          attachment_index,
          file_path,
          stored_name,
          original_name,
          content_type,
          size_bytes,
          is_image,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      sessionMessagesAsc: this.db.prepare(`
        SELECT id, session_id, seq, message_id, parent_message_id, role, content, tool_summary, tool_events, link_annotations, message_type, turn_id, has_attachments, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY seq ASC
      `),
      updateMessageTurnIdByMessageId: this.db.prepare(`
        UPDATE chat_messages
        SET turn_id = ?
        WHERE session_id = ?
          AND message_id = ?
      `),
      pageNewest: this.db.prepare(`
        SELECT id, session_id, seq, message_id, parent_message_id, role, content, tool_summary, tool_events, link_annotations, message_type, turn_id, has_attachments, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY created_at DESC, seq DESC
        LIMIT ?
      `),
      pageBefore: this.db.prepare(`
        SELECT id, session_id, seq, message_id, parent_message_id, role, content, tool_summary, tool_events, link_annotations, message_type, turn_id, has_attachments, created_at
        FROM chat_messages
        WHERE session_id = ?
          AND (
            created_at < ?
            OR (created_at = ? AND seq < ?)
          )
        ORDER BY created_at DESC, seq DESC
        LIMIT ?
      `),
      messagesAfterSeq: this.db.prepare(`
        SELECT id, session_id, seq, message_id, parent_message_id, role, content, tool_summary, tool_events, link_annotations, message_type, turn_id, has_attachments, created_at
        FROM chat_messages
        WHERE session_id = ?
          AND seq > ?
        ORDER BY seq ASC
        LIMIT ?
      `),
      searchSessionMessages: this.db.prepare(`
        SELECT id, session_id, seq, message_id, parent_message_id, role, content, tool_summary, tool_events, link_annotations, message_type, turn_id, has_attachments, created_at
        FROM chat_messages
        WHERE session_id = ?
          AND content LIKE ? ESCAPE '\\'
        ORDER BY created_at DESC, seq DESC
        LIMIT ?
      `),
      sessionAttachmentMessages: this.db.prepare(`
        SELECT id, session_id, seq, message_id, parent_message_id, role, content, tool_summary, tool_events, link_annotations, message_type, turn_id, has_attachments, created_at
        FROM chat_messages
        WHERE session_id = ?
          AND has_attachments = 1
        ORDER BY created_at DESC, seq DESC
        LIMIT ?
      `),
      sessionImageAttachmentMessages: this.db.prepare(`
        SELECT DISTINCT m.id, m.session_id, m.seq, m.message_id, m.parent_message_id, m.role, m.content, m.tool_summary, m.tool_events, m.link_annotations, m.message_type, m.turn_id, m.has_attachments, m.created_at
        FROM chat_messages AS m
        INNER JOIN chat_attachments AS a ON a.message_id = m.id
        WHERE m.session_id = ?
          AND m.has_attachments = 1
          AND a.is_image = 1
        ORDER BY m.created_at DESC, m.seq DESC
        LIMIT ?
      `),
      listSessionsByBucket: this.db.prepare(`
        SELECT session_id, created_at, updated_at, message_count, transcript_json_path
        FROM chat_sessions
        WHERE agent_id = ? AND agent_folder_bucket = ?
        ORDER BY updated_at DESC
      `),
      searchSessionsByAgent: this.db.prepare(`
        SELECT
          s.session_id,
          s.created_at,
          s.updated_at,
          s.message_count,
          COUNT(m.id) AS match_count,
          MAX(m.created_at) AS latest_match_at
        FROM chat_sessions AS s
        INNER JOIN chat_messages AS m ON m.session_id = s.session_id
        WHERE s.agent_id = ?
          AND m.content LIKE ? ESCAPE '\\'
        GROUP BY s.session_id, s.created_at, s.updated_at, s.message_count
        ORDER BY latest_match_at DESC, s.updated_at DESC, s.session_id DESC
        LIMIT ?
      `),
      latestMatchingMessageForSession: this.db.prepare(`
        SELECT content, created_at
        FROM chat_messages
        WHERE session_id = ?
          AND content LIKE ? ESCAPE '\\'
        ORDER BY created_at DESC, seq DESC
        LIMIT 1
      `),
      sourceMessagesForCopy: this.db.prepare(`
        SELECT id, seq, message_id, parent_message_id, role, content, tool_summary, tool_events, link_annotations, message_type, turn_id, has_attachments, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY seq ASC
      `),
      sourceAttachmentsForCopy: this.db.prepare(`
        SELECT message_id, attachment_index, file_path, stored_name, original_name, content_type, size_bytes, is_image, created_at
        FROM chat_attachments
        WHERE session_id = ?
        ORDER BY message_id ASC, attachment_index ASC
      `),
      recordLegacyMigration: this.db.prepare(`
        INSERT INTO legacy_transcript_migrations (session_id, transcript_json_path, migrated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          transcript_json_path = excluded.transcript_json_path,
          migrated_at = excluded.migrated_at
      `),
      hasLegacyMigration: this.db.prepare(`
        SELECT 1
        FROM legacy_transcript_migrations
        WHERE session_id = ?
      `),
      allLegacyMigrations: this.db.prepare(`
        SELECT session_id
        FROM legacy_transcript_migrations
      `),
      legacyMigrationBySession: this.db.prepare(`
        SELECT session_id, transcript_json_path, migrated_at
        FROM legacy_transcript_migrations
        WHERE session_id = ?
      `),
      attachmentsBySession: this.db.prepare(`
        SELECT session_id, attachment_index, file_path, stored_name, original_name, content_type, size_bytes, is_image, created_at
        FROM chat_attachments
        WHERE session_id = ?
        ORDER BY message_id ASC, attachment_index ASC
      `),
    };
  }

  ensureInitialized() {
    if (!this.initialized) this.initialize();
    return this;
  }

  ensureSessionRecord({
    sessionId,
    agentId,
    canonicalFolder,
    bucket,
    parentSessionId = null,
    createdAt,
    updatedAt,
    migratedFromJson = 0,
    transcriptJsonPath = null,
    messageCount = 0,
  }) {
    this.ensureInitialized();
    if (parentSessionId && !this.statements.getSession.get(parentSessionId)) {
      this.statements.insertSession.run(
        parentSessionId,
        agentId,
        canonicalFolder,
        bucket,
        null,
        createdAt,
        createdAt,
        0,
        0,
        null
      );
    }
    const existing = this.statements.getSession.get(sessionId);
    if (!existing) {
      this.statements.insertSession.run(
        sessionId,
        agentId,
        canonicalFolder,
        bucket,
        parentSessionId,
        createdAt,
        updatedAt,
        messageCount,
        migratedFromJson,
        transcriptJsonPath
      );
      return this.statements.getSession.get(sessionId);
    }
    if (existing.agent_id !== agentId) {
      throw new Error(
        `Transcript session ${sessionId} agent mismatch: ${existing.agent_id} !== ${agentId}`
      );
    }
    if (existing.agent_folder_bucket !== bucket) {
      throw new Error(
        `Transcript session ${sessionId} bucket mismatch: ${existing.agent_folder_bucket} !== ${bucket}`
      );
    }
    if (existing.agent_folder_canonical !== canonicalFolder) {
      throw new Error(
        `Transcript session ${sessionId} folder mismatch: ${existing.agent_folder_canonical} !== ${canonicalFolder}`
      );
    }
    this.statements.updateSessionMetadata.run(
      updatedAt,
      messageCount,
      parentSessionId,
      migratedFromJson,
      migratedFromJson,
      transcriptJsonPath,
      sessionId
    );
    return this.statements.getSession.get(sessionId);
  }

  insertMessagesForSession({ sessionId, agentId, bucket, startSeq, entries }) {
    const insertedEntries = [];
    let nextSeq = startSeq;
    for (const entry of entries) {
      const resolvedMessageId =
        entry.message_id ??
        buildGeneratedTranscriptMessageId(sessionId, nextSeq);
      const attachments = Array.isArray(entry.media)
        ? buildAttachmentMetadataFromExplicitMedia(entry.media, entry.timestamp)
        : entry.role === "user"
        ? buildAttachmentMetadata(entry.content, entry.timestamp)
        : [];
      const result = this.statements.insertMessage.run(
        sessionId,
        nextSeq,
        resolvedMessageId,
        entry.parent_message_id ?? null,
        entry.role,
        entry.content,
        serializeToolSummary(entry.tool_summary),
        serializeToolEvents(entry.tool_events),
        serializeLinkAnnotations(entry.link_annotations),
        entry.message_type ?? null,
        entry.turn_id ?? null,
        attachments.length > 0 ? 1 : 0,
        entry.timestamp
      );
      for (const attachment of attachments) {
        this.statements.insertAttachment.run(
          result.lastInsertRowid,
          sessionId,
          agentId,
          bucket,
          attachment.attachment_index,
          attachment.file_path,
          attachment.stored_name,
          attachment.original_name,
          attachment.content_type,
          attachment.size_bytes,
          attachment.is_image,
          attachment.created_at
        );
      }
      insertedEntries.push({
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp,
        message_id: resolvedMessageId,
        ...(entry.parent_message_id !== undefined
          ? { parent_message_id: entry.parent_message_id }
          : {}),
        ...(entry.tool_summary !== undefined
          ? { tool_summary: entry.tool_summary }
          : {}),
        ...(entry.tool_events !== undefined
          ? { tool_events: entry.tool_events }
          : {}),
        ...(entry.link_annotations !== undefined
          ? { link_annotations: entry.link_annotations }
          : {}),
      });
      nextSeq += 1;
    }
    return insertedEntries;
  }

  hydrateTranscriptRows(
    rows,
    attachmentsByMessageId = new Map(),
    context = {}
  ) {
    return rows.map((row) => {
      const resolvedLinkAnnotations =
        deserializeLinkAnnotations(row.link_annotations) ??
        resolveLinkAnnotationsForContent(row.content, context);
      const toolSummary = deserializeToolSummary(row.tool_summary);
      const toolEvents = deserializeToolEvents(row.tool_events);
      return serializeClientFacingMessage({
        id: row.id,
        seq: row.seq,
        messageId:
          typeof row.message_id === "string" && row.message_id
            ? row.message_id
            : null,
        parentMessageId:
          typeof row.parent_message_id === "string" && row.parent_message_id
            ? row.parent_message_id
            : null,
        role: row.role,
        text: row.content,
        messageType: row.message_type ?? null,
        turnId: row.turn_id ?? null,
        toolSummary: toolSummary ?? null,
        toolEvents: toolEvents ?? null,
        textEntities: resolvedLinkAnnotations,
        media: (attachmentsByMessageId.get(row.id) || []).map(
          serializeMediaForMessage
        ),
        createdAt: row.created_at,
      });
    });
  }

  hydratePagedMessages(rows, attachmentsByMessageId, context = {}) {
    return rows.map((row) => {
      const attachments = attachmentsByMessageId.get(row.id) || [];
      return serializeClientFacingMessage({
        id: row.id,
        seq: row.seq,
        messageId: row.message_id ?? null,
        parentMessageId: row.parent_message_id ?? null,
        role: row.role,
        text: row.content,
        messageType: row.message_type ?? null,
        turnId: row.turn_id ?? null,
        toolSummary: deserializeToolSummary(row.tool_summary) ?? null,
        toolEvents: deserializeToolEvents(row.tool_events) ?? null,
        textEntities:
          deserializeLinkAnnotations(row.link_annotations) ??
          resolveLinkAnnotationsForContent(row.content, context),
        media: attachments.map(serializeMediaForMessage),
        createdAt: row.created_at,
      });
    });
  }

  getAttachmentsByMessageIds(messageIds) {
    this.ensureInitialized();
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return new Map();
    }
    const placeholders = messageIds.map(() => "?").join(", ");
    const query = this.db.prepare(`
      SELECT message_id, attachment_index, file_path, stored_name, original_name, content_type, size_bytes, is_image
      FROM chat_attachments
      WHERE message_id IN (${placeholders})
      ORDER BY message_id ASC, attachment_index ASC
    `);
    const grouped = new Map();
    for (const row of query.all(...messageIds)) {
      if (!grouped.has(row.message_id)) {
        grouped.set(row.message_id, []);
      }
      grouped.get(row.message_id).push(row);
    }
    return grouped;
  }

  migrateLegacyTranscriptFile(transcriptPath, historyRecord = null) {
    this.ensureInitialized();
    const stats = statSync(transcriptPath, { throwIfNoEntry: false });
    if (!stats?.isFile()) return { migrated: false, reason: "missing_file" };
    const sessionId = basename(transcriptPath, ".json");
    if (this.statements.hasLegacyMigration.get(sessionId)) {
      return { migrated: false, reason: "already_migrated" };
    }
    const record = historyRecord || readSessionHistoryRecord(sessionId);
    if (!record?.agent_id || !record?.agent_folder) {
      return {
        migrated: false,
        reason: "missing_history_record",
        sessionId,
        transcriptPath,
      };
    }
    const canonicalFolderStats = statSync(record.agent_folder, {
      throwIfNoEntry: false,
    });
    if (!canonicalFolderStats?.isDirectory()) {
      return {
        migrated: false,
        reason: "missing_agent_folder",
        sessionId,
        transcriptPath,
      };
    }
    const canonicalFolder = realpathSync(record.agent_folder);
    const bucket = getAgentFolderBucket(canonicalFolder, record.agent_id);
    if (bucket !== basename(dirname(transcriptPath))) {
      return {
        migrated: false,
        reason: "bucket_mismatch",
        sessionId,
        transcriptPath,
      };
    }
    const entries =
      readLegacyTranscriptFile(transcriptPath, { optional: true }) || [];
    const createdAt = record.created_at || stats.birthtime.toISOString();
    const updatedAt =
      record.last_active_at ||
      entries.at(-1)?.timestamp ||
      stats.mtime.toISOString();
    const migratedAt = new Date().toISOString();

    this.db.transaction(() => {
      this.ensureSessionRecord({
        sessionId,
        agentId: record.agent_id,
        canonicalFolder,
        bucket,
        parentSessionId: record.parent_session_id || null,
        createdAt,
        updatedAt,
        migratedFromJson: 1,
        transcriptJsonPath: transcriptPath,
        messageCount: entries.length,
      });

      const existingCount = this.statements.maxSeq.get(sessionId).max_seq;
      if (existingCount > 0) {
        this.statements.recordLegacyMigration.run(
          sessionId,
          transcriptPath,
          migratedAt
        );
        return;
      }
      this.insertMessagesForSession({
        sessionId,
        agentId: record.agent_id,
        bucket,
        startSeq: 1,
        entries: entries.map((entry) => {
          const normalized = normalizeTurnEntry(entry);
          if (normalized.link_annotations !== undefined) return normalized;
          return {
            ...normalized,
            link_annotations: resolveLinkAnnotationsForContent(
              normalized.content,
              {
                agentId: record.agent_id,
                agentRoot: canonicalFolder,
              }
            ),
          };
        }),
      });
      this.statements.updateSessionMetadata.run(
        updatedAt,
        entries.length,
        record.parent_session_id || null,
        1,
        1,
        transcriptPath,
        sessionId
      );
      this.statements.recordLegacyMigration.run(
        sessionId,
        transcriptPath,
        migratedAt
      );
    })();

    return { migrated: true, sessionId, transcriptPath };
  }

  migrateLegacyTranscripts() {
    this.ensureInitialized();
    const results = [];
    for (const transcriptPath of listLegacyTranscriptFiles()) {
      const result = this.migrateLegacyTranscriptFile(transcriptPath);
      if (
        result.migrated ||
        result.reason === "missing_history_record" ||
        result.reason === "bucket_mismatch" ||
        result.reason === "missing_agent_folder"
      ) {
        results.push(result);
      }
    }
    const migratedCount = results.filter((entry) => entry.migrated).length;
    const skippedCount = results.filter(
      (entry) => !entry.migrated && entry.reason !== "already_migrated"
    ).length;
    if (migratedCount > 0 || skippedCount > 0) {
      this.logger.log(
        `[transcript-store] migrated ${migratedCount} legacy transcript(s), skipped ${skippedCount}`
      );
    }
    return results;
  }

  pruneExpiredSessions(_nowIso = new Date().toISOString()) {
    this.ensureInitialized();
    return 0;
  }

  initializeAndMigrate() {
    this.ensureInitialized();
    this.migrateLegacyTranscripts();
    return this;
  }

  appendTurn(agentFolder, agentId, sessionId, turnData) {
    this.ensureInitialized();
    const canonicalFolder = realpathSync(agentFolder);
    const bucket = getAgentFolderBucket(canonicalFolder, agentId);
    const nextEntries = normalizeTurnEntries(turnData).map((entry) =>
      entry.link_annotations !== undefined
        ? entry
        : {
            ...entry,
            link_annotations: resolveLinkAnnotationsForContent(entry.content, {
              agentId,
              agentRoot: canonicalFolder,
            }),
          }
    );
    const createdAt = nextEntries[0]?.timestamp || new Date().toISOString();
    const updatedAt = nextEntries.at(-1)?.timestamp || createdAt;

    const appended = this.db.transaction(() => {
      const existing = this.statements.getSession.get(sessionId);
      const existingCount = existing?.message_count || 0;
      this.ensureSessionRecord({
        sessionId,
        agentId,
        canonicalFolder,
        bucket,
        parentSessionId: existing?.parent_session_id || null,
        createdAt: existing?.created_at || createdAt,
        updatedAt,
        migratedFromJson: existing?.migrated_from_json || 0,
        transcriptJsonPath: existing?.transcript_json_path || null,
        messageCount: existingCount + nextEntries.length,
      });
      return this.insertMessagesForSession({
        sessionId,
        agentId,
        bucket,
        startSeq: existingCount + 1,
        entries: nextEntries,
      });
    })();
    return this.getTranscript(agentFolder, agentId, sessionId);
  }

  updateMessageTurnId(sessionId, messageId, turnId) {
    this.ensureInitialized();
    if (!sessionId || !messageId || !turnId) {
      return false;
    }
    const result = this.statements.updateMessageTurnIdByMessageId.run(
      turnId,
      sessionId,
      messageId
    );
    return (result?.changes || 0) > 0;
  }

  getTranscriptSessionRow(agentFolder, agentId, sessionId) {
    this.ensureInitialized();
    const row = this.statements.getSession.get(sessionId);
    if (!row) return null;
    const canonicalFolder = realpathSync(agentFolder);
    const bucket = getAgentFolderBucket(canonicalFolder, agentId);
    if (row.agent_id !== agentId || row.agent_folder_bucket !== bucket)
      return null;
    return row;
  }

  getSessionRecord(sessionId) {
    this.ensureInitialized();
    return this.statements.getSession.get(sessionId) || null;
  }

  getAttachmentRecords(sessionId) {
    this.ensureInitialized();
    return this.statements.attachmentsBySession.all(sessionId);
  }

  getTranscriptCleanupDryRunStatus() {
    const dbPath = this.dbPath;
    if (!existsSync(dbPath)) {
      return buildTranscriptCleanupBlockedStatus(dbPath, "host_db_missing");
    }

    let readonlyDb = null;
    try {
      readonlyDb = new Database(dbPath, {
        readonly: true,
        fileMustExist: true,
      });
      readonlyDb.pragma("query_only = ON");

      const missingTables = [];
      const tableExists = readonlyDb.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `);
      for (const definition of Object.values(TRANSCRIPT_CLEANUP_TABLES)) {
        if (!tableExists.get(definition.table)) {
          missingTables.push(definition.table);
        }
      }
      if (missingTables.length > 0) {
        return buildTranscriptCleanupBlockedStatus(
          dbPath,
          `missing_required_tables:${missingTables.join(",")}`
        );
      }

      const countRows = (tableName) => {
        const row = readonlyDb
          .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
          .get();
        return Number(row?.count || 0);
      };
      const countsByTable = Object.fromEntries(
        Object.keys(TRANSCRIPT_CLEANUP_TABLES).map((table) => [
          table,
          countRows(table),
        ])
      );
      const attachmentRows = readonlyDb
        .prepare(
          `
          SELECT file_path, size_bytes
          FROM chat_attachments
          WHERE file_path IS NOT NULL AND TRIM(file_path) != ''
        `
        )
        .all();
      const referencedMedia = new Map();
      for (const row of attachmentRows) {
        if (!referencedMedia.has(row.file_path)) {
          referencedMedia.set(row.file_path, row.size_bytes);
        }
      }
      let estimatedBytes = 0;
      for (const [filePath, sizeBytes] of referencedMedia.entries()) {
        const numericSize = Number(sizeBytes);
        if (Number.isFinite(numericSize) && numericSize >= 0) {
          estimatedBytes += Math.floor(numericSize);
          continue;
        }
        const stats = statSync(filePath, { throwIfNoEntry: false });
        if (stats?.isFile()) estimatedBytes += stats.size;
      }
      const guardState = buildP39FGuardState(dbPath);

      return {
        status: "transcript_cleanup_status",
        cleanup_mode: "dry_run_status",
        destructive_cleanup: false,
        owner_gate_required_for_delete: true,
        host_db_transcript_product_truth: false,
        product_truth_unchanged: "matrix_room_timeline",
        chat_sessions: buildTranscriptCleanupTableStatus(
          TRANSCRIPT_CLEANUP_TABLES.chat_sessions,
          countsByTable.chat_sessions
        ),
        chat_messages: buildTranscriptCleanupTableStatus(
          TRANSCRIPT_CLEANUP_TABLES.chat_messages,
          countsByTable.chat_messages
        ),
        chat_attachments: buildTranscriptCleanupTableStatus(
          TRANSCRIPT_CLEANUP_TABLES.chat_attachments,
          countsByTable.chat_attachments
        ),
        legacy_transcript_migrations: buildTranscriptCleanupTableStatus(
          TRANSCRIPT_CLEANUP_TABLES.legacy_transcript_migrations,
          countsByTable.legacy_transcript_migrations
        ),
        referenced_upload_media_count: referencedMedia.size,
        estimated_bytes: estimatedBytes,
        blocked_reason_if_unsafe: null,
        preserved_non_chat_tables: [...PRESERVED_NON_CHAT_TABLES],
        p39f_guarded_destructive_cleanup: buildP39FGuardedCleanupPlan({
          dbPath,
          guardState,
          countsByTable,
        }),
        safety_metadata: {
          db_path: dbPath,
          read_only: true,
          query_only: true,
          cleanup_execution: false,
          host_startup_cleanup_enabled: false,
          host_startup_cleanup_forbidden: true,
          p39f_destructive_cleanup_owner_gated: true,
          p39f_destructive_cleanup_implemented: false,
          deletes_rows_or_files: false,
        },
      };
    } catch (err) {
      return buildTranscriptCleanupBlockedStatus(
        dbPath,
        `readonly_status_failed:${err.message}`
      );
    } finally {
      if (readonlyDb) readonlyDb.close();
    }
  }

  getLegacyMigrationRecord(sessionId) {
    this.ensureInitialized();
    return this.statements.legacyMigrationBySession.get(sessionId) || null;
  }

  getTranscript(agentFolder, agentId, sessionId) {
    const canonicalFolder = realpathSync(agentFolder);
    const sqliteSession = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sessionId
    );
    if (sqliteSession) {
      const rows = this.statements.sessionMessagesAsc.all(sessionId);
      const attachmentsByMessageId = this.getAttachmentsByMessageIds(
        rows.map((row) => row.id)
      );
      return this.hydrateTranscriptRows(rows, attachmentsByMessageId, {
        agentId,
        agentRoot: canonicalFolder,
      });
    }

    if (this.statements.hasLegacyMigration.get(sessionId)) {
      return null;
    }

    const legacyPath = legacyTranscriptPath(agentFolder, agentId, sessionId);
    const legacyEntries = readLegacyTranscriptFile(legacyPath, {
      optional: false,
    });
    if (!legacyEntries) {
      return null;
    }
    return legacyEntries.map((entry, index) => {
      const normalized = normalizeTurnEntry(entry);
      return serializeLegacyMessage(normalized, index + 1, {
        agentId,
        agentRoot: canonicalFolder,
      });
    });
  }

  getTranscriptPage(
    agentFolder,
    agentId,
    sessionId,
    { limit = 20, before = null } = {}
  ) {
    const sqliteSession = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sessionId
    );
    if (!sqliteSession) {
      const transcript = this.getTranscript(agentFolder, agentId, sessionId);
      if (!transcript) return null;
      const normalized = transcript.map((entry, index) => ({
        ...normalizeTurnEntry(entry),
        seq: index + 1,
      }));
      const filtered = before
        ? normalized.filter(
            (entry) =>
              entry.timestamp < before.created_at ||
              (entry.timestamp === before.created_at && entry.seq < before.seq)
          )
        : normalized;
      const pageRows = filtered.slice(Math.max(filtered.length - limit, 0));
      const nextCursor =
        filtered.length > pageRows.length
          ? { created_at: pageRows[0].timestamp, seq: pageRows[0].seq }
          : null;
      return {
        messages: pageRows.map((entry) =>
          serializeLegacyMessage(entry, entry.seq, {
            agentId,
            agentRoot: realpathSync(agentFolder),
          })
        ),
        page: {
          limit,
          has_more: Boolean(nextCursor),
          next_before: nextCursor,
        },
      };
    }

    const queryLimit = limit + 1;
    const rows = before
      ? this.statements.pageBefore.all(
          sessionId,
          before.created_at,
          before.created_at,
          before.seq,
          queryLimit
        )
      : this.statements.pageNewest.all(sessionId, queryLimit);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const orderedRows = [...pageRows].reverse();
    const attachmentsByMessageId = this.getAttachmentsByMessageIds(
      orderedRows.map((row) => row.id)
    );
    return {
      messages: this.hydratePagedMessages(orderedRows, attachmentsByMessageId, {
        agentId,
        agentRoot: realpathSync(agentFolder),
      }),
      page: {
        limit,
        has_more: hasMore,
        next_before: hasMore ? toPageCursor(orderedRows[0]) : null,
      },
    };
  }

  getTranscriptMessagesAfter(
    agentFolder,
    agentId,
    sessionId,
    { afterSeq = 0, limit = 20 } = {}
  ) {
    const normalizedAfterSeq =
      Number.isInteger(afterSeq) && afterSeq >= 0 ? afterSeq : 0;
    const sqliteSession = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sessionId
    );
    if (!sqliteSession) {
      const transcript = this.getTranscript(agentFolder, agentId, sessionId);
      if (!transcript) return null;
      const normalized = transcript.map((entry, index) => ({
        ...normalizeTurnEntry(entry),
        seq: index + 1,
      }));
      const filtered = normalized.filter(
        (entry) => entry.seq > normalizedAfterSeq
      );
      const pageRows = filtered.slice(0, limit);
      const latestSeq = normalized.at(-1)?.seq || 0;
      return {
        messages: pageRows.map((entry) =>
          serializeLegacyMessage(entry, entry.seq, {
            agentId,
            agentRoot: realpathSync(agentFolder),
          })
        ),
        sync: {
          after_seq: normalizedAfterSeq,
          next_after_seq: pageRows.at(-1)?.seq || normalizedAfterSeq,
          latest_seq: latestSeq,
          returned: pageRows.length,
          has_more: filtered.length > pageRows.length,
        },
      };
    }

    const queryLimit = limit + 1;
    const rows = this.statements.messagesAfterSeq.all(
      sessionId,
      normalizedAfterSeq,
      queryLimit
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const attachmentsByMessageId = this.getAttachmentsByMessageIds(
      pageRows.map((row) => row.id)
    );
    const latestSeq = this.statements.maxSeq.get(sessionId).max_seq || 0;
    return {
      messages: this.hydratePagedMessages(pageRows, attachmentsByMessageId, {
        agentId,
        agentRoot: realpathSync(agentFolder),
      }),
      sync: {
        after_seq: normalizedAfterSeq,
        next_after_seq: pageRows.at(-1)?.seq || normalizedAfterSeq,
        latest_seq: latestSeq,
        returned: pageRows.length,
        has_more: hasMore,
      },
    };
  }

  searchSessionMessages(
    agentFolder,
    agentId,
    sessionId,
    { query, limit = 20 } = {}
  ) {
    const normalizedQuery = normalizeString(query);
    if (!normalizedQuery) {
      throw new Error("q query param required");
    }
    const sqliteSession = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sessionId
    );
    if (!sqliteSession) {
      const transcript = this.getTranscript(agentFolder, agentId, sessionId);
      if (!transcript) return null;
      const needle = normalizedQuery.toLowerCase();
      const matched = transcript
        .map((entry, index) => ({
          ...normalizeTurnEntry(entry),
          seq: index + 1,
        }))
        .filter((entry) => entry.content.toLowerCase().includes(needle));
      const newestMatches = matched.slice(Math.max(matched.length - limit, 0));
      return {
        messages: newestMatches.map((entry) =>
          serializeLegacyMessage(entry, entry.seq, {
            agentId,
            agentRoot: realpathSync(agentFolder),
          })
        ),
        search: {
          query: normalizedQuery,
          limit,
          returned: newestMatches.length,
        },
      };
    }

    const likePattern = `%${escapeLikePattern(normalizedQuery)}%`;
    const rows = this.statements.searchSessionMessages.all(
      sessionId,
      likePattern,
      limit
    );
    const orderedRows = [...rows].reverse();
    const attachmentsByMessageId = this.getAttachmentsByMessageIds(
      orderedRows.map((row) => row.id)
    );
    return {
      messages: this.hydratePagedMessages(orderedRows, attachmentsByMessageId, {
        agentId,
        agentRoot: realpathSync(agentFolder),
      }),
      search: {
        query: normalizedQuery,
        limit,
        returned: orderedRows.length,
      },
    };
  }

  getSessionAttachmentMessages(
    agentFolder,
    agentId,
    sessionId,
    { limit = 20, imageOnly = false } = {}
  ) {
    const sqliteSession = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sessionId
    );
    if (!sqliteSession) {
      const transcript = this.getTranscript(agentFolder, agentId, sessionId);
      if (!transcript) return null;
      const matched = transcript
        .map((entry, index) => ({
          ...normalizeTurnEntry(entry),
          seq: index + 1,
        }))
        .filter((entry) => {
          const attachments = buildAttachmentMetadata(
            entry.content,
            entry.timestamp
          );
          if (attachments.length === 0) return false;
          if (!imageOnly) return true;
          return attachments.some((attachment) => attachment.is_image === 1);
        });
      const newestMatches = matched.slice(Math.max(matched.length - limit, 0));
      return {
        messages: newestMatches.map((entry) =>
          serializeLegacyMessage(entry, entry.seq, {
            agentId,
            agentRoot: realpathSync(agentFolder),
          })
        ),
        filters: {
          limit,
          is_image: imageOnly,
        },
      };
    }

    const rows = imageOnly
      ? this.statements.sessionImageAttachmentMessages.all(sessionId, limit)
      : this.statements.sessionAttachmentMessages.all(sessionId, limit);
    const orderedRows = [...rows].reverse();
    const attachmentsByMessageId = this.getAttachmentsByMessageIds(
      orderedRows.map((row) => row.id)
    );
    return {
      messages: this.hydratePagedMessages(orderedRows, attachmentsByMessageId, {
        agentId,
        agentRoot: realpathSync(agentFolder),
      }),
      filters: {
        limit,
        is_image: imageOnly,
      },
    };
  }

  searchSessionsByAgent(agentId, { query, limit = 20 } = {}) {
    this.ensureInitialized();
    const normalizedQuery = normalizeString(query);
    if (!normalizedQuery) {
      throw new Error("q query param required");
    }
    const likePattern = `%${escapeLikePattern(normalizedQuery)}%`;
    return this.statements.searchSessionsByAgent
      .all(agentId, likePattern, limit)
      .map((row) => {
        const previewRow = this.statements.latestMatchingMessageForSession.get(
          row.session_id,
          likePattern
        );
        return {
          session_id: row.session_id,
          match_count: row.match_count,
          preview_snippet: buildPreviewSnippet(
            previewRow?.content || "",
            normalizedQuery
          ),
          preview_created_at: previewRow?.created_at || null,
          created_at: row.created_at,
          updated_at: row.updated_at,
          message_count: row.message_count,
        };
      });
  }

  copyTranscriptForResume(
    agentFolder,
    agentId,
    sourceSessionId,
    targetSessionId
  ) {
    this.ensureInitialized();
    if (!sourceSessionId || typeof sourceSessionId !== "string") {
      throw new Error("copyTranscriptForResume requires sourceSessionId");
    }
    if (!targetSessionId || typeof targetSessionId !== "string") {
      throw new Error("copyTranscriptForResume requires targetSessionId");
    }
    if (sourceSessionId === targetSessionId) {
      throw new Error(
        "copyTranscriptForResume requires distinct source and target session ids"
      );
    }

    const canonicalFolder = realpathSync(agentFolder);
    const bucket = getAgentFolderBucket(canonicalFolder, agentId);
    const sourceRow = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sourceSessionId
    );
    if (!sourceRow) {
      const legacyPath = legacyTranscriptPath(
        agentFolder,
        agentId,
        sourceSessionId
      );
      if (
        existsSync(legacyPath) &&
        !this.statements.hasLegacyMigration.get(sourceSessionId)
      ) {
        const record = readSessionHistoryRecord(sourceSessionId) || {
          session_id: sourceSessionId,
          agent_id: agentId,
          agent_folder: canonicalFolder,
          parent_session_id: null,
        };
        this.migrateLegacyTranscriptFile(legacyPath, record);
      }
    }

    const refreshedSourceRow = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sourceSessionId
    );
    if (!refreshedSourceRow) {
      return null;
    }

    const nowIso = new Date().toISOString();
    this.db.transaction(() => {
      if (this.statements.getSession.get(targetSessionId)) {
        throw new Error(
          `Transcript session already exists: ${targetSessionId}`
        );
      }
      this.ensureSessionRecord({
        sessionId: targetSessionId,
        agentId,
        canonicalFolder,
        bucket,
        parentSessionId: sourceSessionId,
        createdAt: nowIso,
        updatedAt: nowIso,
        migratedFromJson: 0,
        transcriptJsonPath: null,
        messageCount: refreshedSourceRow.message_count,
      });

      const sourceMessages =
        this.statements.sourceMessagesForCopy.all(sourceSessionId);
      const attachmentGroups = new Map();
      for (const attachment of this.statements.sourceAttachmentsForCopy.all(
        sourceSessionId
      )) {
        if (!attachmentGroups.has(attachment.message_id)) {
          attachmentGroups.set(attachment.message_id, []);
        }
        attachmentGroups.get(attachment.message_id).push(attachment);
      }

      const seqToMessageId = new Map();
      for (const row of sourceMessages) {
        const insertResult = this.statements.insertMessage.run(
          targetSessionId,
          row.seq,
          row.message_id,
          row.parent_message_id,
          row.role,
          row.content,
          row.tool_summary,
          row.tool_events,
          row.link_annotations,
          row.message_type ?? null,
          row.turn_id ?? null,
          row.has_attachments,
          row.created_at
        );
        seqToMessageId.set(row.id, insertResult.lastInsertRowid);
      }

      for (const row of sourceMessages) {
        const targetMessageId = seqToMessageId.get(row.id);
        const attachments = attachmentGroups.get(row.id) || [];
        for (const attachment of attachments) {
          this.statements.insertAttachment.run(
            targetMessageId,
            targetSessionId,
            agentId,
            bucket,
            attachment.attachment_index,
            attachment.file_path,
            attachment.stored_name,
            attachment.original_name,
            attachment.content_type,
            attachment.size_bytes,
            attachment.is_image,
            attachment.created_at
          );
        }
      }
      this.statements.updateSessionMetadata.run(
        nowIso,
        refreshedSourceRow.message_count,
        sourceSessionId,
        0,
        0,
        null,
        targetSessionId
      );
    })();
    return this.getTranscript(agentFolder, agentId, targetSessionId);
  }

  listTranscripts(agentFolder, agentId) {
    this.ensureInitialized();
    const canonicalFolder = realpathSync(agentFolder);
    const bucket = getAgentFolderBucket(canonicalFolder, agentId);
    const sqliteTranscripts = this.statements.listSessionsByBucket
      .all(agentId, bucket)
      .map((row) => ({
        session_id: row.session_id,
        path: this.dbPath,
        updated_at: row.updated_at,
        created_at: row.created_at,
        message_count: row.message_count,
      }));
    const migratedSessionIds = new Set([
      ...sqliteTranscripts.map((row) => row.session_id),
      ...this.statements.allLegacyMigrations.all().map((row) => row.session_id),
    ]);
    const legacyTranscripts = buildLegacyTranscriptSummary(
      agentFolder,
      agentId,
      migratedSessionIds
    );
    return [...sqliteTranscripts, ...legacyTranscripts].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
    );
  }

  getTranscriptStoragePath(agentFolder, agentId, sessionId) {
    const sqliteSession = this.getTranscriptSessionRow(
      agentFolder,
      agentId,
      sessionId
    );
    if (sqliteSession) {
      return this.dbPath;
    }
    if (this.statements.hasLegacyMigration.get(sessionId)) {
      return this.dbPath;
    }
    return legacyTranscriptPath(agentFolder, agentId, sessionId);
  }

}

let defaultTranscriptStore = null;

export function getTranscriptStore() {
  if (!defaultTranscriptStore) {
    defaultTranscriptStore = new TranscriptStore();
  }
  return defaultTranscriptStore;
}

export function initializeTranscriptStore() {
  return getTranscriptStore().initializeAndMigrate();
}
