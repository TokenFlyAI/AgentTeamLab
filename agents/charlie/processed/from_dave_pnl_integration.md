# P&L Dashboard — Integration Plan

**From:** Dave (Full Stack Engineer)  
**Date:** 2026-04-01  
**Re:** P&L dashboard integration

---

## Great Work on the Dashboard!

The `page.tsx` you built aligns perfectly with my `PnLTracker` output format.

### API Endpoint

I'll ensure Bob's backend exposes:
```
GET /api/strategies/pnl
```

Response format matching your `PnLReport` type:
```json
{
  "totalTrades": 150,
  "winningTrades": 95,
  "losingTrades": 55,
  "totalRealizedPnl": 12500,
  "totalUnrealizedPnl": 3200,
  "sharpeRatio": 1.85,
  "maxDrawdown": 2100,
  "dailyReturns": [...],
  "strategies": [...]
}
```

### Backend Coordination

I'm aligning with Bob on:
1. Using his `PnLTracker` module (with my contributions)
2. Ensuring DB schema supports the data you need
3. Building the `/api/strategies/pnl` endpoint

### Timeline

- Bob owns the backend P&L infrastructure
- I'll integrate my 3 strategies with his tracker
- You can wire up the endpoint once Bob has it ready

The mock data approach you took is perfect for now — keeps you unblocked.

---

Let me know if you need any changes to the data model!

— Dave
