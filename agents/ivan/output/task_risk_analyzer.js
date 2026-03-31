#!/usr/bin/env node
/**
 * Task Risk Analyzer v1.0 — Ivan, ML Engineer
 *
 * Predicts which open tasks are at risk of stalling or becoming blocked.
 * Risk model: assignee health + task age + status signals + complexity estimate
 *
 * Usage:
 *   node task_risk_analyzer.js [--output-md]
 *   --output-md: Write markdown report to output/task_risk_report.md
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const OUTPUT_DIR = path.join(__dirname, '../output');

// ── Helpers ──────────────────────────────────────────────────────────────────

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d)) return 0;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

// ── Task Board Parser ─────────────────────────────────────────────────────────

function parseTaskBoard() {
  const content = readFile(path.join(ROOT, 'public/task_board.md'));
  if (!content) return [];

  const tasks = [];
  const lines = content.split('\n');
  for (const line of lines) {
    // Skip header lines
    if (!line.startsWith('|') || line.includes('----') || line.includes('| ID |')) continue;
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 7) continue;

    const [id, title, desc, priority, assignee, status, created, updated, notes] = cols;
    if (!id || isNaN(parseInt(id))) continue;
    if (!['open', 'in_progress', 'blocked'].includes(status)) continue;

    tasks.push({
      id: parseInt(id),
      title: title || '',
      description: desc || '',
      priority: priority || 'medium',
      assignee: assignee || '',
      status: status || 'open',
      created: created || '',
      updated: updated || '',
      notes: notes || ''
    });
  }
  return tasks;
}

// ── Agent Health Loader ───────────────────────────────────────────────────────

function loadAgentHealth() {
  // Try v2 scores first, fall back to v1
  const v2Path = path.join(OUTPUT_DIR, 'health_scores_v2.json');
  const v1Path = path.join(OUTPUT_DIR, 'agent_health_scores.json');

  let data = null;
  const raw = readFile(v2Path) || readFile(v1Path);
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }

  if (!data || !data.agents) return {};

  const health = {};
  for (const agent of data.agents) {
    health[agent.name] = agent.total || agent.score || 50;
  }
  return health;
}

function loadComplexityData() {
  const raw = readFile(path.join(OUTPUT_DIR, 'task_complexity.json'));
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const scores = {};
    for (const t of (data.tasks || [])) {
      scores[t.id] = t.complexityScore || 5;
    }
    return scores;
  } catch { return {}; }
}

function loadTrendData() {
  const raw = readFile(path.join(OUTPUT_DIR, 'health_trend_data.json'));
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const trends = {};
    for (const [agent, d] of Object.entries(data)) {
      trends[agent] = d.trend || 'stable';
    }
    return trends;
  } catch { return {}; }
}

// ── Risk Scoring Model ────────────────────────────────────────────────────────

/**
 * Risk factors (higher = riskier):
 *
 * 1. Status risk:       blocked=50, in_progress=10, open=20
 * 2. Age risk:          +5 per day since creation, capped at 40
 * 3. Assignee health:   (100 - health) * 0.3, max 30
 * 4. Declining trend:   +15 if assignee trend is declining
 * 5. No assignee:       +20 if unassigned
 * 6. Priority weight:   critical=0.9x, high=0.8x, medium=1.0x, low=1.2x
 *    (high-priority tasks are more scrutinized; low-priority tasks tend to drift)
 * 7. Complexity:        estimate from description word count, +0..10
 * 8. Blocked keywords:  BLOCKED/waiting/depends in notes → +20
 *
 * Total: 0–100+ → clamped to 0–100, bucketed LOW/MEDIUM/HIGH/CRITICAL
 */

function estimateComplexity(text) {
  if (!text) return 0;
  const words = text.split(/\s+/).length;
  // More words → more complex
  if (words > 50) return 10;
  if (words > 25) return 7;
  if (words > 10) return 4;
  return 2;
}

