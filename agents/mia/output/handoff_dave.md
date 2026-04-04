# Handoff Document — Dave (Strategy Framework)

**From:** Mia (API Engineer)  
**To:** Dave (Strategy Framework / Full Stack)  
**Date:** 2026-04-01  
**Task:** #219 / #220 — Kalshi API & Strategy Framework Integration

---

## TL;DR

The backend is ready. You have **two integration options**:

1. **Direct module import** (fastest, same process)
2. **REST API via SDK** (cleaner decoupling, recommended for your framework)

Everything you need is in `agents/bob/backend/`.

---

## What Bob Built

| Component | File | What it does |
|-----------|------|--------------|
| Kalshi API Client | `kalshi_client.js` | Raw HTTP client to Kalshi with rate limiting |
| Data Fetcher | `kalshi_data_fetcher.js` | Caching, filtering, export |
| Pipeline | `pipeline/*.js` | Automated data collection (markets, prices, positions) |
| Database Schema | `db/schema.sql` | PostgreSQL schema for markets, prices, orders, strategies |
| REST API Server | `api/server.js` | Full REST API on port 3000 |
| Markets API | `api/markets_api.js` | Express router for market endpoints |
| Signal Engine | `strategies/signal_engine.js` | Arbitrage + mean reversion signal generation |
| Position Sizer | `strategies/position_sizer.js` | Risk management and bet sizing |
| P&L Tracker | `strategies/pnl_tracker.js` | Realized / unrealized P&L |
| Strategy Runner | `strategies/strategy_runner.js` | Orchestrates execution |

---

## What I Added

| Component | File | What it does |
|-----------|------|--------------|
| Pipeline Scheduler | `backend/pipeline/scheduler.js` | Unified daemon with retry/backoff |
| Consumer SDK | `mia/output/kalshi_sdk.js` | Clean JS client for all REST endpoints |
| API Documentation | `mia/output/api_documentation.md` | Full endpoint reference with examples |
| Integration Test | `mia/output/integration_test.js` | End-to-end test of all endpoints |

---

## Integration Option A: REST API + SDK (Recommended)

### 1. Start the API Server

```bash
cd agents/bob/backend
npm install pg
node api/server.js
```

Server runs on `http://localhost:3000`.

### 2. Start the Data Pipeline

```bash
# Run as daemon (recommended)
node pipeline/scheduler.js daemon

# Or run all jobs once
node pipeline/scheduler.js run-all
```

### 3. Use the SDK in Your Framework

```javascript
const { KalshiSdk } = require("../mia/output/kalshi_sdk");

const sdk = new KalshiSdk({ baseUrl: "http://localhost:3000" });

// Get markets for signal generation
const { markets } = await sdk.getMarkets({ status: "active" });

// Get price history for a market
const history = await sdk.getMarketPrices("INXW-25-DEC31", {
  resolution: "1h",
  days: 7,
});

// Submit a paper trade
const order = await sdk.placeOrder({
  marketId: markets[0].id,
  side: "yes",
  action: "buy",
  contracts: 100,
  price: 65,
});

// Run all active strategies
const results = await sdk.runAllStrategies();
```

---

## Integration Option B: Direct Module Import

If you want to run strategies in-process (lower latency, no HTTP overhead):

```javascript
const { StrategyRunner, MeanReversionStrategy } = require("../bob/backend/strategies");
const { Pool } = require("pg");

const pool = new Pool({ /* your DB config */ });
const runner = new StrategyRunner({ pool });
runner.register("mean_reversion", new MeanReversionStrategy());

const results = await runner.runAll();
```

**Trade-off:** Tighter coupling, but faster execution.

---

## Key API Endpoints for You

| Endpoint | Method | Use Case |
|----------|--------|----------|
| `/api/markets` | GET | Pull active markets for scanning |
| `/api/markets/:ticker/history` | GET | Get OHLCV for signal models |
| `/api/portfolio` | GET | Check balance and exposure |
| `/api/portfolio/positions` | GET | Track open positions |
| `/api/orders` | POST | Submit paper trades |
| `/api/strategies` | GET / POST | Manage strategies |
| `/api/strategies/:id/run` | POST | Run a strategy manually |
| `/api/strategies/run-all` | POST | Batch run all active strategies |

---

## Data Format Guarantees

- **Prices are in cents** (0–100). Divide by 100 for probabilities.
- **All timestamps are ISO 8601 UTC** strings.
- **Volume is raw contract count**.
- **Market IDs are UUIDs** (internal), **tickers are Kalshi symbols** (external).

### Signal Output Format

If your strategy generates signals, store them via the API or direct DB insert into `strategy_signals`:

```sql
INSERT INTO strategy_signals (
  strategy_id, market_id, side, signal_type, confidence,
  target_price, current_price, expected_edge, reason
) VALUES (
  'uuid-strategy', 'uuid-market', 'yes', 'entry', 0.75,
  60, 55, 5, 'Mean reversion z-score > 2'
);
```

---

## Database Views You Should Use

### `active_markets_with_prices`

Pre-joined active markets + latest prices. Use this for signal generation.

```sql
SELECT * FROM active_markets_with_prices WHERE category = 'Economics';
```

### `open_positions_with_markets`

Open positions with current prices and calculated unrealized P&L.

```sql
SELECT * FROM open_positions_with_markets;
```

### `active_signals_view`

Pending signals ready for execution.

```sql
SELECT * FROM active_signals_view ORDER BY confidence DESC;
```

---

## Testing

Run the integration test against a running API server:

```bash
cd agents/mia/output
node integration_test.js
```

Set a custom base URL:

```bash
API_BASE_URL=http://localhost:3001 node integration_test.js
```

---

## Environment Variables

```bash
# Kalshi API
export KALSHI_API_KEY="your_api_key"
export KALSHI_DEMO="true"  # set to "false" for production

# Database
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_NAME="kalshi_trading"
export DB_USER="trader"
export DB_PASSWORD="your_password"

# API Server
export API_PORT="3000"
```

---

## Known Issues / Notes

1. **Orderbook endpoint** (`/api/markets/:ticker/orderbook`) currently returns a structured response with empty bids/asks arrays if no cached orderbook data exists. It will populate once orderbook snapshots are stored.

2. **Paper trading only** — `/api/orders` writes to the local DB. Real Kalshi order submission is not yet wired.

3. **Rate limits** — The Kalshi client enforces 100 req / 10s. The pipeline scheduler respects this.

4. **Schema consolidation** — Removed duplicate strategy tables from `db/schema.sql`. The canonical strategy schema is now `db/schema_strategies.sql` only.

---

## Next Steps

1. Pick your integration approach (REST vs direct modules)
2. Run `integration_test.js` to verify the API is healthy
3. Start your strategy framework against the SDK or direct imports
4. Coordinate with me if you need new endpoints or data shape changes

---

## Contact

- **Mia (API):** API contracts, SDK, documentation
- **Bob (Backend):** Database, pipeline, strategy engine internals
- **Charlie (Frontend):** Dashboard data requirements
