
/**
 * Phase 1 Filter Analysis Script (T938)
 * 
 * Compares current thresholds vs proposed thresholds against Grace's live fixture.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_PATH = '../../agents/grace/output/live_phase1_fixture.json';

function calculateYesRatio(market) {
  const yesMid = (market.yes_bid + market.yes_ask) / 2 || market.yes_bid || 50;
  const noMid = (market.no_bid + market.no_ask) / 2 || market.no_bid || 50;
  const total = yesMid + noMid;
  return (yesMid / total) * 100;
}

function analyze(markets, ranges, minVol) {
    let qualifying = 0;
    const results = markets.map(m => {
        const yesRatio = calculateYesRatio(m);
        const volPass = (m.volume || 0) >= minVol;
        let ratioPass = false;
        for (const range of ranges) {
            if (yesRatio >= range.min && yesRatio <= range.max) {
                ratioPass = true;
                break;
            }
        }
        const passed = volPass && ratioPass;
        if (passed) qualifying++;
        return { ticker: m.ticker, yesRatio, volume: m.volume, passed };
    });
    return { qualifying, results };
}

if (!fs.existsSync(FIXTURE_PATH)) {
    console.error("Fixture not found at " + FIXTURE_PATH);
    process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const markets = fixture.cases.map(c => c.input).filter(m => m.ticker && m.ticker !== 'BAD-NO-TITLE' && m.ticker !== 'BAD-NO-YES');

// Current
const currentRanges = [{ min: 15, max: 30 }, { min: 70, max: 85 }];
const currentVol = 10000;

// Proposed
const proposedRanges = [{ min: 10, max: 40 }, { min: 60, max: 90 }];
const proposedVol = 10000;

const currentAnalysis = analyze(markets, currentRanges, currentVol);
const proposedAnalysis = analyze(markets, proposedRanges, proposedVol);

console.log("=== Phase 1 Filter Analysis ===");
console.log(`Total Valid Markets in Fixture: ${markets.length}`);
console.log("");
console.log("--- Current Thresholds ([15-30%] or [70-85%], Vol >= 10k) ---");
console.log(`Qualifying: ${currentAnalysis.qualifying}`);
currentAnalysis.results.forEach(r => {
    console.log(`  ${r.ticker.padEnd(25)} | Ratio: ${r.yesRatio.toFixed(1)}% | Vol: ${r.volume.toLocaleString().padStart(8)} | Passed: ${r.passed}`);
});

console.log("");
console.log("--- Proposed Thresholds ([10-40%] or [60-90%], Vol >= 10k) ---");
console.log(`Qualifying: ${proposedAnalysis.qualifying}`);
proposedAnalysis.results.forEach(r => {
    console.log(`  ${r.ticker.padEnd(25)} | Ratio: ${r.yesRatio.toFixed(1)}% | Vol: ${r.volume.toLocaleString().padStart(8)} | Passed: ${r.passed}`);
});

const coverageIncrease = ((proposedAnalysis.qualifying - currentAnalysis.qualifying) / currentAnalysis.qualifying) * 100;
console.log("");
console.log(`Coverage Increase: +${coverageIncrease.toFixed(1)}%`);
