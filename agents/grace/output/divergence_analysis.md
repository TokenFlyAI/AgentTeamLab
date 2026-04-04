# Backtest-to-Live Divergence Analysis — T322

**Generated:** 2026-04-03  
**Analyst:** Grace (Data Engineer)  
**Task:** T322 — Root cause the 67pp gap between backtest (85.7%) and live (18.2%) win rates  

---

## Executive Summary

**CRITICAL FINDING:** The 85.7% backtest win rate referenced in consensus is **incorrect**. The actual backtest win rate from `backtest_summary.json` is **55.9%** (209 wins / 374 trades). 

The "67pp gap" is actually a **37pp gap** (55.9% backtest vs 18.2% live). This is still significant and requires investigation, but the magnitude is half of what was reported.

| Metric | Backtest (Actual) | Paper Trade (Live) | Gap |
|--------|-------------------|-------------------|-----|
| Win Rate | 55.9% | 18.2% | **-37.7pp** |
| Total Trades | 374 | 11 | Sample size issue |
| Total PnL | +$92.60 | -$16.97 | Strategy failing live |
| Sharpe Ratio | 0.310 | N/A (insufficient data) | — |

---

## Root Cause Analysis

### 1. Look-Ahead Bias — **NOT DETECTED**

The backtest engine (`backtest/engine.py`) correctly uses only historical data up to the current point:

```python
# Line 120: Only use history up to current index
past = history[:i+1]
signals = signal_generator(market, snapshot, past)
```

The backtest does NOT use future data. Look-ahead bias is not the cause.

### 2. Data Source Mismatch — **CONFIRMED**

| Aspect | Backtest | Live Runner |
|--------|----------|-------------|
| **Data Source** | Synthetic historical data (90 days, 14 markets) | Fallback mock data OR Kalshi API |
| **Price History** | Full 90-day history per market | 7 days of synthetic candles |
| **Mean/StdDev** | Computed from 90 days | Computed from 7 days (randomized) |
| **Market Selection** | All 14 markets scanned | Top 5 by volume selected |

**Key Issue:** The live runner uses `fetchCandles()` which generates **randomized synthetic data** when API key is unavailable:

```javascript
// live_runner.js lines 185-193
async function fetchCandles(client, ticker) {
  if (USE_MOCK_FALLBACK) {
    const basePrice = ticker === "BTCW-25-DEC31" ? 16 : ...;
    return Array.from({ length: CANDLE_DAYS }, (_, i) => ({
      yes_close: basePrice + Math.floor(Math.random() * 10 - 5),  // RANDOM!
      // ...
    }));
  }
}
```

The `Math.random()` means **every run produces different mean/stddev values**, leading to inconsistent z-score calculations.

### 3. Signal Confidence NULLs — **CONFIRMED BUG**

**4 of 11 mean_reversion trades (36%) have NULL signal_confidence.**

This occurs because:

1. The `signal_engine.js` validates signals with `minConfidence: 0.80` (line 261 in live_runner.js)
2. But the paper trade log shows trades with confidence values below 0.80 (e.g., 0.2667, 0.5333)
3. The April 3 batch (4 trades) have **NULL confidence entirely**

**Root cause:** The confidence filtering happens in `SignalEngine.scan()`, but trades are being recorded before validation or the validation is being bypassed.

Looking at `execution_engine.js` line 110-114:
```javascript
async submitOrder(signal, market) {
  // No confidence check here!
  const price = signal.targetPrice || signal.currentPrice;
  // ...
}
```

The execution engine does not re-validate confidence before submitting orders.

### 4. Strategy Code Diff — **IDENTIFIED**

| Parameter | Backtest (Python) | Live (JS) |
|-----------|-------------------|-----------|
| zScoreThreshold | 1.5 | 1.0 (line 264) |
| minVolume | 10,000 | 1,000 |
| lookbackPeriods | 10 (default) | 7 days (CANDLE_DAYS) |

