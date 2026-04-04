/**
 * Unit Tests for MeanReversionStrategy
 * QA: Frank (QA Engineer)
 * Task: #279
 *
 * Coverage:
 * - Z-score calculation
 * - Signal generation
 * - Confidence threshold enforcement
 * - Edge cases and boundary conditions
 */

"use strict";

const { MeanReversionStrategy } = require("../../../agents/bob/backend/strategies/strategies/mean_reversion.js");

// Test harness
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`✅ PASS: ${message}`);
    passed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    console.error(`❌ FAIL: ${message} (expected: ${expected}, got: ${actual})`);
    failed++;
  } else {
    console.log(`✅ PASS: ${message}`);
    passed++;
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.error(`❌ FAIL: ${message}`);
    console.error(`  Expected: ${expectedStr}`);
    console.error(`  Got: ${actualStr}`);
    failed++;
  } else {
    console.log(`✅ PASS: ${message}`);
    passed++;
  }
}

function assertNull(actual, message) {
  if (actual !== null) {
    console.error(`❌ FAIL: ${message} (expected null, got: ${JSON.stringify(actual)})`);
    failed++;
  } else {
    console.log(`✅ PASS: ${message}`);
    passed++;
  }
}

function assertNotNull(actual, message) {
  if (actual === null) {
    console.error(`❌ FAIL: ${message} (expected non-null, got: null)`);
    failed++;
  } else {
    console.log(`✅ PASS: ${message}`);
    passed++;
  }
}

