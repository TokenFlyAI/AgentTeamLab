#!/usr/bin/env node
/**
 * First Real Paper Trade — Task 232
 * Attempts to place a paper trade on Kalshi demo. Falls back to simulated demo
 * execution when credentials are unavailable, documenting the exact gap.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { KalshiClient } = require("../kalshi_client");
const { ExecutionEngine } = require("./execution_engine");

const OUTPUT_FILE = path.join(__dirname, "../../output/first_paper_trade.json");

async function main() {
  const apiKey = process.env.KALSHI_API_KEY;
  const hasCreds = !!apiKey;

  let client = null;
  let liveMarkets = [];
  let selectedMarket = null;
  let orderResult = null;
  let error = null;

  if (hasCreds) {
    try {
      client = new KalshiClient({ apiKey, demo: true });
      const response = await client.getMarkets({ status: "active", limit: 10 });
      liveMarkets = response.data?.markets || [];

      if (liveMarkets.length > 0) {
        // Pick a liquid market (highest volume)
        selectedMarket = liveMarkets.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];

        // Place a small limit order at mid price
        const price = selectedMarket.yes_ask
          ? Math.round((selectedMarket.yes_bid + selectedMarket.yes_ask) / 2)
          : selectedMarket.yes_bid || 50;

        orderResult = await client.createOrder({
          ticker: selectedMarket.ticker,
          side: "yes",
          count: 1,
          price,
          client_order_id: `first-paper-${Date.now()}`,
        });
      }
    } catch (err) {
      error = err.message;
    }
  }

  // If no creds or live call failed, simulate with ExecutionEngine
  let simulated = null;
  if (!hasCreds || error) {
    const mockMarket = {
      id: "m-demo",
      ticker: "INXW-25-DEC31",
      title: "S&P 500 to close above 5000",
      category: "Economics",
      yes_bid: 85,
      yes_ask: 87,
      yes_mid: 86,
      no_bid: 13,
      no_ask: 15,
      no_mid: 14,
      volume: 250000,
    };

    const signal = {
      marketId: "m-demo",
      side: "yes",
      signalType: "entry",
      confidence: 0.65,
      targetPrice: 86,
      currentPrice: 86,
      expectedEdge: 4,
      sizing: { contracts: 10, riskAmount: 860, positionValue: 860 },
    };

    const engine = new ExecutionEngine({ kalshiClient: null, demoMode: true });
    const validation = engine.validateSignal(signal, { dailyPnl: 0, openExposure: 0, openPositionsCount: 0 });

    if (validation.valid) {
      const submit = await engine.submitOrder(signal, mockMarket);
      simulated = {
        validation: validation.valid,
        order: submit.order,
        fillPrice: submit.order?.price,
        fillContracts: submit.order?.filled_count,
        maxGain: submit.order?.filled_count * (100 - submit.order?.price),
        maxLoss: submit.order?.filled_count * submit.order?.price,
      };
    } else {
      simulated = { validation: false, reason: validation.reason };
    }
  }

  const report = {
    runAt: new Date().toISOString(),
    hasCredentials: hasCreds,
    credentialError: error || null,
    liveMarketCount: liveMarkets.length,
    liveMarket: selectedMarket
      ? {
          ticker: selectedMarket.ticker,
          title: selectedMarket.title,
          yesBid: selectedMarket.yes_bid,
          yesAsk: selectedMarket.yes_ask,
        }
      : null,
    liveOrder: orderResult
      ? {
          orderId: orderResult.order_id,
          status: orderResult.status,
          filledCount: orderResult.filled_count,
          avgFillPrice: orderResult.avg_fill_price,
        }
      : null,
    simulated: simulated,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

  if (hasCreds && !error) {
    console.log("✅ Live paper trade placed on Kalshi demo");
    console.log(`Market: ${selectedMarket.ticker}`);
    console.log(`Order: ${orderResult.order_id} | Status: ${orderResult.status}`);
  } else {
    console.log("⚠️ No Kalshi demo credentials available. Simulated trade executed instead.");
    console.log(`Simulated Market: INXW-25-DEC31`);
    console.log(`Simulated Fill: YES 10 contracts @ 86¢`);
    console.log(`Max Gain: $${simulated.maxGain / 100} | Max Loss: $${simulated.maxLoss / 100}`);
  }
  console.log(`\nReport written to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
