# Kalshi Trading System

A full-stack trading infrastructure for Kalshi prediction markets. Fetches live market data, generates trading signals using multiple strategies, manages risk, and executes paper trades.

**Target:** New engineers productive in 15 minutes.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           KALSHI TRADING SYSTEM                             │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ Data Fetcher │────▶│  Strategies  │────▶│Risk Manager  │
  │              │     │              │     │              │
  │ • Kalshi API │     │ • Mean Rev   │     │ • Position   │
  │ • CoinGecko  │     │ • Momentum   │     │   Sizing     │
  │ • Grace's    │     │ • Crypto Edge│     │ • Daily Loss │
  │   Pipeline   │     │ • NFP Nowcast│     │   Limits     │
  │              │     │ • Econ Edge  │     │ • Exposure   │
  └──────────────┘     └──────────────┘     └──────┬───────┘
                                                    │
                                                    ▼
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │  Dashboard   │◀────│   API Server │◀────│   Executor   │
  │              │     │   (Port 3200)│     │              │
  │ • Live Sig   │     │              │     │ • Paper Trades│
  │ • Edge Scan  │     │ • /signals   │     │ • Order Mgmt │
  │ • P&L Track  │     │ • /markets   │     │ • Fill Sim   │
  │ • Health     │     │ • /status    │     │              │
  └──────────────┘     └──────────────┘     └──────────────┘
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **Data Fetcher** | `kalshi_client.js` | Kalshi API client with rate limiting |
| **Live Runner** | `strategies/live_runner.js` | Orchestrates signal generation |
| **Signal Engine** | `strategies/signal_engine.js` | Validates and filters signals |
| **Position Sizer** | `strategies/position_sizer.js` | Kelly criterion sizing |
| **Risk Manager** | `strategies/risk_manager.js` | Daily loss limits, exposure caps |
| **Execution Engine** | `strategies/execution_engine.js` | Paper trade simulation |
| **Dashboard API** | `dashboard_api.js` | Express server (port 3200) |
| **Dashboard UI** | `dashboard/index.html` | Single-page frontend |

---

## 2. How to Run the Full Stack

### Prerequisites

```bash
# Node.js 18+ required
node --version  # v18.0.0 or higher

# Install dependencies
cd agents/bob/backend
npm install
```

### Start the Dashboard (One Command)

```bash
# Terminal 1: Start the API server
node dashboard_api.js
# → Server running on http://localhost:3200

# Terminal 2: Open the dashboard
open dashboard/index.html
# Or: python3 -m http.server 8080 --directory dashboard
# Then open http://localhost:8080
```

### Start the Trading Pipeline

```bash
# Generate signals (without executing)
node strategies/live_runner.js

# Generate signals AND execute paper trades
node strategies/live_runner.js --execute

# Output written to: output/trade_signals.json
```

### Available Ports

| Service | Port | Endpoint |
|---------|------|----------|
| Dashboard API | 3200 | http://localhost:3200 |
| Dashboard UI | 8080 (via python) | http://localhost:8080 |
| Kalshi API (demo) | 443 | https://demo-api.kalshi.com |
| Kalshi API (live) | 443 | https://trading-api.kalshi.com |

---

## 3. Environment Variables

Create a `.env` file in `agents/bob/backend/`:

```bash
# Required for live trading
KALSHI_API_KEY=your_api_key_here

# Optional: Use demo environment (default: true)
KALSHI_DEMO=true

# Optional: Custom dashboard port (default: 3200)
PORT=3200

# Optional: Database (uses mock if not set)
DATABASE_URL=postgresql://user:pass@localhost/kalshi
```

### Getting Your API Key

1. Register at https://kalshi.com/signup
2. Complete KYC verification (required by CFTC)
3. Go to Settings → API Keys
4. Generate a new key (scope: "Trading" for live, "Demo" for paper)
5. Copy the key to your `.env` file

### Without API Key

The system works without a key using **mock fallback data**:
- Realistic market data for 5+ markets
- Simulated signals from all strategies
- Full dashboard functionality
- Paper trades execute against simulated fills

---

## 4. How to Run Backtests

### Quick Backtest

```bash
# Run strategies against historical data
node strategies/backtest.js --strategy=mean_reversion --days=30

# Output: output/backtest_results.json
```

### Full Backtest Suite

