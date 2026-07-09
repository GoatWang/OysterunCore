#!/usr/bin/env node

/**
 * First-run setup for Oysterun host service.
 *
 * Default behavior configures direct/local Host access.
 * Cloud registration is optional and must be enabled explicitly.
 *
 * Usage:
 *   node setup.mjs                               # Configure direct/local Host mode
 *   node setup.mjs --display-name "My Farm"      # Set farm display name
 *   node setup.mjs --public-base-url <url>       # Set manual client connect URL
 *   node setup.mjs --dashboard-user your-user    # Set local login username
 *   node setup.mjs --dashboard-password secret   # Set local login password
 *   node setup.mjs --enable-cloud-direct         # Register direct-IP Host with Oysterun Cloud
 *   node setup.mjs --enable-cloud                # Register this Host with Oysterun Cloud
 *   node setup.mjs --backend-url <url>           # Custom Cloud backend URL
 *   node setup.mjs --show-qr                     # Re-show Cloud onboarding QR
 */

import qrcode from "qrcode-terminal";
import {
  getDefaultConfig,
  getDirectSetupDefaults,
  readConfig,
  writeConfig,
  getConfigPath,
  getConfigDir,
  getCloudIdentityPath,
  getConfigValue,
  normalizePublicBaseUrlInput,
  buildCloudApiUrl,
  resolveCloudBackendUrl,
  resolveCloudBackendStage,
  resolveDefaultBrowsePath,
  resolveDirectoryPath,
} from "./config.mjs";
import { hashDashboardPassword } from "./dashboard-password.mjs";
import {
  buildCompactDirectHostLoginQrPayload,
  buildDirectHostLoginQrPayload,
  createHostLoginBootstrapToken,
} from "./host-login-bootstrap-tokens.mjs";
import { detectProviderCommands } from "./provider-command-detection.mjs";
import { execFile, execFileSync } from "child_process";
import { createInterface } from "readline";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createServer } from "net";
import { networkInterfaces } from "os";
import { promisify } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const releaseServiceScript = join(repoRoot, "tool_scripts", "oysterun_release_service.sh");
const OYSTERUN_PHONE_APP_DOWNLOAD_URL = "https://oysterun.com";
const execFileAsync = promisify(execFile);
const SETUP_TOTAL_STEPS = 7;

function printDetectedProviderStatus(detectedCommands) {
  console.log("  Detected providers:");
  console.log(
    `  Claude: ${detectedCommands.claude_command || "disabled (not detected)"}`
  );
  console.log(
    `  Codex: ${detectedCommands.codex_command || "disabled (not detected)"}`
  );
}

function hasDetectedProvider(detectedCommands) {
  return Boolean(detectedCommands.claude_command || detectedCommands.codex_command);
}

function printNoProviderWarning() {
  console.log("\n  No agent provider was detected.");
  console.log("  Oysterun Host can still be installed, but new agent sessions need Claude Code or Codex.");
  console.log("  Install and log in to a provider as the same OS user that runs Oysterun.");
  console.log("  On Linux review installs, that user is usually `oysterun`, not `root`.");
}

async function confirmProviderPreflight(detectedCommands) {
  if (hasDetectedProvider(detectedCommands)) return true;
  if (!isInteractiveSetup()) {
    console.warn(
      "No agent provider was detected. Setup will continue, but new agent sessions need Claude Code or Codex installed for the Oysterun user."
    );
    return true;
  }

  printNoProviderWarning();
  const continueSetup = await promptYesNoDefaultNo(
    "Continue setup without an agent provider?"
  );
  if (continueSetup) return true;

  console.log("\n  Setup stopped.");
  console.log("  Install Claude Code or Codex for this OS user, then run `oysterun setup` again.");
  return false;
}

// ── Parse CLI Args ───────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--backend-url" && args[i + 1]) {
      opts.backendUrl = args[++i];
    } else if (args[i] === "--direct-host-url" && args[i + 1]) {
      opts.directHostUrl = args[++i];
    } else if (args[i] === "--enable-cloud") {
      opts.enableCloud = true;
    } else if (args[i] === "--enable-cloud-direct") {
      opts.enableCloudDirect = true;
    } else if (args[i] === "--display-name" && args[i + 1]) {
      opts.displayName = args[++i];
    } else if (args[i] === "--public-base-url" && args[i + 1]) {
      opts.publicBaseUrl = args[++i];
    } else if (args[i] === "--default-browse-root" && args[i + 1]) {
      opts.defaultBrowseRoot = args[++i];
    } else if (args[i] === "--dashboard-user" && args[i + 1]) {
      opts.dashboardUser = args[++i];
    } else if (args[i] === "--dashboard-password" && args[i + 1]) {
      opts.dashboardPassword = args[++i];
    } else if (args[i] === "--host-password" && args[i + 1]) {
      opts.hostPassword = args[++i];
    } else if (args[i] === "--ngrok-domain" && args[i + 1]) {
      opts.ngrokDomain = args[++i];
    } else if (args[i] === "--port" && args[i + 1]) {
      opts.port = parseInt(args[++i], 10);
    } else if (args[i] === "--show-qr") {
      opts.showQr = true;
    } else if (args[i] === "--reset") {
      opts.reset = true;
    } else if (args[i] === "--release-setup") {
      opts.releaseSetup = true;
      opts.enableCloudDirect = true;
      opts.installService = true;
    } else if (args[i] === "--install-service") {
      opts.installService = true;
    } else if (args[i] === "--start-service") {
      opts.startService = true;
      opts.installService = true;
    } else if (args[i] === "--no-start-service") {
      opts.noStartService = true;
      opts.installService = true;
    } else if (args[i] === "--service-stack" && args[i + 1]) {
      opts.serviceStack = args[++i];
    }
  }
  return opts;
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatSetupQuestion(question) {
  const normalized = String(question || "").trim();
  if (normalized.startsWith("?")) return normalized;
  return `? ${normalized}`;
}

