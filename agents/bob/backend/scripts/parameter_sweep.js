#!/usr/bin/env node
/**
 * Parameter Sweep Tool for Mean Reversion Strategy
 * Self-directed analysis tool (Tina)
 * Tests multiple (lookback, zScore) combinations against deterministic mock data.
 * Ranks by signal quality metrics (edge, confidence, count) rather than simulated PnL.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_FILE = path.join(__dirname, "../../output/parameter_sweep_report.md");

const FALLBACK_MARKETS = [
  { id: "m1", ticker: "INXW-25-DEC31", title: "S&P 500 to close above 5000", category: "Economics", status: "active", yes_bid: 85, yes_ask: 87, no_bid: 13, no_ask: 15, volume: 250000, open_interest: 12000 },
  { id: "m2", ticker: "BTCW-26-JUN30-80K", title: "Will Bitcoin exceed $80,000 by June 30, 2026?", category: "Crypto", status: "active", yes_bid: 82, yes_ask: 86, no_bid: 14, no_ask: 18, volume: 720000, open_interest: 8000 },
  { id: "m3", ticker: "UNEMP-25-MAR", title: "Unemployment below 4%", category: "Economics", status: "active", yes_bid: 55, yes_ask: 57, no_bid: 43, no_ask: 45, volume: 90000, open_interest: 5000 },
  { id: "m4", ticker: "BTCW-26-JUN30-100K", title: "Will Bitcoin exceed $100,000 by June 30, 2026?", category: "Crypto", status: "active", yes_bid: 62, yes_ask: 66, no_bid: 34, no_ask: 38, volume: 890000, open_interest: 12000 },
  { id: "m5", ticker: "ETHW-26-DEC31-5K", title: "Will Ethereum exceed $5,000 by December 31, 2026?", category: "Crypto", status: "active", yes_bid: 28, yes_ask: 32, no_bid: 68, no_ask: 72, volume: 540000, open_interest: 6000 },
  { id: "m6", ticker: "KXNF-20260501-T100000", title: "NFP above 100k", category: "Financial", status: "active", yes_bid: 65, yes_ask: 67, no_bid: 33, no_ask: 35, volume: 150000, open_interest: 50000 },
  { id: "m7", ticker: "KXNF-20260501-T150000", title: "NFP above 150k", category: "Financial", status: "active", yes_bid: 50, yes_ask: 52, no_bid: 48, no_ask: 50, volume: 200000, open_interest: 75000 },
  { id: "m8", ticker: "KXNF-20260501-T200000", title: "NFP above 200k", category: "Financial", status: "active", yes_bid: 26, yes_ask: 28, no_bid: 72, no_ask: 74, volume: 180000, open_interest: 60000 },
];

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

function fetchCandles(ticker, candleDays) {
  const basePrice = ticker === "BTCW-25-DEC31" ? 16 : ticker === "UNEMP-25-MAR" ? 56 : 86;
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seededRandom = (n) => {
    const x = Math.sin(seed + n) * 10000;
    return x - Math.floor(x);
  };
  return Array.from({ length: candleDays }, (_, i) => ({
    candle_time: new Date(Date.now() - (candleDays - 1 - i) * 86400000).toISOString(),
    yes_close: basePrice + Math.floor(seededRandom(i) * 10 - 5),
    yes_volume: 10000 + Math.floor(seededRandom(i + 1000) * 5000),
  }));
}

function computeHistoryMetrics(candles) {
  if (!candles || candles.length < 2) return { mean: 50, stddev: 10, priceChange: 0 };
  const prices = candles.map((c) => c.yes_close || c.close || 50);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stddev = Math.sqrt(variance);
  const priceChange = prices[prices.length - 1] - prices[0];
  return { mean, stddev, priceChange };
}

function runCombo(candleDays, zScoreThreshold, minVolume) {
  const { SignalEngine } = require("../strategies/signal_engine");
  const { PositionSizer } = require("../strategies/position_sizer");
  const { MeanReversionStrategy } = require("../strategies/strategies/mean_reversion");

  const markets = FALLBACK_MARKETS.map(normalizeMarket);
  const enrichedMarkets = markets.map((market) => {
    const candles = fetchCandles(market.ticker, candleDays);
    const metrics = computeHistoryMetrics(candles);
    return { ...market, price_history_mean: metrics.mean, price_history_stddev: metrics.stddev, price_change_24h: metrics.priceChange, candles };
  });

  const engine = new SignalEngine({ minConfidence: 0.80, minEdge: 1 });
  const sizer = new PositionSizer({ accountBalance: 100000, maxRiskPerTrade: 0.02 });
  const strategy = new MeanReversionStrategy({ zScoreThreshold, minVolume });

  const signals = engine.scan(enrichedMarkets, strategy);
  const marketMap = Object.fromEntries(enrichedMarkets.flatMap((m) => [[m.id, m], [m.ticker, m]]));
  const sized = sizer.sizeSignals(signals, marketMap);
  const allSignals = sized.map((s) => ({ ...s, strategy: "mean_reversion", ticker: marketMap[s.marketId]?.ticker }));

  const avgConfidence = allSignals.length > 0
    ? allSignals.reduce((sum, s) => sum + (s.confidence || 0), 0) / allSignals.length
    : 0;
  const avgEdge = allSignals.length > 0
    ? allSignals.reduce((sum, s) => sum + (s.expectedEdge || 0), 0) / allSignals.length
    : 0;
  const avgZScore = allSignals.length > 0
    ? allSignals.reduce((sum, s) => {
        const match = s.reason && s.reason.match(/z-score=(-?\d+\.?\d*)/);
        return sum + (match ? parseFloat(match[1]) : 0);
      }, 0) / allSignals.length
    : 0;

  // Quality score: more signals with high confidence and edge = better opportunity set
  // But we penalize excessive signal count to avoid overtrading
  const signalPenalty = allSignals.length > 5 ? (allSignals.length - 5) * 5 : 0;
  const qualityScore = allSignals.length * (avgConfidence * 100) * Math.max(avgEdge, 1) - signalPenalty;

  return {
    candleDays,
    zScoreThreshold,
    minVolume,
    signalCount: allSignals.length,
    avgConfidence,
    avgEdge,
    avgZScore: Math.abs(avgZScore),
    qualityScore,
  };
}

async function main() {
  console.log("=== Parameter Sweep for Mean Reversion ===\n");

  const combos = [];
  for (const cd of [5, 7, 10, 14, 20, 30]) {
    for (const z of [0.8, 1.0, 1.5, 2.0, 2.5, 3.0]) {
      for (const mv of [1000, 10000, 50000]) {
        combos.push([cd, z, mv]);
      }
    }
  }

  console.log(`Testing ${combos.length} combinations...\n`);

  const results = [];
  for (const [cd, z, mv] of combos) {
    try {
      const r = runCombo(cd, z, mv);
      results.push(r);
      process.stdout.write(".");
    } catch (e) {
      process.stdout.write("x");
    }
  }
  console.log("\n");

  // Sort by quality score
  results.sort((a, b) => b.qualityScore - a.qualityScore);

  const top10 = results.slice(0, 10);

  const report = [];
  report.push("# Parameter Sweep Report — Mean Reversion Strategy");
  report.push(`**Generated:** ${new Date().toISOString()}\n`);
  report.push(`Combinations tested: ${combos.length}`);
  report.push(`Markets: 8 fallback markets (deterministic mock data)\n`);

  report.push("## Top 10 Parameter Combinations (by Quality Score)");
  report.push("| Rank | Lookback | zScore | minVolume | Signals | Avg Conf | Avg Edge | Avg |Z| | Quality Score |");
  report.push("|------|----------|--------|-----------|---------|----------|----------|--------|---------------|");
  top10.forEach((r, i) => {
    report.push(`| ${i + 1} | ${r.candleDays} | ${r.zScoreThreshold} | ${r.minVolume} | ${r.signalCount} | ${(r.avgConfidence * 100).toFixed(1)}% | ${r.avgEdge.toFixed(1)} | ${r.avgZScore.toFixed(2)} | ${r.qualityScore.toFixed(0)} |`);
  });
  report.push("");

  const best = top10[0];
  report.push("## Recommendation");
  if (best) {
    report.push(`Best combo by quality score: **lookback=${best.candleDays}, zScore=${best.zScoreThreshold}, minVolume=${best.minVolume}**`);
    report.push(`- Generates ${best.signalCount} signals per run`);
    report.push(`- Average confidence: ${(best.avgConfidence * 100).toFixed(1)}%`);
    report.push(`- Average expected edge: ${best.avgEdge.toFixed(1)}¢`);
    report.push("");
    report.push("> ⚠️ These metrics are derived from deterministic mock data. Quality score is a heuristic combining signal count, confidence, and edge. Validate with paper trades before going live.");
  }
  report.push("");

  report.push("## Current Production Settings");
  report.push("- lookback: 7 days");
  report.push("- zScoreThreshold: 1.0");
  report.push("- minVolume: 1000");
  report.push("");

  const current = results.find(r => r.candleDays === 7 && r.zScoreThreshold === 1.0 && r.minVolume === 1000);
  if (current) {
    report.push(`Current settings rank: **#${results.indexOf(current) + 1}** out of ${results.length}`);
    report.push(`- Signal count: ${current.signalCount}`);
    report.push(`- Avg confidence: ${(current.avgConfidence * 100).toFixed(1)}%`);
    report.push(`- Avg edge: ${current.avgEdge.toFixed(1)}¢`);
    report.push(`- Quality score: ${current.qualityScore.toFixed(0)}`);
  }
  report.push("");

  const reportText = report.join("\n");
  fs.writeFileSync(REPORT_FILE, reportText);
  console.log(reportText);
  console.log(`\nReport written to: ${REPORT_FILE}`);
}

main().catch((e) => {
  console.error("Parameter sweep failed:", e);
  process.exit(1);
});
