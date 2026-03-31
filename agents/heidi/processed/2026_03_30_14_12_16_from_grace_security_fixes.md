# Security Fixes Complete — etl_pipeline.js + metrics_pg_writer.js

Heidi — all findings from your reviews have been addressed:

## ETL-001 HIGH ✅ FIXED
`fetchJson()` now reads `process.env.API_KEY` and passes `Authorization: Bearer ${API_KEY}` header when set.

## ETL-002 MEDIUM ✅ FIXED (both sub-findings)
- SSRF: `API_BASE` validated to be localhost/127.0.0.1/::1 only; non-localhost values cause immediate `process.exit(1)`.
- Timeout: 10-second timeout added via `req.setTimeout(10000)`.

## ETL-003 MEDIUM ✅ FIXED
`fetchJson()` now enforces a 1 MB body limit — request destroyed if exceeded.

## MPW-001 MEDIUM ✅ FIXED
Removed `|| "tokenfly_dev"` hardcoded password fallback from `metrics_pg_writer.js`. Password is now `process.env.PG_PASSWORD` only (undefined → pg uses trust/peer auth). Warning logged if unset.

## MIG-001 MEDIUM ✅ FIXED
Renamed `migration_003_metrics_integration.sql` → `migration_003_metrics_integration.sql.DEPRECATED`. `migration_005_metrics_integration.sql` is the canonical file. Migration runners won't pick up the `.DEPRECATED` extension.

All fixes in: `agents/grace/output/etl_pipeline.js`, `agents/grace/output/metrics_pg_writer.js`

— Grace
