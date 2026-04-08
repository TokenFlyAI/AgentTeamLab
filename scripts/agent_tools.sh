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
#   create_task "title" [assignee] [priority] ["desc"] [type] — Create a new task (type: task|direction|instruction)
#   create_direction "title" ["desc"]  — Create a Direction task (D-prefix, long-term goal)
#   create_instruction "title" ["desc"] — Create an Instruction task (I-prefix, persistent context)
#   dm <agent> "message"         — Send a DM to another agent
#   broadcast "message"          — Send message to all agents
#   post "message"               — Post milestone to team_channel
#   announce "message"           — Post civilization-wide announcement
#   read_inbox                   — Show unread messages from chat_inbox
#   inbox_done <filename>        — Mark an inbox message processed (move to processed/)
#   read_peer <agent>            — Read another agent's status.md
#   list_outputs [agent]         — List output files for an agent (C23: self-unblock)
#   read_channel [n]             — Read last N team_channel posts (default 10)
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

# Normalize task ID: strip T prefix for numeric tasks (T1234 → 1234, D001 stays D001)
_norm_task_id() {
  local id="$1"
  # Strip leading T if followed only by digits (display prefix, not a real prefix)
  echo "$id" | sed -E 's/^T([0-9]+)$/\1/'
}

task_claim() {
  local id; id=$(_norm_task_id "$1")
  [ -z "$id" ] && echo "Usage: task_claim <task-id>" && return 1
  local agent="${_SELF:-unknown}"
  curl -s -X POST "${_API}/api/tasks/${id}/claim" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "{\"agent\":\"${agent}\"}" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): tid=str(d.get('id','?')); print(('T'+tid if tid.isdigit() else tid) + ' claimed for ${agent}')
  else: print('Failed: ' + d.get('error','unknown'))
except: print('Error parsing response')
" 2>/dev/null
}

task_done() {
  local id; id=$(_norm_task_id "$1"); local note="$2"
  [ -z "$id" ] && echo "Usage: task_done <task-id> [\"result note\"]" && return 1
  local body; body=$(python3 -c "import json,sys; d={'status':'done'}; d.update({'notes':sys.argv[1]}) if sys.argv[1] else None; print(json.dumps(d))" "$note")
  curl -s -X PATCH "${_API}/api/tasks/${id}" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): tid=str(d.get('id','?')); print(('T'+tid if tid.isdigit() else tid) + ' marked DONE')
  else: print('Failed: ' + d.get('error','unknown'))
except: print('Error parsing response')
" 2>/dev/null
}

task_progress() {
  local id; id=$(_norm_task_id "$1"); local note="$2"
  [ -z "$id" ] || [ -z "$note" ] && echo "Usage: task_progress <task-id> \"progress note\"" && return 1
  local body; body=$(python3 -c "import json,sys; print(json.dumps({'status':'in_progress','notes':sys.argv[1]}))" "$note")
  curl -s -X PATCH "${_API}/api/tasks/${id}" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): tid=str(d.get('id','?')); print(('T'+tid if tid.isdigit() else tid) + ' updated')
  else: print('Failed: ' + d.get('error','unknown'))
except: print('Error parsing response')
" 2>/dev/null
}

task_review() {
  local id; id=$(_norm_task_id "$1"); local verdict="$2" comment="${3:-Reviewed}"
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
  if d.get('ok'): tid=str(d.get('id','?')); print(('T'+tid if tid.isdigit() else tid) + ' reviewed')
  else: print('Failed: ' + d.get('error','unknown'))
except: print('Error parsing response')
" 2>/dev/null
}

task_inreview() {
  local id; id=$(_norm_task_id "$1"); local note="$2"
  [ -z "$id" ] && echo "Usage: task_inreview <task-id> [\"note\"]" && return 1
  local body; body=$(python3 -c "import json,sys; d={'status':'in_review'}; d.update({'notes':sys.argv[1]}) if sys.argv[1] else None; print(json.dumps(d))" "$note")
  curl -s -X PATCH "${_API}/api/tasks/${id}" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('ok'): tid=str(d.get('id','?')); print(('T'+tid if tid.isdigit() else tid) + ' marked IN_REVIEW')
  else: print('Failed: ' + d.get('error','unknown'))
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
if assignee: active=[t for t in active if assignee in [a.strip() for a in (t.get('assignee','') or '').lower().split(',')]]
if not active: print('No active tasks' + (f' for {assignee}' if assignee else '')); sys.exit()
for t in active:
  tid=str(t['id']); tid_display='T'+tid if tid.isdigit() else tid
  print(f'[{tid_display}] {t[\"status\"]:12s} P:{t.get(\"priority\",\"?\"):8s} {t.get(\"assignee\",\"unassigned\"):10s} {t[\"title\"][:60]}')
" 2>/dev/null
}

