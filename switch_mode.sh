#!/bin/bash
# switch_mode.sh — Switch operating mode and announce
MODE="$1"
WHO="$2"
REASON="$3"
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE_FILE="${COMPANY_DIR}/public/company_mode.md"

[ -z "$MODE" ] || [ -z "$WHO" ] || [ -z "$REASON" ] && \
    echo "Usage: $0 <plan|normal|crazy|autonomous> <who> <reason>" && exit 1

# Validate mode
case "$MODE" in
    plan|normal|crazy|autonomous) ;;
    *) echo "Error: Invalid mode '$MODE'. Must be plan, normal, crazy, or autonomous." && exit 1 ;;
esac

# Read current mode
CURRENT_MODE=$(grep '^\*\*' "$MODE_FILE" | head -1 | tr -d '*')
TODAY=$(date +%Y-%m-%d)

echo "Switching from ${CURRENT_MODE} to ${MODE}..."

# Update the mode file
cat > "$MODE_FILE" << EOF
# Company Operating Mode

## Current Mode
**${MODE}**

## Set By
${WHO}

## Reason
${REASON}

## Switch Triggers — When to Change Mode

### Switch to \`plan\` when:
- Starting a new project or major feature (need design before code)
- Quality is dropping — team needs to stop and rethink
- Team is misaligned — agents building conflicting work

### Switch to \`normal\` when:
- Plans are written and reviewed, ready for coordinated execution
- Coming down from crazy mode — need to re-coordinate
- Default steady-state operating mode

### Switch to \`crazy\` when:
- Plans are clear and agreed upon — everyone knows what to build
- Deadline pressure — need maximum throughput
- Simple/well-understood work — no ambiguity, just execution

## Mode Switch Log
| Date | From | To | Who | Reason |
|------|------|----|-----|--------|
| ${TODAY} | ${CURRENT_MODE} | ${MODE} | ${WHO} | ${REASON} |
EOF

# Post announcement
ANNOUNCEMENT="${COMPANY_DIR}/public/announcements/$(date +%Y_%m_%d_%H_%M_%S)_mode_switch.md"
cat > "$ANNOUNCEMENT" << EOF
# Mode Switch: ${CURRENT_MODE} → ${MODE}

**Set by**: ${WHO}
**Reason**: ${REASON}
**Date**: ${TODAY}

All agents: Read \`../../public/company_mode.md\` and follow the \`${MODE}_mode.md\` SOP.
EOF

echo "Mode switched to ${MODE}. Announcement posted."
