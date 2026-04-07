#!/bin/bash
# agent_tools.sh — Helper functions for agents to use during their work cycles
# Source this in your work: source ../../scripts/agent_tools.sh
#
# Provides simple one-liner tools for common agent operations:
#   task_claim <id>              — Atomically claim a task
#   task_done <id> "result"      — Mark task done with result note
#   task_progress <id> "update"  — Update task progress note
#   task_list [assignee]         — List open/in-progress tasks
#   dm <agent> "message"         — Send a DM to another agent
#   broadcast "message"          — Send message to all agents
#   read_peer <agent>            — Read another agent's status.md
#   read_knowledge               — Read shared knowledge base
#   read_culture                 — Read consensus norms and decisions
#   my_tasks                     — Show tasks assigned to me
#   pipeline_status              — Show D004 pipeline phase status
#   log_progress "message"       — Append progress to status.md with timestamp

# Handle both bash and zsh
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [ -n "${(%):-%x}" 2>/dev/null ]; then
  SCRIPTS_DIR="$(cd "$(dirname "${(%):-%x}")" && pwd)"
else
  SCRIPTS_DIR="$(cd "$(dirname "$(git rev-parse --show-toplevel 2>/dev/null)/scripts/agent_tools.sh")" && pwd)"
fi
# Override COMPANY_DIR to ensure paths.sh resolves correctly
COMPANY_DIR="$(cd "${SCRIPTS_DIR}/.." && pwd)"
unset AGENTS_DIR SHARED_DIR PLANET_DIR  # Clear stale values before re-resolving
# Source paths.sh to get planet-aware directories
if [ -f "${COMPANY_DIR}/lib/paths.sh" ]; then
  . "${COMPANY_DIR}/lib/paths.sh"
fi
_AGENTS="${AGENTS_DIR:-${COMPANY_DIR}/agents}"
_SHARED="${SHARED_DIR:-${COMPANY_DIR}/public}"
_API="http://localhost:3199"

# Detect current agent name from working directory
_SELF=$(pwd | grep -oE 'agents/([^/]+)' | head -1 | cut -d/ -f2)
_SELF="${_SELF:-}"

# Auth header — use API_KEY env var if set (matches server.js default behavior)
_AUTH_HEADER="Authorization: Bearer ${API_KEY:-test}"

# ── Task Operations ──────────────────────────────────────────────────────────

task_claim() {
  local id="$1"
  [ -z "$id" ] && echo "Usage: task_claim <task-id>" && return 1
  local agent="${_SELF:-unknown}"
  curl -s -X POST "${_API}/api/tasks/${id}/claim" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "{\"agent\":\"${agent}\"}" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): print(f'Claimed T{d.get(\"id\",\"?\")} for ${agent}')
  else: print(f'Failed: {d.get(\"error\",\"unknown\")}')
except: print('Error parsing response')
" 2>/dev/null
}

task_done() {
  local id="$1" note="$2"
  [ -z "$id" ] && echo "Usage: task_done <task-id> [\"result note\"]" && return 1
  local body; body=$(python3 -c "import json,sys; d={'status':'done'}; d.update({'notes':sys.argv[1]}) if sys.argv[1] else None; print(json.dumps(d))" "$note")
  curl -s -X PATCH "${_API}/api/tasks/${id}" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): print(f'T{d.get(\"id\",\"?\")} marked DONE')
  else: print(f'Failed: {d.get(\"error\",\"unknown\")}')
except: print('Error parsing response')
" 2>/dev/null
}

task_progress() {
  local id="$1" note="$2"
  [ -z "$id" ] || [ -z "$note" ] && echo "Usage: task_progress <task-id> \"progress note\"" && return 1
  local body; body=$(python3 -c "import json,sys; print(json.dumps({'status':'in_progress','notes':sys.argv[1]}))" "$note")
  curl -s -X PATCH "${_API}/api/tasks/${id}" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): print(f'T{d.get(\"id\",\"?\")} updated')
  else: print(f'Failed: {d.get(\"error\",\"unknown\")}')
except: print('Error parsing response')
" 2>/dev/null
}

task_review() {
  local id="$1" verdict="$2" comment="${3:-Reviewed}"
  [ -z "$id" ] || [ -z "$verdict" ] && echo "Usage: task_review <task-id> <approve|reject> [\"comment\"]" && return 1
  local reviewer="${_SELF:-unknown}"
  local body; body=$(python3 -c "import json,sys; print(json.dumps({'verdict':sys.argv[1],'reviewer':sys.argv[2],'comment':sys.argv[3]}))" "$verdict" "$reviewer" "$comment")
  curl -s -X POST "${_API}/api/tasks/${id}/review" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): print('T' + str(d.get('id','?')) + ' reviewed')
  else: print(f'Failed: {d.get(\"error\",\"unknown\")}')
