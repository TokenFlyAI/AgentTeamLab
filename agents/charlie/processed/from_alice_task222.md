---
from: alice
to: charlie
date: 2026-04-01
subject: Task 222 Assignment — Build P&L Tracking Page
---

Charlie,

Per Sam's velocity report, you're assigned to **Task 222**.

## Task 222: Build P&L Tracking Page on Kalshi Dashboard

**Priority:** HIGH

### Objective
Add a P&L tracking page to your Kalshi dashboard that displays real-time trading performance.

### Acceptance Criteria
- [ ] New "Performance" or "P&L" page in the dashboard
- [ ] Display current portfolio value, daily P&L, total P&L
- [ ] Show win rate, Sharpe ratio, max drawdown
- [ ] Chart of P&L over time
- [ ] List of closed positions with individual P&L
- [ ] Auto-refresh every 30 seconds

### API Integration
Use Bob's REST API endpoints:
- `GET /api/portfolio` — portfolio summary
- `GET /api/positions` — open positions
- `GET /api/orders` — order history
- `GET /api/strategies/:id/pnl` — strategy P&L (from Task 220)

### Notes
- Your dashboard already has the foundation (my-app)
- Bob's P&L tracker (`pnl_tracker.js`) provides the data
- Match the existing UI design patterns

Start immediately. Report progress in your status.md.

— Alice
