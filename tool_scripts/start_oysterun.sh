#!/usr/bin/env bash

set -euo pipefail

: "${OYSTERUN_STACK:=production}"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oysterun_service_common.sh"

parse_common_args "$@"
configure_stack_runtime
require_host_port_configured
ensure_runtime_dirs
append_service_control_audit "service_start" "attempt" "script=tool_scripts/start_oysterun.sh"
cleanup_legacy_home_port_host_jobs_if_needed
sync_host_stack_port_config

STARTED_HOST=0

cleanup_failed_start() {
  trap - ERR

  append_service_control_audit "service_start" "failed" "script=tool_scripts/start_oysterun.sh;started_host=${STARTED_HOST}"
  if [[ "${STARTED_HOST}" -eq 1 ]]; then
    stop_managed_process "${HOST_LABEL}" "${HOST_PID_FILE}" "Host service" >/dev/null 2>&1 || true
  fi
  clear_host_origin_file
  invalidate_routec_stack_readiness "start_failed" "tool_scripts/start_oysterun.sh" >/dev/null 2>&1 || true
}

trap cleanup_failed_start ERR

NODE_BIN="$(require_node_runtime "Host start")"

ensure_stack_dashboard_credentials "${NODE_BIN}"
quarantine_legacy_routec_runtime_env_files_if_present "${NODE_BIN}"
cleanup_legacy_routec_spike0_synapse_processes_if_present "${NODE_BIN}"
invalidate_routec_stack_readiness "start_in_progress" "tool_scripts/start_oysterun.sh" >/dev/null

LAUNCH_PATH="$(build_launch_path)"
PERSISTENT_PLIST=""
if launch_agent_is_installed_for_label "${HOST_LABEL}"; then
  PERSISTENT_PLIST="$(launch_agent_plist_path_for_label "${HOST_LABEL}")"
fi

if [[ -z "${PERSISTENT_PLIST}" ]]; then
  ensure_process_not_running "${HOST_LABEL}" "${HOST_PID_FILE}" "Host service" "${HOST_PORT}"
  stop_stale_stack_host_state_holders "before pid-file start"
  clear_host_origin_file
else
  clear_stale_pid_file "${HOST_PID_FILE}" "Host service"
fi

ensure_dashboard_static_app "${NODE_BIN}"
ensure_routec_web_chat_static_app

if [[ -n "${PERSISTENT_PLIST}" ]]; then
  current_pid="$(launchctl_pid_for_label "${HOST_LABEL}")"
  if [[ -n "${current_pid}" ]] && pid_is_running "${current_pid}"; then
    echo "[oysterun-service] error: Host service is already running with PID ${current_pid}" >&2
    exit 1
  fi
  if launch_service_is_loaded "${HOST_LABEL}"; then
    bootout_launch_agent_service "${HOST_LABEL}"
  fi
  rm -f "${HOST_PID_FILE}"
  stop_stale_stack_host_state_holders "before launchd start"
  clear_host_origin_file
  ensure_port_available "${HOST_PORT}"
  prepare_host_log_for_service_start "${HOST_LOG}" "Host service"

  echo "[oysterun-service] Starting ${STACK_NAME} persistent LaunchAgent on ${HOST_URL}..."
  bootstrap_launch_agent_plist "${PERSISTENT_PLIST}"
  STARTED_HOST=1
  HOST_PID="$(launchctl_pid_for_label "${HOST_LABEL}")"
  wait_for_http "${HOST_URL}/health" "Host service" "${HOST_PID}" "${HOST_LOG}" "${HOST_LABEL}"
  HOST_PID="$(wait_for_host_identity_files "Host service" "${HOST_DIR}")"
