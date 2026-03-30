#!/bin/bash
# check_taskboard_hook.sh — PreToolUse hook: show agent their latest relevant tasks
# Runs from agent's working directory (agents/{name}/)
TASKBOARD="../../public/task_board.md"
AGENT_NAME=$(basename "$(pwd)")

[ ! -f "$TASKBOARD" ] && exit 0

# Extract only open/in_progress rows (skip done/blocked/header/separator)
ACTIVE=$(grep "^|" "$TASKBOARD" | grep -iv "^| id\|^|--\|^| ---" | grep -iv "| *done *|")

[ -z "$ACTIVE" ] && exit 0

# P0/critical assigned to me — always show, urgent
MY_P0=$(echo "$ACTIVE" | grep -iE "critical|p0" | grep -i "| *${AGENT_NAME} *|" | tail -10)

# My latest assigned tasks (newest = highest row number = bottom of table), max 3
MY_TASKS=$(echo "$ACTIVE" | grep -i "| *${AGENT_NAME} *|" | tail -10)

# Latest unassigned tasks (for self-assignment), max 3
# Match rows where assignee column (col 5) is empty, a dash variant, or "unassigned"
UNASSIGNED=$(echo "$ACTIVE" | grep -E "\| *(—|-+|unassigned) *\|" | tail -10)

if [ -n "$MY_P0" ]; then
    echo "=== P0/CRITICAL TASKS ASSIGNED TO YOU — DROP EVERYTHING ==="
    echo "$MY_P0"
    echo ""
fi

if [ -n "$MY_TASKS" ]; then
    echo "=== YOUR LATEST ASSIGNED TASKS (focus on these) ==="
    echo "$MY_TASKS"
    echo ""
fi

if [ -z "$MY_TASKS" ] && [ -n "$UNASSIGNED" ]; then
    echo "=== LATEST UNASSIGNED TASKS (claim one) ==="
    echo "$UNASSIGNED"
    echo ""
fi

exit 0