function printSetupStep(stepNumber, title) {
  if (!isInteractiveSetup()) return;
  console.log(`\n[${stepNumber}/${SETUP_TOTAL_STEPS}] ${title}`);
}

async function promptWithDefault(question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await prompt(`${formatSetupQuestion(question)}${suffix}: `);
  return answer || defaultValue || "";
}

async function promptDefaultBrowseRootForSetup(opts, config) {
  const existingBrowseRoot =
    typeof config.default_browse_path === "string" &&
    config.default_browse_path.trim()
      ? config.default_browse_path.trim()
      : "";

  if (opts.defaultBrowseRoot !== undefined) {
    return resolveDirectoryPath(opts.defaultBrowseRoot, "Default Browse Root");
  }
  if (!isInteractiveSetup()) {
    return undefined;
  }

  const displayedDefault = existingBrowseRoot || resolveDefaultBrowsePath();
  console.log(
    "  Explorer starts here. Choose a root where you can find project folders for agent sessions."
  );
  const answer = await prompt(`Default Browse Root [${displayedDefault}]: `);
  const requestedBrowseRoot = answer.trim();
  if (!requestedBrowseRoot) {
    return existingBrowseRoot
      ? resolveDirectoryPath(existingBrowseRoot, "Default Browse Root")
      : undefined;
  }
  return resolveDirectoryPath(requestedBrowseRoot, "Default Browse Root");
}

function withOptionalDefaultBrowseRoot(updates, defaultBrowseRoot) {
  if (defaultBrowseRoot === undefined) return updates;
  return {
    ...updates,
    default_browse_path: defaultBrowseRoot,
  };
}

async function promptRequiredValue(question, defaultValue = "") {
  while (true) {
    const answer = await promptWithDefault(question, defaultValue);
    if (answer.trim()) {
      return answer.trim();
    }
    console.log(`  ${question} is required.`);
  }
}

async function promptRequiredPassword(question) {
  while (true) {
    const answer = await promptHidden(`${formatSetupQuestion(question)}: `);
    if (answer.trim()) {
      return answer;
    }
    console.log(`  ${question} is required.`);
  }
}

async function promptYesNoDefaultYes(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return true;
  const answer = (await prompt(`${formatSetupQuestion(question)} (Y/n) `)).trim().toLowerCase();
  return !(answer === "n" || answer === "no");
}

async function promptYesNoDefaultNo(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const answer = (await prompt(`${formatSetupQuestion(question)} (y/N) `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

function isInteractiveSetup() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptDailyTelemetryConsentForSetup(config = {}) {
  if (!isInteractiveSetup()) return {};
  printSetupStep(5, "Help improve Oysterun?");
  console.log(
    "  Oysterun can send a small daily telemetry report to help us improve reliability and understand which features are used."
  );
  console.log("  Sent once per day:");
  console.log("  - Host ID");
  console.log("  - Oysterun version");
  console.log("  - Operating system");
  console.log("  - Daily aggregated feature usage counts");
  console.log("  Never sent:");
  console.log("  - Chats or prompts");
  console.log("  - Files or file paths");
  console.log("  - Terminal output");
  console.log("  - Project names");
  console.log("  - Credentials or secrets");
  console.log(
    "  You can change your mind any time in the Host Preferences page."
  );
  console.log(
    "  You can review exactly what is sent in our open-source code and disable telemetry at any time."
  );
  const enabled = await promptYesNoDefaultYes("Enable daily telemetry?");
  if (config.daily_telemetry_enabled === enabled) return {};
  return {
    daily_telemetry_enabled: enabled,
    daily_telemetry_consent_recorded_at: new Date().toISOString(),
  };
}

async function maybeShowPhoneAppDownloadStep() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  printSetupStep(6, "Phone app");
  console.log("  You need the Oysterun phone app to scan the login QR.");
  const showDownload = await promptYesNoDefaultNo(
    "Show phone app download link and QR code?"
  );
  if (!showDownload) return;

  console.log("\n  Download the Oysterun phone app first:");
  console.log(`  ${OYSTERUN_PHONE_APP_DOWNLOAD_URL}`);
  console.log("\n  App download QR:\n");
  qrcode.generate(OYSTERUN_PHONE_APP_DOWNLOAD_URL, { small: true });
  console.log("\n  This link will point to the App Store when the app is published.");
  await prompt("? Press Enter after installing the phone app to continue to login QR...");
}

async function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return prompt(question).then((answer) => answer.trim());
  }
  return new Promise((resolve) => {
    let answer = "";
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw === true;
    const cleanup = () => {
      stdin.off("data", onData);
      if (!wasRaw) stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = () => {
      cleanup();
      stdout.write("\n");
      resolve(answer);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString("utf-8")) {
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (char < " ") continue;
        answer += char;
        stdout.write("*");
      }
    };
    stdout.write(question);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}

function runReleaseService(command, args = [], opts = {}, options = {}) {
  const serviceStack = inferReleaseServiceStack(opts);
  const execOptions = {
    cwd: repoRoot,
    env: {
      ...process.env,
      OYSTERUN_RELEASE_STACK: serviceStack,
    },
  };
  if (!options.quiet) {
    execFileSync(releaseServiceScript, [command, ...args], {
      ...execOptions,
      stdio: "inherit",
    });
    return "";
  }
  try {
    const stdout = execFileSync(releaseServiceScript, [command, ...args], {
      ...execOptions,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout || "";
  } catch (err) {
    const stdout = err.stdout ? String(err.stdout).trim() : "";
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    if (stdout || stderr) {
      console.error("  Host service diagnostic output:");
      if (stdout) console.error(stdout);
      if (stderr) console.error(stderr);
    }
    throw err;
  }
}

function inferReleaseServiceStack(opts = {}) {
  if (opts.serviceStack) return opts.serviceStack;
  if (process.env.OYSTERUN_RELEASE_STACK) return process.env.OYSTERUN_RELEASE_STACK;
  if (process.env.OYSTERUN_STACK) return process.env.OYSTERUN_STACK;

  const configDir = resolve(getConfigDir());
  if (
    basename(configDir) === "host" &&
    basename(dirname(dirname(configDir))) === ".oysterun-stacks"
  ) {
    return basename(dirname(configDir));
  }
  if (basename(configDir) === ".oysterun") {
    return "production";
  }
  return "production";
}

function parseReleaseServiceStatusOutput(output) {
  const status = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+)=(.*)$/);
    if (!match) continue;
    status[match[1]] = match[2].trim();
  }
  return status;
}

function getReleaseServiceStatus(opts = {}) {
  try {
    const output = runReleaseService("status", [], opts, { quiet: true });
    const status = parseReleaseServiceStatusOutput(output);
    const pid = status.pid && status.pid !== "-" ? status.pid : "";
    const running =
      status.loaded === "yes" || Boolean(pid) || status.health === "yes";
    return { available: true, running, status, error: null };
  } catch (err) {
    return {
      available: false,
      running: false,
      status: {},
      error: err?.message || String(err),
    };
  }
}

function getUrlPort(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.port) return Number.parseInt(parsed.port, 10);
    if (parsed.protocol === "https:") return 443;
    if (parsed.protocol === "http:") return 80;
  } catch {
    return null;
  }
  return null;
}

