# Backtest Results: Kalshi Strategy Comparison

**Generated:** 2026-04-01  
**Data:** 90 days of synthetic historical market data (8 markets, daily snapshots)  
**Hold Period:** 5 days per trade  
**Account Balance:** $1,000.00 (100,000 cents)  

## Summary Table

| Strategy | Trades | Win Rate | Total P&L | Avg Trade | Sharpe | Max Drawdown |
|----------|--------|----------|-----------|-----------|--------|--------------|
| arbitrage | 363 | 48.8% | $-1.20 | $-0.00 | 0.212 | $14.40 |
| crypto_edge | 91 | 50.5% | $-4.80 | $-0.05 | 0.216 | $12.00 |
| economic_momentum | 89 | 43.8% | $0.70 | $0.01 | 0.172 | $10.00 |
| longshot_fading | 183 | 44.8% | $-24.00 | $-0.13 | -0.145 | $35.50 |
| mean_reversion | 269 | 50.9% | $43.10 | $0.16 | 0.275 | $12.60 |
| momentum | 621 | 44.1% | $-118.05 | $-0.19 | -0.120 | $151.50 |
| nfp_nowcast | 0 | 0.0% | $0.00 | $0.00 | 0.000 | $0.00 |

## Strategy Details

### arbitrage

- **Total Trades:** 363
- **Winning Trades:** 177
- **Losing Trades:** 186
- **Win Rate:** 48.8%
- **Total P&L:** $-1.20
- **Average Trade P&L:** $-0.00
- **Sharpe Ratio:** 0.212
- **Max Drawdown:** $14.40

#### Sample Trades

| Market | Side | Entry | Exit | Contracts | P&L |
|--------|------|-------|------|-----------|-----|
| INXW-25-DEC31 | YES | 86c | 81c | 10 | $-0.50 |
| INXW-25-DEC31 | YES | 88c | 83c | 10 | $-0.50 |
| INXW-25-DEC31 | YES | 88c | 83c | 10 | $-0.50 |
| INXW-25-DEC31 | YES | 85c | 79c | 10 | $-0.60 |
| INXW-25-DEC31 | YES | 82c | 74c | 10 | $-0.80 |

### crypto_edge

- **Total Trades:** 91
- **Winning Trades:** 46
- **Losing Trades:** 45
- **Win Rate:** 50.5%
- **Total P&L:** $-4.80
- **Average Trade P&L:** $-0.05
- **Sharpe Ratio:** 0.216
- **Max Drawdown:** $12.00

#### Sample Trades

| Market | Side | Entry | Exit | Contracts | P&L |
|--------|------|-------|------|-----------|-----|
| BTCW-25-DEC31 | YES | 13c | 15c | 10 | $0.20 |
| BTCW-25-DEC31 | YES | 9c | 13c | 10 | $0.40 |
| BTCW-25-DEC31 | YES | 10c | 14c | 10 | $0.40 |
| BTCW-25-DEC31 | YES | 13c | 9c | 10 | $-0.40 |
| BTCW-25-DEC31 | YES | 13c | 19c | 10 | $0.60 |

### economic_momentum

- **Total Trades:** 89
- **Winning Trades:** 39
- **Losing Trades:** 50
- **Win Rate:** 43.8%
- **Total P&L:** $0.70
- **Average Trade P&L:** $0.01
- **Sharpe Ratio:** 0.172
- **Max Drawdown:** $10.00

#### Sample Trades

| Market | Side | Entry | Exit | Contracts | P&L |
|--------|------|-------|------|-----------|-----|
| INXW-25-DEC31 | NO | 15c | 16c | 10 | $0.10 |
| INXW-25-DEC31 | NO | 13c | 17c | 10 | $0.40 |
| INXW-25-DEC31 | YES | 84c | 79c | 10 | $-0.50 |
| INXW-25-DEC31 | YES | 83c | 80c | 10 | $-0.30 |
| INXW-25-DEC31 | NO | 19c | 20c | 10 | $0.10 |

