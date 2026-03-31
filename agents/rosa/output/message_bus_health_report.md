# Message Bus Health Report
**Author:** Rosa (Distributed Systems Engineer)
**Date:** 2026-03-30
**Requested by:** Alice

---

## Executive Summary

The message bus has two layers: the **file-based inbox** (`chat_inbox/*.md`) and the new **SQLite message bus** (`backend/messages.db`). Both are healthy for production traffic. The primary concerns are:

1. **charlie** has a severe file-inbox backlog of 282 real unread messages (488 total with QA broadcasts)
2. **SQLite bus** holds 112 unread messages — all E2E test artifacts, not production traffic
3. The `messages_backup` table in SQLite is orphaned and should be dropped
4. No TTL/cleanup mechanism exists for aged-out messages in either layer

---

## 1. File-Based Inbox Backlog (chat_inbox/)

| Agent | Total Unread | Real Messages | QA Broadcasts | Status |
|-------|-------------|---------------|---------------|--------|
| charlie | 488 | **282** | 206 | 🔴 CRITICAL — severe backlog |
| eve | 150 | 9 | 141 | 🟡 WARNING — mostly broadcasts |
| judy | 146 | 4 | 142 | 🟡 WARNING — mostly broadcasts |
| grace | 143 | 14 | 129 | 🟡 WARNING — mostly broadcasts |
| heidi | 25 | 11 | 14 | 🟢 OK |
| frank | 22 | 3 | 19 | 🟢 OK |
| sam | 2 | 1 | 1 | 🟢 OK |
| alice | 0 | 0 | 0 | 🟢 Clean |
| bob | 0 | 0 | 0 | 🟢 Clean |
| dave | 0 | 0 | 0 | 🟢 Clean |
| ivan | 0 | 0 | 0 | 🟢 Clean |
| karl | 0 | 0 | 0 | 🟢 Clean |
| liam | 0 | 0 | 0 | 🟢 Clean |
| mia | 0 | 0 | 0 | 🟢 Clean |
| nick | 0 | 0 | 0 | 🟢 Clean |
| olivia | 0 | 0 | 0 | 🟢 Clean |
| pat | 0 | 0 | 0 | 🟢 Clean |
| quinn | 0 | 0 | 0 | 🟢 Clean |
| rosa | 0 | 0 | 0 | 🟢 Clean |
| tina | 0 | 0 | 0 | 🟢 Clean |

### Key Finding — Charlie's Backlog
Charlie has **282 real unread messages** — this is the most severe inbox health issue in the system. This indicates charlie has not been processing inbox consistently. Recommend:
- Alice/Sam: Check if charlie is stuck or cycling. Start charlie and verify inbox processing.
- The QA broadcast flood (206 messages from `from_tina_e2e`) is a separate systemic issue — all agents receive these but only inactive agents accumulate large counts.

### QA Broadcast Flood
Tina's e2e broadcasts are generating significant noise. Agents that are actively running clear these immediately; agents that are idle accumulate hundreds. The SQLite message bus is the correct fix — it deduplicates and provides queue-depth visibility. Recommend routing all broadcasts through SQLite bus only.

---

## 2. SQLite Message Bus Queue Depth

**Total messages:** 116 | **Unread:** 112 | **Acknowledged:** 4

| Agent | Unread | Oldest Message | Source | Status |
|-------|--------|---------------|--------|--------|
| alice | 15 | 2026-03-30T16:20:33Z | frank (E2E tests) | 🟡 E2E artifacts |
| all others | 5 each | 2026-03-30T16:20:34Z | frank-e2e (broadcast) | 🟡 E2E artifacts |

**Assessment:** All 112 unread messages in SQLite are E2E test artifacts created during Frank's integration test run (`e2e/message_bus.spec.js`). These are not production messages — they contain bodies like "E2E DM test", "E2E broadcast test — safe to ignore", "broadcast-priority-custom-...".

**No stuck production messages.** All are from the same ~1-second batch at 16:20:33Z.

### Priority Distribution (unread)
- Priority 1 (high): 2 messages (alice — E2E priority test)
- Priority 2 (custom broadcast): 20 messages (all agents — E2E broadcast)
- Priority 5 (default): 90 messages (E2E DM tests)
- Priority 9 (over-limit, clamped): 1 message (alice — E2E edge case)

---

## 3. Stuck / Unacknowledged Messages

**No stuck production messages detected.** All unread SQLite messages are E2E test artifacts from a single test run. They have not been acknowledged because no agent is polling the SQLite bus yet (agents still use file-based inbox as primary).

**Oldest unread age:** ~minutes (created 16:20:33Z today)

**Recommendation:** Once agents migrate to polling SQLite bus, add a dead-letter threshold — messages unread for >24h should be moved to a `dead_letters` table and alert Liam.

---

## 4. Schema & Index Analysis

### Current Schema (messages table)
```sql
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent  TEXT    NOT NULL,
  to_agent    TEXT    NOT NULL,
  body        TEXT    NOT NULL CHECK(length(body) <= 65536),
  priority    INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 9),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT    DEFAULT NULL
);

CREATE INDEX idx_messages_inbox ON messages (to_agent, priority, id) WHERE read_at IS NULL;
CREATE INDEX idx_messages_from  ON messages (from_agent, created_at);
```

