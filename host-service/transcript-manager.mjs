import { existsSync, readFileSync } from "fs";
import { getAgentFolderBucket, getTranscriptRoot } from "./session-assets.mjs";
import { getTranscriptStore, initializeTranscriptStore } from "./transcript-store.mjs";

export class TranscriptNotFoundError extends Error {
  constructor(transcriptPath) {
    super(`Transcript not found: ${transcriptPath}`);
    this.name = "TranscriptNotFoundError";
    this.code = "ENOENT";
    this.transcriptPath = transcriptPath;
  }
}

function requireTranscript(result, transcriptPath) {
  if (result === null) {
    throw new TranscriptNotFoundError(transcriptPath);
  }
  return result;
}

export function appendTurn(agentFolder, agentId, sessionId, turnData) {
  return getTranscriptStore().appendTurn(agentFolder, agentId, sessionId, turnData);
}

export function updateTranscriptMessageTurnId(sessionId, messageId, turnId) {
  return getTranscriptStore().updateMessageTurnId(sessionId, messageId, turnId);
}

export function getTranscript(agentFolder, agentId, sessionId) {
  const transcriptPath = getTranscriptPath(agentFolder, agentId, sessionId);
  return requireTranscript(getTranscriptStore().getTranscript(agentFolder, agentId, sessionId), transcriptPath);
}

export function getTranscriptPage(agentFolder, agentId, sessionId, options = {}) {
  const transcriptPath = getTranscriptPath(agentFolder, agentId, sessionId);
  return requireTranscript(getTranscriptStore().getTranscriptPage(agentFolder, agentId, sessionId, options), transcriptPath);
}

export function getTranscriptMessagesAfter(agentFolder, agentId, sessionId, options = {}) {
  const transcriptPath = getTranscriptPath(agentFolder, agentId, sessionId);
  return requireTranscript(getTranscriptStore().getTranscriptMessagesAfter(agentFolder, agentId, sessionId, options), transcriptPath);
}

export function searchTranscript(agentFolder, agentId, sessionId, options = {}) {
  const transcriptPath = getTranscriptPath(agentFolder, agentId, sessionId);
  return requireTranscript(getTranscriptStore().searchSessionMessages(agentFolder, agentId, sessionId, options), transcriptPath);
}

export function getTranscriptAttachments(agentFolder, agentId, sessionId, options = {}) {
  const transcriptPath = getTranscriptPath(agentFolder, agentId, sessionId);
  return requireTranscript(getTranscriptStore().getSessionAttachmentMessages(agentFolder, agentId, sessionId, options), transcriptPath);
}

export function getTranscriptCleanupDryRunStatus() {
  return getTranscriptStore().getTranscriptCleanupDryRunStatus();
}

export function searchSessionHistory(agentId, options = {}) {
  return getTranscriptStore().searchSessionsByAgent(agentId, options);
}

export function copyTranscript(agentFolder, agentId, sourceSessionId, targetSessionId) {
  const transcriptPath = getTranscriptPath(agentFolder, agentId, sourceSessionId);
  return requireTranscript(
    getTranscriptStore().copyTranscriptForResume(agentFolder, agentId, sourceSessionId, targetSessionId),
    transcriptPath,
  );
}

export function getTranscriptPath(agentFolder, agentId, sessionId) {
  return getTranscriptStore().getTranscriptStoragePath(agentFolder, agentId, sessionId);
}

export function listTranscripts(agentFolder, agentId) {
  return getTranscriptStore().listTranscripts(agentFolder, agentId);
}

export function pruneTranscripts() {
  return getTranscriptStore().pruneExpiredSessions();
}

export function initializeTranscripts() {
  return initializeTranscriptStore();
}

export function getLegacyTranscriptBucketDir(agentFolder, agentId) {
  return `${getTranscriptRoot()}/${getAgentFolderBucket(agentFolder, agentId)}`;
}

export function readTranscriptStorageBytes(agentFolder, agentId, sessionId) {
  const transcriptPath = getTranscriptPath(agentFolder, agentId, sessionId);
  if (!existsSync(transcriptPath)) {
    throw new TranscriptNotFoundError(transcriptPath);
  }
  return readFileSync(transcriptPath, "utf-8");
}
