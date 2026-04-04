/**
 * Alert Manager — Task 325
 * Real-time signal alert system. Watches for trading signals and alerts
 * when confidence >= 0.80. Logs to alerts.json + optional Slack webhook.
 * Author: Liam (SRE)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const POLL_INTERVAL_MS = 5000;           // Poll every 5s (well under 30s target)
const SIGNALS_FILE = process.env.SIGNALS_FILE || 
  path.join(__dirname, "../agents/bob/output/trade_signals.json");
const ALERTS_FILE = process.env.ALERTS_FILE || 
  path.join(__dirname, "../agents/liam/output/alerts.json");
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || null;
const MIN_CONFIDENCE = 0.80;             // Per consensus: confidence threshold
const PAPER_TRADING = process.env.PAPER_TRADING !== 'false';

// Track already-alerted signals to avoid duplicates
const alertedSignals = new Set();

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  console.log(`[${entry.timestamp}] ${level.toUpperCase()}: ${message}`, 
    Object.keys(meta).length > 0 ? meta : '');
  return entry;
}

// ---------------------------------------------------------------------------
// File Operations
// ---------------------------------------------------------------------------
function readSignalsFile() {
  try {
    if (!fs.existsSync(SIGNALS_FILE)) {
      return null;
    }
    const content = fs.readFileSync(SIGNALS_FILE, "utf8");
    return JSON.parse(content);
  } catch (err) {
    log("error", "Failed to read signals file", { error: err.message });
    return null;
  }
}

function readAlertsFile() {
  try {
    if (!fs.existsSync(ALERTS_FILE)) {
      return { alerts: [], lastAlertAt: null };
    }
    const content = fs.readFileSync(ALERTS_FILE, "utf8");
    return JSON.parse(content);
  } catch (err) {
    log("error", "Failed to read alerts file, starting fresh", { error: err.message });
    return { alerts: [], lastAlertAt: null };
  }
}

function writeAlertsFile(alertsData) {
  try {
    fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alertsData, null, 2));
    return true;
  } catch (err) {
    log("error", "Failed to write alerts file", { error: err.message });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Slack Webhook
// ---------------------------------------------------------------------------
function postToSlack(payload) {
  return new Promise((resolve, reject) => {
    if (!SLACK_WEBHOOK_URL) {
      resolve({ skipped: true, reason: "SLACK_WEBHOOK_URL not set" });
      return;
    }

    const url = new URL(SLACK_WEBHOOK_URL);
    const postData = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          reject(new Error(`Slack webhook returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

function buildSlackPayload(alert) {
  const emoji = alert.direction === "BUY" || alert.direction === "YES" ? "🟢" : "🔴";
  const confidencePct = Math.round(alert.confidence * 100);
  
  return {
    text: `${emoji} *Trading Signal Fired*`,
    attachments: [
      {
        color: alert.direction === "BUY" || alert.direction === "YES" ? "good" : "danger",
        fields: [
          { title: "Market", value: alert.market, short: true },
          { title: "Strategy", value: alert.signal_type, short: true },
          { title: "Direction", value: alert.direction.toUpperCase(), short: true },
          { title: "Confidence", value: `${confidencePct}%`, short: true },
          { title: "Paper Trading", value: alert.paper_trading ? "Yes" : "No", short: true },
          { title: "Timestamp", value: alert.timestamp, short: true },
        ],
        footer: "Agent Planet Trading System",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Alert Processing
// ---------------------------------------------------------------------------
function generateSignalId(signal) {
  // Unique ID based on market + side + timestamp + confidence
  return `${signal.marketId || signal.ticker}_${signal.side}_${signal.confidence}_${signal.timestamp || ''}`;
}

function processSignals(signalsData) {
  if (!signalsData || !signalsData.signals || !Array.isArray(signalsData.signals)) {
    return [];
  }

  const alertsTriggered = [];
  const alertsData = readAlertsFile();

  for (const signal of signalsData.signals) {
    // Check confidence threshold (per consensus: 0.80 minimum)
    const confidence = parseFloat(signal.confidence);
    if (isNaN(confidence) || confidence < MIN_CONFIDENCE) {
      continue;
    }

    const signalId = generateSignalId(signal);
    
    // Skip if already alerted
    if (alertedSignals.has(signalId)) {
      continue;
    }

    // Build alert payload
    const alert = {
      market: signal.ticker || signal.marketId,
      signal_type: signal.strategy || "unknown",
      confidence: confidence,
      direction: signal.side,
      timestamp: new Date().toISOString(),
      paper_trading: PAPER_TRADING,
      signal_source: signalsData.source || "unknown",
      signal_generated_at: signalsData.generatedAt,
      expected_edge: signal.expectedEdge,
      recommended_contracts: signal.recommendedContracts || (signal.sizing && signal.sizing.contracts),
      reason: signal.reason,
    };

    // Log to alerts.json
    alertsData.alerts.push(alert);
    alertsData.lastAlertAt = alert.timestamp;
    
    // Mark as alerted
    alertedSignals.add(signalId);
    alertsTriggered.push(alert);

    log("info", `Alert triggered for ${alert.market}`, { 
      confidence: alert.confidence,
      direction: alert.direction,
      strategy: alert.signal_type,
    });
  }

  // Persist alerts
  if (alertsTriggered.length > 0) {
    writeAlertsFile(alertsData);
  }

  return alertsTriggered;
}

async function sendSlackAlerts(alerts) {
  const results = [];
  for (const alert of alerts) {
    try {
      const payload = buildSlackPayload(alert);
      const result = await postToSlack(payload);
      results.push({ alert, result });
      if (result.success) {
        log("info", `Slack notification sent for ${alert.market}`);
      } else if (result.skipped) {
        log("debug", `Slack notification skipped: ${result.reason}`);
      }
    } catch (err) {
      log("error", `Failed to send Slack notification for ${alert.market}`, { error: err.message });
      results.push({ alert, error: err.message });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main Polling Loop
// ---------------------------------------------------------------------------
async function pollCycle() {
  const signalsData = readSignalsFile();
  
  if (!signalsData) {
    log("debug", "No signals file found or empty");
    return;
  }

  // Check if signals file is fresh (within last 30s for real-time requirement)
  const generatedAt = signalsData.generatedAt ? new Date(signalsData.generatedAt) : null;
  const now = new Date();
  const ageMs = generatedAt ? now - generatedAt : Infinity;
  
  if (ageMs > 60000) {
    log("warn", "Signals file is stale", { ageSeconds: Math.round(ageMs / 1000) });
  }

  // Process signals
  const newAlerts = processSignals(signalsData);
  
  if (newAlerts.length > 0) {
    log("info", `Processed ${newAlerts.length} new alert(s)`);
    
    // Send Slack notifications
    await sendSlackAlerts(newAlerts);
  }
}

function startPolling() {
  log("info", "Alert Manager starting", {
    pollIntervalMs: POLL_INTERVAL_MS,
    signalsFile: SIGNALS_FILE,
    alertsFile: ALERTS_FILE,
    slackWebhook: SLACK_WEBHOOK_URL ? "configured" : "not configured",
    minConfidence: MIN_CONFIDENCE,
    paperTrading: PAPER_TRADING,
  });

  // Initial poll
  pollCycle();

  // Schedule polling
  const intervalId = setInterval(pollCycle, POLL_INTERVAL_MS);
  
  // Graceful shutdown
  process.on("SIGINT", () => {
    log("info", "Shutting down Alert Manager...");
    clearInterval(intervalId);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log("info", "Shutting down Alert Manager...");
    clearInterval(intervalId);
    process.exit(0);
  });

  return intervalId;
}

// ---------------------------------------------------------------------------
// HTTP Health Endpoint (optional, for monitoring the monitor)
// ---------------------------------------------------------------------------
function startHealthServer(port = 0) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      const alertsData = readAlertsFile();
      const status = {
        status: "healthy",
        uptime: process.uptime(),
        alertsTotal: alertsData.alerts.length,
        lastAlertAt: alertsData.lastAlertAt,
        signalsFile: SIGNALS_FILE,
        alertsFile: ALERTS_FILE,
        slackConfigured: !!SLACK_WEBHOOK_URL,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status, null, 2));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  if (port > 0) {
    server.listen(port, () => {
      log("info", `Health server listening on port ${port}`);
    });
  }

  return server;
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const healthPort = args.includes("--health") ? 
    parseInt(args[args.indexOf("--health") + 1]) || 3250 : 0;

  startPolling();
  
  if (healthPort > 0) {
    startHealthServer(healthPort);
  }
}

// ---------------------------------------------------------------------------
// Exports (for testing and integration)
// ---------------------------------------------------------------------------
module.exports = {
  AlertManager: {
    startPolling,
    startHealthServer,
    pollCycle,
    processSignals,
    sendSlackAlerts,
    readSignalsFile,
    readAlertsFile,
    writeAlertsFile,
  },
  config: {
    POLL_INTERVAL_MS,
    SIGNALS_FILE,
    ALERTS_FILE,
    MIN_CONFIDENCE,
    PAPER_TRADING,
  },
};
