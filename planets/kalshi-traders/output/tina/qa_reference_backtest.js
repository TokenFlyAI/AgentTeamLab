#!/usr/bin/env node
/**
 * QA Reference Backtest — Corrected P&L Simulator
 * Tina (QA) — Sprint 3, supports T568 rework
 *
 * Fixes from T570 QA + Olivia's rejection:
 *  1. Uses Bob's ACTUAL trade_signals.json (no regeneration)
 *  2. Spread-based P&L model (not z-score improvement)
 *  3. Position keying: market_a|market_b (no cluster field dependency)
 *  4. Proper hold time tracking (no 0-hour trades)
 *  5. Drawdown tracking with circuit breaker
 *
 * P&L Model (spread-based):
 *   Kalshi contracts trade $0-$1. Spread = price_a - price_b.
 *   Entry when spread diverges (|z| > threshold), exit when it converges.
 *   P&L per contract = |entry_spread - exit_spread| (spread convergence)
 *   Direction: if entry z > 0, short spread (profit when spread narrows)
 *             if entry z < 0, long spread (profit when spread widens toward 0)
 *
 * Usage: node qa_reference_backtest.js [path/to/trade_signals.json]
 */

const fs = require('fs');
const path = require('path');

const signalPath = process.argv[2] || path.resolve(__dirname, '..', '..', 'bob', 'output', 'trade_signals.json');

console.log('=== QA Reference Backtest ===');
console.log(`Input: ${signalPath}\n`);

let data;
try {
  data = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
} catch (e) {
  console.error(`FAIL: Cannot read ${signalPath}: ${e.message}`);
  process.exit(1);
}

const signals = data.signals;
const config = data.config;
const initialCapital = config.initialCapital || 100;
const tradingFee = config.tradingFee || 0.01;
const maxDrawdownPct = config.maxDrawdownPct || 10;

// State
let capital = initialCapital;
let peakCapital = initialCapital;
let maxDrawdown = 0;
let maxDrawdownPctActual = 0;
const openPositions = new Map();
const completedTrades = [];
let totalFees = 0;
let circuitBreakerTriggered = false;
let skippedSignals = 0;

// Sort by timestamp
signals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

console.log(`Signals: ${signals.length} (from Bob's T567)`);
console.log(`Initial capital: $${initialCapital}`);
console.log(`Fee: $${tradingFee}/contract/side`);
console.log(`Max drawdown: ${maxDrawdownPct}%`);
console.log(`Strategy: ${data.strategy}\n`);

