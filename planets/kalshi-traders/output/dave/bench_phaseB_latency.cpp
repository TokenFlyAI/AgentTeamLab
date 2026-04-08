/**
 * Sprint 11: C++ Engine Benchmarking — Task T1094
 * Author: Dave
 * Date: 2026-04-07
 *
 * Compile: g++ -std=c++20 -pthread -O3 -o bench_phaseB bench_phaseB_latency.cpp
 * Run: ./bench_phaseB
 */

#define NO_MAIN
#include "../../output/shared/codebase/backend/cpp_engine/engine.cpp"

#include <chrono>
#include <iostream>
#include <fstream>
#include <vector>
#include <algorithm>
#include <iomanip>

static data::MarketPrice make_price(const char* ticker, data::Price bid, data::Price ask) {
    data::MarketPrice p{};
    p.timestamp_us = now_us();
    std::strncpy(p.ticker, ticker, sizeof(p.ticker) - 1);
    p.yes_bid = bid;
    p.yes_ask = ask;
    p.no_bid = 100 - ask;
    p.no_ask = 100 - bid;
    p.last_price = (bid + ask) / 2;
    p.volume = 10000;
    p.valid = true;
    return p;
}

static std::vector<data::CorrelationPair> make_test_pairs() {
    std::vector<data::CorrelationPair> pairs;
    data::CorrelationPair p{};
    std::strncpy(p.cluster, "test_cluster", sizeof(p.cluster) - 1);
    std::strncpy(p.market_a, "MKTA", sizeof(p.market_a) - 1);
    std::strncpy(p.market_b, "MKTB", sizeof(p.market_b) - 1);
    p.pearson_correlation = 0.95;
    p.expected_spread = 5.0;
    p.spread_threshold = 2.0;
    p.arbitrage_confidence = 0.9;
    p.direction = 0;
    p.is_arbitrage_opportunity = true;
    pairs.push_back(p);
    return pairs;
}

int main() {
    const int ITERATIONS = 100000;
    auto pairs = make_test_pairs();
    strategy::SpreadCalculator calc(pairs);
    std::vector<data::MarketPrice> prices;
    prices.push_back(make_price("MKTA", 5500, 5550));
    prices.push_back(make_price("MKTB", 4800, 4850));

    std::vector<double> latencies_us;
    latencies_us.reserve(ITERATIONS);

    for (int i = 0; i < ITERATIONS; ++i) {
        auto start = std::chrono::high_resolution_clock::now();
        calc.calculate(prices, now_us());
        auto end = std::chrono::high_resolution_clock::now();
        double us = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count() / 1000.0;
        latencies_us.push_back(us);
    }

    std::sort(latencies_us.begin(), latencies_us.end());
    double sum = 0.0;
    for (double v : latencies_us) sum += v;
    double avg = sum / ITERATIONS;
    double p50 = latencies_us[static_cast<size_t>(ITERATIONS * 0.50)];
    double p99 = latencies_us[static_cast<size_t>(ITERATIONS * 0.99)];
    double min_us = latencies_us.front();
    double max_us = latencies_us.back();

    bool target_met = avg < 1000.0; // target is < 1ms (1000 us)

    std::ofstream file("benchmark_t1094.json");
    file << std::fixed << std::setprecision(3);
    file << "{\n";
    file << "  \"task\": \"1094\",\n";
    file << "  \"agent\": \"dave\",\n";
    file << "  \"timestamp\": \"" << system_now_us() << "\",\n";
    file << "  \"engine\": \"Phase B C++ Execution Engine\",\n";
    file << "  \"date\": \"2026-04-07\",\n";
    file << "  \"iterations\": " << ITERATIONS << ",\n";
    file << "  \"latency_us\": {\n";
    file << "    \"avg\": " << avg << ",\n";
    file << "    \"p50\": " << p50 << ",\n";
    file << "    \"p99\": " << p99 << ",\n";
    file << "    \"min\": " << min_us << ",\n";
    file << "    \"max\": " << max_us << "\n";
    file << "  },\n";
    file << "  \"target_avg_ms\": 1.0,\n";
    file << "  \"target_met\": " << (target_met ? "true" : "false") << ",\n";
    file << "  \"culture_citation\": \"C20: Includes agent and timestamp metadata.\"\n";
    file << "}\n";
    file.close();

    std::cout << "=== Phase B C++ Engine Benchmarking (Task 1094) ===" << std::endl;
    std::cout << "Iterations: " << ITERATIONS << std::endl;
    std::cout << "Avg latency: " << avg << " µs" << std::endl;
    std::cout << "p50 latency: " << p50 << " µs" << std::endl;
    std::cout << "p99 latency: " << p99 << " µs" << std::endl;
    std::cout << "Target <1ms avg: " << (target_met ? "PASS" : "FAIL") << std::endl;
    std::cout << "Output: benchmark_t1094.json" << std::endl;

    return 0;
}
