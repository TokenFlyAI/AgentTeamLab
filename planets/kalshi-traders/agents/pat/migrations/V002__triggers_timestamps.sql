-- Migration: V002__triggers_timestamps.sql
-- Author: Pat (Database Engineer)
-- Task: T1013 — Sprint 9 database schema migration versioning
-- Description: Add updated_at triggers for automated timestamp management
-- Rollback: V002__triggers_timestamps.rollback.sql

CREATE TRIGGER IF NOT EXISTS trg_paper_trades_updated_at
AFTER UPDATE ON paper_trades
BEGIN
    UPDATE paper_trades SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
