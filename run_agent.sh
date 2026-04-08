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
#   SESSION_MAX_CYCLES  (default 20) — cycles per session before reset
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
            # Use jq for JSON parsing (faster than spawning Python)
            _AGENT_COST=$(echo "$_COST_JSON" | jq -r --arg n "${AGENT_NAME}" '.per_agent[]? | select(.name == $n) | .today_usd // 0' 2>/dev/null | head -1)
            _TOTAL_COST=$(echo "$_COST_JSON" | jq -r '.today_usd // 0' 2>/dev/null)
            _AGENT_COST="${_AGENT_COST:-0}"
            _TOTAL_COST="${_TOTAL_COST:-0}"
            # Use awk for float comparison (no Python subprocess needed)
            if [ "$_AGENT_CAP" != "0" ] && awk "BEGIN{exit (!(${_AGENT_COST} >= ${_AGENT_CAP}))}" 2>/dev/null; then
                echo "[cost-cap:${AGENT_NAME}] Agent daily spend \$${_AGENT_COST} >= cap \$${_AGENT_CAP} — STOPPING"
                _write_idle_heartbeat 2>/dev/null || true
                exit 0
            fi
            # Check total daily cap
            if [ "$_DAILY_CAP" != "0" ] && awk "BEGIN{exit (!(${_TOTAL_COST} >= ${_DAILY_CAP}))}" 2>/dev/null; then
                echo "[cost-cap:${AGENT_NAME}] Total daily spend \$${_TOTAL_COST} >= cap \$${_DAILY_CAP} — STOPPING"
                _write_idle_heartbeat 2>/dev/null || true
                exit 0
            fi
            echo "[cost-cap:${AGENT_NAME}] Agent: \$${_AGENT_COST}/\$${_AGENT_CAP}, Total: \$${_TOTAL_COST}/\$${_DAILY_CAP}"
        fi
    fi
fi

# ── Build prompt ──────────────────────────────────────────────────────────────
# persona.md is the single agent identity file (merged identity + role context)
# prompt.md is kept as a legacy fallback but persona.md takes precedence
PERSONA_FILE="${AGENT_DIR}/persona.md"
PROMPT_FILE="${AGENT_DIR}/prompt.md"
MEMORY_FILE="${AGENT_DIR}/memory.md"

