/**
 * Phase 4 C++ Execution Engine — Expanded Skeleton (T350)
 * Task: T350 — Sprint 9 Skeleton Expansion + Architecture Deep Dive
 * Author: Dave (Full Stack Engineer)
 * Date: 2026-04-03
 *
 * This is an expanded architectural skeleton with detailed function signatures,
 * data structures, and component boundaries. Sprint 10 (T351) will implement
 * the full logic.
 */

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <thread>
#include <vector>

// ============================================================================
// Configuration & Constants
// ============================================================================

namespace config {

constexpr size_t RING_BUFFER_SIZE = 4096;
constexpr size_t MAX_MARKETS = 256;
constexpr size_t MAX_PAIRS = 16;
constexpr size_t MAX_POSITIONS = 128;
constexpr uint64_t WS_HEARTBEAT_INTERVAL_US = 30000000;   // 30s
constexpr uint64_t MD_PARSE_TIMEOUT_US = 5000;            // 5ms
constexpr uint64_t SIGNAL_COOLDOWN_US = 500000;           // 500ms
constexpr uint64_t POSITION_MAX_HOLD_US = 300000000;      // 5 minutes
constexpr uint64_t RISK_CHECK_INTERVAL_US = 100000;       // 100ms
constexpr uint64_t ORDER_RETRY_DELAYS_US[3] = {10000, 50000, 250000};  // 10ms, 50ms, 250ms
constexpr uint64_t ORDER_SUBMIT_TIMEOUT_US = 500000;      // 500ms
constexpr uint64_t MAX_DAILY_LOSS_CENTS = 50000;          // $500
constexpr uint64_t MAX_TOTAL_EXPOSURE_CENTS = 200000;     // $2000
constexpr uint64_t MAX_POSITION_SIZE = 1000;
constexpr double BACKTEST_BASELINE_WIN_RATE = 0.559;
constexpr double SPREAD_DEVIATION_MIN_SIGMA = 0.5;
constexpr double SPREAD_DEVIATION_MAX_SIGMA = 5.0;
constexpr uint64_t CORRELATION_FRESHNESS_US = 3600000000; // 1 hour
constexpr uint64_t PRICE_FRESHNESS_US = 1000000;          // 1s
constexpr uint8_t CIRCUIT_BREAKER_MAX_LOSSES = 3;
constexpr uint64_t CIRCUIT_BREAKER_WINDOW_US = 60000000;  // 60s

} // namespace config

// ============================================================================
// Core Data Structures
// ============================================================================

namespace data {

/**
 * Fixed-point price representation: price in cents * 100.
 * Example: 85.50 cents -> 8550.
 */
using Price = uint32_t;

/**
 * Timestamp in microseconds since epoch.
 */
using TimestampUs = uint64_t;

/**
 * Market price snapshot with atomic fields for lock-free reads.
 */
struct MarketPrice {
    char ticker[32];
    std::atomic<TimestampUs> timestamp_us{0};
    std::atomic<Price> yes_bid{0};
    std::atomic<Price> yes_ask{0};
    std::atomic<Price> no_bid{0};
    std::atomic<Price> no_ask{0};
    std::atomic<Price> last_price{0};
    std::atomic<uint32_t> volume{0};
    std::atomic<bool> valid{false};

