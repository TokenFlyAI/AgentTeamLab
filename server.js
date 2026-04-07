#!/usr/bin/env node
/**
 * Agent Planet Dashboard Server
 * Zero-dependency Node.js HTTP server.
 * Usage: node server.js [--port 3100] [--dir /path/to/civilization]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { execFile, spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const {
  DEFAULT_EXECUTOR,
  getEnabledExecutors,
  getExecutorMeta,
  getSupportedExecutors,
  isEnabledExecutor,
  isValidExecutor,
  normalizeExecutorName,
} = require("./lib/executors");

// ---------------------------------------------------------------------------
// Production metrics recording (for Ivan's api_error_monitor.js)
// Writes to same file as backend/api.js so monitoring pipeline sees prod traffic
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Planet-aware path resolution
// ---------------------------------------------------------------------------
function resolvePlanet(dir) {
  const planetJson = path.join(dir, "planet.json");
  if (fs.existsSync(planetJson)) {
    try {
      const { active, planets_dir } = JSON.parse(fs.readFileSync(planetJson, "utf8"));
      const planetDir = path.join(dir, planets_dir || "planets", active);
      if (fs.existsSync(planetDir)) {
        return {
          EMPLOYEES_DIR: path.join(planetDir, "agents"),
          PUBLIC_DIR: path.join(planetDir, "shared"),
          OUTPUT_DIR: path.join(planetDir, "output"),
          DATA_DIR: path.join(planetDir, "data"),
          PLANET_DIR: planetDir,
          PLANET_NAME: active,
        };
      }
    } catch (_) { /* fall through to legacy */ }
  }
  // Fallback: legacy flat structure
  return {
    EMPLOYEES_DIR: path.join(dir, "agents"),
    PUBLIC_DIR: path.join(dir, "public"),
    OUTPUT_DIR: null,
    DATA_DIR: path.join(dir, "backend"),
    PLANET_DIR: dir,
    PLANET_NAME: "default",
  };
}

const METRICS_QUEUE_PATH = path.join(__dirname, "backend", "metrics_queue.jsonl");
function recordProductionMetric(endpoint, method, statusCode, durationMs) {
  const row = JSON.stringify({
    endpoint,
    method,
    status_code: statusCode,
    duration_ms: Math.round(durationMs),
    recorded_at: new Date().toISOString(),
  });
  try { fs.appendFileSync(METRICS_QUEUE_PATH, row + "\n"); } catch (_) { /* non-fatal */ }
}
// Bob's backend API module — rate limiting, validation, metrics (Task #4)
// Planet-resolved at startup; gracefully absent on planets without bob's code
const _bobPlanet = resolvePlanet(__dirname);
const _bobModulePath = _bobPlanet.OUTPUT_DIR
  ? path.join(_bobPlanet.OUTPUT_DIR, "bob")
  : path.join(__dirname, "agents", "bob", "output");
let apiMiddleware, apiMetrics, handleAgentMetricsRequest;
try {
  ({ middleware: apiMiddleware, metrics: apiMetrics } = require(path.join(_bobModulePath, "backend-api-module")));
  ({ handleMetricsRequest: handleAgentMetricsRequest } = require(path.join(_bobModulePath, "agent_metrics_api")));
} catch (_) {
  // Planet doesn't have bob's modules — provide no-op stubs
  apiMiddleware = () => false;
  apiMetrics = { requests: 0, snapshot: () => ({}), recordRequest: () => {} };
  handleAgentMetricsRequest = () => false;
}
// Bob's SQLite message bus — Task #102
let initMessageBus, handleMessageBus;
try {
  ({ initMessageBus, handleMessageBus } = require("./backend/message_bus"));
} catch (_) {
  initMessageBus = () => {};
  handleMessageBus = () => false;
}

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

let { EMPLOYEES_DIR, PUBLIC_DIR, OUTPUT_DIR, DATA_DIR, PLANET_DIR, PLANET_NAME } = resolvePlanet(DIR);

function reloadPlanet() {
  const resolved = resolvePlanet(DIR);
  EMPLOYEES_DIR = resolved.EMPLOYEES_DIR;
  PUBLIC_DIR = resolved.PUBLIC_DIR;
  OUTPUT_DIR = resolved.OUTPUT_DIR;
  DATA_DIR = resolved.DATA_DIR;
  PLANET_DIR = resolved.PLANET_DIR;
  PLANET_NAME = resolved.PLANET_NAME;
  console.log(`Planet reloaded: ${PLANET_NAME} (${PLANET_DIR})`);
}
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Advisory file lock for task_board.md (prevents parallel-write corruption)
// ---------------------------------------------------------------------------
const TASK_LOCK_PATH = path.join(DIR, ".aicompany_taskboard.lock");
let _taskLockHolder = null;

function withTaskLock(fn) {
  // Returns a Promise that resolves after fn() runs (holding the lock) or after timeout.
  // Rejects if fn() throws so callers can detect write failures.
  // Spin-wait up to 2s for lock, 50ms intervals.
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    function tryAcquire() {
      let acquired = false;
      try {
        fs.writeFileSync(TASK_LOCK_PATH, String(process.pid), { flag: "wx" });
        acquired = true;
        _taskLockHolder = true;
        try { fn(); } finally {
          try { fs.unlinkSync(TASK_LOCK_PATH); } catch (_) {}
          _taskLockHolder = null;
        }
        resolve();
      } catch (e) {
        if (!acquired && e.code === "EEXIST") {
          // Check for stale lock (>10s old = crashed holder)
          try {
            const stat = fs.statSync(TASK_LOCK_PATH);
            if (Date.now() - stat.mtimeMs > 10000) {
              try { fs.unlinkSync(TASK_LOCK_PATH); } catch (_) {}
              return tryAcquire();
            }
          } catch (_) {}
          if (Date.now() < deadline) {
            return void setTimeout(tryAcquire, 50);
          }
          // Lock held >2s by live process — proceed without lock to avoid deadlock
          console.error("[withTaskLock] timeout waiting for lock, proceeding without it");
          try { fn(); resolve(); } catch (fnErr) { reject(fnErr); }
        } else if (!acquired) {
          // Unexpected error acquiring lock — proceed without lock
          try { fn(); resolve(); } catch (fnErr) { reject(fnErr); }
        } else {
          // fn() threw while holding the lock (released by finally above)
          reject(e);
        }
      }
    }
    tryAcquire();
  });
}

// ---------------------------------------------------------------------------
// Security constants & input helpers
// ---------------------------------------------------------------------------
const MAX_BODY_BYTES = 512 * 1024; // 512 KB — guard against memory exhaustion

// API key authentication (SEC-001, Heidi security audit)
// Set API_KEY env var to enable auth. If unset, auth is skipped (dev mode).
const API_KEY = process.env.API_KEY || "";

// CORS allowed origins (SEC-012)
// Set ALLOWED_ORIGINS env var to a comma-separated list of allowed origins for
// mutation endpoints (POST/PATCH/DELETE). GET/HEAD always allow "*".
// If unset (dev mode), all origins are allowed with "*".
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
  // Constant-time comparison to prevent timing attacks.
  // Pad both to max length using null-filled Buffers (not space-padEnd which could
  // make "abc  " match "abc" when the real key is "abc").
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

/**
 * Return the CORS origin value to set in response headers (SEC-012).
 * - Mutation methods (POST/PATCH/DELETE) with ALLOWED_ORIGINS configured:
 *     reflects the request Origin only if it appears in ALLOWED_ORIGINS.
 *     Falls back to the first allowed origin (browser will block mismatches).
 * - All other cases: returns "*" (GET/HEAD, or dev mode with no ALLOWED_ORIGINS).
 */
function corsOrigin(req, method) {
  if (!["POST", "PATCH", "DELETE"].includes(method)) return "*";
  if (!ALLOWED_ORIGINS.length) return "*"; // dev mode — no restriction
  const origin = (req.headers["origin"] || "").trim();
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
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
    const agents = new Set(listAgentNames());
    // ML-001: Clean up lastPoll entries for removed agents to prevent memory leak
    for (const name of lastPoll.keys()) {
      if (!agents.has(name)) {
        lastPoll.delete(name);
        changed = true;
      }
    }
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
    broadcastWS("agents_updated", { ts: Date.now() });
  }
}, 3000);


// ---------------------------------------------------------------------------
// WebSocket — typed real-time events (Task #113)
// Replaces polling for task_claimed, task_updated, mode_changed, agent_updated
// ---------------------------------------------------------------------------
const wsClients = new Set();

// Encode a text WebSocket frame (RFC 6455, server-to-client, no masking needed)
function wsEncode(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// Broadcast a typed event to all connected WebSocket clients
function broadcastWS(type, data) {
  if (wsClients.size === 0) return;
  const frame = wsEncode(JSON.stringify({ type, ...data }));
  for (const socket of wsClients) {
    try { socket.write(frame); } catch (_) { wsClients.delete(socket); }
  }
}

// Decode a single WebSocket frame from client (ping/pong/close handling)
function wsDecode(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  if (buf.length < offset + (masked ? 4 : 0) + len) return null;
  let payload;
  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    offset += 4;
    payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i % 4];
  } else {
    payload = buf.slice(offset, offset + len);
  }
  return { opcode, payload };
}

// ---------------------------------------------------------------------------
// Auto-watchdog: every 10 minutes, restart agents whose loop is stuck
// ---------------------------------------------------------------------------
const watchdogLog = [];
setInterval(() => {
  // Respect enabled flag — don't auto-restart if smart run is disabled
  const smartRunConfigPath = path.join(PUBLIC_DIR, "smart_run_config.json");
  let smartRunEnabled = true;
  try { smartRunEnabled = JSON.parse(fs.readFileSync(smartRunConfigPath, "utf8")).enabled !== false; } catch (_) {}
  if (!smartRunEnabled) {
    console.log("[watchdog] Skipping — smart run is disabled in config");
    return;
  }
  const STALE_MS = 15 * 60 * 1000;
  const names = listAgentNames();
  names.forEach((name) => {
    // Validate agent name before using in shell commands
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.warn(`[watchdog] skipping suspicious agent directory name: ${name}`);
      return;
    }
    execFile("pgrep", ["-f", `run_subset.sh ${name}`], {}, (err, stdout) => {
      if (!stdout.trim()) return; // not running
      const hbMtime = fileMtime(path.join(EMPLOYEES_DIR, name, "heartbeat.md"));
      const age = hbMtime ? Date.now() - hbMtime : null;
      if (age !== null && age > STALE_MS) {
        const stopScript = path.join(DIR, "stop_agent.sh");
        const startScript = path.join(DIR, "run_subset.sh");
        execFile("bash", [stopScript, name], { cwd: DIR, timeout: 10000 }, () => {
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
  // Also check for recent cycle failures (agents that ran but LLM call failed)
  names.forEach((name) => {
    const failLog = path.join(EMPLOYEES_DIR, name, "logs", "cycle_failures.log");
    if (!fs.existsSync(failLog)) return;
    const lines = (safeRead(failLog) || "").trim().split("\n").filter(Boolean);
    if (!lines.length) return;
    const lastFail = lines[lines.length - 1];
    const tsMatch = lastFail.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (!tsMatch) return;
    const failAge = Date.now() - new Date(tsMatch[1]).getTime();
    // If failure was in the last 5 minutes and agent is idle, flag it
    if (failAge < 5 * 60 * 1000) {
      const hb = safeRead(path.join(EMPLOYEES_DIR, name, "heartbeat.md")) || "";
      if (hb.includes("idle")) {
        const entry = { ts: new Date().toISOString(), name, action: "cycle_failure_detected", last_fail: tsMatch[1] };
        watchdogLog.unshift(entry);
        if (watchdogLog.length > 50) watchdogLog.length = 50;
        console.log(`[watchdog] Cycle failure detected for ${name} at ${tsMatch[1]} — will be retried on next smart_run`);
      }
    }
  });
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function safeRead(p) {
  try { return fs.readFileSync(p, "utf8"); } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Short-lived in-memory cache — reduces synchronous I/O on hot paths like
// /api/agents/:name/context, which reads 19+ files per call and blocks the
// Node.js event loop when called concurrently by multiple running agents.
// ---------------------------------------------------------------------------
const _cache = new Map(); // key → { value, expiresAt }
function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = fn();
  _cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}
// Invalidate a single cache key (call after writes that should be visible immediately)
function cacheInvalidate(key) { _cache.delete(key); }
// Prune expired entries (called periodically to prevent unbounded growth)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) { if (v.expiresAt <= now) _cache.delete(k); }
}, 60_000);

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
    if (!/^[a-zA-Z0-9_-]+$/.test(n) || n.length > 64) return false;
    try {
      const dir = path.join(EMPLOYEES_DIR, n);
      if (!fs.statSync(dir).isDirectory()) return false;
      // Must have persona.md or prompt.md to be a real agent (filters out shared dirs like agents/public)
      return fs.existsSync(path.join(dir, 'persona.md')) || fs.existsSync(path.join(dir, 'prompt.md'));
    } catch (_) { return false; }
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
    const chunks = [];
    let bytes = 0;
    let settled = false;
    function settle(fn) { if (!settled) { settled = true; fn(); } }
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.socket.destroy();
        return settle(() => reject(Object.assign(new Error("request body too large"), { code: "BODY_TOO_LARGE" })));
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      settle(() => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (_) { resolve({}); }
      });
    });
    req.on("error", (err) => settle(() => reject(err)));
    req.on("close", () => settle(() => reject(new Error("request aborted"))));
  });
}

