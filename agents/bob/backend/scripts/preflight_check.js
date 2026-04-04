#!/usr/bin/env node
/**
 * Live Trading Pre-Flight Validation Script
 * Task 321
 * Validates all prerequisites before switching from paper to live trading.
 * Exit code: 0 = ready, 1 = blocked
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

const BACKEND_DIR = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(BACKEND_DIR, "..", "output");

const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  checks: [],
};

function log(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

function recordCheck(name, status, message) {
  results.checks.push({ name, status, message });
  if (status === "PASS") results.passed++;
  else if (status === "FAIL") results.failed++;
  else if (status === "WARN") results.warnings++;
  log(status, `${name}: ${message}`);
}

// ==================== CHECKS ====================

function checkEnvVar(name, required = true) {
  const value = process.env[name];
  if (!value) {
    if (required) {
      recordCheck(`Env: ${name}`, "FAIL", `Missing required environment variable ${name}`);
    } else {
      recordCheck(`Env: ${name}`, "WARN", `Optional environment variable ${name} not set`);
    }
    return false;
  }
  recordCheck(`Env: ${name}`, "PASS", `Set (${value.length} chars)`);
  return true;
}

function checkPaperTradingMode() {
  const pt = process.env.PAPER_TRADING;
  if (pt === undefined) {
    recordCheck("Env: PAPER_TRADING", "WARN", "Not set — assuming paper trading mode");
    return true;
  }
  if (pt === "false") {
    recordCheck("Env: PAPER_TRADING", "WARN", "Set to 'false' — live trading mode active. Ensure this is intentional.");
    return true;
  }
  recordCheck("Env: PAPER_TRADING", "PASS", `Set to '${pt}' — paper trading mode`);
  return true;
}

function checkDirectoryWritable(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const testFile = path.join(dirPath, `.preflight_write_test_${Date.now()}`);
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    recordCheck(`Writable: ${path.relative(BACKEND_DIR, dirPath)}`, "PASS", "Directory exists and is writable");
    return true;
  } catch (e) {
    recordCheck(`Writable: ${path.relative(BACKEND_DIR, dirPath)}`, "FAIL", e.message);
    return false;
  }
}

function checkFileExists(filePath, label) {
  if (fs.existsSync(filePath)) {
    recordCheck(`File: ${label}`, "PASS", `Found at ${path.relative(BACKEND_DIR, filePath)}`);
    return true;
  }
  recordCheck(`File: ${label}`, "FAIL", `Missing: ${path.relative(BACKEND_DIR, filePath)}`);
  return false;
}

function checkModuleLoad(modulePath, label) {
  try {
    require(modulePath);
    recordCheck(`Module: ${label}`, "PASS", "Loads without error");
    return true;
  } catch (e) {
    recordCheck(`Module: ${label}`, "FAIL", e.message);
    return false;
  }
}

function checkHttpHealth(urlPath, port, label) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}${urlPath}`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          recordCheck(`Service: ${label}`, "PASS", `HTTP 200 on port ${port}`);
          resolve(true);
        } else {
          recordCheck(`Service: ${label}`, "FAIL", `HTTP ${res.statusCode} on port ${port}`);
          resolve(false);
        }
      });
    });
    req.on("error", (e) => {
      recordCheck(`Service: ${label}`, "FAIL", `Unreachable on port ${port}: ${e.message}`);
      resolve(false);
    });
    req.on("timeout", () => {
      recordCheck(`Service: ${label}`, "FAIL", `Timeout on port ${port}`);
      req.destroy();
      resolve(false);
    });
  });
}

function checkProcessRunning(pattern, label) {
  try {
    execSync(`pgrep -f "${pattern}"`, { stdio: "pipe" });
    recordCheck(`Process: ${label}`, "PASS", `Running (matched '${pattern}')`);
    return true;
  } catch (e) {
    recordCheck(`Process: ${label}`, "WARN", `No running process matched '${pattern}'`);
    return false;
  }
}

async function checkDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    recordCheck("Database", "WARN", "DATABASE_URL not set — skipping DB connectivity check");
    return true;
  }
  try {
    const pg = require("pg");
    const client = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 3000 });
    await client.connect();
    const res = await client.query("SELECT NOW() as now");
    await client.end();
    recordCheck("Database", "PASS", `Connected. Server time: ${res.rows[0].now}`);
    return true;
  } catch (e) {
    recordCheck("Database", "FAIL", e.message);
    return false;
  }
}

// ==================== MAIN ====================

async function main() {
  log("INFO", "=== Live Trading Pre-Flight Check ===");
  log("INFO", `Backend dir: ${BACKEND_DIR}`);
  log("INFO", `Output dir: ${OUTPUT_DIR}`);

  // 1. Environment
  checkEnvVar("KALSHI_API_KEY", false); // warn if missing (required for live)
  checkPaperTradingMode();

  // 2. Filesystem
  checkDirectoryWritable(OUTPUT_DIR);
  checkDirectoryWritable(path.join(BACKEND_DIR, "logs"));

  // 3. Required files
  const requiredFiles = [
    [path.join(BACKEND_DIR, "strategies", "live_runner.js"), "live_runner.js"],
    [path.join(BACKEND_DIR, "strategies", "risk_manager.js"), "risk_manager.js"],
    [path.join(BACKEND_DIR, "strategies", "signal_engine.js"), "signal_engine.js"],
    [path.join(BACKEND_DIR, "strategies", "execution_engine.js"), "execution_engine.js"],
    [path.join(BACKEND_DIR, "strategies", "position_sizer.js"), "position_sizer.js"],
    [path.join(BACKEND_DIR, "kalshi_client.js"), "kalshi_client.js"],
    [path.join(BACKEND_DIR, "dashboard_api.js"), "dashboard_api.js"],
    [path.join(BACKEND_DIR, "db", "schema.sql"), "db/schema.sql"],
  ];
  for (const [fp, label] of requiredFiles) {
    checkFileExists(fp, label);
  }

  // 4. Module loads
  checkModuleLoad(path.join(BACKEND_DIR, "strategies", "risk_manager.js"), "risk_manager");
  checkModuleLoad(path.join(BACKEND_DIR, "strategies", "signal_engine.js"), "signal_engine");
  checkModuleLoad(path.join(BACKEND_DIR, "strategies", "execution_engine.js"), "execution_engine");
  checkModuleLoad(path.join(BACKEND_DIR, "kalshi_client.js"), "kalshi_client");

  // 5. Services
  await checkHttpHealth("/health", 3200, "Dashboard API");

  // 6. Processes
  checkProcessRunning("run_scheduler.sh", "Scheduler");
  checkProcessRunning("monitor.js", "Monitor");

  // 7. Database
  await checkDatabase();

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("PRE-FLIGHT CHECK SUMMARY");
  console.log("=".repeat(50));
  console.log(`Passed:   ${results.passed} ✓`);
  console.log(`Warnings: ${results.warnings} ⚠`);
  console.log(`Failed:   ${results.failed} ✗`);
  console.log("=".repeat(50));

  if (results.failed > 0) {
    console.log("\n❌ Pre-flight check FAILED — do not proceed to live trading.");
    process.exit(1);
  }

  if (results.warnings > 0) {
    console.log("\n⚠️  Pre-flight check PASSED with warnings — review before live trading.");
  } else {
    console.log("\n✅ All pre-flight checks passed. System is ready.");
  }
  process.exit(0);
}

main().catch((e) => {
  log("ERROR", `Pre-flight check crashed: ${e.message}`);
  console.error(e);
  process.exit(1);
});
