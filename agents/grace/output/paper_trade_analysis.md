# Paper Trade P&L Analysis — T317

**Generated:** 2026-04-03  
**Analyst:** Grace (Data Engineer)  
**Data Source:** `agents/pat/output/paper_trades.db` + `pnl_summary.json`

---

## Executive Summary

**⚠️ CRITICAL DIVERGENCE: mean_reversion live win rate (18.2%) is 67 percentage points below backtest benchmark (85.7%). Do NOT proceed to live trading on current strategy parameters.**

| Metric | Paper Trade | Backtest Benchmark | Delta |
|--------|------------|-------------------|-------|
| Overall Win Rate | 26.3% (5/19) | 85.7% | **-59.4pp** |
| mean_reversion Win Rate | 18.2% (2/11) | 85.7% | **-67.5pp** |
| momentum Win Rate | 37.5% (3/8) | ~10-11% | +26.5pp |
| Total PnL | **-$13.73** | Expected +$9,260 (backtest) | — |
| Avg PnL/Trade | -$0.72 | — | — |

---

## Trade Dataset

- **Total closed trades:** 19 (0 open positions)
- **Date range:** 2026-04-02 → 2026-04-03
- **Strategies active:** mean_reversion (11 trades), momentum (8 trades)

Note: momentum trades are included in the database despite being marked disabled in consensus (consensus entry #2). Several momentum trades have confidence values (0.20–0.53) well below the 0.80 threshold (consensus entry #4). These should be excluded from future paper trading.

---

## Strategy Breakdown

### mean_reversion (Primary Strategy)

| Metric | Value |
|--------|-------|
| Trades | 11 |
| Wins / Losses | 2 / 8 (1 breakeven) |
| **Win Rate** | **18.18%** |
| Total PnL | **-$16.97** |
| Avg PnL/Trade | -$1.54 |
| Best Trade | +$1.45 (BTCW-26-JUN30-100K, +7.8%) |
| Worst Trade | -$6.20 (ETHW-26-DEC31-5K, -33.3%) |

**Confidence coverage:** 7 of 11 trades have `signal_confidence = 0.95`. The last 4 trades (2026-04-03 batch) have NULL confidence — confidence filtering appears to have been bypassed.

### momentum (Should Be Disabled)

| Metric | Value |
|--------|-------|
| Trades | 8 |
| Wins / Losses | 3 / 3 (2 breakeven) |
| **Win Rate** | **37.5%** |
| Total PnL | **+$3.24** |
| Avg PnL/Trade | +$0.41 |
| Best Trade | +$2.22 (INXW-25-DEC31, +42.9%) |
| Worst Trade | -$0.42 (UNEMP-25-MAR, -10.7%) |

Note: Momentum shows positive PnL in paper trading but its backtest win rate was ~10-11%. This sample of 8 trades is too small to be statistically meaningful. Consensus says disabled — keep it that way.

---

## Max Drawdown

Cumulative PnL trace (trade-by-trade chronological order):

| Trade # | Date | PnL | Cumulative |
|---------|------|-----|-----------|
| 1 | Apr 2 | -0.29 | -0.29 |
| 2 | Apr 2 | -6.20 | -6.49 |
| 3 | Apr 2 | -2.48 | -8.97 |
| 4 | Apr 2 | +1.02 | -7.95 |
| 5 | Apr 2 | +1.45 | -6.50 |
| 6 | Apr 2 | +0.62 | -5.88 |
| 7 | Apr 2 | +2.22 | -3.66 |
| 8 | Apr 2 | -0.15 | -3.81 |
| 9 | Apr 2 | -0.42 | -4.23 |
| 10 | Apr 2 | -1.74 | -5.97 |
| 11 | Apr 2 | -0.62 | -6.59 |
| 12 | Apr 2 | 0.00 | -6.59 |
| 13 | Apr 2 | +0.96 | -5.63 |
| 14 | Apr 2 | 0.00 | -5.63 |
| 15 | Apr 2 | -0.39 | -6.02 |
| 16 | Apr 3 | 0.00 | -6.02 |
| 17 | Apr 3 | -1.89 | -7.91 |
| 18 | Apr 3 | -4.34 | -12.25 |
| 19 | Apr 3 | -1.48 | **-13.73** |

**Max Drawdown: -$13.73** (never recovered — currently at trough)  
**Peak PnL reached:** -$3.66 (trade 7)  
**Drawdown from peak:** -$10.07

---

## Slippage Estimate

Based on entry vs exit prices on BTCW-26-JUN30-100K (most traded instrument, 29 contracts):

| Trade | Entry | Exit | Move (cents) | PnL |
|-------|-------|------|-------------|-----|
| Apr 2 batch 1 | 64 | 63 | -1 | -$0.29 |
| Apr 2 batch 2 | 64 | 69 | +5 | +$1.45 |
| Apr 2 batch 3 | 64 | 58 | -6 | -$1.74 |
| Apr 3 batch | 64 | 64 | 0 | $0.00 |

Market slippage on Kalshi contracts appears to be **0–1 cent per contract** for liquid instruments. The losses are primarily driven by adverse price movement, not slippage. However, with small contract counts (5–66 contracts per trade), bid-ask spread impact is non-negligible for illiquid markets like UNEMP-25-MAR.

**Estimated avg slippage:** ~$0.50–1.00 per trade (1-2 cents per contract).

---

## Root Cause Analysis — Backtest vs Live Divergence

The 67pp gap in mean_reversion win rate is severe and suggests one or more of the following:

1. **Backtest overfitting** — mean_reversion parameters were optimized on historical data that doesn't reflect current market conditions. The 85.7% win rate may not generalize.

2. **Market data quality** — The paper trade entries all have identical timestamps (`2026-04-02T05:38:27-49.xxx`), suggesting batch simulation rather than real-time signals. Multiple entry orders were placed within milliseconds of each other, which is not realistic live behavior.

3. **Confidence threshold violation** — 4 trades (April 3 batch) have NULL signal_confidence. If confidence filtering was skipped, bad signals got executed.

4. **Strategy mismatch on instrument selection** — ETHW-26-DEC31-5K was entered at 30 cents and exited at 20-23 cents (multiple times). This instrument may not suit the mean_reversion model assumptions.

---

## Data Quality Flags

| Issue | Count | Severity |
|-------|-------|---------|
| NULL signal_confidence | 4 trades | HIGH — violates 0.80 threshold policy |
| momentum trades active (should be disabled) | 8 trades | MEDIUM — consensus says disabled |
| Batch timestamp entries (milisecond clusters) | 15 trades | MEDIUM — suggests simulation not real-time |
| ETHW-26-DEC31-5K entered 3x at same price | 3 entries | LOW — possible duplicate signal |

---

## Daily Summary

| Date | Trades | Wins | Losses | PnL |
|------|--------|------|--------|-----|
| 2026-04-02 | 15 | 5 | 8 | -$6.02 |
| 2026-04-03 | 4 | 0 | 3 | -$7.71 |
| **Total** | **19** | **5** | **11** | **-$13.73** |

---

## Recommendations

1. **DO NOT proceed to live trading** with current mean_reversion parameters. 18.2% paper win rate vs 85.7% backtest is a critical failure signal.

2. **Investigate backtest methodology** — Ivan (ML) should audit whether the backtest had look-ahead bias or was evaluated on in-sample data.

3. **Enforce confidence threshold** — The 4 NULL-confidence trades (April 3) indicate a bug. All trades must have `signal_confidence >= 0.80` before execution. Fix the signal pipeline.

4. **Disable momentum trades** — Remove from paper trading to stay consistent with consensus entry #2.

5. **Expand paper trade sample** — 19 trades over 2 days is insufficient. Run 100+ trades over 2–4 weeks before drawing live-ready conclusions.

6. **Separate real-time vs batch simulation** — The millisecond-cluster timestamps suggest batch testing, not real-time market simulation. Real paper trading needs actual market data feeds.

---

## Artifacts

- `agents/pat/output/paper_trades.db` — Raw trade records (SQLite)
- `agents/pat/output/pnl_summary.json` — Aggregate stats
- `agents/pat/output/pnl_tracker.js` — PnL tracking script

---

*Analysis by Grace (Data Engineer) | Task T317 | 2026-04-03*
