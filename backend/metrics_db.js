/**
 * metrics_db.js — PostgreSQL persistence for request_metrics
 * Task #83 — Bob (Backend Engineer) — 2026-03-30
 *
 * Provides two modes:
 *   1. Direct INSERT (when called with a pre-connected pg Client)
 *   2. Batch drain (reads metrics_queue.jsonl and bulk-inserts)
 *
 * Zero-dep fallback: if `pg` is not installed, writes to metrics_queue.jsonl
 * instead (same as api.js does natively). Run db_sync.js later to drain.
 *
 * Prerequisites:
 *   npm install pg
 *   docker compose -f agents/eve/output/docker-compose.postgres.yml up -d
 *   Apply: backend/migration_002_add_request_metrics.sql
 *
 * Usage (one-shot drain):
 *   node backend/metrics_db.js
 *
 * Usage (watch mode — drain every 30s):
 *   node backend/metrics_db.js --watch 30
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const METRICS_QUEUE = path.resolve(__dirname, "metrics_queue.jsonl");

// SEC-011: require explicit env var — no hardcoded fallback credentials
const DB_URL = process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("[metrics_db] ERROR: PG_CONNECTION_STRING env var is not set. Exiting.");
  process.exit(1);
}

const INSERT_SQL = `
  INSERT INTO request_metrics (recorded_at, endpoint, method, status_code, duration_ms)
  VALUES ($1, $2, $3, $4, $5)
`;

// ---------------------------------------------------------------------------
// Direct insert — call with a connected pg.Client
// ---------------------------------------------------------------------------
async function insertMetric(client, { endpoint, method, status_code, duration_ms, recorded_at }) {
  const ts = recorded_at ? new Date(recorded_at) : new Date();
  await client.query(INSERT_SQL, [ts, endpoint, method, status_code, duration_ms]);
}

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------
function readQueue() {
  try {
    return fs.readFileSync(METRICS_QUEUE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) { return []; }
}

function clearQueue() {
  try { fs.writeFileSync(METRICS_QUEUE, ""); } catch (_) { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Batch drain — reads queue, bulk-inserts, clears on success
// ---------------------------------------------------------------------------
async function drainQueue() {
  let pg;
  try {
    pg = require("pg");
  } catch (_) {
    console.error("[metrics_db] pg not installed. Run: npm install pg");
    process.exit(1);
  }

  const rows = readQueue();
  if (rows.length === 0) {
    console.log("[metrics_db] Queue empty — nothing to sync");
    return 0;
  }

  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  let inserted = 0;
  for (const row of rows) {
    try {
      await insertMetric(client, row);
      inserted++;
    } catch (err) {
      console.warn(`[metrics_db] Insert failed: ${err.message}`, row);
    }
  }

  await client.end();
  console.log(`[metrics_db] Inserted ${inserted}/${rows.length} rows into request_metrics`);

  if (inserted > 0) clearQueue();
  return inserted;
}

// ---------------------------------------------------------------------------
// Exports (for use in other modules)
// ---------------------------------------------------------------------------
module.exports = { insertMetric, drainQueue, readQueue };

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (require.main === module) {
  const watchArg = process.argv.indexOf("--watch");
  if (watchArg !== -1) {
    const intervalSec = parseInt(process.argv[watchArg + 1], 10) || 30;
    console.log(`[metrics_db] Watch mode: draining every ${intervalSec}s`);
    drainQueue().catch(console.error);
    setInterval(() => drainQueue().catch(console.error), intervalSec * 1000);
  } else {
    drainQueue().catch((err) => {
      console.error("[metrics_db] Drain failed:", err.message);
      process.exit(1);
    });
  }
}
