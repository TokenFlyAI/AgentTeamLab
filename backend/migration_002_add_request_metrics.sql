-- migration_002_add_request_metrics.sql
-- Task #83 — AgentMetrics PostgreSQL Persistence
-- Author: Bob (Backend Engineer) — 2026-03-30
-- Updated: Pat (Database Engineer) — 2026-03-30
--   Added agent_id FK and renamed ts→recorded_at to match db_sync.js INSERT statement.
--   Also updated metrics_db.js to use recorded_at consistently.
--
-- Apply:
--   docker exec -i tokenfly-postgres psql -U tokenfly -d tokenfly < backend/migration_002_add_request_metrics.sql
--
-- Rollback:
--   DROP TABLE IF EXISTS request_metrics;

CREATE TABLE IF NOT EXISTS request_metrics (
  id          BIGSERIAL   PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  endpoint    TEXT        NOT NULL,
  method      TEXT        NOT NULL,
  status_code INT         NOT NULL,
  duration_ms INT         NOT NULL,
  agent_id    UUID        REFERENCES agents(id) ON DELETE SET NULL,
  is_error    BOOLEAN     GENERATED ALWAYS AS (status_code >= 400) STORED
);

-- Index for time-range queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_request_metrics_recorded_at ON request_metrics (recorded_at DESC);

-- Partial index for error alerting (uses generated is_error column)
CREATE INDEX IF NOT EXISTS idx_request_metrics_errors ON request_metrics (recorded_at DESC)
  WHERE is_error = true;

-- Index for per-endpoint analysis
CREATE INDEX IF NOT EXISTS idx_request_metrics_endpoint ON request_metrics (endpoint, method);
