/**
 * Tokenfly Agent Team Lab — Backend API Module
 * Author: Bob (Backend Engineer)
 * Task: Beta task (Task 2 — critical)
 *
 * Provides:
 *   1. RateLimiter     — in-memory sliding-window rate limiter
 *   2. Validator       — request body validation helpers
 *   3. AgentMetrics    — lightweight in-process metrics store
 *   4. middleware()    — drop-in middleware factory for server.js integration
 *
 * Usage in server.js:
 *   const { middleware } = require('./agents/bob/output/backend-api-module');
 *   // In the request handler, before routing:
 *   const block = middleware(req, res, pathname);
 *   if (block) return; // rate limited or preflight handled
 */

"use strict";

// ---------------------------------------------------------------------------
// 1. RateLimiter — sliding window, per-IP, per-route
// ---------------------------------------------------------------------------
class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.windowMs   - window size in milliseconds (default 60_000)
   * @param {number} opts.maxRequests - max requests per window (default 60)
   */
  constructor(opts = {}) {
    this.windowMs = opts.windowMs || 60_000;
    this.maxRequests = opts.maxRequests || 60;
    // Map<key, number[]> — timestamps of requests in the current window
    this._store = new Map();
    // Prune old entries every 5 minutes to prevent unbounded growth
    setInterval(() => this._prune(), 5 * 60_000).unref();
  }

  /**
   * Check and record a request.
   * @param {string} key - e.g. `${ip}:${route}`
   * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
   */
  check(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this._store.get(key);
    if (!timestamps) {
      timestamps = [];
      this._store.set(key, timestamps);
    }

    // Drop timestamps outside the current window
    let i = 0;
    while (i < timestamps.length && timestamps[i] < windowStart) i++;
    timestamps.splice(0, i);

    const count = timestamps.length;
    if (count >= this.maxRequests) {
      const resetMs = timestamps[0] + this.windowMs - now;
      return { allowed: false, remaining: 0, resetMs };
    }

    timestamps.push(now);
    return { allowed: true, remaining: this.maxRequests - timestamps.length, resetMs: 0 };
  }

  _prune() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this._store) {
      const fresh = timestamps.filter((t) => t >= cutoff);
      if (fresh.length === 0) {
        this._store.delete(key);
      } else {
        this._store.set(key, fresh);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Validator — lightweight request body validation
// ---------------------------------------------------------------------------
const Validator = {
  /**
   * Validate a plain object against a schema.
   *
   * Schema shape:
   *   { fieldName: { type: 'string'|'number'|'boolean', required: bool, maxLength: num } }
   *
   * @param {object} body
   * @param {object} schema
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(body, schema) {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field];
      const missing = value === undefined || value === null || value === "";

      if (rules.required && missing) {
        errors.push(`"${field}" is required`);
        continue;
      }
      if (missing) continue; // optional field absent — skip further checks

      if (rules.type && typeof value !== rules.type) {
        errors.push(`"${field}" must be a ${rules.type}`);
        continue;
      }
      if (rules.maxLength && typeof value === "string" && value.length > rules.maxLength) {
        errors.push(`"${field}" exceeds max length of ${rules.maxLength}`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`"${field}" must be one of: ${rules.enum.join(", ")}`);
      }
      if (rules.pattern && typeof value === "string" && !rules.pattern.test(value)) {
        errors.push(`"${field}" has invalid format`);
      }
    }
    return { valid: errors.length === 0, errors };
  },

  // Convenience schemas for common Tokenfly API payloads
  schemas: {
    task: {
      title:       { type: "string", required: true,  maxLength: 200 },
      description: { type: "string", required: false, maxLength: 1000 },
      priority:    { type: "string", required: false, enum: ["low", "medium", "high", "critical"] },
      assignee:    { type: "string", required: false, maxLength: 50 },
      status:      { type: "string", required: false, enum: ["open", "in_progress", "blocked", "in_review", "done", "cancelled"] },
    },
    message: {
      message: { type: "string", required: true, maxLength: 5000 },
      from:    { type: "string", required: false, maxLength: 50 },
    },
    broadcast: {
      message: { type: "string", required: true, maxLength: 5000 },
      from:    { type: "string", required: false, maxLength: 50 },
    },
    agentStatus: {
      status: {
        type: "string",
        required: true,
        enum: ["running", "idle", "stopped", "error", "unknown"],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 3. AgentMetrics — in-process metrics store
// ---------------------------------------------------------------------------
class AgentMetrics {
  constructor() {
    // Map<endpoint, { count, totalMs, errors }[]>
    this._requests = new Map();
    // Map<agentName, { tasksDone, lastSeen, cycleCount }>
    this._agents = new Map();
    this._startTime = Date.now();
  }

  /**
   * Record a completed HTTP request.
   * @param {string} endpoint  - e.g. "GET /api/tasks"
   * @param {number} durationMs
   * @param {number} statusCode
   */
  recordRequest(endpoint, durationMs, statusCode) {
    let m = this._requests.get(endpoint);
    if (!m) {
      m = { count: 0, totalMs: 0, errors: 0, min: Infinity, max: 0 };
      this._requests.set(endpoint, m);
    }
    m.count++;
    m.totalMs += durationMs;
    if (statusCode >= 400) m.errors++;
    if (durationMs < m.min) m.min = durationMs;
    if (durationMs > m.max) m.max = durationMs;
  }

  /**
   * Record an agent heartbeat / cycle update.
   * @param {string} agentName
   * @param {{ tasksDone?: number, cycleCount?: number }} data
   */
  recordAgentActivity(agentName, data = {}) {
    let a = this._agents.get(agentName);
    if (!a) {
      a = { tasksDone: 0, lastSeen: null, cycleCount: 0 };
      this._agents.set(agentName, a);
    }
    if (data.tasksDone != null) a.tasksDone += data.tasksDone;
    if (data.cycleCount != null) a.cycleCount = data.cycleCount;
    a.lastSeen = new Date().toISOString();
  }

  /**
   * Return a snapshot of all collected metrics.
   * @returns {object}
   */
  snapshot() {
    const uptimeMs = Date.now() - this._startTime;
    const endpoints = {};
    for (const [ep, m] of this._requests) {
      endpoints[ep] = {
        requests: m.count,
        errors: m.errors,
        error_rate: m.count > 0 ? +(m.errors / m.count).toFixed(4) : 0,
        avg_ms: m.count > 0 ? Math.round(m.totalMs / m.count) : 0,
        min_ms: m.min === Infinity ? 0 : m.min,
        max_ms: m.max,
      };
    }
    const agents = {};
    for (const [name, a] of this._agents) {
      agents[name] = { ...a };
    }
    return {
      uptime_ms: uptimeMs,
      uptime_human: _formatDuration(uptimeMs),
      endpoints,
      agents,
      total_requests: [...this._requests.values()].reduce((s, m) => s + m.count, 0),
      total_errors: [...this._requests.values()].reduce((s, m) => s + m.errors, 0),
    };
  }

  reset() {
    this._requests.clear();
    this._agents.clear();
    this._startTime = Date.now();
  }
}

function _formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// 4. Singletons — export shared instances
// ---------------------------------------------------------------------------
const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: Number(process.env.RATE_LIMIT_MAX) || 120 });
const strictLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: Number(process.env.RATE_LIMIT_WRITE_MAX) || 20 }); // writes
const metrics = new AgentMetrics();

