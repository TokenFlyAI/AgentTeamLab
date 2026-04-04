#!/usr/bin/env node
/**
 * Kalshi Trading API Server
 * Author: Bob (Backend Engineer)
 * Task: #219 — Backend API for trading strategies
 *
 * Provides REST API endpoints for:
 *   - Market data
 *   - Price history
 *   - Portfolio/positions
 *   - Paper trading orders
 */

"use strict";

const http = require("http");
const { URL } = require("url");
const { Pool } = require("pg");
const { MockPool } = require("./mock_pool");
const {
  StrategyRunner,
  MeanReversionStrategy,
  MomentumStrategy,
  PnLTracker,
} = require("../strategies");
const { NFPNowcastStrategy } = require("../strategies/strategies/nfp_nowcast");

const MOCK_MODE = process.env.MOCK_MODE === "1";
if (MOCK_MODE) {
  console.log("[MOCK_MODE] Running with mock data (no database required)");
}

// Database configuration
const pool = MOCK_MODE ? new MockPool() : new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "kalshi_trading",
  user: process.env.DB_USER || "trader",
  password: process.env.DB_PASSWORD,
});

// Simple router
class Router {
  constructor() {
    this.routes = [];
  }

  get(path, handler) {
    this.routes.push({ method: "GET", path, handler, pattern: this._pathToPattern(path) });
  }

  post(path, handler) {
    this.routes.push({ method: "POST", path, handler, pattern: this._pathToPattern(path) });
  }

  delete(path, handler) {
    this.routes.push({ method: "DELETE", path, handler, pattern: this._pathToPattern(path) });
  }

  patch(path, handler) {
    this.routes.push({ method: "PATCH", path, handler, pattern: this._pathToPattern(path) });
  }

  _pathToPattern(path) {
    // Convert /api/markets/:ticker to regex
    const pattern = path
      .replace(/:([^/]+)/g, "([^/]+)")
      .replace(/\*/g, ".*");
    return new RegExp(`^${pattern}$`);
  }

  match(method, path) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (match) {
        const params = {};
        const paramNames = route.path.match(/:([^/]+)/g) || [];
        paramNames.forEach((name, i) => {
          params[name.slice(1)] = match[i + 1];
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

const router = new Router();

// ---------------------------------------------------------------------------
// Strategy Framework Setup
// ---------------------------------------------------------------------------
const strategyRunner = new StrategyRunner({ pool });
strategyRunner.register("mean_reversion", new MeanReversionStrategy());
strategyRunner.register("momentum", new MomentumStrategy());
strategyRunner.register("nfp_nowcast", new NFPNowcastStrategy());
const pnlTracker = new PnLTracker({ pool });

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function errorResponse(res, message, status = 500) {
  jsonResponse(res, { error: message }, status);
}

function parseQuery(url) {
  const parsed = new URL(url, "http://localhost");
  const params = {};
  for (const [key, value] of parsed.searchParams) {
    params[key] = value;
  }
  return params;
}

function transformStrategyRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    strategyType: row.strategy_type,
    status: row.status,
    totalTrades: row.total_trades,
    winningTrades: row.winning_trades,
    losingTrades: row.losing_trades,
    totalPnl: row.total_pnl,
    winRate: row.win_rate,
    signalStrength: row.signal_strength,
    tradesToday: row.trades_today,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    updatedAt: row.updated_at,
  };
}

async function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// Health check
router.get("/health", async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    client.release();
    jsonResponse(res, {
      status: "ok",
      timestamp: result.rows[0].now,
      version: "1.0.0",
    });
  } catch (e) {
    errorResponse(res, "Database connection failed", 503);
  }
});

