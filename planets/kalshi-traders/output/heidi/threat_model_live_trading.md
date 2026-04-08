# T989 — Pre-Production Threat Model: Live Trading Auth & Order Execution

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-04-07
**Method:** STRIDE threat modeling
**Scope:** `live_runner.js` → `execution_engine.js` → `kalshi_client.js` → Kalshi API
**Verdict: CONDITIONAL PASS — 1 MEDIUM, 2 LOW findings. No production blockers if mitigations applied.**

---

## System Model

```
Operator (CLI)
    │
    ├─ node live_runner.js --execute      # EXECUTE_TRADES=true
    │        │  PAPER_TRADING=false       # must be explicit
    │        │  KALSHI_API_KEY=<secret>   # from env or .env via credential_manager
    │        │
    │        ▼
    │  CredentialManager (credential_manager.js)
    │        │  loads .env → process.env
    │        │  validates API key presence
    │        │  writes audit_log.jsonl
    │        │
    │        ▼
    │  KalshiClient (kalshi_client.js)
    │        │  Authorization: Bearer <apiKey>
    │        │  SimpleRateLimiter (10 req/s trading)
    │        │  HTTPS to trading-api.kalshi.com
    │        │
    │        ▼
    │  ExecutionEngine (execution_engine.js)
    │        │  executeSignals(approvedSignals, markets)
    │        │  createOrder via KalshiClient
    │        │
    │        ▼
    │  Kalshi API (external)
    │
    └─ RiskManager gates before execution
```

---

## Threat Analysis (STRIDE)

### FINDING-1: Paper Trading Bypass via Environment Mutation (MEDIUM)

**STRIDE Category:** Tampering / Elevation of Privilege
**Location:** `live_runner.js:37` — `const PAPER_TRADING = process.env.PAPER_TRADING !== 'false'`

**Issue:** The paper trading guard is a **negative check** — it defaults to paper mode, which is good. However, `PAPER_TRADING=false` is a string comparison, not a boolean. Any value that is exactly the string `"false"` disables paper trading. The risk: if any part of the codebase ever writes `process.env.PAPER_TRADING` dynamically (e.g., from a config file or API response), an attacker who can influence that string could bypass paper mode.

Additionally, the live trading execution path (`EXECUTE_TRADES && !PAPER_TRADING`) sends real orders via `ExecutionEngine` with `demoMode: false`. This path is only 2 conditions away from real order submission.

**Current mitigations:**
- `PAPER_TRADING` defaults to `true` (safe default ✓)
- `EXECUTE_TRADES` requires explicit CLI flag `--execute` (not an env var ✓)
- CredentialManager warns on `PAPER_TRADING=false && !demo` ✓

**Remaining gap:** No second-factor confirmation (e.g., a separate flag or interactive prompt) before live orders. If someone accidentally sets `PAPER_TRADING=false` in their shell and runs with `--execute`, real orders will be placed silently.

**Recommendation:**
```js
// Before live execution, require explicit double-opt-in
if (EXECUTE_TRADES && !PAPER_TRADING) {
  const confirmed = process.env.KALSHI_CONFIRM_LIVE === 'I_UNDERSTAND_REAL_ORDERS';
  if (!confirmed) {
    console.error('FATAL: Live trading requires KALSHI_CONFIRM_LIVE=I_UNDERSTAND_REAL_ORDERS');
    process.exit(1);
  }
}
```

---

### FINDING-2: API Key in Error Objects (LOW)

**STRIDE Category:** Information Disclosure
**Location:** `kalshi_client.js:165` — `error.response = body`

**Issue:** When a Kalshi API call fails, the error object attaches the full response body (`error.response = body`). If the Kalshi API ever echoes request headers (including `Authorization: Bearer <key>`) in error responses, or if the error is logged/serialized with its full properties, the API key could appear in log files.

**Current mitigations:**
- API keys are from env vars, not hardcoded ✓
- `credential_manager.summary()` masks keys for display ✓

**Remaining gap:** No scrubbing of `error.response` before it propagates up the call stack.

**Recommendation:**
```js
// In kalshi_client.js request() error handler
const safeBody = { ...body };
delete safeBody.headers; // strip if response body ever mirrors request headers
const error = new Error(safeBody?.error?.message || `HTTP ${res.statusCode}`);
error.status = res.statusCode;
error.code = safeBody?.error?.code;
// Do NOT attach: error.response = body
```

---

### FINDING-3: Rate Limiter Not Shared Across Concurrent Instances (LOW)

**STRIDE Category:** Denial of Service
**Location:** `kalshi_client.js:34` — `class SimpleRateLimiter`

**Issue:** The `SimpleRateLimiter` is per-instance. If multiple `KalshiClient` instances are created (e.g., in tests or parallel strategy runners), each gets its own rate limit window. Combined, they could exceed Kalshi's 10 req/s trading limit, triggering API-level 429 errors or account-level rate limiting that affects real trading.

**Current mitigations:**
- Sprint 8 appears to have a single `live_runner.js` entry point that creates one client ✓
- `CredentialManager.rateLimitTrading()` provides a shared limiter via `credential_manager.js` ✓

**Remaining gap:** `credential_manager.js` and `kalshi_client.js` rate limiters are separate. If both are used, there are effectively two limiters that each think they have the full budget.

**Recommendation:** Designate one rate limiter as authoritative (prefer `credential_manager.js`'s `RateLimiter`). Have `KalshiClient` accept an external limiter instance rather than always creating its own:
```js
this.rateLimiter = opts.rateLimiter || new SimpleRateLimiter(opts.rateLimit);
```

---

## Non-Findings (Verified Safe)

| Check | Result |
|-------|--------|
| Auth token in transit | HTTPS enforced by `https.request` to `trading-api.kalshi.com` ✓ |
| Credential logging | `summary()` masks key; audit log records presence, not value ✓ |
| Paper trading default | `PAPER_TRADING !== 'false'` → defaults to `true` ✓ |
| Capital floor enforcement | `tradingHalted` check blocks execution before engine is invoked ✓ |
| Risk manager gating | `approvedSignals` only passes signals that clear RiskManager ✓ |
| NULL confidence guard | T331 validated — skips trades with invalid confidence ✓ |
| .gitignore enforcement | `ensureGitignore()` in credential_manager auto-adds .env ✓ |

---

## Pre-Production Checklist (Before Founder Approval for Live)

- [ ] **FINDING-1:** Add `KALSHI_CONFIRM_LIVE` double-opt-in to live execution path (Bob)
- [ ] **FINDING-2:** Strip full response body from error objects in `kalshi_client.js` (Bob)
- [ ] **FINDING-3:** Accept external rate limiter instance in `KalshiClient` constructor (Bob)
- [ ] Confirm `ExecutionEngine` has its own paper-mode guard (independent of `live_runner.js`)
- [ ] Verify `audit_log.jsonl` is not world-readable in production deployment (Liam/Eve)
- [ ] Rotate API key immediately after first live test run (standard key hygiene)

---

## Overall Assessment

The live trading path has a **strong security baseline**: safe defaults, audit logging, risk manager gating, credential masking, and paper trading by default. The three findings are edge cases that reduce defense-in-depth but do not represent immediately exploitable vulnerabilities under normal operation.

**FINDING-1 (double-opt-in) is the most important** — it protects against accidental live order submission, which is irreversible and financial in nature.

DM Bob with the pre-production checklist.
