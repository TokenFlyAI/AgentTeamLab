#!/usr/bin/env node
/**
 * QA Pipeline Smoke Test — Validates the full D004 handoff chain
 * Tina (QA) — Sprint 3, D005 (improve pipeline quality)
 *
 * Tests that the pipeline components produce valid, consistent output:
 *   1. Bob's signal_generator.js → trade_signals.json
 *   2. Signal validator (qa_signal_validator checks)
 *   3. Backtest (qa_reference_backtest) → backtest_results.json
 *   4. Cross-component consistency (signal counts, market pairs match)
 *
 * Usage: node qa_pipeline_smoke_test.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// __dirname resolves to output/tina/ (symlink target), so go up to planet root then into agents/
const planetRoot = path.resolve(__dirname, '..', '..');
const agentsDir = path.join(planetRoot, 'agents');
let pass = 0, fail = 0, skip = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === 'SKIP') {
      skip++;
      console.log(`⏭️  SKIP: ${name}`);
    } else {
      pass++;
      console.log(`✅ PASS: ${name}`);
    }
  } catch (e) {
    fail++;
    console.log(`❌ FAIL: ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('=== QA Pipeline Smoke Test ===\n');

// === Phase 1: Check pipeline input files exist ===

test('Bob trade_signals.json exists', () => {
  const p = path.join(agentsDir, 'bob/output/trade_signals.json');
  assert(fs.existsSync(p), `Missing: ${p}`);
});

test('Bob signals.json exists', () => {
  const p = path.join(agentsDir, 'bob/output/signals.json');
  assert(fs.existsSync(p), `Missing: ${p}`);
});

test('Bob signal_generator.js exists', () => {
  const p = path.join(agentsDir, 'bob/output/signal_generator.js');
  assert(fs.existsSync(p), `Missing: ${p}`);
});

// === Phase 2: Validate signal structure ===

let signalData;
test('trade_signals.json is valid JSON', () => {
  const p = path.join(agentsDir, 'bob/output/trade_signals.json');
  signalData = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert(signalData.signals, 'Missing signals array');
});

test('Signal count matches declared total', () => {
  assert(signalData.signals.length === signalData.total_signals,
    `Declared ${signalData.total_signals}, actual ${signalData.signals.length}`);
});

test('Config has required fields', () => {
  const cfg = signalData.config;
  assert(cfg.zScoreEntry, 'Missing zScoreEntry');
  assert(cfg.zScoreExit !== undefined, 'Missing zScoreExit');
  assert(cfg.initialCapital, 'Missing initialCapital');
  assert(cfg.tradingFee !== undefined, 'Missing tradingFee');
});

test('All ENTRY signals have required fields', () => {
  const entries = signalData.signals.filter(s => s.type === 'ENTRY');
  entries.forEach(s => {
    assert(s.id, `Missing id`);
    assert(s.market_a, `${s.id}: missing market_a`);
    assert(s.market_b, `${s.id}: missing market_b`);
    assert(s.z_score !== undefined, `${s.id}: missing z_score`);
    assert(s.confidence !== undefined, `${s.id}: missing confidence`);
    assert(s.contracts, `${s.id}: missing contracts`);
  });
});

test('No anomalous z-scores (|z| > 10)', () => {
  const bad = signalData.signals.filter(s => Math.abs(s.z_score) > 10);
  assert(bad.length === 0, `${bad.length} anomalous: ${bad.map(s => `${s.id}(z=${s.z_score})`).join(', ')}`);
});

test('All entries meet z-score threshold', () => {
  const threshold = signalData.config.zScoreEntry;
  const bad = signalData.signals.filter(s => s.type === 'ENTRY' && Math.abs(s.z_score) < threshold);
  assert(bad.length === 0, `${bad.length} entries below threshold ${threshold}`);
});

test('All entries meet confidence threshold', () => {
  const minConf = signalData.config.minConfidence;
  const bad = signalData.signals.filter(s => s.type === 'ENTRY' && s.confidence < minConf);
  assert(bad.length === 0, `${bad.length} entries below confidence ${minConf}`);
});

// === Phase 3: Run reference backtest ===

let backtestResults;
test('Reference backtest runs without error', () => {
  const cmd = `node ${path.join(__dirname, 'qa_reference_backtest.js')} ${path.join(agentsDir, 'bob/output/trade_signals.json')}`;
  execSync(cmd, { stdio: 'pipe', timeout: 10000 });
});

test('Backtest results file created', () => {
  const p = path.join(__dirname, 'qa_reference_backtest_results.json');
  assert(fs.existsSync(p), 'Missing backtest results');
  backtestResults = JSON.parse(fs.readFileSync(p, 'utf8'));
});

test('Backtest used spread-based P&L model', () => {
  assert(backtestResults.config.pnl_model === 'spread_based',
    `Expected spread_based, got ${backtestResults.config.pnl_model}`);
});

test('Backtest consumed all input signals', () => {
  const consumed = backtestResults.input_signals - backtestResults.summary.skipped_signals;
  assert(consumed === backtestResults.input_signals,
    `Only consumed ${consumed} of ${backtestResults.input_signals}`);
});

test('All completed trades have positive hold time', () => {
  const zeroHold = backtestResults.trades.filter(t => t.holdTimeHours === 0 && t.exitType !== 'STOP');
  // STOPs at entry z >= stopThreshold can have 0 hold (same-tick stop)
  // But EXITs should never have 0 hold
  assert(zeroHold.length === 0,
    `${zeroHold.length} non-stop trades with 0 hold time`);
});

test('Drawdown never exceeds limit', () => {
  const limit = backtestResults.config.maxDrawdownPct;
  const actual = backtestResults.summary.max_drawdown_pct;
  // If circuit breaker works, DD should be near but not far above limit
  assert(actual <= limit + 1,
    `Drawdown ${actual}% exceeds limit ${limit}% by too much`);
});

test('Final capital is consistent with P&L', () => {
  const expected = backtestResults.config.initialCapital + backtestResults.summary.total_pnl;
  const actual = backtestResults.summary.final_capital;
  // Allow small floating point diff
  assert(Math.abs(expected - actual) < 0.10,
    `Capital mismatch: expected $${expected.toFixed(4)}, got $${actual.toFixed(4)}`);
});

// === Phase 4: Cross-component consistency ===

test('Signal generator and backtest use same config', () => {
  const sigCfg = signalData.config;
  const btCfg = backtestResults.config;
  assert(sigCfg.initialCapital === btCfg.initialCapital, 'initialCapital mismatch');
  assert(sigCfg.tradingFee === btCfg.tradingFee, 'tradingFee mismatch');
});

test('Backtest trade market pairs are subset of signal pairs', () => {
  const sigPairs = new Set(signalData.signals.map(s => `${s.market_a}|${s.market_b}`));
  const btPairs = new Set(backtestResults.trades.map(t => `${t.market_a}|${t.market_b}`));
  for (const p of btPairs) {
    assert(sigPairs.has(p), `Backtest pair ${p} not in signals`);
  }
});

// === Phase 5: Check Dave's backtest (if updated) ===

test('Dave backtest_signals.js exists', () => {
  const p = path.join(agentsDir, 'dave/output/backtest_signals.js');
  if (!fs.existsSync(p)) return 'SKIP';
});

test('Dave uses Bob actual signals (no regeneration)', () => {
  const p = path.join(agentsDir, 'dave/output/backtest_signals.js');
  if (!fs.existsSync(p)) return 'SKIP';
  const code = fs.readFileSync(p, 'utf8');
  // Check it reads from bob's output, not generating its own
  const readsBob = code.includes('bob') && (code.includes('trade_signals') || code.includes('signals.json'));
  assert(readsBob, 'Dave code does not reference Bob output — may be regenerating signals');
});

// === Summary ===
console.log(`\n=== RESULTS ===`);
console.log(`${pass} PASS, ${fail} FAIL, ${skip} SKIP`);
console.log(`Verdict: ${fail === 0 ? 'PASS' : 'FAIL'}`);

// Write results
const report = {
  test: 'qa_pipeline_smoke_test.js',
  timestamp: new Date().toISOString(),
  pass, fail, skip,
  verdict: fail === 0 ? 'PASS' : 'FAIL'
};
const outPath = path.join(__dirname, 'qa_pipeline_smoke_results.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Report: ${outPath}`);
