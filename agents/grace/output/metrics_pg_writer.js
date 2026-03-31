/**
 * metrics_pg_writer.js — PostgreSQL persistence layer for request metrics
 *
 * Author: Grace (Data Engineer) — supporting Task #83
 * Date: 2026-03-30
 *
 * Usage (in agent_metrics_api.js or server.js):
 *
 *   const MetricsPgWriter = require('./agents/grace/output/metrics_pg_writer');
 *   const writer = new MetricsPgWriter();
 *   await writer.connect();
 *   // on each request:
 *   await writer.writeRequest('GET /api/tasks', 200, 12);
 *   // on agent cycle end:
 *   await writer.writeAgentCycle({ agentName: 'alice', cycleN: 5, startedAt, endedAt, turns: 3, costUsd: 0.012, durationS: 14.2 });
 *   // periodic rollup (every 5 min):
 *   await writer.flushSnapshot();
 *
 * Environment variables:
 *   PG_HOST     — default: localhost
 *   PG_PORT     — default: 5432
 *   PG_DATABASE — default: tokenfly
 *   PG_USER     — default: tokenfly
 *   PG_PASSWORD — required for password auth; omit for trust/peer auth
 *   METRICS_BUFFER_SIZE — rows to buffer before auto-flush (default: 100)
 *   METRICS_FLUSH_INTERVAL_MS — auto-flush interval ms (default: 10000)
 */

"use strict";

// ---------------------------------------------------------------------------
// Lazy-load pg to avoid hard dependency when Postgres is not configured.
// Bob should: npm install pg
// ---------------------------------------------------------------------------
let pg;
try {
  pg = require("pg");
} catch (_) {
  pg = null;
}

if (!process.env.PG_PASSWORD) {
  console.warn("[MetricsPgWriter] PG_PASSWORD not set — using trust/peer auth (MPW-001)");
}
const DEFAULT_PG = {
  host:     process.env.PG_HOST     || "localhost",
  port:     parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "tokenfly",
  user:     process.env.PG_USER     || "tokenfly",
  password: process.env.PG_PASSWORD, // undefined → pg uses trust/peer auth; no hardcoded fallback
};

const BUFFER_SIZE       = parseInt(process.env.METRICS_BUFFER_SIZE        || "100",   10);
const FLUSH_INTERVAL_MS = parseInt(process.env.METRICS_FLUSH_INTERVAL_MS  || "10000", 10);

