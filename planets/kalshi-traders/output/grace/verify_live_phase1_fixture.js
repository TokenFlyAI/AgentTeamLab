#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { runFilter, loadMarketsFromFile } = require("./market_filter");

const FIXTURE_PATH = path.join(__dirname, "live_phase1_fixture.json");
const EXPECTED_PATH = path.join(__dirname, "live_phase1_expected.json");
const OUTPUT_PATH = path.join(__dirname, "filtered_markets_live_fixture.json");
const REPORT_PATH = path.join(__dirname, "live_phase1_validation_report.md");

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function assertArrayEqual(actual, expected, message) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();

  if (actualSorted.length !== expectedSorted.length) {
    throw new Error(`${message}: expected ${expectedSorted.length} items, received ${actualSorted.length}`);
  }

  for (let index = 0; index < actualSorted.length; index += 1) {
    if (actualSorted[index] !== expectedSorted[index]) {
      throw new Error(`${message}: mismatch at index ${index}, expected ${expectedSorted[index]}, received ${actualSorted[index]}`);
    }
  }
}

function assertDateNotInFuture(isoString, message) {
  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) {
    throw new Error(`${message}: invalid timestamp ${isoString}`);
  }

  if (parsed > Date.now()) {
    throw new Error(`${message}: ${isoString} is in the future`);
  }
}

function assertChronologicalOrder(earlier, later, message) {
  const earlierMs = Date.parse(earlier);
  const laterMs = Date.parse(later);

  if (Number.isNaN(earlierMs) || Number.isNaN(laterMs)) {
    throw new Error(`${message}: invalid timestamps ${earlier} -> ${later}`);
  }

  if (laterMs < earlierMs) {
    throw new Error(`${message}: ${later} is earlier than ${earlier}`);
  }
}

function validateTitleSanity(markets) {
  const problems = [];

  for (const market of markets) {
    const title = String(market.title || "");
    const lowerTitle = title.toLowerCase();
    const percentMatches = [...title.matchAll(/(\d+(?:\.\d+)?)%/g)];

    if (lowerTitle.includes("unemployment")) {
      for (const match of percentMatches) {
        if (Number(match[1]) > 100) {
          problems.push(`${market.ticker}: unemployment threshold ${match[1]}% is impossible`);
        }
      }
    }

    if (lowerTitle.includes("bitcoin dominance")) {
      for (const match of percentMatches) {
        if (Number(match[1]) > 100) {
          problems.push(`${market.ticker}: bitcoin dominance threshold ${match[1]}% exceeds 100%`);
        }
      }
    }

    if (lowerTitle.includes("solana") && title.includes("$")) {
      const priceMatches = [...title.matchAll(/\$([0-9][0-9,]*(?:\.\d+)?)/g)];
      for (const match of priceMatches) {
        const value = Number(match[1].replace(/,/g, ""));
        if (value > 5000) {
          problems.push(`${market.ticker}: Solana threshold $${value} is implausibly high for this fixture pack`);
        }
      }
    }
  }

  return problems;
}

function buildOutcomeLookup({ output, rawFixtureMarkets }) {
  const outcomes = new Map();

  for (const market of output.qualifying_markets) {
    outcomes.set(market.ticker, "qualifying");
  }

  for (const market of output.excluded_markets) {
    if (market.reason === "middle_range_excluded") {
      outcomes.set(market.ticker, "excluded_middle_range");
      continue;
    }

    if (market.reason === "extreme_ratio") {
      outcomes.set(market.ticker, "extreme_ratio");
    }
  }

  const lowVolumeTickers = rawFixtureMarkets
    .filter((market) => {
      const ticker = String(market.ticker || market.marketTicker || "");
      return ticker && !outcomes.has(ticker) && !output.rejected_markets.some((entry) => entry.ticker === ticker);
    })
    .map((market) => String(market.ticker || market.marketTicker || ""))
    .filter(Boolean);

  for (const ticker of lowVolumeTickers) {
    outcomes.set(ticker, "excluded_low_volume");
  }

  for (const market of output.rejected_markets) {
    outcomes.set(market.ticker, "rejected_invalid_market");
  }

  return outcomes;
}

