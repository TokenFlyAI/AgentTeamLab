#!/usr/bin/env node
/**
 * Live vs Backtest Divergence Analysis
 * Self-directed analysis to explain the 21pp win-rate gap.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const BACKTEST_PATH = path.join(__dirname, "../../bob/output/backtest_summary.json");
const REPORT_PATH = path.join(__dirname, "divergence_analysis.md");
const API_BASE = "http://localhost:3200";

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${API_BASE}${urlPath}`, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${urlPath}: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

function binTrades(trades, field, bins) {
  const buckets = bins.map((b) => ({ ...b, trades: [], wins: 0, losses: 0, pnl: 0 }));
  for (const t of trades) {
    const val = t[field];
    for (const b of buckets) {
      if (val >= b.min && val < b.max) {
        b.trades.push(t);
        if (t.outcome === "WIN") b.wins++;
        else if (t.outcome === "LOSS") b.losses++;
        b.pnl += t.pnl || 0;
        break;
      }
    }
  }
  return buckets.map((b) => ({
    label: b.label,
    count: b.trades.length,
    winRate: b.trades.length > 0 ? b.wins / b.trades.length : 0,
    avgPnl: b.trades.length > 0 ? b.pnl / b.trades.length : 0,
    totalPnl: b.pnl,
  }));
}

function twoProportionZ(n1, p1, n2, p2) {
  // Z-test for difference in proportions
  if (n1 === 0 || n2 === 0) return 0;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

async function main() {
  console.log("Fetching live paper trades...");
  const liveData = await fetchJson("/api/paper-trades");
  const liveTrades = (liveData.trades || []).filter((t) => t.status === "CLOSED");

  console.log("Reading backtest data...");
  const backtest = JSON.parse(fs.readFileSync(BACKTEST_PATH, "utf8"));
  const btMr = backtest.strategies.mean_reversion;

  const liveWins = liveTrades.filter((t) => t.outcome === "WIN").length;
  const liveLosses = liveTrades.filter((t) => t.outcome === "LOSS").length;
  const liveWinRate = liveTrades.length > 0 ? liveWins / liveTrades.length : 0;
  const livePnl = liveTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const btWinRate = btMr.win_rate;
  const btTrades = btMr.total_trades;
  const btPnlPerTrade = btMr.avg_trade_pnl || btMr.total_pnl / btTrades;

  const zScore = twoProportionZ(liveTrades.length, liveWinRate, btTrades, btWinRate);

  // Binned analysis
  const confidenceBins = binTrades(liveTrades, "confidence", [
    { label: "0.80–0.89", min: 0.8, max: 0.89 },
    { label: "0.90–0.94", min: 0.9, max: 0.94 },
    { label: "0.95–1.00", min: 0.95, max: 1.01 },
  ]);

  const edgeBins = binTrades(
    liveTrades.map((t) => ({ ...t, expectedEdge: t.metadata?.expectedEdge || 0 })),
    "expectedEdge",
    [
      { label: "0–19", min: 0, max: 20 },
      { label: "20–39", min: 20, max: 40 },
      { label: "40–59", min: 40, max: 60 },
      { label: "60+", min: 60, max: 999 },
    ]
  );

  // Market breakdown
  const marketMap = {};
  for (const t of liveTrades) {
    const m = t.market;
    if (!marketMap[m]) marketMap[m] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
    marketMap[m].trades++;
    if (t.outcome === "WIN") marketMap[m].wins++;
    else if (t.outcome === "LOSS") marketMap[m].losses++;
    marketMap[m].pnl += t.pnl || 0;
  }
  const marketRows = Object.entries(marketMap)
    .map(([m, s]) => ({
      market: m,
      count: s.trades,
      winRate: s.trades > 0 ? s.wins / s.trades : 0,
      totalPnl: s.pnl,
    }))
    .sort((a, b) => b.count - a.count);

  // Streak analysis
  let maxLossStreak = 0;
  let currentLossStreak = 0;
  for (const t of liveTrades.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))) {
    if (t.outcome === "LOSS") {
      currentLossStreak++;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
  }

  const report = `# Live vs Backtest Divergence Analysis

**Generated:** ${new Date().toISOString()}
**Script:** \`output/analyze_divergence.js\`
**Run:** \`node output/analyze_divergence.js\`

## Executive Summary

| Metric | Live Paper Trades | Backtest (mean_reversion) | Gap |
|--------|-------------------|---------------------------|-----|
| Total Trades | ${liveTrades.length} | ${btTrades} | — |
| Win Rate | ${(liveWinRate * 100).toFixed(1)}% | ${(btWinRate * 100).toFixed(1)}% | ${((liveWinRate - btWinRate) * 100).toFixed(1)}pp |
| Total P&L | $${(livePnl / 100).toFixed(2)} | $${(btMr.total_pnl / 100).toFixed(2)} | — |
| Avg P&L/Trade | ${liveTrades.length > 0 ? (livePnl / liveTrades.length / 100).toFixed(2) : "0.00"}¢ | ${(btPnlPerTrade / 100).toFixed(2)}¢ | — |
| Statistical Z-Score | ${zScore.toFixed(2)} | — | — |

**Interpretation:** A Z-score of ${Math.abs(zScore).toFixed(2)} ${Math.abs(zScore) > 1.96 ? "suggests the gap is **statistically significant** (p < 0.05)." : "does **not** reach statistical significance at p < 0.05."}

## Live Trade Breakdown by Confidence

| Confidence Bucket | Trades | Win Rate | Avg P&L/Trade | Total P&L |
|-------------------|--------|----------|---------------|-----------|
${confidenceBins
  .map(
    (b) =>
      `| ${b.label} | ${b.count} | ${(b.winRate * 100).toFixed(1)}% | ${(b.avgPnl / 100).toFixed(2)}¢ | $${(b.totalPnl / 100).toFixed(2)} |`
  )
  .join("\n")}

## Live Trade Breakdown by Expected Edge

| Edge Bucket | Trades | Win Rate | Avg P&L/Trade | Total P&L |
|-------------|--------|----------|---------------|-----------|
${edgeBins
  .map(
    (b) =>
      `| ${b.label} | ${b.count} | ${(b.winRate * 100).toFixed(1)}% | ${(b.avgPnl / 100).toFixed(2)}¢ | $${(b.totalPnl / 100).toFixed(2)} |`
  )
  .join("\n")}

## Market-Level Breakdown

| Market | Trades | Win Rate | Total P&L |
|--------|--------|----------|-----------|
${marketRows
  .map(
    (m) =>
      `| ${m.market} | ${m.count} | ${(m.winRate * 100).toFixed(1)}% | $${(m.totalPnl / 100).toFixed(2)} |`
  )
  .join("\n")}

## Streak Analysis

- **Max consecutive losses:** ${maxLossStreak}

## Hypotheses for the Gap

1. **Sample Size:** ${liveTrades.length} live trades vs ${btTrades} backtest trades. The live sample may still be too small for the win rate to converge.
2. **Market Selection:** Live trades are concentrated in a small number of fallback/mock markets. Backtest spanned ${backtest.num_markets} markets over ${backtest.data_period_days} days.
3. **Hold Period / Settlement:** Backtest used a ${backtest.hold_days}-day hold. Live paper trades may settle on a different schedule, affecting P&L.
4. **Deterministic Data Limitation:** Even with seeded PRNG, fallback candle data is synthetic. It may not capture the mean-reverting properties of real historical data.

## Recommendations

1. **Do not go live** until the win-rate gap is within 5pp of backtest or a clear root cause is identified.
2. **Increase paper trade sample size** to at least 200 trades before drawing conclusions.
3. **Compare market-by-market** once real Kalshi API data is available (T236 blocker).
4. **Apply Ivan's param tuning** (lookback 20, z=2.0) in a controlled A/B paper test.
`;

  fs.writeFileSync(REPORT_PATH, report);
  console.log(`Report written to: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error("Analysis failed:", e.message);
  process.exit(1);
});
