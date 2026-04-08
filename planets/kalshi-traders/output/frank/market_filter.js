#!/usr/bin/env node
/**
 * Market Filtering Engine — Sprint 4 Phase 1 (T579)
 * 
 * Filters Kalshi markets by:
 * 1. Volume (liquidity threshold)
 * 2. YES/NO ratio (target: 15-30% or 70-85% YES)
 * 
 * Output: output/filtered_markets.json
 * 
 * Author: Grace (Data Engineer)
 * Date: 2026-04-06
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeMarkets } = require(path.join(__dirname, "..", "bob", "backend", "lib", "live_market_normalizer"));

// Configuration
const CONFIG = {
  // Volume filter: minimum daily volume for liquidity
  minVolume: 10000,
  
  // YES/NO ratio targets (as percentages)
  targetRanges: [
    { min: 10, max: 40 },   // Low YES range (high NO confidence)
    { min: 60, max: 90 },   // High YES range (high YES confidence)
  ],
  
  // Excluded middle range (too efficient, no edge)
  excludedRange: { min: 40, max: 60 },
  
  // Preferred handoff paths for Sprint 4 dry-run pipeline
  inputPath: path.join(__dirname, "../../agents/grace/output/filtered_markets_live_fixture.json"),
  outputPath: path.join(__dirname, "filtered_markets.json"),
  task: "T579",
  phase: "Sprint 4 Phase 1",
  source: "market_filter_default",
};

// Expanded fallback markets for testing (when API unavailable)
// T530 Sprint: expanded from 8 to 20 markets across more categories
const FALLBACK_MARKETS = [
  // === Crypto ===
  {
    id: "m1",
    ticker: "BTCW-26-JUN30-80K",
    title: "Will Bitcoin exceed $80,000 by June 30, 2026?",
    category: "Crypto",
    yes_bid: 82, yes_ask: 86, no_bid: 14, no_ask: 18,
    volume: 720000, open_interest: 8000,
  },
  {
    id: "m2",
    ticker: "BTCW-26-JUN30-100K",
    title: "Will Bitcoin exceed $100,000 by June 30, 2026?",
    category: "Crypto",
    yes_bid: 62, yes_ask: 66, no_bid: 34, no_ask: 38,
    volume: 890000, open_interest: 12000,
  },
  {
    id: "m3",
    ticker: "ETHW-26-DEC31-5K",
    title: "Will Ethereum exceed $5,000 by December 31, 2026?",
    category: "Crypto",
    yes_bid: 28, yes_ask: 32, no_bid: 68, no_ask: 72,
    volume: 540000, open_interest: 6000,
  },
  {
    id: "m4",
    ticker: "BTCW-26-DEC31-120K",
    title: "Will Bitcoin exceed $120,000 by December 31, 2026?",
    category: "Crypto",
    yes_bid: 22, yes_ask: 26, no_bid: 74, no_ask: 78,
    volume: 410000, open_interest: 5500,
  },
  {
    id: "m5",
    ticker: "SOLW-26-JUN30-300",
    title: "Will Solana exceed $300 by June 30, 2026?",
    category: "Crypto",
    yes_bid: 18, yes_ask: 22, no_bid: 78, no_ask: 82,
    volume: 320000, open_interest: 4200,
  },
  {
    id: "m6",
    ticker: "ETHW-26-JUN30-4K",
    title: "Will Ethereum exceed $4,000 by June 30, 2026?",
    category: "Crypto",
    yes_bid: 72, yes_ask: 76, no_bid: 24, no_ask: 28,
    volume: 480000, open_interest: 7000,
  },
  // === Economics ===
  {
    id: "m7",
    ticker: "INXW-26-DEC31-6000",
    title: "S&P 500 to close above 6000 by Dec 31, 2026",
    category: "Economics",
    yes_bid: 73, yes_ask: 77, no_bid: 23, no_ask: 27,
    volume: 350000, open_interest: 15000,
  },
  {
    id: "m8",
    ticker: "INXW-26-DEC31-7000",
    title: "S&P 500 to close above 7000 by Dec 31, 2026",
    category: "Economics",
    yes_bid: 18, yes_ask: 22, no_bid: 78, no_ask: 82,
    volume: 280000, open_interest: 10000,
  },
  {
    id: "m9",
    ticker: "UNEMP-26-JUN",
    title: "Unemployment below 4% by June 2026",
    category: "Economics",
    yes_bid: 55, yes_ask: 57, no_bid: 43, no_ask: 45,
    volume: 90000, open_interest: 5000,
  },
  {
    id: "m10",
    ticker: "GDPW-26-Q2-3PCT",
    title: "US GDP growth above 3% in Q2 2026",
    category: "Economics",
    yes_bid: 25, yes_ask: 29, no_bid: 71, no_ask: 75,
    volume: 195000, open_interest: 8500,
  },
  {
    id: "m11",
    ticker: "CPIW-26-MAY-3PCT",
    title: "CPI year-over-year above 3% in May 2026",
    category: "Economics",
    yes_bid: 72, yes_ask: 78, no_bid: 22, no_ask: 28,
    volume: 230000, open_interest: 9200,
  },
  // === Financial / NFP ===
  {
    id: "m12",
    ticker: "KXNF-20260501-T100000",
    title: "NFP above 100k",
    category: "Financial",
    yes_bid: 65, yes_ask: 67, no_bid: 33, no_ask: 35,
    volume: 150000, open_interest: 50000,
  },
  {
    id: "m13",
    ticker: "KXNF-20260501-T150000",
    title: "NFP above 150k",
    category: "Financial",
    yes_bid: 50, yes_ask: 52, no_bid: 48, no_ask: 50,
    volume: 200000, open_interest: 75000,
  },
  {
    id: "m14",
    ticker: "KXNF-20260501-T200000",
    title: "NFP above 200k",
    category: "Financial",
    yes_bid: 26, yes_ask: 28, no_bid: 72, no_ask: 74,
    volume: 180000, open_interest: 60000,
  },
  {
    id: "m15",
    ticker: "KXNF-20260501-T250000",
    title: "NFP above 250k",
    category: "Financial",
    yes_bid: 14, yes_ask: 18, no_bid: 82, no_ask: 86,
    volume: 120000, open_interest: 40000,
  },
  // === Fed / Interest Rates ===
  {
    id: "m16",
    ticker: "FEDW-26-JUN-CUT",
    title: "Fed to cut rates at June 2026 meeting",
    category: "Rates",
    yes_bid: 27, yes_ask: 31, no_bid: 69, no_ask: 73,
    volume: 510000, open_interest: 22000,
  },
  {
    id: "m17",
    ticker: "FEDW-26-SEP-CUT",
    title: "Fed to cut rates at September 2026 meeting",
    category: "Rates",
    yes_bid: 44, yes_ask: 48, no_bid: 52, no_ask: 56,
    volume: 440000, open_interest: 18000,
  },
  // === Climate / Weather ===
  {
    id: "m18",
    ticker: "TEMPW-26-JUL-RECORD",
    title: "July 2026 hottest month on record globally",
    category: "Climate",
    yes_bid: 28, yes_ask: 32, no_bid: 68, no_ask: 72,
    volume: 85000, open_interest: 3500,
  },
  // === Geopolitical ===
  {
    id: "m19",
    ticker: "CHIPT-26-DEC31",
    title: "US-China chip export restrictions expanded by Dec 2026",
    category: "Geopolitical",
    yes_bid: 74, yes_ask: 78, no_bid: 22, no_ask: 26,
    volume: 175000, open_interest: 6000,
  },
  {
    id: "m20",
    ticker: "OILW-26-DEC31-100",
    title: "Oil above $100/barrel by December 31, 2026",
    category: "Commodities",
    yes_bid: 20, yes_ask: 24, no_bid: 76, no_ask: 80,
    volume: 290000, open_interest: 11000,
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

function loadMarketsFromFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (Array.isArray(raw)) {
    return raw;
  }

  if (Array.isArray(raw.markets)) {
    return raw.markets;
  }

  if (Array.isArray(raw.cases)) {
    return raw.cases.map((entry) => entry.input);
  }

  throw new Error(`Unsupported market fixture shape in ${filePath}`);
}

function normalizeInputMarkets(rawMarkets, options = {}) {
  const strict = options.strict !== false;
  return normalizeMarkets(rawMarkets, {
    strict,
    source: options.source || CONFIG.source,
  });
}

function buildOutput({
  inputPath,
  outputPath,
  task,
  phase,
  source,
  markets,
  volumeFiltered,
  ratioFiltered,
  normalizationErrors,
}) {
  const qualifying = ratioFiltered.filter((market) => !market.filtered);
  const excludedMiddle = ratioFiltered.filter((market) => market.filtered && market.filter_reason === "excluded_range");
  const extremeRatio = ratioFiltered.filter((market) => market.filtered && market.filter_reason === "extreme_ratio");

  return {
    generated_at: new Date().toISOString(),
    task,
    phase,
    source,
    config: {
      minVolume: CONFIG.minVolume,
      targetRanges: CONFIG.targetRanges,
      excludedRange: CONFIG.excludedRange,
      inputPath,
      outputPath,
    },
    summary: {
      total_markets: markets.length,
      after_volume_filter: volumeFiltered.length,
      qualifying_markets: qualifying.length,
      excluded_low_volume: markets.length - volumeFiltered.length,
      excluded_middle_range: excludedMiddle.length,
      extreme_ratio: extremeRatio.length,
      rejected_invalid_markets: normalizationErrors.length,
    },
    qualifying_markets: qualifying.map((market) => ({
      id: market.id,
      ticker: market.ticker,
      title: market.title,
      category: market.category,
      volume: market.volume,
      yes_bid: market.yes_bid,
      yes_ask: market.yes_ask,
      no_bid: market.no_bid,
      no_ask: market.no_ask,
      yes_ratio: parseFloat(market.yes_ratio.toFixed(2)),
      recommendation: market.recommendation,
    })),
    excluded_markets: [
      ...excludedMiddle.map((market) => ({
        ticker: market.ticker,
        title: market.title,
        reason: "middle_range_excluded",
        yes_ratio: parseFloat(market.yes_ratio.toFixed(2)),
      })),
      ...extremeRatio.map((market) => ({
        ticker: market.ticker,
        title: market.title,
        reason: "extreme_ratio",
        yes_ratio: parseFloat(market.yes_ratio.toFixed(2)),
      })),
    ],
    rejected_markets: normalizationErrors,
    next_phase: {
      recipient: "Ivan",
      task: "Clustering analysis on qualifying markets",
      markets_count: qualifying.length,
    },
  };
}

/**
 * Fetch markets from Kalshi API or use fallback
 * T579: Prefer Bob's mock_kalshi_markets.json handoff, then fall back to API/mock client
 */
