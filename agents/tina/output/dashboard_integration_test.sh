#!/bin/bash
#
# Kalshi Alpha Dashboard — Integration Test
# Author: Tina (General Engineer)
# Purpose: End-to-end validation of the dashboard system
#

set -e

API_BASE="http://localhost:3200"
TEST_RESULTS_FILE="/Users/chenyangcui/Documents/code/aicompany/agents/tina/output/dashboard_test_results.md"
PASSED=0
FAILED=0
TOTAL=0

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    PASSED=$((PASSED + 1))
    TOTAL=$((TOTAL + 1))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
}

# Initialize results file
cat > "$TEST_RESULTS_FILE" << 'EOF'
# Kalshi Alpha Dashboard — Integration Test Results

**Test Run:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**Tester:** Tina
**Purpose:** End-to-end validation of dashboard API, frontend, and pipeline

## Test Summary

| Test Case | Status | Details |
|-----------|--------|---------|
EOF

log_info "Starting Dashboard Integration Tests..."
log_info "API Base: $API_BASE"
echo ""

# Test 1: API Server Health
echo -n "Test 1: API server is running... "
if curl -s "$API_BASE/api/signals" > /dev/null 2>&1; then
    log_pass "API server responding"
    echo "| API Server Health | ✅ PASS | Responding on port 3200 |" >> "$TEST_RESULTS_FILE"
else
    log_fail "API server not responding"
    echo "| API Server Health | ❌ FAIL | No response on port 3200 |" >> "$TEST_RESULTS_FILE"
fi

# Test 2: Signals Endpoint
echo -n "Test 2: GET /api/signals returns valid JSON... "
SIGNALS_RESPONSE=$(curl -s "$API_BASE/api/signals" 2>/dev/null)
if echo "$SIGNALS_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    SIGNAL_COUNT=$(echo "$SIGNALS_RESPONSE" | jq '.signals | length')
    log_pass "Signals endpoint OK ($SIGNAL_COUNT signals)"
    echo "| GET /api/signals | ✅ PASS | $SIGNAL_COUNT signals returned |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Signals endpoint error"
    echo "| GET /api/signals | ❌ FAIL | Invalid response |" >> "$TEST_RESULTS_FILE"
fi

# Test 3: Signals have required fields
echo -n "Test 3: Signals have required fields... "
if echo "$SIGNALS_RESPONSE" | jq -e '.signals[0] | has("ticker") and has("side") and has("currentPrice") and has("recommendedContracts")' > /dev/null 2>&1; then
    log_pass "All required fields present"
    echo "| Signal Fields | ✅ PASS | ticker, side, currentPrice, recommendedContracts |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Missing required fields"
    echo "| Signal Fields | ❌ FAIL | Missing fields |" >> "$TEST_RESULTS_FILE"
fi

# Test 4: Health Endpoint
echo -n "Test 4: GET /api/health returns strategy status... "
HEALTH_RESPONSE=$(curl -s "$API_BASE/api/health" 2>/dev/null)
if echo "$HEALTH_RESPONSE" | jq -e '.success == true and has("strategies")' > /dev/null 2>&1; then
    STRATEGY_COUNT=$(echo "$HEALTH_RESPONSE" | jq '.strategies | length')
    log_pass "Health endpoint OK ($STRATEGY_COUNT strategies)"
    echo "| GET /api/health | ✅ PASS | $STRATEGY_COUNT strategies monitored |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Health endpoint error"
    echo "| GET /api/health | ❌ FAIL | Invalid response |" >> "$TEST_RESULTS_FILE"
fi

# Test 5: PnL Endpoint
echo -n "Test 5: GET /api/pnl returns P&L data... "
PNL_RESPONSE=$(curl -s "$API_BASE/api/pnl" 2>/dev/null)
if echo "$PNL_RESPONSE" | jq -e '.success == true and has("total_pnl")' > /dev/null 2>&1; then
    TOTAL_PNL=$(echo "$PNL_RESPONSE" | jq '.total_pnl')
    log_pass "PnL endpoint OK (PnL: $TOTAL_PNL)"
    echo "| GET /api/pnl | ✅ PASS | total_pnl: $TOTAL_PNL |" >> "$TEST_RESULTS_FILE"
else
    log_fail "PnL endpoint error"
    echo "| GET /api/pnl | ❌ FAIL | Invalid response |" >> "$TEST_RESULTS_FILE"
fi

# Test 6: Edges Endpoint
echo -n "Test 6: GET /api/edges returns market edges... "
EDGES_RESPONSE=$(curl -s "$API_BASE/api/edges" 2>/dev/null)
if echo "$EDGES_RESPONSE" | jq -e '.success == true and has("edges")' > /dev/null 2>&1; then
    EDGE_COUNT=$(echo "$EDGES_RESPONSE" | jq '.edges | length')
    log_pass "Edges endpoint OK ($EDGE_COUNT edges)"
    echo "| GET /api/edges | ✅ PASS | $EDGE_COUNT edges returned |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Edges endpoint error"
    echo "| GET /api/edges | ❌ FAIL | Invalid response |" >> "$TEST_RESULTS_FILE"
fi

# Test 7: Pipeline Run Endpoint
echo -n "Test 7: POST /api/run-pipeline triggers pipeline... "
RUN_RESPONSE=$(curl -s -X POST "$API_BASE/api/run-pipeline" 2>/dev/null)
if echo "$RUN_RESPONSE" | jq -e '.success == true and has("signal_count")' > /dev/null 2>&1; then
    NEW_SIGNAL_COUNT=$(echo "$RUN_RESPONSE" | jq '.signal_count')
    ELAPSED_MS=$(echo "$RUN_RESPONSE" | jq '.elapsed_ms')
    log_pass "Pipeline triggered OK ($NEW_SIGNAL_COUNT signals in ${ELAPSED_MS}ms)"
    echo "| POST /api/run-pipeline | ✅ PASS | $NEW_SIGNAL_COUNT signals in ${ELAPSED_MS}ms |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Pipeline trigger failed"
    echo "| POST /api/run-pipeline | ❌ FAIL | Invalid response |" >> "$TEST_RESULTS_FILE"
