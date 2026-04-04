-- P&L Tracking Database Schema
-- SQLite database for paper trade tracking
-- Created by: Pat (Database Engineer)
-- Task: 260

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Main table: paper trades
CREATE TABLE IF NOT EXISTS paper_trades (
    trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_uuid TEXT UNIQUE NOT NULL,           -- Unique identifier (format: TRADE-<timestamp>-<random>)
    ticker TEXT NOT NULL,                       -- Market ticker (e.g., BTCW-26-JUN30-100K)
    market_title TEXT,                          -- Human-readable market title
    direction TEXT NOT NULL CHECK (direction IN ('yes', 'no', 'hold')),  -- Trade direction
    entry_price INTEGER NOT NULL CHECK (entry_price >= 0 AND entry_price <= 100),  -- Entry price in cents
    exit_price INTEGER CHECK (exit_price IS NULL OR (exit_price >= 0 AND exit_price <= 100)),  -- Exit price in cents (NULL if open)
    contracts INTEGER NOT NULL CHECK (contracts > 0),  -- Number of contracts
    pnl REAL,                                   -- Profit/loss in dollars (calculated on exit)
    pnl_percent REAL,                           -- P&L as percentage of position
    strategy TEXT NOT NULL,                     -- Strategy name (mean_reversion, momentum, etc.)
    signal_confidence REAL CHECK (signal_confidence IS NULL OR (signal_confidence >= 0 AND signal_confidence <= 1)),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired', 'cancelled')),
    source_file TEXT,                           -- Source JSON file path
    entry_timestamp TEXT NOT NULL,              -- ISO 8601 timestamp of entry
    exit_timestamp TEXT,                        -- ISO 8601 timestamp of exit
    created_at TEXT DEFAULT (datetime('now')),  -- Record creation time
    updated_at TEXT DEFAULT (datetime('now'))   -- Last update time
);

-- Index: fast lookup by ticker
CREATE INDEX IF NOT EXISTS idx_trades_ticker ON paper_trades(ticker);

-- Index: fast lookup by status (for open positions)
CREATE INDEX IF NOT EXISTS idx_trades_status ON paper_trades(status) WHERE status = 'open';

-- Index: fast lookup by strategy
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON paper_trades(strategy);

-- Index: fast time-series queries
CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON paper_trades(entry_timestamp);

-- Index: fast P&L summary queries
CREATE INDEX IF NOT EXISTS idx_trades_status_strategy ON paper_trades(status, strategy);

-- Table: P&L daily snapshots (for tracking cumulative performance)
CREATE TABLE IF NOT EXISTS pnl_snapshots (
    snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT UNIQUE NOT NULL,         -- Date of snapshot (YYYY-MM-DD)
    total_trades INTEGER DEFAULT 0,             -- Total trades count
    open_positions INTEGER DEFAULT 0,           -- Number of open positions
    closed_positions INTEGER DEFAULT 0,         -- Number of closed positions
    total_pnl REAL DEFAULT 0,                   -- Total realized P&L
    daily_pnl REAL DEFAULT 0,                   -- P&L from trades closed today
    win_count INTEGER DEFAULT 0,                -- Number of winning trades
    loss_count INTEGER DEFAULT 0,               -- Number of losing trades
    win_rate REAL,                              -- Win percentage
    avg_win REAL,                               -- Average winning trade
    avg_loss REAL,                              -- Average losing trade
    best_trade REAL,                            -- Best single trade P&L
    worst_trade REAL,                           -- Worst single trade P&L
    created_at TEXT DEFAULT (datetime('now'))
);

-- Index: snapshot date lookup
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON pnl_snapshots(snapshot_date);

-- Table: strategy performance tracking
CREATE TABLE IF NOT EXISTS strategy_stats (
    strategy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_name TEXT UNIQUE NOT NULL,         -- Strategy identifier
    total_trades INTEGER DEFAULT 0,
    win_count INTEGER DEFAULT 0,
    loss_count INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    avg_pnl_per_trade REAL,
    last_trade_at TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Trigger: Update updated_at on paper_trades row update
CREATE TRIGGER IF NOT EXISTS trg_trades_updated_at
AFTER UPDATE ON paper_trades
BEGIN
    UPDATE paper_trades SET updated_at = datetime('now') WHERE trade_id = NEW.trade_id;
END;

-- View: Open positions summary
CREATE VIEW IF NOT EXISTS v_open_positions AS
SELECT 
    ticker,
    direction,
    entry_price,
    contracts,
    strategy,
    signal_confidence,
    entry_timestamp,
    (contracts * entry_price / 100.0) as position_value
FROM paper_trades
WHERE status = 'open';

-- View: Closed trades with P&L
CREATE VIEW IF NOT EXISTS v_closed_trades AS
SELECT 
    trade_uuid,
    ticker,
    direction,
    entry_price,
    exit_price,
    contracts,
    pnl,
    pnl_percent,
    strategy,
    entry_timestamp,
    exit_timestamp,
    CASE WHEN pnl > 0 THEN 'win' WHEN pnl < 0 THEN 'loss' ELSE 'breakeven' END as outcome
FROM paper_trades
WHERE status = 'closed';

-- View: Strategy performance summary
CREATE VIEW IF NOT EXISTS v_strategy_performance AS
SELECT 
    strategy,
    COUNT(*) as total_trades,
    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
    SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as win_count,
    SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as loss_count,
    ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0), 2) as win_rate,
    ROUND(SUM(pnl), 2) as total_pnl,
    ROUND(AVG(pnl), 2) as avg_pnl,
    ROUND(MAX(pnl), 2) as best_trade,
    ROUND(MIN(pnl), 2) as worst_trade
FROM paper_trades
GROUP BY strategy;

-- View: Daily P&L summary
CREATE VIEW IF NOT EXISTS v_daily_pnl AS
SELECT 
    date(entry_timestamp) as trade_date,
    COUNT(*) as trades_count,
    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
    SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
    ROUND(SUM(CASE WHEN status = 'closed' THEN pnl ELSE 0 END), 2) as daily_pnl,
    ROUND(AVG(CASE WHEN status = 'closed' THEN pnl END), 2) as avg_trade_pnl
FROM paper_trades
GROUP BY date(entry_timestamp)
ORDER BY trade_date DESC;
