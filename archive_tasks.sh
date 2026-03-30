#!/bin/bash
# archive_tasks.sh — Move done tasks from task_board.md to task_board_archive.md
# Run manually or from a cron to keep the active board lean.
# Usage: bash archive_tasks.sh [--dry-run]

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
BOARD="${COMPANY_DIR}/public/task_board.md"
ARCHIVE="${COMPANY_DIR}/public/task_board_archive.md"
DRY_RUN=0
[ "$1" = "--dry-run" ] && DRY_RUN=1

[ ! -f "$BOARD" ] && echo "No task_board.md found" && exit 1

HEADER=$(grep -E "^#|^## |^\| ID|^\|--" "$BOARD")
DONE_ROWS=$(grep "^|" "$BOARD" | grep -iv "^| id\|^|--\|^| ---" | grep -i "| *done *|")
ACTIVE_ROWS=$(grep "^|" "$BOARD" | grep -iv "^| id\|^|--\|^| ---" | grep -iv "| *done *|")

DONE_COUNT=$(echo "$DONE_ROWS" | grep -c "^|" 2>/dev/null || echo 0)
[ -z "$DONE_ROWS" ] && DONE_COUNT=0

if [ "$DONE_COUNT" -eq 0 ]; then
    echo "No done tasks to archive."
    exit 0
fi

echo "Found ${DONE_COUNT} done task(s) to archive."

if [ "$DRY_RUN" -eq 1 ]; then
    echo "[DRY RUN] Would archive:"
    echo "$DONE_ROWS"
    exit 0
fi

# Append done rows to archive file
# NOTE: check file existence BEFORE >> redirect (>> creates the file before the block runs)
if [ ! -f "$ARCHIVE" ]; then
    {
        echo "# Task Board Archive"
        echo ""
        echo "## Archived Tasks"
        echo "| ID | Title | Description | Priority | Assignee | Status | Created | Updated | Notes |"
        echo "|----|-------|-------------|----------|----------|--------|---------|---------|-------|"
    } > "$ARCHIVE"
fi
echo "$DONE_ROWS" >> "$ARCHIVE"

# Rewrite task_board.md with only active rows
{
    echo "# Task Board"
    echo ""
    echo "## Tasks"
    echo "| ID | Title | Description | Priority | Assignee | Status | Created | Updated | Notes |"
    echo "|----|-------|-------------|----------|----------|--------|---------|---------|-------|"
    [ -n "$ACTIVE_ROWS" ] && echo "$ACTIVE_ROWS"
} > "$BOARD"

echo "Archived ${DONE_COUNT} done task(s) → task_board_archive.md"
echo "Active board now has $(echo "$ACTIVE_ROWS" | grep -c "^|" 2>/dev/null || echo 0) task(s)."
