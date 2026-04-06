#!/bin/bash
# run_agent.sh — Run a single agent cycle with session resume + memory save
# Supports Claude Code, Kimi Code, Codex CLI, and Gemini CLI executors
#
# Session lifecycle:
#   Cycles 1..SESSION_MAX_CYCLES  → provider-specific resume/continue flags
#   Cycle SESSION_MAX_CYCLES+1    → fresh start; memory.md injected into prompt
#   memory.md is auto-saved from status.md before each session reset
#
# Env overrides:
#   SESSION_MAX_CYCLES  (default 5)  — cycles per session before reset
#   SESSION_FORCE_FRESH (1)          — force fresh start ignoring saved session
#   EXECUTOR            (claude|kimi|codex|gemini) — override executor for this run
set -e

AGENT_NAME="$1"
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${COMPANY_DIR}/lib/paths.sh" 2>/dev/null || true
AGENT_DIR="${AGENTS_DIR:-${COMPANY_DIR}/agents}/${AGENT_NAME}"

# Source executor config helper
source "${COMPANY_DIR}/lib/executor_config.sh"
source "${COMPANY_DIR}/lib/executors.sh"

# Define early so cost-cap and other pre-heartbeat paths can call it
_write_idle_heartbeat() {
    echo "status: idle" > "${AGENT_DIR}/heartbeat.md"
    echo "timestamp: $(date +%Y_%m_%d_%H_%M_%S)" >> "${AGENT_DIR}/heartbeat.md"
    echo "task: Available for assignment" >> "${AGENT_DIR}/heartbeat.md"
}

# Validate
[ -z "$AGENT_NAME" ] && echo "Usage: $0 <agent_name>" && exit 1
[ ! -d "$AGENT_DIR" ] && echo "Error: Agent dir not found: $AGENT_DIR" && exit 1

# Determine executor (env override > config > default)
EXECUTOR="${EXECUTOR:-$(get_executor "$AGENT_NAME" "$COMPANY_DIR")}"
EXECUTOR="$(echo "$EXECUTOR" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if ! executor_is_valid "$EXECUTOR"; then
    echo "[executor:${AGENT_NAME}] Invalid executor: ${EXECUTOR}"
    exit 1
fi
if ! executor_is_enabled "$EXECUTOR"; then
    echo "[executor:${AGENT_NAME}] Executor disabled by ENABLED_EXECUTORS: ${EXECUTOR}"
    exit 1
fi

# Detect dry_run early — binary check is skipped when dry_run is active
_EARLY_DRY_RUN="${DRY_RUN:-0}"
if [ "$_EARLY_DRY_RUN" != "1" ] && [ -f "${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json" ]; then
    _cfg_dry=$(jq -r '.dry_run // false' "${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json" 2>/dev/null)
    [ "$_cfg_dry" = "true" ] && _EARLY_DRY_RUN=1
fi

if [ "$_EARLY_DRY_RUN" != "1" ] && ! executor_binary_exists "$EXECUTOR"; then
    echo "[executor:${AGENT_NAME}] Missing CLI: $(executor_binary "$EXECUTOR")"
    echo "[executor:${AGENT_NAME}] Hint: $(executor_auth_hint "$EXECUTOR")"
    exit 1
fi
echo "[executor:${AGENT_NAME}] Using: ${EXECUTOR}"
if [ "$_EARLY_DRY_RUN" != "1" ]; then
    echo "[executor:${AGENT_NAME}] Auth status: $(executor_auth_status "$EXECUTOR")"
fi

# Create directories
mkdir -p "${AGENT_DIR}/logs" "${AGENT_DIR}/chat_inbox/processed" "${AGENT_DIR}/knowledge"

# ── Session management ────────────────────────────────────────────────────────
SESSION_ID_FILE=$(get_session_id_file "$AGENT_DIR" "$EXECUTOR")
SESSION_CYCLE_FILE=$(get_session_cycle_file "$AGENT_DIR" "$EXECUTOR")
# Read session_max_cycles from config (env var overrides, default 20)
SESSION_MAX_CYCLES="${SESSION_MAX_CYCLES:-}"
if [ -z "$SESSION_MAX_CYCLES" ] && [ -f "${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json" ]; then
    _cfg_cycles=$(jq -r '.session_max_cycles // 20' "${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json" 2>/dev/null)
    echo "$_cfg_cycles" | grep -qE '^[0-9]+$' && SESSION_MAX_CYCLES="$_cfg_cycles"
fi
SESSION_MAX_CYCLES="${SESSION_MAX_CYCLES:-20}"

# Read saved state (best-effort, never abort on failure)
SAVED_SESSION_ID=""
SAVED_CYCLE=0
if [ -f "$SESSION_ID_FILE" ]; then
    SAVED_SESSION_ID=$(cat "$SESSION_ID_FILE" 2>/dev/null | tr -d '[:space:]')
fi
if [ -f "$SESSION_CYCLE_FILE" ]; then
    _c=$(cat "$SESSION_CYCLE_FILE" 2>/dev/null | tr -d '[:space:]')
    echo "$_c" | grep -qE '^[0-9]+$' && SAVED_CYCLE=$_c
fi

# Decide: resume or fresh start?
USE_RESUME=0
RESUME_FLAG=""
if [ "${SESSION_FORCE_FRESH:-0}" = "1" ]; then
    echo "[session:${AGENT_NAME}] Force-fresh requested"
    rm -f "$SESSION_ID_FILE" "$SESSION_CYCLE_FILE"
