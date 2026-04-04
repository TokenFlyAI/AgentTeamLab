#!/usr/bin/env bash
# Dashboard API Health Monitor — Task 262
# Monitors localhost:3200/health every 60s
# Logs to /tmp/dashboard_health.log
# Alerts to stderr after 3+ consecutive failures

HEALTH_URL="http://localhost:3200/health"
LOG_FILE="/tmp/dashboard_health.log"
INTERVAL=60
FAIL_THRESHOLD=3

consecutive_failures=0

log() {
    local level="$1"
    local msg="$2"
    local ts
    ts=$(date -Iseconds)
    echo "[$ts] [$level] $msg" >> "$LOG_FILE"
}

alert() {
    local msg="$1"
    echo "$msg" >&2
}

log "INFO" "Health monitor started — target: $HEALTH_URL — interval: ${INTERVAL}s"

while true; do
    ts=$(date -Iseconds)
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)

    if [[ "$http_code" == "200" ]]; then
        if (( consecutive_failures >= FAIL_THRESHOLD )); then
            log "RECOVERED" "Dashboard API is UP (HTTP $http_code). Downtime ended."
            alert "[$ts] RECOVERED: Dashboard API is UP (HTTP $http_code)."
        fi
        log "OK" "Dashboard API healthy (HTTP $http_code)"
        consecutive_failures=0
    else
        ((consecutive_failures++))
        log "FAIL" "Dashboard API unhealthy (HTTP ${http_code:-no response}) — consecutive failures: $consecutive_failures"

        if (( consecutive_failures == FAIL_THRESHOLD )); then
            alert "[$ts] ALERT: Dashboard API down for $FAIL_THRESHOLD consecutive checks (HTTP ${http_code:-no response})"
        elif (( consecutive_failures > FAIL_THRESHOLD )); then
            alert "[$ts] ALERT: Dashboard API still down — $consecutive_failures consecutive failures (HTTP ${http_code:-no response})"
        fi
    fi

    sleep "$INTERVAL"
done