for (const sig of signals) {
  // Position key: market pair only (no cluster field — Bob's signals don't have it)
  const posKey = `${sig.market_a}|${sig.market_b}`;

  if (circuitBreakerTriggered) {
    skippedSignals++;
    continue;
  }

  if (sig.type === 'ENTRY') {
    // Don't open duplicate positions on same pair
    if (openPositions.has(posKey)) {
      console.log(`[SKIP] ${sig.id} — Already have open position on ${posKey}`);
      skippedSignals++;
      continue;
    }

    const contracts = sig.contracts || 1;
    const entryFee = contracts * 2 * tradingFee; // both legs
    capital -= entryFee;
    totalFees += entryFee;

    openPositions.set(posKey, {
      entrySignal: sig,
      entrySpread: sig.spread,
      entryZ: sig.z_score,
      contracts,
      entryFee,
      entryTime: new Date(sig.timestamp)
    });

    console.log(`[ENTRY] ${sig.id} | ${sig.market_a} vs ${sig.market_b} | z=${sig.z_score.toFixed(2)} | spread=${sig.spread.toFixed(4)} | ${contracts}x | fee=$${entryFee.toFixed(2)}`);

  } else if (sig.type === 'EXIT' || sig.type === 'STOP') {
    const pos = openPositions.get(posKey);
    if (!pos) {
      console.log(`[WARN] ${sig.id} — No open position for ${posKey}, skipping`);
      skippedSignals++;
      continue;
    }

    const contracts = pos.contracts;
    const exitFee = contracts * 2 * tradingFee;
    capital -= exitFee;
    totalFees += exitFee;

    // SPREAD-BASED P&L MODEL
    // The spread represents price difference between two correlated markets
    // Entry: spread is diverged from mean → we bet it converges
    // If entryZ > 0: we shorted the spread (it was too wide) → profit if spread narrows
    // If entryZ < 0: we longed the spread (it was too narrow) → profit if spread widens
    const entrySpread = pos.entrySpread;
    const exitSpread = sig.spread;
    const spreadChange = exitSpread - entrySpread;

    // P&L direction based on entry position
    // Short spread (z > 0): profit = -(exitSpread - entrySpread) = entrySpread - exitSpread
    // Long spread (z < 0): profit = exitSpread - entrySpread
    let rawPnl;
    if (pos.entryZ > 0) {
      // Shorted spread: profit when spread narrows
      rawPnl = (entrySpread - exitSpread) * contracts;
    } else {
      // Longed spread: profit when spread widens toward 0/positive
      rawPnl = (exitSpread - entrySpread) * contracts;
    }

    // Scale: Kalshi contracts are $0-$1, spreads are in that range
    // Each contract's P&L is the spread change (already in dollar terms for $1 contracts)
    const totalTradesFees = pos.entryFee + exitFee;
    const netPnl = rawPnl - totalTradesFees;
    capital += rawPnl;

    const holdTimeMs = new Date(sig.timestamp) - pos.entryTime;
    const holdTimeHours = holdTimeMs / 3600000;

    const trade = {
      id: `trade_${completedTrades.length + 1}`,
      entrySignal: pos.entrySignal.id,
      exitSignal: sig.id,
      exitType: sig.type,
      market_a: sig.market_a,
      market_b: sig.market_b,
      contracts,
      entryZ: pos.entryZ,
      exitZ: sig.z_score,
      entrySpread: entrySpread,
      exitSpread: exitSpread,
      spreadChange: parseFloat(spreadChange.toFixed(6)),
      rawPnl: parseFloat(rawPnl.toFixed(4)),
      fees: parseFloat(totalTradesFees.toFixed(4)),
      netPnl: parseFloat(netPnl.toFixed(4)),
      holdTimeHours: parseFloat(holdTimeHours.toFixed(2)),
      isWin: netPnl > 0,
      isStop: sig.type === 'STOP',
      capitalAfter: parseFloat(capital.toFixed(4))
    };
    completedTrades.push(trade);
    openPositions.delete(posKey);

    // Drawdown tracking
    if (capital > peakCapital) peakCapital = capital;
    const currentDD = peakCapital - capital;
    const currentDDPct = (currentDD / peakCapital) * 100;
    if (currentDDPct > maxDrawdownPctActual) {
      maxDrawdownPctActual = currentDDPct;
      maxDrawdown = currentDD;
    }

    if (currentDDPct >= maxDrawdownPct) {
      circuitBreakerTriggered = true;
      console.log(`[CIRCUIT BREAKER] Drawdown ${currentDDPct.toFixed(2)}% >= ${maxDrawdownPct}% limit`);
    }

    const label = sig.type === 'STOP' ? 'STOP' : 'EXIT';
    const pnlStr = netPnl >= 0 ? `+$${netPnl.toFixed(4)}` : `-$${Math.abs(netPnl).toFixed(4)}`;
    console.log(`[${label}] ${sig.id} | z: ${pos.entryZ.toFixed(2)}→${sig.z_score.toFixed(2)} | spread: ${entrySpread.toFixed(4)}→${exitSpread.toFixed(4)} | ${pnlStr} | hold=${holdTimeHours.toFixed(1)}h | cap=$${capital.toFixed(2)}`);
  }
}

// Warn about unclosed positions
if (openPositions.size > 0) {
  console.log(`\n[WARN] ${openPositions.size} unclosed positions at end:`);
  for (const [key, pos] of openPositions) {
    console.log(`  - ${key}: z=${pos.entryZ.toFixed(2)}, spread=${pos.entrySpread.toFixed(4)}, ${pos.contracts}x`);
  }
}

// === Summary Statistics ===
const wins = completedTrades.filter(t => t.isWin);
const losses = completedTrades.filter(t => !t.isWin);
const stops = completedTrades.filter(t => t.isStop);
const totalPnl = completedTrades.reduce((s, t) => s + t.netPnl, 0);
const avgPnl = completedTrades.length > 0 ? totalPnl / completedTrades.length : 0;
const winRate = completedTrades.length > 0 ? (wins.length / completedTrades.length * 100) : 0;
const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.netPnl, 0) / losses.length : 0;
const profitFactor = losses.length > 0
  ? Math.abs(wins.reduce((s, t) => s + t.netPnl, 0) / losses.reduce((s, t) => s + t.netPnl, 0))
  : (wins.length > 0 ? Infinity : 0);

