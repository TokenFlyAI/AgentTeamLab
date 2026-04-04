# Kalshi Trading API Documentation

**Author:** Mia (API Engineer)  
**Date:** 2026-04-01  
**Version:** 1.0.0  
**Status:** Ready for Integration

---

## Overview

This document describes the REST API for the Agent Planet Kalshi trading operation. It provides endpoints for market data, price history, portfolio management, paper trading, and strategy execution.

**Base URL:** `http://localhost:3000` (default)  
**Content-Type:** `application/json`  
**All timestamps:** ISO 8601 UTC

---

## Quick Start

```javascript
const { KalshiSdk } = require("./kalshi_sdk");

const sdk = new KalshiSdk({ baseUrl: "http://localhost:3000" });

// List active markets
const markets = await sdk.getMarkets({ category: "Economics" });

// Get price history
const prices = await sdk.getMarketPrices("INXW-25-DEC31", { resolution: "1h", days: 7 });

// Place a paper trade
const order = await sdk.placeOrder({
  marketId: "uuid-here",
  side: "yes",
  action: "buy",
  contracts: 100,
  price: 65,
});
```

---

## Markets

### `GET /api/markets`

List all active markets with optional filters.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by category (e.g., "Economics") |
| `status` | string | Filter by status (default: `active`) |
| `minVolume` | number | Minimum volume threshold |
| `closingBefore` | string | ISO date — markets closing before |

**Response:**

```json
{
  "markets": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ticker": "INXW-25-DEC31",
      "title": "Will the S&P 500 close above 5000?",
      "category": "Economics",
      "status": "active",
      "yes_bid": 64,
      "yes_ask": 66,
      "no_bid": 34,
      "no_ask": 36,
      "volume": 150000,
      "open_interest": 50000,
      "price_updated_at": "2026-04-01T20:00:00Z"
    }
  ]
}
```

---

### `GET /api/markets/:ticker`

Get a specific market by ticker.

**Response:**

```json
{
  "market": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "ticker": "INXW-25-DEC31",
    "title": "Will the S&P 500 close above 5000?",
    "category": "Economics",
    "status": "active",
    "yes_bid": 64,
    "yes_ask": 66,
    "no_bid": 34,
    "no_ask": 36,
    "yes_price": 65,
    "no_price": 35,
    "volume": 150000,
    "open_interest": 50000,
    "price_updated_at": "2026-04-01T20:00:00Z"
  }
}
```

---

### `GET /api/markets/:ticker/history`

Get price history (candles or raw snapshots).

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `resolution` | string | `1m`, `5m`, `15m`, `1h`, `1d` (default: `1d`) |
| `days` | number | Last N days (default: `7`, max: `365`) |
| `from` | string | Start timestamp (ISO 8601) |
| `to` | string | End timestamp (ISO 8601) |

**Response:**

```json
{
  "ticker": "INXW-25-DEC31",
  "resolution": "1d",
  "from": "2026-03-25T00:00:00.000Z",
  "to": "2026-04-01T20:00:00.000Z",
  "count": 8,
  "data": [
    {
      "candle_time": "2026-03-25T00:00:00Z",
      "yes_open": 60,
      "yes_high": 65,
      "yes_low": 58,
      "yes_close": 62,
      "yes_volume": 12000,
      "no_close": 38
    }
  ]
}
```

---

### `GET /api/markets/:ticker/orderbook`

Get current orderbook for a market.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `depth` | number | Orderbook depth (default: `10`) |

**Response:**

```json
{
  "ticker": "INXW-25-DEC31",
  "depth": 10,
  "bids": [{"price": 64, "size": 500}],
  "asks": [{"price": 66, "size": 300}],
  "timestamp": "2026-04-01T20:00:00Z"
}
```

---

## Portfolio

### `GET /api/portfolio`

Get portfolio summary.

**Response:**

```json
{
  "snapshot": {
    "balance": 1000000,
    "portfolio_value": 250000,
    "total_value": 1250000,
    "day_pnl": 5000,
    "snapshot_date": "2026-04-01"
  },
  "positions": {
    "count": 3,
    "yesContracts": 500,
    "noContracts": 200
  }
}
```

---

### `GET /api/portfolio/positions`

List open positions.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | `open`, `closed`, `partial` |

**Response:**

```json
{
  "positions": [
    {
      "id": "...",
      "ticker": "INXW-25-DEC31",
      "title": "Will the S&P 500 close above 5000?",
      "side": "yes",
      "contracts": 100,
      "avg_entry_price": 60,
      "current_price": 65,
      "unrealized_pnl": 500,
      "opened_at": "2026-03-28T10:00:00Z"
    }
  ]
}
```

---

### `GET /api/portfolio/orders`

List orders.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `marketId` | string | Filter by market UUID |

**Response:**

```json
{
  "orders": [
    {
      "id": "...",
      "ticker": "INXW-25-DEC31",
      "title": "Will the S&P 500 close above 5000?",
      "side": "yes",
      "action": "buy",
      "contracts": 100,
      "price": 65,
      "status": "pending",
      "filled_contracts": 0,
      "created_at": "2026-04-01T19:00:00Z"
    }
  ]
}
```

---

## Trading (Paper)

### `POST /api/orders`

Submit a new paper trading order.

**Request Body:**

```json
{
  "marketId": "550e8400-e29b-41d4-a716-446655440000",
  "side": "yes",
  "action": "buy",
  "contracts": 100,
  "price": 65,
  "clientOrderId": "my-strategy-001"
}
```

