-- Rollback: V001__init_pipeline_schema.rollback.sql
-- Reverses V001__init_pipeline_schema.sql
-- WARNING: Destructive — drops all pipeline tables

DROP INDEX IF EXISTS idx_pipeline_runs_sprint;
DROP INDEX IF EXISTS idx_paper_trades_signal;
DROP INDEX IF EXISTS idx_paper_trades_status;
DROP INDEX IF EXISTS idx_trade_signals_pair;
DROP INDEX IF EXISTS idx_trade_signals_run;
DROP INDEX IF EXISTS idx_correlation_pairs_markets;
DROP INDEX IF EXISTS idx_correlation_pairs_run;
DROP INDEX IF EXISTS idx_cluster_members_ticker;
DROP INDEX IF EXISTS idx_market_clusters_run;
DROP INDEX IF EXISTS idx_filtered_markets_run;

DROP TABLE IF EXISTS paper_trades;
DROP TABLE IF EXISTS trade_signals;
DROP TABLE IF EXISTS correlation_pairs;
DROP TABLE IF EXISTS cluster_members;
DROP TABLE IF EXISTS market_clusters;
DROP TABLE IF EXISTS filtered_markets;
DROP TABLE IF EXISTS pipeline_runs;
