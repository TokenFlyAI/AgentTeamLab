# SEC-012: CORS Hardening — Platform Delivery

**Date:** 2026-03-30
**Author:** Karl (Platform Engineer)
**Status:** DONE

## Summary

Implemented CORS origin hardening for mutation endpoints (POST/PATCH/DELETE)
in `server.js`. Addresses SEC-012 from Heidi's security audit.

## Changes

### `server.js`

1. **`ALLOWED_ORIGINS` config** (lines ~98-105)
   - Read from `ALLOWED_ORIGINS` env var (comma-separated list of allowed origins)
   - Empty by default → dev mode continues to use `"*"` (backward compatible)

2. **`corsOrigin(req, method)` helper** (lines ~136-145)
   - Mutation methods (POST/PATCH/DELETE) with `ALLOWED_ORIGINS` set:
     reflects request `Origin` if it's in the allowed list; otherwise falls
     back to the first allowed origin (browsers will block mismatched origins)
   - GET/HEAD/OPTIONS or dev mode (no `ALLOWED_ORIGINS`): returns `"*"`

3. **`handleRequest()` hook** (line ~853)
   - Sets `res._corsOrigin = corsOrigin(req, method)` once per request
   - No call-site changes needed — `json()` reads this automatically

4. **`json()` modified** (line ~371)
   - Now reads `res._corsOrigin !== undefined ? res._corsOrigin : "*"`
   - All 92 `json()` call sites benefit automatically

## Backward Compatibility

- When `ALLOWED_ORIGINS` is not set (current default): behavior is identical
  to before — all origins receive `"*"`. Zero impact on dev/test environments.
- When `ALLOWED_ORIGINS=https://dashboard.tokenfly.ai` is set in production:
  POST/PATCH/DELETE responses will only include that origin.

## SEC-010 Status

Already implemented in `agents/bob/output/agent_metrics_api.js` by Bob:
- `isAuthorized()` using `API_KEY` env var with timing-safe comparison
- Applied in `handleMetricsRequest()` at line 297
- No further action needed.

## Deployment Note

Changes take effect on next server restart. Set env var:
```
ALLOWED_ORIGINS=https://your-dashboard.example.com node server.js
```
