# E2E Test Suite — Status & Resumption Guide

Last updated: **2026-04-01**  
Status: **561 passed / 17 skipped / 0 failed**

---

## Quick Resume

```bash
# Ensure server is running first
node server.js --dir . --port 3199 &

# Run all tests
npx playwright test

# Run only coverage tests (fastest feedback loop)
npx playwright test e2e/coverage.spec.js

# Single test grep
npx playwright test --grep "GET /api/agents/:name/health"
```

---

## Test File Inventory

| File | Tests | Purpose |
|------|-------|---------|
| `api.spec.js` | 49 | Core CRUD: tasks, agents, broadcast, mode |
| `dashboard.spec.js` | 44 | Browser UI: tab nav, modal, keyboard shortcuts |
| `metrics.spec.js` | 59 | Metrics: /api/metrics, /api/stats, /api/cost |
| `coverage.spec.js` | 354 | Full API surface: status codes + response shapes |
| `smart_run.spec.js` | 7 | Smart Run button state, fleet panel UI |
| `message_bus.spec.js` | 47 | SQLite message bus: send/receive/ack/pagination |

---

## coverage.spec.js — Endpoint Map

Every major endpoint in server.js is covered. Structure per endpoint:
1. Status codes (200, 400, 404, 401)  
2. Response shape: each field asserted by type + nullability

### Covered endpoints (354 tests)

**Agents**
- `GET /api/agents` — list + shape (name/role/status/cycles/current_task/etc)
- `GET /api/agents/:name` — detail + heartbeat shape (null-safe status/timestamp/task)
- `GET /api/agents/:name/ping` — running, inCycle, pids
- `GET /api/agents/:name/health` — score, grade, dimensions
- `GET /api/agents/:name/status` — name, content
- `GET /api/agents/:name/persona` — name, content
- `GET /api/agents/:name/todo` — name, content
- `GET /api/agents/:name/activity` — cycles array with start/cost/turns/duration/cycle/lines
- `GET /api/agents/:name/inbox` — unread/processed arrays
- `GET /api/agents/:name/cycles` — cycle list with n/start/cost/turns/duration_s
- `GET /api/agents/:name/cycles/:n` — name/cycle/content
- `GET /api/agents/:name/log` — array of {type, content, timestamp}
- `GET /api/agents/:name/lastcontext` — name, content
- `GET /api/agents/:name/context` — mode/sop/culture/inbox/tasks/team_channel/announcements/teammates
- `GET /api/agents/:name/output` — agent, files[]
- `GET /api/agents/:name/output/:file` — agent/file/content/type
- `POST /api/agents/:name/inbox` — filename, ok
- `POST /api/agents/:name/message` — ok, filename
- `POST /api/agents/:name/persona/note` — ok, timestamp, note
- `PATCH /api/agents/:name/persona` — ok
- `POST /api/agents/:name/stop` — ok
- `POST /api/agents/:name/start` — ok/error
- `POST /api/agents/stop-all` — ok, stopped
- `POST /api/agents/start-all` — ok, started
- `POST /api/agents/watchdog` — ok, restarted[], checked, details[]
- `GET /api/agents/:name/executor` — name, executor
- `POST /api/agents/:name/executor` — ok, executor

**Tasks**
- `GET /api/tasks` — array with id/title/priority/assignee/status/description/group/task_type/created/updated/notes/notesList
- `POST /api/tasks` — 201, ok, id, task_type, group
- `PATCH /api/tasks/:id` — ok, id, title, status, priority, assignee
- `PATCH /api/tasks/:id` (notes) — notesList appended
- `PATCH /api/tasks/:id` (assignee) — assignee updated
- `DELETE /api/tasks/:id` — ok, deleted {id, title, status}
- `POST /api/tasks/:id/claim` — ok, id, status, assignee; 409 for race
- `GET/POST /api/tasks/:id/result` — ok, task_id, file, source, content
- `GET /api/tasks/archive` — array with id/title/status/priority/assignee
- `POST /api/tasks/archive` — ok, archived count
- `GET /api/tasks/export.csv` — content-type: text/csv, CSV headers, content-disposition

**Metrics**
- `GET /api/metrics` — timestamp/tasks/agents/cost_7d/http; deep sub-fields
- `GET /api/metrics/agents` — list with all shape fields
- `GET /api/metrics/agents/:name` — per-agent detail + last_heartbeat
- `GET /api/metrics/tasks` — total/by_priority/by_status/tasks
- `GET /api/metrics/cost` — today_usd/total_7d_usd/per_agent[]
- `GET /api/health` — status/uptime_ms/memory{rss/heapUsed/heapTotal}/activeAgents/sseClients/uptime
- `GET /api/stats` — totals.totalCost/totalCycles
- `GET /api/cost` — today_usd/today_cycles/total_7d_usd/total_7d_cycles/per_agent[]
- `GET /api/watchdog-log` — log[] with ts/name/action/heartbeat_age_ms
- `GET /api/dashboard` — agents[]/tasks/mode; agent shape includes nullable fields

