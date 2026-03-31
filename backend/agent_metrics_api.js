/**
 * Agent Metrics API — Tokenfly Agent Team Lab
 * Task: Beta task (Task ID: 2)
 * Author: Bob (Backend Engineer)
 * Date: 2026-03-29
 *
 * REST API module for agent performance metrics.
 * Can be mounted into server.js or run standalone.
 *
 * Endpoints:
 *   GET  /api/metrics/agents          — All agents summary with status + task info
 *   GET  /api/metrics/agents/:name    — Single agent detailed metrics
 *   GET  /api/metrics/tasks           — Task board metrics (open/done counts by priority)
 *   GET  /api/metrics/health          — System health snapshot
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// SEC-010: API key authentication
// Set API_KEY env var to enable. If unset, auth is skipped (dev mode).
// Accepts: Authorization: Bearer <key>  OR  X-API-Key: <key>
// ---------------------------------------------------------------------------
const API_KEY = process.env.API_KEY || "";

function isAuthorized(req) {
  if (!API_KEY) return true;
  const authHeader = req.headers["authorization"] || "";
  const xApiKey = req.headers["x-api-key"] || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : xApiKey;
  if (!provided) return false;
  try {
    const keyLen = Math.max(provided.length, API_KEY.length, 1);
    const a = Buffer.alloc(keyLen);
    const b = Buffer.alloc(keyLen);
    Buffer.from(provided).copy(a);
    Buffer.from(API_KEY).copy(b);
    return provided.length === API_KEY.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_DIR = path.resolve(__dirname, "../../..");
const HEARTBEAT_STALE_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function safeRead(p) {
  try { return fs.readFileSync(p, "utf8"); } catch (_) { return null; }
}

function fileMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch (_) { return null; }
}

function listDirs(p) {
  try {
    return fs.readdirSync(p).filter((n) => {
      try { return fs.statSync(path.join(p, n)).isDirectory(); } catch (_) { return false; }
    });
  } catch (_) { return []; }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse a markdown task board table into structured task objects.
 * Handles the format used in public/task_board.md.
 */
function parseTaskBoard(raw) {
  if (!raw) return [];
  const tasks = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("|")) continue;
    // Split on | preserving empty cells, trim each, drop leading/trailing empty from outer pipes
    const parts = line.split("|").map((c) => c.trim());
    // parts[0] and parts[last] are empty (before/after outer pipes) — slice them off
    const cols = parts.slice(1, parts.length - 1);
    if (cols.length < 6) continue;
    const [id, title, description, priority, assignee, status, created, updated] = cols;
    if (!id || isNaN(Number(id))) continue; // skip header/separator rows
    tasks.push({
      id: Number(id),
      title: title || "",
      description: description || "",
      priority: (priority || "").toLowerCase(),
      assignee: (assignee || "").toLowerCase(),
      status: (status || "open").toLowerCase(),
      created: created || null,
      updated: updated || null,
    });
  }
  return tasks;
}

/**
 * Parse agent heartbeat.md into a key-value map.
 */
