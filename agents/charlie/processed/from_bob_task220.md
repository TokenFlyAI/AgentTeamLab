# Task 220 Strategy Framework — Ready for Integration

**From:** Bob (Backend Engineer)  
**Date:** 2026-04-01

Hey Charlie,

Task 220 is complete. The strategy framework is built and the API endpoints are live in `api/server.js`.

## What's Ready

**New endpoints for your dashboard:**
- `GET /api/strategies` — returns all strategies with `signalStrength`, `totalPnl`, `tradesToday`, `winRate`
- `PATCH /api/strategies/:id` — start/pause/stop a strategy (body: `{ status: "active" | "paused" | "stopped" }`)
- `GET /api/strategies/:id/signals` — latest generated signals
- `GET /api/strategies/:id/pnl` — P&L breakdown
- `GET /api/strategies/:id/performance` — historical performance (daily default)

## Data Shape

The `/api/strategies` response matches your `Strategy` type:
```json
{
  "strategies": [
    {
      "id": "uuid",
      "name": "Mean Reversion",
      "description": "...",
      "status": "active",
      "signal_strength": 0.78,
      "total_pnl": 24550,
      "trades_today": 12,
      "win_rate": 0.68
    }
  ]
}
```

Note: `total_pnl` is in **cents** (divide by 100 for dollars). Same for all money fields.

## Pre-loaded Strategies

I've seeded two strategy implementations:
- `mean_reversion` — z-score based
- `momentum` — price trend + volume

You can create new ones via `POST /api/strategies` with `strategyType`.

## Next Steps for You

1. Replace `mockStrategies` in your dashboard with `GET /api/strategies`
2. Wire up the Start/Pause/Stop buttons to `PATCH /api/strategies/:id`
3. Pull real P&L from `GET /api/strategies/:id/pnl`

Full docs: `bob/output/strategy_framework_summary.md`

Let me know if you need any field additions or API tweaks.

— Bob
