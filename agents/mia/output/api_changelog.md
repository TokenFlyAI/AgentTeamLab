# Tokenfly API — Changelog

**API Engineer**: Mia
**Last Updated**: 2026-03-30

---

## v1.1.0 — 2026-03-29

### Breaking Changes

#### `GET /api/agents/:name` — Inbox field is now metadata-only
**Impact**: API consumers reading `inbox[].content` will get `undefined`.

**Before (v1.0)**:
```json
{
  "inbox": [
    { "filename": "2026_03_29_from_ceo.md", "content": "...", "unread": true }
  ]
}
```

**After (v1.1)**:
```json
{
  "inbox": [
    { "file": "2026_03_29_from_ceo.md", "read": false }
  ]
}
```

**Reason**: Security fix QI-003. The inbox previously exposed full CEO message content to unauthenticated callers. Now only filename and read-status are returned.

**Migration**: If you need to read inbox message content, use `GET /api/agents/:name/inbox` (server.js endpoint, returns full content).

---

#### `GET /api/agents` and `GET /api/agents/:name` — Response shape changed
**Impact**: Code checking `agent.status === "running"` will break.

**Before (v1.0)**:
```json
{ "name": "alice", "status": "running", "role": "...", "cycles": 5, "lastSeenSecs": 30 }
```

**After (v1.1)** (backend/api.js):
```json
{ "name": "alice", "alive": true, "heartbeat_at": "2026-03-29T22:00:00Z", "current_task": "...", "unread_messages": 2 }
```

**Migration**: Check `agent.alive` (boolean) instead of `agent.status === "running"`.
Note: The dashboard server (server.js) may enrich these fields when serving the frontend.

---

### Non-Breaking Changes

#### `POST /api/tasks` — Stricter title validation
- Whitespace-only titles (e.g. `"   "`) now return `400 { "error": "title is required" }`.
- Invalid `priority` values return `400 { "error": "priority must be one of: low, medium, high, critical" }`.
- **Response body changed**: now returns the full created task object (not `{ ok, id }`).

#### `PATCH /api/tasks/:id` — Enum validation + new status values
- **New status values**: `in_review` and `cancelled` are now valid.
- Invalid `status` values return `400 { "error": "status must be one of: ..." }`.
- Invalid `priority` values return `400 { "error": "priority must be one of: ..." }`.
- **Response body changed**: now returns the full updated task object (not `{ ok: true }`).
- When `status` transitions to `done`, a `completed_at` timestamp is auto-set.

#### `DELETE /api/tasks/:id` — Response body changed
- **Response body changed**: now returns `{ "deleted": { ...task } }` (not `{ ok: true }`).

#### `GET /api/tasks` — Query filter support
- New query parameters: `?assignee=<name>` and `?status=<value>` (case-insensitive).
- Example: `GET /api/tasks?assignee=bob&status=open`

#### `GET /api/health` — Response shape depends on handler
- **backend/api.js**: `{ "status": "ok", "uptime_ms": 3600000 }`
- **server.js**: `{ "uptime": 3600, "memory": {...}, "activeAgents": 3, "sseClients": 1 }`

---

## v1.0.0 — 2026-03-29 (initial release)

Initial API surface covering:
- Agent status and detail endpoints
- Task board CRUD
- Messaging (direct agent messages, broadcast)
- Announcements and team channel
- CEO inbox
- Search
- Server health and config

See `api_reference.md` for full endpoint documentation.

---

## Migration Guide

### v1.0 → v1.1

1. **Agent listing** (`GET /api/agents`): Replace `agent.status === "running"` checks with `agent.alive === true`.
2. **Agent inbox** (`GET /api/agents/:name`): Remove any code reading `inbox[].content`. Use `GET /api/agents/:name/inbox` if you need full message content.
3. **Task creation** (`POST /api/tasks`): Update response handling — response is now a full `Task` object, not `{ ok, id }`.
4. **Task updates** (`PATCH /api/tasks/:id`): Update response handling — response is now a full `Task` object.
5. **Task deletion** (`DELETE /api/tasks/:id`): Update response handling — response is now `{ deleted: Task }`.
6. **Task status field**: Add support for `in_review` and `cancelled` status values in any UI or validation logic.

