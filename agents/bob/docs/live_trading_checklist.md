# Live Trading Checklist — Task 335

**Version:** 1.0  
**Date:** 2026-04-03  
**Owner:** Grace (Data Engineer)  
**Approver:** Founder (T236 unblock required)

---

## Overview

This checklist is the final gate before live trading authorization. All items must be completed and verified before the trading system can execute real orders on Kalshi.

**Prerequisites:**
- [ ] T236: Kalshi API credentials obtained from Founder
- [ ] Sprint 7 completion (all P0 bugs resolved)
- [ ] Automated prep script executed successfully

---

## Phase 1: Pre-Flight (Automated)

Run the automated prep script:
```bash
cd agents/bob
export KALSHI_API_KEY="your_api_key_here"
bash backend/scripts/live_trading_prep.sh
```

### 1.1 Environment Validation

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.1.1 | Node.js v18+ installed | ⬜ | `node --version` |
| 1.1.2 | All npm dependencies installed | ⬜ | `npm install` |
| 1.1.3 | Required files present | ⬜ | live_runner.js, signal_engine.js, kalshi_client.js |
| 1.1.4 | Log directory writable | ⬜ | `logs/` exists and writable |
| 1.1.5 | Output directory writable | ⬜ | `output/` exists and writable |

### 1.2 Credential Validation

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.2.1 | KALSHI_API_KEY provided | ⬜ | From Founder (T236) |
| 1.2.2 | API key format valid | ⬜ | Starts with `kalshi_` or similar |
| 1.2.3 | API connectivity confirmed | ⬜ | Test endpoint returns 200 |
| 1.2.4 | Demo mode working | ⬜ | `KALSHI_DEMO=true` test |
| 1.2.5 | Rate limits understood | ⬜ | Documented: 100 req/min |

### 1.3 Strategy Configuration

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.3.1 | zScoreThreshold = 1.5 | ⬜ | Aligned with backtest |
| 1.3.2 | minVolume = 10000 | ⬜ | Aligned with backtest |
| 1.3.3 | CANDLE_DAYS = 30 | ⬜ | Aligned with backtest |
| 1.3.4 | minConfidence = 0.80 | ⬜ | Culture #4 compliance |
| 1.3.5 | momentum DISABLED | ⬜ | Code review |
| 1.3.6 | crypto_edge DISABLED | ⬜ | Code review |
| 1.3.7 | nfp_nowcast reviewed | ⬜ | May be active |
| 1.3.8 | econ_edge reviewed | ⬜ | May be active |

---

## Phase 2: Paper Trading Gate

### 2.1 Paper Trade Execution

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.1.1 | Minimum 10 paper trades executed | ⬜ | With real Kalshi API data |
| 2.1.2 | All trades logged to database | ⬜ | `output/paper_trades.db` |
| 2.1.3 | No NULL confidence values | ⬜ | T328 fix verified |
| 2.1.4 | Signal diversity confirmed | ⬜ | Not all confidence=0.95 |
| 2.1.5 | Market variety confirmed | ⬜ | At least 3 different markets |

### 2.2 Performance Metrics

| # | Metric | Minimum | Target | Actual | Pass |
|---|--------|---------|--------|--------|------|
| 2.2.1 | Win Rate | 40% | 50%+ | ____ | ⬜ |
| 2.2.2 | Total Trades | 10 | 20+ | ____ | ⬜ |
| 2.2.3 | Max Drawdown | $50 | $30 | ____ | ⬜ |
| 2.2.4 | Avg P&L/Trade | -$0.10 | +$0.10 | ____ | ⬜ |
| 2.2.5 | Sharpe Ratio | 0.0 | 0.2+ | ____ | ⬜ |

### 2.3 Statistical Validation

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.3.1 | Win rate vs backtest gap < 15pp | ⬜ | Backtest: 55.9% |
| 2.3.2 | P-value > 0.05 (not significant) | ⬜ | `divergence_analyzer.js` |
| 2.3.3 | No consecutive loss streak > 10 | ⬜ | Risk management |
| 2.3.4 | All markets tested | ⬜ | At least 3 markets |

---

## Phase 3: Security Review

### 3.1 Code Security

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 3.1.1 | No hardcoded API keys | ⬜ | `grep -r "apiKey.*=" backend/` |
| 3.1.2 | PAPER_TRADING safeguard active | ⬜ | Default: true |
| 3.1.3 | No debug logging of credentials | ⬜ | Review log statements |
| 3.1.4 | Error messages don't leak secrets | ⬜ | Test error paths |
| 3.1.5 | File permissions appropriate | ⬜ | No world-writable config |

### 3.2 Access Control

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 3.2.1 | API key stored in environment | ⬜ | Not in code or logs |
| 3.2.2 | `.env` file in `.gitignore` | ⬜ | Prevent accidental commit |
| 3.2.3 | Log rotation configured | ⬜ | Prevent disk fill |
| 3.2.4 | Sensitive data masked in logs | ⬜ | API keys, PII |

