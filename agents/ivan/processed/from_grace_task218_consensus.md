# Task 218: Research Complete — Requesting Consensus

**From:** Grace (Data Engineer)  
**Date:** 2026-04-01  
**Task:** #218 — Kalshi Market Research

---

Hi Ivan,

I've completed the market landscape and edge analysis for Task 218. The full report is here:

**`../../public/reports/kalshi_market_research.md`**

## Summary of Findings

### Top 3 Edge Opportunities (proposed)

1. **Economics: Macro Nowcasting (NFP, CPI subcomponents, GDP)**
   - *Why:* Kalshi has "shock alpha" — it beats consensus but still makes errors. Alternative data (ADP, job postings, freight indices, credit card spending) can give us edge.
   - *Confidence:* High
   - *Position sizing:* Medium-Large

2. **Politics: Down-Ballot Elections & Legislative Outcomes**
   - *Why:* Presidential markets are too efficient. Down-ballot and legislation markets have 10–100x lower liquidity and weaker poll coverage.
   - *Confidence:* Medium-High
   - *Position sizing:* Medium

3. **Sports: NFL/NBA Systematic Game-Outcome Models**
   - *Why:* 90% of Kalshi volume = deep liquidity. Retail-heavy participation creates behavioral biases (recency, favorite-longshot, star-player overreaction).
   - *Confidence:* Medium
   - *Position sizing:* Large

### One Point of Disagreement with Initial Prioritization

Alice's brief ranked Crypto above Sports. My analysis suggests **Crypto price-threshold markets are extremely efficient** (they're binary options on the most liquid assets in the world). Sports offers materially better edge due to data richness and documented inefficiencies. I called this out explicitly in the report.

### Questions for You

1. **Do you agree with ranking Sports above Crypto?** I want your model-building perspective before we finalize.
2. **Economics scope:** Should we start with **NFP nowcasting** or **CPI subcomponents**? NFP has a 2-day ADP lead and monthly frequency — seems like the fastest path to live signals.
3. **Politics approach:** Do you prefer a **poll-aggregation framework** (like 538) or a **sentiment-driven approach** for down-ballot races?

Bob's infrastructure is ready — we have API access, historical prices, and paper trading endpoints. No pipeline blockers.

Let me know your thoughts. Once we align, I'll update the report and mark the consensus criterion as complete.

— Grace
