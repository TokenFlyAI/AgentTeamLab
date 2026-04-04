#!/usr/bin/env node
/**
 * Kalshi Trading API — Integration Test
 * Author: Mia (API Engineer)
 * Task: #219 — End-to-end data flow validation
 *
 * Tests:
 *   1. API health check
 *   2. Fetch markets
 *   3. Fetch market prices (history)
 *   4. Fetch orderbook
 *   5. Portfolio summary
 *   6. Paper order lifecycle
 *   7. Strategy list and run
 */

"use strict";

const { KalshiSdk } = require("./kalshi_sdk");

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const sdk = new KalshiSdk({ baseUrl: BASE_URL, timeout: 10000 });

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failCount++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("\n🚀 Kalshi Trading API Integration Tests");
  console.log(`   Base URL: ${BASE_URL}\n`);

  // 1. Health Check
  await test("Health check returns ok", async () => {
    const res = await sdk.healthCheck();
    assert(res.status === "ok", "Expected status ok");
    assert(res.timestamp, "Expected timestamp");
  });

  // 2. Markets
  let testTicker = null;
  await test("GET /api/markets returns active markets", async () => {
    const res = await sdk.getMarkets();
    assert(Array.isArray(res.markets), "Expected markets array");
    if (res.markets.length > 0) {
      testTicker = res.markets[0].ticker;
      assert(res.markets[0].ticker, "Expected ticker");
      assert(res.markets[0].title, "Expected title");
    }
  });

  await test("GET /api/markets?category=Economics filters correctly", async () => {
    const res = await sdk.getMarkets({ category: "Economics" });
    assert(Array.isArray(res.markets), "Expected markets array");
    // If markets exist, they should all be Economics
    for (const m of res.markets) {
      assert(m.category === "Economics", `Expected category Economics, got ${m.category}`);
    }
  });

  // 3. Market Detail
  await test("GET /api/markets/:ticker returns market detail", async () => {
    if (!testTicker) {
      console.log("      (skipped — no markets available)");
      return;
    }
    const res = await sdk.getMarket(testTicker);
    assert(res.market, "Expected market object");
    assert(res.market.ticker === testTicker, "Expected matching ticker");
  });

  // 4. Price History
  await test("GET /api/markets/:ticker/history returns price data", async () => {
    if (!testTicker) {
      console.log("      (skipped — no markets available)");
      return;
    }
    const res = await sdk.getMarketPrices(testTicker, { resolution: "1d", days: 7 });
    assert(typeof res.count === "number", "Expected count");
    assert(Array.isArray(res.data), "Expected data array");
    assert(res.ticker === testTicker, "Expected matching ticker");
  });

  // 5. Orderbook
  await test("GET /api/markets/:ticker/orderbook returns orderbook", async () => {
    if (!testTicker) {
      console.log("      (skipped — no markets available)");
      return;
    }
    const res = await sdk.getOrderbook(testTicker, 5);
    assert(res.ticker === testTicker, "Expected matching ticker");
    assert(typeof res.depth === "number", "Expected depth");
    assert(Array.isArray(res.bids), "Expected bids array");
    assert(Array.isArray(res.asks), "Expected asks array");
  });

  // 6. Portfolio
  await test("GET /api/portfolio returns portfolio summary", async () => {
    const res = await sdk.getPortfolio();
    assert(res.snapshot !== undefined, "Expected snapshot");
    assert(res.positions !== undefined, "Expected positions");
  });

  await test("GET /api/portfolio/positions returns positions array", async () => {
    const res = await sdk.getPositions();
    assert(Array.isArray(res.positions), "Expected positions array");
  });

  // 7. Paper Trading
  let createdOrderId = null;
  await test("POST /api/orders creates a paper order", async () => {
    // Need a marketId to place an order
    const marketsRes = await sdk.getMarkets({ limit: 1 });
    if (!marketsRes.markets || marketsRes.markets.length === 0) {
      console.log("      (skipped — no markets available to trade)");
      return;
    }
    const marketId = marketsRes.markets[0].id;
    const res = await sdk.placeOrder({
      marketId,
      side: "yes",
      action: "buy",
      contracts: 10,
      price: 50,
      clientOrderId: "integration-test-001",
    });
    assert(res.order, "Expected order object");
    assert(res.order.status === "pending", "Expected pending status");
    createdOrderId = res.order.id;
  });

  await test("GET /api/orders/:id retrieves the order", async () => {
    if (!createdOrderId) {
      console.log("      (skipped — no order created)");
      return;
    }
    const res = await sdk.getOrder(createdOrderId);
    assert(res.order, "Expected order object");
    assert(res.order.id === createdOrderId, "Expected matching order ID");
  });

  await test("DELETE /api/orders/:id cancels the order", async () => {
    if (!createdOrderId) {
      console.log("      (skipped — no order created)");
      return;
    }
    const res = await sdk.cancelOrder(createdOrderId);
    assert(res.order, "Expected order object");
    assert(res.order.status === "cancelled", "Expected cancelled status");
  });

  // 8. Strategies
  await test("GET /api/strategies returns strategies list", async () => {
    const res = await sdk.getStrategies();
    assert(Array.isArray(res.strategies), "Expected strategies array");
  });

  // Summary
  console.log("\n📊 Test Results");
  console.log(`   Passed: ${passCount}`);
  console.log(`   Failed: ${failCount}`);
  console.log(`   Total:  ${passCount + failCount}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("\n💥 Fatal error during tests:", e.message);
  process.exit(1);
});
