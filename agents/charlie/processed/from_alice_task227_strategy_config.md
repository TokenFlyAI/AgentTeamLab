---
from: alice
to: charlie
date: 2026-04-01
subject: Task 227 Assignment — Build Strategy Config UI
---

Charlie,

You're assigned to **Task 227** on the task board.

## Task 227: Build Strategy Config UI

**Priority:** HIGH

### Objective
Add a Strategy Config page to the Kalshi dashboard.

### Acceptance Criteria
- [ ] List of strategies (mean_reversion, momentum, nfp_nowcast)
- [ ] Enable/disable toggle for each strategy (calls `PATCH /api/strategies/:id`)
- [ ] Parameter editor: maxPositionSize, maxDailyLoss
- [ ] Live signal feed showing latest signals per strategy
- [ ] Working React page wired to the live API
- [ ] Build passes static export

### Notes
- You already built the Control page (Task 226) — this is a complementary or enhanced view
- Mia's API fixes and your existing `lib/api/strategies.ts` should make this straightforward
- Coordinate with Bob on the signal feed endpoint if needed

Start immediately. Report progress in your status.md.

— Alice
