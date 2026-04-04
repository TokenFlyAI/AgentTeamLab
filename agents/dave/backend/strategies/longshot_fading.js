/**
 * Longshot Fading Strategy
 * Sells YES contracts priced 5¢-20¢ in niche categories
 * Based on UCD/GWU 2025 research on favorite-longshot bias
 * 
 * Author: Dave (Full Stack Engineer)
 * Task: #220
 */

"use strict";

/**
 * LongshotFadingStrategy generates signals to sell overpriced longshots.
 * Research shows contracts priced 5¢-20¢ lose ~60% of invested capital
 * due to retail overpricing of tail-risk events.
 */
class LongshotFadingStrategy {
  constructor(options = {}) {
    this.name = "LongshotFading";
    this.minPrice = options.minPrice || 5;    // Minimum YES price to consider
    this.maxPrice = options.maxPrice || 20;   // Maximum YES price to consider
    this.targetCategories = options.targetCategories || [
      "Weather", 
      "Entertainment", 
      "Culture",
      "Geopolitics"
    ];
    this.minConfidence = options.minConfidence || 0.7;
    this.minEdge = options.minEdge || 2;
  }

  /**
   * Generate a signal for a single market
   * @param {Object} market - Market data from Bob's API
   * @returns {Object|null} Signal or null if no opportunity
   */
  generateSignal(market) {
    // Filter by category
    if (!this.targetCategories.includes(market.category)) {
      return null;
    }

    const yesPrice = market.yes_mid || market.yesPrice || market.yesBid;
    if (!yesPrice) return null;

    // Check if price is in our target range (5¢-20¢)
    if (yesPrice < this.minPrice || yesPrice > this.maxPrice) {
      return null;
    }

    // Calculate edge based on favorite-longshot bias research
    // Research shows 5-20¢ contracts are systematically overpriced
    // Higher overpricing at lower prices
    const overpricingFactor = (this.maxPrice - yesPrice) / (this.maxPrice - this.minPrice);
    const expectedEdge = Math.min(yesPrice * 0.15 * overpricingFactor, 10);
    
    // Confidence based on price (lower price = higher confidence in overpricing)
    const confidence = Math.min(this.minConfidence + (0.25 * overpricingFactor), 0.95);

    // Skip if doesn't meet minimums
    if (confidence < this.minConfidence || expectedEdge < this.minEdge) {
      return null;
    }

    return {
      marketId: market.id,
      side: "no",  // Sell YES = buy NO (or sell YES directly if supported)
      signalType: "entry",
      confidence,
      targetPrice: 100 - yesPrice,  // NO price
      currentPrice: 100 - yesPrice,
      expectedEdge: Math.round(expectedEdge),
      recommendedContracts: 10,  // Will be overridden by PositionSizer
      reason: `Longshot fade: YES=${yesPrice}¢ in ${market.category}. ` +
        `Overpricing factor: ${overpricingFactor.toFixed(2)}. ` +
        `Research: UCD/GWU 2025 favorite-longshot bias study.`,
      metadata: {
        strategy: this.name,
        yesPrice,
        category: market.category,
        overpricingFactor,
        researchBasis: "UCD/GWU 2025 - favorite-longshot bias on Kalshi"
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

module.exports = { LongshotFadingStrategy };
