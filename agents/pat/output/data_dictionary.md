# Tokenfly Agent Team Lab — Data Dictionary

**Designer**: Pat (Database Engineer)
**Date**: 2026-03-29
**DB**: PostgreSQL 15+
**Schema version**: migration_005 (messages SQLite — pending apply); migration_002 (PostgreSQL — latest applied)
**Last updated**: 2026-03-30 Session 10

---

## Overview

This document defines every table, column, constraint, and index in the
Tokenfly core schema. Use this as the authoritative reference when writing
queries, building data models, or designing API contracts.

---

## Table of Contents

1. [agents](#agents)
2. [tasks](#tasks)
3. [task_comments](#task_comments)
4. [sessions](#sessions)
5. [messages](#messages)
6. [announcements](#announcements)
7. [company_mode_log](#company_mode_log)
8. [audit_log](#audit_log)
9. [request_metrics](#request_metrics)
10. [Enum Types](#enum-types)
11. [Indexes Summary](#indexes-summary)
12. [Known Gaps & Migration Roadmap](#known-gaps--migration-roadmap)

---

## agents

Registry of all AI agents in the Tokenfly system.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key. |
| `name` | TEXT | NOT NULL | — | Unique agent name (e.g. `alice`, `bob`). Lowercase. |
| `role` | agent_role | NOT NULL | — | Agent's role enum. See [Enum Types](#enum-types). |
| `department` | TEXT | NOT NULL | — | Department name (e.g. `Engineering`, `Leadership`, `QA`). |
| `reports_to_id` | UUID | NULL | — | FK → `agents.id`. Manager. NULL for top of hierarchy (Alice). `ON DELETE SET NULL`. |
| `current_status` | agent_status | NOT NULL | `'offline'` | Current agent status. See [Enum Types](#enum-types). |
| `last_heartbeat` | TIMESTAMPTZ | NULL | — | Timestamp of the last heartbeat.md write. NULL if never seen. |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` | Row creation time. |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `now()` | Auto-updated by trigger on any change. |

**Constraints**:
- `agents_name_unique` — UNIQUE on `name`
- `agents_name_nonempty` — CHECK `char_length(trim(name)) > 0`

**Triggers**:
- `trg_agents_updated_at` — sets `updated_at = now()` on every UPDATE

**Indexes**:
- `idx_agents_name` — `(name)` — name lookup
- `idx_agents_status` — `(current_status)` — status filtering
- `idx_agents_last_heartbeat` — `(last_heartbeat DESC NULLS LAST)` — recency queries

**Notes**:
- 20 agents seeded at schema init. Additional agents are rare; treat table as near-static.
- `reports_to_id` is self-referential. Root node (alice) has NULL `reports_to_id`.
- `last_heartbeat` is set when the agent writes to its `heartbeat.md` file. Server
  considers an agent "running" if heartbeat is within the last 5 minutes.

---

## tasks

Central task board. All work items for the team.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | BIGSERIAL | NOT NULL | auto | Primary key. Auto-incrementing integer. |
| `title` | TEXT | NOT NULL | — | Short task title. Displayed in dashboards. |
| `description` | TEXT | NULL | — | Full task description. Supports multi-line. |
| `priority` | task_priority | NOT NULL | `'medium'` | Task priority. See [Enum Types](#enum-types). |
| `status` | task_status | NOT NULL | `'open'` | Current status. See [Enum Types](#enum-types). |
| `assignee_id` | UUID | NULL | — | FK → `agents.id`. Assigned agent. NULL = unassigned. `ON DELETE SET NULL`. |
| `created_by_id` | UUID | NULL | — | FK → `agents.id`. Agent who created the task. NULL = system/CEO. `ON DELETE SET NULL`. |
| `due_at` | TIMESTAMPTZ | NULL | — | Optional deadline. Must be after `created_at`. |
| `completed_at` | TIMESTAMPTZ | NULL | — | When the task was completed. **Must be set when status = 'done'.** |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` | Row creation time. |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `now()` | Auto-updated by trigger. |

**Constraints**:
- `tasks_title_nonempty` — CHECK `char_length(trim(title)) > 0`
- `tasks_completed_at_check` — CHECK `(status = 'done' AND completed_at IS NOT NULL) OR (status != 'done')`
  > **FIXED (Bob Session 7)**: `PATCH /api/tasks/:id` now auto-sets `completed_at = new Date().toISOString()` when `status === 'done'`. Constraint will pass.
- `tasks_due_after_created` — CHECK `due_at IS NULL OR due_at > created_at`

**Triggers**:
- `trg_tasks_updated_at` — sets `updated_at = now()` on every UPDATE

**Indexes**:
- `idx_tasks_assignee` — `(assignee_id)` WHERE `status NOT IN ('done', 'cancelled')` — active task lookup
- `idx_tasks_priority_status` — `(priority, status)` — task board sorting
- `idx_tasks_status` — `(status)` — status filtering
- `idx_tasks_created_at` — `(created_at DESC)` — recent tasks

**Known Gap**:
- `assignee_id` is a UUID FK, but the current `task_board.md` stores assignee as a name string.
  See migration_003 for the backfill plan.

---

## task_comments

Discussion thread attached to each task.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | BIGSERIAL | NOT NULL | auto | Primary key. |
| `task_id` | BIGINT | NOT NULL | — | FK → `tasks.id`. Parent task. `ON DELETE CASCADE`. |
| `author_id` | UUID | NULL | — | FK → `agents.id`. Comment author. NULL if author deleted. `ON DELETE SET NULL`. |
| `author_type` | message_sender_type | NOT NULL | `'agent'` | Who sent this: agent, CEO, or system. |
| `body` | TEXT | NOT NULL | — | Comment text. |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` | Comment creation time. |

**Constraints**:
- `task_comments_body_nonempty` — CHECK `char_length(trim(body)) > 0`

**Indexes**:
- `idx_task_comments_task` — `(task_id, created_at DESC)` — fetch comments for a task

---

## sessions

Each agent invocation / work cycle. One row per Claude Code session.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key. |
| `agent_id` | UUID | NOT NULL | — | FK → `agents.id`. `ON DELETE CASCADE`. |
| `started_at` | TIMESTAMPTZ | NOT NULL | `now()` | Session start time. |
| `ended_at` | TIMESTAMPTZ | NULL | — | Session end time. NULL = session still running. |
| `model_used` | TEXT | NULL | — | Model identifier (e.g. `claude-sonnet-4-6`). |
| `notes` | TEXT | NULL | — | Optional session notes (current task summary, etc.). |

**Constraints**:
- `sessions_ended_after_started` — CHECK `ended_at IS NULL OR ended_at >= started_at`

**Indexes**:
- `idx_sessions_agent` — `(agent_id, started_at DESC)` — session history for agent
- `idx_sessions_active` — `(agent_id)` WHERE `ended_at IS NULL` — find running sessions

---

## messages

All inter-agent messages and CEO→agent communications. **Implementation: SQLite** (`backend/messages.db` via `better-sqlite3`). See `backend/message_bus.js` for schema and endpoints.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NOT NULL | AUTOINCREMENT | Primary key. |
| `from_agent` | TEXT | NOT NULL | — | Sender agent name (e.g. `"ceo"`, `"alice"`). |
| `to_agent` | TEXT | NOT NULL | — | Recipient agent name. |
| `body` | TEXT | NOT NULL | — | Message body. Max 64 KB (CHECK enforced after migration_005). |
| `priority` | INTEGER | NOT NULL | `5` | 1=highest (CEO), 5=normal, 9=lowest. Range 1–9 (CHECK enforced after migration_005). |
| `created_at` | TEXT | NOT NULL | `strftime('%Y-%m-%dT%H:%M:%fZ','now')` | ISO-8601 send time (UTC). |
| `read_at` | TEXT | NULL | `NULL` | ISO-8601 ack time. NULL = unread. |

**Constraints** (enforced at DB level after migration_005; currently enforced by application code only):
- `CHECK(priority BETWEEN 1 AND 9)` — app code also clamps via `Math.min/max`
- `CHECK(length(body) <= 65536)` — app code also enforces via `parseBody()` 64 KB limit

**Indexes** (current schema, as of 2026-03-30):
- `idx_messages_inbox` — `(to_agent, priority, id)` WHERE `read_at IS NULL` — unread inbox in priority+FIFO order
- `idx_messages_from` — `(from_agent, created_at)` — present in current schema; no current query uses `from_agent` as filter (candidate for removal in migration_005)
- `idx_messages_read_at` — `(read_at)` WHERE `read_at IS NOT NULL` — supports auto-vacuum DELETE and `DELETE /api/messages/purge` endpoint

**Retention / Purge**:
- Auto-vacuum at startup: deletes read messages older than `MB_RETENTION_DAYS` (default 7) days.
- Manual purge: `DELETE /api/messages/purge?days=N[&unread=true]` — deletes read (or all) messages older than N days.

**Notes**:
- Broadcast messages are fan-out at write time: `POST /api/messages/broadcast` inserts one row per active agent.
- Delivery is at-least-once. Ack via `POST /api/inbox/:agent/:id/ack` sets `read_at`.
- Rate limits (in-memory, per sender): 60 DMs/min, 5 broadcasts/min (env: `MB_MSG_RATE_LIMIT`, `MB_BROADCAST_RATE_LIMIT`).
- PostgreSQL migration design (for future migration): `agents/pat/output/migration_004_message_bus.sql`.
- migration_005 (`agents/pat/output/migration_005_messages_constraints.sql`) adds CHECK constraints and drops `idx_messages_from` — pending Bob's apply.

---

## announcements

Public team announcements visible to all agents.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | BIGSERIAL | NOT NULL | auto | Primary key. |
| `author_id` | UUID | NULL | — | FK → `agents.id`. Announcement author. `ON DELETE SET NULL`. |
| `author_type` | message_sender_type | NOT NULL | `'agent'` | Author type. |
| `title` | TEXT | NOT NULL | — | Announcement title. |
| `body` | TEXT | NOT NULL | — | Full announcement text. |
| `pinned` | BOOLEAN | NOT NULL | `FALSE` | Pinned announcements appear at top of feed. |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` | Post time. |
| `expires_at` | TIMESTAMPTZ | NULL | — | Optional expiry. Past-expiry announcements may be hidden by UI. |

**Constraints**:
- `announcements_title_nonempty` — CHECK `char_length(trim(title)) > 0`
- `announcements_expires_after_created` — CHECK `expires_at IS NULL OR expires_at > created_at`

**Indexes**:
- `idx_announcements_recent` — `(created_at DESC)` — latest announcements
- `idx_announcements_pinned` — `(pinned, created_at DESC)` WHERE `pinned = TRUE` — pinned feed

---

## company_mode_log

Immutable audit trail of every company mode change.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | BIGSERIAL | NOT NULL | auto | Primary key. |
| `mode` | company_mode | NOT NULL | — | New mode: plan, normal, or crazy. |
| `set_by` | TEXT | NOT NULL | — | Who set the mode. `'ceo'` or agent name. |
| `set_by_id` | UUID | NULL | — | FK → `agents.id`. NULL if set by CEO directly. `ON DELETE SET NULL`. |
| `reason` | TEXT | NULL | — | Reason for the mode change. |
| `effective_at` | TIMESTAMPTZ | NOT NULL | `now()` | When the mode took effect. |

**Constraints**:
- `company_mode_log_set_by_nonempty` — CHECK `char_length(trim(set_by)) > 0`

**Indexes**:
- `idx_company_mode_log_recent` — `(effective_at DESC)` — mode history

**Notes**:
- `set_by` is stored as TEXT (not just FK) because the CEO is not an agent row.
  `set_by_id` is NULL for CEO-originated changes.

---

## audit_log

Append-only immutable log of all significant system events.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | BIGSERIAL | NOT NULL | auto | Primary key. |
| `actor_id` | UUID | NULL | — | FK → `agents.id`. Agent who performed the action. `ON DELETE SET NULL`. |
| `actor_type` | message_sender_type | NOT NULL | `'agent'` | Who acted: agent, CEO, or system. |
| `action` | TEXT | NOT NULL | — | Action identifier. Convention: `entity.verb` (e.g. `task.created`, `message.sent`). |
| `entity_type` | TEXT | NULL | — | Type of entity affected (e.g. `task`, `agent`, `message`). |
| `entity_id` | TEXT | NULL | — | ID of the affected entity. TEXT to handle both BIGINT and UUID types. |
| `details` | JSONB | NULL | — | Arbitrary action context (before/after state, parameters, etc.). |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` | When the event occurred. |

**Constraints**:
- `audit_log_action_nonempty` — CHECK `char_length(trim(action)) > 0`

**Application constraint** (enforced by app, not DB):
- Rows must NEVER be updated or deleted. This table is append-only.

**Indexes**:
- `idx_audit_log_recent` — `(created_at DESC)` — recent events feed
- `idx_audit_log_actor` — `(actor_id, created_at DESC)` — per-agent audit trail
- `idx_audit_log_entity` — `(entity_type, entity_id, created_at DESC)` — entity history
- `idx_audit_log_details` — GIN on `details` — JSONB search across details

**Recommended action identifiers**:

| Action | Meaning |
|--------|---------|
| `task.created` | New task added to the board |
| `task.updated` | Task fields modified |
| `task.status_changed` | Task status transitioned |
| `task.deleted` | Task removed |
| `message.sent` | Message sent to an agent |
| `message.read` | Message marked as read |
| `message.broadcast` | Broadcast sent to all agents |
| `agent.status_changed` | Agent status changed |
| `agent.heartbeat` | Agent heartbeat recorded |
| `mode.changed` | Company mode changed |
| `announcement.posted` | New announcement created |

---

## request_metrics

Durable store for HTTP request telemetry. Persists Bob's in-memory AgentMetrics data.
Added in migration_002.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | BIGSERIAL | NOT NULL | auto | Primary key. |
| `endpoint` | TEXT | NOT NULL | — | Endpoint label (e.g. `GET /api/tasks`). |
| `method` | TEXT | NOT NULL | — | HTTP method (GET, POST, PATCH, DELETE). |
| `status_code` | SMALLINT | NOT NULL | — | HTTP response status code (100–599). |
| `duration_ms` | INTEGER | NOT NULL | — | Request duration in milliseconds. ≥ 0. |
| `client_ip` | INET | NULL | — | Client IP address. NULL for internal/system calls. |
| `recorded_at` | TIMESTAMPTZ | NOT NULL | `now()` | When the request was recorded. |

**Constraints**:
- `request_metrics_endpoint_nonempty` — CHECK non-empty endpoint
- `request_metrics_method_nonempty` — CHECK non-empty method
- `request_metrics_duration_positive` — CHECK `duration_ms >= 0`
- `request_metrics_status_valid` — CHECK `status_code BETWEEN 100 AND 599`

**Indexes**:
- `idx_request_metrics_endpoint_time` — `(endpoint, recorded_at DESC)` — per-endpoint analytics
- `idx_request_metrics_recent` — `(recorded_at DESC)` — time-series view
- `idx_request_metrics_errors` — `(recorded_at DESC)` WHERE `status_code >= 400` — error alerting

**Partitioning note**: Not partitioned by default. If monthly volume exceeds ~10M rows,
convert to range-partitioned table by `recorded_at`. Coordinate with Eve (Infra).

---

## Enum Types

### `agent_role`
Valid values: `ceo`, `acting_ceo`, `tpm`, `qa_lead`, `qa_engineer`, `backend`, `frontend`,
`fullstack`, `infra`, `data`, `security`, `ml`, `mobile`, `platform`, `sre`,
`api`, `performance`, `database`, `cloud`, `distributed_systems`

### `agent_status`
Valid values: `online`, `offline`, `idle`, `blocked`, `error`

### `task_priority`
Valid values (ordered high→low): `critical`, `high`, `medium`, `low`

### `task_status`
Valid values: `open`, `in_progress`, `blocked`, `in_review`, `done`, `cancelled`

> **FIXED (Bob Session 8)**: All 6 values are now validated in Bob's API: `VALID_STATUSES` includes `open`, `in_progress`, `blocked`, `in_review`, `done`, `cancelled`. `Validator.schemas.task.status.enum` also updated in `backend-api-module.js`. Schema and API are fully aligned.

### `company_mode`
Valid values: `plan`, `normal`, `crazy`

### `message_sender_type`
Valid values: `agent`, `ceo`, `system`

---

## Indexes Summary

| Index | Table | Type | Columns / Predicate |
|-------|-------|------|---------------------|
| `idx_agents_name` | agents | btree | `(name)` |
| `idx_agents_status` | agents | btree | `(current_status)` |
| `idx_agents_last_heartbeat` | agents | btree | `(last_heartbeat DESC NULLS LAST)` |
| `idx_tasks_assignee` | tasks | btree | `(assignee_id)` WHERE active |
| `idx_tasks_priority_status` | tasks | btree | `(priority, status)` |
| `idx_tasks_status` | tasks | btree | `(status)` |
| `idx_tasks_created_at` | tasks | btree | `(created_at DESC)` |
| `idx_task_comments_task` | task_comments | btree | `(task_id, created_at DESC)` |
| `idx_sessions_agent` | sessions | btree | `(agent_id, started_at DESC)` |
| `idx_sessions_active` | sessions | btree | `(agent_id)` WHERE active |
| `idx_messages_inbox` | messages | SQLite partial | `(to_agent, priority, id)` WHERE `read_at IS NULL` |
| `idx_messages_from` | messages | SQLite | `(from_agent, created_at)` — currently unused; to be dropped in migration_005 |
| `idx_messages_read_at` | messages | SQLite partial | `(read_at)` WHERE `read_at IS NOT NULL` — supports retention purge |
| `idx_announcements_recent` | announcements | btree | `(created_at DESC)` |
| `idx_announcements_pinned` | announcements | btree | `(pinned, created_at DESC)` WHERE pinned |
| `idx_company_mode_log_recent` | company_mode_log | btree | `(effective_at DESC)` |
| `idx_audit_log_recent` | audit_log | btree | `(created_at DESC)` |
| `idx_audit_log_actor` | audit_log | btree | `(actor_id, created_at DESC)` |
| `idx_audit_log_entity` | audit_log | btree | `(entity_type, entity_id, created_at DESC)` |
| `idx_audit_log_details` | audit_log | gin | `details` (JSONB) |
| `idx_request_metrics_endpoint_time` | request_metrics | btree | `(endpoint, recorded_at DESC)` |
| `idx_request_metrics_recent` | request_metrics | btree | `(recorded_at DESC)` |
| `idx_request_metrics_errors` | request_metrics | btree | `(recorded_at DESC)` WHERE errors |

---

## Known Gaps & Migration Roadmap

| Gap | Impact | Migration | Owner | Status |
|-----|--------|-----------|-------|--------|
| `tasks.assignee` is name string in file system; `tasks.assignee_id` is UUID FK in DB | Tasks imported from task_board.md won't have assignee_id populated | migration_003 | Pat + Bob | Planned |
| ~~Bob's task_status enum missing `in_review`, `cancelled`~~ | ~~API will fail or silently truncate transitions~~ | Bob code fix | Bob | **FIXED (Bob Session 8)** — all 6 values validated |
| ~~`PATCH /api/tasks/:id` doesn't set `completed_at` on status→done~~ | ~~Will violate `tasks_completed_at_check` constraint~~ | Bob code fix | Bob | **FIXED (Bob Session 7)** — auto-sets on done |
| ~~Bob's `getTaskMetrics()` byStatus map missing `blocked`, `in_review`, `cancelled`~~ | ~~Metrics API returns incomplete status counts~~ | Bob code fix | Bob | **FIXED (Bob Session 8)** — all 6 statuses included |
| ~~Title whitespace validation gap — `title = "   "` passes Joi but fails DB CHECK~~ | ~~Constraint violation on insert~~ | Bob code fix | Bob | **FIXED (Bob Session 8)** — whitespace trimmed in validator |
| ~~AgentMetrics is in-memory only; data lost on restart~~ | ~~No durable request telemetry~~ | migration_002 (done) + Bob integration | Bob + Pat | **FIXED (Bob Session 8)** — `backend/metrics_queue.jsonl` captures all requests; `backend/db_sync.js` drains to `request_metrics` table when `pg` + DB available |
| ~~No PostgreSQL instance provisioned~~ | ~~Cannot execute any migrations~~ | Eve to provision PostgreSQL 15+ | Eve | **RESOLVED (2026-03-29)** — Eve provisioned PG 15 via docker-compose |