except: print('Error parsing response')
" 2>/dev/null
}

task_inreview() {
  local id="$1" note="$2"
  [ -z "$id" ] && echo "Usage: task_inreview <task-id> [\"note\"]" && return 1
  local body; body=$(python3 -c "import json,sys; d={'status':'in_review'}; d.update({'notes':sys.argv[1]}) if sys.argv[1] else None; print(json.dumps(d))" "$note")
  curl -s -X PATCH "${_API}/api/tasks/${id}" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): print(f'T{d.get(\"id\",\"?\")} marked IN_REVIEW')
  else: print(f'Failed: {d.get(\"error\",\"unknown\")}')
except: print('Error parsing response')
" 2>/dev/null
}

task_list() {
  local assignee="$1"
  curl -s "${_API}/api/tasks" -H "${_AUTH_HEADER}" 2>/dev/null | python3 -c "
import sys,json
tasks=json.load(sys.stdin)
assignee='${assignee}'.lower() if '${assignee}' else None
active=[t for t in tasks if t.get('status') in ('open','in_progress','in_review')]
if assignee: active=[t for t in active if (t.get('assignee','') or '').lower()==assignee]
if not active: print('No active tasks' + (f' for {assignee}' if assignee else '')); sys.exit()
for t in active:
  print(f'[{t[\"id\"]}] {t[\"status\"]:12s} P:{t.get(\"priority\",\"?\"):8s} {t.get(\"assignee\",\"unassigned\"):10s} {t[\"title\"][:60]}')
" 2>/dev/null
}

my_tasks() {
  [ -z "$_SELF" ] && echo "Cannot detect agent name from working directory" && return 1
  echo "Tasks for ${_SELF}:"
  task_list "$_SELF"
}

# ── Communication ────────────────────────────────────────────────────────────

dm() {
  local to="$1" msg="$2"
  [ -z "$to" ] || [ -z "$msg" ] && echo "Usage: dm <agent> \"message\"" && return 1
  local from="${_SELF:-system}"
  local ts=$(date +%Y_%m_%d_%H_%M_%S)
  local inbox="${_AGENTS}/${to}/chat_inbox"
  [ ! -d "$inbox" ] && echo "Agent '${to}' not found" && return 1
  printf "# Message from %s\n\n%s\n" "$from" "$msg" > "${inbox}/${ts}_from_${from}.md"
  echo "DM sent to ${to}"
}

