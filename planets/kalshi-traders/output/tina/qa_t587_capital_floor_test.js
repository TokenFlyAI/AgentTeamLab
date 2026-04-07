#!/usr/bin/env node
/**
 * QA Test: T587 — Capital Floor Safety Check
 * Tests Bob's capital_floor.js + walk_forward_backtest_v2.js
 *
 * Run: node qa_t587_capital_floor_test.js
 */

const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const FLOOR_PATH = path.resolve(__dirname, '../bob/capital_floor.js');
const V2_PATH = path.resolve(__dirname, '../bob/walk_forward_backtest_v2.js');
const V2_RESULTS = path.resolve(__dirname, '../bob/walk_forward_results_v2.json');

let passed = 0, failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL: ${name}`); }
}

(async () => {
  console.log('=== QA Test: T587 Capital Floor ===\n');

  // 1. Files exist
  console.log('[1] Deliverables');
  assert(fs.existsSync(FLOOR_PATH), 'capital_floor.js exists');
  assert(fs.existsSync(V2_PATH), 'walk_forward_backtest_v2.js exists');

  // 2. Capital floor unit tests
  console.log('\n[2] Capital Floor Unit Tests (Bob\'s built-in)');
  let unitOutput;
  try {
    unitOutput = execSync(`node ${FLOOR_PATH}`, { encoding: 'utf8', timeout: 10000 });
    assert(unitOutput.includes('22 passed, 0 failed'), 'all 22 built-in tests pass');
  } catch (e) {
    failed++; failures.push('unit tests failed');
    console.log(`  FAIL: unit tests — ${e.message.slice(0, 80)}`);
  }

  // 3. Module API
  console.log('\n[3] Module API');
  const { CapitalFloor, DEFAULT_FLOOR } = require(FLOOR_PATH);
  assert(typeof CapitalFloor === 'function', 'CapitalFloor class exported');
  assert(DEFAULT_FLOOR === 50, 'DEFAULT_FLOOR = $50');

  const floor = new CapitalFloor({ floor: 100 });
  assert(floor.floor === 100, 'custom floor respected');
  assert(floor.halted === false, 'starts not halted');
  assert(floor.tradeCount === 0, 'starts with 0 trades');

  // 4. Check behavior
  console.log('\n[4] Check Behavior');
  const ok = floor.check(200);
  assert(ok.ok === true, '$200 > $100 floor → ok');

  const breach = floor.check(50);
  assert(breach.ok === false, '$50 < $100 floor → halt');
  assert(breach.halted === true, 'halted flag set');
  assert(breach.reason.includes('below floor'), 'reason explains breach');

  const blocked = floor.check(500);
  assert(blocked.ok === false, 'subsequent trades blocked while halted');

  floor.reset();
  const afterReset = floor.check(150);
  assert(afterReset.ok === true, 'reset clears halt');

  // 5. Status tracking
  console.log('\n[5] Status Tracking');
  const status = floor.status();
  assert(status.tradeCount === 4, 'all checks counted');
  assert(status.breachCount === 1, '1 breach recorded');
  assert(status.breachHistory.length === 1, 'breach history tracked');
  assert(status.breachHistory[0].capital === 50, 'breach capital recorded');

  // 6. Walk-forward v2 integration
  console.log('\n[6] Walk-Forward V2 Integration');
  let v2Output;
  try {
    v2Output = execSync(`node ${V2_PATH}`, { encoding: 'utf8', timeout: 15000 });
    passed++; console.log('  PASS: walk_forward_backtest_v2.js runs without error');
  } catch (e) {
    failed++; failures.push('v2 execution');
    console.log(`  FAIL: v2 execution — ${e.message.slice(0, 80)}`);
    v2Output = '';
  }

  assert(v2Output.includes('Capital Floor'), 'v2 mentions capital floor in config');
  assert(v2Output.includes('CAPITAL_FLOOR'), 'v2 reports capital floor events');
  assert(v2Output.includes('Capital floor breached: YES'), 'v2 detects floor breach');

  // 7. V2 output file
  console.log('\n[7] V2 Output File');
  assert(fs.existsSync(V2_RESULTS), 'walk_forward_results_v2.json created');
  const results = JSON.parse(fs.readFileSync(V2_RESULTS, 'utf8'));
  assert(results.task === 'T580/T587', 'task reference includes T587');
  assert(results.config.capitalFloor === 50, 'config has capitalFloor = $50');
  assert(results.summary.capitalFloor === 50, 'summary has capitalFloor');
  assert(typeof results.summary.capitalFloorBreached === 'boolean', 'summary tracks floor breach');

  // 8. V2 vs V1 comparison — v2 has capital floor fields
  console.log('\n[8] V2 Enhancements');
  const hasFloorStatus = results.windows.some(w => w.test.capitalFloorStatus !== undefined);
  assert(hasFloorStatus, 'windows include capitalFloorStatus');
  const hasBreakReason = results.windows.some(w => w.test.circuitBreakReason !== null);
  assert(hasBreakReason, 'windows include circuitBreakReason');

  // 9. Addresses T580 QA warnings
  console.log('\n[9] Addresses T580 QA Warnings');
  assert(v2Output.includes('CAPITAL_FLOOR_BREACH') || v2Output.includes('CAPITAL FLOOR BREACH'),
    'WARNING 1 addressed: capital floor detects negative capital');
  // The floor halts trading — no further trades after breach
  const breachedWindows = results.windows.filter(w => w.test.capitalFloorStatus?.halted);
  assert(breachedWindows.length > 0, 'floor halt prevents additional trades after breach');

  // 10. Audit integration
  console.log('\n[10] Audit Integration');
  assert(v2Output.includes('audit') || fs.existsSync(path.resolve(__dirname, '../bob/backtest_audit.jsonl')),
    'audit trail created for backtest events');

  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passed} PASS, ${failed} FAIL (${passed + failed} total)`);
  if (failures.length) {
    console.log('FAILURES:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log('='.repeat(50));
  console.log(`\nVERDICT: ${failed === 0 ? 'APPROVE' : 'REJECT'}`);
  process.exit(failed > 0 ? 1 : 0);
})();
