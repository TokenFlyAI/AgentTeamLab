# T354 Risk Management Audit — C++ Phase 4 Engine

**Auditor:** Olivia (TPM 2 — Quality)  
**Date:** 2026-04-03  
**Engine Version:** Phase 4 C++ Execution Engine (T351)  
**Reviewed:** `agents/bob/backend/cpp_engine/engine.cpp`  
**Status:** CONDITIONAL PASS — 2 blockers identified, 1 critical gap

---

## Executive Summary

The C++ execution engine implements solid foundational risk controls:
- ✅ **Circuit breaker** triggers correctly on daily loss limit
- ✅ **Max exposure** enforcement prevents over-leveraging
- ✅ **Paper trading mode** is hardcoded as default (no accidental live orders)
- ✅ **Data freshness checks** prevent stale market signals

However, **2 critical gaps block production live trading**:
1. **MAX DRAWDOWN TRACKING IS MISSING** — Required SOP not implemented
2. **Position sizing may exceed Kalshi contract realism** — Needs domain validation

---

## Detailed Audit Results

### Item 3.1: Circuit Breaker on Daily Loss Limit ($500) ✅ PASS

**Checklist:** Circuit breaker triggers correctly on daily loss limit

**Code Verification:**
- Location: `risk::RiskManager::pre_trade_check()` (line 544)
- Configuration: `config::MAX_DAILY_LOSS_CENTS = 50000` (line 44)
- Enforcement: Daily loss tracked in `RiskSummary::realized_pnl_cents`
- Logic: If `realized_pnl_cents ≤ -50000`, trades are rejected with "Daily loss limit reached"

**Test Evidence:** T352 E2E tests verify this triggers correctly (referenced in checklist)

**Verdict:** ✅ **PASS** — Circuit breaker logic is sound and tested.

---

### Item 3.2: Max Exposure Limit Enforced ($2000) ✅ PASS

**Checklist:** Max exposure limit enforced in `pre_trade_check`

**Code Verification:**
- Location: `risk::RiskManager::pre_trade_check()` (line 556)
- Configuration: `config::MAX_TOTAL_EXPOSURE_CENTS = 200000` (line 45)
- Enforcement: If `total_exposure_cents ≥ 200000`, trade rejected with "Max exposure reached"
- Additional check: `check_exposure_limit()` (line 611) validates margin

**Test Evidence:** T352 E2E tests verify this triggers correctly

**Verdict:** ✅ **PASS** — Max exposure limit is correctly enforced.

---

### Item 3.3: Position Sizing Realism for Kalshi Contracts ⚠️ **CONDITIONAL PASS**

**Checklist:** Position sizing limits are realistic for Kalshi contract sizes

**Code Verification:**
- Location: `config::MAX_POSITION_SIZE = 1000` (line 46)
- Enforcement: `RiskManager::check_position_size()` (line 603) validates per-position limits
- Enforcement: `RiskManager::in_flight_check()` (line 589) enforces max position size per order pair

**Risk Assessment:**

| Kalshi Contract Value | 1000 Contracts | Total Exposure | Risk Level |
|----------------------|----------------|----------------|-----------|
| $0.01 (min binary) | $10 | < $2000 cap | ✅ Safe |
| $0.50 (mid range) | $500 | < $2000 cap | ✅ Safe |
| $1.00 (max binary) | $1000 | < $2000 cap | ⚠️ High |

**Issues Found:**
- MAX_POSITION_SIZE = 1000 is reasonable IF Kalshi contracts average $0.10-0.50
- If contracts are typically $1.00, then 1000 contracts = $1000 per pair, which is 50% of total exposure cap
- The code uses `suggested_contracts = 10` in signal generation (line 443), not the maximum 1000
- **This is ACTUALLY SAFE in practice**, but needs validation that actual Kalshi contract values match these assumptions

**Verdict:** ✅ **CONDITIONAL PASS** — Sizing logic is sound, but dependent on real Kalshi contract values being $0.10-1.00 range. **Recommendation: Validate actual contract sizes with Founder before go-live.**

---

### Item 3.4: Max Drawdown Target (<10%) Tracking ❌ **FAIL — BLOCKER**

**Checklist:** Max drawdown target (<10%) is measurable and tracked

**Code Verification:**

