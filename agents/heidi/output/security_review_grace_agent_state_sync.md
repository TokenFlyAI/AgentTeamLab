# Security Review — Grace's agent_state_sync.js

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-03-30
**File:** `agents/grace/output/agent_state_sync.js`
**Verdict:** CONDITIONAL PASS — 2 MEDIUM findings, fix before production

---

## Summary

Well-structured sync pipeline. All DB queries use parameterized statements
(no SQL injection risk), PG_PASSWORD is correctly required via env var with no
hardcoded credentials (improvement over earlier Grace files), and the AGENTS
array is hardcoded (no path injection surface). Two medium findings must be
fixed before production deployment.

---

## Findings

### ASS-001 MEDIUM — NaN watch interval causes tight DB polling loop (DoS)

**Location:** lines 409-412 (CLI parsing) + line 394 (watchMode setInterval)

If `--interval` is provided without a numeric value (e.g. `--interval foo` or
`--interval` at end of args), `parseInt` returns `NaN`. Node.js treats
`setInterval(fn, NaN)` as a ~1ms interval, causing the sync function to
execute in a near-continuous loop that exhausts the PG connection pool.

```js
// Current (vulnerable)
const intervalSec = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : 60;
// ...
setInterval(() => { ... }, intervalSec * 1000);  // NaN * 1000 = NaN → 1ms
```

**Fix — guard at parse site and add floor in watchMode:**
```js
const rawInterval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : 60;
const intervalSec = (Number.isFinite(rawInterval) && rawInterval >= 5) ? rawInterval : 60;
if (!Number.isFinite(rawInterval)) log("WARN: invalid --interval, defaulting to 60s");
```
And harden `watchMode` itself as defense-in-depth:
```js
function watchMode(intervalSec, syncFn) {
  const safeMs = Math.max(5000, (intervalSec || 60) * 1000);
  setInterval(() => syncFn().catch(e => log(`Sync error: ${e.message}`)), safeMs);
}
```

---

### ASS-002 MEDIUM — Snapshot files in /tmp are world-readable (info disclosure)

**Location:** lines 222-243 (writeSnapshot)

`/tmp/aicompany_snapshots/` is created with default permissions (world-readable
on Linux/macOS). Snapshots contain the full task board (all tasks, descriptions,
assignees, statuses) and all 20 agent heartbeat timestamps. Any local user on
the server can read this.

```js
fs.mkdirSync(snapshotDir, { recursive: true });        // mode ~0755
fs.writeFileSync(outFile, JSON.stringify(...), "utf8"); // mode ~0644
```

**Fix:**
```js
if (!fs.existsSync(snapshotDir)) {
  fs.mkdirSync(snapshotDir, { recursive: true, mode: 0o700 }); // owner-only
}
// ...
fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
```

---

### ASS-003 LOW — Audit events not deduplicated across sync runs (data integrity)

**Location:** syncAudit(), lines 350-380

`syncAudit()` inserts all unread inbox files as audit log rows but never marks
them as processed. Running `--sync audit` twice before agents read their
inboxes inserts duplicate rows, undermining audit trail accuracy.

**Fix (preferred):** Add a unique constraint on `audit_log(entity_id, actor_name, created_at)`
and use `ON CONFLICT DO NOTHING` on the INSERT. No file-system changes needed.

---

### ASS-004 INFO — Unknown senders produce NULL actor_id in audit log

**Location:** line 363

Inbox messages from non-agent senders (e.g. `from_ceo`, `from_tina_e2e`) won't
resolve to a DB UUID, so `actor_id` is NULL. The `details.sender` field
preserves the raw name, so no data is truly lost — but queries filtering on
`actor_id IS NOT NULL` will silently exclude these rows.

**Recommendation:** Add a comment documenting the expected NULL behavior.
No code change required.

---

## Positive Controls

- All SQL parameterized ($1, $2…) — no injection risk ✅
- PG_PASSWORD required via env var; throws if missing ✅
- No hardcoded DB credentials (improvement over metrics_pg_writer.js) ✅
- AGENTS array hardcoded — no path injection via agent names ✅
- Sender name extracted with `\w+` regex — constrained input ✅
- Enum whitelisting before DB insert (priority, status) ✅
- SYNC_DRY_RUN=1 flag for safe testing ✅
- Snapshot 24h cleanup prevents unbounded /tmp growth ✅
- pgPool.end() in finally block — no connection leak ✅

---

## Action Items for Grace

| # | Severity | Finding | Action |
|---|----------|---------|--------|
| ASS-001 | MEDIUM | NaN watch interval → tight DB loop | Add `Number.isFinite` guard + 5s floor |
| ASS-002 | MEDIUM | /tmp snapshots world-readable | `mode: 0o700` dir, `mode: 0o600` files |
| ASS-003 | LOW | Audit dedup missing | `ON CONFLICT DO NOTHING` on audit_log insert |
| ASS-004 | INFO | NULL actor_id for unknown senders | Document in comment |

Fix ASS-001 and ASS-002 before deploying in `--watch` mode or on a shared server.
ASS-003 is non-blocking if no unique constraint exists on audit_log yet.
