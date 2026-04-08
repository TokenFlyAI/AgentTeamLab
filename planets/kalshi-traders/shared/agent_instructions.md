# Shared Agent Instructions — All Agents Must Follow

**This file is part of your static prefix (KV cached). `consensus.md` is injected in your live snapshot. Do NOT re-read either with tool calls — they're already in your context. Reference them from memory.**

## 0. TRUST THE DELTA — Don't Scan What the System Already Delivers

**The system guarantees you'll be told about any changes.** Every resume cycle injects a `Context Delta` block listing exactly what changed: new inbox messages, task status changes, culture updates, teammate status changes.

**Rules:**
- Do **NOT** proactively read your inbox directory, task board, heartbeats, or teammates' status.md on every cycle
- Only read files explicitly listed in the delta ("New message from X", "Task T5xx changed status")
- Only read a teammate's status.md when the delta reports they changed, or when you need to coordinate a handoff
- If the delta is empty → nothing changed → go straight to your current work
- This is how the KV cache works: your full prior context is cached; only the tiny delta is new tokens

**Consequence:** Proactive scans (reading inbox dir, grepping task board, scanning heartbeats) waste ~2,000 tokens per cycle with no benefit. The delta already has everything.

---

## 1. RESUME vs FRESH START — What to Skip

| What | Fresh Start | Resume Cycle |
|------|-------------|--------------|
| `status.md` | **Read** (recover working memory) | Skip (already in context) |
| task board (grep) | **Skip** (tasks pre-loaded in Live Snapshot) | Skip (delta shows changes) |
| `consensus.md` | **Skip** (pre-loaded in Live Snapshot) | Skip (in cache) |
| `agent_instructions.md` | **Skip** (pre-loaded as static prefix) | Skip (in cache) |
| `knowledge.md` | **Read once** (not in snapshot) | Skip (already in context) |
| inbox messages | **Read** (Live Snapshot shows previews) | Read only if delta shows new messages |
| peer `status.md` | Read only if coordination needed | Read only if delta shows teammate change |

**Rule: If the Live State Snapshot (injected below) already has the data — do NOT re-read with a tool call.**

## 2. THREE SHARED RESOURCES

### A. knowledge.md (Technical Facts) — path: `../../public/knowledge.md` or `read_knowledge`
- Contains technical algorithms, deliverables, status of each D004 phase
- **When to read:** Once per fresh session (not on resume — it's already in prior context).
- **Example:** "Reading knowledge.md Phase 3 spec… Pearson correlation required, r>0.75 threshold, output correlation_pairs.json"
- **Reference in status.md:** "Reading knowledge.md Phase 2 — LLM clustering algorithm, semantic relationships important"

### B. public/consensus.md (Culture & Decisions)
- **Already injected into your context via live snapshot (full file). Do NOT re-read.**
- Contains behavioral norms (C1+) and strategic decisions (D1+). Check your live context for the latest sprint decisions.
- **When to reference:** Before each decision point — use what's already in context
- **Example behaviors to cite:**
  - C3: "Following C3: citing culture in decision — prioritizing D004 over other work"
  - C4: "Following C4: read Grace's status.md — she completed T343 markets_filtered.json, ready for Ivan"
  - C5: "Following C5: claiming T343 and moving to in_progress (don't skip to done)"
  - C6: "Following C6: referenced knowledge.md Phase 1 filtering algorithm"
  - C22: "Following C22: posting to team_channel — starting my task"
  - C23: "Following C23: checking grace's output/ directly — no need to wait for DM"
- **Decisions to align with:**
  - D2: D004 is north star — all decisions orient toward 4-phase pipeline
  - **Current sprint**: Check the `### Culture & Decisions` section in your live context snapshot

### C. agents/{other_agents}/status.md (Peer Coordination)
- Read a teammate's status.md **only when** the delta reports they changed, or when actively handing off work
- **Do NOT scan all heartbeats or peer status.md on every cycle** — the delta already reports any teammate status changes
- **Example:** 
  - Delta says "**Teammates**: grace:working→idle" → now read grace's status.md to see what she delivered
  - Delta is empty → no peer reads needed this cycle, go straight to your work

## 3. TASK WORKFLOW (Must Show In-Progress)

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

## 4. STATUS.MD TEMPLATE

**REPLACE (overwrite) status.md each cycle — do NOT append.** The prior session's content is already in your context via KV cache. Appending to status.md makes it grow unboundedly, wasting tokens every fresh start (dave's status.md ballooned to 200+ lines of stale history). Keep it to the current task only.

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

## 5. CITING CULTURE IN DECISIONS

When you make a decision, explicitly state which culture norm or strategy decision you're following:

**Examples:**
- "Following D2 (D004 north star): prioritizing Phase 1 market filtering over other work"
- "Following C3: documenting this decision in status.md so it's visible"
- "Following C4: checked Grace's status.md — her markets_filtered.json is ready for me"
- "Following C5: claiming T344 and immediately moving to in_progress to show my work"
- "Following C6: read knowledge.md Phase 2 clustering spec before implementing"

## 6. SPRINT FOCUS (Current)

**Sprint status is always current in your live context snapshot** (`consensus.md` is injected via the context API every fresh start). Check the `### Culture & Decisions` section in your starting context for the latest sprint decisions and task statuses.

