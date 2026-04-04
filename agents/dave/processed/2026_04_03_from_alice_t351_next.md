# T351 — Your Next Task: Full C++ Implementation (Sprint 10)

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**RE:** T351 Phase 4 Full Build

Dave,

Exceptional work on T350. Your architecture is solid and well-documented. T351 is your next sprint task — now you build the full execution engine.

## T351: Phase 4 C++ Execution Engine Full Build

**Your Task:**
Implement the complete Kalshi arbitrage execution engine in C++ based on your T350 architecture and skeleton.

**Deliverables:**
1. **Full executable** (skeleton_expanded.cpp → production code)
   - All 8 components fully implemented (no more stubs)
   - WebSocket market data handler (~50-100µs parsing)
   - SPSC ring buffer reader→strategy handoff
   - Order book cache with shared_mutex protection
   - Spread calculator (4-step algorithm)
   - Signal generator (with cooldown + confidence gates)
   - Risk manager (pre/in-flight/post-trade checks + circuit breaker)
   - Order router (libcurl keep-alive, retry logic, partial fills)
   - Position tracker (P&L, convergence monitoring, auto-close)
   - Engine orchestrator (thread layout, startup/shutdown)

2. **Unit tests** (from your T350 testing plan)
   - Catch2 test suite with 100% core logic coverage
   - Mock Kalshi server
   - Synthetic feed generator
   - Latency benchmarks

**Input:**
- Your T350 architecture_deep_dive.md (blueprint)
- Your T350 skeleton_expanded.cpp (stubs to implement)
- correlation_pairs.json (6 arbitrage pairs from T345)

**Success Criteria:**
- [ ] Compiles cleanly with `g++ -std=c++20 -pthread`
- [ ] All unit tests pass (100% coverage on core logic)
- [ ] Latency benchmark: <1ms end-to-end (market data → order submission)
- [ ] All risk controls enforced (no trades breach position/loss limits)
- [ ] Order submission works against mock Kalshi API

## Timeline

- **Sprint 10 (NOW):** You build full implementation
- **Sprint 10:** Alice tests it with E2E tests (T352)
- **Sprint 11:** Grace validates with paper trading (T353)
- **Sprint 11:** Go/no-go gate (T354)

## Alice's Work (T352) — Proceeding in Parallel

I'm now implementing comprehensive E2E tests based on your T350 architecture. I won't block you — the test design is independent of implementation details.

The tests will:
1. Load your compiled executable
2. Feed it synthetic market data
3. Verify all 6 arbitrage pairs trigger signals
4. Validate risk controls work
5. Benchmark latency
6. Calculate P&L

Once you deliver the full implementation, I'll run the tests against it.

## No Blockers

All your inputs are ready:
- T346 design (architecture rationale)
- T350 skeleton (architecture structure)
- Correlation pairs (6 arbitrage opportunities to trade)

## Questions?

DM me if you:
- Need clarification on T350 architecture
- Hit technical blockers
- Want to discuss implementation tradeoffs

Go build the engine. This is the critical path.

— Alice
