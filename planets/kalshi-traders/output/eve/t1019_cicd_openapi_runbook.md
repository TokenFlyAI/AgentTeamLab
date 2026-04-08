# T1019 — CI/CD for Phase A Schema-Versioned API Endpoints

**Agent:** Eve (Infra Engineer)
**Task ID:** T1019
**Sprint:** Sprint 9
**Date:** 2026-04-07
**Status:** Delivered

---

## Deliverables

| File | Purpose |
|------|---------|
| `scripts/validate_openapi.sh` | Entrypoint: syntax lint + structural validation + breaking-change diff |
| `scripts/openapi_diff.py` | Breaking-change detector (removed paths, new required params, type changes, removed schemas) |
| `.github/workflows/ci.yml` | Updated: added `validate-openapi` job (Job 4) |

---

## Run Commands

### Validate spec syntax + structure
```bash
bash scripts/validate_openapi.sh agents/mia/output/openapi_spec.yaml
```
Exit 0 = pass. Exit 1 = structural error.

### Validate + check for breaking changes vs baseline
```bash
bash scripts/validate_openapi.sh agents/mia/output/openapi_spec_v2.yaml \
    --baseline agents/mia/output/openapi_spec.yaml
```
Exit 0 = pass. Exit 1 = structural error. Exit 2 = breaking change detected.

### Run just the diff script directly
```bash
python3 scripts/openapi_diff.py <baseline.yaml> <candidate.yaml>
```

---

## What the CI Job Does (`.github/workflows/ci.yml` Job 4)

1. **Every push/PR**: Runs `validate_openapi.sh` for syntax + structure check.
2. **PRs only**: Fetches the target branch's version of the spec as baseline, diffs for breaking changes. Blocks merge if breaking changes found.
3. **Direct pushes to main**: Diffs HEAD vs HEAD~1 for the spec file. Warns on breaking changes.

Handles the "first-time spec" case — if no baseline exists on the target branch, diff is skipped with an informational message (not a failure).

---

## Breaking Changes Detected

The diff script flags:

| Category | Example |
|----------|---------|
| Removed operation | `DELETE /api/tasks/{id}` removed |
| Removed path | `/api/health` path block deleted |
| New required parameter | Added `?version=` as required query param to `GET /api/agents` |
| Response field type change | `tasks[].status`: `string` → `integer` |
| Removed required response field | `id` removed from `GET /api/agents` 200 response |
| Removed component schema | `#/components/schemas/TaskStatus` deleted |

Non-breaking changes (allowed, logged as INFO/WARN):

- Adding new paths/operations
- Removing optional response fields
- Loosening required → optional on existing params
- Updating descriptions/examples

---

## Integration with T1008 (Mia — Schema Versioning)

Mia's T1008 versioned spec should be saved at:
```
agents/mia/output/openapi_spec.yaml   ← always the latest/canonical
```

When Mia releases a new version (e.g. `openapi_spec_v2.yaml`), run:
```bash
bash scripts/validate_openapi.sh agents/mia/output/openapi_spec_v2.yaml \
    --baseline agents/mia/output/openapi_spec.yaml
```

If it passes (exit 0), replace the canonical spec and commit. The CI job on the PR will perform the same check automatically.

---

## Verification (Re-verified 2026-04-07 Cycle 3)

```
$ bash scripts/validate_openapi.sh agents/mia/output/openapi_spec.yaml
=== OpenAPI Validation: agents/mia/output/openapi_spec.yaml ===
[PASS] YAML syntax valid
[PASS] Structure valid — 74 paths, 84 operations
[PASS] All checks passed
Exit: 0

$ bash scripts/validate_openapi.sh /tmp/openapi_broken.yaml \
    --baseline agents/mia/output/openapi_spec.yaml
[PASS] YAML syntax valid
[PASS] Structure valid — 73 paths, 83 operations
[FAIL] 2 BREAKING change(s) detected:
       ✗ REMOVED operation: GET /api/config
       ✗ NEW required param 'required_new' (in: query) on GET /api/health
Exit: 2
```

**C20 metadata:** task_id=T1019, agent=eve, verified=2026-04-07T15:10:00, sprint=9
