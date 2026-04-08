# Runbook: Live Trading Safety Gate

**task_id:** T989-followup (addresses FINDING-1 from Heidi's threat model)
**agent_name:** liam
**timestamp:** 2026-04-07T00:00:00Z
**status:** ACTIVE RUNBOOK

---

## Purpose

Prevent accidental real-money order submission when transitioning from paper to live trading.
Addresses **T989 FINDING-1** (MEDIUM — financial risk): no double-opt-in guard before real orders.

---

## The Problem

The live execution path is:
```
EXECUTE_TRADES=true && PAPER_TRADING=false → ExecutionEngine({ demoMode: false }) → real orders
```

Only **2 conditions** away from irreversible real-money trades. A mistyped env var at the shell
silently bypasses paper trading mode.

---

## Required Safeguard: KALSHI_CONFIRM_LIVE

Before any production cutover, `KALSHI_CONFIRM_LIVE=I_UNDERSTAND_REAL_ORDERS` **must** be set as
a second explicit confirmation. This is **live in `live_runner.js:591`** as of T995 (Bob, 2026-04-07):

```js
// live_runner.js:591 — Bob (T995)
if (process.env.KALSHI_CONFIRM_LIVE !== 'I_UNDERSTAND_REAL_ORDERS') {
  throw new Error(
    '[SAFETY GATE] Live trading blocked: KALSHI_CONFIRM_LIVE is not set.\n' +
    "Set KALSHI_CONFIRM_LIVE='I_UNDERSTAND_REAL_ORDERS' to explicitly confirm live order intent."
  );
}
console.log("  ✅ KALSHI_CONFIRM_LIVE confirmed — double-opt-in verified");
```

**Status:** ✅ Implemented and approved — T995 (Bob), T989 FINDING-1 resolved.

---

## Pre-Production Safety Checklist (SRE Gate)

Run this checklist **before** any operator sets `PAPER_TRADING=false`:

### 1. Environment Audit
```bash
# Confirm no accidental live flags in current shell
env | grep -E 'KALSHI|PAPER|EXECUTE'

# Expected safe state:
# PAPER_TRADING=true
# EXECUTE_TRADES=false
# KALSHI_CONFIRM_LIVE=<unset or false>
```

### 2. API Credentials Confirmed
```bash
# T236: Founder must have provided Kalshi API credentials
[[ -n "$KALSHI_API_KEY" ]] && echo "✅ API key set" || echo "❌ BLOCKED: no API key"
```

### 3. Risk Limits Verified
```bash
# Confirm risk_policy.json is loaded and limits are active
node -e "const p = require('./output/heidi/risk_policy.json'); console.log('Max position:', p.max_position_size); console.log('Daily loss limit:', p.daily_loss_limit);"

# Expected:
# Max position: 1000
# Daily loss limit: 500
```

### 4. Circuit Breakers Active
```bash
# Confirm kill switch is armed
curl -s http://localhost:3199/api/health -H "Authorization: Bearer $API_KEY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Kill switch:', d.get('killSwitch','unknown'))"
```

### 5. Paper Trading Win Rate ≥ 40%
- Heidi's checklist (T318): Sprint 5 win rate was 35% — below acceptable threshold
- Do NOT go live until win rate ≥ 40% over ≥ 100 paper trades
- Check: `curl http://localhost:3199/api/pnl/live`

### 6. Double-Opt-In Guard Implemented (BLOCKING)
- Bob must have merged `KALSHI_CONFIRM_LIVE` guard into `live_runner.js`
- Verify: `grep -n 'KALSHI_CONFIRM_LIVE' output/shared/codebase/backend/live_runner.js`

---

## Go-Live Procedure (when all gates pass)

```bash
# Step 1: Set credentials
export KALSHI_API_KEY="<founder-provided>"
export PAPER_TRADING=false

# Step 2: Explicit double-opt-in (intentional, not accidental)
export KALSHI_CONFIRM_LIVE=I_UNDERSTAND_REAL_ORDERS

# Step 3: Dry run first (logs orders without submitting)
node live_runner.js --paper --execute 2>&1 | head -50

# Step 4: Review signal output — confirm signal count, confidence scores
# Expected: ≥1 signal with confidence ≥0.80

# Step 5: Go live (ONE operator, with a second watching)
export EXECUTE_TRADES=true
node live_runner.js
```

---

## Rollback Procedure

If anything looks wrong after go-live:

```bash
# Immediate halt — unset live flags
export PAPER_TRADING=true
export KALSHI_CONFIRM_LIVE=false
export EXECUTE_TRADES=false

# Restart pipeline in paper mode
node live_runner.js --paper
```

Check open positions via Kalshi dashboard — any open positions placed during the window
must be manually reviewed by the Founder.

---

## Incident Response: Accidental Live Order Submitted

**Severity:** P0 — financial

1. **Immediately:** Kill `live_runner.js` — `pkill -f live_runner`
2. **Check Kalshi dashboard** for any submitted orders — cancel if possible
3. **Alert Founder** — provide order IDs and timestamps
4. **Do NOT restart** until Founder approves
5. **Postmortem** within 24h — identify which safety gate was bypassed

**Escalation:** Liam (SRE) → Alice (Lead) → Founder (final authority on live trading)

---

## SLOs for Live Trading

Once live (baselines from T951 — Nick, 2026-04-07):

| Signal | Baseline | SLO | Alert Threshold | Source |
|--------|----------|-----|-----------------|--------|
| Phase 3 latency p95 (real ivan data, 79 pairs) | 0.45ms | < 2s | > 5ms | T951 |
| Phase 3 latency p95 (large: 50+ pairs/cluster) | 5.93ms | < 50ms | > 20ms | T951 scaling table |
| Markets per cluster (O(n²) scaling guard) | 2–11 | ≤ 20 markets | > 20 markets/cluster | T951 recommendation |
| Order submission success rate | — | ≥ 99% | < 95% | Heidi T989 |
| Daily P&L vs risk limit | — | Loss < $500/day | Loss > $400/day | Heidi T318 |
| Live win rate (rolling 50 trades) | 35% (paper) | ≥ 40% | < 35% | T318 |
| API error rate | — | < 1% | > 2% | — |
| `/api/agents` warm latency | 17ms | < 100ms | > 500ms | T956 |

**Key insight from T951:** The pipeline is not latency-constrained at current scale (4,400× under 2s SLO).
The only scaling risk is cluster size growth — a single cluster > 20 markets triggers O(n²) pair explosion.
If Ivan's Phase 2 output ever produces clusters > 20 markets, alert and cap before Phase 3 runs.

---

## Related Artifacts

| Artifact | Owner | Status |
|----------|-------|--------|
| `output/heidi/threat_model_live_trading.md` | Heidi | CONDITIONAL PASS |
| `output/heidi/live_readiness_checklist.md` | Heidi | NOT READY (T236 blocked) |
| `output/heidi/risk_manager.js` | Heidi | ✅ Implemented |
| `KALSHI_CONFIRM_LIVE=I_UNDERSTAND_REAL_ORDERS` guard in live_runner.js:591 | Bob | ✅ Implemented (T995) |