**The live runner uses a LOWER z-score threshold (1.0 vs 1.5)**, which means:
- More signals generated (lower bar)
- Lower quality signals (weaker mean reversion evidence)
- Lower confidence scores passed to position sizer

### 5. Position Sizing Impact — **CONFIRMED**

The position sizer (`position_sizer.js` line 66) applies confidence scaling:
```javascript
contracts = Math.floor(contracts * confidence);
```

With lower confidence from the reduced z-score threshold, position sizes are smaller, but more trades are taken. This increases transaction frequency without increasing edge.

### 6. Market Selection Bias — **CONFIRMED**

Backtest scans **all 14 markets**. Live runner selects **top 5 by volume** (line 237):
```javascript
const selectedMarkets = markets.slice().sort((a, b) => b.volume - a.volume).slice(0, Math.max(MIN_MARKETS, 5));
```

High-volume markets may have different mean-reversion characteristics than the full universe.

---

## Data Quality Issues

| Issue | Count | Impact |
|-------|-------|--------|
| NULL signal_confidence | 4/11 trades (36%) | HIGH — violates 0.80 threshold policy |
| momentum trades active (should be disabled) | 8/19 trades (42%) | MEDIUM — consensus says disabled |
| Randomized candle data | All live runs | HIGH — non-deterministic signals |
| zScoreThreshold mismatch | All mean_reversion | MEDIUM — lower quality signals |
| minVolume mismatch | All mean_reversion | LOW — more illiquid markets included |

---

## Fix Recommendations

### Immediate (P0)

1. **Fix NULL confidence bug**
   - Add validation in `execution_engine.js` `submitOrder()` to reject signals with confidence < 0.80
   - Add null check: `if (!signal.confidence || signal.confidence < 0.80) return null;`

2. **Align strategy parameters**
   - Change live_runner.js line 264: `zScoreThreshold: 1.5` (not 1.0)
   - Change live_runner.js: `minVolume: 10000` (not 1000)

3. **Disable momentum trades**
   - The 8 momentum trades in paper trading violate consensus entry #2
   - Remove momentum strategy from live_runner.js entirely

### Short-term (P1)

4. **Use deterministic candle generation**
   - Replace `Math.random()` with seeded PRNG or use actual Kalshi historical data
   - Current randomization makes signals non-repeatable

5. **Add signal logging**
   - Log every signal generated, filtered, and executed with full context
   - This will help debug why NULL confidence trades are slipping through

6. **Increase sample size**
   - 11 trades is statistically insignificant
   - Run paper trading for minimum 100 trades before evaluating strategy

### Medium-term (P2)

7. **Backtest with same parameters as live**
   - Re-run Python backtest with zScoreThreshold=1.0, minVolume=1000
   - Compare results to understand parameter sensitivity

8. **Implement out-of-sample validation**
   - The current backtest may be overfit to synthetic data
   - Reserve 30% of data for out-of-sample testing

---

## Updated Consensus

The consensus entry #2 states:
> "mean_reversion is our primary strategy (85.7% win rate in backtests)"

**This is incorrect.** The actual backtest win rate is 55.9%. The 85.7% figure appears to be a miscommunication or calculation error from an earlier analysis.

**Recommendation:** Update consensus entry #2 to reflect actual backtest results:
> "mean_reversion is our primary strategy (55.9% win rate in backtests, Sharpe 0.31). Live paper trading shows 18.2% win rate — under investigation."

---

## Conclusion

The divergence is caused by:
1. **Parameter mismatch** (zScoreThreshold 1.0 vs 1.5)
2. **Data quality issues** (randomized candles, NULL confidence)
3. **Insufficient sample size** (11 trades vs 374)
4. **Incorrect benchmark** (85.7% was wrong; actual is 55.9%)

Even with the corrected benchmark, the 37pp gap is concerning. **Do NOT proceed to live trading** until:
- Parameters are aligned
- NULL confidence bug is fixed
- At least 100 paper trades are collected with the corrected configuration

---

*Analysis by Grace (Data Engineer) | Task T322 | 2026-04-03*
