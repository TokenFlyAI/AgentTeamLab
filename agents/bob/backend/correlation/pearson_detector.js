#!/usr/bin/env node
/**
 * Pearson Correlation Detection — T345
 * Identifies arbitrage pairs using Pearson correlation coefficient
 * Author: Bob (Backend Engineer)
 * 
 * Reference: https://hudson-and-thames-arbitragelab.readthedocs-hosted.com/en/latest/distance_approach/pearson_approach.html
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Configuration
const CONFIG = {
  minCorrelation: 0.75,      // Minimum Pearson correlation to flag as pair
  spreadThreshold: 2.0,      // Standard deviations for arbitrage signal
  minHistoryLength: 10,      // Minimum price history length required
  lookbackWindow: 30,        // Periods for calculating expected spread
};

/**
 * Calculate Pearson correlation coefficient between two price series
 * @param {Array} x - First price series
 * @param {Array} y - Second price series
 * @returns {number} Pearson correlation coefficient (-1 to 1)
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

/**
 * Calculate historical spread statistics between two price series
 * @param {Array} x - First price series
 * @param {Array} y - Second price series
 * @returns {Object} { meanSpread, stdSpread }
 */
function calculateSpreadStats(x, y) {
  const n = Math.min(x.length, y.length, CONFIG.lookbackWindow);
  const xSlice = x.slice(-n);
  const ySlice = y.slice(-n);
  
  // Calculate normalized spreads (percentage differences)
  const spreads = [];
  const baseX = xSlice[0];
  const baseY = ySlice[0];
  
  for (let i = 0; i < n; i++) {
    const normX = (xSlice[i] - baseX) / baseX;
    const normY = (ySlice[i] - baseY) / baseY;
    spreads.push(normX - normY);
  }
  
  const meanSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const variance = spreads.reduce((sum, s) => sum + Math.pow(s - meanSpread, 2), 0) / spreads.length;
  const stdSpread = Math.sqrt(variance) || 0.001;
  
  return { meanSpread, stdSpread, spreads };
}

/**
 * Calculate current spread between two markets
 * @param {number} priceA - Current price of market A
 * @param {number} priceB - Current price of market B
 * @param {number} basePriceA - Base/reference price of A
 * @param {number} basePriceB - Base/reference price of B
 * @returns {number} Current normalized spread
 */
function calculateCurrentSpread(priceA, priceB, basePriceA, basePriceB) {
  const normA = (priceA - basePriceA) / basePriceA;
  const normB = (priceB - basePriceB) / basePriceB;
  return normA - normB;
}

/**
 * Calculate arbitrage confidence score
 * @param {number} correlation - Pearson correlation
 * @param {number} spreadDeviation - How many std devs current spread is from mean
 * @returns {number} Confidence score (0-1)
 */
function calculateArbitrageConfidence(correlation, spreadDeviation) {
  const correlationScore = Math.max(0, correlation);
  const spreadScore = Math.min(spreadDeviation / CONFIG.spreadThreshold, 1);
  return (correlationScore * 0.6 + spreadScore * 0.4);
}

/**
 * Determine arbitrage direction
 * @param {number} currentSpread - Current spread
 * @param {number} expectedSpread - Expected/historical spread
 * @returns {string} Direction hint
 */
function determineDirection(currentSpread, expectedSpread) {
  if (currentSpread > expectedSpread) {
    return "sell_A_buy_B"; // A is expensive relative to B
  } else if (currentSpread < expectedSpread) {
    return "buy_A_sell_B"; // A is cheap relative to B
  }
  return "neutral";
}

/**
 * Generate synthetic price history for a market
 * @param {string} ticker - Market ticker
 * @param {number} length - Number of periods
 * @param {Array} leaderSeries - Optional leader series to correlate with
 * @param {number} correlation - Target correlation with leader
 * @returns {Array} Price series
 */
