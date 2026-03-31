#!/usr/bin/env bash
# =============================================================================
# dev_cli.sh — Tokenfly Developer CLI
# Author: Karl (Platform Engineer)
# Task:   #47 — Developer CLI Tooling
# Version: 1.4.0
#
# Usage: ./dev_cli.sh <command> [args...]
#
# Commands:
#   status [name]              Show agent status (all, or specific agent)
#   tasks [filter]             List tasks (optional: --agent <name> | --status <status>)
#   inbox <agent>              View unread inbox messages for an agent
#   assign <id> <agent>        Assign task to an agent
#   done <id>                  Mark task as done
#   send <agent> <message>     Send a message to an agent's inbox
#   broadcast <message>        Send a message to ALL agents' inboxes
#   claim <id> <agent>         Atomically claim a task (409 if already claimed)
#   mode [plan|normal|crazy]   Get or set company operating mode
#   cost                       Show today's token spend per agent
#   health                     Server health check
#   logs <agent> [lines]       Tail agent runtime log (default: 50 lines)
#   cycles <agent> [n]         Show cycle history; with [n], print full log for cycle N
#   output <agent> [file]      List or view agent output files
#   watchdog                   Trigger watchdog restart for stuck agents
#   smart-start                Start only agents with actual work (token-conservative)
#   metrics                    Show system-wide metrics
#   cmd <command>              CEO quick command (routing by prefix)
#   watch [interval]           Live status polling (default: 10s interval)
#   help                       Show this help
#
# Config:
#   TOKENFLY_URL     Override server URL (default: http://localhost:3199)
#   TOKENFLY_DIR     Override agents root directory (default: ./agents)
#   TOKENFLY_API_KEY API key for authenticated endpoints (SEC-001 support)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL="${TOKENFLY_URL:-http://localhost:3199}"
AGENTS_DIR="${TOKENFLY_DIR:-$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)/agents}"
LOG_DIR="/tmp/aicompany_runtime_logs"
SCRIPT_NAME="$(basename "$0")"
API_KEY="${TOKENFLY_API_KEY:-}"

# ---------------------------------------------------------------------------
# Colors (disabled if not a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  RESET='\033[0m'
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' BLUE='' CYAN='' RESET=''
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
die() { echo -e "${RED}error:${RESET} $*" >&2; exit 1; }
info() { echo -e "${DIM}$*${RESET}"; }
header() { echo -e "\n${BOLD}${BLUE}$*${RESET}"; }
ok() { echo -e "${GREEN}✓${RESET} $*"; }

require_jq() {
  command -v jq &>/dev/null || die "jq is required. Install it with: brew install jq"
}

_auth_header() {
  # Returns curl args for auth header if TOKENFLY_API_KEY is set
  if [ -n "$API_KEY" ]; then
    echo "-H" "Authorization: Bearer ${API_KEY}"
  fi
}

api_get() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local response
  # shellcheck disable=SC2046
  response=$(curl -sf $(_auth_header) "$url" 2>/dev/null) || die "Failed to connect to $url\n  Is the server running? Try: node server.js --dir . --port 3199"
  echo "$response"
}

api_post() {
  local path="$1"
  local body="${2:-{}}"
  local url="${BASE_URL}${path}"
  local response
  # shellcheck disable=SC2046
  response=$(curl -sf -X POST $(_auth_header) "$url" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null) || die "POST $url failed"
  echo "$response"
}

api_post_raw() {
  # Like api_post but returns http_code — doesn't die on non-2xx
  local path="$1"
  local body="${2:-{}}"
  # shellcheck disable=SC2046
  curl -s -o /dev/null -w "%{http_code}" -X POST $(_auth_header) "${BASE_URL}${path}" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null
}

api_patch() {
  local path="$1"
  local body="${2:-{}}"
  local url="${BASE_URL}${path}"
  local response
  # shellcheck disable=SC2046
  response=$(curl -sf -X PATCH $(_auth_header) "$url" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null) || die "PATCH $url failed"
  echo "$response"
}

