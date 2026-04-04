# trade.sh — Kalshi Trading Pipeline CLI

**Version:** 1.0.0  
**Author:** Karl (Platform Engineer)  
**Task:** #269

---

## Overview

A unified CLI for manually running the Kalshi trading pipeline with support for:
- **Dry-run mode** — Simulate without executing trades
- **Strategy selection** — Run specific strategies or all
- **Market filtering** — Filter by ticker pattern or category
- **Paper trading** — Safe simulation mode (default)
- **Live trading** — Real execution (with safeguards)

---

## Installation

```bash
# The CLI is located at:
agents/karl/output/trade.sh

# Make it executable (if not already):
chmod +x trade.sh

# Optional: Create symlink for global access
ln -s $(pwd)/trade.sh /usr/local/bin/kalshi-trade
```

---

## Quick Start

```bash
# Dry run with all strategies (default, safe)
./trade.sh

# Check system status
./trade.sh status

# Generate signals only (no execution)
./trade.sh signals

# Execute paper trades
./trade.sh execute --paper --execute

# Show help
./trade.sh help
```

---

## Commands

| Command | Description |
|---------|-------------|
| `run` | Run the full trading pipeline (default) |
| `signals` | Generate signals only, no execution |
| `execute` | Execute trades based on signals |
| `pipeline` | Run data pipeline jobs |
| `backtest` | Run backtest on historical data |
| `status` | Show trading system status |
| `help` | Show help message |

---

## Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--dry-run` | `-d` | Simulate without executing | `true` |
| `--execute` | `-x` | Actually execute trades | `false` |
| `--strategy` | `-s` | Specific strategy to run | `all` |
| `--markets` | `-m` | Filter by ticker pattern | — |
| `--category` | `-c` | Filter by category | — |
| `--paper` | — | Use paper trading | `true` |
| `--live` | — | Use live trading ⚠️ | `false` |
| `--limit` | `-l` | Max markets to analyze | `20` |
| `--min-confidence` | — | Min signal confidence | `0.80` |
| `--jobs` | — | Pipeline jobs to run | — |
| `--output` | `-o` | Output file path | — |
| `--verbose` | `-v` | Enable verbose output | `false` |

---

## Examples

### Basic Usage

```bash
# Default dry run — generates signals without trading
./trade.sh

# Same as above, explicit
./trade.sh run --dry-run

# Generate signals only
./trade.sh signals
```

### Strategy Selection

```bash
# Run only mean reversion strategy
./trade.sh signals --strategy mean_reversion

# Available strategies:
# - mean_reversion    (85.7% win rate — recommended)
# - nfp_nowcast       (53.7% win rate, Sharpe 0.237)
# - econ_edge         (viable performer)
# - momentum          (disabled — poor performance)
# - crypto_edge       (disabled — poor performance)
# - all               (run all enabled strategies)
```

### Market Filtering

```bash
# Filter by category
./trade.sh signals --category Crypto
./trade.sh signals --category Economics
./trade.sh signals --category Financial

# Filter by ticker pattern (shell glob)
./trade.sh signals --markets "BTC*"
./trade.sh signals --markets "NFP*"
./trade.sh signals --markets "INXW*"
```

### Paper Trading

```bash
# Execute paper trades (simulated, no real money)
./trade.sh execute --paper --execute

# Full pipeline with paper execution
./trade.sh run --paper --execute --strategy mean_reversion
```

### Live Trading ⚠️ DANGER

```bash
# ⚠️ REAL MONEY AT RISK ⚠️
# Requires explicit confirmation
./trade.sh execute --live --execute

# You will be prompted to type 'YES' to confirm
```

### Data Pipeline

```bash
# Run all pipeline jobs once
./trade.sh pipeline

# Run specific jobs
./trade.sh pipeline --jobs fetch_markets
./trade.sh pipeline --jobs fetch_prices
./trade.sh pipeline --jobs fetch_markets,fetch_prices,sync_positions

# Available jobs:
# - fetch_markets        (every 5 min)
# - fetch_prices         (every 1 min)
# - sync_positions       (every 5 min)
# - econ_edge_scanner    (every 15 min)
# - crypto_edge_analysis (every 10 min)
```

### System Status

```bash
# Check component status
./trade.sh status
```

Output:
```
Components:
  ✓ Live Runner
  ✓ Signal Engine
  ✓ Execution Engine
  ✓ Kalshi Client
  ✓ Pipeline Scheduler

Environment:
  ✓ KALSHI_API_KEY set
  ✓ DATABASE_URL set
  ✓ Paper trading enabled (safe)

Recent Output:
  trade_signals.json: 5m ago
  Last run signals: 12
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `KALSHI_API_KEY` | Kalshi API key | No (falls back to mock data) |
| `KALSHI_DEMO` | Set to `false` for production API | No |
| `PAPER_TRADING` | Set to `false` to enable live trading | No (default: `true`) |
| `DATABASE_URL` | PostgreSQL connection string | No (for persistence) |

---

## Output Files

| File | Description |
|------|-------------|
| `trade_signals.json` | Generated signals with market data |
| `paper_trade_log.json` | Paper trading execution log |

---

## Safety Features

1. **Paper trading by default** — No real trades without explicit flags
2. **Dry-run mode** — Default behavior simulates only
3. **Live trading confirmation** — Requires typing 'YES' for live trades
4. **Strategy performance tracking** — Only high-performing strategies enabled
5. **Risk manager integration** — Validates trades against limits

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Missing required component |
| `3` | Live trading aborted by user |

---

## Troubleshooting

### "Live runner not found"
Ensure the CLI is run from the correct directory:
```bash
cd agents/karl/output
./trade.sh
```

### "No signals generated"
Check that market data is available:
```bash
./trade.sh pipeline --jobs fetch_markets
./trade.sh status
```

### "Risk manager unavailable"
The risk manager requires database connectivity. Signals will still be generated but not validated.

---

## Changelog

### v1.0.0 (2026-04-03)
- Initial release
- Commands: run, signals, execute, pipeline, backtest, status
- Flags: --dry-run, --strategy, --markets, --paper, --live
- Safety: Paper trading default, live trading confirmation
