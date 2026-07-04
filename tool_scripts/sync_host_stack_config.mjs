#!/usr/bin/env node

import {
  ensureProductDefaultBrowsePath,
  readConfig,
  writeConfig,
} from "../host-service/config.mjs";
import { detectProviderCommands } from "../host-service/provider-command-detection.mjs";

function parseHostPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`OYSTERUN_PORT must be a positive integer, got: ${value}`);
  }
  return port;
}

function isMissingCommand(value) {
  return typeof value !== "string" || !value.trim();
}

function isMissingPath(value) {
  return typeof value !== "string" || !value.trim();
}

function isBareProviderCommandName(value, key) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("/")) return false;
  if (key === "claude_command") return trimmed === "claude";
  if (key === "codex_command") return trimmed === "codex";
  return false;
}

const config = readConfig();
const detectedCommands = detectProviderCommands();
const updates = {
  port: parseHostPort(process.env.OYSTERUN_PORT),
};

if (isMissingPath(config.default_browse_path)) {
  updates.default_browse_path = ensureProductDefaultBrowsePath();
}

for (const key of ["claude_command", "codex_command"]) {
  const detected = detectedCommands[key];
  if (
    (isMissingCommand(config[key]) ||
      isBareProviderCommandName(config[key], key)) &&
    typeof detected === "string" &&
    detected.trim()
  ) {
    updates[key] = detected.trim();
  }
}

writeConfig(updates);
