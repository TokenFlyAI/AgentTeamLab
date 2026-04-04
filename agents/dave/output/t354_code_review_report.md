# T354 Code Review Report — Phase 4 Engine

**From:** Dave  
**Date:** 2026-04-03  
**Engine:** `agents/bob/backend/cpp_engine/engine.cpp`

---

## 1. Memory Safety (ASan)

**Command:**
```bash
clang++ -std=c++20 -pthread -fsanitize=address -g -o engine_asan engine.cpp
clang++ -std=c++20 -pthread -fsanitize=address -g -o test_suite_asan test_suite.cpp
```

**Result:** ✅ CLEAN — zero memory leaks, zero use-after-free, zero buffer overflows.

**Bug Found & Fixed:**
- **Issue:** `engine::ExecutionEngine::stop()` called `feed_handler_->disconnect()` without checking if `feed_handler_` was initialized. This caused a SEGV when engine initialization failed (e.g., missing `correlation_pairs.json`).
- **Fix:** Added null check: `if (feed_handler_) { feed_handler_->disconnect(); }`
- **Verification:** Re-ran ASan after fix — no errors.

**Test Suite with ASan:**
```
Passed: 24
Failed: 0
Total:  24
```

---

## 2. Thread Safety Review

**Mutex Inventory:**
| Component | Mutex Type | Purpose |
|-----------|-----------|---------|
| OrderBookCache | `std::shared_mutex` | Multiple readers (strategy + position monitor), single writer (MD parser) |
| SignalGenerator | `std::mutex` | Protect cooldown map |
| RiskManager | `std::mutex` | Protect circuit breaker state + loss history |
| OrderRouter | None | Stateless mock; real implementation would need connection mutex |
| PositionTracker | `std::mutex` | Protect position ledger |
| ExecutionEngine | `std::mutex` (signals + risk) | Protect latest_signals_ and risk_summary_ |

**Lock Ordering:**
- No nested locks across different components.
- Each component acquires at most one mutex per operation.
- **Deadlock risk: LOW** — no circular dependency between mutexes.

**Recommendations for Production:**
- OrderBookCache: Benchmark `shared_mutex` vs `flat_hash_map` + atomics under contention.
- RiskManager: Consider `std::atomic` for simple counters (daily trades, exposure) to reduce lock contention.

---

## 3. Error Handling Coverage

**Fatal Errors (engine shutdown):**
- ✅ Missing/corrupt `correlation_pairs.json` → `initialize()` returns `false`
- ✅ Feed handler connect failure → `initialize()` returns `false`
- ✅ Order router init failure → `initialize()` returns `false`

**Recoverable Errors (log + continue):**
- ✅ WebSocket disconnect → auto-reconnect (stubbed in mock feed)
- ✅ Order submission failure → retry with exponential backoff
- ✅ Stale market price → skip pair, wait for fresh data
- ✅ JSON parse failure → drop frame (in `CorrelationPairsLoader`)

**Degraded Mode:**
- ✅ Circuit breaker triggered → stop generating new signals, monitor existing positions only
- ✅ Missing market in cache → skip pairs involving that market

**Emergency Procedures:**
- ✅ Partial fill (leg A fills, leg B fails) → attempt cancel leg A + record partial fill
- ✅ Unhedged leg cleanup handled in `OrderRouter::submit_paired()`

---

## 4. Status.md Updated

Yes — `status.md` refreshed to reflect T351 completion and T354 review results.

---

## Sign-off

- [x] Memory safety verified (ASan clean)
- [x] Thread safety reviewed
- [x] Error handling confirmed
- [x] Critical bug fixed and re-verified
- [x] Engine ready for paper trading (T353)

**Dave — 2026-04-03**
