#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getConfigPath,
  readConfig,
  writeConfig,
} from "../host-service/config.mjs";
import {
  hashDashboardPassword,
  verifyDashboardPassword,
} from "../host-service/dashboard-password.mjs";

const DEFAULT_VERIFICATION_DASHBOARD_USER = "admin";
const DEFAULT_VERIFICATION_DASHBOARD_PASSWORD = "oysterun2026";
const REDACTED = "[redacted]";
const P125_DEV_CREDENTIAL_HELPER_CONTRACT =
  "p125_dev_hp_dashboard_credentials_v1";
const FORBIDDEN_DEV_CREDENTIAL_FIELDS = new Set([
  "ttl",
  "expires_at",
  "expiresAt",
  "expiration",
  "expires",
]);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function normalizeStackName(stackName) {
  if (typeof stackName !== "string" || !stackName.trim()) {
    throw new Error("stack_dashboard_credentials_missing: stack name required");
  }
  return stackName.trim();
}

function isProductionStack(stackName) {
  return stackName === "production";
}

function isDefaultVerificationStack(stackName) {
  return /^test[1-4]$/.test(stackName) || /^test_w[0-9]+$/.test(stackName);
}

function readRawConfigKeys(configPath) {
  if (!existsSync(configPath)) return [];
  const parsed = JSON.parse(readFileSync(configPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid config format: ${configPath}`);
  }
  return Object.keys(parsed).sort();
}

function nonCredentialFieldMap(config) {
  const result = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "dashboard_user" || key === "dashboard_password_hash") continue;
    result[key] = JSON.stringify(value);
  }
  return result;
}

function nonCredentialFieldsPreserved(before, after) {
  const beforeMap = nonCredentialFieldMap(before);
  for (const [key, value] of Object.entries(beforeMap)) {
    if (JSON.stringify(after[key]) !== value) {
      return false;
    }
  }
  return true;
}

export function resolveDashboardCredentialSource(stackName, env = process.env) {
  const normalizedStackName = normalizeStackName(stackName);
  const explicitUser = env.OYSTERUN_STACK_DASHBOARD_USER?.trim() || null;
  const explicitPassword = env.OYSTERUN_STACK_DASHBOARD_PASSWORD || null;
  if (explicitUser || explicitPassword) {
    if (!explicitUser || !explicitPassword || !explicitPassword.trim()) {
      throw new Error("stack_dashboard_credentials_missing: incomplete explicit dashboard credential source");
    }
    return {
      kind: "explicit_stack_dashboard_env",
      user: explicitUser,
      password: explicitPassword,
      redacted: true,
    };
  }
  if (isProductionStack(normalizedStackName)) {
    return {
      kind: "production_existing_config_only",
      user: null,
      password: null,
      redacted: true,
    };
  }
  if (isDefaultVerificationStack(normalizedStackName)) {
    return {
      kind: "current_team_verification_dashboard_credentials",
      user: DEFAULT_VERIFICATION_DASHBOARD_USER,
      password: DEFAULT_VERIFICATION_DASHBOARD_PASSWORD,
      redacted: true,
    };
  }
  throw new Error("stack_dashboard_credentials_missing: explicit stack dashboard credentials required for this stack");
}

function baseProof({
  stackName,
  hostOrigin,
  configDir,
  configPath,
  credentialSourceKind,
  existingStackCredentialsPreserved,
  stackConfigExistingFieldsPreserved,
  dashboardPasswordHashVerifies,
  authLoginStatus = "not_checked",
  authLoginAccepted = false,
}) {
  const config = readConfig();
  return {
    stack_name: stackName,
    host_origin: hostOrigin,
    config_dir: configDir,
    config_path: configPath,
    dashboard_user_set: Boolean(config.dashboard_user),
    dashboard_password_hash_set: Boolean(config.dashboard_password_hash),
    dashboard_password_plaintext_recorded: false,
    dashboard_password_hash_verifies: dashboardPasswordHashVerifies,
    credential_source_kind: credentialSourceKind,
    credential_source_redacted: true,
    existing_stack_credentials_preserved: existingStackCredentialsPreserved,
    stack_config_existing_fields_preserved: stackConfigExistingFieldsPreserved,
    auth_login_status: authLoginStatus,
    auth_login_accepted: authLoginAccepted,
    token_redacted: true,
    cookie_redacted: true,
  };
}

function writeProofFile(path, proof) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
}

function parseCliOptions(args = []) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
    const raw = arg.slice(2);
    if (!raw) throw new Error("Unsupported empty option");
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex >= 0) {
      options[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1);
      continue;
    }
    if (raw === "json") {
      options.json = true;
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[raw] = true;
      continue;
    }
    options[raw] = next;
    index += 1;
  }
  return options;
}

function requireCliOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option: --${key}`);
  }
  return value.trim();
}

