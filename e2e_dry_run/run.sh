#!/bin/bash
# E2E orchestrator — 5 agents × 60 cycles + event injection
# Usage: bash e2e_dry_run/run.sh [--cycles N]
set -e

COMPANY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS=(alice bob charlie sam tina)
CYCLES=60

# Parse optional --cycles arg
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cycles) CYCLES="$2"; shift 2 ;;
    *) shift ;;
  esac
done

CONFIG="$COMPANY_DIR/public/smart_run_config.json"
IS_DRY=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('dry_run', False))" 2>/dev/null || echo False)

# Cycle timing for event injector — dry runs: 4s/cycle, real runs: 60s/cycle estimate
if [ "$IS_DRY" = "True" ] || [ "$IS_DRY" = "true" ]; then
  DRY_SLEEP=3
  CYCLE_TOTAL=4
  # Temporarily lower dry_run_sleep for fast iteration
  ORIG_SLEEP=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('dry_run_sleep',120))" 2>/dev/null || echo 120)
  python3 -c "
import json
with open('$CONFIG') as f: c = json.load(f)
c['dry_run_sleep'] = $DRY_SLEEP
with open('$CONFIG','w') as f: json.dump(c, f, indent=2)
"
  restore_config() {
    python3 -c "
import json
with open('$CONFIG') as f: c = json.load(f)
c['dry_run_sleep'] = $ORIG_SLEEP
with open('$CONFIG','w') as f: json.dump(c, f, indent=2)
"
  }
  trap restore_config EXIT
  MODE_LABEL="DRY RUN"
else
  CYCLE_TOTAL=60  # estimate: ~60s per real kimi/claude cycle
  MODE_LABEL="REAL RUN"
fi

RUN_DIR="$COMPANY_DIR/e2e_dry_run/runs/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RUN_DIR"
LOG="$RUN_DIR/orchestrator.log"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# ── Step 1b: Log run mode ─────────────────────────────────────────────────────
log "Mode: $MODE_LABEL | Agents: ${AGENTS[*]} | Cycles: $CYCLES | Cycle estimate: ${CYCLE_TOTAL}s"

# ── Step 2: Clean agents ──────────────────────────────────────────────────────
log "Cleaning agents: ${AGENTS[*]}"
bash "$COMPANY_DIR/e2e_dry_run/clean_agents.sh" "${AGENTS[@]}" >> "$LOG" 2>&1

# ── Step 3: Save starting state ───────────────────────────────────────────────
log "Saving starting state..."
curl -sf "http://localhost:3199/api/tasks" -H "Authorization: Bearer test" \
  > "$RUN_DIR/tasks_before.json" 2>/dev/null || echo '[]' > "$RUN_DIR/tasks_before.json"
curl -sf "http://localhost:3199/api/consensus" -H "Authorization: Bearer test" \
  > "$RUN_DIR/consensus_before.json" 2>/dev/null || echo '[]' > "$RUN_DIR/consensus_before.json"

# ── Step 4: Start event injector in background ───────────────────────────────
log "Starting event injector..."
bash "$COMPANY_DIR/e2e_dry_run/inject_events.sh" \
  "$CYCLE_TOTAL" "$CYCLES" "$RUN_DIR/injector.log" &
INJECTOR_PID=$!
log "Injector PID: $INJECTOR_PID"

# ── Step 5: Run agent loops in parallel ───────────────────────────────────────
log "Starting ${#AGENTS[@]} agents × $CYCLES cycles..."

AGENT_PIDS=()
for agent in "${AGENTS[@]}"; do
  (
    out="$RUN_DIR/${agent}.log"
    echo "[$(date +%H:%M:%S)] [${agent}] Starting $CYCLES cycles" >> "$out"
    for i in $(seq 1 "$CYCLES"); do
      echo "" >> "$out"
      echo ">>> CYCLE $i / $CYCLES — $(date +%H:%M:%S) <<<" >> "$out"
      bash "$COMPANY_DIR/run_agent.sh" "$agent" >> "$out" 2>&1 || true
    done
    echo "[$(date +%H:%M:%S)] [${agent}] All $CYCLES cycles done" >> "$out"
  ) &
  AGENT_PIDS+=($!)
  log "Started $agent loop (PID $!)"
done

# ── Step 6: Wait and show progress ───────────────────────────────────────────
log "Waiting for all agents to complete..."
INTERVAL=15
while true; do
  sleep $INTERVAL
  # Count completed cycles across all agents
  total=0
  for agent in "${AGENTS[@]}"; do
    c=$(grep -c "^>>> CYCLE" "$RUN_DIR/${agent}.log" 2>/dev/null || echo 0)
    total=$(( total + c ))
    printf "  %-10s %d/%d\n" "$agent:" "$c" "$CYCLES"
  done >> "$LOG"
  echo "[$(date +%H:%M:%S)] Progress: $total / $(( ${#AGENTS[@]} * CYCLES )) cycles total" | tee -a "$LOG"

  # Check if all agent loops finished
  all_done=1
  for pid in "${AGENT_PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null && all_done=0
  done
  [ $all_done -eq 1 ] && break
done

wait "${AGENT_PIDS[@]}" 2>/dev/null || true
kill "$INJECTOR_PID" 2>/dev/null || true

# ── Step 7: Collect final state ───────────────────────────────────────────────
log "Collecting final state..."
curl -sf "http://localhost:3199/api/tasks" -H "Authorization: Bearer test" \
  > "$RUN_DIR/tasks_after.json" 2>/dev/null || echo '[]' > "$RUN_DIR/tasks_after.json"
curl -sf "http://localhost:3199/api/consensus" -H "Authorization: Bearer test" \
  > "$RUN_DIR/consensus_after.json" 2>/dev/null || echo '[]' > "$RUN_DIR/consensus_after.json"
curl -sf "http://localhost:3199/api/agents" -H "Authorization: Bearer test" \
  > "$RUN_DIR/agents_final.json" 2>/dev/null || echo '[]' > "$RUN_DIR/agents_final.json"

# ── Step 8: Print summary ─────────────────────────────────────────────────────
log ""
log "========== RUN COMPLETE =========="
log "Output dir: $RUN_DIR"
log ""
log "Cycle counts per agent:"
for agent in "${AGENTS[@]}"; do
  c=$(grep -c "^>>> CYCLE" "$RUN_DIR/${agent}.log" 2>/dev/null || echo 0)
  fresh=$(grep -c "Static prefix:" "$RUN_DIR/${agent}.log" 2>/dev/null || echo 0)
  resume=$(grep -c "Resume: " "$RUN_DIR/${agent}.log" 2>/dev/null || echo 0)
  log "  $agent: $c cycles ($fresh fresh starts, $resume resume cycles)"
done
log ""
log "Delta injections (from injector log):"
grep "=== WAVE" "$RUN_DIR/injector.log" 2>/dev/null | sed 's/^/  /' >> "$LOG"
log ""
log "Files:"
ls -lh "$RUN_DIR/"
