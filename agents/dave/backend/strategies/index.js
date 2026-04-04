/**
 * Trading Strategy Framework — Agent Planet
 * Author: Dave (Full Stack Engineer)
 * Task: #220 — Design trading strategy framework
 * 
 * Provides:
 *   - Signal generation module
 *   - Position sizing (Kelly criterion)
 *   - P&L tracking and performance metrics
 *   - Base strategy class for implementing custom strategies
 *   - Three built-in strategies based on Charlie's research
 */

"use strict";

const { EventEmitter } = require("events");

// ============================================================================
// Types / Interfaces (documented for reference)
// ============================================================================

/**
 * @typedef {Object} Signal
 * @property {string} marketId - Market ticker symbol
 * @property {string} direction - "buy_yes", "buy_no", "sell_yes", "sell_no"
 * @property {number} confidence - 0-1 probability of success
 * @property {number} edge - Expected edge in cents (0-100)
 * @property {string} strategy - Strategy name that generated signal
 * @property {Date} timestamp - When signal was generated
 * @property {Object} metadata - Additional context
 */

/**
 * @typedef {Object} Position
 * @property {string} id - Unique position ID
 * @property {string} marketId - Market ticker
 * @property {string} side - "yes" or "no"
 * @property {number} contracts - Number of contracts
 * @property {number} avgEntryPrice - Average entry price in cents
 * @property {number} currentPrice - Current market price
 * @property {number} unrealizedPnl - Unrealized P&L in cents
 * @property {string} status - "open", "closed", "partial"
 * @property {Date} openedAt - When position was opened
 * @property {Date} [closedAt] - When position was closed
 */

/**
 * @typedef {Object} StrategyPerformance
 * @property {string} strategyName - Name of the strategy
 * @property {number} totalTrades - Total number of trades
 * @property {number} winningTrades - Number of winning trades
 * @property {number} losingTrades - Number of losing trades
 * @property {number} winRate - Win rate (0-1)
 * @property {number} totalPnl - Total P&L in cents
 * @property {number} avgTradeReturn - Average return per trade
 * @property {number} sharpeRatio - Risk-adjusted return
 * @property {number} maxDrawdown - Maximum drawdown in cents
 * @property {number} maxDrawdownPct - Maximum drawdown percentage
 * @property {number[]} equityCurve - Equity curve over time
 */

// ============================================================================
// Position Sizing Module (Kelly Criterion)
// ============================================================================

class PositionSizer {
  /**
   * Create a position sizer
   * @param {Object} opts
   * @param {number} opts.kellyFraction - Kelly fraction (default: 0.25 = quarter Kelly)
   * @param {number} opts.maxPositionPct - Max position size as % of portfolio (default: 0.05 = 5%)
   * @param {number} opts.minContracts - Minimum contracts per trade (default: 1)
   * @param {number} opts.maxContracts - Maximum contracts per trade (default: 1000)
   */
  constructor(opts = {}) {
    this.kellyFraction = opts.kellyFraction || 0.25;
    this.maxPositionPct = opts.maxPositionPct || 0.05;
    this.minContracts = opts.minContracts || 1;
    this.maxContracts = opts.maxContracts || 1000;
  }

  /**
   * Calculate position size using Kelly Criterion
   * Formula: f* = (bp - q) / b
   * Where: b = odds received, p = win probability, q = loss probability (1-p)
   * 
   * @param {Object} params
   * @param {number} params.portfolioValue - Total portfolio value in cents
   * @param {number} params.edge - Expected edge (0-1)
   * @param {number} params.confidence - Probability of winning (0-1)
   * @param {number} params.price - Current price in cents (0-100)
   * @returns {Object} Position sizing result
   */
  calculateKellySize(params) {
    const { portfolioValue, edge, confidence, price } = params;
    
    // Kelly inputs
    const p = confidence;           // Probability of win
    const q = 1 - p;                // Probability of loss
    const b = (100 - price) / price; // Odds received (profit/risk)
    
    // Full Kelly fraction
    const kellyFull = (b * p - q) / b;
    
    // Apply Kelly fraction (quarter Kelly for safety)
    const kellyAdjusted = Math.max(0, kellyFull * this.kellyFraction);
    
    // Calculate position value
    const kellyPositionValue = portfolioValue * kellyAdjusted;
    const maxPositionValue = portfolioValue * this.maxPositionPct;
    
    // Take the minimum of Kelly and max position
    const positionValue = Math.min(kellyPositionValue, maxPositionValue);
    
    // Convert to contracts (each contract = $1 payout = 100 cents)
    const riskPerContract = price; // Max loss per contract
    const contracts = Math.floor(positionValue / riskPerContract);
    
    // Apply min/max constraints
    const finalContracts = Math.max(
      this.minContracts,
      Math.min(contracts, this.maxContracts)
    );
    
    return {
      contracts: finalContracts,
      kellyFull,
      kellyAdjusted,
      positionValue,
      riskAmount: finalContracts * price,
      expectedReturn: finalContracts * edge,
      fractionOfPortfolio: (finalContracts * price) / portfolioValue,
    };
  }

