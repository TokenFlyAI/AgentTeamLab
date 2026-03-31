#!/bin/bash
# stop_agent.sh — Hard stop a specific agent (loop + active cycle + reset heartbeat)
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_NAME="$1"
[ -z "$AGENT_NAME" ] && echo "Usage: $0 <agent_name>" && exit 1

echo "Stopping ${AGENT_NAME}..."

# 1. Kill run_subset.sh loop first (prevents loop from restarting the agent)
pkill -TERM -f "run_subset.sh.*\b${AGENT_NAME}\b" 2>/dev/null || true
sleep 0.3

# 2. Kill active run_agent.sh cycle
pkill -TERM -f "run_agent.sh.*\b${AGENT_NAME}\b" 2>/dev/null || true
sleep 0.3

# 3. Force-kill claude/kimi subprocess for this agent
pkill -9 -f "claude.*agents/${AGENT_NAME}" 2>/dev/null || true
pkill -9 -f "kimi.*agents/${AGENT_NAME}"   2>/dev/null || true
pkill -9 -f "run_agent.sh.*\b${AGENT_NAME}\b" 2>/dev/null || true

# 4. Clean session locks
rm -f /tmp/claude_launcher_*${AGENT_NAME}*.sessions 2>/dev/null || true
rm -f /tmp/aicompany_settings_${AGENT_NAME}.json 2>/dev/null || true

# 5. Reset heartbeat to idle so dashboard shows correct state immediately
HB="${COMPANY_DIR}/agents/${AGENT_NAME}/heartbeat.md"
[ -d "${COMPANY_DIR}/agents/${AGENT_NAME}" ] && \
    printf 'status: idle\ntimestamp: %s\ntask: Stopped\n' "$(date +%Y_%m_%d_%H_%M_%S)" > "$HB"

echo "${AGENT_NAME} stopped."