// SEC-002: trusted proxy CIDRs for X-Forwarded-For validation
// Set TRUSTED_PROXIES env var as comma-separated list (e.g. "127.0.0.1,10.0.0.1")
// Defaults to loopback only (safe for local dev). Set empty to disable XFF entirely.
const TRUSTED_PROXIES = new Set(
  (process.env.TRUSTED_PROXIES !== undefined
    ? process.env.TRUSTED_PROXIES
    : "127.0.0.1,::1,::ffff:127.0.0.1"
  ).split(",").map((s) => s.trim()).filter(Boolean)
);

/**
 * Returns the client IP for rate-limiting purposes.
 * Only uses X-Forwarded-For if the direct connection IP is a trusted proxy.
 * Prevents IP spoofing by untrusted clients sending fake XFF headers.
 */
function getClientIp(req) {
  const directIp = (req.socket && req.socket.remoteAddress) || "unknown";
  if (TRUSTED_PROXIES.size > 0 && TRUSTED_PROXIES.has(directIp)) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return xff.split(",")[0].trim();
  }
  return directIp;
}

// Routes that need stricter write limits (message-injection prevention)
const WRITE_ROUTES = new Set([
  "/api/messages",   // POST /api/messages/:agent — strict 20 req/min (Task #13)
  "/api/announce",
  "/api/announcements",
  "/api/broadcast",
  "/api/team-channel",
]);

/**
 * Drop-in middleware for server.js.
 *
 * Call at the top of the request handler BEFORE routing:
 *   const blocked = await middleware(req, res, pathname, method);
 *   if (blocked) return;
 *
 * Returns true if the response was already sent (rate limited or OPTIONS).
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string} pathname
 * @param {string} method
 * @returns {boolean}
 */
function middleware(req, res, pathname, method) {
  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  // Rate limiting (skip for static assets)
  if (pathname.startsWith("/api/")) {
    // SEC-002: only trust X-Forwarded-For from known proxy IPs
    const ip = getClientIp(req);
    // Skip rate limiting for localhost (e2e tests, local dev)
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return false;
    const isWrite = WRITE_ROUTES.has(pathname) && method !== "GET";
    const limiter = isWrite ? strictLimiter : rateLimiter;
    const key = `${ip}:${pathname}`;
    const result = limiter.check(key);

    if (!result.allowed) {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": Math.ceil(result.resetMs / 1000),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: "too many requests", retry_after_ms: result.resetMs }));
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// 5. Exports
// ---------------------------------------------------------------------------
module.exports = {
  RateLimiter,
  Validator,
  AgentMetrics,
  rateLimiter,
  strictLimiter,
  metrics,
  middleware,
};
