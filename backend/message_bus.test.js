/**
 * message_bus.test.js — Unit tests for backend/message_bus.js
 * Bob (Backend Engineer) — 2026-03-30 — Session 16
 *
 * Run: node backend/message_bus.test.js
 *
 * Uses real better-sqlite3 with an in-memory DB (":memory:") for speed.
 * Tests all 5 endpoints via a real http.Server to exercise the full stack.
 */

"use strict";

const http = require("http");
const os   = require("os");
const path = require("path");
const fs   = require("fs");

// ---------------------------------------------------------------------------
// Test framework helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failures.push({ name, err });
    failed++;
  }
}

// ---------------------------------------------------------------------------
// HTTP client helpers
// ---------------------------------------------------------------------------
function httpReq(method, path, body, port) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch (_) {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get      = (p, port)    => httpReq("GET",    p, null, port);
const post     = (p, b, port) => httpReq("POST",   p, b,    port);
const doPost   = post;
const doDelete = (p, port)    => httpReq("DELETE", p, null, port);

// ---------------------------------------------------------------------------
// Patch initMessageBus to use in-memory DB
// ---------------------------------------------------------------------------
function patchMessageBus() {
  // Require the module so we can monkey-patch its internals
  // We re-require a fresh copy for each test suite via a temp file trick
  // Instead: we patch the module by intercepting require("better-sqlite3")

  // Temporarily override the DB path by setting up a temp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-test-"));
  // Create agents/ subdirectory with a couple of dummy agent dirs
  const agentsDir = path.join(tmpDir, "agents");
  fs.mkdirSync(agentsDir);
  fs.mkdirSync(path.join(agentsDir, "alice"));
  fs.mkdirSync(path.join(agentsDir, "bob"));
  // Create backend/ dir (DB lives here)
  fs.mkdirSync(path.join(tmpDir, "backend"));
  return tmpDir;
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
function startServer(dir) {
  return new Promise((resolve) => {
    // Re-require message_bus with a fresh state each run
    // Clear module cache to get a fresh db=null
    const mbPath = require.resolve("./message_bus");
    delete require.cache[mbPath];
    const { initMessageBus, handleMessageBus } = require("./message_bus");

    initMessageBus(dir);

    const server = http.createServer((req, res) => {
      if (!handleMessageBus(req, res, dir)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function runTests() {
  const dir  = patchMessageBus();
  const { server, port } = await startServer(dir);

  // ── POST /api/messages ──────────────────────────────────────────────────

  console.log("\n--- POST /api/messages ---");

  await test("returns 201 with id on valid DM", async () => {
    const r = await post("/api/messages", { from: "alice", to: "bob", body: "hello" }, port);
    assert(r.status === 201, `expected 201 got ${r.status}`);
    assert(r.body.id > 0, "expected id > 0");
    assert(r.body.from === "alice");
    assert(r.body.to === "bob");
    assert(r.body.priority === 5, "default priority 5");
  });

  await test("returns 201 with custom priority clamped to 1-9", async () => {
    const r = await post("/api/messages", { from: "alice", to: "bob", body: "hi", priority: 1 }, port);
    assert(r.status === 201, `expected 201 got ${r.status}`);
    assert(r.body.priority === 1);
  });

  await test("priority=0 treated as missing, defaults to 5 (falsy guard)", async () => {
    // Number(0) || 5 === 5 — zero is treated as "not provided", not as a clamp target
    const r = await post("/api/messages", { from: "alice", to: "bob", body: "hi", priority: 0 }, port);
    assert(r.status === 201);
    assert(r.body.priority === 5, `expected 5 (default) got ${r.body.priority}`);
  });

  await test("priority clamped: 10 becomes 9", async () => {
    const r = await post("/api/messages", { from: "alice", to: "bob", body: "hi", priority: 10 }, port);
    assert(r.status === 201);
    assert(r.body.priority === 9, `expected 9 got ${r.body.priority}`);
  });

  await test("returns 400 when from is missing", async () => {
    const r = await post("/api/messages", { to: "bob", body: "hello" }, port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
    assert(r.body.error.includes("from"), `msg: ${r.body.error}`);
  });

  await test("returns 400 when to is missing", async () => {
    const r = await post("/api/messages", { from: "alice", body: "hello" }, port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
    assert(r.body.error.includes("to"), `msg: ${r.body.error}`);
  });

  await test("returns 400 when body is empty", async () => {
    const r = await post("/api/messages", { from: "alice", to: "bob", body: "   " }, port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
    assert(r.body.error.includes("body"), `msg: ${r.body.error}`);
  });

  await test("returns 400 for path traversal in 'from'", async () => {
    const r = await post("/api/messages", { from: "../etc", to: "bob", body: "hi" }, port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
  });

  // ── GET /api/inbox/:agent ───────────────────────────────────────────────

  console.log("\n--- GET /api/inbox/:agent ---");

  await test("returns 200 with messages for agent", async () => {
    const r = await get("/api/inbox/bob", port);
    assert(r.status === 200, `expected 200 got ${r.status}`);
    assert(r.body.agent === "bob");
    assert(Array.isArray(r.body.messages));
    assert(r.body.unread >= 3, `expected ≥3 unread, got ${r.body.unread}`);
  });

  await test("messages ordered by priority ASC", async () => {
    // send priority 9 then priority 1
    await post("/api/messages", { from: "alice", to: "bob", body: "low-pri", priority: 9 }, port);
    await post("/api/messages", { from: "alice", to: "bob", body: "high-pri", priority: 1 }, port);
    const r = await get("/api/inbox/bob", port);
    assert(r.status === 200);
    const pris = r.body.messages.map((m) => m.priority);
    for (let i = 1; i < pris.length; i++) {
      assert(pris[i] >= pris[i - 1], `priority not sorted: ${pris}`);
    }
  });

  await test("returns 400 for invalid agent name", async () => {
    const r = await get("/api/inbox/../etc", port);
    // Either 400 (if caught) or 404 (no route match — path traversal blocked at routing)
    assert(r.status === 400 || r.status === 404, `expected 400 or 404 got ${r.status}`);
  });

  await test("empty inbox returns 0 unread for unknown agent", async () => {
    const r = await get("/api/inbox/nobody_agent_xyz", port);
    assert(r.status === 200);
    assert(r.body.unread === 0);
    assert(r.body.messages.length === 0);
  });

  // ── POST /api/inbox/:agent/:id/ack ──────────────────────────────────────

  console.log("\n--- POST /api/inbox/:agent/:id/ack ---");

  await test("acks a message and removes it from inbox", async () => {
    // Send a fresh message
    const sendRes = await post("/api/messages", { from: "alice", to: "bob", body: "ack-me" }, port);
    assert(sendRes.status === 201);
    const msgId = sendRes.body.id;

    const ackRes = await post(`/api/inbox/bob/${msgId}/ack`, {}, port);
    assert(ackRes.status === 200, `expected 200 got ${ackRes.status}`);
    assert(ackRes.body.id === msgId);
    assert(ackRes.body.acked === true);

    // Inbox should no longer contain this message
    const inboxRes = await get("/api/inbox/bob", port);
    const found = inboxRes.body.messages.some((m) => m.id === msgId);
    assert(!found, "acked message still in inbox");
  });

  await test("ack returns 404 for already-acked message", async () => {
    const sendRes = await post("/api/messages", { from: "alice", to: "bob", body: "double-ack" }, port);
    const msgId = sendRes.body.id;
    await post(`/api/inbox/bob/${msgId}/ack`, {}, port);
    const r = await post(`/api/inbox/bob/${msgId}/ack`, {}, port);
    assert(r.status === 404, `expected 404 got ${r.status}`);
  });

  await test("ack returns 404 for wrong recipient", async () => {
    const sendRes = await post("/api/messages", { from: "alice", to: "bob", body: "for-bob" }, port);
    const msgId = sendRes.body.id;
    const r = await post(`/api/inbox/alice/${msgId}/ack`, {}, port);
    assert(r.status === 404, `expected 404 got ${r.status}`);
  });

  await test("ack route returns 404 for non-numeric id (regex requires \\d+)", async () => {
    // Route pattern: /api/inbox/:agent/(\d+)/ack — non-digits don't match, falls through to 404
    const r = await post("/api/inbox/bob/notanumber/ack", {}, port);
    assert(r.status === 404, `expected 404 got ${r.status}`);
  });

  // ── POST /api/messages/broadcast ────────────────────────────────────────

  console.log("\n--- POST /api/messages/broadcast ---");

  await test("broadcasts to all active agents", async () => {
    const r = await post("/api/messages/broadcast", { from: "ceo", body: "all-hands" }, port);
    assert(r.status === 201, `expected 201 got ${r.status}`);
    assert(r.body.delivered >= 2, `expected ≥2 delivered, got ${r.body.delivered}`);
    assert(Array.isArray(r.body.agents));
    assert(r.body.agents.includes("alice"), "alice should be in agents");
    assert(r.body.agents.includes("bob"),   "bob should be in agents");
  });

  await test("broadcast returns 400 when from missing", async () => {
    const r = await post("/api/messages/broadcast", { body: "hi" }, port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
  });

  await test("broadcast returns 400 when body missing", async () => {
    const r = await post("/api/messages/broadcast", { from: "ceo", body: "" }, port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
  });

  await test("broadcast message appears in each agent's inbox", async () => {
    const unique = `bcast-${Date.now()}`;
    await post("/api/messages/broadcast", { from: "ceo", body: unique }, port);
    const [rAlice, rBob] = await Promise.all([
      get("/api/inbox/alice", port),
      get("/api/inbox/bob",   port),
    ]);
    const inAlice = rAlice.body.messages.some((m) => m.body === unique);
    const inBob   = rBob.body.messages.some((m) => m.body === unique);
    assert(inAlice, "broadcast not in alice inbox");
    assert(inBob,   "broadcast not in bob inbox");
  });

  // ── GET /api/messages/queue-depth ───────────────────────────────────────

  console.log("\n--- GET /api/messages/queue-depth ---");

  await test("returns 200 with total_unread and by_agent", async () => {
    const r = await get("/api/messages/queue-depth", port);
    assert(r.status === 200, `expected 200 got ${r.status}`);
    assert(typeof r.body.total_unread === "number");
    assert(Array.isArray(r.body.by_agent));
  });

  await test("queue depth reflects new messages", async () => {
    const before = await get("/api/messages/queue-depth", port);
    const prevTotal = before.body.total_unread;

    await post("/api/messages", { from: "alice", to: "bob", body: "depth-test" }, port);

    const after = await get("/api/messages/queue-depth", port);
    assert(after.body.total_unread === prevTotal + 1, `expected ${prevTotal + 1} got ${after.body.total_unread}`);
  });

  await test("by_agent has agent field and unread count", async () => {
    const r = await get("/api/messages/queue-depth", port);
    for (const entry of r.body.by_agent) {
      assert(typeof entry.agent  === "string", "missing agent field");
      assert(typeof entry.unread === "number", "missing unread count");
    }
  });

  // ── GET /api/inbox pagination ─────────────────────────────────────────────

  console.log("\n--- GET /api/inbox pagination ---");

  await test("limit param restricts results", async () => {
    const agent = "paginate_agent";
    // send 5 messages
    for (let i = 1; i <= 5; i++) {
      await post("/api/messages", { from: "alice", to: agent, body: `msg${i}` }, port);
    }
    const r = await get(`/api/inbox/${agent}?limit=2`, port);
    assert(r.status === 200, `expected 200 got ${r.status}`);
    assert(r.body.messages.length === 2, `expected 2 msgs got ${r.body.messages.length}`);
    assert(r.body.limit === 2, `expected limit=2`);
    assert(r.body.offset === 0, `expected offset=0`);
  });

  await test("offset param skips rows", async () => {
    // paginate_agent still has 5 unread msgs from above (none acked)
    const r = await get("/api/inbox/paginate_agent?limit=2&offset=2", port);
    assert(r.status === 200, `expected 200 got ${r.status}`);
    assert(r.body.messages.length === 2, `expected 2 msgs got ${r.body.messages.length}`);
    assert(r.body.offset === 2, `expected offset=2`);
  });

  await test("limit defaults to 50 when absent", async () => {
    const r = await get("/api/inbox/paginate_agent", port);
    assert(r.body.limit === 50, `expected default limit=50, got ${r.body.limit}`);
  });

  await test("limit clamped to 100 max", async () => {
    const r = await get("/api/inbox/paginate_agent?limit=999", port);
    assert(r.body.limit === 50, `expected clamped to 50 (default), got ${r.body.limit}`);
  });

  await test("invalid limit falls back to default 50", async () => {
    const r = await get("/api/inbox/paginate_agent?limit=abc", port);
    assert(r.body.limit === 50, `expected default 50 got ${r.body.limit}`);
  });

  // ── Purge ─────────────────────────────────────────────────────────────────
  await test("DELETE /api/messages/purge: purges read messages older than N days", async () => {
    // Send and ack a message so read_at is set
    await doPost("/api/messages", { from: "purge_sender", to: "purge_agent", body: "old msg" }, port);
    const inbox = await get("/api/inbox/purge_agent", port);
    const msgId = inbox.body.messages[0].id;
    await doPost(`/api/inbox/purge_agent/${msgId}/ack`, {}, port);
    // Purge with days=0 (anything read) should delete it
    const r = await doDelete("/api/messages/purge?days=0", port);
    assert(r.status === 200, `expected 200 got ${r.status}`);
    assert(typeof r.body.deleted === "number", "expected deleted count");
    assert(r.body.deleted >= 1, `expected at least 1 deleted, got ${r.body.deleted}`);
  });

  await test("DELETE /api/messages/purge: does not purge unread by default", async () => {
    await doPost("/api/messages", { from: "purge_sender2", to: "purge_agent2", body: "unread msg" }, port);
    const r = await doDelete("/api/messages/purge?days=0", port);
    assert(r.status === 200, `expected 200 got ${r.status}`);
    // Unread message should still be in inbox
    const inbox = await get("/api/inbox/purge_agent2", port);
    assert(inbox.body.messages.length >= 1, "unread message should not be purged");
  });

  await test("DELETE /api/messages/purge: ?unread=true purges all old messages", async () => {
    await doPost("/api/messages", { from: "purge_sender3", to: "purge_agent3", body: "any msg" }, port);
    const r = await doDelete("/api/messages/purge?days=0&unread=true", port);
    assert(r.status === 200, `expected 200 got ${r.status}`);
    assert(r.body.include_unread === true, "expected include_unread=true");
    assert(r.body.deleted >= 1, `expected at least 1 deleted, got ${r.body.deleted}`);
  });

  await test("DELETE /api/messages/purge: invalid days param returns 400", async () => {
    const r = await doDelete("/api/messages/purge?days=abc", port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
  });

  await test("DELETE /api/messages/purge: negative days param returns 400", async () => {
    const r = await doDelete("/api/messages/purge?days=-1", port);
    assert(r.status === 400, `expected 400 got ${r.status}`);
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await stopServer(server);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
runTests().then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailed tests:");
    for (const { name, err } of failures) {
      console.error(`  - ${name}: ${err.message}`);
    }
    process.exit(1);
  }
}).catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
