/**
 * Economic Edge Strategy
 * Reads signals from Grace's econ_edges_today.json file
 */

"use strict";

const fs = require("fs");
const path = require("path");

class EconEdgeStrategy {
  constructor(options = {}) {
    this.name = "econ_edge";
    this.edgesPath = options.edgesPath || path.join(__dirname, "../../../../grace/output/econ_edges_today.json");
    this.loaded = false;
    this.signals = new Map();
    this.lastError = null;
  }

  /**
   * Load signals from econ_edges_today.json
   */
  _loadSignals() {
    if (this.loaded) return;

    try {
      const data = fs.readFileSync(this.edgesPath, "utf8");
      const json = JSON.parse(data);
      const opportunities = json.opportunities || [];

      for (const opp of opportunities) {
        // Convert edge to signal format
        const ticker = opp.ticker;
        if (!ticker) continue;

        // Parse recommendation (BUY_YES -> yes, BUY_NO -> no)
        const rec = opp.recommendation || "";
        const side = rec.includes("YES") ? "yes" : rec.includes("NO") ? "no" : null;
        
        if (!side) continue;

        // Calculate confidence from edge magnitude (capped at 0.95)
        const edgeAbs = Math.abs(opp.edge || 0);
        const confidence = Math.min(edgeAbs * 0.5 + 0.3, 0.95);

        // Get market price
        const marketPrice = opp.kalshi_yes_price || 50;
        const targetPrice = side === "yes" ? marketPrice : 100 - marketPrice;

        // Expected edge in cents
        const expectedEdge = Math.round(edgeAbs * 100);

        // Skip if edge is too small
        if (expectedEdge < 2) continue;

        const signal = {
          marketId: ticker,
          side: side,
          signalType: "entry",
          confidence: confidence,
          targetPrice: targetPrice,
          currentPrice: targetPrice,
          expectedEdge: expectedEdge,
          recommendedContracts: 10,
          reason: `Econ edge: ${opp.title} - ${opp.recommendation} (model=${(opp.model_probability * 100).toFixed(1)}%, market=${marketPrice}c)`,
        };

        this.signals.set(ticker, signal);
      }

      this.loaded = true;
      console.log(`[EconEdgeStrategy] Loaded ${this.signals.size} signals from ${this.edgesPath}`);
    } catch (err) {
      this.lastError = err.message;
      console.error(`[EconEdgeStrategy] Failed to load signals: ${err.message}`);
      this.loaded = true; // prevent repeated attempts
    }
  }

  /**
   * Generate a signal for a single market
   */
  generateSignal(market) {
    this._loadSignals();

    const ticker = market.ticker || market.id || "";
    
    // Only process Economics/Financial markets that match our signals
    const signal = this.signals.get(ticker);
    if (!signal) {
      return null;
    }

    return signal;
  }

  /**
   * Get all loaded signals (for batch processing)
   */
  getAllSignals() {
    this._loadSignals();
    return Array.from(this.signals.values());
  }
}

module.exports = { EconEdgeStrategy };
