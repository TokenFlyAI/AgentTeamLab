#!/usr/bin/env node
/**
 * P&L Tracker Module
 * 
 * Reads paper_trades.json files and persists trades to SQLite database.
 * Calculates P&L on trade exits and maintains strategy statistics.
 * 
 * Uses better-sqlite3 (synchronous, high-performance SQLite driver)
 * 
 * Usage:
 *   node pnl_tracker.js                    # Process default paper_trade_log.json
 *   node pnl_tracker.js --file <path>      # Process specific file
 *   node pnl_tracker.js --summary          # Show P&L summary
 *   node pnl_tracker.js --strategy <name>  # Show strategy-specific stats
 * 
 * Output:
 *   - SQLite DB: agents/pat/output/paper_trades.db
 *   - Summary JSON: agents/pat/output/pnl_summary.json
 */

const fs = require('fs');
const path = require('path');

// Try to load better-sqlite3 from project root
let Database;
try {
    Database = require('/Users/chenyangcui/Documents/code/aicompany/node_modules/better-sqlite3');
} catch (e) {
    console.error('Error: better-sqlite3 module not found.');
    console.error('Please install: npm install better-sqlite3');
    process.exit(1);
}

// Configuration
const DB_PATH = path.join(__dirname, "paper_trades.db");
const DEFAULT_TRADE_FILE = path.join(__dirname, '..', '..', 'bob', 'output', 'paper_trade_log.json');
const GRACE_TRADE_FILE = path.join(__dirname, '..', '..', 'grace', 'output', 'paper_trade_log.json');

// Generate unique trade UUID
function generateTradeUUID() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `TRADE-${timestamp}-${random}`;
}

// Initialize database schema
function initDatabase(db) {
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schemaSQL);
    console.log('✓ Database initialized');
}

// Parse trade file and extract trades
function parseTradeFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Trade file not found: ${filePath}`);
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const trades = [];
    const sourceFile = filePath;

    // Handle different file formats
    if (data.trades && Array.isArray(data.trades)) {
        // Bob's format: { trades: [...] }
        for (const trade of data.trades) {
            trades.push({
                ticker: trade.ticker,
                market_title: null,
                direction: trade.side,
                entry_price: trade.price,
                exit_price: null,
                contracts: trade.contracts,
                strategy: trade.strategy,
                signal_confidence: null,
                status: 'open',
                source_file: sourceFile,
                entry_timestamp: trade.timestamp,
                exit_timestamp: null
            });
        }
    } else if (data.runs && Array.isArray(data.runs)) {
        // Grace's format: { runs: [{ signals: [...] }] }
        for (const run of data.runs) {
            if (run.signals && Array.isArray(run.signals)) {
                for (const signal of run.signals) {
                    if (signal.signalType === 'entry') {
                        trades.push({
                            ticker: signal.ticker,
                            market_title: null,
                            direction: signal.side,
                            entry_price: signal.currentPrice,
                            exit_price: null,
                            contracts: signal.recommendedContracts || 1,
                            strategy: signal.strategy,
                            signal_confidence: signal.confidence,
                            status: 'open',
                            source_file: sourceFile,
                            entry_timestamp: run.generatedAt || data.generatedAt,
                            exit_timestamp: null
                        });
                    }
                }
            }
        }
    } else if (data.signals && Array.isArray(data.signals)) {
        // Direct signals array
        for (const signal of data.signals) {
            if (signal.signalType === 'entry') {
                trades.push({
                    ticker: signal.ticker,
                    market_title: null,
                    direction: signal.side,
                    entry_price: signal.currentPrice,
                    exit_price: null,
                    contracts: signal.recommendedContracts || 1,
                    strategy: signal.strategy,
                    signal_confidence: signal.confidence,
                    status: 'open',
                    source_file: sourceFile,
                    entry_timestamp: signal.timestamp || data.generatedAt,
                    exit_timestamp: null
                });
            }
        }
    }

    return { trades, sourceFile };
}

// Insert or update trades in database
function syncTrades(db, trades) {
    const insertStmt = db.prepare(`
        INSERT INTO paper_trades (
            trade_uuid, ticker, market_title, direction, entry_price, exit_price,
            contracts, strategy, signal_confidence, status, source_file,
            entry_timestamp, exit_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const checkStmt = db.prepare(
        `SELECT trade_id FROM paper_trades 
         WHERE ticker = ? AND entry_timestamp = ? AND strategy = ?`
    );

    let inserted = 0;
    let skipped = 0;

    const insertTrade = db.transaction((trade) => {
        // Check if trade already exists
        const existing = checkStmt.get(trade.ticker, trade.entry_timestamp, trade.strategy);
        if (existing) {
            skipped++;
            return;
        }

        const tradeUUID = generateTradeUUID();
        insertStmt.run(
            tradeUUID, trade.ticker, trade.market_title, trade.direction,
            trade.entry_price, trade.exit_price, trade.contracts, trade.strategy,
            trade.signal_confidence, trade.status, trade.source_file,
            trade.entry_timestamp, trade.exit_timestamp
        );
        inserted++;
    });

    for (const trade of trades) {
        insertTrade(trade);
    }

    return { inserted, skipped };
}

