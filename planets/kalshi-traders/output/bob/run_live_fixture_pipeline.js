#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_PHASE1_INPUT = path.join(REPO_ROOT, "output/grace/filtered_markets_live_fixture.json");
const DEFAULT_ARTIFACT_DIR = path.join(REPO_ROOT, "output/bob/t852");
const PIPELINE_SCRIPT = path.join(REPO_ROOT, "output/bob/run_pipeline.js");
const LIVE_RUNNER_SCRIPT = path.join(REPO_ROOT, "output/bob/backend/strategies/live_runner.js");
const TRADE_SIGNALS_PATH = path.join(REPO_ROOT, "output/bob/trade_signals.json");

function readArgValue(flag) {
  const exact = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) {
    return exact.slice(flag.length + 1);
  }

  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }

  return null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function fileTimestamp(filePath) {
  return fs.statSync(filePath).mtime.toISOString();
}

function main() {
  const phase1Input = path.resolve(readArgValue("--phase1-input") || DEFAULT_PHASE1_INPUT);
  const artifactDir = path.resolve(readArgValue("--artifact-dir") || DEFAULT_ARTIFACT_DIR);
  const reportJsonPath = path.join(artifactDir, "live_fixture_e2e_report.json");
  const reportMdPath = path.join(artifactDir, "live_fixture_e2e_report.md");

  fs.mkdirSync(artifactDir, { recursive: true });

  const pipelineCommand = [
    "node",
    PIPELINE_SCRIPT,
    "--phase1-input",
    phase1Input,
    "--artifact-dir",
    artifactDir,
    "--with-signals",
  ];
  execFileSync(pipelineCommand[0], pipelineCommand.slice(1), {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });

  const liveRunnerCommand = [
    "node",
    LIVE_RUNNER_SCRIPT,
    "--market-fixture",
    phase1Input,
  ];
  execFileSync(liveRunnerCommand[0], liveRunnerCommand.slice(1), {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PAPER_TRADING: "false",
    },
    stdio: "inherit",
  });

  const phase1 = readJson(path.join(artifactDir, "markets_filtered.json"));
  const phase2 = readJson(path.join(artifactDir, "market_clusters.json"));
  const phase3 = readJson(path.join(artifactDir, "correlation_pairs.json"));
  const phase4 = readJson(path.join(artifactDir, "pnl_summary.json"));
  const tradeSignals = readJson(TRADE_SIGNALS_PATH);

  const report = {
    generated_at: new Date().toISOString(),
    task: "T852",
    source_fixture: {
      path: phase1Input,
      generated_at: readJson(phase1Input).generated_at || null,
      freshness_marker: fileTimestamp(phase1Input),
    },
    artifacts: {
      phase1: {
        path: path.join(artifactDir, "markets_filtered.json"),
        freshness_marker: fileTimestamp(path.join(artifactDir, "markets_filtered.json")),
        qualifying_markets: phase1.summary.qualifying,
      },
      phase2: {
        path: path.join(artifactDir, "market_clusters.json"),
        freshness_marker: fileTimestamp(path.join(artifactDir, "market_clusters.json")),
        total_clusters: phase2.summary.total_clusters,
      },
      phase3: {
        path: path.join(artifactDir, "correlation_pairs.json"),
        freshness_marker: fileTimestamp(path.join(artifactDir, "correlation_pairs.json")),
        total_pairs: phase3.total_pairs_analyzed,
        arbitrage_opportunities: phase3.arbitrage_opportunities,
      },
      phase4: {
        path: path.join(artifactDir, "pnl_summary.json"),
        freshness_marker: fileTimestamp(path.join(artifactDir, "pnl_summary.json")),
        total_trades: phase4.total_trades,
        total_pnl: phase4.total_pnl,
      },
      trade_signals: {
        path: TRADE_SIGNALS_PATH,
        freshness_marker: fileTimestamp(TRADE_SIGNALS_PATH),
        source: tradeSignals.source,
        market_count: tradeSignals.marketCount,
        signal_count: tradeSignals.signalCount,
        approved_signal_count: tradeSignals.approvedSignalCount,
      },
    },
    run_commands: {
      pipeline: pipelineCommand.join(" "),
      trade_signals: liveRunnerCommand.join(" "),
      rerun_all: `node ${path.join(REPO_ROOT, "output/bob/run_live_fixture_pipeline.js")} --phase1-input ${phase1Input} --artifact-dir ${artifactDir}`,
    },
  };

  writeJson(reportJsonPath, report);
  writeText(
    reportMdPath,
    `# T852 Live Fixture E2E Report\n\n` +
      `- Generated at: ${report.generated_at}\n` +
      `- Phase 1 fixture: \`${phase1Input}\`\n` +
      `- Phase 1 qualifying markets: ${phase1.summary.qualifying}\n` +
      `- Phase 2 clusters: ${phase2.summary.total_clusters}\n` +
      `- Phase 3 pairs: ${phase3.total_pairs_analyzed} (${phase3.arbitrage_opportunities} arbitrage opportunities)\n` +
      `- Phase 4 paper trades: ${phase4.total_trades} (P&L $${Number(phase4.total_pnl).toFixed(2)})\n` +
      `- Trade signals: ${tradeSignals.signalCount} total, ${tradeSignals.approvedSignalCount} approved\n\n` +
      `## Commands\n\n` +
      `- Pipeline: \`${report.run_commands.pipeline}\`\n` +
      `- Trade signals: \`${report.run_commands.trade_signals}\`\n` +
      `- Full rerun: \`${report.run_commands.rerun_all}\`\n`
  );

  console.log(`\nT852 report written to ${reportJsonPath}`);
  console.log(`T852 markdown summary written to ${reportMdPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`T852 live fixture pipeline failed: ${error.message}`);
    process.exit(1);
  }
}
