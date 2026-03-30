#!/usr/bin/env node
/**
 * AI Company Dashboard Server
 * Zero-dependency Node.js HTTP server.
 * Usage: node server.js [--port 3100] [--dir /path/to/company]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");

// Bob's backend API module — rate limiting, validation, metrics (Task #4)
const { middleware: apiMiddleware, metrics: apiMetrics } = require("./agents/bob/output/backend-api-module");
// Bob's agent metrics sub-routes: /api/metrics/agents, /api/metrics/tasks, /api/metrics/health
const { handleMetricsRequest: handleAgentMetricsRequest } = require("./agents/bob/output/agent_metrics_api");
// Bob's SQLite message bus — Task #102
const { initMessageBus, handleMessageBus } = require("./backend/message_bus");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const PORT = parseInt(flag("--port", "3100"), 10);
const DIR = path.resolve(flag("--dir", __dirname));

const EMPLOYEES_DIR = path.join(DIR, "agents");
const PUBLIC_DIR = path.join(DIR, "public");
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Advisory file lock for task_board.md (prevents parallel-write corruption)
// ---------------------------------------------------------------------------
const TASK_LOCK_PATH = path.join(require("os").tmpdir(), "aicompany_taskboard.lock");
let _taskLockHolder = null;

function withTaskLock(fn) {
  // Spin-wait up to 2s for lock, 50ms intervals
  const deadline = Date.now() + 2000;
  function tryAcquire() {
    try {
      fs.writeFileSync(TASK_LOCK_PATH, String(process.pid), { flag: "wx" });
      _taskLockHolder = true;
      try { fn(); } finally {
        try { fs.unlinkSync(TASK_LOCK_PATH); } catch (_) {}
        _taskLockHolder = null;
      }
    } catch (e) {
      if (e.code === "EEXIST" && Date.now() < deadline) {
        setTimeout(tryAcquire, 50);
      } else {
        // Lock timeout or unexpected error — proceed without lock
        fn();
      }
    }
  }
  tryAcquire();
}

// ---------------------------------------------------------------------------
// Security constants & input helpers
// ---------------------------------------------------------------------------
const MAX_BODY_BYTES = 512 * 1024; // 512 KB — guard against memory exhaustion

// API key authentication (SEC-001, Heidi security audit)
// Set API_KEY env var to enable auth. If unset, auth is skipped (dev mode).
const API_KEY = process.env.API_KEY || "";

/**
 * Check API key auth for /api/* requests.
 * Accepts: Authorization: Bearer <key>  OR  X-API-Key: <key>
 * Returns true if the request is authorized (or if auth is disabled).
 */
