/**
 * Mock API server for testing the strategy framework.
 * Mimics Bob's API spec (server.js) on a lightweight HTTP server.
 */

const http = require("http");

const MARKETS = [
  {
    id: "m1",
    ticker: "INXW-25-DEC31",
    title: "S&P 500 to close above 5000",
    category: "Economics",
    status: "active",
    yes_bid: 85,
    yes_ask: 87,
    yes_mid: 86,
    no_bid: 13,
    no_ask: 15,
    no_mid: 14,
    implied_probability: 0.86,
    volume: 250000,
    open_interest: 12000,
  },
  {
    id: "m2",
    ticker: "BTCW-25-DEC31",
    title: "Bitcoin above 100k",
    category: "Crypto",
    status: "active",
    yes_bid: 15,
    yes_ask: 17,
    yes_mid: 16,
    no_bid: 83,
    no_ask: 85,
    no_mid: 84,
    implied_probability: 0.16,
    volume: 180000,
    open_interest: 8000,
  },
  {
    id: "m3",
    ticker: "UNEMP-25-MAR",
    title: "Unemployment below 4%",
    category: "Economics",
    status: "active",
    yes_bid: 55,
    yes_ask: 57,
    yes_mid: 56,
    no_bid: 43,
    no_ask: 45,
    no_mid: 44,
    implied_probability: 0.56,
    volume: 90000,
    open_interest: 5000,
  },
];

const ORDERS = [];

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (path === "/health") {
    return jsonResponse(res, { status: "ok", engine: "mock" });
  }

  if (path === "/api/markets") {
    const category = url.searchParams.get("category");
    const statusFilter = url.searchParams.get("status") || "active";
    let result = MARKETS.filter((m) => m.status === statusFilter);
    if (category) result = result.filter((m) => m.category === category);
    return jsonResponse(res, { markets: result });
  }

  const marketMatch = path.match(/^\/api\/markets\/([^/]+)$/);
  if (marketMatch) {
    const ticker = decodeURIComponent(marketMatch[1]);
    const market = MARKETS.find((m) => m.ticker === ticker);
    if (!market) return jsonResponse(res, { error: "Market not found" }, 404);
    return jsonResponse(res, { market });
  }

  const historyMatch = path.match(/^\/api\/markets\/([^/]+)\/history$/);
  if (historyMatch) {
    const ticker = decodeURIComponent(historyMatch[1]);
    const market = MARKETS.find((m) => m.ticker === ticker);
    if (!market) return jsonResponse(res, { error: "Market not found" }, 404);
    return jsonResponse(res, {
      ticker,
      resolution: "1d",
      from: new Date(Date.now() - 7 * 86400000).toISOString(),
      to: new Date().toISOString(),
      count: 7,
      data: Array.from({ length: 7 }).map((_, i) => ({
        candle_time: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
        yes_close: market.yes_mid,
        yes_volume: market.volume / 7,
      })),
    });
  }

  if (path === "/api/portfolio") {
    return jsonResponse(res, {
      snapshot: {
        balance: 100000,
        portfolio_value: 0,
        total_value: 100000,
        daily_pnl: 0,
      },
      positions: { count: 0, yesContracts: 0, noContracts: 0 },
    });
  }

  if (path === "/api/portfolio/positions") {
    return jsonResponse(res, { positions: [] });
  }

  if (path === "/api/portfolio/orders") {
    return jsonResponse(res, { orders: ORDERS });
  }

  if (path === "/api/orders" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const order = JSON.parse(body);
      const record = {
        id: `ord-${Date.now()}`,
        ...order,
        status: "filled",
        filled_contracts: order.contracts,
        avg_fill_price: order.price,
        created_at: new Date().toISOString(),
        filled_at: new Date().toISOString(),
      };
      ORDERS.push(record);
      jsonResponse(res, { order: record }, 201);
    });
    return;
  }

  jsonResponse(res, { error: "Not found" }, 404);
});

const PORT = process.env.API_PORT || 3002;
server.listen(PORT, () => {
  console.log(`Mock API server running on port ${PORT}`);
});
