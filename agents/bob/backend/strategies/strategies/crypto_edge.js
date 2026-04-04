/**
 * Crypto Edge Strategy
 * Bridges Dave's Python crypto edge scanner to Bob's Node.js StrategyRunner.
 * Author: Charlie (Quant Research)
 * Task: #234
 */

"use strict";

const { execSync } = require("child_process");
const path = require("path");

class CryptoEdgeStrategy {
  constructor(options = {}) {
    this.name = "crypto_edge";
    this.signals = new Map();
    this.loaded = false;
    this.lastError = null;
  }

  /**
   * Load signals by running Dave's Python adapter with --json flag.
   * Caches results so generateSignal() is fast.
   */
  _loadSignals() {
    if (this.loaded) return;

    const scriptPath = path.resolve(
      __dirname,
      "../../../..",
      "dave/output/crypto_edge_analysis.py"
    );

    try {
      const output = execSync(`python "${scriptPath}" --json`, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: path.dirname(scriptPath),
      });

      // Extract the JSON array from mixed stdout (same technique as NFP strategy)
      const jsonStart = output.lastIndexOf("[");
      const jsonEnd = output.lastIndexOf("]");
      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        throw new Error("Could not find JSON signal array in Python output");
      }

      const signals = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
      for (const signal of signals) {
        this.signals.set(signal.marketId, signal);
      }
      this.loaded = true;
    } catch (err) {
      this.lastError = err.message;
      console.error(`[CryptoEdgeStrategy] Failed to load signals: ${err.message}`);
      this.loaded = true; // prevent repeated attempts in same run
    }
  }

  /**
   * Generate a signal for a single market.
   * Called by StrategyRunner for each active market.
   * @param {Object} market
   * @returns {Object|null}
   */
  generateSignal(market) {
    this._loadSignals();

    const ticker = market.ticker || market.id || "";
    if (!ticker.startsWith("BTCW") && !ticker.startsWith("ETHW")) {
      return null;
    }

    const signal = this.signals.get(ticker);
    if (!signal) {
      return null;
    }

    // Ensure all required fields are present for Bob's SignalEngine
    // Use market.id as marketId so live_runner marketMap lookups work correctly
    return {
      marketId: market.id || ticker,
      ticker: signal.marketId || ticker,
      side: signal.side,
      signalType: signal.signalType || "entry",
      confidence: signal.confidence,
      targetPrice: signal.targetPrice,
      currentPrice: signal.currentPrice,
      expectedEdge: signal.expectedEdge,
      recommendedContracts: signal.recommendedContracts || 10,
      reason: signal.reason || "Crypto edge signal",
    };
  }
}

module.exports = { CryptoEdgeStrategy };
