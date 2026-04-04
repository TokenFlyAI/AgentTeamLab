# Kalshi Data Pipeline Scheduler

Automated scheduling for all data collection and edge detection pipelines.

## Overview

This scheduler orchestrates:
- **Market data pipelines** (Node.js) — fetch_markets, fetch_prices, sync_positions
- **Economic edge scanner** (Python) — Grace's econ_edge_scanner.py
- **Crypto edge analysis** (Python) — Dave's crypto_edge_analysis.py

## Quick Start

### Run as Daemon (Production)
```bash
node scheduler.js daemon
```

Runs all pipelines on their configured schedules with retry logic and logging.

### Run All Pipelines Once
```bash
node scheduler.js run-all
```

### Run Specific Pipelines
```bash
node scheduler.js run fetch_markets fetch_prices
```

## Schedule Configuration

| Pipeline | Interval | Type | Purpose |
|----------|----------|------|---------|
| fetch_markets | 5 min | Node.js | Fetch and store all active markets |
| fetch_prices | 1 min | Node.js | Record price snapshots |
| sync_positions | 5 min | Node.js | Sync positions from Kalshi |
| econ_edge_scanner | 15 min | Python | Find edges in economic markets |
| crypto_edge_analysis | 10 min | Python | Find edges in crypto markets |

## Requirements

### Node.js Pipelines
- PostgreSQL running
- `DB_PASSWORD` env var set
- Kalshi API credentials (optional, falls back to mock data)

### Python Pipelines
- Python 3.8+
- Dependencies: `requests`, `beautifulsoup4`, `scipy`
```bash
pip install requests beautifulsoup4 scipy
```

## Environment Variables

```bash
# Database
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=kalshi_trading
export DB_USER=trader
export DB_PASSWORD=your_password

# Kalshi API (optional)
export KALSHI_API_KEY=your_key
export KALSHI_API_SECRET=your_secret
```

## Start/Stop the Scheduler

### Start (Foreground)
```bash
node scheduler.js daemon
```

### Start (Background)
```bash
nohup node scheduler.js daemon > logs/scheduler.log 2>&1 &
echo $! > scheduler.pid
```

### Stop
```bash
kill $(cat scheduler.pid)
```

Or if running in foreground: `Ctrl+C` (graceful shutdown).

## Logs

Logs are written to:
- Console (stdout/stderr)
- `backend/logs/` (when running as daemon with redirection)

Each job logs:
- Start time
- Completion status
- Duration
- Output (stdout/stderr on failure)

## Error Handling

- Failed jobs are retried with exponential backoff
- After max retries, the job is skipped until next interval
- Scheduler continues running even if individual jobs fail
- Graceful shutdown on SIGINT/SIGTERM

## Adding New Pipelines

Add to the `JOBS` array in `scheduler.js`:

```javascript
{
  name: "my_pipeline",
  script: path.join(__dirname, "path/to/script.js"),
  type: "node", // or "python"
  intervalMs: 5 * 60 * 1000, // 5 minutes
  retryAttempts: 3,
  retryDelayMs: 5000,
  cwd: optionalWorkingDirectory, // for Python scripts
}
```

## Cron Alternative

If you prefer cron, use these entries:

```cron
# Market data every 5 minutes
*/5 * * * * cd /path/to/backend && node pipeline/fetch_markets.js >> logs/fetch_markets.log 2>&1

# Prices every minute
* * * * * cd /path/to/backend && node pipeline/fetch_prices.js >> logs/fetch_prices.log 2>&1

# Positions every 5 minutes
*/5 * * * * cd /path/to/backend && node pipeline/sync_positions.js >> logs/sync_positions.log 2>&1

# Economic scanner every 15 minutes
*/15 * * * * cd /path/to/agents/grace/output && python3 econ_edge_scanner.py >> econ_scanner.log 2>&1

# Crypto analysis every 10 minutes
*/10 * * * * cd /path/to/agents/dave/output && python3 crypto_edge_analysis.py >> crypto_analysis.log 2>&1
```
