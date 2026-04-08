#!/usr/bin/env node
/**
 * D004 Full Pipeline Latency Benchmark — T1018
 * Author: Nick (Performance Engineer)
 *
 * Measures per-phase latency for the D004 arbitrage pipeline:
 *   Phase 1: Market Filter (volume + price-range qualification)
 *   Phase 2: LLM Clustering (feature extraction + cluster assignment — non-LLM parts)
 *   Phase 3: Pearson Correlation Detection
 *   Phase 4: Signal Generation (extract tradeable signals from pairs)
 *
 * Uses:
 *   - Grace's live markets_filtered.json (119 markets, Sprint 9 refresh)
 *   - Ivan's market_clusters.json (cluster structure)
 *   - Bob's pearson_detector.js (Phase 3 actual implementation)
 *
 * Run: node agents/nick/output/benchmark_d004_pipeline.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

// __dirname resolves via symlink to output/nick/ — shared output is one level up
const CODEBASE = path.join(__dirname, "../shared/codebase/backend");
const DATA_DIR = path.join(__dirname, "../shared/codebase/output");
const IVAN_DIR = path.join(__dirname, "../ivan");

const { processClusters, generatePriceHistory, CONFIG } = require(
  path.join(CODEBASE, "correlation/pearson_detector.js")
);

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

function bench(label, fn, iterations = 20) {
  const times = [];
  let result;
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    result = fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6); // ns → ms
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.50)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.min(times.length - 1, Math.floor(times.length * 0.99))];
  return { label, p50, p95, p99, min: times[0], max: times[times.length - 1], result };
}

// ---------------------------------------------------------------------------
// Phase 1: Market Filter
// Market qualification: volume > 10,000 AND price in [10,40] OR [60,90]
// ---------------------------------------------------------------------------

function buildRawMarkets(qualifyingMarkets) {
  // Reconstruct a realistic raw feed: mix qualifying + noise markets
  const raw = [...qualifyingMarkets];
  // Add synthetic ineligible markets (mid-range price or low volume)
  for (let i = 0; i < 50; i++) {
    raw.push({
      ticker: `NOISE-${i}`,
      yes_bid: 41 + (i % 18), // mid-range 41-58 — excluded
      yes_ask: 43 + (i % 18),
      volume: 500 + i * 10,    // low volume — excluded
      open_interest: 100,
      status: "active",
      category: "Other",
    });
  }
  return raw;
}

function phaseOneFilter(rawMarkets) {
  const MIN_VOLUME = 10000;
  const TARGET_RANGES = [{ min: 10, max: 40 }, { min: 60, max: 90 }];
  return rawMarkets.filter((m) => {
    if ((m.volume || 0) < MIN_VOLUME) return false;
    const mid = ((m.yes_bid || 0) + (m.yes_ask || 0)) / 2;
    return TARGET_RANGES.some((r) => mid >= r.min && mid <= r.max);
  });
}

// ---------------------------------------------------------------------------
// Phase 2: Cluster Feature Extraction (non-LLM parts of Ivan's pipeline)
// LLM call itself is not benchmarkable without API key — we time the CPU work:
//   - Feature vector construction per market
//   - Category grouping (deterministic baseline for LLM output)
//   - Cluster struct assembly
// ---------------------------------------------------------------------------

function extractFeatures(market) {
  const mid = ((market.yes_bid || 50) + (market.yes_ask || 52)) / 2;
  const spread = (market.yes_ask || 52) - (market.yes_bid || 50);
  return {
    ticker: market.ticker,
    mid,
    spread,
    volume: market.volume || 0,
    category: market.category || "Unknown",
    // Normalized features for clustering input
    normMid: mid / 100,
    normVolume: Math.log1p(market.volume || 0),
    spreadRatio: spread / Math.max(mid, 1),
  };
}

function phaseTwoCluster(markets) {
  // Deterministic category-based clustering (mirrors Ivan's fallback when LLM unavailable)
  const byCategory = {};
  for (const m of markets) {
    const features = extractFeatures(m);
    const cat = features.category;
    if (!byCategory[cat]) byCategory[cat] = { id: `cat_${cat}`, markets: [], confidence: 0.7 };
    byCategory[cat].markets.push(features.ticker);
  }
  const clusters = Object.values(byCategory).filter((c) => c.markets.length >= 2);
  return { clusters, total_markets: markets.length };
}

// ---------------------------------------------------------------------------
// Phase 3: Pearson Correlation (actual implementation from pearson_detector.js)
// ---------------------------------------------------------------------------

function buildClustersForPearson(clusterStruct) {
  // processClusters() handles enrichment internally — just pass string ticker lists
  return {
    clusters: clusterStruct.clusters.map((cluster) => ({
      ...cluster,
      markets: (cluster.markets || []).map((m) =>
        typeof m === "string" ? m : m.ticker
      ),
    })),
  };
}

function phaseThreePearson(enrichedClusters) {
  return processClusters(enrichedClusters);
}

// ---------------------------------------------------------------------------
// Phase 4: Signal Generation (extract actionable signals from pairs)
// ---------------------------------------------------------------------------

function phaseFourSignals(correlationResults) {
  const signals = [];
  for (const pair of correlationResults.pairs || []) {
    if (!pair.is_arbitrage_opportunity) continue;
    signals.push({
      pair_id: `${pair.market_a}|${pair.market_b}`,
      cluster: pair.cluster,
      correlation: pair.pearson_correlation,
      direction: pair.direction || "neutral",
      confidence: pair.arbitrage_confidence || 0,
      spread_zscore: pair.spread_z_score || 0,
      timestamp: new Date().toISOString(),
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Scale tests: run Phase 3 at different cluster sizes to find O(n²) knee
// ---------------------------------------------------------------------------

function buildScaledClusters(marketsPerCluster, numClusters) {
  // Pass string tickers — processClusters() enriches with price histories internally
  const clusters = [];
  for (let c = 0; c < numClusters; c++) {
    const markets = [];
    for (let m = 0; m < marketsPerCluster; m++) {
      markets.push(`CLUSTER${c}-MKT${m}`);
    }
    clusters.push({ id: `cluster_${c}`, markets, confidence: 0.8 });
  }
  return { clusters };
}

// ---------------------------------------------------------------------------
// Main benchmark
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== D004 Pipeline Latency Benchmark — T1018 ===\n");
  console.log(`Config: minCorrelation=${CONFIG.minCorrelation}, spreadThreshold=${CONFIG.spreadThreshold}σ\n`);

  // Load live data
  const mfData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "markets_filtered.json"), "utf8"));
  const qualifyingMarkets = mfData.qualifying_markets || [];
  const rawMarkets = buildRawMarkets(qualifyingMarkets);

  const ivanClusters = JSON.parse(fs.readFileSync(path.join(IVAN_DIR, "market_clusters.json"), "utf8"));

  console.log(`Live data: ${rawMarkets.length} raw markets (${qualifyingMarkets.length} qualifying), ${ivanClusters.clusters.length} Ivan clusters\n`);

  // ---- Phase 1 ----
  const p1 = bench("Phase 1: Market Filter", () => phaseOneFilter(rawMarkets));
  const qualCount = p1.result.length;

  // ---- Phase 2 ----
  const p2 = bench("Phase 2: Cluster Feature Extraction", () => phaseTwoCluster(p1.result));
  const clusterCount = p2.result.clusters.length;

  // processClusters mutates cluster.markets (strings → enriched objects) in place.
  // Deep-clone on every iteration so each run starts with a clean string-ticker structure.
  const p3live = bench("Phase 3: Pearson (Ivan data — 2 clusters)", () =>
    phaseThreePearson(buildClustersForPearson(ivanClusters)));

  const p3scale = bench("Phase 3: Pearson (10 clusters × 10 markets = 450 pairs)", () =>
    phaseThreePearson(buildScaledClusters(10, 10)));

  const p3stress = bench("Phase 3: Pearson (20 clusters × 15 markets = 2100 pairs)", () =>
    phaseThreePearson(buildScaledClusters(15, 20)));

  // ---- Phase 4 ----
  const p4 = bench("Phase 4: Signal Generation", () => phaseFourSignals(p3scale.result));

  // ---- End-to-end (Phase 1 → 2 → 3 → 4, live data scale) ----
  const e2e = bench("E2E: Phase 1→2→3→4 (live data, Ivan clusters)", () => {
    const filtered = phaseOneFilter(rawMarkets);
    const clustered = phaseTwoCluster(filtered);
    // Phase 2 produces feature objects — extract tickers for Phase 3
    const clusterForP3 = {
      clusters: clustered.clusters.map((c) => ({
        ...c,
        markets: c.markets.map((t) => (typeof t === "string" ? t : t.ticker)),
      })),
    };
    const corr = phaseThreePearson(clusterForP3);
    return phaseFourSignals(corr);
  });

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  const results = [p1, p2, p3live, p3scale, p3stress, p4, e2e];

  console.log("┌─────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Phase                                           │  p50ms │  p95ms │  p99ms │");
  console.log("├─────────────────────────────────────────────────────────────────────────────┤");
  for (const r of results) {
    const label = r.label.padEnd(48).slice(0, 48);
    console.log(`│ ${label} │ ${r.p50.toFixed(3).padStart(6)} │ ${r.p95.toFixed(3).padStart(6)} │ ${r.p99.toFixed(3).padStart(6)} │`);
  }
  console.log("└─────────────────────────────────────────────────────────────────────────────┘");

  console.log(`\nOutput:`);
  console.log(`  Phase 1: ${rawMarkets.length} raw → ${qualCount} qualifying markets`);
  console.log(`  Phase 2: ${qualCount} markets → ${clusterCount} clusters`);
  console.log(`  Phase 3 (live): ${ivanClusters.clusters.length} clusters → ${p3live.result.total_pairs_analyzed} pairs, ${p3live.result.arbitrage_opportunities} opportunities`);
  console.log(`  Phase 3 (10×10): 100 markets → ${p3scale.result.total_pairs_analyzed} pairs, ${p3scale.result.arbitrage_opportunities} opportunities`);
  console.log(`  Phase 3 (stress): 300 markets → ${p3stress.result.total_pairs_analyzed} pairs, ${p3stress.result.arbitrage_opportunities} opportunities`);
  console.log(`  Phase 4: ${p4.result.length} actionable signals`);
  console.log(`  E2E (realistic): ${e2e.p95.toFixed(3)}ms p95`);

  // Bottleneck analysis
  console.log("\n── Bottleneck Analysis ──────────────────────────────────────────");
  const phases = [
    { name: "Phase 1", ms: p1.p95 },
    { name: "Phase 2", ms: p2.p95 },
    { name: "Phase 3 (live)", ms: p3live.p95 },
    { name: "Phase 4", ms: p4.p95 },
  ];
  const totalBudget = 2000; // 2s SLO
  for (const ph of phases) {
    const pct = ((ph.ms / totalBudget) * 100).toFixed(1);
    const flag = ph.ms > 100 ? " ⚠️ >100ms" : ph.ms > 10 ? " ℹ️ >10ms" : " ✅";
    console.log(`  ${ph.name.padEnd(20)} p95=${ph.ms.toFixed(3).padStart(8)}ms  (${pct}% of 2s SLO)${flag}`);
  }

  console.log("\n── Scale Risk (Phase 3 O(n²)) ───────────────────────────────────");
  console.log(`  Ivan live (3 mkts, ~1 pair):    p95=${p3live.p95.toFixed(3)}ms`);
  console.log(`  10×10 (100 mkts, 450 pairs):    p95=${p3scale.p95.toFixed(3)}ms`);
  console.log(`  20×15 (300 mkts, 2100 pairs):   p95=${p3stress.p95.toFixed(3)}ms`);
  const scaleFactor = p3stress.p95 / Math.max(p3live.p95, 0.001);
  console.log(`  Scale factor (live→stress):     ${scaleFactor.toFixed(1)}×`);

  // Return structured data for report
  return {
    timestamp: new Date().toISOString(),
    task_id: "T1018",
    agent_name: "nick",
    live_data: {
      raw_markets: rawMarkets.length,
      qualifying_markets: qualCount,
      clusters: clusterCount,
      ivan_clusters: ivanClusters.clusters.length,
    },
    phases: {
      phase1_filter:           { p50: p1.p50,      p95: p1.p95,      p99: p1.p99 },
      phase2_cluster_features: { p50: p2.p50,      p95: p2.p95,      p99: p2.p99 },
      phase3_pearson_live:     { p50: p3live.p50,  p95: p3live.p95,  p99: p3live.p99 },
      phase3_pearson_10x10:    { p50: p3scale.p50, p95: p3scale.p95, p99: p3scale.p99 },
      phase3_pearson_20x15:    { p50: p3stress.p50,p95: p3stress.p95,p99: p3stress.p99 },
      phase4_signals:          { p50: p4.p50,      p95: p4.p95,      p99: p4.p99 },
      e2e_realistic_10x10:     { p50: e2e.p50,     p95: e2e.p95,     p99: e2e.p99 },
    },
  };
}

main().then((data) => {
  if (data) {
    const outPath = path.join(__dirname, "pipeline_latency_raw.json");
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`\nRaw data → ${outPath}`);
  }
}).catch((err) => {
  console.error("Benchmark failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
