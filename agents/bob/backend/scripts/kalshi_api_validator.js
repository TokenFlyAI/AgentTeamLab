#!/usr/bin/env node
/**
 * Kalshi API Credential Validator + Real-Data Smoke Test
 * Task 331
 * Validates KALSHI_API_KEY and runs one full pipeline cycle with real Kalshi data.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BACKEND_DIR = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(BACKEND_DIR, "..", "output");

const results = {
  passed: 0,
  failed: 0,
  checks: [],
};

function log(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

function recordCheck(name, status, message) {
  results.checks.push({ name, status, message });
  if (status === "PASS") results.passed++;
  else if (status === "FAIL") results.failed++;
  log(status, `${name}: ${message}`);
}

async function main() {
  console.log("=== Kalshi API Validator & Real-Data Smoke Test ===\n");

  // 1. Environment check
  const apiKey = process.env.KALSHI_API_KEY;
  if (!apiKey) {
    recordCheck("Env: KALSHI_API_KEY", "FAIL", "Missing — cannot proceed without API credentials (T236 blocker)");
    printSummary();
    process.exit(1);
  }
  recordCheck("Env: KALSHI_API_KEY", "PASS", `Set (${apiKey.length} chars)`);

  // 2. Load KalshiClient
  let client;
  try {
    const { KalshiClient } = require(path.join(BACKEND_DIR, "kalshi_client"));
    client = new KalshiClient({ apiKey, demo: process.env.KALSHI_DEMO !== "false" });
    recordCheck("Module: KalshiClient", "PASS", "Instantiated successfully");
  } catch (e) {
    recordCheck("Module: KalshiClient", "FAIL", e.message);
    printSummary();
    process.exit(1);
  }

  // 3. Fetch markets
  let markets;
  try {
    const res = await client.getMarkets({ status: "active", limit: 20 });
    markets = res.markets || res.data?.markets || [];
    if (markets.length === 0) {
      recordCheck("API: Fetch Markets", "FAIL", "No active markets returned");
      printSummary();
      process.exit(1);
    }
    recordCheck("API: Fetch Markets", "PASS", `Retrieved ${markets.length} active markets`);
  } catch (e) {
    recordCheck("API: Fetch Markets", "FAIL", e.message);
    printSummary();
    process.exit(1);
  }

  // 4. Fetch candles for top market by volume
  const topMarket = markets.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
  try {
    const to = Date.now();
    const from = to - 7 * 86400000;
    const res = await client.getCandles(topMarket.ticker, { resolution: "1d", from, to });
    const candles = res.candles || res.data?.candles || [];
    recordCheck("API: Fetch Candles", "PASS", `${candles.length} candles for ${topMarket.ticker}`);
  } catch (e) {
    recordCheck("API: Fetch Candles", "FAIL", `${topMarket.ticker}: ${e.message}`);
    printSummary();
    process.exit(1);
  }

  // 5. Run signal pipeline on real data
  try {
    const { SignalEngine } = require(path.join(BACKEND_DIR, "strategies", "signal_engine"));
    const { PositionSizer } = require(path.join(BACKEND_DIR, "strategies", "position_sizer"));
    const { MeanReversionStrategy } = require(path.join(BACKEND_DIR, "strategies", "strategies", "mean_reversion"));

    function computeMidPrice(bid, ask) {
      if (bid != null && ask != null) return Math.round((bid + ask) / 2);
      if (bid != null) return bid;
      if (ask != null) return ask;
      return 50;
    }

    function normalizeMarket(m) {
      const yesMid = computeMidPrice(m.yes_bid, m.yes_ask);
      const noMid = computeMidPrice(m.no_bid, m.no_ask);
      return {
        id: m.id || m.ticker,
        ticker: m.ticker,
        title: m.title,
        category: m.category || "Unknown",
        status: m.status || "active",
        yes_bid: m.yes_bid,
        yes_ask: m.yes_ask,
        no_bid: m.no_bid,
        no_ask: m.no_ask,
        yes_mid: yesMid,
        no_mid: noMid,
        volume: m.volume || 0,
        volume24h: m.volume || 0,
        open_interest: m.open_interest || 0,
      };
    }

    function computeHistoryMetrics(candles) {
      if (!candles || candles.length < 2) return { mean: 50, stddev: 10, priceChange: 0 };
      const prices = candles.map((c) => c.yes_close || c.close || 50);
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
      return { mean, stddev: Math.sqrt(variance), priceChange: prices[prices.length - 1] - prices[0] };
    }

    const normalized = markets.slice(0, 5).map(normalizeMarket);
    const enrichedMarkets = [];
    for (const market of normalized) {
      const to = Date.now();
      const from = to - 7 * 86400000;
      const candleRes = await client.getCandles(market.ticker, { resolution: "1d", from, to });
      const candles = candleRes.candles || candleRes.data?.candles || [];
      const metrics = computeHistoryMetrics(candles);
      enrichedMarkets.push({
        ...market,
        price_history_mean: metrics.mean,
        price_history_stddev: metrics.stddev,
        price_change_24h: metrics.priceChange,
        candles,
      });
    }

    const engine = new SignalEngine({ minConfidence: 0.65, minEdge: 1 });  // T334 optimized: confidence=0.65
    const sizer = new PositionSizer({ accountBalance: 100000, maxRiskPerTrade: 0.02 });
    const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.2, minVolume: 10000 });  // T334 optimized: zScore=1.2

    const signals = engine.scan(enrichedMarkets, strategy);
    const marketMap = Object.fromEntries(enrichedMarkets.flatMap((m) => [[m.id, m], [m.ticker, m]]));
    const sized = sizer.sizeSignals(signals, marketMap);

    recordCheck("Pipeline: Signal Generation", "PASS", `${sized.length} signal(s) generated from real data`);

    if (sized.length > 0) {
      for (const s of sized) {
        console.log(`  → ${s.side.toUpperCase()} ${marketMap[s.marketId]?.ticker} @ ${s.currentPrice}c | conf=${(s.confidence * 100).toFixed(1)}% | z=${((s.currentPrice - marketMap[s.marketId]?.price_history_mean) / marketMap[s.marketId]?.price_history_stddev).toFixed(2)}`);
      }
    } else {
      console.log("  → No signals generated — markets may not be mispriced (this is valid output)");
    }

    // Write validation report
    const report = {
      validatedAt: new Date().toISOString(),
      apiKeyPresent: true,
      demoMode: process.env.KALSHI_DEMO !== "false",
      marketsFetched: markets.length,
      topMarket: topMarket.ticker,
      signalsGenerated: sized.length,
      marketDetails: enrichedMarkets.map((m) => ({
        ticker: m.ticker,
        yesMid: m.yes_mid,
        mean: m.price_history_mean,
        stddev: m.price_history_stddev,
        candleCount: m.candles?.length || 0,
      })),
      signals: sized.map((s) => ({
        ticker: marketMap[s.marketId]?.ticker,
        side: s.side,
        confidence: s.confidence,
        currentPrice: s.currentPrice,
        contracts: s.sizing?.contracts,
        reason: s.reason,
      })),
    };
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "kalshi_api_validation.json"), JSON.stringify(report, null, 2));
  } catch (e) {
    recordCheck("Pipeline: Signal Generation", "FAIL", e.message);
    printSummary();
    process.exit(1);
  }

  printSummary();
  process.exit(0);
}

function printSummary() {
  console.log("\n" + "=".repeat(50));
  console.log("KALSHI API VALIDATION SUMMARY");
  console.log("=".repeat(50));
  console.log(`Passed: ${results.passed} ✓`);
  console.log(`Failed: ${results.failed} ✗`);
  console.log("=".repeat(50));

  if (results.failed > 0) {
    console.log("\n❌ Validation FAILED — live trading blocked.");
    results.checks.filter((c) => c.status === "FAIL").forEach((c) => console.log(`  - ${c.name}: ${c.message}`));
  } else {
    console.log("\n✅ Validation PASSED — real Kalshi data flows through the pipeline.");
  }
}

main().catch((e) => {
  log("ERROR", `Validator crashed: ${e.message}`);
  console.error(e);
  process.exit(1);
});
