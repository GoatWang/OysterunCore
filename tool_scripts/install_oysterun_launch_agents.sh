#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oysterun_service_common.sh"

TARGET_STACKS=(production staging)
NO_START=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack|-stack|-s)
      if [[ $# -lt 2 ]]; then
        echo "[oysterun-service] error: --stack requires a value" >&2
        exit 1
      fi
      case "$2" in
        all)
          TARGET_STACKS=(production staging)
          ;;
        *)
          STACK_NAME="$2"
          validate_stack
          TARGET_STACKS=("$2")
          ;;
      esac
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
    --no-start)
      NO_START=1
      shift
      ;;
    *)
      echo "[oysterun-service] error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${HOST_PORT_OVERRIDE}" && "${#TARGET_STACKS[@]}" -gt 1 ]]; then
  echo "[oysterun-service] error: --port can only be used with one --stack target" >&2
  exit 1
fi

INSTALL_HOST_PORT_OVERRIDE="${HOST_PORT_OVERRIDE}"

NODE_BIN="$(require_node_runtime "LaunchAgent install")"
NODE_BIN_DIR="$(dirname "${NODE_BIN}")"
LAUNCH_AGENT_PATH="${NODE_BIN_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ensure_dashboard_static_app "${NODE_BIN}"

install_stack_agent() {
  local stack="$1"
  STACK_NAME="${stack}"
  HOST_PORT_OVERRIDE="${INSTALL_HOST_PORT_OVERRIDE}"
  BACKEND_PORT_OVERRIDE=""
  configure_stack_runtime
  require_host_port_configured
  ensure_runtime_dirs
  append_service_control_audit "service_install" "attempt" "script=tool_scripts/install_oysterun_launch_agents.sh;no_start=${NO_START}"
  sync_host_stack_port_config

  if ! is_macos; then
    echo "[oysterun-service] Linux service mode uses the pid-file Host supervisor; no launchd LaunchAgent will be installed."
    echo "[oysterun-service] Stack:                 ${STACK_NAME}"
    echo "[oysterun-service] Host health:           ${HOST_URL}/health"
    if [[ "${NO_START}" -eq 1 ]]; then
      echo "[oysterun-service] Prepared Linux stack config without starting the Host."
      append_service_control_audit "service_install" "done" "script=tool_scripts/install_oysterun_launch_agents.sh;no_start=1;platform=linux"
      echo
      return
    fi

    local start_args=(--stack "${STACK_NAME}")
    if [[ "${STACK_KIND}" == "custom" ]]; then
      start_args+=(--port "${HOST_PORT}")
    fi
    "${ROOT_DIR}/tool_scripts/start_oysterun.sh" "${start_args[@]}"
    append_service_control_audit "service_install" "done" "script=tool_scripts/install_oysterun_launch_agents.sh;platform=linux"
    echo
    return
  fi

  local plist_path=""
  plist_path="$(launch_agent_plist_path_for_label "${HOST_LABEL}")"
  mkdir -p "$(dirname "${plist_path}")"

  cat > "${plist_path}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${HOST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ROOT_DIR}/tool_scripts/run_oysterun_host.sh</string>
    <string>--stack</string>
    <string>${STACK_NAME}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OYSTERUN_NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>PATH</key>
    <string>${LAUNCH_AGENT_PATH}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${HOST_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${HOST_LOG}</string>
</dict>
</plist>
EOF
  chmod 644 "${plist_path}"

  if [[ "${NO_START}" -eq 1 ]]; then
    echo "[oysterun-service] LaunchAgent plist installed without starting: ${plist_path}"
    echo "[oysterun-service] Stack:                 ${STACK_NAME}"
    echo "[oysterun-service] Host health:           ${HOST_URL}/health"
    append_service_control_audit "service_install" "done" "script=tool_scripts/install_oysterun_launch_agents.sh;no_start=1;plist_path=${plist_path}"
    echo
    return
  fi

  if launch_service_is_loaded "${HOST_LABEL}"; then
    bootout_launch_agent_service "${HOST_LABEL}"
  fi
  stop_managed_process "${HOST_LABEL}" "${HOST_PID_FILE}" "Host service" >/dev/null 2>&1 || true
  stop_stale_stack_host_state_holders "during LaunchAgent install"
  clear_host_origin_file
  ensure_port_available "${HOST_PORT}"
  prepare_host_log_for_service_start "${HOST_LOG}" "Host service"

  echo "[oysterun-service] Installing LaunchAgent for ${STACK_NAME} on ${HOST_URL}..."
  bootstrap_launch_agent_plist "${plist_path}"
  wait_for_http "${HOST_URL}/health" "Host service" "$(launchctl_pid_for_label "${HOST_LABEL}")" "${HOST_LOG}" "${HOST_LABEL}"

  local host_pid=""
  host_pid="$(pid_from_file "${HOST_PID_FILE}")"
  if [[ -z "${host_pid}" ]]; then
    host_pid="$(launchctl_pid_for_label "${HOST_LABEL}")"
  fi

  echo "[oysterun-service] LaunchAgent installed: ${plist_path}"
  echo "[oysterun-service] Stack:                 ${STACK_NAME}"
  echo "[oysterun-service] Host health:           ${HOST_URL}/health"
  echo "[oysterun-service] Host PID:              ${host_pid}"
  append_service_control_audit "service_install" "done" "script=tool_scripts/install_oysterun_launch_agents.sh;plist_path=${plist_path};host_pid=${host_pid}"
  echo
}

for stack in "${TARGET_STACKS[@]}"; do
  install_stack_agent "${stack}"
done
