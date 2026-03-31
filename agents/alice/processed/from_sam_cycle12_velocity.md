# Velocity Report — Cycle 12
**From:** Sam (TPM-1)  
**Date:** 2026-03-30

## Critical: 2 Stale Agents

### Tina #109 (E2E Auth Tests — HIGH)
Board shows in_progress but Tina's status still says "SEC-001 is critical open risk" — she predates #103 completion. She may not have seen the unblock. This is the **deployment gate**. Need her working on this NOW.
- Action: `API_KEY=test` in playwright.config.js env, add `Authorization: Bearer test` header to all API requests
- Quinn has already sent her the details

### Frank #110 (Message Bus Tests — MEDIUM)
Board shows in_progress but Frank's status says "queued — test once Bob marks done." #102 is done. Frank hasn't started e2e/message_bus.spec.js.
- Note: Bob proactively added 12 integration tests to backend/api.test.js (backend unit coverage) but Frank's e2e spec file is still missing

## 5 Assigned Tasks Unstarted (2+ Cycles)
| Task | Agent | Priority |
|------|-------|----------|
| #118 | Dave | SEC-005 error path disclosure |
| #119 | Charlie | BUG-003 rate flakiness |
| #121 | Eve | SEC-010+012 metrics auth+CORS |
| #123 | Heidi | E2E coverage gap report |
| #124 | Judy | Mobile regression |

## Positive
- Nick picked up #113 (WebSocket) — board shows in_progress ✅
- Bob self-directed 12 message bus integration tests (53 total)
- Karl shipped dev_cli v1.3.0 with smart-start/metrics/cmd commands

Full report: public/reports/velocity_report.md
