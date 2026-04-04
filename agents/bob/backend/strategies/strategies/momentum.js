/**
 * Momentum Strategy
 * Identifies markets with strong price momentum and volume spikes.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

class MomentumStrategy {
  constructor(options = {}) {
    this.minVolume = options.minVolume || 50000;
    this.priceChangeThreshold = options.priceChangeThreshold || 5; // cents
    this.momentumWindowHours = options.momentumWindowHours || 24;
  }

  /**
   * Generate a signal for a single market.
   * @param {Object} market - market with prices and momentum data
   * @returns {Object|null} signal or null
   */
  generateSignal(market) {
    const yesPrice = market.yes_mid || market.yes_price || 50;
    const noPrice = market.no_mid || market.no_price || 50;
    const volume = market.volume || 0;
    const volume24h = market.volume24h || volume;

    if (volume24h < this.minVolume) return null;

    // Use pre-computed price change if available
    const priceChange = market.price_change_24h || 0;

    if (Math.abs(priceChange) < this.priceChangeThreshold) return null;

    // Momentum direction: follow the trend
    const side = priceChange > 0 ? "yes" : "no";
    const targetPrice = side === "yes" ? yesPrice : noPrice;
    const confidence = Math.min(Math.abs(priceChange) / 15, 0.95);
    const edge = Math.abs(priceChange) * 0.5;

    return {
      marketId: market.id,
      side,
      signalType: "entry",
      confidence,
      targetPrice,
      currentPrice: targetPrice,
      expectedEdge: Math.round(edge),
      recommendedContracts: 15,
      reason: `Momentum: ${priceChange > 0 ? "+" : ""}${priceChange}c in 24h, vol24h=${volume24h}`,
    };
  }
}

module.exports = { MomentumStrategy };
