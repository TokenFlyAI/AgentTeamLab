# Kalshi Market Anomaly Detection Strategies — Research Report

**Task:** T406  
**Author:** Ivan (ML Engineer)  
**Date:** 2026-04-03  
**Status:** COMPLETE

---

## Executive Summary

While D004 (pairs arbitrage) is technically complete and production-ready, the team needs additional strategy pillars for D002 (data-driven trading strategies). This report identifies and ranks **three distinct, evidence-based trading approaches** for Kalshi prediction markets beyond our current pairs-arbitrage engine.

Each strategy is evaluated on:
- **Empirical support** (academic or practitioner evidence)
- **Kalshi-specific feasibility** (liquidity, fees, API capabilities)
- **Implementation complexity** for Agent Planet
- **Expected edge sustainability**

| Rank | Strategy | Expected Edge | Complexity | Sustainability |
|------|----------|---------------|------------|----------------|
| 1 | Favorite-Longshot Bias Exploitation | 2-4% | Low | High |
| 2 | Cross-Platform Arbitrage | 1-3% | Medium | Medium |
| 3 | Information Velocity / News Momentum | 3-8% | High | High (with data moat) |

---

## Strategy 1: Favorite-Longshot Bias Exploitation ⭐ (RECOMMENDED)

### Concept
Prediction markets exhibit a well-documented **favorite-longshot bias**: low-probability ("longshot") contracts are systematically overpriced, while high-probability ("favorite") contracts are systematically underpriced. This creates a persistent edge for buying favorites and selling/avoiding longshots.

### Academic Evidence (Kalshi-Specific)

Multiple independent academic studies analyzing **313,972+ Kalshi contracts** confirm this bias:

- **UCD Economics WP2025_19** & **GWU FORCPGM 2026-001**: Found that contracts priced 1-10¢ win significantly less often than their implied probability, while 90-99¢ contracts win significantly more often.
- The bias persists **across all volume quintiles** — it is *not* merely a low-liquidity artifact.
- The bias persists **across all market categories** (financials, crypto, climate, politics, entertainment), though it is somewhat smaller in politics/entertainment.
- **Mincer-Zarnowitz F-tests** firmly reject the null hypothesis that Kalshi prices are unbiased forecasters of outcomes.

**Key finding:** Makers (liquidity providers) are more likely to hold the favorite side (56.5% maker share for 90-99¢ contracts vs. 43.5% for 1-10¢), suggesting informed flow concentrates in longshots while market makers demand a premium to hold them.

### Data Sources & Signals
- **Primary:** Kalshi REST API — closing/mid prices, volume, trade direction (maker/taker flags)
- **Signal:** Price percentile ranking within market + historical win rate by price bucket
- **Feature engineering:**
  - `price_bucket` (decile of current price)
  - `historical_win_rate_in_bucket` (from Kalshi historical data)
  - `implied_prob_vs_actual_win_rate_delta`
  - `maker_taker_imbalance` (if available via API)

### Feasibility Assessment
| Factor | Assessment |
|--------|------------|
| **Edge magnitude** | 2-4% per trade (buying 90-99¢ favorites, avoiding 1-10¢ longshots) |
| **Win rate** | 55-60% on favorites, but with positive expected value due to mispricing |
| **Liquidity requirement** | Low — favors high-volume markets where bias still exists |
| **Holding period** | Days to weeks (hold until resolution) |
| **Fee impact** | Kalshi fees are manageable; edge exceeds transaction costs |
| **Implementation** | Simple rule-based filter + ML calibration for probability adjustment |

### ML Opportunity
We can train a **calibration model** (e.g., gradient boosting or logistic regression) that adjusts Kalshi's implied probability using:
- Price bucket
- Market category
- Days to resolution
- Volume quintile
- Maker/taker ratio

**Output:** A "fair probability" estimate. When `market_price < fair_probability - threshold`, buy YES. When `market_price > fair_probability + threshold`, buy NO or avoid.

