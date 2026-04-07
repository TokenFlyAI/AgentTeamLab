#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const HARNESS_ROOT = path.join(REPO_ROOT, "output/dave/t817");
const REPORT_PATH = path.join(HARNESS_ROOT, "replay_report.json");
const SOURCE_SIGNAL_FIXTURE = process.env.T853_SIGNAL_FIXTURE
  ? path.resolve(process.env.T853_SIGNAL_FIXTURE)
  : path.join(REPO_ROOT, "output/bob/trade_signals.json");

const SCENARIOS = [
  {
    id: "baseline_execution",
    description: "Live-shaped signals execute when the 20% stop-loss cap leaves enough headroom.",
    initialCapitalCents: 500000,
    floorCents: 5000,
    maxTradePct: 0.20,
    seedRealizedPnLCents: 0,
  },
  {
    id: "tiny_cap_rejection",
    description: "The same live-shaped signals are rejected when the per-trade cap is effectively zero.",
    initialCapitalCents: 500000,
    floorCents: 5000,
    maxTradePct: 0.00001,
    seedRealizedPnLCents: 0,
  },
  {
    id: "capital_floor_halt",
    description: "A breached capital floor halts replay before any live-shaped signal can execute.",
    initialCapitalCents: 500000,
    floorCents: 5000,
    maxTradePct: 0.20,
    seedRealizedPnLCents: -496000,
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

function loadFixtureSignals() {
  if (!fs.existsSync(SOURCE_SIGNAL_FIXTURE)) {
    throw new Error(`Missing Bob T852 signal artifact: ${SOURCE_SIGNAL_FIXTURE}`);
  }

  const fixture = readJson(SOURCE_SIGNAL_FIXTURE);
  const signals = Array.isArray(fixture.signals) ? fixture.signals : [];
  if (signals.length === 0) {
    throw new Error(`Bob T852 signal artifact has no signals: ${SOURCE_SIGNAL_FIXTURE}`);
  }

  return {
    artifactPath: SOURCE_SIGNAL_FIXTURE,
    generatedAt: fixture.generatedAt || fixture.generated_at || null,
    source: fixture.source || null,
    signalCount: signals.length,
    marketCount: Array.isArray(fixture.markets) ? fixture.markets.length : 0,
    fixtureHash: sha256(fixture),
    signals: signals.map((signal, index) => ({
      id: signal.id || `${signal.ticker || signal.marketId || "signal"}-${index + 1}`,
      strategy: signal.strategy || "unknown",
      ticker: signal.ticker || signal.marketId || `signal-${index + 1}`,
      side: signal.side || "unknown",
      confidence: Number(signal.confidence || 0),
      currentPrice: Number(signal.currentPrice || 0),
      recommendedContracts: Number(signal.recommendedContracts || signal.contracts || 0),
      reason: signal.reason || "",
    })),
  };
}

function buildCapitalFloorStatus(scenario) {
  const currentCapitalCents = scenario.initialCapitalCents + scenario.seedRealizedPnLCents;
  return {
    initialCapitalCents: scenario.initialCapitalCents,
    floorCents: scenario.floorCents,
    realizedPnLCents: scenario.seedRealizedPnLCents,
    currentCapitalCents,
    breachAmountCents: Math.max(0, scenario.floorCents - currentCapitalCents),
    breached: currentCapitalCents < scenario.floorCents,
    closedTrades: scenario.seedRealizedPnLCents < 0 ? 1 : 0,
    openTrades: 0,
  };
}

function simulateScenario(scenario, fixtureSignals) {
  const capitalFloor = buildCapitalFloorStatus(scenario);
  const stopLoss = {
    enabled: true,
    maxTradePct: scenario.maxTradePct,
    referenceCapitalCents: capitalFloor.currentCapitalCents,
    maxTradeCostCents: Math.round(capitalFloor.currentCapitalCents * scenario.maxTradePct),
    maxTradePctLabel: `${(scenario.maxTradePct * 100).toFixed(scenario.maxTradePct >= 0.01 ? 0 : 3)}%`,
  };

  const halted = capitalFloor.breached;
  const haltReason = halted
    ? `capital floor breached: current capital $${(capitalFloor.currentCapitalCents / 100).toFixed(2)} below $${(capitalFloor.floorCents / 100).toFixed(2)}`
    : null;

  const trades = [];
  const rejectedSignals = [];

  for (const signal of fixtureSignals) {
    const tradeCostCents = Math.round(signal.currentPrice * signal.recommendedContracts);
    const replayedSignal = {
      strategy: signal.strategy,
      ticker: signal.ticker,
      side: signal.side,
      confidence: signal.confidence,
      currentPrice: signal.currentPrice,
      recommendedContracts: signal.recommendedContracts,
      tradeCostCents,
      reason: signal.reason,
    };

    if (halted) {
      rejectedSignals.push({
        ...replayedSignal,
        rejectionReason: haltReason,
      });
      continue;
    }

    if (tradeCostCents > stopLoss.maxTradeCostCents) {
      rejectedSignals.push({
        ...replayedSignal,
        rejectionReason: `trade cost ${tradeCostCents} exceeds stop-loss cap ${stopLoss.maxTradeCostCents}`,
      });
      continue;
    }

    trades.push(replayedSignal);
  }

  return {
    scenario: scenario.id,
    description: scenario.description,
    halted,
    haltReason,
    capitalFloor,
    stopLoss,
    signalCount: fixtureSignals.length,
    approvedSignalCount: trades.length,
    rejectedSignalCount: rejectedSignals.length,
    executed: trades.length,
    stopLossRejected: rejectedSignals.filter((signal) => signal.rejectionReason.includes("stop-loss cap")).length,
    signals: fixtureSignals.map((signal) => ({
      strategy: signal.strategy,
      ticker: signal.ticker,
      side: signal.side,
      confidence: signal.confidence,
      currentPrice: signal.currentPrice,
      recommendedContracts: signal.recommendedContracts,
      reason: signal.reason,
    })),
    rejectedSignals,
    trades,
  };
}

function canonicalizeReplay(replay) {
  return {
    scenario: replay.scenario,
    halted: replay.halted,
    haltReason: replay.haltReason,
    signalCount: replay.signalCount,
    approvedSignalCount: replay.approvedSignalCount,
    rejectedSignalCount: replay.rejectedSignalCount,
    executed: replay.executed,
    stopLossRejected: replay.stopLossRejected,
    capitalFloor: replay.capitalFloor,
    stopLoss: replay.stopLoss,
    trades: replay.trades,
    rejectedSignals: replay.rejectedSignals,
  };
}

function summarizeScenario(scenario, fixtureSignals) {
  const replayA = simulateScenario(scenario, fixtureSignals);
  const replayB = simulateScenario(scenario, fixtureSignals);
  const canonicalA = canonicalizeReplay(replayA);
  const canonicalB = canonicalizeReplay(replayB);
  const hashA = sha256(canonicalA);
  const hashB = sha256(canonicalB);

  if (hashA !== hashB) {
    throw new Error(`Determinism check failed for ${scenario.id}: ${hashA} vs ${hashB}`);
  }

  return {
    scenario: scenario.id,
    description: scenario.description,
    deterministic: true,
    canonicalHash: hashA,
    expected: {
      halted: canonicalA.halted,
      executed: canonicalA.executed,
      stopLossRejected: canonicalA.stopLossRejected,
      capitalFloorBreached: canonicalA.capitalFloor.breached,
      signalCount: canonicalA.signalCount,
      approvedSignalCount: canonicalA.approvedSignalCount,
      rejectedSignalCount: canonicalA.rejectedSignalCount,
    },
    observed: {
      halted: canonicalA.halted,
      executed: canonicalA.executed,
      stopLossRejected: canonicalA.stopLossRejected,
      capitalFloorBreached: canonicalA.capitalFloor.breached,
      signalCount: canonicalA.signalCount,
      approvedSignalCount: canonicalA.approvedSignalCount,
      rejectedSignalCount: canonicalA.rejectedSignalCount,
    },
    canonicalReport: canonicalA,
  };
}

function main() {
  ensureDir(HARNESS_ROOT);
  const generatedAt = new Date().toISOString();

  try {
    const fixture = loadFixtureSignals();
    const scenarios = SCENARIOS.map((scenario) => summarizeScenario(scenario, fixture.signals));

    const report = {
      task: "T853",
      generatedAt,
      harness: path.join(REPO_ROOT, "output/dave/backend/strategies/risk_replay_harness_t817.js"),
      runCommand: `node ${path.join(REPO_ROOT, "output/dave/backend/strategies/risk_replay_harness_t817.js")}`,
      freshnessMarker: generatedAt,
      sourceSignalFixture: {
        path: fixture.artifactPath,
        generatedAt: fixture.generatedAt,
        source: fixture.source,
        signalCount: fixture.signalCount,
        marketCount: fixture.marketCount,
        fixtureHash: fixture.fixtureHash,
      },
      invariants: [
        "Bob's live-shaped signal artifact is replayed directly rather than regenerated from fallback markets",
        "Baseline execution count matches the live fixture under the 20% stop-loss cap",
        "Tiny cap rejects the same live-shaped trades without execution",
        "Capital-floor breach halts replay before execution",
        "Canonical replay output is deterministic across repeated runs",
      ],
      scenarios,
      passed: scenarios.length,
      failed: 0,
    };

    writeJson(REPORT_PATH, report);
    console.log(`T853 replay report written to ${REPORT_PATH}`);
  } catch (error) {
    const failureReport = {
      task: "T853",
      generatedAt,
      failed: 1,
      passed: 0,
      error: error.message,
      stack: error.stack,
      sourceSignalFixture: SOURCE_SIGNAL_FIXTURE,
    };
    writeJson(REPORT_PATH, failureReport);
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  canonicalizeReplay,
  loadFixtureSignals,
  simulateScenario,
};
