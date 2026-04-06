#!/bin/bash
# executor_config.sh — Helper functions for executor configuration
# Source this file to use: source "$(dirname "$0")/lib/executor_config.sh"

_EXECUTOR_CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${_EXECUTOR_CONFIG_DIR}/executors.sh"

_executor_paths() {
    local company_dir="${1:-$(cd "${_EXECUTOR_CONFIG_DIR}/.." && pwd)}"
    local _agents="${AGENTS_DIR:-${company_dir}/agents}"
    local _shared="${SHARED_DIR:-${company_dir}/public}"
    if [ -f "${company_dir}/lib/paths.sh" ] && [ -z "$AGENTS_DIR" ]; then
        source "${company_dir}/lib/paths.sh" 2>/dev/null || true
        _agents="${AGENTS_DIR:-${company_dir}/agents}"
        _shared="${SHARED_DIR:-${company_dir}/public}"
    fi
    echo "${_agents}|${_shared}"
}

# Get executor for an agent (with priority resolution)
# Usage: get_executor <agent_name> [<company_dir>]
get_executor() {
    local agent_name="$1"
    local company_dir="${2:-$(cd "${_EXECUTOR_CONFIG_DIR}/.." && pwd)}"
    local resolved
    resolved="$(_executor_paths "$company_dir")"
    local _agents="${resolved%%|*}"
    local _shared="${resolved#*|}"
    local agent_dir="${_agents}/${agent_name}"
    local config_file="${_shared}/executor_config.md"

    if [ -f "${agent_dir}/executor.txt" ]; then
        local executor
        executor="$(cat "${agent_dir}/executor.txt" 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
        if executor_is_valid "$executor"; then
            echo "$executor"
            return 0
        fi
    fi

    if [ -f "$config_file" ]; then
        local from_table
        from_table="$(grep "^| ${agent_name} |" "$config_file" 2>/dev/null | head -1 | awk -F'|' '{print $3}' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
        if executor_is_valid "$from_table"; then
            echo "$from_table"
            return 0
        fi
    fi

    if [ -f "$config_file" ]; then
        local global_default
        global_default="$(grep -A1 "^## Global Default" "$config_file" 2>/dev/null | grep "^executor:" | head -1 | awk -F':' '{print $2}' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
        if executor_is_valid "$global_default"; then
            echo "$global_default"
            return 0
        fi
    fi

    executor_default
}

# Set executor for an agent
# Usage: set_executor <agent_name> <executor> [<company_dir>]
set_executor() {
    local agent_name="$1"
    local executor
    executor="$(echo "$2" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    local company_dir="${3:-$(cd "${_EXECUTOR_CONFIG_DIR}/.." && pwd)}"
    local resolved
    resolved="$(_executor_paths "$company_dir")"
    local _agents="${resolved%%|*}"
    local agent_dir="${_agents}/${agent_name}"

    if ! executor_is_valid "$executor"; then
        echo "Error: Executor must be one of: $(executor_all | tr '\n' ' ' | sed 's/ $//')" >&2
        return 1
    fi

    mkdir -p "$agent_dir"
    echo "$executor" > "${agent_dir}/executor.txt"
    echo "[executor] Set ${agent_name} → ${executor}"
}

_legacy_session_id_file() {
    local agent_dir="$1"
    local executor="$2"
    case "$executor" in
        kimi) echo "${agent_dir}/session_id_kimi.txt" ;;
        claude) echo "${agent_dir}/session_id.txt" ;;
        *) return 1 ;;
    esac
}

_legacy_session_cycle_file() {
    local agent_dir="$1"
    local executor="$2"
    case "$executor" in
        kimi) echo "${agent_dir}/session_cycle_kimi.txt" ;;
        claude) echo "${agent_dir}/session_cycle.txt" ;;
        *) return 1 ;;
    esac
}

get_session_id_file() {
    local agent_dir="$1"
    local executor
    executor="$(echo "$2" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    local generic="${agent_dir}/session_id_${executor}.txt"
    local legacy
    legacy="$(_legacy_session_id_file "$agent_dir" "$executor" 2>/dev/null || true)"
    if [ -f "$generic" ]; then
        echo "$generic"
    elif [ -n "$legacy" ] && [ -f "$legacy" ]; then
        echo "$legacy"
    else
        echo "$generic"
    fi
}

get_session_cycle_file() {
    local agent_dir="$1"
    local executor
    executor="$(echo "$2" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    local generic="${agent_dir}/session_cycle_${executor}.txt"
    local legacy
    legacy="$(_legacy_session_cycle_file "$agent_dir" "$executor" 2>/dev/null || true)"
    if [ -f "$generic" ]; then
        echo "$generic"
    elif [ -n "$legacy" ] && [ -f "$legacy" ]; then
        echo "$legacy"
    else
        echo "$generic"
    fi
}

get_settings_file() {
    local agent_name="$1"
    local executor
    executor="$(echo "$2" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    local ext="json"
    [ "$executor" = "kimi" ] && ext="toml"
    echo "/tmp/aicompany_${executor}_settings_${agent_name}.${ext}"
}

list_agent_executors() {
    local company_dir="${1:-$(cd "${_EXECUTOR_CONFIG_DIR}/.." && pwd)}"
    local resolved
    resolved="$(_executor_paths "$company_dir")"
    local _agents="${resolved%%|*}"

    for agent_dir in "$_agents"/*; do
        if [ -d "$agent_dir" ]; then
            local name
            name="$(basename "$agent_dir")"
            local executor
            executor="$(get_executor "$name" "$company_dir")"
            echo "${name}:${executor}"
        fi
    done
}
