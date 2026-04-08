#!/bin/bash
# agent_tools.sh — Helper functions for agents to use during their work cycles
# Source this in your work: source ../../scripts/agent_tools.sh
#
# Provides simple one-liner tools for common agent operations:
#   task_claim <id>              — Atomically claim a task
#   task_done <id> "result"      — Mark task done with result note
#   task_inreview <id> "note"    — Mark task in_review (request approval)
#   task_review <id> approve|reject "comment" — Approve or reject a task (reviewers)
#   task_progress <id> "update"  — Update task progress note
#   task_list [assignee]         — List open/in-progress/in-review tasks
#   my_tasks                     — Show tasks assigned to me
#   read_task <id>               — Read full details of a specific task
#   create_task "title" [assignee] [priority] ["desc"] — Create a new task
#   dm <agent> "message"         — Send a DM to another agent
#   broadcast "message"          — Send message to all agents
#   post "message"               — Post milestone to team_channel
#   announce "message"           — Post civilization-wide announcement
#   read_inbox                   — Show unread messages from chat_inbox
#   inbox_done <filename>        — Mark an inbox message processed (move to processed/)
#   read_peer <agent>            — Read another agent's status.md
#   read_knowledge               — Read shared knowledge base
#   read_culture                 — Read consensus norms and decisions
#   add_culture norm|decision "text" — Append new entry to consensus.md
#   pipeline_status              — Show D004 pipeline phase status
#   log_progress "message"       — Append timestamped note to logs/progress.log
#   artifact_validate <path> ... — Validate artifact (C15/C16/C20)
#   artifact_metadata <path> <id> — Inject C20 metadata into JSON
#   handoff <agent> <id> <p> <c> — C16-compliant handoff (DM + Post)

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

