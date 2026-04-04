/**
 * Kalshi Data Fetcher — Market Data Pipeline
 * Author: Bob (Backend Engineer)
 * Task: #219 — Fetch live Kalshi market data and prices
 *
 * Provides:
 *   - Market data fetching with caching
 *   - Price tracking and history
 *   - Market filtering by category
 *   - Data export (JSON/CSV)
 *   - Scheduled data updates
 */

"use strict";

const fs = require("fs").promises;
const path = require("path");
const { KalshiClient } = require("./kalshi_client");

// ---------------------------------------------------------------------------
// Data Fetcher Class
// ---------------------------------------------------------------------------
class KalshiDataFetcher {
  /**
   * Create a new data fetcher
   * @param {object} opts
   * @param {KalshiClient} opts.client - Kalshi client instance
   * @param {string} opts.cacheDir - Directory for caching data
   * @param {number} opts.cacheTtlMs - Cache time-to-live in ms (default: 5 min)
   */
  constructor(opts = {}) {
    this.client = opts.client || new KalshiClient();
    this.cacheDir = opts.cacheDir || path.join(__dirname, "../data/kalshi");
    this.cacheTtlMs = opts.cacheTtlMs || 5 * 60 * 1000; // 5 minutes
    this.cache = new Map(); // In-memory cache
  }

