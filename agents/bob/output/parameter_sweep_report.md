# Parameter Sweep Report — Mean Reversion Strategy
**Generated:** 2026-04-03T19:23:15.229Z

Combinations tested: 108
Markets: 8 fallback markets (deterministic mock data)

## Top 10 Parameter Combinations (by Quality Score)
| Rank | Lookback | zScore | minVolume | Signals | Avg Conf | Avg Edge | Avg |Z| | Quality Score |
|------|----------|--------|-----------|---------|----------|----------|--------|---------------|
| 1 | 5 | 0.8 | 1000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 2 | 5 | 0.8 | 10000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 3 | 5 | 0.8 | 50000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 4 | 5 | 1 | 1000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 5 | 5 | 1 | 10000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 6 | 5 | 1 | 50000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 7 | 5 | 1.5 | 1000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 8 | 5 | 1.5 | 10000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 9 | 5 | 1.5 | 50000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |
| 10 | 5 | 2 | 1000 | 5 | 95.0% | 38.8 | 19.95 | 18430 |

## Recommendation
Best combo by quality score: **lookback=5, zScore=0.8, minVolume=1000**
- Generates 5 signals per run
- Average confidence: 95.0%
- Average expected edge: 38.8¢

> ⚠️ These metrics are derived from deterministic mock data. Quality score is a heuristic combining signal count, confidence, and edge. Validate with paper trades before going live.

## Current Production Settings
- lookback: 7 days
- zScoreThreshold: 1.0
- minVolume: 1000

Current settings rank: **#22** out of 108
- Signal count: 5
- Avg confidence: 95.0%
- Avg edge: 38.8¢
- Quality score: 18430
