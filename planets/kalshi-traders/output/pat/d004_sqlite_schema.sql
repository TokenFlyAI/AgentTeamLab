-- D004 Pipeline SQLite Schema
-- Author: Pat (Database Engineer)
-- Task: T962 — JSON-to-SQLite migrator and database triggers for D004 persistence
-- Date: 2026-04-07
-- Covers all 4 D004 phases + paper trades + migration audit log

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;    -- WAL mode for concurrent reads during pipeline writes
PRAGMA synchronous = NORMAL;  -- Safe with WAL

-- =============================================================================
-- Phase 1: Filtered Markets
-- Source: markets_filtered.json (Grace)
-- =============================================================================
CREATE TABLE IF NOT EXISTS d004_filtered_markets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker          TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    volume          INTEGER NOT NULL CHECK (volume > 0),
    yes_bid         INTEGER CHECK (yes_bid IS NULL OR (yes_bid >= 0 AND yes_bid <= 100)),
    yes_ask         INTEGER CHECK (yes_ask IS NULL OR (yes_ask >= 0 AND yes_ask <= 100)),
    no_bid          INTEGER CHECK (no_bid  IS NULL OR (no_bid  >= 0 AND no_bid  <= 100)),
    no_ask          INTEGER CHECK (no_ask  IS NULL OR (no_ask  >= 0 AND no_ask  <= 100)),
    yes_ratio       REAL,
    recommendation  TEXT CHECK (recommendation IN ('proceed_to_clustering', 'hold', 'reject') OR recommendation IS NULL),
    source_file     TEXT NOT NULL,
    pipeline_run_id TEXT NOT NULL,         -- links rows from same pipeline run
    generated_at    TEXT NOT NULL,         -- from JSON generated_at field
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fm_ticker       ON d004_filtered_markets(ticker);
CREATE INDEX IF NOT EXISTS idx_fm_volume       ON d004_filtered_markets(volume);
CREATE INDEX IF NOT EXISTS idx_fm_pipeline_run ON d004_filtered_markets(pipeline_run_id);

CREATE TRIGGER IF NOT EXISTS trg_fm_updated_at
AFTER UPDATE ON d004_filtered_markets
BEGIN
    UPDATE d004_filtered_markets SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- Phase 2: Market Clusters
-- Source: market_clusters.json (Ivan)
-- =============================================================================
CREATE TABLE IF NOT EXISTS d004_clusters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id      TEXT NOT NULL,         -- e.g. 'cluster_1', 'singleton_KXETH-...'
    label           TEXT NOT NULL,
    strength        REAL CHECK (strength  >= 0 AND strength  <= 1),
    confidence      REAL CHECK (confidence >= 0 AND confidence <= 1),
    stability       REAL CHECK (stability  >= 0 AND stability  <= 1),
    cohesion        REAL CHECK (cohesion   >= 0 AND cohesion   <= 1),
    separation      REAL,
    avg_volatility  REAL,
    avg_sentiment   REAL,
    cross_category  INTEGER NOT NULL DEFAULT 0 CHECK (cross_category IN (0, 1)),  -- boolean
    description     TEXT,
    source_file     TEXT NOT NULL,
    pipeline_run_id TEXT NOT NULL,
    generated_at    TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    UNIQUE (cluster_id, pipeline_run_id)
);

