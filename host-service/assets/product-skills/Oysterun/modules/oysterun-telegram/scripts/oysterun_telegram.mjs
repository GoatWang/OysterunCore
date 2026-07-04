#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_MODULE = "telegram";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hasCliDashboardTokenArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--token" || arg.startsWith("--token=")) return true;
  }
  return false;
}

function hasLiveSessionRuntimeCapabilityEnv(env = process.env) {
  return Boolean(
    normalizeString(env.OYSTERUN_HOST_ORIGIN) &&
      (normalizeString(env.OYSTERUN_CAPABILITY_TOKEN) ||
        normalizeString(env.OYSTERUN_MAIL_WRITE_TOKEN)) &&
      normalizeString(env.OYSTERUN_SESSION_ID)
  );
}

function shouldUseCurrentSessionTelegram(argv, env = process.env) {
  const action = normalizeString(argv[0]);
  const explicitDashboardAuth =
    hasCliDashboardTokenArg(argv) || normalizeString(env.OYSTERUN_DASHBOARD_TOKEN);
  return (
    action === "status" &&
    hasLiveSessionRuntimeCapabilityEnv(env) &&
    !explicitDashboardAuth
  );
}

function resolveProductArgs(argv = process.argv.slice(2), env = process.env) {
  if (shouldUseCurrentSessionTelegram(argv, env)) {
    return ["sessions", "telegram", "get", ...argv.slice(1)];
  }
  return [PRODUCT_MODULE, ...argv];
}

function findRepoCli() {
  let current = resolve(dirname(fileURLToPath(import.meta.url)));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, "bin", "oysterun.mjs");
    if (existsSync(candidate)) return candidate;
    const next = dirname(current);
    if (next === current) break;
    current = next;
  }
  return "";
}

function resolveCli() {
  const explicit = process.env.OYSTERUN_CLI_BIN?.trim();
  if (explicit) {
    return explicit.endsWith(".mjs")
      ? { command: process.execPath, args: [explicit] }
      : { command: explicit, args: [] };
  }
  const repoCli = findRepoCli();
  if (repoCli) return { command: process.execPath, args: [repoCli] };
  return { command: "oysterun", args: [] };
}

const cli = resolveCli();
const result = spawnSync(cli.command, [...cli.args, ...resolveProductArgs()], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`oysterun ${PRODUCT_MODULE}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
