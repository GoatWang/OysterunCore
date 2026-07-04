#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
HOST_DIR="${ROOT_DIR}/host-service"
STACKS_DIR="${OYSTERUN_STACKS_DIR:-${HOME}/.oysterun-stacks}"
HOME_CONFIG_DIR="${HOME}/.oysterun"
PRODUCTION_STACK_NAME="production"
STAGING_STACK_NAME="staging"
STACK_NAME="${OYSTERUN_STACK:-${PRODUCTION_STACK_NAME}}"
STACK_KIND=""
STACK_ROOT=""
CONFIG_DIR=""
CONFIG_PATH=""
RUN_DIR=""
LOG_DIR=""
BACKEND_PID_FILE=""
HOST_PID_FILE=""
BACKEND_LOG=""
HOST_LOG=""
BACKEND_LABEL=""
HOST_LABEL=""
HOST_ORIGIN_FILE=""
BACKEND_BIND_HOST=""
BACKEND_PORT=""
BACKEND_INTERNAL_URL=""
BACKEND_PUBLIC_BASE_URL=""
BACKEND_DB_PATH=""
BACKEND_DB_URL=""
HOST_PORT_OVERRIDE=""
BACKEND_PORT_OVERRIDE=""
HOST_PORT=""
HOST_URL=""
STACK_READINESS_FILE=""
ROUTEC_STACK_READINESS_SCRIPT="${ROOT_DIR}/tool_scripts/routec_stack_readiness.mjs"
ROUTEC_RUNTIME_ENV_FILE=""
ROUTEC_RUNTIME_ENV_JSON_FILE=""
ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_DIR=""
ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_FILE=""
ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_FILE=""
STACK_DASHBOARD_CREDENTIALS_PROOF_FILE=""
ROUTEC_WEB_CHAT_DIR="${ROOT_DIR}/dev/client/web-chat"
ROUTEC_WEB_CHAT_DIST_INDEX="${ROOT_DIR}/dev/client/web-chat/dist/index.html"
ROUTEC_WEB_CHAT_PREBUILT_MARKER="${ROOT_DIR}/dev/client/web-chat/oysterun-release-prebuilt.marker"
DASHBOARD_WEB_DIR="${ROOT_DIR}/dev/client/web"
DASHBOARD_WEB_INDEX="${ROOT_DIR}/dev/client/web/index.html"
DASHBOARD_WEB_PREBUILT_MARKER="${ROOT_DIR}/dev/client/web/oysterun-release-prebuilt.marker"
STACK_DASHBOARD_CREDENTIALS_SCRIPT="${ROOT_DIR}/tool_scripts/stack_dashboard_credentials.mjs"
HOST_TRANSCRIPTS_DB_PATH=""
MATRIX_DB_PATH=""
SYNAPSE_CONFIG_PATH=""
ROUTEC_HOST_ENV_ALLOWLIST=(
  OYSTERUN_ROUTEC_ARTIFACT_ROOT
  OYSTERUN_ROUTEC_REQUEST_TRAFFIC_LOG_PATH
  OYSTERUN_ENABLE_TEST_FIXTURE_UI
)

PRODUCTION_HOST_PORT="8802"
STAGING_HOST_PORT="9902"
TEST1_HOST_PORT="3022"
TEST2_HOST_PORT="3302"
TEST3_HOST_PORT="4022"
TEST4_HOST_PORT="4402"
LEGACY_RUN_DIR="${HOME_CONFIG_DIR}/run"
LEGACY_BACKEND_LABEL="com.oysterun.backend"
LEGACY_HOST_LABEL="com.oysterun.host"
LEGACY_HOST_PORT_LABEL="com.oysterun.host.8802"
LEGACY_BACKEND_PID_FILE="${LEGACY_RUN_DIR}/oysterun-backend.pid"
LEGACY_HOST_PID_FILE="${LEGACY_RUN_DIR}/oysterun-host.pid"
LEGACY_HOST_PORT_PID_FILE="${LEGACY_RUN_DIR}/oysterun-host-8802.pid"

is_macos() {
  [[ "$(uname -s)" == "Darwin" ]]
}

is_linux() {
  [[ "$(uname -s)" == "Linux" ]]
}

