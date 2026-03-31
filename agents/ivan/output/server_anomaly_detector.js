#!/usr/bin/env node
/**
 * Server Performance Anomaly Detector — Ivan (ML Engineer)
 *
 * Statistical model to detect:
 *   1. Latency spikes (z-score outliers on p99_ms)
 *   2. Memory leak trend (linear regression on heap_used)
 *   3. Load-sensitive baselines (segment by active_agents bucket)
 *   4. Alert fatigue vs. genuine recurring issues
 *
 * Input:  public/reports/health_check_log.jsonl
 * Output: agents/ivan/output/server_anomaly_report.md
 *         agents/ivan/output/server_anomaly_model.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const LOG_PATH = path.join(ROOT, 'public/reports/health_check_log.jsonl');
const REPORT_PATH = path.join(ROOT, 'agents/ivan/output/server_anomaly_report.md');
const MODEL_PATH = path.join(ROOT, 'agents/ivan/output/server_anomaly_model.json');

// ─── Load Data ────────────────────────────────────────────────────────────────

function loadLog(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] Log not found: ${filePath}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const records = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      // Skip error records (missing core metrics)
      if (r.p99_ms == null) continue;
      // Mark auth-failure records; they lack heap/agent data
      r._auth_failure = r.status_code === 401;
      r._healthy = r.status_code === 200;
      r._ts = new Date(r.timestamp).getTime();
      records.push(r);
    } catch (_) { /* skip malformed */ }
  }
  return records.sort((a, b) => a._ts - b._ts);
}

