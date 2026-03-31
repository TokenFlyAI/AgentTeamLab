#!/bin/bash
# status.sh — CLI status dashboard (RUNNING / IDLE / DREAMING)
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
TODAY=$(date +%Y_%m_%d)

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
printf "${CYAN}%-12s %-10s %5s %8s %7s  %-50s${NC}\n" "AGENT" "STATUS" "CYCLE" "HEARTBEAT" "LOG" "CURRENT TASK"
printf "%-12s %-10s %5s %8s %7s  %-50s\n" "------------" "----------" "-----" "----------" "-------" "--------------------------------------------------"

for AGENT_DIR in "${COMPANY_DIR}"/agents/*/; do
    [ ! -d "$AGENT_DIR" ] && continue
    AGENT_NAME=$(basename "$AGENT_DIR")
    [ ! -f "${AGENT_DIR}/prompt.md" ] && continue
    
    HB_FILE="${AGENT_DIR}/heartbeat.md"
    RAW_LOG="${AGENT_DIR}/logs/${TODAY}_raw.log"
    STATUS="IDLE"
    HEARTBEAT="—"
    CYCLE="—"
    LOG_SIZE="—"
    NOW=$(date +%s)
    
    # Log size
    [ -f "$RAW_LOG" ] && LOG_SIZE=$(du -sh "$RAW_LOG" 2>/dev/null | awk '{print $1}')
    
    # Get status from heartbeat
    if [ -f "$HB_FILE" ]; then
        HB_STATUS=$(grep "^status:" "$HB_FILE" 2>/dev/null | sed 's/^status: //' | tr -d '[:space:]')
        HB_MTIME=$(stat -f %m "$HB_FILE" 2>/dev/null || stat -c %Y "$HB_FILE" 2>/dev/null)
        
        if [ -n "$HB_MTIME" ]; then
            AGE_MIN=$(( (NOW - HB_MTIME) / 60 ))
            HEARTBEAT="${AGE_MIN}m ago"
            
            # 3-status system: running / idle / dreaming
            case "$HB_STATUS" in
                running)
                    STATUS="RUNNING"
                    ;;
                dreaming|maintenance|system)
                    STATUS="DREAMING"
                    ;;
                *)
                    STATUS="IDLE"
                    ;;
            esac
        fi
    fi
    
    # Cycle count from status.md
    if [ -f "${AGENT_DIR}/status.md" ]; then
        CYCLE_LINE=$(grep -oEi "(cycle count|session|cycle)[[:space:]]*[#]?[[:space:]]*[0-9]+" "${AGENT_DIR}/status.md" 2>/dev/null | head -1 | grep -oE '[0-9]+')
        [ -n "$CYCLE_LINE" ] && CYCLE="$CYCLE_LINE"
    fi
    
    # Task info from heartbeat
    TASK_INFO=$(grep "^task:" "$HB_FILE" 2>/dev/null | sed 's/^task: //' | cut -c1-50)
    [ -z "$TASK_INFO" ] && TASK_INFO="—"
    
    # Color by status
    case "$STATUS" in
        RUNNING) COLOR="$GREEN" ;;
        DREAMING) COLOR="$BLUE" ;;
        *) COLOR="$YELLOW" ;;
    esac
    
    printf "${COLOR}%-12s %-10s %5s %8s %7s${NC}  %-50s\n" \
        "$AGENT_NAME" "$STATUS" "$CYCLE" "$HEARTBEAT" "$LOG_SIZE" "$TASK_INFO"
done

echo ""
[ -f "${COMPANY_DIR}/public/company_mode.md" ] && echo -e "Mode: ${CYAN}$(grep '^\*\*' "${COMPANY_DIR}/public/company_mode.md" | head -1 | tr -d '*')${NC}"

[ -f "${COMPANY_DIR}/public/task_board.md" ] && echo "Tasks: $(grep "^|" "${COMPANY_DIR}/public/task_board.md" | grep -v "^| ID\|^|--" | wc -l | tr -d ' ') total"

echo ""
echo -e "Legend: ${GREEN}RUNNING${NC}=working  ${YELLOW}IDLE${NC}=waiting  ${BLUE}DREAMING${NC}=system task"
echo ""