parse_common_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --stack|-stack|-s)
        if [[ $# -lt 2 ]]; then
          echo "[oysterun-service] error: --stack requires a value" >&2
          exit 1
        fi
        STACK_NAME="$2"
        shift 2
        ;;
      --stack_name|-stack_name)
        if [[ $# -lt 2 ]]; then
          echo "[oysterun-service] error: --stack_name requires a value" >&2
          exit 1
        fi
        STACK_NAME="$2"
        shift 2
        ;;
      --port|-port|-p)
        if [[ $# -lt 2 ]]; then
          echo "[oysterun-service] error: --port requires a value" >&2
          exit 1
        fi
        HOST_PORT_OVERRIDE="$2"
        shift 2
        ;;
      --backend_port|-backend_port)
        if [[ $# -lt 2 ]]; then
          echo "[oysterun-service] error: --backend_port requires a value" >&2
          exit 1
        fi
        BACKEND_PORT_OVERRIDE="$2"
        shift 2
        ;;
      *)
        echo "[oysterun-service] error: unknown argument: $1" >&2
        exit 1
        ;;
    esac
  done
}

is_predefined_stack() {
  case "$1" in
    production|staging|test1|test2|test3|test4)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_reserved_custom_stack_name() {
  case "$1" in
    production|staging|test1|test2|test3|test4|local|phone|daily|shared)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_stack_name_format() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
}

validate_port_value() {
  local raw_port="$1"
  if ! [[ "${raw_port}" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if (( raw_port < 1 || raw_port > 65535 )); then
    return 1
  fi
  return 0
}

validate_stack() {
  if is_predefined_stack "${STACK_NAME}"; then
    STACK_KIND="preset"
    return
  fi

  if ! validate_stack_name_format "${STACK_NAME}"; then
    echo "[oysterun-service] error: invalid stack name: ${STACK_NAME}" >&2
    echo "[oysterun-service] error: stack names must match ^[a-z0-9][a-z0-9_-]*$" >&2
    exit 1
  fi

  if is_reserved_custom_stack_name "${STACK_NAME}"; then
    echo "[oysterun-service] error: reserved stack name: ${STACK_NAME}" >&2
    echo "[oysterun-service] error: reserved names are: production, staging, test1, test2, test3, test4, local, phone, daily, shared" >&2
    exit 1
  fi

  STACK_KIND="custom"
}

quarantine_legacy_routec_runtime_env_files_if_present() {
  local node_bin="$1"
  local timestamp
  local entries_path
  local legacy_path
  local target_path
  local legacy_hash

  if [[ -z "${ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_DIR}" || -z "${ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_FILE}" ]]; then
    echo "[oysterun-service] error: legacy Route C runtime-env quarantine path is not configured" >&2
    return 1
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "${ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_DIR}" "${RUN_DIR}"
  entries_path="${RUN_DIR}/legacy-routec-runtime-env-quarantine.entries.${timestamp}.$$"
  : > "${entries_path}"

  for legacy_path in "${ROUTEC_RUNTIME_ENV_FILE}" "${ROUTEC_RUNTIME_ENV_JSON_FILE}"; do
    if [[ -f "${legacy_path}" ]]; then
      legacy_hash="$(shasum -a 256 "${legacy_path}" | awk '{print $1}')"
      target_path="${ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_DIR}/${timestamp}-$$-$(basename "${legacy_path}")"
      mv "${legacy_path}" "${target_path}"
      chmod 0600 "${target_path}" 2>/dev/null || true
      printf '%s\t%s\t%s\n' "${legacy_path}" "${target_path}" "${legacy_hash}" >> "${entries_path}"
      echo "[oysterun-service] Quarantined legacy Route C runtime env $(basename "${legacy_path}")"
    fi
  done

  ROUTEC_LEGACY_RUNTIME_ENV_ENTRIES_PATH="${entries_path}" \
  ROUTEC_LEGACY_RUNTIME_ENV_PROOF_PATH="${ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_FILE}" \
  ROUTEC_LEGACY_RUNTIME_ENV_SH_PATH="${ROUTEC_RUNTIME_ENV_FILE}" \
  ROUTEC_LEGACY_RUNTIME_ENV_JSON_PATH="${ROUTEC_RUNTIME_ENV_JSON_FILE}" \
  ROUTEC_LEGACY_RUNTIME_ENV_STACK_NAME="${STACK_NAME}" \
  ROUTEC_LEGACY_RUNTIME_ENV_STACK_ROOT="${STACK_ROOT}" \
  "${node_bin}" --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const entriesPath = process.env.ROUTEC_LEGACY_RUNTIME_ENV_ENTRIES_PATH;
const rows = readFileSync(entriesPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [legacy_path, quarantined_path, sha256] = line.split("\t");
    return { legacy_path, quarantined_path, sha256 };
  });

const proof = {
  schema_version: "routec.legacy_runtime_env_quarantine.v1",
  generated_at: new Date().toISOString(),
  stack_name: process.env.ROUTEC_LEGACY_RUNTIME_ENV_STACK_NAME,
  stack_root: process.env.ROUTEC_LEGACY_RUNTIME_ENV_STACK_ROOT,
  action: rows.length ? "quarantined_legacy_runtime_env_files" : "no_legacy_runtime_env_files_present",
  legacy_runtime_env_live_truth: false,
  raw_synapse_base_url_as_stack_truth: false,
  raw_synapse_token_as_stack_truth: false,
  fixed_matrix_room_user_as_stack_truth: false,
  legacy_paths_checked: [
    process.env.ROUTEC_LEGACY_RUNTIME_ENV_SH_PATH,
    process.env.ROUTEC_LEGACY_RUNTIME_ENV_JSON_PATH,
  ],
  quarantined_files: rows,
};

writeFileSync(process.env.ROUTEC_LEGACY_RUNTIME_ENV_PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
NODE
  rm -f "${entries_path}"
}

legacy_routec_spike0_synapse_pids() {
  ps -axo pid=,command= | awk '
    /synapse_homeserver/ && /artifacts\/spike0/ && /routec_spike0/ {
      print $1
    }
  '
}

cleanup_legacy_routec_spike0_synapse_processes_if_present() {
  local node_bin="$1"
  local timestamp
  local pids_path
  local pid
  local cleanup_status="clean"

  if [[ -z "${ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_FILE}" ]]; then
    echo "[oysterun-service] error: legacy Route C spike0 Synapse cleanup proof path is not configured" >&2
    return 1
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "${RUN_DIR}"
  pids_path="${RUN_DIR}/legacy-routec-spike0-synapse-pids.${timestamp}.$$"
  legacy_routec_spike0_synapse_pids > "${pids_path}"

  while IFS= read -r pid; do
    if [[ -z "${pid}" ]]; then
      continue
    fi
    echo "[oysterun-service] Cleaning up legacy Route C spike0 Synapse PID ${pid}"
    kill "${pid}" 2>/dev/null || true
    if ! wait_for_exit "${pid}"; then
      kill -9 "${pid}" 2>/dev/null || true
      wait_for_exit "${pid}" || true
    fi
    if pid_is_running "${pid}"; then
      cleanup_status="blocked"
    fi
  done < "${pids_path}"

  ROUTEC_LEGACY_SPIKE0_SYNAPSE_PIDS_PATH="${pids_path}" \
  ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_PATH="${ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_FILE}" \
  ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_STATUS="${cleanup_status}" \
  ROUTEC_LEGACY_SPIKE0_SYNAPSE_STACK_NAME="${STACK_NAME}" \
  ROUTEC_LEGACY_SPIKE0_SYNAPSE_STACK_ROOT="${STACK_ROOT}" \
  "${node_bin}" --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const pids = readFileSync(process.env.ROUTEC_LEGACY_SPIKE0_SYNAPSE_PIDS_PATH, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const proof = {
  schema_version: "routec.legacy_spike0_synapse_cleanup.v1",
  generated_at: new Date().toISOString(),
  stack_name: process.env.ROUTEC_LEGACY_SPIKE0_SYNAPSE_STACK_NAME,
  stack_root: process.env.ROUTEC_LEGACY_SPIKE0_SYNAPSE_STACK_ROOT,
  action: pids.length ? "cleaned_known_legacy_routec_spike0_synapse_processes" : "no_known_legacy_routec_spike0_synapse_processes_present",
  cleanup_status: process.env.ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_STATUS,
  known_legacy_match: {
    command_contains: ["synapse_homeserver", "artifacts/spike0", "routec_spike0"],
    arbitrary_process_cleanup_allowed: false,
  },
  pids_seen: pids,
  manual_synapse_stop_required_for_accepted_path: false,
};

writeFileSync(process.env.ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
NODE
  rm -f "${pids_path}"

  if [[ "${cleanup_status}" != "clean" ]]; then
    echo "[oysterun-service] error: failed to clean known legacy Route C spike0 Synapse process" >&2
    return 1
  fi
}

collect_routec_host_env_args() {
  local key

  ROUTEC_HOST_ENV_ARGS=(
    "OYSTERUN_ROUTEC_MATRIX_STORAGE_PATH=${MATRIX_DB_PATH}"
    "OYSTERUN_ROUTEC_STACK_ROOT=${STACK_ROOT}"
    "OYSTERUN_ROUTEC_STACK_NAME=${STACK_NAME}"
  )
  for key in "${ROUTEC_HOST_ENV_ALLOWLIST[@]}"; do
    if [[ -n "${!key:-}" ]]; then
      ROUTEC_HOST_ENV_ARGS+=("${key}=${!key}")
    fi
  done
}

read_port_from_config_file() {
  local config_path="$1"
  local port
  if [[ ! -f "${config_path}" ]]; then
    return 1
  fi

  port="$(sed -n 's/^[[:space:]]*"port":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "${config_path}" | head -n 1)"
  if [[ -z "${port}" ]]; then
    return 1
  fi
  printf '%s\n' "${port}"
}

read_port_from_origin_file() {
  local origin_path="$1"
  local port
  if [[ ! -f "${origin_path}" ]]; then
    return 1
  fi

  port="$(awk -F $'\t' '$1 == "host_port" { print $2; exit }' "${origin_path}")"
  if [[ -z "${port}" ]]; then
    return 1
  fi
  printf '%s\n' "${port}"
}

resolve_custom_stack_host_port() {
  local derived_port=""

  if [[ -n "${HOST_PORT_OVERRIDE}" ]]; then
    if ! validate_port_value "${HOST_PORT_OVERRIDE}"; then
      echo "[oysterun-service] error: invalid --port value: ${HOST_PORT_OVERRIDE}" >&2
      exit 1
    fi
    derived_port="${HOST_PORT_OVERRIDE}"
  elif derived_port="$(read_port_from_origin_file "${HOST_ORIGIN_FILE}")"; then
    :
  elif derived_port="$(read_port_from_config_file "${CONFIG_PATH}")"; then
    :
  else
    derived_port=""
  fi

  printf '%s' "${derived_port}"
}

require_host_port_configured() {
  if [[ -n "${HOST_PORT}" ]]; then
    return
  fi

  echo "[oysterun-service] error: stack ${STACK_NAME} requires --port for startup" >&2
  exit 1
}

configure_stack_runtime() {
  validate_stack

  if [[ "${STACK_KIND}" == "preset" && -n "${HOST_PORT_OVERRIDE}" ]]; then
    echo "[oysterun-service] error: --port is only supported for custom stacks" >&2
    exit 1
  fi
  if [[ "${STACK_KIND}" == "preset" && -n "${BACKEND_PORT_OVERRIDE}" ]]; then
    echo "[oysterun-service] error: --backend_port is only supported for custom stacks" >&2
    exit 1
  fi

  BACKEND_DB_PATH="${STACKS_DIR}/shared/backend/oysterun.db"
  BACKEND_DB_URL="sqlite+aiosqlite:///${BACKEND_DB_PATH}"

  case "${STACK_NAME}" in
    production)
      STACK_ROOT="${HOME_CONFIG_DIR}"
      CONFIG_DIR="${STACK_ROOT}"
      CONFIG_PATH="${CONFIG_DIR}/config.json"
      RUN_DIR="${STACK_ROOT}/run"
      LOG_DIR="${STACK_ROOT}/logs"
      BACKEND_PID_FILE="${RUN_DIR}/oysterun-backend.pid"
      HOST_PID_FILE="${RUN_DIR}/oysterun-host.pid"
      BACKEND_LOG="${LOG_DIR}/oysterun-backend.log"
      HOST_LOG="${LOG_DIR}/oysterun-host.log"
      BACKEND_LABEL="${LEGACY_BACKEND_LABEL}"
      HOST_LABEL="${LEGACY_HOST_LABEL}"
      HOST_ORIGIN_FILE="${RUN_DIR}/oysterun-host.origin.tsv"
      BACKEND_BIND_HOST="127.0.0.1"
      BACKEND_PORT="8000"
      BACKEND_INTERNAL_URL="http://127.0.0.1:8000"
      BACKEND_PUBLIC_BASE_URL="http://localhost:8000"
      HOST_PORT="${PRODUCTION_HOST_PORT}"
      ;;
    staging)
      STACK_ROOT="${STACKS_DIR}/${STACK_NAME}"
      CONFIG_DIR="${STACK_ROOT}/host"
      CONFIG_PATH="${CONFIG_DIR}/config.json"
      RUN_DIR="${STACK_ROOT}/run"
      LOG_DIR="${STACK_ROOT}/logs"
      BACKEND_PID_FILE="${RUN_DIR}/oysterun-backend.pid"
      HOST_PID_FILE="${RUN_DIR}/oysterun-host.pid"
      BACKEND_LOG="${LOG_DIR}/oysterun-backend.log"
      HOST_LOG="${LOG_DIR}/oysterun-host.log"
      BACKEND_LABEL="com.oysterun.backend.${STACK_NAME}"
      HOST_LABEL="com.oysterun.host.${STACK_NAME}"
      HOST_ORIGIN_FILE="${RUN_DIR}/oysterun-host.origin.tsv"
      BACKEND_BIND_HOST="0.0.0.0"
      BACKEND_PORT="9000"
      BACKEND_INTERNAL_URL="http://127.0.0.1:9000"
      BACKEND_PUBLIC_BASE_URL="http://${OYSTERUN_STAGING_LAN_HOST:-localhost}:9000"
      HOST_PORT="${STAGING_HOST_PORT}"
      ;;
    test1|test2|test3|test4)
      STACK_ROOT="${STACKS_DIR}/${STACK_NAME}"
      CONFIG_DIR="${STACK_ROOT}/host"
      CONFIG_PATH="${CONFIG_DIR}/config.json"
      RUN_DIR="${STACK_ROOT}/run"
      LOG_DIR="${STACK_ROOT}/logs"
      BACKEND_PID_FILE="${RUN_DIR}/oysterun-backend.pid"
      HOST_PID_FILE="${RUN_DIR}/oysterun-host.pid"
      BACKEND_LOG="${LOG_DIR}/oysterun-backend.log"
      HOST_LOG="${LOG_DIR}/oysterun-host.log"
      BACKEND_LABEL="com.oysterun.backend.${STACK_NAME}"
      HOST_LABEL="com.oysterun.host.${STACK_NAME}"
      HOST_ORIGIN_FILE="${RUN_DIR}/oysterun-host.origin.tsv"
      case "${STACK_NAME}" in
        test1) HOST_PORT="${TEST1_HOST_PORT}" ;;
        test2) HOST_PORT="${TEST2_HOST_PORT}" ;;
        test3) HOST_PORT="${TEST3_HOST_PORT}" ;;
        test4) HOST_PORT="${TEST4_HOST_PORT}" ;;
      esac
      ;;
    *)
      STACK_ROOT="${STACKS_DIR}/${STACK_NAME}"
      CONFIG_DIR="${STACK_ROOT}/host"
      CONFIG_PATH="${CONFIG_DIR}/config.json"
      RUN_DIR="${STACK_ROOT}/run"
      LOG_DIR="${STACK_ROOT}/logs"
      BACKEND_PID_FILE="${RUN_DIR}/oysterun-backend-${STACK_NAME}.pid"
      HOST_PID_FILE="${RUN_DIR}/oysterun-host-${STACK_NAME}.pid"
      BACKEND_LOG="${LOG_DIR}/oysterun-backend-${STACK_NAME}.log"
      HOST_LOG="${LOG_DIR}/oysterun-host-${STACK_NAME}.log"
      BACKEND_LABEL="com.oysterun.backend.${STACK_NAME}"
      HOST_LABEL="com.oysterun.host.${STACK_NAME}"
      HOST_ORIGIN_FILE="${RUN_DIR}/oysterun-host-${STACK_NAME}.origin.tsv"
      HOST_PORT="$(resolve_custom_stack_host_port)"
      ;;
  esac

  if [[ -n "${HOST_PORT}" ]]; then
    HOST_URL="http://localhost:${HOST_PORT}"
  else
    HOST_URL=""
  fi

  STACK_READINESS_FILE="${RUN_DIR}/stack_readiness.json"
  ROUTEC_RUNTIME_ENV_FILE="${CONFIG_DIR}/routec-runtime-env.sh"
  ROUTEC_RUNTIME_ENV_JSON_FILE="${CONFIG_DIR}/routec-runtime-env.json"
  ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_DIR="${CONFIG_DIR}/legacy-routec-runtime-env-quarantine"
  ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_FILE="${ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_DIR}/latest-proof.json"
  ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_FILE="${RUN_DIR}/legacy-routec-spike0-synapse-cleanup.json"
  STACK_DASHBOARD_CREDENTIALS_PROOF_FILE="${RUN_DIR}/stack_dashboard_credentials.json"
  HOST_TRANSCRIPTS_DB_PATH="${CONFIG_DIR}/oysterun.sqlite"
  MATRIX_DB_PATH="${STACK_ROOT}/matrix/homeserver.db"
  SYNAPSE_CONFIG_PATH="${STACK_ROOT}/matrix/homeserver.yaml"
}

