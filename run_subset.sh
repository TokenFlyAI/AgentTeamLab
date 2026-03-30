#!/bin/bash
# run_subset.sh — Launch agents in independent loops with failure backoff
# Token-conservative: auto-stops agent after MAX_IDLE_CYCLES consecutive cycles
# where it had nothing to do (no tasks, no inbox).
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS=("$@")
LOGDIR="/tmp/aicompany_runtime_logs"
mkdir -p "$LOGDIR"
MAX_IDLE_CYCLES=3   # Stop agent after this many consecutive no-work cycles

[ ${#AGENTS[@]} -eq 0 ] && echo "Usage: $0 <agent1> <agent2> ..." && exit 1

echo "Launching ${#AGENTS[@]} agents: ${AGENTS[*]}"

trap 'kill $(jobs -p) 2>/dev/null; wait 2>/dev/null; exit 0' INT TERM

agent_has_work() {
    local ag="$1"
    local inbox_dir="${COMPANY_DIR}/agents/${ag}/chat_inbox"
    # Check inbox — only count UNREAD messages (not read_ prefixed files)
    if [ -d "$inbox_dir" ] && ls "$inbox_dir"/*.md 2>/dev/null | grep -qv '/read_'; then
        return 0
    fi
    # Check task board for assigned open/in_progress tasks
    local tb="${COMPANY_DIR}/public/task_board.md"
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

            echo "[$(date +%H:%M:%S)] ${AGENT} — cycle ${CYCLE} starting"
            START_TIME=$(date +%s)
            bash "${COMPANY_DIR}/run_agent.sh" "$AGENT" 2>&1
            DURATION=$(( $(date +%s) - START_TIME ))

            # Fast failure = API error → exponential backoff (30s, 60s, ..., 300s max)
            if [ $DURATION -lt 10 ]; then
                FAIL_COUNT=$((FAIL_COUNT + 1))
                BACKOFF=$((FAIL_COUNT * 30)); [ $BACKOFF -gt 300 ] && BACKOFF=300
                echo "[$(date +%H:%M:%S)] ${AGENT} — fast fail #${FAIL_COUNT}, backoff ${BACKOFF}s"
                sleep $BACKOFF
            else
                FAIL_COUNT=0; sleep 2
            fi
        done
    ) >> "${LOGDIR}/${AGENT}.log" 2>&1 &
    sleep 1  # stagger launches
done

echo "All agents launched. PIDs: $(jobs -p | tr '\n' ' ')"
echo "Logs: ${LOGDIR}/"
wait
