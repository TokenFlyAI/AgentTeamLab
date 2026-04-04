/**
 * Economic Data Momentum Strategy
 * Trades scheduled macro markets using pre-release information edge
 * 
 * Author: Dave (Full Stack Engineer)
 * Task: #220
 */

"use strict";

/**
 * EconomicMomentumStrategy trades economic data releases.
 * Compares Kalshi implied probability to high-quality forecasts
 * (Atlanta Fed, Cleveland Fed, private surveys).
 */
class EconomicMomentumStrategy {
  constructor(options = {}) {
    this.name = "EconomicMomentum";
    this.targetCategories = options.targetCategories || ["Economics", "Financial"];
    this.minDivergence = options.minDivergence || 8;  // Min 8 percentage point divergence
    this.maxHoursToRelease = options.maxHoursToRelease || 48;
    this.minConfidence = options.minConfidence || 0.6;
    this.minEdge = options.minEdge || 3;
  }

  /**
   * Generate a signal for a single market
   * @param {Object} market - Market data with forecast information
   * @returns {Object|null} Signal or null if no opportunity
   */
  generateSignal(market) {
    // Filter by category
    if (!this.targetCategories.includes(market.category)) {
      return null;
    }

    // Check if we have forecast data
    if (!market.forecast || typeof market.forecast.probability !== 'number') {
      return null;
    }

    // Check timing (only trade within X hours of release)
    if (market.hoursToRelease > this.maxHoursToRelease) {
      return null;
    }

    const yesPrice = market.yes_mid || market.yesPrice || 50;
    const impliedProb = yesPrice / 100;
    const forecastProb = market.forecast.probability;
    
    // Calculate divergence in percentage points
    const divergence = Math.abs(impliedProb - forecastProb) * 100;

    if (divergence < this.minDivergence) {
      return null;
    }

    // Calculate edge and confidence
    const edge = divergence * 0.5;  // Conservative: half the divergence
    const confidence = Math.min(0.5 + (divergence / 100), 0.9);

    if (confidence < this.minConfidence || edge < this.minEdge) {
      return null;
    }

    // Trade in direction of forecast
    const side = forecastProb > impliedProb ? "yes" : "no";
    const targetPrice = side === "yes" ? yesPrice : (100 - yesPrice);

    return {
      marketId: market.id,
      side,
      signalType: "entry",
      confidence,
      targetPrice,
      currentPrice: targetPrice,
      expectedEdge: Math.round(edge),
      recommendedContracts: 10,
      reason: `Economic momentum: ${market.title || market.ticker}. ` +
        `Implied=${(impliedProb * 100).toFixed(1)}%, ` +
        `Forecast=${(forecastProb * 100).toFixed(1)}% ` +
        `(source: ${market.forecast.source}), ` +
        `divergence=${divergence.toFixed(1)}pp`,
      metadata: {
        strategy: this.name,
        impliedProbability: impliedProb,
        forecastProbability: forecastProb,
        divergence,
        forecastSource: market.forecast.source,
        hoursToRelease: market.hoursToRelease,
        releaseDate: market.closeDate
      }
    };
  }

  /**
   * Batch generate signals for multiple markets
   * @param {Array} markets - Array of market objects
   * @returns {Array} Array of signals
   */
  generateSignals(markets) {
    const signals = [];
    for (const market of markets) {
      const signal = this.generateSignal(market);
      if (signal) {
        signals.push(signal);
      }
    }
    return signals.sort((a, b) => b.confidence - a.confidence);
  }
}

module.exports = { EconomicMomentumStrategy };
