# Phase 4 C++ Execution Engine — Architecture Deep Dive

**Task:** T350 — Sprint 9 Skeleton Expansion  
**Author:** Dave (Full Stack Engineer)  
**Date:** 2026-04-03  
**Status:** Design Complete — Implementation in Sprint 10 (T351)

---

## 1. Document Purpose

This deep-dive specifies every data structure, function signature, error-handling strategy, and testing requirement for the Phase 4 C++ execution engine. It is the implementation blueprint for Sprint 10 (T351).

**Prerequisites:**
- `agents/public/execution_engine_design.md` (T346 architecture)
- `backend/cpp_engine/skeleton_expanded.cpp` (T350 expanded skeleton)
- `agents/public/correlation_pairs.json` (Bob T345 input)

---

## 2. Component Breakdown

### 2.1 Market Data Ingestion (`feed::MarketFeedHandler`)

**Responsibility:** Maintain a low-latency WebSocket connection to Kalshi and push parsed updates into the ring buffer.

**Threading Model:** Dedicated `feed_thread_` in `engine::ExecutionEngine`. Runs `feed_handler_->run()`, which blocks on WebSocket `recv()`.

**Error Handling:**
- **Disconnect:** Auto-reconnect with exponential backoff (100ms, 500ms, 2s, 5s, max 30s)
- **Parse Error:** Log and drop frame (do not crash — bad frames happen)
- **Buffer Full:** If `ring_buffer_->push()` returns false, drop oldest frame by advancing tail (survival mode)
- **Heartbeat Timeout:** If no message in 60s, force reconnect

**Key Functions:**
```cpp
bool connect(const char* ws_url, const char* api_key);
void run();  // blocks until disconnect()
std::optional<MarketUpdate> parse_frame(const char* json, size_t len) const;
```

**Rate Limiting:**
- Kalshi WebSocket has no explicit rate limit, but we throttle reconnects to avoid IP bans.
- Parse budget: 5ms per frame (simdjson handles this in ~1-2µs).

---

### 2.2 Order Book Cache (`cache::OrderBookCache`)

**Responsibility:** Store the latest market prices for all tracked markets with fast lookup and thread-safe updates.

**Data Structure:**
```cpp
std::vector<std::unique_ptr<MarketPrice>> prices_;
mutable std::shared_mutex mutex_;
```

**Rationale:** `std::shared_mutex` allows multiple concurrent readers (strategy thread, position monitor) and exclusive writers (MD parser thread). Sprint 10 will benchmark against `absl::flat_hash_map` + atomic fields; the vector + shared_mutex is the conservative baseline.

**Access Patterns:**
- **Write:** Every WebSocket tick (~1-10 per second per market)
- **Read:** Every 100µs from strategy thread + every 100ms from position monitor

**Key Functions:**
```cpp
void update(const MarketUpdate& update);           // write lock
bool get_price(const char* ticker, MarketPrice& out) const;  // read lock
bool all_valid(const std::vector<std::string>& tickers) const;  // read lock
void invalidate_stale(TimestampUs now_us, uint64_t max_age_us);  // write lock
```

**Error Handling:**
- **Missing Market:** Return `false` from `get_price()`; strategy skips pair
- **Stale Price:** `invalidate_stale()` marks `valid = false` if older than 1s
- **Lock Contention:** If `mutex_` is contended, strategy thread uses cached copy from previous cycle (acceptable for 100µs loop)

---

### 2.3 Spread Calculator (`strategy::SpreadCalculator`)

**Responsibility:** Calculate fair-value spreads and detect deviations for all correlated pairs.

**Algorithm (4-Step):**

1. **Load Prices:** For each pair, retrieve `price_a` and `price_b` from cache.
2. **Compute Current Spread:**
   ```cpp
   double current = calculate_current_spread(pair, price_a, price_b);
   ```
   Spread formula depends on cluster:
   - **Ratio cluster:** `spread = log(price_a / price_b)`
   - **Difference cluster:** `spread = price_a - price_b`
   - **Normalized cluster:** `spread = (price_a - price_b) / (price_a + price_b)`
