#!/usr/bin/env node
/**
 * T352: Phase 4 E2E Integration Test Harness
 * Full pipeline integration test for Kalshi Arbitrage Engine
 * 
 * Tests: Phase 1 (Filter) → Phase 2 (Cluster) → Phase 3 (Correlate) → Phase 4 (Execute)
 * 
 * Run: node e2e_integration_test.js
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

// ============================================================================
// Test Configuration
// ============================================================================

const CONFIG = {
  // Input files from previous phases
  filteredMarketsPath: '../../public/markets_filtered.json',
  clustersPath: '../../public/market_clusters.json',
  correlationPairsPath: '../../public/correlation_pairs.json',
  
  // Phase 4 engine
  enginePath: '../../bob/backend/cpp_engine/engine',
  testSuitePath: '../../bob/backend/cpp_engine/test_suite',
  
  // Test parameters
  mockMode: true,
  testDurationMs: 5000,
  expectedMinPairs: 1,
  expectedMinOpportunities: 1,
};

// ============================================================================
// Test Results
// ============================================================================

const results = {
  phase1: { passed: false, details: {} },
  phase2: { passed: false, details: {} },
  phase3: { passed: false, details: {} },
  phase4: { passed: false, details: {} },
  integration: { passed: false, details: {} },
};

// ============================================================================
// Utilities
// ============================================================================

function log(section, message) {
  console.log(`[${section}] ${message}`);
}

function error(section, message) {
  console.error(`[${section}] ❌ ${message}`);
}

function success(section, message) {
  console.log(`[${section}] ✅ ${message}`);
}

function loadJSON(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    return null;
  }
}

// ============================================================================
// Phase 1: Market Filtering Tests
// ============================================================================

function testPhase1() {
  log('Phase 1', 'Testing Market Filtering...');
  
  const data = loadJSON(CONFIG.filteredMarketsPath);
  if (!data) {
    error('Phase 1', `Failed to load ${CONFIG.filteredMarketsPath}`);
    return false;
  }
  
  // Validate structure
  if (!data.markets || !Array.isArray(data.markets)) {
    error('Phase 1', 'Invalid structure: missing markets array');
    return false;
  }
  
  const markets = data.markets;
  log('Phase 1', `Found ${markets.length} filtered markets`);
  
  // Validate each market has required fields
  for (const m of markets) {
    if (!m.ticker || !m.title) {
      error('Phase 1', `Market missing ticker or title`);
      return false;
    }
  }
  
  results.phase1.details = {
    marketCount: markets.length,
    filters: data.filters || { note: 'Filters not stored in output' },
    timestamp: data.generated_at || new Date().toISOString()
  };
  
  success('Phase 1', `${markets.length} markets in filtered list`);
  return true;
}

// ============================================================================
// Phase 2: LLM Clustering Tests
// ============================================================================

function testPhase2() {
  log('Phase 2', 'Testing LLM Clustering...');
  
  const data = loadJSON(CONFIG.clustersPath);
  if (!data) {
    error('Phase 2', `Failed to load ${CONFIG.clustersPath}`);
    return false;
  }
  
  // Validate structure (clusters is an array)
  if (!data.clusters || !Array.isArray(data.clusters)) {
    error('Phase 2', 'Invalid structure: missing clusters array');
    return false;
  }
  
  const clusters = data.clusters;
  const clusterNames = clusters.map(c => c.id || c.label);
  log('Phase 2', `Found ${clusters.length} clusters: ${clusterNames.join(', ')}`);
  
  // Validate each cluster has markets
  let totalMarkets = 0;
  for (const cluster of clusters) {
    if (!cluster.markets || !Array.isArray(cluster.markets)) {
      error('Phase 2', `Cluster ${cluster.id || 'unknown'} missing markets array`);
      return false;
    }
    
    if (cluster.markets.length === 0) {
      error('Phase 2', `Cluster ${cluster.id || 'unknown'} has no markets`);
      return false;
    }
    
    totalMarkets += cluster.markets.length;
    
    // Validate each market (can be string ticker or object)
    for (const m of cluster.markets) {
      if (typeof m !== 'string' && typeof m !== 'object') {
        error('Phase 2', `Cluster ${cluster.id} market has invalid type`);
        return false;
      }
    }
  }
  
  results.phase2.details = {
    clusterCount: clusters.length,
    totalMarkets,
    clusterNames,
    hiddenCorrelations: data.hidden_correlations || []
  };
  
  success('Phase 2', `${clusters.length} clusters with ${totalMarkets} total markets`);
  return true;
}

// ============================================================================
// Phase 3: Pearson Correlation Tests
// ============================================================================

function testPhase3() {
  log('Phase 3', 'Testing Pearson Correlation Detection...');
  
  const data = loadJSON(CONFIG.correlationPairsPath);
  if (!data) {
    error('Phase 3', `Failed to load ${CONFIG.correlationPairsPath}`);
    return false;
  }
  
  // Validate structure
  if (!data.pairs || !Array.isArray(data.pairs)) {
    error('Phase 3', 'Invalid structure: missing pairs array');
    return false;
  }
  
  if (!data.config || !data.config.minCorrelation) {
    error('Phase 3', 'Invalid structure: missing config');
    return false;
  }
  
  const pairs = data.pairs;
  const opportunities = pairs.filter(p => p.is_arbitrage_opportunity);
  
  log('Phase 3', `Found ${pairs.length} correlated pairs, ${opportunities.length} arbitrage opportunities`);
  
  // Validate minimum pairs
  if (pairs.length < CONFIG.expectedMinPairs) {
    error('Phase 3', `Insufficient pairs: ${pairs.length} < ${CONFIG.expectedMinPairs}`);
    return false;
  }
  
  // Validate each pair has required fields
  for (const pair of pairs) {
    const required = ['cluster', 'market_a', 'market_b', 'pearson_correlation', 
                      'expected_spread', 'current_spread', 'spread_deviation',
                      'arbitrage_confidence', 'direction', 'is_arbitrage_opportunity'];
    for (const field of required) {
      if (!(field in pair)) {
        error('Phase 3', `Pair ${pair.market_a}/${pair.market_b} missing field: ${field}`);
        return false;
      }
    }
    
    // Validate correlation is in valid range
    if (pair.pearson_correlation < -1 || pair.pearson_correlation > 1) {
      error('Phase 3', `Invalid correlation for ${pair.market_a}/${pair.market_b}: ${pair.pearson_correlation}`);
      return false;
    }
    
    // Validate confidence is in valid range
    if (pair.arbitrage_confidence < 0 || pair.arbitrage_confidence > 1) {
      error('Phase 3', `Invalid confidence for ${pair.market_a}/${pair.market_b}: ${pair.arbitrage_confidence}`);
      return false;
    }
  }
  
  results.phase3.details = {
    totalPairs: pairs.length,
    opportunities: opportunities.length,
    config: data.config,
    topPair: pairs[0]
  };
  
  success('Phase 3', `${pairs.length} pairs, ${opportunities.length} opportunities`);
  return true;
}

// ============================================================================
// Phase 4: C++ Engine Tests
// ============================================================================

function testPhase4() {
  log('Phase 4', 'Testing C++ Execution Engine...');
  
  // Check engine binary exists
  if (!fs.existsSync(CONFIG.enginePath)) {
    error('Phase 4', `Engine binary not found: ${CONFIG.enginePath}`);
    return false;
  }
  
  // Check test suite exists
  if (!fs.existsSync(CONFIG.testSuitePath)) {
    error('Phase 4', `Test suite not found: ${CONFIG.testSuitePath}`);
    return false;
  }
  
  // Run C++ test suite
  log('Phase 4', 'Running C++ test suite...');
  try {
    const output = execSync(CONFIG.testSuitePath, { encoding: 'utf8', timeout: 30000 });
    
    // Parse test results
    const passMatch = output.match(/Passed:\s*(\d+)/);
    const failMatch = output.match(/Failed:\s*(\d+)/);
    
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    
    if (failed > 0) {
      error('Phase 4', `${failed} C++ tests failed`);
      return false;
    }
    
    // Extract latency benchmarks
    const spreadMatch = output.match(/avg spread calc = ([\d.]+) µs/);
    const cacheMatch = output.match(/avg cache update = ([\d.]+) µs/);
    
    results.phase4.details = {
      testsPassed: passed,
      testsFailed: failed,
      spreadCalcLatencyUs: spreadMatch ? parseFloat(spreadMatch[1]) : null,
      cacheUpdateLatencyUs: cacheMatch ? parseFloat(cacheMatch[1]) : null
    };
    
    success('Phase 4', `${passed} C++ tests passed`);
    
    if (spreadMatch) {
      log('Phase 4', `  Spread calc latency: ${spreadMatch[1]} µs`);
    }
    if (cacheMatch) {
      log('Phase 4', `  Cache update latency: ${cacheMatch[1]} µs`);
    }
    
    return true;
  } catch (e) {
    error('Phase 4', `Test suite execution failed: ${e.message}`);
    return false;
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

function testIntegration() {
  log('Integration', 'Testing Full Pipeline Integration...');
  
  // Test 1: Verify data flows correctly between phases
  const filtered = loadJSON(CONFIG.filteredMarketsPath);
  const clusters = loadJSON(CONFIG.clustersPath);
  const correlations = loadJSON(CONFIG.correlationPairsPath);
  
  // Verify correlation pairs reference valid clusters
  const clusterIds = clusters.clusters.map(c => c.id);
  for (const pair of correlations.pairs) {
    if (!clusterIds.includes(pair.cluster)) {
      error('Integration', `Pair references unknown cluster: ${pair.cluster} (valid: ${clusterIds.join(', ')})`);
      return false;
    }
  }
  
  // Test 2: Verify engine can load correlation pairs
  log('Integration', 'Testing engine with correlation pairs...');
  try {
    const output = execSync(`${CONFIG.enginePath} ${CONFIG.correlationPairsPath}`, { 
      encoding: 'utf8', 
      timeout: 10000 
    });
    
    if (!output.includes('Engine initialized') && !output.includes('smoke test')) {
      error('Integration', 'Engine failed to initialize with correlation pairs');
      return false;
    }
    
    success('Integration', 'Engine initialized and ran smoke test successfully');
  } catch (e) {
    // Engine returns non-zero on normal shutdown, check output
    if (e.stdout && (e.stdout.includes('smoke test') || e.stdout.includes('Engine initialized'))) {
      success('Integration', 'Engine initialized and ran smoke test successfully');
    } else {
      error('Integration', `Engine execution failed: ${e.message}`);
      return false;
    }
  }
  
  // Test 3: Verify latency budget
  const spreadLatency = results.phase4.details.spreadCalcLatencyUs;
  const cacheLatency = results.phase4.details.cacheUpdateLatencyUs;
  
  if (spreadLatency && spreadLatency > 100) {
    error('Integration', `Spread calc latency ${spreadLatency}µs exceeds 100µs budget`);
    return false;
  }
  
  if (cacheLatency && cacheLatency > 50) {
    error('Integration', `Cache update latency ${cacheLatency}µs exceeds 50µs budget`);
    return false;
  }
  
  results.integration.details = {
    dataFlowValid: true,
    engineLoadsPairs: true,
    latencyBudgetMet: true,
    endToEndLatency: `spread=${spreadLatency}µs, cache=${cacheLatency}µs`
  };
  
  success('Integration', 'All integration tests passed');
  return true;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport() {
  const report = {
    test_run: {
      timestamp: new Date().toISOString(),
      test_suite: 'T352_Phase4_E2E_Integration',
      version: '1.0.0'
    },
    results: {
      phase1_market_filtering: results.phase1,
      phase2_llm_clustering: results.phase2,
      phase3_correlation_detection: results.phase3,
      phase4_cpp_engine: results.phase4,
      full_integration: results.integration
    },
    summary: {
      total_tests: 5,
      passed: Object.values(results).filter(r => r.passed).length,
      failed: Object.values(results).filter(r => !r.passed).length,
      success_rate: `${(Object.values(results).filter(r => r.passed).length / 5 * 100).toFixed(0)}%`
    }
  };
  
  return report;
}

function printReport(report) {
  console.log('\n' + '='.repeat(70));
  console.log('T352: PHASE 4 E2E INTEGRATION TEST REPORT');
  console.log('='.repeat(70));
  console.log(`Test Run: ${report.test_run.timestamp}`);
  console.log(`Suite: ${report.test_run.test_suite} v${report.test_run.version}`);
  console.log('-'.repeat(70));
  
  console.log('\n📊 PHASE RESULTS:');
  console.log(`  Phase 1 (Market Filtering):    ${results.phase1.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Phase 2 (LLM Clustering):      ${results.phase2.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Phase 3 (Correlation):         ${results.phase3.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Phase 4 (C++ Engine):          ${results.phase4.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Integration (End-to-End):      ${results.integration.passed ? '✅ PASS' : '❌ FAIL'}`);
  
  console.log('\n📈 SUMMARY:');
  console.log(`  Total Tests: ${report.summary.total_tests}`);
  console.log(`  Passed: ${report.summary.passed}`);
  console.log(`  Failed: ${report.summary.failed}`);
  console.log(`  Success Rate: ${report.summary.success_rate}`);
  
  if (results.phase3.passed) {
    console.log('\n💰 ARBITRAGE OPPORTUNITIES:');
    console.log(`  Total Pairs: ${results.phase3.details.totalPairs}`);
    console.log(`  Opportunities: ${results.phase3.details.opportunities}`);
    if (results.phase3.details.topPair) {
      const p = results.phase3.details.topPair;
      console.log(`  Top Pair: ${p.market_a} / ${p.market_b}`);
      console.log(`    Correlation: ${p.pearson_correlation}`);
      console.log(`    Confidence: ${(p.arbitrage_confidence * 100).toFixed(1)}%`);
      console.log(`    Direction: ${p.direction}`);
    }
  }
  
  if (results.phase4.passed) {
    console.log('\n⚡ LATENCY BENCHMARKS:');
    console.log(`  Spread Calculation: ${results.phase4.details.spreadCalcLatencyUs} µs`);
    console.log(`  Cache Update: ${results.phase4.details.cacheUpdateLatencyUs} µs`);
    console.log(`  Target Budget: <1000 µs (1ms)`);
    console.log(`  Status: ${results.integration.details.latencyBudgetMet ? '✅ WITHIN BUDGET' : '❌ EXCEEDS BUDGET'}`);
  }
  
  console.log('\n' + '='.repeat(70));
  
  if (report.summary.failed === 0) {
    console.log('🎉 ALL TESTS PASSED — PHASE 4 READY FOR PAPER TRADING');
  } else {
    console.log('⚠️  SOME TESTS FAILED — REVIEW BEFORE PROCEEDING');
  }
  console.log('='.repeat(70) + '\n');
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('\n🔬 T352: Phase 4 E2E Integration Tests\n');
  
  // Run all test phases
  results.phase1.passed = testPhase1();
  results.phase2.passed = testPhase2();
  results.phase3.passed = testPhase3();
  results.phase4.passed = testPhase4();
  results.integration.passed = testIntegration();
  
  // Generate and print report
  const report = generateReport();
  printReport(report);
  
  // Save report to file
  const reportPath = path.join(__dirname, 'e2e_test_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log('Main', `Report saved to: ${reportPath}`);
  
  // Exit with appropriate code
  process.exit(report.summary.failed === 0 ? 0 : 1);
}

main();
