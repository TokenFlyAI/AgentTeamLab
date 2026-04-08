-- Unified Trading & Pipeline Schema
-- Supports Phases 1-4 of the D004 Pipeline
-- Target: SQLite (local) / PostgreSQL (production)

-- Enable foreign keys (SQLite specific, ignored by Postgres)
PRAGMA foreign_keys = ON;

-- ============================================================================
-- 1. INFRASTRUCTURE & METADATA
-- ============================================================================

-- Strategies registry
CREATE TABLE IF NOT EXISTS strategies (
    strategy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_name TEXT UNIQUE NOT NULL,         -- 'mean_reversion', 'arbitrage', etc.
    strategy_type TEXT,                         -- 'technical', 'macro', 'arbitrage'
    description TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pipeline runs metadata (Phases 1-4)
CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,                               -- e.g., 'T852'
    phase TEXT NOT NULL,                        -- 'Phase 1', 'Phase 2', etc.
    source TEXT,                                -- 'grace_t816_live_fixture'
    run_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    config_json TEXT,                           -- Full configuration used
    summary_json TEXT                           -- Summary of results
);

-- ============================================================================
-- 2. PHASE 1: MARKET FILTERING
-- ============================================================================

-- Registry of markets encountered
CREATE TABLE IF NOT EXISTS markets (
    ticker TEXT PRIMARY KEY,
    title TEXT,
    category TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- History of market data points (OHLCV-ish)
CREATE TABLE IF NOT EXISTS market_data_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    run_id INTEGER,                             -- Link to pipeline run that captured this
    volume INTEGER,
    yes_bid INTEGER,
    yes_ask INTEGER,
    no_bid INTEGER,
    no_ask INTEGER,
    yes_ratio INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticker) REFERENCES markets(ticker),
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id)
);

-- Results of filtering runs
CREATE TABLE IF NOT EXISTS market_filter_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    is_qualifying BOOLEAN NOT NULL,
    recommendation TEXT,                        -- 'proceed_to_clustering', 'excluded'
    exclusion_reason TEXT,                      -- 'middle_range_excluded', 'low_volume'
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id),
    FOREIGN KEY (ticker) REFERENCES markets(ticker)
);

-- ============================================================================
-- 3. PHASE 2: LLM CLUSTERING
-- ============================================================================

-- Cluster definitions per run
CREATE TABLE IF NOT EXISTS clusters (
    cluster_db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    cluster_id TEXT NOT NULL,                   -- JSON ID e.g., 'cluster_1'
    label TEXT,
    description TEXT,
    strength REAL,
    confidence REAL,
    stability REAL,
    cohesion REAL,
    separation REAL,
    avg_volatility REAL,
    avg_sentiment REAL,
    is_cross_category BOOLEAN,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id)
);

-- Mapping of markets to clusters
CREATE TABLE IF NOT EXISTS cluster_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_db_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    is_uncertain BOOLEAN DEFAULT 0,
    FOREIGN KEY (cluster_db_id) REFERENCES clusters(cluster_db_id),
    FOREIGN KEY (ticker) REFERENCES markets(ticker)
);

-- ============================================================================
-- 4. PHASE 3: CORRELATION DETECTION
-- ============================================================================

-- Correlation results between market pairs
CREATE TABLE IF NOT EXISTS correlation_pairs (
    pair_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    cluster_db_id INTEGER,                      -- Link to internal clusters table
    cluster_id TEXT,                            -- Original cluster ID e.g., 'cluster_1'
    market_a TEXT NOT NULL,
    market_b TEXT NOT NULL,
    pearson_r REAL,
    expected_spread REAL,
    current_spread REAL,
    spread_pct REAL,
    confidence REAL,
    direction TEXT,                             -- 'sell_A_buy_B', etc.
    is_arbitrage_opportunity BOOLEAN DEFAULT 0,
    volume_min INTEGER,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id),
    FOREIGN KEY (cluster_db_id) REFERENCES clusters(cluster_db_id),
    FOREIGN KEY (market_a) REFERENCES markets(ticker),
    FOREIGN KEY (market_b) REFERENCES markets(ticker)
);

-- ============================================================================
-- 5. PHASE 4: SIGNAL GENERATION & EXECUTION
-- ============================================================================

-- Trading signals generated from analysis
CREATE TABLE IF NOT EXISTS signals (
    signal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    strategy_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    correlation_pair_id INTEGER,               -- Optional link to Phase 3 result
    side TEXT CHECK (side IN ('yes', 'no')),
    signal_type TEXT CHECK (signal_type IN ('entry', 'exit')),
    confidence REAL,
    target_price INTEGER,
    current_price INTEGER,
    metadata_json TEXT,                        -- Risk parameters, capital floor state, etc.
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id),
    FOREIGN KEY (ticker) REFERENCES markets(ticker),
    FOREIGN KEY (correlation_pair_id) REFERENCES correlation_pairs(pair_id)
);

-- Executed trades (paper or live)
CREATE TABLE IF NOT EXISTS trades (
    trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_uuid TEXT UNIQUE NOT NULL,
    signal_id INTEGER,
    strategy_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('yes', 'no')),
    entry_price INTEGER NOT NULL,               -- in cents
    exit_price INTEGER,                         -- in cents
    contracts INTEGER NOT NULL,
    realized_pnl REAL,                          -- in dollars
    pnl_percent REAL,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired', 'cancelled')),
    entry_timestamp TIMESTAMP NOT NULL,
    exit_timestamp TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (signal_id) REFERENCES signals(signal_id),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id),
    FOREIGN KEY (ticker) REFERENCES markets(ticker)
);

-- ============================================================================
-- 6. INDEXES & PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_data_points_ticker_time ON market_data_points(ticker, timestamp);
CREATE INDEX IF NOT EXISTS idx_filter_run ON market_filter_results(run_id);
CREATE INDEX IF NOT EXISTS idx_cluster_run ON clusters(run_id);
CREATE INDEX IF NOT EXISTS idx_corr_run ON correlation_pairs(run_id);
CREATE INDEX IF NOT EXISTS idx_signals_run ON signals(run_id);
CREATE INDEX IF NOT EXISTS idx_trades_uuid ON trades(trade_uuid);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);

-- ============================================================================
-- 7. INITIAL DATA SEEDING
-- ============================================================================

INSERT OR IGNORE INTO strategies (strategy_name, strategy_type, description) VALUES
('mean_reversion', 'technical', 'Z-score based mean reversion on price deviations'),
('arbitrage', 'arbitrage', 'Cross-market arbitrage using correlation pairs'),
('momentum', 'technical', 'Trend following based on recent price movement');
