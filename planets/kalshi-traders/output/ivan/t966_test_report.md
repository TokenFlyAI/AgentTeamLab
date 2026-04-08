# T966 — Phase 3 Confidence Weighting: Test Report

**Task:** T966 — Sprint 8: Phase 3 confidence weighting — integrate uncertain_markets flagging
**Agent:** Ivan (ML Engineer)
**Date:** 2026-04-07
**Status:** COMPLETE — 14/14 tests pass

---

## What Was Implemented

Updated `output/shared/codebase/backend/correlation/pearson_detector.js` to use Phase 2 cluster confidence scores (T939) when scoring arbitrage pairs.

### New Function: `buildClusterConfidenceMap(clusters)`
Reads `market_clusters.json` and builds a ticker → `{ clusterConfidence, isUncertain }` lookup. Markets in a cluster's `uncertain_markets` list are flagged.

### Updated: `analyzePair(mA, mB, clusterId, confidenceMap)`
Now accepts an optional `confidenceMap` and adds three new output fields per pair:

| Field | Type | Description |
|-------|------|-------------|
| `cluster_confidence` | float [0,1] | `min(confA, confB)` — conservative cluster quality signal |
| `uncertain_flag` | bool | `true` if either market is in `uncertain_markets` |
| `weighted_confidence` | float [0,1] | `arbitrage_confidence × cluster_confidence × penalty` |

Uncertain penalty: `× 0.5` (halves confidence for uncertain-flagged pairs).

### Updated: `processClusters(clusters)`
- Builds confidence map before enriching
- Passes map to all `analyzePair` calls
- **Sorts output by `weighted_confidence`** (not raw `arbitrage_confidence`) — uncertain pairs naturally rank lower
- Adds `task_id`, `agent`, `uncertain_flagged`, `confident_pairs` to output

### New CONFIG keys
```js
noiseFilterThreshold: 0.3    // T963 (Bob) — already present in Bob's branch
minWeightedConfidence: 0.0   // T966 — floor for weighted pairs (0 = keep all, raise to filter)
uncertainPenalty: 0.5        // T966 — penalty multiplier for uncertain_markets pairs
```

---

## Test Results

```
[buildClusterConfidenceMap]    5/5 PASS
[analyzePair — T966 fields]    6/6 PASS
[processClusters — output]     3/3 PASS
Total: 14/14 PASS
```

Run command:
```bash
node agents/ivan/tests/unit/test_t966_confidence_weighting.js
```

Live run (integration check):
```bash
node output/shared/codebase/backend/correlation/pearson_detector.js run \
  planets/kalshi-traders/public/market_clusters.json /tmp/t966_pairs_out.json
```

Sample output pair (KXFED-25MAY-HOLD ↔ KXGDP-25Q2-3PCT):
```json
{
  "pearson_correlation": 0.8309,
  "arbitrage_confidence": 0.899,
  "cluster_confidence": 0.624,
  "uncertain_flag": true,
  "weighted_confidence": 0.28,
  "is_arbitrage_opportunity": true
}
```
Uncertain penalty correctly applied: `0.899 × 0.624 × 0.5 = 0.28`.

---

## Integration Notes

- Backward compatible: when a market has no entry in the confidence map, defaults to `clusterConfidence=1.0`, `isUncertain=false` — no change in behavior for pre-T939 cluster files
- Bob's T963 `noiseFilterThreshold` preserved — T966 adds a second layer of signal quality
- Downstream (Bob's signal_generator.js): can filter on `weighted_confidence` threshold or use `uncertain_flag` to annotate trade signals
