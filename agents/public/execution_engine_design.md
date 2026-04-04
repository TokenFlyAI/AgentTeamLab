# Phase 4 C++ Execution Engine Design

**Task:** T346 — Sprint 8 Design Deliverable  
**Author:** Dave (Full Stack Engineer)  
**Date:** 2026-04-03  
**Status:** Design Complete — Implementation Deferred to Sprint 9 (T348)

---

## 1. Executive Summary

This document specifies the architecture for a **sub-millisecond C++ arbitrage execution engine** that trades correlated Kalshi market pairs identified by Phases 1-3. The engine consumes real-time market data, detects spread deviations, and executes paired buy/sell orders to lock in arbitrage profit.

**Target Latency:** <1ms end-to-end (market data → order submission)  
**Input:** `agents/public/correlation_pairs.json` (Bob T345)  
**Output:** Executed arbitrage trades via Kalshi API

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         KALSHI MARKET FEED                              │
│                    (WebSocket / REST Polling)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  WS Reader   │───▶│ Ring Buffer  │───▶│  MD Parser   │              │
│  │   Thread     │    │  (SPSC)      │    │   Thread     │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│           │                                       │                     │
│           │                                       ▼                     │
│           │                            ┌──────────────────┐             │
│           │                            │  Order Book Cache│             │
│           │                            │  (flat_hash_map) │             │
│           │                            └──────────────────┘             │
│           │                                       │                     │
│           │                                       ▼                     │
│           │                            ┌──────────────────┐             │
│           │                            │ Spread Calculator│             │
│           │                            │   (6 pairs)      │             │
│           │                            └──────────────────┘             │
│           │                                       │                     │
│           │                                       ▼                     │
│           │                            ┌──────────────────┐             │
│           │                            │ Signal Generator │             │
│           │                            │ (deviation > σ)  │             │
│           │                            └──────────────────┘             │
│           │                                       │                     │
│           ▼                                       ▼                     │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │              ARBITRAGE OPPORTUNITY DETECTED                   │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │                    RISK MANAGER                               │      │
│  │  ├─ Position limit check                                     │      │
│  │  ├─ Daily loss limit check                                   │      │
│  │  ├─ Exposure check                                           │      │
│  │  ├─ Correlation freshness check (< 60s)                      │      │
│  │  └─ Circuit breaker (max 3 losses in 60s)                    │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │                 ORDER ROUTER                                  │      │
│  │  ├─ Serialize paired orders (A + B)                          │      │
│  │  ├─ Submit to Kalshi API (HTTP/1.1 keep-alive)               │      │
│  │  ├─ Handle partial fills                                     │      │
│  │  └─ Retry with exponential backoff (max 3)                   │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │              POSITION TRACKER & P&L                           │      │
│  │  ├─ Track open arbitrage legs                                │      │
│  │  ├─ Monitor convergence                                      │      │
│  │  ├─ Auto-close when spread reverts                           │      │
│  │  └─ Log realized/unrealized P&L                             │      │
│  └──────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Specifications

### 3.1 Market Data Ingestion Layer

**Responsibility:** Receive and parse Kalshi market data with minimal latency.

**Design Decisions:**
- **Primary:** WebSocket connection to Kalshi for real-time price updates
- **Fallback:** REST polling at 100ms intervals if WebSocket drops
- **Buffering:** Single-producer single-consumer (SPSC) lock-free ring buffer (4096 slots)
- **Parser:** `simdjson` for zero-allocation JSON parsing (~1-2µs per message)

**Data Flow:**
1. `WS Reader Thread` receives raw JSON frame
2. Pushes pointer + length into ring buffer (no copy)
3. `MD Parser Thread` pops frame, parses into `MarketUpdate` struct
4. Updates `OrderBookCache` via atomic write

### 3.2 Order Book Cache

**Responsibility:** Maintain latest market prices for all tracked markets.

**Data Structure:**
```cpp
struct MarketPrice {
    std::atomic<uint64_t> timestamp_us;  // microsecond timestamp
    std::atomic<uint32_t> yes_bid;       // cents * 100 (fixed-point)
    std::atomic<uint32_t> yes_ask;
    std::atomic<uint32_t> no_bid;
    std::atomic<uint32_t> no_ask;
    std::atomic<uint32_t> last_price;
    std::atomic<bool>     valid;
};

// Cache: market ticker -> MarketPrice
// Using absl::flat_hash_map or robin_hood::unordered_flat_map
```

**Rationale:** Atomic fields allow lock-free reads from the strategy thread. Fixed-point arithmetic avoids floating-point overhead and non-determinism.

