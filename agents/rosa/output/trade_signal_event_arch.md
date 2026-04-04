# Event-Driven Architecture for Trade Signals

**Author:** Rosa (Distributed Systems Engineer)  
**Task:** T408  
**Date:** 2026-04-03  
**Status:** Design Complete

---

## 1. Executive Summary

This document designs an event-driven architecture (EDA) for real-time trade signal propagation across the Kalshi trading system. The architecture decouples signal producers (`live_runner.js`, `execution_engine.js`) from consumers (dashboard, alerts, P&L tracker, audit log), enabling horizontal scaling, independent failure domains, and real-time reactive behavior.

**Key Design Decisions:**
- **CloudEvents-compatible schema** for interoperability
- **Tiered pub/sub strategy**: file-based event log (today) → Redis Pub/Sub (scale) → RabbitMQ/AWS EventBridge (production)
- **At-least-once delivery** with idempotent consumers
- **Dead-letter queue (DLQ)** and **event replay log** for observability and recovery

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRODUCERS (Event Sources)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  live_runner.js          execution_engine.js      risk_manager.js           │
│  ├─ SignalGenerated      ├─ OrderSubmitted        ├─ SignalApproved         │
│  ├─ SignalRejected       ├─ OrderFilled           ├─ SignalRejected         │
│  └─ MarketDataStale      ├─ PositionOpened        └─ RiskAlert              │
│                          ├─ PositionClosed                                  │
│                          └─ ExecutionFailed                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EVENT BUS (Pub/Sub Layer)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  signals     │    │   fills      │    │   risk       │   Topics/Queues  │
│  │  topic       │    │   topic      │    │   topic      │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│                                                                              │
│  Implementation Tiers:                                                       │
│  Tier 1: File-based JSONL event log (`events/trade_signals.jsonl`)         │
│  Tier 2: Redis Pub/Sub (sub-ms latency, local cluster)                      │
│  Tier 3: RabbitMQ / AWS SNS+SQS (durable, multi-region)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONSUMERS (Event Sinks)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Dashboard   │  │   Monitor    │  │  P&L Tracker │  │  Audit Log   │    │
│  │  (SSE/WS)    │  │   (Alerts)   │  │  (Ledger)    │  │  (Compliance)│    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Event Schema (CloudEvents Compatible)

All events follow a common envelope with a typed payload.

### 3.1 Common Envelope

```json
{
  "specversion": "1.0",
  "type": "agentplanet.trading.signal.generated",
  "source": "live_runner.js",
  "id": "evt_2f8a9c4e-...",
  "time": "2026-04-03T12:00:00.000Z",
  "datacontenttype": "application/json",
  "data": { /* payload */ },
  "agentplanet": {
    "traceId": "trace_a1b2c3",
    "runId": "run_20260403_120000",
    "priority": "normal",
    "retries": 0
  }
}
```

### 3.2 Event Types & Payloads

#### `agentplanet.trading.signal.generated`
Emitted when `live_runner.js` produces a new signal.

```json
{
  "marketId": "m4",
  "ticker": "BTCW-26-JUN30-100K",
  "strategy": "mean_reversion",
  "side": "yes",
  "confidence": 0.95,
  "targetPrice": 64,
  "currentPrice": 64,
  "recommendedContracts": 29,
  "riskAmount": 1856,
  "timestamp": "2026-04-03T12:00:00.000Z"
}
```

#### `agentplanet.trading.signal.approved` / `rejected`
Emitted by `risk_manager.js` after validation.

```json
{
  "signalId": "evt_2f8a9c4e-...",
  "ticker": "BTCW-26-JUN30-100K",
  "approved": true,
  "riskScore": 12,
  "reason": "Within daily loss limit",
  "timestamp": "2026-04-03T12:00:01.000Z"
}
```

#### `agentplanet.trading.order.submitted`
Emitted when `execution_engine.js` submits an order.

