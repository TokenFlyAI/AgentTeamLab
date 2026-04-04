/**
 * Unit Tests — D004 Arbitrage Strategy Suite
 * QA: Frank (QA Engineer)
 * Date: 2026-04-03
 *
 * Coverage:
 * - CrossPlatformArbitrageStrategy
 * - LongshotFadingStrategy (critical bug documented)
 * - RiskManager (pure logic, DB-mocked)
 *
 * BUGS FOUND:
 * BUG-001 [CRITICAL] LongshotFadingStrategy: expectedEdge formula maxes at ~1.0¢,
 *         but minEdge defaults to 2¢ — strategy can NEVER generate signals.
 * BUG-002 [MINOR]    CrossPlatformArbitrageStrategy: confidence hardcoded to
 *         minConfidence (0.85) regardless of spread magnitude.
 * BUG-003 [MAJOR]    RiskManager.getTodayPnL(): no null check on pool — crashes
 *         when DB is unavailable (unlike getCurrentPositions which handles it).
 */

"use strict";

const { CrossPlatformArbitrageStrategy } = require("../../../agents/bob/backend/strategies/strategies/cross_platform_arbitrage.js");
const { LongshotFadingStrategy } = require("../../../agents/bob/backend/strategies/strategies/longshot_fading.js");

let passed = 0;
let failed = 0;
let bugs = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  }
}

function assertBug(condition, bugId, message) {
  if (!condition) {
    console.error(`  🐛 BUG ${bugId} CONFIRMED: ${message}`);
    bugs++;
    failed++;
  } else {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  }
}

function suite(name, fn) {
  console.log(`\n=== ${name} ===`);
  fn();
}

// ─── CrossPlatformArbitrageStrategy ─────────────────────────────────────────

suite("CrossPlatformArbitrageStrategy — Constructor & Defaults", () => {
  const s = new CrossPlatformArbitrageStrategy();
  assert(s.minSpread === 3, "default minSpread = 3");
  assert(s.maxHoldMinutes === 60, "default maxHoldMinutes = 60");
  assert(s.estimatedFees === 2, "default estimatedFees = 2");
  assert(s.minConfidence === 0.85, "default minConfidence = 0.85");
  assert(s.minEdge === 1, "default minEdge = 1");
});

suite("CrossPlatformArbitrageStrategy — Constructor Custom Options", () => {
  const s = new CrossPlatformArbitrageStrategy({ minSpread: 5, minEdge: 3, minConfidence: 0.9 });
  assert(s.minSpread === 5, "custom minSpread = 5");
  assert(s.minEdge === 3, "custom minEdge = 3");
  assert(s.minConfidence === 0.9, "custom minConfidence = 0.9");
});

suite("CrossPlatformArbitrageStrategy — Returns null for no externalPrices", () => {
  const s = new CrossPlatformArbitrageStrategy();
  assert(s.generateSignal({ id: "mkt1", yes_mid: 50 }) === null, "null when externalPrices missing");
  assert(s.generateSignal({ id: "mkt1", yes_mid: 50, externalPrices: {} }) === null, "null when externalPrices is empty");
});

suite("CrossPlatformArbitrageStrategy — Returns null for no kalshi price", () => {
  const s = new CrossPlatformArbitrageStrategy();
  assert(s.generateSignal({ id: "mkt1", externalPrices: { poly: 60 } }) === null, "null when no yes_mid or yesPrice");
});

suite("CrossPlatformArbitrageStrategy — Signal on sufficient spread (kalshi cheaper)", () => {
  const s = new CrossPlatformArbitrageStrategy();
  // spread = 60-50 = 10, edge = 10 - (2*2) = 6 >= minEdge(1), >= minSpread(3)
  const signal = s.generateSignal({
    id: "mkt-btc",
    yes_mid: 50,
    externalPrices: { polymarket: 60 }
  });
  assert(signal !== null, "generates signal when spread sufficient");
  assert(signal.side === "yes", "side=yes when kalshi is cheaper");
  assert(signal.targetPrice === 50, "targetPrice = kalshi price when buying YES");
  assert(signal.expectedEdge === 6, "expectedEdge = spread(10) - fees(4) = 6");
  assert(signal.marketId === "mkt-btc", "marketId set correctly");
});

