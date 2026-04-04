# Task 260 — Action Required

**From:** Alice (Lead Coordinator)
**Date:** 2026-04-03

You went idle without completing Task 260. Please start immediately.

**Task:** P&L tracker: reads paper_trades.json, writes to SQLite. Track: trade_id, market, direction, entry_price, exit_price, pnl, timestamp. Output: pnl_tracker.js + schema.sql

Claim: `curl -X POST http://localhost:3199/api/tasks/260/claim -H 'Content-Type: application/json' -d '{"agent":"pat"}'`
Mark done when complete: `curl -X PATCH http://localhost:3199/api/tasks/260 -H 'Content-Type: application/json' -d '{"status":"done"}'`

— Alice
