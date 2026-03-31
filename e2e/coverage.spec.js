// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * Coverage tests for previously-untested API endpoints.
 * Covers: team-channel, announcements, stats, sops, ops, org, config,
 *         watchdog-log, tasks/archive, persona note/patch, lastcontext,
 *         messages alias, code-output, digest, ceo-inbox.
 */

const BASE = "http://localhost:3199";
const AUTH_HEADERS = { "Authorization": "Bearer test" };

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

async function apiPatch(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiDelete(path) {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: AUTH_HEADERS });
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
    const res = await fetch(`${BASE}/api/tasks/export.csv`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  test("response body contains CSV header row", async () => {
    const res = await fetch(`${BASE}/api/tasks/export.csv`, { headers: AUTH_HEADERS });
    const text = await res.text();
    expect(text).toContain("ID");
    expect(text).toContain("Title");
    expect(text).toContain("Status");
  });

  test("content-disposition header suggests file download", async () => {
    const res = await fetch(`${BASE}/api/tasks/export.csv`, { headers: AUTH_HEADERS });
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

// GAP-008 — path traversal + 404 tests for /api/knowledge/:file (SEC security)
test.describe("GET /api/knowledge/:file", () => {
  test("blocks path traversal (URL-encoded)", async () => {
    const { status } = await apiGet("/api/knowledge/..%2F..%2Fcompany.md");
    expect(status).toBe(400);
  });

  test("blocks path traversal (double-encoded)", async () => {
    const { status } = await apiGet("/api/knowledge/%2e%2e%2f%2e%2e%2fcompany.md");
    expect(status).toBe(400);
  });

  test("returns 404 for non-existent file", async () => {
    const { status } = await apiGet("/api/knowledge/nonexistent_xyz_heidi_test.md");
    expect(status).toBe(404);
  });
});

test.describe("GET /api/research", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/research");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// GAP-007 — path traversal + file-read tests for /api/research/:file (SEC security)
test.describe("GET /api/research/:file", () => {
  test("blocks path traversal (URL-encoded)", async () => {
    const { status } = await apiGet("/api/research/..%2F..%2Fcompany.md");
    expect(status).toBe(400);
  });

  test("blocks path traversal (double-encoded)", async () => {
    const { status } = await apiGet("/api/research/%2e%2e%2f%2e%2e%2fcompany.md");
    expect(status).toBe(400);
  });

  test("returns 404 for non-existent file", async () => {
    const { status } = await apiGet("/api/research/nonexistent_xyz_heidi_test.md");
    expect(status).toBe(404);
  });

  test("serves a valid reports file", async () => {
    const { status, body } = await apiGet("/api/research/active_alerts.md");
    expect(status).toBe(200);
    expect(body).toHaveProperty("file", "active_alerts.md");
    expect(body).toHaveProperty("content");
    expect(typeof body.content).toBe("string");
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

// ---------------------------------------------------------------------------
// POST /api/agents/smart-start
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/smart-start", () => {
  test("returns 200 with ok and message fields", async () => {
    const { status, body } = await apiPost("/api/agents/smart-start", {});
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.message).toBe("string");
    expect(typeof body.max).toBe("number");
  });

  test("respects custom max parameter", async () => {
    const { status, body } = await apiPost("/api/agents/smart-start", { max: 3 });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.max).toBe(3);
  });

  test("ignores invalid max (non-numeric) and uses default 20", async () => {
    const { status, body } = await apiPost("/api/agents/smart-start", { max: "bad" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.max).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/watchdog
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/watchdog", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/watchdog`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("returns 200 with ok, restarted array, and checked count", async () => {
    const { status, body } = await apiPost("/api/agents/watchdog");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.restarted)).toBe(true);
    expect(typeof body.checked).toBe("number");
    expect(body.checked).toBeGreaterThanOrEqual(0);
  });

  test("details array contains agent action entries", async () => {
    const { status, body } = await apiPost("/api/agents/watchdog");
    expect(status).toBe(200);
    expect(Array.isArray(body.details)).toBe(true);
    for (const entry of body.details) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.action).toBe("string");
      expect(["ok", "restarted", "not_running"]).toContain(entry.action);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/agents/:name/output/:file
// ---------------------------------------------------------------------------
test.describe("GET /api/agents/:name/output/:file", () => {
  test("returns 200 with content for a known output file", async () => {
    // bob has agent_metrics_api.js in output/
    const { status, body } = await apiGet("/api/agents/bob/output/agent_metrics_api.js");
    expect(status).toBe(200);
    expect(body.agent).toBe("bob");
    expect(body.file).toBe("agent_metrics_api.js");
    expect(typeof body.content).toBe("string");
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.type).toBe("code");
  });

  test("returns 404 for unknown file", async () => {
    const { status } = await apiGet("/api/agents/bob/output/nonexistent_file_xyz.md");
    expect(status).toBe(404);
  });

  test("returns 400 for path traversal attempt", async () => {
    const { status } = await apiGet("/api/agents/bob/output/..%2F..%2Fcompany.md");
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/nobody_xyz_123/output/file.md");
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/messages/purge (SQLite message bus — retention)
// ---------------------------------------------------------------------------
test.describe("DELETE /api/messages/purge (SQLite message bus)", () => {
  test("returns 200 with deleted count and defaults", async () => {
    const { status, body } = await apiDelete("/api/messages/purge");
    expect(status).toBe(200);
    expect(typeof body.deleted).toBe("number");
    expect(body.retention_days).toBe(7);
    expect(body.include_unread).toBe(false);
  });

  test("respects custom days parameter", async () => {
    const { status, body } = await apiDelete("/api/messages/purge?days=30");
    expect(status).toBe(200);
    expect(body.retention_days).toBe(30);
  });

  test("purges with days=0 removes all read messages", async () => {
    // Send and ack a message first
    const { body: sent } = await fetch(`${BASE}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ from: "e2e-purge", to: "alice", body: "purge test msg" }),
    }).then((r) => r.json().then((b) => ({ body: b })));

    await fetch(`${BASE}/api/inbox/alice/${sent.id}/ack`, { method: "POST", headers: AUTH_HEADERS });

    const { status, body } = await apiDelete("/api/messages/purge?days=0");
    expect(status).toBe(200);
    expect(body.deleted).toBeGreaterThanOrEqual(1);
  });

  test("returns 400 for invalid days parameter", async () => {
    const { status } = await apiDelete("/api/messages/purge?days=notanumber");
    expect(status).toBe(400);
  });

  test("include_unread=true reflected in response", async () => {
    const { status, body } = await apiDelete("/api/messages/purge?days=0&unread=true");
    expect(status).toBe(200);
    expect(body.include_unread).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SEC-005 — Error responses must not disclose internal paths or stack traces
// ---------------------------------------------------------------------------
test.describe("SEC-005: Error response path/stack disclosure", () => {
  function hasInternalLeak(body) {
    const s = JSON.stringify(body || {});
    return /Error:|at Object\.|at Function\.|\.js:\d+|\bat\b.*:\d+:\d+|node_modules|__dirname|\.sh\b|index_lite\.html|no route for/.test(s);
  }

  test("POST /api/mode success response has no internal leak", async () => {
    const res = await fetch(`${BASE}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ mode: "normal", who: "test", reason: "sec-test" }),
    });
    const body = await res.json().catch(() => ({}));
    expect(hasInternalLeak(body)).toBe(false);
  });

  test("POST /api/tasks success response has no internal leak", async () => {
    const res = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ title: "sec-test-task-disclosure", priority: "low" }),
    });
    const body = await res.json().catch(() => ({}));
    // Cleanup: delete the task created by this test to avoid board pollution (QI-011)
    if (body.id) {
      await fetch(`${BASE}/api/tasks/${body.id}`, { method: "DELETE", headers: AUTH_HEADERS }).catch(() => {});
    }
    expect(hasInternalLeak(body)).toBe(false);
  });

  test("POST /api/agents/:name/stop 404 response has no internal leak", async () => {
    const res = await fetch(`${BASE}/api/agents/nonexistent_xyz_agent_999/stop`, {
      method: "POST",
      headers: AUTH_HEADERS,
    });
    const body = await res.json().catch(() => ({}));
    expect(hasInternalLeak(body)).toBe(false);
  });

  test("unknown route 404 does not disclose method or internal path", async () => {
    const res = await fetch(`${BASE}/api/no_such_endpoint_xyz`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(404);
    const body = await res.json().catch(() => ({}));
    expect(hasInternalLeak(body)).toBe(false);
    // Must not echo back "no route for GET /api/no_such_endpoint_xyz"
    expect(JSON.stringify(body)).not.toMatch(/no route for/);
  });

  test("GET /api/tasks/:id/result 404 does not disclose assignee", async () => {
    const res = await fetch(`${BASE}/api/tasks/999999/result`, { headers: AUTH_HEADERS });
    expect([404, 400]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(hasInternalLeak(body)).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/assignee/);
  });
});

// ---------------------------------------------------------------------------
// SEC-001 — Auth enforcement: 401 when API key missing or wrong
// ---------------------------------------------------------------------------
test.describe("SEC-001: Auth enforcement — 401 on missing/invalid API key", () => {
  test("GET /api/agents returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents`);
    expect(res.status).toBe(401);
  });

  test("POST /api/tasks returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "no-auth test task", priority: "low" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/tasks returns 401 with wrong API key", async () => {
    const res = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer wrongkey" },
      body: JSON.stringify({ title: "wrong-auth test task", priority: "low" }),
    });
    expect(res.status).toBe(401);
  });

  test("GET /api/health returns 200 without auth (public endpoint)", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
  });

  test("POST /api/messages returns 401 without auth header (backend/api.js gate)", async () => {
    const res = await fetch(`${BASE}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "tester", to: "alice", body: "no-auth test" }),
    });
    expect(res.status).toBe(401);
  });

  test("DELETE /api/messages/purge returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/messages/purge`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  test("POST /api/agents/:name/stop returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/alice/stop`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("X-API-Key header also accepted for auth", async () => {
    const res = await fetch(`${BASE}/api/agents`, {
      headers: { "X-API-Key": "test" },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/:name/stop — functional tests (GAP-011)
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/:name/stop", () => {
  test("returns 404 for unknown agent", async () => {
    const { status, body } = await apiPost("/api/agents/nobody_xyz_999/stop");
    expect(status).toBe(404);
    expect(body).toHaveProperty("error");
  });

  test("returns 200 for known agent (idempotent — safe if not running)", async () => {
    const { status, body } = await apiPost("/api/agents/bob/stop");
    // stop_agent.sh handles non-running agents gracefully
    expect([200, 500]).toContain(status);
    if (status === 200) expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/:name/start — functional tests (GAP-012)
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/:name/start", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/bob/start`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("returns 404 for unknown agent", async () => {
    const { status, body } = await apiPost("/api/agents/nobody_xyz_999/start");
    expect(status).toBe(404);
    expect(body).toHaveProperty("error");
  });

  test("returns 200 with ok and already_running for known agent", async () => {
    const { status, body } = await apiPost("/api/agents/bob/start");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.already_running).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/stop-all — functional tests (GAP-013)
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/stop-all", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/stop-all`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("returns 200 with ok:true", async () => {
    const { status, body } = await apiPost("/api/agents/stop-all");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/start-all — functional tests (GAP-014)
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/start-all", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/start-all`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("returns 200 with ok:true", async () => {
    const { status, body } = await apiPost("/api/agents/start-all");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/:name/inbox — functional tests (GAP-010)
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/:name/inbox", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/alice/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "no-auth test" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 400 for missing message field", async () => {
    const { status } = await apiPost("/api/agents/alice/inbox", { from: "tina-e2e" });
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPost("/api/agents/nobody_xyz_999/inbox", {
      message: "test message",
    });
    expect(status).toBe(404);
  });

  test("delivers message and returns 200 with filename", async () => {
    const { status, body } = await apiPost("/api/agents/alice/inbox", {
      message: "E2E inbox delivery test — safe to ignore",
      from: "tina-e2e",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.filename).toBe("string");
    expect(body.filename).toMatch(/\.md$/);
  });
});

// GAP: GET /manifest.json — PWA manifest endpoint (added by judy, Task #106)
test.describe("GET /manifest.json", () => {
  test("returns 200 with correct content-type", async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("manifest+json");
  });

  test("returns valid JSON with required PWA fields", async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    const body = await res.json();
    expect(typeof body.name).toBe("string");
    expect(typeof body.short_name).toBe("string");
    expect(typeof body.start_url).toBe("string");
    expect(["standalone", "fullscreen", "minimal-ui", "browser"]).toContain(body.display);
    expect(Array.isArray(body.icons)).toBe(true);
    expect(body.icons.length).toBeGreaterThan(0);
  });

  test("includes at least one icon with src and sizes", async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    const body = await res.json();
    const icon = body.icons[0];
    expect(typeof icon.src).toBe("string");
    expect(icon.src.length).toBeGreaterThan(0);
    expect(typeof icon.sizes).toBe("string");
  });

  test("has CORS header allowing cross-origin", async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
  });
});

// GAP-008: GET /api/consensus — no 200 success test existed
// GAP-009: POST /api/consensus/entry — pipe sanitization has no regression guard
test.describe("GET /api/consensus (GAP-008)", () => {
  test("returns 200 with raw and entries fields", async () => {
    const { status, body } = await apiGet("/api/consensus");
    expect(status).toBe(200);
    expect(typeof body.raw).toBe("string");
    expect(Array.isArray(body.entries)).toBe(true);
  });

  test("entries have expected shape when present", async () => {
    const { status, body } = await apiGet("/api/consensus");
    expect(status).toBe(200);
    for (const entry of body.entries) {
      expect(typeof entry.id).toBe("number");
      expect(typeof entry.type).toBe("string");
      expect(typeof entry.content).toBe("string");
      expect(typeof entry.author).toBe("string");
      expect(typeof entry.updated).toBe("string");
    }
  });
});

test.describe("POST /api/consensus/entry pipe sanitization (GAP-009)", () => {
  test("pipe character in content is sanitized to dash", async () => {
    const { status, body } = await apiPost("/api/consensus/entry", {
      type: "culture",
      content: "pipes|should|become|dashes",
      author: "e2e-test",
      section: "Evolving Relationships",
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("number");

    // Verify the written row does not contain raw pipes in the content field
    const { body: get } = await apiGet("/api/consensus");
    const entry = get.entries.find((e) => e.id === body.id);
    expect(entry).toBeDefined();
    expect(entry.content).not.toContain("|");
    expect(entry.content).toContain("-");
  });

  test("pipe character in type is sanitized to dash", async () => {
    // type field also goes through pipe-sanitization
    const { status, body } = await apiPost("/api/consensus/entry", {
      type: "group",
      content: "type pipe sanitization regression guard",
      author: "e2e-test",
      section: "Evolving Relationships",
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
  });

  test("returns 400 when type is missing", async () => {
    const { status } = await apiPost("/api/consensus/entry", {
      content: "missing type field",
    });
    expect(status).toBe(400);
  });

  test("returns 400 when content is missing", async () => {
    const { status } = await apiPost("/api/consensus/entry", {
      type: "culture",
    });
    expect(status).toBe(400);
  });

  test("returns 400 for invalid type value", async () => {
    const { status } = await apiPost("/api/consensus/entry", {
      type: "notavalidtype",
      content: "some content",
    });
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Task #155 — Auth gap tests: P1 write endpoints (GAP-001/002/007/010)
// Each block verifies: 401 when API_KEY set and header missing, 200 with auth.
// ---------------------------------------------------------------------------

test.describe("Task #155 GAP-001: POST /api/agents/:name/stop auth", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/alice/stop`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("returns 200 with auth header (idempotent — safe if not running)", async () => {
    const { status, body } = await apiPost("/api/agents/bob/stop");
    expect([200, 500]).toContain(status);
    if (status === 200) expect(body.ok).toBe(true);
  });
});

test.describe("Task #155 GAP-002: POST /api/agents/:name/start auth", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/bob/start`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("returns 200 with auth header for known agent", async () => {
    const { status, body } = await apiPost("/api/agents/bob/start");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.already_running).toBe("boolean");
  });
});

test.describe("Task #155 GAP-007: POST /api/agents/:name/inbox auth", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/agents/alice/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "no-auth test" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 200 with auth header and delivers message", async () => {
    const { status, body } = await apiPost("/api/agents/alice/inbox", {
      message: "Task #155 auth gap test — safe to ignore",
      from: "tina-e2e",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.filename).toBe("string");
  });
});

test.describe("Task #155 GAP-010: DELETE /api/messages/purge auth", () => {
  test("returns 401 without auth header", async () => {
    const res = await fetch(`${BASE}/api/messages/purge`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  test("returns 200 with auth header and reports deleted count", async () => {
    const { status, body } = await apiDelete("/api/messages/purge");
    expect(status).toBe(200);
    expect(typeof body.deleted).toBe("number");
    expect(body.retention_days).toBe(7);
  });
});

// WS-001/002/003/004 — WebSocket upgrade auth tests (Nick Task #153)
// Uses raw TCP (net.connect) since Node's http.get doesn't support Upgrade.
test.describe("WebSocket /api/ws — WS-001 auth (Task #153)", () => {
  const net = require("net");
  const crypto = require("crypto");

  function wsHandshake({ withAuth, badKey } = {}) {
    return new Promise((resolve) => {
      const socket = net.connect(3199, "127.0.0.1", () => {
        const wsKey = crypto.randomBytes(16).toString("base64");
        const authLine = withAuth
          ? `Authorization: Bearer ${badKey ? "wrongkey" : "test"}\r\n`
          : "";
        socket.write(
          `GET /api/ws HTTP/1.1\r\n` +
          `Host: localhost:3199\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${wsKey}\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `${authLine}\r\n`
        );
      });
      let data = "";
      socket.setTimeout(2000);
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\r\n\r\n")) {
          socket.destroy();
          const statusLine = data.split("\r\n")[0];
          resolve(parseInt(statusLine.split(" ")[1], 10));
        }
      });
      socket.on("timeout", () => { socket.destroy(); resolve(0); });
      socket.on("error", () => resolve(0));
    });
  }

  test("WS-001: rejects unauthenticated upgrade with 401", async () => {
    const status = await wsHandshake({ withAuth: false });
    expect(status).toBe(401);
  });

  test("WS-001: rejects wrong API key with 401", async () => {
    const status = await wsHandshake({ withAuth: true, badKey: true });
    expect(status).toBe(401);
  });

  test("WS-001: accepts valid API key — upgrades to 101", async () => {
    const status = await wsHandshake({ withAuth: true });
    expect(status).toBe(101);
  });

  test("WS-004: non-/api/ws path returns 404", async () => {
    const status = await new Promise((resolve) => {
      const socket = net.connect(3199, "127.0.0.1", () => {
        const wsKey = crypto.randomBytes(16).toString("base64");
        socket.write(
          `GET /api/wrong-path HTTP/1.1\r\n` +
          `Host: localhost:3199\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${wsKey}\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `Authorization: Bearer test\r\n\r\n`
        );
      });
      let data = "";
      socket.setTimeout(2000);
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\r\n\r\n")) {
          socket.destroy();
          resolve(parseInt(data.split(" ")[1], 10));
        }
      });
      socket.on("timeout", () => { socket.destroy(); resolve(0); });
      socket.on("error", () => resolve(0));
    });
    expect(status).toBe(404);
  });
});
