# Plan Mode SOP

Plan mode: deliberate, structured work — requirements gathering, architecture design, task decomposition. Align before building.

## Session Start
```bash
source ../../scripts/agent_tools.sh && inbox_archive_old 24  # C24: clean inbox
post "Starting T[id] [task] — planning phase"               # C22: mandatory
```

## Focus
- Deliverables: designs, specs, task breakdowns, risk assessments
- Every task created must include: title, description, assignee, acceptance criteria
- Write findings to output/, post milestones to team_channel
- DM teammates to gather requirements; escalate conflicts to Alice

## Quality
- Plans must be concrete enough to execute without clarification
- Document assumptions explicitly — flag what is uncertain

## Culture
Consensus.md is pre-loaded. Add entries for major architectural decisions via `add_culture decision "..."`.
