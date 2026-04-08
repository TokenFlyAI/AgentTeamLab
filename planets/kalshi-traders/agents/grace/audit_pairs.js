const fs = require('fs');
const path = require('path');

const dataPath = '../../public/correlation_pairs.json';
const now = new Date('2026-04-07T12:00:00Z'); // Using today's date from context

try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const generatedAt = new Date(data.generated_at);
    const ageHours = (now - generatedAt) / (1000 * 60 * 60);

    const report = {
        generated_at: data.generated_at,
        age_hours: ageHours.toFixed(2),
        is_stale: ageHours > 48,
        total_pairs: data.pairs.length,
        missing_confidence_field: 0,
        low_correlation_noise: 0,
        significant_pairs: 0,
        arbitrage_opportunities: 0
    };

    data.pairs.forEach(pair => {
        if (pair.arbitrage_confidence === undefined) {
            report.missing_confidence_field++;
        }
        if (Math.abs(pair.pearson_r) < 0.3) {
            report.low_correlation_noise++;
        } else {
            report.significant_pairs++;
        }
        if (pair.is_arbitrage_opportunity) {
            report.arbitrage_opportunities++;
        }
    });

    console.log(JSON.stringify(report, null, 2));
} catch (err) {
    console.error('Error reading or parsing correlation_pairs.json:', err.message);
}
