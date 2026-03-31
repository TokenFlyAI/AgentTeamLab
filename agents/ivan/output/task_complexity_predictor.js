#!/usr/bin/env node
/**
 * Task Complexity Predictor v1.0 — Ivan, ML Engineer
 *
 * Estimates task complexity using NLP feature extraction.
 * Features: token count, tech domain density, multi-agent mentions,
 * multi-system span, dependency refs, action verb richness, ambiguity signals.
 *
 * Usage: node task_complexity_predictor.js [--output-md]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const OUTPUT_DIR = __dirname;

const TECH_TERMS = {
  database:    ['migration', 'schema', 'sqlite', 'postgresql', 'sql', 'index', 'constraint', 'transaction', 'wal'],
  auth:        ['auth', 'authentication', 'authorization', 'bearer', 'api key', 'session', 'token'],
  security:    ['sec-', 'security', 'vulnerability', 'sanitize', 'xss', 'injection', 'cors', 'encryption'],
  infra:       ['docker', 'kubernetes', 'deployment', 'pipeline', 'infrastructure', 'nginx', 'queue'],
  realtime:    ['websocket', 'sse', 'server-sent', 'streaming', 'real-time', 'polling', 'broadcast', 'pubsub'],
  testing:     ['e2e', 'playwright', 'integration test', 'unit test', 'regression', 'coverage', 'flakiness'],
  performance: ['latency', 'throughput', 'benchmark', 'profiling', 'optimization', 'caching', 'bottleneck'],
  api:         ['endpoint', 'rest', 'openapi', 'rate limit', 'pagination', 'webhook', 'idempotent'],
};

const ACTION_VERBS = [
  'implement', 'add', 'build', 'create', 'fix', 'update', 'refactor', 'migrate',
  'test', 'deploy', 'configure', 'integrate', 'document', 'analyze', 'debug',
  'remove', 'replace', 'upgrade', 'write', 'verify', 'validate', 'coordinate',
  'design', 'review', 'optimize', 'monitor', 'audit', 'run', 'execute',
];

const AMBIGUITY_SIGNALS = ['etc', 'and more', 'as needed', 'tbd', 'various', 'some '];

const AGENT_NAMES = [
  'alice','bob','charlie','dave','eve','frank','grace','heidi',
  'ivan','judy','karl','liam','mia','nick','olivia','pat',
  'quinn','rosa','sam','tina',
];

const SYSTEMS = [
  'server.js','api.js','backend','frontend','dashboard','database',
  'message bus','message_bus','playwright','e2e','heartbeat',
  'task board','agent_metrics','metrics_db','migration',
];

function extractFeatures(task) {
  const allText = [task.title, task.description, task.notes].filter(Boolean).join(' ');
  const lower = allText.toLowerCase();
  const tokens = lower.split(/\s+/).filter(t => t.length > 1);

  const matchedDomains = new Set();
  for (const [domain, terms] of Object.entries(TECH_TERMS)) {
    for (const term of terms) {
      if (lower.includes(term)) { matchedDomains.add(domain); break; }
    }
  }

  const mentionedAgents = AGENT_NAMES.filter(a => lower.includes(a));
  const mentionedSystems = SYSTEMS.filter(s => lower.includes(s.toLowerCase()));
  const depMatches = lower.match(/#\d+/g) || [];
  const hasDependsOn = /depends on|blocked by|after #|requires #/i.test(allText);
  const matchedVerbs = new Set(ACTION_VERBS.filter(v => lower.includes(v)));
  const ambiguityCount = AMBIGUITY_SIGNALS.filter(s => lower.includes(s)).length;
  const isSecurityTask = matchedDomains.has('security') || matchedDomains.has('auth');
  const priorityBoost = { critical: 1.5, high: 1.0, medium: 0, low: -0.5 }[task.priority] || 0;

  return {
    tokenCount: tokens.length,
    techDomainCount: matchedDomains.size,
    agentMentionCount: mentionedAgents.length,
    systemCount: mentionedSystems.length,
    depCount: depMatches.length + (hasDependsOn ? 1 : 0),
    verbCount: matchedVerbs.size,
    ambiguityCount,
    isSecurityTask,
    priorityBoost,
    matchedDomains: [...matchedDomains],
    mentionedAgents,
    mentionedSystems: mentionedSystems.slice(0, 5),
  };
}

function predictComplexity(features) {
  let raw = 0;
  raw += features.tokenCount * 0.03;
  raw += features.techDomainCount * 1.0;
  raw += features.agentMentionCount * 0.8;
  raw += features.systemCount * 0.6;
  raw += features.depCount * 0.5;
  raw += features.verbCount * 0.4;
  raw += features.ambiguityCount * 0.5;
  raw += features.isSecurityTask ? 1.5 : 0;
  raw += features.priorityBoost;

  const score = Math.max(1, Math.min(10, Math.round(raw)));

  let tier, symbol;
  if (score >= 9)      { tier = 'VERY_COMPLEX'; symbol = '[9-10]'; }
  else if (score >= 7) { tier = 'COMPLEX';      symbol = '[7-8]'; }
  else if (score >= 5) { tier = 'MODERATE';     symbol = '[5-6]'; }
  else if (score >= 3) { tier = 'SIMPLE';        symbol = '[3-4]'; }
  else                 { tier = 'TRIVIAL';       symbol = '[1-2]'; }

  return { score, tier, symbol, rawScore: Math.round(raw * 10) / 10 };
}

function parseTaskBoard() {
  const content = fs.readFileSync(path.join(ROOT, 'public/task_board.md'), 'utf8');
  const tasks = [];
  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || line.includes('----') || line.includes('| ID |')) continue;
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 7) continue;
    const [id, title, desc, priority, assignee, status, created, updated, notes] = cols;
    if (!id || isNaN(parseInt(id))) continue;
    tasks.push({ id: parseInt(id), title: title||'', description: desc||'', priority: priority||'medium', assignee: assignee||'', status: status||'open', notes: notes||'' });
  }
  return tasks;
}

function buildMarkdown(output, tasks) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const d = output.distribution;
  let md = `# Task Complexity Analysis\n\n**Generated:** ${now}  \n**Author:** Ivan (ML Engineer)  \n**Model:** Task Complexity Predictor v1.0\n\n`;
  md += `## Distribution\n\n| Tier | Score | Count |\n|------|-------|-------|\n`;
  md += `| VERY_COMPLEX | 9-10 | ${d.VERY_COMPLEX} |\n| COMPLEX | 7-8 | ${d.COMPLEX} |\n| MODERATE | 5-6 | ${d.MODERATE} |\n| SIMPLE | 3-4 | ${d.SIMPLE} |\n| TRIVIAL | 1-2 | ${d.TRIVIAL} |\n\n`;
  md += `## Task Complexity Scores\n\n| ID | Title | Assignee | Status | Score | Tier | Key Features |\n|----|-------|----------|--------|-------|------|--------------|\n`;
  for (const r of tasks) {
    const f = r.features;
    const kf = [];
    if (f.techDomainCount > 0) kf.push(`${f.techDomainCount} domains(${f.matchedDomains.join(',')})`);
    if (f.agentMentionCount > 0) kf.push(`${f.agentMentionCount} agents`);
    if (f.systemCount > 0) kf.push(`${f.systemCount} systems`);
    if (f.depCount > 0) kf.push(`${f.depCount} deps`);
    if (f.isSecurityTask) kf.push('security');
    md += `| #${r.id} | ${r.title.substring(0,35)} | ${r.assignee||'—'} | ${r.status} | **${r.complexity.score}/10** | ${r.complexity.tier} | ${kf.join(', ')||'minimal'} |\n`;
  }
  md += `\n## Feature Weights\n\n| Feature | Weight | Intuition |\n|---------|--------|----------|\n`;
  md += `| Token count | 0.03/token | Longer = more scope |\n`;
  md += `| Tech domains | 1.0/domain | Each domain adds overhead |\n`;
  md += `| Agent mentions | 0.8/agent | Cross-team coordination cost |\n`;
  md += `| System span | 0.6/system | More touchpoints = more risk |\n`;
  md += `| Dependencies | 0.5/dep | External deps add uncertainty |\n`;
  md += `| Action verbs | 0.4/verb | More actions = more deliverables |\n`;
  md += `| Ambiguity | 0.5/signal | Underspecified tasks balloon |\n`;
  md += `| Security flag | +1.5 | Auth/security has compliance overhead |\n`;
  md += `| Priority boost | ±1.5 | Critical tasks tend to have broader scope |\n`;
  return md;
}

function main() {
  const writeMarkdown = process.argv.includes('--output-md');
  console.log('\n=== Task Complexity Predictor v1.0 — Ivan ===\n');
  const tasks = parseTaskBoard();
  console.log(`Analyzing ${tasks.length} tasks...\n`);

  const results = tasks.map(task => {
    const features = extractFeatures(task);
    const complexity = predictComplexity(features);
    return { ...task, features, complexity };
  });
  results.sort((a, b) => b.complexity.score - a.complexity.score);

  const dist = { VERY_COMPLEX:0, COMPLEX:0, MODERATE:0, SIMPLE:0, TRIVIAL:0 };
  for (const r of results) dist[r.complexity.tier]++;

  console.log('── Distribution ─────────────────────────────────────');
  for (const [tier, count] of Object.entries(dist)) {
    console.log(`  ${tier.padEnd(12)}: ${count}`);
  }
  console.log('');

  // Show only meaningful tasks (ID < 125 to skip test duplicates)
  const namedTasks = results.filter(r => r.id < 125);
  console.log('── Complexity Scores (named tasks) ──────────────────');
  for (const r of namedTasks) {
    const f = r.features;
    console.log(`  ${r.complexity.symbol} [#${r.id}] ${r.title.substring(0,45)}`);
    console.log(`       score:${r.complexity.score}/10  domains:${f.techDomainCount}(${f.matchedDomains.join(',')})  systems:${f.systemCount}  agents:${f.agentMentionCount}  verbs:${f.verbCount}`);
  }
  console.log('');

  const output = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    distribution: dist,
    tasks: results.map(r => ({
      id: r.id, title: r.title, assignee: r.assignee, status: r.status,
      complexityScore: r.complexity.score, complexityTier: r.complexity.tier,
      features: r.features
    }))
  };

  const jsonPath = path.join(OUTPUT_DIR, 'task_complexity.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`JSON saved: ${jsonPath}`);

  if (writeMarkdown) {
    const md = buildMarkdown(output, namedTasks);
    const mdPath = path.join(OUTPUT_DIR, 'task_complexity_report.md');
    fs.writeFileSync(mdPath, md);
    console.log(`Markdown saved: ${mdPath}`);
  }

  return output;
}

main();
