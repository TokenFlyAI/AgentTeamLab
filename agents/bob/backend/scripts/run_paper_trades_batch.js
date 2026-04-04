#!/usr/bin/env node
/**
 * Paper Trade Batch Runner — Task 327
 * Runs multiple paper trades to validate win rate convergence
 * Author: Bob (Backend Engineer)
 */

"use strict";

const { execSync } = require("child_process");
const { getPaperTradesDB } = require("../paper_trades_db");

const TARGET_TRADES = 50;
const BATCH_SIZE = 5; // Run 5 at a time to avoid overwhelming

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBatch(count) {
  console.log(`\n🔄 Running batch of ${count} paper trade executions...`);
  
  for (let i = 0; i < count; i++) {
    try {
      execSync("node backend/strategies/live_runner.js --execute", {
        stdio: "pipe",
        timeout: 30000,
        env: { ...process.env, PAPER_TRADING: "true" }
      });
      process.stdout.write(".");
    } catch (e) {
      process.stdout.write("X");
    }
    await sleep(100); // Small delay between runs
  }
  console.log(" Done!");
}

async function main() {
  console.log("=== Paper Trade Validation — Sprint 5 (T327) ===\n");
  console.log(`Target: ${TARGET_TRADES} paper trades`);
  console.log(`Backtest baseline: 55.9% win rate\n`);
  
  const db = getPaperTradesDB();
  const initialSummary = db.getSummary();
  console.log(`Initial state: ${initialSummary.total_trades} trades, ${(initialSummary.win_rate * 100).toFixed(1)}% win rate`);
  
  // Calculate how many more trades needed
  const tradesNeeded = Math.max(0, TARGET_TRADES - initialSummary.total_trades);
  
  if (tradesNeeded === 0) {
    console.log("\n✅ Already have 50+ trades. Skipping batch run.");
  } else {
    console.log(`\n📊 Need ${tradesNeeded} more trades...`);
    
    // Run in batches
    const batches = Math.ceil(tradesNeeded / BATCH_SIZE);
    for (let b = 0; b < batches; b++) {
      const remaining = tradesNeeded - (b * BATCH_SIZE);
      const batchCount = Math.min(BATCH_SIZE, remaining);
      await runBatch(batchCount);
      
      // Show progress
      const progress = db.getSummary();
      console.log(`  Progress: ${progress.total_trades} trades, ${(progress.win_rate * 100).toFixed(1)}% win rate`);
    }
  }
  
  // Final summary
  console.log("\n" + "=".repeat(50));
  console.log("📈 FINAL RESULTS");
  console.log("=".repeat(50));
  
  const final = db.getSummary();
  const winRatePct = (final.win_rate * 100).toFixed(1);
  const gap = (55.9 - winRatePct).toFixed(1);
  
  console.log(`Total trades:    ${final.total_trades}`);
  console.log(`Closed trades:   ${final.closed_trades}`);
  console.log(`Open trades:     ${final.open_trades}`);
  console.log(`Wins:            ${final.win_count}`);
  console.log(`Losses:          ${final.loss_count}`);
  console.log(`Win rate:        ${winRatePct}%`);
  console.log(`Backtest target: 55.9%`);
  console.log(`Gap:             ${gap > 0 ? '+' : ''}${gap}pp`);
  console.log(`Total P&L:       $${final.total_pnl_dollars.toFixed(2)}`);
  console.log(`Last updated:    ${final.last_updated || 'N/A'}`);
  
  // Strategy breakdown
  console.log("\n📊 By Strategy:");
  for (const [strat, data] of Object.entries(final.by_strategy)) {
    const stratWinRate = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(1) : '0.0';
    console.log(`  ${strat}: ${data.trades} trades, ${stratWinRate}% win rate, $${(data.pnl / 100).toFixed(2)} P&L`);
  }
  
  // Convergence assessment
  console.log("\n" + "=".repeat(50));
  if (final.closed_trades >= 30) {
    const winRateNum = parseFloat(winRatePct);
    if (winRateNum >= 50 && winRateNum <= 65) {
      console.log("✅ WIN RATE CONVERGED toward backtest baseline (50-65%)");
    } else if (winRateNum < 40) {
      console.log("⚠️  WIN RATE BELOW EXPECTED — further investigation needed");
    } else {
      console.log("ℹ️  WIN RATE IN RANGE — continue monitoring");
    }
  } else {
    console.log("⏳ Need more closed trades for reliable win rate measurement");
  }
  
  console.log("\n✅ Paper trade validation complete!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