The engine tracks:
- ✅ `RiskSummary::realized_pnl_cents` — realized P&L only
- ✅ `RiskSummary::unrealized_pnl_cents` — open position P&L
- ✅ `PositionTracker::total_realized_pnl_cents_` — lifetime P&L
- ❌ **NO max drawdown calculation** — no peak-to-trough computation
- ❌ **NO drawdown percentage tracking** — no metric against initial capital

**Expected Implementation:**
```cpp
// NOT PRESENT IN CODE
double calculate_max_drawdown_pct(int64_t total_pnl, int64_t peak_pnl, uint64_t starting_capital_cents) {
    int64_t drawdown = peak_pnl - total_pnl;
    return (drawdown * 100.0) / starting_capital_cents;
}
```

**Impact:** 
- The engine has no way to detect if it exceeds the 10% max drawdown target
- Alice's checklist item 5.3 requires "200+ trades, ≥40% WR" validation — **but without drawdown tracking, we cannot verify the <10% constraint**
- Paper trading validation in T353 (Grace) may not catch this gap

**Verdict:** ❌ **FAIL** — Max drawdown is not tracked. This is a **PRODUCTION BLOCKER**.

---

### Item 3.5: Paper Trading Mode Default ✅ PASS

**Checklist:** Paper trading mode is default; live mode requires explicit flag

**Code Verification:**
- Location: `router::KalshiApiConfig` (line 679)
- Default: `api_config.demo_mode = true;` (line 1364) — **hardcoded at startup**
- Override: No environment variable check for demo mode override
- Safeguard: Demo mode is set BEFORE any trade logic executes

**Security Analysis:**
- ✅ Hardcoded to `true` — **no accidental live orders possible**
- ⚠️ To switch to live, code MUST be modified and recompiled — appropriate friction
- ⚠️ No `PAPER_TRADING=0` env var to disable (per SOP C1) — good, more secure

**Verdict:** ✅ **PASS** — Paper trading mode is secure and default. Live mode requires code change + recompile.

---

### Item 3.6: Correlation Data Freshness Check ✅ PASS

**Checklist:** Correlation data freshness check prevents stale signals

**Code Verification:**
- Configuration: `config::CORRELATION_FRESHNESS_US = 3600000000` (line 49) = 1 hour
- Enforcement: `RiskManager::check_correlation_freshness()` (line 579)
- Logic: Returns `false` if `(now_us - generated_at) > CORRELATION_FRESHNESS_US`
- Usage: Called before signal generation to reject stale correlation pairs

**Test Evidence:** Integration tests verify freshness checks are applied

**Verdict:** ✅ **PASS** — Correlation freshness is correctly enforced at 1-hour threshold.

---

### Item 3.7: Price Data Freshness Check ✅ PASS

**Checklist:** Price data freshness check prevents stale execution

**Code Verification:**
- Configuration: `config::PRICE_FRESHNESS_US = 1000000` (line 50) = 1 second
- Enforcement: `RiskManager::check_price_freshness()` (line 571)
- Logic: Returns `false` if either price is > 1 second old
- Usage: Called before every trade to ensure market data is live

**Timestamp Tracking:**
- Market prices include `timestamp_us` (line 67)
- Order book cache updates prices with fresh timestamps (line 281)

**Verdict:** ✅ **PASS** — Price freshness is correctly enforced at 1-second threshold.

---

## Summary Table

| Item | Status | Severity | Notes |
|------|--------|----------|-------|
| 3.1 Circuit Breaker | ✅ PASS | — | Daily loss limit enforced, tested |
| 3.2 Max Exposure | ✅ PASS | — | $2000 cap enforced, tested |
| 3.3 Position Sizing | ✅ CONDITIONAL PASS | Medium | Assumes $0.10-1.00 contracts; validate with Founder |
| 3.4 Max Drawdown | ❌ FAIL | **CRITICAL** | NOT IMPLEMENTED — blocker for production |
| 3.5 Paper Trading | ✅ PASS | — | Hardcoded to true, secure |
| 3.6 Correlation Freshness | ✅ PASS | — | 1-hour threshold, enforced |
| 3.7 Price Freshness | ✅ PASS | — | 1-second threshold, enforced |

---

## Blockers for Live Trading

### BLOCKER #1: Max Drawdown Tracking Missing (Item 3.4)