  /**
   * Ensure cache directory exists
   */
  async init() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (e) {
      // Directory may already exist
    }
  }

  // -------------------------------------------------------------------------
  // Cache Helpers
  // -------------------------------------------------------------------------

  _getCacheKey(key) {
    return `kalshi:${key}`;
  }

  _getCached(key) {
    const cached = this.cache.get(this._getCacheKey(key));
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.cacheTtlMs) {
      this.cache.delete(this._getCacheKey(key));
      return null;
    }

    return cached.data;
  }

  _setCached(key, data) {
    this.cache.set(this._getCacheKey(key), {
      data,
      timestamp: Date.now(),
    });
  }

  _clearCache() {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------
  // Market Data Methods
  // -------------------------------------------------------------------------

  /**
   * Fetch all active markets with caching
   * @param {object} opts
   * @param {boolean} opts.useCache - Use cached data if available
   * @param {string} opts.category - Filter by category
   * @returns {Promise<object[]>}
   */
  async getMarkets(opts = {}) {
    const cacheKey = `markets:${opts.category || "all"}`;

    if (opts.useCache !== false) {
      const cached = this._getCached(cacheKey);
      if (cached) return cached;
    }

    const allMarkets = [];
    let cursor = null;

    do {
      const response = await this.client.getMarkets({
        status: "active",
        category: opts.category,
        limit: 100,
        cursor,
      });

      if (response.data?.markets) {
        allMarkets.push(...response.data.markets);
      }

      cursor = response.data?.cursor;
    } while (cursor);

    this._setCached(cacheKey, allMarkets);
    return allMarkets;
  }

  /**
   * Fetch a specific market with orderbook
   * @param {string} ticker - Market ticker
   * @param {boolean} opts.includeOrderbook - Include orderbook data
   * @returns {Promise<object>}
   */
  async getMarket(ticker, opts = {}) {
    const cacheKey = `market:${ticker}`;

    let market = this._getCached(cacheKey);

    if (!market) {
      const response = await this.client.getMarket(ticker);
      market = response.data?.market;
      if (market) {
        this._setCached(cacheKey, market);
      }
    }

    if (opts.includeOrderbook && market) {
      const orderbook = await this.getOrderbook(ticker);
      market.orderbook = orderbook;
    }

    return market;
  }

  /**
   * Fetch orderbook for a market
   * @param {string} ticker - Market ticker
   * @param {number} depth - Orderbook depth
   * @returns {Promise<object>}
   */
  async getOrderbook(ticker, depth = 10) {
    const response = await this.client.getOrderbook(ticker, depth);
    return response.data;
  }

  /**
   * Fetch price history (candles) for a market
   * @param {string} ticker - Market ticker
   * @param {object} opts
   * @param {string} opts.resolution - Candle resolution
   * @param {number} opts.days - Number of days of history
   * @returns {Promise<object[]>}
   */
  async getPriceHistory(ticker, opts = {}) {
    const days = opts.days || 7;
    const resolution = opts.resolution || "1d";

    const to = Date.now();
    const from = to - days * 24 * 60 * 60 * 1000;

    const response = await this.client.getCandles(ticker, {
      resolution,
      from,
      to,
    });

    return response.data?.candles || [];
  }

  /**
   * Get markets by category
   * @param {string} category - Category name
   * @returns {Promise<object[]>}
   */
  async getMarketsByCategory(category) {
    return this.getMarkets({ category });
  }

  /**
   * Get all available market categories
   * @returns {Promise<string[]>}
   */
  async getCategories() {
    const markets = await this.getMarkets({ useCache: true });
    const categories = new Set();

    for (const market of markets) {
      if (market.category) {
        categories.add(market.category);
      }
    }

    return Array.from(categories).sort();
  }

  // -------------------------------------------------------------------------
  // Account & Portfolio Methods
  // -------------------------------------------------------------------------

  /**
   * Fetch account balance
   * @returns {Promise<object>}
   */
  async getAccountBalance() {
    const response = await this.client.getBalance();
    return response.data;
  }

  /**
   * Fetch all positions
   * @returns {Promise<object[]>}
   */
  async getPositions() {
    const allPositions = [];
    let cursor = null;

    do {
      const response = await this.client.getPositions({
        limit: 100,
        cursor,
      });

      if (response.data?.positions) {
        allPositions.push(...response.data.positions);
      }

      cursor = response.data?.cursor;
    } while (cursor);

    return allPositions;
  }

  /**
   * Fetch portfolio statistics
   * @returns {Promise<object>}
   */
  async getPortfolio() {
    const response = await this.client.getPortfolio();
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Data Export Methods
  // -------------------------------------------------------------------------

  /**
   * Export markets data to JSON file
   * @param {string} filename - Output filename
   * @param {object} opts
   * @param {string} opts.category - Filter by category
   * @returns {Promise<string>} - Path to saved file
   */
  async exportMarketsToJson(filename, opts = {}) {
    await this.init();

    const markets = await this.getMarkets(opts);
    const outputPath = path.join(this.cacheDir, filename);

    await fs.writeFile(
      outputPath,
      JSON.stringify(markets, null, 2),
      "utf8"
    );

    return outputPath;
  }

  /**
   * Export markets data to CSV file
   * @param {string} filename - Output filename
   * @param {object} opts
   * @param {string} opts.category - Filter by category
   * @returns {Promise<string>} - Path to saved file
   */
  async exportMarketsToCsv(filename, opts = {}) {
    await this.init();

    const markets = await this.getMarkets(opts);
    const outputPath = path.join(this.cacheDir, filename);

    // CSV header
    const headers = [
      "ticker",
      "title",
      "category",
      "status",
      "yes_ask",
      "yes_bid",
      "no_ask",
      "no_bid",
      "volume",
      "open_interest",
      "expiration_date",
    ];

    // CSV rows
    const rows = markets.map((m) => [
      m.ticker,
      `"${(m.title || "").replace(/"/g, '""')}"`,
      m.category,
      m.status,
      m.yes_ask || "",
      m.yes_bid || "",
      m.no_ask || "",
      m.no_bid || "",
      m.volume || "",
      m.open_interest || "",
      m.close_date || "",
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    await fs.writeFile(outputPath, csv, "utf8");

    return outputPath;
  }

  // -------------------------------------------------------------------------
  // Analysis Methods
  // -------------------------------------------------------------------------

  /**
   * Get market statistics
   * @returns {Promise<object>}
   */
  async getMarketStats() {
    const markets = await this.getMarkets();

    const stats = {
      total: markets.length,
      byCategory: {},
      byStatus: {},
      avgVolume: 0,
      totalVolume: 0,
    };

    let volumeSum = 0;
    let volumeCount = 0;

    for (const market of markets) {
      // Count by category
      const cat = market.category || "unknown";
      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;

      // Count by status
      const status = market.status || "unknown";
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      // Volume stats
      if (market.volume) {
        volumeSum += market.volume;
        volumeCount++;
      }
    }

    stats.totalVolume = volumeSum;
    stats.avgVolume = volumeCount > 0 ? volumeSum / volumeCount : 0;

    return stats;
  }

  /**
   * Find markets by keyword in title
   * @param {string} keyword - Search keyword
   * @returns {Promise<object[]>}
   */
  async searchMarkets(keyword) {
    const markets = await this.getMarkets();
    const lowerKeyword = keyword.toLowerCase();

    return markets.filter((m) =>
      (m.title || "").toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Get high-volume markets (potential liquidity)
   * @param {number} minVolume - Minimum volume threshold
   * @returns {Promise<object[]>}
   */
  async getHighVolumeMarkets(minVolume = 100000) {
    const markets = await this.getMarkets();

    return markets
      .filter((m) => (m.volume || 0) >= minVolume)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0));
  }

  /**
   * Get markets closing soon
   * @param {number} days - Number of days to look ahead
   * @returns {Promise<object[]>}
   */
  async getMarketsClosingSoon(days = 7) {
    const markets = await this.getMarkets();
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return markets
      .filter((m) => {
        if (!m.close_date) return false;
        const closeDate = new Date(m.close_date);
        return closeDate <= cutoff && closeDate >= now;
      })
      .sort((a, b) => new Date(a.close_date) - new Date(b.close_date));
  }
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Create a new data fetcher from environment
 * @returns {KalshiDataFetcher}
 */
function createFetcher() {
  const client = new KalshiClient({
    apiKey: process.env.KALSHI_API_KEY,
    demo: process.env.KALSHI_DEMO !== "false",
  });

  return new KalshiDataFetcher({ client });
}

// ---------------------------------------------------------------------------
// CLI Interface
// ---------------------------------------------------------------------------

async function runCLI() {
  const command = process.argv[2];
  const fetcher = createFetcher();
  await fetcher.init();

  switch (command) {
    case "markets": {
      const category = process.argv[3];
      console.log(`Fetching markets${category ? ` (${category})` : ""}...`);
      const markets = await fetcher.getMarkets({ category });
      console.log(`Found ${markets.length} markets`);
      console.log("\nTop 10 by volume:");
      markets
        .sort((a, b) => (b.volume || 0) - (a.volume || 0))
        .slice(0, 10)
        .forEach((m, i) => {
          console.log(
            `${i + 1}. ${m.ticker}: ${m.title?.substring(0, 60)}... (Vol: ${m.volume || 0})`
          );
        });
      break;
    }

    case "categories": {
      console.log("Fetching categories...");
      const categories = await fetcher.getCategories();
      console.log(`Found ${categories.length} categories:`);
      categories.forEach((c) => console.log(`  - ${c}`));
      break;
    }

    case "market": {
      const ticker = process.argv[3];
      if (!ticker) {
        console.error("Usage: node kalshi_data_fetcher.js market <ticker>");
        process.exit(1);
      }
      console.log(`Fetching market ${ticker}...`);
      const market = await fetcher.getMarket(ticker, { includeOrderbook: true });
      console.log(JSON.stringify(market, null, 2));
      break;
    }

    case "stats": {
      console.log("Fetching market statistics...");
      const stats = await fetcher.getMarketStats();
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    case "export": {
      const format = process.argv[3] || "json";
      const category = process.argv[4];
      const filename = `markets_${category || "all"}_${Date.now()}.${format}`;

      console.log(`Exporting markets to ${filename}...`);

      const outputPath =
        format === "csv"
          ? await fetcher.exportMarketsToCsv(filename, { category })
          : await fetcher.exportMarketsToJson(filename, { category });

      console.log(`Saved to: ${outputPath}`);
      break;
    }

    default:
      console.log(`
Kalshi Data Fetcher CLI

Usage: node kalshi_data_fetcher.js <command> [args]

Commands:
  markets [category]     List all markets (optionally filtered by category)
  categories             List all market categories
  market <ticker>        Get details for a specific market
  stats                  Show market statistics
  export [json|csv] [category]  Export markets to file

Environment:
  KALSHI_API_KEY         Your Kalshi API key
  KALSHI_DEMO            Set to "false" for production (default: true)
`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  KalshiDataFetcher,
  createFetcher,
};

// ---------------------------------------------------------------------------
// Run CLI if called directly
// ---------------------------------------------------------------------------
if (require.main === module) {
  runCLI().catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
}