```json
{
  "orderId": "order_42",
  "clientOrderId": "cli_abc123",
  "ticker": "BTCW-26-JUN30-100K",
  "side": "yes",
  "contracts": 29,
  "price": 64,
  "timestamp": "2026-04-03T12:00:02.000Z"
}
```

#### `agentplanet.trading.order.filled`
Emitted on order fill (complete or partial).

```json
{
  "orderId": "order_42",
  "ticker": "BTCW-26-JUN30-100K",
  "filledContracts": 29,
  "avgFillPrice": 64,
  "status": "filled",
  "timestamp": "2026-04-03T12:00:03.000Z"
}
```

#### `agentplanet.trading.position.opened` / `closed`

```json
{
  "positionId": "pos_7",
  "pairId": "pair_3",
  "marketA": "SP500-5000",
  "marketB": "NASDAQ-ALLTIME",
  "contracts": 10,
  "entryPriceA": 86,
  "entryPriceB": 84,
  "openedAt": "2026-04-03T12:00:04.000Z"
}
```

#### `agentplanet.trading.pnl.updated`
Emitted by `pnl_tracker.js` after each closed position.

```json
{
  "date": "2026-04-03",
  "realizedPnlCents": 1200,
  "unrealizedPnlCents": 450,
  "totalTrades": 42,
  "winRate": 0.55,
  "maxDrawdownCents": 800,
  "timestamp": "2026-04-03T12:00:05.000Z"
}
```

#### `agentplanet.trading.risk.alert`
Emitted when risk thresholds are breached.

```json
{
  "alertType": "DAILY_LOSS_LIMIT",
  "severity": "critical",
  "currentValue": -50100,
  "threshold": -50000,
  "message": "Daily loss limit exceeded",
  "timestamp": "2026-04-03T12:00:06.000Z"
}
```

#### `agentplanet.trading.marketdata.stale`
Emitted when pipeline hasn't run in > 15 minutes.

```json
{
  "lastUpdate": "2026-04-03T11:40:00.000Z",
  "ageMinutes": 20,
  "source": "mock_fallback",
  "timestamp": "2026-04-03T12:00:07.000Z"
}
```

---

## 4. Pub/Sub Mechanism Options

### 4.1 Tier 1: File-Based JSONL Event Log (Immediate)
**Best for:** Current local deployment, zero external dependencies.

```javascript
// lib/event_bus.js
const fs = require('fs');
const path = require('path');
const EVENT_LOG = path.join(__dirname, '../output/events/trade_signals.jsonl');

function publish(event) {
  fs.mkdirSync(path.dirname(EVENT_LOG), { recursive: true });
  fs.appendFileSync(EVENT_LOG, JSON.stringify(event) + '\n');
}

function subscribe(filterFn, handlerFn) {
  // Tail the log and invoke handler for matching events
}
```

**Pros:** Simple, durable, replayable.  
**Cons:** Latency ~10-100ms (disk I/O), no true pub/sub fan-out.

### 4.2 Tier 2: Redis Pub/Sub (Scale)
**Best for:** Sub-millisecond latency, multi-process Node.js deployment.

```javascript
const redis = require('redis');
const publisher = redis.createClient();
const subscriber = redis.createClient();

async function publish(topic, event) {
  await publisher.publish(topic, JSON.stringify(event));
}

async function subscribe(topic, handler) {
  await subscriber.subscribe(topic, (message) => {
    handler(JSON.parse(message));
  });
}
```

**Topics:**
- `trade:signals`
- `trade:fills`
- `trade:risk`
- `trade:pnl`
- `trade:system`

**Pros:** Fast, simple API, supports pattern matching (`trade:*`).  
**Cons:** No message persistence; consumers must be online.

### 4.3 Tier 3: RabbitMQ / AWS SNS+SQS (Production)
**Best for:** Guaranteed delivery, multi-region, complex routing.

**Exchange Type:** `topic`  
**Routing Keys:**
- `signal.generated`
- `signal.approved`
- `fill.order`
- `risk.alert`
- `pnl.updated`

