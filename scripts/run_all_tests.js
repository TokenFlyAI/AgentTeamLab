#!/usr/bin/env node
/**
 * Unified Test Runner — Tasks 289/290
 * Author: Eve (Infra)
 *
 * Runs unit, integration, and e2e tests.
 * Starts server.js if not already running for integration/e2e stages.
 */

"use strict";

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const SERVER_URL = "http://localhost:3199/api/health";
const SERVER_START_TIMEOUT_MS = 15000;

let serverProcess = null;
let serverStartedByUs = false;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function log(msg) {
  console.log(`[test-runner] ${msg}`);
}

function error(msg) {
  console.error(`[test-runner] ${msg}`);
}

async function serverIsHealthy() {
  return new Promise((resolve) => {
    const req = http.get(SERVER_URL, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await serverIsHealthy()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startServer() {
  log("Starting server.js for integration/e2e tests...");
  serverProcess = spawn("node", ["server.js", "--dir", ".", "--port", "3199"], {
    cwd: ROOT,
    detached: false,
    stdio: "pipe",
  });
  serverProcess.stdout.on("data", (d) => process.stdout.write(d));
  serverProcess.stderr.on("data", (d) => process.stderr.write(d));
  serverStartedByUs = true;
}

function stopServer() {
  if (serverProcess && serverStartedByUs) {
    log("Stopping server.js...");
    serverProcess.kill("SIGTERM");
  }
}

function runNodeTest(filePath) {
  log(`Running ${path.relative(ROOT, filePath)}...`);
  try {
    const basename = path.basename(filePath);
    let cmd = `node "${filePath}"`;
    // smoke_test.js accepts a base URL argument
    if (basename === "smoke_test.js") {
      cmd = `node "${filePath}" http://localhost:3199`;
    }
    execSync(cmd, { cwd: ROOT, stdio: "inherit" });
    return true;
  } catch (e) {
    error(`FAILED: ${path.relative(ROOT, filePath)}`);
    return false;
  }
}

function runPlaywrightTests() {
  log("Running e2e tests with Playwright...");
  try {
    execSync("npx playwright test", { cwd: ROOT, stdio: "inherit" });
    return true;
  } catch (e) {
    error("FAILED: e2e tests");
    return false;
  }
}

function collectTests(dir) {
  const absDir = path.join(ROOT, dir);
  if (!fs.existsSync(absDir)) return [];
  return fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(absDir, f))
    .sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let exitCode = 0;

  // --- Unit tests ---
  log("=== Unit Tests ===");
  const unitTests = collectTests("tests/unit");
  if (unitTests.length === 0) {
    log("No unit tests found.");
  } else {
    for (const t of unitTests) {
      if (!runNodeTest(t)) exitCode = 1;
    }
  }

  // Ensure server is running for integration + e2e
  const alreadyHealthy = await serverIsHealthy();
  if (!alreadyHealthy) {
    startServer();
    const ready = await waitForServer(SERVER_START_TIMEOUT_MS);
    if (!ready) {
      error("Server did not become healthy in time.");
      stopServer();
      process.exit(1);
    }
  } else {
    log("Server already running.");
  }

  // --- Integration tests ---
  log("=== Integration Tests ===");
  const integrationTests = collectTests("tests/integration");
  if (integrationTests.length === 0) {
    log("No integration tests found.");
  } else {
    for (const t of integrationTests) {
      if (!runNodeTest(t)) exitCode = 1;
    }
  }

  // --- E2E tests ---
  log("=== E2E Tests ===");
  if (!runPlaywrightTests()) exitCode = 1;

  if (serverStartedByUs) {
    stopServer();
    // Give server a moment to shut down
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (exitCode === 0) {
    log("All tests passed.");
  } else {
    error("Some tests failed.");
  }
  process.exit(exitCode);
}

main().catch((e) => {
  error(e.message);
  stopServer();
  process.exit(1);
});
