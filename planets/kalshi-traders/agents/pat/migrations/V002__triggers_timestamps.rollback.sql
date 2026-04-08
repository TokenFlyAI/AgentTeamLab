-- Rollback: V002__triggers_timestamps.rollback.sql
-- Reverses V002__triggers_timestamps.sql

DROP TRIGGER IF EXISTS trg_paper_trades_updated_at;