    Price mid_price() const noexcept {
        const Price bid = yes_bid.load(std::memory_order_relaxed);
        const Price ask = yes_ask.load(std::memory_order_relaxed);
        if (bid > 0 && ask > 0) return (bid + ask) / 2;
        if (bid > 0) return bid;
        if (ask > 0) return ask;
        return last_price.load(std::memory_order_relaxed);
    }
};

/**
 * Raw market update from Kalshi WebSocket or REST feed.
 */
struct MarketUpdate {
    TimestampUs timestamp_us;
    char ticker[32];
    Price yes_bid;
    Price yes_ask;
    Price no_bid;
    Price no_ask;
    Price last_price;
    uint32_t volume;
    bool is_snapshot;  // true = full snapshot, false = incremental tick
};

/**
 * Correlation pair definition loaded from correlation_pairs.json.
 */
struct CorrelationPair {
    char cluster[32];
    char market_a[32];
    char market_b[32];
    double pearson_correlation;
    double expected_spread;
    double spread_threshold;
    double arbitrage_confidence;
    uint32_t direction;  // 0 = buy_A_sell_B, 1 = sell_A_buy_B
    bool is_arbitrage_opportunity;
};

/**
 * Arbitrage signal emitted when spread deviation exceeds threshold.
 */
struct ArbitrageSignal {
    TimestampUs timestamp_us;
    char market_a[32];
    char market_b[32];
    uint32_t direction;
    Price fair_value_a;
    Price fair_value_b;
    int32_t spread_deviation_bps;  // basis points
    double confidence;
    double deviation_sigma;
    uint32_t suggested_contracts;
};

/**
 * Single leg of a paired arbitrage order.
 */
struct OrderLeg {
    char ticker[32];
    char side[4];       // "YES" or "NO"
    uint32_t contracts;
    Price price;        // limit price in cents
    char client_order_id[64];
};

/**
 * Paired order representing both legs of an arbitrage trade.
 */
struct PairedOrder {
    char pair_id[64];
    OrderLeg leg_a;
    OrderLeg leg_b;
    TimestampUs created_at_us;
    TimestampUs deadline_us;
    uint8_t max_retries;
    uint8_t retry_count;
    ArbitrageSignal signal;
};

/**
 * Result of a single order submission attempt.
 */
struct OrderResult {
    bool success;
    char order_id[64];
    char error[256];
    uint32_t filled_contracts;
    Price avg_fill_price;
    TimestampUs completed_at_us;
};

/**
 * Open arbitrage position tracked by the position manager.
 */
struct OpenPosition {
    char position_id[64];
    char pair_id[64];
    char market_a[32];
    char market_b[32];
    uint32_t contracts;
    Price entry_price_a;
    Price entry_price_b;
    Price current_price_a;
    Price current_price_b;
    int32_t entry_spread_bps;
    int32_t current_spread_bps;
    int32_t unrealized_pnl_cents;
    int32_t realized_pnl_cents;
    TimestampUs opened_at_us;
    TimestampUs last_update_us;
    bool auto_close_enabled;
    bool is_closing;
};

/**
 * Daily P&L and risk summary.
 */
struct RiskSummary {
    uint64_t total_trades_today;
    uint64_t win_count_today;
    uint64_t loss_count_today;
    int64_t realized_pnl_cents;
    int64_t unrealized_pnl_cents;
    uint64_t total_exposure_cents;
    uint64_t open_position_count;
    bool circuit_breaker_triggered;
    TimestampUs last_updated_us;
};

/**
 * Pre-trade risk check result.
 */
struct RiskCheckResult {
    bool approved;
    char rejection_reason[256];
    double risk_score;  // 0.0 - 100.0, lower is better
};

} // namespace data

// ============================================================================
// Lock-Free SPSC Ring Buffer for Market Feed
// ============================================================================

namespace queue {

using data::MarketUpdate;

class MarketDataRingBuffer {
public:
    MarketDataRingBuffer();

    /**
     * Push a market update into the ring buffer.
     * @return true if successful, false if buffer is full.
     */
    bool push(const MarketUpdate& update) noexcept;

    /**
     * Pop a market update from the ring buffer.
     * @return true if successful, false if buffer is empty.
     */
    bool pop(MarketUpdate& update) noexcept;

    /**
     * Check if the buffer is empty.
     */
    bool empty() const noexcept;

    /**
     * Approximate number of items in the buffer.
     */
    size_t size_approx() const noexcept;

private:
    MarketUpdate buffer_[config::RING_BUFFER_SIZE];
    alignas(64) std::atomic<size_t> head_;
    alignas(64) std::atomic<size_t> tail_;
};

} // namespace queue

// ============================================================================
// Order Book Cache
// ============================================================================

namespace cache {

using data::MarketPrice;
using data::MarketUpdate;

/**
 * Thread-safe order book cache using read-write locks.
 * Sprint 10: benchmark against flat_hash_map + atomic fields.
 */
class OrderBookCache {
public:
    OrderBookCache();
    ~OrderBookCache();

    /**
     * Update or insert a market price snapshot.
     */
    void update(const MarketUpdate& update);

    /**
     * Retrieve a copy of the latest market price.
     * @return true if price exists and is valid.
     */
    bool get_price(const char* ticker, MarketPrice& out) const;

    /**
     * Check if all markets in the given list have valid prices.
     */
    bool all_valid(const std::vector<std::string>& tickers) const;

    /**
     * Get the number of tracked markets.
     */
    size_t market_count() const;

    /**
     * Invalidate stale prices older than max_age_us.
     */
    void invalidate_stale(data::TimestampUs now_us, uint64_t max_age_us);

private:
    mutable std::shared_mutex mutex_;
    std::vector<std::unique_ptr<MarketPrice>> prices_;
};

} // namespace cache

// ============================================================================
// Spread Calculator
// ============================================================================

namespace strategy {

using data::ArbitrageSignal;
using data::CorrelationPair;
using data::MarketPrice;
using data::Price;
using data::TimestampUs;

/**
 * Calculates fair-value spreads and detects deviations for correlated pairs.
 */
class SpreadCalculator {
public:
    explicit SpreadCalculator(const std::vector<CorrelationPair>& pairs);

    /**
     * Calculate the theoretical fair spread for a pair given current prices.
     */
    double calculate_fair_spread(const CorrelationPair& pair,
                                  Price price_a,
                                  Price price_b) const noexcept;

