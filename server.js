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
      try { client.write("event: refresh\ndata: {}\n\n"); } catch (_) { /* ignore */ }
    }
  }
}, 3000);

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
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
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

  // Last-seen: return an ISO timestamp from log mtime
  const today = todayStr();
  const rawLogMtime = fileMtime(path.join(d, "logs", `${today}_raw.log`));
  const last_update = rawLogMtime ? new Date(rawLogMtime).toISOString() : null;
  const lastSeenSecs = rawLogMtime ? Math.floor((Date.now() - rawLogMtime) / 1000) : null;

  return { name, role, status, current_task, cycles, last_update, lastSeenSecs, heartbeat_age_ms };
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
  const header = "| ID | Title | Description | Priority | Assignee | Status | Created | Updated |";
  const sep = "|----|-------|-------------|----------|----------|--------|---------|---------|";
  if (!fs.existsSync(archivePath)) {
    fs.writeFileSync(archivePath, `# Task Board Archive\n\n## Archived Tasks\n${header}\n${sep}\n`);
  }
  const doneRows = done.map((t) =>
    `| ${t.id} | ${t.title} | ${t.description} | ${t.priority} | ${t.assignee} | ${t.status} | ${t.created} | ${t.updated} |`
  ).join("\n");
  fs.appendFileSync(archivePath, doneRows + "\n");
  // Rewrite board with only active rows
  const activeRows = active.map((t) =>
    `| ${t.id} | ${t.title} | ${t.description} | ${t.priority} | ${t.assignee} | ${t.status} | ${t.created} | ${t.updated} |`
  ).join("\n");
  fs.writeFileSync(tbPath, `# Task Board\n\n## Tasks\n${header}\n${sep}\n${activeRows}\n`);
  return done.length;
}

function appendTaskRow(task) {
  const tbPath = path.join(PUBLIC_DIR, "task_board.md");
  const existing = parseTaskBoard();
  // Auto-archive done tasks when board exceeds 50 rows
  if (existing.length >= 50) archiveDoneTasks();
  const all = parseTaskBoard(); // re-read after potential archive
  const maxId = all.reduce((m, t) => Math.max(m, parseInt(t.id || t["#"] || "0", 10) || 0), 0);
  const newId = maxId + 1;
  const now = new Date().toISOString().slice(0, 10);
  const row = `| ${newId} | ${task.title || ""} | ${task.description || ""} | ${task.priority || "medium"} | ${task.assignee || ""} | open | ${now} | ${now} |`;
  const existing_raw = safeRead(tbPath) || "";
  const sep = existing_raw.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(tbPath, sep + row + "\n");
  return newId;
}

