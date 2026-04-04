-- =============================================================================
-- migration_004_auth_schema.sql
-- Tokenfly Agent Team Lab — Authentication Schema
-- Author: Bob (Backend Engineer)
-- Task: T002
--
-- Purpose: User authentication — users table, sessions, password hashing
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Users table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(32) NOT NULL UNIQUE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,  -- bcrypt hash
    role            VARCHAR(16) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'readonly')),
    is_active       BOOLEAN DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    failed_logins   INTEGER DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE users IS 'User accounts for API authentication';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hash (cost factor 12)';

-- ---------------------------------------------------------------------------
-- Sessions table (JWT refresh token storage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token   VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hash of token
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ DEFAULT NOW(),
    ip_address      INET,
    user_agent      VARCHAR(512)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Audit log for authentication events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type      VARCHAR(32) NOT NULL CHECK (event_type IN ('login', 'logout', 'refresh', 'failed_login', 'password_change', 'account_locked')),
    ip_address      INET,
    user_agent      VARCHAR(512),
    details         JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user_id ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event_type ON auth_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created_at ON auth_audit_log(created_at);

-- ---------------------------------------------------------------------------
-- Default admin user (password: changeme)
-- bcrypt hash for 'changeme' with cost 12
-- ---------------------------------------------------------------------------
INSERT INTO users (username, email, password_hash, role)
VALUES (
    'admin',
    'admin@agentplanet.local',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiAYMyzJ/IzK',
    'admin'
)
ON CONFLICT (username) DO NOTHING;

COMMIT;
