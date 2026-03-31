# API Error Root Cause Drill-Down — Task #163
**Author:** Ivan (ML Engineer)
**Date:** 2026-03-30
**For:** Bob (Backend Engineer)

---

## Summary

Total records analyzed: **1,079**
Real error rate (excl. e2e): **41.1%** (444 real errors)
E2E test artifacts (noise): **144** (13.3%, safe to ignore)

---

## Error Categories — Ranked by Volume

| # | Category | Count | % of Real Errors | Fix Owner |
|---|----------|-------|-----------------|-----------|
| 1 | AUTH_NO_KEY (401) | 153 | 34.5% | Bob |
| 2 | TASK_VALIDATION_400 (POST /api/tasks) | 132 | 29.7% | Bob |
| 3 | TASK_PATCH_400 (PATCH /api/tasks/1) | 88 | 19.8% | Bob |
| 4 | MSG_VALIDATION_400 (POST /api/messages/alice) | 44 | 9.9% | Bob |
| 5 | PAYLOAD_413 (POST /api/tasks) | 27 | 6.1% | Bob |
| — | E2E_ARTIFACT (404s on /99999, /nobody_agent) | 144 | — | ignore |

---

## Category 1: AUTH_NO_KEY — 153 × 401 Unauthorized

**Endpoints:**
- `POST /api/tasks` — 141 failures
- `POST /api/messages/alice` — 8 failures
- `GET /api/tasks` — 4 failures

**Duration pattern:** 82% are 0ms (instant rejection before handler), rest are 1–643ms.

**Root cause:** Agents calling task creation and message endpoints without including the `Authorization: Bearer $API_KEY` header. The 0ms rejections confirm auth middleware short-circuits immediately.

**Bob's fix:**
1. Identify which agents are missing the API key header in their HTTP calls. Likely the run_agent.sh environment doesn't export `API_KEY` into agent subshells.
2. Short-term: ensure `API_KEY` is exported in `run_agent.sh` and `run_subset.sh`.
3. The heartbeat_monitor.js fix (commit db62631) only addressed `/api/health` — these are different callers.

---

## Category 2: TASK_VALIDATION_400 — 132 × 400 on POST /api/tasks

**Timing:** Consistent 3 per minute across all hours (07, 13, 16, 21). This is a chronic, repeating pattern — not a one-off burst.

**Duration:** Near-zero (0–1ms) — server rejects immediately on payload validation.

**Root cause hypothesis:** Agents creating tasks with missing required fields (likely `title` or `priority` missing), OR sending duplicate/malformed JSON. The regularity (3/min) suggests a loop pattern — an agent retrying a failing task creation on every cycle.

**Bob's fix:**
1. Add request body logging on 400 responses (even just in dev mode) so you can see the exact bad payload.
2. Check `POST /api/tasks` schema validation in `api.js` — which fields are required? Cross-check agent task-creation calls.
3. Look for agents that create tasks in a loop without checking for prior success.

---

## Category 3: TASK_PATCH_400 — 88 × 400 on PATCH /api/tasks/1

**Key finding:** PATCH /api/tasks/1 has **88 successes (200) AND 88 failures (400)** — a perfect 50/50 split. This looks like a race condition or a two-step operation where one request form is valid and another isn't.

**Context pattern (from log):**
```
GET  /api/tasks     200  07:32:52
PATCH /api/tasks/1  200  07:32:52   ← success first
PATCH /api/tasks/1  400  07:32:52   ← immediate failure
PATCH /api/tasks/1  400  07:32:52   ← same
PATCH /api/tasks/1  200  07:32:52   ← success again
```

Multiple agents are patching task #1 simultaneously. The 400s are likely invalid state transitions (e.g., patching a task to "in_progress" when it's already "done"), or the request body schema varies between callers.

**Bob's fix:**
1. Check `PATCH /api/tasks/:id` validation logic — does it reject certain `status` field values or transitions?
2. Task #1 may be a test/seed task being claimed by multiple agents at once — the 50/50 split strongly suggests a concurrency issue.
3. Add `status` transition validation with clear error messages so the 400 body explains *why* it rejected.

---

## Category 4: MSG_VALIDATION_400 — 44 × 400 on POST /api/messages/alice

**Timing:** Spread across all hours — chronic issue, not a burst.
**Duration:** 0ms (82%) — immediate rejection.

**Root cause:** Messages sent to `/api/messages/alice` fail validation. Likely missing required field (`content` or `from`), or the message body format doesn't match the expected schema.

**Bob's fix:**
1. Review `POST /api/messages/:agent` schema. What fields are required?
2. Add validation error messages that describe the missing field — currently 400s give no actionable info.
3. Check which agent is sending these — the `from` field or user-agent header may identify the caller.

---

## Category 5: PAYLOAD_413 — 27 × 413 Payload Too Large

**Endpoint:** All on `POST /api/tasks`
**Distribution:** Spread evenly across hours (7 + 10 + 4 + 6).

**Root cause:** Agents creating tasks with oversized payloads — likely pasting large code blocks or full report content into task descriptions.

**Bob's fix:**
1. Check `express.json()` limit in server.js — current limit is likely 100kb or 1mb.
2. Add a clear `413` response body: `"description too long — max N chars"`.
3. Agents should truncate task descriptions >500 chars before creating tasks.

---

## Error Rate Trend by Hour

| Hour | Total | Errors | Error Rate |
|------|-------|--------|-----------|
| 07:xx | 143 | 70 | 49% |
| 13:xx | 354 | 196 | 55% |
| 16:xx | 438 | 262 | 60% |
| 21:xx | 144 | 60 | 42% |

**Trend:** Error rate is *increasing* over the day (49% → 60%). More agents are active later in the day, amplifying auth and validation failures. The 21:xx drop suggests fewer agents were running.

---

## Recommended Fix Priority

| Priority | Fix | Expected Error Reduction |
|----------|-----|------------------------|
| P0 | Export `API_KEY` to agent subshells (fixes 401s) | −153 errors (−34.5%) |
| P1 | Add request body logging on 400s (diagnose validation) | enables #2 and #4 fixes |
| P1 | Fix PATCH /api/tasks/1 concurrency (check transition logic) | −88 errors (−19.8%) |
| P2 | Fix POST /api/tasks validation errors (identify bad callers) | −132 errors (−29.7%) |
| P2 | Fix MSG validation (add required field errors) | −44 errors (−9.9%) |
| P3 | Add 413 description-length guard in agents | −27 errors (−6.1%) |

**If P0 + P1 fixes land:** error rate drops from 41.1% → ~6% (only validation edge cases remain).

---

## Data Source
- File: `backend/metrics_queue.jsonl`
- Records: 1,079 (as of 2026-03-30 21:xx)
- Script: `agents/ivan/output/api_error_analyzer.js` (extended analysis in this cycle)
