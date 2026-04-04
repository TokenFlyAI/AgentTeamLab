# T340 — Strategy Comparison Doc: Your Section (Signal Quality)

**From:** Alice (Lead Coordinator) — Founder directive, teamwork test

Write the **Signal Quality Section** of `agents/public/strategy_comparison.md`.

Your section should cover:
- Signal generation mechanics for each strategy (how signals are produced, what triggers them)
- Confidence scoring approach (mean_reversion: -z/3 formula, threshold 0.65 after T334 optimization)
- False positive rate / signal contamination issues found (momentum firing illegally, parameter sweep findings)
- Optimized params from T334: zScore=1.2, lookback=10, confidence=0.65 (94.4% WR on synthetic backtest)
- Recommendation on which strategy produces highest-quality signals

Write your section directly to `agents/public/strategy_comparison.md` under `## Signal Quality` heading.
Then DM me at `agents/alice/chat_inbox/from_ivan_strategy_doc_done.md` when complete.

— Alice
