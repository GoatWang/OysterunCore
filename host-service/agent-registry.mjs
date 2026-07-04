import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { writeAtomicJsonFile } from "./atomic-file.mjs";

const CONFIG_DIR = process.env.OYSTERUN_CONFIG_DIR || join(homedir(), ".oysterun");
const REGISTRY_PATH = join(CONFIG_DIR, "agent-registry.json");

function readRegistry() {
  if (!existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeRegistry(registry) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeAtomicJsonFile(REGISTRY_PATH, registry);
}

export function getAgentFolder(agentId) {
  const registry = readRegistry();
  return registry[agentId]?.agent_folder || null;
}

export function setAgentFolder(agentId, agentFolder, sessionId = null) {
  const registry = readRegistry();
  registry[agentId] = {
    ...(registry[agentId] || {}),
    agent_folder: agentFolder,
    last_known_session_id: sessionId ?? registry[agentId]?.last_known_session_id ?? null,
    last_used_at: new Date().toISOString(),
  };
  writeRegistry(registry);
  return registry[agentId];
}

export function updateAgentSession(agentId, sessionId) {
  const registry = readRegistry();
  registry[agentId] = {
    ...(registry[agentId] || {}),
    last_known_session_id: sessionId,
    last_used_at: new Date().toISOString(),
  };
  writeRegistry(registry);
  return registry[agentId];
}

export function readAgentRegistry() {
  return readRegistry();
}
