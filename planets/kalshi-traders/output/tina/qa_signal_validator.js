#!/usr/bin/env node
/**
 * QA Signal Validator — Validates Bob's trade_signals.json
 * Tina (QA) — Sprint 3, supports T568 handoff chain
 *
 * Checks:
 *  1. Structure & required fields
 *  2. Entry/Exit pairing (every ENTRY needs EXIT or STOP)
 *  3. Z-score consistency (entry |z| > threshold, exit |z| < exit threshold)
 *  4. Duplicate detection (same signal at same timestamp)
 *  5. Market pair diversity
 *  6. Confidence thresholds
 *  7. Chronological ordering per pair
 *  8. Position sizing rules
 *
 * Usage: node qa_signal_validator.js [path/to/trade_signals.json]
 */

const fs = require('fs');
const path = require('path');

// Default: look for Bob's signals relative to agent dir (run from agents/tina/)
const signalPath = process.argv[2] || path.resolve(__dirname, '..', '..', 'bob', 'output', 'trade_signals.json');

console.log('=== QA Signal Validator ===');
console.log(`Input: ${signalPath}\n`);

// Load signals
let data;
try {
  data = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
} catch (e) {
  console.error(`FAIL: Cannot read/parse ${signalPath}: ${e.message}`);
  process.exit(1);
}

const results = {
  checks: [],
  pass: 0,
  fail: 0,
  warn: 0,
  signals_analyzed: 0
};

function check(name, passed, detail, severity = 'FAIL') {
  const status = passed ? 'PASS' : severity;
  results.checks.push({ name, status, detail });
  if (passed) results.pass++;
  else if (severity === 'FAIL') results.fail++;
  else results.warn++;
  const icon = passed ? '✅' : (severity === 'FAIL' ? '❌' : '⚠️');
  console.log(`${icon} ${name}: ${detail}`);
}

const signals = data.signals || [];
const config = data.config || {};
results.signals_analyzed = signals.length;

// === CHECK 1: Structure & Required Fields ===
const requiredTop = ['generated_at', 'strategy', 'config', 'total_signals', 'signals'];
const missingTop = requiredTop.filter(f => !(f in data));
check('Structure: top-level fields', missingTop.length === 0,
  missingTop.length === 0 ? `All ${requiredTop.length} required fields present` : `Missing: ${missingTop.join(', ')}`);

check('Structure: signal count matches', data.total_signals === signals.length,
  `Declared ${data.total_signals}, actual ${signals.length}`);

const requiredSignalFields = ['id', 'timestamp', 'type', 'market_a', 'market_b', 'z_score'];
const entryFields = ['action_a', 'action_b', 'confidence', 'contracts'];
let fieldIssues = [];
signals.forEach((s, i) => {
  const missing = requiredSignalFields.filter(f => !(f in s));
  if (missing.length) fieldIssues.push(`sig_${i+1}: missing ${missing.join(',')}`);
  if (s.type === 'ENTRY') {
    const missingEntry = entryFields.filter(f => !(f in s));
    if (missingEntry.length) fieldIssues.push(`sig_${i+1} (ENTRY): missing ${missingEntry.join(',')}`);
  }
});
check('Structure: signal fields', fieldIssues.length === 0,
  fieldIssues.length === 0 ? `All ${signals.length} signals have required fields` : `${fieldIssues.length} issues: ${fieldIssues.slice(0,3).join('; ')}${fieldIssues.length > 3 ? '...' : ''}`);

// === CHECK 2: Entry/Exit Pairing ===
const pairMap = {}; // key: "market_a|market_b" -> array of signals
signals.forEach(s => {
  const key = `${s.market_a}|${s.market_b}`;
  if (!pairMap[key]) pairMap[key] = [];
  pairMap[key].push(s);
});

let unpaired = [];
let entryCount = 0, exitCount = 0, stopCount = 0;
Object.entries(pairMap).forEach(([key, sigs]) => {
  let openPositions = 0;
  sigs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  sigs.forEach(s => {
    if (s.type === 'ENTRY') { openPositions++; entryCount++; }
    else if (s.type === 'EXIT') { openPositions--; exitCount++; }
    else if (s.type === 'STOP') { openPositions--; stopCount++; }
  });
  if (openPositions > 0) unpaired.push(`${key}: ${openPositions} unclosed`);
  if (openPositions < 0) unpaired.push(`${key}: ${Math.abs(openPositions)} extra exits`);
});

check('Pairing: entry/exit balance', unpaired.length === 0,
  unpaired.length === 0
    ? `${entryCount} entries, ${exitCount} exits, ${stopCount} stops — all paired`
    : `${unpaired.length} imbalances: ${unpaired.join('; ')}`,
  'WARN');

// === CHECK 3: Z-Score Consistency ===
const zEntry = config.zScoreEntry || 1.2;
const zExit = config.zScoreExit || 0.5;
const zStop = config.zScoreStop || 3.0;

let zIssues = [];
signals.forEach(s => {
  const absZ = Math.abs(s.z_score);
  if (s.type === 'ENTRY' && absZ < zEntry) {
    zIssues.push(`${s.id}: ENTRY z=${s.z_score} below threshold ${zEntry}`);
  }
  if (s.type === 'EXIT' && absZ > zExit) {
    // Exits should have |z| < exit threshold (reverted to mean)
    // But this isn't always strictly enforced — it's a target
    zIssues.push(`${s.id}: EXIT z=${s.z_score} above exit threshold ${zExit}`);
  }
  if (s.type === 'STOP' && absZ < zStop) {
    zIssues.push(`${s.id}: STOP z=${s.z_score} below stop threshold ${zStop}`);
  }
});

