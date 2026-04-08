// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const BASE_URL = "http://localhost:3199";
const API_KEY = process.env.API_KEY || "test";
const AUTH_HEADERS = { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function apiPost(endpoint, body = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

async function apiGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, { headers: AUTH_HEADERS });
  return res.json().catch(() => ({}));
}

/**
 * Smart Run UI — button state persistence + running agents visibility
 *
 * Tests the two bugs we just fixed:
 * 1. Button stays "🟢 Stop" on refresh when agents are running
 * 2. Running agent names are visible in the fleet panel
 */

const DIR = path.resolve(__dirname, "..");
function _resolvePlanetDir(dir) { const pj = path.join(dir, "planet.json"); if (fs.existsSync(pj)) { try { const { active, planets_dir } = JSON.parse(fs.readFileSync(pj, "utf8")); const pd = path.join(dir, planets_dir || "planets", active); if (fs.existsSync(pd)) return pd; } catch (_) {} } return dir; }
const AGENTS_DIR = path.join(_resolvePlanetDir(DIR), "agents");
const ALL_AGENTS = ["alice","bob","charlie","dave","eve","frank","grace","heidi","ivan","judy","karl","liam","mia","nick","olivia","pat","quinn","rosa","sam","tina"];

async function resetAllHeartbeats() {
  await Promise.all(ALL_AGENTS.map(name => resetHeartbeat(name)));
}

async function setHeartbeat(agentName, status) {
  // Use the API endpoint so the server's agent_list cache is invalidated immediately.
  // Fallback to direct file write if the server is not running (e.g. beforeAll setup).
  try {
    const res = await fetch(`${BASE_URL}/api/agents/${agentName}/heartbeat`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ status }),
    });
    if (res.ok) return;
  } catch (_) {}
  // Fallback: direct file write
  const hbPath = path.join(AGENTS_DIR, agentName, "heartbeat.md");
  fs.writeFileSync(
    hbPath,
    [`status: ${status}`, `agent: ${agentName}`, `timestamp: ${new Date().toISOString()}`, `cycle: 1`, ""].join("\n")
  );
}

async function resetHeartbeat(agentName) {
  try {
    const res = await fetch(`${BASE_URL}/api/agents/${agentName}/heartbeat`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ status: "idle" }),
    });
    if (res.ok) return;
  } catch (_) {}
  // Fallback: direct file write
  const hbPath = path.join(AGENTS_DIR, agentName, "heartbeat.md");
  if (fs.existsSync(hbPath)) {
    fs.writeFileSync(
      hbPath,
      [`status: idle`, `agent: ${agentName}`, `timestamp: ${new Date().toISOString()}`, `cycle: 0`, ""].join("\n")
    );
  }
}

test.describe("Smart Run button state", () => {
  let _origSmartRunConfig = null;

  test.beforeAll(async () => {
    // Reset all heartbeats so tests in this file aren't polluted by prior specs
    await resetAllHeartbeats();
    // Ensure smart-run is enabled so button clicks work in this test suite
    const cfg = await apiGet("/api/smart-run/config");
    _origSmartRunConfig = cfg.config || cfg;
    await apiPost("/api/smart-run/config", { enabled: true, dry_run: true });
  });

  test.afterAll(async () => {
    if (_origSmartRunConfig !== null) {
      await apiPost("/api/smart-run/config", _origSmartRunConfig);
    }
  });

  test.afterEach(async () => {
    // Kill all agent processes and reset heartbeats. Smart-start launches real run_agent.sh
    // processes whose EXIT traps write "idle" heartbeats — these can race with the next test's
    // setHeartbeat() call and silently overwrite the "running" state the test depends on.
    await apiPost("/api/agents/stop-all");
    await resetAllHeartbeats();
  });

  test("button shows ⚡ Smart Run when no agents running", async ({ page }) => {
    await resetAllHeartbeats();
    await page.goto("/");
    const btn = page.locator("#smart-start-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("Smart Run");
    await expect(btn).not.toContainText("Stop");
  });

  test("button switches to 🟢 Stop after smart start", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator("#smart-start-btn");
    await btn.click();
    // Wait for the button to update: API takes ~2-4s, then 12s grace period keeps it in Stop state
    await expect(btn).toContainText("Stop", { timeout: 15000 });
  });

  test("button stays 🟢 Stop after page refresh when agents are running", async ({
    page,
  }) => {
    // Simulate a running agent by writing its heartbeat (via API so cache is invalidated)
    await setHeartbeat("alice", "running");

    // Load page fresh (simulates refresh with agents running)
    await page.goto("/");

    // syncSmartStartBtn reads /api/agents — should see alice as running and show Stop
    const btn = page.locator("#smart-start-btn");
    await expect(btn).toContainText("Stop", { timeout: 10000 });
  });

  test("button reverts to ⚡ Smart Run after stop", async ({ page }) => {
    await setHeartbeat("alice", "running");
    await page.goto("/");
    const btn = page.locator("#smart-start-btn");
    await expect(btn).toContainText("Stop", { timeout: 10000 });

    // Click stop — this calls stop-all which resets heartbeats
    await btn.click();
    await expect(btn).toContainText("Smart Run", { timeout: 25000 });
  });
});

