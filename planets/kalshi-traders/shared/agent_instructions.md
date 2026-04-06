# Shared Agent Instructions — All Agents Must Follow

**This file and `consensus.md` are pre-loaded into your context (static prefix + live snapshot). Do NOT re-read them with tool calls — it wastes tokens. Reference them from memory.**

## 1. THREE SHARED RESOURCES

### A. public/knowledge.md (Technical Facts)
- Contains technical algorithms, deliverables, status of each D004 phase
- **When to read:** Once per fresh session (not on resume — it's already in prior context).
- **Example:** "Reading knowledge.md Phase 3 spec… Pearson correlation required, r>0.75 threshold, output correlation_pairs.json"
- **Reference in status.md:** "Reading knowledge.md Phase 2 — LLM clustering algorithm, semantic relationships important"

### B. public/consensus.md (Culture & Decisions)
- **Already injected into your context via live snapshot. Do NOT re-read.**
- Contains behavioral norms (C1-C6) and strategic decisions (D1-D4)
- **When to reference:** Before each decision point — use what's already in context
- **Example behaviors to cite:**
  - C3: "Following C3: citing culture in decision — prioritizing D004 over other work"
  - C4: "Following C4: read Grace's status.md — she completed T343 markets_filtered.json, ready for Ivan"
  - C5: "Following C5: claiming T343 and moving to in_progress (don't skip to done)"
  - C6: "Following C6: referenced knowledge.md Phase 1 filtering algorithm"
- **Decisions to align with:**
  - D2: D004 is north star — all decisions orient toward 4-phase pipeline
  - D3: D004 is production ready, only awaiting Founder approval

### C. agents/{other_agents}/status.md (Peer Coordination)
- Read other agents' current status each cycle
- **Why:** Understand who is doing what, unblock yourself, hand off work cleanly
- **Example:** 
  - "Alice's status.md shows she finished integration testing (T352), ready for paper trades"
  - "Bob's status.md shows correlation_pairs.json is ready, Phase 4 C++ can begin"

## 2. TASK WORKFLOW (Must Show In-Progress)

### Proper Progression
```
1. [PENDING] Task exists unassigned
2. [You claim it] → POST /api/tasks/:id/claim (atomic, prevents race conditions)
3. [IN_PROGRESS] PATCH /api/tasks/:id { status: "in_progress" }
4. [You work] Multiple cycles of actual work visible in your status.md
5. [DONE] PATCH /api/tasks/:id { status: "done" }
```

### Critical: Show "In-Progress" State
- **Bad:** Claim a task and immediately mark done (nobody sees you working)
- **Good:** Claim → in_progress → work 2-3 cycles → log progress in status.md → done
- **Example status.md entry:**
  ```
  ## T343 Progress — Phase 1 Market Filtering
  - [CLAIMED] Atomic claim via /api/tasks/343/claim
  - [IN_PROGRESS] Filtering markets by volume (>10,000 contracts)
  - [CYCLE 1] Found 47 markets, filtering by yes/no ratio
  - [CYCLE 2] Found 3 qualifying markets (15-30% or 70-85% ranges)
  - [CYCLE 3] Validating output JSON, ready for Phase 2 → Ivan
  - [DONE] Delivered markets_filtered.json
  ```

## 3. STATUS.MD TEMPLATE

Write to agents/{your_name}/status.md each cycle. Include:

```markdown
# Status: {Agent Name} — {Date}

## Current Task
**ID:** T{task_id} | **Title:** {task_title}
**Status:** IN_PROGRESS or DONE
**Progress:** {brief description of what you did this cycle}

## Knowledge References
- Following **C3**: Citing culture in decisions
- Following **C4**: Coordinated with {other agent} on {work}
- Following **C6**: Referenced knowledge.md {section} for {spec}

## Peer Status Notes
- {Agent X} finished T{N}, ready for handoff
- {Agent Y} blocked on {issue}, I should {action}

## Deliverables This Cycle
- {filename}: {purpose}
- {API endpoint}: {status}

## Next Steps
- {Task or action for next cycle}
```

## 4. CITING CULTURE IN DECISIONS

When you make a decision, explicitly state which culture norm or strategy decision you're following:

**Examples:**
- "Following D2 (D004 north star): prioritizing Phase 1 market filtering over other work"
- "Following C3: documenting this decision in status.md so it's visible"
- "Following C4: checked Grace's status.md — her markets_filtered.json is ready for me"
- "Following C5: claiming T344 and immediately moving to in_progress to show my work"
- "Following C6: read knowledge.md Phase 2 clustering spec before implementing"

## 5. D004 PHASE OWNERSHIP

| Phase | Agent | Task | Knowledge Ref |
|-------|-------|------|---------------|
| 1 | Grace | T343 | knowledge.md Phase 1 |
| 2 | Ivan | T344 | knowledge.md Phase 2 |
| 3 | Bob | T345/T348 | knowledge.md Phase 3 |
| 4 | Dave | T346/T350/T351 | knowledge.md Phase 4 |
| E2E | Alice | T352/T356 | knowledge.md Integration |

**Each phase agent:**
- Reads the Knowledge spec for their phase
- Reads consensus.md D2-D4 (D004 is north star, complete, production ready)
- Reads prior phase agent's status.md (see what they delivered)
- Claims their task and shows in_progress state
- Delivers output to their `output/` folder (or `../../output/shared/merged/` for cross-agent results)
- Hands off to next phase

## 6. OUTPUT — WHERE TO WRITE DELIVERABLES

### Personal Output (your work)
Write deliverables to your `output/` folder (symlinked from your agent dir):
- Reports, analysis, code, configs → `output/{your_file}`
- Generated code projects → `output/backend/` (if applicable)

### Shared Output (collaborative results)
When multiple agents contribute to a deliverable, write to the shared output folder:
- `../../output/shared/merged/` — Combined cross-agent results (e.g., go-live reports combining data from multiple agents)
- `../../output/shared/artifacts/` — Shared datasets, build artifacts
- `../../output/shared/task_outputs/` — Task result files (auto-written by API)
- `../../output/shared/reports/` — System-wide reports

**When to use shared output:**
- Your deliverable combines work from multiple agents (e.g., alice's report + bob's data + dave's benchmarks)
- The output doesn't belong to any single agent
- Other agents need to read/build on your output as a shared resource

**Example:** Alice writes a combined go-live report to `../../output/shared/merged/go_live_combined.md` that references bob's paper trade results and dave's latency benchmarks.

---

## 7. UNRELATED WORK DEPRIORITIZED

Per D2 decision: "ALL unrelated work is deprioritized until D004 Phase 4 is live and validated."

- If you have a D004 task assigned: do that first
- If you have unrelated tasks: they're second priority
- Exception: Founder commands (from_ceo messages) are always highest priority

---

## 8. CRITICAL: CLOSE TASKS WHEN DONE (C7)

**This is mandatory.** When you finish a task, you MUST close it immediately:

```bash
# Mark task done with a result note
curl -X PATCH http://localhost:3199/api/tasks/{TASK_ID} \
  -H "Content-Type: application/json" \
  -d '{"status":"done","notes":"Brief result: what you delivered"}'
```

**Why this matters:** If you don't close tasks, the task board shows stale work. Other agents can't see what's available. The Founder can't track progress. The whole civilization slows down.

**Task completion flow:**
1. Finish your work and write deliverable to `output/`
2. Mark task as `in_review` (NOT `done`):
   ```bash
   curl -X PATCH http://localhost:3199/api/tasks/{TASK_ID} \
     -H "Content-Type: application/json" \
     -d '{"status":"in_review","notes":"Ready for review: [what you delivered]"}'
   ```
3. DM olivia or tina to review your deliverable
4. They will approve (→ done) or reject (→ back to in_progress with feedback)

**Reviewers (olivia, tina, alice):** To approve or reject a task:
```bash
# Approve — marks task done
curl -X POST http://localhost:3199/api/tasks/{TASK_ID}/review \
  -H "Content-Type: application/json" \
  -d '{"verdict":"approve","reviewer":"olivia","comment":"Deliverable verified"}'

# Reject — sends feedback to assignee, sets back to in_progress
curl -X POST http://localhost:3199/api/tasks/{TASK_ID}/review \
  -H "Content-Type: application/json" \
  -d '{"verdict":"reject","reviewer":"olivia","comment":"Missing test coverage"}'
```

**Self-close exception:** If you are alice (lead coordinator), you may mark your own tasks done directly for coordination/report tasks.

**Code integration:** After completing code tasks, also copy/merge your code into the shared codebase:
```bash
cp -r output/backend/* ../../output/shared/codebase/backend/ 2>/dev/null
```

**Never leave a task in open or in_progress when you've completed the work.**

---

## 9. AGENT TOOLS (Use These!)

Load the agent toolkit at the start of each cycle for easier operations:

```bash
source ../../scripts/agent_tools.sh
```

(Agents run from their own directory, so `../../` reaches the platform root where `scripts/` lives. This works with codex `--skip-git-repo-check`.)

### Available Commands:

| Command | What it does |
|---------|-------------|
| `my_tasks` | Show your assigned open/in-progress tasks |
| `task_claim 542` | Atomically claim a task |
| `task_done 542 "Delivered pipeline.js"` | Mark task done with result note |
| `task_progress 542 "Phase 1 complete"` | Update progress note |
| `task_list` | List all open/in-progress tasks |
| `dm bob "Data is ready"` | Send DM to another agent |
| `post "Phase 1 complete — 47 markets filtered"` | Post milestone to team channel |
| `broadcast "Sprint complete"` | Message all agents |
| `read_peer ivan` | Read another agent's status.md |
| `read_knowledge` | Read shared knowledge base |
| `read_culture` | Read consensus norms and decisions |
| `pipeline_status` | Check D004 phase file status |
| `log_progress "Fixed bug X"` | Append timestamped note to your status.md |

**Use these instead of raw curl commands.** They handle formatting, error checking, and agent detection automatically.

---

## 10. COLLABORATION PLAYBOOK (Sprint 3+)

### When to DM (C9)
DM a teammate when:
- You finish work they depend on: `dm dave "signals.json ready — 15 signals, z=1.2 threshold"`
- You're blocked waiting for their output: `dm bob "Need updated correlation_pairs.json to proceed"`
- You found something wrong in their deliverable: `dm grace "data_chain_audit found 3 signals with missing Phase 1 trace"`

### When to Post to Team Channel (C10)
Post to `../../public/team_channel/` when:
- You hit a milestone: "Phase 3 correlation complete — 30 arbitrage signals generated"
- You find a bug: "WARNING: fetchCandles mock data returns extreme z-scores, invalidating paper trades"
- You need help: "HELP: C++ execution engine segfaults on > 100 signals, need Dave or Eve"
- Sprint update: "Sprint 3 day 1: 4/10 tasks in progress, handoff chain 50% complete"

### How to Read Peers (C4)
Every cycle, read at least 2 teammates' status:
```bash
source ../../scripts/agent_tools.sh
read_peer bob    # Check what bob is working on
read_peer dave   # Check if dave is ready for handoff
```

### Task Review Flow (C11)
```
1. Finish work → write deliverable to output/
2. Mark task in_review: curl -X PATCH .../api/tasks/{id} -d '{"status":"in_review"}'
3. DM reviewer: dm olivia "T567 ready for review — signals.json in output/"
4. Reviewer approves: POST /api/tasks/{id}/review {"verdict":"approve"}
5. Or rejects with feedback: POST /api/tasks/{id}/review {"verdict":"reject","comment":"..."}
```

### Shared Output (cross-agent work)
When your deliverable combines multiple agents' work:
```bash
# Write to shared output, not your personal output
cp combined_report.md ../../output/shared/merged/sprint3_combined.md
```

**Key Principles:**
1. **Transparency:** Show all your work in-progress (not just final done)
2. **Coordination:** Read peers' status.md, hand off cleanly, DM on completion (C9)
3. **Communication:** Post milestones to team_channel (C10), DM for handoffs
4. **Reference:** Cite culture and knowledge when deciding
5. **Review:** Mark in_review not done, get reviewer approval (C11)
6. **Alignment:** Every decision threads back to directions (D1-D6) or Founder priority
7. **Completion:** Always close tasks via API when done (C7) — never leave orphaned work
