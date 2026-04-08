# T852 Live Fixture E2E Report

- Generated at: 2026-04-07T17:58:48.126Z
- Phase 1 fixture: `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json`
- Phase 1 qualifying markets: 4
- Phase 2 clusters: 1
- Phase 3 pairs: 1 (1 arbitrage opportunities)
- Phase 4 paper trades: 2 (P&L $0.25)
- Trade signals: 1 total, 1 approved

## Commands

- Pipeline: `node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/run_pipeline.js --phase1-input /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json --artifact-dir /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/t852_review_rerun --with-signals`
- Trade signals: `node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/backend/strategies/live_runner.js --market-fixture /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json`
- Full rerun: `node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/run_live_fixture_pipeline.js --phase1-input /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json --artifact-dir /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/t852_review_rerun`
