#!/usr/bin/env node
/**
 * Synthetic Market Generator
 * Produces realistic, deterministic candle data for paper trading and backtesting.
 * Replaces the simplistic seeded-random fallback in fetchCandles().
 */

"use strict";

/**
 * Seeded random number generator (Mulberry32)
 * @param {number} seed
 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a realistic synthetic price path.
 * Uses an Ornstein-Uhlenbeck process for mean-reversion with occasional regime shifts.
 *
 * @param {Object} options
 * @param {number} options.days - Number of days
 * @param {number} options.basePrice - Starting price (cents, 0-100)
 * @param {number} options.mean - Long-term mean
 * @param {number} options.volatility - Daily volatility (std dev in cents)
 * @param {number} options.meanReversionSpeed - 0 = random walk, 1 = strong mean reversion
 * @param {number} options.seed - Random seed
 * @param {number} options.trend - Daily drift in cents
 */
function generatePricePath({ days, basePrice, mean, volatility, meanReversionSpeed, seed, trend = 0 }) {
  const rng = mulberry32(seed);
  const prices = [basePrice];

  for (let i = 1; i < days; i++) {
    const prev = prices[i - 1];
    // Regime shift: every ~20 days, volatility can change
    const regime = Math.floor(i / 20);
    const regimeVol = volatility * (1 + (rng() - 0.5) * 0.5); // ±25% vol change per regime
    const noise = (rng() - 0.5) * 2 * regimeVol;
    const reversion = meanReversionSpeed * (mean - prev);
    const next = prev + trend + reversion + noise;
    prices.push(Math.max(1, Math.min(99, next)));
  }
  return prices;
}

/**
 * Generate volume that correlates with price volatility.
 */
function generateVolumes(days, baseVolume, pricePath, seed) {
  const rng = mulberry32(seed + 1);
  const volumes = [];
  for (let i = 0; i < days; i++) {
    const prevPrice = i > 0 ? pricePath[i - 1] : pricePath[0];
    const priceChange = Math.abs(pricePath[i] - prevPrice);
    const volSpike = priceChange * 5000; // Higher volume on big moves
    const noise = (rng() - 0.5) * baseVolume * 0.3;
    volumes.push(Math.max(1000, Math.floor(baseVolume + volSpike + noise)));
  }
  return volumes;
}

/**
 * Map ticker characteristics to market parameters.
 */
function getMarketProfile(ticker) {
  // Crypto markets: higher volatility, weaker mean reversion
  if (ticker.includes("BTC") || ticker.includes("ETH")) {
    return { mean: 50, volatility: 8, meanReversionSpeed: 0.05, trend: 0.1 };
  }
  // Econ/financial markets: moderate volatility, stronger mean reversion
  if (ticker.includes("NFP") || ticker.includes("UNEMP") || ticker.includes("INXW")) {
    return { mean: 55, volatility: 4, meanReversionSpeed: 0.15, trend: 0 };
  }
  // Default
  return { mean: 50, volatility: 5, meanReversionSpeed: 0.1, trend: 0 };
}

/**
 * Generate candles for a given ticker.
 * @param {string} ticker
 * @param {number} days
 * @param {number} basePrice - Optional override
 * @param {number} baseVolume - Optional override
 */
function generateCandles(ticker, days, basePrice, baseVolume) {
  const profile = getMarketProfile(ticker);
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + days;
  const bp = basePrice != null ? basePrice : profile.mean;
  const bv = baseVolume != null ? baseVolume : 50000;

  const prices = generatePricePath({
    days,
    basePrice: bp,
    mean: profile.mean,
    volatility: profile.volatility,
    meanReversionSpeed: profile.meanReversionSpeed,
    seed,
    trend: profile.trend,
  });

  const volumes = generateVolumes(days, bv, prices, seed);

  const now = Date.now();
  return prices.map((price, i) => ({
    candle_time: new Date(now - (days - 1 - i) * 86400000).toISOString(),
    yes_close: Math.round(price),
    yes_volume: volumes[i],
  }));
}

// CLI usage
if (require.main === module) {
  const ticker = process.argv[2] || "BTCW-26-JUN30-100K";
  const days = parseInt(process.argv[3] || "20", 10);
  const candles = generateCandles(ticker, days);

  console.log(`Generated ${candles.length} candles for ${ticker}:\n`);
  candles.slice(0, 5).forEach((c) => {
    console.log(`  ${c.candle_time.split("T")[0]} | close=${c.yes_close} | vol=${c.yes_volume}`);
  });
  console.log("  ...");
  candles.slice(-3).forEach((c) => {
    console.log(`  ${c.candle_time.split("T")[0]} | close=${c.yes_close} | vol=${c.yes_volume}`);
  });

  const prices = candles.map((c) => c.yes_close);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  console.log(`\nStats: mean=${mean.toFixed(2)}, stddev=${Math.sqrt(variance).toFixed(2)}, range=${Math.min(...prices)}-${Math.max(...prices)}`);
}

module.exports = { generateCandles, generatePricePath, getMarketProfile, mulberry32 };
