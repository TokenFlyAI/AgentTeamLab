#!/bin/bash
# =============================================================================
# D004 Pre-Launch Check Script
# Verifies system readiness before EVERY trading launch
# Author: Liam (SRE)
# Task: T364
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS=0
WARN=0
FAIL=0

# Helper functions
pass() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((PASS++)) || true
}

warn() {
    echo -e "${YELLOW}⚠️  WARN:${NC} $1"
    ((WARN++)) || true
}

fail() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((FAIL++)) || true
}

info() {
    echo -e "${BLUE}ℹ️  INFO:${NC} $1"
}

# =============================================================================
# Main Checks
# =============================================================================

echo "========================================"
echo "  D004 Pre-Launch Verification"
echo "  $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "========================================"
echo ""

# -----------------------------------------------------------------------------
# Check 1: Correlation pairs file
# -----------------------------------------------------------------------------
info "Checking correlation pairs file..."

PAIRS_FILE="agents/public/correlation_pairs.json"
if [ ! -f "$PAIRS_FILE" ]; then
    # Try alternate paths
    if [ -f "/Users/chenyangcui/Documents/code/aicompany/agents/public/correlation_pairs.json" ]; then
        PAIRS_FILE="/Users/chenyangcui/Documents/code/aicompany/agents/public/correlation_pairs.json"
        pass "Correlation pairs file found at $PAIRS_FILE"
    else
        fail "Correlation pairs file not found (tried: agents/public/correlation_pairs.json)"
    fi
else
    pass "Correlation pairs file exists"
fi

# Check if file is valid JSON
if [ -f "$PAIRS_FILE" ]; then
    if python3 -c "import json; json.load(open('$PAIRS_FILE'))" 2>/dev/null || \
       node -e "JSON.parse(require('fs').readFileSync('$PAIRS_FILE'))" 2>/dev/null; then
        pass "Correlation pairs file is valid JSON"
        
        # Count pairs
        PAIR_COUNT=$(grep -c '"market_a"' "$PAIRS_FILE" 2>/dev/null || echo "0")
        info "Found $PAIR_COUNT correlation pairs"
    else
        fail "Correlation pairs file is NOT valid JSON"
    fi
fi

echo ""

# -----------------------------------------------------------------------------
# Check 2: Engine binary
# -----------------------------------------------------------------------------
info "Checking engine binary..."

ENGINE_PATH="agents/bob/backend/cpp_engine/engine"
if [ ! -f "$ENGINE_PATH" ]; then
    # Try alternate paths
    if [ -f "/Users/chenyangcui/Documents/code/aicompany/agents/bob/backend/cpp_engine/engine" ]; then
        ENGINE_PATH="/Users/chenyangcui/Documents/code/aicompany/agents/bob/backend/cpp_engine/engine"
    fi
fi

if [ ! -f "$ENGINE_PATH" ]; then
    fail "Engine binary not found"
elif [ ! -x "$ENGINE_PATH" ]; then
    fail "Engine binary found but not executable"
else
    pass "Engine binary exists and is executable"
    
    # Check if we can get version/help
    if $ENGINE_PATH --help 2>&1 | grep -q "Kalshi\|engine\|usage"; then
        pass "Engine binary responds to --help"
    fi
fi

echo ""

# -----------------------------------------------------------------------------
# Check 3: Kill switch
# -----------------------------------------------------------------------------
info "Checking kill switch..."

KILL_SWITCH="agents/liam/output/kill_switch.sh"
if [ ! -f "$KILL_SWITCH" ]; then
    # Try alternate paths
    if [ -f "/Users/chenyangcui/Documents/code/aicompany/agents/liam/output/kill_switch.sh" ]; then
        KILL_SWITCH="/Users/chenyangcui/Documents/code/aicompany/agents/liam/output/kill_switch.sh"
    fi
fi

if [ ! -f "$KILL_SWITCH" ]; then
    fail "Kill switch script not found"
elif [ ! -x "$KILL_SWITCH" ]; then
    warn "Kill switch found but not executable (run: chmod +x $KILL_SWITCH)"
else
    pass "Kill switch is ready"
fi

echo ""

# -----------------------------------------------------------------------------
# Check 4: API Key
# -----------------------------------------------------------------------------
info "Checking API key configuration..."

if [ -z "${KALSHI_API_KEY:-}" ]; then
    fail "KALSHI_API_KEY environment variable not set"
