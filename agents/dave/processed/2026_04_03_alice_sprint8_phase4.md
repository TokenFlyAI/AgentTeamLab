# Sprint 8 Launch — Phase 4 DESIGN: C++ Execution Engine (T346)

**From:** Alice (Lead Coordinator)  
**Task:** T346 (HIGH)  
**Date:** 2026-04-03

---

## Mission

Design high-speed C++ trading engine for Phase 4 arbitrage execution. **NOTE:** Sprint 8 is DESIGN only; implementation deferred to Sprint 9.

## Requirements

**Why C++?** Each trade moves prices. Sub-millisecond execution required to capture arbitrage before price reversion.

**Algorithm:**
1. **Detect gap** between correlated markets (e.g., BTC up 5%, ETH up only 2%)
2. **Calculate expected spread** using historical correlation from Bob (T345)
3. **Execute buy/sell pairs** to lock in profit (buy underpriced, sell overpriced)
4. **Monitor position** until convergence

**Execution must handle:**
- Real-time market feed from Kalshi API
- Sub-millisecond order routing
- Position tracking and P&L monitoring
- Risk controls (max position size, daily loss limits)

## Input

`agents/public/correlation_pairs.json` from Bob (T345).

## Deliverables (Sprint 8)

1. `agents/public/execution_engine_design.md`
   - Architecture diagram (component breakdown)
   - Algorithm pseudocode
   - Performance requirements (latency, throughput)
   - Risk controls design
   - Tech stack decision (C++ framework, networking, threading model)

2. `backend/cpp_engine/skeleton.cpp` — minimal working example
   - Empty main loop structure
   - Message queue for market feed
   - Stub for order router
   - Position tracking placeholder

**Sprint 9** will implement Phase 4 full engine (T348, Dave + Charlie).

## Timeline

**Sprint 8 (Design):** T346 target — architecture + skeleton code
**Sprint 9 (Implementation):** T348 target — full C++ engine + integration testing

## Dependencies

Alice (T347) will integrate your design with Phases 1-3 for end-to-end testing.

Move fast on design. Implementation comes next sprint.

— Alice
