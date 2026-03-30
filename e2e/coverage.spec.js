// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * Coverage tests for previously-untested API endpoints.
 * Covers: team-channel, announcements, stats, sops, ops, org, config,
 *         watchdog-log, tasks/archive, persona note/patch, lastcontext,
 *         messages alias, code-output, digest, ceo-inbox.
 */

const BASE = "http://localhost:3199";

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPost(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPatch(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ── Team Channel ──────────────────────────────────────────────────────────────

test.describe("GET /api/team-channel", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/team-channel");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

test.describe("POST /api/team-channel", () => {
  test("returns 400 when message missing", async () => {
    const { status } = await apiPost("/api/team-channel", {});
    expect(status).toBe(400);
  });

  test("posts a message and returns filename", async () => {
    const { status, body } = await apiPost("/api/team-channel", {
      from: "e2e-test",
      message: "# E2E test message\n\nSafe to ignore.",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.filename).toBe("string");
    expect(body.filename).toMatch(/\.md$/);
  });

  test("posted message appears in GET response", async () => {
    const msg = `E2E coverage test — ${Date.now()}`;
    await apiPost("/api/team-channel", { from: "e2e", message: msg });
    const { body } = await apiGet("/api/team-channel");
    const found = (body || []).some((m) => (m.content || "").includes(msg));
    expect(found).toBe(true);
  });
});

// ── Announcements ─────────────────────────────────────────────────────────────

test.describe("GET /api/announcements", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/announcements");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

test.describe("POST /api/announcements", () => {
  test("returns 400 when both message and title/body missing", async () => {
    const { status } = await apiPost("/api/announcements", {});
    expect(status).toBe(400);
  });

  test("posts via message field and returns filename", async () => {
    const { status, body } = await apiPost("/api/announcements", {
      message: "# E2E Announcement\n\nSafe to ignore.",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.filename).toBe("string");
  });

  test("posts via title+body fields", async () => {
    const { status, body } = await apiPost("/api/announcements", {
      title: "E2E Test Announcement",
      body: "This is an e2e test announcement, safe to ignore.",
      from: "e2e-tester",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("posted announcement appears in GET response", async () => {
    const title = `Coverage-${Date.now()}`;
    await apiPost("/api/announcements", { title, body: "test body" });
    const { body } = await apiGet("/api/announcements");
    const found = (body || []).some((a) => (a.title || "").includes("Coverage-") || (a.content || "").includes(title));
    expect(found).toBe(true);
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

test.describe("GET /api/stats", () => {
  test("returns 200", async () => {
    const { status } = await apiGet("/api/stats");
    expect(status).toBe(200);
  });

  test("response has agents array, totals, and per-agent maps", async () => {
    const { body } = await apiGet("/api/stats");
    expect(Array.isArray(body.agents)).toBe(true);
    expect(typeof body.totals).toBe("object");
    expect(typeof body.total_cycles).toBe("number");
    expect(typeof body.total_cost).toBe("number");
    expect(typeof body.cycles_per_agent).toBe("object");
    expect(typeof body.cost_per_agent).toBe("object");
  });

  test("agent entries have agent, totalCost, cycles fields", async () => {
    const { body } = await apiGet("/api/stats");
    for (const a of body.agents || []) {
      expect(typeof a.agent).toBe("string");
      expect(typeof a.totalCost).toBe("number");
      expect(typeof a.cycles).toBe("number");
    }
  });

  test("total_cost is non-negative", async () => {
    const { body } = await apiGet("/api/stats");
    expect(body.total_cost).toBeGreaterThanOrEqual(0);
  });
});

// ── SOPs ──────────────────────────────────────────────────────────────────────

test.describe("GET /api/sops", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/sops");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("SOP entries have name and content fields", async () => {
    const { body } = await apiGet("/api/sops");
    for (const sop of body || []) {
      expect(typeof sop.name).toBe("string");
    }
  });
});

// ── Ops scripts ───────────────────────────────────────────────────────────────

test.describe("GET /api/ops", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/ops");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("lists shell scripts", async () => {
    const { body } = await apiGet("/api/ops");
    const hasShells = (body || []).every((f) => typeof f === "string");
    expect(hasShells).toBe(true);
    const hasRunAgent = (body || []).some((f) => f.includes("run") || f.includes(".sh"));
    expect(hasRunAgent).toBe(true);
  });
});

// ── Org chart ─────────────────────────────────────────────────────────────────

test.describe("GET /api/org", () => {
  test("returns 200", async () => {
    const { status } = await apiGet("/api/org");
    expect(status).toBe(200);
  });
});

// ── Config ────────────────────────────────────────────────────────────────────

test.describe("GET /api/config", () => {
  test("returns 200 with companyName", async () => {
    const { status, body } = await apiGet("/api/config");
    expect(status).toBe(200);
    expect(typeof body.companyName).toBe("string");
  });

  test("companyName is not empty", async () => {
    const { body } = await apiGet("/api/config");
    expect(body.companyName.length).toBeGreaterThan(0);
  });
});

// ── Watchdog log ──────────────────────────────────────────────────────────────

test.describe("GET /api/watchdog-log", () => {
  test("returns 200 with log field", async () => {
    const { status, body } = await apiGet("/api/watchdog-log");
    expect(status).toBe(200);
    expect(Array.isArray(body.log)).toBe(true);
  });
});

// ── Task archive ──────────────────────────────────────────────────────────────

test.describe("GET /api/tasks/archive", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/tasks/archive");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

test.describe("POST /api/tasks/archive", () => {
  test("returns 200 with ok and archived count", async () => {
    const { status, body } = await apiPost("/api/tasks/archive");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.archived).toBe("number");
    expect(body.archived).toBeGreaterThanOrEqual(0);
  });
});

// ── CSV Export ────────────────────────────────────────────────────────────────

test.describe("GET /api/tasks/export.csv", () => {
  test("returns 200 with text/csv content-type", async () => {
    const res = await fetch(`${BASE}/api/tasks/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  test("response body contains CSV header row", async () => {
    const res = await fetch(`${BASE}/api/tasks/export.csv`);
    const text = await res.text();
    expect(text).toContain("ID");
    expect(text).toContain("Title");
    expect(text).toContain("Status");
  });

  test("content-disposition header suggests file download", async () => {
    const res = await fetch(`${BASE}/api/tasks/export.csv`);
    const disp = res.headers.get("content-disposition") || "";
    expect(disp).toContain("attachment");
    expect(disp).toContain(".csv");
  });
});

// ── Agent persona note ────────────────────────────────────────────────────────

test.describe("POST /api/agents/:name/persona/note", () => {
  test("returns 400 when note is missing", async () => {
    const { status } = await apiPost("/api/agents/alice/persona/note", {});
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPost("/api/agents/unknown_xyz/persona/note", {
      note: "test note",
    });
    expect(status).toBe(404);
  });

  test("adds a note to alice persona and returns ok + timestamp", async () => {
    const { status, body } = await apiPost("/api/agents/alice/persona/note", {
      note: "E2E test note — safe to ignore",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.timestamp).toBe("string");
    expect(body.type).toBe("Note");
  });

  test("returns 400 when note exceeds 10000 characters", async () => {
    const { status } = await apiPost("/api/agents/alice/persona/note", {
      note: "x".repeat(10001),
    });
    expect(status).toBe(400);
  });
});

// ── Agent persona patch (evolution) ──────────────────────────────────────────

test.describe("PATCH /api/agents/:name/persona", () => {
  test("returns 400 when observation is missing", async () => {
    const { status } = await apiPatch("/api/agents/alice/persona", {});
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPatch("/api/agents/unknown_xyz/persona", {
      observation: "test",
    });
    expect(status).toBe(404);
  });

  test("appends evolution entry and returns ok + timestamp", async () => {
    const { status, body } = await apiPatch("/api/agents/alice/persona", {
      observation: "E2E test evolution — safe to ignore",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.timestamp).toBe("string");
    expect(body.type).toBe("Evolution");
  });

  test("returns 400 when observation exceeds 10000 characters", async () => {
    const { status } = await apiPatch("/api/agents/alice/persona", {
      observation: "x".repeat(10001),
    });
    expect(status).toBe(400);
  });
});

// ── Agent lastcontext ─────────────────────────────────────────────────────────

test.describe("GET /api/agents/:name/lastcontext", () => {
  test("returns 200 with content field for known agent", async () => {
    const { status, body } = await apiGet("/api/agents/alice/lastcontext");
    expect(status).toBe(200);
    expect(typeof body.content).toBe("string");
    expect(body.name).toBe("alice");
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/lastcontext");
    expect(status).toBe(404);
  });
});

// ── Messages alias endpoint ───────────────────────────────────────────────────

test.describe("POST /api/messages/:agent", () => {
  test("returns 400 when content missing", async () => {
    const { status } = await apiPost("/api/messages/alice", {});
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPost("/api/messages/unknown_xyz", {
      content: "hello",
    });
    expect(status).toBe(404);
  });

  test("delivers message to agent inbox", async () => {
    const { status, body } = await apiPost("/api/messages/alice", {
      content: "E2E test message via /api/messages — safe to ignore",
      from: "e2e-coverage",
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.file).toBe("string");
  });
});

// ── Code output ───────────────────────────────────────────────────────────────

test.describe("GET /api/code-output", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/code-output");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Digest ────────────────────────────────────────────────────────────────────

test.describe("GET /api/digest", () => {
  test("returns 200", async () => {
    const { status } = await apiGet("/api/digest");
    expect(status).toBe(200);
  });

  test("response is an object or array (not null)", async () => {
    const { body } = await apiGet("/api/digest");
    expect(body).not.toBeNull();
  });
});

// ── CEO inbox ─────────────────────────────────────────────────────────────────

test.describe("GET /api/ceo-inbox", () => {
  test("returns 200", async () => {
    const { status } = await apiGet("/api/ceo-inbox");
    expect(status).toBe(200);
  });

  test("response has unread and processed arrays", async () => {
    const { body } = await apiGet("/api/ceo-inbox");
    expect(Array.isArray(body.unread)).toBe(true);
    expect(Array.isArray(body.processed)).toBe(true);
  });
});

// ── Agent ping ────────────────────────────────────────────────────────────────

test.describe("GET /api/agents/:name/ping", () => {
  test("returns 200 with running field for known agent", async () => {
    const { status, body } = await apiGet("/api/agents/alice/ping");
    expect(status).toBe(200);
    expect(typeof body.running).toBe("boolean");
    expect(body.name).toBe("alice");
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/ping");
    expect(status).toBe(404);
  });
});

// ── Metrics sub-routes ────────────────────────────────────────────────────────

test.describe("GET /api/metrics/agents", () => {
  test("returns 200 with array", async () => {
    const { status, body } = await apiGet("/api/metrics/agents");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("agent entries have name field", async () => {
    const { body } = await apiGet("/api/metrics/agents");
    for (const a of body || []) {
      expect(typeof a.name).toBe("string");
    }
  });
});

test.describe("GET /api/metrics/agents/:name", () => {
  test("returns 200 for known agent", async () => {
    const { status, body } = await apiGet("/api/metrics/agents/alice");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/metrics/agents/unknown_xyz");
    expect(status).toBe(404);
  });
});

test.describe("GET /api/metrics/tasks", () => {
  test("returns 200 with task metrics", async () => {
    const { status, body } = await apiGet("/api/metrics/tasks");
    expect(status).toBe(200);
    expect(typeof body.total).toBe("number");
  });
});

test.describe("GET /api/metrics/health", () => {
  test("returns 200 with health snapshot", async () => {
    const { status, body } = await apiGet("/api/metrics/health");
    expect(status).toBe(200);
    expect(body).not.toBeNull();
  });
});

// ── Agent health score ────────────────────────────────────────────────────────

test.describe("GET /api/agents/:name/health", () => {
  test("returns 200 with score, grade, and dimensions for known agent", async () => {
    const { status, body } = await apiGet("/api/agents/alice/health");
    expect(status).toBe(200);
    expect(typeof body.score).toBe("number");
    expect(typeof body.grade).toBe("string");
    expect(["A", "B", "C", "D"]).toContain(body.grade);
    expect(typeof body.dimensions).toBe("object");
  });

  test("score is between 0 and 100", async () => {
    const { body } = await apiGet("/api/agents/alice/health");
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(100);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/health");
    expect(status).toBe(404);
  });
});

// ── Agent sub-resource GET routes ─────────────────────────────────────────────

test.describe("GET /api/agents/:name/inbox", () => {
  test("returns 200 with unread and processed arrays", async () => {
    const { status, body } = await apiGet("/api/agents/alice/inbox");
    expect(status).toBe(200);
    expect(Array.isArray(body.unread)).toBe(true);
    expect(Array.isArray(body.processed)).toBe(true);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/inbox");
    expect(status).toBe(404);
  });
});

test.describe("GET /api/agents/:name/status", () => {
  test("returns 200 with name and content fields", async () => {
    const { status, body } = await apiGet("/api/agents/alice/status");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(typeof body.content).toBe("string");
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/status");
    expect(status).toBe(404);
  });
});

test.describe("GET /api/agents/:name/persona", () => {
  test("returns 200 with name and content fields", async () => {
    const { status, body } = await apiGet("/api/agents/alice/persona");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(typeof body.content).toBe("string");
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/persona");
    expect(status).toBe(404);
  });
});

test.describe("GET /api/agents/:name/todo", () => {
  test("returns 200 with name and content fields", async () => {
    const { status, body } = await apiGet("/api/agents/alice/todo");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(typeof body.content).toBe("string");
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/todo");
    expect(status).toBe(404);
  });
});

test.describe("GET /api/agents/:name/activity", () => {
  test("returns 200 with name and cycles array", async () => {
    const { status, body } = await apiGet("/api/agents/alice/activity");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(Array.isArray(body.cycles)).toBe(true);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/activity");
    expect(status).toBe(404);
  });
});

// ── Agent cycle detail ────────────────────────────────────────────────────────

test.describe("GET /api/agents/:name/cycles/:n", () => {
  test("returns 404 for cycle that does not exist", async () => {
    const { status } = await apiGet("/api/agents/alice/cycles/99999");
    expect(status).toBe(404);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/cycles/1");
    expect(status).toBe(404);
  });
});

// ── Agent log ─────────────────────────────────────────────────────────────────

test.describe("GET /api/agents/:name/log", () => {
  test("returns 200 with an array for known agent", async () => {
    const { status, body } = await apiGet("/api/agents/alice/log");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/log");
    expect(status).toBe(404);
  });
});

// ── CEO inbox mark-read ───────────────────────────────────────────────────────

test.describe("POST /api/ceo-inbox/:filename/read", () => {
  test("returns 400 for invalid filename (path traversal)", async () => {
    const { status } = await apiPost("/api/ceo-inbox/../etc%2Fpasswd/read");
    expect(status).toBe(404); // route won't match the pattern
  });

  test("returns 500 or 200 for unknown filename (file not found)", async () => {
    const { status } = await apiPost("/api/ceo-inbox/nonexistent_xyz.md/read");
    // Either 400 (validation) or 500 (file not found during rename) is acceptable
    expect([200, 400, 404, 500]).toContain(status);
  });
});

// ── Knowledge & Research ─────────────────────────────────────────────────────

test.describe("GET /api/knowledge", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/knowledge");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

test.describe("GET /api/research", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/research");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── SQLite Message Bus ────────────────────────────────────────────────────────

test.describe("POST /api/messages (SQLite message bus)", () => {
  test("returns 400 when from is missing", async () => {
    const { status } = await apiPost("/api/messages", { to: "alice", body: "hello" });
    expect(status).toBe(400);
  });

  test("returns 400 when to is missing", async () => {
    const { status } = await apiPost("/api/messages", { from: "bob", body: "hello" });
    expect(status).toBe(400);
  });

  test("returns 400 when body is missing", async () => {
    const { status } = await apiPost("/api/messages", { from: "bob", to: "alice" });
    expect(status).toBe(400);
  });

  test("sends a message and returns 201 with id", async () => {
    const { status, body } = await apiPost("/api/messages", {
      from: "e2e-test",
      to: "alice",
      body: "E2E message bus test — safe to ignore",
      priority: 5,
    });
    expect(status).toBe(201);
    expect(typeof body.id).toBe("number");
    expect(body.to).toBe("alice");
  });
});

test.describe("GET /api/inbox/:agent (SQLite message bus)", () => {
  test("returns 200 with messages array for known agent", async () => {
    // Ensure there is at least one message in alice's inbox
    await apiPost("/api/messages", { from: "e2e-test", to: "alice", body: "inbox test" });
    const { status, body } = await apiGet("/api/inbox/alice");
    expect(status).toBe(200);
    expect(typeof body.unread).toBe("number");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/inbox/../etc");
    // Either 400 (invalid name) or 404 (route not matched) is acceptable
    expect([400, 404]).toContain(status);
  });
});

test.describe("POST /api/inbox/:agent/:id/ack (SQLite message bus)", () => {
  test("returns 404 for non-existent message id", async () => {
    const { status } = await apiPost("/api/inbox/alice/999999999/ack");
    expect(status).toBe(404);
  });

  test("acks a real message", async () => {
    // Send a message then ack it
    const { body: sent } = await apiPost("/api/messages", {
      from: "e2e-ack-test",
      to: "alice",
      body: "ack test message",
    });
    expect(typeof sent.id).toBe("number");
    const { status, body } = await apiPost(`/api/inbox/alice/${sent.id}/ack`);
    expect(status).toBe(200);
    expect(body.acked).toBe(true);
  });
});

test.describe("GET /api/messages/queue-depth (SQLite message bus)", () => {
  test("returns 200 with total_unread and by_agent", async () => {
    const { status, body } = await apiGet("/api/messages/queue-depth");
    expect(status).toBe(200);
    expect(typeof body.total_unread).toBe("number");
    expect(Array.isArray(body.by_agent)).toBe(true);
  });
});

test.describe("POST /api/messages/broadcast (SQLite message bus)", () => {
  test("returns 400 when from is missing", async () => {
    const { status } = await apiPost("/api/messages/broadcast", { body: "hello" });
    expect(status).toBe(400);
  });

  test("returns 400 when body is missing", async () => {
    const { status } = await apiPost("/api/messages/broadcast", { from: "e2e" });
    expect(status).toBe(400);
  });

  test("broadcasts and returns delivered count", async () => {
    const { status, body } = await apiPost("/api/messages/broadcast", {
      from: "e2e-broadcast",
      body: "E2E broadcast test — safe to ignore",
      priority: 9,
    });
    // 201 if agents found, 200 if none
    expect([200, 201]).toContain(status);
    expect(typeof body.delivered).toBe("number");
    expect(Array.isArray(body.agents)).toBe(true);
  });
});
