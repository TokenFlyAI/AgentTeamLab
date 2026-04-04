# Sprint 8 — Win Rate Validation Framework

**Date:** 2026-04-03  
**Lead:** Alice (T347)  
**Audience:** Dave (T346), Bob (validation), Ivan (parameter tuning)

---

## Purpose

Define how we validate that the Kalshi arbitrage pipeline (Phases 1-4) achieves >40% win rate on paper trading, before proceeding to live trading (Week 12).

---

## Validation Strategy

### Phase 1: Baseline Establishment (Paper Trade — Mock Data)
**Input:** `agents/public/correlation_pairs.json` (6 arbitrage opportunities identified)

**Test:** Run paper trading on mock Kalshi markets with Phase 4 execution engine (once Dave completes T346 design).

**Metric:** Calculate paper trade win rate on 6 identified arbitrage pairs.

```
win_rate = trades_won / total_trades
target: >= 40% (currently at 30% on naive strategies)
```

**Deliverable:** Paper trade results with per-market breakdown.

---

### Phase 2: Real Data Validation (Paper Trade — Kalshi API)
**Blocker:** T236 (Kalshi API credentials from Founder — required to unlock real market data)

**Once T236 delivered:**
1. Fetch real market history from Kalshi API
2. Backtest Phase 4 engine on real data
3. Calculate realistic win rate (corrected for slippage, order latency)
4. Compare vs mock data baseline

**Metric:**
```
real_data_win_rate >= 40% (target)
slippage_cost < 2% (acceptable friction)
latency_sensitivity < 5% (engine robustness to delays)
```

**Deliverable:** Backtest report with real data validation.

---

### Phase 3: Live Paper Trading (Kalshi API, Paper Mode)
**Precondition:** Real data win rate >= 35% (allow 5pp margin for live noise)

**Test:** Submit paper orders to live Kalshi market feed.

**Metrics:**
- 200+ trades over 2-4 weeks (statistical power)
- Win rate consistency (no variance >10pp week-to-week)
- Per-market breakdown (all clusters performing)
- Slippage in live environment
- Order fill rates

**Deliverable:** Live paper trade results + acceptance criteria checklist.

---

### Phase 4: Go/No-Go Decision
**Criteria for live trading:**

| Metric | Threshold | Status |
|--------|-----------|--------|
| Paper trade win rate | ≥ 40% | TBD (awaiting Phase 1) |
| Win rate consistency | CV < 10% | TBD |
| Slippage | < 3% | TBD |
| Order fill rate | ≥ 95% | TBD |
| Execution latency | < 500ms | TBD |
| Risk controls tested | ✓ | TBD |
| Fund allocation | ≤ $100k initial | TBD |

**Decision Gate:** All criteria passing → Founder approval (D004) → Go live (Week 12)

---

## Technical Setup

### Test Environment

**Mock Data Pipeline:**
```
Phase 1: markets_filtered.json → Phase 2: market_clusters.json
         → Phase 3: correlation_pairs.json
         → Phase 4 (Dave): execution_engine_design.md + skeleton.cpp
         → Paper trade simulator (Tina/Frank)
```

**Real Data Pipeline (Post-T236):**
```
Kalshi API credentials (T236)
  → Fetch /markets endpoint (all markets, live prices)
  → Fetch /order_book endpoint (order depth, spreads)
  → Fetch /historical_prices endpoint (OHLCV, 5-min bars)
  → Backtest Phase 4 engine on real history
  → Generate realistic performance metrics
```

**Live Paper Trading:**
```
Kalshi API credentials (T236)
  → Phase 4 engine connects to live market feed
  → Submit paper orders (no real capital)
  → Track fills, slippage, P&L in real-time
  → Store live_paper_trades.db (historical record)
  → Report win rate + market-by-market breakdown
```

---

## Win Rate Calculation

**Definition:**
```
win_rate = trades_closed_profitably / total_trades_closed

Where:
  - trades_closed_profitably = spread closes < 0 (bought low, sold high)
  - total_trades_closed = all entries + exits completed
```

**Edge Cases:**
- Unfilled orders (order_status = "pending") → exclude from win rate (not closed)
- Partial fills → count as 1 trade (avg fill price)
- Same-market pairs → count each leg (buy A, sell B = 2 sides, 1 trade)
- Multi-leg arbitrage → count as 1 trade (all legs must close for "win")

**Example Calculation:**
```
Arbitrage pair: SP500-5000 ↔ NASDAQ-ALLTIME
  Entry:
    - Buy 100 shares SP500-5000 @ $64.2 (expected: $66.8)
    - Sell 100 shares NASDAQ-ALLTIME @ $62.1 (expected: $60.2)
  Exit (30 min later):
    - Close SP500-5000 @ $65.8 (profit: $160)
    - Close NASDAQ-ALLTIME @ $61.3 (profit: $80)
  Result: Win (total spread closed from -2.6% → +0.4%)
```

---

## Reporting

### After Each Phase Completion

**Phase 1 (Mock Paper Trade):**
- Win rate on 6 identified arbitrage pairs
- Per-pair breakdown (which pairs trade well, which underperform)
- Execution latency distribution
- Slippage analysis

**Phase 2 (Real Data Backtest):**
- Backtest win rate on 12+ months of real Kalshi history
- Forward-test on recent data (last 30 days) — OOS validation
- Parameter sensitivity analysis (how robust is 40% to +/-5% parameter changes?)
- Confidence interval (95% CI around win rate estimate)

**Phase 3 (Live Paper Trade):**
- Weekly win rate + CI
- Cumulative P&L + Sharpe ratio
- Draw-down analysis (max consecutive losses)
- Market exposure (which clusters trading most, which dormant)
- Slippage vs mock data (is live worse?)

---

## Timeline (Dependent on T236)

```
Sprint 8 (NOW):
  - Phase 1-3 complete ✅
  - Phase 4 design (Dave) in progress
  - This framework created ✅

Sprint 9:
  - Phase 4 full implementation (Dave + Charlie)
  - Phase 1 mock paper trading (Alice, Tina, Frank)
  - Integration tests (Alice)

Sprint 10:
  - Real data validation (requires T236)
  - Parameter tuning based on real data (Ivan)
  - Live paper trading setup (Bob, Grace)

Sprint 11:
  - Live paper trading execution (200+ trades)
  - Go/no-go evaluation

Week 12+:
  - Founder decision + live trading launch
```

---

## Success Criteria (Go-Live Gate)

✅ **Phase 1-3 pipeline:** Complete + validated  
✅ **Phase 4 engine:** Designed + skeleton implemented  
✅ **Paper win rate:** ≥ 40% (3+ weeks of data)  
✅ **Consistency:** Weekly win rate CV < 10%  
✅ **Risk controls:** All limits enforced + tested  
✅ **Founder approval:** D004 signed off  

**Then:** Go live with initial $100k capital allocation.

---

*Prepared by Alice, Lead Coordinator — T347*
