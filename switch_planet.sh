#!/bin/bash
# switch_planet.sh — Switch active planet
# Usage: bash switch_planet.sh <planet-name>
#
# Updates planet.json, re-points symlinks, swaps codebase worktree.
# All running agents are stopped first.

PLANET_NAME="$1"
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
PLANET_DIR="${COMPANY_DIR}/planets/${PLANET_NAME}"

if [ -z "$PLANET_NAME" ]; then
  echo "Usage: $0 <planet-name>"
  echo ""
  echo "Available planets:"
  ls -1 "${COMPANY_DIR}/planets/" 2>/dev/null | while read p; do
    [ -d "${COMPANY_DIR}/planets/$p" ] || continue
    active=""
    if [ -f "${COMPANY_DIR}/planet.json" ]; then
      current=$(grep '"active"' "${COMPANY_DIR}/planet.json" | sed 's/.*: *"\([^"]*\)".*/\1/')
      [ "$current" = "$p" ] && active=" (active)"
    fi
    desc=""
    [ -f "${COMPANY_DIR}/planets/$p/planet_config.json" ] && \
      desc=" — $(grep '"description"' "${COMPANY_DIR}/planets/$p/planet_config.json" | sed 's/.*: *"\([^"]*\)".*/\1/')"
    echo "  $p${active}${desc}"
  done
  exit 1
fi

if [ ! -d "$PLANET_DIR" ]; then
  echo "Error: Planet not found: $PLANET_NAME"
  echo "Available:"
  ls -1 "${COMPANY_DIR}/planets/" 2>/dev/null
  exit 1
fi

# Get current planet for worktree swap
OLD_PLANET=""
if [ -f "${COMPANY_DIR}/planet.json" ]; then
  OLD_PLANET=$(grep '"active"' "${COMPANY_DIR}/planet.json" | sed 's/.*: *"\([^"]*\)".*/\1/')
fi

if [ "$OLD_PLANET" = "$PLANET_NAME" ]; then
  echo "Already on planet: $PLANET_NAME"
  exit 0
fi

echo "Switching from '${OLD_PLANET}' to '${PLANET_NAME}'..."

# Stop all running agents first
echo "Stopping all agents..."
bash "${COMPANY_DIR}/stop_all.sh" 2>/dev/null || true

# Update planet.json
cat > "${COMPANY_DIR}/planet.json" << EOF
{
  "active": "${PLANET_NAME}",
  "planets_dir": "planets"
}
EOF
echo "Updated planet.json"

# Clean up legacy symlinks if present (Phase 5: all code uses planet.json directly)
for sl in agents public output ceo_inbox; do
  [ -L "${COMPANY_DIR}/${sl}" ] && rm -f "${COMPANY_DIR}/${sl}"
done
echo "planet.json is the source of truth (no root symlinks needed)"

# Swap codebase worktree if applicable
if [ -d "${COMPANY_DIR}/planets/${OLD_PLANET}/output/shared/codebase/.git" ] 2>/dev/null; then
  echo "Removing old codebase worktree..."
  git -C "${COMPANY_DIR}" worktree remove "planets/${OLD_PLANET}/output/shared/codebase" 2>/dev/null || true
fi
if git -C "${COMPANY_DIR}" branch --list "planet/${PLANET_NAME}/codebase" | grep -q .; then
  echo "Attaching codebase worktree for ${PLANET_NAME}..."
  git -C "${COMPANY_DIR}" worktree add "${PLANET_DIR}/output/shared/codebase" "planet/${PLANET_NAME}/codebase" 2>/dev/null || true
fi

# Show result
echo ""
echo "Switched to planet: ${PLANET_NAME}"
AGENT_COUNT=$(ls -1d "${PLANET_DIR}/agents"/*/ 2>/dev/null | wc -l | tr -d ' ')
echo "Agents: ${AGENT_COUNT}"
echo ""
echo "Restart server.js to apply. Run 'bash status.sh' to verify."