elif [ -n "$SAVED_SESSION_ID" ] && [ "$SAVED_CYCLE" -lt "$SESSION_MAX_CYCLES" ]; then
    USE_RESUME=1
    # Dry run: track cycle count and compute delta, but skip actual --resume flag
    # (dry run has no real session to resume)
    if [ "$SAVED_SESSION_ID" != "dryrun" ]; then
        case "$EXECUTOR" in
            kimi)
                # kimi tracks sessions per working directory — --continue resumes the last session
                RESUME_FLAG="--continue"
                ;;
            claude)
                RESUME_FLAG="--resume $SAVED_SESSION_ID"
                ;;
            gemini)
                # Use UUID if we have a real session ID, otherwise fall back to latest.
                # UUIDs look like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (contains hyphens).
                if echo "$SAVED_SESSION_ID" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
                    RESUME_FLAG="--resume $SAVED_SESSION_ID"
                else
                    RESUME_FLAG="--resume latest"
                fi
                ;;
            codex)
                RESUME_FLAG="$SAVED_SESSION_ID"
                ;;
        esac
    fi
    echo "[session:${AGENT_NAME}] Resuming (cycle $((SAVED_CYCLE+1)))$([ "$SAVED_SESSION_ID" = "dryrun" ] && echo " [dry-run session]" || echo " ${SAVED_SESSION_ID:0:12}…")"
else
    if [ -n "$SAVED_SESSION_ID" ]; then
        echo "[session:${AGENT_NAME}] Max cycles reached (${SAVED_CYCLE}/${SESSION_MAX_CYCLES}) — saving memory, starting fresh"
        # Save memory snapshot from status.md before resetting
        # Cap to last 150 lines to prevent unbounded growth (fresh prompts stay lean)
        MEMORY_FILE="${AGENT_DIR}/memory.md"
        if [ -f "${AGENT_DIR}/status.md" ] && [ -s "${AGENT_DIR}/status.md" ]; then
            {
                echo "# Agent Memory Snapshot — ${AGENT_NAME} — $(date +%Y-%m-%dT%H:%M:%S)"
                echo ""
                echo "*(Auto-saved at session boundary. Injected into fresh sessions.)*"
                echo ""
                tail -n 150 "${AGENT_DIR}/status.md"
            } > "$MEMORY_FILE"
            echo "[session:${AGENT_NAME}] Memory saved to memory.md (capped at 150 lines)"
        fi
    fi
    rm -f "$SESSION_ID_FILE" "$SESSION_CYCLE_FILE"
    SAVED_CYCLE=0
fi

