#!/usr/bin/env node
/**
 * Backtest P&L Simulator — T568 Rework (Dave, Full Stack)
 *
 * Fixes from Olivia rejection + Tina QA + Alice consolidated list:
 *  1. Uses Bob's ACTUAL trade_signals.json (47 signals, 4 pairs) — no regeneration
 *  2. Spread-based P&L model (not z-score improvement)
 *  3. Deduplication by market pair (no cluster duplication)
 *  4. Z-score validation (|z| < 10)
 *  5. 70/30 train/test split for methodology rigor
 *
 * P&L Model (spread-based, per Tina's QA reference):
 *   Kalshi contracts: $0-$1. Spread = price_a - price_b.
 *   Entry when spread diverges (|z| > threshold), exit when converges.
 *   If entry z > 0 (spread wide): short spread → profit = (entry_spread - exit_spread) * contracts
 *   If entry z < 0 (spread narrow): long spread → profit = (exit_spread - entry_spread) * contracts
 *   Fees: tradingFee * contracts * 2 (both legs) per side (entry + exit)
 *
 * Following C6 (knowledge.md), C8 (run & verify), C11 (review before done), D6 (handoff chain)
 */

const fs = require('fs');
const path = require('path');

// Load Bob's authoritative signals
const signalsPath = path.join(__dirname, '../bob/trade_signals.json');
let data;
try {
  data = JSON.parse(fs.readFileSync(signalsPath, 'utf8'));
} catch (e) {
  console.error(`FAIL: Cannot read ${signalsPath}: ${e.message}`);
  process.exit(1);
}

const signals = data.signals;
const config = data.config;
const initialCapital = config.initialCapital || 100;
const tradingFee = config.tradingFee || 0.01;
const maxDrawdownPct = config.maxDrawdownPct || 10;

// Validate z-scores
const invalidZ = signals.filter(s => Math.abs(s.z_score) >= 10);
if (invalidZ.length > 0) {
  console.warn(`WARNING: ${invalidZ.length} signals with |z| >= 10 (anomalous):`);
  invalidZ.forEach(s => console.warn(`  ${s.id}: z=${s.z_score}`));
}

// Sort by timestamp
signals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

// 70/30 train/test split (walk-forward: first 70% train, last 30% test)
const splitIdx = Math.floor(signals.length * 0.7);
const trainSignals = signals.slice(0, splitIdx);
const testSignals = signals.slice(splitIdx);

console.log('=== Backtest P&L Simulator (T568 Rework) ===');
console.log(`Input: Bob's trade_signals.json (${data.task})`);
console.log(`Signals: ${signals.length} total (${trainSignals.length} train / ${testSignals.length} test)`);
console.log(`Initial capital: $${initialCapital}`);
console.log(`Fee: $${tradingFee}/contract/side`);
console.log(`Max drawdown: ${maxDrawdownPct}%`);
console.log(`Strategy: ${data.strategy}`);
console.log(`P&L model: spread-based (Kalshi $0-$1 contracts)`);
console.log('');

