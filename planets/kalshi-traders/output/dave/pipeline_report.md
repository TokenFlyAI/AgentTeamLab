# T582 Pipeline Report

Date: 2026-04-07T11:45:35.959Z
Input: `output/bob/correlation_pairs.json`
Run command: `node output/dave/simulate_pipeline.js`

## Pipeline Check

| Phase | File | Status | Count |
|---|---|---:|---:|
| Phase 1 mock markets | `output/bob/mock_kalshi_markets.json` | OK | 200 |
| Phase 1 filtered markets | `output/grace/filtered_markets.json` | OK | 50 |
| Phase 2 clusters | `output/ivan/market_clusters.json` | OK | 4 |
| Phase 3 correlations | `output/bob/correlation_pairs.json` | OK | 296 |

## Summary

| Metric | Value |
|---|---:|
| Total pairs tested | 296 |
| Signals generated | 160 |
| Simulated trades | 160 |
| Winning trades | 74 |
| Losing trades | 86 |
| Win rate | 46.3% |
| Gross P&L | $24.74 |
| Fees | -$8.04 |
| Net P&L | $5.22 |
| Avg P&L / trade | 0.03 dollars |
| Max drawdown | 0.60 dollars |

## Signal Breakdown

| Signal | Trades | Wins | Win Rate | Net P&L (cents) |
|---|---:|---:|---:|---:|
| BUY_SPREAD | 91 | 46 | 50.5% | 379.18 |
| SELL_SPREAD | 69 | 28 | 40.6% | 142.57 |

## Cluster Breakdown

| Cluster | Trades | Wins | Win Rate | Net P&L (cents) |
|---|---:|---:|---:|---:|
| Political Control and Approval | 56 | 26 | 46.4% | 182.46 |
| Macro Policy and Growth | 49 | 21 | 42.9% | 181.31 |
| Digital Assets | 25 | 14 | 56% | 126.92 |
| Weather and Climate Events | 30 | 13 | 43.3% | 31.06 |

## Top Trades

| Pair | Signal | Confidence | Z | Net P&L (cents) |
|---|---|---:|---:|---:|
| ECON-FED-27JAN16-083 / ECON-GDP-27SEP25-167 | SELL_SPREAD | 0.8 | 0 | 43.19 |
| POL-GOV-27APR19-114 / POL-GOV-27DEC15-194 | BUY_SPREAD | 0.89 | 0 | 39.94 |
| POL-APPROVAL-27JAN01-078 / POL-APPROVAL-27MAY01-118 | SELL_SPREAD | 0.96 | 0 | 39.54 |
| ECON-UNEMP-26SEP06-039 / ECON-UNEMP-26NOV05-059 | SELL_SPREAD | 0.87 | 0 | 36.58 |
| ECON-PAY-27AUG20-155 / ECON-UNEMP-27DEC30-199 | BUY_SPREAD | 0.8 | 0 | 35.52 |
| CRYP-BTCDOM-26SEP24-045 / CRYP-BTCDOM-27JUL21-145 | BUY_SPREAD | 0.85 | 0 | 35.23 |
| ECON-FED-26SEP18-043 / ECON-FED-27JAN16-083 | BUY_SPREAD | 0.97 | 0 | 34.60 |
| CRYP-BTCDOM-26MAY27-005 / CRYP-BTCDOM-27JAN22-085 | BUY_SPREAD | 0.8 | 0 | 33.54 |
| ECON-PAY-27AUG20-155 / ECON-CPI-27OCT07-171 | BUY_SPREAD | 0.81 | 0 | 30.18 |
| ECON-UNEMP-27JAN04-079 / ECON-PAY-27AUG20-155 | SELL_SPREAD | 0.82 | 0 | 29.90 |

## Notes

- Following C1: paper trading only.
- Following C8: report generated from executed simulation code, not a handwritten estimate.
- Following C14: Bob's phase-3 artifact was already present, so Phase 4 self-unblocked.
- Full machine-readable output is in `output/dave/pipeline_report.json`.

