#!/usr/bin/env node
/**
 * Kalshi Trading API Mock Server
 * Author: Bob (Backend Engineer)
 * 
 * Returns mock data for frontend development when DB is unavailable.
 * Supports all the same endpoints as server.js but with sample data.
 */

"use strict";

const http = require("http");
const { URL } = require("url");

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

  patch(path, handler) {
    this.routes.push({ method: "PATCH", path, handler, pattern: this._pathToPattern(path) });
  }

  delete(path, handler) {
    this.routes.push({ method: "DELETE", path, handler, pattern: this._pathToPattern(path) });
  }

  _pathToPattern(path) {
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

// Mock data
const mockStrategies = [
  {
    id: "s1",
    name: "Mean Reversion Alpha",
    strategy_type: "mean_reversion",
    description: "Targets overbought/oversold markets using z-score",
    status: "active",
    config: { lookbackPeriods: 10, zScoreThreshold: 1.5 },
    max_position_size: 1000,
    total_pnl: 12500,
    total_trades: 45,
    winning_trades: 28,
    losing_trades: 17,
    created_at: "2026-04-01T10:00:00Z",
    recent_pnl: 3200,
    calculated_win_rate: 0.62
  },
  {
    id: "s2",
    name: "Momentum Scalper",
    strategy_type: "momentum",
    description: "Follows volume + price momentum",
    status: "active",
    config: { minVolume: 50000, priceChangeThreshold: 5 },
    max_position_size: 500,
    total_pnl: 8300,
    total_trades: 32,
    winning_trades: 20,
    losing_trades: 12,
    created_at: "2026-04-01T11:00:00Z",
    recent_pnl: 1800,
    calculated_win_rate: 0.625
  },
  {
    id: "s3",
    name: "Arbitrage Hunter",
    strategy_type: "arbitrage",
    description: "Finds mispriced yes/no combinations",
    status: "paused",
    config: {},
    max_position_size: 2000,
    total_pnl: 2100,
    total_trades: 12,
    winning_trades: 9,
    losing_trades: 3,
    created_at: "2026-04-01T12:00:00Z",
    recent_pnl: 400,
    calculated_win_rate: 0.75
  },
  {
    id: "s4",
    name: "Longshot Fader",
    strategy_type: "longshot_fading",
    description: "Sells YES 5¢-20¢ in niche categories (Weather, Entertainment, Culture)",
    status: "active",
    config: { minPrice: 5, maxPrice: 20, targetCategories: ["Weather", "Entertainment", "Culture"] },
    max_position_size: 800,
    total_pnl: 15600,
    total_trades: 67,
    winning_trades: 45,
    losing_trades: 22,
    created_at: "2026-04-01T13:00:00Z",
    recent_pnl: 4200,
    calculated_win_rate: 0.67
  },
  {
    id: "s5",
    name: "Economic Momentum",
    strategy_type: "economic_momentum",
    description: "Trades macro data releases using forecast divergence",
    status: "active",
    config: { targetCategories: ["Economics", "Financial"], minDivergence: 8 },
    max_position_size: 1200,
    total_pnl: 22100,
    total_trades: 34,
    winning_trades: 24,
    losing_trades: 10,
    created_at: "2026-04-01T14:00:00Z",
    recent_pnl: 5800,
    calculated_win_rate: 0.71
  },
  {
    id: "s6",
    name: "Cross-Platform Arbitrage",
    strategy_type: "cross_platform_arbitrage",
    description: "Exploits price divergences between platforms",
    status: "active",
    config: { minSpread: 3, maxHoldMinutes: 30 },
    max_position_size: 3000,
    total_pnl: 8500,
    total_trades: 89,
    winning_trades: 82,
    losing_trades: 7,
    created_at: "2026-04-01T15:00:00Z",
    recent_pnl: 1200,
    calculated_win_rate: 0.92
  }
];

const mockMarkets = [
  {
    id: "550e8400-e29b-41d4-a716-446655440010",
    ticker: "BTC-250331",
    title: "Bitcoin to exceed $100k by March 31",
    category: "Crypto",
    status: "active",
    yes_bid: 45,
    yes_ask: 47,
    no_bid: 53,
    no_ask: 55,
    yes_mid: 46,
    no_mid: 54,
    volume: 150000,
    open_interest: 50000
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440011",
    ticker: "SPX-250331",
    title: "S&P 500 to close above 5200 on March 31",
    category: "Equities",
    status: "active",
    yes_bid: 62,
    yes_ask: 64,
    no_bid: 36,
    no_ask: 38,
    yes_mid: 63,
    no_mid: 37,
    volume: 230000,
    open_interest: 89000
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440012",
    ticker: "FED-2503",
    title: "Fed to cut rates in March 2026",
    category: "Economics",
    status: "active",
    yes_bid: 28,
    yes_ask: 30,
    no_bid: 70,
    no_ask: 72,
    yes_mid: 29,
    no_mid: 71,
    volume: 450000,
    open_interest: 180000
  }
];

const mockSignals = [
  {
    id: "550e8400-e29b-41d4-a716-446655440020",
    strategy_id: "550e8400-e29b-41d4-a716-446655440000",
    market_id: "550e8400-e29b-41d4-a716-446655440010",
    side: "yes",
    signal_type: "entry",
    confidence: 0.78,
    target_price: 46,
    current_price: 46,
    expected_edge: 8,
    recommended_contracts: 25,
    status: "pending",
    reason: "Mean reversion: z-score=-1.8, mean=52.0",
    generated_at: "2026-04-01T21:20:00Z"
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440021",
    strategy_id: "550e8400-e29b-41d4-a716-446655440001",
    market_id: "550e8400-e29b-41d4-a716-446655440012",
    side: "no",
    signal_type: "entry",
    confidence: 0.85,
    target_price: 71,
    current_price: 71,
    expected_edge: 12,
    recommended_contracts: 40,
    status: "pending",
    reason: "Momentum: -15c in 24h, vol24h=450000",
    generated_at: "2026-04-01T21:22:00Z"
  }
];

// Helper functions
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

// Routes
router.get("/health", async (req, res) => {
  jsonResponse(res, {
    status: "ok",
    mode: "mock",
    timestamp: new Date().toISOString(),
    version: "1.0.0-mock"
  });
});

router.get("/api/markets", async (req, res) => {
  jsonResponse(res, { markets: mockMarkets });
});

router.get("/api/markets/:ticker", async (req, res, params) => {
  const market = mockMarkets.find(m => m.ticker === params.ticker);
  if (!market) return errorResponse(res, "Market not found", 404);
  jsonResponse(res, { market });
});

router.get("/api/markets/:ticker/history", async (req, res, params) => {
  jsonResponse(res, {
    ticker: params.ticker,
    resolution: "1d",
    count: 7,
    data: Array.from({ length: 7 }, (_, i) => ({
      candle_time: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
      yes_open: 40 + Math.random() * 20,
      yes_high: 50 + Math.random() * 20,
      yes_low: 35 + Math.random() * 15,
      yes_close: 45 + Math.random() * 15,
      yes_volume: 10000 + Math.random() * 50000
    }))
  });
});

router.get("/api/portfolio", async (req, res) => {
  jsonResponse(res, {
    snapshot: {
      balance: 500000,
      portfolio_value: 125000,
      total_value: 625000,
      daily_pnl: 3200,
      total_pnl: 22900
    },
    positions: { count: 3, yesContracts: 150, noContracts: 200 }
  });
});

router.get("/api/portfolio/positions", async (req, res) => {
  jsonResponse(res, {
    positions: [
      {
        id: "pos-1",
        ticker: "BTC-250331",
        side: "yes",
        contracts: 50,
        avg_entry_price: 42,
        current_price: 46,
        calculated_unrealized_pnl: 200
      },
      {
        id: "pos-2",
        ticker: "FED-2503",
        side: "no",
        contracts: 100,
        avg_entry_price: 68,
        current_price: 71,
        calculated_unrealized_pnl: 300
      }
    ]
  });
});

router.get("/api/portfolio/orders", async (req, res) => {
  jsonResponse(res, { orders: [] });
});

router.post("/api/orders", async (req, res) => {
  const body = await getBody(req);
  jsonResponse(res, {
    order: {
      id: "order-" + Date.now(),
      market_id: body.marketId,
      side: body.side,
      action: body.action,
      contracts: body.contracts,
      price: body.price,
      status: "pending",
      created_at: new Date().toISOString()
    }
  }, 201);
});

// Strategy API Routes
router.get("/api/strategies", async (req, res) => {
  jsonResponse(res, { strategies: mockStrategies });
});

router.get("/api/strategies/:id", async (req, res, params) => {
  const strategy = mockStrategies.find(s => s.id === params.id);
  if (!strategy) return errorResponse(res, "Strategy not found", 404);
  jsonResponse(res, { strategy });
});

router.post("/api/strategies", async (req, res) => {
  const body = await getBody(req);
  const newStrategy = {
    id: "550e8400-e29b-41d4-a716-44665544" + Math.floor(Math.random() * 1000).toString().padStart(4, "0"),
    name: body.name,
    strategy_type: body.strategyType,
    description: body.description || "",
    status: body.status || "stopped",
    config: body.config || {},
    max_position_size: body.maxPositionSize || 1000,
    total_pnl: 0,
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    created_at: new Date().toISOString()
  };
  mockStrategies.push(newStrategy);
  jsonResponse(res, { strategy: newStrategy }, 201);
});

router.patch("/api/strategies/:id", async (req, res, params) => {
  const body = await getBody(req);
  const strategy = mockStrategies.find(s => s.id === params.id);
  if (!strategy) return errorResponse(res, "Strategy not found", 404);
  
  if (body.status) strategy.status = body.status;
  if (body.name) strategy.name = body.name;
  if (body.config) strategy.config = { ...strategy.config, ...body.config };
  if (body.maxPositionSize) strategy.max_position_size = body.maxPositionSize;
  
  jsonResponse(res, { strategy });
});

router.get("/api/strategies/:id/signals", async (req, res, params) => {
  const signals = mockSignals.filter(s => s.strategy_id === params.id);
  jsonResponse(res, { signals });
});

router.get("/api/strategies/:id/pnl", async (req, res, params) => {
  const strategy = mockStrategies.find(s => s.id === params.id);
  if (!strategy) return errorResponse(res, "Strategy not found", 404);
  
  jsonResponse(res, {
    strategyId: params.id,
    pnl: {
      realized: strategy.total_pnl,
      unrealized: Math.floor(strategy.total_pnl * 0.2),
      total: Math.floor(strategy.total_pnl * 1.2)
    },
    winRate: {
      totalTrades: strategy.total_trades,
      winningTrades: strategy.winning_trades,
      losingTrades: strategy.losing_trades,
      winRate: strategy.total_trades > 0 ? strategy.winning_trades / strategy.total_trades : 0
    },
    tradesToday: 3
  });
});

router.get("/api/strategies/:id/performance", async (req, res, params) => {
  jsonResponse(res, {
    history: Array.from({ length: 7 }, (_, i) => ({
      period: "daily",
      period_start: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
      trades_count: Math.floor(Math.random() * 10),
      realized_pnl: Math.floor(Math.random() * 2000) - 500,
      total_pnl: Math.floor(Math.random() * 5000),
      win_rate: 0.5 + Math.random() * 0.3
    }))
  });
});

router.post("/api/strategies/:id/run", async (req, res, params) => {
  const strategy = mockStrategies.find(s => s.id === params.id);
  if (!strategy) return errorResponse(res, "Strategy not found", 404);
  
  jsonResponse(res, {
    strategyId: params.id,
    strategyType: strategy.strategy_type,
    signalCount: 2,
    signals: mockSignals.filter(s => s.strategy_id === params.id)
  });
});

router.post("/api/strategies/run-all", async (req, res) => {
  jsonResponse(res, {
    results: mockStrategies
      .filter(s => s.status === "active")
      .map(s => ({
        strategyId: s.id,
        strategyType: s.strategy_type,
        signalCount: Math.floor(Math.random() * 3),
        signals: []
      }))
  });
});

// Server
const PORT = process.env.API_PORT || 3000;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

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
  console.log(`Kalshi Trading API Mock Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
