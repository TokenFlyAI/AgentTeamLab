#!/usr/bin/env node
/**
 * Compare synthetic market generator against legacy deterministic fallback.
 * Demonstrates that the new generator produces realistic, parameter-sensitive data.
 */

"use strict";

const { generateCandles } = require("./synthetic_market_generator");

// Legacy fetchCandles logic (simplified)
function legacyFetchCandles(ticker, days) {
  const basePrice = ticker === "BTCW-25-DEC31" ? 16 : ticker === "UNEMP-25-MAR" ? 56 : 86;
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seededRandom = (n) => {
    const x = Math.sin(seed + n) * 10000;
    return x - Math.floor(x);
  };
  return Array.from({ length: days }, (_, i) => ({
    yes_close: basePrice + Math.floor(seededRandom(i) * 10 - 5),
  }));
}

function computeMetrics(candles) {
  const prices = candles.map((c) => c.yes_close);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stddev = Math.sqrt(variance);
  const zScore = (prices[prices.length - 1] - mean) / stddev;
  return { mean, stddev, zScore: stddev > 0 ? zScore : 0 };
}

const tickers = ["BTCW-26-JUN30-100K", "ETHW-26-DEC31-5K", "KXNF-20260501-T150000"];
const days = 20;

console.log("=== Synthetic vs Legacy Candle Comparison ===\n");

for (const ticker of tickers) {
  const legacy = legacyFetchCandles(ticker, days);
  const synthetic = generateCandles(ticker, days);

  const legMetrics = computeMetrics(legacy);
  const synMetrics = computeMetrics(synthetic);

  console.log(`${ticker}:`);
  console.log(`  Legacy:    mean=${legMetrics.mean.toFixed(1)}, stddev=${legMetrics.stddev.toFixed(1)}, z=${legMetrics.zScore.toFixed(2)}`);
  console.log(`  Synthetic: mean=${synMetrics.mean.toFixed(1)}, stddev=${synMetrics.stddev.toFixed(1)}, z=${synMetrics.zScore.toFixed(2)}`);
  console.log("");
}

console.log("=== Parameter Sensitivity Test (Synthetic) ===\n");
const { SignalEngine } = require("../strategies/signal_engine");
const { MeanReversionStrategy } = require("../strategies/strategies/mean_reversion");

const market = {
  id: "m4",
  ticker: "BTCW-26-JUN30-100K",
  yes_mid: 64,
  no_mid: 36,
  volume: 890000,
};

for (const z of [0.5, 1.0, 1.5, 2.0, 2.5]) {
  const candles = generateCandles(market.ticker, 20);
  const prices = candles.map((c) => c.yes_close);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stddev = Math.sqrt(variance);

  const enriched = { ...market, price_history_mean: mean, price_history_stddev: stddev };
  const engine = new SignalEngine({ minConfidence: 0.80, minEdge: 1 });
  const strategy = new MeanReversionStrategy({ zScoreThreshold: z, minVolume: 1000 });
  const signals = engine.scan([enriched], strategy);

  console.log(`  zScore=${z}: signals=${signals.length}, market_z=${((market.yes_mid - mean) / stddev).toFixed(2)}`);
}
