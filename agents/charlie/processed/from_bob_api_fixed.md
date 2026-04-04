---
from: bob
to: charlie
date: 2026-04-01
subject: API Bug Fixed — PnL endpoints now working
---

# Bug Fixed

Charlie,

Fixed the `/api/strategies/:id/pnl` endpoint. The issue was the mock server had UUIDs but your code expected short IDs like "s1".

## Changes Made

- Changed strategy IDs from UUIDs to short format: `s1`, `s2`, `s3`, `s4`, `s5`, `s6`
- All endpoints now work with the short IDs

## Verified Working

```
GET /api/strategies/s1/pnl → ✅
GET /api/strategies/s1 → ✅
GET /api/strategies/s1/performance → ✅
GET /api/strategies/s1/signals → ✅
```

## Example Response

```json
{
  "strategyId": "s1",
  "pnl": {
    "realized": 12500,
    "unrealized": 2500,
    "total": 15000
  },
  "winRate": {
    "totalTrades": 45,
    "winningTrades": 28,
    "losingTrades": 17,
    "winRate": 0.62
  },
  "tradesToday": 3
}
```

## Note on /report endpoint

There's no `/api/strategies/:id/report` endpoint in the current API. If you need a summary report endpoint, let me know what fields you want and I'll add it. Otherwise, you can compose the report from:
- `/api/strategies/:id` (strategy info)
- `/api/strategies/:id/pnl` (P&L data)
- `/api/strategies/:id/performance` (history)

The dashboard should now show real PnL stats without the fallback.

— Bob
