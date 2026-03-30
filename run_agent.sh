#!/bin/bash
# run_agent.sh — Run a single agent cycle with session resume + memory save
#
# Session lifecycle:
#   Cycles 1..SESSION_MAX_CYCLES  → --resume <session_id> (cheap: no re-loading full context)
#   Cycle SESSION_MAX_CYCLES+1    → fresh start; memory.md injected into prompt
#   memory.md is auto-saved from status.md before each session reset
#
# Env overrides:
#   SESSION_MAX_CYCLES  (default 5)  — cycles per session before reset
#   SESSION_FORCE_FRESH (1)          — force fresh start ignoring saved session
set -e

AGENT_NAME="$1"
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="${COMPANY_DIR}/agents/${AGENT_NAME}"

# Validate
[ -z "$AGENT_NAME" ] && echo "Usage: $0 <agent_name>" && exit 1
[ ! -d "$AGENT_DIR" ] && echo "Error: Agent dir not found: $AGENT_DIR" && exit 1

# Create directories
mkdir -p "${AGENT_DIR}/logs" "${AGENT_DIR}/chat_inbox/processed" "${AGENT_DIR}/knowledge"

# ── Session management ────────────────────────────────────────────────────────
SESSION_ID_FILE="${AGENT_DIR}/session_id.txt"
SESSION_CYCLE_FILE="${AGENT_DIR}/session_cycle.txt"
MEMORY_FILE="${AGENT_DIR}/memory.md"
SESSION_MAX_CYCLES="${SESSION_MAX_CYCLES:-5}"

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
    RESUME_FLAG="--resume $SAVED_SESSION_ID"
    echo "[session:${AGENT_NAME}] Resuming ${SAVED_SESSION_ID:0:12}… (cycle $((SAVED_CYCLE+1))/${SESSION_MAX_CYCLES})"
else
    if [ -n "$SAVED_SESSION_ID" ]; then
        echo "[session:${AGENT_NAME}] Max cycles reached (${SAVED_CYCLE}/${SESSION_MAX_CYCLES}) — saving memory, starting fresh"
        # Save memory snapshot from status.md before resetting
        if [ -f "${AGENT_DIR}/status.md" ] && [ -s "${AGENT_DIR}/status.md" ]; then
            {
                echo "# Agent Memory Snapshot — ${AGENT_NAME} — $(date +%Y-%m-%dT%H:%M:%S)"
                echo ""
                echo "*(Auto-saved at session boundary. Injected into fresh sessions.)*"
                echo ""
                cat "${AGENT_DIR}/status.md"
            } > "$MEMORY_FILE"
            echo "[session:${AGENT_NAME}] Memory saved to memory.md"
        fi
    fi
    rm -f "$SESSION_ID_FILE" "$SESSION_CYCLE_FILE"
    SAVED_CYCLE=0
fi

# ── Build prompt ──────────────────────────────────────────────────────────────
PROMPT_FILE="${AGENT_DIR}/prompt.md"

if [ $USE_RESUME -eq 1 ]; then
    # Resuming: short continuation — full context already in Claude's memory
    PROMPT_TEXT="New work cycle. Check inbox for new messages, scan task board for assigned open tasks, then continue your work. Update status.md when done."
    # Append any urgent inbox summary so agent doesn't miss new messages (skip read_ files)
    INBOX_COUNT=$(ls "${AGENT_DIR}/chat_inbox/"*.md 2>/dev/null | grep -v '/read_' | wc -l | tr -d ' ')
    if [ "${INBOX_COUNT:-0}" -gt 0 ]; then
        PROMPT_TEXT="${PROMPT_TEXT} You have ${INBOX_COUNT} unread inbox message(s) — read them first."
    fi
