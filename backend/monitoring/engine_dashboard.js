/**
 * D004 Engine Monitoring Dashboard — Task T426
 * Real-time metrics endpoint and dashboard for C++ Engine
 * Author: Liam (SRE)
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ============================================================================
// Configuration
// ============================================================================
const CONFIG = {
  port: process.env.DASHBOARD_PORT || 3250,
  engineLogPath: process.env.ENGINE_LOG || "/var/log/kalshi-engine/engine.log",
  alertsFilePath: process.env.ALERTS_FILE || 
    path.join(__dirname, "../../agents/liam/output/alerts.json"),
  maxHistoryPoints: 1000,
  heartbeatTimeoutMs: 10000, // 10s without heartbeat = unhealthy
};

// ============================================================================
// State
// ============================================================================
const state = {
  engineStatus: "unknown", // running, stopped, unhealthy
  lastHeartbeat: null,
  metrics: {
    trades: 0,
    pnlCents: 0,
    exposureCents: 0,
    positions: 0,
    circuitBreaker: false,
  },
  history: [], // Array of {timestamp, pnl, trades, exposure}
  trades: [], // Array of recent trades
  alerts: [], // Array of active alerts
  startTime: Date.now(),
};

// ============================================================================
// Log Parser
// ============================================================================
function parseHeartbeat(line) {
  // Parse: [HEARTBEAT] Trades=42 PnL=12.34 Exposure=567.89 Positions=3 CB=NO
  const match = line.match(/\[HEARTBEAT\] Trades=(\d+) PnL=([\d.-]+) Exposure=([\d.-]+) Positions=(\d+) CB=(YES|NO)/);
  if (match) {
    return {
      trades: parseInt(match[1]),
      pnlCents: Math.round(parseFloat(match[2]) * 100),
      exposureCents: Math.round(parseFloat(match[3]) * 100),
      positions: parseInt(match[4]),
      circuitBreaker: match[5] === "YES",
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

function parseTrade(line) {
  // Parse trade execution lines if present
  // Example: [EXECUTED] BTC-YES: 10 contracts @ 45c
  const match = line.match(/\[EXECUTED\] ([\w-]+): (\d+) contracts @ (\d+)c/);
  if (match) {
    return {
      market: match[1],
      contracts: parseInt(match[2]),
      price: parseInt(match[3]),
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

// ============================================================================
// Log Tail (follow engine log)
// ============================================================================
function startLogTail() {
  const logPath = CONFIG.engineLogPath;
  
  // Check if log file exists
  if (!fs.existsSync(logPath)) {
    console.log(`[WARN] Engine log not found at ${logPath}, will retry...`);
    setTimeout(startLogTail, 5000);
    return;
  }

  console.log(`[INFO] Tailing engine log: ${logPath}`);
  
  // Use tail -f to follow log
  const tail = spawn("tail", ["-f", "-n", "100", logPath]);
  
  tail.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      // Parse heartbeat
      const heartbeat = parseHeartbeat(line);
      if (heartbeat) {
        state.lastHeartbeat = Date.now();
        state.engineStatus = "running";
        state.metrics = {
          trades: heartbeat.trades,
          pnlCents: heartbeat.pnlCents,
          exposureCents: heartbeat.exposureCents,
          positions: heartbeat.positions,
          circuitBreaker: heartbeat.circuitBreaker,
        };
        
        // Add to history
        state.history.push({
          timestamp: heartbeat.timestamp,
          pnl: heartbeat.pnlCents / 100,
          trades: heartbeat.trades,
          exposure: heartbeat.exposureCents / 100,
        });
        
        // Trim history
        if (state.history.length > CONFIG.maxHistoryPoints) {
          state.history.shift();
        }
        
        // Check for circuit breaker alert
        if (heartbeat.circuitBreaker && !state.alerts.find(a => a.type === "circuit_breaker" && !a.acknowledged)) {
          state.alerts.push({
            id: Date.now(),
            type: "circuit_breaker",
            severity: "critical",
            message: "Circuit breaker triggered",
            timestamp: new Date().toISOString(),
            acknowledged: false,
          });
        }
      }
      
      // Parse trade
      const trade = parseTrade(line);
      if (trade) {
        state.trades.unshift(trade);
        if (state.trades.length > 100) {
          state.trades.pop();
        }
      }
    }
  });
  
  tail.stderr.on("data", (data) => {
    console.error(`[ERROR] Tail error: ${data}`);
  });
  
  tail.on("close", (code) => {
    console.log(`[WARN] Log tail exited with code ${code}, restarting...`);
    setTimeout(startLogTail, 5000);
  });
}

// ============================================================================
// Health Check
// ============================================================================
function checkEngineHealth() {
  const now = Date.now();
  
  if (state.lastHeartbeat === null) {
    state.engineStatus = "unknown";
  } else if (now - state.lastHeartbeat > CONFIG.heartbeatTimeoutMs) {
    if (state.engineStatus !== "unhealthy") {
      state.engineStatus = "unhealthy";
      state.alerts.push({
        id: Date.now(),
        type: "heartbeat_loss",
        severity: "critical",
        message: `No heartbeat for ${Math.round((now - state.lastHeartbeat) / 1000)}s`,
        timestamp: new Date().toISOString(),
        acknowledged: false,
      });
    }
  }
}

setInterval(checkEngineHealth, 5000);

// ============================================================================
// HTTP Server
// ============================================================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // API Routes
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "healthy",
      engineStatus: state.engineStatus,
      lastHeartbeat: state.lastHeartbeat,
      dashboardUptime: Date.now() - state.startTime,
    }));
    return;
  }
  
  if (url.pathname === "/api/metrics") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      current: state.metrics,
      history: state.history.slice(-100), // Last 100 points
      engineStatus: state.engineStatus,
      lastHeartbeat: state.lastHeartbeat,
    }));
    return;
  }
  
  if (url.pathname === "/api/trades") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      trades: state.trades.slice(0, 50), // Last 50 trades
      totalTrades: state.metrics.trades,
    }));
    return;
  }
  
  if (url.pathname === "/api/alerts") {
    if (req.method === "POST") {
      // Acknowledge alert
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { alertId } = JSON.parse(body);
          const alert = state.alerts.find(a => a.id === alertId);
          if (alert) {
            alert.acknowledged = true;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request" }));
        }
      });
      return;
    }
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      alerts: state.alerts.filter(a => !a.acknowledged),
      allAlerts: state.alerts.slice(-20),
    }));
    return;
  }
  
  // Dashboard HTML
  if (url.pathname === "/" || url.pathname === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getDashboardHTML());
    return;
  }
  
  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ============================================================================
// Dashboard HTML
// ============================================================================
function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>D004 Engine Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      line-height: 1.6;
    }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 20px;
      border-bottom: 2px solid #0f3460;
    }
    .header h1 {
      color: #e94560;
      font-size: 24px;
      margin-bottom: 5px;
    }
    .header .subtitle {
      color: #888;
      font-size: 14px;
    }
    .status-bar {
      display: flex;
      gap: 20px;
      padding: 15px 20px;
      background: #151520;
      border-bottom: 1px solid #252535;
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    .status-running { background: #00d26a; }
    .status-stopped { background: #ff6b6b; }
    .status-unknown { background: #ffd93d; }
    .status-unhealthy { background: #ff6b6b; animation: flash 1s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    @keyframes flash {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      padding: 20px;
    }
    .card {
      background: #151520;
      border: 1px solid #252535;
      border-radius: 8px;
      padding: 20px;
    }
    .card h3 {
      color: #888;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
    }
    .metric {
      font-size: 32px;
      font-weight: bold;
      color: #fff;
    }
    .metric.positive { color: #00d26a; }
    .metric.negative { color: #ff6b6b; }
    .metric.warning { color: #ffd93d; }
    .chart-container {
      grid-column: 1 / -1;
      height: 300px;
    }
    #pnlChart {
      width: 100%;
      height: 250px;
      background: #0f0f1a;
      border-radius: 4px;
    }
    .alerts {
      grid-column: 1 / -1;
    }
    .alert {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 4px;
      border-left: 4px solid;
    }
    .alert.critical {
      background: rgba(255, 107, 107, 0.1);
      border-left-color: #ff6b6b;
    }
    .alert.warning {
      background: rgba(255, 217, 61, 0.1);
      border-left-color: #ffd93d;
    }
    .alert button {
      margin-left: auto;
      padding: 4px 12px;
      background: #333;
      border: none;
      color: #fff;
      border-radius: 4px;
      cursor: pointer;
    }
    .alert button:hover {
      background: #444;
    }
    .trades-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .trades-table th,
    .trades-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #252535;
    }
    .trades-table th {
      color: #888;
      font-weight: normal;
    }
    .footer {
      padding: 20px;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔥 D004 Engine Dashboard</h1>
    <div class="subtitle">Kalshi Arbitrage Engine — Real-time Monitoring</div>
  </div>
  
  <div class="status-bar">
    <div class="status-item">
      <div class="status-indicator" id="statusIndicator"></div>
      <span id="statusText">Checking...</span>
    </div>
    <div class="status-item">
      <span>Last Heartbeat:</span>
      <span id="lastHeartbeat">—</span>
    </div>
    <div class="status-item">
      <span>Uptime:</span>
      <span id="uptime">—</span>
    </div>
  </div>
  
  <div class="grid">
    <div class="card">
      <h3>Total Trades</h3>
      <div class="metric" id="totalTrades">—</div>
    </div>
    
    <div class="card">
      <h3>Realized P&L</h3>
      <div class="metric" id="pnl">—</div>
    </div>
    
    <div class="card">
      <h3>Exposure</h3>
      <div class="metric" id="exposure">—</div>
    </div>
    
    <div class="card">
      <h3>Open Positions</h3>
      <div class="metric" id="positions">—</div>
    </div>
    
    <div class="card chart-container">
      <h3>P&L Over Time</h3>
      <canvas id="pnlChart"></canvas>
    </div>
    
    <div class="card alerts">
      <h3>Active Alerts</h3>
      <div id="alertsContainer">
        <div style="color: #666; padding: 20px;">No active alerts</div>
      </div>
    </div>
    
    <div class="card" style="grid-column: 1 / -1;">
      <h3>Recent Trades</h3>
      <table class="trades-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Market</th>
            <th>Contracts</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody id="tradesTable">
          <tr><td colspan="4" style="color: #666;">No trades yet</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  
  <div class="footer">
    D004 Kalshi Arbitrage Engine — Dashboard v1.0.0
  </div>
  
  <script>
    // Chart setup
    const canvas = document.getElementById('pnlChart');
    const ctx = canvas.getContext('2d');
    
    function resizeCanvas() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    function drawChart(history) {
      if (!history || history.length < 2) return;
      
      const width = canvas.width;
      const height = canvas.height;
      const padding = 20;
      
      ctx.clearRect(0, 0, width, height);
      
      const pnls = history.map(h => h.pnl);
      const minPnl = Math.min(...pnls);
      const maxPnl = Math.max(...pnls);
      const range = maxPnl - minPnl || 1;
      
      // Draw grid
      ctx.strokeStyle = '#252535';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = padding + (height - 2 * padding) * i / 4;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
      }
      
      // Draw P&L line
      ctx.strokeStyle = maxPnl >= 0 ? '#00d26a' : '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      history.forEach((point, i) => {
        const x = padding + (width - 2 * padding) * i / (history.length - 1);
        const y = height - padding - (height - 2 * padding) * (point.pnl - minPnl) / range;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      ctx.stroke();
      
      // Draw zero line if in range
      if (minPnl <= 0 && maxPnl >= 0) {
        const zeroY = height - padding - (height - 2 * padding) * (0 - minPnl) / range;
        ctx.strokeStyle = '#666';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(padding, zeroY);
        ctx.lineTo(width - padding, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    
    // Update dashboard
    async function updateDashboard() {
      try {
        // Fetch metrics
        const metricsRes = await fetch('/api/metrics');
        const metrics = await metricsRes.json();
        
        // Update status
        const statusEl = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        statusEl.className = 'status-indicator status-' + metrics.engineStatus;
        statusText.textContent = 'Engine: ' + metrics.engineStatus.toUpperCase();
        
        // Update last heartbeat
        if (metrics.lastHeartbeat) {
          const ago = Math.round((Date.now() - metrics.lastHeartbeat) / 1000);
          document.getElementById('lastHeartbeat').textContent = ago + 's ago';
        }
        
        // Update metrics
        document.getElementById('totalTrades').textContent = metrics.current.trades;
        
        const pnlEl = document.getElementById('pnl');
        const pnl = metrics.current.pnlCents / 100;
        pnlEl.textContent = '$' + pnl.toFixed(2);
        pnlEl.className = 'metric ' + (pnl >= 0 ? 'positive' : 'negative');
        
        document.getElementById('exposure').textContent = '$' + (metrics.current.exposureCents / 100).toFixed(2);
        document.getElementById('positions').textContent = metrics.current.positions;
        
        // Draw chart
        drawChart(metrics.history);
        
        // Fetch alerts
        const alertsRes = await fetch('/api/alerts');
        const alerts = await alertsRes.json();
        
        const alertsContainer = document.getElementById('alertsContainer');
        if (alerts.alerts.length === 0) {
          alertsContainer.innerHTML = '<div style="color: #666; padding: 20px;">No active alerts</div>';
        } else {
          alertsContainer.innerHTML = alerts.alerts.map(alert => \`
            <div class="alert \${alert.severity}">
              <span>\${alert.severity === 'critical' ? '🔴' : '⚠️'}</span>
              <span>\${alert.message}</span>
              <span style="color: #666; font-size: 12px;">\${new Date(alert.timestamp).toLocaleTimeString()}</span>
              <button onclick="acknowledgeAlert(\${alert.id})">Ack</button>
            </div>
          \`).join('');
        }
        
        // Fetch trades
        const tradesRes = await fetch('/api/trades');
        const trades = await tradesRes.json();
        
        const tradesTable = document.getElementById('tradesTable');
        if (trades.trades.length === 0) {
          tradesTable.innerHTML = '<tr><td colspan="4" style="color: #666;">No trades yet</td></tr>';
        } else {
          tradesTable.innerHTML = trades.trades.slice(0, 10).map(trade => \`
            <tr>
              <td>\${new Date(trade.timestamp).toLocaleTimeString()}</td>
              <td>\${trade.market}</td>
              <td>\${trade.contracts}</td>
              <td>\${trade.price}c</td>
            </tr>
          \`).join('');
        }
        
      } catch (err) {
        console.error('Dashboard update error:', err);
      }
    }
    
    async function acknowledgeAlert(alertId) {
      try {
        await fetch('/api/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alertId })
        });
        updateDashboard();
      } catch (err) {
        console.error('Acknowledge error:', err);
      }
    }
    
    // Update every second
    updateDashboard();
    setInterval(updateDashboard, 1000);
    
    // Update uptime
    setInterval(() => {
      fetch('/api/health')
        .then(r => r.json())
        .then(data => {
          const uptime = Math.floor(data.dashboardUptime / 1000);
          const hours = Math.floor(uptime / 3600);
          const mins = Math.floor((uptime % 3600) / 60);
          const secs = uptime % 60;
          document.getElementById('uptime').textContent = 
            hours + 'h ' + mins + 'm ' + secs + 's';
        });
    }, 1000);
  </script>
</body>
</html>`;
}

// ============================================================================
// Start Server
// ============================================================================
function start() {
  // Start log tail
  startLogTail();
  
  // Start HTTP server
  server.listen(CONFIG.port, () => {
    console.log(`[INFO] D004 Engine Dashboard running on port ${CONFIG.port}`);
    console.log(`[INFO] Dashboard URL: http://localhost:${CONFIG.port}`);
    console.log(`[INFO] API endpoints:`);
    console.log(`       - GET /api/health`);
    console.log(`       - GET /api/metrics`);
    console.log(`       - GET /api/trades`);
    console.log(`       - GET /api/alerts`);
    console.log(`       - POST /api/alerts (acknowledge)`);
  });
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("[INFO] Shutting down dashboard...");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("[INFO] Shutting down dashboard...");
  server.close(() => {
    process.exit(0);
  });
});

// Start if run directly
if (require.main === module) {
  start();
}

// Export for testing
module.exports = { start, state, CONFIG };
