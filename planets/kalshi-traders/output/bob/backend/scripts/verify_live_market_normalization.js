#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeMarket, normalizeMarkets } = require("../lib/live_market_normalizer");

const BACKEND_DIR = path.join(__dirname, "..");
const OUTPUT_ROOT = path.join(BACKEND_DIR, "..");
const GENERATED_AT = new Date().toISOString();
const FIXTURE_PATH = path.join(OUTPUT_ROOT, "live_market_normalization_fixture.json");
const REPORT_JSON_PATH = path.join(OUTPUT_ROOT, "live_market_normalization_report.json");
const REPORT_MD_PATH = path.join(OUTPUT_ROOT, "live_market_normalization_report.md");
const GRACE_FIXTURE_PATH = "/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets.json";

const fixtures = {
  generatedAt: GENERATED_AT,
  source: "bob_t814_live_market_normalization_fixture",
  cases: [
    {
      name: "snake_case_full_market",
      input: {
        id: "live-1",
        ticker: "KXBTC-26DEC31-T110000",
        title: "Will Bitcoin close above $110,000 on Dec 31, 2026?",
        category: "Crypto",
        status: "active",
        yes_bid: 42,
        yes_ask: 46,
        no_bid: 54,
        no_ask: 58,
        volume: 125000,
        open_interest: 4800,
        series_ticker: "KXBTC-26DEC31",
        event_ticker: "KXBTC",
        floor_strike: 110000,
        strike_type: "greater_than",
        close_date: "2026-12-31T15:00:00Z",
      },
    },
    {
      name: "camel_case_partial_market",
      input: {
        marketId: "live-2",
        marketTicker: "KXINF-26JUN-T030",
        name: "Will CPI print above 3.0% in June 2026?",
        marketCategory: "Economics",
        marketStatus: "open",
        yesBid: "31",
        yesAsk: "35",
        volume24h: "88000",
        openInterest: "7000",
        closeDate: "2026-06-12T15:00:00Z",
      },
    },
    {
      name: "malformed_missing_title",
      input: {
        ticker: "BAD-1",
        yes_bid: 20,
        yes_ask: 25,
      },
      expectError: true,
    },
  ],
};

function runFixtureCases() {
  const passed = [];
  const failed = [];

  for (const testCase of fixtures.cases) {
    try {
      const normalized = normalizeMarket(testCase.input, { strict: true, source: "t814_fixture" });
      if (testCase.expectError) {
        failed.push({
          name: testCase.name,
          message: "Expected normalization to fail, but it succeeded",
        });
      } else {
        passed.push({
          name: testCase.name,
          ticker: normalized.ticker,
          yes_mid: normalized.yes_mid,
          no_mid: normalized.no_mid,
          warnings: normalized.metadata.warnings,
        });
      }
    } catch (error) {
      if (testCase.expectError) {
        passed.push({
          name: testCase.name,
          expectedError: error.message,
        });
      } else {
        failed.push({
          name: testCase.name,
          message: error.message,
        });
      }
    }
  }

  return { passed, failed };
}

function runBatchGuardrailCheck() {
  const result = normalizeMarkets(
    [
      fixtures.cases[0].input,
      fixtures.cases[1].input,
      fixtures.cases[2].input,
      {
        ticker: "BAD-2",
        title: "Missing quotes",
      },
    ],
    { strict: true, source: "t814_batch_fixture" }
  );

  return {
    normalizedCount: result.normalized.length,
    errorCount: result.errors.length,
    errors: result.errors,
  };
}

function readGraceFixtureSummary() {
  if (!fs.existsSync(GRACE_FIXTURE_PATH)) {
    return {
      available: false,
      path: GRACE_FIXTURE_PATH,
      note: "Grace Sprint 6 live-data fixture is not present yet; current verifier uses Bob-owned fixture pack.",
    };
  }

  const stat = fs.statSync(GRACE_FIXTURE_PATH);
  const parsed = JSON.parse(fs.readFileSync(GRACE_FIXTURE_PATH, "utf8"));
  return {
    available: true,
    path: GRACE_FIXTURE_PATH,
    mtime: stat.mtime.toISOString(),
    generatedAt: parsed.generated_at || null,
    phase: parsed.phase || null,
    qualifyingMarkets: parsed.summary?.qualifying_markets || parsed.qualifying_markets?.length || 0,
  };
}

