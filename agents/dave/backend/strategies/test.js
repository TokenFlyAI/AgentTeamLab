/**
 * Smoke test for strategy framework integration.
 * Tests StrategyClient against mock API.
 */

const { StrategyClient } = require("./client");
const { MeanReversionStrategy } = require("../../../bob/backend/strategies/strategies/mean_reversion");
const { SignalEngine, PositionSizer, StrategyRunner } = require("../../../bob/backend/strategies/index");

async function runTests() {
  console.log("=== Strategy Framework Integration Smoke Test ===\n");

  // 1. API client health check
  const client = new StrategyClient();
  const health = await client.health();
  console.log("Health:", health);

  // 2. Fetch markets
  const markets = await client.getMarkets({ category: "Economics" });
  console.log(`Markets fetched: ${markets.length}`);
  if (markets.length > 0) {
    console.log("First market ticker:", markets[0].ticker);
  }

  // 3. Bob's signal engine + mean reversion strategy with mock data
  const engine = new SignalEngine({ minConfidence: 0.3, minEdge: 2 });
  const strategy = new MeanReversionStrategy({ zScoreThreshold: 1.0 });

  const mockMarkets = [
    { id: "m1", ticker: "TEST-YES", yes_mid: 86, no_mid: 14, volume: 50000, price_history_mean: 50, price_history_stddev: 15 },
    { id: "m2", ticker: "TEST-NO", yes_mid: 16, no_mid: 84, volume: 50000, price_history_mean: 50, price_history_stddev: 15 },
    { id: "m3", ticker: "TEST-FLAT", yes_mid: 51, no_mid: 49, volume: 50000, price_history_mean: 50, price_history_stddev: 2 },
  ];

  const signals = engine.scan(mockMarkets, strategy);
  console.log(`\nSignals generated from mock data: ${signals.length}`);
  for (const s of signals) {
    console.log(`  ${s.marketId} → ${s.side} (conf=${s.confidence.toFixed(2)}, edge=${s.expectedEdge}, reason=${s.reason})`);
  }

  // 4. Position sizer
  const sizer = new PositionSizer({ accountBalance: 100000, maxRiskPerTrade: 0.02 });
  for (const s of signals) {
    const sizing = sizer.sizePosition(s, mockMarkets.find((m) => m.id === s.marketId));
    console.log(`  Position size for ${s.marketId}: ${sizing.contracts} contracts`);
  }

  // 5. P&L tracker (Bob's version is DB-backed; skip in-memory test)
  console.log("\nPnL tracker: using Bob's DB-backed implementation");

  console.log("\n=== All tests passed ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
