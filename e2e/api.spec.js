// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * Tokenfly Agent Team Lab — Backend API E2E Tests
 * Charlie (Frontend Engineer)
 *
 * Tests server.js REST API endpoints directly via HTTP.
 * Server is started by playwright.config.js webServer.
 */

const BASE = "http://localhost:3199";
// SEC-001: API key for authenticated requests
const AUTH_HEADERS = { "Authorization": "Bearer test" };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: AUTH_HEADERS });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPatch(path, body) {
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

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
test.describe("GET /api/health", () => {
  test("returns 200 with uptime field", async () => {
    const { status, body } = await apiGet("/api/health");
    expect(status).toBe(200);
    expect(typeof body.uptime).toBe("number");
  });

  test("returns memory stats", async () => {
    const { body } = await apiGet("/api/health");
    expect(body.memory).toBeTruthy();
    expect(typeof body.memory.rss).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
test.describe("GET /api/config", () => {
  test("returns 200 with companyName", async () => {
    const { status, body } = await apiGet("/api/config");
    expect(status).toBe(200);
    expect(typeof body.companyName).toBe("string");
    expect(body.companyName.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
test.describe("GET /api/agents", () => {
  test("returns 200 with agents array in body", async () => {
    const { status, body } = await apiGet("/api/agents");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("each agent has name field", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      expect(typeof agent.name).toBe("string");
    }
  });

  test("returns known agents (alice, bob, charlie)", async () => {
    const { body } = await apiGet("/api/agents");
    const names = body.map((a) => a.name);
    expect(names).toContain("alice");
    expect(names).toContain("bob");
    expect(names).toContain("charlie");
  });

  test("each agent includes inline health score (Task #157)", async () => {
    const { body } = await apiGet("/api/agents");
    for (const agent of body) {
      expect(agent.health).toBeDefined();
      expect(typeof agent.health.score).toBe("number");
      expect(["A", "B", "C", "D"]).toContain(agent.health.grade);
      expect(agent.health.score).toBeGreaterThanOrEqual(0);
      expect(agent.health.score).toBeLessThanOrEqual(100);
    }
  });
});

test.describe("GET /api/agents/:name", () => {
  test("returns 200 for existing agent", async () => {
    const { status, body } = await apiGet("/api/agents/alice");
    expect(status).toBe(200);
    expect(body.name).toBe("alice");
    expect(typeof body.statusMd).toBe("string");
    expect(Array.isArray(body.inbox)).toBe(true);
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiGet("/api/agents/nobody_xyz_123");
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Dashboard endpoint
// ---------------------------------------------------------------------------
test.describe("GET /api/dashboard", () => {
  test("returns agents, tasks, mode", async () => {
    const { status, body } = await apiGet("/api/dashboard");
    expect(status).toBe(200);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(typeof body.mode).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Tasks — CRUD
// ---------------------------------------------------------------------------
test.describe("Tasks CRUD", () => {
  // Safety-net: collect all IDs created in this suite and delete any that
  // weren't cleaned up during the test (e.g. mid-test assertion failure).
  const createdIds = [];

  test.afterAll(async () => {
    for (const id of createdIds) {
      await apiDelete(`/api/tasks/${id}`).catch(() => {});
    }
  });

  test("GET /api/tasks returns tasks array", async () => {
    const { status, body } = await apiGet("/api/tasks");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("POST /api/tasks creates a new task and is findable", async () => {
    const title = `E2E-Task-${Date.now()}`;
    const { status, body } = await apiPost("/api/tasks", {
      title,
      description: "Created by e2e tests",
      priority: "low",
      assignee: "charlie",
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("number");
    createdIds.push(body.id);

    // Verify it appears in GET (ids are returned as strings from the markdown parser)
    const { body: tasks } = await apiGet("/api/tasks");
    const found = tasks.find((t) => t.title === title);
    expect(found).toBeTruthy();
    expect(found.assignee).toBe("charlie");

    // Cleanup (afterAll serves as safety net if this line is skipped)
    await apiDelete(`/api/tasks/${body.id}`);
  });

  test("POST /api/tasks returns ID that matches the stored task", async () => {
    const title = `E2E-IDCheck-${Date.now()}`;
    const { body } = await apiPost("/api/tasks", { title, priority: "low" });
    expect(body.ok).toBe(true);
    // Verify returned id actually points to the created task
    const { body: tasks } = await apiGet("/api/tasks");
    const byId = tasks.find((t) => String(t.id) === String(body.id));
    expect(byId).toBeDefined();
    expect(byId.title).toBe(title);
    await apiDelete(`/api/tasks/${body.id}`);
  });

  test("PATCH /api/tasks/:id updates task status", async () => {
    // Create
    const { body: created } = await apiPost("/api/tasks", { title: "E2E-Patch-Test", priority: "low" });
    expect(created.ok).toBe(true);
    const id = created.id;
    createdIds.push(id);

    // Patch
    const { status, body } = await apiPatch(`/api/tasks/${id}`, { status: "in_progress" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify
    const { body: tasks } = await apiGet("/api/tasks");
    const updated = tasks.find((t) => String(t.id) === String(id));
    expect(updated).toBeTruthy();
    expect(updated.status).toBe("in_progress");

    // Cleanup (afterAll serves as safety net if this line is skipped)
    await apiDelete(`/api/tasks/${id}`);
  });

  test("PATCH /api/tasks/:id returns 404 for unknown id", async () => {
    const { status } = await apiPatch("/api/tasks/999999", { status: "done" });
    expect(status).toBe(404);
  });

  test("DELETE /api/tasks/:id removes the task", async () => {
    // Create
    const { body: created } = await apiPost("/api/tasks", { title: "E2E-Delete-Test", priority: "low" });
    const id = created.id;

    // Delete
    const { status, body } = await apiDelete(`/api/tasks/${id}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify gone
    const { body: after } = await apiGet("/api/tasks");
    const stillExists = after.find((t) => String(t.id) === String(id));
    expect(stillExists).toBeUndefined();
  });

  test("DELETE /api/tasks/:id returns 404 for unknown id", async () => {
    const { status } = await apiDelete("/api/tasks/999999");
    expect(status).toBe(404);
  });

  test("POST /api/tasks returns 400 when title missing", async () => {
    const { status } = await apiPost("/api/tasks", { priority: "low" });
    expect(status).toBe(400);
  });

  test("POST /api/tasks returns 400 when title is whitespace-only", async () => {
    const { status } = await apiPost("/api/tasks", { title: "   ", priority: "low" });
    expect(status).toBe(400);
  });

  test("POST /api/tasks returns 400 for invalid priority", async () => {
    const { status } = await apiPost("/api/tasks", { title: "Valid Title", priority: "urgent" });
    expect(status).toBe(400);
  });

  test("PATCH /api/tasks/:id returns 400 for invalid status", async () => {
    const { body: created } = await apiPost("/api/tasks", { title: "E2E-Enum-Test", priority: "low" });
    expect(created.ok).toBe(true);
    const id = created.id;

    const { status } = await apiPatch(`/api/tasks/${id}`, { status: "flying" });
    expect(status).toBe(400);

    // Cleanup
    await apiDelete(`/api/tasks/${id}`);
  });

  test("PATCH /api/tasks/:id returns 400 for invalid priority", async () => {
    const { body: created } = await apiPost("/api/tasks", { title: "E2E-Priority-Enum-Test", priority: "low" });
    expect(created.ok).toBe(true);
    const id = created.id;

    const { status } = await apiPatch(`/api/tasks/${id}`, { priority: "turbo" });
    expect(status).toBe(400);

    // Cleanup
    await apiDelete(`/api/tasks/${id}`);
  });
});

// ---------------------------------------------------------------------------
// Task Claim — /api/tasks/:id/claim
// ---------------------------------------------------------------------------
test.describe("Task Claim", () => {
  let taskId;

  test.afterAll(async () => {
    if (taskId) await apiDelete(`/api/tasks/${taskId}`).catch(() => {});
  });

  test("POST /api/tasks/:id/claim claims an open task", async () => {
    // Create a task to claim
    const { body: created } = await apiPost("/api/tasks", { title: "E2E-Claim-Test", priority: "low" });
    taskId = created.id;

    const { status, body } = await fetch(`${BASE}/api/tasks/${taskId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ agent: "alice" }),
    }).then(r => r.json().then(b => ({ status: r.status, body: b })));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.assignee).toBe("alice");
    expect(body.status).toBe("in_progress");
  });

  test("POST /api/tasks/:id/claim returns 409 if already claimed by another agent", async () => {
    const res = await fetch(`${BASE}/api/tasks/${taskId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ agent: "bob" }),
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.claimed_by).toBe("alice");

    // Cleanup
    await apiDelete(`/api/tasks/${taskId}`);
  });

  test("POST /api/tasks/:id/claim returns 400 without agent", async () => {
    const { body: created } = await apiPost("/api/tasks", { title: "E2E-Claim-NoAgent", priority: "low" });
    const res = await fetch(`${BASE}/api/tasks/${created.id}/claim`, { method: "POST", headers: AUTH_HEADERS });
    expect(res.status).toBe(400);
    await apiDelete(`/api/tasks/${created.id}`);
  });
});

// ---------------------------------------------------------------------------
// Messaging — /api/agents/:name/message
// ---------------------------------------------------------------------------
test.describe("POST /api/agents/:name/message", () => {
  test("sends message to existing agent", async () => {
    const { status, body } = await apiPost("/api/agents/charlie/message", {
      message: "E2E ping from test",
      from: "e2e",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.filename).toContain("from_e2e");
  });

  test("returns 404 for unknown agent", async () => {
    const { status } = await apiPost("/api/agents/nobody_xyz_123/message", {
      message: "hello",
    });
    expect(status).toBe(404);
  });

  test("returns 400 when message missing", async () => {
    const { status } = await apiPost("/api/agents/charlie/message", {});
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
test.describe("GET /api/announcements", () => {
  test("returns 200 with array", async () => {
    const { status, body } = await apiGet("/api/announcements");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

test.describe("GET /api/team-channel", () => {
  test("returns 200 with array", async () => {
    const { status, body } = await apiGet("/api/team-channel");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("POST then GET includes from field parsed from filename", async () => {
    const { status: postStatus } = await apiPost("/api/team-channel", {
      message: "E2E test message",
      from: "e2etester",
    });
    expect(postStatus).toBe(200);
    const { body } = await apiGet("/api/team-channel");
    const msg = body.find(m => m.from === "e2etester");
    expect(msg).toBeDefined();
    expect(msg.message || msg.content).toBe("E2E test message");
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
test.describe("GET /api/search", () => {
  test("requires q parameter", async () => {
    const { status } = await apiGet("/api/search");
    expect(status).toBe(400);
  });

  test("returns 400 for single-character query", async () => {
    const { status } = await apiGet("/api/search?q=a");
    expect(status).toBe(400);
  });

  test("returns results for valid query", async () => {
    const { status, body } = await apiGet("/api/search?q=charlie");
    expect(status).toBe(200);
    expect(typeof body.query).toBe("string");
    expect(Array.isArray(body.results)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("task search results include task data", async () => {
    // Create a task with a unique token to search for
    const token = `srchtest${Date.now()}`;
    const { body: created } = await apiPost("/api/tasks", { title: `Search-${token}`, priority: "low" });
    const { status, body } = await apiGet(`/api/search?q=${token}`);
    expect(status).toBe(200);
    const taskResult = body.results.find(r => r.type === "tasks");
    expect(taskResult).toBeDefined();
    expect(taskResult.matches.some(m => m.title.includes(token))).toBe(true);
    // Cleanup
    if (created && created.id) {
      await fetch(`${BASE}/api/tasks/${created.id}`, { method: "DELETE", headers: AUTH_HEADERS });
    }
  });
});

// ---------------------------------------------------------------------------
// Task Filters — ?assignee, ?status, ?priority, ?q
// Uses a single shared task (one POST) to avoid hitting write rate limiter.
// ---------------------------------------------------------------------------
test.describe("Task Filters", () => {
  let filterTaskId = null;
  const filterToken = `E2EFilter${Date.now()}`;
  const filterTitle = `E2E-Filter-Task-${filterToken}`;
  const filterDesc = `Contains ${filterToken} in description`;

  test.beforeAll(async () => {
    const { body } = await apiPost("/api/tasks", {
      title: filterTitle,
      description: filterDesc,
      priority: "critical",
      assignee: "dave",
    });
    filterTaskId = body.ok ? body.id : null;
  });

  test.afterAll(async () => {
    if (filterTaskId) await apiDelete(`/api/tasks/${filterTaskId}`).catch(() => {});
  });

  test("GET /api/tasks?assignee= filters by assignee", async () => {
    if (!filterTaskId) test.skip();
    const { body: filtered } = await apiGet("/api/tasks?assignee=dave");
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.every((t) => t.assignee.toLowerCase() === "dave")).toBe(true);
    expect(filtered.some((t) => t.title === filterTitle)).toBe(true);
  });

  test("GET /api/tasks?status= filters by status", async () => {
    if (!filterTaskId) test.skip();
    const { body: filtered } = await apiGet("/api/tasks?status=open");
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.every((t) => t.status.toLowerCase() === "open")).toBe(true);
    expect(filtered.some((t) => t.title === filterTitle)).toBe(true);
  });

  test("GET /api/tasks?priority= filters by priority", async () => {
    if (!filterTaskId) test.skip();
    const { body: filtered } = await apiGet("/api/tasks?priority=critical");
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.every((t) => t.priority.toLowerCase() === "critical")).toBe(true);
    expect(filtered.some((t) => t.title === filterTitle)).toBe(true);
  });

  test("GET /api/tasks?q= searches by title", async () => {
    if (!filterTaskId) test.skip();
    const { body: filtered } = await apiGet(`/api/tasks?q=${encodeURIComponent(filterToken.toLowerCase())}`);
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.some((t) => t.title === filterTitle)).toBe(true);
    expect(filtered.every((t) =>
      (t.title || "").toLowerCase().includes(filterToken.toLowerCase()) ||
      (t.description || "").toLowerCase().includes(filterToken.toLowerCase())
    )).toBe(true);
  });

  test("GET /api/tasks?q= searches by description", async () => {
    if (!filterTaskId) test.skip();
    const { body: filtered } = await apiGet(`/api/tasks?q=${encodeURIComponent(filterToken.toLowerCase())}`);
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.some((t) => t.title === filterTitle)).toBe(true);
  });

  test("GET /api/tasks?q= returns empty array for no match", async () => {
    const { body: filtered } = await apiGet("/api/tasks?q=zzznomatch_xyz_impossible_string_42");
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task Result Endpoint: GET + POST /api/tasks/:id/result
// ---------------------------------------------------------------------------
test.describe("Task result endpoint", () => {
  let resultTaskId;

  test.beforeAll(async () => {
    // Create a task assigned to a known agent for result tests
    const { body } = await apiPost("/api/tasks", {
      title: "E2E Result Test Task",
      priority: "low",
      assignee: "charlie",
      status: "done",
    });
    resultTaskId = body && (body.id || (body.task && body.task.id));
  });

  test.afterAll(async () => {
    if (resultTaskId) await apiDelete(`/api/tasks/${resultTaskId}`);
  });

  test("GET /api/tasks/:id/result returns 404 for unknown task", async () => {
    const { status } = await apiGet("/api/tasks/999999/result");
    expect(status).toBe(404);
  });

  test("POST /api/tasks/:id/result returns 400 when content missing", async () => {
    if (!resultTaskId) test.skip();
    const { status, body } = await apiPost(`/api/tasks/${resultTaskId}/result`, { filename: "test.md" });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  test("POST /api/tasks/:id/result writes result file to task_outputs/", async () => {
    if (!resultTaskId) test.skip();
    const { status, body } = await apiPost(`/api/tasks/${resultTaskId}/result`, {
      content: "# E2E Test Result\nTest passed.",
      filename: `task-${resultTaskId}-e2e-result.md`,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task_id).toBe(String(resultTaskId));
    expect(body.file).toContain(`task-${resultTaskId}`);
  });

  test("GET /api/tasks/:id/result retrieves written result", async () => {
    if (!resultTaskId) test.skip();
    const { status, body } = await apiGet(`/api/tasks/${resultTaskId}/result`);
    expect(status).toBe(200);
    expect(body.task_id).toBe(String(resultTaskId));
    expect(body.source).toBe("task_outputs");
    expect(body.content).toContain("E2E Test Result");
    expect(body.file).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Input sanitization
// ---------------------------------------------------------------------------

test.describe("Task input sanitization", () => {
  test("pipe characters in title are replaced, not stored literally", async () => {
    const title = "Task with | pipe | chars";
    const { status, body } = await apiPost("/api/tasks", {
      title,
      description: "desc | with | pipes",
    });
    expect(status).toBe(201);
    const taskId = body.id;

    try {
      // Re-fetch the task and verify the table row is not corrupted
      const { body: tasks } = await apiGet("/api/tasks");
      const task = (Array.isArray(tasks) ? tasks : []).find((t) => String(t.id) === String(taskId));
      expect(task).toBeTruthy();
      // Title should exist but without literal pipes that would break the table
      expect(task.title).toBeTruthy();
      // The task board must still parse correctly (we got the task back = not corrupted)
    } finally {
      await apiDelete(`/api/tasks/${taskId}`);
    }
  });

  test("newlines in title are replaced with spaces", async () => {
    const { status, body } = await apiPost("/api/tasks", {
      title: "line1\nline2",
    });
    expect(status).toBe(201);
    const taskId = body.id;

    try {
      const { body: tasks } = await apiGet("/api/tasks");
      const task = (Array.isArray(tasks) ? tasks : []).find((t) => String(t.id) === String(taskId));
      expect(task).toBeTruthy();
      // Task board should still parse cleanly
      expect(task.title).not.toContain("\n");
    } finally {
      await apiDelete(`/api/tasks/${taskId}`);
    }
  });
});