    /**
     * Calculate the current observed spread between two markets.
     */
    double calculate_current_spread(const CorrelationPair& pair,
                                     Price price_a,
                                     Price price_b) const noexcept;

    /**
     * Compute deviation in standard deviations from expected spread.
     */
    double deviation_sigma(const CorrelationPair& pair,
                           double current_spread) const noexcept;

    /**
     * Run spread calculation across all pairs and emit signals.
     * @param prices Map of current market prices (read from cache)
     * @param now_us Current timestamp
     * @return Vector of arbitrage signals
     */
    std::vector<ArbitrageSignal> calculate(const std::vector<MarketPrice>& prices,
                                           TimestampUs now_us) const;

private:
    std::vector<CorrelationPair> pairs_;
};

// ============================================================================
// Signal Generator
// ============================================================================

/**
 * Filters raw spread signals based on confidence, cooldown, and thresholds.
 */
class SignalGenerator {
public:
    SignalGenerator();

    /**
     * Process raw signals and emit actionable trades.
     * @param raw_signals Output from SpreadCalculator
     * @param now_us Current timestamp
     * @return Filtered signals ready for risk check
     */
    std::vector<ArbitrageSignal> generate(const std::vector<ArbitrageSignal>& raw_signals,
                                          TimestampUs now_us);

    /**
     * Check if a specific pair is in cooldown.
     */
    bool is_cooldown(const char* market_a, const char* market_b, TimestampUs now_us) const;

    /**
     * Reset all cooldowns.
     */
    void reset_cooldowns();

private:
    mutable std::mutex mutex_;
    // Key: "A:B" sorted alphabetically -> last signal timestamp
    std::vector<std::pair<std::string, TimestampUs>> cooldowns_;
};

} // namespace strategy

// ============================================================================
// Risk Manager
// ============================================================================

namespace risk {

using data::ArbitrageSignal;
using data::OpenPosition;
using data::OrderLeg;
using data::PairedOrder;
using data::RiskCheckResult;
using data::RiskSummary;
using data::TimestampUs;

/**
 * Central risk manager enforcing pre-trade, in-flight, and post-trade limits.
 */
class RiskManager {
public:
    RiskManager();

    // -----------------------------------------------------------------------
    // Pre-Trade Checks
    // -----------------------------------------------------------------------

    /**
     * Approve or reject an arbitrage signal before order generation.
     */
    RiskCheckResult pre_trade_check(const ArbitrageSignal& signal,
                                     const std::vector<OpenPosition>& positions,
                                     const RiskSummary& summary,
                                     TimestampUs now_us) const;

    /**
     * Validate that both market prices are fresh enough to trade on.
     */
    bool check_price_freshness(const char* ticker_a,
                               const char* ticker_b,
                               TimestampUs price_time_a,
                               TimestampUs price_time_b,
                               TimestampUs now_us) const;

    /**
     * Validate that correlation data is not stale.
     */
    bool check_correlation_freshness(TimestampUs generated_at, TimestampUs now_us) const;

    /**
     * Check if the daily circuit breaker has been triggered.
     */
    bool is_circuit_breaker_active(const RiskSummary& summary) const;

    // -----------------------------------------------------------------------
    // In-Flight Checks
    // -----------------------------------------------------------------------

    /**
     * Validate a built order before submission (slippage guard, size limits).
     */
    RiskCheckResult in_flight_check(const PairedOrder& order,
                                     data::Price current_price_a,
                                     data::Price current_price_b) const;

    /**
     * Check if order size is within limits.
     */
    bool check_position_size(uint32_t contracts) const noexcept;

    /**
     * Check if executing this trade would exceed daily loss limit.
     */
    bool check_daily_loss_limit(int64_t additional_risk_cents,
                                const RiskSummary& summary) const noexcept;

    /**
     * Check if executing this trade would exceed total exposure limit.
     */
    bool check_exposure_limit(uint64_t additional_exposure_cents,
                              const RiskSummary& summary) const noexcept;

    // -----------------------------------------------------------------------
    // Post-Trade / Circuit Breaker
    // -----------------------------------------------------------------------

    /**
     * Update risk summary with a completed trade outcome.
     */
    void record_trade_outcome(bool is_win,
                              int64_t pnl_cents,
                              RiskSummary& summary,
                              TimestampUs now_us);

    /**
     * Record a losing trade and check if circuit breaker should trip.
     */
    bool update_circuit_breaker(bool is_loss, TimestampUs now_us);

    /**
     * Reset circuit breaker manually (requires admin approval).
     */
    void reset_circuit_breaker();

private:
    mutable std::mutex mutex_;
    std::vector<TimestampUs> recent_losses_;
    bool circuit_breaker_active_;
    TimestampUs circuit_breaker_triggered_at_;
};

} // namespace risk

