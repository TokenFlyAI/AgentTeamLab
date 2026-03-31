#!/usr/bin/env node
/**
 * Health Score Trend Tracker — Ivan (ML Engineer)
 * Scores all agents each run, stores timeseries, detects declining trends.
 *
 * Usage:
 *   node agents/ivan/output/health_trend_tracker.js [--output <path>] [--no-report]
 *
 * Outputs:
 *   agents/ivan/output/health_trend_data.json  — timeseries (all snapshots)
 *   agents/ivan/output/health_trend_report.md  — latest analysis report
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3199';
const TREND_DATA_FILE = path.join(__dirname, 'health_trend_data.json');
const REPORT_FILE = path.join(__dirname, 'health_trend_report.md');
const MIN_TREND_POINTS = 3; // Need ≥3 snapshots to detect trend

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Score one agent 0–100 using 4 dimensions + inbox penalty.
 *
 * Component           Max   Notes
 * ──────────────────  ───   ─────────────────────────────────────────────
 * heartbeat           30    <5m=30, <15m=20, <60m=10, else 0
 * log_activity        30    log_age_ms (proxy for recent tool use)
 * status_signal       20    running=20, else 0
 * task_engagement     20    has active Task #N in current_task
 * inbox_penalty      -10    >60 unread messages = -10
 */
function scoreAgent(agent) {
  const { status, heartbeat_age_ms, log_age_ms, current_task, inbox_unread } = agent;

  // 1. Heartbeat (30 pts)
  let heartbeat = 0;
  if (heartbeat_age_ms < 5 * 60 * 1000) heartbeat = 30;
  else if (heartbeat_age_ms < 15 * 60 * 1000) heartbeat = 20;
  else if (heartbeat_age_ms < 60 * 60 * 1000) heartbeat = 10;

  // 2. Log activity (30 pts) — proxy for tool/bash use this cycle
  let log_activity = 0;
  if (log_age_ms < 2 * 60 * 1000) log_activity = 30;
  else if (log_age_ms < 5 * 60 * 1000) log_activity = 20;
  else if (log_age_ms < 15 * 60 * 1000) log_activity = 10;

  // 3. Status (20 pts)
  const status_score = status === 'running' ? 20 : 0;

  // 4. Task engagement (20 pts)
  const task_str = current_task || '';
  let task_score = 0;
  if (/Task #\d+/.test(task_str) && !/COMPLETE|DONE|complete|done|idle|IDLE/.test(task_str)) {
    task_score = 20;
  } else if (task_str.length > 20) {
    task_score = 10; // Has status text but no active task ref
  }

  // 5. Inbox penalty
  const penalty = (inbox_unread || 0) > 60 ? 10 : 0;

  const score = heartbeat + log_activity + status_score + task_score - penalty;
  return {
    score: Math.max(0, Math.min(100, score)),
    components: { heartbeat, log_activity, status: status_score, task: task_score, penalty }
  };
}

