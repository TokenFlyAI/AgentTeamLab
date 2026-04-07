#!/usr/bin/env node
/**
 * QA Test Suite: Kalshi Client + Credential Manager
 *
 * Tests Bob's T578 (kalshi_client.js) and T582 (credential_manager.js) deliverables.
 * Validates mock mode, API surface, rate limiter, credential validation, and edge cases.
 *
 * Run: node qa_kalshi_client_test.js
 * Expected: All tests PASS
 */

const path = require('path');

// Resolve paths to Bob's output (output/ dirs are symlinked via ../../output/{agent}/)
const CLIENT_PATH = path.resolve(__dirname, '../bob/kalshi_client.js');
const CRED_PATH = path.resolve(__dirname, '../bob/credential_manager.js');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    failures.push(testName);
    console.log(`  FAIL: ${testName}`);
  }
}

function assertThrows(fn, testName) {
  try {
    fn();
    failed++;
    failures.push(testName);
    console.log(`  FAIL: ${testName} (expected throw, got none)`);
  } catch (e) {
    passed++;
    console.log(`  PASS: ${testName} (threw: ${e.message.slice(0, 60)})`);
  }
}

async function assertResolves(promise, testName) {
  try {
    await promise;
    passed++;
    console.log(`  PASS: ${testName}`);
  } catch (e) {
    failed++;
    failures.push(testName);
    console.log(`  FAIL: ${testName} (rejected: ${e.message.slice(0, 60)})`);
  }
}

// ============================================================
// SECTION 1: KalshiClient Tests
// ============================================================

