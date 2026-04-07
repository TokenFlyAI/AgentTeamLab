#!/usr/bin/env node
/**
 * Pipeline Regression Test — T577 (Tina, QA)
 *
 * Validates the full Sprint 3 pipeline chain end-to-end:
 *   Phase 1: Bob's signal generator produces valid signals.json
 *   Phase 2: Dave's backtest consumes Bob's signals correctly
 *   Phase 3: Cross-component data integrity (signals → backtest → QA)
 *   Phase 4: Grace's data chain audit consistency
 *
 * Run: node pipeline_regression_test.js
 * Expected: All checks PASS. Any FAIL = pipeline regression.
 *
 * Following D5 (continuous improvement), C8 (run & verify), D6 (collaboration quality)
 */

"use strict";

const fs = require("fs");
const path = require("path");

// __dirname resolves through symlink to output/tina/, so go up to planet root then into agents/
const PLANET_ROOT = path.join(__dirname, "../..");
const AGENTS_DIR = path.join(PLANET_ROOT, "agents");
const RESULTS = { pass: 0, fail: 0, warn: 0, details: [] };

function check(name, condition, detail) {
  if (condition) {
    RESULTS.pass++;
    RESULTS.details.push({ name, status: "PASS", detail });
    console.log(`  PASS: ${name}`);
  } else {
    RESULTS.fail++;
    RESULTS.details.push({ name, status: "FAIL", detail });
    console.log(`  FAIL: ${name} — ${detail}`);
  }
}

function warn(name, detail) {
  RESULTS.warn++;
  RESULTS.details.push({ name, status: "WARN", detail });
  console.log(`  WARN: ${name} — ${detail}`);
}

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return null;
  }
}

// ============================================================================
// PHASE 1: Bob's Signal Generator Output
// ============================================================================
console.log("\n=== Phase 1: Bob Signal Generator ===");

const signalsPath = path.join(AGENTS_DIR, "bob/output/trade_signals.json");
const signals = loadJSON(signalsPath);

check("Bob trade_signals.json exists", signals !== null, signalsPath);

if (signals) {
  // Structure checks
  check("Has signals array", Array.isArray(signals.signals), `Type: ${typeof signals.signals}`);
  check("Has config object", signals.config && typeof signals.config === "object", "");
  check("Has metadata (task, strategy)", !!signals.task && !!signals.strategy, `task=${signals.task}`);

  const sigs = signals.signals || [];
  check("Signal count > 0", sigs.length > 0, `Count: ${sigs.length}`);
  check("Signal count matches total_signals", sigs.length === signals.total_signals,
    `Array: ${sigs.length}, total_signals: ${signals.total_signals}`);

  // Signal structure
  const requiredFields = ["id", "timestamp", "type", "action_a", "action_b", "market_a", "market_b", "z_score", "spread", "confidence", "contracts"];
  const firstSig = sigs[0];
  if (firstSig) {
    const missing = requiredFields.filter(f => !(f in firstSig));
    check("Signals have all required fields", missing.length === 0,
      missing.length > 0 ? `Missing: ${missing.join(", ")}` : `All ${requiredFields.length} present`);
  }

  // Sprint 2 optimized params
  const cfg = signals.config || {};
  check("z-score entry threshold = 1.2", cfg.zScoreEntry === 1.2, `Got: ${cfg.zScoreEntry}`);
  check("Lookback period = 10", cfg.lookbackPeriod === 10, `Got: ${cfg.lookbackPeriod}`);
  check("Min confidence >= 0.65", cfg.minConfidence >= 0.65, `Got: ${cfg.minConfidence}`);

  // Signal quality
  const entrySignals = sigs.filter(s => (s.type || "").toUpperCase() === "ENTRY");
  const exitSignals = sigs.filter(s => (s.type || "").toUpperCase() === "EXIT");
  const stopSignals = sigs.filter(s => (s.type || "").toUpperCase().includes("STOP"));
  check("Has entry signals", entrySignals.length > 0, `Entries: ${entrySignals.length}`);
  check("Has exit signals", exitSignals.length > 0, `Exits: ${exitSignals.length}`);

  // Z-score sanity (no anomalous values per QA finding)
  const anomalousZ = sigs.filter(s => Math.abs(s.z_score) > 10);
  check("No anomalous z-scores (|z| > 10)", anomalousZ.length === 0,
    anomalousZ.length > 0 ? `Found ${anomalousZ.length} anomalous` : "All z-scores within bounds");

  // Deduplication check (Q2 fix)
  const pairKeys = new Set();
  sigs.forEach(s => {
    const key = [s.market_a, s.market_b].sort().join(":");
    pairKeys.add(key);
  });
  check("Unique market pairs exist", pairKeys.size > 0, `Pairs: ${pairKeys.size}`);

  // Confidence filter
  const lowConf = sigs.filter(s => s.confidence < 0.65);
  check("All signals meet min confidence", lowConf.length === 0,
    lowConf.length > 0 ? `${lowConf.length} below 0.65` : "All >= 0.65");
}

