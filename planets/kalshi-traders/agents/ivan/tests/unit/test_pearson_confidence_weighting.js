#!/usr/bin/env node
/**
 * Unit tests for T966: cluster confidence weighting in pearson_detector.js
 * Run: node tests/unit/test_pearson_confidence_weighting.js
 */

"use strict";

const path = require("path");
const detector = require(path.join(__dirname, "../../output/../../../output/shared/codebase/backend/correlation/pearson_detector.js"));

const {
  analyzePair,
  buildClusterConfidenceMap,
  processClusters,
  CONFIG,
} = detector;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function makePrices(seed, length = 30, correlation = null, leader = null) {
  const prices = [50];
  for (let i = 1; i < length; i++) {
    const x = Math.sin(seed + i) * 10000;
    const rand = x - Math.floor(x);
    if (leader && correlation !== null) {
      const lc = leader[i] - leader[i - 1];
      const change = correlation * lc + Math.sqrt(1 - correlation * correlation) * (rand - 0.5) * 6;
      prices.push(Math.max(5, Math.min(95, Math.round(prices[i - 1] + change))));
    } else {
      prices.push(Math.max(5, Math.min(95, Math.round(prices[i - 1] + (rand - 0.5) * 8))));
    }
  }
  return prices;
}

// ── Test 1: buildClusterConfidenceMap correctly maps tickers ──────────────────
console.log("\nTest 1: buildClusterConfidenceMap");
{
  const clusters = {
    clusters: [
      { id: "c1", confidence: 0.85, markets: ["BTC1", "BTC2"], uncertain_markets: [] },
      { id: "c2", confidence: 0.55, markets: ["FED1", "GDP1"], uncertain_markets: ["FED1", "GDP1"] },
    ]
  };
  const map = buildClusterConfidenceMap(clusters);
  assert(map["BTC1"].clusterConfidence === 0.85, "BTC1 has correct confidence");
  assert(map["BTC1"].isUncertain === false, "BTC1 not uncertain");
  assert(map["FED1"].clusterConfidence === 0.55, "FED1 has correct confidence");
  assert(map["FED1"].isUncertain === true, "FED1 flagged uncertain");
  assert(map["GDP1"].isUncertain === true, "GDP1 flagged uncertain");
}

// ── Test 2: analyzePair without confidence map uses defaults (no penalty) ─────
console.log("\nTest 2: analyzePair without confidence map");
{
  const leader = makePrices(42, 30);
  const follower = makePrices(99, 30, 0.92, leader);
  const mA = { ticker: "A", prices: leader, currentPrice: leader[leader.length - 1] };
  const mB = { ticker: "B", prices: follower, currentPrice: follower[follower.length - 1] };
  const result = analyzePair(mA, mB, "test_cluster");
  if (result) {
    assert(result.cluster_confidence === 1.0, "Default cluster_confidence=1.0");
    assert(result.uncertain_flag === false, "Default uncertain_flag=false");
    assert(result.weighted_confidence === parseFloat((result.arbitrage_confidence * 1.0).toFixed(3)),
      "weighted_confidence equals arbitrage_confidence when no penalty");
  } else {
    assert(false, "analyzePair returned null — adjust seed or check threshold");
  }
}

// ── Test 3: uncertain_flag applies penalty ────────────────────────────────────
console.log("\nTest 3: uncertain_flag applies 0.5 penalty");
{
  const leader = makePrices(7, 30);
  const follower = makePrices(13, 30, 0.95, leader);
  const mA = { ticker: "FEDX", prices: leader, currentPrice: leader[leader.length - 1] };
  const mB = { ticker: "GDPX", prices: follower, currentPrice: follower[follower.length - 1] };
  const confMap = {
    FEDX: { clusterConfidence: 0.62, isUncertain: true },
    GDPX: { clusterConfidence: 0.62, isUncertain: true },
  };
  const result = analyzePair(mA, mB, "c_econ", confMap);
  if (result) {
    assert(result.uncertain_flag === true, "uncertain_flag=true when markets in uncertain_markets");
    const expected = parseFloat((result.arbitrage_confidence * 0.62 * 0.5).toFixed(3));
    assert(result.weighted_confidence === expected,
      `weighted_confidence=${result.weighted_confidence} equals arb*conf*penalty=${expected}`);
  } else {
    assert(false, "analyzePair returned null for test 3");
  }
}

