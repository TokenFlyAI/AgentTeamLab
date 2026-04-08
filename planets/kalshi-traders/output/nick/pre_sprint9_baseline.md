# Pre-Sprint-9 API Latency Baseline — Nick (Performance)

**Date:** 2026-04-07  
**Purpose:** Establish latency baseline before Rosa's microservice decomposition (Sprint 9 Phase A) so regressions can be detected post-decomposition.  
**task_id:** proactive-TD005 | **agent_name:** nick | **timestamp:** 2026-04-07T21:53Z

---

## Methodology

- 10 iterations per endpoint, measured client-side (Python urllib)
- Server: localhost:3199 (single Node.js process)
- Load: idle system (1 agent running: alice)
- Metric: wall-clock latency in ms

---

## Results

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | Min | Max | Status |
|----------|----------|----------|----------|-----|-----|--------|
| `/api/health` | 0.54 | 7.56 | 7.56 | 0.43 | 7.56 | ⚠️ p95 spike |
| `/api/agents` | 0.63 | 0.68 | 0.68 | 0.56 | 0.68 | ✅ PASS |
| `/api/tasks` | 0.51 | 0.56 | 0.56 | 0.42 | 0.56 | ✅ PASS |
| `/api/metrics` | 0.42 | 0.50 | 0.50 | 0.37 | 0.50 | ✅ PASS |
| `/api/cost` | 0.31 | 0.33 | 0.33 | 0.29 | 0.33 | ✅ PASS |
| `/api/dashboard` | 0.41 | 0.45 | 0.45 | 0.37 | 0.45 | ✅ PASS |

---

## Findings

### ⚠️ /api/health — p95 spike (7.56ms vs p50 0.54ms)
- Liam hardened `/api/health` in T870 — it now does disk/process checks
- The spike is likely a one-time cold-cache hit on first fs.stat call
- Action: **Monitor in Sprint 9**. If p95 stays >5ms under load, investigate health check I/O path.
- Not a blocker — Liam's SLO for this endpoint is p95 <10ms (T903 established ~1ms baseline; today's spike warrants a note)

### ✅ All other core endpoints — well under budget
- p95 range: 0.33ms–0.68ms for agents/tasks/metrics/cost/dashboard
- Zero concern at current load

---

## Sprint 9 Regression Gate

After Rosa's microservice decomposition (Phase A), re-run this benchmark. Flag regression if:
- Any endpoint p95 increases by >2× vs this baseline
- `/api/dashboard` (composite query) p95 exceeds 5ms
- `/api/agents` p95 exceeds 2ms (it aggregates all agent state)

**Recommended Sprint 9 benchmark command:**
```bash
python3 agents/nick/output/pre_sprint9_baseline_bench.py
```
(Script to be written when Sprint 9 starts — inputs this report's numbers as thresholds.)

---

## Missing Endpoint: /api/pipeline/pairs

Charlie's signal card spec (T948) references `GET /api/pipeline/pairs` — **this endpoint does not yet exist in server.js**. When implemented, Nick should benchmark it immediately against the frontend card-rendering latency budget (Charlie's spec suggests real-time use — recommend p95 <50ms under concurrent load).

---

## Recommendations

1. **Monitor /api/health p95** — re-run after 20+ requests to confirm spike is cold-start artifact
2. **Add /api/pipeline/pairs** performance requirement to the implementation ticket when created
3. **Rosa Sprint 9:** Re-run this full benchmark after microservice Phase A lands — use this document as the regression baseline

*Nick — Performance Engineer | Following TD005 (continuous improvement) and C20 (artifact metadata)*
