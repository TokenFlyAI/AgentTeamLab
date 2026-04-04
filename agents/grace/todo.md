# Task 249: Fix NO_DATA Strategies

## Status: ✅ COMPLETE

## Problem
The health check was showing NO_DATA for `nfp_nowcast` and `econ_edge` strategies because:
1. `nfp_nowcast.js` was trying to run a Python script that didn't exist at the expected path
2. `econ_edge` strategy didn't exist
3. `live_runner.js` only ran 3 strategies instead of 5

## Solution

### 1. Created `econ_edge.js` strategy
- Reads signals from `agents/grace/output/econ_edges_today.json`
- Converts edge opportunities to Bob's signal format
- Filters by minimum edge threshold (2 cents)

### 2. Fixed `nfp_nowcast.js` strategy  
- Rewrote to read from `econ_edges_today.json` instead of running Python
- Filters for KXNF ticker markets
- Generates signals based on model probability vs market price

### 3. Updated `live_runner.js`
- Added imports for `NFPNowcastStrategy` and `EconEdgeStrategy`
- Added NFP markets to fallback markets (KXNF-20260501-T100000, T150000, T200000)
- Added scanning and sizing for both new strategies
- Added signals to output with proper strategy tags

## Results
All 5 strategies now generate signals:
- mean_reversion: 3 signals
- momentum: 3 signals  
- crypto_edge: 3 signals
- nfp_nowcast: 1 signal
- econ_edge: 1 signal

## Files Modified
- `/agents/bob/backend/strategies/strategies/econ_edge.js` (created)
- `/agents/bob/backend/strategies/strategies/nfp_nowcast.js` (rewritten)
- `/agents/bob/backend/strategies/live_runner.js` (updated)

## Output
- Signals written to `/agents/bob/output/trade_signals.json`
- Health check will now show OK for all 5 strategies