configure_backend_dev_runtime() {
  if [[ -z "${CONFIG_DIR}" || -z "${RUN_DIR}" || -z "${LOG_DIR}" ]]; then
    configure_stack_runtime
  fi

  case "${STACK_NAME}" in
    staging)
      if [[ -z "${BACKEND_BIND_HOST}" || -z "${BACKEND_PORT}" || -z "${BACKEND_INTERNAL_URL}" || -z "${BACKEND_PUBLIC_BASE_URL}" || -z "${BACKEND_DB_PATH}" || -z "${BACKEND_DB_URL}" ]]; then
        echo "[oysterun-service] error: backend dev runtime is not configured for stack ${STACK_NAME}" >&2
        exit 1
      fi
      ;;
    production)
      echo "[oysterun-service] error: production uses the home Host; use start_oysterun.sh for regular service or --stack staging for watch-mode development" >&2
      exit 1
      ;;
    test1|test2|test3|test4)
      echo "[oysterun-service] error: ${STACK_NAME} is a fixed Host-only test slot; use start_oysterun.sh or a custom stack with --backend_port for dev_up" >&2
      exit 1
      ;;
    *)
      require_host_port_configured
      if [[ -z "${BACKEND_PORT_OVERRIDE}" ]]; then
        echo "[oysterun-service] error: stack ${STACK_NAME} requires --backend_port for dev_up" >&2
        exit 1
      fi
      if ! validate_port_value "${BACKEND_PORT_OVERRIDE}"; then
        echo "[oysterun-service] error: invalid --backend_port value: ${BACKEND_PORT_OVERRIDE}" >&2
        exit 1
      fi
      BACKEND_BIND_HOST="127.0.0.1"
      BACKEND_PORT="${BACKEND_PORT_OVERRIDE}"
      BACKEND_INTERNAL_URL="http://127.0.0.1:${BACKEND_PORT}"
      BACKEND_PUBLIC_BASE_URL="http://localhost:${BACKEND_PORT}"
      ;;
  esac
}

