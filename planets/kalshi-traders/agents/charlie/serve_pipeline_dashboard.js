#!/usr/bin/env node
/**
 * D004 Pipeline Status Dashboard — Standalone Server
 * Serves index_lite.html with API endpoints for pipeline data.
 *
 * Usage: node serve_pipeline_dashboard.js [--port 3457]
 * Then open http://localhost:3457 in your browser.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "3457", 10);

// Resolve paths relative to the planet root
const SCRIPT_DIR = fs.realpathSync(__dirname);
const PLANET_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const SHARED_DIR = path.join(PLANET_ROOT, "shared");
const REPORTS_DIR = path.join(PLANET_ROOT, "output", "shared", "reports");
const BOB_BACKEND = path.join(PLANET_ROOT, "agents", "bob", "backend");

// Pipeline data files
const FILES = {
  markets: path.join(SHARED_DIR, "markets_filtered.json"),
  clusters: path.join(SHARED_DIR, "market_clusters.json"),
  pairs: path.join(SHARED_DIR, "correlation_pairs.json"),
  healthLog: path.join(REPORTS_DIR, "health_check_log.jsonl"),
  activeAlerts: path.join(REPORTS_DIR, "active_alerts.md"),
};

function readJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, "utf8")); }
  catch (e) { return {}; }
}

function sendJSON(res, data) {
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function sendError(res, code, message) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

// Compute readiness from pipeline files
function computeReadiness() {
  let phase1 = { status: "unknown", markets_filtered: 0, file_exists: false };
  let phase2 = { status: "unknown", clusters: 0, markets_clustered: 0, file_exists: false };
  let phase3 = { status: "unknown", pairs: 0, arbitrage_opportunities: 0, file_exists: false };
  let phase4 = { status: "unknown", engine_ready: false };

  try {
    const corrData = readJSON(FILES.pairs);
    const pairs = corrData.pairs || [];
    const uniqueMarkets = new Set();
    pairs.forEach(p => { uniqueMarkets.add(p.market_a); uniqueMarkets.add(p.market_b); });
    phase1 = { status: uniqueMarkets.size > 0 ? "complete" : "incomplete", markets_filtered: uniqueMarkets.size, file_exists: true };
    phase3 = { status: pairs.length > 0 ? "complete" : "incomplete", pairs: pairs.length, arbitrage_opportunities: (pairs.filter(p => p.is_arbitrage_opportunity) || []).length, file_exists: true };
  } catch { phase1.status = "error"; phase3.status = "error"; }

  try {
    const clusterData = readJSON(FILES.clusters);
    const clusters = clusterData.clusters || [];
    phase2 = { status: clusters.length > 0 ? "complete" : "incomplete", clusters: clusters.length, markets_clustered: clusterData.summary?.total_markets_clustered || 0, file_exists: true };
  } catch { phase2.status = "error"; }

  const enginePath = path.join(BOB_BACKEND, "cpp_engine", "engine");
  phase4 = { status: fs.existsSync(enginePath) ? "ready" : "not_built", engine_ready: fs.existsSync(enginePath), engine_path: enginePath };

  const kalshiCreds = !!process.env.KALSHI_API_KEY;
  const blockers = [];
  if (phase1.markets_filtered === 0) blockers.push({ type: "phase", id: "P1", message: "No markets filtered" });
  if (phase2.clusters === 0) blockers.push({ type: "phase", id: "P2", message: "No market clusters" });
  if (phase3.pairs === 0) blockers.push({ type: "phase", id: "P3", message: "No correlation pairs" });
  if (!kalshiCreds) blockers.push({ type: "credential", id: "T236", message: "Kalshi API credentials not configured" });

  const allPhasesComplete = phase1.status === "complete" && phase2.status === "complete" && phase3.status === "complete";
  return {
    success: true,
    timestamp: new Date().toISOString(),
    go_no_go: {
      status: allPhasesComplete && kalshiCreds ? "GO" : "NO-GO",
      ready: allPhasesComplete && kalshiCreds,
      reason: allPhasesComplete
        ? (kalshiCreds ? "All phases complete, credentials configured" : "All phases complete, waiting for Kalshi credentials")
        : "D004 pipeline incomplete"
    },
    phases: { phase1_market_filtering: phase1, phase2_clustering: phase2, phase3_correlation: phase3, phase4_execution: phase4 },
    blockers,
    credentials: { kalshi_api_key: kalshiCreds }
  };
}

// Read last N lines from health log
function getHealthMonitoring() {
  try {
    if (!fs.existsSync(FILES.healthLog)) return { success: false, error: "Health log not found" };
    const data = fs.readFileSync(FILES.healthLog, "utf8");
    const lines = data.trim().split("\n").filter(l => l.trim());
    const last10 = lines.slice(-10).map(l => JSON.parse(l));
    
    // Find last successful probe for uptime
    const lastSuccess = [...last10].reverse().find(l => l.status_code === 200);
    const latest = last10[last10.length - 1] || {};
    
    return {
      success: true,
      uptime_ms: lastSuccess ? lastSuccess.uptime_ms : 0,
      p99_latency_trend: last10.map(l => ({ 
        timestamp: l.timestamp, 
        p99_ms: l.p99_ms || 0,
        status: l.status_code === 200 ? "OK" : "FAIL"
      })),
      latest_probe: latest
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Get active alerts from markdown
function getActiveAlerts() {
  try {
    if (!fs.existsSync(FILES.activeAlerts)) return { success: true, count: 0, alerts: [] };
    const data = fs.readFileSync(FILES.activeAlerts, "utf8");
    const lines = data.split("\n");
    
    const countMatch = data.match(/\*\*(\d+) active alert\(s\)\*\*/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    
    const alerts = [];
    let inTable = false;
    for (const line of lines) {
      if (line.includes("| Alert ID | Severity |")) {
        inTable = true;
        continue;
      }
      if (inTable && line.startsWith("|----------|")) continue;
      if (inTable && line.startsWith("|")) {
        const parts = line.split("|").map(p => p.trim()).filter(p => p);
        if (parts.length >= 4) {
          alerts.push({
            id: parts[0],
            severity: parts[1],
            message: parts[2],
            triggered_at: parts[3]
          });
        }
      } else if (inTable && line.trim() === "") {
        // End of table
      }
    }
    
    return {
      success: true,
      count: count,
      alerts: alerts,
      last_updated: (data.match(/_Last updated: (.*)_/) || [])[1] || null
    };
  } catch (e) {
    return { success: false, error: e.message, count: 0, alerts: [] };
  }
}

