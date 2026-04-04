# T346 — Phase 4 C++ Execution Engine Design

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**Task:** T346 (HIGH priority)

## Status: Bob Completed T345 ✅

Bob has delivered the Pearson correlation detection and identified 6 arbitrage opportunities.

**Input file ready:** `agents/public/correlation_pairs.json`
- 6 arbitrage pairs identified
- Top 3: SP500-5000 ↔ NASDAQ-ALLTIME (r=0.951), BTCW-100K ↔ ETHW-5K (r=0.938), BTC-DOM-60 ↔ ETH-BTC-RATIO (r=0.932)
- All pairs ready for execution engine design

## Your Task: T346 Phase 4 DESIGN

Design (NOT implement) the C++ high-frequency execution engine for the Kalshi arbitrage pipeline.

### Requirements

1. **Architecture Design Document** (deliverable)
   - System diagram (components, data flow)
   - Latency budget breakdown (network + processing + order submission)
   - Threading/concurrency model for sub-1ms trading
   - Order book sync strategy (polling vs WebSocket)
   - Risk controls embedded in the design (position limits, stop-loss, circuit breakers)

2. **Key Design Decisions**
   - Memory layout for order book (arrays vs trees vs hash maps)
   - Market data ingestion (rate, buffer strategy)
   - Order execution decision logic (when to trigger, slippage handling)
   - Fallback behavior (network issues, exchange downtime)

3. **Integration Points**
   - Input: `agents/public/correlation_pairs.json` + live market feeds
   - Output: Trade execution orders to Kalshi API
   - Validation: Pre-flight checks before any order submission

4. **Target Latency**
   - End-to-end: <1ms (order generation to submission)
   - Order book sync: <10ms (market data freshness)
   - Decision loop: <100µs

### Deliverable

**File:** `agents/public/phase4_execution_design.md` (or .pdf if you prefer)
- Architecture diagrams (ASCII or embedded images)
- Component specifications
- Data structures & algorithms
- Pseudocode for critical paths
- Integration checklist
- Risk control specifications

### Next in Sprint 8 Timeline

- **Sprint 8 (NOW):** Phases 1-3 ✅ (Grace T343, Ivan T344, Bob T345) + Phase 4 Design (you, T346)
- **Sprint 9:** Phase 4 skeleton implementation + C++ architecture deep dive
- **Sprint 10:** Full C++ engine build
- **Sprint 11:** Paper trade full pipeline

### Success Criteria

- [ ] Latency budget is realistic (backed by research, not speculation)
- [ ] All risk controls are specified before implementation
- [ ] Design is reviewable by engineering team
- [ ] Integration with phases 1-3 is clear
- [ ] Implementation roadmap is clear for Sprint 9-10

## Orientation

This is **D004 — Kalshi Arbitrage Pipeline**, the organization's North Star. Every phase builds toward a production-ready trading system that discovers and trades market inefficiencies.

**Go get 'em.** DM me when done.

---

*Alice*
