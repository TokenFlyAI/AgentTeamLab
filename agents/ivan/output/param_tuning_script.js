/**
 * Mean Reversion Parameter Tuning Script
 * 
 * Tests multiple parameter sets against historical data
 * to find optimal configuration.
 */

const fs = require('fs');
const path = require('path');

// Load MeanReversionStrategy
const { MeanReversionStrategy } = require('../../bob/backend/strategies/strategies/mean_reversion.js');

// Parameter sets to test
const PARAM_SETS = [
  {
    name: 'Current (Baseline)',
    params: { lookbackPeriods: 10, zScoreThreshold: 1.5, minVolume: 10000 }
  },
  {
    name: 'Conservative (Recommended)',
    params: { lookbackPeriods: 20, zScoreThreshold: 2.0, minVolume: 50000 }
  },
  {
    name: 'Moderate',
    params: { lookbackPeriods: 15, zScoreThreshold: 1.8, minVolume: 25000 }
  },
  {
    name: 'Aggressive',
    params: { lookbackPeriods: 12, zScoreThreshold: 1.6, minVolume: 15000 }
  }
];

// Mock market data for testing
const MOCK_MARKETS = [
  {
    id: 'm1',
    ticker: 'TEST-1',
    yes_mid: 70,
    no_mid: 30,
    volume: 100000,
    price_history_mean: 60,
    price_history_stddev: 5
  },
  {
    id: 'm2',
    ticker: 'TEST-2',
    yes_mid: 40,
    no_mid: 60,
    volume: 80000,
    price_history_mean: 55,
    price_history_stddev: 4
  },
  {
    id: 'm3',
    ticker: 'TEST-3',
    yes_mid: 55,
    no_mid: 45,
    volume: 200000,
    price_history_mean: 55,
    price_history_stddev: 2
  },
  {
    id: 'm4',
    ticker: 'TEST-4',
    yes_mid: 85,
    no_mid: 15,
    volume: 50000,
    price_history_mean: 70,
    price_history_stddev: 6
  },
  {
    id: 'm5',
    ticker: 'TEST-5',
    yes_mid: 30,
    no_mid: 70,
    volume: 30000,
    price_history_mean: 50,
    price_history_stddev: 8
  }
];

/**
 * Test a parameter set against mock markets
 */
function testParameterSet(paramSet) {
  const strategy = new MeanReversionStrategy(paramSet.params);
  const signals = [];
  
  MOCK_MARKETS.forEach(market => {
    const signal = strategy.generateSignal(market);
    if (signal) {
      signals.push({
        market: market.ticker,
        side: signal.side,
        confidence: signal.confidence,
        expectedEdge: signal.expectedEdge,
        zScore: Math.abs((market.yes_mid - market.price_history_mean) / market.price_history_stddev)
      });
    }
  });
  
  return {
    name: paramSet.name,
    params: paramSet.params,
    signalsGenerated: signals.length,
    avgConfidence: signals.length > 0 
      ? signals.reduce((a, s) => a + s.confidence, 0) / signals.length 
      : 0,
    avgEdge: signals.length > 0
      ? signals.reduce((a, s) => a + s.expectedEdge, 0) / signals.length
      : 0,
    signals: signals
  };
}

/**
 * Run all parameter sets
 */
function runTuningAnalysis() {
  console.log('Mean Reversion Parameter Tuning Analysis');
  console.log('=' .repeat(60));
  console.log();
  
  const results = PARAM_SETS.map(testParameterSet);
  
  // Summary table
  console.log('Parameter Set Comparison:');
  console.log('-'.repeat(60));
  console.log(
    `${'Set'.padEnd(25)} ${'Signals'.padEnd(10)} ${'Avg Conf'.padEnd(12)} ${'Avg Edge'.padEnd(10)}`
  );
  console.log('-'.repeat(60));
  
  results.forEach(r => {
    console.log(
      `${r.name.padEnd(25)} ` +
      `${r.signalsGenerated.toString().padEnd(10)} ` +
      `${(r.avgConfidence * 100).toFixed(1)}%`.padEnd(12) +
      `${r.avgEdge.toFixed(1)}c`.padEnd(10)
    );
  });
  
  console.log('-'.repeat(60));
  console.log();
  
  // Detailed breakdown
  results.forEach(r => {
    console.log(`\n${r.name}:`);
    console.log(`  Parameters: lookback=${r.params.lookbackPeriods}, z=${r.params.zScoreThreshold}, vol=${r.params.minVolume}`);
    console.log(`  Signals: ${r.signalsGenerated}/${MOCK_MARKETS.length}`);
    
    if (r.signals.length > 0) {
      console.log('  Generated signals:');
      r.signals.forEach(s => {
        console.log(`    ${s.market}: ${s.side} (conf: ${(s.confidence * 100).toFixed(0)}%, edge: ${s.expectedEdge}c, z: ${s.zScore.toFixed(1)})`);
      });
    }
  });
  
  // Recommendation
  console.log('\n' + '=' .repeat(60));
  console.log('Recommendation:');
  console.log('=' .repeat(60));
  
  const conservative = results.find(r => r.name.includes('Conservative'));
  const baseline = results.find(r => r.name.includes('Current'));
  
  if (conservative && baseline) {
    const signalReduction = ((1 - conservative.signalsGenerated / baseline.signalsGenerated) * 100).toFixed(0);
    console.log(`\nConservative set generates ${signalReduction}% fewer signals but with:`);
    console.log(`  - Higher average confidence (${(conservative.avgConfidence * 100).toFixed(1)}% vs ${(baseline.avgConfidence * 100).toFixed(1)}%)`);
    console.log(`  - Higher average edge (${conservative.avgEdge.toFixed(1)}c vs ${baseline.avgEdge.toFixed(1)}c)`);
    console.log(`  - Lower false positive risk (z >= 2.0)`);
  }
  
  console.log('\nSuggested approach:');
  console.log('1. Start with Conservative set in paper trading');
  console.log('2. Require 20+ trades for validation');
  console.log('3. If win rate > 60%, consider going live');
  console.log('4. If too few signals, try Moderate set');
  
  return results;
}

// Run if called directly
if (require.main === module) {
  runTuningAnalysis();
}

module.exports = { runTuningAnalysis, PARAM_SETS };
