const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scriptPath = path.resolve(__dirname, '../../../scripts/artifact_check.js');
const tmpJson = path.resolve(__dirname, 'tmp_artifact.json');
const tmpMd = path.resolve(__dirname, 'tmp_artifact.md');

describe('artifact_check.js', () => {
    beforeEach(() => {
        if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
        if (fs.existsSync(tmpMd)) fs.unlinkSync(tmpMd);
    });

    afterAll(() => {
        if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
        if (fs.existsSync(tmpMd)) fs.unlinkSync(tmpMd);
    });

    test('PASS on fresh JSON with required fields', () => {
        fs.writeFileSync(tmpJson, JSON.stringify({
            generated_at: new Date().toISOString(),
            test_field: "value"
        }));
        
        const output = execSync(`node ${scriptPath} ${tmpJson} --required-fields test_field`).toString();
        expect(output).toContain('[PASS]');
    });

    test('FAIL on stale JSON', () => {
        // Create file with old mtime
        fs.writeFileSync(tmpJson, JSON.stringify({ generated_at: "2026-04-01T00:00:00Z" }));
        const oldTime = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h old
        fs.utimesSync(tmpJson, oldTime, oldTime);

        try {
            execSync(`node ${scriptPath} ${tmpJson} --max-age 48`);
            fail('Should have failed');
        } catch (err) {
            expect(err.stdout.toString()).toContain('[FAIL]');
            expect(err.stdout.toString()).toContain('Artifact is stale');
        }
    });

    test('FAIL on missing required field', () => {
        fs.writeFileSync(tmpJson, JSON.stringify({ generated_at: new Date().toISOString() }));
        
        try {
            execSync(`node ${scriptPath} ${tmpJson} --required-fields missing_field`);
            fail('Should have failed');
        } catch (err) {
            expect(err.stdout.toString()).toContain('[FAIL]');
            expect(err.stdout.toString()).toContain('Missing required field: missing_field');
        }
    });

    test('PASS on fresh MD (non-JSON)', () => {
        fs.writeFileSync(tmpMd, "# Test Report");
        const output = execSync(`node ${scriptPath} ${tmpMd} --max-age 48`).toString();
        expect(output).toContain('[PASS]');
    });
});
