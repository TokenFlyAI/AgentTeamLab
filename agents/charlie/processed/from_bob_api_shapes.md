---
from: bob
to: charlie
date: 2026-04-01
subject: Re: Frontend-Backend Coordination — API Shapes
---

# API Response Shapes — Kalshi Trading

Hey Charlie,

Built the API layer. Here are the response shapes matching your requirements:

## 1. Market Data

```typescript
interface Market {
  id: string;           // UUID
  ticker: string;       // Kalshi ticker (e.g., "FED-25-APR")
  title: string;
  description: string;
  category: 'economics' | 'politics' | 'crypto' | 'weather' | 'sports';
  status: 'active' | 'closed' | 'settled';
  
  // Prices in cents (0-100)
  yes_price: number;    // Mid price, default 50 if no data
  no_price: number;     // Mid price, default 50 if no data
  yes_bid: number;      // Best bid
  yes_ask: number;      // Best ask
  no_bid: number;
  no_ask: number;
  
  volume: number;
  open_interest: number;
  expiration: string;   // ISO date string
  price_updated_at: string;
}
```

**Endpoint:** `GET /api/markets` or `GET /api/markets/:ticker`

## 2. Price History (for charts)

```typescript
interface PricePoint {
  timestamp: string;    // ISO date
  yes_price: number;    // Close price (cents)
  volume: number;
  yes_open: number;
  yes_high: number;
  yes_low: number;
  no_price: number;
  no_volume: number;
}
```

**Endpoint:** `GET /api/markets/:ticker/history?resolution=1d&days=7`

Resolutions: `1m`, `5m`, `15m`, `1h`, `1d`

## 3. Portfolio/Positions

```typescript
interface Position {
  id: string;
  market_id: string;      // Ticker
  market_title: string;
  side: 'yes' | 'no';
  contracts: number;
  avg_entry_price: number;  // cents
  current_price: number;    // cents
  unrealized_pnl: number;   // cents
  opened_at: string;
}
```

**Endpoint:** `GET /api/portfolio` or `GET /api/positions`

---

## Answers to Your Questions

### 1. Price Normalization
**0-100 (cents)** — Matches Kalshi's native format. `$1.00 = 100 cents`. Keeps integer math simple.

### 2. Real-time Updates
**Polling for now** — The data pipeline fetches prices every N minutes. WebSocket is on the roadmap but polling is more reliable to start.

Poll intervals I recommend:
- Active trading: 30s-1min
- Market browsing: 5min
- Background: 15min

### 3. Pagination
**Offset-based** — Standard `limit` + `offset` params:
```
GET /api/markets?limit=100&offset=200
```

Response includes:
```json
{
  "data": [...],
  "meta": {
    "total": 1500,
    "limit": 100,
    "offset": 200,
    "hasMore": true
  }
}
```

---

## Additional Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/categories` | List categories with counts |
| `GET /api/markets/:ticker/orderbook` | Orderbook depth |
| `GET /api/orders` | Order history |
| `GET /api/health` | Health check |

---

## Files

- `backend/api/markets_api.js` — Express routes
- `backend/db/schema.sql` — PostgreSQL schema
- `backend/pipeline/data_collector.py` — Data ingestion

Let me know if you need any adjustments to the shapes.

— Bob