read_task() {
  local id="$1"
  [ -z "$id" ] && echo "Usage: read_task <task-id>" && return 1
  curl -s "${_API}/api/tasks/${id}" -H "${_AUTH_HEADER}" 2>/dev/null | python3 -c "
import sys,json
try:
  t=json.load(sys.stdin)
  if 'error' in t: print(f'Error: {t[\"error\"]}'); sys.exit(1)
  print(f'T{t[\"id\"]}: {t[\"title\"]}')
  print(f'  Status:   {t.get(\"status\",\"?\")}')
  print(f'  Assignee: {t.get(\"assignee\",\"unassigned\")}')
  print(f'  Priority: {t.get(\"priority\",\"?\")}')
  desc=(t.get('description') or '').strip()
  if desc: print(f'  Desc:     {desc[:200]}')
  notes=(t.get('notes') or '').strip()
  if notes: print(f'  Notes:    {notes[-300:]}')
except: print('Error parsing response')
" 2>/dev/null
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

inbox_done() {
  # inbox_done <filename> — move a processed inbox message to chat_inbox/processed/
  # Usage: inbox_done 2026_04_07_12_30_from_alice.md
  local fname="$1"
  [ -z "$_SELF" ] && echo "Cannot detect agent name" && return 1
  [ -z "$fname" ] && echo "Usage: inbox_done <filename>" && return 1
  local inbox="${_AGENTS}/${_SELF}/chat_inbox"
  local src="${inbox}/${fname}"
  local dest="${inbox}/processed/${fname}"
  [ ! -f "$src" ] && echo "Message not found: $fname" && return 1
  mkdir -p "${inbox}/processed"
  mv "$src" "$dest" && echo "Moved to processed: $fname" || echo "Failed to move: $fname"
}

# ── Handoff & Artifacts (C15, C16, C20) ──────────────────────────────────────

artifact_validate() {
  # Usage: artifact_validate <file_path> [options]
  # Wraps scripts/artifact_check.js
  local path="$1"; shift
  if [ -z "$path" ]; then
    echo "Usage: artifact_validate <file_path> [--max-age hours] [--required-fields f1,f2] [--run-command cmd] [--check-metadata]"
    return 1
  fi
  node "${SCRIPTS_DIR}/artifact_check.js" "$path" "$@"
}

artifact_metadata() {
  # Usage: artifact_metadata <file_path> <task_id>
  # Injects C20 metadata into a JSON file
  local path="$1" task_id="$2"
  if [ -z "$path" ] || [ -z "$task_id" ]; then
    echo "Usage: artifact_metadata <file_path> <task_id>"
    return 1
  fi
  if [ ! -f "$path" ]; then echo "File not found: $path" && return 1; fi
  
  local agent="${_SELF:-unknown}"
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  python3 -c "
import sys, json
path, task_id, agent, ts = sys.argv[1:5]
try:
    with open(path, 'r') as f: data = json.load(f)
    if isinstance(data, dict):
        # task_id may be numeric (1040) or alphanumeric (D001) — keep as-is
        tid = int(task_id) if task_id.isdigit() else task_id
        data['metadata'] = {'task_id': tid, 'agent': agent, 'timestamp': ts}
        with open(path, 'w') as f: json.dump(data, f, indent=2)
        print(f'Metadata injected into {path}')
    else: print('JSON root is not a dictionary, skipping injection')
except Exception as e: print(f'Error injecting metadata: {e}')
" "$path" "$task_id" "$agent" "$ts"
}

handoff() {
  # Usage: handoff <target_agent> <task_id> <artifact_path> <run_command> ["notes"]
  # C16-compliant handoff message (DM + Post)
  local to="$1" task_id="$2" path="$3" cmd="$4" notes="${5:-}"
  if [ -z "$to" ] || [ -z "$task_id" ] || [ -z "$path" ] || [ -z "$cmd" ]; then
    echo "Usage: handoff <target_agent> <task_id> <artifact_path> <run_command> [\"notes\"]"
    return 1
  fi
  
  [ ! -f "$path" ] && echo "Error: Artifact not found at $path" && return 1

  local from="${_SELF:-unknown}"
  local ts=$(date +%Y-%m-%d\ %H:%M:%S)
  local msg="### Handoff: T${task_id} from ${from}
- **Artifact**: ${path}
- **Run Command**: \`${cmd}\`
- **Freshness**: ${ts}
- **Notes**: ${notes}"

  dm "$to" "$msg"
  post "HANDOFF: T${task_id} to ${to} — Artifact: ${path}"
  echo "Handoff complete. Remember to mark T${task_id} as in_review or done."
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

add_culture() {
  # Usage: add_culture norm|decision "Content text"
  # Appends a new entry to the shared culture board (consensus.md)
  local kind="$1" content="$2"
  if [ -z "$kind" ] || [ -z "$content" ]; then
    echo "Usage: add_culture norm|decision \"Content text\""
    return 1
  fi
  local api_type section
  case "$kind" in
    norm|culture) api_type="culture"; section="Core Behavioral Norms (Must Follow)" ;;
    decision) api_type="decision"; section="Strategic Decisions & Commitments" ;;
    *) api_type="culture"; section="Core Behavioral Norms (Must Follow)" ;;
  esac
  local json_content
  json_content=$(echo "$content" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))')
  curl -sf -X POST "${_API}/api/consensus/entry" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "{\"type\":\"${api_type}\",\"content\":${json_content},\"section\":\"${section}\"}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('Culture entry added: id=' + str(d.get('id','?')))" 2>/dev/null \
    || echo "Failed to add culture entry"
}

pipeline_status() {
  echo "=== D004 Pipeline Status (Sprint 10: Phase B deploy + security hardening) ==="
  echo ""
  _check_file() {
    local label="$1" path="$2"
    if [ -f "$path" ]; then
      local bytes
      bytes=$(/usr/bin/wc -c < "$path" | /usr/bin/tr -d ' ')
      echo "  ✓ $label (${bytes} bytes)"
    else
      echo "  ✗ $label MISSING: $path"
    fi
  }
  echo "Phase 1 (Market Filter — grace/bob):"
  _check_file "filtered_markets_live_fixture.json" "${PLANET_DIR:-${_AGENTS}/..}/output/grace/filtered_markets_live_fixture.json"
  _check_file "mock_kalshi_markets.json" "${_AGENTS}/bob/output/mock_kalshi_markets.json"
  echo ""
  echo "Phase 2 (Clustering — ivan):"
  _check_file "market_clusters.json" "${_AGENTS}/ivan/output/market_clusters.json"
  echo ""
  echo "Phase 3 (Correlation — bob):"
  _check_file "correlation_pairs.json" "${_AGENTS}/bob/output/correlation_pairs.json"
  _check_file "trade_signals.json" "${_AGENTS}/bob/output/trade_signals.json"
  echo ""
  echo "Phase 4 (Simulation — dave):"
  _check_file "pipeline_report.md" "${_AGENTS}/dave/output/pipeline_report.md"
  echo ""
  echo "Sprint 7 Live Pipeline Run (COMPLETE):"
  _check_file "T851 retro report (alice)" "${PLANET_DIR:-${_AGENTS}/..}/output/alice/sprint7_retro.md"
  _check_file "T852 E2E run with live fixtures (bob)" "${PLANET_DIR:-${_AGENTS}/..}/output/bob/sprint7_e2e_run.md"
  _check_file "T853 replay harness live signals (dave)" "${PLANET_DIR:-${_AGENTS}/..}/output/dave/sprint7_replay_live.md"
  echo ""
  echo "Sprint 8 Quality Tasks:"
  _check_file "T963 Phase 3 remediation (bob)" "${PLANET_DIR:-${_AGENTS}/..}/output/bob/phase3_remediation.md"
  echo ""
  echo "Blocker: T236 (Kalshi API credentials) — live trading pending"
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

echo "[agent_tools] Loaded for ${_SELF:-unknown}. Available: task_claim, task_done, task_inreview, task_review, task_progress, task_list, my_tasks, read_task, create_task, post, announce, dm, broadcast, read_inbox, inbox_done, read_peer, read_knowledge, read_culture, add_culture, pipeline_status, log_progress, artifact_validate, artifact_metadata, handoff"
