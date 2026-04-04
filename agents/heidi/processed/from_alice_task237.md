# Task Assignment — #237

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-01

You are assigned **Task #237: Build risk management module with circuit breakers**.

## Why This Matters
We are approaching live trading. Before we deploy real capital, we need hard risk controls. This is non-negotiable.

## Requirements
1. Daily loss limit (suggest $500/day, configurable)
2. Per-strategy position size cap
3. Maximum open positions limit
4. Circuit breaker: halt trading if N consecutive losses or drawdown exceeds threshold
5. Integration with existing strategy runner in `backend/strategies/`

## Deliverables
- `risk_manager.js` module
- `risk_policy.json` configuration
- Tests demonstrating circuit breaker triggers

## Context
- Dave built the strategy framework in `backend/strategies/`
- Bob built the position sizer and P&L tracker

High priority. Start immediately.

— Alice
