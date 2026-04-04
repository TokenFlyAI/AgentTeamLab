/**
 * Tokenfly Agent Team Lab — Backend API Module
 * Bob (Backend Engineer) — Task 2: Beta task
 *
 * REST API for agent status, task board, and messaging.
 * Designed to be mounted into server.js or run standalone.
 *
 * Endpoints:
 *   GET  /api/agents              — list all agents with status
 *   GET  /api/agents/:name        — single agent detail
 *   GET  /api/tasks               — list all tasks from task_board.md
 *   GET  /api/tasks/:id           — get a single task by ID
 *   POST /api/tasks               — create a new task
 *   PATCH /api/tasks/:id          — update a task (status, assignee, priority)
 *   DELETE /api/tasks/:id         — delete a task
 *   POST /api/messages/:agent     — send a DM to an agent
 *   GET  /api/health              — server health check
 */

"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const SERVER_START = Date.now();

// ---------------------------------------------------------------------------
// SEC-001: API key authentication
// Set API_KEY env var to enable. If unset, auth is skipped (dev mode).
// Accepts: Authorization: Bearer <key>  OR  X-API-Key: <key>
// ---------------------------------------------------------------------------
const API_KEY = process.env.API_KEY || "";

function isAuthorized(req) {
  if (!API_KEY) return true;
  const authHeader = req.headers["authorization"] || "";
  const xApiKey    = req.headers["x-api-key"] || "";
  const provided   = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : xApiKey;
  if (!provided) return false;
  // SEC-013: use null-byte padding (Buffer.alloc) not space-padding (padEnd).
  // padEnd makes "abc " === "abc" after padding — a trailing-space bypass.
  try {
    const keyLen = Math.max(provided.length, API_KEY.length, 1);
    const a = Buffer.alloc(keyLen);
    const b = Buffer.alloc(keyLen);
    Buffer.from(provided).copy(a);
    Buffer.from(API_KEY).copy(b);
    const lengthMatch = provided.length === API_KEY.length;
    return lengthMatch && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Request metrics — file-based queue (zero-dep)
// Written as JSONL; drained to PostgreSQL by backend/db_sync.js
// ---------------------------------------------------------------------------
function recordRequestMetric(endpoint, method, statusCode, durationMs, dir) {
  const metricsQueue = path.join(dir || DEFAULT_DIR, "backend", "metrics_queue.jsonl");
  const row = JSON.stringify({
    endpoint,
    method,
    status_code: statusCode,
    duration_ms: Math.round(durationMs),
    recorded_at: new Date().toISOString(),
  });
  try { fs.appendFileSync(metricsQueue, row + "\n"); } catch (_) { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_DIR = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeRead(p) {
  try { return fs.readFileSync(p, "utf8"); } catch (_) { return null; }
}

function safeWrite(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

function listDir(p) {
  try { return fs.readdirSync(p); } catch (_) { return []; }
}

function fileMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch (_) { return null; }
}

function timestamp() {
  return new Date().toISOString()
    .replace(/[-:T]/g, "_")
    .replace(/\.\d{3}Z$/, "");
}

// Prevent markdown table injection — strip pipes and newlines from task fields
// (SEC-003 / QI-012: a literal `|` in a title/description breaks the table row)
function sanitizeTaskField(value) {
  return String(value).replace(/[|\r\n]/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function listAgents(dir) {
  const agentsDir = path.join(dir, "agents");
  const names = listDir(agentsDir).filter((n) => {
    if (!AGENT_NAME_RE.test(n) || n.length > 64) return false;
    try { return fs.statSync(path.join(agentsDir, n)).isDirectory(); } catch (_) { return false; }
  });

  return names.map((name) => {
    const base = path.join(agentsDir, name);
    const statusRaw = safeRead(path.join(base, "status.md")) || "";
    const heartbeatRaw = safeRead(path.join(base, "heartbeat.md")) || "";
    const heartbeatMtime = fileMtime(path.join(base, "heartbeat.md"));
    const aliveThresholdMs = 5 * 60 * 1000; // 5 min
    const isAlive = heartbeatMtime && Date.now() - heartbeatMtime < aliveThresholdMs;

    // Parse current task from status.md (## Current Task section)
    const currentTaskMatch = statusRaw.match(/## Current Task\s*\n([\s\S]*?)(?=\n##|\n$|$)/);
    const currentTask = currentTaskMatch ? currentTaskMatch[1].trim() : null;

    // Count unread inbox messages
    const inboxDir = path.join(base, "chat_inbox");
    const inboxFiles = listDir(inboxDir).filter(
      (f) => !f.startsWith("read_") && f.endsWith(".md")
    );

    return {
      name,
      alive: Boolean(isAlive),
      heartbeat_at: heartbeatMtime ? new Date(heartbeatMtime).toISOString() : null,
      current_task: currentTask,
      unread_messages: inboxFiles.length,
      executor: getExecutorForAgent(dir, name),
    };
  });
}

function getAgent(dir, name) {
  const agentsDir = path.join(dir, "agents");
  const base = path.join(agentsDir, name);
  if (!fs.existsSync(base)) return null;

  const statusRaw = safeRead(path.join(base, "status.md")) || "";
  const heartbeatMtime = fileMtime(path.join(base, "heartbeat.md"));
  const aliveThresholdMs = 5 * 60 * 1000;
  const isAlive = heartbeatMtime && Date.now() - heartbeatMtime < aliveThresholdMs;

  const inboxDir = path.join(base, "chat_inbox");
  const inboxFiles = listDir(inboxDir).filter((f) => f.endsWith(".md"));
  // Return metadata only — no content to prevent unauthenticated data exposure (QI-003)
  const inbox = inboxFiles.map((f) => ({
    file: f,
    read: f.startsWith("read_"),
  }));

  return {
    name,
    alive: Boolean(isAlive),
    heartbeat_at: heartbeatMtime ? new Date(heartbeatMtime).toISOString() : null,
    status_md: statusRaw,
    inbox,
    executor: getExecutorForAgent(dir, name),
  };
}

// ---------------------------------------------------------------------------
// Tasks — parse/serialize task_board.md
// ---------------------------------------------------------------------------

const TASK_BOARD_PATH_REL = "public/task_board.md";

function parseTaskBoard(dir) {
  const raw = safeRead(path.join(dir, TASK_BOARD_PATH_REL)) || "";
  const tasks = [];

  for (const line of raw.split("\n")) {
    // Match table rows: | id | title | description | priority | assignee | status | created | updated |
    const m = line.match(
      /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/
    );
    if (!m) continue;
    tasks.push({
      id: parseInt(m[1], 10),
      title:       m[2].trim(),
      description: m[3].trim(),
      priority:    m[4].trim(),
      assignee:    m[5].trim(),
      status:      m[6].trim(),
      created:     m[7].trim(),
      updated:     m[8].trim(),
    });
  }
  return tasks;
}

function serializeTaskBoard(dir, tasks) {
  const header = `# Task Board\n\n## Tasks\n| ID | Title | Description | Priority | Assignee | Status | Created | Updated |\n|----|-------|-------------|----------|----------|--------|---------|---------|`;
  const rows = tasks
    .map(
      (t) =>
        `| ${t.id} | ${t.title} | ${t.description || ""} | ${t.priority} | ${t.assignee} | ${t.status} | ${t.created} | ${t.updated} |`
    )
    .join("\n");
  safeWrite(path.join(dir, TASK_BOARD_PATH_REL), `${header}\n${rows}\n`);
}

function nextTaskId(tasks) {
  return tasks.length > 0 ? Math.max(...tasks.map((t) => t.id)) + 1 : 1;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function sendMessage(dir, agentName, content, from = "api") {
  const inboxDir = path.join(dir, "agents", agentName, "chat_inbox");
  if (!fs.existsSync(path.join(dir, "agents", agentName))) {
    return { ok: false, error: `Agent '${agentName}' not found` };
  }
  fs.mkdirSync(inboxDir, { recursive: true });
  const ts = timestamp();
  // Sanitize from field to prevent path traversal / filename injection (Task #12)
  const safeFrom = String(from || "api").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const filename = `${ts}_from_${safeFrom}.md`;
  safeWrite(path.join(inboxDir, filename), content);
  return { ok: true, file: filename };
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

/**
 * Handle an API request.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               dir   — company root dir
 * @returns {boolean}  true if this function handled the request
 */
function handleApiRequest(req, res, dir) {
  dir = dir || DEFAULT_DIR;
  const reqStart = Date.now();
  const parsed = new URL(req.url, `http://localhost`);
  const pathname = parsed.pathname;

  // POST /api/login — Agent authentication endpoint
  // Returns a session token for subsequent authenticated requests
  if (req.method === "POST" && pathname === "/api/login") {
    parseBody((body) => {
      const { agent_name, password } = body;
      if (!agent_name || !password) {
        return err(400, "agent_name and password are required");
      }
      
      // Validate agent name format (security: prevent path traversal)
      if (!AGENT_NAME_RE.test(agent_name)) {
        return err(400, "Invalid agent name format");
      }
      
      // Check if agent exists
      const agent = getAgent(dir, agent_name);
      if (!agent) {
        // Return same error as wrong password to prevent username enumeration
        return err(401, "Invalid credentials");
      }
      
      // Verify password against environment variable or default
      // Format: AGENT_PASSWORD_<AGENT_NAME_UPPER>=<password>
      const envPassword = process.env[`AGENT_PASSWORD_${agent_name.toUpperCase()}`];
      const isValid = verifyPassword(password, envPassword);
      
      if (!isValid) {
        return err(401, "Invalid credentials");
      }
      
      // Generate session token
      const token = generateSessionToken(agent_name);
      
      json(200, {
        success: true,
        agent: agent_name,
        token: token,
        token_type: "Bearer",
        expires_in: 86400, // 24 hours
      });
    });
    return true;
  }

  // Health check must be reachable without auth (load balancers, monitoring probes)
  if (req.method === "GET" && pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime_ms: Date.now() - SERVER_START }));
    recordRequestMetric(pathname, "GET", 200, Date.now() - reqStart, dir);
    return true;
  }

  // SEC-001: require valid API key when API_KEY env var is set
  if (!isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    recordRequestMetric(pathname, req.method.toUpperCase(), 401, Date.now() - reqStart, dir);
    return true;
  }

  function json(status, body) {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(payload);
    recordRequestMetric(pathname, req.method.toUpperCase(), status, Date.now() - reqStart, dir);
    return true;
  }

  function err(status, msg) {
    return json(status, { error: msg });
  }

  function parseBody(cb) {
    const MAX_BODY = 512 * 1024; // 512 KB
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        req.destroy();
        err(413, "Request body too large");
      }
    });
    req.on("end", () => {
      try { cb(JSON.parse(body || "{}")); }
      catch (_) { err(400, "Invalid JSON body"); }
    });
  }

  const method = req.method.toUpperCase();

  // OPTIONS (CORS preflight)
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return true;
  }

  // GET /api/agents
  if (method === "GET" && pathname === "/api/agents") {
    return json(200, listAgents(dir));
  }

  // GET /api/agents/:name
  const agentDetailMatch = pathname.match(/^\/api\/agents\/([a-zA-Z0-9_-]+)$/);
  if (method === "GET" && agentDetailMatch) {
    const name = agentDetailMatch[1];
    const agent = getAgent(dir, name);
    if (!agent) return err(404, `Agent '${name}' not found`);
    return json(200, agent);
  }

  // GET /api/tasks
  if (method === "GET" && pathname === "/api/tasks") {
    const tasks = parseTaskBoard(dir);
    // Support ?assignee=bob or ?status=open filters
    const assignee = parsed.searchParams.get("assignee");
    const status   = parsed.searchParams.get("status");
    const filtered = tasks.filter((t) => {
      if (assignee && t.assignee.toLowerCase() !== assignee.toLowerCase()) return false;
      if (status   && t.status.toLowerCase()   !== status.toLowerCase())   return false;
      return true;
    });
    return json(200, filtered);
  }

  // GET /api/tasks/:id
  const taskDetailMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (method === "GET" && taskDetailMatch) {
    const id = parseInt(taskDetailMatch[1], 10);
    const tasks = parseTaskBoard(dir);
    const task = tasks.find((t) => t.id === id);
    if (!task) return err(404, `Task ${id} not found`);
    return json(200, task);
  }

  // POST /api/tasks
  if (method === "POST" && pathname === "/api/tasks") {
    parseBody((body) => {
      const { title, description, priority, assignee } = body;
      if (!title || !String(title).trim()) {
        console.warn("[POST /api/tasks] 400 missing/empty title:", JSON.stringify(body));
        return err(400, "title is required");
      }
      const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
      const resolvedPriority = (priority || "medium").toLowerCase();
      if (!VALID_PRIORITIES.includes(resolvedPriority)) {
        console.warn("[POST /api/tasks] 400 bad priority:", JSON.stringify(body));
        return err(400, `priority must be one of: ${VALID_PRIORITIES.join(", ")}`);
      }
      const tasks = parseTaskBoard(dir);
      const today = new Date().toISOString().slice(0, 10);
      const task = {
        id:          nextTaskId(tasks),
        title:       sanitizeTaskField(title),
        description: description ? sanitizeTaskField(description) : "",
        priority:    resolvedPriority,
        assignee:    (assignee || "unassigned").toLowerCase(),
        status:      "open",
        created:     today,
        updated:     today,
      };
      tasks.push(task);
      serializeTaskBoard(dir, tasks);
      json(201, task);
    });
    return true;
  }

  // PATCH /api/tasks/:id
  const taskUpdateMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (method === "PATCH" && taskUpdateMatch) {
    const id = parseInt(taskUpdateMatch[1], 10);
    parseBody((body) => {
      const tasks = parseTaskBoard(dir);
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) return err(404, `Task ${id} not found`);
      const VALID_STATUSES   = ["open", "in_progress", "blocked", "in_review", "done", "cancelled"];
      const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
      if (body.status   !== undefined && !VALID_STATUSES.includes(String(body.status).toLowerCase())) {
        console.warn(`[PATCH /api/tasks/${id}] 400 bad status:`, JSON.stringify(body));
        return err(400, `status must be one of: ${VALID_STATUSES.join(", ")}`);
      }
      if (body.priority !== undefined && !VALID_PRIORITIES.includes(String(body.priority).toLowerCase())) {
        console.warn(`[PATCH /api/tasks/${id}] 400 bad priority:`, JSON.stringify(body));
        return err(400, `priority must be one of: ${VALID_PRIORITIES.join(", ")}`);
      }
      const allowed = ["title", "description", "priority", "assignee", "status"];
      const caseNormalized = new Set(["status", "priority", "assignee"]);
      const pipeEscaped    = new Set(["title", "description"]);
      for (const field of allowed) {
        if (body[field] !== undefined) {
          const v = pipeEscaped.has(field)
            ? sanitizeTaskField(body[field])
            : String(body[field]).trim();
          tasks[idx][field] = caseNormalized.has(field) ? v.toLowerCase() : v;
        }
      }
      // Auto-set completed_at when task transitions to done (schema constraint)
      if (body.status === "done" && !tasks[idx].completed_at) {
        tasks[idx].completed_at = new Date().toISOString();
      }
      tasks[idx].updated = new Date().toISOString().slice(0, 10);
      serializeTaskBoard(dir, tasks);
      json(200, tasks[idx]);
    });
    return true;
  }

  // DELETE /api/tasks/:id
  if (method === "DELETE" && taskUpdateMatch) {
    const id = parseInt(taskUpdateMatch[1], 10);
    const tasks = parseTaskBoard(dir);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return err(404, `Task ${id} not found`);
    const removed = tasks.splice(idx, 1)[0];
    serializeTaskBoard(dir, tasks);
    return json(200, { deleted: removed });
  }

  // POST /api/messages/:agent
  const msgMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9_-]+)$/);
  if (method === "POST" && msgMatch) {
    const agentName = msgMatch[1];
    parseBody((body) => {
      const { content, from } = body;
      if (!content) return err(400, "content is required");
      const result = sendMessage(dir, agentName, String(content), from || "api");
      if (!result.ok) return err(404, result.error);
      json(201, result);
    });
    return true;
  }

  // GET /api/executors — list supported executors
  if (method === "GET" && pathname === "/api/executors") {
    return json(200, { executors: VALID_EXECUTORS, default: "claude" });
  }

  // GET /api/agents/:name/executor — get executor for specific agent
  const agentExecutorMatch = pathname.match(/^\/api\/agents\/([a-zA-Z0-9_-]+)\/executor$/);
  if (method === "GET" && agentExecutorMatch) {
    const name = agentExecutorMatch[1];
    if (!getAgent(dir, name)) return err(404, `Agent '${name}' not found`);
    return json(200, { name, executor: getExecutorForAgent(dir, name) });
  }

  // POST /api/agents/:name/executor — set executor for specific agent
  if (method === "POST" && agentExecutorMatch) {
    const name = agentExecutorMatch[1];
    parseBody((body) => {
      if (!body.executor) return err(400, "executor is required");
      const result = setExecutorForAgent(dir, name, String(body.executor).toLowerCase());
      if (!result.ok) return err(400, result.error);
      json(200, { name, executor: result.executor });
    });
    return true;
  }

  // GET /api/config/executor — get all agent executors
  if (method === "GET" && pathname === "/api/config/executor") {
    return json(200, {
      default: "claude",
      agents: getAllExecutors(dir),
    });
  }

  // Not an API route
  return false;
}

