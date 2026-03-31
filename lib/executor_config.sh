#!/bin/bash
# executor_config.sh — Helper functions for executor configuration
# Source this file to use: source "$(dirname "$0")/lib/executor_config.sh"

# Get executor for an agent (with priority resolution)
# Usage: get_executor <agent_name> [<company_dir>]
# Returns: "claude" or "kimi"
get_executor() {
    local AGENT_NAME="$1"
    local COMPANY_DIR="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local AGENT_DIR="${COMPANY_DIR}/agents/${AGENT_NAME}"
    local CONFIG_FILE="${COMPANY_DIR}/public/executor_config.md"
    
    # Priority 1: Per-agent executor.txt
    if [ -f "${AGENT_DIR}/executor.txt" ]; then
        local EXECUTOR=$(cat "${AGENT_DIR}/executor.txt" 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        if [ "$EXECUTOR" = "claude" ] || [ "$EXECUTOR" = "kimi" ]; then
            echo "$EXECUTOR"
            return 0
        fi
    fi
    
    # Priority 2: Per-agent table in executor_config.md
    if [ -f "$CONFIG_FILE" ]; then
        local FROM_TABLE=$(grep "^| ${AGENT_NAME} |" "$CONFIG_FILE" 2>/dev/null | head -1 | awk -F'|' '{print $3}' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        if [ "$FROM_TABLE" = "claude" ] || [ "$FROM_TABLE" = "kimi" ]; then
            echo "$FROM_TABLE"
            return 0
        fi
    fi
    
    # Priority 3: Global default in executor_config.md
    if [ -f "$CONFIG_FILE" ]; then
        local GLOBAL_DEFAULT=$(grep -A1 "^## Global Default" "$CONFIG_FILE" 2>/dev/null | grep "^executor:" | head -1 | awk -F':' '{print $2}' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        if [ "$GLOBAL_DEFAULT" = "claude" ] || [ "$GLOBAL_DEFAULT" = "kimi" ]; then
            echo "$GLOBAL_DEFAULT"
            return 0
        fi
    fi
    
    # Priority 4: Fallback
    echo "claude"
}

# Set executor for an agent
# Usage: set_executor <agent_name> <claude|kimi> [<company_dir>]
set_executor() {
    local AGENT_NAME="$1"
    local EXECUTOR="$2"
    local COMPANY_DIR="${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local AGENT_DIR="${COMPANY_DIR}/agents/${AGENT_NAME}"
    
    # Validate
    if [ "$EXECUTOR" != "claude" ] && [ "$EXECUTOR" != "kimi" ]; then
        echo "Error: Executor must be 'claude' or 'kimi'" >&2
        return 1
    fi
    
    # Create agent dir if needed
    mkdir -p "$AGENT_DIR"
    
    # Write executor.txt
    echo "$EXECUTOR" > "${AGENT_DIR}/executor.txt"
    echo "[executor] Set ${AGENT_NAME} → ${EXECUTOR}"
}

# Get session ID file path based on executor
# Usage: get_session_id_file <agent_dir> <executor>
get_session_id_file() {
    local AGENT_DIR="$1"
    local EXECUTOR="$2"
    
    if [ "$EXECUTOR" = "kimi" ]; then
        echo "${AGENT_DIR}/session_id_kimi.txt"
    else
        echo "${AGENT_DIR}/session_id.txt"
    fi
}

# Get session cycle file path based on executor
# Usage: get_session_cycle_file <agent_dir> <executor>
get_session_cycle_file() {
    local AGENT_DIR="$1"
    local EXECUTOR="$2"
    
    if [ "$EXECUTOR" = "kimi" ]; then
        echo "${AGENT_DIR}/session_cycle_kimi.txt"
    else
        echo "${AGENT_DIR}/session_cycle.txt"
    fi
}

# Get settings file path based on executor
# Usage: get_settings_file <agent_name> <executor>
get_settings_file() {
    local AGENT_NAME="$1"
    local EXECUTOR="$2"
    
    if [ "$EXECUTOR" = "kimi" ]; then
        echo "/tmp/aicompany_kimi_settings_${AGENT_NAME}.toml"
    else
        echo "/tmp/aicompany_settings_${AGENT_NAME}.json"
    fi
}

# List all agents and their executors
# Usage: list_agent_executors [<company_dir>]
list_agent_executors() {
    local COMPANY_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local AGENTS_DIR="${COMPANY_DIR}/agents"
    
    for agent_dir in "$AGENTS_DIR"/*; do
        if [ -d "$agent_dir" ]; then
            local name=$(basename "$agent_dir")
            local executor=$(get_executor "$name" "$COMPANY_DIR")
            echo "${name}:${executor}"
        fi
    done
}