  /**
   * Calculate fixed fractional position size (simpler alternative)
   * @param {Object} params
   * @param {number} params.portfolioValue - Total portfolio value in cents
   * @param {number} params.riskPct - Risk percentage per trade (default: 0.01 = 1%)
   * @param {number} params.price - Current price in cents
   * @returns {Object} Position sizing result
   */
  calculateFixedFractional(params) {
    const { portfolioValue, riskPct = 0.01, price } = params;
    
    const riskAmount = portfolioValue * riskPct;
    const contracts = Math.floor(riskAmount / price);
    
    const finalContracts = Math.max(
      this.minContracts,
      Math.min(contracts, this.maxContracts)
    );
    
    return {
      contracts: finalContracts,
      riskAmount: finalContracts * price,
      fractionOfPortfolio: (finalContracts * price) / portfolioValue,
    };
  }
}

// ============================================================================
// P&L Tracking Module
// ============================================================================

class PnLTracker extends EventEmitter {
  constructor() {
    super();
    this.positions = new Map();      // marketId -> Position[]
    this.closedPositions = [];       // All closed positions
    this.dailyPnL = new Map();       // date -> daily P&L
    this.equityCurve = [];           // [{ timestamp, equity }]
    this.initialCapital = 0;
    this.currentCapital = 0;
  }

  /**
   * Initialize tracker with starting capital
   * @param {number} capital - Starting capital in cents
   */
  initialize(capital) {
    this.initialCapital = capital;
    this.currentCapital = capital;
    this.equityCurve.push({
      timestamp: new Date(),
      equity: capital,
    });
  }

  /**
   * Record a new position
   * @param {Object} position
   */
  recordOpen(position) {
    if (!this.positions.has(position.marketId)) {
      this.positions.set(position.marketId, []);
    }
    this.positions.get(position.marketId).push(position);
    this.emit("position:open", position);
  }

  /**
   * Update position with current market price
   * @param {string} marketId - Market ticker
   * @param {number} currentPrice - Current price in cents
   */
  updatePositionPrice(marketId, currentPrice) {
    const positions = this.positions.get(marketId) || [];
    
    for (const pos of positions) {
      if (pos.status !== "open") continue;
      
      pos.currentPrice = currentPrice;
      
      // Calculate unrealized P&L
      if (pos.side === "yes") {
        pos.unrealizedPnl = pos.contracts * (currentPrice - pos.avgEntryPrice);
      } else {
        // For NO side, price moves inversely
        pos.unrealizedPnl = pos.contracts * ((100 - currentPrice) - (100 - pos.avgEntryPrice));
      }
    }
  }

