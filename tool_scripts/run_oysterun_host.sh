#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oysterun_service_common.sh"

parse_common_args "$@"
configure_stack_runtime
require_host_port_configured
ensure_runtime_dirs
append_service_control_audit "run_host_supervisor" "attempt" "script=tool_scripts/run_oysterun_host.sh"
sync_host_stack_port_config

NODE_BIN="$(require_node_runtime "LaunchAgent Host start")"

ensure_stack_dashboard_credentials "${NODE_BIN}"
quarantine_legacy_routec_runtime_env_files_if_present "${NODE_BIN}"
cleanup_legacy_routec_spike0_synapse_processes_if_present "${NODE_BIN}"
ensure_routec_web_chat_static_app
LAUNCH_PATH="$(build_launch_path)"
HOST_CHILD_PID=""
HOST_LAUNCH_LABEL="${LAUNCH_JOB_LABEL:-${HOST_LABEL}}"

cleanup() {
  local exit_code=$?

  append_service_control_audit "run_host_supervisor" "exit" "script=tool_scripts/run_oysterun_host.sh;exit_code=${exit_code};host_child_pid=${HOST_CHILD_PID}"
  clear_host_origin_file
  rm -f "${HOST_PID_FILE}"

  if [[ -n "${HOST_CHILD_PID}" ]] && pid_is_running "${HOST_CHILD_PID}"; then
    append_service_control_audit "process_signal" "attempt" "signal=TERM;reason=run_host_cleanup;label=${HOST_LABEL};pid=${HOST_CHILD_PID}"
    kill "${HOST_CHILD_PID}" 2>/dev/null || true
    append_service_control_audit "process_signal" "done" "signal=TERM;reason=run_host_cleanup;label=${HOST_LABEL};pid=${HOST_CHILD_PID}"
    wait "${HOST_CHILD_PID}" 2>/dev/null || true
  fi

  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

export PATH="${LAUNCH_PATH}"

cd "${HOST_DIR}"

collect_routec_host_env_args

/usr/bin/env \
  OYSTERUN_CONFIG_DIR="${CONFIG_DIR}" \
  OYSTERUN_PORT="${HOST_PORT}" \
  OYSTERUN_REPO_ROOT="${ROOT_DIR}" \
  OYSTERUN_NODE_BIN="${NODE_BIN}" \
  "${ROUTEC_HOST_ENV_ARGS[@]}" \
  "${NODE_BIN}" server.mjs &
HOST_CHILD_PID=$!
append_service_control_audit "run_host_child" "started" "script=tool_scripts/run_oysterun_host.sh;host_child_pid=${HOST_CHILD_PID}"

wait_for_http "${HOST_URL}/health" "Host service" "${HOST_CHILD_PID}" "${HOST_LOG}"
printf '%s\n' "${HOST_CHILD_PID}" > "${HOST_PID_FILE}"
verify_process_cwd "${HOST_CHILD_PID}" "${HOST_DIR}" "Host service"
write_host_origin_file "${HOST_CHILD_PID}" "${HOST_LAUNCH_LABEL}"
append_service_control_audit "run_host_child" "ready" "script=tool_scripts/run_oysterun_host.sh;host_child_pid=${HOST_CHILD_PID}"

child_status=0
if wait "${HOST_CHILD_PID}"; then
  child_status=0
else
  child_status=$?
fi
append_service_control_audit "run_host_child" "exited" "script=tool_scripts/run_oysterun_host.sh;host_child_pid=${HOST_CHILD_PID};child_status=${child_status}"

exit "${child_status}"
