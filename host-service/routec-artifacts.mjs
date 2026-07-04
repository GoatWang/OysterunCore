import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { homedir } from "os";
import { readConfig } from "./config.mjs";
import { writeAtomicTextFile } from "./atomic-file.mjs";
import {
  appendHostRuntimeDiagnostic,
  serializeRuntimeError,
} from "./host-runtime-diagnostics.mjs";

const CONFIG_DIR = process.env.OYSTERUN_CONFIG_DIR || join(homedir(), ".oysterun");
const ROUTEC_ARTIFACT_ROOT =
  process.env.OYSTERUN_ROUTEC_ARTIFACT_ROOT || join(CONFIG_DIR, "oysterun-matrix-artifacts");

export const OYSTERUN_REQUIRED_ARTIFACTS = Object.freeze([
  "matrix_facade_request_response_transcript.jsonl",
  "routec_auth_loss_diagnostics.jsonl",
  "cinny_matrix_client_init_proof.json",
  "send_reconciliation_trace.json",
  "content_equality_or_semantic_equivalence.json",
  "room_row_count_trace.json",
  "semantic_event_render_matrix.md",
  "unauthorized_negative_proof.json",
  "browser_reload_reconciliation_proof.md",
  "host_outbox_matrix_correlation.json",
  "provider_semantic_event_commit.jsonl",
  "control_semantic_event_commit.jsonl",
  "loop_system_semantic_event_commit.jsonl",
  "loop_execution_matrix_delivery.jsonl",
]);

export const OYSTERUN_ROUTEC_RUNTIME_PROOF_ARTIFACTS = Object.freeze([
  "provider_semantic_event_commit.jsonl",
  "provider_semantic_event_commit.json",
  "provider_assistant_semantic_event_commit.json",
  "provider_assistant_semantic_response_proof.json",
  "control_semantic_event_commit.jsonl",
  "loop_system_semantic_event_commit.jsonl",
  "loop_execution_matrix_delivery.jsonl",
  "semantic_event_retry_backoff_ledger.json",
  "semantic_event_render_matrix.md",
  "content_equality_or_semantic_equivalence.json",
  "room_row_count_trace.json",
  "send_reconciliation_trace.json",
  "host_outbox_matrix_correlation.json",
  "host2_agent_intake_cancelability_proof.json",
]);

const ROUTEC_RUNTIME_PROOF_ARTIFACT_SET = new Set(
  OYSTERUN_ROUTEC_RUNTIME_PROOF_ARTIFACTS
);

function ensureArtifactRoot() {
  mkdirSync(ROUTEC_ARTIFACT_ROOT, { recursive: true });
  return ROUTEC_ARTIFACT_ROOT;
}

export function getRouteCArtifactRoot() {
  return ensureArtifactRoot();
}

export function routeCArtifactPath(fileName) {
  if (!OYSTERUN_REQUIRED_ARTIFACTS.includes(fileName) && !fileName.endsWith(".json")) {
    throw new Error(`Unsupported Route C artifact file: ${fileName}`);
  }
  return join(ensureArtifactRoot(), fileName);
}

export function readRouteCJsonArtifact(fileName, fallbackValue = null) {
  const artifactPath = routeCArtifactPath(fileName);
  if (!existsSync(artifactPath)) return fallbackValue;
  return JSON.parse(readFileSync(artifactPath, "utf-8"));
}

export function isRouteCRuntimeProofArtifact(fileName) {
  return ROUTEC_RUNTIME_PROOF_ARTIFACT_SET.has(fileName);
}

function assertRouteCRuntimeProofArtifact(fileName) {
  if (!isRouteCRuntimeProofArtifact(fileName)) {
    throw new Error(`Unsupported Route C runtime proof artifact file: ${fileName}`);
  }
}

export function areRouteCRuntimeProofArtifactWritesEnabled(config = readConfig()) {
  return (
    config.debug_host_artifact_writes_enabled === true &&
    config.debug_routec_runtime_proof_artifacts_enabled === true
  );
}

export function readRouteCRuntimeProofJsonArtifact(
  fileName,
  fallbackValue = null
) {
  assertRouteCRuntimeProofArtifact(fileName);
  if (!areRouteCRuntimeProofArtifactWritesEnabled()) return fallbackValue;
  return readRouteCJsonArtifact(fileName, fallbackValue);
}

export function writeRouteCJsonArtifact(fileName, payload) {
  const artifactPath = routeCArtifactPath(fileName);
  writeAtomicTextFile(artifactPath, JSON.stringify(payload, null, 2) + "\n");
  return artifactPath;
}

export function writeRouteCRuntimeProofJsonArtifact(fileName, payload) {
  assertRouteCRuntimeProofArtifact(fileName);
  if (!areRouteCRuntimeProofArtifactWritesEnabled()) return null;
  return writeRouteCJsonArtifact(fileName, payload);
}

export function writeRouteCTextArtifact(fileName, text) {
  const artifactPath = routeCArtifactPath(fileName);
  writeAtomicTextFile(
    artifactPath,
    `${text.endsWith("\n") ? text : `${text}\n`}`
  );
  return artifactPath;
}