  /**
   * Close a position
   * @param {string} marketId - Market ticker
   * @param {string} positionId - Position ID
   * @param {number} exitPrice - Exit price in cents
   * @param {number} contracts - Number of contracts to close
   * @returns {Object} Closed position with realized P&L
   */
  recordClose(marketId, positionId, exitPrice, contracts) {
    const positions = this.positions.get(marketId) || [];
    const position = positions.find(p => p.id === positionId);
    
    if (!position) {
      throw new Error(`Position ${positionId} not found for market ${marketId}`);
    }

    // Calculate realized P&L
    let realizedPnl;
    if (position.side === "yes") {
      realizedPnl = contracts * (exitPrice - position.avgEntryPrice);
    } else {
      realizedPnl = contracts * ((100 - exitPrice) - (100 - position.avgEntryPrice));
    }

    // Update position
    position.closedContracts = (position.closedContracts || 0) + contracts;
    position.realizedPnl = (position.realizedPnl || 0) + realizedPnl;
    
    if (position.closedContracts >= position.contracts) {
      position.status = "closed";
      position.closedAt = new Date();
    } else {
      position.status = "partial";
    }

    // Update capital
    this.currentCapital += realizedPnl;
    
    // Record closed position
    const closedPosition = {
      ...position,
      exitPrice,
      closedContracts: contracts,
      realizedPnl,
    };
    this.closedPositions.push(closedPosition);
    
    // Update daily P&L
    const today = new Date().toISOString().split("T")[0];
    const currentDaily = this.dailyPnL.get(today) || 0;
    this.dailyPnL.set(today, currentDaily + realizedPnl);
    
    // Update equity curve
    this.equityCurve.push({
      timestamp: new Date(),
      equity: this.currentCapital,
    });

    this.emit("position:close", closedPosition);
    
    return closedPosition;
  }

  /**
   * Get current portfolio summary
   * @returns {Object} Portfolio summary
   */
  getPortfolioSummary() {
    let unrealizedPnl = 0;
    let totalExposure = 0;
    
    for (const positions of this.positions.values()) {
      for (const pos of positions) {
        if (pos.status === "open") {
          unrealizedPnl += pos.unrealizedPnl || 0;
          totalExposure += pos.contracts * (pos.side === "yes" ? pos.avgEntryPrice : (100 - pos.avgEntryPrice));
        }
      }
    }

    const totalRealized = this.closedPositions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);
    
    return {
      initialCapital: this.initialCapital,
      currentCapital: this.currentCapital,
      totalRealizedPnl: totalRealized,
      unrealizedPnl,
      totalPnl: totalRealized + unrealizedPnl,
      totalReturn: (this.currentCapital + unrealizedPnl - this.initialCapital) / this.initialCapital,
      totalExposure,
      availableCapital: this.currentCapital - totalExposure,
      openPositions: this.getOpenPositions().length,
      closedPositions: this.closedPositions.length,
    };
  }

  /**
   * Get all open positions
   * @returns {Array} Open positions
   */
  getOpenPositions() {
    const open = [];
    for (const positions of this.positions.values()) {
      for (const pos of positions) {
        if (pos.status === "open" || pos.status === "partial") {
          open.push(pos);
        }
      }
    }
    return open;
  }

  /**
   * Calculate performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    if (this.closedPositions.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        maxDrawdownPct: 0,
      };
    }

    const trades = this.closedPositions;
    const winningTrades = trades.filter(p => p.realizedPnl > 0);
    const losingTrades = trades.filter(p => p.realizedPnl <= 0);
    
    const totalPnl = trades.reduce((sum, p) => sum + p.realizedPnl, 0);
    const winRate = winningTrades.length / trades.length;
    
    // Calculate daily returns for Sharpe
    const dailyReturns = Array.from(this.dailyPnL.values()).map(pnl => 
      pnl / this.initialCapital
    );
    
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
    
    // Calculate max drawdown
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    let peak = this.initialCapital;
    
    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = peak - point.equity;
      const drawdownPct = drawdown / peak;
      
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPct = drawdownPct;
      }
    }

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalPnl,
      avgTradeReturn: totalPnl / trades.length,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPct,
      equityCurve: this.equityCurve,
    };
  }
}

// ============================================================================
// Base Strategy Class
// ============================================================================

class BaseStrategy extends EventEmitter {
  /**
   * Create a new strategy
   * @param {string} name - Strategy name
   * @param {Object} config - Strategy configuration
   */
  constructor(name, config = {}) {
    super();
    this.name = name;
    this.config = config;
    this.isRunning = false;
    this.signals = [];
    this.positions = new Map();
    this.pnlTracker = new PnLTracker();
    this.positionSizer = new PositionSizer(config.positionSizing);
  }

  /**
   * Initialize the strategy
   * @param {Object} context - Trading context
   * @param {number} context.initialCapital - Starting capital
   * @param {Object} context.client - API client
   */
  initialize(context) {
    this.context = context;
    this.pnlTracker.initialize(context.initialCapital);
    this.isRunning = true;
    this.emit("initialized", { strategy: this.name, capital: context.initialCapital });
  }

  /**
   * Generate signals from market data
   * Override this method in subclasses
   * @param {Object} marketData - Market data
   * @returns {Array<Signal>} Generated signals
   */
  generateSignals(marketData) {
    throw new Error("generateSignals must be implemented by subclass");
  }

  /**
   * Process a signal and potentially create a position
   * @param {Signal} signal - Trading signal
   * @returns {Object|null} Order or null if no action
   */
  processSignal(signal) {
    const portfolio = this.pnlTracker.getPortfolioSummary();
    
    // Check if we have enough capital
    if (portfolio.availableCapital < 100) {
      return null;
    }

    // Calculate position size
    const sizing = this.positionSizer.calculateKellySize({
      portfolioValue: portfolio.availableCapital,
      edge: signal.edge,
      confidence: signal.confidence,
      price: signal.price,
    });

    if (sizing.contracts < 1) {
      return null;
    }

    const order = {
      marketId: signal.marketId,
      side: signal.direction.includes("yes") ? "yes" : "no",
      action: signal.direction.startsWith("buy") ? "buy" : "sell",
      contracts: sizing.contracts,
      price: signal.price,
      signal: signal,
      sizing: sizing,
    };

    this.emit("order:created", order);
    return order;
  }

  /**
   * Update positions with new price data
   * @param {string} marketId - Market ticker
   * @param {number} price - Current price
   */
  updatePrice(marketId, price) {
    this.pnlTracker.updatePositionPrice(marketId, price);
  }

  /**
   * Get strategy performance
   * @returns {StrategyPerformance}
   */
  getPerformance() {
    const metrics = this.pnlTracker.getPerformanceMetrics();
    return {
      strategyName: this.name,
      ...metrics,
    };
  }

  /**
   * Stop the strategy
   */
  stop() {
    this.isRunning = false;
    this.emit("stopped", { strategy: this.name });
  }
}