# ── Cost cap check ───────────────────────────────────────────────────────────
# Skip cycle if agent or total daily spend exceeds cap (saves tokens!)
# (skipped in dry_run mode — no real API spend occurs)
_DASHBOARD_PORT="${DASHBOARD_PORT:-3199}"
_CONFIG_FILE="${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json"
if [ "${_EARLY_DRY_RUN:-0}" != "1" ] && [ -f "$_CONFIG_FILE" ]; then
    _AGENT_CAP=$(jq -r '.per_agent_cost_cap_usd // 0' "$_CONFIG_FILE" 2>/dev/null)
    _DAILY_CAP=$(jq -r '.daily_cost_cap_usd // 0' "$_CONFIG_FILE" 2>/dev/null)
    if [ "$_AGENT_CAP" != "0" ] || [ "$_DAILY_CAP" != "0" ]; then
        _COST_JSON=$(curl -sf "http://localhost:${_DASHBOARD_PORT}/api/cost" \
            -H "Authorization: Bearer ${API_KEY:-test}" 2>/dev/null || true)
        if [ -n "$_COST_JSON" ]; then
            _AGENT_COST=$(echo "$_COST_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for a in d.get('per_agent', []):
    if a['name'] == '${AGENT_NAME}':
        print(f\"{a.get('today_usd', 0):.2f}\")
        break
else:
    print('0.00')
" 2>/dev/null)
            _TOTAL_COST=$(echo "$_COST_JSON" | jq -r '.today_usd // 0' 2>/dev/null)
            _AGENT_COST="${_AGENT_COST:-0.00}"
            _TOTAL_COST="${_TOTAL_COST:-0}"
            # Check per-agent cap
            if [ "$_AGENT_CAP" != "0" ] && python3 -c "exit(0 if float('${_AGENT_COST}') >= float('${_AGENT_CAP}') else 1)" 2>/dev/null; then
                echo "[cost-cap:${AGENT_NAME}] Agent daily spend \$${_AGENT_COST} >= cap \$${_AGENT_CAP} — STOPPING"
                _write_idle_heartbeat 2>/dev/null || true
                exit 0
            fi
            # Check total daily cap
            if [ "$_DAILY_CAP" != "0" ] && python3 -c "exit(0 if float('${_TOTAL_COST}') >= float('${_DAILY_CAP}') else 1)" 2>/dev/null; then
                echo "[cost-cap:${AGENT_NAME}] Total daily spend \$${_TOTAL_COST} >= cap \$${_DAILY_CAP} — STOPPING"
                _write_idle_heartbeat 2>/dev/null || true
                exit 0
            fi
            echo "[cost-cap:${AGENT_NAME}] Agent: \$${_AGENT_COST}/\$${_AGENT_CAP}, Total: \$${_TOTAL_COST}/\$${_DAILY_CAP}"
        fi
    fi
fi

# ── Build prompt ──────────────────────────────────────────────────────────────
PROMPT_FILE="${AGENT_DIR}/prompt.md"
PERSONA_FILE="${AGENT_DIR}/persona.md"
MEMORY_FILE="${AGENT_DIR}/memory.md"

# Count urgent (CEO/lord) messages in inbox — always surfaced in resume prompt
CEO_COUNT=$(find "${AGENT_DIR}/chat_inbox" -maxdepth 1 -name "*from_ceo*" -o -name "*from_lord*" 2>/dev/null \
    | grep -v '/processed' | wc -l | tr -d ' ')
CEO_COUNT="${CEO_COUNT:-0}"

SNAPSHOT_FILE="${AGENT_DIR}/context_snapshot.json"

if [ $USE_RESUME -eq 1 ]; then
    # Resuming — full prior context is KV-cached. Only inject what CHANGED since last snapshot.
    CURRENT_CYCLE=$((SAVED_CYCLE + 1))
    _DASHBOARD_PORT="${DASHBOARD_PORT:-3199}"
    _NEW_CTX=$(curl -sf "http://localhost:${_DASHBOARD_PORT}/api/agents/${AGENT_NAME}/context" \
        -H "Authorization: Bearer ${API_KEY:-test}" 2>/dev/null || true)
    _CYCLE_SNAPSHOT_JSON="$_NEW_CTX"

    if [ -n "$_NEW_CTX" ] && [ -f "$SNAPSHOT_FILE" ]; then
        # Compute delta: only what's new/changed since the last snapshot
        _DELTA_TMP=$(mktemp /tmp/agent_ctx_XXXXXX)
        _SNAP_TMP=$(mktemp /tmp/agent_snap_XXXXXX)
        echo "$_NEW_CTX" > "$_DELTA_TMP"
        cp "$SNAPSHOT_FILE" "$_SNAP_TMP"
        DELTA_TEXT=$(python3 - "$_SNAP_TMP" "$_DELTA_TMP" << 'PYEOF'
import sys, json

with open(sys.argv[1]) as f:
    prev = json.load(f)
with open(sys.argv[2]) as f:
    curr = json.load(f)

MAX_CEO_CHARS = 2000  # cap urgent message content to prevent token blowup

changes = []

# Mode change
if curr.get("mode") != prev.get("mode"):
    changes.append("**Mode**: {}→{}".format(prev.get("mode"), curr.get("mode")))
    sop = curr.get("sop")
    if sop:
        changes.append("**SOP**:\n" + sop)

# New urgent (CEO/lord) messages — full content, capped
prev_urgent = {m["filename"] for m in prev.get("inbox", {}).get("urgent", [])}
new_urgent = [m for m in curr.get("inbox", {}).get("urgent", []) if m["filename"] not in prev_urgent]
if new_urgent:
    changes.append("**URGENT ({})**:".format(len(new_urgent)))
    for m in new_urgent:
        body = m["content"].strip()
        if len(body) > MAX_CEO_CHARS:
            body = body[:MAX_CEO_CHARS] + "\n...[truncated]"
        changes.append("[{}]\n{}".format(m["filename"], body))

# New regular inbox messages — preview only
prev_msgs = {m["filename"] for m in prev.get("inbox", {}).get("messages", [])}
prev_urgent_f = {m["filename"] for m in prev.get("inbox", {}).get("urgent", [])}
prev_all = prev_msgs | prev_urgent_f
new_msgs = [m for m in curr.get("inbox", {}).get("messages", []) if m["filename"] not in prev_all]
if new_msgs:
    changes.append("**Inbox ({} new)**:".format(len(new_msgs)))
    for m in new_msgs:
        changes.append("  [{}] {}".format(m["filename"], m["preview"]))

# New team channel — preview only
prev_tc = {m["filename"] for m in prev.get("team_channel", [])}
new_tc = [m for m in curr.get("team_channel", []) if m["filename"] not in prev_tc]
if new_tc:
    changes.append("**Team channel ({} new)**:".format(len(new_tc)))
    for m in new_tc:
        changes.append("  [{}] {}".format(m["filename"], m["preview"]))

# New announcements — preview only
prev_ann = {m["filename"] for m in prev.get("announcements", [])}
new_ann = [m for m in curr.get("announcements", []) if m["filename"] not in prev_ann]
if new_ann:
    changes.append("**Announcements ({} new)**:".format(len(new_ann)))
    for m in new_ann:
        changes.append("  [{}] {}".format(m["filename"], m["preview"]))

# Task changes (new or status changed)
prev_tasks = {t["id"]: t for t in prev.get("tasks", [])}
curr_tasks = {t["id"]: t for t in curr.get("tasks", [])}
new_task_ids = set(curr_tasks) - set(prev_tasks)
changed_tasks = [t for tid, t in curr_tasks.items()
                 if tid in prev_tasks and t.get("status") != prev_tasks[tid].get("status")]
if new_task_ids or changed_tasks:
    changes.append("**Tasks**:")
    for tid in new_task_ids:
        t = curr_tasks[tid]
        changes.append("  +{}|{}|{}".format(t.get("id",""), t.get("title",""), t.get("status","")))
        desc = (t.get("description") or "").strip()
        if desc:
            changes.append("    Description: {}".format(desc))
    for t in changed_tasks:
        changes.append("  #{}:{}→{}".format(t.get("id",""), prev_tasks[t["id"]].get("status",""), t.get("status","")))

# Teammate status changes
prev_tm = {t["name"]: t["status"] for t in prev.get("teammates", [])}
curr_tm = {t["name"]: t["status"] for t in curr.get("teammates", [])}
tm_changes = [(n, prev_tm[n], curr_tm[n]) for n in curr_tm
              if n in prev_tm and curr_tm[n] != prev_tm[n]]
if tm_changes:
    changes.append("**Teammates**:")
    for name, old, new in tm_changes:
        changes.append("  {}:{}→{}".format(name, old, new))

# Culture / consensus changes — only new lines (not the full board)
prev_culture = (prev.get("culture") or "").strip()
curr_culture = (curr.get("culture") or "").strip()
if curr_culture != prev_culture and curr_culture:
    prev_lines = set(prev_culture.splitlines())
    new_lines = [l for l in curr_culture.splitlines() if l.strip() and l not in prev_lines]
    if new_lines:
        changes.append("**Culture (new)**:\n" + "\n".join(new_lines))

if changes:
    print("## Context Delta (changes since last cycle)")
    print("\n".join(changes))
else:
    print("")
PYEOF
)
        rm -f "$_DELTA_TMP" "$_SNAP_TMP"
        # Update snapshot for next cycle's diff
        echo "$_NEW_CTX" > "$SNAPSHOT_FILE"
    else
        # No snapshot to diff against — just report counts
        _DELTA_TEXT=""
        [ -n "$_NEW_CTX" ] && echo "$_NEW_CTX" > "$SNAPSHOT_FILE"
        DELTA_TEXT=""
    fi

    # Build resume prompt: cycle nudge + delta (empty string if nothing changed)
    CURRENT_CYCLE=$((SAVED_CYCLE + 1))
    _URGENT_NOTE=""
    [ "${CEO_COUNT}" -gt 0 ] && _URGENT_NOTE=" URGENT: ${CEO_COUNT} Founder/Lord message(s) — handle FIRST."
    _CYCLE_NOTE="Next cycle (${CURRENT_CYCLE}). Prior context is cached — trust it.${_URGENT_NOTE}"
    if [ -n "$DELTA_TEXT" ] && [ "$(echo "$DELTA_TEXT" | tr -d '[:space:]')" != "" ]; then
        PROMPT_TEXT="$(printf '%s\n\n%s' "$_CYCLE_NOTE" "$DELTA_TEXT")"
        echo "[session:${AGENT_NAME}] Resume: injecting context delta"
        echo "$DELTA_TEXT" | sed 's/^/  [delta] /'
    else
        PROMPT_TEXT="${_CYCLE_NOTE} Nothing changed — continue your current work."
        echo "[session:${AGENT_NAME}] Resume: no changes detected"
    fi
else
    # Fresh start — static prefix first (KV-cached), then dynamic context last.
    # Static prefix = persona.md + prompt.md (never changes → always hits KV cache)
    # Dynamic suffix = memory + live snapshot (changes per session → not cached, but small)
    [ -f "$PROMPT_FILE" ] || { echo "Error: prompt.md not found: $PROMPT_FILE" >&2; exit 1; }

    # Build static prefix: persona.md (identity) + prompt.md (work rules) + agent_instructions.md (shared SOPs)
    INSTRUCTIONS_FILE="${SHARED_DIR:-${COMPANY_DIR}/public}/agent_instructions.md"
    _INSTRUCTIONS=""
    if [ -f "$INSTRUCTIONS_FILE" ] && [ -s "$INSTRUCTIONS_FILE" ]; then
        _INSTRUCTIONS="$(cat "$INSTRUCTIONS_FILE")"
    fi
    if [ -f "$PERSONA_FILE" ] && [ -s "$PERSONA_FILE" ]; then
        if [ -n "$_INSTRUCTIONS" ]; then
            STATIC_PREFIX="$(printf '%s\n\n---\n\n%s\n\n---\n\n%s' "$(cat "$PERSONA_FILE")" "$(cat "$PROMPT_FILE")" "$_INSTRUCTIONS")"
            echo "[session:${AGENT_NAME}] Static prefix: persona.md + prompt.md + agent_instructions.md"
        else
            STATIC_PREFIX="$(printf '%s\n\n---\n\n%s' "$(cat "$PERSONA_FILE")" "$(cat "$PROMPT_FILE")")"
            echo "[session:${AGENT_NAME}] Static prefix: persona.md + prompt.md"
        fi
    else
        STATIC_PREFIX="$(cat "$PROMPT_FILE")"
        echo "[session:${AGENT_NAME}] Static prefix: prompt.md only (no persona.md)"
    fi

    # -- Live state snapshot via /api/agents/:name/context endpoint ---------------
    # Single API call replaces all the individual shell file reads.
    # Agents can also call this endpoint mid-session to refresh their context.
    _DASHBOARD_PORT="${DASHBOARD_PORT:-3199}"
    _CTX_JSON=$(curl -sf "http://localhost:${_DASHBOARD_PORT}/api/agents/${AGENT_NAME}/context" \
        -H "Authorization: Bearer ${API_KEY:-test}" 2>/dev/null || true)
    _CYCLE_SNAPSHOT_JSON="$_CTX_JSON"

    if [ -n "$_CTX_JSON" ]; then
        # Render JSON context into human-readable markdown for the prompt
        _CTX_TMP=$(mktemp /tmp/agent_ctx_XXXXXX)
        echo "$_CTX_JSON" > "$_CTX_TMP"
        LIVE_SNAPSHOT=$(python3 - "$_CTX_TMP" << 'PYEOF'
import sys, json

with open(sys.argv[1]) as f:
    d = json.load(f)
out = []
out.append("## Live State Snapshot (pre-aggregated via /api/agents/{}/context — do not re-read these files this cycle)".format(d.get("agent","")))
out.append("")

# Mode
out.append("**Company mode**: {}".format(d.get("mode","normal")))
out.append("")

# Urgent messages (full content)
urgent = d.get("inbox", {}).get("urgent", [])
if urgent:
    out.append("### URGENT — Founder/Lord Messages (handle FIRST)")
    for m in urgent:
        out.append("[{}]".format(m["filename"]))
        out.append(m["content"].strip())
        out.append("")

# Inbox previews
inbox = d.get("inbox", {})
total = inbox.get("total_unread", 0)
msgs = inbox.get("messages", [])
more = inbox.get("more", 0)
if total > 0:
    out.append("**Unread inbox**: {} messages{}".format(total, " (showing {})".format(len(msgs)) if more > 0 else ""))
    for m in msgs:
        out.append("  [{}] {}".format(m["filename"], m["preview"]))
else:
    out.append("**Unread inbox**: 0 messages")
out.append("")

# Tasks
tasks = d.get("tasks", [])
if tasks:
    out.append("**Your open tasks**:")
    for t in tasks:
        out.append("  | {} | {} | {} | {} |".format(t.get("id",""), t.get("title",""), t.get("priority",""), t.get("status","")))
        desc = (t.get("description") or "").strip()
        if desc:
            # Show full description for tasks with instructions (sprint pipeline tasks have detailed steps)
            out.append("    Description: {}".format(desc))
else:
    out.append("**Your open tasks**: (none assigned)")
out.append("")

# Team channel
tc = d.get("team_channel", [])
if tc:
    out.append("**Recent team channel** (last {}):".format(len(tc)))
    for m in tc:
        out.append("  [{}] {}".format(m["filename"], m["preview"]))
else:
    out.append("**Recent team channel**: (none)")
out.append("")

# Announcements
anns = d.get("announcements", [])
if anns:
    out.append("**Recent announcements** (last {}):".format(len(anns)))
    for a in anns:
        out.append("  [{}] {}".format(a["filename"], a["preview"]))
else:
    out.append("**Recent announcements**: (none)")
out.append("")

# Teammates
teammates = d.get("teammates", [])
if teammates:
    out.append("**Teammate statuses**:")
    for t in teammates:
        out.append("  - {}: {}".format(t["name"], t["status"]))
out.append("")

# Active SOP
sop = d.get("sop")
if sop:
    out.append("### Active SOP ({}_mode.md — follow this):".format(d.get("mode","normal")))
    out.append(sop)
    out.append("")

# Culture / consensus
culture = d.get("culture")
if culture:
    out.append("### Team Culture & Consensus (public/consensus.md):")
    out.append(culture)

print("\n".join(out))
PYEOF
)
        rm -f "$_CTX_TMP"
        # Save snapshot for delta diffing on subsequent resume cycles
        echo "$_CTX_JSON" > "$SNAPSHOT_FILE"
        echo "[session:${AGENT_NAME}] Live snapshot fetched from /api/agents/${AGENT_NAME}/context"
    else
        # Dashboard not available — fall back to minimal snapshot
        echo "[session:${AGENT_NAME}] Warning: dashboard unavailable, using minimal snapshot"
        LIVE_SNAPSHOT="## Live State Snapshot
- Dashboard offline — read files directly this cycle
- Inbox: check chat_inbox/ for unread messages
- Tasks: grep your name from public/task_board.md"
    fi

    # Assemble final prompt: static prefix → memory → live snapshot (dynamic content last)
    if [ -f "$MEMORY_FILE" ] && [ -s "$MEMORY_FILE" ]; then
        PROMPT_TEXT="$(printf '%s\n\n---\n## Memory Snapshot (from last session)\n\n%s\n\n---\n%s' \
            "$STATIC_PREFIX" "$(cat "$MEMORY_FILE")" "$LIVE_SNAPSHOT")"
        echo "[session:${AGENT_NAME}] Injecting memory.md + live snapshot into fresh session"
    else
        PROMPT_TEXT="$(printf '%s\n\n---\n%s' "$STATIC_PREFIX" "$LIVE_SNAPSHOT")"
        echo "[session:${AGENT_NAME}] Injecting live snapshot into fresh session (no memory.md)"
    fi
fi

# ── Settings file ─────────────────────────────────────────────────────────────
SETTINGS_FILE=$(get_settings_file "$AGENT_NAME" "$EXECUTOR")

# NOTE: Only Claude currently uses a generated settings file.
if [ "$EXECUTOR" = "claude" ]; then
    _ENV_BLOCK='"DISABLE_AUTOUPDATER": "1"'
    if [ -n "${API_KEY:-}" ]; then
        _ENV_BLOCK="${_ENV_BLOCK}, \"API_KEY\": \"${API_KEY}\""
    fi
    cat > "$SETTINGS_FILE" << SETTINGS_EOF
{
  "env": { ${_ENV_BLOCK} },
  "skipDangerousModePermissionPrompt": true,
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "bash ../../check_inbox_hook.sh", "timeout": 5 },
          { "type": "command", "command": "bash ../../check_taskboard_hook.sh", "timeout": 5 }
        ]
      }
    ]
  }
}
SETTINGS_EOF
fi

