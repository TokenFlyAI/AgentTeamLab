#!/bin/bash
# set_executors.sh — Configure which executor each agent uses
# Strategy: All agents use gemini (default) or codex. NEVER claude.
# Claude is reserved for the Founder's assistant (Claude Code CLI).

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${COMPANY_DIR}/lib/paths.sh" 2>/dev/null || true

echo "=========================================="
echo "⚙️  Setting Agent Executors"
echo "=========================================="
echo ""
echo "Strategy:"
echo "  • All agents → gemini (Founder directive: never use claude for agents)"
echo ""

# Set all agents to gemini
for agent in alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina; do
    echo "gemini" > "${AGENTS_DIR:-${COMPANY_DIR}/agents}/${agent}/executor.txt"
    echo "✅ ${agent} → gemini"
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
echo "⚠️  FIRST PRINCIPLE: Agents never use claude. Use gemini or codex only."
echo ""
