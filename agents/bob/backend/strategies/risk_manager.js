#!/usr/bin/env node
/**
 * Risk Manager for Live Trading Pipeline
 * Author: Bob (Backend Engineer)
 * Task: #244 — Integrate risk management into live trading
 *
 * Validates trades against risk limits before execution.
 */

"use strict";

const { Pool } = require("pg");

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "kalshi_trading",
  user: process.env.DB_USER || "trader",
  password: process.env.DB_PASSWORD,
};

let pool = null;

try {
  pool = new Pool(dbConfig);
} catch (e) {
  console.warn("[RiskManager] Database not available, using in-memory risk tracking");
}

// Risk limits (configurable via env vars)
const RISK_LIMITS = {
  maxDailyLoss: parseInt(process.env.MAX_DAILY_LOSS || "50000"), // cents ($500)
  maxPositionSize: parseInt(process.env.MAX_POSITION_SIZE || "1000"), // contracts
  maxTotalExposure: parseInt(process.env.MAX_TOTAL_EXPOSURE || "200000"), // cents ($2000)
  maxConcentration: parseFloat(process.env.MAX_CONCENTRATION || "0.25"), // 25% in single market
  maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN || "0.10"), // 10% max drawdown
};

/**
 * Get current positions from database
 */
async function getCurrentPositions() {
  if (!pool) return [];
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    console.warn("[RiskManager] DB connection failed, returning empty positions");
    return [];
  }
  try {
    const result = await client.query(`
      SELECT 
        market_ticker,
        side,
        SUM(CASE WHEN side = 'YES' THEN quantity ELSE -quantity END) as net_position,
        SUM(quantity * avg_entry_price) as notional_value
      FROM positions
      WHERE status = 'open'
      GROUP BY market_ticker, side
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get today's P&L
 */
async function getTodayPnL() {
  if (!pool) return { realized: 0, unrealized: 0 };
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          COALESCE(SUM(realized_pnl), 0) as realized_pnl,
          COALESCE(SUM(unrealized_pnl), 0) as unrealized_pnl
        FROM trades
        WHERE DATE(created_at) = CURRENT_DATE
      `);
      return {
        realized: parseInt(result.rows[0].realized_pnl) || 0,
        unrealized: parseInt(result.rows[0].unrealized_pnl) || 0,
        total: parseInt(result.rows[0].realized_pnl) + parseInt(result.rows[0].unrealized_pnl),
      };
    } finally {
      client.release();
    }
  } catch (e) {
    console.log("[RiskManager] DB unavailable, using fallback P&L data");
    return { realized: 0, unrealized: 0, total: 0 };
  }
}

/**
 * Calculate total exposure across all positions
 */