fi

# Test 8: Frontend File Exists
echo -n "Test 8: Frontend index.html exists... "
FRONTEND_PATH="/Users/chenyangcui/Documents/code/aicompany/agents/bob/backend/dashboard/index.html"
if [ -f "$FRONTEND_PATH" ]; then
    FILE_SIZE=$(stat -f%z "$FRONTEND_PATH" 2>/dev/null || stat -c%s "$FRONTEND_PATH" 2>/dev/null)
    log_pass "Frontend exists ($FILE_SIZE bytes)"
    echo "| Frontend File | ✅ PASS | index.html ($FILE_SIZE bytes) |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Frontend not found"
    echo "| Frontend File | ❌ FAIL | index.html not found |" >> "$TEST_RESULTS_FILE"
fi

# Test 9: Trade Signals File
echo -n "Test 9: trade_signals.json exists and is valid... "
SIGNALS_FILE="/Users/chenyangcui/Documents/code/aicompany/agents/bob/output/trade_signals.json"
if [ -f "$SIGNALS_FILE" ]; then
    if jq -e . "$SIGNALS_FILE" > /dev/null 2>&1; then
        FILE_AGE_MIN=$(( ($(date +%s) - $(stat -f%m "$SIGNALS_FILE" 2>/dev/null || stat -c%Y "$SIGNALS_FILE" 2>/dev/null)) / 60 ))
        log_pass "Signals file valid (updated $FILE_AGE_MIN min ago)"
        echo "| Signals File | ✅ PASS | Valid JSON, updated ${FILE_AGE_MIN}m ago |" >> "$TEST_RESULTS_FILE"
    else
        log_fail "Signals file is invalid JSON"
        echo "| Signals File | ❌ FAIL | Invalid JSON |" >> "$TEST_RESULTS_FILE"
    fi
else
    log_fail "Signals file not found"
    echo "| Signals File | ❌ FAIL | File not found |" >> "$TEST_RESULTS_FILE"
fi

# Test 10: Scheduler Script
echo -n "Test 10: Pipeline scheduler script exists... "
SCHEDULER_PATH="/Users/chenyangcui/Documents/code/aicompany/agents/bob/backend/dashboard/run_scheduler.sh"
if [ -f "$SCHEDULER_PATH" ]; then
    if [ -x "$SCHEDULER_PATH" ]; then
        log_pass "Scheduler script exists and is executable"
        echo "| Scheduler Script | ✅ PASS | run_scheduler.sh exists and executable |" >> "$TEST_RESULTS_FILE"
    else
        log_pass "Scheduler script exists (not executable)"
        echo "| Scheduler Script | ✅ PASS | run_scheduler.sh exists |" >> "$TEST_RESULTS_FILE"
    fi
else
    log_fail "Scheduler script not found"
    echo "| Scheduler Script | ❌ FAIL | Not found |" >> "$TEST_RESULTS_FILE"
fi

# Test 11: Monitor Script
echo -n "Test 11: Monitor script exists... "
MONITOR_PATH="/Users/chenyangcui/Documents/code/aicompany/agents/bob/backend/dashboard/monitor.js"
if [ -f "$MONITOR_PATH" ]; then
    log_pass "Monitor script exists"
    echo "| Monitor Script | ✅ PASS | monitor.js exists |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Monitor script not found"
    echo "| Monitor Script | ❌ FAIL | Not found |" >> "$TEST_RESULTS_FILE"
fi

# Test 12: API Response Times
echo -n "Test 12: API response times under 1 second... "
START_TIME=$(date +%s%N 2>/dev/null || echo $(($(date +%s) * 1000000000)))
curl -s "$API_BASE/api/signals" > /dev/null 2>&1
END_TIME=$(date +%s%N 2>/dev/null || echo $(($(date +%s) * 1000000000)))
RESPONSE_TIME_MS=$(( (END_TIME - START_TIME) / 1000000 ))
if [ "$RESPONSE_TIME_MS" -lt 1000 ]; then
    log_pass "Response time OK (${RESPONSE_TIME_MS}ms)"
    echo "| Response Time | ✅ PASS | ${RESPONSE_TIME_MS}ms |" >> "$TEST_RESULTS_FILE"
else
    log_fail "Response time too slow (${RESPONSE_TIME_MS}ms)"
    echo "| Response Time | ❌ FAIL | ${RESPONSE_TIME_MS}ms (target <1000ms) |" >> "$TEST_RESULTS_FILE"
fi

echo ""
echo "========================================"
echo "           TEST SUMMARY"
echo "========================================"
echo -e "${GREEN}PASSED: $PASSED${NC}"
echo -e "${RED}FAILED: $FAILED${NC}"
echo ""

# Complete the results file
cat >> "$TEST_RESULTS_FILE" << EOF

## Summary

- **Total Tests:** $((PASSED + FAILED))
- **Passed:** $PASSED
- **Failed:** $FAILED
- **Success Rate:** $(( PASSED * 100 / (PASSED + FAILED) ))%

## Conclusion

EOF

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    echo "The Kalshi Alpha Dashboard is fully operational." >> "$TEST_RESULTS_FILE"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo "Dashboard has issues that need attention." >> "$TEST_RESULTS_FILE"
    exit 1
fi