class MetricsPgWriter {
  constructor(pgConfig = {}) {
    if (!pg) {
      console.warn("[MetricsPgWriter] 'pg' package not installed — metrics will not persist. Run: npm install pg");
      this._enabled = false;
      return;
    }
    this._enabled  = true;
    this._pool     = new pg.Pool({ ...DEFAULT_PG, ...pgConfig, max: 3 });
    this._buffer   = [];          // pending request rows
    this._flushing = false;
    this._timer    = null;
    this._pool.on("error", (err) => {
      console.error("[MetricsPgWriter] pool error:", err.message);
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Connect, run schema migration, start auto-flush timer. */
  async connect() {
    if (!this._enabled) return;
    await this._migrate();
    this._timer = setInterval(() => this._autoFlush(), FLUSH_INTERVAL_MS);
    this._timer.unref?.(); // don't block process exit
    console.log("[MetricsPgWriter] connected to PostgreSQL, auto-flush every", FLUSH_INTERVAL_MS, "ms");
  }

  /** Flush remaining buffer and close pool. Call on server shutdown. */
  async shutdown() {
    if (!this._enabled) return;
    if (this._timer) clearInterval(this._timer);
    await this._flush();
    await this._pool.end();
    console.log("[MetricsPgWriter] shutdown complete");
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /**
   * Buffer a completed HTTP request for batch insert.
   * Parses "METHOD /path" format from backend-api-module.js.
   *
   * @param {string} endpointKey   — e.g. "GET /api/tasks"
   * @param {number} statusCode    — HTTP status code
   * @param {number} durationMs    — response time
   */
  writeRequest(endpointKey, statusCode, durationMs) {
    if (!this._enabled) return;
    const spaceIdx = endpointKey.indexOf(" ");
    const method   = spaceIdx >= 0 ? endpointKey.slice(0, spaceIdx).toUpperCase() : "UNKNOWN";
    const endpoint = spaceIdx >= 0 ? endpointKey.slice(spaceIdx + 1) : endpointKey;

    this._buffer.push({
      ts:          new Date().toISOString(),
      endpoint,
      method,
      status_code: statusCode,
      duration_ms: durationMs,
    });

    if (this._buffer.length >= BUFFER_SIZE) {
      this._autoFlush();
    }
  }

  /**
   * Write a completed agent cycle.
   *
   * @param {{ agentName, cycleN, startedAt, endedAt, turns, costUsd, durationS }} cycle
   */
  async writeAgentCycle(cycle) {
    if (!this._enabled) return;
    const client = await this._pool.connect();
    try {
      await client.query(
        `INSERT INTO agent_cycles (agent_name, cycle_n, started_at, ended_at, turns, cost_usd, duration_s)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (agent_name, cycle_n) DO UPDATE
           SET ended_at = EXCLUDED.ended_at,
               turns    = EXCLUDED.turns,
               cost_usd = EXCLUDED.cost_usd,
               duration_s = EXCLUDED.duration_s`,
        [cycle.agentName, cycle.cycleN, cycle.startedAt, cycle.endedAt,
         cycle.turns, cycle.costUsd, cycle.durationS]
      );
    } catch (err) {
      console.error("[MetricsPgWriter] writeAgentCycle error:", err.message);
    } finally {
      client.release();
    }
  }

  /**
   * Write a heartbeat event.
   *
   * @param {string} agentName
   * @param {string} status     — running|idle|done
   * @param {string|null} taskTitle
   */
  async writeHeartbeat(agentName, status, taskTitle = null) {
    if (!this._enabled) return;
    const client = await this._pool.connect();
    try {
      await client.query(
        `INSERT INTO agent_heartbeats (agent_name, ts, status, task_title) VALUES ($1, now(), $2, $3)`,
        [agentName, status, taskTitle]
      );
    } catch (err) {
      console.error("[MetricsPgWriter] writeHeartbeat error:", err.message);
    } finally {
      client.release();
    }
  }

  /**
   * Compute and persist a snapshot aggregate over a recent window.
   * Call periodically (every 5 min) for trend analysis.
   *
   * @param {number} windowMinutes — how many minutes back to aggregate (default 5)
   */
  async flushSnapshot(windowMinutes = 5) {
    if (!this._enabled) return;
    // First flush pending raw rows so they are included
    await this._flush();

    const client = await this._pool.connect();
    try {
      await client.query(
        `INSERT INTO metrics_snapshots
            (window_start, window_end, endpoint, total_requests, total_errors,
             error_rate, avg_ms, p50_ms, p95_ms, p99_ms, max_ms, min_ms)
         SELECT
            now() - ($1 || ' minutes')::INTERVAL  AS window_start,
            now()                                  AS window_end,
            endpoint,
            COUNT(*)                               AS total_requests,
            SUM(CASE WHEN is_error THEN 1 ELSE 0 END) AS total_errors,
            ROUND(
              SUM(CASE WHEN is_error THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(*),0), 4
            )                                      AS error_rate,
            ROUND(AVG(duration_ms)::NUMERIC, 2)    AS avg_ms,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms,
            MAX(duration_ms)                       AS max_ms,
            MIN(duration_ms)                       AS min_ms
         FROM request_metrics
         WHERE ts > now() - ($1 || ' minutes')::INTERVAL
         GROUP BY endpoint
         ON CONFLICT (window_start, window_end, endpoint) DO NOTHING`,
        [windowMinutes]
      );
    } catch (err) {
      console.error("[MetricsPgWriter] flushSnapshot error:", err.message);
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  async _migrate() {
    const client = await this._pool.connect();
    try {
      // Create tables only if they don't exist (idempotent)
      await client.query(`
        CREATE TABLE IF NOT EXISTS request_metrics (
          id            BIGSERIAL PRIMARY KEY,
          ts            TIMESTAMPTZ  NOT NULL DEFAULT now(),
          endpoint      TEXT         NOT NULL,
          method        TEXT         NOT NULL,
          status_code   SMALLINT     NOT NULL,
          duration_ms   INTEGER      NOT NULL DEFAULT 0,
          is_error      BOOLEAN GENERATED ALWAYS AS (status_code >= 400) STORED
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rm_ts       ON request_metrics (ts DESC);
        CREATE INDEX IF NOT EXISTS idx_rm_endpoint ON request_metrics (endpoint, ts DESC);
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS metrics_snapshots (
          id              BIGSERIAL PRIMARY KEY,
          captured_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
          window_start    TIMESTAMPTZ  NOT NULL,
          window_end      TIMESTAMPTZ  NOT NULL,
          endpoint        TEXT         NOT NULL,
          total_requests  INTEGER      NOT NULL DEFAULT 0,
          total_errors    INTEGER      NOT NULL DEFAULT 0,
          error_rate      NUMERIC(6,4) NOT NULL DEFAULT 0,
          avg_ms          NUMERIC(8,2) NOT NULL DEFAULT 0,
          p50_ms          NUMERIC(8,2),
          p95_ms          NUMERIC(8,2),
          p99_ms          NUMERIC(8,2),
          max_ms          INTEGER      NOT NULL DEFAULT 0,
          min_ms          INTEGER      NOT NULL DEFAULT 0
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ms_window_ep
          ON metrics_snapshots (window_start, window_end, endpoint)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_cycles (
          id          BIGSERIAL PRIMARY KEY,
          agent_name  TEXT         NOT NULL,
          cycle_n     INTEGER      NOT NULL,
          started_at  TIMESTAMPTZ  NOT NULL,
          ended_at    TIMESTAMPTZ,
          turns       INTEGER,
          cost_usd    NUMERIC(10,6),
          duration_s  NUMERIC(8,2),
          CONSTRAINT uq_agent_cycle UNIQUE (agent_name, cycle_n)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_heartbeats (
          id          BIGSERIAL PRIMARY KEY,
          agent_name  TEXT         NOT NULL,
          ts          TIMESTAMPTZ  NOT NULL DEFAULT now(),
          status      TEXT         NOT NULL DEFAULT 'running',
          task_title  TEXT
        )
      `);
      console.log("[MetricsPgWriter] schema migration OK");
    } catch (err) {
      console.error("[MetricsPgWriter] migration error:", err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  async _autoFlush() {
    if (this._flushing || this._buffer.length === 0) return;
    await this._flush();
  }

  async _flush() {
    if (!this._enabled || this._buffer.length === 0) return;
    if (this._flushing) return;
    this._flushing = true;

    const rows = this._buffer.splice(0);  // drain buffer atomically

    const client = await this._pool.connect();
    try {
      // Bulk insert via unnest — single round-trip for up to BUFFER_SIZE rows
      const tss          = rows.map(r => r.ts);
      const endpoints    = rows.map(r => r.endpoint);
      const methods      = rows.map(r => r.method);
      const statusCodes  = rows.map(r => r.status_code);
      const durations    = rows.map(r => r.duration_ms);

      await client.query(
        `INSERT INTO request_metrics (ts, endpoint, method, status_code, duration_ms)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::smallint[], $5::integer[])`,
        [tss, endpoints, methods, statusCodes, durations]
      );
    } catch (err) {
      console.error("[MetricsPgWriter] flush error:", err.message, "— rows dropped:", rows.length);
    } finally {
      client.release();
      this._flushing = false;
    }
  }
}

module.exports = MetricsPgWriter;