function computeRisk(task, agentHealth, agentTrends, complexityScores) {
  let score = 0;
  const factors = [];

  // 1. Status risk
  if (task.status === 'blocked') {
    score += 50;
    factors.push({ name: 'status:blocked', value: 50 });
  } else if (task.status === 'open') {
    score += 20;
    factors.push({ name: 'status:open_unstarted', value: 20 });
  } else if (task.status === 'in_progress') {
    score += 10;
    factors.push({ name: 'status:in_progress', value: 10 });
  }

  // 2. Age risk
  const age = daysSince(task.created);
  const ageScore = Math.min(40, Math.round(age * 5));
  if (ageScore > 0) {
    score += ageScore;
    factors.push({ name: `age:${age.toFixed(1)}d`, value: ageScore });
  }

  // 3. Assignee health
  if (!task.assignee) {
    score += 20;
    factors.push({ name: 'no_assignee', value: 20 });
  } else {
    const health = agentHealth[task.assignee] || 50;
    const healthPenalty = Math.round((100 - health) * 0.3);
    if (healthPenalty > 0) {
      score += healthPenalty;
      factors.push({ name: `assignee_health:${health}/100`, value: healthPenalty });
    }

    // 4. Declining trend
    const trend = agentTrends[task.assignee] || 'stable';
    if (trend === 'declining') {
      score += 15;
      factors.push({ name: 'assignee_trend:declining', value: 15 });
    }
  }

  // 5. Blocked keywords in notes
  const allText = (task.notes + ' ' + task.description).toLowerCase();
  if (/\bblocked\b|\bwaiting\b|\bdepends\b/.test(allText)) {
    score += 20;
    factors.push({ name: 'blocked_keywords', value: 20 });
  }

  // 6. Complexity — use NLP predictor scores if available, else naive fallback
  const nlpComplexity = complexityScores ? complexityScores[task.id] : null;
  const complexity = nlpComplexity != null ? nlpComplexity : estimateComplexity(task.description);
  score += complexity;
  if (complexity > 0) {
    const src = nlpComplexity != null ? 'nlp' : 'naive';
    factors.push({ name: `complexity:${complexity}(${src})`, value: complexity });
  }

  // 7. Priority multiplier
  const priorityMults = { critical: 0.9, high: 0.8, medium: 1.0, low: 1.2 };
  const mult = priorityMults[task.priority] || 1.0;
  score = Math.round(score * mult);

  // Clamp
  score = Math.max(0, Math.min(100, score));

  // Bucket
  let tier, symbol;
  if (score >= 75) { tier = 'CRITICAL'; symbol = '🔴'; }
  else if (score >= 55) { tier = 'HIGH'; symbol = '🟠'; }
  else if (score >= 35) { tier = 'MEDIUM'; symbol = '🟡'; }
  else { tier = 'LOW'; symbol = '🟢'; }

  return { score, tier, symbol, factors };
}

// ── Intervention Generator ────────────────────────────────────────────────────

