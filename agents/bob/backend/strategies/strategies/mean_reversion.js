/**
 * Mean Reversion Strategy
 * Targets overbought/oversold markets based on price deviations from recent mean.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

class MeanReversionStrategy {
  constructor(options = {}) {
    this.lookbackPeriods = options.lookbackPeriods || 10;
    this.zScoreThreshold = options.zScoreThreshold || 1.5;
    this.minVolume = options.minVolume || 10000;
  }

  /**
   * Generate a signal for a single market.
   * This simplified version uses the current price vs a simple moving average
   * that would be pre-computed or passed in the market object.
   * @param {Object} market - market with prices
   * @returns {Object|null} signal or null
   */
  generateSignal(market) {
    const yesPrice = market.yes_mid || market.yes_price || 50;
    const noPrice = market.no_mid || market.no_price || 50;
    const volume = market.volume || 0;

    if (volume < this.minVolume) return null;

    // Use price_history_mean if available (would be computed by pipeline)
    const meanPrice = market.price_history_mean || 50;
    const stdDev = market.price_history_stddev || 10;

    if (stdDev <= 0) return null;

    const zScore = (yesPrice - meanPrice) / stdDev;

    if (Math.abs(zScore) < this.zScoreThreshold) return null;

    const side = zScore > 0 ? "no" : "yes"; // revert to mean
    const targetPrice = side === "yes" ? yesPrice : noPrice;
    const edge = Math.abs(zScore) * stdDev;
    const confidence = Math.min(Math.abs(zScore) / 3, 0.95);

    return {
      marketId: market.id,
      side,
      signalType: "entry",
      confidence,
      targetPrice,
      currentPrice: targetPrice,
      expectedEdge: Math.round(edge),
      recommendedContracts: 10,
      reason: `Mean reversion: z-score=${zScore.toFixed(2)}, mean=${meanPrice.toFixed(1)}, vol=${volume}`,
    };
  }
}

module.exports = { MeanReversionStrategy };
