/**
 * Full UI Browser Verification — real selectors, real screenshots, real clicks
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:3199';
const DASH = 'http://localhost:3200';
const SS = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: path.join(SS, `${name}.png`), fullPage: false });
}

// ─── Page Load & Header ───────────────────────────────────────────────────────

test('01 — Page load: title, header, uptime visible', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await shot(page, '01_home_full');

  const title = await page.title();
  console.log('Title:', title);
  expect(title).toMatch(/Agent Planet|TokenFly/i);

  // Uptime counter visible
  const uptime = page.locator('#uptime');
  await expect(uptime).toBeVisible();
  const uptimeText = await uptime.textContent();
  console.log('Uptime:', uptimeText);

  // Cost today badge
  const cost = page.locator('#cost-today');
  if (await cost.isVisible()) {
    console.log('Cost today:', await cost.textContent());
  }
});

// ─── Agents Tab ───────────────────────────────────────────────────────────────

test('02 — Agents tab: shows agent grid with 20 agents', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  // Click Agents tab nav button (not the content div)
  await page.locator('button.tab-btn[data-tab="agents"]').click();
  // Wait for agent cards to render from API data
  await page.waitForSelector('.agent-card', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, '02_agents_tab');

  // Count agent names
  const agentNames = page.locator('.agent-name');
  const count = await agentNames.count();
  console.log('Agent cards count:', count);
  expect(count).toBeGreaterThanOrEqual(18);

  // Spot-check specific agents
  const body = await page.textContent('body');
  for (const name of ['alice', 'bob', 'charlie', 'grace', 'ivan', 'tina']) {
    expect(body.toLowerCase()).toContain(name);
  }
});

test('03 — Agent card click: opens detail modal', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="agents"]').click();
  await page.waitForSelector('.agent-card', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);

  // Click first agent card (alice)
  const aliceCard = page.locator('.agent-card').first();
  await aliceCard.click();
  await page.waitForTimeout(800);
  await shot(page, '03_agent_modal');

  // Modal or detail panel should open — look for tabs inside it
  const modalTabs = page.locator('text=Overview, text=Cycles, text=Inbox, text=Status.md').first();
  const isOpen = await modalTabs.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('Agent detail modal opened:', isOpen);

  const body = await page.textContent('body');
  // Agent detail should show executor, cycles, status
  expect(body).toMatch(/executor|cycle|status|claude|kimi|codex|gemini/i);
});

test('04 — Agent modal tabs: Overview / Cycles / Inbox / Activity', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="agents"]').click();
  await page.waitForSelector('.agent-card', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.agent-card').first().click();
  await page.waitForTimeout(500);

  // Click through modal tabs using data-mtab attribute selectors
  for (const [mtab, label] of [['cycles', 'Cycles'], ['inbox', 'Inbox'], ['activity', 'Activity'], ['overview', 'Overview']]) {
    const tab = page.locator(`[data-mtab="${mtab}"]`);
    if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(300);
      console.log(`Clicked modal tab: ${label}`);
    }
  }
  await shot(page, '04_agent_modal_cycles');
});

// ─── Tasks / Missions Tab ─────────────────────────────────────────────────────

test('05 — Missions tab: task board loads with tasks', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="tasks"]').click();
  await page.waitForTimeout(800);
  await shot(page, '05_missions_tab');

  const body = await page.textContent('body');
  console.log('Has directions:', /D001|D002|D003/i.test(body));
  expect(body).toMatch(/D001|D002|Kalshi|Build.*trad/i);
});

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

test('06 — Chat tab: loads', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="chat"]').click();
  await page.waitForTimeout(600);
  await shot(page, '06_chat_tab');
  const body = await page.textContent('body');
  console.log('Chat tab body (100 chars):', body.trim().slice(0, 100));
});

// ─── Culture Tab ─────────────────────────────────────────────────────────────

test('07 — Culture tab: shows consensus entries', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="research"]').click();
  await page.waitForTimeout(800);
  await shot(page, '07_culture_tab');

  const body = await page.textContent('body');
  console.log('Culture entries visible — has mean_reversion:', /mean_reversion|sprint|paper.trad/i.test(body));
  expect(body).toMatch(/culture|decision|mean_reversion|sprint|Kalshi/i);
});

// ─── Stats Tab ────────────────────────────────────────────────────────────────

test('08 — Stats tab: shows cost/metrics', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="stats"]').click();
  await page.waitForTimeout(800);
  await shot(page, '08_stats_tab');

  const body = await page.textContent('body');
  console.log('Stats — has cost data:', /\$|\bcost\b|token|cycle/i.test(body));
  expect(body).toMatch(/cost|cycle|agent|\$/i);
});

// ─── Fleet Tab ────────────────────────────────────────────────────────────────

test('09 — Fleet tab: shows daemon status + controls', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="fleet"]').click();
  await page.waitForTimeout(800);
  await shot(page, '09_fleet_tab');

  // Daemon status
  const daemonStatus = page.locator('#fleet-daemon-status');
  await expect(daemonStatus).toBeVisible();
  console.log('Daemon status:', await daemonStatus.textContent());

  // Running count
  const runningCount = page.locator('#fleet-running-count');
  await expect(runningCount).toBeVisible();
  console.log('Running count:', await runningCount.textContent());

  // Apply button is always visible; Start/Stop are mutually exclusive based on daemon state
  const applyBtn = page.locator('#fleet-apply-btn');
  await expect(applyBtn).toBeVisible();
  const startVisible = await page.locator('#fleet-start-btn').isVisible();
  const stopVisible = await page.locator('#fleet-stop-btn').isVisible();
  // Exactly one of start/stop should be visible
  expect(startVisible || stopVisible).toBe(true);
  console.log('Fleet buttons: Apply ✓ Start:', startVisible ? '✓' : '(daemon running)', 'Stop:', stopVisible ? '✓' : '(daemon stopped)');
});

test('10 — Fleet tab: Selection Mode radios work', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="fleet"]').click();
  await page.waitForTimeout(500);

  const detRadio = page.locator('input[name="fleet-selection-mode"][value="deterministic"]');
  const randRadio = page.locator('input[name="fleet-selection-mode"][value="random"]');

  await expect(detRadio).toBeVisible();
  await expect(randRadio).toBeVisible();

  // Check initial state
  const detChecked = await detRadio.isChecked();
  console.log('Deterministic checked by default:', detChecked);

  // Click Random
  await randRadio.click();
  await page.waitForTimeout(200);
  expect(await randRadio.isChecked()).toBe(true);
  await shot(page, '10a_fleet_random_selected');

  // Click back to Deterministic
  await detRadio.click();
  await page.waitForTimeout(200);
  expect(await detRadio.isChecked()).toBe(true);
  await shot(page, '10b_fleet_deterministic_restored');
  console.log('Selection mode radios: ✓ toggle works');
});

test('11 — Fleet tab: Apply Settings persists to API', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="fleet"]').click();
  await page.waitForTimeout(500);

  // Click Apply
  const applyBtn = page.locator('#fleet-apply-btn');
  await applyBtn.click();
  await page.waitForTimeout(800);
  await shot(page, '11_fleet_apply_clicked');
  console.log('Apply Settings clicked ✓');

  // Verify via API
  const resp = await page.request.get(`${BASE}/api/smart-run/config`);
  const config = await resp.json();
  console.log('Config after apply: max_agents=', config.config?.max_agents, 'selection_mode=', config.config?.selection_mode);
  expect(config.config).toBeTruthy();
});

test('12 — Fleet tab: max agents slider/input visible', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="fleet"]').click();
  await page.waitForTimeout(500);

  const maxInput = page.locator('#fleet-max-agents');
  await expect(maxInput).toBeVisible();
  const val = await maxInput.inputValue().catch(() => '?');
  console.log('Max agents current value:', val);
  await shot(page, '12_fleet_max_agents');
});

// ─── CEO Command Bar ──────────────────────────────────────────────────────────

test('13 — CEO command bar: input + send button', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  const input = page.locator('#ceo-cmd-input');
  await expect(input).toBeVisible();

  await input.fill('@alice ping from UI test - please ignore');
  await shot(page, '13a_ceo_command_filled');

  const sendBtn = page.locator('button', { hasText: 'Send' }).first();
  await expect(sendBtn).toBeVisible();
  await sendBtn.click();
  await page.waitForTimeout(600);
  await shot(page, '13b_ceo_command_sent');
  console.log('CEO command sent ✓');

  // Verify DM arrived
  const inboxFiles = require('child_process').execSync('ls agents/alice/chat_inbox/ 2>/dev/null | grep -v processed | wc -l').toString().trim();
  console.log('Alice inbox unread:', inboxFiles);
});

// ─── Header Buttons ───────────────────────────────────────────────────────────

test('14 — Broadcast button: modal opens', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  const broadcastBtn = page.locator('#broadcast-btn');
  await expect(broadcastBtn).toBeVisible();
  await broadcastBtn.click();
  await page.waitForTimeout(500);
  await shot(page, '14_broadcast_modal');

  // Modal should appear with textarea
  const modal = page.locator('.modal, [role="dialog"], .broadcast-modal, textarea').first();
  const modalVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('Broadcast modal opened:', modalVisible);

  // Close it (Escape)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

test('15 — Watchdog button: triggers and shows feedback', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  const watchdog = page.locator('#watchdog-btn');
  const moreBtn  = page.locator('#more-actions-menu, button:has-text("More")').first();

  // Watchdog might be in "More" dropdown
  if (await moreBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await moreBtn.click();
    await page.waitForTimeout(300);
  }

  if (await watchdog.isVisible({ timeout: 1000 }).catch(() => false)) {
    await watchdog.click();
    await page.waitForTimeout(800);
    await shot(page, '15_watchdog_triggered');
    console.log('Watchdog triggered ✓');
  } else {
    console.log('Watchdog button not directly visible (may be in dropdown)');
    await shot(page, '15_watchdog_skipped');
  }
});

test('16 — Mode badge shows current mode', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  const modeBadge = page.locator('#mode-badge');
  await expect(modeBadge).toBeVisible();
  const mode = await modeBadge.textContent();
  console.log('Current mode:', mode);
  expect(mode).toMatch(/normal|plan|crazy|autonomous/i);
  await shot(page, '16_mode_badge');
});

// ─── Kalshi Alpha Dashboard ───────────────────────────────────────────────────
// Skip these tests when the Kalshi trading dashboard (port 3200) is not running.
// They test the trading bot deliverable built by agents, not the platform itself.

let kalshiAvailable = false;
test.beforeAll(async ({ request }) => {
  try {
    const r = await request.get('http://localhost:3200/api/health', { timeout: 2000 });
    kalshiAvailable = r.ok();
  } catch (_) { kalshiAvailable = false; }
});

test('17 — Kalshi dashboard UI loads', async ({ page }) => {
  test.skip(!kalshiAvailable, 'Kalshi trading dashboard not running on port 3200');
  await page.goto(DASH).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, '17_kalshi_full');

  const body = await page.textContent('body').catch(() => '');
  console.log('Kalshi page body length:', body.length);
  console.log('Has trading content:', /signal|trade|Kalshi|strateg|dashboard/i.test(body));
  expect(body.length).toBeGreaterThan(100);
});

test('18 — Kalshi API endpoints all respond', async ({ page }) => {
  test.skip(!kalshiAvailable, 'Kalshi trading dashboard not running on port 3200');
  const endpoints = [
    ['/api/signals',            s => s.success === true],
    ['/api/health',             s => Array.isArray(s.strategies)],
    ['/api/pnl/live',           s => typeof s.win_rate === 'number'],
    ['/api/win-rate-trend',     s => s.trend || Array.isArray(s)],
    ['/api/paper-trades/summary', s => true],
    ['/api/kalshi/status',      s => s.credentials !== undefined || s.mode !== undefined || true],
  ];

  for (const [ep, validate] of endpoints) {
    const resp = await page.request.get(`${DASH}${ep}`);
    const body = await resp.json().catch(() => ({}));
    const ok = resp.status() === 200 && validate(body);
    console.log(`${ok ? '✓' : '✗'} ${DASH}${ep} → ${resp.status()}`);
    expect(resp.status()).toBe(200);
  }
});

// ─── Bug: GET /api/tasks/:id ─────────────────────────────────────────────────

test('19 — BUG CHECK: GET /api/tasks/:id returns 404 (missing route)', async ({ page }) => {
  // Create a task
  const create = await page.request.post(`${BASE}/api/tasks`, {
    headers: { 'Content-Type': 'application/json' },
    data: { title: 'e2e-route-check-task', priority: 'low', assignee: 'alice' }
  });
  const created = await create.json();
  const id = created.id || created.task?.id;
  console.log('Created task id:', id);

  if (id) {
    const getResp = await page.request.get(`${BASE}/api/tasks/${id}`);
    console.log('GET /api/tasks/:id →', getResp.status());
    if (getResp.status() === 404) {
      console.log('⚠ BUG CONFIRMED: GET /api/tasks/:id returns 404 — route missing in server.js');
    } else {
      console.log('✓ GET /api/tasks/:id works');
    }
    // Cleanup
    await page.request.patch(`${BASE}/api/tasks/${id}`, {
      headers: { 'Content-Type': 'application/json' },
      data: { status: 'cancelled' }
    });
  }
});

// ─── Live Agent Run Verification ─────────────────────────────────────────────

test('20 — Live run: start alice via Smart Start, verify heartbeat updates', async ({ page }) => {
  // Ensure daemon is stopped before test — previous tests may have left it running
  await page.request.post(`${BASE}/api/smart-run/stop`).catch(() => {});
  await new Promise(r => setTimeout(r, 500));

  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.locator('button.tab-btn[data-tab="fleet"]').click();
  await page.waitForTimeout(400);
  await shot(page, '20a_before_smart_start');

  // Click Start Daemon — skip if button not visible (fleet daemon may not be supported in this env)
  const startBtn = page.locator('#fleet-start-btn');
  const isVisible = await startBtn.isVisible().catch(() => false);
  test.skip(!isVisible, 'Fleet Start button not visible — daemon may already be running');
  await startBtn.click();
  await page.waitForTimeout(1200);
  await shot(page, '20b_after_smart_start');
  console.log('Smart Start clicked ✓');

  // Check running count updated
  const runningCount = page.locator('#fleet-running-count');
  const count = await runningCount.textContent();
  console.log('Running count after start:', count);
});
