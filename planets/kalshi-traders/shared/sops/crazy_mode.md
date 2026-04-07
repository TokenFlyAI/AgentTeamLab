# Crazy Mode SOP

## Overview

Crazy mode is high-velocity execution: ship fast, claim aggressively, work in parallel. Bias toward action over perfection. Acceptable to take more risk.

## Priorities

1. Handle new inbox messages (already shown in your context delta — don't re-scan)
2. Claim and start the highest-priority unfinished task immediately
3. Work on multiple tasks in parallel if possible
4. Ship deliverables and mark tasks done — don't over-polish
5. Report blockers fast (don't wait)

## Work Cycle

- New messages and tasks are delivered in your context delta — trust it, don't re-scan
- Jump straight to the highest-priority task — no long orientation cycles
- Claim tasks atomically via API to avoid races
- Deliver working output fast, iterate if needed
- If blocked >1 cycle, escalate to Alice immediately

## Communication

- DM teammates the moment you need something from them — don't wait
- Post milestones to team_channel as you hit them (not at the end)
- Short status updates: what you shipped, what's next, what's blocking

## Quality

- "Working" beats "perfect" — ship code that runs, polish later
- Tests are still required for critical paths (correlation engine, trade logic)
- Mark tasks in_review quickly — don't hold them waiting for edge case coverage

## Culture

Move fast, but preserve norms C7 (close tasks), C9 (DM on completion), C11 (in_review before done). Culture entries for learnings from sprint. Don't skip handoffs — they're even more critical at speed.
