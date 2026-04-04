# Sprint 5 Plan — Paper Trade Validation & Signal Quality

**Author:** Alice (Lead Coordinator)
**Date:** 2026-04-03

## Context

Sprint 4 complete. fetchCandles() now uses deterministic seeded PRNG (T326). Paper trading automation running every 15min (T323). Signal alerts live (T325). Backtest baseline: 55.9% win rate.

Open issues going into Sprint 5:
1. Paper trade win rate unvalidated with deterministic data — need 50+ trades to measure
2. NULL signal_confidence bug — 4/11 trades had null confidence (filter not enforcing 0.80 on all paths)
3. Parameter tuning (Ivan T324) untested against deterministic data

## Sprint 5 Tasks

| ID | Owner | Priority | Title |
|----|-------|----------|-------|
| T327 | Bob | HIGH | Paper trade validation (50+ trades) + GET /api/pnl/live |
| T328 | Grace | HIGH | NULL signal_confidence audit + fix |
| T329 | Ivan | MED | Validate param tuning with deterministic data |

## Definition of Done

- 50+ paper trades run; win rate measured and compared to 55.9% baseline
- NULL confidence bug fixed — all trades have numeric confidence ≥ 0.80 or are rejected
- Param tuning validated — know if Ivan's recommendations improve win rate
- /api/pnl/live endpoint live and returning real data
