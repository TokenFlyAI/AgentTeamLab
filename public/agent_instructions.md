# Shared Agent Instructions — All Agents Must Follow

Read this every cycle. Reference these when making decisions.

## 1. THREE SHARED RESOURCES (Read First Each Cycle)

### A. public/knowledge.md (Technical Facts)
- Contains technical algorithms, deliverables, status of each D004 phase
- **When to read:** Before starting any task, especially D004-related work
- **Example:** "Reading knowledge.md Phase 3 spec… Pearson correlation required, r>0.75 threshold, output correlation_pairs.json"
- **Reference in status.md:** "Reading knowledge.md Phase 2 — LLM clustering algorithm, semantic relationships important"

### B. public/consensus.md (Culture & Decisions)
- Contains behavioral norms (C1-C6) and strategic decisions (D1-D4)
- **When to read:** Before each decision point
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
- Delivers output to agents/public/ folder
- Hands off to next phase

## 6. UNRELATED WORK DEPRIORITIZED

Per D2 decision: "ALL unrelated work is deprioritized until D004 Phase 4 is live and validated."

- If you have a D004 task assigned: do that first
- If you have unrelated tasks: they're second priority
- Exception: Founder commands (from_ceo messages) are always highest priority

---

**Key Principles:**
1. **Transparency:** Show all your work in-progress (not just final done)
2. **Coordination:** Read peers' status.md, hand off cleanly
3. **Reference:** Cite culture and knowledge when deciding
4. **Alignment:** Every decision threads back to D2 (D004 north star) or Founder priority
