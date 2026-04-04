#!/usr/bin/env node
/**
 * Live vs Backtest Divergence Analyzer
 * Self-directed analysis tool (Tina)
 * Compares paper trading performance against backtest baseline.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const BACKTEST_FILE = path.join(__dirname, "../../output/backtest_summary.json");
const REPORT_FILE = path.join(__dirname, "../../output/divergence_report.md");

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    }).on("error", reject).on("timeout", function () { this.destroy(); reject(new Error("timeout")); });
  });
}

function binomialPValue(n, k, p) {
  // Two-tailed approximate p-value for observing k or fewer wins in n trials with win prob p
  if (n === 0) return 1;
  const mean = n * p;
  const std = Math.sqrt(n * p * (1 - p));
  if (std === 0) return 1;
  const z = (k - mean) / std;
  // Simple approximation: 2 * Phi(-|z|)
  const absZ = Math.abs(z);
  // Abramowitz & Stegun approximation for Phi(-absZ)
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const t = 1 / (1 + 0.2316419 * absZ);
  const phi = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI);
  const tail = phi * (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
  return Math.min(1, 2 * tail);
}

async function main() {
  console.log("=== Live vs Backtest Divergence Analyzer ===\n");

  // 1. Fetch live data
  let live;
  try {
    live = await httpGet("http://localhost:3200/api/paper-trades/summary");
    if (!live.success) throw new Error("API returned success=false");
  } catch (e) {
    console.error("Failed to fetch live paper trades:", e.message);
    process.exit(1);
  }

  // 2. Load backtest data
  let backtest;
  try {
    backtest = JSON.parse(fs.readFileSync(BACKTEST_FILE, "utf8"));
  } catch (e) {
    console.error("Failed to load backtest_summary.json:", e.message);
    process.exit(1);
  }

  const strategy = "mean_reversion";
  const bt = backtest.strategies[strategy];
  const lt = live.by_strategy[strategy];

  if (!bt || !lt) {
    console.error("Missing data for strategy:", strategy);
    process.exit(1);
  }

  const btWinRate = bt.win_rate;
  const ltWinRate = lt.wins / lt.trades;
  const gap = btWinRate - ltWinRate;

  const pValue = binomialPValue(lt.trades, lt.wins, btWinRate);

  // 3. Backtest trade analysis
  const trades = bt.trades || [];
  const avgPnL = bt.avg_trade_pnl;
  const liveAvgPnL = lt.pnl / lt.trades;

  // Confidence buckets from backtest (simulate if not present)
  // Since backtest_summary doesn't have confidence, we'll look at entry_price distribution
  const priceBuckets = { "<50": 0, "50-70": 0, ">70": 0 };
  const priceWins = { "<50": 0, "50-70": 0, ">70": 0 };
  const marketCounts = {};
  const marketWins = {};

  for (const t of trades) {
    const p = t.entry_price;
    const bucket = p < 50 ? "<50" : p <= 70 ? "50-70" : ">70";
    priceBuckets[bucket]++;
    if (t.pnl > 0) priceWins[bucket]++;

    const m = t.market_id;
    marketCounts[m] = (marketCounts[m] || 0) + 1;
    if (t.pnl > 0) marketWins[m] = (marketWins[m] || 0) + 1;
  }

  // Worst markets in backtest
  const marketStats = Object.keys(marketCounts).map((m) => ({
    market: m,
    trades: marketCounts[m],
    winRate: (marketWins[m] || 0) / marketCounts[m],
  })).sort((a, b) => a.winRate - b.winRate);

  // 4. Build report
  const report = [];
  report.push("# Live vs Backtest Divergence Report");
  report.push(`**Generated:** ${new Date().toISOString()}\n`);

  report.push("## Summary");
  report.push(`| Metric | Backtest | Live Paper | Gap |`);
  report.push(`|--------|----------|------------|-----|`);
  report.push(`| Win Rate | ${(btWinRate * 100).toFixed(1)}% | ${(ltWinRate * 100).toFixed(1)}% | ${(gap * 100).toFixed(1)}pp |`);
  report.push(`| Total Trades | ${bt.total_trades} | ${lt.trades} | — |`);
  report.push(`| Total PnL (¢) | ${bt.total_pnl} | ${lt.pnl} | ${lt.pnl - bt.total_pnl} |`);
  report.push(`| Avg Trade PnL (¢) | ${avgPnL.toFixed(2)} | ${liveAvgPnL.toFixed(2)} | ${(liveAvgPnL - avgPnL).toFixed(2)} |`);
  report.push(`| Statistical Significance (p-value) | — | — | ${pValue < 0.001 ? "<0.001" : pValue.toFixed(3)} |`);
  report.push("");

  report.push("## Interpretation");
  if (pValue < 0.05) {
    report.push(`The live win rate of ${(ltWinRate * 100).toFixed(1)}% is **statistically significantly lower** than the backtest baseline of ${(btWinRate * 100).toFixed(1)}% (p=${pValue < 0.001 ? "<0.001" : pValue.toFixed(3)}).`);
  } else {
    report.push(`The observed gap of ${(gap * 100).toFixed(1)}pp is **not statistically significant** given ${lt.trades} live trades (p=${pValue.toFixed(3)}).`);
  }
  report.push("");

  report.push("## Backtest Win Rate by Entry Price Bucket");
  report.push(`| Bucket | Trades | Win Rate |`);
  report.push(`|--------|--------|----------|`);
  for (const b of ["<50", "50-70", ">70"]) {
    const c = priceBuckets[b] || 0;
    const wr = c > 0 ? ((priceWins[b] || 0) / c * 100).toFixed(1) + "%" : "N/A";
    report.push(`| ${b} | ${c} | ${wr} |`);
  }
  report.push("");

  report.push("## Worst Performing Markets (Backtest)");
  report.push(`| Market | Trades | Win Rate |`);
  report.push(`|--------|--------|----------|`);
  for (const m of marketStats.slice(0, 5)) {
    report.push(`| ${m.market} | ${m.trades} | ${(m.winRate * 100).toFixed(1)}% |`);
  }
  report.push("");

  report.push("## Recommendations");
  if (gap > 0.15) {
    report.push("1. **Do not go live** until the gap is under 10pp.");
    report.push("2. Investigate whether the live market selection differs from backtest markets.");
    report.push("3. Apply Ivan's param tuning (lookback 20, z=2.0) and re-run paper trades.");
    report.push("4. Increase minimum trade count to 100+ before drawing conclusions.");
  } else {
    report.push("1. Gap is within acceptable range — continue paper trading.");
    report.push("2. Monitor for convergence as trade count increases.");
  }
  report.push("");

  const reportText = report.join("\n");
  fs.writeFileSync(REPORT_FILE, reportText);

  console.log(reportText);
  console.log(`\nReport written to: ${REPORT_FILE}`);
}

main().catch((e) => {
  console.error("Analyzer failed:", e);
  process.exit(1);
});
