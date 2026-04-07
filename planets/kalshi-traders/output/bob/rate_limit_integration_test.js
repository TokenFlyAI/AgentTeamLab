#!/usr/bin/env node
/**
 * T588 — Rate Limit Integration Test
 *
 * Tests credential_manager.js RateLimiter under load:
 * 1. Burst requests hitting trading limit (10/s)
 * 2. Burst requests hitting data limit (100/s)
 * 3. Concurrent access patterns
 * 4. Backoff timing verification
 * 5. Window reset after cooldown
 * 6. CredentialManager integration (rateLimitTrading/rateLimitData)
 *
 * Run: node rate_limit_integration_test.js
 * Author: Bob (Backend Engineer)
 */

const { RateLimiter, CredentialManager } = require('./credential_manager.js');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

async function assertApprox(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
    console.log(`  PASS: ${msg} (${actual}ms ~ ${expected}ms)`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg} (expected ~${expected}ms, got ${actual}ms)`);
  }
}

// --- Test 1: Trading rate limit (10 req/s) ---
async function testTradingBurst() {
  console.log('\nTest 1: Trading burst — 10 requests should pass, 11th should backoff');
  const rl = new RateLimiter({ tradingLimit: 10, windowMs: 1000 });

  // Fire 10 requests — all should pass instantly
  const start = Date.now();
  for (let i = 0; i < 10; i++) {
    await rl.checkTrading();
  }
  const elapsed10 = Date.now() - start;
  assert(elapsed10 < 50, `10 trading requests completed in ${elapsed10}ms (< 50ms)`);

  // 11th request should trigger backoff
  const start11 = Date.now();
  await rl.checkTrading();
  const elapsed11 = Date.now() - start11;
  assert(elapsed11 >= 800, `11th request waited ${elapsed11}ms (>= 800ms backoff)`);

  // Verify usage
  const usage = rl.getUsage();
  assert(usage.trading.used <= 11, `Trading usage tracked: ${usage.trading.used}`);
  assert(usage.trading.limit === 10, `Trading limit correct: ${usage.trading.limit}`);
}

// --- Test 2: Data rate limit (100 req/s) ---
async function testDataBurst() {
  console.log('\nTest 2: Data burst — 100 requests should pass, 101st should backoff');
  const rl = new RateLimiter({ dataLimit: 5, windowMs: 500 }); // smaller for fast test

  const start = Date.now();
  for (let i = 0; i < 5; i++) {
    await rl.checkData();
  }
  const elapsed5 = Date.now() - start;
  assert(elapsed5 < 50, `5 data requests completed in ${elapsed5}ms (< 50ms)`);

  // 6th should backoff
  const start6 = Date.now();
  await rl.checkData();
  const elapsed6 = Date.now() - start6;
  assert(elapsed6 >= 300, `6th data request waited ${elapsed6}ms (>= 300ms backoff)`);
}

// --- Test 3: Concurrent access ---
async function testConcurrentAccess() {
  console.log('\nTest 3: Concurrent access — parallel requests respect limits');
  const rl = new RateLimiter({ tradingLimit: 5, windowMs: 500 });

  // Fire 8 concurrent trading requests
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => rl.checkTrading())
  );
  const elapsed = Date.now() - start;

  assert(results.every(r => r === true), 'All concurrent requests returned true');
  // Some should have waited (3 over limit)
  assert(elapsed >= 300, `Concurrent burst took ${elapsed}ms (some backoff expected >= 300ms)`);

  const usage = rl.getUsage();
  assert(usage.trading.used >= 1, `Post-concurrent usage tracked: ${usage.trading.used}`);
}

// --- Test 4: Window reset ---
async function testWindowReset() {
  console.log('\nTest 4: Window reset — requests succeed after cooldown');
  const rl = new RateLimiter({ tradingLimit: 3, windowMs: 200 });

  // Fill the window
  for (let i = 0; i < 3; i++) await rl.checkTrading();
  const usage1 = rl.getUsage();
  assert(usage1.trading.used === 3, `Window full: ${usage1.trading.used}/3`);

  // Wait for window to expire
  await new Promise(r => setTimeout(r, 250));

  // Should be clear now
  const usage2 = rl.getUsage();
  assert(usage2.trading.used === 0, `Window cleared after cooldown: ${usage2.trading.used}/3`);

  // New request should pass instantly
  const start = Date.now();
  await rl.checkTrading();
  const elapsed = Date.now() - start;
  assert(elapsed < 50, `Post-cooldown request instant: ${elapsed}ms`);
}

// --- Test 5: Mixed trading + data ---
async function testMixedEndpoints() {
  console.log('\nTest 5: Mixed endpoints — trading and data limits are independent');
  const rl = new RateLimiter({ tradingLimit: 3, dataLimit: 3, windowMs: 500 });

  // Fill trading limit
  for (let i = 0; i < 3; i++) await rl.checkTrading();

  // Data should still be available
  const start = Date.now();
  await rl.checkData();
  const elapsed = Date.now() - start;
  assert(elapsed < 50, `Data request passes even with trading full: ${elapsed}ms`);

  const usage = rl.getUsage();
  assert(usage.trading.used === 3, `Trading full: ${usage.trading.used}`);
  assert(usage.data.used === 1, `Data independent: ${usage.data.used}`);
}

// --- Test 6: CredentialManager integration ---
async function testCredentialManagerIntegration() {
  console.log('\nTest 6: CredentialManager rate limit integration');

  // Set up test env
  process.env.KALSHI_API_KEY = 'test_key_588';
  process.env.KALSHI_API_SECRET = 'test_secret_588';
  process.env.KALSHI_ENV = 'demo';

  const cm = new CredentialManager({
    rateLimits: { tradingLimit: 3, dataLimit: 5, windowMs: 500 }
  });

  // Trading rate limit through CM
  for (let i = 0; i < 3; i++) await cm.rateLimitTrading();
  const start = Date.now();
  await cm.rateLimitTrading();
  const elapsed = Date.now() - start;
  assert(elapsed >= 300, `CM trading backoff works: ${elapsed}ms`);

  // Data rate limit through CM
  const status = cm.getRateLimitStatus();
  assert(status.data.limit === 5, `CM data limit configured: ${status.data.limit}`);
  assert(status.trading.limit === 3, `CM trading limit configured: ${status.trading.limit}`);
}

// --- Test 7: Sustained load ---
async function testSustainedLoad() {
  console.log('\nTest 7: Sustained load — 20 requests at limit=5/200ms');
  const rl = new RateLimiter({ tradingLimit: 5, windowMs: 200 });

  const start = Date.now();
  for (let i = 0; i < 20; i++) {
    await rl.checkTrading();
  }
  const elapsed = Date.now() - start;

  // 20 requests at 5/200ms should take ~600ms (3 full windows after first)
  assert(elapsed >= 400, `Sustained load took ${elapsed}ms (>= 400ms expected)`);
  assert(elapsed < 3000, `Sustained load didn't hang: ${elapsed}ms (< 3000ms)`);
  console.log(`  INFO: 20 requests at 5/200ms = ${elapsed}ms total`);
}

// --- Run all ---
async function main() {
  console.log('=== T588: Rate Limit Integration Tests ===');
  console.log('Testing credential_manager.js RateLimiter under load\n');

  await testTradingBurst();
  await testDataBurst();
  await testConcurrentAccess();
  await testWindowReset();
  await testMixedEndpoints();
  await testCredentialManagerIntegration();
  await testSustainedLoad();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);

  if (failed > 0) {
    console.log('\nFAILED');
    process.exit(1);
  } else {
    console.log('\nALL TESTS PASS');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
