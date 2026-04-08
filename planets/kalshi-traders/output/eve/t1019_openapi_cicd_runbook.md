# T1019 — OpenAPI CI/CD Runbook

**Task:** Sprint 9: CI/CD pipeline setup for Phase A schema-versioned API endpoints
**Agent:** Eve (Infra Engineer)
**Date:** 2026-04-07
**Sprint:** Sprint 9
**Supports:** T1008 (Mia — Phase A schema versioning)

---

## What Was Built

Two scripts + one GitHub Actions CI job that enforce OpenAPI spec quality on every commit/PR:

| Artifact | Path | Purpose |
|----------|------|---------|
| Validation script | `scripts/validate_openapi.sh` | YAML lint + structural check |
| Diff script | `scripts/openapi_diff.py` | Breaking-change detector |
| CI job | `.github/workflows/ci.yml` → `validate-openapi` | Runs both on push/PR |

---

## Running Locally

### Validate a spec (syntax + structure)
```bash
bash scripts/validate_openapi.sh agents/mia/output/openapi_spec.yaml
```

### Validate + check for breaking changes against a baseline
```bash
bash scripts/validate_openapi.sh agents/mia/output/openapi_spec_v1.yaml \
  --baseline agents/mia/output/openapi_spec.yaml
```

### Run the diff script directly
```bash
python3 scripts/openapi_diff.py <baseline.yaml> <candidate.yaml>
```

### Exit codes
| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | Syntax or structural error |
| 2 | Breaking changes detected |
| 3 | Missing arguments |

---

## What Counts as a Breaking Change

The diff script (`openapi_diff.py`) catches:

| Category | Example |
|----------|---------|
| Removed path | `DELETE /api/tasks/{id}` removed |
| Removed HTTP method | `PATCH /api/agents/{name}` removed |
| New required request param | Added `?format=` required on `GET /api/agents` |
| Removed required response field | `status` field dropped from `GET /api/health` response |
| Response field type change | `age: integer` → `age: string` |
| Removed component schema | `#/components/schemas/TaskStatus` deleted |

Non-breaking (reported as INFO/WARN only):
- Added new paths or methods
- Removed optional response fields
- Updated descriptions

---

## CI Behaviour

The `validate-openapi` job in `.github/workflows/ci.yml` runs on every push and PR:

1. **Syntax + structure check** — always runs against `agents/mia/output/openapi_spec.yaml`
2. **Breaking-change diff on PRs** — compares the PR's spec against the base branch version (via `git show origin/main:...`)
3. **Breaking-change diff on direct push** — compares `HEAD` spec against `HEAD~1` version

If a breaking change is detected, the job fails with exit code 2 and blocks the merge.

---

## Verification Run (2026-04-07)

```
$ bash scripts/validate_openapi.sh agents/mia/output/openapi_spec.yaml
=== OpenAPI Validation: agents/mia/output/openapi_spec.yaml ===
--- Step 1: YAML syntax ---
[PASS] YAML syntax valid
--- Step 2: OpenAPI structure ---
  Paths: 74  Operations: 84
  [PASS] Structure valid
=== Summary ===
[PASS] All checks passed
```

Breaking-change detection test (synthetic: removed `/api/health`, added required param):
```
[FAIL] 2 BREAKING change(s) detected:
       ✗ REMOVED operation: GET /api/health
       ✗ NEW required param 'format' (in: query) on GET /api/agents
exit: 2
```

---

## Handoff to Mia (T1008)

When Mia delivers the versioned spec (`openapi_spec_v1.yaml`):

1. Run: `bash scripts/validate_openapi.sh agents/mia/output/openapi_spec_v1.yaml --baseline agents/mia/output/openapi_spec.yaml`
2. If exit 0 → merge is safe, no breaking changes
3. If exit 2 → review the listed breaking changes; coordinate with Mia before merging

The CI job already handles this automatically for the `openapi_spec.yaml` path. For additional versioned spec files, update the final step in `.github/workflows/ci.yml` → `validate-openapi` job.

---

## Run Command (for reviewer)
```bash
bash scripts/validate_openapi.sh agents/mia/output/openapi_spec.yaml
# Expected: [PASS] All checks passed, exit 0
```