// ============================================================================
// PHASE 2: Dave's Backtest Results
// ============================================================================
console.log("\n=== Phase 2: Dave Backtest Results ===");

const backtestPath = path.join(AGENTS_DIR, "dave/output/backtest_results.json");
const backtest = loadJSON(backtestPath);

check("Dave backtest_results.json exists", backtest !== null, backtestPath);

if (backtest) {
  // Structure
  check("Has rework flag (fixes applied)", !!backtest.rework, `rework: ${backtest.rework}`);
  check("Has fixes_applied array", Array.isArray(backtest.fixes_applied), "");
  check("Has full results", !!backtest.full, "");
  check("Has train/test split", !!backtest.train && !!backtest.test, "");
  check("Has pnl_model description", !!backtest.pnl_model, `Model: ${backtest.pnl_model}`);

  // P&L model must be spread-based (not z-score improvement)
  const pnlModelStr = typeof backtest.pnl_model === "string"
    ? backtest.pnl_model
    : JSON.stringify(backtest.pnl_model || "");
  check("Uses spread-based P&L model", pnlModelStr.toLowerCase().includes("spread"),
    `Model: ${pnlModelStr.substring(0, 100)}`);

  // Input source must be Bob's signals
  const input = backtest.input || {};
  const inputSource = input.signals_file || input.source || input.file || "";
  check("Input source is Bob's signals", inputSource.includes("bob"),
    `Source: ${inputSource || "unknown"}`);

  // Full results integrity
  const full = backtest.full || {};
  check("Full results have trade count", typeof full.totalTrades === "number", `Trades: ${full.totalTrades}`);
  check("Full results have win rate", typeof full.winRate === "number", `WR: ${full.winRate}`);
  check("Full results have P&L", typeof (full.totalPnl ?? full.totalPnL) === "number",
    `P&L: ${full.totalPnl ?? full.totalPnL}`);

  // Train/test split validation (70/30)
  const train = backtest.train || {};
  const test = backtest.test || {};
  if (train.signalCount && test.signalCount) {
    const totalSigs = train.signalCount + test.signalCount;
    const trainPct = (train.signalCount / totalSigs) * 100;
    check("Train/test split ~70/30", trainPct >= 65 && trainPct <= 75,
      `Train: ${trainPct.toFixed(1)}% (${train.signalCount}/${totalSigs})`);
  }
}

// ============================================================================
// PHASE 3: Cross-Component Consistency
// ============================================================================
console.log("\n=== Phase 3: Cross-Component Consistency ===");

if (signals && backtest) {
  const sigCount = signals.signals?.length || 0;
  const backtestInput = backtest.input || {};
  const backtestSigCount = backtestInput.signalCount || backtestInput.total_signals;

  check("Backtest signal count matches Bob's output",
    backtestSigCount === sigCount,
    `Bob: ${sigCount}, Dave input: ${backtestSigCount}`);

  // Verify backtest uses same config as signal generator
  const sigConfig = signals.config || {};
  if (backtest.full && backtest.full.config) {
    const btConfig = backtest.full.config;
    if (btConfig.zScoreEntry !== undefined) {
      check("Backtest z-score threshold matches signals",
        btConfig.zScoreEntry === sigConfig.zScoreEntry,
        `Signals: ${sigConfig.zScoreEntry}, Backtest: ${btConfig.zScoreEntry}`);
    }
  }

  // Pair consistency: backtest should only trade pairs from signals
  if (backtest.pairBreakdown && signals.signals) {
    const signalPairs = new Set();
    signals.signals.forEach(s => {
      signalPairs.add([s.market_a, s.market_b].sort().join("|"));
    });
    // pairBreakdown may be array or object
    const breakdown = Array.isArray(backtest.pairBreakdown)
      ? backtest.pairBreakdown
      : Object.values(backtest.pairBreakdown || {});
    const backtestPairNames = breakdown.map(p => p.pair || p.name || "").filter(Boolean);
    const unknownPairs = backtestPairNames.filter(p => {
      const normalized = p.split(/[:|]/).sort().join("|");
      return !signalPairs.has(normalized);
    });
    if (unknownPairs.length > 0) {
      warn("Backtest has pairs not in signals", `Unknown: ${unknownPairs.join(", ")}`);
    } else {
      check("All backtest pairs traced to signals", true, `${breakdown.length} pairs verified`);
    }
  }
}