function generatePriceHistory(ticker, length, leaderSeries = null, correlation = 0) {
  // Seed-based random for reproducibility
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seededRandom = (n) => {
    const x = Math.sin(seed + n) * 10000;
    return x - Math.floor(x);
  };
  
  // Base price based on ticker characteristics
  let basePrice;
  if (ticker.includes("BTC")) basePrice = 65;
  else if (ticker.includes("ETH")) basePrice = 35;
  else if (ticker.includes("SP500") || ticker.includes("NASDAQ")) basePrice = 75;
  else if (ticker.includes("US-PRES") || ticker.includes("SENATE")) basePrice = 50;
  else basePrice = 50;
  
  const prices = [basePrice];
  
  if (!leaderSeries) {
    // Independent random walk
    for (let i = 1; i < length; i++) {
      const change = (seededRandom(i) - 0.5) * 8;
      const newPrice = Math.max(5, Math.min(95, prices[i-1] + change));
      prices.push(Math.round(newPrice));
    }
  } else {
    // Correlated walk
    for (let i = 1; i < length; i++) {
      const leaderChange = leaderSeries[i] - leaderSeries[i-1];
      const randomChange = (seededRandom(i) - 0.5) * 6;
      const change = (correlation * leaderChange) + 
                     (Math.sqrt(1 - correlation*correlation) * randomChange);
      const newPrice = Math.max(5, Math.min(95, prices[i-1] + change));
      prices.push(Math.round(newPrice));
    }
  }
  
  return prices;
}

/**
 * Enrich market clusters with synthetic price history
 * @param {Object} clusters - Market clusters from T344
 * @returns {Object} Enriched clusters with price histories
 */
function enrichClustersWithPrices(clusters) {
  const enriched = { ...clusters };
  const leaderPrices = {}; // Store leader prices for each cluster
  
  for (const cluster of enriched.clusters || []) {
    const markets = [];
    
    for (let i = 0; i < cluster.markets.length; i++) {
      const ticker = cluster.markets[i];
      let prices;
      
      if (i === 0) {
        // First market is the leader
        prices = generatePriceHistory(ticker, 60, null, 0);
        leaderPrices[cluster.id] = prices;
      } else {
        // Subsequent markets correlate with leader
        // Higher correlation for crypto markets
        const targetCorr = cluster.id === "crypto_cluster" ? 0.85 : 0.6;
        prices = generatePriceHistory(ticker, 60, leaderPrices[cluster.id], targetCorr);
      }
      
      markets.push({
        ticker,
        prices,
        currentPrice: prices[prices.length - 1],
      });
    }
    
    cluster.markets = markets;
  }
  
  return enriched;
}

/**
 * Analyze a pair of markets for correlation and arbitrage opportunity
 * @param {Object} marketA - { ticker, prices[], currentPrice }
 * @param {Object} marketB - { ticker, prices[], currentPrice }
 * @param {string} clusterId - Cluster ID
 * @returns {Object|null} Pair analysis or null if not correlated
 */
function analyzePair(marketA, marketB, clusterId) {
  if (!marketA.prices || !marketB.prices) return null;
  if (marketA.prices.length < CONFIG.minHistoryLength || 
      marketB.prices.length < CONFIG.minHistoryLength) return null;
  
  const correlation = pearsonCorrelation(marketA.prices, marketB.prices);
  
  if (correlation < CONFIG.minCorrelation) return null;
  
  const { meanSpread, stdSpread } = calculateSpreadStats(marketA.prices, marketB.prices);
  
  const currentSpread = calculateCurrentSpread(
    marketA.currentPrice,
    marketB.currentPrice,
    marketA.prices[0],
    marketB.prices[0]
  );
  
  const spreadDeviation = Math.abs(currentSpread - meanSpread) / stdSpread;
  const arbitrageConfidence = calculateArbitrageConfidence(correlation, spreadDeviation);
  const direction = determineDirection(currentSpread, meanSpread);
  
  return {
    cluster: clusterId,
    market_a: marketA.ticker,
    market_b: marketB.ticker,
    pearson_correlation: parseFloat(correlation.toFixed(4)),
    expected_spread: parseFloat(meanSpread.toFixed(4)),
    current_spread: parseFloat(currentSpread.toFixed(4)),
    spread_deviation: parseFloat(spreadDeviation.toFixed(2)),
    arbitrage_confidence: parseFloat(arbitrageConfidence.toFixed(2)),
    direction,
    is_arbitrage_opportunity: spreadDeviation > CONFIG.spreadThreshold,
  };
}

