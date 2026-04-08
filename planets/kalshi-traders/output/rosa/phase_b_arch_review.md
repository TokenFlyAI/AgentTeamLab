# Phase B Microservice Architecture Review — T1049
**Reviewer:** Rosa (Distributed Systems)
**Date:** 2026-04-07
**Scope:** `output/bob/backend/services/correlation_engine/server.js` (T1027/T1038)
**References:** T954 (Rosa — 7-service decomp), T1033 (Heidi — inter-service auth), T1018 (Nick — latency profile)
**task_id:** T1049 | **agent_name:** rosa | **timestamp:** 2026-04-07T00:00:00Z | **sprint:** 10

---

## Verdict: CONDITIONAL PASS

The Phase B extraction is structurally sound and the security hardening (T1038) correctly addressed all 4 of Heidi's audit findings. The service is deployable for testing. **3 distributed systems risks must be addressed before production use**, and 2 are advisory for future sprints.

---

## What Bob Built — Assessment

The correlation engine correctly implements:
- Standalone HTTP service on port 3210 with clean endpoint design (`/health`, `/correlate`)
- INTERNAL_API_KEY Bearer auth on `/correlate` (T1038 CRITICAL-1 fix: correct)
- `safeResolvePath()` allowlist preventing path traversal (T1038 CRITICAL-2 fix: correct)
- 1MB body size cap (T1038 MEDIUM fix: correct — though see Risk 2 below)
- Error message stripping in production (T1038 LOW fix: correct)
- Schema versioning via `X-Schema-Version` header + `schema_version` body field (Mia T1008 pattern: correct)
- `/health` open for liveness probes (correct per CI/CD convention)

The service correctly exposes Phase 3 as an independent HTTP boundary. Bob's implementation quality is good.

---

## Distributed Systems Risks

### RISK-1: No Timeout on O(n²) Computation (HIGH — fix before production)

**Location:** `server.js:handleCorrelate` → `processClusters(clusters)` (line 194)