# Count urgent (CEO/lord) messages in inbox — always surfaced in resume prompt
CEO_COUNT=$(find "${AGENT_DIR}/chat_inbox" -maxdepth 1 \( -name "*from_ceo*" -o -name "*from_lord*" \) 2>/dev/null \
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
        DELTA_TEXT=$(python3 - "$_SNAP_TMP" "$_DELTA_TMP" 2>/dev/null << 'PYEOF'
import sys, json, re

with open(sys.argv[1]) as f:
    prev = json.load(f)
with open(sys.argv[2]) as f:
    curr = json.load(f)

MAX_CEO_CHARS = 2000  # cap urgent message content to prevent token blowup

def sender_from_filename(fn):
    """Extract readable sender name from inbox filename like 2026_04_07_12_30_from_alice.md"""
    m = re.search(r'from_(\w+)', fn)
    return m.group(1).capitalize() if m else fn

lines = []

# Mode change
if curr.get("mode") != prev.get("mode"):
    lines.append("The company switched to **{}** mode (was: {}).".format(
        curr.get("mode"), prev.get("mode")))
    sop = curr.get("sop")
    if sop:
        lines.append("New SOP:\n" + sop)

# New urgent (CEO/lord) messages — full content, capped
prev_urgent = {m["filename"] for m in prev.get("inbox", {}).get("urgent", [])}
new_urgent = [m for m in curr.get("inbox", {}).get("urgent", []) if m["filename"] not in prev_urgent]
if new_urgent:
    lines.append("⚠️ **URGENT — Founder/Lord message{}**:".format("s" if len(new_urgent) > 1 else ""))
    for m in new_urgent:
        body = m["content"].strip()
        if len(body) > MAX_CEO_CHARS:
            body = body[:MAX_CEO_CHARS] + "\n...[truncated]"
        lines.append(body)

# New regular inbox messages — preview only
prev_msgs = {m["filename"] for m in prev.get("inbox", {}).get("messages", [])}
prev_urgent_f = {m["filename"] for m in prev.get("inbox", {}).get("urgent", [])}
prev_all = prev_msgs | prev_urgent_f
new_msgs = [m for m in curr.get("inbox", {}).get("messages", []) if m["filename"] not in prev_all]
if new_msgs:
    if len(new_msgs) == 1:
        m = new_msgs[0]
        lines.append("{} sent you a message: \"{}\"".format(
            sender_from_filename(m["filename"]), m["preview"]))
    else:
        lines.append("You have {} new messages:".format(len(new_msgs)))
        for m in new_msgs:
            lines.append("  - {}: \"{}\"".format(
                sender_from_filename(m["filename"]), m["preview"]))

# New team channel — preview only
prev_tc = {m["filename"] for m in prev.get("team_channel", [])}
new_tc = [m for m in curr.get("team_channel", []) if m["filename"] not in prev_tc]
if new_tc:
    if len(new_tc) == 1:
        m = new_tc[0]
        lines.append("{} posted to team channel: \"{}\"".format(
            sender_from_filename(m["filename"]), m["preview"]))
    else:
        lines.append("Team channel ({} new posts):".format(len(new_tc)))
        for m in new_tc:
            lines.append("  - {}: \"{}\"".format(
                sender_from_filename(m["filename"]), m["preview"]))

# New announcements — preview only
prev_ann = {m["filename"] for m in prev.get("announcements", [])}
new_ann = [m for m in curr.get("announcements", []) if m["filename"] not in prev_ann]
if new_ann:
    for m in new_ann:
        lines.append("New announcement from {}: \"{}\"".format(
            sender_from_filename(m["filename"]), m["preview"]))

# Task changes (new or status changed)
prev_tasks = {t["id"]: t for t in prev.get("tasks", [])}
curr_tasks = {t["id"]: t for t in curr.get("tasks", [])}
new_task_ids = set(curr_tasks) - set(prev_tasks)
changed_tasks = [t for tid, t in curr_tasks.items()
                 if tid in prev_tasks and t.get("status") != prev_tasks[tid].get("status")]
for tid in new_task_ids:
    t = curr_tasks[tid]
    desc = (t.get("description") or "").strip()
    if desc:
        lines.append("New task assigned to you — T{}: \"{}\" ({})\n  {}".format(
            t.get("id",""), t.get("title",""), t.get("status",""), desc))
    else:
        lines.append("New task assigned to you — T{}: \"{}\" ({})".format(
            t.get("id",""), t.get("title",""), t.get("status","")))
for t in changed_tasks:
    old_s = prev_tasks[t["id"]].get("status","")
    new_s = t.get("status","")
    lines.append("T{} ({}) moved: {} → {}".format(t.get("id",""), t.get("title",""), old_s, new_s))

# New tasks pending review (for reviewer agents — tina/olivia/alice)
prev_pr = {t["id"]: t for t in prev.get("pending_review", [])}
curr_pr = {t["id"]: t for t in curr.get("pending_review", [])}
new_pr_ids = set(curr_pr) - set(prev_pr)
for tid in new_pr_ids:
    t = curr_pr[tid]
    notes = (t.get("notes") or "").strip()
    # Extract the last note line (most recent progress update)
    last_note = notes.split(";;")[-1].strip()[:120] if notes else ""
    note_suffix = " — note: {}".format(last_note) if last_note else ""
    lines.append("T{} ({}) is now in_review — assigned to {}, awaiting your review.{}".format(
        t.get("id",""), t.get("title",""), t.get("assignee",""), note_suffix))
# Also notify when a pending_review task is resolved (approved/rejected)
removed_pr_ids = set(prev_pr) - set(curr_pr)
for tid in removed_pr_ids:
    t = prev_pr[tid]
    lines.append("T{} ({}) is no longer in_review — resolved or reassigned.".format(
        t.get("id",""), t.get("title","")))

# Teammate status changes
prev_tm = {t["name"]: t["status"] for t in prev.get("teammates", [])}
curr_tm = {t["name"]: t["status"] for t in curr.get("teammates", [])}
tm_changes = [(n, prev_tm[n], curr_tm[n]) for n in curr_tm
              if n in prev_tm and curr_tm[n] != prev_tm[n]]
for name, old, new_s in tm_changes:
    if new_s == "idle":
        lines.append("{} is now idle (was: {}) — available for new work.".format(
            name.capitalize(), old))
    elif new_s in ("working", "running"):
        lines.append("{} started working (was: {}).".format(name.capitalize(), old))
    else:
        lines.append("{}: {} → {}.".format(name.capitalize(), old, new_s))

# Culture / consensus changes — only new lines (not the full board)
prev_culture = (prev.get("culture") or "").strip()
curr_culture = (curr.get("culture") or "").strip()
if curr_culture != prev_culture and curr_culture:
    prev_lines = set(prev_culture.splitlines())
    new_lines = [l for l in curr_culture.splitlines() if l.strip() and l not in prev_lines]
    if new_lines:
        lines.append("Culture updated:\n" + "\n".join(new_lines))

if lines:
    print("---")
    print("\n".join(lines))
else:
    print("")
PYEOF
) || {
            # Delta computation failed (e.g., corrupted snapshot JSON) — reset snapshot
            echo "[warn:${AGENT_NAME}] Context delta failed — resetting snapshot" >&2
            rm -f "$SNAPSHOT_FILE"
            DELTA_TEXT=""
        }
        rm -f "$_DELTA_TMP" "$_SNAP_TMP"
        # Save a backup of the old snapshot — restored on cycle failure so the delta is replayed next cycle
        cp "$SNAPSHOT_FILE" "${SNAPSHOT_FILE}.prev" 2>/dev/null || true
        # Update snapshot for next cycle's diff
        echo "$_NEW_CTX" > "$SNAPSHOT_FILE"
    else
        # No snapshot to diff against — just report counts
        _DELTA_TEXT=""
        if [ -n "$_NEW_CTX" ]; then
            cp "$SNAPSHOT_FILE" "${SNAPSHOT_FILE}.prev" 2>/dev/null || true
            echo "$_NEW_CTX" > "$SNAPSHOT_FILE"
        fi
        DELTA_TEXT=""
    fi

    # Build resume prompt: cycle nudge + delta (empty string if nothing changed)
    CURRENT_CYCLE=$((SAVED_CYCLE + 1))
    _URGENT_NOTE=""
    [ "${CEO_COUNT}" -gt 0 ] && _URGENT_NOTE=" ⚠️ URGENT: ${CEO_COUNT} Founder/Lord message(s) — handle FIRST."
    if [ -n "$DELTA_TEXT" ] && [ "$(echo "$DELTA_TEXT" | tr -d '[:space:]')" != "" ]; then
        PROMPT_TEXT="$(printf 'Cycle %s.%s Here is what happened while you were away:\n\n%s' "$CURRENT_CYCLE" "$_URGENT_NOTE" "$DELTA_TEXT")"
        echo "[session:${AGENT_NAME}] Resume: injecting context delta"
        echo "$DELTA_TEXT" | sed 's/^/  [delta] /'
    else
        PROMPT_TEXT="Cycle ${CURRENT_CYCLE}.${_URGENT_NOTE} Nothing new — keep going."
        echo "[session:${AGENT_NAME}] Resume: no changes detected"
    fi
else
    # Fresh start — static prefix first (KV-cached), then dynamic context last.
    # Static prefix = persona.md + prompt.md (never changes → always hits KV cache)
    # Dynamic suffix = memory + live snapshot (changes per session → not cached, but small)
    # persona.md is the primary agent identity file (merged identity + role context).
    # prompt.md is accepted as a legacy fallback when persona.md is absent.
    _PRIMARY_FILE=""
    if [ -f "$PERSONA_FILE" ] && [ -s "$PERSONA_FILE" ]; then
        _PRIMARY_FILE="$PERSONA_FILE"
    elif [ -f "$PROMPT_FILE" ] && [ -s "$PROMPT_FILE" ]; then
        _PRIMARY_FILE="$PROMPT_FILE"
    fi
    [ -z "$_PRIMARY_FILE" ] && { echo "Error: persona.md not found: $PERSONA_FILE" >&2; exit 1; }

    # Build static prefix: persona.md (identity + role) + agent_instructions.md (shared SOPs)
    INSTRUCTIONS_FILE="${SHARED_DIR:-${COMPANY_DIR}/public}/agent_instructions.md"
    _INSTRUCTIONS=""
    if [ -f "$INSTRUCTIONS_FILE" ] && [ -s "$INSTRUCTIONS_FILE" ]; then
        _INSTRUCTIONS="$(cat "$INSTRUCTIONS_FILE")"
    fi
    if [ -n "$_INSTRUCTIONS" ]; then
        STATIC_PREFIX="$(printf '%s\n\n---\n\n%s' "$(cat "$_PRIMARY_FILE")" "$_INSTRUCTIONS")"
        echo "[session:${AGENT_NAME}] Static prefix: $(basename "$_PRIMARY_FILE") + agent_instructions.md"
    else
        STATIC_PREFIX="$(cat "$_PRIMARY_FILE")"
        echo "[session:${AGENT_NAME}] Static prefix: $(basename "$_PRIMARY_FILE") only"
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
        LIVE_SNAPSHOT=$(python3 - "$_CTX_TMP" 2>/dev/null << 'PYEOF'
import sys, json, re

with open(sys.argv[1]) as f:
    d = json.load(f)

def sender_from_filename(fn):
    m = re.search(r'from_(\w+)', fn)
    return m.group(1).capitalize() if m else fn

out = []
out.append("## Your Starting Context")
out.append("")

# Mode + SOP together (agents need operating rules BEFORE seeing their work queue)
out.append("**Company mode**: {}".format(d.get("mode","normal")))
sop = d.get("sop")
if sop:
    out.append("### Active SOP ({} mode):".format(d.get("mode","normal")))
    out.append(sop)
out.append("")

# Urgent messages (full content)
urgent = d.get("inbox", {}).get("urgent", [])
if urgent:
    out.append("### ⚠️ URGENT — Founder/Lord Messages (handle FIRST)")
    for m in urgent:
        out.append(m["content"].strip())
        out.append("")

# Inbox previews
inbox = d.get("inbox", {})
total = inbox.get("total_unread", 0)
msgs = inbox.get("messages", [])
more = inbox.get("more", 0)
if total > 0:
    shown = len(urgent) + len(msgs)
    suffix = " ({} more not shown)".format(more) if more > 0 else ""
    out.append("**Unread inbox** ({} messages{}):".format(total, suffix))
    for m in msgs:
        out.append("  - {}: \"{}\"".format(sender_from_filename(m["filename"]), m["preview"]))
else:
    out.append("**Unread inbox**: none")
out.append("")

# Tasks
tasks = d.get("tasks", [])
if tasks:
    out.append("**Your open tasks**:")
    for t in tasks:
        out.append("  T{} [{}] {}: {}".format(t.get("id",""), t.get("status",""), t.get("priority","medium"), t.get("title","")))
        desc = (t.get("description") or "").strip()
        if desc:
            # Truncate long descriptions (D004 is 2000+ chars) — agents read full spec from knowledge.md
            desc_preview = desc[:200] + "…" if len(desc) > 200 else desc
            out.append("    {}".format(desc_preview))
else:
    out.append("**Your open tasks**: none assigned")
out.append("")

# Pending review (for tina/olivia/alice — tasks waiting for their review)
pending = d.get("pending_review", [])
if pending:
    out.append("**Tasks awaiting your review** (in_review, assigned to others):")
    for t in pending:
        notes = (t.get("notes") or "").strip()
        last_note = notes.split(";;")[-1].strip()[:120] if notes else ""
        note_str = " — note: {}".format(last_note) if last_note else ""
        out.append("  T{} [in_review] {}: {} (assignee: {}){}".format(
            t.get("id",""), t.get("priority","medium"), t.get("title",""), t.get("assignee",""), note_str))
    out.append("")

# Team channel (last 5)
tc = d.get("team_channel", [])
if tc:
    out.append("**Recent team channel**:")
    for m in tc[-5:]:
        out.append("  - {}: \"{}\"".format(sender_from_filename(m["filename"]), m["preview"]))
    out.append("")

# Announcements (last 3)
anns = d.get("announcements", [])
if anns:
    out.append("**Recent announcements**:")
    for a in anns[-3:]:
        out.append("  - {}: \"{}\"".format(sender_from_filename(a["filename"]), a["preview"]))
    out.append("")

# Teammates
teammates = d.get("teammates", [])
if teammates:
    working = [t for t in teammates if t["status"] not in ("idle", "unknown")]
    idle = [t for t in teammates if t["status"] == "idle"]
    if working:
        out.append("**Active teammates**: {}".format(", ".join(
            "{} ({})".format(t["name"], t["status"]) for t in working)))
    if idle:
        out.append("**Idle teammates**: {}".format(", ".join(t["name"] for t in idle)))
    out.append("")

# Culture / consensus — agents need the full file to see all norms and sprint decisions
culture = d.get("culture")
if culture:
    if len(culture) > 12000:
        culture = culture[:12000] + "\n...[truncated — call read_culture for the rest]"
    out.append("### Culture & Decisions (consensus.md):")
    out.append(culture)

print("\n".join(out))
PYEOF
) || {
            echo "[warn:${AGENT_NAME}] Live snapshot render failed — using minimal fallback" >&2
            LIVE_SNAPSHOT="## Live State Snapshot
- Snapshot render failed — read files directly this cycle
- Inbox: check chat_inbox/ for unread messages
- Tasks: grep your name from public/task_board.md"
        }
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

# ── Executor failure warning ──────────────────────────────────────────────────
# If the last 3+ cycles all failed with the current executor, warn the agent so
# they can decide to switch executors. Matches both raw_bytes=0 (no output) and
# API error failures (quota exhausted, auth failure).
_FAILURE_LOG="${AGENT_DIR}/logs/cycle_failures.log"
if [ -f "$_FAILURE_LOG" ] && [ "$_EARLY_DRY_RUN" != "1" ]; then
    # Count true consecutive failures: scan from end, stop at first OK or different executor line
    _CONSEC_FAIL=$(tac "$_FAILURE_LOG" 2>/dev/null | awk -v exec="$EXECUTOR" '
        /^[^ ]+ OK / { exit }
        /^[^ ]+ FAIL executor=/ {
            if (index($0, "FAIL executor=" exec) > 0) count++
            else exit
        }
        END { print count+0 }
    ' || echo 0)
    if [ "${_CONSEC_FAIL:-0}" -ge 3 ]; then
        _FAIL_WARN="

⚠️ EXECUTOR WARNING: Your last ${_CONSEC_FAIL} cycles failed with executor '${EXECUTOR}'.
The executor may be quota-exhausted, unauthenticated, or unavailable.
To switch executor: Write 'codex' to your executor.txt if on gemini (or 'gemini' if on codex). NEVER use 'claude'.
Example: Use the Write tool to write 'codex' to executor.txt. Your next session will use the new executor."
        PROMPT_TEXT="${PROMPT_TEXT}${_FAIL_WARN}"
        echo "[executor-warn:${AGENT_NAME}] ${_CONSEC_FAIL} recent failures with ${EXECUTOR} — injected warning into prompt"
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
# Record the raw log byte offset BEFORE this cycle so last_context.md only processes
# the current cycle's output, not the entire growing daily log (charlie: 33MB → 2-3s jq)
_RAW_LOG_OFFSET=$(wc -c < "$RAW_LOG" 2>/dev/null | tr -d ' ')
_RAW_LOG_OFFSET="${_RAW_LOG_OFFSET:-0}"

echo "" >> "$DAILY_LOG"
echo "========== CYCLE START — ${TIMESTAMP} [session:$([ $USE_RESUME -eq 1 ] && echo "RESUME" || echo "FRESH")] [executor:${EXECUTOR}] ==========" >> "$DAILY_LOG"

# ── Log what gets sent to the LLM this cycle ─────────────────────────────────
_CYCLE_LOG_DIR="${AGENT_DIR}/logs/cycles"
mkdir -p "$_CYCLE_LOG_DIR"
# Prune cycle files older than 7 days — they accumulate to 190MB+ across all agents.
# Run asynchronously so it doesn't block the cycle start.
find "$_CYCLE_LOG_DIR" -maxdepth 1 -name "*_prompt.txt" -mtime +7 -delete 2>/dev/null &
find "$_CYCLE_LOG_DIR" -maxdepth 1 -name "*_snapshot.json" -mtime +7 -delete 2>/dev/null &
# Clean up stale /tmp/agent_ctx_* and /tmp/agent_snap_* left by crashed cycles (> 1 hour old)
find /tmp -maxdepth 1 \( -name "agent_ctx_*" -o -name "agent_snap_*" \) -mmin +60 -delete 2>/dev/null &
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
MAX_RAW = 500  # max chars for unrecognized event dump — prevents 100KB events bloating clean log
for raw in sys.stdin:
    raw = raw.rstrip("\n")
    if not raw:
        continue
    try:
        event = json.loads(raw)
    except Exception:
        print(raw[:MAX_RAW])
        continue
    if isinstance(event, dict):
        etype = str(event.get("type") or event.get("event") or "").lower()
        # Handle item.completed — extract agent_message text or command summary
        if etype == "item.completed":
            item = event.get("item") or {}
            itype = str(item.get("type") or "").lower()
            if itype == "agent_message":
                text = item.get("text") or item.get("content") or ""
                if isinstance(text, str) and text.strip():
                    print("[ASSISTANT] " + text.strip()[:500])
            elif itype == "command_execution":
                cmd = (item.get("command") or "")[:100]
                out = (item.get("aggregated_output") or "")[:150]
                print("[TOOL] {}".format(cmd))
                if out.strip():
                    print("[TOOL_RESULT] " + out.strip()[:150])
            continue
        # result/completed — emit [DONE] in cycles parser format
        if etype in ("result", "completed", "done", "final"):
            sid = event.get("session_id") or event.get("conversation_id") or event.get("thread_id") or "?"
            turns = event.get("num_turns") or 0
            cost = event.get("total_cost_usd") or 0
            duration_ms = event.get("duration_ms") or 0
            duration_s = round(duration_ms / 1000, 3)
            # Detect API errors (quota, auth, rate limiting)
            if event.get("status") == "error" or event.get("type") == "error":
                err_msg = (event.get("error") or event.get("message") or "API error")
                if isinstance(err_msg, dict):
                    err_msg = err_msg.get("message") or str(err_msg)
                print("[API_ERROR] {}".format(str(err_msg)[:300]))
                print("[DONE] turns=0 cost=$0 duration={}s session=ERROR".format(duration_s))
                continue
            print("[DONE] turns={} cost=${} duration={}s session={}".format(turns, cost, duration_s, sid))
            continue
        text = event.get("text") or event.get("message") or event.get("content")
        if isinstance(text, str) and text.strip():
            print("[ASSISTANT] " + text.strip()[:500])
            continue
    dumped = json.dumps(event, ensure_ascii=True)
    print(dumped[:MAX_RAW] + ("…" if len(dumped) > MAX_RAW else ""))
'
}

gemini_stream_log() {
    python3 -u -c '
import json, sys
MAX_RAW = 500  # max chars for unrecognized event dump — prevents 100KB events bloating clean log
for raw in sys.stdin:
    raw = raw.rstrip("\n")
    if not raw:
        continue
    try:
        event = json.loads(raw)
    except Exception:
        print(raw[:MAX_RAW])
        continue
    if isinstance(event, dict):
        etype = str(event.get("type") or "").lower()
        if etype == "init":
            # {"type":"init","session_id":"UUID","model":"..."} — skip, session parsed separately
            continue
        # Extract assistant text from gemini message format
        # Gemini messages: {"type":"message","role":"assistant","parts":[{"text":"..."}]}
        # or nested content: {"type":"content","delta":{"text":"..."}}
        if etype == "message":
            role = str(event.get("role") or "").lower()
            if role == "assistant":
                parts = event.get("parts") or []
                for p in parts:
                    if isinstance(p, dict):
                        t = p.get("text") or p.get("content") or ""
                    else:
                        t = str(p)
                    if t.strip():
                        print("[ASSISTANT] " + t.strip()[:500])
            continue
        if etype == "content":
            # content = streaming assistant text delta (not a tool call)
            delta = event.get("delta") or {}
            t = delta.get("text") or delta.get("content") or event.get("text") or ""
            if t.strip():
                print("[ASSISTANT] " + t.strip()[:200])
            continue
        if etype == "tool_call":
            name = event.get("name") or "?"
            inp = event.get("input") or {}
            cmd = inp.get("command") or inp.get("file_path") or str(inp)[:100]
            print("[TOOL] {}({})".format(name, cmd[:150]))
            continue
        if etype == "tool_result":
            out = event.get("output") or event.get("content") or ""
            print("[TOOL_RESULT] " + str(out)[:200])
            continue
        if etype in ("result", "final", "completed"):
            # Extract stats for [DONE] line matching cycles parser format:
            # [DONE] turns=N cost=$X.XXXX duration=X.Xs session=UUID
            stats = event.get("stats") or {}
            sid = event.get("session_id") or event.get("sessionId") or "?"
            turns = stats.get("tool_calls") or 0
            duration_ms = stats.get("duration_ms") or 0
            duration_s = round(duration_ms / 1000, 3)
            # Detect API errors (quota exhausted, auth failed, rate limited)
            if event.get("status") == "error":
                err_obj = event.get("error") or {}
                err_msg = err_obj.get("message") or str(err_obj)[:200] or "API error"
                print("[API_ERROR] {}".format(err_msg[:300]))
                # Emit DONE with session=ERROR so failure detection can catch it
                print("[DONE] turns=0 cost=$0 duration={}s session=ERROR".format(duration_s))
                continue
            # Gemini does not report USD cost directly — use 0 (tracked via token counts)
            print("[DONE] turns={} cost=$0 duration={}s session={}".format(turns, duration_s, sid))
            continue
        # Fallback: print other unrecognized event types
        msg = event.get("message") or event.get("text") or event.get("content")
        if isinstance(msg, str) and msg.strip():
            print("[ASSISTANT] " + msg.strip())
            continue
    dumped = json.dumps(event, ensure_ascii=True)
    print(dumped[:MAX_RAW] + ("…" if len(dumped) > MAX_RAW else ""))
'
}

extract_session_id() {
    local raw_log="$1"
    local executor="$2"
    # Only process bytes written during this cycle (avoids scanning the full 33MB daily log)
    # _RAW_LOG_OFFSET is set before the executor runs; use tail -c +N to skip prior cycles.
    local _log_offset="${_RAW_LOG_OFFSET:-0}"
    _read_log_from_offset() {
        if [ "${_log_offset:-0}" -gt 0 ] 2>/dev/null; then
            tail -c +"$((_log_offset + 1))" "$raw_log" 2>/dev/null
        else
            cat "$raw_log" 2>/dev/null
        fi
    }
    case "$executor" in
        kimi)
            if _read_log_from_offset | grep -q 'TurnEnd\|StatusUpdate'; then
                echo "kimi"
            fi
            ;;
        claude)
            _read_log_from_offset | jq -r 'select(.type == "result") | .session_id // ""' 2>/dev/null \
                | grep -v '^$' | grep -v '^null$' | grep -v '^dryrun' | tail -1 || true
            ;;
        codex)
            # Handle both JSONL and JSON array output from codex
            _read_log_from_offset | jq -r 'if type == "array" then .[] else . end | (.session_id // .conversation_id // .thread_id // .session.id // "")' 2>/dev/null \
                | grep -v '^$' | grep -v '^null$' | tail -1 || true
            ;;
        gemini)
            # Gemini stream-json emits {"type":"init","session_id":"UUID"} as first line.
            # Parse session_id (underscore) from the init message in this agent's raw log.
            _GEMINI_SID=$(_read_log_from_offset | jq -r 'select(.type == "init" and .session_id != null and .session_id != "") | .session_id' 2>/dev/null \
                | grep -v '^null$' | grep -v '^$' | tail -1 || true)
            if [ -n "$_GEMINI_SID" ]; then echo "$_GEMINI_SID"; return; fi
            # Also try legacy field name (sessionId without underscore) for compatibility
            _GEMINI_SID=$(_read_log_from_offset | jq -r 'select((.sessionId // .session_id) != null) | (.sessionId // .session_id)' 2>/dev/null \
                | grep -v '^null$' | grep -v '^$' | tail -1 || true)
            if [ -n "$_GEMINI_SID" ]; then echo "$_GEMINI_SID"; return; fi
            # Fallback: scan ~/.gemini/tmp/ for the newest session file.
            # CAUTION: race condition when multiple gemini agents run concurrently —
            # the newest file might belong to another agent. Use only as last resort.
            _GEMINI_PROJ=$(ls -t ~/.gemini/tmp/ 2>/dev/null | head -1)
            if [ -n "$_GEMINI_PROJ" ]; then
                _NEWEST=$(ls -t ~/.gemini/tmp/"$_GEMINI_PROJ"/chats/session-*.json 2>/dev/null | head -1)
                if [ -n "$_NEWEST" ]; then
                    _GEMINI_UUID=$(python3 -c "import json; d=json.load(open('$_NEWEST')); print(d.get('session_id', d.get('sessionId','')))" 2>/dev/null)
                    if [ -n "$_GEMINI_UUID" ]; then echo "$_GEMINI_UUID"; return; fi
                fi
            fi
            # Final fallback: if output exists but no session ID, save generic marker
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
import sys, re, time
buf = []; in_tp = False; saw_turn_end = False
start_s = time.time()
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
    if re.match(r'^TurnEnd', line):
        saw_turn_end = True
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
        print(line[:500] + ('…' if len(line) > 500 else ''))
