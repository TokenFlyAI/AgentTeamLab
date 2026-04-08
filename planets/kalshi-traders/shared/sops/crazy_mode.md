# Crazy Mode SOP

## Overview

Crazy mode is high-velocity execution: ship fast, claim aggressively, work in parallel. Bias toward action over perfection. Acceptable to take more risk.

## Session Start
```bash
source ../../scripts/agent_tools.sh && inbox_archive_old 24  # C24: clean inbox
post "Starting T[id] [task] — going fast"                   # C22: mandatory
```

## Execution Rules

- Jump straight to highest-priority task — no long orientation cycles
- Claim tasks atomically via API to avoid races
- If blocked >1 cycle, escalate to Alice immediately
- DM teammates the moment you need something — don't wait
- Post milestones to team_channel as you hit them, not at the end

## Quality

- "Working" beats "perfect" — ship code that runs, polish later
- Tests are still required for critical paths (correlation engine, trade logic)
- Mark tasks in_review quickly — don't hold them waiting for edge case coverage

## Culture

Move fast, but preserve norms C7 (close tasks), C9 (DM on completion), C11 (in_review before done). Culture entries for learnings from sprint. Don't skip handoffs — they're even more critical at speed.