function writeArtifact(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

function main() {
  writeArtifact(FIXTURE_PATH, `${JSON.stringify(fixtures, null, 2)}\n`);

  const fixtureResults = runFixtureCases();
  const batchResults = runBatchGuardrailCheck();
  const graceFixture = readGraceFixtureSummary();

  const report = {
    generatedAt: GENERATED_AT,
    task: "T814",
    artifactPaths: {
      fixture: FIXTURE_PATH,
      jsonReport: REPORT_JSON_PATH,
      markdownReport: REPORT_MD_PATH,
    },
    inputs: {
      fixture: FIXTURE_PATH,
      gracePhase1Reference: graceFixture,
    },
    assumptions: [
      "Assume Kalshi contract payout remains 100 cents ($1) per contract until Founder confirms live contract metadata.",
      "Accept both snake_case and camelCase market fields because prior internal adapters emit both shapes.",
      "Derive NO-side bid/ask from YES-side ask/bid complement only when explicit NO-side quotes are missing.",
    ],
    fixtureResults,
    batchResults,
    summary: {
      passedCases: fixtureResults.passed.length,
      failedCases: fixtureResults.failed.length,
      malformedPayloadsRejected: batchResults.errorCount,
      verifierStatus: fixtureResults.failed.length === 0 ? "pass" : "fail",
    },
  };

  writeArtifact(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const markdown = `# Sprint 6 T814 — Live Market Normalization Report

Date: ${GENERATED_AT}
Task: T814
Freshness: generatedAt=${GENERATED_AT}

## Scope

Following C3, C6, C8, C11, C15, C16, and D2, this report verifies the shared normalization layer for live Kalshi-shaped market payloads before T236 credentials land.

## Artifact Package

Artifact: ${REPORT_MD_PATH}
Run: node ${path.join(BACKEND_DIR, "scripts", "verify_live_market_normalization.js")}
Verify: node ${path.join(BACKEND_DIR, "tests", "unit", "live_market_normalizer.test.js")}
Freshness: generatedAt=${GENERATED_AT}
Inputs: ${FIXTURE_PATH}; ${graceFixture.path}
Expected: verifierStatus=pass, 2 valid fixtures normalized, malformed payloads rejected with explicit errors

## Assumptions

- Contract payout is modeled as 100 cents per contract and marked unconfirmed in normalized metadata.
- The adapter accepts both snake_case and camelCase because existing internal code emits both shapes.
- Missing NO-side quotes are derived from the YES-side complement only when YES bid and YES ask are both present.

## Verification Summary

- Fixture cases passed: ${fixtureResults.passed.length}
- Fixture cases failed: ${fixtureResults.failed.length}
- Batch malformed payloads rejected: ${batchResults.errorCount}
- Grace Phase 1 reference available: ${graceFixture.available ? "yes" : "no"}

## Negative-Path Evidence

- malformed_missing_title -> ${fixtureResults.passed.find((entry) => entry.name === "malformed_missing_title")?.expectedError || "missing"}
- Batch errors -> ${batchResults.errors.map((entry) => `${entry.ticker}: ${entry.error}`).join("; ")}

## Normalization Coverage

- Shared module: ${path.join(BACKEND_DIR, "lib", "live_market_normalizer.js")}
- Live runner integration: ${path.join(BACKEND_DIR, "strategies", "live_runner.js")}
- API validator integration: ${path.join(BACKEND_DIR, "scripts", "kalshi_api_validator.js")}
- Data fetcher integration: ${path.join(BACKEND_DIR, "kalshi_data_fetcher.js")}
`;

  writeArtifact(REPORT_MD_PATH, `${markdown}\n`);

  console.log(JSON.stringify(report.summary, null, 2));
  if (report.summary.verifierStatus !== "pass") {
    process.exit(1);
  }
}

main();
