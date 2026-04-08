# D004 Pipeline — Microservice Decomposition
**Task:** T954 | **Agent:** rosa | **Date:** 2026-04-07 | **Sprint:** 8

---

## Executive Summary

The D004 pipeline currently runs as a sequential in-process chain:
`market filter → cluster → correlate → execute`

This document proposes decomposing it into **7 loosely-coupled microservices** connected by an async event bus. Each service owns one domain, scales independently, and fails without cascading to its neighbors.

---

## Current Architecture (Monolithic Chain)

```
Kalshi API
    │
    ▼
[run_pipeline.js]  ← single process, sequential
    │
    ├─ Phase 1: filterMarkets()     → markets_filtered.json
    ├─ Phase 2: clusterMarkets()    → market_clusters.json
    ├─ Phase 3: correlatePairs()    → correlation_pairs.json
    └─ Phase 4: C++ executor        → orders → Kalshi API
```

**Problems with the monolith:**
- One phase crash kills the whole pipeline
- LLM calls (Phase 2) block the fast phases (Phase 1, 3)
- C++ executor (µs latency) shares process space with Node.js (ms latency)
- Cannot scale Phase 3 correlation independently from Phase 2 LLM
- No backpressure — if execution is slow, signals pile up unbounded

---

## Proposed Service Topology (7 Services)

```
Kalshi WebSocket
        │
        ▼
┌─────────────────┐
│  Market Data    │  Service 1 — ingest, normalize, publish
│  Service (MDS)  │
└────────┬────────┘
         │ event: MarketDataUpdated
         ▼
┌─────────────────┐
│  Market Filter  │  Service 2 — Phase 1 (volume + ratio filter)
│  Service (MFS)  │
└────────┬────────┘
         │ event: MarketFiltered / MarketExcluded
         ▼
┌─────────────────┐
│  Cluster Intel  │  Service 3 — Phase 2 (LLM semantic clustering)
│  Service (CIS)  │
└────────┬────────┘
         │ event: ClusterUpdated
         ▼
┌─────────────────┐
│  Correlation    │  Service 4 — Phase 3 (Pearson r > 0.75 detection)
│  Engine (CE)    │
└────────┬────────┘
         │ event: ArbitrageSignalDetected
         ▼
┌─────────────────┐     ┌──────────────────┐
│  Risk Manager   │────▶│  Execution Engine │  Service 5+6 — Phase 4 (C++ HFT)
│  Service (RMS)  │     │  Service (EES)    │
└─────────────────┘     └────────┬─────────┘
                                  │
                                  ▼
                           Kalshi REST API
                                  │
                         ┌────────▼────────┐
                         │  Observability  │  Service 7 — metrics, P&L, dashboard
                         │  Service (OBS)  │
                         └─────────────────┘
```

---

## Service Definitions

### Service 1 — Market Data Service (MDS)
**File:** `backend/services/market_data_service.js`
**Owner:** Bob / Eve (infra)
**Responsibility:** Single source of truth for raw Kalshi market data.

- Connects to Kalshi WebSocket feed (or polls REST for markets list)
- Normalizes payloads via Bob's T814 normalization layer
- Publishes `MarketDataUpdated` events to the event bus
- Caches last-known snapshot so downstream services can bootstrap on restart
- **Failure mode:** Kalshi API down → publishes `MarketDataStale` event; downstream services serve stale cache with TTL warning

**Scaling:** Single instance (ordered stream required). Horizontal only via partitioning by market category.

---

### Service 2 — Market Filter Service (MFS)
**File:** `backend/services/market_filter_service.js`
**Owner:** Grace
**Responsibility:** Phase 1 — apply volume and yes/no ratio filters.

- Subscribes to `MarketDataUpdated`
- Applies filters: volume ≥ 10,000 contracts; ratio in [15-30%] or [70-85%]
- Publishes `MarketFiltered` (passes) or `MarketExcluded` (fails with reason)
- Writes `markets_filtered.json` as a durable snapshot for Phase 2 cold start
- **Failure mode:** Service crash → MDS events buffer on queue; on restart, replays from last cursor. No data loss.

**Scaling:** Stateless filter — horizontally scalable. Run N instances for N market categories.

---

### Service 3 — Cluster Intelligence Service (CIS)
**File:** `backend/services/cluster_intelligence_service.js`
**Owner:** Ivan
**Responsibility:** Phase 2 — LLM-based semantic clustering.

- Subscribes to `MarketFiltered` batch events (batches to reduce LLM API calls)
- Calls LLM embedding API; groups markets by semantic/causal relationships
- Adds confidence scores (T911 — in progress)
- Publishes `ClusterUpdated` with `{cluster_id, markets[], confidence}`
- Writes `market_clusters.json` snapshot
- **Failure mode:** LLM API down → circuit breaker trips after 3 failures; service falls back to last known clusters (stale OK for up to 6 hours — clusters change slowly). Publishes `ClusterStale` warning.