// ============================================================================
// Built-in Strategies (Based on Charlie's Research)
// ============================================================================

/**
 * Strategy 1: Longshot Fading
 * Sells YES contracts priced 5¢-20¢ in niche categories
 * Based on academic research showing favorite-longshot bias
 */
class LongshotFadingStrategy extends BaseStrategy {
  constructor(config = {}) {
    super("LongshotFading", config);
    this.minPrice = config.minPrice || 5;
    this.maxPrice = config.maxPrice || 20;
    this.targetCategories = config.targetCategories || ["Weather", "Entertainment", "Culture", "Geopolitics"];
    this.minConfidence = config.minConfidence || 0.7;
  }

  generateSignals(marketData) {
    const signals = [];
    
    for (const market of marketData.markets || []) {
      // Filter by category
      if (!this.targetCategories.includes(market.category)) {
        continue;
      }

      const price = market.yesMid;
      
      // Check if price is in our target range
      if (price >= this.minPrice && price <= this.maxPrice) {
        // Calculate edge based on favorite-longshot bias research
        // Research shows 5-20¢ contracts are systematically overpriced
        const overpricingFactor = (20 - price) / 15; // Higher overpricing at lower prices
        const edge = price * 0.15 * overpricingFactor; // ~15% edge on average
        
        // Confidence based on price (lower price = higher confidence in overpricing)
        const confidence = this.minConfidence + (0.25 * overpricingFactor);
        
        signals.push({
          marketId: market.ticker,
          direction: "sell_yes",
          confidence: Math.min(confidence, 0.95),
          edge: Math.min(edge, 10),
          price: price,
          strategy: this.name,
          timestamp: new Date(),
          metadata: {
            category: market.category,
            overpricingFactor,
            researchBasis: "UCD/GWU 2025 study - favorite-longshot bias",
          },
        });
      }
    }
    
    return signals;
  }
}

/**
 * Strategy 2: Economic Data Momentum
 * Trades economic data releases using pre-release information edge
 */
class EconomicMomentumStrategy extends BaseStrategy {
  constructor(config = {}) {
    super("EconomicMomentum", config);
    this.targetCategories = config.targetCategories || ["Economics", "Finance"];
    this.minDivergence = config.minDivergence || 8; // Min 8 percentage point divergence
    this.lookbackHours = config.lookbackHours || 48;
  }

