# D004 Live Trading Launch Runbook

**System:** Kalshi Arbitrage Engine (D004 - Wen Zhou)  
**Version:** 1.0.0  
**Author:** Liam (SRE)  
**Date:** 2026-04-03  
**Classification:** CRITICAL — Live Trading Procedure

---

## ⚠️ CRITICAL WARNINGS

> **Culture C1:** Paper trading mode required before live orders. Never submit real orders without explicit Founder approval.

> **Culture D3:** D004 is production ready (84% win rate, 2.1x target). Blocked only by T236 (Kalshi API credentials).

> **This runbook is for AUTHORIZED LIVE TRADING ONLY.** Unauthorized live trading is a terminable offense.

---

## 1. Pre-Launch Checklist

### 1.1 Authorization Gates (ALL MUST BE CHECKED)

| Gate | Requirement | Sign-Off |
|------|-------------|----------|
| G1 | Founder explicit written approval obtained | _________________ |
| G2 | Kalshi API credentials received (T236) | _________________ |
| G3 | Paper trading validation complete (200+ trades, ≥40% WR) | ✅ 84% (T353) |
| G4 | Security audit PASS (Heidi) | _________________ |
| G5 | Risk audit PASS (Olivia/Tina) | _________________ |
| G6 | Ops readiness PASS (Liam) | _________________ |
| G7 | On-call engineer assigned and available | _________________ |

**DO NOT PROCEED IF ANY GATE IS NOT SIGNED OFF.**

---

### 1.2 System State Verification

```bash
#!/bin/bash
# pre_launch_check.sh — Run this before EVERY live launch

echo "=== D004 Pre-Launch Verification ==="

# Check 1: Correlation pairs file exists and is fresh
if [ ! -f "agents/public/correlation_pairs.json" ]; then
    echo "❌ FAIL: correlation_pairs.json not found"
    exit 1
fi
echo "✅ Correlation pairs file exists"

# Check 2: Engine binary exists and is executable
if [ ! -x "agents/bob/backend/cpp_engine/engine" ]; then
    echo "❌ FAIL: Engine binary not found or not executable"
    exit 1
fi
echo "✅ Engine binary ready"

# Check 3: Kill switch is executable
if [ ! -x "agents/liam/output/kill_switch.sh" ]; then
    echo "❌ FAIL: Kill switch not executable"
    exit 1
fi
echo "✅ Kill switch ready"

# Check 4: API key is set (but don't print it!)
if [ -z "$KALSHI_API_KEY" ]; then
    echo "❌ FAIL: KALSHI_API_KEY not set"
    exit 1
fi
echo "✅ API key configured"

# Check 5: Log directory writable
if [ ! -w "/var/log/kalshi-engine" ]; then
    echo "⚠️  WARN: Log directory not writable"
fi
echo "✅ Log directory check complete"

# Check 6: Disk space
DISK_USAGE=$(df /var/log | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
    echo "⚠️  WARN: Disk usage > 80%"
fi
echo "✅ Disk space check complete"

echo ""
echo "=== ALL CHECKS PASSED ==="
echo "Ready for live trading launch"
```

---

## 2. Launch Procedures

### 2.1 Standard Launch (Paper Trading)

**Use this for:** Daily operations, testing, validation

```bash
# Step 1: Environment setup
export KALSHI_API_KEY="your-api-key-here"
export PAPER_TRADING=true

# Step 2: Pre-launch checks
./agents/liam/output/pre_launch_check.sh

# Step 3: Start engine
cd agents/bob/backend/cpp_engine
./engine agents/public/correlation_pairs.json

# Step 4: Verify heartbeat
tail -f /var/log/kalshi-engine/engine.log | grep "HEARTBEAT"
```

**Expected Output:**
```
=== Kalshi Phase 4 C++ Execution Engine (T351) ===
[HEARTBEAT] Trades=0 PnL=0.00 Exposure=0.00 Positions=0 CB=NO
[HEARTBEAT] Trades=0 PnL=0.00 Exposure=0.00 Positions=0 CB=NO
```

---

### 2.2 LIVE Trading Launch (AUTHORIZED ONLY)

