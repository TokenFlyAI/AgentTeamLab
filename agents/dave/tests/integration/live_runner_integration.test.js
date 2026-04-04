#!/usr/bin/env node
/**
 * Integration Tests for live_runner.js
 * Task 281
 *
 * Tests the full signal → risk check → order submission flow.
 * Covers: happy path, risk rejection, paper trading mode, live mode guard.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BACKEND_DIR = path.resolve(__dirname, "../../../bob/backend");
const OUTPUT_DIR = path.resolve(__dirname, "../../../bob/output");
const LIVE_RUNNER = path.join(BACKEND_DIR, "strategies/live_runner.js");
const TRADE_SIGNALS = path.join(OUTPUT_DIR, "trade_signals.json");
const PAPER_TRADE_LOG = path.join(OUTPUT_DIR, "paper_trade_log.json");

const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function log(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

function runTest(name, fn) {
  const start = Date.now();
  try {
    fn();
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

function cleanup() {
  [TRADE_SIGNALS, PAPER_TRADE_LOG].forEach((f) => {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) {
      // ignore
    }
  });
}

function runLiveRunner(env = {}) {
  const mergedEnv = {
    ...process.env,
    KALSHI_API_KEY: "",
    PAPER_TRADING: "1",
    ...env,
  };

  return execSync(`node "${LIVE_RUNNER}" --execute`, {
    encoding: "utf-8",
    cwd: BACKEND_DIR,
    env: mergedEnv,
    timeout: 30000,
  });
}

console.log("=".repeat(70));
console.log("INTEGRATION TEST: live_runner.js");
console.log("=".repeat(70));

// ---------------------------------------------------------------------------
// Test 1: Happy path — signal → risk check → paper trade execution
// ---------------------------------------------------------------------------
runTest("Happy path: signal → risk check → paper trade execution", () => {
  cleanup();

  const stdout = runLiveRunner({ PAPER_TRADING: "1" });

  assert(fs.existsSync(TRADE_SIGNALS), "trade_signals.json should exist");
  const signalsData = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));

  assert(signalsData.signals.length > 0, "Signals should be generated");
  assert(signalsData.executed === true, "Execution flag should be true");
  assert(
    signalsData.executionReport !== undefined,
    "Execution report should be present"
  );

  assert(fs.existsSync(PAPER_TRADE_LOG), "paper_trade_log.json should exist");
  const paperLog = JSON.parse(fs.readFileSync(PAPER_TRADE_LOG, "utf8"));

  assert(
    paperLog.mode === "paper_trading",
    "Paper trade log should have mode='paper_trading'"
  );
  assert(
    Array.isArray(paperLog.trades),
    "Paper trade log should contain a trades array"
  );
  assert(
    paperLog.trades.length > 0,
    "At least one paper trade should be logged"
  );

  const trade = paperLog.trades[0];
  assert(trade.ticker, "Trade should have a ticker");
  assert(trade.side, "Trade should have a side");
  assert(trade.contracts > 0, "Trade should have positive contracts");
  assert(trade.strategy, "Trade should have a strategy");
  assert(trade.timestamp, "Trade should have a timestamp");

  log("INFO", `Happy path: ${paperLog.trades.length} paper trades logged`);
});

// ---------------------------------------------------------------------------
// Test 2: Risk rejection — restrictive limits should block all trades
// ---------------------------------------------------------------------------
runTest("Risk rejection: restrictive limits block all trades", () => {
  cleanup();

  const stdout = runLiveRunner({
    PAPER_TRADING: "1",
    MAX_POSITION_SIZE: "0",
  });

  assert(
    stdout.includes("Risk rejected") || stdout.includes("⚠️  Risk rejected"),
    "Output should indicate risk rejection"
  );
  assert(
    stdout.includes("0 signals") || stdout.includes("skipping execution") || stdout.includes("No signals passed risk checks"),
    "Output should indicate zero approved signals or skipped execution"
  );

  const signalsData = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));

  // Either no execution report, or execution report with 0 executed trades
  if (signalsData.executionReport) {
    assert(
      signalsData.executionReport.executed === 0 ||
        signalsData.executionReport.trades?.length === 0,
      "Execution report should show 0 executed trades"
    );
  }

  // Paper trade log should either not exist or have 0 trades
  if (fs.existsSync(PAPER_TRADE_LOG)) {
    const paperLog = JSON.parse(fs.readFileSync(PAPER_TRADE_LOG, "utf8"));
    assert(
      paperLog.trades.length === 0,
      "Paper trade log should have 0 trades when all rejected"
    );
  }

  log("INFO", "Risk rejection: all trades correctly blocked");
});

// ---------------------------------------------------------------------------
// Test 3: Paper trading mode bypass — no real orders in paper mode
// ---------------------------------------------------------------------------
runTest("Paper trading mode: no real orders, trades logged only", () => {
  cleanup();

  const stdout = runLiveRunner({ PAPER_TRADING: "1" });

  assert(
    stdout.includes("PAPER TRADING MODE"),
    "Output should indicate paper trading mode"
  );
  assert(
    !stdout.includes("LIVE TRADING MODE"),
    "Output should NOT indicate live trading mode when PAPER_TRADING=1"
  );

  const signalsData = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));
  assert(
    signalsData.executionReport.mode === "paper_trading",
    "Execution report mode should be 'paper_trading'"
  );

  log("INFO", "Paper trading mode correctly bypasses live execution");
});

// ---------------------------------------------------------------------------
// Test 4: Live mode guard — PAPER_TRADING=false enters live path
// ---------------------------------------------------------------------------
runTest("Live mode guard: PAPER_TRADING=false enters live execution path", () => {
  cleanup();

  const stdout = runLiveRunner({ PAPER_TRADING: "false" });

  assert(
    stdout.includes("LIVE TRADING MODE"),
    "Output should indicate live trading mode when PAPER_TRADING=false"
  );
  assert(
    !stdout.includes("PAPER TRADING MODE"),
    "Output should NOT indicate paper trading mode when PAPER_TRADING=false"
  );

  const signalsData = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));
  assert(
    signalsData.executed === true,
    "Execution flag should be true in live mode"
  );

  // In live mode, executionReport comes from ExecutionEngine and does NOT
  // have mode: "paper_trading" (that's only set in the paper-trading branch).
  if (signalsData.executionReport) {
    assert(
      signalsData.executionReport.mode !== "paper_trading",
      "Execution report should NOT have mode='paper_trading' in live mode"
    );
  }

  log("INFO", "Live mode guard correctly activated");
});

// ---------------------------------------------------------------------------
// Test 5: Signal confidence threshold (consensus: 0.80 minimum)
// ---------------------------------------------------------------------------
runTest("Signal confidence >= 0.80 threshold", () => {
  cleanup();
  runLiveRunner();

  const signalsData = JSON.parse(fs.readFileSync(TRADE_SIGNALS, "utf8"));
  assert(signalsData.signals.length > 0, "Signals should be generated");

  const lowConfidence = signalsData.signals.filter((s) => s.confidence < 0.80);
  assert(
    lowConfidence.length === 0,
    `Found ${lowConfidence.length} signals below 0.80 confidence threshold`
  );

  log("INFO", `All ${signalsData.signals.length} signals meet confidence threshold`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(70));
console.log("TEST SUMMARY");
console.log("=".repeat(70));
console.log(`Total: ${results.passed + results.failed}`);
console.log(`Passed: ${results.passed} ✅`);
console.log(`Failed: ${results.failed} ❌`);
console.log("=".repeat(70));

const resultFile = path.join(__dirname, "live_runner_integration_results.json");
fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));
console.log(`\nResults written to: ${resultFile}`);

process.exit(results.failed > 0 ? 1 : 0);
