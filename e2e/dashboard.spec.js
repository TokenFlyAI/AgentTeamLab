// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * Tokenfly Agent Team Lab — Dashboard UI E2E Tests
 * Charlie (Frontend Engineer)
 *
 * Tests the index_lite.html dashboard served by server.js.
 */

const AUTH_HEADERS = { "Authorization": "Bearer test" };

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------
test.describe("Dashboard loads", () => {
  test("page title is TokenFly Agent Planet", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("TokenFly Agent Planet");
  });

  test("company name is shown in topbar", async ({ page }) => {
    await page.goto("/");
    const name = page.locator(".company-name").first();
    await expect(name).toBeVisible();
    await expect(name).toContainText("Tokenfly");
  });

  test("connection status dot is visible", async ({ page }) => {
    await page.goto("/");
    const dot = page.locator(".status-dot").first();
    await expect(dot).toBeVisible();
  });

  test("tab bar is rendered with all expected tabs", async ({ page }) => {
    await page.goto("/");
    const tabLabels = ["Agents", "Missions", "Chat", "News", "Facts", "Stats", "Live Tail", "Lord's Inbox"];
    for (const label of tabLabels) {
      const btn = page.locator(`button.tab-btn`, { hasText: label });
      await expect(btn).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------
test.describe("Tab navigation", () => {
  test("Agents tab is active by default", async ({ page }) => {
    await page.goto("/");
    const agentsBtn = page.locator('button.tab-btn[data-tab="agents"]');
    await expect(agentsBtn).toHaveClass(/active/);
    await expect(page.locator("#tab-agents")).toBeVisible();
  });

  test("clicking Missions tab shows missions panel", async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="tasks"]');
    await expect(page.locator("#tab-tasks")).toBeVisible();
    await expect(page.locator("#tab-agents")).not.toBeVisible();
  });

  test("clicking Chat tab shows chat panel", async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="chat"]');
    await expect(page.locator("#tab-chat")).toBeVisible();
  });

  test("clicking News tab shows announcements panel", async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="announcements"]');
    await expect(page.locator("#tab-announcements")).toBeVisible();
  });

  test("clicking Stats tab shows stats panel", async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="stats"]');
    await expect(page.locator("#tab-stats")).toBeVisible();
  });

  test("clicking Live Tail tab shows log viewer", async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="livetail"]');
    await expect(page.locator("#tab-livetail")).toBeVisible();
    await expect(page.locator("#log-viewer")).toBeVisible();
  });

  test("clicking Lord's Inbox tab shows Lord's inbox panel", async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="ceo-inbox"]');
    await expect(page.locator("#tab-ceo-inbox")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------
test.describe("Agents tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for agent cards to load
    await page.waitForFunction(() => {
      const grid = document.getElementById("agent-grid");
      return grid && grid.children.length > 0;
    }, { timeout: 10000 });
  });

  test("agent grid renders cards", async ({ page }) => {
    const cards = page.locator(".agent-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("agent cards show agent names", async ({ page }) => {
    const names = page.locator(".agent-name");
    const count = await names.count();
    expect(count).toBeGreaterThan(0);
    // At least one should be "alice" or "charlie"
    const allText = await names.allTextContents();
    const lower = allText.map((t) => t.toLowerCase().trim());
    // Use includes() since the agent-name element may contain badge child text
    expect(lower.some((n) => ["alice", "bob", "charlie"].some((ag) => n.startsWith(ag)))).toBe(true);
  });

  test("filter buttons are visible", async ({ page }) => {
    await expect(page.locator('button.filter-btn[data-filter="all"]')).toBeVisible();
    await expect(page.locator('button.filter-btn[data-filter="active"]')).toBeVisible();
    await expect(page.locator('button.filter-btn[data-filter="offline"]')).toBeVisible();
  });

  test("All filter is active by default", async ({ page }) => {
    const allBtn = page.locator('button.filter-btn[data-filter="all"]');
    await expect(allBtn).toHaveClass(/active/);
  });

  test("Smart Start button is visible", async ({ page }) => {
    const btn = page.locator("button", { hasText: "Smart Start" });
    await expect(btn).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------
test.describe("Global search", () => {
  test("search input is visible", async ({ page }) => {
    await page.goto("/");
    const input = page.locator("#global-search-input");
    await expect(input).toBeVisible();
  });

  test("pressing / focuses the search input", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    const input = page.locator("#global-search-input");
    await expect(input).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// Tasks tab — UI
// ---------------------------------------------------------------------------
test.describe("Tasks tab — UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="tasks"]');
  });

  test("task create form is visible", async ({ page }) => {
    await expect(page.locator("#task-create-form")).toBeVisible();
    await expect(page.locator("#task-title")).toBeVisible();
    await expect(page.locator("#task-priority")).toBeVisible();
  });

  test("task table headers are rendered", async ({ page }) => {
    const headers = page.locator(".task-table th");
    const count = await headers.count();
    expect(count).toBeGreaterThan(3);
  });

  test("task search input is visible", async ({ page }) => {
    await expect(page.locator("#task-search")).toBeVisible();
  });

  test("status filter dropdown has expected options", async ({ page }) => {
    const select = page.locator("#task-filter-status");
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options).toContain("Open");
    expect(options).toContain("In Progress");
    expect(options).toContain("Done");
  });

  test("creating a task adds it to the table", async ({ page }) => {
    const testTitle = `E2E-UI-${Date.now()}`;
    await page.fill("#task-title", testTitle);
    await page.selectOption("#task-priority", "low");
    await page.click('button.submit-btn', { hasText: "Create Task" });
    // Wait for table update
    await page.waitForFunction(
      (title) => document.body.innerText.includes(title),
      testTitle,
      { timeout: 8000 }
    );
    await expect(page.locator("#task-tbody")).toContainText(testTitle);

    // Cleanup: delete the test task via API
    const tasks = await fetch("http://localhost:3199/api/tasks", { headers: AUTH_HEADERS }).then((r) => r.json());
    const task = tasks.find((t) => t.title === testTitle);
    if (task) {
      await fetch(`http://localhost:3199/api/tasks/${task.id}`, { method: "DELETE", headers: AUTH_HEADERS });
    }
  });
});

// ---------------------------------------------------------------------------
// Chat tab — UI
// ---------------------------------------------------------------------------
test.describe("Chat tab — UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="chat"]');
  });

  test("chat messages area is visible", async ({ page }) => {
    await expect(page.locator("#chat-messages")).toBeVisible();
  });

  test("chat input textarea is visible", async ({ page }) => {
    await expect(page.locator("#chat-input")).toBeVisible();
  });

  test("from field defaults to Lord", async ({ page }) => {
    const fromInput = page.locator("#chat-from");
    await expect(fromInput).toHaveValue("Lord");
  });

  test("send button is visible", async ({ page }) => {
    const btn = page.locator(".chat-input-area button.submit-btn");
    await expect(btn).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Topbar controls
// ---------------------------------------------------------------------------
test.describe("Topbar controls", () => {
  test("Broadcast button is visible", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator("#broadcast-btn");
    await expect(btn).toBeVisible();
  });

  test("Mode Switch button is visible", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator("#mode-switch-btn");
    await expect(btn).toBeVisible();
  });

  test("mode badge is visible", async ({ page }) => {
    await page.goto("/");
    const badge = page.locator("#mode-badge");
    await expect(badge).toBeVisible();
  });

  test("Ctrl+K button is visible", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator("#cmd-palette-btn");
    await expect(btn).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
test.describe("Keyboard shortcuts", () => {
  test("Ctrl+K opens command palette", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await expect(page.locator(".cmd-palette-overlay")).toHaveClass(/visible/);
  });

  test("Escape closes command palette", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await expect(page.locator(".cmd-palette-overlay")).toHaveClass(/visible/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".cmd-palette-overlay")).not.toHaveClass(/visible/);
  });
});

// ---------------------------------------------------------------------------
// Announcements tab
// ---------------------------------------------------------------------------
test.describe("News tab — UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.click('button.tab-btn[data-tab="announcements"]');
  });

  test("announcement create form is visible", async ({ page }) => {
    await expect(page.locator("#ann-title")).toBeVisible();
    await expect(page.locator("#ann-body")).toBeVisible();
  });

  test("from field defaults to CEO", async ({ page }) => {
    await expect(page.locator("#ann-from")).toHaveValue("Lord");
  });
});
