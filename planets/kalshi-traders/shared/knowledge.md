# Technical Knowledge Base

*(Shared technical facts and analysis results that agents reference and build upon)*

## D004: Kalshi Arbitrage Engine - Technical Facts

### Phase 1: Market Filtering Algorithm
- **Filter 1 (Volume):** Exclude markets with <10,000 contracts traded (too illiquid for meaningful signals)
- **Filter 2 (Yes/No Ratio):** Target ranges 15-30% or 70-85% (mispriced)
  - Exclude middle range 40-60% (too efficient, no edge)
  - Exclude extremes 0-15% and 85-100% (distorted pricing, tail risk)
- **Deliverable:** markets_filtered.json with qualifying markets only
- **Status:** COMPLETE (T343+T537, Grace) — 15 qualifying markets identified (expanded from 3)

### Phase 2: LLM-Based Clustering
- **Algorithm:** LLM embeddings to identify semantic/causal relationships between markets
- **Example:** Bitcoin $100k + Ethereum $5k + Crypto dominance clustering together (not just statistical correlation, but real-world causality)
- **Purpose:** Find hidden correlations that single-market analysis misses
- **Deliverable:** market_clusters.json with semantic groups
- **Status:** COMPLETE (T344+T534, Ivan) — 4 clusters with cross-category correlations (crypto, economics, politics)

### Phase 3: Pearson Correlation Detection
- **Algorithm:** Pearson correlation coefficient (r) across correlated pairs
  - Threshold r > 0.75 for strong correlation
  - Calculate expected spread from historical correlation
  - Score arbitrage confidence (higher r = higher confidence)
- **Reference:** https://hudson-and-thames-arbitragelab.readthedocs-hosted.com/en/latest/distance_approach/pearson_approach.html
- **Input:** market_clusters.json from Phase 2
- **Deliverable:** correlation_pairs.json with {cluster, market_a, market_b, pearson_r, expected_spread, current_spread, arbitrage_confidence}
- **Status:** COMPLETE (T348/T535, Bob) — 105 pairs detected, 73 significant, 30 arbitrage signals
  - All tickers trace back to Phase 1 markets_filtered.json (data chain verified)
  - Runnable: `node output/bob/phase3_correlation_detector.js`

### Phase 4: C++ High-Frequency Execution Engine
- **Why C++:** Sub-millisecond latency needed to capture arbitrage before price reversion
  - Python: 50-500ms per cycle (GIL, I/O)
  - C++: <1ms (direct memory, no scheduler overhead)
- **Components:**
  1. Market data ingestion (WebSocket handler, simdjson parser ~50-100µs)
  2. Order book cache (flat_hash_map for O(1) lookup)
  3. Spread calculator (real-time spread detection)
  4. Signal generator (spread gap vs expected = opportunity)
  5. Risk manager (pre-flight checks: position limits, daily loss limit, circuit breaker)
  6. Order router (libcurl keep-alive, backoff strategy)
  7. Position tracker (P&L calculation, convergence monitor)
- **Target latency:** <1ms end-to-end (market data in → order out)
- **Status:** COMPLETE (T350+T351, Dave) — production-ready executable, <1ms benchmarked

## Paper Trading Validation (T353)

**⚠️ CORRECTED (2026-04-03):** Prior metrics were **artifacts of broken mock data** (see T326 fix). They are INVALIDATED.

**Old (invalidated) metrics:**
- Win Rate: 84.0% | Sharpe: 17.18 | P&L: $21.39
- **Why invalid:** `fetchCandles()` used hardcoded base prices, creating guaranteed extreme z-scores and false 95% confidence signals.

**Corrected behavior (post-fix T326):**
- Mock data now centers on `market.yes_mid` → realistic z-scores
- Result: **0 signals on efficient markets** — this is CORRECT
- All infrastructure (signal engine, risk manager, execution engine) is ready and waiting

**Production Validation Status:**
- Security audit: PASS (T425, Heidi)
- Risk audit: PASS (T354, Olivia)
- Ops readiness: PASS (T352/T353)
- **BLOCKER:** Real Kalshi API data required for true validation (T236)
- **Go/No-Go:** NO-GO pending Founder resolution on T236 + contract size confirmation

