-- Migration: V001__init_pipeline_schema.sql
-- Author: Pat (Database Engineer)
-- Task: T1013 — Sprint 9 database schema migration versioning
-- Description: Initial D004 pipeline schema (forward migration)
-- Rollback: V001__init_pipeline_schema.rollback.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id TEXT PRIMARY KEY,
    sprint_id TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    status TEXT CHECK(status IN ('running', 'success', 'failed')),
    metadata TEXT
);

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

CREATE TABLE IF NOT EXISTS trade_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    pair_id INTEGER,
    ticker TEXT NOT NULL,
    direction TEXT CHECK(direction IN ('YES', 'NO')),
    confidence REAL,
    suggested_price INTEGER,
    suggested_size INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id),
    FOREIGN KEY (pair_id) REFERENCES correlation_pairs(id)
);

CREATE TABLE IF NOT EXISTS paper_trades (
    id TEXT PRIMARY KEY,
    signal_id INTEGER,
    market TEXT NOT NULL,
    direction TEXT,
    contracts INTEGER,
    entry_price INTEGER,
    exit_price INTEGER,
    status TEXT CHECK(status IN ('OPEN', 'CLOSED', 'CANCELLED')),
    pnl INTEGER,
    outcome TEXT CHECK(outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'PENDING')),
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (signal_id) REFERENCES trade_signals(id)
);

CREATE INDEX IF NOT EXISTS idx_filtered_markets_run ON filtered_markets(run_id);
CREATE INDEX IF NOT EXISTS idx_market_clusters_run ON market_clusters(run_id);
CREATE INDEX IF NOT EXISTS idx_cluster_members_ticker ON cluster_members(market_ticker);
CREATE INDEX IF NOT EXISTS idx_correlation_pairs_run ON correlation_pairs(run_id);
CREATE INDEX IF NOT EXISTS idx_correlation_pairs_markets ON correlation_pairs(market_a, market_b);
CREATE INDEX IF NOT EXISTS idx_trade_signals_run ON trade_signals(run_id);
CREATE INDEX IF NOT EXISTS idx_trade_signals_pair ON trade_signals(pair_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_signal ON paper_trades(signal_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_sprint ON pipeline_runs(sprint_id);