// ============================================================================
// Order Router
// ============================================================================

namespace router {

using data::OrderLeg;
using data::OrderResult;
using data::PairedOrder;
using data::TimestampUs;

/**
 * HTTP client configuration for Kalshi API.
 */
struct KalshiApiConfig {
    char base_url[128];
    char api_key[256];
    bool demo_mode;
    uint64_t connect_timeout_us;
    uint64_t request_timeout_us;
    bool keep_alive;
};

/**
 * Order router responsible for serializing and submitting orders to Kalshi.
 */
class OrderRouter {
public:
    explicit OrderRouter(const KalshiApiConfig& config);
    ~OrderRouter();

    /**
     * Initialize the HTTP client and open persistent connection.
     * @return true if connection established.
     */
    bool initialize();

    /**
     * Submit a single order leg to Kalshi.
     * @param leg Order details
     * @return OrderResult with fill info or error
     */
    OrderResult submit(const OrderLeg& leg);

    /**
     * Submit both legs of a paired order with retry logic.
     * @param order Paired arbitrage order
     * @return Pair of results (leg_a, leg_b)
     */
    std::pair<OrderResult, OrderResult> submit_paired(const PairedOrder& order);

    /**
     * Attempt to cancel an in-flight order.
     */
    bool cancel_order(const char* order_id);

    /**
     * Check router health (connection status).
     */
    bool is_healthy() const;

    /**
     * Serialize an OrderLeg into lightweight JSON.
     * Sprint 10: replace with simdjson writer or custom builder.
     */
    std::string serialize_order(const OrderLeg& leg) const;

private:
    KalshiApiConfig config_;
    void* curl_handle_;  // void* to avoid libcurl header dependency in skeleton
    bool initialized_;

    /**
     * Internal submit with retry loop.
     */
    OrderResult submit_with_retry(const OrderLeg& leg, uint8_t max_retries);
};

} // namespace router

// ============================================================================
// Position Tracker & P&L Monitor
// ============================================================================

namespace position {

using data::MarketPrice;
using data::OpenPosition;
using data::OrderResult;
using data::PairedOrder;
using data::TimestampUs;

/**
 * Tracks open arbitrage positions, monitors convergence, and calculates P&L.
 */
class PositionTracker {
public:
    PositionTracker();

    /**
     * Record a fully filled paired order as a new open position.
     */
    void open_position(const PairedOrder& order,
                       const OrderResult& result_a,
                       const OrderResult& result_b);

    /**
     * Record a partial fill (one leg failed) for cleanup tracking.
     */
    void record_partial_fill(const PairedOrder& order,
                             const OrderResult& result_a,
                             const OrderResult& result_b);

    /**
     * Update all open positions with latest market prices.
     * @return Vector of positions that should be auto-closed
     */
    std::vector<OpenPosition> update_prices(const std::vector<MarketPrice>& prices,
                                            TimestampUs now_us);

    /**
     * Check if a position has converged (spread reverted to expected).
     */
    bool has_converged(const OpenPosition& position,
                       data::Price current_price_a,
                       data::Price current_price_b) const;

    /**
     * Check if a position has exceeded max hold time.
     */
    bool is_expired(const OpenPosition& position, TimestampUs now_us) const noexcept;

    /**
     * Mark a position as closed and record realized P&L.
     */
    void close_position(const char* position_id,
                        data::Price exit_price_a,
                        data::Price exit_price_b,
                        int64_t realized_pnl_cents,
                        TimestampUs now_us);

    /**
     * Get a copy of all open positions.
     */
    std::vector<OpenPosition> get_open_positions() const;

    /**
     * Get total unrealized P&L across all open positions.
     */
    int64_t total_unrealized_pnl() const;

    /**
     * Calculate P&L for a single position given current prices.
     */
    int64_t calculate_pnl(const OpenPosition& position,
                          data::Price current_price_a,
                          data::Price current_price_b) const;

private:
    mutable std::mutex mutex_;
    std::vector<OpenPosition> positions_;
    int64_t total_realized_pnl_cents_;
};

} // namespace position

// ============================================================================
// Market Data Ingestion (WebSocket + REST Fallback)
// ============================================================================

namespace feed {

using data::MarketUpdate;
using data::TimestampUs;

/**
 * Connection state for the market data feed.
 */
enum class FeedState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    ERROR
};

/**
 * WebSocket market feed handler with automatic reconnection.
 */
class MarketFeedHandler {
public:
    explicit MarketFeedHandler(queue::MarketDataRingBuffer& ring_buffer);
    ~MarketFeedHandler();

    /**
     * Connect to Kalshi WebSocket feed.
     */
    bool connect(const char* ws_url, const char* api_key);

    /**
     * Disconnect cleanly.
     */
    void disconnect();

    /**
     * Main read loop — blocks until disconnect() is called.
     */
    void run();