export function writeRouteCRuntimeProofTextArtifact(fileName, text) {
  assertRouteCRuntimeProofArtifact(fileName);
  if (!areRouteCRuntimeProofArtifactWritesEnabled()) return null;
  return writeRouteCTextArtifact(fileName, text);
}

function normalizePositiveInteger(value, fallbackValue) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : Number.parseInt(value, 10);
  return parsed > 0 ? parsed : fallbackValue;
}

function rotateJsonlArtifact(artifactPath, maxFiles) {
  if (maxFiles <= 0) {
    rmSync(artifactPath, { force: true });
    return;
  }
  const oldestPath = `${artifactPath}.${maxFiles}`;
  rmSync(oldestPath, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const sourcePath = `${artifactPath}.${index}`;
    const targetPath = `${artifactPath}.${index + 1}`;
    if (existsSync(sourcePath)) {
      renameSync(sourcePath, targetPath);
    }
  }
  if (existsSync(artifactPath)) {
    renameSync(artifactPath, `${artifactPath}.1`);
  }
}

function buildCappedJsonlPayload(fileName, payload, maxBytes, lineByteLength) {
  return {
    routec_jsonl_entry_truncated_for_artifact_cap: true,
    artifact_file: fileName,
    artifact_cap_bytes: maxBytes,
    original_entry_byte_length: lineByteLength,
    original_entry_sha256: createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
    raw_secret_material_exposed: false,
  };
}

function serializeJsonlPayloadWithCap(fileName, payload, maxBytes) {
  let line = `${JSON.stringify(payload)}\n`;
  if (!maxBytes) return line;
  const lineByteLength = Buffer.byteLength(line, "utf8");
  if (lineByteLength <= maxBytes) return line;
  line = `${JSON.stringify(
    buildCappedJsonlPayload(fileName, payload, maxBytes, lineByteLength)
  )}\n`;
  if (Buffer.byteLength(line, "utf8") > maxBytes) {
    throw new Error(
      `Route C JSONL append exceeds hard cap after truncation: ${fileName}`
    );
  }
  return line;
}

export function appendRouteCJsonlArtifact(fileName, payload, options = {}) {
  if (!fileName.endsWith(".jsonl")) {
    throw new Error(`Route C JSONL append requires .jsonl artifact: ${fileName}`);
  }
  const artifactPath = routeCArtifactPath(fileName);
  const maxBytes = normalizePositiveInteger(options.maxBytes, null);
  const maxFiles = normalizePositiveInteger(options.maxFiles, 3);
  const shouldRotate = options.rotate === true && Boolean(maxBytes);
  const line = serializeJsonlPayloadWithCap(fileName, payload, maxBytes);
  if (shouldRotate && existsSync(artifactPath)) {
    const currentSize = statSync(artifactPath).size;
    if (currentSize > 0 && currentSize + Buffer.byteLength(line, "utf8") > maxBytes) {
      rotateJsonlArtifact(artifactPath, maxFiles);
    }
  }
  appendFileSync(artifactPath, line);
  return artifactPath;
}

export function appendRouteCRuntimeProofJsonlArtifact(
  fileName,
  payload,
  options = {}
) {
  assertRouteCRuntimeProofArtifact(fileName);
  if (!areRouteCRuntimeProofArtifactWritesEnabled()) return null;
  return appendRouteCJsonlArtifact(fileName, payload, options);
}

export function safelyRunOptionalRouteCArtifact(operation, context = {}) {
  try {
    return operation();
  } catch (err) {
    appendHostRuntimeDiagnostic({
      level: "warning",
      kind: "optional_routec_artifact_failure",
      context,
      error: serializeRuntimeError(err),
      product_request_continues: true,
    });
    return null;
  }
}

export function ensureRouteCSpike0ArtifactPlaceholders(context = {}) {
  const root = ensureArtifactRoot();
  const now = new Date().toISOString();
  const placeholder = {
    status: "pending_runtime_proof",
    route: "Route C Spike 0 Host /_matrix facade",
    generated_at: now,
    raw_synapse_token_exposed: false,
    source_only_placeholder: true,
    ...context,
  };

  for (const fileName of OYSTERUN_REQUIRED_ARTIFACTS) {
    const artifactPath = join(root, fileName);
    if (existsSync(artifactPath)) continue;
    if (fileName.endsWith(".jsonl")) {
      writeAtomicTextFile(artifactPath, "");
    } else if (fileName.endsWith(".md")) {
      writeAtomicTextFile(
        artifactPath,
        [
          `# ${fileName.replace(/_/g, " ").replace(/\.md$/, "")}`,
          "",
          "- status: pending_runtime_proof",
          "- source_only_placeholder: true",
          "- raw_synapse_token_exposed: false",
          "",
        ].join("\n"),
      );
    } else {
      writeAtomicTextFile(
        artifactPath,
        JSON.stringify(placeholder, null, 2) + "\n"
      );
    }
  }

  return {
    artifact_root: root,
    artifact_names: OYSTERUN_REQUIRED_ARTIFACTS,
  };
}
