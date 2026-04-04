#!/usr/bin/env node
/**
 * Market Data Pipeline — Fetch and Store Markets
 * Author: Bob (Backend Engineer)
 * Task: #219 — Kalshi data pipeline
 *
 * Fetches active markets from Kalshi and stores in database.
 * Run via cron: every 5 minutes
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

// Initialize fetcher and DB pool
const fetcher = createFetcher();
const pool = new Pool(dbConfig);

/**
 * Upsert a market into the database
 * @param {object} client - DB client
 * @param {object} market - Kalshi market data
 */
async function upsertMarket(client, market) {
  const query = `
    INSERT INTO markets (
      ticker, title, description, category, series_ticker, event_ticker,
      status, open_date, close_date, settlement_date,
      yes_sub_title, no_sub_title, rules_primary, rules_secondary,
      kalshi_market_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (ticker) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      series_ticker = EXCLUDED.series_ticker,
      event_ticker = EXCLUDED.event_ticker,
      status = EXCLUDED.status,
      open_date = EXCLUDED.open_date,
      close_date = EXCLUDED.close_date,
      settlement_date = EXCLUDED.settlement_date,
      yes_sub_title = EXCLUDED.yes_sub_title,
      no_sub_title = EXCLUDED.no_sub_title,
      rules_primary = EXCLUDED.rules_primary,
      rules_secondary = EXCLUDED.rules_secondary,
      kalshi_market_id = EXCLUDED.kalshi_market_id,
      updated_at = NOW()
    RETURNING id
  `;

  const values = [
    market.ticker,
    market.title,
    market.description || null,
    market.category || null,
    market.series_ticker || null,
    market.event_ticker || null,
    market.status || "active",
    market.open_date ? new Date(market.open_date) : null,
    market.close_date ? new Date(market.close_date) : null,
    market.settlement_date ? new Date(market.settlement_date) : null,
    market.yes_sub_title || null,
    market.no_sub_title || null,
    market.rules_primary || null,
    market.rules_secondary || null,
    market.id || null,
  ];

  const result = await client.query(query, values);
  return result.rows[0].id;
}

/**
 * Record market prices
 * @param {object} client - DB client
 * @param {string} marketId - Internal market UUID
 * @param {object} market - Kalshi market data with prices
 */
async function recordPrices(client, marketId, market) {
  const query = `
    INSERT INTO market_prices (
      market_id, yes_bid, yes_ask, no_bid, no_ask,
      volume, open_interest, last_trade_price, last_trade_size,
      kalshi_timestamp, source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `;

  const values = [
    marketId,
    market.yes_bid || null,
    market.yes_ask || null,
    market.no_bid || null,
    market.no_ask || null,
    market.volume || null,
    market.open_interest || null,
    market.last_trade_price || null,
    market.last_trade_size || null,
    market.last_updated_at ? new Date(market.last_updated_at) : null,
    "api",
  ];

  await client.query(query, values);
}

/**
 * Log job execution
 * @param {object} client - DB client
 * @param {string} status - Job status
 * @param {object} details - Job details
 */
async function logJob(client, status, details) {
  const query = `
    INSERT INTO data_collection_jobs (job_type, status, params, records_processed, records_inserted, records_updated, completed_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `;

  await client.query(query, [
    "markets",
    status,
    JSON.stringify(details.params || {}),
    details.recordsProcessed || 0,
    details.recordsInserted || 0,
    details.recordsUpdated || 0,
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

    console.log(`[${new Date().toISOString()}] Starting market fetch...`);

    // Fetch all active markets
    const markets = await fetcher.getMarkets({ useCache: false });
    console.log(`Fetched ${markets.length} markets from Kalshi`);

    let inserted = 0;
    let updated = 0;

    // Process each market
    for (const market of markets) {
      try {
        const marketId = await upsertMarket(client, market);

        // Check if this was an insert or update
        const checkResult = await client.query(
          "SELECT created_at, updated_at FROM markets WHERE id = $1",
          [marketId]
        );
        const row = checkResult.rows[0];

        // Simple heuristic: if created_at equals updated_at (within 1 second), it's new
        const isNew =
          Math.abs(new Date(row.created_at) - new Date(row.updated_at)) < 1000;
        if (isNew) {
          inserted++;
        } else {
          updated++;
        }

        // Record price snapshot
        await recordPrices(client, marketId, market);
      } catch (e) {
        console.error(`Error processing market ${market.ticker}:`, e.message);
        // Continue with other markets
      }
    }

    // Log job completion
    await logJob(client, "success", {
      params: { category: "all" },
      recordsProcessed: markets.length,
      recordsInserted: inserted,
      recordsUpdated: updated,
    });

    await client.query("COMMIT");

    const duration = Date.now() - startTime;
    console.log(
      `[${new Date().toISOString()}] Completed: ${markets.length} markets processed (${inserted} new, ${updated} updated) in ${duration}ms`
    );
  } catch (e) {
    await client.query("ROLLBACK");

    // Log failure
    await logJob(client, "failed", {
      params: { category: "all" },
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
