# T352 E2E Integration Testing Plan

**Task:** T352 — SPRINT 10 Phase 4 E2E Integration Testing  
**Owner:** Alice (Lead Coordinator)  
**Date:** 2026-04-03  
**Status:** DESIGN PHASE (Sprint 9)

---

## Objective

Design comprehensive end-to-end integration tests for the complete Kalshi arbitrage pipeline (Phases 1-4). Validate that:
1. All 6 arbitrage pairs from Phase 3 are detected correctly by Phase 4 execution engine
2. Spread deviations trigger accurate signal generation
3. Orders route to Kalshi API correctly
4. Risk controls enforce position limits and circuit breakers
5. Position tracking and P&L calculation are accurate
6. End-to-end latency is <1ms

---

## Test Architecture

### Test Harness Framework
- **Language:** C++ (Catch2 or gtest)
- **Mock Kalshi API:** Deterministic responses (no real API calls)
- **Data Source:** agents/public/correlation_pairs.json (6 pairs from T345)
- **Build:** Integrated with backend/cpp_engine skeleton

### Test Suite Structure

```
tests/
├── e2e/
│   ├── pipeline_integration.cpp
│   │   ├── Test 1: Data Flow (P1→P2→P3→P4)
│   │   ├── Test 2: Arbitrage Pair Detection (6/6 pairs)
│   │   ├── Test 3: Spread Signal Triggering
│   │   ├── Test 4: Risk Control Enforcement
│   │   ├── Test 5: Order Routing & Execution
│   │   └── Test 6: Position Tracking & P&L
│   ├── latency_benchmarks.cpp
│   │   ├── Market Data Ingestion: <100µs (50-100µs target)
│   │   ├── Signal Generation: <500µs
│   │   ├── Order Submission: <400µs
│   │   └── End-to-End: <1ms
│   └── edge_cases.cpp
│       ├── Partial Fills
│       ├── Network Latency
│       ├── Correlation Stale
│       ├── Circuit Breaker Trigger
│       └── Position Limits
├── integration/
│   ├── mock_kalshi_api.cpp
│   ├── mock_market_feed.cpp
│   └── test_harness.cpp
└── data/
    ├── correlation_pairs.json (6 pairs)
    ├── market_feed_samples.json
    └── expected_signals.json
```

---

## Test Cases (Detailed)

### Test 1: Full Pipeline Data Flow
**Purpose:** Verify data flows correctly from Phase 1 through Phase 4

```
Input: 
  - markets_filtered.json (Phase 1)
  - market_clusters.json (Phase 2)
  - correlation_pairs.json (Phase 3)
  
Processing:
  - Load pairs into execution engine
  - Stream market data (WebSocket mock)
  - Trigger spread calculation
  
Output:
  - Arbitrage signal generated
  - Order submitted to Kalshi API (mock)
  - Position tracked
  
Assertion: Full cycle completes <1ms, zero data loss
```

### Test 2: Arbitrage Pair Detection (6/6)
**Purpose:** All 6 high-confidence pairs detect signals when spreads deviate

For each pair in correlation_pairs.json:
```
Input:
  - Pair: market_a, market_b, pearson_correlation, expected_spread
  - Market data: current_a, current_b (with deviation > 2σ)
  
Processing:
  - Calculate spread vs expected
  - Generate signal if deviation > threshold
  
Assertion: 
  - 6/6 pairs generate signals
  - Signal confidence matches arbitrage_confidence from Phase 3
```

### Test 3: Risk Control Enforcement
**Purpose:** Verify risk manager blocks trades when limits exceeded

Sub-tests:
```
3a. Position Limit Check (MAX_POSITION_SIZE = 1000)
    - Trade 1 (500 units): ✓ PASS
    - Trade 2 (600 units): ✗ BLOCKED (exceeds limit)
    
3b. Daily Loss Limit (MAX_DAILY_LOSS = $500)
    - Trade 1 (PnL = -$100): ✓ PASS
    - Trade 2 (PnL = -$150): ✓ PASS
    - Trade 3 (PnL = -$300): ✗ BLOCKED (cumulative > $500)
    
3c. Circuit Breaker (max 3 losses in 60s)
    - Loss 1: ✓ PASS
    - Loss 2: ✓ PASS
    - Loss 3: ✓ PASS
    - Loss 4 (within 60s): ✗ CIRCUIT BREAKER TRIGGERED
    
3d. Correlation Freshness (<60s old)
    - Fresh correlation: ✓ PASS
    - Stale correlation (>60s): ✗ BLOCKED
```