function json(res, data, status) {
  status = status || 200;
  // SEC-012: use the per-request CORS origin set in handleRequest(); fall back to "*"
  const origin = res._corsOrigin !== undefined ? res._corsOrigin : "*";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  };
  if (origin !== "*") headers["Vary"] = "Origin";
  res.writeHead(status, headers);
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
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
  // Log-file fallback: only when heartbeat is absent or "unknown" (not when
  // explicitly "idle" — that means stop_all already ran and we should trust it).
  if (status === "unknown") {
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
  let executor_issue = null;
  try {
    const rawFiles = fs.existsSync(logsDir) ? fs.readdirSync(logsDir)
      .filter(f => f.endsWith("_raw.log")).sort().reverse() : [];
    if (rawFiles.length) {
      const rPath = path.join(logsDir, rawFiles[0]);
      rawLogMtime = fileMtime(rPath);
      // Check last context for auth errors
      const ctx = safeRead(path.join(d, "last_context.md")) || "";
      if (/not logged in|please run \/login|authentication_failed|login required|unauthorized|401/i.test(ctx.slice(0, 800))) {
        auth_error = true;
      }
    }
  } catch (_) {}
  const last_update = rawLogMtime ? new Date(rawLogMtime).toISOString() : null;
  const lastSeenSecs = rawLogMtime ? Math.floor((Date.now() - rawLogMtime) / 1000) : null;

  const executor = getExecutorForAgent(name);
  const executor_health = getExecutorHealth(executor);
  if (!executor_health.runnable) executor_issue = executor_health.message;
  return { name, role, status, current_task, cycles, last_update, lastSeenSecs, heartbeat_age_ms, auth_error, executor, executor_health, executor_issue };
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

// Evict stale _statsCache entries every 5 minutes to prevent accumulation
// of entries for removed/renamed agents that are never re-requested.
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _statsCache) {
    if (now - val.ts > 300000) _statsCache.delete(key);
  }
}, 300000);

// ---------------------------------------------------------------------------
// Task board parsing - supports 3 sections: Directions, Instructions, Tasks
// ---------------------------------------------------------------------------
function parseTaskBoard() {
  const raw = safeRead(path.join(PUBLIC_DIR, "task_board.md"));
  if (!raw) return [];
  const lines = raw.split("\n");
  const tasks = [];
  let currentType = null;
  let header = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect section headers to determine task type
    if (line.startsWith("## ")) {
      const section = line.toLowerCase();
      if (section.includes("direction")) currentType = "direction";
      else if (section.includes("instruction")) currentType = "instruction";
      else if (section.includes("task")) currentType = "task";
      header = null; // Reset header when entering new section
      continue;
    }
    
    // Skip non-table lines
    if (!line.startsWith("|")) continue;
    
    // Parse header row
    if (!header && line.includes("ID") && line.includes("Title")) {
      header = line.split("|").slice(1, -1).map((c) => c.trim().toLowerCase().replace(/\s+/g, "_"));
      continue;
    }
    
    // Skip separator row
    if (line.replace(/[^a-z0-9]/gi, "").length < 3) continue;
    
    // Parse data row
    if (header && currentType) {
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cols.length < 2) continue;
      const task = { task_type: currentType };
      for (let j = 0; j < header.length; j++) {
        const v = cols[j] || "";
        task[header[j]] = v === "undefined" ? "" : v;
      }
      tasks.push(task);
    }
  }
  return tasks;
}

function archiveDoneTasks() {
  const tbPath = path.join(PUBLIC_DIR, "task_board.md");
  const archivePath = path.join(PUBLIC_DIR, "task_board_archive.md");
  const tasks = parseTaskBoard();
  // Archive completed and cancelled regular tasks (not directions or instructions)
  const doneTasks = tasks.filter((t) => ["done", "cancelled"].includes((t.status || "").toLowerCase()) && t.task_type === "task");
  if (!doneTasks.length) return 0;
  
  // Append done rows to archive
  const header = "| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |";
  const sep = "|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|";
  if (!fs.existsSync(archivePath)) {
    fs.writeFileSync(archivePath, `# Task Board Archive\n\n## Archived Tasks\n${header}\n${sep}\n`);
  }
  const doneRows = doneTasks.map((t) =>
    `| ${t.id} | ${t.title} | ${t.description} | ${t.priority} | ${t.group || ""} | ${t.assignee} | ${t.status} | ${t.created} | ${t.updated} | ${t.notes || ""} |`
  ).join("\n");
  fs.appendFileSync(archivePath, doneRows + "\n");
  
  // Rebuild board preserving all three sections
  rebuildTaskBoard(tasks.filter((t) => !doneTasks.includes(t)));
  return doneTasks.length;
}

function rebuildTaskBoard(tasks) {
  const tbPath = path.join(PUBLIC_DIR, "task_board.md");
  const header = "| ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes |";
  const sep = "|----|-------|-------------|----------|-------|----------|--------|---------|---------|-------|";
  
  const directions = tasks.filter(t => t.task_type === "direction");
  const instructions = tasks.filter(t => t.task_type === "instruction");
  const regularTasks = tasks.filter(t => t.task_type === "task" || !t.task_type);
  
  const buildRows = (list) => list.map((t) =>
    `| ${t.id} | ${t.title} | ${t.description} | ${t.priority} | ${t.group || "all"} | ${t.assignee} | ${t.status || "open"} | ${t.created} | ${t.updated} | ${t.notes || ""} |`
  ).join("\n");
  
  const content = `# Task Board

## Directions (Long-term Goals - Set by Lord Only)
${header}
${sep}
${buildRows(directions)}

## Instructions (Persistent Context - Always Consider)
${header}
${sep}
${buildRows(instructions)}

## Tasks (Regular Work - Assignable & Completable)
${header}
${sep}
${buildRows(regularTasks)}
`;
  fs.writeFileSync(tbPath, content);
  cacheInvalidate("task_board");
}

// Sanitize a string for safe insertion into a markdown table cell (strip pipe chars)
function sanitizeCell(v) { return String(v || "").replace(/\|/g, "-").replace(/[\n\r]/g, " ").trim(); }

async function appendTaskRow(task) {
  let newId;
  await withTaskLock(() => {
    const tbPath = path.join(PUBLIC_DIR, "task_board.md");
    const existing = parseTaskBoard();
    // Auto-archive done tasks when board exceeds 50 rows
    if (existing.length >= 50) archiveDoneTasks();
    const all = parseTaskBoard(); // re-read after potential archive
    let maxId = all.reduce((m, t) => Math.max(m, parseInt(t.id || t["#"] || "0", 10) || 0), 0);
    // Also check task_outputs/ so deleted tasks don't get ID-reused (orphaned result files cause test failures)
    const taskOutDir = path.join(PUBLIC_DIR, "task_outputs");
    if (fs.existsSync(taskOutDir)) {
      for (const f of listDir(taskOutDir)) {
        const m = f.match(/^task[_-]?0*(\d+)[_-]/i);
        if (m) maxId = Math.max(maxId, parseInt(m[1], 10) || 0);
      }
    }
    newId = maxId + 1;
    const now = new Date().toISOString().slice(0, 10);
    const row = `| ${newId} | ${sanitizeCell(task.title)} | ${sanitizeCell(task.description)} | ${sanitizeCell(task.priority || "medium")} | ${sanitizeCell(task.group || "all")} | ${sanitizeCell(task.assignee)} | ${sanitizeCell(task.status || "open")} | ${now} | ${now} | ${sanitizeCell(task.notes)} |`;
    
    // Determine which section to append to based on task_type
    const taskType = (task.task_type || "task").toLowerCase();
    let sectionMarker;
    if (taskType === "direction") sectionMarker = "## Directions";
    else if (taskType === "instruction") sectionMarker = "## Instructions";
    else sectionMarker = "## Tasks";
    
    // Find the section and append there
    const raw = safeRead(tbPath) || "";
    const lines = raw.split("\n");
    let insertIndex = -1;
    let inTargetSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(sectionMarker)) {
        inTargetSection = true;
        continue;
      }
      if (inTargetSection) {
        // Found next section, insert before it
        if (lines[i].startsWith("## ")) {
          insertIndex = i;
          break;
        }
        // Or end of file
        if (i === lines.length - 1) {
          insertIndex = lines.length;
        }
      }
    }
    
    if (insertIndex > 0) {
      lines.splice(insertIndex, 0, row);
      fs.writeFileSync(tbPath, lines.join("\n"));
    } else {
      // Fallback: append to end
      const sep = raw.endsWith("\n") ? "" : "\n";
      fs.appendFileSync(tbPath, sep + row + "\n");
    }
    cacheInvalidate("task_board");
  });
  return newId;
}

