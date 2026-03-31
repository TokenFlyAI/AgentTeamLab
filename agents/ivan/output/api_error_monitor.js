#!/usr/bin/env node
/**
 * API Error Rate Monitor v1.0 — Ivan (ML Engineer)
 *
 * Watches metrics_queue.jsonl for elevated error rates in a sliding window.
 * Fires alerts when:
 *   - Real error rate (excl. e2e artifacts) > 20% in any 5-minute window
 *   - Auth failure rate > 10% in any 5-minute window
 *
 * Writes alert events to public/reports/active_alerts.md (same format as healthcheck.js).
 * Run once for a spot-check, or with --watch for continuous monitoring (30s interval).
 *
 * Usage:
 *   node api_error_monitor.js              # single scan
 *   node api_error_monitor.js --watch      # continuous (30s poll)
 *   node api_error_monitor.js --window 10  # 10-minute window (default: 5)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────
const ROOT         = path.resolve(__dirname, '../../..');
const METRICS_FILE = path.join(ROOT, 'backend/metrics_queue.jsonl');
const ALERTS_FILE  = path.join(ROOT, 'public/reports/active_alerts.md');

// ── Config ─────────────────────────────────────────────────────────────────
const WINDOW_MINUTES      = parseInt(process.argv.find(a => a.match(/^\d+$/)) || '5', 10);
const WATCH_MODE          = process.argv.includes('--watch');
const WATCH_INTERVAL_MS   = 30_000;

const THRESHOLDS = {
  realErrorRate:  0.20,   // 20% real errors triggers alert
  authFailRate:   0.10,   // 10% auth failures triggers alert
  minRequests:    5,      // ignore windows with fewer requests (avoid noise)
};

// ── E2E artifact detection (mirrors api_error_analyzer.js logic) ───────────
function isE2EArtifact(record) {
  const ep = record.endpoint || '';
  const code = record.status_code;
  // 404s on known test endpoints
  if (code === 404 && (ep.includes('99999') || ep.includes('nobody_agent'))) return true;
  // Consensus test noise
  if (ep.includes('/api/consensus') && code === 400) return true;
  return false;
}

function isError(record) {
  const code = record.status_code;
  return code >= 400;
}

function isAuthFailure(record) {
  return record.status_code === 401;
}

// ── Load and parse metrics ─────────────────────────────────────────────────
function loadRecords() {
  if (!fs.existsSync(METRICS_FILE)) {
    console.error(`[api_error_monitor] ERROR: metrics file not found: ${METRICS_FILE}`);
    return [];
  }
  const raw = fs.readFileSync(METRICS_FILE, 'utf8').trim().split('\n');
  return raw
    .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(r => r && r.recorded_at);
}

// ── Sliding window analysis ────────────────────────────────────────────────
function analyzeWindows(records, windowMs) {
  if (records.length === 0) return [];

  // Sort by time
  const sorted = records
    .map(r => ({ ...r, ts: new Date(r.recorded_at).getTime() }))
    .filter(r => !isNaN(r.ts))
    .sort((a, b) => a.ts - b.ts);

  const alerts = [];
  const windowResults = [];

  // Slide a window from earliest to latest record
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    const windowEnd = sorted[end].ts;
    const windowStart = windowEnd - windowMs;

    // Advance start pointer
    while (sorted[start].ts < windowStart) start++;

    const window = sorted.slice(start, end + 1);
    if (window.length < THRESHOLDS.minRequests) continue;

    const total = window.length;
    const artifacts = window.filter(isE2EArtifact).length;
    const realRequests = total - artifacts;
    if (realRequests < THRESHOLDS.minRequests) continue;

    const realErrors = window.filter(r => !isE2EArtifact(r) && isError(r)).length;
    const authFails  = window.filter(r => !isE2EArtifact(r) && isAuthFailure(r)).length;

    const realErrorRate = realErrors / realRequests;
    const authFailRate  = authFails  / realRequests;

    const windowLabel = new Date(sorted[end].ts).toISOString();

    if (realErrorRate > THRESHOLDS.realErrorRate) {
      alerts.push({
        id:        'ALT-ERR-RATE',
        severity:  realErrorRate > 0.40 ? 'critical' : 'warning',
        at:        windowLabel,
        message:   `Real error rate ${(realErrorRate * 100).toFixed(1)}% in ${windowMs / 60000}-min window (threshold: ${THRESHOLDS.realErrorRate * 100}%)`,
        detail:    `${realErrors}/${realRequests} real requests failed (${artifacts} e2e artifacts excluded)`,
      });
    }

    if (authFailRate > THRESHOLDS.authFailRate) {
      alerts.push({
        id:        'ALT-AUTH-RATE',
        severity:  authFailRate > 0.30 ? 'critical' : 'warning',
        at:        windowLabel,
        message:   `Auth failure rate ${(authFailRate * 100).toFixed(1)}% in ${windowMs / 60000}-min window (threshold: ${THRESHOLDS.authFailRate * 100}%)`,
        detail:    `${authFails} auth failures out of ${realRequests} real requests`,
      });
    }

    windowResults.push({ at: windowLabel, total, realRequests, realErrors, authFails, realErrorRate, authFailRate });
  }

  return { alerts, windowResults };
}

// ── Compute overall summary over last N minutes ────────────────────────────
function overallSummary(records, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = records
    .map(r => ({ ...r, ts: new Date(r.recorded_at).getTime() }))
    .filter(r => !isNaN(r.ts) && r.ts >= cutoff);

  if (recent.length === 0) return null;

  const total        = recent.length;
  const artifacts    = recent.filter(isE2EArtifact).length;
  const realRequests = total - artifacts;
  const realErrors   = recent.filter(r => !isE2EArtifact(r) && isError(r)).length;
  const authFails    = recent.filter(r => !isE2EArtifact(r) && isAuthFailure(r)).length;

  return {
    total,
    artifacts,
    realRequests,
    realErrors,
    authFails,
    realErrorRate: realRequests > 0 ? realErrors / realRequests : 0,
    authFailRate:  realRequests > 0 ? authFails  / realRequests : 0,
  };
}

// ── Write active_alerts.md ─────────────────────────────────────────────────
function writeAlertsFile(firedAlerts, summary, windowMinutes) {
  const now = new Date().toISOString();

  // Deduplicate alerts by id — keep most recent per id
  const byId = {};
  for (const a of firedAlerts) {
    if (!byId[a.id] || a.at > byId[a.id].at) byId[a.id] = a;
  }
  const deduped = Object.values(byId);

  let md = `# Active Alerts\n_Last updated: ${now}_\n\n`;

  if (deduped.length === 0) {
    md += `**No active alerts. All systems nominal.**\n`;
  } else {
    md += `**${deduped.length} alert(s) active.**\n\n`;
    for (const a of deduped) {
      const icon = a.severity === 'critical' ? '🔴' : '🟡';
      md += `## ${icon} ${a.id} — ${a.severity.toUpperCase()}\n`;
      md += `**Fired at:** ${a.at}  \n`;
      md += `**Message:** ${a.message}  \n`;
      md += `**Detail:** ${a.detail}  \n\n`;
    }
  }

  if (summary) {
    md += `---\n## Current ${windowMinutes}-Minute Window Summary\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Total requests | ${summary.total} |\n`;
    md += `| Real requests | ${summary.realRequests} |\n`;
    md += `| E2E artifacts excluded | ${summary.artifacts} |\n`;
    md += `| Real errors | ${summary.realErrors} |\n`;
    md += `| Auth failures | ${summary.authFails} |\n`;
    md += `| Real error rate | ${(summary.realErrorRate * 100).toFixed(1)}% |\n`;
    md += `| Auth failure rate | ${(summary.authFailRate * 100).toFixed(1)}% |\n`;
    const errStatus  = summary.realErrorRate > THRESHOLDS.realErrorRate  ? '🔴 ALERT' : '✅ OK';
    const authStatus = summary.authFailRate  > THRESHOLDS.authFailRate   ? '🔴 ALERT' : '✅ OK';
    md += `| Error rate status | ${errStatus} |\n`;
    md += `| Auth rate status  | ${authStatus} |\n`;
  }

  md += `\n---\n_Generated by agents/ivan/output/api_error_monitor.js (Ivan, ML Engineer)_\n`;

  fs.writeFileSync(ALERTS_FILE, md, 'utf8');
}

// ── Main scan ──────────────────────────────────────────────────────────────
function scan() {
  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const records  = loadRecords();

  if (records.length === 0) {
    console.log('[api_error_monitor] No records to analyze.');
    writeAlertsFile([], null, WINDOW_MINUTES);
    return;
  }

  const { alerts, windowResults } = analyzeWindows(records, windowMs);
  const summary = overallSummary(records, windowMs);

  // Print to console
  console.log(`[api_error_monitor] Analyzed ${records.length} records, ${windowResults.length} windows evaluated`);

  if (alerts.length === 0) {
    console.log(`[api_error_monitor] ✅ No alerts fired. Error rates within thresholds.`);
  } else {
    // Deduplicate for console output too
    const byId = {};
    for (const a of alerts) if (!byId[a.id] || a.at > byId[a.id].at) byId[a.id] = a;
    for (const a of Object.values(byId)) {
      const icon = a.severity === 'critical' ? '🔴' : '🟡';
      console.log(`[api_error_monitor] ${icon} ALERT ${a.id}: ${a.message}`);
      console.log(`                   Detail: ${a.detail}`);
    }
  }

  if (summary) {
    const errPct  = (summary.realErrorRate * 100).toFixed(1);
    const authPct = (summary.authFailRate  * 100).toFixed(1);
    console.log(`[api_error_monitor] Last ${WINDOW_MINUTES}min: real_err=${errPct}% auth_fail=${authPct}% (${summary.realRequests} real reqs, ${summary.artifacts} e2e excluded)`);
  }

  writeAlertsFile(alerts, summary, WINDOW_MINUTES);
  console.log(`[api_error_monitor] Alerts written to ${ALERTS_FILE}`);
}

// ── Entry point ────────────────────────────────────────────────────────────
if (WATCH_MODE) {
  console.log(`[api_error_monitor] Watch mode: scanning every ${WATCH_INTERVAL_MS / 1000}s (window=${WINDOW_MINUTES}min)`);
  scan();
  setInterval(scan, WATCH_INTERVAL_MS);
} else {
  scan();
}
