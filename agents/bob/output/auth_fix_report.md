# Auth Fix Report — Task #141

**Date**: 2026-03-30
**Author**: Bob (Backend Engineer)
**Issue**: 123 auth failures from internal scripts making unauthenticated requests to dashboard API

## Audit Scope

Files audited for missing `Authorization: Bearer $API_KEY` headers:
- `smart_run.sh`
- `run_agent.sh`
- `status.sh`
- `scripts/healthcheck.js`
- `scripts/heartbeat_monitor.js`
- `backend/agent_metrics_api.js`

## Findings

### Already Correct (no changes needed)

| File | Notes |
|------|-------|
| `smart_run.sh` | No curl/HTTP calls to dashboard API |
| `run_agent.sh` | No curl calls; correctly forwards `API_KEY` env var to agent subprocesses |
| `status.sh` | No curl calls to dashboard API |
| `scripts/healthcheck.js` | Already reads `API_KEY = process.env.API_KEY \|\| ''` (line 38) and conditionally sets `Authorization` header (line 139) |
| `backend/agent_metrics_api.js` | Serves auth (enforces Bearer token); makes no outbound HTTP calls |

### Fixed

| File | Function | Problem | Fix |
|------|----------|---------|-----|
| `scripts/heartbeat_monitor.js` | `isDashboardAlive()` | Called `http.get(DASHBOARD_URL, { timeout })` with no auth header; `API_KEY` was never read | Added `const API_KEY = process.env.API_KEY \|\| ''` at module level; conditionally sets `Authorization: Bearer ${API_KEY}` header in request options |

## Root Cause

`heartbeat_monitor.js` was written without auth awareness. Every time Liam's heartbeat monitor checked dashboard liveness (every 60s), it sent an unauthenticated request → `401 Unauthorized`. With the monitor running continuously, this generated the bulk of the 123 auth failures Ivan observed.

`healthcheck.js` was already correct — it was written later and included auth from the start.

## Changes Made

**`scripts/heartbeat_monitor.js`** — 3 lines changed:

```diff
 const DASHBOARD_URL = 'http://localhost:3199/api/health';
 const DASHBOARD_TIMEOUT_MS = 5000;
+const API_KEY = process.env.API_KEY || '';

 function isDashboardAlive() {
   return new Promise((resolve) => {
-    const req = http.get(DASHBOARD_URL, { timeout: DASHBOARD_TIMEOUT_MS }, (res) => {
+    const reqOpts = { timeout: DASHBOARD_TIMEOUT_MS };
+    if (API_KEY) reqOpts.headers = { Authorization: `Bearer ${API_KEY}` };
+    const req = http.get(DASHBOARD_URL, reqOpts, (res) => {
```

## Expected Impact

- Auth failures from `heartbeat_monitor.js` drop to 0 when `API_KEY` env var is set
- No behavior change when `API_KEY` is unset (dev mode — auth not enforced)
- Ivan's 43.8% error rate should normalize once this is deployed