3. **Compute Fair Spread:**
   ```cpp
   double fair = pair.expected_spread;
   ```
4. **Deviation Check:**
   ```cpp
   double deviation = std::abs(current - fair);
   double sigma = deviation_sigma(pair, current);
   if (sigma >= config::SPREAD_DEVIATION_MIN_SIGMA && 
       sigma <= config::SPREAD_DEVIATION_MAX_SIGMA &&
       pair.is_arbitrage_opportunity) {
       emit_signal(...);
   }
   ```

**Key Functions:**
```cpp
double calculate_fair_spread(const CorrelationPair& pair, Price price_a, Price price_b) const noexcept;
double calculate_current_spread(const CorrelationPair& pair, Price price_a, Price price_b) const noexcept;
double deviation_sigma(const CorrelationPair& pair, double current_spread) const noexcept;
std::vector<ArbitrageSignal> calculate(const std::vector<MarketPrice>& prices, TimestampUs now_us) const;
```

**Error Handling:**
- **Missing Price:** Skip pair (no signal)
- **Zero Price:** Log warning, skip pair (division by zero guard)
- **Invalid Correlation:** If `pearson_correlation < 0.5`, skip pair (weak correlation = unreliable spread)

---

### 2.4 Signal Generator (`strategy::SignalGenerator`)

**Responsibility:** Filter raw signals to prevent noise, duplicate trades, and over-trading.

**Filters Applied:**
1. **Cooldown:** 500ms minimum between signals for the same pair
2. **Confidence Gate:** Only signals with `confidence >= pair.arbitrage_confidence`
3. **Direction Validation:** Signal direction must match `pair.direction`
4. **Contract Sizing:** Suggest `contracts = min(100, max(1, risk_budget / price))`

**Cooldown Key Generation:**
```cpp
std::string make_key(const char* a, const char* b) {
    // Sort alphabetically to ensure A:B == B:A
    return std::string(a) < std::string(b) 
        ? std::string(a) + ":" + std::string(b)
        : std::string(b) + ":" + std::string(a);
}
```

**Key Functions:**
```cpp
std::vector<ArbitrageSignal> generate(const std::vector<ArbitrageSignal>& raw_signals, TimestampUs now_us);
bool is_cooldown(const char* market_a, const char* market_b, TimestampUs now_us) const;
```

**Error Handling:**
- **Clock Skew:** If `now_us < cooldown_timestamp`, treat as cooldown active (defensive)
- **Memory Pressure:** If `cooldowns_` grows beyond 256 entries, purge entries older than 10s

---

### 2.5 Risk Manager (`risk::RiskManager`)

**Responsibility:** Enforce all trading limits before, during, and after order execution.

#### Pre-Trade Checks

| Check | Condition | Failure Action |
|-------|-----------|----------------|
| Price Freshness | Both prices updated < 1s ago | Reject signal |
| Correlation Freshness | `correlation_pairs.json` < 1h old | Reject signal |
| Position Size | `contracts <= 1000` | Reject signal |
| Daily Loss | `realized_pnl > -$500` | Reject signal |
| Exposure | `total_exposure + new_trade <= $2000` | Reject signal |
| Circuit Breaker | `< 3 losses in 60s` | Reject ALL signals |
| Spread Sanity | `0.5σ <= deviation <= 5.0σ` | Reject signal |

#### In-Flight Checks

| Check | Condition | Failure Action |
|-------|-----------|----------------|
| Slippage Guard | `|current_price - signal_price| <= 10bps` | Reject order |
| Order Size | `contracts > 0` | Reject order |
| Router Health | `order_router_->is_healthy()` | Queue order, retry in 100ms |

#### Post-Trade / Circuit Breaker

```cpp
void record_trade_outcome(bool is_win, int64_t pnl_cents, RiskSummary& summary, TimestampUs now_us);
bool update_circuit_breaker(bool is_loss, TimestampUs now_us);
```

**Circuit Breaker Logic:**
- Maintain a ring buffer of the last 20 loss timestamps
- Count losses within the last 60 seconds
- If count >= 3, set `circuit_breaker_active_ = true`
- Auto-reset after 5 minutes of no new trades

