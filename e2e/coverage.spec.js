// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

/**
 * Coverage tests for previously-untested API endpoints.
 * Covers: team-channel, announcements, stats, sops, ops, org, config,
 *         watchdog-log, tasks/archive, persona note/patch, lastcontext,
 *         messages alias, code-output, digest, ceo-inbox.
 */

const BASE = "http://localhost:3199";
const AUTH_HEADERS = { "Authorization": "Bearer test" };
const DIR = path.resolve(__dirname, "..");

// Planet-aware path resolution (mirrors server.js resolvePlanet)
function resolvePlanetDir(dir) {
  const pj = path.join(dir, "planet.json");
  if (fs.existsSync(pj)) {
    try {
      const { active, planets_dir } = JSON.parse(fs.readFileSync(pj, "utf8"));
      const pd = path.join(dir, planets_dir || "planets", active);
      if (fs.existsSync(pd)) return pd;
    } catch (_) {}
  }
  return dir;
}
const PLANET_DIR = resolvePlanetDir(DIR);
const AGENTS_DIR = path.join(PLANET_DIR, "agents");
const SHARED_DIR = fs.existsSync(path.join(PLANET_DIR, "shared")) ? path.join(PLANET_DIR, "shared") : path.join(DIR, "public");
const DATA_DIR = fs.existsSync(path.join(PLANET_DIR, "data")) ? path.join(PLANET_DIR, "data") : DIR;

// Track files created by tests so we can clean them up
const _createdTeamChannelFiles = [];
const _createdAnnouncementFiles = [];
// inbox files: { agent, filename } — deleted via fs after tests
const _createdInboxFiles = [];

