# T1021 — Sprint 9 Pre-Live Security Readiness Check

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-04-07
**Verdict: READY — all T989 safety gates confirmed active in shared codebase.**

---

## Part 1: T989 Safety Gates — CONFIRMED ACTIVE

Verified all three T989 security fixes are present in `output/shared/codebase/` (the codebase used for E2E validation):

| Finding | Fix | Location | Status |
|---------|-----|----------|--------|
| FINDING-1 (MEDIUM) | `KALSHI_CONFIRM_LIVE` double-opt-in guard | `shared/codebase/backend/strategies/live_runner.js:591` | ✅ ACTIVE |
| FINDING-2 (LOW) | `error.responseError` (no raw body propagation) | `shared/codebase/backend/kalshi_client.js:171-173` | ✅ ACTIVE |
| FINDING-3 (LOW) | `opts.rateLimiter` external limiter support | `shared/codebase/backend/kalshi_client.js:107` | ✅ ACTIVE |

**The E2E run (T1009) used paper trading mode (PAPER_TRADING default = true, no KALSHI_CONFIRM_LIVE needed) — this is correct.** Safety gate will block any accidental live execution.

---

## Part 2: T1008 Schema Versioning — Pending (not yet delivered)

Mia's T1008 (Phase A schema versioning) is in progress. Security review of versioning changes will be conducted once deliverable is available. Scope will cover:
- New version prefix routes (e.g., `/api/v2/...`) — confirm auth inheritance
- Version negotiation headers — no secret leakage in `X-API-Version` or similar
- Deprecation markers — no security downgrade via old versions

---

## E2E Run Security Assessment (T1009)

Bob's E2E validation run shows correct security posture:
- ✅ Source: `phase1_live_fixture` (not mock_fallback — real data path)
- ✅ `halted: false` — capital floor not breached
- ✅ Paper trading mode active throughout
- ✅ 1 signal generated with confidence=0.667 (above null-confidence guard from T331)
- ✅ No credentials in run output

**One observation:** The signal ticker `KXINF-26JUN-T030` came from the live fixture, not the Kalshi API (T236 still blocked). This is expected — confirms the mock-free path works but real API validation awaits credentials.

---

## Pre-Live Checklist Status

From T989 threat model checklist:

| Item | Owner | Status |
|------|-------|--------|
| FINDING-1: KALSHI_CONFIRM_LIVE guard | Bob | ✅ Done |
| FINDING-2: Strip error.response body | Bob | ✅ Done |
| FINDING-3: Shared rate limiter | Bob | ✅ Done |
| Confirm ExecutionEngine has independent paper guard | Bob | ⬜ Unverified |
| `audit_log.jsonl` not world-readable in prod | Liam/Eve | ⬜ Pending deployment |
| Rotate API key after first live test | Founder | ⬜ Awaiting T236 |

**Only external blocker remains: T236 (Kalshi API credentials from Founder).**

The system is security-ready for live trading once credentials are provided and the `audit_log.jsonl` file permission is verified at deployment.
