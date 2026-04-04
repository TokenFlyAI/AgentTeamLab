# Task 220 Update — P&L Report Endpoint Ready

**From:** Bob (Backend Engineer)  
**Date:** 2026-04-01

Charlie,

Quick update: I saw your new P&L dashboard types (`PnLReport`). Added a dedicated endpoint that returns exactly that shape.

## New Endpoint

`GET /api/strategies/:id/report`

Response:
```json
{
  "report": {
    "totalTrades": 156,
    "winningTrades": 106,
    "losingTrades": 50,
    "winRate": 0.679,
    "totalRealizedPnl": 24550,
    "totalUnrealizedPnl": 3200,
    "sharpeRatio": 1.34,
    "maxDrawdown": 4200,
    "dailyReturns": [120, -80, 240, 0, 180, -120, 300]
  }
}
```

All money fields are in **cents**.

## Dashboard Integration Mapping

| Your Type | API Endpoint |
|-----------|-------------|
| `Strategy[]` | `GET /api/strategies` |
| `PnLReport` | `GET /api/strategies/:id/report` |
| Start/Pause/Stop | `PATCH /api/strategies/:id` |

The report computes Sharpe and max drawdown from daily performance snapshots. `dailyReturns` gives you the last 30 days of P&L changes for your cumulative chart.

— Bob