duration_s = round(time.time() - start_s, 1)
if saw_turn_end:
    print('[DONE] turns=0 cost=$0 duration={}s session=kimi'.format(duration_s))
else:
    print('[API_ERROR] kimi produced no TurnEnd — session may have failed or expired')
    print('[DONE] turns=0 cost=$0 duration={}s session=ERROR'.format(duration_s))
sys.stdout.flush()
" >> "$DAILY_LOG" 2>/dev/null || true
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
            _CODEX_PORT="${DASHBOARD_PORT:-3199}"
            if [ $USE_RESUME -eq 1 ] && [ -n "$RESUME_FLAG" ]; then
                $TIMEOUT_CMD codex exec resume "$RESUME_FLAG" "$PROMPT_TEXT" \
                    -C "$AGENT_DIR" \
                    --add-dir "$_CODEX_SHARED" \
                    --add-dir "$_CODEX_AGENTS" \
                    --add-dir "$_CODEX_OUTPUT" \
                    --skip-git-repo-check \
                    --dangerously-bypass-approvals-and-sandbox \
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
                    --dangerously-bypass-approvals-and-sandbox \
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
    # Use offset to check only THIS cycle's bytes — avoids false positives from old cycles in same log.
    if tail -c +"$((_RAW_LOG_OFFSET + 1))" "$RAW_LOG" 2>/dev/null | grep -q 'TurnEnd\|StatusUpdate'; then
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

