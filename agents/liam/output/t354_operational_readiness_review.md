# T354 Operational Readiness Review

**Reviewer:** Liam (SRE)  
**Date:** 2026-04-03  
**System:** D004 Phase 4 C++ Execution Engine (`agents/bob/backend/cpp_engine/engine`)

---

## Executive Summary

| Category | Status | Notes |
|----------|--------|-------|
| **Overall** | ⚠️ CONDITIONAL PASS | 4 items need addressing before live trading |

**Recommendation:** Address 4 operational gaps (documented below), then PASS.

---

## Section 4: Operational Readiness — Detailed Review

### 4.1 Deployment Runbook
**Status:** ❌ FAIL — Document needed

**Current State:**
- Build command is documented in source: `g++ -std=c++20 -pthread -O3 -o engine engine.cpp`
- No formal runbook exists for deploy/start/stop procedures

**Required Deliverable:**
```markdown
# C++ Engine Deployment Runbook

## Build
```bash
cd agents/bob/backend/cpp_engine
g++ -std=c++20 -pthread -O3 -o engine engine.cpp
```

## Start
```bash
# Paper trading (default)
export KALSHI_API_KEY="..."
./engine agents/public/correlation_pairs.json

# Live trading (explicit flag required)
./engine --live agents/public/correlation_pairs.json
```

## Stop
```bash
# Graceful shutdown (SIGTERM)
kill -TERM $(pgrep -f "cpp_engine/engine")

# Force kill if unresponsive (>5s)
kill -9 $(pgrep -f "cpp_engine/engine")
```

## Health Check
```bash
curl http://localhost:PORT/health  # If HTTP endpoint added
# OR
tail -f /var/log/engine.log | grep "HEARTBEAT"
```
```

---

### 4.2 Health Monitoring / Heartbeat
**Status:** ✅ PASS — Operational

**Evidence:**
```cpp
// Engine outputs heartbeat every 1 second
void health_monitor_loop() {
    while (running_) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        auto summary = get_risk_summary();
        std::cout << "[HEARTBEAT] Trades=" << summary.total_trades_today
                  << " PnL=" << summary.realized_pnl_cents / 100.0
                  << " Exposure=" << summary.total_exposure_cents / 100.0
                  << " Positions=" << summary.open_position_count
                  << " CB=" << (summary.circuit_breaker_triggered ? "YES" : "NO")
                  << std::endl;
    }
}
```

**Metrics Captured:**
- Total trades today
- Realized PnL (cents → dollars)
- Total exposure
- Open position count
- Circuit breaker status

**Gap:** No structured log format (JSON) for automated parsing.

**Recommendation:** Add JSON output option for log aggregation:
```json
{"timestamp":"2026-04-03T14:30:00Z","level":"HEARTBEAT","trades":42,"pnl_cents":1234,"exposure_cents":5678,"positions":3,"circuit_breaker":false}
```

---

### 4.3 Log Aggregation Strategy
**Status:** ❌ FAIL — Strategy needed

**Current State:**
- Engine logs to stdout only
- No log file rotation
- No centralized aggregation

**Recommended Strategy:**

```bash
# Option 1: systemd journal (production)
# /etc/systemd/system/kalshi-engine.service
[Service]
ExecStart=/opt/kalshi-engine/engine
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kalshi-engine

# View logs
journalctl -u kalshi-engine -f
```

```bash
# Option 2: File-based with rotation
./engine 2>&1 | tee -a /var/log/kalshi-engine/engine.log
# + logrotate configuration
```

```bash
# Option 3: Structured JSON to file
export ENGINE_LOG_FORMAT=json
export ENGINE_LOG_FILE=/var/log/kalshi-engine/engine.jsonl
./engine
```

**Required Deliverable:** Choose one strategy and document it.

---

### 4.4 Alerting Thresholds (SLOs)
**Status:** ❌ FAIL — Thresholds needed

**Proposed SLOs for D004 C++ Engine:**

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| **Latency** | Spread calc > 50µs | Spread calc > 100µs | Investigate CPU/memory |
| **Error Rate** | > 1% order failures | > 5% order failures | Pause trading, investigate |
| **PnL** | Daily loss > $250 | Daily loss > $500 (limit) | Circuit breaker triggers |
| **Exposure** | > $1,500 | > $2,000 (limit) | Risk manager blocks trades |
| **Heartbeat** | Missing > 5s | Missing > 10s | Alert on-call, check process |
| **Circuit Breaker** | N/A | Triggered | Halt trading, manual review |
| **Position Hold Time** | Avg > 60s | Max > 300s | Review convergence logic |

**Alert Routing:**
- Warning → Slack #trading-alerts
- Critical → PagerDuty + Slack #trading-critical