---

## v1.2.0 — 2026-03-30

### New Endpoints

#### `GET /api/agents/:name/ping`
Check whether an agent's OS process is running. Returns real-time process status via `pgrep`.

**Response**:
```json
{ "name": "alice", "running": true, "inCycle": false, "pids": ["12345"] }
```
| Field | Description |
|-------|-------------|
| `running` | `true` if `run_subset.sh <name>` is running |
| `inCycle` | `true` if `run_agent.sh <name>` is actively in a cycle |
| `pids` | All matching process IDs |

### Changes to Existing Endpoints

#### `GET /api/agents` — Full AgentSummary fields + clarified response shape
- **Clarification**: `server.js` returns a **plain array** `[{...}]`. (`backend/api.js` returns `{ agents: [...] }` — these are different.)
- **New field**: `auth_error` (boolean) — `true` if agent's `last_context.md` contains auth/login failure indicators.
- **New field** (reminder): `status` — agent status string (`running`, `idle`, `stopped`, `error`, `unknown`).

**Full v1.2 AgentSummary shape**:
```json
{
  "name": "alice",
  "role": "Acting CEO / Tech Lead",
  "status": "running",
  "current_task": "Reviewing PR #42",
  "cycles": 12,
  "last_update": "2026-03-29T21:00:00.000Z",
  "lastSeenSecs": 45,
  "heartbeat_age_ms": 45000,
  "auth_error": false,
  "alive": true,
  "unread_messages": 2
}
```

#### `GET /api/agents/:name/cycles` — Sequential `cycle` field
Each cycle object now includes a `cycle` field (1-based integer, oldest first) for stable reference in `GET /api/agents/:name/cycles/:n`.

### Migration Guide: v1.1 → v1.2

1. **Agent listing** (`GET /api/agents`): If parsing the response as `{ agents: [...] }`, switch to treating the response as a plain array.
2. **Agent health check**: Use new `GET /api/agents/:name/ping` instead of relying on heartbeat age for real-time process status.
3. **Auth error monitoring**: Read `auth_error` field from agent summaries to detect agents that failed to authenticate.

---

## v1.3 — OpenAPI Spec Completion (Session 11, 2026-03-30)

### New: Missing Endpoints Documented in openapi.yaml

The following server.js endpoints were previously undocumented in `openapi.yaml`. All have been added:

#### `POST /api/agents/watchdog`
Checks all running agents for stale heartbeats (>15 min). Restarts stuck agents automatically. Response includes list of restarted agents and per-agent action details.

#### `POST /api/tasks/{id}/claim`
Atomic task claim with file locking. Sets task to `in_progress` and assigns to the requesting agent. Returns 409 if already claimed by another agent. Agents should prefer this over manual PATCH for concurrent claim safety.

#### `GET /api/mode` / `POST /api/mode`
Get or set company operating mode (`plan`, `normal`, `crazy`). POST calls `switch_mode.sh` internally.

#### `GET /api/cost`
Returns today's token spend and 7-day totals broken down per agent. Fields: `today_usd`, `today_cycles`, `total_7d_usd`, `total_7d_cycles`, `per_agent[]`.

#### `GET /api/metrics`
System-wide health snapshot: task completion stats (by_status, by_priority, by_assignee, completion_rate_pct), agent health (running/idle/stale counts), 7-day cost/cycle stats, and HTTP request metrics from Bob's middleware.

#### `POST /api/messages/{agent}`
Send a direct message to any agent's inbox. Part of `backend/api.js`. Was in `api_reference.md` but missing from OpenAPI spec.

### New Tags Added
- `Configuration` — mode management endpoints
- `Stats` — cost and metrics endpoints
- `Messaging` — direct agent messaging

### No Breaking Changes
All additions are net-new documentation. No existing endpoint behavior has changed.

## v1.4 — API Reference Completion (Session 12, 2026-03-30)

### Newly Documented Endpoints

The following endpoints existed in `server.js` but were missing from `api_reference.md`. All have been added in this session:

#### Agent Lifecycle
- `POST /api/agents/watchdog` — restart stuck agents (stale heartbeat >15 min); response includes per-agent action details
- `GET /api/watchdog-log` — in-memory watchdog event log
- `GET /api/agents/:name/log/stream` — SSE live log tail (Server-Sent Events); last 20 KB on connect, then new lines as they arrive

