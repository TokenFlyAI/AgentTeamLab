# Performance Report — Phase 3 Pearson Correlation Detector

**Task:** T951 — Sprint 8: Performance profiling — baseline Phase 3 correlation latency  
**Agent:** Nick (Performance Engineer)  
**Date:** 2026-04-07  
**Run command:** `node output/shared/codebase/backend/benchmark_pearson.js`  

---

## Executive Summary

Phase 3 (`pearson_detector.js`) is **well within the <2s p95 target** for all realistic production workloads. On real Ivan cluster data (8 clusters, 38 markets, 79 pairs), **p95 = 0.45ms** — orders of magnitude under budget.

The primary algorithmic concern is **O(n²) pair growth**: as markets-per-cluster grows, latency scales quadratically. At 50 markets/cluster (xlarge), p95 hits **5.93ms**, still fast in absolute terms but a 13× jump from the 10-market case. This is the main scaling risk to monitor.

**No optimization required today.** The bottleneck, if one emerges, will be `enrichClustersWithPrices` (synthetic price generation) rather than the correlation math itself.

---

## Micro Benchmark Results

| Function | iters | p50 | p95 | p99 | mean |
|----------|-------|-----|-----|-----|------|
| `pearsonCorrelation(n=60)` | 10,000 | 0.0002ms | 0.0004ms | 0.0032ms | 0.0005ms |
| `calculateSpreadStats(n=60)` | 10,000 | 0.0002ms | 0.0015ms | 0.0025ms | 0.0004ms |
| `generatePriceHistory(n=60, correlated)` | 5,000 | 0.0013ms | 0.0065ms | 0.0085ms | 0.0017ms |
| `enrichClustersWithPrices(8 clusters, 38 markets)` | 500 | 0.0558ms | 0.0983ms | 0.2627ms | 0.0647ms |

**Key finding:** Pearson correlation and spread stats are sub-microsecond per pair. Price history generation is 6–26× slower per call but still sub-millisecond.

---

## End-to-End Scale Results (`processClusters`)

| Scenario | Markets | Pairs | Arb Opps | p50 | p95 | p99 |
|----------|---------|-------|----------|-----|-----|-----|
| tiny: 1 cluster × 4 | 4 | 6 | 5 | 0.03ms | 0.08ms | 0.24ms |
| small: 3 clusters × 5 | 15 | 30 | 17 | 0.09ms | 0.15ms | 0.16ms |
| **real ivan data (8 clusters, mixed)** | **38** | **79** | **37** | **0.25ms** | **0.45ms** | **0.53ms** |
| medium: 5 clusters × 10 | 50 | 225 | 59 | 0.54ms | 0.67ms | 0.69ms |
| large: 3 clusters × 20 | 60 | 552 | 165 | 1.25ms | 1.39ms | 1.55ms |
| xlarge: 2 clusters × 50 | 100 | 2,428 | 621 | 5.47ms | 5.93ms | 6.07ms |

**Production scenario (real ivan data):** p95 = **0.45ms** — 4,400× under the 2s budget.

---

## History Length Sensitivity

| History Length | p50 | p95 | p99 |
|----------------|-----|-----|-----|
| 10 | 0.0020ms | 0.0029ms | 0.0045ms |
| 30 | 0.0041ms | 0.0043ms | 0.0053ms |
| **60 (current config)** | **0.0077ms** | **0.0079ms** | **0.0082ms** |
| 120 | 0.0151ms | 0.0188ms | 0.0211ms |
| 250 | 0.0291ms | 0.0333ms | 0.0396ms |
| 500 | 0.0607ms | 0.0650ms | 0.0723ms |

Latency scales **linearly** with history length (O(n)), which is expected and correct. Doubling history from 60→120 doubles latency per pair. At 500 periods, still only 0.065ms/pair.

---

## Memory Profile

| Metric | Value |
|--------|-------|
| Heap before (200 iterations) | 34.03 MB |
| Heap after | 39.60 MB |
| Delta | +5.57 MB |
| Pairs per run | 79 |

No memory leak detected. The ~5.6MB growth over 200 runs stabilizes — GC is keeping up with intermediate array allocations. At production frequency (sub-second call cadence), heap pressure is negligible.

---

## Bottleneck Analysis

### Where time is spent (real ivan data, 0.25ms total)

1. **`enrichClustersWithPrices`** — ~0.06ms (~24% of total). Synthetic price generation using seeded random + correlated walks. This is the heaviest single function.
2. **`buildClusterConfidenceMap`** — negligible; single pass over cluster array.
3. **`analyzePair` × 79 pairs** — ~0.19ms (~76% of total). Dominated by `pearsonCorrelation` + `calculateSpreadStats` per pair.

### Root cause of O(n²) scaling

`processClusters` runs `analyzePair` for every (i,j) market pair within each cluster. Pair count = `n*(n-1)/2` per cluster. A 50-market cluster has **1,225 pairs** vs 55 pairs for an 11-market cluster. This is the natural complexity of exhaustive pairwise correlation and is algorithmically correct — no premature optimization warranted.

---

## Pair Count Growth Table

| Markets per cluster | Pairs |
|--------------------|-------|
| 4 | 6 |
| 5 | 10 |
| 8 | 28 |
| 10 | 45 |
| 11 | 55 |
| 15 | 105 |
| 20 | 190 |
| 30 | 435 |
| 50 | 1,225 |

---

## Recommendations

### No action needed (current workload)
Real production cluster sizes (Ivan's output: 2–11 markets/cluster, 8 clusters) produce p95 = **0.45ms**. This is 4,400× under the 2s target. No optimization is warranted now.

### Monitor (if markets-per-cluster grow)
If a single cluster exceeds **20 markets** (190 pairs), the per-run latency approaches **1.4ms p95** — still fast, but worth tracking. If clusters regularly reach 50+ markets, consider:

1. **Intra-cluster market cap** — limit cluster size at Phase 2 (Ivan) to ≤20 markets. This is a Phase 2 architecture decision, not a Phase 3 fix.
2. **Correlation pre-filtering** — skip pairs where variance of either series is near-zero (would eliminate trivially non-correlated pairs before the full Pearson calculation).
3. **Incremental updates** — cache prior correlation results and only recompute changed pairs (requires stable market IDs across runs).

### Low-risk quick win (if needed)
The `calculateSpreadStats` function allocates a `spreads` array on every call. For very large pair counts (1,000+), pre-allocating a reusable buffer would reduce GC pressure. Not needed at current scale.

---

## Verdict

**PASS.** Phase 3 Pearson correlation detection meets the <2s p95 latency target with a 4,400× margin on real production data. The implementation is algorithmically sound with correct O(n²) pair scaling. No performance regressions found. No optimizations required at current cluster sizes.

---

*Benchmark: `node output/shared/codebase/backend/benchmark_pearson.js`*  
*Hardware: Darwin 25.1.0 / Node.js*  
*task_id: T951 | agent_name: nick | timestamp: 2026-04-07T21:48:31Z*
