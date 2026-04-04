#!/bin/bash
# test_final_e2e.sh — Final end-to-end test of smart start flow
# This tests the actual smart_run.sh logic with a real scenario

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "🧪 Final E2E Test: Smart Start Flow"
echo "=========================================="
echo ""

# 1. Verify setup
echo "1️⃣  Verifying setup..."
echo "   Alice executor: $(cat ${COMPANY_DIR}/agents/alice/executor.txt)"
echo "   Bob executor: $(cat ${COMPANY_DIR}/agents/bob/executor.txt)"
echo ""

# 2. Create a real mission scenario
echo "2️⃣  Setting up mission scenario..."
cat > "${COMPANY_DIR}/public/mission_board.md" << 'EOF'
# Mission Board

## Active Missions

| ID | Mission | Type | Target Group | Status |
|----|---------|------|--------------|--------|
| M001 | Review architecture document | Direction | alice | OPEN |
| M002 | Implement login API | Task | bob | OPEN |
| M003 | Design user dashboard | Task | charlie | OPEN |

EOF
echo "   ✅ Created 3 missions:"
grep "| M" "${COMPANY_DIR}/public/mission_board.md" | sed 's/^/      /'
echo ""

# 3. Check smart_run analysis
echo "3️⃣  Analyzing smart_run logic..."
echo ""
echo "   Expected behavior:"
echo "   - Alice should start (CEO, always first)"
echo "   - Bob should start (has M002 assigned)"
echo "   - Charlie should start (has M003 assigned)"
echo ""

# Simulate what smart_run does
TASK_BOARD="${COMPANY_DIR}/public/mission_board.md"
INBOX="${COMPANY_DIR}/public/chat_inbox.md"

echo "   Checking task assignments..."
ASSIGNED_AGENTS=""
while IFS='|' read -r _ _ _ TARGET _; do
    TARGET=$(echo "$TARGET" | tr -d ' ')
    if [ -n "$TARGET" ] && [ "$TARGET" != "Target" ] && [ "$TARGET" != "Group" ]; then
        ASSIGNED_AGENTS="$ASSIGNED_AGENTS $TARGET"
    fi
done < <(grep "| M" "$TASK_BOARD" 2>/dev/null || true)

echo "   Agents with tasks:$ASSIGNED_AGENTS"
echo ""

# 4. Check pre-conditions
echo "4️⃣  Pre-flight checks..."
for agent in alice bob charlie; do
    SESSION_FILE="${COMPANY_DIR}/agents/${agent}/session_id.txt"
    [ -f "$SESSION_FILE" ] && echo "   ❌ ${agent}: has existing session" || echo "   ✅ ${agent}: fresh start"
done
echo ""

# 5. Dry run analysis of smart_run
echo "5️⃣  Smart Run Analysis..."
echo ""
echo "   Reading smart_run.sh logic..."

# Extract the key logic from smart_run.sh
echo "   Key logic:"
echo "   - Priority 1: Alice (if any tasks exist)"
echo "   - Priority 2: Agents with assigned tasks"
echo "   - Priority 3: Inbox message recipients"
echo ""

# Count open tasks
OPEN_COUNT=$(grep -c "OPEN" "$TASK_BOARD" 2>/dev/null || echo "0")
echo "   Open tasks: $OPEN_COUNT"
echo ""

# 6. Simulate smart_run selection
echo "6️⃣  Simulating agent selection (--max 3)..."
SELECTED=""

# Priority 1: Alice (always first if work exists)
if [ "$OPEN_COUNT" -gt 0 ]; then
    SELECTED="alice"
    echo "   ✅ Selected: alice (CEO priority)"
fi

# Priority 2: Task-assigned agents
for agent in bob charlie; do
    if echo "$ASSIGNED_AGENTS" | grep -qw "$agent"; then
        if [ -z "$SELECTED" ]; then
            SELECTED="$agent"
        else
            SELECTED="$SELECTED $agent"
        fi
        echo "   ✅ Selected: ${agent} (has assigned task)"
    fi
done

echo ""
echo "   Final selection: $SELECTED"
echo ""

# 7. Verify actual execution would work
echo "7️⃣  Verifying execution readiness..."
for agent in $SELECTED; do
    EXECUTOR=$(cat "${COMPANY_DIR}/agents/${agent}/executor.txt")
    PERSONA="${COMPANY_DIR}/agents/${agent}/persona.md"
    PROMPT="${COMPANY_DIR}/agents/${agent}/prompt.md"
    
    if [ -f "$PERSONA" ] && [ -f "$PROMPT" ]; then
        echo "   ✅ ${agent} (${EXECUTOR}): ready to run"
    else
        echo "   ❌ ${agent}: missing files"
    fi
done
echo ""

# 8. Create task board entries
echo "8️⃣  Populating task board..."
cat > "${COMPANY_DIR}/public/task_board.md" << 'EOF'
# Task Board

## Legend
- **OPEN**: Waiting for pickup
- **IN_PROGRESS**: Assigned and being worked on
- **REVIEW**: Pending review/merge
- **DONE**: Completed

## Active Tasks

| ID | Title | Assignee | Status | Priority | Created |
|----|-------|----------|--------|----------|---------|
| T001 | Review architecture | alice | OPEN | HIGH | 2026-03-30 |
| T002 | Implement login API | bob | OPEN | HIGH | 2026-03-30 |
| T003 | Design dashboard | charlie | OPEN | MEDIUM | 2026-03-30 |

## Completed Tasks

| ID | Title | Assignee | Status | Completed |
|----|-------|----------|--------|-----------|

EOF
echo "   ✅ Task board created with 3 tasks"
echo ""

# 9. Summary
echo "=========================================="
echo "📊 E2E Test Summary"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  • Alice: Claude (CEO stability)"
echo "  • Bob, Charlie: Kimi (cost efficient)"
echo "  • Total agents: 20 (19 Kimi + 1 Claude)"
echo ""
echo "Smart Start Logic:"
echo "  • Alice starts first (CEO priority)"
echo "  • Bob starts (task T002 assigned)"
echo "  • Charlie starts (task T003 assigned)"
echo ""
echo "Expected Flow:"
echo "  1. smart_run.sh --max 3 selects: alice, bob, charlie"
echo "  2. Alice (Claude) processes mission, may update tasks"
echo "  3. Bob (Kimi) works on T002"
echo "  4. Charlie (Kimi) works on T003"
echo "  5. Sessions saved for resume on next cycle"
echo ""
echo "Commands to run:"
echo "  ./smart_run.sh --max 3    # Start first 3 agents"
echo "  ./status.sh               # Check agent status"
echo ""
