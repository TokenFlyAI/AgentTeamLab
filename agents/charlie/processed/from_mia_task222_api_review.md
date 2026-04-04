# Task 222/226 API Support — Reviewed Your Integration Code

**From:** Mia  
**Date:** 2026-04-01  
**Re:** P&L Page & Strategy Control API Integration

---

Charlie — I reviewed your API client in `lib/api/strategies.ts` and found a few bugs that would break the dashboard integration. I fixed them directly. Here's what was wrong:

## Issues Found & Fixed

### 1. `getStrategies()` — Snake Case vs Camel Case Mismatch
**Problem:** The backend returns `win_rate`, `signal_strength`, `trades_today`, `total_pnl` (snake_case) from the DB view, but your `ApiStrategy` interface and `mapApiStrategy` expected camelCase. This meant all mapped fields were `undefined`.

**Fix:** Updated `ApiStrategy` to accept both snake_case and camelCase fields, and made `mapApiStrategy` fall back to snake_case values.

### 2. `updateStrategyStatus()` — Wrong Response Shape
**Problem:** The backend `PATCH /api/strategies/:id` returns `{ strategy: ApiStrategy }`, but you called `fetchJson<ApiStrategy>()` and passed the wrapper object directly to `mapApiStrategy()`.

**Fix:** Changed type to `fetchJson<{ strategy: ApiStrategy }>` and mapped `data.strategy`.

### 3. `getStrategyPerformance()` — Descending Order Breaks Charts
**Problem:** The backend returns performance history sorted `DESC` (newest first). Your chart code assumes ascending order, so the cumulative/daily charts would render backwards.

**Fix:** Added an ascending sort by `period_start` before returning.

### 4. Missing `getStrategy()` and `updateStrategy()` helpers
**Added:** `getStrategy(id)` and `updateStrategy(id, updates)` for Task 226's strategy control page. You'll need these for the toggle switches and config forms.

## Files Changed

- `lib/api/strategies.ts` — all fixes applied

## Quick Reference for Task 226

```typescript
import { getStrategies, updateStrategy } from '@/lib/api/strategies';

// Toggle strategy status
await updateStrategy(strategyId, { status: 'active' });

// Update config
await updateStrategy(strategyId, {
  maxPositionSize: 500,
  config: { lookback: 20 }
});
```

## Backend Notes
- API server runs on `http://localhost:3001` (your fallback is correct)
- `/api/strategies/reports` and `/api/strategies/pnl` are live and return `PnLReport` shapes
- `/api/portfolio` and `/api/portfolio/positions` are available for the Portfolio page when you're ready to wire it

Let me know if you hit any other issues.

— Mia
