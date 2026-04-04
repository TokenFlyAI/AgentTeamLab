#!/usr/bin/env node
/**
 * Backtest P&L Simulator for Bob's trade signals
 * Task: T568 — Dave (Full Stack Engineer)
 *
 * Reads trade_signals.json, simulates paired trades, outputs backtest_results.json
 * Following C8: code is runnable and verifiable
 * Following C6: references knowledge.md z-score mean reversion strategy
 */

const fs = require('fs');
const path = require('path');

// Load signals
const signalsPath = path.join(__dirname, '../bob/trade_signals.json');
const signalsData = JSON.parse(fs.readFileSync(signalsPath, 'utf-8'));
const signals = signalsData.signals;
const config = signalsData.config;

// Simulation state
const initialCapital = config.initialCapital || 100; // dollars
const tradingFee = config.tradingFee || 0.01; // per contract per side
const maxDrawdownPct = config.maxDrawdownPct || 10;

let capital = initialCapital;
let peakCapital = initialCapital;
let maxDrawdown = 0;
let maxDrawdownPct_actual = 0;
const openPositions = new Map(); // key: "market_a|market_b|cluster" -> position
const completedTrades = [];
let totalFees = 0;
let circuitBreakerTriggered = false;

// Sort signals by timestamp
signals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

console.log(`=== Backtest P&L Simulator ===`);
console.log(`Signals: ${signals.length}`);
console.log(`Initial capital: $${initialCapital}`);
console.log(`Trading fee: $${tradingFee}/contract/side`);
console.log(`Max drawdown limit: ${maxDrawdownPct}%`);
console.log(`Strategy: ${signalsData.strategy}`);
console.log('');