#### Agent Persona
- `POST /api/agents/:name/persona/note` — append free-form note to persona evolution log
- `PATCH /api/agents/:name/persona` — append structured evolution observation to persona

#### Agent Cycle History
- `GET /api/agents/:name/cycles` — today's cycle summaries (newest first): n, started/ended, turns, cost_usd, duration_s, action_count, preview
- `GET /api/agents/:name/cycles/:n` — full raw log content for cycle N

#### Task Management
- `POST /api/tasks/:id/claim` — atomic claim with file lock; 409 if claimed by another agent
- `GET /api/tasks/:id/result` — fetch task result file (shared task_outputs/ or agent output/)
- `POST /api/tasks/:id/result` — write task result to public/task_outputs/task-{id}-{slug}.md

#### CEO Command
- `POST /api/ceo/command` — smart routing: @mention → DM, `task:` → create task, `/mode` → switch mode, else → alice inbox

#### Consensus Board
- `GET /api/consensus` — return parsed consensus board entries + raw markdown
- `POST /api/consensus/entry` — add entry (type + content required; section defaults to "Evolving Relationships")

### No Breaking Changes
All additions are net-new documentation. No endpoint behavior has changed.

---

## v1.5 — 2026-03-30 (Session 14)

### Updated: Message Bus Endpoints (openapi_spec.yaml)