function isAuthorized(req) {
  if (!API_KEY) return true; // auth disabled — no API_KEY set
  const authHeader = req.headers["authorization"] || "";
  const xApiKey = req.headers["x-api-key"] || "";
  const provided =
    authHeader.startsWith("Bearer ") ? authHeader.slice(7) : xApiKey;
  if (!provided) return false;
  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(provided.padEnd(API_KEY.length));
    const b = Buffer.from(API_KEY.padEnd(provided.length));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

/** Decode + validate an agent name from a URL segment. Returns null if unsafe. */
function agentName(encoded) {
  const n = decodeURIComponent(encoded);
  return /^[a-zA-Z0-9_-]+$/.test(n) ? n : null;
}

/** Sanitize a user-supplied "from" value for use in filenames. */
function sanitizeFrom(s) {
  return String(s || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------
const sseClients = new Set();
const lastPoll = new Map();

setInterval(() => {
  let changed = false;
  try {
    const agents = listAgentNames();
    for (const name of agents) {
      const hb = fileMtime(path.join(EMPLOYEES_DIR, name, "heartbeat.md"));
      const st = fileMtime(path.join(EMPLOYEES_DIR, name, "status.md"));
      const mtime = Math.max(hb || 0, st || 0);
      if (lastPoll.get(name) !== mtime) {
        lastPoll.set(name, mtime);
        changed = true;
      }
    }
  } catch (_) { /* ignore */ }
  if (changed) {
    for (const client of sseClients) {
      try { client.write("event: refresh\ndata: {}\n\n"); } catch (_) { sseClients.delete(client); }
    }
  }
}, 3000);

// ---------------------------------------------------------------------------
// Auto-watchdog: every 10 minutes, restart agents whose loop is stuck
// ---------------------------------------------------------------------------
const watchdogLog = [];
setInterval(() => {
  const STALE_MS = 15 * 60 * 1000;
  const names = [];
  try {
    const d = fs.readdirSync(path.join(__dirname, "agents")).filter((n) =>
      fs.statSync(path.join(__dirname, "agents", n)).isDirectory()
    );
    names.push(...d);
  } catch (_) { return; }
  names.forEach((name) => {
    execFile("pgrep", ["-f", `run_subset.sh ${name}`], {}, (err, stdout) => {
      if (!stdout.trim()) return; // not running
      const hbMtime = fileMtime(path.join(EMPLOYEES_DIR, name, "heartbeat.md"));
      const age = hbMtime ? Date.now() - hbMtime : null;
      if (age !== null && age > STALE_MS) {
        const stopScript = path.join(DIR, "stop_agent.sh");
        const startScript = path.join(DIR, "run_subset.sh");
        execFile("bash", [stopScript, name], { cwd: DIR }, () => {
          setTimeout(() => {
            const child = spawn("bash", [startScript, name], { cwd: DIR, detached: true, stdio: "ignore" });
            child.unref();
          }, 2000);
        });
        const entry = { ts: new Date().toISOString(), name, action: "restarted", heartbeat_age_ms: age };
        watchdogLog.unshift(entry);
        if (watchdogLog.length > 50) watchdogLog.length = 50;
        console.log(`[watchdog] Restarted stuck agent: ${name} (heartbeat age: ${Math.round(age/60000)}m)`);
      }
    });
  });
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function safeRead(p) {
  try { return fs.readFileSync(p, "utf8"); } catch (_) { return null; }
}

function fileMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch (_) { return null; }
}

function safeJson(p) {
  const raw = safeRead(p);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function listDir(p) {
  try { return fs.readdirSync(p); } catch (_) { return []; }
}

function listDirRecursive(dir, base) {
  base = base || dir;
  let results = [];
  for (const entry of listDir(dir)) {
    const full = path.join(dir, entry);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        results = results.concat(listDirRecursive(full, base));
      } else {
        results.push(path.relative(base, full));
      }
    } catch (_) { /* skip */ }
  }
  return results;
}

function listAgentNames() {
  return listDir(EMPLOYEES_DIR).filter((n) => {
    try { return fs.statSync(path.join(EMPLOYEES_DIR, n)).isDirectory(); } catch (_) { return false; }
  });
}

function todayStr() {
  const d = new Date();
  // Use local time to match run_agent.sh "date +%Y_%m_%d"
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}_${m}_${day}`;
}

function nowStamp() {
  const d = new Date();
  // Use local time to match shell date +%Y_%m_%d_%H_%M_%S
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}_${pad(d.getMonth()+1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.socket.destroy();
        return reject(Object.assign(new Error("request body too large"), { code: "BODY_TOO_LARGE" }));
      }
      body += chunk;
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch (_) { resolve({}); }
    });
  });
}

function json(res, data, status) {
  status = status || 200;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function notFound(res, msg) {
  json(res, { error: msg || "not found" }, 404);
}

function badRequest(res, msg) {
  json(res, { error: msg || "bad request" }, 400);
}

function cors(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
}

// ---------------------------------------------------------------------------
// Agent helpers
// ---------------------------------------------------------------------------
function getAgentStatus(name) {
  const d = path.join(EMPLOYEES_DIR, name);
  const hbRaw = safeRead(path.join(d, "heartbeat.md"));
  let status = "unknown";
  let heartbeat = null;
  let heartbeat_age_ms = null;
  if (hbRaw) {
    heartbeat = {};
    for (const line of hbRaw.split("\n")) {
      // Support both YAML-like "key: value" and markdown "- **key**: value"
      const m = line.match(/^(\w[\w\s]*?):\s*(.+)/) || line.match(/^[-*]\s*\*\*(\w[\w\s]*?)\*\*:\s*(.+)/);
      if (m) heartbeat[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = m[2].trim();
    }
    status = heartbeat.status || "unknown";
    const hbMtime = fileMtime(path.join(d, "heartbeat.md"));
    if (hbMtime) heartbeat_age_ms = Date.now() - hbMtime;
  }
  if (status !== "running") {
    const today = todayStr();
    const rawLog = path.join(d, "logs", `${today}_raw.log`);
    const mt = fileMtime(rawLog);
    if (mt && Date.now() - mt < 120000) {
      status = "running";
    }
  }
  return { status, heartbeat, heartbeat_age_ms };
}

// Build a name→role map from team_directory.md table rows (cached by file mtime)
let _roleMapCache = null;
let _roleMapMtime = 0;
function getRoleMap() {
  const p = path.join(PUBLIC_DIR, "team_directory.md");
  const mtime = fileMtime(p) || 0;
  if (_roleMapCache && mtime === _roleMapMtime) return _roleMapCache;
  const raw = safeRead(p) || "";
  const map = new Map();
  for (const line of raw.split("\n")) {
    const m = line.match(/^\|\s*\*{0,2}([A-Za-z][A-Za-z\s]+?)\*{0,2}\s*\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|/);
    if (m) {
      const n = m[1].trim().toLowerCase();
      const r = m[2].trim();
      if (n && r && r !== "role" && r !== "name") map.set(n, r);
    }
  }
  _roleMapCache = map;
  _roleMapMtime = mtime;
  return map;
}

function getAgentSummary(name) {
  const d = path.join(EMPLOYEES_DIR, name);
  const { status, heartbeat, heartbeat_age_ms } = getAgentStatus(name);
  const statusMd = safeRead(path.join(d, "status.md"));

  // Role from team directory
  const roleMap = getRoleMap();
  const role = roleMap.get(name.toLowerCase()) || "";

  // Extract current task from status.md
  let current_task = null;
  if (statusMd) {
    const m = statusMd.match(/##\s*Currently Working On\s*\n+([^\n#]+)/)
           || statusMd.match(/current.*?(?:task|focus)[:\s]+([^\n]+)/i);
    if (m) current_task = m[1].trim();
  }
  if (!current_task && heartbeat && heartbeat.task) current_task = heartbeat.task;

  // Extract cycle count from status.md
  let cycles = null;
  if (statusMd) {
    const m = statusMd.match(/##\s*Cycle Count\s*\n+(\d+)/i);
    if (m) cycles = parseInt(m[1], 10);
  }

  // Last-seen: use most recent raw log file (avoids midnight rollover miss)
  const logsDir = path.join(d, "logs");
  let rawLogMtime = null;
  let auth_error = false;
  try {
    const rawFiles = fs.existsSync(logsDir) ? fs.readdirSync(logsDir)
      .filter(f => f.endsWith("_raw.log")).sort().reverse() : [];
    if (rawFiles.length) {
      const rPath = path.join(logsDir, rawFiles[0]);
      rawLogMtime = fileMtime(rPath);
      // Check last context for auth errors
      const ctx = safeRead(path.join(d, "last_context.md")) || "";
      if (/not logged in|please run \/login|authentication_failed/i.test(ctx.slice(0, 500))) {
        auth_error = true;
      }
    }
  } catch (_) {}
  const last_update = rawLogMtime ? new Date(rawLogMtime).toISOString() : null;
  const lastSeenSecs = rawLogMtime ? Math.floor((Date.now() - rawLogMtime) / 1000) : null;

  return { name, role, status, current_task, cycles, last_update, lastSeenSecs, heartbeat_age_ms, auth_error };
}

// ---------------------------------------------------------------------------
// Agent Health Scoring (Ivan's v2 model — heartbeat×25 + activity×25 + status×20 + velocity×20 + recency×10)
// ---------------------------------------------------------------------------
function computeAgentHealth(agent, velocityData) {
  const now = Date.now();
  const dimensions = {};

  // Heartbeat (25 pts)
  const hbAgeMin = (agent.heartbeat_age_ms || 0) / 60000;
  const alive = agent.alive;
  if (alive && hbAgeMin < 5)       dimensions.heartbeat = { score: 25, detail: `alive (${Math.round(hbAgeMin)}m ago)` };
  else if (alive && hbAgeMin < 15) dimensions.heartbeat = { score: 22, detail: `alive but slow (${Math.round(hbAgeMin)}m ago)` };
  else if (alive && hbAgeMin < 60) dimensions.heartbeat = { score: 18, detail: `stale (${Math.round(hbAgeMin)}m ago)` };
  else if (alive)                  dimensions.heartbeat = { score: 10, detail: `very stale (${Math.round(hbAgeMin / 60)}h ago)` };
  else if (/running|starting/.test((agent.status || "").toLowerCase()))
                                   dimensions.heartbeat = { score: 15, detail: `status=${agent.status}, no heartbeat` };
  else                             dimensions.heartbeat = { score: 5,  detail: "offline/unknown" };

  // Activity (25 pts) — inbox backlog
  const inbox = agent.unread_messages || 0;
  if (inbox === 0)       dimensions.activity = { score: 25, detail: "inbox clear" };
  else if (inbox <= 2)   dimensions.activity = { score: 20, detail: `${inbox} unread (light backlog)` };
  else if (inbox <= 5)   dimensions.activity = { score: 15, detail: `${inbox} unread (moderate backlog)` };
  else if (inbox <= 10)  dimensions.activity = { score: 8,  detail: `${inbox} unread (high backlog)` };
  else                   dimensions.activity = { score: 3,  detail: `${inbox} unread (critical backlog)` };

  // Status (20 pts) — current task text
  const combined = ((agent.current_task || "") + " " + (agent.status || "")).toLowerCase();
  if (/done|complet|delivered|pass/.test(combined))          dimensions.status = { score: 18, detail: "recently completed" };
  else if (/working|building|implement|fixing|running/.test(combined)) dimensions.status = { score: 20, detail: "actively working" };
  else if (/idle|waiting/.test(combined) || !agent.current_task)       dimensions.status = { score: 10, detail: "idle/waiting" };
  else if (/blocked|error|fail/.test(combined))              dimensions.status = { score: 5,  detail: "blocked/error state" };
  else                                                       dimensions.status = { score: 14, detail: (agent.current_task || "").slice(0, 50) };

  // Velocity (20 pts) — tasks done in last 3 days
  const v = velocityData[(agent.name || "").toLowerCase()];
  if (!v)                           dimensions.velocity = { score: 10, detail: "no task board data (neutral)" };
  else if (v.recentDone === 0 && v.done === 0) dimensions.velocity = { score: 5, detail: "assigned tasks, 0 completed" };
  else if (v.recentDone === 0)      dimensions.velocity = { score: 8,  detail: `${v.done} total done (0 in last 3d)` };
  else if (v.recentDone >= 3)       dimensions.velocity = { score: 20, detail: `${v.recentDone} tasks done in last 3d` };
  else if (v.recentDone >= 2)       dimensions.velocity = { score: 16, detail: `${v.recentDone} tasks done in last 3d` };
  else                              dimensions.velocity = { score: 12, detail: `${v.recentDone} task done in last 3d` };

  // Recency (10 pts) — last_update age
  let recencyScore = 10, recencyDetail = "recent";
  if (agent.last_update) {
    const ageH = (now - new Date(agent.last_update).getTime()) / 3600000;
    if (ageH > 24)      { recencyScore = 5; recencyDetail = `last seen ${Math.round(ageH)}h ago`; }
    else if (ageH > 4)  { recencyScore = 8; recencyDetail = `last seen ${Math.round(ageH)}h ago`; }
    else                { recencyScore = 10; recencyDetail = `last seen ${Math.round(ageH * 60)}m ago`; }
  }
  dimensions.recency = { score: recencyScore, detail: recencyDetail };

  const total = Object.values(dimensions).reduce((s, d) => s + d.score, 0);
  const grade = total >= 90 ? "A" : total >= 75 ? "B" : total >= 55 ? "C" : "D";
  return { name: agent.name, score: total, grade, dimensions };
}

function buildVelocityData() {
  const velocity = {};
  const cutoff = new Date(Date.now() - 3 * 24 * 3600000).toISOString().slice(0, 10);
  const tasks = parseTaskBoard();
  for (const t of tasks) {
    const ag = (t.assignee || "").toLowerCase();
    if (!ag) continue;
    if (!velocity[ag]) velocity[ag] = { done: 0, inProgress: 0, total: 0, recentDone: 0 };
    velocity[ag].total++;
    const st = (t.status || "").toLowerCase();
    if (["done", "in_review", "in_progress"].includes(st)) velocity[ag].inProgress++;
    if (st === "done" || st === "in_review") {
      velocity[ag].done++;
      if ((t.updated || "").trim() >= cutoff) velocity[ag].recentDone++;
    }
  }
  return velocity;
}

// ---------------------------------------------------------------------------
// Stats cache
// ---------------------------------------------------------------------------
const _statsCache = new Map();

function getDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}_${m}_${day}`;
}

function getAgentCostFromLogs(name, days = 7) {
  const cacheKey = `${name}_${days}`;
  const cached = _statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60000) return cached.data;

  const data = { totalCost: 0, cycles: 0, dailyCosts: {}, dailyCycles: {} };

  try {
    for (let i = 0; i < days; i++) {
      const dateStr = getDateStr(i);
      const cleanLogPath = path.join(EMPLOYEES_DIR, name, "logs", `${dateStr}.log`);
      const text = safeRead(cleanLogPath) || "";
      let dayCost = 0, dayCycles = 0;
      for (const line of text.split("\n")) {
        const costMatch = line.match(/\[DONE\].*cost=\$?([\d.]+)/i);
        if (costMatch) dayCost += parseFloat(costMatch[1]) || 0;
        if (/CYCLE\s*START/i.test(line)) dayCycles++;
      }
      data.totalCost += dayCost;
      data.cycles += dayCycles;
      if (dayCost > 0 || dayCycles > 0) {
        data.dailyCosts[dateStr] = Math.round(dayCost * 100) / 100;
        data.dailyCycles[dateStr] = dayCycles;
      }
    }
    data.totalCost = Math.round(data.totalCost * 100) / 100;
  } catch (_) { /* no log */ }

  _statsCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------------------
// Task board parsing
// ---------------------------------------------------------------------------
function parseTaskBoard() {
  const raw = safeRead(path.join(PUBLIC_DIR, "task_board.md"));
  if (!raw) return [];
  const lines = raw.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return [];
  // First line is header, second is separator
  // Use slice(1,-1) instead of filter(Boolean) to preserve empty cells (e.g. empty description)
  const header = lines[0].split("|").slice(1, -1).map((c) => c.trim().toLowerCase().replace(/\s+/g, "_"));
  const tasks = [];
  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split("|").slice(1, -1).map((c) => c.trim());
    if (cols.length < 2) continue;
    const task = {};
    for (let j = 0; j < header.length; j++) {
      task[header[j]] = cols[j] || "";
    }
    tasks.push(task);
  }
  return tasks;
}

function archiveDoneTasks() {
  const tbPath = path.join(PUBLIC_DIR, "task_board.md");
  const archivePath = path.join(PUBLIC_DIR, "task_board_archive.md");
  const tasks = parseTaskBoard();
  const done = tasks.filter((t) => (t.status || "").toLowerCase() === "done");
  const active = tasks.filter((t) => (t.status || "").toLowerCase() !== "done");
  if (!done.length) return 0;
  // Append done rows to archive
  const header = "| ID | Title | Description | Priority | Assignee | Status | Created | Updated | Notes |";
  const sep = "|----|-------|-------------|----------|----------|--------|---------|---------|-------|";
  if (!fs.existsSync(archivePath)) {
    fs.writeFileSync(archivePath, `# Task Board Archive\n\n## Archived Tasks\n${header}\n${sep}\n`);
  }
  const doneRows = done.map((t) =>
    `| ${t.id} | ${t.title} | ${t.description} | ${t.priority} | ${t.assignee} | ${t.status} | ${t.created} | ${t.updated} | ${t.notes || ""} |`
  ).join("\n");
  fs.appendFileSync(archivePath, doneRows + "\n");
  // Rewrite board with only active rows
  const activeRows = active.map((t) =>
    `| ${t.id} | ${t.title} | ${t.description} | ${t.priority} | ${t.assignee} | ${t.status} | ${t.created} | ${t.updated} | ${t.notes || ""} |`
  ).join("\n");
  fs.writeFileSync(tbPath, `# Task Board\n\n## Tasks\n${header}\n${sep}\n${activeRows}\n`);
  return done.length;
}

function appendTaskRow(task) {
  let newId;
  withTaskLock(() => {
    const tbPath = path.join(PUBLIC_DIR, "task_board.md");
    const existing = parseTaskBoard();
    // Auto-archive done tasks when board exceeds 50 rows
    if (existing.length >= 50) archiveDoneTasks();
    const all = parseTaskBoard(); // re-read after potential archive
    const maxId = all.reduce((m, t) => Math.max(m, parseInt(t.id || t["#"] || "0", 10) || 0), 0);
    newId = maxId + 1;
    const now = new Date().toISOString().slice(0, 10);
    const row = `| ${newId} | ${task.title || ""} | ${task.description || ""} | ${task.priority || "medium"} | ${task.assignee || ""} | open | ${now} | ${now} | ${task.notes || ""} |`;
    const existing_raw = safeRead(tbPath) || "";
    const sep = existing_raw.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(tbPath, sep + row + "\n");
  });
  return newId;
}

function updateTaskRow(id, updates) {
  let found = false;
  withTaskLock(() => {
    const tbPath = path.join(PUBLIC_DIR, "task_board.md");
    const raw = safeRead(tbPath);
    if (!raw) return;
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().startsWith("|")) continue;
      const cols = lines[i].split("|").slice(1, -1).map((c) => c.trim());
      if (cols.length < 2) continue;
      if (String(cols[0]).trim() === String(id)) {
        // Rebuild the row preserving columns order: id, title, description, priority, assignee, status, created, updated
        if (updates.status !== undefined) cols[5] = String(updates.status).toLowerCase();
        if (updates.assignee !== undefined) cols[4] = String(updates.assignee).toLowerCase();
        if (updates.priority !== undefined) cols[3] = String(updates.priority).toLowerCase();
        if (updates.title !== undefined) cols[1] = updates.title;
        if (updates.notes !== undefined) {
          // Append note (timestamped), never replace
          const newNote = "[" + new Date().toISOString().slice(0, 10) + "] " + String(updates.notes).trim().replace(/;;/g, "--").replace(/\|/g, "-");
          cols[8] = cols[8] ? cols[8] + " ;; " + newNote : newNote;
        }
        cols[7] = new Date().toISOString().slice(0, 10); // updated
        lines[i] = "| " + cols.join(" | ") + " |";
        found = true;
        break;
      }
    }
    if (found) fs.writeFileSync(tbPath, lines.join("\n"));
  });
  return found;
}

