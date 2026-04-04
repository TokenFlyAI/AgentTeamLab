#!/usr/bin/env node
/**
 * Paper Trades Database — Task 323
 * Persistent SQLite storage for paper trading P&L tracking
 * Author: Bob (Backend Engineer)
 */

"use strict";

const path = require("path");
const fs = require("fs");

// Database path
const DB_DIR = path.join(__dirname, "..", "output");
const DB_PATH = path.join(DB_DIR, "paper_trades.db");

// Ensure directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Simple JSON-based persistence (SQLite-like interface)
// Can be upgraded to real SQLite if needed
class PaperTradesDB {
  constructor() {
    this.dbPath = DB_PATH;
    this.trades = [];
    this.initialized = false;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, "utf8");
        this.trades = JSON.parse(data);
      } else {
        this.trades = [];
      }
      this.initialized = true;
    } catch (e) {
      console.error("[PaperTradesDB] Failed to load:", e.message);
      this.trades = [];
      this.initialized = true;
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.trades, null, 2));
      return true;
    } catch (e) {
      console.error("[PaperTradesDB] Failed to save:", e.message);
      return false;
    }
  }

  /**
   * Record a new paper trade
   * @param {Object} trade - Trade details
   * @param {string} trade.timestamp - ISO timestamp
   * @param {string} trade.market - Market ticker
   * @param {string} trade.signal_type - Strategy name (mean_reversion, etc.)
   * @param {number} trade.confidence - Signal confidence (0-1)
   * @param {string} trade.direction - 'YES' or 'NO'
   * @param {number} trade.contracts - Number of contracts
   * @param {number} trade.entry_price - Entry price in cents
   * @param {string} trade.status - 'OPEN', 'CLOSED', 'CANCELLED'
   * @param {number} trade.pnl - Realized P&L in cents (when closed)
   * @param {string} trade.outcome - 'WIN', 'LOSS', 'PENDING'
   * @returns {Object} Saved trade with id
   */
  recordTrade(trade) {
    const record = {
      id: `pt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: trade.timestamp || new Date().toISOString(),
      market: trade.market || trade.ticker,
      signal_type: trade.signal_type || trade.strategy || "unknown",
      confidence: trade.confidence != null ? trade.confidence : null,
      direction: trade.direction || trade.side?.toUpperCase(),
      contracts: trade.contracts || trade.quantity || 1,
      entry_price: trade.entry_price || trade.price,
      exit_price: trade.exit_price || null,
      status: trade.status || "OPEN",
      pnl: trade.pnl != null ? trade.pnl : null,
      outcome: trade.outcome || "PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: trade.metadata || {},
    };

    this.trades.push(record);
    this._save();
    return record;
  }

  /**
   * Update an existing trade (e.g., when closing)
   * @param {string} id - Trade ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} Updated trade or null
   */
  updateTrade(id, updates) {
    const idx = this.trades.findIndex(t => t.id === id);
    if (idx === -1) return null;

    this.trades[idx] = {
      ...this.trades[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this._save();
    return this.trades[idx];
  }

  /**
   * Close a trade with P&L
   * @param {string} id - Trade ID
   * @param {number} exitPrice - Exit price in cents
   * @param {number} pnl - Realized P&L in cents
   * @returns {Object|null} Updated trade
   */
  closeTrade(id, exitPrice, pnl) {
    const outcome = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN";
    return this.updateTrade(id, {
      status: "CLOSED",
      exit_price: exitPrice,
      pnl: pnl,
      outcome: outcome,
    });
  }

  /**
   * Get all trades with optional filtering
   * @param {Object} filters - Filter criteria
   * @returns {Array} Matching trades
   */
  getTrades(filters = {}) {
    let results = [...this.trades];

    if (filters.market) {
      results = results.filter(t => t.market === filters.market);
    }
    if (filters.signal_type) {
      results = results.filter(t => t.signal_type === filters.signal_type);
    }
    if (filters.status) {
      results = results.filter(t => t.status === filters.status);
    }
    if (filters.outcome) {
      results = results.filter(t => t.outcome === filters.outcome);
    }
    if (filters.since) {
      results = results.filter(t => new Date(t.timestamp) >= new Date(filters.since));
    }

    return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Get summary statistics
   * @returns {Object} P&L summary
   */
  getSummary() {
    const closedTrades = this.trades.filter(t => t.status === "CLOSED");
    const wins = closedTrades.filter(t => t.outcome === "WIN");
    const losses = closedTrades.filter(t => t.outcome === "LOSS");
    const breakeven = closedTrades.filter(t => t.outcome === "BREAKEVEN");

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winCount = wins.length;
    const lossCount = losses.length;
    const totalClosed = closedTrades.length;

    // Win rate calculation
    const winRate = totalClosed > 0 ? winCount / totalClosed : 0;

    // Average P&L
    const avgWin = winCount > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / winCount : 0;
    const avgLoss = lossCount > 0 ? losses.reduce((sum, t) => sum + t.pnl, 0) / lossCount : 0;

    // Best and worst trades
    const sortedByPnl = [...closedTrades].sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
    const bestTrade = sortedByPnl[0] || null;
    const worstTrade = sortedByPnl[sortedByPnl.length - 1] || null;

    // By strategy
    const byStrategy = {};
    for (const trade of closedTrades) {
      const strat = trade.signal_type || "unknown";
      if (!byStrategy[strat]) {
        byStrategy[strat] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
      }
      byStrategy[strat].trades++;
      byStrategy[strat].pnl += trade.pnl || 0;
      if (trade.outcome === "WIN") byStrategy[strat].wins++;
      if (trade.outcome === "LOSS") byStrategy[strat].losses++;
    }

    // Last updated
    const lastTrade = this.trades.length > 0 
      ? this.trades.reduce((latest, t) => 
          new Date(t.updated_at) > new Date(latest.updated_at) ? t : latest
        )
      : null;

    return {
      total_trades: this.trades.length,
      closed_trades: totalClosed,
      open_trades: this.trades.filter(t => t.status === "OPEN").length,
      win_count: winCount,
      loss_count: lossCount,
      breakeven_count: breakeven.length,
      win_rate: parseFloat(winRate.toFixed(4)),
      total_pnl: totalPnl,
      total_pnl_dollars: parseFloat((totalPnl / 100).toFixed(2)),
      avg_win: parseFloat(avgWin.toFixed(2)),
      avg_loss: parseFloat(avgLoss.toFixed(2)),
      best_trade: bestTrade ? { market: bestTrade.market, pnl: bestTrade.pnl } : null,
      worst_trade: worstTrade ? { market: worstTrade.market, pnl: worstTrade.pnl } : null,
      by_strategy: byStrategy,
      last_updated: lastTrade?.updated_at || null,
    };
  }

  /**
   * Clear all trades (for testing)
   */
  clear() {
    this.trades = [];
    this._save();
  }

  /**
   * Get database stats
   */
  getStats() {
    return {
      path: this.dbPath,
      trade_count: this.trades.length,
      initialized: this.initialized,
    };
  }
}

// Singleton instance
let dbInstance = null;

function getPaperTradesDB() {
  if (!dbInstance) {
    dbInstance = new PaperTradesDB();
  }
  return dbInstance;
}

module.exports = {
  PaperTradesDB,
  getPaperTradesDB,
};