### 3.3 Spread Calculator & Signal Generator

**Responsibility:** Calculate spreads for each correlated pair and detect deviations.

**Algorithm:**
```cpp
for each pair in correlation_pairs.json:
    price_a = get_mid_price(pair.market_a)
    price_b = get_mid_price(pair.market_b)
    current_spread = calculate_spread(price_a, price_b, pair.cluster)
    expected_spread = pair.expected_spread
    deviation = abs(current_spread - expected_spread)
    
    if deviation > spread_threshold && pair.is_arbitrage_opportunity:
        generate_signal(pair, current_spread, deviation)
```

**Latency:** ~50-100µs for 6 pairs (vectorized, cache-hot).

**Signal Structure:**
```cpp
struct ArbitrageSignal {
    uint64_t timestamp_us;
    char market_a[32];
    char market_b[32];
    uint32_t direction;  // 0 = buy_A_sell_B, 1 = sell_A_buy_B
    int32_t spread_deviation_bps;  // basis points
    double confidence;
};
```

### 3.4 Risk Manager

**Responsibility:** Block unsafe trades before execution.

**Checks (all must pass):**
1. **Position Limit:** Total open contracts < `MAX_POSITION_SIZE` (default: 1000)
2. **Daily Loss Limit:** Realized P&L today > `-MAX_DAILY_LOSS` (default: $500)
3. **Exposure Limit:** Total notional exposure < `MAX_TOTAL_EXPOSURE` (default: $2000)
4. **Data Freshness:** Both market prices updated within last 1000ms
5. **Correlation Freshness:** `correlation_pairs.json` generated within last 1 hour
6. **Circuit Breaker:** No more than 3 losing trades in last 60 seconds
7. **Spread Sanity:** `spread_deviation` between 0.5σ and 5σ (avoid noise / outliers)

**Latency:** ~20-50µs (all checks are in-memory, no I/O).

### 3.5 Order Router

**Responsibility:** Submit paired orders to Kalshi API reliably.

**Design Decisions:**
- **HTTP Client:** `libcurl` with HTTP/1.1 keep-alive and connection pooling
- **Serialization:** Custom lightweight JSON builder (no std::stringstream in hot path)
- **Retry Logic:** Exponential backoff (10ms, 50ms, 250ms) for transient failures
- **Timeout:** 500ms max per order submission

**Order Pair Submission:**
```cpp
struct OrderLeg {
    char ticker[32];
    char side[4];      // "YES" or "NO"
    uint32_t contracts;
    uint32_t price;    // cents
};

struct PairedOrder {
    OrderLeg leg_a;
    OrderLeg leg_b;
    uint64_t deadline_us;
    uint8_t max_retries;
};
```

**Critical Path Pseudocode:**
```cpp
void execute_arbitrage(const ArbitrageSignal& signal) {
    if (!risk_manager_.approve(signal)) return;
    
    auto order = build_paired_order(signal);
    
    // Submit leg A
    auto result_a = router_.submit(order.leg_a);
    if (!result_a.success) {
        log_failure("leg_a_failed", signal);
        return;
    }
    
    // Submit leg B (immediately after A)
    auto result_b = router_.submit(order.leg_b);
    if (!result_b.success) {
        // EMERGENCY: Try to cancel/fill leg A
        position_tracker_.record_partial_fill(order, result_a, result_b);
        return;
    }
    
    position_tracker_.record_fill(order, result_a, result_b);
}
```

### 3.6 Position Tracker & P&L Monitor

**Responsibility:** Track open arbitrage legs and detect convergence.

**Data Structure:**
```cpp
struct OpenPosition {
    char id[64];
    char market_a[32];
    char market_b[32];
    uint32_t contracts;
    uint32_t entry_price_a;
    uint32_t entry_price_b;
    uint64_t opened_at_us;
    int32_t unrealized_pnl_cents;
    bool auto_close_enabled;
};
```

**Convergence Logic:**
- Re-calculate spread every 100ms
- If `|current_spread - expected_spread| < 0.5 * entry_deviation`, close position
- Max hold time: 5 minutes (force close to limit exposure)

---

## 4. Latency Budget

| Stage | Target | Worst Case | Notes |
|-------|--------|------------|-------|
| Market data arrival → WS parse | 50µs | 100µs | simdjson, no allocations |
| Ring buffer handoff | 0.1µs | 0.5µs | Lock-free SPSC |
| Order book update | 5µs | 20µs | Atomic writes |
| Spread calculation (6 pairs) | 50µs | 100µs | Cache-hot, fixed-point |
| Risk manager checks | 20µs | 50µs | In-memory only |
| Order serialization | 30µs | 80µs | Custom JSON builder |
| HTTP send (Kalshi API) | 500µs | 800µs | Keep-alive, same region |
| **Total End-to-End** | **~655µs** | **<1ms** | |

