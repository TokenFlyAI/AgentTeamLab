#!/usr/bin/env node
/**
 * scripts/heartbeat_monitor.js
 * Tokenfly SRE — Agent Heartbeat Monitor
 * Author: Liam (SRE)
 *
 * Checks all agents/{name}/heartbeat.md mtime every 60 seconds.
 * Emits alerts when agent liveness drops below SLO thresholds.
 * Writes status to public/reports/heartbeat_status.json
 * Writes alerts to public/reports/active_alerts.md (shared with healthcheck.js)
 *
 * Usage:
 *   node scripts/heartbeat_monitor.js [--interval 60]
 *   node scripts/heartbeat_monitor.js --once    # Run once and exit
 *
 * Alert thresholds (from sre_plan.md):
 *   ALT-005: 0 agents alive (all heartbeats stale)      → P0 Critical
 *   ALT-006: < 25% agents alive for > 10 min             → P1 High
 *
 * Alive threshold: 5 minutes (matches server.js aliveThresholdMs = 300,000ms)
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const intervalIdx = args.indexOf('--interval');
const runOnce = args.includes('--once');

const INTERVAL_MS = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) * 1000 : 60_000;
const ALIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — matches server.js
const BASE_DIR = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(BASE_DIR, 'agents');
const STATUS_FILE = path.join(BASE_DIR, 'public', 'reports', 'heartbeat_status.json');
const ALERTS_FILE = path.join(BASE_DIR, 'public', 'reports', 'active_alerts.md');

const DASHBOARD_URL = 'http://localhost:3199/api/health';
const DASHBOARD_TIMEOUT_MS = 5000;
const API_KEY = process.env.API_KEY || '';

const THRESHOLDS = {
  alive_min_pct: 0.25,  // ALT-006: < 25% alive → P1
};

// Track consecutive low-liveness windows for ALT-006 (must be sustained > 10 min)
let lowLivenessWindowCount = 0;
const LOW_LIVENESS_WINDOWS_FOR_ALERT = Math.ceil((10 * 60 * 1000) / INTERVAL_MS); // ~10 windows at 60s interval

// ── Known agents list ──────────────────────────────────────────────────────────
// Populated dynamically by scanning agents/ directory

// ── Utility ────────────────────────────────────────────────────────────────────

function isoNow() {
  return new Date().toISOString();
}

// ── Alert Management ───────────────────────────────────────────────────────────

// Shared alert state — read existing alerts file, merge with heartbeat alerts
// (healthcheck.js also writes to this file; we do a read-modify-write)

const ownedAlerts = new Set(['ALT-005', 'ALT-006']); // alerts this script manages
const activeAlerts = new Map(); // alertId → { severity, message, triggeredAt }

const ALICE_INBOX_DIR = path.join(BASE_DIR, 'agents', 'alice', 'chat_inbox');

/**
 * Write a P0/P1 alert notification to Alice's inbox.
 * Called once when an alert first fires (not on repeated checks).
 */
function notifyAlice(alertId, severity, message) {
  // Only notify for P0 and P1 alerts — don't spam Alice on P2/P3
  if (!severity.startsWith('P0') && !severity.startsWith('P1')) return;

  try {
    fs.mkdirSync(ALICE_INBOX_DIR, { recursive: true });
    // Filename mirrors chat_inbox convention: YYYY_MM_DD_HH_MM_SS_from_heartbeat_monitor.md
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}`
      + `_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
    const filename = `${ts}_from_heartbeat_monitor.md`;
    const inboxPath = path.join(ALICE_INBOX_DIR, filename);

    const content = [
      `# ${severity} Alert — ${alertId}`,
      `**From**: heartbeat_monitor (SRE automation)`,
      `**Time**: ${isoNow()}`,
      '',
      `**${message}**`,
      '',
      `See \`public/reports/active_alerts.md\` and \`public/reports/heartbeat_status.json\` for detail.`,
      '',
      `To investigate:`,
      `- Run \`bash status.sh\` to see which agents are alive`,
      `- Run \`bash smart_run.sh\` to restart agents with pending work`,
      `- Or \`curl -X POST http://localhost:3199/api/agents/watchdog\` to restart stuck agents`,
    ].join('\n');

    fs.writeFileSync(inboxPath, content + '\n');
    console.log(`[heartbeat_monitor] Notified Alice: ${inboxPath}`);
  } catch (err) {
    console.error(`[heartbeat_monitor] Failed to notify Alice: ${err.message}`);
  }
}

