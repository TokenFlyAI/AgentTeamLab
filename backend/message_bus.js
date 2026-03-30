/**
 * message_bus.js — SQLite-backed Message Bus
 * Task #102 — Bob (Backend Engineer) — 2026-03-30
 *
 * Replaces file-based chat_inbox/ with a durable SQLite queue.
 * Per Rosa's distributed message bus design (agents/rosa/output/message_bus_design.md).
 *
 * Endpoints (mount at server.js handleRequest):
 *   POST /api/messages                     — send DM or broadcast
 *   GET  /api/inbox/:agent                 — list unread messages (FIFO, priority order)
 *   POST /api/inbox/:agent/:id/ack         — mark message as read
 *   POST /api/messages/broadcast           — fan-out to all active agents
 *   GET  /api/messages/queue-depth         — unread count per agent
 *
 * Usage:
 *   const { handleMessageBus, initMessageBus } = require("./backend/message_bus");
 *   initMessageBus(dir);   // call once at startup with the aicompany/ root dir
 *   // In request handler:
 *   if (handleMessageBus(req, res)) return;
 */

"use strict";

const fs   = require("fs");
const path = require("path");

let db = null;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent  TEXT    NOT NULL,
    to_agent    TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    priority    INTEGER NOT NULL DEFAULT 5,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    read_at     TEXT    DEFAULT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_inbox
    ON messages (to_agent, priority, id)
    WHERE read_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_messages_from
    ON messages (from_agent, created_at);
