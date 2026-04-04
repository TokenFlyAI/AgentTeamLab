#!/bin/bash
# stop_all.sh — Hard stop ALL agent processes. Nothing keeps running after this.
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${COMPANY_DIR}/lib/paths.sh" 2>/dev/null || true

echo "=== STOPPING ALL AGENTS ==="

# 1. Kill smart_run daemon via PID file first (prevents it from respawning agents)
DAEMON_PID_FILE="${COMPANY_DIR}/.smart_run_daemon.pid"
if [ -f "$DAEMON_PID_FILE" ]; then
    _pid=$(cat "$DAEMON_PID_FILE" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$_pid" ] && kill -0 "$_pid" 2>/dev/null; then
        kill "$_pid" 2>/dev/null && echo "  Killed smart_run daemon (PID $_pid)"
    fi
    rm -f "$DAEMON_PID_FILE"
fi

# 2. Kill any smart_run.sh / run_all.sh one-shot processes (prevents new agent spawns)
pkill -TERM -f "smart_run.sh" 2>/dev/null && echo "  Killed smart_run.sh" || true
pkill -TERM -f "run_all.sh"   2>/dev/null && echo "  Killed run_all.sh"   || true

# 3. Kill agent loop runners
pkill -TERM -f "run_subset.sh" 2>/dev/null && echo "  Killed run_subset.sh" || true

# 4. Kill individual agent cycles
pkill -TERM -f "run_agent.sh"  2>/dev/null && echo "  Killed run_agent.sh"  || true

sleep 1

# 5. Force-kill any still-running claude/kimi subprocesses under agents/
pkill -9 -f "claude.*agents/" 2>/dev/null && echo "  Force-killed claude agent procs" || true
pkill -9 -f "kimi.*agents/"   2>/dev/null && echo "  Force-killed kimi agent procs"   || true
pkill -9 -f "run_agent.sh"    2>/dev/null || true
pkill -9 -f "run_subset.sh"   2>/dev/null || true

# 6. Clean session locks
rm -f /tmp/claude_launcher_*.sessions 2>/dev/null || true
rm -f /tmp/aicompany_settings_*.json  2>/dev/null || true

# 7. Reset ALL heartbeats to idle so dashboard reflects true state immediately
RESET_COUNT=0
for hb in "${AGENTS_DIR:-${COMPANY_DIR}/agents}"/*/heartbeat.md; do
    [ -f "$hb" ] || continue
    printf 'status: idle\ntimestamp: %s\ntask: Stopped\n' "$(date +%Y_%m_%d_%H_%M_%S)" > "$hb"
    RESET_COUNT=$((RESET_COUNT + 1))
done
[ "$RESET_COUNT" -gt 0 ] && echo "  Reset $RESET_COUNT heartbeats to idle"

echo "=== ALL STOPPED ==="
