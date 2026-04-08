const fs = require('fs');

function auditPhase1() {
    let raw;
    try {
        raw = fs.readFileSync('../../public/markets_filtered.json', 'utf8');
    } catch (e) {
        console.error("Failed to read file:", e.message);
        process.exit(1);
    }

    const data = JSON.parse(raw);
    const markets = data.markets || data;

    let issues = [];

    // Length check
    if (!Array.isArray(markets)) {
        issues.push("Markets is not an array.");
    } else if (markets.length !== 119) {
        issues.push(`Expected 119 markets, found ${markets.length}.`);
    }

    // Schema and validity check
    let syntheticCount = 0;
    markets.forEach((m, idx) => {
        // Check for required fields
        const required = ['ticker', 'yes_ask', 'yes_bid', 'volume'];
        for (const req of required) {
            if (m[req] === undefined || m[req] === null) {
                issues.push(`Market at index ${idx} missing ${req}`);
            }
        }

        // Check for mock/synthetic data indicators
        const strForm = JSON.stringify(m).toLowerCase();
        if (strForm.includes('mock') || strForm.includes('test') || strForm.includes('fake') || strForm.includes('synthetic')) {
            syntheticCount++;
        }

        // Price range check
        const prices = ['yes_ask', 'yes_bid', 'no_ask', 'no_bid'];
        for (const priceField of prices) {
            if (m[priceField] !== undefined && typeof m[priceField] === 'number') {
                if (m[priceField] < 0 || m[priceField] > 100) {
                     issues.push(`Market ${m.ticker} has invalid ${priceField}: ${m[priceField]}`);
                }
            }
        }
    });

    if (syntheticCount > 0) {
        issues.push(`Found ${syntheticCount} markets with synthetic data indicators (mock/test/fake/synthetic).`);
    }

    // Metadata / Timestamp check
    const ts = data.timestamp || data.updated_at || data.generated_at || data.date;
    if (ts) {
        if (!ts.toString().includes('2026-04-07')) {
            issues.push(`Timestamp ${ts} does not match 2026-04-07.`);
        }
    } else {
        issues.push("Missing timestamp or updated_at field in root object.");
    }

    if (issues.length === 0) {
        console.log("PASS: 0 issues found.");
    } else {
        console.log("FAIL: Issues found:");
        issues.forEach(i => console.log("- " + i));
    }
}

auditPhase1();