#!/usr/bin/env node
/**
 * Walk-Forward Validation + Position Sizing — T580/T587
 *
 * Based on Alice's T580 walk_forward_backtest.js with T587 capital floor fix:
 *   - Capital floor at $50 — halts trading if capital drops below
 *   - CIRCUIT_BREAK_CAPITAL_FLOOR event logged to audit trail
 *   - Integrates with credential_manager.js AuditLogger
 *
 * Consumes Bob's signals.json (does NOT regenerate signals).
 *
 * Run: node walk_forward_backtest_v2.js
 * Author: Bob (Backend Engineer) — T587 capital floor patch
 */

const fs = require('fs');
const path = require('path');

// Import capital floor module
let CapitalFloor;
try {
  ({ CapitalFloor } = require('./capital_floor'));
} catch {
  // Fallback inline if module not found
  CapitalFloor = class {
    constructor(opts = {}) { this.floor = opts.floor || 50; this.halted = false; this.haltReason = null; }
    check(capital) {
      if (this.halted) return { ok: false, halted: true, reason: this.haltReason, capital, floor: this.floor };
      if (capital < this.floor) { this.halted = true; this.haltReason = `Capital $${capital.toFixed(2)} below floor $${this.floor}`; return { ok: false, halted: true, reason: this.haltReason, capital, floor: this.floor }; }
      return { ok: true, halted: false, capital, floor: this.floor };
    }
    status() { return { floor: this.floor, halted: this.halted }; }
  };
}

// Import audit logger from credential_manager if available
let AuditLogger;
try {
  ({ AuditLogger } = require('./credential_manager'));
} catch {
  AuditLogger = class {
    constructor() { this.entries = []; }
    log(event, details = {}) { this.entries.push({ timestamp: new Date().toISOString(), event, ...details }); }
  };
}

// --- Configuration ---
const CONFIG = {
  // Walk-forward
  trainRatio: 0.6,
  windowCount: 3,
  // Kelly criterion
  kellyFraction: 0.25,
  maxKellyBet: 0.10,
  // Slippage
  slippageBps: 50,
  tradingFeePct: 0.01,
  // Risk management
  maxDrawdownPct: 15,
  capitalFloor: 50,            // T587: halt trading if capital < $50
  initialCapital: 1000,
  contractValue: 1,
};

