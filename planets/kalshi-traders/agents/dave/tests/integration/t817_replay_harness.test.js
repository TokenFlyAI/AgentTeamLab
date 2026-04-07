#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DAVE_ROOT = path.resolve(__dirname, "../..");
const HARNESS = path.join(DAVE_ROOT, "output/backend/strategies/risk_replay_harness_t817.js");
const REPORT = path.join(DAVE_ROOT, "output/t817/replay_report.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const run = spawnSync("node", [HARNESS], {
    cwd: DAVE_ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: {
      ...process.env,
      KALSHI_API_KEY: "",
      PAPER_TRADING: "true",
    },
  });

  if (run.error) {
    throw run.error;
  }
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "harness failed").trim());
  }

  assert(fs.existsSync(REPORT), `Expected replay report at ${REPORT}`);
  const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));

  assert(report.failed === 0, `Expected zero failed scenarios, got ${report.failed}`);
  assert(Array.isArray(report.scenarios) && report.scenarios.length === 3, "Expected three replay scenarios");

  for (const scenario of report.scenarios) {
    assert(scenario.deterministic === true, `Expected deterministic output for ${scenario.scenario}`);
    assert(scenario.canonicalHash, `Expected canonical hash for ${scenario.scenario}`);
  }

  const baseline = report.scenarios.find((scenario) => scenario.scenario === "baseline_execution");
  assert(baseline, "Missing baseline scenario");
  assert(baseline.observed.executed > 0, "Baseline should execute paper trades");

  const tinyCap = report.scenarios.find((scenario) => scenario.scenario === "tiny_cap_rejection");
  assert(tinyCap, "Missing tiny-cap scenario");
  assert(tinyCap.observed.executed === 0, "Tiny cap should block execution");
  assert(tinyCap.observed.stopLossRejected >= 1, "Tiny cap should reject at least one trade");

  const capitalFloor = report.scenarios.find((scenario) => scenario.scenario === "capital_floor_halt");
  assert(capitalFloor, "Missing capital-floor scenario");
  assert(capitalFloor.observed.halted === true, "Capital floor should halt the run");
  assert(capitalFloor.observed.capitalFloorBreached === true, "Capital floor should be breached");

  console.log("PASS T817 replay harness integration");
}

main();
