/**
 * Paper Trading Execution Engine
 * Validates signals, submits paper orders to Kalshi demo, records fills and positions.
 * Author: Bob (Backend Engineer)
 * Task: #225
 */

"use strict";

const { randomUUID } = require("crypto");

function uuidv4() {
  return randomUUID();
}

class ExecutionEngine {
  constructor(options = {}) {
    this.kalshiClient = options.kalshiClient || null;
    this.pool = options.pool || null;
    this.demoMode = options.demoMode !== false;

    // Risk limits
    this.maxDailyLoss = options.maxDailyLoss || 50000; // cents ($500)
    this.maxPositionSize = options.maxPositionSize || 1000; // contracts
    this.maxTotalExposure = options.maxTotalExposure || 200000; // cents ($2000)
    this.maxOrdersPerRun = options.maxOrdersPerRun || 10;
  }

  /**
   * Validate a signal against risk limits.
   * @param {Object} signal - sized signal
   * @param {Object} context - { dailyPnl, openExposure, openPositionsCount }
   * @returns {Object} { valid: boolean, reason?: string }
   */
  validateSignal(signal, context = {}) {
    const sizing = signal.sizing || {};
    const contracts = sizing.contracts || 0;
    const riskAmount = sizing.riskAmount || 0;
    const positionValue = sizing.positionValue || 0;

    if (contracts < 1) {
      return { valid: false, reason: "Zero or negative contract count" };
    }

    if (contracts > this.maxPositionSize) {
      return { valid: false, reason: `Exceeds max position size (${this.maxPositionSize})` };
    }

    const dailyPnl = context.dailyPnl || 0;
    if (dailyPnl - riskAmount < -this.maxDailyLoss) {
      return { valid: false, reason: `Would exceed max daily loss ($${this.maxDailyLoss / 100})` };
    }

    const openExposure = context.openExposure || 0;
    if (openExposure + positionValue > this.maxTotalExposure) {
      return { valid: false, reason: `Would exceed max total exposure ($${this.maxTotalExposure / 100})` };
    }

    const openPositionsCount = context.openPositionsCount || 0;
    if (openPositionsCount >= this.maxOrdersPerRun) {
      return { valid: false, reason: `Max orders per run reached (${this.maxOrdersPerRun})` };
    }

    return { valid: true };
  }

  /**
   * Get current risk context from database.
   * @returns {Promise<Object>}
   */
  async getRiskContext() {
    if (!this.pool) {
      return { dailyPnl: 0, openExposure: 0, openPositionsCount: 0 };
    }
    const client = await this.pool.connect();
    try {
      // Today's realized P&L from trades
      const pnlResult = await client.query(
        `SELECT COALESCE(SUM(attributed_pnl), 0) as daily_pnl
         FROM strategy_trades st
         JOIN trades t ON st.trade_id = t.id
         WHERE t.traded_at >= CURRENT_DATE`
      );
      const dailyPnl = parseInt(pnlResult.rows[0]?.daily_pnl || 0);

      // Open exposure from positions
      const exposureResult = await client.query(
        `SELECT COALESCE(SUM(contracts * avg_entry_price), 0) as open_exposure,
                COUNT(*) as open_positions_count
         FROM positions WHERE status = 'open'`
      );
      const openExposure = parseInt(exposureResult.rows[0]?.open_exposure || 0);
      const openPositionsCount = parseInt(exposureResult.rows[0]?.open_positions_count || 0);

      return { dailyPnl, openExposure, openPositionsCount };
    } catch (e) {
      console.error("getRiskContext error:", e.message);
      return { dailyPnl: 0, openExposure: 0, openPositionsCount: 0 };
    } finally {
      client.release();
    }
  }

