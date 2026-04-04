/**
 * Position Sizer
 * Calculates optimal position sizes based on risk management rules.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

class PositionSizer {
  constructor(options = {}) {
    // Account-level constraints
    this.accountBalance = options.accountBalance || 500000; // cents ($5,000 default)
    this.maxRiskPerTrade = options.maxRiskPerTrade || 0.02; // 2% max risk per trade
    this.maxPositionPct = options.maxPositionPct || 0.20; // 20% max in single position
    this.minContracts = options.minContracts || 1;
    this.maxContracts = options.maxContracts || 1000;

    // Kelly criterion settings
    this.useKelly = options.useKelly || false;
    this.kellyFraction = options.kellyFraction || 0.25; // fractional Kelly (quarter Kelly)
  }

  /**
   * Calculate position size for a signal.
   * @param {Object} signal - signal with confidence, expectedEdge, currentPrice, side
   * @param {Object} market - market data with volume, openInterest
   * @returns {Object} sizing result: { contracts, riskAmount, reason }
   */
  sizePosition(signal, market = {}) {
    const price = signal.currentPrice || 50;
    const edge = signal.expectedEdge || 0;
    const confidence = signal.confidence || 0;

    // Base risk amount: fixed fractional
    const maxRiskAmount = Math.floor(this.accountBalance * this.maxRiskPerTrade);

    // Risk per contract: if buying at price, max loss is price (goes to 0)
    const riskPerContract = price; // in cents

    let contracts = 0;
    if (riskPerContract > 0) {
      contracts = Math.floor(maxRiskAmount / riskPerContract);
    }

    // Apply Kelly criterion if enabled
    if (this.useKelly && edge > 0 && price > 0) {
      // Simplified Kelly: f* = edge / odds
      // For binary markets, odds = price / (100 - price)
      const winProb = confidence;
      const lossProb = 1 - winProb;
      const winAmount = 100 - price;
      const lossAmount = price;
      const kelly =
        winProb > 0 && lossAmount > 0
          ? (winProb / lossAmount) - (lossProb / winAmount)
          : 0;
      const fractionalKelly = kelly * this.kellyFraction;
      const kellyContracts = Math.floor(
        (this.accountBalance * fractionalKelly) / price
      );
      contracts = Math.min(contracts, kellyContracts);
    }

    // Apply confidence scaling
    contracts = Math.floor(contracts * confidence);

    // Apply market liquidity constraint: max 1% of daily volume
    const volume = market.volume || market.volume24h || 0;
    if (volume > 0) {
      const liquidityCap = Math.floor(volume * 0.01);
      contracts = Math.min(contracts, liquidityCap);
    }

    // Apply max position size constraint
    const maxPositionValue = Math.floor(this.accountBalance * this.maxPositionPct);
    const maxByPosition = Math.floor(maxPositionValue / price);
    contracts = Math.min(contracts, maxByPosition);

    // Hard limits
    contracts = Math.max(contracts, this.minContracts);
    contracts = Math.min(contracts, this.maxContracts);

    const riskAmount = contracts * riskPerContract;
    const positionValue = contracts * price;

    return {
      contracts,
      riskAmount,
      positionValue,
      riskPctOfAccount: (riskAmount / this.accountBalance).toFixed(4),
      positionPctOfAccount: (positionValue / this.accountBalance).toFixed(4),
      reason: `Fixed fractional sizing: ${this.maxRiskPerTrade * 100}% risk, ` +
        `confidence=${(confidence * 100).toFixed(1)}%, ` +
        `price=${price}c, edge=${edge}c`,
    };
  }

  /**
   * Update account balance.
   * @param {number} balance - new balance in cents
   */
  setAccountBalance(balance) {
    this.accountBalance = balance;
  }

  /**
   * Batch size multiple signals.
   * @param {Array} signals - array of signals
   * @param {Object} marketMap - map of marketId -> market data
   * @returns {Array} signals with sizing appended
   */
  sizeSignals(signals, marketMap = {}) {
    return signals.map((signal) => {
      const market = marketMap[signal.marketId] || {};
      const sizing = this.sizePosition(signal, market);
      return { ...signal, sizing };
    });
  }
}

module.exports = { PositionSizer };