fixed_stack_names() {
  printf '%s\n' production staging test1 test2 test3 test4
}

resolve_command_path() {
  local name="$1"
  local resolved=""
  resolved="$(command -v "${name}" 2>/dev/null || true)"
  if [[ -z "${resolved}" ]]; then
    resolved="$(which "${name}" 2>/dev/null || true)"
  fi
  if [[ -z "${resolved}" ]]; then
    local candidate=""
    for candidate in \
      "/opt/homebrew/bin/${name}" \
      "/usr/local/bin/${name}" \
      "${HOME}/.local/bin/${name}" \
      "${HOME}/bin/${name}"
    do
      if [[ -x "${candidate}" ]]; then
        resolved="${candidate}"
        break
      fi
    done
  fi
  printf '%s' "${resolved}"
}

append_unique_launch_dir() {
  local candidate="$1"
  if [[ -z "${candidate}" ]]; then
    return
  fi

  local existing
  for existing in "${LAUNCH_PATH_DIRS[@]:-}"; do
    if [[ "${existing}" == "${candidate}" ]]; then
      return
    fi
  done

  LAUNCH_PATH_DIRS+=("${candidate}")
}

build_launch_path() {
  LAUNCH_PATH_DIRS=()

  local command_name=""
  local resolved_command=""
  for command_name in claude codex node; do
    resolved_command="$(resolve_command_path "${command_name}")"
    if [[ -n "${resolved_command}" ]]; then
      append_unique_launch_dir "$(dirname "${resolved_command}")"
    fi
  done

  append_unique_launch_dir /usr/bin
  append_unique_launch_dir /bin
  append_unique_launch_dir /usr/sbin
  append_unique_launch_dir /sbin

  local launch_path=""
  launch_path="$(IFS=:; printf '%s' "${LAUNCH_PATH_DIRS[*]}")"
  printf '%s' "${launch_path}"
}

