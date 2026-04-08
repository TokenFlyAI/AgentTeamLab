# Phase 1 Market Filter Analysis — Sprint 8 (T938)

## Overview
Analysis of current Phase 1 filtering thresholds against Grace's live-shaped fixture data (`live_phase1_fixture.json`).

## Current Thresholds
- **Volume:** >= 10,000 contracts
- **Yes Ratio:** [15%, 30%] or [70%, 85%]
- **Performance:** 3 qualifying markets in 7 valid fixture cases.

## Proposed Thresholds
- **Volume:** >= 10,000 contracts (Unchanged — required for liquidity)
- **Yes Ratio:** [10%, 40%] or [60%, 90%]
- **Performance:** 5 qualifying markets (+66.7% increase).

## Analysis & Justification

### 1. Expanding the Yes Ratio Ranges
The current filter is overly restrictive, excluding markets between 30-40% and 60-70%. These are often the most fertile grounds for arbitrage as they represent non-consensus markets that are still actively moving toward a boundary. 
- **Inclusion of 10-15% and 85-90%:** These "extreme" markets were previously excluded. However, in an arbitrage context, a market at 90% (e.g., GOP House control) that correlates strongly with another market at 70% still provides a high-confidence signal if their spread deviates.
- **Maintenance of the "Dead Zone":** The 40-60% range remains excluded. This is the "efficient middle" where price discovery is most consensus-driven and arbitrage edge is minimal.

### 2. Volume Threshold (10,000)
Maintaining the 10,000 contract floor is critical. Lowering this (e.g., to 5,000) would capture idiosyncratic markets like `KXRAIN-LA` (8,500 vol), but these markets lack the depth required for the C++ execution engine's sub-millisecond target and pose significant exit risk for automated strategies.

## Impact on Downstream Phases
- **Phase 2 (Clustering):** Ivan will receive ~50% more markets, allowing for richer clusters and more potential arbitrage pairs.
- **Phase 3 (Correlation):** Increased sample size will lead to more statistically significant Pearson (r) pairs.

## Recommendations
Update `CONFIG` in `market_filter.js` to:
```javascript
const CONFIG = {
  minVolume: 10000,
  targetRanges: [
    { min: 10, max: 40 },
    { min: 60, max: 90 },
  ],
  excludedRange: { min: 40, max: 60 }
};
```

**Verification Script:** `agents/bob/filter_analysis_sim.js`
**Date:** 2026-04-07
**Author:** Bob (Backend Engineer)
