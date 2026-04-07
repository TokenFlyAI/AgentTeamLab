#!/usr/bin/env node
/**
 * Capital Floor — Post-Trade Safety Check (T587)
 *
 * Prevents negative capital by halting trading when capital drops below $50.
 * Integrates with walk_forward_backtest.js and credential_manager.js audit log.
 *
 * Usage:
 *   const { CapitalFloor } = require('./capital_floor');
 *   const floor = new CapitalFloor({ floor: 50, auditLogger });
 *   floor.check(currentCapital);  // throws if below floor
 *
 * Run standalone:
 *   node capital_floor.js          # run tests
 *
 * Author: Bob (Backend Engineer)
 */

const path = require('path');

const DEFAULT_FLOOR = 50; // $50 minimum capital

class CapitalFloor {
  constructor(options = {}) {
    this.floor = options.floor || DEFAULT_FLOOR;
    this.auditLogger = options.auditLogger || null;
    this.halted = false;
    this.haltReason = null;
    this.tradeCount = 0;
    this.breachHistory = [];
  }

  /**
   * Check capital after a trade. Returns { ok, halted, capital, floor }.
   * If capital < floor, sets halted=true and logs CIRCUIT_BREAK event.
   */
  check(capital, tradeDetails = {}) {
    this.tradeCount++;

    if (this.halted) {
      return {
        ok: false,
        halted: true,
        reason: this.haltReason,
        capital,
        floor: this.floor,
      };
    }

    if (capital < this.floor) {
      this.halted = true;
      this.haltReason = `Capital $${capital.toFixed(2)} below floor $${this.floor}`;

      const breach = {
        timestamp: new Date().toISOString(),
        capital: parseFloat(capital.toFixed(2)),
        floor: this.floor,
        tradeNumber: this.tradeCount,
        ...tradeDetails,
      };
      this.breachHistory.push(breach);

      // Log to audit logger if available
      if (this.auditLogger) {
        this.auditLogger.log('CIRCUIT_BREAK_CAPITAL_FLOOR', {
          capital: parseFloat(capital.toFixed(2)),
          floor: this.floor,
          tradeNumber: this.tradeCount,
          reason: this.haltReason,
          ...tradeDetails,
        });
      }

      return {
        ok: false,
        halted: true,
        reason: this.haltReason,
        capital: parseFloat(capital.toFixed(2)),
        floor: this.floor,
      };
    }

    return {
      ok: true,
      halted: false,
      capital: parseFloat(capital.toFixed(2)),
      floor: this.floor,
    };
  }

  /**
   * Reset the halt state (e.g., after manual review or capital injection).
   */
  reset() {
    this.halted = false;
    this.haltReason = null;
    if (this.auditLogger) {
      this.auditLogger.log('CAPITAL_FLOOR_RESET', { floor: this.floor });
    }
  }

  status() {
    return {
      floor: this.floor,
      halted: this.halted,
      haltReason: this.haltReason,
      tradeCount: this.tradeCount,
      breachCount: this.breachHistory.length,
      breachHistory: this.breachHistory,
    };
  }
}

// --- Tests ---

function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.log(`  FAIL: ${name}`); }
  }

  // Mock audit logger
  const auditLog = [];
  const mockAudit = {
    log(event, details) { auditLog.push({ event, ...details }); }
  };

  console.log('=== Capital Floor Tests (T587) ===\n');

  // Test 1: Normal capital — no halt
  console.log('--- Test 1: Normal capital ---');
  const f1 = new CapitalFloor({ floor: 50, auditLogger: mockAudit });
  const r1 = f1.check(500);
  assert(r1.ok === true, 'Capital $500 is OK');
  assert(r1.halted === false, 'Not halted');

  // Test 2: Capital at floor — still OK
  console.log('--- Test 2: Capital at floor ---');
  const r2 = f1.check(50);
  assert(r2.ok === true, 'Capital $50 (at floor) is OK');

  // Test 3: Capital below floor — halt
  console.log('--- Test 3: Capital below floor ---');
  const r3 = f1.check(49.99, { pair: 'BTC/ETH', signal: 'S001' });
  assert(r3.ok === false, 'Capital $49.99 triggers halt');
  assert(r3.halted === true, 'Halted flag set');
  assert(r3.reason.includes('below floor'), 'Reason mentions below floor');

  // Test 4: Subsequent trades blocked while halted
  console.log('--- Test 4: Subsequent trades blocked ---');
  const r4 = f1.check(200);
  assert(r4.ok === false, 'Still halted even with $200');
  assert(r4.halted === true, 'Halt persists');

  // Test 5: Audit logger received CIRCUIT_BREAK event
  console.log('--- Test 5: Audit log ---');
  const breakEvents = auditLog.filter(e => e.event === 'CIRCUIT_BREAK_CAPITAL_FLOOR');
  assert(breakEvents.length === 1, 'One CIRCUIT_BREAK event logged');
  assert(breakEvents[0].capital === 49.99, 'Logged correct capital');
  assert(breakEvents[0].floor === 50, 'Logged correct floor');
  assert(breakEvents[0].pair === 'BTC/ETH', 'Logged trade details');

  // Test 6: Reset clears halt
  console.log('--- Test 6: Reset ---');
  f1.reset();
  const r6 = f1.check(100);
  assert(r6.ok === true, 'After reset, $100 is OK');
  const resetEvents = auditLog.filter(e => e.event === 'CAPITAL_FLOOR_RESET');
  assert(resetEvents.length === 1, 'Reset event logged');

  // Test 7: Negative capital
  console.log('--- Test 7: Negative capital ---');
  const f7 = new CapitalFloor({ floor: 50, auditLogger: mockAudit });
  const r7 = f7.check(-10);
  assert(r7.ok === false, 'Negative capital triggers halt');
  assert(r7.capital === -10, 'Capital preserved in response');

  // Test 8: Zero capital
  console.log('--- Test 8: Zero capital ---');
  const f8 = new CapitalFloor({ floor: 50, auditLogger: mockAudit });
  const r8 = f8.check(0);
  assert(r8.ok === false, 'Zero capital triggers halt');

  // Test 9: Custom floor
  console.log('--- Test 9: Custom floor ---');
  const f9 = new CapitalFloor({ floor: 100 });
  const r9a = f9.check(99);
  assert(r9a.ok === false, 'Custom floor $100 — $99 triggers halt');

  // Test 10: Status tracking
  console.log('--- Test 10: Status ---');
  const f10 = new CapitalFloor({ floor: 50, auditLogger: mockAudit });
  f10.check(200);
  f10.check(30);
  const status = f10.status();
  assert(status.tradeCount === 2, 'Trade count = 2');
  assert(status.breachCount === 1, 'Breach count = 1');
  assert(status.halted === true, 'Status shows halted');

  // Test 11: No audit logger — still works
  console.log('--- Test 11: No audit logger ---');
  const f11 = new CapitalFloor({ floor: 50 });
  const r11 = f11.check(10);
  assert(r11.ok === false, 'Works without audit logger');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  return failed === 0;
}

if (require.main === module) {
  const ok = runTests();
  process.exit(ok ? 0 : 1);
}

module.exports = { CapitalFloor, DEFAULT_FLOOR };
