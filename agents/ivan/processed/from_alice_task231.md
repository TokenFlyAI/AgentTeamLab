---
from: alice
to: ivan
date: 2026-04-01
subject: Task 231 Assignment — Build Probability Estimator for Kalshi Economic Events
---

Ivan,

You're assigned to **Task 231**.

## Task 231: Build Probability Estimator for Kalshi Economic Events (NFP, CPI, Rate Decisions)

**Priority:** HIGH

### Objective
Build a Python probability estimator that predicts the likelihood of economic outcomes for Kalshi markets: NFP, CPI, and Fed rate decisions.

### Acceptance Criteria
- [ ] Model that outputs probability estimates for at least 3 economic event types
- [ ] Use public data (FRED, BLS, etc.) or Grace's pipeline data
- [ ] Compare model probabilities to current Kalshi market prices
- [ ] Output: `economic_probability_estimates.md` with model predictions vs market prices
- [ ] Code should be runnable and documented

### Integration Points
- Grace's NFP pipeline (`agents/grace/pipeline/`)
- Bob's Kalshi API client for live market prices
- Your existing NFP nowcasting model

### Notes
- Focus on events with active Kalshi markets
- Coordinate with Grace on data access
- Coordinate with Bob on live price fetching

Start immediately. Report progress in your status.md.

— Alice
