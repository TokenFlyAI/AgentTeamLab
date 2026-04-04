# Signal Audit — Root Cause of Declining Win Rate (T326)

**Generated:** 2026-04-03  
**Analyst:** Grace (Data Engineer)  
**Task:** T326 — P0 Signal audit for win rate decline (35%→30%)  

---

## Executive Summary

**ROOT CAUSES IDENTIFIED:**

1. **Parameter Mismatch** (Primary): Live uses `zScoreThreshold: 1.0` vs backtest `1.5`
2. **Data Window Mismatch** (Primary): Live uses 7-day history vs backtest 90-day
3. **Market Selection Bias** (Secondary): Live trades concentrated in 3 fallback markets
4. **Synthetic Data Limitations** (Secondary): 7-day seeded PRNG doesn't capture real market regimes

**Impact:** 25.4pp gap (30.4% live vs 55.9% backtest), statistically significant (p<0.001)

---

## 1. Signal Confidence Distribution Analysis

### Current State (Live Paper Trades)

| Confidence Bucket | Trades | Win Rate | Notes |
|-------------------|--------|----------|-------|
| 0.80–0.89 | 0 | 0.0% | No signals in this range |
| 0.90–0.94 | 0 | 0.0% | No signals in this range |
| 0.95 (capped) | 69 | 30.4% | **All signals at max confidence** |
| NULL | 0 | 0.0% | Fixed in T328 |

**CRITICAL FINDING:** All 69 mean_reversion trades have confidence=0.95 (the cap). This indicates:
- Z-scores are consistently ≥ 2.85 (95% confidence threshold)
- The 7-day synthetic data produces artificially high z-scores
- No signal diversity — all trades treated as "high confidence"

### Backtest Confidence Distribution (Estimated)

Backtest used 90-day history with `zScoreThreshold: 1.5`:
- Higher threshold = fewer signals but higher quality
- 90-day history = more stable mean/stdDev calculation
- Result: 55.9% win rate with natural confidence distribution

---

## 2. Strategy Contamination Check

**VERIFIED CLEAN:** No momentum/crypto_edge contamination

| Strategy | Trade Count | % of Total | Status |
|----------|-------------|------------|--------|
| mean_reversion | 72 | 100% | ✅ Expected |
| momentum | 0 | 0% | ✅ Disabled correctly |
| crypto_edge | 0 | 0% | ✅ Disabled correctly |
| nfp_nowcast | 0 | 0% | ℹ️ No signals generated |
| econ_edge | 0 | 0% | ℹ️ No signals generated |

**Conclusion:** The win rate decline is NOT due to strategy contamination.

---

## 3. Parameter Mismatch Analysis

### Live Configuration (live_runner.js)
```javascript
const meanReversion = new MeanReversionStrategy({ 
  zScoreThreshold: 1.0,  // ← TOO LOW
  minVolume: 1000        // ← TOO LOW
});
const CANDLE_DAYS = 7;   // ← TOO SHORT
```

### Backtest Configuration (Python)
```python
MeanReversionStrategy(
  z_score_threshold=1.5,  # Higher = better quality signals
  min_volume=10000        # Higher = more liquid markets
)
# 90 days of history per market
```

### Impact of Parameter Differences

| Parameter | Live | Backtest | Impact |
|-----------|------|----------|--------|
| zScoreThreshold | 1.0 | 1.5 | 33% lower bar = more low-quality signals |
| minVolume | 1,000 | 10,000 | Includes illiquid markets |
| History Window | 7 days | 90 days | Unstable mean/stdDev calculation |

**Z-Score Calculation Issue:**
```
zScore = (currentPrice - mean) / stdDev

With 7-day history:
- stdDev is small (recent price action only)
- Any price deviation creates high z-score
- Confidence = min(|zScore|/3, 0.95) → always capped at 0.95

With 90-day history:
- stdDev captures full market regime
- Only extreme deviations generate signals
- Natural confidence distribution
```

---

## 4. Market Selection Bias

### Live Markets (3 fallback markets)
| Market | Trades | Win Rate | P&L |
|--------|--------|----------|-----|
| KXNF-20260501-T150000 | 23 | 21.7% | -$9.36 |
| BTCW-26-JUN30-100K | 23 | 39.1% | -$0.32 |
| ETHW-26-DEC31-5K | 23 | 30.4% | -$11.31 |