function isPortOccupiedByManagedReleaseService(port, opts = {}) {
  const releaseStatus = getReleaseServiceStatus(opts);
  if (!releaseStatus.running) return false;
  return getUrlPort(releaseStatus.status.url) === port;
}

async function maybeOpenSetupBrowser(url) {
  if (!isInteractiveSetup() || process.platform !== "darwin" || !url) return;
  try {
    console.log(`  Opening ${url} in your browser...`);
    await execFileAsync("open", [url]);
    console.log("  Browser opened.");
  } catch (err) {
    console.log(`  Could not open the browser automatically: ${err.message}`);
    console.log(`  Open manually: ${url}`);
  }
}

async function prepareHostRestartRestoreFromSetup({ hostUrl }) {
  const baseUrl = String(hostUrl || "").replace(/\/+$/, "");
  if (!baseUrl) {
    return { prepared: false, reason: "host_url_missing" };
  }
  const dashboardToken = process.env.OYSTERUN_SETUP_DASHBOARD_TOKEN || "";
  const headers = { "Content-Type": "application/json" };
  if (dashboardToken.trim()) {
    headers.Authorization = `Bearer ${dashboardToken.trim()}`;
  }
  try {
    const resp = await fetch(`${baseUrl}/admin/restart-prepare`, {
      method: "POST",
      headers,
      body: JSON.stringify({ trigger: "setup_step_7_restart_host" }),
    });
    if (!resp.ok) {
      return {
        prepared: false,
        reason: `restart_prepare_http_${resp.status}`,
      };
    }
    const payload = await resp.json();
    return {
      prepared: payload?.status === "restart_restore_prepared",
      payload,
    };
  } catch (err) {
    return { prepared: false, reason: err.message || String(err) };
  }
}

async function maybeInstallOrStartReleaseService(opts, { hostUrl }) {
  if (!opts.installService && !opts.startService && !opts.noStartService) {
    return { handled: false, started: false, serviceAlreadyRunning: false };
  }

  const serviceStatus = getReleaseServiceStatus(opts);
  const serviceAlreadyRunning = serviceStatus.running === true;
  const serviceManagerLabel =
    process.platform === "darwin" ? "LaunchAgent" : "pid-file Host service";
  const servicePrepareVerb = process.platform === "darwin" ? "Installing" : "Preparing";
  printSetupStep(7, serviceAlreadyRunning ? "Restart Host" : "Start Host");
  if (serviceAlreadyRunning && isInteractiveSetup()) {
    console.log("  An Oysterun Host service is already running.");
    console.log(
      "  Setup will ask the running Host to prepare restore state before restart."
    );
    console.log(
      "  If prepare is unavailable or unauthenticated, setup keeps the existing close/reconnect behavior instead of claiming restore."
    );
  }
  const shouldStart = opts.noStartService
    ? false
    : opts.startService
      ? true
      : await promptYesNoDefaultYes(
          serviceAlreadyRunning
            ? "Restart Oysterun Host now?"
            : "Start Oysterun Host now?"
        );

  console.log();
  if (shouldStart) {
    let restorePrepare = { prepared: false, reason: "not_required" };
    if (serviceAlreadyRunning) {
      restorePrepare = await prepareHostRestartRestoreFromSetup({ hostUrl });
      if (restorePrepare.prepared) {
        console.log(
          "  ✓ Host restart restore state prepared for existing sessions and enabled in-session loops."
        );
      } else {
        console.log(
          `  Restore prepare unavailable (${restorePrepare.reason || "unknown"}).`
        );
        console.log(
          "  Restarting will close existing live runtime sessions and running loops; chat history remains."
        );
      }
    }
    console.log(
      `  ${servicePrepareVerb} ${serviceManagerLabel} and ${serviceAlreadyRunning ? "restarting" : "starting"} Oysterun Host (${inferReleaseServiceStack(opts)})...`
    );
    const serviceCommand =
      process.platform !== "darwin" && serviceAlreadyRunning
        ? "restart"
        : "install";
    runReleaseService(serviceCommand, [], opts, { quiet: true });
    console.log(`\n  ✓ Oysterun Host is running at ${hostUrl}`);
    await maybeOpenSetupBrowser(`${hostUrl}/app/sessions`);
    return { handled: true, started: true, serviceAlreadyRunning };
  } else {
    console.log(
      `  ${servicePrepareVerb} ${serviceManagerLabel} without starting Oysterun Host (${inferReleaseServiceStack(opts)})...`
    );
    runReleaseService("install", ["--no-start"], opts, { quiet: true });
    console.log(
      process.platform === "darwin"
        ? "\n  Host service was installed but not started."
        : "\n  Host service was prepared but not started."
    );
    console.log("  Start later with:");
    console.log("    oysterun");
    console.log("  A fresh login QR will be shown after the Host starts.");
    return { handled: true, started: false, serviceAlreadyRunning };
  }
}

