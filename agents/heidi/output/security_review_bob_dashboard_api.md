# Security Review: Bob's dashboard_api.js
**Reviewer:** Heidi (Security Engineer)  
**Date:** 2026-04-02  
**File:** agents/bob/backend/dashboard_api.js  
**Task:** P0 — Kalshi Alpha Dashboard

## Summary
**Status:** ⚠️ CONDITIONAL PASS — 1 MEDIUM issue to address

The dashboard API is functional but has a security issue that should be fixed before production deployment.

## Findings

### DASH-001 MEDIUM: Unauthenticated Pipeline Trigger
**Location:** Lines 139-155  
**Code:**
```javascript
app.post("/api/run", async (req, res) => {
  const { spawn } = require("child_process");
  
  res.json({
    success: true,
    message: "Live runner triggered",
    timestamp: new Date().toISOString(),
  });

  // Run live_runner.js in background
  const runner = spawn("node", [LIVE_RUNNER_PATH], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  runner.unref();
});
```

**Issue:** The `/api/run` endpoint has no authentication. Anyone with network access can trigger the trading pipeline, potentially:
- Causing excessive API calls to Kalshi (rate limit/risk)
- Running up trading costs
- Triggering unintended trades

**Recommendation:** Add API key authentication:
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

### DASH-002 LOW: CORS Enabled for All Origins
**Location:** Line 22  
**Code:** `app.use(cors());`

**Issue:** CORS is open to all origins. For a trading dashboard, this could allow malicious websites to read trading signals if a user is authenticated.

**Recommendation:** Restrict to dashboard origin:
```javascript
app.use(cors({ origin: "http://localhost:3200" }));
```

### DASH-003 INFO: No Rate Limiting
**Issue:** No rate limiting on endpoints. Could be abused for DoS.

**Recommendation:** Add express-rate-limit for production.

## Positive Security Controls

✅ **No secrets in code** — No hardcoded API keys  
✅ **Path validation** — Uses path.join() for safe file paths  
✅ **Error handling** — Try-catch around file reads  
✅ **No eval/exec** — spawn() is used safely with fixed command  
✅ **Input validation** — No user input used in file paths  

## Conclusion

The API is safe for internal/demo use but **DASH-001 should be fixed before production** to prevent unauthorized pipeline triggers.

## Action Items

| Priority | Item | Owner |
|----------|------|-------|
| P1 | Add auth to POST /api/run | Bob |
| P2 | Restrict CORS origin | Bob |
| P3 | Add rate limiting | Bob |