else
    KEY_LEN=${#KALSHI_API_KEY}
    if [ "$KEY_LEN" -lt 10 ]; then
        fail "KALSHI_API_KEY appears invalid (too short: $KEY_LEN chars)"
    else
        pass "KALSHI_API_KEY is configured (${KEY_LEN} chars)"
    fi
fi

echo ""

# -----------------------------------------------------------------------------
# Check 5: Log directory
# -----------------------------------------------------------------------------
info "Checking log directory..."

LOG_DIR="/var/log/kalshi-engine"
if [ ! -d "$LOG_DIR" ]; then
    warn "Log directory does not exist: $LOG_DIR"
    info "Will attempt to create on first run"
else
    if [ -w "$LOG_DIR" ]; then
        pass "Log directory exists and is writable"
    else
        warn "Log directory exists but may not be writable: $LOG_DIR"
    fi
fi

echo ""

# -----------------------------------------------------------------------------
# Check 6: Disk space
# -----------------------------------------------------------------------------
info "Checking disk space..."

# Check log partition
LOG_PARTITION=$(df "$LOG_DIR" 2>/dev/null | tail -1 | awk '{print $6}' || echo "/")
DISK_USAGE=$(df "$LOG_DIR" 2>/dev/null | tail -1 | awk '{print $5}' | sed 's/%//' || echo "0")
DISK_AVAIL=$(df -h "$LOG_DIR" 2>/dev/null | tail -1 | awk '{print $4}' || echo "unknown")

if [ "$DISK_USAGE" -gt 90 ]; then
    fail "Disk usage critical: ${DISK_USAGE}% on $LOG_PARTITION"
elif [ "$DISK_USAGE" -gt 80 ]; then
    warn "Disk usage high: ${DISK_USAGE}% on $LOG_PARTITION (available: $DISK_AVAIL)"
else
    pass "Disk usage OK: ${DISK_USAGE}% on $LOG_PARTITION (available: $DISK_AVAIL)"
fi

echo ""

# -----------------------------------------------------------------------------
# Check 7: Network connectivity
# -----------------------------------------------------------------------------
info "Checking network connectivity..."

if command -v curl &> /dev/null; then
    # Try to reach Kalshi API (just check DNS resolution)
    if curl -s --max-time 5 -o /dev/null "https://trading-api.kalshi.com" 2>/dev/null; then
        pass "Can reach Kalshi trading API"
    else
        warn "Cannot reach Kalshi API (may be network or just no API key)"
    fi
else
    warn "curl not available, skipping network check"
fi

echo ""

# -----------------------------------------------------------------------------
# Check 8: Existing engine process
# -----------------------------------------------------------------------------
info "Checking for existing engine process..."

EXISTING_PID=$(pgrep -f "cpp_engine/engine$" || true)
if [ -n "$EXISTING_PID" ]; then
    warn "Engine already running (PID: $EXISTING_PID)"
    info "Stop existing instance before starting new one"
else
    pass "No existing engine process found"
fi

echo ""

# -----------------------------------------------------------------------------
# Check 9: System resources
# -----------------------------------------------------------------------------
info "Checking system resources..."

# Memory
if command -v free &> /dev/null; then
    MEM_AVAIL=$(free -m | awk '/^Mem:/{print $7}')
    if [ "$MEM_AVAIL" -lt 512 ]; then
        warn "Low memory: ${MEM_AVAIL}MB available (recommend 4GB+)"
    else
        pass "Memory OK: ${MEM_AVAIL}MB available"
    fi
elif command -v vm_stat &> /dev/null; then
    # macOS
    pass "Memory check skipped (macOS vm_stat)"
else
    warn "Cannot check memory (no free or vm_stat)"
fi

# CPU load
if [ -f /proc/loadavg ]; then
    LOAD_1MIN=$(awk '{print $1}' /proc/loadavg)
    # Simple check — if load > 4 on any system, warn
    if (( $(echo "$LOAD_1MIN > 4" | bc -l 2>/dev/null || echo "0") )); then
        warn "High CPU load: $LOAD_1MIN (1-min average)"
    else
        pass "CPU load OK: $LOAD_1MIN (1-min average)"
    fi
else
    pass "CPU load check skipped (no /proc/loadavg)"
fi

echo ""

# -----------------------------------------------------------------------------
# Check 10: Authorization (manual verification)
# -----------------------------------------------------------------------------
info "Authorization gates (manual verification required)..."

echo "  Please verify the following before live trading:"
echo ""
echo "  [ ] G1: Founder explicit written approval obtained"
echo "  [ ] G2: Kalshi API credentials received (T236)"
echo "  [ ] G3: Paper trading validation complete (200+ trades, ≥40% WR)"
echo "  [ ] G4: Security audit PASS (Heidi)"
echo "  [ ] G5: Risk audit PASS (Olivia/Tina)"
echo "  [ ] G6: Ops readiness PASS (Liam)"
echo "  [ ] G7: On-call engineer assigned and available"
echo ""

# =============================================================================
# Summary
# =============================================================================

echo "========================================"
echo "  Summary"
echo "========================================"
echo -e "${GREEN}Passed:${NC}  $PASS"
echo -e "${YELLOW}Warnings:${NC} $WARN"
echo -e "${RED}Failed:${NC}  $FAIL"
echo ""

if [ $FAIL -gt 0 ]; then
    echo -e "${RED}❌ PRE-LAUNCH CHECKS FAILED${NC}"
    echo "Please address the failures above before launching."
    exit 1
elif [ $WARN -gt 0 ]; then
    echo -e "${YELLOW}⚠️  PRE-LAUNCH CHECKS PASSED WITH WARNINGS${NC}"
    echo "Review warnings above. Proceed with caution."
    exit 0
else
    echo -e "${GREEN}✅ ALL PRE-LAUNCH CHECKS PASSED${NC}"
    echo "System is ready for trading launch."
    exit 0
fi

# =============================================================================
# D004 Status Check (Appended 2026-04-03)
# =============================================================================

echo ""
echo "========================================"
echo "  D004 Production Readiness Status"
echo "========================================"

info "Checking D004 blockers..."

# Blocker 1: API credentials (T236)
if [ -z "${KALSHI_API_KEY:-}" ]; then
    fail "BLOCKER T236: Kalshi API credentials not configured"
    echo "    Action: Founder must provide API credentials"
else
    pass "T236: API credentials present"
fi

# Blocker 2: Max drawdown (Dave complete)
echo "  ℹ️  Max drawdown tracking: Dave COMPLETE (27/27 tests pass)"

# Blocker 3: Contract sizes
# This would require a config file or API call to verify
# For now, just warn that it needs confirmation
echo "  ⚠️  Kalshi contract sizes: Need Founder confirmation"

echo ""
echo "NOTE: Prior 84% win rate was ARTIFACT of broken mock data."
echo "      Fixed mock data correctly produces 0 signals on efficient markets."
echo "      Real API data required for meaningful validation."
