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

STATUS_HOST_PORT_OVERRIDE="${HOST_PORT_OVERRIDE}"

for stack in "${TARGET_STACKS[@]}"; do
  STACK_NAME="${stack}"
  HOST_PORT_OVERRIDE="${STATUS_HOST_PORT_OVERRIDE}"
  BACKEND_PORT_OVERRIDE=""
  configure_stack_runtime
  require_host_port_configured

  service_manager="pid-file"
  plist_path="-"
  installed="no"
  loaded="no"
  host_pid=""
  healthy="no"

  if is_macos; then
    service_manager="launchd"
    plist_path="$(launch_agent_plist_path_for_label "${HOST_LABEL}")"
    if [[ -f "${plist_path}" ]]; then
      installed="yes"
    fi
    if launch_service_is_loaded "${HOST_LABEL}"; then
      loaded="yes"
    fi
  fi

  host_pid="$(pid_from_file "${HOST_PID_FILE}")"
  if [[ -z "${host_pid}" ]] && is_macos; then
    host_pid="$(launchctl_pid_for_label "${HOST_LABEL}")"
  fi
  if [[ -n "${host_pid}" ]] && pid_is_running "${host_pid}"; then
    loaded="yes"
  fi

  if curl -fsS "${HOST_URL}/health" >/dev/null 2>&1; then
    healthy="yes"
  fi

  echo "stack=${STACK_NAME}"
  echo "label=${HOST_LABEL}"
  echo "service_manager=${service_manager}"
  echo "plist=${plist_path}"
  echo "installed=${installed}"
  echo "loaded=${loaded}"
  echo "pid=${host_pid:--}"
  echo "health=${healthy}"
  echo "url=${HOST_URL}"
  echo
done
