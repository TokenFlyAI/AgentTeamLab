/**
 * Risk Manager Integration — Strategy Runner Wrapper
 * Author: Heidi (Security Engineer)
 * Task: #237
 * 
 * Integrates RiskManager with Bob's ExecutionEngine and StrategyRunner.
 * This wrapper adds circuit breaker protection to the existing trading pipeline.
 */

"use strict";

const { RiskManager } = require("./risk_manager");

/**
 * Risk-aware execution engine wrapper
 * Wraps Bob's ExecutionEngine with pre-trade risk checks
 */
class RiskAwareExecutionEngine {
  /**
   * @param {Object} options
   * @param {ExecutionEngine} options.baseEngine - Bob's ExecutionEngine instance
   * @param {RiskManager} options.riskManager - RiskManager instance
   */
  constructor(options = {}) {
    this.baseEngine = options.baseEngine;
    this.riskManager = options.riskManager;
  }

  /**
   * Execute signals with risk checks
   * @param {Array} signals - Sized signals from strategy
   * @param {Array} markets - Market data
   * @returns {Promise<Object>} Execution report with risk rejections
   */
  async executeSignals(signals, markets) {
    const marketMap = Object.fromEntries(markets.map((m) => [m.id || m.ticker, m]));
    const riskResults = [];
    const riskApproved = [];

    // Pre-filter signals through risk manager
    for (const signal of signals) {
      const market = marketMap[signal.marketId];
      if (!market) {
        riskResults.push({ signal, status: "skipped", reason: "Market not found" });
        continue;
      }

      const sizing = signal.sizing || {};
      const riskCheck = await this.riskManager.checkTrade({
        strategyId: signal.strategy || "unknown",
        contracts: sizing.contracts || 0,
        price: signal.currentPrice || signal.targetPrice || 50,
        riskAmount: sizing.riskAmount || 0,
      });

      if (!riskCheck.allowed) {
        riskResults.push({
          signal,
          status: "risk_rejected",
          reason: riskCheck.reason,
          circuitBreaker: riskCheck.circuitBreaker,
        });
        continue;
      }

      riskApproved.push(signal);
    }

    // Execute approved signals through base engine
    let executionReport;
    if (riskApproved.length > 0) {
      executionReport = await this.baseEngine.executeSignals(riskApproved, markets);
    } else {
      executionReport = {
        executedAt: new Date().toISOString(),
        totalSignals: 0,
        executed: 0,
        rejected: 0,
        failed: 0,
        skipped: 0,
        results: [],
      };
    }

    // Record trades in risk manager and update state
    for (const result of executionReport.results || []) {
      if (result.status === "executed") {
        // Get the executed signal to record in risk manager
        const signal = riskApproved.find(
          (s) => s.marketId === result.signal?.marketId
        );
        if (signal) {
          const sizing = signal.sizing || {};
          // Note: Actual P&L will be recorded when position closes
          // For now, record the opening with 0 P&L
          await this.riskManager.recordTrade({
            strategyId: signal.strategy || "unknown",
            pnl: 0,
            contracts: sizing.contracts || 0,
            price: signal.currentPrice || signal.targetPrice || 50,
          });
        }
      }
    }

    // Merge risk rejections into execution report
    return {
      ...executionReport,
      totalSignals: signals.length,
      riskRejected: riskResults.filter((r) => r.status === "risk_rejected").length,
      riskRejections: riskResults.filter((r) => r.status === "risk_rejected"),
      allResults: [...riskResults, ...(executionReport.results || [])],
    };
  }

  /**
   * Get open positions (delegates to base engine)
   */
  async getOpenPositions() {
    return this.baseEngine.getOpenPositions();
  }

  /**
   * Get risk context (delegates to base engine)
   */
  async getRiskContext() {
    return this.baseEngine.getRiskContext();
  }
}

/**
 * Risk-aware strategy runner wrapper
 * Wraps Bob's StrategyRunner with circuit breaker monitoring
 */
class RiskAwareStrategyRunner {
  /**
   * @param {Object} options
   * @param {StrategyRunner} options.baseRunner - Bob's StrategyRunner instance
   * @param {RiskManager} options.riskManager - RiskManager instance
   */
  constructor(options = {}) {
    this.baseRunner = options.baseRunner;
    this.riskManager = options.riskManager;
  }

