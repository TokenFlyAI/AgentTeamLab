#!/bin/bash
# run_all.sh — Launch dashboard via pm2, then all 20 agents
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Start dashboard + SRE monitoring scripts via pm2 ---
if command -v pm2 &>/dev/null; then
  echo "Starting dashboard + SRE monitors via pm2..."
  pm2 start "${COMPANY_DIR}/ecosystem.config.js" --only dashboard,healthcheck,heartbeat-monitor
else
  echo "WARNING: pm2 not found. Install with: npm install -g pm2"
  echo "Falling back to plain node for dashboard..."
  node "${COMPANY_DIR}/server.js" --dir "${COMPANY_DIR}" --port 3199 &
  DASHBOARD_PID=$!
  echo "Dashboard started (pid $DASHBOARD_PID) — no auto-restart on crash"
  echo "Starting SRE monitors (nohup)..."
  if ! pgrep -f "healthcheck.js" > /dev/null 2>&1; then
    nohup node "${COMPANY_DIR}/scripts/healthcheck.js" --port 3199 --interval 30 \
      >> /tmp/aicompany_runtime_logs/healthcheck.log 2>&1 &
    echo "  healthcheck.js started (pid $!)"
  else
    echo "  healthcheck.js already running — skipping"
  fi
  if ! pgrep -f "heartbeat_monitor.js" > /dev/null 2>&1; then
    nohup node "${COMPANY_DIR}/scripts/heartbeat_monitor.js" \
      >> /tmp/aicompany_runtime_logs/heartbeat-monitor.log 2>&1 &
    echo "  heartbeat_monitor.js started (pid $!)"
  else
    echo "  heartbeat_monitor.js already running — skipping"
  fi
  echo "SRE monitors ready (no auto-restart — install pm2 for supervision)"
fi

# --- Start Kalshi Alpha Dashboard (P0) ---
KALSHI_API="${COMPANY_DIR}/agents/bob/backend/dashboard_api.js"
KALSHI_SCHEDULER="${COMPANY_DIR}/agents/bob/backend/dashboard/run_scheduler.sh"
KALSHI_MONITOR="${COMPANY_DIR}/agents/bob/backend/dashboard/monitor.js"

if [ -f "$KALSHI_API" ] && [ -f "$KALSHI_SCHEDULER" ] && [ -f "$KALSHI_MONITOR" ]; then
  echo "Starting Kalshi Alpha Dashboard..."
  if command -v pm2 &>/dev/null; then
    pm2 start "${COMPANY_DIR}/ecosystem.config.js" --only kalshi-dashboard,kalshi-scheduler,kalshi-monitor
  else
    mkdir -p /tmp/aicompany_runtime_logs
    if ! pgrep -f "agents/bob/backend/dashboard_api.js" > /dev/null 2>&1; then
      nohup node "$KALSHI_API" >> /tmp/aicompany_runtime_logs/kalshi-dashboard.log 2>&1 &
      echo "  kalshi-dashboard started (pid $!)"
    else
      echo "  kalshi-dashboard already running — skipping"
    fi
    if ! pgrep -f "dashboard/run_scheduler.sh" > /dev/null 2>&1; then
      nohup bash "$KALSHI_SCHEDULER" >> /tmp/aicompany_runtime_logs/kalshi-scheduler.log 2>&1 &
      echo "  kalshi-scheduler started (pid $!)"
    else
      echo "  kalshi-scheduler already running — skipping"
    fi
    if ! pgrep -f "dashboard/monitor.js" > /dev/null 2>&1; then
      nohup node "$KALSHI_MONITOR" >> /tmp/aicompany_runtime_logs/kalshi-monitor.log 2>&1 &
      echo "  kalshi-monitor started (pid $!)"
    else
      echo "  kalshi-monitor already running — skipping"
    fi
  fi
else
  echo "Kalshi dashboard files not ready — skipping"
fi

# --- Launch all agents ---
AGENTS=(alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina)

echo "Launching all ${#AGENTS[@]} agents..."
bash "${COMPANY_DIR}/run_subset.sh" "${AGENTS[@]}"
