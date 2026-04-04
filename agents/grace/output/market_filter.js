#!/usr/bin/env node
/**
 * Market Filtering Engine — Sprint 8 Phase 1 (T343)
 * 
 * Filters Kalshi markets by:
 * 1. Volume (liquidity threshold)
 * 2. YES/NO ratio (target: 15-30% or 70-85% YES)
 * 
 * Output: agents/public/markets_filtered.json
 * 
 * Author: Grace (Data Engineer)
 * Date: 2026-04-03
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Configuration
const CONFIG = {
  // Volume filter: minimum daily volume for liquidity
  minVolume: 10000,
  
  // YES/NO ratio targets (as percentages)
  targetRanges: [
    { min: 15, max: 30 },   // Low YES range (high NO confidence)
    { min: 70, max: 85 },   // High YES range (high YES confidence)
  ],
  
  // Excluded middle range (too efficient, no edge)
  excludedRange: { min: 40, max: 60 },
  
  // Output file
  outputPath: path.join(__dirname, "../../public/markets_filtered.json"),
};

// Fallback markets for testing (when API unavailable)
const FALLBACK_MARKETS = [
  {
    id: "m1",
    ticker: "INXW-25-DEC31",
    title: "S&P 500 to close above 5000",
    category: "Economics",
    yes_bid: 85,
    yes_ask: 87,
    no_bid: 13,
    no_ask: 15,
    volume: 250000,
    open_interest: 12000,
  },
  {
    id: "m2",
    ticker: "BTCW-26-JUN30-80K",
    title: "Will Bitcoin exceed $80,000 by June 30, 2026?",
    category: "Crypto",
    yes_bid: 82,
    yes_ask: 86,
    no_bid: 14,
    no_ask: 18,
    volume: 720000,
    open_interest: 8000,
  },
  {
    id: "m3",
    ticker: "UNEMP-25-MAR",
    title: "Unemployment below 4%",
    category: "Economics",
    yes_bid: 55,
    yes_ask: 57,
    no_bid: 43,
    no_ask: 45,
    volume: 90000,
    open_interest: 5000,
  },
  {
    id: "m4",
    ticker: "BTCW-26-JUN30-100K",
    title: "Will Bitcoin exceed $100,000 by June 30, 2026?",
    category: "Crypto",
    yes_bid: 62,
    yes_ask: 66,
    no_bid: 34,
    no_ask: 38,
    volume: 890000,
    open_interest: 12000,
  },
  {
    id: "m5",
    ticker: "ETHW-26-DEC31-5K",
    title: "Will Ethereum exceed $5,000 by December 31, 2026?",
    category: "Crypto",
    yes_bid: 28,
    yes_ask: 32,
    no_bid: 68,
    no_ask: 72,
    volume: 540000,
    open_interest: 6000,
  },
  {
    id: "m6",
    ticker: "KXNF-20260501-T100000",
    title: "NFP above 100k",
    category: "Financial",
    yes_bid: 65,
    yes_ask: 67,
    no_bid: 33,
    no_ask: 35,
    volume: 150000,
    open_interest: 50000,
  },
  {
    id: "m7",
    ticker: "KXNF-20260501-T150000",
    title: "NFP above 150k",
    category: "Financial",
    yes_bid: 50,
    yes_ask: 52,
    no_bid: 48,
    no_ask: 50,
    volume: 200000,
    open_interest: 75000,
  },
  {
    id: "m8",
    ticker: "KXNF-20260501-T200000",
    title: "NFP above 200k",
    category: "Financial",
    yes_bid: 26,
    yes_ask: 28,
    no_bid: 72,
    no_ask: 74,
    volume: 180000,
    open_interest: 60000,
  },
];

/**
 * Compute mid price from bid/ask
 */
function computeMidPrice(bid, ask) {
  if (bid != null && ask != null) return Math.round((bid + ask) / 2);
  if (bid != null) return bid;
  if (ask != null) return ask;
  return 50;
}

