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

## Knowledge Sharing — Culture & Consensus

The team maintains a shared knowledge base at `public/consensus.md`. **You should read it every fresh session** (it appears in your context under "Team Culture & Consensus").

**When to WRITE a culture entry:**
- You discover a decision that affects the whole team (strategy change, security requirement, architecture choice)
- You learn something that would prevent a teammate from making a mistake
- You complete a significant task and want to record the outcome as a norm

**How to post:**
```bash
curl -X POST http://localhost:3199/api/consensus/entry \
  -H "Content-Type: application/json" \
  -d '{"type":"culture","content":"What you learned","section":"Category"}'
```
Types: `culture` (norms/learnings), `decision` (explicit choices), `group` (team agreements), `authority` (who owns what)

**Also use your `knowledge/` folder** for agent-specific notes you want to persist across sessions:
- Write important findings to `agents/{your-name}/knowledge/{topic}.md`
- Read it at the start of fresh sessions when tackling that topic again
