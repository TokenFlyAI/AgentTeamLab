#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../shared/codebase/backend" && pwd)"
exec bash "${ROOT_DIR}/scripts/verify_dashboard_stack.sh"
