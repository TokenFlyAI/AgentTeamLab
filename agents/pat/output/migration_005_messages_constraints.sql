-- =============================================================================
-- Migration 005: messages — Add CHECK Constraints + Drop Unused Index
-- Designer: Pat (Database Engineer)
-- Date: 2026-03-30
-- Target: SQLite (backend/messages.db via better-sqlite3)
--
-- *** SUPERSEDED ***
-- Use backend/migration_003_sqlite_message_constraints.sql instead.
-- That file is more complete: clamps out-of-range data during copy,
-- preserves old rows in messages_backup (safer rollback), and is
-- already in the backend/ directory where Bob applies migrations.
-- This file is kept for reference only — do NOT apply.
-- Depends on: message_bus.js SCHEMA (messages table with 7 columns)
-- =============================================================================
-- Purpose:
--   1. Add CHECK(priority BETWEEN 1 AND 9) — currently only enforced in app code
--   2. Add CHECK(length(body) <= 65536) — 64 KB cap, matches parseBody() limit
--   3. Drop idx_messages_from — covers (from_agent, created_at) but no current
--      query uses it; adds write overhead with zero read benefit
--
-- Safety notes:
--   - SQLite cannot ALTER TABLE to add CHECK constraints — requires table rebuild
--   - Migration copies all existing rows; invalid rows (if any) will error on
--     copy — run SELECT below to audit before migrating
--   - AUTOINCREMENT: sqlite_sequence is updated by the RENAME, so the new table
--     inherits the next rowid correctly
--   - Rollback: script is wrapped in a transaction; any error rolls back fully
--
-- Pre-migration audit (run manually, should return 0 rows):
--   SELECT id, priority FROM messages WHERE priority NOT BETWEEN 1 AND 9;
--   SELECT id, length(body) FROM messages WHERE length(body) > 65536;
--
-- Apply:
--   sqlite3 backend/messages.db < agents/pat/output/migration_005_messages_constraints.sql
--
-- Rollback (restore from backup taken before running):
--   cp backend/messages.db.bak backend/messages.db
-- =============================================================================

-- Pre-flight: take a backup in the shell before running this script.
-- cp backend/messages.db backend/messages.db.bak

PRAGMA foreign_keys = OFF;  -- no FK refs into messages, but safe practice during rebuild

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Create new table with CHECK constraints
-- ---------------------------------------------------------------------------
CREATE TABLE messages_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent  TEXT    NOT NULL,
  to_agent    TEXT    NOT NULL,
  body        TEXT    NOT NULL CHECK(length(body) <= 65536),
  priority    INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 9),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT    DEFAULT NULL
);

-- ---------------------------------------------------------------------------
-- Step 2: Copy all data from old table
-- If any row violates the constraints, this will FAIL and the transaction
-- rolls back — the original table is untouched.
-- ---------------------------------------------------------------------------
INSERT INTO messages_new (id, from_agent, to_agent, body, priority, created_at, read_at)
  SELECT id, from_agent, to_agent, body, priority, created_at, read_at
  FROM messages;

-- ---------------------------------------------------------------------------
-- Step 3: Swap tables
-- ---------------------------------------------------------------------------
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

-- ---------------------------------------------------------------------------
-- Step 4: Recreate useful indexes
-- idx_messages_from is intentionally NOT recreated (no query uses from_agent filter)
-- idx_messages_read_at IS recreated — supports auto-vacuum and /api/messages/purge
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_inbox
  ON messages (to_agent, priority, id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_read_at
  ON messages (read_at)
  WHERE read_at IS NOT NULL;

-- Note: idx_messages_from (from_agent, created_at) is omitted — no query in
-- message_bus.js uses from_agent as a filter predicate. Re-add if needed.

COMMIT;

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Verification queries (run after migration)
-- ---------------------------------------------------------------------------
-- Check table schema:
--   PRAGMA table_info(messages);
--
-- Confirm constraint exists:
--   SELECT sql FROM sqlite_master WHERE type='table' AND name='messages';
--
-- Confirm index count (expect 2: idx_messages_inbox + idx_messages_read_at):
--   SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='messages';
--
-- Row count should match pre-migration:
--   SELECT COUNT(*) FROM messages;
