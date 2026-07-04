import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = process.env.OYSTERUN_CONFIG_DIR || join(homedir(), ".oysterun");
const SESSION_HISTORY_PATH = join(CONFIG_DIR, "session-history.json");
const MAX_SESSION_HISTORY = 20;
const SESSION_HISTORY_KEYS = [
  "session_id",
  "session_name",
  "parent_session_id",
  "agent_id",
  "agent_folder",
  "runtime",
  "model",
  "provider_resume_id",
  "provider_thread_id",
  "provider_transport",
  "created_at",
  "last_active_at",
];

function sanitizeSessionRecord(record) {
  if (!record || typeof record !== "object") {
    throw new Error("Session history record must be an object");
  }
  const nextRecord = {};
  for (const key of SESSION_HISTORY_KEYS) {
    if (record[key] !== undefined) {
      nextRecord[key] = record[key];
    }
  }
  return nextRecord;
}

function readSessionHistoryFile() {
  if (!existsSync(SESSION_HISTORY_PATH)) return [];
  const raw = readFileSync(SESSION_HISTORY_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid session history format: expected array in ${SESSION_HISTORY_PATH}`);
  }
  return parsed.map(sanitizeSessionRecord);
}

function writeSessionHistoryFile(records) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SESSION_HISTORY_PATH, JSON.stringify(records.map(sanitizeSessionRecord), null, 2) + "\n");
}

function sortNewestFirst(records) {
  return [...records].sort((a, b) => {
    const aTime = Date.parse(a.last_active_at || a.created_at || 0);
    const bTime = Date.parse(b.last_active_at || b.created_at || 0);
    return bTime - aTime;
  });
}

export function pruneHistory(records = readSessionHistoryFile()) {
  const pruned = sortNewestFirst(records).slice(0, MAX_SESSION_HISTORY);
  writeSessionHistoryFile(pruned);
  return pruned;
}

export function getSessionHistory() {
  return sortNewestFirst(readSessionHistoryFile()).slice(0, MAX_SESSION_HISTORY);
}

export function saveSessionRecord(record) {
  if (!record || typeof record !== "object") {
    throw new Error("saveSessionRecord requires a record object");
  }
  if (!record.session_id) {
    throw new Error("saveSessionRecord requires record.session_id");
  }
  if (!record.session_name) {
    throw new Error("saveSessionRecord requires record.session_name");
  }
  if (!record.agent_id) {
    throw new Error("saveSessionRecord requires record.agent_id");
  }
  if (!record.agent_folder) {
    throw new Error("saveSessionRecord requires record.agent_folder");
  }

  const records = readSessionHistoryFile();
  const nowIso = new Date().toISOString();
  const nextRecord = sanitizeSessionRecord({
    ...record,
    created_at: record.created_at || nowIso,
    last_active_at: record.last_active_at || nowIso,
  });

  const existingIndex = records.findIndex((entry) => entry.session_id === record.session_id);
  if (existingIndex >= 0) {
    records[existingIndex] = sanitizeSessionRecord({ ...records[existingIndex], ...nextRecord });
  } else {
    records.push(nextRecord);
  }

  return pruneHistory(records);
}

export function updateSessionRecord(sessionId, updates) {
  if (!sessionId) {
    throw new Error("updateSessionRecord requires sessionId");
  }
  if (!updates || typeof updates !== "object") {
    throw new Error("updateSessionRecord requires updates object");
  }

  const records = readSessionHistoryFile();
  const existingIndex = records.findIndex((entry) => entry.session_id === sessionId);
  if (existingIndex < 0) {
    throw new Error(`Session history record not found: ${sessionId}`);
  }

  records[existingIndex] = sanitizeSessionRecord({
    ...records[existingIndex],
    ...updates,
  });

  return pruneHistory(records);
}

export function deleteSessionRecord(sessionId) {
  if (!sessionId) {
    throw new Error("deleteSessionRecord requires sessionId");
  }
  const records = readSessionHistoryFile();
  const nextRecords = records.filter((entry) => entry.session_id !== sessionId);
  writeSessionHistoryFile(nextRecords);
  return sortNewestFirst(nextRecords).slice(0, MAX_SESSION_HISTORY);
}

export function getSessionHistoryPath() {
  return SESSION_HISTORY_PATH;
}
