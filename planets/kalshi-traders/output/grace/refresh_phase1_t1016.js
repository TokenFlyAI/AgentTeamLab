#!/usr/bin/env node
/**
 * T1016 — Refresh Phase 1 canonical output (Frank T938 thresholds)
 * agent: grace | task_id: T1016 | date: 2026-04-07
 *
 * Updates public/markets_filtered.json using expanded thresholds from Frank T938:
 *   YES ratio: [10-40%] or [60-90%]  (was [15-30%] or [70-85%])
 *   Volume:    >= 10,000              (unchanged)
 *
 * Input:  output/bob/mock_kalshi_markets.json  (200-market dataset)
 * Output: public/markets_filtered.json
 *
 * Run: node agents/grace/output/refresh_phase1_t1016.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '../..');
const INPUT_PATH = path.join(ROOT, 'output/bob/mock_kalshi_markets.json');
const OUT_PATH   = path.join(ROOT, 'public/markets_filtered.json');

// T938 thresholds (expanded by Frank)
const CONFIG = {
  task:         'T1016',
  phase:        'Sprint 9 Phase 1 Refresh',
  source:       'grace_t1016_phase1_refresh',
  minVolume:    10000,
  targetRanges: [{ min: 10, max: 40 }, { min: 60, max: 90 }],
  excludedRange:{ min: 40, max: 60 },
};

function getYesRatio(m) {
  if (m.yes_ratio  !== undefined) return parseFloat(m.yes_ratio);
  if (m.yes_bid    !== undefined) return parseFloat(m.yes_bid);
  if (m.yes_price  !== undefined) return parseFloat(m.yes_price) * 100;
  return NaN;
}

function classify(yesRatio) {
  const { targetRanges, excludedRange } = CONFIG;
  if (isNaN(yesRatio)) return 'invalid';
  // Excluded range takes priority (matches Frank T938 order of operations)
  if (yesRatio >= excludedRange.min && yesRatio <= excludedRange.max) return 'excluded_middle';
  for (const r of targetRanges) {
    if (yesRatio >= r.min && yesRatio <= r.max) return 'qualifying';
  }
  return 'extreme_ratio';
}

function main() {
  console.log('=== T1016 Phase 1 Refresh — Frank T938 Thresholds ===\n');

  if (!fs.existsSync(INPUT_PATH)) {
    console.error('Input not found:', INPUT_PATH);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
  const markets = Array.isArray(raw) ? raw : (raw.markets || raw.qualifying_markets || []);
  console.log('Input markets:', markets.length);

  // Volume filter
  const volPassed = markets.filter(m => (m.volume || 0) >= CONFIG.minVolume);
  const volFailed = markets.length - volPassed.length;
  console.log('After volume filter (>=' + CONFIG.minVolume + '):', volPassed.length, '| excluded:', volFailed);

  // Ratio filter
  const qualifying     = [];
  const excludedMiddle = [];
  const extremeRatio   = [];

  for (const m of volPassed) {
    const yr  = getYesRatio(m);
    const cat = classify(yr);
    const enriched = {
      ...m,
      yes_ratio:      isNaN(yr) ? null : +yr.toFixed(2),
      recommendation: cat === 'qualifying' ? 'proceed_to_clustering' : 'skip',
    };
    if      (cat === 'qualifying')      qualifying.push(enriched);
    else if (cat === 'excluded_middle') excludedMiddle.push(enriched);
    else                                extremeRatio.push(enriched);
  }

  console.log('\nThresholds:', CONFIG.targetRanges.map(r => r.min + '-' + r.max + '%').join(' or '));
  console.log('Qualifying:', qualifying.length);
  console.log('Excluded (middle 40-60%):', excludedMiddle.length);
  console.log('Extreme ratio:', extremeRatio.length);

  const output = {
    generated_at:  new Date().toISOString(),
    task:          CONFIG.task,
    phase:         CONFIG.phase,
    source:        CONFIG.source,
    thresholds:    { minVolume: CONFIG.minVolume, targetRanges: CONFIG.targetRanges, excludedRange: CONFIG.excludedRange },
    summary: {
      total_markets:         markets.length,
      after_volume_filter:   volPassed.length,
      qualifying_markets:    qualifying.length,
      excluded_low_volume:   volFailed,
      excluded_middle_range: excludedMiddle.length,
      extreme_ratio:         extremeRatio.length,
    },
    qualifying_markets: qualifying,
    excluded_markets:   [...excludedMiddle, ...extremeRatio],
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log('\nWritten:', OUT_PATH);
  return output.summary;
}

const summary = main();
console.log('\nSummary:', JSON.stringify(summary));
