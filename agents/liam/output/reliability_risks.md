# Tokenfly Reliability Risks — Tracking & Runbooks
**Author**: Liam (SRE)
**Date**: 2026-03-30
**Status**: Active

---

## Summary

| Risk ID | Title | Severity | Owner | Status |
|---------|-------|----------|-------|--------|
| RR-001 | No auth on /api endpoints (core) | P1-High | Quinn (Task #103) | Resolved 2026-03-30 |
| RR-001b | No auth on /api/metrics/* endpoints (SEC-010) | P2-Medium | Eve (Task #121) | Open |
| RR-002 | task_board.md parsed on every request (no cache) | P2-Medium | Bob | Open |
| RR-003 | SSE clients have no timeout — connections leak | P1-High | Liam | Resolved 2026-03-30 |
| RR-004 | server.js crash = total outage (no process supervisor) | P0-Critical | Eve | Resolved 2026-03-30 |
| RR-005 | ALT-009 heap alert false positive | Resolved | Liam | Resolved 2026-03-30 |
| RR-006 | Rate limiter bleeds across test runs — e2e flakiness | P2-Medium | Charlie (Task #119) | Open |

---

## RR-001: No Authentication on /api Endpoints

**Severity**: P1-High
**Impact**: Any process on the network can read agent status, task board, and modify tasks.
**Discovery**: Liam SRE review during Task #19.
**Owner**: Heidi (Security Audit — Task #17)

### Risk Description
All `/api/*` endpoints are unauthenticated. Any client that can reach the server can:
- Read all agent status and heartbeats (`GET /api/agents`)
- Create, modify, or delete tasks (`POST/PATCH/DELETE /api/tasks`)
- Broadcast messages to all agents (`POST /api/broadcast`)
- Switch operating mode (`POST /api/mode`)

### Runbook: RR-001 Mitigation
1. **Short-term**: Add `X-API-Key` header check to all write endpoints (POST/PATCH/DELETE)
2. **Medium-term**: JWT-based auth with per-agent service tokens
3. **Verification**: `curl -X POST http://localhost:3199/api/tasks -d '{"title":"test"}'` — should return 401

### Status
**RESOLVED 2026-03-30** — Quinn's Task #103 (SEC-001) shipped: `isAuthorized()` middleware added to server.js. Auth via `Authorization: Bearer <key>` or `X-API-Key` header; `API_KEY` env var configures the key. Tina's Task #109 (e2e auth test updates) is in progress.

**Remaining gap**: `/api/metrics/*` endpoints (agent_metrics_api.js) are not yet covered — tracked as RR-001b, Eve's Task #121.

---

## RR-002: task_board.md Parsed on Every Request

**Severity**: P2-Medium
**Impact**: Each `GET /api/tasks` reads and parses task_board.md from disk. Under load (Nick's load test, Task #48), this becomes a bottleneck and increases p99 latency.
**Owner**: Bob (Backend)

### Risk Description
`server.js` reads `public/task_board.md` synchronously on every `/api/tasks` request. With 20 agents hitting the API and e2e tests running, this adds unnecessary I/O.

### Runbook: RR-002 Mitigation
1. Add in-memory cache with 5-second TTL for task board data
2. Invalidate cache on any POST/PATCH/DELETE to `/api/tasks`
3. Use `fs.watch()` on task_board.md to invalidate on file changes

### Verification
Run `ab -n 1000 -c 10 http://localhost:3199/api/tasks` before and after caching. Expect p99 to drop by >50%.

### Status
File task for Bob. Liam to measure baseline latency from health_check_log.jsonl as SLO input.

---

## RR-003: SSE Clients Have No Timeout — Connection Leak

**Severity**: P1-High
**Impact**: Server-Sent Events (SSE) connections for dashboard live updates never time out. Long-running dashboard sessions accumulate `sseClients` without bound. Over time this causes memory growth and fd exhaustion.
**Owner**: Bob/Dave

### Risk Description
The `/api/events` (SSE) endpoint holds connections open indefinitely. If a dashboard browser tab is closed without a clean disconnect, the server never knows. Under the current implementation:
- `sseClients` count grows over time
- Each idle SSE connection holds a file descriptor
- On server restart, all clients reconnect simultaneously (thundering herd)

### Runbook: RR-003 Mitigation
1. Add server-side SSE keepalive (`:ping\n\n` every 30s) — client reconnects if missed
2. Add 10-minute server-side connection timeout: close and let client reconnect
3. Track peak `sseClients` in health log — alert if > 50

### Runbook: RR-003 Incident Response (if fd exhaustion occurs)
```
# Check fd count
lsof -p $(pgrep -f server.js) | wc -l

# Graceful restart (loses in-flight SSE, dashboard reconnects)
kill -SIGUSR2 $(pgrep -f server.js)   # if supervisor supports it
# or
bash stop_agent.sh && node server.js --dir . --port 3199
```

### Status
**RESOLVED 2026-03-30** — Liam applied fix in server.js:
- `/api/events` endpoint: 15s keepalive ping; cleans up dead client on write error
- Broadcast loop: removes dead clients on write failure (was: silent ignore)
Monitor `sseClients` field in health_check_log.jsonl to confirm stability.

---

## RR-004: No Process Supervisor — server.js Crash = Total Outage

**Severity**: P0-Critical
**Impact**: If server.js throws an uncaught exception or OOM, all agent coordination stops. No automatic recovery.
**Owner**: Eve (Infra) / Quinn (Cloud)

### Risk Description
`server.js` runs as a plain `node` process. If it crashes:
- All agent API calls fail
- Dashboard goes dark
- Agents cannot claim tasks, update status, or receive messages
- No automatic restart

### Runbook: RR-004 Mitigation (Local Dev)
Use `pm2` or a simple shell supervisor:
```bash
# Option A: pm2
npm install -g pm2
pm2 start server.js --name tokenfly-api -- --dir . --port 3199
pm2 save
pm2 startup  # persist across reboots

# Option B: simple restart loop (for dev)
while true; do
  node server.js --dir . --port 3199
  echo "[supervisor] server crashed, restarting in 3s..."
  sleep 3
done
```

### Runbook: RR-004 Production Mitigation
Quinn's ECS deployment (Task #19 IaC) provides container restart on failure. On ECS:
- Task definition `restartPolicy: ALWAYS`
- ALB health check removes unhealthy instance from rotation
- Min healthy = 1 task ensures zero-downtime deploys

### Runbook: RR-004 Incident Response (if server crashes locally)
```bash
# Verify it's down
curl -f http://localhost:3199/api/health || echo "DOWN"

# Restart
node server.js --dir . --port 3199 &

# Verify recovery
curl http://localhost:3199/api/health
# Check agents reconnect within 60s by watching heartbeat timestamps
```

### Status
**RESOLVED 2026-03-30** — Eve's Task #84 delivered `ecosystem.config.js` with pm2 config for all three processes (dashboard, healthcheck, heartbeat-monitor). Max memory restart at 450MB, max 10 restarts, 2s cooldown. Quinn's ECS deployment handles production restart policy.

---

## RR-005: ALT-009 Heap Alert False Positive (RESOLVED)

**Severity**: Resolved
**Resolution Date**: 2026-03-30

### What Happened
ALT-009 (`heapUsed/heapTotal > 85%`) was firing constantly because V8 starts with a tiny initial heap (~8MB) and grows it dynamically. The ratio was 93% even though the absolute heap usage was only 7MB — far below any real saturation level.

### Fix Applied
`scripts/healthcheck.js` updated with two guards:
1. **Minimum heap size gate**: Only evaluate ratio if `heapTotal >= 50MB`. Filters out small-heap false positives.
2. **Sustained breach requirement**: Alert only fires after `heap_sustained_count = 3` consecutive checks above threshold. Filters transient GC spikes.

### Verification
```bash
# Run healthcheck in one-shot mode — should show 0 ALT-009 alerts
node scripts/healthcheck.js --once --port 3199
```

---

---

## RR-006: Rate Limiter Bleeds Across Test Runs — E2E Flakiness

**Severity**: P2-Medium
**Impact**: 6 e2e tests fail with HTTP 429 when a dev server is already running. Test suite is non-deterministic depending on server state.
**Owner**: Charlie (Task #119)
**Discovery**: Frank QA finding — `playwright.config.js` uses `reuseExistingServer: true`.

### Risk Description
The rate limiter (`strictLimiter`: 20 req/min write) is in-process state. When Playwright reuses an already-running server instead of starting a fresh one, the write bucket from a previous test run is still partially consumed. 4 tests in `api.spec.js` and 2 in `metrics.spec.js` fail with 429 on write endpoints.

Root cause: `RATE_LIMIT_WRITE_MAX=500` env var only applies when Playwright starts the server fresh (via `webServer.command`). When reusing an existing server, the env var is ignored.

### Runbook: RR-006 Short-Term Fix (for devs running tests locally)
```bash
# Option A: Set env var before starting server manually
RATE_LIMIT_WRITE_MAX=500 node server.js --dir . --port 3199

# Option B: Stop any existing server before test run
pkill -f "node server.js" && npx playwright test

# Option C: Force playwright to always start fresh (change config)
# In playwright.config.js: reuseExistingServer: false
```

### Runbook: RR-006 Proper Fix (Task #119)
Add `GET /api/rate-limiter/reset` endpoint guarded by `NODE_ENV !== 'production'`.
Playwright `globalSetup` calls this endpoint before each test run to drain buckets.

### Verification
After fix: run full suite twice back-to-back with existing server — zero 429s both times.

### Status
Open — Charlie assigned (Task #119).

---

## Recommended Follow-up Tasks

| Task | Priority | Assign To | Status |
|------|----------|-----------|--------|
| Add auth middleware to write endpoints | P1 | Quinn (Task #103) | In Progress |
| Cache task_board.md reads (5s TTL) | P2 | Bob | Open |
| Add SSE connection timeout (10 min) | P1 | Liam | Done |
| Add local process supervisor (pm2) | P0 | Eve (Task #84) | Done |
| Alert if sseClients > 50 | P2 | Liam | Open (enhancement) |
| Rate limiter reset endpoint for tests | P2 | Charlie (Task #119) | Open |
| Fix ALT-005 false positive (agents idle vs system down) | P2 | Liam | Done (cycle 6) |

---

## RR-007 — ALT-005 False Positive: "System Down" When Agents Idle

### Observed Behavior
ALT-005 fired P0-Critical "system may be down" whenever all agent heartbeats were stale — including the expected case of agents being intentionally stopped between work cycles. This caused alert fatigue and unnecessary P0 noise.

### Root Cause
`heartbeat_monitor.js` fired ALT-005 as P0 solely based on agent liveness without checking whether the dashboard/API itself was reachable. Agent idle state ≠ system outage.

### Fix Applied (2026-03-30 Cycle 6)
Added HTTP liveness check to `http://localhost:3199/api/health` before escalating ALT-005:
- **Dashboard up + agents idle** → P2-Info "All agents idle — dashboard healthy"
- **Dashboard unreachable + agents stale** → P0-Critical (true outage)

Severity transitions handled idempotently — no re-notification to Alice on repeated idle cycles.

### Status
RESOLVED — heartbeat_monitor.js updated and restarted (PID 75247).
