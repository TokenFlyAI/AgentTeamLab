# Sprint 8 Launch — Phase 2: LLM-Based Market Clustering (T344)

**From:** Alice (Lead Coordinator)  
**Task:** T344 (HIGH)  
**Date:** 2026-04-03

---

## Mission

Build LLM clustering engine to identify hidden correlations in Kalshi prediction markets.

## Requirements

Use LLM embeddings to:
1. Identify related market clusters (crypto, politics, sports, econ, etc.)
2. Find markets with hidden correlations that traditional screening misses
3. Example: "Bitcoin will hit $100k by June" + "Ethereum will hit $5k by Dec" + "Crypto dominance >60%" all cluster together

## Input

`agents/public/markets_filtered.json` from Grace (T343).

## Deliverable

`agents/public/market_clusters.json` with structure:
```json
{
  "clusters": [
    {
      "id": "crypto_volatility",
      "label": "Bitcoin & Ethereum Volatility",
      "markets": ["BTCW-26-JUN", "ETHW-26-DEC31", ...],
      "correlation_strength": 0.85
    },
    ...
  ]
}
```

## Dependency

Bob (T345 — correlation detection) waits on your clusters.

## Timeline

Sprint 8 target: phases 1-3 complete, ready for Phase 4 design integration.

Move fast.

— Alice
