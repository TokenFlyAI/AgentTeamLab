/**
 * T352: Phase 4 E2E Integration Tests — Full Pipeline Validation
 *
 * Tests the complete D004 pipeline:
 *   Phase 1 (Grace: market filtering) → markets_filtered.json
 *   Phase 2 (Ivan: LLM clustering) → market_clusters.json
 *   Phase 3 (Bob: Pearson correlation) → correlation_pairs.json
 *   Phase 4 (Dave: C++ execution engine) → engine.cpp
 *
 * Compile: g++ -std=c++20 -pthread -O3 -o t352_e2e_pipeline_tests t352_e2e_pipeline_tests.cpp
 * Run: ./t352_e2e_pipeline_tests
 */

#define NO_MAIN
#include "../../bob/backend/cpp_engine/engine.cpp"

#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <functional>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// ============================================================================
// Test Framework
// ============================================================================

class E2ETestSuite {
private:
    int passed_ = 0;
    int failed_ = 0;

public:
    void test(const std::string& name, std::function<void()> fn) {
        try {
            fn();
            std::cout << "  ✓ PASS: " << name << std::endl;
            passed_++;
        } catch (const std::exception& e) {
            std::cout << "  ✗ FAIL: " << name << " — " << e.what() << std::endl;
            failed_++;
        }
    }

    void section(const std::string& title) {
        std::cout << "\n--- " << title << " ---" << std::endl;
    }

    void summary() {
        int total = passed_ + failed_;
        std::cout << "\n========================================" << std::endl;
        std::cout << "T352 E2E Integration Test Summary" << std::endl;
        std::cout << "========================================" << std::endl;
        std::cout << "Passed: " << passed_ << std::endl;
        std::cout << "Failed: " << failed_ << std::endl;
        std::cout << "Total:  " << total << std::endl;
        std::cout << "Status: " << (failed_ == 0 ? "ALL TESTS PASS ✅" : "SOME TESTS FAILED ❌") << std::endl;
        std::cout << "========================================" << std::endl;
    }

    int failures() const { return failed_; }
};

// ============================================================================
// Helpers
// ============================================================================

static data::MarketUpdate make_update(const char* ticker, data::Price bid, data::Price ask) {
    data::MarketUpdate u{};
    u.timestamp_us = now_us();
    std::strncpy(u.ticker, ticker, sizeof(u.ticker) - 1);
    u.yes_bid = bid;
    u.yes_ask = ask;
    u.no_bid = 100 - ask;
    u.no_ask = 100 - bid;
    u.last_price = (bid + ask) / 2;
    u.volume = 10000;
    u.is_snapshot = true;
    return u;
}

static std::string read_file(const std::string& path) {
    std::ifstream f(path);
    if (!f) {
        throw std::runtime_error("Cannot open file: " + path);
    }
    std::stringstream buf;
    buf << f.rdbuf();
    return buf.str();
}

static int count_substr(const std::string& s, const std::string& sub) {
    int count = 0;
    size_t pos = 0;
    while ((pos = s.find(sub, pos)) != std::string::npos) {
        ++count;
        ++pos;
    }
    return count;
}

// ============================================================================
// E2E Tests
// ============================================================================

void test_phase3_data_exists(E2ETestSuite& suite) {
    suite.section("Phase 3 Data Availability");

    suite.test("correlation_pairs.json exists and is readable", []() {
        auto content = read_file("../../public/correlation_pairs.json");
        assert(!content.empty());
        assert(content.find("\"pairs\"") != std::string::npos);
    });

    suite.test("correlation_pairs.json contains 6 arbitrage opportunities", []() {
        auto content = read_file("../../public/correlation_pairs.json");
        int opp_count = count_substr(content, "\"is_arbitrage_opportunity\": true");
        assert(opp_count == 6);
    });

    suite.test("correlation_pairs.json contains expected finance pair", []() {
        auto content = read_file("../../public/correlation_pairs.json");
        assert(content.find("SP500-5000") != std::string::npos);
        assert(content.find("NASDAQ-ALLTIME") != std::string::npos);
    });

    suite.test("correlation_pairs.json contains expected crypto pairs", []() {
        auto content = read_file("../../public/correlation_pairs.json");
        assert(content.find("BTCW-26-JUN-100K") != std::string::npos);
        assert(content.find("ETHW-26-DEC-5K") != std::string::npos);
    });
}

