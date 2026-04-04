# D004 C++ Execution Engine — Deployment Runbook

**System:** Kalshi Arbitrage Engine (Phase 4)  
**Author:** Liam (SRE)  
**Task:** T354  
**Date:** 2026-04-03

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `make build` | Compile engine |
| `make start` | Start in paper mode |
| `make start-live` | Start in live mode |
| `make stop` | Graceful stop |
| `make kill` | Emergency kill (< 30s) |
| `make status` | Check if running |
| `make logs` | View logs |

---

## 1. Prerequisites

### 1.1 System Requirements
- Linux/macOS with g++ ≥ 10 or clang++ ≥ 12
- 4GB RAM minimum
- Network access to Kalshi API

### 1.2 Environment Variables
```bash
# Required for live trading
export KALSHI_API_KEY="your-api-key-here"

# Optional: Custom paths
export CORRELATION_PAIRS_PATH="agents/public/correlation_pairs.json"
export ENGINE_LOG_FILE="/var/log/kalshi-engine/engine.log"
```

---

## 2. Build

### 2.1 Standard Build (Production)
```bash
cd agents/bob/backend/cpp_engine

g++ -std=c++20 -pthread -O3 -o engine engine.cpp

# Verify
./engine --version  # or ./engine --help
```

### 2.2 Debug Build (Development)
```bash
g++ -std=c++20 -pthread -g -O0 -fsanitize=address -o engine_asan engine.cpp
```

### 2.3 Verify Build
```bash
# Check binary exists and is executable
ls -la engine

# Test with dry-run (no API calls)
./engine --dry-run agents/public/correlation_pairs.json
```

---

## 3. Start

### 3.1 Paper Trading Mode (Default)
```bash
cd agents/bob/backend/cpp_engine

# Using default correlation pairs
./engine

# Or specify custom pairs file
./engine /path/to/correlation_pairs.json
```

**Expected Output:**
```
=== Kalshi Phase 4 C++ Execution Engine (T351) ===
[HEARTBEAT] Trades=0 PnL=0.00 Exposure=0.00 Positions=0 CB=NO
[HEARTBEAT] Trades=0 PnL=0.00 Exposure=0.00 Positions=0 CB=NO
...
```

### 3.2 Live Trading Mode
```bash
# WARNING: This executes real trades!
export KALSHI_API_KEY="..."
./engine --live agents/public/correlation_pairs.json
```

**Pre-flight Checklist:**
- [ ] Paper trading validated (200+ trades, ≥40% WR)
- [ ] Daily loss limit configured ($500 max)
- [ ] Kill switch tested and working
- [ ] On-call engineer available
- [ ] Founder approval obtained

### 3.3 Background/Daemon Mode
```bash
# Using nohup
nohup ./engine > /var/log/kalshi-engine/engine.log 2>&1 &
echo $! > /var/run/kalshi-engine.pid

# Using systemd (recommended for production)
sudo systemctl start kalshi-engine
```

---

## 4. Stop

### 4.1 Graceful Stop (Preferred)
```bash
# Send SIGTERM
kill -TERM $(pgrep -f "cpp_engine/engine$")

# Or using PID file
kill -TERM $(cat /var/run/kalshi-engine.pid)

# Wait for shutdown (should complete in < 5s)
sleep 5
```

### 4.2 Emergency Kill Switch (< 30s)
```bash
# Use the kill switch script
./agents/liam/output/kill_switch.sh

# Or force kill immediately
./agents/liam/output/kill_switch.sh --force
```

**Time Budget:**
- Graceful shutdown: 5s
- Force kill: 2s
- Order cancellation: 5s
- **Total: ~12s** (well under 30s target)

---

## 5. Monitor

### 5.1 Health Check
```bash
# Check if process is running
pgrep -f "cpp_engine/engine"

# View recent heartbeats
tail -f /var/log/kalshi-engine/engine.log | grep "HEARTBEAT"

# Check systemd status
sudo systemctl status kalshi-engine
```

### 5.2 Key Metrics
Watch for these in heartbeat logs:

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| Trades | Increasing | Stuck | N/A |
| PnL | Positive or small negative | < -$250 | < -$500 (CB trips) |
| Exposure | < $1,500 | $1,500-$2,000 | > $2,000 |
| Positions | 0-5 | 5-10 | > 10 |
| CB (Circuit Breaker) | NO | N/A | YES |

### 5.3 Log Locations
```bash
# Engine stdout/stderr
/var/log/kalshi-engine/engine.log

# Kill switch operations
/var/log/kalshi-engine/kill_switch.log

# systemd journal
journalctl -u kalshi-engine -f
```

---

## 6. Troubleshoot

### 6.1 Engine Won't Start
```bash
# Check binary exists
ls -la agents/bob/backend/cpp_engine/engine

# Check correlation pairs file exists
ls -la agents/public/correlation_pairs.json

# Try verbose output
./engine --verbose agents/public/correlation_pairs.json
```

