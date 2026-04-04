#!/bin/bash
# Event injector — runs in parallel with agent loops
# Injects DMs, tasks, CEO commands, culture entries on a schedule
# Usage: bash e2e_dry_run/inject_events.sh <cycle_duration_secs> <total_cycles> <log_file>

CYCLE_SECS="${1:-4}"   # approx seconds per agent cycle (dry_run_sleep + overhead)
TOTAL_CYCLES="${2:-60}"
LOG="${3:-/tmp/e2e_injector.log}"
BASE="http://localhost:3199"
AUTH="-H 'Authorization: Bearer test'"
CT="-H 'Content-Type: application/json'"

log() { echo "[$(date +%H:%M:%S)] [injector] $*" | tee -a "$LOG"; }

api_post() {
  local path="$1"; local body="$2"
  curl -sf -X POST "$BASE$path" \
    -H "Authorization: Bearer test" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null || echo '{"error":"request failed"}'
}

TOTAL_SECS=$(( TOTAL_CYCLES * CYCLE_SECS ))
log "Starting event injector. Total runtime: ~${TOTAL_SECS}s"

# Track created task IDs for later updates
TASK_IDS=()

# ── Cycle ~3: Create initial tasks ───────────────────────────────────────────
sleep $(( CYCLE_SECS * 3 ))
log "=== WAVE 1: Creating tasks ==="

r=$(api_post "/api/tasks" '{"title":"E2E: Write API rate limiter","priority":"high","assignee":"bob"}')
id=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Created task $id: E2E: Write API rate limiter → bob"
TASK_IDS+=("$id")

r=$(api_post "/api/tasks" '{"title":"E2E: QA regression pass","priority":"medium","assignee":"tina"}')
id=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Created task $id: E2E: QA regression pass → tina"
TASK_IDS+=("$id")

r=$(api_post "/api/tasks" '{"title":"E2E: Update team status report","priority":"low","assignee":"sam"}')
id=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Created task $id: E2E: Update team status report → sam"
TASK_IDS+=("$id")

# ── Cycle ~5: CEO commands ────────────────────────────────────────────────────
sleep $(( CYCLE_SECS * 2 ))
log "=== WAVE 2: CEO commands ==="

r=$(api_post "/api/ceo/command" '{"command":"@alice Please review the current sprint and flag any blockers"}')
log "CEO→alice DM: $(echo $r | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('action','?'))" 2>/dev/null)"

r=$(api_post "/api/ceo/command" '{"command":"task: E2E: Implement WebSocket reconnect logic"}')
id=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "CEO task created: $id"
TASK_IDS+=("$id")

# ── Cycle ~8: Culture update ──────────────────────────────────────────────────
sleep $(( CYCLE_SECS * 3 ))
log "=== WAVE 3: Culture update ==="

r=$(api_post "/api/consensus/entry" '{"type":"culture","content":"All PRs must have at least one reviewer before merge","author":"alice","section":"engineering"}')
eid=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Consensus entry $eid: PR review norm"

# ── Cycle ~10: Broadcast ──────────────────────────────────────────────────────
sleep $(( CYCLE_SECS * 2 ))
log "=== WAVE 4: Broadcast ==="

r=$(api_post "/api/broadcast" '{"message":"Sprint planning starts in 30 min. Please update your task status before then.","from":"ceo"}')
log "Broadcast sent: $(echo $r | python3 -c "import sys,json; d=json.load(sys.stdin); print('agents='+str(d.get('agents',0)))" 2>/dev/null)"

# ── Cycle ~13: Task status updates ───────────────────────────────────────────
sleep $(( CYCLE_SECS * 3 ))
log "=== WAVE 5: Task status updates ==="

for id in "${TASK_IDS[@]}"; do
  [ "$id" = "?" ] && continue
  r=$(curl -sf -X PATCH "$BASE/api/tasks/$id" \
    -H "Authorization: Bearer test" -H "Content-Type: application/json" \
    -d '{"status":"in_progress"}' 2>/dev/null || echo '{}')
  log "Task $id → in_progress"
done

# ── Cycle ~15: DMs to agents ──────────────────────────────────────────────────
sleep $(( CYCLE_SECS * 2 ))
log "=== WAVE 6: DMs to agents ==="