/**
 * Calculate YES ratio (percentage)
 */
function calculateYesRatio(market) {
  const yesMid = computeMidPrice(market.yes_bid, market.yes_ask);
  const noMid = computeMidPrice(market.no_bid, market.no_ask);
  
  // YES ratio is the implied probability from YES price
  // In Kalshi, YES + NO prices should sum to ~100
  const total = yesMid + noMid;
  if (total === 0) return 50;
  
  return (yesMid / total) * 100;
}

/**
 * Check if YES ratio is in target range
 */
function isInTargetRange(yesRatio) {
  for (const range of CONFIG.targetRanges) {
    if (yesRatio >= range.min && yesRatio <= range.max) {
      return true;
    }
  }
  return false;
}

/**
 * Check if YES ratio is in excluded middle range
 */
function isInExcludedRange(yesRatio) {
  return yesRatio >= CONFIG.excludedRange.min && yesRatio <= CONFIG.excludedRange.max;
}

/**
 * Filter markets by volume
 */
function filterByVolume(markets) {
  return markets.filter(m => (m.volume || 0) >= CONFIG.minVolume);
}

/**
 * Filter markets by YES/NO ratio
 */
function filterByYesNoRatio(markets) {
  const results = [];
  
  for (const market of markets) {
    const yesRatio = calculateYesRatio(market);
    
    // Skip if in excluded middle range (40-60%)
    if (isInExcludedRange(yesRatio)) {
      results.push({
        ...market,
        yes_ratio: yesRatio,
        filtered: true,
        filter_reason: "excluded_range",
        recommendation: "skip",
      });
      continue;
    }
    
    // Include if in target range
    if (isInTargetRange(yesRatio)) {
      results.push({
        ...market,
        yes_ratio: yesRatio,
        filtered: false,
        filter_reason: null,
        recommendation: "proceed_to_clustering",
      });
    } else {
      // Extreme values (0-15% or 85-100%)
      results.push({
        ...market,
        yes_ratio: yesRatio,
        filtered: true,
        filter_reason: "extreme_ratio",
        recommendation: "review_manually",
      });
    }
  }
  
  return results;
}

/**
 * Fetch markets from Kalshi API or use fallback
 */
async function fetchMarkets() {
  // Try to use Kalshi client if API key available
  if (process.env.KALSHI_API_KEY) {
    try {
      const { KalshiClient } = require("../bob/backend/kalshi_client");
      const client = new KalshiClient({
        apiKey: process.env.KALSHI_API_KEY,
        demo: process.env.KALSHI_DEMO !== "false",
      });
      
      const response = await client.getMarkets({ status: "active", limit: 100 });
      const markets = response.data?.markets || [];
      
      if (markets.length > 0) {
        console.log(`Fetched ${markets.length} markets from Kalshi API`);
        return markets;
      }
    } catch (e) {
      console.warn("Failed to fetch from Kalshi API:", e.message);
    }
  }
  
  // Use fallback markets
  console.log("Using fallback markets (API unavailable)");
  return FALLBACK_MARKETS;
}

/**
 * Main filtering pipeline
 */
