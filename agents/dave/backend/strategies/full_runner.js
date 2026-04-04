/**
 * Full Strategy Runner — Executes trading strategies with live market data
 * Author: Dave (Full Stack Engineer)
 * Task: #220
 * 
 * Integrates with Bob's Kalshi client to:
 *   - Fetch market data
 *   - Run strategies
 *   - Execute paper/live trades
 *   - Track P&L
 */

"use strict";

const { 
  StrategyManager, 
  LongshotFadingStrategy,
  EconomicMomentumStrategy,
  ArbitrageStrategy,
  PnLTracker,
} = require("./index");

// Import Bob's Kalshi client
const { KalshiClient } = require("../../bob/backend/kalshi_client.js");

// ============================================================================
// Strategy Runner
// ============================================================================

class StrategyRunner {
  /**
   * Create a strategy runner
   * @param {Object} opts
   * @param {string} opts.apiKey - Kalshi API key
   * @param {boolean} opts.demo - Use demo mode (default: true)
   * @param {number} opts.initialCapital - Starting capital in cents
   * @param {number} opts.pollIntervalMs - Market data poll interval (default: 60000)
   */
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || process.env.KALSHI_API_KEY;
    this.demo = opts.demo !== false;
    this.initialCapital = opts.initialCapital || 100000; // $1,000 default
    this.pollIntervalMs = opts.pollIntervalMs || 60000;
    
    this.client = new KalshiClient({
      apiKey: this.apiKey,
      demo: this.demo,
    });
    
    this.manager = new StrategyManager();
    this.isRunning = false;
    this.pollTimer = null;
    this.orderHistory = [];
    
