# T1033 — Phase B Microservice: Inter-Service Auth Design

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-04-07
**Scope:** `bob/backend/services/correlation_engine/server.js` (T1027) + Rosa's 7-service decomposition plan (T954)
**Verdict: CONDITIONAL PASS — 2 CRITICAL findings must be fixed before Phase B production deployment.**

---

## Part 1: Correlation Engine Security Audit (T1027)

### FINDING-1: No Authentication on `/correlate` (CRITICAL)

**Location:** `server.js` — all route handlers

**Issue:** `POST /correlate` and `GET /correlate` have zero authentication. Any process that can reach port 3210 can:
- Submit arbitrary cluster data and receive correlation analysis
- Inject fake market pairs designed to generate false arbitrage signals
- Trigger the execution path with attacker-controlled `arbitrage_confidence` values

This is the highest-risk endpoint in the system — its output feeds directly into trade signal generation. A spoofed high-confidence pair could cause the execution engine to place real orders on fabricated signals.

**Exploitability:** HIGH in any networked deployment. Even on localhost, any co-located process (including compromised Phase 1/2 services) can inject.

**Fix:**
```js
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function requireInternalAuth(req, res) {
  if (!INTERNAL_API_KEY) {
    // Fail secure: if key not configured, deny all non-health requests
    send(res, errorResponse("Service not configured for authenticated access", 503));
    return false;
  }
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token !== INTERNAL_API_KEY) {
    send(res, errorResponse("Unauthorized", 401));
    return false;
  }
  return true;
}
```
Apply to `/correlate` (both GET and POST). `/health` stays open per liveness probe convention.

---

### FINDING-2: Path Traversal via `body.path` (CRITICAL)

**Location:** `server.js:handleCorrelate` — `body.path` branch

**Issue:**
```js
const resolvedPath = path.resolve(body.path);
if (!fs.existsSync(resolvedPath)) { ... }
clusters = loadClusters(resolvedPath);  // fs.readFileSync → JSON.parse
```

`path.resolve` prevents `../` escapes but does NOT restrict to safe directories. An attacker (or compromised upstream service) can send:
```json
{ "path": "/etc/passwd" }
```
If the file is not valid JSON, `loadClusters` throws and `err.message` is returned in the error response — potentially leaking file contents in the error message. If a world-readable JSON file exists at the supplied path, its contents are returned directly.

**Fix:** Add a directory allowlist:
```js
const ALLOWED_DATA_DIRS = [
  path.resolve(__dirname, '../../../../../../public'),
  path.resolve(__dirname, '../../../../../../output'),
  path.resolve(process.cwd(), 'data'),
];

function safeResolvePath(inputPath) {
  const resolved = path.resolve(inputPath);
  const allowed = ALLOWED_DATA_DIRS.some(dir => resolved.startsWith(dir + path.sep) || resolved === dir);
  if (!allowed) {
    throw new Error(`Path '${inputPath}' is outside allowed data directories`);
  }
  return resolved;
}
```

---

### FINDING-3: No Request Body Size Limit (MEDIUM)

**Location:** `server.js:readBody`

```js
req.on("data", (chunk) => (data += chunk));
```

No size cap. A caller can POST arbitrarily large cluster data, causing unbounded memory growth and potential OOM crash.

**Fix:**
```js
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB
let size = 0;
req.on("data", (chunk) => {
  size += chunk.length;
  if (size > MAX_BODY_BYTES) {
    req.destroy();
    reject(new Error("Request body too large"));
    return;
  }
  data += chunk;
});
```

---

### FINDING-4: Internal Error Details in Responses (LOW)

**Location:** `handleCorrelate` — catch block

```js
send(res, errorResponse(`Correlation failed: ${err.message}`, 500));
```

`err.message` may include file paths, stack context, or internal state. Should return a generic message externally and log the detail internally.

**Fix:**
```js
} catch (err) {
  console.error(`[correlation-engine] Error:`, err);
  send(res, errorResponse("Internal correlation error", 500));
}
```

---

### FINDING-5: `/health` Exposes Internal Config (INFO)

**Location:** `handleHealth` — returns `minCorrelation` and `noiseFilterThreshold`

**Assessment:** Low risk for a liveness probe. These are strategy parameters, not secrets. However, exposing tuning thresholds to external callers reveals how to craft inputs that evade the noise filter. Recommend moving config out of the health response or restricting `/health` to internal network only.

---

## Part 2: Inter-Service Auth Design (All 7 Services)

### Threat Model — Message Bus

Rosa's plan uses Redis (Phase B) → RabbitMQ (Phase E) for inter-service events. Attack surface:

| Threat | STRIDE | Impact |
|--------|--------|--------|
| **Event injection** — attacker publishes `CorrelationPairDetected` with fabricated r=0.99 | Tampering | Fake arbitrage signals → real orders |
| **Service spoofing** — attacker claims to be Phase 1 and emits trusted `MarketFiltered` events | Spoofing | Poisoned pipeline inputs |
| **DLQ replay tampering** — attacker modifies events in DLQ before replay | Tampering | Corrupted historical state |
| **Redis credential exposure** — Redis password in env → leaked to logs | Info Disclosure | Full message bus compromise |
| **Eavesdropping** — unencrypted Redis channels on shared host | Info Disclosure | Signal strategy disclosure |

### Recommended Auth Scheme: HMAC-Signed Events

For the current deployment model (single host, localhost Redis), **shared-secret HMAC signing** is the right balance of security and operational simplicity. mTLS is correct for multi-host deployments but is excessive overhead for Phase B.

**Event envelope:**
```json
{
  "specversion": "1.0",
  "type": "correlation.pair.detected",
  "source": "correlation-engine",
  "id": "<uuid>",
  "time": "2026-04-07T22:00:00Z",
  "datacontenttype": "application/json",
  "data": { ... },
  "x-signature": "sha256=<hmac-sha256(INTERNAL_BUS_SECRET, canonical_payload)>"
}
```

**Signing:**
```js
const crypto = require('crypto');

function signEvent(event, secret) {
  const payload = JSON.stringify({ type: event.type, source: event.source, id: event.id, data: event.data });
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { ...event, 'x-signature': `sha256=${sig}` };
}

function verifyEvent(event, secret) {
  const { 'x-signature': sig, ...rest } = event;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(
    JSON.stringify({ type: rest.type, source: rest.source, id: rest.id, data: rest.data })
  ).digest('hex')}`;
  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

**Secret management:**
- Single `INTERNAL_BUS_SECRET` env var shared across all pipeline services
- Rotate on deployment; store in `.env` (already gitignored per `ensureGitignore()`)
- For Phase E (RabbitMQ), upgrade to per-service credentials via RabbitMQ vhosts

### Service Identity Matrix

| Service | Publishes | Consumes | Auth Required |
|---------|-----------|----------|---------------|
| Market Filter (Phase 1) | `MarketFiltered` | — | Signs outbound events |
| Cluster Intel (Phase 2) | `ClusterAssigned` | `MarketFiltered` | Signs + verifies |
| Correlation Engine (Phase 3) | `CorrelationPairDetected` | `ClusterAssigned` | Signs + verifies + **HTTP Bearer** |
| Execution Engine (Phase 4) | live orders | `CorrelationPairDetected` | Verifies; also checks `KALSHI_CONFIRM_LIVE` |
| Risk Manager | `RiskAlert` | all | Verifies all |
| Dashboard API | — | all (read) | Verifies |
| Market Data Service | price events | Kalshi API | Signs outbound |

### DLQ Replay Security

Events in the DLQ must be re-verified on replay — signatures prevent post-hoc tampering. Replay handler should:
1. Re-verify `x-signature` before processing
2. Check `time` field — reject events older than 24h (stale replay prevention)
3. Log replay with original `id` for audit trail

### Redis Security Checklist (Phase B)

- [ ] Set `requirepass` in Redis config (`REDIS_PASSWORD` env var)
- [ ] Bind Redis to `127.0.0.1` only (no external exposure)
- [ ] Use `RESP3` TLS for any multi-host expansion
- [ ] Disable dangerous commands: `CONFIG SET`, `DEBUG`, `SLAVEOF` (via `rename-command` in redis.conf)

---

## Summary

### Immediate blockers for Phase B (fix before any deployment):

| Finding | File | Severity | Fix |
|---------|------|----------|-----|
| FINDING-1 | `correlation_engine/server.js` — no auth on `/correlate` | **CRITICAL** | Add `requireInternalAuth` middleware |
| FINDING-2 | `correlation_engine/server.js` — `body.path` traversal | **CRITICAL** | Add `safeResolvePath` directory allowlist |
| FINDING-3 | `correlation_engine/server.js` — no body size limit | MEDIUM | Cap at 5MB in `readBody` |
| FINDING-4 | `correlation_engine/server.js` — error detail leakage | LOW | Generic external error, log internally |

### Inter-service auth design (implement alongside Phase B):
- HMAC-SHA256 signed event envelope with `x-signature` field
- `INTERNAL_BUS_SECRET` shared secret (rotate on deploy)
- `INTERNAL_API_KEY` for HTTP service-to-service calls (already used in dashboard)
- Redis bound to localhost + password-protected

DM Bob with critical findings. Coordinate with Rosa (event signing) and Eve (Redis hardening).
