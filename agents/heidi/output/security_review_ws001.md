# Security Review: Task #153 — WebSocket Auth (WS-001 through WS-004)

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-03-30
**Task:** #158 — Review Nick's WS-001 Security Fix
**Implementation by:** Nick (Task #153)
**File reviewed:** `server.js` lines 2427–2526
**Verdict:** ✅ PASS

---

## Review Checklist

### WS-001: API Key Authentication

| Check | Result |
|-------|--------|
| Auth enforced only when `API_KEY` set (dev mode skipped) | ✅ Pass |
| Accepts `Authorization: Bearer <key>` header | ✅ Pass |
| Accepts `X-Api-Key` header as fallback | ✅ Pass |
| Uses `crypto.timingSafeEqual()` — timing-attack safe | ✅ Pass |
| Explicit `provided.length === API_KEY.length` check (prevents padding bypass) | ✅ Pass |
| Padded buffer approach — prevents zero-length panic | ✅ Pass |
| Empty/missing key → unauthorized (no silent bypass) | ✅ Pass |
| Returns `401 Unauthorized` + `socket.destroy()` on failure | ✅ Pass |

The implementation mirrors the fixed `isAuthorized()` pattern in `server.js` (lines 112–130), including the `lengthMatch` guard that prevents the SEC-013 space-padding bypass Heidi found in `api.js`. The auth logic is consistent across HTTP and WebSocket paths. ✅

### WS-002: Origin Validation

| Check | Result |
|-------|--------|
| Origin check gated on `ALLOWED_ORIGINS` being set | ✅ Pass |
| Rejects mismatched origin with `403 Forbidden` + destroy | ✅ Pass |
| Absent `Origin` header allowed (non-browser WS clients) | ✅ Pass (acceptable) |

**Note:** The condition `if (origin && !ALLOWED_ORIGINS.includes(origin))` permits connections with no `Origin` header. Browser-based CSWSH attacks always send `Origin`, so this correctly blocks the threat. Native WS clients (curl, scripts) don't send `Origin` — blocking them would break legitimate tooling. Behavior is consistent with the HTTP CORS handler. ✅

### WS-003: maxPayload (Memory Exhaustion)

| Check | Result |
|-------|--------|
| `WS_MAX_PAYLOAD = 64 KB` limit defined | ✅ Pass |
| Buffer checked before processing frame | ✅ Pass |
| Oversized buffer → `socket.destroy()` + `wsClients.delete()` | ✅ Pass |

Minor style note: `WS_MAX_PAYLOAD` is declared inside the upgrade handler (redefined per connection). Not a security issue, but could be hoisted to module scope alongside `WS_MAX_CONNECTIONS` for consistency. Non-blocking.

### WS-004: Connection Limit Guard

| Check | Result |
|-------|--------|
| `WS_MAX_CONNECTIONS = 100` defined at module scope | ✅ Pass |
| Guard checked before completing handshake (pre-101) | ✅ Pass |
| Returns `503 Service Unavailable` + destroy | ✅ Pass |
| `wsClients` cleaned up on `close` and `error` events | ✅ Pass |

Checking `wsClients.size >= WS_MAX_CONNECTIONS` **before** sending the `101 Switching Protocols` response is the correct order — it prevents the slot being consumed before the check. ✅

---

## Bypass Scenarios Tested (Review)

| Scenario | Behavior |
|----------|----------|
| No auth header, `API_KEY` set | 401, socket destroyed ✅ |
| `Authorization: Bearer ` (empty after Bearer) | 401 — `provided` is empty string, `if (provided)` guard prevents eval ✅ |
| `Authorization: Bearer key ` (trailing space) | 401 — length mismatch prevents bypass ✅ |
| `API_KEY` not set (dev mode) | Auth block skipped, connection allowed ✅ |
| Valid key, wrong origin, `ALLOWED_ORIGINS` set | 403, socket destroyed ✅ |
| Valid key, no origin, `ALLOWED_ORIGINS` set | Allowed (non-browser client) ✅ |
| 101st connection attempt | 503, socket destroyed ✅ |
| Oversized frame (>64 KB) | Socket destroyed, client removed ✅ |

---

## Summary

Nick's implementation addresses all four WebSocket security requirements from the original brief:

- **WS-001** — Auth on upgrade: **COMPLETE** ✅
- **WS-002** — Origin validation: **COMPLETE** ✅
- **WS-003** — maxPayload: **COMPLETE** ✅
- **WS-004** — Connection limit: **COMPLETE** ✅

The implementation is consistent with the existing HTTP auth pattern, uses constant-time comparison, and correctly orders all security checks before the 101 handshake. One non-blocking style note (WS_MAX_PAYLOAD placement).

**Task #153 and Task #158 are complete.**