**Response (201):**

```json
{
  "order": {
    "id": "...",
    "market_id": "550e8400-e29b-41d4-a716-446655440000",
    "side": "yes",
    "action": "buy",
    "contracts": 100,
    "price": 65,
    "status": "pending",
    "client_order_id": "my-strategy-001",
    "created_at": "2026-04-01T20:00:00Z"
  }
}
```

---

### `GET /api/orders/:id`

Get order by ID.

**Response:**

```json
{
  "order": {
    "id": "...",
    "ticker": "INXW-25-DEC31",
    "side": "yes",
    "action": "buy",
    "contracts": 100,
    "price": 65,
    "status": "pending",
    "created_at": "2026-04-01T20:00:00Z"
  }
}
```

---

### `DELETE /api/orders/:id`

Cancel an order (only if `pending` or `open`).

**Response:**

```json
{
  "order": {
    "id": "...",
    "status": "cancelled",
    "updated_at": "2026-04-01T20:05:00Z"
  }
}
```

---

## Strategies

### `GET /api/strategies`

List all strategies.

**Response:**

```json
{
  "strategies": [
    {
      "id": "...",
      "name": "Mean Reversion",
      "strategy_type": "mean_reversion",
      "status": "active",
      "total_pnl": 12500,
      "total_trades": 45,
      "winning_trades": 28,
      "losing_trades": 17,
      "calculated_win_rate": 0.6222
    }
  ]
}
```

---

### `POST /api/strategies`

Create a new strategy.

**Request Body:**

```json
{
  "name": "Momentum Strategy",
  "strategyType": "momentum",
  "description": "Trend following with volume confirmation",
  "config": { "lookback": 20, "threshold": 0.05 },
  "status": "active",
  "maxPositionSize": 500,
  "maxDailyLoss": 50000,
  "maxExposure": 200000
}
```

**Response (201):**

```json
{
  "strategy": {
    "id": "...",
    "name": "Momentum Strategy",
    "strategy_type": "momentum",
    "status": "active",
    "max_position_size": 500,
    "max_daily_loss": 50000,
    "max_exposure": 200000,
    "created_at": "2026-04-01T20:00:00Z"
  }
}
```

---

### `GET /api/strategies/:id`

Get strategy details.

---

### `PATCH /api/strategies/:id`

Update strategy fields.

**Request Body:**

```json
{
  "status": "paused",
  "config": { "lookback": 30 }
}
```

---

### `GET /api/strategies/:id/signals`

Get strategy signals.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `actedOn` | boolean | Filter by acted_on status |

---

### `GET /api/strategies/:id/pnl`

Get strategy P&L summary.

**Response:**

```json
{
  "strategyId": "...",
  "pnl": 12500,
  "winRate": 0.6222,
  "tradesToday": 3
}
```

---

### `GET /api/strategies/:id/performance`

Get performance history.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | string | `hourly`, `daily`, `weekly`, `monthly` |
| `limit` | number | Max records (default: `30`) |

---

### `POST /api/strategies/:id/run`

Manually run a single strategy.

**Response:**

```json
{
  "marketsScanned": 150,
  "signalsGenerated": 5,
  "signalsExecuted": 2
}
```

---

### `POST /api/strategies/run-all`

Run all active strategies.

**Response:**

```json
{
  "results": [
    { "strategyId": "...", "signalsGenerated": 3, "signalsExecuted": 1 }
  ]
}
```

---

## Health

### `GET /health`

Health check.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-04-01T20:00:00.000Z",
  "version": "1.0.0"
}
```

---

## Error Responses

All errors follow this shape:

```json
{
  "error": "Market not found"
}
```

**Common status codes:**

| Code | Meaning |
|------|---------|
| `400` | Bad request — invalid parameters |
| `404` | Not found |
| `500` | Internal server error |
| `503` | Service unavailable — database down |

---

## Data Types

### Prices

All prices are in **cents** (0–100). Divide by 100 for dollar probabilities.

| Field | Example | Meaning |
|-------|---------|---------|
| `yes_bid` | 64 | Best bid for YES |
| `yes_ask` | 66 | Best ask for YES |
| `yes_price` | 65 | Mid price for YES |
| `no_price` | 35 | Mid price for NO |

### Volumes

Volumes are raw contract counts.

### Timestamps

All timestamps are ISO 8601 strings in UTC.

---

## SDK Reference

See `kalshi_sdk.js` for the official JavaScript client.

**Import:**

```javascript
const { KalshiSdk } = require("./kalshi_sdk");
```

**Instantiation:**

```javascript
const sdk = new KalshiSdk({
  baseUrl: "http://localhost:3000",
  apiKey: "optional-key",
  timeout: 30000,
});
```

---

## Pipeline & Data Collection

Data is collected automatically by the pipeline scheduler:

| Job | Frequency | Script |
|-----|-----------|--------|
| Market fetch | Every 5 min | `pipeline/fetch_markets.js` |
| Price snapshots | Every 1 min | `pipeline/fetch_prices.js` |
| Position sync | Every 5 min | `pipeline/sync_positions.js` |

Run the unified scheduler:

```bash
node backend/pipeline/scheduler.js daemon
```

Run all jobs once:

```bash
node backend/pipeline/scheduler.js run-all
```

---

## Changelog

### v1.0.0 (2026-04-01)

- Initial API release
- Markets, portfolio, orders, and strategy endpoints
- Paper trading support
- Price history with candle resolutions
- Unified pipeline scheduler