// ---------------------------------------------------------------------------
// Org chart parser
// ---------------------------------------------------------------------------
function parseOrgChart() {
  const raw = safeRead(path.join(PUBLIC_DIR, "team_directory.md"));
  if (!raw) return [];
  const entries = [];
  let current = null;
  for (const line of raw.split("\n")) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      if (current) entries.push(current);
      current = { name: heading[1].trim(), role: null, reports_to: null, children: [] };
      continue;
    }
    if (!current) continue;
    const roleM = line.match(/role[:\s]*(.+)/i);
    if (roleM) current.role = roleM[1].trim();
    const repM = line.match(/reports?\s*to[:\s]*(.+)/i);
    if (repM) current.reports_to = repM[1].trim();
  }
  if (current) entries.push(current);

  // Build hierarchy
  const map = new Map();
  for (const e of entries) map.set(e.name.toLowerCase(), e);
  const roots = [];
  for (const e of entries) {
    if (e.reports_to) {
      const parent = map.get(e.reports_to.toLowerCase());
      if (parent) { parent.children.push(e); continue; }
    }
    roots.push(e);
  }
  return roots.length ? roots : entries;
}

// ---------------------------------------------------------------------------
// Log parser
// ---------------------------------------------------------------------------
function parseRawLog(name) {
  // Find the most recent raw log file
  const logsDir = path.join(EMPLOYEES_DIR, name, "logs");
  let logPath = null;
  try {
    const files = fs.existsSync(logsDir) ? fs.readdirSync(logsDir)
      .filter(f => f.endsWith("_raw.log"))
      .sort().reverse() : [];
    if (files.length > 0) logPath = path.join(logsDir, files[0]);
  } catch (_) {}
  if (!logPath) return [];
  try {
    const stat = fs.statSync(logPath);
    const readSize = Math.min(stat.size, 500000);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(logPath, "r");
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    const entries = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let type = "info";
      let timestamp = null;
      const tsMatch = line.match(/^[\[(]?(\d{4}[-_]\d{2}[-_]\d{2}[T\s_]\d{2}[:\-_]\d{2}[:\-_]\d{2})/);
      if (tsMatch) timestamp = tsMatch[1];
      if (/error/i.test(line)) type = "error";
      else if (/warn/i.test(line)) type = "warning";
      else if (/CYCLE/i.test(line)) type = "cycle";
      else if (/TOOL|tool_use/i.test(line)) type = "tool";
      else if (/cost|token/i.test(line)) type = "cost";
      entries.push({ type, content: line, timestamp });
    }
    return entries;
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Digest parser
// ---------------------------------------------------------------------------
function getDigest() {
  const today = todayStr();
  const agents = listAgentNames();
  const digest = [];
  for (const name of agents) {
    const cleanLog = path.join(EMPLOYEES_DIR, name, "logs", `${today}.log`);
    const raw = safeRead(cleanLog);
    if (!raw) continue;
    const cycles = [];
    let currentCycle = null;
    for (const line of raw.split("\n")) {
      if (/CYCLE\s*START/i.test(line)) {
        currentCycle = { start: line.trim(), tasks: [] };
      } else if (/CYCLE\s*END/i.test(line)) {
        if (currentCycle) { currentCycle.end = line.trim(); cycles.push(currentCycle); }
        currentCycle = null;
      } else if (/DONE/i.test(line) && currentCycle) {
        currentCycle.tasks.push(line.trim());
      }
    }
    if (cycles.length || currentCycle) {
      digest.push({ agent: name, completedCycles: cycles.length, activeCycle: !!currentCycle, cycles });
    }
  }
  return digest;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
async function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;
  const method = req.method;

  // Bob's middleware: handles CORS preflight + rate limiting on /api/* routes
  if (apiMiddleware(req, res, pathname, method)) return;

  // SEC-001: API key authentication for all /api/* routes
  if (pathname.startsWith("/api/") && !isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }

  // Serve index_lite.html for GET /
  if (method === "GET" && pathname === "/") {
    const html = safeRead(path.join(DIR, "index_lite.html"));
    if (!html) return notFound(res, "index_lite.html not found");
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Access-Control-Allow-Origin": "*",
    });
    return res.end(html);
  }

  // Serve PWA manifest
  if (method === "GET" && pathname === "/manifest.json") {
    const manifest = {
      name: "Tokenfly Agent Lab",
      short_name: "Tokenfly",
      description: "Real-time dashboard for the Tokenfly AI agent team",
      start_url: "/",
      display: "standalone",
      background_color: "#1a1a2e",
      theme_color: "#7c3aed",
      icons: [
        { src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>", sizes: "any", type: "image/svg+xml" }
      ]
    };
    res.writeHead(200, { "Content-Type": "application/manifest+json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(manifest));
  }

  // ---- Core ----
  if (method === "GET" && pathname === "/api/health") {
    const mem = process.memoryUsage();
    return json(res, {
      status: "ok",
      uptime_ms: Date.now() - startTime,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      activeAgents: listAgentNames().filter((n) => getAgentStatus(n).status === "running").length,
      sseClients: sseClients.size,
    });
  }

  if (method === "GET" && pathname === "/api/config") {
    const companyMd = safeRead(path.join(DIR, "company.md"));
    let companyName = "AI Company";
    if (companyMd) {
      const m = companyMd.match(/^#\s+(.+)/m);
      if (m) companyName = m[1].trim();
    }
    return json(res, { companyName, directory: DIR });
  }

  if (method === "GET" && pathname === "/api/dashboard") {
    const agents = listAgentNames().map(getAgentSummary);
    const tasks = parseTaskBoard();
    const modeMd = safeRead(path.join(PUBLIC_DIR, "company_mode.md")) || "";
    const modeMatch = modeMd.match(/##\s*Current Mode\s*\n\*\*(\w+)\*\*/i);
    const mode = modeMatch ? modeMatch[1].toLowerCase() : "normal";
    const activeCount = agents.filter((a) => a.status === "running").length;
    return json(res, { agents, tasks, mode, activeCount });
  }

  if (method === "GET" && pathname === "/api/search") {
    const q = (query.q || "").toLowerCase();
    if (!q) return badRequest(res, "missing q parameter");
    const results = [];
    for (const name of listAgentNames()) {
      const d = path.join(EMPLOYEES_DIR, name);
      for (const file of ["status.md", "todo.md"]) {
        const content = safeRead(path.join(d, file));
        if (content && content.toLowerCase().includes(q)) {
          const lines = content.split("\n").filter((l) => l.toLowerCase().includes(q));
          results.push({ agent: name, file, matches: lines.slice(0, 10) });
        }
      }
    }
    return json(res, { query: q, results });
  }

  // ---- Agents ----
  if (method === "GET" && pathname === "/api/agents") {
    const agentList = listAgentNames().map((name) => {
      const summary = getAgentSummary(name);
      const d = path.join(EMPLOYEES_DIR, name);
      const hbMtime = fileMtime(path.join(d, "heartbeat.md"));
      const alive = Boolean(hbMtime && Date.now() - hbMtime < 5 * 60 * 1000) || summary.status === "running";
      const inboxFiles = listDir(path.join(d, "chat_inbox")).filter((f) => !f.startsWith("read_") && f.endsWith(".md"));
      return { ...summary, alive, unread_messages: inboxFiles.length };
    });
    return json(res, agentList);
  }

  const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (method === "GET" && agentMatch) {
    const name = agentName(agentMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const { status, heartbeat } = getAgentStatus(name);
    const statusMd = safeRead(path.join(d, "status.md"));
    const persona = safeRead(path.join(d, "persona.md"));
    const todo = safeRead(path.join(d, "todo.md"));
    // Return metadata only — no content to prevent unauthenticated data exposure (QI-003)
    const inbox = listDir(path.join(d, "chat_inbox")).filter((f) => f.endsWith(".md")).map((f) => ({
      filename: f,
      read: f.startsWith("read_"),
    }));
    // Assigned tasks from task board
    const tasks = parseTaskBoard().filter(
      (t) => (t.assignee || "").toLowerCase() === name.toLowerCase()
    );
    return json(res, { name, status, heartbeat, statusMd, status_md: statusMd, persona, todo, inbox, tasks });
  }

  const agentLogMatch = pathname.match(/^\/api\/agents\/([^/]+)\/log$/);
  if (method === "GET" && agentLogMatch) {
    const name = agentName(agentLogMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    return json(res, parseRawLog(name));
  }

  // GET /api/agents/:name/log/stream — SSE live tail of /tmp/aicompany_runtime_logs/{name}.log
  const agentLogStreamMatch = pathname.match(/^\/api\/agents\/([^/]+)\/log\/stream$/);
  if (method === "GET" && agentLogStreamMatch) {
    const name = agentName(agentLogStreamMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");

    const logFile = path.join("/tmp/aicompany_runtime_logs", `${name}.log`);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("event: connected\ndata: {}\n\n");

    function sendLines(text) {
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          res.write("event: log\ndata: " + JSON.stringify(line) + "\n\n");
        }
      }
    }

    // Send last 20 KB as initial burst
    let offset = 0;
    try {
      const stat = fs.statSync(logFile);
      const TAIL_BYTES = 20 * 1024;
      const startPos = Math.max(0, stat.size - TAIL_BYTES);
      const readSize = stat.size - startPos;
      if (readSize > 0) {
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(logFile, "r");
        fs.readSync(fd, buf, 0, readSize, startPos);
        fs.closeSync(fd);
        sendLines(buf.toString("utf8"));
      }
      offset = stat.size;
    } catch (_) { offset = 0; }

    // Watch for new content (low-latency path)
    let watcher = null;
    try {
      watcher = fs.watch(path.dirname(logFile), (eventType, filename) => {
        if (filename !== `${name}.log`) return;
        try {
          const stat = fs.statSync(logFile);
          if (stat.size <= offset) return;
          const newBytes = stat.size - offset;
          const buf = Buffer.alloc(newBytes);
          const fd = fs.openSync(logFile, "r");
          fs.readSync(fd, buf, 0, newBytes, offset);
          fs.closeSync(fd);
          offset = stat.size;
          sendLines(buf.toString("utf8"));
        } catch (_) {}
      });
    } catch (_) {}

    // Polling fallback (1s) — handles fs.watch unreliability on macOS
    const pollInterval = setInterval(() => {
      try {
        const stat = fs.statSync(logFile);
        if (stat.size <= offset) return;
        const newBytes = stat.size - offset;
        const buf = Buffer.alloc(newBytes);
        const fd = fs.openSync(logFile, "r");
        fs.readSync(fd, buf, 0, newBytes, offset);
        fs.closeSync(fd);
        offset = stat.size;
        sendLines(buf.toString("utf8"));
      } catch (_) {}
    }, 1000);

    const keepalive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch (_) {}
    }, 15000);

    req.on("close", () => {
      clearInterval(pollInterval);
      clearInterval(keepalive);
      if (watcher) { try { watcher.close(); } catch (_) {} }
    });

    return;
  }

  const agentMsgMatch = pathname.match(/^\/api\/agents\/([^/]+)\/message$/);
  if (method === "POST" && agentMsgMatch) {
    const name = agentName(agentMsgMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const inboxDir = path.join(EMPLOYEES_DIR, name, "chat_inbox");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const body = await parseBody(req);
    if (!body.message || typeof body.message !== "string") return badRequest(res, "missing message");
    const from = sanitizeFrom(body.from || "dashboard");
    const filename = `${nowStamp()}_from_${from}.md`;
    try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    fs.writeFileSync(path.join(inboxDir, filename), body.message);
    return json(res, { ok: true, filename });
  }

  const agentStopMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
  if (method === "POST" && agentStopMatch) {
    const name = agentName(agentStopMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const script = path.join(DIR, "stop_agent.sh");
    if (!fs.existsSync(script)) return notFound(res, "stop_agent.sh not found");
    execFile("bash", [script, name], { cwd: DIR }, (err, stdout, stderr) => {
      if (err) return json(res, { ok: false, error: stderr || err.message }, 500);
      json(res, { ok: true, output: stdout });
    });
    return;
  }

  const agentPingMatch = pathname.match(/^\/api\/agents\/([^/]+)\/ping$/);
  if (method === "GET" && agentPingMatch) {
    const name = agentName(agentPingMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    // Check for run_subset.sh (loop process) OR run_agent.sh (active cycle)
    execFile("pgrep", ["-f", `run_subset.sh ${name}`], {}, (err1, stdout1) => {
      execFile("pgrep", ["-f", `run_agent.sh ${name}`], {}, (err2, stdout2) => {
        const loopPids = stdout1.trim().split("\n").filter(Boolean);
        const cyclePids = stdout2.trim().split("\n").filter(Boolean);
        const running = loopPids.length > 0;
        const inCycle = cyclePids.length > 0;
        json(res, { name, running, inCycle, pids: [...loopPids, ...cyclePids] });
      });
    });
    return;
  }

  const agentStartMatch = pathname.match(/^\/api\/agents\/([^/]+)\/start$/);
  if (method === "POST" && agentStartMatch) {
    const name = agentName(agentStartMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const script = path.join(DIR, "run_subset.sh");
    if (!fs.existsSync(script)) return notFound(res, "run_subset.sh not found");
    // Check if already running to avoid duplicates
    execFile("pgrep", ["-f", `run_subset.sh ${name}`], {}, (err, stdout) => {
      const existing = stdout.trim().split("\n").filter(Boolean);
      if (existing.length > 0) {
        return json(res, { ok: true, already_running: true, message: "Agent " + name + " is already running (PIDs: " + existing.join(",") + ")" });
      }
      // Fire-and-forget: run_subset.sh is a long-running loop
      const child = spawn("bash", [script, name], { cwd: DIR, detached: true, stdio: "ignore" });
      child.unref();
      json(res, { ok: true, already_running: false, message: "Agent " + name + " starting in background" });
    });
    return;
  }

  // ---- Bulk agent controls ----
  if (method === "POST" && pathname === "/api/agents/start-all") {
    const script = path.join(DIR, "run_all.sh");
    const child = spawn("bash", [script], { cwd: DIR, detached: true, stdio: "ignore" });
    child.unref();
    return json(res, { ok: true });
  }
  if (method === "POST" && pathname === "/api/agents/stop-all") {
    const script = path.join(DIR, "stop_all.sh");
    execFile("bash", [script], { cwd: DIR }, () => {});
    return json(res, { ok: true });
  }

  // ---- Smart Start ----
  if (method === "POST" && pathname === "/api/agents/smart-start") {
    const script = path.join(DIR, "smart_run.sh");
    if (!fs.existsSync(script)) return notFound(res, "smart_run.sh not found");
    const body = await parseBody(req);
    const maxAgents = body.max ? String(parseInt(body.max, 10) || 20) : "20";
    const extraArgs = ["--max", maxAgents];
    // Run smart_run.sh and capture its decision summary before it launches agents
    execFile("bash", [script, "--dry-run", ...extraArgs], { cwd: DIR }, (err, stdout, stderr) => {
      // Parse decision from stdout
      const lines = (stdout || "").split("\n");
      const decision = {};
      for (const l of lines) {
        const m = l.match(/^\s+([\w\s]+):\s+(.+)$/);
        if (m) decision[m[1].trim()] = m[2].trim();
      }
      // Now actually run
      const child = spawn("bash", [script, ...extraArgs], { cwd: DIR, detached: true, stdio: "ignore" });
      child.unref();
      json(res, { ok: true, decision, message: `Smart run launched (max: ${maxAgents})`, max: parseInt(maxAgents, 10) });
    });
    return;
  }

  // ---- Watchdog: restart agents whose loop is running but heartbeat is stale ----
  if (method === "POST" && pathname === "/api/agents/watchdog") {
    const STALE_MS = 15 * 60 * 1000; // 15 min — loop running but no heartbeat update
    const names = listAgentNames();
    const actions = [];
    let pending = names.length;
    if (pending === 0) return json(res, { ok: true, restarted: [], checked: 0 });

    names.forEach((name) => {
      // Check if loop is running
      execFile("pgrep", ["-f", `run_subset.sh ${name}`], {}, (err, stdout) => {
        const loopRunning = stdout.trim().split("\n").filter(Boolean).length > 0;
        if (loopRunning) {
          const { heartbeat_age_ms } = getAgentStatus(name);
          if (heartbeat_age_ms !== null && heartbeat_age_ms > STALE_MS) {
            // Loop running but no heartbeat for 15+ min — agent is stuck, restart
            const stopScript = path.join(DIR, "stop_agent.sh");
            const startScript = path.join(DIR, "run_subset.sh");
            execFile("bash", [stopScript, name], { cwd: DIR }, () => {
              setTimeout(() => {
                const child = spawn("bash", [startScript, name], { cwd: DIR, detached: true, stdio: "ignore" });
                child.unref();
              }, 2000);
            });
            actions.push({ name, action: "restarted", heartbeat_age_ms });
          } else {
            actions.push({ name, action: "ok", heartbeat_age_ms });
          }
        } else {
          actions.push({ name, action: "not_running" });
        }
        pending--;
        if (pending === 0) {
          const restarted = actions.filter((a) => a.action === "restarted");
          json(res, { ok: true, restarted: restarted.map((a) => a.name), checked: names.length, details: actions });
        }
      });
    });
    return;
  }

  if (method === "GET" && pathname === "/api/watchdog-log") {
    return json(res, { log: watchdogLog });
  }

  // ---- Agent persona evolution ----
  // POST /api/agents/:name/persona/note — append a note to persona evolution log
  const agentPersonaNoteMatch = pathname.match(/^\/api\/agents\/([^/]+)\/persona\/note$/);
  if (method === "POST" && agentPersonaNoteMatch) {
    const name = agentName(agentPersonaNoteMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const body = await parseBody(req);
    const note = body.note ? String(body.note).trim() : "";
    if (!note) return badRequest(res, "note is required");
    const personaPath = path.join(d, "persona.md");
    const existing = safeRead(personaPath) || "";
    const timestamp = new Date().toISOString();
    let base = existing;
    if (!existing.includes("## Persona Evolution Log")) {
      base = existing.trimEnd() + "\n\n---\n\n## Persona Evolution Log\n\n";
    }
    const entry = `### [${timestamp}] Note\n${note}\n\n---\n`;
    fs.writeFileSync(personaPath, base + entry);
    return json(res, { ok: true, timestamp, type: "Note", note });
  }

  // PATCH /api/agents/:name/persona — append an evolution entry
  const agentPersonaPatchMatch = pathname.match(/^\/api\/agents\/([^/]+)\/persona$/);
  if (method === "PATCH" && agentPersonaPatchMatch) {
    const name = agentName(agentPersonaPatchMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const body = await parseBody(req);
    const observation = body.observation ? String(body.observation).trim() : "";
    if (!observation) return badRequest(res, "observation is required");
    const personaPath = path.join(d, "persona.md");
    const existing = safeRead(personaPath) || "";
    const timestamp = new Date().toISOString();
    let base = existing;
    if (!existing.includes("## Persona Evolution Log")) {
      base = existing.trimEnd() + "\n\n---\n\n## Persona Evolution Log\n\n";
    }
    const entry = `### [${timestamp}] Evolution\n${observation}\n\n---\n`;
    fs.writeFileSync(personaPath, base + entry);
    return json(res, { ok: true, timestamp, type: "Evolution", observation });
  }

  // ---- Agent sub-resource GET routes ----
  const agentSubMatch = pathname.match(/^\/api\/agents\/([^/]+)\/(inbox|activity|status|todo|persona)$/);
  if (method === "GET" && agentSubMatch) {
    const name = agentName(agentSubMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const sub = agentSubMatch[2];
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    if (sub === "inbox") {
      const inboxDir = path.join(d, "chat_inbox");
      const unread = listDir(inboxDir).filter((f) => f.endsWith(".md")).map((f) => ({
        filename: f, content: safeRead(path.join(inboxDir, f)) || "", unread: true,
      }));
      const processed = listDir(path.join(inboxDir, "processed")).filter((f) => f.endsWith(".md")).slice(-20).map((f) => ({
        filename: f, content: safeRead(path.join(inboxDir, "processed", f)) || "", unread: false,
      }));
      return json(res, { unread, processed });
    }
    if (sub === "activity") {
      // Parse clean log into cycle groups
      const today = todayStr();
      const log = safeRead(path.join(d, "logs", `${today}.log`)) || "";
      const cycles = [];
      let cur = null;
      for (const line of log.split("\n")) {
        if (/CYCLE\s*START/i.test(line)) {
          if (cur) cycles.push(cur);
          cur = { start: line, lines: [], cost: 0, turns: 0, duration: "" };
        } else if (/CYCLE\s*END/i.test(line)) {
          if (cur) { cur.end = line; cycles.push(cur); cur = null; }
        } else if (cur) {
          cur.lines.push(line);
          const costM = line.match(/cost=\$([\d.]+)/);
          if (costM) cur.cost = parseFloat(costM[1]);
          const turnsM = line.match(/turns=(\d+)/);
          if (turnsM) cur.turns = parseInt(turnsM[1]);
          const durM = line.match(/duration=([\d.]+)s/);
          if (durM) cur.duration = durM[1] + "s";
        }
      }
      if (cur) cycles.push(cur);
      // Add sequential cycle numbers (1-based, oldest first)
      cycles.forEach((c, i) => { c.cycle = i + 1; });
      return json(res, { name, cycles: cycles.reverse() }); // newest first
    }
    if (sub === "status") return json(res, { name, content: safeRead(path.join(d, "status.md")) || "" });
    if (sub === "todo") return json(res, { name, content: safeRead(path.join(d, "todo.md")) || "" });
    if (sub === "persona") return json(res, { name, content: safeRead(path.join(d, "persona.md")) || "" });
  }

  // ---- Agent inbox POST (alias for /message) ----
  const agentInboxPostMatch = pathname.match(/^\/api\/agents\/([^/]+)\/inbox$/);
  if (method === "POST" && agentInboxPostMatch) {
    const name = agentName(agentInboxPostMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const inboxDir = path.join(EMPLOYEES_DIR, name, "chat_inbox");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const body = await parseBody(req);
    if (!body.message || typeof body.message !== "string") return badRequest(res, "missing message");
    const from = sanitizeFrom(body.from || "dashboard");
    const filename = `${nowStamp()}_from_${from}.md`;
    try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    fs.writeFileSync(path.join(inboxDir, filename), body.message);
    return json(res, { ok: true, filename });
  }

  const agentCtxMatch = pathname.match(/^\/api\/agents\/([^/]+)\/lastcontext$/);
  if (method === "GET" && agentCtxMatch) {
    const name = agentName(agentCtxMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const content = safeRead(path.join(d, "last_context.md")) || "";
    return json(res, { name, content });
  }

  // GET /api/agents/:name/cycles — list all cycles from today's log with metadata
  const agentCyclesMatch = pathname.match(/^\/api\/agents\/([^/]+)\/cycles$/);
  if (method === "GET" && agentCyclesMatch) {
    const name = agentName(agentCyclesMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    // Find the most recent log file (today or yesterday — log date can lag timezone midnight)
    const logsDir = path.join(d, "logs");
    let logPath = null;
    let today = "";
    try {
      const logFiles = fs.existsSync(logsDir) ? fs.readdirSync(logsDir)
        .filter(f => f.match(/^\d{4}_\d{2}_\d{2}\.log$/) && !f.includes("raw"))
        .sort().reverse() : [];
      if (logFiles.length > 0) {
        logPath = path.join(logsDir, logFiles[0]);
        today = logFiles[0].replace(".log", "");
      }
    } catch (_) {}
    if (!logPath) { today = new Date().toISOString().slice(0, 10).replace(/-/g, "_"); }
    const raw = (logPath && safeRead(logPath)) || "";
    const cycles = [];
    const lines = raw.split("\n");
    let current = null;
    for (const line of lines) {
      const startM = line.match(/^={5,} CYCLE START — (\S+) ={5,}$/);
      const endM = line.match(/^={5,} CYCLE END — (\S+) ={5,}$/);
      const doneM = line.match(/^\[DONE\] turns=(\d+) cost=\$([0-9.]+) duration=([0-9.]+)s/);
      if (startM) {
        current = { n: cycles.length + 1, started: startM[1].replace(/_/g, " "), ended: null, turns: null, cost_usd: null, duration_s: null, actions: [] };
        cycles.push(current);
      } else if (endM && current) {
        current.ended = endM[1].replace(/_/g, " ");
      } else if (doneM && current) {
        current.turns = parseInt(doneM[1], 10);
        current.cost_usd = parseFloat(doneM[2]);
        current.duration_s = parseFloat(doneM[3]);
      } else if (current && line.startsWith("[TOOL] ")) {
        current.actions.push(line.slice(7, 120));
      } else if (current && line.startsWith("[ASSISTANT] ")) {
        const text = line.slice(12, 100);
        if (text.trim()) current.actions.push(">> " + text);
      }
    }
    // Return summary (no full content for list endpoint)
    const summary = cycles.map((c) => ({
      n: c.n, started: c.started, ended: c.ended,
      turns: c.turns, cost_usd: c.cost_usd, duration_s: c.duration_s,
      action_count: c.actions.length,
      preview: c.actions.slice(0, 3).join(" | "),
    }));
    return json(res, { name, date: today, cycles: summary.reverse() }); // newest first
  }

  // GET /api/agents/:name/cycles/:n — full output for a specific cycle
  const agentCycleDetailMatch = pathname.match(/^\/api\/agents\/([^/]+)\/cycles\/(\d+)$/);
  if (method === "GET" && agentCycleDetailMatch) {
    const name = agentName(agentCycleDetailMatch[1]);
    const cycleN = parseInt(agentCycleDetailMatch[2], 10);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    // Find most recent log file
    const logsDir2 = path.join(d, "logs");
    let logPath2 = null;
    try {
      const files2 = fs.existsSync(logsDir2) ? fs.readdirSync(logsDir2)
        .filter(f => f.match(/^\d{4}_\d{2}_\d{2}\.log$/) && !f.includes("raw"))
        .sort().reverse() : [];
      if (files2.length > 0) logPath2 = path.join(logsDir2, files2[0]);
    } catch (_) {}
    const raw = (logPath2 && safeRead(logPath2)) || "";
    const lines = raw.split("\n");
    let inCycle = false, cycleCount = 0, cycleLines = [];
    let meta = null;
    for (const line of lines) {
      if (line.match(/^={5,} CYCLE START/)) { cycleCount++; if (cycleCount === cycleN) { inCycle = true; cycleLines = [line]; } }
      else if (inCycle) { cycleLines.push(line); if (line.match(/^={5,} CYCLE END/)) { inCycle = false; break; } }
    }
    if (cycleLines.length === 0) return notFound(res, `cycle ${cycleN} not found`);
    return json(res, { name, cycle: cycleN, content: cycleLines.join("\n") });
  }

  // GET /api/agents/:name/health — agent health score (Ivan's v2 model)
  const agentHealthMatch = pathname.match(/^\/api\/agents\/([^/]+)\/health$/);
  if (method === "GET" && agentHealthMatch) {
    const name = agentName(agentHealthMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const summary = getAgentSummary(name);
    const hbMtime = fileMtime(path.join(d, "heartbeat.md"));
    const alive = Boolean(hbMtime && Date.now() - hbMtime < 5 * 60 * 1000) || summary.status === "running";
    const inboxFiles = listDir(path.join(d, "chat_inbox")).filter((f) => !f.startsWith("read_") && f.endsWith(".md"));
    const agentData = { ...summary, alive, unread_messages: inboxFiles.length };
    const velocityData = buildVelocityData();
    const health = computeAgentHealth(agentData, velocityData);
    return json(res, health);
  }

  // ---- Tasks ----
  if (method === "GET" && pathname === "/api/tasks") {
    let taskList = parseTaskBoard().map((t) => ({ ...t, id: parseInt(t.id, 10) || t.id, notesList: (t.notes || "").split(" ;; ").filter(Boolean) }));
    const assigneeFilter = query.assignee;
    const statusFilter = query.status;
    const priorityFilter = query.priority;
    const qFilter = query.q ? query.q.toLowerCase() : null;
    if (assigneeFilter) taskList = taskList.filter((t) => t.assignee.toLowerCase() === assigneeFilter.toLowerCase());
    if (statusFilter) taskList = taskList.filter((t) => t.status.toLowerCase() === statusFilter.toLowerCase());
    if (priorityFilter) taskList = taskList.filter((t) => t.priority.toLowerCase() === priorityFilter.toLowerCase());
    if (qFilter) taskList = taskList.filter((t) =>
      (t.title || "").toLowerCase().includes(qFilter) ||
      (t.description || "").toLowerCase().includes(qFilter)
    );
    return json(res, taskList);
  }

  if (method === "POST" && pathname === "/api/tasks") {
    const body = await parseBody(req);
    if (!body.title || !String(body.title).trim()) return badRequest(res, "title is required");
    const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
    if (body.priority && !VALID_PRIORITIES.has(String(body.priority).toLowerCase())) {
      return badRequest(res, "invalid priority: must be low, medium, high, or critical");
    }
    try {
      const now = new Date().toISOString().slice(0, 10);
      const all = parseTaskBoard();
      const maxId = all.reduce((m, t) => Math.max(m, parseInt(t.id, 10) || 0), 0);
      const newId = maxId + 1;
      appendTaskRow(body);
      return json(res, {
        ok: true,
        id: newId,
        title: String(body.title).trim(),
        description: body.description ? String(body.description).trim() : "",
        priority: (body.priority || "medium").toLowerCase(),
        assignee: (body.assignee || "unassigned").toLowerCase(),
        status: "open",
        created: now,
        updated: now,
      }, 201);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  const taskPatchMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (method === "PATCH" && taskPatchMatch) {
    const id = taskPatchMatch[1];
    const body = await parseBody(req);
    const VALID_STATUSES = new Set(["open", "in_progress", "done", "blocked", "in_review", "cancelled"]);
    const VALID_PRIORITIES_PATCH = new Set(["low", "medium", "high", "critical"]);
    if (body.status !== undefined && !VALID_STATUSES.has(String(body.status).toLowerCase())) {
      return badRequest(res, "invalid status: must be open, in_progress, done, blocked, in_review, or cancelled");
    }
    if (body.priority !== undefined && !VALID_PRIORITIES_PATCH.has(String(body.priority).toLowerCase())) {
      return badRequest(res, "invalid priority: must be low, medium, high, or critical");
    }
    const ok = updateTaskRow(id, body);
    if (!ok) return notFound(res, "task not found");
    const updatedTask = parseTaskBoard().find((t) => String(t.id) === String(id));
    if (!updatedTask) return notFound(res, "task not found");
    return json(res, { ok: true, ...updatedTask, id: parseInt(updatedTask.id, 10), notesList: (updatedTask.notes || "").split(" ;; ").filter(Boolean) });
  }

  // GET /api/tasks/:id/result — find task-specific result file
  // Looks first in public/task_outputs/task-{id}-*.md, then agent's output/ folder
  const taskResultMatch = pathname.match(/^\/api\/tasks\/(\d+)\/result$/);
  if (method === "GET" && taskResultMatch) {
    const id = taskResultMatch[1];
    const task = parseTaskBoard().find((t) => String(t.id) === String(id));
    if (!task) return notFound(res, "task not found");

    // 1. Check shared task_outputs folder first: public/task_outputs/task-{id}-*.md
    const taskOutDir = path.join(PUBLIC_DIR, "task_outputs");
    if (!fs.existsSync(taskOutDir)) { try { fs.mkdirSync(taskOutDir, { recursive: true }); } catch (_) {} }
    const sharedFiles = fs.existsSync(taskOutDir)
      ? listDir(taskOutDir).filter(f => {
          const lower = f.toLowerCase();
          return lower.match(new RegExp(`^task[_-]?0*${id}[_-]`, 'i')) || lower.match(new RegExp(`^task[_-]?0*${id}\\.`));
        })
      : [];

    if (sharedFiles.length > 0) {
      const sorted = sharedFiles.map(f => ({ f, mtime: fileMtime(path.join(taskOutDir, f)) || 0 })).sort((a, b) => b.mtime - a.mtime);
      const file = sorted[0].f;
      const content = safeRead(path.join(taskOutDir, file));
      return json(res, { task_id: id, source: "task_outputs", file, content: content || "" });
    }

    // 2. Fall back to assignee's output folder
    const assignee = (task.assignee || "").toLowerCase().trim();
    if (!assignee) return notFound(res, "task has no assignee and no shared result file");
    const agentOutDir = path.join(EMPLOYEES_DIR, assignee, "output");
    if (!fs.existsSync(agentOutDir)) return notFound(res, `no output found for task ${id}`);

    const agentFiles = listDir(agentOutDir).filter(f => {
      try { return fs.statSync(path.join(agentOutDir, f)).isFile(); } catch (_) { return false; }
    });
    const exact = agentFiles.find(f => f.toLowerCase().match(new RegExp(`task[_-]?0*${id}[_-]`, 'i')));
    if (exact) {
      const content = safeRead(path.join(agentOutDir, exact));
      return json(res, { task_id: id, source: "agent_output", assignee, file: exact, content: content || "" });
    }

    // 3. Return latest file from agent output as best effort
    if (agentFiles.length > 0) {
      const sorted = agentFiles.map(f => ({ f, mtime: fileMtime(path.join(agentOutDir, f)) || 0 })).sort((a, b) => b.mtime - a.mtime);
      const file = sorted[0].f;
      const content = safeRead(path.join(agentOutDir, file));
      return json(res, { task_id: id, source: "agent_output_latest", assignee, file, content: content || "" });
    }

    return notFound(res, `no output found for task ${id} (assignee: ${assignee})`);
  }

  // POST /api/tasks/:id/result — write a task result file to public/task_outputs/
  if (method === "POST" && taskResultMatch) {
    const id = taskResultWriteMatch[1];
    const body = await parseBody(req);
    const content = body.content !== undefined ? String(body.content) : null;
    const filename = body.filename ? String(body.filename).replace(/[^a-zA-Z0-9_.\-]/g, '_') : `task-${id}-result.md`;
    if (content === null) return badRequest(res, "content is required");
    const taskOutDir = path.join(PUBLIC_DIR, "task_outputs");
    if (!fs.existsSync(taskOutDir)) { try { fs.mkdirSync(taskOutDir, { recursive: true }); } catch (_) {} }
    const filePath = path.join(taskOutDir, filename);
    fs.writeFileSync(filePath, content);
    return json(res, { ok: true, task_id: id, file: filename });
  }

  // Atomic task claim: POST /api/tasks/:id/claim?agent=alice
  // Sets status=in_progress + assignee=agent only if task is currently open/unassigned
  // Uses task board lock to prevent race conditions between parallel agents
  const taskClaimMatch = pathname.match(/^\/api\/tasks\/(\d+)\/claim$/);
  if (method === "POST" && taskClaimMatch) {
    const id = taskClaimMatch[1];
    const body = await parseBody(req);
    const claimant = agentName(body.agent || query.agent || "");
    if (!claimant) return badRequest(res, "missing agent name");
    let result = null;
    withTaskLock(() => {
      const tbPath = path.join(PUBLIC_DIR, "task_board.md");
      const raw = safeRead(tbPath);
      if (!raw) { result = { ok: false, error: "task board not found", status: 404 }; return; }
      const tasks = parseTaskBoard();
      const task = tasks.find((t) => String(t.id) === String(id));
      if (!task) { result = { ok: false, error: "task not found", status: 404 }; return; }
      if (task.status === "done") { result = { ok: false, error: "task already done", status: 409 }; return; }
      if (task.status === "in_progress" && task.assignee && task.assignee !== claimant) {
        result = { ok: false, error: "task already claimed by " + task.assignee, status: 409, claimed_by: task.assignee }; return;
      }
      // Directly update in-place (no nested lock)
      const lines = raw.split("\n");
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim().startsWith("|")) continue;
        const cols = lines[i].split("|").slice(1, -1).map((c) => c.trim());
        if (cols.length < 2 || String(cols[0]) !== String(id)) continue;
        cols[4] = claimant;  // assignee
        cols[5] = "in_progress";  // status
        cols[7] = new Date().toISOString().slice(0, 10);  // updated
        lines[i] = "| " + cols.join(" | ") + " |";
        found = true;
        break;
      }
      if (found) {
        fs.writeFileSync(tbPath, lines.join("\n"));
        result = { ok: true, id: parseInt(id, 10), status: "in_progress", assignee: claimant };
      } else {
        result = { ok: false, error: "task row not found", status: 500 };
      }
    });
    if (!result) result = { ok: false, error: "lock timeout", status: 503 };
    return json(res, result, result.status && !result.ok ? result.status : 200);
  }

  const taskDeleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (method === "DELETE" && taskDeleteMatch) {
    const id = decodeURIComponent(taskDeleteMatch[1]);
    const tbPath = path.join(PUBLIC_DIR, "task_board.md");
    const raw = safeRead(tbPath);
    if (!raw) return notFound(res, "task board not found");
    const taskToDelete = parseTaskBoard().find((t) => String(t.id) === String(id));
    if (!taskToDelete) return notFound(res, "task not found");
    const lines = raw.split("\n");
    const filtered = lines.filter((line) => {
      if (!line.trim().startsWith("|")) return true;
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      return cols.length < 1 || String(cols[0]) !== String(id);
    });
    fs.writeFileSync(tbPath, filtered.join("\n"));
    return json(res, { ok: true, deleted: { ...taskToDelete, id: parseInt(taskToDelete.id, 10) } });
  }

  if (method === "GET" && pathname === "/api/tasks/archive") {
    const archivePath = path.join(PUBLIC_DIR, "task_board_archive.md");
    const raw = safeRead(archivePath) || "";
    const lines = raw.split("\n").filter((l) => l.trim().startsWith("|"));
    const tasks = [];
    for (const line of lines) {
      // Skip header row (contains "ID") and separator row (contains "---")
      if (/\|\s*id\s*\|/i.test(line) || /\|[-\s]+\|/.test(line)) continue;
      const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 6) tasks.push({ id: cols[0], title: cols[1], description: cols[2], priority: cols[3], assignee: cols[4], status: cols[5], created: cols[6] || "", updated: cols[7] || "" });
    }
    return json(res, tasks);
  }

  if (method === "POST" && pathname === "/api/tasks/archive") {
    const archived = archiveDoneTasks();
    return json(res, { ok: true, archived });
  }

  // ---- Communication ----
  if (method === "GET" && pathname === "/api/team-channel") {
    const dir = path.join(PUBLIC_DIR, "team_channel");
    const files = listDir(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = safeRead(path.join(dir, f));
        const dateM = f.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
        return { filename: f, content, date: dateM ? dateM[1].replace(/_/g, "-") : null };
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return json(res, files);
  }

  if (method === "POST" && pathname === "/api/team-channel") {
    const body = await parseBody(req);
    if (!body.message || typeof body.message !== "string") return badRequest(res, "missing message");
    const from = sanitizeFrom(body.from || "ceo");
    const dir = path.join(PUBLIC_DIR, "team_channel");
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const filename = `${nowStamp()}_from_${from}.md`;
    fs.writeFileSync(path.join(dir, filename), body.message);
    return json(res, { ok: true, filename });
  }

  if (method === "GET" && pathname === "/api/announcements") {
    const dir = path.join(PUBLIC_DIR, "announcements");
    const files = listDir(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = safeRead(path.join(dir, f)) || "";
        const dateM = f.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
        // Parse title from first # heading, body from rest
        const lines = content.split("\n");
        const titleLine = lines.find((l) => l.startsWith("#"));
        const title = titleLine ? titleLine.replace(/^#+\s*/, "").trim() : f.replace(/_/g, " ").replace(".md", "");
        const body = lines.filter((l) => !l.startsWith("#")).join("\n").trim();
        const fromM = content.match(/\*\*From:\*\*\s*(.+)/);
        return {
          filename: f,
          content,
          title,
          body,
          from: fromM ? fromM[1].trim() : null,
          date: dateM ? dateM[1].replace(/_/g, "-") : null,
        };
      })
      .sort((a, b) => (b.filename || "").localeCompare(a.filename || ""));
    return json(res, files);
  }

  if (method === "POST" && (pathname === "/api/announce" || pathname === "/api/announcements")) {
    const body = await parseBody(req);
    // Accept both {message} and {title, body} formats
    let content = body.message;
    if (!content && (body.title || body.body)) {
      const from = body.from ? `\n\n**From:** ${body.from}` : "";
      content = (body.title ? `# ${body.title}\n\n` : "") + (body.body || "") + from;
    }
    if (!content) return badRequest(res, "missing message or title/body");
    const dir = path.join(PUBLIC_DIR, "announcements");
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const filename = `${nowStamp()}_announcement.md`;
    fs.writeFileSync(path.join(dir, filename), content);
    return json(res, { ok: true, filename });
  }

  if (method === "POST" && pathname === "/api/broadcast") {
    const body = await parseBody(req);
    if (!body.message || typeof body.message !== "string") return badRequest(res, "missing message");
    const from = sanitizeFrom(body.from || "dashboard");
    const agents = listAgentNames();
    const filename = `${nowStamp()}_from_${from}.md`;
    for (const name of agents) {
      const inboxDir = path.join(EMPLOYEES_DIR, name, "chat_inbox");
      try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
      try { fs.writeFileSync(path.join(inboxDir, filename), body.message); } catch (_) {}
    }
    return json(res, { ok: true, agents: agents.length, filename });
  }

  // ---- CEO Inbox ----
  const CEO_INBOX = path.join(DIR, "ceo_inbox");
  if (method === "GET" && pathname === "/api/ceo-inbox") {
    try { fs.mkdirSync(path.join(CEO_INBOX, "processed"), { recursive: true }); } catch (_) {}
    const unread = listDir(CEO_INBOX).filter((f) => f.endsWith(".md")).map((f) => {
      const content = safeRead(path.join(CEO_INBOX, f)) || "";
      const fromMatch = f.match(/_from_([^.]+)\.md$/i);
      const tsMatch = f.match(/^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
      const ts = tsMatch ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]} ${tsMatch[4]}:${tsMatch[5]}:${tsMatch[6]}` : "";
      return { filename: f, from: fromMatch ? fromMatch[1] : "unknown", timestamp: ts, content };
    }).sort((a, b) => b.filename.localeCompare(a.filename));
    const processed = listDir(path.join(CEO_INBOX, "processed")).filter((f) => f.endsWith(".md")).slice(-20).map((f) => {
      const content = safeRead(path.join(CEO_INBOX, "processed", f)) || "";
      const fromMatch = f.match(/_from_([^.]+)\.md$/i);
      const tsMatch = f.match(/^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
      const ts = tsMatch ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]} ${tsMatch[4]}:${tsMatch[5]}:${tsMatch[6]}` : "";
      return { filename: f, from: fromMatch ? fromMatch[1] : "unknown", timestamp: ts, content };
    }).sort((a, b) => b.filename.localeCompare(a.filename));
    return json(res, { unread, processed });
  }

  const ceoInboxReadMatch = pathname.match(/^\/api\/ceo-inbox\/([^/]+)\/read$/);
  if (method === "POST" && ceoInboxReadMatch) {
    const filename = decodeURIComponent(ceoInboxReadMatch[1]);
    if (!/^[\w-]+\.md$/.test(filename)) return badRequest(res, "invalid filename");
    const src = path.join(CEO_INBOX, filename);
    const dst = path.join(CEO_INBOX, "processed", filename);
    try {
      fs.mkdirSync(path.join(CEO_INBOX, "processed"), { recursive: true });
      fs.renameSync(src, dst);
      return json(res, { ok: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ---- CEO Quick Command ----
  // POST /api/ceo/command { command: string }
  // Routing rules:
  //   @agentname <text>  → send text to that agent's inbox (CEO priority)
  //   task: <title>      → create a task (auto-assigned unassigned, medium priority)
  //   /mode <name>       → switch company mode
  //   anything else      → send to alice's inbox as CEO priority
  if (method === "POST" && pathname === "/api/ceo/command") {
    const body = await parseBody(req);
    const { command } = body;
    if (!command || !command.trim()) return badRequest(res, "command is required");
    const cmd = command.trim();
    const ts = () => {
      const d = new Date();
      return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0'),
              String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join('_');
    };

    // @mention → direct DM to agent
    const mentionMatch = cmd.match(/^@(\w+)\s+(.+)$/s);
    if (mentionMatch) {
      const targetAgent = mentionMatch[1].toLowerCase();
      const msg = mentionMatch[2].trim();
      const agDir = path.join(EMPLOYEES_DIR, targetAgent);
      if (!fs.existsSync(agDir)) return notFound(res, `agent '${targetAgent}' not found`);
      const inboxDir = path.join(agDir, "chat_inbox");
      try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
      const fname = `${ts()}_from_ceo.md`;
      fs.writeFileSync(path.join(inboxDir, fname), `# CEO Priority Message\n\n${msg}\n`);
      return json(res, { ok: true, action: "dm", agent: targetAgent, filename: fname });
    }

    // task: <title> → create new task
    const taskMatch = cmd.match(/^(?:task|todo|create task):\s*(.+)$/is);
    if (taskMatch) {
      const title = taskMatch[1].trim();
      if (!title) return badRequest(res, "task title is empty");
      try {
        const newId = appendTaskRow({ title, description: "(CEO quick command)", priority: "medium", assignee: "unassigned" });
        return json(res, { ok: true, action: "task_created", id: newId, title }, 201);
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // /mode <name> → switch mode
    const modeMatch = cmd.match(/^\/mode\s+(\w+)$/i);
    if (modeMatch) {
      const newMode = modeMatch[1].toLowerCase();
      const validModes = ["plan", "normal", "crazy", "autonomous"];
      if (!validModes.includes(newMode)) return badRequest(res, `invalid mode, must be one of: ${validModes.join(', ')}`);
      try {
        fs.writeFileSync(path.join(PUBLIC_DIR, "company_mode.md"), `# Company Mode\n\nmode: ${newMode}\nupdated_by: ceo\nupdated_at: ${new Date().toISOString()}\n`);
        return json(res, { ok: true, action: "mode_switched", mode: newMode });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // Default: send to alice as CEO priority
    const aliceInbox = path.join(EMPLOYEES_DIR, "alice", "chat_inbox");
    try { fs.mkdirSync(aliceInbox, { recursive: true }); } catch (_) {}
    const fname = `${ts()}_from_ceo.md`;
    fs.writeFileSync(path.join(aliceInbox, fname), `# CEO Priority Message\n\n${cmd}\n`);
    return json(res, { ok: true, action: "routed_to_alice", filename: fname });
  }

  // ---- Social Consensus Board ----
  const CONSENSUS_FILE = path.join(PUBLIC_DIR, "consensus.md");

  if (method === "GET" && pathname === "/api/consensus") {
    const raw = safeRead(CONSENSUS_FILE) || "# Consensus Board\n\n(empty)\n";
    // Parse table rows from all sections
    const entries = [];
    let section = "";
    for (const line of raw.split("\n")) {
      const h2 = line.match(/^## (.+)$/);
      if (h2) { section = h2[1].trim(); continue; }
      if (!line.startsWith("|")) continue;
      const cols = line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      if (cols.length < 5) continue;
      const idNum = parseInt(cols[0], 10);
      if (isNaN(idNum)) continue; // header row
      entries.push({ id: idNum, section, type: cols[1], content: cols[2], author: cols[3], updated: cols[4] });
    }
    return json(res, { raw, entries });
  }

  if (method === "POST" && pathname === "/api/consensus/entry") {
    const body = await parseBody(req);
    const { type, content, author, section } = body;
    if (!type || !content) return badRequest(res, "type and content are required");
    const raw = safeRead(CONSENSUS_FILE) || "";
    // Find highest ID
    let maxId = 0;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("|")) continue;
      const cols = line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      const idNum = parseInt(cols[0], 10);
      if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
    }
    const newId = maxId + 1;
    const today = getDateStr(0);
    const authorSafe = (author || "agent").replace(/[^a-zA-Z0-9_-]/g, "");
    const newRow = `| ${newId} | ${type} | ${content} | ${authorSafe} | ${today} |`;
    // Append to "Evolving Relationships" or end of file (before the footer)
    const targetSection = section || "Evolving Relationships";
    const lines = raw.split("\n");
    let insertAt = lines.length - 1;
    // Find the section header and insert after the last table row in that section
    let inSection = false;
    let lastTableRow = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        if (inSection && lastTableRow >= 0) { insertAt = lastTableRow + 1; break; }
        inSection = lines[i].includes(targetSection);
        lastTableRow = -1;
      }
      if (inSection && lines[i].startsWith("| ")) lastTableRow = i;
    }
    if (inSection && lastTableRow >= 0) insertAt = lastTableRow + 1;
    lines.splice(insertAt, 0, newRow);
    try {
      fs.writeFileSync(CONSENSUS_FILE, lines.join("\n"));
      return json(res, { ok: true, id: newId }, 201);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ---- Knowledge & Research ----
  if (method === "GET" && pathname === "/api/research") {
    const plans = listDir(path.join(PUBLIC_DIR, "plans")).map((f) => ({ file: f, type: "plan", dir: "plans" }));
    const reports = listDir(path.join(PUBLIC_DIR, "reports")).map((f) => ({ file: f, type: "report", dir: "reports" }));
    return json(res, [...plans, ...reports]);
  }

  const researchFileMatch = pathname.match(/^\/api\/research\/(.+)$/);
  if (method === "GET" && researchFileMatch) {
    const file = decodeURIComponent(researchFileMatch[1]);
    // Search in plans then reports
    let content = safeRead(path.join(PUBLIC_DIR, "plans", file));
    let dir = "plans";
    if (content === null) {
      content = safeRead(path.join(PUBLIC_DIR, "reports", file));
      dir = "reports";
    }
    if (content === null) return notFound(res, "file not found");
    return json(res, { file, dir, content });
  }

  if (method === "GET" && pathname === "/api/knowledge") {
    const files = listDirRecursive(path.join(PUBLIC_DIR, "knowledge"));
    return json(res, files);
  }

  const knowledgeMatch = pathname.match(/^\/api\/knowledge\/(.+)$/);
  if (method === "GET" && knowledgeMatch) {
    const p = decodeURIComponent(knowledgeMatch[1]);
    // Prevent path traversal
    const full = path.resolve(path.join(PUBLIC_DIR, "knowledge", p));
    if (!full.startsWith(path.join(PUBLIC_DIR, "knowledge"))) return badRequest(res, "invalid path");
    const content = safeRead(full);
    if (content === null) return notFound(res, "file not found");
    return json(res, { path: p, content });
  }

  // ---- Organization ----
  if (method === "GET" && pathname === "/api/org") {
    return json(res, parseOrgChart());
  }

  if (method === "GET" && pathname === "/api/mode") {
    const raw = safeRead(path.join(PUBLIC_DIR, "company_mode.md"));
    let mode = "normal";
    if (raw) {
      const m = raw.match(/##\s*Current Mode\s*\n\*\*(\w+)\*\*/i);
      if (m) mode = m[1].toLowerCase();
    }
    return json(res, { mode, raw });
  }

  if (method === "POST" && pathname === "/api/mode") {
    const body = await parseBody(req);
    if (!body.mode) return badRequest(res, "missing mode");
    const VALID_MODES = new Set(["plan", "normal", "crazy"]);
    if (!VALID_MODES.has(body.mode)) return badRequest(res, `invalid mode '${body.mode}': must be plan, normal, or crazy`);
    if (!body.who || !body.reason) return badRequest(res, "Missing required fields: who, reason");
    const script = path.join(DIR, "switch_mode.sh");
    if (!fs.existsSync(script)) return notFound(res, "switch_mode.sh not found");
    const args = [script, body.mode, body.who, body.reason];
    execFile("bash", args, { cwd: DIR }, (err, stdout, stderr) => {
      if (err) return json(res, { ok: false, error: stderr || err.message }, 500);
      json(res, { ok: true, output: stdout });
    });
    return;
  }

  if (method === "GET" && pathname === "/api/sops") {
    const dir = path.join(PUBLIC_DIR, "sops");
    const files = listDir(dir).filter((f) => f.endsWith(".md"));
    const sops = files.map((f) => ({
      name: f,
      filename: f,
      content: safeRead(path.join(dir, f)),
    }));
    return json(res, sops);
  }

  if (method === "GET" && pathname === "/api/ops") {
    const scripts = listDir(DIR).filter((f) => f.endsWith(".sh"));
    return json(res, scripts);
  }

  // ---- Stats & Monitoring ----
  // GET /api/cost — fast live cost summary (today + 7-day total)
  if (method === "GET" && pathname === "/api/cost") {
    const names = listAgentNames();
    // "Today" means the most recent log file for each agent (avoids midnight rollover issues)
    let todayCost = 0, todayCycles = 0, total7dCost = 0, total7dCycles = 0;
    const perAgent = names.map((name) => {
      const logsDir = path.join(EMPLOYEES_DIR, name, "logs");
      let logPath = null;
      try {
        const lf = fs.existsSync(logsDir) ? fs.readdirSync(logsDir)
          .filter(f => f.match(/^\d{4}_\d{2}_\d{2}\.log$/) && !f.includes("raw"))
          .sort().reverse() : [];
        if (lf.length) logPath = path.join(logsDir, lf[0]);
      } catch (_) {}
      const text = (logPath && safeRead(logPath)) || "";
      let cost = 0, cycles = 0;
      for (const line of text.split("\n")) {
        const m = line.match(/\[DONE\].*cost=\$?([\d.]+)/i);
        if (m) cost += parseFloat(m[1]) || 0;
        if (/CYCLE\s*START/i.test(line)) cycles++;
      }
      todayCost += cost;
      todayCycles += cycles;
      const week = getAgentCostFromLogs(name, 7);
      total7dCost += week.totalCost;
      total7dCycles += week.cycles;
      return { name, today_usd: Math.round(cost * 100) / 100, today_cycles: cycles };
    });
    return json(res, {
      today_usd: Math.round(todayCost * 100) / 100,
      today_cycles: todayCycles,
      total_7d_usd: Math.round(total7dCost * 100) / 100,
      total_7d_cycles: total7dCycles,
      per_agent: perAgent.sort((a, b) => b.today_usd - a.today_usd),
    });
  }

  if (method === "GET" && pathname === "/api/stats") {
    const agentNames = listAgentNames();
    const stats = agentNames.map((name) => ({
      agent: name,
      ...getAgentCostFromLogs(name, 7),
    }));
    const totals = stats.reduce(
      (acc, s) => ({
        totalCost: Math.round((acc.totalCost + s.totalCost) * 100) / 100,
        totalCycles: acc.totalCycles + s.cycles,
      }),
      { totalCost: 0, totalCycles: 0 }
    );
    // Build per-agent maps for frontend charts
    const cycles_per_agent = {};
    const cost_per_agent = {};
    stats.forEach((s) => {
      cycles_per_agent[s.agent] = s.cycles;
      cost_per_agent[s.agent] = s.totalCost;
    });
    return json(res, {
      agents: stats,
      totals,
      total_cycles: totals.totalCycles,
      total_cost: totals.totalCost,
      cycles_per_agent,
      cost_per_agent,
    });
  }

  if (method === "GET" && pathname === "/api/digest") {
    return json(res, getDigest());
  }

  // ---- Metrics (Bob — Beta task) ----
  if (method === "GET" && pathname === "/api/metrics") {
    const agentNames = listAgentNames();
    const tasks = parseTaskBoard();

    // Task stats
    const tasksByStatus = tasks.reduce((acc, t) => {
      const s = (t.status || "open").toLowerCase();
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const tasksByPriority = tasks.reduce((acc, t) => {
      const p = (t.priority || "medium").toLowerCase();
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {});
    const tasksByAssignee = tasks.reduce((acc, t) => {
      const a = (t.assignee || "unassigned").toLowerCase();
      acc[a] = (acc[a] || 0) + 1;
      return acc;
    }, {});
    const totalTasks = tasks.length;
    const doneTasks = tasksByStatus["done"] || 0;
    const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    // Agent health
    const agentHealth = agentNames.map((name) => {
      const { status, heartbeat_age_ms } = getAgentStatus(name);
      return { name, status, heartbeat_age_ms };
    });
    const runningCount = agentHealth.filter((a) => a.status === "running").length;
    const staleCount = agentHealth.filter((a) => a.heartbeat_age_ms !== null && a.heartbeat_age_ms > 300000).length;

    // Cost & cycle stats (7-day window)
    const costStats = agentNames.map((name) => ({ name, ...getAgentCostFromLogs(name, 7) }));
    const totalCost7d = Math.round(costStats.reduce((s, a) => s + a.totalCost, 0) * 100) / 100;
    const totalCycles7d = costStats.reduce((s, a) => s + a.cycles, 0);
    const avgCostPerCycle = totalCycles7d > 0 ? Math.round((totalCost7d / totalCycles7d) * 10000) / 10000 : 0;

    return json(res, {
      timestamp: new Date().toISOString(),
      tasks: {
        total: totalTasks,
        by_status: tasksByStatus,
        by_priority: tasksByPriority,
        by_assignee: tasksByAssignee,
        completion_rate_pct: completionRate,
      },
      agents: {
        total: agentNames.length,
        running: runningCount,
        idle: agentNames.length - runningCount,
        stale: staleCount,
        health: agentHealth,
      },
      cost_7d: {
        total_usd: totalCost7d,
        total_cycles: totalCycles7d,
        avg_cost_per_cycle_usd: avgCostPerCycle,
        per_agent: costStats.map((a) => ({ name: a.name, cost_usd: a.totalCost, cycles: a.cycles })),
      },
      http: apiMetrics.snapshot(),
    });
  }

  // Bob's agent metrics sub-routes: /api/metrics/agents, /api/metrics/tasks, /api/metrics/health
  if (pathname.startsWith("/api/metrics/")) {
    if (handleAgentMetricsRequest(req, res, DIR)) return;
  }

  // Bob's SQLite message bus — Task #102
  // Routes: POST /api/messages, GET /api/inbox/:agent, POST /api/inbox/:agent/:id/ack,
  //         POST /api/messages/broadcast, GET /api/messages/queue-depth
  if (pathname.startsWith("/api/messages") || pathname.startsWith("/api/inbox")) {
    if (handleMessageBus(req, res, DIR)) return;
  }

  // GET /api/agents/:name/output — list files in agent's output/ directory
  const agentOutputListMatch = pathname.match(/^\/api\/agents\/([^/]+)\/output$/);
  if (method === "GET" && agentOutputListMatch) {
    const name = agentName(agentOutputListMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const outDir = path.join(d, "output");
    const files = fs.existsSync(outDir) ? listDir(outDir).filter((f) => {
      try { return fs.statSync(path.join(outDir, f)).isFile(); } catch (_) { return false; }
    }) : [];
    const fileList = files.map((f) => {
      const fp = path.join(outDir, f);
      const stat = fs.existsSync(fp) ? fs.statSync(fp) : null;
      return { name: f, size: stat ? stat.size : 0, mtime: stat ? stat.mtime.toISOString() : null };
    });
    return json(res, { agent: name, files: fileList });
  }

  // GET /api/agents/:name/output/:file — read a specific output file
  const agentOutputFileMatch = pathname.match(/^\/api\/agents\/([^/]+)\/output\/(.+)$/);
  if (method === "GET" && agentOutputFileMatch) {
    const name = agentName(agentOutputFileMatch[1]);
    const fname = agentOutputFileMatch[2].replace(/\.\./g, ""); // prevent traversal
    if (!name || !fname) return badRequest(res, "invalid parameters");
    const fp = path.join(EMPLOYEES_DIR, name, "output", fname);
    if (!fs.existsSync(fp)) return notFound(res, "file not found");
    const content = safeRead(fp) || "";
    const ext = path.extname(fname).toLowerCase();
    const isCode = [".js", ".ts", ".py", ".sh", ".sql", ".json", ".yaml", ".yml"].includes(ext);
    return json(res, { agent: name, file: fname, content, type: isCode ? "code" : "text" });
  }

  if (method === "GET" && pathname === "/api/code-output") {
    const agents = listAgentNames();
    const output = [];
    for (const name of agents) {
      const kDir = path.join(EMPLOYEES_DIR, name, "knowledge");
      const files = listDirRecursive(kDir);
      if (files.length) {
        output.push({ agent: name, files });
      }
    }
    return json(res, output);
  }

  if (method === "GET" && pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("event: connected\ndata: {}\n\n");
    sseClients.add(res);
    const keepalive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch (_) { sseClients.delete(res); clearInterval(keepalive); }
    }, 15000);
    req.on("close", () => { sseClients.delete(res); clearInterval(keepalive); });
    return;
  }

  // ---- Messages ----
  const messagesMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9_-]+)$/);
  if (method === "POST" && messagesMatch) {
    const agentName = messagesMatch[1];
    const agentDir = path.join(EMPLOYEES_DIR, agentName);
    if (!fs.existsSync(agentDir)) return notFound(res, `Agent '${agentName}' not found`);
    const body = await parseBody(req);
    if (!body.content) return badRequest(res, "content is required");
    const from = sanitizeFrom(body.from || "api");
    const inboxDir = path.join(agentDir, "chat_inbox");
    try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    const filename = `${nowStamp()}_from_${from}.md`;
    fs.writeFileSync(path.join(inboxDir, filename), String(body.content));
    return json(res, { ok: true, file: filename }, 201);
  }

  // ---- Fallback ----
  notFound(res, `no route for ${method} ${pathname}`);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const _start = Date.now();
  const _endpoint = `${req.method} ${url.parse(req.url).pathname}`;
  res.on("finish", () => {
    apiMetrics.recordRequest(_endpoint, Date.now() - _start, res.statusCode);
  });
  handleRequest(req, res).catch((err) => {
    if (err.code !== "BODY_TOO_LARGE") console.error("Unhandled error:", err);
    try {
      const status = err.code === "BODY_TOO_LARGE" ? 413 : 500;
      const msg = err.code === "BODY_TOO_LARGE" ? "request body too large" : "internal server error";
      json(res, { error: msg }, status);
    } catch (_) { /* headers already sent */ }
  });
});

// Initialize SQLite message bus (Task #102)
initMessageBus(DIR);

server.listen(PORT, () => {
  console.log(`Tokenfly Agent Team Lab — dashboard on http://localhost:${PORT}`);
  console.log(`Directory: ${DIR}`);
  console.log(`Agents: ${listAgentNames().join(", ")}`);
});