function requireNonEmptyPassword(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} required`);
  }
  return value;
}

async function promptConfirmedPassword({ firstPrompt, confirmPrompt }) {
  while (true) {
    const first = await promptRequiredPassword(firstPrompt);
    const second = await promptRequiredPassword(confirmPrompt);
    if (first === second) return first;
    console.log("  Passwords do not match. Please try again.");
  }
}

async function promptNewPassword(label) {
  return promptConfirmedPassword({
    firstPrompt: `Create ${label}`,
    confirmPrompt: `Confirm ${label}`,
  });
}

async function promptOptionalPasswordUpdate({
  label,
  hasExistingPasswordHash,
  currentPasswordHash,
}) {
  if (!hasExistingPasswordHash) {
    return hashDashboardPassword(await promptNewPassword(label));
  }
  if (!(await promptYesNoDefaultNo(`Change ${label}?`))) {
    return currentPasswordHash || null;
  }
  return hashDashboardPassword(await promptConfirmedPassword({
    firstPrompt: `New ${label}`,
    confirmPrompt: `Confirm new ${label}`,
  }));
}

function parsePortInput(rawValue) {
  const port = Number.parseInt(String(rawValue || "").trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return port;
}

function isPortAvailable(port) {
  return new Promise((resolvePortAvailable) => {
    const server = createServer();
    server.once("error", () => {
      resolvePortAvailable(false);
    });
    server.once("listening", () => {
      server.close(() => resolvePortAvailable(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port <= Math.min(startPort + 50, 65535); port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  return null;
}

async function promptHostPort({ defaultPort, optsPort, opts = {} }) {
  if (optsPort !== undefined) {
    const port = parsePortInput(optsPort);
    if (port === null) throw new Error(`Invalid port: ${optsPort}`);
    if (
      !(await isPortAvailable(port)) &&
      !isPortOccupiedByManagedReleaseService(port, opts)
    ) {
      throw new Error(`Port ${port} is already in use`);
    }
    return port;
  }

  while (true) {
    printSetupStep(2, "Host port");
    console.log("  Press Enter unless this port is already used.");
    const portInput = await promptWithDefault("Host port", String(defaultPort));
    const port = parsePortInput(portInput);
    if (port === null) {
      console.log(`  Invalid port: ${portInput}`);
      continue;
    }
    if (await isPortAvailable(port)) return port;
    if (isPortOccupiedByManagedReleaseService(port, opts)) {
      console.log(
        `  Port ${port} is used by the current Oysterun Host service and will be reused after restart.`
      );
      return port;
    }

    const fallback = await findAvailablePort(port + 1);
    if (fallback && isInteractiveSetup()) {
      console.log(`  Port ${port} is already in use.`);
      if (await promptYesNoDefaultYes(`Use ${fallback} instead?`)) {
        return fallback;
      }
    } else if (!isInteractiveSetup()) {
      throw new Error(`Port ${port} is already in use`);
    }

    console.log("  Choose another Host port.");
  }
}

function ipToNumber(address) {
  const parts = String(address || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return null;
  }
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  ) >>> 0;
}

function isPrivateLanAddress(address) {
  const value = ipToNumber(address);
  if (value === null) return false;
  const ten = ipToNumber("10.0.0.0");
  const tenEnd = ipToNumber("10.255.255.255");
  const private172Start = ipToNumber("172.16.0.0");
  const private172End = ipToNumber("172.31.255.255");
  const private192Start = ipToNumber("192.168.0.0");
  const private192End = ipToNumber("192.168.255.255");
  return (
    (value >= ten && value <= tenEnd) ||
    (value >= private172Start && value <= private172End) ||
    (value >= private192Start && value <= private192End)
  );
}

function isTailscaleOrVpnAddress(address, interfaceName) {
  const value = ipToNumber(address);
  const cgnatStart = ipToNumber("100.64.0.0");
  const cgnatEnd = ipToNumber("100.127.255.255");
  if (value !== null && value >= cgnatStart && value <= cgnatEnd) return true;
  return /tailscale|utun|tun|wg|vpn/i.test(interfaceName || "");
}

function addHostUrlCandidate(candidates, seen, { label, url, description }) {
  const normalized = normalizePublicBaseUrlInput(url);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push({ label, url: normalized, description });
}

function detectHostUrlCandidates(port, existingUrl = "") {
  const candidates = [];
  const seen = new Set();

  const existing = normalizePublicBaseUrlInput(existingUrl);
  if (existing && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(existing)) {
    addHostUrlCandidate(candidates, seen, {
      label: "Saved Host URL",
      url: existing,
      description: "Use the Host URL already saved in this config.",
    });
  }

  const interfaces = networkInterfaces();
  const vpnAddresses = [];
  const lanAddresses = [];
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isTailscaleOrVpnAddress(entry.address, interfaceName)) {
        vpnAddresses.push({ interfaceName, address: entry.address });
      } else if (isPrivateLanAddress(entry.address)) {
        lanAddresses.push({ interfaceName, address: entry.address });
      }
    }
  }

  for (const entry of vpnAddresses) {
    addHostUrlCandidate(candidates, seen, {
      label: "Tailscale/VPN",
      url: `http://${entry.address}:${port}`,
      description: `Use when your iPhone can reach this Mac through ${entry.interfaceName}.`,
    });
  }
  for (const entry of lanAddresses) {
    addHostUrlCandidate(candidates, seen, {
      label: "Local network Wi-Fi/LAN",
      url: `http://${entry.address}:${port}`,
      description: `Use when the iPhone and Mac are on the same reachable network (${entry.interfaceName}).`,
    });
  }

  addHostUrlCandidate(candidates, seen, {
    label: "This Mac only",
    url: `http://localhost:${port}`,
    description: "Only for opening Oysterun in a browser on this Mac.",
  });

  return candidates;
}

