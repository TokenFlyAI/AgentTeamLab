#!/bin/bash
# check_taskboard_hook.sh — PreToolUse hook: show agent their latest relevant tasks
# Runs from agent's working directory (agents/{name}/)
#
# Within-cycle dedup: only outputs when the task list changes, not on every tool call.
# Uses a temp stamp file keyed by agent + session PID to silence repeated identical output.
TASKBOARD="../../public/task_board.md"
AGENT_NAME=$(basename "$(pwd)")
# Prune stale stamp files older than 24h (they accumulate per-cycle; PPID changes every run)
find /tmp -maxdepth 1 -name ".taskboard_hook_${AGENT_NAME}_*" -mtime +1 -delete 2>/dev/null || true

[ ! -f "$TASKBOARD" ] && exit 0

# Extract only open/in_progress rows (skip done/blocked/header/separator)
ACTIVE=$(grep "^|" "$TASKBOARD" | grep -iv "^| id\|^|--\|^| ---" | grep -iv "| *done *|\|| *cancelled *|")

[ -z "$ACTIVE" ] && exit 0

# P0/critical assigned to me — always show, urgent
MY_P0=$(echo "$ACTIVE" | grep -iE "critical|p0" | grep -i "| *${AGENT_NAME} *|" | tail -10)

# My latest assigned tasks (newest = highest row number = bottom of table), max 3
MY_TASKS=$(echo "$ACTIVE" | grep -i "| *${AGENT_NAME} *|" | tail -10)

# Latest unassigned tasks (for self-assignment), max 3
# Use awk to check the Assignee column (field 7 when split by |) precisely.
# Only show regular task rows (numeric IDs) — not Directions (D...) or Instructions (I...).
# Matches: empty, dash variants, "unassigned", "undefined".
UNASSIGNED=$(echo "$ACTIVE" | awk -F'|' '{
    id = $2; gsub(/^[ \t]+|[ \t]+$/, "", id)
    if (id !~ /^[0-9]/) next
    a = $7; gsub(/^[ \t]+|[ \t]+$/, "", a)
    if (a == "" || a == "—" || a ~ /^-+$/ || a == "unassigned" || a == "undefined") print
}' | tail -10)

# Truncate long rows to avoid description column blowing up token count
truncate_rows() {
    while IFS= read -r line; do
        if [ ${#line} -gt 300 ]; then
            printf '%s…\n' "${line:0:300}"
        else
            printf '%s\n' "$line"
        fi
    done
}

# Build the output we'd emit
OUTPUT=""
if [ -n "$MY_P0" ]; then
    OUTPUT="${OUTPUT}=== P0/CRITICAL TASKS ASSIGNED TO YOU — DROP EVERYTHING ===\n$(echo "$MY_P0" | truncate_rows)\n\n"
fi
if [ -n "$MY_TASKS" ]; then
    OUTPUT="${OUTPUT}=== YOUR LATEST ASSIGNED TASKS (focus on these) ===\n$(echo "$MY_TASKS" | truncate_rows)\n\n"
fi
if [ -z "$MY_TASKS" ] && [ -n "$UNASSIGNED" ]; then
    OUTPUT="${OUTPUT}=== LATEST UNASSIGNED TASKS (claim one) ===\n$(echo "$UNASSIGNED" | truncate_rows)\n\n"
fi

[ -z "$OUTPUT" ] && exit 0

# Within-cycle dedup: hash the output; skip if identical to last emission this cycle.
# Stamp file is keyed by agent + parent PID (one per agent process tree).
STAMP_FILE="/tmp/.taskboard_hook_${AGENT_NAME}_${PPID}"
NEW_HASH=$(printf '%s' "$OUTPUT" | md5 2>/dev/null || printf '%s' "$OUTPUT" | md5sum 2>/dev/null | cut -d' ' -f1)
OLD_HASH=$(cat "$STAMP_FILE" 2>/dev/null || true)

if [ "$NEW_HASH" = "$OLD_HASH" ]; then
    # Task list unchanged since last emission this cycle — stay silent
    exit 0
fi

echo "$NEW_HASH" > "$STAMP_FILE"
printf '%b' "$OUTPUT"
exit 0