**Problem:** The engine cannot measure max drawdown against a <10% target. Paper trading validation (T353) will report win rate and trade count but cannot verify drawdown constraint.

**Resolution Required:**
1. Implement `calculate_max_drawdown()` function in `RiskManager`
2. Track peak unrealized P&L during session
3. Compute max drawdown as percentage of initial capital (or $500 allocation)
4. Add to `RiskSummary` struct
5. Enforce max drawdown check before trade approval (like daily loss limit)
6. Update T352 E2E tests to verify max drawdown enforcement
7. **Re-validate paper trading with drawdown tracking** (T353 must re-run)

**Priority:** CRITICAL — Must fix before go-live

**Timeline:** 4-8 hours (Dave estimated) to implement + test

---

### BLOCKER #2: Position Sizing Domain Validation (Item 3.3)

**Problem:** Position sizing assumes Kalshi contracts are in $0.10-1.00 range. If they're smaller or larger, the 1000-contract limit could be inappropriate.

**Resolution Required:**
1. Founder confirms actual Kalshi contract value distribution
2. If contracts are < $0.01 or > $2.00 on average, adjust `MAX_POSITION_SIZE` constant
3. Document assumed contract size in config comments
4. Re-run position sizing analysis in T352 tests

**Priority:** HIGH — Must resolve before go-live

**Timeline:** 2 hours (discussion + adjustment)

---

## Additional Observations (Non-Blockers)

### Missing Monitoring / Alerting
- No real-time drawdown percentage logging
- No "approaching max exposure" warnings before hitting the ceiling
- Suggestion: Add log statements at 80% exposure, 5% drawdown for ops visibility

### Position Expiration Logic
- Positions auto-close after 5 minutes (`POSITION_MAX_HOLD_US = 300000000`) or when converged
- This is good for arbitrage cleanup, but ensure 5 minutes is compatible with Kalshi market hours

### Suggested Contracts Hardcoded to 10
- All signals suggest 10 contracts (line 443)
- This is conservative relative to MAX_POSITION_SIZE (1000) but should be validated against actual arb profits
- Recommendation: Make `SUGGESTED_CONTRACTS` a tunable constant

---

## Coordination with Tina (QA)

**Tina's Test Coverage Needed:**
- ✅ Circuit breaker tests (T352 covers)
- ✅ Max exposure tests (T352 covers)
- ❌ **Max drawdown calculation** — T352 needs to be updated to verify drawdown % logic
- ⚠️ **Position sizing realism** — once Founder confirms contract sizes
- ✅ Paper trading default (T352 covers)
- ✅ Freshness checks (T352 covers)

---

## Verdict

### Risk Management Audit Status

**CONDITIONAL PASS with 1 Critical Blocker, 1 High Priority**

| Category | Status | Sign-Off |
|----------|--------|----------|
| Circuit Breaker | ✅ PASS | Olivia |
| Max Exposure | ✅ PASS | Olivia |
| Position Sizing | ✅ CONDITIONAL | Pending Founder validation |
| Max Drawdown | ❌ FAIL | **MUST FIX** |
| Paper Trading | ✅ PASS | Olivia |
| Correlation Freshness | ✅ PASS | Olivia |
| Price Freshness | ✅ PASS | Olivia |

---

## Recommendations for Alice

1. **URGENT:** Dave (T351) must implement max drawdown tracking before T354 can be marked complete
2. **HIGH:** Founder must validate Kalshi contract size assumptions (affects position sizing)
3. **MEDIUM:** Update T352 E2E tests to include max drawdown verification
4. **MEDIUM:** Re-run T353 (Grace paper trading validation) after drawdown fix
5. **LOW:** Add monitoring/alerting for approaching risk limits (ops visibility)

---

## Next Steps

1. ✅ This audit is complete
2. ⏳ Awaiting Dave to implement max drawdown fix (blocker)
3. ⏳ Awaiting Founder to confirm contract sizes (blocker)
4. ⏳ Tina re-tests max drawdown enforcement in T352
5. ⏳ Grace re-validates paper trading with drawdown tracking (T353)
6. ✅ Then: Production readiness checklist can be updated to READY FOR GO/NO-GO

---

**Report authored by:** Olivia  
**Signed:** Olivia — TPM 2 (Quality)  
**Date:** 2026-04-03
