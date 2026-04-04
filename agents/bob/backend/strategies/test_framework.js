/**
 * Strategy Framework Unit Test
 * Tests signal generation, position sizing, and P&L tracking without database.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

const { SignalEngine } = require("./signal_engine");
const { PositionSizer } = require("./position_sizer");
const { MeanReversionStrategy } = require("./strategies/mean_reversion");
const { MomentumStrategy } = require("./strategies/momentum");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

function runTests() {
  console.log("Running strategy framework tests...\n");

  // Test 1: SignalEngine arbitrage detection
  console.log("Test 1: Arbitrage detection");
  const engine = new SignalEngine({ minConfidence: 0.1, minEdge: 1 });
  const arbMarkets = [
    { id: "m1", yes_mid: 65, no_mid: 40, volume: 100000 }, // sum = 105
    { id: "m2", yes_mid: 48, no_mid: 48, volume: 100000 }, // sum = 96
    { id: "m3", yes_mid: 45, no_mid: 55, volume: 100000 }, // sum = 100
  ];
  const arbSignals = engine.detectArbitrage(arbMarkets);
  assert(arbSignals.length === 2, "Expected 2 arbitrage signals");
  assert(arbSignals[0].marketId === "m1", "Expected m1 as highest confidence");
  console.log("  PASS: Detected 2 arbitrage opportunities\n");

  // Test 2: Mean reversion strategy
  console.log("Test 2: Mean reversion strategy");
  const mrStrategy = new MeanReversionStrategy({ zScoreThreshold: 1.0, minVolume: 1000 });
  const mrMarket = {
    id: "m4",
    yes_mid: 80,
    volume: 50000,
    price_history_mean: 60,
    price_history_stddev: 10,
  };
  const mrSignal = mrStrategy.generateSignal(mrMarket);
  assert(mrSignal !== null, "Expected mean reversion signal");
  assert(mrSignal.side === "no", "Expected 'no' side when price is above mean");
  assert(mrSignal.confidence > 0.5, "Expected high confidence");
  console.log("  PASS: Generated mean reversion signal\n");

  // Test 3: Momentum strategy
  console.log("Test 3: Momentum strategy");
  const momStrategy = new MomentumStrategy({ priceChangeThreshold: 5, minVolume: 1000 });
  const momMarket = {
    id: "m5",
    yes_mid: 70,
    no_mid: 30,
    volume24h: 100000,
    price_change_24h: 10,
  };
  const momSignal = momStrategy.generateSignal(momMarket);
  assert(momSignal !== null, "Expected momentum signal");
  assert(momSignal.side === "yes", "Expected 'yes' side for positive momentum");
  console.log("  PASS: Generated momentum signal\n");

  // Test 4: Position sizing
  console.log("Test 4: Position sizing");
  const sizer = new PositionSizer({ accountBalance: 100000, maxRiskPerTrade: 0.02 }); // $1000, 2% risk
  const sized = sizer.sizePosition({
    currentPrice: 50,
    expectedEdge: 5,
    confidence: 0.8,
  }, { volume: 100000 });
  assert(sized.contracts > 0, "Expected positive contract count");
  assert(sized.riskAmount <= 2000, "Risk should not exceed 2% of account");
  assert(sized.contracts <= 1000, "Contracts should not exceed max");
  console.log(`  PASS: Sized position to ${sized.contracts} contracts (risk=$${(sized.riskAmount/100).toFixed(2)})\n`);

  // Test 5: Signal validation
  console.log("Test 5: Signal validation");
  const defaultEngine = new SignalEngine(); // minConfidence = 0.3
  const invalidSignal = {
    marketId: "m6",
    side: "yes",
    signalType: "entry",
    confidence: 0.1, // below default minConfidence of 0.3
    expectedEdge: 5,
  };
  assert(!defaultEngine._validateSignal(invalidSignal), "Expected low-confidence signal to be rejected");
  console.log("  PASS: Low-confidence signal correctly rejected\n");

  // Test 6: Signal engine scan
  console.log("Test 6: Signal engine scan");
  const scanEngine = new SignalEngine({ minConfidence: 0.3, minEdge: 1 });
  const markets = [
    { id: "m7", yes_mid: 85, volume: 50000, price_history_mean: 60, price_history_stddev: 10 },
    { id: "m8", yes_mid: 55, volume: 50000, price_history_mean: 55, price_history_stddev: 2 },
  ];
  const signals = scanEngine.scan(markets, mrStrategy);
  assert(signals.length >= 1, "Expected at least one signal from scan");
  assert(signals[0].marketId === "m7", "Expected m7 to generate signal");
  console.log("  PASS: Scan generated signals and sorted by confidence\n");

  // Test 7: PnLTracker helpers
  console.log("Test 7: PnLTracker computeSharpeRatio and computeMaxDrawdown");
  const tracker = new (require("./pnl_tracker").PnLTracker)();
  const sampleReturns = [120, -80, 240, 0, 180, -120, 300];
  const sharpe = tracker.computeSharpeRatio(sampleReturns, 100000);
  const maxDd = tracker.computeMaxDrawdown(sampleReturns);
  assert(typeof sharpe === "number" && !isNaN(sharpe), "Expected valid Sharpe ratio");
  assert(maxDd >= 0, "Expected max drawdown >= 0");
  console.log(`  PASS: Sharpe=${sharpe.toFixed(3)}, MaxDD=${maxDd}c\n`);

  // Test 8: Empty returns edge cases
  console.log("Test 8: Empty returns edge cases");
  assert(tracker.computeSharpeRatio([]) === 0, "Expected 0 Sharpe for empty returns");
  assert(tracker.computeSharpeRatio([100]) === 0, "Expected 0 Sharpe for single return");
  assert(tracker.computeMaxDrawdown([]) === 0, "Expected 0 MaxDD for empty returns");
  console.log("  PASS: Edge cases handled\n");

  console.log("All tests passed!");
}

runTests();
