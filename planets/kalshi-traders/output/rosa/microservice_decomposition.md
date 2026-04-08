# D004 Pipeline — Microservice Decomposition
**Task:** T954 | **Agent:** Rosa (Distributed Systems) | **Date:** 2026-04-07
**Sprint:** 8 | **Status:** DELIVERED

---

## Executive Summary

The D004 Kalshi Arbitrage Engine is currently a **pipeline monolith**: four sequential phases (Filter → Cluster → Correlate → Execute) running as Node.js scripts + a C++ binary, communicating via JSON files on disk. This architecture works for prototype validation but has three scalability limits:

1. **No independent scaling** — a slow LLM call in Phase 2 blocks Phase 3 and 4
2. **File coupling** — services share implicit contracts via JSON filenames; a schema change cascades silently
3. **No fault isolation** — a crash in the execution engine takes down the entire pipeline

This document proposes a **7-service decomposition** that preserves the proven pipeline logic while enabling independent scaling, fault isolation, and observable handoffs.

---

## Current Architecture (Monolith Reference)

```
Kalshi API
    │ (polling / WebSocket)
    ▼
Phase 1: Market Filter (Grace — Node.js)
    │ → markets_filtered.json (disk)
    ▼
Phase 2: LLM Cluster (Ivan — Node.js + LLM API)
    │ → market_clusters.json (disk)
    ▼
Phase 3: Pearson Correlator (Bob — Node.js)
    │ → correlation_pairs.json (disk)
    ▼
Phase 4: C++ Execution Engine (Dave — C++ binary)
    │ → trade_signals.json / live orders
    ▼
Dashboard API (Bob — Node.js, port 3200)
```

**Coupling issues:**
- Every phase reads the prior phase's file by hardcoded path
- Schema changes in any JSON break all downstream phases silently
- No retry or backpressure between phases
- Risk manager is embedded in execution engine (no independent circuit breaker)

---

## Proposed Microservice Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                        Message Bus                               │
│   (Phase 1: JSONL log │ Phase 2: Redis │ Phase 3: RabbitMQ)     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
        ┌──────────────────────┼────────────────────────┐
        │                      │                        │
        ▼                      ▼                        ▼
┌──────────────┐   ┌────────────────────┐   ┌─────────────────────┐
│ Market Data  │   │ Market Filter Svc  │   │ Cluster Intel Svc   │
│ Ingestion    │──▶│ (Phase 1 — Grace)  │──▶│ (Phase 2 — Ivan)    │
│ Service      │   │                    │   │                      │
└──────────────┘   └────────────────────┘   └─────────────────────┘
                                                       │
                                                       ▼
                                          ┌─────────────────────────┐
                                          │ Correlation Detection   │
                                          │ Service (Phase 3 — Bob) │
                                          └───────────┬─────────────┘
                                                      │
                              ┌───────────────────────┤
                              ▼                       ▼
                   ┌──────────────────┐   ┌───────────────────────┐
                   │ Risk Manager Svc │   │ Execution Engine Svc  │
                   │ (cross-cutting)  │◀──│ (Phase 4 — Dave, C++) │
                   └──────────────────┘   └───────────────────────┘
                                                       │
                                                       ▼
                                          ┌───────────────────────┐
                                          │ Observability Service │
                                          │ (dashboard_api.js)    │
                                          └───────────────────────┘
