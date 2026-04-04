#!/usr/bin/env node
/**
 * Historical Replay Backtest Engine — T332
 * Replays market snapshot price history through mean_reversion strategy
 * Author: Bob (Backend Engineer)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { MeanReversionStrategy } = require("../strategies/strategies/mean_reversion");

// Default configuration
const DEFAULT_CONFIG = {
  zScoreThreshold: 1.5,
  lookbackPeriods: 20,
  minVolume: 10000,
  feePerContract: 1, // cents per side
  contractValue: 100, // cents ($1 per contract)
  maxPositions: 10,
};

/**
 * Load market snapshot from JSON file
 * @param {string} snapshotPath - Path to snapshot file
 * @returns {Object} Snapshot data { ticker, prices[], metadata }
 */
function loadSnapshot(snapshotPath) {
  const data = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  return {
    ticker: data.ticker,
    prices: data.prices || [],
    metadata: data.metadata || {},
  };
}

/**
 * Save market snapshot to JSON file
 * @param {string} outputPath - Output file path
 * @param {Object} snapshot - Snapshot data
 */
function saveSnapshot(outputPath, snapshot) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
}

/**
 * Create synthetic market snapshot for testing
 * @param {string} ticker - Market ticker
 * @param {Array} prices - Array of yes_mid prices in cents
 * @param {Object} metadata - Optional metadata
 * @returns {Object} Snapshot object
 */
function createSnapshot(ticker, prices, metadata = {}) {
  return {
    ticker,
    prices,
    metadata: {
      created: new Date().toISOString(),
      source: metadata.source || "synthetic",
      ...metadata,
    },
  };
}

/**
 * Compute rolling mean and stddev for a price series
 * @param {Array} prices - Array of prices
 * @param {number} lookback - Lookback periods
 * @param {number} idx - Current index
 * @returns {Object} { mean, stddev }
 */
function computeRollingStats(prices, lookback, idx) {
  const start = Math.max(0, idx - lookback);
  const slice = prices.slice(start, idx);
  
  if (slice.length < 2) {
    return { mean: prices[idx] || 50, stddev: 10 };
  }
  
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / slice.length;
  const stddev = Math.sqrt(variance) || 0.1;
  
  return { mean, stddev };
}

/**
 * Calculate P&L for a trade
 * @param {Object} trade - Trade record
 * @param {number} exitPrice - Exit price in cents
 * @param {Object} config - Configuration
 * @returns {number} P&L in cents
 */
function calculatePnL(trade, exitPrice, config) {
  const { side, entryPrice, contracts } = trade;
  
  // Price movement in cents
  const priceDelta = exitPrice - entryPrice;
  
  // For YES position: profit if price goes up
  // For NO position: profit if price goes down (inverse of YES)
  // NO position at price P is equivalent to YES position at (100-P)
  let directionMultiplier;
  if (side === "yes") {
    directionMultiplier = 1;
  } else {
    // NO position: profit when YES price goes down
    directionMultiplier = -1;
  }
  
  // Gross P&L: price movement * contracts
  const grossPnL = priceDelta * contracts * directionMultiplier;
  
  // Fees: entry + exit
  const totalFees = config.feePerContract * contracts * 2;
  
  return grossPnL - totalFees;
}

/**
 * Run historical replay backtest
 * @param {Object} snapshot - Market snapshot with price history
 * @param {Object} config - Backtest configuration
 * @returns {Object} Backtest results
 */
function runReplayBacktest(snapshot, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const strategy = new MeanReversionStrategy({
    zScoreThreshold: cfg.zScoreThreshold,
    lookbackPeriods: cfg.lookbackPeriods,
    minVolume: cfg.minVolume,
  });
  
  const { ticker, prices } = snapshot;
  const trades = [];
  const equity = [0]; // Cumulative P&L over time
  let openTrade = null;
  
  console.log(`\n=== Replay Backtest: ${ticker} ===`);
  console.log(`Prices: ${prices.length} periods`);
  console.log(`Config: zScore=${cfg.zScoreThreshold}, lookback=${cfg.lookbackPeriods}\n`);
  
  // Replay each price point
  for (let i = cfg.lookbackPeriods; i < prices.length; i++) {
    const currentPrice = prices[i];
    const { mean, stddev } = computeRollingStats(prices, cfg.lookbackPeriods, i);
    
    // Create market object for strategy
    const market = {
      id: ticker,
      ticker: ticker,
      yes_mid: currentPrice,
      no_mid: 100 - currentPrice,
      volume: cfg.minVolume + 1000, // Satisfy min volume
      price_history_mean: mean,
      price_history_stddev: stddev,
    };
    
    // Check for exit if we have an open trade
    if (openTrade) {
      // Exit when price reverts to mean (within 0.5 stddev)
      const distanceToMean = Math.abs(currentPrice - mean);
      const exitSignal = distanceToMean < (stddev * 0.5) || i === prices.length - 1;
      
      if (exitSignal) {
        const pnl = calculatePnL(openTrade, currentPrice, cfg);
        const exitTrade = {
          ...openTrade,
          exitPrice: currentPrice,
          exitIndex: i,
          exitReason: i === prices.length - 1 ? "end_of_data" : "mean_reversion",
          pnl,
          outcome: pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN",
        };
        trades.push(exitTrade);
        equity.push(equity[equity.length - 1] + pnl);
        openTrade = null;
      }
    } else {
      // Look for entry signal
      const signal = strategy.generateSignal(market);
      
      if (signal) {
        openTrade = {
          ticker,
          entryIndex: i,
          entryPrice: currentPrice,
          side: signal.side,
          contracts: signal.recommendedContracts || 10,
          confidence: signal.confidence,
          zScore: (currentPrice - mean) / stddev,
          targetPrice: signal.targetPrice,
        };
      }
    }
    
    // Update equity curve (add 0 if no trade closed this period)
    if (equity.length <= i - cfg.lookbackPeriods) {
      equity.push(equity[equity.length - 1]);
    }
  }
  
  // Calculate statistics
  const closedTrades = trades.filter(t => t.outcome !== undefined);
  const wins = closedTrades.filter(t => t.outcome === "WIN").length;
  const losses = closedTrades.filter(t => t.outcome === "LOSS").length;
  const breakeven = closedTrades.filter(t => t.outcome === "BREAKEVEN").length;
  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  
  // Calculate max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  for (const pnl of equity) {
    if (pnl > peak) peak = pnl;
    const drawdown = peak - pnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  const results = {
    ticker,
    config: cfg,
    summary: {
      totalTrades: closedTrades.length,
      wins,
      losses,
      breakeven,
      winRate: winRate.toFixed(1),
      totalPnL: (totalPnL / 100).toFixed(2), // Convert to dollars
      totalPnLCents: totalPnL,
      maxDrawdown: (maxDrawdown / 100).toFixed(2),
      avgTradePnL: closedTrades.length > 0 ? (totalPnL / closedTrades.length / 100).toFixed(2) : "0.00",
    },
    trades: closedTrades,
    equityCurve: equity,
  };
  
  return results;
}

