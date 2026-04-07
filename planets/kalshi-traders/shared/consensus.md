# Team Culture & Decisions Board

*(Shared behavioral norms and strategic decisions — managed via API at /api/consensus)*
*(Technical facts and analysis results are in public/knowledge.md)*

## Core Behavioral Norms (Must Follow)

| ID | Type | Norm | Date |
|----|------|------|------|
| C1 | NORM | Paper trading mode required before live orders. Use PAPER_TRADING env flag. Never submit real orders without explicit Founder approval. | 2026-04-03 |
| C2 | NORM | API endpoints must require auth via Authorization header. No open POST endpoints in production. Check Bearer token before processing. | 2026-04-03 |
| C3 | NORM | **Always cite culture norms when making decisions.** Example: "Following culture C1: starting in paper mode" or "Culture D5 prioritizes Kalshi strategy." | 2026-04-03 |
| C4 | NORM | **Read a teammate's status.md only when the delta reports they changed, or when actively coordinating a handoff.** Do NOT scan all peer status.md files every cycle — the resume delta delivers teammate changes automatically. | 2026-04-03 |
| C5 | NORM | **Tasks MUST progress through states: pending → claimed (in_progress) → done.** Show your work. Atomic claim via POST /api/tasks/:id/claim. If you claim a task, move it to in_progress immediately and keep it visible. | 2026-04-03 |
| C6 | NORM | **Reference public/knowledge.md for technical facts.** When starting a phase or task, read the relevant Knowledge section first. Example: "Reading knowledge.md Phase 3 spec before implementing correlation detection." | 2026-04-03 |

## Strategic Decisions & Commitments

| ID | Type | Decision | Date |
|----|------|----------|------|
| D1 | DECISION | Kalshi is our primary trading venue. All infrastructure targets Kalshi prediction market API. | 2026-04-03 |
| D2 | DECISION | **D004 (Build Kalshi Arbitrage Engine - Wen Zhou) is the civilization's north star.** Every agent decision orients toward this 4-phase pipeline: (1) Market Filtering (Grace), (2) LLM Clustering (Ivan), (3) Pearson Correlation (Bob), (4) C++ Execution (Dave). | 2026-04-03 |
| D3 | DECISION | **D004 PIPELINE VALIDATED (synthetic data).** Sprint 4 end-to-end: 3 markets → 2 filtered → 4 clusters → 4 correlation pairs → 160 simulated trades (46.3% win rate, +$5.22). Tina QA: APPROVED. NOT yet validated with real Kalshi data — blocked by T236 (API credentials). | 2026-04-07 |
| D4 | DECISION | Blocked only by T236 (Kalshi API credentials from Founder). All other dependencies resolved. | 2026-04-03 |
| C7 | NORM | **Always close tasks when done.** After completing work, immediately mark the task done via API: `curl -X PATCH http://localhost:3199/api/tasks/{id} -H "Content-Type: application/json" -d '{"status":"done"}'`. Add a brief result note. Never leave finished work in open/in_progress. | 2026-04-04 |
| C8 | NORM | **Run and verify your code.** Don't just write code — execute it, check output, fix errors. Every deliverable must have a verification step. Paper trade pipeline must be runnable end-to-end. | 2026-04-04 |
| D5 | DECISION | **The trading system must be runnable and verifiable.** Not just code files — the paper trading pipeline must execute end-to-end: market filter → cluster → correlate → generate signals → simulate trades → produce P&L report. Every agent should be able to run `node live_runner.js --paper` and get real output. | 2026-04-04 |
| C9 | NORM | **DM teammates when your work affects theirs.** When you finish a deliverable that another agent depends on, DM them immediately: `source ../../scripts/agent_tools.sh && dm bob "correlation_pairs.json updated — 30 new signals, ready for your backtest"`. Don't wait for them to discover it. | 2026-04-04 |
| C10 | NORM | **Use team_channel for status broadcasts.** Post to `../../public/team_channel/` when you hit milestones, find bugs, or need help. Format: `YYYY_MM_DD_HH_MM_SS_from_{name}.md`. Other agents read this every cycle (C4). Example: "Sprint 3 QA: found data mismatch in Phase 2→3 handoff, investigating." | 2026-04-04 |
| C11 | NORM | **Review before done.** Mark tasks `in_review` (not `done`) and DM a reviewer (olivia, tina, or alice). Reviewers: verify deliverable exists, check output quality, then approve via `POST /api/tasks/:id/review`. Rejected tasks get feedback DM'd back to assignee. | 2026-04-04 |
| C12 | NORM | **Executor model.** Use absolute paths or `../../public/` relative paths for shared resources. Shell commands work normally. Executor (claude/kimi/codex/gemini) is configured via executor.txt or executor_config.md. | 2026-04-06 |
| C13 | NORM | **Handoff = DM + team_channel + task state update.** When you complete work that unblocks a teammate: (1) DM them directly with what you produced and where it is, (2) Post to team_channel, (3) Update your task to in_review or done. Don't leave teammates guessing. | 2026-04-06 |
| C14 | NORM | **Read output/ before starting dependent tasks.** Before starting a task that depends on another agent's work, check their output/ directory. Don't wait for a DM if the file is already there. Self-unblock when possible. | 2026-04-06 |
| C15 | NORM | **Reviewers must verify artifact freshness, not just existence.** Check timestamps or freshness markers before approving a handoff so stale upstream files do not silently pass review. | 2026-04-06 |
| C16 | NORM | **Every handoff must include artifact path, run command, and freshness marker.** The receiving agent should be able to reproduce the deliverable and confirm it belongs to the current sprint without reconstructing context from timestamps alone. | 2026-04-06 |
| C17 | NORM | **A QA rejection opens an immediate blocker retro and explicit escalation.** When QA rejects or blocks a deliverable, the reviewer must record the missing artifact or failed check and notify the coordinator instead of waiting silently for recovery. | 2026-04-06 |
| C18 | NORM | **REPLACE (overwrite) status.md every cycle — never append.** Old content is already in KV cache from your prior cycles. Appending creates unbounded token growth. Keep status.md to current task only (~30 lines max). | 2026-04-07 |
| 9 | decision | **Sprint 6 COMPLETE.** All 6 tasks done: T814 (bob normalization), T815 (ivan cluster audit), T816 (grace Phase 1 fixture), T817 (dave replay harness — deterministic, 3 invariants pass), T818 (tina QA gates), T819 (charlie readiness dashboard — port 3461). Pipeline is live-data-ready. Only blocker: T236 (Kalshi API credentials). Next: Sprint 7 planning. | 2026-04-07 |
| 10 | decision | **Sprint 7 focus: Live pipeline run + verification.** Now that all Sprint 6 infrastructure is done, run the full D004 pipeline using live-shaped fixtures end-to-end. T851 (alice retro), T852 (bob E2E run with live fixtures), T853 (dave replay harness with live signals), T854 (sam metrics). Milestone: demonstrate zero-rework readiness by running Phase 1→4 on Grace's filtered_markets_live_fixture.json. | 2026-04-07 |
