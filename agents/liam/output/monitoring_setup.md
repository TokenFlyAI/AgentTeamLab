# Trading Operations Monitoring Setup

**Task**: #238  
**Author**: Liam (SRE)  
**Date**: 2026-04-01  

---

## Overview

This document describes the monitoring and alerting infrastructure for trading operations at Agent Planet. The system provides visibility into:

1. **Strategy API Health** — Is the trading system reachable?
2. **Trade Execution** — Are trades failing? Is there a failure spike?
3. **P&L Anomalies** — Are we losing too much money? Is drawdown excessive?
4. **Data Pipeline Health** — Are market data scrapers running?

---

## Quick Start

### Start Monitoring

```bash
# From project root
node agents/liam/output/monitoring.js

# Or as a background service
nohup node agents/liam/output/monitoring.js > logs/trading_monitor.log 2>&1 &
```

### Integration with Live Runner

Add monitoring to `live_runner.js`:

```javascript
const { MonitoringService } = require("../../liam/output/monitoring");

const monitor = new MonitoringService();
await monitor.start();

// After trade execution
monitor.recordTradeExecution(executionReport);

// After P&L update
monitor.updatePnlMetrics(pnlReport);

// Update pipeline status
monitor.updatePipelineStatus("econScanner", "running", new Date().toISOString());
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Strategy API   │◄────│  Health Checks   │────►│  Alert Manager  │
│  (server.js)    │     │  (30s interval)  │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐              │
│  Execution      │────►│  Metrics         │──────────────┘
│  Engine         │     │  Collector       │
└─────────────────┘     └──────────────────┘
                              ▲
┌─────────────────┐           │
│  Data Pipelines │───────────┘
│  (Grace/Dave)   │
└─────────────────┘
```

---

## Alert Reference

| ID | Name | Severity | Condition | Runbook |
|----|------|----------|-----------|---------|
| ALT-101 | strategy_api_down | P0-Critical | 3+ consecutive health failures | Restart server.js |
| ALT-102 | trade_failure_spike | P1-High | 5+ failures in 5 minutes | Check Kalshi API, review logs |
| ALT-103 | daily_loss_limit | P1-High | Daily loss > $500 | Review positions, risk-off |
| ALT-104 | max_drawdown | P1-High | Drawdown > 10% | Evaluate strategies |
| ALT-105 | pipeline_stale_econ | P2-Medium | Econ scanner > 1h stale | Check Grace's scanner |
| ALT-106 | pipeline_stale_crypto | P2-Medium | Crypto scanner > 1h stale | Check Dave's scanner |
| ALT-107 | low_sharpe_ratio | P2-Medium | Sharpe < 0.5 after 20 trades | Review strategy quality |
| ALT-108 | no_trades_24h | P2-Medium | No trades in 24h | Verify scheduler |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRADING_ALERT_WEBHOOK` | null | Webhook URL for alerts |
| `STRATEGY_API_PORT` | 3200 | Port for health checks |

### Alert Rules

Edit `alert_rules.json` to customize thresholds:

```json
{
  "thresholds": {
    "max_daily_loss_cents": 50000,
    "max_drawdown_percent": 0.10,
    "min_sharpe_ratio": 0.5
  }
}
```

---

## Output Files

### trading_metrics.json

Current system state updated every 30 seconds:

```json
{
  "healthCheck": {
    "lastSuccess": "2026-04-01T12:00:00Z",
    "consecutiveFailures": 0
  },
  "trades": {
    "totalExecuted": 150,
    "totalFailed": 3
  },
  "pnl": {
    "dailyRealizedCents": 12500,
    "maxDrawdownCents": 5000
  }
}
```

### trading_alerts.jsonl

One JSON line per alert fired:

```json
{"id":"ALT-102-123456","type":"trade_failure_spike","severity":"P1-High","message":"Trade failure spike: 7 failures in last 5 minutes","loggedAt":"2026-04-01T12:05:00Z"}
```

---

## Runbooks

### ALT-101: Strategy API Down

1. Check if process is running: `pgrep -f "node.*server.js"`
2. Check logs: `tail -50 logs/server.log`
3. Restart: `node server.js --dir . --port 3200 &`
4. Verify: `curl http://localhost:3200/api/health`

### ALT-102: Trade Failure Spike

1. Check Kalshi API status
2. Review recent errors: `tail -100 logs/trading_alerts.jsonl | grep ALT-102`
3. Check execution_engine logs
4. If API issue, wait for recovery
5. If persistent, escalate to Bob

### ALT-103: Daily Loss Limit

1. Check current P&L in dashboard
2. Review open positions for outliers
3. Consider:
   - Reducing position sizes
   - Pausing high-loss strategies
   - Manual position closure
4. Document decision in trading log

### ALT-104: Max Drawdown

1. Calculate current drawdown from metrics
2. Review strategy performance individually
3. Consider risk-off measures:
   - Reduce leverage
   - Tighten stop losses
   - Pause new entries
4. Escalate to trading lead if >15%

### ALT-105/106: Pipeline Stale

1. Check last run time in metrics
2. Verify scanner scripts exist:
   - `agents/grace/output/econ_edge_scanner.py`
   - `agents/dave/output/crypto_edge_analysis.py`
3. Check cron/scheduler configuration
4. Run manually to test: `python3 econ_edge_scanner.py`

---

## Testing

### Test Health Check

```bash
curl http://localhost:3200/api/health
```

### Simulate Alert

```javascript
const { MonitoringService } = require("./monitoring");
const m = new MonitoringService();

// Simulate trade failures
for (let i = 0; i < 6; i++) {
  m.recordTradeExecution({
    executed: 0,
    failed: 1,
    results: [{ status: "failed", reason: "Test failure", signal: { strategy: "test" } }]
  });
}

// Check alerts
console.log(m.collector.state.alertHistory);
```

---

## Integration Checklist

- [ ] Monitoring module deployed to `agents/liam/output/`
- [ ] Alert rules configured in `alert_rules.json`
- [ ] Environment variables set (if using webhooks)
- [ ] Log directory writable: `mkdir -p public/reports`
- [ ] Health check endpoint verified: `curl localhost:3200/api/health`
- [ ] Integration added to `live_runner.js`
- [ ] Pipeline status updates configured
- [ ] On-call rotation notified of alert thresholds

---

## SLOs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Strategy API Uptime | 99.9% | Health check success rate |
| Trade Success Rate | >95% | executed / (executed + failed) |
| Alert Latency | <60s | Time from issue to notification |
| Pipeline Freshness | <2h | Time since last successful run |

---

## Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| SRE (Monitoring) | Liam | Alice |
| Backend (API) | Bob | Alice |
| Data (Pipelines) | Grace, Dave | Alice |
| Trading Lead | Frank | Alice |