# Detect API errors early (before session save) — check tail of daily log for session=ERROR.
# Must be done here because _CYCLE_SUCCESS is computed after this block.
_API_ERROR_CYCLE=0
if [ "$_DRY_RUN" != "1" ] && tail -20 "$DAILY_LOG" 2>/dev/null | grep -q '^\[DONE\].*session=ERROR'; then
    _API_ERROR_CYCLE=1
fi

if [ -n "$NEW_SESSION_ID" ] && [ "$_API_ERROR_CYCLE" -eq 0 ]; then
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
elif [ -n "$NEW_SESSION_ID" ] && [ "$_API_ERROR_CYCLE" -eq 1 ]; then
    # API error cycle: do NOT advance session counter — keep the same session/cycle count.
    # When quota resets, the agent will resume the same session without wasting context budget.
    NEW_CYCLE="$SAVED_CYCLE"
    echo "[session:${AGENT_NAME}] API error — session counter NOT advanced (cycle stays at ${SAVED_CYCLE}/${SESSION_MAX_CYCLES})"
fi

# ── Cycle success check ───────────────────────────────────────────────────────
# Detect failed cycles (no output, errors) and log for monitoring
# Measure only this cycle's bytes (total_size - offset_before_run) to avoid false-positives
# where prior cycles in the daily log make the size check pass even on empty cycles.
_CYCLE_SUCCESS=1
_RAW_TOTAL=$(wc -c < "$RAW_LOG" 2>/dev/null | tr -d ' ')
_RAW_SIZE=$(( ${_RAW_TOTAL:-0} - ${_RAW_LOG_OFFSET:-0} ))
if [ -z "$NEW_SESSION_ID" ] && [ "$_DRY_RUN" != "1" ]; then
    _CYCLE_SUCCESS=0
    echo "[WARN] ${AGENT_NAME}: cycle produced no session ID — LLM call may have failed" | tee -a "$DAILY_LOG"
    echo "[WARN] Raw log size: ${_RAW_SIZE:-0} bytes"
