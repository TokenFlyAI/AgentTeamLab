# Security Review: SEC-001 API Key Authentication
**Reviewer**: Heidi (Security Engineer)
**Date**: 2026-03-30
**Task**: Task #103 (Quinn)
**Files**: `server.js`, `backend/api.js`

---

## Verdict

| File | Status | Details |
|------|--------|---------|
| `server.js` | **PASS** | Correct implementation |
| `backend/api.js` | **FAIL — Auth Bypass** | Space-padding vulnerability (HIGH) |

---

## server.js — PASS ✅

Implementation at line 103 is correct:

```js
const keyLen = Math.max(provided.length, API_KEY.length, 1);
const a = Buffer.alloc(keyLen);   // null-filled
const b = Buffer.alloc(keyLen);   // null-filled
Buffer.from(provided).copy(a);
Buffer.from(API_KEY).copy(b);
const lengthMatch = provided.length === API_KEY.length;
return lengthMatch && crypto.timingSafeEqual(a, b);
```

**Why this is correct:**
- Uses `Buffer.alloc()` (null bytes) instead of string padding — avoids space-collision attacks
- Checks `provided.length === API_KEY.length` BEFORE the timingSafeEqual — correct length validation
- `timingSafeEqual` operates on equal-sized null-padded buffers — no timing leak
- Auth guard at line 768 correctly covers `/api/*` only (static assets exempted)
- `WWW-Authenticate: Bearer` header on 401 — spec-compliant

---

## backend/api.js — FAIL ❌ (HIGH Severity)

### Finding: AUTH-001 — Space-Padding Authentication Bypass

**Severity**: HIGH
**CVSS estimate**: 8.6 (AC:L, AV:N, PR:L, S:C, C:H, I:H, A:N)

**Vulnerable code** (lines 34–44):
```js
function isAuthorized(req) {
  if (!API_KEY) return true;
  const authHeader = req.headers["authorization"] || "";
  const xApiKey    = req.headers["x-api-key"] || "";
  const provided   = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : xApiKey;
  if (!provided) return false;
  try {
    const a = Buffer.from(provided.padEnd(API_KEY.length));   // BUG: pads with spaces
    const b = Buffer.from(API_KEY.padEnd(provided.length));   // BUG: pads with spaces
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}
```

**Attack scenario:**
- Assume `API_KEY = "secret"` (6 chars)
- Attacker submits `Authorization: Bearer secret ` (key + 1 trailing space, 7 chars)
- `a = Buffer.from("secret ".padEnd(6))` → no-op (len=7 > 6) → `Buffer.from("secret ")`
- `b = Buffer.from("secret".padEnd(7))` → pads to 7 → `Buffer.from("secret ")`
- `a.length === b.length` → 7 === 7 → **true**
- `timingSafeEqual(a, b)` → **true** ← **AUTH BYPASS**

**Impact**: Any attacker who knows the real API key can also authenticate with the key + any number of trailing spaces. In practice this means:
1. Key rotation may be incomplete if the old key + spaces still works
2. Logs that strip trailing whitespace would record a match for a subtly different key, masking the source
3. The two auth implementations (server.js vs api.js) behave differently — inconsistent security boundary

**Reproduction** (curl):
```bash
API_KEY=secret node -e "
const {createServer} = require('http');
// ... start server with API_KEY=secret
// then:
curl -H 'Authorization: Bearer secret ' http://localhost:PORT/api/...
# This authenticates when it should fail
```

### Required Fix

Replace the `isAuthorized` function in `backend/api.js` with the same correct implementation from `server.js`:

```js
function isAuthorized(req) {
  if (!API_KEY) return true;
  const authHeader = req.headers["authorization"] || "";
  const xApiKey    = req.headers["x-api-key"] || "";
  const provided   = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : xApiKey;
  if (!provided) return false;
  try {
    const keyLen = Math.max(provided.length, API_KEY.length, 1);
    const a = Buffer.alloc(keyLen);
    const b = Buffer.alloc(keyLen);
    Buffer.from(provided).copy(a);
    Buffer.from(API_KEY).copy(b);
    const lengthMatch = provided.length === API_KEY.length;
    return lengthMatch && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}
```

**Key differences:**
- `Buffer.alloc(keyLen)` → null-filled, no space collision
- Explicit `lengthMatch` check → correct length validation, not buffer-size matching

---

## Additional Observations

### MINOR: Auth guard scope in api.js
`api.js` applies auth to ALL requests at line 253 (before any routing). This is acceptable since `handleApiRequest` is presumably only called for API paths. But the comment says "require valid API key when API_KEY env var is set" — could be clearer about scope. **Not a security issue; informational only.**

### POSITIVE: Both files correctly handle dev mode
`if (!API_KEY) return true` — no auth when env var is unset. Safe for development environments.

### POSITIVE: server.js auth guard placement
Auth check at line 768 is after CORS/preflight middleware (correct — OPTIONS requests need to pass) and before any route handler (correct — no route can be reached without auth).

---

## Required Action

1. **Quinn**: Fix `backend/api.js` `isAuthorized()` using the null-buffer approach from `server.js` (copy the implementation exactly)
2. **After fix**: I will re-review and sign off for Task #103 completion
3. **Recommend**: Add an e2e test: `POST /api/messages` with `Authorization: Bearer <realkey> ` (trailing space) should return 401, not 200

---

## Summary

The `server.js` implementation is solid and correctly solves SEC-001. The `backend/api.js` implementation has an authentication bypass via space-padding that must be fixed before Task #103 can be closed. The fix is a one-function replacement — low effort, critical impact.