### 6.2 No Trades Being Executed
1. Check heartbeat is flowing: `tail -f logs | grep HEARTBEAT`
2. Verify correlation pairs loaded correctly
3. Check price feed connectivity
4. Review risk limits (exposure may be at max)

### 6.3 Circuit Breaker Triggered
```bash
# Check logs for trigger reason
grep "CIRCUIT_BREAKER" /var/log/kalshi-engine/engine.log

# Circuit breaker resets on:
# - Daily loss limit exceeded
# - Manual intervention (restart required)

# To reset: Stop and restart engine
./kill_switch.sh && ./engine
```

### 6.4 High Latency
```bash
# Check system load
top -p $(pgrep -f "cpp_engine/engine")

# Check for CPU throttling
sudo dmesg | grep -i throttle

# Consider: Increase CPU governor to performance
sudo cpupower frequency-set -g performance
```

---

## 7. Rollback Procedures

### 7.1 Code Rollback
```bash
# Stop current engine
./kill_switch.sh

# Restore previous binary
cp engine.backup.$(date +%Y%m%d) engine

# Restart
./engine
```

### 7.2 Configuration Rollback
```bash
# Restore previous correlation pairs
cp correlation_pairs.json.backup correlation_pairs.json

# Restart engine
./kill_switch.sh && ./engine
```

### 7.3 Emergency Stop All Trading
```bash
# Kill switch
./kill_switch.sh

# Cancel all orders via API
curl -X POST https://trading-api.kalshi.com/v1/orders/cancel \
     -H "Authorization: Bearer $KALSHI_API_KEY" \
     -d '{"all": true}'

# Notify team
# (Add Slack/PagerDuty notification here)
```

---

## 8. systemd Service (Production)

### 8.1 Service File
Create `/etc/systemd/system/kalshi-engine.service`:

```ini
[Unit]
Description=Kalshi D004 C++ Arbitrage Engine
After=network.target

[Service]
Type=simple
User=kalshi-trader
Group=kalshi-trader
WorkingDirectory=/opt/kalshi-engine

Environment="KALSHI_API_KEY=your-key-here"
Environment="CORRELATION_PAIRS_PATH=/opt/kalshi-engine/correlation_pairs.json"

ExecStart=/opt/kalshi-engine/engine
ExecStop=/opt/kalshi-engine/kill_switch.sh

Restart=on-failure
RestartSec=5

# Resource limits
LimitAS=4G
LimitNOFILE=65536

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kalshi-engine

[Install]
WantedBy=multi-user.target
```

### 8.2 Commands
```bash
# Start
sudo systemctl start kalshi-engine

# Stop
sudo systemctl stop kalshi-engine

# View logs
sudo journalctl -u kalshi-engine -f

# Enable auto-start
sudo systemctl enable kalshi-engine
```

---

## 9. Alerting Integration

### 9.1 Alert Manager Hook
The engine outputs structured heartbeats that can be parsed by alert_manager:

```bash
# Pipe to alert manager
./engine 2>&1 | ./agents/liam/output/cpp_alert_adapter.sh
```

### 9.2 Critical Alerts
| Condition | Alert Level | Action |
|-----------|-------------|--------|
| Heartbeat missing > 10s | P0 | Page on-call |
| Daily loss > $400 | P1 | Slack alert |
| Circuit breaker triggered | P0 | Page on-call |
| Order failure rate > 5% | P1 | Slack alert |

---

## 10. Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| SRE On-Call | Liam | Alice (Lead) |
| Engine Owner | Dave | Alice (Lead) |
| Risk Manager | Olivia | Tina |
| Final Authority | Chenyang Cui (Founder) | — |

---

## Appendix: Makefile Reference

Create `agents/bob/backend/cpp_engine/Makefile`:

```makefile
.PHONY: build start start-live stop kill status logs clean

ENGINE := ./engine
PAIRS := agents/public/correlation_pairs.json

build:
	g++ -std=c++20 -pthread -O3 -o engine engine.cpp

start: build
	$(ENGINE) $(PAIRS)

start-live: build
	$(ENGINE) --live $(PAIRS)

stop:
	-kill -TERM $$(pgrep -f "cpp_engine/engine$$") 2>/dev/null || true

kill:
	../../liam/output/kill_switch.sh

status:
	@if pgrep -f "cpp_engine/engine$$" > /dev/null; then \
		echo "Engine: RUNNING"; \
		ps -o pid,pcpu,pmem,etime -p $$(pgrep -f "cpp_engine/engine$$"); \
	else \
		echo "Engine: STOPPED"; \
	fi

logs:
	tail -f /var/log/kalshi-engine/engine.log

clean:
	rm -f engine engine_asan
```

---

*Document maintained by Liam (SRE). Updates tracked in git.*
