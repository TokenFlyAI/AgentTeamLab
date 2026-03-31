# P1-High Alert — ALT-006
**From**: heartbeat_monitor (SRE automation)
**Time**: 2026-03-30T21:04:28.652Z

**Only 1/20 agents alive (5%) for > 250 min**

See `public/reports/active_alerts.md` and `public/reports/heartbeat_status.json` for detail.

To investigate:
- Run `bash status.sh` to see which agents are alive
- Run `bash smart_run.sh` to restart agents with pending work
- Or `curl -X POST http://localhost:3199/api/agents/watchdog` to restart stuck agents