# ── Timeout setup ─────────────────────────────────────────────────────────────
TIMEOUT_CMD=""
if command -v timeout &>/dev/null; then
    TIMEOUT_CMD="timeout 1800"
elif command -v gtimeout &>/dev/null; then
    TIMEOUT_CMD="gtimeout 1800"
fi

# ── Log paths ─────────────────────────────────────────────────────────────────
TODAY=$(date +%Y_%m_%d)
DAILY_LOG="${AGENT_DIR}/logs/${TODAY}.log"
RAW_LOG="${AGENT_DIR}/logs/${TODAY}_raw.log"
TIMESTAMP=$(date +%Y_%m_%d_%H_%M_%S)

echo "" >> "$DAILY_LOG"
echo "========== CYCLE START — ${TIMESTAMP} [session:$([ $USE_RESUME -eq 1 ] && echo "RESUME" || echo "FRESH")] [executor:${EXECUTOR}] ==========" >> "$DAILY_LOG"

# ── Log what gets sent to the LLM this cycle ─────────────────────────────────
_CYCLE_LOG_DIR="${AGENT_DIR}/logs/cycles"
mkdir -p "$_CYCLE_LOG_DIR"
_ABS_CYCLE=$([ -f "$SESSION_CYCLE_FILE" ] && cat "$SESSION_CYCLE_FILE" || echo 0)
_ABS_CYCLE=$(( _ABS_CYCLE + 1 ))
_CYCLE_TYPE=$([ $USE_RESUME -eq 1 ] && echo "RESUME" || echo "FRESH")
_CYCLE_BASE=$(printf "%s/%04d_%s_%s" "$_CYCLE_LOG_DIR" "$_ABS_CYCLE" "$_CYCLE_TYPE" "$TIMESTAMP")
# prompt.txt — what gets sent/appended to the LLM this cycle
printf "=== Cycle %d [%s] %s ===\n\n%s\n" "$_ABS_CYCLE" "$_CYCLE_TYPE" "$TIMESTAMP" "$PROMPT_TEXT" > "${_CYCLE_BASE}_prompt.txt"
# snapshot.json — full context state at this cycle
[ -n "$_CYCLE_SNAPSHOT_JSON" ] && echo "$_CYCLE_SNAPSHOT_JSON" > "${_CYCLE_BASE}_snapshot.json"

