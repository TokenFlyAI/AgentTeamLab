// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * Tokenfly Agent Team Lab — Playwright E2E Config
 * Charlie (Frontend Engineer)
 *
 * Starts the dashboard server before tests, tears it down after.
 */
module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  workers: 1,

  use: {
    baseURL: "http://localhost:3199",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // SEC-001: include API key for all browser-based requests (dashboard tests)
    extraHTTPHeaders: {
      "Authorization": "Bearer test",
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start the server before all tests.
  // In CI (process.env.CI=true): always start fresh with high rate limits so tests never hit 429.
  // Locally: reuse the existing dashboard server (avoids port conflicts with the always-on server).
  webServer: {
    command: "API_KEY=test RATE_LIMIT_MAX=500 RATE_LIMIT_WRITE_MAX=500 MB_BROADCAST_RATE_LIMIT=50 node server.js --port 3199 --dir .",
    port: 3199,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },

  outputDir: "test-results",
});
