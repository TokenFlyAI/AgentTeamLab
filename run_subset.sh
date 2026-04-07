#!/bin/bash
# run_subset.sh — Launch agents in independent loops with failure backoff
# Token-conservative: auto-stops agent after MAX_IDLE_CYCLES consecutive cycles
# where it had nothing to do (no tasks, no inbox).
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${COMPANY_DIR}/lib/paths.sh" 2>/dev/null || true
AGENTS=("$@")
LOGDIR="/tmp/aicompany_runtime_logs"
mkdir -p "$LOGDIR"
MAX_IDLE_CYCLES=3   # Stop agent after this many consecutive no-work cycles

# Read cycle sleep and max_total_cycles from config
_CONFIG="${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json"
CYCLE_SLEEP="${CYCLE_SLEEP_SECONDS:-}"
if [ -z "$CYCLE_SLEEP" ] && [ -f "$_CONFIG" ]; then
    CYCLE_SLEEP=$(jq -r '.cycle_sleep_seconds // 2' "$_CONFIG" 2>/dev/null)
fi
CYCLE_SLEEP="${CYCLE_SLEEP:-2}"

# Total cycle budget (0 = unlimited). Shared counter file tracks all agents.
MAX_TOTAL_CYCLES="${MAX_TOTAL_CYCLES:-}"
if [ -z "$MAX_TOTAL_CYCLES" ] && [ -f "$_CONFIG" ]; then
    MAX_TOTAL_CYCLES=$(jq -r '.max_total_cycles // 0' "$_CONFIG" 2>/dev/null)
fi
MAX_TOTAL_CYCLES="${MAX_TOTAL_CYCLES:-0}"
CYCLE_COUNTER_FILE="/tmp/run_subset_total_cycles_$$.txt"
echo "0" > "$CYCLE_COUNTER_FILE"
trap 'rm -f /tmp/run_subset_parent.pid /tmp/run_subset_*.lock "$CYCLE_COUNTER_FILE"; kill $(jobs -p) 2>/dev/null; wait 2>/dev/null; exit 0' INT TERM EXIT

