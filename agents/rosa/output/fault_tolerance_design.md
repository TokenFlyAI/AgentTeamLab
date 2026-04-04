# Fault-Tolerance Design for `live_runner.js`

**Author:** Rosa (Distributed Systems Engineer)  
**Task:** #270  
**Date:** 2026-04-03  
**Status:** Design Complete — Ready for Implementation

---

## Executive Summary

`live_runner.js` is the critical path of the Kalshi trading pipeline. A failure anywhere in its execution chain — Kalshi API outage, process crash, disk corruption, or strategy exception — currently results in either a missing `trade_signals.json` or a stale one with no recovery mechanism. This document designs a **three-layer fault-tolerance architecture**:

1. **Resilience Layer** — retries, circuit breakers, graceful degradation
2. **Durability Layer** — state snapshots, WAL (write-ahead log), dead-letter queue
3. **Recovery Layer** — automatic restart, signal validation, stale-data serving

---

## 1. Failure Mode Analysis

| Failure Scenario | Current Behavior | Impact | Severity |
|------------------|------------------|--------|----------|
| `live_runner.js` crashes mid-run | `trade_signals.json` not updated; no error persisted | Dashboard shows stale or missing signals | P0 |
| Kalshi API down / rate-limited | `fetchMarkets()` throws; process exits with code 1 | Complete pipeline halt | P0 |
| `fetchCandles()` fails for one market | Unhandled rejection; pipeline aborts | All signals lost for that run | P0 |
| Strategy throws exception | No isolation; entire run fails | All strategy signals lost | P1 |
| Risk manager DB unreachable | Now falls back to "approve all" (hotfixed) | Risk limits bypassed silently | P1 |
| Corrupted `trade_signals.json` | Frontend receives malformed JSON; crashes | Dashboard unusable | P1 |
| Disk full / write fails | Silent `fs.writeFileSync` failure | Signals lost | P2 |
| Execution engine fails | Error logged but run still marked successful | Trades may not have executed | P1 |

---

## 2. Design Principles

1. **Fail-Partial, Not Fail-Complete** — one broken strategy or one unreachable market must not kill the entire run.
2. **Never Lose State** — every significant step is logged to a WAL before the next step begins.
3. **Graceful Degradation** — if live data is unavailable, serve the last known good signals with a clear `stale` flag.
4. **Observability First** — every failure path emits a structured log entry for Liam's monitoring stack.

---

## 3. Proposed Architecture

### 3.1 Pipeline State Machine

```
[START]
   │
   ▼
[LOAD LAST STATE] ──► if corrupt, recover from backup
   │
   ▼
[FETCH MARKETS] ──► retry 3x with exponential backoff
   │                    └──► fallback to cached markets after 3 failures
   ▼
[ENRICH MARKETS] ──► per-market timeout + catch
   │                    └──► skip market, continue with rest
   ▼
[RUN STRATEGIES] ──► each strategy in isolated try/catch
   │                    └──► DLQ: failed strategy signals + error
   ▼
[RISK CHECK] ──► if DB down, use in-memory limits + alert
   │
   ▼
[WRITE WAL] ──► atomic write to `trade_signals.wal`
   │
   ▼
[VALIDATE OUTPUT] ──► schema check + bounds check
   │                    └──► if invalid, rollback to previous good state
   ▼
[ATOMIC RENAME] ──► wal ──► trade_signals.json
   │
   ▼
[EXECUTE TRADES] ──► if fails, DLQ + alert
   │
   ▼
[ARCHIVE STATE] ──► rotate old signals to `output/archive/`
   │
   ▼
[DONE]
```

---

## 4. Layer 1 — Resilience (Retries & Circuit Breakers)

### 4.1 Kalshi API Retry Policy

**Current:** No retry in `kalshi_client.js` beyond rate-limit waiting.  
**Proposed:** Add a `RetryableKalshiClient` wrapper.

```javascript
const RETRY_POLICY = {
  maxRetries: 3,
  backoffMs: [1000, 3000, 10000], // exponential
  retryableStatusCodes: [429, 502, 503, 504],
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
};
```

**Implementation:**
- Wrap `client.request()` in a `withRetry()` helper.
- On `429`, read `Retry-After` header and wait explicitly.
- After 3 failures, **open the circuit breaker** for 60 seconds and fall back to cached market data.

### 4.2 Per-Market Fault Isolation

**Current:** `fetchCandles()` failure for one market aborts the entire run.  
**Proposed:** Wrap each market enrichment in `try/catch`.

```javascript
for (const market of selectedMarkets) {
  try {
    const candles = await withTimeout(fetchCandles(client, market.ticker), 10000);
    // enrich...
  } catch (err) {
    logFailure('MARKET_ENRICHMENT_FAILED', { ticker: market.ticker, error: err.message });
    // Skip this market, continue with the rest
    skippedMarkets.push(market.ticker);
  }
}
```

### 4.3 Strategy Isolation