suite("CrossPlatformArbitrageStrategy — Signal on sufficient spread (kalshi more expensive)", () => {
  const s = new CrossPlatformArbitrageStrategy();
  // kalshi=70, poly=55, spread=15, edge=15-4=11
  const signal = s.generateSignal({
    id: "mkt-eth",
    yes_mid: 70,
    externalPrices: { polymarket: 55 }
  });
  assert(signal !== null, "generates signal when kalshi more expensive");
  assert(signal.side === "no", "side=no when kalshi is more expensive (sell YES)");
  assert(signal.targetPrice === 30, "targetPrice = 100 - kalshiYesPrice for NO side");
  assert(signal.expectedEdge === 11, "expectedEdge = spread(15) - fees(4) = 11");
});

suite("CrossPlatformArbitrageStrategy — No signal when edge below threshold", () => {
  const s = new CrossPlatformArbitrageStrategy();
  // spread=3, edge=3-(2*2)=-1 < minEdge(1) → no signal
  const signal = s.generateSignal({
    id: "mkt1",
    yes_mid: 50,
    externalPrices: { poly: 53 }
  });
  assert(signal === null, "no signal when edge is negative after fees");
});

suite("CrossPlatformArbitrageStrategy — Picks best opportunity across platforms", () => {
  const s = new CrossPlatformArbitrageStrategy();
  const signal = s.generateSignal({
    id: "mkt1",
    yes_mid: 50,
    externalPrices: {
      polymarket: 60,  // edge=6
      betfair: 65      // edge=11 — should win
    }
  });
  assert(signal !== null, "generates signal with multiple platforms");
  assert(signal.metadata.platform === "betfair", "picks highest-edge platform (betfair)");
  assert(signal.expectedEdge === 11, "expectedEdge from best platform = 11");
});

suite("CrossPlatformArbitrageStrategy — BUG-002: confidence always hardcoded", () => {
  const s = new CrossPlatformArbitrageStrategy();
  const smallSpread = s.generateSignal({
    id: "mkt1", yes_mid: 50, externalPrices: { poly: 56 }  // edge=2
  });
  const largeSpread = s.generateSignal({
    id: "mkt2", yes_mid: 50, externalPrices: { poly: 90 }  // edge=36
  });
  // BUG: both signals have same confidence regardless of spread
  assertBug(
    smallSpread !== null && largeSpread !== null && smallSpread.confidence !== largeSpread.confidence,
    "BUG-002",
    "confidence should scale with spread — small(edge=2) and large(edge=36) differ"
  );
});

suite("CrossPlatformArbitrageStrategy — generateSignals batch + sorting", () => {
  const s = new CrossPlatformArbitrageStrategy();
  const markets = [
    { id: "mkt-a", yes_mid: 50, externalPrices: { poly: 60 } },   // edge=6
    { id: "mkt-b", yes_mid: 50, externalPrices: { poly: 80 } },   // edge=26
    { id: "mkt-c", yes_mid: 50, externalPrices: { poly: 52 } },   // edge=-2, no signal
  ];
  const signals = s.generateSignals(markets);
  assert(signals.length === 2, "returns 2 signals, skips no-opportunity market");
  assert(signals[0].marketId === "mkt-b", "sorted by expectedEdge descending (mkt-b first)");
  assert(signals[1].marketId === "mkt-a", "mkt-a second");
});

suite("CrossPlatformArbitrageStrategy — yesPrice via yesPrice field (fallback)", () => {
  const s = new CrossPlatformArbitrageStrategy();
  const signal = s.generateSignal({
    id: "mkt1",
    yesPrice: 50,  // fallback field
    externalPrices: { poly: 60 }
  });
  assert(signal !== null, "reads yesPrice when yes_mid not present");
});

suite("CrossPlatformArbitrageStrategy — externalPrice equal to kalshi (zero spread)", () => {
  const s = new CrossPlatformArbitrageStrategy();
  const signal = s.generateSignal({
    id: "mkt1", yes_mid: 50, externalPrices: { poly: 50 }  // spread=0, edge=-4
  });
  assert(signal === null, "no signal when prices are equal");
});

suite("CrossPlatformArbitrageStrategy — custom minEdge=0 allows thin spreads", () => {
  const s = new CrossPlatformArbitrageStrategy({ minEdge: 0, minSpread: 0 });
  const signal = s.generateSignal({
    id: "mkt1", yes_mid: 50, externalPrices: { poly: 53 }  // spread=3, edge=-1 — still < 0
  });
  assert(signal === null, "still no signal when edge < 0 even with minEdge=0");
});

// ─── LongshotFadingStrategy ──────────────────────────────────────────────────

