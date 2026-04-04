# Trade CLI Usage Guide

**Task**: #269  
**Author**: Liam (SRE)  
**Date**: 2026-04-03

---

## Overview

The `trade.sh` CLI tool provides a convenient wrapper for manually running the trading pipeline. It supports dry-run simulation, paper trading, and live trading modes with strategy and market filtering.

---

## Installation

```bash
# Make executable
chmod +x agents/liam/output/trade.sh

# Optional: Add to PATH
ln -s $(pwd)/agents/liam/output/trade.sh /usr/local/bin/trade
```

---

## Quick Start

```bash
# Dry run (default) — simulate without executing
cd agents/liam/output
./trade.sh

# Paper trading — execute demo orders
./trade.sh --paper

# Live trading — execute real orders (requires API key)
export KALSHI_API_KEY="your_key_here"
./trade.sh --live
```

---

## Command Reference

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Simulate trades without execution | ✅ Default |
| `--paper` | Execute paper/demo trades | |
| `--live` | Execute LIVE trades (requires confirmation) | |
| `--strategy NAME` | Run specific strategy only | All |
| `--markets LIST` | Filter by comma-separated tickers | All |
| `--verbose, -v` | Show detailed output | false |
| `--help, -h` | Show help message | |

### Strategies

- `mean_reversion` — Mean reversion strategy
- `momentum` — Momentum strategy
- `crypto_edge` — Crypto edge strategy
- `nfp_nowcast` — NFP nowcast strategy
- `econ_edge` — Economic edge strategy

---

## Examples

### Dry Run Examples

```bash
# Default dry run with all strategies
./trade.sh

# Dry run specific strategy
./trade.sh --dry-run --strategy mean_reversion

# Dry run on specific markets
./trade.sh --dry-run --markets UNEMP,INFL,BTC

# Verbose dry run
./trade.sh --dry-run --verbose
```

### Paper Trading Examples

```bash
# Paper trade all strategies
./trade.sh --paper

# Paper trade mean reversion only
./trade.sh --paper --strategy mean_reversion

# Paper trade specific markets
./trade.sh --paper --markets INXW-25-DEC31,BTCW-26-JUN30-80K
```

### Live Trading Examples

```bash
# Set API key
export KALSHI_API_KEY="your_api_key_here"

# Live trade with confirmation prompt
./trade.sh --live

# Live trade specific strategy
./trade.sh --live --strategy momentum
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KALSHI_API_KEY` | For live trading | Your Kalshi API key |
| `KALSHI_DEMO` | No | Set to `false` for live trading (default: `true`) |
| `PAPER_TRADING` | No | Set to `true` for paper mode (default: `true`) |
| `TRADE_STRATEGY` | No | Strategy filter (set by `--strategy`) |
| `TRADE_MARKETS` | No | Markets filter (set by `--markets`) |

---

## Output

Trade signals are written to:
```
agents/bob/output/trade_signals.json
```

The output includes:
- Generated timestamp
- Market data
- Signal details (ticker, side, confidence, position size)
- Execution report (if trades executed)

---

## Safety Features

1. **Default Dry Run**: Without flags, the tool runs in dry-run mode (no trades executed)
2. **Live Confirmation**: `--live` requires typing "YES" to confirm
3. **API Key Check**: Live trading fails if `KALSHI_API_KEY` is not set
4. **Strategy Validation**: Unknown strategies are rejected with error message

---

## Troubleshooting

### "Error: KALSHI_API_KEY not set"
Set your API key: `export KALSHI_API_KEY="your_key"`

### "Unknown strategy"
Check the strategy name matches one of: mean_reversion, momentum, crypto_edge, nfp_nowcast, econ_edge

### No output file generated
Check that `live_runner.js` exists and Node.js is installed.

---

## Integration with Dashboard

After running the pipeline:

```bash
# Generate signals
./trade.sh --paper

# View in dashboard
curl http://localhost:3200/api/signals
```

---

## See Also

- `live_runner.js` — Core trading pipeline
- `dashboard_api.js` — Dashboard API server
- `monitor.js` — Pipeline monitoring