function grade(score) {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function fetchJSON(url) {
  const apiKey = process.env.API_KEY || 'test';
  const parsedUrl = new URL(url);
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 80,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` }
  };
  return new Promise((resolve, reject) => {
    http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject).end();
  });
}

// ── Trend Analysis ─────────────────────────────────────────────────────────

/**
 * Given an array of recent scores (oldest→newest), detect trend.
 * Returns: 'declining' | 'recovering' | 'stable' | 'volatile'
 */
function classifyTrend(scores) {
  if (scores.length < 2) return 'stable';
  const n = scores.length;
  const recent = scores.slice(-3); // Use last 3 points for trend
  const diffs = recent.slice(1).map((v, i) => v - recent[i]);
  const allDown = diffs.every(d => d < -5);
  const allUp = diffs.every(d => d > 5);
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.map(d => Math.pow(d - avgDiff, 2)).reduce((a, b) => a + b, 0) / diffs.length;

  if (allDown) return 'declining';
  if (allUp) return 'recovering';
  if (variance > 200) return 'volatile';
  return 'stable';
}

/**
 * Compute linear regression slope for scores array.
 * Positive = improving, negative = declining.
 */
function slope(scores) {
  const n = scores.length;
  if (n < 2) return 0;
  const xs = scores.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = scores.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((acc, x, i) => acc + (x - xMean) * (scores[i] - yMean), 0);
  const den = xs.reduce((acc, x) => acc + Math.pow(x - xMean, 2), 0);
  return den === 0 ? 0 : num / den;
}

// ── Report Generation ──────────────────────────────────────────────────────

function generateReport(snapshot, trendData) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const agents = snapshot.agents;
  const fleetAvg = Math.round(agents.reduce((a, b) => a + b.score, 0) / agents.length);

  // Grade distribution
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  agents.forEach(a => grades[a.grade]++);

  // Find at-risk agents (declining trend AND score < 60)
  const atRisk = agents.filter(a => {
    const history = (trendData.agents[a.name] || []).map(s => s.score);
    if (history.length < MIN_TREND_POINTS) return false;
    return classifyTrend(history) === 'declining' && a.score < 60;
  });

  // Find improving agents
  const improving = agents.filter(a => {
    const history = (trendData.agents[a.name] || []).map(s => s.score);
    if (history.length < MIN_TREND_POINTS) return false;
    return classifyTrend(history) === 'recovering';
  });

  // Top/bottom performers
  const sorted = [...agents].sort((a, b) => b.score - a.score);
  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();

  let md = `# Agent Health Score — Trend Report\n`;
  md += `**Generated**: ${ts} UTC  \n`;
  md += `**Snapshot #**: ${trendData.snapshots.length}  \n`;
  md += `**Fleet Average**: ${fleetAvg}/100  \n\n`;

  md += `## Grade Distribution\n`;
  md += `| Grade | Count | Score Range |\n`;
  md += `|-------|-------|-------------|\n`;
  md += `| A | ${grades.A} | 80–100 |\n`;
  md += `| B | ${grades.B} | 60–79  |\n`;
  md += `| C | ${grades.C} | 40–59  |\n`;
  md += `| D | ${grades.D} | 20–39  |\n`;
  md += `| F | ${grades.F} | 0–19   |\n\n`;

  if (atRisk.length > 0) {
    md += `## ⚠️ At-Risk Agents (Declining Trend + Score < 60)\n`;
    atRisk.forEach(a => {
      const history = (trendData.agents[a.name] || []).map(s => s.score);
      const sl = slope(history).toFixed(1);
      md += `- **${a.name}** — Score: ${a.score}/100 (${a.grade}) | Trend slope: ${sl} pts/cycle\n`;
    });
    md += '\n';
  } else {
    md += `## ✅ No At-Risk Agents\n`;
    if (trendData.snapshots.length < MIN_TREND_POINTS) {
      md += `_(Need ${MIN_TREND_POINTS} snapshots to compute trend — currently ${trendData.snapshots.length})_\n`;
    }
    md += '\n';
  }

  if (improving.length > 0) {
    md += `## 📈 Recovering Agents\n`;
    improving.forEach(a => {
      md += `- **${a.name}** — Score: ${a.score}/100 (${a.grade})\n`;
    });
    md += '\n';
  }

  md += `## Current Scores — All Agents\n`;
  md += `| Agent | Score | Grade | Heartbeat | Log Activity | Status | Task | Penalty | Trend |\n`;
  md += `|-------|-------|-------|-----------|--------------|--------|------|---------|-------|\n`;

  sorted.forEach(a => {
    const history = (trendData.agents[a.name] || []).map(s => s.score);
    const trend = history.length >= 2 ? classifyTrend(history) : '—';
    const trendIcon = { declining: '↓', recovering: '↑', stable: '→', volatile: '~', '—': '—' }[trend];
    const c = a.components;
    md += `| ${a.name} | ${a.score} | ${a.grade} | ${c.heartbeat} | ${c.log_activity} | ${c.status} | ${c.task} | -${c.penalty} | ${trendIcon} |\n`;
  });

  md += `\n## Score History (last 5 snapshots per agent)\n`;
  md += `| Agent | History (oldest→newest) | Slope |\n`;
  md += `|-------|------------------------|-------|\n`;
  sorted.forEach(a => {
    const history = (trendData.agents[a.name] || []).map(s => s.score);
    const recent = history.slice(-5);
    const sl = history.length >= 2 ? slope(history).toFixed(1) : '—';
    md += `| ${a.name} | ${recent.join(' → ')} | ${sl} |\n`;
  });

  md += `\n---\n`;
  md += `_Ivan — ML Engineer | Health Score Trend Tracker v1.1_\n`;

  return md;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const noReport = args.includes('--no-report');

  console.log('[health_trend_tracker] Fetching agent data...');

  let agents;
  try {
    agents = await fetchJSON(`${BASE_URL}/api/metrics/agents`);
  } catch (e) {
    console.error(`[health_trend_tracker] ERROR: Cannot reach dashboard — ${e.message}`);
    console.error('  Start the dashboard: node server.js --dir . --port 3199');
    process.exit(1);
  }

  // Score all agents
  const timestamp = new Date().toISOString();
  const scored = agents.map(agent => {
    const { score, components } = scoreAgent(agent);
    return {
      name: agent.name,
      score,
      grade: grade(score),
      components,
      status: agent.status,
    };
  });

  const snapshot = { timestamp, agents: scored };

  // Load or initialize trend data
  let trendData = { snapshots: [], agents: {} };
  if (fs.existsSync(TREND_DATA_FILE)) {
    try {
      trendData = JSON.parse(fs.readFileSync(TREND_DATA_FILE, 'utf8'));
    } catch (e) {
      console.warn('[health_trend_tracker] Warning: Could not parse existing trend data, starting fresh');
    }
  }

  // Append this snapshot
  trendData.snapshots.push(timestamp);

  // Keep only last 20 snapshots per agent to bound file size
  scored.forEach(a => {
    if (!trendData.agents[a.name]) trendData.agents[a.name] = [];
    trendData.agents[a.name].push({ ts: timestamp, score: a.score });
    if (trendData.agents[a.name].length > 20) {
      trendData.agents[a.name] = trendData.agents[a.name].slice(-20);
    }
  });

  // Save trend data
  fs.writeFileSync(TREND_DATA_FILE, JSON.stringify(trendData, null, 2));
  console.log(`[health_trend_tracker] Trend data saved (${trendData.snapshots.length} snapshots)`);

  // Generate report (skip if --no-report flag passed)
  if (!noReport) {
    const report = generateReport(snapshot, trendData);
    fs.writeFileSync(REPORT_FILE, report);
    console.log(`[health_trend_tracker] Report saved: ${REPORT_FILE}`);
  }

  // Print summary
  const fleetAvg = Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length);
  console.log(`\n  Fleet Average: ${fleetAvg}/100`);
  console.log(`  Snapshot #${trendData.snapshots.length}`);

  const atRisk = scored.filter(a => {
    const h = (trendData.agents[a.name] || []).map(s => s.score);
    return h.length >= MIN_TREND_POINTS && classifyTrend(h) === 'declining' && a.score < 60;
  });
  if (atRisk.length > 0) {
    console.log(`\n  ⚠️  At-risk: ${atRisk.map(a => a.name).join(', ')}`);
  }

  scored.sort((a, b) => b.score - a.score).forEach(a => {
    const h = (trendData.agents[a.name] || []).map(s => s.score);
    const trend = h.length >= 2 ? classifyTrend(h) : '—';
    const icon = { declining: '↓', recovering: '↑', stable: '→', volatile: '~', '—': '—' }[trend];
    console.log(`  ${a.name.padEnd(12)} ${String(a.score).padStart(3)}/100  ${a.grade}  ${icon}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
