-- migration_003_sqlite_message_constraints.sql
-- SQLite messages.db — Add constraints + cleanup utilities
-- Author: Pat (Database Engineer) — 2026-03-30
--
-- Problem:
--   The messages table enforces priority range (1–9) and body length (4096 chars
--   per MAX_BODY_LEN in postMessage/postBroadcast) in application code only.
--   The database accepts out-of-range values if accessed directly or if app logic changes.
--
-- SQLite cannot ADD CONSTRAINTS to existing tables via ALTER TABLE.
-- This migration uses the standard SQLite pattern: create a new table with the
-- desired constraints, migrate data, then replace the original table atomically.
--
-- The old indexes (idx_messages_inbox, idx_messages_from) are on the original
-- messages table (renamed to messages_backup). We drop them from the backup,
-- then recreate them with canonical names on the new messages table.
--
-- Apply (SQLite):
--   sqlite3 backend/messages.db < backend/migration_003_sqlite_message_constraints.sql
--
-- Verify:
--   sqlite3 backend/messages.db "PRAGMA integrity_check;"
--   sqlite3 backend/messages.db "SELECT COUNT(*) FROM messages;"
--   sqlite3 backend/messages.db ".indexes messages"
--   sqlite3 backend/messages.db "INSERT INTO messages(from_agent,to_agent,body,priority) VALUES('x','y','test',10);"
--   -- ^ should fail with: CHECK constraint failed: priority
--
-- Rollback:
--   BEGIN;
--   DROP TABLE IF EXISTS messages;
--   ALTER TABLE messages_backup RENAME TO messages;
--   CREATE INDEX IF NOT EXISTS idx_messages_inbox   ON messages (to_agent, priority, id) WHERE read_at IS NULL;
--   CREATE INDEX IF NOT EXISTS idx_messages_from    ON messages (from_agent, created_at);
--   CREATE INDEX IF NOT EXISTS idx_messages_read_at ON messages (read_at) WHERE read_at IS NOT NULL;
--   COMMIT;
-- ============================================================================

BEGIN;

-- Step 1: Create new table with proper constraints
CREATE TABLE messages_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent  TEXT    NOT NULL CHECK(length(trim(from_agent)) > 0 AND length(from_agent) <= 64),
  to_agent    TEXT    NOT NULL CHECK(length(trim(to_agent))   > 0 AND length(to_agent)   <= 64),
  body        TEXT    NOT NULL CHECK(length(body) > 0 AND length(body) <= 4096),
  priority    INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 9),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT    DEFAULT NULL
);

-- Step 2: Migrate existing data, clamping any out-of-range values
INSERT INTO messages_new
  SELECT
    id,
    from_agent,
    to_agent,
    substr(body, 1, 65536),
    MAX(1, MIN(9, priority)),
    created_at,
    read_at
  FROM messages;

-- Step 3: Swap tables (rename old → backup, new → canonical)
ALTER TABLE messages     RENAME TO messages_backup;
ALTER TABLE messages_new RENAME TO messages;

-- Step 4: Drop old indexes from backup table, then recreate on new messages table
-- (SQLite index names are global; the old indexes now point to messages_backup)
DROP INDEX IF EXISTS idx_messages_inbox;
DROP INDEX IF EXISTS idx_messages_from;
DROP INDEX IF EXISTS idx_messages_read_at;

CREATE INDEX idx_messages_inbox    ON messages (to_agent, priority, id) WHERE read_at IS NULL;
CREATE INDEX idx_messages_from     ON messages (from_agent, created_at);
CREATE INDEX idx_messages_read_at  ON messages (read_at) WHERE read_at IS NOT NULL;

COMMIT;

-- After verifying row counts match, drop the backup and reclaim space:
-- DROP TABLE messages_backup;
-- VACUUM;

-- ============================================================================
-- CLEANUP UTILITY: Purge old read messages
-- ============================================================================
-- NOTE: message_bus.js now handles retention automatically:
--   1. Auto-vacuum on startup: deletes read messages older than MB_RETENTION_DAYS (default 7)
--   2. DELETE /api/messages/purge?days=N — on-demand via API (read messages only)
--      e.g.: curl -X DELETE "http://localhost:3199/api/messages/purge?days=7"
--   3. DELETE /api/messages/purge?days=N&unread=true — also purges unread beyond window
--      uses julianday(created_at); use with caution in production
--
-- Manual SQL fallback (if server is down or for e2e test cleanup):
--
-- 7-day retention (read messages only):
--   DELETE FROM messages
--   WHERE read_at IS NOT NULL
--     AND read_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days');
--   VACUUM;
--
-- Emergency: purge e2e test messages (dev/test environments only):
--   DELETE FROM messages WHERE from_agent LIKE 'e2e%';
--   VACUUM;
-- ============================================================================
