-- Risk Management Schema
-- Task #244: Integrate risk_manager.js into live trading pipeline

-- Risk checks log
CREATE TABLE IF NOT EXISTS risk_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_ticker VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('YES', 'NO')),
    quantity INTEGER NOT NULL,
    price INTEGER NOT NULL, -- in cents
    approved BOOLEAN NOT NULL,
    risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    reasons JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Risk limits configuration (optional override of env vars)
CREATE TABLE IF NOT EXISTS risk_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    max_daily_loss INTEGER DEFAULT 50000, -- cents
    max_position_size INTEGER DEFAULT 1000, -- contracts
    max_total_exposure INTEGER DEFAULT 200000, -- cents
    max_concentration DECIMAL(5,4) DEFAULT 0.25, -- 25%
    max_drawdown DECIMAL(5,4) DEFAULT 0.10, -- 10%
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default risk limits
INSERT INTO risk_limits (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_risk_checks_created_at ON risk_checks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_checks_market ON risk_checks(market_ticker);

-- View: Daily risk metrics
CREATE OR REPLACE VIEW daily_risk_metrics AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_checks,
    SUM(CASE WHEN approved THEN 1 ELSE 0 END) as approved_count,
    SUM(CASE WHEN NOT approved THEN 1 ELSE 0 END) as rejected_count,
    AVG(risk_score) as avg_risk_score,
    MAX(risk_score) as max_risk_score
FROM risk_checks
GROUP BY DATE(created_at)
ORDER BY date DESC;
