/**
 * Market Screener Unit Tests
 * Author: Mia (API Engineer)
 * Task: T287 — Tests for market filtering, scoring, and output schema validation
 */

"use strict";

const fs = require("fs");
const path = require("path");

const screener = require("../../../../../mia/output/screener");
const {
  validateScreenerOutput,
  strictValidate,
} = require("../../../lib/kalshi_schema");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`ASSERT FAILED: ${message} — expected ~${expected}, got ${actual} (diff=${diff})`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function runTests() {
  console.log("Running market screener unit tests...\n");
  let passed = 0;
  let failed = 0;

  const tests = [
    // -----------------------------------------------------------------------
    // Test 1: computeMidPrice
    // -----------------------------------------------------------------------
    {
      name: "computeMidPrice with bid and ask",
      fn: () => {
        const mid = screener.computeMidPrice(40, 60);
        assert(mid === 50, "Expected mid price 50");
      },
    },
    {
      name: "computeMidPrice with only bid",
      fn: () => {
        const mid = screener.computeMidPrice(45, null);
        assert(mid === 45, "Expected mid price 45 when only bid provided");
      },
    },
    {
      name: "computeMidPrice fallback to 50",
      fn: () => {
        const mid = screener.computeMidPrice(null, null);
        assert(mid === 50, "Expected default mid price 50");
      },
    },

    // -----------------------------------------------------------------------
    // Test 2: computeSpreadPct
    // -----------------------------------------------------------------------
    {
      name: "computeSpreadPct with tight spread",
      fn: () => {
        const spread = screener.computeSpreadPct({ yes_bid: 48, yes_ask: 52 });
        assertApprox(spread, 0.08, 0.01, "Expected ~0.08 (8%) spread for 48/52");
      },
    },
    {
      name: "computeSpreadPct with wide spread",
      fn: () => {
        const spread = screener.computeSpreadPct({ yesBid: 30, yesAsk: 40 });
        assertApprox(spread, 0.286, 0.01, "Expected ~0.286 (28.6%) spread for 30/40");
      },
    },
    {
      name: "computeSpreadPct defaults to 5% when no prices",
      fn: () => {
        const spread = screener.computeSpreadPct({});
        assert(spread === 0.05, "Expected default 0.05 (5%) spread");
      },
    },

    // -----------------------------------------------------------------------
    // Test 3: computeVolatility
    // -----------------------------------------------------------------------
    {
      name: "computeVolatility uses cached stddev",
      fn: () => {
        const vol = screener.computeVolatility({ priceHistoryStddev: 12.5 });
        assert(vol === 12.5, "Expected cached stddev");
      },
    },
    {
      name: "computeVolatility estimates from mid price",
      fn: () => {
        const vol = screener.computeVolatility({ yesMid: 80 });
        assert(vol === 35, "Expected estimated volatility |50-80|+5 = 35");
      },
    },

    // -----------------------------------------------------------------------
    // Test 4: scoreMarket
    // -----------------------------------------------------------------------
    {
      name: "scoreMarket produces valid shape",
      fn: () => {
        const market = {
          ticker: "TEST-01",
          title: "Test Market",
          category: "Economics",
          volume: 100000,
          yes_bid: 48,
          yes_ask: 52,
          priceHistoryStddev: 10,
        };
        const scored = screener.scoreMarket(market);
        assert(scored.ticker === "TEST-01", "Expected ticker");
        assert(scored.volume === 100000, "Expected volume");
        assert(typeof scored.compositeScore === "number", "Expected compositeScore");
        assert(scored.compositeScore >= 0 && scored.compositeScore <= 1, "compositeScore should be 0-1");
      },
    },
    {
      name: "scoreMarket ranks high volume above low volume",
      fn: () => {
        const highVol = screener.scoreMarket({
          ticker: "HIGH",
          volume: 1000000,
          yes_bid: 48,
          yes_ask: 52,
          priceHistoryStddev: 10,
        });
        const lowVol = screener.scoreMarket({
          ticker: "LOW",
          volume: 1000,
          yes_bid: 48,
          yes_ask: 52,
          priceHistoryStddev: 10,
        });
        assert(highVol.compositeScore > lowVol.compositeScore, "High volume should score higher");
      },
    },
    {
      name: "scoreMarket ranks tight spread above wide spread",
      fn: () => {
        const tight = screener.scoreMarket({
          ticker: "TIGHT",
          volume: 100000,
          yes_bid: 49,
          yes_ask: 51,
          priceHistoryStddev: 10,
        });
        const wide = screener.scoreMarket({
          ticker: "WIDE",
          volume: 100000,
          yes_bid: 30,
          yes_ask: 70,
          priceHistoryStddev: 10,
        });
        assert(tight.compositeScore > wide.compositeScore, "Tight spread should score higher");
      },
    },
    {
      name: "scoreMarket ranks high volatility above low volatility",
      fn: () => {
        const highV = screener.scoreMarket({
          ticker: "HI",
          volume: 100000,
          yes_bid: 48,
          yes_ask: 52,
          priceHistoryStddev: 20,
        });
        const lowV = screener.scoreMarket({
          ticker: "LO",
          volume: 100000,
          yes_bid: 48,
          yes_ask: 52,
          priceHistoryStddev: 1,
        });
        assert(highV.compositeScore > lowV.compositeScore, "High volatility should score higher");
      },
    },

    // -----------------------------------------------------------------------
    // Test 5: generateMockMarkets
    // -----------------------------------------------------------------------
    {
      name: "generateMockMarkets returns at least 10 markets",
      fn: () => {
        const mocks = screener.generateMockMarkets();
        assert(mocks.length >= 10, `Expected >= 10 mock markets, got ${mocks.length}`);
        assert(mocks.every((m) => m.ticker && m.title && m.volume > 0), "All mocks should have required fields");
      },
    },

    // -----------------------------------------------------------------------
    // Test 6: loadCachedMarkets
    // -----------------------------------------------------------------------
    {
      name: "loadCachedMarkets aggregates from output directory",
      fn: () => {
        const markets = screener.loadCachedMarkets();
        assert(Array.isArray(markets), "Expected array");
        assert(markets.length >= 0, "Should return array even if empty");
        // If trade_signals.json exists, we should have some markets
        const signalsPath = path.join(__dirname, "../../../../output/trade_signals.json");
        if (fs.existsSync(signalsPath)) {
          assert(markets.length > 0, "Expected at least one cached market when trade_signals.json exists");
        }
      },
    },

    // -----------------------------------------------------------------------
    // Test 7: JSON output schema validation
    // -----------------------------------------------------------------------
    {
      name: "screener output passes schema validation",
      fn: () => {
        const markets = screener.generateMockMarkets().slice(0, 10);
        const scored = markets.map(screener.scoreMarket).sort((a, b) => b.compositeScore - a.compositeScore);
        const output = {
          generatedAt: new Date().toISOString(),
          source: "test",
          totalMarkets: markets.length,
          top10: scored.slice(0, 10),
        };
        const result = validateScreenerOutput(output);
        assert(result.valid, `Schema validation failed: ${result.errors.join("; ")}`);
      },
    },
    {
      name: "screener output fails schema validation when required fields missing",
      fn: () => {
        const badOutput = {
          generatedAt: new Date().toISOString(),
          source: "test",
          totalMarkets: 1,
          top10: [{ ticker: "BAD", title: "Bad Market" }],
        };
        const result = validateScreenerOutput(badOutput);
        assert(!result.valid, "Expected validation to fail for incomplete market");
        assert(result.errors.some((e) => e.includes("category")), "Expected category error");
      },
    },
    {
      name: "strictValidate throws on invalid data",
      fn: () => {
        let threw = false;
        try {
          strictValidate(validateScreenerOutput, { source: "x" }, "badOutput");
        } catch (e) {
          threw = true;
          assert(e.message.includes("Schema validation failed"), "Expected schema validation error");
        }
        assert(threw, "Expected strictValidate to throw");
      },
    },
  ];

  for (const test of tests) {
    try {
      test.fn();
      console.log(`  PASS: ${test.name}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL: ${test.name} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\n==============================`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`==============================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
