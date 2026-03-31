# Security Review — Grace ETL & Metrics Writer
**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-03-30
**Files:** `agents/grace/output/etl_pipeline.js`, `agents/grace/output/metrics_pg_writer.js`
**Status:** CONDITIONAL PASS (2 medium findings must be addressed before production deployment)

---

## Summary

Both files are well-structured with good security hygiene overall: parameterized queries throughout (no SQL injection), fail-fast for missing DB credentials in `etl_pipeline.js`, and no dangerous shell calls. However, two medium issues and two low findings need attention before these components go to production.

---

## etl_pipeline.js

### ETL-001 — HIGH: Missing API Key Auth in Internal Fetch Calls

**Location:** `etl_pipeline.js:41-54` (`fetchJson`)

**Issue:** All API calls (`/api/metrics`, `/api/agents`, `/api/cost`) are made without an `Authorization: Bearer $API_KEY` header. If the server has `API_KEY` set (which it does in production — see SEC-001), every fetch returns 401. The ETL silently catches the error as a JSON parse failure and continues with empty data, producing misleading DB records.

**Related:** Task #141 (Bob adding auth headers to internal scripts) should cover this. Grace must also update `fetchJson` to include the header.

**Fix:**
```js
const API_KEY = process.env.API_KEY || '';

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const opts = { headers: API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {} };
    const client = url.protocol === 'https:' ? https : http;
    client.get(url.toString(), opts, (res) => { /* ... */ });
  });
}
```

**Severity:** HIGH — ETL silently produces empty/incorrect data in auth-enabled environments.

---

### ETL-002 — MEDIUM: SSRF via Unvalidated `API_BASE`

**Location:** `etl_pipeline.js:28`

**Issue:** `API_BASE = process.env.API_BASE || 'http://localhost:3199'`. An attacker with access to the process environment can set `API_BASE` to an internal service URL (e.g., `http://169.254.169.254/latest/meta-data`) and use the ETL pipeline as an SSRF probe. The fetched data then gets written to the database, potentially exfiltrating cloud metadata.

**Fix:** Validate that `API_BASE` is a loopback/localhost address before use:
```js
const parsedBase = new URL(API_BASE);
if (!['localhost', '127.0.0.1', '::1'].includes(parsedBase.hostname)) {
  console.error('ERROR: API_BASE must point to localhost');
  process.exit(1);
}
```

**Severity:** MEDIUM — requires environment access to exploit; loopback validation mitigates.

---

### ETL-003 — MEDIUM: Unbounded HTTP Response Body in `fetchJson`

**Location:** `etl_pipeline.js:47`

**Issue:** `body += d` with no size cap. If the API endpoint returns an unexpectedly large response (misconfiguration, memory dump, etc.) the process will exhaust heap memory.

**Fix:** Add a 10 MB cap:
```js
const MAX_BODY = 10 * 1024 * 1024;
res.on('data', d => {
  if (body.length + d.length > MAX_BODY) {
    reject(new Error(`Response too large on ${path}`));
    res.destroy();
    return;
  }
  body += d;
});
```

**Severity:** MEDIUM — denial-of-service against the ETL process itself.

---

### ETL-004 — LOW: `--watch` with Missing Interval Argument Causes Tight Loop

**Location:** `etl_pipeline.js:38`

**Issue:** `process.argv[watchArg + 1]` is `undefined` if `--watch` is the last argument. `parseInt(undefined, 10)` → `NaN`, `NaN * 1000` → `NaN`. `setInterval(runEtl, NaN)` in Node.js is equivalent to `setInterval(runEtl, 0)` — the ETL runs as fast as possible, hammering the API and database.

**Fix:**
```js
const rawInterval = parseInt(process.argv[watchArg + 1], 10);
if (isNaN(rawInterval) || rawInterval < 5) {
  console.error('ERROR: --watch requires a numeric interval >= 5 (seconds)');
  process.exit(1);
}
const WATCH_INTERVAL = rawInterval * 1000;
```

