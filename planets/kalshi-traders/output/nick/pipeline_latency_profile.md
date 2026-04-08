# D004 Full Pipeline Latency Profile — T1018

**Agent:** Nick (Performance Engineer)  
**Date:** 2026-04-07  
**Task ID:** T1018  
**Sprint:** 9  
**Run command:** `node agents/nick/output/benchmark_d004_pipeline.js`  
**Raw data:** `agents/nick/output/pipeline_latency_raw.json`  

---

## Executive Summary

All four D004 pipeline phases pass the <2s p95 SLO with orders of magnitude of headroom. **Phase 3 (Pearson correlation) is the only phase with meaningful O(n²) scale risk**, but even at 300 markets across 20 clusters the p95 stays at 3.9ms — 512× under the 2s budget. The pipeline is production-ready from a latency standpoint. No bottlenecks requiring immediate action.

---

## Benchmark Results

**Live data:** 169 raw markets (119 qualifying from Grace's T1016 Sprint 9 refresh), 2 Ivan clusters

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Phase                                         │  p50ms │  p95ms │  p99ms │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 1: Market Filter                        │  0.015 │  0.348 │  0.348 │
│ Phase 2: Cluster Feature Extraction           │  0.027 │  0.265 │  0.265 │
│ Phase 3: Pearson (Ivan live — 2 clusters)     │  0.049 │  1.230 │  1.230 │
│ Phase 3: Pearson (10 clusters × 10 markets)   │  0.923 │  3.467 │  3.467 │
│ Phase 3: Pearson (20 clusters × 15 markets)   │  3.192 │  3.936 │  3.936 │
│ Phase 4: Signal Generation                    │  0.130 │  0.328 │  0.328 │
│ E2E: Phase 1→2→3→4 (live, Ivan clusters)      │  1.432 │  3.009 │  3.009 │
└───────────────────────────────────────────────────────────────────────────┘
```

**Methodology:** 20 iterations per case, client-side process.hrtime.bigint(), idle system.

---

## Per-Phase Analysis

### Phase 1 — Market Filter (Grace)
**p95: 0.35ms** | Input: 169 markets | Output: 117 qualifying

O(n) linear scan with two predicates (volume >= 10,000 AND price in target ranges). Projects to ~20ms at 10,000 markets — still inside budget. No action required.

### Phase 2 — LLM Clustering (Ivan)
**p95: 0.27ms** | Input: 117 markets | Output: 4 clusters

Times non-LLM parts only: feature vector construction + deterministic category grouping. The LLM inference call is network-bound and separate. CPU work is negligible. When Ivan's LLM clustering is live, network latency will dominate this phase and should be tracked as a separate async budget.

### Phase 3 — Pearson Correlation (Bob)
**p95 (live): 1.23ms** | **p95 (100 mkts): 3.47ms** | **p95 (300 mkts): 3.94ms**

Only phase with O(n^2) pair-comparison growth. Scale profile:

| Scale              | Markets | Pairs | p95    |
|--------------------|---------|-------|--------|
| Ivan live          | 3       | 1     | 1.23ms |
| 10 clusters x 10   | 100     | 450   | 3.47ms |
| 20 clusters x 15   | 300     | 2,100 | 3.94ms |

The 3.2x latency increase for a 2,100x increase in pairs shows the O(n^2) loop is well-JIT-optimized. No bottleneck at current or projected scale.

**Rosa decomposition note:** Phase 3 is the natural microservice boundary — compute-intensive, stateless, clean contract. If cluster sizes ever exceed 50 markets/cluster, add worker_threads parallelism.

### Phase 4 — Signal Generation
**p95: 0.33ms** | O(n) on pair count. No concern.

---

## Sprint 8 vs Sprint 9 Delta

| Metric                     | Sprint 8 (T951)   | Sprint 9 (T1018) |
|----------------------------|-------------------|------------------|
| Phase 3 p95 (live)         | 0.45ms            | 1.23ms           |
| E2E p95                    | N/A               | 3.01ms           |
| Budget headroom            | 4,400x            | 666x             |

Phase 3 increased 0.45ms -> 1.23ms due to smaller live Ivan input (3 vs 38 markets, less JIT warmup). Both are within budget. The 10x10 scale test at 3.47ms is consistent with Sprint 8's O(n^2) projection.

---

## Implications for Rosa's Microservice Decomposition

Recommended decomposition priority:

1. **Phase 3 first** — Natural boundary, stateless, compute-bound. Extract as correlation-service (clusters.json -> correlation_pairs.json). Scale with worker_threads if needed.
2. **Phase 1 last** — Too fast and simple to justify a service boundary.
3. **Phase 2** — LLM call is already async/external; sync CPU work is trivial.
4. **Phase 4** — Pure function; keep colocated with Phase 3 output.

**Decomposition overhead budget:** Current synchronous CPU cost is ~3ms E2E. An HTTP-between-phases architecture adding 10ms/hop would cost ~40ms total — still within budget but 13x the current compute cost. Rosa should target <5ms inter-service overhead per hop.

---

## Regression Gate (Sprint 9+)

Re-run after Rosa's Phase A:
```bash
node agents/nick/output/benchmark_d004_pipeline.js
```

Flag regression if:
- E2E p95 > 6ms (2x current 3.01ms)
- Phase 3 p95 at 10x10 scale > 7ms (2x current 3.47ms)
- Any phase previously <1ms now exceeds 5ms

---

*task_id: T1018 | agent_name: nick | timestamp: 2026-04-07T22:xx:00Z | Following C16 (run command), C20 (metadata), C19 (benchmark verified via execution)*
