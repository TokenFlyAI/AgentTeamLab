# Tokenfly SRE Plan — Monitoring & Alerting
**Author**: Liam (SRE)
**Task**: #19
**Date**: 2026-03-29
**Status**: FINAL

---

## 1. Service Inventory

| Service | Endpoint(s) | Owner | Criticality |
|---------|-------------|-------|-------------|
| Health API | GET /api/health | Bob / Dave | P0 |
| Agents API | GET /api/agents, GET /api/agents/:name | Bob / Dave | P0 |
| Tasks API | GET /api/tasks, POST /api/tasks, PATCH /api/tasks/:id, DELETE /api/tasks/:id | Bob / Dave | P1 |
| Messaging API | POST /api/messages/:agent | Bob / Dave | P1 |
| Dashboard UI | GET / | Charlie / Dave | P1 |
| Rate Limiter | Middleware (WRITE_ROUTES) | Bob | P0 |
| Agent Heartbeats | heartbeat.md file mtime | All agents | P1 |

---

## 2. SLO Definitions

### 2.1 SLO-001 — Server Availability
**Service**: Tokenfly API server (server.js)
**SLI**: Ratio of successful HTTP responses (2xx/3xx) to total non-rate-limited requests
**SLO Target**: 99.5% availability over a rolling 30-day window
**Error Budget**: 0.5% = ~3.6 hours downtime per 30 days

| SLO Window | Allowed downtime |
|------------|-----------------|
| 1 hour | 18 seconds |
| 24 hours | 7.2 minutes |
| 7 days | 50.4 minutes |
| 30 days | 3.6 hours |

### 2.2 SLO-002 — Health Endpoint Latency
**Service**: GET /api/health
**SLI**: p99 response time < 500ms; p50 < 100ms
**SLO Target**:
- p50 < 100ms over 5-minute rolling window
- p99 < 500ms over 5-minute rolling window
**Rationale**: Health checks are used by monitors; they must be fast. If /api/health itself is slow, the server is saturated.

### 2.3 SLO-003 — Agents List Latency
**Service**: GET /api/agents
**SLI**: p95 response time < 300ms
**SLO Target**: 95% of requests complete in < 300ms over 1-hour rolling window
**Rationale**: Reads all agent status.md and heartbeat files from disk — I/O bound. Alert threshold set at 300ms to catch disk saturation.

### 2.4 SLO-004 — Tasks API Latency
**Service**: GET /api/tasks, POST /api/tasks, PATCH /api/tasks/:id
**SLI**: p95 response time < 500ms for reads; < 1000ms for writes
**SLO Target**: 95% of read requests < 500ms; 95% of write requests < 1000ms
**Rationale**: task_board.md is parsed on every request (no cache). Writes incur a full serialize-and-write cycle.

### 2.5 SLO-005 — Agent Heartbeat Freshness
**Service**: Agent liveness (heartbeat.md mtime)
**SLI**: Fraction of registered agents with heartbeat.md mtime < 5 minutes ago
**SLO Target**: ≥ 50% of agents are "alive" during expected business hours
**Alert threshold**: < 25% alive = P1 alert; 0% alive = P0 alert (all agents down)
**Rationale**: The server defines "alive" as heartbeat updated within 5 minutes (backend/api.js line 73). If all heartbeats go stale simultaneously, it likely indicates a systemic issue (run_agent.sh failure, disk full, etc.).

### 2.6 SLO-006 — Rate Limiter Error Budget
**Service**: Write endpoint rate limiting (POST /api/tasks, POST /api/messages)
**SLI**: Ratio of 429 responses to total write requests
**SLO Target**: 429 rate < 5% over any 5-minute window under normal load
**Alert threshold**: > 10% 429s in a 5-minute window = spike alert
**Rationale**: The strictLimiter allows 20 write requests/min per IP. Sustained 429 spikes indicate a client bug, abuse, or need to tune the limit. Test suites can exhaust this budget — coordinate with Tina before load tests.

---

## 3. Alert Thresholds

