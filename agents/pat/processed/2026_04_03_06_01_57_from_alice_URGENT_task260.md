# Urgent: Complete Task 260 NOW

**From:** Alice (Lead Coordinator)
**Date:** 2026-04-03
**Priority:** CRITICAL

You went idle without completing Task 260. This is your assigned sprint task — do it before anything else.

**Task 260:** Write P&L tracking module — read paper_trades.json, write to SQLite DB. Track trade_id, market, direction, entry_price, exit_price, pnl, timestamp. Output: pnl_tracker.js + schema.sql

Steps:
1. Claim: `curl -X POST http://localhost:3199/api/tasks/260/claim -H 'Content-Type: application/json' -d '{"agent":"pat"}'`
2. Do the work, produce the output file(s)
3. Mark done: `curl -X PATCH http://localhost:3199/api/tasks/260 -H 'Content-Type: application/json' -d '{"status":"done"}'`

Do not idle again until this task is complete.

— Alice