for (const sig of signals) {
  const posKey = `${sig.market_a}|${sig.market_b}|${sig.cluster}`;

  // Check circuit breaker
  if (circuitBreakerTriggered) {
    console.log(`[SKIP] ${sig.id} — Circuit breaker active, no new trades`);
    continue;
  }

  if (sig.type === 'ENTRY') {
    // Open a new position
    const contracts = sig.contracts || 1;
    const entryFee = contracts * 2 * tradingFee; // both legs
    capital -= entryFee;
    totalFees += entryFee;

    openPositions.set(posKey, {
      entrySignal: sig,
      entrySpread: sig.spread,
      contracts: contracts,
      entryFee: entryFee,
      entryTime: sig.timestamp
    });

    console.log(`[ENTRY] ${sig.id} | ${sig.market_a} vs ${sig.market_b} (${sig.cluster}) | z=${sig.z_score.toFixed(2)} | spread=${sig.spread} | ${contracts} contracts | fee=$${entryFee.toFixed(2)}`);

  } else if (sig.type === 'EXIT' || sig.type === 'STOP') {
    const pos = openPositions.get(posKey);
    if (!pos) {
      console.log(`[WARN] ${sig.id} — No open position for ${posKey}, skipping`);
      continue;
    }

    const contracts = pos.contracts;
    const exitFee = contracts * 2 * tradingFee;
    capital -= exitFee;
    totalFees += exitFee;

    // P&L calculation for spread trading:
    // Entry: we bet spread will revert to mean
    // If entry z > 0 (spread wide), we short the spread → profit when spread narrows
    // If entry z < 0 (spread narrow), we long the spread → profit when spread widens
    const entryZ = pos.entrySignal.z_score;
    const exitZ = sig.z_score;

    // Approximate P&L: each contract profits from spread convergence
    // Spread change * contracts = raw P&L (in prediction market terms, ~$1 per contract per point)
    const spreadChange = Math.abs(pos.entrySpread) - Math.abs(sig.spread);

    // For mean reversion: profit if z moved toward 0
    const zImprovement = Math.abs(entryZ) - Math.abs(exitZ);

    // P&L model: each contract earns proportional to z-score improvement
    // Kalshi contracts are $0-$1, so movement is in cents. Scale by 0.01 per z-point per contract.
    const rawPnl = zImprovement * contracts * 0.50; // $0.50 per z-point per contract
    const tradePnl = rawPnl - exitFee;
    capital += rawPnl;

    const isWin = tradePnl > 0;
    const isStop = sig.type === 'STOP';
    const holdTimeMs = new Date(sig.timestamp) - new Date(pos.entryTime);
    const holdTimeHours = (holdTimeMs / 3600000).toFixed(1);

    const trade = {
      id: `trade_${completedTrades.length + 1}`,
      entrySignal: pos.entrySignal.id,
      exitSignal: sig.id,
      exitType: sig.type,
      market_a: sig.market_a,
      market_b: sig.market_b,
      cluster: sig.cluster,
      contracts: contracts,
      entryZ: entryZ,
      exitZ: exitZ,
      zImprovement: parseFloat(zImprovement.toFixed(4)),
      entrySpread: pos.entrySpread,
      exitSpread: sig.spread,
      rawPnl: parseFloat(rawPnl.toFixed(4)),
      fees: parseFloat((pos.entryFee + exitFee).toFixed(4)),
      netPnl: parseFloat((rawPnl - pos.entryFee - exitFee).toFixed(4)),
      holdTimeHours: parseFloat(holdTimeHours),
      isWin: isWin,
      isStop: isStop,
      capitalAfter: parseFloat(capital.toFixed(4))
    };
    completedTrades.push(trade);
    openPositions.delete(posKey);

    // Track drawdown
    if (capital > peakCapital) peakCapital = capital;
    const currentDrawdown = peakCapital - capital;
    const currentDrawdownPct = (currentDrawdown / peakCapital) * 100;
    if (currentDrawdownPct > maxDrawdownPct_actual) {
      maxDrawdownPct_actual = currentDrawdownPct;
      maxDrawdown = currentDrawdown;
    }

    // Check circuit breaker
    if (currentDrawdownPct >= maxDrawdownPct) {
      circuitBreakerTriggered = true;
      console.log(`[CIRCUIT BREAKER] Drawdown ${currentDrawdownPct.toFixed(2)}% >= ${maxDrawdownPct}% limit. Trading halted.`);
    }

    const label = isStop ? 'STOP' : 'EXIT';
    const pnlStr = trade.netPnl >= 0 ? `+$${trade.netPnl.toFixed(2)}` : `-$${Math.abs(trade.netPnl).toFixed(2)}`;
    console.log(`[${label}] ${sig.id} | z: ${entryZ.toFixed(2)}→${exitZ.toFixed(2)} | ${pnlStr} | capital=$${capital.toFixed(2)} | hold=${holdTimeHours}h`);
  }
}

// Summary statistics
const wins = completedTrades.filter(t => t.isWin);
const losses = completedTrades.filter(t => !t.isWin);
const stops = completedTrades.filter(t => t.isStop);
const totalPnl = completedTrades.reduce((sum, t) => sum + t.netPnl, 0);
const avgPnl = completedTrades.length > 0 ? totalPnl / completedTrades.length : 0;
const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.netPnl, 0) / losses.length : 0;
const winRate = completedTrades.length > 0 ? (wins.length / completedTrades.length * 100) : 0;
const profitFactor = losses.length > 0 && avgLoss !== 0
  ? Math.abs(wins.reduce((s, t) => s + t.netPnl, 0) / losses.reduce((s, t) => s + t.netPnl, 0))
  : wins.length > 0 ? Infinity : 0;

// Sharpe ratio (simplified: using trade returns)
const returns = completedTrades.map(t => t.netPnl);
const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
const stdReturn = returns.length > 1
  ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1))
  : 0;
const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : 0; // annualized

