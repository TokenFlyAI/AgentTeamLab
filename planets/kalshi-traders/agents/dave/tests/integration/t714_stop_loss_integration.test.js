#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DAVE_ROOT = path.resolve(__dirname, "../..");
const RUNNER = path.join(DAVE_ROOT, "output/backend/strategies/live_runner_t714.js");
const DAVE_ARTIFACT_ROOT = path.join(DAVE_ROOT, "output/t714");
const BOB_OUTPUT_ROOT = path.join(REPO_ROOT, "output/bob");
const RESULT_FILE = path.join(__dirname, "t714_stop_loss_integration_results.json");

const trackedFiles = [
  path.join(BOB_OUTPUT_ROOT, "trade_signals.json"),
  path.join(BOB_OUTPUT_ROOT, "paper_trade_log.json"),
  path.join(BOB_OUTPUT_ROOT, "paper_trades.db"),
  path.join(BOB_OUTPUT_ROOT, "run_counter.txt"),
  path.join(DAVE_ARTIFACT_ROOT, "trade_signals.json"),
  path.join(DAVE_ARTIFACT_ROOT, "paper_trade_log.json"),
  path.join(DAVE_ARTIFACT_ROOT, "paper_trades.db"),
  path.join(DAVE_ARTIFACT_ROOT, "runner_stdout.log"),
  path.join(DAVE_ARTIFACT_ROOT, "runner_stderr.log"),
];

const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function log(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function backupFiles() {
  const backups = new Map();
  for (const filePath of trackedFiles) {
    if (fs.existsSync(filePath)) {
      backups.set(filePath, fs.readFileSync(filePath));
    }
  }
  return backups;
}

function restoreFiles(backups) {
  for (const filePath of trackedFiles) {
    if (backups.has(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, backups.get(filePath));
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function seedRunnerState(trades = []) {
  fs.mkdirSync(BOB_OUTPUT_ROOT, { recursive: true });
  fs.mkdirSync(DAVE_ARTIFACT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(BOB_OUTPUT_ROOT, "paper_trades.db"), JSON.stringify(trades, null, 2));
  fs.writeFileSync(path.join(BOB_OUTPUT_ROOT, "run_counter.txt"), "0\n");
}

function runRunner(extraEnv = {}) {
  const run = spawnSync("node", [RUNNER, "--execute"], {
    cwd: DAVE_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      KALSHI_API_KEY: "",
      PAPER_TRADING: "true",
      ...extraEnv,
    },
    timeout: 30000
  });

  if (run.error) {
    throw run.error;
  }
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "runner failed").trim());
  }
  return {
    stdout: run.stdout || "",
    stderr: run.stderr || "",
  };
}

async function runTest(name, fn) {
  const started = Date.now();
  const backups = backupFiles();
  try {
    await fn();
    results.passed += 1;
    results.tests.push({ name, status: "PASS", durationMs: Date.now() - started });
    log("PASS", name);
  } catch (error) {
    results.failed += 1;
    results.tests.push({
      name,
      status: "FAIL",
      durationMs: Date.now() - started,
      error: error.message,
    });
    log("FAIL", `${name}: ${error.message}`);
  } finally {
    restoreFiles(backups);
  }
}

async function main() {
  await runTest("T714 default cap keeps every executed trade within 20% of capital", async () => {
    seedRunnerState([]);
    const { stdout } = runRunner({ PAPER_TRADING_MAX_TRADE_PCT: "0.20" });
    assert(stdout.includes("PAPER TRADING MODE"), "Expected paper trading mode output");

    const report = readJson(path.join(DAVE_ARTIFACT_ROOT, "trade_signals.json"));
    assert(report.t714, "Expected T714 metadata in Dave artifact");
    assert(report.t714.capitalFloorIntegrated === true, "Expected capital-floor integration flag");
    assert(report.executionReport.executed === report.executionReport.trades.length, "Expected executed count to match persisted trades");

    for (const trade of report.executionReport.trades) {
      assert(
        trade.tradeCostCents <= report.t714.maxTradeCostCents,
        `Trade ${trade.ticker} cost ${trade.tradeCostCents} > cap ${report.t714.maxTradeCostCents}`
      );
    }
  });

  await runTest("T714 tiny cap rejects oversized trades and reports zero execution", async () => {
    seedRunnerState([]);
    const { stdout, stderr } = runRunner({ PAPER_TRADING_MAX_TRADE_PCT: "0.00001" });
    assert(
      `${stdout}\n${stderr}`.includes("T714 stop-loss"),
      "Expected explicit stop-loss rejection in process output"
    );

    const report = readJson(path.join(DAVE_ARTIFACT_ROOT, "trade_signals.json"));
    assert(report.executed === false, "Expected executed=false after stop-loss rejection");
    assert(report.executionReport.executed === 0, "Expected zero executed trades");
    assert(report.executionReport.persisted === 0, "Expected zero persisted trades");
    assert(report.executionReport.stopLossRejected >= 1, "Expected at least one stop-loss rejection");
  });

  await runTest("T714 preserves Bob capital-floor halt behavior", async () => {
    fs.mkdirSync(BOB_OUTPUT_ROOT, { recursive: true });
    const breachedDb = [
      {
        id: "pt_floor_breach_seed",
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
    seedRunnerState(breachedDb);

    const { stdout } = runRunner();
    assert(stdout.includes("Capital floor breached"), "Expected capital floor breach log");

    const report = readJson(path.join(DAVE_ARTIFACT_ROOT, "trade_signals.json"));
    assert(report.halted === true, "Expected halted=true");
    assert(report.capitalFloor && report.capitalFloor.breached === true, "Expected breached capital floor metadata");
    assert(report.executionReport.executed === 0, "Expected no executed trades while halted");
    assert(
      typeof report.haltReason === "string" && report.haltReason.includes("capital floor breached"),
      "Expected halt reason to mention capital floor breach"
    );
  });

  fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
  console.log(`Results written to ${RESULT_FILE}`);
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
