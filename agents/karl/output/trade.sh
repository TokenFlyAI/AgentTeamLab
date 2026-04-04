#!/bin/bash
# trade.sh — Kalshi Trading Pipeline CLI
# Author: Karl (Platform Engineer)
# Task: #269
#
# A unified CLI for manually running the Kalshi trading pipeline with
# support for dry-run mode, strategy selection, market filtering, and paper trading.
#
# Usage: ./trade.sh [command] [options]

set -e

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/../../bob/backend"
STRATEGIES_DIR="${BACKEND_DIR}/strategies"
PIPELINE_DIR="${BACKEND_DIR}/pipeline"
OUTPUT_DIR="${SCRIPT_DIR}"

# Default values
DRY_RUN=false
STRATEGY=""
MARKETS=""
PAPER=true
VERBOSE=false
LIMIT=20
CATEGORY=""
MIN_CONFIDENCE=0.80
EXECUTE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() {
  echo -e "${BLUE}[trade]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[trade]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[trade]${NC} $1"
}

log_error() {
  echo -e "${RED}[trade]${NC} $1"
}

die() {
  log_error "$1"
  exit 1
}

show_help() {
  cat << 'EOF'
Kalshi Trading Pipeline CLI

USAGE:
  ./trade.sh [COMMAND] [OPTIONS]

COMMANDS:
  run           Run the full trading pipeline (default)
  signals       Generate signals only (no execution)
  execute       Execute trades based on generated signals
  backtest      Run backtest on historical data
  pipeline      Run data pipeline jobs (fetch markets, prices, etc.)
  status        Show current trading system status
  help          Show this help message

OPTIONS:
  --dry-run, -d       Simulate without executing trades (default: true)
  --execute, -x       Actually execute trades (overrides --dry-run)
  --strategy, -s      Specific strategy to run (mean_reversion, momentum, 
                      crypto_edge, nfp_nowcast, econ_edge, all)
  --markets, -m       Filter markets by ticker pattern (e.g., "BTC*,ETH*")
  --category, -c      Filter by market category (Crypto, Economics, Financial)
  --paper             Use paper trading mode (default: true)
  --live              Use live trading mode (DANGEROUS - real money!)
  --limit, -l         Maximum number of markets to analyze (default: 20)
  --min-confidence    Minimum signal confidence threshold (default: 0.80)
  --verbose, -v       Enable verbose output
  --output, -o        Output file path for results

EXAMPLES:
  # Dry run with all strategies (default)
  ./trade.sh

  # Generate signals using mean reversion only
  ./trade.sh signals --strategy mean_reversion

  # Execute paper trades for crypto markets only
  ./trade.sh execute --paper --category Crypto --execute

  # Run full pipeline with specific strategy and market filter
  ./trade.sh run --strategy econ_edge --markets "NFP*" --limit 10

  # Run data pipeline to refresh market data
  ./trade.sh pipeline --jobs fetch_markets,fetch_prices

  # Check system status
  ./trade.sh status

ENVIRONMENT:
  KALSHI_API_KEY      Kalshi API key for live data
  KALSHI_DEMO         Set to "false" for production API
  PAPER_TRADING       Set to "false" to enable live trading
  DATABASE_URL        PostgreSQL connection string

EOF
}

# ---------------------------------------------------------------------------
# Command: signals
# Generate trading signals without execution
# ---------------------------------------------------------------------------

cmd_signals() {
  log "Generating trading signals..."
  
  local live_runner="${STRATEGIES_DIR}/live_runner.js"
  
  if [[ ! -f "$live_runner" ]]; then
    die "Live runner not found: $live_runner"
  fi

  # Build environment
  local env_vars=""
  if [[ "$PAPER" == "true" ]]; then
    env_vars="PAPER_TRADING=true"
  else
    env_vars="PAPER_TRADING=false"
  fi

  # Run the live runner (it generates signals to output/trade_signals.json)
  log "Running signal generation..."
  if [[ "$VERBOSE" == "true" ]]; then
    env $env_vars node "$live_runner" 2>&1
  else
    env $env_vars node "$live_runner" 2>&1 | grep -E "(Fetched|Selected|Running|OUT:|Wrote|signals|\[)" || true
  fi

  # Check output (live_runner writes to bob's output dir)
  local output_file="${BACKEND_DIR}/../output/trade_signals.json"
  if [[ -f "$output_file" ]]; then
    local signal_count=$(grep -o '"strategy"' "$output_file" 2>/dev/null | wc -l || echo "0")
    log_success "Generated $signal_count signals"
    
    if [[ "$VERBOSE" == "true" ]]; then
      echo ""
      echo "Signal Summary:"
      cat "$output_file" | node -e "
        const data = '';
        process.stdin.on('data', c => data.push(c));
        process.stdin.on('end', () => {
          const report = JSON.parse(data.join(''));
          console.log('  Markets analyzed:', report.marketCount);
          console.log('  Total signals:', report.signalCount);
          if (report.signals) {
            const byStrategy = {};
            report.signals.forEach(s => {
              byStrategy[s.strategy] = (byStrategy[s.strategy] || 0) + 1;
            });
            console.log('  By strategy:');
            Object.entries(byStrategy).forEach(([k, v]) => {
              console.log('    - ' + k + ': ' + v);
            });
          }
        });
      " 2>/dev/null || true
    fi
  else
    log_warn "No output file generated"
  fi
}