    /**
     * Send periodic heartbeat to keep connection alive.
     */
    void send_heartbeat();

    /**
     * Get current connection state.
     */
    FeedState state() const noexcept;

    /**
     * Get timestamp of last received message.
     */
    TimestampUs last_message_time() const noexcept;

    /**
     * Parse a raw WebSocket JSON frame into a MarketUpdate.
     * Sprint 10: use simdjson for zero-allocation parsing.
     */
    std::optional<MarketUpdate> parse_frame(const char* json, size_t len) const;

private:
    queue::MarketDataRingBuffer& ring_buffer_;
    std::atomic<FeedState> state_;
    std::atomic<TimestampUs> last_message_time_;
    void* ws_client_;  // void* to avoid uWebSockets header dependency in skeleton
    std::thread heartbeat_thread_;
    bool should_stop_;

    void heartbeat_loop();
    void reconnect(const char* ws_url, const char* api_key);
};

} // namespace feed

// ============================================================================
// Engine Orchestrator
// ============================================================================

namespace engine {

using data::ArbitrageSignal;
using data::CorrelationPair;
using data::MarketPrice;
using data::RiskSummary;
using data::TimestampUs;

/**
 * Central orchestrator that wires all components together.
 */
class ExecutionEngine {
public:
    ExecutionEngine();
    ~ExecutionEngine();

    /**
     * Load correlation pairs and initialize all subsystems.
     */
    bool initialize(const char* correlation_pairs_path,
                    const router::KalshiApiConfig& api_config,
                    const char* ws_url);

    /**
     * Start all engine threads.
     */
    void start();

    /**
     * Graceful shutdown — stop all threads and flush state.
     */
    void stop();

    /**
     * Check if engine is running.
     */
    bool is_running() const noexcept;

    /**
     * Get current risk summary snapshot.
     */
    RiskSummary get_risk_summary() const;

    /**
     * Get latest arbitrage signals (for dashboard / debugging).
     */
    std::vector<ArbitrageSignal> get_latest_signals() const;

    // -----------------------------------------------------------------------
    // Thread entry points (called internally by start())
    // -----------------------------------------------------------------------

    void strategy_loop();
    void position_monitor_loop();
    void health_monitor_loop();

private:
    // Components
    std::unique_ptr<queue::MarketDataRingBuffer> ring_buffer_;
    std::unique_ptr<cache::OrderBookCache> order_book_cache_;
    std::unique_ptr<strategy::SpreadCalculator> spread_calculator_;
    std::unique_ptr<strategy::SignalGenerator> signal_generator_;
    std::unique_ptr<risk::RiskManager> risk_manager_;
    std::unique_ptr<router::OrderRouter> order_router_;
    std::unique_ptr<position::PositionTracker> position_tracker_;
    std::unique_ptr<feed::MarketFeedHandler> feed_handler_;

    // State
    std::vector<CorrelationPair> correlation_pairs_;
    std::atomic<bool> running_;
    std::thread feed_thread_;
    std::thread strategy_thread_;
    std::thread position_thread_;
    std::thread health_thread_;

    // Latest signals for external query
    mutable std::mutex signals_mutex_;
    std::vector<ArbitrageSignal> latest_signals_;

    // Risk summary
    mutable std::mutex risk_mutex_;
    RiskSummary risk_summary_;

    TimestampUs correlation_loaded_at_;
};

} // namespace engine

// ============================================================================
// Correlation Pairs Loader
// ============================================================================

namespace io {

using data::CorrelationPair;

/**
 * Load correlation pair definitions from JSON file.
 * Sprint 10: use simdjson for parsing.
 */
class CorrelationPairsLoader {
public:
    CorrelationPairsLoader();

    /**
     * Load pairs from the given file path.
     * @return true on successful parse.
     */
    bool load(const char* path);

    /**
     * Access loaded pairs.
     */
    const std::vector<CorrelationPair>& pairs() const noexcept;

    /**
     * Get file load timestamp.
     */
    data::TimestampUs loaded_at() const noexcept;

private:
    std::vector<CorrelationPair> pairs_;
    data::TimestampUs loaded_at_;
};

} // namespace io

// ============================================================================
// Testing Harness (Stub)
// ============================================================================

namespace testing {

/**
 * Mock Kalshi API server for integration testing.
 */
class MockKalshiServer {
public:
    MockKalshiServer();
    ~MockKalshiServer();

    bool start(uint16_t port);
    void stop();
    size_t request_count() const;
    void reset();

private:
    void* server_handle_;
    std::atomic<size_t> request_count_;
};

/**
 * Synthetic market data generator for unit tests.
 */
class SyntheticFeedGenerator {
public:
    SyntheticFeedGenerator();

