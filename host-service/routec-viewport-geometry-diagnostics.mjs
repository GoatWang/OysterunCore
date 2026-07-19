import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, join } from "path";

import { getConfigDir, readConfig } from "./config.mjs";

const ROUTEC_VIEWPORT_GEOMETRY_DIAGNOSTIC_FILE =
  "routec-viewport-geometry-diagnostics.jsonl";
const ROUTEC_VIEWPORT_GEOMETRY_SCHEMA =
  "routec.viewport_geometry_diagnostic.v1";
const DEFAULT_MAX_BYTES = 262_144;
const DEFAULT_MAX_FILES = 3;

const STRING_FIELDS = new Map([
  ["trigger", 80],
  ["matrix_event_id", 255],
  ["matrix_event_type", 120],
  ["matrix_event_sender", 255],
  ["viewport_first_event_id", 255],
  ["viewport_center_event_id", 255],
  ["viewport_last_event_id", 255],
  ["live_bottom_transaction_phase", 40],
  ["live_bottom_transaction_event_id", 255],
  ["live_bottom_transaction_behavior", 40],
]);

const NUMBER_FIELDS = new Set([
  "client_recorded_at_ms",
  "scroll_top",
  "scroll_height",
  "client_height",
  "max_scroll_top",
  "distance_from_bottom",
  "scroll_content_height",
  "bottom_anchor_top",
  "bottom_anchor_bottom",
  "bottom_anchor_distance_from_viewport_bottom",
  "timeline_range_start",
  "timeline_range_end",
  "timeline_event_count",
  "visible_rendered_count",
  "scroll_to_bottom_request_count",
  "live_bottom_transaction_revision",
  "live_bottom_previous_max_scroll_top",
  "live_bottom_current_max_scroll_top",
]);

const BOOLEAN_FIELDS = new Set([
  "at_bottom",
  "live_timeline_linked",
  "range_at_end",
  "range_at_start",
  "scroll_to_bottom_smooth",
  "backward_placeholder_present",
  "forward_placeholder_present",
  "document_has_focus",
]);

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeSample(sample) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    throw new Error(
      "Route C viewport geometry diagnostic sample must be an object",
    );
  }
  const normalized = {};
  for (const [field, maxLength] of STRING_FIELDS) {
    const value = boundedString(sample[field], maxLength);
    if (value !== null) normalized[field] = value;
  }
  for (const field of NUMBER_FIELDS) {
    const value = sample[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[field] = Math.round(value * 100) / 100;
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof sample[field] === "boolean") normalized[field] = sample[field];
  }
  if (!normalized.trigger) {
    throw new Error("Route C viewport geometry diagnostic trigger is required");
  }
  return normalized;
}

function rotate(path, maxFiles) {
  rmSync(`${path}.${maxFiles}`, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${path}.${index}`;
    if (existsSync(source)) renameSync(source, `${path}.${index + 1}`);
  }
  if (existsSync(path)) renameSync(path, `${path}.1`);
}

export function getRouteCViewportGeometryDiagnosticPath(
  configDir = getConfigDir(),
) {
  return join(
    configDir,
    "operation_logs",
    ROUTEC_VIEWPORT_GEOMETRY_DIAGNOSTIC_FILE,
  );
}

export function areRouteCViewportGeometryDiagnosticsEnabled(
  config = readConfig(),
) {
  return (
    config.debug_host_artifact_writes_enabled === true &&
    config.debug_routec_viewport_geometry_diagnostics_enabled === true
  );
}

export function appendRouteCViewportGeometryDiagnostic({
  hostSessionId,
  matrixRoomId,
  sample,
  config = readConfig(),
  configDir = getConfigDir(),
}) {
  if (!areRouteCViewportGeometryDiagnosticsEnabled(config)) {
    return { written: false, status: "disabled" };
  }
  const normalizedHostSessionId = boundedString(hostSessionId, 255);
  const normalizedMatrixRoomId = boundedString(matrixRoomId, 255);
  if (!normalizedHostSessionId || !normalizedMatrixRoomId) {
    throw new Error("Route C viewport geometry diagnostic binding is required");
  }
  const payload = {
    schema_version: ROUTEC_VIEWPORT_GEOMETRY_SCHEMA,
    recorded_at: new Date().toISOString(),
    pid: process.pid,
    host_session_id: normalizedHostSessionId,
    matrix_room_id: normalizedMatrixRoomId,
    ...normalizeSample(sample),
    message_body_recorded: false,
    raw_secret_material_exposed: false,
    product_behavior_mutated: false,
  };
  const path = getRouteCViewportGeometryDiagnosticPath(configDir);
  const maxBytes = normalizePositiveInteger(
    config.debug_routec_facade_transcript_max_bytes,
    DEFAULT_MAX_BYTES,
  );
  const maxFiles = normalizePositiveInteger(
    config.debug_routec_facade_transcript_max_files,
    DEFAULT_MAX_FILES,
  );
  const line = `${JSON.stringify(payload)}\n`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (
    existsSync(path) &&
    statSync(path).size > 0 &&
    statSync(path).size + Buffer.byteLength(line, "utf8") > maxBytes
  ) {
    rotate(path, maxFiles);
  }
  appendFileSync(path, line, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return { written: true, status: "recorded", path };
}
