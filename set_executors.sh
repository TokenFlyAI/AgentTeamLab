#!/bin/bash
# set_executors.sh — Configure which executor each agent uses
# Strategy: Alice (Lead Coordinator) on Claude for stability, everyone else on Kimi for cost

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${COMPANY_DIR}/lib/paths.sh" 2>/dev/null || true

echo "=========================================="
echo "⚙️  Setting Agent Executors"
echo "=========================================="
echo ""
echo "Strategy:"
echo "  • Alice → Claude (Lead Coordinator stability)"
echo "  • Others → Kimi (cost efficient)"
echo ""

# Set Alice to Claude
echo "claude" > "${AGENTS_DIR:-${COMPANY_DIR}/agents}/alice/executor.txt"
echo "✅ Alice → Claude"

# Set all others to Kimi
for agent in bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina; do
    echo "kimi" > "${AGENTS_DIR:-${COMPANY_DIR}/agents}/${agent}/executor.txt"
    echo "✅ ${agent} → Kimi"
done

echo ""
echo "=========================================="
echo "📊 Executor Configuration Summary"
echo "=========================================="
echo ""

# Show current config
echo "Current assignments:"
for agent in alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina; do
    EXECUTOR=$(cat "${AGENTS_DIR:-${COMPANY_DIR}/agents}/${agent}/executor.txt" 2>/dev/null || echo "default")
    printf "  %-8s → %s\n" "$agent" "$EXECUTOR"
done

echo ""
echo "💡 Cost savings: ~80% by using Kimi for 19/20 agents"
echo ""
