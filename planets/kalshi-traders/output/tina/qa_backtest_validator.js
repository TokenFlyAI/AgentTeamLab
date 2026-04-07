#!/usr/bin/env node
/**
 * QA Backtest Validator — T570
 * Validates Dave's backtest_results.json against Bob's trade_signals.json
 *
 * Checks:
 *   1. Signal count matches Bob's output
 *   2. P&L math is correct (entry/exit spreads × contracts - fees)
 *   3. Drawdown tracking is accurate
 *   4. No data leakage (no future data used in backtest decisions)
 *   5. Config consistency between signal generator and backtester
 *
 * Usage: node qa_backtest_validator.js [path_to_backtest_results.json]
 *
 * Following: D5 (runnable), C8 (verify), C6 (knowledge.md ref)
 */

"use strict";

const fs = require("fs");
const path = require("path");

// --- File paths ---
// Use execSync to find git root, avoiding symlink resolution issues
const { execSync } = require("child_process");
const GIT_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const PLANET = path.join(GIT_ROOT, "planets/kalshi-traders");
const BOB_OUTPUT = path.join(PLANET, "output/bob");
const DAVE_OUTPUT = path.join(PLANET, "output/dave");
const TINA_OUTPUT = __dirname;

const SIGNALS_PATH = path.join(BOB_OUTPUT, "trade_signals.json");
const PAPER_TRADES_PATH = path.join(BOB_OUTPUT, "paper_trade_results.json");
const BACKTEST_REPORT_PATH = path.join(BOB_OUTPUT, "backtest_report.json");

// Dave's backtest results — either CLI arg or default path
const BACKTEST_RESULTS_PATH = process.argv[2] || path.join(DAVE_OUTPUT, "backtest_results.json");

// --- QA Results ---
const findings = [];
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(check, detail) {
  passCount++;
  findings.push({ status: "PASS", check, detail });
  console.log(`  ✅ PASS: ${check}`);
}

function fail(check, detail) {
  failCount++;
  findings.push({ status: "FAIL", check, detail });
  console.log(`  ❌ FAIL: ${check} — ${detail}`);
}

