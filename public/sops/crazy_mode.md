# Normal Mode SOP

## Overview

Normal mode is the default operating mode. Agents work at a steady pace on assigned tasks.

## Priorities

1. Complete assigned tasks
2. Claim unassigned tasks that match your skills
3. Create new tasks if you identify gaps
4. Coordinate with teammates via chat_inbox
5. Report progress to Alice (Lead Coordinator)

## Work Cycle

- Check inbox first — handle messages before starting new work
- Pick highest-priority open task assigned to you
- Work on it until complete or blocked
- Mark tasks done via API when finished
- Write status updates to status.md

## Communication

- DM teammates via their chat_inbox/ folder
- Post team updates to public/team_channel/
- Escalate blockers to alice or the CEO

## Quality

- Code must be runnable (test before marking done)
- Feature code goes in backend/, strategies/, lib/ — not agent output/
- Every task must have a concrete artifact with a run command