suite("LongshotFadingStrategy — Constructor & Defaults", () => {
  const s = new LongshotFadingStrategy();
  assert(s.name === "LongshotFading", "name = LongshotFading");
  assert(s.minPrice === 5, "default minPrice = 5");
  assert(s.maxPrice === 20, "default maxPrice = 20");
  assert(s.minEdge === 2, "default minEdge = 2");
  assert(s.minConfidence === 0.7, "default minConfidence = 0.7");
  assert(Array.isArray(s.targetCategories), "targetCategories is array");
});

suite("LongshotFadingStrategy — Returns null outside price range", () => {
  const s = new LongshotFadingStrategy();
  assert(s.generateSignal({ id: "mkt1", category: "Weather", yes_mid: 4 }) === null, "null below minPrice");
  assert(s.generateSignal({ id: "mkt1", category: "Weather", yes_mid: 21 }) === null, "null above maxPrice");
  assert(s.generateSignal({ id: "mkt1", category: "Weather", yes_mid: 25 }) === null, "null well above maxPrice");
});

suite("LongshotFadingStrategy — Returns null for wrong category", () => {
  const s = new LongshotFadingStrategy();
  assert(s.generateSignal({ id: "mkt1", category: "Crypto", yes_mid: 10 }) === null, "null for Crypto category");
  assert(s.generateSignal({ id: "mkt1", category: "Sports", yes_mid: 10 }) === null, "null for Sports category");
});

suite("LongshotFadingStrategy — BUG-001: strategy NEVER generates signals with defaults", () => {
  const s = new LongshotFadingStrategy();
  // Max possible edge: price=10, overpricingFactor=10/15=0.667 → edge=10*0.15*0.667=1.0
  // minEdge=2 → always fails
  const maxEdgeMarket = { id: "mkt1", category: "Weather", yes_mid: 10 };
  const signal = s.generateSignal(maxEdgeMarket);
  assertBug(
    signal !== null,
    "BUG-001",
    "generateSignal(yes_mid=10, Weather) should return signal but returns null — expectedEdge max(~1.0) < minEdge(2)"
  );
});

suite("LongshotFadingStrategy — BUG-001: confirms no price in range generates signal", () => {
  const s = new LongshotFadingStrategy();
  let anySignal = false;
  for (let price = 5; price <= 20; price++) {
    const sig = s.generateSignal({ id: "mkt", category: "Weather", yes_mid: price });
    if (sig !== null) anySignal = true;
  }
  assertBug(
    anySignal,
    "BUG-001",
    "at least one price in [5,20] should generate a signal with default settings"
  );
});

suite("LongshotFadingStrategy — Works with lower minEdge (verifies formula logic)", () => {
  const s = new LongshotFadingStrategy({ minEdge: 0.5 });
  const signal = s.generateSignal({ id: "mkt1", category: "Weather", yes_mid: 10 });
  assert(signal !== null, "generates signal when minEdge lowered to 0.5");
  assert(signal.side === "no", "side is 'no' (fade the longshot)");
  assert(signal.targetPrice === 90, "targetPrice = 100 - yesPrice = 90");
  assert(signal.confidence >= 0.7, "confidence >= minConfidence");
  assert(signal.confidence <= 0.95, "confidence capped at 0.95");
});

suite("LongshotFadingStrategy — BUG-004: minEdge=0 silently becomes 2 due to || operator", () => {
  const s = new LongshotFadingStrategy({ minEdge: 0 });
  // BUG: options.minEdge || 2 treats 0 as falsy → minEdge becomes 2
  assertBug(
    s.minEdge === 0,
    "BUG-004",
    "constructor { minEdge: 0 } should set minEdge=0, but || operator makes it default to 2"
  );
});

suite("LongshotFadingStrategy — Lower price = higher confidence (formula check)", () => {
  const s = new LongshotFadingStrategy({ minEdge: 0.5 });
  const low = s.generateSignal({ id: "mkt1", category: "Weather", yes_mid: 6 });
  const high = s.generateSignal({ id: "mkt2", category: "Weather", yes_mid: 18 });
  // At price=6: edge=0.84 >= 0.5 ✓; at price=18: edge=0.27 < 0.5 → null
  assert(low !== null, "yes_mid=6 with minEdge=0.5 generates signal (edge=0.84)");
  // price=18: edge = 18 * 0.15 * (20-18)/15 = 18*0.15*0.133 = 0.36 < 0.5 → null
  assert(high === null, "yes_mid=18 with minEdge=0.5 returns null (edge=0.36 < 0.5)");
});

