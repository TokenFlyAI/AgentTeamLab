#!/bin/bash
# clean_history.sh — Clean up all history, logs, and session state for fresh start

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${COMPANY_DIR}/.backups/$(date +%Y%m%d_%H%M%S)"

echo "=========================================="
echo "🧹 Cleaning History & Session State"
echo "=========================================="
echo ""

# Create backup of important current state
echo "📦 Creating backup at: ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# Backup current task board and inbox if they exist
cp "${COMPANY_DIR}/public/task_board.md" "${BACKUP_DIR}/" 2>/dev/null || true
cp "${COMPANY_DIR}/public/chat_inbox.md" "${BACKUP_DIR}/" 2>/dev/null || true
cp "${COMPANY_DIR}/public/mission_board.md" "${BACKUP_DIR}/" 2>/dev/null || true
cp "${COMPANY_DIR}/public/journal.md" "${BACKUP_DIR}/" 2>/dev/null || true

echo "✅ Backup created"
echo ""

# Clean each agent's history
echo "🧹 Cleaning agent histories..."
AGENT_COUNT=0
for agent_dir in "${COMPANY_DIR}/agents"/*; do
    if [ -d "$agent_dir" ]; then
        AGENT_NAME=$(basename "$agent_dir")
        
        # Remove session files (both Claude and Kimi)
        rm -f "${agent_dir}/session_id.txt"
        rm -f "${agent_dir}/session_id_kimi.txt"
        
        # Remove status
        rm -f "${agent_dir}/status.md"
        
        # Remove logs
        rm -f "${agent_dir}/log.jsonl"
        
        # Reset cycle count
        echo "0" > "${agent_dir}/cycle_count.txt" 2>/dev/null || true
        
        AGENT_COUNT=$((AGENT_COUNT + 1))
        echo "   🧹 ${AGENT_NAME}: sessions, status, logs cleaned"
    fi
done

echo ""
echo "✅ Cleaned ${AGENT_COUNT} agents"
echo ""

# Reset public state files (keep structure, reset content)
echo "🧹 Resetting public state files..."

# Reset task board (keep header, remove tasks)
cat > "${COMPANY_DIR}/public/task_board.md" << 'EOF'
# Task Board

Global task tracking for Agent Planet.

## Legend
- **OPEN**: Waiting for pickup
- **IN_PROGRESS**: Assigned and being worked on
- **REVIEW**: Pending review/merge
- **DONE**: Completed

## Active Tasks

| ID | Title | Assignee | Status | Priority | Created |
|----|-------|----------|--------|----------|---------|

## Completed Tasks

| ID | Title | Assignee | Status | Completed |
|----|-------|----------|--------|-----------|

EOF

# Reset inbox (keep structure)
cat > "${COMPANY_DIR}/public/chat_inbox.md" << 'EOF'
# Chat Inbox

Messages between agents and system notifications.

## Format
- `@agent: message` for direct messages
- `broadcast: message` for all-hands

## Messages

EOF

# Reset journal
cat > "${COMPANY_DIR}/public/journal.md" << 'EOF'
# Agent Planet Journal

Daily activities and milestones.

## $(date +%Y-%m-%d)

- System initialized. Fresh start.

EOF

# Reset mission board to initial state
cat > "${COMPANY_DIR}/public/mission_board.md" << 'EOF'
# Mission Board

Strategic missions for Agent Planet.

## Active Missions

| ID | Mission | Type | Target Group | Status |
|----|---------|------|--------------|--------|
| M001 | Initialize Platform | Direction | ALL | OPEN |

## Completed Missions

| ID | Mission | Completed Date |
|----|---------|----------------|

EOF

# Reset running_agents tracking
echo "" > "${COMPANY_DIR}/.running_agents" 2>/dev/null || true

# Remove any temp files
rm -f "${COMPANY_DIR}/.env" 2>/dev/null || true
rm -f "${COMPANY_DIR}/.last_run" 2>/dev/null || true

echo "✅ Public state files reset"
echo ""

# Clean any old backup archives (keep last 10)
echo "🧹 Cleaning old backups..."
if [ -d "${COMPANY_DIR}/.backups" ]; then
    cd "${COMPANY_DIR}/.backups"
    ls -t | tail -n +11 | xargs -r rm -rf 2>/dev/null || true
    echo "✅ Kept 10 most recent backups"
fi

echo ""
echo "=========================================="
echo "🎉 Cleanup Complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  • ${AGENT_COUNT} agents cleaned (sessions, logs, status)"
echo "  • Task board reset (empty)"
echo "  • Inbox cleared"
echo "  • Journal archived and reset"
echo "  • Mission board reset to initial state"
echo "  • Backup created at: ${BACKUP_DIR}"
echo ""
echo "💡 Next steps:"
echo "  1. Run: ./test_smart_start.sh"
echo "  2. Or manually: ./run_agent.sh alice"
echo ""
