# Fleet Control - Portal Smart Run Guide

## Overview

Fleet Control allows you to manage the Smart Run daemon directly from the Agent Planet portal. You can:

- Start/stop the daemon
- Set the maximum number of agents to maintain
- Monitor running agents in real-time
- Adjust settings on-the-fly

## Architecture

```
Portal UI (Fleet tab)
    ↓
server.js API (/api/smart-run/*)
    ↓
smart_run_config.json
    ↓
smart_run.sh --daemon (maintains agent pool)
```

## API Endpoints

### GET /api/smart-run/config
Returns the current configuration:
```json
{
  "config": {
    "max_agents": 3,
    "enabled": false,
    "interval_seconds": 30,
    "mode": "smart"
  },
  "daemon": {
    "running": true,
    "pid": 12345
  }
}
```

### POST /api/smart-run/config
Update configuration:
```json
{ "max_agents": 5 }
```

### POST /api/smart-run/start
Start the daemon.

### POST /api/smart-run/stop
Stop the daemon gracefully.

### GET /api/smart-run/status
Get detailed status including running agents.

## Using the Portal UI

1. **Navigate to the Fleet tab** in the portal
2. **View current status**: See daemon state, running agents, target pool size
3. **Adjust pool size**: Use the slider to set 0-20 agents
4. **Start/Stop daemon**: Click the buttons to control the daemon
5. **Monitor agents**: See which agents are currently running

## CLI Usage

### Start daemon
```bash
./smart_run.sh --daemon
```

### Stop daemon
```bash
./smart_run.sh --stop
```

### Check status
```bash
./smart_run.sh --status
```

### One-shot run (original behavior)
```bash
./smart_run.sh --max 3
```

## Configuration File

`public/smart_run_config.json`:
```json
{
  "max_agents": 3,
  "enabled": true,
  "interval_seconds": 30,
  "mode": "smart",
  "force_alice": true
}
```

## How It Works

1. **Daemon Mode**: When started with `--daemon`, smart_run.sh runs continuously
2. **Pool Maintenance**: Every 30 seconds (configurable), it checks:
   - How many agents are running
   - How many should be running (max_agents)
   - Which agents have work to do
3. **Agent Selection**: Uses priority order:
   - Alice first (if work exists)
   - Task-assigned agents
   - Unassigned task claimers
   - Inbox-only agents
4. **Auto-Scaling**: When agents finish, new ones are started to maintain the pool

## Safety Features

- **Max cap**: Hard limit of 20 agents
- **Graceful shutdown**: SIGTERM stops daemon cleanly
- **Config validation**: API validates all inputs
- **Stale PID cleanup**: Automatically removes stale PID files
- **Real-time updates**: Config changes apply without restart

## Troubleshooting

### Daemon won't start
```bash
# Check if already running
./smart_run.sh --status

# Kill stale process if needed
rm .smart_run_daemon.pid
```

### Too many agents running
```bash
# Set max_agents to 0 to pause new launches
# Then stop existing agents manually
./stop_all.sh
```

### Check logs
Daemon output is silent (backgrounded). Check agent logs:
```bash
./status.sh
```

## Cost Optimization Tips

1. **Start small**: Set max_agents to 2-3 initially
2. **Use Kimi**: Most agents use Kimi (cheaper), only Alice uses Claude
3. **Monitor costs**: Check the Stats tab regularly
4. **Pause when idle**: Set max_agents to 0 to pause launches

## Integration with Existing Features

- **Smart Start**: Uses same selection logic as original smart_run.sh
- **Task Board**: Reads tasks from public/task_board.md
- **Inbox**: Checks chat_inbox for unread messages
- **Status**: Integrates with existing status.sh reporting