function loadExistingAlerts() {
  // Parse active_alerts.md to preserve alerts set by healthcheck.js
  // We own only ALT-005 and ALT-006; don't clobber others
  if (!fs.existsSync(ALERTS_FILE)) return;
  // Simple approach: we don't try to parse the table; we just track our own state
  // and write the full file each time (healthcheck.js does the same — last-write wins
  // for shared state, which is acceptable for a file-based system)
}

function fireAlert(alertId, severity, message) {
  const existing = activeAlerts.get(alertId);
  if (existing && existing.severity === severity) {
    // Same severity already active — no change, no re-notification
    return;
  }
  // New alert or severity transition (e.g. P0→P2 or P2→P0)
  if (existing) {
    console.log(`[TRANSITION] ${alertId}: ${existing.severity} → ${severity}`);
  } else {
    console.error(`[ALERT ${severity}] ${alertId}: ${message}`);
  }
  activeAlerts.set(alertId, { severity, message, triggeredAt: existing ? existing.triggeredAt : isoNow() });
  writeAlertsFile();
  // Only page Alice on new P0/P1 alerts, not on severity downgrades or P2 info
  if (!existing) notifyAlice(alertId, severity, message);
}

function clearAlert(alertId) {
  if (activeAlerts.has(alertId)) {
    console.log(`[RESOLVED] ${alertId} cleared`);
    activeAlerts.delete(alertId);
    writeAlertsFile();
  }
}

