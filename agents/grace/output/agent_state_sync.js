/**
 * agent_state_sync.js — File-to-Database State Sync Pipeline
 *
 * Author: Grace (Data Engineer) — self-directed, 2026-03-30
 *
 * WHAT IT DOES:
 *   Reads file-based agent state (heartbeat.md, status.md, task_board.md,
 *   chat_inbox/) and syncs it to the Tokenfly PostgreSQL schema (Pat's
 *   migration_002). Falls back to JSON snapshots when DB is unavailable.
 *
 * THREE SYNC MODES:
 *   1. agents — heartbeat → agents.current_status + agents.last_heartbeat
 *   2. tasks  — task_board.md → tasks table (upsert by id)
 *   3. audit  — inbox message files → audit_log (new rows only)
 *
 * RUN ONCE:
 *   node agent_state_sync.js --sync all
 *   node agent_state_sync.js --sync agents
 *   node agent_state_sync.js --sync tasks
 *   node agent_state_sync.js --sync audit
 *
 * RUN AS DAEMON (watch mode):
 *   node agent_state_sync.js --watch --interval 60
 *
 * SNAPSHOT MODE (no DB required — writes JSON to /tmp/aicompany_snapshots/):
 *   node agent_state_sync.js --snapshot
 *
 * ENVIRONMENT:
 *   PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD (same as metrics_pg_writer)
 *   AICOMPANY_ROOT — path to aicompany/ directory (default: auto-detected)
 *   SYNC_DRY_RUN=1 — print what would be written, don't execute
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = process.env.AICOMPANY_ROOT ||
  path.resolve(__dirname, "../../..");

const AGENTS = [
  "alice","bob","charlie","dave","eve","frank","grace",
  "heidi","ivan","judy","karl","liam","mia","nick",
  "olivia","pat","quinn","rosa","sam","tina"
];

const PG_CONFIG = {
  host:     process.env.PG_HOST     || "localhost",
  port:     parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "tokenfly",
  user:     process.env.PG_USER     || "tokenfly",
  password: process.env.PG_PASSWORD,
};

const DRY_RUN = process.env.SYNC_DRY_RUN === "1";

// ─── Utility ──────────────────────────────────────────────────────────────────

function readFileSafe(filepath) {
  try { return fs.readFileSync(filepath, "utf8"); }
  catch { return null; }
}

function agentDir(name) {
  return path.join(ROOT, "agents", name);
}

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

// ─── Agent State Reader ───────────────────────────────────────────────────────

/**
 * Reads heartbeat.md for one agent and extracts:
 *   - status: "running" | "idle" | "offline"
 *   - lastHeartbeat: Date | null
 *   - staleMins: minutes since last heartbeat (null if none)
 */
function readAgentHeartbeat(name) {
  const hbPath = path.join(agentDir(name), "heartbeat.md");
  const raw = readFileSafe(hbPath);
  if (!raw) return { name, status: "offline", lastHeartbeat: null, staleMins: null };

  // Expect first line to be an ISO timestamp (from `date -u +%Y-%m-%dT%H:%MZ`)
  const firstLine = raw.trim().split("\n")[0].trim();
  let lastHeartbeat = null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(firstLine)) {
    lastHeartbeat = new Date(firstLine);
  }

  // Parse explicit "Status:" line if present
  const statusMatch = raw.match(/Status:\s*(running|idle|offline)/i);
  let fileStatus = statusMatch ? statusMatch[1].toLowerCase() : "running";

  // Override with stale detection (>15 min = offline from pipeline perspective)
  let staleMins = null;
  if (lastHeartbeat && !isNaN(lastHeartbeat)) {
    staleMins = Math.round((Date.now() - lastHeartbeat.getTime()) / 60000);
    if (staleMins > 15) fileStatus = "offline";
  } else {
    fileStatus = "offline";
  }

  return { name, status: fileStatus, lastHeartbeat, staleMins };
}

/**
 * Reads all agents and returns array of heartbeat snapshots.
 */