  /**
   * Submit a paper order to Kalshi demo API or simulate it.
   * @param {Object} signal - sized signal
   * @param {Object} market - market data
   * @returns {Promise<Object>} order result
   */
  async submitOrder(signal, market) {
    const ticker = market.ticker;
    const side = signal.side;
    const contracts = signal.sizing.contracts;
    const price = signal.targetPrice || signal.currentPrice;
    const clientOrderId = `paper-${uuidv4()}`;

    let kalshiOrder = null;

    if (this.kalshiClient && !this.demoMode) {
      // Real Kalshi submission
      try {
        kalshiOrder = await this.kalshiClient.createOrder({
          ticker,
          side,
          count: contracts,
          price,
          client_order_id: clientOrderId,
        });
      } catch (err) {
        return { success: false, error: err.message, clientOrderId };
      }
    } else {
      // Simulate demo order
      kalshiOrder = {
        order_id: `demo-${uuidv4()}`,
        ticker,
        side,
        count: contracts,
        price,
        client_order_id: clientOrderId,
        status: "filled",
        filled_count: contracts,
        avg_fill_price: price,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    return { success: true, order: kalshiOrder, clientOrderId };
  }

  /**
   * Record order and fill in the database.
   * @param {Object} signal - sized signal
   * @param {Object} market - market data
   * @param {Object} orderResult - result from submitOrder
   * @returns {Promise<Object>} recorded order
   */
  async recordOrder(signal, market, orderResult) {
    if (!this.pool) {
      return { id: "mock-order-id", ...orderResult };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Get market internal UUID
      const marketResult = await client.query(
        `SELECT id FROM markets WHERE ticker = $1`,
        [market.ticker]
      );
      const marketId = marketResult.rows[0]?.id;
      if (!marketId) {
        await client.query("ROLLBACK");
        return { error: `Market ${market.ticker} not found in DB` };
      }

      const ko = orderResult.order || {};
      const orderId = uuidv4();

      // Insert order
      await client.query(
        `INSERT INTO orders (id, market_id, kalshi_order_id, client_order_id, side, action, contracts, price, status, filled_contracts, avg_fill_price, filled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          orderId,
          marketId,
          ko.order_id || null,
          orderResult.clientOrderId || null,
          signal.side,
          "buy",
          signal.sizing.contracts,
          signal.targetPrice || signal.currentPrice,
          ko.status || "filled",
          ko.filled_count || signal.sizing.contracts,
          ko.avg_fill_price || signal.targetPrice || signal.currentPrice,
          ko.status === "filled" ? new Date() : null,
        ]
      );

      // If filled, record trade and position
      if ((ko.status || "filled") === "filled" && (ko.filled_count || signal.sizing.contracts) > 0) {
        const fillPrice = ko.avg_fill_price || signal.targetPrice || signal.currentPrice;
        const fillContracts = ko.filled_count || signal.sizing.contracts;

        // Record trade
        await client.query(
          `INSERT INTO trades (order_id, market_id, side, contracts, price, kalshi_trade_id, traded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderId,
            marketId,
            signal.side,
            fillContracts,
            fillPrice,
            `demo-trade-${uuidv4()}`,
            new Date(),
          ]
        );

        // Upsert position
        const posResult = await client.query(
          `SELECT id, contracts, avg_entry_price FROM positions WHERE market_id = $1 AND side = $2 AND status = 'open'`,
          [marketId, signal.side]
        );

        if (posResult.rows.length > 0) {
          const pos = posResult.rows[0];
          const totalContracts = parseInt(pos.contracts) + fillContracts;
          const totalCost = parseInt(pos.contracts) * parseInt(pos.avg_entry_price) + fillContracts * fillPrice;
          const newAvgPrice = Math.round(totalCost / totalContracts);

          await client.query(
            `UPDATE positions SET contracts = $1, avg_entry_price = $2, updated_at = NOW() WHERE id = $3`,
            [totalContracts, newAvgPrice, pos.id]
          );
        } else {
          await client.query(
            `INSERT INTO positions (market_id, side, contracts, avg_entry_price, opening_order_id, status, opened_at)
             VALUES ($1, $2, $3, $4, $5, 'open', NOW())`,
            [marketId, signal.side, fillContracts, fillPrice, orderId]
          );
        }
      }

      await client.query("COMMIT");
      return { id: orderId, success: true };
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("recordOrder error:", e.message);
      return { error: e.message };
    } finally {
      client.release();
    }
  }

  /**
   * Execute a list of signals.
   * @param {Array} signals - sized signals
   * @param {Array} markets - market data
   * @returns {Promise<Object>} execution report
   */
  async executeSignals(signals, markets) {
    const marketMap = Object.fromEntries(markets.map((m) => [m.id || m.ticker, m]));
    const context = await this.getRiskContext();
    const results = [];

    for (const signal of signals) {
      const market = marketMap[signal.marketId];
      if (!market) {
        results.push({ signal, status: "skipped", reason: "Market not found" });
        continue;
      }

      const validation = this.validateSignal(signal, context);
      if (!validation.valid) {
        results.push({ signal, status: "rejected", reason: validation.reason });
        continue;
      }

      const orderResult = await this.submitOrder(signal, market);
      if (!orderResult.success) {
        results.push({ signal, status: "failed", reason: orderResult.error });
        continue;
      }

      const record = await this.recordOrder(signal, market, orderResult);
      if (record.error) {
        results.push({ signal, status: "failed", reason: record.error });
        continue;
      }

      // Update context
      context.openPositionsCount += 1;
      context.openExposure += signal.sizing.positionValue || 0;

      results.push({ signal, status: "executed", orderId: record.id });
    }

    return {
      executedAt: new Date().toISOString(),
      totalSignals: signals.length,
      executed: results.filter((r) => r.status === "executed").length,
      rejected: results.filter((r) => r.status === "rejected").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
    };
  }

  /**
   * Get open paper positions with market info.
   * @returns {Promise<Array>}
   */
  async getOpenPositions() {
    if (!this.pool) return [];
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT p.*, m.ticker, m.title
         FROM positions p
         JOIN markets m ON p.market_id = m.id
         WHERE p.status = 'open'
         ORDER BY p.opened_at DESC`
      );
      return result.rows;
    } catch (e) {
      console.error("getOpenPositions error:", e.message);
      return [];
    } finally {
      client.release();
    }
  }
}

module.exports = { ExecutionEngine };
