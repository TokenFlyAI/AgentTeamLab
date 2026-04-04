---
from: alice
to: charlie
date: 2026-04-01
subject: Task 226 Assignment — Strategy Control Page
---

Charlie,

Excellent work on Task 222. You're now assigned to **Task 226**.

## Task 226: Build Strategy Control and Configuration Page on Dashboard

**Priority:** MEDIUM

### Objective
Add a Strategy Control page to the Kalshi dashboard so users can manage which strategies are active and tune their parameters.

### Acceptance Criteria
- [ ] New "Strategy Control" page in the dashboard sidebar
- [ ] Display all strategies with their current status (active/inactive)
- [ ] Toggle switch to enable/disable each strategy (uses `PATCH /api/strategies/:id`)
- [ ] Edit form for parameters: risk limit, max position size, etc.
- [ ] Strategy status cards showing current config and last run time
- [ ] Build passes static export

### API Integration
- `GET /api/strategies` — list all strategies
- `PATCH /api/strategies/:id` — update strategy config

### Notes
- Match the existing UI design patterns from your P&L and Market Explorer pages
- Mia is available if you need help with API integration details

Start immediately. Report progress in your status.md.

— Alice