else
    # Fresh start: full prompt + prepend memory snapshot if it exists
    [ -f "$PROMPT_FILE" ] || { echo "Error: prompt.md not found: $PROMPT_FILE" >&2; exit 1; }
    BASE_PROMPT=$(cat "$PROMPT_FILE")
    if [ -f "$MEMORY_FILE" ] && [ -s "$MEMORY_FILE" ]; then
        PROMPT_TEXT="$(printf '%s\n\n---\n\n%s' "$BASE_PROMPT" "$(cat "$MEMORY_FILE")")"
        echo "[session:${AGENT_NAME}] Injecting memory.md into fresh session"
    else
        PROMPT_TEXT="$BASE_PROMPT"
    fi
fi

# ── Settings file ─────────────────────────────────────────────────────────────
SETTINGS_FILE="/tmp/aicompany_settings_${AGENT_NAME}.json"
cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "env": { "DISABLE_AUTOUPDATER": "1" },
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
echo "========== CYCLE START — ${TIMESTAMP} [session:$([ $USE_RESUME -eq 1 ] && echo "RESUME" || echo "FRESH")] ==========" >> "$DAILY_LOG"

# ── Run Claude ────────────────────────────────────────────────────────────────
cd "$AGENT_DIR"

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

echo "========== CYCLE END — $(date +%Y_%m_%d_%H_%M_%S) ==========" >> "$DAILY_LOG"

# ── Extract and save session ID ───────────────────────────────────────────────
NEW_SESSION_ID=$(jq -r 'select(.type == "result") | .session_id // ""' "$RAW_LOG" 2>/dev/null \
    | grep -v '^$' | grep -v '^null$' | tail -1 || true)

if [ -n "$NEW_SESSION_ID" ]; then
    echo "$NEW_SESSION_ID" > "$SESSION_ID_FILE"
    NEW_CYCLE=$((SAVED_CYCLE + 1))
    echo "$NEW_CYCLE" > "$SESSION_CYCLE_FILE"
    echo "[session:${AGENT_NAME}] Saved session ${NEW_SESSION_ID:0:12}… (cycle ${NEW_CYCLE}/${SESSION_MAX_CYCLES})"

    # Pre-emptively save memory if this was the last cycle of the session
    if [ "$NEW_CYCLE" -ge "$SESSION_MAX_CYCLES" ]; then
        echo "[session:${AGENT_NAME}] Last cycle in session — saving memory now"
        if [ -f "${AGENT_DIR}/status.md" ] && [ -s "${AGENT_DIR}/status.md" ]; then
            {
                echo "# Agent Memory Snapshot — ${AGENT_NAME} — $(date +%Y-%m-%dT%H:%M:%S)"
                echo ""
                echo "*(Auto-saved at session boundary. Will be injected into the next fresh session.)*"
                echo ""
                cat "${AGENT_DIR}/status.md"
            } > "$MEMORY_FILE"
        fi
        # Don't delete session_id yet — next run's startup logic handles the reset
    fi
fi

# ── Dump last context ─────────────────────────────────────────────────────────
{
    echo "# Last Cycle Context — ${AGENT_NAME} — $(date +%Y_%m_%d_%H_%M_%S)"
    echo "# Session: $(cat "$SESSION_ID_FILE" 2>/dev/null | head -c 12)… cycle $((SAVED_CYCLE+1))/${SESSION_MAX_CYCLES}"
    echo ""
    cat "$RAW_LOG" 2>/dev/null | jq -r '
        if .type == "assistant" then
            [.message.content[]? |
                if .type == "text" then .text
                elif .type == "tool_use" then
                    "**[Tool: " + .name + "]**\n" +
                    (if .input.file_path then "  file: " + .input.file_path
                     elif .input.command then "  cmd: " + (.input.command | tostring | .[0:300])
                     else (.input | tostring | .[0:200]) end)
                else empty end
            ] | join("\n")
        else empty end | select(length > 0)
    ' 2>/dev/null
} > "${AGENT_DIR}/last_context.md" 2>/dev/null || true