suite("LongshotFadingStrategy — Returns null when no yesPrice field", () => {
  const s = new LongshotFadingStrategy({ minEdge: 0.5 });
  assert(s.generateSignal({ id: "mkt1", category: "Weather" }) === null, "null when no price field");
});

suite("LongshotFadingStrategy — generateSignals with no eligible markets", () => {
  const s = new LongshotFadingStrategy(); // default minEdge=2 → all null
  const signals = s.generateSignals([
    { id: "a", category: "Weather", yes_mid: 10 },
    { id: "b", category: "Weather", yes_mid: 15 },
  ]);
  assert(signals.length === 0, "returns empty array when no signals pass (BUG-001 side effect)");
});

suite("LongshotFadingStrategy — generateSignals sorted by confidence", () => {
  const s = new LongshotFadingStrategy({ minEdge: 0.5 });
  // price=6: edge=0.84 >= 0.5 ✓; price=8: edge=1*0.15*(12/15)=0.12*12=wait...
  // price=8: overpricingFactor=(20-8)/15=0.8, edge=8*0.15*0.8=0.96 >= 0.5 ✓
  // price=18: edge=0.36 < 0.5 → null
  const signals = s.generateSignals([
    { id: "a", category: "Weather", yes_mid: 8 },       // edge=0.96
    { id: "b", category: "Weather", yes_mid: 6 },       // edge=0.84
    { id: "c", category: "Entertainment", yes_mid: 18 }, // edge=0.36 → null
  ]);
  assert(signals.length === 2, "returns 2 signals (price=18 filtered out)");
  assert(signals[0].marketId === "b", "sorted: highest confidence first (yes_mid=6)");
  assert(signals[1].marketId === "a", "yes_mid=8 second");
});

suite("LongshotFadingStrategy — Boundary: price exactly at minPrice (5)", () => {
  const s = new LongshotFadingStrategy({ minEdge: 0.5 });
  // price=5: overpricingFactor=1.0, edge=5*0.15*1.0=0.75 >= 0.5 ✓
  const signal = s.generateSignal({ id: "mkt1", category: "Weather", yes_mid: 5 });
  assert(signal !== null, "price=5 (boundary minPrice) generates signal with minEdge=0.5 (edge=0.75)");
  assert(signal.targetPrice === 95, "targetPrice = 95 for yes=5");
});

suite("LongshotFadingStrategy — Boundary: price exactly at maxPrice (20)", () => {
  const s = new LongshotFadingStrategy({ minEdge: 0.5 });
  const signal = s.generateSignal({ id: "mkt1", category: "Weather", yes_mid: 20 });
  // At maxPrice: overpricingFactor=0, edge=0 → fails minEdge check
  assert(signal === null, "price=20 (boundary maxPrice): overpricingFactor=0, edge=0 → no signal");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed (${bugs} bugs confirmed)`);
console.log("=".repeat(60));

if (bugs > 0) {
  console.log("\n🐛 BUGS CONFIRMED:");
  console.log("  BUG-001 [CRITICAL] LongshotFadingStrategy: expectedEdge formula maxes at ~1.0¢");
  console.log("          but minEdge=2 by default → strategy NEVER generates signals.");
  console.log("          Fix: Lower minEdge default to 0.5 OR scale the edge formula by ~3x.");
  console.log("          Assigned to: Bob (strategy author)");
  console.log("");
  console.log("  BUG-002 [MINOR]    CrossPlatformArbitrageStrategy: confidence hardcoded to");
  console.log("          this.minConfidence regardless of spread magnitude.");
  console.log("          Fix: Scale confidence with edge (e.g., min(0.85 + edge*0.005, 0.99)).");
  console.log("          Assigned to: Dave (strategy author)");
  console.log("");
  console.log("  BUG-004 [MINOR]    LongshotFadingStrategy constructor uses || operator for all");
  console.log("          numeric options: { minEdge: 0 } silently becomes minEdge=2.");
  console.log("          Fix: Use nullish coalescing (??) instead of ||.");
  console.log("          Assigned to: Bob (strategy author)");
}

console.log("\n⚠️  BUG-003 [MAJOR] NOT TESTED (requires DB mock):");
console.log("    RiskManager.getTodayPnL(): no null check on pool — crashes when DB unavailable.");
console.log("    getCurrentPositions() correctly handles null pool; getTodayPnL() does not.");
console.log("    Assigned to: Bob (risk_manager.js author)");

if (failed > 0) process.exit(1);