    /**
     * Generate a deterministic market update sequence.
     */
    std::vector<data::MarketUpdate> generate_sequence(const char* ticker,
                                                       size_t count,
                                                       data::Price base_price,
                                                       data::Price volatility);
};

/**
 * Latency benchmark harness.
 */
class LatencyBenchmark {
public:
    LatencyBenchmark();

    void start_round();
    void end_round();
    void report() const;

private:
    std::vector<uint64_t> round_times_ns_;
};

} // namespace testing

// ============================================================================
// Main Entry Point
// ============================================================================

int main(int argc, char* argv[]) {
    std::cout << "=== Kalshi Phase 4 C++ Execution Engine (Expanded Skeleton T350) ==="
              << std::endl;

    // Default paths
    const char* pairs_path = "agents/public/correlation_pairs.json";
    const char* ws_url = "wss://trading-api.kalshi.com/v1/ws/markets";

    if (argc > 1) pairs_path = argv[1];
    if (argc > 2) ws_url = argv[2];

    // Load correlation pairs
    io::CorrelationPairsLoader loader;
    if (!loader.load(pairs_path)) {
        std::cerr << "Failed to load correlation pairs from " << pairs_path << std::endl;
        return 1;
    }
    std::cout << "Loaded " << loader.pairs().size() << " correlation pairs from "
              << pairs_path << std::endl;

    // Configure Kalshi API
    router::KalshiApiConfig api_config{};
    std::strncpy(api_config.base_url, "https://trading-api.kalshi.com", sizeof(api_config.base_url) - 1);
    api_config.base_url[sizeof(api_config.base_url) - 1] = '\0';
    api_config.demo_mode = true;
    api_config.connect_timeout_us = 5000000;   // 5s
    api_config.request_timeout_us = 500000;    // 500ms
    api_config.keep_alive = true;

    const char* api_key = std::getenv("KALSHI_API_KEY");
    if (api_key) {
        std::strncpy(api_config.api_key, api_key, sizeof(api_config.api_key) - 1);
        api_config.api_key[sizeof(api_config.api_key) - 1] = '\0';
    }

    // Initialize and start engine
    engine::ExecutionEngine engine;
    if (!engine.initialize(pairs_path, api_config, ws_url)) {
        std::cerr << "Engine initialization failed" << std::endl;
        return 1;
    }

    std::cout << "Starting engine..." << std::endl;
    engine.start();

    // Run until interrupted
    while (engine.is_running()) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    std::cout << "Engine stopped." << std::endl;
    return 0;
}

// ============================================================================
// Stub Definitions (required for compilation)
// ============================================================================

namespace queue {
MarketDataRingBuffer::MarketDataRingBuffer() : head_(0), tail_(0) {}
bool MarketDataRingBuffer::push(const MarketUpdate& update) noexcept { (void)update; return true; }
bool MarketDataRingBuffer::pop(MarketUpdate& update) noexcept { (void)update; return false; }
bool MarketDataRingBuffer::empty() const noexcept { return head_.load(std::memory_order_acquire) == tail_.load(std::memory_order_acquire); }
size_t MarketDataRingBuffer::size_approx() const noexcept { return 0; }
} // namespace queue

namespace cache {
OrderBookCache::OrderBookCache() = default;
OrderBookCache::~OrderBookCache() = default;
void OrderBookCache::update(const MarketUpdate& update) { (void)update; }
bool OrderBookCache::get_price(const char* ticker, MarketPrice& out) const { (void)ticker; (void)out; return false; }
bool OrderBookCache::all_valid(const std::vector<std::string>& tickers) const { (void)tickers; return false; }
size_t OrderBookCache::market_count() const { return 0; }
void OrderBookCache::invalidate_stale(data::TimestampUs now_us, uint64_t max_age_us) { (void)now_us; (void)max_age_us; }
} // namespace cache

namespace strategy {
SpreadCalculator::SpreadCalculator(const std::vector<CorrelationPair>& pairs) : pairs_(pairs) {}
double SpreadCalculator::calculate_fair_spread(const CorrelationPair& pair, data::Price price_a, data::Price price_b) const noexcept { (void)pair; (void)price_a; (void)price_b; return 0.0; }
double SpreadCalculator::calculate_current_spread(const CorrelationPair& pair, data::Price price_a, data::Price price_b) const noexcept { (void)pair; (void)price_a; (void)price_b; return 0.0; }
double SpreadCalculator::deviation_sigma(const CorrelationPair& pair, double current_spread) const noexcept { (void)pair; (void)current_spread; return 0.0; }
std::vector<ArbitrageSignal> SpreadCalculator::calculate(const std::vector<MarketPrice>& prices, TimestampUs now_us) const { (void)prices; (void)now_us; return {}; }
SignalGenerator::SignalGenerator() = default;
std::vector<ArbitrageSignal> SignalGenerator::generate(const std::vector<ArbitrageSignal>& raw_signals, TimestampUs now_us) { (void)raw_signals; (void)now_us; return {}; }
bool SignalGenerator::is_cooldown(const char* market_a, const char* market_b, TimestampUs now_us) const { (void)market_a; (void)market_b; (void)now_us; return false; }
void SignalGenerator::reset_cooldowns() {}
} // namespace strategy

