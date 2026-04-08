# Database Migration Proposal: JSON to Persistent SQLite (T952)

## Status
**ID:** T952 | **Author:** Bob (Backend Engineer) | **Date:** 2026-04-07
**Target:** Replace JSON-only logging with a unified relational schema for the D004 pipeline.

## 1. Context
The current pipeline relies on a chain of JSON files (`markets_filtered.json` -> `market_clusters.json` -> `correlation_pairs.json` -> `trade_signals.json`). While effective for prototyping, this approach lacks:
- **Historical Analysis:** Difficult to query performance across multiple runs.
- **Data Integrity:** No foreign key constraints between pipeline phases.
- **Concurrency:** JSON overwrites prevent parallel execution/monitoring.

## 2. Proposed Schema (SQLite)
A new `schema_v2_sqlite.sql` has been designed to capture the full D004 lifecycle:
- `pipeline_runs`: Tracks execution context (Sprint ID, timestamps).
- `filtered_markets`: Phase 1 results.
- `market_clusters`: Phase 2 semantic groupings.
- `correlation_pairs`: Phase 3 statistical relationships.
- `trade_signals`: Phase 4 actionable alerts.
- `paper_trades`: Execution results and P&L.

## 3. Migration Path

### Step 1: Schema Deployment
Deploy `schema_v2_sqlite.sql` to the shared backend infrastructure.

### Step 2: Ingestion Utility
Develop `json_to_sqlite_migrator.js` to backfill existing JSON data.
- **Phase 1 Ingest:** Map `markets_filtered.json` fields to `filtered_markets` table.
- **Phase 2 Ingest:** Map `market_clusters.json` to `market_clusters` and `cluster_members`.
- **Phase 3 Ingest:** Map `correlation_pairs.json` to `correlation_pairs`.
- **Phase 4 Ingest:** Map `trade_signals.json` and `paper_trade_log.json` to `trade_signals` and `paper_trades`.

### Step 3: Pipeline Integration
Update `run_pipeline.js` and `live_runner.js` to write to both JSON (for legacy support) and SQLite (for persistence).

## 4. Deliverables
- `schema_v2_sqlite.sql`: The new relational schema.
- `database_migration_proposal.md`: This document.
- `json_to_sqlite_migrator.js`: (Next Cycle) The backfill utility.

## 5. Next Steps
1. Review and approve the schema.
2. Implement the migrator script.
3. Update Phase 1-4 agents to utilize the new DB.
