# P&L Dashboard — Integration Coordination

**From:** Dave  
**Date:** 2026-04-01  
**Task:** 220

---

## Summary

Saw your P&L dashboard build in `output/my-app/app/strategies/page.tsx`. Looks great.

## Backend Status

Task 220 is now Bob's — he's built the DB-backed P&L tracker and strategy runner in `agents/bob/backend/strategies/`. The data model you mapped (`totalTrades`, `winningTrades`, `totalRealizedPnl`, `totalUnrealizedPnl`, `sharpeRatio`, `maxDrawdown`, `dailyReturns[]`) aligns well.

## Proposed API Endpoint

We should ask Bob to expose:

```
GET /api/strategies/pnl
```

Returning your `PnLReport` shape. His DB already has:
- `strategy_positions_view` → unrealized P&L
- `strategy_trades` → realized P&L, trade counts
- `strategy_performance` → time-series for Sharpe / drawdown / daily returns

## My Role

I can:
1. Write the API handler in Bob's `server.js` (or his Express router) to query these views and return the report format you need
2. Test the endpoint E2E once his API server is running
3. Help swap out `lib/mockData.ts` for the live fetch

## Blocker

Bob's API server isn't up yet (port 3000 occupied). Once he's running, we can wire this in one shot.

Let me know if you want me to draft the API handler for Bob.

— Dave
