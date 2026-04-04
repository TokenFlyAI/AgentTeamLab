# Strategy Framework Summary

**Author:** Bob (Backend Engineer)  
**Task:** #220 — Design trading strategy framework  
**Date:** 2026-04-01  
**Status:** Complete

---

## Overview

The strategy framework provides signal generation, position sizing, and P&L tracking for Kalshi trading strategies. It integrates with the existing PostgreSQL database and REST API server.

## Files Created

```
backend/strategies/
├── signal_engine.js          # Detects mispricings and generates signals
├── position_sizer.js         # Risk management and bet sizing
├── pnl_tracker.js            # Per-strategy P&L tracking
├── strategy_runner.js        # Orchestrates strategy execution
├── cli.js                    # CLI for running strategies manually
├── test_framework.js         # Unit tests for framework logic
├── index.js                  # Module exports
└── strategies/
    ├── mean_reversion.js     # Mean reversion strategy
    └── momentum.js           # Momentum strategy

backend/db/schema_strategies.sql  # Database schema for strategies
```

## Database Schema

New tables added:
- `strategies` — strategy definitions and config
- `strategy_signals` — generated signals with confidence/edge
- `strategy_trades` — trade attribution to strategies
- `strategy_performance` — periodic P&L snapshots

Views added:
- `strategy_summary_view` — quick strategy overview (matches Charlie's dashboard)
- `strategy_positions_view` — open positions per strategy

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/strategies` | GET | List all strategies |
| `/api/strategies` | POST | Create a new strategy |
| `/api/strategies/:id` | GET | Get strategy details |
| `/api/strategies/:id` | PATCH | Update strategy (status, config, etc.) |
| `/api/strategies/:id/signals` | GET | Get strategy signals |
| `/api/strategies/:id/pnl` | GET | Get strategy P&L summary |
| `/api/strategies/:id/performance` | GET | Get performance history |
| `/api/strategies/:id/run` | POST | Manually run a strategy |
| `/api/strategies/run-all` | POST | Run all active strategies |

## Strategy Types

### Mean Reversion
Targets overbought/oversold markets based on z-score deviation from historical mean.

### Momentum
Follows price trends with volume confirmation.

### Arbitrage (in signal engine)
Detects when YES + NO prices don't sum to ~100 cents.

## Position Sizing

Default rules:
- Max 2% account risk per trade (fixed fractional)
- Optional Kelly criterion (quarter Kelly)
- Liquidity cap: max 1% of daily volume
- Max 20% of account in single position
- Strategy-specific `max_position_size` override

## P&L Tracking

Tracks:
- Realized P&L (closed trades)
- Unrealized P&L (open positions)
- Win rate
- Trades today
- Daily/hourly performance snapshots

## CLI Usage

```bash
# Run all active strategies
npm run strategies:run

# Update P&L summaries
npm run strategies:pnl

# Record daily snapshots
npm run strategies:snapshot

# List strategies
npm run strategies:list
```

## Integration with Charlie's Dashboard

The `/api/strategies` endpoint returns data matching Charlie's `Strategy` interface:
- `id`, `name`, `description`, `status`
- `signalStrength` (from `strategy_summary_view`)
- `totalPnl`, `tradesToday`, `winRate`

## Tests

All framework unit tests pass:
- Arbitrage detection
- Mean reversion signal generation
- Momentum signal generation
- Position sizing constraints
- Signal validation
- Signal engine scan + sort

Run tests: `node backend/strategies/test_framework.js`
