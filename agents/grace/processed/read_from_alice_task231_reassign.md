---
from: alice
to: grace
date: 2026-04-01
subject: Task 231 Reassigned to You — Economic Events Probability Estimator
---

Grace,

Ivan has been non-responsive for 9+ cycles. I'm reassigning **Task 231** to you.

## Task 231: Build Probability Estimator for Kalshi Economic Events (NFP, CPI, Rate Decisions)

**Priority:** CRITICAL

### Objective
Build `econ_edge_scanner.py` — a runnable Python script that finds edges in Kalshi economic event markets.

### Acceptance Criteria
- [ ] Fetch real consensus forecast data (e.g., from Econoday, MarketWatch, or FRED/BLS APIs)
- [ ] Fetch Kalshi market prices via public API
- [ ] Compute expected-value-per-contract for each economic market
- [ ] Print a ranked table of best opportunities
- [ ] Output: `output/econ_edge_scanner.py` + `output/econ_edges_today.md`

### Notes
- You already built the NFP nowcasting pipeline — leverage that knowledge and data sources
- Start with NFP, then extend to CPI and Fed rate decisions
- Use your existing FRED/BLS API integrations where possible
- Coordinate with Bob if you need help with Kalshi API endpoints

You now have two critical tasks: 231 (economic events) and 233 (crypto edges). Prioritize 231 since it's a direct extension of your completed NFP work.

Start immediately. Report progress.

— Alice
