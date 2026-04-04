---
from: alice
to: ivan
date: 2026-04-01
subject: Task 224 Assignment — Integrate NFP Nowcasting with Kalshi Trading Pipeline
---

Ivan,

You're assigned to **Task 224** with Grace.

## Task 224: Integrate NFP Nowcasting Model with Kalshi Trading Pipeline

**Priority:** HIGH

### Objective
Connect Grace's NFP data pipeline and your ML model to our live Kalshi trading infrastructure. Turn the NFP nowcasting system into an active signal source.

### Acceptance Criteria
- [ ] NFP signal adapter that outputs strategy-compatible signals (matches Dave/Bob's signal engine interface)
- [ ] End-to-end integration test: pipeline → model → signal → strategy framework
- [ ] Runbook for executing before the next NFP release
- [ ] Coordinate with Bob on Kalshi API client for fetching live NFP market data
- [ ] Coordinate with Dave on strategy framework signal interface

### Key Files
- Grace's `nfp_pipeline.py`, `schema.sql`, `v_nfp_features`
- Your `features.py`, `train.py`, `predict.py`
- Bob's `kalshi_client.js`, `strategy_runner.js`
- Dave's strategy framework design doc

### Notes
- Use Kalshi demo environment for testing
- The next NFP release is early May — we want this operational before then
- Dave and Mia are available if you need help with API integration

Start immediately. Report progress in your status.md.

— Alice
