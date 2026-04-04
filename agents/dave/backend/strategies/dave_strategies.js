/**
 * Dave's Strategy Implementations — Task 220
 * Integrates with Bob's backend infrastructure
 * 
 * Exports:
 *   - LongshotFadingStrategy
 *   - EconomicMomentumStrategy  
 *   - CrossPlatformArbitrageStrategy
 *   - StrategyFactory
 */

"use strict";

const { LongshotFadingStrategy } = require("./longshot_fading");
const { EconomicMomentumStrategy } = require("./economic_momentum");
const { CrossPlatformArbitrageStrategy } = require("./cross_platform_arbitrage");

// Import Bob's infrastructure
const { SignalEngine } = require("../../bob/backend/strategies/signal_engine");
const { PositionSizer } = require("../../bob/backend/strategies/position_sizer");
const { PnLTracker } = require("../../bob/backend/strategies/pnl_tracker");

/**
 * StrategyFactory creates pre-configured strategy instances
 * that work with Bob's SignalEngine and infrastructure.
 */
class StrategyFactory {
  constructor(options = {}) {
    this.accountBalance = options.accountBalance || 100000;  // $1,000 default
    this.useKelly = options.useKelly !== false;  // Default to Kelly sizing
  }

  /**
   * Create all three strategies with proper configuration
   * @returns {Object} Object containing all strategies
   */
  createAll() {
    return {
      longshotFading: this.createLongshotFading(),
      economicMomentum: this.createEconomicMomentum(),
      arbitrage: this.createArbitrage()
    };
  }

  /**
   * Create Longshot Fading strategy
   * Sells YES 5¢-20¢ in niche categories
   */
  createLongshotFading() {
    return new LongshotFadingStrategy({
      minPrice: 5,
      maxPrice: 20,
      targetCategories: ["Weather", "Entertainment", "Culture", "Geopolitics"],
      minConfidence: 0.7,
      minEdge: 2
    });
  }

  /**
   * Create Economic Momentum strategy
   * Trades macro data releases using forecast divergence
   */
  createEconomicMomentum() {
    return new EconomicMomentumStrategy({
      targetCategories: ["Economics", "Financial"],
      minDivergence: 8,
      maxHoursToRelease: 48,
      minConfidence: 0.6,
      minEdge: 3
    });
  }

  /**
   * Create Cross-Platform Arbitrage strategy
   * Exploits price divergences between platforms
   */
  createArbitrage() {
    return new CrossPlatformArbitrageStrategy({
      minSpread: 3,
      maxHoldMinutes: 30,
      estimatedFees: 2,
      minConfidence: 0.85,
      minEdge: 1
    });
  }

  /**
   * Create a SignalEngine configured for our strategies
   */
  createSignalEngine() {
    return new SignalEngine({
      minConfidence: 0.6,
      minEdge: 2,
      maxSignalsPerRun: 50
    });
  }

  /**
   * Create a PositionSizer with Kelly criterion
   */
  createPositionSizer() {
    return new PositionSizer({
      accountBalance: this.accountBalance,
      maxRiskPerTrade: 0.02,      // 2% risk per trade
      maxPositionPct: 0.20,       // 20% max position
      minContracts: 1,
      maxContracts: 1000,
      useKelly: this.useKelly,
      kellyFraction: 0.25         // Quarter Kelly for safety
    });
  }

  /**
   * Create a PnLTracker
   * @param {Object} pool - Database pool
   */
  createPnLTracker(pool = null) {
    return new PnLTracker({ pool });
  }
}

/**
 * Run all strategies against market data using Bob's SignalEngine
 * @param {Array} markets - Market data from API
 * @param {Object} options - Configuration options
 * @returns {Object} Results with signals from each strategy
 */
function runAllStrategies(markets, options = {}) {
  const factory = new StrategyFactory(options);
  const engine = factory.createSignalEngine();
  const strategies = factory.createAll();
  
  const results = {
    timestamp: new Date(),
    marketCount: markets.length,
    signals: {
      longshotFading: [],
      economicMomentum: [],
      arbitrage: []
    },
    allSignals: []
  };

  // Run each strategy
  for (const [name, strategy] of Object.entries(strategies)) {
    const signals = engine.scan(markets, strategy);
    results.signals[name] = signals;
    results.allSignals.push(...signals.map(s => ({ ...s, strategyName: name })));
  }

  // Sort all signals by confidence
  results.allSignals.sort((a, b) => b.confidence - a.confidence);
  
  return results;
}

module.exports = {
  // Strategy classes
  LongshotFadingStrategy,
  EconomicMomentumStrategy,
  CrossPlatformArbitrageStrategy,
  
  // Factory and utilities
  StrategyFactory,
  runAllStrategies,
  
  // Re-export Bob's infrastructure for convenience
  SignalEngine,
  PositionSizer,
  PnLTracker
};
