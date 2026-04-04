# Trading Strategy Framework — Design Document

**Author:** Dave (Full Stack Engineer)  
**Date:** 2026-04-01  
**Task:** 220  
**Status:** Phase 1 & 2 — Design & Core Implementation Complete

---

## 1. Overview

A modular, layer-based framework for generating signals, sizing positions, managing risk, and tracking P&L for Kalshi prediction-market trading.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Strategy Runner                          │
│  (orchestrates: fetch data → generate signals → execute)    │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Data Client  │    │   Strategy    │    │  Risk / Sizing│
│  (Bob's API)  │    │  (plug-in)    │    │   Engine      │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌───────────────┐
                    │  Order Client │
                    │ (paper trade) │
                    └───────────────┘
                              │
                              ▼
                    ┌───────────────┐
                    │  P&L Tracker  │
                    └───────────────┘
```

---

## 3. Core Interfaces

### 3.1 Signal

```javascript
{
  marketId: string,
  direction: "buy_yes" | "sell_yes" | "buy_no" | "sell_no",
  confidence: number,   // 0-1
  edge: number,         // in cents (0-100)
  price: number,        // current price in cents
  strategy: string,
  timestamp: Date,
  metadata?: object
}
```

### 3.2 Strategy (Base Class)

```javascript
class BaseStrategy {
  name: string
  generateSignals(marketData) => Signal[]
  processSignal(signal) => Order | null
  updatePrice(marketId, price)
  getPerformance() => StrategyPerformance
}
```

### 3.3 Portfolio (from API)

```javascript
{
  cash: number,        // cents
  totalValue: number,  // cents
  dailyPnl: number     // cents
}
```

---

## 4. File Layout

```
backend/strategies/
├── index.js                 # Core framework (BaseStrategy, PositionSizer, PnLTracker, StrategyManager, 3 built-in strategies)
├── client.js                # StrategyClient — wrapper around Bob's REST API
├── risk-manager.js          # RiskManager — enforces guardrails
├── mean-reversion-strategy.js # MeanReversion strategy extending BaseStrategy
├── runner.js                # StrategyRunner — orchestrates the full pipeline
├── report.js                # CLI to generate P&L reports
├── mock-server.js           # Lightweight mock API for local E2E testing
└── test.js                  # Smoke tests
```

---

## 5. Modules

### 5.1 API Client (`client.js`)
- Wraps Bob's REST API
- Handles response unwrapping (`{ markets: [...] }` → `[...]`)
- Normalizes price fields (`yes_bid`, `yes_ask`, `yes_mid`, `implied_probability`)

### 5.2 Position Sizer (in `index.js`)
- **Kelly Criterion** with quarter-Kelly safety cap
- **Fixed fractional** as simpler alternative
- Hard caps: `maxContracts`, `maxPositionPct` of portfolio

### 5.3 Risk Manager (`risk-manager.js`)
Enforces guardrails:
- Minimum confidence & edge thresholds
- Max daily loss limit
- Cooldown per market
- Max exposure per market

### 5.4 P&L Tracker (in `index.js`)
- Tracks open/closed positions
- Computes realized & unrealized P&L
- Calculates Sharpe ratio, win rate, max drawdown
- Emits events for position open/close

### 5.5 Strategy Runner (`runner.js`)
- Fetches active markets + portfolio
- Runs all registered strategies
- Applies risk checks
- Submits paper orders via API client
- Records positions in P&L tracker

---

## 6. Built-in Strategies

| Strategy | File | Logic |
|----------|------|-------|
| Longshot Fading | `index.js` | Sells YES contracts 5¢-20¢ in niche categories |
| Economic Momentum | `index.js` | Trades forecast-vs-implied divergence in Economics |
| Arbitrage | `index.js` | Exploits cross-platform price spreads |
| **Mean Reversion** | `mean-reversion-strategy.js` | Trades toward 0.50 when price > 0.80 or < 0.20 |

---

## 7. Example Strategy: Mean Reversion

**Logic:**
- If `impliedProbability > 0.80`, signal `sell_yes` (buy NO, revert to 0.50)
- If `impliedProbability < 0.20`, signal `buy_yes` (revert to 0.50)
- Confidence scales with distance from 0.50

**Position sizing:**
- Uses Kelly criterion via `BaseStrategy.processSignal()`

---

## 8. Integration Points

| Layer | Owner | Interface |
|-------|-------|-----------|
| Market data | Bob / Mia | REST API (`/api/markets`, `/api/portfolio`, `/api/orders`) |
| Signal models | Ivan / Grace | Output `Signal`-compatible objects |
| Order execution | Bob | `POST /api/orders` |
| Deployment | Eve | Node.js module, runs as cron or service |

---

## 9. Testing

A mock API server (`mock-server.js`) provides realistic market data for local E2E validation. Smoke test results:

```
Markets fetched: 2
Signals generated from mock data: 2
Runner: processed 2 markets, submitted 1 orders
=== All tests passed ===
```

---

## 10. Success Criteria

- [x] Design documented
- [x] Core modules implemented and unit-tested (smoke test)
- [x] Mean-reversion strategy generates signals and submits paper orders
- [ ] P&L tracking dashboard/report (CLI script ready, needs live data)
- [ ] Paper-trade integration against Bob's live API (pending API server)

---

## 11. Next Steps

1. Coordinate with Bob on getting his API server running (port 3000 currently occupied)
2. Run E2E test against live API with real market data
3. Build a simple HTML/CLI dashboard for daily P&L reports
4. Integrate Ivan/Grace signal models into the runner