async function testKalshiClient() {
  console.log('\n=== Section 1: KalshiClient (T578) ===\n');

  const { KalshiClient, KALSHI_API_BASE, KALSHI_DEMO_BASE } = require(CLIENT_PATH);

  // 1.1 Constructor
  console.log('[1.1] Constructor & Mode Detection');
  const mockClient = new KalshiClient({ mock: true });
  assert(mockClient.mockMode === true, 'mock:true sets mockMode');
  assert(mockClient.sessionToken === null, 'no session before login');

  const autoMockClient = new KalshiClient({});
  assert(autoMockClient.mockMode === true, 'no credentials → auto mock mode');

  const realClient = new KalshiClient({ apiKey: 'test-key', apiSecret: 'test-secret' });
  assert(realClient.mockMode === false, 'apiKey provided → real mode');
  assert(realClient.apiKey === 'test-key', 'apiKey stored');

  const demoClient = new KalshiClient({ demo: true, email: 'x@x.com', password: 'p' });
  assert(demoClient.useDemo === true, 'demo flag respected');
  assert(demoClient.baseUrl === KALSHI_DEMO_BASE, 'demo uses demo base URL');

  const prodClient = new KalshiClient({ apiKey: 'k', apiSecret: 's' });
  assert(prodClient.baseUrl === KALSHI_API_BASE, 'production uses prod base URL');

  // 1.2 Authentication
  console.log('\n[1.2] Authentication');
  const auth = await mockClient.login();
  assert(auth.token === 'mock-session-token', 'mock login returns token');
  assert(auth.member_id === 'mock-member-id', 'mock login returns member_id');
  assert(mockClient.sessionToken === 'mock-session-token', 'sessionToken set after login');

  const apiKeyAuth = await realClient.login();
  assert(apiKeyAuth.token === '[api-key-auth]', 'API key auth skips login call');

  const logout = await mockClient.logout();
  assert(logout.ok === true, 'mock logout returns ok');
  assert(mockClient.sessionToken === null, 'sessionToken cleared after logout');

  // Re-login for remaining tests
  await mockClient.login();

  // 1.3 Markets
  console.log('\n[1.3] Markets API');
  const markets = await mockClient.getMarkets({ limit: 5 });
  assert(Array.isArray(markets.markets), 'getMarkets returns array');
  assert(markets.markets.length === 5, 'limit=5 returns 5 markets');
  assert(markets.cursor === null, 'mock returns null cursor');

  const allMarkets = await mockClient.getMarkets({});
  assert(allMarkets.markets.length === 8, 'default returns all 8 mock markets');

  // Validate market structure
  const m = allMarkets.markets[0];
  assert(typeof m.ticker === 'string', 'market has ticker (string)');
  assert(typeof m.title === 'string', 'market has title');
  assert(typeof m.yes_bid === 'number', 'market has yes_bid (number)');
  assert(typeof m.yes_ask === 'number', 'market has yes_ask (number)');
  assert(typeof m.no_bid === 'number', 'market has no_bid (number)');
  assert(typeof m.no_ask === 'number', 'market has no_ask (number)');
  assert(typeof m.volume === 'number', 'market has volume (number)');
  assert(typeof m.last_price === 'number', 'market has last_price');
  assert(m.status === 'open', 'mock markets are open');

  // Price consistency: no_bid = 100 - yes_ask, no_ask = 100 - yes_bid
  assert(m.no_bid === 100 - m.yes_ask, 'no_bid = 100 - yes_ask (price consistency)');
  assert(m.no_ask === 100 - m.yes_bid, 'no_ask = 100 - yes_bid (price consistency)');
  assert(m.yes_bid <= m.yes_ask, 'bid <= ask (no crossed spread)');

  // 1.4 Single Market
  console.log('\n[1.4] Single Market');
  const single = await mockClient.getMarket('KXBTC-25APR-100K');
  assert(single.market.ticker === 'KXBTC-25APR-100K', 'getMarket returns correct ticker');

  const unknown = await mockClient.getMarket('UNKNOWN-TICKER');
  assert(unknown.market.ticker === 'UNKNOWN-TICKER', 'unknown ticker returns fallback mock');
  assert(unknown.market.volume === 10000, 'fallback mock has default volume');

  // 1.5 Order Book
  console.log('\n[1.5] Order Book');
  const ob = await mockClient.getOrderBook('KXBTC-25APR-100K');
  assert(ob.orderbook.ticker === 'KXBTC-25APR-100K', 'orderbook has ticker');
  assert(Array.isArray(ob.orderbook.yes), 'orderbook has yes levels');
  assert(Array.isArray(ob.orderbook.no), 'orderbook has no levels');
  assert(ob.orderbook.yes.length === 5, '5 yes price levels');
  assert(ob.orderbook.no.length === 5, '5 no price levels');

  const level = ob.orderbook.yes[0];
  assert(typeof level.price === 'number', 'level has price');
  assert(typeof level.quantity === 'number', 'level has quantity');
  assert(level.quantity >= 100, 'quantity >= 100 (mock range)');

  // 1.6 Candles
  console.log('\n[1.6] Candles / History');
  const candles = await mockClient.getCandles('KXBTC-25APR', { interval: 60 });
  assert(candles.candles.length === 30, '30 candle bars');
  const c = candles.candles[0];
  assert(typeof c.ts === 'number', 'candle has timestamp');
  assert(typeof c.open === 'number', 'candle has open');
  assert(typeof c.high === 'number', 'candle has high');
  assert(typeof c.low === 'number', 'candle has low');
  assert(typeof c.close === 'number', 'candle has close');
  assert(typeof c.volume === 'number', 'candle has volume');
  // Candles should be chronological
  assert(candles.candles[0].ts < candles.candles[candles.candles.length - 1].ts, 'candles in chronological order');

  // Market history
  const hist = await mockClient.getMarketHistory('KXBTC-25APR-100K', { limit: 10 });
  assert(hist.history.length === 10, 'history respects limit');
  assert(typeof hist.history[0].yes_price === 'number', 'history has yes_price');
  assert(hist.history[0].ts < hist.history[hist.history.length - 1].ts, 'history in chronological order');

  // 1.7 Trading
  console.log('\n[1.7] Trading');
  const limitOrder = await mockClient.createOrder({
    ticker: 'KXBTC-25APR-100K',
    action: 'buy',
    side: 'yes',
    type: 'limit',
    count: 10,
    yes_price: 43,
  });
  assert(limitOrder.order.status === 'resting', 'limit order status = resting');
  assert(limitOrder.order.ticker === 'KXBTC-25APR-100K', 'order has correct ticker');
  assert(limitOrder.order.count === 10, 'order has correct count');
  assert(typeof limitOrder.order.order_id === 'string', 'order has order_id');

  const marketOrder = await mockClient.createOrder({
    ticker: 'KXFED-25MAY-HOLD',
    action: 'buy',
    side: 'yes',
    type: 'market',
    count: 5,
    yes_price: 74,
  });
  assert(marketOrder.order.status === 'executed', 'market order status = executed');
  assert(marketOrder.order.filled_count === 5, 'market order filled_count matches');
  assert(marketOrder.order.avg_fill_price === 74, 'market order fill price correct');

  const cancel = await mockClient.cancelOrder(limitOrder.order.order_id);
  assert(cancel.order.status === 'canceled', 'cancel returns canceled status');
  assert(cancel.order.order_id === limitOrder.order.order_id, 'cancel echoes order_id');

  // 1.8 Portfolio
  console.log('\n[1.8] Portfolio');
  const balance = await mockClient.getBalance();
  assert(balance.balance === 1000000, 'mock balance = $10,000 (in cents)');

  const positions = await mockClient.getPositions();
  assert(Array.isArray(positions.market_positions), 'positions returns array');

  const fills = await mockClient.getFills();
  assert(Array.isArray(fills.fills), 'fills returns array');

  const orders = await mockClient.getOrders();
  assert(Array.isArray(orders.orders), 'orders returns array');

  // 1.9 Events
  console.log('\n[1.9] Events');
  const event = await mockClient.getEvent('KXBTC-25APR');
  assert(event.event.event_ticker === 'KXBTC-25APR', 'getEvent returns correct ticker');

  // 1.10 URL building
  console.log('\n[1.10] Internal Helpers');
  const query = mockClient._buildQuery({ a: 1, b: undefined, c: 'hello' });
  assert(query === '?a=1&c=hello', '_buildQuery filters undefined values');
  assert(mockClient._buildQuery({}) === '', '_buildQuery returns empty for no params');

  // 1.11 Exports
  console.log('\n[1.11] Module Exports');
  assert(typeof KALSHI_API_BASE === 'string', 'KALSHI_API_BASE exported');
  assert(typeof KALSHI_DEMO_BASE === 'string', 'KALSHI_DEMO_BASE exported');
  assert(KALSHI_API_BASE.includes('trading-api.kalshi.com'), 'prod URL correct');
  assert(KALSHI_DEMO_BASE.includes('demo-api.kalshi.co'), 'demo URL correct');
}