namespace risk {
RiskManager::RiskManager() : circuit_breaker_active_(false), circuit_breaker_triggered_at_(0) {}
RiskCheckResult RiskManager::pre_trade_check(const ArbitrageSignal& signal, const std::vector<OpenPosition>& positions, const RiskSummary& summary, TimestampUs now_us) const { (void)signal; (void)positions; (void)summary; (void)now_us; return RiskCheckResult{true, {}, 0.0}; }
bool RiskManager::check_price_freshness(const char* ticker_a, const char* ticker_b, TimestampUs price_time_a, TimestampUs price_time_b, TimestampUs now_us) const { (void)ticker_a; (void)ticker_b; (void)price_time_a; (void)price_time_b; (void)now_us; return true; }
bool RiskManager::check_correlation_freshness(TimestampUs generated_at, TimestampUs now_us) const { (void)generated_at; (void)now_us; return true; }
bool RiskManager::is_circuit_breaker_active(const RiskSummary& summary) const { (void)summary; return false; }
RiskCheckResult RiskManager::in_flight_check(const PairedOrder& order, data::Price current_price_a, data::Price current_price_b) const { (void)order; (void)current_price_a; (void)current_price_b; return RiskCheckResult{true, {}, 0.0}; }
bool RiskManager::check_position_size(uint32_t contracts) const noexcept { (void)contracts; return true; }
bool RiskManager::check_daily_loss_limit(int64_t additional_risk_cents, const RiskSummary& summary) const noexcept { (void)additional_risk_cents; (void)summary; return true; }
bool RiskManager::check_exposure_limit(uint64_t additional_exposure_cents, const RiskSummary& summary) const noexcept { (void)additional_exposure_cents; (void)summary; return true; }
void RiskManager::record_trade_outcome(bool is_win, int64_t pnl_cents, RiskSummary& summary, TimestampUs now_us) { (void)is_win; (void)pnl_cents; (void)summary; (void)now_us; }
bool RiskManager::update_circuit_breaker(bool is_loss, TimestampUs now_us) { (void)is_loss; (void)now_us; return false; }
void RiskManager::reset_circuit_breaker() {}
} // namespace risk

namespace router {
OrderRouter::OrderRouter(const KalshiApiConfig& config) : config_(config), curl_handle_(nullptr), initialized_(false) {}
OrderRouter::~OrderRouter() = default;
bool OrderRouter::initialize() { initialized_ = true; return true; }
OrderResult OrderRouter::submit(const OrderLeg& leg) { (void)leg; return OrderResult{true, {}, {}, 0, 0, 0}; }
OrderResult OrderRouter::submit_with_retry(const OrderLeg& leg, uint8_t max_retries) { (void)leg; (void)max_retries; return OrderResult{true, {}, {}, 0, 0, 0}; }
std::pair<OrderResult, OrderResult> OrderRouter::submit_paired(const PairedOrder& order) { (void)order; return {{true, {}, {}, 0, 0, 0}, {true, {}, {}, 0, 0, 0}}; }
bool OrderRouter::cancel_order(const char* order_id) { (void)order_id; return true; }
bool OrderRouter::is_healthy() const { return initialized_; }
std::string OrderRouter::serialize_order(const OrderLeg& leg) const { (void)leg; return "{}"; }
} // namespace router

namespace position {
PositionTracker::PositionTracker() : total_realized_pnl_cents_(0) {}
void PositionTracker::open_position(const PairedOrder& order, const OrderResult& result_a, const OrderResult& result_b) { (void)order; (void)result_a; (void)result_b; }
void PositionTracker::record_partial_fill(const PairedOrder& order, const OrderResult& result_a, const OrderResult& result_b) { (void)order; (void)result_a; (void)result_b; }
std::vector<OpenPosition> PositionTracker::update_prices(const std::vector<MarketPrice>& prices, TimestampUs now_us) { (void)prices; (void)now_us; return {}; }
bool PositionTracker::has_converged(const OpenPosition& position, data::Price current_price_a, data::Price current_price_b) const { (void)position; (void)current_price_a; (void)current_price_b; return false; }
bool PositionTracker::is_expired(const OpenPosition& position, TimestampUs now_us) const noexcept { (void)position; (void)now_us; return false; }
void PositionTracker::close_position(const char* position_id, data::Price exit_price_a, data::Price exit_price_b, int64_t realized_pnl_cents, TimestampUs now_us) { (void)position_id; (void)exit_price_a; (void)exit_price_b; (void)realized_pnl_cents; (void)now_us; }
std::vector<OpenPosition> PositionTracker::get_open_positions() const { return {}; }
int64_t PositionTracker::total_unrealized_pnl() const { return 0; }
int64_t PositionTracker::calculate_pnl(const OpenPosition& position, data::Price current_price_a, data::Price current_price_b) const { (void)position; (void)current_price_a; (void)current_price_b; return 0; }
} // namespace position

