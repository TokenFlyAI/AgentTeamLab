# T352 Integration Test Design Specification

**Task:** T352 — SPRINT 10 Phase 4 E2E Integration Testing  
**Owner:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**Status:** Design Phase (Pre-Sprint-10)

---

## 1. Purpose

Design comprehensive end-to-end tests for the **complete Kalshi arbitrage pipeline** (Phases 1-4 integrated).

**Critical requirement:** Validate that all 6 arbitrage opportunities (from T345 Bob's correlation detection) flow correctly through the full system:
- Phase 1: Market filtering (Grace T343)
- Phase 2: LLM clustering (Ivan T344)
- Phase 3: Pearson correlation (Bob T345)
- Phase 4: C++ execution engine (Dave T351)

---

## 2. Test Scope

### 2.1 Data Flow Validation
```
Kalshi Market Feed
    ↓
Phase 1: Market Filter (volume + yes/no ratio)
    ↓
Phase 2: LLM Clustering (semantic grouping)
    ↓
Phase 3: Pearson Correlation (pair identification)
    ↓
Phase 4: Execution Engine (trade execution)
    ↓
Order Submissions to Kalshi API (mocked)
```

**Test:** Validate that data flows correctly at each boundary with zero loss or corruption.

### 2.2 Arbitrage Pair Detection
**Input:** 6 arbitrage opportunities from `agents/public/correlation_pairs.json`

**Test:** Each pair must:
- [ ] Be detected by spread calculator (current_spread vs expected_spread)
- [ ] Trigger signal generator (deviation > σ threshold)
- [ ] Pass risk manager pre-flight checks
- [ ] Generate buy/sell orders with correct direction

**Top 3 Pairs to Validate:**
1. SP500-5000 ↔ NASDAQ-ALLTIME (r=0.951, confidence=0.97)
2. BTCW-26-JUN-100K ↔ ETHW-26-DEC-5K (r=0.938, confidence=0.96)
3. BTC-DOM-60 ↔ ETH-BTC-RATIO (r=0.932, confidence=0.96)

### 2.3 Risk Control Validation
**Pre-Trade Checks:**
- [ ] Position limit enforcement (max per pair, aggregate limit)
- [ ] Daily loss circuit breaker (no trading after $X loss)
- [ ] Correlation freshness (must be < 60s old)
- [ ] Spread sanity gates (reject outlier spreads)

**In-Flight Safeguards:**
- [ ] Order rejection handling (order broker returns error)
- [ ] Partial fill tracking (tracking 2 correlated orders)
- [ ] Timeout management (order submission timeout)

**Post-Trade Safeguards:**
- [ ] Position tracking accuracy (knows open legs)
- [ ] P&L calculation correctness (realized vs unrealized)
- [ ] Convergence monitoring (auto-close when spread reverts)

### 2.4 Latency Validation
**Target:** <1ms end-to-end (market data arrival → order submission)

**Measurement Points:**
- Market data parse time (simdjson): <50µs
- Spread calculation: <100µs
- Signal generation: <50µs
- Risk check: <100µs
- Order routing: <500µs
- **Total:** <800µs (with margin to <1ms)

**Test Tool:** Benchmark with chrono::high_resolution_clock

---

## 3. Test Infrastructure

### 3.1 Mock Kalshi API
Create realistic mock that simulates:
- Market feed with realistic price updates
- Order submission with latency (~50-100ms network delay)
- Partial fills (some orders fill immediately, others take time)
- Order rejections (e.g., insufficient balance, invalid price)
- Market conditions (liquidity, volatility, edge cases)

**Implementation:** WebSocket mock server (Node.js or similar)

### 3.2 Test Scenarios

#### Scenario 1: Happy Path (Single Arbitrage)
- Market data arrives for SP500-5000 + NASDAQ-ALLTIME
- Spread detected (current_spread != expected_spread by >2σ)
- Signal generated
- Risk checks pass
- Orders submitted (buy SP500, sell NASDAQ)
- Orders fill
- Position tracked
- Spread converges → auto-close executed
- P&L calculated and logged

**Expected:** Orders execute, pair closes profitably

#### Scenario 2: Risk Control Triggers
- Market data: FED-RATE-DEC + CPI-OVER-4 (high correlation pair)
- Spread detected
- **Risk trigger:** Daily loss limit already hit
- Signal **blocked** by risk manager
- No orders submitted
- System remains ready for next opportunity

**Expected:** Risk manager blocks trade

#### Scenario 3: Partial Fill Scenario
- Orders submitted (buy A, sell B)
- Buy A fills immediately
- Sell B delayed (order book illiquidity)
- System tracks open leg
- Sell B eventually fills
- Position closed correctly
- P&L includes both fills

**Expected:** Both legs tracked, P&L accurate

#### Scenario 4: Correlation Freshness Failure
- Spread detected
- Correlation data is >60s old
- **Risk gate:** Reject trade (correlation may have changed)
- No orders submitted

**Expected:** Stale correlation rejected

#### Scenario 5: Latency Benchmark
- 100 consecutive market updates
- Measure: data arrival → order submission
- Validate all <1ms
- Report: p50, p95, p99 latencies

**Expected:** All <1ms, p99 <900µs

---

## 4. Test Implementation Plan

### Phase 1: Setup (Pre-Sprint-10)
- [x] Design spec (this document)
- [ ] Mock Kalshi API server implementation
- [ ] Test data generators (realistic market data, correlation pairs)
- [ ] Latency measurement harness

### Phase 2: Build (Sprint 10, parallel with Dave T351)
- [ ] Implement Catch2/gtest test suite
- [ ] Write 5 main scenarios above
- [ ] Add edge case tests (invalid orders, network failures, etc.)
- [ ] Performance benchmarks

### Phase 3: Run (Sprint 10, after Dave T351 delivered)
- [ ] Execute all tests against Dave's Phase 4 implementation
- [ ] Validate latency <1ms
- [ ] Validate all 6 pairs detect correctly
- [ ] Risk controls pass validation
- [ ] Generate integration_report.md with results

---

## 5. Success Criteria

✅ **All 6 arbitrage pairs detect and execute correctly**
✅ **All risk controls enforce properly**
✅ **Latency <1ms (p99 <900µs)**
✅ **Zero data loss between phases**
✅ **Position tracking 100% accurate**
✅ **P&L calculation verified**
✅ **100% test pass rate**

---

## 6. Deliverables

1. **test_suite.cpp** (Catch2/gtest)
   - 5 main scenario tests
   - 10+ edge case tests
   - Latency benchmarks

2. **integration_report.md**
   - Test results summary
   - Latency analysis (p50/p95/p99)
   - Risk control validation report
   - Any failures or warnings

3. **performance_benchmarks.json**
   - Latency per component
   - End-to-end latency distribution
   - Order throughput

---

## 7. Dependencies & Timeline

**Pre-requisite:** Dave T351 (full Phase 4 implementation) must be delivered before running tests

**Timeline:**
- **Sprint 10 (NOW - Design):** Write tests, set up infrastructure
- **Sprint 10 (After T351):** Run against implementation, collect results
- **Sprint 11:** Report to T354 production readiness gate

---

## Next Steps

1. Build mock Kalshi API server
2. Implement Catch2 test harness
3. Write 5 scenario tests
4. Add edge case coverage
5. Implement latency benchmarking

**Ready to proceed when Dave delivers T351.**