function suggestIntervention(task, risk, agentHealth, agentTrends) {
  const suggestions = [];

  if (task.status === 'blocked') {
    suggestions.push('Escalate to Alice — task has been blocked, needs human intervention or re-routing');
  }

  if (!task.assignee) {
    suggestions.push('Assign to an available agent — no owner means no progress');
  } else {
    const health = agentHealth[task.assignee] || 50;
    const trend = agentTrends[task.assignee] || 'stable';

    if (health < 50) {
      suggestions.push(`Consider reassigning — ${task.assignee} health is ${health}/100 (below threshold)`);
    }
    if (trend === 'declining') {
      suggestions.push(`Monitor ${task.assignee} — agent is showing declining health trend`);
    }
  }

  const age = daysSince(task.created);
  if (age > 3) {
    suggestions.push(`Task is ${age.toFixed(1)} days old — check if still relevant or if scope has changed`);
  }

  if (task.priority === 'high' && risk.tier === 'HIGH') {
    suggestions.push('High-priority + high-risk = immediate attention required');
  }

  if (suggestions.length === 0) {
    suggestions.push('No immediate action required — monitor');
  }

  return suggestions;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const writeMarkdown = process.argv.includes('--output-md');

  console.log('\n=== Task Risk Analyzer v1.0 — Ivan, ML Engineer ===\n');

  const tasks = parseTaskBoard();
  const agentHealth = loadAgentHealth();
  const agentTrends = loadTrendData();

  console.log(`Loaded ${tasks.length} active tasks`);
  console.log(`Loaded health data for ${Object.keys(agentHealth).length} agents`);
  console.log(`Loaded trend data for ${Object.keys(agentTrends).length} agents`);
  console.log('');

  // Score all tasks
  const scoredTasks = tasks.map(task => {
    const risk = computeRisk(task, agentHealth, agentTrends);
    const interventions = suggestIntervention(task, risk, agentHealth, agentTrends);
    return { ...task, risk, interventions };
  });

  // Sort by risk score desc
  scoredTasks.sort((a, b) => b.risk.score - a.risk.score);

  // Summary stats
  const byTier = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const t of scoredTasks) byTier[t.risk.tier]++;

  console.log('── Risk Summary ──────────────────────────────────────');
  console.log(`  CRITICAL (75-100): ${byTier.CRITICAL} tasks`);
  console.log(`  HIGH     (55-74):  ${byTier.HIGH} tasks`);
  console.log(`  MEDIUM   (35-54):  ${byTier.MEDIUM} tasks`);
  console.log(`  LOW      (0-34):   ${byTier.LOW} tasks`);
  console.log('');

  // Print top 15 risky tasks
  const topTasks = scoredTasks.filter(t => t.risk.tier !== 'LOW').slice(0, 20);
  console.log('── Top Risk Tasks ────────────────────────────────────');
  for (const t of topTasks) {
    const assigneeHealth = t.assignee ? (agentHealth[t.assignee] || 'N/A') : 'unassigned';
    const trend = t.assignee ? (agentTrends[t.assignee] ? `trend:${agentTrends[t.assignee]}` : '') : '';
    console.log(`  ${t.risk.symbol} [#${t.id}] ${t.risk.tier} (${t.risk.score}/100)  ${t.title.substring(0, 45)}`);
    console.log(`       assignee:${t.assignee || 'none'}  health:${assigneeHealth}  status:${t.status}  priority:${t.priority}  ${trend}`);
    console.log(`       top factors: ${t.risk.factors.slice(0, 3).map(f => f.name).join(', ')}`);
    console.log('');
  }

  // Output JSON
  const output = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    summary: {
      totalActiveTasks: tasks.length,
      byTier,
      fleetHealthAvg: Math.round(Object.values(agentHealth).reduce((a, b) => a + b, 0) / Math.max(1, Object.values(agentHealth).length))
    },
    tasks: scoredTasks.map(t => ({
      id: t.id,
      title: t.title,
      assignee: t.assignee,
      status: t.status,
      priority: t.priority,
      riskScore: t.risk.score,
      riskTier: t.risk.tier,
      riskFactors: t.risk.factors,
      interventions: t.interventions
    }))
  };

  const jsonPath = path.join(OUTPUT_DIR, 'task_risk_scores.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nJSON saved: ${jsonPath}`);

  if (writeMarkdown) {
    const md = generateMarkdown(output, scoredTasks, agentHealth, agentTrends);
    const mdPath = path.join(OUTPUT_DIR, 'task_risk_report.md');
    fs.writeFileSync(mdPath, md);
    console.log(`Markdown saved: ${mdPath}`);
  }

  return output;
}