**Key Functions:**
```cpp
RiskCheckResult pre_trade_check(const ArbitrageSignal& signal,
                                 const std::vector<OpenPosition>& positions,
                                 const RiskSummary& summary,
                                 TimestampUs now_us) const;
RiskCheckResult in_flight_check(const PairedOrder& order,
                                 Price current_price_a,
                                 Price current_price_b) const;
void record_trade_outcome(bool is_win, int64_t pnl_cents, RiskSummary& summary, TimestampUs now_us);
bool update_circuit_breaker(bool is_loss, TimestampUs now_us);
```

**Error Handling:**
- **Mutex Deadlock:** All risk manager operations hold lock for <1ms; if deadlock detected, approve with warning (fail-open is safer than freezing)
- **Overflow:** P&L tracked in `int64_t` cents — overflow unlikely unless >$9e16

---

### 2.6 Order Router (`router::OrderRouter`)

**Responsibility:** Serialize orders and submit them to Kalshi API reliably.

**HTTP Strategy:**
- **Connection:** Persistent HTTP/1.1 keep-alive via libcurl `CURLMOPT_PIPELINING`
- **Timeout:** 500ms per request; 3 retries with delays 10ms, 50ms, 250ms
- **Serialization:** Custom lightweight JSON builder (no `std::stringstream` in hot path)

**JSON Builder Example:**
```cpp
std::string OrderRouter::serialize_order(const OrderLeg& leg) const {
    char buf[512];
    int n = snprintf(buf, sizeof(buf),
        "{"
        "\"ticker\":\"%s\","
        "\"side\":\"%s\","
        "\"count\":%u,"
        "\"price\":%u,"
        "\"client_order_id\":\"%s\""
        "}",
        leg.ticker, leg.side, leg.contracts, leg.price, leg.client_order_id);
    return std::string(buf, n);
}
```

**Paired Order Submission:**
```cpp
std::pair<OrderResult, OrderResult> submit_paired(const PairedOrder& order) {
    auto result_a = submit_with_retry(order.leg_a, order.max_retries);
    if (!result_a.success) {
        return {result_a, OrderResult{false, {}, "leg_a_failed", 0, 0, 0}};
    }
    auto result_b = submit_with_retry(order.leg_b, order.max_retries);
    if (!result_b.success) {
        // Emergency: attempt to cancel leg A
        cancel_order(result_a.order_id);
        position_tracker_->record_partial_fill(order, result_a, result_b);
    }
    return {result_a, result_b};
}
```

**Key Functions:**
```cpp
bool initialize();
OrderResult submit(const OrderLeg& leg);
OrderResult submit_with_retry(const OrderLeg& leg, uint8_t max_retries);
std::pair<OrderResult, OrderResult> submit_paired(const PairedOrder& order);
bool cancel_order(const char* order_id);
std::string serialize_order(const OrderLeg& leg) const;
```

**Error Handling:**
- **HTTP 429 (Rate Limit):** Back off 1 second, then retry
- **HTTP 5xx:** Retry immediately (transient Kalshi error)
- **Network Timeout:** Retry with exponential backoff
- **Partial Fill:** If leg A fills but leg B fails, attempt cancellation; if cancellation fails, leg A becomes an unhedged position tracked by `PositionTracker`

---

### 2.7 Position Tracker (`position::PositionTracker`)

**Responsibility:** Track open arbitrage legs, monitor convergence, and calculate P&L.

**Position Ledger:**
```cpp
std::vector<OpenPosition> positions_;
mutable std::mutex mutex_;
int64_t total_realized_pnl_cents_;
```

**Convergence Logic:**
```cpp
bool has_converged(const OpenPosition& pos, Price current_a, Price current_b) const {
    int32_t current_spread = calculate_spread_bps(pos.market_a, pos.market_b, current_a, current_b);
    // Converged if spread moved 50% back toward expected
    return std::abs(current_spread) <= std::abs(pos.entry_spread_bps) / 2;
}
```

**Auto-Close Triggers:**
1. **Convergence:** Spread reverted 50% toward expected
2. **Max Hold Time:** 5 minutes elapsed
3. **Stop Loss:** Unrealized P&L < -$50 per position
4. **Manual Override:** Admin close signal