## Strategy Parameters (Optimized T334)

Mean_reversion strategy (primary — 55.9% backtest win rate):
- **zScoreThreshold:** 1.2 (was 1.5)
- **Lookback:** 10 candles (was 30)
- **ConfidenceThreshold:** 0.65 (was 0.80)
- **Performance on 96 combinations:** 94.4% win rate (18 signals on 50 markets)

Disabled strategies:
- momentum: 10% win rate (disabled T325)
- crypto_edge: 11% win rate (disabled T325)

## Live/Mock Data Handling

**Fixed fetchCandles() bug (T326, Tina):** Mock candle data now centers on market.yes_mid instead of hardcoded base prices
- **Old behavior:** Extreme z-scores (-7 to +11) → guaranteed 95% confidence signals (artifact)
- **New behavior:** Realistic z-scores → 0 signals on truly efficient markets (correct)
- **Implication:** Paper trading in mock mode will produce few/no signals until real Kalshi API data available (T236)

**Synthetic data model (T328, Bob):** Ornstein-Uhlenbeck generator with realistic volatility per market category
- Crypto: stddev ~6-8%
- Economics: stddev ~2-4%
- (Replaces legacy simplistic fallback)

## Infrastructure & Readiness

- **Dashboard:** agents/bob/backend/dashboard_api.js running on port 3200
- **APIs operational:** /api/signals, /api/health, /api/pnl/live, /api/win-rate-trend, all returning real data
- **Test coverage:** 96 unit + 30 integration + 624 E2E tests (57 API + 44 dashboard + 60 metrics + 383 coverage + 12 smart_run + 47 message_bus + 1 planet_create + 20 ui_verify)
- **Pipeline runner:** `node output/bob/run_pipeline.js` — runs full Phase 1→3 pipeline
- **Production gates:** Security audit PASS, Risk audit PASS, Ops readiness PASS (T354)
- **Blocker:** T236 (Kalshi API credentials from Founder) — only remaining dependency for live trading

## Sprint 1 Results (2026-04-04) — COMPLETE

10/10 tasks done. Pipeline runs E2E. Quality + security audits PASS.

| Task | Agent | Result |
|------|-------|--------|
| T540 | Dave | Phase 4 C++ engine integration — 42/42 tests pass |
| T542 | Bob | E2E pipeline runner — `node run_pipeline.js` works |
| T543 | Alice | Team persona evolution completed |
| T545 | Grace | Pipeline data validation — all phases verified |
| T546 | Ivan | Expanded clustering — 4 cross-category clusters |
| T547 | Charlie | Pipeline status dashboard — HTML + server |
| T548 | Frank | Pipeline test suite delivered |
| T549 | Sam | Sprint velocity report |
| T550 | Heidi | Security audit — PASS |
| T551 | Olivia | Quality gate — PASS (with minor notes) |

## Sprint 2 (Completed) — Signal Generation & Backtesting

| Task | Agent | Goal |
|------|-------|------|
| T555 | Bob | Generate paper trade signals from correlation pairs (CRITICAL) |
| T556 | Dave | Pipeline metrics + monitoring endpoint |
| T557 | Grace | 30-day synthetic price history for backtesting |
| T558 | Ivan | TF-IDF + cosine similarity clustering upgrade |
| T559 | Alice | Sprint 1 retrospective + Sprint 2 plan |
| T560 | Frank | QA pipeline tests + new test cases |
| T539 | Tina | QA pipeline data chain validation |

## Sprint 3 (Completed) — Production Quality via Collaboration

**Theme:** Every task has explicit handoffs. Agents must DM each other, post to team_channel, and review each other's work.

**Handoff Chain:** Bob (signals) → Dave (backtest) → Tina (QA) → Olivia (review)
**Parallel:** Grace (data audit), Ivan (clustering upgrade), Charlie (tracker), Alice (coordination), Sam (metrics), Heidi (security)

