-- Multi-Strategy P&L Tracking Schema
-- SQLite database for comprehensive strategy performance tracking
-- Created by: Pat (Database Engineer)
-- Task: 407
-- Supports: D003 (Track P&L and iterate fast)

-- Enable foreign keys and WAL mode for better concurrency
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Strategies registry: master list of all trading strategies
CREATE TABLE IF NOT EXISTS strategies (
    strategy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_name TEXT UNIQUE NOT NULL,         -- e.g., 'mean_reversion', 'momentum'
    strategy_type TEXT,                         -- e.g., 'technical', 'fundamental', 'arbitrage'
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    is_active BOOLEAN DEFAULT 1,                -- Soft delete flag
    
    -- Risk parameters
    max_position_size INTEGER,                  -- Max contracts per trade
    max_daily_loss REAL,                        -- Circuit breaker: stop trading after this loss
    target_sharpe_ratio REAL                    -- Minimum acceptable Sharpe
);

-- Trades: individual trade executions (extends paper_trades from Task 260)
CREATE TABLE IF NOT EXISTS trades (
    trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_uuid TEXT UNIQUE NOT NULL,
    strategy_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('yes', 'no')),
    entry_price INTEGER NOT NULL CHECK (entry_price >= 1 AND entry_price <= 99),
    exit_price INTEGER CHECK (exit_price IS NULL OR (exit_price >= 1 AND exit_price <= 99)),
    contracts INTEGER NOT NULL CHECK (contracts > 0),
    
    -- P&L calculations
    realized_pnl REAL,                          -- Actual P&L on close
    unrealized_pnl REAL,                        -- Mark-to-market for open positions
    pnl_percent REAL,                           -- Percentage return
    
    -- Trade metadata
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired', 'cancelled')),
    entry_timestamp TEXT NOT NULL,
    exit_timestamp TEXT,
    
    -- Attribution: why was this trade taken?
    signal_confidence REAL CHECK (signal_confidence >= 0 AND signal_confidence <= 1),
    market_condition TEXT,                      -- e.g., 'trending', 'ranging', 'volatile'
    
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

-- ============================================================================
-- ROLLUP TABLES: Time-series aggregations for performance tracking
-- ============================================================================

