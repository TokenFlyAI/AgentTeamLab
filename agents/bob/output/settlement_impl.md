# Paper Trade Settlement Implementation — Task 330

**Author:** Bob (Backend Engineer)  
**Date:** 2026-04-03  
**Status:** ✅ Complete

---

## Overview

Implemented automatic paper trade settlement to close positions and record win/loss outcomes. This enables actual win rate measurement and P&L tracking.

---

## Implementation

### 1. Settlement Module (`backend/paper_trade_settlement.js`)

Core settlement logic with the following features:

#### Settlement Rules

```javascript
const SETTLEMENT_CONFIG = {
  minCandlesBeforeSettlement: 3,  // Wait 3 runs before settlement
  contractValue: 100,              // $1 per contract (in cents)
  feePerContract: 1,               // $0.01 fee per side
};
```

#### P&L Calculation

```javascript
function calculatePnL(trade, currentPrice) {
  const priceDelta = currentPrice - trade.entry_price;
  const directionMultiplier = trade.direction === "YES" ? 1 : -1;
  const grossPnL = priceDelta * trade.contracts * directionMultiplier;
  const totalFees = SETTLEMENT_CONFIG.feePerContract * trade.contracts * 2;
  return grossPnL - totalFees;
}
```

**Logic:**
- YES position: Win if price goes UP
- NO position: Win if price goes DOWN
- Fees: Entry + exit (2 × $0.01 per contract)

#### Settlement Flow

1. Find all OPEN trades older than `minCandlesBeforeSettlement`
2. Look up current market price
3. Calculate P&L based on price movement
4. Update trade: `status: "CLOSED"`, `pnl`, `outcome`
5. Record settlement metadata

### 2. Integration with Live Runner

Settlement runs automatically before signal generation:

```javascript
// In live_runner.js main()
if (PAPER_TRADING && EXECUTE_TRADES) {
  console.log("\n📋 Checking for trades to settle...");
  const settlementResult = runSettlement(enrichedMarkets, Date.now());
  if (settlementResult.settled > 0) {
    console.log(`  Settled ${settlementResult.settled} trades: ${settlementResult.wins} wins, ${settlementResult.losses} losses`);
    console.log(`  Total P&L: $${(settlementResult.totalPnL / 100).toFixed(2)}`);
  }
}
```

This ensures:
- Old trades settle before new ones open
- Win rate updates continuously
- P&L reflects actual performance

---

## Results

### Current Paper Trading Stats

```bash
$ curl http://localhost:3200/api/pnl/live | jq

{
  "win_rate": 0.35,        // 35%
  "total_pnl": -13.31,     // -$13.31
  "trade_count": 63,
  "closed_trades": 60,
  "open_trades": 3,
  "wins": 21,
  "losses": 39
}
```

### Analysis

| Metric | Value | vs Backtest |
|--------|-------|-------------|
| Win Rate | 35% | -20.9pp vs 55.9% target |
| Total Trades | 63 | Good sample size |
| Closed Trades | 60 | 95% settled |
| P&L | -$13.31 | Negative |

### Observations

1. **Win rate below target**: 35% vs 55.9% backtest
2. **Gap persists**: ~21 percentage points below expected
3. **Possible causes**:
   - Mock market data doesn't match backtest data distribution
   - Signal timing differences
   - Fee impact ($0.02 per round trip)

---

## API Endpoints

### GET /api/pnl/live

Returns real-time settlement data:

```json
{
  "success": true,
  "timestamp": "2026-04-03T19:15:00Z",
  "win_rate": 0.35,
  "total_pnl": -13.31,
  "trade_count": 63,
  "closed_trades": 60,
  "open_trades": 3,
  "wins": 21,
  "losses": 39,
  "last_10_trades": [...]
}
```

---

## Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `backend/paper_trade_settlement.js` | Created | Core settlement logic |
| `backend/strategies/live_runner.js` | Modified | Integrated settlement check |
| `output/settlement_impl.md` | Created | This documentation |

---

## Next Steps

1. **Investigate win rate gap**: Why 35% vs 55.9%?
   - Compare mock data distribution to backtest data
   - Check signal entry timing
   - Analyze fee impact

2. **Parameter tuning**: Apply Ivan's T324 recommendations

3. **Historical validation**: Load actual backtest data for paper trading

---

## Usage

```bash
# Run paper trading with automatic settlement
PAPER_TRADING=true node backend/strategies/live_runner.js --execute

# Check settlement status
curl http://localhost:3200/api/pnl/live

# View all trades
curl http://localhost:3200/api/paper-trades
```

---

## Conclusion

✅ **Settlement implemented**: Trades automatically close after 3 runs  
✅ **Win rate measurable**: Currently 35% (below 55.9% target)  
✅ **P&L tracked**: Real-time via `/api/pnl/live`  
⚠️ **Gap identified**: ~21pp below backtest — further investigation needed