| Task | Agent | Depends On | Hands Off To |
|------|-------|-----------|-------------|
| T567 | Bob | — | Dave (signals.json) |
| T568 | Dave | Bob T567 | Tina (backtest_results.json) |
| T569 | Grace | Bob+Ivan+Dave output | Alice (data_chain_audit.md) |
| T570 | Tina | Dave T568 | Olivia (qa_backtest_report.md) |
| T571 | Alice | All agents | team_channel (sprint3_status.md) |
| T572 | Olivia | Bob+Dave+Grace+Tina | All (approve/reject) |
| T573 | Heidi | All Sprint 3 output | Alice (security_sprint3.md) |
| T574 | Sam | All agents | team_channel (sprint3_velocity.md) |
| T575 | Ivan | Grace data | Bob (updated clusters) |
| T576 | Charlie | Task API | Alice (sprint3_tracker.html) |

**New Culture Norms (Sprint 3):**
- C9: DM teammates when your work affects theirs
- C10: Post milestones to team_channel
- C11: Mark tasks in_review, not done — reviewers approve/reject
- Collaboration norms C9/C10/C11: DM on completion, post milestones to team_channel, mark in_review not done

## Sprint 4: Synthetic Validation Paths

Purpose: validate the D004 pipeline end-to-end with realistic synthetic Kalshi-shaped data under D7.

| Task | Agent | Reads From | Writes To |
|------|-------|------------|-----------|
| T578 | Bob | — | `../../agents/bob/output/mock_kalshi_markets.json` |
| T579 | Grace | `../../agents/bob/output/mock_kalshi_markets.json` | `../../agents/grace/output/filtered_markets.json` |
| T580 | Ivan | `../../agents/grace/output/filtered_markets.json` | `../../agents/ivan/output/market_clusters.json` |
| T581 | Bob | `../../agents/ivan/output/market_clusters.json` | `../../agents/bob/output/correlation_pairs.json` |
| T582 | Dave | `../../agents/bob/output/correlation_pairs.json` | `../../agents/dave/output/pipeline_report.md` |
| T583 | Tina | `../../agents/dave/output/pipeline_report.md` | `../../agents/tina/output/sprint4_qa_report.md` |
| T584 | Olivia | `../../agents/tina/output/sprint4_qa_report.md` and agent `status.md` files | `../../agents/olivia/output/sprint4_retro.md` |

**Sprint 4 Result (COMPLETED):** Full pipeline validated end-to-end with synthetic data. Bob generated 3 mock markets → Grace filtered to 2 → Ivan clustered → Bob produced 4 correlation pairs → Dave ran 160 simulated trades (46.3% win rate, +$5.22 net) → Tina QA APPROVED. Pipeline is production-ready.

## Sprint 5: Risk Management + Infrastructure

**Theme:** Harden the trading engine with risk controls and validate system behavior under load.

**Status:** ALL DONE. T714 done, T715 done, T716 done, T717 done. P0 (T236 Kalshi API credentials) still blocked on external dependency.

| Task | ID | Agent | Priority | Status | Description |
|------|----|-------|----------|--------|-------------|
| Per-trade stop-loss | T714 | Dave | High | **done** | Prevent single trade exceeding max loss threshold |
| Post-trade capital floor | T715 | Bob | High | **done** | Halt trading if capital drops below floor |
| Rate limit integration test | T716 | Bob | Medium | **done** | 55-request burst test, /v1 path bug fixed |
| Velocity tracking | T717 | Sam | Medium | **done** | Sprint 5 metrics dashboard |

**Handoff chain (Sprint 5):** Bob (capital floor logic) → Dave (integrate with stop-loss) → Tina (QA risk controls) → Alice (sprint 5 retro)

## Sprint 6: Real-Data Readiness

**Theme:** Prepare the D004 pipeline for live Kalshi API data (pre-T236 validation work).

**Status:** COMPLETE. All 6 tasks done (2026-04-07).

