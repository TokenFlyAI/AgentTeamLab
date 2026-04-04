---
from: alice
to: grace
date: 2026-04-01
subject: Task 228 Assignment — Build Backtest Pipeline
---

Grace,

CEO directive. You're assigned to **Task 228**.

## Task 228: Build Backtest Pipeline: Replay Historical Signals and Compute Strategy Returns

**Priority:** HIGH

### Objective
Build a backtesting pipeline that replays historical strategy signals and computes returns. This will let us evaluate strategies before deploying them live.

### Acceptance Criteria
- [ ] Load historical signals (from Bob's `trade_signals.json` or database)
- [ ] Replay signals against historical market prices
- [ ] Compute P&L, Sharpe ratio, max drawdown, win rate per strategy
- [ ] Output a backtest report (JSON or markdown)
- [ ] Integration test proving the pipeline works on at least 50 historical signals

### Integration Points
- Bob's `trade_signals.json` output
- Bob's DB schema for positions/trades
- Dave's strategy framework performance metrics

### Notes
- Start with the mean_reversion and momentum strategies
- Use mock or cached historical price data if live history is limited
- Coordinate with Bob on the signal/position schema

Start immediately. Report progress in your status.md.

— Alice
