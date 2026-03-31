# Task Risk Analysis Report

**Generated:** 2026-03-30 13:12  
**Author:** Ivan (ML Engineer)  
**Model:** Task Risk Analyzer v1.0  

## Summary

| Tier | Count | Description |
|------|-------|-------------|
| 🔴 CRITICAL | 0 | Blocked or severely at-risk — escalate now |
| 🟠 HIGH | 1 | High stall risk — monitor daily |
| 🟡 MEDIUM | 3 | Some risk factors present |
| 🟢 LOW | 6 | On track |

**Total active tasks:** 10  
**Fleet health avg:** 78/100  

## 🟠 HIGH Risk Tasks

| ID | Title | Assignee | Health | Status | Priority | Risk Score | Top Factor |
|----|-------|----------|--------|--------|----------|------------|------------|
| #114 | Database Migration Execution — Run  | pat | 73/100 | blocked | high | **68** | status:blocked |

### #114: Database Migration Execution — Run Pending Migrations

**Assignee:** pat  
**Assignee Health:** 73/100  
**Assignee Trend:** unknown  
**Status:** blocked  **Priority:** high  **Risk:** 68/100  

**Risk Factors:**
- `status:blocked` (+50)
- `age:0.6d` (+3)
- `assignee_health:73/100` (+8)
- `blocked_keywords` (+20)
- `complexity:4` (+4)

**Recommended Actions:**
- Escalate to Alice — task has been blocked, needs human intervention or re-routing
- High-priority + high-risk = immediate attention required

## 🟡 MEDIUM Risk Tasks

| ID | Title | Assignee | Health | Status | Priority | Risk Score | Top Factor |
|----|-------|----------|--------|--------|----------|------------|------------|
| #118 | Fix SEC-005 — Remove Internal Path  | dave | 58/100 | open | medium | **40** | status:open_unstarted |
| #124 | Mobile Regression Testing — Judy's  | judy | 80/100 | open | low | **40** | status:open_unstarted |
| #119 | BUG-003 — Fix E2E Test Flakiness (r | charlie | 77/100 | open | medium | **37** | status:open_unstarted |

## 🟢 LOW Risk Tasks

| ID | Title | Assignee | Health | Status | Priority | Risk Score | Top Factor |
|----|-------|----------|--------|--------|----------|------------|------------|
| #125 | E2E-Filter-Task-E2EFilter1774876310 | dave | 58/100 | open | critical | **34** | status:open_unstarted |
| #121 | Fix SEC-010 + SEC-012 — Metrics Aut | eve | 92/100 | open | medium | **32** | status:open_unstarted |
| #123 | E2E Coverage Gap Report — Identify  | heidi | 82/100 | open | medium | **32** | status:open_unstarted |
| #110 | Message Bus Integration Tests | frank | 87/100 | in_progress | medium | **21** | status:in_progress |
| #109 | E2E Auth Tests — Update Suite for A | tina | 73/100 | in_progress | high | **20** | status:in_progress |
| #113 | WebSocket Support — Real-Time Agent | nick | 90/100 | in_progress | high | **18** | status:in_progress |

## Risk Model

Risk score (0–100) is computed from:

| Factor | Max Impact | Notes |
|--------|-----------|-------|
| Status (blocked/open/in_progress) | +50 | Blocked tasks get max penalty |
| Task age | +40 | +5 per day since creation |
| Assignee health | +30 | (100 - health) × 0.3 |
| No assignee | +20 | Unassigned = drifting |
| Blocked keywords in notes | +20 | "blocked", "waiting", "depends" |
| Declining agent trend | +15 | From health_trend_tracker data |
| Task complexity | +10 | Estimated from description length |
| Priority multiplier | ×0.8–1.2 | Low-priority tasks drift more |
