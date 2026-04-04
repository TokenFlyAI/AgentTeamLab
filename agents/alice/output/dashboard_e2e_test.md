# Dashboard E2E Smoke Test Report

**Date**: 2026-04-03  
**Tester**: Alice (Lead Coordinator)  
**Task**: #248 — End-to-end dashboard smoke test  
**Dashboard**: http://localhost:3200  
**Server**: `agents/bob/backend/dashboard_api.js`

---

## Summary

| Category | Result |
|----------|--------|
| Endpoints tested | 5/5 |
| Endpoints passing | 5/5 |
| Scheduler run | ✅ PASS |
| Overall status | **✅ ALL PASS** |

---

## Endpoint Tests

### 1. GET /api/health — Strategy Health
- **Status**: ✅ PASS (HTTP 200)
- **Response**: Returns health status for 5 strategies
- **Strategies**:
  | Strategy | Status | Signals |
  |----------|--------|---------|
  | mean_reversion | OK | 2 |
  | momentum | OK | 2 |
  | crypto_edge | OK | 3 |
  | nfp_nowcast | NO_DATA | 0 |
  | econ_edge | NO_DATA | 0 |
- **Notes**: `nfp_nowcast` and `econ_edge` show NO_DATA (expected — no live Kalshi API key)

---

### 2. GET /api/signals — Trade Signals
- **Status**: ✅ PASS (HTTP 200)
- **Response**: 7 signals across 3 strategies, 5 markets
- **Signal breakdown**:
  - mean_reversion: 2 signals (BTCW-26-JUN30-100K, ETHW-26-DEC31-5K)
  - momentum: 2 signals
  - crypto_edge: 3 signals
- **Markets loaded**: 5 (m1–m5, Crypto + Economics categories)
- **Data source**: `mock_fallback` (expected without live API key)

---

### 3. GET /api/markets — Market Data
- **Status**: ✅ PASS (HTTP 200)
- **Response**: 5 markets returned
- **Markets**:
  | Ticker | Category | Yes Mid | Volume |
  |--------|----------|---------|--------|
  | BTCW-26-JUN30-100K | Crypto | 64¢ | 890,000 |
  | BTCW-26-JUN30-80K | Crypto | 84¢ | 720,000 |
  | ETHW-26-DEC31-5K | Crypto | 30¢ | 540,000 |
  | INXW-25-DEC31 | Economics | 86¢ | 250,000 |
  | UNEMP-25-MAR | Economics | 56¢ | 90,000 |

---

### 4. GET /api/edges — Economic Edges
- **Status**: ✅ PASS (HTTP 200)
- **Response**: 3 edges from NFP nowcast model
- **Top edges**:
  | Ticker | Edge % | Recommendation |
  |--------|--------|----------------|
  | KXNF-20260501-T100000 | -66.9% | BUY NO |
  | KXNF-20260501-T150000 | -52.0% | BUY NO |
  | KXNF-20260501-T200000 | -28.0% | BUY NO |
- **Data freshness**: Generated 2026-04-01 (stale, expected — no live econ data feed)

---

### 5. GET /api/pnl — P&L Summary
- **Status**: ✅ PASS (HTTP 200)
- **Response**: Paper trade log returns empty (0 completed trades)
- **Fields returned**: total_pnl=0, win_rate=0, total_trades=0, daily_pnl (3-day array)
- **Notes**: Expected — paper trading in mock mode, no closed positions yet

---

## Scheduler Run (POST /api/run-pipeline)

- **Status**: ✅ PASS (HTTP 200)
- **Elapsed**: 853ms
- **Signal count post-run**: 8 signals
- **Generated at**: 2026-04-03T01:25:28.100Z
- **live_runner.js exists**: ✅ Yes (`agents/bob/backend/strategies/live_runner.js`)

**Post-run health verification**:
| Strategy | Status | Signals |
|----------|--------|---------|
| mean_reversion | OK | 2 |
| momentum | OK | 3 |
| crypto_edge | OK | 3 |
| nfp_nowcast | NO_DATA | 0 |
| econ_edge | NO_DATA | 0 |

---

## Issues Found

| Severity | Issue | Impact |
|----------|-------|--------|
| INFO | `nfp_nowcast` and `econ_edge` show NO_DATA | Expected — requires KALSHI_API_KEY |
| INFO | P&L shows 0 trades | Expected — paper trading in mock mode |
| INFO | Edges data from 2026-04-01 (2 days old) | Low — no live data feed configured |

**No blocking issues.** All endpoints respond correctly with valid JSON. The dashboard is fully operational in mock/paper-trade mode.

---

## Conclusion

The Kalshi Alpha Dashboard at localhost:3200 passes all smoke tests. All 5 API endpoints return valid responses with HTTP 200. The pipeline scheduler runs successfully and generates 8 trade signals in under 1 second. The system is ready for live operation pending KALSHI_API_KEY configuration.

**Recommendation**: Obtain KALSHI_API_KEY from kalshi.com to enable live market data and actual trade execution.
