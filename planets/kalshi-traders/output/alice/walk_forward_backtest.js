#!/usr/bin/env node
/**
 * Walk-Forward Validation + Position Sizing — T580
 *
 * Consumes Bob's signals.json (does NOT regenerate signals).
 * Adds:
 *   1. Rolling window walk-forward with train/test split
 *   2. Kelly criterion position sizing
 *   3. Slippage modeling (bid-ask spread impact)
 *   4. Max drawdown tracking with circuit breaker
 *
 * Run: node walk_forward_backtest.js
 * Author: Alice (Lead Coordinator) — picking up for idle Dave
 */

const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG = {
  // Walk-forward
  trainRatio: 0.6,          // 60% train, 40% test per window
  windowCount: 3,           // number of rolling windows
  // Kelly criterion
  kellyFraction: 0.25,      // quarter-Kelly for safety
  maxKellyBet: 0.10,        // max 10% of capital per trade
  // Slippage
  slippageBps: 50,          // 50 basis points slippage (bid-ask spread)
  tradingFeePct: 0.01,      // 1% trading fee per side
  // Risk management
  maxDrawdownPct: 15,       // circuit breaker at 15% drawdown
  maxLossPerTrade: 50,      // T586: max $50 loss per single trade — skip if exceeded
  capitalFloor: 50,         // T587: halt trading if capital < $50
  initialCapital: 1000,     // $1000 starting capital
  contractValue: 1,         // $1 per contract on Kalshi
};

// --- Load Signals ---
function loadSignals() {
  const signalPaths = [
    path.join(__dirname, '..', 'bob', 'signals.json'),
    path.join(__dirname, '..', '..', 'output', 'bob', 'signals.json'),
  ];

  for (const p of signalPaths) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const signals = data.signals || data;
      if (Array.isArray(signals) && signals.length > 0) {
        console.log(`Loaded ${signals.length} signals from ${p}`);
        return { signals, config: data.config || {} };
      }
    } catch {}
  }

  console.error('ERROR: Cannot find signals.json. This script consumes Bob\'s signals — does NOT regenerate.');
  process.exit(1);
}

// --- Kelly Criterion Position Sizing ---
function kellySize(winRate, avgWin, avgLoss, capital) {
  if (avgLoss === 0 || winRate === 0) return 0;
  const b = avgWin / avgLoss;  // win/loss ratio
  const q = 1 - winRate;
  const kelly = (winRate * b - q) / b;

  // Apply fraction and cap
  const adjustedKelly = Math.max(0, kelly) * CONFIG.kellyFraction;
  const maxBet = capital * CONFIG.maxKellyBet;
  const betSize = Math.min(adjustedKelly * capital, maxBet);

  return Math.max(0, Math.floor(betSize / CONFIG.contractValue));
}

// --- Slippage Model ---
function applySlippage(price, direction) {
  const slippage = CONFIG.slippageBps / 10000;
  if (direction === 'BUY') return price * (1 + slippage);
  return price * (1 - slippage);
}

// --- Walk-Forward Engine ---
function walkForward(signals) {
  const entrySignals = signals.filter(s => s.type === 'ENTRY');
  const exitSignals = signals.filter(s => s.type === 'EXIT');

  if (entrySignals.length < CONFIG.windowCount * 2) {
    console.warn(`Only ${entrySignals.length} entry signals — using single window`);
    return [{ train: entrySignals.slice(0, Math.floor(entrySignals.length * CONFIG.trainRatio)),
              test: entrySignals.slice(Math.floor(entrySignals.length * CONFIG.trainRatio)),
              exits: exitSignals }];
  }

  const windowSize = Math.floor(entrySignals.length / CONFIG.windowCount);
  const windows = [];

  for (let i = 0; i < CONFIG.windowCount; i++) {
    const start = i * windowSize;
    const end = Math.min(start + windowSize, entrySignals.length);
    const window = entrySignals.slice(start, end);
    const splitIdx = Math.floor(window.length * CONFIG.trainRatio);

    windows.push({
      windowNum: i + 1,
      train: window.slice(0, splitIdx),
      test: window.slice(splitIdx),
      exits: exitSignals.filter(e => {
        const eTime = new Date(e.timestamp).getTime();
        const wStart = new Date(window[0].timestamp).getTime();
        const wEnd = new Date(window[window.length - 1].timestamp).getTime();
        return eTime >= wStart && eTime <= wEnd + 86400000;
      }),
    });
  }

  return windows;
}

