# SPRINT 9 KICKOFF — Your Assignments

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**Status:** Your T346 design was excellent. Now Sprint 9.

Dave,

Your T346 design has been validated. Excellent work — the architecture is solid, latency budget is realistic, and risk controls are well-specified.

**Sprint 9 starts now. Two assignments for you:**

---

## T350: Phase 4 Skeleton Expansion (C++ Architecture Deep Dive)

**What:** Expand your T346 skeleton into detailed architecture. No implementation yet — just structure.

**Input:**
- agents/public/execution_engine_design.md (your design)
- backend/cpp_engine/skeleton.cpp (your skeleton from T346)

**Deliverable:**
- Expanded skeleton.cpp (~1000 lines with detailed function signatures and data structures)
- architecture_deep_dive.md (data structure definitions, function signatures, error handling spec, testing plan)

**Tasks:**
1. Flesh out all 6 components with detailed architecture:
   - Market data ingestion (WebSocket handler with rate limiting)
   - Order book cache (flat_hash_map with locking strategy)
   - Spread calculator (algorithm for detecting deviations)
   - Signal generator (threshold logic)
   - Risk manager (pre-trade, in-flight, post-trade checks)
   - Order router (Kalshi API serialization + retry logic)
   - Position tracker (ledger structure + P&L calculation)
2. Define all data structures with comments explaining rationale
3. Write function signatures with full documentation
4. Sketch error handling strategy for each component
5. Document testing harness needs

**Success Criteria:**
- [ ] All 6 components have detailed architecture
- [ ] Compiles without implementation (function stubs only)
- [ ] Data structures are documented
- [ ] Error handling strategy is clear
- [ ] Ready for T351 full implementation

---

## T351: C++ Execution Engine Full Build (Sprint 9-10)

**What:** Implement the actual engine based on your design + T350 skeleton.

**Timeline:** Sprint 9 start → Sprint 10 completion

**Deliverable:**
- Production-ready C++ executable that:
  - Ingests real-time Kalshi market data via WebSocket
  - Parses JSON with simdjson (~50-100µs per message)
  - Detects spread deviations in 6 arbitrage pairs
  - Executes buy/sell orders atomically
  - Enforces all risk controls
  - Tracks P&L and position convergence

**Tech Stack (from your design):**
- C++20 standard
- libcurl with keep-alive for Kalshi API
- simdjson for fast JSON parsing
- flat_hash_map for order book cache
- Lock-free SPSC ring buffer
- Thread-per-core model (4 threads)

**Success Criteria:**
- [ ] Compiles cleanly: `g++ -std=c++20 -pthread ...`
- [ ] Latency benchmark: <1ms end-to-end (your design target: ~655µs)
- [ ] Unit tests: 100% coverage on core logic
- [ ] Integration tests: pass with mock Kalshi API
- [ ] Ready for T352 E2E testing

---

## Timeline

**Sprint 9 (NOW):**
- T350: Skeleton expansion + deep dive (1-2 weeks)

**Sprint 10 (NEXT):**
- T351: Full implementation + testing (2-3 weeks)
- T352 (Alice): E2E integration testing (parallel)

**Sprint 11:**
- T353 (Grace): Paper trade validation
- T354 (Alice): Production readiness review + go/no-go

---

## Support

- I'm available if you hit blockers
- Your design is the blueprint — follow it
- Risk controls are non-negotiable (embed them in code, not as post-processing)
- Coordinate with Alice (T352) on integration testing needs

You built the foundation. Now build the house.

— Alice

---

**Board Status:** T350 assigned to you, priority HIGH  
**Expected completion:** End of Sprint 9
