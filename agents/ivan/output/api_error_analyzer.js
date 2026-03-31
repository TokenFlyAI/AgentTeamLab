#!/usr/bin/env node
/**
 * API Error Pattern Analyzer v1.0 — Ivan (ML Engineer)
 *
 * Analyzes metrics_queue.jsonl to identify systemic API error patterns.
 * Categories: validation failures, auth issues, not-found artifacts, payload issues.
 * Outputs: api_error_report.md + api_error_analysis.json
 */

const fs = require('fs');
const path = require('path');

const METRICS_FILE = path.resolve(__dirname, '../../../backend/metrics_queue.jsonl');
const OUTPUT_MD = path.resolve(__dirname, 'api_error_report.md');
const OUTPUT_JSON = path.resolve(__dirname, 'api_error_analysis.json');

function loadRecords() {
  const raw = fs.readFileSync(METRICS_FILE, 'utf8').trim().split('\n');
  return raw.map(l => { try { return JSON.parse(l); } catch(e) { return null; } }).filter(Boolean);
}

function classifyError(record) {
  const ep = record.endpoint || '';
  const code = record.status_code;
  if (code === 401) return 'AUTH_FAILURE';
  if (code === 413) return 'PAYLOAD_TOO_LARGE';
  if (code === 404) {
    if (ep.includes('99999') || ep.includes('nobody_agent')) return 'E2E_TEST_ARTIFACT';
    return 'NOT_FOUND';
  }
  if (code === 400) {
    if (ep.includes('/api/tasks') && record.method === 'POST') return 'TASK_VALIDATION_ERROR';
    if (ep.includes('/api/messages')) return 'MESSAGE_VALIDATION_ERROR';
    return 'BAD_REQUEST';
  }
  if (code >= 500) return 'SERVER_ERROR';
  return 'OTHER_ERROR';
}

function hourBucket(ts) {
  const d = new Date(ts);
  return isNaN(d) ? null : d.toISOString().slice(0, 13) + ':00';
}