# ── Update heartbeat ──────────────────────────────────────────────────────────
# Agents are expected to update heartbeat.md themselves, but the launcher
# should at least touch it so the dashboard knows the agent process started.
echo "status: running" > "${AGENT_DIR}/heartbeat.md"
echo "timestamp: $(date +%Y_%m_%d_%H_%M_%S)" >> "${AGENT_DIR}/heartbeat.md"
echo "task: Processing work cycle" >> "${AGENT_DIR}/heartbeat.md"

# Trap to ensure heartbeat is reset to idle even if script is killed (SIGTERM, SIGKILL, error)
# _write_idle_heartbeat is defined early (before cost-cap check) — just set the trap here
trap '_write_idle_heartbeat' EXIT

# ── Executor helpers ──────────────────────────────────────────────────────────
codex_stream_log() {
    python3 -u -c '
import json, sys
for raw in sys.stdin:
    raw = raw.rstrip("\n")
    if not raw:
        continue
    try:
        event = json.loads(raw)
    except Exception:
        print(raw)
        continue
    if isinstance(event, dict):
        text = event.get("text") or event.get("message") or event.get("content")
        if isinstance(text, str) and text.strip():
            print("[ASSISTANT] " + text.strip())
            continue
        etype = str(event.get("type") or event.get("event") or "").lower()
        if etype in ("result", "completed", "done", "final"):
            sid = event.get("session_id") or event.get("conversation_id") or event.get("thread_id") or "?"
            print("[DONE] session=" + str(sid))
            continue
    print(json.dumps(event, ensure_ascii=True))
'
}