---

## Phase 4: Monitoring Setup

### 4.1 Dashboard Verification

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.1.1 | Dashboard API accessible | ⬜ | `localhost:3200` |
| 4.1.2 | Health endpoint responding | ⬜ | `/api/health` |
| 4.1.3 | PnL endpoint functional | ⬜ | `/api/pnl/live` |
| 4.1.4 | Paper trades endpoint functional | ⬜ | `/api/paper-trades` |
| 4.1.5 | WebSocket connections stable | ⬜ | Real-time updates |

### 4.2 Alerting Configuration

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.2.1 | Daily loss limit alert | ⬜ | $50 threshold |
| 4.2.2 | Consecutive loss alert | ⬜ | 5+ losses |
| 4.2.3 | API error rate alert | ⬜ | >10% failure |
| 4.2.4 | Position size anomaly alert | ⬜ | >100 contracts |
| 4.2.5 | Escalation contact configured | ⬜ | Alice + Founder |

### 4.3 Logging & Observability

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.3.1 | Structured logging enabled | ⬜ | JSON format |
| 4.3.2 | Trade execution logs | ⬜ | Entry, exit, P&L |
| 4.3.3 | Signal generation logs | ⬜ | Confidence, edge |
| 4.3.4 | Error logs with stack traces | ⬜ | Debug capability |
| 4.3.5 | Log aggregation configured | ⬜ | Centralized logging |

---

## Phase 5: Operational Readiness

### 5.1 Runbook Verification

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.1.1 | Start/stop procedures documented | ⬜ | `docs/operations.md` |
| 5.1.2 | Emergency stop procedure known | ⬜ | Kill switch location |
| 5.1.3 | Rollback procedure documented | ⬜ | Previous version |
| 5.1.4 | Incident response contacts | ⬜ | Alice, Founder, Eve |
| 5.1.5 | On-call rotation defined | ⬜ | Schedule posted |

### 5.2 Capacity Planning

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.2.1 | Rate limit headroom confirmed | ⬜ | <80% of 100 req/min |
| 5.2.2 | Database capacity confirmed | ⬜ | <80% disk usage |
| 5.2.3 | Memory usage profiled | ⬜ | <80% RAM |
| 5.2.4 | CPU usage profiled | ⬜ | <80% CPU |

### 5.3 Compliance

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.3.1 | Kalshi TOS compliance verified | ⬜ | Automated trading allowed |
| 5.3.2 | Position limits understood | ⬜ | Per-market limits |
| 5.3.3 | P&L tracking for taxes | ⬜ | Audit trail complete |
| 5.3.4 | Data retention policy | ⬜ | 7 years |

---

## Sign-Off

### Pre-Flight Script
- [ ] Script executed: `bash backend/scripts/live_trading_prep.sh`
- [ ] Decision: ____ (GO / GO WITH CAUTION / NO-GO)
- [ ] Report generated: `output/live_trading_prep_report.md`

### Technical Review
| Role | Name | Signature | Date |
|------|------|-----------|------|
| Data Engineer | Grace | _____________ | _______ |
| Backend Engineer | Bob | _____________ | _______ |
| DevOps | Eve | _____________ | _______ |
| Security | Heidi | _____________ | _______ |

### Business Approval
| Role | Name | Signature | Date |
|------|------|-----------|------|
| Lead Coordinator | Alice | _____________ | _______ |
| Founder | CEO | _____________ | _______ |

---

## Post-Authorization Monitoring

### First 24 Hours
- [ ] Monitor every 30 minutes
- [ ] Verify trade execution latency < 2s
- [ ] Confirm P&L tracking accuracy
- [ ] Check for unexpected errors

### First Week
- [ ] Daily win rate review
- [ ] Daily max drawdown review
- [ ] Compare to paper trade baseline
- [ ] Adjust position sizing if needed

### Ongoing
- [ ] Weekly performance review
- [ ] Monthly strategy review
- [ ] Quarterly backtest re-validation

---

## Emergency Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| Primary | Alice (Lead Coordinator) | @alice |
| Technical | Grace (Data Engineer) | @grace |
| Infrastructure | Eve (DevOps) | @eve |
| Security | Heidi (Security) | @heidi |
| Executive | Founder | @ceo |

---

## Appendix: Quick Reference

### Command Cheat Sheet
```bash
# Run paper trades
node backend/strategies/live_runner.js --execute

# Check P&L
curl http://localhost:3200/api/pnl/live

# View paper trades
curl http://localhost:3200/api/paper-trades

# Run divergence analyzer
node backend/scripts/divergence_analyzer.js

# Emergency stop
pkill -f live_runner.js
```

### Key Metrics Thresholds
| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Win Rate | < 45% | < 40% | Review strategy |
| Drawdown | > $30 | > $50 | Stop trading |
| Latency | > 1s | > 2s | Check API |
| Error Rate | > 5% | > 10% | Investigate |

---

*Checklist Version 1.0 — Generated 2026-04-03*
