#!/usr/bin/env node
/**
 * Batch Paper Trading — Task 327
 * Runs multiple paper trading iterations to validate win rate convergence
 * Author: Bob (Backend Engineer)
 */

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TARGET_TRADES = 50;
const RUNS_NEEDED = 20; // ~3 signals per run = 60 trades
const LIVE_RUNNER = path.join(__dirname, "../strategies/live_runner.js");
const PAPER_DB = path.join(__dirname, "../../output/paper_trades.db");

// Clear existing paper trades for clean test
function resetPaperTrades() {
  try {
    if (fs.existsSync(PAPER_DB)) {
      fs.unlinkSync(PAPER_DB);
      console.log("[BatchPaperTrade] Cleared existing paper_trades.db");
    }
  } catch (e) {
    console.error("[BatchPaperTrade] Warning: could not clear DB:", e.message);
  }
}

// Run live_runner once with paper trading
function runPaperTrade() {
  try {
    const output = execSync(
      `node ${LIVE_RUNNER} --execute`,
      {
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, PAPER_TRADING: "true" }
      }
    );
    
    // Parse signal count from output
    const signalMatch = output.match(/Wrote (\d+) signals/);
    const signals = signalMatch ? parseInt(signalMatch[1]) : 0;
    
    return { success: true, signals, output };
  } catch (e) {
    return { success: false, error: e.message, output: e.stdout || "" };
  }
}

// Get current paper trade stats
function getStats() {
  try {
    const db = JSON.parse(fs.readFileSync(PAPER_DB, "utf8"));
    return {
      totalTrades: db.length,
      openTrades: db.filter(t => t.status === "OPEN").length,
      closedTrades: db.filter(t => t.status === "CLOSED").length,
      byStrategy: db.reduce((acc, t) => {
        const strat = t.signal_type || "unknown";
        acc[strat] = (acc[strat] || 0) + 1;
        return acc;
      }, {})
    };
  } catch (e) {
    return { totalTrades: 0, openTrades: 0, closedTrades: 0, byStrategy: {} };
  }
}

// Main batch runner
async function main() {
  console.log("=== Batch Paper Trading Validation (Task 327) ===\n");
  console.log(`Target: ${TARGET_TRADES}+ trades`);
  console.log(`Runs planned: ${RUNS_NEEDED}\n`);
  
  resetPaperTrades();
  
  const results = [];
  for (let i = 1; i <= RUNS_NEEDED; i++) {
    process.stdout.write(`Run ${i}/${RUNS_NEEDED}... `);
    const result = runPaperTrade();
    
    if (result.success) {
      results.push(result);
      const stats = getStats();
      console.log(`✓ ${result.signals} signals | Total trades: ${stats.totalTrades}`);
      
      if (stats.totalTrades >= TARGET_TRADES) {
        console.log(`\n🎯 Target reached! ${stats.totalTrades} trades generated.`);
        break;
      }
    } else {
      console.log(`✗ Error: ${result.error}`);
    }
    
    // Small delay between runs
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Final stats
  const finalStats = getStats();
  console.log("\n=== Results ===");
  console.log(`Total runs: ${results.length}`);
  console.log(`Total trades: ${finalStats.totalTrades}`);
  console.log(`Open trades: ${finalStats.openTrades}`);
  console.log(`By strategy:`, finalStats.byStrategy);
  
  // Write summary
  const summary = {
    timestamp: new Date().toISOString(),
    targetTrades: TARGET_TRADES,
    actualTrades: finalStats.totalTrades,
    runsExecuted: results.length,
    stats: finalStats,
    note: "Trades are OPEN status. P&L requires market settlement data."
  };
  
  const summaryPath = path.join(__dirname, "../../output/batch_paper_trade_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nSummary written to: ${summaryPath}`);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