| Alert ID | Condition | Severity | Response Time |
|----------|-----------|----------|---------------|
| ALT-001 | GET /api/health returns non-200 for > 30s | P0 — Critical | Immediate |
| ALT-002 | p99 latency of /api/health > 500ms for 5 min | P1 — High | 15 min |
| ALT-003 | p95 latency of /api/agents > 300ms for 10 min | P1 — High | 15 min |
| ALT-004 | p95 latency of /api/tasks > 500ms for 10 min | P2 — Medium | 1 hour |
| ALT-005 | 0 agents alive — dashboard DOWN (true outage) | P0 — Critical | Immediate |
| ALT-005 | 0 agents alive — dashboard UP (expected idle state) | P2 — Info | 1 hour |
| ALT-006 | < 25% agents alive for > 10 min | P1 — High | 15 min |
| ALT-007 | 429 rate > 10% on write endpoints for 5 min | P2 — Medium | 1 hour |
| ALT-008 | Server process not responding to /ping | P0 — Critical | Immediate |
| ALT-009 | Heap memory > 400MB for > 5 min | P1 — High | 15 min |
| ALT-010 | Error rate (5xx) > 1% over 5 min | P1 — High | 15 min |

---

## 4. Four Golden Signals — Monitoring Coverage

### 4.1 Latency
**What to measure**:
- Response time per endpoint (from request receipt to response end)
- Bucket into: p50, p95, p99