async function runFilter() {
  console.log("=== Market Filtering Engine — Sprint 8 Phase 1 (T343) ===\n");
  
  // Step 1: Fetch markets
  console.log("Step 1: Fetching markets...");
  const markets = await fetchMarkets();
  console.log(`  Total markets: ${markets.length}\n`);
  
  // Step 2: Filter by volume
  console.log("Step 2: Filtering by volume...");
  console.log(`  Minimum volume: ${CONFIG.minVolume.toLocaleString()}`);
  const volumeFiltered = filterByVolume(markets);
  console.log(`  After volume filter: ${volumeFiltered.length} markets`);
  console.log(`  Excluded: ${markets.length - volumeFiltered.length} markets (low volume)\n`);
  
  // Step 3: Filter by YES/NO ratio
  console.log("Step 3: Filtering by YES/NO ratio...");
  console.log(`  Target ranges: ${CONFIG.targetRanges.map(r => `${r.min}-${r.max}%`).join(" or ")}`);
  console.log(`  Excluded range: ${CONFIG.excludedRange.min}-${CONFIG.excludedRange.max}%`);
  const ratioFiltered = filterByYesNoRatio(volumeFiltered);
  
  // Categorize results
  const qualifying = ratioFiltered.filter(m => !m.filtered);
  const excludedMiddle = ratioFiltered.filter(m => m.filtered && m.filter_reason === "excluded_range");
  const extremeRatio = ratioFiltered.filter(m => m.filtered && m.filter_reason === "extreme_ratio");
  
  console.log(`  Qualifying markets: ${qualifying.length}`);
  console.log(`  Excluded (middle range): ${excludedMiddle.length}`);
  console.log(`  Extreme ratios (manual review): ${extremeRatio.length}\n`);
  
  // Step 4: Build output
  const output = {
    generated_at: new Date().toISOString(),
    task: "T343",
    phase: "Sprint 8 Phase 1",
    config: CONFIG,
    summary: {
      total_markets: markets.length,
      after_volume_filter: volumeFiltered.length,
      qualifying_markets: qualifying.length,
      excluded_low_volume: markets.length - volumeFiltered.length,
      excluded_middle_range: excludedMiddle.length,
      extreme_ratio: extremeRatio.length,
    },
    qualifying_markets: qualifying.map(m => ({
      id: m.id,
      ticker: m.ticker,
      title: m.title,
      category: m.category,
      volume: m.volume,
      yes_bid: m.yes_bid,
      yes_ask: m.yes_ask,
      no_bid: m.no_bid,
      no_ask: m.no_ask,
      yes_ratio: parseFloat(m.yes_ratio.toFixed(2)),
      recommendation: m.recommendation,
    })),
    excluded_markets: [
      ...excludedMiddle.map(m => ({
        ticker: m.ticker,
        reason: "middle_range_excluded",
        yes_ratio: parseFloat(m.yes_ratio.toFixed(2)),
      })),
      ...extremeRatio.map(m => ({
        ticker: m.ticker,
        reason: "extreme_ratio",
        yes_ratio: parseFloat(m.yes_ratio.toFixed(2)),
      })),
    ],
    next_phase: {
      recipient: "Ivan (T344)",
      task: "Clustering analysis on qualifying markets",
      markets_count: qualifying.length,
    },
  };
  
  // Step 5: Write output
  console.log("Step 4: Writing output...");
  fs.mkdirSync(path.dirname(CONFIG.outputPath), { recursive: true });
  fs.writeFileSync(CONFIG.outputPath, JSON.stringify(output, null, 2));
  console.log(`  Output written to: ${CONFIG.outputPath}\n`);
  
  // Print summary table
  console.log("=== QUALIFYING MARKETS ===");
  console.log("| Ticker | Category | Volume | YES Ratio | Recommendation |");
  console.log("|--------|----------|--------|-----------|----------------|");
  for (const m of qualifying) {
    console.log(`| ${m.ticker} | ${m.category} | ${m.volume.toLocaleString()} | ${m.yes_ratio.toFixed(1)}% | ${m.recommendation} |`);
  }
  
  console.log("\n=== SUMMARY ===");
  console.log(`Total markets analyzed: ${markets.length}`);
  console.log(`Qualifying for clustering: ${qualifying.length}`);
  console.log(`Next: Hand off to Ivan (T344) for clustering analysis`);
  
  return output;
}

// Run if called directly
if (require.main === module) {
  runFilter()
    .then(() => {
      console.log("\n✅ Market filtering complete");
      process.exit(0);
    })
    .catch((e) => {
      console.error("\n❌ Filter failed:", e);
      process.exit(1);
    });
}

module.exports = { runFilter, filterByVolume, filterByYesNoRatio, calculateYesRatio };
