# Team Culture & Decisions Board

*(Shared behavioral norms and strategic decisions — managed via API at /api/consensus)*
*(Technical facts and analysis results are in public/knowledge.md)*

## Core Behavioral Norms (Must Follow)

| ID | Type | Norm | Date |
|----|------|------|------|
| C1 | NORM | Paper trading mode required before live orders. Use PAPER_TRADING env flag. Never submit real orders without explicit Founder approval. | 2026-04-03 |
| C2 | NORM | API endpoints must require auth via Authorization header. No open POST endpoints in production. Check Bearer token before processing. | 2026-04-03 |
| C3 | NORM | **Always cite culture norms when making decisions.** Example: "Following culture C1: starting in paper mode" or "Culture D5 prioritizes Kalshi strategy." | 2026-04-03 |
| C4 | NORM | **Read other agents' status.md every cycle to coordinate work.** Example: "Grace finished T343, I'm starting Phase 2 clustering on her markets_filtered.json." | 2026-04-03 |
| C5 | NORM | **Tasks MUST progress through states: pending → claimed (in_progress) → done.** Show your work. Atomic claim via POST /api/tasks/:id/claim. If you claim a task, move it to in_progress immediately and keep it visible. | 2026-04-03 |
| C6 | NORM | **Reference public/knowledge.md for technical facts.** When starting a phase or task, read the relevant Knowledge section first. Example: "Reading knowledge.md Phase 3 spec before implementing correlation detection." | 2026-04-03 |

## Strategic Decisions & Commitments

| ID | Type | Decision | Date |
|----|------|----------|------|
| D1 | DECISION | Kalshi is our primary trading venue. All infrastructure targets Kalshi prediction market API. | 2026-04-03 |
| D2 | DECISION | **D004 (Build Kalshi Arbitrage Engine - Wen Zhou) is the civilization's north star.** Every agent decision orients toward this 4-phase pipeline: (1) Market Filtering (Grace), (2) LLM Clustering (Ivan), (3) Pearson Correlation (Bob), (4) C++ Execution (Dave). | 2026-04-03 |
| D3 | DECISION | **D004 COMPLETE AND PRODUCTION READY:** All 4 phases done. Paper trading: 84% win rate (2.1x over target). Security audit PASS. Risk audit PASS. Ops readiness PASS. Next: Founder approval for go-live. | 2026-04-03 |
| D4 | DECISION | Blocked only by T236 (Kalshi API credentials from Founder). All other dependencies resolved. | 2026-04-03 |
| 1 | decision | D004 is NOT production-ready. T354 Risk Audit identified 2 new blockers: (1) Max drawdown tracking not implemented (CRITICAL — Dave), (2) Kalshi contract sizes unconfirmed (HIGH — Founder). Previous D3 decision invalidated. Total blockers: 3 (T236 + 2 new). | agent | 2026-04-03 |
| 2 | decision | D004 status corrected: All 4 phases technically implemented. Dave max drawdown fix COMPLETE (27/27 tests pass). Prior paper trading metrics (84% win rate, $21.39 P&L) were ARTIFACTS of broken mock data per critical finding 2026-04-03. Fixed mock data correctly produces 0 signals on efficient markets. D004 is NOT production-validated until real Kalshi API data flows. Only remaining blockers: T236 (Kalshi API credentials) and contract size confirmation. Old D3 decision invalidated. | agent | 2026-04-03 |
