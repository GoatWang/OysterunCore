#!/usr/bin/env node

import { readLocalServiceControlToken, LOCAL_SERVICE_CONTROL_HEADER } from "../service-control-token.mjs";

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function parseArgs(argv) {
  const out = {
    trigger:
      normalizeString(process.env.OYSTERUN_RESTART_RESTORE_TRIGGER) ||
      "cli_service_restart_restore_sessions",
    hostUrl:
      normalizeString(process.env.OYSTERUN_RESTART_RESTORE_HOST_URL) ||
      null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--trigger") {
      if (i + 1 >= argv.length) throw new Error("--trigger requires a value");
      out.trigger = normalizeString(argv[++i]) || out.trigger;
      continue;
    }
    if (arg === "--host-url") {
      if (i + 1 >= argv.length) throw new Error("--host-url requires a value");
      out.hostUrl = normalizeString(argv[++i]);
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node host-service/cli/prepare-restart-restore.mjs [--trigger <name>] [--host-url <url>]

Prepares the running local Host for restore-aware service restart.
Requires OYSTERUN_CONFIG_DIR and OYSTERUN_PORT when --host-url is omitted.`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  const configDir = normalizeString(process.env.OYSTERUN_CONFIG_DIR);
  if (!configDir) {
    throw new Error("OYSTERUN_CONFIG_DIR is required");
  }
  const port = normalizeString(process.env.OYSTERUN_PORT);
  const hostUrl = opts.hostUrl || (port ? `http://127.0.0.1:${port}` : null);
  if (!hostUrl) {
    throw new Error("OYSTERUN_PORT or --host-url is required");
  }
  const tokenRecord = readLocalServiceControlToken({ configDir });
  const endpoint = `${hostUrl.replace(/\/+$/, "")}/admin/restart-prepare`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [LOCAL_SERVICE_CONTROL_HEADER]: tokenRecord.token,
    },
    body: JSON.stringify({ trigger: opts.trigger }),
  });
  const raw = await resp.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  if (!resp.ok) {
    const error = payload?.error || raw || `HTTP ${resp.status}`;
    throw new Error(`Host restart restore prepare failed: ${error}`);
  }
  const summary = payload?.restart_restore || {};
  const counts = summary.counts || {};
  console.log(
    [
      "[oysterun-service] Host restart restore state prepared.",
      `restart_id=${summary.restart_id || "-"}`,
      `sessions=${counts.sessions ?? 0}`,
      `loops=${counts.loops ?? 0}`,
      `trigger=${summary.trigger || opts.trigger}`,
    ].join(" ")
  );
}

main().catch((err) => {
  console.error(`[oysterun-service] error: ${err.message}`);
  process.exit(1);
});
