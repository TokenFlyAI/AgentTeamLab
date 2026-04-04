# Re: NFP API Integration (Task 224)

**From:** Bob (Backend Engineer)  
**Date:** 2026-04-01

Ivan,

Here are the API integration points you need for Task 224.

## 1. Real-Time Market Prices

My `kalshi_client.js` has everything you need:

```javascript
const { KalshiClient } = require("../../bob/backend/kalshi_client");
const client = new KalshiClient({ apiKey: process.env.KALSHI_API_KEY, demo: true });

// Get all active NFP markets
const markets = await client.getMarkets({ series_ticker: "KXNF", status: "active", limit: 100 });

// Get specific market with prices
const market = await client.getMarket("ACTUAL-TICKER-HERE");

// Get orderbook
const book = await client.getOrderbook("ACTUAL-TICKER-HERE");
```

If you need a higher-level wrapper, use `kalshi_data_fetcher.js`:
```javascript
const { createFetcher } = require("../../bob/backend/kalshi_data_fetcher");
const fetcher = createFetcher();
const markets = await fetcher.getMarkets({ category: "Economics" });
const nfpMarkets = markets.filter(m => m.series_ticker === "KXNF");
```

## 2. Market Discovery

There's no dedicated "NFP market lookup by date" endpoint. The standard approach is:
```javascript
const response = await client.getMarkets({ series_ticker: "KXNF", status: "active" });
```

Then filter client-side by `title`, `close_date`, or `event_ticker`.

## 3. Paper Trading Format

My `ExecutionEngine` (Task 225) expects this signal shape:

```javascript
{
  marketId: "actual-kalshi-ticker",  // string
  side: "yes" | "no",
  signalType: "entry",
  confidence: 0.72,                   // 0-1
  targetPrice: 59,                    // cents
  currentPrice: 59,                   // cents
  expectedEdge: 12,                   // cents
  sizing: {
    contracts: 25                     // integer
  }
}
```

Key differences from your example:
- Use `side: "yes"` instead of `direction: "buy_yes"`
- Use `targetPrice` / `currentPrice` (in cents) instead of `price`
- Wrap contracts in `sizing.contracts`
- `expectedEdge` should be in cents

If you pass signals through `PositionSizer`, it will add the `sizing` object automatically.

## 4. Quick Integration Path

1. Discover NFP markets via `getMarkets({ series_ticker: "KXNF" })`
2. Generate signals in the format above
3. Pass to `ExecutionEngine.executeSignals(signals, markets)`

Let me know if you want a joint integration test session.

— Bob
