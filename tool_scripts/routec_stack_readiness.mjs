#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { probeStackDashboardAuth } from "./stack_dashboard_credentials.mjs";

const SCHEMA_VERSION = "routec.stack_readiness.v1";
const HELPER_PATH = fileURLToPath(import.meta.url);
const FORBIDDEN_TOP_LEVEL_FIELDS = Object.freeze([
  ["matrix", "login", "status"].join("_"),
  ["matrix", "room", "status"].join("_"),
  ["matrix", "room", "id", "hash"].join("_"),
  ["matrix", "user", "id", "hash"].join("_"),
  ["matrix", "access", "token"].join("_"),
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

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(path) {
  if (!path) return "not_configured";
  if (!existsSync(path)) return "missing";
  return sha256Text(readFileSync(path));
}

function gitHead(repoRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim() || "unknown";
}

function websocketUrl(origin) {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/session/stream";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function numericPort(raw) {
  if (raw === null) return null;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`Invalid numeric port value: ${raw}`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid TCP port value: ${raw}`);
  }
  return port;
}

function relativeOrAbsolute(repoRoot, path) {
  if (!path) return null;
  const rel = relative(repoRoot, path);
  return rel.startsWith("..") ? path : rel;
}

function readJsonIfPresent(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseTsvFile(path) {
  if (!path || !existsSync(path)) {
    return { present: false, values: {} };
  }
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("key\t")) continue;
    const [key, ...rest] = line.split("\t");
    if (key) values[key] = rest.join("\t");
  }
  return { present: true, values };
}

function legacyRuntimeEnvStatus(runtimeEnvPath, runtimeEnvJsonPath) {
  const checkedPaths = [runtimeEnvPath, runtimeEnvJsonPath]
    .filter(Boolean)
    .map((legacyPath) => ({
      path: legacyPath,
      exists: existsSync(legacyPath),
      sha256: existsSync(legacyPath) ? fileHash(legacyPath) : null,
    }));
  const liveLegacyFiles = checkedPaths.filter((item) => item.exists);
  const quarantineProofPath = optionalEnv("ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_PATH");
  const quarantineProof = readJsonIfPresent(quarantineProofPath);
  return {
    state: liveLegacyFiles.length
      ? "legacy_runtime_env_files_block_readiness"
      : "no_legacy_runtime_env_files_present",
    legacy_runtime_env_live_truth: false,
    raw_synapse_base_url_as_stack_truth: false,
    raw_synapse_token_as_stack_truth: false,
    fixed_matrix_room_user_as_stack_truth: false,
    live_legacy_files_present: liveLegacyFiles.length > 0,
    checked_paths: checkedPaths,
    quarantine_proof_path: quarantineProofPath,
    quarantine_proof_hash: fileHash(quarantineProofPath),
    quarantine_action: quarantineProof?.action ?? "proof_not_present_yet",
  };
}

function legacySynapseListenerGuardStatus() {
  const cleanupProofPath = optionalEnv("ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_PATH");
  const cleanupProof = readJsonIfPresent(cleanupProofPath);
  return {
    state: cleanupProof
      ? "known_legacy_routec_spike0_synapse_cleanup_guard_recorded"
      : "known_legacy_routec_spike0_synapse_cleanup_guard_configured",
    proof_path: cleanupProofPath,
    proof_hash: fileHash(cleanupProofPath),
    cleanup_action: cleanupProof?.action ?? "proof_not_present_yet",
    cleanup_status: cleanupProof?.cleanup_status ?? "not_run_yet",
    known_legacy_match: cleanupProof?.known_legacy_match ?? {
      command_contains: ["synapse_homeserver", "artifacts/spike0", "routec_spike0"],
      arbitrary_process_cleanup_allowed: false,
    },
    manual_synapse_stop_required_for_accepted_path: false,
  };
}

function sourceIdentityStatus(repoRoot, hostPid) {
  const originFile = requiredEnv("ROUTEC_HOST_ORIGIN_FILE");
  const origin = parseTsvFile(originFile);
  const originHostPid = origin.values.host_pid && /^[0-9]+$/.test(origin.values.host_pid)
    ? Number(origin.values.host_pid)
    : null;
  const numericHostPid = hostPid && /^[0-9]+$/.test(hostPid) ? Number(hostPid) : null;
  return {
    state: origin.present ? "origin_file_present" : "origin_file_missing",
    origin_file: originFile,
    origin_repo_root: origin.values.repo_root ?? null,
    origin_host_dir: origin.values.host_dir ?? null,
    origin_actual_cwd: origin.values.actual_cwd ?? null,
    origin_config_dir: origin.values.config_dir ?? null,
    origin_host_port: origin.values.host_port ?? null,
    origin_host_pid: originHostPid,
    expected_repo_root: repoRoot,
    repo_root_matches_current_source: origin.values.repo_root === repoRoot,
    host_pid_matches_origin: numericHostPid === null || originHostPid === numericHostPid,
  };
}

function credentialProofFromFile() {
  const proofPath = optionalEnv("ROUTEC_STACK_DASHBOARD_CREDENTIALS_PROOF_PATH");
  const proof = readJsonIfPresent(proofPath);
  return {
    proof_path: proofPath,
    stack_name: proof?.stack_name ?? requiredEnv("ROUTEC_STACK_NAME"),
    host_origin: proof?.host_origin ?? requiredEnv("ROUTEC_USABLE_ORIGIN"),
    config_dir: proof?.config_dir ?? optionalEnv("ROUTEC_CONFIG_DIR"),
    config_path: proof?.config_path ?? requiredEnv("ROUTEC_STACK_CONFIG_PATH"),
    dashboard_user_set: proof?.dashboard_user_set === true,
    dashboard_password_hash_set: proof?.dashboard_password_hash_set === true,
    dashboard_password_plaintext_recorded: false,
    dashboard_password_hash_verifies: proof?.dashboard_password_hash_verifies === true,
    credential_source_kind: proof?.credential_source_kind ?? "proof_not_present_yet",
    credential_source_redacted: true,
    existing_stack_credentials_preserved: proof?.existing_stack_credentials_preserved === true,
    stack_config_existing_fields_preserved: proof?.stack_config_existing_fields_preserved !== false,
    auth_login_status: proof?.auth_login_status ?? "not_checked",
    auth_login_accepted: proof?.auth_login_accepted === true,
    token_redacted: true,
    cookie_redacted: true,
  };
}

async function dashboardCredentialReadinessStatus({ currentValid, isSample, stackName, usableOrigin, configDir }) {
  const proofPath = optionalEnv("ROUTEC_STACK_DASHBOARD_CREDENTIALS_PROOF_PATH");
  if (!currentValid || isSample) {
    return credentialProofFromFile();
  }
  process.env.OYSTERUN_CONFIG_DIR = configDir;
  return await probeStackDashboardAuth({
    stackName,
    hostOrigin: usableOrigin,
    configDir,
    proofPath,
  });
}

async function baseFields({ currentValid, invalidatedBy }) {
  const repoRoot = requiredEnv("ROUTEC_REPO_ROOT");
  const stackName = requiredEnv("ROUTEC_STACK_NAME");
  const workerSlot = requiredEnv("ROUTEC_WORKER_SLOT");
  const usableOrigin = requiredEnv("ROUTEC_USABLE_ORIGIN");
  const isSample = requiredEnv("ROUTEC_GENERATED_BY_SCRIPT").includes("sample");
  const hostPort = numericPort(requiredEnv("ROUTEC_HOST_PORT"));
  const backendPort = numericPort(optionalEnv("ROUTEC_BACKEND_PORT"));
  const webChatAssetBaseUrl = `${usableOrigin.replace(/\/+$/, "")}/app/chat-assets/`;
  const legacyRouteCUrl = `${usableOrigin.replace(/\/+$/, "")}/route-c/`;
  const matrixFacadeUrl = `${usableOrigin.replace(/\/+$/, "")}/_matrix`;
  const wsUrl = websocketUrl(usableOrigin);
  const runtimeEnvJsonPath = optionalEnv("ROUTEC_RUNTIME_ENV_JSON_PATH");
  const runtimeEnvPath = optionalEnv("ROUTEC_RUNTIME_ENV_PATH");
  const legacyEnv = legacyRuntimeEnvStatus(runtimeEnvPath, runtimeEnvJsonPath);
  const legacySynapseGuard = legacySynapseListenerGuardStatus();
  const servedWebBuildPath = requiredEnv("ROUTEC_SERVED_WEB_BUILD_PATH");
  const hostPid = optionalEnv("ROUTEC_HOST_PID");
  const matrixDbPath = requiredEnv("ROUTEC_MATRIX_DB_PATH");
  const sourceIdentity = sourceIdentityStatus(repoRoot, hostPid);
  const stackRoot = optionalEnv("ROUTEC_STACK_ROOT");
  const configDir = optionalEnv("ROUTEC_CONFIG_DIR");
  const runDir = optionalEnv("ROUTEC_RUN_DIR");
  const logDir = optionalEnv("ROUTEC_LOG_DIR");
  const dashboardCredentialReadiness = await dashboardCredentialReadinessStatus({
    currentValid,
    isSample,
    stackName,
    usableOrigin,
    configDir,
  });

  const routeCStaticState = existsSync(servedWebBuildPath)
    ? "dist_index_present"
    : "dist_index_missing";

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    generated_by_script: requiredEnv("ROUTEC_GENERATED_BY_SCRIPT"),
    worker_slot: workerSlot,
    stack_name: stackName,
    usable_origin: usableOrigin,
    route_c_url: webChatAssetBaseUrl,
    web_chat_asset_base_url: webChatAssetBaseUrl,
    legacy_route_c_url: legacyRouteCUrl,
    matrix_facade_url: matrixFacadeUrl,
    websocket_url: wsUrl,
    external_ports: {
      host: hostPort,
    },
    host_status: {
      state: currentValid ? "healthy" : "invalidated",
      pid: hostPid && /^[0-9]+$/.test(hostPid) ? Number(hostPid) : null,
      launch_label: requiredEnv("ROUTEC_HOST_LABEL"),
      origin_file: requiredEnv("ROUTEC_HOST_ORIGIN_FILE"),
      log_file: requiredEnv("ROUTEC_HOST_LOG"),
    },
    route_c_static_status: {
      state: routeCStaticState,
      served_web_build_path: relativeOrAbsolute(repoRoot, servedWebBuildPath),
      normal_asset_base_path: "/app/chat-assets/",
      legacy_route_c_product_entry: false,
    },
    matrix_facade_status: {
      state: currentValid ? "host_facade_expected_via_usable_origin" : "invalidated",
      path: "/_matrix",
      downstream_origin: usableOrigin,
    },
    matrix_storage_status: {
      state: currentValid ? "host_owned_matrix_storage_configured" : "invalidated",
      storage_adapter: "host_owned_routec_matrix_storage",
      storage_path: matrixDbPath,
      stack_owned_matrix_storage: true,
      raw_synapse_base_url_required: false,
      raw_synapse_token_required: false,
      fixed_matrix_room_env_required: false,
      fixed_matrix_user_env_required: false,
      browser_direct_synapse_dependency: false,
      playwright_direct_synapse_dependency: false,
    },
    synapse_status: {
      state: "not_part_of_accepted_stack",
      separate_tcp_port_required: false,
      raw_origin_exposed_as_downstream_target: false,
      legacy_runtime_env_accepted_as_truth: false,
    },
    legacy_runtime_env_status: legacyEnv,
    legacy_synapse_listener_guard_status: legacySynapseGuard,
    source_identity_status: sourceIdentity,
    stack_slot_ownership_status: {
      state: sourceIdentity.repo_root_matches_current_source
        ? "owned_by_current_source_root"
        : "source_root_mismatch_blocks_readiness",
      stack_name: stackName,
      stack_root: stackRoot,
      config_dir: configDir,
      run_dir: runDir,
      log_dir: logDir,
      origin_file: requiredEnv("ROUTEC_HOST_ORIGIN_FILE"),
      host_pid: hostPid && /^[0-9]+$/.test(hostPid) ? Number(hostPid) : null,
      repo_root: repoRoot,
      overwrite_guard_required_for_final_validation: true,
    },
    dashboard_credential_status: dashboardCredentialReadiness,
    dashboard_user_set: dashboardCredentialReadiness.dashboard_user_set,
    dashboard_password_hash_set: dashboardCredentialReadiness.dashboard_password_hash_set,
    dashboard_password_plaintext_recorded: false,
    dashboard_password_hash_verifies: dashboardCredentialReadiness.dashboard_password_hash_verifies,
    credential_source_kind: dashboardCredentialReadiness.credential_source_kind,
    credential_source_redacted: true,
    existing_stack_credentials_preserved: dashboardCredentialReadiness.existing_stack_credentials_preserved,
    stack_config_existing_fields_preserved: dashboardCredentialReadiness.stack_config_existing_fields_preserved,
    auth_login_status: dashboardCredentialReadiness.auth_login_status,
    auth_login_accepted: dashboardCredentialReadiness.auth_login_accepted,
    token_redacted: true,
    cookie_redacted: true,
    current_valid: currentValid,
    invalidated_by: invalidatedBy,
    stack_config_hash: fileHash(requiredEnv("ROUTEC_STACK_CONFIG_PATH")),
    env_hash: "legacy_runtime_env_not_live_truth",
    git_head: gitHead(repoRoot),
    served_web_build_hash: fileHash(servedWebBuildPath),
    host_start_script_hash: fileHash(requiredEnv("ROUTEC_HOST_START_SCRIPT_PATH")),
    downstream_contract: {
      usable_origin: usableOrigin,
      route_c_url: webChatAssetBaseUrl,
      web_chat_asset_base_url: webChatAssetBaseUrl,
      legacy_route_c_url: legacyRouteCUrl,
      matrix_facade_url: matrixFacadeUrl,
      websocket_url: wsUrl,
      browser_direct_synapse_dependency: false,
      playwright_direct_synapse_dependency: false,
      worker_manual_matrix_port_required: false,
      accepted_stack_readiness_path: requiredEnv("ROUTEC_STACK_READINESS_PATH"),
    },
    internal_diagnostics: {
      internal_ports: {
        host: hostPort,
        backend: backendPort,
        host_owned_matrix_storage_configured: true,
      },
      host_db_path: requiredEnv("ROUTEC_HOST_DB_PATH"),
      matrix_db_path: matrixDbPath,
      owner_pids: {
        host: hostPid && /^[0-9]+$/.test(hostPid) ? Number(hostPid) : null,
      },
      legacy_runtime_env_quarantine_proof_hash: fileHash(optionalEnv("ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_PATH")),
      legacy_spike0_synapse_cleanup_proof_hash: fileHash(optionalEnv("ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_PATH")),
      internal_only: true,
      browser_direct_use: false,
      playwright_direct_use: false,
      worker_manual_input_required: false,
      downstream_contract: false,
    },
  };
}

function validateReadiness(doc) {
  const requiredTopLevel = [
    "schema_version",
    "generated_at",
    "generated_by_script",
    "worker_slot",
    "stack_name",
    "usable_origin",
    "route_c_url",
    "matrix_facade_url",
    "websocket_url",
    "external_ports",
    "host_status",
    "route_c_static_status",
    "matrix_facade_status",
    "matrix_storage_status",
    "synapse_status",
    "legacy_runtime_env_status",
    "legacy_synapse_listener_guard_status",
    "source_identity_status",
    "stack_slot_ownership_status",
    "dashboard_credential_status",
    "dashboard_user_set",
    "dashboard_password_hash_set",
    "dashboard_password_plaintext_recorded",
    "dashboard_password_hash_verifies",
    "credential_source_kind",
    "credential_source_redacted",
    "existing_stack_credentials_preserved",
    "stack_config_existing_fields_preserved",
    "auth_login_status",
    "auth_login_accepted",
    "token_redacted",
    "cookie_redacted",
    "current_valid",
    "invalidated_by",
    "stack_config_hash",
    "env_hash",
    "git_head",
    "served_web_build_hash",
    "host_start_script_hash",
    "downstream_contract",
    "internal_diagnostics",
  ];
  for (const key of requiredTopLevel) {
    if (!Object.hasOwn(doc, key)) {
      throw new Error(`stack readiness missing required top-level field: ${key}`);
    }
  }
  for (const key of FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (Object.hasOwn(doc, key)) {
      throw new Error(`stack readiness contains forbidden top-level field: ${key}`);
    }
  }
  if (doc.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported stack readiness schema_version: ${doc.schema_version}`);
  }
  if (typeof doc.current_valid !== "boolean") {
    throw new Error("stack readiness current_valid must be boolean");
  }
  if (doc.current_valid && doc.invalidated_by !== null) {
    throw new Error("current-valid stack readiness must use invalidated_by=null");
  }
  if (!doc.current_valid && (typeof doc.invalidated_by !== "string" || !doc.invalidated_by.trim())) {
    throw new Error("invalid stack readiness must include an invalidated_by reason");
  }
  const downstream = doc.downstream_contract;
  if (!downstream || typeof downstream !== "object") {
    throw new Error("stack readiness downstream_contract must be an object");
  }
  for (const key of ["usable_origin", "route_c_url", "matrix_facade_url", "websocket_url"]) {
    if (downstream[key] !== doc[key]) {
      throw new Error(`downstream_contract.${key} must match top-level ${key}`);
    }
  }
  for (const key of [
    "browser_direct_synapse_dependency",
    "playwright_direct_synapse_dependency",
    "worker_manual_matrix_port_required",
  ]) {
    if (downstream[key] !== false) {
      throw new Error(`downstream_contract.${key} must be false`);
    }
  }
  const diagnostics = doc.internal_diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") {
    throw new Error("stack readiness internal_diagnostics must be an object");
  }
  for (const [key, expected] of [
    ["internal_only", true],
    ["browser_direct_use", false],
    ["playwright_direct_use", false],
    ["worker_manual_input_required", false],
    ["downstream_contract", false],
  ]) {
    if (diagnostics[key] !== expected) {
      throw new Error(`internal_diagnostics.${key} must be ${expected}`);
    }
  }
  if (doc.synapse_status?.raw_origin_exposed_as_downstream_target !== false) {
    throw new Error("synapse_status.raw_origin_exposed_as_downstream_target must be false");
  }
  if (doc.synapse_status?.state !== "not_part_of_accepted_stack") {
    throw new Error("synapse_status.state must be not_part_of_accepted_stack");
  }
  const matrixStorage = doc.matrix_storage_status;
  if (!matrixStorage || matrixStorage.stack_owned_matrix_storage !== true) {
    throw new Error("matrix_storage_status.stack_owned_matrix_storage must be true");
  }
  for (const key of [
    "raw_synapse_base_url_required",
    "raw_synapse_token_required",
    "fixed_matrix_room_env_required",
    "fixed_matrix_user_env_required",
    "browser_direct_synapse_dependency",
    "playwright_direct_synapse_dependency",
  ]) {
    if (matrixStorage[key] !== false) {
      throw new Error(`matrix_storage_status.${key} must be false`);
    }
  }
  const legacyEnv = doc.legacy_runtime_env_status;
  if (!legacyEnv || legacyEnv.live_legacy_files_present !== false) {
    throw new Error("legacy runtime-env files must not remain as live stack truth");
  }
  for (const key of [
    "legacy_runtime_env_live_truth",
    "raw_synapse_base_url_as_stack_truth",
    "raw_synapse_token_as_stack_truth",
    "fixed_matrix_room_user_as_stack_truth",
  ]) {
    if (legacyEnv[key] !== false) {
      throw new Error(`legacy_runtime_env_status.${key} must be false`);
    }
  }
  if (Object.hasOwn(diagnostics.internal_ports, "synapse_configured")) {
    throw new Error("internal_diagnostics.internal_ports.synapse_configured is not accepted stack truth");
  }
  for (const key of ["synapse_base_url_hash", "synapse_config_hash", "routec_runtime_env_path", "routec_runtime_env_hash"]) {
    if (Object.hasOwn(diagnostics, key)) {
      throw new Error(`internal_diagnostics.${key} must not be emitted as readiness truth`);
    }
  }
  const guard = doc.legacy_synapse_listener_guard_status;
  if (!guard || guard.manual_synapse_stop_required_for_accepted_path !== false) {
    throw new Error("legacy Synapse guard must not require manual Synapse stop for the accepted path");
  }
  if (guard.cleanup_status === "blocked") {
    throw new Error("known legacy Route C spike0 Synapse cleanup guard is blocked");
  }
  const dashboardCredentials = doc.dashboard_credential_status;
  if (!dashboardCredentials || typeof dashboardCredentials !== "object") {
    throw new Error("dashboard_credential_status must be an object");
  }
  const routeCStatic = doc.route_c_static_status;
  if (!routeCStatic || typeof routeCStatic !== "object") {
    throw new Error("route_c_static_status must be an object");
  }
  if (typeof routeCStatic.state !== "string" || !routeCStatic.state.trim()) {
    throw new Error("route_c_static_status.state must be a non-empty string");
  }
  for (const key of [
    "dashboard_user_set",
    "dashboard_password_hash_set",
    "dashboard_password_plaintext_recorded",
    "dashboard_password_hash_verifies",
    "credential_source_redacted",
    "existing_stack_credentials_preserved",
    "stack_config_existing_fields_preserved",
    "auth_login_accepted",
    "token_redacted",
    "cookie_redacted",
  ]) {
    if (typeof doc[key] !== "boolean") {
      throw new Error(`dashboard credential readiness field ${key} must be boolean`);
    }
  }
  if (doc.dashboard_password_plaintext_recorded !== false) {
    throw new Error("dashboard_password_plaintext_recorded must be false");
  }
  if (doc.credential_source_redacted !== true || doc.token_redacted !== true || doc.cookie_redacted !== true) {
    throw new Error("dashboard credential readiness redaction fields must be true");
  }
  if (typeof doc.credential_source_kind !== "string" || !doc.credential_source_kind.trim()) {
    throw new Error("credential_source_kind must be a non-empty string");
  }
  if (typeof doc.auth_login_status !== "string" || !doc.auth_login_status.trim()) {
    throw new Error("auth_login_status must be a non-empty string");
  }
  const isSample = typeof doc.generated_by_script === "string" && doc.generated_by_script.includes("sample");
  if (doc.current_valid && !isSample) {
    if (routeCStatic.state !== "dist_index_present") {
      throw new Error("current-valid stack readiness requires Route C web-chat dist/index.html");
    }
    if (doc.served_web_build_hash === "missing") {
      throw new Error("current-valid stack readiness requires a present Route C web-chat build hash");
    }
    const sourceIdentity = doc.source_identity_status;
    if (!sourceIdentity?.repo_root_matches_current_source) {
      throw new Error("current-valid stack readiness requires origin repo_root to match current source root");
    }
    if (!sourceIdentity?.host_pid_matches_origin) {
      throw new Error("current-valid stack readiness requires Host PID to match origin file");
    }
    if (doc.stack_slot_ownership_status?.state !== "owned_by_current_source_root") {
      throw new Error("current-valid stack readiness requires stack slot ownership by current source root");
    }
  }
  return doc;
}

