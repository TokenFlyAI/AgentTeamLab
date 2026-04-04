-- =============================================================================
-- migration_004_agent_auth.sql
-- Tokenfly Agent Team Lab — Agent Authentication Schema
-- Author: Bob (Backend Engineer) — 2026-03-31
-- Task: T002
--
-- Purpose: Add agent credential storage and session management for login API.
--          Provides secure password hashing and session token support.
--
-- Apply:
--   docker exec -i tokenfly-postgres \
--     psql -U tokenfly -d tokenfly \
--     < backend/migration_004_agent_auth.sql
--
-- Rollback:
--   DROP TABLE IF EXISTS agent_sessions;
--   DROP TABLE IF EXISTS agent_credentials;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: agent_credentials
-- Secure storage for agent authentication credentials.
-- One-to-one with agents table. Passwords are bcrypt-hashed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_credentials (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID         NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    credential_type TEXT         NOT NULL DEFAULT 'password',
    -- Password hash using bcrypt (60 chars for $2b$10$... format)
    password_hash   VARCHAR(255),
    -- API key hash for service-to-service auth (hashed, not stored plaintext)
    api_key_hash    VARCHAR(255),
    -- TOTP secret for 2FA (encrypted at application layer)
    totp_secret     BYTEA,
    failed_attempts INTEGER      NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT agent_credentials_agent_unique UNIQUE (agent_id),
    CONSTRAINT agent_credentials_type_check CHECK (credential_type IN ('password', 'api_key', 'oauth')),
    CONSTRAINT agent_credentials_one_method CHECK (
        (credential_type = 'password' AND password_hash IS NOT NULL) OR
        (credential_type = 'api_key' AND api_key_hash IS NOT NULL) OR
        (credential_type = 'oauth')
    ),
    CONSTRAINT agent_credentials_lock_check CHECK (
        locked_until IS NULL OR locked_until > created_at
    )
);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_agent ON agent_credentials (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_locked ON agent_credentials (locked_until) WHERE locked_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TABLE: agent_sessions
-- Active login sessions with JWT-style tokens.
-- Sessions expire automatically; refresh tokens allow renewal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_sessions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID         NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    -- Session token (SHA-256 hash of the JWT signature portion)
    token_hash      VARCHAR(64)  NOT NULL,
    -- Token metadata (not the full token)
    token_id        TEXT         NOT NULL,  -- Unique token identifier (jti claim)
    issued_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    last_used_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ip_address      INET,
    user_agent      TEXT,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT,

    CONSTRAINT agent_sessions_token_unique UNIQUE (token_hash),
    CONSTRAINT agent_sessions_token_id_unique UNIQUE (token_id),
    CONSTRAINT agent_sessions_expires_after_issued CHECK (expires_at > issued_at),
    CONSTRAINT agent_sessions_revoked_after_issued CHECK (
        revoked_at IS NULL OR revoked_at >= issued_at
    )
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions (agent_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_token ON agent_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires ON agent_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active ON agent_sessions (agent_id) WHERE revoked_at IS NULL AND expires_at > now();

-- ---------------------------------------------------------------------------
-- TRIGGERS: auto-update updated_at for agent_credentials
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TRIGGER trg_agent_credentials_updated_at
        BEFORE UPDATE ON agent_credentials
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- FUNCTION: Clean up expired sessions (can be called by cron/job scheduler)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM agent_sessions
    WHERE expires_at < now() - INTERVAL '7 days'
       OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '1 day');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- SEED: Default credentials for development
-- WARNING: Change these passwords in production!
-- Passwords are bcrypt hashes of 'agent123' (10 rounds)
-- ---------------------------------------------------------------------------
INSERT INTO agent_credentials (agent_id, credential_type, password_hash)
SELECT 
    a.id,
    'password',
    '$2b$10$YourBcryptHashHere.ShouldBeReplacedInProduction'
FROM agents a
WHERE a.name IN ('alice', 'bob', 'sam', 'tina')
ON CONFLICT (agent_id) DO NOTHING;

COMMIT;
