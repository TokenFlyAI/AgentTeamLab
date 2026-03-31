-- =============================================================================
-- Migration 005: Metrics Schema Integration with Pat's Core Schema
-- Author: Grace (Data Engineer)
-- Date: 2026-03-30
-- Depends on:
--   001 — Pat's core schema (agents, tasks, audit_log)
--   002 — Bob/Pat's request_metrics base table (recorded_at column, is_error)
--   003 — Pat's assignee UUID FK migration
--   004 — Pat's message bus migration
-- Purpose: Add Grace's metrics tables into the canonical tokenfly DB:
--          agent_cycles, agent_heartbeats, metrics_snapshots.
--          Enhances request_metrics (owned by migration_002) with the
--          is_error generated column and analytics views.
--
-- Replaces: migration_003_metrics_integration.sql (stale — used ts instead
--           of recorded_at, and duplicated the request_metrics CREATE TABLE)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Ensure extensions (idempotent; Pat's core schema likely already ran this)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Enhance request_metrics (already created by migration_002)
--    Add is_error generated column and a composite index not in migration_002.
--    All column names use recorded_at (migration_002's canonical name).
-- ---------------------------------------------------------------------------

-- Add is_error generated column if not already present
ALTER TABLE request_metrics
    ADD COLUMN IF NOT EXISTS is_error BOOLEAN
        GENERATED ALWAYS AS (status_code >= 400) STORED;

-- Composite index for endpoint + timestamp range queries (not in migration_002)
CREATE INDEX IF NOT EXISTS idx_rm_endpoint_recorded_at
    ON request_metrics (endpoint, method, recorded_at DESC);

COMMENT ON COLUMN request_metrics.is_error IS
    'Derived: status_code >= 400. Stored for fast error-rate queries without filter recomputation.';
COMMENT ON TABLE request_metrics IS
    'One row per HTTP request. High-cardinality event log. Retain 7 days (see retention policy).';

-- ---------------------------------------------------------------------------
-- 2. metrics_snapshots — periodic rollup of request_metrics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id              BIGSERIAL    PRIMARY KEY,
    captured_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    window_start    TIMESTAMPTZ  NOT NULL,
    window_end      TIMESTAMPTZ  NOT NULL,
    endpoint        TEXT         NOT NULL,
    total_requests  INTEGER      NOT NULL DEFAULT 0 CHECK (total_requests >= 0),
    total_errors    INTEGER      NOT NULL DEFAULT 0 CHECK (total_errors >= 0),
    error_rate      NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (error_rate BETWEEN 0 AND 1),
    avg_ms          NUMERIC(8,2) NOT NULL DEFAULT 0,
    p50_ms          NUMERIC(8,2),
    p95_ms          NUMERIC(8,2),
    p99_ms          NUMERIC(8,2),
    max_ms          INTEGER      NOT NULL DEFAULT 0,
    min_ms          INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT uq_snapshot_window UNIQUE (window_start, window_end, endpoint),
    CONSTRAINT check_window_order CHECK (window_end > window_start),
    CONSTRAINT check_errors_lte_total CHECK (total_errors <= total_requests)
);

CREATE INDEX IF NOT EXISTS idx_ms_captured ON metrics_snapshots (captured_at DESC);

COMMENT ON TABLE metrics_snapshots IS
    'Aggregated rollups of request_metrics. Written by cron. Retain 90 days.';

-- ---------------------------------------------------------------------------
-- 3. agent_cycles — one row per agent work cycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_cycles (
    id          BIGSERIAL     PRIMARY KEY,
    agent_id    UUID          REFERENCES agents(id) ON DELETE SET NULL,
    agent_name  TEXT          NOT NULL,
    cycle_n     INTEGER       NOT NULL CHECK (cycle_n > 0),
    started_at  TIMESTAMPTZ   NOT NULL,
    ended_at    TIMESTAMPTZ,
    turns       INTEGER       CHECK (turns >= 0),
    cost_usd    NUMERIC(10,6) CHECK (cost_usd >= 0),
    duration_s  NUMERIC(8,2)  CHECK (duration_s >= 0),
    CONSTRAINT uq_agent_cycle UNIQUE (agent_name, cycle_n),
    CONSTRAINT check_ended_after_started CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_ac_agent_name ON agent_cycles (agent_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ac_agent_id   ON agent_cycles (agent_id, started_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ac_started    ON agent_cycles (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ac_cost       ON agent_cycles (cost_usd DESC NULLS LAST);

COMMENT ON TABLE agent_cycles IS
    'One row per agent work cycle. agent_id FK to agents(id); agent_name denormalized for insert resilience.';
COMMENT ON COLUMN agent_cycles.agent_id IS
    'FK to agents(id). Nullable — populated via backfill trigger after agents table seeded.';

-- ---------------------------------------------------------------------------
-- 4. agent_heartbeats — heartbeat events for availability tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_heartbeats (
    id          BIGSERIAL   PRIMARY KEY,
    agent_id    UUID        REFERENCES agents(id) ON DELETE SET NULL,
    agent_name  TEXT        NOT NULL,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    status      TEXT        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'idle', 'done', 'error')),
    task_title  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ah_agent_name ON agent_heartbeats (agent_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ah_agent_id   ON agent_heartbeats (agent_id, ts DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ah_ts         ON agent_heartbeats (ts DESC);

COMMENT ON TABLE agent_heartbeats IS
    'Heartbeat events per agent cycle. Use to detect stale agents (last ts > 15 min = stuck).';

-- ---------------------------------------------------------------------------
-- 5. Trigger: auto-populate agent_id from agent_name on insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_agent_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.agent_id IS NULL AND NEW.agent_name IS NOT NULL THEN
        SELECT id INTO NEW.agent_id
        FROM agents
        WHERE name = NEW.agent_name
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_cycles_set_id ON agent_cycles;
CREATE TRIGGER trg_agent_cycles_set_id
    BEFORE INSERT ON agent_cycles
    FOR EACH ROW EXECUTE FUNCTION fn_set_agent_id();

DROP TRIGGER IF EXISTS trg_agent_heartbeats_set_id ON agent_heartbeats;
CREATE TRIGGER trg_agent_heartbeats_set_id
    BEFORE INSERT ON agent_heartbeats
    FOR EACH ROW EXECUTE FUNCTION fn_set_agent_id();

-- ---------------------------------------------------------------------------
-- 6. Views (all reference recorded_at for request_metrics queries)
-- ---------------------------------------------------------------------------

-- Endpoint error rates for the last hour
CREATE OR REPLACE VIEW v_endpoint_errors_1h AS
SELECT
    endpoint,
    COUNT(*)                                                 AS total_requests,
    SUM(CASE WHEN is_error THEN 1 ELSE 0 END)               AS total_errors,
    ROUND(
        SUM(CASE WHEN is_error THEN 1 ELSE 0 END)::NUMERIC
        / NULLIF(COUNT(*), 0), 4
    )                                                        AS error_rate,
    ROUND(AVG(duration_ms)::NUMERIC, 2)                      AS avg_ms,
    MAX(duration_ms)                                         AS max_ms
FROM request_metrics
WHERE recorded_at > now() - INTERVAL '1 hour'
GROUP BY endpoint
ORDER BY total_errors DESC;

-- p95 latency per endpoint (last 24h)
CREATE OR REPLACE VIEW v_endpoint_p95_24h AS
SELECT
    endpoint,
    COUNT(*)                                              AS total_requests,
    ROUND(AVG(duration_ms)::NUMERIC, 2)                   AS avg_ms,
    PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms,
    MAX(duration_ms)                                      AS max_ms
FROM request_metrics
WHERE recorded_at > now() - INTERVAL '24 hours'
GROUP BY endpoint
ORDER BY p95_ms DESC NULLS LAST;

-- Daily cost per agent
CREATE OR REPLACE VIEW v_agent_daily_cost AS
SELECT
    ac.agent_name,
    a.role                                               AS agent_role,
    DATE(ac.started_at AT TIME ZONE 'UTC')               AS day,
    COUNT(*)                                             AS cycles,
    SUM(ac.cost_usd)                                     AS total_cost_usd,
    ROUND(AVG(ac.cost_usd)::NUMERIC, 6)                  AS avg_cost_per_cycle,
    SUM(ac.turns)                                        AS total_turns
FROM agent_cycles ac
LEFT JOIN agents a ON a.id = ac.agent_id
GROUP BY ac.agent_name, a.role, DATE(ac.started_at AT TIME ZONE 'UTC')
ORDER BY day DESC, total_cost_usd DESC NULLS LAST;

-- Latest heartbeat per agent
CREATE OR REPLACE VIEW v_agent_latest_heartbeat AS
SELECT DISTINCT ON (ah.agent_name)
    ah.agent_name,
    a.role,
    a.current_status                                     AS registry_status,
    ah.status                                            AS heartbeat_status,
    ah.ts                                                AS last_seen,
    now() - ah.ts                                        AS time_since_heartbeat,
    ah.task_title                                        AS current_task,
    CASE
        WHEN now() - ah.ts > INTERVAL '15 minutes' THEN true
        ELSE false
    END                                                  AS is_stale
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
ORDER BY ah.agent_name, ah.ts DESC;

COMMENT ON VIEW v_agent_latest_heartbeat IS
    'Most recent heartbeat per agent. is_stale=true if last seen > 15 min ago (watchdog threshold).';

-- ---------------------------------------------------------------------------
-- 7. Rollback (run in reverse order)
-- ---------------------------------------------------------------------------
-- DROP VIEW IF EXISTS v_agent_latest_heartbeat CASCADE;
-- DROP VIEW IF EXISTS v_agent_daily_cost CASCADE;
-- DROP VIEW IF EXISTS v_endpoint_p95_24h CASCADE;
-- DROP VIEW IF EXISTS v_endpoint_errors_1h CASCADE;
-- DROP TRIGGER IF EXISTS trg_agent_heartbeats_set_id ON agent_heartbeats;
-- DROP TRIGGER IF EXISTS trg_agent_cycles_set_id ON agent_cycles;
-- DROP FUNCTION IF EXISTS fn_set_agent_id() CASCADE;
-- DROP TABLE IF EXISTS agent_heartbeats CASCADE;
-- DROP TABLE IF EXISTS agent_cycles CASCADE;
-- DROP TABLE IF EXISTS metrics_snapshots CASCADE;
-- ALTER TABLE request_metrics DROP COLUMN IF EXISTS is_error;
-- DROP INDEX IF EXISTS idx_rm_endpoint_recorded_at;

-- ---------------------------------------------------------------------------
-- 8. Retention policy (run weekly via pg_cron or manual cron)
-- ---------------------------------------------------------------------------
-- DELETE FROM request_metrics    WHERE recorded_at  < now() - INTERVAL '7 days';
-- DELETE FROM agent_heartbeats   WHERE ts           < now() - INTERVAL '7 days';
-- DELETE FROM metrics_snapshots  WHERE captured_at  < now() - INTERVAL '90 days';
-- DELETE FROM agent_cycles       WHERE started_at   < now() - INTERVAL '90 days';