// --- Load Signals ---
function loadSignals() {
  const signalPaths = [
    path.join(__dirname, '..', 'bob', 'signals.json'),
    path.join(__dirname, 'signals.json'),
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
  const b = avgWin / avgLoss;
  const q = 1 - winRate;
  const kelly = (winRate * b - q) / b;
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

// --- Simulate Trades in a Window (with T587 capital floor) ---
function simulateWindow(entries, exits, capital, label, auditLogger) {
  let currentCapital = capital;
  let peakCapital = capital;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let circuitBroken = false;
  let circuitBreakReason = null;
  const trades = [];

  // T587: Capital floor check
  const capitalFloor = new CapitalFloor({
    floor: CONFIG.capitalFloor,
    auditLogger,
  });

  let wins = 0, losses = 0, totalWinAmt = 0, totalLossAmt = 0;

  for (const entry of entries) {
    // T587: Check capital floor BEFORE each trade
    const floorCheck = capitalFloor.check(currentCapital, {
      label,
      signal: entry.id,
      pair: `${entry.market_a} / ${entry.market_b}`,
    });
    if (!floorCheck.ok) {
      circuitBroken = true;
      circuitBreakReason = `CAPITAL_FLOOR: ${floorCheck.reason}`;
      console.log(`  *** CAPITAL FLOOR BREACH: $${currentCapital.toFixed(2)} < $${CONFIG.capitalFloor} — halting ***`);
      break;
    }

    // Drawdown circuit breaker (existing)
    const currentDrawdownPct = ((peakCapital - currentCapital) / peakCapital) * 100;
    if (currentDrawdownPct >= CONFIG.maxDrawdownPct) {
      circuitBroken = true;
      circuitBreakReason = `MAX_DRAWDOWN: ${currentDrawdownPct.toFixed(2)}% >= ${CONFIG.maxDrawdownPct}%`;
      if (auditLogger) {
        auditLogger.log('CIRCUIT_BREAK_MAX_DRAWDOWN', {
          drawdownPct: parseFloat(currentDrawdownPct.toFixed(2)),
          threshold: CONFIG.maxDrawdownPct,
          capital: parseFloat(currentCapital.toFixed(2)),
          label,
        });
      }
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
    const rawPnL = (exitPrice - entryPrice) * contracts * 100;
    const fees = contracts * CONFIG.contractValue * CONFIG.tradingFeePct * 2;
    const netPnL = rawPnL - fees;

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

    // T587: Check capital floor AFTER each trade
    const postTradeCheck = capitalFloor.check(currentCapital, {
      label,
      signal: entry.id,
      pair: `${entry.market_a} / ${entry.market_b}`,
      postTrade: true,
    });
    if (!postTradeCheck.ok) {
      circuitBroken = true;
      circuitBreakReason = `CAPITAL_FLOOR: ${postTradeCheck.reason}`;
      console.log(`  *** CAPITAL FLOOR BREACH (post-trade): $${currentCapital.toFixed(2)} < $${CONFIG.capitalFloor} — halting ***`);
      break;
    }
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
    circuitBreakReason,
    capitalFloorStatus: capitalFloor.status(),
    trades,
  };
}

// --- Main ---
function main() {
  console.log('=== Walk-Forward Validation + Capital Floor — T580/T587 ===\n');
  console.log(`Config: ${CONFIG.windowCount} windows, ${(CONFIG.trainRatio*100)}/${((1-CONFIG.trainRatio)*100)} train/test`);
  console.log(`Kelly: ${CONFIG.kellyFraction} fraction, ${(CONFIG.maxKellyBet*100)}% max bet`);
  console.log(`Slippage: ${CONFIG.slippageBps} bps, Fee: ${CONFIG.tradingFeePct*100}%`);
  console.log(`Circuit breakers: ${CONFIG.maxDrawdownPct}% max drawdown, $${CONFIG.capitalFloor} capital floor (T587)`);
  console.log(`Capital: $${CONFIG.initialCapital}\n`);

  const auditLogger = new AuditLogger(path.join(__dirname, 'backtest_audit.jsonl'));

  const { signals } = loadSignals();
  const windows = walkForward(signals);

  console.log(`Walk-forward: ${windows.length} rolling windows\n`);

  const results = [];
  let capital = CONFIG.initialCapital;

  for (const w of windows) {
    const label = w.windowNum ? `Window ${w.windowNum}` : 'Single';

    console.log(`--- ${label} TRAIN (${w.train.length} signals) ---`);
    const trainResult = simulateWindow(w.train, w.exits || [], capital, `${label} Train`, auditLogger);
    console.log(`  Win rate: ${trainResult.winRate}% | Return: ${trainResult.returnPct}% | Max DD: ${trainResult.maxDrawdownPct}%`);

    console.log(`--- ${label} TEST (${w.test.length} signals) ---`);
    const testResult = simulateWindow(w.test, w.exits || [], capital, `${label} Test`, auditLogger);
    console.log(`  Win rate: ${testResult.winRate}% | Return: ${testResult.returnPct}% | Max DD: ${testResult.maxDrawdownPct}%`);

    if (testResult.circuitBroken) {
      console.log(`  *** CIRCUIT BREAKER: ${testResult.circuitBreakReason} ***`);
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
  const anyCapitalFloorBreach = results.some(r => r.test.capitalFloorStatus.halted);

  console.log(`Total test trades: ${allTestTrades}`);
  console.log(`Overall win rate: ${allTestTrades > 0 ? ((allTestWins/allTestTrades)*100).toFixed(1) : 0}%`);
  console.log(`Final capital: $${finalCapital.toFixed(2)} (${totalReturn}% return)`);
  console.log(`Worst drawdown: ${worstDD.toFixed(2)}%`);
  console.log(`Circuit breaker triggered: ${anyCircuitBreak ? 'YES' : 'No'}`);
  console.log(`Capital floor breached: ${anyCapitalFloorBreach ? 'YES — trading halted' : 'No'}`);
  console.log(`Slippage model: ${CONFIG.slippageBps} bps per trade`);
  console.log(`Position sizing: Quarter-Kelly, max ${CONFIG.maxKellyBet*100}% per trade`);

  // Write output
  const output = {
    generated_at: new Date().toISOString(),
    task: 'T580/T587',
    config: CONFIG,
    windows: results.map(r => ({
      train: { ...r.train, trades: r.train.trades.length },
      test: { ...r.test, trades: r.test.trades.length }
    })),
    summary: {
      totalTestTrades: allTestTrades,
      overallWinRate: allTestTrades > 0 ? parseFloat(((allTestWins/allTestTrades)*100).toFixed(1)) : 0,
      initialCapital: CONFIG.initialCapital,
      finalCapital: parseFloat(finalCapital.toFixed(2)),
      totalReturnPct: parseFloat(totalReturn),
      worstDrawdownPct: worstDD,
      circuitBreakerTriggered: anyCircuitBreak,
      capitalFloorBreached: anyCapitalFloorBreach,
      capitalFloor: CONFIG.capitalFloor,
      slippageBps: CONFIG.slippageBps,
      positionSizing: 'quarter-kelly',
    },
    detailedTrades: results.flatMap(r => r.test.trades),
  };

  const outPath = path.join(__dirname, 'walk_forward_results_v2.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to: ${outPath}`);

  return output;
}

main();
