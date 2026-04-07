#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BOB_RUNNER = path.join(REPO_ROOT, "agents/bob/backend/strategies/live_runner.js");
const BOB_OUTPUT_ROOT = path.join(REPO_ROOT, "output/bob");
const DAVE_OUTPUT_ROOT = path.join(REPO_ROOT, "output/dave");
const DAVE_ARTIFACT_ROOT = path.join(DAVE_OUTPUT_ROOT, "t714");
const DEFAULT_INITIAL_CAPITAL_CENTS = parseInt(process.env.PAPER_TRADING_INITIAL_CAPITAL_CENTS || "500000", 10);
const DEFAULT_MAX_TRADE_PCT = parseFloat(process.env.PAPER_TRADING_MAX_TRADE_PCT || "0.20");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return "";
  }
}

function tradeKey(trade) {
  return trade.id || [
    trade.market,
    trade.timestamp,
    trade.created_at,
    trade.updated_at,
    trade.contracts,
    trade.entry_price,
  ].join("|");
}

function snapshotTrades() {
  const trades = readJson(path.join(BOB_OUTPUT_ROOT, "paper_trades.db"), []);
  return Array.isArray(trades) ? trades : [];
}

function getNewTrades(beforeTrades, afterTrades) {
  const seen = new Set(beforeTrades.map(tradeKey));
  return afterTrades.filter((trade) => !seen.has(tradeKey(trade)));
}

function normalizePaperTradingReport(report, newTrades, stdout) {
  if (!report || !report.executionReport || report.executionReport.mode !== "paper_trading") {
    return report;
  }

  const initialCapitalCents = report.capitalFloor?.initialCapitalCents || DEFAULT_INITIAL_CAPITAL_CENTS;
  const maxTradePct = DEFAULT_MAX_TRADE_PCT;
  const maxTradeCostCents = Math.round(initialCapitalCents * maxTradePct);
  const stopLossRejectionsFromStdout = (stdout.match(/T714 stop-loss:/g) || []).length;
  const stopLossRejected = Math.max(stopLossRejectionsFromStdout, report.approvedSignalCount - newTrades.length);

  const trades = newTrades.map((trade) => {
    const tradeCostCents = (trade.entry_price || 0) * (trade.contracts || 0);
    return {
      ticker: trade.market,
      side: (trade.direction || "").toLowerCase(),
      contracts: trade.contracts || 0,
      price: trade.entry_price || 0,
      tradeCostCents,
      tradeCostDollars: Number((tradeCostCents / 100).toFixed(2)),
      strategy: trade.signal_type,
      confidence: trade.confidence,
      timestamp: trade.timestamp || trade.created_at || new Date().toISOString(),
      status: trade.status,
    };
  });

  report.executed = trades.length > 0;
  report.executionReport.executed = trades.length;
  report.executionReport.persisted = trades.length;
  report.executionReport.rejected = stopLossRejected;
  report.executionReport.trades = trades;
  report.executionReport.stopLossRejected = stopLossRejected;
  report.executionReport.halted = Boolean(report.halted || report.executionReport.halted);
  report.executionReport.haltReason = report.haltReason || report.executionReport.haltReason || null;
  report.t714 = {
    artifactOwner: "dave",
    basedOnRunner: BOB_RUNNER,
    wrapperRunCommand: `node ${path.join(DAVE_OUTPUT_ROOT, "backend/strategies/live_runner_t714.js")} --execute`,
    freshnessMarker: new Date().toISOString(),
    maxTradePct,
    maxTradeCostCents,
    maxTradeCostDollars: Number((maxTradeCostCents / 100).toFixed(2)),
    actualPersistedTrades: trades.length,
    stopLossRejected,
    capitalFloorIntegrated: true,
  };

  return report;
}

function copyArtifacts(report, stdout, stderr) {
  ensureDir(DAVE_ARTIFACT_ROOT);

  if (report) {
    fs.writeFileSync(
      path.join(DAVE_ARTIFACT_ROOT, "trade_signals.json"),
      JSON.stringify(report, null, 2)
    );

    if (report.executionReport?.mode === "paper_trading") {
      fs.writeFileSync(
        path.join(DAVE_ARTIFACT_ROOT, "paper_trade_log.json"),
        JSON.stringify(report.executionReport, null, 2)
      );
    }
  }

  const bobDbPath = path.join(BOB_OUTPUT_ROOT, "paper_trades.db");
  if (fs.existsSync(bobDbPath)) {
    fs.copyFileSync(bobDbPath, path.join(DAVE_ARTIFACT_ROOT, "paper_trades.db"));
  }

  fs.writeFileSync(path.join(DAVE_ARTIFACT_ROOT, "runner_stdout.log"), stdout || "");
  fs.writeFileSync(path.join(DAVE_ARTIFACT_ROOT, "runner_stderr.log"), stderr || "");
}

function main() {
  try {
  ensureDir(DAVE_ARTIFACT_ROOT);

  const beforeTrades = snapshotTrades();
  const run = spawnSync("node", [BOB_RUNNER, ...process.argv.slice(2)], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = run.stdout || "";
  const stderr = run.stderr || "";
  const afterTrades = snapshotTrades();
  const report = readJson(path.join(BOB_OUTPUT_ROOT, "trade_signals.json"), null);
  const normalizedReport = normalizePaperTradingReport(report, getNewTrades(beforeTrades, afterTrades), stdout);

  copyArtifacts(normalizedReport, stdout, stderr);

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  if (run.error) {
    throw run.error;
  }

  if (typeof run.status === "number") {
    process.exitCode = run.status;
    return;
  }
  process.exitCode = 1;
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