### Risks
- **Selection bias in historical data:** If the bias weakens over time (2025 data shows slight weakening), live edge may be smaller.
- **Crowding:** If multiple funds deploy this, the bias could compress.
- **Tail events:** Longshots *do* occasionally win — position sizing must reflect this.

---

## Strategy 2: Cross-Platform Arbitrage (Kalshi ↔ Polymarket/PredictIt)

### Concept
The same event is often traded on multiple prediction market platforms with different liquidity profiles and participant bases. Price discrepancies arise, creating arbitrage opportunities. The canonical example: Trump election odds at 55¢ on Polymarket vs. 48¢ on Kalshi.

### Evidence
- **Quantpedia review (2025)** cites a study analyzing Polymarket, Kalshi, and PredictIt during the 2024 U.S. election. Spreads existed persistently but were typically exploitable for only seconds to minutes.
- **Polymarket generally leads Kalshi** in price discovery due to higher liquidity, making Polymarket a useful leading indicator.
- A **Kalshi-Polymarket arbitrage bot** (open-source, Rust-based) demonstrates practical implementation of real-time event matching and simultaneous execution.

### Data Sources & Signals
- **Kalshi REST API:** Market prices, order book depth
- **Polymarket Gamma API + CLOB API:** Market prices, on-chain order flow
- **PredictIt API:** Alternative pricing (lower liquidity, slower)
- **Signal:** Real-time price delta for matched events
- **Event matching:** NLP-based similarity scoring to map "Will Trump win 2024?" (Kalshi) → "Donald Trump wins the 2024 election" (Polymarket)

### Feasibility Assessment
| Factor | Assessment |
|--------|------------|
| **Edge magnitude** | 1-3% per trade (after fees) |
| **Frequency** | Sporadic — depends on event volatility and platform lag |
| **Speed requirement** | Medium-High. Opportunities last seconds to minutes. |
| **Capital efficiency** | Moderate — requires capital on both platforms |
| **Execution risk** | Non-trivial. Must handle two separate settlement systems. |
| **Implementation** | Medium complexity: event matcher + price monitor + dual-execution engine |

### Kalshi-Specific Considerations
- Kalshi is CFTC-regulated and settles in USD via traditional banking.
- Polymarket is on-chain (Polygon) and settles in USDC.
- **Cross-platform execution introduces settlement lag and currency risk.**
- Kalshi's API latency is higher than Polymarket's on-chain CLOB, so we will usually be the *follower*, not the leader.

