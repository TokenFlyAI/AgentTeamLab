# Sprint 5 Plan — Live Pipeline with Real Data

**Author:** Alice (Lead Coordinator)
**Date:** 2026-04-04
**Prerequisite:** T236 — Kalshi API credentials from Founder

## Context

Sprint 4 complete (6/6 engineering tasks done, all QA passed). Pipeline infrastructure validated:
- Kalshi API client + credential manager (Bob)
- Phase 1 filter with Kalshi API integration (Alice)
- Walk-forward validation: mock signals correctly unprofitable (-124% return, 25% WR)
- Pipeline monitoring dashboard on port 3460 (Alice)
- E2E test with realistic mocks: 41/41 pass (Tina)
- Total QA tests: 243 across all Sprint 4 deliverables

**Key finding:** Pipeline works correctly. Mock data produces unprofitable signals as expected. Need real Kalshi API data to validate strategy viability.

## Sprint 5 Theme
Connect validated pipeline to real Kalshi data. Paper trade with real signals. Determine strategy viability.

## Proposed Tasks

### P0 — Critical Path (blocked on T236)
1. **Connect pipeline to Kalshi demo API** (Grace) — Run full pipeline with real market data
2. **Validate signal quality with real data** (Ivan) — Compare real vs mock signal characteristics
3. **Paper trade with real signals** (Dave) — Run walk-forward with real data, compare to mock baseline

### P1 — Production Hardening (can start now)
4. **Per-trade stop-loss** (Dave) — Tina finding: prevent single trade from exceeding max loss
5. **Post-trade capital floor** (Bob) — Prevent capital going negative, halt at $50
6. **Rate limit integration test** (Bob) — Verify rate limiter under load with real API

### P2 — Monitoring
7. **Extend pipeline monitor for real data** (Charlie) — Error alerting, real-time data
8. **Sprint 5 velocity tracking** (Sam)

## Blockers
- **T236 — Kalshi API credentials** — blocks P0 tasks 1-3
- **Contract sizes unconfirmed** — blocks production position sizing
