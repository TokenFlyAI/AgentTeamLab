#!/bin/bash
#
# Task 269 — CLI Trade Tool
# Author: Liam (SRE)
# Date: 2026-04-03
#
# Wrapper for live_runner.js with convenient flags for manual trading pipeline execution.

set -euo pipefail

# Configuration
LIVE_RUNNER="/Users/chenyangcui/Documents/code/aicompany/agents/bob/backend/strategies/live_runner.js"
OUTPUT_DIR="/Users/chenyangcui/Documents/code/aicompany/agents/bob/output"

# Default values
MODE="dry-run"
STRATEGY=""
MARKETS=""
VERBOSE=false

# Help message
usage() {
    cat << 'EOF'
Trade CLI — Manual Trading Pipeline Runner

USAGE:
    ./trade.sh [OPTIONS]

OPTIONS:
    --dry-run           Simulate trades without execution (default)
    --paper             Execute paper trades (demo mode)
    --live              Execute LIVE trades (requires KALSHI_API_KEY)
    --strategy NAME     Run specific strategy: mean_reversion, momentum, 
                        crypto_edge, nfp_nowcast, econ_edge
    --markets LIST      Comma-separated market tickers (e.g., UNEMP,INFL,BTC)
    --verbose, -v       Show detailed output
    --help, -h          Show this help message

EXAMPLES:
    # Dry run with all strategies (default)
    ./trade.sh

    # Paper trade with mean reversion only
    ./trade.sh --paper --strategy mean_reversion

    # Dry run on specific markets
    ./trade.sh --dry-run --markets UNEMP,INFL

    # Verbose paper trading
    ./trade.sh --paper --verbose

OUTPUT:
    Trade signals written to: agents/bob/output/trade_signals.json

ENVIRONMENT:
    KALSHI_API_KEY      Required for live trading
    KALSHI_DEMO         Set to 'false' for live trading (default: true)
    PAPER_TRADING       Set to 'true' for paper mode (default: true)

EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            MODE="dry-run"
            shift
            ;;
        --paper)
            MODE="paper"
            shift
            ;;
        --live)
            MODE="live"
            shift
            ;;
        --strategy)
            STRATEGY="$2"
            shift 2
            ;;
        --markets)
            MARKETS="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            usage
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Use --help for usage information" >&2
            exit 1
            ;;
    esac
done

# Validate strategy if specified
if [[ -n "$STRATEGY" ]]; then
    VALID_STRATEGIES="mean_reversion momentum crypto_edge nfp_nowcast econ_edge"
    if [[ ! " $VALID_STRATEGIES " =~ " $STRATEGY " ]]; then
        echo "Error: Unknown strategy '$STRATEGY'" >&2
        echo "Valid strategies: $VALID_STRATEGIES" >&2
        exit 1
    fi
fi

# Build environment variables
ENV_VARS=""
case $MODE in
    dry-run)
        echo "🔍 DRY RUN MODE — No trades will be executed"
        ;;
    paper)
        echo "🔵 PAPER TRADING MODE — Demo orders only"
        ENV_VARS="PAPER_TRADING=true"
        ;;
    live)
        echo "🔴 LIVE TRADING MODE — Real orders will be placed!"
        if [[ -z "${KALSHI_API_KEY:-}" ]]; then
            echo "Error: KALSHI_API_KEY not set" >&2
            exit 1
        fi
        ENV_VARS="PAPER_TRADING=false KALSHI_DEMO=false"
        read -p "Confirm live trading? Type 'YES': " confirm
        if [[ "$confirm" != "YES" ]]; then
            echo "Aborted."
            exit 1
        fi
        ;;
esac

# Build node arguments
NODE_ARGS=""
if [[ "$MODE" != "dry-run" ]]; then
    NODE_ARGS="--execute"
fi

# Export strategy filter if specified
if [[ -n "$STRATEGY" ]]; then
    export TRADE_STRATEGY="$STRATEGY"
    echo "Strategy filter: $STRATEGY"
fi

# Export markets filter if specified
if [[ -n "$MARKETS" ]]; then
    export TRADE_MARKETS="$MARKETS"
    echo "Markets filter: $MARKETS"
fi

# Run the pipeline
echo ""
echo "Starting trading pipeline..."
echo "================================"

if [[ "$VERBOSE" == true ]]; then
    echo "Command: node $LIVE_RUNNER $NODE_ARGS"
    echo ""
fi

# Execute
if [[ -n "$ENV_VARS" ]]; then
    env $ENV_VARS node "$LIVE_RUNNER" $NODE_ARGS
else
    node "$LIVE_RUNNER" $NODE_ARGS
fi

# Show results
echo ""
echo "================================"
echo "Pipeline complete!"

if [[ -f "$OUTPUT_DIR/trade_signals.json" ]]; then
    SIGNAL_COUNT=$(grep -c '"strategy"' "$OUTPUT_DIR/trade_signals.json" 2>/dev/null || echo "0")
    echo "Signals generated: $SIGNAL_COUNT"
    echo "Output: $OUTPUT_DIR/trade_signals.json"
    
    if [[ "$VERBOSE" == true ]]; then
        echo ""
        echo "Signal summary:"
        cat "$OUTPUT_DIR/trade_signals.json" | grep -E '"ticker"|"side"|"strategy"' | head -20
    fi
else
    echo "Warning: No output file generated"
fi

echo ""
echo "Done."