// Pairs breakdown
const pairStats = {};
for (const t of completedTrades) {
  const pair = `${t.market_a}|${t.market_b}`;
  if (!pairStats[pair]) pairStats[pair] = { trades: 0, wins: 0, pnl: 0, clusters: new Set() };
  pairStats[pair].trades++;
  if (t.isWin) pairStats[pair].wins++;
  pairStats[pair].pnl += t.netPnl;
  pairStats[pair].clusters.add(t.cluster);
}

const pairBreakdown = Object.entries(pairStats).map(([pair, s]) => ({
  pair,
  trades: s.trades,
  wins: s.wins,
  winRate: parseFloat((s.wins / s.trades * 100).toFixed(1)),
  totalPnl: parseFloat(s.pnl.toFixed(4)),
  clusters: [...s.clusters]
}));

// Build result
const result = {
  backtest_id: `bt_${Date.now()}`,
  generated_at: new Date().toISOString(),
  task: 'T568',
  agent: 'dave',
  input: {
    signals_file: 'bob/output/trade_signals.json',
    total_signals: signals.length,
    strategy: signalsData.strategy,
    generated_at: signalsData.generated_at
  },
  config: {
    initialCapital,
    tradingFee,
    maxDrawdownPct,
    pnlModel: 'z-score improvement * $0.50/contract/z-point'
  },
  summary: {
    totalTrades: completedTrades.length,
    wins: wins.length,
    losses: losses.length,
    stopLosses: stops.length,
    winRate: parseFloat(winRate.toFixed(1)),
    totalPnl: parseFloat(totalPnl.toFixed(4)),
    avgPnlPerTrade: parseFloat(avgPnl.toFixed(4)),
    avgWin: parseFloat(avgWin.toFixed(4)),
    avgLoss: parseFloat(avgLoss.toFixed(4)),
    profitFactor: profitFactor === Infinity ? 'Infinity' : parseFloat(profitFactor.toFixed(4)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(4)),
    totalFees: parseFloat(totalFees.toFixed(4)),
    finalCapital: parseFloat(capital.toFixed(4)),
    returnPct: parseFloat(((capital - initialCapital) / initialCapital * 100).toFixed(2)),
    peakCapital: parseFloat(peakCapital.toFixed(4)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
    maxDrawdownPct: parseFloat(maxDrawdownPct_actual.toFixed(2)),
    circuitBreakerTriggered,
    openPositionsRemaining: openPositions.size
  },
  pairBreakdown,
  trades: completedTrades
};

// Write output
const outPath = path.join(__dirname, 'backtest_results.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log('');
console.log('=== BACKTEST SUMMARY ===');
console.log(`Trades: ${result.summary.totalTrades} (${wins.length}W / ${losses.length}L / ${stops.length} stops)`);
console.log(`Win Rate: ${result.summary.winRate}%`);
console.log(`Total P&L: $${result.summary.totalPnl.toFixed(2)}`);
console.log(`Avg P&L/trade: $${result.summary.avgPnlPerTrade.toFixed(2)}`);
console.log(`Total Fees: $${result.summary.totalFees.toFixed(2)}`);
console.log(`Final Capital: $${result.summary.finalCapital.toFixed(2)} (${result.summary.returnPct}%)`);
console.log(`Max Drawdown: ${result.summary.maxDrawdownPct}%`);
console.log(`Sharpe Ratio: ${result.summary.sharpeRatio.toFixed(2)}`);
console.log(`Profit Factor: ${result.summary.profitFactor}`);
console.log(`Circuit Breaker: ${circuitBreakerTriggered ? 'TRIGGERED' : 'Not triggered'}`);
console.log(`Open Positions: ${openPositions.size}`);
console.log('');
console.log('Pair Breakdown:');
for (const p of pairBreakdown) {
  console.log(`  ${p.pair}: ${p.trades} trades, ${p.winRate}% win, $${p.totalPnl.toFixed(2)} P&L`);
}
console.log('');
console.log(`Output: ${outPath}`);