broadcast() {
  local msg="$1"
  [ -z "$msg" ] && echo "Usage: broadcast \"message\"" && return 1
  local from="${_SELF:-system}"
  local ts=$(date +%Y_%m_%d_%H_%M_%S)
  local count=0
  for agent_dir in "${_AGENTS}"/*/; do
    local agent=$(basename "$agent_dir")
    [ "$agent" = "$from" ] && continue
    local inbox="${agent_dir}chat_inbox"
    [ -d "$inbox" ] && printf "# Broadcast from %s\n\n%s\n" "$from" "$msg" > "${inbox}/${ts}_from_${from}.md" && count=$((count+1))
  done
  echo "Broadcast sent to ${count} agents"
}

post() {
  # post "Milestone: Phase 1 complete — 47 markets filtered"
  local msg="$1"
  [ -z "$msg" ] && echo "Usage: post \"message\"" && return 1
  local from="${_SELF:-system}"
  local ts=$(date +%Y_%m_%d_%H_%M_%S)
  local channel="${_SHARED}/team_channel"
  mkdir -p "$channel"
  printf "# Update from %s\n\nDate: %s\n\n%s\n" "$from" "$(date +%Y-%m-%d)" "$msg" > "${channel}/${ts}_from_${from}.md"
  echo "Posted to team channel"
}

announce() {
  # announce "Sprint 4 complete — D004 pipeline validated end-to-end"
  local msg="$1"
  [ -z "$msg" ] && echo "Usage: announce \"message\"" && return 1
  local from="${_SELF:-system}"
  local ts=$(date +%Y_%m_%d_%H_%M_%S)
  local dir="${_SHARED}/announcements"
  mkdir -p "$dir"
  printf "# Announcement from %s\n\nDate: %s\n\n%s\n" "$from" "$(date +%Y-%m-%d)" "$msg" > "${dir}/${ts}_from_${from}.md"
  echo "Announcement posted"
}

create_task() {
  # create_task "Task title" assignee priority "description"
  local title="$1" assignee="${2:-}" priority="${3:-medium}" desc="${4:-}"
  [ -z "$title" ] && echo "Usage: create_task \"title\" [assignee] [priority] [\"description\"]" && return 1
  # Use Python to safely build JSON (avoids injection from special chars in title/desc)
  local body
  body=$(python3 -c "
import json, sys
d = {'title': sys.argv[1], 'priority': sys.argv[2]}
if sys.argv[3]: d['assignee'] = sys.argv[3]
if sys.argv[4]: d['description'] = sys.argv[4]
print(json.dumps(d))
" "$title" "$priority" "$assignee" "$desc")
  curl -s -X POST "${_API}/api/tasks" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('id'): print(f'Task created: T{d[\"id\"]} — {d.get(\"title\",\"\")}')
  else: print(f'Failed: {d.get(\"error\",\"unknown\")}')
except: print('Error parsing response')
" 2>/dev/null
}

read_inbox() {
  # read_inbox — show unread messages from chat_inbox
  [ -z "$_SELF" ] && echo "Cannot detect agent name" && return 1
  local inbox="${_AGENTS}/${_SELF}/chat_inbox"
  local count=0 found=0
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    found=1
    echo "--- $(basename "$f") ---"
    head -5 "$f"
    echo ""
    (( count++ ))
    [ $count -ge 20 ] && break
  done < <(find "$inbox" -maxdepth 1 -name "*.md" ! -name "read_*" ! -name "processed_*" ! -name "*.processed.md" 2>/dev/null | sort)
  [ $found -eq 0 ] && echo "No unread messages"
}

# ── Information ──────────────────────────────────────────────────────────────

read_peer() {
  local agent="$1"
  [ -z "$agent" ] && echo "Usage: read_peer <agent-name>" && return 1
  local status_file="${_AGENTS}/${agent}/status.md"
  [ ! -f "$status_file" ] && echo "Agent '${agent}' status.md not found" && return 1
  echo "=== ${agent} status ==="
  tail -30 "$status_file"
}

read_knowledge() {
  cat "${_SHARED}/knowledge.md" 2>/dev/null || echo "knowledge.md not found"
}

read_culture() {
  cat "${_SHARED}/consensus.md" 2>/dev/null || echo "consensus.md not found"
}

pipeline_status() {
  echo "=== D004 Pipeline Status (Sprint 4) ==="
  echo ""
  _check_file() {
    local label="$1" path="$2"
    if [ -f "$path" ]; then
      echo "  ✓ $label ($(wc -c < "$path" | tr -d ' ') bytes): $path"
    else
      echo "  ✗ $label MISSING: $path"
    fi
  }
  echo "Phase 1 (Market Filter — bob → mock data):"
  _check_file "mock_kalshi_markets.json" "${_AGENTS}/bob/output/mock_kalshi_markets.json"
  echo ""
  echo "Phase 1b (Market Filter — grace filters):"
  _check_file "filtered_markets.json" "${_AGENTS}/grace/output/filtered_markets.json"
  echo ""
  echo "Phase 2 (Clustering — ivan):"
  _check_file "market_clusters.json" "${_AGENTS}/ivan/output/market_clusters.json"
  echo ""
  echo "Phase 3 (Correlation — bob):"
  _check_file "correlation_pairs.json" "${_AGENTS}/bob/output/correlation_pairs.json"
  echo ""
  echo "Phase 4 (Simulation — dave):"
  _check_file "pipeline_report.md" "${_AGENTS}/dave/output/pipeline_report.md"
}

# ── Logging ──────────────────────────────────────────────────────────────────

log_progress() {
  # Writes a timestamped note to logs/progress.log — NOT status.md (C18: overwrite each cycle, never append)
  local msg="$1"
  [ -z "$msg" ] && echo "Usage: log_progress \"what you did\"" && return 1
  [ -z "$_SELF" ] && echo "Cannot detect agent name" && return 1
  local log_dir="${_AGENTS}/${_SELF}/logs"
  mkdir -p "$log_dir"
  echo "### $(date +%Y-%m-%d\ %H:%M) — ${_SELF}" >> "${log_dir}/progress.log"
  echo "$msg" >> "${log_dir}/progress.log"
  echo "" >> "${log_dir}/progress.log"
  echo "Progress logged to logs/progress.log"
}

echo "[agent_tools] Loaded for ${_SELF:-unknown}. Available: task_claim, task_done, task_inreview, task_review, task_progress, task_list, my_tasks, create_task, post, announce, dm, broadcast, read_inbox, read_peer, read_knowledge, read_culture, pipeline_status, log_progress"