pid_is_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

pid_from_file() {
  local pid_file="$1"
  if [[ -f "${pid_file}" ]]; then
    tr -d '[:space:]' < "${pid_file}"
  fi
}

origin_host_pid_from_file() {
  local origin_file="$1"
  if [[ -f "${origin_file}" ]]; then
    awk -F $'\t' '$1 == "host_pid" { print $2; exit }' "${origin_file}"
  fi
}

listener_pids_for_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sort -u || true
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "${port}" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :${port}" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
      | sort -u || true
    return 0
  fi
  return 0
}

ensure_port_available() {
  local port="$1"
  local listeners

  if [[ -z "${port}" ]]; then
    echo "[oysterun-service] error: port required" >&2
    exit 1
  fi

  listeners="$(listener_pids_for_port "${port}")"
  if [[ -n "${listeners}" ]]; then
    listeners="$(printf '%s\n' "${listeners}" | paste -sd ',' -)"
    echo "[oysterun-service] error: Port ${port} is already in use by PID ${listeners}" >&2
    exit 1
  fi
}

launchctl_label_exists() {
  local label="$1"
  if ! is_macos; then
    return 1
  fi
  launchctl list "${label}" >/dev/null 2>&1 || launchctl print "$(launchd_gui_domain)/${label}" >/dev/null 2>&1
}

launchctl_pid_for_label() {
  local label="$1"
  local pid=""

  if ! is_macos; then
    return 0
  fi

  pid="$(launchctl list "${label}" 2>/dev/null | awk '
    /"PID" = / {
      gsub(/[^0-9]/, "", $0);
      if (length($0) > 0) {
        print $0;
        exit;
      }
    }
  ' || true)"
  if [[ -n "${pid}" ]]; then
    printf '%s\n' "${pid}"
    return 0
  fi

  pid="$(launchctl print "$(launchd_gui_domain)/${label}" 2>/dev/null | awk '
    $1 == "pid" && $2 == "=" {
      gsub(/[^0-9]/, "", $3);
      if (length($3) > 0) {
        print $3;
        exit;
      }
    }
  ' || true)"
  if [[ -n "${pid}" ]]; then
    printf '%s\n' "${pid}"
  fi
  return 0
}

launchd_gui_domain() {
  local uid=""
  if ! is_macos; then
    echo "[oysterun-service] error: launchd domain is only available on macOS" >&2
    return 1
  fi
  uid="$(id -u)"
  if launchctl print "gui/${uid}" >/dev/null 2>&1; then
    printf 'gui/%s' "${uid}"
    return
  fi
  printf 'user/%s' "${uid}"
}

launch_agent_plist_path_for_label() {
  local label="$1"
  if ! is_macos; then
    return 0
  fi
  printf '%s/Library/LaunchAgents/%s.plist\n' "${HOME}" "${label}"
}

launch_agent_is_installed_for_label() {
  local label="$1"
  local plist_path=""
  if ! is_macos; then
    return 1
  fi
  plist_path="$(launch_agent_plist_path_for_label "${label}")"
  [[ -f "${plist_path}" ]]
}

launch_service_is_loaded() {
  local label="$1"
  if ! is_macos; then
    return 1
  fi
  launchctl print "$(launchd_gui_domain)/${label}" >/dev/null 2>&1
}

bootstrap_launch_agent_plist() {
  local plist_path="$1"
  if ! is_macos; then
    echo "[oysterun-service] error: launchd bootstrap is only available on macOS" >&2
    return 1
  fi
  launchctl bootstrap "$(launchd_gui_domain)" "${plist_path}"
}

bootout_launch_agent_service() {
  local label="$1"
  local plist_path=""
  if ! is_macos; then
    return 0
  fi
  plist_path="$(launch_agent_plist_path_for_label "${label}")"

  launchctl bootout "$(launchd_gui_domain)/${label}" >/dev/null 2>&1 \
    || launchctl bootout "$(launchd_gui_domain)" "${plist_path}" >/dev/null 2>&1 \
    || true
}

kickstart_launch_agent_service() {
  local label="$1"
  if ! is_macos; then
    echo "[oysterun-service] error: launchd kickstart is only available on macOS" >&2
    return 1
  fi
  launchctl kickstart -k "$(launchd_gui_domain)/${label}"
}

ensure_runtime_dirs() {
  mkdir -p "${CONFIG_DIR}" "${RUN_DIR}" "${LOG_DIR}" "$(dirname "${BACKEND_DB_PATH}")" "$(dirname "${MATRIX_DB_PATH}")"
}

ensure_backend_dev_runtime_dirs() {
  if [[ -z "${BACKEND_DB_PATH}" ]]; then
    echo "[oysterun-service] error: backend dev runtime is not configured" >&2
    exit 1
  fi

  mkdir -p "$(dirname "${BACKEND_DB_PATH}")"
}

sync_host_stack_port_config() {
  local node_bin

  require_host_port_configured
  node_bin="$(resolve_command_path node)"
  if [[ -z "${node_bin}" ]]; then
    echo "[oysterun-service] error: node is required but was not found in PATH" >&2
    exit 1
  fi
  (
    cd "${ROOT_DIR}"
    OYSTERUN_CONFIG_DIR="${CONFIG_DIR}" \
    OYSTERUN_PORT="${HOST_PORT}" \
    "${node_bin}" tool_scripts/sync_host_stack_config.mjs
  )
}

ensure_stack_dashboard_credentials() {
  local node_bin="$1"

  if [[ -z "${node_bin}" ]]; then
    echo "[oysterun-service] error: node is required for dashboard credential readiness" >&2
    return 1
  fi
  if [[ -z "${CONFIG_DIR}" || -z "${HOST_URL}" || -z "${STACK_DASHBOARD_CREDENTIALS_PROOF_FILE}" ]]; then
    echo "[oysterun-service] error: dashboard credential readiness requires configured stack runtime" >&2
    return 1
  fi

  (
    cd "${ROOT_DIR}"
    OYSTERUN_CONFIG_DIR="${CONFIG_DIR}" \
    OYSTERUN_STACK_NAME="${STACK_NAME}" \
    OYSTERUN_HOST_ORIGIN="${HOST_URL}" \
    OYSTERUN_STACK_DASHBOARD_CREDENTIALS_PROOF_PATH="${STACK_DASHBOARD_CREDENTIALS_PROOF_FILE}" \
    "${node_bin}" "${STACK_DASHBOARD_CREDENTIALS_SCRIPT}" ensure
  )
}

