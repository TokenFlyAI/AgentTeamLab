#!/bin/bash
# run_agent.sh — Run a single agent cycle with session resume + memory save
# Supports both Claude Code and Kimi Code executors
#
# Session lifecycle:
#   Cycles 1..SESSION_MAX_CYCLES  → --resume <session_id> (Claude) or --session <id> (Kimi)
#   Cycle SESSION_MAX_CYCLES+1    → fresh start; memory.md injected into prompt
#   memory.md is auto-saved from status.md before each session reset
#
# Env overrides:
#   SESSION_MAX_CYCLES  (default 5)  — cycles per session before reset
#   SESSION_FORCE_FRESH (1)          — force fresh start ignoring saved session
#   EXECUTOR            (claude|kimi) — override executor for this run
set -e

AGENT_NAME="$1"
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="${COMPANY_DIR}/agents/${AGENT_NAME}"

# Source executor config helper
source "${COMPANY_DIR}/lib/executor_config.sh"

# Validate
[ -z "$AGENT_NAME" ] && echo "Usage: $0 <agent_name>" && exit 1
[ ! -d "$AGENT_DIR" ] && echo "Error: Agent dir not found: $AGENT_DIR" && exit 1

# Determine executor (env override > config > default)
EXECUTOR="${EXECUTOR:-$(get_executor "$AGENT_NAME" "$COMPANY_DIR")}"
echo "[executor:${AGENT_NAME}] Using: ${EXECUTOR}"

# Create directories
mkdir -p "${AGENT_DIR}/logs" "${AGENT_DIR}/chat_inbox/processed" "${AGENT_DIR}/knowledge"

# ── Session management ────────────────────────────────────────────────────────
SESSION_ID_FILE=$(get_session_id_file "$AGENT_DIR" "$EXECUTOR")
SESSION_CYCLE_FILE=$(get_session_cycle_file "$AGENT_DIR" "$EXECUTOR")
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
    if [ "$EXECUTOR" = "kimi" ]; then
        RESUME_FLAG="--session $SAVED_SESSION_ID"
    else
        RESUME_FLAG="--resume $SAVED_SESSION_ID"
    fi
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
MEMORY_FILE="${AGENT_DIR}/memory.md"

if [ $USE_RESUME -eq 1 ]; then
    # Resuming: short continuation — full context already in agent's memory
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
SETTINGS_FILE=$(get_settings_file "$AGENT_NAME" "$EXECUTOR")

# NOTE: Kimi config via --config-file overrides ALL settings including models.
# We don't use --config-file for Kimi; instead we rely on ~/.kimi/config.toml
# for model settings. Hooks are not supported for Kimi until a merge-config
# option is available.
if [ "$EXECUTOR" = "kimi" ]; then
    # Kimi doesn't need a separate settings file - use default ~/.kimi/config.toml
    # which already has models configured
    true
else
    # Claude uses JSON format
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

# ── Update heartbeat ──────────────────────────────────────────────────────────
# Agents are expected to update heartbeat.md themselves, but the launcher
# should at least touch it so the dashboard knows the agent process started.
echo "status: running" > "${AGENT_DIR}/heartbeat.md"
echo "timestamp: $(date +%Y_%m_%d_%H_%M_%S)" >> "${AGENT_DIR}/heartbeat.md"
echo "task: Processing work cycle" >> "${AGENT_DIR}/heartbeat.md"

# ── Run Agent ─────────────────────────────────────────────────────────────────
cd "$AGENT_DIR"

# ── Dry-run mode: skip real CLI call ─────────────────────────────────────────
# Set DRY_RUN=1 (env var) or "dry_run": true in public/smart_run_config.json
_DRY_RUN="${DRY_RUN:-0}"
if [ "$_DRY_RUN" != "1" ] && [ -f "${COMPANY_DIR}/public/smart_run_config.json" ]; then
    _cfg_dry=$(jq -r '.dry_run // false' "${COMPANY_DIR}/public/smart_run_config.json" 2>/dev/null)
    [ "$_cfg_dry" = "true" ] && _DRY_RUN=1
fi

if [ "$_DRY_RUN" = "1" ]; then
    echo "[DRY RUN] ${AGENT_NAME} — skipping ${EXECUTOR} call"
    FAKE_SESSION="dryrun-$(date +%s)-${AGENT_NAME}"
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"[DRY RUN] No API call made."}]}}\n{"type":"result","num_turns":0,"total_cost_usd":0,"duration_ms":100,"session_id":"%s"}\n' \
        "$FAKE_SESSION" \
        | tee -a "$RAW_LOG" \
        | jq --unbuffered -r '
            if .type == "assistant" then "[ASSISTANT] [DRY RUN] No API call made."
            elif .type == "result" then "[DONE] turns=0 cost=$0 duration=0.1s session=dryrun"
            else empty end
        ' >> "$DAILY_LOG" 2>/dev/null || true
elif [ "$EXECUTOR" = "kimi" ]; then
    # Kimi execution - uses ~/.kimi/config.toml for model settings
    # NOTE: --config-file would override all settings including models,
    # so we don't use it. Hooks are not supported until merge-config is available.
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
            --print \
            --output-format stream-json \
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
else
    # Claude execution
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
fi

echo "========== CYCLE END — $(date +%Y_%m_%d_%H_%M_%S) ==========" >> "$DAILY_LOG"

# ── Update heartbeat (idle) ───────────────────────────────────────────────────
echo "status: idle" > "$AGENT_DIR/heartbeat.md"
echo "timestamp: $(date +%Y_%m_%d_%H_%M_%S)" >> "$AGENT_DIR/heartbeat.md"
echo "task: Available for assignment" >> "$AGENT_DIR/heartbeat.md"

# ── Extract and save session ID ───────────────────────────────────────────────
NEW_SESSION_ID=$(jq -r 'select(.type == "result") | .session_id // ""' "$RAW_LOG" 2>/dev/null \
    | grep -v '^$' | grep -v '^null$' | tail -1 || true)

if [ -n "$NEW_SESSION_ID" ]; then
    echo "$NEW_SESSION_ID" > "$SESSION_ID_FILE"
    NEW_CYCLE=$((SAVED_CYCLE + 1))
    echo "$NEW_CYCLE" > "$SESSION_CYCLE_FILE"
    echo "[session:${AGENT_NAME}] Saved session ${NEW_SESSION_ID:0:12}… (cycle ${NEW_CYCLE}/${SESSION_MAX_CYCLES}) [executor:${EXECUTOR}]"

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
    fi
fi

# ── Dump last context ─────────────────────────────────────────────────────────
{
    echo "# Last Cycle Context — ${AGENT_NAME} — $(date +%Y_%m_%d_%H_%M_%S)"
    echo "# Executor: ${EXECUTOR}"
    echo "# Session: $(cat "$SESSION_ID_FILE" 2>/dev/null | head -c 12)… cycle $((SAVED_CYCLE+1))/${SESSION_MAX_CYCLES}"
    echo ""
    cat "$RAW_LOG" 2>/dev/null | jq -r --arg start_time "$(date +%Y-%m-%dT%H:%M:%S)" '
        # Handle both Claude format (.type, .message.content) and Kimi format (.role, .content)
        # Add timestamps using input_line_number as a proxy for sequence
        ((if .type == "assistant" then .message.content
          elif .role == "assistant" then .content
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
