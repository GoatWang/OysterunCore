import { dirname } from "path";
import { writeRouteCJsonArtifact } from "./routec-artifacts.mjs";
import { getRouteCMatrixStorageProof } from "./routec-matrix-storage-adapter.mjs";

function hasNonEmptyEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function buildRouteCRuntimeEnvPreflight() {
  const storageProof = getRouteCMatrixStorageProof();
  const configDirPresent = hasNonEmptyEnv("OYSTERUN_CONFIG_DIR");
  const storagePathPresent = typeof storageProof.storage_path === "string" && storageProof.storage_path.trim().length > 0;
  const ready = configDirPresent && storagePathPresent;
  return {
    route: "oysterun_runtime_env_preflight",
    status: ready ? "ready" : "blocked",
    classification: ready
      ? "OYSTERUN_HOST_OWNED_MATRIX_STORAGE_PREFLIGHT_READY"
      : "OYSTERUN_HOST_OWNED_MATRIX_STORAGE_INPUT_REQUIRED",
    canonical_runtime_source: "host_owned_matrix_storage_adapter",
    host_owned_matrix_storage: true,
    matrix_storage_path: storageProof.storage_path,
    matrix_storage_parent: dirname(storageProof.storage_path),
    matrix_storage_path_source: storageProof.storage_path_source,
    required_stack_keys: [
      {
        key: "OYSTERUN_CONFIG_DIR",
        kind: "host_config_dir",
        present: configDirPresent,
        source: "process.env",
        raw_value_exposed: false,
      },
      {
        key: "OYSTERUN_ROUTEC_MATRIX_STORAGE_PATH",
        kind: "stack_owned_matrix_storage_path",
        present: storagePathPresent,
        source: storageProof.storage_path_source,
        raw_value_exposed: false,
      },
    ],
    manual_routec_runtime_env_required: false,
    raw_synapse_base_url_required: false,
    raw_synapse_token_required: false,
    fixed_matrix_room_env_required: false,
    fixed_matrix_user_env_required: false,
    fallback_matrix_env_accepted: false,
    host_held_env_contract: false,
    matrix_synapse_values_browser_exposed: false,
    raw_synapse_token_exposed: false,
    browser_storage_raw_synapse_token: false,
    missing_required_keys: ready ? [] : [
      ...(configDirPresent ? [] : ["OYSTERUN_CONFIG_DIR"]),
      ...(storagePathPresent ? [] : ["OYSTERUN_ROUTEC_MATRIX_STORAGE_PATH"]),
    ],
    storage: storageProof,
  };
}

export function writeRouteCRuntimeEnvPreflightProof() {
  const proof = buildRouteCRuntimeEnvPreflight();
  writeRouteCJsonArtifact("runtime_env_preflight.json", proof);
  return proof;
}
