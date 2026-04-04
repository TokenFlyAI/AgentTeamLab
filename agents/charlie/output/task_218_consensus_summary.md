# Task 218 Consensus Summary — Kalshi Edge Opportunities

**Prepared by:** Charlie (Frontend Engineer) and Grace (Data Engineer)  
**Date:** 2026-04-01  
**Status:** Complete

---

## Background

Two parallel research efforts were conducted for Task 218:
- **Grace/Ivan:** Data-science and modeling perspective (`public/reports/kalshi_market_research.md`)
- **Charlie:** Behavioral microstructure and execution perspective (`charlie/output/kalshi_market_research.md`)

Both reports are complementary and have been retained as reference documents.

---

## Consensus Top 3 Edge Opportunities

### 1. Economics: Pre-Release Nowcasting & Momentum
**Confidence:** HIGH | **Time to deploy:** 2-3 days

- Use alternative data (ADP, freight, credit card spending, Cleveland Fed nowcasts) to forecast CPI/NFP/Fed outcomes before official releases
- Kalshi prices drift 24-48h pre-release; informed positioning captures this momentum
- **Grace's focus:** Data pipelines and model features  
- **Charlie's focus:** Execution timing and dashboard signals

### 2. Niche-Category Longshot Fading
**Confidence:** HIGH | **Time to deploy:** 1 day

- Systematically sell YES contracts under 20¢ in weather, entertainment, and secondary sports
- Academic research on 313K+ Kalshi contracts confirms strong favorite-longshot bias
- Selling as a **maker** (limit orders) yields positive expected value and avoids taker fees
- **Best quick win:** Reuses Bob's existing API; lowest infrastructure lift

### 3. Cross-Platform / Correlated-Market Arbitrage
**Confidence:** MEDIUM-HIGH | **Time to deploy:** 1-2 days

- Exploit Kalshi-Polymarket divergences on political events (2-5¢ spreads persist)
- Hunt intra-Kalshi inconsistencies across correlated contracts (e.g., nomination → general election)
- Lower capacity than directional edges, but high Sharpe and model-independent

---

## Deprioritized: Sports Systematic Modeling

- NFL/NBA play-by-play modeling is data-rich and has volume, but requires 3-5 days of pipeline work
- Recommended as **Phase 2** after the three edges above are live

---

## Recommended Execution Order

1. **Longshot fading** — fastest path to live P&L, validates execution infrastructure
2. **Economic nowcasting** — highest edge potential, requires new data pipelines
3. **Arbitrage** — good risk-adjusted returns, requires Polymarket API integration
4. **Sports modeling** — scale play, tackle after core framework is proven

---

## Dashboard Priorities

Charlie will build UI modules to surface these edges:
- **Longshot Scanner** — filter markets by price <20¢, category, volume
- **Economic Calendar** — upcoming releases with implied probability vs. consensus
- **Arbitrage Monitor** — cross-platform and correlated-market divergence alerts

---

## Next Steps

- **Grace:** Stand up NFP nowcasting pipeline and sample data loader for Ivan
- **Bob/Dave:** Ensure strategy framework supports maker-order execution for longshot fading
- **Charlie:** Integrate strategy P&L dashboard with live API; build edge-surface UI modules
