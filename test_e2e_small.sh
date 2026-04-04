#!/bin/bash
# test_e2e_small.sh — Real end-to-end test with 3 agents (Alice, Bob, Charlie)
# This actually runs the agents and verifies the full flow works

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "🧪 E2E Test: Small Group (Alice+Bob+Charlie)"
echo "=========================================="
echo ""

# Verify CLIs exist
if ! command -v kimi &> /dev/null; then
    echo "❌ Kimi CLI not found!"
    exit 1
fi
if ! command -v claude &> /dev/null; then
    echo "❌ Claude CLI not found!"
    exit 1
fi

echo "✅ Kimi CLI: $(kimi --version)"
echo "✅ Claude CLI: $(claude --version)"
echo ""

# Set executors: Alice on Claude (stability), Bob/Charlie on Kimi (cost)
echo "⚙️  Setting executors..."
echo "claude" > "${COMPANY_DIR}/agents/alice/executor.txt"
echo "kimi" > "${COMPANY_DIR}/agents/bob/executor.txt"
echo "kimi" > "${COMPANY_DIR}/agents/charlie/executor.txt"
echo "   Alice → Claude (CEO stability)"
echo "   Bob → Kimi (cost efficient)"
echo "   Charlie → Kimi (cost efficient)"
echo ""

# Set initial mission for Alice to distribute work
echo "📝 Setting up initial mission..."
cat > "${COMPANY_DIR}/public/mission_board.md" << 'EOF'
# Mission Board

## Active Missions

| ID | Mission | Type | Target Group | Status |
|----|---------|------|--------------|--------|
| M001 | Create project README | Task | bob | OPEN |
| M002 | Design logo concept | Task | charlie | OPEN |

EOF

echo "✅ Mission board set with 2 tasks (Bob & Charlie)"
echo ""

# Check smart_run dry-run first
echo "🔍 Smart Run Analysis (dry check)..."
echo ""

# Simulate what smart_run would do
echo "   Checking task assignments..."
TASK_BOARD="${COMPANY_DIR}/public/task_board.md"

# Parse assignments
echo "   Tasks found:"
grep "| M001 |" "$TASK_BOARD" | awk -F'|' '{print "   - " $2 ": " $3 " → " $5}'
grep "| M002 |" "$TASK_BOARD" | awk -F'|' '{print "   - " $2 ": " $3 " → " $5}'

echo ""
echo "📋 Expected behavior:"
echo "   1. Alice (Claude) starts first as CEO"
echo "   2. Alice reviews missions, may create tasks"
echo "   3. Bob & Charlie will be started based on assignments"
echo ""

# Show current session state
echo "📊 Pre-run session state:"
for agent in alice bob charlie; do
    EXECUTOR=$(cat "${COMPANY_DIR}/agents/${agent}/executor.txt")
    if [ "$EXECUTOR" = "kimi" ]; then
        SESSION_FILE="${COMPANY_DIR}/agents/${agent}/session_id_kimi.txt"
    else
        SESSION_FILE="${COMPANY_DIR}/agents/${agent}/session_id.txt"
    fi
    if [ -f "$SESSION_FILE" ]; then
        echo "   ${agent}: $(cat "$SESSION_FILE" | cut -c1-12)... exists"
    else
        echo "   ${agent}: No session (fresh start)"
    fi
done
echo ""

echo "=========================================="
echo "🚀 Starting Real Test Run"
echo "=========================================="
echo ""
echo "⏱️  This will take ~2-3 minutes per agent..."
echo ""