fi
if [ "${_RAW_SIZE:-0}" -lt 50 ] && [ "$_DRY_RUN" != "1" ]; then
    _CYCLE_SUCCESS=0
    echo "[WARN] ${AGENT_NAME}: raw output too small (${_RAW_SIZE} bytes) — likely failed" | tee -a "$DAILY_LOG"
fi
# Check for API-level errors (quota exhausted, auth failures) — reuse _API_ERROR_CYCLE flag
# set above which already checked for [DONE]...session=ERROR in last 20 lines of daily log.
if [ "$_API_ERROR_CYCLE" -eq 1 ]; then
    _CYCLE_SUCCESS=0
    echo "[WARN] ${AGENT_NAME}: API error detected (quota exhausted / auth failure) — marking cycle failed" | tee -a "$DAILY_LOG"
fi
if [ "$_CYCLE_SUCCESS" -eq 0 ]; then
    # Restore snapshot from backup so the delta is replayed on the next cycle.
    # This ensures messages/tasks shown in the delta this cycle aren't silently dropped
    # when the LLM never ran (API error, quota exhausted, etc.).
    if [ -f "${SNAPSHOT_FILE}.prev" ]; then
        mv "${SNAPSHOT_FILE}.prev" "$SNAPSHOT_FILE"
        echo "[session:${AGENT_NAME}] Snapshot restored from backup (cycle failed — delta will replay next cycle)"
    fi
