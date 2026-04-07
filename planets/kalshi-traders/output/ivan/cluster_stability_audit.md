# Sprint 6 T815 — Cluster Stability Audit

- Generated: 2026-04-07T07:22:12.984211
- Input fixture: `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets.json`
- Fixture freshness: `2026-04-06T23:25:48.159914`
- Baseline threshold: `0.65`

## Headline Result

Baseline clustering on 50 live-shaped markets produced 5 multi-market clusters and 0 singletons.
Four clusters are internally stable; one 14-market economics cluster is semantically over-broad and exposes a mismatch between the reported stability metric and observed leave-one-out behavior.

## Baseline Clusters

- `cluster_4` Politics Markets | size=3 | confidence=0.814 | reported_stability=1.0 | observed_pair_retention=1.0
  min_pair_similarity=0.993, below_threshold_pairs=0/3
- `cluster_5` Weather Markets | size=11 | confidence=0.729 | reported_stability=1.0 | observed_pair_retention=1.0
  min_pair_similarity=0.983, below_threshold_pairs=0/55
- `cluster_2` Crypto Markets | size=10 | confidence=0.684 | reported_stability=1.0 | observed_pair_retention=1.0
  min_pair_similarity=0.934, below_threshold_pairs=0/45
- `cluster_3` Politics Markets | size=12 | confidence=0.649 | reported_stability=1.0 | observed_pair_retention=1.0
  min_pair_similarity=0.808, below_threshold_pairs=0/66
- `cluster_1` Economics Markets | size=14 | confidence=0.586 | reported_stability=0.0 | observed_pair_retention=1.0
  min_pair_similarity=0.256, below_threshold_pairs=33/91

## Threshold Sweep

| Threshold | Multi Clusters | Singletons | Avg Confidence | Avg Stability | Pair Retention vs 0.65 |
|---|---:|---:|---:|---:|---:|
| 0.55 | 5 | 0 | 0.675 | 0.600 | 0.842 |
| 0.60 | 5 | 0 | 0.692 | 0.800 | 1.000 |
| 0.65 | 5 | 0 | 0.692 | 0.800 | 1.000 |
| 0.70 | 5 | 0 | 0.692 | 0.800 | 1.000 |
| 0.75 | 5 | 0 | 0.692 | 0.800 | 1.000 |

## Semantic Failure Modes

- `cluster_1` Economics Markets reports stability=0.0, but leave-one-out reruns retain 1.000 of pair memberships.
- `cluster_1` Economics Markets has 33/91 pairs below the 0.65 similarity threshold.
- Label 'Politics Markets' appears 2 times, masking distinct event families.
- 6 live-shaped fixture titles contain impossible or implausible numeric thresholds.

## Fixture Quality Notes

- `ECON-UNEMP-26SEP06-039` unemployment_rate_out_of_range: US unemployment above 250% in Sep 6, 2026?
- `CRYP-BTCDOM-26SEP24-045` bitcoin_dominance_out_of_range: Bitcoin dominance above 180% by Sep 24, 2026?
- `ECON-UNEMP-27JAN04-079` unemployment_rate_out_of_range: US unemployment above 225% in Jan 4, 2027?
- `CRYP-BTCDOM-27JAN22-085` bitcoin_dominance_out_of_range: Bitcoin dominance above 4,500% by Jan 22, 2027?
- `CRYP-SOL-27APR16-113` solana_price_implausible: Solana above $95,000 by Apr 16, 2027?
- `ECON-UNEMP-27DEC30-199` unemployment_rate_out_of_range: US unemployment above 175% in Dec 30, 2027?

## Recommendations

- Keep the current 0.65 threshold for Sprint 6; threshold sweeps do not materially change the live-shaped output above 0.60.
- Split the economics family into sub-themes before Bob consumes correlations from live data; current family fallback groups CPI, GDP, payrolls, Fed, and unemployment into one loose cluster.
- Rework `compute_cluster_stability()` to use the same fallback semantics as `cluster_markets()` or replace it with pair-retention on leave-one-out reruns.
- Ask Grace to sanitize impossible percentage thresholds in the live fixture generator before T236 lands.

## Run Command

```bash
python3 output/cluster_stability_audit.py
```
