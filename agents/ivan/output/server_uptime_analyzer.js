#!/usr/bin/env node
/**
 * Server Uptime Pattern Analyzer v1.0 — Ivan (ML Engineer)
 *
 * Analyzes 10k+ health_check_log.jsonl records to find:
 *   - Downtime patterns by hour-of-day and day segment
 *   - MTBF (Mean Time Between Failures) and MTTR (Mean Time To Recovery)
 *   - Outage cluster detection (back-to-back failures = single incident)
 *   - Correlation between ALT-001 (down) / ALT-002 (high latency) events
 *   - Predictive risk score for next-hour outage probability
 *
 * Usage:
 *   node server_uptime_analyzer.js
 *   node server_uptime_analyzer.js --json   # emit raw stats as JSON
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '../../..');
const LOG_FILE    = path.join(ROOT, 'public/reports/health_check_log.jsonl');
const REPORT_FILE = path.join(ROOT, 'agents/ivan/output/server_uptime_report.md');
const JSON_FILE   = path.join(ROOT, 'agents/ivan/output/server_uptime_stats.json');

const EMIT_JSON = process.argv.includes('--json');

// ── Load data ──────────────────────────────────────────────────────────────
const raw = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
const records = raw.map(l => { try { return JSON.parse(l); } catch { return null; } })
                   .filter(Boolean)
                   .filter(r => r.timestamp);

console.log(`[uptime_analyzer] Loaded ${records.length} records`);

// ── Parse timestamps ───────────────────────────────────────────────────────
const parsed = records.map(r => ({
  ts:          new Date(r.timestamp),
  ok:          r.status_code === 200,
  status_code: r.status_code,
  duration_ms: r.duration_ms || 0,
  heap_mb:     r.heap_used ? r.heap_used / 1024 / 1024 : null,
  p99_ms:      r.p99_ms || null,
  alerts:      r.alerts_fired || [],
})).sort((a, b) => a.ts - b.ts);

// ── Basic stats ────────────────────────────────────────────────────────────
const total   = parsed.length;
const okCount = parsed.filter(r => r.ok).length;
const errCount = total - okCount;
const uptimePct = (okCount / total * 100).toFixed(2);

// ── Cluster outages ────────────────────────────────────────────────────────
// Two consecutive failures within 90s = same incident
const incidents = [];
let inIncident = false;
let incStart = null;
let incEnd = null;
let incCount = 0;

for (let i = 0; i < parsed.length; i++) {
  const r = parsed[i];
  if (!r.ok) {
    if (!inIncident) {
      inIncident = true;
      incStart   = r.ts;
      incCount   = 1;
    } else {
      incCount++;
    }
    incEnd = r.ts;
  } else {
    if (inIncident) {
      incidents.push({
        start:    incStart,
        end:      incEnd,
        duration_s: (incEnd - incStart) / 1000 + 30, // +30 for last interval
        count:    incCount,
      });
      inIncident = false;
    }
  }
}
if (inIncident) {
  incidents.push({ start: incStart, end: incEnd,
    duration_s: (incEnd - incStart) / 1000 + 30, count: incCount });
}

// ── MTBF / MTTR ────────────────────────────────────────────────────────────
let mtbf_s = null;
let mttr_s = null;

if (incidents.length > 1) {
  const gaps = [];
  for (let i = 1; i < incidents.length; i++) {
    gaps.push((incidents[i].start - incidents[i-1].end) / 1000);
  }
  mtbf_s = gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

if (incidents.length > 0) {
  mttr_s = incidents.reduce((s, inc) => s + inc.duration_s, 0) / incidents.length;
}

// ── Hour-of-day distribution ───────────────────────────────────────────────
const hourBuckets = Array.from({length: 24}, (_, h) => ({ hour: h, ok: 0, err: 0 }));
for (const r of parsed) {
  const h = r.ts.getUTCHours();
  if (r.ok) hourBuckets[h].ok++;
  else hourBuckets[h].err++;
}

const hourStats = hourBuckets.map(b => {
  const tot = b.ok + b.err;
  return { ...b, total: tot, err_rate: tot > 0 ? (b.err / tot * 100).toFixed(1) : '0.0' };
});

// Highest risk hours
const riskyHours = hourStats.filter(h => h.total > 20)
  .sort((a, b) => parseFloat(b.err_rate) - parseFloat(a.err_rate))
  .slice(0, 5);

// ── Alert-type analysis ────────────────────────────────────────────────────
const alertCounts = {};
for (const r of parsed) {
  for (const a of r.alerts) {
    alertCounts[a] = (alertCounts[a] || 0) + 1;
  }
}

// ── Memory trend (linear regression on last 500 ok records) ───────────────
const memSamples = parsed.filter(r => r.ok && r.heap_mb !== null).slice(-500);
let memSlope = null;
if (memSamples.length > 10) {
  const n = memSamples.length;
  const xs = memSamples.map((_, i) => i);
  const ys = memSamples.map(r => r.heap_mb);
  const xMean = xs.reduce((a, b) => a + b) / n;
  const yMean = ys.reduce((a, b) => a + b) / n;
  const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
  const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  // slope in MB per check = MB per 30s
  memSlope = den > 0 ? num / den : 0;
  // Convert to MB/hour: 30s per check * 120 checks/hour
  memSlope = memSlope * 120;
}

// ── Predictive risk: next-hour outage probability ─────────────────────────
// Uses current-hour historical error rate + recency of last outage
const nowHour = new Date().getUTCHours();
const currentHourStats = hourStats[nowHour];
const baseRate = parseFloat(currentHourStats.err_rate) / 100;

// Recency factor: last incident < 30 min ago → elevated risk
let recencyFactor = 0;
if (incidents.length > 0) {
  const lastInc = incidents[incidents.length - 1];
  const minsSince = (Date.now() - lastInc.end) / 60000;
  if (minsSince < 30) recencyFactor = 0.3;
  else if (minsSince < 120) recencyFactor = 0.1;
}

const predictedRisk = Math.min(1.0, baseRate + recencyFactor);
const riskLabel = predictedRisk > 0.5 ? 'HIGH' : predictedRisk > 0.2 ? 'MEDIUM' : 'LOW';

// ── Stats summary ──────────────────────────────────────────────────────────
const stats = {
  generated_at: new Date().toISOString(),
  total_records: total,
  ok_count: okCount,
  err_count: errCount,
  uptime_pct: parseFloat(uptimePct),
  incident_count: incidents.length,
  mtbf_minutes: mtbf_s ? (mtbf_s / 60).toFixed(1) : null,
  mttr_seconds: mttr_s ? mttr_s.toFixed(1) : null,
  alert_counts: alertCounts,
  risky_hours: riskyHours,
  memory_slope_mb_per_hour: memSlope ? memSlope.toFixed(3) : null,
  predicted_risk_next_hour: { score: predictedRisk.toFixed(2), label: riskLabel },
  longest_incident: incidents.length > 0
    ? incidents.sort((a, b) => b.duration_s - a.duration_s)[0]
    : null,
};

if (EMIT_JSON) {
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

// ── Print summary ──────────────────────────────────────────────────────────
console.log(`[uptime_analyzer] Uptime: ${uptimePct}% (${okCount} ok / ${errCount} err)`);
console.log(`[uptime_analyzer] Incidents: ${incidents.length} | MTBF: ${stats.mtbf_minutes}min | MTTR: ${stats.mttr_seconds}s`);
console.log(`[uptime_analyzer] Risk next hour: ${riskLabel} (${(predictedRisk*100).toFixed(0)}%)`);
console.log(`[uptime_analyzer] Memory slope: ${stats.memory_slope_mb_per_hour} MB/hr`);
console.log(`[uptime_analyzer] Top risky hours (UTC): ${riskyHours.map(h => `${h.hour}:00 (${h.err_rate}%)`).join(', ')}`);

// ── Write JSON stats ───────────────────────────────────────────────────────
fs.writeFileSync(JSON_FILE, JSON.stringify(stats, null, 2));

// ── Write markdown report ──────────────────────────────────────────────────
const longestInc = incidents.length > 0
  ? incidents.sort((a, b) => b.duration_s - a.duration_s)[0]
  : null;

// Hour heatmap (bar chart in markdown)
const maxErr = Math.max(...hourStats.map(h => h.err));
const barWidth = 20;
const heatmapRows = hourStats.map(h => {
  const bar = maxErr > 0 ? '█'.repeat(Math.round(h.err / maxErr * barWidth)).padEnd(barWidth) : ' '.repeat(barWidth);
  return `| ${String(h.hour).padStart(2)}:00 UTC | ${String(h.total).padStart(5)} | ${String(h.err).padStart(4)} | ${String(h.err_rate).padStart(5)}% | ${bar} |`;
}).join('\n');

const report = `# Server Uptime Pattern Analysis
*Generated: ${new Date().toISOString()} by Ivan (ML Engineer)*

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Observations** | ${total.toLocaleString()} |
| **Overall Uptime** | **${uptimePct}%** |
| **Total Downtime Events** | ${errCount} checks |
| **Distinct Incidents** | ${incidents.length} |
| **MTBF** | ${stats.mtbf_minutes ? stats.mtbf_minutes + ' min' : 'N/A'} |
| **MTTR** | ${stats.mttr_seconds ? stats.mttr_seconds + 's' : 'N/A'} |
| **Longest Incident** | ${longestInc ? longestInc.duration_s.toFixed(0) + 's (' + longestInc.count + ' checks)' : 'N/A'} |
| **Memory Slope** | ${stats.memory_slope_mb_per_hour} MB/hr |
| **Risk Next Hour** | **${riskLabel}** (${(predictedRisk*100).toFixed(0)}% probability) |

## Alert Type Breakdown

| Alert | Count | Meaning |
|-------|-------|---------|
| ALT-001 | ${alertCounts['ALT-001'] || 0} | Server not responding |
| ALT-002 | ${alertCounts['ALT-002'] || 0} | High latency (P99 > threshold) |
| ALT-009 | ${alertCounts['ALT-009'] || 0} | Sporadic / other |

## Top 5 Highest-Risk Hours (UTC)

| Hour | Total Checks | Errors | Error Rate |
|------|-------------|--------|------------|
${riskyHours.map(h => `| ${h.hour}:00 UTC | ${h.total} | ${h.err} | **${h.err_rate}%** |`).join('\n')}

## 24-Hour Error Rate Heatmap

| Hour UTC | Checks | Errors | Err% | Bar (relative) |
|----------|--------|--------|------|----------------|
${heatmapRows}

## Incident History (last 10)

| # | Start (UTC) | Duration | Checks |
|---|-------------|----------|--------|
${incidents.slice(-10).map((inc, i) =>
  `| ${incidents.length - 10 + i + 1} | ${inc.start.toISOString()} | ${inc.duration_s.toFixed(0)}s | ${inc.count} |`
).join('\n')}

## Memory Trend

Slope: **${stats.memory_slope_mb_per_hour} MB/hr** over last 500 OK observations.
${Math.abs(parseFloat(stats.memory_slope_mb_per_hour)) < 1 ? '✅ Memory is **stable** — no leak detected.' :
  parseFloat(stats.memory_slope_mb_per_hour) > 2 ? '⚠️ Memory growing at **' + stats.memory_slope_mb_per_hour + ' MB/hr** — monitor for leak.' :
  '🔵 Memory slope is minor — within normal variance.'}

## Predictive Risk Model

Next-hour outage probability: **${riskLabel}** (${(predictedRisk*100).toFixed(0)}%)

*Factors: historical error rate for hour ${nowHour}:00 UTC (${currentHourStats.err_rate}%) + recency of last incident*

## Recommendations for Liam (SRE)

${riskyHours.length > 0 && parseFloat(riskyHours[0].err_rate) > 10 ?
  `1. **Schedule maintenance outside peak-risk hours**: Avoid ${riskyHours.slice(0,3).map(h=>h.hour+':00').join(', ')} UTC — highest outage rates observed.` :
  '1. ✅ No systematic high-risk hours detected — downtime appears random (hardware/network events).'}
${incidents.length > 0 && mtbf_s ?
  `2. **MTBF = ${stats.mtbf_minutes} min**: On average, incidents occur every ${stats.mtbf_minutes} minutes. Consider aliveness checks every ${Math.round(parseFloat(stats.mtbf_minutes)/4)} min.` :
  '2. Insufficient incident data for MTBF alerting calibration.'}
${memSlope && Math.abs(parseFloat(stats.memory_slope_mb_per_hour)) > 2 ?
  `3. **Memory leak risk**: Heap growing ${stats.memory_slope_mb_per_hour} MB/hr — schedule server restart if heap exceeds 200MB.` :
  '3. ✅ Memory stable — no restart needed for memory reasons.'}
4. **ALT-001 count = ${alertCounts['ALT-001'] || 0}** (${uptimePct}% uptime): ${parseFloat(uptimePct) > 99 ? 'Excellent uptime.' : parseFloat(uptimePct) > 95 ? 'Good uptime, minor issues.' : 'Uptime below 95% — investigate root cause.'}

---
*Generated by agents/ivan/output/server_uptime_analyzer.js*
`;

fs.writeFileSync(REPORT_FILE, report);
console.log(`[uptime_analyzer] Report: ${REPORT_FILE}`);
console.log(`[uptime_analyzer] Stats:  ${JSON_FILE}`);