**Current:** All strategies run in the same scope; one throw kills the run.  
**Proposed:** Run each strategy in an isolated `try/catch` block.

```javascript
const strategyResults = {};
for (const { name, instance } of strategies) {
  try {
    strategyResults[name] = engine.scan(enrichedMarkets, instance);
  } catch (err) {
    logFailure('STRATEGY_FAILED', { strategy: name, error: err.message });
    deadLetterQueue.push({ type: 'strategy_error', strategy: name, error: err.message, timestamp: new Date().toISOString() });
    strategyResults[name] = []; // empty signals for this strategy
  }
}
```

---

## 5. Layer 2 — Durability (WAL & Dead-Letter Queue)

### 5.1 Write-Ahead Log (WAL)

Before overwriting `trade_signals.json`, write an immutable WAL entry.

**File:** `agents/bob/output/trade_signals.wal`
**Format:** NDJSON (newline-delimited JSON)

```json
{"ts":"2026-04-03T10:00:00Z","event":"run_start","version":"1.0"}
{"ts":"2026-04-03T10:00:01Z","event":"markets_fetched","count":5}
{"ts":"2026-04-03T10:00:02Z","event":"strategy_complete","strategy":"mean_reversion","signals":3}
{"ts":"2026-04-03T10:00:03Z","event":"risk_check_complete","approved":3,"rejected":0}
{"ts":"2026-04-03T10:00:04Z","event":"output_written","path":"trade_signals.json","checksum":"a1b2c3"}
```

**Why:** If the process crashes between WAL events, the next run can read the WAL and determine exactly where the failure occurred.

### 5.2 Atomic Output Writes

**Current:** `fs.writeFileSync(OUTPUT_FILE, ...)` is not atomic; a crash mid-write produces a corrupted JSON file.  
**Proposed:** Write to a temp file, then `fs.renameSync()` atomically.

```javascript
const tmpFile = OUTPUT_FILE + '.tmp';
fs.writeFileSync(tmpFile, JSON.stringify(report, null, 2));
fs.renameSync(tmpFile, OUTPUT_FILE); // atomic on POSIX
```

### 5.3 Dead-Letter Queue (DLQ)

**File:** `agents/bob/output/dlq.jsonl` (append-only)

Records:
- Strategy failures
- Rejected signals (with reason)
- Failed trade executions
- API failures after retry exhaustion

```json
{"ts":"2026-04-03T10:00:02Z","type":"strategy_error","strategy":"crypto_edge","error":"Division by zero","payload":{...}}
{"ts":"2026-04-03T10:00:05Z","type":"execution_failed","ticker":"BTCW-26-JUN30-100K","reason":"Kalshi API 503","payload":{...}}
```

**Retention:** Rotate when file exceeds 10 MB; keep last 5 files.

### 5.4 State Snapshots

Keep the last **N=3** known-good `trade_signals.json` files as backups.

```
output/
  trade_signals.json          ← current
  trade_signals.json.bak.1    ← previous
  trade_signals.json.bak.2    ← 2 runs ago
  trade_signals.json.bak.3    ← 3 runs ago
```

