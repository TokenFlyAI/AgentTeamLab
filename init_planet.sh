#!/bin/bash
# init_planet.sh — Create a new planet with agent scaffolding
# Usage: bash init_planet.sh <planet-name> ["agent1 agent2 agent3"]
#
# Creates the full planet directory structure with agents, shared culture,
# output dirs, and optionally a git worktree for merged codebase.

PLANET_NAME="$1"
AGENTS="${2:-alice bob charlie dave eve}"
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
PLANET_DIR="${COMPANY_DIR}/planets/${PLANET_NAME}"

if [ -z "$PLANET_NAME" ]; then
  echo "Usage: $0 <planet-name> [\"agent1 agent2 agent3\"]"
  echo ""
  echo "Examples:"
  echo "  $0 my-startup                           # 5 default agents"
  echo "  $0 research-lab \"alice bob charlie\"      # 3 custom agents"
  echo "  $0 game-studio \"lead art code qa\"        # 4 custom agents"
  exit 1
fi

if [ -d "$PLANET_DIR" ]; then
  echo "Error: Planet already exists: $PLANET_NAME"
  echo "Directory: $PLANET_DIR"
  exit 1
fi

echo "Creating planet: ${PLANET_NAME}"
echo "Agents: ${AGENTS}"
echo ""

# Create directory skeleton
mkdir -p "${PLANET_DIR}/output/shared"/{task_outputs,reports,merged,artifacts}
mkdir -p "${PLANET_DIR}/data/ceo_inbox/processed"
mkdir -p "${PLANET_DIR}/shared"/{announcements,team_channel,sops,plans,knowledge}

# Create shared culture files
cat > "${PLANET_DIR}/shared/task_board.md" << 'TASKEOF'
# Task Board

## Directions (Long-term Goals)

| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |
|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|

## Tasks

| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |
|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|
TASKEOF

cat > "${PLANET_DIR}/shared/consensus.md" << 'CONSEOF'
# Team Culture & Decisions Board

*(Shared behavioral norms and strategic decisions — managed via API at /api/consensus)*

## Core Behavioral Norms (Must Follow)

| ID | Type | Norm | Date |
|----|------|------|------|

## Strategic Decisions & Commitments

| ID | Type | Decision | Date |
|----|------|----------|------|
CONSEOF

cat > "${PLANET_DIR}/shared/knowledge.md" << 'KNOWEOF'
# Shared Knowledge Base

*(Technical facts, architecture decisions, and analysis results)*
KNOWEOF

# Copy agent_instructions from kalshi-traders if available, otherwise create minimal
if [ -f "${COMPANY_DIR}/planets/kalshi-traders/shared/agent_instructions.md" ]; then
  cp "${COMPANY_DIR}/planets/kalshi-traders/shared/agent_instructions.md" "${PLANET_DIR}/shared/"
  echo "Copied agent_instructions.md from kalshi-traders"
else
  cat > "${PLANET_DIR}/shared/agent_instructions.md" << 'INSTREOF'
# Agent Instructions

## Work Cycle
1. Check inbox for messages
2. Check task board for assigned/open tasks
3. Do meaningful work
4. Update status.md with progress
5. Write deliverables to output/

## Output
- Personal deliverables: write to your `output/` folder
- Collaborative results: write to `../../output/shared/merged/`
INSTREOF
fi

echo "normal" > "${PLANET_DIR}/shared/company_mode.md"
echo '{"max_agents":5,"enabled":true,"interval_seconds":30,"dry_run":true,"dry_run_sleep":120,"mode":"smart","selection_mode":"deterministic"}' > "${PLANET_DIR}/shared/smart_run_config.json"

# Create team directory
{
  echo "# Team Directory"
  echo ""
  echo "| Agent | Role |"
  echo "|-------|------|"
  for agent in $AGENTS; do
    echo "| ${agent} | TBD |"
  done
} > "${PLANET_DIR}/shared/team_directory.md"

echo "gemini" > "${PLANET_DIR}/shared/executor_config.md"

# Internal public symlink for ../../public/ relative paths from agents
ln -s shared "${PLANET_DIR}/public"

# Create agent scaffolding
for agent in $AGENTS; do
  mkdir -p "${PLANET_DIR}/agents/${agent}"/{chat_inbox/processed,knowledge,logs/cycles}
  mkdir -p "${PLANET_DIR}/output/${agent}"
  ln -s "../../output/${agent}" "${PLANET_DIR}/agents/${agent}/output"

  echo "status: idle" > "${PLANET_DIR}/agents/${agent}/heartbeat.md"
  touch "${PLANET_DIR}/agents/${agent}/status.md"
  touch "${PLANET_DIR}/agents/${agent}/todo.md"

  cat > "${PLANET_DIR}/agents/${agent}/prompt.md" << PROMPTEOF
# ${agent} — [Role TBD]

Edit this file to define ${agent}'s role, responsibilities, and behavior.
PROMPTEOF

  cat > "${PLANET_DIR}/agents/${agent}/persona.md" << PERSONAEOF
# ${agent}

## Identity
- **Name**: ${agent}
- **Role**: TBD
- **Planet**: ${PLANET_NAME}

## Personality
Edit this file to define ${agent}'s personality and working style.
PERSONAEOF

  echo "  Created agent: ${agent}"
done

# Create company.md
cat > "${PLANET_DIR}/company.md" << COMPEOF
# ${PLANET_NAME}

Planet created on $(date +%Y-%m-%d).

Edit this file to define your civilization's policies and priorities.
COMPEOF

# Planet config
AGENT_COUNT=$(echo $AGENTS | wc -w | tr -d ' ')
cat > "${PLANET_DIR}/planet_config.json" << EOF
{
  "name": "${PLANET_NAME}",
  "description": "New planet — edit this description",
  "created": "$(date +%Y-%m-%d)",
  "agent_count": ${AGENT_COUNT}
}
EOF

# Create git worktree for merged codebase (orphan branch — agent code only, not platform)
if git -C "${COMPANY_DIR}" rev-parse --git-dir >/dev/null 2>&1; then
  echo ""
  echo "Setting up codebase worktree (orphan branch)..."
  BRANCH_NAME="planet/${PLANET_NAME}/codebase"
  if ! git -C "${COMPANY_DIR}" rev-parse --verify "${BRANCH_NAME}" >/dev/null 2>&1; then
    # Create orphan branch without switching branches (uses plumbing commands)
    EMPTY_TREE=$(git -C "${COMPANY_DIR}" hash-object -t tree /dev/null)
    COMMIT=$(git -C "${COMPANY_DIR}" commit-tree "$EMPTY_TREE" -m "Initialize ${PLANET_NAME} codebase (empty)")
    git -C "${COMPANY_DIR}" branch "${BRANCH_NAME}" "$COMMIT" 2>/dev/null
  fi
  git -C "${COMPANY_DIR}" worktree add "${PLANET_DIR}/output/shared/codebase" "${BRANCH_NAME}" 2>/dev/null && \
    echo "Codebase worktree on branch: ${BRANCH_NAME} (orphan — agent code only)" || \
    echo "Note: git worktree setup skipped (branch may already exist)"
fi

echo ""
echo "Planet '${PLANET_NAME}' created at ${PLANET_DIR}"
echo ""
echo "Next steps:"
echo "  1. Edit agent prompt.md and persona.md files in planets/${PLANET_NAME}/agents/"
echo "  2. Edit planets/${PLANET_NAME}/company.md with your civilization's policies"
echo "  3. Switch to it: bash switch_planet.sh ${PLANET_NAME}"