```

---

## Service Definitions

### 1. Market Data Ingestion Service
**Owner:** Quinn (Cloud) + Eve (Infra)
**Language:** Node.js
**Responsibility:** Single point of contact with the Kalshi API

| Attribute | Detail |
|-----------|--------|
| Inputs | Kalshi REST/WebSocket API (T236 credentials) |
| Outputs | `MarketDataUpdated` events on message bus |
| Scaling unit | One instance per Kalshi market category (crypto, econ, politics) |
| Failure mode | Kalshi rate-limit → exponential backoff + cached snapshot served to downstream |
| Key files | `kalshi_client.js` (existing, extend) |

**Why split:** This service is the only one that needs Kalshi credentials. Isolating it means credential rotation, rate-limit handling, and WebSocket reconnection logic lives in one place. All other services consume normalized events — they never touch the Kalshi API directly.

**Failure handling:**
- Circuit breaker: 5 failures in 30s → open for 60s, serve last-known snapshot
- Reconnect: exponential backoff 1s → 2s → 4s → max 30s
- Health: `GET /health` exposes last successful poll timestamp; stale >5min = degraded

---

### 2. Market Filter Service (Phase 1)
**Owner:** Grace (Data)
**Language:** Node.js
**Responsibility:** Apply volume/ratio filters to raw market data

| Attribute | Detail |
|-----------|--------|
| Inputs | `MarketDataUpdated` events from Market Data Ingestion Service |
| Outputs | `MarketFiltered` events (qualifying markets) + `MarketExcluded` events (rejected, with reason) |
| State | Stateless — pure function: market → pass/fail |
| Scaling unit | Horizontally scalable (parallel per market) |
| Failure mode | Crash → upstream buffers events until restart; no data loss |

**Filter logic (unchanged from Phase 1 spec):**
- Volume ≥ 10,000 contracts
- Yes/No ratio in [15–30%] or [70–85%]
- Emits both pass and fail events (enables filter threshold tuning without re-fetching data)

**Why stateless:** The filter is a pure transformation. Making it stateless means any instance can process any event; no distributed state to synchronize. Three replicas behind a load balancer = 3× throughput.

**Failure handling:**
- Poison pill: malformed market JSON → route to dead-letter queue (DLQ), log with marketId, continue
- Config reload: filter thresholds (volume floor, ratio ranges) hot-reloadable via config endpoint without restart

---

### 3. Cluster Intelligence Service (Phase 2)
**Owner:** Ivan (ML)
**Language:** Node.js + LLM API
**Responsibility:** Semantic clustering of filtered markets

| Attribute | Detail |
|-----------|--------|
| Inputs | `MarketFiltered` events |
| Outputs | `ClusterAssigned` events with {market, cluster_id, confidence_score} |
| State | Cluster model snapshot (last known clusters, refreshed every N markets or on schedule) |
| Scaling unit | One primary + one standby (LLM calls are expensive; horizontal scale adds cost) |
| Failure mode | LLM API timeout → serve cluster from last snapshot, emit `ClusterStale` flag |

**Key design decisions:**
- **Cache-first:** Store cluster assignments in Redis. On LLM API failure, serve cached assignment (stale is better than no assignment for the downstream correlator)
- **Batch clustering:** Accumulate N new markets before calling LLM, not per-market (reduces LLM API calls by ~10×)
- **Confidence scores (T911):** Every ClusterAssigned event includes `confidence: float [0,1]`. Low confidence markets are flagged for human review (feeds Ivan's T964 work)

**Failure handling:**
- LLM API unavailable: fall back to TF-IDF cosine similarity (Ivan's Sprint 2 upgrade T558) — lower quality but deterministic
- Cluster divergence: if new clusters deviate >30% from prior assignments, emit `ClusterInstabilityAlert` to Liam's monitor

---

### 4. Correlation Detection Service (Phase 3)
**Owner:** Bob (Backend)
**Language:** Node.js
**Responsibility:** Pearson correlation across cluster pairs

| Attribute | Detail |
|-----------|--------|
| Inputs | `ClusterAssigned` events; historical price candles from Market Data Service |
| Outputs | `CorrelationPairDetected` events with {cluster, market_a, market_b, pearson_r, expected_spread, arbitrage_confidence} |
| State | Rolling price history window per market (lookback = 10 candles per strategy params) |
| Scaling unit | Shard by cluster_id (each cluster's pairs are independent) |
| Failure mode | Missing candle history → skip pair this cycle, emit `InsufficientDataWarning` |

**Threshold (unchanged):** r > 0.75 → strong correlation → emit signal candidate

**Sharding rationale:** With 15 qualifying markets and 4 clusters, each cluster is independent. Shard by cluster_id gives natural parallelism: 4 workers, each computing correlations within one cluster. No cross-shard coordination needed.

**Failure handling:**
- Candle data gap: if any market in a pair is missing >2 candles in the lookback window → skip pair, log `InsufficientHistory(marketId, missingCount)`
- Stale cluster assignment: if ClusterAssigned event is >30min old → skip, re-request cluster from Cluster Intelligence Service
- Schema drift: if ClusterAssigned event schema version mismatches → route to DLQ, alert Mia (API contracts owner)

---

### 5. Risk Manager Service (Cross-Cutting)
**Owner:** Rosa (Distributed Systems) — cross-cutting concern
**Language:** Node.js
**Responsibility:** Pre-flight risk checks before any order reaches the execution engine

| Attribute | Detail |
|-----------|--------|
| Inputs | `CorrelationPairDetected` events (signal candidates) |
| Outputs | `SignalApproved` or `SignalRejected` events with rejection reason |
| State | Per-strategy position totals, daily P&L, circuit breaker state |
| Scaling unit | Single instance (must serialize position state; no horizontal scale) |
| Failure mode | Risk Manager crash → Execution Engine applies conservative deny-all until recovery |

**Risk checks (from T714/T715):**
1. Per-trade stop-loss: reject if signal would exceed max loss per trade
2. Capital floor: halt all trading if capital < floor
3. Position limits: reject if combined position in a market exceeds limit
4. Daily loss circuit breaker: open if daily P&L < -$X (configured per env)
5. Market stale check: reject if market data is >5min old

**Why a separate service:** The current risk manager is embedded in `live_runner.js`. This means a crash in the execution engine kills risk management too. Extracting it means:
- Risk state survives execution engine restarts
- Risk logic can be updated independently (no C++ recompile)
- Audit log is independent of trade log

**Failure handling:**
- Risk Manager crash → execution engine receives no `SignalApproved` events → goes idle (safe default = no trades)
- State recovery: risk state persisted to Redis on every update; on restart, reload from Redis before processing any new signals
- Split-brain: only one instance allowed (use Redis SETNX distributed lock on startup)

---

### 6. Execution Engine Service (Phase 4)
**Owner:** Dave (Full Stack)
**Language:** C++ (core) + thin Node.js wrapper for event bus integration
**Responsibility:** Sub-millisecond order placement on Kalshi

| Attribute | Detail |
|-----------|--------|
| Inputs | `SignalApproved` events from Risk Manager Service |
| Outputs | `OrderPlaced`, `OrderFilled`, `OrderRejected`, `PositionOpened/Closed` events |
| State | In-memory order book cache (flat_hash_map), position tracker |
| Scaling unit | Single instance (Kalshi rate limits; single order-router process) |
| Failure mode | Crash → Risk Manager holds new approvals in queue; on restart, reconcile open positions via Kalshi API |

**Integration boundary:**
- C++ binary (`execution_engine`) receives signals via a local Unix domain socket or shared memory pipe from the Node.js wrapper
- This keeps the hot path (<1ms) fully in C++ while the event bus integration stays in Node.js
- The wrapper handles serialization, reconnection, and DLQ routing — never touches the hot path

**Failure handling:**
- Kalshi API timeout on order: immediate cancel + retry once with backoff (libcurl keep-alive)
- Partial fill: emit `PartialFill` event, hold position open, continue monitoring for convergence
- C++ segfault: wrapper detects process death → emits `ExecutionEngineDown` alert → Liam's monitor pages on-call

---

### 7. Observability Service
**Owner:** Liam (SRE) + Charlie (Frontend)
**Language:** Node.js (existing `dashboard_api.js`)
**Responsibility:** Aggregate events into queryable state for the dashboard and alerting

| Attribute | Detail |
|-----------|--------|
| Inputs | All event types from the message bus (subscribe to `*` topic) |
| Outputs | REST API on port 3200: `/api/signals`, `/api/edges`, `/api/pnl`, `/api/health` |
| State | In-memory projections + SQLite persistence (existing `messages.db`) |
| Scaling unit | Read replicas behind load balancer (write path is single primary) |

**No changes needed** to the existing dashboard_api.js for Phase 1 of this migration. It consumes events exactly as it currently polls files — just switch the source from filesystem to event bus subscription.

---

## Message Bus Migration Path

This follows the 3-tier plan from Rosa's prior T408 architecture (trade_signal_event_arch.md):

### Tier 1 — Current (File-Based, No Change)
- Services communicate via JSONL log files
- Observability Service tails files with `fs.watch()`
- Zero infrastructure change; proves the event schema before adding real message infrastructure

### Tier 2 — Near-Term (Redis Pub/Sub)
- Replace file tailing with Redis `SUBSCRIBE`/`PUBLISH`
- Redis runs as a sidecar (single node, no cluster needed at current scale)
- Add only when the file-based approach shows latency >100ms between phases

### Tier 3 — Scale (RabbitMQ or AWS SNS+SQS)
- Add when: >100 markets, or when per-phase throughput requires independent consumer groups
- RabbitMQ: self-hosted, gives dead-letter queues natively
- SNS+SQS: managed, integrates with AWS infra Quinn owns

**Decision gate (don't migrate early):** Move to Tier 2 only when Phase 1→2→3 pipeline latency under load exceeds 500ms. At 15 markets and current polling frequency, file-based is fine.

---

## Service Boundary Rationale

| Boundary | Reason |
|----------|--------|
| Market Data ↔ Filter | Different change rates: data ingestion changes with Kalshi API; filter logic changes with strategy tuning. Also isolates credential scope. |
| Filter ↔ Cluster | Different compute profiles: filter is O(n) stateless; clustering is LLM-expensive and stateful. Independent scaling needed. |
| Cluster ↔ Correlation | Domain boundary: clustering is semantic/ML; correlation is statistical. Ivan and Bob own these independently. |
| Correlation ↔ Risk | Risk must survive execution engine failures. Can't be co-located. |
| Risk ↔ Execution | Separation of approval from action. Risk is business logic; Execution is performance-critical C++. |
| All ↔ Observability | Read path must not affect write path latency. Dashboard reads cannot slow down signal generation. |

---

## Failure Mode Analysis

| Scenario | Severity | Impact | Mitigation |
|----------|----------|--------|------------|
| Kalshi API down | High | No new market data | Circuit breaker; serve last snapshot; alert Liam |
| LLM API down | Medium | Cluster assignments stale | Fall back to TF-IDF cosine similarity |
| Correlation worker crash | Medium | No new signal candidates | Shard restarts independently; Risk holds queue |
| Risk Manager crash | High | No trades (safe default) | Redis state persistence; auto-restart; deny-all during recovery |
| Execution Engine crash | Critical | Open positions may be unmonitored | Wrapper detects death; Liam pages on-call; reconcile via Kalshi API |
| Message bus (Redis) down | High | All inter-service comms halt | Fall back to Tier 1 file-based; auto-switch on bus unavailability |
| Dashboard API crash | Low | No UI; no impact on trading | Restart independently; trading continues |
| Network partition (services) | High | Split-brain risk on Risk Manager | Redis distributed lock; deny-all until lock confirmed |

---

## Inter-Service Event Schema

All events use CloudEvents-compatible envelope (per T408 architecture):

```json
{
  "specversion": "1.0",
  "type": "com.agentplanet.d004.<EventType>",
  "source": "<service-name>",
  "id": "<uuid>",
  "time": "<ISO8601>",
  "task_id": "T954",
  "agent_name": "rosa",
  "data": { ... }
}
```

### Event Types (ordered by pipeline flow)

| Event | Producer | Consumers |
|-------|----------|-----------|
| `MarketDataUpdated` | Market Data Ingestion | Filter, Observability |
| `MarketFiltered` | Market Filter | Cluster Intelligence, Observability |
| `MarketExcluded` | Market Filter | Observability (audit) |
| `ClusterAssigned` | Cluster Intelligence | Correlation Detection, Observability |
| `ClusterInstabilityAlert` | Cluster Intelligence | Liam monitor |
| `CorrelationPairDetected` | Correlation Detection | Risk Manager, Observability |
| `InsufficientDataWarning` | Correlation Detection | Observability |
| `SignalApproved` | Risk Manager | Execution Engine |
| `SignalRejected` | Risk Manager | Observability (audit) |
| `OrderPlaced` | Execution Engine | Observability |
| `OrderFilled` | Execution Engine | Observability, Risk Manager (update P&L) |
| `PositionClosed` | Execution Engine | Observability, Risk Manager |
| `ExecutionEngineDown` | Execution Engine wrapper | Liam monitor (page) |

---

## Implementation Roadmap

### Phase A — Schema First (no code changes, 1 sprint)
1. Define and version all 13 event schemas above (Mia owns API contracts — DM her)
2. Add CloudEvents envelope to existing JSON file outputs (backward-compatible)
3. Update T408 event arch document to reference these services

### Phase B — Extract Risk Manager (1 sprint)
1. Move risk logic from `live_runner.js` into standalone `risk_manager_service.js`
2. Communicate via local Unix socket (no message bus yet)
3. Add Redis state persistence for position/P&L state

### Phase C — Extract Market Data Ingestion (1 sprint, depends on T236)
1. Move `kalshi_client.js` polling into standalone process
2. Normalize output to `MarketDataUpdated` event schema
3. Circuit breaker + reconnect logic

### Phase D — Message Bus (Tier 2, when needed)
1. Add Redis Pub/Sub
2. Switch all inter-service file communication to Redis channels
3. Add DLQ (`events/dlq.jsonl`) and replay capability

### Phase E — Horizontal Scaling (Tier 3, when needed)
1. Shard Correlation Detection by cluster_id (4 workers)
2. Migrate message bus to RabbitMQ or SNS+SQS
3. Add read replicas for Observability Service

---

## File Modification Matrix

| File | Service | Change |
|------|---------|--------|
| `backend/kalshi_client.js` | Market Data Ingestion | Extract into standalone process; add circuit breaker |
| `backend/strategies/live_runner.js` | Orchestration | Thin coordinator; delegates to each service |
| `backend/strategies/risk_manager.js` | Risk Manager | Extract to `risk_manager_service.js`; add Redis state |
| `backend/dashboard_api.js` | Observability | Subscribe to events instead of polling files |
| `backend/strategies/pearson_detector.js` | Correlation Detection | Wrap in service harness; emit events |
| New: `services/market_filter_service.js` | Market Filter | Extract Phase 1 logic |
| New: `services/cluster_intelligence_service.js` | Cluster Intelligence | Extract Phase 2 logic |
| New: `services/risk_manager_service.js` | Risk Manager | Extracted from live_runner.js |
| New: `services/event_bus.js` | Shared | Tier 1 (file) → Tier 2 (Redis) abstraction |

---

## Recommendations for Sprint 9+

1. **Start with Phase A (schema)** — zero risk, unblocks all other work, Mia can own this
2. **Phase B (Risk Manager extract)** — highest impact for fault isolation, Bob leads with Rosa review
3. **Don't migrate to Redis until latency data shows it's needed** — premature infra adds cost without benefit
4. **Keep C++ execution engine as-is** — the Unix socket boundary is the right integration point; no reason to change the hot path

---

*Deliverable for T954. Run command: `cat output/microservice_decomposition.md` — static architecture document, no executable.*
*task_id: T954 | agent_name: rosa | timestamp: 2026-04-07T00:00:00Z | sprint: 8*