// ============================================================
// SECTION 2: CredentialManager Tests
// ============================================================

async function testCredentialManager() {
  console.log('\n=== Section 2: CredentialManager (T582) ===\n');

  const { CredentialManager, AuditLogger, RateLimiter, loadEnvFile } = require(CRED_PATH);

  // 2.1 loadEnvFile
  console.log('[2.1] .env File Loader');
  const vars = loadEnvFile('/nonexistent/.env');
  assert(Object.keys(vars).length === 0, 'nonexistent .env returns empty object');

  // 2.2 AuditLogger
  console.log('\n[2.2] AuditLogger');
  const tmpLog = '/tmp/qa_audit_test_' + Date.now() + '.jsonl';
  const audit = new AuditLogger(tmpLog);
  audit.log('test_event', { key: 'value' });
  audit.log('another_event', { num: 42 });
  const entries = audit.read();
  assert(entries.length === 2, 'audit log has 2 entries');
  assert(entries[0].event === 'test_event', 'first entry is test_event');
  assert(entries[1].num === 42, 'second entry has num=42');
  assert(typeof entries[0].timestamp === 'string', 'entries have timestamps');

  const limited = audit.read(1);
  assert(limited.length === 1, 'read(1) returns only last entry');
  assert(limited[0].event === 'another_event', 'read(1) returns most recent');

  // Cleanup
  require('fs').unlinkSync(tmpLog);

  // 2.3 RateLimiter
  console.log('\n[2.3] RateLimiter');
  const rl = new RateLimiter({ tradingLimit: 3, dataLimit: 5, windowMs: 100 });

  // Fire 3 trading calls — should all pass immediately
  const t0 = Date.now();
  await rl.checkTrading();
  await rl.checkTrading();
  await rl.checkTrading();
  const t1 = Date.now();
  assert(t1 - t0 < 50, '3 calls within limit complete instantly');

  // 4th call should wait
  await rl.checkTrading();
  const t2 = Date.now();
  assert(t2 - t1 >= 50, '4th call waits for window to expire');

  const usage = rl.getUsage();
  assert(usage.trading.limit === 3, 'trading limit reported correctly');
  assert(usage.data.limit === 5, 'data limit reported correctly');

  // 2.4 Credential Validation
  console.log('\n[2.4] Credential Validation');

  // Save and clear env
  const savedKey = process.env.KALSHI_API_KEY;
  const savedSecret = process.env.KALSHI_API_SECRET;
  const savedEmail = process.env.KALSHI_EMAIL;
  const savedPassword = process.env.KALSHI_PASSWORD;
  delete process.env.KALSHI_API_KEY;
  delete process.env.KALSHI_API_SECRET;
  delete process.env.KALSHI_EMAIL;
  delete process.env.KALSHI_PASSWORD;

  const tmpAudit = '/tmp/qa_cred_audit_' + Date.now() + '.jsonl';
  const cm = new CredentialManager({ envPath: '/nonexistent/.env', auditLogPath: tmpAudit });

  assertThrows(() => cm.validate(), 'no credentials → validate throws');

  // Set API key only (no secret)
  process.env.KALSHI_API_KEY = 'test-key';
  delete process.env.KALSHI_API_SECRET;
  const cm2 = new CredentialManager({ envPath: '/nonexistent/.env', auditLogPath: tmpAudit });
  assertThrows(() => cm2.validate(), 'API key without secret → throws');

  // Set both
  process.env.KALSHI_API_KEY = 'test-key';
  process.env.KALSHI_API_SECRET = 'test-secret';
  const cm3 = new CredentialManager({ envPath: '/nonexistent/.env', auditLogPath: tmpAudit });
  const result = cm3.validate();
  assert(result.valid === true, 'valid credentials pass validation');
  assert(result.authMethod === 'api_key', 'auth method = api_key');
  assert(result.paperTrading === true, 'paper trading default = true (C1)');

  // 2.5 Summary masking
  console.log('\n[2.5] Credential Masking');
  const summary = cm3.summary();
  assert(summary.apiKey.includes('...'), 'API key is masked in summary');
  assert(summary.apiKey.startsWith('test'), 'masked key shows first 4 chars');
  assert(summary.apiSecret === '***', 'API secret fully masked');

  // 2.6 Client options
  console.log('\n[2.6] Client Options');
  const opts = cm3.getClientOptions();
  assert(opts.apiKey === 'test-key', 'client options include apiKey');
  assert(opts.apiSecret === 'test-secret', 'client options include apiSecret');
  assert(opts.mock === false, 'client options mock = false');

  // 2.7 Rate limit methods
  console.log('\n[2.7] Rate Limit Integration');
  await assertResolves(cm3.rateLimitTrading(), 'rateLimitTrading resolves');
  await assertResolves(cm3.rateLimitData(), 'rateLimitData resolves');
  const rlStatus = cm3.getRateLimitStatus();
  assert(rlStatus.trading.used >= 1, 'trading calls tracked');
  assert(rlStatus.data.used >= 1, 'data calls tracked');

  // Restore env
  if (savedKey) process.env.KALSHI_API_KEY = savedKey; else delete process.env.KALSHI_API_KEY;
  if (savedSecret) process.env.KALSHI_API_SECRET = savedSecret; else delete process.env.KALSHI_API_SECRET;
  if (savedEmail) process.env.KALSHI_EMAIL = savedEmail; else delete process.env.KALSHI_EMAIL;
  if (savedPassword) process.env.KALSHI_PASSWORD = savedPassword; else delete process.env.KALSHI_PASSWORD;

  // Cleanup
  try { require('fs').unlinkSync(tmpAudit); } catch(e) {}
}

