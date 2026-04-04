-- NFP Nowcasting Pipeline Schema
-- Compatible with SQLite and PostgreSQL
-- Use TEXT for dates to keep it simple across engines

CREATE TABLE IF NOT EXISTS adp_employment (
    release_date TEXT PRIMARY KEY,
    value INTEGER,
    prior_value INTEGER,
    change INTEGER,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS initial_claims (
    week_ending_date TEXT PRIMARY KEY,
    value INTEGER,
    four_week_ma INTEGER,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ism_employment (
    release_date TEXT PRIMARY KEY,
    manufacturing_employment REAL,
    services_employment REAL,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_postings (
    date TEXT PRIMARY KEY,
    source TEXT,
    count INTEGER,
    change_mom REAL,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_card_spending (
    date TEXT PRIMARY KEY,
    value REAL,
    change_yoy REAL,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nfp_release (
    release_date TEXT PRIMARY KEY,
    actual_value INTEGER,
    consensus_forecast INTEGER,
    kalshi_implied_mean REAL,
    kalshi_implied_mode REAL,
    our_model_prediction INTEGER,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT,
    status TEXT,
    records_inserted INTEGER,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT
);