test.describe("Fleet tab — selection mode UI", () => {
  let _origConfig = null;

  test.beforeAll(async () => {
    const cfg = await apiGet("/api/smart-run/config");
    _origConfig = cfg.config || cfg;
    // Start with deterministic so tests have a known baseline
    await apiPost("/api/smart-run/config", { selection_mode: "deterministic" });
  });

  test.afterAll(async () => {
    if (_origConfig !== null) {
      await apiPost("/api/smart-run/config", _origConfig);
    }
  });

  test("Fleet tab shows selection mode radio buttons", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-tab="fleet"]');
    await expect(page.locator('input[name="fleet-selection-mode"][value="deterministic"]')).toBeVisible();
    await expect(page.locator('input[name="fleet-selection-mode"][value="random"]')).toBeVisible();
  });

  test("Deterministic radio is checked when config is deterministic", async ({ page }) => {
    await apiPost("/api/smart-run/config", { selection_mode: "deterministic" });
    await page.goto("/");
    await page.click('[data-tab="fleet"]');
    // Wait for loadFleetStatus to sync radios from API
    await expect(page.locator('input[name="fleet-selection-mode"][value="deterministic"]')).toBeChecked({ timeout: 5000 });
    await expect(page.locator('input[name="fleet-selection-mode"][value="random"]')).not.toBeChecked();
  });

  test("Random radio is checked when config is random", async ({ page }) => {
    await apiPost("/api/smart-run/config", { selection_mode: "random" });
    await page.goto("/");
    await page.click('[data-tab="fleet"]');
    await expect(page.locator('input[name="fleet-selection-mode"][value="random"]')).toBeChecked({ timeout: 5000 });
    await expect(page.locator('input[name="fleet-selection-mode"][value="deterministic"]')).not.toBeChecked();
  });

  test("Selecting Random and clicking Apply persists to API", async ({ page }) => {
    await apiPost("/api/smart-run/config", { selection_mode: "deterministic" });
    await page.goto("/");
    await page.click('[data-tab="fleet"]');
    // Wait for loadFleetStatus to complete and sync radios from API before interacting.
    // Without this, the async loadFleetStatus() can reset "random" back to "deterministic"
    // after we click it but before we click Apply (race condition).
    await expect(page.locator('input[name="fleet-selection-mode"][value="deterministic"]')).toBeChecked({ timeout: 5000 });
    // Now click the random radio — loadFleetStatus has already synced
    await page.locator('input[name="fleet-selection-mode"][value="random"]').click();
    await expect(page.locator('input[name="fleet-selection-mode"][value="random"]')).toBeChecked();
    // Apply settings
    await page.click("#fleet-apply-btn");
    // Wait for apply to persist (apiFetch + write config)
    await page.waitForTimeout(1200);
    // Verify API persisted the change
    const cfg = await apiGet("/api/smart-run/config");
    expect((cfg.config || cfg).selection_mode).toBe("random");
  });

  test("Selection mode radio persists after page reload", async ({ page }) => {
    await apiPost("/api/smart-run/config", { selection_mode: "random" });
    await page.goto("/");
    await page.click('[data-tab="fleet"]');
    // After reload the radio should sync from API and show random checked
    await expect(page.locator('input[name="fleet-selection-mode"][value="random"]')).toBeChecked({ timeout: 5000 });
  });
});

test.describe("Fleet panel shows running agents", () => {
  test.afterEach(async () => {
    await resetHeartbeat("alice");
    await resetHeartbeat("bob");
  });

  test("fleet panel shows 'No agents running' when idle", async ({ page }) => {
    await resetHeartbeat("alice");
    await resetHeartbeat("bob");
    await page.goto("/");
    await page.click('[data-tab="fleet"]');
    const fleetSection = page.locator("#fleet-agents");
    await expect(fleetSection).toContainText("No agents running", {
      timeout: 8000,
    });
  });

  test("fleet panel shows running agent names after smart start", async ({
    page,
  }) => {
    await setHeartbeat("alice", "running");
    await setHeartbeat("bob", "running");

    await page.goto("/");
    await page.click('[data-tab="fleet"]');
    // Fleet panel should list at least one agent chip
    const fleetAgents = page.locator("#fleet-agents");
    await expect(fleetAgents).not.toContainText("No agents running", {
      timeout: 10000,
    });
    const chips = fleetAgents.locator(".fleet-agent-chip");
    await expect(chips).not.toHaveCount(0, { timeout: 10000 });
  });

  test("fleet panel shows agent names that match heartbeat status", async ({
    page,
    request,
  }) => {
    await setHeartbeat("alice", "running");

    await page.goto("/");
    await page.click('[data-tab="fleet"]');

    // Get running agents from API — should see alice
    const apiRes = await request.get("/api/agents");
    const agents = await apiRes.json();
    const agentList = Array.isArray(agents) ? agents : agents.agents || [];
    const runningNames = agentList
      .filter(
        (a) =>
          (a.status || a.heartbeat_status || "").toLowerCase() === "running"
      )
      .map((a) => a.name);

    expect(runningNames.length).toBeGreaterThan(0);

    // Each running name should appear in the fleet panel
    const fleetAgents = page.locator("#fleet-agents");
    for (const name of runningNames) {
      await expect(fleetAgents).toContainText(name, { timeout: 8000 });
    }
  });
});