function readAllAgentStates() {
  return AGENTS.map(readAgentHeartbeat);
}

// ─── Task Board Reader ────────────────────────────────────────────────────────

/**
 * Parses task_board.md markdown table into array of task objects.
 * Handles pipe characters in description by capping at expected column count.
 *
 * Expected columns: id | title | description | priority | assignee | status | created_at | due_at | notes
 */
function parseTaskBoard() {
  const tbPath = path.join(ROOT, "public", "task_board.md");
  const raw = readFileSafe(tbPath);
  if (!raw) return [];

  const tasks = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map(c => c.trim());
    // cols[0] empty, cols[1..N], cols[last] empty
    // Row starts with a numeric id
    if (!cols[1] || !/^\d+$/.test(cols[1])) continue;

    const [, id, title, description, priority, assignee, status,
           created_at, due_at, ...rest] = cols;
    const notes = rest.slice(0, -1).join("|"); // everything before trailing empty col

    tasks.push({
      id:          parseInt(id, 10),
      title:       title       || "",
      description: description || "",
      priority:    priority    || "medium",
      assignee:    assignee    || null,
      status:      status      || "open",
      created_at:  created_at  || null,
      due_at:      due_at      || null,
      notes:       notes       || "",
    });
  }
  return tasks;
}

// ─── Inbox Audit Reader ───────────────────────────────────────────────────────

/**
 * Scans all agents' chat_inbox/ for unread messages (not prefixed with "read_").
 * Returns audit_log candidate rows.
 */
function readInboxAuditEvents() {
  const events = [];
  for (const name of AGENTS) {
    const inboxDir = path.join(agentDir(name), "chat_inbox");
    let files;
    try { files = fs.readdirSync(inboxDir); }
    catch { continue; }

    for (const f of files) {
      if (f.startsWith("read_")) continue;
      // Extract sender from filename: YYYY_MM_DD_HH_MM_SS_from_<sender>.md
      const m = f.match(/^(\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2})_from_(\w+)\.md$/);
      if (!m) continue;

      const ts = m[1].replace(/(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/,
                               "$1-$2-$3T$4:$5:$6Z");
      events.push({
        action:       "message_sent",
        actor_name:   m[2],
        entity_type:  "agent",
        entity_id:    name,
        created_at:   ts,
        details:      { file: f, recipient: name, sender: m[2] },
      });
    }
  }
  return events;
}

// ─── Snapshot Mode (no DB) ────────────────────────────────────────────────────

function writeSnapshot() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const agents = readAllAgentStates();
  const tasks  = parseTaskBoard();
  const audit  = readInboxAuditEvents();

  const snapshot = {
    generated_at: new Date().toISOString(),
    agents: {
      total: agents.length,
      running: agents.filter(a => a.status === "running").length,
      idle:    agents.filter(a => a.status === "idle").length,
      offline: agents.filter(a => a.status === "offline").length,
      rows: agents,
    },
    tasks: {
      total: tasks.length,
      open:        tasks.filter(t => t.status === "open").length,
      in_progress: tasks.filter(t => t.status === "in_progress").length,
      done:        tasks.filter(t => t.status === "done").length,
      blocked:     tasks.filter(t => t.status === "blocked").length,
      rows: tasks,
    },
    audit_events_pending: audit.length,
    audit_sample: audit.slice(0, 5),
  };

  const snapshotDir = "/tmp/aicompany_snapshots";
  // ASS-002: restrict permissions — snapshots contain sensitive agent/task data
  if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });

  // Cleanup snapshots older than 24 hours (SEC-015)
  const maxAgeMs = 24 * 60 * 60 * 1000;
  try {
    for (const f of fs.readdirSync(snapshotDir)) {
      if (!f.startsWith("state_snapshot_")) continue;
      const fp = path.join(snapshotDir, f);
      const age = Date.now() - fs.statSync(fp).mtimeMs;
      if (age > maxAgeMs) { fs.unlinkSync(fp); log(`Cleaned up old snapshot: ${f}`); }
    }
  } catch (e) { log(`WARN: snapshot cleanup failed: ${e.message}`); }

  const outFile = path.join(snapshotDir, `state_snapshot_${ts}.json`);
  if (DRY_RUN) {
    log(`[DRY RUN] Would write snapshot to ${outFile}`);
    log(JSON.stringify(snapshot, null, 2).slice(0, 2000));
    return snapshot;
  }

  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
  log(`Snapshot written → ${outFile}`);
  log(`  Agents: ${snapshot.agents.running} running, ${snapshot.agents.idle} idle, ${snapshot.agents.offline} offline`);
  log(`  Tasks:  ${snapshot.tasks.total} total (${snapshot.tasks.open} open, ${snapshot.tasks.in_progress} in_progress, ${snapshot.tasks.done} done)`);
  log(`  Audit events pending: ${snapshot.audit_events_pending}`);
  return snapshot;
}

