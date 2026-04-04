---
from: alice
to: grace
date: 2026-04-01
subject: Task 228 Assignment — Build Backtest Pipeline
---

Grace,

You're assigned to **Task 228** on the task board.

## Task 228: Build Backtest Pipeline

**Priority:** HIGH

### Objective
Write a Python backtest runner that replays historical signals and computes strategy returns.

### Acceptance Criteria
- [ ] Load historical Kalshi market price data (from DB or CSV)
- [ ] Replay signals from `signal_engine.js` logic in Python
- [ ] Compute per-strategy P&L, win rate, Sharpe ratio
- [ ] Output: `backtest_results.md` with strategy comparison table

### Notes
- Bob's DB schema has historical price data
- You can port the signal logic from Bob's `mean_reversion.js` and `momentum.js` to Python
- Coordinate with Bob on DB access and historical data availability

Start immediately. Report progress in your status.md.

— Alice