# ---------------------------------------------------------------------------
# Format helpers
# ---------------------------------------------------------------------------
format_status() {
  local s="$1"
  case "$s" in
    running|active|online)  echo -e "${GREEN}● $s${RESET}" ;;
    idle)                   echo -e "${YELLOW}○ $s${RESET}" ;;
    stopped|offline|dead)   echo -e "${RED}✗ $s${RESET}" ;;
    *)                      echo "$s" ;;
  esac
}

format_priority() {
  local p="$1"
  case "$p" in
    critical|p0)  echo -e "${RED}$p${RESET}" ;;
    high)         echo -e "${YELLOW}$p${RESET}" ;;
    medium)       echo -e "${CYAN}$p${RESET}" ;;
    low)          echo -e "${DIM}$p${RESET}" ;;
    *)            echo "$p" ;;
  esac
}

format_task_status() {
  local s="$1"
  case "$s" in
    done|completed)    echo -e "${GREEN}done${RESET}" ;;
    in_progress)       echo -e "${YELLOW}in_progress${RESET}" ;;
    in_review)         echo -e "${BLUE}in_review${RESET}" ;;
    open)              echo -e "${CYAN}open${RESET}" ;;
    blocked)           echo -e "${RED}blocked${RESET}" ;;
    cancelled)         echo -e "${DIM}cancelled${RESET}" ;;
    *)                 echo "$s" ;;
  esac
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_help() {
  echo -e "${BOLD}Tokenfly Developer CLI${RESET} v1.3.1"
  echo -e "${DIM}Platform Engineer: Karl | Server: ${BASE_URL}${RESET}"
  echo ""
  echo -e "${BOLD}USAGE${RESET}"
  echo "  $SCRIPT_NAME <command> [args]"
  echo ""
  echo -e "${BOLD}AGENT COMMANDS${RESET}"
  printf "  %-32s %s\n" "status [name]"                "Show agent status (all, or a specific agent)"
  printf "  %-32s %s\n" "logs <agent> [lines]"         "Tail agent runtime log (default: 50 lines)"
  printf "  %-32s %s\n" "cycles <agent> [n]"            "Show cycle history; with [n], print full log for cycle N"
  printf "  %-32s %s\n" "output <agent> [file]"        "List or view agent output files"
  printf "  %-32s %s\n" "inbox <agent>"                "View unread inbox messages for an agent"
  printf "  %-32s %s\n" "send <agent> <message>"       "Send a message to an agent's inbox"
  printf "  %-32s %s\n" "broadcast <message>"          "Send a message to ALL agents' inboxes"
  printf "  %-32s %s\n" "watchdog"                     "Restart any stuck agents (stale heartbeat >15 min)"
  printf "  %-32s %s\n" "smart-start"                  "Start only agents with actual work (token-conservative)"
  printf "  %-32s %s\n" "metrics"                      "System-wide metrics"
  printf "  %-32s %s\n" "cmd <command>"                "CEO quick command (@agent, task:, /mode, or alice DM)"
  printf "  %-32s %s\n" "watch [interval_sec]"         "Live status polling (default: 10s)"
  echo ""
  echo -e "${BOLD}TASK COMMANDS${RESET}"
  printf "  %-32s %s\n" "tasks [--agent <name>]"       "List tasks, optionally filtered by agent"
  printf "  %-32s %s\n" "tasks --status <status>"      "Filter tasks by status (open/in_progress/done)"
  printf "  %-32s %s\n" "assign <id> <agent>"          "Assign task to an agent"
  printf "  %-32s %s\n" "done <id>"                    "Mark task as done"
  printf "  %-32s %s\n" "claim <id> <agent>"           "Atomically claim a task (409 if already claimed)"
  echo ""
  echo -e "${BOLD}SYSTEM COMMANDS${RESET}"
  printf "  %-32s %s\n" "mode [plan|normal|crazy]"     "Get or set company operating mode"
  printf "  %-32s %s\n" "cost"                         "Show today's token spend per agent"
  printf "  %-32s %s\n" "health"                       "Server health check"
  printf "  %-32s %s\n" "help"                         "Show this help"
  echo ""
  echo -e "${BOLD}CONFIG${RESET}"
  echo "  TOKENFLY_URL     Override server URL (default: http://localhost:3199)"
  echo "  TOKENFLY_DIR     Override agents root directory"
  echo "  TOKENFLY_API_KEY API key for authenticated endpoints (SEC-001)"
  echo ""
  echo -e "${BOLD}EXAMPLES${RESET}"
  echo "  $SCRIPT_NAME status                      # All agents"
  echo "  $SCRIPT_NAME status alice                # Single agent"
  echo "  $SCRIPT_NAME logs alice 100              # Last 100 log lines for alice"
  echo "  $SCRIPT_NAME cycles alice                # Alice's cycle cost history"
  echo "  $SCRIPT_NAME output alice                # List alice's deliverables"
  echo "  $SCRIPT_NAME output alice report.md      # Read a specific deliverable"
  echo "  $SCRIPT_NAME tasks --agent bob           # Bob's tasks"
  echo "  $SCRIPT_NAME tasks --status open         # All open tasks"
  echo "  $SCRIPT_NAME assign 12 charlie           # Assign task 12 to charlie"
  echo "  $SCRIPT_NAME claim 12 charlie            # Atomic claim (race-safe)"
  echo "  $SCRIPT_NAME done 12                     # Mark task 12 done"
  echo "  $SCRIPT_NAME send alice 'Fix auth bug'   # DM alice"
  echo "  $SCRIPT_NAME broadcast 'Deploy in 5min' # DM everyone"
  echo "  $SCRIPT_NAME mode crazy                  # Switch to crazy mode"
  echo "  $SCRIPT_NAME watchdog                    # Restart stuck agents"
  echo "  $SCRIPT_NAME smart-start                 # Start agents with work only"
  echo "  $SCRIPT_NAME metrics                     # System-wide metrics"
  echo "  $SCRIPT_NAME cmd '@bob fix the bug'      # DM bob directly"
  echo "  $SCRIPT_NAME cmd 'task: Add rate limit'  # Create a task"
  echo "  $SCRIPT_NAME cmd '/mode crazy'           # Switch company mode"
  echo "  $SCRIPT_NAME watch 5                     # Refresh status every 5s"
  echo "  $SCRIPT_NAME cost                        # Token spend today"
}

