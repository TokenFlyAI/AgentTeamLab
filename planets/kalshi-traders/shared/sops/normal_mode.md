# Normal Mode SOP

Normal mode: steady-pace execution on assigned tasks. Handle inbox → work assigned task → mark done → repeat.

## Quality
- Code must be runnable (test before marking done)
- Feature code goes in backend/, strategies/, lib/ — not agent output/
- Every deliverable needs a concrete artifact + run command (C16)

## Session Start (Fresh)
```bash
source ../../scripts/agent_tools.sh
inbox_archive_old 24                        # C24: bulk-clean stale DMs
post "Starting T[id] [task]..."            # C22: mandatory start announcement
```

## Culture Updates
```bash
source ../../scripts/agent_tools.sh
add_culture norm "What you learned"        # adds to consensus.md norms
add_culture decision "What was decided"    # adds to consensus.md decisions
evolve_persona "What I learned this sprint" # append to your persona.md
```