// Sharpe ratio
const returns = completedTrades.map(t => t.netPnl);
const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
const stdReturn = returns.length > 1
  ? Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1))
  : 0;
const sharpe = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : 0; // annualized

// Average hold time
const avgHoldHours = completedTrades.length > 0
  ? completedTrades.reduce((s, t) => s + t.holdTimeHours, 0) / completedTrades.length
  : 0;

console.log('\n=== BACKTEST RESULTS ===');
console.log(`Signals consumed: ${signals.length - skippedSignals} / ${signals.length} (${skippedSignals} skipped)`);
console.log(`Completed trades: ${completedTrades.length}`);
console.log(`Unclosed positions: ${openPositions.size}`);
console.log(`Win rate: ${winRate.toFixed(1)}% (${wins.length}W / ${losses.length}L)`);
console.log(`Stop losses: ${stops.length}`);
console.log(`Total P&L: $${totalPnl.toFixed(4)} (${(totalPnl / initialCapital * 100).toFixed(2)}% return)`);
console.log(`Avg P&L per trade: $${avgPnl.toFixed(4)}`);
console.log(`Avg win: $${avgWin.toFixed(4)} | Avg loss: $${avgLoss.toFixed(4)}`);
console.log(`Profit factor: ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
console.log(`Sharpe ratio (annualized): ${sharpe.toFixed(2)}`);
console.log(`Max drawdown: $${maxDrawdown.toFixed(4)} (${maxDrawdownPctActual.toFixed(2)}%)`);
console.log(`Total fees: $${totalFees.toFixed(4)}`);
console.log(`Final capital: $${capital.toFixed(4)}`);
console.log(`Avg hold time: ${avgHoldHours.toFixed(1)} hours`);
console.log(`Circuit breaker: ${circuitBreakerTriggered ? 'TRIGGERED' : 'not triggered'}`);
console.log(`P&L model: SPREAD-BASED (contract spread convergence)`);

// Write results
const results = {
  backtest: 'qa_reference_backtest.js',
  input: signalPath,
  input_signals: signals.length,
  timestamp: new Date().toISOString(),
  config: {
    initialCapital,
    tradingFee,
    maxDrawdownPct,
    strategy: data.strategy,
    pnl_model: 'spread_based'
  },
  summary: {
    completed_trades: completedTrades.length,
    unclosed_positions: openPositions.size,
    skipped_signals: skippedSignals,
    win_rate: parseFloat(winRate.toFixed(2)),
    wins: wins.length,
    losses: losses.length,
    stops: stops.length,
    total_pnl: parseFloat(totalPnl.toFixed(4)),
    return_pct: parseFloat((totalPnl / initialCapital * 100).toFixed(2)),
    avg_pnl: parseFloat(avgPnl.toFixed(4)),
    avg_win: parseFloat(avgWin.toFixed(4)),
    avg_loss: parseFloat(avgLoss.toFixed(4)),
    profit_factor: profitFactor === Infinity ? 'Infinity' : parseFloat(profitFactor.toFixed(4)),
    sharpe_annualized: parseFloat(sharpe.toFixed(4)),
    max_drawdown: parseFloat(maxDrawdown.toFixed(4)),
    max_drawdown_pct: parseFloat(maxDrawdownPctActual.toFixed(4)),
    total_fees: parseFloat(totalFees.toFixed(4)),
    final_capital: parseFloat(capital.toFixed(4)),
    avg_hold_hours: parseFloat(avgHoldHours.toFixed(2)),
    circuit_breaker: circuitBreakerTriggered
  },
  trades: completedTrades,
  unclosed: Array.from(openPositions.entries()).map(([key, pos]) => ({
    pair: key,
    entryZ: pos.entryZ,
    entrySpread: pos.entrySpread,
    contracts: pos.contracts,
    entrySignal: pos.entrySignal.id
  }))
};

const outPath = path.join(__dirname, 'qa_reference_backtest_results.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nResults written to: ${outPath}`);