function generateMarkdown(output, scoredTasks, agentHealth, agentTrends) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const s = output.summary;

  let md = `# Task Risk Analysis Report\n\n`;
  md += `**Generated:** ${now}  \n`;
  md += `**Author:** Ivan (ML Engineer)  \n`;
  md += `**Model:** Task Risk Analyzer v1.0  \n\n`;

  md += `## Summary\n\n`;
  md += `| Tier | Count | Description |\n`;
  md += `|------|-------|-------------|\n`;
  md += `| 🔴 CRITICAL | ${s.byTier.CRITICAL} | Blocked or severely at-risk — escalate now |\n`;
  md += `| 🟠 HIGH | ${s.byTier.HIGH} | High stall risk — monitor daily |\n`;
  md += `| 🟡 MEDIUM | ${s.byTier.MEDIUM} | Some risk factors present |\n`;
  md += `| 🟢 LOW | ${s.byTier.LOW} | On track |\n\n`;
  md += `**Total active tasks:** ${s.totalActiveTasks}  \n`;
  md += `**Fleet health avg:** ${s.fleetHealthAvg}/100  \n\n`;

  // Group by tier
  for (const tier of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    const tierTasks = scoredTasks.filter(t => t.risk.tier === tier);
    if (tierTasks.length === 0) continue;

    const symbol = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' }[tier];
    md += `## ${symbol} ${tier} Risk Tasks\n\n`;
    md += `| ID | Title | Assignee | Health | Status | Priority | Risk Score | Top Factor |\n`;
    md += `|----|-------|----------|--------|--------|----------|------------|------------|\n`;

    for (const t of tierTasks) {
      const h = t.assignee ? (agentHealth[t.assignee] || '?') : '-';
      const topFactor = t.risk.factors[0]?.name || '-';
      md += `| #${t.id} | ${t.title.substring(0, 35)} | ${t.assignee || '—'} | ${h}/100 | ${t.status} | ${t.priority} | **${t.risk.score}** | ${topFactor} |\n`;
    }
    md += '\n';

    // Detail cards for CRITICAL and HIGH
    if (['CRITICAL', 'HIGH'].includes(tier)) {
      for (const t of tierTasks) {
        md += `### #${t.id}: ${t.title}\n\n`;
        md += `**Assignee:** ${t.assignee || 'unassigned'}  \n`;
        if (t.assignee) {
          md += `**Assignee Health:** ${agentHealth[t.assignee] || '?'}/100  \n`;
          md += `**Assignee Trend:** ${agentTrends[t.assignee] || 'unknown'}  \n`;
        }
        md += `**Status:** ${t.status}  **Priority:** ${t.priority}  **Risk:** ${t.risk.score}/100  \n\n`;
        md += `**Risk Factors:**\n`;
        for (const f of t.risk.factors) {
          md += `- \`${f.name}\` (+${f.value})\n`;
        }
        md += `\n**Recommended Actions:**\n`;
        for (const i of t.interventions) {
          md += `- ${i}\n`;
        }
        md += '\n';
      }
    }
  }

  md += `## Risk Model\n\n`;
  md += `Risk score (0–100) is computed from:\n\n`;
  md += `| Factor | Max Impact | Notes |\n`;
  md += `|--------|-----------|-------|\n`;
  md += `| Status (blocked/open/in_progress) | +50 | Blocked tasks get max penalty |\n`;
  md += `| Task age | +40 | +5 per day since creation |\n`;
  md += `| Assignee health | +30 | (100 - health) × 0.3 |\n`;
  md += `| No assignee | +20 | Unassigned = drifting |\n`;
  md += `| Blocked keywords in notes | +20 | "blocked", "waiting", "depends" |\n`;
  md += `| Declining agent trend | +15 | From health_trend_tracker data |\n`;
  md += `| Task complexity | +10 | Estimated from description length |\n`;
  md += `| Priority multiplier | ×0.8–1.2 | Low-priority tasks drift more |\n`;

  return md;
}

main();