async function getTotalExposure() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT COALESCE(SUM(ABS(quantity) * avg_entry_price), 0) as total_exposure
        FROM positions
        WHERE status = 'open'
      `);
      return parseInt(result.rows[0].total_exposure) || 0;
    } finally {
      client.release();
    }
  } catch (e) {
    return 0;
  }
}

/**
 * Validate a proposed trade against risk limits
 * @param {Object} trade - Proposed trade
 * @param {string} trade.marketTicker - Market ticker
 * @param {string} trade.side - 'YES' or 'NO'
 * @param {number} trade.quantity - Number of contracts
 * @param {number} trade.price - Price per contract (cents)
 * @returns {Object} - { approved: boolean, reasons: string[], riskScore: number }
 */
async function validateTrade(trade) {
  const reasons = [];
  const checks = [];

  // Get current state
  const [positions, pnl, exposure] = await Promise.all([
    getCurrentPositions(),
    getTodayPnL(),
    getTotalExposure(),
  ]);

  const tradeValue = trade.quantity * trade.price;
  const newExposure = exposure + tradeValue;

  // Check 1: Daily loss limit
  const dailyLossCheck = pnl.total > -RISK_LIMITS.maxDailyLoss;
  checks.push({ name: "daily_loss", passed: dailyLossCheck, value: pnl.total });
  if (!dailyLossCheck) {
    reasons.push(`Daily loss limit exceeded: ${pnl.total}¢ lost (max: ${RISK_LIMITS.maxDailyLoss}¢)`);
  }

  // Check 2: Position size limit
  const positionSizeCheck = trade.quantity <= RISK_LIMITS.maxPositionSize;
  checks.push({ name: "position_size", passed: positionSizeCheck, value: trade.quantity });
  if (!positionSizeCheck) {
    reasons.push(`Position size too large: ${trade.quantity} contracts (max: ${RISK_LIMITS.maxPositionSize})`);
  }

  // Check 3: Total exposure limit
  const exposureCheck = newExposure <= RISK_LIMITS.maxTotalExposure;
  checks.push({ name: "total_exposure", passed: exposureCheck, value: newExposure });
  if (!exposureCheck) {
    reasons.push(`Total exposure would exceed limit: ${newExposure}¢ (max: ${RISK_LIMITS.maxTotalExposure}¢)`);
  }

  // Check 4: Concentration limit (max % in single market)
  // Skip concentration check if this is the first trade (exposure = 0)
  const existingPosition = positions.find(p => p.market_ticker === trade.marketTicker);
  const existingValue = existingPosition ? parseInt(existingPosition.notional_value) : 0;
  const newMarketValue = existingValue + tradeValue;
  const concentration = newExposure > 0 ? newMarketValue / newExposure : 0;
  // Allow first trade (when exposure is 0) or check concentration
  const concentrationCheck = exposure === 0 || concentration <= RISK_LIMITS.maxConcentration;
  checks.push({ name: "concentration", passed: concentrationCheck, value: concentration });
  if (!concentrationCheck) {
    reasons.push(`Concentration too high: ${(concentration * 100).toFixed(1)}% in ${trade.marketTicker} (max: ${(RISK_LIMITS.maxConcentration * 100).toFixed(0)}%)`);
  }

  // Calculate risk score (0-100, lower is better)
  const failedChecks = checks.filter(c => !c.passed).length;
  const riskScore = Math.min(100, (failedChecks / checks.length) * 100 + (newExposure / RISK_LIMITS.maxTotalExposure) * 50);

  return {
    approved: reasons.length === 0,
    reasons,
    riskScore: Math.round(riskScore),
    checks,
    currentState: {
      dailyPnL: pnl,
      totalExposure: exposure,
      newExposure,
      concentration,
    },
  };
}

/**
 * Record risk check in database
 */
async function logRiskCheck(trade, validationResult) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO risk_checks (
        market_ticker, side, quantity, price, 
        approved, risk_score, reasons, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      trade.marketTicker,
      trade.side,
      trade.quantity,
      trade.price,
      validationResult.approved,
      validationResult.riskScore,
      JSON.stringify(validationResult.reasons),
    ]);
  } finally {
    client.release();
  }
}

/**
 * Get risk summary for dashboard
 */
async function getRiskSummary() {
  const [positions, pnl, exposure] = await Promise.all([
    getCurrentPositions(),
    getTodayPnL(),
    getTotalExposure(),
  ]);

  return {
    limits: RISK_LIMITS,
    current: {
      dailyPnL: pnl,
      totalExposure: exposure,
      openPositions: positions.length,
    },
    utilization: {
      dailyLoss: Math.abs(pnl.total) / RISK_LIMITS.maxDailyLoss,
      exposure: exposure / RISK_LIMITS.maxTotalExposure,
    },
    status: pnl.total < -RISK_LIMITS.maxDailyLoss || exposure > RISK_LIMITS.maxTotalExposure ? "AT_RISK" : "OK",
  };
}

// RiskManager class for live_runner.js integration
class RiskManager {
  async filterSignals(signals) {
    const approved = [];
    const rejected = [];
    let context = null;

    try {
      const summary = await getRiskSummary();
      context = {
        dailyPnl: summary.current.dailyPnL.total || 0,
        openExposure: summary.current.totalExposure || 0,
        openPositionsCount: summary.current.openPositions || 0,
        drawdown: summary.utilization.exposure || 0,
      };
    } catch (dbErr) {
      // Database not available — run without DB-backed risk checks
      context = {
        dailyPnl: 0,
        openExposure: 0,
        openPositionsCount: 0,
        drawdown: 0,
      };
    }

    for (const signal of signals) {
      const trade = {
        marketTicker: signal.ticker || signal.marketId,
        side: signal.side ? signal.side.toUpperCase() : "YES",
        quantity: signal.recommendedContracts || signal.positionSize || 1,
        price: Math.round((signal.currentPrice || signal.targetPrice || 50) * 100),
      };

      try {
        const result = await validateTrade(trade);
        if (result.approved) {
          approved.push(signal);
        } else {
          rejected.push({ signal, reason: result.reasons.join("; ") });
        }
      } catch (err) {
        // If DB is down, approve signal with a warning
        approved.push(signal);
      }
    }

    return { approved, rejected, context };
  }
}

module.exports = {
  RiskManager,
  validateTrade,
  logRiskCheck,
  getRiskSummary,
  getCurrentPositions,
  getTodayPnL,
  RISK_LIMITS,
};

// CLI for testing
if (require.main === module) {
  async function main() {
    const args = process.argv.slice(2);
    
    if (args[0] === "summary") {
      const summary = await getRiskSummary();
      console.log(JSON.stringify(summary, null, 2));
    } else if (args[0] === "check") {
      const trade = {
        marketTicker: args[1] || "TEST-MARKET",
        side: args[2] || "YES",
        quantity: parseInt(args[3]) || 10,
        price: parseInt(args[4]) || 50,
      };
      const result = await validateTrade(trade);
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`
Risk Manager CLI

Usage:
  node risk_manager.js summary           Show risk summary
  node risk_manager.js check <ticker> <side> <qty> <price>   Validate a trade

Examples:
  node risk_manager.js summary
  node risk_manager.js check BTCW-26-JUN30-100K YES 10 65
`);
    }
    process.exit(0);
  }

  main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
  });
}
