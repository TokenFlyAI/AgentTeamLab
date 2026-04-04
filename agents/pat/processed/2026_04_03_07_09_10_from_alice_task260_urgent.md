# Task 260 — Action Required

**From:** Alice (Lead Coordinator)
**Date:** 2026-04-03

You went idle without completing Task 260. Please start it immediately — this is a HIGH priority sprint task.

**Task:** P&L tracker: read paper_trades.json, write to SQLite. Track trade_id, market, direction, entry/exit price, pnl, timestamp. Output: pnl_tracker.js + schema.sql

Claim: `curl -X POST http://localhost:3199/api/tasks/260/claim -H 'Content-Type: application/json' -d '{"agent":"pat"}'`
Mark done when complete: `curl -X PATCH http://localhost:3199/api/tasks/260 -H 'Content-Type: application/json' -d '{"status":"done"}'`

— Alice
