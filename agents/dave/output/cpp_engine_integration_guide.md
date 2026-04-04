# D004 Phase 4 C++ HFT Execution Engine — Integration Guide

**Author:** Dave (Full Stack Engineer)  
**Date:** 2026-04-03  
**Version:** 1.0  
**Engine:** `agents/bob/backend/cpp_engine/engine.cpp`  

---

## Table of Contents

1. [Overview](#overview)
2. [Build and Run Instructions](#build-and-run-instructions)
3. [Configuration Options](#configuration-options)
4. [Input / Output Interfaces](#input--output-interfaces)
5. [Pre-Trade Risk Checks & Circuit Breakers](#pre-trade-risk-checks--circuit-breakers)
6. [Monitoring & Heartbeat Format](#monitoring--heartbeat-format)
7. [Example Integration Code](#example-integration-code)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The Phase 4 C++ Execution Engine is the high-frequency trading component of the D004 Kalshi Arbitrage Engine. It consumes correlated market pairs from Phases 1-3, detects spread deviations in real time, and executes paired buy/sell orders with sub-millisecond latency.

### Key Characteristics

| Property | Value |
|----------|-------|
| Language | C++20 |
| Target Latency | <1ms end-to-end |
| Threading Model | 4-thread (feed, strategy, position monitor, health) |
| Risk Controls | Position limits, daily loss limit, max drawdown, circuit breaker |
| JSON Parser | Lightweight custom parser (no external deps) |

---

## Build and Run Instructions

### Prerequisites

- g++ with C++20 support (macOS/Linux)
- POSIX threads (`-pthread`)
- ~10 MB disk space

### Compile

```bash
cd agents/bob/backend/cpp_engine

# Release build
g++ -std=c++20 -pthread -O3 -Wall -Wextra -o engine engine.cpp

# Test suite
g++ -std=c++20 -pthread -O3 -Wall -Wextra -o test_suite test_suite.cpp
```

### Run

```bash
# Default pairs path (relative)
./engine

# Explicit pairs path (recommended for automation)
./engine /Users/chenyangcui/Documents/code/aicompany/agents/public/correlation_pairs.json
```

### Run Tests

```bash
./test_suite
```

Expected output: `Passed: 29, Failed: 0`

---

## Configuration Options

Configuration is compile-time via `config` namespace in `engine.cpp`:

| Constant | Default | Description |
|----------|---------|-------------|
| `RING_BUFFER_SIZE` | 4096 | Lock-free SPSC ring buffer slots |
| `SIGNAL_COOLDOWN_US` | 500000 | Minimum time between signals for same pair (µs) |
| `POSITION_MAX_HOLD_US` | 300000000 | Max position hold time (5 min) |
| `MAX_DAILY_LOSS_CENTS` | 50000 | Daily realized loss limit ($500) |
| `MAX_TOTAL_EXPOSURE_CENTS` | 200000 | Max total position exposure ($2,000) |
| `MAX_POSITION_SIZE` | 1000 | Max contracts per leg |
| `SPREAD_DEVIATION_MIN_SIGMA` | 0.5 | Minimum sigma to trigger signal |
| `SPREAD_DEVIATION_MAX_SIGMA` | 5.0 | Maximum sigma to consider valid |
| `CIRCUIT_BREAKER_MAX_LOSSES` | 3 | Losses in window to trigger breaker |
| `CIRCUIT_BREAKER_WINDOW_US` | 60000000 | Circuit breaker lookback window (60s) |
| `STARTING_CAPITAL_CENTS` | 500000 | Initial capital for drawdown calc ($5,000) |
| `MAX_DRAWDOWN_PERCENT` | 10.0 | Hard max drawdown limit |

To modify: edit `engine.cpp`, recompile.

---

## Input / Output Interfaces

### Input: `correlation_pairs.json`

The engine loads correlated pairs at startup. Expected format:

```json
{
  "pairs": [
    {
      "cluster": "finance_cluster",
      "market_a": "SP500-5000",
      "market_b": "NASDAQ-ALLTIME",
      "pearson_correlation": 0.951,
      "expected_spread": 5.0,
      "spread_threshold": 2.0,
      "arbitrage_confidence": 0.97,
      "direction": "buy_A_sell_B",
      "is_arbitrage_opportunity": true
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cluster` | string | Semantic cluster name from Phase 2 |
| `market_a` | string | Ticker for first leg |
| `market_b` | string | Ticker for second leg |
| `pearson_correlation` | float | Pearson r (must be >0.75) |
| `expected_spread` | float | Historically fair spread |
| `spread_threshold` | float | Sigma denominator |
| `arbitrage_confidence` | float | 0.0–1.0 confidence score |
| `direction` | string | `buy_A_sell_B` or `sell_A_buy_B` |
| `is_arbitrage_opportunity` | bool | Whether pair is active |

### Output: `risk_summary.json`

Exported automatically on engine shutdown:

```json
{
  "max_drawdown": 0,
  "max_drawdown_percent": 0.00,
  "peak_unrealized_pnl": 0,
  "timestamp": "1712163600000000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `max_drawdown` | int | Peak-to-trough drawdown in cents |
| `max_drawdown_percent` | float | Drawdown as % of starting capital |
| `peak_unrealized_pnl` | int | Realized + unrealized PnL in cents |
| `timestamp` | string | Microseconds since epoch |

---

## Pre-Trade Risk Checks & Circuit Breakers

The `RiskManager::pre_trade_check()` evaluates the following in order:

1. **Max Drawdown** — If `max_drawdown_percent >= 10.0`, reject trade and trigger circuit breaker.
2. **Circuit Breaker** — If already active from losses or drawdown, reject all trades.
3. **Max Exposure** — If `total_exposure_cents >= 200000`, reject.
4. **Daily Loss Limit** — If `realized_pnl_cents <= -50000`, reject.

### Circuit Breaker Triggers

- **Loss-based:** 3 losses within 60 seconds
- **Drawdown-based:** Max drawdown ≥ 10%

To reset the circuit breaker:

```cpp
engine.risk()->reset_circuit_breaker();
```

---

## Monitoring & Heartbeat Format

The engine prints a heartbeat line every second:

```
[HEARTBEAT] Trades=0 PnL=0 Exposure=0 Positions=0 Drawdown=0% CB=NO
```

| Token | Meaning |
|-------|---------|
| `Trades` | Total trades today |
| `PnL` | Realized P&L in dollars |
| `Exposure` | Total position exposure in dollars |
| `Positions` | Count of open positions |
| `Drawdown` | Current max drawdown % |
| `CB` | Circuit breaker state (YES/NO) |

---

## Example Integration Code

### Basic Launch Script (Bash)

```bash
#!/bin/bash
set -e

ENGINE_DIR="agents/bob/backend/cpp_engine"
PAIRS_PATH="/Users/chenyangcui/Documents/code/aicompany/agents/public/correlation_pairs.json"

cd "$ENGINE_DIR"

# Build if needed
if [ ! -f ./engine ]; then
    g++ -std=c++20 -pthread -O3 -o engine engine.cpp
fi

# Run with explicit pairs path
./engine "$PAIRS_PATH"

# Verify output
if [ -f risk_summary.json ]; then
    echo "Engine completed. Risk summary:"
    cat risk_summary.json
else
    echo "WARNING: risk_summary.json not found"
fi
```

### Node.js Wrapper

```javascript
const { spawn } = require('child_process');
const path = require('path');

function runEngine(pairsPath) {
    const enginePath = path.join(__dirname, '../cpp_engine/engine');
    const proc = spawn(enginePath, [pairsPath], {
        cwd: path.join(__dirname, '../cpp_engine')
    });

    proc.stdout.on('data', (data) => {
        console.log(`[ENGINE] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
        console.error(`[ENGINE ERR] ${data.toString().trim()}`);
    });

    proc.on('close', (code) => {
        console.log(`Engine exited with code ${code}`);
        // Read risk_summary.json here
    });
}

runEngine('/Users/chenyangcui/Documents/code/aicompany/agents/public/correlation_pairs.json');
```

### Reading Risk Summary (Node.js)

```javascript
const fs = require('fs');

function loadRiskSummary() {
    const path = 'agents/bob/backend/cpp_engine/risk_summary.json';
    if (!fs.existsSync(path)) return null;
    const raw = fs.readFileSync(path, 'utf8');
    return JSON.parse(raw);
}

const summary = loadRiskSummary();
if (summary) {
    console.log(`Max Drawdown: ${summary.max_drawdown_percent}%`);
    console.log(`Peak P&L: ${summary.peak_unrealized_pnl} cents`);
}
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Failed to load correlation pairs` | Wrong path or malformed JSON | Verify path and JSON syntax |
| `Engine initialization failed` | Feed connection or router init failure | Check WebSocket URL and API key env |
| `Circuit breaker active` | 3 losses in 60s or drawdown ≥10% | Call `reset_circuit_breaker()` or wait |
| `Max drawdown limit reached` | Peak-to-trough drawdown hit 10% | Review position sizing and market conditions |
| `Risk summary written to ... failed` | Directory does not exist | Ensure working directory exists and is writable |
| 0 signals on mock data | Mock data produces efficient-market prices | Expected behavior; real data required for signals |

---

## Quick Reference

```bash
# Build
g++ -std=c++20 -pthread -O3 -o engine engine.cpp

# Run
./engine /path/to/correlation_pairs.json

# Test
./test_suite

# Reset breaker (programmatic)
engine.risk()->reset_circuit_breaker();

# Export risk summary (programmatic)
engine.export_risk_summary("risk_summary.json");
```

---

*End of Integration Guide*
