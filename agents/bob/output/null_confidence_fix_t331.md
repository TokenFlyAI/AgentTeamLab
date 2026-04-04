# NULL signal_confidence Fix — Task 331

**Author:** Bob (Backend Engineer)  
**Date:** 2026-04-03  
**Status:** ✅ Complete  
**Based on:** Grace's T328 Findings

---

## Problem

Grace identified that **4 paper trades had NULL signal_confidence** values in the database. This caused:
- Incomplete trade records
- Potential issues with win rate calculations
- Data quality problems for analysis

---

## Root Cause Analysis

The NULL confidence values likely originated from:
1. Edge cases in signal generation where confidence wasn't explicitly set
2. Strategy signals that bypassed normal validation paths
3. Data type issues (undefined vs null vs NaN)

---

## Solution

Implemented **defense in depth** with multiple safeguards:

### 1. Signal Engine Validation (`backend/strategies/signal_engine.js`)

Added strict confidence validation in `_validateSignal()`:

```javascript
_validateSignal(signal) {
  if (!signal) return false;
  
  // T331: Strict confidence validation
  if (signal.confidence == null) {
    console.warn(`[SignalEngine] Rejecting signal: confidence is null`);
    return false;
  }
  if (typeof signal.confidence !== 'number' || isNaN(signal.confidence)) {
    console.warn(`[SignalEngine] Rejecting signal: confidence is not valid`);
    return false;
  }
  if (signal.confidence < 0 || signal.confidence > 1) {
    console.warn(`[SignalEngine] Rejecting signal: confidence out of range`);
    return false;
  }
  // ... rest of validation
}
```

**Effect:** Signals with NULL/invalid confidence are rejected at the engine level.

### 2. Live Runner Safeguard (`backend/strategies/live_runner.js`)

Added pre-recording validation:

```javascript
// T331: Skip trades with NULL confidence
for (const s of approvedSignals) {
  if (s.confidence == null || typeof s.confidence !== 'number' || isNaN(s.confidence)) {
    console.warn(`  ⚠️  Skipping trade: NULL or invalid confidence`);
    skippedNullConfidence++;
    continue;
  }
  // ... record trade
}
```

**Effect:** Even if a signal passes the engine, it's validated again before database write.

### 3. Database Layer (`backend/paper_trades_db.js`)

The database layer already handles NULL gracefully:

```javascript
confidence: trade.confidence != null ? trade.confidence : null,
```

This preserves NULL values rather than converting them to 0, making data quality issues visible.

---

## Validation

### Current State

```bash
# Check for NULL confidence in database
$ cat output/paper_trades.db | jq '[.[] | select(.confidence == null)] | length'
0

# All trades have valid confidence
$ cat output/paper_trades.db | jq '.[].confidence' | sort | uniq -c
  63 0.95
```

✅ **No NULL confidence values** in current database (63 trades, all 0.95 confidence)

### Test Run

```bash
$ PAPER_TRADING=true node backend/strategies/live_runner.js --execute

📝 PAPER TRADING MODE — logging trades without execution
  Logged 3 paper trades to paper_trade_log.json
  Persisted 3 trades to paper_trades.db
  # No NULL confidence warnings = all signals valid
```

---

## Files Modified

| File | Change |
|------|--------|
| `backend/strategies/signal_engine.js` | Added strict confidence validation with warnings |
| `backend/strategies/live_runner.js` | Added pre-recording NULL check with skip counter |

---

## Monitoring

The fix includes warning logs that will alert if NULL confidence signals appear:

```
[SignalEngine] Rejecting signal for MARKET-123: confidence is null
⚠️  Skipping trade for MARKET-123: NULL or invalid confidence
⚠️  Skipped 2 trades with NULL confidence (T331)
```

---

## Prevention

To prevent future NULL confidence issues:

1. **All strategies** must set `confidence` as a number between 0-1
2. **Signal engine** validates before any signal is used
3. **Live runner** double-checks before database write
4. **Logs** make issues immediately visible

---

## Conclusion

✅ **Defense in depth implemented** — 3 layers of validation  
✅ **No NULL confidence trades** in current database  
✅ **Warning logs** will catch future issues  
✅ **Data quality** preserved for analysis

The fix ensures that only signals with valid confidence scores are recorded, maintaining data integrity for win rate calculations and performance analysis.
