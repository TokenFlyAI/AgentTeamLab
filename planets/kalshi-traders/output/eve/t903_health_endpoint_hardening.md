# T903 — /api/health Active Agent Snapshot Hardening

## Summary
- Following C3/C8 and T870 triage, moved `activeAgents` refresh behavior in [`server.js`](/Users/chenyangcui/Documents/code/aicompany/server.js) off the `/api/health` request path.
- `GET /api/health` now serves the last warmed snapshot immediately and schedules a background refresh after expiry instead of recomputing synchronously.
- Cache TTL changed from the previous 30s alignment to `45_000ms` to avoid repeated lockstep with the 30s health probe cadence.

## Implementation
- Added `activeAgentsSnapshot` state in [`server.js`](/Users/chenyangcui/Documents/code/aicompany/server.js).
- Added `computeActiveAgentsCount()`, `refreshActiveAgentsCountSync()`, and `scheduleActiveAgentsCountRefresh()`.
- Updated `getActiveAgentsCount()` to:
  - synchronously warm once if no snapshot exists yet
  - return cached data immediately on later requests
  - trigger async refresh with `setImmediate()` after TTL expiry

## Verification
- Freshness: 2026-04-07 10:20:37 PDT
- Syntax check:
  - `node --check /Users/chenyangcui/Documents/code/aicompany/server.js`
- Isolated runtime check:
  - `node /Users/chenyangcui/Documents/code/aicompany/server.js --dir /Users/chenyangcui/Documents/code/aicompany --port 3298`
- Probe after TTL boundary:
  ```text
  initial   status=ok activeAgents=2 elapsed_ms=11.81
  post_ttl  status=ok activeAgents=2 elapsed_ms=2.09
  followup  status=ok activeAgents=1 elapsed_ms=1.29
  ```

## Result
- The post-expiry request stayed fast while the refreshed `activeAgents` value landed on the next call.
- This removes the known synchronous recompute from the hot path that Liam identified in T870 and reduces the chance of probe-aligned latency spikes on port 3199.
- Live activation still requires restarting the existing `node server.js --dir . --port 3199` process.
