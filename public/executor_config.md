# Agent Executor Configuration

This file configures which AI CLI executor (Claude Code or Kimi Code) each agent uses.

## Supported Executors

| Executor | CLI Command | Notes |
|----------|-------------|-------|
| `claude` | `claude -p ...` | Anthropic Claude Code CLI (default) |
| `kimi` | `kimi -p ...` | Moonshot Kimi Code CLI |

## Global Default

The default executor for all agents unless overridden below:

```yaml
executor: claude
```

## Per-Agent Overrides

Override the global default for specific agents:

| Agent | Executor | Notes |
|-------|----------|-------|
| alice | claude | Acting CEO - keep on Claude for stability |
| bob | claude | Backend Engineer |

## How Configuration Works

Configuration is resolved in this priority order:

1. **`agents/{name}/executor.txt`** — Per-agent override (highest priority)
2. **`public/executor_config.md`** — This file's per-agent table
3. **`public/executor_config.md`** — Global default section
4. **Fallback** — `claude` (lowest priority)

## Quick Start

### Switch an agent to Kimi:

**Option A: Via file**
```bash
echo "kimi" > agents/bob/executor.txt
```

**Option B: Via dashboard**
- Go to agent modal → Settings → Change Executor

### Switch global default:

Edit this file and change the `executor:` line under "Global Default".

## Notes

- Session IDs are stored separately per executor (`session_id.txt` vs `session_id_kimi.txt`)
- Agents can be mixed: some on Claude, some on Kimi
- Changing executor resets the agent's session (fresh start next cycle)
