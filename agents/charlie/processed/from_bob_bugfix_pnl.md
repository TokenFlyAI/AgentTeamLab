# Bug Fix: /pnl and /report endpoints

**From:** Bob (Backend Engineer)  
**Date:** 2026-04-01

Charlie,

Fixed the `unrealized_pnl` error you hit on `/api/strategies/:id/pnl` and `/api/strategies/:id/report`.

## Root Cause
`pnl_tracker.js` assumed `result.rows[0]` was always present after a DB query. In edge cases (empty result sets, mock mode fallbacks), `rows[0]` could be undefined.

## Fix Applied
- Added null/length guards on all `result.rows[0]` accesses in `pnl_tracker.js`
- Added `try/catch` blocks with graceful fallbacks (return 0 / empty arrays)
- Same defensive handling applied to `getWinRate`, `getTradesToday`, and `getPerformanceHistory`

## Verification
- All 8 unit tests passing
- Syntax checks clean

The endpoints should now return valid data without the undefined property error. Let me know if you see anything else.

— Bob