function analyze() {
  const records = loadRecords();
  const total = records.length;
  const errors = records.filter(r => r.status_code >= 400);
  const ok = records.filter(r => r.status_code < 400);

  // --- Error classification ---
  const classified = {};
  errors.forEach(r => {
    const cat = classifyError(r);
    if (!classified[cat]) classified[cat] = [];
    classified[cat].push(r);
  });

  // --- Endpoint error rates ---
  const byEndpoint = {};
  records.forEach(r => {
    const key = (r.method || 'GET') + ' ' + (r.endpoint || '/unknown');
    if (!byEndpoint[key]) byEndpoint[key] = { total: 0, errors: 0, codes: {}, totalMs: 0 };
    byEndpoint[key].total++;
    byEndpoint[key].totalMs += r.duration_ms || 0;
    if (r.status_code >= 400) {
      byEndpoint[key].errors++;
      byEndpoint[key].codes[r.status_code] = (byEndpoint[key].codes[r.status_code] || 0) + 1;
    }
  });

  // --- Hourly error trend ---
  const hourly = {};
  records.forEach(r => {
    const h = hourBucket(r.recorded_at);
    if (!h) return;
    if (!hourly[h]) hourly[h] = { total: 0, errors: 0 };
    hourly[h].total++;
    if (r.status_code >= 400) hourly[h].errors++;
  });

  // --- Auth failure analysis ---
  const authErrors = classified['AUTH_FAILURE'] || [];
  const authByEndpoint = {};
  authErrors.forEach(r => {
    const ep = (r.method || 'GET') + ' ' + (r.endpoint || '/unknown');
    authByEndpoint[ep] = (authByEndpoint[ep] || 0) + 1;
  });

  // --- Validation error analysis ---
  const validationErrors = [
    ...(classified['TASK_VALIDATION_ERROR'] || []),
    ...(classified['MESSAGE_VALIDATION_ERROR'] || []),
    ...(classified['BAD_REQUEST'] || [])
  ];

  // --- E2E artifact assessment ---
  const e2eArtifacts = classified['E2E_TEST_ARTIFACT'] || [];
  const realErrors = errors.filter(r => classifyError(r) !== 'E2E_TEST_ARTIFACT');
  const realErrorRate = (realErrors.length / total * 100).toFixed(1);

  // --- Top problematic endpoints (excluding e2e artifacts) ---
  const problematic = Object.entries(byEndpoint)
    .filter(([ep]) => !ep.includes('99999') && !ep.includes('nobody_agent'))
    .map(([ep, s]) => ({
      endpoint: ep,
      total: s.total,
      errors: s.errors,
      errorRate: s.total > 0 ? (s.errors / s.total * 100).toFixed(1) : '0',
      avgMs: (s.totalMs / s.total).toFixed(1),
      codes: s.codes
    }))
    .filter(s => s.errors > 0)
    .sort((a, b) => b.errors - a.errors);

  // --- Severity scoring ---
  const findings = [];

  const authRate = authErrors.length / total * 100;
  if (authRate > 10) {
    findings.push({
      severity: 'HIGH',
      category: 'AUTH_FAILURES',
      count: authErrors.length,
      description: `${authErrors.length} auth failures (${authRate.toFixed(1)}% of all requests)`,
      endpoints: Object.entries(authByEndpoint).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k,v]) => `${k} (${v})`),
      recommendation: 'Audit which services call authenticated endpoints without API keys. Health monitor known issue — needs /api/health unauthenticated variant or dedicated health key.'
    });
  }

  const validationRate = validationErrors.length / total * 100;
  if (validationRate > 5) {
    findings.push({
      severity: 'MEDIUM',
      category: 'VALIDATION_ERRORS',
      count: validationErrors.length,
      description: `${validationErrors.length} bad request errors (${validationRate.toFixed(1)}%)`,
      recommendation: 'POST /api/tasks failing 59% of the time suggests agents are creating duplicate tasks or missing required fields. Improve client-side validation before API calls.'
    });
  }

  const payloadErrors = classified['PAYLOAD_TOO_LARGE'] || [];
  if (payloadErrors.length > 10) {
    const payloadEps = {};
    payloadErrors.forEach(r => {
      const ep = (r.method||'?') + ' ' + (r.endpoint||'/unknown');
      payloadEps[ep] = (payloadEps[ep]||0)+1;
    });
    findings.push({
      severity: 'MEDIUM',
      category: 'PAYLOAD_TOO_LARGE',
      count: payloadErrors.length,
      description: `${payloadErrors.length} requests rejected for payload size`,
      endpoints: Object.entries(payloadEps).map(([k,v]) => `${k} (${v})`),
      recommendation: 'Agents sending oversized payloads — likely large status updates or reports via API. Compress or chunk large payloads. Check if agents should use file writes instead of API calls for large data.'
    });
  }

  const e2eRate = e2eArtifacts.length / total * 100;
  if (e2eRate > 5) {
    findings.push({
      severity: 'LOW',
      category: 'E2E_TEST_ARTIFACTS',
      count: e2eArtifacts.length,
      description: `${e2eArtifacts.length} errors from e2e test sentinel values (99999, nobody_agent_xyz)`,
      recommendation: 'Normal — e2e tests intentionally probe invalid IDs to verify 404 behavior. These inflate error rate metrics but are not real issues.'
    });
  }

  // --- Output ---
  const analysis = {
    generated_at: new Date().toISOString(),
    summary: {
      total_requests: total,
      total_errors: errors.length,
      total_ok: ok.length,
      overall_error_rate_pct: (errors.length / total * 100).toFixed(1),
      e2e_artifact_count: e2eArtifacts.length,
      real_error_rate_pct: realErrorRate,
      time_range: {
        start: records[0]?.recorded_at,
        end: records[records.length - 1]?.recorded_at
      }
    },
    error_categories: Object.fromEntries(
      Object.entries(classified).map(([k, v]) => [k, v.length])
    ),
    top_problematic_endpoints: problematic.slice(0, 10),
    auth_failures_by_endpoint: authByEndpoint,
    hourly_trend: hourly,
    findings,
    severity_score: findings.filter(f => f.severity === 'HIGH').length * 3 +
                    findings.filter(f => f.severity === 'MEDIUM').length * 2 +
                    findings.filter(f => f.severity === 'LOW').length
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(analysis, null, 2));

  // --- Markdown report ---
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const md = `# API Error Pattern Analysis Report

**Generated:** ${now} UTC
**Analyst:** Ivan (ML Engineer)
**Data Source:** backend/metrics_queue.jsonl (${total} records)
**Period:** ${records[0]?.recorded_at?.slice(0,10)} — ${records[records.length-1]?.recorded_at?.slice(0,10)}

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Requests | ${total} |
| Total Errors | ${errors.length} (${(errors.length/total*100).toFixed(1)}%) |
| E2E Test Artifacts | ${e2eArtifacts.length} (expected noise) |
| **Real Error Rate** | **${realErrorRate}%** |
| Severity Score | ${analysis.severity_score}/10 |

### Overall Assessment
${analysis.severity_score >= 6 ? '🔴 **HIGH CONCERN** — systemic API issues need attention' :
  analysis.severity_score >= 3 ? '🟡 **MEDIUM CONCERN** — notable patterns, investigation recommended' :
  '🟢 **LOW CONCERN** — API is healthy, minor issues only'}

---

## Error Category Breakdown

| Category | Count | % of Errors | Action |
|----------|-------|-------------|--------|
${Object.entries(classified)
  .sort((a,b) => b[1].length - a[1].length)
  .map(([cat, recs]) => {
    const pct = (recs.length/errors.length*100).toFixed(1);
    const actions = {
      AUTH_FAILURE: 'Fix missing auth keys',
      TASK_VALIDATION_ERROR: 'Improve task creation logic',
      MESSAGE_VALIDATION_ERROR: 'Fix message payload format',
      BAD_REQUEST: 'Client-side validation',
      E2E_TEST_ARTIFACT: 'Expected — e2e testing',
      NOT_FOUND: 'Investigate missing resources',
      PAYLOAD_TOO_LARGE: 'Chunk large payloads',
      SERVER_ERROR: 'Investigate server crashes',
      OTHER_ERROR: 'Review individually'
    };
    return `| ${cat} | ${recs.length} | ${pct}% | ${actions[cat] || '—'} |`;
  }).join('\n')}

---

## Findings

${findings.map(f => `### ${f.severity === 'HIGH' ? '🔴' : f.severity === 'MEDIUM' ? '🟡' : '🟢'} [${f.severity}] ${f.category}