# Function to run agent and capture result
run_agent_test() {
    local AGENT=$1
    local EXECUTOR=$(cat "${COMPANY_DIR}/agents/${AGENT}/executor.txt")
    
    echo "🚀 Starting ${AGENT} (${EXECUTOR})..."
    
    # Run with timeout and capture output
    local OUTPUT_FILE="/tmp/${AGENT}_test_output.txt"
    
    # Export vars for run_agent.sh
    export COMPANY_DIR
    export SESSION_MAX_CYCLES=3
    
    timeout 180 "${COMPANY_DIR}/run_agent.sh" "$AGENT" > "$OUTPUT_FILE" 2>&1 &
    local PID=$!
    
    # Wait with progress dots
    local COUNT=0
    while kill -0 $PID 2>/dev/null && [ $COUNT -lt 180 ]; do
        echo -n "."
        sleep 2
        COUNT=$((COUNT + 2))
    done
    
    if kill -0 $PID 2>/dev/null; then
        echo ""
        echo "   ⚠️  ${AGENT} still running after 3min, stopping..."
        kill $PID 2>/dev/null || true
        wait $PID 2>/dev/null || true
    else
        echo ""
        echo "   ✅ ${AGENT} completed"
    fi
    
    # Show last 20 lines of output
    echo "   Last output:"
    tail -5 "$OUTPUT_FILE" | sed 's/^/      /'
    
    # Check if session was saved
    if [ "$EXECUTOR" = "kimi" ]; then
        local SESSION_FILE="${COMPANY_DIR}/agents/${AGENT}/session_id_kimi.txt"
    else
        local SESSION_FILE="${COMPANY_DIR}/agents/${AGENT}/session_id.txt"
    fi
    if [ -f "$SESSION_FILE" ]; then
        echo "   💾 Session saved: $(cat "$SESSION_FILE" | cut -c1-16)..."
    fi
    
    echo ""
}

# Run Alice first
run_agent_test "alice"

# Check if Alice created/updated anything
echo "📋 Post-Alice task board:"
if [ -f "$TASK_BOARD" ]; then
    grep "^| M" "$TASK_BOARD" 2>/dev/null | while read line; do
        echo "   ${line}"
    done || echo "   (no mission tasks)"
fi
echo ""

# Check Alice's status
echo "📊 Alice's status:"
if [ -f "${COMPANY_DIR}/agents/alice/status.md" ]; then
    head -10 "${COMPANY_DIR}/agents/alice/status.md" | sed 's/^/   /'
fi
echo ""

# Now run Bob and Charlie (they should pick up their tasks)
run_agent_test "bob"
run_agent_test "charlie"

echo "=========================================="
echo "📊 Final Verification"
echo "=========================================="
echo ""

# Verify session files exist (resume working)
echo "💾 Session Persistence Check:"
for agent in alice bob charlie; do
    EXECUTOR=$(cat "${COMPANY_DIR}/agents/${agent}/executor.txt")
    if [ "$EXECUTOR" = "kimi" ]; then
        SESSION_FILE="${COMPANY_DIR}/agents/${agent}/session_id_kimi.txt"
    else
        SESSION_FILE="${COMPANY_DIR}/agents/${agent}/session_id.txt"
    fi
    if [ -f "$SESSION_FILE" ]; then
        CYCLE_FILE="${COMPANY_DIR}/agents/${agent}/cycle_count.txt"
        CYCLE=$(cat "$CYCLE_FILE" 2>/dev/null || echo "0")
        echo "   ✅ ${agent}: session $(cat "$SESSION_FILE" | cut -c1-12)..., cycle ${CYCLE}"
    else
        echo "   ❌ ${agent}: no session file"
    fi
done
echo ""

# Check logs were created
echo "📜 Log Files Check:"
for agent in alice bob charlie; do
    LOG_FILE="${COMPANY_DIR}/agents/${agent}/log.jsonl"
    if [ -f "$LOG_FILE" ]; then
        LINES=$(wc -l < "$LOG_FILE")
        echo "   ✅ ${agent}: ${LINES} log entries"
    else
        echo "   ❌ ${agent}: no log file"
    fi
done
echo ""

# Check status files
echo "📄 Status Files Check:"
for agent in alice bob charlie; do
    STATUS_FILE="${COMPANY_DIR}/agents/${agent}/status.md"
    if [ -f "$STATUS_FILE" ]; then
        STATE=$(grep "^state:" "$STATUS_FILE" 2>/dev/null | cut -d':' -f2 | tr -d ' ' || echo "unknown")
        echo "   ✅ ${agent}: state=${STATE}"
    else
        echo "   ❌ ${agent}: no status file"
    fi
done
echo ""

echo "=========================================="
echo "🎉 E2E Test Complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  • Alice ran on Claude (CEO mode)"
echo "  • Bob & Charlie ran on Kimi (cost efficient)"
echo "  • Sessions saved for resume mode"
echo "  • Logs and status recorded"
echo ""
echo "Next: Run './smart_run.sh' to test smart scheduling"
