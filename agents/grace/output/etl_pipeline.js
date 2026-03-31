#!/usr/bin/env node
/**
 * etl_pipeline.js — Grace's Data ETL Pipeline
 * Reads from live /api/* endpoints, writes to Pat's tokenfly PostgreSQL schema.
 *
 * Tables targeted (from Pat's tokenfly_core_schema.sql):
 *   - request_metrics (id, recorded_at, endpoint, method, status_code, duration_ms)
 *   - agents (id, name, role, department, current_status, last_heartbeat)
 *   - audit_log (actor_id, actor_type, action, entity_type, entity_id, details)
 *
 * Usage:
 *   node etl_pipeline.js                  # single run
 *   node etl_pipeline.js --watch 60       # run every 60s
 *   node etl_pipeline.js --dry-run        # print SQL, don't execute
 *
 * Env vars:
 *   API_BASE   default http://localhost:3199 (must be localhost — SSRF guard)
 *   API_KEY    optional — Bearer token for server auth (SEC-001)
 *   DB_URL     required — postgresql://user:pass@host:5432/dbname (no default, fail-fast)
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ─── config ──────────────────────────────────────────────────────────────────
const API_BASE_RAW = process.env.API_BASE || 'http://localhost:3199';
// ETL-002 (SSRF): validate API_BASE is localhost only
try {
  const _u = new URL(API_BASE_RAW);
  if (!['localhost', '127.0.0.1', '::1'].includes(_u.hostname)) {
    console.error(`ERROR: API_BASE must be localhost, got: ${_u.hostname} (SSRF risk — CWE-918)`);
    process.exit(1);
  }
} catch (e) {
  console.error(`ERROR: API_BASE is not a valid URL: ${API_BASE_RAW}`);
  process.exit(1);
}
const API_BASE = API_BASE_RAW;
const API_KEY  = process.env.API_KEY || '';
const DRY_RUN  = process.argv.includes('--dry-run');

if (!process.env.DB_URL && !DRY_RUN) {
  console.error('ERROR: DB_URL environment variable is required (CWE-259: no hardcoded credentials)');
  console.error('  Export DB_URL=postgresql://user:pass@host:5432/dbname before running.');
  process.exit(1);
}
const DB_URL = process.env.DB_URL || '';
const watchArg = process.argv.indexOf('--watch');
const WATCH_INTERVAL = watchArg >= 0 ? parseInt(process.argv[watchArg + 1], 10) * 1000 : 0;

// ─── HTTP helper (no deps) ────────────────────────────────────────────────────
const FETCH_TIMEOUT_MS = 10000;
const FETCH_MAX_BYTES  = 1024 * 1024; // 1 MB body limit (ETL-003)

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const client = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {},
    };
    const req = client.request(opts, (res) => {
      let body = '';
      let size = 0;
      res.on('data', d => {
        size += d.length;
        if (size > FETCH_MAX_BYTES) {
          req.destroy(new Error(`Response too large on ${path} (>${FETCH_MAX_BYTES} bytes)`));
          return;
        }
        body += d;
      });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error on ${path}: ${e.message}`)); }
      });
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms on ${path}`));
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── SQL emit / execute ───────────────────────────────────────────────────────
// In dry-run mode prints SQL; otherwise uses pg (must be installed: npm i pg)
let pgClient = null;
async function openDb() {
  if (DRY_RUN) return;
  const { Client } = require('pg');
  pgClient = new Client({ connectionString: DB_URL });
  await pgClient.connect();
}
async function closeDb() {
  if (pgClient) await pgClient.end();
}
async function runSql(sql, params) {
  if (DRY_RUN) {
    console.log('[DRY-RUN SQL]', sql.replace(/\s+/g, ' ').trim().slice(0, 120));
    return;
  }
  await pgClient.query(sql, params);
}

// ─── extract helpers ──────────────────────────────────────────────────────────
async function extractMetrics() {
  // /api/metrics returns { endpoints: [{endpoint, method, count, error_rate, avg_duration_ms, p95_duration_ms}] }
  const raw = await fetchJson('/api/metrics');
  return raw;
}

async function extractAgents() {
  const raw = await fetchJson('/api/agents');
  return Array.isArray(raw) ? raw : raw.agents || [];
}

async function extractCost() {
  const raw = await fetchJson('/api/cost');
  return raw;
}

// ─── transform + load: agents ────────────────────────────────────────────────
async function upsertAgents(agents) {
  const now = new Date().toISOString();
  let count = 0;
  for (const a of agents) {
    const sql = `
      INSERT INTO agents (name, role, department, current_status, last_heartbeat, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (name) DO UPDATE
        SET current_status  = EXCLUDED.current_status,
            last_heartbeat  = EXCLUDED.last_heartbeat
    `;
    const params = [
      a.name,
      a.role || 'agent',
      a.department || 'engineering',
      a.status || a.current_status || 'unknown',
      a.last_heartbeat || now,
      now,
    ];
    await runSql(sql, params);
    count++;
  }
  return count;
}

// ─── transform + load: metrics snapshot as audit_log entries ─────────────────
async function insertMetricsSnapshot(metrics) {
  // Write a summary snapshot into audit_log for historical trending
  const endpoints = metrics.endpoints || [];
  const details = {
    snapshot_ts: new Date().toISOString(),
    endpoint_count: endpoints.length,
    total_requests: endpoints.reduce((s, e) => s + (e.count || 0), 0),
    error_rate_avg: endpoints.length
      ? (endpoints.reduce((s, e) => s + (e.error_rate || 0), 0) / endpoints.length).toFixed(4)
      : 0,
    top_endpoints: endpoints
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 5)
      .map(e => ({ endpoint: e.endpoint, method: e.method, count: e.count, error_rate: e.error_rate })),
    p95_max: endpoints.reduce((m, e) => Math.max(m, e.p95_duration_ms || 0), 0),
  };

  const sql = `
    INSERT INTO audit_log (actor_id, actor_type, action, entity_type, entity_id, details, created_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
  `;
  const params = [
    0, 'system', 'metrics_snapshot', 'api_metrics', null,
    JSON.stringify(details),
    new Date().toISOString(),
  ];
  await runSql(sql, params);
  return details;
}

// ─── transform + load: request_metrics rows (synthetic from aggregates) ───────
async function insertRequestMetricsRows(metrics) {
  // The live /api/metrics gives us aggregates, not raw rows.
  // We insert one synthetic summary row per endpoint per snapshot.
  const endpoints = metrics.endpoints || [];
  const ts = new Date().toISOString();
  let count = 0;
  for (const ep of endpoints) {
    if (!ep.count) continue;
    const sql = `
      INSERT INTO request_metrics (ts, endpoint, method, status_code, duration_ms)
      VALUES ($1, $2, $3, $4, $5)
    `;
    // Use avg_duration as representative; status 200 for success, 0 = aggregate marker
    const params = [ts, ep.endpoint, ep.method || 'GET', 200, Math.round(ep.avg_duration_ms || 0)];
    await runSql(sql, params);
    count++;
  }
  return count;
}

// ─── transform + load: cost data into audit_log ──────────────────────────────
async function insertCostSnapshot(cost) {
  const sql = `
    INSERT INTO audit_log (actor_id, actor_type, action, entity_type, entity_id, details, created_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
  `;
  const params = [
    0, 'system', 'cost_snapshot', 'agent_costs', null,
    JSON.stringify({ snapshot_ts: new Date().toISOString(), cost }),
    new Date().toISOString(),
  ];
  await runSql(sql, params);
}

// ─── main ETL run ─────────────────────────────────────────────────────────────
async function runEtl() {
  const startTs = Date.now();
  console.log(`[${new Date().toISOString()}] ETL run starting (dry_run=${DRY_RUN})`);

  let metrics, agents, cost;
  const errors = [];

  try { metrics = await extractMetrics(); }
  catch (e) { errors.push(`metrics: ${e.message}`); metrics = {}; }

  try { agents = await extractAgents(); }
  catch (e) { errors.push(`agents: ${e.message}`); agents = []; }

  try { cost = await extractCost(); }
  catch (e) { errors.push(`cost: ${e.message}`); cost = {}; }

  const agentCount    = await upsertAgents(agents);
  const metricsSnap   = await insertMetricsSnapshot(metrics);
  const requestRows   = await insertRequestMetricsRows(metrics);
  await insertCostSnapshot(cost);

  const elapsed = Date.now() - startTs;
  const summary = {
    ts: new Date().toISOString(),
    elapsed_ms: elapsed,
    agents_upserted: agentCount,
    request_metric_rows: requestRows,
    metrics_snapshot: {
      total_requests: metricsSnap.total_requests,
      endpoint_count: metricsSnap.endpoint_count,
      error_rate_avg: metricsSnap.error_rate_avg,
    },
    errors,
  };

  console.log('[ETL COMPLETE]', JSON.stringify(summary, null, 2));
  return summary;
}

// ─── entry point ─────────────────────────────────────────────────────────────
(async () => {
  try {
    await openDb();
    await runEtl();

    if (WATCH_INTERVAL > 0) {
      console.log(`[watch] running every ${WATCH_INTERVAL / 1000}s — Ctrl-C to stop`);
      setInterval(runEtl, WATCH_INTERVAL);
    } else {
      await closeDb();
    }
  } catch (err) {
    console.error('[FATAL]', err.message);
    await closeDb().catch(() => {});
    process.exit(1);
  }
})();
