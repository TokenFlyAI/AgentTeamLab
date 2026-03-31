# SQLite Database Health Report
**Agent:** Pat (Database Engineer)
**Date:** 2026-03-30T21:06:05Z
**Database:** `backend/messages.db`
**Requested by:** Alice (Task #146)

---

## Executive Summary

The SQLite message bus database is **healthy** with one structural issue (leftover backup table with a misplaced index) and one maintenance item (WAL file checkpoint). Core integrity passes, WAL mode is confirmed active, and the primary inbox index is working correctly.

| Check | Status | Notes |
|-------|--------|-------|
| Integrity check | ✅ PASS | `integrity_check` = ok |
| WAL mode | ✅ ACTIVE | `journal_mode` = wal |
| messages schema | ✅ CORRECT | CHECK constraints present |
| Inbox index coverage | ✅ GOOD | Partial index used by query planner |
| messages_backup table | ⚠️ STALE | Leftover from migration rebuild — should be dropped |
| idx_messages_read_at index | ⚠️ WRONG TABLE | On messages_backup, not messages |
| WAL file size | ⚠️ LARGE | 4.1 MB — checkpoint recommended |
| Page fragmentation | ⚠️ MODERATE | 16/32 pages free (50%) — VACUUM after backup drop |

---

## 1. PRAGMA integrity_check

```
Result: ok
```

No corruption detected. All page checksums, table structure, and index consistency verified by SQLite's internal integrity checker.

---

## 2. PRAGMA journal_mode — WAL Mode

```
journal_mode: wal
```

✅ WAL mode is active. This is correct — WAL provides:
- Concurrent readers + single writer (no reader locks)
- Better write throughput for the message bus pattern
- Crash-safe writes without full sync

**WAL file status:**
- `messages.db-wal`: 4,128,272 bytes (4.1 MB) — **needs checkpoint**
- `messages.db-shm`: 32,768 bytes (normal)

The WAL file has grown to 4 MB since the last checkpoint. This doesn't affect correctness but does slow read performance (readers must scan WAL). The message_bus.js auto-vacuum on startup should handle this, but a manual checkpoint is recommended now.

**Recommended action:**
```sql
PRAGMA wal_checkpoint(TRUNCATE);
```

---

## 3. messages Table Schema

```sql
CREATE TABLE "messages" (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent  TEXT    NOT NULL,
  to_agent    TEXT    NOT NULL,
  body        TEXT    NOT NULL CHECK(length(body) <= 65536),
  priority    INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 9),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT    DEFAULT NULL
)
```

✅ Schema matches the intended design:
- `body` length capped at 64KB (prevents message bloat)
- `priority` constrained to 1–9 range (matches application clamping in message_bus.js)
- `read_at` nullable (NULL = unread, ISO timestamp = read) — correct inbox pattern
- All NOT NULL constraints on required fields

---

## 4. Index Coverage on messages Table

### Current indexes on messages:

| Index | Type | Columns | Filter | Purpose |
|-------|------|---------|--------|---------|
| `idx_messages_inbox` | Partial | `(to_agent, priority, id)` | `WHERE read_at IS NULL` | Inbox retrieval — primary query pattern |
| `idx_messages_from` | Full | `(from_agent, created_at)` | none | Sent-message lookups |

### Query plan analysis:

**Inbox query** (`GET /api/messages/:agent` — primary use case):
```
EXPLAIN QUERY PLAN:
SELECT * FROM messages WHERE to_agent='alice' AND read_at IS NULL ORDER BY priority, id
→ SEARCH messages USING INDEX idx_messages_inbox (to_agent=?) ✅
```
The partial index `idx_messages_inbox` is used correctly. Priority ordering is covered by the composite index.

**From-agent query** (`from_agent='alice'`):
```
→ SEARCH messages USING INDEX idx_messages_from (from_agent=?) ✅
```
Index is used, though this query pattern is low-frequency for this workload.

### Row counts:
- `messages`: 116 rows (active)
- `messages_backup`: 162 rows (stale — see Finding 1)

---

## 5. Findings

### FINDING-1: messages_backup table — stale leftover (ACTION REQUIRED)

The `messages_backup` table is a remnant of the migration_003_sqlite table rebuild procedure (SQLite requires a full table copy-swap to add CHECK constraints). It should have been dropped after the migration was verified.

**Current state:**
```sql
-- messages_backup has NO CHECK constraints (old schema):
CREATE TABLE "messages_backup" (
    body TEXT NOT NULL,           -- no body length limit
    priority INTEGER NOT NULL DEFAULT 5   -- no range check
    ...
)
-- Contains 162 rows (pre-migration historical messages)
```

**Impact:**
- Wastes disk space (162 historical rows duplicating pre-migration state)
- Creates confusion — backup contains unvalidated data without constraints
- The misplaced `idx_messages_read_at` index (see Finding 2) is on this table

**Fix:**
```sql
DROP TABLE IF EXISTS messages_backup;
```

---

### FINDING-2: idx_messages_read_at on WRONG table (BUG)

The `idx_messages_read_at` index — intended to support the `/api/messages/purge` endpoint — was created on `messages_backup` instead of `messages`.

```sql
-- Current (WRONG — on backup table):
CREATE INDEX idx_messages_read_at ON "messages_backup" (read_at) WHERE read_at IS NOT NULL;

-- Should be:
CREATE INDEX idx_messages_read_at ON messages (read_at) WHERE read_at IS NOT NULL;
```

**Impact:** The purge query (`DELETE FROM messages WHERE read_at IS NOT NULL AND read_at < ?`) does a full table scan on `messages` instead of using the index. At 116 rows this is negligible, but will degrade as message volume grows.

**Fix (after dropping messages_backup):**
```sql
CREATE INDEX IF NOT EXISTS idx_messages_read_at
  ON messages (read_at)
  WHERE read_at IS NOT NULL;
```

---

### FINDING-3: WAL checkpoint recommended

WAL file is 4.1 MB. The message_bus.js auto-vacuum on startup checkpoints WAL automatically, but since the server runs continuously, this only fires on next restart.

**Manual checkpoint (safe to run any time):**
```javascript
const db = require('better-sqlite3')('backend/messages.db');
const result = db.pragma('wal_checkpoint(TRUNCATE)');
console.log(result); // should show busy:0, log:N, checkpointed:N
db.close();
```

---

### FINDING-4: Page fragmentation — 50%

- Total pages: 32 (131 KB total file)
- Free pages: 16 (50%)

After dropping `messages_backup`, a `VACUUM` is recommended to reclaim space and defragment. This is a maintenance operation, not a bug.

```sql
VACUUM;
```

---

## Recommended Fix Script

The following addresses all findings in the correct order:

```javascript
// Run as: node -e "require('./backend/fix_messages_db')"
const Database = require('better-sqlite3');
const db = new Database('backend/messages.db');

// Finding 1: Drop stale backup
db.exec('DROP TABLE IF EXISTS messages_backup;');

// Finding 2: Create idx_messages_read_at on the CORRECT table
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_read_at
    ON messages (read_at)
    WHERE read_at IS NOT NULL;
`);

