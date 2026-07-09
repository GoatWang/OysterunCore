#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from "node:fs";
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
  ["service:uninstall", "uninstall"],
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

function parseUninstallArgs(args = []) {
  const options = {
    confirm: null,
    dryRun: false,
    help: false,
    keepConfig: false,
    stack: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--keep-config") {
      options.keepConfig = true;
    } else if (arg === "--confirm") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--confirm requires a value");
      }
      options.confirm = value;
      index += 1;
    } else if (arg.startsWith("--confirm=")) {
      options.confirm = arg.slice("--confirm=".length);
    } else if (arg === "--stack") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--stack requires production, staging, or all");
      }
      options.stack = value;
      index += 1;
    } else if (arg.startsWith("--stack=")) {
      options.stack = arg.slice("--stack=".length);
    } else {
      throw new Error(`unknown uninstall argument: ${arg}`);
    }
  }

  if (
    options.stack !== null &&
    !["production", "staging", "all"].includes(options.stack)
  ) {
    throw new Error("--stack must be production, staging, or all");
  }
  if (options.confirm !== null && options.confirm !== "DELETE") {
    throw new Error("config deletion requires --confirm DELETE exactly");
  }
  if (options.keepConfig && options.confirm === "DELETE") {
    throw new Error("--keep-config cannot be combined with --confirm DELETE");
  }

  return options;
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
  oysterun uninstall [--confirm DELETE] [--keep-config] [--dry-run]
  oysterun service:start
  oysterun service:stop
  oysterun service:restart [--restore-sessions]
  oysterun service:status
  oysterun service:logs [--follow]
  oysterun service:uninstall [--stack production|staging|all]
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

function printUninstallHelp() {
  console.log(`Oysterun uninstall

Usage:
  oysterun uninstall [--confirm DELETE] [--keep-config] [--dry-run]
  oysterun uninstall --stack production|staging|all [options]

Behavior:
  - Stops/removes managed Oysterun service state where available.
  - Preserves the config directory unless --confirm DELETE is supplied exactly.
  - Does not delete the Default Browse Root or agent folders.
  - Does not remove the global npm package; run npm uninstall -g oysterun after
    service/config cleanup if you want to remove the CLI itself.
`);
}

function readConfiguredDefaultBrowsePath() {
  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) return "";
    const raw = readRawConfigSource();
    return typeof raw.default_browse_path === "string"
      ? raw.default_browse_path.trim()
      : "";
  } catch {
    return "";
  }
}

function runUninstall(args = []) {
  let options;
  try {
    options = parseUninstallArgs(args);
  } catch (error) {
    console.error(`oysterun uninstall: ${error.message}`);
    console.error("Run 'oysterun uninstall --help' for usage.");
    process.exit(2);
  }

  if (options.help) {
    printUninstallHelp();
    return;
  }

  const configPath = getConfigPath();
  const configDir = dirname(configPath);
  const defaultBrowsePath = readConfiguredDefaultBrowsePath();
  const deleteConfig = options.confirm === "DELETE";
  const serviceArgs = ["uninstall"];
  if (options.stack) {
    serviceArgs.push("--stack", options.stack);
  }

  console.log("Oysterun uninstall plan:");
  console.log(`  Service cleanup: ${options.dryRun ? "dry-run" : "execute"}`);
  console.log(
    `  Config directory: ${
      deleteConfig ? `delete ${configDir}` : `preserve ${configDir}`
    }`
  );
  console.log(
    `  Default Browse Root: preserve${
      defaultBrowsePath ? ` ${defaultBrowsePath}` : ""
    }`
  );
  console.log("  Global CLI package: preserve");
  console.log("");

  if (!deleteConfig) {
    console.log(
      "Config deletion is skipped. Re-run with --confirm DELETE to delete the config directory."
    );
  }
  console.log(
    "Default Browse Root and agent folders are never deleted by this command; remove them manually only if intended."
  );
  console.log(
    "To remove the global CLI after cleanup, run: npm uninstall -g oysterun"
  );

  if (options.dryRun) {
    console.log("Dry run complete: no service or config changes were made.");
    return;
  }

  const result = spawnSync(releaseServiceScript, serviceArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(
      `oysterun uninstall: failed to run service cleanup: ${result.error.message}`
    );
    process.exit(1);
  }
  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }

  if (deleteConfig) {
    rmSync(configDir, { recursive: true, force: true });
    console.log(`Deleted config directory: ${configDir}`);
  } else {
    console.log(`Preserved config directory: ${configDir}`);
  }
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
  case "uninstall":
    runUninstall(rest);
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