### Test 4: Order Routing & Execution
**Purpose:** Orders submit to Kalshi API with correct structure

```
Input: Arbitrage signal (market_a, market_b, direction, quantity)

Processing:
  - Serialize paired orders (buy A + sell B, or vice versa)
  - Submit to Kalshi API (mock) with keep-alive
  - Handle partial fills
  - Retry with exponential backoff if failed

Assertions:
  - Order JSON schema valid
  - Paired orders submitted atomically
  - Retries use exponential backoff (1s, 2s, 4s)
  - Circuit breaker stops retries after max 3 attempts
```

### Test 5: Position Tracking & P&L
**Purpose:** Positions tracked accurately, P&L calculated correctly

```
Scenario: Trade 2 pairs simultaneously

Position A: Buy 100 @ $60, Sell @ $65 → P&L = +$500
Position B: Buy 50 @ $80, Sell @ $78 → P&L = -$100

Total P&L: +$400

Assertions:
  - Open positions tracked: [Pos_A, Pos_B]
  - Realized P&L: +$400
  - Unrealized P&L: 0 (both closed)
  - Drawdown: 0% (profitable)
```

### Test 6: Latency Benchmarks
**Purpose:** Verify <1ms end-to-end latency

```
Measurement Points:
  1. Market data received → t0
  2. Data parsed (simdjson): t0 + ~1µs
  3. Order book updated: t0 + ~50µs
  4. Spread calculated: t0 + ~100µs
  5. Signal generated: t0 + ~300µs
  6. Order formatted: t0 + ~400µs
  7. Order submitted (libcurl): t0 + ~655µs
  
Target: < 1000µs (1ms) end-to-end
```

---

## Mock Kalshi API Design

```cpp
struct MockKalshiAPI {
  // Returns deterministic responses
  OrderResponse submitOrder(const Order& order);
  
  // Configurable for error injection
  bool shouldFail();           // Trigger network error
  bool shouldPartialFill();    // Partial fill scenario
  int fillLatencyMs();         // Variable latency
};
```

---

## Test Data

### correlation_pairs.json (Input)
```json
[
  {
    "market_a": "SP500-5000",
    "market_b": "NASDAQ-ALLTIME",
    "pearson_correlation": 0.951,
    "expected_spread": 0.0259,
    "arbitrage_confidence": 0.97
  },
  // ... 5 more pairs
]
```

### market_feed_samples.json (Mock Data)
```json
[
  {
    "market": "SP500-5000",
    "yes_price": 62.50,
    "no_price": 37.50,
    "volume": 15000,
    "timestamp": "2026-04-03T20:30:00Z"
  },
  // ... more samples
]
```

---

## Success Criteria

| Criterion | Target | Notes |
|-----------|--------|-------|
| Pair Detection | 6/6 pairs | All arbitrage pairs trigger signals |
| Signal Quality | Confidence match | Signals match Phase 3 confidence scores |
| Risk Controls | 100% enforcement | No trades breach limits |
| Order Submission | 100% success | All orders route to Kalshi API (mock) |
| Position Tracking | 100% accuracy | P&L matches manual calculation |
| Latency | <1ms | End-to-end market data → order submission |
| Test Coverage | 100% core logic | Risk manager, order router, spread calc |

---

## Dependencies

- **Input:** T351 (Phase 4 full implementation from Dave)
- **Pre-requisite:** T350 (skeleton architecture from Dave)
- **Data:** correlation_pairs.json (from Bob T345)

---

## Timeline

- **Sprint 9 (NOW):** This design document + test harness skeleton
- **Sprint 10:** Implement tests + run against T351 implementation
- **Sprint 11:** Final validation before production readiness gate (T354)

---

## Next Steps

1. Get Dave's T350 skeleton expansion to refine test harness architecture
2. Implement test data generators (mock Kalshi API, market feeds)
3. Write Catch2 test cases once T351 implementation available
4. Benchmark latency on target hardware
5. Run full suite before T354 production gate

**Status:** Design complete, ready for implementation once T351 available.

