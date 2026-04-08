#!/usr/bin/env node
/**
 * Ingestion Script for Unified Trading Database
 * 
 * Migrates data from Phase 1-4 JSON files into SQLite.
 */

const fs = require('fs');
const path = require('path');

// Load better-sqlite3
let Database;
try {
    // Attempt multiple possible locations for the module
    const paths = [
        '/Users/chenyangcui/Documents/code/aicompany/node_modules/better-sqlite3',
        path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'better-sqlite3'),
        'better-sqlite3'
    ];
    for (const p of paths) {
        try {
            Database = require(p);
            if (Database) break;
        } catch (e) {}
    }
    if (!Database) throw new Error('better-sqlite3 not found');
} catch (e) {
    console.error('Error: better-sqlite3 module not found. Please install it.');
    process.exit(1);
}

const DB_PATH = path.join(__dirname, 'unified_trading.db');
const SCHEMA_PATH = path.join(__dirname, 'unified_trading_schema.sql');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Initialize database
function init() {
    console.log('Initializing database...');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    console.log('✓ Schema applied');
}

// Ingest Phase 1: Filtered Markets
function ingestPhase1(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`! Phase 1 file not found: ${filePath}`);
        return;
    }
    console.log(`Ingesting Phase 1: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    const runInfo = db.prepare(`
        INSERT INTO pipeline_runs (task_id, phase, source, config_json, summary_json, run_timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        data.task || 'unknown',
        'Phase 1',
        data.source || path.basename(filePath),
        JSON.stringify(data.config || {}),
        JSON.stringify(data.summary || {}),
        data.generated_at || new Date().toISOString()
    );
    const runId = runInfo.lastInsertRowid;

    const upsertMarket = db.prepare(`
        INSERT INTO markets (ticker, title, category)
        VALUES (?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
            title = excluded.title,
            category = excluded.category
    `);

    const insertDataPoint = db.prepare(`
        INSERT INTO market_data_points (ticker, run_id, volume, yes_bid, yes_ask, no_bid, no_ask, yes_ratio, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFilterResult = db.prepare(`
        INSERT INTO market_filter_results (run_id, ticker, is_qualifying, recommendation, exclusion_reason)
        VALUES (?, ?, ?, ?, ?)
    `);

    const timestamp = data.generated_at || new Date().toISOString();

    // Ingest qualifying markets
    (data.qualifying_markets || []).forEach(m => {
        upsertMarket.run(m.ticker, m.title, m.category);
        insertDataPoint.run(m.ticker, runId, m.volume, m.yes_bid, m.yes_ask, m.no_bid, m.no_ask, m.yes_ratio, timestamp);
        insertFilterResult.run(runId, m.ticker, 1, m.recommendation, null);
    });

    // Ingest excluded markets
    (data.excluded_markets || []).forEach(m => {
        upsertMarket.run(m.ticker, m.title, m.category);
        insertDataPoint.run(m.ticker, runId, m.volume || null, null, null, null, null, m.yes_ratio, timestamp);
        insertFilterResult.run(runId, m.ticker, 0, 'excluded', m.reason);
    });

    console.log(`✓ Phase 1 ingested: ${runId}`);
    return runId;
}

// Ingest Phase 2: Clusters
function ingestPhase2(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`! Phase 2 file not found: ${filePath}`);
        return;
    }
    console.log(`Ingesting Phase 2: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const runInfo = db.prepare(`
        INSERT INTO pipeline_runs (task_id, phase, source, config_json, summary_json, run_timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        data.task || 'unknown',
        'Phase 2',
        'ivan_clustering',
        JSON.stringify({ method: data.method, features: data.features }),
        JSON.stringify({ cluster_count: (data.clusters || []).length }),
        data.generated_at || new Date().toISOString()
    );
    const runId = runInfo.lastInsertRowid;

    const insertCluster = db.prepare(`
        INSERT INTO clusters (run_id, cluster_id, label, description, strength, confidence, stability, cohesion, separation, avg_volatility, avg_sentiment, is_cross_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertMarket = db.prepare(`
        INSERT INTO markets (ticker)
        VALUES (?)
        ON CONFLICT(ticker) DO UPDATE SET ticker = ticker
    `);

    const insertMember = db.prepare(`
        INSERT INTO cluster_members (cluster_db_id, ticker, is_uncertain)
        VALUES (?, ?, ?)
    `);

    (data.clusters || []).forEach(c => {
        const clusterInfo = insertCluster.run(
            runId, c.id, c.label, c.description, c.strength, c.confidence, c.stability, c.cohesion, c.separation, c.avg_volatility, c.avg_sentiment, c.cross_category ? 1 : 0
        );
        const clusterDbId = clusterInfo.lastInsertRowid;

        (c.markets || []).forEach(ticker => {
            upsertMarket.run(ticker);
            insertMember.run(clusterDbId, ticker, 0);
        });

        (c.uncertain_markets || []).forEach(ticker => {
            upsertMarket.run(ticker);
            insertMember.run(clusterDbId, ticker, 1);
        });
    });

    console.log(`✓ Phase 2 ingested: ${runId}`);
    return runId;
}

// Ingest Phase 3: Correlation
function ingestPhase3(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`! Phase 3 file not found: ${filePath}`);
        return;
    }
    console.log(`Ingesting Phase 3: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const runInfo = db.prepare(`
        INSERT INTO pipeline_runs (task_id, phase, source, config_json, summary_json, run_timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        data.task || 'unknown',
        'Phase 3',
        'bob_correlation',
        JSON.stringify(data.parameters || {}),
        JSON.stringify(data.summary || {}),
        data.generated_at || new Date().toISOString()
    );
    const runId = runInfo.lastInsertRowid;

    const upsertMarket = db.prepare(`
        INSERT INTO markets (ticker)
        VALUES (?)
        ON CONFLICT(ticker) DO UPDATE SET ticker = ticker
    `);

    const insertPair = db.prepare(`
        INSERT INTO correlation_pairs (run_id, cluster_id, market_a, market_b, pearson_r, expected_spread, current_spread, spread_pct, confidence, direction, is_arbitrage_opportunity, volume_min)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    (data.pairs || []).forEach(p => {
        upsertMarket.run(p.market_a);
        upsertMarket.run(p.market_b);
        insertPair.run(
            runId, p.cluster, p.market_a, p.market_b, p.pearson_r, p.expected_spread, p.current_spread, p.spread_pct, p.confidence, p.direction, p.is_arbitrage_opportunity ? 1 : 0, p.volume_min
        );
    });

    console.log(`✓ Phase 3 ingested: ${runId}`);
    return runId;
}

// Ingest Phase 4: Signals
function ingestPhase4(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`! Phase 4 file not found: ${filePath}`);
        return;
    }
    console.log(`Ingesting Phase 4: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const runInfo = db.prepare(`
        INSERT INTO pipeline_runs (task_id, phase, source, config_json, summary_json, run_timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        'T852', // Default task for Phase 4
        'Phase 4',
        data.source || 'dave_execution',
        JSON.stringify({ stopLoss: data.stopLoss, capitalFloor: data.capitalFloor }),
        JSON.stringify({ signalCount: data.signalCount, executed: data.executed }),
        data.generatedAt || new Date().toISOString()
    );
    const runId = runInfo.lastInsertRowid;

    const upsertMarket = db.prepare(`
        INSERT INTO markets (ticker)
        VALUES (?)
        ON CONFLICT(ticker) DO UPDATE SET ticker = ticker
    `);

    const upsertStrategy = db.prepare(`
        INSERT INTO strategies (strategy_name, strategy_type)
        VALUES (?, ?)
        ON CONFLICT(strategy_name) DO UPDATE SET strategy_name = strategy_name
    `);

    const getStrategyId = db.prepare('SELECT strategy_id FROM strategies WHERE strategy_name = ?');

    const insertSignal = db.prepare(`
        INSERT INTO signals (run_id, strategy_id, ticker, side, signal_type, confidence, target_price, current_price, metadata_json, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    (data.signals || []).forEach(s => {
        upsertMarket.run(s.ticker);
        upsertStrategy.run(s.strategy, 'technical');
        const strategyId = getStrategyId.get(s.strategy).strategy_id;
        
        insertSignal.run(
            runId, strategyId, s.ticker, s.side, s.signalType, s.confidence, s.targetPrice, s.currentPrice, 
            JSON.stringify(s.metadata || {}), data.generatedAt || new Date().toISOString()
        );
    });

    console.log(`✓ Phase 4 ingested: ${runId}`);
    return runId;
}

// Main execution
try {
    init();
    
    // Default paths based on investigation
    const root = path.join(__dirname, '..', '..');
    const phase1 = path.join(root, 'output', 'grace', 'filtered_markets_live_fixture.json');
    const phase2 = path.join(root, 'output', 'ivan', 'market_clusters.json');
    const phase3 = path.join(root, 'output', 'bob', 'correlation_pairs.json');
    const phase4 = path.join(root, 'output', 'bob', 'trade_signals.json');

    ingestPhase1(phase1);
    ingestPhase2(phase2);
    ingestPhase3(phase3);
    ingestPhase4(phase4);

    console.log('\nFinal Summary:');
    const runs = db.prepare('SELECT phase, count(*) as count FROM pipeline_runs GROUP BY phase').all();
    runs.forEach(r => console.log(`- ${r.phase}: ${r.count} runs`));
    
    const markets = db.prepare('SELECT count(*) as count FROM markets').get();
    console.log(`- Total Markets: ${markets.count}`);

} catch (err) {
    console.error('Error during ingestion:', err);
    process.exit(1);
}
