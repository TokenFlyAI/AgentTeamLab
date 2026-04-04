#!/usr/bin/env node
/**
 * Signal Generator — T567
 * Generates paper trade signals from correlation pairs using z-score mean reversion.
 *
 * Strategy:
 *   For each correlated pair (from Phase 3), compute the rolling price spread.
 *   When the spread z-score exceeds thresholds, generate BUY/SELL signals.
 *   Mean-reversion: if spread is too wide (z > 2), bet on convergence.
 *
 * Usage:
 *   node signal_generator.js                    # standalone
 *   node run_pipeline.js --with-signals         # integrated
 *
 * Following: D5 (runnable system), C8 (verify output), C6 (knowledge.md ref)
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const SIGNAL_CONFIG = {
  // Z-score thresholds — Sprint 2 optimized (T567: z=1.2, lookback=10, conf=0.65)
  zScoreEntry: 1.2,       // |z| > 1.2 → generate signal (optimized from 2.0)
  zScoreExit: 0.5,        // |z| < 0.5 → close position (mean reverted)
  zScoreStop: 3.0,        // |z| > 3.0 → stop loss (tightened from 3.5)

  // Rolling window for z-score calculation
  lookbackPeriod: 10,     // 10 price observations (optimized from 20)
  minLookback: 5,         // minimum observations before generating signals (halved with lookback)

  // Position sizing (fixed fractional)
  maxPositionSize: 5,     // max contracts per signal
  basePositionSize: 2,    // default contracts
  confidenceScaling: true, // scale position by arbitrage confidence

  // Confidence filter (Sprint 2 optimized)
  minConfidence: 0.65,    // only trade pairs with confidence >= 0.65

  // Risk management
  maxOpenPositions: 6,    // max simultaneous open positions
  maxDrawdownPct: 10,     // stop trading if drawdown > 10% of capital
  initialCapital: 100,    // $100 starting capital (paper)

  // Simulation
  priceHistoryLength: 50, // generate 50 price points for backtesting
  tradingFee: 0.01,       // $0.01 per contract per side
};

// ---------------------------------------------------------------------------
// Z-Score Spread Calculator
// ---------------------------------------------------------------------------
function calculateSpreadZScores(pricesA, pricesB, lookback) {
  const n = Math.min(pricesA.length, pricesB.length);
  const spreads = [];
  const zScores = [];

  // Calculate normalized spread series
  for (let i = 0; i < n; i++) {
    // Normalize prices to returns from start
    const baseA = pricesA[0] || 1;
    const baseB = pricesB[0] || 1;
    const normA = (pricesA[i] - baseA) / baseA;
    const normB = (pricesB[i] - baseB) / baseB;
    spreads.push(normA - normB);
  }

  // Calculate rolling z-scores
  for (let i = 0; i < n; i++) {
    if (i < SIGNAL_CONFIG.minLookback) {
      zScores.push(null); // Not enough data
      continue;
    }

    const windowStart = Math.max(0, i - lookback);
    const window = spreads.slice(windowStart, i);

    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((sum, s) => sum + (s - mean) ** 2, 0) / window.length;
    const std = Math.sqrt(variance) || 0.001;

    zScores.push((spreads[i] - mean) / std);
  }

  return { spreads, zScores };
}

// ---------------------------------------------------------------------------
// Signal Generation
// ---------------------------------------------------------------------------
function generateSignals(correlationPairs, priceData) {
  const signals = [];
  const pairs = correlationPairs.pairs || [];

  for (const pair of pairs) {
    if (!pair.is_arbitrage_opportunity) continue;

    // Compute confidence from available fields:
    // - |pearson_r| strength (0-1) weighted 40%
    // - edge size normalized to 0-1 (cap at 5 cents) weighted 40%
    // - |spread_zscore| normalized (cap at 3) weighted 20%
    const rStrength = Math.abs(pair.pearson_r || pair.pearson_correlation || 0);
    const edgeNorm = Math.min(1, (pair.estimated_edge_cents || 0) / 5);
    const zNorm = Math.min(1, Math.abs(pair.spread_zscore || 0) / 3);
    const confidence = rStrength * 0.4 + edgeNorm * 0.4 + zNorm * 0.2;

    if (confidence < SIGNAL_CONFIG.minConfidence) continue;

    const tickerA = pair.market_a;
    const tickerB = pair.market_b;

    const pricesA = priceData[tickerA];
    const pricesB = priceData[tickerB];
    if (!pricesA || !pricesB) continue;

    const { spreads, zScores } = calculateSpreadZScores(
      pricesA, pricesB, SIGNAL_CONFIG.lookbackPeriod
    );

    // Attach computed confidence to pair for downstream use
    pair.arbitrage_confidence = parseFloat(confidence.toFixed(4));

    // Walk through z-scores and generate signals
    let inPosition = false;
    let positionDirection = null;

    for (let i = 0; i < zScores.length; i++) {
      const z = zScores[i];
      if (z === null) continue;

      const timestamp = new Date(
        Date.now() - (zScores.length - i) * 3600000 // 1 hour per tick
      ).toISOString();

      // Entry signals
      if (!inPosition) {
        if (z > SIGNAL_CONFIG.zScoreEntry) {
          // Spread too wide (A overpriced vs B) → sell A, buy B
          const contracts = calculatePositionSize(pair.arbitrage_confidence, Math.abs(z));
          signals.push({
            id: `sig_${signals.length + 1}`,
            timestamp,
            type: "ENTRY",
            action_a: "SELL",
            action_b: "BUY",
            market_a: tickerA,
            market_b: tickerB,
            cluster: pair.cluster,
            z_score: parseFloat(z.toFixed(3)),
            spread: parseFloat(spreads[i].toFixed(4)),
            correlation: pair.pearson_correlation,
            confidence: pair.arbitrage_confidence,
            contracts,
            reason: `z=${z.toFixed(2)} > ${SIGNAL_CONFIG.zScoreEntry} — spread wide, mean reversion expected`,
          });
          inPosition = true;
          positionDirection = "short_spread";
        } else if (z < -SIGNAL_CONFIG.zScoreEntry) {
          // Spread too narrow (B overpriced vs A) → buy A, sell B
          const contracts = calculatePositionSize(pair.arbitrage_confidence, Math.abs(z));
          signals.push({
            id: `sig_${signals.length + 1}`,
            timestamp,
            type: "ENTRY",
            action_a: "BUY",
            action_b: "SELL",
            market_a: tickerA,
            market_b: tickerB,
            cluster: pair.cluster,
            z_score: parseFloat(z.toFixed(3)),
            spread: parseFloat(spreads[i].toFixed(4)),
            correlation: pair.pearson_correlation,
            confidence: pair.arbitrage_confidence,
            contracts,
            reason: `z=${z.toFixed(2)} < -${SIGNAL_CONFIG.zScoreEntry} — spread narrow, mean reversion expected`,
          });
          inPosition = true;
          positionDirection = "long_spread";
        }
      }

      // Exit signals
      if (inPosition) {
        if (Math.abs(z) < SIGNAL_CONFIG.zScoreExit) {
          // Mean reverted → close position
          signals.push({
            id: `sig_${signals.length + 1}`,
            timestamp,
            type: "EXIT",
            action_a: positionDirection === "short_spread" ? "BUY" : "SELL",
            action_b: positionDirection === "short_spread" ? "SELL" : "BUY",
            market_a: tickerA,
            market_b: tickerB,
            cluster: pair.cluster,
            z_score: parseFloat(z.toFixed(3)),
            spread: parseFloat(spreads[i].toFixed(4)),
            reason: `z=${z.toFixed(2)} reverted to mean (< ${SIGNAL_CONFIG.zScoreExit})`,
          });
          inPosition = false;
          positionDirection = null;
        } else if (Math.abs(z) > SIGNAL_CONFIG.zScoreStop) {
          // Stop loss — spread diverging further
          signals.push({
            id: `sig_${signals.length + 1}`,
            timestamp,
            type: "STOP",
            action_a: positionDirection === "short_spread" ? "BUY" : "SELL",
            action_b: positionDirection === "short_spread" ? "SELL" : "BUY",
            market_a: tickerA,
            market_b: tickerB,
            cluster: pair.cluster,
            z_score: parseFloat(z.toFixed(3)),
            spread: parseFloat(spreads[i].toFixed(4)),
            reason: `z=${z.toFixed(2)} — stop loss triggered (> ${SIGNAL_CONFIG.zScoreStop})`,
          });
          inPosition = false;
          positionDirection = null;
        }
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Position Sizing
// ---------------------------------------------------------------------------
function calculatePositionSize(confidence, absZ) {
  let size = SIGNAL_CONFIG.basePositionSize;

  if (SIGNAL_CONFIG.confidenceScaling) {
    // Scale by confidence: higher confidence → larger position
    size = Math.round(SIGNAL_CONFIG.basePositionSize * confidence);
  }

  // Bonus contract for very strong z-scores (> 2.5)
  if (absZ > 2.5) size += 1;

  return Math.max(1, Math.min(size, SIGNAL_CONFIG.maxPositionSize));
}

// ---------------------------------------------------------------------------
// Paper Trade Simulator
// ---------------------------------------------------------------------------
function simulatePaperTrades(signals, priceData) {
  const trades = [];
  let capital = SIGNAL_CONFIG.initialCapital;
  let peakCapital = capital;
  let maxDrawdown = 0;
  const openPositions = {};

  for (const signal of signals) {
    const pairKey = `${signal.market_a}:${signal.market_b}`;

    if (signal.type === "ENTRY") {
      // Open position
      if (Object.keys(openPositions).length >= SIGNAL_CONFIG.maxOpenPositions) continue;

      // Check drawdown limit
      const drawdownPct = ((peakCapital - capital) / peakCapital) * 100;
      if (drawdownPct > SIGNAL_CONFIG.maxDrawdownPct) continue;

      openPositions[pairKey] = {
        signal,
        entrySpread: signal.spread,
        contracts: signal.contracts,
        entryTime: signal.timestamp,
      };
    } else if (signal.type === "EXIT" || signal.type === "STOP") {
      const pos = openPositions[pairKey];
      if (!pos) continue;

      // Calculate P&L
      const exitSpread = signal.spread;
      const spreadChange = exitSpread - pos.entrySpread;

      // P&L depends on direction:
      // short_spread: profit when spread narrows (spreadChange < 0)
      // long_spread: profit when spread widens (spreadChange > 0)
      const isShortSpread = pos.signal.action_a === "SELL";
      const rawPnlPerContract = isShortSpread ? -spreadChange : spreadChange;

      // Convert spread change to dollar P&L (each cent = $0.01 per contract)
      // On Kalshi, contracts settle at $0 or $1, prices in cents
      const pnlCents = rawPnlPerContract * 100 * pos.contracts;
      const fees = SIGNAL_CONFIG.tradingFee * pos.contracts * 2; // entry + exit
      const netPnl = (pnlCents / 100) - fees;

      capital += netPnl;
      peakCapital = Math.max(peakCapital, capital);
      maxDrawdown = Math.max(maxDrawdown, ((peakCapital - capital) / peakCapital) * 100);

      trades.push({
        id: `trade_${trades.length + 1}`,
        entry_time: pos.entryTime,
        exit_time: signal.timestamp,
        exit_type: signal.type === "STOP" ? "stop_loss" : "mean_reversion",
        market_a: signal.market_a,
        market_b: signal.market_b,
        cluster: signal.cluster,
        direction: isShortSpread ? "short_spread" : "long_spread",
        contracts: pos.contracts,
        entry_spread: parseFloat(pos.entrySpread.toFixed(4)),
        exit_spread: parseFloat(exitSpread.toFixed(4)),
        entry_z: pos.signal.z_score,
        exit_z: signal.z_score,
        pnl_dollars: parseFloat(netPnl.toFixed(4)),
        fees_dollars: parseFloat(fees.toFixed(4)),
        outcome: netPnl > 0 ? "win" : "loss",
        capital_after: parseFloat(capital.toFixed(2)),
      });

      delete openPositions[pairKey];
    }
  }

  // Summary stats
  const wins = trades.filter(t => t.outcome === "win").length;
  const losses = trades.filter(t => t.outcome === "loss").length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl_dollars, 0);
  const totalFees = trades.reduce((s, t) => s + t.fees_dollars, 0);

  return {
    trades,
    summary: {
      initial_capital: SIGNAL_CONFIG.initialCapital,
      final_capital: parseFloat(capital.toFixed(2)),
      total_pnl: parseFloat(totalPnl.toFixed(4)),
      total_fees: parseFloat(totalFees.toFixed(4)),
      total_trades: trades.length,
      wins,
      losses,
      win_rate: trades.length > 0 ? parseFloat((wins / trades.length).toFixed(4)) : 0,
      avg_pnl_per_trade: trades.length > 0 ? parseFloat((totalPnl / trades.length).toFixed(4)) : 0,
      max_drawdown_pct: parseFloat(maxDrawdown.toFixed(2)),
      sharpe_estimate: estimateSharpe(trades),
    },
  };
}

function estimateSharpe(trades) {
  if (trades.length < 2) return 0;
  const returns = trades.map(t => t.pnl_dollars);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance) || 0.001;
  // Annualize assuming ~252 trading days, ~2 trades/day
  const annualFactor = Math.sqrt(252 * 2);
  return parseFloat(((mean / std) * annualFactor).toFixed(2));
}

// ---------------------------------------------------------------------------
// Price Data Generator (uses same seeded approach as run_pipeline.js)
// ---------------------------------------------------------------------------
function generatePriceData(correlationPairs) {
  const priceData = {};
  const allTickers = new Set();

  for (const pair of (correlationPairs.pairs || [])) {
    allTickers.add(pair.market_a);
    allTickers.add(pair.market_b);
  }

  // Shared market factors for correlated price generation
  const marketFactors = {};
  function getMarketFactor(category) {
    if (marketFactors[category]) return marketFactors[category];
    const seed = category.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const seededRandom = (n) => {
      const x = Math.sin(seed + n * 7.13) * 10000;
      return x - Math.floor(x);
    };
    const factors = [];
    for (let i = 0; i < SIGNAL_CONFIG.priceHistoryLength; i++) {
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
      category = "crypto";
      basePrice = ticker.includes("BTC") ? 65 : ticker.includes("ETH") ? 35 : 45;
    } else if (ticker.includes("INXW") || ticker.includes("GDP") || ticker.includes("CPI")) {
      category = "economics";
      basePrice = ticker.includes("INXW") ? 75 : 25;
    } else if (ticker.includes("KXNF") || ticker.includes("NFP")) {
      category = "nfp";
      basePrice = 26;
    } else if (ticker.includes("FED")) {
      category = "rates";
      basePrice = 45;
    } else if (ticker.includes("OIL")) {
      category = "commodities";
      basePrice = 22;
    }

    const sharedFactor = getMarketFactor(category);
    const prices = [basePrice];
    for (let i = 1; i < SIGNAL_CONFIG.priceHistoryLength; i++) {
      const shared = sharedFactor[i] * 0.7;
      const noise = (seededRandom(i) - 0.5) * 4 * 0.3;
      const newPrice = Math.max(5, Math.min(95, prices[i - 1] + shared + noise));
      prices.push(Math.round(newPrice));
    }
    priceData[ticker] = prices;
  }

  return priceData;
}

// ---------------------------------------------------------------------------
// Main — Standalone Runner
// ---------------------------------------------------------------------------
function runSignalGeneration(correlationPairsInput) {
  // Load correlation pairs
  let correlationPairs;
  if (correlationPairsInput) {
    correlationPairs = correlationPairsInput;
  } else {
    // Try multiple paths: agent-relative, then output-relative
    const candidates = [
      path.join(__dirname, "../../shared/correlation_pairs.json"),  // output/bob → output/shared/
      path.resolve(__dirname, "../../../../public/correlation_pairs.json"),  // root public/
      path.join(__dirname, "../../../public/correlation_pairs.json"),  // legacy path
    ];
    const cpPath = candidates.find(p => fs.existsSync(p)) || candidates[candidates.length - 1];
    if (!fs.existsSync(cpPath)) {
      console.error("correlation_pairs.json not found. Run the pipeline first (Phases 1-3).");
      process.exit(1);
    }
    correlationPairs = JSON.parse(fs.readFileSync(cpPath, "utf8"));
  }

  console.log("\n" + "=".repeat(60));
  console.log("SIGNAL GENERATION — T567");
  console.log("Z-Score Mean Reversion on Correlated Pairs");
  console.log("=".repeat(60));
  const allPairs = correlationPairs.pairs || [];
  const arbCount = allPairs.filter(p => p.is_arbitrage_opportunity).length;
  console.log(`Input: ${allPairs.length} pairs, ${arbCount} arb opportunities`);
  console.log(`Config: z_entry=${SIGNAL_CONFIG.zScoreEntry}, z_exit=${SIGNAL_CONFIG.zScoreExit}, z_stop=${SIGNAL_CONFIG.zScoreStop}`);

  // Generate price data for simulation
  const priceData = generatePriceData(correlationPairs);
  console.log(`Generated ${Object.keys(priceData).length} price series (${SIGNAL_CONFIG.priceHistoryLength} ticks each)`);

  // Generate signals
  const signals = generateSignals(correlationPairs, priceData);
  console.log(`\nSignals generated: ${signals.length}`);
  console.log(`  ENTRY: ${signals.filter(s => s.type === "ENTRY").length}`);
  console.log(`  EXIT:  ${signals.filter(s => s.type === "EXIT").length}`);
  console.log(`  STOP:  ${signals.filter(s => s.type === "STOP").length}`);

  // Simulate paper trades
  const results = simulatePaperTrades(signals, priceData);
  console.log(`\nPaper Trade Results:`);
  console.log(`  Trades: ${results.summary.total_trades}`);
  console.log(`  Wins: ${results.summary.wins}, Losses: ${results.summary.losses}`);
  console.log(`  Win rate: ${(results.summary.win_rate * 100).toFixed(1)}%`);
  console.log(`  Total P&L: $${results.summary.total_pnl.toFixed(2)}`);
  console.log(`  Avg P&L/trade: $${results.summary.avg_pnl_per_trade.toFixed(4)}`);
  console.log(`  Max drawdown: ${results.summary.max_drawdown_pct}%`);
  console.log(`  Sharpe estimate: ${results.summary.sharpe_estimate}`);
  console.log(`  Capital: $${results.summary.initial_capital} → $${results.summary.final_capital}`);

  // Write outputs
  const outputDir = path.join(__dirname);

  const signalsOutput = {
    generated_at: new Date().toISOString(),
    task: "T567",
    strategy: "z_score_mean_reversion",
    config: { ...SIGNAL_CONFIG },
    input: {
      correlation_pairs: allPairs.length,
      arbitrage_opportunities: arbCount,
    },
    total_signals: signals.length,
    signals,
  };
  const signalsPath = path.join(outputDir, "trade_signals.json");
  fs.writeFileSync(signalsPath, JSON.stringify(signalsOutput, null, 2));

  const resultsOutput = {
    generated_at: new Date().toISOString(),
    task: "T567",
    strategy: "z_score_mean_reversion",
    ...results,
  };
  const resultsPath = path.join(outputDir, "paper_trade_results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(resultsOutput, null, 2));

  console.log(`\nOutput files:`);
  console.log(`  ${signalsPath}`);
  console.log(`  ${resultsPath}`);

  return { signals: signalsOutput, results: resultsOutput };
}

// Run standalone
if (require.main === module) {
  runSignalGeneration();
}

module.exports = { runSignalGeneration, generateSignals, simulatePaperTrades, calculateSpreadZScores, SIGNAL_CONFIG };
