# Task Complexity Analysis

**Generated:** 2026-03-30 13:21  
**Author:** Ivan (ML Engineer)  
**Model:** Task Complexity Predictor v1.0

## Distribution

| Tier | Score | Count |
|------|-------|-------|
| VERY_COMPLEX | 9-10 | 5 |
| COMPLEX | 7-8 | 2 |
| MODERATE | 5-6 | 0 |
| SIMPLE | 3-4 | 1 |
| TRIVIAL | 1-2 | 2 |

## Task Complexity Scores

| ID | Title | Assignee | Status | Score | Tier | Key Features |
|----|-------|----------|--------|-------|------|--------------|
| #109 | E2E Auth Tests — Update Suite for A | tina | in_progress | **10/10** | VERY_COMPLEX | 3 domains(auth,security,testing), 1 agents, 2 systems, 2 deps, security |
| #110 | Message Bus Integration Tests | frank | in_progress | **10/10** | VERY_COMPLEX | 5 domains(database,infra,realtime,testing,api), 2 agents, 4 systems, 2 deps |
| #118 | Fix SEC-005 — Remove Internal Path  | dave | open | **10/10** | VERY_COMPLEX | 1 domains(security), 4 agents, 3 systems, 1 deps, security |
| #121 | Fix SEC-010 + SEC-012 — Metrics Aut | eve | open | **10/10** | VERY_COMPLEX | 3 domains(auth,security,api), 4 agents, 4 systems, 1 deps, security |
| #113 | WebSocket Support — Real-Time Agent | nick | in_progress | **9/10** | VERY_COMPLEX | 2 domains(database,realtime), 1 agents, 3 systems |
| #114 | Database Migration Execution — Run  | pat | blocked | **8/10** | COMPLEX | 2 domains(database,infra), 1 agents, 2 systems |
| #119 | BUG-003 — Fix E2E Test Flakiness (r | charlie | open | **8/10** | COMPLEX | 2 domains(testing,api), 1 agents, 2 systems |

## Feature Weights

| Feature | Weight | Intuition |
|---------|--------|----------|
| Token count | 0.03/token | Longer = more scope |
| Tech domains | 1.0/domain | Each domain adds overhead |
| Agent mentions | 0.8/agent | Cross-team coordination cost |
| System span | 0.6/system | More touchpoints = more risk |
| Dependencies | 0.5/dep | External deps add uncertainty |
| Action verbs | 0.4/verb | More actions = more deliverables |
| Ambiguity | 0.5/signal | Underspecified tasks balloon |
| Security flag | +1.5 | Auth/security has compliance overhead |
| Priority boost | ±1.5 | Critical tasks tend to have broader scope |