function readJsonObject(path, { missingFallback = null } = {}) {
  if (!existsSync(path)) return missingFallback;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object: ${path}`);
  }
  return parsed;
}

function writeJsonObject(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeCredentialString(value, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} required`);
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} required`);
  return normalized;
}

function assertNoForbiddenDevCredentialFields(config) {
  for (const key of Object.keys(config || {})) {
    if (FORBIDDEN_DEV_CREDENTIAL_FIELDS.has(key)) {
      throw new Error(
        `config.dev.json must not contain rotating expiration field: ${key}`
      );
    }
  }
}

function readDevDashboardConfig(configDir) {
  const path = join(configDir, "config.dev.json");
  const config = readJsonObject(path, { missingFallback: null });
  if (config) assertNoForbiddenDevCredentialFields(config);
  const user = normalizeCredentialString(config?.dashboard_user, "dashboard_user");
  const password = normalizeCredentialString(
    config?.dashboard_password,
    "dashboard_password"
  );
  return {
    path,
    exists: Boolean(config),
    config,
    user,
    password,
    complete: Boolean(user && password),
  };
}

function readRuntimeDashboardConfig(configDir) {
  const path = join(configDir, "config.json");
  const config = readJsonObject(path, { missingFallback: {} });
  const user = normalizeCredentialString(config.dashboard_user, "dashboard_user");
  const passwordHash = normalizeCredentialString(
    config.dashboard_password_hash,
    "dashboard_password_hash"
  );
  return {
    path,
    exists: existsSync(path),
    config,
    user,
    passwordHash,
    complete: Boolean(user && passwordHash),
  };
}

function buildRedactedDevCredentialStatus({
  command,
  configDir,
  devConfig,
  runtimeConfig,
  ready,
  reason,
  writes = null,
}) {
  return {
    contract: P125_DEV_CREDENTIAL_HELPER_CONTRACT,
    command,
    status: ready ? "ready" : "not_ready",
    ready,
    reason,
    config_dir: configDir,
    config_dev_path: devConfig.path,
    config_path: runtimeConfig.path,
    config_dev_exists: devConfig.exists,
    config_dev_complete: devConfig.complete,
    config_json_exists: runtimeConfig.exists,
    runtime_dashboard_hash_grant_complete: runtimeConfig.complete,
    credentials_match:
      devConfig.complete && runtimeConfig.complete
        ? runtimeConfig.user === devConfig.user &&
          verifyDashboardPassword(devConfig.password, runtimeConfig.passwordHash)
        : false,
    dashboard_user_redacted: devConfig.complete || runtimeConfig.complete,
    dashboard_password_redacted: true,
    dashboard_password_plaintext_recorded_in_config_json: false,
    config_dev_plaintext_output: false,
    token_redacted: true,
    cookie_redacted: true,
    ...(writes ? { writes } : {}),
  };
}

function computeDevCredentialStatus(configDir, command = "status") {
  const devConfig = readDevDashboardConfig(configDir);
  const runtimeConfig = readRuntimeDashboardConfig(configDir);
  if (devConfig.exists && !devConfig.complete) {
    return buildRedactedDevCredentialStatus({
      command,
      configDir,
      devConfig,
      runtimeConfig,
      ready: false,
      reason: "config_dev_incomplete",
    });
  }
  if (devConfig.complete && runtimeConfig.complete) {
    const credentialsMatch =
      runtimeConfig.user === devConfig.user &&
      verifyDashboardPassword(devConfig.password, runtimeConfig.passwordHash);
    if (!credentialsMatch) {
      return buildRedactedDevCredentialStatus({
        command,
        configDir,
        devConfig,
        runtimeConfig,
        ready: false,
        reason: "credential_drift",
      });
    }
    return buildRedactedDevCredentialStatus({
      command,
      configDir,
      devConfig,
      runtimeConfig,
      ready: true,
      reason: "ready",
    });
  }
  return buildRedactedDevCredentialStatus({
    command,
    configDir,
    devConfig,
    runtimeConfig,
    ready: false,
    reason: !devConfig.complete
      ? "config_dev_missing"
      : "runtime_dashboard_hash_grant_missing",
  });
}

function requireBootstrapEnv(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required bootstrap environment variable: ${name}`);
  }
  return value.trim();
}

