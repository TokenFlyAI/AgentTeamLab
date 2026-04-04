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

  CREATE INDEX IF NOT EXISTS idx_messages_read_at
    ON messages (read_at)
    WHERE read_at IS NOT NULL;
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

  // Auto-vacuum: delete read messages older than retention window at startup
  const retentionDays = parseInt(process.env.MB_RETENTION_DAYS || "7", 10);
  const vacuumed = db.prepare(
    "DELETE FROM messages WHERE read_at IS NOT NULL AND julianday(read_at) < julianday('now', ?)"
  ).run(`-${retentionDays} days`);
  if (vacuumed.changes > 0) {
    console.log(`[message_bus] Auto-vacuum removed ${vacuumed.changes} read messages older than ${retentionDays} days`);
  }

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
    // Only treat close as an abort if the request body wasn't fully received yet.
    // On keep-alive connections, 'close' can fire after 'end' — don't double-reject.
    req.on("close", () => { if (!req.complete) settle(() => reject(new Error("request aborted"))); });
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
    const MAX_BODY_LEN = 4096;
    if (!from || !validAgent(String(from))) return json(res, 400, { error: "invalid 'from'" });
    if (!to   || !validAgent(String(to)))   return json(res, 400, { error: "invalid 'to'" });
    if (!body || !String(body).trim())       return json(res, 400, { error: "'body' required" });
    if (String(body).length > MAX_BODY_LEN) return json(res, 400, { error: `'body' must be ≤${MAX_BODY_LEN} chars` });
    if (!checkRateLimit(_msgWindows, String(from), MSG_RATE_LIMIT)) {
      return json(res, 429, { error: `rate limit exceeded: max ${MSG_RATE_LIMIT} messages/min per sender` });
    }
    const pri = Math.min(9, Math.max(1, Number(priority) || 5));

    const stmt = db.prepare(
      "INSERT INTO messages (from_agent, to_agent, body, priority) VALUES (?, ?, ?, ?)"
    );
    const info = stmt.run(String(from), String(to), String(body), pri);
    json(res, 201, { id: info.lastInsertRowid, from, to, priority: pri });
  }).catch((err) => {
    if (err.message === "invalid JSON") return json(res, 400, { error: "invalid JSON body" });
    console.error("[postMessage] error:", err); json(res, 500, { error: "internal server error" });
  });
}

/**
 * GET /api/inbox/:agent[?limit=N&offset=N]
 * Returns unread messages in priority+FIFO order.
 * limit: max results (1-100, default 50). offset: skip N rows (default 0).
 * Does NOT auto-mark as read — call POST /api/inbox/:agent/:id/ack to ack.
 */
function getInbox(req, res, agentName, query) {
  if (!validAgent(agentName)) return json(res, 400, { error: "invalid agent name" });

  const rawLimit = parseInt((query && query.get("limit")) || "50", 10);
  const rawOffset = parseInt((query && query.get("offset")) || "0", 10);
  const limit = (!isNaN(rawLimit) && rawLimit >= 1 && rawLimit <= 100) ? rawLimit : 50;
  const offset = (!isNaN(rawOffset) && rawOffset >= 0) ? rawOffset : 0;

  const rows = db.prepare(`
    SELECT id, from_agent, to_agent, body, priority, created_at
    FROM messages
    WHERE to_agent = ? AND read_at IS NULL
    ORDER BY priority ASC, id ASC
    LIMIT ? OFFSET ?
  `).all(agentName, limit, offset);

  json(res, 200, { agent: agentName, unread: rows.length, limit, offset, messages: rows });
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
    const MAX_BODY_LEN = 4096;
    if (!from || !validAgent(String(from))) return json(res, 400, { error: "invalid 'from'" });
    if (!body || !String(body).trim())       return json(res, 400, { error: "'body' required" });
    if (String(body).length > MAX_BODY_LEN) return json(res, 400, { error: `'body' must be ≤${MAX_BODY_LEN} chars` });
    if (!checkRateLimit(_bcastWindows, String(from), BROADCAST_RATE_LIMIT)) {
      return json(res, 429, { error: `rate limit exceeded: max ${BROADCAST_RATE_LIMIT} broadcasts/min per sender` });
    }
    const pri = Math.min(9, Math.max(1, Number(priority) || 5));

    const agents = activeAgents(dir).filter(validAgent);
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
  }).catch((err) => {
    if (err.message === "invalid JSON") return json(res, 400, { error: "invalid JSON body" });
    console.error("[postBroadcast] error:", err); json(res, 500, { error: "internal server error" });
  });
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

/**
 * DELETE /api/messages/purge
 * Query params: ?days=N (default 7) — delete read messages older than N days.
 * Also accepts ?unread=true to also purge unread messages beyond the window.
 * Returns: { deleted: number, retention_days: number }
 */
function purgeMessages(req, res) {
  let parsed;
  try { parsed = new URL(req.url, "http://localhost"); } catch (_) {
    return json(res, 400, { error: "invalid URL" });
  }

  // ?from=<sender> — delete ALL messages (read+unread) from that exact sender
  const fromSender = parsed.searchParams.get("from");
  if (fromSender) {
    if (!validAgent(fromSender)) return json(res, 400, { error: "invalid 'from' name" });
    const result = db.prepare("DELETE FROM messages WHERE from_agent = ?").run(fromSender);
    return json(res, 200, { deleted: result.changes, from: fromSender });
  }

  const daysParam = parsed.searchParams.get("days");
  const days = daysParam ? parseInt(daysParam, 10) : 7;
  if (isNaN(days) || days < 0) return json(res, 400, { error: "'days' must be a non-negative integer" });

  const includeUnread = parsed.searchParams.get("unread") === "true";
  const offset = `-${days} days`;

  let result;
  if (includeUnread) {
    result = db.prepare(
      "DELETE FROM messages WHERE julianday(created_at) < julianday('now', ?)"
    ).run(offset);
  } else {
    result = db.prepare(
      "DELETE FROM messages WHERE read_at IS NOT NULL AND julianday(read_at) < julianday('now', ?)"
    ).run(offset);
  }

  json(res, 200, { deleted: result.changes, retention_days: days, include_unread: includeUnread });
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

  // DELETE /api/messages/purge
  if (method === "DELETE" && pathname === "/api/messages/purge") {
    purgeMessages(req, res);
    return true;
  }

  // DELETE /api/messages/:id — delete a specific message by ID
  const msgDeleteMatch = pathname.match(/^\/api\/messages\/(\d+)$/);
  if (method === "DELETE" && msgDeleteMatch) {
    const id = parseInt(msgDeleteMatch[1], 10);
    const result = db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    if (result.changes === 0) return json(res, 404, { error: "message not found" });
    json(res, 200, { ok: true, deleted: id });
    return true;
  }

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

  // GET /api/inbox/:agent[?limit=N&offset=N]
  const inboxMatch = pathname.match(/^\/api\/inbox\/([^/]+)$/);
  if (method === "GET" && inboxMatch) {
    getInbox(req, res, inboxMatch[1], parsed.searchParams);
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
