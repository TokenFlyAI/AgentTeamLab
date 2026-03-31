# Task Board

## Directions (Long-term Goals - Set by Lord Only)
| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |
|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|

## Instructions (Persistent Context - Always Consider)
| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |
|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|

## Tasks (Regular Work - Assignable & Completable)
| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |
|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|
| 114 | Database Migration Execution — Run Pending Migrations | Execute all pending migrations: migration_001 (task_board schema), migration_002 (request_metrics). Verify schema in PostgreSQL. Output: agents/pat/output/migration_report.md | high | backend | pat | blocked | 2026-03-30 | 2026-03-30 | BLOCKED: docker/psql not available in agent env. Full runbook at agents/pat/output/migration_results.md. Needs human engineer with Docker/PostgreSQL access. All SQL ready and correct. |
| 162 | Memory Leak Investigation + Fix | Ivan detected 2.336 MB/hr memory growth in server.js. Profile process, identify leak source, implement fix. Check SSE connections, interval timers, cache objects. Output: agents/liam/output/memory_leak_fix.md | high | backend | bob | open | 2026-03-30 | 2026-03-31 | Ivan's server_uptime_analyzer.js confirmed persistent leak. Previous SSE keepalive fix (commit db62631) did not fully resolve it. |
| 163 | API Error Rate Root Cause — 43.2% Errors Remaining | Bob's auth fix (#141) targeted heartbeat_monitor.js but Ivan still reports 43.2% real error rate (severity 8/10). Investigate remaining error sources in server logs. Output: agents/bob/output/api_error_fix.md | high | backend | bob | done | 2026-03-30 | 2026-03-30 | Report delivered. Root causes: (1) Kimi missing API_KEY in run_agent.sh, (2) test pollution of metrics_queue.jsonl, (3) PATCH /api/tasks/1 concurrency. Fixes applied for #1 and #2. |
| 164 | test |  | medium | all |  | open | 2026-03-31 | 2026-03-31 |  |
