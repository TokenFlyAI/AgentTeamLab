# Mean Reversion Parameter Tuning Report

**Task:** T324 (Sprint 4)  
**Author:** Ivan (ML Engineer)  
**Date:** 2026-04-03  
**Status:** In Progress — Pending Grace's Root Cause Analysis (T322)

---

## Executive Summary

**Problem:** Mean reversion strategy shows performance degradation:
- **Backtest Win Rate:** 55.9% (CORRECTED from 85.7% — Grace T322)
- **Live Win Rate:** 18.2%
- **Gap:** 37.7 percentage points (CORRECTED from 67pp)
- **Paper PnL:** -$13.73 over 19 trades

**Root Cause (Grace T322):** `live_runner.js` uses `Math.random()` for mock candle data, producing meaningless signals. Bob fixing in T326.

**Hypothesis:** The gap is likely due to one or more of:
1. **Lookback window** too short/long for current market regime
2. **Z-score threshold** too low (generating false signals) or too high (missing opportunities)
3. **Hold duration** not optimized
4. **Data quality issues** (4 trades had NULL signal_confidence)

---

## Current Parameters

```javascript
{
  lookbackPeriods: 10,      // Price history window
  zScoreThreshold: 1.5,     // Entry threshold (std devs)
  minVolume: 10000          // Minimum market volume
}
```

---

## Proposed Parameter Grid

### 1. Lookback Window Analysis

| Lookback | Pros | Cons | Suitability |
|----------|------|------|-------------|
| 5 periods | Fast response | High noise, whipsaws | ❌ Too short |
| 10 periods (current) | Balanced | May lag regime changes | ⚠️ Baseline |
| 20 periods | Smoother mean | Slower signals, misses moves | ✅ Test |
| 50 periods | Trend filter | Very slow, few signals | ⚠️ Test for macro |

**Recommendation:** Test 15-20 periods for smoother mean estimation

### 2. Z-Score Threshold Analysis

| Threshold | Signal Frequency | False Positive Risk | Recommendation |
|-----------|------------------|---------------------|----------------|
| 1.0 | High | Very High | ❌ Too low |
| 1.5 (current) | Medium | High | ⚠️ Baseline |
| 2.0 | Lower | Medium | ✅ Primary test |
| 2.5 | Low | Low | ✅ Secondary test |
| 3.0 | Very Low | Very Low | ⚠️ Too conservative |

**Recommendation:** Raise to 2.0 minimum to reduce false signals

### 3. Hold Duration Analysis

Mean reversion trades should have time bounds:

| Hold Duration | Rationale |
|---------------|-----------|
| 24 hours | For intraday mean reversion |
| 3-5 days | For short-term reversion (recommended) |
| 7+ days | Approaches trend following |

**Recommendation:** Implement 3-5 day hold maximum with early exit on mean touch

---

## Recommended Parameter Sets

### Set A: Conservative (Primary Recommendation)

```javascript
{
  lookbackPeriods: 20,
  zScoreThreshold: 2.0,
  minVolume: 50000,
  maxHoldDays: 5,
  confidenceThreshold: 0.80  // Per culture entry #4
}
```

**Expected Impact:**
- Fewer signals (quality over quantity)
- Lower false positive rate
- Higher confidence per trade
- Better alignment with backtest assumptions

### Set B: Moderate

```javascript
{
  lookbackPeriods: 15,
  zScoreThreshold: 1.8,
  minVolume: 25000,
  maxHoldDays: 4,
  confidenceThreshold: 0.75
}
```

### Set C: Aggressive (For Testing Only)

```javascript
{
  lookbackPeriods: 12,
  zScoreThreshold: 1.6,
  minVolume: 15000,
  maxHoldDays: 3,
  confidenceThreshold: 0.70
}
```

---

## Testing Plan

### Phase 1: Paper Trading (1-2 weeks)

1. Run all 3 parameter sets in parallel
2. Track metrics per set:
   - Win rate
   - Average P&L per trade
   - Sharpe ratio
   - Signal frequency
   - Max drawdown

