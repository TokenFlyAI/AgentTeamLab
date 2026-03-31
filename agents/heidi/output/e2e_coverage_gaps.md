# E2E Coverage Gap Report
**Author**: Heidi (Security Engineer)
**Date**: 2026-03-30 (updated Cycle 11 — added DELETE /api/messages/purge, research/:file, knowledge/:file; corrected consensus false-positive)
**Task**: #123
**Scope**: server.js + backend/agent_metrics_api.js + backend/message_bus.js vs e2e/*.spec.js (api, dashboard, metrics, coverage)

---

## Summary

| Category | Total Endpoints | Covered | Uncovered |
|----------|----------------|---------|-----------|
| Agent management | 16 | 12 | 4 |
| Task management | 12 | 12 | 0 |
| Messaging | 8 | 8 | 0 |
| Metrics/stats | 9 | 9 | 0 |
| Content APIs | 12 | 10 | 2 |
| Agent actions (destructive) | 5 | 1 | 4 |
| **TOTAL** | **62** | **52** | **10** |

**Overall coverage: ~84%** (52 of 62 distinct endpoint/method pairs)

---

## Covered Endpoints (52)

| Method | Endpoint | Spec File |
|--------|----------|-----------|
| GET | /api/health | api.spec.js |
| GET | /api/config | api.spec.js, coverage.spec.js |
| GET | /api/dashboard | api.spec.js |
| GET | /api/search | api.spec.js |
| GET | /api/agents | api.spec.js |
| GET | /api/agents/:name | api.spec.js |
| GET | /api/agents/:name/log | coverage.spec.js |
| GET | /api/agents/:name/ping | coverage.spec.js |
| GET | /api/agents/:name/health | coverage.spec.js |
| GET | /api/agents/:name/inbox | coverage.spec.js |
| GET | /api/agents/:name/status | coverage.spec.js |
| GET | /api/agents/:name/persona | coverage.spec.js |
| GET | /api/agents/:name/todo | coverage.spec.js |
| GET | /api/agents/:name/activity | coverage.spec.js |
| GET | /api/agents/:name/lastcontext | coverage.spec.js |
| GET | /api/agents/:name/cycles | metrics.spec.js |
| GET | /api/agents/:name/cycles/:n | coverage.spec.js |
| GET | /api/agents/:name/output | metrics.spec.js |
| GET | /api/agents/:name/output/:file | coverage.spec.js |
| POST | /api/agents/:name/message | api.spec.js |
| POST | /api/agents/:name/persona/note | coverage.spec.js |
| PATCH | /api/agents/:name/persona | coverage.spec.js |
| POST | /api/agents/smart-start | coverage.spec.js |
| POST | /api/agents/watchdog | metrics.spec.js |
| GET | /api/watchdog-log | coverage.spec.js |
| GET | /api/tasks | api.spec.js |
| POST | /api/tasks | api.spec.js |
| PATCH | /api/tasks/:id | api.spec.js |
| DELETE | /api/tasks/:id | api.spec.js |
| GET | /api/tasks/archive | coverage.spec.js |
| POST | /api/tasks/archive | coverage.spec.js |
| GET | /api/tasks/export.csv | coverage.spec.js |
| GET | /api/tasks/:id/result | api.spec.js |
| POST | /api/tasks/:id/result | api.spec.js |
| POST | /api/tasks/:id/claim | api.spec.js |
| GET | /api/team-channel | api.spec.js, coverage.spec.js |
| POST | /api/team-channel | coverage.spec.js |
| GET | /api/announcements | api.spec.js, coverage.spec.js |
| POST | /api/announce OR /api/announcements | coverage.spec.js |
| POST | /api/broadcast | metrics.spec.js |
| GET | /api/ceo-inbox | coverage.spec.js |
| POST | /api/ceo-inbox/:filename/read | coverage.spec.js |
| POST | /api/ceo/command | metrics.spec.js |
| GET | /api/org | coverage.spec.js |
| GET | /api/mode | metrics.spec.js |
| POST | /api/mode | metrics.spec.js |
| GET | /api/sops | coverage.spec.js |
| GET | /api/ops | coverage.spec.js |
| GET | /api/cost | metrics.spec.js |
| GET | /api/stats | coverage.spec.js |
| GET | /api/digest | coverage.spec.js |
| GET | /api/metrics | metrics.spec.js |
| GET | /api/metrics/agents | coverage.spec.js |
| GET | /api/metrics/agents/:name | coverage.spec.js |
| GET | /api/metrics/tasks | coverage.spec.js |
| GET | /api/metrics/health | coverage.spec.js |
| GET | /api/code-output | coverage.spec.js |
| GET | /api/knowledge | coverage.spec.js |
| GET | /api/research | coverage.spec.js |
| GET | /api/consensus | metrics.spec.js, coverage.spec.js |
| POST | /api/consensus/entry | metrics.spec.js, coverage.spec.js |
| POST | /api/messages | message_bus.spec.js |
| GET | /api/inbox/:agent | message_bus.spec.js |
| POST | /api/inbox/:agent/:id/ack | message_bus.spec.js |
| POST | /api/messages/broadcast | message_bus.spec.js |
| GET | /api/messages/queue-depth | message_bus.spec.js |

---

## Coverage Gaps (11 endpoints — corrected from earlier draft)

### GAP-001: POST /api/agents/:name/stop
**Risk**: HIGH — destructive endpoint with no test coverage
**Details**: Runs `stop_agent.sh <name>`. No e2e test validates the route exists, returns correct HTTP status, or rejects invalid agent names. No test for unauthorized use.
**Recommendation**: Add tests: 404 for unknown agent, 200 + ok for valid agent (use a dummy/mock), 400 for invalid name format.
**Feeds**: Task #109 (e2e auth expansion)

---

### GAP-002: POST /api/agents/:name/start
**Risk**: HIGH — destructive endpoint with no test coverage
**Details**: Runs `run_agent.sh <name>`. Same as stop — no coverage at all.
**Recommendation**: Same as GAP-001. Test shape/response, 404 for unknown agents.
**Feeds**: Task #109

---

### GAP-003: POST /api/agents/start-all
**Risk**: MEDIUM — bulk destructive action, no test
**Details**: Runs `run_all.sh`. Could be triggered accidentally or by attackers in authenticated context. No test validates response shape or auth requirement.
**Recommendation**: Add basic tests: 200 response with ok field, ensure auth (when API_KEY set) blocks unauthorized calls.

---

### GAP-004: POST /api/agents/stop-all
**Risk**: MEDIUM — bulk destructive action, no test
**Details**: Runs `stop_all.sh`. Same concerns as start-all.
**Recommendation**: Same as GAP-003.

---

### GAP-005: GET /api/agents/:name/log/stream (SSE)
**Risk**: MEDIUM — Server-Sent Events endpoint, resource exhaustion possible
**Details**: SSE streaming endpoint at `/api/agents/:name/log/stream`. No tests for: connection establishment, `text/event-stream` Content-Type, keepalive behavior, cleanup on client disconnect, or connection limit.
**Security concern**: A client that opens many SSE streams without reading could cause resource exhaustion. See also: known SSE keepalive resource leak fix in recent commits.
**Recommendation**: Add basic e2e test: verify 200 + `Content-Type: text/event-stream` header. Add connection-count validation.

---

### GAP-006: GET /api/events (SSE)
**Risk**: MEDIUM — second SSE endpoint, same concerns as GAP-005
**Details**: Dashboard server-sent events stream at `/api/events`. No tests at all.
**Recommendation**: Test: 200 + `text/event-stream` header. Invalid agent name → proper error. Connect then disconnect to verify cleanup.

---

### GAP-007: POST /api/agents/:name/inbox
**Risk**: MEDIUM — write endpoint, no coverage
**Details**: Route at `/api/agents/:name/inbox` (POST) accepts `{ message, from }` and writes to agent's `chat_inbox/`. Distinct from `POST /api/agents/:name/message` (different body schema: uses `message` field, not `content`). No test validates:
- 400 on missing `message`
- 404 on unknown agent
- File written to inbox
- Input sanitization of `from` field
**Security note**: The `from` field is sanitized via `sanitizeFrom()`, but this is untested.
**Recommendation**: Add 3 tests: happy path write, missing-message 400, unknown-agent 404.

---

### GAP-008: GET /api/research/:file
**Risk**: HIGH — path traversal regression not covered
**Details**: `GET /api/research` (list) IS tested. `GET /api/research/:file` (read a specific file) is NOT tested. This is an identical attack surface to `/api/agents/:name/output/:file` and `/api/ceo-inbox/:filename/read` — both of which have path traversal tests in coverage.spec.js. Without a test here, a regression in the path-resolution guard goes undetected.
**Recommendation**:
- `GET /api/research/../../company.md` → 400 (path traversal blocked)
- `GET /api/research/nonexistent_xyz.md` → 404
- `GET /api/research/<valid-fixture>` → 200 with content
**Feeds**: Task #109, security invariant regression guard

---

### GAP-009: GET /api/knowledge/:file
**Risk**: HIGH — path traversal regression not covered (same as GAP-008)
**Details**: `GET /api/knowledge` (list) IS tested. `GET /api/knowledge/:file` (read a specific file) is NOT tested.
**Recommendation**: Same pattern as GAP-008 — path traversal test + 404 + happy path.

---

### GAP-010: DELETE /api/messages/purge
**Risk**: HIGH — irreversible data destruction, no auth test
**Details**: Purges the entire SQLite message bus database. No e2e test exists for this endpoint. With Quinn's auth (Task #103) now in place, we need a test that this endpoint rejects unauthenticated callers.
**Recommendation**:
- `DELETE /api/messages/purge` (no auth) → 401
- `DELETE /api/messages/purge` (with auth) → 200 `{ purged: N }`

---

### GAP-011: Auth coverage for write endpoints (cross-cutting)
**Security note for Task #109 (Tina/Frank)**: When API key auth is enforced (Task #103), the following endpoints are **write operations** with no auth test. All must be verified to return 401 when API_KEY is set and no key is provided:

| Endpoint | Gap# |
|----------|------|
| POST /api/agents/:name/stop | GAP-001 |
| POST /api/agents/:name/start | GAP-002 |
| POST /api/agents/start-all | GAP-003 |
| POST /api/agents/stop-all | GAP-004 |
| POST /api/agents/:name/inbox | GAP-007 |
| DELETE /api/messages/purge | GAP-010 |

---

## Priority Order for Test Development

| Priority | Gap | Reason |
|----------|-----|--------|
| P1 | GAP-008, GAP-009 (research/:file, knowledge/:file) | Path traversal — security regression risk |
| P1 | GAP-010 (messages/purge) | Destructive + auth validation required |
| P1 | GAP-007 (agents/:name/inbox POST) | Write endpoint, auth surface for Task #109 |
| P1 | GAP-001, GAP-002 (agent stop/start) | Destructive, high-impact |
| P2 | GAP-003, GAP-004 (start-all/stop-all) | Bulk destructive |
| P3 | GAP-005, GAP-006 (SSE streams) | Hard to test fully, medium risk |

**Note**: GAP-008 (consensus GET) and GAP-009 (consensus/entry POST) from prior draft were FALSE POSITIVES — both ARE tested in metrics.spec.js and coverage.spec.js. Removed.