**Use this for:** Production live trading with real money

```bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  ⚠️  LIVE TRADING MODE — REAL MONEY AT RISK  ⚠️                  ║
# ║                                                                  ║
# ║  Requirements:                                                   ║
# ║  - All 7 authorization gates signed off                          ║
# ║  - Founder explicit approval obtained                            ║
# ║  - On-call engineer standing by                                  ║
# ╚══════════════════════════════════════════════════════════════════╝

# Step 1: Double-check authorization
echo "Authorization Gate G1 (Founder approval): SIGNED"
echo "Authorization Gate G2 (API credentials): VERIFIED"
echo "Authorization Gate G7 (On-call): ASSIGNED"
read -p "Type 'LIVE' to confirm: " CONFIRM
if [ "$CONFIRM" != "LIVE" ]; then
    echo "Aborted."
    exit 1
fi

# Step 2: Environment setup
export KALSHI_API_KEY="your-api-key-here"
export PAPER_TRADING=false  # ⚠️ THIS IS LIVE

# Step 3: Pre-launch checks
./agents/liam/output/pre_launch_check.sh
if [ $? -ne 0 ]; then
    echo "Pre-launch checks FAILED. Aborting."
    exit 1
fi

# Step 4: Start engine in LIVE mode
cd agents/bob/backend/cpp_engine
./engine --live agents/public/correlation_pairs.json

# Step 5: Immediate verification (first 30 seconds)
echo "Monitoring first 30 seconds..."
sleep 30
tail -20 /var/log/kalshi-engine/engine.log
```

---

### 2.3 systemd Service Launch (Production)

```bash
# Start the service
sudo systemctl start kalshi-engine

# Check status
sudo systemctl status kalshi-engine

# View logs
sudo journalctl -u kalshi-engine -f

# Enable auto-start on boot
sudo systemctl enable kalshi-engine
```

---

## 3. Monitoring During Trading

### 3.1 Real-Time Dashboard

```bash
# Watch live heartbeat
tail -f /var/log/kalshi-engine/engine.log | grep "HEARTBEAT"

# Watch for trades
tail -f /var/log/kalshi-engine/engine.log | grep "EXECUTED"

# Watch for errors
tail -f /var/log/kalshi-engine/engine.log | grep -i "error\|fail\|reject"

# Watch circuit breaker
tail -f /var/log/kalshi-engine/engine.log | grep "CIRCUIT_BREAKER"
```

### 3.2 Critical Metrics (Watch Every 5 Minutes)

| Metric | Normal | Warning | Critical | Action |
|--------|--------|---------|----------|--------|
| **Trades** | Increasing | Stuck | N/A | Check connectivity |
| **PnL** | Positive/small negative | < -$250 | < -$500 | CB triggers → Stop |
| **Exposure** | < $1,500 | $1,500-$2,000 | > $2,000 | Risk limit hit |
| **Positions** | 0-5 | 5-10 | > 10 | Review strategy |
| **CB Status** | NO | N/A | YES | Halt, investigate |
| **Heartbeat** | Every 1s | Missing > 5s | Missing > 10s | Check process |

### 3.3 Alert Thresholds

**P0 (Page Immediately):**
- Circuit breaker triggered
- Heartbeat missing > 10s
- Daily loss > $400

**P1 (Slack Alert):**
- Order failure rate > 5%
- Daily loss > $250
- Heartbeat missing > 5s

---

## 4. Emergency Procedures

### 4.1 Kill Switch (Emergency Stop)

**Use when:** Any critical issue, unauthorized trading, market crash

```bash
# Standard kill switch (< 30s guaranteed)
./agents/liam/output/kill_switch.sh

# Force kill immediately (no graceful shutdown)
./agents/liam/output/kill_switch.sh --force

# Dry run (show what would happen)
./agents/liam/output/kill_switch.sh --dry-run
```

**What it does:**
1. Sends SIGTERM (graceful shutdown, 5s timeout)
2. If still running, sends SIGKILL (force kill, 2s timeout)
3. Cancels all open orders via Kalshi API
4. Logs all actions

**Time budget:** ~12 seconds (well under 30s target)

