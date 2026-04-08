#!/usr/bin/env node
/**
 * Correlation Engine — Phase 3 Microservice (T1027)
 * Security hardened per T1038 (Heidi T1033 audit — 4 findings fixed)
 *
 * Extracts pearson_detector.js into a standalone HTTP service.
 * Input:  POST /correlate  { clusters: [...] }
 * Output: { schema_version: "v1", pairs: [...], signals: [...] }
 *
 * Security fixes (T1038):
 *   CRITICAL-1: requireInternalAuth on /correlate (Bearer INTERNAL_API_KEY)
 *   CRITICAL-2: safeResolvePath() allowlist prevents arbitrary file reads
 *   MEDIUM:     Body size cap (MAX_BODY_BYTES) prevents OOM
 *   LOW:        err.message stripped from 500 responses in production
 *
 * Schema versioning follows Mia T1008 patterns (X-Schema-Version header + body field).
 * CI/CD health endpoint follows Eve T1019 patterns (/health).
 *
 * Author: Bob (Backend Engineer)
 * Task:   T1027/T1038 — Sprint 10 Phase B microservice decomposition + security hardening
 * Date:   2026-04-07
 */

"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

const {
  processClusters,
  loadClusters,
  CONFIG,
} = require("../../correlation/pearson_detector");

const PORT = parseInt(process.env.CORRELATION_ENGINE_PORT || "3210", 10);
const SCHEMA_VERSION = "v1";
const SERVICE_NAME = "correlation-engine";
const START_TIME = Date.now();

// T1038 CRITICAL-1: Internal API key for service-to-service auth
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || null;

// T1038 MEDIUM: Body size cap — 1MB max to prevent OOM
const MAX_BODY_BYTES = parseInt(process.env.MAX_BODY_BYTES || String(1024 * 1024), 10);

// T1038 CRITICAL-2: Allowlisted base directories for body.path
const REPO_ROOT = path.resolve(__dirname, "../../../../../../");
const ALLOWED_DATA_DIRS = [
  path.join(REPO_ROOT, "public"),
  path.join(REPO_ROOT, "output"),
  path.join(REPO_ROOT, "data"),
  path.join(REPO_ROOT, "planets"),
].map(p => p + path.sep);

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/**
 * T1038 CRITICAL-1: requireInternalAuth
 * Validates Authorization: Bearer <INTERNAL_API_KEY> on /correlate endpoints.
 * Returns true if auth passes, sends 401/403 and returns false otherwise.
 */
function requireInternalAuth(req, res) {
  if (!INTERNAL_API_KEY) {
    // In development (no key configured): allow but warn
    if (process.env.NODE_ENV === "production") {
      send(res, errorResponse("INTERNAL_API_KEY not configured", 503));
      return false;
    }
    return true; // dev mode passthrough
  }

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    send(res, errorResponse("Missing Authorization header", 401));
    return false;
  }
  if (token !== INTERNAL_API_KEY) {
    send(res, errorResponse("Invalid internal API key", 403));
    return false;
  }
  return true;
}

/**
 * T1038 CRITICAL-2: safeResolvePath
 * Resolves a caller-supplied path and rejects anything outside ALLOWED_DATA_DIRS.
 * Returns { ok: true, resolved } or { ok: false, error }.
 */
function safeResolvePath(inputPath) {
  const resolved = path.resolve(inputPath);
  const allowed = ALLOWED_DATA_DIRS.some(base => resolved.startsWith(base));
  if (!allowed) {
    return {
      ok: false,
      error: `Path not in allowed directories. Allowed: public/, output/, data/, planets/`,
    };
  }
  return { ok: true, resolved };
}

// ---------------------------------------------------------------------------
// Response helpers (Mia T1008 schema versioning pattern)
// ---------------------------------------------------------------------------

function schemaResponse(data, status = 200) {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Schema-Version": SCHEMA_VERSION,
      "X-Service": SERVICE_NAME,
    },
    body: {
      schema_version: SCHEMA_VERSION,
      service: SERVICE_NAME,
      task_id: "T1027",
      agent: "bob",
      timestamp: new Date().toISOString(),
      ...data,
    },
  };
}

