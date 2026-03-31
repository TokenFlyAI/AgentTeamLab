# Security Review — Grace's ETL Pipeline & Migration Files

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-03-30
**Files Reviewed:**
- `agents/grace/output/etl_pipeline.js`
- `agents/grace/output/migration_003_metrics_integration.sql`
- `agents/grace/output/migration_005_metrics_integration.sql`

**Overall Verdict: CONDITIONAL PASS**
Grace addressed the hardcoded credentials issue from the `agent_state_sync.js` review. The SQL is injection-free. One HIGH finding must be fixed before production deployment.

---

## Findings

### ETL-001 — HIGH: Missing API Key on Internal HTTP Requests

**File:** `etl_pipeline.js`, `fetchJson()` function (lines ~42–53)

**Issue:** The ETL pipeline calls `/api/metrics`, `/api/agents`, and `/api/cost` without an `Authorization` header. In any environment with `API_KEY` set (which is all non-dev environments), these calls will return `401 Unauthorized`, and the ETL will run with empty data — silently corrupting the DB with zero-row syncs.

```js
// Current — no auth header
client.get(url.toString(), (res) => { ... })
```

**Fix:** Read `API_KEY` from env and add the header:

```js
const API_KEY = process.env.API_KEY || '';

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const client = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {},
    };
    client.get(options, (res) => { ... });
  });
}
```

**Priority:** HIGH — blocks correct operation in any auth-enabled deployment.

---

### ETL-002 — MEDIUM: No Timeout on HTTP Requests

**File:** `etl_pipeline.js`, `fetchJson()` function

**Issue:** HTTP requests have no timeout. If the dashboard is unresponsive, `fetchJson()` hangs indefinitely. In `--watch` mode, this blocks all subsequent ETL runs and leaks the DB connection open forever.

**Fix:** Add `req.setTimeout()` with a 10-second limit:

```js
const req = client.get(options, (res) => { ... });
req.setTimeout(10000, () => {
  req.destroy(new Error(`Timeout fetching ${path}`));
});
req.on('error', reject);
```

---

### ETL-003 — LOW: No Length Constraint on Free-Text Fields

**File:** `etl_pipeline.js`, `upsertAgents()` + migration files

**Issue:** `agent_name`, `role`, `department`, `task_title` fields in both `agent_cycles` and `agent_heartbeats` are `TEXT` with no length constraint. SQL injection is **not possible** (parameterized queries throughout — good), but an unbounded agent_name in a heartbeat row could slowly fill disk in long-running deployments.

**Fix (migration):** Add length constraints:
```sql
agent_name  TEXT NOT NULL CHECK (char_length(agent_name) <= 64),
task_title  TEXT          CHECK (task_title IS NULL OR char_length(task_title) <= 256)
```

**Priority:** LOW — no exploitation path in current architecture, but good hygiene.

---

### MIG-001 — MEDIUM: Duplicate "Migration 005" Naming (Ops Risk)

**Files:** Both migration SQL files are internally labeled "Migration 005":
- `migration_003_metrics_integration.sql` → header says "Migration 005"
- `migration_005_metrics_integration.sql` → header says "Migration 005"

**Issue:** If a migration runner applies them both (ordered by filename), both will run:
- `CREATE TABLE IF NOT EXISTS` — safe, second run is a no-op
- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` — safe, idempotent
- But `CREATE INDEX IF NOT EXISTS idx_rm_endpoint_ts` (in 003) AND `CREATE INDEX IF NOT EXISTS idx_rm_endpoint_recorded_at` (in 005) will BOTH be created on `request_metrics`, leaving a redundant duplicate index with different names

Additionally, the `migration_005` file header says "Replaces: migration_003_metrics_integration.sql" but they are both present. Grace should clarify which is canonical and delete the other.

**Action for Grace:** Determine which file is the canonical 005 migration. Delete the stale one. Rename the remaining file consistently.

---

### MIG-002 — INFO: No Explicit GRANT Statements

**Files:** Both migration files

**Observation:** Neither migration grants read/write access to specific roles. In production PostgreSQL with proper role separation (e.g., `etl_user` role with limited permissions), the ETL pipeline user will need explicit GRANTs on `agent_cycles`, `agent_heartbeats`, `metrics_snapshots`.

**Recommendation:** Pat or Grace should add a `-- Post-migration grants` section:
```sql
GRANT SELECT, INSERT, UPDATE ON agent_cycles TO etl_user;
GRANT SELECT, INSERT ON agent_heartbeats TO etl_user;
GRANT SELECT, INSERT ON metrics_snapshots TO etl_user;
```
Not blocking for dev; required for prod hardening.

---

## Positive Controls

- ✅ **No hardcoded credentials** — `DB_URL` required via env var with clear fail-fast error (CWE-259 avoided)
- ✅ **All PostgreSQL queries parameterized** — no SQL injection risk anywhere in etl_pipeline.js
- ✅ **DRY_RUN mode** — safe for testing without executing any DB writes
- ✅ **Fail-fast on missing DB_URL** — exits with clear error, no silent null connection
- ✅ **Migration tables use `IF NOT EXISTS`** — idempotent, safe to re-run
- ✅ **Trigger function uses SELECT-INTO only** — no dynamic SQL in `fn_set_agent_id()`
- ✅ **All timestamp columns use `TIMESTAMPTZ`** — timezone-aware, no TZ confusion bugs
- ✅ **CHECK constraints on metrics_snapshots** — `total_errors <= total_requests`, `error_rate BETWEEN 0 AND 1`
- ✅ **`error.message` in catch blocks** — not leaking stack traces to stdout by default

---

## Summary

| ID | Severity | File | Issue | Action |
|----|----------|------|-------|--------|
| ETL-001 | HIGH | etl_pipeline.js | No API key on internal HTTP calls | Grace must fix before staging deploy |
| ETL-002 | MEDIUM | etl_pipeline.js | No HTTP request timeout | Fix to prevent hung watch cycles |
| ETL-003 | LOW | etl_pipeline.js + migrations | No TEXT length constraints | Add CHECK constraints in migrations |
| MIG-001 | MEDIUM | Both migration files | Both labeled "Migration 005" | Grace to delete stale file, rename canonical one |
| MIG-002 | INFO | Both migration files | No GRANT statements | Add for prod; not blocking for dev |

**Blocking for production deploy:** ETL-001 only.
