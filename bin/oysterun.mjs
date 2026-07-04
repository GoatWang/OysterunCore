#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getConfigPath,
  readRawConfigSource,
} from "../host-service/config.mjs";
import {
  PRODUCT_CLI_MODULES,
  runProductCli,
} from "../host-service/cli/product-cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const setupScript = join(repoRoot, "host-service", "setup.mjs");
const releaseServiceScript = join(
  repoRoot,
  "tool_scripts",
  "oysterun_release_service.sh"
);
const packageJsonPath = join(repoRoot, "package.json");
const hostPackageJsonPath = join(repoRoot, "host-service", "package.json");

const serviceCommands = new Map([
  ["service:install", "install"],
  ["service:start", "start"],
  ["service:stop", "stop"],
  ["service:restart", "restart"],
  ["service:status", "status"],
  ["service:logs", "logs"],
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`oysterun: failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

function runSetup(args = []) {
  const setupArgs = args.includes("--local")
    ? args.filter((arg) => arg !== "--local")
    : ["--release-setup", ...args];
  run(process.execPath, [setupScript, ...setupArgs]);
}

function runService(command, args = []) {
  run(releaseServiceScript, [command, ...args]);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function inspectConfig() {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {
      configured: false,
      configPath,
      missing: ["config.json"],
      raw: {},
    };
  }

  const raw = readRawConfigSource();
  const missing = [];
  const port = Number(raw.port);
  if (!Number.isInteger(port) || port <= 0) missing.push("port");
  if (!isNonEmptyString(raw.dashboard_password_hash)) {
    missing.push("dashboard_password_hash");
  }
  if (
    !isNonEmptyString(raw.direct_host_url) &&
    !isNonEmptyString(raw.public_base_url)
  ) {
    missing.push("direct_host_url or public_base_url");
  }

  return {
    configured: missing.length === 0,
    configPath,
    missing,
    raw,
  };
}

function readPackageVersion() {
  for (const path of [packageJsonPath, hostPackageJsonPath]) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Keep version reporting best-effort so diagnostics never trigger setup.
    }
  }
  return "unknown";
}

function printVersion() {
  console.log(`oysterun ${readPackageVersion()}`);
}

function printHelp() {
  console.log(`Oysterun Host

Usage:
  oysterun
  oysterun --version
  oysterun setup [options]
  oysterun show-qr
  oysterun service:start
  oysterun service:stop
  oysterun service:restart [--restore-sessions]
  oysterun service:status
  oysterun service:logs [--follow]
  oysterun <module> <action> [options]

Product modules:
  auth, sessions, chat, scheduler, mail, notifications, website, telegram

First run:
  If Host config is missing or incomplete, 'oysterun' enters setup.

Install contract:
  npm install -g oysterun installs files only. It does not run setup or start
  the Host service.
`);
}

function printConfiguredStatus(status) {
  const config = status.raw;
  const url =
    config.direct_host_url ||
    config.public_base_url ||
    (config.port ? `http://localhost:${config.port}` : "(unknown)");
  console.log("Oysterun Host is configured.");
  console.log(`Config: ${status.configPath}`);
  console.log(`Web:    ${url}/app/sessions`);
  console.log("");
  console.log("Common commands:");
  console.log("  oysterun service:start");
  console.log("  oysterun service:restart");
  console.log("  oysterun service:restart --restore-sessions");
  console.log("  oysterun service:logs");
  console.log("  oysterun show-qr");
  console.log("");
  console.log("Service status:");
  const result = spawnSync(releaseServiceScript, ["status"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.log(`  unavailable: ${result.error.message}`);
  }
}

const args = process.argv.slice(2);
const command = args[0] || "";
const rest = args.slice(1);

switch (command) {
  case "":
    {
      const status = inspectConfig();
      if (!status.configured) {
        console.log("Oysterun Host setup is required.");
        console.log(`Config: ${status.configPath}`);
        console.log(`Missing: ${status.missing.join(", ")}`);
        console.log("");
        runSetup([]);
      }
      printConfiguredStatus(status);
    }
    break;
  case "setup":
    runSetup(rest);
    break;
  case "show-qr":
    run(process.execPath, [setupScript, "--show-qr", ...rest]);
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "version":
  case "--version":
  case "-v":
    printVersion();
    break;
  default:
    if (serviceCommands.has(command)) {
      runService(serviceCommands.get(command), rest);
      break;
    }
    if (PRODUCT_CLI_MODULES.has(command)) {
      const exitCode = await runProductCli({
        argv: args,
        env: process.env,
        stdout: process.stdout,
        stderr: process.stderr,
      });
      process.exit(exitCode);
    }
    console.error(`oysterun: unknown command: ${command}`);
    console.error("Run 'oysterun --help' for usage.");
    process.exit(2);
}