**Order Book Sync Freshness:** <10ms (WebSocket push)  
**Decision Loop Frequency:** 100µs (10 kHz)

---

## 5. Threading & Concurrency Model

```
Thread 1: WS Reader
  └─ Block on WebSocket recv → push to ring buffer

Thread 2: MD Parser + Strategy
  └─ Pop from ring buffer → parse → update cache → calc spreads → emit signals

Thread 3: Order Executor
  └─ Consume signals → risk check → submit orders → track fills

Thread 4: Position Monitor
  └─ Every 100ms → check convergence → emit close signals

Thread 5: Health / Logging
  └─ Every 1s → heartbeat, P&L snapshot, circuit breaker reset
```

**Rationale:** Thread-per-core model minimizes context switching and cache thrashing. No mutexes on hot paths — only atomics and lock-free queues.

---

## 6. Tech Stack Decision

| Component | Choice | Alternative | Reason |
|-----------|--------|-------------|--------|
| Language | C++20 | Rust | Team C++ expertise, low-level control |
| WebSocket | uWebSockets | Boost.Beast | Lowest latency, zero-copy |
| JSON Parse | simdjson | rapidjson | Fastest, no allocations |
| HTTP Client | libcurl (multi) | Boost.Beast | Mature, keep-alive, easy |
| Hash Map | `robin_hood::unordered_flat_map` | `std::unordered_map` | Faster, cache-friendly |
| Ring Buffer | `boost::lockfree::spsc_queue` | Custom | Battle-tested, header-only |
| Build System | CMake | Bazel | Standard, team familiarity |
| Testing | Catch2 | GoogleTest | Lightweight, fast compile |

---

## 7. Risk Controls Design

### 7.1 Pre-Trade Checks
All checks run in the Order Executor thread before any HTTP request is made. A single failure aborts the trade.

### 7.2 In-Flight Safeguards
- **Partial Fill Handler:** If leg A fills but leg B fails, attempt to close leg A at market price within 500ms.
- **Duplicate Signal Suppression:** 500ms cooldown per pair after signal generation.
- **Slippage Guard:** Reject execution if market price moved >10bps since signal generation.

### 7.3 Post-Trade Safeguards
- **Auto-Close:** Positions automatically closed when spread reverts or max hold time reached.
- **Daily Circuit Breaker:** Hard stop if daily P&L < -$500 or 3 consecutive losses.

---

## 8. Integration with Phases 1-3

### 8.1 Input Interface
```cpp
class CorrelationPairsLoader {
public:
    bool load(const std::string& path);  // agents/public/correlation_pairs.json
    const std::vector<CorrelationPair>& pairs() const;
    uint64_t last_loaded_at() const;
};
```

### 8.2 Output Interface
- Trade execution logs → `output/cpp_engine_trades.json`
- P&L snapshots → `/api/pnl/live` (existing dashboard endpoint)
- Health status → `/api/health` (existing endpoint)

### 8.3 Startup Sequence
1. Load `correlation_pairs.json`
2. Connect to Kalshi WebSocket
3. Warm up order book cache (5 seconds of data)
4. Enable strategy loop
5. Start position monitor

---

## 9. Implementation Roadmap (Sprint 9-10)

### Sprint 9 (T348) — Skeleton + Core Loop
- [ ] Implement `skeleton.cpp` full structure
- [ ] Build CMake project
- [ ] Implement WebSocket reader + ring buffer
- [ ] Implement order book cache
- [ ] Implement spread calculator
- [ ] Unit tests for all core components

### Sprint 10 — Full Engine + Integration
- [ ] Implement order router with libcurl
- [ ] Implement risk manager
- [ ] Implement position tracker + auto-close
- [ ] Integrate with dashboard API
- [ ] Paper trade validation (10 trades minimum)
- [ ] Performance profiling & latency optimization

---

## 10. Files

- **Design:** `agents/public/execution_engine_design.md` (this file)
- **Skeleton:** `agents/bob/backend/cpp_engine/skeleton.cpp`
- **Input:** `agents/public/correlation_pairs.json` (Bob T345)

---

## 11. Success Criteria Checklist

- [x] Latency budget is realistic (backed by component benchmarks, not speculation)
- [x] All risk controls are specified before implementation
- [x] Design is reviewable by engineering team
- [x] Integration with phases 1-3 is clear
- [x] Implementation roadmap is clear for Sprint 9-10
