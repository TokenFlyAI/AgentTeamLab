-- Kalshi Trading Database Schema
-- Author: Bob (Backend Engineer)
-- Task: #219 — Build Kalshi API client and data infrastructure

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Markets Table
-- Stores market metadata from Kalshi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticker VARCHAR(50) UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category VARCHAR(50),
    series_ticker VARCHAR(50),
    event_ticker VARCHAR(50),
    
    -- Market status
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, closed, settled
    open_date TIMESTAMP WITH TIME ZONE,
    close_date TIMESTAMP WITH TIME ZONE,
    settlement_date TIMESTAMP WITH TIME ZONE,
    
    -- Market rules
    yes_sub_title TEXT,
    no_sub_title TEXT,
    rules_primary TEXT,
    rules_secondary TEXT,
    
    -- Kalshi metadata
    kalshi_market_id VARCHAR(100),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes
    CONSTRAINT valid_status CHECK (status IN ('active', 'closed', 'settled', 'cancelled'))
);

-- Indexes for markets
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_close_date ON markets(close_date);
CREATE INDEX IF NOT EXISTS idx_markets_ticker ON markets(ticker);

-- ---------------------------------------------------------------------------
-- Market Prices Table
-- Stores price quotes and orderbook snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_prices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    
    -- Price data (stored as cents: 0-100)
    yes_bid INTEGER, -- Best bid for YES
    yes_ask INTEGER, -- Best ask for YES
    no_bid INTEGER,  -- Best bid for NO
    no_ask INTEGER,  -- Best ask for NO
    
    -- Mid prices (calculated)
    yes_mid INTEGER GENERATED ALWAYS AS (
        CASE 
            WHEN yes_bid IS NOT NULL AND yes_ask IS NOT NULL 
            THEN (yes_bid + yes_ask) / 2 
            ELSE NULL 
        END
    ) STORED,
    
    no_mid INTEGER GENERATED ALWAYS AS (
        CASE 
            WHEN no_bid IS NOT NULL AND no_ask IS NOT NULL 
            THEN (no_bid + no_ask) / 2 
            ELSE NULL 
        END
    ) STORED,
    
    -- Volume and open interest
    volume BIGINT,
    open_interest BIGINT,
    
    -- Last trade info
    last_trade_price INTEGER,
    last_trade_size INTEGER,
    
    -- Timestamp from Kalshi
    kalshi_timestamp TIMESTAMP WITH TIME ZONE,
    
    -- Our timestamp
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Source (API, WebSocket, etc.)
    source VARCHAR(20) DEFAULT 'api'
);

-- Indexes for prices
CREATE INDEX IF NOT EXISTS idx_market_prices_market_id ON market_prices(market_id);
CREATE INDEX IF NOT EXISTS idx_market_prices_recorded_at ON market_prices(recorded_at);
CREATE INDEX IF NOT EXISTS idx_market_prices_market_time ON market_prices(market_id, recorded_at);

-- Partition prices by time (optional optimization for large datasets)
-- CREATE TABLE market_prices_y2024m04 PARTITION OF market_prices
--     FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

-- ---------------------------------------------------------------------------
-- Price History (Candles) Table
-- Stores OHLCV candle data for charts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_candles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    
    -- Candle metadata
    resolution VARCHAR(10) NOT NULL, -- 1m, 5m, 15m, 1h, 1d
    candle_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- OHLCV for YES side
    yes_open INTEGER,
    yes_high INTEGER,
    yes_low INTEGER,
    yes_close INTEGER,
    yes_volume BIGINT,
    
    -- OHLCV for NO side
    no_open INTEGER,
    no_high INTEGER,
    no_low INTEGER,
    no_close INTEGER,
    no_volume BIGINT,
    
    -- Unique constraint to prevent duplicates
    UNIQUE(market_id, resolution, candle_time)
);

-- Indexes for candles
CREATE INDEX IF NOT EXISTS idx_price_candles_market ON price_candles(market_id);
CREATE INDEX IF NOT EXISTS idx_price_candles_resolution ON price_candles(resolution);
CREATE INDEX IF NOT EXISTS idx_price_candles_time ON price_candles(candle_time);
CREATE INDEX IF NOT EXISTS idx_price_candles_market_res_time ON price_candles(market_id, resolution, candle_time);

-- ---------------------------------------------------------------------------
-- Positions Table
-- Tracks our trading positions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID NOT NULL REFERENCES markets(id),
    
    -- Position details
    side VARCHAR(10) NOT NULL, -- 'yes' or 'no'
    contracts INTEGER NOT NULL,
    avg_entry_price INTEGER NOT NULL, -- in cents
    
    -- Current state
    current_price INTEGER, -- last known price
    unrealized_pnl INTEGER, -- in cents
    
    -- Order tracking
    opening_order_id VARCHAR(100),
    closing_order_id VARCHAR(100),
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'open', -- open, closed, partial
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    
    -- Calculated fields
    max_gain INTEGER GENERATED ALWAYS AS (
        CASE side
            WHEN 'yes' THEN contracts * (100 - avg_entry_price)
            WHEN 'no' THEN contracts * (100 - avg_entry_price)
            ELSE 0
        END
    ) STORED,
    
    max_loss INTEGER GENERATED ALWAYS AS (
        contracts * avg_entry_price
    ) STORED
);