// Simulate closing trades for demo purposes (calculates hypothetical P&L)
function simulateTradeExits(db) {
    const openTrades = db.prepare(
        `SELECT trade_id, ticker, direction, entry_price, contracts, strategy 
         FROM paper_trades WHERE status = 'open'`
    ).all();

    const updateStmt = db.prepare(`
        UPDATE paper_trades 
        SET status = 'closed',
            exit_price = ?,
            exit_timestamp = datetime('now'),
            pnl = ROUND(?, 2),
            pnl_percent = ROUND(?, 4)
        WHERE trade_id = ?
    `);

    let closed = 0;

    const closeTrade = db.transaction((trade) => {
        // Simulate random exit price (±10% variance from entry)
        const variance = (Math.random() - 0.5) * 20; // -10% to +10%
        let exitPrice = Math.round(trade.entry_price + variance);
        exitPrice = Math.max(1, Math.min(99, exitPrice)); // Clamp to valid range

        // Calculate P&L
        const positionValue = trade.contracts * trade.entry_price / 100.0;
        const exitValue = trade.contracts * exitPrice / 100.0;
        let pnl = 0;

        if (trade.direction === 'yes') {
            pnl = exitValue - positionValue;
        } else {
            // For "no" positions, profit when price goes down
            pnl = positionValue - exitValue;
        }

        const pnlPercent = positionValue > 0 ? (pnl / positionValue) * 100 : 0;

        updateStmt.run(exitPrice, pnl, pnlPercent, trade.trade_id);
        closed++;
    });

    for (const trade of openTrades) {
        closeTrade(trade);
    }

    return closed;
}

// Update strategy statistics
function updateStrategyStats(db) {
    const stats = db.prepare(`
        SELECT 
            strategy,
            COUNT(*) as total_trades,
            SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as win_count,
            SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as loss_count,
            SUM(pnl) as total_pnl,
            AVG(pnl) as avg_pnl,
            MAX(entry_timestamp) as last_trade_at
        FROM paper_trades
        WHERE status = 'closed'
        GROUP BY strategy
    `).all();

    const upsertStmt = db.prepare(`
        INSERT INTO strategy_stats (
            strategy_name, total_trades, win_count, loss_count,
            total_pnl, avg_pnl_per_trade, last_trade_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(strategy_name) DO UPDATE SET
            total_trades = excluded.total_trades,
            win_count = excluded.win_count,
            loss_count = excluded.loss_count,
            total_pnl = excluded.total_pnl,
            avg_pnl_per_trade = excluded.avg_pnl_per_trade,
            last_trade_at = excluded.last_trade_at,
            updated_at = datetime('now')
    `);

    const updateStats = db.transaction((stat) => {
        upsertStmt.run(
            stat.strategy, stat.total_trades, stat.win_count, stat.loss_count,
            stat.total_pnl, stat.avg_pnl, stat.last_trade_at
        );
    });

    for (const stat of stats) {
        updateStats(stat);
    }

    return stats.length;
}

// Generate P&L summary
function generateSummary(db) {
    const summary = db.prepare(`
        SELECT 
            COUNT(*) as total_trades,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_positions,
            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_positions,
            SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as win_count,
            SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as loss_count,
            ROUND(SUM(pnl), 2) as total_pnl,
            ROUND(AVG(pnl), 2) as avg_pnl,
            ROUND(MAX(pnl), 2) as best_trade,
            ROUND(MIN(pnl), 2) as worst_trade
        FROM paper_trades
    `).get();

    const winRate = summary.closed_positions > 0
        ? (summary.win_count / summary.closed_positions * 100).toFixed(2)
        : 0;

    return { ...summary, win_rate: winRate };
}

