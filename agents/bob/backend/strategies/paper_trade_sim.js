#!/usr/bin/env node
/**
 * Paper Trading Simulation — Task 250
 * Run live_runner.js 3x, record signals, compute P&L per strategy
 * Author: Bob (Backend Engineer)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const LIVE_RUNNER = path.join(__dirname, "live_runner.js");
const OUTPUT_FILE = path.join(__dirname, "../../output/paper_trade_sim.json");

// Simulate P&L for a signal (simplified model)
function simulatePnL(signal) {
  // Base P&L on signal confidence and edge
  const confidence = signal.confidence || 0.5;
  const edge = signal.expectedEdge || 0;
  const contracts = signal.sizing?.contracts || 1;
  
  // Random outcome weighted by confidence
  const winProbability = confidence;
  const isWin = Math.random() < winProbability;
  
  // P&L per contract (cents) - simplified model
  const avgWin = 15; // 15 cents average win
  const avgLoss = -10; // 10 cents average loss
  
  const pnlPerContract = isWin ? avgWin : avgLoss;
  const totalPnL = pnlPerContract * contracts;
  
  return {
    pnl: totalPnL,
    pnlPerContract,
    contracts,
    isWin,
    winProbability,
  };
}

// Run live_runner.js once
function runSimulation(runNumber) {
  console.log(`\n=== Simulation Run ${runNumber}/3 ===`);
  
  try {
    // Run live_runner.js
    execSync(`node "${LIVE_RUNNER}"`, { 
      stdio: "pipe",
      timeout: 60000,
    });
    
    // Read the generated signals
    const signalsPath = path.join(__dirname, "../../output/trade_signals.json");
    const signalsData = JSON.parse(fs.readFileSync(signalsPath, "utf8"));
    
    // Simulate P&L for each signal
    const simulatedSignals = (signalsData.signals || []).map(signal => {
      const pnlResult = simulatePnL(signal);
      return {
        ...signal,
        simulatedPnL: pnlResult.pnl,
        simulatedPnLPerContract: pnlResult.pnlPerContract,
        simulatedContracts: pnlResult.contracts,
        simulatedWin: pnlResult.isWin,
        runNumber,
        timestamp: new Date().toISOString(),
      };
    });
    
    console.log(`  Generated ${simulatedSignals.length} signals`);
    
    return {
      runNumber,
      timestamp: new Date().toISOString(),
      signals: simulatedSignals,
      signalCount: simulatedSignals.length,
    };
  } catch (e) {
    console.error(`  Error in run ${runNumber}:`, e.message);
    return {
      runNumber,
      timestamp: new Date().toISOString(),
      signals: [],
      signalCount: 0,
      error: e.message,
    };
  }
}

// Compute P&L per strategy
function computeStrategyPnL(allRuns) {
  const strategyStats = {};
  
  for (const run of allRuns) {
    for (const signal of run.signals) {
      const strategy = signal.strategy || "unknown";
      
      if (!strategyStats[strategy]) {
        strategyStats[strategy] = {
          strategy,
          totalPnL: 0,
          totalTrades: 0,
          wins: 0,
          losses: 0,
          totalContracts: 0,
        };
      }
      
      const stats = strategyStats[strategy];
      stats.totalPnL += signal.simulatedPnL;
      stats.totalTrades += 1;
      stats.totalContracts += signal.simulatedContracts;
      
      if (signal.simulatedWin) {
        stats.wins += 1;
      } else {
        stats.losses += 1;
      }
    }
  }
  
  // Calculate win rate and avg P&L per trade
  for (const strategy in strategyStats) {
    const stats = strategyStats[strategy];
    stats.winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) : 0;
    stats.avgPnLPerTrade = stats.totalTrades > 0 ? (stats.totalPnL / stats.totalTrades) : 0;
    stats.avgPnLPerContract = stats.totalContracts > 0 ? (stats.totalPnL / stats.totalContracts) : 0;
  }
  
  return Object.values(strategyStats);
}

// Main simulation
async function main() {
  console.log("=== Paper Trading Simulation (Task 250) ===\n");
  console.log("Running live_runner.js 3 times with simulated P&L...\n");
  
  const runs = [];
  
  // Run 3 simulations
  for (let i = 1; i <= 3; i++) {
    const run = runSimulation(i);
    runs.push(run);
    
    // Small delay between runs
    if (i < 3) {
      console.log("  Waiting 2 seconds before next run...");
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Compute strategy P&L
  const strategyPnL = computeStrategyPnL(runs);
  
  // Build final report
  const report = {
    generatedAt: new Date().toISOString(),
    task: 250,
    description: "Paper trading simulation - 3 runs with simulated P&L",
    totalRuns: runs.length,
    runs,
    summary: {
      totalSignals: runs.reduce((sum, r) => sum + r.signalCount, 0),
      totalPnL: strategyPnL.reduce((sum, s) => sum + s.totalPnL, 0),
      strategyCount: strategyPnL.length,
    },
    strategyPnL,
  };
  
  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  
  // Print summary
  console.log("\n=== Simulation Complete ===");
  console.log(`Total signals: ${report.summary.totalSignals}`);
  console.log(`Total P&L: $${(report.summary.totalPnL / 100).toFixed(2)}`);
  console.log(`\nP&L by Strategy:`);
  for (const strat of strategyPnL) {
    console.log(`  ${strat.strategy}:`);
    console.log(`    Trades: ${strat.totalTrades} | Wins: ${strat.wins} | Losses: ${strat.losses}`);
    console.log(`    Win Rate: ${(strat.winRate * 100).toFixed(1)}%`);
    console.log(`    Total P&L: $${(strat.totalPnL / 100).toFixed(2)}`);
    console.log(`    Avg per Trade: ${(strat.avgPnLPerTrade / 100).toFixed(2)}¢`);
  }
  console.log(`\nOutput written to: ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