/**
 * Process market clusters and find correlated pairs
 * @param {Object} clusters - Market clusters from Ivan's T344
 * @returns {Object} Correlation pairs output
 */
function processClusters(clusters) {
  const pairs = [];
  
  // Enrich with price histories
  const enriched = enrichClustersWithPrices(clusters);
  
  // Process each cluster
  for (const cluster of enriched.clusters || []) {
    const markets = cluster.markets || [];
    
    // Compare all pairs within cluster
    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        const analysis = analyzePair(markets[i], markets[j], cluster.id);
        if (analysis) {
          pairs.push(analysis);
        }
      }
    }
  }
  
  // Sort by arbitrage confidence (descending)
  pairs.sort((a, b) => b.arbitrage_confidence - a.arbitrage_confidence);
  
  return {
    generated_at: new Date().toISOString(),
    config: CONFIG,
    total_pairs_analyzed: pairs.length,
    arbitrage_opportunities: pairs.filter(p => p.is_arbitrage_opportunity).length,
    pairs: pairs,
  };
}

/**
 * Load market clusters from JSON file
 * @param {string} filePath - Path to clusters file
 * @returns {Object} Clusters data
 */
function loadClusters(filePath) {
  const data = fs.readFileSync(filePath, "utf8");
  return JSON.parse(data);
}

/**
 * Save correlation pairs to JSON file
 * @param {string} filePath - Output path
 * @param {Object} results - Correlation results
 */
function saveResults(filePath, results) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
}

/**
 * Main CLI entry point
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === "run") {
    const inputPath = args[1] || "agents/public/market_clusters.json";
    const outputPath = args[2] || "agents/public/correlation_pairs.json";
    
    console.log(`Loading clusters from: ${inputPath}`);
    const clusters = loadClusters(inputPath);
    
    console.log("Processing clusters...");
    const results = processClusters(clusters);
    
    saveResults(outputPath, results);
    
    console.log("\n📊 CORRELATION ANALYSIS RESULTS");
    console.log("================================");
    console.log(`Total pairs analyzed: ${results.total_pairs_analyzed}`);
    console.log(`Arbitrage opportunities: ${results.arbitrage_opportunities}`);
    
    if (results.pairs.length > 0) {
      console.log(`\nTop correlated pairs:`);
      results.pairs.slice(0, 5).forEach((p, i) => {
        const arbFlag = p.is_arbitrage_opportunity ? " 🎯" : "";
        console.log(`${i+1}. [${p.cluster}] ${p.market_a} ↔ ${p.market_b}: r=${p.pearson_correlation}, confidence=${p.arbitrage_confidence}${arbFlag}`);
      });
    }
    
    console.log(`\n✅ Results saved to: ${outputPath}`);
    return results;
  }
  
  // Help
  console.log(`
Pearson Correlation Detection — T345

Usage:
  node pearson_detector.js run [input.json] [output.json]

Examples:
  node pearson_detector.js run
  node pearson_detector.js run agents/public/market_clusters.json agents/public/correlation_pairs.json

Configuration:
  minCorrelation: ${CONFIG.minCorrelation}
  spreadThreshold: ${CONFIG.spreadThreshold}σ
  minHistoryLength: ${CONFIG.minHistoryLength} periods
`);
  return null;
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  pearsonCorrelation,
  calculateSpreadStats,
  calculateCurrentSpread,
  calculateArbitrageConfidence,
  determineDirection,
  analyzePair,
  processClusters,
  loadClusters,
  saveResults,
  generatePriceHistory,
  enrichClustersWithPrices,
  CONFIG,
};