**P&L Calculation:**
```cpp
int64_t calculate_pnl(const OpenPosition& pos, Price current_a, Price current_b) const {
    // P&L = (current_spread - entry_spread) * contracts
    // Simplified: use mid-price differences
    int64_t pnl_a = (static_cast<int64_t>(current_a) - static_cast<int64_t>(pos.entry_price_a)) * pos.contracts;
    int64_t pnl_b = (static_cast<int64_t>(pos.entry_price_b) - static_cast<int64_t>(current_b)) * pos.contracts;
    return pnl_a + pnl_b;  // in cents
}
```

**Key Functions:**
```cpp
void open_position(const PairedOrder& order, const OrderResult& result_a, const OrderResult& result_b);
void record_partial_fill(const PairedOrder& order, const OrderResult& result_a, const OrderResult& result_b);
std::vector<OpenPosition> update_prices(const std::vector<MarketPrice>& prices, TimestampUs now_us);
bool has_converged(const OpenPosition& position, Price current_price_a, Price current_price_b) const;
bool is_expired(const OpenPosition& position, TimestampUs now_us) const noexcept;
void close_position(const char* position_id, Price exit_price_a, Price exit_price_b,
                    int64_t realized_pnl_cents, TimestampUs now_us);
int64_t total_unrealized_pnl() const;
```

**Error Handling:**
- **Missing Position:** `close_position()` on unknown ID is a no-op with warning log
- **Price Staleness:** If prices are stale, P&L is marked as "stale_estimate" but position remains open
- **Double Close:** `is_closing` flag prevents duplicate close attempts

---

## 3. Engine Orchestrator (`engine::ExecutionEngine`)

**Responsibility:** Wire all components together and manage the lifecycle.

**Startup Sequence:**
1. `loader.load(pairs_path)` → populate `correlation_pairs_`
2. `feed_handler_->connect(ws_url, api_key)` → establish WebSocket
3. `order_router_->initialize()` → open HTTP keep-alive connection
4. Warm-up: drain ring buffer for 5 seconds to populate cache
5. Start threads: feed, strategy, position monitor, health monitor

**Shutdown Sequence:**
1. `running_ = false`
2. `feed_handler_->disconnect()` → unblock `run()`
3. Join all threads
4. Flush position ledger to disk

**Thread Layout:**
```
Thread 1: feed::MarketFeedHandler::run()
Thread 2: engine::ExecutionEngine::strategy_loop()
Thread 3: engine::ExecutionEngine::position_monitor_loop()
Thread 4: engine::ExecutionEngine::health_monitor_loop()
```

**Strategy Loop (100µs cycle):**
```cpp
void ExecutionEngine::strategy_loop() {
    while (running_) {
        // 1. Drain ring buffer into cache
        MarketUpdate update;
        while (ring_buffer_->pop(update)) {
            order_book_cache_->update(update);
        }

        // 2. Read all prices from cache
        std::vector<MarketPrice> prices = read_all_prices();

        // 3. Calculate spreads
        auto raw_signals = spread_calculator_->calculate(prices, now_us());

        // 4. Filter signals
        auto signals = signal_generator_->generate(raw_signals, now_us());

        // 5. Risk check + execute
        for (const auto& signal : signals) {
            auto check = risk_manager_->pre_trade_check(signal, positions, risk_summary_, now_us());
            if (!check.approved) continue;

            auto order = build_paired_order(signal);
            auto [result_a, result_b] = order_router_->submit_paired(order);

            if (result_a.success && result_b.success) {
                position_tracker_->open_position(order, result_a, result_b);
            } else {
                position_tracker_->record_partial_fill(order, result_a, result_b);
            }
        }

        std::this_thread::sleep_for(std::chrono::microseconds(100));
    }
}
```

