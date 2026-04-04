/**
 * Strategy Runner
 * Orchestrates strategy execution: scan markets, generate signals, size positions, track P&L.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

const { SignalEngine } = require("./signal_engine");
const { PositionSizer } = require("./position_sizer");
const { PnLTracker } = require("./pnl_tracker");

// Optionally load Dave's strategies if available
let DaveStrategies = null;
try {
  DaveStrategies = require("../../../dave/backend/strategies/dave_strategies");
} catch (e) {
  // Dave's strategies not available
}

class StrategyRunner {
  constructor(options = {}) {
    this.pool = options.pool || null;
    this.signalEngine = new SignalEngine(options.signalEngine || {});
    this.positionSizer = new PositionSizer(options.positionSizer || {});
    this.pnlTracker = new PnLTracker({ pool: this.pool });
    this.strategies = new Map();

    // Auto-register Dave's strategies if available
    if (DaveStrategies) {
      const factory = new DaveStrategies.StrategyFactory(options);
      const daveStrats = factory.createAll();
      this.register("longshot_fading", daveStrats.longshotFading);
      this.register("economic_momentum", daveStrats.economicMomentum);
      this.register("cross_platform_arbitrage", daveStrats.arbitrage);
    }
  }

  /**
   * Register a strategy instance.
   * @param {string} id - strategy identifier
   * @param {Object} strategy - strategy object with generateSignal(market) method
   */
  register(id, strategy) {
    this.strategies.set(id, strategy);
  }

  /**
   * Unregister a strategy.
   * @param {string} id - strategy identifier
   */
  unregister(id) {
    this.strategies.delete(id);
  }

  /**
   * Load active strategies from the database.
   * @returns {Promise<Array>} list of active strategy rows
   */
  async loadActiveStrategies() {
    if (!this.pool) return [];
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM strategies WHERE status = 'active' ORDER BY created_at DESC`
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch active markets with prices from the database.
   * @returns {Promise<Array>} list of active markets
   */
  async fetchMarkets() {
    if (!this.pool) return [];
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM active_markets_with_prices ORDER BY volume DESC NULLS LAST LIMIT 500`
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Run a single strategy against current markets.
   * @param {Object} strategyRow - strategy database row
   * @param {Array} markets - list of active markets
   * @returns {Promise<Object>} run result with signals
   */
  async runStrategy(strategyRow, markets) {
    const strategyId = strategyRow.id;
    const strategyType = strategyRow.strategy_type;
    const config = strategyRow.config || {};

    // Load strategy implementation
    const strategyImpl = this.strategies.get(strategyType);
    if (!strategyImpl) {
      return {
        strategyId,
        error: `Strategy implementation not found: ${strategyType}`,
        signals: [],
      };
    }

    // Update sizer with strategy-specific constraints
    this.positionSizer.maxContracts = strategyRow.max_position_size || 1000;

    // Generate signals
    let signals = [];
    if (strategyImpl.generateSignal) {
      signals = this.signalEngine.scan(markets, strategyImpl);
    }

    // Apply strategy-specific filters from config
    if (config.categories && config.categories.length > 0) {
      signals = signals.filter((s) => {
        const market = markets.find((m) => m.id === s.marketId);
        return market && config.categories.includes(market.category);
      });
    }

    // Size positions
    const marketMap = Object.fromEntries(markets.map((m) => [m.id, m]));
    signals = this.positionSizer.sizeSignals(signals, marketMap);

    // Persist signals to database
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        for (const signal of signals) {
          await client.query(
            `INSERT INTO strategy_signals (
              strategy_id, market_id, side, signal_type, confidence,
              target_price, current_price, expected_edge, recommended_contracts, reason
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              strategyId,
              signal.marketId,
              signal.side,
              signal.signalType,
              signal.confidence,
              signal.targetPrice,
              signal.currentPrice,
              signal.expectedEdge,
              signal.sizing.contracts,
              signal.reason,
            ]
          );
        }
      } finally {
        client.release();
      }
    }

    return {
      strategyId,
      strategyType,
      signalCount: signals.length,
      signals,
    };
  }

  /**
   * Run all active strategies.
   * @returns {Promise<Array>} results for each strategy
   */
  async runAll() {
    const markets = await this.fetchMarkets();
    const strategies = await this.loadActiveStrategies();
    const results = [];

    for (const strategy of strategies) {
      try {
        const result = await this.runStrategy(strategy, markets);
        results.push(result);
      } catch (err) {
        results.push({
          strategyId: strategy.id,
          error: err.message,
          signals: [],
        });
      }
    }

    return results;
  }

  /**
   * Update strategy performance summaries in the database.
   * @returns {Promise<void>}
   */
  async updatePerformanceSummaries() {
    if (!this.pool) return;
    const strategies = await this.loadActiveStrategies();
    for (const strategy of strategies) {
      const pnl = await this.pnlTracker.getTotalPnL(strategy.id);
      const winRate = await this.pnlTracker.getWinRate(strategy.id);
      const client = await this.pool.connect();
      try {
        await client.query(
          `UPDATE strategies SET
            total_pnl = $1,
            total_trades = $2,
            winning_trades = $3,
            losing_trades = $4,
            updated_at = NOW()
           WHERE id = $5`,
          [
            pnl.total,
            winRate.totalTrades,
            winRate.winningTrades,
            winRate.losingTrades,
            strategy.id,
          ]
        );
      } finally {
        client.release();
      }
    }
  }
}

module.exports = { StrategyRunner };
