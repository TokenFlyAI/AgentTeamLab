/**
 * Parameter Sweep: Optimize Mean Reversion Strategy
 * 
 * Task 334: Run full parameter sweep to find optimal configuration
 * 
 * Parameter Space:
 * - zScoreThreshold: 0.8, 1.0, 1.2, 1.5, 2.0, 2.5 (6 values)
 * - lookback: 10, 14, 20, 30 (4 values)
 * - confidenceThreshold: 0.65, 0.70, 0.75, 0.80 (4 values)
 * 
 * Total: 96 combinations
 */

const fs = require('fs');
const path = require('path');

// Import synthetic market generator
const { SyntheticMarketGenerator, MARKET_CONFIGS } = require('./synthetic_market_generator.js');

// Parameter ranges
const PARAM_RANGES = {
  zScoreThreshold: [0.8, 1.0, 1.2, 1.5, 2.0, 2.5],
  lookback: [10, 14, 20, 30],
  confidenceThreshold: [0.65, 0.70, 0.75, 0.80]
};

// Mean Reversion Strategy (simplified for sweep)
class MeanReversionStrategy {
  constructor(params) {
    this.zScoreThreshold = params.zScoreThreshold;
    this.lookback = params.lookback;
    this.confidenceThreshold = params.confidenceThreshold;
  }

  generateSignal(market, candles) {
    if (!candles || candles.length < this.lookback) return null;

    // Use last 'lookback' candles
    const recentCandles = candles.slice(-this.lookback);
    const prices = recentCandles.map(c => c.close);
    
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
    const stddev = Math.sqrt(variance);

    if (stddev <= 0) return null;

    const currentPrice = market.yes_mid;
    const zScore = (currentPrice - mean) / stddev;

    if (Math.abs(zScore) < this.zScoreThreshold) return null;

    const confidence = Math.min(Math.abs(zScore) / 3, 0.95);
    
    if (confidence < this.confidenceThreshold) return null;

    const side = zScore > 0 ? 'no' : 'yes';
    const edge = Math.abs(zScore) * stddev;

    return {
      marketId: market.id,
      side,
      confidence,
      expectedEdge: Math.round(edge),
      zScore: Math.abs(zScore)
    };
  }
}

/**
 * Simulate trade outcome
 */
function simulateTradeOutcome(signal, market, candles) {
  // Simulate mean reversion: price moves toward historical mean
  const currentPrice = market.yes_mid;
  const historicalMean = candles.reduce((a, c) => a + c.close, 0) / candles.length;
  
  // Mean reversion strength depends on z-score
  const reversionStrength = signal.zScore * 2; // 2 cents per z-point
  
  // Simulate next price (mean reversion + noise)
  const noise = (Math.random() - 0.5) * 4;
  const targetPrice = currentPrice + (historicalMean - currentPrice) * 0.3 + noise;
  
  // Win if price moved in expected direction
  const expectedDirection = signal.side === 'yes' ? 1 : -1;
  const actualMove = targetPrice - currentPrice;
  
  const isWin = (expectedDirection * actualMove) > 0;
  const pnl = isWin ? signal.expectedEdge : -10;
  
  return { isWin, pnl, targetPrice };
}

/**
 * Run single parameter combination
 */
function testParams(params, markets, generator) {
  const strategy = new MeanReversionStrategy(params);
  let wins = 0;
  let losses = 0;
  let totalPnL = 0;
  let signalsGenerated = 0;
  let totalTrades = 0;

  markets.forEach(market => {
    // Generate candles for this market
    const candles = generator.generateCandles(market, {
      periods: params.lookback + 5,
      currentPriceHint: market.yes_mid,
      category: market.category
    });

    const signal = strategy.generateSignal(market, candles);
    totalTrades++;

    if (signal) {
      signalsGenerated++;
      const outcome = simulateTradeOutcome(signal, market, candles);
      
      if (outcome.isWin) wins++;
      else losses++;
      
      totalPnL += outcome.pnl;
    }
  });

  const winRate = signalsGenerated > 0 ? (wins / signalsGenerated * 100) : 0;
  const signalRate = (signalsGenerated / totalTrades * 100);
  const avgPnL = signalsGenerated > 0 ? (totalPnL / signalsGenerated) : 0;

  return {
    params,
    wins,
    losses,
    signalsGenerated,
    totalTrades,
    winRate: Math.round(winRate * 100) / 100,
    signalRate: Math.round(signalRate * 100) / 100,
    totalPnL: Math.round(totalPnL),
    avgPnL: Math.round(avgPnL * 100) / 100
  };
}