function errorResponse(message, status = 400) {
  return schemaResponse({ ok: false, error: message }, status);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /health — CI/CD liveness probe (Eve T1019 pattern). No auth required.
 */
function handleHealth(req, res) {
  const resp = schemaResponse({
    ok: true,
    status: "healthy",
    uptime_ms: Date.now() - START_TIME,
    config: {
      port: PORT,
      minCorrelation: CONFIG.minCorrelation,
      noiseFilterThreshold: CONFIG.noiseFilterThreshold,
      auth_required: !!INTERNAL_API_KEY,
    },
  });
  send(res, resp);
}

/**
 * POST /correlate — run Phase 3 correlation on provided clusters.
 * Requires internal auth (T1038 CRITICAL-1).
 *
 * Body: { clusters: <market_clusters.json format> }
 *   OR: { path: "/allowed/path/to/market_clusters.json" }
 */
function handleCorrelate(req, res, body) {
  try {
    let clusters;

    if (body.clusters) {
      // Inline cluster data — no path involved
      clusters = body.clusters;
    } else if (body.path) {
      // T1038 CRITICAL-2: validate path against allowlist before reading
      const { ok, resolved, error } = safeResolvePath(body.path);
      if (!ok) {
        return send(res, errorResponse(error, 403));
      }
      if (!fs.existsSync(resolved)) {
        return send(res, errorResponse(`File not found: ${body.path}`, 404));
      }
      clusters = loadClusters(resolved);
    } else {
      // Default: canonical public/market_clusters.json
      const defaultPath = path.resolve(
        __dirname,
        "../../../../../../public/market_clusters.json"
      );
      if (!fs.existsSync(defaultPath)) {
        return send(
          res,
          errorResponse("No clusters provided and public/market_clusters.json not found", 400)
        );
      }
      clusters = loadClusters(defaultPath);
    }

    const results = processClusters(clusters);

    const resp = schemaResponse({
      ok: true,
      total_pairs_analyzed: results.total_pairs_analyzed,
      arbitrage_opportunities: results.arbitrage_opportunities,
      pairs: results.pairs,
      config: results.config,
      generated_at: results.generated_at,
    });
    send(res, resp);
  } catch (err) {
    // T1038 LOW: don't leak err.message in production
    const detail = process.env.NODE_ENV !== "production" ? err.message : "Internal error";
    send(res, errorResponse(`Correlation failed: ${detail}`, 500));
  }
}

/**
 * GET /correlate — run with defaults. Requires internal auth.
 */
function handleCorrelateGet(req, res) {
  handleCorrelate(req, res, {});
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function send(res, { status, headers, body }) {
  res.writeHead(status, headers);
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;

    req.on("data", (chunk) => {
      bytes += chunk.length;
      // T1038 MEDIUM: body size cap — reject oversized payloads
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        return reject(new Error(`Request body too large (max ${MAX_BODY_BYTES} bytes)`));
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;
  const method = req.method.toUpperCase();

  try {
    // /health — no auth (liveness probe must be reachable by infra)
    if (pathname === "/health" && method === "GET") {
      return handleHealth(req, res);
    }

    // /correlate — requires internal auth (T1038 CRITICAL-1)
    if (pathname === "/correlate" && method === "GET") {
      if (!requireInternalAuth(req, res)) return;
      return handleCorrelateGet(req, res);
    }

    if (pathname === "/correlate" && method === "POST") {
      if (!requireInternalAuth(req, res)) return;
      const body = await readBody(req);
      return handleCorrelate(req, res, body);
    }

    send(res, errorResponse(`Not found: ${method} ${pathname}`, 404));
  } catch (err) {
    const detail = process.env.NODE_ENV !== "production" ? err.message : "Bad request";
    send(res, errorResponse(detail, 400));
  }
});

server.listen(PORT, () => {
  console.log(`[Correlation Engine] T1027/T1038 — Phase 3 microservice running on :${PORT}`);
  console.log(`  Health:    GET  http://localhost:${PORT}/health  (no auth)`);
  console.log(`  Correlate: GET  http://localhost:${PORT}/correlate  (auth required)`);
  console.log(`  Correlate: POST http://localhost:${PORT}/correlate  (auth required)`);
  console.log(`  Auth:      ${INTERNAL_API_KEY ? "INTERNAL_API_KEY set ✅" : "dev mode (no key)"}`);
  console.log(`  Schema:    ${SCHEMA_VERSION} | minCorrelation: ${CONFIG.minCorrelation}`);
});

module.exports = { server, PORT, safeResolvePath, requireInternalAuth };