**Required Deliverable:** Implement alert_manager hook for C++ engine events.

---

### 4.5 Rollback / Kill Switch Plan
**Status:** ❌ FAIL — Procedure needed

**Current State:**
- Engine has `stop()` method that sets `running_ = false`
- Threads join gracefully
- No documented kill switch procedure

**Required Kill Switch (< 30s stop guarantee):**

```bash
#!/bin/bash
# /opt/kalshi-engine/kill_switch.sh
# Emergency stop — guaranteed < 30s

ENGINE_PID=$(pgrep -f "cpp_engine/engine$")

if [ -z "$ENGINE_PID" ]; then
    echo "Engine not running"
    exit 0
fi

echo "Stopping engine (PID: $ENGINE_PID)..."

# 1. Try graceful shutdown (5s timeout)
kill -TERM $ENGINE_PID
sleep 5

# 2. Check if still running
if ps -p $ENGINE_PID > /dev/null; then
    echo "Graceful shutdown failed, forcing..."
    kill -9 $ENGINE_PID
    sleep 1
fi

# 3. Verify stopped
if ps -p $ENGINE_PID > /dev/null; then
    echo "FAILED: Engine still running!"
    exit 1
else
    echo "Engine stopped successfully"
    
    # 4. Cancel any open orders via API
    curl -X POST https://trading-api.kalshi.com/v1/orders/cancel \
         -H "Authorization: Bearer $KALSHI_API_KEY"
    
    exit 0
fi
```

**Time Budget:**
- Graceful shutdown: 5s
- Force kill: 1s
- Order cancellation: 5s
- **Total: ~11s** (well under 30s target)

---

### 4.6 Deterministic Build from Source
**Status:** ✅ PASS — Verified

**Evidence:**
```bash
# Single command build
g++ -std=c++20 -pthread -O3 -o engine engine.cpp
```

**Verified:**
- No external dependencies beyond standard library
- No build system required (Make/CMake)
- Reproducible across platforms with g++ ≥ 10

---

## Additional Findings

### A. Signal Handling
**Status:** ⚠️ Gap identified

The engine handles SIGINT/SIGTERM via `running_` atomic flag, but:
- No explicit signal handlers registered
- Relies on destructor cleanup

**Recommendation:** Add explicit signal handlers:
```cpp
#include <csignal>

std::atomic<bool> g_shutdown{false};

void signal_handler(int sig) {
    g_shutdown = true;
}

// In main:
signal(SIGINT, signal_handler);
signal(SIGTERM, signal_handler);
```

### B. HTTP Health Endpoint
**Status:** ⚠️ Gap identified

Current health monitoring is stdout-only. For production monitoring, an HTTP endpoint is recommended:

```cpp
// Add minimal HTTP server (or use existing framework)
// GET /health → {"status":"healthy","trades":42,"pnl":12.34}
// GET /ready → {"ready":true}  // For k8s readiness probe
// POST /stop → graceful shutdown  // For orchestrated stop
```

### C. Configuration Management
**Status:** ⚠️ Gap identified

Current: Hardcoded constants in `namespace config`

Recommended: External config file:
```json
{
  "risk": {
    "max_daily_loss_cents": 50000,
    "max_exposure_cents": 200000,
    "circuit_breaker_losses": 3
  },
  "timing": {
    "heartbeat_interval_us": 30000000,
    "price_freshness_us": 1000000
  }
}
```

---

## Summary Table

| Item | Status | Priority | Owner |
|------|--------|----------|-------|
| 4.1 Deployment runbook | ❌ FAIL | HIGH | Dave + Liam |
| 4.2 Health monitoring | ✅ PASS | — | — |
| 4.3 Log aggregation | ❌ FAIL | HIGH | Liam |
| 4.4 Alerting thresholds | ❌ FAIL | HIGH | Liam |
| 4.5 Rollback/kill switch | ❌ FAIL | CRITICAL | Liam |
| 4.6 Deterministic build | ✅ PASS | — | — |

---

## Recommendations

### Before Live Trading (Must-Have)
1. **Create kill_switch.sh** — Guaranteed <30s stop
2. **Document deployment runbook** — Build/start/stop procedures
3. **Define log aggregation** — Choose systemd vs file-based
4. **Implement alerting thresholds** — Hook into alert_manager

### Nice-to-Have (Post-Launch)
5. Add JSON structured logging
6. Add HTTP health endpoint
7. External configuration file
8. Explicit signal handlers

---

## Sign-Off

**Operational Readiness:** CONDITIONAL PASS  
**Conditions:** Address 4 HIGH/CRITICAL items above  
**Re-review Required:** Yes, after fixes implemented

---

*Review completed by Liam (SRE) — 2026-04-03*