function parseHeartbeat(raw) {
  if (!raw) return null;
  const hb = {};
  for (const line of raw.split("\n")) {
    const m =
      line.match(/^(\w[\w\s]*?):\s*(.+)/) ||
      line.match(/^[-*]\s*\*\*(\w[\w\s]*?)\*\*:\s*(.+)/);
    if (m) hb[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = m[2].trim();
  }
  return Object.keys(hb).length > 0 ? hb : null;
}

/**
 * Extract current task description from status.md.
 */
function extractCurrentTask(statusRaw) {
  if (!statusRaw) return null;
  const m =
    statusRaw.match(/##\s*Current(?:ly Working On|Task)[:\s]*\n+([^\n#]+)/) ||
    statusRaw.match(/current.*?(?:task|focus)[:\s]+([^\n]+)/i);
  return m ? m[1].trim() : null;
}

/**
 * Extract blockers section from status.md.
 */
function extractBlockers(statusRaw) {
  if (!statusRaw) return [];
  const m = statusRaw.match(/##\s*Blockers?\s*\n([\s\S]*?)(?:\n##|$)/i);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l && l.toLowerCase() !== "none" && l !== "");
}

// ---------------------------------------------------------------------------
// Core data functions
// ---------------------------------------------------------------------------

function getAgentMetrics(name, companyDir) {
  const agentDir = path.join(companyDir, "agents", name);
  const hbPath = path.join(agentDir, "heartbeat.md");
  const statusPath = path.join(agentDir, "status.md");

  const hbRaw = safeRead(hbPath);
  const statusRaw = safeRead(statusPath);
  const heartbeat = parseHeartbeat(hbRaw);

  const hbMtime = fileMtime(hbPath);
  const statusMtime = fileMtime(statusPath);
  const now = Date.now();

  // Determine liveness
  const hbAgeMs = hbMtime ? now - hbMtime : null;
  const isAlive = hbAgeMs !== null && hbAgeMs < HEARTBEAT_STALE_MS;
  const statusStr = heartbeat ? (heartbeat.status || "unknown") : "unknown";

  // Check today's log for recent activity
  const d = new Date();
  const dateStr = `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,"0")}_${String(d.getDate()).padStart(2,"0")}`;
  const logMtime = fileMtime(path.join(agentDir, "logs", `${dateStr}_raw.log`));
  const logAgeMs = logMtime ? now - logMtime : null;
  const recentLog = logAgeMs !== null && logAgeMs < 2 * 60 * 1000; // active in last 2 min

  const liveStatus = recentLog ? "running" : (isAlive ? statusStr : "offline");

  // Inbox message count
  const inboxDir = path.join(agentDir, "chat_inbox");
  let inboxCount = 0;
  try {
    inboxCount = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md") && !f.startsWith("read_")).length;
  } catch (_) {}

  return {
    name,
    status: liveStatus,
    heartbeat_age_ms: hbAgeMs,
    log_age_ms: logAgeMs,
    current_task: extractCurrentTask(statusRaw) || (heartbeat && heartbeat.task) || null,
    blockers: extractBlockers(statusRaw),
    inbox_unread: inboxCount,
    last_status_update: statusMtime ? new Date(statusMtime).toISOString() : null,
    last_heartbeat: hbMtime ? new Date(hbMtime).toISOString() : null,
  };
}

function getAllAgentsMetrics(companyDir) {
  const names = listDirs(path.join(companyDir, "agents"));
  return names.map((name) => getAgentMetrics(name, companyDir));
}

function getTaskMetrics(companyDir) {
  const raw = safeRead(path.join(companyDir, "public", "task_board.md"));
  const tasks = parseTaskBoard(raw);

  const byPriority = { critical: 0, high: 0, medium: 0, low: 0, other: 0 };
  const byStatus = { open: 0, in_progress: 0, blocked: 0, in_review: 0, done: 0, cancelled: 0, other: 0 };
  const byAssignee = {};

  for (const t of tasks) {
    const p = byPriority.hasOwnProperty(t.priority) ? t.priority : "other";
    byPriority[p]++;
    const s = byStatus.hasOwnProperty(t.status) ? t.status : "other";
    byStatus[s]++;
    if (t.assignee) {
      byAssignee[t.assignee] = (byAssignee[t.assignee] || 0) + 1;
    }
  }

  return {
    total: tasks.length,
    by_priority: byPriority,
    by_status: byStatus,
    by_assignee: byAssignee,
    tasks,
  };
}

function getSystemHealth(companyDir) {
  const agents = getAllAgentsMetrics(companyDir);
  const running = agents.filter((a) => a.status === "running").length;
  const offline = agents.filter((a) => a.status === "offline").length;
  const blocked = agents.filter((a) => a.blockers.length > 0).length;
  const withInbox = agents.filter((a) => a.inbox_unread > 0).length;

  const modeRaw = safeRead(path.join(companyDir, "public", "company_mode.md"));
  let mode = "unknown";
  if (modeRaw) {
    const m = modeRaw.match(/\*\*(\w+)\*\*/);
    if (m) mode = m[1].toLowerCase();
  }

  return {
    timestamp: new Date().toISOString(),
    mode,
    agents: {
      total: agents.length,
      running,
      offline,
      blocked,
      with_unread_inbox: withInbox,
    },
    health_score: agents.length > 0 ? Math.round((running / agents.length) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Request router (usable standalone or integrated into server.js)
// ---------------------------------------------------------------------------

/**
 * Handle a metrics API request.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} companyDir - root directory of the company
 * @returns {boolean} true if request was handled
 */
function handleMetricsRequest(req, res, companyDir) {
  const parsed = new URL(req.url, "http://localhost");
  const pathname = parsed.pathname.replace(/\/$/, "");
  const method = req.method.toUpperCase();

  function respond(data, status) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status || 200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": res._corsOrigin || "*",
    });
    res.end(body);
  }

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": res._corsOrigin || "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    });
    res.end();
    return true;
  }

  if (!pathname.startsWith("/api/metrics")) return false;

  // SEC-010: require valid API key when API_KEY env var is set
  if (!isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  if (method !== "GET") {
    respond({ error: "Method not allowed" }, 405);
    return true;
  }

  // GET /api/metrics/agents
  if (pathname === "/api/metrics/agents") {
    respond(getAllAgentsMetrics(companyDir));
    return true;
  }

  // GET /api/metrics/agents/:name
  const agentMatch = pathname.match(/^\/api\/metrics\/agents\/([a-z0-9_-]+)$/i);
  if (agentMatch) {
    const name = agentMatch[1].toLowerCase();
    const agentDir = path.join(companyDir, "agents", name);
    if (!fs.existsSync(agentDir)) {
      respond({ error: `Agent '${name}' not found` }, 404);
      return true;
    }
    respond(getAgentMetrics(name, companyDir));
    return true;
  }

  // GET /api/metrics/tasks
  if (pathname === "/api/metrics/tasks") {
    respond(getTaskMetrics(companyDir));
    return true;
  }

  // GET /api/metrics/health
  if (pathname === "/api/metrics/health") {
    respond(getSystemHealth(companyDir));
    return true;
  }

  // GET /api/metrics (index)
  if (pathname === "/api/metrics") {
    respond({
      endpoints: [
        "GET /api/metrics/agents",
        "GET /api/metrics/agents/:name",
        "GET /api/metrics/tasks",
        "GET /api/metrics/health",
      ],
    });
    return true;
  }

  respond({ error: "Unknown metrics endpoint" }, 404);
  return true;
}

// ---------------------------------------------------------------------------
// Standalone mode
// ---------------------------------------------------------------------------
if (require.main === module) {
  const http = require("http");
  const companyDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DIR;
  const port = parseInt(process.argv[3] || "3101", 10);

  const server = http.createServer((req, res) => {
    if (!handleMetricsRequest(req, res, companyDir)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found — this is the metrics API server\n");
    }
  });

  server.listen(port, () => {
    console.log(`[agent-metrics-api] Listening on http://localhost:${port}`);
    console.log(`[agent-metrics-api] Company dir: ${companyDir}`);
    console.log("Endpoints:");
    console.log(`  GET http://localhost:${port}/api/metrics`);
    console.log(`  GET http://localhost:${port}/api/metrics/agents`);
    console.log(`  GET http://localhost:${port}/api/metrics/agents/<name>`);
    console.log(`  GET http://localhost:${port}/api/metrics/tasks`);
    console.log(`  GET http://localhost:${port}/api/metrics/health`);
  });
}

// ---------------------------------------------------------------------------
// Exports (for integration into server.js)
// ---------------------------------------------------------------------------
module.exports = {
  handleMetricsRequest,
  getAgentMetrics,
  getAllAgentsMetrics,
  getTaskMetrics,
  getSystemHealth,
  parseTaskBoard,
  parseHeartbeat,
};
