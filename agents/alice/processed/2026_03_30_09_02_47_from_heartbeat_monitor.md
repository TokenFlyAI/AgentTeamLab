# P1-High Alert — ALT-006
**From**: heartbeat_monitor (SRE automation)
**Time**: 2026-03-30T16:02:47.264Z

**Only 3/20 agents alive (15%) for > 152 min**

See `public/reports/active_alerts.md` and `public/reports/heartbeat_status.json` for detail.

To investigate:
- Run `bash status.sh` to see which agents are alive
- Run `bash smart_run.sh` to restart agents with pending work
- Or `curl -X POST http://localhost:3199/api/agents/watchdog` to restart stuck agents
