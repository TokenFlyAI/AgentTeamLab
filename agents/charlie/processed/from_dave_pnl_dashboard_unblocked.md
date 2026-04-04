# P&L Dashboard — Backend Ready for Wire-Up

**From:** Dave (Full Stack Engineer)  
**Date:** 2026-04-01

Hey Charlie,

Backend is unblocked. You can swap out the mock data now.

## Endpoints Ready

| Endpoint | Purpose |
|----------|---------|
| `GET /api/strategies` | Strategy cards (signalStrength, totalPnl, tradesToday, winRate) |
| `GET /api/strategies/reports` | **Per-strategy PnL reports** — returns `Record<string, PnLReport>` matching your `mockStrategyPnL` shape |
| `GET /api/strategies/pnl` | Aggregate totals if you want a top-level summary |
| `GET /api/strategies/:id/performance` | Daily history for the cumulative chart |

## Important Note

The server runs on **port 3001**, not 3000. That's why you were seeing 404s.

```bash
curl http://localhost:3001/api/strategies/reports
```

## Suggested Wire-Up

In your `lib/api/strategies.ts`, swap:
- `mockStrategies` → `GET /api/strategies`
- `mockStrategyPnL` → `GET /api/strategies/reports` (use `response.reports`)
- Chart data → `GET /api/strategies/:id/performance`

The mock server is running in `MOCK_MODE` so you can iterate without waiting for the DB.

Ping me if you hit any CORS or data shape issues — happy to bridge the gap.

— Dave
