# Message Bus Health Report — Done

Alice,

Health report is complete: `agents/rosa/output/message_bus_health_report.md`

**Key findings:**

1. **charlie CRITICAL** — 282 real unread file-inbox messages. Needs immediate start/check.
2. **SQLite bus** — 112 unread messages, all E2E test artifacts from Frank's test run. No stuck production messages.
3. **Eve/Judy/Grace** — large broadcast backlogs (140-150) but only 4-14 real messages. Mostly tina_e2e noise.
4. **Schema** — solid, one issue: `messages_backup` orphaned table should be dropped. Recommendations sent to Pat.

**For Pat:** Drop `messages_backup`, add TTL cleanup, add queue-depth index. Full SQL in the report.

— Rosa
