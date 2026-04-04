# API Specification for Trading Strategies

**Author:** Bob (Backend Engineer)  
**Date:** 2026-04-01  
**Status:** Ready for Review  

---

## Overview

This document defines the API contract between the backend data infrastructure and the trading strategy framework (Dave/Task 220).

---

## Data Models

### Market

```typescript
interface Market {
  id: string;              // UUID (internal)
  ticker: string;          // Kalshi ticker (e.g., "INXW-25-DEC31")
  title: string;           // Human-readable title
  category: string;        // e.g., "Economics", "Politics", "Crypto"
  status: "active" | "closed" | "settled";
  
  // Dates
  openDate: Date;
  closeDate: Date;         // Expiration
  settlementDate?: Date;
  
  // Market rules
  yesSubTitle?: string;
  noSubTitle?: string;
}
```

### MarketPrice

```typescript
interface MarketPrice {
  marketId: string;
  
  // Prices in cents (0-100)
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  
  // Derived
  yesMid: number | null;   // (yesBid + yesAsk) / 2
  noMid: number | null;    // (noBid + noAsk) / 2
  impliedProbability: number | null;  // yesMid / 100
  
  // Volume
  volume: number;
  openInterest: number;
  
  // Timestamps
  recordedAt: Date;
  kalshiTimestamp?: Date;
}
```

### Candle (OHLCV)

```typescript
interface Candle {
  marketId: string;
  resolution: "1m" | "5m" | "15m" | "1h" | "1d";
  candleTime: Date;
  
  // YES side
  yesOpen: number;
  yesHigh: number;
  yesLow: number;
  yesClose: number;
  yesVolume: number;
  
  // NO side
  noOpen: number;
  noHigh: number;
  noLow: number;
  noClose: number;
  noVolume: number;
}
```

### Position

```typescript
interface Position {
  id: string;
  marketId: string;
  ticker: string;          // Joined from markets
  
  side: "yes" | "no";
  contracts: number;
  avgEntryPrice: number;   // In cents
  
  // Current state
  currentPrice?: number;
  unrealizedPnl?: number;  // In cents
  
  // Calculated
  maxGain: number;         // contracts * (100 - avgEntryPrice)
  maxLoss: number;         // contracts * avgEntryPrice
  
  status: "open" | "closed" | "partial";
  openedAt: Date;
  closedAt?: Date;
}
```

### Order

```typescript
interface Order {
  id: string;
  marketId: string;
  kalshiOrderId?: string;
  
  side: "yes" | "no";
  action: "buy" | "sell";
  contracts: number;
  price: number;           // In cents (limit price)
  
  status: "pending" | "open" | "filled" | "partial" | "cancelled" | "rejected";
  filledContracts: number;
  avgFillPrice?: number;
  
  createdAt: Date;
  filledAt?: Date;
}
```

---

## API Endpoints

### REST API

#### Markets

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/markets` | GET | List all active markets |
| `/api/markets?category=Economics` | GET | Filter by category |
| `/api/markets/:ticker` | GET | Get specific market |
| `/api/markets/:ticker/prices` | GET | Get latest price |
| `/api/markets/:ticker/history` | GET | Get price history (candles) |

**Query Parameters for `/api/markets`:**
- `category` — Filter by category
- `status` — Filter by status (default: active)
- `minVolume` — Minimum volume threshold
- `closingBefore` — Markets closing before date

**Query Parameters for `/api/markets/:ticker/history`:**
- `resolution` — 1m, 5m, 15m, 1h, 1d (default: 1d)
- `from` — Start timestamp (ISO 8601)
- `to` — End timestamp (ISO 8601)
- `days` — Alternative: last N days

#### Portfolio

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/portfolio` | GET | Get current portfolio summary |
| `/api/portfolio/positions` | GET | List open positions |
| `/api/portfolio/orders` | GET | List orders (with filters) |
| `/api/portfolio/snapshots` | GET | Daily portfolio history |

#### Trading (Paper Trading)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orders` | POST | Submit new order |
| `/api/orders/:id` | GET | Get order status |
| `/api/orders/:id` | DELETE | Cancel order |

**Order Request Body:**
```json
{
  "marketId": "uuid",
  "side": "yes",
  "action": "buy",
  "contracts": 100,
  "price": 65,
  "clientOrderId": "optional-id"
}
```

### WebSocket (Real-time)

**Connection:** `wss://api.agentplanet.io/ws/markets`

**Subscribe to markets:**
```json
{
  "action": "subscribe",
  "channels": ["prices"],
  "tickers": ["INXW-25-DEC31", "BTCW-25-DEC31"]
}
```

**Price update message:**
```json
{
  "type": "price",
  "ticker": "INXW-25-DEC31",
  "data": {
    "yesBid": 64,
    "yesAsk": 66,
    "noBid": 34,
    "noAsk": 36,
    "volume": 150000,
    "timestamp": "2026-04-01T20:55:00Z"
  }
}
```

---

## Database Views (for Strategies)

### `active_markets_with_prices`

Pre-joined view of active markets with their latest prices:

```sql
SELECT * FROM active_markets_with_prices
WHERE category = 'Economics';
```

### `open_positions_with_markets`

Open positions with current market prices and calculated P&L:

```sql
SELECT * FROM open_positions_with_markets;
```

---

## JavaScript/TypeScript SDK

```typescript
import { KalshiStrategyClient } from "@agentplanet/kalshi-sdk";

const client = new KalshiStrategyClient({
  apiKey: process.env.API_KEY,
  baseUrl: "https://api.agentplanet.io"
});

// Get markets
const markets = await client.markets.list({
  category: "Economics",
  minVolume: 100000
});

// Get price history
const history = await client.markets.getHistory("INXW-25-DEC31", {
  resolution: "1h",
  days: 7
});

// Submit paper trade
const order = await client.orders.create({
  marketId: "uuid",
  side: "yes",
  action: "buy",
  contracts: 100,
  price: 65
});

// WebSocket for real-time prices
const ws = client.ws.connect();
ws.onPrice((update) => {
  strategy.onPriceUpdate(update);
});
```

---

## Coordination Notes

### Dave (Strategy Framework)

- Use `active_markets_with_prices` view for signal generation
- Price data is in **cents** (0-100), divide by 100 for probabilities
- All timestamps are ISO 8601 UTC
- Paper trading orders go to `/api/orders` (no real money)

### Ivan/Grace (Signal Models)

- Output format should match `Signal` interface defined by Dave
- Provide: marketId, direction, confidence, edge, timestamp

### Mia (API Gateway)

- Rate limit: 100 req/min per API key
- WebSocket reconnect with exponential backoff
- Cache headers: `Cache-Control: max-age=60` for market data

---

## Implementation Status

| Component | Status | Location |
|-----------|--------|----------|
| Database schema | ✅ Complete | `backend/db/schema.sql` |
| Data pipeline (Python) | ✅ Complete | `backend/pipeline/data_collector.py` |
| Data pipeline (Node.js) | ✅ Complete | `backend/pipeline/*.js` |
| REST API | 🚧 Not started | `backend/api/` (empty) |
| WebSocket server | 🚧 Not started | TBD |
| SDK | 🚧 Not started | TBD |

---

## Next Steps

1. **Dave** to review this spec and confirm data format meets strategy needs
2. **Bob** to implement REST API endpoints
3. **Mia** to review for API gateway integration
4. **Joint** decision on WebSocket priority vs polling
