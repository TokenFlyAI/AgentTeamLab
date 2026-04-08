#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * artifact_check.js
 * 
 * Automates C15/C16/C17 freshness and schema checks for any JSON artifact.
 * Usage: node scripts/artifact_check.js <file_path> [options]
 * Options:
 *   --max-age <hours>       Max age in hours (default: 48)
 *   --required-fields <f1,f2> Comma-separated list of required JSON keys
 *   --run-command <cmd>      Optional command to re-run and verify the artifact
 *   --check-metadata        Verify C20 metadata (task_id, agent, timestamp)
 *   --verbose               Show detailed output
 */

const args = process.argv.slice(2);
const filePath = args[0];

if (!filePath || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node artifact_check.js <file_path> [options]

Options:
  --max-age <hours>           Max age in hours (default: 48)
  --required-fields <f1,f2>   Comma-separated list of required JSON keys
  --run-command <cmd>          Optional command to re-run and verify the artifact
  --check-metadata            Verify C20 metadata (task_id, agent, timestamp)
  --verbose                   Show detailed output
    `);
    process.exit(0);
}

const maxAgeHours = parseFloat(getArgValue('--max-age')) || 48;
const requiredFields = getArgValue('--required-fields')?.split(',') || [];
const runCommand = getArgValue('--run-command');
const verbose = args.includes('--verbose');
const checkMetadata = args.includes('--check-metadata');

function getArgValue(name) {
    const idx = args.indexOf(name);
    return (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) ? args[idx + 1] : null;
}

function log(msg) {
    if (verbose) console.log(`[INFO] ${msg}`);
}

async function run() {
    const results = {
        pass: true,
        errors: [],
        metrics: {}
    };

    // 1. Existence check
    if (!fs.existsSync(filePath)) {
        results.pass = false;
        results.errors.push(`File not found: ${filePath}`);
        console.log(JSON.stringify(results, null, 2));
        process.exit(1);
    }

    const stats = fs.statSync(filePath);
    const now = new Date();
    const ageHours = (now - stats.mtime) / (1000 * 60 * 60);
    results.metrics.age_hours = parseFloat(ageHours.toFixed(2));
    results.metrics.last_modified = stats.mtime.toISOString();

    // 2. Freshness check (C15)
    if (ageHours > maxAgeHours) {
        results.pass = false;
        results.errors.push(`Artifact is stale: ${ageHours.toFixed(2)}h old (max: ${maxAgeHours}h)`);
    } else {
        log(`Freshness check PASS: ${ageHours.toFixed(2)}h old`);
    }

    // 3. Schema check (JSON)
    let data = null;
    if (filePath.endsWith('.json') || requiredFields.length > 0 || checkMetadata) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            data = JSON.parse(content);
            
            for (const field of requiredFields) {
                let found = (data[field] !== undefined);
                if (!found && Array.isArray(data.pairs) && data.pairs.length > 0) {
                    found = (data.pairs[0][field] !== undefined);
                }
                if (!found) {
                    results.pass = false;
                    results.errors.push(`Missing required field: ${field}`);
                }
            }
            
            if (results.pass && requiredFields.length > 0) log(`Schema check PASS: all fields present (${requiredFields.join(', ')})`);
        } catch (err) {
            if (requiredFields.length > 0 || filePath.endsWith('.json')) {
                results.pass = false;
                results.errors.push(`JSON parse error: ${err.message}`);
            }
        }
    }

    // 3b. Metadata check (C20)
    if (checkMetadata && data) {
        const metadata = data.metadata;
        if (!metadata) {
            results.pass = false;
            results.errors.push(`Missing C20 metadata (no 'metadata' field)`);
        } else {
            const missing = [];
            if (!metadata.task_id) missing.push('task_id');
            if (!metadata.agent) missing.push('agent');
            if (!metadata.timestamp) missing.push('timestamp');
            if (missing.length > 0) {
                results.pass = false;
                results.errors.push(`Missing C20 metadata fields: ${missing.join(', ')}`);
            } else {
                log(`Metadata check PASS: task_id=${metadata.task_id}, agent=${metadata.agent}`);
            }
        }
    }

    // 4. Run command execution (optional)
    if (runCommand) {
        try {
            log(`Executing run command: ${runCommand}`);
            execSync(runCommand, { stdio: 'inherit' });
            log(`Run command PASS`);
        } catch (err) {
            results.pass = false;
            results.errors.push(`Run command FAILED: ${err.message}`);
        }
    }

    if (results.pass) {
        console.log(`[PASS] Artifact verified: ${filePath}`);
        if (verbose) console.log(JSON.stringify(results, null, 2));
        process.exit(0);
    } else {
        console.error(`[FAIL] Artifact validation failed for: ${filePath}`);
        results.errors.forEach(e => console.error(` - ERROR: ${e}`));
        if (verbose) console.log(JSON.stringify(results, null, 2));
        process.exit(1);
    }
}

run();