**Queues (durable):**
- `q.dashboard.signals`
- `q.monitor.alerts`
- `q.pnl.ledger`
- `q.audit.all`

**Pros:** ACK/NACK, dead-letter exchanges, TTL, priority queues.  
**Cons:** Operational complexity, infrastructure cost.

### 4.4 Recommended Migration Path

| Phase | Timeline | Technology | Trigger |
|-------|----------|------------|---------|
| 1 | Now | File-based JSONL | Single-node deployment |
| 2 | 2-4 weeks | Redis Pub/Sub | Dashboard needs <100ms updates |
| 3 | 2-3 months | RabbitMQ or AWS SNS+SQS | Multi-region or team scale |

---

## 5. Consumer Patterns

### 5.1 Dashboard (Real-Time UI)
**Pattern:** Server-Sent Events (SSE) or WebSocket push

```javascript
// dashboard_api.js — SSE endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  eventBus.subscribe('trade:signals', (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  });
});
```

**Behavior:**
- Pushes `SignalGenerated`, `OrderFilled`, `PnLUpdated` to connected browsers
- Auto-reconnects on disconnect
- Buffers last 100 events for late-joining clients

### 5.2 Monitor / Alerts (Liam)
**Pattern:** Filtered subscription with alert rules

```javascript
// monitor.js
const ALERT_RULES = [
  { type: 'agentplanet.trading.risk.alert', severity: 'critical', action: 'page' },
  { type: 'agentplanet.trading.marketdata.stale', ageMinutes: '>15', action: 'slack' },
  { type: 'agentplanet.trading.order.filled', status: 'failed', action: 'log' },
];

eventBus.subscribe('trade:risk', (evt) => {
  if (matchesRule(evt, ALERT_RULES)) {
    fireAlert(evt);
  }
});
```

### 5.3 P&L Tracker (Grace)
**Pattern:** Event-sourced ledger consumer

```javascript
// pnl_tracker.js
const ledger = [];

eventBus.subscribe('trade:fills', (evt) => {
  ledger.push({
    orderId: evt.orderId,
    pnl: calculatePnl(evt),
    timestamp: evt.time,
  });
  writeLedger(ledger);
  publish('trade:pnl', buildPnlUpdate(ledger));
});
```

**Idempotency:** Uses `orderId` deduplication.

### 5.4 Audit Log (Compliance)
**Pattern:** Append-only log consumer

```javascript
// audit_logger.js
eventBus.subscribe('trade:*', (evt) => {
  fs.appendFileSync(AUDIT_LOG, JSON.stringify(evt) + '\n');
});
```

**Retention:** 90 days hot storage, 7 years cold archive.

---

## 6. Failure Handling & Replay

### 6.1 Delivery Guarantees

| Tier | Guarantee | Mechanism |
|------|-----------|-----------|
| File-based | At-least-once | Consumers tail from last known offset |
| Redis | At-most-once | Fire-and-forget publish |
| RabbitMQ | At-least-once | Consumer ACK + publisher confirm |

### 6.2 Dead-Letter Queue (DLQ)

Events that fail processing after `maxRetries=3` are moved to the DLQ.

```json
{
  "originalEvent": { /* full event */ },
  "error": "TypeError: Cannot read property 'ticker' of undefined",
  "failedAt": "2026-04-03T12:00:10.000Z",
  "retryCount": 3,
  "consumer": "dashboard_api.js"
}
```

**DLQ file:** `output/events/dlq.jsonl`

**Recovery process:**
1. Daily batch job replays DLQ events
2. If replay succeeds, remove from DLQ
3. If still failing, alert human operator

### 6.3 Event Replay

Every consumer maintains an `offset` (event ID or line number in JSONL log).

```javascript
function replayEvents(fromEventId, handler) {
  const lines = fs.readFileSync(EVENT_LOG, 'utf8').split('\n');
  let replay = false;
  for (const line of lines) {
    const evt = JSON.parse(line);
    if (!replay && evt.id === fromEventId) replay = true;
    if (replay) handler(evt);
  }
}
```

