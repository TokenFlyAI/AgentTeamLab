#!/usr/bin/env node
/**
 * Kalshi Alpha Dashboard API
 * Author: Bob (Backend Engineer)
 * Task: P0 — Kalshi Alpha Dashboard, T413 — Production Hardening
 *
 * Express API serving trade signals and system status to the dashboard frontend.
 * Port: 3200
 * 
 * Hardening Features (T413):
 * - Rate limiting per IP (100 req/min)
 * - Input validation on query parameters
 * - Standardized error responses
 * - CORS for known origins
 * - Request logging middleware
 */

"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3200;

// Paper trades DB (T323)
const { getPaperTradesDB } = require("./paper_trades_db");

// ============================================================================
// T413: Production Hardening Middleware
// ============================================================================

// 1. Request Logging Middleware
const requestLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip} - User-Agent: ${req.get('user-agent') || 'none'}`);
  next();
};
app.use(requestLogger);

// 2. Rate Limiting per IP (100 requests per minute)
const rateLimitStore = new Map();
const RATE_LIMIT = 100; // requests
const RATE_WINDOW = 60 * 1000; // 1 minute in ms

const rateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return next();
  }
  
  const record = rateLimitStore.get(ip);
  
  // Reset if window expired
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_WINDOW;
    return next();
  }
  
  // Check limit
  if (record.count >= RATE_LIMIT) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      }
    });
  }
  
  record.count++;
  next();
};
app.use(rateLimiter);

// 3. CORS Configuration for Known Origins
const ALLOWED_ORIGINS = [
  'http://localhost:3200',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3200',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

if (process.env.ALLOWED_ORIGINS) {
  ALLOWED_ORIGINS.push(...process.env.ALLOWED_ORIGINS.split(','));
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// 4. Standardized Error Response Handler
const sendError = (res, statusCode, code, message, details = null) => {
  const errorResponse = {
    success: false,
    error: {
      code,
      message,
      timestamp: new Date().toISOString(),
    }
  };
  if (details) {
    errorResponse.error.details = details;
  }
  return res.status(statusCode).json(errorResponse);
};

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.message === 'Not allowed by CORS') {
    return sendError(res, 403, 'CORS_ERROR', 'Origin not allowed');
  }
  sendError(res, 500, 'INTERNAL_ERROR', 'An internal error occurred');
});

// ============================================================================
// Auth Middleware
// ============================================================================

const API_KEY = process.env.DASHBOARD_API_KEY;
function requireAuth(req, res, next) {
  if (!API_KEY) return next(); // no key configured = open (dev mode)
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or missing API key');
  }
  next();
}

// ============================================================================
// Input Validation Helpers
// ============================================================================

const validators = {
  // Validate string parameter
  string: (value, field, options = {}) => {
    if (value === undefined || value === null) {
      if (options.required) {
        return { valid: false, error: `${field} is required` };
      }
      return { valid: true, value: null };
    }
    const str = String(value).trim();
    if (options.maxLength && str.length > options.maxLength) {
      return { valid: false, error: `${field} exceeds maximum length of ${options.maxLength}` };
    }
    if (options.pattern && !options.pattern.test(str)) {
      return { valid: false, error: `${field} format is invalid` };
    }
    if (options.enum && !options.enum.includes(str)) {
      return { valid: false, error: `${field} must be one of: ${options.enum.join(', ')}` };
    }
    return { valid: true, value: str };
  },

  // Validate integer parameter
  integer: (value, field, options = {}) => {
    if (value === undefined || value === null) {
      if (options.required) {
        return { valid: false, error: `${field} is required` };
      }
      return { valid: true, value: null };
    }
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      return { valid: false, error: `${field} must be a valid integer` };
    }
    if (options.min !== undefined && num < options.min) {
      return { valid: false, error: `${field} must be at least ${options.min}` };
    }
    if (options.max !== undefined && num > options.max) {
      return { valid: false, error: `${field} must be at most ${options.max}` };
    }
    return { valid: true, value: num };
  },

  // Validate date parameter (ISO 8601)
  date: (value, field, options = {}) => {
    if (value === undefined || value === null) {
      if (options.required) {
        return { valid: false, error: `${field} is required` };
      }
      return { valid: true, value: null };
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return { valid: false, error: `${field} must be a valid ISO 8601 date` };
    }
    return { valid: true, value: date.toISOString() };
  },
};

// Validation middleware factory
const validateQuery = (schema) => {
  return (req, res, next) => {
    const errors = [];
    const validated = {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.query[field];
      let result;

      switch (rules.type) {
        case 'string':
          result = validators.string(value, field, rules);
          break;
        case 'integer':
          result = validators.integer(value, field, rules);
          break;
        case 'date':
          result = validators.date(value, field, rules);
          break;
        default:
          result = { valid: true, value };
      }

      if (!result.valid) {
        errors.push(result.error);
      } else {
        validated[field] = result.value;
      }
    }

    if (errors.length > 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', errors);
    }

    req.validatedQuery = validated;
    next();
  };
};

// ============================================================================
// Paths
// ============================================================================

const TRADE_SIGNALS_PATH = path.join(__dirname, "..", "output", "trade_signals.json");
const EDGES_PATH = path.join(__dirname, "../../grace/output", "econ_edges_today.json");
const PAPER_LOG_PATH = path.join(__dirname, "../../grace/output", "paper_trade_log.json");
const LIVE_RUNNER_PATH = path.join(__dirname, "strategies", "live_runner.js");

// ============================================================================
// Helper Functions
// ============================================================================

function readTradeSignals() {
  try {
    const data = fs.readFileSync(TRADE_SIGNALS_PATH, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return {
      generatedAt: new Date().toISOString(),
      source: "none",
      marketCount: 0,
      signalCount: 0,
      executed: false,
      markets: [],
      signals: [],
      executionReport: null,
      error: e.message,
    };
  }
}

function getSystemStatus() {
  const signals = readTradeSignals();
  const signalsAge = signals.generatedAt
    ? Date.now() - new Date(signals.generatedAt).getTime()
    : null;
  const signalsStale = signalsAge ? signalsAge > 5 * 60 * 1000 : true; // 5 min

  return {
    api: "online",
    timestamp: new Date().toISOString(),
    tradeSignals: {
      lastUpdate: signals.generatedAt,
      signalCount: signals.signalCount || 0,
      stale: signalsStale,
      ageMinutes: signalsAge ? Math.round(signalsAge / 60000) : null,
    },
    liveRunner: {
      exists: fs.existsSync(LIVE_RUNNER_PATH),
      path: LIVE_RUNNER_PATH,
    },
  };
}

// ============================================================================
// API Endpoints
// ============================================================================

/**
 * GET /api/signals
 * Returns all trade signals from the latest run
 */
app.get("/api/signals", (req, res) => {
  const signals = readTradeSignals();
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    signals: signals.signals || [],
    markets: signals.markets || [],
    generatedAt: signals.generatedAt,
    executed: signals.executed,
    data: signals,
  });
});

/**
 * GET /api/signals/latest
 * Returns only the most recent signal
 */
app.get("/api/signals/latest", (req, res) => {
  const signals = readTradeSignals();
  const latest = signals.signals && signals.signals.length > 0
    ? signals.signals[0]
    : null;
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: latest,
  });
});

/**
 * GET /api/markets
 * Returns all markets analyzed
 */
app.get("/api/markets", (req, res) => {
  const signals = readTradeSignals();
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    count: signals.markets ? signals.markets.length : 0,
    data: signals.markets || [],
  });
});

/**
 * GET /api/edges
 * Returns top 10 market edges from econ_edges_today.json
 */
app.get("/api/edges", (req, res) => {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(EDGES_PATH, "utf8")); } catch (_) {}
  const ops = raw.opportunities || raw.edges || (Array.isArray(raw) ? raw : []);
  const top10 = ops
    .map(o => ({
      ticker: o.ticker,
      title: o.title,
      model_probability: o.model_probability,
      market_price: o.kalshi_yes_price || o.market_price,
      edge_pct: o.edge_pct != null ? o.edge_pct
        : (o.model_probability != null && o.kalshi_yes_price != null
          ? Math.round((o.model_probability * 100 - o.kalshi_yes_price) * 10) / 10
          : null),
      recommendation: o.recommendation || (
        o.model_probability != null && o.kalshi_yes_price != null
          ? (o.model_probability * 100 > o.kalshi_yes_price ? "BUY_YES" : "BUY_NO")
          : "HOLD"),
    }))
    .sort((a, b) => Math.abs(b.edge_pct || 0) - Math.abs(a.edge_pct || 0))
    .slice(0, 10);
  res.json({ success: true, edges: top10, generated_at: raw.generated_at, count: top10.length });
});

/**
 * GET /api/pnl/live
 * Returns live P&L from paper_trades.db with last 10 trades (T327)
 */
app.get("/api/pnl/live", (req, res) => {
  try {
    const db = getPaperTradesDB();
    const summary = db.getSummary();
    const allTrades = db.getTrades();
    
    // Get last 10 trades (most recent first)
    const last10 = allTrades.slice(0, 10).map(t => ({
      id: t.id,
      timestamp: t.timestamp,
      market: t.market,
      signal_type: t.signal_type,
      confidence: t.confidence,
      direction: t.direction,
      contracts: t.contracts,
      entry_price: t.entry_price,
      status: t.status,
      pnl: t.pnl,
      outcome: t.outcome,
    }));
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      win_rate: summary.win_rate,
      total_pnl: summary.total_pnl_dollars,
      trade_count: summary.total_trades,
      closed_trades: summary.closed_trades,
      open_trades: summary.open_trades,
      wins: summary.win_count,
      losses: summary.loss_count,
      last_10_trades: last10,
      by_strategy: summary.by_strategy,
      last_updated: summary.last_updated,
    });
  } catch (e) {
    sendError(res, 500, 'DATABASE_ERROR', 'Failed to retrieve P&L data', e.message);
  }
});

/**
 * GET /api/pnl
 * Returns P&L summary from paper trade logs
 */
app.get("/api/pnl", (req, res) => {
  let paperLog = { trades: [] };
  try { paperLog = JSON.parse(fs.readFileSync(PAPER_LOG_PATH, "utf8")); } catch (_) {}
  const trades = paperLog.trades || [];

  let totalPnl = 0, wins = 0, losses = 0, best = null, worst = null;
  for (const t of trades) {
    const pnl = t.pnl || t.realized_pnl || 0;
    totalPnl += pnl;
    if (pnl > 0) wins++;
    if (pnl < 0) losses++;
    if (best === null || pnl > best.pnl) best = { ...t, pnl };
    if (worst === null || pnl < worst.pnl) worst = { ...t, pnl };
  }

  // 7-day daily from signal run files
  const daily = ["run_1.json", "run_2.json", "run_3.json"].map((f, i) => {
    let run = { signals: [] };
    try { run = JSON.parse(fs.readFileSync(path.join(__dirname, "../output", f), "utf8")); } catch (_) {}
    return {
      day: `Day ${i + 1}`,
      signals: (run.signals || []).length,
      pnl: (run.signals || []).reduce((s, sig) => s + (sig.expectedValue || 0), 0),
    };
  });

  const winRate = trades.length ? Math.round(wins / trades.length * 100) : 0;
  res.json({
    success: true,
    total_pnl: totalPnl,
    totalPnl: totalPnl,
    win_rate: winRate,
    winRate: winRate / 100,
    total_trades: trades.length,
    totalTrades: trades.length,
    wins, losses,
    best_trade: best,
    bestTrade: best ? best.pnl : null,
    worst_trade: worst,
    worstTrade: worst ? worst.pnl : null,
    daily_pnl: daily,
  });
});

/**
 * GET /api/paper-trades/summary
 * Returns paper trading P&L summary (T323)
 */
app.get("/api/paper-trades/summary", (req, res) => {
  try {
    const db = getPaperTradesDB();
    const summary = db.getSummary();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      win_rate: summary.win_rate,
      total_pnl: summary.total_pnl_dollars,
      trade_count: summary.total_trades,
      closed_trades: summary.closed_trades,
      open_trades: summary.open_trades,
      wins: summary.win_count,
      losses: summary.loss_count,
      last_updated: summary.last_updated,
      by_strategy: summary.by_strategy,
    });
  } catch (e) {
    sendError(res, 500, 'DATABASE_ERROR', 'Failed to retrieve paper trades summary', e.message);
  }
});

/**
 * GET /api/paper-trades
 * Returns all paper trades with optional filtering
 * Query params: market, strategy, status, outcome, since
 */
app.get("/api/paper-trades",
  validateQuery({
    market: { type: 'string', maxLength: 50 },
    strategy: { type: 'string', maxLength: 50 },
    status: { type: 'string', enum: ['OPEN', 'CLOSED', 'PENDING'] },
    outcome: { type: 'string', enum: ['WIN', 'LOSS', 'PENDING'] },
    since: { type: 'date' },
  }),
  (req, res) => {
    try {
      const db = getPaperTradesDB();
      const filters = {
        market: req.validatedQuery.market,
        signal_type: req.validatedQuery.strategy,
        status: req.validatedQuery.status,
        outcome: req.validatedQuery.outcome,
        since: req.validatedQuery.since,
      };
      // Remove null filters
      Object.keys(filters).forEach(key => filters[key] === null && delete filters[key]);
      
      const trades = db.getTrades(filters);
      const summary = db.getSummary();
      
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        count: trades.length,
        summary: {
          win_rate: summary.win_rate,
          total_pnl: summary.total_pnl_dollars,
          trade_count: summary.total_trades,
        },
        trades: trades,
      });
    } catch (e) {
      sendError(res, 500, 'DATABASE_ERROR', 'Failed to retrieve paper trades', e.message);
    }
  }
);

/**
 * GET /api/win-rate-trend
 * Returns win rate trend over trade batches / runs (T327)
 */
app.get("/api/win-rate-trend", (req, res) => {
  try {
    const db = getPaperTradesDB();
    const trades = db.getTrades({ status: "CLOSED" });

    // Group closed trades by run number (fallback to batch index)
    const byRun = {};
    for (const t of trades) {
      const run = t.metadata?.runNumber || 1;
      if (!byRun[run]) {
        byRun[run] = { run, trades: 0, wins: 0, losses: 0, pnl: 0 };
      }
      byRun[run].trades++;
      if (t.outcome === "WIN") byRun[run].wins++;
      if (t.outcome === "LOSS") byRun[run].losses++;
      byRun[run].pnl += t.pnl || 0;
    }

    const runs = Object.values(byRun).sort((a, b) => a.run - b.run);

    let cumulativeWins = 0;
    let cumulativeTrades = 0;
    const trend = runs.map((r) => {
      cumulativeWins += r.wins;
      cumulativeTrades += r.trades;
      return {
        run: r.run,
        trades: r.trades,
        wins: r.wins,
        losses: r.losses,
        batchWinRate: r.trades > 0 ? parseFloat((r.wins / r.trades).toFixed(4)) : 0,
        cumulativeWinRate: cumulativeTrades > 0 ? parseFloat((cumulativeWins / cumulativeTrades).toFixed(4)) : 0,
        pnlCents: r.pnl,
      };
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      backtestBaseline: 0.559,
      totalClosedTrades: trades.length,
      trend: trend,
    });
  } catch (e) {
    sendError(res, 500, 'DATABASE_ERROR', 'Failed to retrieve win rate trend', e.message);
  }
});

/**
 * GET /api/health
 * Returns strategy health per strategy
 */
app.get("/api/health", (req, res) => {
  const signals = readTradeSignals();
  const generatedAt = signals.generatedAt ? new Date(signals.generatedAt) : null;
  const ageMins = generatedAt ? Math.round((Date.now() - generatedAt) / 60000) : null;
  const sigs = signals.signals || [];
  const strategies = ["mean_reversion", "momentum", "crypto_edge", "nfp_nowcast", "econ_edge"];

  const health = strategies.map(name => {
    const stratSigs = sigs.filter(s => s.strategy === name || s.strategyId === name);
    let status = "NO_DATA";
    if (signals.generatedAt) {
      if (ageMins < 30) status = "OK";
      else if (ageMins < 60) status = "WARN";
      else status = "STALE";
      if (!stratSigs.length) status = "NO_DATA";
    }
    return { name: name, lastRun: signals.generatedAt, age_minutes: ageMins, signalCount: stratSigs.length, status };
  });

  res.json({ success: true, strategies: health, pipeline_age_minutes: ageMins, last_run: signals.generatedAt });
});

/**
 * POST /api/run-pipeline
 * Triggers live_runner.js and waits for completion
 */
app.post("/api/run-pipeline", requireAuth, (req, res) => {
  const { execFile } = require("child_process");
  const start = Date.now();
  execFile("node", [LIVE_RUNNER_PATH], { timeout: 120000 }, (err, stdout, stderr) => {
    const elapsed = Date.now() - start;
    if (err) {
      return sendError(res, 500, 'RUNNER_ERROR', 'Live runner execution failed', err.message);
    }
    const newSignals = readTradeSignals();
    res.json({ success: true, elapsed_ms: elapsed, signal_count: (newSignals.signals || []).length, generated_at: newSignals.generatedAt });
  });
});

/**
 * GET /api/status
 * Returns system health and pipeline status
 */
app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: getSystemStatus(),
  });
});

/**
 * POST /api/run
 * Triggers the live runner to generate new signals
 */
app.post("/api/run", requireAuth, async (req, res) => {
  const { spawn } = require("child_process");
  
  res.json({
    success: true,
    message: "Live runner triggered",
    timestamp: new Date().toISOString(),
  });

  // Run live_runner.js in background
  const runner = spawn("node", [LIVE_RUNNER_PATH], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  runner.unref();
});

// ---------------------------------------------------------------------------
// Device Token Registration (Task 315)
// ---------------------------------------------------------------------------

// In-memory token store (replace with SQLite/DB in production)
const deviceTokens = new Map();

/**
 * POST /api/notifications/register
 * Register device token for push notifications
 * Body: { userId, token, platform: "apns"|"fcm" }
 */
app.post("/api/notifications/register", (req, res) => {
  const { userId, token, platform } = req.body;
  
  // Validation
  if (!userId || !token || !platform) {
    return sendError(res, 400, 'MISSING_FIELDS', 'Missing required fields: userId, token, platform');
  }
  
  if (!["apns", "fcm"].includes(platform)) {
    return sendError(res, 400, 'INVALID_PLATFORM', "Invalid platform. Must be 'apns' or 'fcm'");
  }
  
  // Store token
  const key = `${userId}:${platform}`;
  deviceTokens.set(key, {
    userId,
    token,
    platform,
    registeredAt: new Date().toISOString(),
  });
  
  res.json({
    success: true,
    message: "Device token registered",
    userId,
    platform,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/notifications/tokens
 * List registered tokens (admin/debug endpoint)
 */
app.get("/api/notifications/tokens", (req, res) => {
  const tokens = Array.from(deviceTokens.values());
  res.json({
    success: true,
    count: tokens.length,
    tokens: tokens.map(t => ({ ...t, token: t.token.substring(0, 10) + "..." })),
  });
});

// ---------------------------------------------------------------------------
// Live Kalshi API Connection (Task 242)
// ---------------------------------------------------------------------------

/**
 * GET /api/kalshi/status
 * Check Kalshi API credentials and connectivity
 */
app.get("/api/kalshi/status", async (req, res) => {
  const hasCredentials = !!process.env.KALSHI_API_KEY;
  
  let connectionTest = { success: false, error: null };
  if (hasCredentials) {
    try {
      const { KalshiClient } = require("./kalshi_client");
      const client = new KalshiClient({
        apiKey: process.env.KALSHI_API_KEY,
        demo: process.env.KALSHI_DEMO !== "false",
      });
      // Try to fetch markets as a connectivity test
      const result = await client.getMarkets({ limit: 1 });
      connectionTest = { success: true, marketsFound: result.data?.markets?.length || 0 };
    } catch (e) {
      connectionTest = { success: false, error: e.message };
    }
  }
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    credentials: {
      available: hasCredentials,
      source: hasCredentials ? "env:KALSHI_API_KEY" : "none",
    },
    connection: connectionTest,
    mode: process.env.KALSHI_DEMO === "false" ? "live" : "demo",
  });
});

/**
 * POST /api/kalshi/configure
 * Configure Kalshi API credentials (stores in memory only)
 */
app.post("/api/kalshi/configure", requireAuth, (req, res) => {
  const { apiKey, demo = true } = req.body;
  
  if (!apiKey) {
    return sendError(res, 400, 'MISSING_API_KEY', 'apiKey required');
  }
  
  // Set for current process (not persisted)
  process.env.KALSHI_API_KEY = apiKey;
  process.env.KALSHI_DEMO = demo ? "true" : "false";
  
  res.json({
    success: true,
    message: "Credentials configured for this session",
    mode: demo ? "demo" : "live",
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// D004 Arbitrage Engine - Correlation Pairs Endpoint
// ---------------------------------------------------------------------------

const CORRELATION_PAIRS_PATH = path.join(__dirname, "..", "output", "correlation_pairs.json");
const MARKET_CLUSTERS_PATH = path.join(__dirname, "..", "..", "ivan", "output", "market_clusters.json");

// ---------------------------------------------------------------------------
// Trading Readiness Endpoint (T416)
// ---------------------------------------------------------------------------

/**
 * GET /api/readiness
 * Returns trading readiness status for D004 go/no-go decision
 */
app.get("/api/readiness", (req, res) => {
  try {
    // Check D004 Phase outputs
    let phase1 = { status: "unknown", markets_filtered: 0, file_exists: false };
    let phase2 = { status: "unknown", clusters: 0, markets_clustered: 0, file_exists: false };
    let phase3 = { status: "unknown", pairs: 0, arbitrage_opportunities: 0, file_exists: false };
    let phase4 = { status: "unknown", engine_ready: false };
    
    // Phase 1: Market Filtering (Grace's output)
    // Check for any filtered markets indicator in correlation pairs
    try {
      const corrData = JSON.parse(fs.readFileSync(CORRELATION_PAIRS_PATH, "utf8"));
      const pairs = corrData.pairs || [];
      const uniqueMarkets = new Set();
      pairs.forEach(p => {
        uniqueMarkets.add(p.market_a);
        uniqueMarkets.add(p.market_b);
      });
      phase1 = {
        status: uniqueMarkets.size > 0 ? "complete" : "incomplete",
        markets_filtered: uniqueMarkets.size,
        file_exists: true
      };
      phase3 = {
        status: pairs.length > 0 ? "complete" : "incomplete",
        pairs: pairs.length,
        arbitrage_opportunities: pairs.filter(p => p.is_arbitrage_opportunity).length,
        file_exists: true
      };
    } catch (e) {
      phase1.status = "error";
      phase3.status = "error";
    }
    
    // Phase 2: Market Clusters (Ivan's output)
    try {
      const clusterData = JSON.parse(fs.readFileSync(MARKET_CLUSTERS_PATH, "utf8"));
      const clusters = clusterData.clusters || [];
      phase2 = {
        status: clusters.length > 0 ? "complete" : "incomplete",
        clusters: clusters.length,
        markets_clustered: clusterData.summary?.total_markets_clustered || 0,
        file_exists: true
      };
    } catch (e) {
      phase2.status = "error";
    }
    
    // Phase 4: C++ Engine (Dave's output)
    const enginePath = path.join(__dirname, "cpp_engine", "engine");
    phase4 = {
      status: fs.existsSync(enginePath) ? "ready" : "not_built",
      engine_ready: fs.existsSync(enginePath),
      engine_path: enginePath
    };
    
    // Check Kalshi credentials
    const kalshiCreds = !!process.env.KALSHI_API_KEY;
    
    // Determine blockers
    const blockers = [];
    if (phase1.markets_filtered === 0) blockers.push({ type: "phase", id: "P1", message: "No markets filtered" });
    if (phase2.clusters === 0) blockers.push({ type: "phase", id: "P2", message: "No market clusters" });
    if (phase3.pairs === 0) blockers.push({ type: "phase", id: "P3", message: "No correlation pairs" });
    if (!kalshiCreds) blockers.push({ type: "credential", id: "T236", message: "Kalshi API credentials not configured" });
    
    // Go/No-Go decision
    const allPhasesComplete = phase1.status === "complete" && phase2.status === "complete" && phase3.status === "complete";
    const goNoGo = {
      status: (allPhasesComplete && kalshiCreds) ? "GO" : "NO-GO",
      ready: allPhasesComplete && kalshiCreds,
      reason: allPhasesComplete 
        ? (kalshiCreds ? "All phases complete, credentials configured" : "All phases complete, waiting for Kalshi credentials")
        : "D004 pipeline incomplete"
    };
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      go_no_go: goNoGo,
      phases: {
        phase1_market_filtering: phase1,
        phase2_clustering: phase2,
        phase3_correlation: phase3,
        phase4_execution: phase4
      },
      blockers: blockers,
      credentials: {
        kalshi_api_key: kalshiCreds
      }
    });
  } catch (e) {
    sendError(res, 500, 'READINESS_ERROR', 'Failed to compute readiness status', e.message);
  }
});

/**
 * GET /api/correlation-pairs
 * Returns D004 Phase 3 correlation pairs and arbitrage opportunities
 */
app.get("/api/correlation-pairs", (req, res) => {
  try {
    let data = { pairs: [], config: {}, generated_at: null };
    try {
      const raw = fs.readFileSync(CORRELATION_PAIRS_PATH, "utf8");
      data = JSON.parse(raw);
    } catch (e) {
      // File may not exist yet, return empty but valid response
    }
    
    const pairs = data.pairs || [];
    const arbitrageCount = pairs.filter(p => p.is_arbitrage_opportunity).length;
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      generated_at: data.generated_at,
      config: data.config || {},
      total_pairs_analyzed: data.total_pairs_analyzed || pairs.length,
      arbitrage_opportunities: data.arbitrage_opportunities || arbitrageCount,
      pairs: pairs,
    });
  } catch (e) {
    sendError(res, 500, 'FILE_READ_ERROR', 'Failed to read correlation pairs', e.message);
  }
});

// ---------------------------------------------------------------------------
// Static Files (Dashboard Frontend)
// ---------------------------------------------------------------------------

const DASHBOARD_DIR = path.join(__dirname, "dashboard");
if (fs.existsSync(DASHBOARD_DIR)) {
  app.use(express.static(DASHBOARD_DIR));
  app.get("/", (req, res) => {
    res.sendFile(path.join(DASHBOARD_DIR, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    hardened: true,
    features: ['rate_limiting', 'input_validation', 'cors', 'logging', 'error_handling']
  });
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Kalshi Alpha Dashboard API running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Hardening enabled: rate limiting (100/min), CORS, input validation, logging`);
  console.log(`[${new Date().toISOString()}] Trade signals: ${TRADE_SIGNALS_PATH}`);
  console.log(`[${new Date().toISOString()}] Endpoints:`);
  console.log(`  GET  /api/signals              - All trade signals`);
  console.log(`  GET  /api/signals/latest       - Most recent signal`);
  console.log(`  GET  /api/markets              - All markets analyzed`);
  console.log(`  GET  /api/edges                - Top market edges`);
  console.log(`  GET  /api/pnl                  - P&L summary (legacy)`);
  console.log(`  GET  /api/pnl/live             - Live P&L with last 10 trades (T327)`);
  console.log(`  GET  /api/paper-trades/summary - Paper trading summary (T323)`);
  console.log(`  GET  /api/paper-trades         - All paper trades (validated)`);
  console.log(`  GET  /api/win-rate-trend       - Win rate trend by batch (T327)`);
  console.log(`  GET  /api/health               - Strategy health`);
  console.log(`  GET  /api/status               - System health status`);
  console.log(`  GET  /api/kalshi/status        - Kalshi API connection status`);
  console.log(`  POST /api/kalshi/configure     - Configure Kalshi credentials`);
  console.log(`  POST /api/run-pipeline         - Trigger live runner (sync)`);
  console.log(`  POST /api/run                  - Trigger live runner (async)`);
  console.log(`  POST /api/notifications/register - Register device token (T315)`);
  console.log(`  GET  /api/notifications/tokens   - List registered tokens`);
  console.log(`  GET  /api/correlation-pairs      - D004 correlation pairs (T345)`);
  console.log(`  GET  /api/readiness              - Trading readiness status (T416)`);
  console.log(`  GET  /health                   - Health check`);
});

module.exports = { app, readTradeSignals, getSystemStatus };