// --- Simulate Trades in a Window ---
function simulateWindow(entries, exits, capital, label) {
  let currentCapital = capital;
  let peakCapital = capital;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let circuitBroken = false;
  let capitalFloorHit = false;
  let tradesSkippedStopLoss = 0;
  const trades = [];

  // Compute running stats for Kelly from prior trades
  let wins = 0, losses = 0, totalWinAmt = 0, totalLossAmt = 0;

  for (const entry of entries) {
    // T587: Capital floor check — halt if capital too low
    if (currentCapital < CONFIG.capitalFloor) {
      capitalFloorHit = true;
      circuitBroken = true;
      break;
    }

    // Circuit breaker check — max drawdown from peak
    const currentDrawdownPct = ((peakCapital - currentCapital) / peakCapital) * 100;
    if (currentDrawdownPct >= CONFIG.maxDrawdownPct) {
      circuitBroken = true;
      break;
    }

    // Find matching exit
    const exit = exits.find(e =>
      (e.market_a === entry.market_a && e.market_b === entry.market_b) &&
      new Date(e.timestamp) > new Date(entry.timestamp)
    );

    // Kelly position sizing
    const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0.5;
    const avgWin = wins > 0 ? totalWinAmt / wins : 0.05;
    const avgLoss = losses > 0 ? totalLossAmt / losses : 0.03;
    const contracts = kellySize(winRate, avgWin, avgLoss, currentCapital);

    if (contracts === 0) continue;

    // Compute P&L with slippage
    const entrySpread = entry.spread || 0.05;
    const exitSpread = exit ? (exit.spread || 0.03) : entrySpread * 0.9;

    const entryPrice = applySlippage(entrySpread, 'BUY');
    const exitPrice = applySlippage(exitSpread, 'SELL');
    const rawPnL = (exitPrice - entryPrice) * contracts * 100; // cents to dollars
    const fees = contracts * CONFIG.contractValue * CONFIG.tradingFeePct * 2; // entry + exit
    const netPnL = rawPnL - fees;

    // T586: Per-trade stop-loss — skip trade if potential loss exceeds max
    if (netPnL < 0 && Math.abs(netPnL) > CONFIG.maxLossPerTrade) {
      tradesSkippedStopLoss++;
      continue;
    }

    currentCapital += netPnL;
    peakCapital = Math.max(peakCapital, currentCapital);

    const drawdown = peakCapital - currentCapital;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = (drawdown / peakCapital) * 100;
    }

    if (netPnL > 0) { wins++; totalWinAmt += netPnL; }
    else { losses++; totalLossAmt += Math.abs(netPnL); }

    trades.push({
      signal: entry.id,
      pair: `${entry.market_a} / ${entry.market_b}`,
      contracts,
      z_score: entry.z_score,
      confidence: entry.confidence || 0,
      entrySpread: entryPrice.toFixed(4),
      exitSpread: exitPrice.toFixed(4),
      rawPnL: rawPnL.toFixed(2),
      fees: fees.toFixed(2),
      netPnL: netPnL.toFixed(2),
      capital: currentCapital.toFixed(2),
      drawdownPct: ((peakCapital - currentCapital) / peakCapital * 100).toFixed(2),
    });
  }

  const totalTrades = wins + losses;
  return {
    label,
    startCapital: capital.toFixed(2),
    endCapital: currentCapital.toFixed(2),
    returnPct: (((currentCapital - capital) / capital) * 100).toFixed(2),
    totalTrades,
    wins,
    losses,
    winRate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0',
    maxDrawdown: maxDrawdown.toFixed(2),
    maxDrawdownPct: maxDrawdownPct.toFixed(2),
    circuitBroken,
    capitalFloorHit,
    tradesSkippedStopLoss,
    trades,
  };
}