// ─── Statistics Utilities ─────────────────────────────────────────────────────

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr, mu) {
  const m = mu !== undefined ? mu : mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function linearRegression(xs, ys) {
  // Returns { slope, intercept, r2 }
  const n = xs.length;
  const xm = mean(xs);
  const ym = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xm) * (ys[i] - ym);
    den += (xs[i] - xm) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = ym - slope * xm;
  // R²
  const ssTot = ys.reduce((s, y) => s + (y - ym) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function percentile(sortedArr, p) {
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function iqrBounds(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  return { q1, q3, lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr };
}

// ─── Feature Engineering ──────────────────────────────────────────────────────

function bucketAgents(n) {
  if (n < 0) return 'unknown';  // auth failure — no data
  if (n === 0) return 'idle';
  if (n <= 5) return 'low';
  if (n <= 15) return 'medium';
  return 'high';
}

function buildFeatures(records) {
  return records.map((r, i) => ({
    i,
    ts: r._ts,
    p99: r.p99_ms,
    p50: r.p50_ms,
    duration: r.duration_ms,
    heapUsed: r.heap_used != null ? r.heap_used / 1e6 : null,       // MB
    heapTotal: r.heap_total != null ? r.heap_total / 1e6 : null,   // MB
    heapRatio: r.heap_used != null ? r.heap_used / Math.max(r.heap_total, 1) : null,
    activeAgents: r.active_agents != null ? r.active_agents : -1,
    loadBucket: bucketAgents(r.active_agents != null ? r.active_agents : -1),
    sseClients: r.sse_clients != null ? r.sse_clients : 0,
    uptime: r.uptime_ms != null ? r.uptime_ms / 1000 : 0,        // seconds
    authFailure: r._auth_failure || false,
    statusCode: r.status_code,
    alertCount: (r.alerts_fired || []).length,
    alerts: r.alerts_fired || [],
  }));
}

// ─── Model: Latency Anomaly Detector ─────────────────────────────────────────

function trainLatencyModel(features) {
  // Per-load-bucket baseline
  const buckets = {};
  for (const f of features) {
    if (!buckets[f.loadBucket]) buckets[f.loadBucket] = [];
    buckets[f.loadBucket].push(f.p99);
  }
  const baselines = {};
  for (const [bucket, vals] of Object.entries(buckets)) {
    const mu = mean(vals);
    const sigma = std(vals, mu);
    const bounds = iqrBounds(vals);
    baselines[bucket] = { mu, sigma, count: vals.length, ...bounds };
  }
  return baselines;
}

function detectLatencyAnomalies(features, baselines, zThreshold = 2.5) {
  const anomalies = [];
  for (const f of features) {
    const base = baselines[f.loadBucket];
    if (!base || base.sigma < 0.01) continue;
    const z = (f.p99 - base.mu) / base.sigma;
    if (Math.abs(z) > zThreshold || f.p99 > base.hi) {
      anomalies.push({
        type: 'latency_spike',
        index: f.i,
        ts: new Date(f.ts).toISOString(),
        loadBucket: f.loadBucket,
        p99: f.p99,
        baseline_mu: Math.round(base.mu * 10) / 10,
        z_score: Math.round(z * 100) / 100,
        severity: Math.abs(z) > 4 ? 'critical' : Math.abs(z) > 3 ? 'high' : 'medium',
      });
    }
  }
  return anomalies;
}

// ─── Model: Memory Leak Detector ─────────────────────────────────────────────

function detectMemoryLeak(features) {
  // Only use records with actual heap data
  const heapFeatures = features.filter(f => f.heapUsed !== null);
  if (heapFeatures.length < 5) return null;
  const features_ = heapFeatures;
  // Normalize timestamps to 0-indexed minutes from first entry
  const t0 = features_[0].ts;
  const xs = features_.map(f => (f.ts - t0) / 60000);  // minutes
  const ys = features_.map(f => f.heapUsed);
  const reg = linearRegression(xs, ys);

  // Compute per-uptime-session trend (heap resets on restart)
  // Detect restart points: uptime decreasing
  const restarts = [];
  for (let i = 1; i < features_.length; i++) {
    if (features_[i].uptime > 0 && features_[i - 1].uptime > 0 &&
        features_[i].uptime < features_[i - 1].uptime) {
      restarts.push(i);
    }
  }

  // Find segments between restarts
  const segments = [];
  let start = 0;
  for (const rIdx of [...restarts, features.length]) {
    const seg = features_.slice(start, rIdx);
    if (seg.length >= 3) {
      const sx = seg.map((f, j) => j);
      const sy = seg.map(f => f.heapUsed);
      const sr = linearRegression(sx, sy);
      segments.push({
        start: seg[0].ts,
        end: seg[seg.length - 1].ts,
        points: seg.length,
        slope_mb_per_cycle: Math.round(sr.slope * 100) / 100,
        r2: Math.round(sr.r2 * 1000) / 1000,
        is_leak: sr.slope > 0.5 && sr.r2 > 0.5,  // >0.5MB/cycle AND strong trend
      });
    }
    start = rIdx;
  }

  return {
    overall: {
      slope_mb_per_min: Math.round(reg.slope * 1000) / 1000,
      r2: Math.round(reg.r2 * 1000) / 1000,
      is_trending_up: reg.slope > 0,
    },
    restarts_detected: restarts.length,
    segments,
    leak_detected: segments.some(s => s.is_leak),
  };
}

// ─── Model: Alert Pattern Analysis ───────────────────────────────────────────

function analyzeAlerts(features) {
  const alertCounts = {};
  const alertWindows = {};
  for (const f of features) {
    for (const a of f.alerts) {
      alertCounts[a] = (alertCounts[a] || 0) + 1;
      if (!alertWindows[a]) alertWindows[a] = [];
      alertWindows[a].push(new Date(f.ts).toISOString());
    }
  }
  const total = features.length;
  const patterns = Object.entries(alertCounts).map(([id, count]) => ({
    alert_id: id,
    count,
    rate: Math.round((count / total) * 1000) / 10,  // per 100 observations
    first_seen: alertWindows[id][0],
    last_seen: alertWindows[id][alertWindows[id].length - 1],
    verdict: count / total > 0.3 ? 'chronic' : count > 5 ? 'recurring' : 'sporadic',
  }));
  return patterns.sort((a, b) => b.count - a.count);
}

// ─── Summary Stats ────────────────────────────────────────────────────────────

function summaryStats(features) {
  const p99vals = features.map(f => f.p99);
  const heapVals = features.map(f => f.heapUsed);
  const p99sorted = [...p99vals].sort((a, b) => a - b);
  const heapSorted = [...heapVals].sort((a, b) => a - b);

  return {
    observations: features.length,
    time_span_min: Math.round((features[features.length - 1].ts - features[0].ts) / 60000),
    p99: {
      min: p99sorted[0],
      p50: Math.round(percentile(p99sorted, 50)),
      p95: Math.round(percentile(p99sorted, 95)),
      max: p99sorted[p99sorted.length - 1],
      mean: Math.round(mean(p99vals) * 10) / 10,
      std: Math.round(std(p99vals) * 10) / 10,
    },
    heap_mb: {
      min: Math.round(heapSorted[0] * 10) / 10,
      p50: Math.round(percentile(heapSorted, 50) * 10) / 10,
      p95: Math.round(percentile(heapSorted, 95) * 10) / 10,
      max: Math.round(heapSorted[heapSorted.length - 1] * 10) / 10,
      mean: Math.round(mean(heapVals) * 10) / 10,
    },
    load_distribution: Object.fromEntries(
      ['idle', 'low', 'medium', 'high'].map(b => [
        b, features.filter(f => f.loadBucket === b).length
      ])
    ),
  };
}

// ─── Report Writer ────────────────────────────────────────────────────────────

function writeReport(stats, latencyModel, anomalies, memLeak, alertPatterns) {
  const now = new Date().toISOString();
  const overallHealth = (() => {
    let issues = 0;
    if (anomalies.filter(a => a.severity === 'critical').length > 0) issues += 3;
    if (anomalies.filter(a => a.severity === 'high').length > 2) issues += 2;
    if (memLeak && memLeak.leak_detected) issues += 2;
    if (alertPatterns.some(p => p.verdict === 'chronic')) issues += 1;
    if (issues === 0) return 'HEALTHY';
    if (issues <= 2) return 'WATCH';
    if (issues <= 4) return 'DEGRADED';
    return 'CRITICAL';
  })();

  let md = `# Server Performance Anomaly Report\n`;
  md += `**Generated:** ${now}  \n`;
  md += `**Model:** Statistical Anomaly Detector v1.0 (Ivan, ML Engineer)  \n`;
  md += `**Status:** ${overallHealth}\n\n`;

  md += `---\n\n## Summary Statistics\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Observations | ${stats.observations} |\n`;
  md += `| Time Span | ${stats.time_span_min} minutes |\n`;
  md += `| P99 Latency (mean) | ${stats.p99.mean}ms |\n`;
  md += `| P99 Latency (P95 of obs) | ${stats.p99.p95}ms |\n`;
  md += `| P99 Latency (max) | ${stats.p99.max}ms |\n`;
  md += `| Heap Used (mean) | ${stats.heap_mb.mean}MB |\n`;
  md += `| Heap Used (max) | ${stats.heap_mb.max}MB |\n\n`;

  md += `**Load distribution** (active_agents buckets):\n`;
  for (const [b, c] of Object.entries(stats.load_distribution)) {
    const pct = Math.round((c / stats.observations) * 100);
    md += `- ${b}: ${c} observations (${pct}%)\n`;
  }

  md += `\n---\n\n## Load-Aware Latency Baselines\n\n`;
  md += `| Load Bucket | Count | Mean P99 | Std | IQR Lo | IQR Hi |\n`;
  md += `|-------------|-------|----------|-----|--------|--------|\n`;
  for (const [bucket, base] of Object.entries(latencyModel)) {
    md += `| ${bucket} | ${base.count} | ${Math.round(base.mu * 10) / 10}ms | ${Math.round(base.sigma * 10) / 10}ms | ${Math.round(base.lo * 10) / 10}ms | ${Math.round(base.hi * 10) / 10}ms |\n`;
  }

  md += `\n---\n\n## Latency Anomalies\n\n`;
  if (anomalies.length === 0) {
    md += `No latency anomalies detected (z-score threshold: 2.5σ).\n`;
  } else {
    md += `Detected **${anomalies.length}** latency anomalies:\n\n`;
    md += `| # | Timestamp | Load | P99 | Baseline | Z-Score | Severity |\n`;
    md += `|---|-----------|------|-----|----------|---------|----------|\n`;
    anomalies.slice(0, 20).forEach((a, i) => {
      md += `| ${i + 1} | ${a.ts.replace('T', ' ').replace('Z', '')} | ${a.loadBucket} | ${a.p99}ms | ${a.baseline_mu}ms | ${a.z_score} | ${a.severity} |\n`;
    });
    if (anomalies.length > 20) md += `\n*... and ${anomalies.length - 20} more*\n`;
  }

  md += `\n---\n\n## Memory Trend Analysis\n\n`;
  if (!memLeak) {
    md += `Insufficient data for memory trend analysis (need ≥5 observations).\n`;
  } else {
    const trend = memLeak.overall;
    md += `**Overall trend:** slope = ${trend.slope_mb_per_min} MB/min, R² = ${trend.r2}  \n`;
    md += `**Direction:** ${trend.is_trending_up ? '↑ Growing' : '↓ Declining / Stable'}  \n`;
    md += `**Restarts detected:** ${memLeak.restarts_detected}  \n`;
    md += `**Memory leak verdict:** ${memLeak.leak_detected ? '⚠️ LEAK SUSPECTED' : '✅ No leak detected'}\n\n`;

    if (memLeak.segments.length > 0) {
      md += `**Per-session analysis:**\n\n`;
      md += `| Session | Points | Slope (MB/cycle) | R² | Leak? |\n`;
      md += `|---------|--------|------------------|----|-------|\n`;
      memLeak.segments.forEach((s, i) => {
        const start = new Date(s.start).toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
        md += `| ${i + 1} | ${s.points} | ${s.slope_mb_per_cycle} | ${s.r2} | ${s.is_leak ? '⚠️ YES' : '✅ No'} |\n`;
      });
    }
  }

  md += `\n---\n\n## Alert Pattern Analysis\n\n`;
  if (alertPatterns.length === 0) {
    md += `No alerts observed in this window.\n`;
  } else {
    md += `| Alert ID | Count | Rate (per 100 obs) | Verdict |\n`;
    md += `|----------|-------|--------------------|---------|\n`;
    for (const p of alertPatterns) {
      md += `| ${p.alert_id} | ${p.count} | ${p.rate}% | ${p.verdict} |\n`;
    }
  }

  md += `\n---\n\n## Recommendations\n\n`;
  const recs = [];

  if (anomalies.filter(a => a.severity === 'critical').length > 0) {
    recs.push('**CRITICAL:** Investigate critical latency spikes immediately. Check server.js request handling and database query times.');
  }
  if (anomalies.filter(a => a.severity === 'high').length > 2) {
    recs.push('**HIGH:** Multiple high-severity latency anomalies. Consider adding request queuing or rate limiting review.');
  }
  if (memLeak && memLeak.leak_detected) {
    recs.push('**HIGH:** Memory leak suspected in one or more server sessions. Profile heap with `--inspect` and check for unclosed streams/listeners.');
  }
  if (memLeak && memLeak.overall.slope_mb_per_min > 0.1) {
    recs.push(`**MEDIUM:** Heap growing at ${memLeak.overall.slope_mb_per_min} MB/min overall. Monitor restart frequency.`);
  }
  if (alertPatterns.some(p => p.verdict === 'chronic')) {
    const chronic = alertPatterns.filter(p => p.verdict === 'chronic').map(p => p.alert_id).join(', ');
    recs.push(`**MEDIUM:** Chronic alerts (${chronic}) firing >30% of the time. Either fix root cause or adjust thresholds.`);
  }
  if (alertPatterns.some(p => p.verdict === 'recurring')) {
    recs.push('**LOW:** Recurring alerts present. Review alert definitions for false positives.');
  }

  const idlePct = Math.round((stats.load_distribution.idle / stats.observations) * 100);
  if (idlePct > 60) {
    recs.push(`**INFO:** Server idle (0 agents) ${idlePct}% of the time. Smart-start is working well.`);
  }

  if (recs.length === 0) {
    recs.push('✅ No critical issues detected. Server is performing within expected parameters.');
  }

  recs.forEach((r, i) => { md += `${i + 1}. ${r}\n`; });

  md += `\n---\n\n*Report generated by server_anomaly_detector.js — Ivan (ML Engineer)*\n`;
  md += `*Model: z-score latency detection (σ=2.5) + IQR bounds + linear regression memory trend*\n`;

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('[INFO] Loading health log...');
  const records = loadLog(LOG_PATH);
  console.log(`[INFO] Loaded ${records.length} observations`);

  console.log('[INFO] Engineering features...');
  const features = buildFeatures(records);

  console.log('[INFO] Computing summary stats...');
  const stats = summaryStats(features);

  console.log('[INFO] Training load-aware latency model...');
  const latencyModel = trainLatencyModel(features);

  console.log('[INFO] Detecting latency anomalies...');
  const anomalies = detectLatencyAnomalies(features, latencyModel);
  console.log(`[INFO] Found ${anomalies.length} latency anomalies`);

  console.log('[INFO] Analyzing memory trend...');
  const memLeak = detectMemoryLeak(features);

  console.log('[INFO] Analyzing alert patterns...');
  const alertPatterns = analyzeAlerts(features);

  // Save model as JSON for downstream use
  const model = {
    generated: new Date().toISOString(),
    observations: stats.observations,
    latency_baselines: latencyModel,
    anomaly_summary: {
      total: anomalies.length,
      critical: anomalies.filter(a => a.severity === 'critical').length,
      high: anomalies.filter(a => a.severity === 'high').length,
      medium: anomalies.filter(a => a.severity === 'medium').length,
    },
    memory_leak: memLeak,
    alert_patterns: alertPatterns,
    stats,
  };

  fs.writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2));
  console.log(`[INFO] Model saved: ${MODEL_PATH}`);

  const report = writeReport(stats, latencyModel, anomalies, memLeak, alertPatterns);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`[INFO] Report saved: ${REPORT_PATH}`);

  // Print summary to stdout
  console.log('\n=== ANOMALY DETECTION SUMMARY ===');
  console.log(`Observations: ${stats.observations} over ${stats.time_span_min} min`);
  console.log(`P99 latency: mean=${stats.p99.mean}ms, max=${stats.p99.max}ms`);
  console.log(`Heap: mean=${stats.heap_mb.mean}MB, max=${stats.heap_mb.max}MB`);
  console.log(`Latency anomalies: ${anomalies.length}`);
  if (memLeak) {
    console.log(`Memory trend: slope=${memLeak.overall.slope_mb_per_min}MB/min, leak=${memLeak.leak_detected}`);
  }
  console.log(`Alert patterns: ${alertPatterns.length} distinct alerts`);
  console.log('===================================');
}

main();