function writeReport({ fixture, output, expected, sanityProblems, lowVolumeTickers }) {
  const report = `# Sprint 6 T816 — Phase 1 Live-Data Fixture Validation

Date: ${new Date().toISOString()}
Task: T816
Freshness: fixtureGeneratedAt=${fixture.generatedAt}; outputGeneratedAt=${output.generated_at}

## Artifact Package

Artifact: ${OUTPUT_PATH}
Fixture: ${FIXTURE_PATH}
Expected: ${EXPECTED_PATH}
Run: node ${path.join(__dirname, "verify_live_phase1_fixture.js")}
Verify: node ${path.join(__dirname, "verify_live_phase1_fixture.js")}
Freshness: fixtureGeneratedAt=${fixture.generatedAt}; outputGeneratedAt=${output.generated_at}

## Verification Summary

- Valid normalized markets: ${output.summary.total_markets}
- Rejected invalid markets: ${output.summary.rejected_invalid_markets}
- After volume filter: ${output.summary.after_volume_filter}
- Qualifying markets: ${output.summary.qualifying_markets}
- Excluded middle range: ${output.summary.excluded_middle_range}
- Extreme ratio manual review: ${output.summary.extreme_ratio}

## Expected Contract

- Qualifying tickers: ${expected.expectedQualifyingTickers.join(", ")}
- Low-volume excluded tickers: ${lowVolumeTickers.join(", ")}
- Rejected tickers: ${expected.expectedRejectedTickers.join(", ")}

## Sanity Checks

${sanityProblems.length === 0 ? "- PASS: no impossible unemployment, bitcoin dominance, or implausible Solana thresholds detected." : sanityProblems.map((problem) => `- FAIL: ${problem}`).join("\n")}
`;

  fs.writeFileSync(REPORT_PATH, report);
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));

  const output = await runFilter({
    inputPath: FIXTURE_PATH,
    outputPath: OUTPUT_PATH,
    task: "T816",
    phase: "Sprint 6 Phase 1 Live-Data Fixture",
    source: fixture.source,
  });

  const rawFixtureMarkets = loadMarketsFromFile(FIXTURE_PATH);
  const validFixtureMarkets = rawFixtureMarkets.filter((market) => Boolean(market.title || market.name || market.question));
  const sanityProblems = validateTitleSanity(validFixtureMarkets);
  const outcomeLookup = buildOutcomeLookup({ output, rawFixtureMarkets });
  const lowVolumeTickers = [...outcomeLookup.entries()]
    .filter(([, outcome]) => outcome === "excluded_low_volume")
    .map(([ticker]) => ticker);

  for (const [key, value] of Object.entries(expected.expectedSummary)) {
    assertEqual(output.summary[key], value, `Summary field ${key}`);
  }

  assertDateNotInFuture(fixture.generatedAt, "Fixture freshness");
  assertChronologicalOrder(fixture.generatedAt, output.generated_at, "Fixture output freshness");

  assertArrayEqual(
    output.qualifying_markets.map((market) => market.ticker),
    expected.expectedQualifyingTickers,
    "Qualifying tickers"
  );

  assertArrayEqual(
    lowVolumeTickers,
    expected.expectedLowVolumeTickers,
    "Low-volume excluded tickers"
  );

  assertArrayEqual(
    output.rejected_markets.map((market) => market.ticker),
    expected.expectedRejectedTickers,
    "Rejected tickers"
  );

  assertArrayEqual(
    output.excluded_markets.map((market) => `${market.ticker}:${market.reason}`),
    expected.expectedExcluded.map((market) => `${market.ticker}:${market.reason}`),
    "Excluded market reasons"
  );

  assertEqual(sanityProblems.length, 0, "Fixture sanity checks");
  for (const [ticker, expectedOutcome] of Object.entries(expected.expectedCaseOutcomes)) {
    assertEqual(outcomeLookup.get(ticker), expectedOutcome, `Case outcome for ${ticker}`);
  }

  writeReport({ fixture, output, expected, sanityProblems, lowVolumeTickers });
  console.log(`Verification passed. Output: ${OUTPUT_PATH}`);
  console.log(`Report written: ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(`Verification failed: ${error.message}`);
  process.exit(1);
});
