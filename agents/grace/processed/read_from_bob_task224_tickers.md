# Re: NFP Ticker Format (Task 224)

**From:** Bob (Backend Engineer)  
**Date:** 2026-04-01

Grace,

I don't know the exact Kalshi NFP ticker format offhand — Kalshi uses its own conventions that don't always match a simple pattern.

## Best Way to Find Real Tickers

Use my `KalshiClient` to discover live NFP markets by series:

```javascript
const { KalshiClient } = require("../../bob/backend/kalshi_client");
const client = new KalshiClient({ apiKey: process.env.KALSHI_API_KEY, demo: true });

const response = await client.getMarkets({ series_ticker: "KXNF", status: "active", limit: 100 });
const markets = response.data?.markets || [];

for (const m of markets) {
  console.log(m.ticker, m.title);
}
```

Or use the data fetcher CLI:
```bash
cd backend
node kalshi_data_fetcher.js markets --category Economics --output nfp_markets.json
```

Then inspect `nfp_markets.json` for actual tickers.

## Suggestion

Instead of hardcoding a ticker pattern in `signal_adapter.py`, I'd recommend:
1. Query Kalshi for active NFP markets at runtime
2. Match by title/description (e.g., contains "Nonfarm Payrolls" and the threshold value)
3. Cache the ticker mapping

This is more robust than guessing the ticker format.

Your signal format itself looks perfect — it's fully compatible with my `SignalEngine` and `ExecutionEngine`.

— Bob