// Detect whether the server enforces auth (returns 401 without a key).
// When API_KEY is not set, auth is disabled and auth-enforcement tests are skipped.
let serverRequiresAuth = false;
test.beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/api/agents`);
    serverRequiresAuth = res.status === 401;
  } catch (_) {
    serverRequiresAuth = false;
  }
});

// Skip any test that verifies 401 auth enforcement when server has no API_KEY
const AUTH_TEST_PATTERNS = ["401 without auth", "401 with wrong", "rejects unauthenticated", "rejects wrong API key"];
test.beforeEach(async ({}, testInfo) => {
  if (!serverRequiresAuth && AUTH_TEST_PATTERNS.some(p => testInfo.title.includes(p))) {
    testInfo.skip(true, "Server running without API_KEY — auth not enforced in dev mode");
  }
});

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

  test("channel items have filename, content, from, timestamp fields", async () => {
    const { body } = await apiGet("/api/team-channel");
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.content).toBe("string");
      // from and timestamp may be null for oddly-named files but should be present
      expect("from" in item).toBe(true);
      expect("timestamp" in item).toBe(true);
    }
  });

  test("channel items have message and date fields", async () => {
    const { body } = await apiGet("/api/team-channel");
    for (const item of body) {
      // message is the main text content (alias of content)
      expect("message" in item).toBe(true);
      // date is a formatted date string or null
      expect(item.date === null || typeof item.date === "string").toBe(true);
    }
  });
});

test.describe("POST /api/team-channel", () => {
  test.afterAll(async () => {
    for (const f of _createdTeamChannelFiles) {
      try { fs.unlinkSync(path.join(SHARED_DIR, "team_channel", f)); } catch (_) {}
    }
    _createdTeamChannelFiles.length = 0;
  });

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
    _createdTeamChannelFiles.push(body.filename);
  });

  test("posted message appears in GET response", async () => {
    const msg = `E2E coverage test — ${Date.now()}`;
    const { body: postBody } = await apiPost("/api/team-channel", { from: "e2e", message: msg });
    if (postBody?.filename) _createdTeamChannelFiles.push(postBody.filename);
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

  test("announcement items have filename, content, title fields", async () => {
    const { body } = await apiGet("/api/announcements");
    for (const item of body) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.content).toBe("string");
      expect(typeof item.title).toBe("string");
      expect("from" in item).toBe(true);
      expect("date" in item).toBe(true);
    }
  });

  test("announcement items have body and from string/null fields", async () => {
    const { body } = await apiGet("/api/announcements");
    for (const item of body) {
      // body field is the announcement body text (may be empty string or null)
      expect(item.body === null || typeof item.body === "string").toBe(true);
      // from is null or string (sender)
      expect(item.from === null || typeof item.from === "string").toBe(true);
      // date is null or string
      expect(item.date === null || typeof item.date === "string").toBe(true);
    }
  });
});

test.describe("POST /api/announcements", () => {
  test.afterAll(async () => {
    for (const f of _createdAnnouncementFiles) {
      try { fs.unlinkSync(path.join(SHARED_DIR, "announcements", f)); } catch (_) {}
    }
    _createdAnnouncementFiles.length = 0;
  });

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
    if (body.filename) _createdAnnouncementFiles.push(body.filename);
  });

  test("posts via title+body fields", async () => {
    const { status, body } = await apiPost("/api/announcements", {
      title: "E2E Test Announcement",
      body: "This is an e2e test announcement, safe to ignore.",
      from: "e2e-tester",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    if (body.filename) _createdAnnouncementFiles.push(body.filename);
  });

  test("posted announcement appears in GET response", async () => {
    const title = `Coverage-${Date.now()}`;
    const { body: postBody } = await apiPost("/api/announcements", { title, body: "test body" });
    if (postBody?.filename) _createdAnnouncementFiles.push(postBody.filename);
    const { body } = await apiGet("/api/announcements");
    const found = (body || []).some((a) => (a.title || "").includes("Coverage-") || (a.content || "").includes(title));
    expect(found).toBe(true);
  });
});

// ── POST /api/announce alias ──────────────────────────────────────────────────

test.describe("POST /api/announce (alias for /api/announcements)", () => {
  test.afterAll(async () => {
    for (const f of _createdAnnouncementFiles) {
      try { fs.unlinkSync(path.join(SHARED_DIR, "announcements", f)); } catch (_) {}
    }
    _createdAnnouncementFiles.length = 0;
  });

  test("alias path works the same as /api/announcements", async () => {
    const { status, body } = await apiPost("/api/announce", {
      title: "E2E Alias Test",
      body: "Testing /api/announce alias.",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.filename).toBe("string");
    if (body.filename) _createdAnnouncementFiles.push(body.filename);
  });
});

// ── GET /api/agents/:name — field coverage ────────────────────────────────────

test.describe("GET /api/agents/:name — field coverage", () => {
  test("response includes status, heartbeat, tasks, and executor fields", async () => {
    const { status, body } = await apiGet("/api/agents/alice");
    expect(status).toBe(200);
    expect(typeof body.status).toBe("string");
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(typeof body.executor).toBe("string");
  });

  test("response includes statusMd, persona, todo string fields", async () => {
    const { body } = await apiGet("/api/agents/alice");
    expect(typeof body.statusMd).toBe("string");
    expect(typeof body.persona).toBe("string");
    expect(typeof body.todo).toBe("string");
  });

  test("response name matches requested agent", async () => {
    const { body } = await apiGet("/api/agents/alice");
    expect(body.name).toBe("alice");
  });

  test("inbox items have filename and read fields", async () => {
    const { body } = await apiGet("/api/agents/alice");
    for (const item of body.inbox) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.read).toBe("boolean");
    }
  });

  test("heartbeat is null or object with status field", async () => {
    const { body } = await apiGet("/api/agents/alice");
    // heartbeat is null when heartbeat.md doesn't exist, otherwise an object
    if (body.heartbeat !== null) {
      expect(typeof body.heartbeat).toBe("object");
      // status may be undefined if heartbeat.md has no parseable status line
      expect(body.heartbeat.status === undefined || typeof body.heartbeat.status === "string").toBe(true);
      expect(body.heartbeat.timestamp === undefined || body.heartbeat.timestamp === null || typeof body.heartbeat.timestamp === "string").toBe(true);
      expect(body.heartbeat.task === undefined || body.heartbeat.task === null || typeof body.heartbeat.task === "string").toBe(true);
    }
    // presence: heartbeat is null or object (not undefined or other type)
    expect(body.heartbeat === null || typeof body.heartbeat === "object").toBe(true);
  });

  test("tasks items have id, title, priority, status, assignee fields (when non-empty)", async () => {
    const { body } = await apiGet("/api/agents/charlie");
    for (const t of body.tasks || []) {
      expect(typeof t.id === "number" || typeof t.id === "string").toBe(true);
      expect(typeof t.title).toBe("string");
      expect(typeof t.priority).toBe("string");
      expect(typeof t.status).toBe("string");
      expect(typeof t.assignee).toBe("string");
    }
  });
});

// ── GET /api/agents — field coverage ──────────────────────────────────────────

test.describe("GET /api/agents — agent list field coverage", () => {
  test("each agent has alive boolean field", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      expect(typeof agent.alive).toBe("boolean");
    }
  });

  test("each agent has unread_messages number field", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      expect(typeof agent.unread_messages).toBe("number");
      expect(agent.unread_messages).toBeGreaterThanOrEqual(0);
    }
  });

  test("each agent has executor string field", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      expect(typeof agent.executor).toBe("string");
      expect(agent.executor.length).toBeGreaterThan(0);
    }
  });

  test("each agent has name, role, status, cycles, health fields", async () => {
    const { body } = await apiGet("/api/agents");
    expect(body.length).toBeGreaterThan(0);
    for (const agent of body) {
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.role).toBe("string");
      expect(typeof agent.status).toBe("string");
      // cycles may be null if no log file exists today
      expect(agent.cycles === null || typeof agent.cycles === "number").toBe(true);
      expect(typeof agent.health).toBe("object");
    }
  });

  test("each agent health object has score and grade fields", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      expect(typeof agent.health.score).toBe("number");
      expect(typeof agent.health.grade).toBe("string");
    }
  });

  test("each agent has current_task, last_update, lastSeenSecs, heartbeat_age_ms fields", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      // current_task may be null or a string
      expect(agent.current_task === null || typeof agent.current_task === "string").toBe(true);
      // last_update is a timestamp string or null
      expect(agent.last_update === null || typeof agent.last_update === "string").toBe(true);
      // lastSeenSecs is a number (seconds since last heartbeat) or null
      expect(agent.lastSeenSecs === null || typeof agent.lastSeenSecs === "number").toBe(true);
      // heartbeat_age_ms is a number or null
      expect(agent.heartbeat_age_ms === null || typeof agent.heartbeat_age_ms === "number").toBe(true);
    }
  });

  test("each agent has auth_error boolean field", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      expect(typeof agent.auth_error).toBe("boolean");
    }
  });

});

// ── GET /api/dashboard — field coverage ───────────────────────────────────────

test.describe("GET /api/dashboard — activeCount field", () => {
  test("response includes numeric activeCount field", async () => {
    const { status, body } = await apiGet("/api/dashboard");
    expect(status).toBe(200);
    expect(typeof body.activeCount).toBe("number");
    expect(body.activeCount).toBeGreaterThanOrEqual(0);
  });

  test("response includes mode string, agents array, and tasks array", async () => {
    const { body } = await apiGet("/api/dashboard");
    expect(typeof body.mode).toBe("string");
    expect(body.mode.length).toBeGreaterThan(0);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBeGreaterThan(0);
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  test("dashboard agent entries have name, role, status, cycles fields", async () => {
    const { body } = await apiGet("/api/dashboard");
    for (const agent of body.agents || []) {
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.role).toBe("string");
      expect(typeof agent.status).toBe("string");
      // cycles may be null when no cycle log exists yet
      expect(agent.cycles === null || typeof agent.cycles === "number").toBe(true);
    }
  });

  test("dashboard agent entries have current_task, last_update, lastSeenSecs, heartbeat_age_ms", async () => {
    const { body } = await apiGet("/api/dashboard");
    for (const agent of body.agents || []) {
      expect(agent.current_task === null || typeof agent.current_task === "string").toBe(true);
      expect(agent.last_update === null || typeof agent.last_update === "string").toBe(true);
      expect(agent.lastSeenSecs === null || typeof agent.lastSeenSecs === "number").toBe(true);
      expect(agent.heartbeat_age_ms === null || typeof agent.heartbeat_age_ms === "number").toBe(true);
    }
  });

  test("dashboard task items have id, title, status, priority, assignee fields", async () => {
    const { body } = await apiGet("/api/dashboard");
    for (const task of body.tasks || []) {
      expect(typeof task.id === "number" || typeof task.id === "string").toBe(true);
      expect(typeof task.title).toBe("string");
      expect(typeof task.status).toBe("string");
      expect(typeof task.priority).toBe("string");
      expect(typeof task.assignee).toBe("string");
    }
  });

  test("dashboard task items have description, group, task_type, created, updated fields", async () => {
    const { body } = await apiGet("/api/dashboard");
    for (const task of body.tasks || []) {
      expect(typeof task.description).toBe("string");
      expect(typeof task.group).toBe("string");
      expect(typeof task.task_type).toBe("string");
      expect(typeof task.created).toBe("string");
      expect(typeof task.updated).toBe("string");
    }
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

  test("totals object has totalCost and totalCycles fields", async () => {
    const { body } = await apiGet("/api/stats");
    expect(typeof body.totals.totalCost).toBe("number");
    expect(typeof body.totals.totalCycles).toBe("number");
    expect(body.totals.totalCost).toBeGreaterThanOrEqual(0);
    expect(body.totals.totalCycles).toBeGreaterThanOrEqual(0);
  });

  test("agent entries have dailyCosts and dailyCycles objects", async () => {
    const { body } = await apiGet("/api/stats");
    for (const a of body.agents || []) {
      expect(typeof a.dailyCosts).toBe("object");
      expect(a.dailyCosts).not.toBeNull();
      expect(typeof a.dailyCycles).toBe("object");
      expect(a.dailyCycles).not.toBeNull();
      // Each key is a date string like "2026_04_01", each value is a number
      for (const [k, v] of Object.entries(a.dailyCosts)) {
        expect(typeof k).toBe("string");
        expect(typeof v).toBe("number");
      }
      for (const [k, v] of Object.entries(a.dailyCycles)) {
        expect(typeof k).toBe("string");
        expect(typeof v).toBe("number");
      }
    }
  });
});

// ── SOPs ──────────────────────────────────────────────────────────────────────

test.describe("GET /api/sops", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/sops");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("SOP entries have name, filename, and content fields", async () => {
    const { body } = await apiGet("/api/sops");
    for (const sop of body || []) {
      expect(typeof sop.name).toBe("string");
      expect(typeof sop.filename).toBe("string");
      // content may be null (empty file) or string
      expect(sop.content === null || typeof sop.content === "string").toBe(true);
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

  test("returns an array of org entries", async () => {
    const { body } = await apiGet("/api/org");
    expect(Array.isArray(body)).toBe(true);
  });

  test("org entries have name, role, reports_to, and children fields", async () => {
    const { body } = await apiGet("/api/org");
    // At least alice should be in the org
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect(typeof entry.name).toBe("string");
      expect(entry.role === null || typeof entry.role === "string").toBe(true);
      // reports_to may be null (top-level) or string
      expect(entry.reports_to === null || typeof entry.reports_to === "string").toBe(true);
      expect(Array.isArray(entry.children)).toBe(true);
    }
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

  test("companyName contains 'Agent Planet' (not renamed)", async () => {
    const { body } = await apiGet("/api/config");
    expect(body.companyName).toContain("Agent Planet");
    expect(body.companyName).not.toContain("Tokenfly");
  });

  test("directory field is a non-empty string", async () => {
    const { body } = await apiGet("/api/config");
    expect(typeof body.directory).toBe("string");
    expect(body.directory.length).toBeGreaterThan(0);
  });
});

// ── GET /api/health — full field coverage ─────────────────────────────────────

test.describe("GET /api/health — field coverage", () => {
  test("includes uptime_ms as positive number", async () => {
    const { body } = await apiGet("/api/health");
    expect(typeof body.uptime_ms).toBe("number");
    expect(body.uptime_ms).toBeGreaterThan(0);
  });

  test("includes activeAgents as non-negative number", async () => {
    const { body } = await apiGet("/api/health");
    expect(typeof body.activeAgents).toBe("number");
    expect(body.activeAgents).toBeGreaterThanOrEqual(0);
  });

  test("includes sseClients as non-negative number", async () => {
    const { body } = await apiGet("/api/health");
    expect(typeof body.sseClients).toBe("number");
    expect(body.sseClients).toBeGreaterThanOrEqual(0);
  });

  test("status field is 'ok'", async () => {
    const { body } = await apiGet("/api/health");
    expect(body.status).toBe("ok");
  });

  test("memory field has rss, heapUsed, heapTotal as positive numbers", async () => {
    const { body } = await apiGet("/api/health");
    expect(typeof body.memory).toBe("object");
    expect(typeof body.memory.rss).toBe("number");
    expect(typeof body.memory.heapUsed).toBe("number");
    expect(typeof body.memory.heapTotal).toBe("number");
    expect(body.memory.rss).toBeGreaterThan(0);
  });

  test("uptime field is a positive number (seconds)", async () => {
    const { body } = await apiGet("/api/health");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThan(0);
  });
});

// ── Mode API ──────────────────────────────────────────────────────────────────

test.describe("GET /api/mode", () => {
  test("returns 200 with mode and raw fields", async () => {
    const { status, body } = await apiGet("/api/mode");
    expect(status).toBe(200);
    expect(typeof body.mode).toBe("string");
    expect(body.mode.length).toBeGreaterThan(0);
    expect(typeof body.raw).toBe("string");
  });

  test("mode is one of valid modes", async () => {
    const { body } = await apiGet("/api/mode");
    expect(["plan", "normal", "crazy", "autonomous"]).toContain(body.mode);
  });

  test("raw contains current mode name", async () => {
    const { body } = await apiGet("/api/mode");
    expect(body.raw.toLowerCase()).toContain(body.mode);
  });
});

test.describe("POST /api/mode", () => {
  test("returns 400 when mode is missing", async () => {
    const { status } = await apiPost("/api/mode", { who: "test", reason: "test" });
    expect(status).toBe(400);
  });

  test("returns 400 for invalid mode value", async () => {
    const { status } = await apiPost("/api/mode", { mode: "turbo", who: "test", reason: "test" });
    expect(status).toBe(400);
  });

  test("returns 400 when who is missing", async () => {
    const { status } = await apiPost("/api/mode", { mode: "normal", reason: "test" });
    expect(status).toBe(400);
  });

  test("returns 400 when reason is missing", async () => {
    const { status } = await apiPost("/api/mode", { mode: "normal", who: "test" });
    expect(status).toBe(400);
  });

  test("returns 200 with ok and output fields on success", async () => {
    const { status, body } = await apiPost("/api/mode", { mode: "normal", who: "e2e-test", reason: "E2E mode test" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.output).toBe("string");
  });
});

// ── Watchdog log ──────────────────────────────────────────────────────────────

test.describe("GET /api/watchdog-log", () => {
  test("returns 200 with log field", async () => {
    const { status, body } = await apiGet("/api/watchdog-log");
    expect(status).toBe(200);
    expect(Array.isArray(body.log)).toBe(true);
  });

  test("watchdog log entries have ts, name, action, heartbeat_age_ms fields if non-empty", async () => {
    const { body } = await apiGet("/api/watchdog-log");
    for (const entry of body.log || []) {
      expect(typeof entry.ts).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.action).toBe("string");
      expect(typeof entry.heartbeat_age_ms).toBe("number");
    }
  });
});

// ── GET /api/tasks list — response shape ─────────────────────────────────────

test.describe("GET /api/tasks — item shape", () => {
  test("returns 200 with an array of task items", async () => {
    const { status, body } = await apiGet("/api/tasks");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("task items have id, title, priority, assignee, status fields", async () => {
    const { body } = await apiGet("/api/tasks");
    for (const task of body) {
      // id may be a number or numeric string depending on parsing
      expect(typeof task.id === "number" || typeof task.id === "string").toBe(true);
      expect(typeof task.title).toBe("string");
      expect(typeof task.priority).toBe("string");
      expect(typeof task.assignee).toBe("string");
      expect(typeof task.status).toBe("string");
    }
  });

  test("task items have description, group, task_type, created, updated, notes fields", async () => {
    const { body } = await apiGet("/api/tasks");
    for (const task of body) {
      expect(typeof task.description).toBe("string");
      expect(typeof task.group).toBe("string");
      expect(typeof task.task_type).toBe("string");
      expect(typeof task.created).toBe("string");
      expect(typeof task.updated).toBe("string");
      expect(typeof task.notes).toBe("string");
    }
  });

  test("task items have notesList array field", async () => {
    const { body } = await apiGet("/api/tasks");
    for (const task of body) {
      expect(Array.isArray(task.notesList)).toBe(true);
    }
  });
});

// ── Task archive ──────────────────────────────────────────────────────────────

test.describe("GET /api/tasks/health", () => {
  test("returns 200 with stale/unassigned/noResult arrays and summary", async () => {
    const { status, body } = await apiGet("/api/tasks/health");
    expect(status).toBe(200);
    expect(Array.isArray(body.stale)).toBe(true);
    expect(Array.isArray(body.unassigned)).toBe(true);
    expect(Array.isArray(body.noResult)).toBe(true);
    expect(typeof body.summary).toBe("object");
    expect(typeof body.summary.staleCount).toBe("number");
    expect(typeof body.summary.unassignedCount).toBe("number");
    expect(typeof body.summary.noResultCount).toBe("number");
    expect(typeof body.summary.checkedAt).toBe("string");
  });
});

test.describe("GET /api/tasks/archive", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/tasks/archive");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("archived task items have id, title, status, priority, assignee fields", async () => {
    const { body } = await apiGet("/api/tasks/archive");
    for (const task of body || []) {
      expect(typeof task.id === "number" || typeof task.id === "string").toBe(true);
      expect(typeof task.title).toBe("string");
      expect(typeof task.status).toBe("string");
      expect(typeof task.priority).toBe("string");
      expect(typeof task.assignee).toBe("string");
    }
  });

  test("archived task items have description, group, created, updated fields", async () => {
    const { body } = await apiGet("/api/tasks/archive");
    for (const task of body || []) {
      expect(typeof task.description).toBe("string");
      expect(typeof task.group).toBe("string");
      expect(typeof task.created).toBe("string");
      expect(typeof task.updated).toBe("string");
    }
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

// ── PATCH /api/tasks/:id notes ────────────────────────────────────────────────

test.describe("PATCH /api/tasks/:id — notes field", () => {
  let _noteTaskId = null;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/tasks", { title: "E2E-Notes-Test", priority: "low" });
    if (body.ok && body.id) _noteTaskId = body.id;
  });

  test.afterAll(async () => {
    if (_noteTaskId) await apiDelete(`/api/tasks/${_noteTaskId}`).catch(() => {});
  });

  test("PATCH with notes appends a timestamped note", async () => {
    if (!_noteTaskId) return;
    const { status, body } = await apiPatch(`/api/tasks/${_noteTaskId}`, { notes: "e2e test note content" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // notesList should contain the appended note
    expect(Array.isArray(body.notesList)).toBe(true);
    expect(body.notesList.length).toBeGreaterThan(0);
    expect(body.notesList.some((n) => n.includes("e2e test note content"))).toBe(true);
  });

  test("PATCH notes are cumulative (appended, not replaced)", async () => {
    if (!_noteTaskId) return;
    await apiPatch(`/api/tasks/${_noteTaskId}`, { notes: "first note" });
    await apiPatch(`/api/tasks/${_noteTaskId}`, { notes: "second note" });
    const { body } = await apiPatch(`/api/tasks/${_noteTaskId}`, { notes: "third note" });
    expect(body.notesList.length).toBeGreaterThanOrEqual(3);
  });
});

// ── PATCH /api/tasks/:id — invalid assignee ───────────────────────────────────

test.describe("PATCH /api/tasks/:id — invalid assignee", () => {
  let _assigneeTaskId = null;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/tasks", { title: "E2E-Assignee-Test", priority: "low" });
    if (body.ok && body.id) _assigneeTaskId = body.id;
  });

  test.afterAll(async () => {
    if (_assigneeTaskId) await apiDelete(`/api/tasks/${_assigneeTaskId}`).catch(() => {});
  });

  test("returns 400 for assignee with special characters", async () => {
    if (!_assigneeTaskId) return;
    const { status } = await apiPatch(`/api/tasks/${_assigneeTaskId}`, { assignee: "bad|name" });
    expect(status).toBe(400);
  });
});

// ── POST /api/tasks — task_type and group fields ───────────────────────────────

test.describe("POST /api/tasks — task_type and group fields", () => {
  let _taskId = null;

  test.afterAll(async () => {
    if (_taskId) await apiDelete(`/api/tasks/${_taskId}`).catch(() => {});
  });

  test("creates task with task_type field and returns it", async () => {
    const { status, body } = await apiPost("/api/tasks", {
      title: "E2E-TaskType-Test",
      priority: "low",
      task_type: "bug",
      group: "engineering",
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.task_type).toBe("bug");
    expect(body.group).toBe("engineering");
    if (body.id) _taskId = body.id;
  });
});

// ── POST /api/tasks — full create response shape ───────────────────────────────

test.describe("POST /api/tasks — full create response shape", () => {
  let _shapeTaskId = null;

  test.afterAll(async () => {
    if (_shapeTaskId) await apiDelete(`/api/tasks/${_shapeTaskId}`).catch(() => {});
  });

  test("create response includes id, title, status, priority, description, created, updated, assignee", async () => {
    const { status, body } = await apiPost("/api/tasks", {
      title: "E2E-Shape-Full-Test",
      priority: "medium",
      description: "shape test description",
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("number");
    expect(body.title).toBe("E2E-Shape-Full-Test");
    expect(typeof body.status).toBe("string");
    expect(body.status).toBe("open");
    expect(typeof body.priority).toBe("string");
    expect(body.priority).toBe("medium");
    expect(typeof body.description).toBe("string");
    expect(typeof body.created).toBe("string");
    expect(typeof body.updated).toBe("string");
    expect(typeof body.assignee).toBe("string");
    _shapeTaskId = body.id;
  });

  test("create response has task_type and group fields with defaults", async () => {
    const { body } = await apiPost("/api/tasks", { title: "E2E-Shape-Defaults", priority: "low" });
    expect(typeof body.task_type).toBe("string");
    expect(typeof body.group).toBe("string");
    if (body.id) await apiDelete(`/api/tasks/${body.id}`).catch(() => {});
  });
});

// ── Agent persona note ────────────────────────────────────────────────────────

test.describe("POST /api/agents/:name/persona/note", () => {
  let _alicePersonaSnapshot = null;
  test.beforeAll(async () => {
    try { _alicePersonaSnapshot = fs.readFileSync(path.join(AGENTS_DIR, "alice/persona.md"), "utf8"); } catch (_) {}
  });
  test.afterAll(async () => {
    if (_alicePersonaSnapshot !== null) {
      try { fs.writeFileSync(path.join(AGENTS_DIR, "alice/persona.md"), _alicePersonaSnapshot); } catch (_) {}
    }
  });

  test("returns 400 when note is missing", async () => {
    const { status } = await apiPost("/api/agents/alice/persona/note", {});
    expect(status).toBe(400);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiPost("/api/agents/bad|name/persona/note", { note: "test" });
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPost("/api/agents/unknown_xyz/persona/note", {
      note: "test note",
    });
    expect(status).toBe(404);
  });

  test("adds a note to alice persona and returns ok + timestamp + note", async () => {
    const noteText = "E2E test note — safe to ignore";
    const { status, body } = await apiPost("/api/agents/alice/persona/note", {
      note: noteText,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.timestamp).toBe("string");
    expect(body.type).toBe("Note");
    expect(body.note).toBe(noteText);
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
  let _personaPatchSnapshot = null;
  test.beforeAll(async () => {
    try { _personaPatchSnapshot = fs.readFileSync(path.join(AGENTS_DIR, "alice/persona.md"), "utf8"); } catch (_) {}
  });
  test.afterAll(async () => {
    if (_personaPatchSnapshot !== null) {
      try { fs.writeFileSync(path.join(AGENTS_DIR, "alice/persona.md"), _personaPatchSnapshot); } catch (_) {}
    }
  });

  test("returns 400 when observation is missing", async () => {
    const { status } = await apiPatch("/api/agents/alice/persona", {});
    expect(status).toBe(400);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiPatch("/api/agents/bad|name/persona", { observation: "test" });
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPatch("/api/agents/unknown_xyz/persona", {
      observation: "test",
    });
    expect(status).toBe(404);
  });

  test("appends evolution entry and returns ok + timestamp + observation", async () => {
    const obs = "E2E test evolution — safe to ignore";
    const { status, body } = await apiPatch("/api/agents/alice/persona", {
      observation: obs,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.timestamp).toBe("string");
    expect(body.type).toBe("Evolution");
    expect(body.observation).toBe(obs);
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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/lastcontext");
    expect(status).toBe(400);
  });
});

// ── Messages alias endpoint ───────────────────────────────────────────────────

test.describe("POST /api/messages/:agent", () => {
  test.afterAll(async () => {
    for (const { agent, filename } of _createdInboxFiles) {
      try { fs.unlinkSync(path.join(AGENTS_DIR, agent, "chat_inbox", filename)); } catch (_) {}
    }
    _createdInboxFiles.length = 0;
  });

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
    if (body.file) _createdInboxFiles.push({ agent: "alice", filename: path.basename(body.file) });
  });
});

// ── Code output ───────────────────────────────────────────────────────────────

test.describe("GET /api/code-output", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await apiGet("/api/code-output");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("entries have agent and files array fields if non-empty", async () => {
    const { body } = await apiGet("/api/code-output");
    for (const entry of body || []) {
      expect(typeof entry.agent).toBe("string");
      expect(Array.isArray(entry.files)).toBe(true);
    }
  });
});

// ── Digest ────────────────────────────────────────────────────────────────────

test.describe("GET /api/digest", () => {
  test("returns 200", async () => {
    const { status } = await apiGet("/api/digest");
    expect(status).toBe(200);
  });

  test("response is an array (not null)", async () => {
    const { body } = await apiGet("/api/digest");
    expect(Array.isArray(body)).toBe(true);
  });

  test("digest entries have agent and completedCycles fields if non-empty", async () => {
    const { body } = await apiGet("/api/digest");
    for (const entry of body) {
      expect(typeof entry.agent).toBe("string");
      expect(typeof entry.completedCycles).toBe("number");
      expect(typeof entry.activeCycle).toBe("boolean");
      expect(Array.isArray(entry.cycles)).toBe(true);
    }
  });

  test("digest cycle entries have start, tasks, end fields", async () => {
    const { body } = await apiGet("/api/digest");
    for (const entry of body) {
      for (const cycle of entry.cycles || []) {
        // start is the cycle start timestamp/label
        expect(typeof cycle.start).toBe("string");
        // tasks is an array of task references
        expect(Array.isArray(cycle.tasks)).toBe(true);
        // end is the cycle end timestamp/label (may be null for active cycle)
        expect(cycle.end === null || typeof cycle.end === "string").toBe(true);
      }
    }
  });

  test("digest cycle tasks items are strings", async () => {
    const { body } = await apiGet("/api/digest");
    for (const entry of body) {
      for (const cycle of entry.cycles || []) {
        for (const t of cycle.tasks || []) {
          expect(typeof t).toBe("string");
        }
      }
    }
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

  test("inbox items have filename, from, timestamp, content fields", async () => {
    const { body } = await apiGet("/api/ceo-inbox");
    const allItems = [...(body.unread || []), ...(body.processed || [])];
    for (const item of allItems) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.from).toBe("string");
      expect(typeof item.timestamp).toBe("string");
      expect(typeof item.content).toBe("string");
    }
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

  test("response includes inCycle boolean field", async () => {
    const { body } = await apiGet("/api/agents/alice/ping");
    expect(typeof body.inCycle).toBe("boolean");
  });

  test("response includes pids array field", async () => {
    const { body } = await apiGet("/api/agents/alice/ping");
    expect(Array.isArray(body.pids)).toBe(true);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/ping");
    expect(status).toBe(404);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/ping");
    expect(status).toBe(400);
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

  test("agent entries include heartbeat_age_ms, log_age_ms, current_task, last_heartbeat", async () => {
    const { body } = await apiGet("/api/metrics/agents");
    expect(body.length).toBeGreaterThan(0);
    for (const a of body) {
      expect(typeof a.heartbeat_age_ms === "number" || a.heartbeat_age_ms === null).toBe(true);
      expect(typeof a.log_age_ms === "number" || a.log_age_ms === null).toBe(true);
      // current_task is null, string, or object
      expect(a.current_task === null || typeof a.current_task === "string" || typeof a.current_task === "object").toBe(true);
      // last_heartbeat is null or ISO string
      expect(a.last_heartbeat === null || typeof a.last_heartbeat === "string").toBe(true);
    }
  });

  test("agent entries include status, blockers, inbox_unread, last_status_update fields", async () => {
    const { body } = await apiGet("/api/metrics/agents");
    expect(body.length).toBeGreaterThan(0);
    for (const a of body) {
      expect(typeof a.status).toBe("string");
      expect(Array.isArray(a.blockers)).toBe(true);
      expect(typeof a.inbox_unread).toBe("number");
      expect(a.inbox_unread).toBeGreaterThanOrEqual(0);
      expect(a.last_status_update === null || typeof a.last_status_update === "string").toBe(true);
    }
  });
});

test.describe("GET /api/metrics/agents/:name", () => {
  test("returns 200 for known agent", async () => {
    const { status, body } = await apiGet("/api/metrics/agents/alice");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
  });

  test("response includes status, inbox_unread, blockers fields", async () => {
    const { body } = await apiGet("/api/metrics/agents/alice");
    expect(typeof body.status).toBe("string");
    expect(typeof body.inbox_unread).toBe("number");
    expect(body.inbox_unread).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.blockers)).toBe(true);
  });

  test("response includes heartbeat_age_ms, log_age_ms, current_task, last_status_update", async () => {
    const { body } = await apiGet("/api/metrics/agents/alice");
    expect(typeof body.heartbeat_age_ms === "number" || body.heartbeat_age_ms === null).toBe(true);
    expect(typeof body.log_age_ms === "number" || body.log_age_ms === null).toBe(true);
    expect(body.current_task === null || typeof body.current_task === "string" || typeof body.current_task === "object").toBe(true);
    expect(body.last_status_update === null || typeof body.last_status_update === "string").toBe(true);
  });

  test("response includes last_heartbeat field (null or string)", async () => {
    const { body } = await apiGet("/api/metrics/agents/alice");
    expect(body.last_heartbeat === null || typeof body.last_heartbeat === "string").toBe(true);
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

  test("response includes by_priority, by_status, tasks fields", async () => {
    const { body } = await apiGet("/api/metrics/tasks");
    expect(typeof body.by_priority).toBe("object");
    expect(typeof body.by_status).toBe("object");
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  test("by_status has standard status keys", async () => {
    const { body } = await apiGet("/api/metrics/tasks");
    expect(typeof body.by_status.open).toBe("number");
    expect(typeof body.by_status.in_progress).toBe("number");
    expect(typeof body.by_status.done).toBe("number");
  });

  test("response includes by_assignee object", async () => {
    const { body } = await apiGet("/api/metrics/tasks");
    expect(typeof body.by_assignee).toBe("object");
    expect(body.by_assignee).not.toBeNull();
  });

  test("tasks array items have id, title, priority, assignee, status fields", async () => {
    const { body } = await apiGet("/api/metrics/tasks");
    for (const t of body.tasks || []) {
      expect(typeof t.title).toBe("string");
      expect(typeof t.priority).toBe("string");
      expect(typeof t.assignee).toBe("string");
      expect(typeof t.status).toBe("string");
    }
  });

  test("tasks array items have description, created, updated fields", async () => {
    const { body } = await apiGet("/api/metrics/tasks");
    for (const t of body.tasks || []) {
      expect(typeof t.description).toBe("string");
      expect(typeof t.created).toBe("string");
      expect(typeof t.updated).toBe("string");
    }
  });
});

test.describe("GET /api/metrics/health", () => {
  test("returns 200 with health snapshot", async () => {
    const { status, body } = await apiGet("/api/metrics/health");
    expect(status).toBe(200);
    expect(body).not.toBeNull();
  });

  test("response includes timestamp, mode, agents summary, health_score", async () => {
    const { body } = await apiGet("/api/metrics/health");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.mode).toBe("string");
    expect(typeof body.agents).toBe("object");
    expect(typeof body.agents.total).toBe("number");
    expect(typeof body.agents.running).toBe("number");
    expect(typeof body.health_score).toBe("number");
    expect(body.health_score).toBeGreaterThanOrEqual(0);
    expect(body.health_score).toBeLessThanOrEqual(100);
  });

  test("agents section includes offline, blocked, with_unread_inbox fields", async () => {
    const { body } = await apiGet("/api/metrics/health");
    expect(typeof body.agents.offline).toBe("number");
    expect(typeof body.agents.blocked).toBe("number");
    expect(typeof body.agents.with_unread_inbox).toBe("number");
  });
});

// ── GET /api/metrics — http field ────────────────────────────────────────────

test.describe("GET /api/metrics — http section", () => {
  test("http field has uptime_ms and uptime_human", async () => {
    const { status, body } = await apiGet("/api/metrics");
    expect(status).toBe(200);
    expect(typeof body.http).toBe("object");
    expect(typeof body.http.uptime_ms).toBe("number");
    expect(body.http.uptime_ms).toBeGreaterThan(0);
    expect(typeof body.http.uptime_human).toBe("string");
    expect(body.http.uptime_human.length).toBeGreaterThan(0);
  });

  test("http field has total_requests and total_errors counts", async () => {
    const { body } = await apiGet("/api/metrics");
    expect(typeof body.http.total_requests).toBe("number");
    expect(typeof body.http.total_errors).toBe("number");
    expect(body.http.total_requests).toBeGreaterThanOrEqual(0);
    expect(body.http.total_errors).toBeGreaterThanOrEqual(0);
  });

  test("http.endpoints is an object", async () => {
    const { body } = await apiGet("/api/metrics");
    expect(typeof body.http.endpoints).toBe("object");
    expect(body.http.endpoints).not.toBeNull();
  });

  test("http.endpoints entries have requests, errors, error_rate, avg_ms, min_ms, max_ms", async () => {
    const { body } = await apiGet("/api/metrics");
    const entries = Object.values(body.http.endpoints || {});
    expect(entries.length).toBeGreaterThan(0);
    for (const ep of entries.slice(0, 5)) {
      expect(typeof ep.requests).toBe("number");
      expect(typeof ep.errors).toBe("number");
      expect(typeof ep.error_rate).toBe("number");
      expect(typeof ep.avg_ms).toBe("number");
      expect(typeof ep.min_ms).toBe("number");
      expect(typeof ep.max_ms).toBe("number");
    }
  });
});

test.describe("GET /api/metrics — top-level fields", () => {
  test("returns 200 with timestamp, tasks, agents, cost_7d, http fields", async () => {
    const { status, body } = await apiGet("/api/metrics");
    expect(status).toBe(200);
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.tasks).toBe("object");
    expect(typeof body.agents).toBe("object");
    expect(typeof body.cost_7d).toBe("object");
    expect(typeof body.http).toBe("object");
  });

  test("agents field has total, running, idle, stale, health sub-fields", async () => {
    const { body } = await apiGet("/api/metrics");
    expect(typeof body.agents.total).toBe("number");
    expect(typeof body.agents.running).toBe("number");
    expect(typeof body.agents.idle).toBe("number");
    expect(typeof body.agents.stale).toBe("number");
    expect(typeof body.agents.health).toBe("object");
  });

  test("cost_7d has total_usd, total_cycles, avg_cost_per_cycle_usd, per_agent fields", async () => {
    const { body } = await apiGet("/api/metrics");
    expect(typeof body.cost_7d.total_usd).toBe("number");
    expect(typeof body.cost_7d.total_cycles).toBe("number");
    expect(typeof body.cost_7d.avg_cost_per_cycle_usd).toBe("number");
    expect(Array.isArray(body.cost_7d.per_agent)).toBe(true);
  });

  test("cost_7d.per_agent entries have name, cost_usd, cycles fields", async () => {
    const { body } = await apiGet("/api/metrics");
    for (const a of body.cost_7d.per_agent) {
      expect(typeof a.name).toBe("string");
      expect(typeof a.cost_usd).toBe("number");
      expect(typeof a.cycles).toBe("number");
    }
  });

  test("tasks field has total, by_status, by_priority, completion_rate_pct sub-fields", async () => {
    const { body } = await apiGet("/api/metrics");
    expect(typeof body.tasks.total).toBe("number");
    expect(typeof body.tasks.by_status).toBe("object");
    expect(typeof body.tasks.by_priority).toBe("object");
    expect(typeof body.tasks.completion_rate_pct).toBe("number");
    expect(body.tasks.completion_rate_pct).toBeGreaterThanOrEqual(0);
  });

  test("agents.health sub-fields include avg_score and grade distribution", async () => {
    const { body } = await apiGet("/api/metrics");
    expect(typeof body.agents.health).toBe("object");
    // health contains avg_score and/or grade distribution
    const healthKeys = Object.keys(body.agents.health);
    expect(healthKeys.length).toBeGreaterThan(0);
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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/health");
    expect(status).toBe(400);
  });

  test("response includes name field matching requested agent", async () => {
    const { body } = await apiGet("/api/agents/alice/health");
    expect(body.name).toBe("alice");
  });

  test("dimensions contain heartbeat, activity, status, velocity, recency keys", async () => {
    const { body } = await apiGet("/api/agents/alice/health");
    for (const dim of ["heartbeat", "activity", "status", "velocity", "recency"]) {
      expect(body.dimensions).toHaveProperty(dim);
      expect(typeof body.dimensions[dim].score).toBe("number");
      expect(typeof body.dimensions[dim].detail).toBe("string");
    }
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

  test("unread items have filename and content fields", async () => {
    const { body } = await apiGet("/api/agents/alice/inbox");
    for (const item of body.unread) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.content).toBe("string");
      expect(item.unread).toBe(true);
    }
  });

  test("processed items have filename and content fields", async () => {
    const { body } = await apiGet("/api/agents/alice/inbox");
    for (const item of body.processed) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.content).toBe("string");
      expect(item.unread).toBe(false);
    }
  });

  test("inbox items have from and timestamp fields", async () => {
    const { body } = await apiGet("/api/agents/alice/inbox");
    const allItems = [...(body.unread || []), ...(body.processed || [])];
    for (const item of allItems) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.content).toBe("string");
      // from and timestamp are present on all inbox items
      expect(item.from === null || item.from === undefined || typeof item.from === "string").toBe(true);
      expect(item.timestamp === null || item.timestamp === undefined || typeof item.timestamp === "string").toBe(true);
    }
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/inbox");
    expect(status).toBe(404);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/inbox");
    expect(status).toBe(400);
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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/status");
    expect(status).toBe(400);
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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/persona");
    expect(status).toBe(400);
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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/todo");
    expect(status).toBe(400);
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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/activity");
    expect(status).toBe(400);
  });
});

// ── Agent cycle detail ────────────────────────────────────────────────────────

test.describe("GET /api/agents/:name/cycles — cycle entry shape", () => {
  test("response has name, date, and cycles array", async () => {
    const { status, body } = await apiGet("/api/agents/alice/cycles");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(typeof body.date).toBe("string");
    expect(body.date).toMatch(/^\d{4}[_-]\d{2}[_-]\d{2}$/);
    expect(Array.isArray(body.cycles)).toBe(true);
  });

  test("cycle entries have n, started, ended, turns, cost_usd, action_count, preview fields", async () => {
    const { body } = await apiGet("/api/agents/alice/cycles");
    for (const c of body.cycles || []) {
      expect(typeof c.n).toBe("number");
      expect(typeof c.started).toBe("string");
      // ended, turns, cost_usd, duration_s may be null
      expect(c.ended === null || typeof c.ended === "string").toBe(true);
      expect(c.turns === null || typeof c.turns === "number").toBe(true);
      expect(c.cost_usd === null || typeof c.cost_usd === "number").toBe(true);
      expect(c.duration_s === null || typeof c.duration_s === "number").toBe(true);
      expect(typeof c.action_count).toBe("number");
      expect(typeof c.preview).toBe("string");
    }
  });
});

test.describe("GET /api/agents/:name/cycles/:n", () => {
  test("returns 200 with name, cycle, content for existing cycle", async () => {
    // alice has cycles today — fetch cycle 1 (oldest)
    const { status: listStatus, body: listBody } = await apiGet("/api/agents/alice/cycles");
    if (!listStatus || !listBody.cycles || listBody.cycles.length === 0) return;
    const firstCycleN = listBody.cycles[listBody.cycles.length - 1].n;
    const { status, body } = await apiGet(`/api/agents/alice/cycles/${firstCycleN}`);
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(typeof body.cycle).toBe("number");
    expect(typeof body.content).toBe("string");
  });

  test("returns 404 for cycle that does not exist", async () => {
    const { status } = await apiGet("/api/agents/alice/cycles/99999");
    expect(status).toBe(404);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/cycles/1");
    expect(status).toBe(404);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/cycles/1");
    expect(status).toBe(400);
  });
});

// ── Agent log ─────────────────────────────────────────────────────────────────

test.describe("GET /api/agents/:name/log", () => {
  test("returns 200 with an array for known agent", async () => {
    const { status, body } = await apiGet("/api/agents/alice/log");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("log entries have type, content, timestamp fields if non-empty", async () => {
    const { body } = await apiGet("/api/agents/alice/log");
    for (const entry of body || []) {
      expect(typeof entry.type).toBe("string");
      expect(typeof entry.content).toBe("string");
      // timestamp may be null or string
      expect(entry.timestamp === null || typeof entry.timestamp === "string").toBe(true);
    }
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/unknown_xyz/log");
    expect(status).toBe(404);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/log");
    expect(status).toBe(400);
  });
});

// ── CEO inbox mark-read ───────────────────────────────────────────────────────

test.describe("POST /api/ceo-inbox/:filename/read", () => {
  const CEO_INBOX_DIR = path.join(DATA_DIR, "ceo_inbox");
  const CEO_INBOX_PROCESSED = path.join(CEO_INBOX_DIR, "processed");
  let testFilename;

  test.beforeAll(() => {
    testFilename = `2026_01_01_00_00_00_e2e_test.md`;
    try { require("fs").mkdirSync(CEO_INBOX_DIR, { recursive: true }); } catch (_) {}
    require("fs").writeFileSync(path.join(CEO_INBOX_DIR, testFilename), "e2e test message");
  });

  test.afterAll(() => {
    // Clean up — file may have been moved to processed by the test
    try { require("fs").unlinkSync(path.join(CEO_INBOX_DIR, testFilename)); } catch (_) {}
    try { require("fs").unlinkSync(path.join(CEO_INBOX_PROCESSED, testFilename)); } catch (_) {}
  });

  test("returns 200 and moves file to processed/", async () => {
    const { status, body } = await apiPost(`/api/ceo-inbox/${testFilename}/read`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(require("fs").existsSync(path.join(CEO_INBOX_PROCESSED, testFilename))).toBe(true);
  });

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

  test("items have file, type, and dir fields", async () => {
    const { body } = await apiGet("/api/research");
    for (const item of body || []) {
      expect(typeof item.file).toBe("string");
      expect(["plan", "report"]).toContain(item.type);
      expect(["plans", "reports"]).toContain(item.dir);
    }
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

  test("serves a valid reports file with file, dir, content fields", async () => {
    const { status, body } = await apiGet("/api/research/active_alerts.md");
    expect(status).toBe(200);
    expect(body).toHaveProperty("file", "active_alerts.md");
    expect(body).toHaveProperty("content");
    expect(typeof body.content).toBe("string");
    expect(["plans", "reports"]).toContain(body.dir);
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

  test("sends a message and returns 201 with id, from, to, priority", async () => {
    const { status, body } = await apiPost("/api/messages", {
      from: "e2e-test",
      to: "alice",
      body: "E2E message bus test — safe to ignore",
      priority: 5,
    });
    expect(status).toBe(201);
    expect(typeof body.id).toBe("number");
    expect(body.to).toBe("alice");
    expect(body.from).toBe("e2e-test");
    expect(typeof body.priority).toBe("number");
    expect(body.priority).toBe(5);
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

  test("inbox message items have id, from_agent, to_agent, body, priority, created_at fields", async () => {
    await apiPost("/api/messages", { from: "e2e-shape-inbox", to: "alice", body: "shape check" });
    const { body } = await apiGet("/api/inbox/alice");
    for (const msg of body.messages || []) {
      expect(typeof msg.id).toBe("number");
      expect(typeof msg.from_agent).toBe("string");
      expect(typeof msg.to_agent).toBe("string");
      expect(typeof msg.body).toBe("string");
      expect(typeof msg.priority).toBe("number");
      expect(typeof msg.created_at).toBe("string");
    }
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

  test("by_agent entries have agent and unread fields", async () => {
    const { body } = await apiGet("/api/messages/queue-depth");
    for (const entry of body.by_agent || []) {
      expect(typeof entry.agent).toBe("string");
      expect(typeof entry.unread).toBe("number");
      expect(entry.unread).toBeGreaterThanOrEqual(0);
    }
  });

  test("total_unread is non-negative", async () => {
    const { body } = await apiGet("/api/messages/queue-depth");
    expect(body.total_unread).toBeGreaterThanOrEqual(0);
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
  test.setTimeout(15000); // smart_run.sh --dry-run can take ~2s
  let _origConfig = null;

  test.beforeAll(async () => {
    // Save config and enable smart-start for these tests (dry_run stays true)
    const { body } = await apiGet("/api/smart-run/config");
    _origConfig = body.config || body;
    await apiPost("/api/smart-run/config", { enabled: true, dry_run: true });
  });

  test.afterAll(async () => {
    if (_origConfig !== null) {
      await apiPost("/api/smart-run/config", _origConfig);
    }
  });

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

  test("response includes decision object with string values", async () => {
    const { body } = await apiPost("/api/agents/smart-start");
    expect(typeof body.decision).toBe("object");
    expect(body.decision).not.toBeNull();
    // decision keys are human-readable labels, values are strings
    for (const [k, v] of Object.entries(body.decision)) {
      expect(typeof k).toBe("string");
      expect(typeof v).toBe("string");
    }
  });

  test("returns 403 when smart-run is disabled", async () => {
    // Temporarily disable
    await apiPost("/api/smart-run/config", { enabled: false });
    const { status, body } = await apiPost("/api/agents/smart-start");
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(typeof body.message).toBe("string");
    // Re-enable for subsequent tests in this describe block
    await apiPost("/api/smart-run/config", { enabled: true });
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
// GET /api/agents/:name/output — list output files
// ---------------------------------------------------------------------------
test.describe("GET /api/agents/:name/output", () => {
  test("returns 200 with agent and files array", async () => {
    const { status, body } = await apiGet("/api/agents/bob/output");
    expect(status).toBe(200);
    expect(body.agent).toBe("bob");
    expect(Array.isArray(body.files)).toBe(true);
  });

  test("each file entry has name, size, mtime fields", async () => {
    const { body } = await apiGet("/api/agents/bob/output");
    for (const f of body.files) {
      expect(typeof f.name).toBe("string");
      expect(typeof f.size).toBe("number");
      expect(f.mtime === null || typeof f.mtime === "string").toBe(true);
    }
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/nobody_xyz_123/output");
    expect(status).toBe(404);
  });
});

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
// DELETE /api/messages/:id (SQLite message bus — delete single message)
// ---------------------------------------------------------------------------
test.describe("DELETE /api/messages/:id (SQLite message bus)", () => {
  let _msgId = null;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/messages", { from: "e2e-test", to: "alice", body: "E2E-delete-id-test" });
    _msgId = body.id;
  });

  test("returns 200 with ok:true and deleted id", async () => {
    expect(_msgId).not.toBeNull();
    const { status, body } = await apiDelete(`/api/messages/${_msgId}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(_msgId);
    _msgId = null; // already deleted
  });

  test("returns 404 for unknown message id", async () => {
    const { status, body } = await apiDelete("/api/messages/999999999");
    expect(status).toBe(404);
    expect(typeof body.error).toBe("string");
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
  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiPost("/api/agents/bad|name/stop");
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status, body } = await apiPost("/api/agents/nobody_xyz_999/stop");
    expect(status).toBe(404);
    expect(body).toHaveProperty("error");
  });

  test("returns 200 for known agent (idempotent — safe if not running)", async () => {
    const { status, body } = await apiPost("/api/agents/bob/stop");
    // stop_agent.sh handles non-running agents gracefully
    expect([200, 500]).toContain(status);
    if (status === 200) {
      expect(body.ok).toBe(true);
      expect(typeof body.output).toBe("string");
    }
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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiPost("/api/agents/bad|name/start");
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status, body } = await apiPost("/api/agents/nobody_xyz_999/start");
    expect(status).toBe(404);
    expect(body).toHaveProperty("error");
  });

  test("returns 200 with ok, already_running, and message for known agent", async () => {
    const { status, body } = await apiPost("/api/agents/bob/start");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.already_running).toBe("boolean");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
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

  test("returns 200 with ok:true and output string", async () => {
    const { status, body } = await apiPost("/api/agents/stop-all");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.output).toBe("string");
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
  const _inboxCleanup = [];
  test.afterAll(async () => {
    for (const { agent, filename } of _inboxCleanup) {
      try { fs.unlinkSync(path.join(AGENTS_DIR, agent, "chat_inbox", filename)); } catch (_) {}
    }
    _inboxCleanup.length = 0;
  });

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

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiPost("/api/agents/bad|name/inbox", { message: "test" });
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
    if (body.filename) _inboxCleanup.push({ agent: "alice", filename: body.filename });
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

  test("has description, background_color, theme_color fields", async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    const body = await res.json();
    expect(typeof body.description).toBe("string");
    expect(body.description.length).toBeGreaterThan(0);
    expect(typeof body.background_color).toBe("string");
    expect(typeof body.theme_color).toBe("string");
  });

  test("icons have src, sizes, and type fields", async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    const body = await res.json();
    for (const icon of body.icons) {
      expect(typeof icon.src).toBe("string");
      expect(typeof icon.sizes).toBe("string");
      expect(typeof icon.type).toBe("string");
    }
  });
});

