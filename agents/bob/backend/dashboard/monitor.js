/**
 * Trading Operations Monitoring Module
 * Author: Liam (SRE)
 * Task: #238
 * 
 * Monitors strategy API health, trade failures, P&L anomalies, and data pipeline status.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  // Health check
  strategyApiPort: 3200,
  healthCheckIntervalMs: 30000,
  
  // Alert thresholds
  maxFailedTradesPerWindow: 5,
  failedTradeWindowMs: 300000, // 5 minutes
  maxDailyLossCents: 50000, // $500
  maxDrawdownPercent: 0.10, // 10%
  minSharpeRatio: 0.5,
  
  // Data pipeline
  maxPipelineStalenessMs: 3600000, // 1 hour
  
  // Notification
  alertLogPath: path.join(__dirname, "../../../public/reports/trading_alerts.jsonl"),
  metricsPath: path.join(__dirname, "../../../public/reports/trading_metrics.json"),
  webhookUrl: process.env.TRADING_ALERT_WEBHOOK || null,
  
  // Alert cooldowns (prevent spam)
  alertCooldowns: {
    health_check_failure: 300000, // 5 min
    trade_failure_spike: 60000,   // 1 min
    pnl_anomaly: 300000,          // 5 min
    pipeline_stale: 600000,       // 10 min
  }
};

// ---------------------------------------------------------------------------
// Alert State Management
// ---------------------------------------------------------------------------
class AlertState {
  constructor() {
    this.lastAlertTime = new Map();
    this.failedTrades = []; // { timestamp, error, strategy }
    this.alertHistory = [];
  }

  canFire(alertType, cooldownMs) {
    const last = this.lastAlertTime.get(alertType);
    if (!last) return true;
    return Date.now() - last >= cooldownMs;
  }

  record(alertType, alert) {
    this.lastAlertTime.set(alertType, Date.now());
    this.alertHistory.push({
      ...alert,
      firedAt: new Date().toISOString()
    });
    // Keep only last 100 alerts
    if (this.alertHistory.length > 100) {
      this.alertHistory = this.alertHistory.slice(-100);
    }
  }

  addFailedTrade(error, strategy = "unknown") {
    this.failedTrades.push({
      timestamp: Date.now(),
      error: error?.message || String(error),
      strategy
    });
    // Clean old entries
    const cutoff = Date.now() - 300000;
    this.failedTrades = this.failedTrades.filter(t => t.timestamp > cutoff);
  }

  getRecentFailedTradeCount(windowMs = 300000) {
    const cutoff = Date.now() - windowMs;
    return this.failedTrades.filter(t => t.timestamp > cutoff).length;
  }
}

// ---------------------------------------------------------------------------
// Metrics Collector
// ---------------------------------------------------------------------------
class MetricsCollector {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = new AlertState();
    this.metrics = {
      healthCheck: {
        lastSuccess: null,
        consecutiveFailures: 0,
        totalChecks: 0,
        failedChecks: 0
      },
      trades: {
        totalExecuted: 0,
        totalFailed: 0,
        totalRejected: 0,
        lastTradeAt: null
      },
      pnl: {
        dailyRealizedCents: 0,
        dailyUnrealizedCents: 0,
        totalPnlCents: 0,
        maxDrawdownCents: 0,
        sharpeRatio: 0,
        lastUpdate: null
      },
      pipelines: {
        econScanner: { lastRun: null, status: "unknown" },
        cryptoScanner: { lastRun: null, status: "unknown" }
      }
    };
  }

  // -------------------------------------------------------------------------
  // Health Check (trade_signals.json freshness — port 3200 is one-shot)
  // -------------------------------------------------------------------------
  async checkStrategyApiHealth() {
    return new Promise((resolve) => {
      this.metrics.healthCheck.totalChecks++;
      const tradeSignalsPath = path.join(__dirname, "../../output/trade_signals.json");
      const maxStalenessMs = 900000; // 15 minutes

      fs.stat(tradeSignalsPath, (err, stats) => {
        if (err) {
          this.metrics.healthCheck.failedChecks++;
          this.metrics.healthCheck.consecutiveFailures++;
          resolve({ healthy: false, error: `trade_signals.json not found: ${err.message}` });
          return;
        }

        const mtime = stats.mtime.getTime();
        const ageMs = Date.now() - mtime;

        if (ageMs <= maxStalenessMs) {
          this.metrics.healthCheck.lastSuccess = new Date().toISOString();
          this.metrics.healthCheck.consecutiveFailures = 0;
          resolve({ healthy: true, data: { ageMs, mtime: stats.mtime.toISOString() } });
        } else {
          this.metrics.healthCheck.failedChecks++;
          this.metrics.healthCheck.consecutiveFailures++;
          resolve({ healthy: false, error: `trade_signals.json stale: ${(ageMs / 60000).toFixed(1)}m old` });
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Trade Monitoring
  // -------------------------------------------------------------------------
  recordTradeExecution(executionReport) {
    if (!executionReport) return;
    
    this.metrics.trades.totalExecuted += executionReport.executed || 0;
    this.metrics.trades.totalFailed += executionReport.failed || 0;
    this.metrics.trades.totalRejected += executionReport.rejected || 0;
    
    if (executionReport.executed > 0 || executionReport.failed > 0) {
      this.metrics.trades.lastTradeAt = new Date().toISOString();
    }

    // Track failed trades for alerting
    if (executionReport.results) {
      for (const result of executionReport.results) {
        if (result.status === "failed") {
          this.state.addFailedTrade(
            { message: result.reason },
            result.signal?.strategy
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // P&L Monitoring
  // -------------------------------------------------------------------------
  updatePnlMetrics(pnlReport) {
    if (!pnlReport) return;
    
    this.metrics.pnl.dailyRealizedCents = pnlReport.totalRealizedPnl || 0;
    this.metrics.pnl.dailyUnrealizedCents = pnlReport.totalUnrealizedPnl || 0;
    this.metrics.pnl.totalPnlCents = (pnlReport.totalRealizedPnl || 0) + (pnlReport.totalUnrealizedPnl || 0);
    this.metrics.pnl.maxDrawdownCents = pnlReport.maxDrawdown || 0;
    this.metrics.pnl.sharpeRatio = pnlReport.sharpeRatio || 0;
    this.metrics.pnl.lastUpdate = new Date().toISOString();
  }

  // -------------------------------------------------------------------------
  // Pipeline Monitoring
  // -------------------------------------------------------------------------
  updatePipelineStatus(name, status, lastRun = null) {
    if (this.metrics.pipelines[name]) {
      this.metrics.pipelines[name].status = status;
      if (lastRun) {
        this.metrics.pipelines[name].lastRun = lastRun;
      }
    }
  }

  checkPipelineStaleness() {
    const now = Date.now();
    const staleAlerts = [];

    for (const [name, pipeline] of Object.entries(this.metrics.pipelines)) {
      if (!pipeline.lastRun) continue;
      
      const lastRunTime = new Date(pipeline.lastRun).getTime();
      const staleness = now - lastRunTime;
      
      if (staleness > this.config.maxPipelineStalenessMs) {
        staleAlerts.push({
          pipeline: name,
          stalenessMs: staleness,
          lastRun: pipeline.lastRun
        });
      }
    }

    return staleAlerts;
  }

  // -------------------------------------------------------------------------
  // Alert Evaluation
  // -------------------------------------------------------------------------
  evaluateAlerts() {
    const alerts = [];

    // ALT-101: Health check failure
    if (this.metrics.healthCheck.consecutiveFailures >= 3) {
      if (this.state.canFire("health_check_failure", this.config.alertCooldowns.health_check_failure)) {
        const alert = {
          id: `ALT-101-${Date.now()}`,
          type: "health_check_failure",
          severity: "P0-Critical",
          message: `Trade signals stale: ${this.metrics.healthCheck.consecutiveFailures} consecutive failures`,
          details: {
            consecutiveFailures: this.metrics.healthCheck.consecutiveFailures,
            totalFailed: this.metrics.healthCheck.failedChecks
          }
        };
        alerts.push(alert);
        this.state.record("health_check_failure", alert);
      }
    }

    // ALT-102: Trade failure spike
    const recentFailures = this.state.getRecentFailedTradeCount(this.config.failedTradeWindowMs);
    if (recentFailures >= this.config.maxFailedTradesPerWindow) {
      if (this.state.canFire("trade_failure_spike", this.config.alertCooldowns.trade_failure_spike)) {
        const alert = {
          id: `ALT-102-${Date.now()}`,
          type: "trade_failure_spike",
          severity: "P1-High",
          message: `Trade failure spike: ${recentFailures} failures in last 5 minutes`,
          details: {
            failureCount: recentFailures,
            windowMs: this.config.failedTradeWindowMs,
            recentErrors: this.state.failedTrades.slice(-5).map(t => t.error)
          }
        };
        alerts.push(alert);
        this.state.record("trade_failure_spike", alert);
      }
    }

    // ALT-103: Daily loss limit
    if (this.metrics.pnl.dailyRealizedCents < -this.config.maxDailyLossCents) {
      if (this.state.canFire("pnl_anomaly", this.config.alertCooldowns.pnl_anomaly)) {
        const alert = {
          id: `ALT-103-${Date.now()}`,
          type: "daily_loss_limit",
          severity: "P1-High",
          message: `Daily loss limit exceeded: $${Math.abs(this.metrics.pnl.dailyRealizedCents / 100).toFixed(2)}`,
          details: {
            dailyLossCents: this.metrics.pnl.dailyRealizedCents,
            limitCents: this.config.maxDailyLossCents
          }
        };
        alerts.push(alert);
        this.state.record("pnl_anomaly", alert);
      }
    }

    // ALT-104: Max drawdown
    const initialCapital = 500000; // $5,000 default
    const drawdownPercent = this.metrics.pnl.maxDrawdownCents / initialCapital;
    if (drawdownPercent > this.config.maxDrawdownPercent) {
      if (this.state.canFire("pnl_anomaly", this.config.alertCooldowns.pnl_anomaly)) {
        const alert = {
          id: `ALT-104-${Date.now()}`,
          type: "max_drawdown",
          severity: "P1-High",
          message: `Max drawdown exceeded: ${(drawdownPercent * 100).toFixed(1)}%`,
          details: {
            maxDrawdownCents: this.metrics.pnl.maxDrawdownCents,
            drawdownPercent: drawdownPercent,
            limitPercent: this.config.maxDrawdownPercent
          }
        };
        alerts.push(alert);
        this.state.record("pnl_anomaly", alert);
      }
    }

    // ALT-105: Pipeline staleness
    const stalePipelines = this.checkPipelineStaleness();
    for (const stale of stalePipelines) {
      const alertKey = `pipeline_stale_${stale.pipeline}`;
      if (this.state.canFire(alertKey, this.config.alertCooldowns.pipeline_stale)) {
        const alert = {
          id: `ALT-105-${stale.pipeline}-${Date.now()}`,
          type: "pipeline_stale",
          severity: "P2-Medium",
          message: `Data pipeline stale: ${stale.pipeline} last ran ${(stale.stalenessMs / 60000).toFixed(0)}m ago`,
          details: stale
        };
        alerts.push(alert);
        this.state.record(alertKey, alert);
      }
    }

    return alerts;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  async saveMetrics() {
    try {
      fs.mkdirSync(path.dirname(this.config.metricsPath), { recursive: true });
      fs.writeFileSync(
        this.config.metricsPath,
        JSON.stringify(this.metrics, null, 2)
      );
    } catch (err) {
      console.error("[Monitoring] Failed to save metrics:", err.message);
    }
  }

  async logAlert(alert) {
    try {
      fs.mkdirSync(path.dirname(this.config.alertLogPath), { recursive: true });
      const line = JSON.stringify({
        ...alert,
        loggedAt: new Date().toISOString()
      }) + "\n";
      fs.appendFileSync(this.config.alertLogPath, line);
    } catch (err) {
      console.error("[Monitoring] Failed to log alert:", err.message);
    }
  }

  // -------------------------------------------------------------------------
  // Notification
  // -------------------------------------------------------------------------
  async notify(alert) {
    // Console notification
    const severityEmoji = {
      "P0-Critical": "🚨",
      "P1-High": "⚠️",
      "P2-Medium": "ℹ️"
    };
    const emoji = severityEmoji[alert.severity] || "📊";
    console.log(`${emoji} [${alert.severity}] ${alert.type}: ${alert.message}`);

    // Webhook notification (if configured)
    if (this.config.webhookUrl) {
      try {
        await this.sendWebhook(alert);
      } catch (err) {
        console.error("[Monitoring] Webhook failed:", err.message);
      }
    }

    // Persist alert
    await this.logAlert(alert);
  }

  async sendWebhook(alert) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(alert);
      const url = new URL(this.config.webhookUrl);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length
        },
        timeout: 10000
      };

      const client = url.protocol === "https:" ? require("https") : http;
      const req = client.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });

      req.write(data);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Monitoring Service
// ---------------------------------------------------------------------------
class MonitoringService {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.collector = new MetricsCollector(this.config);
    this.intervalId = null;
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[Monitoring] Starting trading operations monitoring...");
    console.log(`[Monitoring] Health check interval: ${this.config.healthCheckIntervalMs}ms`);
    console.log(`[Monitoring] Alert log: ${this.config.alertLogPath}`);

    // Initial health check
    await this.runCheck();

    // Schedule recurring checks
    this.intervalId = setInterval(() => {
      this.runCheck().catch(err => {
        console.error("[Monitoring] Check failed:", err.message);
      });
    }, this.config.healthCheckIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[Monitoring] Stopped");
  }

  async runCheck() {
    // Health check
    const health = await this.collector.checkStrategyApiHealth();
    if (!health.healthy) {
      console.log(`[Monitoring] Health check failed: ${health.error}`);
    }

    // Evaluate and fire alerts
    const alerts = this.collector.evaluateAlerts();
    for (const alert of alerts) {
      await this.collector.notify(alert);
    }

    // Save metrics
    await this.collector.saveMetrics();
  }

  // Public API for external integration
  recordTradeExecution(executionReport) {
    this.collector.recordTradeExecution(executionReport);
  }

  updatePnlMetrics(pnlReport) {
    this.collector.updatePnlMetrics(pnlReport);
  }

  updatePipelineStatus(name, status, lastRun) {
    this.collector.updatePipelineStatus(name, status, lastRun);
  }

  getMetrics() {
    return { ...this.collector.metrics };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  MonitoringService,
  MetricsCollector,
  AlertState,
  DEFAULT_CONFIG
};

// ---------------------------------------------------------------------------
// CLI / Standalone Mode
// ---------------------------------------------------------------------------
if (require.main === module) {
  const service = new MonitoringService();
  
  service.start().catch(err => {
    console.error("[Monitoring] Failed to start:", err);
    process.exit(1);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Monitoring] Shutting down...");
    service.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    service.stop();
    process.exit(0);
  });
}