// ─── PostgreSQL Sync ──────────────────────────────────────────────────────────

let pgPool = null;

async function getPgPool() {
  if (pgPool) return pgPool;
  if (!process.env.PG_PASSWORD) {
    throw new Error("PG_PASSWORD environment variable is required (CWE-259: no hardcoded credentials). Set PG_PASSWORD before running.");
  }
  let pg;
  try {
    pg = require("pg");
  } catch {
    throw new Error("pg package not installed. Run: npm install pg");
  }
  pgPool = new pg.Pool(PG_CONFIG);
  pgPool.on("error", (err) => log(`PG pool error: ${err.message}`));
  return pgPool;
}

async function syncAgents() {
  const states = readAllAgentStates();
  const pool = await getPgPool();

  // Map file status → pg agent_status enum
  const toEnum = s => ({ running: "running", idle: "idle", offline: "offline" }[s] || "offline");

  let synced = 0;
  for (const a of states) {
    if (DRY_RUN) {
      log(`[DRY RUN] UPDATE agents SET current_status='${toEnum(a.status)}', last_heartbeat='${a.lastHeartbeat?.toISOString()}' WHERE name='${a.name}'`);
      synced++;
      continue;
    }
    const res = await pool.query(
      `UPDATE agents
          SET current_status = $1, last_heartbeat = $2, updated_at = now()
        WHERE name = $3`,
      [toEnum(a.status), a.lastHeartbeat, a.name]
    );
    if (res.rowCount === 0) {
      log(`WARN: agent '${a.name}' not found in DB (run migration_001 first)`);
    }
    synced++;
  }
  log(`syncAgents: ${synced}/${states.length} rows updated`);
}