-- Cluster members: which tickers belong to each cluster
CREATE TABLE IF NOT EXISTS d004_cluster_members (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id      TEXT NOT NULL,
    pipeline_run_id TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    is_uncertain    INTEGER NOT NULL DEFAULT 0 CHECK (is_uncertain IN (0, 1)),
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (cluster_id, pipeline_run_id)
        REFERENCES d004_clusters(cluster_id, pipeline_run_id) ON DELETE CASCADE,
    UNIQUE (cluster_id, pipeline_run_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_cl_run        ON d004_clusters(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_cl_confidence ON d004_clusters(confidence);
CREATE INDEX IF NOT EXISTS idx_cm_run_ticker ON d004_cluster_members(pipeline_run_id, ticker);

CREATE TRIGGER IF NOT EXISTS trg_cl_updated_at
AFTER UPDATE ON d004_clusters
BEGIN
    UPDATE d004_clusters SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- Phase 3: Correlation Pairs
-- Source: correlation_pairs.json (Bob)
-- =============================================================================
CREATE TABLE IF NOT EXISTS d004_correlation_pairs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id            TEXT NOT NULL,
    market_a              TEXT NOT NULL,
    market_b              TEXT NOT NULL,
    pearson_correlation   REAL NOT NULL CHECK (pearson_correlation >= -1 AND pearson_correlation <= 1),
    expected_spread       REAL,
    current_spread        REAL,
    spread_deviation      REAL,
    arbitrage_confidence  REAL CHECK (arbitrage_confidence IS NULL OR
                                      (arbitrage_confidence >= 0 AND arbitrage_confidence <= 1)),
    direction             TEXT CHECK (direction IN ('buy_A_sell_B', 'sell_A_buy_B', 'neutral') OR direction IS NULL),
    is_arbitrage_opportunity INTEGER NOT NULL DEFAULT 0 CHECK (is_arbitrage_opportunity IN (0, 1)),
    source_file           TEXT NOT NULL,
    pipeline_run_id       TEXT NOT NULL,
    generated_at          TEXT NOT NULL,
    created_at            TEXT DEFAULT (datetime('now')),
    updated_at            TEXT DEFAULT (datetime('now')),
    UNIQUE (market_a, market_b, pipeline_run_id)
);

CREATE INDEX IF NOT EXISTS idx_cp_run          ON d004_correlation_pairs(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_cp_arb          ON d004_correlation_pairs(is_arbitrage_opportunity);
CREATE INDEX IF NOT EXISTS idx_cp_correlation  ON d004_correlation_pairs(pearson_correlation);
CREATE INDEX IF NOT EXISTS idx_cp_market_a     ON d004_correlation_pairs(market_a);
CREATE INDEX IF NOT EXISTS idx_cp_market_b     ON d004_correlation_pairs(market_b);

CREATE TRIGGER IF NOT EXISTS trg_cp_updated_at
AFTER UPDATE ON d004_correlation_pairs
BEGIN
    UPDATE d004_correlation_pairs SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- Phase 4: Trade Signals & Paper Trades
-- Source: trade_signals.json, trade_log.json (Dave/Bob)
-- =============================================================================
CREATE TABLE IF NOT EXISTS d004_trade_signals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id       TEXT NOT NULL,          -- e.g. 'trade_1', 'signal_abc'
    trade_timestamp TEXT NOT NULL,
    market_a        TEXT NOT NULL,
    market_b        TEXT,                   -- NULL for single-market signals
    cluster_id      TEXT,
    correlation     REAL CHECK (correlation IS NULL OR (correlation >= -1 AND correlation <= 1)),
    direction       TEXT NOT NULL CHECK (direction IN ('buy_A_sell_B', 'sell_A_buy_B', 'yes', 'no', 'hold',
                                                       'YES', 'NO', 'HOLD', 'long', 'short')),
    contracts       INTEGER NOT NULL CHECK (contracts > 0),
    entry_price     INTEGER NOT NULL CHECK (entry_price >= 0 AND entry_price <= 100),
    confidence      REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    outcome         TEXT CHECK (outcome IN ('win', 'loss', 'breakeven', 'pending', 'WIN', 'LOSS', 'BREAKEVEN', 'PENDING') OR outcome IS NULL),
    pnl_cents       REAL,
    pnl_dollars     REAL,
    mode            TEXT DEFAULT 'paper_trading',
    source_file     TEXT NOT NULL,
    pipeline_run_id TEXT NOT NULL,
    generated_at    TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    UNIQUE (signal_id, pipeline_run_id)
);

CREATE INDEX IF NOT EXISTS idx_ts_run       ON d004_trade_signals(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_ts_market_a  ON d004_trade_signals(market_a);
CREATE INDEX IF NOT EXISTS idx_ts_outcome   ON d004_trade_signals(outcome);
CREATE INDEX IF NOT EXISTS idx_ts_timestamp ON d004_trade_signals(trade_timestamp);

CREATE TRIGGER IF NOT EXISTS trg_ts_updated_at
AFTER UPDATE ON d004_trade_signals
BEGIN
    UPDATE d004_trade_signals SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- Paper Trades (existing JSON-based storage → real SQLite)
-- Source: paper_trades.db (JSON array, Bob's PaperTradesDB)
-- =============================================================================
CREATE TABLE IF NOT EXISTS paper_trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_uuid      TEXT UNIQUE NOT NULL,
    ticker          TEXT NOT NULL,
    market_title    TEXT,
    direction       TEXT NOT NULL CHECK (direction IN ('yes', 'no', 'hold', 'YES', 'NO', 'HOLD')),
    entry_price     INTEGER NOT NULL CHECK (entry_price >= 0 AND entry_price <= 100),
    exit_price      INTEGER CHECK (exit_price IS NULL OR (exit_price >= 0 AND exit_price <= 100)),
    contracts       INTEGER NOT NULL CHECK (contracts > 0),
    pnl             REAL,
    pnl_percent     REAL,
    strategy        TEXT NOT NULL DEFAULT 'unknown',
    signal_confidence REAL CHECK (signal_confidence IS NULL OR (signal_confidence >= 0 AND signal_confidence <= 1)),
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired', 'cancelled',
                                                                    'OPEN', 'CLOSED', 'CANCELLED')),
    outcome         TEXT CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'PENDING') OR outcome IS NULL),
    entry_timestamp TEXT NOT NULL,
    exit_timestamp  TEXT,
    source_file     TEXT,
    migrated_from   TEXT,                   -- 'json_legacy', 'd004_pipeline'
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pt_ticker   ON paper_trades(ticker);
CREATE INDEX IF NOT EXISTS idx_pt_status   ON paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_pt_strategy ON paper_trades(strategy);
CREATE INDEX IF NOT EXISTS idx_pt_entry_ts ON paper_trades(entry_timestamp);
CREATE INDEX IF NOT EXISTS idx_pt_status_strategy ON paper_trades(status, strategy);

