#!/bin/bash
# smart_run.sh — Token-conservative intelligent agent launcher
#
# Philosophy: ONLY start an agent if it has actual work to do.
# Running idle agents wastes tokens. Every cycle costs money.
#
# Decision logic (priority order, subject to --max cap):
#   1. Alice: if there are ANY open/in_progress tasks OR unread inbox msgs
#   2. Task-assigned agents: ONLY if they have assigned open/in_progress tasks
#   3. Unassigned tasks: add 1 agent per unassigned task (cap 3 extra)
#   4. Inbox-only agents: added LAST, only if under --max cap
#   5. Skip already-running agents
#
# Flags:
#   --daemon       Run in continuous daemon mode (reads config file)
#   --dry-run      Print decision and exit (no launch)
#   --force-alice  Always include alice even if no work
#   --max N        Hard cap on total agents to start (default: 20)
#                  Use --max 3 for testing to save tokens
#   --stop         Stop the daemon
#   --status       Check daemon status

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${COMPANY_DIR}/lib/paths.sh" 2>/dev/null || true
CONFIG_FILE="${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json"
PID_FILE="${COMPANY_DIR}/.smart_run_daemon.pid"
TASK_BOARD="${SHARED_DIR:-${COMPANY_DIR}/public}/task_board.md"
ALL_AGENTS="alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina"

# ── Config Defaults ───────────────────────────────────────────────────────────
MAX_AGENTS=3
INTERVAL_SECONDS=30
FORCE_ALICE=1
MODE="smart"
SELECTION_MODE="deterministic"

# ── Parse Command Line Flags ──────────────────────────────────────────────────
DAEMON_MODE=0
DRY_RUN_FLAG=0
STOP_DAEMON=0
STATUS_CHECK=0
CLI_MAX_AGENTS=""
CLI_SELECTION_MODE=""

for arg in "$@"; do
    case "$arg" in
        --daemon) DAEMON_MODE=1 ;;
        --dry-run) DRY_RUN_FLAG=1 ;;
        --force-alice) FORCE_ALICE=1 ;;
        --stop) STOP_DAEMON=1 ;;
        --status) STATUS_CHECK=1 ;;
    esac
done

# --max N: look for --max followed by a number
PREV_ARG=""
for i in "$@"; do
    if [ "$PREV_ARG" = "--max" ]; then
        if echo "$i" | grep -qE '^[0-9]+$'; then
            CLI_MAX_AGENTS="$i"
            MAX_AGENTS="$i"
        fi
        break
    fi
    PREV_ARG="$i"
done

# --selection-mode random|deterministic
PREV_ARG=""
for i in "$@"; do
    if [ "$PREV_ARG" = "--selection-mode" ]; then
        if [ "$i" = "random" ] || [ "$i" = "deterministic" ]; then
            CLI_SELECTION_MODE="$i"
            SELECTION_MODE="$i"
        fi
        break
    fi
    PREV_ARG="$i"
done

# ── Helper: Read Config File ──────────────────────────────────────────────────
read_config() {
    if [ -f "$CONFIG_FILE" ]; then
        # Use jq if available, otherwise grep/sed
        if command -v jq >/dev/null 2>&1; then
            MAX_AGENTS=$(jq -r '.max_agents // 4' "$CONFIG_FILE")
            INTERVAL_SECONDS=$(jq -r '.interval_seconds // 30' "$CONFIG_FILE")
            MODE=$(jq -r '.mode // "smart"' "$CONFIG_FILE")
            FORCE_ALICE=$(jq -r 'if (.force_alice == true or .force_alice == 1) then 1 else 0 end' "$CONFIG_FILE")
            SELECTION_MODE=$(jq -r '.selection_mode // "deterministic"' "$CONFIG_FILE")
        else
            # Fallback: simple grep/sed parsing
            MAX_AGENTS=$(grep -o '"max_agents":[[:space:]]*[0-9]*' "$CONFIG_FILE" | grep -o '[0-9]*' | head -1)
            MAX_AGENTS="${MAX_AGENTS:-4}"
            INTERVAL_SECONDS=$(grep -o '"interval_seconds":[[:space:]]*[0-9]*' "$CONFIG_FILE" | grep -o '[0-9]*' | head -1)
            INTERVAL_SECONDS="${INTERVAL_SECONDS:-30}"
            SELECTION_MODE=$(grep -o '"selection_mode":[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*"selection_mode":[[:space:]]*"\([^"]*\)".*/\1/' | head -1)
            SELECTION_MODE="${SELECTION_MODE:-deterministic}"
        fi
    fi
    # CLI override takes precedence
    [ -n "$CLI_MAX_AGENTS" ] && MAX_AGENTS="$CLI_MAX_AGENTS"
    [ -n "$CLI_SELECTION_MODE" ] && SELECTION_MODE="$CLI_SELECTION_MODE"
}

