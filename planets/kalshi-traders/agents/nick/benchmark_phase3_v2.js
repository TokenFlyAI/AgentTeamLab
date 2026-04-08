const fs = require('fs');
const path = require('path');

/**
 * Benchmark Phase 3 Pearson Correlation with Object Creation and Sorting
 */

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  
  const xSlice = x.slice(-n);
  const ySlice = y.slice(-n);
  
  const sumX = xSlice.reduce((a, b) => a + b, 0);
  const sumY = ySlice.reduce((a, b) => a + b, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const diffX = xSlice[i] - meanX;
    const diffY = ySlice[i] - meanY;
    numerator += diffX * diffY;
    denomX += diffX * diffX;
    denomY += diffY * diffY;
  }
  
  const denominator = Math.sqrt(denomX * denomY);
  if (denominator === 0) return 0;
  
  return numerator / denominator;
}

function generatePriceHistory(ticker, length) {
  const prices = [];
  let price = 50;
  for (let i = 0; i < length; i++) {
    price += (Math.random() - 0.5) * 4;
    prices.push(Math.round(price));
  }
  return prices;
}

function benchmark(numMarkets, historyLength) {
  console.log(`\nBenchmarking ${numMarkets} markets with ${historyLength} periods...`);
  
  const startTime = Date.now();
  
  // 1. Generate data
  const genStartTime = Date.now();
  const markets = [];
  for (let i = 0; i < numMarkets; i++) {
    markets.push({
      ticker: `M${i}`,
      prices: generatePriceHistory(`M${i}`, historyLength)
    });
  }
  const genDuration = Date.now() - genStartTime;
  
  // 2. Compute correlations and create objects
  const corrStartTime = Date.now();
  const allPairs = [];
  
  for (let i = 0; i < numMarkets; i++) {
    for (let j = i + 1; j < numMarkets; j++) {
      const r = pearsonCorrelation(markets[i].prices, markets[j].prices);
      
      // Mimic the object creation in run_pipeline.js
      if (Math.abs(r) > 0.6) {
        allPairs.push({
          market_a: markets[i].ticker,
          market_b: markets[j].ticker,
          pearson_correlation: parseFloat(r.toFixed(4)),
          expected_spread: 0,
          current_spread: 0,
          spread_deviation: 1.5,
          arbitrage_confidence: Math.random(),
          direction: "buy_A_sell_B",
          is_arbitrage_opportunity: true,
        });
      }
    }
  }
  const corrDuration = Date.now() - corrStartTime;
  
  // 3. Sort
  const sortStartTime = Date.now();
  allPairs.sort((a, b) => b.arbitrage_confidence - a.arbitrage_confidence);
  const sortDuration = Date.now() - sortStartTime;
  
  const totalDuration = Date.now() - startTime;
  
  console.log(`Results:`);
  console.log(`  Generation: ${genDuration}ms`);
  console.log(`  Correlation + Objects: ${corrDuration}ms`);
  console.log(`  Sorting ${allPairs.length} pairs: ${sortDuration}ms`);
  console.log(`  Total: ${totalDuration}ms`);
  
  return {
    numMarkets,
    historyLength,
    genDuration,
    corrDuration,
    sortDuration,
    totalDuration,
    numPairs: allPairs.length
  };
}

const scenarios = [
  [100, 60],
  [500, 60],
  [1000, 60],
  [2000, 60],
];

console.log("=== Phase 3 Performance Benchmark (V2) ===");
const results = scenarios.map(s => benchmark(s[0], s[1]));

fs.writeFileSync('benchmark_results_v2.json', JSON.stringify(results, null, 2));
console.log("\nBenchmark complete. Results saved to benchmark_results_v2.json");
