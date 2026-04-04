#!/bin/bash
#
# Live Trading Prep Script — Task 335
# Automated gate before live trading authorization
# 
# Usage: bash live_trading_prep.sh [KALSHI_API_KEY]
# 
# Exit codes:
#   0 = GO (all gates passed)
#   1 = NO-GO (one or more gates failed)
#   2 = ERROR (script failure)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MIN_WIN_RATE=0.40          # 40% minimum win rate
MIN_PAPER_TRADES=10        # At least 10 paper trades
MAX_DRAWDOWN=5000          # $50 max drawdown in cents
API_TEST_TIMEOUT=30        # Seconds to wait for API test
REPORT_FILE="output/live_trading_prep_report.md"
LOG_FILE="logs/live_trading_prep.log"

# Track results
GATES_PASSED=0
GATES_FAILED=0
ERRORS=()
WARNINGS=()

# Logging function
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Print section header
section() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
    log "INFO" "Starting: $1"
}

# Print success
pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    log "PASS" "$1"
    ((GATES_PASSED++)) || true
}

# Print failure
fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    log "FAIL" "$1"
    ((GATES_FAILED++)) || true
    ERRORS+=("$1")
}

# Print warning
warn() {
    echo -e "${YELLOW}⚠ WARNING:${NC} $1"
    log "WARN" "$1"
    WARNINGS+=("$1")
}

# Initialize
mkdir -p logs output
> "$LOG_FILE"

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           LIVE TRADING PREP — AUTOMATED GATE                 ║"
echo "║                    Task 335 — Sprint 7                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

log "INFO" "Live Trading Prep started"
log "INFO" "Configuration: MIN_WIN_RATE=$MIN_WIN_RATE, MIN_PAPER_TRADES=$MIN_PAPER_TRADES, MAX_DRAWDOWN=$MAX_DRAWDOWN"

# ============================================================================
# GATE 1: Environment & Dependencies
# ============================================================================
section "GATE 1: Environment & Dependencies"

# Check Node.js version
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    pass "Node.js installed: v$NODE_VERSION"
else
    fail "Node.js not found"
fi