# ── Helper: Write Config File ─────────────────────────────────────────────────
# Merges only the fields we own into the existing config; preserves all others
# (e.g. dry_run, cycle_sleep_seconds) that we don't manage here.
write_config() {
    local enabled="$1"
    local patch
    patch=$(printf '{"max_agents":%s,"enabled":%s,"interval_seconds":%s,"last_updated":"%s","mode":"%s","force_alice":%s,"selection_mode":"%s"}' \
        "${MAX_AGENTS}" "${enabled}" "${INTERVAL_SECONDS}" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${MODE}" "${FORCE_ALICE:-true}" "${SELECTION_MODE:-deterministic}")

    if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG_FILE" ]; then
        # Merge: existing config wins for unknown keys; our patch wins for known keys
        jq -s '.[0] * .[1]' "$CONFIG_FILE" <(echo "$patch") > "${CONFIG_FILE}.tmp" && \
            mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    else
        echo "$patch" > "$CONFIG_FILE"
    fi
}

# ── Helper: Check if agent is running ─────────────────────────────────────────
# Fast path: check heartbeat.md (single file read, no process spawn)
# Fall back to pgrep only if heartbeat is stale/missing.
is_agent_running() {
    local ag="$1"
    local hb="${AGENTS_DIR:-${COMPANY_DIR}/agents}/${ag}/heartbeat.md"
    if [ -f "$hb" ]; then
        local hb_status
        hb_status=$(grep '^status:' "$hb" 2>/dev/null | head -1 | sed 's/^status:[[:space:]]*//')
        if [ "$hb_status" = "running" ]; then
            # Verify heartbeat is fresh (<5 min) — stale "running" means process died without cleanup
            local hb_age
            hb_age=$(( $(date +%s) - $(stat -f '%m' "$hb" 2>/dev/null || echo 0) ))
            if [ "$hb_age" -lt 300 ]; then
                return 0  # Fresh heartbeat — agent is genuinely running
            fi
            # Stale heartbeat (>5 min) — verify process is actually alive
            # Note: \b not supported in macOS pgrep (POSIX ERE) — use explicit patterns
            pgrep -f "run_agent.sh ${ag}$" > /dev/null 2>&1 && return 0
            pgrep -f "run_agent.sh ${ag} " > /dev/null 2>&1 && return 0
            return 1  # Stale heartbeat, no process — treat as not running
        fi
    fi
    # Heartbeat says idle/stopped — confirm with pgrep (catches cases where process
    # is alive but hasn't written heartbeat yet, e.g. first few seconds of startup)
    pgrep -f "run_agent.sh ${ag}$" > /dev/null 2>&1 || \
    pgrep -f "run_agent.sh ${ag} " > /dev/null 2>&1
}

# ── Helper: Get running agent count ───────────────────────────────────────────
get_running_count() {
    local count=0
    for ag in $ALL_AGENTS; do
        is_agent_running "$ag" && count=$((count + 1))
    done
    echo "$count"
}

# ── Helper: Get list of running agents ────────────────────────────────────────
get_running_agents() {
    local running=""
    for ag in $ALL_AGENTS; do
        is_agent_running "$ag" && running="$running $ag"
    done
    echo "$running" | sed 's/^ *//'
}

# ── Core Logic: Build agent selection list ────────────────────────────────────
build_selection_list() {
    # Parse task board
    ASSIGNED_AGENTS=""
    UNASSIGNED_COUNT=0
    OPEN_TASK_COUNT=0
    
    if [ -f "$TASK_BOARD" ]; then
        # Task board columns: | ID | Title | Description | Priority | Group | Assignee | Status | ... |
        # Only count rows in the "## Tasks" section (not Directions or Instructions)
        _IN_TASKS_SECTION=0
        while IFS= read -r _raw_line; do
            # Track sections: only process rows under "## Tasks"
            if echo "$_raw_line" | grep -qE '^## '; then
                echo "$_raw_line" | grep -qiE 'task' && _IN_TASKS_SECTION=1 || _IN_TASKS_SECTION=0
                continue
            fi
            [ "$_IN_TASKS_SECTION" -eq 0 ] && continue
            echo "$_raw_line" | grep -q '^|' || continue
            # Parse the pipe-delimited row
            IFS='|' read -r _ id _title _desc _priority _group assignee tb_status _ <<< "$_raw_line"
            id_clean=$(echo "$id" | tr -d ' ')
            echo "$id_clean" | grep -qE '^(-+|ID)$' && continue
            [ -z "$id_clean" ] && continue

            status_clean=$(echo "$tb_status" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
            [ "$status_clean" = "done" ] && continue
            [ "$status_clean" = "cancelled" ] && continue
            [ "$status_clean" = "closed" ] && continue

            OPEN_TASK_COUNT=$((OPEN_TASK_COUNT + 1))
            assignee_clean=$(echo "$assignee" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
            if [ -n "$assignee_clean" ] && [ "$assignee_clean" != "unassigned" ] && [ "$assignee_clean" != "undefined" ] && [ "$assignee_clean" != "-" ]; then
                # Assignee may be comma-separated (e.g. "ivan,grace") — add each
                for a in $(echo "$assignee_clean" | tr ',' ' '); do
                    echo "$ASSIGNED_AGENTS" | grep -qw "$a" || ASSIGNED_AGENTS="$ASSIGNED_AGENTS $a"
                done
            else
                UNASSIGNED_COUNT=$((UNASSIGNED_COUNT + 1))
            fi
        done < "$TASK_BOARD"
    fi
    
    # Check inbox
    INBOX_AGENTS=""
    for ag in $ALL_AGENTS; do
        inbox_dir="${AGENTS_DIR:-${COMPANY_DIR}/agents}/${ag}/chat_inbox"
        if [ -d "$inbox_dir" ]; then
            count=$(ls "$inbox_dir"/*.md 2>/dev/null | grep -v '/read_' | grep -v '/processed_' | grep -v '\.processed\.md$' | wc -l | tr -d ' ')
            [ "${count:-0}" -gt 0 ] && INBOX_AGENTS="$INBOX_AGENTS $ag"
        fi
    done
    
    # Build list
    TO_START=""
    RUNNING_AGENTS=$(get_running_agents)
    
    add_agent() {
        local ag="$1"
        echo "$RUNNING_AGENTS" | grep -qw "$ag" && return
        echo "$TO_START" | grep -qw "$ag" && return
        [ ! -d "${AGENTS_DIR:-${COMPANY_DIR}/agents}/${ag}" ] && return
        TO_START="$TO_START $ag"
    }
    
    under_max() {
        local count=$(echo "$TO_START" | tr ' ' '\n' | grep -v '^$' | wc -l | tr -d ' ')
        local running_count=$(echo "$RUNNING_AGENTS" | tr ' ' '\n' | grep -v '^$' | wc -l | tr -d ' ')
        count=${count:-0}
        running_count=${running_count:-0}
        local total=$((count + running_count))
        [ "$total" -lt "$MAX_AGENTS" ]
    }
    
    # Priority 1: Alice — always runs when FORCE_ALICE=1, even if at capacity
    if [ "$FORCE_ALICE" -eq 1 ] || [ "$OPEN_TASK_COUNT" -gt 0 ] || echo "$INBOX_AGENTS" | grep -qw "alice"; then
        if [ "$FORCE_ALICE" -eq 1 ]; then
            add_agent "alice"  # bypasses under_max — alice slot is guaranteed
        else
            under_max && add_agent "alice"
        fi
    fi
    
    # Priority 2: Task-assigned agents
    for ag in $ALL_AGENTS; do
        [ "$ag" = "alice" ] && continue
        echo "$ASSIGNED_AGENTS" | grep -qw "$ag" && under_max && add_agent "$ag"
    done
    
    # Priority 3: Unassigned task claimers
    if [ "$UNASSIGNED_COUNT" -gt 0 ]; then
        local queued; queued=$(echo "$TO_START" | tr ' ' '\n' | grep -c '[a-z]' 2>/dev/null) || queued=0
        local running_c; running_c=$(echo "$RUNNING_AGENTS" | tr ' ' '\n' | grep -c '[a-z]' 2>/dev/null) || running_c=0
        local total=$((queued + running_c))
        local need=$((UNASSIGNED_COUNT < 3 ? UNASSIGNED_COUNT : 3))
        local add_more=$((need - total))
        
        if [ "$add_more" -gt 0 ]; then
            for ag in $ALL_AGENTS; do
                [ "$add_more" -le 0 ] && break
                [ "$ag" = "alice" ] && continue
                echo "$ASSIGNED_AGENTS" | grep -qw "$ag" && continue
                echo "$RUNNING_AGENTS" | grep -qw "$ag" && continue
                echo "$TO_START" | grep -qw "$ag" && continue
                under_max && add_agent "$ag"
                add_more=$((add_more - 1))
            done
        fi
    fi
    
    # Priority 4: Inbox-only agents
    for ag in $ALL_AGENTS; do
        [ "$ag" = "alice" ] && continue
        echo "$INBOX_AGENTS" | grep -qw "$ag" || continue
        echo "$ASSIGNED_AGENTS" | grep -qw "$ag" && continue
        under_max && add_agent "$ag"
    done
    
    # Apply selection mode shuffle if random
    if [ "$SELECTION_MODE" = "random" ]; then
        if command -v shuf >/dev/null 2>&1; then
            TO_START=$(echo "$TO_START" | tr ' ' '\n' | grep -v '^$' | shuf | tr '\n' ' ')
        else
            TO_START=$(echo "$TO_START" | tr ' ' '\n' | grep -v '^$' | awk 'BEGIN{srand()} {lines[NR]=$0} END{for(i=NR;i>1;i--){j=int(rand()*i)+1; t=lines[i]; lines[i]=lines[j]; lines[j]=t} for(i=1;i<=NR;i++) print lines[i]}' | tr '\n' ' ')
        fi
    fi

    echo "$TO_START" | sed 's/^ *//'
}

# ── Daemon Mode: Main Loop ───────────────────────────────────────────────────
daemon_loop() {
    echo "[daemon] Smart Run daemon started (PID: $$)"
    echo "[daemon] Max agents: $MAX_AGENTS, Interval: ${INTERVAL_SECONDS}s"

    # Write PID file
    echo $$ > "$PID_FILE"

    # Update config to enabled
    write_config "true"

    # Trap signals for graceful shutdown — only clean up PID file, don't write config
    # (writing config on SIGTERM would overwrite user-updated values with stale runtime values)
    trap 'rm -f "$PID_FILE"; exit 0' SIGTERM
    trap 'exit 0' SIGINT SIGHUP SIGQUIT

    local cycle=0
    while true; do
        cycle=$((cycle + 1))
        echo ""
        echo "[daemon] === Cycle $cycle ==="

        # Re-read config each cycle for live updates
        read_config

        # Check if daemon should stop
        if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
            local enabled
            enabled=$(jq -r '.enabled // false' "$CONFIG_FILE")
            if [ "$enabled" = "false" ] || [ "$enabled" = "False" ]; then
                echo "[daemon] Config shows enabled=false, stopping..."
                rm -f "$PID_FILE"
                exit 0
            fi
        fi

        local running_count
        running_count=$(get_running_count)
        local needed=$((MAX_AGENTS - running_count))

        echo "[daemon] Running: $running_count/$MAX_AGENTS, Need to start: $needed"

        if [ "$needed" -gt 0 ]; then
            local to_start
            to_start=$(build_selection_list)
            to_start=$(echo "$to_start" | tr ' ' '\n' | grep -v '^$' | head -n "$needed" | tr '\n' ' ')

            if [ -n "$to_start" ] && [ -n "$(echo "$to_start" | tr -d ' ')" ]; then
                echo "[daemon] Starting agents: $to_start"
                for ag in $to_start; do
                    echo "[daemon] Launching $ag..."
                    # Launch agent in background, detached from daemon's process group
                    # setsid not available on macOS — use nohup + disown instead
                    if command -v setsid >/dev/null 2>&1; then
                        setsid bash "${COMPANY_DIR}/run_agent.sh" "$ag" > /dev/null 2>&1 &
                    else
                        nohup bash "${COMPANY_DIR}/run_agent.sh" "$ag" > /dev/null 2>&1 &
                    fi
                    disown $! 2>/dev/null || true
                    sleep 1  # Small delay between launches
                done
            else
                echo "[daemon] No eligible agents to start"
            fi
        else
            echo "[daemon] At capacity ($running_count/$MAX_AGENTS)"
        fi

        echo "[daemon] Sleeping ${INTERVAL_SECONDS}s..."
        sleep "$INTERVAL_SECONDS"
    done
}

# ── Handle --status ───────────────────────────────────────────────────────────
if [ $STATUS_CHECK -eq 1 ]; then
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Smart Run daemon: RUNNING (PID: $PID)"
            read_config
            echo "Config: max_agents=$MAX_AGENTS, interval=${INTERVAL_SECONDS}s"
            echo "Running agents: $(get_running_count)"
            echo "Agent list: $(get_running_agents)"
            exit 0
        else
            echo "Smart Run daemon: STOPPED (stale PID file)"
            rm -f "$PID_FILE"
            exit 1
        fi
    else
        echo "Smart Run daemon: STOPPED"
        exit 1
    fi
fi

# ── Handle --stop ─────────────────────────────────────────────────────────────
if [ $STOP_DAEMON -eq 1 ]; then
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Stopping Smart Run daemon (PID: $PID)..."
            kill "$PID" 2>/dev/null
            sleep 1
            if kill -0 "$PID" 2>/dev/null; then
                echo "Daemon didn't stop, forcing..."
                kill -9 "$PID" 2>/dev/null
            fi
            rm -f "$PID_FILE"
            echo "Daemon stopped."
            exit 0
        else
            echo "Daemon not running (stale PID file)"
            rm -f "$PID_FILE"
            exit 1
        fi
    else
        echo "Daemon not running"
        exit 1
    fi
fi

# ── Handle --daemon ───────────────────────────────────────────────────────────
if [ $DAEMON_MODE -eq 1 ]; then
    # Check if already running
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo "Daemon already running (PID: $OLD_PID)"
            echo "Use --stop to stop it first, or --status to check status"
            exit 1
        else
            rm -f "$PID_FILE"
        fi
    fi

    read_config
    daemon_loop
    exit 0
fi

# ── One-shot mode (original behavior) ─────────────────────────────────────────
read_config

# ── Health Trend Snapshot ─────────────────────────────────────────────────────
TRACKER="${AGENTS_DIR:-${COMPANY_DIR}/agents}/ivan/output/health_trend_tracker.js"
if [ -f "$TRACKER" ] && command -v node >/dev/null 2>&1; then
    TRACKER_OUTPUT=$(timeout 30 node "$TRACKER" --no-report 2>/dev/null)
    TRACKER_EXIT=$?
    if [ $TRACKER_EXIT -ne 0 ]; then
        echo "[smart_run] INFO: Health tracker skipped (dashboard may not be running)"
    else
        AT_RISK_LINE=$(echo "$TRACKER_OUTPUT" | grep "At-risk:" | sed 's/^[[:space:]]*//')
        if [ -n "$AT_RISK_LINE" ]; then
            echo "[WARN] Agent health declining — $AT_RISK_LINE"
        fi
        FLEET_AVG=$(echo "$TRACKER_OUTPUT" | grep "Fleet Average:" | sed 's/^[[:space:]]*//')
        [ -n "$FLEET_AVG" ] && echo "[smart_run] Health snapshot: $FLEET_AVG"
    fi
fi

# Build selection
TO_START=$(build_selection_list)
RUNNING_AGENTS=$(get_running_agents)

# Parse counters for display
OPEN_TASK_COUNT=0
if [ -f "$TASK_BOARD" ]; then
    while IFS='|' read -r _ id _ _ _ status _; do
        id_clean=$(echo "$id" | tr -d ' ')
        echo "$id_clean" | grep -qE '^(-+|ID)$' && continue
        [ -z "$id_clean" ] && continue
        status_clean=$(echo "$status" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
        [ "$status_clean" = "done" ] && continue
        [ "$status_clean" = "cancelled" ] && continue
        [ "$status_clean" = "closed" ] && continue
        OPEN_TASK_COUNT=$((OPEN_TASK_COUNT + 1))
    done < <(grep '^|' "$TASK_BOARD" 2>/dev/null | tail -n +3)
fi

echo "=== Smart Run Decision ==="
echo "  Max agents cap:    $MAX_AGENTS"
echo "  Open tasks:        $OPEN_TASK_COUNT"
echo "  Already running:   $(echo "$RUNNING_AGENTS" | tr ' ' '\n' | grep -v '^$' | tr '\n' ' ')"
echo "  Starting now:      ${TO_START:-none}"
echo ""

# Dry-run
if [ $DRY_RUN_FLAG -eq 1 ]; then
    exit 0
fi

# Launch agents
if [ -z "$(echo "$TO_START" | tr -d ' ')" ]; then
    echo "No agents need to start — all tasks covered or no work available."
    exit 0
fi

echo "Launching: $TO_START"
for ag in $TO_START; do
    bash "${COMPANY_DIR}/run_agent.sh" "$ag" > /dev/null 2>&1 &
    disown $! 2>/dev/null || true
    sleep 1
done