**Rotation logic:**
```javascript
function rotateBackups(filePath, maxBackups = 3) {
  for (let i = maxBackups - 1; i >= 1; i--) {
    const src = `${filePath}.bak.${i}`;
    const dst = `${filePath}.bak.${i + 1}`;
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  }
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak.1`);
}
```

---

## 6. Layer 3 — Recovery (Validation & Restart)

### 6.1 Output Validation

Before atomically promoting the new `trade_signals.json`, run a schema validator.

```javascript
function validateSignals(report) {
  const errors = [];
  if (!report.generatedAt) errors.push('missing generatedAt');
  if (!Array.isArray(report.signals)) errors.push('signals must be an array');
  if (report.signals.length > 1000) errors.push('signal count exceeds sanity limit');
  for (const s of report.signals) {
    if (!s.ticker) errors.push('signal missing ticker');
    if (s.confidence < 0 || s.confidence > 1) errors.push(`invalid confidence: ${s.confidence}`);
    if (s.recommendedContracts < 0) errors.push(`invalid contract count: ${s.recommendedContracts}`);
  }
  return errors;
}
```

**On validation failure:**
1. Log to DLQ.
2. Do **not** promote the temp file.
3. Restore the most recent valid backup.
4. Emit `SIGNAL_VALIDATION_FAILED` alert.

### 6.2 Crash Recovery on Startup

When `live_runner.js` starts, check the WAL for an incomplete run.

```javascript
function recoverFromWAL(walPath) {
  if (!fs.existsSync(walPath)) return { recovered: false };
  const lines = fs.readFileSync(walPath, 'utf8').trim().split('\n');
  const lastEvent = JSON.parse(lines[lines.length - 1]);
  
  if (lastEvent.event !== 'output_written') {
    console.warn(`[RECOVERY] Detected incomplete run. Last event: ${lastEvent.event}`);
    // If output was not written, we can safely restart from the beginning.
    // If output was written but trades not executed, resume from execution.
    return { recovered: true, resumeFrom: lastEvent.event };
  }
  return { recovered: false };
}
```

### 6.3 Process Supervisor (run_scheduler.sh integration)

Grace's `run_scheduler.sh` already runs the pipeline on a schedule. Extend it with:

1. **Exit-code-aware restart policy:**
   - Exit code 0 → normal, wait for next interval.
   - Exit code 1 → failure, retry after 60s (max 3 retries).
   - Exit code 2 → validation failure, alert immediately, do not retry.

2. **Heartbeat file:**
   - After each successful run, write a heartbeat to `output/last_successful_run.timestamp`.
   - The monitor can alert if this file is older than 15 minutes.

### 6.4 Stale-Data Serving Contract

The dashboard API (`dashboard_api.js`) already checks signal age. Extend it:

```javascript
function readTradeSignals() {
  try {
    const data = JSON.parse(fs.readFileSync(TRADE_SIGNALS_PATH, 'utf8'));
    // If file is corrupted, fall back to backup
    return data;
  } catch (e) {
    console.error('Primary signals corrupted, attempting backup recovery');
    for (let i = 1; i <= 3; i++) {
      const bak = `${TRADE_SIGNALS_PATH}.bak.${i}`;
      if (fs.existsSync(bak)) {
        try {
          return JSON.parse(fs.readFileSync(bak, 'utf8'));
        } catch (_) {}
      }
    }
    return { generatedAt: null, signals: [], error: 'All signal backups corrupted or missing' };
  }
}
```

---

## 7. Monitoring & Alerting Integration

All failures must emit structured logs that Liam's `monitor.js` can consume.

| Alert ID | Condition | Severity | Action |
|----------|-----------|----------|--------|
| `LR-001` | `live_runner.js` exits non-zero 3 times in a row | P0 | Page on-call |
| `LR-002` | Kalshi API circuit breaker opens | P1 | Alert in dashboard |
| `LR-003` | Strategy fails (any) | P1 | Log to DLQ, alert in dashboard |
| `LR-004` | Risk manager DB unreachable | P1 | Alert in dashboard; fallback active |
| `LR-005` | `trade_signals.json` validation fails | P0 | Page on-call; restore from backup |
| `LR-006` | Signal file older than 15 minutes | P1 | Alert in dashboard |
| `LR-007` | DLQ grows > 10 entries in 1 hour | P1 | Alert in dashboard |

**Log format for monitor.js:**
```json
{"ts":"2026-04-03T10:00:02Z","level":"ERROR","component":"live_runner","alert_id":"LR-003","message":"Strategy crypto_edge failed","payload":{"error":"Division by zero"}}
```

---

## 8. Implementation Roadmap

### Phase 1 — Immediate (This Sprint)
1. Add `withRetry()` and `withTimeout()` wrappers to `kalshi_client.js`.
2. Add per-market `try/catch` in `live_runner.js` enrichment loop.
3. Add strategy isolation `try/catch` blocks.
4. Implement atomic file writes (`tmp` → `rename`) for `trade_signals.json`.
5. Add output schema validation before promotion.

### Phase 2 — Next Sprint
1. Implement WAL logging in `live_runner.js`.
2. Implement backup rotation (`bak.1`, `bak.2`, `bak.3`).
3. Implement DLQ (`dlq.jsonl`) with rotation.
4. Extend `dashboard_api.js` to read from backups if primary is corrupted.
5. Update `run_scheduler.sh` with retry-on-failure logic.

### Phase 3 — Follow-up
1. Add circuit breaker state machine to `kalshi_client.js`.
2. Add structured JSON logging for all monitor alerts.
3. Implement heartbeat file and integrate with `monitor.js`.

---

## 9. Files to Modify

| File | Change |
|------|--------|
| `agents/bob/backend/kalshi_client.js` | Add `withRetry()`, `withTimeout()`, circuit breaker |
| `agents/bob/backend/strategies/live_runner.js` | Add WAL, DLQ, atomic writes, validation, strategy isolation, per-market catch |
| `agents/bob/backend/dashboard_api.js` | Add backup fallback in `readTradeSignals()` |
| `agents/bob/backend/dashboard/run_scheduler.sh` | Add retry loop, heartbeat file |
| `agents/bob/backend/dashboard/monitor.js` | Add alert rules LR-001 through LR-007 |

---

## 10. Acceptance Criteria

- [ ] `live_runner.js` completes successfully when one strategy throws.
- [ ] `live_runner.js` completes successfully when `fetchCandles()` fails for one market.
- [ ] Kalshi API outage for > 30s does not crash the pipeline (fallback or retry succeeds).
- [ ] Corrupted `trade_signals.json` is automatically recovered from backup.
- [ ] Every failure produces a line in `dlq.jsonl`.
- [ ] `monitor.js` can detect and alert on all 7 failure scenarios.

---

*End of design document. Ready for implementation review with Alice and Bob.*