### Strengths
- `idx_messages_inbox` is optimal for the hot path: `SELECT ... WHERE to_agent=? AND read_at IS NULL ORDER BY priority, id` — covers inbox fetch with priority ordering in a single index scan
- Partial index (`WHERE read_at IS NULL`) keeps the index small as messages are acked
- `CHECK` constraints on body length and priority enforce data integrity at the DB layer
- WAL mode (set at init) enables concurrent readers without blocking writers

### Issues Found

#### Issue 1 — Orphaned `messages_backup` Table
```sql
CREATE TABLE IF NOT EXISTS "messages_backup" (...)
```
This table exists from a migration and is missing `idx_messages_inbox`. It will accumulate data if any code accidentally writes to it. Should be dropped.

**Action for Pat:** `DROP TABLE IF EXISTS messages_backup;`

#### Issue 2 — No TTL / Message Cleanup
Read messages accumulate indefinitely. With 20 agents broadcasting, the table will grow ~2000 rows/day at current broadcast frequency. No cleanup job exists.

**Action for Pat (PostgreSQL migration):** Add a scheduled cleanup:
```sql
-- Delete acked messages older than 30 days
DELETE FROM messages
WHERE read_at IS NOT NULL
  AND read_at < NOW() - INTERVAL '30 days';
```
For SQLite, add a startup cleanup in `initMessageBus()`:
```js
db.prepare("DELETE FROM messages WHERE read_at IS NOT NULL AND read_at < datetime('now', '-30 days')").run();
```

#### Issue 3 — No Composite Index for Audit Queries
Alice's request to identify "agents with inbox backlog >10" requires a full scan today. Add:
```sql
CREATE INDEX IF NOT EXISTS idx_messages_queue_depth
  ON messages (to_agent)
  WHERE read_at IS NULL;
```
This accelerates `SELECT to_agent, COUNT(*) FROM messages WHERE read_at IS NULL GROUP BY to_agent`.

#### Issue 4 — No Sender-Recipient Composite Index
Queries like "show all messages from alice to bob" require a scan. For audit/debugging:
```sql
CREATE INDEX IF NOT EXISTS idx_messages_from_to
  ON messages (from_agent, to_agent, created_at);
```

---

## 5. Recommendations Summary

### Immediate Actions

| Priority | Action | Owner |
|----------|--------|-------|
| P1 | Start charlie — 282 real unread messages need processing | Alice/Sam |
| P1 | Sweep E2E test messages from SQLite bus (112 unread artifacts) | Frank/Tina |
| P2 | Drop `messages_backup` table | Pat |
| P2 | Add message TTL cleanup in `initMessageBus()` | Bob |
| P3 | Route QA broadcasts through SQLite bus only (stop file-based broadcasts to idle agents) | Tina |

### For Pat — PostgreSQL Migration Schema Improvements

```sql
-- 1. Optimal inbox index (same as SQLite partial index)
CREATE INDEX idx_messages_inbox
  ON messages (to_agent, priority, id)
  WHERE read_at IS NULL;

-- 2. Queue depth monitoring index
CREATE INDEX idx_messages_queue_depth
  ON messages (to_agent)
  WHERE read_at IS NULL;

-- 3. Audit index
CREATE INDEX idx_messages_from_to
  ON messages (from_agent, to_agent, created_at);

-- 4. TTL cleanup (run via pg_cron or a scheduled job)
DELETE FROM messages
WHERE read_at IS NOT NULL
  AND read_at < NOW() - INTERVAL '30 days';

-- 5. Add dead-letter table for messages unread >24h
CREATE TABLE dead_letters (
  LIKE messages INCLUDING ALL,
  reason TEXT NOT NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Consider partitioning by to_agent for >50 agents
-- PARTITION BY LIST (to_agent) with one partition per agent group
```

### Distributed Systems Concerns

1. **Dual-write transition risk:** During the migration from file-based to SQLite bus, messages may arrive via either channel. Agents need to poll both until file-based is fully deprecated. Define a cutover date.

2. **No dead-letter queue:** Messages that exceed a retry threshold or age out silently disappear. Add a DLQ with alerting to Liam.

3. **Broadcast fan-out at scale:** Current broadcast writes one row per agent atomically in a transaction. At 20 agents this is fine. At 100+ agents, consider a broadcast table with a single row + subscription model to avoid N-row fan-out.

4. **No message ordering guarantee across priority levels:** Within the same priority, ordering is by `id` (insert order) which is correct. But if two messages with priorities 3 and 5 arrive and only priority-3 is processed, the priority-5 message is not "stuck" — it just hasn't been reached. Document this behavior explicitly.

---

## Conclusion

The SQLite message bus is **healthy and well-designed**. All unread messages are E2E test artifacts. The critical operational issue is **charlie's 282-message file-inbox backlog** — this agent needs immediate attention. The QA broadcast flood is noise, not a bug, but should be routed through SQLite-only to reduce file system clutter.

Schema is production-ready with one fix needed: drop `messages_backup` and add a TTL cleanup.
