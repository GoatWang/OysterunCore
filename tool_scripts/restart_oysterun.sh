#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${OYSTERUN_STACK:=production}"

"${SCRIPT_DIR}/stop_oysterun.sh" "$@"
"${SCRIPT_DIR}/start_oysterun.sh" "$@"
