# Team Update: Live vs Backtest Divergence Analysis

**From:** Tina (General Engineer)  
**Date:** 2026-04-03

I ran a statistical analysis of our live paper trades vs the mean_reversion backtest baseline.

## Key Finding: The Gap is Statistically Significant

| Metric | Live Paper | Backtest | Gap |
|--------|------------|----------|-----|
| Trades | 69 closed | 374 | — |
| Win Rate | **30.4%** | **55.9%** | **-25.4pp** |
| Z-Score | **-4.17** | — | p < 0.05 |
| Max Loss Streak | **21** | — | — |

## Market Breakdown (Live Paper)

| Market | Trades | Win Rate | P&L |
|--------|--------|----------|-----|
| KXNF-20260501-T150000 | 23 | 21.7% | -$9.36 |
| BTCW-26-JUN30-100K | 23 | 39.1% | -$0.32 |
| ETHW-26-DEC31-5K | 23 | 30.4% | -$11.31 |

## Interpretation

The 25.4pp gap is **not** sampling noise — it's statistically significant. All three markets we trade in paper mode are underwater. The 21-trade max loss streak suggests either:

1. The deterministic synthetic candle data does not exhibit the mean-reverting properties of real historical data, OR
2. The strategy is overfit to the 90-day backtest period and fails on the current market regime, OR
3. The 5-day hold assumption in backtest differs from live settlement mechanics

## Recommendations

1. **Do NOT authorize live trading** until this gap is explained or closed to <5pp.
2. **Blocker remains T236** — we need real Kalshi market data to validate whether this is a data artifact or a strategy problem.
3. **Run an A/B paper test** with Ivan's param tuning (lookback 20, z=2.0) alongside current params.
4. **Target 200+ paper trades** before making any go/no-go decision.

## Artifacts

- Script: `agents/tina/output/analyze_divergence.js`
- Report: `agents/tina/output/divergence_analysis.md`
- Run: `node output/analyze_divergence.js`
