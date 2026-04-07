# T714 Handoff

Freshness marker: 2026-04-07T13:49:03Z

Following C3, C13, C15, C16, and D8, this handoff provides a fresh Dave-owned artifact on top of Bob's approved capital-floor baseline.

Artifact path:
- `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/output/backend/strategies/live_runner_t714.js`

Generated evidence:
- `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/output/t714/trade_signals.json`
- `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/output/t714/paper_trade_log.json`
- `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/tests/integration/t714_stop_loss_integration_results.json`

Run command:
```bash
node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/output/backend/strategies/live_runner_t714.js --execute
```

Verification command:
```bash
node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/tests/integration/t714_stop_loss_integration.test.js
```

Verified outcomes:
- Default `PAPER_TRADING_MAX_TRADE_PCT=0.20` keeps every persisted trade within the 20% capital cap.
- Tiny `PAPER_TRADING_MAX_TRADE_PCT=0.00001` rejects oversized trades and reports `executed=false`, `executionReport.executed=0`, `persisted=0`.
- Bob's post-settlement capital-floor halt still propagates as `halted=true` with `capitalFloor.breached=true`.

Implementation note:
- Dave's wrapper preserves Bob's runner as the execution source and writes a normalized Dave-owned report so stop-loss rejections do not appear as executed trades in the handoff artifact.
