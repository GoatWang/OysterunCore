#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oysterun_service_common.sh"

TARGET_STACKS=(production staging)

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
        production|staging)
          TARGET_STACKS=("$2")
          ;;
        *)
          echo "[oysterun-service] error: launch agent uninstall only supports production, staging, or all" >&2
          exit 1
          ;;
      esac
      shift 2
      ;;
    *)
      echo "[oysterun-service] error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

for stack in "${TARGET_STACKS[@]}"; do
  STACK_NAME="${stack}"
  HOST_PORT_OVERRIDE=""
  BACKEND_PORT_OVERRIDE=""
  configure_stack_runtime

  if ! is_macos; then
    echo "[oysterun-service] Linux stack ${STACK_NAME} has no launchd LaunchAgent to uninstall."
    continue
  fi

  local_plist_path="$(launch_agent_plist_path_for_label "${HOST_LABEL}")"
  if launch_service_is_loaded "${HOST_LABEL}"; then
    bootout_launch_agent_service "${HOST_LABEL}"
  fi
  stop_stale_stack_host_state_holders "during LaunchAgent uninstall"

  rm -f "${local_plist_path}" "${HOST_PID_FILE}"
  clear_host_origin_file
  echo "[oysterun-service] Removed LaunchAgent for ${STACK_NAME}: ${local_plist_path}"
done