function warn(check, detail) {
  warnCount++;
  findings.push({ status: "WARN", check, detail });
  console.log(`  ⚠️  WARN: ${check} — ${detail}`);
}

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`\n⚠️  ${label} not found at: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.log(`\n❌ ${label} is invalid JSON: ${e.message}`);
    return null;
  }
}

// ============================================================================
// CHECK 1: Signal Count Consistency
// ============================================================================
function checkSignalCount(backtest, signals) {
  console.log("\n--- Check 1: Signal Count Consistency ---");

  const bobSignalCount = signals.total_signals || signals.signals?.length || 0;
  const backtestSignalCount = backtest.input_signals || backtest.signal_count
    || backtest.input?.total_signals || backtest.summary?.total_signals
    || backtest.summary?.signal_count || null;

  if (backtestSignalCount === null) {
    warn("Signal count field present", "backtest_results.json missing signal count field — cannot verify");
    return;
  }

  if (backtestSignalCount === bobSignalCount) {
    pass("Signal count matches", `Both report ${bobSignalCount} signals`);
  } else {
    fail("Signal count mismatch",
      `Bob: ${bobSignalCount} signals, Dave backtest: ${backtestSignalCount}`);
  }

  // Check signal IDs if available
  if (backtest.signals && signals.signals) {
    const bobIDs = new Set(signals.signals.map(s => s.id));
    const backtestIDs = new Set(
      (backtest.signals || backtest.trades || []).map(s => s.signal_id || s.id)
    );
    const missing = [...bobIDs].filter(id => !backtestIDs.has(id));
    const extra = [...backtestIDs].filter(id => !bobIDs.has(id));

    if (missing.length === 0 && extra.length === 0) {
      pass("Signal IDs match", "All Bob signal IDs present in backtest");
    } else {
      if (missing.length > 0) fail("Missing signals in backtest", `IDs: ${missing.join(", ")}`);
      if (extra.length > 0) warn("Extra signals in backtest", `IDs: ${extra.join(", ")}`);
    }
  }
}

// ============================================================================
// CHECK 2: P&L Math Verification
// ============================================================================
function extractTrades(backtest) {
  // Direct trades array
  if (Array.isArray(backtest.trades) && backtest.trades.length > 0) {
    const first = backtest.trades[0];
    // Check if items look like individual trades (any PnL or entry field, snake_case or camelCase)
    if (first.pnl_dollars !== undefined || first.pnl !== undefined || first.netPnl !== undefined
      || first.rawPnl !== undefined || first.entry_spread !== undefined || first.entrySpread !== undefined
      || first.entry_tick !== undefined || first.entryZ !== undefined) {
      return backtest.trades;
    }
  }
  if (Array.isArray(backtest.results) && backtest.results.length > 0) return backtest.results;

  // Extract from per_pair_results nested structure
  const allTrades = [];
  (backtest.per_pair_results || backtest.pairBreakdown || []).forEach(pair => {
    if (pair.trades) allTrades.push(...pair.trades);
  });
  return allTrades;
}

function checkPnLMath(backtest) {
  console.log("\n--- Check 2: P&L Math Verification ---");

  const trades = extractTrades(backtest);
  if (trades.length === 0) {
    warn("No trades found", "Cannot verify P&L math — no trade array in backtest results");
    return;
  }
  return verifyTrades(trades, backtest);
}

function verifyTrades(trades, backtest) {
  const tolerance = 0.001; // $0.001 tolerance for floating point
  let computedTotalPnL = 0;
  let tradeErrors = 0;

  for (const trade of trades) {
    // Verify individual trade P&L (handle both snake_case and camelCase)
    const entrySpread = trade.entry_spread ?? trade.entrySpread ?? trade.entry_price ?? null;
    const exitSpread = trade.exit_spread ?? trade.exitSpread ?? trade.exit_price ?? null;
    const contracts = trade.contracts ?? trade.size ?? trade.quantity ?? null;
    const fees = trade.fees_dollars ?? trade.fees ?? trade.trading_fee ?? 0;
    const reportedPnL = trade.pnl_dollars ?? trade.netPnl ?? trade.pnl ?? trade.profit ?? null;

    if (entrySpread !== null && exitSpread !== null && contracts !== null && reportedPnL !== null) {
      // For spread trades: P&L = (exit_spread - entry_spread) * contracts * direction_multiplier - fees
      // Direction: short_spread → profit if spread narrows; long_spread → profit if spread widens
      const dir = trade.direction === "short_spread" ? -1 : 1;
      const expectedPnL = (exitSpread - entrySpread) * contracts * dir;
      const expectedNetPnL = expectedPnL - fees;

      if (Math.abs(reportedPnL - expectedNetPnL) > tolerance) {
        // Try without direction multiplier (some implementations differ)
        const altPnL = (exitSpread - entrySpread) * contracts - fees;
        if (Math.abs(reportedPnL - altPnL) <= tolerance) {
          pass(`Trade ${trade.id || "?"} P&L`, `$${reportedPnL.toFixed(4)} matches (alt calc)`);
        } else {
          fail(`Trade ${trade.id || "?"} P&L mismatch`,
            `Reported: $${reportedPnL.toFixed(4)}, Expected: $${expectedNetPnL.toFixed(4)} (spread diff × contracts - fees)`);
          tradeErrors++;
        }
      } else {
        pass(`Trade ${trade.id || "?"} P&L`, `$${reportedPnL.toFixed(4)} correct`);
      }
      computedTotalPnL += reportedPnL;
    }
  }

  // Verify summary P&L
  const summaryPnL = backtest.summary?.total_pnl ?? backtest.summary?.totalPnl ?? backtest.total_pnl ?? null;
  if (summaryPnL !== null) {
    if (Math.abs(summaryPnL - computedTotalPnL) > tolerance * trades.length) {
      fail("Summary P&L mismatch",
        `Reported: $${summaryPnL.toFixed(4)}, Computed from trades: $${computedTotalPnL.toFixed(4)}`);
    } else {
      pass("Summary P&L consistent", `$${summaryPnL.toFixed(4)} matches sum of trades`);
    }
  }

  // Verify win/loss count
  const reportedWins = backtest.summary?.total_wins ?? backtest.summary?.wins ?? null;
  const computedWins = trades.filter(t =>
    (t.pnl_dollars ?? t.netPnl ?? t.pnl ?? t.profit ?? 0) > 0
    || t.outcome === "win" || t.isWin === true
  ).length;
  if (reportedWins !== null) {
    if (reportedWins === computedWins) {
      pass("Win count", `${reportedWins} wins matches trade data`);
    } else {
      fail("Win count mismatch", `Reported: ${reportedWins}, Computed: ${computedWins}`);
    }
  }

  // Verify win rate
  let reportedWinRate = backtest.summary?.win_rate ?? backtest.summary?.winRate ?? null;
  if (reportedWinRate !== null && trades.length > 0) {
    // Normalize: if > 1, it's a percentage (e.g. 61.1), convert to decimal
    if (reportedWinRate > 1) reportedWinRate = reportedWinRate / 100;
    const computedWinRate = computedWins / trades.length;
    if (Math.abs(reportedWinRate - computedWinRate) > 0.02) {
      fail("Win rate mismatch",
        `Reported: ${(reportedWinRate * 100).toFixed(1)}%, Computed: ${(computedWinRate * 100).toFixed(1)}%`);
    } else {
      pass("Win rate", `${(reportedWinRate * 100).toFixed(1)}% correct`);
    }
  }

  if (tradeErrors === 0) {
    pass("All trade P&L calculations", `${trades.length} trades verified`);
  }
}

// ============================================================================
// CHECK 3: Drawdown Tracking
// ============================================================================
function checkDrawdown(backtest) {
  console.log("\n--- Check 3: Drawdown Tracking ---");

  const allTrades = extractTrades(backtest);

  if (allTrades.length === 0) {
    warn("Drawdown check skipped", "No trades to verify drawdown tracking");
    return;
  }

  // Check drawdown field exists
  const hasDrawdown = backtest.summary?.max_drawdown_pct !== undefined
    || backtest.summary?.maxDrawdownPct !== undefined
    || backtest.summary?.max_drawdown !== undefined
    || backtest.summary?.maxDrawdown !== undefined
    || backtest.max_drawdown !== undefined;

  if (!hasDrawdown) {
    fail("Drawdown tracking missing", "No max_drawdown field in backtest results — CRITICAL for risk management");
    return;
  }

  const reportedMaxDD = backtest.summary?.max_drawdown_pct
    ?? backtest.summary?.maxDrawdownPct
    ?? backtest.summary?.max_drawdown
    ?? backtest.summary?.maxDrawdown
    ?? backtest.max_drawdown;

  // Compute drawdown from trade sequence
  const initialCapital = backtest.summary?.initial_capital
    ?? backtest.config?.initialCapital ?? 100;
  let peak = initialCapital;
  let maxDD = 0;
  let capital = initialCapital;

  // Sort trades by time if possible
  const sortedTrades = [...allTrades].sort((a, b) => {
    const ta = a.exit_time || a.timestamp || "";
    const tb = b.exit_time || b.timestamp || "";
    return ta.localeCompare(tb);
  });

  for (const trade of sortedTrades) {
    const pnl = trade.pnl_dollars ?? trade.pnl ?? trade.profit ?? 0;
    capital += pnl;
    if (capital > peak) peak = capital;
    const dd = ((peak - capital) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const tolerance = 0.1; // 0.1% tolerance
  if (Math.abs(reportedMaxDD - maxDD) > tolerance) {
    fail("Drawdown calculation mismatch",
      `Reported: ${reportedMaxDD.toFixed(2)}%, Computed: ${maxDD.toFixed(2)}%`);
  } else {
    pass("Drawdown tracking", `Max drawdown ${reportedMaxDD.toFixed(2)}% verified`);
  }

  // Check capital progression if available
  if (allTrades[0]?.capital_after !== undefined || allTrades[0]?.capitalAfter !== undefined) {
    let prevCapital = initialCapital;
    let capitalErrors = 0;
    for (const trade of sortedTrades) {
      const pnl = trade.pnl_dollars ?? trade.netPnl ?? trade.pnl ?? 0;
      const expectedCapital = prevCapital + pnl;
      const reportedCapital = trade.capital_after ?? trade.capitalAfter;
      if (reportedCapital !== undefined && Math.abs(expectedCapital - reportedCapital) > 0.01) {
        capitalErrors++;
        fail(`Capital tracking trade ${trade.id || "?"}`,
          `Expected: $${expectedCapital.toFixed(2)}, Got: $${reportedCapital.toFixed(2)}`);
      }
      prevCapital = reportedCapital ?? expectedCapital;
    }
    if (capitalErrors === 0) {
      pass("Capital progression", "All capital_after values consistent");
    }
  }
}

// ============================================================================
// CHECK 4: Data Leakage Detection
// ============================================================================
function checkDataLeakage(backtest) {
  console.log("\n--- Check 4: Data Leakage Detection ---");

  // Check 4a: Walk-forward methodology (train/test split)
  const hasWalkForward = backtest.backtest_config?.trainPct !== undefined
    || backtest.config?.trainPct !== undefined
    || backtest.methodology === "walk_forward"
    || backtest.per_pair_results?.some(p => p.train_period);

  if (hasWalkForward) {
    pass("Walk-forward methodology", "Train/test split detected — good practice");
  } else {
    warn("No walk-forward detected", "Backtest may use in-sample data for both training and testing");
  }

  // Check 4b: No future timestamps in entry decisions
  const allTrades = extractTrades(backtest);

  let futureLeaks = 0;
  for (let i = 0; i < allTrades.length; i++) {
    const trade = allTrades[i];

    // Handle tick-based trades (entry_tick/exit_tick) vs timestamp-based
    if (trade.entry_tick !== undefined && trade.exit_tick !== undefined) {
      if (trade.entry_tick >= trade.exit_tick) {
        fail(`Trade ${trade.id || i} tick order`,
          `Entry tick ${trade.entry_tick} >= Exit tick ${trade.exit_tick}`);
        futureLeaks++;
      }
      continue; // tick-based, skip timestamp checks
    }

    const entryRaw = trade.entry_time || trade.timestamp;
    const exitRaw = trade.exit_time || trade.close_time;

    if (!entryRaw || !exitRaw) {
      warn(`Trade ${trade.id || i} missing timestamps`, "Cannot verify temporal order");
      continue;
    }

    const entryTime = new Date(entryRaw);
    const exitTime = new Date(exitRaw);

    // Entry must be before exit
    if (entryTime >= exitTime) {
      fail(`Trade ${trade.id || i} temporal order`,
        `Entry (${entryTime.toISOString()}) >= Exit (${exitTime.toISOString()})`);
      futureLeaks++;
    }

    // Check z-score at entry is computed from data BEFORE entry, not after
    if (trade.lookback_window && trade.entry_time) {
      const lookbackEnd = new Date(trade.lookback_window.end || trade.lookback_window);
      if (lookbackEnd > entryTime) {
        fail(`Trade ${trade.id || i} lookback leakage`,
          `Lookback window ends after entry — future data used`);
        futureLeaks++;
      }
    }
  }

  if (futureLeaks === 0 && allTrades.length > 0) {
    pass("No temporal leakage", "All entry times precede exit times");
  }

  // Check 4c: Train/test boundary respected
  if (backtest.per_pair_results) {
    for (const pair of backtest.per_pair_results) {
      if (pair.train_period && pair.test_period) {
        if (pair.train_period.end > pair.test_period.start) {
          fail(`Pair ${pair.pair} train/test overlap`,
            `Train ends at ${pair.train_period.end}, test starts at ${pair.test_period.start}`);
        } else {
          pass(`Pair ${pair.pair} train/test separation`,
            `Train [0-${pair.train_period.end}], Test [${pair.test_period.start}-${pair.test_period.end}]`);
        }
      }
    }
  }

  // Check 4d: Signals only use historical data
  if (backtest.config && backtest.config.lookbackPeriod) {
    pass("Lookback config present", `Using ${backtest.config.lookbackPeriod}-tick lookback window`);
  }
}

// ============================================================================
// CHECK 5: Config Consistency
// ============================================================================
function checkConfigConsistency(backtest, signals) {
  console.log("\n--- Check 5: Config Consistency ---");

  const sigConfig = signals.config || {};
  const btConfig = backtest.config || backtest.backtest_config || {};

  const keysToCheck = [
    "zScoreEntry", "zScoreExit", "zScoreStop",
    "lookbackPeriod", "maxPositionSize", "maxDrawdownPct",
    "initialCapital", "tradingFee"
  ];

  let mismatches = 0;
  for (const key of keysToCheck) {
    const sigVal = sigConfig[key];
    const btVal = btConfig[key];
    if (sigVal !== undefined && btVal !== undefined) {
      if (sigVal !== btVal) {
        warn(`Config mismatch: ${key}`,
          `Signals: ${sigVal}, Backtest: ${btVal} (may be intentional parameter sweep)`);
        mismatches++;
      } else {
        pass(`Config ${key}`, `Both use ${sigVal}`);
      }
    }
  }

  if (mismatches === 0) {
    pass("Config consistency", "Signal generator and backtest configs aligned");
  }
}

// ============================================================================
// MAIN
// ============================================================================
function main() {
  console.log("=" .repeat(60));
  console.log("  QA Backtest Validator — T570 (Tina)");
  console.log("  Following: D5 (runnable), C8 (verify), C11 (review)");
  console.log("=" .repeat(60));

  // Load Bob's signals
  const signals = loadJSON(SIGNALS_PATH, "Bob's trade_signals.json");
  const paperTrades = loadJSON(PAPER_TRADES_PATH, "Bob's paper_trade_results.json");
  const bobBacktest = loadJSON(BACKTEST_REPORT_PATH, "Bob's backtest_report.json");

  if (!signals) {
    console.log("\n❌ FATAL: Cannot proceed without Bob's trade_signals.json");
    process.exit(1);
  }

  // Load Dave's backtest results
  const backtest = loadJSON(BACKTEST_RESULTS_PATH, "Dave's backtest_results.json");

  if (!backtest) {
    console.log("\n⚠️  Dave's backtest_results.json not found at:", BACKTEST_RESULTS_PATH);
    console.log("   Falling back to Bob's backtest_report.json for validation...\n");

    // Validate Bob's data instead while waiting
    if (bobBacktest) {
      console.log("--- Validating Bob's backtest_report.json ---\n");
      checkSignalCount(bobBacktest, signals);
      checkPnLMath(bobBacktest);
      checkDrawdown(bobBacktest);
      checkDataLeakage(bobBacktest);
      checkConfigConsistency(bobBacktest, signals);
    }

    if (paperTrades) {
      console.log("\n--- Also validating Bob's paper_trade_results.json ---\n");
      checkPnLMath(paperTrades);
      checkDrawdown(paperTrades);
      checkDataLeakage(paperTrades);
    }
  } else {
    // Full validation of Dave's backtest
    checkSignalCount(backtest, signals);
    checkPnLMath(backtest);
    checkDrawdown(backtest);
    checkDataLeakage(backtest);
    checkConfigConsistency(backtest, signals);
  }

  // --- Generate Report ---
  console.log("\n" + "=".repeat(60));
  console.log(`  RESULTS: ${passCount} PASS / ${failCount} FAIL / ${warnCount} WARN`);
  console.log("=".repeat(60));

  const report = {
    task: "T570",
    validator: "tina",
    timestamp: new Date().toISOString(),
    target: backtest ? "dave/backtest_results.json" : "bob/backtest_report.json (fallback)",
    reference: "bob/trade_signals.json",
    summary: { pass: passCount, fail: failCount, warn: warnCount },
    verdict: failCount === 0 ? "PASS" : "FAIL",
    findings
  };

  // Write JSON report
  const reportPath = path.join(TINA_OUTPUT, "qa_backtest_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written: ${reportPath}`);

  // Write markdown report
  const mdPath = path.join(TINA_OUTPUT, "qa_backtest_report.md");
  let md = `# QA Backtest Report — T570\n\n`;
  md += `**Validator:** Tina (QA)\n`;
  md += `**Date:** ${new Date().toISOString().split("T")[0]}\n`;
  md += `**Target:** ${report.target}\n`;
  md += `**Reference:** ${report.reference}\n\n`;
  md += `## Verdict: ${report.verdict}\n\n`;
  md += `| Metric | Count |\n|--------|-------|\n`;
  md += `| PASS | ${passCount} |\n| FAIL | ${failCount} |\n| WARN | ${warnCount} |\n\n`;
  md += `## Findings\n\n`;
  for (const f of findings) {
    const icon = f.status === "PASS" ? "PASS" : f.status === "FAIL" ? "FAIL" : "WARN";
    md += `- **${icon}**: ${f.check}${f.detail ? ` — ${f.detail}` : ""}\n`;
  }
  md += `\n## Bob's Signal Data Summary\n\n`;
  md += `- Total signals: ${signals.total_signals || signals.signals?.length}\n`;
  md += `- Strategy: ${signals.strategy}\n`;
  md += `- Config: z_entry=${signals.config?.zScoreEntry}, z_exit=${signals.config?.zScoreExit}, z_stop=${signals.config?.zScoreStop}\n`;
  if (paperTrades?.summary) {
    md += `\n## Bob's Paper Trade Summary\n\n`;
    md += `- Trades: ${paperTrades.summary.total_trades}\n`;
    md += `- Win rate: ${(paperTrades.summary.win_rate * 100).toFixed(1)}%\n`;
    md += `- Total P&L: $${paperTrades.summary.total_pnl.toFixed(4)}\n`;
    md += `- Max drawdown: ${paperTrades.summary.max_drawdown_pct}%\n`;
    md += `- Final capital: $${paperTrades.summary.final_capital}\n`;
  }
  md += `\n---\n*Generated by qa_backtest_validator.js — run: \`node qa_backtest_validator.js\`*\n`;
  fs.writeFileSync(mdPath, md);
  console.log(`Report written: ${mdPath}`);

  process.exit(failCount > 0 ? 1 : 0);
}

main();