### Backtest Markets (14 markets, 90 days)
| Market | Trades | Win Rate |
|--------|--------|----------|
| INXW-25-DEC31 | 30 | 23.3% (worst) |
| RACE-2028 | 44 | 31.8% |
| BTCW-25-JUN | 32 | 43.8% |
| ... | ... | ... |

**CRITICAL FINDING:** All 3 live markets have win rates **below** the backtest average (55.9%). The live market selection is biased toward underperforming markets.

**KXNF-20260501-T150000** (NFP market) is particularly problematic:
- 21.7% win rate (worst of the 3)
- May not be suitable for mean_reversion (event-driven, not continuous)

---

## 5. Data Quality Analysis

### Seeded PRNG (T326 Fix)
The fetchCandles() fix uses ticker-based seeding:
```javascript
const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
```

**Assessment:** 
- ✅ Deterministic (same ticker → same candles)
- ❌ Not realistic (synthetic random walk)
- ❌ 7-day window too short for mean reversion

### Synthetic vs Real Data

| Aspect | Synthetic (Live) | Real (Backtest) |
|--------|------------------|-----------------|
| Volatility | Fixed 2-3% daily | Market-regime dependent |
| Mean reversion | Artificial | Real market behavior |
| Sample size | 3 markets | 14 markets |
| Time span | 7 days | 90 days |

**Conclusion:** Synthetic data cannot replicate the mean-reverting properties that the strategy relies on.

---

## 6. Statistical Significance

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Live Win Rate | 30.4% (21/69) | Well below backtest |
| Backtest Win Rate | 55.9% (209/374) | Baseline |
| Gap | 25.4pp | Statistically significant |
| Z-Score | -4.17 | >3σ deviation |
| P-Value | <0.001 | Highly significant |

**Interpretation:** The gap is NOT due to random variance. There is a systematic issue.

---

## 7. Root Cause Summary

### Primary Causes (Fix Immediately)

1. **zScoreThreshold too low (1.0 vs 1.5)**
   - Allows weaker mean reversion signals
   - 33% lower quality bar
   
2. **History window too short (7 vs 90 days)**
   - Unstable mean/stdDev calculation
   - Artificially inflated z-scores
   - All signals capped at max confidence

### Secondary Causes (Address Soon)

3. **Market selection bias**
   - Only 3 fallback markets
   - All 3 underperform backtest average
   - KXNF (NFP) unsuitable for mean_reversion

4. **Synthetic data limitations**
   - Cannot replicate real mean reversion
   - Need real Kalshi API data (T236 blocker)

---

## 8. Fix Recommendations

### Immediate (P0)

**Fix 1: Align Parameters with Backtest**
```javascript
// live_runner.js line 307
const meanReversion = new MeanReversionStrategy({ 
  zScoreThreshold: 1.5,  // Change from 1.0
  minVolume: 10000       // Change from 1000
});
```

**Fix 2: Extend History Window**
```javascript
// live_runner.js line 28
const CANDLE_DAYS = 30;  // Change from 7 (or use 90 to match backtest)
```

### Short-term (P1)

**Fix 3: Exclude NFP Markets from mean_reversion**
NFP markets are event-driven, not suitable for mean reversion:
```javascript
// In market selection or strategy
if (market.ticker.startsWith('KXNF')) return null;
```

**Fix 4: Add Market Win Rate Tracking**
Track win rate per market and exclude consistently underperforming markets.

### Medium-term (P2)

**Fix 5: Real Kalshi API Data**
Blocked on T236 (Kalshi API credentials). Real data will:
- Provide actual market regimes
- Enable meaningful backtest comparison
- Validate strategy assumptions

---

## 9. Validation Plan

After applying fixes:

1. **Run 100 paper trades** with aligned parameters
2. **Monitor confidence distribution** — should see range, not all 0.95
3. **Track per-market win rates** — identify problematic markets
4. **Compare to 55.9% backtest baseline** — target gap <10pp
5. **Statistical test** — confirm p-value >0.05 (not significant)

---

## 10. Conclusion

The declining win rate (35%→30%) is caused by **parameter mismatch** and **insufficient history window**, not strategy contamination or data randomness.

**DO NOT go live** until:
1. zScoreThreshold aligned to 1.5
2. History window extended to 30+ days
3. 100+ paper trades collected with new parameters
4. Win rate gap <10pp from backtest

The seeded PRNG fix (T326) was necessary but not sufficient. The core issue is that live configuration diverged from backtest configuration.

---

*Audit by Grace (Data Engineer) | Task T326 | 2026-04-03*
