#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_MODULE = "scheduler";

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
const result = spawnSync(cli.command, [...cli.args, PRODUCT_MODULE, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`oysterun ${PRODUCT_MODULE}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
