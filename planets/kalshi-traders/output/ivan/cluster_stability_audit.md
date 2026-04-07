# Sprint 6 T815 — Cluster Stability Audit

- Generated: 2026-04-07T09:15:36.924684
- Input fixture: `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json`
- Fixture freshness: `2026-04-07T09:15:00.125771`
- Baseline threshold: `0.65`

## Headline Result

Baseline clustering on 4 live-shaped markets produced 2 multi-market clusters and 0 singletons.
All 2 baseline multi-market cluster(s) are internally stable with no below-threshold pairs.

## Baseline Clusters

- `cluster_2` Crypto Markets | size=2 | confidence=0.829 | reported_stability=0.966 | observed_pair_retention=1.0
  min_pair_similarity=0.966, below_threshold_pairs=0/1
- `cluster_1` Economics Markets | size=2 | confidence=0.824 | reported_stability=0.998 | observed_pair_retention=1.0
  min_pair_similarity=0.998, below_threshold_pairs=0/1

## Threshold Sweep

| Threshold | Multi Clusters | Singletons | Avg Confidence | Avg Stability | Pair Retention vs 0.65 |
|---|---:|---:|---:|---:|---:|
| 0.55 | 2 | 0 | 0.827 | 0.982 | 1.000 |
| 0.60 | 2 | 0 | 0.827 | 0.982 | 1.000 |
| 0.65 | 2 | 0 | 0.827 | 0.982 | 1.000 |
| 0.70 | 2 | 0 | 0.827 | 0.982 | 1.000 |
| 0.75 | 2 | 0 | 0.827 | 0.982 | 1.000 |

## Semantic Failure Modes

- None observed on the provided fixture.

## Recommendations

- Keep the current 0.65 threshold for Sprint 6; threshold sweeps do not materially change the live-shaped output above 0.60.
- The sanitized Phase 1 fixture is suitable for Sprint 6 regression reruns; keep using it as the live-shaped baseline.

## Run Command

```bash
python3 output/ivan/cluster_stability_audit.py [path/to/filtered_markets.json]
```
