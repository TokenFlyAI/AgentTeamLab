#!/bin/bash
# nuclear_reset.sh — COMPLETE reset of all agents and status
# Use when everything is stuck/broken

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "☢️  NUCLEAR RESET — Complete System Clear"
echo "=========================================="
echo ""
echo "This will:"
echo "  1. Stop ALL running agents (force kill)"
echo "  2. Stop the Smart Run daemon"
echo "  3. Clear ALL status, logs, and session files"
echo "  4. Reset task board to clean state"
echo "  5. Reset config to defaults"
echo ""

# Confirm
read -p "Are you sure? Type 'yes' to continue: " confirm
if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 1
fi

echo ""
echo "Step 1: Killing all agent processes..."

# Kill all kimi processes for agents
for agent in alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina; do
    pkill -f "kimi.*-w.*agents/${agent}" 2>/dev/null || true
    pkill -f "claude.*-w.*agents/${agent}" 2>/dev/null || true
    pkill -f "run_agent.sh.*${agent}" 2>/dev/null || true
done

# Kill run_subset processes
pkill -f "run_subset.sh" 2>/dev/null || true

# Kill the daemon
if [ -f "${COMPANY_DIR}/.smart_run_daemon.pid" ]; then
    daemon_pid=$(cat "${COMPANY_DIR}/.smart_run_daemon.pid" 2>/dev/null)
    if [ -n "$daemon_pid" ]; then
        kill "$daemon_pid" 2>/dev/null || true
        sleep 1
        kill -9 "$daemon_pid" 2>/dev/null || true
    fi
    rm -f "${COMPANY_DIR}/.smart_run_daemon.pid"
fi

echo "Step 2: Waiting for processes to die..."
sleep 3

# Double check
running_count=$(pgrep -f "run_agent.sh|run_subset.sh|kimi.*agents|claude.*agents" | wc -l)
echo "  Remaining processes: $running_count"

if [ "$running_count" -gt 0 ]; then
    echo "  Force killing remaining processes..."
    pkill -9 -f "run_agent.sh" 2>/dev/null || true
    pkill -9 -f "run_subset.sh" 2>/dev/null || true
    sleep 1
fi

echo ""
echo "Step 3: Clearing agent state files..."

for agent_dir in "${COMPANY_DIR}/agents"/*; do
    if [ -d "$agent_dir" ]; then
        AGENT_NAME=$(basename "$agent_dir")
        
        # Remove session files
        rm -f "${agent_dir}/session_id.txt"
        rm -f "${agent_dir}/session_id_kimi.txt"
        
        # Remove status
        rm -f "${agent_dir}/status.md"
        
        # Remove heartbeat
        rm -f "${agent_dir}/heartbeat.md"
        
        # Remove logs
        rm -f "${agent_dir}/log.jsonl"
        rm -f "${agent_dir}/logs/"*.log 2>/dev/null || true
        
        # Remove cycle count
        rm -f "${agent_dir}/cycle_count.txt"
        
        echo "  ✓ $AGENT_NAME cleared"
    fi
done

echo ""
echo "Step 4: Resetting config files..."

# Reset smart_run_config
cat > "${COMPANY_DIR}/public/smart_run_config.json" << 'EOF'
{
  "max_agents": 3,
  "enabled": false,
  "interval_seconds": 30,
  "last_updated": "2026-03-31T00:00:00Z",
  "mode": "smart",
  "force_alice": true,
  "description": "Smart Run configuration - Controls how many agents run and selection strategy"
}
EOF

# Reset task board (keep structure, clear tasks)
cat > "${COMPANY_DIR}/public/task_board.md" << 'EOF'
# Task Board

## Legend
- **OPEN**: Waiting for pickup
- **IN_PROGRESS**: Assigned and being worked on
- **REVIEW**: Pending review/merge
- **DONE**: Completed

## Active Tasks

| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |
|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|

## Completed Tasks

| ID | Title | Description | Priority | Group | Assignee | Status | Completed | Notes |
|----|-------|-------------|----------|-------|----------|--------|-----------|-------|

EOF

# Reset inbox
cat > "${COMPANY_DIR}/public/chat_inbox.md" << 'EOF'
# Chat Inbox

Messages between agents and system notifications.

## Format
- `@agent: message` for direct messages
- `broadcast: message` for all-hands

## Messages

EOF

# Clear running agents tracking
rm -f "${COMPANY_DIR}/.running_agents"

echo ""
echo "Step 5: Verifying clean state..."

# Check for any remaining processes
echo ""
echo "Remaining agent processes:"
pgrep -f "run_agent.sh|run_subset.sh|kimi.*agents|claude.*agents" | wc -l

echo ""
echo "=========================================="
echo "✅ NUCLEAR RESET COMPLETE"
echo "=========================================="
echo ""
echo "System is now clean:"
echo "  • All agents stopped"
echo "  • All state cleared"
echo "  • Config reset to defaults (max_agents: 3)"
echo "  • Task board empty"
echo ""
echo "Next steps:"
echo "  1. Start server: node server.js"
echo "  2. Open portal: http://localhost:3100"
echo "  3. Go to Fleet tab"
echo "  4. Set max agents and start daemon"
echo ""