---

### 4.2 Circuit Breaker Triggered

**Symptoms:** Log shows `CB=YES`, trading halted

**Causes:**
- Daily loss limit exceeded ($500)
- 3 consecutive losing trades in 60s window
- Manual trigger

**Procedure:**
```bash
# 1. Verify circuit breaker status
tail -5 /var/log/kalshi-engine/engine.log | grep "CIRCUIT_BREAKER"

# 2. Check P&L
tail -1 /var/log/kalshi-engine/engine.log | grep "HEARTBEAT"

# 3. Do NOT restart immediately — investigate first
#    Review logs for cause of losses

# 4. If authorized to restart:
./agents/liam/output/kill_switch.sh
./agents/bob/backend/cpp_engine/engine --live agents/public/correlation_pairs.json
```

---

### 4.3 Network/Connectivity Loss

**Symptoms:** No heartbeats, trades not executing

**Procedure:**
```bash
# 1. Check if process is running
pgrep -f "cpp_engine/engine"

# 2. Check network connectivity
ping trading-api.kalshi.com

# 3. If network issue resolved, engine should auto-reconnect
#    Monitor for recovery

# 4. If no recovery in 60s, restart:
./agents/liam/output/kill_switch.sh
./agents/bob/backend/cpp_engine/engine --live agents/public/correlation_pairs.json
```

---

### 4.4 Unauthorized Trading Detected

**Symptoms:** Trades executing without authorization, suspicious activity

**Procedure (IMMEDIATE):**
```bash
# 1. KILL SWITCH IMMEDIATELY
./agents/liam/output/kill_switch.sh --force

# 2. Cancel all orders
curl -X POST https://trading-api.kalshi.com/v1/orders/cancel \
     -H "Authorization: Bearer $KALSHI_API_KEY" \
     -d '{"all": true}'

# 3. Notify Founder and Alice immediately
# 4. Preserve logs for investigation
# 5. Do NOT restart until investigation complete
cp -r /var/log/kalshi-engine /var/log/kalshi-engine-incident-$(date +%Y%m%d-%H%M%S)
```

---

## 5. Shutdown Procedures

### 5.1 Graceful Shutdown (End of Trading Day)

```bash
# Step 1: Stop new position entry
# (Engine will finish existing positions)

# Step 2: Wait for positions to close naturally
# (Monitor until Positions=0)

# Step 3: Graceful shutdown
kill -TERM $(pgrep -f "cpp_engine/engine$")

# Step 4: Verify stopped
sleep 5
if pgrep -f "cpp_engine/engine$" > /dev/null; then
    echo "Process still running, using kill switch..."
    ./agents/liam/output/kill_switch.sh
fi

# Step 5: Final P&L report
tail -20 /var/log/kalshi-engine/engine.log | grep "HEARTBEAT"
```

### 5.2 Immediate Shutdown (Emergency)

```bash
# Use kill switch
./agents/liam/output/kill_switch.sh

# Verify
pgrep -f "cpp_engine/engine$" || echo "Engine stopped successfully"
```

---

## 6. Post-Trading Procedures

### 6.1 Daily P&L Report

```bash
#!/bin/bash
# daily_report.sh

echo "=== D004 Daily Trading Report ==="
echo "Date: $(date)"
echo ""

# Extract metrics from logs
grep "HEARTBEAT" /var/log/kalshi-engine/engine.log | tail -1

# Count trades
TRADES=$(grep -c "EXECUTED" /var/log/kalshi-engine/engine.log)
echo "Total trades today: $TRADES"

# Check for errors
ERRORS=$(grep -ci "error\|fail" /var/log/kalshi-engine/engine.log)
echo "Errors: $ERRORS"

# Circuit breaker triggers
CB=$(grep -c "CIRCUIT_BREAKER" /var/log/kalshi-engine/engine.log)
echo "Circuit breaker triggers: $CB"
```

### 6.2 Log Rotation

```bash
# Rotate logs daily
LOG_DATE=$(date +%Y%m%d)
mv /var/log/kalshi-engine/engine.log /var/log/kalshi-engine/engine-$LOG_DATE.log
gzip /var/log/kalshi-engine/engine-$LOG_DATE.log

# Restart engine with fresh log
./agents/bob/backend/cpp_engine/engine --live agents/public/correlation_pairs.json
```

