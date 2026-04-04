#!/bin/bash
# test_smart_start.sh — End-to-end test of smart start with Kimi (cost-efficient)
#
# Strategy:
# 1. Start ONLY Alice first (she's the CEO)
# 2. Wait for her to check tasks and potentially create new ones
# 3. Then start agents based on task assignments

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "🧪 Smart Start E2E Test (Kimi Mode)"
echo "=========================================="
echo ""

# Set all agents to Kimi for cost savings
echo "📋 Setting all agents to Kimi executor..."
for agent in alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina; do
    echo "kimi" > "${COMPANY_DIR}/agents/${agent}/executor.txt"
done
echo "✅ All agents set to Kimi"
echo ""

# Check current task board
echo "📊 Current Task Board:"
if [ -f "${COMPANY_DIR}/public/task_board.md" ]; then
    grep "^|" "${COMPANY_DIR}/public/task_board.md" | grep -v "^| ID" | head -10 || echo "   (No tasks)"
else
    echo "   (No task board found)"
fi
echo ""

# Step 1: Start only Alice
echo "🚀 Step 1: Starting Alice (CEO) to assess situation..."
echo "   This will resume her session if one exists."
echo ""

SESSION_MAX_CYCLES=20 "${COMPANY_DIR}/run_agent.sh" alice &
ALICE_PID=$!

echo "   Alice started (PID: $ALICE_PID)"
echo "   Waiting 60 seconds for Alice to complete her cycle..."
sleep 60

# Check if Alice is still running
if ps -p $ALICE_PID > /dev/null 2>&1; then
    echo "   Alice still running after 60s, continuing..."
else
    echo "   Alice cycle completed."
fi

echo ""
echo "📋 Checking what Alice did..."

# Check for new tasks
echo "   Updated Task Board:"
grep "^|" "${COMPANY_DIR}/public/task_board.md" 2>/dev/null | grep -v "^| ID" | head -10 || echo "   (No tasks)"

echo ""
echo "📨 Checking Alice's status..."
if [ -f "${COMPANY_DIR}/agents/alice/status.md" ]; then
    head -20 "${COMPANY_DIR}/agents/alice/status.md"
fi

echo ""
echo "=========================================="
echo "🚀 Step 2: Smart start other agents..."
echo "=========================================="
echo ""

# Now run smart_run with max 3 additional agents
echo "Running smart_run.sh --max 3..."
"${COMPANY_DIR}/smart_run.sh" --max 3

echo ""
echo "=========================================="
echo "📊 Final Status"
echo "=========================================="
"${COMPANY_DIR}/status.sh"

echo ""
echo "✅ Test complete!"
echo ""
echo "💡 What happened:"
echo "   1. Alice (CEO) ran first and assessed the mission board"
echo "   2. She may have created new tasks or updated existing ones"
echo "   3. Smart start then launched agents with actual assigned work"
echo ""
echo "💰 Cost optimization:"
echo "   - All agents using Kimi (cheaper than Claude)"
echo "   - Resume mode prevents reloading personas every cycle"
echo "   - Smart start only launches agents with actual work"