/**
 * Print backtest results to console
 * @param {Object} results - Backtest results
 */
function printResults(results) {
  const { summary, trades, ticker } = results;
  
  console.log("\n📊 BACKTEST RESULTS");
  console.log("===================");
  console.log(`Ticker: ${ticker}`);
  console.log(`Total Trades: ${summary.totalTrades}`);
  console.log(`Win Rate: ${summary.winRate}% (${summary.wins} wins, ${summary.losses} losses, ${summary.breakeven} BE)`);
  console.log(`Total P&L: $${summary.totalPnL}`);
  console.log(`Avg Trade P&L: $${summary.avgTradePnL}`);
  console.log(`Max Drawdown: $${summary.maxDrawdown}`);
  
  if (trades.length > 0) {
    console.log("\n📋 TRADE LOG");
    console.log("============");
    trades.forEach((t, i) => {
      const pnlStr = t.pnl >= 0 ? `+$${(t.pnl/100).toFixed(2)}` : `-$${Math.abs(t.pnl/100).toFixed(2)}`;
      console.log(
        `${i+1}. [${t.outcome}] ${t.side.toUpperCase()} @ ${t.entryPrice}c ` +
        `→ ${t.exitPrice}c | ${pnlStr} | z=${t.zScore.toFixed(2)}`
      );
    });
  }
}

/**
 * Main CLI entry point
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === "run" && args[1]) {
    // Run backtest from snapshot file
    const snapshotPath = args[1];
    const outputPath = args[2];
    
    console.log(`Loading snapshot: ${snapshotPath}`);
    const snapshot = loadSnapshot(snapshotPath);
    
    // Parse config overrides from args
    const config = {};
    const zIdx = args.indexOf("--zscore");
    if (zIdx > -1) config.zScoreThreshold = parseFloat(args[zIdx + 1]);
    const lookIdx = args.indexOf("--lookback");
    if (lookIdx > -1) config.lookbackPeriods = parseInt(args[lookIdx + 1]);
    
    const results = runReplayBacktest(snapshot, config);
    printResults(results);
    
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
      console.log(`\n✅ Results saved to: ${outputPath}`);
    }
    
    return results;
  } 
  
  if (command === "create-sample") {
    // Create a sample snapshot file
    const outputPath = args[1] || "output/sample_snapshot.json";
    
    // Generate synthetic price series with mean reversion pattern
    const prices = [];
    let price = 50;
    for (let i = 0; i < 100; i++) {
      // Add some mean reversion behavior
      const mean = 50;
      const pull = (mean - price) * 0.1;
      const noise = (Math.random() - 0.5) * 10;
      price = Math.max(10, Math.min(90, price + pull + noise));
      prices.push(Math.round(price));
    }
    
    const snapshot = createSnapshot("SYNTH-MR-TEST", prices, {
      description: "Synthetic mean reversion test data",
      volatility: "medium",
    });
    
    saveSnapshot(outputPath, snapshot);
    console.log(`✅ Sample snapshot created: ${outputPath}`);
    console.log(`Prices: ${prices.length} periods`);
    console.log(`Range: ${Math.min(...prices)}c - ${Math.max(...prices)}c`);
    return snapshot;
  }
  
  // Help
  console.log(`
Historical Replay Backtest Engine — T332

Usage:
  node replay_engine.js run <snapshot.json> [output.json] [options]
  node replay_engine.js create-sample [output.json]

Options:
  --zscore <n>     Z-score threshold (default: 1.5)
  --lookback <n>   Lookback periods (default: 20)

Examples:
  node replay_engine.js run output/sample_snapshot.json output/results.json
  node replay_engine.js run data/market.json --zscore 2.0 --lookback 30
  node replay_engine.js create-sample output/my_snapshot.json
`);
  return null;
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  loadSnapshot,
  saveSnapshot,
  createSnapshot,
  runReplayBacktest,
  calculatePnL,
  computeRollingStats,
  DEFAULT_CONFIG,
};
