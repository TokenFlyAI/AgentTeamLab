# Live vs Backtest Divergence Analysis

**Generated:** 2026-04-03T19:21:29.974Z
**Script:** `output/analyze_divergence.js`
**Run:** `node output/analyze_divergence.js`

## Executive Summary

| Metric | Live Paper Trades | Backtest (mean_reversion) | Gap |
|--------|-------------------|---------------------------|-----|
| Total Trades | 69 | 374 | — |
| Win Rate | 30.4% | 55.9% | -25.4pp |
| Total P&L | $-20.99 | $92.60 | — |
| Avg P&L/Trade | -0.30¢ | 0.25¢ | — |
| Statistical Z-Score | -4.17 | — | — |

**Interpretation:** A Z-score of 4.17 suggests the gap is **statistically significant** (p < 0.05).

## Live Trade Breakdown by Confidence

| Confidence Bucket | Trades | Win Rate | Avg P&L/Trade | Total P&L |
|-------------------|--------|----------|---------------|-----------|
| 0.80–0.89 | 0 | 0.0% | 0.00¢ | $0.00 |
| 0.90–0.94 | 0 | 0.0% | 0.00¢ | $0.00 |
| 0.95–1.00 | 69 | 30.4% | -0.30¢ | $-20.99 |

## Live Trade Breakdown by Expected Edge

| Edge Bucket | Trades | Win Rate | Avg P&L/Trade | Total P&L |
|-------------|--------|----------|---------------|-----------|
| 0–19 | 0 | 0.0% | 0.00¢ | $0.00 |
| 20–39 | 46 | 30.4% | -0.21¢ | $-9.68 |
| 40–59 | 23 | 30.4% | -0.49¢ | $-11.31 |
| 60+ | 0 | 0.0% | 0.00¢ | $0.00 |

## Market-Level Breakdown

| Market | Trades | Win Rate | Total P&L |
|--------|--------|----------|-----------|
| KXNF-20260501-T150000 | 23 | 21.7% | $-9.36 |
| BTCW-26-JUN30-100K | 23 | 39.1% | $-0.32 |
| ETHW-26-DEC31-5K | 23 | 30.4% | $-11.31 |

## Streak Analysis

- **Max consecutive losses:** 21

## Hypotheses for the Gap

1. **Sample Size:** 69 live trades vs 374 backtest trades. The live sample may still be too small for the win rate to converge.
2. **Market Selection:** Live trades are concentrated in a small number of fallback/mock markets. Backtest spanned 14 markets over 90 days.
3. **Hold Period / Settlement:** Backtest used a 5-day hold. Live paper trades may settle on a different schedule, affecting P&L.
4. **Deterministic Data Limitation:** Even with seeded PRNG, fallback candle data is synthetic. It may not capture the mean-reverting properties of real historical data.

## Recommendations

1. **Do not go live** until the win-rate gap is within 5pp of backtest or a clear root cause is identified.
2. **Increase paper trade sample size** to at least 200 trades before drawing conclusions.
3. **Compare market-by-market** once real Kalshi API data is available (T236 blocker).
4. **Apply Ivan's param tuning** (lookback 20, z=2.0) in a controlled A/B paper test.
