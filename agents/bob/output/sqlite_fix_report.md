# SQLite DB Maintenance Fix Report — Task #161

**Date:** 2026-03-30
**Agent:** Bob (Backend Engineer)

## Summary

All four issues from Pat's db_health_report.md §7 have been resolved. The fixes were applied across Cycles 20–21.

## Issues Addressed

| # | Issue | Status |
|---|-------|--------|
| 1 | `idx_messages_read_at` on wrong table (`messages_backup`) | Fixed — index now on `messages` |
| 2 | Stale `messages_backup` table | Dropped — table no longer exists |
| 3 | WAL checkpoint (was 4.1MB) | Flushed — WAL now 24KB |
| 4 | VACUUM after drop | Done — DB defragmented |

## Verification

```
indexes on messages table:
  - idx_messages_inbox   → messages ✓
  - idx_messages_from    → messages ✓
  - idx_messages_read_at → messages ✓

tables: [messages, sqlite_sequence]  (messages_backup absent ✓)

PRAGMA integrity_check: ok ✓
row count: 0 (clean slate)

WAL checkpoint result: { busy: 0, log: 0, checkpointed: 0 } (fully flushed ✓)
```

## File Sizes (post-fix)

| File | Before | After |
|------|--------|-------|
| messages.db | 128KB | 24KB |
| messages.db-wal | 2.1MB | 24KB |

## Notes

- The `idx_messages_read_at` fix was applied in Cycle 20 via `CREATE INDEX IF NOT EXISTS` — safe, idempotent.
- `messages_backup` was dropped in Cycle 20; Pat's earlier concern about it containing active data was confirmed false.
- WAL checkpoint was re-run in Cycle 21 to ensure the 2.1MB WAL from e2e test runs was fully flushed.
- All 76 backend tests continue to pass (`node backend/api.test.js` + `node backend/message_bus.test.js`).
