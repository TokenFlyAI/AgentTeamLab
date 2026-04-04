-- Multi-Strategy P&L Query Patterns
-- Example queries for common analysis tasks
-- Task: 407

-- ============================================================================
-- 1. PER-STRATEGY DAILY/WEEKLY/MONTHLY P&L ROLLUP
-- ============================================================================

-- Daily P&L for a specific strategy (last 30 days)
SELECT 
    date,
    total_trades,
    winning_trades,
    losing_trades,
    ROUND(gross_pnl, 2) as daily_pnl,
    ROUND(win_rate, 1) as win_rate_pct,
    ROUND(cumulative_pnl, 2) as running_total
FROM strategy_pnl_daily
WHERE strategy_id = (SELECT strategy_id FROM strategies WHERE strategy_name = 'mean_reversion')
  AND date >= date('now', '-30 days')
ORDER BY date DESC;

-- Weekly P&L comparison across all strategies
SELECT 
    s.strategy_name,
    spw.year,
    spw.week,
    spw.total_trades,
    ROUND(spw.gross_pnl, 2) as weekly_pnl,
    ROUND(spw.win_rate, 1) as win_rate_pct,
    ROUND(spw.sharpe_ratio, 2) as sharpe
FROM strategy_pnl_weekly spw
JOIN strategies s ON spw.strategy_id = s.strategy_id
WHERE spw.year = strftime('%Y', 'now')
ORDER BY spw.week DESC, spw.gross_pnl DESC;

-- Monthly P&L with running totals
SELECT 
    s.strategy_name,
    spm.year,
    spm.month,
    spm.total_trades,
    ROUND(spm.gross_pnl, 2) as monthly_pnl,
    ROUND(spm.cumulative_pnl, 2) as ytd_pnl,
    ROUND(spm.max_drawdown_pct, 2) as max_dd_pct
FROM strategy_pnl_monthly spm
JOIN strategies s ON spm.strategy_id = s.strategy_id
ORDER BY spm.year DESC, spm.month DESC, spm.gross_pnl DESC;

-- ============================================================================
-- 2. WIN RATE AND SHARPE RATIO CALCULATIONS
-- ============================================================================