api_post "/api/agents/bob/inbox" '{"message":"Bob, the API rate limiter task is now P0. Please prioritize.","from":"alice"}' > /dev/null
log "DM → bob: rate limiter P0"

api_post "/api/agents/charlie/inbox" '{"message":"Charlie, please review bob'\''s rate limiter PR when ready.","from":"alice"}' > /dev/null
log "DM → charlie: review request"

api_post "/api/agents/sam/inbox" '{"message":"Sam, I need your velocity report before end of cycle.","from":"alice"}' > /dev/null
log "DM → sam: velocity report request"

# ── Cycle ~18: Another culture update ────────────────────────────────────────
sleep $(( CYCLE_SECS * 3 ))
log "=== WAVE 7: Second culture update ==="

r=$(api_post "/api/consensus/entry" '{"type":"decision","content":"Agents must update status.md at least once per session","author":"alice","section":"operations"}')
eid=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Consensus entry $eid: status.md update norm"

# ── Cycle ~20: CEO mode check + announcement ─────────────────────────────────
sleep $(( CYCLE_SECS * 2 ))
log "=== WAVE 8: Announcement ==="

r=$(api_post "/api/announcements" '{"title":"E2E Milestone: Cycle 20 checkpoint","body":"Great work everyone. 20 cycles completed. Continuing to cycle 60.","from":"ceo"}')
log "Announcement posted: $(echo $r | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('filename','?'))" 2>/dev/null)"

# ── Cycle ~25: More tasks ─────────────────────────────────────────────────────
sleep $(( CYCLE_SECS * 5 ))
log "=== WAVE 9: New task wave ==="

r=$(api_post "/api/tasks" '{"title":"E2E: Deploy to staging","priority":"high","assignee":"charlie"}')
id=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Created task $id: E2E: Deploy to staging → charlie"
TASK_IDS+=("$id")

r=$(api_post "/api/ceo/command" '{"command":"@tina We need a full QA sign-off before staging deploy. Can you prioritize?"}')
log "CEO→tina DM: QA sign-off"

# ── Cycle ~30: Session boundary — agents should fresh-start soon ─────────────
sleep $(( CYCLE_SECS * 5 ))
log "=== WAVE 10: Mid-run culture + CEO ==="

r=$(api_post "/api/consensus/entry" '{"type":"culture","content":"No deploys on Fridays without CEO approval","author":"alice","section":"engineering"}')
eid=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Consensus entry $eid: no Friday deploys"

r=$(api_post "/api/ceo/command" '{"command":"@alice Cycle 30 checkpoint: how is the team doing?"}')
log "CEO→alice: checkpoint DM"

# ── Cycle ~35: Task completions ───────────────────────────────────────────────
sleep $(( CYCLE_SECS * 5 ))
log "=== WAVE 11: Task completions ==="

for id in "${TASK_IDS[@]:0:2}"; do
  [ "$id" = "?" ] && continue
  curl -sf -X PATCH "$BASE/api/tasks/$id" \
    -H "Authorization: Bearer test" -H "Content-Type: application/json" \
    -d '{"status":"done"}' > /dev/null 2>&1
  log "Task $id → done"
done

# ── Cycle ~40: Final broadcast ────────────────────────────────────────────────
sleep $(( CYCLE_SECS * 5 ))
log "=== WAVE 12: Final broadcast ==="

r=$(api_post "/api/broadcast" '{"message":"E2E run completing soon. Please wrap up current tasks and update status.md.","from":"ceo"}')
log "Final broadcast sent"

# ── Cycle ~50: Cleanup ────────────────────────────────────────────────────────
sleep $(( CYCLE_SECS * 10 ))
log "=== WAVE 13: Wrap-up CEO command ==="

r=$(api_post "/api/ceo/command" '{"command":"task: E2E: Final review and retrospective"}')
id=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null)
log "Final task created: $id"
TASK_IDS+=("$id")

log "Event injection complete. All task IDs: ${TASK_IDS[*]}"
echo "${TASK_IDS[*]}" > "$(dirname "$LOG")/task_ids.txt"