/**
 * Run full parameter sweep
 */
function runParameterSweep() {
  console.log('Parameter Sweep: Mean Reversion Strategy Optimization');
  console.log('=' .repeat(80));
  console.log();

  // Generate test markets
  const generator = new SyntheticMarketGenerator(42);
  const markets = [];
  
  // Create diverse market conditions
  const categories = Object.keys(MARKET_CONFIGS);
  for (let i = 0; i < 50; i++) {
    const category = categories[i % categories.length];
    const basePrice = 25 + (i * 1.5) % 60; // Range 25-85
    
    markets.push({
      id: `market-${i}`,
      ticker: `TEST-${category}-${i}`,
      yes_mid: Math.round(basePrice),
      no_mid: Math.round(100 - basePrice),
      category: category,
      volume: 50000 + Math.floor(Math.random() * 150000)
    });
  }

  console.log(`Test Markets: ${markets.length}`);
  console.log(`Parameter Combinations: 96 (6 z × 4 lookback × 4 confidence)`);
  console.log();

  // Generate all combinations
  const results = [];
  let completed = 0;

  for (const zScore of PARAM_RANGES.zScoreThreshold) {
    for (const lookback of PARAM_RANGES.lookback) {
      for (const conf of PARAM_RANGES.confidenceThreshold) {
        const params = { zScoreThreshold: zScore, lookback, confidenceThreshold: conf };
        const result = testParams(params, markets, generator);
        results.push(result);
        
        completed++;
        if (completed % 20 === 0) {
          console.log(`  Progress: ${completed}/96 combinations tested...`);
        }
      }
    }
  }

  return results;
}

/**
 * Analyze and rank results
 */
function analyzeResults(results) {
  console.log('\n' + '=' .repeat(80));
  console.log('ANALYSIS RESULTS');
  console.log('=' .repeat(80));

  // Filter results with at least 10 signals for statistical significance
  const validResults = results.filter(r => r.signalsGenerated >= 10);
  
  console.log(`\nValid Results (≥10 signals): ${validResults.length}/${results.length}`);

  // Sort by win rate
  const byWinRate = [...validResults].sort((a, b) => b.winRate - a.winRate);
  
  // Sort by total PnL
  const byPnL = [...validResults].sort((a, b) => b.totalPnL - a.totalPnL);
  
  // Sort by Sharpe-like ratio (win rate * signal rate)
  const byEfficiency = [...validResults].sort((a, b) => 
    (b.winRate * b.signalRate) - (a.winRate * a.signalRate)
  );

  // Top 10 by win rate
  console.log('\n🏆 TOP 10 BY WIN RATE');
  console.log('-'.repeat(80));
  console.log(`${'Rank'.padEnd(6)} ${'Z-Score'.padEnd(8)} ${'Lookback'.padEnd(10)} ${'Conf'.padEnd(8)} ${'Win%'.padEnd(8)} ${'Signals'.padEnd(10)} ${'Total P&L'.padEnd(12)}`);
  console.log('-'.repeat(80));
  
  byWinRate.slice(0, 10).forEach((r, i) => {
    console.log(
      `${(i + 1).toString().padEnd(6)} ` +
      `${r.params.zScoreThreshold.toString().padEnd(8)} ` +
      `${r.params.lookback.toString().padEnd(10)} ` +
      `${(r.params.confidenceThreshold * 100).toFixed(0)}%`.padEnd(8) +
      `${r.winRate.toFixed(1)}%`.padEnd(8) +
      `${r.signalsGenerated.toString().padEnd(10)} ` +
      `${r.totalPnL}c`.padEnd(12)
    );
  });

  // Top 10 by PnL
  console.log('\n💰 TOP 10 BY TOTAL P&L');
  console.log('-'.repeat(80));
  console.log(`${'Rank'.padEnd(6)} ${'Z-Score'.padEnd(8)} ${'Lookback'.padEnd(10)} ${'Conf'.padEnd(8)} ${'Win%'.padEnd(8)} ${'Signals'.padEnd(10)} ${'Total P&L'.padEnd(12)}`);
  console.log('-'.repeat(80));
  
  byPnL.slice(0, 10).forEach((r, i) => {
    console.log(
      `${(i + 1).toString().padEnd(6)} ` +
      `${r.params.zScoreThreshold.toString().padEnd(8)} ` +
      `${r.params.lookback.toString().padEnd(10)} ` +
      `${(r.params.confidenceThreshold * 100).toFixed(0)}%`.padEnd(8) +
      `${r.winRate.toFixed(1)}%`.padEnd(8) +
      `${r.signalsGenerated.toString().padEnd(10)} ` +
      `${r.totalPnL}c`.padEnd(12)
    );
  });

  // Best balanced (good win rate + reasonable signal count)
  const balanced = validResults.filter(r => r.winRate >= 50 && r.signalsGenerated >= 15);
  const byBalanced = balanced.sort((a, b) => b.winRate - a.winRate);
  
  console.log('\n⚖️ BEST BALANCED (Win% ≥ 50, Signals ≥ 15)');
  console.log('-'.repeat(80));
  console.log(`${'Rank'.padEnd(6)} ${'Z-Score'.padEnd(8)} ${'Lookback'.padEnd(10)} ${'Conf'.padEnd(8)} ${'Win%'.padEnd(8)} ${'Signals'.padEnd(10)} ${'Total P&L'.padEnd(12)}`);
  console.log('-'.repeat(80));
  
  byBalanced.slice(0, 5).forEach((r, i) => {
    console.log(
      `${(i + 1).toString().padEnd(6)} ` +
      `${r.params.zScoreThreshold.toString().padEnd(8)} ` +
      `${r.params.lookback.toString().padEnd(10)} ` +
      `${(r.params.confidenceThreshold * 100).toFixed(0)}%`.padEnd(8) +
      `${r.winRate.toFixed(1)}%`.padEnd(8) +
      `${r.signalsGenerated.toString().padEnd(10)} ` +
      `${r.totalPnL}c`.padEnd(12)
    );
  });

  return {
    topWinRate: byWinRate[0],
    topPnL: byPnL[0],
    topBalanced: byBalanced[0] || byWinRate[0]
  };
}

