#!/bin/bash
# Pipeline Scheduler — runs live_runner.js every 10 minutes
# Deliverable for Grace (Task 241)
RUNNER="$(dirname "$0")/../strategies/live_runner.js"
LOGFILE="/tmp/kalshi_scheduler.log"
INTERVAL=600  # 10 minutes

echo "[$(date)] Pipeline scheduler started. Runner: $RUNNER" | tee -a "$LOGFILE"

while true; do
  echo "[$(date)] Running pipeline..." | tee -a "$LOGFILE"
  node "$RUNNER" >> "$LOGFILE" 2>&1
  EXIT=$?
  if [ $EXIT -eq 0 ]; then
    echo "[$(date)] Pipeline OK" | tee -a "$LOGFILE"
  else
    echo "[$(date)] Pipeline FAILED (exit $EXIT)" | tee -a "$LOGFILE"
  fi
  echo "[$(date)] Next run in ${INTERVAL}s" | tee -a "$LOGFILE"
  sleep $INTERVAL
done
