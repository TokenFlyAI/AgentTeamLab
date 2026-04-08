const fs = require('fs');
const path = require('path');

/**
 * Benchmark Phase 3 Pearson Correlation
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
  
  // 2. Compute correlations
  const corrStartTime = Date.now();
  let pairsAnalyzed = 0;
  let significantPairs = 0;
  
  for (let i = 0; i < numMarkets; i++) {
    for (let j = i + 1; j < numMarkets; j++) {
      const r = pearsonCorrelation(markets[i].prices, markets[j].prices);
      pairsAnalyzed++;
      if (Math.abs(r) > 0.75) {
        significantPairs++;
      }
    }
  }
  const corrDuration = Date.now() - corrStartTime;
  const totalDuration = Date.now() - startTime;
  
  console.log(`Results:`);
  console.log(`  Generation: ${genDuration}ms`);
  console.log(`  Correlation: ${corrDuration}ms`);
  console.log(`  Total: ${totalDuration}ms`);
  console.log(`  Pairs: ${pairsAnalyzed}`);
  console.log(`  Significant: ${significantPairs}`);
  
  return {
    numMarkets,
    historyLength,
    genDuration,
    corrDuration,
    totalDuration,
    pairsAnalyzed
  };
}

const scenarios = [
  [10, 60],
  [50, 60],
  [100, 60],
  [200, 60],
  [500, 60],
  [1000, 60],
];

console.log("=== Phase 3 Performance Benchmark ===");
const results = scenarios.map(s => benchmark(s[0], s[1]));

fs.writeFileSync('benchmark_results.json', JSON.stringify(results, null, 2));
console.log("\nBenchmark complete. Results saved to benchmark_results.json");