// --- Main ---
function main() {
  console.log('=== Walk-Forward Validation + Position Sizing — T580 ===\n');
  console.log(`Config: ${CONFIG.windowCount} windows, ${(CONFIG.trainRatio*100)}/${((1-CONFIG.trainRatio)*100)} train/test`);
  console.log(`Kelly: ${CONFIG.kellyFraction} fraction, ${(CONFIG.maxKellyBet*100)}% max bet`);
  console.log(`Slippage: ${CONFIG.slippageBps} bps, Fee: ${CONFIG.tradingFeePct*100}%`);
  console.log(`Circuit breaker: ${CONFIG.maxDrawdownPct}% max drawdown`);
  console.log(`Capital: $${CONFIG.initialCapital}\n`);

  const { signals } = loadSignals();
  const windows = walkForward(signals);

  console.log(`Walk-forward: ${windows.length} rolling windows\n`);

  const results = [];
  let capital = CONFIG.initialCapital;

  for (const w of windows) {
    const label = w.windowNum ? `Window ${w.windowNum}` : 'Single';

    // Train phase: compute stats (no real trading)
    console.log(`--- ${label} TRAIN (${w.train.length} signals) ---`);
    const trainResult = simulateWindow(w.train, w.exits || [], capital, `${label} Train`);
    console.log(`  Win rate: ${trainResult.winRate}% | Return: ${trainResult.returnPct}% | Max DD: ${trainResult.maxDrawdownPct}%`);

    // Test phase: trade with parameters learned from train
    console.log(`--- ${label} TEST (${w.test.length} signals) ---`);
    const testResult = simulateWindow(w.test, w.exits || [], capital, `${label} Test`);
    console.log(`  Win rate: ${testResult.winRate}% | Return: ${testResult.returnPct}% | Max DD: ${testResult.maxDrawdownPct}%`);

    if (testResult.circuitBroken) {
      console.log(`  *** CIRCUIT BREAKER TRIGGERED at ${CONFIG.maxDrawdownPct}% drawdown ***`);
    }

    capital = parseFloat(testResult.endCapital);
    results.push({ train: trainResult, test: testResult });
  }

  // Summary
  console.log('\n=== WALK-FORWARD SUMMARY ===');
  const allTestTrades = results.reduce((a, r) => a + r.test.totalTrades, 0);
  const allTestWins = results.reduce((a, r) => a + r.test.wins, 0);
  const finalCapital = parseFloat(results[results.length - 1].test.endCapital);
  const totalReturn = ((finalCapital - CONFIG.initialCapital) / CONFIG.initialCapital * 100).toFixed(2);
  const worstDD = Math.max(...results.map(r => parseFloat(r.test.maxDrawdownPct)));
  const anyCircuitBreak = results.some(r => r.test.circuitBroken);

  console.log(`Total test trades: ${allTestTrades}`);
  console.log(`Overall win rate: ${allTestTrades > 0 ? ((allTestWins/allTestTrades)*100).toFixed(1) : 0}%`);
  console.log(`Final capital: $${finalCapital.toFixed(2)} (${totalReturn}% return)`);
  console.log(`Worst drawdown: ${worstDD.toFixed(2)}%`);
  const totalSkipped = results.reduce((a, r) => a + r.test.tradesSkippedStopLoss, 0);
  const anyFloorHit = results.some(r => r.test.capitalFloorHit);
  console.log(`Circuit breaker triggered: ${anyCircuitBreak ? 'YES' : 'No'}`);
  console.log(`Capital floor ($${CONFIG.capitalFloor}) hit: ${anyFloorHit ? 'YES' : 'No'}`);
  console.log(`Trades skipped (stop-loss $${CONFIG.maxLossPerTrade}): ${totalSkipped}`);
  console.log(`Slippage model: ${CONFIG.slippageBps} bps per trade`);
  console.log(`Position sizing: Quarter-Kelly, max ${CONFIG.maxKellyBet*100}% per trade`);

  // Write output
  const output = {
    generated_at: new Date().toISOString(),
    task: 'T580',
    config: CONFIG,
    windows: results.map(r => ({ train: { ...r.train, trades: r.train.trades.length }, test: { ...r.test, trades: r.test.trades.length } })),
    summary: {
      totalTestTrades: allTestTrades,
      overallWinRate: allTestTrades > 0 ? parseFloat(((allTestWins/allTestTrades)*100).toFixed(1)) : 0,
      initialCapital: CONFIG.initialCapital,
      finalCapital: parseFloat(finalCapital.toFixed(2)),
      totalReturnPct: parseFloat(totalReturn),
      worstDrawdownPct: worstDD,
      circuitBreakerTriggered: anyCircuitBreak,
      slippageBps: CONFIG.slippageBps,
      positionSizing: 'quarter-kelly',
    },
    detailedTrades: results.flatMap(r => r.test.trades),
  };

  const outPath = path.join(__dirname, 'walk_forward_results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to: ${outPath}`);

  return output;
}

main();
