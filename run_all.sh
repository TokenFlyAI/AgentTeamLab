#!/bin/bash
# run_all.sh — Launch dashboard via pm2, then all 20 agents
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Start dashboard + SRE monitoring scripts via pm2 ---
if command -v pm2 &>/dev/null; then
  echo "Starting dashboard + SRE monitors via pm2..."
  pm2 start "${COMPANY_DIR}/ecosystem.config.js"
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

# --- Launch all agents ---
AGENTS=(alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina)

echo "Launching all ${#AGENTS[@]} agents..."
bash "${COMPANY_DIR}/run_subset.sh" "${AGENTS[@]}"