`processClusters()` runs synchronously in the HTTP request handler. With 119 markets → 5 clusters → 655 pairs (per Dave's T1028 smoke test), this is already running at the edge of Node.js single-thread tolerance. If the cluster input grows, or if there's a bug in `pearson_detector.js` causing an O(n²) loop to stall, the server will be stuck processing a single request indefinitely with no timeout or cancellation path.

**Risk:** One slow request blocks all subsequent requests. Caller times out, retries, and queues more blocked requests. Service appears degraded under load even with a single bad input.

**Fix:**
```js
// Wrap processClusters() in a Promise.race against a timeout
const CORRELATION_TIMEOUT_MS = parseInt(process.env.CORRELATION_TIMEOUT_MS || '5000', 10);

function correlateWithTimeout(clusters) {
  return Promise.race([
    Promise.resolve().then(() => processClusters(clusters)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Correlation timeout')), CORRELATION_TIMEOUT_MS)
    )
  ]);
}
```
Apply in `handleCorrelate`. Return 504 on timeout. This lets the caller know to retry rather than waiting indefinitely.

**Note:** Nick's T1018 data shows Phase 3 at 1.23–3.94ms for the current fixture set. A 5s timeout gives 1000× headroom. Set tighter in production once live data scale is known.

---

### RISK-2: Body Size Cap Allows Computation DoS (MEDIUM — fix before production)

**Location:** `server.js:readBody` (line 229), `MAX_BODY_BYTES = 1MB`

The 1MB body cap prevents OOM from network reads, but it doesn't prevent a computationally expensive payload. An attacker (or a misbehaving upstream service) can send a valid 1MB JSON payload containing hundreds of tightly packed cluster entries. The body cap passes, `processClusters()` begins, and computation DoS follows.

**Fix:** Add an input cardinality cap before computation:
```js
const MAX_CLUSTERS = parseInt(process.env.MAX_CLUSTERS || '20', 10);
const MAX_MARKETS_PER_CLUSTER = parseInt(process.env.MAX_MARKETS_PER_CLUSTER || '50', 10);

function validateClusterCardinality(clusters) {
  if (!Array.isArray(clusters)) throw new Error('clusters must be array');
  if (clusters.length > MAX_CLUSTERS)
    throw new Error(`Too many clusters: ${clusters.length} (max ${MAX_CLUSTERS})`);
  for (const c of clusters) {
    if (c.markets && c.markets.length > MAX_MARKETS_PER_CLUSTER)
      throw new Error(`Cluster ${c.id} has too many markets: ${c.markets.length}`);
  }
}
```
Call before `processClusters()`. Return 400. This pairs with RISK-1's timeout to give defense in depth.

---

### RISK-3: No Retry / Circuit Breaker on the Caller Side (HIGH — architectural gap)

**Location:** Architectural — not in `server.js` itself but in whatever calls it (currently `live_runner.js`)

The correlation engine is now a standalone service. If it crashes, restarts, or is temporarily overloaded, the caller (`live_runner.js` or the eventual message bus consumer) will receive a 5xx or a connection refused. There is no retry policy, backoff, or circuit breaker defined anywhere in the system.

**Risk:** Phase 2 (clustering) completes. Phase 3 (correlation engine) is restarting. The call fails. The pipeline halts with no signal to the operator and no automatic recovery.

**Required before production:**

1. **Caller-side retry with exponential backoff:**
```js
async function callCorrelationEngine(clusters, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${CORRELATION_PORT}/correlate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTERNAL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusters }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return res.json();
      if (res.status >= 500) throw new Error(`Server error: ${res.status}`);
      throw new Error(`Client error: ${res.status}`); // don't retry 4xx
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 200 * Math.pow(2, i))); // 200ms, 400ms, 800ms
    }
  }
}
```

2. **Circuit breaker state in `live_runner.js`:**
```js
let circuitOpen = false;
let circuitOpenUntil = 0;
const CIRCUIT_OPEN_MS = 30_000; // 30s
const FAILURE_THRESHOLD = 3;
let consecutiveFailures = 0;

// Before calling correlation engine:
if (circuitOpen && Date.now() < circuitOpenUntil) {
  log('Circuit open — skipping Phase 3, using last known correlation_pairs.json');
  return loadLastKnownPairs(); // graceful degradation
}
```

This implements the pattern from my T954 fault-tolerance spec: "Correlation worker crash → Signal Gen Service pauses, waits for recovery."

---

## Advisory Findings (for future sprints)

### ADVISORY-1: Service Discovery via Hardcoded Port (Sprint 11)

The service starts on port 3210 (env-overridable but not registered anywhere). If it restarts on a different port, or if we ever run two instances, the caller breaks silently.

**Path:** Add the correlation engine to a simple service registry: either a `services.json` config file (Phase B) or Eve's service mesh (Phase D). For now, document port 3210 in `public/knowledge.md`.

### ADVISORY-2: HMAC Signing Gap for Message Bus Events (Sprint 11)

Heidi's T1033 recommends HMAC-signed events for all 7 services. The correlation engine currently signs nothing — it returns correlation pairs as HTTP response body. When Phase D lands (Redis message bus), the `CorrelationPairDetected` events must be HMAC-signed before publishing:

```js
const crypto = require('crypto');

function publishCorrelationEvent(pairs) {
  const event = {
    specversion: '1.0',
    type: 'com.agentplanet.d004.CorrelationPairDetected',
    source: 'correlation-engine',
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    data: { pairs },
  };
  // Sign per Heidi T1033 spec
  const payload = JSON.stringify({ type: event.type, source: event.source, id: event.id, data: event.data });
  const sig = crypto.createHmac('sha256', process.env.INTERNAL_BUS_SECRET).update(payload).digest('hex');
  return { ...event, 'x-signature': `sha256=${sig}` };
}
```

This is a no-op for Phase B (HTTP pull model) but must be wired before Phase D.

---

## Data Consistency Note

**During mid-run cluster file updates (file-path mode):**
When `body.path` points to `market_clusters.json` and Ivan's Phase 2 service is writing a new version simultaneously, `loadClusters()` could read a partially-written file. `fs.readFileSync` + `JSON.parse` will throw on truncated JSON → the service returns 500, which is safe (no corrupted result is returned).

Bob's atomic write pattern (write to `.tmp` → rename) in other pipeline stages should also be applied to `market_clusters.json` writes. DM to Ivan: ensure Phase 2 writes atomically.

---

## Summary Matrix

| Risk | Severity | Fix location | Sprint |
|------|----------|-------------|--------|
| No computation timeout | HIGH | `server.js:handleCorrelate` | 10 (before prod) |
| No cardinality cap | MEDIUM | `server.js:validateClusterCardinality` | 10 (before prod) |
| No circuit breaker / retry | HIGH | `live_runner.js` / caller | 10 (before prod) |
| Hardcoded port (service discovery) | LOW | `public/knowledge.md` + service registry | 11 |
| HMAC signing for event bus | LOW | `server.js:publishCorrelationEvent` | When Phase D lands |

**Recommended action:**
1. Bob fixes RISK-1 (timeout) and RISK-2 (cardinality cap) in `server.js` — targeted, low risk
2. Bob or Rosa adds circuit breaker to `live_runner.js` — this is the caller-side fix
3. Ivan confirms atomic write for `market_clusters.json`
4. Phase B is clear for testing immediately; hold production deployment until RISK-1/3 resolved

---

*Run command: `cat agents/rosa/output/phase_b_arch_review.md` — static review document*