-- Daily P&L rollup per strategy
CREATE TABLE IF NOT EXISTS strategy_pnl_daily (
    daily_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    date TEXT NOT NULL,                         -- YYYY-MM-DD
    
    -- Trade counts
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    breakeven_trades INTEGER DEFAULT 0,
    
    -- P&L metrics
    gross_pnl REAL DEFAULT 0,                   -- Sum of all P&L (before fees)
    net_pnl REAL DEFAULT 0,                     -- After estimated fees
    avg_trade_pnl REAL,                         -- Average P&L per trade
    max_win REAL,                               -- Best trade of the day
    max_loss REAL,                              -- Worst trade of the day
    
    -- Performance ratios
    win_rate REAL,                              -- winning_trades / total_trades
    profit_factor REAL,                         -- gross_wins / gross_losses
    
    -- Cumulative tracking
    cumulative_pnl REAL DEFAULT 0,              -- Running total P&L
    peak_cumulative_pnl REAL DEFAULT 0,         -- High water mark
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    
    UNIQUE(strategy_id, date),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

-- Weekly P&L rollup (aggregated from daily)
CREATE TABLE IF NOT EXISTS strategy_pnl_weekly (
    weekly_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    week INTEGER NOT NULL CHECK (week >= 1 AND week <= 53),
    
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    
    gross_pnl REAL DEFAULT 0,
    net_pnl REAL DEFAULT 0,
    win_rate REAL,
    
    -- Weekly volatility
    daily_pnl_std REAL,                         -- Std dev of daily P&Ls
    sharpe_ratio REAL,                          -- Sharpe = (mean return) / (std dev)
    
    cumulative_pnl REAL DEFAULT 0,
    peak_cumulative_pnl REAL DEFAULT 0,
    
    UNIQUE(strategy_id, year, week),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

-- Monthly P&L rollup
CREATE TABLE IF NOT EXISTS strategy_pnl_monthly (
    monthly_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    
    gross_pnl REAL DEFAULT 0,
    net_pnl REAL DEFAULT 0,
    win_rate REAL,
    
    -- Monthly performance metrics
    sharpe_ratio REAL,
    sortino_ratio REAL,                         -- Sharpe but only downside deviation
    calmar_ratio REAL,                          -- Return / max drawdown
    
    max_drawdown REAL DEFAULT 0,                -- Peak-to-trough decline
    max_drawdown_pct REAL,                      -- As percentage
    
    cumulative_pnl REAL DEFAULT 0,
    peak_cumulative_pnl REAL DEFAULT 0,
    
    UNIQUE(strategy_id, year, month),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

-- ============================================================================
-- DRAWDOWN TRACKING
-- ============================================================================

-- Drawdown events: record significant drawdowns for analysis
CREATE TABLE IF NOT EXISTS drawdown_events (
    drawdown_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    
    start_date TEXT NOT NULL,                   -- When drawdown began
    end_date TEXT,                              -- When recovered (NULL if ongoing)
    
    peak_pnl REAL NOT NULL,                     -- P&L at peak before drawdown
    trough_pnl REAL NOT NULL,                   -- P&L at lowest point
    recovery_pnl REAL,                          -- P&L when recovered
    
    drawdown_amount REAL,                       -- peak - trough (negative)
    drawdown_pct REAL,                          -- (peak - trough) / peak * 100
    
    duration_days INTEGER,                      -- Length of drawdown
    
    -- Classification
    severity TEXT CHECK (severity IN ('mild', 'moderate', 'severe', 'extreme')),
    cause TEXT,                                 -- e.g., 'market_crash', 'strategy_decay'
    
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

-- Running drawdown state (for efficient tracking)
CREATE TABLE IF NOT EXISTS drawdown_state (
    state_id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER UNIQUE NOT NULL,
    peak_cumulative_pnl REAL DEFAULT 0,
    current_drawdown REAL DEFAULT 0,
    current_drawdown_pct REAL DEFAULT 0,
    max_drawdown_ever REAL DEFAULT 0,
    max_drawdown_pct_ever REAL DEFAULT 0,
    in_drawdown BOOLEAN DEFAULT 0,
    drawdown_start_date TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

-- ============================================================================
-- TRADE-LEVEL ATTRIBUTION
-- ============================================================================

-- Trade attribution: detailed breakdown of what drove trade performance
CREATE TABLE IF NOT EXISTS trade_attribution (
    attribution_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL,
    
    -- Market context at entry
    market_volatility REAL,                     -- ATR or similar
    market_trend TEXT CHECK (market_trend IN ('up', 'down', 'sideways')),
    market_regime TEXT,                         -- e.g., 'bull', 'bear', 'chop'
    
    -- Signal quality
    signal_strength REAL,                       -- Normalized 0-1
    model_confidence REAL,
    
    -- Execution quality
    slippage REAL,                              -- Difference between expected and actual fill
    execution_delay_ms INTEGER,                 -- Time from signal to fill
    
    -- Attribution tags (JSON array of factors)
    alpha_factors TEXT,                         -- JSON: ["mean_reversion", "volume_spike"]
    risk_factors TEXT,                          -- JSON: ["low_liquidity", "high_spread"]
    
    FOREIGN KEY (trade_id) REFERENCES trades(trade_id)
);

-- Strategy comparison matrix (for cross-strategy analysis)
CREATE TABLE IF NOT EXISTS strategy_comparison (
    comparison_id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    
    strategy_a_id INTEGER NOT NULL,
    strategy_b_id INTEGER NOT NULL,
    
    correlation REAL,                           -- Daily P&L correlation
    beta REAL,                                  -- Strategy A beta to Strategy B
    
    -- Relative performance
    a_outperforms_b BOOLEAN,
    pnl_difference REAL,
    
    UNIQUE(date, strategy_a_id, strategy_b_id),
    FOREIGN KEY (strategy_a_id) REFERENCES strategies(strategy_id),
    FOREIGN KEY (strategy_b_id) REFERENCES strategies(strategy_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Trades indexes
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON trades(entry_timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_exit_time ON trades(exit_timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_status ON trades(strategy_id, status);

-- Rollup indexes
CREATE INDEX IF NOT EXISTS idx_daily_strategy_date ON strategy_pnl_daily(strategy_id, date);
CREATE INDEX IF NOT EXISTS idx_weekly_strategy ON strategy_pnl_weekly(strategy_id, year, week);
CREATE INDEX IF NOT EXISTS idx_monthly_strategy ON strategy_pnl_monthly(strategy_id, year, month);

-- Drawdown indexes
CREATE INDEX IF NOT EXISTS idx_drawdown_strategy ON drawdown_events(strategy_id);
CREATE INDEX IF NOT EXISTS idx_drawdown_dates ON drawdown_events(start_date, end_date);

-- ============================================================================
-- VIEWS: Common query patterns
-- ============================================================================

-- Current strategy performance summary
CREATE VIEW IF NOT EXISTS v_strategy_current_performance AS
SELECT 
    s.strategy_id,
    s.strategy_name,
    s.strategy_type,
    s.is_active,
    COUNT(DISTINCT t.trade_id) as total_trades,
    SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) as open_positions,
    SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) as closed_positions,
    SUM(CASE WHEN t.realized_pnl > 0 THEN 1 ELSE 0 END) as win_count,
    SUM(CASE WHEN t.realized_pnl < 0 THEN 1 ELSE 0 END) as loss_count,
    ROUND(SUM(t.realized_pnl), 2) as total_realized_pnl,
    ROUND(AVG(t.realized_pnl), 2) as avg_trade_pnl,
    ROUND(MAX(t.realized_pnl), 2) as best_trade,
    ROUND(MIN(t.realized_pnl), 2) as worst_trade,
    ds.max_drawdown_ever,
    ds.max_drawdown_pct_ever,
    ds.in_drawdown,
    ds.current_drawdown_pct
FROM strategies s
LEFT JOIN trades t ON s.strategy_id = t.strategy_id
LEFT JOIN drawdown_state ds ON s.strategy_id = ds.strategy_id
WHERE s.is_active = 1
GROUP BY s.strategy_id, s.strategy_name;

-- Daily performance with running totals
CREATE VIEW IF NOT EXISTS v_daily_performance_with_drawdown AS
SELECT 
    spd.*,
    spd.peak_cumulative_pnl - spd.cumulative_pnl as current_drawdown,
    CASE 
        WHEN spd.peak_cumulative_pnl > 0 
        THEN ROUND((spd.peak_cumulative_pnl - spd.cumulative_pnl) / spd.peak_cumulative_pnl * 100, 2)
        ELSE 0 
    END as drawdown_pct
FROM strategy_pnl_daily spd;

-- Strategy ranking by Sharpe ratio (monthly)
CREATE VIEW IF NOT EXISTS v_strategy_rankings AS
SELECT 
    strategy_id,
    year,
    month,
    gross_pnl,
    sharpe_ratio,
    sortino_ratio,
    calmar_ratio,
    max_drawdown_pct,
    RANK() OVER (ORDER BY sharpe_ratio DESC) as sharpe_rank,
    RANK() OVER (ORDER BY gross_pnl DESC) as pnl_rank,
    RANK() OVER (ORDER BY calmar_ratio DESC) as calmar_rank
FROM strategy_pnl_monthly
WHERE year = strftime('%Y', 'now') 
  AND month = strftime('%m', 'now');

-- Trade-level P&L attribution
CREATE VIEW IF NOT EXISTS v_trade_attribution_summary AS
SELECT 
    t.trade_id,
    t.ticker,
    s.strategy_name,
    t.direction,
    t.entry_price,
    t.exit_price,
    t.contracts,
    t.realized_pnl,
    ta.market_volatility,
    ta.market_trend,
    ta.signal_strength,
    ta.slippage,
    json_extract(ta.alpha_factors, '$') as alpha_factors,
    CASE 
        WHEN t.realized_pnl > 0 THEN 'win'
        WHEN t.realized_pnl < 0 THEN 'loss'
        ELSE 'breakeven'
    END as outcome
FROM trades t
JOIN strategies s ON t.strategy_id = s.strategy_id
LEFT JOIN trade_attribution ta ON t.trade_id = ta.trade_id;

-- ============================================================================
-- TRIGGERS: Auto-update timestamps and derived metrics
-- ============================================================================

-- Update daily rollup timestamp
CREATE TRIGGER IF NOT EXISTS trg_daily_updated_at
AFTER UPDATE ON strategy_pnl_daily
BEGIN
    UPDATE strategy_pnl_daily SET updated_at = datetime('now') WHERE daily_id = NEW.daily_id;
END;

-- Auto-calculate win rate on daily insert/update
CREATE TRIGGER IF NOT EXISTS trg_daily_win_rate
AFTER INSERT ON strategy_pnl_daily
BEGIN
    UPDATE strategy_pnl_daily 
    SET win_rate = CASE 
        WHEN NEW.total_trades > 0 THEN ROUND(NEW.winning_trades * 100.0 / NEW.total_trades, 2)
        ELSE 0 
    END
    WHERE daily_id = NEW.daily_id;
END;

-- ============================================================================
-- INITIAL DATA: Seed common strategies
-- ============================================================================

INSERT OR IGNORE INTO strategies (strategy_name, strategy_type, description, max_position_size, target_sharpe_ratio) VALUES
('mean_reversion', 'technical', 'Z-score based mean reversion on price deviations', 100, 1.0),
('momentum', 'technical', 'Trend following based on recent price movement', 100, 1.0),
('crypto_edge', 'fundamental', 'Crypto-specific edge detection using on-chain metrics', 50, 1.2),
('nfp_nowcast', 'macro', 'Non-farm payroll prediction using alternative data', 75, 0.8),
('econ_edge', 'macro', 'Economic indicator edge detection', 75, 0.9),
('arbitrage', 'arbitrage', 'Cross-market arbitrage using correlation pairs', 200, 1.5);