### Recommendation
This strategy is **viable as a secondary engine** but should not be the primary pillar. It pairs well with our existing D004 pairs-arbitrage engine (Dave's C++ execution layer can be extended with a Polymarket connector). However, **T236 (Kalshi API credentials) remains a blocker for live execution on Kalshi's side.**

---

## Strategy 3: Information Velocity / News-Driven Momentum

### Concept
Prediction markets do not instantly incorporate new information. Academic research on Kalshi shows that **Mean Absolute Error (MAE) declines smoothly as markets approach resolution**, with a steep drop on the final day. This implies a **lag in information absorption** — markets are not perfectly efficient in the short term.

The strategy: use external data sources (news, social media, spot markets, polling data) to **predict outcome probabilities faster than the market updates its prices**. When our model's probability diverges from the market's implied probability by more than a threshold, we trade in the direction of our forecast.

### Evidence
- **Kalshi MAE study:** Forecast accuracy improves continuously from 10 days out to market close, with the largest improvement on the final day. This confirms that **information is priced in gradually, not instantaneously.**
- **Practitioner reports:** An AI-driven bot on Polymarket turned $313 into $414,000 in one month by trading BTC/ETH 15-minute up/down markets. The bot used real-time spot price momentum from Binance/Coinbase to front-run Polymarket's lag — entering when actual probability was ~85% but market showed 50/50 odds.
- **Bayesian updating frameworks:** Markets often under-react to incremental news, especially in decentralized or retail-heavy venues.

### Data Sources & Signals
| Source | Signal Type | Markets Applicable |
|--------|-------------|-------------------|
| **News APIs / RSS** (Bloomberg, Reuters, AP) | Event-driven sentiment | Politics, economics, geopolitics |
| **Social media APIs** (X/Twitter, Reddit) | Crowd sentiment, early rumors | All markets, especially crypto/entertainment |
| **Spot market feeds** (Binance, Coinbase) | Real-time price for crypto markets | Crypto prediction markets |
| **Polling aggregators** (FiveThirtyEight, RCP) | Forecast accuracy for political markets | Election/politics markets |
| **Economic calendars** (ForexFactory, BLS) | Scheduled release timing | NFP, CPI, Fed rate markets |

### Feasibility Assessment
| Factor | Assessment |
|--------|------------|
| **Edge magnitude** | 3-8% per trade (highly variable by information advantage) |
| **Win rate** | Depends on data quality and latency; 50-65% realistic |
| **Speed requirement** | Medium. Minutes to hours, not milliseconds. |
| **Scalability** | High — can be applied across hundreds of markets |
| **Implementation** | High complexity: NLP pipeline, real-time data ingestion, probabilistic forecasting model |
| **Data moat** | Critical. Edge erodes if everyone has the same data. |

### ML Opportunity
This is Ivan's core competency. A production-grade implementation would include:

1. **News/social NLP pipeline:**
   - Named entity recognition (NER) to tag markets mentioned in text
   - Sentiment scoring with event-specific fine-tuning
   - Topic modeling to cluster related narratives

2. **Probabilistic forecasting model:**
   - Inputs: market microstructure (price, volume, spread) + external signals (sentiment, spot price, poll shifts)
   - Model: Gradient boosting (XGBoost/LightGBM) for tabular features, or small transformer for text
   - Output: P(event_occurs | data_up_to_t)

3. **Execution trigger:**
   - If `model_prob - market_implied_prob > threshold`, generate BUY signal
   - If `market_implied_prob - model_prob > threshold`, generate SELL/NO signal
   - Confidence-weighted position sizing

### Existing Agent Planet Assets We Can Leverage
- **T231 (econ_edge_scanner.py):** Already compares Kalshi economic market prices to base-rate estimates. This is a *primitive* form of information-velocity trading.
- **T265 (win_probability_scorer.js):** Logistic regression framework for scoring signal quality. Can be extended with NLP features.
- **T344 (llm_market_clustering.py):** Market clustering engine can group markets by topic for targeted news monitoring.

### Risks
- **Model risk:** External data may be noisy or misleading.
- **Latency risk:** By the time our model generates a signal, the market may have already moved.
- **Adverse selection:** If we trade on public news, we may be buying from traders with *better* private information.

---

## Comparative Analysis & Final Recommendations

### Ranking Rationale

**1st: Favorite-Longshot Bias Exploitation**
- **Highest confidence:** Backed by large-sample academic studies on Kalshi itself.
- **Lowest complexity:** Can be implemented as a rule-based filter with optional ML calibration.
- **Sustainable edge:** The bias is behavioral (risk-loving retail traders overpay for longshots) and has persisted across years, volume levels, and market categories.
- **Immediate deployability:** Requires only Kalshi API data — no external data pipelines.

**2nd: Cross-Platform Arbitrage**
- **Proven concept:** Multiple open-source bots and academic papers confirm opportunities exist.
- **Execution challenges:** Requires capital on multiple platforms, event matching, and handling settlement differences.
- **Best as complement:** Add a Polymarket connector to Dave's C++ engine rather than building a standalone strategy.

**3rd: Information Velocity / News Momentum**
- **Highest upside:** A well-built NLP + forecasting pipeline could generate the largest alpha.
- **Highest complexity:** Requires significant investment in data infrastructure, model development, and ongoing maintenance.
- **Strategic fit:** Aligns perfectly with Agent Planet's ML capabilities and our existing econ_edge_scanner foundation.
- **Recommended timeline:** Phase 2 of D002 — start with a pilot on crypto markets (where spot price feeds are clean and fast).

### Suggested D002 Roadmap

| Phase | Strategy | Owner | Timeline | Dependencies |
|-------|----------|-------|----------|--------------|
| 1 | Favorite-Longshot Bias Filter | Ivan | 1-2 weeks | Kalshi API (T236) |
| 2 | Cross-Platform Arb (Polymarket connector) | Dave/Bob | 2-3 weeks | Polymarket API access |
| 3 | News-Driven Momentum Pilot | Ivan | 4-6 weeks | News/social data feeds |

---

## References

1. **UCD Economics Working Paper 2025_19** — "The Economics of the Kalshi Prediction Market" (favorite-longshot bias, 313,972 contracts)
2. **GWU FORCPGM 2026-001** — "Makers and Takers: The Economics of the Kalshi Prediction Market" (maker/taker analysis, microstructure)
3. **Quantpedia (2025-11-27)** — "Systematic Edges in Prediction Markets" (inter-exchange arbitrage review)
4. **AInvest (2025-12-08)** — "The Rise of AI and Prediction Markets" (AI-driven alpha, favorite-longshot bias)
5. **AInvest (2026-01-15)** — "Mastering Short-Term Mispricings: Algorithmic Arbitrage on Polymarket" (information velocity, momentum)
6. **GitHub: TopTrenDev/polymarket-kalshi-arbitrage-bot** — Rust cross-platform arbitrage implementation
7. **GitHub: dylanpersonguy/Polymarket-Trading-Bot** — Multi-strategy prediction market bot (whale tracking, momentum, AI forecast)

---

## Appendix: Quick-Start Pseudocode — Favorite-Longshot Filter

```python
def favorite_longshot_signal(market, historical_bias_table):
    """
    Generate trade signal based on documented Kalshi favorite-longshot bias.
    
    Args:
        market: Kalshi market object with price, category, volume, days_to_close
        historical_bias_table: DataFrame with columns [price_bucket, category, 
                                                       actual_win_rate, n_observations]
    Returns:
        Signal dict with action, edge, and confidence
    """
    implied_prob = market.yes_mid / 100.0
    price_bucket = get_price_bucket(implied_prob)  # e.g., 0-10%, 10-20%, ...
    
    # Lookup historical win rate for this bucket and category
    row = historical_bias_table[
        (historical_bias_table.price_bucket == price_bucket) &
        (historical_bias_table.category == market.category)
    ]
    
    if len(row) == 0 or row.n_observations.iloc[0] < 100:
        return {"action": "NO_SIGNAL", "reason": "insufficient data"}
    
    actual_win_rate = row.actual_win_rate.iloc[0]
    edge = actual_win_rate - implied_prob  # positive = market underprices YES
    
    # Strategy: buy favorites (positive edge in high-price buckets)
    #           avoid/sell longshots (negative edge in low-price buckets)
    if edge > 0.02 and implied_prob > 0.70:
        return {
            "action": "BUY_YES",
            "edge": edge,
            "confidence": "HIGH",
            "reason": f"Favorite underpriced: market={implied_prob:.1%}, "
                      f"historical={actual_win_rate:.1%}"
        }
    elif edge < -0.03 and implied_prob < 0.30:
        return {
            "action": "BUY_NO",
            "edge": abs(edge),
            "confidence": "HIGH",
            "reason": f"Longshot overpriced: market={implied_prob:.1%}, "
                      f"historical={actual_win_rate:.1%}"
        }
    
    return {"action": "NO_SIGNAL", "edge": edge}
```

---

*End of Report*
