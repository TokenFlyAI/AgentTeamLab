# Sprint 8 Kickoff — Kalshi Arbitrage Pipeline (P0 Founder Directive)

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**Mode:** Normal

---

## The Mission

Build a high-frequency **arbitrage engine for Kalshi prediction markets** using correlation-based pair trading.

This is the real edge.

---

## The Pipeline (4 Phases)

### Phase 1: Market Filtering (Grace, T343)
Filter by volume and YES/NO ratio. Target: 15%-30% or 70%-85% mispriced markets. Exclude middle (40%-60%) and extremes.

### Phase 2: LLM Clustering (Ivan, T344)
Use LLM embeddings to identify hidden correlations across markets. Group crypto, politics, sports, econ into clusters.

### Phase 3: Pearson Correlation (Bob, T345)
Apply Pearson correlation to find strongly correlated pairs within clusters. Flag arbitrage when prices diverge from historical relationship.

### Phase 4: C++ Execution Engine (Dave, T346 design; full T348 Sprint 9)
High-speed sub-millisecond trading to lock in profits before price reversion.

---

## Why This Works

1. **Phases 1+2 reduce noise** — ignore 99% of markets, focus on high-edge setups
2. **Phase 3 finds real edges** — correlation-based pairs harder to game than single-market signals
3. **Phase 4 captures first** — C++ execution prevents front-running and slippage

---

## Timeline

- **Sprint 8:** Build phases 1-3 (scanner + clustering + correlation detector). Dave designs Phase 4 engine. Alice coordinates + validates.
- **Sprint 9:** Implement Phase 4 (C++ execution engine + full integration)
- **Week 10:** Paper trade full pipeline, validate win rate >40%
- **Week 11:** Go live (pending Founder approval)

---

## Team Assignments

| Agent | Task | Deliverable |
|-------|------|-------------|
| Grace | T343 (Phase 1) | markets_filtered.json |
| Ivan | T344 (Phase 2) | market_clusters.json |
| Bob | T345 (Phase 3) | correlation_pairs.json |
| Dave | T346 (Phase 4 Design) | execution_engine_design.md + skeleton |
| Alice | T347 (Coordination) | sprint_8_validation_report.md + e2e tests |

---

## Next Steps

- Grace: Begin Phase 1 immediately (feeds Ivan)
- Ivan: Standby for Grace's output, begin Phase 2 design
- Bob: Standby for Ivan's output, begin Phase 3 design
- Dave: Design Phase 4 engine (can start immediately with Ivan's Phase 2 design in parallel)
- Alice: Set up integration test framework, prepare pipeline validation

Go build this. This is the real edge.

— Alice
