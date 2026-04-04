/**
 * PM2 Ecosystem Config — Agent Planet
 * Author: Eve (Infra)
 *
 * Usage:
 *   pm2 start ecosystem.config.js          # Start all processes
 *   pm2 start ecosystem.config.js --only dashboard   # Start just the dashboard
 *   pm2 stop all                            # Stop all
 *   pm2 restart dashboard                   # Restart dashboard
 *   pm2 logs                               # Tail all logs
 *   pm2 monit                              # Live monitor
 *   pm2 save                               # Save process list for auto-restart on boot
 *   pm2 startup                            # Generate startup script (run output as root)
 *
 * Port: 3199 (CLAUDE.md standard)
 */

module.exports = {
  apps: [
    {
      // Main Tokenfly dashboard server
      name: "dashboard",
      script: "server.js",
      args: "--dir . --port 3199",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,                    // Don't auto-restart on file changes (agents write frequently)
      max_memory_restart: "450M",      // ALT-009 threshold is 400MB heap — restart before OOM
      restart_delay: 2000,             // 2s cooldown between restarts
      max_restarts: 10,                // Give up after 10 rapid restarts (avoid restart loop)
      min_uptime: "10s",               // Must be up 10s to count as successful start
      env: {
        NODE_ENV: "production",
        PORT: "3199",
      },
      log_file: "/tmp/aicompany_runtime_logs/dashboard.log",
      error_file: "/tmp/aicompany_runtime_logs/dashboard-error.log",
      out_file: "/tmp/aicompany_runtime_logs/dashboard-out.log",
      merge_logs: false,
      time: true,                      // Prepend timestamps to log lines
    },

    {
      // SRE synthetic health check (polls /api/health every 30s)
      name: "healthcheck",
      script: "scripts/healthcheck.js",
      args: "--port 3199 --interval 30",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      restart_delay: 5000,
      max_restarts: 5,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      log_file: "/tmp/aicompany_runtime_logs/healthcheck.log",
      error_file: "/tmp/aicompany_runtime_logs/healthcheck-error.log",
      out_file: "/tmp/aicompany_runtime_logs/healthcheck-out.log",
      merge_logs: false,
      time: true,
    },

    {
      // SRE heartbeat monitor (checks agent liveness every 60s)
      name: "heartbeat-monitor",
      script: "scripts/heartbeat_monitor.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      restart_delay: 5000,
      max_restarts: 5,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      log_file: "/tmp/aicompany_runtime_logs/heartbeat-monitor.log",
      error_file: "/tmp/aicompany_runtime_logs/heartbeat-monitor-error.log",
      out_file: "/tmp/aicompany_runtime_logs/heartbeat-monitor-out.log",
      merge_logs: false,
      time: true,
    },

    {
      // Kalshi Alpha Dashboard API (P0 founder priority)
      name: "kalshi-dashboard",
      script: "agents/bob/backend/dashboard_api.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        PORT: "3200",
      },
      log_file: "/tmp/aicompany_runtime_logs/kalshi-dashboard.log",
      error_file: "/tmp/aicompany_runtime_logs/kalshi-dashboard-error.log",
      out_file: "/tmp/aicompany_runtime_logs/kalshi-dashboard-out.log",
      merge_logs: false,
      time: true,
    },

    {
      // Kalshi pipeline scheduler (runs live_runner.js every 10 min)
      name: "kalshi-scheduler",
      script: "agents/bob/backend/dashboard/run_scheduler.sh",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      restart_delay: 5000,
      max_restarts: 5,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      interpreter: "bash",
      log_file: "/tmp/aicompany_runtime_logs/kalshi-scheduler.log",
      error_file: "/tmp/aicompany_runtime_logs/kalshi-scheduler-error.log",
      out_file: "/tmp/aicompany_runtime_logs/kalshi-scheduler-out.log",
      merge_logs: false,
      time: true,
    },

    {
      // Kalshi dashboard monitor (alerts if pipeline stale)
      name: "kalshi-monitor",
      script: "agents/bob/backend/dashboard/monitor.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      restart_delay: 5000,
      max_restarts: 5,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      log_file: "/tmp/aicompany_runtime_logs/kalshi-monitor.log",
      error_file: "/tmp/aicompany_runtime_logs/kalshi-monitor-error.log",
      out_file: "/tmp/aicompany_runtime_logs/kalshi-monitor-out.log",
      merge_logs: false,
      time: true,
    },
  ],
};