// ── Test 4: confident pair has no penalty ─────────────────────────────────────
console.log("\nTest 4: confident cluster has no penalty");
{
  const leader = makePrices(3, 30);
  const follower = makePrices(17, 30, 0.93, leader);
  const mA = { ticker: "BT1", prices: leader, currentPrice: leader[leader.length - 1] };
  const mB = { ticker: "BT2", prices: follower, currentPrice: follower[follower.length - 1] };
  const confMap = {
    BT1: { clusterConfidence: 0.85, isUncertain: false },
    BT2: { clusterConfidence: 0.82, isUncertain: false },
  };
  const result = analyzePair(mA, mB, "c_crypto", confMap);
  if (result) {
    assert(result.uncertain_flag === false, "uncertain_flag=false for confident cluster");
    const expected = parseFloat((result.arbitrage_confidence * 0.82 * 1.0).toFixed(3));
    assert(result.weighted_confidence === expected,
      `weighted_confidence=${result.weighted_confidence} uses min(0.85,0.82)=0.82`);
  } else {
    assert(false, "analyzePair returned null for test 4");
  }
}

// ── Test 5: min cluster confidence used when markets differ ──────────────────
console.log("\nTest 5: min cluster confidence");
{
  const leader = makePrices(5, 30);
  const follower = makePrices(19, 30, 0.94, leader);
  const mA = { ticker: "HI", prices: leader, currentPrice: leader[leader.length - 1] };
  const mB = { ticker: "LO", prices: follower, currentPrice: follower[follower.length - 1] };
  const confMap = {
    HI: { clusterConfidence: 0.9, isUncertain: false },
    LO: { clusterConfidence: 0.5, isUncertain: false },
  };
  const result = analyzePair(mA, mB, "c_mixed", confMap);
  if (result) {
    assert(result.cluster_confidence === 0.5, "Uses min confidence (0.5)");
  } else {
    assert(false, "analyzePair returned null for test 5");
  }
}

// ── Test 6: processClusters output has new T966 fields ───────────────────────
console.log("\nTest 6: processClusters output includes T966 metadata");
{
  const leader = makePrices(11, 60);
  const clusters = {
    clusters: [
      {
        id: "cluster_1",
        label: "Test Cluster",
        confidence: 0.8,
        uncertain_markets: [],
        markets: ["TICK_A", "TICK_B"],
      }
    ]
  };
  const result = processClusters(clusters);
  assert("uncertain_flagged" in result, "output has uncertain_flagged count");
  assert("confident_pairs" in result, "output has confident_pairs count");
  assert(result.task_id === "T966", "output tagged with T966");
  assert(result.agent === "ivan", "output tagged with ivan");
}

// ── Test 7: noise filter still applies (T963 compatibility) ──────────────────
console.log("\nTest 7: T963 noise filter compatibility");
{
  // Uncorrelated series — should be filtered by noiseFilterThreshold or minCorrelation
  const mA = { ticker: "A", prices: makePrices(1, 30), currentPrice: 50 };
  const mB = { ticker: "B", prices: makePrices(2, 30), currentPrice: 50 };
  const result = analyzePair(mA, mB, "c_noise");
  // With independent series, correlation should be below minCorrelation (0.75)
  // We just verify no crash; result may be null (filtered) which is correct
  assert(result === null || typeof result.pearson_correlation === "number",
    "T963 noise filter compatible — no crash");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`T966 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