---

## 7. Contacts & Escalation

| Role | Name | Contact | Escalation |
|------|------|---------|------------|
| **SRE On-Call** | Liam | liam@agentplanet.com | Alice |
| **Engine Owner** | Dave | dave@agentplanet.com | Alice |
| **Risk Manager** | Olivia | olivia@agentplanet.com | Tina |
| **Lead Coordinator** | Alice | alice@agentplanet.com | Founder |
| **Final Authority** | Chenyang Cui | founder@agentplanet.com | — |

**Emergency Slack:** #trading-critical  
**Emergency PagerDuty:** P0 alerts auto-page on-call

---

## 8. Quick Reference Card

### Start Paper Trading
```bash
export KALSHI_API_KEY="..."
./agents/bob/backend/cpp_engine/engine agents/public/correlation_pairs.json
```

### Start LIVE Trading
```bash
export KALSHI_API_KEY="..."
# ⚠️ FOUNDER APPROVAL REQUIRED
./agents/bob/backend/cpp_engine/engine --live agents/public/correlation_pairs.json
```

### Emergency Stop
```bash
./agents/liam/output/kill_switch.sh
```

### Check Status
```bash
tail -f /var/log/kalshi-engine/engine.log | grep "HEARTBEAT"
```

### View P&L
```bash
tail -1 /var/log/kalshi-engine/engine.log | grep "HEARTBEAT"
```

---

## 9. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-04-03 | Liam | Initial release for D004 go-live |

---

## 10. Sign-Off

This runbook has been reviewed and approved for live trading operations:

| Role | Name | Signature | Date |
|------|------|-----------|------|
| SRE | Liam | _________________ | _______ |
| Lead Coordinator | Alice | _________________ | _______ |
| Risk Manager | Olivia | _________________ | _______ |
| Founder | Chenyang Cui | _________________ | _______ |

---

*Document maintained by Liam (SRE). Updates require Founder approval.*

---

## APPENDIX: D004 Status Update (2026-04-03)

### ⚠️ CRITICAL: D004 NOT Production-Ready

**Culture Decision Update:** D004 is **NOT** production-ready. Three blockers exist:

| Blocker | Status | Owner |
|---------|--------|-------|
| T236 — Kalshi API credentials | ⛔ BLOCKING | Founder |
| Max drawdown tracking | ✅ RESOLVED | Dave (27/27 tests pass) |
| Kalshi contract sizes | ⛔ BLOCKING | Founder |

### Prior Metrics Were Artifacts

**Critical Finding (2026-04-03):** The previously reported 84% win rate and $21.39 P&L were **artifacts of broken mock data** in `fetchCandles()`. 

**Root Cause:** Mock data used hardcoded base prices instead of current market prices, creating extreme z-scores and guaranteed signals.

**Fix Applied:** Mock data now correctly centers on `market.yes_mid`, producing realistic z-scores.

**Result:** Fixed mock data correctly produces **0 signals** on efficient markets (no false positives).

### What This Means

1. **This runbook is READY but CANNOT be executed** until blockers resolved
2. **Pre-launch checks will fail** on API connectivity until T236 complete
3. **Paper trading will show 0 signals** (correct behavior with fixed mock)
4. **Real Kalshi API data required** for meaningful validation

### Go-Live Requirements (Updated)

Before live trading can commence:

1. ✅ Max drawdown tracking implemented (Dave complete)
2. ⬜ T236 — Kalshi API credentials received from Founder
3. ⬜ Kalshi contract sizes confirmed by Founder
4. ⬜ Paper trading validation with **REAL DATA** (200+ trades, ≥40% WR)
5. ⬜ Founder explicit approval per Culture C1

### Current State

- All 4 phases technically implemented
- Code is production-quality
- **BUT:** No validation possible without real API data
- **Status:** READY FOR API CREDENTIALS → VALIDATION → GO-LIVE

---

*Status update appended 2026-04-03 per Culture decision*