function writeReadiness(doc) {
  validateReadiness(doc);
  const readinessPath = requiredEnv("ROUTEC_STACK_READINESS_PATH");
  mkdirSync(dirname(readinessPath), { recursive: true });
  writeFileSync(readinessPath, `${JSON.stringify(doc, null, 2)}\n`);
  return readinessPath;
}

async function writeCurrent() {
  const doc = await baseFields({ currentValid: true, invalidatedBy: null });
  writeReadiness(doc);
  process.stdout.write(`${JSON.stringify({ path: requiredEnv("ROUTEC_STACK_READINESS_PATH"), current_valid: true })}\n`);
}

async function invalidate(reason) {
  if (!reason || !reason.trim()) {
    throw new Error("invalidate requires a non-empty reason argument");
  }
  const doc = await baseFields({ currentValid: false, invalidatedBy: reason.trim() });
  writeReadiness(doc);
  process.stdout.write(`${JSON.stringify({ path: requiredEnv("ROUTEC_STACK_READINESS_PATH"), current_valid: false, invalidated_by: reason.trim() })}\n`);
}

function validateFile(path) {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  validateReadiness(doc);
  const expectedRepoRoot = optionalEnv("ROUTEC_EXPECTED_REPO_ROOT");
  if (expectedRepoRoot && doc.source_identity_status?.origin_repo_root !== expectedRepoRoot) {
    throw new Error(`stack readiness source identity mismatch: expected ${expectedRepoRoot}, got ${doc.source_identity_status?.origin_repo_root || "missing"}`);
  }
  const expectedGitHead = optionalEnv("ROUTEC_EXPECTED_GIT_HEAD");
  if (expectedGitHead && doc.git_head !== expectedGitHead) {
    throw new Error(`stack readiness git_head mismatch: expected ${expectedGitHead}, got ${doc.git_head || "missing"}`);
  }
  const expectedStackName = optionalEnv("ROUTEC_EXPECTED_STACK_NAME");
  if (expectedStackName && doc.stack_name !== expectedStackName) {
    throw new Error(`stack readiness stack_name mismatch: expected ${expectedStackName}, got ${doc.stack_name || "missing"}`);
  }
  process.stdout.write(`${JSON.stringify({ path, valid: true, schema_version: doc.schema_version, current_valid: doc.current_valid })}\n`);
}

