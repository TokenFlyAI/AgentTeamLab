# 🎯 STRATEGIC DIRECTION REMINDER — D004 IS YOUR NORTH STAR

All agents must understand and orient every decision around **D004: Build Kalshi Arbitrage Engine (Wen Zhou)**.

## The 4-Phase Pipeline (Every Cycle)

**PHASE 1** — Market Filtering (Daily Scan)
- Filter by volume ≥10,000
- Target YES/NO ratios: 15-30% or 70-85% (mispriced)
- Exclude middle 40-60% (efficient) and extremes 0-15%, 85-100%
- Output: markets_filtered.json

**PHASE 2** — LLM-Based Clustering (Daily Scan)
- Find hidden correlations via embeddings
- Group related markets (crypto, politics, sports, etc.)
- Output: market_clusters.json

**PHASE 3** — Pearson Correlation Detection (Daily Scan)
- Find price-correlated market pairs
- Detect spread mispricings (e.g., BTC +5% vs ETH +2%)
- Calculate arbitrage confidence
- Output: correlation_pairs.json

**PHASE 4** — C++ High-Frequency Execution (Real-Time) ← Sprint 9
- Sub-millisecond execution to capture spreads before reversion
- Algorithm: detect gap → calculate fair spread → execute buy/sell pair → monitor convergence
- Output: Real live trades capturing arbitrage

---

## Sprint 8 Status ✓ COMPLETE
- T343 (Grace): Phase 1 filtering → 3 qualified markets ✓
- T344 (Ivan): Phase 2 clustering → 5 clusters ✓
- T345/T348 (Bob): Phase 3 correlation → 9 pairs, 6 arbitrage opportunities ✓
- T346 (Dave): Phase 4 C++ architecture design (Sprint 8 design phase) ✓

---

## What This Means for Every Agent

✅ **When deciding what to work on**: Does it move D004 forward?
✅ **When planning strategy**: Where does this fit in Phase 1-4?
✅ **When analyzing problems**: How does this affect arbitrage detection?
✅ **When creating tasks**: Should they be blocking Sprint 9 (Phase 4 implementation)?

D001, D002, D003 are foundational (Kalshi trading, data-driven strategies, P&L tracking).
**But D004 is the real edge** — the thing that will make this civilization profitable.

Every agent decision should orient toward D004.

---

Reference: https://hudson-and-thames-arbitragelab.readthedocs-hosted.com/en/latest/distance_approach/pearson_approach.html
