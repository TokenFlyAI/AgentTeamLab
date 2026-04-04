# Task 220 — Strategy Framework Backend Summary

**Author:** Bob (Backend Engineer)  
**Date:** 2026-04-01  
**Status:** Core infrastructure complete

---

## Overview
Complete backend infrastructure for the trading strategy framework. Provides signal generation, position sizing, P&L tracking, and REST API endpoints for strategy management.

---

## Components Delivered

### 1. Signal Generation (`strategies/signal_engine.js`)
- **Arbitrage detection:** Identifies mispricings where yes+no ≠ 100
- **Mean reversion:** Z-score based signals for overbought/oversold markets
- **Signal validation:** Confidence thresholds, edge minimums, side validation
- **Batch processing:** Scan 500+ markets efficiently

### 2. Position Sizing (`strategies/position_sizer.js`)
- **Fixed fractional:** Default 2% risk per trade
- **Kelly criterion:** Optional fractional Kelly (quarter Kelly default)
- **Liquidity caps:** Max 1% of daily volume
- **Position limits:** Max 20% of portfolio in single position
- **Confidence scaling:** Size adjusted by signal confidence

### 3. P&L Tracking (`strategies/pnl_tracker.js`)
- **Realized P&L:** From closed trades
- **Unrealized P&L:** From open positions
- **Win rate:** Trade-level statistics
- **Performance snapshots:** Hourly/daily/weekly aggregation
- **Time-series history:** For charting and analysis

### 4. Strategy Runner (`strategies/strategy_runner.js`)
- **Orchestration:** Load active strategies → fetch markets → generate signals → size positions → persist
- **Database integration:** Persists signals, updates performance
- **Error handling:** Per-strategy isolation (one failure doesn't stop others)
- **Batch execution:** Run all active strategies in one call

### 5. Database Schema (added to `db/schema.sql`)
```
strategies              # Strategy registry with config and risk params
strategy_signals        # Generated signals with status tracking
strategy_positions      # Position attribution to strategies
strategy_trades         # Trade attribution for P&L tracking
strategy_performance    # Time-series performance metrics
strategy_runs           # Execution log
```

Plus views: `strategy_positions_view`, `active_signals_view`, `strategy_summary_view`

### 6. REST API Endpoints (in `api/server.js`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/strategies` | GET | List all strategies |
| `/api/strategies` | POST | Create new strategy |
| `/api/strategies/:id` | GET | Get strategy details |
| `/api/strategies/:id` | PATCH | Update strategy (status, config) |
| `/api/strategies/:id/signals` | GET | Get strategy signals |
| `/api/strategies/:id/pnl` | GET | Get current P&L |
| `/api/strategies/:id/performance` | GET | Get performance history |
| `/api/strategies/:id/run` | POST | Manually run a strategy |
| `/api/strategies/run-all` | POST | Run all active strategies |

### 7. Example Strategies
- **Mean Reversion:** Z-score based, targets overbought/oversold
- **Momentum:** Volume + price change based trend following

---

## Integration with Dave's Framework

Dave (Full Stack) is building the strategy implementations layer. Two integration options:

### Option A: Direct Module Import (Recommended for performance)
```javascript
const { SignalEngine, PositionSizer, StrategyRunner } = require('../bob/backend/strategies');
```

### Option B: REST API (Recommended for decoupling)
Dave's `StrategyClient` already targets these endpoints:
- `GET /api/markets` — market data
- `GET /api/portfolio` — portfolio state
- `POST /api/orders` — paper trading

---

## Usage Example

```javascript
const { StrategyRunner, MeanReversionStrategy } = require('./backend/strategies');

const runner = new StrategyRunner({ pool });
runner.register('mean_reversion', new MeanReversionStrategy());

// Run all active strategies
const results = await runner.runAll();
console.log(results);
```

---

## Files Location
```
agents/bob/backend/
├── strategies/
│   ├── signal_engine.js
│   ├── position_sizer.js
│   ├── pnl_tracker.js
│   ├── strategy_runner.js
│   ├── index.js
│   ├── strategies/
│   │   ├── mean_reversion.js
│   │   └── momentum.js
│   └── cli.js
├── db/schema.sql          # Strategy tables appended
└── api/server.js          # Strategy endpoints added
```

---

## Next Steps
1. Dave to decide integration approach (modules vs REST)
2. Charlie to wire dashboard to strategy APIs
3. Integration testing end-to-end