else
    # Success — clean up backup to avoid stale .prev files accumulating
    rm -f "${SNAPSHOT_FILE}.prev"
fi
_FAIL_LOG="${AGENT_DIR}/logs/cycle_failures.log"
if [ "$_CYCLE_SUCCESS" -eq 0 ]; then
    # Write failure marker for watchdog/monitoring
    echo "$(date +%Y-%m-%dT%H:%M:%S) FAIL executor=${EXECUTOR} raw_bytes=${_RAW_SIZE:-0}" >> "$_FAIL_LOG"
    echo "[WARN] Failure logged to logs/cycle_failures.log. Watchdog or next smart_run will retry."
else
    # Write success marker — so the consecutive-failure counter resets after a good cycle
    echo "$(date +%Y-%m-%dT%H:%M:%S) OK executor=${EXECUTOR}" >> "$_FAIL_LOG"
fi
# Prune to last 200 entries — prevent unbounded growth over months
if [ "$(wc -l < "$_FAIL_LOG" 2>/dev/null | tr -d ' ')" -gt 250 ]; then
    tail -200 "$_FAIL_LOG" > "${_FAIL_LOG}.tmp" && mv "${_FAIL_LOG}.tmp" "$_FAIL_LOG" 2>/dev/null || true
fi

# ── Dump last context ─────────────────────────────────────────────────────────
{
    echo "# Last Cycle Context — ${AGENT_NAME} — $(date +%Y_%m_%d_%H_%M_%S)"
    echo "# Executor: ${EXECUTOR}"
    echo "# Session: $(cat "$SESSION_ID_FILE" 2>/dev/null | head -c 12)… cycle $((SAVED_CYCLE+1))/${SESSION_MAX_CYCLES}"
    echo ""
    # Only process the current cycle's output (tail from _RAW_LOG_OFFSET bytes).
    # Processing the full daily raw log (charlie: 33MB) through jq cost 2-3s per cycle.
    tail -c +"$((_RAW_LOG_OFFSET + 1))" "$RAW_LOG" 2>/dev/null | jq -r --arg start_time "$(date +%Y-%m-%dT%H:%M:%S)" '
        # Handle Claude format (type="assistant"), Gemini format (type="message",role="assistant"),
        # and generic role-based format.
        # Claude: {"type":"assistant","message":{"content":[{"type":"text","text":"..."},{"type":"tool_use","name":"...","input":{...}}]}}
        # Gemini: {"type":"message","role":"assistant","parts":[{"text":"..."}]}
        #         {"type":"tool_call","name":"...","input":{...}} or {"type":"tool_result","output":"..."}
        if .type == "assistant" then
          # Claude format
          (.message.content // [])[] |
          "\n[--- Entry ---]\n" +
          if .type == "text" then .text
          elif .type == "think" then "[Thinking] " + .think
          elif .type == "tool_use" then
            "**[Tool: " + .name + "]**\n" +
            (if .input.file_path then "  file: " + .input.file_path
             elif .input.command then "  cmd: " + (.input.command | tostring | .[0:300])
             else (.input | tostring | .[0:200]) end)
          else empty end
        elif .type == "message" and .role == "assistant" then
          # Gemini format
          "\n[--- Entry ---]\n" +
          ((.parts // []) | map(.text // "" | select(. != "")) | join("\n"))
        elif .type == "tool_call" then
          # Gemini tool call
          "\n[Tool: " + (.name // "?") + "]\n" +
          (if .input.file_path then "  file: " + .input.file_path
           elif .input.command then "  cmd: " + (.input.command | tostring | .[0:300])
           else (.input | tostring | .[0:200]) end)
        elif .type == "tool_result" then
          # Gemini tool result (truncate)
          "  → " + ((.output // .content // "") | tostring | .[0:200])
        elif .role == "assistant" and (.content | type) == "array" then
          # Generic role-based format
          (.content)[] |
          "\n[--- Entry ---]\n" +
          if .type == "text" then .text else empty end
        else empty end
    ' 2>/dev/null | awk 'NF || printed {printed=1; print}'
} > "${AGENT_DIR}/last_context.md" 2>/dev/null || true