async function fetchMarkets(inputPath = CONFIG.inputPath) {
  if (fs.existsSync(inputPath)) {
    const markets = loadMarketsFromFile(inputPath);
    if (Array.isArray(markets) && markets.length > 0) {
      console.log(`Loaded ${markets.length} markets from ${inputPath}`);
      return markets;
    }
  }

  try {
    // Try credential manager first (loads .env, validates creds)
    // Resolve paths relative to the actual file location (output/ is symlinked)
    const bobOutput = path.join(__dirname, "..", "bob");
    const { CredentialManager } = require(path.join(bobOutput, "credential_manager"));
    const creds = new CredentialManager();
    creds.validate();
    const client = creds.createClient();
    await client.login();

    const response = await client.getMarkets({ status: "open", limit: 200 });
    const markets = response.markets || [];

    if (markets.length > 0) {
      console.log(`Fetched ${markets.length} markets from Kalshi API via credential_manager`);
      return markets;
    }
  } catch (e1) {
    // Credential manager not available or no creds — try direct client in mock mode
    try {
      const { KalshiClient } = require(path.join(__dirname, "..", "bob", "kalshi_client"));
      const client = new KalshiClient({ mock: true });
      await client.login();

      const response = await client.getMarkets({ status: "open", limit: 200 });
      const markets = response.markets || [];

      if (markets.length > 0) {
        console.log(`Fetched ${markets.length} markets from Kalshi client (mock mode)`);
        return markets;
      }
    } catch (e2) {
      console.warn("Kalshi client unavailable:", e2.message);
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
  const options = arguments[0] || {};
  const inputPath = options.inputPath || CONFIG.inputPath;
  const outputPath = options.outputPath || CONFIG.outputPath;
  const task = options.task || CONFIG.task;
  const phase = options.phase || CONFIG.phase;
  const source = options.source || CONFIG.source;

  console.log(`=== Market Filtering Engine — ${task} ${phase} ===\n`);
  
  // Step 1: Fetch markets
  console.log("Step 1: Fetching markets...");
  const rawMarkets = await fetchMarkets(inputPath);
  console.log(`  Raw markets: ${rawMarkets.length}`);

  const { normalized, errors } = normalizeInputMarkets(rawMarkets, { source });
  console.log(`  Normalized valid markets: ${normalized.length}`);
  console.log(`  Rejected invalid markets: ${errors.length}\n`);
  
  // Step 2: Filter by volume
  console.log("Step 2: Filtering by volume...");
  console.log(`  Minimum volume: ${CONFIG.minVolume.toLocaleString()}`);
  const volumeFiltered = filterByVolume(normalized);
  console.log(`  After volume filter: ${volumeFiltered.length} markets`);
  console.log(`  Excluded: ${normalized.length - volumeFiltered.length} markets (low volume)\n`);
  
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
  const output = buildOutput({
    inputPath,
    outputPath,
    task,
    phase,
    source,
    markets: normalized,
    volumeFiltered,
    ratioFiltered,
    normalizationErrors: errors,
  });
  
  // Step 5: Write output
  console.log("Step 4: Writing output...");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`  Output written to: ${outputPath}\n`);
  
  // Print summary table
  console.log("=== QUALIFYING MARKETS ===");
  console.log("| Ticker | Category | Volume | YES Ratio | Recommendation |");
  console.log("|--------|----------|--------|-----------|----------------|");
  for (const m of qualifying) {
    console.log(`| ${m.ticker} | ${m.category} | ${m.volume.toLocaleString()} | ${m.yes_ratio.toFixed(1)}% | ${m.recommendation} |`);
  }
  
  console.log("\n=== SUMMARY ===");
  console.log(`Total markets analyzed: ${normalized.length}`);
  console.log(`Qualifying for clustering: ${qualifying.length}`);
  console.log("Next: Hand off to Ivan (T580) for clustering analysis");
  
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

module.exports = {
  buildOutput,
  calculateYesRatio,
  filterByVolume,
  filterByYesNoRatio,
  loadMarketsFromFile,
  normalizeInputMarkets,
  runFilter,
};