// List markets
router.get("/api/markets", async (req, res) => {
  const query = parseQuery(req.url);
  const client = await pool.connect();

  try {
    let sql = "SELECT * FROM active_markets_with_prices WHERE 1=1";
    const params = [];
    let paramIdx = 1;

    if (query.category) {
      sql += ` AND category = $${paramIdx++}`;
      params.push(query.category);
    }

    if (query.status) {
      sql += ` AND status = $${paramIdx++}`;
      params.push(query.status);
    } else {
      sql += ` AND status = 'active'`;
    }

    if (query.minVolume) {
      sql += ` AND volume >= $${paramIdx++}`;
      params.push(parseInt(query.minVolume));
    }

    sql += " ORDER BY volume DESC NULLS LAST LIMIT 500";

    const result = await client.query(sql, params);
    jsonResponse(res, { markets: result.rows });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get specific market
router.get("/api/markets/:ticker", async (req, res, params) => {
  const client = await pool.connect();

  try {
    const result = await client.query(
      "SELECT * FROM active_markets_with_prices WHERE ticker = $1",
      [params.ticker]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, "Market not found", 404);
    }

    jsonResponse(res, { market: result.rows[0] });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get market price history
router.get("/api/markets/:ticker/history", async (req, res, params) => {
  const query = parseQuery(req.url);
  const client = await pool.connect();

  try {
    // First get market ID
    const marketResult = await client.query(
      "SELECT id FROM markets WHERE ticker = $1",
      [params.ticker]
    );

    if (marketResult.rows.length === 0) {
      return errorResponse(res, "Market not found", 404);
    }

    const marketId = marketResult.rows[0].id;
    const resolution = query.resolution || "1d";

    // Calculate time range
    let fromTime, toTime;
    if (query.from && query.to) {
      fromTime = new Date(query.from);
      toTime = new Date(query.to);
    } else {
      const days = parseInt(query.days || "7");
      toTime = new Date();
      fromTime = new Date(toTime.getTime() - days * 24 * 60 * 60 * 1000);
    }

    // Query candles or raw prices depending on resolution
    let result;
    if (["1m", "5m", "15m", "1h", "1d"].includes(resolution)) {
      result = await client.query(
        `SELECT * FROM price_candles 
         WHERE market_id = $1 AND resolution = $2 
         AND candle_time >= $3 AND candle_time <= $4
         ORDER BY candle_time ASC`,
        [marketId, resolution, fromTime, toTime]
      );
    } else {
      // Raw price snapshots
      result = await client.query(
        `SELECT * FROM market_prices 
         WHERE market_id = $1 
         AND recorded_at >= $2 AND recorded_at <= $3
         ORDER BY recorded_at ASC`,
        [marketId, fromTime, toTime]
      );
    }

    jsonResponse(res, {
      ticker: params.ticker,
      resolution,
      from: fromTime,
      to: toTime,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get portfolio summary
router.get("/api/portfolio", async (req, res) => {
  const client = await pool.connect();

  try {
    // Get latest portfolio snapshot
    const snapshotResult = await client.query(
      `SELECT * FROM portfolio_snapshots 
       ORDER BY snapshot_date DESC LIMIT 1`
    );

    // Get open positions count
    const positionsResult = await client.query(
      `SELECT COUNT(*) as count, 
              SUM(CASE WHEN side = 'yes' THEN contracts ELSE 0 END) as yes_contracts,
              SUM(CASE WHEN side = 'no' THEN contracts ELSE 0 END) as no_contracts
       FROM positions WHERE status = 'open'`
    );

    jsonResponse(res, {
      snapshot: snapshotResult.rows[0] || null,
      positions: {
        count: parseInt(positionsResult.rows[0].count),
        yesContracts: parseInt(positionsResult.rows[0].yes_contracts || 0),
        noContracts: parseInt(positionsResult.rows[0].no_contracts || 0),
      },
    });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get open positions
router.get("/api/portfolio/positions", async (req, res) => {
  const query = parseQuery(req.url);
  const client = await pool.connect();

  try {
    let sql = "SELECT * FROM open_positions_with_markets";
    const params = [];

    if (query.status) {
      sql += " WHERE status = $1";
      params.push(query.status);
    }

    sql += " ORDER BY opened_at DESC";

    const result = await client.query(sql, params);
    jsonResponse(res, { positions: result.rows });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get orders
router.get("/api/portfolio/orders", async (req, res) => {
  const query = parseQuery(req.url);
  const client = await pool.connect();

  try {
    let sql = `
      SELECT o.*, m.ticker, m.title 
      FROM orders o
      JOIN markets m ON o.market_id = m.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (query.status) {
      sql += ` AND o.status = $${paramIdx++}`;
      params.push(query.status);
    }

    if (query.marketId) {
      sql += ` AND o.market_id = $${paramIdx++}`;
      params.push(query.marketId);
    }

    sql += ` ORDER BY o.created_at DESC LIMIT 100`;

    const result = await client.query(sql, params);
    jsonResponse(res, { orders: result.rows });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Create order (paper trading)
router.post("/api/orders", async (req, res) => {
  const body = await getBody(req);
  const client = await pool.connect();

  try {
    // Validate required fields
    if (!body.marketId || !body.side || !body.action || !body.contracts || !body.price) {
      return errorResponse(res, "Missing required fields: marketId, side, action, contracts, price", 400);
    }

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO orders (market_id, side, action, contracts, price, status, client_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.marketId,
        body.side.toLowerCase(),
        body.action.toLowerCase(),
        body.contracts,
        body.price,
        "pending",
        body.clientOrderId || null,
      ]
    );

    await client.query("COMMIT");

    jsonResponse(res, { order: result.rows[0] }, 201);
  } catch (e) {
    await client.query("ROLLBACK");
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get order by ID
router.get("/api/orders/:id", async (req, res, params) => {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT o.*, m.ticker, m.title 
       FROM orders o
       JOIN markets m ON o.market_id = m.id
       WHERE o.id = $1`,
      [params.id]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, "Order not found", 404);
    }

    jsonResponse(res, { order: result.rows[0] });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Strategy API Routes
// ---------------------------------------------------------------------------

// List strategies
router.get("/api/strategies", async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM strategy_summary_view ORDER BY created_at DESC`
    );
    jsonResponse(res, { strategies: result.rows.map(transformStrategyRow) });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Create strategy
router.post("/api/strategies", async (req, res) => {
  const body = await getBody(req);
  const client = await pool.connect();

  try {
    if (!body.name || !body.strategyType) {
      return errorResponse(res, "Missing required fields: name, strategyType", 400);
    }

    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO strategies (name, description, strategy_type, config, status, max_position_size, max_daily_loss, max_exposure)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        body.name,
        body.description || "",
        body.strategyType,
        JSON.stringify(body.config || {}),
        body.status || "stopped",
        body.maxPositionSize || 1000,
        body.maxDailyLoss || 50000,
        body.maxExposure || 200000,
      ]
    );
    await client.query("COMMIT");
    jsonResponse(res, { strategy: result.rows[0] }, 201);
  } catch (e) {
    await client.query("ROLLBACK");
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get strategy P&L report (for dashboard integration)
router.get("/api/strategies/pnl", async (req, res) => {
  const client = await pool.connect();
  try {
    // Aggregate metrics across all strategies
    const metricsResult = await client.query(`
      SELECT
        COALESCE(SUM(total_trades), 0) as total_trades,
        COALESCE(SUM(winning_trades), 0) as winning_trades,
        COALESCE(SUM(losing_trades), 0) as losing_trades,
        COALESCE(SUM(total_pnl), 0) as total_pnl
      FROM strategies
      WHERE status = 'active'
    `);

    const unrealizedResult = await client.query(`
      SELECT COALESCE(SUM(calculated_unrealized_pnl), 0) as total_unrealized_pnl
      FROM strategy_positions_view
      WHERE position_status = 'open'
    `);

    // Daily performance for charts / Sharpe / drawdown
    const dailyResult = await client.query(`
      SELECT period_start, total_pnl, cumulative_pnl
      FROM strategy_performance
      WHERE period = 'daily'
      ORDER BY period_start ASC
    `);

    const dailyReturns = dailyResult.rows.map((r) => r.total_pnl);
    const cumulative = dailyResult.rows.map((r) => r.cumulative_pnl);

    // Compute Sharpe ratio (simplified)
    let sharpeRatio = 0;
    if (dailyReturns.length > 1) {
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1);
      const std = Math.sqrt(variance);
      sharpeRatio = std === 0 ? 0 : mean / std;
    }

    // Compute max drawdown from cumulative P&L
    let maxDrawdown = 0;
    let peak = 0;
    for (const val of cumulative) {
      if (val > peak) peak = val;
      const dd = peak - val;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const m = metricsResult.rows[0];
    const totalTrades = parseInt(m.total_trades, 10);
    const winningTrades = parseInt(m.winning_trades, 10);

    jsonResponse(res, {
      report: {
        totalTrades,
        winningTrades,
        losingTrades: parseInt(m.losing_trades, 10),
        winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
        totalRealizedPnl: parseInt(m.total_pnl, 10),
        totalUnrealizedPnl: parseInt(unrealizedResult.rows[0].total_unrealized_pnl, 10),
        sharpeRatio,
        maxDrawdown,
        dailyReturns,
      },
    });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Update strategy status
router.patch("/api/strategies/:id", async (req, res, params) => {
  const body = await getBody(req);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const updates = [];
    const values = [];
    let idx = 1;

    if (body.status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(body.status);
      if (body.status === "active") {
        updates.push(`activated_at = COALESCE(activated_at, NOW())`);
      } else if (body.status === "stopped") {
        updates.push(`stopped_at = NOW()`);
      }
    }
    if (body.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(body.description);
    }
    if (body.config !== undefined) {
      updates.push(`config = $${idx++}`);
      values.push(JSON.stringify(body.config));
    }
    if (body.maxPositionSize !== undefined) {
      updates.push(`max_position_size = $${idx++}`);
      values.push(body.maxPositionSize);
    }
    if (body.maxDailyTrades !== undefined) {
      updates.push(`max_daily_trades = $${idx++}`);
      values.push(body.maxDailyTrades);
    }
    if (body.maxDailyLoss !== undefined) {
      updates.push(`max_daily_loss = $${idx++}`);
      values.push(body.maxDailyLoss);
    }
    if (body.maxExposure !== undefined) {
      updates.push(`max_exposure = $${idx++}`);
      values.push(body.maxExposure);
    }

    if (updates.length === 0) {
      await client.query("ROLLBACK");
      return errorResponse(res, "No fields to update", 400);
    }

    values.push(params.id);
    const result = await client.query(
      `UPDATE strategies SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return errorResponse(res, "Strategy not found", 404);
    }

    await client.query("COMMIT");
    jsonResponse(res, { strategy: result.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get strategy signals
router.get("/api/strategies/:id/signals", async (req, res, params) => {
  const query = parseQuery(req.url);
  const client = await pool.connect();

  try {
    let sql = `SELECT * FROM strategy_signals WHERE strategy_id = $1`;
    const values = [params.id];
    let idx = 2;

    if (query.actedOn !== undefined) {
      sql += ` AND acted_on = $${idx++}`;
      values.push(query.actedOn === "true");
    }

    sql += ` ORDER BY generated_at DESC LIMIT 100`;

    const result = await client.query(sql, values);
    jsonResponse(res, { signals: result.rows });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get per-strategy P&L reports for dashboard integration
router.get("/api/strategies/reports", async (req, res) => {
  try {
    const client = await pool.connect();
    let strategies = [];
    try {
      const result = await client.query(
        `SELECT id FROM strategies ORDER BY created_at DESC`
      );
      strategies = result.rows;
    } finally {
      client.release();
    }

    const reports = {};
    for (const strategy of strategies) {
      reports[strategy.id] = await pnlTracker.generateReport(strategy.id);
    }

    jsonResponse(res, { reports });
  } catch (e) {
    errorResponse(res, e.message);
  }
});

// Get single strategy
router.get("/api/strategies/:id", async (req, res, params) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM strategy_summary_view WHERE id = $1`,
      [params.id]
    );
    if (result.rows.length === 0) {
      return errorResponse(res, "Strategy not found", 404);
    }
    jsonResponse(res, { strategy: transformStrategyRow(result.rows[0]) });
  } catch (e) {
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// Get strategy P&L
router.get("/api/strategies/:id/pnl", async (req, res, params) => {
  try {
    const pnl = await pnlTracker.getTotalPnL(params.id);
    const winRate = await pnlTracker.getWinRate(params.id);
    const tradesToday = await pnlTracker.getTradesToday(params.id);
    jsonResponse(res, {
      strategyId: params.id,
      pnl,
      winRate,
      tradesToday,
    });
  } catch (e) {
    errorResponse(res, e.message);
  }
});

// Get strategy performance history
router.get("/api/strategies/:id/performance", async (req, res, params) => {
  const query = parseQuery(req.url);
  try {
    const history = await pnlTracker.getPerformanceHistory(
      params.id,
      query.period || "daily",
      parseInt(query.limit || "30")
    );
    jsonResponse(res, { history });
  } catch (e) {
    errorResponse(res, e.message);
  }
});

// Get strategy P&L report (matches dashboard PnLReport type)
router.get("/api/strategies/:id/report", async (req, res, params) => {
  try {
    const report = await pnlTracker.generateReport(params.id);
    jsonResponse(res, { report });
  } catch (e) {
    errorResponse(res, e.message);
  }
});

// Get open paper positions
router.get("/api/paper_positions", async (req, res) => {
  const { ExecutionEngine } = require("../strategies/execution_engine");
  const engine = new ExecutionEngine({ pool });
  try {
    const positions = await engine.getOpenPositions();
    jsonResponse(res, { positions });
  } catch (e) {
    errorResponse(res, e.message);
  }
});

// Run a single strategy manually
router.post("/api/strategies/:id/run", async (req, res, params) => {
  try {
    const client = await pool.connect();
    let strategy;
    try {
      const result = await client.query(
        `SELECT * FROM strategies WHERE id = $1`,
        [params.id]
      );
      strategy = result.rows[0];
    } finally {
      client.release();
    }

    if (!strategy) {
      return errorResponse(res, "Strategy not found", 404);
    }

    const markets = await strategyRunner.fetchMarkets();
    const result = await strategyRunner.runStrategy(strategy, markets);
    jsonResponse(res, result);
  } catch (e) {
    errorResponse(res, e.message);
  }
});

// Run all active strategies
router.post("/api/strategies/run-all", async (req, res) => {
  try {
    const results = await strategyRunner.runAll();
    jsonResponse(res, { results });
  } catch (e) {
    errorResponse(res, e.message);
  }
});

// Cancel order
router.delete("/api/orders/:id", async (req, res, params) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE orders 
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'open')
       RETURNING *`,
      [params.id]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return errorResponse(res, "Order not found or cannot be cancelled", 404);
    }

    await client.query("COMMIT");

    jsonResponse(res, { order: result.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    errorResponse(res, e.message);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = process.env.API_PORT || 3001;

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // Find route
  const route = router.match(req.method, path);

  if (route) {
    try {
      await route.handler(req, res, route.params);
    } catch (e) {
      console.error("Handler error:", e);
      errorResponse(res, "Internal server error", 500);
    }
  } else {
    errorResponse(res, "Not found", 404);
  }
});

server.listen(PORT, () => {
  console.log(`Kalshi Trading API Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});
