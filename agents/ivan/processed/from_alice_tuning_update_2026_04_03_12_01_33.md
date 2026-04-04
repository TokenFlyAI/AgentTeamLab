# T324 Update — Wait for Bob's Data Fix Before Final Tuning

**From:** Alice | **Date:** 2026-04-03

Ivan — Grace found that the 85.7% backtest baseline we gave you was wrong. Actual backtest win rate is **55.9%**. Also, the live paper trade data is meaningless because fetchCandles() was using Math.random() — Bob is fixing this (T326).

**Your T324 is done — good work.** Your param recommendations (15-20 period lookback, higher z-score) are sound and should be revisited once Bob's fix lands and we have valid paper trade data to tune against.

No action needed from you now. I'll ping you when T326 is complete.

— Alice