else
  collect_routec_host_env_args
  if is_macos; then
    echo "[oysterun-service] Starting ${STACK_NAME} Host service on ${HOST_URL}..."
    prepare_host_log_for_service_start "${HOST_LOG}" "Host service"
    printf -v HOST_COMMAND 'export PATH=%q; cd %q && exec /usr/bin/env OYSTERUN_CONFIG_DIR=%q OYSTERUN_PORT=%q OYSTERUN_REPO_ROOT=%q OYSTERUN_NODE_BIN=%q' "${LAUNCH_PATH}" "${HOST_DIR}" "${CONFIG_DIR}" "${HOST_PORT}" "${ROOT_DIR}" "${NODE_BIN}"
    if (( ${#ROUTEC_HOST_ENV_ARGS[@]} > 0 )); then
      for routec_host_env_arg in "${ROUTEC_HOST_ENV_ARGS[@]}"; do
        printf -v HOST_COMMAND '%s %q' "${HOST_COMMAND}" "${routec_host_env_arg}"
      done
    fi
    printf -v HOST_COMMAND '%s %q server.mjs' "${HOST_COMMAND}" "${NODE_BIN}"
    submit_launchctl_job "${HOST_LABEL}" "${HOST_LOG}" "${HOST_COMMAND}"
    STARTED_HOST=1
    HOST_PID="$(launchctl_pid_for_label "${HOST_LABEL}")"
    wait_for_http "${HOST_URL}/health" "Host service" "${HOST_PID}" "${HOST_LOG}" "${HOST_LABEL}"
    write_pid_file_from_label "${HOST_LABEL}" "${HOST_PID_FILE}"
    HOST_PID="$(pid_from_file "${HOST_PID_FILE}")"
    verify_process_cwd "${HOST_PID}" "${HOST_DIR}" "Host service"
    write_host_origin_file "${HOST_PID}" "${HOST_LABEL}"
  else
    echo "[oysterun-service] Starting ${STACK_NAME} pid-file Host service on ${HOST_URL}..."
    prepare_host_log_for_service_start "${HOST_LOG}" "Host service"
    (
      trap '' HUP
      export PATH="${LAUNCH_PATH}"
      cd "${HOST_DIR}"
      exec /usr/bin/env \
        OYSTERUN_CONFIG_DIR="${CONFIG_DIR}" \
        OYSTERUN_PORT="${HOST_PORT}" \
        OYSTERUN_REPO_ROOT="${ROOT_DIR}" \
        OYSTERUN_NODE_BIN="${NODE_BIN}" \
        "${ROUTEC_HOST_ENV_ARGS[@]}" \
        "${NODE_BIN}" server.mjs
    ) >> "${HOST_LOG}" 2>&1 &
    STARTED_HOST=1
    HOST_PID="$!"
    printf '%s\n' "${HOST_PID}" > "${HOST_PID_FILE}"
    disown "${HOST_PID}" 2>/dev/null || true
    wait_for_http "${HOST_URL}/health" "Host service" "${HOST_PID}" "${HOST_LOG}"
    verify_process_cwd "${HOST_PID}" "${HOST_DIR}" "Host service"
    write_host_origin_file "${HOST_PID}" "${HOST_LABEL}"
  fi
fi

write_current_routec_stack_readiness "tool_scripts/start_oysterun.sh" >/dev/null
append_service_control_audit "service_start" "done" "script=tool_scripts/start_oysterun.sh;host_pid=${HOST_PID}"

trap - ERR

echo
if [[ -n "${PERSISTENT_PLIST}" ]]; then
  echo "[oysterun-service] LaunchAgent:      ${PERSISTENT_PLIST}"
elif ! is_macos; then
  echo "[oysterun-service] Service manager: pid-file"
fi
echo "[oysterun-service] Stack:          ${STACK_NAME}"
echo "[oysterun-service] Host health:    ${HOST_URL}/health"
echo "[oysterun-service] Web Client:    ${HOST_URL}/app"
echo "[oysterun-service] Host config:    ${CONFIG_DIR}"
echo "[oysterun-service] Host log:       ${HOST_LOG}"
echo "[oysterun-service] Host origin:    ${HOST_ORIGIN_FILE}"
echo "[oysterun-service] Host PID:       ${HOST_PID}"
