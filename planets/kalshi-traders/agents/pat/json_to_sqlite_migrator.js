/**
 * JSON to SQLite Migrator for D004 Pipeline
 * Author: Pat (Database Engineer)
 * Task: T962 - Migrate legacy JSON data to persistent relational schema (v3)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Configuration
const DB_PATH = 'pipeline_v3.db';
const SCHEMA_PATH = 'schema_v3_sqlite.sql';
const DATA_PATHS = {
    filtered_markets: '../grace/output/filtered_markets_live_fixture.json',
    market_clusters: '../ivan/output/market_clusters.json',
    correlation_pairs: '../bob/output/correlation_pairs.json',
    trade_signals: '../bob/output/trade_signals.json',
    paper_trade_log: '../bob/output/paper_trade_log.json'
};

const db = new Database(DB_PATH);

function initSchema() {
    console.log(`Initializing schema from ${SCHEMA_PATH}...`);
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    console.log('Schema initialized.');
}

function migrate() {
    console.log('Starting migration...');

    // 1. Create a dummy pipeline run for existing data
    const run_id = `legacy_${new Date().toISOString().replace(/[:.-]/g, '_')}`;
    const sprint_id = 'Sprint-7-Legacy';
    
    db.prepare('INSERT INTO pipeline_runs (run_id, sprint_id, status, metadata) VALUES (?, ?, ?, ?)')
      .run(run_id, sprint_id, 'success', JSON.stringify({ note: 'Migrated from legacy JSON files' }));

    // 2. Migrate Phase 1: Filtered Markets
    if (fs.existsSync(DATA_PATHS.filtered_markets)) {
        console.log('Migrating filtered markets...');
        const data = JSON.parse(fs.readFileSync(DATA_PATHS.filtered_markets, 'utf8'));
        const markets = data.qualifying_markets || [];
        const insert = db.prepare(`
            INSERT INTO filtered_markets (run_id, ticker, title, category, volume, yes_bid, yes_ask, yes_ratio, recommendation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        db.transaction((items) => {
            for (const m of items) {
                insert.run(
                    run_id, 
                    m.ticker, 
                    m.title, 
                    m.category, 
                    m.volume, 
                    m.yes_bid, 
                    m.yes_ask, 
                    m.yes_ratio, 
                    m.recommendation
                );
            }
        })(markets);
        console.log(`Migrated ${markets.length} markets.`);
    }

    // 3. Migrate Phase 2: Clusters
    if (fs.existsSync(DATA_PATHS.market_clusters)) {
        console.log('Migrating market clusters...');
        const data = JSON.parse(fs.readFileSync(DATA_PATHS.market_clusters, 'utf8'));
        const clusters = data.clusters || [];
        
        const insertCluster = db.prepare(`
            INSERT INTO market_clusters (run_id, cluster_name, description, confidence_score)
            VALUES (?, ?, ?, ?)
        `);
        const insertMember = db.prepare(`
            INSERT INTO cluster_members (cluster_id, market_ticker)
            VALUES (?, ?)
        `);

        db.transaction((items) => {
            for (const c of items) {
                const info = insertCluster.run(run_id, c.label, c.description, c.confidence);
                const cluster_id = info.lastInsertRowid;
                for (const ticker of c.markets) {
                    insertMember.run(cluster_id, ticker);
                }
            }
        })(clusters);
        console.log(`Migrated ${clusters.length} clusters.`);
    }

    // 4. Migrate Phase 3: Correlation Pairs
    if (fs.existsSync(DATA_PATHS.correlation_pairs)) {
        console.log('Migrating correlation pairs...');
        const data = JSON.parse(fs.readFileSync(DATA_PATHS.correlation_pairs, 'utf8'));
        const pairs = data.all_pairs || [];
        const insert = db.prepare(`
            INSERT INTO correlation_pairs (run_id, market_a, market_b, pearson_r, expected_spread, current_spread, arbitrage_confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        db.transaction((items) => {
            for (const p of items) {
                insert.run(
                    run_id, 
                    p.market1, 
                    p.market2, 
                    p.pearson_r, 
                    p.spread_mean, 
                    p.spread_zscore * p.spread_std + p.spread_mean, // approximate current spread
                    p.arbitrage ? p.arbitrage.confidence_discount : 0
                );
            }
        })(pairs);
        console.log(`Migrated ${pairs.length} pairs.`);
    }

    // 5. Migrate Phase 4: Trade Signals
    if (fs.existsSync(DATA_PATHS.trade_signals)) {
        console.log('Migrating trade signals...');
        const data = JSON.parse(fs.readFileSync(DATA_PATHS.trade_signals, 'utf8'));
        const signals = data.signals || [];
        const insert = db.prepare(`
            INSERT INTO trade_signals (run_id, ticker, direction, confidence, suggested_price, suggested_size, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        db.transaction((items) => {
            for (const s of items) {
                insert.run(
                    run_id, 
                    s.ticker, 
                    s.side.toUpperCase(), 
                    s.confidence, 
                    s.targetPrice, 
                    s.size || 1, 
                    'acted'
                );
            }
        })(signals);
        console.log(`Migrated ${signals.length} signals.`);
    }

    // 6. Migrate Trade Logs
    if (fs.existsSync(DATA_PATHS.paper_trade_log)) {
        console.log('Migrating paper trades...');
        const trades = JSON.parse(fs.readFileSync(DATA_PATHS.paper_trade_log, 'utf8'));
        const insert = db.prepare(`
            INSERT INTO paper_trades (id, market, direction, contracts, entry_price, exit_price, status, pnl, outcome, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        db.transaction((items) => {
            for (const t of items) {
                insert.run(
                    t.id || `pt_${t.timestamp}_${Math.floor(Math.random()*1000)}`,
                    t.market || t.ticker,
                    t.direction || t.side,
                    t.contracts || t.size,
                    t.entry_price || t.price,
                    t.exit_price || null,
                    t.status || 'CLOSED',
                    t.pnl || 0,
                    t.outcome || (t.pnl > 0 ? 'WIN' : (t.pnl < 0 ? 'LOSS' : 'BREAKEVEN')),
                    JSON.stringify(t)
                );
            }
        })(trades);
        console.log(`Migrated ${trades.length} trades.`);
    }

    console.log('Migration complete.');
}

try {
    initSchema();
    migrate();
} catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
} finally {
    db.close();
}
