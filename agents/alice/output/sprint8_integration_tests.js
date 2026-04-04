#!/usr/bin/env node

/**
 * Sprint 8 Integration Tests — Full Kalshi Arbitrage Pipeline
 *
 * Tests the end-to-end pipeline: Phase 1 → 2 → 3 → 4 (design)
 * Validates data flow, dependencies, and outputs at each boundary
 */

const fs = require('fs');
const path = require('path');

// Color output for test results
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

class IntegrationTestSuite {
  constructor() {
    this.tests = [];
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
    };
    // Find the aicompany root directory
    this.baseDir = path.resolve(__dirname, '../../..');
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log(`${colors.blue}🚀 Sprint 8 Integration Tests${colors.reset}\n`);

    for (const { name, fn } of this.tests) {
      try {
        await fn.call(this);
        this.pass(name);
      } catch (err) {
        this.fail(name, err.message);
      }
    }

    this.summary();
  }

  pass(name) {
    console.log(`${colors.green}✓ PASS${colors.reset} ${name}`);
    this.results.passed++;
  }

  fail(name, reason) {
    console.log(`${colors.red}✗ FAIL${colors.reset} ${name}`);
    console.log(`  ${reason}\n`);
    this.results.failed++;
  }

  skip(name, reason) {
    console.log(`${colors.yellow}⊘ SKIP${colors.reset} ${name}`);
    console.log(`  ${reason}\n`);
    this.results.skipped++;
  }

  summary() {
    const total = this.results.passed + this.results.failed + this.results.skipped;
    console.log(`\n${colors.blue}Test Results:${colors.reset}`);
    console.log(`  ${colors.green}Passed: ${this.results.passed}${colors.reset}`);
    console.log(`  ${colors.red}Failed: ${this.results.failed}${colors.reset}`);
    console.log(`  ${colors.yellow}Skipped: ${this.results.skipped}${colors.reset}`);
    console.log(`  Total: ${total}\n`);

    process.exit(this.results.failed > 0 ? 1 : 0);
  }

  readJSON(filepath) {
    const fullPath = path.join(this.baseDir, filepath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filepath}`);
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }
}

const suite = new IntegrationTestSuite();

// ============================================================================
// PHASE 1: Market Filtering (Grace, T343)
// ============================================================================

suite.test('Phase 1: markets_filtered.json exists', function() {
  this.readJSON('agents/public/markets_filtered.json');
});

suite.test('Phase 1: markets_filtered.json has correct schema', function() {
  const data = this.readJSON('agents/public/markets_filtered.json');
  this.assert(data.markets, 'Missing "markets" array');
  this.assert(Array.isArray(data.markets), '"markets" must be an array');
  this.assert(data.markets.length > 0, 'No markets in filtered list');

  // Check each market has required fields
  data.markets.forEach((market, idx) => {
    this.assert(market.ticker, `Market ${idx}: missing ticker`);
    this.assert(market.title, `Market ${idx}: missing title`);
    this.assert(market.category, `Market ${idx}: missing category`);
  });
});

suite.test('Phase 1: All filtered markets meet criteria', function() {
  const data = this.readJSON('agents/public/markets_filtered.json');

  data.markets.forEach((market) => {
    // Markets should have ticker starting with capital letters (e.g., BTCW-26-JUN-100K)
    this.assert(
      /^[A-Z0-9\-]+$/.test(market.ticker),
      `Invalid ticker format: ${market.ticker}`
    );
  });
});

// ============================================================================
// PHASE 2: LLM-Based Clustering (Ivan, T344)
// ============================================================================

suite.test('Phase 2: market_clusters.json exists', function() {
  this.readJSON('agents/public/market_clusters.json');
});

suite.test('Phase 2: market_clusters.json has correct schema', function() {
  const data = this.readJSON('agents/public/market_clusters.json');
  this.assert(data.clusters, 'Missing "clusters" array');
  this.assert(Array.isArray(data.clusters), '"clusters" must be an array');
  this.assert(data.clusters.length > 0, 'No clusters identified');

  // Check each cluster has required fields
  data.clusters.forEach((cluster, idx) => {
    this.assert(cluster.id, `Cluster ${idx}: missing id`);
    this.assert(cluster.label, `Cluster ${idx}: missing label`);
    this.assert(Array.isArray(cluster.markets), `Cluster ${idx}: markets must be array`);
    this.assert(cluster.markets.length > 0, `Cluster ${idx}: no markets in cluster`);
  });
});

suite.test('Phase 2: All clustered markets are valid tickers', function() {
  const data = this.readJSON('agents/public/market_clusters.json');

  data.clusters.forEach((cluster) => {
    cluster.markets.forEach((ticker) => {
      this.assert(
        typeof ticker === 'string' && ticker.length > 0,
        `Cluster ${cluster.id}: invalid ticker ${ticker}`
      );
    });
  });
});

// ============================================================================
// PHASE 3: Pearson Correlation Detection (Bob, T345)
// ============================================================================

suite.test('Phase 3: correlation_pairs.json exists', function() {
  this.readJSON('agents/public/correlation_pairs.json');
});

suite.test('Phase 3: correlation_pairs.json has correct schema', function() {
  const data = this.readJSON('agents/public/correlation_pairs.json');
  this.assert(data.pairs, 'Missing "pairs" array');
  this.assert(Array.isArray(data.pairs), '"pairs" must be an array');
  this.assert(data.pairs.length > 0, 'No correlation pairs found');

  // Check each pair has required fields
  data.pairs.forEach((pair, idx) => {
    this.assert(pair.market_a, `Pair ${idx}: missing market_a`);
    this.assert(pair.market_b, `Pair ${idx}: missing market_b`);
    this.assert(pair.pearson_correlation !== undefined, `Pair ${idx}: missing pearson_correlation`);
    this.assert(pair.expected_spread !== undefined, `Pair ${idx}: missing expected_spread`);
    this.assert(pair.current_spread !== undefined, `Pair ${idx}: missing current_spread`);
    this.assert(pair.arbitrage_confidence !== undefined, `Pair ${idx}: missing arbitrage_confidence`);
    this.assert(pair.direction, `Pair ${idx}: missing direction`);
  });
});

suite.test('Phase 3: Pearson correlations are valid (0 to 1)', function() {
  const data = this.readJSON('agents/public/correlation_pairs.json');

  data.pairs.forEach((pair, idx) => {
    const r = pair.pearson_correlation;
    this.assert(
      r >= 0 && r <= 1,
      `Pair ${idx}: invalid correlation ${r} (must be 0-1)`
    );
  });
});

suite.test('Phase 3: Arbitrage confidence scores are valid (0 to 1)', function() {
  const data = this.readJSON('agents/public/correlation_pairs.json');

  data.pairs.forEach((pair, idx) => {
    const conf = pair.arbitrage_confidence;
    this.assert(
      conf >= 0 && conf <= 1,
      `Pair ${idx}: invalid confidence ${conf} (must be 0-1)`
    );
  });
});

suite.test('Phase 3: Trade directions are valid', function() {
  const data = this.readJSON('agents/public/correlation_pairs.json');
  const validDirections = ['buy_A_sell_B', 'sell_A_buy_B'];

  data.pairs.forEach((pair, idx) => {
    this.assert(
      validDirections.includes(pair.direction),
      `Pair ${idx}: invalid direction ${pair.direction}`
    );
  });
});

suite.test('Phase 3: At least 1 high-confidence arbitrage opportunity (>0.95)', function() {
  const data = this.readJSON('agents/public/correlation_pairs.json');

  const highConfidence = data.pairs.filter(p => p.arbitrage_confidence > 0.95);
  this.assert(
    highConfidence.length > 0,
    `No arbitrage opportunities with confidence > 0.95`
  );
});

// ============================================================================
// PIPELINE INTEGRATION: Dependencies & Data Flow
// ============================================================================

suite.test('Integration: Phase 1 → Phase 2 dependency', function() {
  const phase1 = this.readJSON('agents/public/markets_filtered.json');
  const phase2 = this.readJSON('agents/public/market_clusters.json');

  // All markets in phase 2 clusters should originate from phase 1 or be semantically related
  const phase1Tickers = new Set(phase1.markets.map(m => m.ticker));

  phase2.clusters.forEach((cluster) => {
    cluster.markets.forEach((ticker) => {
      // Some markets may be expanded by LLM (e.g., related markets), so we don't require 1:1 mapping
      // But at least validate ticker format
      this.assert(
        /^[A-Z0-9\-]+$/.test(ticker),
        `Phase 2 ticker ${ticker} has invalid format`
      );
    });
  });
});

suite.test('Integration: Phase 2 → Phase 3 dependency', function() {
  const phase2 = this.readJSON('agents/public/market_clusters.json');
  const phase3 = this.readJSON('agents/public/correlation_pairs.json');

  // All markets in phase 3 pairs should be in phase 2 clusters
  const phase2Markets = new Set();
  phase2.clusters.forEach((cluster) => {
    cluster.markets.forEach(m => phase2Markets.add(m));
  });

  phase3.pairs.forEach((pair) => {
    this.assert(
      phase2Markets.has(pair.market_a),
      `Phase 3 pair: market_a "${pair.market_a}" not in phase 2 clusters`
    );
    this.assert(
      phase2Markets.has(pair.market_b),
      `Phase 3 pair: market_b "${pair.market_b}" not in phase 2 clusters`
    );
  });
});

// ============================================================================
// PHASE 4: Design Validation (Dave, T346) — Readiness Check
// ============================================================================

suite.test('Phase 4: Readiness for design', function() {
  // Phase 4 input: correlation_pairs.json
  const phase3 = this.readJSON('agents/public/correlation_pairs.json');

  // Ensure we have sufficient data for design
  const highConfidencePairs = phase3.pairs.filter(p => p.arbitrage_confidence > 0.90);
  this.assert(
    highConfidencePairs.length >= 2,
    `Phase 4 design needs at least 2 high-confidence pairs, found ${highConfidencePairs.length}`
  );
});

// ============================================================================
// Output Validation: Deliverable Files
// ============================================================================

suite.test('Deliverables: All phase outputs exist', function() {
  const files = [
    'agents/public/markets_filtered.json',
    'agents/public/market_clusters.json',
    'agents/public/correlation_pairs.json',
  ];

  files.forEach((filepath) => {
    this.readJSON(filepath);
  });
});

suite.test('Deliverables: Validation report exists', function() {
  const reportPath = 'agents/alice/knowledge/sprint8_validation.md';
  const fullPath = path.join(this.baseDir, reportPath);
  this.assert(
    fs.existsSync(fullPath),
    `Validation report not found: ${reportPath}`
  );
});

// ============================================================================
// Summary: Print Key Metrics
// ============================================================================

suite.test('Summary: Log pipeline statistics', function() {
  const phase1 = this.readJSON('agents/public/markets_filtered.json');
  const phase2 = this.readJSON('agents/public/market_clusters.json');
  const phase3 = this.readJSON('agents/public/correlation_pairs.json');

  console.log(`\n${colors.blue}Pipeline Statistics:${colors.reset}`);
  console.log(`  Phase 1 (Filtered Markets): ${phase1.markets.length}`);
  console.log(`  Phase 2 (Clusters): ${phase2.clusters.length}`);
  console.log(`  Phase 3 (Pairs): ${phase3.pairs.length}`);

  const highConfPairs = phase3.pairs.filter(p => p.arbitrage_confidence > 0.95);
  console.log(`  High Confidence (>0.95): ${highConfPairs.length}`);

  const avgCorr = phase3.pairs.reduce((sum, p) => sum + p.pearson_correlation, 0) / phase3.pairs.length;
  console.log(`  Average Correlation: ${avgCorr.toFixed(3)}\n`);
});

// Run all tests
suite.run();