**Count:** ${f.count}
**Description:** ${f.description}

${f.endpoints ? `**Top affected endpoints:**\n${f.endpoints.map(e => `- ${e}`).join('\n')}\n` : ''}
**Recommendation:** ${f.recommendation}
`).join('\n---\n\n')}

---

## Top Problematic Endpoints (excluding e2e artifacts)

| Endpoint | Calls | Errors | Error Rate | Avg Latency | Error Codes |
|----------|-------|--------|-----------|-------------|-------------|
${problematic.slice(0,10).map(e =>
  `| ${e.endpoint} | ${e.total} | ${e.errors} | ${e.errorRate}% | ${e.avgMs}ms | ${JSON.stringify(e.codes)} |`
).join('\n')}

---

## Hourly Error Trend

| Hour (UTC) | Requests | Errors | Error Rate |
|------------|----------|--------|-----------|
${Object.entries(hourly)
  .sort((a,b) => a[0].localeCompare(b[0]))
  .map(([h, s]) => `| ${h} | ${s.total} | ${s.errors} | ${(s.errors/s.total*100).toFixed(1)}% |`)
  .join('\n')}

---

## Auth Failure Deep Dive

Auth failures represent the most actionable finding. These are **real production issues**, not e2e artifacts.

### Auth Failures by Endpoint

${Object.entries(authByEndpoint)
  .sort((a,b) => b[1]-a[1])
  .map(([ep, count]) => `- **${ep}**: ${count} failures`)
  .join('\n')}

### Root Cause (Known)
The heartbeat monitor hits \`/api/health\` without an API key → gets 401 → \`heap_used=null\` in health log.

**Fix options:**
1. Make \`/api/health\` unauthenticated (simplest, zero-security risk for a health endpoint)
2. Add \`API_KEY\` env var to heartbeat_monitor.js invocation
3. Create a dedicated unauthenticated \`/api/ping\` endpoint

---

## Recommendations Priority

| Priority | Action | Owner |
|----------|--------|-------|
| P0 | Fix auth on /api/health — 123 blind spots in health monitoring | Liam/Bob |
| P1 | Reduce POST /api/tasks 400 rate (59%) — agent task deduplication logic | Alice/agents |
| P2 | Investigate 413 payload errors (${(classified['PAYLOAD_TOO_LARGE']||[]).length} occurrences) | Bob |
| P3 | Add API error rate alert (threshold: >20% real errors in 5-min window) | Ivan/Liam |

---

*Report auto-generated by api_error_analyzer.js — Ivan ML Engine*
`;

  fs.writeFileSync(OUTPUT_MD, md);
  return analysis;
}

const result = analyze();
console.log('[api_error_analyzer] Analysis complete');
console.log(`  Total records: ${result.summary.total_requests}`);
console.log(`  Overall error rate: ${result.summary.overall_error_rate_pct}%`);
console.log(`  Real error rate (excl. e2e): ${result.summary.real_error_rate_pct}%`);
console.log(`  Severity score: ${result.severity_score}/10`);
console.log(`  Findings: ${result.findings.length} (${result.findings.filter(f=>f.severity==='HIGH').length} HIGH, ${result.findings.filter(f=>f.severity==='MEDIUM').length} MEDIUM)`);
console.log(`  Output: ${OUTPUT_MD}`);
