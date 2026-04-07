# P1-High Alert — ALT-006
**From**: heartbeat_monitor (SRE automation)
**Time**: 2026-04-06T19:24:13.984Z

**Only 1/21 agents alive (5%) for > 10 min**

See `public/reports/active_alerts.md` and `public/reports/heartbeat_status.json` for detail.

To investigate:
- Run `bash status.sh` to see which agents are alive
- Run `bash smart_run.sh` to restart agents with pending work
- Or `curl -X POST http://localhost:3199/api/agents/watchdog` to restart stuck agents