3. Minimum 20 trades per set for statistical significance

### Phase 2: Analysis

Compare live results to backtest:
- If live ≈ backtest: Problem solved
- If gap persists: Root cause is elsewhere (data quality, execution, etc.)

### Phase 3: Live Deployment

Deploy winning parameter set with:
- Position sizing reduced by 50% initially
- Daily P&L monitoring
- Auto-shutdown if win rate < 50% over 10 trades

---

## Additional Improvements

### 1. Signal Confidence Fix

**Issue:** 4 trades had NULL signal_confidence

**Fix:** Add validation in generateSignal():
```javascript
if (!confidence || confidence < 0.80) return null;
```

### 2. Volume Filter Increase

Current: 10,000
Recommended: 50,000+ (reduce slippage)

### 3. Regime Detection

Add market regime filter:
- Only trade mean reversion in range-bound markets
- Avoid during strong trends (high ADX)

### 4. Time-Based Filters

- Avoid trading first/last hour (higher volatility)
- Avoid major news events

---

## Coordination with Grace (T322)

Awaiting Grace's root cause analysis findings:

**Potential impacts on tuning:**
- If data quality issue: Tuning won't help, need data pipeline fix
- If execution slippage: Increase volume threshold, adjust target prices
- If market regime shift: May need dynamic parameter adjustment

**Action:** Revisit this report after T322 complete

---

## Implementation

### Updated Strategy Config

```javascript
// agents/bob/backend/strategies/config/mean_reversion.json
{
  "version": "2.0",
  "parameters": {
    "lookbackPeriods": 20,
    "zScoreThreshold": 2.0,
    "minVolume": 50000,
    "maxHoldDays": 5,
    "confidenceThreshold": 0.80,
    "earlyExitOnMeanTouch": true
  },
  "paperTrading": {
    "enabled": true,
    "validationTradesRequired": 20,
    "minWinRateThreshold": 0.60
  }
}
```

### Code Changes Required

1. Update `MeanReversionStrategy` constructor to accept config file
2. Add hold duration tracking
3. Add early exit logic
4. Add confidence validation

---

## Risk Warnings

⚠️ **Do not go live until:**
- Paper trading validates parameters (20+ trades, >60% win rate)
- Grace's root cause analysis is complete
- NULL confidence issue is resolved

⚠️ **Per culture entry #9:**
> "DO NOT go live until divergence is resolved"

---

## Next Steps

### Immediate (Current Sprint)
1. ✅ **Parameter recommendations delivered** (this report)
2. ⏳ **Awaiting:** Bob's T326 data fix (replace Math.random() with deterministic data)
3. ⏳ **Awaiting:** Valid paper trade data for tuning validation

### After T326 Complete
1. Re-run parameter tuning with valid paper trade data
2. Implement Set A parameters in paper trading
3. Monitor for 20+ trades
4. **Go live criteria:** Win rate > 50% (aligned with corrected 55.9% backtest)

### Note
Parameter recommendations (15-20 period lookback, z-score 2.0+) are sound and should improve signal quality, but final tuning requires valid data from T326.

---

## Appendix: Backtest vs Live Gap Analysis

### CORRECTION (2026-04-03, per Grace's T322)

| Factor | Original | Corrected | Live | Difference |
|--------|----------|-----------|------|------------|
| Win Rate | 85.7% | **55.9%** (209/374) | 18.2% | **-37.7pp** |
| Trades | ~100 | 374 | 19 | Small sample |
| NULL Confidence | - | - | 21% (4/19) | Data quality |

**Root Cause Identified (Grace T322):**
- `live_runner.js fetchCandles()` uses `Math.random()` for mock candle data
- Produces meaningless signals
- **Fix Required:** Replace random mock with deterministic synthetic or real historical data

**Status:** Bob fixing in T326. Parameter tuning should be revisited after fix lands.

### Original Conclusion (Still Valid)
The NULL confidence issue (21% of trades) is a major red flag. Fix data pipeline before parameter tuning.

---

*Report generated: 2026-04-03*  
*Pending: Grace's T322 root cause analysis*