/**
 * Generate optimized params JSON
 */
function generateOptimizedParams(best) {
  const optimized = {
    version: "3.0",
    description: "Optimized mean reversion parameters from sweep analysis (T334)",
    generatedAt: new Date().toISOString(),
    optimizationMethod: "grid_search",
    testMarkets: 50,
    combinationsTested: 96,
    
    recommended: {
      name: "Balanced",
      params: best.topBalanced.params,
      performance: {
        winRate: best.topBalanced.winRate,
        signalsGenerated: best.topBalanced.signalsGenerated,
        totalPnL: best.topBalanced.totalPnL,
        avgPnL: best.topBalanced.avgPnL
      }
    },
    
    alternatives: {
      maxWinRate: {
        name: "Max Win Rate",
        params: best.topWinRate.params,
        performance: {
          winRate: best.topWinRate.winRate,
          signalsGenerated: best.topWinRate.signalsGenerated,
          totalPnL: best.topWinRate.totalPnL
        }
      },
      maxPnL: {
        name: "Max P&L",
        params: best.topPnL.params,
        performance: {
          winRate: best.topPnL.winRate,
          signalsGenerated: best.topPnL.signalsGenerated,
          totalPnL: best.topPnL.totalPnL
        }
      }
    },
    
    parameterRanges: PARAM_RANGES,
    notes: [
      "Optimizations based on synthetic OU market data",
      "Real market performance may vary",
      "Recommend paper trading before live deployment",
      "Monitor for regime changes"
    ]
  };

  return optimized;
}

/**
 * Main execution
 */
function main() {
  console.log('\n' + '='.repeat(80));
  console.log('PARAMETER SWEEP: MEAN REVERSION OPTIMIZATION (T334)');
  console.log('='.repeat(80));
  console.log();

  // Run sweep
  const results = runParameterSweep();
  
  // Analyze
  const best = analyzeResults(results);
  
  // Generate optimized params
  const optimized = generateOptimizedParams(best);
  
  // Save to file
  const outputPath = path.join(__dirname, 'output/optimized_params.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(optimized, null, 2));
  
  console.log(`\n✅ Optimized parameters saved to: ${outputPath}`);
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDED PARAMETERS');
  console.log('='.repeat(80));
  console.log(`Z-Score Threshold: ${optimized.recommended.params.zScoreThreshold}`);
  console.log(`Lookback Periods: ${optimized.recommended.params.lookback}`);
  console.log(`Confidence Threshold: ${optimized.recommended.params.confidenceThreshold}`);
  console.log(`Expected Win Rate: ${optimized.recommended.performance.winRate}%`);
  console.log(`Expected Signals: ${optimized.recommended.performance.signalsGenerated}`);
  console.log('='.repeat(80));
  
  return optimized;
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { runParameterSweep, analyzeResults, generateOptimizedParams };
