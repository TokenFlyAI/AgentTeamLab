# Kalshi Trading Infrastructure — Implementation Summary

**Author:** Bob (Backend Engineer)  
**Task:** #219 — Build Kalshi API client to fetch live market data and prices  
**Date:** 2026-04-01

---

## Overview

Built complete backend infrastructure for Kalshi prediction market trading operation. Includes API client, database schema, data pipelines, and REST API for frontend consumption.

---

## Components

### 1. Kalshi API Client (`kalshi_client.js`)

**Features:**
- Full Kalshi REST API coverage
- Built-in rate limiting (100 req/10s)
- Demo/production environment support
- Promise-based async API

**Endpoints Covered:**
- Account: `getAccount()`, `getBalance()`
- Markets: `getMarkets()`, `getMarket()`, `getOrderbook()`, `getCandles()`
- Series: `getSeries()`, `getSeriesByTicker()`
- Events: `getEvents()`, `getEvent()`
- Orders: `getOrders()`, `createOrder()`, `cancelOrder()`
- Positions: `getPositions()`, `getPosition()`
- Portfolio: `getPortfolio()`, `getPortfolioHistory()`

**Usage:**
```javascript
const { KalshiClient } = require('./kalshi_client');
const client = new KalshiClient({ apiKey: 'xxx', demo: true });
const markets = await client.getMarkets();
```

---

### 2. Database Schema (`db/schema.sql`)

**Tables:**

| Table | Purpose |
|-------|---------|
| `markets` | Market definitions from Kalshi |
| `market_prices` | Price snapshots (bid/ask/mid) |
| `price_candles` | OHLCV candle data for charts |
| `positions` | Trading positions |
| `orders` | Order history |
| `trades` | Individual trade fills |
| `portfolio_snapshots` | Daily portfolio value tracking |
| `data_collection_jobs` | Pipeline job logging |

**Key Design Decisions:**
- UUID primary keys
- Prices stored as cents (0-100)
- Generated columns for mid prices
- Views for common queries (`active_markets_with_prices`, `open_positions_with_markets`)

---

### 3. Data Pipeline

#### Python Collector (`pipeline/data_collector.py`)
- Comprehensive data collection
- Job logging with status tracking
- Supports: markets, prices, candles, positions
- CLI interface for manual execution

#### Node.js Scripts
- `fetch_markets.js` — Fetch all markets every 5 min
- `fetch_prices.js` — Record price snapshots every 1 min
- `sync_positions.js` — Sync positions every 5 min

**Cron Setup:**
```cron
*/5 * * * * node pipeline/fetch_markets.js
*/1 * * * * node pipeline/fetch_prices.js
*/5 * * * * node pipeline/sync_positions.js
```

---

### 4. Data Fetcher (`kalshi_data_fetcher.js`)

**Features:**
- In-memory caching (5 min TTL)
- Market filtering by category
- Search by keyword
- Export to JSON/CSV
- CLI interface

**CLI Commands:**
```bash
node kalshi_data_fetcher.js markets [category]
node kalshi_data_fetcher.js categories
node kalshi_data_fetcher.js market <ticker>
node kalshi_data_fetcher.js stats
node kalshi_data_fetcher.js export [json|csv] [category]
```

---

### 5. REST API (`api/markets_api.js`)

**Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/markets` | List markets (with filters) |
| `GET /api/markets/:ticker` | Get market details |
| `GET /api/markets/:ticker/history` | Price history |
| `GET /api/markets/:ticker/orderbook` | Orderbook |
| `GET /api/categories` | List categories |
| `GET /api/portfolio` | Portfolio summary |
| `GET /api/positions` | List positions |
| `GET /api/orders` | Order history |

**Response Format:**
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "timestamp": "2026-04-01T21:00:00Z",
    "total": 1500,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

---

## API Response Shapes (for Frontend)

### Market
```typescript
interface Market {
  id: string;
  ticker: string;
  title: string;
  description: string;
  category: string;
  status: 'active' | 'closed' | 'settled';
  yes_price: number;    // 0-100 (cents)
  no_price: number;     // 0-100 (cents)
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  open_interest: number;
  expiration: string;   // ISO date
}
```

### PricePoint (for charts)
```typescript
interface PricePoint {
  timestamp: string;
  yes_price: number;
  volume: number;
  yes_open: number;
  yes_high: number;
  yes_low: number;
}
```

### Position
```typescript
interface Position {
  id: string;
  market_id: string;
  market_title: string;
  side: 'yes' | 'no';
  contracts: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  opened_at: string;
}
```

---

## Environment Variables

```bash
# Kalshi API
KALSHI_API_KEY=your_api_key
KALSHI_DEMO=true  # Set to false for production

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=kalshi_trading
DB_USER=trader
DB_PASSWORD=your_password
```

---

## NPM Scripts

```bash
npm run fetch:markets      # Fetch all markets
npm run fetch:prices       # Fetch price snapshots
npm run sync:positions     # Sync positions
npm run db:init           # Initialize database
npm run cli:markets       # CLI: list markets
npm run cli:categories    # CLI: list categories
npm run cli:stats         # CLI: show stats
```

---

## Next Steps

1. **Integration Testing** — Test data pipeline end-to-end
2. **WebSocket Support** — Real-time price feeds (future)
3. **Strategy Framework API** — Coordinate with Dave on signal generation needs
4. **Production Deployment** — Set up production database and cron jobs

---

## Files

```
backend/
├── kalshi_client.js
├── kalshi_data_fetcher.js
├── rate_limiter.js
├── login.js
├── smoke_test.js
├── package.json
├── db/
│   └── schema.sql
├── pipeline/
│   ├── data_collector.py
│   ├── fetch_markets.js
│   ├── fetch_prices.js
│   ├── sync_positions.js
│   ├── requirements.txt
│   └── README.md
└── api/
    └── markets_api.js
```

---

**Status:** Ready for integration testing