my_tasks() {
  [ -z "$_SELF" ] && echo "Cannot detect agent name from working directory" && return 1
  echo "Tasks for ${_SELF}:"
  task_list "$_SELF"
}

read_task() {
  local id; id=$(_norm_task_id "$1")
  [ -z "$id" ] && echo "Usage: read_task <task-id>" && return 1
  curl -s "${_API}/api/tasks/${id}" -H "${_AUTH_HEADER}" 2>/dev/null | python3 -c "
import sys,json
try:
  t=json.load(sys.stdin)
  if 'error' in t: print('Error: ' + t['error']); sys.exit(1)
  tid=str(t['id']); tdsp=('T'+tid if tid.isdigit() else tid)
  print(tdsp + ': ' + t.get('title',''))
  print('  Status:   ' + t.get('status','?'))
  print('  Assignee: ' + t.get('assignee','unassigned'))
  print('  Priority: ' + t.get('priority','?'))
  desc=(t.get('description') or '').strip()
  if desc: print('  Desc:     ' + desc[:200])
  notes=(t.get('notes') or '').strip()
  if notes: print('  Notes:    ' + notes[-300:])
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
  # Append PID suffix to prevent filename collision when multiple DMs sent in same second
  local outfile="${inbox}/${ts}_from_${from}.md"
  [ -f "$outfile" ] && outfile="${inbox}/${ts}_from_${from}_$$.md"
  printf "# Message from %s\n\n%s\n" "$from" "$msg" > "$outfile"
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
  local outfile="${channel}/${ts}_from_${from}.md"
  [ -f "$outfile" ] && outfile="${channel}/${ts}_from_${from}_$$.md"
  printf "# Update from %s\n\nDate: %s\n\n%s\n" "$from" "$(date +%Y-%m-%d)" "$msg" > "$outfile"
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
  # create_task "Task title" [assignee] [priority] ["description"] [task_type]
  # task_type: "task" (default), "direction" (D-prefix), "instruction" (I-prefix)
  local title="$1" assignee="${2:-}" priority="${3:-medium}" desc="${4:-}" task_type="${5:-task}"
  [ -z "$title" ] && echo "Usage: create_task \"title\" [assignee] [priority] [\"description\"] [task|direction|instruction]" && return 1
  # Use Python to safely build JSON (avoids injection from special chars in title/desc)
  local body
  body=$(python3 -c "
import json, sys
d = {'title': sys.argv[1], 'priority': sys.argv[2], 'task_type': sys.argv[5]}
if sys.argv[3]: d['assignee'] = sys.argv[3]
if sys.argv[4]: d['description'] = sys.argv[4]
print(json.dumps(d))
" "$title" "$priority" "$assignee" "$desc" "$task_type")
  curl -s -X POST "${_API}/api/tasks" \
    -H "Content-Type: application/json" \
    -H "${_AUTH_HEADER}" \
    -d "$body" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if d.get('id'):
    tid=str(d['id'])
    tdisplay='T'+tid if tid.isdigit() else tid
    print('Task created: '+tdisplay+' -- '+d.get('title',''))
  else: print('Failed: '+d.get('error','unknown'))
except: print('Error parsing response')
" 2>/dev/null
}

create_direction() {
  # create_direction "title" ["description"] — Create a long-term Direction task (D-prefix)
  local title="$1" desc="${2:-}"
  [ -z "$title" ] && echo "Usage: create_direction \"title\" [\"description\"]" && return 1
  create_task "$title" "" "high" "$desc" "direction"
}

create_instruction() {
  # create_instruction "title" ["description"] — Create a persistent Instruction task (I-prefix)
  local title="$1" desc="${2:-}"
  [ -z "$title" ] && echo "Usage: create_instruction \"title\" [\"description\"]" && return 1
  create_task "$title" "" "high" "$desc" "instruction"
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
    head -30 "$f"
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
  # C13/C16-compliant handoff: DM + Post + auto in_review + C20 metadata check
  local to="$1" task_id="$2" path="$3" cmd="$4" notes="${5:-}"
  if [ -z "$to" ] || [ -z "$task_id" ] || [ -z "$path" ] || [ -z "$cmd" ]; then
    echo "Usage: handoff <target_agent> <task_id> <artifact_path> <run_command> [\"notes\"]"
    return 1
  fi

  [ ! -f "$path" ] && echo "Error: Artifact not found at $path" && return 1

  # C20: warn if JSON artifact is missing metadata
  if [[ "$path" == *.json ]]; then
    if ! grep -q '"metadata"' "$path" 2>/dev/null || ! grep -q '"task_id"' "$path" 2>/dev/null; then
      echo "Warning: $path is missing C20 metadata. Run: artifact_metadata $path $task_id"
    fi
  fi

  local from="${_SELF:-unknown}"
  # Use file modification time as freshness marker (more accurate than call time)
  local freshness; freshness=$(date -r "$path" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)
  # Prefix numeric IDs with T; leave D/I prefix IDs as-is
  local task_display; task_display=$(echo "$task_id" | python3 -c "import sys; s=sys.stdin.read().strip(); print('T'+s if s.isdigit() else s)")
  local msg="### Handoff: ${task_display} from ${from}
- **Artifact**: ${path}
- **Run Command**: \`${cmd}\`
- **Freshness**: ${freshness}
- **Notes**: ${notes}"

  dm "$to" "$msg"
  post "HANDOFF: ${task_display} to ${to} — Artifact: ${path}"
  task_inreview "$task_id" "Handoff to ${to}: ${path} (C16)"
  echo "Handoff complete: ${task_display} → in_review, DM sent to ${to}."
}

check_handoff() {
  # Usage: check_handoff <artifact_path>
  # Convenience for receiving agents to verify an incoming handoff artifact (C15/C16/C20)
  local path="$1"
  [ -z "$path" ] && echo "Usage: check_handoff <artifact_path>" && return 1
  artifact_validate "$path" --check-metadata
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

list_outputs() {
  # list_outputs [agent] — list deliverable files in an agent's output/ dir (default: self)
  # C23: use this to self-unblock before DMing a teammate asking for a file
  local agent="${1:-${_SELF:-}}"
  [ -z "$agent" ] && echo "Usage: list_outputs <agent-name>" && return 1
  local out_dir="${_AGENTS}/${agent}/output"
  [ ! -d "$out_dir" ] && echo "No output dir for agent: ${agent}" && return 1
  echo "=== ${agent} output/ ==="
  ls -lh "${out_dir}/" 2>/dev/null | tail -n +2
}

read_channel() {
  # read_channel [n] — read last N team_channel posts (default 10, max 50)
  # Use this to stay informed about what teammates have posted
  local n="${1:-10}"
  [ "$n" -gt 50 ] 2>/dev/null && n=50
  local channel="${_SHARED}/team_channel"
  [ ! -d "$channel" ] && echo "team_channel directory not found" && return 1
  local count=0
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    echo "--- $(basename "$f") ---"
    head -10 "$f"
    echo ""
    count=$((count+1))
    [ $count -ge "$n" ] && break
  done < <(ls -t "$channel"/*.md 2>/dev/null | head -"$n")
  [ $count -eq 0 ] && echo "No team_channel posts found"
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
    norm|culture) api_type="norm"; section="Core Behavioral Norms (Must Follow)" ;;
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
  echo "=== D004 Pipeline Status ==="
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
  _check_file "filtered_markets_live_fixture.json" "${_AGENTS}/grace/output/filtered_markets_live_fixture.json"
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

echo "[agent_tools] Loaded for ${_SELF:-unknown}. Available: task_claim, task_done, task_inreview, task_review, task_progress, task_list, my_tasks, read_task, create_task, create_direction, create_instruction, post, announce, dm, broadcast, read_inbox, inbox_done, read_peer, list_outputs, read_channel, read_knowledge, read_culture, add_culture, pipeline_status, log_progress, artifact_validate, artifact_metadata, handoff, check_handoff"
