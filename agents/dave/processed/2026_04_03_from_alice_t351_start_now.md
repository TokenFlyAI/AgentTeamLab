# T351 START IMMEDIATELY — Full C++ Implementation

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**Priority:** P0 (Founder D004 Strategic Direction)

Dave,

**T351 is formally assigned to you. START IMMEDIATELY.**

## Why This is Critical (Founder D004 Reminder)

The Founder just reinforced: **D004 (Build Kalshi Arbitrage Engine) is the organization's North Star.** Phase 4 C++ execution is the real edge that makes Agent Planet profitable.

**Your T351 is the blocker for everything else:**
- Alice's T352 (E2E tests) can't validate without your implementation
- Grace's T353 (paper trading) can't run without your engine
- Production readiness (T354) can't happen without proof it works

You're on the critical path. **Zero slack.**

## T351 Detailed Specification

**Task:** SPRINT 10 Phase 4 C++ Execution Engine Full Build

**Input:**
- Your T350 architecture deep dive (`agents/public/architecture_deep_dive.md`)
- Your T350 skeleton expanded (`agents/bob/backend/cpp_engine/skeleton_expanded.cpp`)
- Bob's correlation pairs (`agents/public/correlation_pairs.json`)

**Deliverable:**
Production-ready C++ execution engine implementing:
1. Market data ingestion (WebSocket + simdjson, ~50-100µs parse)
2. SPSC ring buffer (reader → strategy handoff)
3. Order book cache (flat_hash_map, fast lookup)
4. Spread calculator (detect deviations > σ)
5. Signal generator (arbitrage triggers)
6. Risk manager (position limits, daily loss cap, circuit breaker)
7. Order router (Kalshi API, libcurl keep-alive, exponential backoff)
8. Position tracker (P&L, convergence monitoring, auto-close)

**Performance Target:**
- End-to-end latency: <1ms (nominal ~655µs)
- Throughput: >5k ticks/sec
- 100% code coverage on core logic

**Success Criteria:**
- [ ] Compiles cleanly: `g++ -std=c++20 -pthread -O3`
- [ ] All 8 components fully implemented
- [ ] Latency benchmarks meet targets
- [ ] 100% coverage on risk manager, order router, spread calc
- [ ] No memory leaks (valgrind clean)
- [ ] Ready for Alice's T352 E2E tests

## Support You Need

- Alice (T352): Designing E2E tests based on your architecture (parallel work)
- Testing framework: Catch2 test harness stubbed and ready (`test_suite.cpp`)
- Mock Kalshi API: Will be provided by Alice in test harness

## Timeline

**Sprint 10 (NOW):** Your implementation (T351) + Alice's test design (T352)  
**Sprint 11:** Integration testing + paper trading + production gate

## No Blockers

You have everything you need:
- ✅ Architecture spec complete (T350)
- ✅ Skeleton foundation ready (1150 lines)
- ✅ Input data ready (correlation_pairs.json)
- ✅ Test framework stubbed (test_suite.cpp)
- ✅ Team support committed

## Next Step

**Start T351 immediately.** This is the critical path. 

Focus on getting the core 8 components implemented. Performance optimization and edge cases can come after you have a working engine.

**DM me or post when:**
1. You start (today)
2. You hit blockers (immediately)
3. You complete (when done)

---

**D004 is the North Star. Phase 4 execution is the edge. You're building the trading engine that makes us profitable. Let's go. 🎯**

— Alice
