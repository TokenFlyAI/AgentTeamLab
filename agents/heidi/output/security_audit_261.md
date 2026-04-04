# Security Audit Report — Task 261
**Auditor:** Heidi (Security Engineer)  
**Date:** 2026-04-03  
**Scope:** Trading Pipeline Security Review

## Files Audited
1. `agents/bob/backend/strategies/live_runner.js`
2. `agents/bob/backend/kalshi_client.js`
3. `agents/bob/backend/dashboard_api.js`

---

## Executive Summary

| File | Status | Findings |
|------|--------|----------|
| live_runner.js | ✅ PASS | No issues found |
| kalshi_client.js | ✅ PASS | No issues found |
| dashboard_api.js | ⚠️ CONDITIONAL PASS | 1 MEDIUM, 2 LOW issues |

**Overall Risk:** LOW — No critical security vulnerabilities. Dashboard API needs authentication before production.

---

## Detailed Findings

### 1. live_runner.js

#### Status: ✅ PASS

**Security Assessment:**
- API key handling: ✅ Uses `process.env.KALSHI_API_KEY` (line 26, 223)
- No hardcoded secrets: ✅ Confirmed
- Error message leakage: ✅ Safe — error messages don't expose keys
- Logging: ✅ No API keys in console output

**Code Review:**
```javascript
// Line 26 — Correct env var usage
const USE_MOCK_FALLBACK = !process.env.KALSHI_API_KEY;

// Line 222-225 — Secure client instantiation
client = new KalshiClient({
  apiKey: process.env.KALSHI_API_KEY,
  demo: process.env.KALSHI_DEMO !== "false",
});
```

**Positive Controls:**
- Graceful fallback when API key unavailable
- Risk manager integration for trade validation
- No sensitive data in output JSON

---

### 2. kalshi_client.js

#### Status: ✅ PASS

**Security Assessment:**
- API key storage: ✅ Instance variable, not logged
- No hardcoded secrets: ✅ Confirmed
- Error handling: ✅ API errors don't leak keys
- Rate limiting: ✅ Built-in protection

**Code Review:**
```javascript
// Line 93 — Secure constructor
this.apiKey = opts.apiKey || process.env.KALSHI_API_KEY;

// Line 98-102 — Validates key presence
if (!this.apiKey) {
  throw new Error("Kalshi API key required...");
}

// Line 129-134 — Authorization header (secure)
const headers = {
  Authorization: `Bearer ${this.apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
  ...(opts.headers || {}),
};
```

**Positive Controls:**
- Requires API key at instantiation
- Demo mode by default (safe)
- Rate limiting prevents abuse
- Timeout protection on requests

**Note:** Test key "test_key_123" on line 538 is safe — it's only for unit testing.

---

### 3. dashboard_api.js

#### Status: ⚠️ CONDITIONAL PASS

#### DASH-001 MEDIUM: Unauthenticated Pipeline Trigger

**Location:** Lines 139-155  
**Severity:** MEDIUM  
**Issue:** POST `/api/run` has no authentication. Anyone with network access can trigger the trading pipeline.

**Impact:**
- Unauthorized pipeline execution
- Potential excessive API calls to Kalshi
- Unintended trading costs

**Current Code:**
```javascript
app.post("/api/run", async (req, res) => {
  const { spawn } = require("child_process");
  // ... no auth check
  const runner = spawn("node", [LIVE_RUNNER_PATH], {...});
});
```

**Recommended Fix:**
```javascript
const API_KEY = process.env.DASHBOARD_API_KEY;

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.post("/api/run", requireAuth, async (req, res) => { ... });
```

---

#### DASH-002 LOW: CORS Open to All Origins

**Location:** Line 22  
**Severity:** LOW  
**Issue:** `app.use(cors())` allows any origin to access the API.

**Recommended Fix:**
```javascript
app.use(cors({ 
  origin: process.env.DASHBOARD_ORIGIN || "http://localhost:3200" 
}));
```

---

#### DASH-003 LOW: No Rate Limiting

**Location:** Global  
**Severity:** LOW  
**Issue:** No rate limiting on API endpoints.

**Recommended Fix:**
```javascript
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);
```

---

## Summary Table

| ID | File | Issue | Severity | Status |
|----|------|-------|----------|--------|
| - | live_runner.js | API key exposure | - | ✅ No issue |
| - | kalshi_client.js | Hardcoded secrets | - | ✅ No issue |
| DASH-001 | dashboard_api.js | Unauthenticated POST /api/run | MEDIUM | ⚠️ Fix before prod |
| DASH-002 | dashboard_api.js | CORS open to all | LOW | ⚠️ Fix before prod |
| DASH-003 | dashboard_api.js | No rate limiting | LOW | ℹ️ Recommended |

---

## Recommendations

1. **Before Production:**
   - Add authentication to POST /api/run (DASH-001)
   - Restrict CORS to dashboard origin (DASH-002)
   - Add rate limiting (DASH-003)

2. **Environment Variables Needed:**
   - `DASHBOARD_API_KEY` — for API authentication
   - `DASHBOARD_ORIGIN` — for CORS restriction

3. **Deployment Checklist:**
   - [ ] KALSHI_API_KEY set in production
   - [ ] DASHBOARD_API_KEY set in production
   - [ ] DASHBOARD_ORIGIN configured
   - [ ] Rate limiting enabled

---

## Conclusion

The trading pipeline is **secure for development/demo use**. The only blocking issue for production is DASH-001 (unauthenticated pipeline trigger). All API key handling is correct — no keys are exposed in code, logs, or error messages.

**Task 261: COMPLETE**
