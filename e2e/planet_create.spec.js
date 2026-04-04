/**
 * E2E test: Create a new planet via the web portal UI
 * Creates "ai-job-apply" planet with 9 agents for AI-based job application work
 */
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3199';

test('Create ai-job-apply planet via UI with 9 agents', async ({ page }) => {
  // Clean up if planet already exists from a previous run
  const existing = await fetch(`${BASE}/api/planets`).then(r => r.json());
  if (existing.planets.some(p => p.name === 'ai-job-apply')) {
    // Remove it via shell — can't do via API, so skip cleanup and use unique name
    test.skip(true, 'Planet ai-job-apply already exists — delete it first');
  }

  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000); // let SSE connect and data load

  // 1. Verify planet selector is visible with current planet name
  const planetBtn = page.locator('#planet-btn');
  await expect(planetBtn).toBeVisible();
  await expect(page.locator('#planet-name-label')).toHaveText('kalshi-traders');

  // 2. Click planet selector dropdown
  await planetBtn.click();
  const dropdown = page.locator('#planet-dropdown');
  await expect(dropdown).toBeVisible();

  // 3. Verify current planet is listed as active
  await expect(dropdown.locator('text=kalshi-traders (active)')).toBeVisible();

  // 4. Click "+ New Planet" button
  await dropdown.locator('text=+ New Planet').click();

  // 5. Verify new planet modal opens
  const modal = page.locator('#new-planet-modal-overlay');
  await expect(modal).toBeVisible();

  // 6. Fill in planet name
  const nameInput = page.locator('#new-planet-name');
  await nameInput.fill('ai-job-apply');

  // 7. Fill in 9 agents for AI job application team
  const agentsInput = page.locator('#new-planet-agents');
  await agentsInput.fill('recruiter researcher writer reviewer scheduler tracker analyst coder manager');

  // 8. Click Create Planet
  await modal.locator('text=Create Planet').click();

  // 9. Wait for creation to complete (modal closes + toast shows)
  await expect(modal).not.toBeVisible({ timeout: 15000 });

  // 10. Verify planet was created via API
  const planets = await fetch(`${BASE}/api/planets`).then(r => r.json());
  const newPlanet = planets.planets.find(p => p.name === 'ai-job-apply');
  expect(newPlanet).toBeTruthy();
  expect(newPlanet.agent_count).toBe(9);

  // 11. Open planet selector again and verify new planet is listed
  await page.locator('#planet-btn').click();
  await expect(page.locator('#planet-dropdown')).toBeVisible();
  await expect(page.locator('#planet-list')).toContainText('ai-job-apply');

  console.log('Planet "ai-job-apply" created successfully with 9 agents!');
  console.log('Agents: recruiter, researcher, writer, reviewer, scheduler, tracker, analyst, coder, manager');
});