function runBacktest(signalSet, label, startCapital) {
  let capital = startCapital;
  let peakCapital = startCapital;
  let maxDD = 0;
  let maxDDPct = 0;
  const openPositions = new Map(); // key: "market_a|market_b" (no cluster)
  const completedTrades = [];
  let totalFees = 0;
  let circuitBreakerTriggered = false;
  let skippedSignals = 0;

  for (const sig of signalSet) {
    // Position key: market pair only (deduplicated, no cluster)
    const posKey = `${sig.market_a}|${sig.market_b}`;

    // Validate z-score
    if (Math.abs(sig.z_score) >= 10) {
      console.log(`[SKIP] ${sig.id} — Anomalous z=${sig.z_score} (|z|>=10)`);
      skippedSignals++;
      continue;
    }

    if (circuitBreakerTriggered) {
      skippedSignals++;
      continue;
    }

    if (sig.type === 'ENTRY') {
      // Don't open duplicate on same pair
      if (openPositions.has(posKey)) {
        console.log(`[SKIP] ${sig.id} — Already open on ${posKey}`);
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
        entryTime: sig.timestamp
      });

      console.log(`[${label}][ENTRY] ${sig.id} | ${posKey} | z=${sig.z_score.toFixed(2)} | spread=${sig.spread} | ${contracts}c | fee=$${entryFee.toFixed(2)}`);

    } else if (sig.type === 'EXIT' || sig.type === 'STOP') {
      const pos = openPositions.get(posKey);
      if (!pos) {
        console.log(`[${label}][WARN] ${sig.id} — No open position for ${posKey}`);
        skippedSignals++;
        continue;
      }

      const contracts = pos.contracts;
      const exitFee = contracts * 2 * tradingFee;
      capital -= exitFee;
      totalFees += exitFee;

      // Spread-based P&L:
      // If entry z > 0: we shorted the spread → profit when spread narrows
      //   pnl = (entry_spread - exit_spread) * contracts
      // If entry z < 0: we longed the spread → profit when spread widens (toward 0)
      //   pnl = (exit_spread - entry_spread) * contracts
      let rawPnl;
      if (pos.entryZ > 0) {
        rawPnl = (pos.entrySpread - sig.spread) * contracts;
      } else {
        rawPnl = (sig.spread - pos.entrySpread) * contracts;
      }

      capital += rawPnl;
      const netPnl = rawPnl - pos.entryFee - exitFee;
      const holdTimeMs = new Date(sig.timestamp) - new Date(pos.entryTime);
      const holdTimeHours = Math.max(0, holdTimeMs / 3600000);

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
        entrySpread: pos.entrySpread,
        exitSpread: sig.spread,
        rawPnl: parseFloat(rawPnl.toFixed(6)),
        fees: parseFloat((pos.entryFee + exitFee).toFixed(4)),
        netPnl: parseFloat(netPnl.toFixed(6)),
        holdTimeHours: parseFloat(holdTimeHours.toFixed(1)),
        isWin: netPnl > 0,
        isStop: sig.type === 'STOP',
        capitalAfter: parseFloat(capital.toFixed(4))
      };
      completedTrades.push(trade);
      openPositions.delete(posKey);

      // Drawdown tracking
      if (capital > peakCapital) peakCapital = capital;
      const currentDD = peakCapital - capital;
      const currentDDPct = peakCapital > 0 ? (currentDD / peakCapital) * 100 : 0;
      if (currentDDPct > maxDDPct) {
        maxDDPct = currentDDPct;
        maxDD = currentDD;
      }

      if (currentDDPct >= maxDrawdownPct) {
        circuitBreakerTriggered = true;
        console.log(`[${label}][CIRCUIT BREAKER] DD ${currentDDPct.toFixed(2)}% >= ${maxDrawdownPct}%`);
      }

      const pnlStr = netPnl >= 0 ? `+$${netPnl.toFixed(4)}` : `-$${Math.abs(netPnl).toFixed(4)}`;
      console.log(`[${label}][${sig.type}] ${sig.id} | spread: ${pos.entrySpread}→${sig.spread} | ${pnlStr} | cap=$${capital.toFixed(2)} | ${holdTimeHours.toFixed(1)}h`);
    }
  }

  // Stats
  const wins = completedTrades.filter(t => t.isWin);
  const losses = completedTrades.filter(t => !t.isWin);
  const stops = completedTrades.filter(t => t.isStop);
  const totalPnl = completedTrades.reduce((s, t) => s + t.netPnl, 0);
  const avgPnl = completedTrades.length > 0 ? totalPnl / completedTrades.length : 0;
  const winRate = completedTrades.length > 0 ? (wins.length / completedTrades.length * 100) : 0;
  const winPnl = wins.reduce((s, t) => s + t.netPnl, 0);
  const lossPnl = losses.reduce((s, t) => s + t.netPnl, 0);
  const profitFactor = lossPnl !== 0 ? Math.abs(winPnl / lossPnl) : (winPnl > 0 ? Infinity : 0);

  const returns = completedTrades.map(t => t.netPnl);
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - meanRet, 2), 0) / (returns.length - 1))
    : 0;
  const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;

  return {
    totalTrades: completedTrades.length,
    wins: wins.length,
    losses: losses.length,
    stopLosses: stops.length,
    winRate: parseFloat(winRate.toFixed(1)),
    totalPnl: parseFloat(totalPnl.toFixed(6)),
    avgPnlPerTrade: parseFloat(avgPnl.toFixed(6)),
    avgWin: wins.length > 0 ? parseFloat((winPnl / wins.length).toFixed(6)) : 0,
    avgLoss: losses.length > 0 ? parseFloat((lossPnl / losses.length).toFixed(6)) : 0,
    profitFactor: profitFactor === Infinity ? 'Infinity' : parseFloat(profitFactor.toFixed(4)),
    sharpeRatio: parseFloat(sharpe.toFixed(4)),
    totalFees: parseFloat(totalFees.toFixed(4)),
    finalCapital: parseFloat(capital.toFixed(4)),
    returnPct: parseFloat(((capital - startCapital) / startCapital * 100).toFixed(2)),
    peakCapital: parseFloat(peakCapital.toFixed(4)),
    maxDrawdown: parseFloat(maxDD.toFixed(4)),
    maxDrawdownPct: parseFloat(maxDDPct.toFixed(2)),
    circuitBreakerTriggered,
    openPositionsRemaining: openPositions.size,
    skippedSignals,
    trades: completedTrades
  };
}