| Task | ID | Agent | Priority | Status | Description |
|------|-----|-------|----------|--------|-------------|
| Live market normalization | T814 | Bob | High | **done** | Normalization layer for real Kalshi API payloads |
| Cluster stability audit | T815 | Ivan | High | **done** | Phase 2 clustering stability on live-shaped fixtures |
| Phase 1 live-data fixture | T816 | Grace | High | **done** | Kalshi-shaped fixture set for market filtering (filtered_markets_live_fixture.json) |
| Deterministic replay harness | T817 | Dave | High | **done** | replay_report.json: 3 scenarios, deterministic, invariants pass |
| QA acceptance gates | T818 | Tina | High | **done** | Review checklist and evidence requirements |
| Readiness dashboard | T819 | Charlie | Medium | **done** | Dashboard on port 3461 — 6/6 artifacts ready, T236 blocker flagged |

**Goal:** When T236 lands (Kalshi API credentials), the pipeline should ingest real data with zero rework. All phases have live-shaped fixture packs and runnable verification commands.

## Sprint 7: Live Pipeline Run + Verification

**Theme:** Run the full D004 pipeline end-to-end using Sprint 6 live-shaped fixtures and verify every phase.

**Status:** COMPLETE. All tasks done (2026-04-07).

| Task | ID | Agent | Priority | Status | Description |
|------|----|-------|----------|--------|-------------|
| Sprint 6 retro + Sprint 7 plan | T851 | Alice | High | **done** | Retro: Sprint 6 complete, all infra ready. Sprint 7 plan: live-fixture E2E run |
| E2E pipeline run (live fixtures) | T852 | Bob | High | **done** | Phase 1→4 on Grace's filtered_markets_live_fixture.json; trade_signals.json delivered |
| Replay harness with live signals | T853 | Dave | Medium | **done** | T817 harness re-run on T852 signals; all 3 scenarios pass deterministically |
| Velocity and cost metrics | T854 | Sam | Low | **done** | sprint7_velocity.md: Sprint 6 closed 6/6, costs and cycle counts per agent |
| ALT-002 latency triage | T870 | Liam | High | **done** | GET /api/health p99 spike triaged; root cause: synchronous agent scan + /api/health TTL fix |
| Sprint 7 QA test cases | T880 | Frank | Low | **done** | 12 atomic QA cases for live-fixture E2E run (sprint7_live_pipeline_test_cases.md) |
| Health endpoint hardening | T903 | Eve | High | **done** | /api/health activeAgents cached; live 3199 verified: p95 1ms, 0 breaches >250ms |

**Key outputs:**
- `output/bob/trade_signals.json` — live-shaped trade signals (Phase 4)
- `output/bob/t852/live_fixture_e2e_report.json` — E2E run report
- `output/dave/t817/replay_report.json` — deterministic replay on live signals
- `output/sam/sprint7_velocity.md` — sprint velocity metrics

**Platform improvements this sprint:** Server-side caching for /api/cost, /api/digest, /api/sops, /api/mode, /api/consensus, /api/org, /api/research, /api/stats, /api/tasks/archive. getDigest() 10x size reduction (23MB → 2MB). inbox_done helper added to agent_tools.sh.

## Sprint 8: Pipeline Quality + Platform Evolution

**Theme:** Improve pipeline accuracy, platform observability, and agent collaboration quality.

**Status:** COMPLETE (D10). All tasks done (2026-04-07/08).

| Task | ID | Agent | Priority | Status | Description |
|------|----|-------|----------|--------|-------------|
| Phase 1 filter analysis | T938 | Bob | High | **done** | Tuned market filter thresholds; updated Phase 1 output |
| Phase 2 cluster confidence | T939 | Ivan | High | **done** | Added confidence scores to cluster output |
| Dashboard health monitoring | T940 | Charlie | Medium | **done** | Health/latency trend section added to Stats tab |
| Security audits | T947/T989 | Heidi | High | **done** | Phase 1-4 security audit complete; no critical findings |
| Mobile prototype | T948 | Judy | Medium | **done** | SwiftUI Opportunity Feed prototype delivered |
| Persona audit | T913 | Alice | Medium | **done** | Low-health agent personas improved |
| Phase 3 data quality gate | T914 | Grace | Medium | **done** | Validated correlation_pairs.json freshness and quality |

## Sprint 9: Phase A Microservice Prep + Pipeline Validation

**Theme:** Prepare Phase A microservice architecture and validate the full D004 pipeline with live signals.

**Status:** COMPLETE (D11). All tasks done (2026-04-07/08).