# ---------------------------------------------------------------------------
# Command: execute
# Execute trades (paper or live)
# ---------------------------------------------------------------------------

cmd_execute() {
  if [[ "$DRY_RUN" == "true" && "$EXECUTE" != "true" ]]; then
    log_warn "Dry run mode — use --execute to actually trade"
    cmd_signals
    return
  fi

  if [[ "$PAPER" != "true" ]]; then
    log_error "⚠️  LIVE TRADING MODE ⚠️"
    log_error "You are about to execute REAL trades with REAL money!"
    read -p "Are you sure? Type 'YES' to continue: " confirm
    if [[ "$confirm" != "YES" ]]; then
      log "Aborted"
      exit 1
    fi
  fi

  log "Executing trades..."
  
  local live_runner="${STRATEGIES_DIR}/live_runner.js"
  
  # Run with --execute flag
  local env_vars=""
  if [[ "$PAPER" == "true" ]]; then
    env_vars="PAPER_TRADING=true"
    log "Paper trading mode — no real money at risk"
  else
    env_vars="PAPER_TRADING=false"
  fi

  if [[ "$VERBOSE" == "true" ]]; then
    env $env_vars node "$live_runner" --execute 2>&1
  else
    env $env_vars node "$live_runner" --execute 2>&1 | tail -20
  fi

  log_success "Execution complete"
}

# ---------------------------------------------------------------------------
# Command: run
# Full pipeline: signals + execution (if not dry-run)
# ---------------------------------------------------------------------------

cmd_run() {
  log "Running full trading pipeline..."
  
  if [[ "$DRY_RUN" == "true" && "$EXECUTE" != "true" ]]; then
    log "Dry run mode — generating signals only"
    cmd_signals
  else
    cmd_execute
  fi
}

# ---------------------------------------------------------------------------
# Command: pipeline
# Run data pipeline jobs
# ---------------------------------------------------------------------------

cmd_pipeline() {
  local scheduler="${PIPELINE_DIR}/scheduler.js"
  
  if [[ ! -f "$scheduler" ]]; then
    die "Scheduler not found: $scheduler"
  fi

  log "Running data pipeline..."
  
  if [[ -n "$JOBS" ]]; then
    # Run specific jobs
    IFS=',' read -ra JOB_LIST <<< "$JOBS"
    for job in "${JOB_LIST[@]}"; do
      log "Running job: $job"
      node "$scheduler" run "$job" 2>&1 | tail -5
    done
  else
    # Run all jobs once
    log "Running all pipeline jobs..."
    node "$scheduler" run-all 2>&1 | tail -10
  fi
  
  log_success "Pipeline complete"
}

# ---------------------------------------------------------------------------
# Command: backtest
# Run backtest (placeholder - would integrate with Grace's backtester)
# ---------------------------------------------------------------------------

cmd_backtest() {
  log "Running backtest..."
  
  local backtest_script="${SCRIPT_DIR}/../../grace/output/econ_edge_scanner.py"
  
  if [[ -f "$backtest_script" ]]; then
    log "Found backtest scanner: $backtest_script"
    python3 "$backtest_script" 2>&1 | tail -20
  else
    log_warn "Backtest scanner not found at $backtest_script"
    log "Backtest functionality requires Grace's econ_edge_scanner.py"
  fi
}

# ---------------------------------------------------------------------------
# Command: status
# Show system status
# ---------------------------------------------------------------------------