```bash
# Test all strategies
node strategies/backtest.js --all --days=90 --report

# Generates:
# - output/backtest_summary.md
# - output/backtest_charts.html
```

### Backtest Configuration

Edit `strategies/backtest_config.js`:

```javascript
module.exports = {
  initialCapital: 10000,    // Starting balance in cents
  maxPositions: 10,         // Max concurrent positions
  commissionPerContract: 1, // $0.01 per contract
  slippage: 0.5,           // 0.5% slippage on fills
};
```

---

## 5. How to Open the Dashboard

### Option 1: Direct File Open (Simplest)

```bash
# macOS
open dashboard/index.html

# Linux
xdg-open dashboard/index.html

# Windows
start dashboard/index.html
```

### Option 2: Local Server (Recommended)

```bash
cd dashboard
python3 -m http.server 8080

# Open http://localhost:8080
```

### Option 3: With Live API

```bash
# Terminal 1
node dashboard_api.js

# Terminal 2
python3 -m http.server 8080 --directory dashboard

# Open http://localhost:8080
# Dashboard fetches from http://localhost:3200/api/*
```

### Dashboard Features

| Panel | Description | Auto-Refresh |
|-------|-------------|--------------|
| **Live Signals** | Current trading signals with color coding | 60s |
| **Edge Scanner** | Top 10 markets by edge magnitude | 60s |
| **P&L Tracker** | Paper trading performance | 60s |
| **Strategy Health** | Status of all strategies | 60s |
| **Run Pipeline** | Manual trigger for signal generation | On click |

---

## 6. Deployment Notes

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3200
CMD ["node", "dashboard_api.js"]
```

```bash
# Build and run
docker build -t kalshi-trading .
docker run -p 3200:3200 --env-file .env kalshi-trading
```

### Production Checklist

- [ ] Set `KALSHI_API_KEY` (production key)
- [ ] Set `KALSHI_DEMO=false`
- [ ] Configure `DATABASE_URL` (PostgreSQL)
- [ ] Set up log rotation (`logs/` directory)
- [ ] Configure monitoring (see `dashboard/monitor.js`)
- [ ] Enable rate limiting (already built into `kalshi_client.js`)

### Security

- Never commit `.env` files
- Use AWS Secrets Manager or Vault in production
- Rotate API keys quarterly
- IP whitelist if Kalshi supports it

### Monitoring

```bash
# Check system health
curl http://localhost:3200/health

# Check API status
curl http://localhost:3200/api/status

# View logs
tail -f logs/dashboard.log
```

---

## Quick Reference

```bash
# One-liner to start everything
cd agents/bob/backend && node dashboard_api.js & python3 -m http.server 8080 --directory dashboard &

# Generate signals
node strategies/live_runner.js

# Run with live execution
node strategies/live_runner.js --execute

# View trade signals
cat output/trade_signals.json | jq '.signals'

# Check API
curl http://localhost:3200/api/signals | jq
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `401 Unauthorized` | Set `KALSHI_API_KEY` env var |
| `EADDRINUSE` | Kill process on port 3200: `lsof -ti:3200 | xargs kill` |
| Empty signals | Check `output/trade_signals.json` exists |
| Dashboard not loading | Ensure API is running on port 3200 |
| Rate limit (429) | Wait 10s; built-in rate limiter will retry |

---

## File Structure

```
agents/bob/backend/
├── README.md                 # This file
├── dashboard_api.js          # Express API server
├── kalshi_client.js          # Kalshi API client
├── kalshi_data_fetcher.js    # Data ingestion
├── dashboard/
│   ├── index.html           # Dashboard frontend
│   ├── monitor.js           # Monitoring alerts
│   └── run_scheduler.sh     # Cron scheduler
├── strategies/
│   ├── live_runner.js       # Main orchestrator
│   ├── signal_engine.js     # Signal validation
│   ├── position_sizer.js    # Kelly sizing
│   ├── risk_manager.js      # Risk controls
│   ├── execution_engine.js  # Paper trading
│   └── strategies/          # Individual strategies
│       ├── mean_reversion.js
│       ├── momentum.js
│       ├── crypto_edge.js
│       ├── nfp_nowcast.js
│       └── econ_edge.js
├── db/
│   └── schema.sql           # Database schema
└── output/
    └── trade_signals.json   # Generated signals
```

---

**Questions?** Check `output/kalshi_credentials.md` for API setup help or ping Alice in `#trading-ops`.
