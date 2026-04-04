#!/usr/bin/env node
/**
 * Pipeline Data Freshness Monitor — T414
 * 
 * Monitors D004 pipeline output files for freshness:
 * - markets_filtered.json (max age: 24h)
 * - market_clusters.json (max age: 24h)
 * - correlation_pairs.json (max age: 24h)
 * - risk_summary.json (max age: 15min)
 * 
 * Exit codes:
 * - 0: All files fresh
 * - 1: One or more files stale
 * - 2: Configuration or runtime error
 * 
 * Author: Grace (Data Engineer)
 * Date: 2026-04-03
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Default configuration
const DEFAULT_CONFIG = {
  // File paths relative to project root
  files: {
    markets_filtered: {
      path: "agents/public/markets_filtered.json",
      maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
      description: "Phase 1 market filtering output",
    },
    market_clusters: {
      path: "agents/public/market_clusters.json",
      maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
      description: "Phase 2 LLM clustering output",
    },
    correlation_pairs: {
      path: "agents/public/correlation_pairs.json",
      maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
      description: "Phase 3 correlation analysis output",
    },
    risk_summary: {
      path: "agents/bob/backend/cpp_engine/risk_summary.json",
      maxAgeMs: 15 * 60 * 1000, // 15 minutes (live trading data)
      description: "Phase 4 C++ engine risk metrics",
    },
  },
  // Output report path
  outputPath: "agents/grace/output/pipeline_health_report.json",
  // Strict mode: fail if file missing (default: true)
  strict: true,
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case "--markets-max-age":
        config.files.markets_filtered.maxAgeMs = parseDuration(args[++i]);
        config.files.market_clusters.maxAgeMs = parseDuration(args[i]);
        config.files.correlation_pairs.maxAgeMs = parseDuration(args[i]);
        break;
      case "--risk-max-age":
        config.files.risk_summary.maxAgeMs = parseDuration(args[++i]);
        break;
      case "--output":
        config.outputPath = args[++i];
        break;
      case "--no-strict":
        config.strict = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(2);
    }
  }
  
  return config;
}

/**
 * Parse duration string (e.g., "24h", "15m", "30s", "1000ms")
 */
function parseDuration(str) {
  if (!str) return 0;
  
  const match = str.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${str}. Use format like "24h", "15m", "30s"`);
  }
  
  const value = parseInt(match[1], 10);
  const unit = match[2] || "ms";
  
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  
  return value * multipliers[unit];
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Pipeline Data Freshness Monitor — T414

Usage: node pipeline_freshness_monitor.js [options]

Options:
  --markets-max-age <duration>  Max age for market data files (default: 24h)
  --risk-max-age <duration>     Max age for risk_summary.json (default: 15m)
  --output <path>               Output report path (default: agents/grace/output/pipeline_health_report.json)
  --no-strict                   Don't fail if files are missing
  --help, -h                    Show this help message

Duration formats:
  24h = 24 hours
  15m = 15 minutes
  30s = 30 seconds
  1000ms = 1000 milliseconds

Examples:
  node pipeline_freshness_monitor.js
  node pipeline_freshness_monitor.js --markets-max-age 12h --risk-max-age 5m
  node pipeline_freshness_monitor.js --output /tmp/health.json --no-strict
`);
}

/**
 * Get project root directory
 */
function getProjectRoot() {
  // The monitor is at: agents/grace/output/pipeline_freshness_monitor.js
  // Project root is 3 levels up from this file
  return path.resolve(__dirname, "../../..");
}

/**
 * Check file freshness
 */
function checkFileFreshness(fileKey, fileConfig, projectRoot) {
  const fullPath = path.join(projectRoot, fileConfig.path);
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    return {
      name: fileKey,
      path: fileConfig.path,
      exists: false,
      status: "MISSING",
      ageMs: null,
      maxAgeMs: fileConfig.maxAgeMs,
      fresh: false,
      description: fileConfig.description,
    };
  }
  
  // Get file stats
  const stats = fs.statSync(fullPath);
  const now = Date.now();
  const ageMs = now - stats.mtime.getTime();
  const fresh = ageMs <= fileConfig.maxAgeMs;
  
  return {
    name: fileKey,
    path: fileConfig.path,
    exists: true,
    status: fresh ? "FRESH" : "STALE",
    ageMs: ageMs,
    maxAgeMs: fileConfig.maxAgeMs,
    fresh: fresh,
    mtime: stats.mtime.toISOString(),
    description: fileConfig.description,
  };
}

/**
 * Format duration for display
 */
function formatDuration(ms) {
  if (ms === null || ms === undefined) return "N/A";
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Run freshness checks
 */
function runChecks(config) {
  const projectRoot = getProjectRoot();
  const results = [];
  let allFresh = true;
  
  console.log("=== Pipeline Data Freshness Monitor — T414 ===\n");
  console.log(`Project root: ${projectRoot}`);
  console.log(`Strict mode: ${config.strict ? "ON" : "OFF"}\n`);
  
  // Check each file
  for (const [key, fileConfig] of Object.entries(config.files)) {
    const result = checkFileFreshness(key, fileConfig, projectRoot);
    results.push(result);
    
    if (!result.fresh) {
      allFresh = false;
    }
    
    // Print status
    const statusIcon = result.status === "FRESH" ? "✅" : 
                       result.status === "STALE" ? "⚠️" : "❌";
    console.log(`${statusIcon} ${result.name}`);
    console.log(`   Path: ${result.path}`);
    console.log(`   Status: ${result.status}`);
    if (result.exists) {
      console.log(`   Age: ${formatDuration(result.ageMs)} (max: ${formatDuration(result.maxAgeMs)})`);
      console.log(`   Modified: ${result.mtime}`);
    } else {
      console.log(`   Error: File not found`);
    }
    console.log(`   Description: ${result.description}`);
    console.log();
  }
  
  // Build health report
  const report = {
    generated_at: new Date().toISOString(),
    task: "T414",
    overall_status: allFresh ? "HEALTHY" : "DEGRADED",
    all_fresh: allFresh,
    strict_mode: config.strict,
    summary: {
      total_files: results.length,
      fresh: results.filter(r => r.status === "FRESH").length,
      stale: results.filter(r => r.status === "STALE").length,
      missing: results.filter(r => r.status === "MISSING").length,
    },
    files: results,
  };
  
  // Write report
  const outputPath = path.join(projectRoot, config.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Health report written to: ${config.outputPath}`);
  
  // Print summary
  console.log("\n=== SUMMARY ===");
  console.log(`Total files: ${report.summary.total_files}`);
  console.log(`Fresh: ${report.summary.fresh} ✅`);
  console.log(`Stale: ${report.summary.stale} ⚠️`);
  console.log(`Missing: ${report.summary.missing} ❌`);
  console.log(`Overall: ${report.overall_status} ${allFresh ? "✅" : "⚠️"}`);
  
  return { allFresh, report };
}

/**
 * Main entry point
 */
function main() {
  try {
    const config = parseArgs();
    const { allFresh } = runChecks(config);
    
    // Exit with appropriate code
    if (!allFresh && config.strict) {
      console.log("\n❌ EXIT CODE 1: One or more files are stale or missing");
      process.exit(1);
    }
    
    console.log("\n✅ EXIT CODE 0: All files fresh");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(2);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { runChecks, checkFileFreshness, parseDuration };
