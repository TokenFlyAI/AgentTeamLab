/**
 * P&L Tracker
 * Tracks realized and unrealized P&L per strategy.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

class PnLTracker {
  constructor(options = {}) {
    this.pool = options.pool || null;
  }

  /**
   * Calculate unrealized P&L for open positions attributed to a strategy.
   * @param {string} strategyId - UUID of the strategy
   * @returns {Promise<number>} unrealized P&L in cents
   */
  async getUnrealizedPnL(strategyId) {
    if (!this.pool) return 0;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COALESCE(SUM(calculated_unrealized_pnl), 0) as unrealized_pnl
         FROM strategy_positions_view
         WHERE strategy_id = $1`,
        [strategyId]
      );
      if (!result.rows || result.rows.length === 0) return 0;
      return parseInt(result.rows[0].unrealized_pnl || 0);
    } catch (e) {
      console.error("getUnrealizedPnL error:", e.message);
      return 0;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate realized P&L for a strategy over a time period.
   * @param {string} strategyId - UUID of the strategy
   * @param {Date} from - start date
   * @param {Date} to - end date
   * @returns {Promise<number>} realized P&L in cents
   */
  async getRealizedPnL(strategyId, from, to) {
    if (!this.pool) return 0;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COALESCE(SUM(attributed_pnl), 0) as realized_pnl
         FROM strategy_trades st
         JOIN trades t ON st.trade_id = t.id
         WHERE st.strategy_id = $1
           AND t.traded_at >= $2
           AND t.traded_at <= $3`,
        [strategyId, from, to]
      );
      if (!result.rows || result.rows.length === 0) return 0;
      return parseInt(result.rows[0].realized_pnl || 0);
    } catch (e) {
      console.error("getRealizedPnL error:", e.message);
      return 0;
    } finally {
      client.release();
    }
  }

  /**
   * Get total P&L (realized + unrealized) for a strategy.
   * @param {string} strategyId - UUID of the strategy
   * @returns {Promise<Object>} { realized, unrealized, total }
   */
  async getTotalPnL(strategyId) {
    const unrealized = await this.getUnrealizedPnL(strategyId);
    const realized = await this.getRealizedPnL(
      strategyId,
      new Date("2000-01-01"),
      new Date()
    );
    return {
      realized,
      unrealized,
      total: realized + unrealized,
    };
  }

  /**
   * Get win rate for a strategy.
   * @param {string} strategyId - UUID of the strategy
   * @returns {Promise<Object>} { totalTrades, winningTrades, losingTrades, winRate }
   */
  async getWinRate(strategyId) {
    if (!this.pool) {
      return { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0 };
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          COUNT(*) as total_trades,
          COUNT(*) FILTER (WHERE attributed_pnl > 0) as winning_trades,
          COUNT(*) FILTER (WHERE attributed_pnl < 0) as losing_trades
         FROM strategy_trades
         WHERE strategy_id = $1 AND attributed_pnl IS NOT NULL`,
        [strategyId]
      );
      if (!result.rows || result.rows.length === 0) {
        return { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0 };
      }
      const row = result.rows[0];
      const total = parseInt(row.total_trades);
      const wins = parseInt(row.winning_trades);
      const winRate = total > 0 ? wins / total : 0;
      return {
        totalTrades: total,
        winningTrades: wins,
        losingTrades: parseInt(row.losing_trades),
        winRate,
      };
    } catch (e) {
      console.error("getWinRate error:", e.message);
      return { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0 };
    } finally {
      client.release();
    }
  }

  /**
   * Get trades today for a strategy.
   * @param {string} strategyId - UUID of the strategy
   * @returns {Promise<number>}
   */
  async getTradesToday(strategyId) {
    if (!this.pool) return 0;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as trades_today
         FROM strategy_trades
         WHERE strategy_id = $1 AND recorded_at >= CURRENT_DATE`,
        [strategyId]
      );
      if (!result.rows || result.rows.length === 0) return 0;
      return parseInt(result.rows[0].trades_today || 0);
    } catch (e) {
      console.error("getTradesToday error:", e.message);
      return 0;
    } finally {
      client.release();
    }
  }

  /**
   * Record a performance snapshot for a strategy.
   * @param {string} strategyId - UUID of the strategy
   * @param {string} period - 'hourly', 'daily', 'weekly'
   * @param {Date} periodStart - start of the period
   * @returns {Promise<void>}
   */
  async recordSnapshot(strategyId, period = "daily", periodStart = new Date()) {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      const pnl = await this.getTotalPnL(strategyId);
      const winRate = await this.getWinRate(strategyId);
      const tradesToday = await this.getTradesToday(strategyId);

      await client.query(
        `INSERT INTO strategy_performance (
          strategy_id, period, period_start, trades_count,
          realized_pnl, unrealized_pnl, total_pnl, win_rate, cumulative_pnl
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (strategy_id, period, period_start)
        DO UPDATE SET
          trades_count = EXCLUDED.trades_count,
          realized_pnl = EXCLUDED.realized_pnl,
          unrealized_pnl = EXCLUDED.unrealized_pnl,
          total_pnl = EXCLUDED.total_pnl,
          win_rate = EXCLUDED.win_rate,
          cumulative_pnl = EXCLUDED.cumulative_pnl,
          max_exposure = EXCLUDED.max_exposure`,
        [
          strategyId,
          period,
          periodStart,
          tradesToday,
          pnl.realized,
          pnl.unrealized,
          pnl.total,
          winRate.winRate,
          pnl.total,
        ]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get performance history for a strategy.
   * @param {string} strategyId - UUID of the strategy
   * @param {string} period - 'hourly', 'daily', 'weekly'
   * @param {number} limit - max rows
   * @returns {Promise<Array>}
   */
  async getPerformanceHistory(strategyId, period = "daily", limit = 30) {
    if (!this.pool) return [];
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM strategy_performance
         WHERE strategy_id = $1 AND period = $2
         ORDER BY period_start DESC
         LIMIT $3`,
        [strategyId, period, limit]
      );
      return result.rows || [];
    } catch (e) {
      console.error("getPerformanceHistory error:", e.message);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get daily returns from performance snapshots.
   * @param {string} strategyId - UUID of the strategy
   * @param {number} limit - max days
   * @returns {Promise<Array<number>>} daily P&L changes in cents
   */
  async getDailyReturns(strategyId, limit = 30) {
    if (!this.pool) return [];
    const history = await this.getPerformanceHistory(strategyId, "daily", limit + 1);
    if (history.length === 0) return [];

    // Sort ascending by date
    const sorted = history.slice().reverse();
    const returns = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseInt(sorted[i - 1].cumulative_pnl || 0);
      const curr = parseInt(sorted[i].cumulative_pnl || 0);
      returns.push(curr - prev);
    }
    return returns;
  }

  /**
   * Compute Sharpe ratio from daily returns.
   * @param {Array<number>} returns - daily returns in cents
   * @param {number} initialCapital - initial capital in cents (default 500000 = $5,000)
   * @returns {number} annualized Sharpe ratio
   */
  computeSharpeRatio(returns, initialCapital = 500000) {
    if (returns.length < 2) return 0;
    const dailyReturns = returns.map((r) => r / initialCapital);
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    return (mean / stdDev) * Math.sqrt(252);
  }

  /**
   * Compute max drawdown from daily returns.
   * @param {Array<number>} returns - daily returns in cents
   * @returns {number} max drawdown in cents (positive number)
   */
  computeMaxDrawdown(returns) {
    if (returns.length === 0) return 0;
    let peak = 0;
    let maxDd = 0;
    let cumulative = 0;
    for (const r of returns) {
      cumulative += r;
      if (cumulative > peak) peak = cumulative;
      const dd = peak - cumulative;
      if (dd > maxDd) maxDd = dd;
    }
    return maxDd;
  }

  /**
   * Generate a full P&L report matching the dashboard PnLReport type.
   * @param {string} strategyId - UUID of the strategy
   * @returns {Promise<Object>} PnLReport shape
   */
  async generateReport(strategyId) {
    const pnl = await this.getTotalPnL(strategyId);
    const winRate = await this.getWinRate(strategyId);
    const dailyReturns = await this.getDailyReturns(strategyId, 30);

    // For sharpe/maxDD we need a longer history if available
    const extendedReturns = await this.getDailyReturns(strategyId, 90);

    return {
      totalTrades: winRate.totalTrades,
      winningTrades: winRate.winningTrades,
      losingTrades: winRate.losingTrades,
      winRate: winRate.winRate,
      totalRealizedPnl: pnl.realized,
      totalUnrealizedPnl: pnl.unrealized,
      sharpeRatio: this.computeSharpeRatio(extendedReturns),
      maxDrawdown: this.computeMaxDrawdown(extendedReturns),
      dailyReturns,
    };
  }
}

module.exports = { PnLTracker };