-- Overall win rate by strategy (all time)
SELECT 
    s.strategy_name,
    COUNT(*) as total_trades,
    SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN realized_pnl < 0 THEN 1 ELSE 0 END) as losses,
    ROUND(SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate_pct,
    ROUND(AVG(realized_pnl), 2) as avg_pnl,
    ROUND(SUM(realized_pnl), 2) as total_pnl
FROM trades t
JOIN strategies s ON t.strategy_id = s.strategy_id
WHERE t.status = 'closed'
GROUP BY s.strategy_id, s.strategy_name
ORDER BY win_rate_pct DESC;

-- Sharpe ratio calculation (monthly)
-- Sharpe = (mean daily return - risk_free_rate) / std_dev_of_returns
WITH daily_returns AS (
    SELECT 
        strategy_id,
        date,
        gross_pnl,
        AVG(gross_pnl) OVER (PARTITION BY strategy_id ORDER BY date ROWS 29 PRECEDING) as avg_pnl_30d,
        SQRT(AVG(gross_pnl * gross_pnl) OVER (PARTITION BY strategy_id ORDER BY date ROWS 29 PRECEDING) 
             - POW(AVG(gross_pnl) OVER (PARTITION BY strategy_id ORDER BY date ROWS 29 PRECEDING), 2)) as std_pnl_30d
    FROM strategy_pnl_daily
    WHERE date >= date('now', '-30 days')
)
SELECT 
    s.strategy_name,
    ROUND(AVG(d.avg_pnl_30d), 2) as mean_daily_pnl,
    ROUND(AVG(d.std_pnl_30d), 2) as std_dev,
    CASE 
        WHEN AVG(d.std_pnl_30d) > 0 
        THEN ROUND((AVG(d.avg_pnl_30d) - 0) / AVG(d.std_pnl_30d) * SQRT(252), 2)
        ELSE 0 
    END as annualized_sharpe
FROM daily_returns d
JOIN strategies s ON d.strategy_id = s.strategy_id
GROUP BY s.strategy_id, s.strategy_name;

-- Win rate by market condition (from trade attribution)
SELECT 
    s.strategy_name,
    ta.market_trend,
    COUNT(*) as trades,
    SUM(CASE WHEN t.realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
    ROUND(SUM(CASE WHEN t.realized_pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate_pct,
    ROUND(AVG(t.realized_pnl), 2) as avg_pnl
FROM trades t
JOIN strategies s ON t.strategy_id = s.strategy_id
LEFT JOIN trade_attribution ta ON t.trade_id = ta.trade_id
WHERE t.status = 'closed'
GROUP BY s.strategy_name, ta.market_trend
ORDER BY s.strategy_name, win_rate_pct DESC;

-- ============================================================================
-- 3. DRAWDOWN TRACKING PER STRATEGY
-- ============================================================================

-- Current drawdown status for all strategies
SELECT 
    s.strategy_name,
    ds.peak_cumulative_pnl as peak_pnl,
    ds.peak_cumulative_pnl - ds.current_drawdown as current_pnl,
    ROUND(ds.current_drawdown, 2) as drawdown_amount,
    ROUND(ds.current_drawdown_pct, 2) as drawdown_pct,
    ds.in_drawdown,
    ds.drawdown_start_date,
    ROUND(ds.max_drawdown_ever, 2) as max_dd_ever,
    ROUND(ds.max_drawdown_pct_ever, 2) as max_dd_pct_ever
FROM drawdown_state ds
JOIN strategies s ON ds.strategy_id = s.strategy_id
ORDER BY ds.current_drawdown_pct DESC;

-- Historical drawdown events
SELECT 
    s.strategy_name,
    de.start_date,
    de.end_date,
    de.duration_days,
    ROUND(de.drawdown_amount, 2) as dd_amount,
    ROUND(de.drawdown_pct, 2) as dd_pct,
    de.severity,
    de.cause
FROM drawdown_events de
JOIN strategies s ON de.strategy_id = s.strategy_id
ORDER BY de.drawdown_pct ASC
LIMIT 20;

-- Strategies currently in severe drawdown (>10%)
SELECT 
    s.strategy_name,
    ds.current_drawdown_pct,
    ds.drawdown_start_date,
    julianday('now') - julianday(ds.drawdown_start_date) as days_in_dd
FROM drawdown_state ds
JOIN strategies s ON ds.strategy_id = s.strategy_id
WHERE ds.in_drawdown = 1 
  AND ds.current_drawdown_pct > 10
ORDER BY ds.current_drawdown_pct DESC;

-- Recovery time analysis (how long to recover from drawdowns)
SELECT 
    s.strategy_name,
    AVG(duration_days) as avg_recovery_days,
    MAX(duration_days) as max_recovery_days,
    COUNT(*) as total_drawdowns
FROM drawdown_events de
JOIN strategies s ON de.strategy_id = s.strategy_id
WHERE de.end_date IS NOT NULL
GROUP BY s.strategy_name;

-- ============================================================================
-- 4. TRADE-LEVEL ATTRIBUTION
-- ============================================================================

-- Trade performance by alpha factor
SELECT 
    json_each.value as alpha_factor,
    COUNT(*) as trades,
    SUM(CASE WHEN t.realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
    ROUND(AVG(t.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(t.realized_pnl), 2) as total_pnl
FROM trades t
JOIN trade_attribution ta ON t.trade_id = ta.trade_id,
json_each(ta.alpha_factors)
WHERE t.status = 'closed'
GROUP BY json_each.value
ORDER BY avg_pnl DESC;

-- Signal quality vs actual performance
SELECT 
    CASE 
        WHEN ta.signal_strength >= 0.8 THEN 'strong'
        WHEN ta.signal_strength >= 0.5 THEN 'medium'
        ELSE 'weak'
    END as signal_bucket,
    COUNT(*) as trades,
    ROUND(AVG(t.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(t.realized_pnl), 2) as total_pnl,
    ROUND(AVG(ABS(t.realized_pnl)), 2) as avg_abs_pnl
FROM trades t
JOIN trade_attribution ta ON t.trade_id = ta.trade_id
WHERE t.status = 'closed'
GROUP BY signal_bucket
ORDER BY avg_pnl DESC;

-- Slippage impact analysis
SELECT 
    s.strategy_name,
    COUNT(*) as trades,
    ROUND(AVG(ta.slippage), 4) as avg_slippage,
    ROUND(AVG(t.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(ta.slippage), 2) as total_slippage_cost
FROM trades t
JOIN strategies s ON t.strategy_id = s.strategy_id
JOIN trade_attribution ta ON t.trade_id = ta.trade_id
WHERE t.status = 'closed'
GROUP BY s.strategy_name
ORDER BY avg_slippage DESC;

-- Best and worst performing tickers per strategy
WITH ticker_performance AS (
    SELECT 
        s.strategy_name,
        t.ticker,
        COUNT(*) as trades,
        ROUND(AVG(t.realized_pnl), 2) as avg_pnl,
        ROUND(SUM(t.realized_pnl), 2) as total_pnl
    FROM trades t
    JOIN strategies s ON t.strategy_id = s.strategy_id
    WHERE t.status = 'closed'
    GROUP BY s.strategy_name, t.ticker
    HAVING COUNT(*) >= 3  -- Minimum sample size
)
SELECT * FROM (
    SELECT *, 'best' as category, ROW_NUMBER() OVER (PARTITION BY strategy_name ORDER BY avg_pnl DESC) as rank
    FROM ticker_performance
) WHERE rank <= 3
UNION ALL
SELECT * FROM (
    SELECT *, 'worst' as category, ROW_NUMBER() OVER (PARTITION BY strategy_name ORDER BY avg_pnl ASC) as rank
    FROM ticker_performance
) WHERE rank <= 3
ORDER BY strategy_name, category, rank;

-- ============================================================================
-- 5. CROSS-STRATEGY ANALYSIS
-- ============================================================================

-- Strategy correlation matrix (monthly P&L)
SELECT 
    s1.strategy_name as strategy_a,
    s2.strategy_name as strategy_b,
    ROUND(sc.correlation, 3) as correlation,
    ROUND(sc.beta, 3) as beta,
    CASE WHEN sc.a_outperforms_b THEN 'A > B' ELSE 'B > A' END as leader
FROM strategy_comparison sc
JOIN strategies s1 ON sc.strategy_a_id = s1.strategy_id
JOIN strategies s2 ON sc.strategy_b_id = s2.strategy_id
WHERE sc.date >= date('now', '-30 days')
  AND s1.strategy_id < s2.strategy_id  -- Avoid duplicates
ORDER BY ABS(sc.correlation) DESC;

-- Portfolio-level daily P&L (sum across all strategies)
SELECT 
    date,
    SUM(total_trades) as total_trades,
    ROUND(SUM(gross_pnl), 2) as portfolio_pnl,
    ROUND(SUM(cumulative_pnl), 2) as portfolio_cumulative
FROM strategy_pnl_daily
WHERE date >= date('now', '-30 days')
GROUP BY date
ORDER BY date DESC;

-- Strategy rotation signal (which strategy to emphasize)
SELECT 
    s.strategy_name,
    spd.gross_pnl as last_7d_pnl,
    spd2.gross_pnl as prior_7d_pnl,
    CASE 
        WHEN spd.gross_pnl > spd2.gross_pnl THEN 'improving'
        WHEN spd.gross_pnl < spd2.gross_pnl THEN 'declining'
        ELSE 'stable'
    END as trend,
    ROUND(spm.sharpe_ratio, 2) as monthly_sharpe
FROM strategies s
LEFT JOIN (
    SELECT strategy_id, SUM(gross_pnl) as gross_pnl
    FROM strategy_pnl_daily
    WHERE date >= date('now', '-7 days')
    GROUP BY strategy_id
) spd ON s.strategy_id = spd.strategy_id
LEFT JOIN (
    SELECT strategy_id, SUM(gross_pnl) as gross_pnl
    FROM strategy_pnl_daily
    WHERE date >= date('now', '-14 days') AND date < date('now', '-7 days')
    GROUP BY strategy_id
) spd2 ON s.strategy_id = spd2.strategy_id
LEFT JOIN strategy_pnl_monthly spm ON s.strategy_id = spm.strategy_id
    AND spm.year = strftime('%Y', 'now') 
    AND spm.month = strftime('%m', 'now')
WHERE s.is_active = 1
ORDER BY spd.gross_pnl DESC;

-- ============================================================================
-- 6. OPERATIONAL QUERIES
-- ============================================================================

-- Daily EOD summary for all strategies
SELECT 
    'EOD Summary ' || date('now') as report_date,
    COUNT(DISTINCT strategy_id) as active_strategies,
    SUM(total_trades) as total_trades,
    ROUND(SUM(gross_pnl), 2) as total_pnl,
    ROUND(AVG(win_rate), 1) as avg_win_rate,
    ROUND(MAX(max_win), 2) as best_trade,
    ROUND(MIN(max_loss), 2) as worst_trade
FROM strategy_pnl_daily
WHERE date = date('now');

-- Strategies that need attention (poor performance)
SELECT 
    s.strategy_name,
    COUNT(t.trade_id) as recent_trades,
    ROUND(AVG(t.realized_pnl), 2) as recent_avg_pnl,
    ROUND(ds.max_drawdown_pct_ever, 2) as max_dd_pct,
    CASE 
        WHEN ds.current_drawdown_pct > 10 THEN 'CRITICAL: Severe drawdown'
        WHEN AVG(t.realized_pnl) < -1 THEN 'WARNING: Negative expectancy'
        WHEN COUNT(t.trade_id) < 5 THEN 'INFO: Low activity'
        ELSE 'OK'
    END as status
FROM strategies s
LEFT JOIN trades t ON s.strategy_id = t.strategy_id 
    AND t.exit_timestamp >= datetime('now', '-7 days')
LEFT JOIN drawdown_state ds ON s.strategy_id = ds.strategy_id
WHERE s.is_active = 1
GROUP BY s.strategy_id, s.strategy_name
ORDER BY recent_avg_pnl ASC;

-- Trade audit: verify all closed trades have P&L calculated
SELECT 
    s.strategy_name,
    COUNT(*) as trades_missing_pnl
FROM trades t
JOIN strategies s ON t.strategy_id = s.strategy_id
WHERE t.status = 'closed' 
  AND t.realized_pnl IS NULL
GROUP BY s.strategy_id, s.strategy_name;