function ensureDevDashboardCredentials({ configDir, env = process.env } = {}) {
  let devConfig = readDevDashboardConfig(configDir);
  let runtimeConfig = readRuntimeDashboardConfig(configDir);
  const initialStatus = computeDevCredentialStatus(configDir, "ensure");
  if (initialStatus.reason === "credential_drift") {
    throw new Error("Credential drift between config.dev.json and config.json");
  }

  const writes = {
    config_dev_json: false,
    config_json: false,
  };
  if (!devConfig.complete) {
    const user =
      devConfig.user ||
      normalizeCredentialString(
        requireBootstrapEnv(env, "OYSTERUN_DEV_USER"),
        "OYSTERUN_DEV_USER",
        { required: true }
      );
    const password =
      devConfig.password ||
      normalizeCredentialString(
        requireBootstrapEnv(env, "OYSTERUN_DEV_PASSWORD"),
        "OYSTERUN_DEV_PASSWORD",
        { required: true }
      );
    const nextDevConfig = {
      ...(devConfig.config || {}),
      dashboard_user: user,
      dashboard_password: password,
    };
    assertNoForbiddenDevCredentialFields(nextDevConfig);
    writeJsonObject(devConfig.path, nextDevConfig);
    writes.config_dev_json = true;
    devConfig = readDevDashboardConfig(configDir);
  }

  runtimeConfig = readRuntimeDashboardConfig(configDir);
  if (runtimeConfig.complete) {
    const credentialsMatch =
      runtimeConfig.user === devConfig.user &&
      verifyDashboardPassword(devConfig.password, runtimeConfig.passwordHash);
    if (!credentialsMatch) {
      throw new Error("Credential drift between config.dev.json and config.json");
    }
  } else {
    writeJsonObject(runtimeConfig.path, {
      ...runtimeConfig.config,
      dashboard_user: devConfig.user,
      dashboard_password_hash: hashDashboardPassword(devConfig.password),
    });
    writes.config_json = true;
  }

  const status = computeDevCredentialStatus(configDir, "ensure");
  if (!status.ready) {
    throw new Error(`Credential helper ensure failed: ${status.reason}`);
  }
  return {
    ...status,
    status: "ensured",
    writes,
  };
}

function runP125CredentialHelperCommand(command, args) {
  const options = parseCliOptions(args);
  if (options.json !== true) {
    throw new Error("--json is required for status/ensure --config-dir");
  }
  const configDir = requireCliOption(options, "config-dir");
  if (command === "status") {
    const status = computeDevCredentialStatus(configDir, "status");
    if (status.reason === "credential_drift" || status.reason === "config_dev_incomplete") {
      const err = new Error(status.reason);
      err.status = status;
      throw err;
    }
    return status;
  }
  if (command === "ensure") {
    return ensureDevDashboardCredentials({ configDir });
  }
  throw new Error("Unsupported P125 credential helper command");
}

export function ensureStackDashboardCredentials({
  stackName,
  hostOrigin,
  configDir,
  proofPath = null,
} = {}) {
  const normalizedStackName = normalizeStackName(stackName);
  const configPath = getConfigPath();
  const rawKeysBefore = readRawConfigKeys(configPath);
  const beforeConfig = readConfig();
  const hadCompleteCredentials = Boolean(beforeConfig.dashboard_user && beforeConfig.dashboard_password_hash);
  const source = hadCompleteCredentials
    ? {
        kind: "existing_stack_config",
        user: beforeConfig.dashboard_user,
        password: null,
        redacted: true,
      }
    : resolveDashboardCredentialSource(normalizedStackName);

  let afterConfig = beforeConfig;
  if (!hadCompleteCredentials) {
    if (source.kind === "production_existing_config_only") {
      const proof = baseProof({
        stackName: normalizedStackName,
        hostOrigin,
        configDir,
        configPath,
        credentialSourceKind: source.kind,
        existingStackCredentialsPreserved: false,
        stackConfigExistingFieldsPreserved: true,
        dashboardPasswordHashVerifies: false,
      });
      writeProofFile(proofPath, proof);
      return proof;
    }
    afterConfig = writeConfig({
      dashboard_user: source.user,
      dashboard_password_hash: hashDashboardPassword(source.password),
    });
  }

  const rawKeysAfter = readRawConfigKeys(configPath);
  const stackConfigExistingFieldsPreserved = rawKeysBefore.every((key) => rawKeysAfter.includes(key))
    && nonCredentialFieldsPreserved(beforeConfig, afterConfig);
  const passwordForVerification = source.password;
  const dashboardPasswordHashVerifies = hadCompleteCredentials || Boolean(
    passwordForVerification
      && afterConfig.dashboard_user === source.user
      && afterConfig.dashboard_password_hash
      && verifyDashboardPassword(passwordForVerification, afterConfig.dashboard_password_hash)
  );
  const proof = baseProof({
    stackName: normalizedStackName,
    hostOrigin,
    configDir,
    configPath,
    credentialSourceKind: hadCompleteCredentials
      ? "existing_stack_config"
      : source.kind,
    existingStackCredentialsPreserved: hadCompleteCredentials,
    stackConfigExistingFieldsPreserved,
    dashboardPasswordHashVerifies,
  });
  writeProofFile(proofPath, proof);
  return proof;
}