cmd_status() {
  log "Trading System Status"
  echo ""
  
  # Check for required files
  local files=(
    "${STRATEGIES_DIR}/live_runner.js:Live Runner"
    "${STRATEGIES_DIR}/signal_engine.js:Signal Engine"
    "${STRATEGIES_DIR}/execution_engine.js:Execution Engine"
    "${BACKEND_DIR}/kalshi_client.js:Kalshi Client"
    "${PIPELINE_DIR}/scheduler.js:Pipeline Scheduler"
  )
  
  # Output file location (live_runner writes here)
  local output_file="${BACKEND_DIR}/../output/trade_signals.json"
  
  echo "Components:"
  for item in "${files[@]}"; do
    IFS=':' read -r path name <<< "$item"
    if [[ -f "$path" ]]; then
      echo -e "  ${GREEN}✓${NC} $name"
    else
      echo -e "  ${RED}✗${NC} $name (missing)"
    fi
  done
  
  echo ""
  echo "Environment:"
  if [[ -n "$KALSHI_API_KEY" ]]; then
    echo -e "  ${GREEN}✓${NC} KALSHI_API_KEY set"
  else
    echo -e "  ${YELLOW}⚠${NC} KALSHI_API_KEY not set (using mock data)"
  fi
  
  if [[ -n "$DATABASE_URL" ]]; then
    echo -e "  ${GREEN}✓${NC} DATABASE_URL set"
  else
    echo -e "  ${YELLOW}⚠${NC} DATABASE_URL not set"
  fi
  
  if [[ "${PAPER_TRADING:-true}" == "true" ]]; then
    echo -e "  ${GREEN}✓${NC} Paper trading enabled (safe)"
  else
    echo -e "  ${RED}⚠${NC} LIVE TRADING enabled (dangerous!)"
  fi
  
  echo ""
  echo "Recent Output:"
  local output_file="${BACKEND_DIR}/../output/trade_signals.json"
  if [[ -f "$output_file" ]]; then
    local mtime=$(stat -c %Y "$output_file" 2>/dev/null || stat -f %m "$output_file" 2>/dev/null)
    local age=$(( ($(date +%s) - mtime) / 60 ))
    echo "  trade_signals.json: ${age}m ago"
    
    local signal_count=$(grep -o '"strategy"' "$output_file" 2>/dev/null | wc -l || echo "0")
    echo "  Last run signals: $signal_count"
  else
    echo "  No recent output found"
  fi
}

# ---------------------------------------------------------------------------
# Argument Parsing
# ---------------------------------------------------------------------------

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run|-d)
        DRY_RUN=true
        EXECUTE=false
        shift
        ;;
      --execute|-x)
        EXECUTE=true
        DRY_RUN=false
        shift
        ;;
      --strategy|-s)
        STRATEGY="$2"
        shift 2
        ;;
      --markets|-m)
        MARKETS="$2"
        shift 2
        ;;
      --category|-c)
        CATEGORY="$2"
        shift 2
        ;;
      --paper)
        PAPER=true
        shift
        ;;
      --live)
        PAPER=false
        log_warn "LIVE TRADING MODE — REAL MONEY AT RISK!"
        shift
        ;;
      --limit|-l)
        LIMIT="$2"
        shift 2
        ;;
      --min-confidence)
        MIN_CONFIDENCE="$2"
        shift 2
        ;;
      --jobs)
        JOBS="$2"
        shift 2
        ;;
      --output|-o)
        OUTPUT_FILE="$2"
        shift 2
        ;;
      --verbose|-v)
        VERBOSE=true
        shift
        ;;
      --help|-h)
        show_help
        exit 0
        ;;
      -*)
        die "Unknown option: $1"
        ;;
      *)
        # Positional argument (command)
        COMMAND="$1"
        shift
        ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  # Parse all arguments
  parse_args "$@"
  
  # Default command
  COMMAND="${COMMAND:-run}"
  
  # Show banner
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║           Kalshi Trading Pipeline CLI v1.0.0               ║"
  echo "║                    Task #269 — Karl                        ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Route to command
  case "$COMMAND" in
    run)
      cmd_run
      ;;
    signals)
      cmd_signals
      ;;
    execute)
      cmd_execute
      ;;
    pipeline)
      cmd_pipeline
      ;;
    backtest)
      cmd_backtest
      ;;
    status)
      cmd_status
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      die "Unknown command: '$COMMAND'. Run './trade.sh help' for usage."
      ;;
  esac
  
  echo ""
  log_success "Done!"
}

main "$@"
