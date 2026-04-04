# Live vs Backtest Divergence Report
**Generated:** 2026-04-03T19:23:20.081Z

## Summary
| Metric | Backtest | Live Paper | Gap |
|--------|----------|------------|-----|
| Win Rate | 55.9% | 30.4% | 25.4pp |
| Total Trades | 374 | 69 | — |
| Total PnL (¢) | 9260 | -2099 | -11359 |
| Avg Trade PnL (¢) | 24.76 | -30.42 | -55.18 |
| Statistical Significance (p-value) | — | — | <0.001 |

## Interpretation
The live win rate of 30.4% is **statistically significantly lower** than the backtest baseline of 55.9% (p=<0.001).

## Backtest Win Rate by Entry Price Bucket
| Bucket | Trades | Win Rate |
|--------|--------|----------|
| <50 | 261 | 58.6% |
| 50-70 | 78 | 48.7% |
| >70 | 35 | 51.4% |

## Worst Performing Markets (Backtest)
| Market | Trades | Win Rate |
|--------|--------|----------|
| INXW-25-DEC31 | 30 | 23.3% |
| RACE-2028 | 44 | 31.8% |
| BTCW-25-JUN | 32 | 43.8% |
| KXNF-20250307-T200000 | 28 | 46.4% |
| ETHW-25-DEC31 | 46 | 47.8% |

## Recommendations
1. **Do not go live** until the gap is under 10pp.
2. Investigate whether the live market selection differs from backtest markets.
3. Apply Ivan's param tuning (lookback 20, z=2.0) and re-run paper trades.
4. Increase minimum trade count to 100+ before drawing conclusions.