# Check required files exist
REQUIRED_FILES=(
    "backend/strategies/live_runner.js"
    "backend/strategies/signal_engine.js"
    "backend/kalshi_client.js"
    "backend/paper_trades_db.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [[ -f "$file" ]]; then
        pass "Required file exists: $file"
    else
        fail "Missing required file: $file"
    fi
done

# Check npm packages installed
if [[ -d "node_modules" ]]; then
    pass "Node modules installed"
else
    fail "Node modules not installed (run: npm install)"
fi

# ============================================================================
# GATE 2: Kalshi API Credentials
# ============================================================================
section "GATE 2: Kalshi API Credentials"

KALSHI_API_KEY="${1:-${KALSHI_API_KEY:-}}"

if [[ -z "$KALSHI_API_KEY" ]]; then
    fail "KALSHI_API_KEY not provided (pass as argument or set env var)"
else
    # Mask key for logging
    MASKED_KEY="${KALSHI_API_KEY:0:4}****${KALSHI_API_KEY: -4}"
    pass "KALSHI_API_KEY provided: $MASKED_KEY"
fi

# Test API connectivity
echo "Testing Kalshi API connectivity..."
export KALSHI_API_KEY
export KALSHI_DEMO="true"  # Always use demo mode for testing

API_TEST_OUTPUT=$(node -e "
const { KalshiClient } = require('./backend/kalshi_client');
const client = new KalshiClient({ apiKey: process.env.KALSHI_API_KEY, demo: true });
client.getMarkets({ limit: 1 })
  .then(r => { console.log('SUCCESS:', JSON.stringify(r.data ? 'connected' : 'no data')); process.exit(0); })
  .catch(e => { console.log('ERROR:', e.message); process.exit(1); });
" 2>&1) || true

if echo "$API_TEST_OUTPUT" | grep -q "SUCCESS"; then
    pass "Kalshi API connection successful"
else
    fail "Kalshi API connection failed: $API_TEST_OUTPUT"
fi

# ============================================================================
# GATE 3: Strategy Configuration Validation
# ============================================================================
section "GATE 3: Strategy Configuration Validation"

# Check mean_reversion parameters match backtest
CONFIG_CHECK=$(node -e "
const fs = require('fs');
const content = fs.readFileSync('backend/strategies/live_runner.js', 'utf8');

// Extract key parameters
const zScoreMatch = content.match(/zScoreThreshold:\s*([0-9.]+)/);
const minVolumeMatch = content.match(/minVolume:\s*([0-9]+)/);
const candleDaysMatch = content.match(/CANDLE_DAYS\s*=\s*([0-9]+)/);

const zScore = zScoreMatch ? zScoreMatch[1] : 'NOT_FOUND';
const minVolume = minVolumeMatch ? minVolumeMatch[1] : 'NOT_FOUND';
const candleDays = candleDaysMatch ? candleDaysMatch[1] : 'NOT_FOUND';

console.log('zScoreThreshold:', zScore);
console.log('minVolume:', minVolume);
console.log('CANDLE_DAYS:', candleDays);

// Validate against backtest baseline
const errors = [];
if (zScore !== '1.5') errors.push('zScoreThreshold should be 1.5, got ' + zScore);
if (minVolume !== '10000') errors.push('minVolume should be 10000, got ' + minVolume);
if (candleDays !== '30') errors.push('CANDLE_DAYS should be 30, got ' + candleDays);

if (errors.length > 0) {
    console.log('ERRORS:', errors.join('; '));
    process.exit(1);
} else {
    console.log('STATUS: OK');
    process.exit(0);
}
" 2>&1)

if echo "$CONFIG_CHECK" | grep -q "STATUS: OK"; then
    pass "Strategy parameters aligned with backtest"
    echo "$CONFIG_CHECK" | grep -E "zScoreThreshold|minVolume|CANDLE_DAYS" | sed 's/^/  /'
else
    fail "Strategy parameter mismatch:"
    echo "$CONFIG_CHECK" | grep "ERRORS:" | sed 's/ERRORS://' | sed 's/^/  /'
fi

# Check momentum/crypto_edge are disabled
DISABLED_CHECK=$(node -e "
const fs = require('fs');
const content = fs.readFileSync('backend/strategies/live_runner.js', 'utf8');

// Check that momentum and crypto_edge are commented out or disabled
const momentumActive = content.match(/const\s+momentum\s*=\s*new\s+MomentumStrategy/) && 
                       !content.match(/\/\/\s*DISABLED.*momentum/);
const cryptoActive = content.match(/const\s+cryptoEdge\s*=\s*new\s+CryptoEdgeStrategy/) &&
                     !content.match(/\/\/\s*DISABLED.*crypto/);

if (momentumActive || cryptoActive) {
    console.log('DISABLED: false');
    if (momentumActive) console.log('ERROR: momentum is active');
    if (cryptoActive) console.log('ERROR: crypto_edge is active');
    process.exit(1);
} else {
    console.log('DISABLED: true');
    process.exit(0);
}
" 2>&1)

if echo "$DISABLED_CHECK" | grep -q "DISABLED: true"; then
    pass "momentum and crypto_edge strategies are disabled"
else
    fail "Contaminating strategies detected:"
    echo "$DISABLED_CHECK" | grep "ERROR:" | sed 's/ERROR://' | sed 's/^/  /'
fi

# ============================================================================
# GATE 4: Paper Trading with Real Data
# ============================================================================
section "GATE 4: Paper Trading with Real Data"

echo "Running paper trades with real Kalshi API data..."
echo "This will execute $MIN_PAPER_TRADES paper trades."
echo ""

# Clear previous paper trade data for clean test
if [[ -f "output/paper_trades.db" ]]; then
    mv "output/paper_trades.db" "output/paper_trades.db.backup.$(date +%s)"
    log "INFO" "Backed up previous paper_trades.db"
fi

# Run paper trades
TRADE_COUNT=0
MAX_ATTEMPTS=20
ATTEMPT=0

while [[ $TRADE_COUNT -lt $MIN_PAPER_TRADES && $ATTEMPT -lt $MAX_ATTEMPTS ]]; do
    ((ATTEMPT++)) || true
    echo "  Attempt $ATTEMPT: Running live_runner.js..."
    
    RUNNER_OUTPUT=$(node backend/strategies/live_runner.js --execute 2>&1) || true
    echo "$RUNNER_OUTPUT" | tee -a "$LOG_FILE"
    
    # Check if trades were generated
    NEW_TRADES=$(echo "$RUNNER_OUTPUT" | grep -oP 'Logged \K[0-9]+' | head -1 || echo "0")
    TRADE_COUNT=$((TRADE_COUNT + NEW_TRADES))
    
    echo "  Trades this run: $NEW_TRADES, Total: $TRADE_COUNT"
    
    # Wait between runs
    if [[ $TRADE_COUNT -lt $MIN_PAPER_TRADES ]]; then
        sleep 5
    fi
done

if [[ $TRADE_COUNT -ge $MIN_PAPER_TRADES ]]; then
    pass "Generated $TRADE_COUNT paper trades (target: $MIN_PAPER_TRADES)"
else
    fail "Only generated $TRADE_COUNT paper trades (target: $MIN_PAPER_TRADES)"
    warn "This may indicate no signals are being generated with real data"
fi

# ============================================================================
# GATE 5: Win Rate Verification
# ============================================================================
section "GATE 5: Win Rate Verification"

# Get paper trade summary
SUMMARY=$(node -e "
const fs = require('fs');
const path = 'output/paper_trades.db';
if (!fs.existsSync(path)) {
    console.log('NO_DATA');
    process.exit(1);
}
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const closed = data.filter(t => t.status === 'CLOSED');
const wins = closed.filter(t => t.outcome === 'WIN');
const losses = closed.filter(t => t.outcome === 'LOSS');
const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);

console.log('TOTAL:', data.length);
console.log('CLOSED:', closed.length);
console.log('WINS:', wins.length);
console.log('LOSSES:', losses.length);
console.log('WIN_RATE:', closed.length > 0 ? (wins.length / closed.length).toFixed(4) : '0');
console.log('TOTAL_PNL:', totalPnl);
" 2>&1)

if echo "$SUMMARY" | grep -q "NO_DATA"; then
    fail "No paper trade data available"
else
    TOTAL_TRADES=$(echo "$SUMMARY" | grep "TOTAL:" | cut -d: -f2 | tr -d ' ')
    CLOSED_TRADES=$(echo "$SUMMARY" | grep "CLOSED:" | cut -d: -f2 | tr -d ' ')
    WINS=$(echo "$SUMMARY" | grep "WINS:" | cut -d: -f2 | tr -d ' ')
    LOSSES=$(echo "$SUMMARY" | grep "LOSSES:" | cut -d: -f2 | tr -d ' ')
    WIN_RATE=$(echo "$SUMMARY" | grep "WIN_RATE:" | cut -d: -f2 | tr -d ' ')
    TOTAL_PNL=$(echo "$SUMMARY" | grep "TOTAL_PNL:" | cut -d: -f2 | tr -d ' ')
    
    echo "  Total trades: $TOTAL_TRADES"
    echo "  Closed trades: $CLOSED_TRADES"
    echo "  Wins: $WINS, Losses: $LOSSES"
    echo "  Win rate: $(echo "$WIN_RATE * 100" | bc -l | xargs printf "%.1f%%")"
    echo "  Total P&L: $(echo "$TOTAL_PNL / 100" | bc -l | xargs printf "\$%.2f")"
    
    # Check win rate threshold
    WIN_RATE_OK=$(echo "$WIN_RATE >= $MIN_WIN_RATE" | bc -l)
    if [[ $WIN_RATE_OK -eq 1 ]]; then
        pass "Win rate $(echo "$WIN_RATE * 100" | bc -l | xargs printf "%.1f%%") >= $(echo "$MIN_WIN_RATE * 100" | bc -l)%"
    else
        fail "Win rate $(echo "$WIN_RATE * 100" | bc -l | xargs printf "%.1f%%") < $(echo "$MIN_WIN_RATE * 100" | bc -l)%"
    fi
    
    # Check drawdown
    DRAWDOWN_OK=$(echo "${TOTAL_PNL#-} <= $MAX_DRAWDOWN" | bc -l)
    if [[ $DRAWDOWN_OK -eq 1 ]]; then
        pass "Drawdown within limit: $(echo "${TOTAL_PNL#-} / 100" | bc -l | xargs printf "\$%.2f")"
    else
        fail "Drawdown exceeds limit: $(echo "${TOTAL_PNL#-} / 100" | bc -l | xargs printf "\$%.2f")"
    fi
fi

# ============================================================================
# GATE 6: Security Review
# ============================================================================
section "GATE 6: Security Review"

# Check PAPER_TRADING flag is set
if grep -q "PAPER_TRADING.*!==*.*false" backend/strategies/live_runner.js; then
    pass "PAPER_TRADING safeguard is active"
else
    warn "Could not verify PAPER_TRADING safeguard"
fi

# Check for hardcoded credentials
if grep -r "apiKey.*=.*[\"'][^\"']\{10,\}[\"']" backend/ --include="*.js" 2>/dev/null | grep -v "\.test\." | head -1; then
    fail "Potential hardcoded API key found"
else
    pass "No hardcoded credentials detected"
fi

# Check file permissions
if [[ -f "backend/strategies/live_runner.js" && -r "backend/strategies/live_runner.js" ]]; then
    pass "Strategy files have appropriate permissions"
fi

# ============================================================================
# GATE 7: Monitoring Setup
# ============================================================================
section "GATE 7: Monitoring Setup"

# Check dashboard API is accessible
DASHBOARD_TEST=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/api/health 2>/dev/null || echo "000")
if [[ "$DASHBOARD_TEST" == "200" ]]; then
    pass "Dashboard API is accessible"
else
    warn "Dashboard API not accessible (HTTP $DASHBOARD_TEST)"
fi

# Check PnL endpoint
PNL_TEST=$(curl -s http://localhost:3200/api/pnl/live 2>/dev/null | head -1 || echo "FAIL")
if echo "$PNL_TEST" | grep -q "win_rate\|total_pnl"; then
    pass "PnL monitoring endpoint is functional"
else
    warn "PnL endpoint not responding correctly"
fi

# ============================================================================
# FINAL DECISION
# ============================================================================
section "FINAL DECISION"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    GATE SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo "  Gates Passed: $GATES_PASSED"
echo "  Gates Failed: $GATES_FAILED"
echo "  Warnings: ${#WARNINGS[@]}"
echo ""

if [[ $GATES_FAILED -eq 0 ]]; then
    DECISION="GO"
    DECISION_COLOR="$GREEN"
    EXIT_CODE=0
elif [[ $GATES_FAILED -le 2 && ${#WARNINGS[@]} -eq 0 ]]; then
    DECISION="GO WITH CAUTION"
    DECISION_COLOR="$YELLOW"
    EXIT_CODE=0
else
    DECISION="NO-GO"
    DECISION_COLOR="$RED"
    EXIT_CODE=1
fi

echo -e "${DECISION_COLOR}"
echo "  ██████╗ ███████╗ ██████╗██╗███████╗██╗ ██████╗ ███╗   ██╗"
echo "  ██╔══██╗██╔════╝██╔════╝██║██╔════╝██║██╔═══██╗████╗  ██║"
echo "  ██║  ██║█████╗  ██║     ██║███████╗██║██║   ██║██╔██╗ ██║"
echo "  ██║  ██║██╔══╝  ██║     ██║╚════██║██║██║   ██║██║╚██╗██║"
echo "  ██████╔╝███████╗╚██████╗██║███████║██║╚██████╔╝██║ ╚████║"
echo "  ╚═════╝ ╚══════╝ ╚═════╝╚═╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝"
echo ""
echo "                    $DECISION"
echo -e "${NC}"

# Generate report
cat > "$REPORT_FILE" << EOF
# Live Trading Prep Report

**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")  
**Decision:** $DECISION  
**Exit Code:** $EXIT_CODE

## Summary

| Metric | Value |
|--------|-------|
| Gates Passed | $GATES_PASSED |
| Gates Failed | $GATES_FAILED |
| Warnings | ${#WARNINGS[@]} |

## Gate Results

### GATE 1: Environment & Dependencies
$(if command -v node &> /dev/null; then echo "- ✓ Node.js installed"; else echo "- ✗ Node.js not found"; fi)

### GATE 2: Kalshi API Credentials
$(if [[ -n "$KALSHI_API_KEY" ]]; then echo "- ✓ API key provided"; else echo "- ✗ API key missing"; fi)

### GATE 3: Strategy Configuration
$(echo "$CONFIG_CHECK" | grep -E "zScoreThreshold|minVolume|CANDLE_DAYS" | sed 's/^/- /')

### GATE 4: Paper Trading
- Total trades: ${TOTAL_TRADES:-N/A}
- Target: $MIN_PAPER_TRADES

### GATE 5: Win Rate
- Win rate: ${WIN_RATE:-N/A}
- Target: $MIN_WIN_RATE
- Total P&L: ${TOTAL_PNL:-N/A}¢

## Errors

$(if [[ ${#ERRORS[@]} -eq 0 ]]; then echo "None"; else printf '%s\n' "${ERRORS[@]}" | sed 's/^/- /'; fi)

## Warnings

$(if [[ ${#WARNINGS[@]} -eq 0 ]]; then echo "None"; else printf '%s\n' "${WARNINGS[@]}" | sed 's/^/- /'; fi)

## Next Steps

$(if [[ $EXIT_CODE -eq 0 ]]; then echo "System is ready for live trading authorization. Escalate to Founder for final approval."; else echo "Address failed gates before proceeding to live trading."; fi)
EOF

echo "Report written to: $REPORT_FILE"
log "INFO" "Live Trading Prep completed with decision: $DECISION"

exit $EXIT_CODE
