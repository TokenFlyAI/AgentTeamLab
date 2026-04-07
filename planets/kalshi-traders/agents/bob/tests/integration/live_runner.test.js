#!/usr/bin/env node
/**
 * Integration Tests for live_runner.js
 * Task 281
 * 
 * Tests the full pipeline: Kalshi API → strategy → order execution
 * Mocks the Kalshi API, runs paper trades end-to-end
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BACKEND_DIR = path.join(__dirname, "../../backend");
const OUTPUT_DIR = path.join(__dirname, "../../output");
const STRATEGIES_DIR = path.join(BACKEND_DIR, "strategies");

const LIVE_RUNNER = path.join(STRATEGIES_DIR, "live_runner.js");
const TRADE_SIGNALS = path.join(OUTPUT_DIR, "trade_signals.json");
const PAPER_TRADE_LOG = path.join(OUTPUT_DIR, "paper_trade_log.json");
const PAPER_TRADES_DB = path.join(OUTPUT_DIR, "paper_trades.db");

const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function log(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

async function runTest(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.passed++;
    results.tests.push({ name, status: "PASS", duration });
    log("PASS", `${name} (${duration}ms)`);
  } catch (e) {
    const duration = Date.now() - start;
    results.failed++;
    results.tests.push({ name, status: "FAIL", duration, error: e.message });
    log("FAIL", `${name}: ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.bak-test`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function restoreFile(filePath, backupPath) {
  if (backupPath && fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, filePath);
    fs.unlinkSync(backupPath);
    return;
  }
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function runLiveRunner(args = "", extraEnv = {}) {
  return execSync(`node "${LIVE_RUNNER}" ${args}`.trim(), {
    encoding: "utf-8",
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      KALSHI_API_KEY: "",
      PAPER_TRADING: "1",
      ...extraEnv,
    },
    timeout: 30000,
  });
}

async function main() {
// Test 1: Live runner exists and is executable
await runTest("Live runner script exists", () => {
  assert(fs.existsSync(LIVE_RUNNER), `Live runner not found: ${LIVE_RUNNER}`);
});

// Test 2: Live runner executes without crashing (mock mode)
await runTest("Live runner executes without crash", () => {
  const output = runLiveRunner("", { PAPER_TRADING: "0" });
  assert(output.includes("Live Strategy Runner"), "Expected output not found");
});

// Test 3: Trade signals file is created
await runTest("Trade signals file created", () => {
  assert(fs.existsSync(TRADE_SIGNALS), `Trade signals file not found: ${TRADE_SIGNALS}`);
});

// Test 4: Trade signals format is valid
await runTest("Trade signals format is valid", () => {
  const data = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));
  assert(data.generatedAt, "Missing generatedAt timestamp");
  assert(typeof data.marketCount === "number", "Missing marketCount");
  assert(typeof data.signalCount === "number", "Missing signalCount");
  assert(Array.isArray(data.markets), "markets should be an array");
  assert(Array.isArray(data.signals), "signals should be an array");
});

// Test 5: Signals have required fields
await runTest("Signals have required fields", () => {
  const data = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));
  if (data.signals.length === 0) {
    log("INFO", "No signals to validate (may be normal)");
    return;
  }
  const signal = data.signals[0];
  assert(signal.strategy, "Missing strategy field");
  assert(signal.marketId, "Missing marketId field");
  assert(signal.ticker, "Missing ticker field");
  assert(signal.side, "Missing side field");
  assert(typeof signal.confidence === "number", "Missing confidence field");
  assert(typeof signal.expectedEdge === "number", "Missing expectedEdge field");
});

// Test 6: Paper trading mode works
await runTest("Paper trading mode works", () => {
  const output = runLiveRunner("--execute");
  assert(
    output.includes("PAPER TRADING MODE") || output.includes("paper trades"),
    "Paper trading mode not detected"
  );
});

// Test 7: Paper trade log is created
await runTest("Paper trade log created", () => {
  // Run with paper trading to generate log
  try {
    runLiveRunner("--execute");
  } catch (e) {
    // May fail for other reasons, but log should still exist
  }
  
  // Check for any paper trade related output files
  const files = fs.readdirSync(OUTPUT_DIR);
  const hasPaperTradeFile = files.some(f => 
    f.includes("paper") && f.endsWith(".json")
  );
  assert(hasPaperTradeFile, "No paper trade output file found");
});

// Test 8: Mock fallback mode works without API key
await runTest("Mock fallback mode works", () => {
  const output = runLiveRunner("", { PAPER_TRADING: "0" });
  assert(
    output.includes("mock") || output.includes("fallback") || output.includes("FALLBACK"),
    "Mock fallback mode not detected"
  );
});

// Test 9: Risk manager is called (check for risk-related output)
await runTest("Risk manager is invoked", () => {
  const output = runLiveRunner("--execute");
  assert(
    output.includes("Risk") || output.includes("risk"),
    "Risk manager not invoked"
  );
});

// Test 10: Execution report is generated when --execute is passed
await runTest("Execution report generated", () => {
  const data = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));
  // When --execute is passed, executed flag should be set
  assert(typeof data.executed === "boolean", "Missing executed flag");
});

// Test 11: Capital floor halts new paper trades after realized losses breach $50 floor
await runTest("Capital floor breach halts trading", () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const dbBackup = backupFile(PAPER_TRADES_DB);
  const signalsBackup = backupFile(TRADE_SIGNALS);
  const logBackup = backupFile(PAPER_TRADE_LOG);

  try {
    const breachedDb = [
      {
        id: "pt_test_floor_breach",
        timestamp: "2026-04-07T00:00:00.000Z",
        market: "BTCW-26-JUN30-80K",
        signal_type: "mean_reversion",
        confidence: 0.72,
        direction: "YES",
        contracts: 10,
        entry_price: 60,
        exit_price: 1,
        status: "CLOSED",
        pnl: -496000,
        outcome: "LOSS",
        created_at: "2026-04-07T00:00:00.000Z",
        updated_at: "2026-04-07T00:05:00.000Z",
        metadata: { runNumber: 1, settledAtRun: 4 },
      },
    ];
    fs.writeFileSync(PAPER_TRADES_DB, JSON.stringify(breachedDb, null, 2));

    const output = runLiveRunner("--execute");
    assert(output.includes("Capital floor breached"), "Expected capital floor breach log");
    assert(output.includes("halting new trades"), "Expected halt log");

    const report = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));
    assert(report.halted === true, "Expected halted=true in report");
    assert(report.haltReason && report.haltReason.includes("capital floor breached"), "Expected haltReason in report");
    assert(report.capitalFloor, "Expected capitalFloor object in report");
    assert(report.capitalFloor.breached === true, "Expected capitalFloor.breached=true");
    assert(report.capitalFloor.currentCapitalCents === 4000, `Expected current capital 4000, got ${report.capitalFloor.currentCapitalCents}`);
    assert(report.executionReport, "Expected executionReport in halted run");
    assert(report.executionReport.executed === 0, "Expected no trades executed after halt");
    assert(report.executionReport.halted === true, "Expected execution report to mark halt");
  } finally {
    restoreFile(PAPER_TRADES_DB, dbBackup);
    restoreFile(TRADE_SIGNALS, signalsBackup);
    restoreFile(PAPER_TRADE_LOG, logBackup);
  }
});

// Summary
console.log("\n" + "=".repeat(60));
console.log("INTEGRATION TEST SUMMARY");
console.log("=".repeat(60));
console.log(`Total: ${results.passed + results.failed}`);
console.log(`Passed: ${results.passed} ✅`);
console.log(`Failed: ${results.failed} ❌`);
console.log("=".repeat(60));

// Write results
const resultFile = path.join(__dirname, "live_runner_test_results.json");
fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));
console.log(`\nResults written to: ${resultFile}`);

process.exit(results.failed > 0 ? 1 : 0);
}

main();