    // Default strategy configs
    this.strategyConfigs = opts.strategyConfigs || {
      LongshotFading: {
        minPrice: 5,
        maxPrice: 20,
        targetCategories: ["Weather", "Entertainment", "Culture"],
        positionSizing: {
          kellyFraction: 0.25,
          maxPositionPct: 0.05,
        },
      },
      EconomicMomentum: {
        targetCategories: ["Economics", "Financial"],
        minDivergence: 8,
        positionSizing: {
          kellyFraction: 0.3,
          maxPositionPct: 0.1,
        },
      },
      Arbitrage: {
        minSpread: 3,
        maxHoldMinutes: 30,
        positionSizing: {
          kellyFraction: 0.5,
          maxPositionPct: 0.2,
        },
      },
    };
  }

  /**
   * Initialize and register all strategies
   */
  initialize() {
    // Register Longshot Fading strategy
    this.manager.register(new LongshotFadingStrategy(this.strategyConfigs.LongshotFading));
    
    // Register Economic Momentum strategy
    this.manager.register(new EconomicMomentumStrategy(this.strategyConfigs.EconomicMomentum));
    
    // Register Arbitrage strategy
    this.manager.register(new ArbitrageStrategy(this.strategyConfigs.Arbitrage));
    
    console.log("✅ Strategy runner initialized with strategies:");
    console.log("   - LongshotFading");
    console.log("   - EconomicMomentum");
    console.log("   - Arbitrage");
  }

  /**
   * Fetch market data from Kalshi API
   * @returns {Promise<Object>} Market data
   */
  async fetchMarketData() {
    try {
      // Get active markets
      const marketsResponse = await this.client.getMarkets({ 
        status: "active",
        limit: 100,
      });
      
      const markets = marketsResponse.data?.markets || [];
      
      // Enrich with price data
      const enrichedMarkets = [];
      
      for (const market of markets.slice(0, 20)) { // Limit to 20 for rate limiting
        try {
          const orderbook = await this.client.getOrderbook(market.ticker, 5);
          const book = orderbook.data?.orderbook;
          
          if (book) {
            const yesBid = book.yes?.[0]?.price || null;
            const yesAsk = book.yes?.[0]?.price || null;
            const noBid = book.no?.[0]?.price || null;
            const noAsk = book.no?.[0]?.price || null;
            
            enrichedMarkets.push({
              id: market.id,
              ticker: market.ticker,
              title: market.title,
              category: market.category,
              status: market.status,
              yesBid,
              yesAsk,
              noBid,
              noAsk,
              yesMid: yesBid && yesAsk ? (yesBid + yesAsk) / 2 : (yesBid || yesAsk),
              noMid: noBid && noAsk ? (noBid + noAsk) / 2 : (noBid || noAsk),
              volume: market.volume || 0,
              openInterest: market.open_interest || 0,
              closeDate: market.close_date,
            });
          }
        } catch (e) {
          // Skip markets we can't fetch
          continue;
        }
        
        // Small delay to respect rate limits
        await sleep(100);
      }
      
      return {
        timestamp: new Date(),
        markets: enrichedMarkets,
        count: enrichedMarkets.length,
      };
    } catch (error) {
      console.error("❌ Failed to fetch market data:", error.message);
      throw error;
    }
  }

  /**
   * Run all active strategies against market data
   * @param {Object} marketData - Market data
   * @returns {Array} Generated signals
   */
  runStrategies(marketData) {
    const allSignals = [];
    
    for (const strategyName of this.manager.getActive()) {
      const strategy = this.manager.get(strategyName);
      
      try {
        const signals = strategy.generateSignals(marketData);
        
        for (const signal of signals) {
          const order = strategy.processSignal(signal);
          if (order) {
            this.orderHistory.push({
              ...order,
              status: "pending",
              createdAt: new Date(),
            });
          }
        }
        
        allSignals.push(...signals);
        
        if (signals.length > 0) {
          console.log(`📊 ${strategyName}: Generated ${signals.length} signals`);
        }
      } catch (error) {
        console.error(`❌ Error in ${strategyName}:`, error.message);
      }
    }
    
    return allSignals;
  }

  /**
   * Execute pending orders (paper trading)
   * @returns {Promise<Array>} Executed orders
   */
  async executeOrders() {
    const executed = [];
    const pending = this.orderHistory.filter(o => o.status === "pending");
    
    for (const order of pending) {
      try {
        // For paper trading, simulate execution
        if (this.demo) {
          order.status = "filled";
          order.filledAt = new Date();
          order.filledPrice = order.price;
          order.filledContracts = order.contracts;
          
          // Record position in strategy's PnL tracker
          const strategy = this.manager.get(order.signal.strategy);
          if (strategy) {
            strategy.pnlTracker.recordOpen({
              id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              marketId: order.marketId,
              side: order.side,
              contracts: order.contracts,
              avgEntryPrice: order.filledPrice,
              currentPrice: order.filledPrice,
              unrealizedPnl: 0,
              status: "open",
              openedAt: new Date(),
            });
          }
          
          console.log(`✅ Paper trade executed: ${order.side.toUpperCase()} ${order.contracts} contracts @ ${order.price}¢`);
          executed.push(order);
        } else {
          // Live trading - use Kalshi API
          const result = await this.client.createOrder({
            ticker: order.marketId,
            side: order.side,
            action: order.action,
            count: order.contracts,
            price: order.price,
          });
          
          order.status = "submitted";
          order.kalshiOrderId = result.data?.order?.id;
          executed.push(order);
        }
      } catch (error) {
        order.status = "error";
        order.error = error.message;
        console.error(`❌ Order execution failed:`, error.message);
      }
    }
    
    return executed;
  }

  /**
   * Update positions with latest prices
   * @param {Object} marketData - Current market data
   */
  updatePositions(marketData) {
    for (const market of marketData.markets || []) {
      for (const strategyName of this.manager.getActive()) {
        const strategy = this.manager.get(strategyName);
        strategy.updatePrice(market.ticker, market.yesMid);
      }
    }
  }

  /**
   * Get comprehensive status report
   * @returns {Object} Status report
   */
  getStatus() {
    const strategyPerformance = this.manager.getAllPerformance();
    
    // Aggregate P&L across all strategies
    let totalRealizedPnl = 0;
    let totalUnrealizedPnl = 0;
    let totalTrades = 0;
    
    for (const perf of strategyPerformance) {
      totalRealizedPnl += perf.totalPnl || 0;
      totalTrades += perf.totalTrades || 0;
    }
    
    // Calculate unrealized from open positions
    for (const strategyName of this.manager.getActive()) {
      const strategy = this.manager.get(strategyName);
      const summary = strategy.pnlTracker.getPortfolioSummary();
      totalUnrealizedPnl += summary.unrealizedPnl;
    }
    
    return {
      isRunning: this.isRunning,
      demo: this.demo,
      activeStrategies: this.manager.getActive(),
      initialCapital: this.initialCapital,
      currentCapital: this.initialCapital + totalRealizedPnl,
      totalRealizedPnl,
      totalUnrealizedPnl,
      totalPnl: totalRealizedPnl + totalUnrealizedPnl,
      totalReturn: (totalRealizedPnl + totalUnrealizedPnl) / this.initialCapital,
      totalTrades,
      pendingOrders: this.orderHistory.filter(o => o.status === "pending").length,
      filledOrders: this.orderHistory.filter(o => o.status === "filled").length,
      strategyPerformance,
    };
  }

  /**
   * Main run loop - fetch data, run strategies, execute orders
   */
  async runCycle() {
    console.log("\n🔄 Running strategy cycle...");
    
    try {
      // Fetch market data
      const marketData = await this.fetchMarketData();
      console.log(`📈 Fetched ${marketData.count} markets`);
      
      // Update existing positions with new prices
      this.updatePositions(marketData);
      
      // Run strategies
      const signals = this.runStrategies(marketData);
      console.log(`🎯 Generated ${signals.length} total signals`);
      
      // Execute orders
      const executed = await this.executeOrders();
      console.log(`✅ Executed ${executed.length} orders`);
      
      // Print status
      const status = this.getStatus();
      console.log(`💰 P&L: $${(status.totalPnl / 100).toFixed(2)} (${(status.totalReturn * 100).toFixed(2)}%)`);
      
    } catch (error) {
      console.error("❌ Cycle error:", error.message);
    }
  }

  /**
   * Start the runner
   */
  async start() {
    if (this.isRunning) {
      console.log("⚠️ Runner already started");
      return;
    }
    
    this.initialize();
    
    // Start all strategies
    const context = {
      initialCapital: Math.floor(this.initialCapital / 3), // Split capital among strategies
      client: this.client,
    };
    
    this.manager.start("LongshotFading", context);
    this.manager.start("EconomicMomentum", context);
    this.manager.start("Arbitrage", context);
    
    this.isRunning = true;
    
    // Run first cycle immediately
    await this.runCycle();
    
    // Set up polling
    this.pollTimer = setInterval(() => {
      this.runCycle();
    }, this.pollIntervalMs);
    
    console.log(`\n🚀 Strategy runner started (polling every ${this.pollIntervalMs / 1000}s)`);
  }

  /**
   * Stop the runner
   */
  stop() {
    this.isRunning = false;
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    // Stop all strategies
    for (const name of this.manager.getActive()) {
      this.manager.stop(name);
    }
    
    console.log("\n🛑 Strategy runner stopped");
    
    // Print final report
    const status = this.getStatus();
    console.log("\n📊 Final Report:");
    console.log(`   Total Return: ${(status.totalReturn * 100).toFixed(2)}%`);
    console.log(`   Total P&L: $${(status.totalPnl / 100).toFixed(2)}`);
    console.log(`   Total Trades: ${status.totalTrades}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// CLI / Standalone
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     Agent Planet — Trading Strategy Framework v1.0         ║");
  console.log("║     Task #220 — Dave (Full Stack Engineer)                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  
  const runner = new StrategyRunner({
    demo: true,
    initialCapital: 100000, // $1,000
    pollIntervalMs: 30000,  // 30 seconds for demo
  });
  
  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\nReceived SIGINT, shutting down...");
    runner.stop();
    process.exit(0);
  });
  
  try {
    await runner.start();
  } catch (error) {
    console.error("Failed to start runner:", error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  StrategyRunner,
};