check('Z-Score: entry thresholds', zIssues.filter(i => i.includes('ENTRY')).length === 0,
  zIssues.filter(i => i.includes('ENTRY')).length === 0
    ? `All entries have |z| >= ${zEntry}`
    : `${zIssues.filter(i => i.includes('ENTRY')).length} entries below threshold`);

check('Z-Score: exit consistency', zIssues.filter(i => i.includes('EXIT')).length === 0,
  zIssues.filter(i => i.includes('EXIT')).length === 0
    ? `All exits have |z| <= ${zExit} (mean reversion)`
    : `${zIssues.filter(i => i.includes('EXIT')).length} exits above exit threshold`,
  'WARN');

// === CHECK 4: Duplicate Detection ===
const sigKeys = new Set();
let dupes = [];
signals.forEach(s => {
  const key = `${s.type}|${s.market_a}|${s.market_b}|${s.timestamp}|${s.z_score}`;
  if (sigKeys.has(key)) dupes.push(s.id);
  sigKeys.add(key);
});

check('Duplicates: no exact duplicates', dupes.length === 0,
  dupes.length === 0 ? 'No duplicate signals found' : `${dupes.length} duplicates: ${dupes.join(', ')}`);

// Check for cross-cluster duplicates (same market pair in different clusters)
const marketPairClusters = {};
signals.filter(s => s.type === 'ENTRY').forEach(s => {
  const pairKey = [s.market_a, s.market_b].sort().join('|');
  if (!marketPairClusters[pairKey]) marketPairClusters[pairKey] = 0;
  marketPairClusters[pairKey]++;
});
const overrepresented = Object.entries(marketPairClusters).filter(([_, c]) => c > 5);
check('Duplicates: no over-represented pairs', overrepresented.length === 0,
  overrepresented.length === 0
    ? `${Object.keys(marketPairClusters).length} unique entry pairs, well distributed`
    : `${overrepresented.length} pairs with >5 entries: ${overrepresented.map(([p,c]) => `${p}(${c})`).join(', ')}`,
  'WARN');

// === CHECK 5: Market Pair Diversity ===
const uniquePairs = Object.keys(pairMap).length;
check('Diversity: multiple market pairs', uniquePairs >= 3,
  `${uniquePairs} unique market pairs`,
  uniquePairs >= 2 ? 'WARN' : 'FAIL');

// === CHECK 6: Confidence Thresholds ===
const minConf = config.minConfidence || 0.65;
const lowConf = signals.filter(s => s.type === 'ENTRY' && s.confidence < minConf);
check('Confidence: entries meet minimum', lowConf.length === 0,
  lowConf.length === 0
    ? `All entries have confidence >= ${minConf}`
    : `${lowConf.length} entries below ${minConf}: ${lowConf.map(s => `${s.id}(${s.confidence})`).join(', ')}`);

// === CHECK 7: Chronological Ordering ===
let orderIssues = 0;
Object.entries(pairMap).forEach(([key, sigs]) => {
  for (let i = 1; i < sigs.length; i++) {
    if (new Date(sigs[i].timestamp) < new Date(sigs[i-1].timestamp)) {
      orderIssues++;
    }
  }
});
check('Ordering: chronological per pair', orderIssues === 0,
  orderIssues === 0 ? 'All signals chronologically ordered per pair' : `${orderIssues} out-of-order signals`);

// === CHECK 8: Position Sizing ===
const maxPos = config.maxPositionSize || 5;
const oversized = signals.filter(s => s.type === 'ENTRY' && s.contracts > maxPos);
check('Sizing: within max position', oversized.length === 0,
  oversized.length === 0
    ? `All entries <= ${maxPos} contracts`
    : `${oversized.length} entries exceed max: ${oversized.map(s => `${s.id}(${s.contracts})`).join(', ')}`);

// === CHECK 9: Anomalous Z-Scores (from T570 finding) ===
const anomalousZ = signals.filter(s => Math.abs(s.z_score) > 10);
check('Anomaly: no extreme z-scores (>10)', anomalousZ.length === 0,
  anomalousZ.length === 0
    ? 'No anomalous z-scores detected'
    : `${anomalousZ.length} extreme z-scores: ${anomalousZ.map(s => `${s.id}(z=${s.z_score})`).join(', ')}`);

// === SUMMARY ===
console.log('\n=== SUMMARY ===');
console.log(`Signals analyzed: ${results.signals_analyzed}`);
console.log(`  Entries: ${entryCount}, Exits: ${exitCount}, Stops: ${stopCount}`);
console.log(`  Unique market pairs: ${uniquePairs}`);
console.log(`Checks: ${results.pass} PASS, ${results.fail} FAIL, ${results.warn} WARN`);

const verdict = results.fail === 0 ? 'PASS' : 'FAIL';
console.log(`\nVERDICT: ${verdict}`);

if (results.warn > 0) {
  console.log('\nWarnings (non-blocking):');
  results.checks.filter(c => c.status === 'WARN').forEach(c => console.log(`  - ${c.name}: ${c.detail}`));
}

if (results.fail > 0) {
  console.log('\nFailures (blocking):');
  results.checks.filter(c => c.status === 'FAIL').forEach(c => console.log(`  - ${c.name}: ${c.detail}`));
}

// Write machine-readable results
const outputPath = path.join(__dirname, 'qa_signal_report.json');
const report = {
  validator: 'qa_signal_validator.js',
  input: signalPath,
  timestamp: new Date().toISOString(),
  verdict,
  signals_analyzed: results.signals_analyzed,
  signal_breakdown: { entries: entryCount, exits: exitCount, stops: stopCount },
  unique_pairs: uniquePairs,
  config_used: config,
  checks: results.checks,
  summary: { pass: results.pass, fail: results.fail, warn: results.warn }
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(`\nReport written to: ${outputPath}`);