async function promptDirectHostUrl({ port, existingUrl, optsUrl }) {
  const explicitUrl = normalizePublicBaseUrlInput(optsUrl);
  if (explicitUrl) return explicitUrl;
  if (!isInteractiveSetup()) {
    return normalizePublicBaseUrlInput(existingUrl || `http://localhost:${port}`);
  }

  const candidates = detectHostUrlCandidates(port, existingUrl);
  printSetupStep(3, "iPhone connection URL");
  console.log("\n  How will your iPhone connect to this Mac?");
  console.log("\n  We detected:");
  candidates.forEach((candidate, index) => {
    console.log(`    ${index + 1}. ${candidate.label}: ${candidate.url}`);
    console.log(`       ${candidate.description}`);
  });
  console.log();
  console.log(
    "  For iPhone login on the same Wi-Fi/LAN, use this Mac's LAN IP address, not localhost."
  );
  console.log(
    "  localhost only opens Oysterun from a browser on this Mac."
  );
  console.log(
    "  If the iPhone is not on the same reachable network, use a VPN/tunnel address such as Tailscale or Cloudflare Tunnel."
  );

  const defaultIndex = candidates.findIndex(
    (candidate) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(candidate.url)
  );
  if (defaultIndex < 0) {
    console.log();
    console.log("  No reachable iPhone URL was detected automatically.");
    console.log("  Paste this Mac's LAN/Tailscale/VPN URL if you want iPhone login now.");
    console.log("  Examples:");
    console.log(`    http://your-mac.local:${port}`);
    console.log(`    https://your-device.your-tailnet.ts.net:${port}`);
    console.log(`  Press Enter only if you are setting up Mac-browser access for now.`);
    while (true) {
      const answer = await prompt(
        `${formatSetupQuestion(`Host URL for iPhone login (or Enter for http://localhost:${port})`)}: `
      );
      const trimmed = answer.trim();
      if (!trimmed) return `http://localhost:${port}`;
      const pastedUrl = normalizePublicBaseUrlInput(trimmed);
      if (pastedUrl) return pastedUrl;
      console.log("  Enter a valid URL, for example http://your-mac.local:8802.");
    }
  }

  const selectedDefault = defaultIndex >= 0 ? defaultIndex + 1 : 1;
  while (true) {
    const answer = await prompt(
      `${formatSetupQuestion(`Choose Host URL [${selectedDefault}] or paste a different URL`)}: `
    );
    const trimmed = answer.trim();
    if (!trimmed) return candidates[selectedDefault - 1].url;
    const selectedNumber = Number.parseInt(trimmed, 10);
    if (
      String(selectedNumber) === trimmed &&
      selectedNumber >= 1 &&
      selectedNumber <= candidates.length
    ) {
      return candidates[selectedNumber - 1].url;
    }
    const pastedUrl = normalizePublicBaseUrlInput(trimmed);
    if (pastedUrl) return pastedUrl;
    console.log("  Enter a valid URL, for example http://your-mac.local:8802.");
  }
}

function clearCloudRegistration() {
  return {
    connection_mode: "direct",
    host_id: null,
    host_credential: null,
    device_id: null,
    onboarding_token: null,
    onboarding_url: null,
    device_signing_public_key: null,
    device_signing_kid: null,
    cloud_public_key: null,
    device_token: null,
    ngrok_domain: null,
    registered_at: null,
  };
}

function createDirectHostLoginQrPayload({ hostId, directHostUrl }) {
  const bootstrap = createHostLoginBootstrapToken();
  const verbose = buildDirectHostLoginQrPayload({
    hostId,
    directHostUrl,
    bootstrapToken: bootstrap.token,
    expiresAt: bootstrap.expires_at,
  });
  return {
    verbose,
    compact: buildCompactDirectHostLoginQrPayload({
      hostId,
      directHostUrl,
      bootstrapToken: bootstrap.token,
      expiresAt: bootstrap.expires_at,
    }),
  };
}

function buildTerminalDirectHostLoginQrPayload(qrPayload) {
  return {
    u: qrPayload.verbose.direct_host_url,
    b: qrPayload.verbose.bootstrap_token,
  };
}

function printDirectHostLoginQr({ hostId, directHostUrl }) {
  const qrPayload = createDirectHostLoginQrPayload({
    hostId,
    directHostUrl,
  });
  console.log("\n  Direct Host connection QR:\n");
  qrcode.generate(
    JSON.stringify(buildTerminalDirectHostLoginQrPayload(qrPayload)),
    { small: true }
  );
  console.log(`\n  Host ID: ${hostId}`);
  console.log(`  Direct Host URL: ${directHostUrl}`);
  console.log(`  QR expires at: ${qrPayload.verbose.expires_at}`);
  return qrPayload;
}

async function configureDirectMode(opts, config, detectedCommands) {
  const directSetupDefaults = getDirectSetupDefaults();
  const defaultConfig = getDefaultConfig();
  const currentDisplayName = config.display_name || directSetupDefaults.display_name;
  if (isInteractiveSetup()) {
    console.log("\n  Oysterun Host runs on this Mac.");
    console.log("  Your iPhone connects to this Host to chat with local agents.");
  }
  const displayNameRaw = opts.displayName !== undefined
    ? opts.displayName
    : (printSetupStep(1, "Host name"),
      console.log("  This name appears in the iPhone app Host list."),
      await promptWithDefault("Name this Host", currentDisplayName));
  const displayName = displayNameRaw.trim() || null;
  const currentPort = String(
    parseInt(getConfigValue("port", "OYSTERUN_PORT") || String(defaultConfig.port), 10)
  );
  const port = await promptHostPort({
    defaultPort: parsePortInput(currentPort) || defaultConfig.port,
    optsPort: opts.port,
    opts,
  });

  const currentPublicBaseUrl = config.public_base_url || "";
  const publicBaseUrl = normalizePublicBaseUrlInput(
    opts.publicBaseUrl !== undefined
      ? opts.publicBaseUrl
      : await promptWithDefault("Public Host URL (optional)", currentPublicBaseUrl)
  );
  const defaultBrowseRoot = await promptDefaultBrowseRootForSetup(opts, config);

  const currentDashboardUser = config.dashboard_user || "";
  const dashboardUser = opts.dashboardUser !== undefined
    ? requireNonEmptyPassword(opts.dashboardUser, "Local login username").trim()
    : await promptRequiredValue("Local login username", currentDashboardUser);
  const hasExistingPasswordHash = typeof config.dashboard_password_hash === "string" && config.dashboard_password_hash.trim().length > 0;
  let dashboardPasswordHash = config.dashboard_password_hash || null;
  if (opts.dashboardPassword !== undefined) {
    dashboardPasswordHash = hashDashboardPassword(requireNonEmptyPassword(opts.dashboardPassword, "Local login password"));
  } else if (!hasExistingPasswordHash) {
    dashboardPasswordHash = hashDashboardPassword(await promptNewPassword("local login password"));
  } else {
    const dashboardPasswordUpdate = await promptHidden("Local login password (leave blank to keep current value): ");
    if (dashboardPasswordUpdate) {
      dashboardPasswordHash = hashDashboardPassword(requireNonEmptyPassword(dashboardPasswordUpdate, "Local login password"));
    }
  }
  const telemetryUpdates = await promptDailyTelemetryConsentForSetup(config);

  writeConfig(
    withOptionalDefaultBrowseRoot(
      {
        ...clearCloudRegistration(),
        display_name: displayName,
        port,
        public_base_url: publicBaseUrl,
        direct_host_url: publicBaseUrl,
        dashboard_user: dashboardUser,
        dashboard_password_hash: dashboardPasswordHash,
        claude_command: detectedCommands.claude_command,
        codex_command: detectedCommands.codex_command,
        ...telemetryUpdates,
      },
      defaultBrowseRoot
    )
  );

  console.log(`\n  ✓ Direct Host mode configured`);
  console.log(`  Host display name: ${displayName || "(unset)"}`);
  console.log(`  Host port: ${port}`);
  console.log(`  Public Host URL: ${publicBaseUrl || "(unset)"}`);
  console.log(`  Default Browse Root: ${defaultBrowseRoot || config.default_browse_path || resolveDefaultBrowsePath()}`);
  console.log(`  Local login username: ${dashboardUser}`);
  printDetectedProviderStatus(detectedCommands);
  console.log(`  Config saved to ${getConfigPath()}`);
  const serviceResult = await maybeInstallOrStartReleaseService(opts, {
    hostUrl: publicBaseUrl || `http://localhost:${port}`,
  });
  if (!serviceResult.handled) {
    console.log(`\n  Next steps:`);
    console.log(`    1. Run: oysterun`);
    console.log(`    2. Open the Host URL directly from your client app`);
    console.log(`    3. Log in with the local username/password configured above`);
    console.log();
  }
}

async function configureCloudDirectMode(opts, config, backendUrl, backendStage, detectedCommands) {
  const directSetupDefaults = getDirectSetupDefaults();
  const defaultConfig = getDefaultConfig();
  if (isInteractiveSetup()) {
    console.log("\n  Oysterun Host runs on this Mac.");
    console.log("  Your iPhone connects to this Host to chat with local agents.");
  }
  const displayNameDefault = config.display_name || directSetupDefaults.display_name;
  if (isInteractiveSetup()) {
    printSetupStep(1, "Host name");
    console.log("  This name appears in the iPhone app Host list.");
  }
  const displayName = (
    opts.displayName !== undefined
      ? opts.displayName
      : await promptWithDefault("Name this Host", displayNameDefault)
  ).trim() || null;
  const portValue = String(
    parseInt(getConfigValue("port", "OYSTERUN_PORT") || String(defaultConfig.port), 10)
  );
  const port = await promptHostPort({
    defaultPort: parsePortInput(portValue) || defaultConfig.port,
    optsPort: opts.port,
    opts,
  });

  const directHostUrl = await promptDirectHostUrl({
    port,
    existingUrl: config.direct_host_url || config.public_base_url || "",
    optsUrl:
      opts.directHostUrl !== undefined
        ? opts.directHostUrl
        : opts.publicBaseUrl !== undefined
          ? opts.publicBaseUrl
          : "",
  });
  if (!directHostUrl) {
    throw new Error("Direct Host URL required");
  }
  const defaultBrowseRoot = await promptDefaultBrowseRootForSetup(opts, config);

  printSetupStep(4, "Host password");
  const hasExistingPasswordHash = typeof config.dashboard_password_hash === "string" && config.dashboard_password_hash.trim().length > 0;
  let dashboardPasswordHash = config.dashboard_password_hash || null;
  const hostPassword = opts.hostPassword !== undefined
    ? opts.hostPassword
    : opts.dashboardPassword !== undefined
      ? opts.dashboardPassword
      : null;
  if (hostPassword !== null) {
    dashboardPasswordHash = hashDashboardPassword(requireNonEmptyPassword(hostPassword, "Host password"));
  } else if (!hasExistingPasswordHash) {
    dashboardPasswordHash = hashDashboardPassword(await promptNewPassword("Host password"));
  } else {
    dashboardPasswordHash = await promptOptionalPasswordUpdate({
      label: "Host password",
      hasExistingPasswordHash,
      currentPasswordHash: dashboardPasswordHash,
    });
  }
  const telemetryUpdates = await promptDailyTelemetryConsentForSetup(config);

  console.log(`\n  Registering direct-IP Host with backend at ${backendUrl}...`);

  const resp = await fetch(buildCloudApiUrl(backendUrl, "/api/device/register", backendStage), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_type: "macmini",
      display_name: displayName,
      app_version: "0.1.0",
      local_service_port: port,
      connection_mode: "direct",
      direct_host_url: directHostUrl,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`  Direct Host registration failed (${resp.status}): ${text}`);
    process.exit(1);
  }

  const data = await resp.json();
  const hostId = data.host_id || data.device_id;
  const hostCredential = data.host_credential || data.device_token;
  if (!hostId || !hostCredential) {
    throw new Error("Cloud registration response missing host_id/host_credential");
  }

  writeConfig(
    withOptionalDefaultBrowseRoot(
      {
        connection_mode: "direct",
        host_id: hostId,
        host_credential: hostCredential,
        device_id: hostId,
        device_token: hostCredential,
        onboarding_token: data.onboarding_token,
        onboarding_url: data.onboarding_url,
        device_signing_public_key: data.device_signing_public_key,
        device_signing_kid: data.device_signing_kid,
        cloud_public_key: data.device_signing_public_key,
        backend_url: backendUrl,
        tunnel_provider: "none",
        frp_server_addr: null,
        frp_server_port: null,
        frp_token: null,
        frp_subdomain: null,
        frp_subdomain_host: null,
        ngrok_domain: null,
        port,
        display_name: displayName,
        public_base_url: directHostUrl,
        direct_host_url: directHostUrl,
        dashboard_user: "admin",
        dashboard_password_hash: dashboardPasswordHash,
        registered_at: new Date().toISOString(),
        claude_command: detectedCommands.claude_command,
        codex_command: detectedCommands.codex_command,
        ...telemetryUpdates,
      },
      defaultBrowseRoot
    )
  );

  console.log(`\n  ✓ Direct-IP Cloud Host registration complete`);
  console.log(`  Host ID: ${hostId}`);
  console.log(`  Direct Host URL: ${directHostUrl}`);
  console.log(`  Default Browse Root: ${defaultBrowseRoot || config.default_browse_path || resolveDefaultBrowsePath()}`);
  console.log(`  Backend URL: ${backendUrl}`);
  console.log(`  Cloud stage: ${backendStage}`);
  console.log(`  Local login user: admin`);
  printDetectedProviderStatus(detectedCommands);
  await maybeShowPhoneAppDownloadStep();
  console.log(`\n  Config saved to ${getConfigPath()}`);
  console.log(`  Cloud identity saved to ${getCloudIdentityPath()}`);
  const serviceResult = await maybeInstallOrStartReleaseService(opts, {
    hostUrl: directHostUrl,
  });
  if (serviceResult.started) {
    printDirectHostLoginQr({ hostId, directHostUrl });
    console.log("\n  Oysterun is ready.");
    console.log(`  Web: ${directHostUrl}/app/sessions`);
    console.log("  iPhone: scan the QR above.");
    console.log("  Later: run `oysterun`.");
    return;
  }
  if (serviceResult.handled) {
    console.log("\n  Host service was not started.");
    console.log("  Start later with: oysterun");
    console.log("  A fresh login QR will be shown after the Host service starts.");
    return;
  }

  if (!serviceResult.handled) {
    console.log(`\n  Next steps:`);
    console.log(`    1. Run: oysterun`);
    console.log(`    2. Connect the app to ${directHostUrl}`);
    console.log(`    3. Run: oysterun show-qr`);
    console.log(`    4. Scan the QR, or log in with the Host password`);
    console.log();
  }
}

