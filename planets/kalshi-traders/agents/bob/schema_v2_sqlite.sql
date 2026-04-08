
-- Kalshi Arbitrage Engine - SQLite Persistent Schema (v2)
-- Author: Bob (Backend Engineer)
-- Task: T952 - Transition JSON logs to relational schema

-- ---------------------------------------------------------------------------
-- 1. Sprints & Runs (Execution Context)
-- Tracks each end-to-end pipeline execution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id TEXT PRIMARY KEY,
    sprint_id TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    status TEXT CHECK(status IN ('running', 'success', 'failed')),
    metadata TEXT -- JSON blob for environment, executor info, etc.
);

-- ---------------------------------------------------------------------------
-- 2. Phase 1: Filtered Markets
-- Replaces markets_filtered.json
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS filtered_markets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT,
    volume INTEGER,
    yes_bid INTEGER,
    yes_ask INTEGER,
    yes_ratio REAL,
    recommendation TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id)
);

-- ---------------------------------------------------------------------------
-- 3. Phase 2: Market Clusters
-- Replaces market_clusters.json
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    cluster_name TEXT NOT NULL,
    description TEXT,
    confidence_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id)
);

CREATE TABLE IF NOT EXISTS cluster_members (
    cluster_id INTEGER NOT NULL,
    market_ticker TEXT NOT NULL,
    PRIMARY KEY (cluster_id, market_ticker),
    FOREIGN KEY (cluster_id) REFERENCES market_clusters(id)
);

-- ---------------------------------------------------------------------------
-- 4. Phase 3: Correlation Pairs
-- Replaces correlation_pairs.json
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correlation_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    cluster_id INTEGER,
    market_a TEXT NOT NULL,
    market_b TEXT NOT NULL,
    pearson_r REAL,
    expected_spread REAL,
    current_spread REAL,
    arbitrage_confidence REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id),
    FOREIGN KEY (cluster_id) REFERENCES market_clusters(id)
);

-- ---------------------------------------------------------------------------
-- 5. Phase 4: Trade Signals & Execution
-- Replaces trade_signals.json and paper_trade_log.json
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    pair_id INTEGER,
    ticker TEXT NOT NULL,
    direction TEXT CHECK(direction IN ('YES', 'NO')),
    confidence REAL,
    suggested_price INTEGER,
    suggested_size INTEGER,
    status TEXT DEFAULT 'pending', -- pending, acted, ignored, expired
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id),
    FOREIGN KEY (pair_id) REFERENCES correlation_pairs(id)
);

CREATE TABLE IF NOT EXISTS paper_trades (
    id TEXT PRIMARY KEY, -- pt_timestamp_random
    signal_id INTEGER,
    market TEXT NOT NULL,
    direction TEXT,
    contracts INTEGER,
    entry_price INTEGER,
    exit_price INTEGER,
    status TEXT CHECK(status IN ('OPEN', 'CLOSED', 'CANCELLED')),
    pnl INTEGER, -- in cents
    outcome TEXT CHECK(outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'PENDING')),
    metadata TEXT, -- JSON blob
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (signal_id) REFERENCES trade_signals(id)
);

-- ---------------------------------------------------------------------------
-- Indexes for Performance
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_filtered_markets_run ON filtered_markets(run_id);
CREATE INDEX IF NOT EXISTS idx_correlation_pairs_run ON correlation_pairs(run_id);
CREATE INDEX IF NOT EXISTS idx_trade_signals_run ON trade_signals(run_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_sprint ON pipeline_runs(sprint_id);
