#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DAVE_ROOT = path.join(REPO_ROOT, "agents/dave");
const BOB_OUTPUT_ROOT = path.join(REPO_ROOT, "output/bob");
const DAVE_T714_ROOT = path.join(REPO_ROOT, "output/dave/t714");
const FIXTURE_ROOT = path.join(REPO_ROOT, "agents/dave/output/t817/fixtures");
const HARNESS_ROOT = path.join(REPO_ROOT, "output/dave/t817");
const RUNNER = path.join(REPO_ROOT, "agents/dave/output/backend/strategies/live_runner_t714.js");

const TRACKED_FILES = [
  path.join(BOB_OUTPUT_ROOT, "trade_signals.json"),
  path.join(BOB_OUTPUT_ROOT, "paper_trade_log.json"),
  path.join(BOB_OUTPUT_ROOT, "paper_trades.db"),
  path.join(BOB_OUTPUT_ROOT, "run_counter.txt"),
  path.join(DAVE_T714_ROOT, "trade_signals.json"),
  path.join(DAVE_T714_ROOT, "paper_trade_log.json"),
  path.join(DAVE_T714_ROOT, "paper_trades.db"),
  path.join(DAVE_T714_ROOT, "runner_stdout.log"),
  path.join(DAVE_T714_ROOT, "runner_stderr.log"),
];

const SCENARIOS = [
  {
    id: "baseline_execution",
    description: "Default cap allows paper trades and preserves stop-loss ceiling on every execution.",
    env: {
      PAPER_TRADING_MAX_TRADE_PCT: "0.20",
      PAPER_TRADING_INITIAL_CAPITAL_CENTS: "500000",
      PAPER_TRADING_CAPITAL_FLOOR_CENTS: "5000",
    },
    seedDbFixture: null,
    expected: {
      halted: false,
      executed: 2,
      stopLossRejected: 0,
      capitalFloorBreached: false,
    },
  },
  {
    id: "tiny_cap_rejection",
    description: "Tiny trade cap rejects oversized trades and reports zero execution.",
    env: {
      PAPER_TRADING_MAX_TRADE_PCT: "0.00001",
      PAPER_TRADING_INITIAL_CAPITAL_CENTS: "500000",
      PAPER_TRADING_CAPITAL_FLOOR_CENTS: "5000",
    },
    seedDbFixture: null,
    expected: {
      halted: false,
      executed: 0,
      stopLossRejected: 2,
      capitalFloorBreached: false,
    },
  },
  {
    id: "capital_floor_halt",
    description: "Breached capital floor blocks all new trades and surfaces halt reason.",
    env: {
      PAPER_TRADING_MAX_TRADE_PCT: "0.20",
      PAPER_TRADING_INITIAL_CAPITAL_CENTS: "500000",
      PAPER_TRADING_CAPITAL_FLOOR_CENTS: "5000",
    },
    seedDbFixture: path.join(FIXTURE_ROOT, "capital_floor_breach_db.json"),
    expected: {
      halted: true,
      executed: 0,
      stopLossRejected: 0,
      capitalFloorBreached: true,
    },
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function backupFiles() {
  const backups = new Map();
  for (const filePath of TRACKED_FILES) {
    if (fs.existsSync(filePath)) {
      backups.set(filePath, fs.readFileSync(filePath));
    }
  }
  return backups;
}

function restoreFiles(backups) {
  for (const filePath of TRACKED_FILES) {
    if (backups.has(filePath)) {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, backups.get(filePath));
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function resetRunnerState(seedDbFixture) {
  ensureDir(BOB_OUTPUT_ROOT);
  ensureDir(DAVE_T714_ROOT);

  for (const filePath of TRACKED_FILES) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  fs.writeFileSync(path.join(BOB_OUTPUT_ROOT, "run_counter.txt"), "0");
  if (seedDbFixture) {
    fs.copyFileSync(seedDbFixture, path.join(BOB_OUTPUT_ROOT, "paper_trades.db"));
  } else {
    fs.writeFileSync(path.join(BOB_OUTPUT_ROOT, "paper_trades.db"), "[]\n");
  }
}

function runScenarioOnce(scenario, runIndex) {
  resetRunnerState(scenario.seedDbFixture);

  const run = spawnSync("node", [RUNNER, "--execute"], {
    cwd: DAVE_ROOT,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      KALSHI_API_KEY: "",
      PAPER_TRADING: "true",
      ...scenario.env,
    },
  });

  if (run.error) {
    throw run.error;
  }
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "runner failed").trim());
  }

  const rawReportPath = path.join(DAVE_T714_ROOT, "trade_signals.json");
  const report = readJson(rawReportPath);
  const rawScenarioDir = path.join(HARNESS_ROOT, "runs", scenario.id);
  ensureDir(rawScenarioDir);

  const rawOutput = {
    report,
    stdout: run.stdout || "",
    stderr: run.stderr || "",
  };

  writeJson(path.join(rawScenarioDir, `run_${runIndex}.json`), rawOutput);
  writeJson(path.join(rawScenarioDir, `run_${runIndex}.canonical.json`), canonicalizeReport(report));

  return rawOutput;
}

