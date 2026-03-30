#!/bin/bash
# status.sh — CLI status dashboard
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
TODAY=$(date +%Y_%m_%d)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Header
echo ""
printf "${CYAN}%-12s %-8s %5s %8s %7s  %-50s${NC}\n" "AGENT" "STATUS" "CYCLE" "LAST_UPD" "LOG" "INFO"
printf "%-12s %-8s %5s %8s %7s  %-50s\n" "------------" "--------" "-----" "--------" "-------" "-----------------------------------------------"

for AGENT_DIR in "${COMPANY_DIR}"/agents/*/; do
    [ ! -d "$AGENT_DIR" ] && continue
    AGENT_NAME=$(basename "$AGENT_DIR")

    # Check if agent has prompt.md (is a real agent)
    [ ! -f "${AGENT_DIR}/prompt.md" ] && continue

    # Status detection via heartbeat.md (matches web dashboard criteria)
    RAW_LOG="${AGENT_DIR}/logs/${TODAY}_raw.log"
    HB_FILE="${AGENT_DIR}/heartbeat.md"
    STATUS="offline"
    LAST_UPD="—"
    LOG_SIZE="—"
    NOW=$(date +%s)

    # Log file size (informational)
    if [ -f "$RAW_LOG" ]; then
        LOG_SIZE=$(du -sh "$RAW_LOG" 2>/dev/null | awk '{print $1}')
    fi

    if [ -f "$HB_FILE" ]; then
        # Read status field from heartbeat.md (same as web status badge)
        HB_STATUS=$(grep -E "^status:" "$HB_FILE" 2>/dev/null | head -1 | sed 's/^status:[[:space:]]*//' | tr -d '\r')
        HB_MTIME=$(stat -f %m "$HB_FILE" 2>/dev/null || stat -c %Y "$HB_FILE" 2>/dev/null)
        if [ -n "$HB_MTIME" ]; then
            AGE=$(( NOW - HB_MTIME ))
            # Match web heartbeat dot: green <2min, yellow 2-10min, red >10min
            if [ $AGE -lt 120 ]; then
                STATUS="${HB_STATUS:-running}"
                LAST_UPD="${AGE}s ago"
            elif [ $AGE -lt 600 ]; then
                STATUS="idle"
                LAST_UPD="$((AGE / 60))m ago"
            else
                STATUS="stale"
                LAST_UPD="$((AGE / 60))m ago"
            fi
        fi
    elif [ -f "$RAW_LOG" ]; then
        # Fallback: no heartbeat, use raw log mtime
        MTIME=$(stat -f %m "$RAW_LOG" 2>/dev/null || stat -c %Y "$RAW_LOG" 2>/dev/null)
        if [ -n "$MTIME" ]; then
            AGE=$(( NOW - MTIME ))
            if [ $AGE -lt 120 ]; then
                STATUS="running"
                LAST_UPD="${AGE}s ago"
            elif [ $AGE -lt 600 ]; then
                STATUS="idle"
                LAST_UPD="$((AGE / 60))m ago"
            else
                STATUS="stale"
                LAST_UPD="$((AGE / 60))m ago"
            fi
        fi
    fi

    # Cycle count from status.md
    CYCLE="—"
    if [ -f "${AGENT_DIR}/status.md" ]; then
        CYCLE_LINE=$(grep -A1 "Cycle Count" "${AGENT_DIR}/status.md" 2>/dev/null | tail -1)
        [ -n "$CYCLE_LINE" ] && CYCLE=$(echo "$CYCLE_LINE" | tr -d ' ')
    fi

    # Current task from heartbeat or status.md
    TASK_INFO=""
    if [ -f "${AGENT_DIR}/heartbeat.md" ]; then
        TASK_INFO=$(grep "^task:" "${AGENT_DIR}/heartbeat.md" 2>/dev/null | sed 's/^task: //')
    fi
    if [ -z "$TASK_INFO" ] && [ -f "${AGENT_DIR}/status.md" ]; then
        TASK_INFO=$(grep -A1 "Currently Working On" "${AGENT_DIR}/status.md" 2>/dev/null | tail -1)
    fi
    TASK_INFO=$(echo "$TASK_INFO" | cut -c1-50)

    # Color based on status (aligns with web: green=running, yellow=idle, red=stale/offline)
    case "$STATUS" in
        running|active|ACTIVE) COLOR="$GREEN" ;;
        idle)                  COLOR="$YELLOW" ;;
        stale|error|blocked)   COLOR="$RED" ;;
        *)                     COLOR="$NC" ;;
    esac

    printf "${COLOR}%-12s %-8s %5s %8s %7s${NC}  %-50s\n" \
        "$AGENT_NAME" "$STATUS" "$CYCLE" "$LAST_UPD" "$LOG_SIZE" "$TASK_INFO"
done

echo ""

# Mode
if [ -f "${COMPANY_DIR}/public/company_mode.md" ]; then
    MODE=$(grep '^\*\*' "${COMPANY_DIR}/public/company_mode.md" | head -1 | tr -d '*')
    echo -e "Mode: ${CYAN}${MODE}${NC}"
fi

# Task board summary
if [ -f "${COMPANY_DIR}/public/task_board.md" ]; then
    TOTAL=$(grep "^|" "${COMPANY_DIR}/public/task_board.md" | grep -v "^| ID\|^|--" | wc -l | tr -d ' ')
    DONE=$(grep "^|" "${COMPANY_DIR}/public/task_board.md" | grep -i "done" | wc -l | tr -d ' ')
    IN_PROG=$(grep "^|" "${COMPANY_DIR}/public/task_board.md" | grep -i "in_progress" | wc -l | tr -d ' ')
    echo "Tasks: ${TOTAL} total, ${IN_PROG} in progress, ${DONE} done"
fi
echo ""
