# T870 — ALT-002 Triage

## Summary
- Impacted endpoint: `GET http://localhost:3199/api/health`
- Service: Agent Planet dashboard/task API (`/Users/chenyangcui/Documents/code/aicompany/server.js`)
- Current state: not actively reproducing in spot checks
- Incident type: intermittent latency spike, not sustained endpoint failure

## Evidence
- Shared alert artifact at `../../output/shared/reports/active_alerts.md` shows `ALT-002` active at `2026-04-07T17:05:41.627Z` with `p99 latency 575ms > 500ms threshold`.
- `../../public/reports/health_check_log.jsonl` confirms repeated slow `/api/health` samples during the same window:
  - `2026-04-07T17:05:41.627Z` → `575ms`
  - `2026-04-07T17:08:12.288Z` → `1233ms`
  - `2026-04-07T17:08:42.223Z` → `1167ms`
  - `2026-04-07T17:09:42.243Z` → `1185ms`
- Fresh reproduction check after triage:
  - `node output/frank/health_latency_probe.js --port 3199 --samples 40 --threshold 500`
  - Result: `p50=0ms`, `p95=1ms`, `p99=8ms`, `max=8ms`, `breaches=0`
- Control check on port `3200` stayed clean:
  - `node output/frank/health_latency_probe.js --port 3200 --samples 40 --threshold 500`
  - Result: `p99=9ms`, `breaches=0`

## Likely Cause
- `scripts/healthcheck.js` polls `/api/health` on port `3199`.
- The `3199` health endpoint calls `getActiveAgentsCount()`, which scans agent directories and heartbeat files synchronously on the request path.
- That scan is cached for `30_000ms`, which is the same interval used by `scripts/healthcheck.js`.
- Result: the health probe often lands exactly on cache expiry, so it repeatedly forces the expensive filesystem recompute instead of hitting a warm cache. Under concurrent file activity, that creates intermittent slow samples.

## Alert Logic Gap
- The header comment in `scripts/healthcheck.js` says `ALT-002` should mean `p99 latency > 500ms for 5 min`.
- The implementation does not enforce that duration. It fires as soon as the rolling 10-sample `p99` exceeds `500ms`, and it only clears after at least 3 later samples stay below threshold.
- This explains why `active_alerts.md` can stay red after the live endpoint has already returned to normal.

## Remediation
1. Move expensive filesystem work out of `/api/health` or precompute `activeAgents` off the hot path.
2. De-correlate cache expiry from probe cadence by making the cache TTL different from `30s` or by polling at a different interval.
3. Update `ALT-002` logic to match the documented rule:
   - require sustained breach across 5 minutes before firing
   - clear only after a defined healthy window
4. Add endpoint-level timing logs when `/api/health` exceeds `250ms` so the next incident shows whether the time was spent in agent scanning, JSON serialization, or event-loop stalls.

## Verification Commands
```bash
tail -n 40 public/reports/health_check_log.jsonl
node output/frank/health_latency_probe.js --port 3199 --samples 40 --threshold 500
node output/frank/health_latency_probe.js --port 3200 --samples 40 --threshold 500
curl -s http://localhost:3199/api/health | jq .
```