  generateSignals(marketData) {
    const signals = [];
    
    for (const market of marketData.markets || []) {
      if (!this.targetCategories.includes(market.category)) {
        continue;
      }

      // Check if we have forecast data
      if (!market.forecast || !market.yesMid) {
        continue;
      }

      const impliedProb = market.yesMid / 100;
      const forecastProb = market.forecast.probability;
      const divergence = Math.abs(impliedProb - forecastProb) * 100;

      if (divergence >= this.minDivergence) {
        const edge = divergence * 0.5; // Conservative edge estimate
        const confidence = 0.5 + (divergence / 100);
        
        // Trade in direction of forecast
        const direction = forecastProb > impliedProb ? "buy_yes" : "sell_yes";
        
        signals.push({
          marketId: market.ticker,
          direction,
          confidence: Math.min(confidence, 0.9),
          edge,
          price: market.yesMid,
          strategy: this.name,
          timestamp: new Date(),
          metadata: {
            impliedProbability: impliedProb,
            forecastProbability: forecastProb,
            divergence,
            forecastSource: market.forecast.source,
            hoursToRelease: market.hoursToRelease,
          },
        });
      }
    }
    
    return signals;
  }
}

/**
 * Strategy 3: Cross-Platform Arbitrage
 * Exploits pricing divergences between platforms
 */
class ArbitrageStrategy extends BaseStrategy {
  constructor(config = {}) {
    super("Arbitrage", config);
    this.minSpread = config.minSpread || 3; // Min 3 cent spread
    this.maxHoldMinutes = config.maxHoldMinutes || 60;
  }

  generateSignals(marketData) {
    const signals = [];
    
    for (const market of marketData.markets || []) {
      // Check for cross-platform price data
      if (!market.externalPrices) {
        continue;
      }

      for (const [platform, price] of Object.entries(market.externalPrices)) {
        const spread = Math.abs(market.yesMid - price);
        
        if (spread >= this.minSpread) {
          // Determine which side to trade
          const kalshiCheaper = market.yesMid < price;
          const direction = kalshiCheaper ? "buy_yes" : "sell_yes";
          
          // Edge is spread minus estimated fees
          const estimatedFees = 2; // ~2 cents in fees
          const edge = spread - estimatedFees;
          
          if (edge > 0) {
            signals.push({
              marketId: market.ticker,
              direction,
              confidence: 0.85, // High confidence for arbitrage
              edge,
              price: market.yesMid,
              strategy: this.name,
              timestamp: new Date(),
              metadata: {
                platform,
                kalshiPrice: market.yesMid,
                externalPrice: price,
                spread,
                estimatedFees,
                maxHoldMinutes: this.maxHoldMinutes,
              },
            });
          }
        }
      }
    }
    
    return signals;
  }
}

// ============================================================================
// Strategy Registry & Manager
// ============================================================================

class StrategyManager {
  constructor() {
    this.strategies = new Map();
    this.activeStrategies = new Set();
  }

  /**
   * Register a strategy
   * @param {BaseStrategy} strategy - Strategy instance
   */
  register(strategy) {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Get a registered strategy
   * @param {string} name - Strategy name
   * @returns {BaseStrategy}
   */
  get(name) {
    return this.strategies.get(name);
  }

  /**
   * Start a strategy
   * @param {string} name - Strategy name
   * @param {Object} context - Trading context
   */
  start(name, context) {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new Error(`Strategy ${name} not found`);
    }
    
    strategy.initialize(context);
    this.activeStrategies.add(name);
  }

  /**
   * Stop a strategy
   * @param {string} name - Strategy name
   */
  stop(name) {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.stop();
      this.activeStrategies.delete(name);
    }
  }

  /**
   * Get all active strategies
   * @returns {Array<string>}
   */
  getActive() {
    return Array.from(this.activeStrategies);
  }

  /**
   * Get performance for all strategies
   * @returns {Array<StrategyPerformance>}
   */
  getAllPerformance() {
    const results = [];
    for (const strategy of this.strategies.values()) {
      results.push(strategy.getPerformance());
    }
    return results;
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Core classes
  BaseStrategy,
  PositionSizer,
  PnLTracker,
  StrategyManager,
  
  // Built-in strategies
  LongshotFadingStrategy,
  EconomicMomentumStrategy,
  ArbitrageStrategy,
  
  // Factory function
  createStrategyManager: () => new StrategyManager(),
};
