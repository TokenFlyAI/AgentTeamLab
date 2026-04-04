/**
 * PnL Calculation Unit Tests
 * Pat (Database Engineer) — Task 286: Sprint 2
 *
 * Tests for PnL calculation logic that generates pnl_summary.json from paper_trades.db
 * Run: node tests/unit/pnl/pnl_calculation.test.js
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require('/Users/chenyangcui/Documents/code/aicompany/node_modules/better-sqlite3');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function eq(a, b, msg) {
  assert.deepStrictEqual(a, b, msg);
}

function ok(v, msg) {
  assert.ok(v, msg);
}

function approx(a, b, epsilon = 0.01, msg) {
  const diff = Math.abs(a - b);
  if (diff > epsilon) {
    throw new Error(msg || `Expected ${a} to be approximately ${b} (diff: ${diff})`);
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createTestDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pnl-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const db = new Database(dbPath);
  
  // Create schema
  db.exec(`
    CREATE TABLE paper_trades (
      trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_uuid TEXT UNIQUE NOT NULL,
      ticker TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('yes', 'no', 'hold')),
      entry_price INTEGER NOT NULL,
      exit_price INTEGER,
      contracts INTEGER NOT NULL,
      pnl REAL,
      pnl_percent REAL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired', 'cancelled')),
      entry_timestamp TEXT NOT NULL,
      exit_timestamp TEXT
    );
    
    CREATE INDEX idx_trades_status ON paper_trades(status);
    CREATE INDEX idx_trades_strategy ON paper_trades(strategy);
  `);
  
  return { db, tmpDir, dbPath };
}

function cleanup({ tmpDir }) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function insertTrade(db, trade) {
  const stmt = db.prepare(`
    INSERT INTO paper_trades (trade_uuid, ticker, direction, entry_price, exit_price, 
      contracts, pnl, pnl_percent, strategy, status, entry_timestamp, exit_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const uuid = `TRADE-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  stmt.run(
    uuid,
    trade.ticker,
    trade.direction,
    trade.entry_price,
    trade.exit_price || null,
    trade.contracts,
    trade.pnl || null,
    trade.pnl_percent || null,
    trade.strategy,
    trade.status,
    trade.entry_timestamp,
    trade.exit_timestamp || null
  );
}

// ---------------------------------------------------------------------------
// PnL calculation functions (extracted from pnl_tracker.js for testing)
// ---------------------------------------------------------------------------

function calculateTradePnL(direction, entryPrice, exitPrice, contracts) {
  const positionValue = contracts * entryPrice / 100.0;
  const exitValue = contracts * exitPrice / 100.0;
  
  if (direction === 'yes') {
    return exitValue - positionValue;
  } else {
    // For "no" positions, profit when price goes down
    return positionValue - exitValue;
  }
}

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

function getOpenPositions(db) {
  return db.prepare(`
    SELECT ticker, direction, entry_price, contracts, strategy, pnl
    FROM paper_trades WHERE status = 'open'
  `).all();
}

function getClosedTrades(db) {
  return db.prepare(`
    SELECT ticker, direction, entry_price, exit_price, contracts, pnl, pnl_percent
    FROM paper_trades WHERE status = 'closed'
  `).all();
}

// ---------------------------------------------------------------------------
// Tests: PnL Calculation Correctness
// ---------------------------------------------------------------------------

console.log("\n╔════════════════════════════════════════════════════════════╗");
console.log("║     PnL CALCULATION UNIT TESTS — Task 286                  ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

// Test 1: Basic YES position PnL
test("YES position: profit when price goes up", () => {
  // Buy YES at 50, exit at 70 -> profit
  const pnl = calculateTradePnL('yes', 50, 70, 100);
  // Position value: 100 * 50 / 100 = $50
  // Exit value: 100 * 70 / 100 = $70
  // PnL: $70 - $50 = $20
  approx(pnl, 20.0, 0.01, "Expected $20 profit for YES position going from 50 to 70");
});

test("YES position: loss when price goes down", () => {
  // Buy YES at 60, exit at 40 -> loss
  const pnl = calculateTradePnL('yes', 60, 40, 100);
  // Position value: $60, Exit value: $40, PnL: -$20
  approx(pnl, -20.0, 0.01, "Expected $20 loss for YES position going from 60 to 40");
});

// Test 2: Basic NO position PnL
test("NO position: profit when price goes down", () => {
  // Buy NO at 60 (equivalent to YES at 40), exit at 40 (YES at 60)
  // NO position profits when the NO price decreases
  const pnl = calculateTradePnL('no', 60, 40, 100);
  // Position value: 100 * 60 / 100 = $60
  // Exit value: 100 * 40 / 100 = $40
  // For NO: PnL = positionValue - exitValue = $60 - $40 = $20 profit
  approx(pnl, 20.0, 0.01, "Expected $20 profit for NO position going from 60 to 40");
});

test("NO position: loss when price goes up", () => {
  const pnl = calculateTradePnL('no', 40, 60, 100);
  // Position: $40, Exit: $60, PnL: $40 - $60 = -$20
  approx(pnl, -20.0, 0.01, "Expected $20 loss for NO position going from 40 to 60");
});

// Test 3: Break-even
test("Position breaks even at same price", () => {
  const pnlYes = calculateTradePnL('yes', 50, 50, 100);
  const pnlNo = calculateTradePnL('no', 50, 50, 100);
  eq(pnlYes, 0, "YES position should break even");
  eq(pnlNo, 0, "NO position should break even");
});

// Test 4: Different contract sizes
test("PnL scales with contract count", () => {
  const pnl10 = calculateTradePnL('yes', 50, 60, 10);
  const pnl100 = calculateTradePnL('yes', 50, 60, 100);
  approx(pnl100, pnl10 * 10, 0.01, "PnL should scale linearly with contracts");
});

// ---------------------------------------------------------------------------
// Tests: Database Integration
// ---------------------------------------------------------------------------

console.log("\n--- Database Integration Tests ---\n");

// Test 5: Empty database
test("Empty database returns zero summary", () => {
  const { db, tmpDir } = createTestDb();
  try {
    const summary = generateSummary(db);
    eq(summary.total_trades, 0, "Total trades should be 0");
    eq(summary.open_positions === null ? 0 : summary.open_positions, 0, "Open positions should be 0");
    eq(summary.closed_positions === null ? 0 : summary.closed_positions, 0, "Closed positions should be 0");
    eq(summary.total_pnl, null, "Total PnL should be null for empty DB");
    eq(summary.win_rate, 0, "Win rate should be 0 for empty DB");
  } finally {
    cleanup({ tmpDir });
  }
});

// Test 6: Single closed trade
test("Single closed YES trade summary", () => {
  const { db, tmpDir } = createTestDb();
  try {
    insertTrade(db, {
      ticker: 'TEST-1',
      direction: 'yes',
      entry_price: 50,
      exit_price: 70,
      contracts: 100,
      pnl: 20.0,
      pnl_percent: 40.0,
      strategy: 'mean_reversion',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z',
      exit_timestamp: '2026-04-03T11:00:00Z'
    });
    
    const summary = generateSummary(db);
    eq(summary.total_trades, 1, "Total trades should be 1");
    eq(summary.closed_positions, 1, "Closed positions should be 1");
    eq(summary.win_count, 1, "Win count should be 1");
    eq(summary.loss_count, 0, "Loss count should be 0");
    eq(summary.total_pnl, 20.0, "Total PnL should be $20");
    eq(summary.win_rate, "100.00", "Win rate should be 100%");
  } finally {
    cleanup({ tmpDir });
  }
});

// Test 7: Mixed wins and losses
test("Mixed trades: wins and losses calculated correctly", () => {
  const { db, tmpDir } = createTestDb();
  try {
    // Win: +$20
    insertTrade(db, {
      ticker: 'TEST-1',
      direction: 'yes',
      entry_price: 50,
      exit_price: 70,
      contracts: 100,
      pnl: 20.0,
      strategy: 'mean_reversion',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    // Loss: -$15
    insertTrade(db, {
      ticker: 'TEST-2',
      direction: 'yes',
      entry_price: 60,
      exit_price: 45,
      contracts: 100,
      pnl: -15.0,
      strategy: 'momentum',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    // Win: +$10
    insertTrade(db, {
      ticker: 'TEST-3',
      direction: 'no',
      entry_price: 60,
      exit_price: 40,
      contracts: 50,
      pnl: 10.0,
      strategy: 'mean_reversion',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    const summary = generateSummary(db);
    eq(summary.total_trades, 3, "Total trades should be 3");
    eq(summary.win_count, 2, "Win count should be 2");
    eq(summary.loss_count, 1, "Loss count should be 1");
    eq(summary.total_pnl, 15.0, "Total PnL should be $15 (20 - 15 + 10)");
    eq(summary.best_trade, 20.0, "Best trade should be $20");
    eq(summary.worst_trade, -15.0, "Worst trade should be -$15");
  } finally {
    cleanup({ tmpDir });
  }
});

// Test 8: Open vs closed positions
test("Open positions excluded from PnL calculations", () => {
  const { db, tmpDir } = createTestDb();
  try {
    // Closed trade with PnL
    insertTrade(db, {
      ticker: 'CLOSED-1',
      direction: 'yes',
      entry_price: 50,
      exit_price: 70,
      contracts: 100,
      pnl: 20.0,
      strategy: 'mean_reversion',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    // Open trade (no exit, no PnL yet)
    insertTrade(db, {
      ticker: 'OPEN-1',
      direction: 'yes',
      entry_price: 50,
      exit_price: null,
      contracts: 100,
      pnl: null,
      strategy: 'momentum',
      status: 'open',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    const summary = generateSummary(db);
    eq(summary.total_trades, 2, "Total trades should be 2");
    eq(summary.open_positions, 1, "Open positions should be 1");
    eq(summary.closed_positions, 1, "Closed positions should be 1");
    eq(summary.total_pnl, 20.0, "Total PnL should only include closed trade");
  } finally {
    cleanup({ tmpDir });
  }
});

// Test 9: All losing trades
test("All losing trades: correct negative PnL and zero win rate", () => {
  const { db, tmpDir } = createTestDb();
  try {
    insertTrade(db, {
      ticker: 'LOSE-1',
      direction: 'yes',
      entry_price: 70,
      exit_price: 50,
      contracts: 100,
      pnl: -20.0,
      strategy: 'mean_reversion',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    insertTrade(db, {
      ticker: 'LOSE-2',
      direction: 'no',
      entry_price: 30,
      exit_price: 50,
      contracts: 100,
      pnl: -20.0,
      strategy: 'momentum',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    const summary = generateSummary(db);
    eq(summary.win_count, 0, "Win count should be 0");
    eq(summary.loss_count, 2, "Loss count should be 2");
    eq(summary.total_pnl, -40.0, "Total PnL should be -$40");
    eq(summary.win_rate, "0.00", "Win rate should be 0%");
  } finally {
    cleanup({ tmpDir });
  }
});

// Test 10: Multi-position scenarios
test("Multiple positions in same market", () => {
  const { db, tmpDir } = createTestDb();
  try {
    // Two trades in same market, different directions
    insertTrade(db, {
      ticker: 'BTC-100K',
      direction: 'yes',
      entry_price: 60,
      exit_price: 70,
      contracts: 100,
      pnl: 10.0,
      strategy: 'mean_reversion',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    insertTrade(db, {
      ticker: 'BTC-100K',
      direction: 'no',
      entry_price: 40,
      exit_price: 30,
      contracts: 100,
      pnl: 10.0,
      strategy: 'hedge',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    const summary = generateSummary(db);
    eq(summary.total_trades, 2, "Total trades should be 2");
    eq(summary.total_pnl, 20.0, "Total PnL should be $20");
  } finally {
    cleanup({ tmpDir });
  }
});

// Test 11: Edge case — maximum price values
test("Extreme price movements: 1 to 99 cents", () => {
  const { db, tmpDir } = createTestDb();
  try {
    // Buy YES at 1 cent, sell at 99 cents
    insertTrade(db, {
      ticker: 'MOON',
      direction: 'yes',
      entry_price: 1,
      exit_price: 99,
      contracts: 100,
      pnl: 98.0,
      strategy: 'moonshot',
      status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    const summary = generateSummary(db);
    eq(summary.best_trade, 98.0, "Best trade should capture maximum gain");
    eq(summary.total_pnl, 98.0, "Total PnL should be $98");
  } finally {
    cleanup({ tmpDir });
  }
});

// Test 12: Average PnL calculation
test("Average PnL calculated correctly", () => {
  const { db, tmpDir } = createTestDb();
  try {
    insertTrade(db, {
      ticker: 'T1', direction: 'yes', entry_price: 50, exit_price: 60,
      contracts: 100, pnl: 10.0, strategy: 's1', status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    insertTrade(db, {
      ticker: 'T2', direction: 'yes', entry_price: 50, exit_price: 70,
      contracts: 100, pnl: 20.0, strategy: 's1', status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    insertTrade(db, {
      ticker: 'T3', direction: 'yes', entry_price: 50, exit_price: 40,
      contracts: 100, pnl: -10.0, strategy: 's1', status: 'closed',
      entry_timestamp: '2026-04-03T10:00:00Z'
    });
    
    const summary = generateSummary(db);
    eq(summary.avg_pnl, 6.67, "Average PnL should be (10+20-10)/3 = 6.67");
  } finally {
    cleanup({ tmpDir });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n╔════════════════════════════════════════════════════════════╗");
console.log(`║  RESULTS: ${passed} passed, ${failed} failed                              ║`);
console.log("╚════════════════════════════════════════════════════════════╝\n");

process.exit(failed > 0 ? 1 : 0);
