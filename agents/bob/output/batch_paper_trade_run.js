#!/usr/bin/env node
/**
 * Batch Paper Trade Run — T325
 * Generates 50+ paper trades with mean_reversion only
 * Author: Bob (Backend Engineer)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TARGET_TRADES = 50;
const OUTPUT_DIR = path.join(__dirname);
const REPORT_FILE = path.join(OUTPUT_DIR, "t325_50trade_report.md");

// Run live_runner and count trades generated
function runBatch() {
  console.log(`=== Batch Paper Trade Run (Target: ${TARGET_TRADES} trades) ===\n`);
  
  let totalTrades = 0;
  let runs = 0;
  const runResults = [];
  
  // Reset the paper trades DB
  const dbPath = path.join(__dirname, "paper_trades.db");
  fs.writeFileSync(dbPath, "[]");
  console.log("Reset paper_trades.db");
  
  // Run until we have 50+ trades
  while (totalTrades < TARGET_TRADES) {
    runs++;
    
    // Use a different random seed for each run via environment variable
    const env = { ...process.env, RUN_SEED: runs.toString() };
    
    try {
      const output = execSync(
        "node backend/strategies/live_runner.js --execute",
        { 
          cwd: path.join(__dirname, ".."),
          env,
          encoding: "utf8",
          timeout: 30000
        }
      );
      
      // Parse signals generated
      const signalMatch = output.match(/Wrote (\d+) signals/);
      const signalsGenerated = signalMatch ? parseInt(signalMatch[1]) : 0;
      
      // Parse settlement results
      const settledMatch = output.match(/Settled (\d+) trades/);
      const settledTrades = settledMatch ? parseInt(settledMatch[1]) : 0;
      
      totalTrades += signalsGenerated;
      
      runResults.push({
        run: runs,
        signals: signalsGenerated,
        settled: settledTrades,
        cumulative: totalTrades
      });
      
      console.log(`Run ${runs}: +${signalsGenerated} signals (${totalTrades}/${TARGET_TRADES} total)`);
      
    } catch (err) {
      console.error(`Run ${runs} failed:`, err.message);
      break;
    }
  }
  
  // Read final trade data
  const trades = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  
  // Calculate statistics
  const stats = {
    total: trades.length,
    wins: trades.filter(t => t.outcome === "WIN").length,
    losses: trades.filter(t => t.outcome === "LOSS").length,
    pending: trades.filter(t => t.outcome === "PENDING").length,
    byMarket: {}
  };
  
  // Calculate P&L
  let totalPnL = 0;
  trades.forEach(t => {
    if (t.pnl) totalPnL += t.pnl;
    
    const market = t.market;
    if (!stats.byMarket[market]) {
      stats.byMarket[market] = { count: 0, wins: 0, losses: 0, pnl: 0 };
    }
    stats.byMarket[market].count++;
    if (t.outcome === "WIN") stats.byMarket[market].wins++;
    if (t.outcome === "LOSS") stats.byMarket[market].losses++;
    if (t.pnl) stats.byMarket[market].pnl += t.pnl;
  });
  
  stats.winRate = stats.total > 0 
    ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
    : 0;
  stats.totalPnL = (totalPnL / 100).toFixed(2);
  
  // Generate report
  const report = `# T325 — Clean 50-Trade Paper Session Report

**Date:** ${new Date().toISOString()}
**Strategy:** mean_reversion ONLY (momentum, crypto_edge, nfp_nowcast, econ_edge HARD DISABLED)
**Configuration:**
- minConfidence: 0.80
- zScoreThreshold: 1.0
- maxRiskPerTrade: 2%

## Summary

| Metric | Value |
|--------|-------|
| Total Runs | ${runs} |
| Total Trades | ${stats.total} |
| Wins | ${stats.wins} |
| Losses | ${stats.losses} |
| Pending | ${stats.pending} |
| **Win Rate** | **${stats.winRate}%** |
| **Total P&L** | **$${stats.totalPnL}** |

## Per-Market Breakdown

| Market | Trades | Wins | Losses | Win Rate | P&L |
|--------|--------|------|--------|----------|-----|
${Object.entries(stats.byMarket).map(([m, s]) => {
  const wr = s.count > 0 ? ((s.wins / (s.wins + s.losses)) * 100).toFixed(1) : 0;
  return `| ${m} | ${s.count} | ${s.wins} | ${s.losses} | ${wr}% | $${(s.pnl / 100).toFixed(2)} |`;
}).join('\n')}

## Run Details

| Run | Signals | Settled | Cumulative |
|-----|---------|---------|------------|
${runResults.map(r => `| ${r.run} | ${r.signals} | ${r.settled} | ${r.cumulative} |`).join('\n')}

## Trade Log (First 10)

| Time | Market | Direction | Contracts | Entry | Outcome | P&L |
|------|--------|-----------|-----------|-------|---------|-----|
${trades.slice(0, 10).map(t => `| ${t.timestamp.split('T')[1].slice(0,8)} | ${t.market} | ${t.direction} | ${t.contracts} | ${t.entry_price}c | ${t.outcome} | $${((t.pnl || 0) / 100).toFixed(2)} |`).join('\n')}

## Notes

- All trades generated with deterministic mock data (ticker-seeded PRNG)
- Settlement occurs when trades age 3+ runs
- Only mean_reversion strategy enabled per T325 requirements
- momentum, crypto_edge, nfp_nowcast, econ_edge HARD DISABLED at config level

## Files

- Trade data: \`output/paper_trades.db\`
- Latest signals: \`output/trade_signals.json\`
- This report: \`output/t325_50trade_report.md\`
`;

  fs.writeFileSync(REPORT_FILE, report);
  console.log(`\n=== Report Generated ===`);
  console.log(`Total trades: ${stats.total}`);
  console.log(`Win rate: ${stats.winRate}%`);
  console.log(`Total P&L: $${stats.totalPnL}`);
  console.log(`Report: ${REPORT_FILE}`);
  
  return stats;
}

// Run the batch
const stats = runBatch();
process.exit(0);
