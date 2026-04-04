# D004 Engine Monitoring Dashboard — Task T426

**Author:** Liam (SRE)  
**Date:** 2026-04-03  
**Status:** Complete

---

## Overview

Real-time monitoring dashboard for the D004 C++ Execution Engine. Provides live metrics, P&L tracking, trade history, and alerting.

---

## Features

### Real-Time Metrics
- **Engine Status:** running, stopped, unhealthy, unknown
- **Heartbeat Monitoring:** Detects missing heartbeats (>10s = unhealthy)
- **Key Metrics:**
  - Total trades
  - Realized P&L (cents → dollars)
  - Total exposure
  - Open positions
  - Circuit breaker status

### Visual Dashboard
- Live status indicator with color coding
- P&L chart (last 100 data points)
- Active alerts panel with acknowledge button
- Recent trades table (last 50 trades)
- Auto-refresh every second

### Alerting
- **Auto-detected alerts:**
  - Circuit breaker triggered
  - Heartbeat loss (>10s)
- **Manual alerts:** Can be extended for other conditions
- **Acknowledgment:** Alerts can be acknowledged via UI

---

## Installation

No additional dependencies required. Uses only Node.js built-ins.

---

## Usage

### Start Dashboard

```bash
# Default port (3250)
node backend/monitoring/engine_dashboard.js

# Custom port
export DASHBOARD_PORT=8080
node backend/monitoring/engine_dashboard.js

# Custom log path
export ENGINE_LOG=/custom/path/engine.log
node backend/monitoring/engine_dashboard.js
```

### Access Dashboard

Open browser to: `http://localhost:3250`

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard HTML |
| `/api/health` | GET | Health status |
| `/api/metrics` | GET | Current metrics + history |
| `/api/trades` | GET | Recent trades |
| `/api/alerts` | GET | Active alerts |
| `/api/alerts` | POST | Acknowledge alert |

---

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DASHBOARD_PORT` | 3250 | HTTP server port |
| `ENGINE_LOG` | `/var/log/kalshi-engine/engine.log` | Path to engine log file |
| `ALERTS_FILE` | `agents/liam/output/alerts.json` | Path to alerts file |

---

## Integration with C++ Engine

The dashboard tails the engine log file and parses:

### Heartbeat Lines
```
[HEARTBEAT] Trades=42 PnL=12.34 Exposure=567.89 Positions=3 CB=NO
```

### Trade Lines (if present)
```
[EXECUTED] BTC-YES: 10 contracts @ 45c
```

### Log Format Expected
The dashboard expects the C++ engine to output heartbeats to stdout/log in the format above.

---

## Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| No heartbeat > 10s | Critical | Dashboard shows unhealthy + alert |
| Circuit breaker triggered | Critical | Alert created |

---

## Running as a Service

### systemd

Create `/etc/systemd/system/d004-dashboard.service`:

```ini
[Unit]
Description=D004 Engine Monitoring Dashboard
After=network.target

[Service]
Type=simple
User=kalshi-trader
WorkingDirectory=/opt/kalshi-engine

Environment="DASHBOARD_PORT=3250"
Environment="ENGINE_LOG=/var/log/kalshi-engine/engine.log"

ExecStart=/usr/bin/node backend/monitoring/engine_dashboard.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable d004-dashboard
sudo systemctl start d004-dashboard
```

---

## Screenshots

### Dashboard Layout
```
┌─────────────────────────────────────────────────────────────┐
│  🔥 D004 Engine Dashboard                        [running]  │
├─────────────────────────────────────────────────────────────┤
│  Engine: RUNNING    Last Heartbeat: 2s ago    Uptime: 1h 5m │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Trades   │  │ P&L      │  │ Exposure │  │ Positions│   │
│  │ 42       │  │ $12.34   │  │ $567.89  │  │ 3        │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
├─────────────────────────────────────────────────────────────┤
│  P&L Over Time                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    📈 CHART                           │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  Active Alerts                                              │
│  ⚠️  No active alerts                                       │
├─────────────────────────────────────────────────────────────┤
│  Recent Trades                                              │
│  Time        Market         Contracts    Price              │
│  14:30:15    BTC-YES        10           45c                │
└─────────────────────────────────────────────────────────────┘
```

---

## Future Enhancements

1. **WebSocket Support:** Real-time push instead of polling
2. **Historical Data:** Persist metrics to database
3. **More Alerts:** Error rate, latency thresholds
4. **Mobile View:** Responsive design improvements
5. **Authentication:** Login for production use

---

## Troubleshooting

### Dashboard shows "unknown" status
- Check that `ENGINE_LOG` path is correct
- Verify engine is running and outputting heartbeats
- Check file permissions on log file

### No data in charts
- Engine may not be running
- Log format may not match expected pattern
- Check browser console for JavaScript errors

### Alerts not appearing
- Alerts are created automatically for CB and heartbeat loss
- Check that alerts are not already acknowledged

---

## Related Files

| File | Description |
|------|-------------|
| `backend/monitoring/engine_dashboard.js` | Main dashboard server |
| `agents/liam/output/t426_dashboard_documentation.md` | This document |

---

*Document maintained by Liam (SRE)*