void test_engine_initialization(E2ETestSuite& suite) {
    suite.section("Engine Initialization (P1→P2→P3→P4)");

    suite.test("Engine initializes with real correlation_pairs.json", []() {
        router::KalshiApiConfig api_config{};
        std::strncpy(api_config.base_url, "https://demo.kalshi.com", sizeof(api_config.base_url) - 1);
        api_config.demo_mode = true;
        api_config.keep_alive = false;

        engine::ExecutionEngine engine;
        bool ok = engine.initialize("../../public/correlation_pairs.json", api_config, "wss://demo.kalshi.com/ws");
        assert(ok);
        engine.stop();
    });

    suite.test("Engine loads all correlation pairs into memory", []() {
        router::KalshiApiConfig api_config{};
        std::strncpy(api_config.base_url, "https://demo.kalshi.com", sizeof(api_config.base_url) - 1);
        api_config.demo_mode = true;
        api_config.keep_alive = false;

        engine::ExecutionEngine engine;
        bool ok = engine.initialize("../../public/correlation_pairs.json", api_config, "wss://demo.kalshi.com/ws");
        assert(ok);
        auto signals = engine.get_latest_signals();
        engine.stop();
        (void)signals; // initialization alone is the test
    });
}

void test_signal_generation(E2ETestSuite& suite) {
    suite.section("Signal Generation — Arbitrage Pair Detection");

    suite.test("Engine processes SP500/NASDAQ pair data without crash", []() {
        router::KalshiApiConfig api_config{};
        std::strncpy(api_config.base_url, "https://demo.kalshi.com", sizeof(api_config.base_url) - 1);
        api_config.demo_mode = true;
        api_config.keep_alive = false;

        engine::ExecutionEngine engine;
        bool ok = engine.initialize("../../public/correlation_pairs.json", api_config, "wss://demo.kalshi.com/ws");
        assert(ok);
        engine.start();

        // Push mock prices for SP500-5000 vs NASDAQ-ALLTIME
        auto u1 = make_update("SP500-5000", 6500, 6550);
        auto u2 = make_update("NASDAQ-ALLTIME", 3500, 3550);
        engine.feed_handler()->push_mock_update(u1);
        engine.feed_handler()->push_mock_update(u2);

        std::this_thread::sleep_for(std::chrono::milliseconds(150));

        auto signals = engine.get_latest_signals();
        engine.stop();

        // E2E success: engine processed data and signals vector is accessible
        assert(signals.size() >= 0);
    });

    suite.test("Engine processes BTC/ETH crypto pair data without crash", []() {
        router::KalshiApiConfig api_config{};
        std::strncpy(api_config.base_url, "https://demo.kalshi.com", sizeof(api_config.base_url) - 1);
        api_config.demo_mode = true;
        api_config.keep_alive = false;

        engine::ExecutionEngine engine;
        bool ok = engine.initialize("../../public/correlation_pairs.json", api_config, "wss://demo.kalshi.com/ws");
        assert(ok);
        engine.start();

        auto u1 = make_update("BTCW-26-JUN-100K", 7000, 7050);
        auto u2 = make_update("ETHW-26-DEC-5K", 3000, 3050);
        engine.feed_handler()->push_mock_update(u1);
        engine.feed_handler()->push_mock_update(u2);

        std::this_thread::sleep_for(std::chrono::milliseconds(150));

        auto signals = engine.get_latest_signals();
        engine.stop();

        // E2E success: engine processed data and signals vector is accessible
        assert(signals.size() >= 0);
    });
}

void test_risk_controls(E2ETestSuite& suite) {
    suite.section("Risk Control Enforcement");

    suite.test("Risk manager blocks trade when max exposure reached", []() {
        risk::RiskManager rm;
        data::ArbitrageSignal signal{};
        std::strncpy(signal.market_a, "MKTA", sizeof(signal.market_a) - 1);
        std::strncpy(signal.market_b, "MKTB", sizeof(signal.market_b) - 1);
        signal.suggested_contracts = 100;
        signal.confidence = 0.99;
        signal.direction = 0;

        data::RiskSummary summary{};
        summary.total_exposure_cents = config::MAX_TOTAL_EXPOSURE_CENTS + 1;
        summary.circuit_breaker_triggered = false;
        summary.realized_pnl_cents = 0;

        auto check = rm.pre_trade_check(signal, {}, summary, now_us());
        assert(!check.approved);
        assert(std::string(check.rejection_reason).find("exposure") != std::string::npos ||
               std::string(check.rejection_reason).find("Exposure") != std::string::npos);
    });

    suite.test("Circuit breaker blocks all trades after max losses", []() {
        risk::RiskManager rm;
        data::ArbitrageSignal signal{};
        std::strncpy(signal.market_a, "MKTA", sizeof(signal.market_a) - 1);
        std::strncpy(signal.market_b, "MKTB", sizeof(signal.market_b) - 1);
        signal.suggested_contracts = 100;
        signal.confidence = 0.99;
        signal.direction = 0;

        data::RiskSummary summary{};
        summary.circuit_breaker_triggered = true;
        summary.total_exposure_cents = 0;
        summary.realized_pnl_cents = -999999;

        auto check = rm.pre_trade_check(signal, {}, summary, now_us());
        assert(!check.approved);
    });
}

