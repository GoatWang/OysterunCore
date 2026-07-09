#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND="${1:-}"
if [[ $# -gt 0 ]]; then
  shift
fi

STACK_NAME="${OYSTERUN_RELEASE_STACK:-production}"
FOLLOW_LOGS=0

usage() {
  cat <<'EOF'
Usage:
  tool_scripts/oysterun_release_service.sh install [--no-start]
  tool_scripts/oysterun_release_service.sh start
  tool_scripts/oysterun_release_service.sh stop
  tool_scripts/oysterun_release_service.sh restart [--restore-sessions]
  tool_scripts/oysterun_release_service.sh status
  tool_scripts/oysterun_release_service.sh logs [--follow]
  tool_scripts/oysterun_release_service.sh uninstall [--stack production|staging|all]

Release service commands target the production stack by default. Override only
for development with OYSTERUN_RELEASE_STACK=<stack>.

restart --restore-sessions prepares Host restart restore state before stop/start.
EOF
}

print_login_qr_after_service_ready() {
  local service_args=("$@")
  local target_stack="${STACK_NAME}"
  (
    source "${SCRIPT_DIR}/oysterun_service_common.sh"
    STACK_NAME="${target_stack}"
    if [[ "${#service_args[@]}" -gt 0 ]]; then
      parse_common_args "${service_args[@]}"
    else
      parse_common_args
    fi
    configure_stack_runtime
    local node_bin
    if ! node_bin="$(require_node_runtime "post-start login QR")"; then
      echo "[oysterun-service] node not available; cannot print login QR" >&2
      exit 1
    fi
    cd "${ROOT_DIR}"
    OYSTERUN_CONFIG_DIR="${CONFIG_DIR}" \
      OYSTERUN_PORT="${HOST_PORT}" \
      "${node_bin}" host-service/setup.mjs --show-qr
  ) || {
    echo "[oysterun-service] Login QR unavailable. Run 'oysterun show-qr' after setup." >&2
  }
}

prepare_restart_restore_before_service_restart() {
  local service_args=("$@")
  local target_stack="${STACK_NAME}"
  (
    source "${SCRIPT_DIR}/oysterun_service_common.sh"
    STACK_NAME="${target_stack}"
    if [[ "${#service_args[@]}" -gt 0 ]]; then
      parse_common_args "${service_args[@]}"
    else
      parse_common_args
    fi
    configure_stack_runtime
    require_host_port_configured
    local node_bin
    node_bin="$(resolve_command_path node)"
    if [[ -z "${node_bin}" ]]; then
      echo "[oysterun-service] node not found; cannot prepare restart restore" >&2
      exit 1
    fi
    cd "${ROOT_DIR}"
    OYSTERUN_CONFIG_DIR="${CONFIG_DIR}" \
      OYSTERUN_PORT="${HOST_PORT}" \
      OYSTERUN_RESTART_RESTORE_TRIGGER="cli_service_restart_restore_sessions" \
      "${node_bin}" host-service/cli/prepare-restart-restore.mjs
  )
}

case "${COMMAND}" in
  install)
    exec "${SCRIPT_DIR}/install_oysterun_launch_agents.sh" --stack "${STACK_NAME}" "$@"
    ;;
  start)
    "${SCRIPT_DIR}/start_oysterun.sh" --stack "${STACK_NAME}" "$@"
    print_login_qr_after_service_ready "$@"
    ;;
  stop)
    exec "${SCRIPT_DIR}/stop_oysterun.sh" --stack "${STACK_NAME}" "$@"
    ;;
  restart)
    RESTORE_SESSIONS=0
    RESTART_ARGS=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --restore-sessions)
          RESTORE_SESSIONS=1
          shift
          ;;
        *)
          RESTART_ARGS+=("$1")
          shift
          ;;
      esac
    done
    if [[ "${RESTORE_SESSIONS}" -eq 1 ]]; then
      if [[ "${#RESTART_ARGS[@]}" -gt 0 ]]; then
        prepare_restart_restore_before_service_restart "${RESTART_ARGS[@]}"
      else
        prepare_restart_restore_before_service_restart
      fi
    fi
    if [[ "${#RESTART_ARGS[@]}" -gt 0 ]]; then
      "${SCRIPT_DIR}/restart_oysterun.sh" --stack "${STACK_NAME}" "${RESTART_ARGS[@]}"
      print_login_qr_after_service_ready "${RESTART_ARGS[@]}"
    else
      "${SCRIPT_DIR}/restart_oysterun.sh" --stack "${STACK_NAME}"
      print_login_qr_after_service_ready
    fi
    ;;
  status)
    exec "${SCRIPT_DIR}/status_oysterun_launch_agents.sh" --stack "${STACK_NAME}" "$@"
    ;;
  logs)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --follow|-f)
          FOLLOW_LOGS=1
          shift
          ;;
        *)
          echo "[oysterun-service] error: unknown logs argument: $1" >&2
          exit 2
          ;;
      esac
    done
    source "${SCRIPT_DIR}/oysterun_service_common.sh"
    configure_stack_runtime
    if [[ "${FOLLOW_LOGS}" -eq 1 ]]; then
      exec tail -n 200 -f "${HOST_LOG}"
    fi
    exec tail -n 200 "${HOST_LOG}"
    ;;
  uninstall)
    exec "${SCRIPT_DIR}/uninstall_oysterun_launch_agents.sh" --stack "${STACK_NAME}" "$@"
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "[oysterun-service] error: unknown command: ${COMMAND}" >&2
    usage >&2
    exit 2
    ;;
esac
