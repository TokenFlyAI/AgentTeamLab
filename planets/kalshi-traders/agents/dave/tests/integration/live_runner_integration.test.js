#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const RUNNER = path.resolve(__dirname, "../../../bob/backend/strategies/live_runner.js");
const OUTPUT_DIR = path.resolve(__dirname, "../../../bob/output");
const TRADE_SIGNALS = path.join(OUTPUT_DIR, "trade_signals.json");
const PAPER_TRADE_LOG = path.join(OUTPUT_DIR, "paper_trade_log.json");
const PAPER_TRADES_DB = path.join(OUTPUT_DIR, "paper_trades.db");
const RESULT_FILE = path.resolve(__dirname, "../../output/t714_stop_loss_test_results.json");
const INITIAL_CAPITAL_CENTS = 500000;
const DEFAULT_MAX_TRADE_PCT = 0.20;

const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name, fn) {
  const startedAt = Date.now();
  try {
    fn();
    results.push({ name, status: "PASS", durationMs: Date.now() - startedAt });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      durationMs: Date.now() - startedAt,
      error: error.message,
    });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.bak-dave`;
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runRunner(extraEnv = {}) {
  return execSync(`node "${RUNNER}" --execute`, {
    encoding: "utf8",
    cwd: path.dirname(RUNNER),
    timeout: 30000,
    env: {
      ...process.env,
      KALSHI_API_KEY: "",
      PAPER_TRADING: "true",
      ...extraEnv,
    },
  });
}

runTest("T714 cap proof: every executed paper trade stays within 20% of capital", () => {
  const dbBackup = backupFile(PAPER_TRADES_DB);
  const signalsBackup = backupFile(TRADE_SIGNALS);
  const logBackup = backupFile(PAPER_TRADE_LOG);

  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(PAPER_TRADES_DB, JSON.stringify([], null, 2));
    const stdout = runRunner({ PAPER_TRADING_MAX_TRADE_PCT: String(DEFAULT_MAX_TRADE_PCT) });
    const report = readJson(TRADE_SIGNALS);
    const log = readJson(PAPER_TRADE_LOG);
    const maxTradeCostCents = report.stopLoss.maxTradeCostCents;

    assert(stdout.includes("PAPER TRADING MODE"), "Runner did not enter paper trading mode");
    assert(report.stopLoss.maxTradePct === DEFAULT_MAX_TRADE_PCT, `Expected stop-loss pct ${DEFAULT_MAX_TRADE_PCT}, got ${report.stopLoss.maxTradePct}`);
    assert(report.stopLoss.referenceCapitalCents > 0, "Expected positive stop-loss reference capital");
    assert(log.executed === log.persisted, "Execution report should count only persisted trades");
    assert(Array.isArray(log.trades) && log.trades.length > 0, "Expected at least one executed paper trade");

    for (const trade of log.trades) {
      assert(
        trade.tradeCostCents <= maxTradeCostCents,
        `Trade ${trade.ticker} cost ${trade.tradeCostCents} > cap ${maxTradeCostCents}`
      );
    }
  } finally {
    restoreFile(PAPER_TRADES_DB, dbBackup);
    restoreFile(TRADE_SIGNALS, signalsBackup);
    restoreFile(PAPER_TRADE_LOG, logBackup);
  }
});

runTest("T714 floor compatibility: capital floor halt still blocks all new paper trades", () => {
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
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(PAPER_TRADES_DB, JSON.stringify(breachedDb, null, 2));

    const stdout = runRunner({ PAPER_TRADING_MAX_TRADE_PCT: String(DEFAULT_MAX_TRADE_PCT) });
    const report = readJson(TRADE_SIGNALS);

    assert(stdout.includes("Capital floor breached"), "Expected capital floor breach log");
    assert(report.halted === true, "Expected halted=true");
    assert(report.capitalFloor?.breached === true, "Expected capital floor breach metadata");
    assert(report.executionReport?.executed === 0, "Expected zero executed trades after floor breach");
    assert(report.executionReport?.halted === true, "Expected halted execution report");
  } finally {
    restoreFile(PAPER_TRADES_DB, dbBackup);
    restoreFile(TRADE_SIGNALS, signalsBackup);
    restoreFile(PAPER_TRADE_LOG, logBackup);
  }
});

fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
fs.writeFileSync(
  RESULT_FILE,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      runner: RUNNER,
      tradeSignalsPath: TRADE_SIGNALS,
      paperTradeLogPath: PAPER_TRADE_LOG,
      results,
      passed: results.filter((result) => result.status === "PASS").length,
      failed: results.filter((result) => result.status === "FAIL").length,
    },
    null,
    2
  )
);

const failed = results.filter((result) => result.status === "FAIL");
process.exit(failed.length > 0 ? 1 : 0);
