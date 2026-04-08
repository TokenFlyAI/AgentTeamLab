#!/bin/bash
# archive_tasks.sh — Move done/cancelled tasks from task_board.md to task_board_archive.md
# Run manually or from a cron to keep the active board lean.
# Usage: bash archive_tasks.sh [--dry-run]
#
# Preserves Directions, Instructions, and active Tasks sections intact.
# Archives rows with status=done or status=cancelled from the ## Tasks section.

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${COMPANY_DIR}/lib/paths.sh" 2>/dev/null || true
BOARD="${SHARED_DIR:-${COMPANY_DIR}/public}/task_board.md"
ARCHIVE="${SHARED_DIR:-${COMPANY_DIR}/public}/task_board_archive.md"
DRY_RUN=0
[ "$1" = "--dry-run" ] && DRY_RUN=1

[ ! -f "$BOARD" ] && echo "No task_board.md found" && exit 1

# Extract done + cancelled rows from the ## Tasks section (not Directions or Instructions)
# The parseTaskBoard logic treats numeric IDs as tasks; D*/I* are directions/instructions.
DONE_ROWS=$(awk '
    /^## Tasks/ { in_tasks=1; next }
    /^## /      { in_tasks=0; next }
    in_tasks && /^\|/ {
        # Skip header and separator rows
        if ($0 ~ /^\| ID/ || $0 ~ /^\|--/) next
        # Match done or cancelled status column
        if (tolower($0) ~ /\| *(done|cancelled|canceled) *\|/) print
    }
' "$BOARD")

DONE_COUNT=$(echo "$DONE_ROWS" | grep -c "^|" 2>/dev/null || echo 0)
[ -z "$DONE_ROWS" ] && DONE_COUNT=0

if [ "$DONE_COUNT" -eq 0 ]; then
    echo "No done/cancelled tasks to archive."
    exit 0
fi

echo "Found ${DONE_COUNT} done/cancelled task(s) to archive."

if [ "$DRY_RUN" -eq 1 ]; then
    echo "[DRY RUN] Would archive:"
    echo "$DONE_ROWS"
    exit 0
fi

# Append done rows to archive file
if [ ! -f "$ARCHIVE" ]; then
    {
        echo "# Task Board Archive"
        echo ""
        echo "## Archived Tasks"
        echo "| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |"
        echo "|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|"
    } > "$ARCHIVE"
fi
echo "$DONE_ROWS" >> "$ARCHIVE"

# Rewrite task_board.md: keep all sections intact, only removing done rows from ## Tasks
# Use awk to stream the file, printing everything except done task rows
awk '
    /^## Tasks/ { in_tasks=1 }
    /^## /      { if (!/^## Tasks/) in_tasks=0 }
    in_tasks && /^\|/ {
        if ($0 ~ /^\| ID/ || $0 ~ /^\|--/) { print; next }
        if (tolower($0) ~ /\| *(done|cancelled|canceled) *\|/) next  # skip done/cancelled rows
    }
    { print }
' "$BOARD" > "${BOARD}.tmp" && mv "${BOARD}.tmp" "$BOARD"

REMAINING=$(awk '
    /^## Tasks/ { in_tasks=1; next }
    /^## /      { in_tasks=0; next }
    in_tasks && /^\|/ && !/^\| ID/ && !/^\|--/ { count++ }
    END { print count+0 }
' "$BOARD")

echo "Archived ${DONE_COUNT} done/cancelled task(s) → task_board_archive.md"
echo "Active Tasks section now has ${REMAINING} task(s)."
