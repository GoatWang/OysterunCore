#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oysterun_service_common.sh"

read_live_session_count() {
  local port="$1"
  local health_json

  if [[ -z "${port}" ]]; then
    return 1
  fi

  health_json="$(curl -fsS "http://127.0.0.1:${port}/health" 2>/dev/null || true)"
  if [[ -z "${health_json}" ]]; then
    return 1
  fi

  printf '%s\n' "${health_json}" | sed -n 's/.*"sessions":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

reset_runtime_state() {
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
}

candidate_stacks() {
  fixed_stack_names
  if [[ -d "${STACKS_DIR}" ]]; then
    find "${STACKS_DIR}" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null | while IFS= read -r name; do
      if [[ "${name}" == "shared" ]]; then
        continue
      fi
      printf '%s\n' "${name}"
    done
  fi
  if is_macos; then
    launchctl list 2>/dev/null | awk '$3 ~ /^com\.oysterun\.host\./ { sub(/^com\.oysterun\.host\./, "", $3); print $3 }'
  fi
}

stack_is_listable() {
  local name="$1"
  if is_predefined_stack "${name}"; then
    return 0
  fi
  if ! validate_stack_name_format "${name}"; then
    return 1
  fi
  if is_reserved_custom_stack_name "${name}"; then
    return 1
  fi
  return 0
}

printf '%-18s %-8s %-8s %-10s %-10s %-14s %-45s %s\n' "STACK" "TYPE" "STATUS" "HOST_PORT" "HOST_PID" "LIVE_SESSIONS" "CONFIG_DIR" "LAUNCH_LABEL"

candidate_stacks | sort -u | while IFS= read -r stack; do
  if [[ -z "${stack}" ]]; then
    continue
  fi
  if ! stack_is_listable "${stack}"; then
    continue
  fi

  reset_runtime_state
  STACK_NAME="${stack}"
  configure_stack_runtime

  host_pid=""
  status="stopped"
  live_sessions="-"

  if launchctl_label_exists "${HOST_LABEL}"; then
    host_pid="$(launchctl_pid_for_label "${HOST_LABEL}")"
  fi
  if [[ -z "${host_pid}" ]]; then
    host_pid="$(pid_from_file "${HOST_PID_FILE}")"
  fi

  if [[ -n "${host_pid}" ]] && pid_is_running "${host_pid}"; then
    status="running"
  else
    host_pid=""
  fi

  if [[ -z "${HOST_PORT}" ]]; then
    if HOST_PORT="$(read_port_from_origin_file "${HOST_ORIGIN_FILE}")"; then
      :
    elif HOST_PORT="$(read_port_from_config_file "${CONFIG_PATH}")"; then
      :
    else
      HOST_PORT="-"
    fi
  fi

  if [[ "${status}" == "running" ]]; then
    if live_sessions_count="$(read_live_session_count "${HOST_PORT}")"; then
      live_sessions="${live_sessions_count}"
    fi
  fi

  if [[ -z "${host_pid}" ]]; then
    host_pid="-"
  fi

  printf '%-18s %-8s %-8s %-10s %-10s %-14s %-45s %s\n' \
    "${stack}" \
    "${STACK_KIND}" \
    "${status}" \
    "${HOST_PORT}" \
    "${host_pid}" \
    "${live_sessions}" \
    "${CONFIG_DIR}" \
    "${HOST_LABEL}"
done