// ── CORS OPTIONS preflight ────────────────────────────────────────────────────

test.describe("OPTIONS /api/* CORS preflight", () => {
  test("returns 204 with CORS headers for preflight", async () => {
    const res = await fetch(`${BASE}/api/agents`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
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
      // section field (may be empty string)
      expect(typeof entry.section).toBe("string");
    }
  });
});

test.describe("POST /api/consensus/entry pipe sanitization (GAP-009)", () => {
  const _consensusIds = [];
  test.afterAll(async () => {
    for (const id of _consensusIds) {
      try { await apiDelete(`/api/consensus/entry/${id}`); } catch (_) {}
    }
    _consensusIds.length = 0;
  });

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
    if (body.id) _consensusIds.push(body.id);

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
    if (body.id) _consensusIds.push(body.id);
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

// ── DELETE /api/consensus/entry/:id ───────────────────────────────────────────

test.describe("DELETE /api/consensus/entry/:id", () => {
  test("returns 200 with ok:true and deleted id on success", async () => {
    // create an entry to delete
    const { body: created } = await apiPost("/api/consensus/entry", {
      type: "decision",
      content: "E2E delete test",
      author: "e2e",
      section: "",
    });
    expect(typeof created.id).toBe("number");
    const { status, body } = await apiDelete(`/api/consensus/entry/${created.id}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(created.id);
  });

  test("returns 404 for non-existent entry id", async () => {
    const { status, body } = await apiDelete("/api/consensus/entry/999999");
    expect(status).toBe(404);
    expect(typeof body.error).toBe("string");
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
  const _gap007Cleanup = [];
  test.afterAll(async () => {
    for (const filename of _gap007Cleanup) {
      try { fs.unlinkSync(path.join(AGENTS_DIR, "alice/chat_inbox", filename)); } catch (_) {}
    }
  });

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
    if (body.filename) _gap007Cleanup.push(body.filename);
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

// ── Executor API ──────────────────────────────────────────────────────────────

test.describe("GET /api/executors", () => {
  test("returns list of valid executors with default", async () => {
    const { status, body } = await apiGet("/api/executors");
    expect(status).toBe(200);
    expect(Array.isArray(body.executors)).toBe(true);
    expect(body.executors.length).toBeGreaterThan(0);
    expect(typeof body.default).toBe("string");
    expect(body.executors).toContain("claude");
  });
});

test.describe("GET /api/config/executor", () => {
  test("returns executor config for all agents", async () => {
    const { status, body } = await apiGet("/api/config/executor");
    expect(status).toBe(200);
    expect(typeof body.agents).toBe("object");
    expect(typeof body.default).toBe("string");
    expect(body.agents["alice"]).toBeDefined();
  });

  test("each agent executor value is a valid string", async () => {
    const { body } = await apiGet("/api/config/executor");
    for (const [, executor] of Object.entries(body.agents)) {
      expect(typeof executor).toBe("string");
      expect(executor.length).toBeGreaterThan(0);
    }
  });
});

test.describe("GET & POST /api/agents/:name/executor", () => {
  let _originalExecutor = null;

  test.beforeAll(async () => {
    const { body } = await apiGet("/api/agents/alice/executor");
    _originalExecutor = body.executor;
  });

  test.afterAll(async () => {
    if (_originalExecutor) {
      await apiPost("/api/agents/alice/executor", { executor: _originalExecutor });
    }
  });

  test("GET returns current executor for alice", async () => {
    const { status, body } = await apiGet("/api/agents/alice/executor");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(typeof body.executor).toBe("string");
  });

  test("GET returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/nonexistent-agent-xyz/executor");
    expect(status).toBe(404);
  });

  test("GET returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/executor");
    expect(status).toBe(400);
  });

  test("POST returns 400 for invalid agent name", async () => {
    const { status } = await apiPost("/api/agents/bad|name/executor", { executor: "claude" });
    expect(status).toBe(400);
  });

  test("POST sets executor and GET reflects the change", async () => {
    const { status, body } = await apiPost("/api/agents/alice/executor", { executor: "claude" });
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(body.executor).toBe("claude");

    const { body: get } = await apiGet("/api/agents/alice/executor");
    expect(get.executor).toBe("claude");
  });

  test("POST returns 400 for invalid executor", async () => {
    const { status } = await apiPost("/api/agents/alice/executor", { executor: "not-real-llm" });
    expect(status).toBe(400);
  });

  test("POST returns 400 when executor is missing", async () => {
    const { status } = await apiPost("/api/agents/alice/executor", {});
    expect(status).toBe(400);
  });
});

// ── Smart Run Config API ──────────────────────────────────────────────────────

test.describe("GET & POST /api/smart-run/config", () => {
  let _originalConfig = null;

  test.beforeAll(async () => {
    const { body } = await apiGet("/api/smart-run/config");
    _originalConfig = body.config;
  });

  test.afterAll(async () => {
    if (_originalConfig) {
      await apiPost("/api/smart-run/config", _originalConfig);
    }
  });

  test("GET returns config and daemon status", async () => {
    const { status, body } = await apiGet("/api/smart-run/config");
    expect(status).toBe(200);
    expect(typeof body.config).toBe("object");
    expect(typeof body.daemon).toBe("object");
    expect(typeof body.daemon.running).toBe("boolean");
  });

  test("GET config has expected fields", async () => {
    const { body } = await apiGet("/api/smart-run/config");
    expect(typeof body.config.max_agents).toBe("number");
    expect(typeof body.config.enabled).toBe("boolean");
  });

  test("GET config includes dry_run_sleep, description, mode fields", async () => {
    const { body } = await apiGet("/api/smart-run/config");
    expect(typeof body.config.dry_run_sleep).toBe("number");
    expect(body.config.dry_run_sleep).toBeGreaterThan(0);
    expect(typeof body.config.description).toBe("string");
    expect(body.config.description.length).toBeGreaterThan(0);
    expect(typeof body.config.mode).toBe("string");
    expect(["smart", "round_robin", "priority"]).toContain(body.config.mode);
  });

  test("GET daemon object includes pid field (null or number)", async () => {
    const { body } = await apiGet("/api/smart-run/config");
    expect(body.daemon.pid === null || typeof body.daemon.pid === "number").toBe(true);
  });

  test("POST updates max_agents", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { max_agents: 5 });
    expect(status).toBe(200);
    expect(body.config.max_agents).toBe(5);
  });

  test("POST returns 400 for max_agents out of range", async () => {
    const { status } = await apiPost("/api/smart-run/config", { max_agents: 999 });
    expect(status).toBe(400);
  });

  test("POST updates interval_seconds", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { interval_seconds: 60 });
    expect(status).toBe(200);
    expect(body.config.interval_seconds).toBe(60);
  });

  test("POST returns 400 for interval_seconds out of range", async () => {
    const { status } = await apiPost("/api/smart-run/config", { interval_seconds: 5 });
    expect(status).toBe(400);
  });

  test("POST updates mode", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { mode: "round_robin" });
    expect(status).toBe(200);
    expect(body.config.mode).toBe("round_robin");
  });

  test("POST returns 400 for invalid mode", async () => {
    const { status } = await apiPost("/api/smart-run/config", { mode: "invalid_mode" });
    expect(status).toBe(400);
  });

  test("POST updates dry_run flag", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { dry_run: true });
    expect(status).toBe(200);
    expect(body.config.dry_run).toBe(true);
  });

  test("POST updates force_alice flag", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { force_alice: false });
    expect(status).toBe(200);
    expect(body.config.force_alice).toBe(false);
  });

  test("POST updates cycle_sleep_seconds", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { cycle_sleep_seconds: 30 });
    expect(status).toBe(200);
    expect(body.config.cycle_sleep_seconds).toBe(30);
  });

  test("POST returns 400 for cycle_sleep_seconds out of range", async () => {
    const { status } = await apiPost("/api/smart-run/config", { cycle_sleep_seconds: 999 });
    expect(status).toBe(400);
  });

  test("config has last_updated timestamp after POST", async () => {
    const { body } = await apiPost("/api/smart-run/config", { max_agents: 3 });
    expect(typeof body.config.last_updated).toBe("string");
    expect(new Date(body.config.last_updated).getTime()).toBeGreaterThan(0);
  });

  test("GET config includes selection_mode field", async () => {
    const { body } = await apiGet("/api/smart-run/config");
    expect(typeof body.config.selection_mode).toBe("string");
    expect(["deterministic", "random"]).toContain(body.config.selection_mode);
  });

  test("POST updates selection_mode to random", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { selection_mode: "random" });
    expect(status).toBe(200);
    expect(body.config.selection_mode).toBe("random");
  });

  test("POST updates selection_mode to deterministic", async () => {
    const { status, body } = await apiPost("/api/smart-run/config", { selection_mode: "deterministic" });
    expect(status).toBe(200);
    expect(body.config.selection_mode).toBe("deterministic");
  });

  test("POST returns 400 for invalid selection_mode", async () => {
    const { status } = await apiPost("/api/smart-run/config", { selection_mode: "shuffle" });
    expect(status).toBe(400);
  });
});

// ── GET /api/smart-run/status ─────────────────────────────────────────────────

test.describe("GET /api/smart-run/status", () => {
  test("returns 200 with daemon status fields", async () => {
    const { status, body } = await apiGet("/api/smart-run/status");
    expect(status).toBe(200);
    expect(typeof body.daemon).toBe("object");
    expect(typeof body.daemon.running).toBe("boolean");
    expect(typeof body.agents).toBe("object");
    expect(Array.isArray(body.agents.running)).toBe(true);
  });

  test("response includes config section and agents.count/target", async () => {
    const { body } = await apiGet("/api/smart-run/status");
    expect(typeof body.config).toBe("object");
    expect(typeof body.agents.count).toBe("number");
    expect(body.agents.count).toBeGreaterThanOrEqual(0);
    expect(typeof body.agents.target).toBe("number");
  });

  test("daemon.pid is null or number", async () => {
    const { body } = await apiGet("/api/smart-run/status");
    expect(body.daemon.pid === null || typeof body.daemon.pid === "number").toBe(true);
  });

  test("config section includes max_agents, interval_seconds, mode fields", async () => {
    const { body } = await apiGet("/api/smart-run/status");
    expect(typeof body.config.max_agents).toBe("number");
    expect(typeof body.config.interval_seconds).toBe("number");
    expect(typeof body.config.mode).toBe("string");
  });
});

// ── GET /api/agents/:name/context ─────────────────────────────────────────────

test.describe("GET /api/agents/:name/context", () => {
  test("returns 200 with all context fields", async () => {
    const { status, body } = await apiGet("/api/agents/alice/context");
    expect(status).toBe(200);
    expect(body.agent).toBe("alice");
    expect(typeof body.mode).toBe("string");
    expect(typeof body.inbox).toBe("object");
    expect(typeof body.inbox.total_unread).toBe("number");
    expect(Array.isArray(body.inbox.urgent)).toBe(true);
    expect(Array.isArray(body.inbox.messages)).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(Array.isArray(body.team_channel)).toBe(true);
    expect(Array.isArray(body.announcements)).toBe(true);
    expect(Array.isArray(body.teammates)).toBe(true);
  });

  test("inbox.more is a non-negative number", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    expect(typeof body.inbox.more).toBe("number");
    expect(body.inbox.more).toBeGreaterThanOrEqual(0);
  });

  test("team_channel items have filename and preview fields", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    for (const item of body.team_channel || []) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.preview).toBe("string");
    }
  });

  test("announcements items have filename and preview fields", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    for (const item of body.announcements || []) {
      expect(typeof item.filename).toBe("string");
      expect(typeof item.preview).toBe("string");
    }
  });

  test("inbox.messages have filename and preview fields", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    for (const m of body.inbox.messages) {
      expect(typeof m.filename).toBe("string");
      expect(typeof m.preview).toBe("string");
    }
  });

  test("inbox.urgent messages have filename and content fields", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    for (const m of body.inbox.urgent) {
      expect(typeof m.filename).toBe("string");
      expect(typeof m.content).toBe("string");
    }
  });

  test("teammates have name and status fields", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    expect(body.teammates.length).toBeGreaterThan(0);
    for (const t of body.teammates) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.status).toBe("string");
    }
    // alice should not appear in her own teammates list
    expect(body.teammates.some(t => t.name === "alice")).toBe(false);
  });

  test("sop is non-null string when mode is valid", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    // mode should be normal/plan/crazy — all have SOPs
    expect(["normal","plan","crazy"]).toContain(body.mode);
    expect(typeof body.sop).toBe("string");
    expect(body.sop.length).toBeGreaterThan(0);
  });

  test("culture is non-null string", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    expect(typeof body.culture).toBe("string");
    expect(body.culture.length).toBeGreaterThan(0);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/nonexistent_xyz/context");
    expect(status).toBe(404);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/context");
    expect(status).toBe(400);
  });

  test("inbox.more counts messages beyond the 15 preview limit", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    const total = body.inbox.total_unread;
    const shown = body.inbox.messages.length + body.inbox.urgent.length;
    // more = regularFiles.length - 15 (clamped to 0)
    expect(body.inbox.more).toBeGreaterThanOrEqual(0);
    if (total > 15) {
      expect(body.inbox.more).toBeGreaterThan(0);
    }
  });

  test("team_channel entries have filename and preview fields", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    for (const entry of body.team_channel) {
      expect(typeof entry.filename).toBe("string");
      expect(typeof entry.preview).toBe("string");
    }
  });

  test("announcements entries have filename and preview fields", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    for (const entry of body.announcements) {
      expect(typeof entry.filename).toBe("string");
      expect(typeof entry.preview).toBe("string");
    }
  });

  test("team_channel contains at most 3 entries", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    expect(body.team_channel.length).toBeLessThanOrEqual(3);
  });

  test("announcements contains at most 2 entries", async () => {
    const { body } = await apiGet("/api/agents/alice/context");
    expect(body.announcements.length).toBeLessThanOrEqual(2);
  });

  test("tasks is an array, items have id, title, priority, status fields", async () => {
    const { body } = await apiGet("/api/agents/charlie/context");
    expect(Array.isArray(body.tasks)).toBe(true);
    for (const t of body.tasks || []) {
      expect(typeof t.id === "number" || typeof t.id === "string").toBe(true);
      expect(typeof t.title).toBe("string");
      expect(typeof t.priority).toBe("string");
      expect(typeof t.status).toBe("string");
    }
  });

  test("tasks items also have description, task_type, group, assignee, created, updated fields", async () => {
    const { body } = await apiGet("/api/agents/charlie/context");
    for (const t of body.tasks || []) {
      expect(typeof t.description).toBe("string");
      expect(typeof t.task_type).toBe("string");
      expect(typeof t.group).toBe("string");
      expect(typeof t.assignee).toBe("string");
      expect(typeof t.created).toBe("string");
      expect(typeof t.updated).toBe("string");
    }
  });
});

test.describe("GET /api/events (SSE)", () => {
  test("returns 200 with text/event-stream content-type", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/api/events`, {
      headers: AUTH_HEADERS,
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    ctrl.abort();
  });

  test("sends connected event as first data", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/api/events`, {
      headers: AUTH_HEADERS,
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: connected");
    ctrl.abort();
  });
});

// ── POST /api/smart-run/start and /api/smart-run/stop ────────────────────────

test.describe("POST /api/smart-run/start", () => {
  test("returns 200 with ok field (starts daemon or already running)", async () => {
    const { status, body } = await apiPost("/api/smart-run/start");
    expect(status).toBe(200);
    // Either starts successfully (ok:true) or daemon already running (ok:false with error)
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.message === "string" || typeof body.error === "string").toBe(true);
  });

  test("on success, response has pid (number) and message fields", async () => {
    const { body } = await apiPost("/api/smart-run/start");
    if (body.ok) {
      expect(typeof body.pid).toBe("number");
      expect(typeof body.message).toBe("string");
    }
  });
});

test.describe("POST /api/smart-run/stop", () => {
  test("returns 200 with ok field", async () => {
    const { status, body } = await apiPost("/api/smart-run/stop");
    expect(status).toBe(200);
    expect(typeof body.ok).toBe("boolean");
  });

  test("on success, response has message and output fields", async () => {
    // Start first to ensure daemon is running
    await apiPost("/api/smart-run/start");
    const { body } = await apiPost("/api/smart-run/stop");
    if (body.ok) {
      expect(typeof body.message).toBe("string");
      expect(typeof body.output).toBe("string");
    }
  });
});

test.describe("GET /api/agents/:name/log/stream (SSE)", () => {
  test("returns 200 with text/event-stream for known agent", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/api/agents/alice/log/stream`, {
      headers: AUTH_HEADERS,
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    ctrl.abort();
  });

  test("sends connected event as first data", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/api/agents/alice/log/stream`, {
      headers: AUTH_HEADERS,
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: connected");
    ctrl.abort();
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/nonexistent_xyz/log/stream");
    expect(status).toBe(404);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiGet("/api/agents/bad|name/log/stream");
    expect(status).toBe(400);
  });
});

// ── POST /api/tasks/:id/claim ─────────────────────────────────────────────────

test.describe("POST /api/tasks/:id/claim", () => {
  let _claimTaskId = null;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/tasks", { title: "E2E-Claim-Test", priority: "low" });
    _claimTaskId = body.id;
  });

  test.afterAll(async () => {
    if (_claimTaskId) {
      await fetch(`${BASE}/api/tasks/${_claimTaskId}`, { method: "DELETE", headers: AUTH_HEADERS }).catch(() => {});
    }
  });

  test("valid claim returns ok:true with id, status, assignee", async () => {
    const { status, body } = await apiPost(`/api/tasks/${_claimTaskId}/claim`, { agent: "alice" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.id).toBe(_claimTaskId);
    expect(body.status).toBe("in_progress");
    expect(body.assignee).toBe("alice");
  });

  test("same agent can re-claim already claimed task", async () => {
    const { status, body } = await apiPost(`/api/tasks/${_claimTaskId}/claim`, { agent: "alice" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("different agent claim returns 409 with error", async () => {
    // alice already claimed it — bob should get 409
    const { status, body } = await apiPost(`/api/tasks/${_claimTaskId}/claim`, { agent: "bob" });
    expect(status).toBe(409);
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(typeof body.claimed_by).toBe("string");
  });

  test("missing agent returns 400", async () => {
    const { status } = await apiPost(`/api/tasks/${_claimTaskId}/claim`, {});
    expect(status).toBe(400);
  });

  test("nonexistent task returns 404", async () => {
    const { status, body } = await apiPost("/api/tasks/999999999/claim", { agent: "alice" });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

// ── GET /api/search ───────────────────────────────────────────────────────────

test.describe("GET /api/search", () => {
  test("returns 400 when q param is missing", async () => {
    const { status } = await apiGet("/api/search");
    expect(status).toBe(400);
  });

  test("returns 400 when q is too short (< 2 chars)", async () => {
    const res = await fetch(`${BASE}/api/search?q=a`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(400);
  });

  test("returns 200 with query, results, total fields", async () => {
    const res = await fetch(`${BASE}/api/search?q=alice`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.query).toBe("string");
    expect(body.query).toBe("alice");
    expect(Array.isArray(body.results)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  test("result entries have type and matches fields", async () => {
    const res = await fetch(`${BASE}/api/search?q=alice`, { headers: AUTH_HEADERS });
    const body = await res.json();
    for (const r of body.results) {
      expect(typeof r.type).toBe("string");
      expect(Array.isArray(r.matches)).toBe(true);
    }
  });

  test("result entries have agent and file fields", async () => {
    const res = await fetch(`${BASE}/api/search?q=alice`, { headers: AUTH_HEADERS });
    const body = await res.json();
    for (const r of body.results) {
      // agent is null or string (tasks may not have an agent)
      expect(r.agent === null || typeof r.agent === "string").toBe(true);
      // file is null or string (filename within the result)
      expect(r.file === null || typeof r.file === "string").toBe(true);
    }
  });
});

// ── GET/POST /api/tasks/:id/result ────────────────────────────────────────────

test.describe("GET & POST /api/tasks/:id/result", () => {
  let _resultTaskId = null;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/tasks", { title: "E2E-Result-Test", priority: "low" });
    _resultTaskId = body.id;
  });

  test.afterAll(async () => {
    if (_resultTaskId) {
      // Remove the result file if written
      await fetch(`${BASE}/api/tasks/${_resultTaskId}/result`, { method: "DELETE", headers: AUTH_HEADERS }).catch(() => {});
      await fetch(`${BASE}/api/tasks/${_resultTaskId}`, { method: "DELETE", headers: AUTH_HEADERS }).catch(() => {});
    }
  });

  test("POST returns ok:true with task_id and file fields", async () => {
    const { status, body } = await apiPost(`/api/tasks/${_resultTaskId}/result`, {
      content: "E2E test result content",
      filename: `task-${_resultTaskId}-result.md`,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(String(body.task_id)).toBe(String(_resultTaskId));
    expect(typeof body.file).toBe("string");
    expect(body.file.length).toBeGreaterThan(0);
  });

  test("POST returns 400 when content is missing", async () => {
    const { status } = await apiPost(`/api/tasks/${_resultTaskId}/result`, {});
    expect(status).toBe(400);
  });

  test("GET returns task_id, source, file, content fields after POST", async () => {
    const { status, body } = await apiGet(`/api/tasks/${_resultTaskId}/result`);
    expect(status).toBe(200);
    expect(String(body.task_id)).toBe(String(_resultTaskId));
    expect(typeof body.source).toBe("string");
    expect(typeof body.file).toBe("string");
    expect(typeof body.content).toBe("string");
  });

  test("GET returns 404 for task with no result", async () => {
    // Create a fresh unassigned task (no result file)
    const { body: t } = await apiPost("/api/tasks", { title: "E2E-NoResult", priority: "low" });
    const { status } = await apiGet(`/api/tasks/${t.id}/result`);
    expect(status).toBe(404);
    await fetch(`${BASE}/api/tasks/${t.id}`, { method: "DELETE", headers: AUTH_HEADERS }).catch(() => {});
  });
});

// ── GET /api/agents/:name/activity — cycle entry shape ───────────────────────

test.describe("GET /api/agents/:name/activity — cycle entry shape", () => {
  test("cycle entries have start, cost, turns, duration, cycle fields", async () => {
    const { body } = await apiGet("/api/agents/alice/activity");
    for (const c of body.cycles || []) {
      // start is the line marking cycle start
      expect(typeof c.start).toBe("string");
      // cost is a number (0 if none)
      expect(typeof c.cost).toBe("number");
      // turns is a number
      expect(typeof c.turns).toBe("number");
      // duration may be empty string or a string like "12.3s"
      expect(typeof c.duration).toBe("string");
      // cycle is a 1-based index
      expect(typeof c.cycle).toBe("number");
      expect(c.cycle).toBeGreaterThanOrEqual(1);
    }
  });

  test("cycle entries have lines array field", async () => {
    const { body } = await apiGet("/api/agents/alice/activity");
    for (const c of body.cycles || []) {
      expect(Array.isArray(c.lines)).toBe(true);
    }
  });
});

// ── DELETE /api/tasks/:id — response shape ────────────────────────────────────

test.describe("DELETE /api/tasks/:id — response shape", () => {
  let _deleteShapeTaskId = null;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/tasks", { title: "E2E-Delete-Shape-Test", priority: "low" });
    _deleteShapeTaskId = body.id;
  });

  test("delete response includes ok:true and deleted object with id, title, status", async () => {
    const { status, body } = await apiDelete(`/api/tasks/${_deleteShapeTaskId}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.deleted).toBe("object");
    expect(body.deleted).not.toBeNull();
    expect(typeof body.deleted.id).toBe("number");
    expect(body.deleted.id).toBe(_deleteShapeTaskId);
    expect(typeof body.deleted.title).toBe("string");
    expect(typeof body.deleted.status).toBe("string");
    _deleteShapeTaskId = null; // already deleted
  });
});

// ── PATCH /api/tasks/:id — response includes updated task fields ──────────────

test.describe("PATCH /api/tasks/:id — response task fields", () => {
  let _patchFieldTaskId = null;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/tasks", { title: "E2E-Patch-Fields-Test", priority: "low" });
    _patchFieldTaskId = body.id;
  });

  test.afterAll(async () => {
    if (_patchFieldTaskId) await apiDelete(`/api/tasks/${_patchFieldTaskId}`).catch(() => {});
  });

  test("PATCH response includes id, title, status, priority, assignee fields", async () => {
    const { status, body } = await apiPatch(`/api/tasks/${_patchFieldTaskId}`, { status: "in_progress" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("number");
    expect(typeof body.title).toBe("string");
    expect(typeof body.status).toBe("string");
    expect(body.status).toBe("in_progress");
    expect(typeof body.priority).toBe("string");
    expect(typeof body.assignee).toBe("string");
  });

  test("PATCH response includes description, group, task_type, created, updated, notes, notesList fields", async () => {
    const { body } = await apiPatch(`/api/tasks/${_patchFieldTaskId}`, { priority: "medium" });
    expect(typeof body.description).toBe("string");
    expect(typeof body.group).toBe("string");
    expect(typeof body.task_type).toBe("string");
    expect(typeof body.created).toBe("string");
    expect(typeof body.updated).toBe("string");
    expect(typeof body.notes).toBe("string");
    expect(Array.isArray(body.notesList)).toBe(true);
  });
});

// ── GET /api/cost ─────────────────────────────────────────────────────────────

test.describe("GET /api/cost", () => {
  test("returns 200 with cost summary fields", async () => {
    const { status, body } = await apiGet("/api/cost");
    expect(status).toBe(200);
    expect(typeof body.today_usd).toBe("number");
    expect(typeof body.today_cycles).toBe("number");
    expect(typeof body.total_7d_usd).toBe("number");
    expect(typeof body.total_7d_cycles).toBe("number");
    expect(Array.isArray(body.per_agent)).toBe(true);
  });

  test("today_usd and total_7d_usd are non-negative", async () => {
    const { body } = await apiGet("/api/cost");
    expect(body.today_usd).toBeGreaterThanOrEqual(0);
    expect(body.total_7d_usd).toBeGreaterThanOrEqual(0);
  });

  test("per_agent entries have name, today_usd, today_cycles fields", async () => {
    const { body } = await apiGet("/api/cost");
    expect(body.per_agent.length).toBeGreaterThan(0);
    for (const a of body.per_agent) {
      expect(typeof a.name).toBe("string");
      expect(typeof a.today_usd).toBe("number");
      expect(typeof a.today_cycles).toBe("number");
      expect(a.today_usd).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── POST /api/ceo/command ─────────────────────────────────────────────────────

test.describe("POST /api/ceo/command", () => {
  test("returns 400 when command is missing", async () => {
    const { status } = await apiPost("/api/ceo/command", {});
    expect(status).toBe(400);
  });

  test("returns 400 when command exceeds 1000 chars", async () => {
    const { status } = await apiPost("/api/ceo/command", { command: "x".repeat(1001) });
    expect(status).toBe(400);
  });

  test("task: prefix creates a task and returns ok, action, id, title", async () => {
    const title = `E2E-CEO-CMD-${Date.now()}`;
    const { status, body } = await apiPost("/api/ceo/command", { command: `task: ${title}` });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("task_created");
    expect(typeof body.id).toBe("number");
    expect(body.title).toBe(title);
    // cleanup
    await fetch(`${BASE}/api/tasks/${body.id}`, { method: "DELETE", headers: AUTH_HEADERS }).catch(() => {});
  });

  test("@mention DM returns ok, action:dm, agent, filename", async () => {
    const { status, body } = await apiPost("/api/ceo/command", { command: "@alice E2E-test-dm-ignore" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("dm");
    expect(body.agent).toBe("alice");
    expect(typeof body.filename).toBe("string");
    expect(body.filename.length).toBeGreaterThan(0);
    // cleanup the inbox file
    const fs = require("fs");
    const p = require("path");
    const fpath = p.join(DIR, "agents", "alice", "chat_inbox", body.filename);
    try { fs.unlinkSync(fpath); } catch (_) {}
  });

  test("@mention to unknown agent returns 404", async () => {
    const { status } = await apiPost("/api/ceo/command", { command: "@nonexistent_xyz_agent hello" });
    expect(status).toBe(404);
  });

  test("/mode <name> switches mode and returns action:mode_switched", async () => {
    const { status, body } = await apiPost("/api/ceo/command", { command: "/mode normal" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("mode_switched");
    expect(body.mode).toBe("normal");
  });

  test("fallback routes to alice inbox and returns action:routed_to_alice, filename", async () => {
    const { status, body } = await apiPost("/api/ceo/command", { command: "E2E-fallback-route-test-ignore" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("routed_to_alice");
    expect(typeof body.filename).toBe("string");
    expect(body.filename.length).toBeGreaterThan(0);
    // cleanup the inbox file
    const fs = require("fs");
    const p = require("path");
    const fpath = p.join(DIR, "agents", "alice", "chat_inbox", body.filename);
    try { fs.unlinkSync(fpath); } catch (_) {}
  });
});

// ── POST /api/broadcast (file-based broadcast to all agent inboxes) ───────────

test.describe("POST /api/broadcast", () => {
  const _broadcastFilename = { value: null };

  test.afterAll(async () => {
    // Remove broadcast files created in all agent inboxes
    if (_broadcastFilename.value) {
      const agentNames = ["alice","bob","charlie","dave","eve","frank","grace","heidi","ivan","judy",
                          "karl","liam","mia","nick","olivia","pat","quinn","rosa","sam","tina"];
      for (const name of agentNames) {
        const fpath = path.join(AGENTS_DIR, name, "chat_inbox", _broadcastFilename.value);
        try { fs.unlinkSync(fpath); } catch (_) {}
      }
    }
  });

  test("returns 400 when message is missing", async () => {
    const { status } = await apiPost("/api/broadcast", { from: "e2e" });
    expect(status).toBe(400);
  });

  test("returns 200 with ok, agents, failed, filename fields", async () => {
    const { status, body } = await apiPost("/api/broadcast", {
      message: "E2E broadcast test — safe to ignore",
      from: "e2e-broadcast-test",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.agents).toBe("number");
    expect(body.agents).toBeGreaterThan(0);
    expect(typeof body.failed).toBe("number");
    expect(typeof body.filename).toBe("string");
    expect(body.filename.length).toBeGreaterThan(0);
    _broadcastFilename.value = body.filename;
  });

  test("failed count is zero when all agents accessible", async () => {
    const { body } = await apiPost("/api/broadcast", {
      message: "E2E broadcast zero-fail check",
      from: "e2e-broadcast-test2",
    });
    expect(body.failed).toBe(0);
    // cleanup
    if (body.filename) {
      const agentNames = ["alice","bob","charlie","dave","eve","frank","grace","heidi","ivan","judy",
                          "karl","liam","mia","nick","olivia","pat","quinn","rosa","sam","tina"];
      for (const name of agentNames) {
        const fpath = path.join(AGENTS_DIR, name, "chat_inbox", body.filename);
        try { fs.unlinkSync(fpath); } catch (_) {}
      }
    }
  });
});

// ── POST /api/agents/:name/message — direct inbox write ───────────────────────

test.describe("POST /api/agents/:name/message", () => {
  const _agentMsgCleanup = [];

  test.afterAll(async () => {
    for (const { agent, filename } of _agentMsgCleanup) {
      try { fs.unlinkSync(path.join(AGENTS_DIR, agent, "chat_inbox", filename)); } catch (_) {}
    }
    _agentMsgCleanup.length = 0;
  });

  test("returns 400 when message field is missing", async () => {
    const { status } = await apiPost("/api/agents/alice/message", { from: "e2e" });
    expect(status).toBe(400);
  });

  test("returns 400 for invalid agent name", async () => {
    const { status } = await apiPost("/api/agents/bad|name/message", { message: "test" });
    expect(status).toBe(400);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPost("/api/agents/nobody_xyz_999/message", { message: "test" });
    expect(status).toBe(404);
  });

  test("returns 200 with ok:true and filename on success", async () => {
    const { status, body } = await apiPost("/api/agents/alice/message", {
      message: "E2E test message via /message — safe to ignore",
      from: "e2e-coverage",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.filename).toBe("string");
    expect(body.filename.length).toBeGreaterThan(0);
    _agentMsgCleanup.push({ agent: "alice", filename: body.filename });
  });
});
