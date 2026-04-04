#!/usr/bin/env node
/**
 * Position Sync Pipeline — Sync Kalshi Positions to Local DB
 * Author: Bob (Backend Engineer)
 * Task: #219 — Kalshi data pipeline
 *
 * Syncs positions from Kalshi API to local database.
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

const fetcher = createFetcher();
const pool = new Pool(dbConfig);

/**
 * Get market ID by ticker
 * @param {object} client - DB client
 * @param {string} ticker - Market ticker
 */
async function getMarketId(client, ticker) {
  const result = await client.query(
    "SELECT id FROM markets WHERE ticker = $1",
    [ticker]
  );
  return result.rows[0]?.id;
}

/**
 * Upsert position
 * @param {object} client - DB client
 * @param {string} marketId - Market UUID
 * @param {object} position - Kalshi position data
 */
async function upsertPosition(client, marketId, position) {
  const query = `
    INSERT INTO positions (
      market_id, side, contracts, avg_entry_price,
      current_price, unrealized_pnl, opening_order_id,
      status, opened_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (market_id, side, opening_order_id) WHERE opening_order_id IS NOT NULL
    DO UPDATE SET
      contracts = EXCLUDED.contracts,
      current_price = EXCLUDED.current_price,
      unrealized_pnl = EXCLUDED.unrealized_pnl,
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING id
  `;

  const values = [
    marketId,
    position.side?.toLowerCase(),
    position.count || 0,
    Math.round((position.avg_entry_price || 0) * 100), // Convert to cents
    position.last_price ? Math.round(position.last_price * 100) : null,
    position.unrealized_pnl ? Math.round(position.unrealized_pnl * 100) : null,
    position.order_id || null,
    position.count > 0 ? "open" : "closed",
    position.created_at ? new Date(position.created_at) : new Date(),
  ];

  const result = await client.query(query, values);
  return result.rows[0]?.id;
}

/**
 * Log job execution
 */
async function logJob(client, status, details) {
  const query = `
    INSERT INTO data_collection_jobs (job_type, status, params, records_processed, records_inserted, records_updated, error_message, completed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `;

  await client.query(query, [
    "positions",
    status,
    JSON.stringify(details.params || {}),
    details.recordsProcessed || 0,
    details.recordsInserted || 0,
    details.recordsUpdated || 0,
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

    console.log(`[${new Date().toISOString()}] Starting position sync...`);

    // Fetch positions from Kalshi
    const positions = await fetcher.getPositions();
    console.log(`Fetched ${positions.length} positions from Kalshi`);

    let successCount = 0;
    let errorCount = 0;
    let inserted = 0;
    let updated = 0;

    for (const position of positions) {
      try {
        const marketId = await getMarketId(client, position.market_id);

        if (!marketId) {
          console.warn(
            `Market not found for ticker: ${position.market_id}, skipping position`
          );
          continue;
        }

        const positionId = await upsertPosition(client, marketId, position);

        if (positionId) {
          // Determine if insert or update
          const checkResult = await client.query(
            "SELECT created_at, updated_at FROM positions WHERE id = $1",
            [positionId]
          );
          const row = checkResult.rows[0];
          const isNew =
            Math.abs(new Date(row.created_at) - new Date(row.updated_at)) <
            1000;

          if (isNew) inserted++;
          else updated++;

          successCount++;
        }
      } catch (e) {
        console.error(
          `Error processing position for ${position.market_id}:`,
          e.message
        );
        errorCount++;
      }
    }

    // Log job completion
    await logJob(
      client,
      errorCount === 0 ? "success" : "partial",
      {
        params: {},
        recordsProcessed: positions.length,
        recordsInserted: inserted,
        recordsUpdated: updated,
        error: errorCount > 0 ? `${errorCount} errors` : null,
      }
    );

    await client.query("COMMIT");

    const duration = Date.now() - startTime;
    console.log(
      `[${new Date().toISOString()}] Completed: ${successCount} positions synced (${inserted} new, ${updated} updated, ${errorCount} errors) in ${duration}ms`
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