**Scaling:** LLM calls are expensive and slow — run single instance with internal queue. Scale by batching, not by parallelism.

**Key design decision:** CIS runs on a slower cadence (every 30–60 min) than MFS (real-time). This decoupling is the main reason to separate them. In the monolith, an LLM timeout would stall the entire pipeline.

---

### Service 4 — Correlation Engine (CE)
**File:** `backend/services/correlation_engine.js`
**Owner:** Bob
**Responsibility:** Phase 3 — Pearson correlation detection (r > 0.75).

- Subscribes to `ClusterUpdated`
- Computes Pearson r across all market pairs within each cluster
- Calculates expected spread vs current spread
- Scores arbitrage confidence
- Publishes `ArbitrageSignalDetected` with `{market_a, market_b, pearson_r, expected_spread, current_spread, confidence, uncertain: bool}`
- Includes `uncertain_markets` flag per Ivan's T939 integration
- **Failure mode:** Worker crash mid-computation → stateless restart from last `ClusterUpdated` snapshot. Idempotent — same clusters produce same pairs.

**Scaling:** CPU-bound. Run multiple workers partitioned by cluster_id. Each worker owns a cluster shard.

---

### Service 5 — Risk Manager Service (RMS)
**File:** `backend/services/risk_manager_service.js`  
(Extracted from `strategies/risk_manager.js` — existing class promoted to service)
**Owner:** Rosa / Bob
**Responsibility:** Cross-cutting risk enforcement gate before any order reaches the execution engine.

- Subscribes to `ArbitrageSignalDetected`
- Applies pre-flight checks:
  - Position limit per market
  - Daily loss limit (capital floor — T715)
  - Per-trade stop-loss (T714)
  - Circuit breaker (trips on N consecutive losses)
  - **Double-opt-in guard** (Heidi T989 finding — MEDIUM risk) — requires explicit `LIVE_TRADING=true` env flag before forwarding real orders
- Approved signals → `SignalApproved` event → EES
- Rejected signals → `SignalRejected` event → OBS (for audit)
- **Failure mode:** RMS crash → EES receives no signals → all trading halts safely. Fail-closed by design.

**Scaling:** Single instance (stateful — tracks positions, P&L). Redis-backed state for HA failover.

---

### Service 6 — Execution Engine Service (EES)
**File:** `backend/execution/execution_engine` (C++ binary, existing)
**Owner:** Dave
**Responsibility:** Phase 4 — sub-millisecond order routing to Kalshi REST API.

- Subscribes to `SignalApproved` events from RMS (via shared memory or Unix socket for µs latency)
- Executes orders via libcurl keep-alive connections
- Publishes `OrderFilled`, `OrderRejected`, `PositionOpened`, `PositionClosed` events
- **Failure mode:** EES crash → RMS detects `EES_DOWN` (heartbeat miss) → trips circuit breaker → no new signals forwarded. On restart, replays unfilled `SignalApproved` events from write-ahead log.

**Scaling:** Single instance per trading strategy. Multiple instances = multiple independent strategy runners.

**Inter-service transport (EES only):** Unix domain socket or shared memory ring buffer (not HTTP) — required for <1ms latency target. All other services use the event bus over TCP.

---

### Service 7 — Observability Service (OBS)
**File:** `backend/dashboard_api.js` (existing, promoted)
**Owner:** Liam / Charlie
**Responsibility:** Aggregate all events into metrics, P&L, and dashboard API.

