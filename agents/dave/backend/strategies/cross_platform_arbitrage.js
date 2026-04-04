/**
 * Cross-Platform Arbitrage Strategy
 * Exploits pricing divergences between Kalshi and other platforms
 * 
 * Author: Dave (Full Stack Engineer)
 * Task: #220
 */

"use strict";

/**
 * CrossPlatformArbitrageStrategy detects price divergences between
 * Kalshi and other prediction markets (Polymarket, etc.).
 */
class CrossPlatformArbitrageStrategy {
  constructor(options = {}) {
    this.name = "CrossPlatformArbitrage";
    this.minSpread = options.minSpread || 3;  // Min 3 cent spread after fees
    this.maxHoldMinutes = options.maxHoldMinutes || 60;
    this.estimatedFees = options.estimatedFees || 2;  // ~2 cents in fees per side
    this.minConfidence = options.minConfidence || 0.85;
    this.minEdge = options.minEdge || 1;
  }

  /**
   * Generate a signal for a single market
   * @param {Object} market - Market data with external price feeds
   * @returns {Object|null} Signal or null if no opportunity
   */
  generateSignal(market) {
    // Check for cross-platform price data
    if (!market.externalPrices || Object.keys(market.externalPrices).length === 0) {
      return null;
    }

    const kalshiYesPrice = market.yes_mid || market.yesPrice;
    if (!kalshiYesPrice) return null;

    // Find best arbitrage opportunity across all platforms
    let bestOpportunity = null;
    let bestEdge = 0;

    for (const [platform, externalPrice] of Object.entries(market.externalPrices)) {
      const spread = Math.abs(kalshiYesPrice - externalPrice);
      
      // Calculate edge after estimated fees
      const edge = spread - (this.estimatedFees * 2);  // Fees on both sides
      
      if (edge > bestEdge && edge >= this.minEdge && spread >= this.minSpread) {
        bestEdge = edge;
        
        // Determine trade direction
        const kalshiCheaper = kalshiYesPrice < externalPrice;
        const side = kalshiCheaper ? "yes" : "no";
        const targetPrice = kalshiCheaper ? kalshiYesPrice : (100 - kalshiYesPrice);
        
        bestOpportunity = {
          platform,
          externalPrice,
          kalshiPrice: kalshiYesPrice,
          spread,
          edge,
          side,
          targetPrice
        };
      }
    }

    if (!bestOpportunity) {
      return null;
    }

    return {
      marketId: market.id,
      side: bestOpportunity.side,
      signalType: "entry",
      confidence: this.minConfidence,
      targetPrice: bestOpportunity.targetPrice,
      currentPrice: bestOpportunity.targetPrice,
      expectedEdge: Math.round(bestOpportunity.edge),
      recommendedContracts: 10,
      reason: `Arbitrage: ${bestOpportunity.platform}=${bestOpportunity.externalPrice}¢ ` +
        `vs Kalshi=${bestOpportunity.kalshiPrice}¢. ` +
        `Spread=${bestOpportunity.spread.toFixed(1)}¢, ` +
        `Edge after fees=${bestOpportunity.edge.toFixed(1)}¢. ` +
        `Hold max ${this.maxHoldMinutes}min.`,
      metadata: {
        strategy: this.name,
        platform: bestOpportunity.platform,
        kalshiPrice: bestOpportunity.kalshiPrice,
        externalPrice: bestOpportunity.externalPrice,
        spread: bestOpportunity.spread,
        estimatedFees: this.estimatedFees,
        maxHoldMinutes: this.maxHoldMinutes,
        marketTitle: market.title,
        marketCategory: market.category
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
    return signals.sort((a, b) => b.expectedEdge - a.expectedEdge);
  }
}

module.exports = { CrossPlatformArbitrageStrategy };