gemini_stream_log() {
    python3 -u -c '
import json, sys
for raw in sys.stdin:
    raw = raw.rstrip("\n")
    if not raw:
        continue
    try:
        event = json.loads(raw)
    except Exception:
        print(raw)
        continue
    if isinstance(event, dict):
        msg = event.get("message") or event.get("text") or event.get("content")
        if isinstance(msg, str) and msg.strip():
            print("[ASSISTANT] " + msg.strip())
            continue
        etype = str(event.get("type") or "").lower()
        if etype in ("result", "final", "completed"):
            sid = event.get("sessionId") or event.get("session_id") or event.get("session") or "?"
            print("[DONE] session=" + str(sid))
            continue
    print(json.dumps(event, ensure_ascii=True))
'
}

extract_session_id() {
    local raw_log="$1"
    local executor="$2"
    case "$executor" in
        kimi)
            if grep -q 'TurnEnd\|StatusUpdate' "$raw_log" 2>/dev/null; then
                echo "kimi"
            fi
            ;;
        claude)
            jq -r 'select(.type == "result") | .session_id // ""' "$raw_log" 2>/dev/null \
                | grep -v '^$' | grep -v '^null$' | grep -v '^dryrun' | tail -1 || true
            ;;
        codex)
            jq -r '(.session_id // .conversation_id // .thread_id // .session.id // "")' "$raw_log" 2>/dev/null \
                | grep -v '^$' | grep -v '^null$' | tail -1 || true
            ;;
        gemini)
            # Gemini stores sessions in ~/.gemini/tmp/{project}/chats/session-{ts}-{uuid}.json
            # Find the newest session file written during/after this run and extract its UUID.
            # This ensures each agent resumes its OWN session, not another agent's.
            _GEMINI_PROJ=$(ls -t ~/.gemini/tmp/ 2>/dev/null | head -1)
            if [ -n "$_GEMINI_PROJ" ]; then
                _NEWEST=$(ls -t ~/.gemini/tmp/"$_GEMINI_PROJ"/chats/session-*.json 2>/dev/null | head -1)
                if [ -n "$_NEWEST" ]; then
                    _GEMINI_UUID=$(python3 -c "import json; d=json.load(open('$_NEWEST')); print(d.get('sessionId',''))" 2>/dev/null)
                    if [ -n "$_GEMINI_UUID" ]; then echo "$_GEMINI_UUID"; return; fi
                fi
            fi
            # Fallback: if session file not found but output exists, save marker
            if grep -q '"type":"message"' "$raw_log" 2>/dev/null || grep -q '"role":"assistant"' "$raw_log" 2>/dev/null; then
                echo "gemini"
            fi
            ;;
    esac
}

run_executor_cycle() {
    case "$EXECUTOR" in
        kimi)
            # shellcheck disable=SC2086
            $TIMEOUT_CMD env \
                -u CLAUDECODE \
                -u CLAUDE_CODE_ENTRYPOINT \
                -u CLAUDE_LAUNCHER_SESSION_FILE \
                -u CLAUDE_CODE_CONTAINER_ID \
                -u CLAUDE_CODE_TMPDIR \
                -u ANTHROPIC_CUSTOM_HEADERS \
                -u CODEX_INTERNAL_ORIGINATOR_OVERRIDE \
                "API_KEY=${API_KEY:-}" \
                kimi -p "$PROMPT_TEXT" \
                    -w "$AGENT_DIR" \
                    $RESUME_FLAG \
                    --no-thinking \
                    --print \
                    2>/dev/null \
                | tee -a "$RAW_LOG" \
                | python3 -u -c "