const server = http.createServer((req, res) => {
  // CORS
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve the dashboard HTML at root
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/index_lite.html") {
    const targetFile = fs.existsSync(path.join(SCRIPT_DIR, "index_lite.html")) ? "index_lite.html" : "pipeline_dashboard.html";
    const html = fs.readFileSync(path.join(SCRIPT_DIR, targetFile), "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }

  // API: readiness
  if (url.pathname === "/api/readiness") {
    try { return sendJSON(res, computeReadiness()); }
    catch (e) { return sendError(res, 500, e.message); }
  }

  // API: monitoring/health
  if (url.pathname === "/api/monitoring/health") {
    return sendJSON(res, getHealthMonitoring());
  }

  // API: monitoring/alerts
  if (url.pathname === "/api/monitoring/alerts") {
    return sendJSON(res, getActiveAlerts());
  }

  // API: markets
  if (url.pathname === "/api/pipeline/markets") {
    try { return sendJSON(res, readJSON(FILES.markets)); }
    catch (e) { return sendError(res, 500, e.message); }
  }

  // Serve static JSON files from shared/
  if (url.pathname.startsWith("/public/")) {
    const filePath = path.join(SHARED_DIR, url.pathname.replace("/public/", ""));
    try {
      const data = fs.readFileSync(filePath, "utf8");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(data);
    } catch { return sendError(res, 404, "File not found"); }
  }

  sendError(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`D004 Pipeline Dashboard running at http://localhost:${PORT}`);
  console.log(`  GET /                      — Dashboard UI`);
  console.log(`  GET /api/readiness          — Pipeline readiness status`);
  console.log(`  GET /api/monitoring/health  — Platform health monitoring`);
  console.log(`  GET /api/monitoring/alerts  — Active alerts count`);
  console.log(`  GET /api/pipeline/markets   — Filtered markets`);
});