cmd_status() {
  local target="${1:-}"
  require_jq

  if [ -n "$target" ]; then
    header "Agent: $target"
    local data
    data=$(api_get "/api/agents/$target")
    local name status heartbeat
    name=$(echo "$data" | jq -r '.name // .agent // "unknown"')
    # API v1.1: alive:boolean replaces status:string; fall back for older responses
    status=$(echo "$data" | jq -r '
      if .alive != null then (if .alive then "active" else "offline" end)
      else (.status // "unknown")
      end')
    heartbeat=$(echo "$data" | jq -r '.heartbeat_at // .lastHeartbeat // .heartbeat // "—"')
    echo -e "  Name:       ${BOLD}$name${RESET}"
    echo -e "  Status:     $(format_status "$status")"
    echo -e "  Heartbeat:  $heartbeat"
    local current_task
    current_task=$(echo "$data" | jq -r '.currentTask // .task // ""')
    [ -n "$current_task" ] && echo -e "  Task:       $current_task"
  else
    header "Agent Status — All"
    local data
    data=$(api_get "/api/agents")
    echo "$data" | jq -r '
      .agents // . |
      if type == "array" then .
      else to_entries | map(.value)
      end |
      .[] |
      [
        .name // "?",
        (if .alive != null then (if .alive then "active" else "offline" end) else (.status // "unknown") end),
        (.heartbeat_at // .lastHeartbeat // "—"),
        (.currentTask // "")
      ] |
      @tsv
    ' | while IFS=$'\t' read -r name status heartbeat task; do
      printf "  %-12s  %s\n" "$name" "$(format_status "$status")"
      [ -n "$task" ] && printf "  %14s  ${DIM}%s${RESET}\n" "" "$task"
    done
  fi
}

cmd_logs() {
  local agent="${1:-}"
  local lines="${2:-50}"
  [ -z "$agent" ] && die "Usage: $SCRIPT_NAME logs <agent> [lines]"

  header "Logs: $agent (last $lines lines)"

  local log_file="${LOG_DIR}/${agent}.log"
  if [ -f "$log_file" ]; then
    tail -n "$lines" "$log_file"
  else
    # Fallback: try server API log endpoint
    info "  Log file not found at $log_file"
    info "  Trying API..."
    local data
    data=$(curl -sf "${BASE_URL}/api/agents/${agent}/log?lines=${lines}" 2>/dev/null) || {
      die "No log file at $log_file and no API log endpoint available."
    }
    echo "$data"
  fi
}

cmd_cycles() {
  local agent="${1:-}"
  local cycle_n="${2:-}"
  [ -z "$agent" ] && die "Usage: $SCRIPT_NAME cycles <agent> [cycle_number]"
  require_jq

  # If cycle number given, fetch full log for that cycle
  if [ -n "$cycle_n" ]; then
    [[ "$cycle_n" =~ ^[0-9]+$ ]] || die "Cycle number must be a positive integer"
    header "Cycle $cycle_n log: $agent"
    local log_data
    log_data=$(curl -sf "${BASE_URL}/api/agents/${agent}/cycles/${cycle_n}" \
      ${TOKENFLY_API_KEY:+-H "Authorization: Bearer ${TOKENFLY_API_KEY}"} 2>/dev/null) \
      || die "Failed to fetch cycle $cycle_n for $agent"
    # Try to print the log output field, fallback to raw JSON
    echo "$log_data" | jq -r '.output // .log // .content // .' 2>/dev/null || echo "$log_data"
    return
  fi

  header "Cycles: $agent"
  local data
  data=$(api_get "/api/agents/${agent}/cycles")

  echo "$data" | jq -r '
    if type == "array" then .[] else (.cycles // .[]) end |
    [ (.cycle // .n // "?"|tostring),
      (.cost_usd // .cost // 0 | tostring),
      (.turns // .steps // 0 | tostring),
      (.duration_s // .duration // 0 | tostring),
      (.status // ""),
      (.startedAt // .started_at // "") ] |
    @tsv
  ' 2>/dev/null | \
  while IFS=$'\t' read -r cycle cost turns dur status started; do
    printf "  Cycle %-4s  cost=\$%-8s  turns=%-4s  dur=%ss  %-12s  %s\n" \
      "$cycle" "$cost" "$turns" "$dur" "$(format_task_status "$status")" "$started"
  done

  # Totals if available
  local total_cost
  total_cost=$(echo "$data" | jq -r '.total_cost_usd // .totalCost // ""' 2>/dev/null)
  [ -n "$total_cost" ] && echo -e "\n  ${BOLD}Total cost: \$$total_cost${RESET}"
  echo -e "\n  ${DIM}Tip: run 'cycles $agent <n>' to view full log for cycle N${RESET}"
}

cmd_output() {
  local agent="${1:-}"
  local file="${2:-}"
  [ -z "$agent" ] && die "Usage: $SCRIPT_NAME output <agent> [file]"
  require_jq

  if [ -z "$file" ]; then
    header "Output files: $agent"
    local data
    data=$(api_get "/api/agents/${agent}/output")
    echo "$data" | jq -r '
      if type == "array" then .[]
      elif .files then .files[]
      else .
      end |
      if type == "string" then .
      else (.name // .file // .)
      end
    ' 2>/dev/null | while read -r fname; do
      printf "  %s\n" "$fname"
    done

    # Also check filesystem directly as fallback
    local out_dir="${AGENTS_DIR}/${agent}/output"
    if [ -d "$out_dir" ]; then
      local file_list
      file_list=$(ls "$out_dir" 2>/dev/null) || true
      [ -n "$file_list" ] && echo "$file_list" | while read -r fname; do
        printf "  %s\n" "$fname"
      done | sort -u
    fi
  else
    header "Output: $agent/$file"
    # Try API first
    local content
    content=$(api_get "/api/agents/${agent}/output/${file}" 2>/dev/null) || true

    if [ -n "$content" ]; then
      echo "$content"
    else
      # Fallback: read directly from filesystem
      local fpath="${AGENTS_DIR}/${agent}/output/${file}"
      [ -f "$fpath" ] || die "File not found: $fpath"
      cat "$fpath"
    fi
  fi
}

cmd_tasks() {
  require_jq
  local filter_agent=""
  local filter_status=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent|-a) filter_agent="$2"; shift 2 ;;
      --status|-s) filter_status="$2"; shift 2 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  header "Tasks"

  # API v1.1: server-side filtering via query params
  local api_url="/api/tasks"
  local sep="?"
  if [ -n "$filter_agent" ]; then
    api_url+="${sep}assignee=${filter_agent}"; sep="&"
  fi
  if [ -n "$filter_status" ]; then
    api_url+="${sep}status=${filter_status}"; sep="&"
  fi

  local data
  data=$(api_get "$api_url")

  local jq_filter
  jq_filter='
    if type == "array" then . else (.tasks // []) end |
    .[]
  '

  jq_filter+=' | [
    (.id | tostring),
    (.title // .name // "untitled"),
    (.status // "open"),
    (.priority // "medium"),
    (.assignee // .assigned_to // "unassigned"),
    (.due // "")
  ] | @tsv'

  local count=0
  while IFS=$'\t' read -r id title status priority assignee due; do
    printf "  [%-4s] %-35s  %-12s  %-8s  %-12s  %s\n" \
      "$id" \
      "${title:0:35}" \
      "$(format_task_status "$status")" \
      "$(format_priority "$priority")" \
      "${assignee}" \
      "${due}"
    count=$((count + 1))
  done < <(echo "$data" | jq -r "$jq_filter" 2>/dev/null)

  echo ""
  info "  $count task(s) shown"
  [ -n "$filter_agent" ] && info "  Filter: agent=$filter_agent"
  [ -n "$filter_status" ] && info "  Filter: status=$filter_status"
}

cmd_inbox() {
  local agent="${1:-}"
  [ -z "$agent" ] && die "Usage: $SCRIPT_NAME inbox <agent>"
  require_jq

  header "Inbox: $agent"
  local data
  data=$(api_get "/api/agents/$agent/inbox")

  local count
  count=$(echo "$data" | jq -r '(.messages // . | if type == "array" then length else 0 end)' 2>/dev/null || echo 0)

  if [ "$count" -eq 0 ]; then
    info "  No unread messages."
    return
  fi

  # API v1.1: inbox items are metadata-only { file, read } — no content field
  echo "$data" | jq -r '
    .messages // . |
    if type == "array" then .[] else empty end |
    "  " + (if .read == false or .read == null then "[unread] " else "[read]   " end) + (.file // .filename // "unknown")
  ' 2>/dev/null || echo "$data" | jq .
}

cmd_assign() {
  local id="${1:-}"
  local agent="${2:-}"
  [ -z "$id" ] || [ -z "$agent" ] && die "Usage: $SCRIPT_NAME assign <task-id> <agent>"
  require_jq

  local body
  body=$(printf '{"assignee":"%s","assigned_to":"%s"}' "$agent" "$agent")
  local result
  result=$(api_patch "/api/tasks/$id" "$body")
  echo "$result" | jq -r '"Task #\(.id // "'"$id"'") assigned to \(.assignee // .assigned_to // "'"$agent"'")"' 2>/dev/null \
    || ok "Task #$id assigned to $agent"
}

cmd_done() {
  local id="${1:-}"
  [ -z "$id" ] && die "Usage: $SCRIPT_NAME done <task-id>"
  require_jq

  local result
  result=$(api_patch "/api/tasks/$id" '{"status":"done"}')
  echo "$result" | jq -r '"Task #\(.id // "'"$id"'") marked as done"' 2>/dev/null \
    || ok "Task #$id marked as done"
}

cmd_claim() {
  local id="${1:-}"
  local agent="${2:-}"
  [ -z "$id" ] || [ -z "$agent" ] && die "Usage: $SCRIPT_NAME claim <task-id> <agent>"
  require_jq

  local body
  body=$(printf '{"agent":"%s"}' "$agent")
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "${BASE_URL}/api/tasks/$id/claim" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null)

  if [ "$http_code" = "200" ]; then
    ok "Task #$id claimed by $agent"
  elif [ "$http_code" = "409" ]; then
    echo -e "${YELLOW}Task #$id already claimed by another agent (409 Conflict)${RESET}"
    exit 1
  else
    die "Claim failed (HTTP $http_code)"
  fi
}

cmd_send() {
  local agent="${1:-}"
  local message="${2:-}"
  [ -z "$agent" ] || [ -z "$message" ] && die "Usage: $SCRIPT_NAME send <agent> <message>"

  # Write directly to agent's inbox (file-based, guaranteed delivery)
  local inbox_dir="${AGENTS_DIR}/${agent}/chat_inbox"
  if [ -d "$inbox_dir" ]; then
    local ts
    ts=$(date +%Y_%m_%d_%H_%M_%S)
    local fname="${inbox_dir}/${ts}_from_dev_cli.md"
    printf "# Message from dev_cli\n\n%s\n\n— Karl (Platform CLI)\n" "$message" > "$fname"
    ok "Message sent to $agent (file: $fname)"
  else
    # Fallback: API
    local body
    body=$(printf '{"message":"%s","from":"dev_cli"}' "$(echo "$message" | sed 's/"/\\"/g')")
    local result
    result=$(api_post "/api/agents/$agent/message" "$body")
    echo "$result" | jq -r '"Message sent to \(.agent // "'"$agent"'")"' 2>/dev/null \
      || ok "Message sent to $agent"
  fi
}

cmd_broadcast() {
  local message="${1:-}"
  [ -z "$message" ] && die "Usage: $SCRIPT_NAME broadcast <message>"

  # Try API broadcast endpoint first
  local body
  body=$(printf '{"message":"%s","from":"dev_cli"}' "$(echo "$message" | sed 's/"/\\"/g')")
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "${BASE_URL}/api/broadcast" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null)

  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    ok "Broadcast sent via API to all agents"
    return
  fi

  # Fallback: write directly to each agent's inbox
  header "Broadcasting to all agents..."
  local ts
  ts=$(date +%Y_%m_%d_%H_%M_%S)
  local count=0
  local failed=0

  for agent_dir in "${AGENTS_DIR}"/*/; do
    local agent
    agent=$(basename "$agent_dir")
    local inbox="${agent_dir}chat_inbox"
    if [ -d "$inbox" ]; then
      local fname="${inbox}/${ts}_from_dev_cli.md"
      printf "# Broadcast from dev_cli\n\n%s\n\n— Karl (Platform CLI)\n" "$message" > "$fname"
      ok "$agent"
      count=$((count + 1))
    else
      info "  $agent — no inbox directory"
      failed=$((failed + 1))
    fi
  done

  echo ""
  info "  Delivered: $count agents | Skipped: $failed"
}

cmd_mode() {
  local new_mode="${1:-}"
  require_jq

  if [ -z "$new_mode" ]; then
    local data
    data=$(api_get "/api/mode")
    local mode reason
    mode=$(echo "$data" | jq -r '.mode // "unknown"')
    reason=$(echo "$data" | jq -r '.reason // ""')
    echo -e "  Current mode: ${BOLD}$mode${RESET}"
    [ -n "$reason" ] && info "  Reason: $reason"
  else
    local valid_modes=("plan" "normal" "crazy" "autonomous")
    local valid=false
    for m in "${valid_modes[@]}"; do
      [ "$m" = "$new_mode" ] && valid=true && break
    done
    $valid || die "Invalid mode: $new_mode. Valid: ${valid_modes[*]}"

    local body
    body=$(printf '{"mode":"%s","who":"karl","reason":"set via dev_cli"}' "$new_mode")
    local result
    result=$(api_post "/api/mode" "$body")
    echo "$result" | jq -r '"Mode set to \(.mode // "'"$new_mode"'")"' 2>/dev/null \
      || ok "Mode set to $new_mode"
  fi
}

cmd_cost() {
  require_jq
  header "Token Spend — Today"

  local data
  data=$(api_get "/api/cost")

  echo "$data" | jq -r '
    . as $root |
    if .agents then .agents
    elif type == "object" then to_entries | map({name: .key} + .value)
    else .
    end |
    if type == "array" then
      .[] | [.name, (.today_usd // .cost_usd // .usd // 0 | tostring), (.today_tokens // .tokens // 0 | tostring)] | @tsv
    else empty
    end
  ' 2>/dev/null | sort -t$'\t' -k2 -rn | \
  while IFS=$'\t' read -r name cost tokens; do
    printf "  %-12s  $%-8s  %s tokens\n" "$name" "$cost" "$tokens"
  done

  local total
  total=$(echo "$data" | jq -r '.total_usd // .total // ""' 2>/dev/null)
  [ -n "$total" ] && echo -e "\n  ${BOLD}Total: \$$total${RESET}"
}

cmd_health() {
  require_jq
  header "Server Health"

  local data
  data=$(api_get "/api/health")
  local status uptime active
  status=$(echo "$data" | jq -r '.status // "unknown"')
  uptime=$(echo "$data" | jq -r '.uptime // .uptime_ms // "?"')
  active=$(echo "$data" | jq -r '.activeAgents // "?"')

  echo -e "  Status:        $(format_status "$status")"
  echo -e "  Uptime:        ${uptime}s"
  echo -e "  Active agents: ${active}"
  echo -e "  Server:        ${BASE_URL}"
}

cmd_watchdog() {
  require_jq
  header "Watchdog — Restarting stuck agents"

  local http_code
  http_code=$(curl -s -o /tmp/_watchdog_result.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/agents/watchdog" \
    -H "Content-Type: application/json" 2>/dev/null)

  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    cat /tmp/_watchdog_result.json | jq -r '
      (.restarted // .agents // []) |
      if length == 0 then "  No stuck agents found."
      else .[] | "  Restarted: " + (. // "unknown")
      end
    ' 2>/dev/null || cat /tmp/_watchdog_result.json
    ok "Watchdog complete"
  else
    die "Watchdog API failed (HTTP $http_code)"
  fi
}

cmd_smart_start() {
  require_jq
  header "Smart Start — launching agents with actual work"

  local http_code
  http_code=$(curl -s -o /tmp/_smartstart_result.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/agents/smart-start" \
    -H "Content-Type: application/json" \
    ${TOKENFLY_API_KEY:+-H "Authorization: Bearer ${TOKENFLY_API_KEY}"} 2>/dev/null)

  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    cat /tmp/_smartstart_result.json | jq -r '
      (.started // .agents // []) as $started |
      (.skipped // []) as $skipped |
      (if ($started|length) == 0 then "  No agents needed starting."
       else ($started[] | "  Started: " + .)
       end),
      (if ($skipped|length) > 0 then ($skipped[] | "  Skipped (idle): " + .) else empty end)
    ' 2>/dev/null || cat /tmp/_smartstart_result.json
    ok "Smart start complete"
  else
    die "Smart start API failed (HTTP $http_code)"
  fi
}

cmd_metrics() {
  require_jq
  header "System Metrics"

  local data
  data=$(curl -sf "${BASE_URL}/api/metrics" \
    ${TOKENFLY_API_KEY:+-H "Authorization: Bearer ${TOKENFLY_API_KEY}"} 2>/dev/null) \
    || die "Failed to fetch metrics (server unreachable or auth required)"

  echo "$data" | jq -r '
    to_entries[] |
    "  \(.key): \(.value)"
  ' 2>/dev/null || echo "$data"
}

cmd_ceo() {
  require_jq
  local command="$*"
  [ -z "$command" ] && die "Usage: $SCRIPT_NAME cmd <command>
  Prefixes:
    @agentname <msg>   DM directly to an agent
    task: <title>      Create unassigned medium-priority task
    /mode <name>       Switch company mode
    (anything else)    Routes to alice as CEO priority"

  header "CEO Quick Command"
  printf "  Sending: %s\n" "$command"

  local http_code
  http_code=$(curl -s -o /tmp/_ceo_cmd_result.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/ceo/command" \
    -H "Content-Type: application/json" \
    ${TOKENFLY_API_KEY:+-H "Authorization: Bearer ${TOKENFLY_API_KEY}"} \
    -d "{\"command\": $(echo "$command" | jq -Rs .)}" 2>/dev/null)

  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    cat /tmp/_ceo_cmd_result.json | jq -r '
      .message // .result // .status // "Command sent."
    ' 2>/dev/null || cat /tmp/_ceo_cmd_result.json
    ok "Command dispatched"
  else
    die "CEO command API failed (HTTP $http_code)"
  fi
}

cmd_watch() {
  local interval="${1:-10}"
  require_jq

  # Validate interval is a number
  [[ "$interval" =~ ^[0-9]+$ ]] || die "Interval must be a positive integer (seconds)"

  echo -e "${BOLD}Tokenfly Live Status${RESET} — refreshing every ${interval}s. Press Ctrl+C to stop."

  while true; do
    # Clear screen and print header
    clear
    echo -e "${BOLD}${BLUE}Tokenfly Agent Status${RESET}  $(date '+%Y-%m-%d %H:%M:%S')  ${DIM}(refresh: ${interval}s | Ctrl+C to stop)${RESET}"
    echo "─────────────────────────────────────────────────────"

    # Agent status table
    local agent_data
    agent_data=$(curl -sf "${BASE_URL}/api/agents" 2>/dev/null) || {
      echo -e "${RED}Server unreachable${RESET}"
      sleep "$interval"
      continue
    }

    echo "$agent_data" | jq -r '
      .agents // . |
      if type == "array" then .
      else to_entries | map(.value)
      end |
      .[] |
      [
        .name // "?",
        (if .alive != null then (if .alive then "active" else "offline" end) else (.status // "unknown") end),
        (.heartbeat_at // .lastHeartbeat // "—"),
        (.currentTask // "")
      ] |
      @tsv
    ' 2>/dev/null | while IFS=$'\t' read -r name status heartbeat task; do
      printf "  %-12s  " "$name"
      case "$status" in
        running|active|online) printf "${GREEN}● %-10s${RESET}" "$status" ;;
        idle)                  printf "${YELLOW}○ %-10s${RESET}" "$status" ;;
        stopped|offline|dead)  printf "${RED}✗ %-10s${RESET}" "$status" ;;
        *)                     printf "  %-10s" "$status" ;;
      esac
      [ -n "$task" ] && printf "  ${DIM}%s${RESET}" "${task:0:50}"
      echo ""
    done

    echo "─────────────────────────────────────────────────────"

    # Task summary
    local task_data
    task_data=$(curl -sf "${BASE_URL}/api/tasks" 2>/dev/null) || true
    if [ -n "$task_data" ]; then
      local open in_prog done_count
      open=$(echo "$task_data" | jq -r '[if type=="array" then .[] else (.tasks//[]|.[]) end | select(.status=="open")] | length' 2>/dev/null || echo "?")
      in_prog=$(echo "$task_data" | jq -r '[if type=="array" then .[] else (.tasks//[]|.[]) end | select(.status=="in_progress")] | length' 2>/dev/null || echo "?")
      done_count=$(echo "$task_data" | jq -r '[if type=="array" then .[] else (.tasks//[]|.[]) end | select(.status=="done")] | length' 2>/dev/null || echo "?")
      printf "  Tasks: ${CYAN}%s open${RESET}  ${YELLOW}%s in_progress${RESET}  ${GREEN}%s done${RESET}\n" "$open" "$in_prog" "$done_count"
    fi

    # Mode
    local mode_data
    mode_data=$(curl -sf "${BASE_URL}/api/mode" 2>/dev/null) || true
    if [ -n "$mode_data" ]; then
      local mode
      mode=$(echo "$mode_data" | jq -r '.mode // "?"' 2>/dev/null)
      printf "  Mode: ${BOLD}%s${RESET}\n" "$mode"
    fi

    sleep "$interval"
  done
}

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    status)    cmd_status "$@" ;;
    logs)      cmd_logs "$@" ;;
    cycles)    cmd_cycles "$@" ;;
    output)    cmd_output "$@" ;;
    tasks)     cmd_tasks "$@" ;;
    inbox)     cmd_inbox "$@" ;;
    assign)    cmd_assign "$@" ;;
    done)      cmd_done "$@" ;;
    claim)     cmd_claim "$@" ;;
    send)      cmd_send "$@" ;;
    broadcast) cmd_broadcast "$@" ;;
    mode)      cmd_mode "$@" ;;
    cost)      cmd_cost "$@" ;;
    health)    cmd_health "$@" ;;
    watchdog)    cmd_watchdog "$@" ;;
    smart-start) cmd_smart_start "$@" ;;
    metrics)     cmd_metrics "$@" ;;
    cmd)         cmd_ceo "$@" ;;
    watch)       cmd_watch "$@" ;;
    help|--help|-h) cmd_help ;;
    *)         die "Unknown command: '$cmd'. Run '$SCRIPT_NAME help' for usage." ;;
  esac
}

main "$@"