import sys, re
buf = []; in_tp = False
def extract_text_from_buf(lines):
    joined = '\n'.join(lines)
    m = re.search(r\"text=(['\\\"])(.*?)\\1\\s*\\n?\\)\", joined, re.DOTALL)
    if m:
        return m.group(2)
    for line in lines:
        m2 = re.search(r\"text=(['\\\"])(.*?)\\1\\s*\\)?\\s*\$\", line, re.DOTALL)
        if m2:
            return m2.group(2)
    return None
for line in sys.stdin:
    line = line.rstrip('\n')
    if re.match(r'^TextPart\(', line):
        in_tp = True; buf = [line]
    elif in_tp:
        buf.append(line)
        if line.strip() == ')':
            t = extract_text_from_buf(buf)
            if t is not None:
                display = t.replace('\\\\n', ' ').replace('\\\\t', ' ')
                print('[ASSISTANT] ' + display)
            in_tp = False; buf = []
    elif not re.match(r'^(TurnBegin|StepBegin|TurnEnd|StatusUpdate|ThinkPart|\s)', line) and line.strip():
        print(line)
sys.stdout.flush()
" >> "$DAILY_LOG" 2>/dev/null || true
            echo "[DONE] kimi cycle complete" >> "$DAILY_LOG"
            ;;
        claude)
            # shellcheck disable=SC2086
            $TIMEOUT_CMD env \
                -u CLAUDECODE \
                -u CLAUDE_CODE_ENTRYPOINT \
                -u CLAUDE_LAUNCHER_SESSION_FILE \
                -u CLAUDE_CODE_CONTAINER_ID \
                -u CLAUDE_CODE_TMPDIR \
                -u ANTHROPIC_CUSTOM_HEADERS \
                -u CODEX_INTERNAL_ORIGINATOR_OVERRIDE \
                claude -p "$PROMPT_TEXT" \
                    $RESUME_FLAG \
                    --output-format stream-json \
                    --verbose \
                    --dangerously-skip-permissions \
                    --max-turns 200 \
                    --settings "$SETTINGS_FILE" \
                    2>/dev/null \
                | tee -a "$RAW_LOG" \
                | jq --unbuffered -r '
                    if .type == "assistant" then
                        [.message.content[]? |
                            if .type == "text" then "[ASSISTANT] " + .text
                            elif .type == "tool_use" then
                                "[TOOL] " + .name +
                                (if .input.file_path then " " + .input.file_path
                                 elif .input.command then " $ " + (.input.command | tostring | .[0:150])
                                 elif .input.content then " (writing " + (.input.content | length | tostring) + " chars)"
                                 else "" end)
                            else empty end
                        ] | join("\n")
                    elif .type == "result" then
                        "[DONE] turns=" + (.num_turns // 0 | tostring) +
                        " cost=$" + ((.total_cost_usd // 0) * 100 | floor / 100 | tostring) +
                        " duration=" + ((.duration_ms // 0) / 1000 | tostring) + "s" +
                        " session=" + (.session_id // "?")
                    else empty end
                ' >> "$DAILY_LOG" 2>/dev/null || true
            ;;
        codex)
            # --add-dir allows writes to resources outside agent workdir (symlinks resolve outside sandbox)
            _CODEX_SHARED="${SHARED_DIR:-${COMPANY_DIR}/public}"
            _CODEX_AGENTS="${AGENTS_DIR:-${COMPANY_DIR}/agents}"
            _CODEX_OUTPUT="${OUTPUT_DIR:-${COMPANY_DIR}/output}"
            if [ $USE_RESUME -eq 1 ] && [ -n "$RESUME_FLAG" ]; then
                $TIMEOUT_CMD codex exec resume "$RESUME_FLAG" "$PROMPT_TEXT" \
                    -C "$AGENT_DIR" \
                    --add-dir "$_CODEX_SHARED" \
                    --add-dir "$_CODEX_AGENTS" \
                    --add-dir "$_CODEX_OUTPUT" \
                    --skip-git-repo-check \
                    --json \
                    2>/dev/null \
                    | tee -a "$RAW_LOG" \
                    | codex_stream_log >> "$DAILY_LOG" 2>/dev/null || true
            else
                $TIMEOUT_CMD codex exec "$PROMPT_TEXT" \
                    -C "$AGENT_DIR" \
                    --add-dir "$_CODEX_SHARED" \
                    --add-dir "$_CODEX_AGENTS" \
                    --add-dir "$_CODEX_OUTPUT" \
                    --skip-git-repo-check \
                    --json \
                    2>/dev/null \
                    | tee -a "$RAW_LOG" \
                    | codex_stream_log >> "$DAILY_LOG" 2>/dev/null || true
            fi
            ;;
        gemini)
            if [ $USE_RESUME -eq 1 ] && [ -n "$RESUME_FLAG" ]; then
                $TIMEOUT_CMD gemini --prompt "$PROMPT_TEXT" --output-format stream-json --approval-mode yolo $RESUME_FLAG 2>/dev/null \
                    | tee -a "$RAW_LOG" \
                    | gemini_stream_log >> "$DAILY_LOG" 2>/dev/null || true
            else
                $TIMEOUT_CMD gemini --prompt "$PROMPT_TEXT" --output-format stream-json --approval-mode yolo 2>/dev/null \
                    | tee -a "$RAW_LOG" \
                    | gemini_stream_log >> "$DAILY_LOG" 2>/dev/null || true
            fi
            ;;
    esac
}

# ── Run Agent ─────────────────────────────────────────────────────────────────
cd "$AGENT_DIR"

# ── Dry-run mode: skip real CLI call ─────────────────────────────────────────
# _EARLY_DRY_RUN was already resolved above (before binary check); reuse it.
_DRY_RUN="${_EARLY_DRY_RUN:-0}"

if [ "$_DRY_RUN" = "1" ]; then
    echo "[DRY RUN] ${AGENT_NAME} — skipping ${EXECUTOR} call"
    # Sleep briefly so stop commands have a window to interrupt (testable stop behavior)
    _DRY_SLEEP=$(jq -r '.dry_run_sleep // 8' "${SHARED_DIR:-${COMPANY_DIR}/public}/smart_run_config.json" 2>/dev/null)
    echo "[DRY RUN] Simulating work for ${_DRY_SLEEP}s (killable) ..."
    sleep "${_DRY_SLEEP:-8}"
    FAKE_SESSION="dryrun-$(date +%s)-${AGENT_NAME}"
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"[DRY RUN] No API call made."}]}}\n{"type":"result","num_turns":0,"total_cost_usd":0,"duration_ms":100,"session_id":"%s"}\n' \
        "$FAKE_SESSION" \
        | tee -a "$RAW_LOG" \
        | jq --unbuffered -r '
            if .type == "assistant" then "[ASSISTANT] [DRY RUN] No API call made."
            elif .type == "result" then "[DONE] turns=0 cost=$0 duration=0.1s session=dryrun"
            else empty end
        ' >> "$DAILY_LOG" 2>/dev/null || true
else
    run_executor_cycle
fi

echo "========== CYCLE END — $(date +%Y_%m_%d_%H_%M_%S) ==========" >> "$DAILY_LOG"

# ── Auto-trim status.md to prevent token bloat ────────────────────────────────
STATUS_FILE="$AGENT_DIR/status.md"
STATUS_LINES=$(wc -l < "$STATUS_FILE" 2>/dev/null | tr -d ' ')
if [ "${STATUS_LINES:-0}" -gt 200 ]; then
    head -10 "$STATUS_FILE" > "${STATUS_FILE}.trimmed"
    echo "" >> "${STATUS_FILE}.trimmed"
    echo "## [Old cycles trimmed to save tokens — see logs/ for history]" >> "${STATUS_FILE}.trimmed"
    echo "" >> "${STATUS_FILE}.trimmed"
    tail -120 "$STATUS_FILE" >> "${STATUS_FILE}.trimmed"
    mv "${STATUS_FILE}.trimmed" "$STATUS_FILE"
    echo "[trim] ${AGENT_NAME}: status.md trimmed from ${STATUS_LINES} to ~135 lines"