CREATE TRIGGER IF NOT EXISTS trg_pt_updated_at
AFTER UPDATE ON paper_trades
BEGIN
    UPDATE paper_trades SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- Pipeline Run Registry
-- Tracks each migration / pipeline run for audit purposes
-- =============================================================================
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL UNIQUE,
    phase           TEXT NOT NULL CHECK (phase IN ('1', '2', '3', '4', 'all', 'legacy_migrate')),
    source_file     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'success', 'failed')),
    records_read    INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_skipped  INTEGER DEFAULT 0,
    error_message   TEXT,
    started_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT,
    migrated_by     TEXT DEFAULT 'pat'
);

CREATE INDEX IF NOT EXISTS idx_pr_phase  ON pipeline_runs(phase);
CREATE INDEX IF NOT EXISTS idx_pr_status ON pipeline_runs(status);

-- =============================================================================
-- Views: Live pipeline health
-- =============================================================================
CREATE VIEW IF NOT EXISTS v_pipeline_summary AS
SELECT
    r.run_id,
    r.phase,
    r.status,
    r.records_inserted,
    r.started_at,
    COALESCE(
        (SELECT COUNT(*) FROM d004_filtered_markets WHERE pipeline_run_id = r.run_id),
        0
    ) AS filtered_markets_count,
    COALESCE(
        (SELECT COUNT(*) FROM d004_clusters WHERE pipeline_run_id = r.run_id),
        0
    ) AS clusters_count,
    COALESCE(
        (SELECT COUNT(*) FROM d004_correlation_pairs WHERE pipeline_run_id = r.run_id),
        0
    ) AS correlation_pairs_count,
    COALESCE(
        (SELECT COUNT(*) FROM d004_trade_signals WHERE pipeline_run_id = r.run_id),
        0
    ) AS trade_signals_count
FROM pipeline_runs r
WHERE r.phase = 'all'
ORDER BY r.started_at DESC;

CREATE VIEW IF NOT EXISTS v_paper_trades_summary AS
SELECT
    strategy,
    COUNT(*)                                                           AS total_trades,
    SUM(CASE WHEN status IN ('closed','CLOSED') THEN 1 ELSE 0 END)    AS closed_trades,
    SUM(CASE WHEN status IN ('open','OPEN')     THEN 1 ELSE 0 END)    AS open_trades,
    SUM(CASE WHEN outcome = 'WIN'   THEN 1 ELSE 0 END)                AS wins,
    SUM(CASE WHEN outcome = 'LOSS'  THEN 1 ELSE 0 END)                AS losses,
    ROUND(
        SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) * 100.0
        / NULLIF(SUM(CASE WHEN status IN ('closed','CLOSED') THEN 1 ELSE 0 END), 0),
        2
    )                                                                  AS win_rate_pct,
    ROUND(SUM(COALESCE(pnl, 0)), 4)                                   AS total_pnl
FROM paper_trades
GROUP BY strategy;

CREATE VIEW IF NOT EXISTS v_arbitrage_opportunities AS
SELECT
    cp.pipeline_run_id,
    cp.market_a,
    cp.market_b,
    cp.pearson_correlation,
    cp.spread_deviation,
    cp.arbitrage_confidence,
    cp.direction,
    cp.generated_at
FROM d004_correlation_pairs cp
WHERE cp.is_arbitrage_opportunity = 1
ORDER BY cp.arbitrage_confidence DESC;
