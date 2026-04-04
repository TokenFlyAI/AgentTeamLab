/**
 * Risk Manager — Circuit Breakers & Risk Controls
 * Author: Heidi (Security Engineer)
 * Task: #237
 * 
 * Provides hard risk controls for live trading:
 * - Daily loss limits
 * - Per-strategy position caps
 * - Maximum open positions
 * - Circuit breakers (consecutive losses, drawdown)
 */

"use strict";

const { EventEmitter } = require("events");

/**
 * Risk check result
 * @typedef {Object} RiskCheckResult
 * @property {boolean} allowed - Whether the action is allowed
 * @property {string} [reason] - Reason if rejected
 * @property {string} [circuitBreaker] - Name of triggered circuit breaker
 */

class RiskManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.policy - Risk policy configuration
   * @param {Object} options.pool - PostgreSQL pool for persistence
   * @param {string} options.stateFile - Path to persist circuit breaker state
   */
  constructor(options = {}) {
    super();
    
    this.policy = options.policy || this._defaultPolicy();
    this.pool = options.pool || null;
    this.stateFile = options.stateFile || "/tmp/risk_manager_state.json";
    
    // Circuit breaker state (in-memory + persisted)
    this.state = {
      dailyLoss: 0,              // Today's realized loss in cents
      dailyPnl: 0,               // Today's net P&L in cents
      consecutiveLosses: 0,      // Count of consecutive losing trades
      consecutiveLossAmount: 0,  // Cumulative loss from consecutive streak
      peakCapital: 0,            // Peak capital for drawdown calc
      currentCapital: 0,         // Current capital
      tradingHalted: false,      // Global trading halt flag
      haltReason: null,          // Reason for halt
      haltedAt: null,            // When halt occurred
      strategyStates: new Map(), // Per-strategy state
      lastTradeAt: null,         // Timestamp of last trade
    };
    
    // Load persisted state
    this._loadState();
  }

  /**
   * Default risk policy
   */
  _defaultPolicy() {
    return {
      // Daily loss limit (cents)
      dailyLossLimit: 50000,           // $500/day
      
      // Per-strategy limits
      maxPositionSizePerStrategy: 1000,     // contracts
      maxOpenPositionsPerStrategy: 10,      // max concurrent positions
      maxExposurePerStrategy: 200000,       // cents ($2,000)
      
      // Global position limits
      maxTotalOpenPositions: 50,            // across all strategies
      maxTotalExposure: 1000000,            // cents ($10,000)
      
      // Circuit breaker: Consecutive losses
      circuitBreakerConsecutiveLosses: 5,   // halt after N consecutive losses
      circuitBreakerConsecutiveLossAmount: 25000, // $250 cumulative loss threshold
      
      // Circuit breaker: Drawdown
      circuitBreakerMaxDrawdownPct: 0.10,   // 10% max drawdown
      circuitBreakerDrawdownAmount: 100000, // $1,000 absolute drawdown
      
      // Auto-reset settings
      autoResetHours: 24,                   // auto-reset halt after N hours
      resetOnNewDay: true,                  // reset daily stats at midnight
    };
  }

  /**
   * Load persisted state from file
   */
  _loadState() {
    try {
      const fs = require("fs");
      if (fs.existsSync(this.stateFile)) {
        const data = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
        this.state.dailyLoss = data.dailyLoss || 0;
        this.state.dailyPnl = data.dailyPnl || 0;
        this.state.consecutiveLosses = data.consecutiveLosses || 0;
        this.state.consecutiveLossAmount = data.consecutiveLossAmount || 0;
        this.state.peakCapital = data.peakCapital || 0;
        this.state.currentCapital = data.currentCapital || 0;
        this.state.tradingHalted = data.tradingHalted || false;
        this.state.haltReason = data.haltReason || null;
        this.state.haltedAt = data.haltedAt ? new Date(data.haltedAt) : null;
        this.state.lastTradeAt = data.lastTradeAt ? new Date(data.lastTradeAt) : null;
        
        // Restore strategy states
        if (data.strategyStates) {
          for (const [key, val] of Object.entries(data.strategyStates)) {
            this.state.strategyStates.set(key, val);
          }
        }
        
        // Check if we should auto-reset
        this._checkAutoReset();
      }
    } catch (e) {
      console.error("[RiskManager] Failed to load state:", e.message);
    }
  }

  /**
   * Persist state to file
   */
  _saveState() {
    try {
      const fs = require("fs");
      const data = {
        dailyLoss: this.state.dailyLoss,
        dailyPnl: this.state.dailyPnl,
        consecutiveLosses: this.state.consecutiveLosses,
        consecutiveLossAmount: this.state.consecutiveLossAmount,
        peakCapital: this.state.peakCapital,
        currentCapital: this.state.currentCapital,
        tradingHalted: this.state.tradingHalted,
        haltReason: this.state.haltReason,
        haltedAt: this.state.haltedAt?.toISOString(),
        lastTradeAt: this.state.lastTradeAt?.toISOString(),
        strategyStates: Object.fromEntries(this.state.strategyStates),
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("[RiskManager] Failed to save state:", e.message);
    }
  }

  /**
   * Check if auto-reset conditions are met
   */
  _checkAutoReset() {
    if (!this.state.tradingHalted || !this.state.haltedAt) return;
    
    const haltedAt = new Date(this.state.haltedAt);
    const hoursSinceHalt = (Date.now() - haltedAt.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceHalt >= this.policy.autoResetHours) {
      this.resetCircuitBreakers("auto_reset_timeout");
    }
  }

  /**
   * Initialize capital tracking
   * @param {number} initialCapital - Initial capital in cents
   */
  initializeCapital(initialCapital) {
    this.state.currentCapital = initialCapital;
    if (this.state.peakCapital === 0) {
      this.state.peakCapital = initialCapital;
    }
    this._saveState();
  }

  /**
   * Get or create strategy state
   */
  _getStrategyState(strategyId) {
    if (!this.state.strategyStates.has(strategyId)) {
      this.state.strategyStates.set(strategyId, {
        openPositions: 0,
        exposure: 0,
        dailyPnl: 0,
        totalTrades: 0,
        tradingHalted: false,
      });
    }
    return this.state.strategyStates.get(strategyId);
  }

  /**
   * Main risk check before executing a trade
   * @param {Object} trade - Trade proposal
   * @param {string} trade.strategyId - Strategy identifier
   * @param {number} trade.contracts - Number of contracts
   * @param {number} trade.price - Price in cents
   * @param {number} trade.riskAmount - Max loss amount in cents
   * @returns {Promise<RiskCheckResult>}
   */
  async checkTrade(trade) {
    const { strategyId, contracts, price, riskAmount } = trade;
    const positionValue = contracts * price;
    
    // Check global trading halt
    if (this.state.tradingHalted) {
      return {
        allowed: false,
        reason: `Trading halted: ${this.state.haltReason}`,
        circuitBreaker: "global_halt",
      };
    }
    
    // Check strategy-specific halt
    const stratState = this._getStrategyState(strategyId);
    if (stratState.tradingHalted) {
      return {
        allowed: false,
        reason: `Trading halted for strategy ${strategyId}`,
        circuitBreaker: "strategy_halt",
      };
    }
    
    // Check daily loss limit
    const projectedDailyLoss = this.state.dailyLoss + (riskAmount || 0);
    if (projectedDailyLoss > this.policy.dailyLossLimit) {
      return {
        allowed: false,
        reason: `Daily loss limit exceeded: $${this.state.dailyLoss / 100} / $${this.policy.dailyLossLimit / 100}`,
        circuitBreaker: "daily_loss_limit",
      };
    }
    
    // Check per-strategy position size
    if (contracts > this.policy.maxPositionSizePerStrategy) {
      return {
        allowed: false,
        reason: `Position size ${contracts} exceeds strategy limit ${this.policy.maxPositionSizePerStrategy}`,
      };
    }
    
    // Check per-strategy open positions
    if (stratState.openPositions >= this.policy.maxOpenPositionsPerStrategy) {
      return {
        allowed: false,
        reason: `Max open positions per strategy reached: ${stratState.openPositions}`,
      };
    }
    
    // Check per-strategy exposure
    const projectedExposure = stratState.exposure + positionValue;
    if (projectedExposure > this.policy.maxExposurePerStrategy) {
      return {
        allowed: false,
        reason: `Strategy exposure $${projectedExposure / 100} would exceed limit $${this.policy.maxExposurePerStrategy / 100}`,
      };
    }
    
    // Check total open positions
    const totalOpenPositions = Array.from(this.state.strategyStates.values())
      .reduce((sum, s) => sum + s.openPositions, 0);
    if (totalOpenPositions >= this.policy.maxTotalOpenPositions) {
      return {
        allowed: false,
        reason: `Global max open positions reached: ${totalOpenPositions}`,
      };
    }
    
    // Check total exposure
    const totalExposure = Array.from(this.state.strategyStates.values())
      .reduce((sum, s) => sum + s.exposure, 0);
    if (totalExposure + positionValue > this.policy.maxTotalExposure) {
      return {
        allowed: false,
        reason: `Global exposure $${(totalExposure + positionValue) / 100} would exceed limit $${this.policy.maxTotalExposure / 100}`,
      };
    }
    
    // Check drawdown circuit breaker
    const drawdownCheck = this._checkDrawdown();
    if (!drawdownCheck.allowed) {
      return drawdownCheck;
    }
    
    return { allowed: true };
  }

  /**
   * Check drawdown circuit breaker
   */
  _checkDrawdown() {
    if (this.state.peakCapital === 0 || this.state.currentCapital === 0) {
      return { allowed: true };
    }
    
    const drawdownAmount = this.state.peakCapital - this.state.currentCapital;
    const drawdownPct = drawdownAmount / this.state.peakCapital;
    
    if (drawdownAmount >= this.policy.circuitBreakerDrawdownAmount ||
        drawdownPct >= this.policy.circuitBreakerMaxDrawdownPct) {
      this._triggerCircuitBreaker("max_drawdown", {
        drawdownAmount,
        drawdownPct: (drawdownPct * 100).toFixed(2),
      });
      return {
        allowed: false,
        reason: `Max drawdown exceeded: $${drawdownAmount / 100} (${(drawdownPct * 100).toFixed(2)}%)`,
        circuitBreaker: "max_drawdown",
      };
    }
    
    return { allowed: true };
  }

  /**
   * Record a trade result and update circuit breaker state
   * @param {Object} result - Trade result
   * @param {string} result.strategyId - Strategy identifier
   * @param {number} result.pnl - P&L in cents (positive = profit)
   * @param {number} result.contracts - Contracts traded
   * @param {number} result.price - Average price
   */
  async recordTrade(result) {
    const { strategyId, pnl, contracts, price } = result;
    const stratState = this._getStrategyState(strategyId);
    
    // Update capital
    this.state.currentCapital += pnl;
    if (this.state.currentCapital > this.state.peakCapital) {
      this.state.peakCapital = this.state.currentCapital;
    }
    
    // Update daily P&L
    this.state.dailyPnl += pnl;
    if (pnl < 0) {
      this.state.dailyLoss += Math.abs(pnl);
    }
    
    // Update consecutive losses circuit breaker
    if (pnl < 0) {
      this.state.consecutiveLosses++;
      this.state.consecutiveLossAmount += Math.abs(pnl);
      
      // Check consecutive loss circuit breaker
      if (this.state.consecutiveLosses >= this.policy.circuitBreakerConsecutiveLosses ||
          this.state.consecutiveLossAmount >= this.policy.circuitBreakerConsecutiveLossAmount) {
        this._triggerCircuitBreaker("consecutive_losses", {
          count: this.state.consecutiveLosses,
          amount: this.state.consecutiveLossAmount,
        });
      }
    } else {
      // Reset consecutive loss counter on win
      this.state.consecutiveLosses = 0;
      this.state.consecutiveLossAmount = 0;
    }
    
    // Update strategy state
    stratState.totalTrades++;
    stratState.dailyPnl += pnl;
    
    // Update open positions/exposure (simplified - assumes opening trade)
    // For closing trades, caller should adjust separately
    stratState.openPositions++;
    stratState.exposure += contracts * price;
    
    this.state.lastTradeAt = new Date();
    
    // Check drawdown circuit breaker after updating capital
    if (!this.state.tradingHalted) {
      this._checkDrawdown();
    }
    
    this._saveState();
    
    // Emit event for monitoring
    this.emit("tradeRecorded", {
      strategyId,
      pnl,
      capital: this.state.currentCapital,
      dailyPnl: this.state.dailyPnl,
      consecutiveLosses: this.state.consecutiveLosses,
      tradingHalted: this.state.tradingHalted,
    });
    
    return this.getStatus();
  }

  /**
   * Record position close (reduces exposure)
   */
  async recordPositionClose(strategyId, contracts, price) {
    const stratState = this._getStrategyState(strategyId);
    stratState.openPositions = Math.max(0, stratState.openPositions - 1);
    stratState.exposure = Math.max(0, stratState.exposure - contracts * price);
    this._saveState();
  }

  /**
   * Trigger a circuit breaker
   */
  _triggerCircuitBreaker(reason, details = {}) {
    this.state.tradingHalted = true;
    this.state.haltReason = reason;
    this.state.haltedAt = new Date();
    this._saveState();
    
    console.error(`[RiskManager] CIRCUIT BREAKER TRIGGERED: ${reason}`, details);
    
    this.emit("circuitBreakerTriggered", {
      reason,
      details,
      haltedAt: this.state.haltedAt,
      state: this.getStatus(),
    });
  }

  /**
   * Manually halt trading (e.g., for maintenance)
   */
  haltTrading(reason = "manual") {
    this._triggerCircuitBreaker(reason);
  }

  /**
   * Reset circuit breakers
   */
  resetCircuitBreakers(reason = "manual") {
    const wasHalted = this.state.tradingHalted;
    
    this.state.tradingHalted = false;
    this.state.haltReason = null;
    this.state.haltedAt = null;
    this.state.consecutiveLosses = 0;
    this.state.consecutiveLossAmount = 0;
    
    // Reset strategy halts
    for (const state of this.state.strategyStates.values()) {
      state.tradingHalted = false;
    }
    
    this._saveState();
    
    if (wasHalted) {
      console.log(`[RiskManager] Circuit breakers reset: ${reason}`);
      this.emit("circuitBreakerReset", { reason, state: this.getStatus() });
    }
    
    return this.getStatus();
  }

  /**
   * Reset daily stats (call at midnight or new trading day)
   */
  resetDailyStats() {
    this.state.dailyLoss = 0;
    this.state.dailyPnl = 0;
    
    for (const state of this.state.strategyStates.values()) {
      state.dailyPnl = 0;
    }
    
    // If halted for daily loss, reset that too
    if (this.state.haltReason === "daily_loss_limit") {
      this.resetCircuitBreakers("new_trading_day");
    }
    
    this._saveState();
  }

  /**
   * Get current risk status
   */
  getStatus() {
    const totalOpenPositions = Array.from(this.state.strategyStates.values())
      .reduce((sum, s) => sum + s.openPositions, 0);
    const totalExposure = Array.from(this.state.strategyStates.values())
      .reduce((sum, s) => sum + s.exposure, 0);
    
    const drawdownAmount = this.state.peakCapital > 0 
      ? this.state.peakCapital - this.state.currentCapital 
      : 0;
    const drawdownPct = this.state.peakCapital > 0 
      ? drawdownAmount / this.state.peakCapital 
      : 0;
    
    return {
      tradingHalted: this.state.tradingHalted,
      haltReason: this.state.haltReason,
      haltedAt: this.state.haltedAt,
      
      capital: {
        current: this.state.currentCapital,
        peak: this.state.peakCapital,
        drawdown: drawdownAmount,
        drawdownPct: drawdownPct,
      },
      
      daily: {
        pnl: this.state.dailyPnl,
        loss: this.state.dailyLoss,
        lossLimit: this.policy.dailyLossLimit,
        lossRemaining: Math.max(0, this.policy.dailyLossLimit - this.state.dailyLoss),
      },
      
      circuitBreakers: {
        consecutiveLosses: {
          count: this.state.consecutiveLosses,
          amount: this.state.consecutiveLossAmount,
          limit: this.policy.circuitBreakerConsecutiveLosses,
          amountLimit: this.policy.circuitBreakerConsecutiveLossAmount,
        },
        drawdown: {
          current: drawdownAmount,
          currentPct: drawdownPct,
          maxPct: this.policy.circuitBreakerMaxDrawdownPct,
          maxAmount: this.policy.circuitBreakerDrawdownAmount,
        },
      },
      
      positions: {
        totalOpen: totalOpenPositions,
        maxOpen: this.policy.maxTotalOpenPositions,
        totalExposure,
        maxExposure: this.policy.maxTotalExposure,
        byStrategy: Object.fromEntries(
          Array.from(this.state.strategyStates.entries()).map(([id, s]) => [
            id,
            { openPositions: s.openPositions, exposure: s.exposure, dailyPnl: s.dailyPnl },
          ])
        ),
      },
    };
  }

  /**
   * Update risk policy dynamically
   */
  updatePolicy(newPolicy) {
    this.policy = { ...this.policy, ...newPolicy };
    this._saveState();
    this.emit("policyUpdated", { policy: this.policy });
  }
}

module.exports = { RiskManager };