ensure_dashboard_static_app() {
  local node_bin="$1"

  if [[ -f "${DASHBOARD_WEB_PREBUILT_MARKER}" ]]; then
    if [[ ! -f "${DASHBOARD_WEB_INDEX}" ]]; then
      echo "[oysterun-service] error: prebuilt dashboard marker exists but ${DASHBOARD_WEB_INDEX} is missing" >&2
      return 1
    fi
    echo "[oysterun-service] Using prebuilt dashboard static app for stack ${STACK_NAME}."
    return 0
  fi

  echo "[oysterun-service] Building web client for stack ${STACK_NAME}..."
  (
    cd "${ROOT_DIR}"
    exec "${node_bin}" dev/client/web/build-index.mjs
  )
}

ensure_routec_web_chat_static_app() {
  local npm_bin

  if [[ -f "${ROUTEC_WEB_CHAT_PREBUILT_MARKER}" ]]; then
    if [[ ! -f "${ROUTEC_WEB_CHAT_DIST_INDEX}" ]]; then
      echo "[oysterun-service] error: prebuilt Route C web-chat marker exists but ${ROUTEC_WEB_CHAT_DIST_INDEX} is missing" >&2
      return 1
    fi
    echo "[oysterun-service] Using prebuilt Route C web-chat static app for stack ${STACK_NAME}."
    return 0
  fi

  if [[ ! -f "${ROUTEC_WEB_CHAT_DIR}/package.json" ]]; then
    echo "[oysterun-service] error: Route C web-chat package.json is missing: ${ROUTEC_WEB_CHAT_DIR}/package.json" >&2
    return 1
  fi
  if [[ ! -f "${ROUTEC_WEB_CHAT_DIR}/package-lock.json" ]]; then
    echo "[oysterun-service] error: Route C web-chat package-lock.json is missing: ${ROUTEC_WEB_CHAT_DIR}/package-lock.json" >&2
    return 1
  fi
  if [[ ! -x "${ROUTEC_WEB_CHAT_DIR}/node_modules/.bin/vite" ]]; then
    echo "[oysterun-service] error: Route C web-chat dependencies are not materialized in ${ROUTEC_WEB_CHAT_DIR}/node_modules" >&2
    echo "[oysterun-service] error: run 'cd ${ROUTEC_WEB_CHAT_DIR} && npm ci' before starting this stack" >&2
    return 1
  fi

  npm_bin="$(resolve_command_path npm)"
  if [[ -z "${npm_bin}" ]]; then
    echo "[oysterun-service] error: npm is required to build Route C web-chat but was not found in PATH" >&2
    return 1
  fi

  echo "[oysterun-service] Building Route C web-chat static app for stack ${STACK_NAME}..."
  (
    cd "${ROUTEC_WEB_CHAT_DIR}"
    "${npm_bin}" run build
  )

  if [[ ! -f "${ROUTEC_WEB_CHAT_DIST_INDEX}" ]]; then
    echo "[oysterun-service] error: Route C web-chat build did not produce ${ROUTEC_WEB_CHAT_DIST_INDEX}" >&2
    return 1
  fi
}

clear_stale_pid_file() {
  local pid_file="$1"
  local label="$2"
  local pid

  pid="$(pid_from_file "${pid_file}")"
  if [[ -n "${pid}" ]] && ! pid_is_running "${pid}"; then
    rm -f "${pid_file}"
    echo "[oysterun-service] Removed stale ${label} PID file (${pid})"
  fi
}

ensure_process_not_running() {
  local launch_label="$1"
  local pid_file="$2"
  local label="$3"
  local port="$4"
  local pid

  clear_stale_pid_file "${pid_file}" "${label}"

  if launchctl_label_exists "${launch_label}"; then
    pid="$(launchctl_pid_for_label "${launch_label}")"
    if [[ -n "${pid}" ]] && pid_is_running "${pid}"; then
      echo "[oysterun-service] error: ${label} is already running with PID ${pid}" >&2
      exit 1
    fi
    launchctl remove "${launch_label}" >/dev/null 2>&1 || true
    rm -f "${pid_file}"
    echo "[oysterun-service] Removed stale launchctl job for ${label}"
  fi

  ensure_port_available "${port}"
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local pid="$3"
  local log_file="$4"
  local launch_label="${5:-}"
  local attempts=0

  until curl -fsS "${url}" >/dev/null 2>&1; do
    local current_pid="${pid}"
    if [[ -n "${launch_label}" ]] && is_macos; then
      current_pid="$(launchctl_pid_for_label "${launch_label}")"
    fi

    if [[ -n "${current_pid}" ]] && ! pid_is_running "${current_pid}" 2>/dev/null; then
      if [[ -n "${launch_label}" ]] && launchctl_label_exists "${launch_label}"; then
        attempts=$((attempts + 1))
        if [[ "${attempts}" -ge 60 ]]; then
          echo "[oysterun-service] error: timed out waiting for ${label} at ${url}" >&2
          if [[ -f "${log_file}" ]]; then
            echo "[oysterun-service] Last ${label} log lines:" >&2
            tail -n 40 "${log_file}" >&2 || true
          fi
          exit 1
        fi
        sleep 1
        continue
      fi
      echo "[oysterun-service] error: ${label} exited before becoming healthy" >&2
      if [[ -f "${log_file}" ]]; then
        echo "[oysterun-service] Last ${label} log lines:" >&2
        tail -n 40 "${log_file}" >&2 || true
      fi
      exit 1
    fi

    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 60 ]]; then
      echo "[oysterun-service] error: timed out waiting for ${label} at ${url}" >&2
      if [[ -f "${log_file}" ]]; then
        echo "[oysterun-service] Last ${label} log lines:" >&2
        tail -n 40 "${log_file}" >&2 || true
      fi
      exit 1
    fi

    sleep 1
  done
}

write_pid_file_from_label() {
  local launch_label="$1"
  local pid_file="$2"
  local pid

  if ! is_macos; then
    return 0
  fi

  pid="$(launchctl_pid_for_label "${launch_label}")"
  if [[ -n "${pid}" ]]; then
    printf '%s\n' "${pid}" > "${pid_file}"
  else
    rm -f "${pid_file}"
  fi
}