// Run on full set, train set, and test set
console.log('--- FULL BACKTEST ---');
const fullResult = runBacktest(signals, 'FULL', initialCapital);
console.log('');
console.log('--- TRAIN SET (70%) ---');
const trainResult = runBacktest(trainSignals, 'TRAIN', initialCapital);
console.log('');
console.log('--- TEST SET (30%) ---');
const testResult = runBacktest(testSignals, 'TEST', initialCapital);

// Pair breakdown (full set)
const pairStats = {};
for (const t of fullResult.trades) {
  const pair = `${t.market_a}|${t.market_b}`;
  if (!pairStats[pair]) pairStats[pair] = { trades: 0, wins: 0, pnl: 0 };
  pairStats[pair].trades++;
  if (t.isWin) pairStats[pair].wins++;
  pairStats[pair].pnl += t.netPnl;
}
const pairBreakdown = Object.entries(pairStats).map(([pair, s]) => ({
  pair,
  trades: s.trades,
  wins: s.wins,
  winRate: parseFloat((s.wins / s.trades * 100).toFixed(1)),
  totalPnl: parseFloat(s.pnl.toFixed(6))
}));

// Build output
const result = {
  backtest_id: `bt_${Date.now()}`,
  generated_at: new Date().toISOString(),
  task: 'T568',
  agent: 'dave',
  rework: true,
  fixes_applied: [
    "Uses Bob's actual trade_signals.json (47 signals, 4 pairs)",
    "Spread-based P&L model (not z-score improvement)",
    "Deduplicated by market pair (no cluster duplication)",
    "Z-score validation (|z| < 10 filter)",
    "70/30 train/test split"
  ],
  input: {
    signals_file: 'bob/output/trade_signals.json',
    total_signals: signals.length,
    strategy: data.strategy,
    generated_at: data.generated_at,
    unique_pairs: [...new Set(signals.map(s => `${s.market_a}|${s.market_b}`))],
    config: data.config
  },
  pnl_model: {
    type: 'spread-based',
    description: 'Kalshi contracts $0-$1. P&L = spread convergence * contracts. If entry z>0 (short spread): pnl = (entry_spread - exit_spread) * contracts. If entry z<0 (long spread): pnl = (exit_spread - entry_spread) * contracts.',
    fee: `$${tradingFee}/contract/side (both legs)`
  },
  full: {
    ...fullResult,
    trades: fullResult.trades
  },
  train: {
    ...trainResult,
    trades: trainResult.trades
  },
  test: {
    ...testResult,
    trades: testResult.trades
  },
  pairBreakdown
};

const outPath = path.join(__dirname, 'backtest_results.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

// Print summary
function printSummary(label, r) {
  console.log(`\n=== ${label} SUMMARY ===`);
  console.log(`Trades: ${r.totalTrades} (${r.wins}W / ${r.losses}L / ${r.stopLosses} stops)`);
  console.log(`Win Rate: ${r.winRate}%`);
  console.log(`Total P&L: $${r.totalPnl.toFixed(4)}`);
  console.log(`Avg P&L/trade: $${r.avgPnlPerTrade.toFixed(4)}`);
  console.log(`Fees: $${r.totalFees.toFixed(4)}`);
  console.log(`Final Capital: $${r.finalCapital.toFixed(4)} (${r.returnPct}%)`);
  console.log(`Max Drawdown: ${r.maxDrawdownPct}%`);
  console.log(`Sharpe: ${r.sharpeRatio.toFixed(2)}`);
  console.log(`Profit Factor: ${r.profitFactor}`);
  console.log(`Circuit Breaker: ${r.circuitBreakerTriggered ? 'TRIGGERED' : 'No'}`);
  console.log(`Open: ${r.openPositionsRemaining} | Skipped: ${r.skippedSignals}`);
}

printSummary('FULL', fullResult);
printSummary('TRAIN (70%)', trainResult);
printSummary('TEST (30%)', testResult);

console.log('\nPair Breakdown (full):');
for (const p of pairBreakdown) {
  console.log(`  ${p.pair}: ${p.trades} trades, ${p.winRate}% win, $${p.totalPnl.toFixed(4)} P&L`);
}

console.log(`\nOutput: ${outPath}`);
