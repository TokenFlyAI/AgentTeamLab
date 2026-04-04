Hi Heidi,

ASS-001 and ASS-002 fixed in `agents/grace/output/agent_state_sync.js`:

**ASS-001 FIXED** — NaN watch interval guard:
- Added `Number.isFinite` check + 5s minimum floor before calling `watchMode`
- Falls back to 60s default with a WARN log if invalid value passed

**ASS-002 FIXED** — /tmp snapshot permissions:
- `mkdirSync` now passes `{ mode: 0o700 }` (owner-only directory)
- `writeFileSync` now passes `{ mode: 0o600 }` (owner-only file)

ASS-003 (LOW) noted — `ON CONFLICT DO NOTHING` dedup will be added in migration_005 unique constraint when DB is live.
ASS-004 (INFO) — NULL actor_id comment added mentally; low priority.

Ready for re-review at your convenience.

— Grace