async function updateTaskRow(id, updates) {
  let found = false;
  await withTaskLock(() => {
    const tbPath = path.join(PUBLIC_DIR, "task_board.md");
    const raw = safeRead(tbPath);
    if (!raw) return;
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().startsWith("|")) continue;
      const cols = lines[i].split("|").slice(1, -1).map((c) => c.trim());
      if (cols.length < 2) continue;
      if (String(cols[0]).trim() === String(id)) {
        // Pad to full 10-column schema so sparse writes don't produce undefined in joined output
        // Columns: ID | Title | Description | Priority | Group | Assignee | Status | Created | Updated | Notes
        while (cols.length < 10) cols.push("");
        if (updates.status !== undefined) cols[6] = String(updates.status).toLowerCase();
        if (updates.assignee !== undefined) cols[5] = sanitizeCell(String(updates.assignee).toLowerCase());
        if (updates.group !== undefined) cols[4] = sanitizeCell(String(updates.group).toLowerCase());
        if (updates.priority !== undefined) cols[3] = String(updates.priority).toLowerCase();
        if (updates.title !== undefined) cols[1] = sanitizeCell(updates.title);
        if (updates.description !== undefined) cols[2] = sanitizeCell(updates.description);
        if (updates.notes !== undefined) {
          // Append note (timestamped), never replace
          const newNote = "[" + new Date().toISOString().slice(0, 10) + "] " + String(updates.notes).trim().replace(/;;/g, "--").replace(/\|/g, "-").replace(/\n/g, " ");
          cols[9] = cols[9] ? cols[9] + " ;; " + newNote : newNote;
        }
        cols[8] = new Date().toISOString().slice(0, 10); // updated
        lines[i] = "| " + cols.join(" | ") + " |";
        found = true;
        break;
      }
    }
    if (found) { fs.writeFileSync(tbPath, lines.join("\n")); cacheInvalidate("task_board"); }
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
    try {
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    } finally {
      fs.closeSync(fd);
    }
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

  // SEC-012: attach CORS origin to res so json() can reflect the correct value
  res._corsOrigin = corsOrigin(req, method);

  // Bob's middleware: handles CORS preflight + rate limiting on /api/* routes
  if (apiMiddleware(req, res, pathname, method)) return;

  // SEC-001: API key authentication for all /api/* routes
  // /api/health is public — monitoring tools must reach it without auth
  // /api/events is public — EventSource (SSE) cannot send custom headers; sends no sensitive data (only "refresh" signals)
  const PUBLIC_PATHS = new Set(["/api/health", "/api/events"]);
  if (pathname.startsWith("/api/") && !PUBLIC_PATHS.has(pathname) && !isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }

  // Serve index_lite.html for GET /
  if (method === "GET" && pathname === "/") {
    let html = safeRead(path.join(DIR, "index_lite.html"));
    if (!html) return notFound(res, "dashboard not available");
    // Inject API key so dashboard JS can include auth headers in API calls
    const keyScript = `<script>window.__DASHBOARD_API_KEY=${JSON.stringify(API_KEY || "")};</script>`;
    html = html.replace("</head>", keyScript + "\n</head>");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    });
    return res.end(html);
  }

  // Serve PWA icons (SVG, sized for Android + desktop)
  if (method === "GET" && (pathname === "/icon-192.svg" || pathname === "/icon-512.svg")) {
    const size = pathname === "/icon-512.svg" ? 512 : 192;
    const fontSize = Math.round(size * 0.55);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size*0.18)}" fill="#7c3aed"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="${fontSize}" font-family="serif">🤖</text></svg>`;
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
    return res.end(svg);
  }

  // Apple touch icon (SVG fallback — iOS 9+ accepts SVG for home screen)
  if (method === "GET" && pathname === "/apple-touch-icon.png") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180"><rect width="180" height="180" rx="32" fill="#7c3aed"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="100" font-family="serif">🤖</text></svg>`;
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
    return res.end(svg);
  }

  // Serve PWA manifest
  if (method === "GET" && pathname === "/manifest.json") {
    const manifest = {
      name: "Agent Planet",
      short_name: "AgentPlanet",
      description: "Real-time dashboard for the Agent Planet civilization",
      start_url: "/",
      display: "standalone",
      background_color: "#1a1a2e",
      theme_color: "#7c3aed",
      icons: [
        { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
        { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
        { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" }
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

  // -----------------------------------------------------------------------
  // Planet API
  // -----------------------------------------------------------------------
  if (method === "GET" && pathname === "/api/planets") {
    const planetsDir = path.join(DIR, "planets");
    if (!fs.existsSync(planetsDir)) return json(res, { planets: [], active: PLANET_NAME });
    const planets = fs.readdirSync(planetsDir).filter(d => {
      try {
        return fs.statSync(path.join(planetsDir, d)).isDirectory() &&
          fs.existsSync(path.join(planetsDir, d, "planet_config.json"));
      } catch { return false; }
    }).map(name => {
      const configPath = path.join(planetsDir, name, "planet_config.json");
      let config = {};
      try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
      return { name, ...config, active: name === PLANET_NAME };
    });
    return json(res, { planets, active: PLANET_NAME });
  }

  if (method === "GET" && pathname === "/api/planets/active") {
    return json(res, { planet: PLANET_NAME, dir: PLANET_DIR });
  }

  if (method === "POST" && pathname === "/api/planets/switch") {
    const body = await parseBody(req);
    const target = (body.planet || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!target) return json(res, { error: "planet name required" }, 400);
    const targetDir = path.join(DIR, "planets", target);
    if (!fs.existsSync(targetDir)) return json(res, { error: `planet not found: ${target}` }, 404);
    if (target === PLANET_NAME) return json(res, { ok: true, planet: target, message: "already active" });
    // Run switch_planet.sh (stops agents, updates symlinks, swaps worktree)
    const { execFile: ef } = require("child_process");
    return new Promise((resolve) => {
      ef("bash", [path.join(DIR, "switch_planet.sh"), target], { cwd: DIR, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return resolve(json(res, { error: "switch failed", details: (stderr || err.message).trim() }, 500));
        reloadPlanet();
        resolve(json(res, { ok: true, planet: PLANET_NAME, message: "Switched and reloaded.", stdout: stdout.trim() }));
      });
    });
  }

  if (method === "POST" && pathname === "/api/planets/create") {
    const body = await parseBody(req);
    const name = (body.name || "").replace(/[^a-zA-Z0-9_-]/g, "");
    // Accept agents as either a space-separated string or an array
    const agentsRaw = body.agents || "alice bob charlie dave eve";
    const agentsStr = Array.isArray(agentsRaw) ? agentsRaw.join(" ") : String(agentsRaw);
    if (!name) return json(res, { error: "planet name required" }, 400);
    const targetDir = path.join(DIR, "planets", name);
    if (fs.existsSync(targetDir)) return json(res, { error: `planet already exists: ${name}` }, 409);
    const { execFile: ef } = require("child_process");
    return new Promise((resolve) => {
      ef("bash", [path.join(DIR, "init_planet.sh"), name, agentsStr], { cwd: DIR, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return resolve(json(res, { error: "creation failed", details: (stderr || err.message).trim() }, 500));
        resolve(json(res, { ok: true, planet: name, agents: agentsStr.split(/\s+/).filter(Boolean), stdout: stdout.trim() }, 201));
      });
    });
  }

  if (method === "GET" && pathname === "/api/config") {
    const companyMd = safeRead(path.join(DIR, "company.md"));
    let companyName = "Agent Planet";
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
    // Include archive stats so dashboard can show real done count
    const archivePath = path.join(PUBLIC_DIR, "task_board_archive.md");
    const archiveRaw = safeRead(archivePath) || "";
    const archiveLines = archiveRaw.split("\n").filter((l) => l.trim().startsWith("|") && !/\|\s*id\s*\|/i.test(l) && !/\|[-\s]+\|/.test(l));
    const archivedDoneCount = archiveLines.length;
    return json(res, { agents, tasks, mode, activeCount, archivedDoneCount });
  }

  if (method === "GET" && pathname === "/api/search") {
    const q = (query.q || "").toLowerCase();
    if (!q) return badRequest(res, "missing q parameter");
    if (q.length < 2) return badRequest(res, "query must be at least 2 characters");
    const results = [];

    // Search agent status.md and todo.md
    for (const name of listAgentNames()) {
      const d = path.join(EMPLOYEES_DIR, name);
      for (const file of ["status.md", "todo.md"]) {
        const content = safeRead(path.join(d, file));
        if (content && content.toLowerCase().includes(q)) {
          const lines = content.split("\n").filter((l) => l.toLowerCase().includes(q));
          results.push({ type: "agent", agent: name, file, matches: lines.slice(0, 5) });
        }
      }
    }

    // Search task board (title, description, notes, assignee)
    const tasks = parseTaskBoard();
    const matchedTasks = tasks.filter((t) =>
      (t.title || "").toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q) ||
      (t.assignee || "").toLowerCase().includes(q) ||
      (t.notes || "").toLowerCase().includes(q)
    );
    if (matchedTasks.length > 0) {
      results.push({ type: "tasks", agent: null, file: null, matches: matchedTasks.slice(0, 10).map((t) => ({
        id: t.id, title: t.title, status: t.status, assignee: t.assignee, priority: t.priority,
      })) });
    }

    // Search announcements (title + body)
    const annDir = path.join(PUBLIC_DIR, "announcements");
    const annFiles = listDir(annDir).filter((f) => f.endsWith(".md"));
    const matchedAnns = [];
    for (const f of annFiles.slice(-50)) { // check most recent 50 announcements
      const content = safeRead(path.join(annDir, f)) || "";
      if (content.toLowerCase().includes(q)) {
        const lines = content.split("\n").filter((l) => l.toLowerCase().includes(q));
        matchedAnns.push({ filename: f, matches: lines.slice(0, 3) });
      }
    }
    if (matchedAnns.length > 0) {
      results.push({ type: "announcements", agent: null, file: null, matches: matchedAnns.slice(0, 5) });
    }

    return json(res, { query: q, results, total: results.reduce((s, r) => s + (Array.isArray(r.matches) ? r.matches.length : 1), 0) });
  }

  // ---- Agents ----
  if (method === "GET" && pathname === "/api/agents") {
    const velocityData = buildVelocityData();
    const agentList = listAgentNames().map((name) => {
      const summary = getAgentSummary(name);
      const d = path.join(EMPLOYEES_DIR, name);
      const hbMtime = fileMtime(path.join(d, "heartbeat.md"));
      const alive = Boolean(hbMtime && Date.now() - hbMtime < 5 * 60 * 1000) || summary.status === "running";
      const inboxFiles = listDir(path.join(d, "chat_inbox")).filter((f) => !f.startsWith("read_") && !f.startsWith("processed_") && f.endsWith(".md") && !f.endsWith(".processed.md"));
      const agentData = { ...summary, alive, unread_messages: inboxFiles.length };
      const health = computeAgentHealth(agentData, velocityData);
      const executor = getExecutorForAgent(name);
      return { ...agentData, health: { score: health.score, grade: health.grade, dimensions: health.dimensions }, executor };
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
      read: f.startsWith("read_") || f.startsWith("processed_") || f.endsWith(".processed.md"),
    }));
    // Assigned tasks from task board
    const tasks = parseTaskBoard().filter(
      (t) => (t.assignee || "").toLowerCase() === name.toLowerCase()
    );
    const executor = getExecutorForAgent(name);
    return json(res, { name, status, heartbeat, statusMd, persona, todo, inbox, tasks, executor, executorHealth: getExecutorHealth(executor) });
  }

  // GET /api/executors — list supported executors
  if (method === "GET" && pathname === "/api/executors") {
    const executors = getEnabledExecutorList();
    const health = {};
    for (const executor of executors) health[executor] = getExecutorHealth(executor);
    return json(res, { executors, default: DEFAULT_EXECUTOR, health });
  }

  if (method === "GET" && pathname === "/api/executors/health") {
    const health = {};
    for (const executor of getSupportedExecutors()) health[executor] = getExecutorHealth(executor);
    return json(res, { supported: getSupportedExecutors(), enabled: getEnabledExecutorList(), health });
  }

  // GET /api/config/executor — get all agent executors
  if (method === "GET" && pathname === "/api/config/executor") {
    const allExecutors = {};
    for (const name of listAgentNames()) {
      allExecutors[name] = getExecutorForAgent(name);
    }
    return json(res, { default: DEFAULT_EXECUTOR, enabled: getEnabledExecutorList(), agents: allExecutors });
  }

  // GET /api/agents/:name/executor — get executor for specific agent
  const agentExecutorMatch = pathname.match(/^\/api\/agents\/([^/]+)\/executor$/);
  if (method === "GET" && agentExecutorMatch) {
    const name = agentName(agentExecutorMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const executor = getExecutorForAgent(name);
    return json(res, { name, executor, health: getExecutorHealth(executor) });
  }

  // POST /api/agents/:name/executor — set executor for specific agent
  if (method === "POST" && agentExecutorMatch) {
    const name = agentName(agentExecutorMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const body = await parseBody(req);
    if (!body.executor) return badRequest(res, "executor is required");
    const result = setExecutorForAgent(name, String(body.executor).toLowerCase(), { requireEnabled: true });
    if (!result.ok) return badRequest(res, result.error);
    return json(res, { name, executor: result.executor, health: getExecutorHealth(result.executor) });
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

    let streamClosed = false;
    function sendLines(text) {
      if (streamClosed) return;
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          try {
            res.write("event: log\ndata: " + JSON.stringify(line) + "\n\n");
          } catch (_) {
            streamClosed = true;
            return;
          }
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
        try {
          fs.readSync(fd, buf, 0, readSize, startPos);
        } finally {
          fs.closeSync(fd);
        }
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
          try {
            fs.readSync(fd, buf, 0, newBytes, offset);
          } finally {
            fs.closeSync(fd);
          }
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
        try {
          fs.readSync(fd, buf, 0, newBytes, offset);
        } finally {
          fs.closeSync(fd);
        }
        offset = stat.size;
        sendLines(buf.toString("utf8"));
      } catch (_) {}
    }, 1000);

    const keepalive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch (_) { streamClosed = true; }
    }, 15000);

    req.on("close", () => {
      streamClosed = true;
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
    try { fs.writeFileSync(path.join(inboxDir, filename), body.message); } catch (e) { return json(res, { error: "failed to write message" }, 500); }
    return json(res, { ok: true, filename });
  }

  const agentStopMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
  if (method === "POST" && agentStopMatch) {
    const name = agentName(agentStopMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const script = path.join(DIR, "stop_agent.sh");
    if (!fs.existsSync(script)) return notFound(res, "operation not available");
    execFile("bash", [script, name], { cwd: DIR }, (err, stdout, stderr) => {
      if (err) { console.error("[stop_agent] script error:", stderr || err.message); return json(res, { ok: false, error: "Script execution failed" }, 500); }
      json(res, { ok: true, output: stdout });
    });
    return;
  }

  const agentPingMatch = pathname.match(/^\/api\/agents\/([^/]+)\/ping$/);
  if (method === "GET" && agentPingMatch) {
    const name = agentName(agentPingMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
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
    if (!fs.existsSync(path.join(EMPLOYEES_DIR, name))) return notFound(res, "agent not found");
    const script = path.join(DIR, "run_subset.sh");
    if (!fs.existsSync(script)) return notFound(res, "operation not available");
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
    // Use spawn with stdio:'ignore' (no pipes = no EOF-wait hang) and wait for exit event.
    // This is async (doesn't block the event loop) and resolves once stop_all.sh exits.
    const killChild = spawn("bash", [script], {
      cwd: DIR,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const _onDone = () => {
      // Reset heartbeats from Node.js as a belt-and-suspenders measure
      try {
        const agentDirs = fs.readdirSync(EMPLOYEES_DIR);
        const ts = new Date().toISOString().replace(/[:.]/g, '_').replace('T', '_').slice(0, 19);
        for (const name of agentDirs) {
          const hbPath = path.join(EMPLOYEES_DIR, name, "heartbeat.md");
          if (fs.existsSync(hbPath)) {
            fs.writeFileSync(hbPath, `status: idle\ntimestamp: ${ts}\ntask: Stopped\n`);
          }
        }
      } catch (e) { console.error("[stop-all] heartbeat reset error:", e.message); }
      json(res, { ok: true, output: "" });
    };
    // Safety timeout: respond after 10s even if shell script somehow hangs
    const _timeout = setTimeout(() => {
      killChild.kill();
      _onDone();
    }, 10000);
    killChild.on("exit", () => {
      clearTimeout(_timeout);
      _onDone();
    });
    killChild.on("error", (e) => { console.error("[stop-all] spawn error:", e.message); });
    return;
  }

  // ---- Smart Start ----
  if (method === "POST" && pathname === "/api/agents/smart-start") {
    const script = path.join(DIR, "smart_run.sh");
    if (!fs.existsSync(script)) return notFound(res, "operation not available");
    // Check enabled flag in config
    const smartRunConfigPath = path.join(PUBLIC_DIR, "smart_run_config.json");
    let smartRunConfig = { enabled: true, max_agents: 20 };
    try { smartRunConfig = JSON.parse(fs.readFileSync(smartRunConfigPath, "utf8")); } catch (_) {}
    if (smartRunConfig.enabled === false) {
      return json(res, { ok: false, message: "Smart run is disabled. Set enabled:true in smart_run_config.json to allow." }, 403);
    }
    // Cost cap check — refuse to start agents if daily spend exceeds cap
    const dailyCap = parseFloat(smartRunConfig.daily_cost_cap_usd || 0);
    if (dailyCap > 0) {
      try {
        const metricsPath = path.join(DIR, "backend", "metrics_queue.jsonl");
        if (fs.existsSync(metricsPath)) {
          const todayStr = new Date().toISOString().slice(0, 10);
          // Read only the tail of the file — today's entries are recent, no need to scan 100k+ old lines
          const stat = fs.statSync(metricsPath);
          const tailBytes = 200 * 1024; // 200KB is enough for a full day of entries
          const start = Math.max(0, stat.size - tailBytes);
          const buf = Buffer.alloc(Math.min(tailBytes, stat.size));
          const fd = fs.openSync(metricsPath, "r");
          fs.readSync(fd, buf, 0, buf.length, start);
          fs.closeSync(fd);
          let todayCost = 0;
          for (const line of buf.toString("utf8").split("\n")) {
            try {
              const m = JSON.parse(line);
              if (m.date === todayStr && m.cost) todayCost += m.cost;
            } catch (_) {}
          }
          if (todayCost >= dailyCap) {
            return json(res, { ok: false, message: `Daily cost cap reached: $${todayCost.toFixed(2)} >= $${dailyCap}. Agents will not be started.` }, 429);
          }
        }
      } catch (_) {}
    }
    const body = await parseBody(req);
    const parsedMax = parseInt(body.max, 10);
    // If request provides a valid max, use it. Otherwise use config's max_agents (default 3).
    const configMax = parseInt(smartRunConfig.max_agents, 10) || 3;
    const maxAgents = (!isNaN(parsedMax) && parsedMax > 0 && parsedMax <= 100) ? String(parsedMax) : String(configMax);
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

  // ---- Smart Run Daemon Management (Portal Control) ----
  // GET /api/smart-run/config - Read current smart_run configuration
  if (method === "GET" && pathname === "/api/smart-run/config") {
    const pidPath = path.join(DIR, ".smart_run_daemon.pid");
    const { configPath, config } = readSmartRunConfig();
    let daemonRunning = false;
    let daemonPid = null;
    
    // Check daemon status
    try {
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0); // Check if process exists
            daemonRunning = true;
            daemonPid = pid;
          } catch (e) {
            // Process not running, clean up stale PID file
            fs.unlinkSync(pidPath);
          }
        }
      }
    } catch (e) {
      // Ignore errors checking daemon status
    }
    
    config.enabled_executors = normalizeEnabledExecutorsValue(config.enabled_executors);
    return json(res, {
      config,
      daemon: {
        running: daemonRunning,
        pid: daemonPid,
      },
    });
  }
  
  // POST /api/smart-run/config - Update smart_run configuration
  if (method === "POST" && pathname === "/api/smart-run/config") {
    const body = await parseBody(req);
    const { configPath, config } = readSmartRunConfig();
    if (config.force_alice === undefined) config.force_alice = true;
    
    // Validate and update fields
    if (body.max_agents !== undefined) {
      const max = parseInt(body.max_agents, 10);
      if (!isNaN(max) && max >= 0 && max <= 20) {
        config.max_agents = max;
      } else {
        return badRequest(res, "max_agents must be between 0 and 20");
      }
    }
    
    if (body.interval_seconds !== undefined) {
      const interval = parseInt(body.interval_seconds, 10);
      if (!isNaN(interval) && interval >= 10 && interval <= 300) {
        config.interval_seconds = interval;
      } else {
        return badRequest(res, "interval_seconds must be between 10 and 300");
      }
    }
    
    if (body.mode !== undefined) {
      if (["smart", "round_robin", "priority"].includes(body.mode)) {
        config.mode = body.mode;
      } else {
        return badRequest(res, "mode must be smart, round_robin, or priority");
      }
    }
    
    if (body.force_alice !== undefined) {
      config.force_alice = Boolean(body.force_alice);
    }

    if (body.dry_run !== undefined) {
      config.dry_run = Boolean(body.dry_run);
    }

    if (body.enabled !== undefined) {
      config.enabled = Boolean(body.enabled);
    }

    if (body.cycle_sleep_seconds !== undefined) {
      const sleep = parseInt(body.cycle_sleep_seconds, 10);
      if (!isNaN(sleep) && sleep >= 0 && sleep <= 300) {
        config.cycle_sleep_seconds = sleep;
      } else {
        return badRequest(res, "cycle_sleep_seconds must be between 0 and 300");
      }
    }

    if (body.selection_mode !== undefined) {
      if (["deterministic", "random"].includes(body.selection_mode)) {
        config.selection_mode = body.selection_mode;
      } else {
        return badRequest(res, "selection_mode must be deterministic or random");
      }
    }

    if (body.enabled_executors !== undefined) {
      const normalized = normalizeEnabledExecutorsValue(body.enabled_executors);
      if (normalized.length === 0) {
        return badRequest(res, `enabled_executors must include at least one of: ${getSupportedExecutors().join(", ")}`);
      }
      config.enabled_executors = normalized;
    }

    if (body.daily_cost_cap_usd !== undefined) {
      const cap = parseFloat(body.daily_cost_cap_usd);
      if (!isNaN(cap) && cap >= 0) config.daily_cost_cap_usd = cap;
      else return badRequest(res, "daily_cost_cap_usd must be a non-negative number (0 = disabled)");
    }

    if (body.per_agent_cost_cap_usd !== undefined) {
      const cap = parseFloat(body.per_agent_cost_cap_usd);
      if (!isNaN(cap) && cap >= 0) config.per_agent_cost_cap_usd = cap;
      else return badRequest(res, "per_agent_cost_cap_usd must be a non-negative number (0 = disabled)");
    }

    if (body.max_total_cycles !== undefined) {
      const n = parseInt(body.max_total_cycles, 10);
      if (!isNaN(n) && n >= 0) config.max_total_cycles = n;
      else return badRequest(res, "max_total_cycles must be a non-negative integer (0 = unlimited)");
    }

    // Update timestamp
    config.last_updated = new Date().toISOString();
    
    // Write config
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) {
      console.error("[smart-run] Error writing config:", e.message);
      return json(res, { error: "Failed to write config" }, 500);
    }
    
    return json(res, { ok: true, config });
  }
  
  // POST /api/smart-run/start - Start the daemon
  if (method === "POST" && pathname === "/api/smart-run/start") {
    const script = path.join(DIR, "smart_run.sh");
    const pidPath = path.join(DIR, ".smart_run_daemon.pid");
    
    if (!fs.existsSync(script)) {
      return notFound(res, "smart_run.sh not found");
    }
    
    // Check if already running
    try {
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0);
            return json(res, { ok: false, error: "Daemon already running", pid });
          } catch (e) {
            // Stale PID file, clean it up
            fs.unlinkSync(pidPath);
          }
        }
      }
    } catch (e) {
      // Ignore
    }
    
    // Start daemon
    const child = spawn("bash", [script, "--daemon"], { 
      cwd: DIR, 
      detached: true, 
      stdio: ["ignore", "ignore", "ignore"] 
    });
    child.unref();
    
    // Give it a moment to write the PID file
    await new Promise(r => setTimeout(r, 500));
    
    let newPid = null;
    try {
      if (fs.existsSync(pidPath)) {
        newPid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
      }
    } catch (e) {
      // Ignore
    }
    
    return json(res, { ok: true, message: "Daemon started", pid: newPid });
  }
  
  // POST /api/smart-run/stop - Stop the daemon
  if (method === "POST" && pathname === "/api/smart-run/stop") {
    const script = path.join(DIR, "smart_run.sh");
    const pidPath = path.join(DIR, ".smart_run_daemon.pid");
    
    if (!fs.existsSync(script)) {
      return notFound(res, "smart_run.sh not found");
    }
    
    // Use the --stop flag on the script
    return new Promise((resolve) => {
      execFile("bash", [script, "--stop"], { cwd: DIR }, (err, stdout, stderr) => {
        const output = (stdout || "") + (stderr || "");
        if (err && !output.includes("stopped")) {
          resolve(json(res, { ok: false, error: "Failed to stop daemon", details: output }));
        } else {
          resolve(json(res, { ok: true, message: "Daemon stopped", output }));
        }
      });
    });
  }
  
  // GET /api/smart-run/status - Get detailed daemon status
  if (method === "GET" && pathname === "/api/smart-run/status") {
    const script = path.join(DIR, "smart_run.sh");
    const pidPath = path.join(DIR, ".smart_run_daemon.pid");
    const configPath = path.join(PUBLIC_DIR, "smart_run_config.json");
    
    let daemonRunning = false;
    let daemonPid = null;
    let runningAgents = [];
    let config = { max_agents: 3 };
    
    // Read config
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf8");
        config = JSON.parse(raw);
      }
    } catch (e) {
      // Ignore
    }
    
    // Check daemon
    try {
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0);
            daemonRunning = true;
            daemonPid = pid;
          } catch (e) {
            fs.unlinkSync(pidPath);
          }
        }
      }
    } catch (e) {
      // Ignore
    }
    
    // Get running agents
    const agents = listAgentNames();
    for (const name of agents) {
      const { status } = getAgentStatus(name);
      if (status === "running") {
        runningAgents.push(name);
      }
    }
    
    return json(res, {
      daemon: {
        running: daemonRunning,
        pid: daemonPid,
      },
      config: {
        max_agents: config.max_agents,
        interval_seconds: config.interval_seconds,
        mode: config.mode,
      },
      agents: {
        running: runningAgents,
        count: runningAgents.length,
        target: config.max_agents,
      },
    });
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
    if (note.length > 10000) return badRequest(res, "note exceeds maximum length of 10000 characters");
    const personaPath = path.join(d, "persona.md");
    const existing = safeRead(personaPath) || "";
    const timestamp = new Date().toISOString();
    let base = existing;
    if (!existing.includes("## Persona Evolution Log")) {
      base = existing.trimEnd() + "\n\n---\n\n## Persona Evolution Log\n\n";
    }
    const entry = `### [${timestamp}] Note\n${note}\n\n---\n`;
    try { fs.writeFileSync(personaPath, base + entry); } catch (e) { return json(res, { error: "failed to write persona note" }, 500); }
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
    if (observation.length > 10000) return badRequest(res, "observation exceeds maximum length of 10000 characters");
    const personaPath = path.join(d, "persona.md");
    const existing = safeRead(personaPath) || "";
    const timestamp = new Date().toISOString();
    let base = existing;
    if (!existing.includes("## Persona Evolution Log")) {
      base = existing.trimEnd() + "\n\n---\n\n## Persona Evolution Log\n\n";
    }
    const entry = `### [${timestamp}] Evolution\n${observation}\n\n---\n`;
    try { fs.writeFileSync(personaPath, base + entry); } catch (e) { return json(res, { error: "failed to write persona evolution" }, 500); }
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
      // Filter out read_* prefixed files (legacy marker) — same as /api/agents list endpoint
      const unread = listDir(inboxDir).filter((f) => !f.startsWith("read_") && !f.startsWith("processed_") && f.endsWith(".md") && !f.endsWith(".processed.md")).map((f) => ({
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
    try { fs.writeFileSync(path.join(inboxDir, filename), body.message); } catch (e) { return json(res, { error: "failed to write message" }, 500); }
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

  // GET /api/agents/:name/context — aggregated live context snapshot for KV-cache priming
  // Returns everything the agent needs to start a fresh session without file-discovery tool calls.
  const agentContextMatch = pathname.match(/^\/api\/agents\/([^/]+)\/context$/);
  if (method === "GET" && agentContextMatch) {
    const name = agentName(agentContextMatch[1]);
    if (!name) return badRequest(res, "invalid agent name");
    const agentDir = path.join(EMPLOYEES_DIR, name);
    if (!fs.existsSync(agentDir)) return notFound(res, "agent not found");

    // Company mode (cached 30s — changes rarely)
    const modeRaw = cached("company_mode", 30_000, () => safeRead(path.join(PUBLIC_DIR, "company_mode.md")) || "");
    const modeMatch = modeRaw.match(/\*\*(\w+)\*\*/);
    const mode = modeMatch ? modeMatch[1].toLowerCase() : "normal";

    // Active SOP (cached 60s)
    const sop = cached(`sop:${mode}`, 60_000, () => {
      const sopPath = path.join(PUBLIC_DIR, "sops", `${mode}_mode.md`);
      return safeRead(sopPath) || null;
    });

    // Culture / consensus (cached 60s — large file, rarely changes mid-sprint)
    const culture = cached("consensus", 60_000, () => safeRead(path.join(PUBLIC_DIR, "consensus.md")) || null);

    // Inbox — unread files (not in processed/)
    const inboxDir = path.join(agentDir, "chat_inbox");
    const inboxFiles = listDir(inboxDir)
      .filter(f => f.endsWith(".md") && !f.endsWith(".processed.md") && !f.startsWith("read_") && !f.startsWith("processed_"))
      .sort().reverse();
    // Split into urgent (from_ceo / from_lord) and regular
    const urgentFiles = inboxFiles.filter(f => f.includes("from_ceo") || f.includes("from_lord"));
    const regularFiles = inboxFiles.filter(f => !f.includes("from_ceo") && !f.includes("from_lord"));
    // Read full content of last 2 urgent messages
    const urgentMessages = urgentFiles.slice(0, 2).map(f => ({
      filename: f,
      content: safeRead(path.join(inboxDir, f)) || "",
    }));
    // First non-empty, non-heading line preview of up to 15 regular DMs
    const inboxPreviews = regularFiles.slice(0, 15).map(f => {
      const lines = (safeRead(path.join(inboxDir, f)) || "").split("\n");
      // Skip blank lines and markdown headings (# ...) to get actual message content
      const contentLine = lines.find(l => l.trim() && !l.trim().startsWith("#")) || lines[0] || "";
      return { filename: f, preview: contentLine.trim().slice(0, 150) };
    });

    // Open tasks for this agent (task board cached 10s — task updates are critical, keep TTL short)
    const allTasks = cached("task_board", 10_000, () => parseTaskBoard());
    const tasks = allTasks
      .filter(t => (t.assignee || "").toLowerCase() === name.toLowerCase()
               && !["done","cancelled","canceled"].includes((t.status || "").toLowerCase()))
      .map(t => ({
        ...t,
        // Truncate long descriptions (D004 is 2000+ chars) to save snapshot/delta tokens
        description: t.description && t.description.length > 300
          ? t.description.slice(0, 300) + "…"
          : t.description,
      }));

    // Recent team channel (cached 20s — new posts appear within one agent cycle anyway)
    const teamChannel = cached("team_channel", 20_000, () => {
      const tcDir = path.join(PUBLIC_DIR, "team_channel");
      return listDir(tcDir)
        .filter(f => f.endsWith(".md"))
        .sort().reverse().slice(0, 5)
        .map(f => {
          const raw = safeRead(path.join(tcDir, f)) || "";
          const lines = raw.split("\n");
          const preview = lines
            .filter(l => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("Date:"))
            .slice(0, 3).join(" ").slice(0, 200);
          return { filename: f, preview };
        });
    });

    // Recent announcements (cached 60s)
    const announcements = cached("announcements", 60_000, () => {
      const annDir = path.join(PUBLIC_DIR, "announcements");
      return listDir(annDir)
        .filter(f => f.endsWith(".md") && !f.includes("mode_switch"))
        .sort().reverse().slice(0, 3)
        .map(f => {
          const raw = safeRead(path.join(annDir, f)) || "";
          const lines = raw.split("\n");
          const preview = lines
            .filter(l => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("Date:"))
            .slice(0, 2).join(" ").slice(0, 200);
          return { filename: f, preview };
        });
    });

    // Teammate statuses from heartbeats (cached 20s — updates every ~60s per agent cycle)
    // This is the hottest path: 19 readFileSync calls per context request, blocking the event loop.
    const allAgents = cached("agent_names", 60_000, () => listAgentNames());
    const teammates = cached("teammate_statuses", 20_000, () =>
      allAgents.map(n => {
        const hb = safeRead(path.join(EMPLOYEES_DIR, n, "heartbeat.md")) || "";
        const stMatch = hb.match(/^status:\s*(.+)$/m);
        return { name: n, status: stMatch ? stMatch[1].trim() : "unknown" };
      })
    ).filter(t => t.name !== name);

    return json(res, {
      agent: name,
      mode,
      sop,
      culture,
      inbox: {
        total_unread: inboxFiles.length,
        urgent: urgentMessages,
        messages: inboxPreviews,
        // more = count of messages beyond what's shown (2 urgent + 15 regular)
        more: Math.max(0, urgentFiles.length - 2) + Math.max(0, regularFiles.length - 15),
      },
      tasks,
      team_channel: teamChannel,
      announcements,
      teammates,
    });
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
      const startM = line.match(/^={5,} CYCLE START — (\S+)/);
      const endM = line.match(/^={5,} CYCLE END — (\S+)/);
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
    // Extract metadata from cycle lines
    let turns = null, cost_usd = null, duration_s = null;
    for (const cl of cycleLines) {
      const m = cl.match(/^\[DONE\] turns=(\d+) cost=\$([0-9.]+) duration=([0-9.]+)s/);
      if (m) { turns = parseInt(m[1], 10); cost_usd = parseFloat(m[2]); duration_s = parseFloat(m[3]); break; }
    }
    return json(res, { name, cycle: cycleN, turns, cost_usd, duration_s, content: cycleLines.join("\n") });
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
    const inboxFiles = listDir(path.join(d, "chat_inbox")).filter((f) => !f.startsWith("read_") && !f.startsWith("processed_") && f.endsWith(".md") && !f.endsWith(".processed.md"));
    const agentData = { ...summary, alive, unread_messages: inboxFiles.length };
    const velocityData = buildVelocityData();
    const health = computeAgentHealth(agentData, velocityData);
    return json(res, health);
  }

  // ---- Tasks ----
  if (method === "GET" && pathname === "/api/tasks") {
    const includeArchive = query.include_archive === "true" || query.include_archive === "1";
    let taskList = parseTaskBoard().map((t) => ({ ...t, id: parseInt(t.id, 10) || t.id, notesList: (t.notes || "").split(" ;; ").filter(Boolean) }));

    // Include archived done tasks if requested
    if (includeArchive) {
      const archivePath = path.join(PUBLIC_DIR, "task_board_archive.md");
      const raw = safeRead(archivePath) || "";
      const lines = raw.split("\n").filter((l) => l.trim().startsWith("|"));
      for (const line of lines) {
        if (/\|\s*id\s*\|/i.test(line) || /\|[-\s]+\|/.test(line)) continue;
        const cols = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cols.length >= 6) {
          // Detect if Group column is present (newer format has 10 cols, older had 9)
          const hasGroup = cols.length >= 9;
          const g = hasGroup ? cols[4] : "";
          const off = hasGroup ? 1 : 0;
          taskList.push({
            id: parseInt(cols[0], 10) || cols[0],
            title: cols[1] || "",
            description: cols[2] || "",
            priority: cols[3] || "",
            group: g,
            assignee: cols[4 + off] || "",
            status: cols[5 + off] || "done",
            created: cols[6 + off] || "",
            updated: cols[7 + off] || "",
            archived: true,
            notesList: [],
          });
        }
      }
    }

    const assigneeFilter = query.assignee;
    const statusFilter = query.status;
    const priorityFilter = query.priority;
    const qFilter = query.q ? query.q.toLowerCase() : null;
    if (assigneeFilter) taskList = taskList.filter((t) => (t.assignee || "").toLowerCase() === assigneeFilter.toLowerCase());
    if (statusFilter) taskList = taskList.filter((t) => (t.status || "").toLowerCase() === statusFilter.toLowerCase());
    if (priorityFilter) taskList = taskList.filter((t) => (t.priority || "").toLowerCase() === priorityFilter.toLowerCase());
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
      const newId = await appendTaskRow(body); // appendTaskRow returns the actual assigned ID
      const newTask = {
        ok: true,
        id: newId,
        title: String(body.title).trim(),
        description: body.description ? String(body.description).trim() : "",
        priority: (body.priority || "medium").toLowerCase(),
        group: (body.group || "all").toLowerCase(),
        assignee: (body.assignee || "").toLowerCase(),
        status: "open",
        task_type: (body.task_type || "task").toLowerCase(),
        created: now,
        updated: now,
      };
      broadcastWS("task_created", { ...newTask });
      return json(res, newTask, 201);
    } catch (e) {
      console.error("[POST /api/tasks] error:", e);
      return json(res, { error: "Internal server error" }, 500);
    }
  }

  const taskIdMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);

  // GET /api/tasks/:id
  if (method === "GET" && taskIdMatch) {
    const id = taskIdMatch[1];
    const task = parseTaskBoard().find((t) => String(t.id) === String(id));
    if (!task) return notFound(res, "task not found");
    return json(res, { ...task, id: parseInt(task.id, 10), notesList: (task.notes || "").split(" ;; ").filter(Boolean) });
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
    if (body.assignee !== undefined && String(body.assignee).trim() !== "" && !/^[a-zA-Z0-9_-]+$/.test(String(body.assignee).trim())) {
      return badRequest(res, "invalid assignee: must be alphanumeric agent name");
    }
    const ok = await updateTaskRow(id, body);
    if (!ok) return notFound(res, "task not found");
    const updatedTask = parseTaskBoard().find((t) => String(t.id) === String(id));
    if (!updatedTask) return notFound(res, "task not found");
    broadcastWS("task_updated", { id: parseInt(updatedTask.id, 10), status: updatedTask.status, assignee: updatedTask.assignee, title: updatedTask.title });
    return json(res, { ok: true, ...updatedTask, id: parseInt(updatedTask.id, 10), notesList: (updatedTask.notes || "").split(" ;; ").filter(Boolean) });
  }

  // POST /api/tasks/:id/review — validate and approve a task (reviewer gate)
  // Checks: deliverable exists in output/ or task_outputs/, then marks done
  const taskReviewMatch = pathname.match(/^\/api\/tasks\/(\d+)\/review$/);
  if (method === "POST" && taskReviewMatch) {
    const id = taskReviewMatch[1];
    const body = await parseBody(req);
    const task = parseTaskBoard().find((t) => String(t.id) === String(id));
    if (!task) return notFound(res, "task not found");

    const reviewer = (body.reviewer || "").trim();
    const verdict = (body.verdict || "").trim().toLowerCase(); // "approve" or "reject"
    const comment = (body.comment || "").trim();

    if (!verdict || !["approve", "reject"].includes(verdict)) {
      return badRequest(res, "verdict required: 'approve' or 'reject'");
    }

    // Check if deliverable exists
    const assignee = (task.assignee || "").toLowerCase().trim();
    let deliverableFound = false;
    let deliverableLocation = "";

    // Check task_outputs/
    const taskOutDir = path.join(PUBLIC_DIR, "task_outputs");
    if (fs.existsSync(taskOutDir)) {
      const files = listDir(taskOutDir).filter(f => f.toLowerCase().match(new RegExp(`task[_-]?0*${id}[_-]`, 'i')));
      if (files.length > 0) { deliverableFound = true; deliverableLocation = `task_outputs/${files[0]}`; }
    }

    // Check assignee's output/
    if (!deliverableFound && assignee && EMPLOYEES_DIR) {
      const agentOutDir = path.join(EMPLOYEES_DIR, assignee, "output");
      if (fs.existsSync(agentOutDir) && listDir(agentOutDir).length > 0) {
        deliverableFound = true;
        deliverableLocation = `agents/${assignee}/output/`;
      }
    }

    if (verdict === "approve") {
      const noteText = `[REVIEWED by ${reviewer || "unknown"}] ${comment || "Approved"}${deliverableFound ? " — deliverable: " + deliverableLocation : " — no deliverable file found (manual verify)"}`;
      await updateTaskRow(id, { status: "done", notes: noteText });
      const updated = parseTaskBoard().find((t) => String(t.id) === String(id));
      broadcastWS("task_updated", { id: parseInt(id, 10), status: "done", reviewer });
      return json(res, { ok: true, verdict: "approved", deliverable_found: deliverableFound, deliverable_location: deliverableLocation, task: updated });
    } else {
      const noteText = `[REJECTED by ${reviewer || "unknown"}] ${comment || "Needs revision"}`;
      await updateTaskRow(id, { status: "in_progress", notes: noteText });
      // Notify assignee via inbox
      if (assignee) {
        const inboxDir = path.join(EMPLOYEES_DIR, assignee, "chat_inbox");
        if (fs.existsSync(inboxDir)) {
          const ts = new Date().toISOString().replace(/[-:T]/g, "_").slice(0, 19);
          const msgFile = path.join(inboxDir, `${ts}_from_${reviewer || "reviewer"}.md`);
          fs.writeFileSync(msgFile, `# Task T${id} Review: REJECTED\n\nYour task "${task.title}" was rejected by ${reviewer || "a reviewer"}.\n\n**Reason:** ${comment || "Needs revision"}\n\nPlease fix and resubmit.`);
        }
      }
      broadcastWS("task_updated", { id: parseInt(id, 10), status: "in_progress", reviewer });
      return json(res, { ok: true, verdict: "rejected", comment, task_id: id });
    }
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
    const agentOutDir = path.resolve(path.join(EMPLOYEES_DIR, assignee, "output"));
    // Guard against path traversal via a task's assignee field
    if (!agentOutDir.startsWith(path.resolve(EMPLOYEES_DIR) + path.sep)) return badRequest(res, "invalid assignee path");
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

    return notFound(res, `no output found for task ${id}`);
  }

  // POST /api/tasks/:id/result — write a task result file to public/task_outputs/
  if (method === "POST" && taskResultMatch) {
    const id = taskResultMatch[1];
    const body = await parseBody(req);
    const content = body.content !== undefined ? String(body.content) : null;
    const filename = body.filename ? String(body.filename).replace(/[^a-zA-Z0-9_.\-]/g, '_') : `task-${id}-result.md`;
    if (content === null) return badRequest(res, "content is required");
    const taskOutDir = path.join(PUBLIC_DIR, "task_outputs");
    if (!fs.existsSync(taskOutDir)) { try { fs.mkdirSync(taskOutDir, { recursive: true }); } catch (_) {} }
    const filePath = path.join(taskOutDir, filename);
    if (!filePath.startsWith(taskOutDir + path.sep)) return badRequest(res, "invalid filename");
    try { fs.writeFileSync(filePath, content); } catch (e) { return json(res, { error: "failed to write result file" }, 500); }
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
    await withTaskLock(() => {
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
        // Pad to full 10-column schema: ID|Title|Desc|Priority|Group|Assignee|Status|Created|Updated|Notes
        while (cols.length < 10) cols.push("");
        cols[5] = claimant;  // assignee
        cols[6] = "in_progress";  // status
        cols[8] = new Date().toISOString().slice(0, 10);  // updated
        lines[i] = "| " + cols.join(" | ") + " |";
        found = true;
        break;
      }
      if (found) {
        fs.writeFileSync(tbPath, lines.join("\n"));
        cacheInvalidate("task_board");
        result = { ok: true, id: parseInt(id, 10), status: "in_progress", assignee: claimant };
        broadcastWS("task_claimed", { id: parseInt(id, 10), assignee: claimant });
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
    let deleteResult = null;
    await withTaskLock(() => {
      const raw = safeRead(tbPath);
      if (!raw) { deleteResult = { error: "task board not found", status: 404 }; return; }
      const taskToDelete = parseTaskBoard().find((t) => String(t.id) === String(id));
      if (!taskToDelete) { deleteResult = { error: "task not found", status: 404 }; return; }
      const lines = raw.split("\n");
      const filtered = lines.filter((line) => {
        if (!line.trim().startsWith("|")) return true;
        const cols = line.split("|").slice(1, -1).map((c) => c.trim());
        return cols.length < 1 || String(cols[0]) !== String(id);
      });
      try {
        fs.writeFileSync(tbPath, filtered.join("\n"));
        cacheInvalidate("task_board");
        deleteResult = { ok: true, deleted: { ...taskToDelete, id: parseInt(taskToDelete.id, 10) } };
        broadcastWS("task_deleted", { id: parseInt(id, 10) });
      } catch (e) {
        deleteResult = { error: "failed to write task board", status: 500 };
      }
    });
    if (!deleteResult) deleteResult = { error: "lock timeout", status: 503 };
    if (deleteResult.ok) broadcastWS("task_deleted", { id: parseInt(deleteResult.deleted.id, 10) });
    return json(res, deleteResult, deleteResult.status && !deleteResult.ok ? deleteResult.status : 200);
  }

  if (method === "GET" && pathname === "/api/tasks/archive") {
    const archivePath = path.join(PUBLIC_DIR, "task_board_archive.md");
    const raw = safeRead(archivePath) || "";
    const lines = raw.split("\n").filter((l) => l.trim().startsWith("|"));
    const tasks = [];
    for (const line of lines) {
      // Skip header row (contains "ID") and separator row (contains "---")
      if (/\|\s*id\s*\|/i.test(line) || /\|[-\s]+\|/.test(line)) continue;
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      // Archive rows: ID|Title|Desc|Priority|[Group?|]Assignee|Status|Created|Updated
      // Group may be absent in older archives — default to ""
      if (cols.length >= 6) {
        // Detect if Group column is present: if cols.length >= 9, newer format with group
        const hasGroup = cols.length >= 9;
        const g = hasGroup ? cols[4] : "";
        const off = hasGroup ? 1 : 0;
        tasks.push({ id: cols[0], title: cols[1], description: cols[2], priority: cols[3], group: g, assignee: cols[4 + off], status: cols[5 + off], created: cols[6 + off] || "", updated: cols[7 + off] || "" });
      }
    }
    return json(res, tasks);
  }

  if (method === "POST" && pathname === "/api/tasks/archive") {
    let archived = 0;
    await withTaskLock(() => { archived = archiveDoneTasks(); });
    return json(res, { ok: true, archived });
  }

  // GET /api/tasks/export.csv — download task board as CSV
  if (method === "GET" && pathname === "/api/tasks/export.csv") {
    const tasks = parseTaskBoard();
    const header = ["ID", "Title", "Description", "Priority", "Group", "Assignee", "Status", "Created", "Updated", "Notes"];
    const escape = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
    const rows = [
      header.map(escape).join(","),
      ...tasks.map((t) =>
        [t.id, t.title, t.description, t.priority, t.group || "", t.assignee, t.status, t.created, t.updated, t.notes || ""]
          .map(escape).join(",")
      ),
    ].join("\r\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="task_board_${new Date().toISOString().slice(0,10)}.csv"`,
      "Access-Control-Allow-Origin": "*",
    });
    return res.end(rows);
  }

  // GET /api/tasks/health — task health check: stale, unassigned, no-result
  if (method === "GET" && pathname === "/api/tasks/health") {
    const tasks = parseTaskBoard();
    const now = Date.now();
    const STALE_MS = 60 * 60 * 1000; // 1 hour
    const stale = [];
    const unassigned = [];
    const noResult = [];

    for (const t of tasks) {
      if (/done|cancel/i.test(t.status)) continue;
      const id = String(t.id);
      // Skip Directions (D prefix) and Instructions (I prefix) — intentionally unassigned
      if (/^[DdIi]/.test(id)) continue;
      const assignee = (t.assignee || "").trim().toLowerCase();
      const isUnassigned = !assignee || assignee === "unassigned" || assignee === "undefined" || assignee === "-";

      if (isUnassigned && /open/i.test(t.status)) {
        unassigned.push({ id, title: t.title, priority: t.priority, created: t.created });
      }

      if (/in_progress/i.test(t.status)) {
        // Check staleness via updated timestamp
        const updatedStr = t.updated || t.created || "";
        let ageMs = null;
        if (updatedStr) {
          const ts = new Date(updatedStr).getTime();
          if (!isNaN(ts)) ageMs = now - ts;
        }
        if (ageMs === null || ageMs > STALE_MS) {
          stale.push({ id, title: t.title, assignee: t.assignee, priority: t.priority, updated: t.updated, ageHours: ageMs ? Math.round(ageMs / 3600000 * 10) / 10 : null });
        }

        // Check for result file
        const resultDir = path.join(PUBLIC_DIR, "task_outputs");
        const resultFiles = listDir(resultDir);
        const hasResult = resultFiles && resultFiles.some((f) => f.includes(`task-${id}-`) || f.includes(`task_${id}_`));
        if (!hasResult) {
          noResult.push({ id, title: t.title, assignee: t.assignee, status: t.status });
        }
      }
    }

    return json(res, {
      stale,
      unassigned,
      noResult,
      summary: {
        staleCount: stale.length,
        unassignedCount: unassigned.length,
        noResultCount: noResult.length,
        checkedAt: new Date().toISOString(),
      },
    });
  }

  // ---- Communication ----
  if (method === "GET" && pathname === "/api/team-channel") {
    const dir = path.join(PUBLIC_DIR, "team_channel");
    const files = listDir(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = safeRead(path.join(dir, f));
        // Extract timestamp: YYYY_MM_DD_HH_MM_SS
        const tsMatch = f.match(/^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
        const timestamp = tsMatch
          ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}T${tsMatch[4]}:${tsMatch[5]}:${tsMatch[6]}`
          : null;
        // Extract sender from filename: ..._from_<name>.md
        const fromM = f.match(/_from_([^.]+)\.md$/i);
        return {
          filename: f,
          content,
          message: content,
          from: fromM ? fromM[1] : null,
          date: timestamp,
          timestamp,
        };
      })
      .sort((a, b) => (b.filename || "").localeCompare(a.filename || "")); // sort by full filename (includes HH_MM_SS)
    return json(res, files);
  }

  if (method === "POST" && pathname === "/api/team-channel") {
    const body = await parseBody(req);
    if (!body.message || typeof body.message !== "string") return badRequest(res, "missing message");
    const from = sanitizeFrom(body.from || "Lord");
    const dir = path.join(PUBLIC_DIR, "team_channel");
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const filename = `${nowStamp()}_from_${from}.md`;
    try { fs.writeFileSync(path.join(dir, filename), body.message); } catch (e) { return json(res, { error: "failed to write message" }, 500); }
    cacheInvalidate("team_channel");
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
    try { fs.writeFileSync(path.join(dir, filename), content); } catch (e) { return json(res, { error: "failed to write announcement" }, 500); }
    cacheInvalidate("announcements");
    return json(res, { ok: true, filename });
  }

  if (method === "POST" && pathname === "/api/broadcast") {
    const body = await parseBody(req);
    if (!body.message || typeof body.message !== "string") return badRequest(res, "missing message");
    const from = sanitizeFrom(body.from || "dashboard");
    const agents = listAgentNames();
    const filename = `${nowStamp()}_from_${from}.md`;
    let failed = 0;
    for (const name of agents) {
      const inboxDir = path.join(EMPLOYEES_DIR, name, "chat_inbox");
      try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
      try { fs.writeFileSync(path.join(inboxDir, filename), body.message); }
      catch (_) { failed++; }
    }
    return json(res, { ok: true, agents: agents.length, failed, filename });
  }

  // ---- Lord's Inbox ----
  const CEO_INBOX = DATA_DIR ? path.join(DATA_DIR, "ceo_inbox") : path.join(DIR, "ceo_inbox");
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
      console.error("[markCeoInboxRead] error:", e);
      return json(res, { error: "Internal server error" }, 500);
    }
  }

  // ---- Lord's Quick Command ----
  // POST /api/ceo/command { command: string }
  // Routing rules:
  //   @agentname <text>  → send text to that agent's inbox (Lord's priority)
  //   task: <title>      → create a task (auto-assigned unassigned, medium priority)
  //   /mode <name>       → switch civilization mode
  //   anything else      → send to alice's inbox as Lord's priority
  if (method === "POST" && pathname === "/api/ceo/command") {
    const body = await parseBody(req);
    const { command } = body;
    if (!command || !command.trim()) return badRequest(res, "command is required");
    // SEC-006: input validation — length cap + control character stripping
    if (command.length > 1000) return badRequest(res, "command exceeds maximum length of 1000 characters");
    // Strip ASCII control characters (U+0000–U+001F, U+007F) except tab/newline/CR which may be intentional in messages
    const cmd = command.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
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
      const fname = `${ts()}_from_lord.md`;
      try { fs.writeFileSync(path.join(inboxDir, fname), `# Lord's Priority Message\n\n${msg}\n`); } catch (e) { return json(res, { error: "failed to deliver message" }, 500); }
      return json(res, { ok: true, action: "dm", agent: targetAgent, filename: fname });
    }

    // task: <title> → create new task
    const taskMatch = cmd.match(/^(?:task|todo|create task):\s*(.+)$/is);
    if (taskMatch) {
      const title = taskMatch[1].trim();
      if (!title) return badRequest(res, "task title is empty");
      try {
        const newId = await appendTaskRow({ title, description: "(Lord's quick command)", priority: "medium", assignee: "unassigned" });
        return json(res, { ok: true, action: "task_created", id: newId, title }, 201);
      } catch (e) {
        console.error("[ceo/command task_created] error:", e);
        return json(res, { error: "Internal server error" }, 500);
      }
    }

    // !command → system command execution
    const sysCmdMatch = cmd.match(/^!(\w+)(?:\s+(.+))?$/);
    if (sysCmdMatch) {
      const sysCmd = sysCmdMatch[1].toLowerCase();
      const sysArgs = sysCmdMatch[2] || "";
      
      // Allowed system commands
      const allowedCmds = {
        status: { script: "./status.sh", desc: "Show agent status" },
        start_all: { script: "./run_all.sh", desc: "Start all agents" },
        stop_all: { script: "./stop_all.sh", desc: "Stop all agents" },
        smart_start: { script: "./smart_run.sh", desc: "Smart start agents" },
        archive: { script: "./archive_tasks.sh", desc: "Archive done tasks" },
      };
      
      if (!allowedCmds[sysCmd]) {
        return badRequest(res, `Unknown command: !${sysCmd}. Available: !status, !start_all, !stop_all, !smart_start, !archive`);
      }
      
      // Execute the script
      const { spawn } = require('child_process');
      const scriptPath = path.join(DIR, allowedCmds[sysCmd].script);
      
      return new Promise((resolve) => {
        const child = spawn('bash', [scriptPath], {
          cwd: DIR,
          timeout: 30000,
          env: { ...process.env, TERM: 'xterm-256color' }
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        
        child.on('close', (code) => {
          const output = stdout || stderr || 'Command completed with no output';
          resolve(json(res, { 
            ok: true, 
            action: "system_command", 
            command: sysCmd,
            output: output.slice(0, 5000), // Limit output size
            exitCode: code 
          }));
        });
        
        child.on('error', (err) => {
          resolve(json(res, { 
            ok: false, 
            error: `Failed to execute command: ${err.message}` 
          }, 500));
        });
      });
    }

    // /mode <name> → switch mode
    const modeMatch = cmd.match(/^\/mode\s+(\w+)$/i);
    if (modeMatch) {
      const newMode = modeMatch[1].toLowerCase();
      const validModes = ["plan", "normal", "crazy", "autonomous"];
      if (!validModes.includes(newMode)) return badRequest(res, `invalid mode, must be one of: ${validModes.join(', ')}`);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const modeContent = [
          "# Civilization Operating Mode",
          "",
          "## Current Mode",
          `**${newMode}**`,
          "",
          "## Set By",
          "ceo",
          "",
          "## Reason",
          "Quick command switch via Lord's command palette",
          "",
          "## Mode Switch Log",
          "| Date | From | To | Who | Reason |",
          "|------|------|----|-----|--------|",
          `| ${today} | (previous) | ${newMode} | Lord | quick command |`,
          "",
        ].join("\n");
        fs.writeFileSync(path.join(PUBLIC_DIR, "company_mode.md"), modeContent);
        cacheInvalidate("company_mode");
        return json(res, { ok: true, action: "mode_switched", mode: newMode });
      } catch (e) {
        console.error("[ceo/command mode_switch] error:", e);
        return json(res, { error: "Internal server error" }, 500);
      }
    }

    // Default: send to alice as Lord's priority
    const aliceInbox = path.join(EMPLOYEES_DIR, "alice", "chat_inbox");
    try { fs.mkdirSync(aliceInbox, { recursive: true }); } catch (_) {}
    const fname = `${ts()}_from_lord.md`;
    try { fs.writeFileSync(path.join(aliceInbox, fname), `# Lord's Priority Message\n\n${cmd}\n`); } catch (e) { return json(res, { error: "failed to route message" }, 500); }
    return json(res, { ok: true, action: "routed_to_alice", filename: fname });
  }

  // ---- Social Consensus Board ----
  const CONSENSUS_FILE = path.join(PUBLIC_DIR, "consensus.md");

  if (method === "GET" && pathname === "/api/consensus") {
    const raw = safeRead(CONSENSUS_FILE) || "# Consensus Board\n\n(empty)\n";
    // Parse table rows from all sections
    // Supports two formats:
    //   4-col: | C1 | NORM | content | date |
    //   5-col: | 1  | decision | content | author | date |
    const entries = [];
    let section = "";
    for (const line of raw.split("\n")) {
      const h2 = line.match(/^## (.+)$/);
      if (h2) { section = h2[1].trim(); continue; }
      if (!line.startsWith("|")) continue;
      const cols = line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      if (cols.length < 4) continue;
      const idStr = cols[0];
      if (!idStr || idStr === "ID" || /^[-:]+$/.test(idStr)) continue; // header/separator row
      if (cols.length >= 5) {
        // 5-col format: | id | type | content | author | date |
        const idNum = parseInt(idStr, 10);
        if (!isNaN(idNum)) {
          entries.push({ id: idNum, section, type: cols[1].toLowerCase(), content: cols[2], author: cols[3], updated: cols[4] });
          continue;
        }
      }
      // 4-col format: | C1 | NORM | content | date |
      entries.push({ id: idStr, section, type: cols[1].toLowerCase(), content: cols[2], author: "team", updated: cols[3] });
    }
    return json(res, { raw, entries });
  }

  if (method === "POST" && pathname === "/api/consensus/entry") {
    const body = await parseBody(req);
    const { type, content, author, section } = body;
    if (!type || !content) return badRequest(res, "type and content are required");
    const VALID_TYPES = new Set(["group", "authority", "culture", "decision", "relationship"]);
    if (!VALID_TYPES.has(String(type).toLowerCase())) return badRequest(res, "invalid type: must be group, authority, culture, decision, or relationship");
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
    const today = new Date().toISOString().slice(0, 10);
    const authorSafe = (author || "agent").replace(/[^a-zA-Z0-9_-]/g, "");
    const typeSafe = String(type).replace(/\|/g, "-").replace(/\n/g, " ").trim();
    const contentSafe = String(content).replace(/\|/g, "-").replace(/\n/g, " ").trim();
    const newRow = `| ${newId} | ${typeSafe} | ${contentSafe} | ${authorSafe} | ${today} |`;
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
      cacheInvalidate("consensus");
      return json(res, { ok: true, id: newId }, 201);
    } catch (e) {
      console.error("[POST /api/consensus] error:", e);
      return json(res, { error: "Internal server error" }, 500);
    }
  }

  // DELETE /api/consensus/entry/:id — remove an entry by ID (supports C1, D1, or numeric)
  const consensusDeleteMatch = pathname.match(/^\/api\/consensus\/entry\/([^/]+)$/);
  if (method === "DELETE" && consensusDeleteMatch) {
    const targetId = consensusDeleteMatch[1];
    const targetIdNum = parseInt(targetId, 10);
    const raw = safeRead(CONSENSUS_FILE) || "";
    const lines = raw.split("\n");
    const filtered = lines.filter(line => {
      if (!line.startsWith("|")) return true;
      const cols = line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      if (!cols[0] || cols[0] === "ID") return true;
      // Match by string ID (e.g. "C1") or numeric ID
      return cols[0] !== targetId && (isNaN(targetIdNum) || parseInt(cols[0], 10) !== targetIdNum);
    });
    if (filtered.length === lines.length) return notFound(res, "entry not found");
    try {
      fs.writeFileSync(CONSENSUS_FILE, filtered.join("\n"));
      cacheInvalidate("consensus");
      // Return as number if purely numeric, otherwise string
      const deletedVal = /^\d+$/.test(targetId) ? parseInt(targetId, 10) : targetId;
      return json(res, { ok: true, deleted: deletedVal });
    } catch (e) {
      return json(res, { error: "Internal server error" }, 500);
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
    // Prevent path traversal: resolve and check against allowed dirs
    const plansDir = path.join(PUBLIC_DIR, "plans");
    const reportsDir = path.join(PUBLIC_DIR, "reports");
    const fullPlans = path.resolve(path.join(plansDir, file));
    const fullReports = path.resolve(path.join(reportsDir, file));
    const inPlans = fullPlans.startsWith(plansDir + path.sep);
    const inReports = fullReports.startsWith(reportsDir + path.sep);
    if (!inPlans && !inReports) {
      return badRequest(res, "invalid path");
    }
    // Search in plans then reports
    let content = null;
    let dir = "plans";
    if (inPlans) {
      content = safeRead(fullPlans);
    }
    if (content === null && inReports) {
      content = safeRead(fullReports);
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
    const knowledgeDir = path.join(PUBLIC_DIR, "knowledge");
    const full = path.resolve(path.join(knowledgeDir, p));
    if (!full.startsWith(knowledgeDir + path.sep)) return badRequest(res, "invalid path");
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
    const VALID_MODES = new Set(["plan", "normal", "crazy", "autonomous"]);
    if (!VALID_MODES.has(body.mode)) return badRequest(res, `invalid mode '${body.mode}': must be plan, normal, crazy, or autonomous`);
    if (!body.who || !body.reason) return badRequest(res, "Missing required fields: who, reason");
    // Sanitize who/reason: strip shell metacharacters and newlines to prevent
    // command injection and markdown table corruption in switch_mode.sh heredoc
    const safeWho    = String(body.who).replace(/[`$(){}\\;<>|&\r\n\t]/g, "").slice(0, 64).trim() || "Lord";
    const safeReason = String(body.reason).replace(/[`$(){}\\;<>|&\r\n\t]/g, "").slice(0, 256).trim() || "no reason";
    const script = path.join(DIR, "switch_mode.sh");
    if (!fs.existsSync(script)) return notFound(res, "switch_mode.sh not found");
    const args = [script, body.mode, safeWho, safeReason];
    execFile("bash", args, { cwd: DIR }, (err, stdout, stderr) => {
      if (err) { console.error("[POST /api/mode] script error:", stderr || err.message); return json(res, { ok: false, error: "Script execution failed" }, 500); }
      cacheInvalidate("company_mode");
      broadcastWS("mode_changed", { mode: body.mode });
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
    if (handleAgentMetricsRequest(req, res, PLANET_DIR)) return;
  }

  // Bob's SQLite message bus — Task #102
  // Routes: POST /api/messages, GET /api/inbox/:agent, POST /api/inbox/:agent/:id/ack,
  //         POST /api/messages/broadcast, GET /api/messages/queue-depth
  if (pathname.startsWith("/api/messages") || pathname.startsWith("/api/inbox")) {
    if (handleMessageBus(req, res, PLANET_DIR)) return;
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
    // Sort newest first
    fileList.sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""));
    return json(res, { agent: name, files: fileList });
  }

  // GET /api/agents/:name/output/:file — read a specific output file
  const agentOutputFileMatch = pathname.match(/^\/api\/agents\/([^/]+)\/output\/(.+)$/);
  if (method === "GET" && agentOutputFileMatch) {
    const name = agentName(agentOutputFileMatch[1]);
    const fname = decodeURIComponent(agentOutputFileMatch[2]);
    if (!name || !fname) return badRequest(res, "invalid parameters");
    const outDir = path.join(EMPLOYEES_DIR, name, "output");
    const fp = path.resolve(path.join(outDir, fname));
    if (!fp.startsWith(outDir + path.sep) && fp !== outDir) return badRequest(res, "invalid path");
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
    const targetName = messagesMatch[1]; // avoid shadowing agentName() helper
    const agentDir = path.join(EMPLOYEES_DIR, targetName);
    if (!fs.existsSync(agentDir)) return notFound(res, `Agent '${targetName}' not found`);
    const body = await parseBody(req);
    if (!body.content) return badRequest(res, "content is required");
    const from = sanitizeFrom(body.from || "api");
    const inboxDir = path.join(agentDir, "chat_inbox");
    try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    const filename = `${nowStamp()}_from_${from}.md`;
    try { fs.writeFileSync(path.join(inboxDir, filename), String(body.content)); } catch (e) { return json(res, { error: "failed to write message" }, 500); }
    return json(res, { ok: true, file: filename }, 201);
  }

  // ---- Fallback ----
  notFound(res, "not found");
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
// Normalize parameterized URL paths before using as metrics keys.
// Raw paths like /api/agents/alice/cycles/5 create unique Map entries forever,
// causing an unbounded memory leak in apiMetrics._requests (primary leak source).
function normalizeEndpoint(method, pathname) {
  let p = pathname;
  // /api/agents/:name/... — replace agent name segment
  p = p.replace(/^(\/api\/agents\/)([a-zA-Z0-9_-]+)/, "$1:name");
  // /api/agents/:name/cycles/:n — numeric cycle index
  p = p.replace(/^(\/api\/agents\/:name\/cycles\/)(\d+)/, "$1:n");
  // /api/agents/:name/output/:file — any filename
  p = p.replace(/^(\/api\/agents\/:name\/output\/)(.+)/, "$1:file");
  // /api/tasks/:id and /api/tasks/:id/...
  p = p.replace(/^(\/api\/tasks\/)(\d+)/, "$1:id");
  // /api/inbox/:agent and /api/inbox/:agent/:id/ack
  p = p.replace(/^(\/api\/inbox\/)([a-zA-Z0-9_-]+)/, "$1:agent");
  p = p.replace(/^(\/api\/inbox\/:agent\/)(\d+)/, "$1:id");
  // /api/messages/:target
  p = p.replace(/^(\/api\/messages\/)([a-zA-Z0-9_-]+)/, "$1:target");
  // fallback: replace any remaining bare numeric segments
  p = p.replace(/\/(\d+)(\/|$)/g, "/:id$2");
  return `${method} ${p}`;
}

// ---------------------------------------------------------------------------
// Executor Configuration / Health
// ---------------------------------------------------------------------------
function readSmartRunConfig() {
  const configPath = path.join(PUBLIC_DIR, "smart_run_config.json");
  let config = { max_agents: 3, enabled: false, interval_seconds: 30, mode: "smart", enabled_executors: ["codex", "gemini"] };
  try {
    if (fs.existsSync(configPath)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
    }
  } catch (e) {
    console.error("[smart-run] Error reading config:", e.message);
  }
  return { configPath, config };
}

function normalizeEnabledExecutorsValue(raw) {
  const source = Array.isArray(raw) ? raw.join(",") : raw;
  return getEnabledExecutors(source);
}

function getEnabledExecutorList() {
  const { config } = readSmartRunConfig();
  const raw = process.env.ENABLED_EXECUTORS || config.enabled_executors;
  return normalizeEnabledExecutorsValue(raw);
}

function getExecutorConfigPath() {
  const primary = path.join(PUBLIC_DIR, "executor_config.md");
  if (fs.existsSync(primary)) return primary;
  return path.join(DIR, "public", "executor_config.md");
}

function getExecutorHealth(name) {
  const executor = normalizeExecutorName(name);
  const meta = getExecutorMeta(executor);
  if (!meta) {
    return {
      executor,
      supported: false,
      enabled: false,
      installed: false,
      authenticated: "unknown",
      runnable: false,
      message: "Unknown executor",
    };
  }
  const installed = (() => {
    const result = spawnSync(meta.binary, ["--version"], { encoding: "utf8" });
    return !result.error && result.status === 0;
  })();
  let authenticated = "unknown";
  if (meta.authEnvVars && meta.authEnvVars.some((key) => process.env[key])) {
    authenticated = "configured";
  }
  const enabled = isEnabledExecutor(executor, getEnabledExecutorList().join(","));
  const runnable = installed && enabled;
  const message = !enabled
    ? "Disabled by ENABLED_EXECUTORS"
    : !installed
      ? `Missing CLI: ${meta.binary}`
      : authenticated === "configured"
        ? "Configured via environment"
        : meta.authHint;
  return {
    executor,
    supported: true,
    enabled,
    installed,
    authenticated,
    runnable,
    message,
    transport: meta.transport,
    label: meta.label,
    badge: meta.badge,
    authHint: meta.authHint,
  };
}

function getExecutorForAgent(name) {
  const agentDir = path.join(EMPLOYEES_DIR, name);
  const configPath = getExecutorConfigPath();
  
  // Priority 1: per-agent executor.txt
  const agentExecutorPath = path.join(agentDir, "executor.txt");
  try {
    const content = normalizeExecutorName(fs.readFileSync(agentExecutorPath, "utf8"));
    if (isValidExecutor(content)) return content;
  } catch (_) {}

  // Priority 2: global config file per-agent table
  try {
    const config = fs.readFileSync(configPath, "utf8");
    const lines = config.split("\n");
    for (const line of lines) {
      const match = line.match(/^\|\s*(\w+)\s*\|\s*([a-z0-9_-]+)\s*\|/i);
      if (match && match[1].toLowerCase() === name.toLowerCase()) {
        const executor = normalizeExecutorName(match[2]);
        if (isValidExecutor(executor)) return executor;
      }
    }
  } catch (_) {}

  // Priority 3: global default
  try {
    const config = fs.readFileSync(configPath, "utf8");
    const defaultMatch = config.match(/## Global Default[\s\S]*?^executor:\s*([a-z0-9_-]+)/im);
    if (defaultMatch) {
      const executor = normalizeExecutorName(defaultMatch[1]);
      if (isValidExecutor(executor)) return executor;
    }
  } catch (_) {}

  // Fallback
  return DEFAULT_EXECUTOR;
}

function setExecutorForAgent(name, executor, { requireEnabled = false } = {}) {
  const normalized = normalizeExecutorName(executor);
  if (!isValidExecutor(normalized)) {
    return { ok: false, error: `Invalid executor: ${executor}. Must be: ${getSupportedExecutors().join(", ")}` };
  }
  if (requireEnabled && !getEnabledExecutorList().includes(normalized)) {
    return { ok: false, error: `Executor disabled: ${normalized}. Enabled: ${getEnabledExecutorList().join(", ")}` };
  }
  const agentDir = path.join(EMPLOYEES_DIR, name);
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "executor.txt"), normalized, "utf8");
    return { ok: true, executor: normalized };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const server = http.createServer((req, res) => {
  const _start = Date.now();
  const _endpoint = normalizeEndpoint(req.method, url.parse(req.url).pathname);
  const _method = req.method.toUpperCase();
  res.on("finish", () => {
    const _duration = Date.now() - _start;
    apiMetrics.recordRequest(_endpoint, _duration, res.statusCode);
    // Also record to metrics_queue.jsonl for Ivan's api_error_monitor.js
    recordProductionMetric(_endpoint, _method, res.statusCode, _duration);
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

// ---------------------------------------------------------------------------
// WebSocket Server — Task #113 (Real-Time Agent Updates, native Node.js)
// Handles HTTP Upgrade for ws:// on /api/ws — no external dependencies.
// ---------------------------------------------------------------------------
// WS-004: max concurrent WebSocket connections guard
const WS_MAX_CONNECTIONS = 100;
// WS-003: max payload per frame (64 KB) — prevents memory exhaustion
const WS_MAX_PAYLOAD = 64 * 1024;

server.on("upgrade", (req, socket, head) => {
  const parsed = url.parse(req.url);
  if (parsed.pathname !== "/api/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key || req.headers["upgrade"]?.toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // WS-001: API key authentication (mirrors isAuthorized() for HTTP requests)
  if (API_KEY) {
    const authHeader = req.headers["authorization"] || "";
    const xApiKey = req.headers["x-api-key"] || "";
    // Also accept key via Sec-WebSocket-Protocol (browser WS can't set custom headers)
    const wsProto = req.headers["sec-websocket-protocol"] || "";
    const wsKey = wsProto.startsWith("key_") ? wsProto.slice(4) : "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (xApiKey || wsKey);
    let authorized = false;
    if (provided) {
      try {
        const keyLen = Math.max(provided.length, API_KEY.length, 1);
        const a = Buffer.alloc(keyLen);
        const b = Buffer.alloc(keyLen);
        Buffer.from(provided).copy(a);
        Buffer.from(API_KEY).copy(b);
        authorized = provided.length === API_KEY.length && crypto.timingSafeEqual(a, b);
      } catch (_) { authorized = false; }
    }
    if (!authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  // WS-002: Origin validation — reject cross-origin connections when ALLOWED_ORIGINS is set
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers["origin"] || "";
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  // WS-004: Connection limit guard
  if (wsClients.size >= WS_MAX_CONNECTIONS) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  // RFC 6455: if client sent Sec-WebSocket-Protocol, server must echo the accepted subprotocol
  const wsProtoHeader = req.headers["sec-websocket-protocol"] || "";
  const firstProto = wsProtoHeader.split(",")[0].trim();
  const protoLine = firstProto ? `Sec-WebSocket-Protocol: ${firstProto}\r\n` : "";
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    protoLine +
    "\r\n"
  );
  wsClients.add(socket);
  // Send hello
  try { socket.write(wsEncode(JSON.stringify({ type: "hello", ts: Date.now() }))); } catch (_) {}
  // WS-003: maxPayload — drop oversized frames to prevent memory exhaustion
  // ML-002: Use a single buffer with length tracking to reduce GC pressure
  let wsBuf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    wsBuf = Buffer.concat([wsBuf, chunk]);
    if (wsBuf.length > WS_MAX_PAYLOAD) {
      socket.destroy();
      wsClients.delete(socket);
      wsBuf = null; // ML-002: Free buffer reference
      return;
    }
    const frame = wsDecode(wsBuf);
    if (!frame) return;
    // Keep remaining unparsed data instead of discarding
    const consumed = frame.consumed || wsBuf.length;
    wsBuf = wsBuf.slice(consumed);
    if (frame.opcode === 0x8) { // close
      const closeFrame = Buffer.from([0x88, 0x00]);
      try { socket.write(closeFrame); } catch (_) {}
      socket.destroy();
    } else if (frame.opcode === 0x9) { // ping → pong
      const pong = Buffer.alloc(2 + frame.payload.length);
      pong[0] = 0x8a; pong[1] = frame.payload.length;
      frame.payload.copy(pong, 2);
      try { socket.write(pong); } catch (_) {}
    }
  });
  socket.on("close", () => wsClients.delete(socket));
  socket.on("error", () => wsClients.delete(socket));
});

// Watch heartbeat files for agent_updated events (O(1) vs polling)
fs.watch(path.join(DIR, "agents"), { recursive: true }, (event, filename) => {
  if (filename && filename.endsWith("heartbeat.md")) {
    const agentName = filename.split(path.sep)[0];
    if (/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      broadcastWS("heartbeat_update", { agent: agentName, ts: Date.now() });
    }
  }
});

// Initialize SQLite message bus (Task #102)
initMessageBus(DIR);

server.listen(PORT, () => {
  console.log(`🪐 Agent Planet — dashboard on http://localhost:${PORT}`);
  console.log(`Directory: ${DIR}`);
  if (PLANET_NAME !== "default") console.log(`Planet: ${PLANET_NAME} (${PLANET_DIR})`);
  console.log(`Agents: ${listAgentNames().join(", ")}`);
});
