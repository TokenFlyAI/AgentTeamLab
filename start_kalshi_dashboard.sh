#!/bin/bash
# start_kalshi_dashboard.sh — Launch Kalshi Alpha Dashboard processes
# Author: Eve (Infra)
# Usage: bash start_kalshi_dashboard.sh

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p /tmp/aicompany_runtime_logs

# Verify deliverables exist before starting
missing=0
for f in \
  "${COMPANY_DIR}/agents/bob/backend/dashboard_api.js" \
  "${COMPANY_DIR}/agents/bob/backend/dashboard/run_scheduler.sh" \
  "${COMPANY_DIR}/agents/bob/backend/dashboard/monitor.js"; do
  if [ ! -f "$f" ]; then
    echo "MISSING: $f"
    missing=1
  fi
done

if [ "$missing" -eq 1 ]; then
  echo "ERROR: Kalshi dashboard files not ready. Aborting."
  exit 1
fi

cd "${COMPANY_DIR}"

if command -v pm2 &>/dev/null; then
  echo "Starting Kalshi Alpha Dashboard processes via pm2..."
  pm2 start "${COMPANY_DIR}/ecosystem.config.js" --only kalshi-dashboard,kalshi-scheduler,kalshi-monitor
else
  echo "WARNING: pm2 not found. Install with: npm install -g pm2"
  echo "Falling back to plain background processes..."

  if ! pgrep -f "agents/bob/backend/dashboard_api.js" > /dev/null 2>&1; then
    nohup node "${COMPANY_DIR}/agents/bob/backend/dashboard_api.js" \
      >> /tmp/aicompany_runtime_logs/kalshi-dashboard.log 2>&1 &
    echo "  kalshi-dashboard started (pid $!) — no auto-restart on crash"
  else
    echo "  kalshi-dashboard already running — skipping"
  fi

  if ! pgrep -f "dashboard/run_scheduler.sh" > /dev/null 2>&1; then
    nohup bash "${COMPANY_DIR}/agents/bob/backend/dashboard/run_scheduler.sh" \
      >> /tmp/aicompany_runtime_logs/kalshi-scheduler.log 2>&1 &
    echo "  kalshi-scheduler started (pid $!) — no auto-restart on crash"
  else
    echo "  kalshi-scheduler already running — skipping"
  fi

  if ! pgrep -f "dashboard/monitor.js" > /dev/null 2>&1; then
    nohup node "${COMPANY_DIR}/agents/bob/backend/dashboard/monitor.js" \
      >> /tmp/aicompany_runtime_logs/kalshi-monitor.log 2>&1 &
    echo "  kalshi-monitor started (pid $!) — no auto-restart on crash"
  else
    echo "  kalshi-monitor already running — skipping"
  fi

  echo "Kalshi dashboard ready (no auto-restart — install pm2 for supervision)"
fi

echo "Dashboard API: http://localhost:3200"
echo "Logs: /tmp/aicompany_runtime_logs/kalshi-*.log"
