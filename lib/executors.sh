#!/bin/bash
# executors.sh — shared executor metadata and health helpers for shell scripts

_AICOMPANY_SUPPORTED_EXECUTORS=(claude kimi codex gemini)
_AICOMPANY_DEFAULT_EXECUTOR="claude"
_AICOMPANY_DEFAULT_ENABLED_EXECUTORS="claude,kimi"

executor_all() {
    printf '%s\n' "${_AICOMPANY_SUPPORTED_EXECUTORS[@]}"
}

executor_default() {
    echo "${_AICOMPANY_DEFAULT_EXECUTOR}"
}

executor_is_valid() {
    local executor
    executor="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    local item
    for item in "${_AICOMPANY_SUPPORTED_EXECUTORS[@]}"; do
        [ "$executor" = "$item" ] && return 0
    done
    return 1
}

executor_enabled_csv() {
    local configured="${ENABLED_EXECUTORS:-${_AICOMPANY_DEFAULT_ENABLED_EXECUTORS}}"
    local normalized=""
    local item
    IFS=',' read -r -a _items <<< "$configured"
    for item in "${_items[@]}"; do
        item="$(echo "$item" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
        if executor_is_valid "$item"; then
            if [ -z "$normalized" ]; then
                normalized="$item"
            else
                normalized="${normalized},${item}"
            fi
        fi
    done
    if [ -z "$normalized" ]; then
        normalized="claude"
    fi
    echo "$normalized"
}

executor_is_enabled() {
    local executor
    executor="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    executor_is_valid "$executor" || return 1
    local configured
    configured="$(executor_enabled_csv)"
    local item
    IFS=',' read -r -a _items <<< "$configured"
    for item in "${_items[@]}"; do
        [ "$executor" = "$item" ] && return 0
    done
    return 1
}

executor_binary() {
    case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
        claude) echo "claude" ;;
        kimi) echo "kimi" ;;
        codex) echo "codex" ;;
        gemini) echo "gemini" ;;
        *) return 1 ;;
    esac
}

executor_label() {
    case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
        claude) echo "Claude Code" ;;
        kimi) echo "Kimi Code" ;;
        codex) echo "Codex CLI" ;;
        gemini) echo "Gemini CLI" ;;
        *) echo "Unknown Executor" ;;
    esac
}

executor_transport() {
    case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
        claude|kimi|codex|gemini) echo "cli" ;;
        *) echo "unknown" ;;
    esac
}

executor_binary_exists() {
    local bin
    bin="$(executor_binary "$1" 2>/dev/null || true)"
    [ -n "$bin" ] && command -v "$bin" >/dev/null 2>&1
}

executor_auth_status() {
    local executor
    executor="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    case "$executor" in
        codex)
            [ -n "${OPENAI_API_KEY:-}" ] && { echo "configured"; return 0; }
            ;;
        claude)
            [ -n "${ANTHROPIC_API_KEY:-}" ] && { echo "configured"; return 0; }
            ;;
        gemini)
            [ -n "${GEMINI_API_KEY:-}" ] && { echo "configured"; return 0; }
            [ -n "${GOOGLE_API_KEY:-}" ] && { echo "configured"; return 0; }
            ;;
        kimi)
            [ -n "${KIMI_API_KEY:-}" ] && { echo "configured"; return 0; }
            [ -n "${MOONSHOT_API_KEY:-}" ] && { echo "configured"; return 0; }
            ;;
    esac
    executor_binary_exists "$executor" || { echo "missing_binary"; return 0; }
    echo "unknown"
}

executor_auth_hint() {
    case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
        codex) echo "Set OPENAI_API_KEY or run codex login." ;;
        claude) echo "Set ANTHROPIC_API_KEY or run claude auth/login." ;;
        gemini) echo "Set GEMINI_API_KEY/GOOGLE_API_KEY or sign in with Gemini CLI." ;;
        kimi) echo "Set KIMI_API_KEY/MOONSHOT_API_KEY or run kimi login." ;;
        *) echo "Configure executor credentials." ;;
    esac
}