-- Indexes for positions
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_opened_at ON positions(opened_at);

-- ---------------------------------------------------------------------------
-- Orders Table
-- Tracks order history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID NOT NULL REFERENCES markets(id),
    
    -- Kalshi order ID
    kalshi_order_id VARCHAR(100) UNIQUE,
    client_order_id VARCHAR(100),
    
    -- Order details
    side VARCHAR(10) NOT NULL, -- 'yes' or 'no'
    action VARCHAR(10) NOT NULL, -- 'buy' or 'sell'
    contracts INTEGER NOT NULL,
    price INTEGER NOT NULL, -- in cents
    
    -- Order status
    status VARCHAR(20) NOT NULL, -- pending, open, filled, partial, cancelled, rejected
    filled_contracts INTEGER DEFAULT 0,
    avg_fill_price INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    filled_at TIMESTAMP WITH TIME ZONE,
    
    -- Error info
    rejection_reason TEXT
);

-- Indexes for orders
CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_kalshi_id ON orders(kalshi_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- ---------------------------------------------------------------------------
-- Trades Table
-- Individual trade fills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    
    -- Trade details
    side VARCHAR(10) NOT NULL,
    contracts INTEGER NOT NULL,
    price INTEGER NOT NULL, -- in cents
    total_amount INTEGER GENERATED ALWAYS AS (contracts * price) STORED,
    
    -- Kalshi trade ID
    kalshi_trade_id VARCHAR(100) UNIQUE,
    
    -- Timestamp
    traded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for trades
CREATE INDEX IF NOT EXISTS idx_trades_order ON trades(order_id);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);
CREATE INDEX IF NOT EXISTS idx_trades_traded_at ON trades(traded_at);

-- ---------------------------------------------------------------------------
-- Portfolio Snapshots Table
-- Daily portfolio value tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Account values (in cents)
    balance INTEGER NOT NULL, -- cash balance
    portfolio_value INTEGER NOT NULL, -- position value
    total_value INTEGER NOT NULL, -- balance + portfolio_value
    
    -- P&L
    day_pnl INTEGER, -- today's P&L
    total_pnl INTEGER, -- total P&L
    
    -- Exposure
    total_exposure INTEGER, -- sum of position values
    margin_used INTEGER,
    
    -- Timestamp
    snapshot_date DATE NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for snapshots
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date);

-- ---------------------------------------------------------------------------
-- Data Collection Jobs Log
-- Tracks when data was fetched
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_collection_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    job_type VARCHAR(50) NOT NULL, -- markets, prices, candles, positions
    status VARCHAR(20) NOT NULL, -- running, success, failed
    
    -- Job details
    params JSONB,
    records_processed INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Error info
    error_message TEXT
);

-- Indexes for jobs
CREATE INDEX IF NOT EXISTS idx_data_jobs_type ON data_collection_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_data_jobs_status ON data_collection_jobs(status);
CREATE INDEX IF NOT EXISTS idx_data_jobs_started ON data_collection_jobs(started_at);

-- ---------------------------------------------------------------------------
-- Update Trigger Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_markets_updated_at ON markets;
CREATE TRIGGER update_markets_updated_at
    BEFORE UPDATE ON markets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Active markets with latest prices
CREATE OR REPLACE VIEW active_markets_with_prices AS
SELECT 
    m.*,
    mp.yes_bid,
    mp.yes_ask,
    mp.no_bid,
    mp.no_ask,
    mp.yes_mid,
    mp.no_mid,
    mp.volume,
    mp.open_interest,
    mp.recorded_at as price_updated_at
FROM markets m
LEFT JOIN LATERAL (
    SELECT * FROM market_prices
    WHERE market_id = m.id
    ORDER BY recorded_at DESC
    LIMIT 1
) mp ON true
WHERE m.status = 'active';

-- Open positions with market info
CREATE OR REPLACE VIEW open_positions_with_markets AS
SELECT 
    p.*,
    m.ticker,
    m.title,
    m.category,
    m.close_date as market_expiration,
    mp.yes_mid as current_yes_price,
    mp.no_mid as current_no_price,
    CASE 
        WHEN p.side = 'yes' THEN p.contracts * (COALESCE(mp.yes_mid, 50) - p.avg_entry_price)
        WHEN p.side = 'no' THEN p.contracts * (COALESCE(mp.no_mid, 50) - p.avg_entry_price)
        ELSE 0
    END as calculated_unrealized_pnl
FROM positions p
JOIN markets m ON p.market_id = m.id
LEFT JOIN LATERAL (
    SELECT yes_mid, no_mid FROM market_prices
    WHERE market_id = m.id
    ORDER BY recorded_at DESC
    LIMIT 1
) mp ON true
WHERE p.status = 'open';

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
COMMENT ON TABLE markets IS 'Kalshi market definitions';
COMMENT ON TABLE market_prices IS 'Price snapshots from Kalshi';
COMMENT ON TABLE price_candles IS 'OHLCV candle data for charting';
COMMENT ON TABLE positions IS 'Trading positions';
COMMENT ON TABLE orders IS 'Order history';
COMMENT ON TABLE trades IS 'Individual trade fills';
COMMENT ON TABLE portfolio_snapshots IS 'Daily portfolio value snapshots';
COMMENT ON TABLE data_collection_jobs IS 'Log of data collection job runs';

-- ============================================================================
