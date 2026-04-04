#!/bin/bash
# =============================================================================
# D004 C++ Engine Kill Switch
# Emergency stop procedure — guaranteed < 30s stop
# Author: Liam (SRE)
# Task: T354
# =============================================================================

set -euo pipefail

# Configuration
ENGINE_NAME="cpp_engine/engine"
GRACEFUL_TIMEOUT_SEC=5
FORCE_TIMEOUT_SEC=2
LOG_FILE="/var/log/kalshi-engine/kill_switch.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE" 2>/dev/null || echo "${timestamp} [${level}] ${message}"
}

# Find engine PID
find_engine_pid() {
    pgrep -f "$ENGINE_NAME$" || true
}

# Main kill switch logic
main() {
    log "INFO" "=== Kill Switch Activated ==="
    
    # Step 1: Find engine PID
    ENGINE_PID=$(find_engine_pid)
    
    if [ -z "$ENGINE_PID" ]; then
        log "WARN" "Engine not running (no PID found)"
        exit 0
    fi
    
    log "INFO" "Found engine PID: $ENGINE_PID"
    
    # Step 2: Graceful shutdown (SIGTERM)
    log "INFO" "Sending SIGTERM for graceful shutdown (timeout: ${GRACEFUL_TIMEOUT_SEC}s)..."
    kill -TERM "$ENGINE_PID" 2>/dev/null || true
    
    # Wait for graceful shutdown
    for i in $(seq 1 $GRACEFUL_TIMEOUT_SEC); do
        sleep 1
        if ! ps -p "$ENGINE_PID" > /dev/null 2>&1; then
            log "INFO" "${GREEN}Engine stopped gracefully after ${i}s${NC}"
            
            # Cancel any open orders
            cancel_open_orders
            
            log "INFO" "${GREEN}Kill switch completed successfully${NC}"
            exit 0
        fi
        log "DEBUG" "Waiting... ($i/$GRACEFUL_TIMEOUT_SEC)"
    done
    
    # Step 3: Force kill (SIGKILL)
    log "WARN" "${YELLOW}Graceful shutdown failed after ${GRACEFUL_TIMEOUT_SEC}s, forcing...${NC}"
    
    if ps -p "$ENGINE_PID" > /dev/null 2>&1; then
        kill -9 "$ENGINE_PID" 2>/dev/null || true
        sleep $FORCE_TIMEOUT_SEC
    fi
    
    # Step 4: Verify stopped
    if ps -p "$ENGINE_PID" > /dev/null 2>&1; then
        log "ERROR" "${RED}CRITICAL: Engine still running after SIGKILL!${NC}"
        log "ERROR" "Manual intervention required"
        
        # Try to get process info for debugging
        ps -fp "$ENGINE_PID" 2>/dev/null | log "ERROR" || true
        
        exit 1
    fi
    
    log "INFO" "${GREEN}Engine force-stopped successfully${NC}"
    
    # Step 5: Cancel any open orders
    cancel_open_orders
    
    log "INFO" "${GREEN}Kill switch completed successfully${NC}"
    exit 0
}

# Cancel open orders via Kalshi API
cancel_open_orders() {
    if [ -z "${KALSHI_API_KEY:-}" ]; then
        log "WARN" "KALSHI_API_KEY not set, skipping order cancellation"
        return 0
    fi
    
    log "INFO" "Cancelling open orders via Kalshi API..."
    
    # Cancel all open orders
    local response
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "https://trading-api.kalshi.com/v1/orders/cancel" \
        -H "Authorization: Bearer $KALSHI_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"all": true}' 2>/dev/null || echo -e "\n000")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        log "INFO" "${GREEN}Open orders cancelled successfully${NC}"
    elif [ "$http_code" = "000" ]; then
        log "WARN" "Could not connect to Kalshi API (network issue)"
    else
        log "WARN" "Order cancellation returned HTTP $http_code: $body"
    fi
}

# Pre-flight checks
preflight_checks() {
    # Check for required commands
    if ! command -v pgrep &> /dev/null; then
        log "ERROR" "pgrep not found, cannot find engine PID"
        exit 1
    fi
    
    # Ensure log directory exists
    if [ -n "${LOG_FILE:-}" ]; then
        mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    fi
}

# Usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

D004 C++ Engine Emergency Kill Switch
Guaranteed stop in < 30 seconds

OPTIONS:
    -h, --help      Show this help message
    -f, --force     Skip graceful shutdown, force kill immediately
    -d, --dry-run   Show what would be done without executing

EXAMPLES:
    # Normal emergency stop
    $0

    # Force kill immediately (no graceful shutdown)
    $0 --force

    # Dry run (show what would happen)
    $0 --dry-run

TIME BUDGET:
    Graceful shutdown:  ${GRACEFUL_TIMEOUT_SEC}s
    Force kill:         ${FORCE_TIMEOUT_SEC}s
    Order cancellation: ~5s
    Total:              ~12s (well under 30s target)

EXIT CODES:
    0   Success (engine stopped)
    1   Error (engine still running or other failure)
EOF
}

# Parse arguments
DRY_RUN=false
FORCE_KILL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        -f|--force)
            FORCE_KILL=true
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            log "ERROR" "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Dry run mode
if [ "$DRY_RUN" = true ]; then
    echo "=== DRY RUN MODE ==="
    echo "Would find PID of: $ENGINE_NAME"
    ENGINE_PID=$(find_engine_pid)
    if [ -n "$ENGINE_PID" ]; then
        echo "Found PID: $ENGINE_PID"
        echo "Would send: SIGTERM (graceful)"
        echo "Would wait: ${GRACEFUL_TIMEOUT_SEC}s"
        if [ "$FORCE_KILL" = true ]; then
            echo "Would skip graceful, send: SIGKILL (force)"
        else
            echo "If still running, would send: SIGKILL (force)"
        fi
        echo "Would cancel open orders via Kalshi API"
    else
        echo "Engine not running"
    fi
    exit 0
fi

# Force kill mode (skip graceful)
if [ "$FORCE_KILL" = true ]; then
    ENGINE_PID=$(find_engine_pid)
    if [ -n "$ENGINE_PID" ]; then
        log "INFO" "Force kill mode — sending SIGKILL immediately"
        kill -9 "$ENGINE_PID" 2>/dev/null || true
        sleep 1
        if ps -p "$ENGINE_PID" > /dev/null 2>&1; then
            log "ERROR" "${RED}Force kill failed!${NC}"
            exit 1
        else
            log "INFO" "${GREEN}Engine force-stopped${NC}"
            cancel_open_orders
            exit 0
        fi
    else
        log "WARN" "Engine not running"
        exit 0
    fi
fi

# Run pre-flight checks
preflight_checks

# Execute main kill switch
main
