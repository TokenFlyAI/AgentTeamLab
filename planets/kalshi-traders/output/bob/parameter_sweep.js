#!/usr/bin/env node
/**
 * Parameter Sweep — T568
 * Systematic optimization of z-score thresholds for signal quality.
 *
 * Sweeps: z_entry (1.0-3.0), z_exit (0.3-1.0), z_stop (2.5-4.0)
 * For each combo: run walk-forward backtest, record metrics.
 * Output: parameter_sweep_results.json ranked by Sharpe ratio.
 *
 * Usage: node parameter_sweep.js
 * Following: D5 (runnable system), C8 (verify output), D2 (D004 north star)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { calculateSpreadZScores, SIGNAL_CONFIG } = require("./signal_generator");

// ---------------------------------------------------------------------------
// Sweep Ranges
// ---------------------------------------------------------------------------
const SWEEP = {
  zEntry: [1.0, 1.5, 2.0, 2.5, 3.0],
  zExit: [0.3, 0.5, 0.7, 1.0],
  zStop: [2.5, 3.0, 3.5, 4.0],
  priceHistoryLength: 100,
  trainPct: 0.7,
  initialCapital: 100,
  tradingFee: 0.01,
  basePositionSize: 2,
  maxPositionSize: 5,
};

// ---------------------------------------------------------------------------
// Price Generator (same as backtest_signals.js — regime changes included)
// ---------------------------------------------------------------------------
function generatePriceData(pairs) {
  const priceData = {};
  const allTickers = new Set();
  for (const pair of pairs) {
    allTickers.add(pair.market_a);
    allTickers.add(pair.market_b);
  }

  const marketFactors = {};
  function getMarketFactor(category) {
    if (marketFactors[category]) return marketFactors[category];
    const seed = category.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const seededRandom = (n) => {
      const x = Math.sin(seed + n * 7.13) * 10000;
      return x - Math.floor(x);
    };
    const factors = [];
    for (let i = 0; i < SWEEP.priceHistoryLength; i++) {
      factors.push((seededRandom(i) - 0.5) * 6);
    }
    marketFactors[category] = factors;
    return factors;
  }

  for (const ticker of allTickers) {
    const seed = ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const seededRandom = (n) => {
      const x = Math.sin(seed + n) * 10000;
      return x - Math.floor(x);
    };

    let category = "other", basePrice = 50;
    if (ticker.includes("BTC") || ticker.includes("ETH") || ticker.includes("SOL")) {
      category = "crypto"; basePrice = ticker.includes("BTC") ? 65 : ticker.includes("ETH") ? 35 : 45;
    } else if (ticker.includes("INXW") || ticker.includes("GDP") || ticker.includes("CPI")) {
      category = "economics"; basePrice = ticker.includes("INXW") ? 75 : 25;
    } else if (ticker.includes("KXNF") || ticker.includes("NFP")) {
      category = "nfp"; basePrice = 26;
    } else if (ticker.includes("FED")) {
      category = "rates"; basePrice = 45;
    } else if (ticker.includes("OIL")) {
      category = "commodities"; basePrice = 22;
    }

    const sharedFactor = getMarketFactor(category);
    const prices = [basePrice];
    for (let i = 1; i < SWEEP.priceHistoryLength; i++) {
      const regimeShift = (seededRandom(i * 3 + 7) < 0.15) ? (seededRandom(i * 5) - 0.5) * 8 : 0;
      const shared = sharedFactor[i] * 0.7;
      const noise = (seededRandom(i) - 0.5) * 4 * 0.3 + regimeShift;
      const newPrice = Math.max(5, Math.min(95, prices[i - 1] + shared + noise));
      prices.push(Math.round(newPrice));
    }
    priceData[ticker] = prices;
  }
  return priceData;
}

// ---------------------------------------------------------------------------
// Single Backtest Run with Given Parameters
// ---------------------------------------------------------------------------
function runSingleBacktest(arbPairs, priceData, zEntry, zExit, zStop) {
  let totalTrades = 0, totalWins = 0, totalPnl = 0;
  const pnlList = [];

  for (const pair of arbPairs) {
    const pricesA = priceData[pair.market_a];
    const pricesB = priceData[pair.market_b];
    if (!pricesA || !pricesB) continue;

    const n = Math.min(pricesA.length, pricesB.length);
    const splitIdx = Math.floor(n * SWEEP.trainPct);

    // Training spread stats
    const trainA = pricesA.slice(0, splitIdx);
    const trainB = pricesB.slice(0, splitIdx);
    const { spreads: trainSpreads } = calculateSpreadZScores(trainA, trainB, 20);
    const valid = trainSpreads.filter(s => s !== undefined && !isNaN(s));
    if (valid.length < 10) continue;

    const trainMean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const trainVar = valid.reduce((s, v) => s + (v - trainMean) ** 2, 0) / valid.length;
    const trainStd = Math.sqrt(trainVar) || 0.001;

    // Test period
    const baseA = pricesA[0] || 1, baseB = pricesB[0] || 1;
    const testSpreads = [];
    for (let i = splitIdx; i < n; i++) {
      testSpreads.push((pricesA[i] - baseA) / baseA - (pricesB[i] - baseB) / baseB);
    }
    const testZ = testSpreads.map(s => (s - trainMean) / trainStd);

    // Simulate
    let inPos = false, posDir = null, entrySpread = 0;
    const confidence = pair.arbitrage_confidence || 0.5;

    for (let i = 0; i < testZ.length; i++) {
      const z = testZ[i];
      if (!inPos) {
        if (z > zEntry || z < -zEntry) {
          inPos = true;
          posDir = z > 0 ? "short" : "long";
          entrySpread = testSpreads[i];
        }
      } else {
        let exit = false;
        if (Math.abs(z) < zExit) exit = true;
        else if (Math.abs(z) > zStop) exit = true;

        if (exit) {
          const spreadChange = testSpreads[i] - entrySpread;
          const rawPnl = posDir === "short" ? -spreadChange : spreadChange;
          const contracts = Math.max(1, Math.min(SWEEP.maxPositionSize, Math.round(SWEEP.basePositionSize * confidence)));
          const netPnl = (rawPnl * 100 * contracts / 100) - (SWEEP.tradingFee * contracts * 2);

          totalTrades++;
          if (netPnl > 0) totalWins++;
          totalPnl += netPnl;
          pnlList.push(netPnl);
          inPos = false;
        }
      }
    }
  }

  // Sharpe
  let sharpe = 0;
  if (pnlList.length >= 2) {
    const mean = pnlList.reduce((a, b) => a + b, 0) / pnlList.length;
    const variance = pnlList.reduce((s, r) => s + (r - mean) ** 2, 0) / (pnlList.length - 1);
    const std = Math.sqrt(variance) || 0.001;
    sharpe = (mean / std) * Math.sqrt(252 * 2);
  }

  return {
    total_trades: totalTrades,
    wins: totalWins,
    losses: totalTrades - totalWins,
    win_rate: totalTrades > 0 ? totalWins / totalTrades : 0,
    total_pnl: totalPnl,
    avg_pnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
    sharpe,
  };
}

// ---------------------------------------------------------------------------
// Main Sweep
// ---------------------------------------------------------------------------
function runParameterSweep() {
  const cpPath = path.join(__dirname, "../../../public/correlation_pairs.json");
  if (!fs.existsSync(cpPath)) {
    console.error("correlation_pairs.json not found. Run: node run_pipeline.js first.");
    process.exit(1);
  }
  const correlationPairs = JSON.parse(fs.readFileSync(cpPath, "utf8"));
  const arbPairs = (correlationPairs.pairs || []).filter(p => p.is_arbitrage_opportunity);

  console.log("=".repeat(60));
  console.log("PARAMETER SWEEP — T568");
  console.log("Z-Score Threshold Optimization");
  console.log("=".repeat(60));
  console.log(`Arb pairs: ${arbPairs.length}`);
  console.log(`z_entry: ${SWEEP.zEntry.join(", ")}`);
  console.log(`z_exit:  ${SWEEP.zExit.join(", ")}`);
  console.log(`z_stop:  ${SWEEP.zStop.join(", ")}`);

  const totalCombos = SWEEP.zEntry.length * SWEEP.zExit.length * SWEEP.zStop.length;
  console.log(`Total combinations: ${totalCombos}\n`);

  const priceData = generatePriceData(arbPairs);
  const results = [];

  for (const zEntry of SWEEP.zEntry) {
    for (const zExit of SWEEP.zExit) {
      for (const zStop of SWEEP.zStop) {
        // Skip invalid: exit must be < entry, stop must be > entry
        if (zExit >= zEntry) continue;
        if (zStop <= zEntry) continue;

        const metrics = runSingleBacktest(arbPairs, priceData, zEntry, zExit, zStop);
        results.push({
          params: { z_entry: zEntry, z_exit: zExit, z_stop: zStop },
          ...metrics,
        });
      }
    }
  }

  // Rank by Sharpe (primary), then P&L (secondary)
  results.sort((a, b) => {
    if (b.sharpe !== a.sharpe) return b.sharpe - a.sharpe;
    return b.total_pnl - a.total_pnl;
  });

  // Display top 10
  console.log("TOP 10 PARAMETER SETS (by Sharpe):");
  console.log("-".repeat(90));
  console.log("Rank | z_entry | z_exit | z_stop | Trades | WR%   | P&L     | Sharpe");
  console.log("-".repeat(90));
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    const p = r.params;
    console.log(
      `  ${(i + 1).toString().padStart(2)}  |  ${p.z_entry.toFixed(1)}    |  ${p.z_exit.toFixed(1)}   |  ${p.z_stop.toFixed(1)}   |   ${r.total_trades.toString().padStart(3)}  | ${(r.win_rate * 100).toFixed(1).padStart(5)}% | $${r.total_pnl.toFixed(2).padStart(6)} | ${r.sharpe.toFixed(2).padStart(6)}`
    );
  }

  // Summary
  const withTrades = results.filter(r => r.total_trades > 0);
  const profitable = results.filter(r => r.total_pnl > 0);
  console.log(`\nSummary: ${results.length} valid combos, ${withTrades.length} generated trades, ${profitable.length} profitable`);

  if (results.length > 0) {
    const best = results[0];
    console.log(`\nBest params: z_entry=${best.params.z_entry}, z_exit=${best.params.z_exit}, z_stop=${best.params.z_stop}`);
    console.log(`  → ${best.total_trades} trades, ${(best.win_rate * 100).toFixed(1)}% WR, $${best.total_pnl.toFixed(2)} P&L, Sharpe ${best.sharpe.toFixed(2)}`);
  }

  // Write output
  const output = {
    generated_at: new Date().toISOString(),
    task: "T568",
    sweep_config: SWEEP,
    total_combinations: totalCombos,
    valid_combinations: results.length,
    with_trades: withTrades.length,
    profitable: profitable.length,
    best_params: results.length > 0 ? results[0] : null,
    all_results: results.map(r => ({
      ...r,
      total_pnl: parseFloat(r.total_pnl.toFixed(4)),
      avg_pnl: parseFloat(r.avg_pnl.toFixed(4)),
      win_rate: parseFloat(r.win_rate.toFixed(4)),
      sharpe: parseFloat(r.sharpe.toFixed(2)),
    })),
  };

  const outPath = path.join(__dirname, "parameter_sweep_results.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nOutput: ${outPath}`);

  return output;
}

if (require.main === module) {
  const cpPath = path.join(__dirname, "../../../public/correlation_pairs.json");
  if (!fs.existsSync(cpPath)) {
    console.log("Running pipeline first...\n");
    const { main } = require("./run_pipeline");
    main().then(() => runParameterSweep());
  } else {
    runParameterSweep();
  }
}

module.exports = { runParameterSweep };