  /**
   * Run all active strategies with risk monitoring
   * @returns {Promise<Array>} Strategy results with risk status
   */
  async runAll() {
    // Check if trading is halted before running
    const riskStatus = this.riskManager.getStatus();
    if (riskStatus.tradingHalted) {
      console.error(`[RiskAwareStrategyRunner] Trading halted: ${riskStatus.haltReason}`);
      return [{
        strategyId: "global",
        error: `Trading halted: ${riskStatus.haltReason}`,
        riskStatus,
        signals: [],
      }];
    }

    // Run strategies through base runner
    const results = await this.baseRunner.runAll();

    // Enhance results with risk status
    return results.map((result) => ({
      ...result,
      riskStatus: {
        dailyPnl: riskStatus.daily.pnl,
        dailyLossRemaining: riskStatus.daily.lossRemaining,
        tradingHalted: riskStatus.tradingHalted,
      },
    }));
  }

  /**
   * Update performance summaries with risk tracking
   */
  async updatePerformanceSummaries() {
    // Update base runner's performance
    await this.baseRunner.updatePerformanceSummaries();

    // Log current risk status
    const status = this.riskManager.getStatus();
    console.log("[RiskAwareStrategyRunner] Risk Status:", {
      dailyPnl: `$${status.daily.pnl / 100}`,
      dailyLossRemaining: `$${status.daily.lossRemaining / 100}`,
      drawdown: `${(status.circuitBreakers.drawdown.currentPct * 100).toFixed(2)}%`,
      consecutiveLosses: status.circuitBreakers.consecutiveLosses.count,
    });
  }

  /**
   * Register a strategy (delegates to base runner)
   */
  register(id, strategy) {
    return this.baseRunner.register(id, strategy);
  }

  /**
   * Unregister a strategy (delegates to base runner)
   */
  unregister(id) {
    return this.baseRunner.unregister(id);
  }
}

/**
 * Factory function to create a fully integrated risk-aware trading pipeline
 * 
 * Usage:
 *   const { engine, runner, riskManager } = createRiskAwarePipeline({
 *     pool: pgPool,
 *     policy: riskPolicy,
 *     kalshiClient: kalshiClient,
 *   });
 */
function createRiskAwarePipeline(options = {}) {
  const { ExecutionEngine } = require("../../../bob/backend/strategies/execution_engine");
  const { StrategyRunner } = require("../../../bob/backend/strategies/strategy_runner");

  // Create risk manager
  const riskManager = new RiskManager({
    policy: options.policy,
    pool: options.pool,
    stateFile: options.stateFile || "/tmp/risk_manager_state.json",
  });

  // Initialize capital if provided
  if (options.initialCapital) {
    riskManager.initializeCapital(options.initialCapital);
  }

  // Create base engine and runner
  const baseEngine = new ExecutionEngine({
    pool: options.pool,
    kalshiClient: options.kalshiClient,
    demoMode: options.demoMode !== false,
    maxDailyLoss: options.policy?.dailyLossLimit || 50000,
    maxPositionSize: options.policy?.maxPositionSizePerStrategy || 1000,
    maxTotalExposure: options.policy?.maxTotalExposure || 1000000,
  });

  const baseRunner = new StrategyRunner({
    pool: options.pool,
    signalEngine: options.signalEngine,
    positionSizer: options.positionSizer,
  });

  // Create risk-aware wrappers
  const engine = new RiskAwareExecutionEngine({
    baseEngine,
    riskManager,
  });

  const runner = new RiskAwareStrategyRunner({
    baseRunner,
    riskManager,
  });

  // Set up event listeners for monitoring
  riskManager.on("circuitBreakerTriggered", (event) => {
    console.error("[RISK ALERT] Circuit breaker triggered:", event);
    // Could send alert to monitoring system here
  });

  riskManager.on("circuitBreakerReset", (event) => {
    console.log("[RISK INFO] Circuit breaker reset:", event);
  });

  return { engine, runner, riskManager };
}

module.exports = {
  RiskAwareExecutionEngine,
  RiskAwareStrategyRunner,
  createRiskAwarePipeline,
};