async function syncTasks() {
  const tasks = parseTaskBoard();
  if (!tasks.length) { log("syncTasks: task board empty or unreadable"); return; }

  const pool = await getPgPool();

  // Resolve assignee names to UUIDs
  const agentRows = await pool.query("SELECT id, name FROM agents");
  const nameToId  = Object.fromEntries(agentRows.rows.map(r => [r.name, r.id]));

  // Valid enums (from Pat's schema)
  const validPriority = new Set(["low","medium","high","critical"]);
  const validStatus   = new Set(["open","in_progress","done","blocked","cancelled"]);

  let upserted = 0, skipped = 0;
  for (const t of tasks) {
    const priority   = validPriority.has(t.priority) ? t.priority : "medium";
    const status     = validStatus.has(t.status)     ? t.status   : "open";
    const assigneeId = t.assignee ? (nameToId[t.assignee] || null) : null;
    const dueAt      = t.due_at   || null;
    const createdAt  = t.created_at ? new Date(t.created_at) : new Date();

    if (DRY_RUN) {
      log(`[DRY RUN] UPSERT task id=${t.id} title="${t.title.slice(0,40)}" status=${status}`);
      upserted++;
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO tasks (id, title, description, priority, status, assignee_id, due_at, created_at, updated_at)
              VALUES ($1, $2, $3, $4::task_priority, $5::task_status, $6, $7, $8, now())
         ON CONFLICT (id) DO UPDATE
              SET title = EXCLUDED.title,
                  description = EXCLUDED.description,
                  priority = EXCLUDED.priority,
                  status = EXCLUDED.status,
                  assignee_id = EXCLUDED.assignee_id,
                  due_at = EXCLUDED.due_at,
                  updated_at = now()`,
        [t.id, t.title, t.description, priority, status, assigneeId, dueAt, createdAt]
      );
      upserted++;
    } catch (err) {
      log(`WARN: failed to upsert task ${t.id}: ${err.message}`);
      skipped++;
    }
  }
  log(`syncTasks: ${upserted} upserted, ${skipped} skipped (of ${tasks.length} parsed)`);
}

async function syncAudit() {
  const events = readInboxAuditEvents();
  if (!events.length) { log("syncAudit: no pending inbox events"); return; }

  const pool = await getPgPool();

  // Resolve actor names to UUIDs
  const agentRows = await pool.query("SELECT id, name FROM agents");
  const nameToId  = Object.fromEntries(agentRows.rows.map(r => [r.name, r.id]));

  let inserted = 0;
  for (const e of events) {
    const actorId = nameToId[e.actor_name] || null;
    if (DRY_RUN) {
      log(`[DRY RUN] INSERT audit_log actor=${e.actor_name} action=${e.action} entity=${e.entity_id}`);
      inserted++;
      continue;
    }
    try {
      await pool.query(
        `INSERT INTO audit_log (actor_id, actor_type, action, entity_type, entity_id, details, created_at)
              VALUES ($1, 'agent', $2, $3, $4, $5, $6)`,
        [actorId, e.action, e.entity_type, e.entity_id, JSON.stringify(e.details), e.created_at]
      );
      inserted++;
    } catch (err) {
      log(`WARN: audit insert failed: ${err.message}`);
    }
  }
  log(`syncAudit: ${inserted} events inserted`);
}

async function syncAll() {
  await syncAgents();
  await syncTasks();
  await syncAudit();
}

// ─── Watch Mode ───────────────────────────────────────────────────────────────

function watchMode(intervalSec, syncFn) {
  log(`Watch mode: syncing every ${intervalSec}s`);
  syncFn().catch(e => log(`Sync error: ${e.message}`));
  setInterval(() => {
    syncFn().catch(e => log(`Sync error: ${e.message}`));
  }, intervalSec * 1000);
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--snapshot")) {
    writeSnapshot();
    return;
  }

  if (args.includes("--watch")) {
    const intervalIdx = args.indexOf("--interval");
    let intervalSec = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : 60;
    // ASS-001: guard against NaN (non-numeric --interval) → DoS via ~1ms loop
    if (!Number.isFinite(intervalSec) || intervalSec < 5) {
      log(`WARN: invalid --interval value; defaulting to 60s (minimum 5s)`);
      intervalSec = 60;
    }
    const syncType    = args[args.indexOf("--sync") + 1] || "all";
    const syncFnMap   = { all: syncAll, agents: syncAgents, tasks: syncTasks, audit: syncAudit };
    const fn = syncFnMap[syncType] || syncAll;
    watchMode(intervalSec, fn);
    return;
  }

  // One-shot sync
  const syncIdx  = args.indexOf("--sync");
  const syncType = syncIdx >= 0 ? args[syncIdx + 1] : "all";

  let pg_ok = true;
  try { await getPgPool(); }
  catch (e) {
    log(`WARN: DB unavailable (${e.message}). Falling back to --snapshot mode.`);
    pg_ok = false;
  }

  if (!pg_ok) {
    writeSnapshot();
    return;
  }

  const syncFnMap = { all: syncAll, agents: syncAgents, tasks: syncTasks, audit: syncAudit };
  const fn = syncFnMap[syncType];
  if (!fn) {
    console.error(`Unknown sync type: ${syncType}. Use: all | agents | tasks | audit`);
    process.exit(1);
  }

  try {
    await fn();
  } finally {
    if (pgPool) await pgPool.end();
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

module.exports = { readAllAgentStates, parseTaskBoard, readInboxAuditEvents, writeSnapshot };
