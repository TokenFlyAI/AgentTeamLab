# NULL signal_confidence Audit — T328

**Generated:** 2026-04-03  
**Analyst:** Grace (Data Engineer)  
**Task:** T328 — Find and fix NULL signal_confidence bug  

---

## Executive Summary

**ROOT CAUSE IDENTIFIED:** Two bugs in the data pipeline cause signal confidence to be lost:

1. **live_runner.js** (line 404-411): Trade log output does NOT include confidence field
2. **pnl_tracker.js** (line 75): Hardcodes `signal_confidence: null` when processing Bob's trade format

**Impact:** 4 of 11 mean_reversion trades (36%) have NULL confidence in the database, violating culture entry #4 (confidence ≥ 0.80 threshold).

---

## Data Flow Analysis

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Strategy Gen   │────▶│  SignalEngine    │────▶│  PositionSizer  │
│  (has confidence)│     │  (validates ≥0.8) │     │  (adds sizing)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   SQLite DB     │◄────│  pnl_tracker.js  │◄────│ paper_trade_log │
│ (NULL confidenc)│     │ (BUG: null hardcd)│     │ (missing conf)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               ▲
                               │
                    ┌──────────┴──────────┐
                    │   live_runner.js    │
                    │ (BUG: no confidence │
                    │  in trade output)   │
                    └─────────────────────┘
```

---

## Bug 1: live_runner.js — Missing Confidence in Trade Log

**Location:** `agents/bob/backend/strategies/live_runner.js` lines 404-411

**Current Code:**
```javascript
trades: approvedSignals.map(s => ({
  ticker: s.ticker || s.marketId,
  side: s.side,
  contracts: s.sizing?.contracts || 1,
  price: s.currentPrice,
  strategy: s.strategy,
  timestamp: new Date().toISOString(),
})),
```

**Problem:** The `confidence` field is not included in the trade object.

**Fix:** Add confidence and other signal metadata:
```javascript
trades: approvedSignals.map(s => ({
  ticker: s.ticker || s.marketId,
  side: s.side,
  contracts: s.sizing?.contracts || 1,
  price: s.currentPrice,
  strategy: s.strategy,
  confidence: s.confidence,  // ADD THIS
  expectedEdge: s.expectedEdge,  // ADD THIS
  timestamp: new Date().toISOString(),
})),
```

---

## Bug 2: pnl_tracker.js — Hardcoded NULL Confidence

**Location:** `agents/pat/output/pnl_tracker.js` line 75

**Current Code:**
```javascript
// Bob's format: { trades: [...] }
for (const trade of data.trades) {
    trades.push({
        ticker: trade.ticker,
        market_title: null,
        direction: trade.side,
        entry_price: trade.price,
        exit_price: null,
        contracts: trade.contracts,
        strategy: trade.strategy,
        signal_confidence: null,  // BUG: Hardcoded null!
        status: 'open',
        source_file: sourceFile,
        entry_timestamp: trade.timestamp,
        exit_timestamp: null
    });
}
```

**Problem:** Even if live_runner.js is fixed, pnl_tracker.js ignores the confidence value.

**Fix:** Read confidence from trade data with fallback validation:
```javascript
signal_confidence: trade.confidence != null ? trade.confidence : null,
```

---

## Bug 3: signal_engine.js — Missing Null Check (Defense in Depth)

**Location:** `agents/bob/backend/strategies/signal_engine.js` line 54

**Current Code:**
```javascript
_validateSignal(signal) {
  if (!signal) return false;
  if (signal.confidence < this.minConfidence) return false;
  // ...
}
```

**Problem:** While `null < 0.8` evaluates to `true` (rejecting null confidence), this is implicit and fragile. An explicit check is safer.

**Fix:** Add explicit null/undefined check:
```javascript
_validateSignal(signal) {
  if (!signal) return false;
  if (signal.confidence == null) return false;  // ADD THIS
  if (signal.confidence < this.minConfidence) return false;
  // ...
}
```

---

## Additional Code Paths Audited

| File | Function | Confidence Handling | Status |
|------|----------|---------------------|--------|
| `mean_reversion.js` | generateSignal() | Calculates: `Math.min(Math.abs(zScore) / 3, 0.95)` | ✅ OK |
| `nfp_nowcast.js` | generateSignal() | Calculates: `Math.min(edgeAbs * 0.5 + 0.3, 0.95)` | ✅ OK |
| `econ_edge.js` | generateSignal() | Calculates: `Math.min(edgeAbs * 0.5 + 0.3, 0.95)` | ✅ OK |
| `signal_engine.js` | scan() | Validates with `_validateSignal()` | ⚠️ Needs null check |
| `position_sizer.js` | sizeSignals() | Preserves with `{ ...signal, sizing }` | ✅ OK |
| `live_runner.js` | main() | **Missing in trade log output** | ❌ BUG |
| `pnl_tracker.js` | parseTradeFile() | **Hardcoded null** | ❌ BUG |
| `paper_trades_db.js` | recordTrade() | Preserves: `trade.confidence != null ? trade.confidence : null` | ✅ OK |

---

## Fix Implementation

### Fix 1: signal_engine.js

```javascript
_validateSignal(signal) {
  if (!signal) return false;
  if (signal.confidence == null) return false;  // NEW: Explicit null check
  if (signal.confidence < this.minConfidence) return false;
  if (signal.expectedEdge < this.minEdge) return false;
  if (!["yes", "no"].includes(signal.side)) return false;
  if (!["entry", "exit", "hold"].includes(signal.signalType)) return false;
  return true;
}
```

### Fix 2: live_runner.js

```javascript
trades: approvedSignals.map(s => ({
  ticker: s.ticker || s.marketId,
  side: s.side,
  contracts: s.sizing?.contracts || 1,
  price: s.currentPrice,
  strategy: s.strategy,
  confidence: s.confidence,  // NEW
  expectedEdge: s.expectedEdge,  // NEW
  timestamp: new Date().toISOString(),
})),
```

### Fix 3: pnl_tracker.js

```javascript
// Line 75: Change from:
signal_confidence: null,
// To:
signal_confidence: trade.confidence != null ? trade.confidence : null,
```

---

## Validation Steps

After fixes are applied:

1. Run `live_runner.js` with `--execute` flag
2. Check `paper_trade_log.json` — trades should have `confidence` field
3. Run `pnl_tracker.js` to sync to database
4. Query database: `SELECT signal_confidence FROM paper_trades WHERE entry_timestamp > '2026-04-03'`
5. Verify no NULL values: `SELECT COUNT(*) FROM paper_trades WHERE signal_confidence IS NULL`

---

## Recommendations

1. **Apply all three fixes** to ensure confidence flows through the entire pipeline
2. **Add database constraint** (if possible): `CHECK (signal_confidence IS NOT NULL)`
3. **Add logging** when signals are rejected due to null confidence
4. **Backfill** existing NULL confidence trades if historical data is available

---

*Audit by Grace (Data Engineer) | Task T328 | 2026-04-03*