// ============================================================================
// PHASE 4: Grace Data Chain Audit
// ============================================================================
console.log("\n=== Phase 4: Grace Data Chain Audit ===");

const auditPath = path.join(AGENTS_DIR, "grace/output/data_chain_audit.js");
check("Grace data_chain_audit.js exists", fs.existsSync(auditPath), auditPath);

// Check audit report too
const auditReportPath = path.join(AGENTS_DIR, "grace/output/data_chain_audit.md");
check("Grace data_chain_audit.md report exists", fs.existsSync(auditReportPath), auditReportPath);

// ============================================================================
// PHASE 5: QA Artifacts Exist (Tina's own tools)
// ============================================================================
console.log("\n=== Phase 5: QA Artifacts ===");

const qaFiles = [
  { name: "QA backtest validator", path: "tina/output/qa_backtest_validator.js" },
  { name: "QA backtest report", path: "tina/output/qa_backtest_report.md" },
  { name: "QA signal validator", path: "tina/output/qa_signal_validator.js" },
  { name: "QA pipeline smoke test", path: "tina/output/qa_pipeline_smoke_test.js" },
  { name: "QA reference backtest", path: "tina/output/qa_reference_backtest.js" },
];

qaFiles.forEach(f => {
  const fullPath = path.join(AGENTS_DIR, f.path);
  check(`${f.name} exists`, fs.existsSync(fullPath), f.path);
});

// ============================================================================
// PHASE 6: Pipeline Script Runnability
// ============================================================================
console.log("\n=== Phase 6: Pipeline Scripts Syntax Check ===");

const scriptsToCheck = [
  { name: "Bob signal_generator.js", path: path.join(AGENTS_DIR, "bob/output/signal_generator.js") },
  { name: "Dave backtest_signals.js", path: path.join(AGENTS_DIR, "dave/output/backtest_signals.js") },
  { name: "Grace data_chain_audit.js", path: path.join(AGENTS_DIR, "grace/output/data_chain_audit.js") },
];

const { execSync } = require("child_process");
scriptsToCheck.forEach(s => {
  try {
    execSync(`node --check "${s.path}"`, { timeout: 5000, stdio: "pipe" });
    check(`${s.name} syntax valid`, true, "node --check passed");
  } catch (e) {
    const stderr = (e.stderr || "").toString().trim();
    check(`${s.name} syntax valid`, false, stderr.split("\n")[0] || "Syntax error");
  }
});

// ============================================================================
// SUMMARY
// ============================================================================
console.log("\n" + "=".repeat(60));
console.log(`Pipeline Regression Test Summary`);
console.log(`  PASS: ${RESULTS.pass}  |  FAIL: ${RESULTS.fail}  |  WARN: ${RESULTS.warn}`);
console.log("=".repeat(60));

if (RESULTS.fail > 0) {
  console.log("\nFailed checks:");
  RESULTS.details.filter(d => d.status === "FAIL").forEach(d => {
    console.log(`  - ${d.name}: ${d.detail}`);
  });
}

if (RESULTS.warn > 0) {
  console.log("\nWarnings:");
  RESULTS.details.filter(d => d.status === "WARN").forEach(d => {
    console.log(`  - ${d.name}: ${d.detail}`);
  });
}

// Write results JSON
const outputPath = path.join(__dirname, "pipeline_regression_results.json");
fs.writeFileSync(outputPath, JSON.stringify({
  test: "Pipeline Regression Test — T577",
  agent: "tina",
  timestamp: new Date().toISOString(),
  summary: { pass: RESULTS.pass, fail: RESULTS.fail, warn: RESULTS.warn },
  details: RESULTS.details,
}, null, 2));
console.log(`\nResults written to: ${outputPath}`);

process.exit(RESULTS.fail > 0 ? 1 : 0);