Your own open tasks are listed in `**Your open tasks**` at the top of your starting context — that's the authoritative source, pulled live from the task board.

## 7. OUTPUT — WHERE TO WRITE DELIVERABLES

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

## 8. WORK PRIORITY ORDER

1. Founder commands (from_ceo messages) — always highest priority
2. Unread inbox messages (already shown in delta) — handle before starting new work
3. Your assigned open/in_progress tasks (from task board)
4. Unassigned tasks you can claim (if no assigned work)

**After handling any message**: call `inbox_done <filename>` to move it to processed/. This keeps your inbox clean and prevents the backlog from growing unboundedly. CEO/Lord messages are never auto-archived — you must `inbox_done` them manually after acting on them.

---

## 9. CRITICAL: CLOSE TASKS WHEN DONE (C7)

**Mandatory.** Never leave finished work in open/in_progress. Use agent_tools.sh (faster than raw curl):

```bash
source ../../scripts/agent_tools.sh
task_inreview 542 "Ready for review: output/report.md"   # Write deliverable → mark in_review → DM reviewer
task_review 542 approve "Independently reproduced"        # Reviewers: approve (→ done)
task_review 542 reject "Missing test coverage"            # Reviewers: reject (→ in_progress with feedback)
```

**Flow:** write deliverable → `task_inreview` → DM tina/olivia → they approve/reject → done.
**Self-close exception:** alice may mark own coordination/report tasks done directly.
**Code tasks:** also run `cp -r output/backend/* ../../output/shared/codebase/backend/ 2>/dev/null`

---

## 10. AGENT TOOLS (Use These!)

Load the agent toolkit at the start of each cycle for easier operations:

```bash
source ../../scripts/agent_tools.sh
```

(Agents run from their own directory, so `../../` reaches the platform root where `scripts/` lives.)

### Available Commands:

| Command | What it does |
|---------|-------------|
| `my_tasks` | Show your assigned open/in-progress/in-review tasks |
| `read_task 542` | Read full details of a specific task (title, status, description, notes) |
| `task_claim 542` | Atomically claim a task |
| `task_done 542 "Delivered pipeline.js"` | Mark task done with result note |
| `task_inreview 542 "Ready for review"` | Mark task in_review (request approval) |
| `task_review 542 approve "Verified"` | Approve a task (reviewers: olivia, tina, alice) |
| `task_review 542 reject "Missing tests"` | Reject a task with feedback |
| `task_progress 542 "Phase 1 complete"` | Update progress note |
| `task_list` | List all open/in-progress/in-review tasks |
| `create_task "Title" bob high "desc"` | Create a new regular task, optionally assigned |
| `create_direction "Title" "desc"` | Create a long-term Direction (D-prefix, sets civilization goals) |
| `create_instruction "Title" "desc"` | Create a persistent Instruction (I-prefix, always-on context) |
| `dm bob "Data is ready"` | Send DM to another agent |
| `post "Phase 1 complete — 47 markets filtered"` | Post milestone to team channel |
| `announce "Sprint complete"` | Post civilization-wide announcement |
| `broadcast "Sprint complete"` | DM all agents simultaneously |
| `read_inbox` | Read your unprocessed inbox messages |
| `inbox_done <filename>` | Mark an inbox message as processed (move to processed/) |
| `inbox_archive_old [hours]` | Archive messages older than N hours to processed/ (default 24h; skips CEO/Lord msgs) |
| `read_peer ivan` | Read another agent's status.md |
| `list_outputs grace` | List grace's output files (C23: self-unblock before DMing) |
| `read_channel 10` | Read last 10 team_channel posts |
| `read_knowledge` | Read shared knowledge base |
| `read_culture` | Read consensus norms and decisions |
| `add_culture norm "What you learned"` | Add norm to consensus.md (use `decision` for decisions) |
| `pipeline_status` | Check D004 phase file status (per-agent output paths) |
| `log_progress "Fixed bug X"` | Write timestamped note to logs/progress.log (NOT status.md — C18) |

**Use these instead of raw curl commands.** They handle formatting, error checking, and agent detection automatically.

---

## 11. COLLABORATION QUICK REFERENCE

```bash
source ../../scripts/agent_tools.sh
post "Starting T[id] [task] — [plan]"              # C22: start announcement (MANDATORY)
post "T[id] done — [deliverable]. DM'd [teammate]" # C22: completion announcement (MANDATORY)
list_outputs grace                                  # C23: self-unblock before DMing
dm dave "signals.json ready in output/"             # C9: handoff notification
handoff ivan 542 output/pairs.json "node run.js"    # C21: formal handoff (DM+Post+in_review auto)
check_handoff ../../output/grace/markets.json       # verify incoming artifact (C15/C20)
read_peer bob                                       # C4: only when delta reports change
cp combined.md ../../output/shared/merged/          # shared cross-agent deliverables
```

**Key rules:**
1. **Post twice per task** (start + done) — silent agents are invisible (C22)
2. **Check output/ before DMing** — self-unblock first (C23)
3. **DM on completion** — don't leave teammates waiting (C9)
4. **handoff auto-marks in_review** — `handoff` handles it; if not using handoff, call `task_inreview` manually (C11)
5. **Every decision cites culture** — D1+ north star, C3 always (C3)
6. **Never leave tasks open** when work is done (C7)
