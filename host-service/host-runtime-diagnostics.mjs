import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { getConfigDir } from "./config.mjs";
import { writeAtomicJsonFile } from "./atomic-file.mjs";

const HOST_RUNTIME_METADATA_FILE = "host-runtime.json";
const HOST_RUNTIME_DIAGNOSTICS_FILE = "host-runtime-diagnostics.jsonl";
const MAX_ERROR_MESSAGE_LENGTH = 800;

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveHostRuntimeRunDir(configDir = getConfigDir()) {
  const resolvedConfigDir = resolve(configDir);
  if (
    basename(resolvedConfigDir) === "host" &&
    basename(dirname(dirname(resolvedConfigDir))) === ".oysterun-stacks"
  ) {
    return join(dirname(resolvedConfigDir), "run");
  }
  return join(resolvedConfigDir, "run");
}

export function getHostRuntimeMetadataPath(configDir = getConfigDir()) {
  return join(resolveHostRuntimeRunDir(configDir), HOST_RUNTIME_METADATA_FILE);
}

export function getHostRuntimeDiagnosticsPath(configDir = getConfigDir()) {
  return join(resolveHostRuntimeRunDir(configDir), HOST_RUNTIME_DIAGNOSTICS_FILE);
}

function boundedString(value, maxLength = MAX_ERROR_MESSAGE_LENGTH) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

export function serializeRuntimeError(err) {
  if (!err) return { name: "Error", message: "unknown error" };
  if (err instanceof Error) {
    return {
      name: boundedString(err.name, 120) || "Error",
      message: boundedString(err.message) || "unknown error",
      code: boundedString(err.code, 120),
    };
  }
  return {
    name: "NonError",
    message: boundedString(String(err)) || "unknown rejection",
    code: null,
  };
}

export function buildHostRuntimeMetadata({
  port,
  repoRoot,
  hostDir,
  stackName = null,
  launchLabel = null,
  connectionMode = null,
  directHostUrl = null,
  startedAt = null,
} = {}) {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    written_at: now,
    started_at: startedAt || now,
    pid: process.pid,
    ppid: process.ppid,
    port,
    repo_root: repoRoot || null,
    host_dir: hostDir || null,
    config_dir: getConfigDir(),
    stack_name: stackName || null,
    launch_label: launchLabel || null,
    connection_mode: connectionMode || null,
    direct_host_url: directHostUrl || null,
    node_version: process.version,
    argv: process.argv,
    script_pid_origin_files_report_only: true,
    stale_script_pid_origin_cleanup_performed: false,
  };
}

export function writeHostRuntimeMetadata(options = {}) {
  const metadataPath = getHostRuntimeMetadataPath();
  mkdirSync(dirname(metadataPath), { recursive: true });
  const metadata = buildHostRuntimeMetadata(options);
  writeAtomicJsonFile(metadataPath, metadata);
  return { path: metadataPath, metadata };
}

export function readHostRuntimeMetadata(configDir = getConfigDir()) {
  const metadataPath = getHostRuntimeMetadataPath(configDir);
  if (!existsSync(metadataPath)) return null;
  const parsed = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Host runtime metadata root object: ${metadataPath}`);
  }
  return parsed;
}

function buildScriptPidOriginReportOnlyStatus() {
  return {
    handling: "report_only",
    cleanup_or_rewrite_performed: false,
  };
}

export function readHostRuntimeMetadataStatus(configDir = getConfigDir()) {
  const metadataPath = getHostRuntimeMetadataPath(configDir);
  try {
    const metadata = readHostRuntimeMetadata(configDir);
    if (!metadata) {
      return {
        status: "unavailable",
        path: metadataPath,
        error: `Host runtime metadata file is missing: ${metadataPath}`,
        missing: true,
        script_pid_origin_artifacts: buildScriptPidOriginReportOnlyStatus(),
        secret_fields_redacted: true,
      };
    }
    return {
      status: "available",
      path: metadataPath,
      metadata,
      script_pid_origin_artifacts: buildScriptPidOriginReportOnlyStatus(),
      secret_fields_redacted: true,
    };
  } catch (err) {
    return {
      status: "unavailable",
      path: metadataPath,
      error: err.message,
      missing: false,
      script_pid_origin_artifacts: buildScriptPidOriginReportOnlyStatus(),
      secret_fields_redacted: true,
    };
  }
}

export function appendHostRuntimeDiagnostic(payload = {}) {
  const diagnosticPath = getHostRuntimeDiagnosticsPath();
  try {
    mkdirSync(dirname(diagnosticPath), { recursive: true });
    appendFileSync(
      diagnosticPath,
      `${JSON.stringify({
        schema_version: 1,
        written_at: new Date().toISOString(),
        pid: process.pid,
        process_uptime_ms: Math.round(process.uptime() * 1000),
        raw_secret_material_exposed: false,
        ...payload,
      })}\n`,
      "utf8"
    );
    return { written: true, path: diagnosticPath };
  } catch (err) {
    console.warn(
      `[oysterun-host] Runtime diagnostic write failed: ${err.message}`
    );
    return { written: false, path: diagnosticPath, error: err.message };
  }
}
