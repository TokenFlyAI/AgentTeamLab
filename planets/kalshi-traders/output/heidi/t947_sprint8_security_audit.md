# T947 — Sprint 8 Security Audit: Phase 1-3 Changes

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-04-07
**Scope:** T910-T914 Phase 1-3 changes — input validation, auth in shared backend, data leakage in clusters
**Artifacts reviewed:**
- `bob/credential_manager.js` (new)
- `bob/backend/correlation/pearson_detector.js` (T963 remediation)
- `bob/backend/strategies/live_runner.js` (updated)
- `ivan/llm_market_clustering.py` + `generate_market_clusters.py`
- `shared/codebase/backend/api/markets_api.js`

---

## Executive Summary

**CONDITIONAL PASS — 2 findings, 0 blockers for continued Sprint 8 work.**

The Sprint 8 changes demonstrate improved security posture overall. The new `credential_manager.js` is well-designed. The `pearson_detector.js` T963 remediation is clean and correct. Two findings are noted below, both LOW severity, neither blocking.

---

## Findings

### FINDING-1: `markets_api.js` — No Authentication on Internal Endpoints (LOW)

**File:** `shared/codebase/backend/api/markets_api.js`
**Location:** All exported handler functions (`getMarkets`, `getMarketDetail`, `getPriceHistory`, `getOrderbook`, etc.)

**Issue:** The markets API module exports handler functions with no authentication middleware. Any router that mounts these endpoints exposes market data without requiring a Bearer token.

**Exploitability:** LOW — this is an internal module; exploitability depends on how it is mounted. However, per C2 ("API endpoints must require auth via Authorization header — no open POST endpoints in production"), auth should be enforced at the handler or middleware level, not assumed by the caller.

**Recommendation:**
```js
// Add to each exported handler, or as a shared middleware:
function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || token !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```
Or document explicitly that auth is enforced by the router layer that mounts these handlers.

---

### FINDING-2: `credential_manager.js` — Audit Log Path Not Validated (LOW)

**File:** `bob/credential_manager.js:52`
**Location:** `AuditLogger` constructor — `this.logPath = logPath || path.join(__dirname, 'audit_log.jsonl')`

**Issue:** The `logPath` is caller-supplied and used directly in `fs.appendFileSync`. If an attacker can influence the `options.auditLogPath` constructor argument, they could write audit log data to an arbitrary path on the filesystem (limited-content write, but still a path traversal risk).

**Exploitability:** LOW — In practice, `CredentialManager` is instantiated in controlled contexts. But if `options` ever comes from user input (e.g., a config endpoint), this could be exploited.

**Recommendation:** Add a path validation check:
```js
constructor(logPath) {
  const resolved = path.resolve(logPath || path.join(__dirname, 'audit_log.jsonl'));
  const allowed = path.resolve(__dirname);
  if (!resolved.startsWith(allowed)) {
    throw new Error(`Audit log path must be within ${allowed}`);
  }
  this.logPath = resolved;
}
```

---

## Positive Findings

1. **`credential_manager.js` overall design is strong:**
   - Credentials read from env only, never returned in plain text (`summary()` masks values)
   - `.gitignore` enforcement is proactive and automatic
   - Paper trading default is safe (C1 compliant)
   - Immutable audit log for security-sensitive operations

2. **`pearson_detector.js` T963 remediation is clean:**
   - Explicit `noiseFilterThreshold: 0.3` added to CONFIG (visible and configurable)
   - Noise filter applied correctly at `|r| < threshold` before the main correlation check
   - No new input validation issues introduced; CLI path handling is safe (controlled defaults)

3. **`live_runner.js` auth:**
   - Correctly falls back to mock data when `KALSHI_API_KEY` not set
   - Paper trading check (`PAPER_TRADING !== 'false'`) follows C1

4. **Ivan's cluster code:**
   - No external API calls, no auth credentials needed — pure text classification
   - No data leakage risk in cluster output; ticker names and market titles are public info

---

## Data Leakage Assessment (Clusters)

Ivan's `market_clusters.json` and `llm_market_clustering.py` output contains only:
- Market tickers (public Kalshi data)
- Cluster assignments and confidence scores
- No user data, no PII, no credentials

**PASS — no data leakage in cluster output.**

---

## Summary

| Finding | File | Severity | Action |
|---------|------|----------|--------|
| FINDING-1 | `markets_api.js` — no auth on handlers | LOW | Document auth assumption or add middleware |
| FINDING-2 | `credential_manager.js` — audit log path traversal | LOW | Add path validation in AuditLogger |

No blockers for Sprint 8 continuation. DM Bob with findings.
