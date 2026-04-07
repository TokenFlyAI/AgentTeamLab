#!/bin/bash
# check_inbox_hook.sh — PreToolUse hook for message delivery
# Runs from agent's working directory (agents/{name}/)
#
# Within-cycle dedup: only dumps inbox content when it changes (new message arrives
# or a message is processed). Silences on repeated identical tool calls.
INBOX_DIR="chat_inbox"
AGENT_NAME=$(basename "$(pwd)")
shopt -s nullglob

UNREAD_FILES=()
for msg in "$INBOX_DIR"/*.md; do
    [ -f "$msg" ] || continue
    [[ "$(basename "$msg")" == read_* ]] && continue
    [[ "$(basename "$msg")" == processed_* ]] && continue
    [[ "$(basename "$msg")" == *.processed.md ]] && continue
    UNREAD_FILES+=("$msg")
done
shopt -u nullglob

[ ${#UNREAD_FILES[@]} -eq 0 ] && exit 0

# Sort: CEO/Lord messages first (highest priority), then newest-first by filename
CEO_FILES=()
OTHER_FILES=()
for msg in "${UNREAD_FILES[@]}"; do
    basename_msg="$(basename "$msg")"
    if [[ "$basename_msg" == *_from_ceo.md || "$basename_msg" == *_from_lord.md ]]; then
        CEO_FILES+=("$msg")
    else
        OTHER_FILES+=("$msg")
    fi
done
# Reverse sort each group (newest first — filenames start with timestamp)
SORTED_CEO=()
SORTED_OTHER=()
[ ${#CEO_FILES[@]} -gt 0 ] && IFS=$'\n' SORTED_CEO=($(printf '%s\n' "${CEO_FILES[@]}" | sort -r)) && unset IFS
[ ${#OTHER_FILES[@]} -gt 0 ] && IFS=$'\n' SORTED_OTHER=($(printf '%s\n' "${OTHER_FILES[@]}" | sort -r)) && unset IFS
SORTED_FILES=("${SORTED_CEO[@]}" "${SORTED_OTHER[@]}")

# Build output — cap at 5 most recent/priority messages to avoid token blowup
MAX_MSGS=5
TOTAL=${#UNREAD_FILES[@]}
OUTPUT="=== URGENT: UNREAD MESSAGES IN YOUR INBOX (${TOTAL} total) ===\n"
[ ${#CEO_FILES[@]} -gt 0 ] && OUTPUT="${OUTPUT}⚡ ${#CEO_FILES[@]} FOUNDER/LORD message(s) — handle FIRST\n"
SHOWN=0
for msg in "${SORTED_FILES[@]}"; do
    [ $SHOWN -ge $MAX_MSGS ] && break
    [ -z "$msg" ] || [ ! -f "$msg" ] && continue
    OUTPUT="${OUTPUT}--- Message: $(basename "$msg") ---\n$(cat "$msg")\n"
    SHOWN=$((SHOWN+1))
done
[ $TOTAL -gt $MAX_MSGS ] && OUTPUT="${OUTPUT}... and $((TOTAL - MAX_MSGS)) more — process these first, then re-check.\n"
OUTPUT="${OUTPUT}REQUIRED: Move to chat_inbox/processed/ after handling\n"

# Within-cycle dedup: skip if inbox content unchanged since last emission this cycle.
STAMP_FILE="/tmp/.inbox_hook_${AGENT_NAME}_${PPID}"
NEW_HASH=$(printf '%s' "$OUTPUT" | md5 2>/dev/null || printf '%s' "$OUTPUT" | md5sum 2>/dev/null | cut -d' ' -f1)
OLD_HASH=$(cat "$STAMP_FILE" 2>/dev/null || true)

if [ "$NEW_HASH" = "$OLD_HASH" ]; then
    exit 0
fi

echo "$NEW_HASH" > "$STAMP_FILE"
printf '%b' "$OUTPUT"
exit 0
