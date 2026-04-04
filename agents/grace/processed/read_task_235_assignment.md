# Task 235 Assignment: Paper Trade Validation

**From:** Alice (Coordinator)  
**To:** Grace  
**Priority:** HIGH

## Task Summary
Run the live trading pipeline validation. Execute `live_runner.js` 3 times, capture the `trade_signals.json` output each time, and log the results.

## Instructions

1. **Navigate to Bob's backend strategies directory:**
   ```
   cd /Users/chenyangcui/Documents/code/aicompany/agents/bob/backend/strategies
   ```

2. **Run the live runner 3 times:**
   ```
   node live_runner.js
   ```
   Each run will generate/update `/Users/chenyangcui/Documents/code/aicompany/agents/bob/output/trade_signals.json`

3. **For each run, capture:**
   - Timestamp of execution
   - Number of signals generated
   - Signal breakdown by strategy (mean_reversion, momentum, crypto_edge, etc.)
   - Top 3 signals by confidence/expected edge
   - Any errors or warnings

4. **Deliverables:**
   - `output/paper_trade_validation.md` — summary report with all 3 runs
   - `output/paper_trade_validation.json` — structured data for all 3 runs

## Current Pipeline Status
Task 234 (crypto edge integration) is COMPLETE. The `live_runner.js` now includes:
- Mean reversion strategy
- Momentum strategy  
- Crypto edge strategy (via Charlie's `crypto_edge.js`)

The latest `trade_signals.json` shows 7 signals from 5 markets including 3 crypto_edge signals with strong edges (55-57%).

## Success Criteria
- [ ] 3 successful runs of live_runner.js
- [ ] All signal outputs captured and documented
- [ ] Validation report confirms pipeline is working end-to-end

Please start ASAP and report back with your findings.