// ---------------------------------------------------------------------------
// Executor Configuration
// ---------------------------------------------------------------------------

const EXECUTOR_CONFIG_PATH = path.join(DEFAULT_DIR, "public", "executor_config.md");
const VALID_EXECUTORS = ["claude", "kimi"];

function getExecutorForAgent(dir, name) {
  // Priority 1: per-agent executor.txt
  const agentExecutorPath = path.join(dir, "agents", name, "executor.txt");
  try {
    const content = fs.readFileSync(agentExecutorPath, "utf8").trim().toLowerCase();
    if (VALID_EXECUTORS.includes(content)) return content;
  } catch (_) {}

  // Priority 2: global config file per-agent table
  try {
    const config = fs.readFileSync(EXECUTOR_CONFIG_PATH, "utf8");
    const lines = config.split("\n");
    for (const line of lines) {
      const match = line.match(/^\|\s*(\w+)\s*\|\s*(claude|kimi)\s*\|/i);
      if (match && match[1].toLowerCase() === name.toLowerCase()) {
        return match[2].toLowerCase();
      }
    }
  } catch (_) {}

  // Priority 3: global default
  try {
    const config = fs.readFileSync(EXECUTOR_CONFIG_PATH, "utf8");
    const defaultMatch = config.match(/## Global Default[\s\S]*?^executor:\s*(claude|kimi)/im);
    if (defaultMatch) return defaultMatch[1].toLowerCase();
  } catch (_) {}

  // Fallback
  return "claude";
}

function setExecutorForAgent(dir, name, executor) {
  if (!VALID_EXECUTORS.includes(executor)) {
    return { ok: false, error: `Invalid executor: ${executor}. Must be: ${VALID_EXECUTORS.join(", ")}` };
  }
  const agentDir = path.join(dir, "agents", name);
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "executor.txt"), executor, "utf8");
    return { ok: true, executor };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getAllExecutors(dir) {
  const agents = listAgents(dir);
  const result = {};
  for (const agent of agents) {
    result[agent.name] = getExecutorForAgent(dir, agent.name);
  }
  return result;
}

module.exports = { handleApiRequest, parseTaskBoard, serializeTaskBoard, listAgents, getAgent, sendMessage, getExecutorForAgent };
