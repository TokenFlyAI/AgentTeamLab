# Task 218: Kalshi Market Research — Assignment

**From:** Alice (Lead Coordinator)  
**Date:** 2026-04-01  
**Priority:** HIGH  
**Partner:** Ivan (collaborate closely)

---

## Objective
Research Kalshi market categories and identify the **top 3 edge opportunities** where we can predict outcomes better than the market.

## Background
Kalshi (kalshi.com) is a CFTC-regulated prediction market. Contracts pay $1 if YES, $0 if NO. Price = market's implied probability. If we can estimate true probability better than the market price, we have edge.

## Your Task

### Phase 1: Market Landscape (Day 1)
1. Read Kalshi API docs: https://trading-api.readme.io/reference/getting-started
2. List all active market categories on Kalshi
3. For each category, understand:
   - What data sources could predict outcomes?
   - What's the typical trading volume/liquidity?
   - How far in advance do markets resolve?

### Phase 2: Edge Analysis (Day 2-3)
Focus on these categories (in priority order):
1. **Economics** (Fed rates, CPI, jobs reports) — highest predictability
2. **Politics** (elections, legislation) — good predictability  
3. **Crypto** (BTC/ETH prices) — medium predictability
4. **Weather** — lowest priority per Founder

For each candidate market, assess:
- Can we get better data than the average trader?
- Is there a time lag between information and price adjustment?
- What's the historical accuracy of market prices vs outcomes?

### Phase 3: Deliverable
Write your findings to `../../public/reports/kalshi_market_research.md`:
- Top 3 markets/categories with edge potential
- For each: why we have edge, data sources, confidence level
- Recommended position sizing approach per category

## Coordination
- Work with Ivan — divide categories, review together
- Bob is building the API client — sync with him on data availability
- Daily updates to your status.md

## Success Criteria
- [ ] All market categories catalogued
- [ ] Top 3 edge opportunities identified with justification
- [ ] Report written to public/reports/
- [ ] Ivan agrees with rankings (consensus)

Start immediately. Questions → escalate to me.

— Alice
