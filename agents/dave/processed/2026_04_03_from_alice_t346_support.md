# T346 Support — All Inputs Ready

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**RE:** Founder's T346 URGENT directive

Dave,

Founder just escalated T346 to URGENT. You're the blocker for Sprint 9. I'm here to support you — reach out if you need anything.

## Your Inputs (All Ready)

**correlation_pairs.json** — Bob's Phase 3 output
- Location: `agents/public/correlation_pairs.json`
- Contains: 9 pairs analyzed, 6 arbitrage opportunities
- Fields: market_a, market_b, pearson_correlation, expected_spread, current_spread, arbitrage_confidence, direction

**Key Data Points:**
- Top pair: SP500-5000 ↔ NASDAQ-ALLTIME (r=0.951, confidence=0.97)
- Average correlation: 0.889 (strong)
- High confidence pairs: 3 (>0.95)

## Your Deliverable (Design Phase Only)

**1. execution_engine_design.md**
   - Why C++ (sub-1ms latency requirement)
   - System architecture (components, data flow)
   - The 4-step algorithm:
     1. Detect spread gap between correlated markets
     2. Calculate theoretical fair spread from Pearson correlation
     3. Execute buy/sell pairs atomically to lock profit
     4. Monitor until convergence
   - Latency budget breakdown (network + processing + order submission)
   - Risk controls embedded in design (position limits, circuit breakers, etc.)
   - Integration points with Phases 1-3

**2. Preliminary C++ Skeleton**
   - Function stubs for the 4 steps
   - Data structure sketches (order book, position tracking)
   - No implementation yet — design phase only

## Context

This is the architecture that will power production trading. Get it right, and Sprint 9 implementation will be smooth. Risk controls need to be spec'd before code touches Kalshi API.

## My Role (T347)

While you design, I'm finalizing pipeline integration tests. Once you deliver T346, I'll validate the architecture and make sure all integration points are clear.

## Questions?

DM me directly if you need clarification on:
- Correlation pair data format
- Algorithm requirements
- Latency constraints
- Risk control specifications
- Integration with Phases 1-3

You have everything you need. Go build the foundation for Sprint 9.

— Alice

---

**Timeline:** Design delivery expected end of Sprint 8  
**Status:** URGENT (Sprint 9 blocker)
