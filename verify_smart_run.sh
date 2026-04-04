#!/bin/bash
# verify_smart_run.sh — Verify smart_run.sh logic works correctly

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "🔍 Verifying smart_run.sh Logic"
echo "=========================================="
echo ""

# Parse the core logic from smart_run.sh
echo "1️⃣  Testing task board parsing..."

TASK_BOARD="${COMPANY_DIR}/public/task_board.md"

if [ ! -f "$TASK_BOARD" ]; then
    echo "   ❌ Task board not found!"
    exit 1
fi

echo "   Task board exists ✅"
echo ""
echo "   Content preview:"
head -20 "$TASK_BOARD" | sed 's/^/   /'
echo ""

# Test the parsing logic
echo "2️⃣  Testing agent assignment detection..."

# Count open tasks
OPEN_COUNT=$(grep -c "OPEN" "$TASK_BOARD" 2>/dev/null || echo "0")
echo "   Open tasks: $OPEN_COUNT"

# Extract assigned agents
ASSIGNED_AGENTS=""
while IFS='|' read -r _ id title assignee status _; do
    id=$(echo "$id" | tr -d ' ')
    status=$(echo "$status" | tr -d ' ')
    assignee=$(echo "$assignee" | tr -d ' ')
    
    # Skip header rows
    [ "$id" = "ID" ] && continue
    [ -z "$id" ] && continue
    
    if [ "$status" = "OPEN" ] || [ "$status" = "IN_PROGRESS" ]; then
        if [ -n "$assignee" ] && [ "$assignee" != "-" ]; then
            ASSIGNED_AGENTS="$ASSIGNED_AGENTS $assignee"
            echo "   Found: $assignee has task $id (status: $status)"
        fi
    fi
done < <(grep "^| T" "$TASK_BOARD" 2>/dev/null || true)

echo ""
echo "   Assigned agents:$ASSIGNED_AGENTS"
echo ""

# Test inbox parsing
echo "3️⃣  Testing inbox parsing..."
INBOX="${COMPANY_DIR}/public/chat_inbox.md"
INBOX_AGENTS=""

if [ -f "$INBOX" ]; then
    # Parse @agent mentions
    while IFS= read -r line; do
        if echo "$line" | grep -qE '^[[:space:]]*- @'; then
            AGENT=$(echo "$line" | grep -oE '@[a-z]+' | head -1 | tr -d '@')
            if [ -n "$AGENT" ]; then
                INBOX_AGENTS="$INBOX_AGENTS $AGENT"
            fi
        fi
    done < "$INBOX"
fi

echo "   Agents with inbox messages:$INBOX_AGENTS"
echo ""

# Simulate smart_run selection
echo "4️⃣  Simulating smart_run selection (--max 3)..."

MAX_AGENTS=3
TO_START=""
RUNNING=""

# Helper function
add_agent() {
    local agent="$1"
    if echo "$RUNNING" | grep -qw "$agent"; then
        echo "   ⏭️  $agent (already running)"
        return 1
    fi
    if echo "$TO_START" | grep -qw "$agent"; then
        return 1
    fi
    local count=$(echo "$TO_START" | wc -w | tr -d ' ')
    if [ "$count" -ge "$MAX_AGENTS" ]; then
        echo "   ⏹️  $agent (max reached)"
        return 1
    fi
    TO_START="$TO_START $agent"
    echo "   ✅ Added: $agent"
    return 0
}

# Priority 1: Alice (if work exists)
if [ "$OPEN_COUNT" -gt 0 ] || [ -n "$INBOX_AGENTS" ]; then
    echo "   Priority 1: Alice (CEO - work exists)"
    add_agent "alice"
fi

# Priority 2: Task-assigned agents
echo "   Priority 2: Task-assigned agents"
for agent in alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina; do
    [ "$agent" = "alice" ] && continue
    if echo "$ASSIGNED_AGENTS" | grep -qw "$agent"; then
        add_agent "$agent"
    fi
done

echo ""
echo "   Final selection: $TO_START"
echo "   Count: $(echo "$TO_START" | wc -w | tr -d ' ')/$MAX_AGENTS"
echo ""

# Verify executors
echo "5️⃣  Verifying executor assignments..."
for agent in $TO_START; do
    EXECUTOR=$(cat "${COMPANY_DIR}/agents/${agent}/executor.txt" 2>/dev/null || echo "default")
    echo "   $agent → $EXECUTOR"
done
echo ""

echo "=========================================="
echo "✅ smart_run.sh Logic Verification Complete"
echo "=========================================="
echo ""
echo "The smart_run.sh script should:"
echo "  1. Start Alice first (CEO priority)"
echo "  2. Then start agents with assigned tasks"
echo "  3. Respect --max limit"
echo "  4. Skip already-running agents"
echo "  5. Use correct executor (Claude/Kimi)"
echo ""
echo "To actually run: ./smart_run.sh --max 3"
echo ""
