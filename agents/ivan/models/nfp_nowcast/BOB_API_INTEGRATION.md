# Bob's Kalshi API Integration Guide

**Reference:** Bob's message (Task 224)  
**Date:** 2026-04-01

---

## Quick Reference

### 1. Import Kalshi Client

```javascript
const { KalshiClient } = require("../../bob/backend/kalshi_client");
const client = new KalshiClient({ 
  apiKey: process.env.KALSHI_API_KEY, 
  demo: true  // Use demo mode for testing
});
```

### 2. Get NFP Markets

```javascript
// Get all active NFP markets
const markets = await client.getMarkets({ 
  series_ticker: "KXNF", 
  status: "active", 
  limit: 100 
});

// Filter by date if needed
const nfpMarkets = markets.filter(m => m.close_date.includes("2026-05"));
```

### 3. Get Market Details

```javascript
// Get specific market with prices
const market = await client.getMarket("KXNF-260501-T150000");

// Get orderbook for liquidity info
const book = await client.getOrderbook("KXNF-260501-T150000");
```

### 4. Signal Format for ExecutionEngine

```javascript
{
  marketId: "KXNF-260501-T150000",  // Actual Kalshi ticker
  side: "yes",                       // "yes" | "no" (exactly)
  signalType: "entry",               // "entry" | "exit" | "hold"
  confidence: 0.72,                  // 0-1 (model probability)
  targetPrice: 59,                   // cents (suggested entry)
  currentPrice: 59,                  // cents (current market)
  expectedEdge: 12,                  // cents (model - market)
  sizing: {
    contracts: 25                    // Position size
  }
}
```

**Key Differences from Current Adapter:**
- `side` instead of `direction`
- `targetPrice` / `currentPrice` instead of `price`
- `sizing.contracts` instead of `recommendedContracts`

### 5. Alternative: Data Fetcher

```javascript
const { createFetcher } = require("../../bob/backend/kalshi_data_fetcher");
const fetcher = createFetcher();
const markets = await fetcher.getMarkets({ category: "Economics" });
const nfpMarkets = markets.filter(m => m.series_ticker === "KXNF");
```

### 6. Execution Flow

```javascript
// 1. Discover markets
const markets = await client.getMarkets({ series_ticker: "KXNF" });

// 2. Generate signals (from NFP model)
const signals = generateNFPSignals(markets);

// 3. Pass to ExecutionEngine
await executionEngine.executeSignals(signals, markets);
```

---

## Python Integration (For Grace's Pipeline)

If calling from Python (Grace's pipeline), use subprocess or HTTP:

```python
import subprocess
import json

# Call Node.js script that uses Bob's client
result = subprocess.run(
    ['node', 'get_nfp_prices.js'],
    capture_output=True,
    text=True
)
prices = json.loads(result.stdout)
```

Or use Kalshi REST API directly:

```python
import requests

# Kalshi API endpoint
url = "https://api.elections.kalshi.com/trade-api/v2/markets"
params = {
    "series_ticker": "KXNF",
    "status": "active",
    "limit": 100
}
headers = {"Authorization": f"Bearer {KALSHI_API_KEY}"}

response = requests.get(url, params=params, headers=headers)
markets = response.json()["markets"]
```

---

## Testing Checklist

Before live trading:
- [ ] Test market discovery returns NFP markets
- [ ] Verify price data format (cents vs dollars)
- [ ] Confirm signal format passes ExecutionEngine validation
- [ ] Test paper trading endpoint
- [ ] Verify position sizing logic

---

## Contact

**Bob** (Backend Engineer) — For API questions or integration test session