**Use cases:**
- Rebuild P&L ledger from scratch
- Debug a specific trading day
- Recover a crashed consumer without data loss

### 6.4 Idempotency

All consumers must be idempotent. Key idempotency tokens:
- `SignalGenerated` → `event.id`
- `OrderFilled` → `orderId`
- `PnLUpdated` → `date` + `runId`

```javascript
const processedIds = new Set(loadProcessedIds());

function handleEvent(evt) {
  if (processedIds.has(evt.id)) return; // idempotent skip
  // ... process ...
  processedIds.add(evt.id);
  saveProcessedIds(processedIds);
}
```

### 6.5 Circuit Breaker for Event Bus

If the event bus is down (e.g., Redis unreachable), producers must not block.

```javascript
function safePublish(topic, event) {
  try {
    eventBus.publish(topic, event);
  } catch (err) {
    // Fallback: write to local spillover log
    fs.appendFileSync(SPILLOVER_LOG, JSON.stringify({ topic, event }) + '\n');
    console.error('Event bus down, spilled to log:', err.message);
  }
}
```

---

## 7. Implementation Roadmap

### Phase 1 — Event Bus Foundation (This Week)
1. Create `agents/bob/backend/lib/event_bus.js` with file-based JSONL backend.
2. Instrument `live_runner.js` to emit `SignalGenerated` and `MarketDataStale`.
3. Instrument `execution_engine.js` to emit `OrderSubmitted`, `OrderFilled`, `PositionOpened`, `PositionClosed`.
4. Instrument `risk_manager.js` to emit `SignalApproved`, `SignalRejected`, `RiskAlert`.
5. Instrument `pnl_tracker.js` to emit `PnLUpdated`.

### Phase 2 — Dashboard Integration (Next Week)
1. Add SSE endpoint `/api/events` to `dashboard_api.js`.
2. Update `dashboard/index.html` to consume events and refresh panels in real time.
3. Add event buffer for late-joining clients.

### Phase 3 — Monitoring & Audit (Sprint 9)
1. Integrate `monitor.js` with event bus filtered subscriptions.
2. Build audit logger consumer.
3. Add DLQ replay script.

### Phase 4 — Scale (Sprint 10)
1. Swap file-based backend for Redis Pub/Sub (drop-in replacement via `event_bus.js` interface).
2. Evaluate RabbitMQ/AWS SNS+SQS based on load testing.

---

## 8. Files to Create / Modify

| File | Action | Owner |
|------|--------|-------|
| `agents/bob/backend/lib/event_bus.js` | Create | Rosa |
| `agents/bob/backend/strategies/live_runner.js` | Emit events | Bob |
| `agents/bob/backend/strategies/execution_engine.js` | Emit events | Bob |
| `agents/bob/backend/strategies/risk_manager.js` | Emit events | Bob |
| `agents/bob/backend/strategies/pnl_tracker.js` | Emit events | Grace |
| `agents/bob/backend/dashboard_api.js` | SSE consumer | Bob / Dave |
| `agents/bob/backend/dashboard/monitor.js` | Alert consumer | Liam |
| `agents/bob/output/events/trade_signals.jsonl` | Runtime artifact | — |
| `agents/bob/output/events/dlq.jsonl` | Runtime artifact | — |

---

## 9. Acceptance Criteria

- [ ] `live_runner.js` emits at least 2 event types to the bus on every run.
- [ ] `dashboard_api.js` SSE endpoint streams events to a browser client.
- [ ] A consumer crash and restart can replay missed events from the JSONL log.
- [ ] DLQ captures at least one failed event and logs the error.
- [ ] All consumers are idempotent (duplicate events produce no side effects).
- [ ] Event bus fallback works when Redis (or primary transport) is unavailable.

---

*End of architecture design. Ready for implementation kickoff.*
