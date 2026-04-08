#!/usr/bin/env node
/**
 * migrate.js — Database schema migration runner for D004 pipeline
 * Author: Pat (Database Engineer)
 * Task: T1013 — Sprint 9 database schema migration versioning
 *
 * Usage:
 *   node migrate.js [up]              Apply all pending migrations
 *   node migrate.js down <version>    Rollback to a specific version
 *   node migrate.js status            Show applied/pending migrations
 *   node migrate.js validate          Verify checksums of applied migrations
 *
 * Migration file naming: V{NNN}__{description}.sql
 * Rollback naming:       V{NNN}__{description}.rollback.sql
 */

'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || 'pipeline_v3.db';
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.join(__dirname, 'migrations');

function checksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function openDb() {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    return db;
}

function ensureMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            checksum    TEXT NOT NULL,
            applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            applied_by  TEXT DEFAULT 'pat'
        )
    `);
}

function listMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
        process.exit(1);
    }
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => /^V\d+__.+\.sql$/.test(f) && !f.includes('.rollback.'))
        .sort()
        .map(f => {
            const match = f.match(/^(V\d+)__(.+)\.sql$/);
            return {
                file: f,
                version: match[1],
                description: match[2].replace(/_/g, ' '),
                fullPath: path.join(MIGRATIONS_DIR, f),
                rollbackPath: path.join(MIGRATIONS_DIR, `${match[1]}__${match[2]}.rollback.sql`),
            };
        });
}

function getApplied(db) {
    return db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
}

function cmdUp(db) {
    const files = listMigrationFiles();
    const applied = new Map(getApplied(db).map(r => [r.version, r.checksum]));
    const pending = files.filter(f => !applied.has(f.version));

    if (pending.length === 0) {
        console.log('All migrations already applied. Database is up to date.');
        return;
    }

    console.log(`Applying ${pending.length} migration(s)...`);
    for (const m of pending) {
        const sql = fs.readFileSync(m.fullPath, 'utf8');
        const sum = checksum(sql);
        try {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (version, description, checksum) VALUES (?, ?, ?)')
              .run(m.version, m.description, sum);
            console.log(`  [OK] ${m.version} — ${m.description}`);
        } catch (err) {
            console.error(`  [FAIL] ${m.version} — ${err.message}`);
            process.exit(1);
        }
    }
    console.log('Done.');
}

function cmdDown(db, targetVersion) {
    if (!targetVersion) {
        console.error('Usage: node migrate.js down <version>  (e.g. V001)');
        process.exit(1);
    }
    const applied = getApplied(db);
    // Roll back in reverse order down to (but not including) targetVersion
    const toRollback = applied
        .filter(r => r.version > targetVersion)
        .sort((a, b) => b.version.localeCompare(a.version));

    if (toRollback.length === 0) {
        console.log(`Nothing to roll back — already at or before ${targetVersion}.`);
        return;
    }

    const files = listMigrationFiles();
    const fileMap = new Map(files.map(f => [f.version, f]));

    console.log(`Rolling back ${toRollback.length} migration(s) to reach ${targetVersion}...`);
    for (const row of toRollback) {
        const m = fileMap.get(row.version);
        if (!m) {
            console.error(`  [ERROR] No migration file found for ${row.version}`);
            process.exit(1);
        }
        if (!fs.existsSync(m.rollbackPath)) {
            console.error(`  [ERROR] No rollback file for ${row.version}: ${m.rollbackPath}`);
            process.exit(1);
        }
        const sql = fs.readFileSync(m.rollbackPath, 'utf8');
        try {
            db.exec(sql);
            db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(row.version);
            console.log(`  [ROLLED BACK] ${row.version}`);
        } catch (err) {
            console.error(`  [FAIL] ${row.version} rollback — ${err.message}`);
            process.exit(1);
        }
    }
    console.log('Done.');
}

function cmdStatus(db) {
    const files = listMigrationFiles();
    const applied = new Map(getApplied(db).map(r => [r.version, r]));

    console.log('\nSchema Migration Status');
    console.log('=======================');
    for (const f of files) {
        const rec = applied.get(f.version);
        if (rec) {
            console.log(`  [APPLIED ] ${f.version} — ${f.description} (applied: ${rec.applied_at})`);
        } else {
            console.log(`  [PENDING ] ${f.version} — ${f.description}`);
        }
    }
    console.log(`\nTotal: ${files.length} migrations, ${applied.size} applied, ${files.length - applied.size} pending\n`);
}

function cmdValidate(db) {
    const files = listMigrationFiles();
    const applied = getApplied(db);
    const fileMap = new Map(files.map(f => [f.version, f]));

    let ok = 0, fail = 0;
    console.log('\nValidating migration checksums...');
    for (const row of applied) {
        const m = fileMap.get(row.version);
        if (!m) {
            console.error(`  [MISSING ] ${row.version} — file not found on disk`);
            fail++;
            continue;
        }
        const currentSum = checksum(fs.readFileSync(m.fullPath, 'utf8'));
        if (currentSum === row.checksum) {
            console.log(`  [OK      ] ${row.version}`);
            ok++;
        } else {
            console.error(`  [TAMPERED] ${row.version} — checksum mismatch (stored: ${row.checksum}, file: ${currentSum})`);
            fail++;
        }
    }
    console.log(`\nResult: ${ok} valid, ${fail} failed\n`);
    if (fail > 0) process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────

const [,, cmd = 'up', arg] = process.argv;
const db = openDb();
ensureMigrationsTable(db);

switch (cmd) {
    case 'up':       cmdUp(db); break;
    case 'down':     cmdDown(db, arg); break;
    case 'status':   cmdStatus(db); break;
    case 'validate': cmdValidate(db); break;
    default:
        console.error(`Unknown command: ${cmd}. Use up | down <version> | status | validate`);
        process.exit(1);
}

db.close();
