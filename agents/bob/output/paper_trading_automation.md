# Paper Trading Automation — Task 323

**Author:** Bob (Backend Engineer)  
**Date:** 2026-04-03  
**Status:** ✅ Complete

---

## Overview

This deliverable implements automated paper trading with scheduled runs and persistent P&L tracking as requested in Sprint 4, Task 323.

---

## Changes Made

### 1. Scheduler Integration (`backend/pipeline/scheduler.js`)

Added `live_runner` job to the existing pipeline scheduler:

```javascript
{
  name: "live_runner",
  script: path.join(__dirname, "../strategies/live_runner.js"),
  type: "node",
  intervalMs: 15 * 60 * 1000, // 15 minutes
  retryAttempts: 2,
  retryDelayMs: 10000,
  env: { ...process.env, PAPER_TRADING: "true" }, // Force paper trading mode
}
```

**Key points:**
- Runs every 15 minutes (configurable)
- Forces `PAPER_TRADING=true` environment variable
- Prevents accidental live execution
- Integrates with existing retry logic

### 2. Persistent Paper Trades Database (`backend/paper_trades_db.js`)

Created a JSON-based persistence layer for paper trades with the following schema:

```javascript
{
  id: string,              // Unique trade ID
  timestamp: string,       // ISO timestamp
  market: string,          // Market ticker
  signal_type: string,     // Strategy name (mean_reversion, etc.)
  confidence: number,      // Signal confidence (0-1)
  direction: string,       // 'YES' or 'NO'
  contracts: number,       // Number of contracts
  entry_price: number,     // Entry price in cents
  exit_price: number,      // Exit price (when closed)
  status: string,          // 'OPEN', 'CLOSED', 'CANCELLED'
  pnl: number,             // Realized P&L in cents
  outcome: string,         // 'WIN', 'LOSS', 'BREAKEVEN', 'PENDING'
  created_at: string,      // Creation timestamp
  updated_at: string,      // Last update timestamp
  metadata: object         // Additional trade data
}
```

**Storage location:** `output/paper_trades.db`

**API Methods:**
- `recordTrade(trade)` - Record a new paper trade
- `updateTrade(id, updates)` - Update an existing trade
- `closeTrade(id, exitPrice, pnl)` - Close a trade with P&L
- `getTrades(filters)` - Get trades with filtering
- `getSummary()` - Get P&L statistics

### 3. Live Runner Integration (`backend/strategies/live_runner.js`)

Updated to persist trades to the database when executing in paper trading mode:

```javascript
// Persist trades to database (T323)
const persistedTrades = [];
for (const s of approvedSignals) {
  const tradeRecord = paperTradesDB.recordTrade({
    timestamp: new Date().toISOString(),
    market: s.ticker || s.marketId,
    signal_type: s.strategy,
    confidence: s.confidence,
    direction: s.side?.toUpperCase(),
    contracts: s.sizing?.contracts || 1,
    entry_price: s.currentPrice,
    status: "OPEN",
    outcome: "PENDING",
    metadata: { targetPrice, expectedEdge, reason },
  });
  persistedTrades.push(tradeRecord);
}
```

### 4. Dashboard API Endpoints (`backend/dashboard_api.js`)

#### GET `/api/paper-trades/summary`

Returns paper trading P&L summary:

```json
{
  "success": true,
  "timestamp": "2026-04-03T18:30:00.000Z",
  "win_rate": 0.857,
  "total_pnl": -13.73,
  "trade_count": 19,
  "closed_trades": 15,
  "open_trades": 4,
  "wins": 13,
  "losses": 2,
  "last_updated": "2026-04-03T18:15:00.000Z",
  "by_strategy": {
    "mean_reversion": {
      "trades": 15,
      "wins": 13,
      "losses": 2,
      "pnl": -8.50
    }
  }
}
```

#### GET `/api/paper-trades`

Returns all paper trades with optional filtering:

**Query Parameters:**
- `market` - Filter by market ticker
- `strategy` - Filter by signal type
- `status` - Filter by trade status (OPEN, CLOSED, CANCELLED)
- `outcome` - Filter by outcome (WIN, LOSS, PENDING)
- `since` - Filter by date (ISO string)

**Response:**

```json
{
  "success": true,
  "timestamp": "2026-04-03T18:30:00.000Z",
  "count": 19,
  "summary": {
    "win_rate": 0.857,
    "total_pnl": -13.73,
    "trade_count": 19
  },
  "trades": [...]
}
```

---

## Running the Automation

### Option 1: Using the Pipeline Scheduler (Recommended)

```bash
# Start the scheduler daemon
node backend/pipeline/scheduler.js daemon

# Or run live_runner once for testing
node backend/pipeline/scheduler.js run live_runner
```

### Option 2: Manual Execution

```bash
# Run with paper trading enabled
PAPER_TRADING=true node backend/strategies/live_runner.js --execute
```

### Option 3: Docker

```bash
# Build and run scheduler container
docker build -f backend/Dockerfile.scheduler -t kalshi-scheduler .
docker run -e PAPER_TRADING=true kalshi-scheduler
```

---

## Testing

### Test the API endpoints:

```bash
# Get paper trading summary
curl http://localhost:3200/api/paper-trades/summary

# Get all trades
curl http://localhost:3200/api/paper-trades

# Filter by strategy
curl "http://localhost:3200/api/paper-trades?strategy=mean_reversion"

# Filter by status
curl "http://localhost:3200/api/paper-trades?status=OPEN"
```

### Test the scheduler:

```bash
# Run live_runner once via scheduler
node backend/pipeline/scheduler.js run live_runner

# Check the database
cat output/paper_trades.db | jq
```

---

## Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `backend/pipeline/scheduler.js` | Modified | Added live_runner job (15-min interval) |
| `backend/paper_trades_db.js` | Created | Persistent paper trades database |
| `backend/strategies/live_runner.js` | Modified | Persist trades to DB in paper mode |
| `backend/dashboard_api.js` | Modified | Added /api/paper-trades/* endpoints |
| `output/paper_trading_automation.md` | Created | This documentation |

---

## Next Steps

1. **Trade Resolution:** Implement automatic trade closing when markets settle
2. **PnL Calculation:** Add realized P&L based on actual market outcomes
3. **Alerting:** Add notifications when win rate drops below threshold
4. **Upgrade to SQLite:** If trade volume grows, migrate from JSON to SQLite

---

## Compliance Notes

- ✅ Paper trading mode enforced (PAPER_TRADING=true)
- ✅ Risk manager validation before trade execution
- ✅ Confidence threshold at 0.80 (per consensus.md)
- ✅ Only mean_reversion strategy enabled (per Sprint 4 optimization)
- ✅ All trades persisted with audit trail