// Finding 3: Checkpoint WAL
db.pragma('wal_checkpoint(TRUNCATE)');

// Finding 4: Defragment (must be outside transaction)
db.exec('VACUUM;');

console.log('Done.');
db.close();
```

---

## Migration Status

### SQLite

| File | Status |
|------|--------|
| `backend/migration_003_sqlite_message_constraints.sql` | Applied ✅ (CHECK constraints confirmed in schema) |
| Fix script above (backup drop + index fix + vacuum) | **Recommended — pending Bob/Eve action** |

### PostgreSQL (Task #114)

All migrations BLOCKED on docker/psql access. All SQL correct and ready.

| # | File | Status |
|---|------|--------|
| 001 | `backend/migration_001_task_board_schema.sql` | Ready ✅ |
| 002 | `backend/migration_002_add_request_metrics.sql` | Ready ✅ |
| 003 | `agents/pat/output/migration_003_assignee_uuid_fk.sql` | Ready ✅ |
| 004 | `agents/grace/output/migration_005_metrics_integration.sql` | Ready ✅ |
| 005 | `agents/pat/output/migration_004_message_bus.sql` | Ready ✅ |

Full runbook: `agents/pat/output/migration_execution_runbook.md`

---

## Rosa's Additional Recommendations (PostgreSQL migration)

Rosa reviewed the message bus schema (message_bus_health_report.md §4) with these PostgreSQL-specific recommendations:

| Recommendation | Status | Notes |
|----------------|--------|-------|
| Drop messages_backup | ✅ Adopted | Already in fix script above |
| Queue-depth index `(to_agent) WHERE read_at IS NULL` | ✅ Already in migration_004 | `agents/pat/output/migration_004_message_bus.sql` |
| TTL cleanup (pg_cron 30-day retention) | ✅ Already in migration_004 | NOTIFY-based retention logic included |
| Dead-letter table for messages unread >24h | 📋 Future enhancement | Not in current migration scope; Liam to wire alerts |
| Broadcast subscription table at 100+ agents | 📋 Future enhancement | Current 20-agent fan-out is fine; revisit at scale |

---

*Report generated by Pat (Database Engineer) — 2026-03-30*
*Updated: 2026-03-30T21:10:00Z — added Rosa's schema recommendations*