function writeAlertsFile() {
  const lines = [
    '# Active Alerts',
    `_Last updated: ${isoNow()}_`,
    '',
  ];

  if (activeAlerts.size === 0) {
    lines.push('**No active alerts. All systems nominal.**');
  } else {
    lines.push(`**${activeAlerts.size} active alert(s)**`);
    lines.push('');
    lines.push('| Alert ID | Severity | Message | Triggered At |');
    lines.push('|----------|----------|---------|--------------|');
    for (const [id, alert] of activeAlerts) {
      lines.push(`| ${id} | ${alert.severity} | ${alert.message} | ${alert.triggeredAt} |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('_Generated by scripts/heartbeat_monitor.js_');

  try {
    fs.writeFileSync(ALERTS_FILE, lines.join('\n') + '\n');
  } catch (err) {
    console.error(`[heartbeat_monitor] Failed to write alerts file: ${err.message}`);
  }
}

// ── Dashboard Liveness Check ───────────────────────────────────────────────────

/**
 * Returns a promise resolving to true if the dashboard API responds, false otherwise.
 * Used to distinguish "agents idle" (system healthy) from "system down" (true P0).
 */
function isDashboardAlive() {
  return new Promise((resolve) => {
    const reqOpts = { timeout: DASHBOARD_TIMEOUT_MS };
    if (API_KEY) reqOpts.headers = { Authorization: `Bearer ${API_KEY}` };
    const req = http.get(DASHBOARD_URL, reqOpts, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
      res.resume(); // consume body
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── Agent Discovery ────────────────────────────────────────────────────────────

function discoverAgents() {
  try {
    return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    console.error(`[heartbeat_monitor] Cannot read agents dir: ${err.message}`);
    return [];
  }
}

// ── Heartbeat Check ────────────────────────────────────────────────────────────

async function checkHeartbeats() {
  const now = Date.now();
  const agents = discoverAgents();

  if (agents.length === 0) {
    console.warn('[heartbeat_monitor] No agents found in agents/');
    return;
  }

  const results = agents.map((agentName) => {
    const hbPath = path.join(AGENTS_DIR, agentName, 'heartbeat.md');
    let alive = false;
    let lastBeatMs = null;
    let staleSec = null;
    let error = null;

    try {
      const stat = fs.statSync(hbPath);
      lastBeatMs = stat.mtimeMs;
      const ageMs = now - lastBeatMs;
      alive = ageMs < ALIVE_THRESHOLD_MS;
      staleSec = Math.round(ageMs / 1000);
    } catch (err) {
      error = err.code === 'ENOENT' ? 'no_heartbeat_file' : err.message;
    }

    return { name: agentName, alive, lastBeatMs, staleSec, error };
  });

  const aliveAgents = results.filter((r) => r.alive);
  const staleAgents = results.filter((r) => !r.alive);
  const aliveCount = aliveAgents.length;
  const totalCount = agents.length;
  const alivePct = totalCount > 0 ? aliveCount / totalCount : 0;

  const timestamp = isoNow();
  console.log(`[heartbeat_monitor] ${timestamp} alive=${aliveCount}/${totalCount} (${(alivePct * 100).toFixed(0)}%)`);

  if (aliveCount > 0) {
    staleAgents.forEach((a) => {
      if (a.staleSec !== null) {
        console.log(`  STALE: ${a.name} (${a.staleSec}s ago)`);
      } else {
        console.log(`  MISSING: ${a.name} (${a.error})`);
      }
    });
  }

  // ── ALT-005: 0 agents alive ──
  // Check dashboard liveness to distinguish "agents idle" from "system down"
  if (aliveCount === 0) {
    const dashboardUp = await isDashboardAlive();
    if (dashboardUp) {
      // Dashboard healthy — agents are idle/stopped, not a system failure
      // Downgrade to P2-Info to reduce alert noise; transitions handled by fireAlert
      fireAlert('ALT-005', 'P2-Info',
        `All ${totalCount} agents idle — dashboard healthy, no agents running`);
    } else {
      // Dashboard unreachable AND no agent heartbeats — true outage
      fireAlert('ALT-005', 'P0-Critical',
        `All ${totalCount} agents have stale heartbeats and dashboard is unreachable — system may be down`);
    }
    lowLivenessWindowCount++;
  } else {
    clearAlert('ALT-005');
  }

  // ── ALT-006: < 25% alive for sustained period ──
  if (aliveCount > 0 && alivePct < THRESHOLDS.alive_min_pct) {
    lowLivenessWindowCount++;
    if (lowLivenessWindowCount >= LOW_LIVENESS_WINDOWS_FOR_ALERT) {
      fireAlert('ALT-006', 'P1-High',
        `Only ${aliveCount}/${totalCount} agents alive (${(alivePct * 100).toFixed(0)}%) for > ${Math.round(lowLivenessWindowCount * INTERVAL_MS / 60000)} min`);
    }
  } else if (alivePct >= THRESHOLDS.alive_min_pct) {
    lowLivenessWindowCount = 0;
    clearAlert('ALT-006');
  }

  // ── Write status file ──
  const status = {
    timestamp,
    total_agents: totalCount,
    alive_count: aliveCount,
    stale_count: staleAgents.length,
    alive_pct: parseFloat((alivePct * 100).toFixed(1)),
    alive_threshold_ms: ALIVE_THRESHOLD_MS,
    agents: results.map((r) => ({
      name: r.name,
      alive: r.alive,
      stale_sec: r.staleSec,
      error: r.error ?? undefined,
    })),
    alerts_active: [...activeAlerts.keys()],
  };

  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + '\n');
  } catch (err) {
    console.error(`[heartbeat_monitor] Failed to write status file: ${err.message}`);
  }

  if (runOnce) process.exit(0);
}

// ── Main ───────────────────────────────────────────────────────────────────────

// Ensure output directory exists
fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });

loadExistingAlerts();
writeAlertsFile();

console.log(`[heartbeat_monitor] Starting — checking every ${INTERVAL_MS / 1000}s`);
console.log(`[heartbeat_monitor] Agents dir → ${AGENTS_DIR}`);
console.log(`[heartbeat_monitor] Status → ${STATUS_FILE}`);
console.log(`[heartbeat_monitor] Alive threshold: ${ALIVE_THRESHOLD_MS / 1000}s`);

// Run immediately, then on interval
checkHeartbeats().catch((err) => console.error('[heartbeat_monitor] checkHeartbeats error:', err));

if (!runOnce) {
  setInterval(
    () => checkHeartbeats().catch((err) => console.error('[heartbeat_monitor] checkHeartbeats error:', err)),
    INTERVAL_MS
  );
}
