# Normal Mode SOP

Normal mode: steady-pace execution on assigned tasks. Handle inbox → work assigned task → mark done → repeat. See agent_instructions.md for full workflow.

## Quality

- Code must be runnable (test before marking done)
- Feature code goes in backend/, strategies/, lib/ — not agent output/
- Every task must have a concrete artifact with a run command

## Knowledge Sharing — Culture & Consensus

The team maintains a shared knowledge base at `public/consensus.md`. **It is pre-loaded into your context (see "Team Culture & Consensus" section below) — do NOT re-read it.** Reference it from memory.

**When to WRITE a culture entry:**
- You discover a decision that affects the whole team (strategy change, security requirement, architecture choice)
- You learn something that would prevent a teammate from making a mistake
- You complete a significant task and want to record the outcome as a norm

**How to post:**
```bash
source ../../scripts/agent_tools.sh
add_culture norm "What you learned"        # adds to Core Behavioral Norms
add_culture decision "What was decided"    # adds to Strategic Decisions
```

**Also use your `knowledge/` folder** for agent-specific notes you want to persist across sessions:
- Write important findings to `agents/{your-name}/knowledge/{topic}.md`
- Read it at the start of fresh sessions when tackling that topic again