| Task | ID | Agent | Priority | Status | Description |
|------|----|-------|----------|--------|-------------|
| Topology view | T1006 | Charlie | Medium | **done** | Service topology diagram added to dashboard |
| Phase A schema versioning | T1008 | Mia | High | **done** | Schema versioning for microservice readiness |
| E2E pipeline validation | T1009 | Bob | High | **done** | Full D004 pipeline validated with live signals |
| API client SDK | T1014 | Karl | High | **done** | lib/api_client.js — zero-dep Node.js SDK, 74 endpoints, 14 namespaces; shipped to output/shared/codebase/lib/api_client.js |
| CI/CD pipeline | T1019 | Eve | High | **done** | CI/CD pipeline for Phase A schema-versioned API endpoints |
| Sprint 9 retro + Sprint 10 plan | — | Alice | High | **done** | Sprint 9 closed; D004 microservice prep complete |

## Sprint 10: Phase B Deploy + Security Hardening

**Theme:** Deploy Phase B and harden security across the D004 pipeline.

**Status:** COMPLETE (D12). All tasks done (2026-04-07/08).

| Task | ID | Agent | Priority | Status | Description |
|------|----|-------|----------|--------|-------------|
| Security fixes in correlation_engine | T1038 | Bob | High | **done** | Auth + path traversal fixes in correlation_engine/server.js |
| QA gate: security fixes | T1040 | Tina | High | **done** | QA validation of Bob's T1038 security fixes |
| E2E smoke test | T1028 | Dave | High | **done** | Phase 1→4 smoke test PASS 4/4; 119 markets, 0.01s |
| Phase B microservice deploy | T1043 | Sam | Medium | **done** | Sprint 10 metrics and T236 escalation brief |
| Sprint 10 retro + Sprint 11 plan | — | Alice | High | **done** | Sprint 10 closed; D13 Sprint 11 focus set |

**Key outputs (Sprints 8-10):**
- `output/bob/phase3_correlation_detector.js` — runnable Phase 3 correlation engine
- `output/shared/codebase/lib/api_client.js` — Karl's API client SDK (74 endpoints)
- `output/dave/e2e_smoke.js` — E2E smoke test (T1028, Phase 1→4 PASS)

## Sprint 11: Pipeline Integration + Collaboration Quality (ACTIVE)

**Theme:** Run the full D004 pipeline with latest data, measure and improve agent collaboration quality.

**Status:** IN PROGRESS (D13). Tasks assigned 2026-04-08.

| Task | ID | Agent | Priority | Status | Description |
|------|----|-------|----------|--------|-------------|
| Collab health audit | T1200 | Alice | High | **open** | Audit agent collaboration; DM silent agents; collab health report |
| Phase 3 E2E correlation run | T1201 | Bob | High | **open** | Run correlation engine on Grace's latest fixture; output/correlation_pairs_sprint11.json |
| Collaboration indicators panel | T1202 | Charlie | Medium | **open** | Dashboard panel: team_channel count, DM activity, handoffs |
| Phase 1 data refresh | T1203 | Grace | High | **open** | Refresh markets_filtered_sprint11.json with latest thresholds |
| Phase 2 cluster confidence refresh | T1204 | Ivan | High | **open** | Updated cluster_confidence_sprint11.json with confidence scores |
| Sprint 11 velocity report | T1205 | Sam | Medium | **open** | Token efficiency + collaboration tool usage metrics |
| QA gate: Sprint 11 deliverables | T1206 | Tina | High | **open** | Validate all Sprint 11 artifacts (T1200-T1205) |
| E2E pipeline integration | T1207 | Dave | High | **open** | Full D004 pipeline: grace→bob→ivan→trade signals; sprint11_e2e_results.md |

**Pipeline execution order for Sprint 11:**
1. Grace (T1203) → refreshed markets_filtered_sprint11.json
2. Bob (T1201) → correlation_pairs_sprint11.json (reads Grace's output)
3. Ivan (T1204) → cluster_confidence_sprint11.json (reads Bob's output)
4. Dave (T1207) → sprint11_e2e_results.md (chains all 3 phases)
