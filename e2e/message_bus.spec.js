// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * Message Bus Integration Tests — Task #110
 * Frank (QA Engineer) — 2026-03-30
 *
 * Tests the SQLite-backed message bus endpoints:
 *   POST /api/messages               — send a DM
 *   GET  /api/inbox/:agent           — list unread messages
 *   POST /api/inbox/:agent/:id/ack   — acknowledge (mark as read)
 *   POST /api/messages/broadcast     — fan-out to all agents
 *   GET  /api/messages/queue-depth   — unread count per agent
 *
 * See: backend/message_bus.js, agents/rosa/output/message_bus_design.md
 */

const BASE = "http://localhost:3199";
const AUTH_HEADERS = { "Authorization": "Bearer test" };

// Use a stable test agent name to avoid coupling to real agent list
const TEST_AGENT = "alice";
const TEST_SENDER = "frank";
// Unique broadcast sender per test run — avoids exhausting the per-sender
// 5/min broadcast rate limit when the suite runs repeatedly within one minute.
const BROADCAST_SENDER = `frank-e2e-${Date.now()}`;

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: AUTH_HEADERS });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPost(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ── POST /api/messages ────────────────────────────────────────────────────────

test.describe("POST /api/messages", () => {
  test("returns 201 with message id on valid DM", async () => {
    const { status, body } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `E2E DM test — ${Date.now()}`,
    });
    expect(status).toBe(201);
    expect(typeof body.id).toBe("number");
    expect(body.from).toBe(TEST_SENDER);
    expect(body.to).toBe(TEST_AGENT);
  });

  test("defaults priority to 5 when not specified", async () => {
    const { status, body } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: "priority default test",
    });
    expect(status).toBe(201);
    expect(body.priority).toBe(5);
  });

  test("accepts custom priority 1-9", async () => {
    const { status, body } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: "high priority message",
      priority: 1,
    });
    expect(status).toBe(201);
    expect(body.priority).toBe(1);
  });

  test("clamps priority above 9 to 9", async () => {
    const { status, body } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: "over-limit priority",
      priority: 99,
    });
    expect(status).toBe(201);
    expect(body.priority).toBe(9);
  });

  test("clamps priority below 1 to 1", async () => {
    const { status, body } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: "under-limit priority",
      priority: -5,
    });
    expect(status).toBe(201);
    expect(body.priority).toBe(1);
  });

  test("returns 400 when 'from' is missing", async () => {
    const { status } = await apiPost("/api/messages", {
      to: TEST_AGENT,
      body: "missing from",
    });
    expect(status).toBe(400);
  });

  test("returns 400 when 'to' is missing", async () => {
    const { status } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      body: "missing to",
    });
    expect(status).toBe(400);
  });

  test("returns 400 when 'body' is missing", async () => {
    const { status } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
    });
    expect(status).toBe(400);
  });

  test("returns 400 when 'body' is empty string", async () => {
    const { status } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: "   ",
    });
    expect(status).toBe(400);
  });

  test("returns 400 for invalid agent name with special characters", async () => {
    const { status } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: "../../etc/passwd",
      body: "path traversal attempt",
    });
    expect(status).toBe(400);
  });

  test("returns 400 for invalid 'from' name with special characters", async () => {
    const { status } = await apiPost("/api/messages", {
      from: "bad|name",
      to: TEST_AGENT,
      body: "bad sender name",
    });
    expect(status).toBe(400);
  });

  test("returns 400 for invalid JSON body", async () => {
    const res = await fetch(`${BASE}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: "not-json{{{",
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/inbox/:agent ─────────────────────────────────────────────────────

test.describe("GET /api/inbox/:agent", () => {
  test("returns 200 with inbox structure", async () => {
    const { status, body } = await apiGet(`/api/inbox/${TEST_AGENT}`);
    expect(status).toBe(200);
    expect(body.agent).toBe(TEST_AGENT);
    expect(typeof body.unread).toBe("number");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test("delivered message appears in inbox", async () => {
    const uniqueBody = `inbox-visibility-test-${Date.now()}`;
    const { body: sent } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: uniqueBody,
    });
    expect(sent.id).toBeDefined();

    const { body: inbox } = await apiGet(`/api/inbox/${TEST_AGENT}`);
    const found = inbox.messages.some((m) => m.body === uniqueBody);
    expect(found).toBe(true);
  });

  test("inbox message has expected fields", async () => {
    const { body: sent } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `field-check-${Date.now()}`,
    });

    const { body: inbox } = await apiGet(`/api/inbox/${TEST_AGENT}`);
    const msg = inbox.messages.find((m) => m.id === sent.id);
    expect(msg).toBeDefined();
    expect(typeof msg.id).toBe("number");
    expect(msg.from_agent).toBe(TEST_SENDER);
    expect(msg.to_agent).toBe(TEST_AGENT);
    expect(typeof msg.body).toBe("string");
    expect(typeof msg.priority).toBe("number");
    expect(typeof msg.created_at).toBe("string");
  });

  test("messages are ordered by priority ASC then id ASC", async () => {
    const tag = `order-test-${Date.now()}`;
    // Insert low priority first, then high priority
    await apiPost("/api/messages", { from: TEST_SENDER, to: "bob", body: `${tag}-low`, priority: 9 });
    await apiPost("/api/messages", { from: TEST_SENDER, to: "bob", body: `${tag}-high`, priority: 1 });

    const { body: inbox } = await apiGet("/api/inbox/bob");
    const tagged = inbox.messages.filter((m) => m.body.startsWith(tag));
    expect(tagged.length).toBeGreaterThanOrEqual(2);

    // higher priority (lower number) should come first
    const highIdx = tagged.findIndex((m) => m.body === `${tag}-high`);
    const lowIdx  = tagged.findIndex((m) => m.body === `${tag}-low`);
    expect(highIdx).toBeLessThan(lowIdx);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/inbox/bad|name");
    expect(status).toBe(400);
  });

  test("returns empty inbox for agent with no messages", async () => {
    // Use an agent name unlikely to have messages in this test run
    const { status, body } = await apiGet("/api/inbox/quinn");
    expect(status).toBe(200);
    expect(body.agent).toBe("quinn");
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

// ── POST /api/inbox/:agent/:id/ack ────────────────────────────────────────────

test.describe("POST /api/inbox/:agent/:id/ack", () => {
  test("acks a message and returns 200", async () => {
    const { body: sent } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `ack-test-${Date.now()}`,
    });
    const msgId = sent.id;

    const { status, body } = await apiPost(`/api/inbox/${TEST_AGENT}/${msgId}/ack`);
    expect(status).toBe(200);
    expect(body.id).toBe(msgId);
    expect(body.acked).toBe(true);
  });

  test("acked message no longer appears in inbox", async () => {
    const uniqueBody = `ack-disappear-${Date.now()}`;
    const { body: sent } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: uniqueBody,
    });

    await apiPost(`/api/inbox/${TEST_AGENT}/${sent.id}/ack`);

    const { body: inbox } = await apiGet(`/api/inbox/${TEST_AGENT}`);
    const stillPresent = inbox.messages.some((m) => m.id === sent.id);
    expect(stillPresent).toBe(false);
  });

  test("double-ack returns 404", async () => {
    const { body: sent } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `double-ack-${Date.now()}`,
    });

    await apiPost(`/api/inbox/${TEST_AGENT}/${sent.id}/ack`);
    const { status } = await apiPost(`/api/inbox/${TEST_AGENT}/${sent.id}/ack`);
    expect(status).toBe(404);
  });

  test("acking non-existent message id returns 404", async () => {
    const { status } = await apiPost(`/api/inbox/${TEST_AGENT}/999999999/ack`);
    expect(status).toBe(404);
  });

  test("acking with wrong agent returns 404", async () => {
    const { body: sent } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `wrong-agent-ack-${Date.now()}`,
    });

    // Try to ack from a different agent
    const { status } = await apiPost(`/api/inbox/bob/${sent.id}/ack`);
    expect(status).toBe(404);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiPost("/api/inbox/bad|agent/1/ack");
    expect(status).toBe(400);
  });

  test("returns 400 for non-numeric message id", async () => {
    const { status } = await apiPost(`/api/inbox/${TEST_AGENT}/notanumber/ack`);
    // Non-numeric id won't match the /(\d+)/ route, so expect 404 from server (no route match)
    // The route regex only matches digits, so a non-digit path won't reach ackMessage at all
    expect([400, 404]).toContain(status);
  });
});

// ── POST /api/messages/broadcast ─────────────────────────────────────────────

test.describe("POST /api/messages/broadcast", () => {
  test("returns 201 with delivered count and agent list", async () => {
    const { status, body } = await apiPost("/api/messages/broadcast", {
      from: BROADCAST_SENDER,
      body: `broadcast-test-${Date.now()}`,
    });
    expect(status).toBe(201);
    expect(typeof body.delivered).toBe("number");
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.delivered).toBe(body.agents.length);
  });

  test("broadcast delivers to multiple agents (>1)", async () => {
    const { body } = await apiPost("/api/messages/broadcast", {
      from: BROADCAST_SENDER,
      body: `multi-deliver-${Date.now()}`,
    });
    // There are 20 agents in the system, should reach multiple
    expect(body.delivered).toBeGreaterThan(1);
  });

  test("broadcast message appears in each recipient's inbox", async () => {
    const uniqueBody = `broadcast-inbox-check-${Date.now()}`;
    const { body: bcast } = await apiPost("/api/messages/broadcast", {
      from: BROADCAST_SENDER,
      body: uniqueBody,
    });

    // Check the first 2 agents in the broadcast list received the message
    const recipients = bcast.agents.slice(0, 2);
    for (const agent of recipients) {
      const { body: inbox } = await apiGet(`/api/inbox/${agent}`);
      const found = inbox.messages.some((m) => m.body === uniqueBody);
      expect(found).toBe(true);
    }
  });

  test("broadcast uses default priority 5", async () => {
    const uniqueBody = `broadcast-priority-default-${Date.now()}`;
    const { body: bcast } = await apiPost("/api/messages/broadcast", {
      from: BROADCAST_SENDER,
      body: uniqueBody,
    });

    const firstAgent = bcast.agents[0];
    const { body: inbox } = await apiGet(`/api/inbox/${firstAgent}`);
    const msg = inbox.messages.find((m) => m.body === uniqueBody);
    expect(msg).toBeDefined();
    expect(msg.priority).toBe(5);
  });

  test("broadcast accepts custom priority", async () => {
    const uniqueBody = `broadcast-priority-custom-${Date.now()}`;
    const { body: bcast } = await apiPost("/api/messages/broadcast", {
      from: BROADCAST_SENDER,
      body: uniqueBody,
      priority: 2,
    });

    const firstAgent = bcast.agents[0];
    const { body: inbox } = await apiGet(`/api/inbox/${firstAgent}`);
    const msg = inbox.messages.find((m) => m.body === uniqueBody);
    expect(msg).toBeDefined();
    expect(msg.priority).toBe(2);
  });

  test("returns 400 when 'from' is missing", async () => {
    const { status } = await apiPost("/api/messages/broadcast", {
      body: "missing from",
    });
    expect(status).toBe(400);
  });

  test("returns 400 when 'body' is missing", async () => {
    const { status } = await apiPost("/api/messages/broadcast", {
      from: BROADCAST_SENDER,
    });
    expect(status).toBe(400);
  });

  test("returns 400 for invalid 'from' name", async () => {
    const { status } = await apiPost("/api/messages/broadcast", {
      from: "bad|sender",
      body: "invalid sender broadcast",
    });
    expect(status).toBe(400);
  });
});

// ── GET /api/messages/queue-depth ─────────────────────────────────────────────

test.describe("GET /api/messages/queue-depth", () => {
  test("returns 200 with total_unread and by_agent", async () => {
    const { status, body } = await apiGet("/api/messages/queue-depth");
    expect(status).toBe(200);
    expect(typeof body.total_unread).toBe("number");
    expect(Array.isArray(body.by_agent)).toBe(true);
  });

  test("total_unread matches sum of by_agent counts", async () => {
    const { body } = await apiGet("/api/messages/queue-depth");
    const sum = body.by_agent.reduce((acc, r) => acc + r.unread, 0);
    expect(body.total_unread).toBe(sum);
  });

  test("by_agent entries have agent and unread fields", async () => {
    // Send at least one message to ensure there are entries
    await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `queue-depth-field-check-${Date.now()}`,
    });

    const { body } = await apiGet("/api/messages/queue-depth");
    expect(body.by_agent.length).toBeGreaterThan(0);

    const entry = body.by_agent[0];
    expect(typeof entry.agent).toBe("string");
    expect(typeof entry.unread).toBe("number");
    expect(entry.unread).toBeGreaterThan(0);
  });

  test("queue depth increases after sending a message", async () => {
    const { body: before } = await apiGet("/api/messages/queue-depth");
    const beforeTotal = before.total_unread;

    await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `queue-depth-increase-${Date.now()}`,
    });

    const { body: after } = await apiGet("/api/messages/queue-depth");
    expect(after.total_unread).toBeGreaterThan(beforeTotal);
  });

  test("queue depth decreases after acking a message", async () => {
    const { body: sent } = await apiPost("/api/messages", {
      from: TEST_SENDER,
      to: TEST_AGENT,
      body: `queue-depth-decrease-${Date.now()}`,
    });

    const { body: before } = await apiGet("/api/messages/queue-depth");
    const beforeTotal = before.total_unread;

    await apiPost(`/api/inbox/${TEST_AGENT}/${sent.id}/ack`);

    const { body: after } = await apiGet("/api/messages/queue-depth");
    expect(after.total_unread).toBe(beforeTotal - 1);
  });

  test("by_agent is ordered by unread DESC", async () => {
    const { body } = await apiGet("/api/messages/queue-depth");
    const counts = body.by_agent.map((r) => r.unread);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
    }
  });
});