- Subscribes to all event types: `OrderFilled`, `SignalRejected`, `ClusterStale`, `MarketDataStale`, etc.
- Maintains rolling P&L ledger (event-sourced)
- Exposes existing dashboard endpoints: `/api/signals`, `/api/pnl`, `/api/health`, `/api/edges`
- Publishes health alerts (Liam's LR-001 to LR-007 from fault_tolerance_design.md)
- **Failure mode:** OBS crash → trading continues unaffected. On restart, replays event log to reconstruct P&L and metrics state.

---

## Message Bus Design

### Current (File-Based)
```
Phase 1 → writes markets_filtered.json → Phase 2 polls file
```
**Problems:** polling latency, no backpressure, no delivery guarantees.

### Near-Term: Redis Pub/Sub + JSONL Event Log
```
Service → PUBLISH channel event_json
Service → SUBSCRIBE channel
Event log → append to events/pipeline.jsonl  (durable replay)
```
**Advantages:** <1ms delivery, zero new infrastructure (Redis already common), JSONL log enables replay and audit.

### Production: RabbitMQ (or AWS SNS+SQS)
Channels per event type:
| Channel | Publisher | Subscribers |
|---------|-----------|-------------|
| `market.data` | MDS | MFS |
| `market.filtered` | MFS | CIS |
| `cluster.updated` | CIS | CE |
| `signal.detected` | CE | RMS |
| `signal.approved` | RMS | EES |
| `order.filled` | EES | OBS, RMS |
| `signal.rejected` | RMS | OBS |
| `dlq.*` | Any | OBS (dead-letter queue) |

All events follow CloudEvents schema (from trade_signal_event_arch.md T408).

---

## Failure Mode Matrix

| Failure | Affected Service | Behavior | Recovery |
|---------|-----------------|----------|----------|
| Kalshi API down | MDS | Publishes `MarketDataStale`; serves cache | Auto-retry with exponential backoff |
| LLM API timeout | CIS | Circuit breaker; serves stale clusters (≤6h) | Retry on next cadence tick |
| Correlation worker crash | CE | Stateless; restarts from last ClusterUpdated | Idempotent replay |
| Risk manager crash | RMS | No signals forwarded → trading halts safely | Restart; state from Redis |
| Execution engine crash | EES | RMS detects heartbeat miss; circuit breaker trips | WAL replay of unfilled signals |
| OBS crash | OBS | Trading continues; metrics gap | Event log replay to reconstruct |
| Event bus down | All | Services buffer locally (bounded queue) | Bus recovery; drain buffer |
| Stale Phase 1 data | MFS | Publishes `MarketDataStale` on TTL breach (C15) | MDS re-fetch |
| No double-opt-in | RMS | Blocks real orders (Heidi T989 MEDIUM finding) | Explicit `LIVE_TRADING=true` required |

---

## Service Boundary Rationale

| Boundary | Reason |
|----------|--------|
| MDS ↔ MFS | Different data source (Kalshi WebSocket) vs filter logic; MDS is IO-bound, MFS is CPU-bound |
| MFS ↔ CIS | Cadence mismatch: MFS runs real-time, CIS runs every 30-60 min (LLM cost) |
| CIS ↔ CE | LLM clustering (slow, expensive) vs Pearson math (fast, CPU) — never block CE on LLM |
| CE ↔ RMS | Domain boundary: signal generation vs risk enforcement. RMS is a gate, not a producer |
| RMS ↔ EES | Language boundary: Node.js (RMS) vs C++ (EES). Transport: Unix socket for µs latency |
| EES ↔ OBS | Observability is a consumer, never a producer of trading decisions |

---

## Implementation Roadmap

### Phase 1 — Extract & Wire (Current Sprint / Sprint 9)
1. Promote `risk_manager.js` class → standalone RMS process
2. Add Redis Pub/Sub event bus alongside existing file writes (dual-write, no breaking change)
3. Add `LIVE_TRADING` double-opt-in guard in RMS (addresses Heidi T989 MEDIUM finding)
4. OBS subscribes to `SignalApproved` / `OrderFilled` events

### Phase 2 — Decouple Cadences (Sprint 10)
5. MFS runs continuously; CIS runs on 30-min timer
6. CE subscribes to `ClusterUpdated` events instead of polling file
7. JSONL event log for durability and audit trail

### Phase 3 — Scale & Harden (Sprint 11+)
8. CE horizontal sharding by cluster_id
9. RMS Redis-backed state for HA failover
10. Full RabbitMQ migration from Redis Pub/Sub
11. EES Unix socket transport (drop HTTP overhead)

---

## Files to Modify

| File | Change | Owner |
|------|--------|-------|
| `backend/services/market_data_service.js` | New — wraps Kalshi ingestion | Bob/Eve |
| `backend/services/market_filter_service.js` | New — extracts Phase 1 logic | Grace |
| `backend/services/cluster_intelligence_service.js` | New — wraps Ivan's Phase 2 | Ivan |
| `backend/services/correlation_engine.js` | New — wraps Bob's Phase 3 | Bob |
| `backend/services/risk_manager_service.js` | Promote existing class; add double-opt-in | Rosa/Bob |
| `backend/execution/execution_engine` | Unchanged (C++ binary) | Dave |
| `backend/dashboard_api.js` | Promote to OBS; add event subscriptions | Liam/Charlie |
| `backend/event_bus.js` | New — Redis Pub/Sub wrapper + JSONL log | Rosa |

---

## Alignment with Culture & Decisions

- **D2 (D004 north star):** All service boundaries derived from D004 phase ownership
- **D5 (runnable/verifiable):** Each service has its own `node service.js` entry point and health check
- **C1 (paper trading):** RMS double-opt-in guard enforces paper mode by default
- **C2 (auth on endpoints):** OBS dashboard endpoints retain Bearer token requirement
- **Rosa T408 (event arch):** This decomposition uses the CloudEvents schema and bus topology from trade_signal_event_arch.md
- **Rosa fault_tolerance_design.md:** Circuit breakers, WAL, and DLQ patterns from T270 are implemented at the RMS/EES boundary

---

## Artifact Metadata

```json
{
  "task_id": "T954",
  "agent": "rosa",
  "timestamp": "2026-04-07T00:00:00Z",
  "sprint": 8,
  "deliverable": "d004_microservice_decomposition.md",
  "run_command": "cat output/d004_microservice_decomposition.md"
}
```
