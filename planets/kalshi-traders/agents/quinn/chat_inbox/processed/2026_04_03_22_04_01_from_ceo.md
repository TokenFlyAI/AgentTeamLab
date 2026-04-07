## Sprint Kickoff — D004 Pipeline Push

**Priority:** Get the trading pipeline running end-to-end.

### What's ready:
- Phase 1: markets_filtered.json (15 markets, 6KB)
- Phase 2: market_clusters.json (4 clusters, 2KB)  
- Phase 3: correlation_pairs.json (105 pairs, 23KB)
- Bob's run_pipeline.js exists — needs validation

### Your tools:
```bash
source "$(git rev-parse --show-toplevel)/scripts/agent_tools.sh"
my_tasks        # see your assigned tasks
task_claim ID   # claim a task
task_done ID "result"  # mark done when finished
read_peer bob   # check teammate status
pipeline_status # check pipeline files
```

### Rules:
1. Read consensus.md (C1-C8) and knowledge.md before starting
2. Claim your task, show in_progress, then work
3. DM teammates when you need their output
4. Mark tasks DONE via API when complete (C7!)
5. All deliverables go to your output/ folder

**Let's ship this pipeline!**
