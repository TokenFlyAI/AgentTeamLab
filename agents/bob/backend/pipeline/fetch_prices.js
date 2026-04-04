#!/usr/bin/env node
/**
 * Price Data Pipeline — Fetch and Store Price Snapshots
 * Author: Bob (Backend Engineer)
 * Task: #219 — Kalshi data pipeline
 *
 * Fetches current prices for tracked markets.
 * Run via cron: every minute
 */

"use strict";

const { createFetcher } = require("../kalshi_data_fetcher");
const { Pool } = require("pg");

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "kalshi_trading",
  user: process.env.DB_USER || "trader",
  password: process.env.DB_PASSWORD,
};

const fetcher = createFetcher();
const pool = new Pool(dbConfig);

/**
 * Get list of active markets to track
 * @param {object} client - DB client
 */
async function getActiveMarkets(client) {
  const result = await client.query(
    `SELECT id, ticker FROM markets 
     WHERE status = 'active' 
     AND close_date > NOW()
     ORDER BY volume DESC NULLS LAST
     LIMIT 500`
  );
  return result.rows;
}

/**
 * Record price snapshot
 * @param {object} client - DB client
 * @param {string} marketId - Internal market UUID
 * @param {object} prices - Price data from Kalshi
 */
async function recordPriceSnapshot(client, marketId, prices) {
  const query = `
    INSERT INTO market_prices (
      market_id, yes_bid, yes_ask, no_bid, no_ask,
      volume, open_interest, last_trade_price, last_trade_size,
      kalshi_timestamp, source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `;

  const values = [
    marketId,
    prices.yes_bid || null,
    prices.yes_ask || null,
    prices.no_bid || null,
    prices.no_ask || null,
    prices.volume || null,
    prices.open_interest || null,
    prices.last_trade_price || null,
    prices.last_trade_size || null,
    prices.last_updated_at ? new Date(prices.last_updated_at) : null,
    "api",
  ];

  await client.query(query, values);
}

/**
 * Log job execution
 */
async function logJob(client, status, details) {
  const query = `
    INSERT INTO data_collection_jobs (job_type, status, params, records_processed, records_inserted, error_message, completed_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `;

  await client.query(query, [
    "prices",
    status,
    JSON.stringify(details.params || {}),
    details.recordsProcessed || 0,
    details.recordsInserted || 0,
    details.error || null,
  ]);
}

/**
 * Main pipeline execution
 */
async function runPipeline() {
  const startTime = Date.now();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log(`[${new Date().toISOString()}] Starting price fetch...`);

    // Get markets to track
    const markets = await getActiveMarkets(client);
    console.log(`Tracking ${markets.length} active markets`);

    let successCount = 0;
    let errorCount = 0;

    // Fetch prices in batches to avoid rate limits
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 100;

    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (market) => {
          try {
            const marketData = await fetcher.getMarket(market.ticker);
            if (marketData) {
              await recordPriceSnapshot(client, market.id, marketData);
              successCount++;
            }
          } catch (e) {
            console.error(
              `Error fetching price for ${market.ticker}:`,
              e.message
            );
            errorCount++;
          }
        })
      );

      // Small delay between batches
      if (i + BATCH_SIZE < markets.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    // Log job completion
    await logJob(client, errorCount === 0 ? "success" : "partial", {
      params: { marketCount: markets.length },
      recordsProcessed: markets.length,
      recordsInserted: successCount,
      error: errorCount > 0 ? `${errorCount} fetch errors` : null,
    });

    await client.query("COMMIT");

    const duration = Date.now() - startTime;
    console.log(
      `[${new Date().toISOString()}] Completed: ${successCount} prices recorded (${errorCount} errors) in ${duration}ms`
    );
  } catch (e) {
    await client.query("ROLLBACK");

    await logJob(client, "failed", {
      params: {},
      error: e.message,
    });

    console.error(`[${new Date().toISOString()}] Pipeline failed:`, e.message);
    throw e;
  } finally {
    client.release();
  }
}

// Run pipeline
runPipeline()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((e) => {
    console.error("Fatal error:", e);
    pool.end();
    process.exit(1);
  });