submit_launchctl_job() {
  local launch_label="$1"
  local log_file="$2"
  local command_string="$3"

  if ! is_macos; then
    echo "[oysterun-service] error: launchctl submit is only available on macOS" >&2
    return 1
  fi

  launchctl submit -l "${launch_label}" -o "${log_file}" -e "${log_file}" -- /bin/zsh -lc "${command_string}"
}

wait_for_exit() {
  local pid="$1"
  local attempts=0

  while pid_is_running "${pid}"; do
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 40 ]]; then
      return 1
    fi
    sleep 0.5
  done

  return 0
}

process_cwd_for_pid() {
  local pid="$1"

  if [[ -e "/proc/${pid}/cwd" ]]; then
    readlink "/proc/${pid}/cwd" 2>/dev/null || true
    return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -a -d cwd -p "${pid}" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
  fi
}

process_command_for_pid() {
  local pid="$1"
  ps -p "${pid}" -o command= 2>/dev/null || true
}

sqlite_sidecar_paths_for_db() {
  local db_path="$1"
  if [[ -z "${db_path}" ]]; then
    return 0
  fi
  printf '%s\n' "${db_path}" "${db_path}-wal" "${db_path}-shm"
}

stack_host_state_paths() {
  sqlite_sidecar_paths_for_db "${HOST_TRANSCRIPTS_DB_PATH}"
  sqlite_sidecar_paths_for_db "${MATRIX_DB_PATH}"
}

stack_host_state_holder_pids() {
  local paths=()
  local path

  while IFS= read -r path; do
    if [[ -n "${path}" && -e "${path}" ]]; then
      paths+=("${path}")
    fi
  done < <(stack_host_state_paths)

  if (( ${#paths[@]} == 0 )); then
    return 0
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -t "${paths[@]}" 2>/dev/null | sort -u || true
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser "${paths[@]}" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u || true
    return 0
  fi

  return 0
}

pid_matches_oysterun_host_server() {
  local pid="$1"
  local command_line=""
  local cwd=""

  command_line="$(process_command_for_pid "${pid}")"
  cwd="$(process_cwd_for_pid "${pid}")"

  case "${command_line}" in
    *server.mjs*) ;;
    *) return 1 ;;
  esac

  case "${cwd}" in
    */host-service) return 0 ;;
    *) return 1 ;;
  esac
}