// Print summary to console
function printSummary(summary) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║           P&L TRACKER SUMMARY                          ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║ Total Trades:      ${(summary.total_trades || 0).toString().padEnd(36)} ║`);
    console.log(`║ Open Positions:    ${(summary.open_positions || 0).toString().padEnd(36)} ║`);
    console.log(`║ Closed Positions:  ${(summary.closed_positions || 0).toString().padEnd(36)} ║`);
    console.log(`║ Win Count:         ${(summary.win_count || 0).toString().padEnd(36)} ║`);
    console.log(`║ Loss Count:        ${(summary.loss_count || 0).toString().padEnd(36)} ║`);
    console.log(`║ Win Rate:          ${(summary.win_rate || 0).toString().padEnd(36)} ║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║ Total P&L:         ${(summary.total_pnl || 0).toString().padEnd(35)} ║`);
    console.log(`║ Avg P&L/Trade:     ${(summary.avg_pnl || 0).toString().padEnd(35)} ║`);
    console.log(`║ Best Trade:        ${(summary.best_trade || 0).toString().padEnd(35)} ║`);
    console.log(`║ Worst Trade:       ${(summary.worst_trade || 0).toString().padEnd(35)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
}

// Show strategy breakdown
function showStrategyBreakdown(db) {
    const stats = db.prepare('SELECT * FROM v_strategy_performance').all();
    
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    STRATEGY PERFORMANCE                              ║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    console.log('║ Strategy          | Trades | Win% | Total P&L | Best   | Worst      ║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    
    for (const row of stats) {
        const name = (row.strategy || 'unknown').padEnd(17).substring(0, 17);
        const trades = (row.total_trades || 0).toString().padStart(6);
        const winRate = (row.win_rate || 0).toString().padStart(4);
        const pnl = ('$' + (row.total_pnl || 0)).padStart(9);
        const best = ('$' + (row.best_trade || 0)).padStart(6);
        const worst = ('$' + (row.worst_trade || 0)).padStart(6);
        console.log(`║ ${name} | ${trades} | ${winRate}% | ${pnl} | ${best} | ${worst}   ║`);
    }
    
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
}

// Show daily breakdown
function showDailyBreakdown(db) {
    const rows = db.prepare('SELECT * FROM v_daily_pnl LIMIT 10').all();
    
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                      DAILY P&L BREAKDOWN                           ║');
    console.log('╠════════════════════════════════════════════════════════════════════╣');
    console.log('║ Date       | Trades | Closed | Wins | Losses | Daily P&L          ║');
    console.log('╠════════════════════════════════════════════════════════════════════╣');
    
    for (const row of rows) {
        const date = (row.trade_date || 'N/A').padEnd(10);
        const trades = (row.trades_count || 0).toString().padStart(6);
        const closed = (row.closed_count || 0).toString().padStart(6);
        const wins = (row.wins || 0).toString().padStart(4);
        const losses = (row.losses || 0).toString().padStart(6);
        const pnl = ('$' + (row.daily_pnl || 0)).padStart(10);
        console.log(`║ ${date} | ${trades} | ${closed} | ${wins} | ${losses} | ${pnl}     ║`);
    }
    
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
}

// Main function
function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    
    // Open database
    const db = new Database(DB_PATH);
    
    try {
        // Initialize database
        initDatabase(db);

        if (cmd === '--summary' || cmd === '-s') {
            // Show summary only
            const summary = generateSummary(db);
            printSummary(summary);
            showStrategyBreakdown(db);
            showDailyBreakdown(db);
        } else if (cmd === '--strategy') {
            // Show specific strategy stats
            const strategyName = args[1];
            const stats = db.prepare(
                'SELECT * FROM v_strategy_performance WHERE strategy = ?'
            ).all(strategyName);
            console.log(`\nStrategy: ${strategyName}`);
            console.table(stats);
        } else {
            // Process trade files
            let tradeFile = DEFAULT_TRADE_FILE;
            if (cmd === '--file' || cmd === '-f') {
                tradeFile = args[1];
            }

            console.log(`\nProcessing trade file: ${tradeFile}`);
            
            // Parse and sync trades
            const { trades, sourceFile } = parseTradeFile(tradeFile);
            console.log(`Found ${trades.length} trades in ${sourceFile}`);

            if (trades.length > 0) {
                const { inserted, skipped } = syncTrades(db, trades);
                console.log(`✓ Inserted: ${inserted}, Skipped (duplicates): ${skipped}`);

                // Simulate exits for demo (in production, these would come from actual closes)
                const closed = simulateTradeExits(db);
                console.log(`✓ Simulated ${closed} trade exits for P&L calculation`);

                // Update strategy stats
                const strategyCount = updateStrategyStats(db);
                console.log(`✓ Updated statistics for ${strategyCount} strategies`);

                // Generate and print summary
                const summary = generateSummary(db);
                printSummary(summary);
                showStrategyBreakdown(db);

                // Save summary to JSON
                const summaryPath = path.join(__dirname, 'pnl_summary.json');
                fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
                console.log(`✓ Summary saved to: ${summaryPath}`);
            } else {
                console.log('No trades to process');
            }
        }

    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

// Run main
main();
