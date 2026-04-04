#!/usr/bin/env node
/**
 * Synthetic Paper Trade Runner
 * Uses realistic synthetic market data to test the full pipeline
 * without requiring Kalshi API credentials.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { generateCandles } = require("./synthetic_market_generator");
const { SignalEngine } = require("../strategies/signal_engine");
const { PositionSizer } = require("../strategies/position_sizer");
const { MeanReversionStrategy } = require("../strategies/strategies/mean_reversion");
const { RiskManager, getRiskSummary, validateTrade } = require("../strategies/risk_manager");

const OUTPUT_DIR = path.join(__dirname, "../../output");
const TRADE_SIGNALS = path.join(OUTPUT_DIR, "trade_signals.json");
const PAPER_TRADE_LOG = path.join(OUTPUT_DIR, "paper_trade_log.json");

const TEST_MARKETS = [
  { id: "m1", ticker: "INXW-25-DEC31", title: "S&P 500 to close above 5000", category: "Economics", volume: 250000 },
  { id: "m2", ticker: "BTCW-26-JUN30-80K", title: "BTC > 80K", category: "Crypto", volume: 720000 },
  { id: "m3", ticker: "UNEMP-25-MAR", title: "Unemployment below 4%", category: "Economics", volume: 90000 },
  { id: "m4", ticker: "BTCW-26-JUN30-100K", title: "BTC > 100K", category: "Crypto", volume: 890000 },
  { id: "m5", ticker: "ETHW-26-DEC31-5K", title: "ETH > 5K", category: "Crypto", volume: 540000 },
  { id: "m6", ticker: "KXNF-20260501-T100000", title: "NFP above 100k", category: "Financial", volume: 150000 },
  { id: "m7", ticker: "KXNF-20260501-T150000", title: "NFP above 150k", category: "Financial", volume: 200000 },
  { id: "m8", ticker: "KXNF-20260501-T200000", title: "NFP above 200k", category: "Financial", volume: 180000 },
];

const CANDLE_DAYS = 10;  // T334 optimized: lookback=10

function computeHistoryMetrics(candles) {
  if (!candles || candles.length < 2) return { mean: 50, stddev: 10, priceChange: 0 };
  const prices = candles.map((c) => c.yes_close || c.close || 50);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stddev = Math.sqrt(variance);
  const priceChange = prices[prices.length - 1] - prices[0];
  return { mean, stddev, priceChange };
}

async function main() {
  console.log("=== Synthetic Paper Trade Runner ===\n");

  // 1. Generate synthetic markets with realistic price histories
  const enrichedMarkets = [];
  for (const market of TEST_MARKETS) {
    const candles = generateCandles(market.ticker, CANDLE_DAYS);
    const metrics = computeHistoryMetrics(candles);
    const currentPrice = candles[candles.length - 1].yes_close;
    const yesMid = currentPrice;
    const noMid = 100 - currentPrice;

    enrichedMarkets.push({
      ...market,
      status: "active",
      yes_bid: yesMid - 1,
      yes_ask: yesMid + 1,
      no_bid: noMid - 1,
      no_ask: noMid + 1,
      yes_mid: yesMid,
      no_mid: noMid,
      volume24h: market.volume,
      open_interest: 5000,
      price_history_mean: metrics.mean,
      price_history_stddev: metrics.stddev,
      price_change_24h: metrics.priceChange,
      candles,
    });

    console.log(`  ${market.ticker}: current=${yesMid}, mean=${metrics.mean.toFixed(1)}, stddev=${metrics.stddev.toFixed(1)}, z=${((yesMid - metrics.mean) / metrics.stddev).toFixed(2)}`);
  }

  // 2. Run strategies
  const engine = new SignalEngine({ minConfidence: 0.65, minEdge: 1 });  // T334 optimized: confidence=0.65
  const sizer = new PositionSizer({ accountBalance: 100000, maxRiskPerTrade: 0.02 });
  const meanReversion = new MeanReversionStrategy({ zScoreThreshold: 1.2, minVolume: 10000 });  // T334 optimized: zScore=1.2

  const signals = engine.scan(enrichedMarkets, meanReversion);
  const marketMap = Object.fromEntries(enrichedMarkets.flatMap((m) => [[m.id, m], [m.ticker, m]]));
  const sized = sizer.sizeSignals(signals, marketMap);
  const allSignals = sized.map((s) => ({ ...s, strategy: "mean_reversion", ticker: marketMap[s.marketId]?.ticker }));

  console.log(`\nGenerated ${allSignals.length} signals`);

  // 3. Risk check
  let approvedSignals = allSignals;
  let rejectedSignals = [];
  console.log("\n🔒 Risk checks skipped in synthetic test mode (DB unavailable)");
  console.log(`  ✅ Approved ${approvedSignals.length} signals`);

  // 4. Paper trade log
  const executionReport = {
    mode: "paper_trading_synthetic",
    executed: approvedSignals.length,
    rejected: rejectedSignals.length,
    failed: 0,
    trades: approvedSignals.map((s) => ({
      ticker: s.ticker || s.marketId,
      side: s.side,
      contracts: s.sizing?.contracts || 1,
      price: s.currentPrice,
      strategy: s.strategy,
      confidence: s.confidence,
      expectedEdge: s.expectedEdge,
      timestamp: new Date().toISOString(),
    })),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(PAPER_TRADE_LOG, JSON.stringify(executionReport, null, 2));

  // 5. Trade signals output
  const report = {
    generatedAt: new Date().toISOString(),
    source: "synthetic_test",
    marketCount: enrichedMarkets.length,
    signalCount: allSignals.length,
    executed: true,
    executionReport,
    markets: enrichedMarkets.map((m) => ({
      id: m.id,
      ticker: m.ticker,
      title: m.title,
      category: m.category,
      yesMid: m.yes_mid,
      noMid: m.no_mid,
      volume: m.volume,
      priceHistoryMean: m.price_history_mean,
      priceHistoryStddev: m.price_history_stddev,
      priceChange24h: m.price_change_24h,
    })),
    signals: allSignals.map((s) => ({
      strategy: s.strategy,
      marketId: s.marketId,
      ticker: marketMap[s.marketId]?.ticker,
      side: s.side,
      signalType: s.signalType,
      confidence: parseFloat(s.confidence.toFixed(4)),
      targetPrice: s.targetPrice,
      currentPrice: s.currentPrice,
      expectedEdge: s.expectedEdge,
      recommendedContracts: s.sizing.contracts,
      riskAmount: s.sizing.riskAmount,
      reason: s.reason,
    })),
  };
  fs.writeFileSync(TRADE_SIGNALS, JSON.stringify(report, null, 2));

  console.log(`\n✅ Wrote ${allSignals.length} signals to ${TRADE_SIGNALS}`);
  console.log(`📝 Logged ${executionReport.executed} paper trades to ${PAPER_TRADE_LOG}`);

  for (const s of allSignals) {
    console.log(`  [${s.strategy}] ${s.side.toUpperCase()} ${s.ticker} @ ${s.currentPrice}c — size=${s.sizing.contracts} contracts (conf=${(s.confidence * 100).toFixed(1)}%)`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
