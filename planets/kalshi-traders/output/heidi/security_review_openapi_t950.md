# T1012 — Security Review: OpenAPI Spec (T950)

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-04-07
**Spec:** `agents/mia/output/openapi_spec.yaml` (2388 lines, 74 endpoints)
**Verdict: PASS — spec is security-sound. 3 recommendations, 0 blockers.**

---

## Auth Coverage — PASS

**Only `/api/health` and `/api/events` are unauthenticated (security: []). All 72 other endpoints inherit the global `BearerAuth` requirement.**

This matches the stated policy in the spec description and aligns with C2. Verified programmatically — no hidden `security: []` overrides on sensitive endpoints.

High-privilege endpoints confirmed as authenticated:
- `POST /api/ceo/command` — requires Bearer ✅
- `POST /api/broadcast` — requires Bearer ✅
- `POST /api/mode` — requires Bearer ✅
- `POST /api/smart-run/start` / `stop` — requires Bearer ✅
- `PATCH /api/agents/{name}/persona` — requires Bearer ✅
- `POST /api/planets/switch` — requires Bearer ✅

---

## Sensitive Data Exposure — PASS

No response schemas expose credentials, API keys, secrets, or PII. Scanned all `properties` definitions — no `password`, `secret`, `api_key`, `token` fields in response schemas.

---

## Findings & Recommendations

### REC-1: `/api/agents/{name}/persona` — Missing `maxLength` on `content` field (LOW)

**Location:** Line ~909, `PATCH /api/agents/{name}/persona` request schema

**Issue:** The `content` field (full persona replacement) has no `maxLength` constraint. An authenticated caller could POST arbitrarily large content, potentially exhausting disk or causing slow writes.

**Recommendation:**
```yaml
content:
  type: string
  maxLength: 50000  # ~50KB cap — reasonable for a persona file
```

### REC-2: `/api/agents/{name}/persona/note` — Missing `maxLength` on `note` field (LOW)

**Location:** Line ~884, `POST /api/agents/{name}/persona/note` request schema

Same issue as REC-1: unbounded string input on a file-write endpoint.

**Recommendation:**
```yaml
note:
  type: string
  maxLength: 5000
```

### REC-3: `/api/ceo/command` — `command` field has `maxLength: 1000` but no `minLength` or `pattern` (INFO)

**Location:** Line ~1731

**Observation:** The 1000-char limit is good. Consider adding `minLength: 1` to prevent empty command submission (currently would route to alice's inbox as an empty Founder-priority message).

**Recommendation:**
```yaml
command:
  type: string
  minLength: 1
  maxLength: 1000
```

---

## Positive Findings

1. **Global security default is correct** — `security: [BearerAuth: []]` at top level, with only explicit `security: []` overrides for `/health` and `/events`. This is the right pattern — fail-secure by default.

2. **`AgentName` uses a restrictive pattern** — `^[a-zA-Z0-9_-]+$` on all `{name}` path parameters prevents path traversal via agent name (e.g., `../etc/passwd`). Well done.

3. **`ExecutorType` is an enum** — Limits agent executor to known values (`claude`, `kimi`, `codex`, `gemini`). Prevents arbitrary executor injection.

4. **`TaskStatus` and `TaskPriority` are enums** — Constrains task state machine inputs. Prevents invalid state transitions at the API boundary.

5. **CEO command has `maxLength: 1000`** — Prevents abuse of the highest-privilege routing endpoint.

6. **401/403 responses documented** — All POST/PATCH endpoints document auth failure codes, confirming auth is expected to be enforced.

---

## Summary

| Check | Result |
|-------|--------|
| Auth coverage (72/74 endpoints protected) | ✅ PASS |
| No sensitive fields in response schemas | ✅ PASS |
| High-privilege endpoints authenticated | ✅ PASS |
| AgentName path traversal protection | ✅ PASS |
| Enum constraints on enumerables | ✅ PASS |
| maxLength on persona write endpoints | ⚠️ Missing (REC-1/2) |
| minLength on CEO command | ℹ️ Optional (REC-3) |

**No blockers. Spec is approved for Sprint 9 schema versioning work (T1008).**
