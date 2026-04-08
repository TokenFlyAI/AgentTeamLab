#!/usr/bin/env bash
# validate_openapi.sh — OpenAPI spec linter + breaking-change detector
# Eve (Infra Engineer) — T1019 — 2026-04-07
#
# Usage:
#   bash scripts/validate_openapi.sh <spec.yaml> [--baseline <baseline.yaml>]
#
# Exit codes:
#   0 — all checks passed
#   1 — syntax/structural error
#   2 — breaking change detected
#   3 — missing argument
#
# Examples:
#   bash scripts/validate_openapi.sh agents/mia/output/openapi_spec.yaml
#   bash scripts/validate_openapi.sh agents/mia/output/openapi_spec_v2.yaml \
#       --baseline agents/mia/output/openapi_spec.yaml

set -euo pipefail

SPEC=""
BASELINE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIFF_SCRIPT="$SCRIPT_DIR/openapi_diff.py"

# ── argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline) BASELINE="$2"; shift 2 ;;
    -*)         echo "Unknown flag: $1" >&2; exit 3 ;;
    *)          SPEC="$1"; shift ;;
  esac
done

if [[ -z "$SPEC" ]]; then
  echo "Usage: bash scripts/validate_openapi.sh <spec.yaml> [--baseline <baseline.yaml>]" >&2
  exit 3
fi

if [[ ! -f "$SPEC" ]]; then
  echo "ERROR: spec file not found: $SPEC" >&2
  exit 1
fi

# ── colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

echo "=== OpenAPI Validation: $SPEC ==="
ERRORS=0

# ── Step 1: YAML syntax check ─────────────────────────────────────────────────
echo ""
echo "--- Step 1: YAML syntax ---"
if python3 -c "import yaml, sys; yaml.safe_load(open('$SPEC'))" 2>/dev/null; then
  pass "YAML syntax valid"
else
  fail "YAML syntax error"
  python3 -c "import yaml, sys; yaml.safe_load(open('$SPEC'))" 2>&1 || true
  ERRORS=$((ERRORS + 1))
fi

# ── Step 2: OpenAPI structural validation ─────────────────────────────────────
echo ""
echo "--- Step 2: OpenAPI structure ---"
python3 - "$SPEC" <<'PYEOF'
import sys, yaml

spec_path = sys.argv[1]
spec = yaml.safe_load(open(spec_path))
errors = []

# Required top-level fields
for field in ("openapi", "info", "paths"):
    if field not in spec:
        errors.append(f"Missing required top-level field: '{field}'")

# openapi version format
oa_ver = spec.get("openapi", "")
if oa_ver and not str(oa_ver).startswith(("3.0", "3.1")):
    errors.append(f"Unexpected openapi version: {oa_ver} (expected 3.x)")

# info fields
info = spec.get("info", {})
for field in ("title", "version"):
    if field not in info:
        errors.append(f"Missing info.{field}")

# paths: each path must have at least one valid HTTP method
VALID_METHODS = {"get","post","put","patch","delete","head","options","trace"}
paths = spec.get("paths", {})
if not paths:
    errors.append("No paths defined in spec")
for path, path_item in paths.items():
    methods = [k for k in path_item if k.lower() in VALID_METHODS]
    if not methods:
        errors.append(f"Path '{path}' has no HTTP method operations")
    for method in methods:
        op = path_item[method]
        if not isinstance(op, dict):
            errors.append(f"  {method.upper()} {path}: operation must be an object")
            continue
        # Every operation should have a responses block
        if "responses" not in op:
            errors.append(f"  {method.upper()} {path}: missing 'responses'")

# Summary
path_count = len(paths)
op_count = sum(
    len([k for k in pi if k.lower() in VALID_METHODS])
    for pi in paths.values()
    if isinstance(pi, dict)
)
print(f"  Paths: {path_count}  Operations: {op_count}")

if errors:
    for e in errors:
        print(f"  [FAIL] {e}")
    sys.exit(1)
else:
    print("  [PASS] Structure valid")
PYEOF
STRUCT_EXIT=$?
if [[ $STRUCT_EXIT -ne 0 ]]; then
  ERRORS=$((ERRORS + 1))
fi

# ── Step 3: Breaking-change diff (optional) ───────────────────────────────────
if [[ -n "$BASELINE" ]]; then
  echo ""
  echo "--- Step 3: Breaking-change diff vs $BASELINE ---"
  if [[ ! -f "$BASELINE" ]]; then
    warn "Baseline not found: $BASELINE — skipping diff"
  elif [[ ! -f "$DIFF_SCRIPT" ]]; then
    warn "openapi_diff.py not found at $DIFF_SCRIPT — skipping diff"
  else
    python3 "$DIFF_SCRIPT" "$BASELINE" "$SPEC"
    DIFF_EXIT=$?
    if [[ $DIFF_EXIT -eq 2 ]]; then
      ERRORS=$((ERRORS + 10))  # use offset so we can distinguish
    fi
  fi
else
  echo ""
  echo "--- Step 3: Breaking-change diff --- (skipped — no --baseline provided)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
if [[ $ERRORS -eq 0 ]]; then
  pass "All checks passed"
  exit 0
elif [[ $ERRORS -ge 10 ]]; then
  fail "Breaking changes detected"
  exit 2
else
  fail "$ERRORS error(s) found"
  exit 1
fi
