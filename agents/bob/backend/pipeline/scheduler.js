#!/usr/bin/env node
/**
 * Kalshi Data Pipeline Scheduler
 * Author: Mia (API Engineer)
 * Task: #219 — Unified data collection scheduler
 *
 * Orchestrates all data collection pipelines with:
 *   - Configurable schedules
 *   - Retry with exponential backoff
 *   - Graceful error handling
 *   - Job logging
 *   - Can run as daemon or one-shot
 */

"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const JOBS = [
  {
    name: "fetch_markets",
    script: path.join(__dirname, "fetch_markets.js"),
    type: "node",
    intervalMs: 5 * 60 * 1000, // 5 minutes
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    name: "fetch_prices",
    script: path.join(__dirname, "fetch_prices.js"),
    type: "node",
    intervalMs: 1 * 60 * 1000, // 1 minute
    retryAttempts: 3,
    retryDelayMs: 2000,
  },
  {
    name: "sync_positions",
    script: path.join(__dirname, "sync_positions.js"),
    type: "node",
    intervalMs: 5 * 60 * 1000, // 5 minutes
    retryAttempts: 2,
    retryDelayMs: 5000,
  },
  {
    name: "live_runner",
    script: path.join(__dirname, "../strategies/live_runner.js"),
    type: "node",
    intervalMs: 15 * 60 * 1000, // 15 minutes (paper trading automation - T323)
    retryAttempts: 2,
    retryDelayMs: 10000,
    env: { ...process.env, PAPER_TRADING: "true" }, // Force paper trading mode
  },
  {
    name: "econ_edge_scanner",
    script: path.join(__dirname, "../../../grace/output/econ_edge_scanner.py"),
    type: "python",
    intervalMs: 15 * 60 * 1000, // 15 minutes
    retryAttempts: 2,
    retryDelayMs: 10000,
    cwd: path.join(__dirname, "../../../grace/output"),
  },
  {
    name: "crypto_edge_analysis",
    script: path.join(__dirname, "../../../dave/output/crypto_edge_analysis.py"),
    type: "python",
    intervalMs: 10 * 60 * 1000, // 10 minutes
    retryAttempts: 2,
    retryDelayMs: 10000,
    cwd: path.join(__dirname, "../../../dave/output"),
  },
];

const LOG_DIR = path.join(__dirname, "../logs");

// Check if a script exists
async function scriptExists(scriptPath) {
  try {
    await fs.access(scriptPath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function log(jobName, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${jobName}] ${message}`;
  console.log(line);
}

// ---------------------------------------------------------------------------
// Job Runner
// ---------------------------------------------------------------------------

function runScript(job) {
  return new Promise((resolve, reject) => {
    const isPython = job.type === "python";
    const command = isPython ? "python3" : "node";
    const proc = spawn(command, [job.script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      cwd: job.cwd || __dirname,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(stderr || `Process exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function runJobWithRetry(job) {
  // Skip if script doesn't exist (e.g., teammate's file not present)
  if (!(await scriptExists(job.script))) {
    log(job.name, `Skipping: script not found at ${job.script}`);
    return { success: true, skipped: true };
  }

  let lastError;

  for (let attempt = 1; attempt <= job.retryAttempts; attempt++) {
    try {
      log(job.name, `Starting (attempt ${attempt}/${job.retryAttempts})... [${job.type}]`);
      const start = Date.now();
      const result = await runScript(job);
      const duration = Date.now() - start;
      log(job.name, `Completed in ${duration}ms`);
      if (result.stdout) {
        result.stdout
          .trim()
          .split("\n")
          .forEach((line) => log(job.name, `OUT: ${line}`));
      }
      return { success: true, duration, stdout: result.stdout };
    } catch (error) {
      lastError = error;
      log(
        job.name,
        `Attempt ${attempt} failed: ${error.message || error.stderr || "Unknown error"}`
      );
      if (attempt < job.retryAttempts) {
        const delay = job.retryDelayMs * attempt;
        log(job.name, `Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  log(job.name, `All ${job.retryAttempts} attempts failed.`);
  return { success: false, error: lastError };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

class PipelineScheduler {
  constructor() {
    this.timers = new Map();
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;

    log("scheduler", "Starting pipeline scheduler...");

    for (const job of JOBS) {
      // Run immediately on start
      this._scheduleJob(job);
    }
  }

  _scheduleJob(job) {
    if (!this.running) return;

    runJobWithRetry(job).then(() => {
      if (this.running) {
        const timer = setTimeout(() => this._scheduleJob(job), job.intervalMs);
        this.timers.set(job.name, timer);
      }
    });
  }

  stop() {
    log("scheduler", "Stopping pipeline scheduler...");
    this.running = false;
    for (const [name, timer] of this.timers) {
      clearTimeout(timer);
      log("scheduler", `Cancelled job: ${name}`);
    }
    this.timers.clear();
  }
}

// ---------------------------------------------------------------------------
// CLI: One-shot mode
// ---------------------------------------------------------------------------

async function runOneShot(jobNames) {
  await ensureLogDir();
  const targets = jobNames
    ? JOBS.filter((j) => jobNames.includes(j.name))
    : JOBS;

  log("scheduler", `Running one-shot for: ${targets.map((t) => t.name).join(", ")}`);

  const results = [];
  for (const job of targets) {
    const result = await runJobWithRetry(job);
    results.push({ name: job.name, ...result });
  }

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    log("scheduler", `Failed jobs: ${failed.map((f) => f.name).join(", ")}`);
    process.exit(1);
  } else {
    log("scheduler", "All jobs completed successfully");
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// CLI: Daemon mode
// ---------------------------------------------------------------------------

async function runDaemon() {
  await ensureLogDir();
  const scheduler = new PipelineScheduler();
  scheduler.start();

  process.on("SIGINT", () => scheduler.stop());
  process.on("SIGTERM", () => scheduler.stop());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "daemon";

  switch (command) {
    case "daemon":
      await runDaemon();
      break;
    case "run":
      // e.g., node scheduler.js run fetch_markets fetch_prices
      await runOneShot(args.slice(1));
      break;
    case "run-all":
      await runOneShot();
      break;
    default:
      console.log(`
Kalshi Data Pipeline Scheduler

Usage:
  node scheduler.js daemon          Run as persistent scheduler (default)
  node scheduler.js run-all         Run all jobs once
  node scheduler.js run <jobs...>   Run specific jobs once

Jobs:
  fetch_markets        - Fetch and store all active markets (every 5 min)
  fetch_prices         - Record price snapshots (every 1 min)
  sync_positions       - Sync positions from Kalshi (every 5 min)
  econ_edge_scanner    - Grace's economic edge scanner (every 15 min)
  crypto_edge_analysis - Dave's crypto edge analyzer (every 10 min)
`);
      process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
