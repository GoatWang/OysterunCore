#!/usr/bin/env bash

set -euo pipefail

: "${OYSTERUN_STACK:=production}"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oysterun_service_common.sh"

parse_common_args "$@"
configure_stack_runtime
ensure_runtime_dirs
append_service_control_audit "service_stop" "attempt" "script=tool_scripts/stop_oysterun.sh"
NODE_BIN="$(require_node_runtime "Host stop")"

quarantine_legacy_routec_runtime_env_files_if_present "${NODE_BIN}"
invalidate_routec_stack_readiness "stop_in_progress" "tool_scripts/stop_oysterun.sh" >/dev/null

if launch_agent_is_installed_for_label "${HOST_LABEL}"; then
  host_pid="$(launchctl_pid_for_label "${HOST_LABEL}")"
  if ! launch_service_is_loaded "${HOST_LABEL}" && [[ -z "${host_pid}" ]]; then
    stop_stale_stack_host_state_holders "after non-running launchd state"
    rm -f "${HOST_PID_FILE}"
    clear_host_origin_file
    invalidate_routec_stack_readiness "host_not_running" "tool_scripts/stop_oysterun.sh" >/dev/null
    cleanup_legacy_home_port_host_jobs_if_needed
    echo "[oysterun-service] Host service is not running"
    echo "[oysterun-service] Stop sequence finished for stack ${STACK_NAME}."
    append_service_control_audit "service_stop" "done" "script=tool_scripts/stop_oysterun.sh;already_not_running=true"
    exit 0
  fi

  if [[ -n "${host_pid}" ]]; then
    echo "[oysterun-service] Stopping persistent Host service (PID ${host_pid})..."
  else
    echo "[oysterun-service] Stopping persistent Host service..."
  fi

  bootout_launch_agent_service "${HOST_LABEL}"
  if [[ -n "${host_pid}" ]] && pid_is_running "${host_pid}"; then
    if ! wait_for_exit "${host_pid}"; then
      echo "[oysterun-service] Host service did not stop in time; sending SIGKILL"
      append_service_control_audit "process_signal" "attempt" "signal=KILL;reason=stop_oysterun_timeout;label=${HOST_LABEL};pid=${host_pid}"
      kill -9 "${host_pid}" 2>/dev/null || true
      append_service_control_audit "process_signal" "done" "signal=KILL;reason=stop_oysterun_timeout;label=${HOST_LABEL};pid=${host_pid}"
      wait_for_exit "${host_pid}" || true
    fi
  fi
  stop_stale_stack_host_state_holders "after launchd stop"

  rm -f "${HOST_PID_FILE}"
  clear_host_origin_file
  invalidate_routec_stack_readiness "stop_oysterun" "tool_scripts/stop_oysterun.sh" >/dev/null
  cleanup_legacy_home_port_host_jobs_if_needed
  echo "[oysterun-service] Stop sequence finished for stack ${STACK_NAME}."
  append_service_control_audit "service_stop" "done" "script=tool_scripts/stop_oysterun.sh;mode=launch_agent"
  exit 0
fi

stop_managed_process "${HOST_LABEL}" "${HOST_PID_FILE}" "Host service"
stop_stale_stack_host_state_holders "after pid-file stop"
clear_host_origin_file
invalidate_routec_stack_readiness "stop_oysterun" "tool_scripts/stop_oysterun.sh" >/dev/null
cleanup_legacy_home_port_host_jobs_if_needed

echo "[oysterun-service] Stop sequence finished for stack ${STACK_NAME}."
append_service_control_audit "service_stop" "done" "script=tool_scripts/stop_oysterun.sh;mode=managed_process"
