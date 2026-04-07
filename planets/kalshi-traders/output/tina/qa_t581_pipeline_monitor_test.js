#!/usr/bin/env node
/**
 * QA Test: T581 — Pipeline Monitoring Dashboard
 * Tests serve_pipeline_monitor.js and pipeline_monitor.html
 *
 * Run: node qa_t581_pipeline_monitor_test.js
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3461; // Avoid conflict with actual monitor
const SERVER_PATH = path.resolve(__dirname, '../alice/serve_pipeline_monitor.js');

let passed = 0, failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL: ${name}`); }
}

function fetchRaw(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${urlPath}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

(async () => {
  console.log('=== QA Test: T581 Pipeline Monitoring Dashboard ===\n');

  // Start server
  const proc = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  await new Promise(r => setTimeout(r, 1500));

  try {
    // 1. HTML Serving
    console.log('[1] HTML Serving');
    const root = await fetchRaw('/');
    assert(root.status === 200, 'GET / returns 200');
    assert(root.body.includes('<!DOCTYPE html>'), 'returns valid HTML');
    assert(root.body.includes('Pipeline Monitor'), 'contains title');
    assert(root.headers['content-type'].includes('text/html'), 'content-type is text/html');
    assert(root.headers['access-control-allow-origin'] === '*', 'CORS header present');

    const idx = await fetchRaw('/index.html');
    assert(idx.status === 200, '/index.html also serves dashboard');

    // 2. Dashboard Content
    console.log('\n[2] Dashboard Content');
    assert(root.body.includes('Pipeline Phases'), 'has Pipeline Phases section');
    assert(root.body.includes('Key Metrics'), 'has Key Metrics section');
    assert(root.body.includes('Signal Quality'), 'has Signal Quality section');
    assert(root.body.includes('System Health'), 'has System Health section');
    assert(root.body.includes('Active Signals'), 'has Active Signals table');
    assert(root.body.includes('P&L History'), 'has P&L History chart');
    assert(root.body.includes('Auto-refresh: 15s'), 'shows auto-refresh interval');
    assert(root.body.includes('setInterval(refresh, 15000)'), 'auto-refresh implemented (15s)');

    // 3. Phase rendering
    console.log('\n[3] Phase Coverage');
    assert(root.body.includes('Market Filtering'), 'Phase 1: Market Filtering');
    assert(root.body.includes('LLM Clustering'), 'Phase 2: LLM Clustering');
    assert(root.body.includes('Correlation Detection'), 'Phase 3: Correlation Detection');
    assert(root.body.includes('Signal Generation'), 'Phase 4: Signal Generation');

    // 4. Data file paths
    console.log('\n[4] Data Sources');
    assert(root.body.includes('/output/grace/markets_filtered.json'), 'fetches Grace market filter');
    assert(root.body.includes('/output/ivan/market_clusters.json'), 'fetches Ivan clusters');
    assert(root.body.includes('/output/bob/correlation_pairs.json'), 'fetches Bob correlation pairs');
    assert(root.body.includes('/output/bob/trade_signals.json'), 'fetches Bob trade signals');

    // 5. Output file serving
    console.log('\n[5] File Serving');
    const signals = await fetchRaw('/output/bob/trade_signals.json');
    // File may or may not exist — just check server doesn't crash
    assert([200, 404].includes(signals.status), 'output file request returns 200 or 404');

    const notFound = await fetchRaw('/nonexistent');
    assert(notFound.status === 404, 'unknown path returns 404');

    // 6. Security
    console.log('\n[6] Security');
    const traversal1 = await fetchRaw('/output/../../../etc/passwd');
    assert(traversal1.status !== 200 || !traversal1.body.includes('root:'), 'directory traversal blocked (output)');

    const traversal2 = await fetchRaw('/public/../../../etc/passwd');
    assert(traversal2.status !== 200 || !traversal2.body.includes('root:'), 'directory traversal blocked (public)');

    // 7. Styling / UX
    console.log('\n[7] Styling & UX');
    assert(root.body.includes('background: #0f1419'), 'dark theme background');
    assert(root.body.includes('grid-template-columns'), 'grid layout');
    assert(root.body.includes('.badge.buy'), 'buy badge styling');
    assert(root.body.includes('.badge.sell'), 'sell badge styling');
    assert(root.body.includes('.pnl-bar.pos'), 'positive P&L bar styling');
    assert(root.body.includes('.pnl-bar.neg'), 'negative P&L bar styling');
    assert(root.body.includes('.confidence-dist'), 'confidence distribution histogram');

    // 8. Signal table columns
    console.log('\n[8] Signal Table Structure');
    assert(root.body.includes('<th>Market</th>'), 'table has Market column');
    assert(root.body.includes('<th>Direction</th>'), 'table has Direction column');
    assert(root.body.includes('<th>Confidence</th>'), 'table has Confidence column');
    assert(root.body.includes('<th>Z-Score</th>'), 'table has Z-Score column');
    assert(root.body.includes('<th>Edge</th>'), 'table has Edge column');

  } catch (e) {
    failed++;
    failures.push('FATAL: ' + e.message);
    console.error('\nERROR:', e.message);
  }

  proc.kill();

  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passed} PASS, ${failed} FAIL (${passed + failed} total)`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
})();