`;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function initMessageBus(dir) {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (_) {
    console.error("[message_bus] better-sqlite3 not installed. Run: npm install better-sqlite3");
    return false;
  }

  const dbPath = path.join(dir, "backend", "messages.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");   // concurrent reads + writes
  db.pragma("synchronous = NORMAL"); // durable on crash, faster than FULL
  db.exec(SCHEMA);
  console.log(`[message_bus] SQLite ready at ${dbPath}`);
  return true;
}

// ---------------------------------------------------------------------------
// MB-002: Per-sender rate limiter (in-memory, sliding 1-minute window)
// ---------------------------------------------------------------------------
const MSG_RATE_LIMIT       = parseInt(process.env.MB_MSG_RATE_LIMIT       || "60",  10); // messages/min per sender
const BROADCAST_RATE_LIMIT = parseInt(process.env.MB_BROADCAST_RATE_LIMIT || "5",   10); // broadcasts/min per sender
const WINDOW_MS            = 60 * 1000;

const _msgWindows  = new Map(); // sender → { count, windowStart }
const _bcastWindows = new Map();

function checkRateLimit(map, key, limit) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function validAgent(name) {
  return name && AGENT_NAME_RE.test(name) && name.length <= 64;
}

function activeAgents(dir) {
  try {
    return fs.readdirSync(path.join(dir, "agents")).filter((n) => {
      try {
        return fs.statSync(path.join(dir, "agents", n)).isDirectory();
      } catch (_) { return false; }
    });
  } catch (_) { return []; }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    function settle(fn) { if (!settled) { settled = true; fn(); } }
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        req.socket.destroy();
        return settle(() => reject(new Error("body too large")));
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      settle(() => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (_) { reject(new Error("invalid JSON")); }
      });
    });
    req.on("error", (err) => settle(() => reject(err)));
    req.on("close", () => settle(() => reject(new Error("request aborted"))));
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/messages
 * Body: { from: string, to: string, body: string, priority?: 1-9 }
 *
 * Sends a direct message. 'to' must be a known agent name.
 */
function postMessage(req, res, dir) {
  parseBody(req).then((data) => {
    const { from, to, body, priority = 5 } = data || {};
    if (!from || !validAgent(String(from))) return json(res, 400, { error: "invalid 'from'" });
    if (!to   || !validAgent(String(to)))   return json(res, 400, { error: "invalid 'to'" });
    if (!body || !String(body).trim())       return json(res, 400, { error: "'body' required" });
    if (!checkRateLimit(_msgWindows, String(from), MSG_RATE_LIMIT)) {
      return json(res, 429, { error: `rate limit exceeded: max ${MSG_RATE_LIMIT} messages/min per sender` });
    }
    const pri = Math.min(9, Math.max(1, Number(priority) || 5));

    const stmt = db.prepare(
      "INSERT INTO messages (from_agent, to_agent, body, priority) VALUES (?, ?, ?, ?)"
    );
    const info = stmt.run(String(from), String(to), String(body), pri);
    json(res, 201, { id: info.lastInsertRowid, from, to, priority: pri });
  }).catch((err) => json(res, 400, { error: err.message }));
}

/**
 * GET /api/inbox/:agent
 * Returns up to 50 unread messages in priority+FIFO order.
 * Does NOT auto-mark as read — call POST /api/inbox/:agent/:id/ack to ack.
 */
function getInbox(req, res, agentName) {
  if (!validAgent(agentName)) return json(res, 400, { error: "invalid agent name" });

  const rows = db.prepare(`
    SELECT id, from_agent, to_agent, body, priority, created_at
    FROM messages
    WHERE to_agent = ? AND read_at IS NULL
    ORDER BY priority ASC, id ASC
    LIMIT 50
  `).all(agentName);

  json(res, 200, { agent: agentName, unread: rows.length, messages: rows });
}

/**
 * POST /api/inbox/:agent/:id/ack
 * Marks a specific message as read.
 */
function ackMessage(req, res, agentName, msgId) {
  if (!validAgent(agentName)) return json(res, 400, { error: "invalid agent name" });
  const id = parseInt(msgId, 10);
  if (!id || isNaN(id)) return json(res, 400, { error: "invalid message id" });

  const row = db.prepare(
    "SELECT id FROM messages WHERE id = ? AND to_agent = ? AND read_at IS NULL"
  ).get(id, agentName);

  if (!row) return json(res, 404, { error: "message not found or already acked" });

  db.prepare("UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(id);

  json(res, 200, { id, acked: true });
}

/**
 * POST /api/messages/broadcast
 * Body: { from: string, body: string, priority?: 1-9 }
 * Fan-out: inserts one message per active agent.
 */
function postBroadcast(req, res, dir) {
  parseBody(req).then((data) => {
    const { from, body, priority = 5 } = data || {};
    if (!from || !validAgent(String(from))) return json(res, 400, { error: "invalid 'from'" });
    if (!body || !String(body).trim())       return json(res, 400, { error: "'body' required" });
    if (!checkRateLimit(_bcastWindows, String(from), BROADCAST_RATE_LIMIT)) {
      return json(res, 429, { error: `rate limit exceeded: max ${BROADCAST_RATE_LIMIT} broadcasts/min per sender` });
    }
    const pri = Math.min(9, Math.max(1, Number(priority) || 5));

    const agents = activeAgents(dir);
    if (agents.length === 0) return json(res, 200, { delivered: 0, agents: [] });

    const stmt = db.prepare(
      "INSERT INTO messages (from_agent, to_agent, body, priority) VALUES (?, ?, ?, ?)"
    );
    const insert = db.transaction((agentList) => {
      for (const agent of agentList) {
        stmt.run(String(from), agent, String(body), pri);
      }
    });
    insert(agents);

    json(res, 201, { delivered: agents.length, agents });
  }).catch((err) => json(res, 400, { error: err.message }));
}

/**
 * GET /api/messages/queue-depth
 * Returns unread count per agent.
 */
function getQueueDepth(req, res) {
  const rows = db.prepare(`
    SELECT to_agent AS agent, COUNT(*) AS unread
    FROM messages
    WHERE read_at IS NULL
    GROUP BY to_agent
    ORDER BY unread DESC
  `).all();

  const total = rows.reduce((sum, r) => sum + r.unread, 0);
  json(res, 200, { total_unread: total, by_agent: rows });
}

// ---------------------------------------------------------------------------
// Router — returns true if request was handled
// ---------------------------------------------------------------------------
function handleMessageBus(req, res, dir) {
  if (!db) return false;

  let parsed;
  try { parsed = new URL(req.url, "http://localhost"); } catch (_) { return false; }
  const pathname = parsed.pathname;
  const method   = req.method.toUpperCase();

  // POST /api/messages/broadcast
  if (method === "POST" && pathname === "/api/messages/broadcast") {
    postBroadcast(req, res, dir);
    return true;
  }

  // POST /api/messages
  if (method === "POST" && pathname === "/api/messages") {
    postMessage(req, res, dir);
    return true;
  }

  // GET /api/messages/queue-depth
  if (method === "GET" && pathname === "/api/messages/queue-depth") {
    getQueueDepth(req, res);
    return true;
  }

  // GET /api/inbox/:agent
  const inboxMatch = pathname.match(/^\/api\/inbox\/([^/]+)$/);
  if (method === "GET" && inboxMatch) {
    getInbox(req, res, inboxMatch[1]);
    return true;
  }

  // POST /api/inbox/:agent/:id/ack
  const ackMatch = pathname.match(/^\/api\/inbox\/([^/]+)\/(\d+)\/ack$/);
  if (method === "POST" && ackMatch) {
    ackMessage(req, res, ackMatch[1], ackMatch[2]);
    return true;
  }

  return false;
}

module.exports = { initMessageBus, handleMessageBus };