function canonicalizeReport(report) {
  const executionReport = report.executionReport || {};
  const trades = Array.isArray(executionReport.trades)
    ? executionReport.trades.map((trade) => ({
        ticker: trade.ticker,
        side: trade.side,
        contracts: trade.contracts,
        price: trade.price,
        tradeCostCents: trade.tradeCostCents,
        strategy: trade.strategy,
        confidence: trade.confidence,
      }))
    : [];

  const signals = Array.isArray(report.signals)
    ? report.signals.map((signal) => ({
        strategy: signal.strategy,
        ticker: signal.ticker,
        side: signal.side,
        confidence: signal.confidence,
        currentPrice: signal.currentPrice,
        recommendedContracts: signal.recommendedContracts,
        reason: signal.reason,
      }))
    : [];

  return {
    source: report.source,
    marketCount: report.marketCount,
    signalCount: report.signalCount,
    approvedSignalCount: report.approvedSignalCount,
    rejectedSignalCount: report.rejectedSignalCount,
    halted: report.halted,
    haltReason: report.haltReason || null,
    capitalFloor: report.capitalFloor
      ? {
          initialCapitalCents: report.capitalFloor.initialCapitalCents,
          floorCents: report.capitalFloor.floorCents,
          realizedPnLCents: report.capitalFloor.realizedPnLCents,
          currentCapitalCents: report.capitalFloor.currentCapitalCents,
          breachAmountCents: report.capitalFloor.breachAmountCents,
          breached: report.capitalFloor.breached,
          closedTrades: report.capitalFloor.closedTrades,
          openTrades: report.capitalFloor.openTrades,
        }
      : null,
    stopLoss: report.stopLoss
      ? {
          maxTradePct: report.stopLoss.maxTradePct,
          referenceCapitalCents: report.stopLoss.referenceCapitalCents,
          maxTradeCostCents: report.stopLoss.maxTradeCostCents,
          maxTradePctLabel: report.stopLoss.maxTradePctLabel,
        }
      : null,
    executionReport: {
      mode: executionReport.mode || null,
      executed: executionReport.executed || 0,
      rejected: executionReport.rejected || 0,
      failed: executionReport.failed || 0,
      persisted: executionReport.persisted || 0,
      halted: Boolean(executionReport.halted),
      haltReason: executionReport.haltReason || null,
      stopLossRejected: executionReport.stopLossRejected || 0,
      trades,
    },
    signals,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function assertScenarioInvariants(scenario, canonicalReport, logs) {
  if (scenario.id === "baseline_execution") {
    if (canonicalReport.executionReport.executed <= 0) {
      throw new Error("Expected at least one executed paper trade in baseline scenario");
    }
    for (const trade of canonicalReport.executionReport.trades) {
      if (trade.tradeCostCents > canonicalReport.stopLoss.maxTradeCostCents) {
        throw new Error(`Trade ${trade.ticker} exceeded stop-loss cap`);
      }
    }
    if (!logs.includes("PAPER TRADING MODE")) {
      throw new Error("Expected runner stdout to confirm paper trading mode");
    }
    return;
  }

  if (scenario.id === "tiny_cap_rejection") {
    if (canonicalReport.executionReport.executed !== 0) {
      throw new Error("Expected zero executed trades under tiny cap");
    }
    if (canonicalReport.executionReport.stopLossRejected < 1) {
      throw new Error("Expected at least one stop-loss rejection under tiny cap");
    }
    if (!logs.includes("T714 stop-loss")) {
      throw new Error("Expected stop-loss rejection to be visible in logs");
    }
    return;
  }

  if (scenario.id === "capital_floor_halt") {
    if (!canonicalReport.halted || !canonicalReport.capitalFloor?.breached) {
      throw new Error("Expected capital floor scenario to halt trading");
    }
    if (canonicalReport.executionReport.executed !== 0) {
      throw new Error("Expected capital floor halt to block all executions");
    }
    if (!String(canonicalReport.haltReason || "").includes("capital floor breached")) {
      throw new Error("Expected halt reason to mention capital floor breach");
    }
    if (!logs.includes("Capital floor breached")) {
      throw new Error("Expected capital floor breach to be visible in logs");
    }
  }
}

function summarizeScenario(scenario, runA, runB) {
  const canonicalA = canonicalizeReport(runA.report);
  const canonicalB = canonicalizeReport(runB.report);
  const hashA = sha256(canonicalA);
  const hashB = sha256(canonicalB);
  const deterministic = hashA === hashB;

  if (!deterministic) {
    throw new Error(`Determinism check failed: run hashes differ (${hashA} vs ${hashB})`);
  }

  assertScenarioInvariants(scenario, canonicalA, `${runA.stdout || ""}\n${runA.stderr || ""}`);

  return {
    scenario: scenario.id,
    description: scenario.description,
    deterministic,
    canonicalHash: hashA,
    expected: scenario.expected,
    observed: {
      halted: canonicalA.halted,
      executed: canonicalA.executionReport.executed,
      stopLossRejected: canonicalA.executionReport.stopLossRejected,
      capitalFloorBreached: Boolean(canonicalA.capitalFloor?.breached),
    },
    canonicalReport: canonicalA,
  };
}

function main() {
  ensureDir(HARNESS_ROOT);
  const backups = backupFiles();
  const generatedAt = new Date().toISOString();

  try {
    const scenarios = [];

    for (const scenario of SCENARIOS) {
      const runA = runScenarioOnce(scenario, 1);
      const runB = runScenarioOnce(scenario, 2);
      scenarios.push(summarizeScenario(scenario, runA, runB));
    }

    const report = {
      task: "T817",
      generatedAt,
      runner: RUNNER,
      inputs: {
        runner: RUNNER,
        stopLossWrapper: path.join(REPO_ROOT, "agents/dave/output/backend/strategies/live_runner_t714.js"),
        capitalFloorFixture: path.join(FIXTURE_ROOT, "capital_floor_breach_db.json"),
      },
      invariants: [
        "Baseline execution stays within configured per-trade stop-loss cap",
        "Tiny cap rejects oversized trades and reports zero execution",
        "Capital floor breach halts new trades and surfaces halt reason",
        "Canonical replay output is identical across two consecutive runs per scenario",
      ],
      scenarios,
      passed: scenarios.length,
      failed: 0,
    };

    writeJson(path.join(HARNESS_ROOT, "replay_report.json"), report);
    console.log(`T817 replay report written to ${path.join(HARNESS_ROOT, "replay_report.json")}`);
  } catch (error) {
    const failureReport = {
      task: "T817",
      generatedAt,
      passed: 0,
      failed: 1,
      error: error.message,
      stack: error.stack,
    };
    writeJson(path.join(HARNESS_ROOT, "replay_report.json"), failureReport);
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    restoreFiles(backups);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  canonicalizeReport,
};