fi

# ── Update heartbeat (idle) ───────────────────────────────────────────────────
echo "status: idle" > "$AGENT_DIR/heartbeat.md"
echo "timestamp: $(date +%Y_%m_%d_%H_%M_%S)" >> "$AGENT_DIR/heartbeat.md"
echo "task: Available for assignment" >> "$AGENT_DIR/heartbeat.md"

# ── Extract and save session ID ───────────────────────────────────────────────
# Dry run: use "dryrun" marker to track cycle count and enable delta computation.
# Real session IDs are never saved in dry run (they don't exist).
NEW_SESSION_ID=""
if [ "$_DRY_RUN" = "1" ]; then
    NEW_SESSION_ID="dryrun"
elif [ "$EXECUTOR" = "kimi" ]; then
    # kimi uses --continue for resume (no explicit session ID needed).
    # Save "kimi" marker if the cycle succeeded (TurnEnd or StatusUpdate in text output).
    if grep -q 'TurnEnd\|StatusUpdate' "$RAW_LOG" 2>/dev/null; then
        NEW_SESSION_ID="kimi"
    else
        # kimi produced no output — likely --continue failed (session expired/missing in workdir).
        # Reset session so next cycle starts fresh (without --continue) instead of looping.
        rm -f "$SESSION_ID_FILE" "$SESSION_CYCLE_FILE"
        echo "[session:${AGENT_NAME}] kimi session reset (no output detected — stale --continue)"
    fi
else
    NEW_SESSION_ID="$(extract_session_id "$RAW_LOG" "$EXECUTOR")"
fi

if [ -n "$NEW_SESSION_ID" ]; then
    echo "$NEW_SESSION_ID" > "$SESSION_ID_FILE"
    NEW_CYCLE=$((SAVED_CYCLE + 1))
    echo "$NEW_CYCLE" > "$SESSION_CYCLE_FILE"
    echo "[session:${AGENT_NAME}] Saved session ${NEW_SESSION_ID:0:12}… (cycle ${NEW_CYCLE}/${SESSION_MAX_CYCLES}) [executor:${EXECUTOR}]"

    # Pre-emptively save memory if this was the last cycle of the session
    # Cap to last 150 lines — fresh start prompts must stay lean for KV cache efficiency
    if [ "$NEW_CYCLE" -ge "$SESSION_MAX_CYCLES" ]; then
        echo "[session:${AGENT_NAME}] Last cycle in session — saving memory now (capped at 150 lines)"
        if [ -f "${AGENT_DIR}/status.md" ] && [ -s "${AGENT_DIR}/status.md" ]; then
            {
                echo "# Agent Memory Snapshot — ${AGENT_NAME} — $(date +%Y-%m-%dT%H:%M:%S)"
                echo ""
                echo "*(Auto-saved at session boundary. Will be injected into the next fresh session.)*"
                echo ""
                tail -n 150 "${AGENT_DIR}/status.md"
            } > "$MEMORY_FILE"
        fi
    fi
fi

# ── Cycle success check ───────────────────────────────────────────────────────
# Detect failed cycles (no output, errors) and log for monitoring
_CYCLE_SUCCESS=1
_RAW_SIZE=$(wc -c < "$RAW_LOG" 2>/dev/null | tr -d ' ')
if [ -z "$NEW_SESSION_ID" ] && [ "$_DRY_RUN" != "1" ]; then
    _CYCLE_SUCCESS=0
    echo "[WARN] ${AGENT_NAME}: cycle produced no session ID — LLM call may have failed" | tee -a "$DAILY_LOG"
    echo "[WARN] Raw log size: ${_RAW_SIZE:-0} bytes"
fi
if [ "${_RAW_SIZE:-0}" -lt 50 ] && [ "$_DRY_RUN" != "1" ]; then
    _CYCLE_SUCCESS=0
    echo "[WARN] ${AGENT_NAME}: raw output too small (${_RAW_SIZE} bytes) — likely failed" | tee -a "$DAILY_LOG"
fi
if [ "$_CYCLE_SUCCESS" -eq 0 ]; then
    # Write failure marker for watchdog/monitoring
    echo "$(date +%Y-%m-%dT%H:%M:%S) FAIL executor=${EXECUTOR} raw_bytes=${_RAW_SIZE:-0}" >> "${AGENT_DIR}/logs/cycle_failures.log"
    echo "[WARN] Failure logged to logs/cycle_failures.log. Watchdog or next smart_run will retry."
fi

# ── Dump last context ─────────────────────────────────────────────────────────
{
    echo "# Last Cycle Context — ${AGENT_NAME} — $(date +%Y_%m_%d_%H_%M_%S)"
    echo "# Executor: ${EXECUTOR}"
    echo "# Session: $(cat "$SESSION_ID_FILE" 2>/dev/null | head -c 12)… cycle $((SAVED_CYCLE+1))/${SESSION_MAX_CYCLES}"
    echo ""
    cat "$RAW_LOG" 2>/dev/null | jq -r --arg start_time "$(date +%Y-%m-%dT%H:%M:%S)" '
        # Handle Claude/Kimi JSON plus broader structured executor output
        # Add timestamps using input_line_number as a proxy for sequence
        ((if .type == "assistant" then .message.content
          elif .role == "assistant" then .content
          elif (.content | type?) == "array" then .content
          else null end) // [])[]? |
        ("
[--- Entry ---]
" + if .type == "text" then .text
        elif .type == "think" then "[Thinking] " + .think
        elif .type == "tool_use" then
            "**[Tool: " + .name + "]**\n" +
            (if .input.file_path then "  file: " + .input.file_path
             elif .input.command then "  cmd: " + (.input.command | tostring | .[0:300])
             else (.input | tostring | .[0:200]) end)
        else empty end)
    ' 2>/dev/null | awk 'NF || printed {printed=1; print}'
} > "${AGENT_DIR}/last_context.md" 2>/dev/null || true
