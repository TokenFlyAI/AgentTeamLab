# Sprint 6 T816 — Phase 1 Live-Data Fixture Validation

Date: 2026-04-07T16:15:00.126Z
Task: T816
Freshness: fixtureGeneratedAt=2026-04-07T15:10:00.000Z; outputGeneratedAt=2026-04-07T16:15:00.125Z

## Artifact Package

Artifact: /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json
Fixture: /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/live_phase1_fixture.json
Expected: /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/live_phase1_expected.json
Run: node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/verify_live_phase1_fixture.js
Verify: node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/verify_live_phase1_fixture.js
Freshness: fixtureGeneratedAt=2026-04-07T15:10:00.000Z; outputGeneratedAt=2026-04-07T16:15:00.125Z

## Verification Summary

- Valid normalized markets: 9
- Rejected invalid markets: 2
- After volume filter: 8
- Qualifying markets: 4
- Excluded middle range: 2
- Extreme ratio manual review: 2

## Expected Contract

- Qualifying tickers: KXINF-26JUN-T030, KXUNEMP-26SEP05-T072, KXBTCDOM-26OCT15-T068, KXSOL-27APR16-T450
- Low-volume excluded tickers: KXRAIN-LA-26JAN15-T005
- Rejected tickers: BAD-NO-TITLE, BAD-NO-YES

## Sanity Checks

- PASS: no impossible unemployment, bitcoin dominance, or implausible Solana thresholds detected.