stop_stale_stack_host_state_holders() {
  local reason="${1:-stack cleanup}"
  local pid=""
  local holders=""
  local candidates=()

  holders="$(stack_host_state_holder_pids)"
  if [[ -z "${holders}" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    if [[ -z "${pid}" || "${pid}" == "$$" ]]; then
      continue
    fi
    if ! pid_is_running "${pid}"; then
      continue
    fi
    if pid_matches_oysterun_host_server "${pid}"; then
      candidates+=("${pid}")
    else
      echo "[oysterun-service] Warning: stack ${STACK_NAME} state files are held by non-Host PID ${pid}; leaving it running" >&2
    fi
  done <<< "${holders}"

  if (( ${#candidates[@]} == 0 )); then
    return 0
  fi

  echo "[oysterun-service] Stopping stale stack ${STACK_NAME} Host process(es) holding state files (${reason}): ${candidates[*]}"
  for pid in "${candidates[@]}"; do
    kill "${pid}" 2>/dev/null || true
  done
  for pid in "${candidates[@]}"; do
    if pid_is_running "${pid}" && ! wait_for_exit "${pid}"; then
      echo "[oysterun-service] Stale Host process ${pid} did not stop in time; sending SIGKILL"
      kill -9 "${pid}" 2>/dev/null || true
      wait_for_exit "${pid}" || true
    fi
  done
}

verify_process_cwd() {
  local pid="$1"
  local expected_cwd="$2"
  local label="$3"
  local actual_cwd

  actual_cwd="$(process_cwd_for_pid "${pid}")"
  if [[ -z "${actual_cwd}" ]]; then
    echo "[oysterun-service] error: could not resolve ${label} cwd for PID ${pid}" >&2
    return 1
  fi
  if [[ "${actual_cwd}" != "${expected_cwd}" ]]; then
    echo "[oysterun-service] error: ${label} started from unexpected cwd" >&2
    echo "[oysterun-service] error: expected ${expected_cwd}" >&2
    echo "[oysterun-service] error: actual   ${actual_cwd}" >&2
    return 1
  fi
}

write_host_origin_file() {
  local pid="$1"
  local launch_label="$2"
  local actual_cwd

  actual_cwd="$(process_cwd_for_pid "${pid}")"
  if [[ -z "${actual_cwd}" ]]; then
    echo "[oysterun-service] error: could not resolve Host service cwd for PID ${pid}" >&2
    return 1
  fi

  cat > "${HOST_ORIGIN_FILE}" <<EOF
key	value
started_at_utc	$(date -u +"%Y-%m-%dT%H:%M:%SZ")
repo_root	${ROOT_DIR}
host_dir	${HOST_DIR}
actual_cwd	${actual_cwd}
config_dir	${CONFIG_DIR}
host_port	${HOST_PORT}
host_pid	${pid}
launch_label	${launch_label}
EOF
}

clear_host_origin_file() {
  rm -f "${HOST_ORIGIN_FILE}"
}

wait_for_host_identity_files() {
  local label="$1"
  local expected_cwd="$2"
  local attempts="${3:-100}"
  local attempt=0
  local pid=""
  local origin_pid=""

  while (( attempt < attempts )); do
    pid="$(pid_from_file "${HOST_PID_FILE}" || true)"
    origin_pid="$(origin_host_pid_from_file "${HOST_ORIGIN_FILE}" || true)"
    if [[ -n "${pid}" && -n "${origin_pid}" && "${pid}" == "${origin_pid}" ]] && pid_is_running "${pid}"; then
      if verify_process_cwd "${pid}" "${expected_cwd}" "${label}" >/dev/null 2>&1; then
        printf '%s\n' "${pid}"
        return 0
      fi
    fi
    attempt=$((attempt + 1))
    sleep 0.2
  done

  echo "[oysterun-service] error: Host started but runtime identity files did not become ready in time." >&2
  echo "[oysterun-service] error: Run 'oysterun service:status' to inspect the service, then retry restart." >&2
  return 1
}

derive_routec_worker_slot() {
  case "${STACK_NAME}" in
    test_w[0-9]*)
      printf 'W%s' "${STACK_NAME#test_w}"
      ;;
    w[0-9]*)
      printf 'W%s' "${STACK_NAME#w}"
      ;;
    *)
      printf '%s' "${STACK_NAME}"
      ;;
  esac
}

run_routec_stack_readiness() {
  local command_name="$1"
  shift
  local node_bin
  local host_pid=""

  if [[ -z "${STACK_READINESS_FILE}" || -z "${HOST_URL}" || -z "${HOST_PORT}" ]]; then
    echo "[oysterun-service] error: stack readiness requires configured stack runtime" >&2
    return 1
  fi

  node_bin="$(resolve_command_path node)"
  if [[ -z "${node_bin}" ]]; then
    echo "[oysterun-service] error: node is required for stack readiness but was not found in PATH" >&2
    return 1
  fi

  host_pid="$(pid_from_file "${HOST_PID_FILE}")"
  if [[ -z "${host_pid}" ]]; then
    host_pid="$(origin_host_pid_from_file "${HOST_ORIGIN_FILE}" || true)"
  fi
  if [[ -z "${host_pid}" ]] && is_macos && launchctl_label_exists "${HOST_LABEL}"; then
    host_pid="$(launchctl_pid_for_label "${HOST_LABEL}")"
  fi

  ROUTEC_REPO_ROOT="${ROOT_DIR}" \
  ROUTEC_STACK_READINESS_PATH="${STACK_READINESS_FILE}" \
  ROUTEC_GENERATED_BY_SCRIPT="${command_name}" \
  ROUTEC_STACK_NAME="${STACK_NAME}" \
  ROUTEC_STACK_ROOT="${STACK_ROOT}" \
  ROUTEC_CONFIG_DIR="${CONFIG_DIR}" \
  ROUTEC_RUN_DIR="${RUN_DIR}" \
  ROUTEC_LOG_DIR="${LOG_DIR}" \
  ROUTEC_WORKER_SLOT="$(derive_routec_worker_slot)" \
  ROUTEC_USABLE_ORIGIN="${HOST_URL}" \
  ROUTEC_HOST_PORT="${HOST_PORT}" \
  ROUTEC_BACKEND_PORT="${BACKEND_PORT:-}" \
  ROUTEC_HOST_PID="${host_pid}" \
  ROUTEC_HOST_LABEL="${HOST_LABEL}" \
  ROUTEC_HOST_ORIGIN_FILE="${HOST_ORIGIN_FILE}" \
  ROUTEC_HOST_LOG="${HOST_LOG}" \
  ROUTEC_STACK_CONFIG_PATH="${CONFIG_PATH}" \
  ROUTEC_RUNTIME_ENV_PATH="${ROUTEC_RUNTIME_ENV_FILE}" \
  ROUTEC_RUNTIME_ENV_JSON_PATH="${ROUTEC_RUNTIME_ENV_JSON_FILE}" \
  ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_PATH="${ROUTEC_LEGACY_RUNTIME_ENV_QUARANTINE_PROOF_FILE}" \
  ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_PATH="${ROUTEC_LEGACY_SPIKE0_SYNAPSE_CLEANUP_PROOF_FILE}" \
  ROUTEC_STACK_DASHBOARD_CREDENTIALS_PROOF_PATH="${STACK_DASHBOARD_CREDENTIALS_PROOF_FILE}" \
  ROUTEC_SERVED_WEB_BUILD_PATH="${ROUTEC_WEB_CHAT_DIST_INDEX}" \
  ROUTEC_HOST_START_SCRIPT_PATH="${ROOT_DIR}/tool_scripts/start_oysterun.sh" \
  ROUTEC_HOST_DB_PATH="${HOST_TRANSCRIPTS_DB_PATH}" \
  ROUTEC_MATRIX_DB_PATH="${MATRIX_DB_PATH}" \
  ROUTEC_SYNAPSE_CONFIG_PATH="${SYNAPSE_CONFIG_PATH}" \
  "${node_bin}" "${ROUTEC_STACK_READINESS_SCRIPT}" "$@"
}

invalidate_routec_stack_readiness() {
  local reason="$1"
  local command_name="${2:-tool_scripts/unknown}"
  run_routec_stack_readiness "${command_name}" invalidate "${reason}"
}

write_current_routec_stack_readiness() {
  local command_name="${1:-tool_scripts/start_oysterun.sh}"
  run_routec_stack_readiness "${command_name}" write-current
}

stop_managed_process() {
  local launch_label="$1"
  local pid_file="$2"
  local label="$3"
  local pid

  clear_stale_pid_file "${pid_file}" "${label}"
  pid=""

  if launchctl_label_exists "${launch_label}"; then
    pid="$(launchctl_pid_for_label "${launch_label}")"
  else
    pid="$(pid_from_file "${pid_file}")"
  fi

  if [[ -z "${pid}" ]]; then
    if launchctl_label_exists "${launch_label}"; then
      echo "[oysterun-service] Removing stale ${label} launchctl job"
      launchctl remove "${launch_label}" >/dev/null 2>&1 || true
    fi
    rm -f "${pid_file}"
    echo "[oysterun-service] ${label} is not running"
    return 0
  fi

  if ! pid_is_running "${pid}"; then
    if launchctl_label_exists "${launch_label}"; then
      launchctl remove "${launch_label}" >/dev/null 2>&1 || true
    fi
    rm -f "${pid_file}"
    echo "[oysterun-service] Removed stale ${label} PID file (${pid})"
    return 0
  fi

  echo "[oysterun-service] Stopping ${label} (PID ${pid})..."

  if launchctl_label_exists "${launch_label}"; then
    launchctl remove "${launch_label}" >/dev/null 2>&1 || true
  else
    kill "${pid}" 2>/dev/null || true
  fi

  if ! wait_for_exit "${pid}"; then
    echo "[oysterun-service] ${label} did not stop in time; sending SIGKILL"
    kill -9 "${pid}" 2>/dev/null || true
    wait_for_exit "${pid}" || true
  fi

  rm -f "${pid_file}"
}

cleanup_legacy_home_port_host_jobs_if_needed() {
  if [[ "${STACK_NAME}" != "production" ]]; then
    return
  fi

  stop_managed_process "${LEGACY_HOST_PORT_LABEL}" "${LEGACY_HOST_PORT_PID_FILE}" "legacy Host service" >/dev/null 2>&1 || true
}

cleanup_legacy_home_backend_jobs_if_needed() {
  if [[ "${STACK_NAME}" != "production" ]]; then
    return
  fi

  stop_managed_process "${LEGACY_BACKEND_LABEL}" "${LEGACY_BACKEND_PID_FILE}" "legacy backend" >/dev/null 2>&1 || true
}