### longshot_fading

- **Total Trades:** 183
- **Winning Trades:** 82
- **Losing Trades:** 101
- **Win Rate:** 44.8%
- **Total P&L:** $-24.00
- **Average Trade P&L:** $-0.13
- **Sharpe Ratio:** -0.145
- **Max Drawdown:** $35.50

#### Sample Trades

| Market | Side | Entry | Exit | Contracts | P&L |
|--------|------|-------|------|-----------|-----|
| SNOW-NYC-25 | NO | 80c | 81c | 10 | $0.10 |
| SNOW-NYC-25 | NO | 83c | 88c | 10 | $0.50 |
| SNOW-NYC-25 | NO | 81c | 87c | 10 | $0.60 |
| SNOW-NYC-25 | NO | 80c | 85c | 10 | $0.50 |
| SNOW-NYC-25 | NO | 81c | 95c | 10 | $1.40 |

### mean_reversion

- **Total Trades:** 269
- **Winning Trades:** 137
- **Losing Trades:** 132
- **Win Rate:** 50.9%
- **Total P&L:** $43.10
- **Average Trade P&L:** $0.16
- **Sharpe Ratio:** 0.275
- **Max Drawdown:** $12.60

#### Sample Trades

| Market | Side | Entry | Exit | Contracts | P&L |
|--------|------|-------|------|-----------|-----|
| INXW-25-DEC31 | YES | 81c | 74c | 10 | $-0.70 |
| INXW-25-DEC31 | YES | 79c | 73c | 10 | $-0.60 |
| INXW-25-DEC31 | YES | 74c | 71c | 10 | $-0.30 |
| INXW-25-DEC31 | YES | 73c | 71c | 10 | $-0.20 |
| INXW-25-DEC31 | YES | 71c | 68c | 10 | $-0.30 |

### momentum

- **Total Trades:** 621
- **Winning Trades:** 274
- **Losing Trades:** 347
- **Win Rate:** 44.1%
- **Total P&L:** $-118.05
- **Average Trade P&L:** $-0.19
- **Sharpe Ratio:** -0.120
- **Max Drawdown:** $151.50

#### Sample Trades

| Market | Side | Entry | Exit | Contracts | P&L |
|--------|------|-------|------|-----------|-----|
| INXW-25-DEC31 | NO | 21c | 27c | 15 | $0.90 |
| INXW-25-DEC31 | NO | 26c | 29c | 15 | $0.45 |
| INXW-25-DEC31 | NO | 20c | 28c | 15 | $1.20 |
| INXW-25-DEC31 | NO | 20c | 28c | 15 | $1.20 |
| INXW-25-DEC31 | NO | 23c | 27c | 15 | $0.60 |

### nfp_nowcast

- **Total Trades:** 0
- **Winning Trades:** 0
- **Losing Trades:** 0
- **Win Rate:** 0.0%
- **Total P&L:** $0.00
- **Average Trade P&L:** $0.00
- **Sharpe Ratio:** 0.000
- **Max Drawdown:** $0.00

## Methodology

1. **Data Generation:** Synthetic daily market snapshots for 8 Kalshi-style markets across Economics, Crypto, Politics, Weather, and Entertainment categories.
2. **Signal Generation:** Each strategy's Python-ported logic scans every market/day and generates entry signals when thresholds are met.
3. **Trade Simulation:** On signal entry, the engine simulates buying/selling at the day's mid price and exits after a 5-day hold period.
4. **P&L Calculation:** Profit/Loss = (exit_price - entry_price) × contracts. For NO positions, NO mid prices are used.
5. **Metrics:** Sharpe ratio uses trade return percentages; max drawdown tracks cumulative P&L peaks.

## Notes

- These results use **synthetic data** for infrastructure validation. Live backtests will use actual Kalshi price history from Bob's database pipeline.
- The `economic_momentum` strategy uses mock forecast divergences until real nowcast data is integrated.
- `arbitrage` signals are rare in synthetic data because YES+NO prices are generated to sum to ~100.