Corrected and expanded documentation for the SQLite message bus (Task #102, `backend/message_bus.js`).

#### Removed (incorrect)
- `POST /api/messages/{agent}` — was incorrectly documented; that path does not exist

#### Added (correct message bus endpoints)
- `POST /api/messages` — send DM; body: `{from, to, body, priority?}`; rate limited 60/min per sender
- `POST /api/messages/broadcast` — fan-out to all active agents; body: `{from, body, priority?}`; rate limited 5/min per sender
- `GET /api/messages/queue-depth` — unread count per agent; returns `{total_unread, by_agent[]}`
- `GET /api/inbox/{agent}` — list up to 50 unread messages (priority+FIFO); does NOT auto-ack
- `POST /api/inbox/{agent}/{id}/ack` — mark message as read; 404 if already acked

#### Added Schema
- `BusMessage` — SQLite message row: `{id, from_agent, to_agent, body, priority, created_at, read_at}`

### No Breaking Changes
Removal of the incorrect `/api/messages/{agent}` path only; no real endpoint was removed.

---

## v1.6 — 2026-03-30 (Session 14, Cycle 2)

### Fix: Restored Missing File-Based Inbox Endpoint

The v1.5 changelog incorrectly stated that `POST /api/messages/{agent}` does not exist.
It **does** exist in `backend/api.js` and is a separate system from the SQLite message bus.

#### Added Back (corrected)
- `POST /api/messages/{agent}` — file-based message write to `agents/{name}/chat_inbox/`
  - Required field: **`content`** (was incorrectly documented as `message` in earlier sessions)
  - Optional field: `from` (sender name, defaults to "api")
  - Returns 201 on success; 404 if agent not found
  - Distinct from `POST /api/messages` (SQLite bus) — writes a `.md` file to disk

### Two Messaging Systems Clarified

| Endpoint | Backend | Storage | Use Case |
|----------|---------|---------|----------|
| `POST /api/messages/{agent}` | `backend/api.js` | File (chat_inbox/) | Legacy file-based inbox |
| `POST /api/messages` | `backend/message_bus.js` | SQLite (messages.db) | New SQLite message bus |
| `GET /api/inbox/{agent}` | `backend/message_bus.js` | SQLite | Read SQLite messages |

### Schema Fix
- Updated `POST /api/messages/{agent}` requestBody: `required: [content]` (not `message`)

---

## v1.7 — 2026-03-30 (Session 14, Cycle 3)

### Added: SQLite Message Bus Section to api_reference.md

Completed documentation for all 6 SQLite message bus endpoints in the human-readable API reference. Previously these were only in `openapi_spec.yaml`.

#### Endpoints Documented
| Endpoint | Description |
|----------|-------------|
| `POST /api/messages` | Send DM; `{from, to, body, priority?}` → 201 `{id, from, to, priority}` |
| `GET /api/inbox/:agent` | List up to 50 unread messages (priority+FIFO order) |
| `POST /api/inbox/:agent/:id/ack` | Acknowledge message; 404 if already acked |
| `POST /api/messages/broadcast` | Fan-out to all active agents; 201 or 200 if none |
| `GET /api/messages/queue-depth` | Unread counts per agent: `{total_unread, by_agent[]}` |
| `DELETE /api/messages/purge` | Delete old read messages; `?days=N&unread=bool` |

#### Also Added
- Two Messaging Systems Comparison table (file-based vs SQLite bus)
- Rate limit documentation: 60 msg/min DM, 5 broadcast/min per sender
- BusMessage schema with all fields including `read_at`

### Source
- `backend/message_bus.js` — full implementation
- `e2e/coverage.spec.js` — 12 tests added in commit 45c774d

---

## v1.7 — 2026-03-30 (Session 14, Cycle 3)

### Added: API Key Authentication (Task #103)

Quinn's `isAuthorized()` middleware was added in Task #103 but was never reflected in the spec.

#### Security Schemes Added
- `BearerAuth` — `Authorization: Bearer <API_KEY>` header
- `ApiKeyHeader` — `X-API-Key: <API_KEY>` header
- Both schemes are equivalent; only one is required per request
- Auth only enforced when `API_KEY` env var is set on the server
- Dev mode (no `API_KEY`): all requests pass without credentials
- Unauthorized response: HTTP 401 with `WWW-Authenticate: Bearer`

#### Spec Changes
- Added `security:` global block (both schemes listed as alternatives)
- Added `components/securitySchemes`: `BearerAuth` (http/bearer), `ApiKeyHeader` (apiKey/header)
- Added `components/responses/Unauthorized` — reusable 401 response
- Added `components/responses/BadRequest` — reusable 400 response
- Updated `info.description` with authentication section
- Version bumped to `1.7`

### No Breaking Changes
Authentication was already implemented — this is documentation only.

---

## v1.7 — 2026-03-30 (Session 14, Cycle 3)

### Fix: Inbox/Message Response Schema + 400 Error Codes

Corrected response schemas for the two file-based inbox endpoints after reviewing
Heidi's e2e coverage gaps report (Task #123, agents/heidi/output/e2e_coverage_gaps.md).

#### Fixed: POST /api/agents/{name}/message
- Response schema was `OkResponse` — actual response is `{ok, filename}`
- Added `filename` field to response schema (e.g. "2026_03_30_12_00_00_from_dashboard.md")
- Added missing `400` response code (triggered on missing/invalid `message` field)
- Improved descriptions: `message` = "Message content (markdown)", `from` sanitized

#### Fixed: POST /api/agents/{name}/inbox
- Same response shape fix: `{ok, filename}` not just `{ok}`
- Added `400` + `404` response codes
- Note added: alias for `/message` endpoint

### Source
Heidi's GAP-007 analysis cross-referenced with server.js:1126-1139 (agentMsgMatch) 
and server.js:1373-1386 (agentInboxPostMatch).

---

## v1.8 — 2026-03-30 (Task #143)

### New: Endpoints Added Since Task #107 (OpenAPI Spec Catch-Up)

Audited server.js and backend/api.js against the spec. Added five previously
undocumented or under-documented endpoints.

#### Added: GET /api/agents/{name}/health
- Ivan's v2 agent health model (Charlie #108)
- Returns `AgentHealthScore` object: `{name, score, grade, dimensions}`
- Score 0–100 across five weighted dimensions: heartbeat (25), inbox backlog (25),
  current status (20), velocity (20), recency (10)
- Added `AgentHealthScore` and `HealthDimension` component schemas

#### Added: GET /api/ws (WebSocket upgrade)
- Nick's real-time event stream (Task #113)
- Handles HTTP Upgrade to WebSocket on `/api/ws` (RFC 6455)
- Server pushes `hello` on connect, `heartbeat_update` on any agent heartbeat change
- Supports ping/pong and close frames from client

#### Confirmed Already Documented: GET /api/tasks (filters)
- `?priority=`, `?q=`, `?assignee=`, `?status=` query params were already in spec
- Dave's filter API (full-text search on title + description) ✓

#### Confirmed Already Documented: GET /api/agents/{name}/cycles
- Already documented in prior sessions ✓

#### Updated: POST /api/ceo/command — Validation Rules (SEC-006)
- Added `maxLength: 1000` to `command` field schema
- Documented input sanitization: ASCII control chars U+0000–U+001F/U+007F stripped
- Documented all routing modes with clearer descriptions

### No Breaking Changes
Documentation-only additions. All existing response shapes unchanged.

---

## v1.8 — 2026-03-30 (Task #143)

### Added: New Endpoints Since Task #107

Documented five endpoint categories added by other agents after the Task #107 spec delivery.

#### Added: GET /api/agents/{name}/health
- New endpoint: agent health score (0–100) from Ivan's v2 model (Charlie #108)
- Response: `AgentHealthScore` — `{name, score, grade, dimensions}`
- Five dimensions: heartbeat (25pts), activity/inbox (25pts), status (20pts), velocity (20pts), recency (10pts)
- Grade: A≥90, B≥75, C≥55, D<55
- New schemas: `AgentHealthScore`, `HealthDimension`

#### Added: GET /api/ws (WebSocket)
- New endpoint: `ws://host/api/ws` — real-time typed event stream (Nick #113)
- RFC 6455 upgrade handshake; server sends `hello` frame on connect
- Server-pushed events: `hello`, `heartbeat_update`
- Client→server: close (0x8) and ping/pong (0x9) supported
- Note in spec: OpenAPI 3.0 limitation around WS documented

#### Confirmed already documented (no changes needed)
- `GET /api/tasks` — `?priority=`, `?q=`, `?assignee=`, `?status=` filters all present
- `GET /api/agents/{name}/cycles` — already in spec from Task #107
- `GET /api/agents/{name}/cycles/{n}` — already in spec from Task #107

#### Updated: POST /api/ceo/command
- Added SEC-006 input validation documentation:
  - `command` max length: 1000 characters
  - ASCII control characters (U+0000–U+001F, U+007F) stripped server-side
  - Added `maxLength: 1000` constraint to schema
  - Extended routing rule descriptions (also supports `todo:` / `create task:` prefix variants)

### No Breaking Changes
All additions are new paths or documentation improvements only.

---

## v1.8 — 2026-03-30 (Task #143)

### New: Missing Endpoints Documented

Audited `server.js` against `openapi_spec.yaml` following Task #143 (Sam TPM review).
Added three missing paths and updated one endpoint's validation details.

#### Added: GET /api/agents/{name}/health
- Returns `AgentHealthScore` object with score (0–100), letter grade (A/B/C/D), and five dimensions
- Dimensions: `heartbeat` (25pts), `activity` (25pts), `status` (20pts), `velocity` (20pts), `recency` (10pts)
- Added `AgentHealthScore` and `HealthDimension` schemas to `components/schemas`
- Source: `server.js:1489` (Ivan's v2 health model, Charlie Task #108)

#### Added: GET /api/ws (WebSocket)
- WebSocket real-time event stream (Task #113, Nick)
- RFC 6455 upgrade handshake on `/api/ws`
- Server pushes `hello` on connect, `heartbeat_update` on agent heartbeat changes
- Client ping/pong and graceful close handled
- Note included: OpenAPI 3.0 doesn't natively model WS upgrades; entry is for reference

#### Updated: POST /api/ceo/command — Validation Details
- Added SEC-006 input validation documentation:
  - `command` is required and non-empty
  - Maximum length: **1000 characters**
  - ASCII control characters (U+0000–U+001F, U+007F) stripped (except tab/LF/CR)
- Added `maxLength: 1000` to request schema
- Routing: also matches `todo:` and `create task:` prefixes (not just `task:`)

#### Already Documented (confirmed correct)
- `GET /api/tasks?priority=&q=&assignee=&status=` — all four filters already in spec ✓
- `GET /api/agents/{name}/cycles` and `GET /api/agents/{name}/cycles/{n}` — already in spec ✓

### No Breaking Changes
Documentation-only additions and corrections.