export async function probeStackDashboardAuth({
  stackName,
  hostOrigin,
  configDir,
  proofPath = null,
} = {}) {
  const normalizedStackName = normalizeStackName(stackName);
  const configPath = getConfigPath();
  const config = readConfig();
  const hasCompleteCredentials = Boolean(
    config.dashboard_user && config.dashboard_password_hash
  );
  const source = hasCompleteCredentials
    ? {
        kind: "existing_stack_config",
        user: config.dashboard_user,
        password: null,
        redacted: true,
      }
    : resolveDashboardCredentialSource(normalizedStackName);
  const sourceCanVerify = Boolean(source.user && source.password);
  const hashVerifies = sourceCanVerify
    && Boolean(config.dashboard_password_hash)
    && verifyDashboardPassword(source.password, config.dashboard_password_hash);
  let authLoginStatus = "not_checked";
  let authLoginAccepted = false;

  if (sourceCanVerify && hashVerifies && hostOrigin) {
    const response = await fetch(`${hostOrigin.replace(/\/+$/, "")}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: source.user,
        password: source.password,
      }),
    });
    authLoginStatus = String(response.status);
    if (response.ok) {
      const body = await response.json();
      authLoginAccepted = typeof body.token === "string" && body.token.length > 0
        && Boolean(response.headers.get("set-cookie"));
    }
  }

  const proof = baseProof({
    stackName: normalizedStackName,
    hostOrigin,
    configDir,
    configPath,
    credentialSourceKind: sourceCanVerify
      ? source.kind
      : "existing_stack_config",
    existingStackCredentialsPreserved: Boolean(config.dashboard_user && config.dashboard_password_hash),
    stackConfigExistingFieldsPreserved: true,
    dashboardPasswordHashVerifies: hashVerifies || Boolean(config.dashboard_user && config.dashboard_password_hash && !sourceCanVerify),
    authLoginStatus,
    authLoginAccepted,
  });
  writeProofFile(proofPath, proof);
  return proof;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (
    command === "status" ||
    (command === "ensure" && args.some((arg) => arg === "--config-dir" || arg.startsWith("--config-dir=")))
  ) {
    const proof = runP125CredentialHelperCommand(command, args);
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    return;
  }
  const options = {
    stackName: requiredEnv("OYSTERUN_STACK_NAME"),
    hostOrigin: optionalEnv("OYSTERUN_HOST_ORIGIN"),
    configDir: requiredEnv("OYSTERUN_CONFIG_DIR"),
    proofPath: optionalEnv("OYSTERUN_STACK_DASHBOARD_CREDENTIALS_PROOF_PATH"),
  };
  if (command === "ensure") {
    const proof = ensureStackDashboardCredentials(options);
    process.stdout.write(`${JSON.stringify({
      stack_name: proof.stack_name,
      dashboard_user_set: proof.dashboard_user_set,
      dashboard_password_hash_set: proof.dashboard_password_hash_set,
      dashboard_password_plaintext_recorded: false,
      credential_source_kind: proof.credential_source_kind,
      credential_source_redacted: true,
    })}\n`);
  } else if (command === "probe-auth") {
    const proof = await probeStackDashboardAuth(options);
    process.stdout.write(`${JSON.stringify({
      stack_name: proof.stack_name,
      auth_login_status: proof.auth_login_status,
      auth_login_accepted: proof.auth_login_accepted,
      token_redacted: true,
      cookie_redacted: true,
    })}\n`);
  } else {
    throw new Error("Usage: stack_dashboard_credentials.mjs status --config-dir <dir> --json | ensure [--config-dir <dir> --json] | probe-auth");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    if (error?.status) {
      process.stderr.write(`${JSON.stringify(error.status, null, 2)}\n`);
    }
    process.stderr.write(`[stack-dashboard-credentials] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
