#!/usr/bin/env node
/**
 * Paper Trade Settlement — Task 330
 * Automatically settles open paper trades based on price movement
 * Author: Bob (Backend Engineer)
 */

"use strict";

const { getPaperTradesDB } = require("./paper_trades_db");

// Settlement configuration
const SETTLEMENT_CONFIG = {
  // Number of "candles" (runs) before settlement check
  minCandlesBeforeSettlement: 3,
  // Contract value in cents ($1 per contract)
  contractValue: 100,
  // Fee per contract (Kalshi standard: 0.5% of notional, capped at $1)
  feePerContract: 1,
};

/**
 * Calculate P&L for a settled trade
 * @param {Object} trade - Trade record
 * @param {number} currentPrice - Current market price in cents
 * @returns {number} P&L in cents (negative for loss, positive for win)
 */
function calculatePnL(trade, currentPrice) {
  const { direction, contracts, entry_price } = trade;
  
  // Price movement in cents
  const priceDelta = currentPrice - entry_price;
  
  // For YES position: profit if price goes up
  // For NO position: profit if price goes down
  const directionMultiplier = direction === "YES" ? 1 : -1;
  
  // Gross P&L: price movement * contracts * contract value
  const grossPnL = priceDelta * contracts * directionMultiplier;
  
  // Fees: entry + exit (2 * fee per contract)
  const totalFees = SETTLEMENT_CONFIG.feePerContract * contracts * 2;
  
  // Net P&L
  return grossPnL - totalFees;
}

/**
 * Determine if a trade should be settled based on age
 * @param {Object} trade - Trade record
 * @param {number} currentRunNumber - Current scheduler run number
 * @returns {boolean}
 */
function shouldSettle(trade, currentRunNumber) {
  if (trade.status !== "OPEN") return false;
  
  // Use metadata.runNumber to track when trade was opened
  const openRunNumber = trade.metadata?.runNumber || 0;
  const candlesElapsed = currentRunNumber - openRunNumber;
  
  return candlesElapsed >= SETTLEMENT_CONFIG.minCandlesBeforeSettlement;
}

/**
 * Settle a single trade
 * @param {Object} trade - Trade to settle
 * @param {Object} marketData - Current market data { ticker, yes_price }
 * @param {number} runNumber - Current run number
 * @returns {Object} Settlement result
 */
function settleTrade(trade, marketData, runNumber) {
  const currentPrice = marketData.yes_price || marketData.yes_mid || 50;
  const pnl = calculatePnL(trade, currentPrice);
  
  const db = getPaperTradesDB();
  const closedTrade = db.closeTrade(trade.id, currentPrice, pnl);
  
  // Update with settlement metadata
  db.updateTrade(trade.id, {
    metadata: {
      ...trade.metadata,
      settledAtRun: runNumber,
      settlementPrice: currentPrice,
      priceDelta: currentPrice - trade.entry_price,
    },
  });
  
  return {
    tradeId: trade.id,
    market: trade.market,
    direction: trade.direction,
    entryPrice: trade.entry_price,
    exitPrice: currentPrice,
    pnl: pnl,
    outcome: closedTrade.outcome,
    contracts: trade.contracts,
  };
}

/**
 * Run settlement for all eligible open trades
 * @param {Array} markets - Current market data array
 * @param {number} runNumber - Current scheduler run number
 * @returns {Object} Settlement summary
 */
function runSettlement(markets, runNumber = 0) {
  const db = getPaperTradesDB();
  const openTrades = db.getTrades({ status: "OPEN" });
  
  const settled = [];
  const skipped = [];
  const errors = [];
  
  for (const trade of openTrades) {
    try {
      // Check if trade is old enough to settle
      if (!shouldSettle(trade, runNumber)) {
        skipped.push({ tradeId: trade.id, reason: "too_recent" });
        continue;
      }
      
      // Find current market data for this trade
      const marketData = markets.find(m => 
        m.ticker === trade.market || m.id === trade.market
      );
      
      if (!marketData) {
        skipped.push({ tradeId: trade.id, reason: "market_not_found" });
        continue;
      }
      
      // Settle the trade
      const result = settleTrade(trade, marketData, runNumber);
      settled.push(result);
      
    } catch (e) {
      errors.push({ tradeId: trade.id, error: e.message });
    }
  }
  
  // Calculate summary stats
  const totalPnL = settled.reduce((sum, s) => sum + s.pnl, 0);
  const wins = settled.filter(s => s.outcome === "WIN").length;
  const losses = settled.filter(s => s.outcome === "LOSS").length;
  
  return {
    runNumber,
    timestamp: new Date().toISOString(),
    settled: settled.length,
    skipped: skipped.length,
    errors: errors.length,
    totalPnL,
    wins,
    losses,
    details: { settled, skipped, errors },
  };
}

/**
 * Get settlement status summary
 * @returns {Object} Current settlement state
 */
function getSettlementStatus() {
  const db = getPaperTradesDB();
  const summary = db.getSummary();
  
  return {
    openTrades: summary.open_trades,
    closedTrades: summary.closed_trades,
    totalTrades: summary.total_trades,
    winRate: summary.win_rate,
    totalPnL: summary.total_pnl_dollars,
    config: SETTLEMENT_CONFIG,
  };
}

module.exports = {
  runSettlement,
  getSettlementStatus,
  calculatePnL,
  shouldSettle,
  settleTrade,
  SETTLEMENT_CONFIG,
};