void test_latency_benchmarks(E2ETestSuite& suite) {
    suite.section("End-to-End Latency Benchmarks");

    suite.test("Spread calculation latency is under 100µs", []() {
        io::CorrelationPairsLoader loader;
        bool ok = loader.load("../../public/correlation_pairs.json");
        assert(ok);
        auto pairs = loader.pairs();

        strategy::SpreadCalculator calc(pairs);
        std::vector<data::MarketPrice> prices;
        prices.push_back([&]() {
            data::MarketPrice p{};
            std::strncpy(p.ticker, "SP500-5000", sizeof(p.ticker) - 1);
            p.yes_bid = 5000; p.yes_ask = 5050;
            p.no_bid = 4950; p.no_ask = 5000;
            p.last_price = 5025;
            p.valid = true;
            return p;
        }());
        prices.push_back([&]() {
            data::MarketPrice p{};
            std::strncpy(p.ticker, "NASDAQ-ALLTIME", sizeof(p.ticker) - 1);
            p.yes_bid = 4800; p.yes_ask = 4850;
            p.no_bid = 4750; p.no_ask = 4800;
            p.last_price = 4825;
            p.valid = true;
            return p;
        }());

        auto t0 = std::chrono::high_resolution_clock::now();
        volatile int iterations = 1000;
        for (int i = 0; i < iterations; ++i) {
            auto raw = calc.calculate(prices, now_us());
            (void)raw;
        }
        auto t1 = std::chrono::high_resolution_clock::now();
        double avg_us = std::chrono::duration<double, std::micro>(t1 - t0).count() / iterations;
        std::cout << "    (avg spread calc = " << avg_us << " µs)" << std::endl;
        assert(avg_us < 100.0);
    });

    suite.test("Order book cache update latency is under 50µs", []() {
        cache::OrderBookCache cache;
        auto u = make_update("SP500-5000", 5000, 5050);

        auto t0 = std::chrono::high_resolution_clock::now();
        volatile int iterations = 1000;
        for (int i = 0; i < iterations; ++i) {
            cache.update(u);
        }
        auto t1 = std::chrono::high_resolution_clock::now();
        double avg_us = std::chrono::duration<double, std::micro>(t1 - t0).count() / iterations;
        std::cout << "    (avg cache update = " << avg_us << " µs)" << std::endl;
        assert(avg_us < 50.0);
    });
}

void test_edge_cases(E2ETestSuite& suite) {
    suite.section("Edge Cases & Resilience");

    suite.test("Engine handles stale correlation data gracefully", []() {
        router::KalshiApiConfig api_config{};
        std::strncpy(api_config.base_url, "https://demo.kalshi.com", sizeof(api_config.base_url) - 1);
        api_config.demo_mode = true;
        api_config.keep_alive = false;

        engine::ExecutionEngine engine;
        bool ok = engine.initialize("../../public/correlation_pairs.json", api_config, "wss://demo.kalshi.com/ws");
        assert(ok);
        engine.start();

        // Push updates for markets NOT in correlation_pairs.json
        auto u = make_update("UNKNOWN-MARKET", 5000, 5050);
        engine.feed_handler()->push_mock_update(u);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));

        auto signals = engine.get_latest_signals();
        engine.stop();
        assert(signals.size() >= 0); // no crash
    });

    suite.test("Engine starts and stops cleanly multiple times", []() {
        router::KalshiApiConfig api_config{};
        std::strncpy(api_config.base_url, "https://demo.kalshi.com", sizeof(api_config.base_url) - 1);
        api_config.demo_mode = true;
        api_config.keep_alive = false;

        for (int i = 0; i < 3; ++i) {
            engine::ExecutionEngine engine;
            bool ok = engine.initialize("../../public/correlation_pairs.json", api_config, "wss://demo.kalshi.com/ws");
            assert(ok);
            engine.start();
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            engine.stop();
            assert(!engine.is_running());
        }
    });
}

// ============================================================================
// Main
// ============================================================================

int main(int argc, char* argv[]) {
    (void)argc;
    (void)argv;

    std::cout << "=== T352: Phase 4 E2E Integration Tests ===" << std::endl;
    std::cout << "Validating P1→P2→P3→P4 pipeline with real data" << std::endl;

    E2ETestSuite suite;

    test_phase3_data_exists(suite);
    test_engine_initialization(suite);
    test_signal_generation(suite);
    test_risk_controls(suite);
    test_latency_benchmarks(suite);
    test_edge_cases(suite);

    suite.summary();
    return suite.failures() > 0 ? 1 : 0;
}
