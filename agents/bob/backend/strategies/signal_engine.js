/**
 * Signal Engine
 * Scans markets and generates trading signals based on strategy rules.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

/**
 * Signal represents a trading opportunity.
 * @typedef {Object} Signal
 * @property {string} marketId - UUID of the market
 * @property {string} side - 'yes' or 'no'
 * @property {string} signalType - 'entry', 'exit', or 'hold'
 * @property {number} confidence - 0.0 to 1.0
 * @property {number} targetPrice - suggested entry price in cents
 * @property {number} currentPrice - current market price in cents
 * @property {number} expectedEdge - expected profit edge in cents
 * @property {number} recommendedContracts - position size recommendation
 * @property {string} reason - human-readable signal reason
 */

class SignalEngine {
  constructor(options = {}) {
    this.minConfidence = options.minConfidence || 0.3;
    this.minEdge = options.minEdge || 2; // minimum 2 cents edge
    this.maxSignalsPerRun = options.maxSignalsPerRun || 50;
  }

  /**
   * Scan a list of markets and generate signals using the provided strategy.
   * @param {Array} markets - list of market objects with prices
   * @param {Object} strategy - strategy instance with generateSignal(market) method
   * @returns {Array<Signal>} generated signals
   */
  scan(markets, strategy) {
    const signals = [];
    for (const market of markets) {
      if (signals.length >= this.maxSignalsPerRun) break;
      const signal = strategy.generateSignal(market);
      if (signal && this._validateSignal(signal)) {
        signals.push(signal);
      }
    }
    return signals.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Validate a signal meets minimum thresholds.
   * T331: Added stricter confidence validation to prevent NULL confidence trades
   */
  _validateSignal(signal) {
    if (!signal) return false;
    
    // T331: Strict confidence validation - must be a valid number between 0 and 1
    if (signal.confidence == null) {
      console.warn(`[SignalEngine] Rejecting signal for ${signal.marketId}: confidence is null`);
      return false;
    }
    if (typeof signal.confidence !== 'number' || isNaN(signal.confidence)) {
      console.warn(`[SignalEngine] Rejecting signal for ${signal.marketId}: confidence is not a valid number (${signal.confidence})`);
      return false;
    }
    if (signal.confidence < 0 || signal.confidence > 1) {
      console.warn(`[SignalEngine] Rejecting signal for ${signal.marketId}: confidence out of range (${signal.confidence})`);
      return false;
    }
    if (signal.confidence < this.minConfidence) return false;
    if (signal.expectedEdge < this.minEdge) return false;
    if (!["yes", "no"].includes(signal.side)) return false;
    if (!["entry", "exit", "hold"].includes(signal.signalType)) return false;
    return true;
  }

  /**
   * Detect arbitrage opportunities where yes + no prices don't sum to ~100.
   * @param {Array} markets - markets with yes_price and no_price
   * @returns {Array<Signal>} arbitrage signals
   */
  detectArbitrage(markets) {
    const signals = [];
    for (const market of markets) {
      if (signals.length >= this.maxSignalsPerRun) break;
      const yesPrice = market.yes_mid || market.yesPrice || 50;
      const noPrice = market.no_mid || market.noPrice || 50;
      const sum = yesPrice + noPrice;

      // If sum > 102, there's an arbitrage: sell both sides
      // If sum < 98, there's an arbitrage: buy both sides
      if (sum > 102) {
        signals.push({
          marketId: market.id,
          side: "yes",
          signalType: "entry",
          confidence: Math.min((sum - 100) / 10, 0.95),
          targetPrice: yesPrice,
          currentPrice: yesPrice,
          expectedEdge: sum - 100,
          recommendedContracts: 10,
          reason: `Arbitrage: yes+no=${sum}c > 100. Sell both sides.`,
        });
      } else if (sum < 98) {
        signals.push({
          marketId: market.id,
          side: "yes",
          signalType: "entry",
          confidence: Math.min((100 - sum) / 10, 0.95),
          targetPrice: yesPrice,
          currentPrice: yesPrice,
          expectedEdge: 100 - sum,
          recommendedContracts: 10,
          reason: `Arbitrage: yes+no=${sum}c < 100. Buy both sides.`,
        });
      }
    }
    return signals.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Detect mispricing based on historical volatility.
   * A simple z-score approach: price deviation from mean.
   * @param {Array} markets - current market prices
   * @param {Object} historyMap - map of marketId -> Array of historical prices
   * @returns {Array<Signal>} mean-reversion signals
   */
  detectMeanReversion(markets, historyMap) {
    const signals = [];
    for (const market of markets) {
      if (signals.length >= this.maxSignalsPerRun) break;
      const history = historyMap[market.id];
      if (!history || history.length < 5) continue;

      const prices = history.map((h) => h.yes_close || h.yesPrice || h.price || 50);
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
      const stdDev = Math.sqrt(variance);
      const currentPrice = market.yes_mid || market.yesPrice || 50;
      const zScore = stdDev > 0 ? (currentPrice - mean) / stdDev : 0;

      if (Math.abs(zScore) > 1.5) {
        const side = zScore > 0 ? "no" : "yes"; // revert to mean
        const edge = Math.abs(zScore) * stdDev;
        signals.push({
          marketId: market.id,
          side,
          signalType: "entry",
          confidence: Math.min(Math.abs(zScore) / 3, 0.95),
          targetPrice: currentPrice,
          currentPrice,
          expectedEdge: Math.round(edge),
          recommendedContracts: 10,
          reason: `Mean reversion: z-score=${zScore.toFixed(2)}, mean=${mean.toFixed(1)}`,
        });
      }
    }
    return signals.sort((a, b) => b.confidence - a.confidence);
  }
}

module.exports = { SignalEngine };