**Collection method**: Intercept requests in server.js middleware; record `Date.now()` on entry and exit. Store in an in-memory ring buffer (last 1000 requests per endpoint). Expose summary via `/api/metrics` (already partially implemented by Bob's `apiMetrics` module).

**Current state**: Bob's backend-api-module tracks `count`, `errors`, `total_duration_ms` per endpoint. Needs p95/p99 percentile calculation added.

### 4.2 Traffic
**What to measure**:
- Requests per minute (RPM) per endpoint
- Write vs read split
- Active SSE client count (from /api/health `sseClients` field)

**Collection method**: Already tracked in Bob's `apiMetrics`. The `/api/health` endpoint returns `sseClients` count.

**Dashboard**: Plot RPM per endpoint on the dashboard's metrics tab.

### 4.3 Errors
**What to measure**:
- HTTP 4xx rate (client errors, including 429)
- HTTP 5xx rate (server errors)
- Parsing failures in task_board.md reads

**Collection method**: Bob's `apiMetrics` tracks `errors` per endpoint. Extend to bucket by status code class (4xx vs 5xx).

### 4.4 Saturation
**What to measure**:
- Node.js heap usage (% of heap total)
- Active SSE client connections
- Rate limiter bucket utilization (requests remaining in window)
- File descriptor count (open heartbeat/status files)

**Collection method**: `/api/health` already returns `memory.heapUsed` and `memory.heapTotal`. Compute `heapUsed / heapTotal * 100` for heap utilization percentage.

---

## 5. Recommended Monitoring Stack

### Constraint: Zero external dependencies, pure Node.js

#### 5.1 In-Process Metrics (Layer 1 — already exists)
Bob's `backend-api-module.js` provides:
- `apiMetrics.getAll()` — per-endpoint request count, error count, total duration
- Already exposed at `/api/metrics` in server.js

**Action item**: Extend `apiMetrics` to track p95/p99 via an in-memory histogram (array of last N durations per endpoint, sorted on-demand). No new dependencies — pure JS.

#### 5.2 Synthetic Health Checks (Layer 2 — add)
A lightweight Node.js script (`scripts/healthcheck.js`) that:
1. Polls GET /api/health every 30 seconds
2. Checks response time and status code
3. Writes results to `public/reports/health_check_log.jsonl` (one JSON object per line)
4. Prints a warning to stderr if any threshold is breached

```javascript
// scripts/healthcheck.js (example — for implementation)
// Run with: node scripts/healthcheck.js
// Poll /api/health every 30s, log results, alert on threshold breach

const THRESHOLDS = {
  health_p99_ms: 500,
  alive_agents_min_pct: 0.25,
  heap_used_max_pct: 0.85,
};
```

#### 5.3 Agent Heartbeat Monitor (Layer 3 — add)
A script (`scripts/heartbeat_monitor.js`) that:
1. Reads all `agents/*/heartbeat.md` mtime values every 60 seconds
2. Counts alive vs stale agents
3. Emits alerts to `public/reports/heartbeat_status.json`
4. Triggers P0 alert if 0 agents are alive

#### 5.4 Dashboard Integration (Layer 4 — already exists)
- The main dashboard at `/` displays agent liveness from `/api/agents`
- Bob's `/api/metrics` endpoint feeds the metrics tab
- Add: a "System Health" panel showing SLO burn rate (green/yellow/red status per SLO)

#### 5.5 On-Call Alerting (Layer 5 — file-based)
Since we have no external alerting infrastructure:
- Alerts write to `public/reports/active_alerts.md` with severity and timestamp
- Agents subscribe by polling that file
- CEO can monitor it via the dashboard
- Future: wire to Slack/PagerDuty when external integrations are available

---

## 6. Health Check Definitions

### 6.1 /api/health (Synthetic)
```
Interval: 30 seconds
Timeout:  5 seconds
Success:  HTTP 200, body.status == "ok", response_time < 500ms
Failure:  Non-200, timeout, or body.status != "ok"
Action:   Write ALT-001 to active_alerts.md; notify Alice via chat_inbox
```

### 6.2 Agent Liveness (File-based)
```
Interval: 60 seconds
Check:    For each agent in agents/, stat heartbeat.md mtime
Alive:    mtime within last 5 minutes (matches server.js aliveThresholdMs = 300,000ms)
Alert:    If alive_count == 0 → ALT-005 (P0)
          If alive_count / total < 0.25 → ALT-006 (P1)
```

### 6.3 Rate Limiter Burn (Request-based)
```
Window:   5 minutes sliding
Check:    429_count / total_write_requests
Alert:    > 10% → ALT-007 (P2)
Source:   /api/metrics endpoint, filter by endpoint, check error_rate
```

### 6.4 Memory Saturation (In-process)
```
Interval: /api/health poll (30s)
Check:    body.memory.heapUsed / body.memory.heapTotal > 0.85
Alert:    ALT-009 (P1)
```

---

## 7. Incident Response Runbook

### RB-001 — Server Unreachable (ALT-001 / ALT-008)

**Symptoms**: GET /api/health returns non-200 or times out. Dashboard shows "OFFLINE".

**Step 1 — Verify**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/health
# Expected: 200. If timeout or non-200, proceed.
```

**Step 2 — Check process**
```bash
# Check if server.js is running
ps aux | grep "node server.js"
# If not found, the process crashed.
```

**Step 3 — Check port conflict**
```bash
lsof -i :3100
# If another process is on port 3100, kill it or use different port
```

**Step 4 — Check logs**
```bash
# If launched via run_agent.sh, check agent output file
# Look for stack traces or "EADDRINUSE" errors
ls -la agents/*/output/
```

**Step 5 — Restart**
```bash
node server.js --dir . --port 3100
```

**Step 6 — Verify recovery**
```bash
curl http://localhost:3100/api/health
```

**Escalate to**: Alice if server does not start within 5 minutes. Check with Eve (infra) for port conflicts.

---

### RB-002 — All Agents Stale (ALT-005)

**Symptoms**: GET /api/agents returns all `alive: false`. Dashboard shows all agents as offline.

**Severity tier** (heartbeat_monitor decides automatically):
- **P0-Critical**: Dashboard unreachable AND all heartbeats stale → true outage, escalate immediately
- **P2-Info**: Dashboard healthy AND all heartbeats stale → expected idle state (CEO hasn't triggered agents)

**Step 1 — Check severity**
```bash
# What severity did the monitor report?
grep "ALT-005" public/reports/active_alerts.md

# Independently verify dashboard liveness
curl -s http://localhost:3199/api/health | python3 -m json.tool
```

**Step 2a — P2-Info (dashboard up, agents idle)**
This is the normal state when no agent runs have been triggered. No action required unless the CEO expects agents to be running.

To start agents with actual work (token-conservative):
```bash
curl -X POST http://localhost:3199/api/agents/smart-start
# Only starts agents that have open tasks or unread inbox messages
```

To restart all agents:
```bash
bash run_all.sh
```

**Step 2b — P0-Critical (dashboard down)**

Verify dashboard process:
```bash
ps aux | grep "node server.js" | grep -v grep
curl -s http://localhost:3199/api/health || echo "DOWN"
```

If dashboard is down, restart it:
```bash
node server.js --dir . --port 3199 &
# or if using pm2:
pm2 restart dashboard
```

**Step 3 — Check if agents are running but not writing heartbeats**
```bash
# Are run_agent.sh loops alive?
ps aux | grep "run_agent" | grep -v grep | wc -l

# Are claude processes active?
ps aux | grep "claude" | grep -v grep | head -5

# Disk space check (full disk = no writes)
df -h .
```

**Step 3a — If bash loops running, claude not found**: Agents are in sleep between cycles. Wait up to 15 min for next cycle, or trigger smart-start.

**Step 3b — If no bash loops**: Agents fully stopped.
```bash
bash run_subset.sh alice bob charlie dave eve
# or all:
bash run_all.sh
```

**Step 3c — Bash loops running, claude running, still stale**: Agent stuck in long-running cycle. Check runtime logs:
```bash
tail -20 /tmp/aicompany_runtime_logs/alice.log
# Then use watchdog API to restart stale agents:
curl -X POST http://localhost:3199/api/agents/watchdog
```

**Step 4 — Verify recovery**: Wait up to 5 minutes, then check:
```bash
curl -s http://localhost:3199/api/agents | python3 -c "import sys,json; d=json.load(sys.stdin); print('alive:', sum(1 for a in d if a.get('alive')))"
```

**Escalate to**: Alice immediately for P0-Critical. P2-Info is informational only — no page required.

---

### RB-003 — 429 Rate Limit Spike (ALT-007)

**Symptoms**: > 10% of write requests returning 429. Clients reporting failures on POST /api/tasks or POST /api/messages.

**Context**: strictLimiter = 20 write requests/minute per IP (backend-api-module.js line 252).

**Step 1 — Identify source**
```bash
curl http://localhost:3100/api/metrics
# Look at endpoints with high error_rate for /api/tasks or /api/messages
```

**Step 2 — Check if test suite is running**
```bash
# E2e tests can exhaust the 20 req/min write limit
ps aux | grep playwright
```

**Step 3a — If caused by tests**: Coordinate with Tina/Frank. Tests should run against a different port or with rate limiting disabled in test mode.

**Step 3b — If caused by legitimate traffic**: Evaluate raising `maxRequests` in strictLimiter (currently 20/min). Requires Alice approval.

**Step 3c — If caused by abuse/bot**: Identify client IP and block at network level (coordinate with Eve/Quinn).

**Step 4 — Monitor**: Check `/api/metrics` again after 5 minutes to confirm rate drops.

**Escalate to**: Bob (backend) to tune rate limiter. Mia if API client behavior needs updating.

---

### RB-004 — High Latency (ALT-002 / ALT-003 / ALT-004)

**Symptoms**: Endpoints responding slowly. Users report dashboard lag.

**Step 1 — Identify the slow endpoint**
```bash
curl http://localhost:3100/api/metrics
# Find endpoint with high avg_duration_ms
```

**Step 2 — Check memory pressure**
```bash
curl http://localhost:3100/api/health | jq '.memory'
# If heapUsed/heapTotal > 0.85, memory pressure is causing GC pauses
```

**Step 3 — Check disk I/O**
```bash
# /api/agents reads N status.md files on every request
# High latency here = too many agents or slow disk
ls agents/ | wc -l  # Count agents
```

**Step 4 — Check SSE connection count**
```bash
curl http://localhost:3100/api/health | jq '.sseClients'
# Too many SSE clients can cause server congestion
```

**Step 5 — Mitigations**:
- Restart server to clear memory pressure (last resort — brief downtime)
- Reduce polling frequency on dashboard clients
- Add caching layer for /api/agents response (30s TTL) — file a task for Bob

**Escalate to**: Bob (backend) and Nick (performance) for sustained high latency.

---

## 8. Error Budget Policy

| SLO | Target | Current Status | Action if Budget Exhausted |
|-----|--------|----------------|--------------------------|
| SLO-001 Availability | 99.5% | Needs measurement | Freeze feature deployments; fix reliability first |
| SLO-002 Health Latency | p99 < 500ms | Needs measurement | Investigate memory/GC; add caching |
| SLO-003 Agents Latency | p95 < 300ms | Needs measurement | Cache agent list; reduce scan frequency |
| SLO-004 Tasks Latency | p95 < 500ms | Needs measurement | Cache task_board.md parse |
| SLO-005 Heartbeat Freshness | ≥ 50% alive | Needs measurement | P0 incident; restart agents |
| SLO-006 Rate Limit Budget | < 5% 429s | Needs measurement | Tune limits; identify abusive client |

**Policy**: If error budget for SLO-001 or SLO-005 is exhausted, all feature work stops and the team focuses on reliability until the SLO is met. Error budget resets on a rolling 30-day basis.

---

## 9. Toil Inventory & Automation Opportunities

| Toil | Current State | Automation Target |
|------|--------------|-------------------|
| Manual health checks | `curl /api/health` by hand | Automated by `scripts/healthcheck.js` (30s poll) |
| Checking agent liveness | Reading heartbeat mtimes manually | `scripts/heartbeat_monitor.js` (60s poll) |
| Identifying stale processes | `bash status.sh` by hand | Integrate into heartbeat monitor |
| Rate limit monitoring | Check /api/metrics manually | Dashboard alert panel (red/yellow/green) |
| Port conflict detection | Manual `lsof` | Pre-flight check in `run_agent.sh` before startup |

---

## 10. Open Reliability Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| QI-003: GET /api/agents/:name exposes inbox metadata (partially fixed) | High | Task #43 assigned to Bob — verify fix closes the exposure |
| task_board.md parsed on every request (no cache) | Medium | Add 30s TTL in-memory cache in server.js — file task for Bob |
| No persistence layer — all state in .md files | High | Pat is formalizing schema (Task #21) — align SLO definitions with schema work |
| SSE clients have no timeout — connections leak | Medium | Add a max-connection-age limit or heartbeat ping on SSE stream |
| No authentication on any /api endpoint | Critical | Heidi's security audit (Task #17) will surface this — needs auth layer |
| server.js process crash = total outage (no supervisor) | High | Add process supervisor (e.g., `node --watch` or pm2) |
| Rate limiter state is in-memory — lost on restart | Medium | Expected behavior. Document in runbook. |

---

## 11. Next Steps

| Priority | Action | Owner | Due |
|----------|--------|-------|-----|
| P0 | Verify Task #43 (QI-003 fix) is deployed and tested | Bob + Heidi | ASAP |
| P1 | Implement `scripts/healthcheck.js` (30s synthetic checks) | Liam | Next cycle |
| P1 | Implement `scripts/heartbeat_monitor.js` | Liam | Next cycle |
| P1 | Add p95/p99 histogram to apiMetrics | Bob | Next cycle |
| P2 | Add "System Health" panel to dashboard (SLO burn rate) | Charlie | Next cycle |
| P2 | Add 30s TTL cache for /api/agents list | Bob | Next cycle |
| P2 | Add SSE connection timeout/keepalive | Dave | Next cycle |
| P3 | Process supervisor for server.js (pm2 or systemd equivalent) | Eve / Quinn | Following cycle |

---

## Appendix A — Key Configuration Reference

| Parameter | Value | Location |
|-----------|-------|----------|
| Agent alive threshold | 5 minutes (300,000ms) | backend/api.js:73 |
| General rate limit | 120 req/min | backend-api-module.js:251 |
| Write rate limit | 20 req/min | backend-api-module.js:252 |
| Write routes (rate limited) | POST /api/tasks, POST /api/messages | backend-api-module.js:256-259 |
| Server default port | 3100 | server.js / CLAUDE.md |
| Metrics endpoint | GET /api/metrics | server.js |
| Health endpoint | GET /api/health | server.js |

---

*Liam — SRE | Tokenfly Agent Team Lab | 2026-03-29*

---

## 12. SNS Topics & AWS CloudWatch Integration

**Purpose**: This section provides SNS topic definitions for Quinn's Terraform IaC stack. CloudWatch alarm `alarm_actions` fields should reference these ARNs.

### 12.1 Recommended SNS Topic Structure

| Topic Name | ARN Pattern | Severity | Use Case |
|------------|------------|----------|----------|
| `tokenfly-p0-critical` | `arn:aws:sns:{region}:{account}:tokenfly-p0-critical` | P0 | Server down, 0% agents alive, complete outage |
| `tokenfly-p1-alert` | `arn:aws:sns:{region}:{account}:tokenfly-p1-alert` | P1 | Latency SLO breach, >50% agents stale, rate limit spike |
| `tokenfly-p2-warning` | `arn:aws:sns:{region}:{account}:tokenfly-p2-warning` | P2 | Heap saturation, partial agent stale, API error rate |
| `tokenfly-rds-ops` | `arn:aws:sns:{region}:{account}:tokenfly-rds-ops` | Ops | RDS-specific: CPU, storage, connection count, replication lag |
| `tokenfly-infra-ops` | `arn:aws:sns:{region}:{account}:tokenfly-infra-ops` | Ops | ECS task failures, ALB 5xx, EFS throughput |

### 12.2 Topic Subscription Recommendations

| Topic | Recommended Subscribers |
|-------|------------------------|
| `tokenfly-p0-critical` | PagerDuty / on-call phone, Slack `#incidents` |
| `tokenfly-p1-alert` | Slack `#alerts`, email on-call DL |
| `tokenfly-p2-warning` | Slack `#alerts` (low-priority), email team DL |
| `tokenfly-rds-ops` | Slack `#ops`, DBAs/Quinn |
| `tokenfly-infra-ops` | Slack `#ops`, Eve/Quinn |

### 12.3 CloudWatch Alarm → SNS Topic Mapping

This maps each alert threshold (Section 3) to its SNS `alarm_actions`:

| Alert ID | Alert Name | alarm_actions SNS Topic | ok_actions SNS Topic |
|----------|-----------|------------------------|---------------------|
| ALT-001 | Server Unreachable | `tokenfly-p0-critical` | `tokenfly-p1-alert` |
| ALT-002 | /api/health p95 > 500ms | `tokenfly-p1-alert` | — |
| ALT-003 | /api/agents p95 > 1s | `tokenfly-p1-alert` | — |
| ALT-004 | /api/tasks p95 > 800ms | `tokenfly-p2-warning` | — |
| ALT-005 | 0% agents alive | `tokenfly-p0-critical` | `tokenfly-p1-alert` |
| ALT-006 | <25% agents alive | `tokenfly-p1-alert` | — |
| ALT-007 | 429s >5% of write requests | `tokenfly-p1-alert` | — |
| ALT-008 | /api/health returns non-200 | `tokenfly-p1-alert` | — |
| ALT-009 | Heap utilization >85% | `tokenfly-p2-warning` | — |
| ALT-010 | Error rate >1% | `tokenfly-p2-warning` | — |
| RDS-001 | RDS CPU >80% | `tokenfly-rds-ops` | — |
| RDS-002 | RDS FreeStorageSpace <10GB | `tokenfly-rds-ops` | — |
| RDS-003 | RDS DatabaseConnections >100 | `tokenfly-rds-ops` | — |

### 12.4 Terraform Resource Reference (for Quinn)

```hcl
# SNS Topics — reference these ARNs in your CloudWatch alarm_actions
resource "aws_sns_topic" "p0_critical" {
  name = "tokenfly-p0-critical"
}

resource "aws_sns_topic" "p1_alert" {
  name = "tokenfly-p1-alert"
}

resource "aws_sns_topic" "p2_warning" {
  name = "tokenfly-p2-warning"
}

resource "aws_sns_topic" "rds_ops" {
  name = "tokenfly-rds-ops"
}

resource "aws_sns_topic" "infra_ops" {
  name = "tokenfly-infra-ops"
}

# Example: RDS CPU alarm using above topics
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "tokenfly-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80

  alarm_actions = [aws_sns_topic.rds_ops.arn]
  ok_actions    = [aws_sns_topic.rds_ops.arn]
}

# Example: ECS service down (0 running tasks) → P0
resource "aws_cloudwatch_metric_alarm" "ecs_no_tasks" {
  alarm_name          = "tokenfly-ecs-no-tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1

  alarm_actions = [aws_sns_topic.p0_critical.arn]
  ok_actions    = [aws_sns_topic.p1_alert.arn]
}
```

### 12.5 Health Check Endpoints for CloudWatch Synthetics / ALB Target Health

| Check | URL | Method | Expected | Interval |
|-------|-----|--------|----------|----------|
| Server alive | `GET /api/health` | GET | 200, body has `uptime_ms` | 30s |
| Agents API live | `GET /api/agents` | GET | 200, body is JSON array | 60s |
| Tasks API live | `GET /api/tasks` | GET | 200, body is JSON array | 60s |
| Dashboard UI | `GET /` | GET | 200, content-type: text/html | 60s |

**ALB Target Health**: Configure ALB health check to `GET /api/health` with:
- `healthy_threshold = 2`
- `unhealthy_threshold = 3`
- `interval = 30`
- `timeout = 10`
- `matcher = "200"`

---

*Section added 2026-03-30 — SNS topics requested by Alice for Quinn's Terraform IaC stack*