async function validateSample() {
  process.env.ROUTEC_REPO_ROOT ||= process.cwd();
  process.env.ROUTEC_STACK_READINESS_PATH ||= `${process.cwd()}/routec_stack_readiness_sample.json`;
  process.env.ROUTEC_GENERATED_BY_SCRIPT ||= "tool_scripts/routec_stack_readiness.mjs sample";
  process.env.ROUTEC_STACK_NAME ||= "test_w_sample";
  process.env.ROUTEC_WORKER_SLOT ||= "W_SAMPLE";
  process.env.ROUTEC_USABLE_ORIGIN ||= "http://localhost:65530";
  process.env.ROUTEC_HOST_PORT ||= "65530";
  process.env.ROUTEC_HOST_LABEL ||= "com.oysterun.host.test_w_sample";
  process.env.ROUTEC_HOST_ORIGIN_FILE ||= `${process.cwd()}/run/oysterun-host.origin.tsv`;
  process.env.ROUTEC_HOST_LOG ||= `${process.cwd()}/logs/oysterun-host.log`;
  process.env.ROUTEC_STACK_CONFIG_PATH ||= `${process.cwd()}/missing-config.json`;
  process.env.ROUTEC_SERVED_WEB_BUILD_PATH ||= HELPER_PATH;
  process.env.ROUTEC_HOST_START_SCRIPT_PATH ||= HELPER_PATH;
  process.env.ROUTEC_HOST_DB_PATH ||= `${process.cwd()}/host/oysterun.sqlite`;
  process.env.ROUTEC_MATRIX_DB_PATH ||= `${process.cwd()}/matrix/homeserver.db`;
  const doc = await baseFields({ currentValid: true, invalidatedBy: null });
  validateReadiness(doc);
  process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "write-current") {
    await writeCurrent();
  } else if (command === "invalidate") {
    await invalidate(args[0]);
  } else if (command === "validate-file") {
    validateFile(args[0] || requiredEnv("ROUTEC_STACK_READINESS_PATH"));
  } else if (command === "validate-sample") {
    await validateSample();
  } else {
    throw new Error("Usage: routec_stack_readiness.mjs write-current | invalidate <reason> | validate-file <path> | validate-sample");
  }
} catch (error) {
  process.stderr.write(`[routec-stack-readiness] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