**Severity:** LOW — operational DoS risk (no malicious input required, just a CLI mistake).

---

## metrics_pg_writer.js

### MPW-001 — MEDIUM: Hardcoded Default Database Password

**Location:** `metrics_pg_writer.js:47`

**Issue:**
```js
password: process.env.PG_PASSWORD || "tokenfly_dev",
```

If `PG_PASSWORD` is not set, the module silently uses the hardcoded string `"tokenfly_dev"` as the PostgreSQL password (CWE-259). This is the same pattern flagged in `agent_state_sync.js` (finding in `security_review_grace_agent_state_sync.md`). Developers who deploy without setting env vars will inadvertently use the default credential, and the default password may be committed to repos or documentation.

`etl_pipeline.js` correctly fails fast when `DB_URL` is missing — `metrics_pg_writer.js` should do the same for `PG_PASSWORD`.

**Fix:** Remove the hardcoded fallback and log a warning (or throw) if `PG_PASSWORD` is unset:
```js
const pgPassword = process.env.PG_PASSWORD;
if (!pgPassword) {
  console.warn('[MetricsPgWriter] WARNING: PG_PASSWORD not set — using unauthenticated connection. Set PG_PASSWORD in production.');
}
const DEFAULT_PG = {
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE || 'tokenfly',
  user:     process.env.PG_USER     || 'tokenfly',
  password: pgPassword,   // undefined → pg uses trust/peer auth (explicit)
};
```

**Severity:** MEDIUM — same finding as MPW-001 in `agent_state_sync.js`. Consistent pattern suggests a copy-paste template issue across Grace's files.

---

### MPW-002 — LOW: Silent Row Drop on Flush Error

**Location:** `metrics_pg_writer.js:303`

**Issue:**
```js
const rows = this._buffer.splice(0);  // drain buffer atomically
// ...
} catch (err) {
  console.error("[MetricsPgWriter] flush error:", err.message, "— rows dropped:", rows.length);
```

If the DB insert fails (e.g., network blip, constraint violation), the rows are already spliced from the buffer and are permanently lost. The console.error is the only signal. In high-throughput scenarios this silently degrades data completeness.

**Fix:** Push rows back to the front of the buffer on failure, with a retry cap to avoid unbounded growth:
```js
} catch (err) {
  console.error("[MetricsPgWriter] flush error:", err.message, "— requeueing", rows.length, "rows");
  this._buffer.unshift(...rows.slice(0, 200)); // cap requeue to avoid unbounded growth
}
```

**Severity:** LOW — data loss, not a security issue per se, but relevant for audit integrity.

---

## Positive Controls

| # | Control | Notes |
|---|---------|-------|
| 1 | Parameterized queries throughout (`$1`, `$2`...) | No SQL injection risk |
| 2 | `DB_URL` fail-fast in etl_pipeline.js | Prevents silent misconfiguration |
| 3 | `pg` lazy-loaded, graceful disable if not installed | No hard crash on missing dep |
| 4 | Pool size capped at 3 | Prevents connection exhaustion |
| 5 | `_migrate()` uses `CREATE TABLE IF NOT EXISTS` | Idempotent schema setup |
| 6 | Buffer drain is synchronous (`splice`) | Prevents duplicate inserts on concurrent flush calls |

---

## Action Items

| Finding | Owner | Priority |
|---------|-------|----------|
| ETL-001: Add `Authorization: Bearer $API_KEY` to `fetchJson` | Grace | HIGH — ETL is broken in prod without this |
| MPW-001: Remove `"tokenfly_dev"` hardcoded password fallback | Grace | Medium — before any staging/prod deployment |
| ETL-002: Validate `API_BASE` is loopback before use | Grace | Medium — before production deployment |
| ETL-003: Add 10 MB body size cap to `fetchJson` | Grace | Medium |
| ETL-004: Validate `--watch` interval argument | Grace | Low |
| MPW-002: Requeue rows on flush failure | Grace | Low — improves audit data completeness |
