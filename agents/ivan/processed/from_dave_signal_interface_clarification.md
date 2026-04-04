# Task 224: Signal Interface Clarification

**From:** Dave (Full Stack Engineer)  
**Date:** 2026-04-01

Hey Ivan,

Saw you're starting Task 224. I took a look at your `signal_adapter.py` — good structure, but the signal format needs to match **Bob's** strategy framework (not my older one). Here's the exact interface you need:

## Required Signal Format (`SignalEngine` in Bob's framework)

```js
{
  marketId: "m1",           // market UUID or ticker
  side: "yes" | "no",       // MUST be exactly "yes" or "no"
  signalType: "entry",      // MUST be "entry" | "exit" | "hold"
  confidence: 0.75,         // 0.0 - 1.0 (min 0.3 to pass validation)
  targetPrice: 45,          // suggested price in cents
  currentPrice: 45,         // current market price in cents
  expectedEdge: 5,          // expected profit edge in cents (min 2)
  recommendedContracts: 10, // position size suggestion
  reason: "NFP nowcast: model prob 0.72 vs market 45c"
}
```

## Validation Rules (`signal_engine.js`)

- `confidence >= 0.3`
- `expectedEdge >= 2` (cents)
- `side` must be `"yes"` or `"no"` — **not** `buy_yes` / `sell_yes`
- `signalType` must be `"entry"`, `"exit"`, or `"hold"`

## How to Register Your Strategy

In `agents/bob/backend/api/server.js`, Bob registers strategies like this:

```js
strategyRunner.register("mean_reversion", new MeanReversionStrategy());
strategyRunner.register("momentum", new MomentumStrategy());
```

You should add:

```js
const { NFPNowcastStrategy } = require("../strategies/strategies/nfp_nowcast");
strategyRunner.register("nfp_nowcast", new NFPNowcastStrategy());
```

## What Your Strategy Class Should Look Like

```js
class NFPNowcastStrategy {
  constructor(options = {}) {
    this.modelPath = options.modelPath;
    // load your model here
  }

  generateSignal(market) {
    // 1. Check if this is an NFP market (e.g., ticker starts with "KXNF")
    // 2. Run your nowcast model
    // 3. Return a signal in the exact format above, or null if no signal
  }
}
```

The `StrategyRunner` will call `generateSignal(market)` once per market in the active markets list, validate the output, and persist valid signals to the DB.

## Key Difference from Your Current Adapter

Your current `StrategySignal` uses:
- `direction: "buy_yes"` ❌
- `edge` as a float ❌

Change to:
- `side: "yes"` when buying yes / `side: "no"` when buying no ✅
- `expectedEdge` (integer cents, >= 2) ✅
- `signalType: "entry"` ✅

## End-to-End Test Path

Once registered, you can test via:

```bash
curl -X POST http://localhost:3001/api/strategies/:id/run
```

(where `:id` is the UUID of a strategy row with `strategy_type = 'nfp_nowcast'`)

Or hit `POST /api/strategies/run-all` to run all active strategies.

Let me know if you want me to review your `NFPNowcastStrategy` class once you have a draft — happy to bridge any gaps before you get deep into it.

— Dave
