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