async function configureCloudMode(opts, config, backendUrl, backendStage, detectedCommands) {
  const directSetupDefaults = getDirectSetupDefaults();
  const defaultConfig = getDefaultConfig();
  if (config.device_id && config.connection_mode === "cloud" && !opts.reset) {
    console.log(`\n  Already registered as device: ${config.device_id}`);
    console.log(`  Backend: ${backendUrl}`);
    if (config.onboarding_url) {
      console.log(`  Onboarding URL: ${config.onboarding_url}`);
      console.log("\n  Use --show-qr to display the QR code again.");
      console.log("  Use --reset to re-register.\n");
    }
    return;
  }
  const displayNameDefault = config.display_name || directSetupDefaults.display_name;
  const displayName = (
    opts.displayName !== undefined
      ? opts.displayName
      : await promptWithDefault("Farm display name", displayNameDefault)
  ).trim() || null;
  const ngrokDomain = opts.ngrokDomain
    || getConfigValue("ngrok_domain", "OYSTERUN_NGROK_DOMAIN")
    || await prompt("Ngrok static domain (e.g. 'foo.ngrok-free.dev', or press Enter to skip): ");
  const portValue = String(
    parseInt(getConfigValue("port", "OYSTERUN_PORT") || String(defaultConfig.port), 10)
  );
  const portInput = opts.port !== undefined
    ? String(opts.port)
    : await promptWithDefault("Host port", portValue);
  const port = parseInt(portInput, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${portInput}`);
  }
  const defaultBrowseRoot = await promptDefaultBrowseRootForSetup(opts, config);
  const telemetryUpdates = await promptDailyTelemetryConsentForSetup(config);

  console.log(`\n  Registering with backend at ${backendUrl}...`);

  const resp = await fetch(buildCloudApiUrl(backendUrl, "/api/device/register", backendStage), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_type: "macmini",
      display_name: displayName,
      app_version: "0.1.0",
      local_service_port: port,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`  Registration failed (${resp.status}): ${text}`);
    process.exit(1);
  }

  const data = await resp.json();

  // Pull tunnel credentials provisioned during register so server.mjs has
  // everything it needs to spawn FrpAgent on first boot. Without these, the
  // host service would log "skipping tunnel start" and the tunnel never
  // comes up unless the user manually fills the frp_* env vars.
  console.log(`  Fetching tunnel credentials...`);
  const credResp = await fetch(buildCloudApiUrl(backendUrl, "/api/device/me/tunnel-credentials", backendStage), {
    headers: { Authorization: `Bearer ${data.device_token}` },
  });
  if (!credResp.ok) {
    const text = await credResp.text();
    console.error(`  Tunnel credentials fetch failed (${credResp.status}): ${text}`);
    process.exit(1);
  }
  const creds = await credResp.json();

  writeConfig(
    withOptionalDefaultBrowseRoot(
      {
        connection_mode: "cloud",
        device_id: data.device_id,
        onboarding_token: data.onboarding_token,
        onboarding_url: data.onboarding_url,
        device_signing_public_key: data.device_signing_public_key,
        device_signing_kid: data.device_signing_kid,
        cloud_public_key: data.device_signing_public_key,
        device_token: data.device_token,
        backend_url: backendUrl,
        tunnel_provider: creds.tunnel_provider,
        frp_server_addr: creds.frp_server_addr,
        frp_server_port: creds.frp_server_port,
        frp_token: creds.frp_token,
        frp_subdomain: creds.frp_subdomain,
        frp_subdomain_host: creds.frp_subdomain_host,
        ngrok_domain: ngrokDomain || creds.ngrok_domain || null,
        port,
        display_name: displayName,
        registered_at: new Date().toISOString(),
        claude_command: detectedCommands.claude_command,
        codex_command: detectedCommands.codex_command,
        ...telemetryUpdates,
      },
      defaultBrowseRoot
    )
  );

  console.log(`\n  ✓ Cloud registration complete`);
  console.log(`  Device ID: ${data.device_id}`);
  console.log(`  Cloud stage: ${backendStage}`);
  console.log(`  Default Browse Root: ${defaultBrowseRoot || config.default_browse_path || resolveDefaultBrowsePath()}`);
  console.log(`  Tunnel hostname: ${creds.tunnel_hostname}  (${creds.tunnel_provider})`);
  console.log(`  Onboarding URL: ${data.onboarding_url}`);
  printDetectedProviderStatus(detectedCommands);

  await maybeShowPhoneAppDownloadStep();
  printSetupStep(7, "Login QR");
  console.log("\n  Scan this QR code with the Oysterun app to claim your farm:\n");
  qrcode.generate(data.onboarding_url, { small: true });

  console.log(`\n  Config saved to ${getConfigPath()}`);
  console.log(`  Cloud identity saved to ${getCloudIdentityPath()}`);
  console.log(`\n  Next steps:`);
  console.log(`    1. Scan the QR code above with the Oysterun app`);
  console.log(`    2. Run: oysterun`);
  console.log(`       (${creds.tunnel_provider} tunnel will auto-start at ${creds.tunnel_hostname})`);
  console.log();
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const defaultConfig = getDefaultConfig();

  const backendUrl = opts.backendUrl
    || resolveCloudBackendUrl(defaultConfig);
  const backendStage = resolveCloudBackendStage(defaultConfig);

  const config = readConfig();

  // ── --show-qr: Re-display existing QR ──────────────────
  if (opts.showQr) {
    if (config.connection_mode === "direct" && config.host_id && config.direct_host_url) {
      printDirectHostLoginQr({
        hostId: config.host_id,
        directHostUrl: config.direct_host_url,
      });
      console.log();
      return;
    }
    if (config.connection_mode !== "cloud" || !config.onboarding_url) {
      console.error("No Host QR found. Run setup with --enable-cloud-direct or --enable-cloud first.");
      process.exit(1);
    }
    console.log("\n  Scan this QR code with the Oysterun app to onboard your farm:\n");
    qrcode.generate(config.onboarding_url, { small: true });
    console.log(`\n  URL: ${config.onboarding_url}`);
    console.log(`  Device ID: ${config.device_id}\n`);
    return;
  }

  // ── --reset: Clear config and re-register ──────────────
  if (opts.reset) {
    const confirm = await prompt("This will reset your Cloud registration and return this Host to direct mode. Continue? (y/N) ");
    if (confirm.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
    writeConfig(clearCloudRegistration());
    console.log("Cloud registration cleared. This Host is now back in direct mode.\n");
  }

  const detectedCommands = detectProviderCommands();
  if (!(await confirmProviderPreflight(detectedCommands))) {
    return;
  }

  if (opts.enableCloudDirect) {
    await configureCloudDirectMode(opts, readConfig(), backendUrl, backendStage, detectedCommands);
    return;
  }

  if (opts.enableCloud) {
    await configureCloudMode(opts, readConfig(), backendUrl, backendStage, detectedCommands);
    return;
  }

  await configureDirectMode(opts, readConfig(), detectedCommands);
}

main().catch((err) => {
  console.error("Setup error:", err.message);
  process.exit(1);
});
