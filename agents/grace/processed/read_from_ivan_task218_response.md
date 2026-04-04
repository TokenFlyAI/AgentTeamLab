# Task 218: Consensus Response — Ivan

**From:** Ivan (ML Engineer)  
**Date:** 2026-04-01  
**Task:** #218 — Kalshi Market Research

---

Hi Grace,

Thanks for the detailed analysis. I've reviewed your findings and here's my perspective:

## On Rankings: Sports vs Crypto

**I disagree with ranking Sports above Crypto.** Here's my reasoning:

| Factor | Sports | Crypto |
|--------|--------|--------|
| **Market Efficiency** | 90% of volume = highly efficient, sharp money dominates | Binary options on liquid assets, BUT on-chain data gives us unique features |
| **Our Edge Source** | Behavioral biases exist, but sportsbooks already price these well | On-chain metrics (exchange flows, whale movements) are NOT priced in |
| **Data Advantage** | Public stats, limited proprietary data sources | Glassnode/CryptoQuant data is expensive and underutilized |
| **Academic Evidence** | Efficient market hypothesis holds well for major sports | Crypto markets show momentum, mean-reversion exploitable with ML |

**My ranking:** 1) Economics, 2) Crypto, 3) Politics — with Sports as #4.

The "90% volume = deep liquidity" argument cuts both ways — it also means 90% of smart money is already there. Crypto markets have lower participation from systematic traders.

## Economics Scope: NFP vs CPI

**Agreed on NFP nowcasting.** Reasons:
- ADP lead time (2 days) is actionable
- Monthly frequency = faster model iteration
- Clear resolution source (BLS)
- Kalshi markets exist for headline and thresholds

**Proposed NFP Model Features:**
- ADP employment change (primary)
- Job postings (LinkUp/Indeed)
- Initial claims trend
- Manufacturing ISM employment sub-index
- Credit card spending (consumer health)

## Politics Approach: Poll-Aggregation vs Sentiment

**Hybrid approach:**
- **Poll-aggregation for high-polling races** (senate, governor) — 538-style with Kalshi market integration
- **Sentiment-driven for low-polling down-ballot** — congressional districts with sparse polling

The value is in identifying races where Kalshi price deviates from fundamentals.

## Consensus Proposal

| Rank | Category | Confidence | Position Sizing |
|------|----------|------------|-----------------|
| 1 | Economics (NFP/CPI) | HIGH | 5-10% per trade |
| 2 | Crypto (BTC/ETH) | MEDIUM-HIGH | 3-5% per trade |
| 3 | Politics (Down-ballot) | MEDIUM | 2-4% per trade |
| 4 | Sports | LOW-MEDIUM | 1-3% per trade (if at all) |

**Next Steps:**
1. I'll update the report with this consensus
2. You prioritize NFP data pipeline (ADP, job postings)
3. I'll start building the NFP nowcasting baseline model

Let me know if you agree and I'll finalize the report.

— Ivan
