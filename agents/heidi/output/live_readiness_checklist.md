# Live Trading Readiness Checklist
**Task:** T318  
**Author:** Heidi (Security Engineer)  
**Date:** 2026-04-03  
**Status:** 🔴 NOT READY for live trading — 1 remaining blocker

---

## Executive Summary

| Overall Status | Blockers | Ready Items |
|----------------|----------|-------------|
| 🔴 NOT READY | 1 | 6 |

**Updated:** Based on Sprint 5 completion (Culture Entry #12)

---

## Checklist Items

### 1. T236 Kalshi API Key Obtained
| | |
|:---|:---|
| **Status** | ❌ BLOCKED |
| **Owner** | Founder/CEO |
| **Action Needed** | Obtain API key from kalshi.com |

**Details:**
- Current state: Using mock fallback data
- Live trading requires real Kalshi API credentials
- **This is the ONLY remaining blocker for live trading**

---

### 2. API Key Stored in Secrets Manager
| | |
|:---|:---|
| **Status** | ✅ DONE |
| **Owner** | Bob + DevOps |
| **Notes** | Verified in Security Audit 261 |

**Details:**
- ✅ Code correctly uses `process.env.KALSHI_API_KEY`
- ✅ No API keys in source code
- ✅ No API keys in logs
- ✅ kalshi_client.js throws error if key missing

---

### 3. Risk Limits Confirmed
| | |
|:---|:---|
| **Status** | ✅ DONE |
| **Owner** | Heidi (Risk Manager) |
| **Notes** | All limits implemented and tested |

**Details:**
- ✅ Max position size: 1000 contracts
- ✅ Daily loss limit: $500
- ✅ Per-trade max loss: 2% of account
- ✅ Max total exposure: $2000
- ✅ Max concentration: 25%
- ✅ Max drawdown: 10%
- ✅ Circuit breakers: 5 consecutive losses, 10% drawdown

---

### 4. Paper Trade P&L Acceptable
| | |
|:---|:---|
| **Status** | ⚠️ PARTIAL |
| **Owner** | Grace / Bob |
| **Notes** | 35% live win rate vs 55.9% backtest (21pp gap) |

**Details (Updated per Culture Entry #12):**
- ✅ 51 paper trades completed (Sprint 5 — T327)
- ✅ NULL signal_confidence bugs fixed (T331)
- ✅ Trade settlement auto-running (T330)
- ✅ /api/pnl/live endpoint working
- ⚠️ Live win rate: 35% vs backtest 55.9% (21pp gap remains)
- ⚠️ Paper PnL not yet consistently positive

**History:**
- Sprint 2: Backtest showed 55.9% win rate (209/374 trades)
- Sprint 3: Live win rate was 18.2% (fetchCandles() bug with Math.random())
- Sprint 4: Bug fixed — replaced Math.random() with deterministic PRNG
- Sprint 5: Win rate improved to 35% (51 trades), NULL confidence fixed

**Recommendation:** Continue paper trading until win rate converges to backtest or root cause of 21pp gap is identified.

---

### 5. Kill Switch Tested
| | |
|:---|:---|
| **Status** | ✅ DONE |
| **Owner** | Heidi |
| **Notes** | All circuit breakers implemented and tested |

**Details:**
- ✅ Daily loss limit circuit breaker
- ✅ Consecutive losses circuit breaker (5 losses)
- ✅ Drawdown circuit breaker (10%)
- ✅ Manual halt capability
- ✅ Auto-reset after 24 hours

---

### 6. Auth on All POST Endpoints
| | |
|:---|:---|
| **Status** | ✅ DONE |
| **Owner** | Bob |
| **Notes** | Fixed per Security Audit 261 |

**Details:**
- ✅ POST /api/run now requires Bearer token auth
- ✅ Culture Entry #3 compliance achieved

---

### 7. Confidence Threshold ≥0.80 Enforced
| | |
|:---|:---|
| **Status** | ✅ DONE |
| **Owner** | Bob |
| **Notes** | SignalEngine enforces 0.80 minimum |

**Details:**
- ✅ `minConfidence: 0.80` in SignalEngine
- ✅ Culture Entry #4 compliance verified
- ✅ NULL confidence guard added (T331)

---

## Blockers Summary

| # | Item | Severity | Owner | Status |
|---|------|----------|-------|--------|
| 1 | Kalshi API Key (T236) | **CRITICAL** | Founder | ❌ BLOCKED |

**Note:** Paper trade P&L (35% win rate) is a concern but not a hard blocker if risk limits are enforced.

---

## Go/No-Go Decision

### Current State: 🔴 NO-GO

**Cannot proceed to live trading until:**
- ❌ Founder provides Kalshi API credentials (T236)

**Additional concerns (non-blocking):**
- ⚠️ 21pp gap between live (35%) and backtest (55.9%) win rates
- ⚠️ Paper PnL not yet consistently positive

### Sign-Off Required From:
- [x] Heidi (Security) — Risk limits, kill switch, auth verified
- [x] Bob (Backend) — Auth fixed, paper trading automated
- [x] Grace (Data) — 51 paper trades delivered, NULL bugs fixed
- [ ] Founder/CEO — API credentials + final go/no-go decision

---

## Recommendations

1. **Immediate:** Founder obtain Kalshi API credentials (T236)
2. **Before live:** Run additional 50+ paper trades to validate win rate convergence
3. **Risk mitigation:** Keep daily loss limit at $500, max position at 1000 contracts for first week of live trading
4. **Monitoring:** Use dashboard to track live vs backtest divergence in real-time

---

**Task T318: COMPLETE** — Checklist updated with Sprint 5 status. Only T236 remains blocked.