function updateTaskRow(id, updates) {
  const tbPath = path.join(PUBLIC_DIR, "task_board.md");
  const raw = safeRead(tbPath);
  if (!raw) return false;
  const lines = raw.split("\n");
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    const cols = lines[i].split("|").slice(1, -1).map((c) => c.trim());
    if (cols.length < 2) continue;
    if (String(cols[0]).trim() === String(id)) {
      // Rebuild the row preserving columns order: id, title, description, priority, assignee, status, created, updated
      if (updates.status !== undefined) cols[5] = updates.status;
      if (updates.assignee !== undefined) cols[4] = updates.assignee;
      if (updates.priority !== undefined) cols[3] = updates.priority;
      if (updates.title !== undefined) cols[1] = updates.title;
      cols[7] = new Date().toISOString().slice(0, 10); // updated
      lines[i] = "| " + cols.join(" | ") + " |";
      found = true;
      break;
    }
  }
  if (found) fs.writeFileSync(tbPath, lines.join("\n"));
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
  const today = todayStr();
  const logPath = path.join(EMPLOYEES_DIR, name, "logs", `${today}_raw.log`);
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

  // CORS preflight
  if (method === "OPTIONS") return cors(res);

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

  // ---- Core ----
  if (method === "GET" && pathname === "/api/health") {
    const mem = process.memoryUsage();
    return json(res, {
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
    const agents = listAgentNames().map(getAgentSummary);
    return json(res, agents);
  }

  const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (method === "GET" && agentMatch) {
    const name = decodeURIComponent(agentMatch[1]);
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const { status, heartbeat } = getAgentStatus(name);
    const statusMd = safeRead(path.join(d, "status.md"));
    const persona = safeRead(path.join(d, "persona.md"));
    const todo = safeRead(path.join(d, "todo.md"));
    const inbox = listDir(path.join(d, "chat_inbox")).filter((f) => f.endsWith(".md")).map((f) => ({
      filename: f,
      content: safeRead(path.join(d, "chat_inbox", f)),
    }));
    // Assigned tasks from task board
    const tasks = parseTaskBoard().filter(
      (t) => (t.assignee || "").toLowerCase() === name.toLowerCase()
    );
    return json(res, { name, status, heartbeat, statusMd, persona, todo, inbox, tasks });
  }

  const agentLogMatch = pathname.match(/^\/api\/agents\/([^/]+)\/log$/);
  if (method === "GET" && agentLogMatch) {
    const name = decodeURIComponent(agentLogMatch[1]);
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    return json(res, parseRawLog(name));
  }

  const agentMsgMatch = pathname.match(/^\/api\/agents\/([^/]+)\/message$/);
  if (method === "POST" && agentMsgMatch) {
    const name = decodeURIComponent(agentMsgMatch[1]);
    const inboxDir = path.join(EMPLOYEES_DIR, name, "chat_inbox");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const body = await parseBody(req);
    if (!body.message) return badRequest(res, "missing message");
    const from = body.from || "dashboard";
    const filename = `${nowStamp()}_from_${from}.md`;
    try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    fs.writeFileSync(path.join(inboxDir, filename), body.message);
    return json(res, { ok: true, filename });
  }

  const agentStopMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
  if (method === "POST" && agentStopMatch) {
    const name = decodeURIComponent(agentStopMatch[1]);
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
    const name = decodeURIComponent(agentPingMatch[1]);
    execFile("pgrep", ["-f", `run_agent.sh ${name}`], {}, (err, stdout) => {
      const pids = stdout.trim().split("\n").filter(Boolean);
      const running = pids.length > 0;
      json(res, { name, running, pids });
    });
    return;
  }

  const agentStartMatch = pathname.match(/^\/api\/agents\/([^/]+)\/start$/);
  if (method === "POST" && agentStartMatch) {
    const name = decodeURIComponent(agentStartMatch[1]);
    const script = path.join(DIR, "run_subset.sh");
    if (!fs.existsSync(script)) return notFound(res, "run_subset.sh not found");
    // Fire-and-forget: run_subset.sh is a long-running loop, don't wait for it
    const child = spawn("bash", [script, name], { cwd: DIR, detached: true, stdio: "ignore" });
    child.unref();
    return json(res, { ok: true, message: "Agent " + name + " starting in background" });
  }

  // ---- Bulk agent controls ----
  if (method === "POST" && pathname === "/api/agents/start-all") {
    const script = path.join(DIR, "run_all.sh");
    execFile("bash", [script], { cwd: DIR }, () => {});
    return json(res, { ok: true });
  }
  if (method === "POST" && pathname === "/api/agents/stop-all") {
    const script = path.join(DIR, "stop_all.sh");
    execFile("bash", [script], { cwd: DIR }, () => {});
    return json(res, { ok: true });
  }

  // ---- Agent sub-resource GET routes ----
  const agentSubMatch = pathname.match(/^\/api\/agents\/([^/]+)\/(inbox|activity|status|todo|persona)$/);
  if (method === "GET" && agentSubMatch) {
    const name = decodeURIComponent(agentSubMatch[1]);
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
    const name = decodeURIComponent(agentInboxPostMatch[1]);
    const inboxDir = path.join(EMPLOYEES_DIR, name, "chat_inbox");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const body = await parseBody(req);
    if (!body.message) return badRequest(res, "missing message");
    const from = body.from || "dashboard";
    const filename = `${nowStamp()}_from_${from}.md`;
    try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    fs.writeFileSync(path.join(inboxDir, filename), body.message);
    return json(res, { ok: true, filename });
  }

  const agentCtxMatch = pathname.match(/^\/api\/agents\/([^/]+)\/lastcontext$/);
  if (method === "GET" && agentCtxMatch) {
    const name = decodeURIComponent(agentCtxMatch[1]);
    const d = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(d)) return notFound(res, "agent not found");
    const content = safeRead(path.join(d, "last_context.md")) || "";
    return json(res, { name, content });
  }

  // ---- Tasks ----
  if (method === "GET" && pathname === "/api/tasks") {
    return json(res, parseTaskBoard());
  }

  if (method === "POST" && pathname === "/api/tasks") {
    const body = await parseBody(req);
    if (!body.title) return badRequest(res, "missing title");
    try {
      const id = appendTaskRow(body);
      return json(res, { ok: true, id }, 201);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  const taskPatchMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (method === "PATCH" && taskPatchMatch) {
    const id = taskPatchMatch[1];
    const body = await parseBody(req);
    const ok = updateTaskRow(id, body);
    return ok ? json(res, { ok: true }) : notFound(res, "task not found");
  }

  const taskDeleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (method === "DELETE" && taskDeleteMatch) {
    const id = decodeURIComponent(taskDeleteMatch[1]);
    const tbPath = path.join(PUBLIC_DIR, "task_board.md");
    const raw = safeRead(tbPath);
    if (!raw) return notFound(res, "task board not found");
    const lines = raw.split("\n");
    const filtered = lines.filter((line) => {
      if (!line.trim().startsWith("|")) return true;
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      return cols.length < 1 || String(cols[0]) !== String(id);
    });
    if (filtered.length === lines.length) return notFound(res, "task not found");
    fs.writeFileSync(tbPath, filtered.join("\n"));
    return json(res, { ok: true });
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
    if (!body.message) return badRequest(res, "missing message");
    const from = body.from || "ceo";
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
    if (!body.message) return badRequest(res, "missing message");
    const from = body.from || "dashboard";
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
    const script = path.join(DIR, "switch_mode.sh");
    if (!fs.existsSync(script)) return notFound(res, "switch_mode.sh not found");
    const args = [script, body.mode];
    if (body.who) args.push(body.who);
    if (body.reason) args.push(body.reason);
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
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // ---- Fallback ----
  notFound(res, `no route for ${method} ${pathname}`);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("Unhandled error:", err);
    try {
      json(res, { error: "internal server error" }, 500);
    } catch (_) { /* headers already sent */ }
  });
});

server.listen(PORT, () => {
  console.log(`Tokenfly Agent Team Lab — dashboard on http://localhost:${PORT}`);
  console.log(`Directory: ${DIR}`);
  console.log(`Agents: ${listAgentNames().join(", ")}`);
});
