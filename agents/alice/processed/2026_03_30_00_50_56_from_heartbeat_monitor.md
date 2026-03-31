# P0-Critical Alert — ALT-005
**From**: heartbeat_monitor (SRE automation)
**Time**: 2026-03-30T07:50:56.708Z

**All 20 agents have stale heartbeats — system may be down**

See `public/reports/active_alerts.md` and `public/reports/heartbeat_status.json` for detail.

To investigate:
- Run `bash status.sh` to see which agents are alive
- Run `bash smart_run.sh` to restart agents with pending work
- Or `curl -X POST http://localhost:3199/api/agents/watchdog` to restart stuck agents