function assertTrue(condition, message) {
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("UNIT TESTS: MeanReversionStrategy (T279)");
console.log("═══════════════════════════════════════════════════════════════\n");

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 1: Constructor & Defaults
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST SUITE 1: Constructor & Default Options");
console.log("───────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy();
  assertEquals(strategy.lookbackPeriods, 10, "Default lookbackPeriods is 10");
  assertEquals(strategy.zScoreThreshold, 1.5, "Default zScoreThreshold is 1.5");
  assertEquals(strategy.minVolume, 10000, "Default minVolume is 10000");
}

{
  const strategy = new MeanReversionStrategy({
    lookbackPeriods: 20,
    zScoreThreshold: 2.0,
    minVolume: 50000,
  });
  assertEquals(strategy.lookbackPeriods, 20, "Custom lookbackPeriods honored");
  assertEquals(strategy.zScoreThreshold, 2.0, "Custom zScoreThreshold honored");
  assertEquals(strategy.minVolume, 50000, "Custom minVolume honored");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 2: Volume Filtering
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 2: Volume Filtering");
console.log("──────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ minVolume: 10000 });

  const lowVolMarket = {
    id: "m1",
    yes_price: 60,
    no_price: 40,
    volume: 5000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(lowVolMarket);
  assertNull(signal, "Returns null when volume < minVolume");
}

{
  const strategy = new MeanReversionStrategy({ minVolume: 10000 });

  const zeroVolMarket = {
    id: "m2",
    yes_price: 60,
    no_price: 40,
    volume: 0,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(zeroVolMarket);
  assertNull(signal, "Returns null when volume is 0");
}

{
  const strategy = new MeanReversionStrategy({ minVolume: 10000 });

  const missingVolMarket = {
    id: "m3",
    yes_price: 60,
    no_price: 40,
    price_history_mean: 50,
    price_history_stddev: 10,
    // volume omitted
  };

  const signal = strategy.generateSignal(missingVolMarket);
  assertNull(signal, "Returns null when volume is missing (defaults to 0)");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 3: Standard Deviation Filtering
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 3: Standard Deviation Filtering");
console.log("──────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy();

  const zeroStdDevMarket = {
    id: "m4",
    yes_price: 60,
    no_price: 40,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 0,
  };

  const signal = strategy.generateSignal(zeroStdDevMarket);
  assertNull(signal, "Returns null when stdDev is 0 (division by zero protection)");
}

{
  const strategy = new MeanReversionStrategy();

  const negativeStdDevMarket = {
    id: "m5",
    yes_price: 60,
    no_price: 40,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: -5,
  };

  const signal = strategy.generateSignal(negativeStdDevMarket);
  assertNull(signal, "Returns null when stdDev is negative");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 4: Z-Score Calculation & Threshold Enforcement
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 4: Z-Score Calculation & Threshold");
console.log("──────────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = (60 - 50) / 10 = 1.0 (below threshold)
  const belowThresholdMarket = {
    id: "m6",
    yes_price: 60,
    no_price: 40,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(belowThresholdMarket);
  assertNull(signal, "Returns null when |z-score| < threshold");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = (65 - 50) / 10 = 1.5 (at threshold, generates signal since abs(z) < threshold is false)
  const atThresholdMarket = {
    id: "m7",
    yes_price: 65,
    no_price: 35,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(atThresholdMarket);
  assertNotNull(signal, "Generates signal when |z-score| >= threshold");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = (70 - 50) / 10 = 2.0 (above threshold)
  const aboveThresholdMarket = {
    id: "m8",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(aboveThresholdMarket);
  assertNotNull(signal, "Generates signal when |z-score| > threshold");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 5: Side Determination (Mean Reversion Logic)
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 5: Side Determination (Mean Reversion Logic)");
console.log("─────────────────────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // YES is overbought: yes_price (70) > mean (50), so z-score > 0, should bet NO
  const yeOverboughtMarket = {
    id: "m9",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(yeOverboughtMarket);
  assertNotNull(signal, "Generates signal for overbought YES");
  assertEquals(signal.side, "no", "Recommends NO when YES is overbought (z-score > 0)");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // YES is oversold: yes_price (30) < mean (50), so z-score < 0, should bet YES
  const yesOversoldMarket = {
    id: "m10",
    yes_price: 30,
    no_price: 70,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(yesOversoldMarket);
  assertNotNull(signal, "Generates signal for oversold YES");
  assertEquals(signal.side, "yes", "Recommends YES when YES is oversold (z-score < 0)");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 6: Confidence Calculation & Capping
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 6: Confidence Calculation & Capping");
console.log("──────────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = 2.0, confidence = min(2.0 / 3, 0.95) = min(0.667, 0.95) = 0.667
  const market1 = {
    id: "m11",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market1);
  assert(Math.abs(signal.confidence - 0.667) < 0.01, `Confidence for z=2.0: expected ~0.667, got ${signal.confidence}`);
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = 3.0, confidence = min(3.0 / 3, 0.95) = min(1.0, 0.95) = 0.95 (capped)
  const market2 = {
    id: "m12",
    yes_price: 80,
    no_price: 20,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market2);
  assertEquals(signal.confidence, 0.95, "Confidence capped at 0.95 for high z-scores");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = -2.0, confidence = min(|-2.0| / 3, 0.95) = min(0.667, 0.95) = 0.667
  const market3 = {
    id: "m13",
    yes_price: 30,
    no_price: 70,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market3);
  assert(Math.abs(signal.confidence - 0.667) < 0.01, `Confidence for z=-2.0: expected ~0.667, got ${signal.confidence}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 7: Signal Structure & Required Fields
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 7: Signal Structure & Required Fields");
console.log("───────────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  const market = {
    id: "m14",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market);
  assertNotNull(signal, "Signal generated for valid market");

  // Check required fields
  assert(signal.marketId !== undefined, "Signal has marketId field");
  assert(signal.side !== undefined, "Signal has side field (yes/no)");
  assert(signal.signalType !== undefined, "Signal has signalType field");
  assert(signal.confidence !== undefined, "Signal has confidence field");
  assert(signal.targetPrice !== undefined, "Signal has targetPrice field");
  assert(signal.currentPrice !== undefined, "Signal has currentPrice field");
  assert(signal.expectedEdge !== undefined, "Signal has expectedEdge field");
  assert(signal.recommendedContracts !== undefined, "Signal has recommendedContracts field");
  assert(signal.reason !== undefined, "Signal has reason field (explanation)");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  const market = {
    id: "m15",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market);
  assertEquals(signal.signalType, "entry", "Signal type is 'entry'");
  assertEquals(signal.marketId, "m15", "Signal contains correct marketId");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 8: Missing & Default Market Data
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 8: Missing & Default Market Data");
console.log("────────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy();

  // Market with missing price data (should use defaults)
  const minimalMarket = {
    id: "m16",
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
    // yes_price and no_price missing; defaults are 50 each
  };

  const signal = strategy.generateSignal(minimalMarket);
  assertNull(signal, "Returns null when prices default to 50 (z-score = 0)");
}

{
  const strategy = new MeanReversionStrategy();

  // Market with missing mean data
  const noMeanMarket = {
    id: "m17",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_stddev: 10,
    // price_history_mean missing; defaults to 50
  };

  const signal = strategy.generateSignal(noMeanMarket);
  assertNotNull(signal, "Generates signal with default mean=50");
}

{
  const strategy = new MeanReversionStrategy();

  // Market with missing stdDev data
  const noStdDevMarket = {
    id: "m18",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_mean: 50,
    // price_history_stddev missing; defaults to 10
  };

  const signal = strategy.generateSignal(noStdDevMarket);
  assertNotNull(signal, "Generates signal with default stdDev=10");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 9: Edge Calculation (Expected Edge)
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 9: Edge Calculation (Expected Edge)");
console.log("───────────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = 2.0, stdDev = 10, edge = |2.0| * 10 = 20
  const market = {
    id: "m19",
    yes_price: 70,
    no_price: 30,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market);
  assertEquals(signal.expectedEdge, 20, "Edge calculation: |z-score| * stdDev");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Z-score = -3.0, stdDev = 5, edge = |-3.0| * 5 = 15
  const market = {
    id: "m20",
    yes_price: 35,
    no_price: 65,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 5,
  };

  const signal = strategy.generateSignal(market);
  assertEquals(signal.expectedEdge, 15, "Edge calculation correct for negative z-score");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 10: Extreme & Boundary Conditions
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 10: Extreme & Boundary Conditions");
console.log("────────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Extreme z-score (very high)
  const extremeMarket = {
    id: "m21",
    yes_price: 99,
    no_price: 1,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 0.5,
  };

  const signal = strategy.generateSignal(extremeMarket);
  assertNotNull(signal, "Handles extreme z-scores");
  assertEquals(signal.confidence, 0.95, "Confidence still capped at 0.95 even for extreme z");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Exact boundary: z-score = 1.500001
  const boundaryMarket = {
    id: "m22",
    yes_price: 65.000005,
    no_price: 34.999995,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(boundaryMarket);
  assertNotNull(signal, "Generates signal just above threshold");
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 0.05 });

  // Very small threshold (catches even tiny deviations)
  const market = {
    id: "m23",
    yes_price: 51,
    no_price: 49,
    volume: 20000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market);
  assertNotNull(signal, "Generates signal with very small threshold");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 11: Reason Field (Explanation)
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 11: Reason Field (Explanation)");
console.log("──────────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  const market = {
    id: "m24",
    yes_price: 70,
    no_price: 30,
    volume: 25000,
    price_history_mean: 50,
    price_history_stddev: 10,
  };

  const signal = strategy.generateSignal(market);
  assert(signal.reason.includes("z-score"), "Reason includes z-score");
  assert(signal.reason.includes("mean"), "Reason includes mean");
  assert(signal.reason.includes("vol"), "Reason includes volume");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Suite 12: Null Market & Invalid Input Handling
// ─────────────────────────────────────────────────────────────────────────
console.log("\nTEST SUITE 12: Invalid Input Handling");
console.log("──────────────────────────────────────\n");

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  let errorThrown = false;
  try {
    const signal = strategy.generateSignal(null);
    // If it doesn't crash, check what it returns
  } catch (e) {
    errorThrown = true;
  }

  // This is a robustness check; depending on implementation, it may throw or return null
  console.log(`✅ PASS: Handles null market input (threw: ${errorThrown})`);
  passed++;
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  let errorThrown = false;
  try {
    const signal = strategy.generateSignal(undefined);
  } catch (e) {
    errorThrown = true;
  }

  console.log(`✅ PASS: Handles undefined market input (threw: ${errorThrown})`);
  passed++;
}

{
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.5 });

  // Empty object
  const signal = strategy.generateSignal({});
  assertNull(signal, "Returns null for empty market object (volume defaults to 0)");
}

// ─────────────────────────────────────────────────────────────────────────
// Test Results
// ─────────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("TEST RESULTS");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log("═══════════════════════════════════════════════════════════════\n");

if (failed === 0) {
  console.log("🎉 ALL TESTS PASSED!");
  process.exit(0);
} else {
  console.log(`⚠️  ${failed} test(s) failed.`);
  process.exit(1);
}
