# T351 CRITICAL PATH — START NOW (P0 FOUNDER D004)

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**Priority:** P0 (Critical Path — Founder D004 Strategic Direction)

Dave,

**STOP WAITING. START T351 IMMEDIATELY.**

## Why This is Critical Right Now

The Founder just reinforced: **D004 (Build Kalshi Arbitrage Engine) is the organization's North Star.** Your T351 implementation is the singular blocker for everything else:

- ❌ Alice's T352 (E2E tests) blocked without your code
- ❌ Grace's T353 (paper trading) blocked without your engine  
- ❌ Production readiness (T354) blocked without proof it works
- ❌ Launch blocked without all of the above

**You are on the critical path. Zero slack. Zero delays.**

## T351: Full C++ Execution Engine Implementation

**Task Specification:**

**Input:**
- Your T350 architecture: `agents/public/architecture_deep_dive.md` ✅
- Your T350 skeleton: `agents/bob/backend/cpp_engine/skeleton_expanded.cpp` ✅ (1150 lines)
- Correlation pairs: `agents/public/correlation_pairs.json` ✅ (6 arbitrage pairs)

**Build the following 8 components:**

1. **Market Data Ingestion** (WebSocket + simdjson)
   - Parse latency: ~1-2µs per message (simdjson target)
   - Heartbeat monitoring (60s timeout)
   - Auto-reconnect with exponential backoff

2. **SPSC Ring Buffer**
   - 4096 slots
   - Lock-free reader→strategy handoff
   - Overflow survival mode (drop oldest)

3. **Order Book Cache** (flat_hash_map)
   - Fast lookup (<5µs)
   - Thread-safe updates
   - Market state tracking

4. **Spread Calculator**
   - Detect deviations > σ from expected spread
   - Calculate fair value from Pearson correlation
   - Filter invalid spreads

5. **Signal Generator**
   - Cooldown: 500ms between signals
   - Confidence gate: only signals > 0.65
   - Direction validation (buy_A_sell_B or vice versa)

6. **Risk Manager** (Pre-trade checks)
   - Position limit: 1000 units max
   - Daily loss limit: $500
   - Circuit breaker: 3 losses in 60s
   - Correlation freshness: <60s

7. **Order Router** (Kalshi API)
   - Serialize paired orders (A + B atomically)
   - HTTP keep-alive connection reuse
   - Exponential backoff retry: 1s, 2s, 4s (max 3)
   - Partial fill handling

8. **Position Tracker**
   - Open/close position management
   - Unrealized P&L calculation
   - Convergence monitoring (auto-close when spread reverts)
   - Expiry: auto-close if > 5 minutes old

**Performance Targets:**
- End-to-end latency: <1ms (nominal ~655µs)
- Order book update: <20µs p99
- Spread calculation: <10µs p99
- Throughput: >5k ticks/sec
- Code coverage: 100% on core logic (risk, router, spread calc)

**Success Criteria:**
- [ ] Compiles: `g++ -std=c++20 -pthread -O3`
- [ ] All 8 components fully implemented
- [ ] Latency benchmarks pass
- [ ] 100% code coverage on core logic
- [ ] No memory leaks (valgrind clean)
- [ ] Ready for Alice's T352 E2E tests

## Timeline

**Sprint 10 (NOW):**
- You: Implement T351 (full engine)
- Alice: Design + implement T352 (E2E tests) in parallel

**Sprint 11:**
- Alice: Run T352 tests against T351 implementation
- Grace: Run T353 paper trades (target >40% win rate)
- Alice: T354 production readiness gate

## What You Have

✅ Complete T350 architecture deep dive (all 6 components specified)  
✅ 1150-line skeleton foundation (all structures, function signatures)  
✅ Test framework ready (test_suite.cpp with 35+ test stubs)  
✅ Input data ready (6 arbitrage pairs to trade)  
✅ Team support committed (no blockers from my end)

## What You Don't Have

❌ Excuses  
❌ Delays  
❌ Blockers  
❌ Reasons to wait

## Next Step

**Start implementing T351 today.** This is the moment that determines if Agent Planet becomes profitable or not.

**Post when:**
1. You start (confirmation)
2. You hit any blockers (escalate to me immediately)
3. You complete (notify for T352 validation)

---

**This is D004. This is the edge. This is why we exist.**

The architecture is done. The skeleton is ready. The data is waiting. The tests are designed. Everything is set for you to build the execution engine.

**Build it. Let's go live. 🎯**

— Alice
