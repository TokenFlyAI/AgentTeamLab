/**
 * Internal Markets API — For Frontend/Strategy Consumption
 * Author: Bob (Backend Engineer)
 * Task: #219 — Build Kalshi API client and data infrastructure
 *
 * Provides REST endpoints for:
 *   - Market data queries
 *   - Price history
 *   - Portfolio/positions
 *   - Trading operations
 *
 * Response shapes coordinated with Charlie (Frontend)
 */

"use strict";

const { Pool } = require("pg");

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "kalshi_trading",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
};

// Create connection pool
const pool = new Pool(dbConfig);

// ---------------------------------------------------------------------------
// Response Helpers
// ---------------------------------------------------------------------------

function successResponse(data, meta = {}) {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

function errorResponse(message, code = 500, details = null) {
  return {
    success: false,
    error: {
      message,
      code,
      ...(details && { details }),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Market Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/markets
 * List markets with optional filters
 * 
 * Query params:
 *   - category: Filter by category
 *   - status: Filter by status (default: active)
 *   - search: Search in title
 *   - limit: Max results (default: 100, max: 500)
 *   - offset: Pagination offset
 */
async function listMarkets(req, res) {
  try {
    const {
      category,
      status = "active",
      search,
      limit = 100,
      offset = 0,
    } = req.query;

    const maxLimit = Math.min(parseInt(limit, 10) || 100, 500);
    const skip = parseInt(offset, 10) || 0;

    let whereClause = "WHERE m.status = $1";
    const params = [status];
    let paramIdx = 2;

    if (category) {
      whereClause += ` AND m.category = $${paramIdx++}`;
      params.push(category);
    }

    if (search) {
      whereClause += ` AND m.title ILIKE $${paramIdx++}`;
      params.push(`%${search}%`);
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM markets m ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    // Get markets with latest prices
    const query = `
      SELECT 
        m.id,
        m.ticker,
        m.title,
        m.description,
        m.category,
        m.status,
        m.open_date as open_date,
        m.close_date as expiration,
        m.yes_sub_title,
        m.no_sub_title,
        mp.yes_bid,
        mp.yes_ask,
        mp.no_bid,
        mp.no_ask,
        COALESCE(mp.yes_mid, 50) as yes_price,
        COALESCE(mp.no_mid, 50) as no_price,
        mp.volume,
        mp.open_interest,
        mp.recorded_at as price_updated_at
      FROM markets m
      LEFT JOIN LATERAL (
        SELECT * FROM market_prices
        WHERE market_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) mp ON true
      ${whereClause}
      ORDER BY mp.volume DESC NULLS LAST
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(maxLimit, skip);

    const result = await pool.query(query, params);

    return res.json(
      successResponse(result.rows, {
        total,
        limit: maxLimit,
        offset: skip,
        hasMore: skip + result.rows.length < total,
      })
    );
  } catch (error) {
    console.error("Error listing markets:", error);
    return res.status(500).json(errorResponse("Failed to fetch markets"));
  }
}

/**
 * GET /api/markets/:ticker
 * Get a specific market with full details
 */
async function getMarket(req, res) {
  try {
    const { ticker } = req.params;

    const query = `
      SELECT 
        m.*,
        mp.yes_bid,
        mp.yes_ask,
        mp.no_bid,
        mp.no_ask,
        COALESCE(mp.yes_mid, 50) as yes_price,
        COALESCE(mp.no_mid, 50) as no_price,
        mp.volume,
        mp.open_interest,
        mp.last_trade_price,
        mp.recorded_at as price_updated_at
      FROM markets m
      LEFT JOIN LATERAL (
        SELECT * FROM market_prices
        WHERE market_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) mp ON true
      WHERE m.ticker = $1
    `;

    const result = await pool.query(query, [ticker]);

    if (result.rows.length === 0) {
      return res.status(404).json(errorResponse("Market not found", 404));
    }

    return res.json(successResponse(result.rows[0]));
  } catch (error) {
    console.error("Error fetching market:", error);
    return res.status(500).json(errorResponse("Failed to fetch market"));
  }
}

/**
 * GET /api/markets/:ticker/history
 * Get price history for a market
 * 
 * Query params:
 *   - resolution: 1m, 5m, 15m, 1h, 1d (default: 1d)
 *   - days: Number of days of history (default: 7)
 */
async function getMarketHistory(req, res) {
  try {
    const { ticker } = req.params;
    const { resolution = "1d", days = 7 } = req.query;

    // Validate resolution
    const validResolutions = ["1m", "5m", "15m", "1h", "1d"];
    if (!validResolutions.includes(resolution)) {
      return res
        .status(400)
        .json(errorResponse("Invalid resolution", 400, { valid: validResolutions }));
    }

    const daysInt = Math.min(parseInt(days, 10) || 7, 365);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysInt);

    const query = `
      SELECT 
        pc.candle_time as timestamp,
        pc.yes_close as yes_price,
        pc.yes_volume as volume,
        pc.yes_open,
        pc.yes_high,
        pc.yes_low,
        pc.no_close as no_price,
        pc.no_volume
      FROM price_candles pc
      JOIN markets m ON pc.market_id = m.id
      WHERE m.ticker = $1
        AND pc.resolution = $2
        AND pc.candle_time >= $3
      ORDER BY pc.candle_time ASC
    `;

    const result = await pool.query(query, [ticker, resolution, fromDate]);

    return res.json(
      successResponse(result.rows, {
        resolution,
        days: daysInt,
        count: result.rows.length,
      })
    );
  } catch (error) {
    console.error("Error fetching market history:", error);
    return res.status(500).json(errorResponse("Failed to fetch price history"));
  }
}

/**
 * GET /api/markets/:ticker/orderbook
 * Get current orderbook for a market
 */
async function getOrderbook(req, res) {
  try {
    const { ticker } = req.params;
    const { depth = 10 } = req.query;

    // This would typically fetch from Kalshi API directly
    // or from a cached orderbook table
    // For now, return a placeholder
    return res.json(
      successResponse({
        ticker,
        depth: parseInt(depth, 10),
        bids: [], // Would be populated from actual orderbook
        asks: [],
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error("Error fetching orderbook:", error);
    return res.status(500).json(errorResponse("Failed to fetch orderbook"));
  }
}

// ---------------------------------------------------------------------------
// Categories Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/categories
 * List all market categories with counts
 */
async function listCategories(req, res) {
  try {
    const query = `
      SELECT 
        category,
        COUNT(*) as market_count,
        SUM(volume) as total_volume
      FROM markets m
      LEFT JOIN LATERAL (
        SELECT volume FROM market_prices
        WHERE market_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) mp ON true
      WHERE m.status = 'active'
      GROUP BY category
      ORDER BY market_count DESC
    `;

    const result = await pool.query(query);

    return res.json(
      successResponse(result.rows, {
        count: result.rows.length,
      })
    );
  } catch (error) {
    console.error("Error listing categories:", error);
    return res.status(500).json(errorResponse("Failed to fetch categories"));
  }
}

// ---------------------------------------------------------------------------
// Portfolio Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/portfolio
 * Get portfolio summary
 */
async function getPortfolio(req, res) {
  try {
    // Get latest portfolio snapshot
    const snapshotQuery = `
      SELECT * FROM portfolio_snapshots
      ORDER BY snapshot_date DESC
      LIMIT 1
    `;
    const snapshotResult = await pool.query(snapshotQuery);

    // Get open positions with market info
    const positionsQuery = `
      SELECT 
        p.id,
        m.ticker as market_id,
        m.title as market_title,
        p.side,
        p.contracts,
        p.avg_entry_price,
        COALESCE(
          CASE 
            WHEN p.side = 'yes' THEN mp.yes_mid
            WHEN p.side = 'no' THEN mp.no_mid
          END, 50
        ) as current_price,
        p.unrealized_pnl,
        p.opened_at
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      LEFT JOIN LATERAL (
        SELECT yes_mid, no_mid FROM market_prices
        WHERE market_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) mp ON true
      WHERE p.status = 'open'
      ORDER BY p.opened_at DESC
    `;
    const positionsResult = await pool.query(positionsQuery);

    // Calculate totals
    const totalUnrealizedPnl = positionsResult.rows.reduce(
      (sum, pos) => sum + (parseInt(pos.unrealized_pnl, 10) || 0),
      0
    );

    return res.json(
      successResponse({
        balance: snapshotResult.rows[0]?.balance || 0,
        portfolio_value: snapshotResult.rows[0]?.portfolio_value || 0,
        total_value: snapshotResult.rows[0]?.total_value || 0,
        unrealized_pnl: totalUnrealizedPnl,
        positions: positionsResult.rows,
        position_count: positionsResult.rows.length,
      })
    );
  } catch (error) {
    console.error("Error fetching portfolio:", error);
    return res.status(500).json(errorResponse("Failed to fetch portfolio"));
  }
}

/**
 * GET /api/positions
 * List all positions
 */
async function listPositions(req, res) {
  try {
    const { status = "open" } = req.query;

    const query = `
      SELECT 
        p.id,
        m.ticker as market_id,
        m.title as market_title,
        m.category,
        p.side,
        p.contracts,
        p.avg_entry_price,
        COALESCE(
          CASE 
            WHEN p.side = 'yes' THEN mp.yes_mid
            WHEN p.side = 'no' THEN mp.no_mid
          END, 50
        ) as current_price,
        p.unrealized_pnl,
        p.opened_at,
        p.status
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      LEFT JOIN LATERAL (
        SELECT yes_mid, no_mid FROM market_prices
        WHERE market_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) mp ON true
      WHERE p.status = $1
      ORDER BY p.opened_at DESC
    `;

    const result = await pool.query(query, [status]);

    return res.json(
      successResponse(result.rows, {
        count: result.rows.length,
        status,
      })
    );
  } catch (error) {
    console.error("Error listing positions:", error);
    return res.status(500).json(errorResponse("Failed to fetch positions"));
  }
}

// ---------------------------------------------------------------------------
// Orders Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/orders
 * List orders
 */
async function listOrders(req, res) {
  try {
    const { status, limit = 100, offset = 0 } = req.query;

    let whereClause = "";
    const params = [];
    let paramIdx = 1;

    if (status) {
      whereClause = `WHERE o.status = $${paramIdx++}`;
      params.push(status);
    }

    params.push(Math.min(parseInt(limit, 10) || 100, 500));
    params.push(parseInt(offset, 10) || 0);

    const query = `
      SELECT 
        o.id,
        o.kalshi_order_id,
        m.ticker as market_ticker,
        m.title as market_title,
        o.side,
        o.action,
        o.contracts,
        o.price,
        o.status,
        o.filled_contracts,
        o.avg_fill_price,
        o.created_at,
        o.filled_at
      FROM orders o
      JOIN markets m ON o.market_id = m.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    const result = await pool.query(query, params);

    return res.json(
      successResponse(result.rows, {
        count: result.rows.length,
      })
    );
  } catch (error) {
    console.error("Error listing orders:", error);
    return res.status(500).json(errorResponse("Failed to fetch orders"));
  }
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

async function healthCheck(req, res) {
  try {
    await pool.query("SELECT 1");
    return res.json(
      successResponse({
        status: "healthy",
        database: "connected",
      })
    );
  } catch (error) {
    return res.status(503).json(
      errorResponse("Service unhealthy", 503, { database: "disconnected" })
    );
  }
}

// ---------------------------------------------------------------------------
// Express Router Setup
// ---------------------------------------------------------------------------

function createRouter() {
  const express = require("express");
  const router = express.Router();

  // Health
  router.get("/health", healthCheck);

  // Markets
  router.get("/markets", listMarkets);
  router.get("/markets/:ticker", getMarket);
  router.get("/markets/:ticker/history", getMarketHistory);
  router.get("/markets/:ticker/orderbook", getOrderbook);

  // Categories
  router.get("/categories", listCategories);

  // Portfolio
  router.get("/portfolio", getPortfolio);
  router.get("/positions", listPositions);

  // Orders
  router.get("/orders", listOrders);

  return router;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createRouter,
  // Individual handlers for testing
  listMarkets,
  getMarket,
  getMarketHistory,
  getOrderbook,
  listCategories,
  getPortfolio,
  listPositions,
  listOrders,
  healthCheck,
};

// ---------------------------------------------------------------------------
// Standalone server (for development)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const express = require("express");
  const app = express();

  app.use(express.json());
  app.use("/api", createRouter());

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Markets API server running on port ${PORT}`);
  });
}
