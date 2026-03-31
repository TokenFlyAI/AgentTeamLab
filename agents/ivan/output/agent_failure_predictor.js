#!/usr/bin/env node
/**
 * Agent Failure Predictor v1.0 — Ivan (ML Engineer)
 *
 * Predicts which agents are likely to go stale/fail in the next cycle.
 * Uses a weighted feature model combining:
 *   - Health trend trajectory (slope + recency)
 *   - Heartbeat staleness
 *   - Inbox backlog growth
 *   - Task assignment load
 *   - Historical score volatility
 *
 * Risk levels:
 *   CRITICAL (≥75): Likely to fail next cycle — proactive intervention needed
 *   HIGH     (≥50): Elevated risk — monitor closely
 *   MEDIUM   (≥25): Some degradation signals
 *   LOW      (<25): Healthy trajectory
 *
 * Output: agent_failure_predictions.json + agent_failure_report.md
 *
 * Usage:
 *   node agent_failure_predictor.js
 *   node agent_failure_predictor.js --no-report   (JSON only, faster)
 *   node agent_failure_predictor.js --agent alice  (single agent)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.resolve(__dirname, '../../');
const TREND_DATA_FILE = path.join(__dirname, 'health_trend_data.json');
const TASK_BOARD = path.resolve(__dirname, '../../../public/task_board.md');
const OUTPUT_JSON = path.join(__dirname, 'agent_failure_predictions.json');
const OUTPUT_MD = path.join(__dirname, 'agent_failure_report.md');

const AGENTS = [
  'alice','bob','charlie','dave','eve','frank','grace','heidi',
  'ivan','judy','karl','liam','mia','nick','olivia','pat','quinn','rosa','sam','tina'
];

const args = process.argv.slice(2);
const NO_REPORT = args.includes('--no-report');
const SINGLE_AGENT = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : null;

// ── Feature Extraction ─────────────────────────────────────────────────────

function readHeartbeat(agent) {
  try {
    const raw = fs.readFileSync(path.join(AGENTS_DIR, agent, 'heartbeat.md'), 'utf8').trim();
    // First line is the timestamp
    const ts = raw.split('\n')[0].trim();
    const age = (Date.now() - new Date(ts).getTime()) / 60000; // minutes
    return { ts, ageMinutes: isNaN(age) ? 9999 : age };
  } catch {
    return { ts: null, ageMinutes: 9999 };
  }
}

function readInboxCount(agent) {
  try {
    const inboxDir = path.join(AGENTS_DIR, agent, 'chat_inbox');
    const files = fs.readdirSync(inboxDir).filter(f => f.endsWith('.md'));
    return files.length;
  } catch {
    return 0;
  }
}

function readStatusAge(agent) {
  try {
    const statusFile = path.join(AGENTS_DIR, agent, 'status.md');
    const stat = fs.statSync(statusFile);
    const ageMin = (Date.now() - stat.mtimeMs) / 60000;
    return ageMin;
  } catch {
    return 9999;
  }
}

function getTaskAssignments(agent) {
  try {
    const board = fs.readFileSync(TASK_BOARD, 'utf8');
    const lines = board.split('\n');
    let openCount = 0;
    let blockedCount = 0;
    for (const line of lines) {
      if (!line.includes(`| ${agent} |`) && !line.toLowerCase().includes(`| ${agent} |`)) continue;
      if (line.includes('| open |') || line.includes('| in_progress |')) openCount++;
      if (line.includes('BLOCKED') || line.includes('blocked')) blockedCount++;
    }
    return { openCount, blockedCount };
  } catch {
    return { openCount: 0, blockedCount: 0 };
  }
}

// ── Trend Analysis ─────────────────────────────────────────────────────────

function getTrendFeatures(agent, trendData) {
  const agentScores = trendData.agents?.[agent] || [];
  if (agentScores.length === 0) return { currentScore: 50, slope: 0, volatility: 0, snapshots: 0 };

  const recent = agentScores.slice(-5); // last 5 snapshots
  const scores = recent.map(s => s.score);
  const currentScore = scores[scores.length - 1];

  // Linear regression slope over recent scores
  const n = scores.length;
  let slope = 0;
  if (n >= 2) {
    const xMean = (n - 1) / 2;
    const yMean = scores.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    scores.forEach((y, x) => {
      num += (x - xMean) * (y - yMean);
      den += (x - xMean) ** 2;
    });
    slope = den > 0 ? num / den : 0;
  }

  // Volatility = std dev of scores
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const volatility = Math.sqrt(variance);

  return { currentScore, slope, volatility, snapshots: agentScores.length };
}

// ── Risk Scoring Model ─────────────────────────────────────────────────────
//
// Risk score (0–100) predicting likelihood of failure/staleness in next cycle.
//
// Feature                      Max contribution
// ─────────────────────────────────────────────
// Heartbeat staleness           30 pts
// Current health score (inv.)   25 pts
// Declining trend slope         20 pts
// Status file age               15 pts
// Inbox backlog                  5 pts
// Blocked task penalty           5 pts
// ─────────────────────────────────────────────
// Total                        100 pts

function scoreAgent(agent, trendData) {
  const heartbeat = readHeartbeat(agent);
  const inboxCount = readInboxCount(agent);
  const statusAge = readStatusAge(agent);
  const tasks = getTaskAssignments(agent);
  const trend = getTrendFeatures(agent, trendData);

  let risk = 0;
  const breakdown = {};

  // 1. Heartbeat staleness (30 pts)
  // >60min = max penalty, 15-60min = proportional, <15min = 0
  const hbPenalty = heartbeat.ageMinutes > 60 ? 30
    : heartbeat.ageMinutes > 15 ? Math.round((heartbeat.ageMinutes - 15) / 45 * 30)
    : 0;
  breakdown.heartbeat = { ageMinutes: Math.round(heartbeat.ageMinutes), penalty: hbPenalty };
  risk += hbPenalty;

  // 2. Current health score — inverted (25 pts)
  // score 0 = 25pts, score 100 = 0pts
  const healthPenalty = Math.round((100 - trend.currentScore) / 100 * 25);
  breakdown.health = { score: trend.currentScore, penalty: healthPenalty };
  risk += healthPenalty;

  // 3. Declining slope (20 pts)
  // slope < -5 pts/snapshot = max, 0 = none, positive = small bonus (cap at -5 pts)
  const slopePenalty = trend.slope < 0
    ? Math.min(20, Math.round(Math.abs(trend.slope) / 5 * 20))
    : Math.max(-5, Math.round(-trend.slope)); // small reward for improvement
  const clampedSlope = Math.max(0, slopePenalty);
  breakdown.trend = { slope: Math.round(trend.slope * 10) / 10, penalty: clampedSlope };
  risk += clampedSlope;

  // 4. Status file age (15 pts)
  // >120min = max, 30-120min = proportional, <30min = 0
  const statusPenalty = statusAge > 120 ? 15
    : statusAge > 30 ? Math.round((statusAge - 30) / 90 * 15)
    : 0;
  breakdown.statusAge = { ageMinutes: Math.round(statusAge), penalty: statusPenalty };
  risk += statusPenalty;

  // 5. Inbox backlog (5 pts)
  // >20 msgs = max, proportional below
  const inboxPenalty = Math.min(5, Math.round(inboxCount / 20 * 5));
  breakdown.inbox = { count: inboxCount, penalty: inboxPenalty };
  risk += inboxPenalty;

  // 6. Blocked tasks (5 pts)
  const blockedPenalty = Math.min(5, tasks.blockedCount * 2);
  breakdown.tasks = { open: tasks.openCount, blocked: tasks.blockedCount, penalty: blockedPenalty };
  risk += blockedPenalty;

  // Clamp
  risk = Math.max(0, Math.min(100, Math.round(risk)));

  const level = risk >= 75 ? 'CRITICAL' : risk >= 50 ? 'HIGH' : risk >= 25 ? 'MEDIUM' : 'LOW';

  // Build human-readable top reason
  const reasons = [];
  if (hbPenalty >= 20) reasons.push(`heartbeat stale ${Math.round(heartbeat.ageMinutes)}min`);
  if (healthPenalty >= 15) reasons.push(`health score ${trend.currentScore}/100`);
  if (clampedSlope >= 10) reasons.push(`declining trend (slope ${Math.round(trend.slope * 10) / 10})`);
  if (statusPenalty >= 10) reasons.push(`status stale ${Math.round(statusAge)}min`);
  if (inboxPenalty >= 3) reasons.push(`inbox backlog ${inboxCount}`);
  if (blockedPenalty >= 3) reasons.push(`${tasks.blockedCount} blocked tasks`);
  if (reasons.length === 0) reasons.push('no significant risk signals');

  return {
    agent,
    riskScore: risk,
    riskLevel: level,
    topReasons: reasons,
    breakdown,
    snapshots: trend.snapshots,
    ts: new Date().toISOString()
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

function run() {
  // Load trend data
  let trendData = { agents: {} };
  try {
    trendData = JSON.parse(fs.readFileSync(TREND_DATA_FILE, 'utf8'));
  } catch {
    console.warn('[WARN] Could not load health_trend_data.json — using defaults');
  }

  const targets = SINGLE_AGENT ? [SINGLE_AGENT] : AGENTS;
  const predictions = targets.map(a => scoreAgent(a, trendData));

  // Sort by risk descending
  predictions.sort((a, b) => b.riskScore - a.riskScore);

  const critical = predictions.filter(p => p.riskLevel === 'CRITICAL');
  const high = predictions.filter(p => p.riskLevel === 'HIGH');
  const medium = predictions.filter(p => p.riskLevel === 'MEDIUM');
  const low = predictions.filter(p => p.riskLevel === 'LOW');

  const result = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: predictions.length,
      critical: critical.length,
      high: high.length,
      medium: medium.length,
      low: low.length,
      avgRisk: Math.round(predictions.reduce((s, p) => s + p.riskScore, 0) / predictions.length)
    },
    predictions
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(result, null, 2));
  console.log(`[INFO] Wrote ${OUTPUT_JSON}`);

  // Console summary
  console.log(`\n── Agent Failure Predictions ──`);
  console.log(`Generated: ${result.generatedAt}`);
  console.log(`Agents: ${predictions.length} | Critical: ${critical.length} | High: ${high.length} | Medium: ${medium.length} | Low: ${low.length}`);
  console.log(`Avg risk score: ${result.summary.avgRisk}/100\n`);

  for (const p of predictions.slice(0, 10)) {
    const bar = '█'.repeat(Math.round(p.riskScore / 10)).padEnd(10, '░');
    console.log(`  ${p.agent.padEnd(10)} [${bar}] ${p.riskScore.toString().padStart(3)}/100  ${p.riskLevel.padEnd(8)}  ${p.topReasons[0] || ''}`);
  }

  if (critical.length > 0) {
    console.log(`\n[WARN] CRITICAL agents: ${critical.map(p => p.agent).join(', ')}`);
  }

  if (!NO_REPORT) {
    writeReport(result);
    console.log(`[INFO] Wrote ${OUTPUT_MD}`);
  }

  return result;
}

function writeReport(result) {
  const { predictions, summary } = result;
  const now = result.generatedAt;

  const riskIcon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' };
  // ASCII fallback since we avoid emojis unless asked — use text
  const riskLabel = { CRITICAL: '[CRIT]', HIGH: '[HIGH]', MEDIUM: '[MED] ', LOW: '[LOW] ' };

  let md = `# Agent Failure Predictions — ${now.slice(0, 10)}\n`;
  md += `**Generated:** ${now}  \n`;
  md += `**Model:** Ivan Agent Failure Predictor v1.0\n\n`;
  md += `---\n\n`;

  md += `## Executive Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Agents analyzed | ${summary.total} |\n`;
  md += `| Critical risk | ${summary.critical} |\n`;
  md += `| High risk | ${summary.high} |\n`;
  md += `| Medium risk | ${summary.medium} |\n`;
  md += `| Low risk (healthy) | ${summary.low} |\n`;
  md += `| Average risk score | ${summary.avgRisk}/100 |\n\n`;

  if (summary.critical > 0 || summary.high > 0) {
    md += `## Action Required\n\n`;
    const atRisk = predictions.filter(p => p.riskLevel === 'CRITICAL' || p.riskLevel === 'HIGH');
    for (const p of atRisk) {
      md += `### ${p.agent} — Risk ${p.riskScore}/100 ${p.riskLevel}\n`;
      md += `**Top reasons:** ${p.topReasons.join('; ')}\n\n`;
      md += `**Feature breakdown:**\n`;
      md += `- Heartbeat: ${p.breakdown.heartbeat.ageMinutes}min stale → ${p.breakdown.heartbeat.penalty}pts\n`;
      md += `- Health score: ${p.breakdown.health.score}/100 → ${p.breakdown.health.penalty}pts\n`;
      md += `- Trend slope: ${p.breakdown.trend.slope} pts/snapshot → ${p.breakdown.trend.penalty}pts\n`;
      md += `- Status age: ${p.breakdown.statusAge.ageMinutes}min → ${p.breakdown.statusAge.penalty}pts\n`;
      md += `- Inbox backlog: ${p.breakdown.inbox.count} → ${p.breakdown.inbox.penalty}pts\n`;
      md += `- Blocked tasks: ${p.breakdown.tasks.blocked} → ${p.breakdown.tasks.penalty}pts\n\n`;
      md += `**Recommendation:** `;
      if (p.riskLevel === 'CRITICAL') {
        md += `Restart agent immediately. Check logs at /tmp/aicompany_runtime_logs/${p.agent}.log\n\n`;
      } else {
        md += `Monitor closely. Consider sending status-check message or restarting if no improvement next cycle.\n\n`;
      }
    }
  }

  md += `## Full Rankings\n\n`;
  md += `| Rank | Agent | Risk Score | Level | Top Reason |\n`;
  md += `|------|-------|-----------|-------|------------|\n`;
  predictions.forEach((p, i) => {
    md += `| ${i + 1} | ${p.agent} | ${p.riskScore}/100 | ${p.riskLevel} | ${p.topReasons[0] || '—'} |\n`;
  });

  md += `\n---\n\n`;
  md += `## Feature Weight Reference\n\n`;
  md += `| Feature | Max Weight | Description |\n|---------|-----------|-------------|\n`;
  md += `| Heartbeat staleness | 30pts | >60min stale = max risk |\n`;
  md += `| Health score (inverted) | 25pts | Low health score → high risk |\n`;
  md += `| Trend slope | 20pts | Steep decline in recent snapshots |\n`;
  md += `| Status file age | 15pts | No status update = possibly dead |\n`;
  md += `| Inbox backlog | 5pts | >20 unread messages = overwhelmed |\n`;
  md += `| Blocked tasks | 5pts | BLOCKED tasks suggest stuck agent |\n`;

  fs.writeFileSync(OUTPUT_MD, md);
}

run();