**Config / Smart Run**
- `GET /api/config` — companyName/directory
- `GET /api/executors` — list
- `GET /api/config/executor` — default executor
- `GET /api/smart-run/config` — config{max_agents/enabled/interval_seconds/dry_run/mode/force_alice/cycle_sleep_seconds/last_updated} + daemon{running/pid}
- `POST /api/smart-run/config` — updates each field + validation (400 for out-of-range)
- `GET /api/smart-run/status` — daemon/agents{running/count/target}/config
- `POST /api/smart-run/start` — ok/pid/message; with enabled guard
- `POST /api/smart-run/stop` — ok/message/output

**Comms / Content**
- `GET/POST /api/team-channel` — filename/content/message/from/date/timestamp
- `GET/POST /api/announcements` — title/body/filename/from/timestamp
- `POST /api/announce` — alias test
- `POST /api/broadcast` — ok/agents/failed/filename
- `GET /api/ceo-inbox` — unread[]/processed[] with filename/from/timestamp/content
- `POST /api/ceo-inbox/:filename/read` — ok, moves to processed/
- `POST /api/ceo/command` — task_created/dm_sent/mode_switched/fallback; validation

**Research / Knowledge / Org**
- `GET /api/sops` — name/filename/content
- `GET /api/ops` — string array of script names
- `GET /api/org` — name/role/reports_to/children
- `GET /api/research` — file/type/dir
- `GET /api/research/:file` — file/dir/content; path traversal blocked
- `GET /api/knowledge` — list
- `GET /api/knowledge/:file` — path traversal blocked
- `GET /api/code-output` — agent/files[]
- `GET /api/digest` — title/content/generated_at/agents

**SQLite Message Bus**
- `POST /api/messages` — id/from/to/priority (201)
- `GET /api/inbox/:agent` — unread/messages[] with id/from_agent/to_agent/body/priority/created_at
- `POST /api/inbox/:agent/:id/ack` — acked:true
- `GET /api/messages/queue-depth` — total_unread/by_agent[] with agent/unread
- `POST /api/messages/broadcast` — ok/sent/failed
- `DELETE /api/messages/:id` — ok/deleted id
- `DELETE /api/messages/purge?from=` — ok/deleted count

**Consensus**
- `GET /api/consensus` — id/type/content/author/section/timestamp
- `POST /api/consensus/entry` — id; pipe sanitization
- `DELETE /api/consensus/entry/:id` — ok/deleted id; 404 for unknown

**Security**
- `SEC-001`: Auth 401 on all protected routes without/with wrong key
- `SEC-005`: Error responses don't leak paths/stacks/filenames
- Path traversal blocked on all file-serving endpoints
- `OPTIONS /api/*`: 204 + access-control headers

**Misc**
- `GET /api/mode` — mode/raw; valid mode values
- `POST /api/mode` — ok/output; validation
- `GET /api/search` — query/results/total; result shape: type/agent/file/matches[]
- `GET /api/events` (SSE) — text/event-stream, sends event: connected
- `GET /api/agents/:name/log/stream` (SSE) — text/event-stream
- `GET /manifest.json` — name/short_name/icons/start_url/theme_color/description/background_color/theme_color; icon type field

**Additional coverage added 2026-04-01 (session 2):**
- `POST /api/agents/smart-start` — `decision` object field + 403 when disabled
- `POST /api/tasks` — full create response: description/status/created/updated/assignee/task_type/group
- `PATCH /api/tasks/:id` — full response: description/group/task_type/created/updated/notes/notesList
- `GET /api/agents/:name` — tasks items shape: id/title/priority/status/assignee
- `GET /api/agents` — alive/unread_messages/executor already tested; health object already tested
- `GET /api/metrics/tasks` — tasks items description/created/updated fields
- `GET /api/agents/:name/context` — tasks items full shape: task_type/description/group/assignee/created/updated
- `GET /api/digest` — cycle tasks items are strings
- `GET /manifest.json` — description/background_color/theme_color; icon type field

---

## Known Issues / Future Work

1. **Ack response shape**: `/api/inbox/:agent/:id/ack` only tested for `acked:true` — could add `id` field assertion
2. **Search matches**: Currently only tested as `Array.isArray(r.matches)` + string elements — could test more search types
3. **WebSocket**: `/api/ws` only tested for auth rejection (401 without key); no functional WS message flow tests (requires WS client)

---

## Test Infrastructure

```javascript
// Helpers in coverage.spec.js (top of file):
async function apiGet(path) → { status, body }
async function apiPost(path, body) → { status, body }
async function apiPatch(path, body) → { status, body }
async function apiDelete(path) → { status, body }

// Cleanup patterns:
// File-based: push to _createdXFiles[], delete in afterAll via fs.unlinkSync
// DB-based: DELETE /api/messages/purge?from=e2e-* in afterAll
// Persona: snapshot+restore in beforeAll/afterAll
// smart_run config: snapshot in beforeAll, restore in afterAll
```

---

## How to Add a New Test

1. Find the endpoint section (alphabetical by endpoint)
2. Check actual response: `curl -s -H "Authorization: Bearer test" http://localhost:3199/api/...`
3. Add `test.describe("VERB /api/endpoint", () => { ... })` at end of file
4. Assert: status code, each response field type, null-safety for nullable fields
5. Add afterAll cleanup if test creates data
6. Run: `npx playwright test e2e/coverage.spec.js --grep "your test name"`
