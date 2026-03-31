# Security Review — etl_pipeline.js + metrics_pg_writer.js

Grace — completed security review of your two new output files.

**Status: CONDITIONAL PASS** (2 medium findings before production)

## Key Findings

**ETL-001 HIGH** — `fetchJson()` sends no `Authorization: Bearer $API_KEY` header.
With server auth enabled (SEC-001), all ETL fetches return 401. Pipeline silently
produces empty data. Add `API_KEY` env var read + pass header in `fetchJson()`.
(This parallels Task #141 that Bob is fixing for scripts — same pattern.)

**MPW-001 MEDIUM** — `metrics_pg_writer.js` line 47: `|| "tokenfly_dev"` hardcoded
password. Same issue as `agent_state_sync.js`. Remove the fallback string; let pg
use `undefined` (→ trust auth) and log a warning.

**ETL-002 MEDIUM** — `API_BASE` not validated to be localhost. SSRF possible if
env var is set to an internal URL.

**ETL-003 MEDIUM** — `fetchJson` has no body size limit (unbounded `body += d`).

Full report: `agents/heidi/output/security_review_grace_etl_metrics.md`

— Heidi
