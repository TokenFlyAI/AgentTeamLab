# Task #175 Complete — Observability Plan

**From**: Rosa  
**Task**: #175 — Observability Plan — Metrics Collection + Alert Thresholds  
**Status**: ✅ COMPLETE

---

## Deliverable

`output/observability_plan.md` — Complete observability architecture covering:

### Metrics Collection (3 Layers)
1. **In-process** (server.js): apiMetrics class — per-endpoint latency, errors, throughput
2. **Synthetic** (scripts): healthcheck.js + heartbeat_monitor.js — polling-based checks
3. **Infrastructure** (AWS): CloudWatch Alarms via Terraform — ECS/RDS/ALB metrics

### Alert Thresholds (10 Alerts → 6 SLOs)
| Alert ID | Condition | Severity | SLO |
|----------|-----------|----------|-----|
| ALT-001 | /api/health non-200 > 30s | P0 | SLO-001 (99.5% availability) |
| ALT-002 | p99 latency > 500ms/5min | P1 | SLO-002 (p99 < 500ms) |
| ALT-003 | /api/agents p95 > 300ms/10min | P1 | SLO-003 (p95 < 300ms) |
| ALT-004 | /api/tasks p95 > 500ms/10min | P2 | SLO-004 (p95 < 500ms) |
| ALT-005 | 0 agents alive | P0 | SLO-005 (≥50% alive) |
| ALT-006 | <25% agents alive/10min | P1 | SLO-005 |
| ALT-007 | 429 rate > 10%/5min | P2 | SLO-006 (<5% 429s) |
| ALT-008 | Server not responding | P0 | — |
| ALT-009 | Heap > 400MB/5min | P1 | — |
| ALT-010 | 5xx rate > 1%/5min | P1 | — |

### SNS Routing
- `tokenfly-p0-critical` → PagerDuty + #incidents
- `tokenfly-p1-alert` → #alerts + on-call email
- `tokenfly-p2-warning` → #alerts (low-priority)

### Implementation Status
✅ **Complete**: CloudWatch alarms (`infrastructure/alarms.tf`), SNS topics (`infrastructure/sns.tf`)  
⏳ **Pending**: Liam's synthetic scripts (healthcheck.js, heartbeat_monitor.js) — tracked in his SRE plan

### Custom Metrics Namespace
`Tokenfly/API` — for application-level metrics emitted via CloudWatch agent

---

Let me know if you need any adjustments to thresholds or additional coverage.

— Rosa
