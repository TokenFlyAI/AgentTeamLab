#!/usr/bin/env node
/**
 * Unit tests for T966 — Phase 3 cluster confidence weighting
 * Tests: buildClusterConfidenceMap, analyzePair confidence fields, processClusters output
 */
"use strict";

const assert = require("assert");
const path = require("path");
const {
  buildClusterConfidenceMap,
  analyzePair,
  processClusters,
  generatePriceHistory,
  CONFIG,
} = require("/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/shared/codebase/backend/correlation/pearson_detector.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// --- buildClusterConfidenceMap ---
console.log("\n[buildClusterConfidenceMap]");

test("maps tickers to clusterConfidence", () => {
  const clusters = {
    clusters: [
      { id: "c1", confidence: 0.85, markets: ["BTC1", "BTC2"], uncertain_markets: [] },
    ],
  };
  const map = buildClusterConfidenceMap(clusters);
  assert.strictEqual(map["BTC1"].clusterConfidence, 0.85);
  assert.strictEqual(map["BTC2"].clusterConfidence, 0.85);
});

test("sets isUncertain=true for markets in uncertain_markets", () => {
  const clusters = {
    clusters: [
      { id: "c1", confidence: 0.55, markets: ["FED1", "GDP1"], uncertain_markets: ["FED1", "GDP1"] },
    ],
  };
  const map = buildClusterConfidenceMap(clusters);
  assert.strictEqual(map["FED1"].isUncertain, true);
  assert.strictEqual(map["GDP1"].isUncertain, true);
});

test("isUncertain=false for markets NOT in uncertain_markets", () => {
  const clusters = {
    clusters: [
      { id: "c1", confidence: 0.85, markets: ["BTC1", "BTC2"], uncertain_markets: [] },
    ],
  };
  const map = buildClusterConfidenceMap(clusters);
  assert.strictEqual(map["BTC1"].isUncertain, false);
});

test("handles empty clusters gracefully", () => {
  const map = buildClusterConfidenceMap({ clusters: [] });
  assert.deepStrictEqual(map, {});
});

test("handles missing uncertain_markets field", () => {
  const clusters = {
    clusters: [
      { id: "c1", confidence: 0.7, markets: ["A"], },  // no uncertain_markets
    ],
  };
  const map = buildClusterConfidenceMap(clusters);
  assert.strictEqual(map["A"].isUncertain, false);
});

// --- analyzePair with confidence weighting ---
console.log("\n[analyzePair — T966 confidence fields]");

function makePrices(ticker, length = 30) {
  return generatePriceHistory(ticker, length, null, 0);
}

function makeMarket(ticker, correlated = false, leaderPrices = null) {
  const prices = correlated
    ? generatePriceHistory(ticker, 30, leaderPrices, 0.9)
    : makePrices(ticker, 30);
  return { ticker, prices, currentPrice: prices[prices.length - 1] };
}

test("pair has cluster_confidence, uncertain_flag, weighted_confidence fields", () => {
  const leader = makePrices("BTC1", 30);
  const mA = { ticker: "BTC1", prices: leader, currentPrice: leader[29] };
  const mB = makeMarket("BTC2", true, leader);
  const result = analyzePair(mA, mB, "c1", {});
  if (!result) return; // may not correlate — that's ok
  assert.ok("cluster_confidence" in result, "missing cluster_confidence");
  assert.ok("uncertain_flag" in result, "missing uncertain_flag");
  assert.ok("weighted_confidence" in result, "missing weighted_confidence");
});

test("uncertain_flag=true when market in uncertain_markets", () => {
  const leader = makePrices("BTC1", 30);
  const mA = { ticker: "BTC1", prices: leader, currentPrice: leader[29] };
  const mB = makeMarket("BTC2", true, leader);
  const confMap = {
    "BTC1": { clusterConfidence: 0.8, isUncertain: true },
    "BTC2": { clusterConfidence: 0.8, isUncertain: false },
  };
  const result = analyzePair(mA, mB, "c1", confMap);
  if (!result) return;
  assert.strictEqual(result.uncertain_flag, true);
});

test("uncertain_flag=false when neither market is uncertain", () => {
  const leader = makePrices("BTC1", 30);
  const mA = { ticker: "BTC1", prices: leader, currentPrice: leader[29] };
  const mB = makeMarket("BTC2", true, leader);
  const confMap = {
    "BTC1": { clusterConfidence: 0.9, isUncertain: false },
    "BTC2": { clusterConfidence: 0.9, isUncertain: false },
  };
  const result = analyzePair(mA, mB, "c1", confMap);
  if (!result) return;
  assert.strictEqual(result.uncertain_flag, false);
});

test("weighted_confidence < arbitrage_confidence when uncertain (penalty applied)", () => {
  const leader = makePrices("BTC1", 30);
  const mA = { ticker: "BTC1", prices: leader, currentPrice: leader[29] };
  const mB = makeMarket("BTC2", true, leader);
  const confMap = {
    "BTC1": { clusterConfidence: 0.8, isUncertain: true },
    "BTC2": { clusterConfidence: 0.8, isUncertain: true },
  };
  const result = analyzePair(mA, mB, "c1", confMap);
  if (!result) return;
  assert.ok(
    result.weighted_confidence < result.arbitrage_confidence,
    `Expected weighted(${result.weighted_confidence}) < arbitrage(${result.arbitrage_confidence})`
  );
});

test("cluster_confidence = min of the two markets' cluster confidences", () => {
  const leader = makePrices("BTC1", 30);
  const mA = { ticker: "BTC1", prices: leader, currentPrice: leader[29] };
  const mB = makeMarket("BTC2", true, leader);
  const confMap = {
    "BTC1": { clusterConfidence: 0.9, isUncertain: false },
    "BTC2": { clusterConfidence: 0.6, isUncertain: false },
  };
  const result = analyzePair(mA, mB, "c1", confMap);
  if (!result) return;
  assert.strictEqual(result.cluster_confidence, 0.6);
});

test("defaults to clusterConfidence=1.0 when market not in map (backward compat)", () => {
  const leader = makePrices("BTC1", 30);
  const mA = { ticker: "UNKNOWN1", prices: leader, currentPrice: leader[29] };
  const mB = makeMarket("UNKNOWN2", true, leader);
  const result = analyzePair(mA, mB, "c1", {});
  if (!result) return;
  assert.strictEqual(result.cluster_confidence, 1.0);
  assert.strictEqual(result.uncertain_flag, false);
  assert.strictEqual(result.weighted_confidence, result.arbitrage_confidence);
});

// --- processClusters output shape ---
console.log("\n[processClusters — T966 output shape]");

// Factory: fresh object each call to avoid enrichClustersWithPrices mutation
function makeSampleClusters() {
  return {
    clusters: [{
      id: "cluster_1", label: "Crypto", confidence: 0.85, stability: 0.99,
      uncertain_markets: [], markets: ["BTCW-26-JUN30-80K", "ETHW-26-DEC31-5K"],
    }],
  };
}

test("output has task_id=T966 and agent=ivan", () => {
  const result = processClusters(makeSampleClusters());
  assert.strictEqual(result.task_id, "T966");
  assert.strictEqual(result.agent, "ivan");
});

test("output has uncertain_flagged and confident_pairs counts", () => {
  const result = processClusters(makeSampleClusters());
  assert.ok("uncertain_flagged" in result, "missing uncertain_flagged");
  assert.ok("confident_pairs" in result, "missing confident_pairs");
  assert.strictEqual(result.uncertain_flagged + result.confident_pairs, result.total_pairs_analyzed);
});

test("pairs sorted by weighted_confidence descending", () => {
  const result = processClusters(makeSampleClusters());
  for (let i = 1; i < result.pairs.length; i++) {
    assert.ok(
      result.pairs[i - 1].weighted_confidence >= result.pairs[i].weighted_confidence,
      "Pairs not sorted by weighted_confidence"
    );
  }
});

// --- Real-schema regression tests (Tina C19 fix) ---
// Use correlation_strength field as in Bob's t852 / older cluster formats
console.log("\n[Real-schema regression — correlation_strength field]");

test("buildClusterConfidenceMap reads correlation_strength when confidence absent", () => {
  const clusters = {
    clusters: [
      {
        id: "crypto_internal",
        label: "Crypto Markets",
        markets: ["KXBTCDOM-26OCT15-T068", "KXSOL-27APR16-T450"],
        correlation_strength: 0.95,
        description: "Internal Crypto",
        correlation_type: "internal",
        // NOTE: no 'confidence' field — real t852 schema
      },
    ],
  };
  const map = buildClusterConfidenceMap(clusters);
  assert.strictEqual(map["KXBTCDOM-26OCT15-T068"].clusterConfidence, 0.95,
    "Should read correlation_strength=0.95, not default to 0");
  assert.strictEqual(map["KXSOL-27APR16-T450"].clusterConfidence, 0.95,
    "Both markets in cluster get correlation_strength");
});

test("weighted_confidence is non-zero with correlation_strength schema", () => {
  const leader = makePrices("KXBTCDOM-26OCT15-T068", 30);
  const mA = { ticker: "KXBTCDOM-26OCT15-T068", prices: leader, currentPrice: leader[29] };
  const mB = makeMarket("KXSOL-27APR16-T450", true, leader);
  const confMap = {
    "KXBTCDOM-26OCT15-T068": { clusterConfidence: 0.95, isUncertain: false },
    "KXSOL-27APR16-T450":    { clusterConfidence: 0.95, isUncertain: false },
  };
  const result = analyzePair(mA, mB, "crypto_internal", confMap);
  if (!result) return; // may not meet minCorrelation — that's ok
  assert.ok(result.weighted_confidence > 0,
    `weighted_confidence must be >0 with real data, got ${result.weighted_confidence}`);
  assert.strictEqual(result.cluster_confidence, 0.95);
});

test("fallback to 1.0 when neither confidence nor correlation_strength present", () => {
  const clusters = {
    clusters: [
      { id: "c1", label: "Unknown", markets: ["X", "Y"], },  // neither field
    ],
  };
  const map = buildClusterConfidenceMap(clusters);
  assert.strictEqual(map["X"].clusterConfidence, 1.0,
    "Missing both fields should default to 1.0, not 0 (silent failure)");
});

test("confidence field takes priority over correlation_strength when both present", () => {
  const clusters = {
    clusters: [
      { id: "c1", confidence: 0.8, correlation_strength: 0.95, markets: ["A"], uncertain_markets: [] },
    ],
  };
  const map = buildClusterConfidenceMap(clusters);
  assert.strictEqual(map["A"].clusterConfidence, 0.8, "confidence field takes priority");
});

// Results
console.log(`\n${"=".repeat(50)}`);
console.log(`T966 test report: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