namespace feed {
MarketFeedHandler::MarketFeedHandler(queue::MarketDataRingBuffer& ring_buffer)
    : ring_buffer_(ring_buffer), state_(FeedState::DISCONNECTED), last_message_time_(0), ws_client_(nullptr), should_stop_(false) {}
MarketFeedHandler::~MarketFeedHandler() = default;
bool MarketFeedHandler::connect(const char* ws_url, const char* api_key) { (void)ws_url; (void)api_key; state_ = FeedState::CONNECTED; return true; }
void MarketFeedHandler::disconnect() { state_ = FeedState::DISCONNECTED; should_stop_ = true; }
void MarketFeedHandler::run() { while (state_ == FeedState::CONNECTED && !should_stop_) { std::this_thread::sleep_for(std::chrono::milliseconds(10)); } }
void MarketFeedHandler::send_heartbeat() {}
FeedState MarketFeedHandler::state() const noexcept { return state_.load(std::memory_order_acquire); }
TimestampUs MarketFeedHandler::last_message_time() const noexcept { return last_message_time_.load(std::memory_order_acquire); }
std::optional<MarketUpdate> MarketFeedHandler::parse_frame(const char* json, size_t len) const { (void)json; (void)len; return std::nullopt; }
void MarketFeedHandler::heartbeat_loop() {}
void MarketFeedHandler::reconnect(const char* ws_url, const char* api_key) { (void)ws_url; (void)api_key; }
} // namespace feed

namespace engine {
ExecutionEngine::ExecutionEngine() : running_(false), correlation_loaded_at_(0) {}
ExecutionEngine::~ExecutionEngine() = default;
bool ExecutionEngine::initialize(const char* correlation_pairs_path, const router::KalshiApiConfig& api_config, const char* ws_url) {
    (void)correlation_pairs_path; (void)api_config; (void)ws_url;
    ring_buffer_ = std::make_unique<queue::MarketDataRingBuffer>();
    order_book_cache_ = std::make_unique<cache::OrderBookCache>();
    spread_calculator_ = std::make_unique<strategy::SpreadCalculator>(correlation_pairs_);
    signal_generator_ = std::make_unique<strategy::SignalGenerator>();
    risk_manager_ = std::make_unique<risk::RiskManager>();
    order_router_ = std::make_unique<router::OrderRouter>(api_config);
    position_tracker_ = std::make_unique<position::PositionTracker>();
    feed_handler_ = std::make_unique<feed::MarketFeedHandler>(*ring_buffer_);
    return true;
}
void ExecutionEngine::start() { running_ = true; }
void ExecutionEngine::stop() { running_ = false; }
bool ExecutionEngine::is_running() const noexcept { return running_.load(std::memory_order_acquire); }
RiskSummary ExecutionEngine::get_risk_summary() const { return {}; }
std::vector<ArbitrageSignal> ExecutionEngine::get_latest_signals() const { return {}; }
void ExecutionEngine::strategy_loop() {}
void ExecutionEngine::position_monitor_loop() {}
void ExecutionEngine::health_monitor_loop() {}
} // namespace engine

namespace io {
CorrelationPairsLoader::CorrelationPairsLoader() : loaded_at_(0) {}
bool CorrelationPairsLoader::load(const char* path) { (void)path; return true; }
const std::vector<CorrelationPair>& CorrelationPairsLoader::pairs() const noexcept { return pairs_; }
data::TimestampUs CorrelationPairsLoader::loaded_at() const noexcept { return loaded_at_; }
} // namespace io

namespace testing {
MockKalshiServer::MockKalshiServer() : server_handle_(nullptr), request_count_(0) {}
MockKalshiServer::~MockKalshiServer() = default;
bool MockKalshiServer::start(uint16_t port) { (void)port; return true; }
void MockKalshiServer::stop() {}
size_t MockKalshiServer::request_count() const { return request_count_.load(std::memory_order_acquire); }
void MockKalshiServer::reset() { request_count_ = 0; }
SyntheticFeedGenerator::SyntheticFeedGenerator() = default;
std::vector<data::MarketUpdate> SyntheticFeedGenerator::generate_sequence(const char* ticker, size_t count, data::Price base_price, data::Price volatility) {
    (void)ticker; (void)count; (void)base_price; (void)volatility; return {};
}
LatencyBenchmark::LatencyBenchmark() = default;
void LatencyBenchmark::start_round() {}
void LatencyBenchmark::end_round() {}
void LatencyBenchmark::report() const {}
} // namespace testing