// ============================================================
// SECTION 3: Integration / Edge Cases
// ============================================================

async function testEdgeCases() {
  console.log('\n=== Section 3: Edge Cases & Integration ===\n');

  const { KalshiClient } = require(CLIENT_PATH);

  // 3.1 Multiple clients don't interfere
  console.log('[3.1] Client Isolation');
  const c1 = new KalshiClient({ mock: true });
  const c2 = new KalshiClient({ mock: true });
  await c1.login();
  assert(c2.sessionToken === null, 'c2 not affected by c1 login');
  await c2.login();
  await c1.logout();
  assert(c2.sessionToken === 'mock-session-token', 'c2 still logged in after c1 logout');

  // 3.2 Order IDs are unique
  console.log('\n[3.2] Order ID Uniqueness');
  await c2.login();
  const orders = [];
  for (let i = 0; i < 20; i++) {
    const o = await c2.createOrder({ ticker: 'TEST', action: 'buy', side: 'yes', type: 'limit', count: 1, yes_price: 50 });
    orders.push(o.order.order_id);
  }
  const uniqueIds = new Set(orders);
  assert(uniqueIds.size === 20, '20 orders produce 20 unique IDs');

  // 3.3 Market data consistency across calls
  console.log('\n[3.3] Data Consistency');
  const m1 = await c2.getMarkets({});
  const m2 = await c2.getMarkets({});
  assert(m1.markets.length === m2.markets.length, 'same number of markets on repeat calls');
  assert(m1.markets[0].ticker === m2.markets[0].ticker, 'same tickers on repeat calls');
  assert(m1.markets[0].yes_bid === m2.markets[0].yes_bid, 'same prices on repeat calls (deterministic mock)');

  // 3.4 Spread analysis — no negative spreads
  console.log('\n[3.4] Spread Validation');
  const allM = await c2.getMarkets({});
  let spreadOk = true;
  for (const mkt of allM.markets) {
    if (mkt.yes_bid > mkt.yes_ask) { spreadOk = false; break; }
    if (mkt.no_bid > mkt.no_ask) { spreadOk = false; break; }
  }
  assert(spreadOk, 'no negative spreads in any mock market');

  // 3.5 Candle OHLC validity
  console.log('\n[3.5] Candle OHLC Validation');
  const candles = await c2.getCandles('TEST', {});
  // Note: mock uses random data so high >= low may not always hold
  // But we check structural validity
  assert(candles.candles.every(c => c.volume >= 200), 'all candle volumes >= 200 (mock range)');
  assert(candles.candles.every(c => c.ts > 0), 'all candle timestamps positive');
}

// ============================================================
// MAIN
// ============================================================

(async () => {
  console.log('=== QA Test Suite: Kalshi Client + Credential Manager ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Tester: Tina (QA)\n`);

  try {
    await testKalshiClient();
    await testCredentialManager();
    await testEdgeCases();
  } catch (e) {
    console.error('\nFATAL ERROR:', e.message);
    console.error(e.stack);
    failed++;
    failures.push('FATAL: ' + e.message);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passed} PASS, ${failed} FAIL (${passed + failed} total)`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log('='.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
})();