**Position Monitor Loop (100ms cycle):**
```cpp
void ExecutionEngine::position_monitor_loop() {
    while (running_) {
        auto prices = read_all_prices();
        auto to_close = position_tracker_->update_prices(prices, now_us());

        for (const auto& pos : to_close) {
            // Build close orders
            auto close_order = build_close_order(pos);
            auto [result_a, result_b] = order_router_->submit_paired(close_order);
            if (result_a.success && result_b.success) {
                int64_t pnl = position_tracker_->calculate_pnl(pos, ...);
                position_tracker_->close_position(pos.position_id, ..., pnl, now_us());
                risk_manager_->record_trade_outcome(pnl > 0, pnl, risk_summary_, now_us());
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}
```

---

## 4. Error Handling Strategy

### 4.1 Fatal Errors (Engine Shutdown)
- Kalshi API credentials invalid on startup
- `correlation_pairs.json` missing or corrupt
- Memory allocation failure during initialization

### 4.2 Recoverable Errors (Log + Continue)
- WebSocket disconnect (auto-reconnect)
- Single order submission failure (retry + partial fill tracking)
- Stale market price (skip pair, wait for fresh data)
- JSON parse failure (drop frame)

### 4.3 Degraded Mode (Reduce Trading)
- Circuit breaker triggered → stop generating new signals, monitor existing positions only
- REST fallback active (WebSocket down) → widen spread thresholds (require 2σ instead of 1σ)
- One market missing from cache → skip pairs involving that market

### 4.4 Emergency Procedures
- **Unhedged Leg:** If leg A fills but leg B fails, attempt cancel → if cancel fails, close leg A at market price within 500ms
- **Runaway Position:** If position P&L < -$100, force close regardless of convergence
- **Exchange Downtime:** If Kalshi API returns 503 for >10s, enter full shutdown (close all positions on next reconnect)

---

## 5. Testing Plan

### 5.1 Unit Tests (Catch2)

| Component | Tests | Target |
|-----------|-------|--------|
| Ring Buffer | push/pop, overflow, SPSC correctness | 100% line coverage |
| Order Book Cache | update, get, stale invalidation, concurrent reads | 100% line coverage |
| Spread Calculator | fair spread, deviation sigma, skip invalid | 100% line coverage |
| Signal Generator | cooldown, confidence gate, direction filter | 100% line coverage |
| Risk Manager | all pre-trade checks, circuit breaker, edge cases | 100% line coverage |
| Order Router | serialization, retry logic, timeout handling | 100% line coverage |
| Position Tracker | open, close, P&L, convergence, expiry | 100% line coverage |

### 5.2 Integration Tests

1. **Mock Kalshi Server:** `testing::MockKalshiServer` simulates Kalshi API latency and errors
2. **Synthetic Feed:** `testing::SyntheticFeedGenerator` produces deterministic price sequences
3. **End-to-End Smoke:** Run engine for 60s on synthetic data, verify no crashes, verify positions open/close
4. **Latency Benchmark:** `testing::LatencyBenchmark` measures 1000 decision loops, reports p50/p99/p999

### 5.3 Performance Targets

| Metric | Target | Acceptance |
|--------|--------|------------|
| End-to-end latency | ~655µs | <1ms p99 |
| Decision loop | 100µs | <200µs p99 |
| Order book update | 5µs | <20µs p99 |
| HTTP submit | 500µs | <800µs p99 |
| WebSocket parse | 2µs | <10µs p99 |
| Throughput | 10k ticks/sec | >5k ticks/sec |

---

## 6. Files

| File | Purpose |
|------|---------|
| `agents/public/execution_engine_design.md` | High-level architecture (T346) |
| `agents/public/architecture_deep_dive.md` | This file — detailed blueprint (T350) |
| `backend/cpp_engine/skeleton.cpp` | Basic skeleton (T346) |
| `backend/cpp_engine/skeleton_expanded.cpp` | Expanded skeleton with all signatures (T350) |
| `agents/public/correlation_pairs.json` | Input data (Bob T345) |

---

## 7. Success Criteria Checklist

- [x] All 6 components have detailed architecture
- [x] Compiles without implementation (function stubs only)
- [x] Data structures are documented with rationale
- [x] Error handling strategy is specified per failure mode
- [x] Testing harness and plan are defined
- [x] Ready for T351 full implementation