[ ${#AGENTS[@]} -eq 0 ] && echo "Usage: $0 <agent1> <agent2> ..." && exit 1

echo "Launching ${#AGENTS[@]} agents: ${AGENTS[*]}"

# Write parent PID so callers can send SIGTERM (not SIGKILL) to allow clean child shutdown
echo "$$" > /tmp/run_subset_parent.pid

agent_has_work() {
    local ag="$1"
    local inbox_dir="${AGENTS_DIR:-${COMPANY_DIR}/agents}/${ag}/chat_inbox"
    # Check inbox — only count UNREAD messages (not read_ or processed_ prefixed files)
    local _unread
    _unread=$(ls "$inbox_dir"/*.md 2>/dev/null | grep -v '/read_' | grep -v '/processed_' | grep -v '\.processed\.md$' | wc -l | tr -d ' ')
    if [ "${_unread:-0}" -gt 0 ]; then
        return 0
    fi
    # Check task board for assigned open/in_progress tasks
    local tb="${SHARED_DIR:-${COMPANY_DIR}/public}/task_board.md"
    if [ -f "$tb" ] && grep -q "| ${ag} |" "$tb" 2>/dev/null; then
        # Check if any of those rows are not done
        if grep "| ${ag} |" "$tb" | grep -qvE '\|\s*(done|cancelled)\s*\|'; then
            return 0
        fi
    fi
    # Alice always has work (coordinator)
    [ "$ag" = "alice" ] && return 0
    return 1
}

for AGENT in "${AGENTS[@]}"; do
    (
        # BUG-018 fix: skip if agent already managed by another run_subset.sh
        # Use a lock file per agent to prevent duplicates across separate invocations.
        # IMPORTANT: use $BASHPID (actual subshell PID) not $$ (parent PID) so the lock
        # is unique per subshell, not shared across all agents in the same run_subset.sh.
        MY_PID=$(sh -c 'echo $PPID')   # $BASHPID unavailable in macOS bash 3.2
        LOCK_FILE="/tmp/run_subset_${AGENT}.lock"
        if [ -f "$LOCK_FILE" ]; then
            lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
            if [ "$lock_pid" != "$MY_PID" ] && kill -0 "$lock_pid" 2>/dev/null; then
                echo "[$(date +%H:%M:%S)] ${AGENT} — already managed (pid $lock_pid), skipping"
                exit 0
            fi
        fi
        echo "$MY_PID" > "$LOCK_FILE"
        trap 'rm -f "$LOCK_FILE"' EXIT

        CYCLE=0; FAIL_COUNT=0; IDLE_CYCLES=0
        while true; do
            CYCLE=$((CYCLE + 1))

            # Token conservation: check if agent has actual work before starting a cycle
            if ! agent_has_work "$AGENT"; then
                IDLE_CYCLES=$((IDLE_CYCLES + 1))
                if [ $IDLE_CYCLES -ge $MAX_IDLE_CYCLES ]; then
                    echo "[$(date +%H:%M:%S)] ${AGENT} — no work for ${IDLE_CYCLES} cycles, stopping to save tokens"
                    exit 0
                fi
                echo "[$(date +%H:%M:%S)] ${AGENT} — idle cycle ${IDLE_CYCLES}/${MAX_IDLE_CYCLES}, checking again in 60s"
                sleep 60
                continue
            fi
            IDLE_CYCLES=0  # reset idle counter when work found

            # Check total cycle budget (atomic increment with lock)
            if [ "${MAX_TOTAL_CYCLES:-0}" -gt 0 ]; then
                _LOCK="${CYCLE_COUNTER_FILE}.lock"
                _TOTAL=0
                # Spinlock for atomic read-increment-write
                while ! (set -C; echo "$$" > "$_LOCK") 2>/dev/null; do sleep 0.1; done
                _TOTAL=$(cat "$CYCLE_COUNTER_FILE" 2>/dev/null | tr -d '[:space:]'); _TOTAL=$((_TOTAL + 1))
                echo "$_TOTAL" > "$CYCLE_COUNTER_FILE"
                rm -f "$_LOCK"
                if [ "$_TOTAL" -gt "$MAX_TOTAL_CYCLES" ]; then
                    echo "[$(date +%H:%M:%S)] ${AGENT} — total cycle budget exhausted ($_TOTAL/$MAX_TOTAL_CYCLES), stopping all"
                    kill -TERM "$(cat /tmp/run_subset_parent.pid 2>/dev/null)" 2>/dev/null
                    exit 0
                fi
                echo "[$(date +%H:%M:%S)] ${AGENT} — cycle ${CYCLE} starting (total $_TOTAL/$MAX_TOTAL_CYCLES)"
            else
                echo "[$(date +%H:%M:%S)] ${AGENT} — cycle ${CYCLE} starting"
            fi
            START_TIME=$(date +%s)
            EXECUTOR="${EXECUTOR:-}" bash "${COMPANY_DIR}/run_agent.sh" "$AGENT" 2>&1
            DURATION=$(( $(date +%s) - START_TIME ))

            # Fast failure = API error → exponential backoff (30s, 60s, ..., 300s max)
            if [ $DURATION -lt 10 ]; then
                FAIL_COUNT=$((FAIL_COUNT + 1))
                BACKOFF=$((FAIL_COUNT * 30)); [ $BACKOFF -gt 300 ] && BACKOFF=300
                echo "[$(date +%H:%M:%S)] ${AGENT} — fast fail #${FAIL_COUNT}, backoff ${BACKOFF}s"
                sleep $BACKOFF
            else
                FAIL_COUNT=0; sleep "$CYCLE_SLEEP"
            fi
        done
    ) >> "${LOGDIR}/${AGENT}.log" 2>&1 &
    sleep 1  # stagger launches
done

echo "All agents launched. PIDs: $(jobs -p | tr '\n' ' ')"
echo "Logs: ${LOGDIR}/"
wait
