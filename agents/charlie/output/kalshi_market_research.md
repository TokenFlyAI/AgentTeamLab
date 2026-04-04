# Kalshi Market Categories & Edge Opportunities Research

**Author:** Charlie (Frontend Engineer)  
**Task:** #218 — Research Kalshi market categories and identify top 3 edge opportunities  
**Date:** 2026-04-01

---

## Executive Summary

Kalshi operates **3,500+ markets** across 9+ major categories. While **sports dominates volume (75%+)** and **politics/economics** attract the most liquidity, the deepest *structural edges* lie in behavioral biases, information asymmetries, and micro-structural inefficiencies. This research identifies **3 actionable edge opportunities** backed by academic literature and platform-specific dynamics.

---

## 1. Kalshi Market Category Landscape

| Category | Typical Markets | Liquidity Profile | Retail Dominance |
|----------|----------------|-------------------|------------------|
| **Sports** | NFL, NBA, CFB, MLB, tennis, golf, F1, UFC | Very High ($2-10M OI) | High |
| **Politics** | Elections, nominations, policy votes, debates | Very High ($5-20M OI) | Very High |
| **Economics / Finance** | Fed rates, CPI, unemployment, GDP, recession odds | High (spikes around releases) | Medium |
| **Weather / Climate** | Temperature thresholds, snowfall, hurricanes | Low-Medium ($50K-500K OI) | High |
| **Entertainment / Culture** | Awards, box office, streaming charts, casting | Low-Medium | Very High |
| **Technology / Crypto** | ETF approvals, launches, network milestones | Medium | High |
| **Geopolitics** | Sanctions, treaties, leadership changes | Low-Medium | Medium |
| **Corporate / Financials** | Earnings, stock moves, company announcements | Medium | Medium |

### Key Observations
- **Sports + Politics** = ~90% of total volume. Tight spreads (0.5-2¢), efficient price discovery.
- **Niche categories** (weather, entertainment, geopolitics) = thin liquidity, wider spreads (2-5¢+), slower information incorporation.
- **Economic data markets** = predictable catalysts with official resolution sources (BLS, Fed).

---

## 2. Structural Dynamics on Kalshi

### 2.1 Favorite-Longshot Bias (Documented)
A 2025 academic study from University College Dublin / George Washington University analyzed **313,972 Kalshi contracts** and found:
- Contracts priced **5¢-20¢** lose ~**60%** of invested capital (systematically overpriced)
- Contracts priced **80¢-95¢** generate small **positive** returns (systematically underpriced)
- **Makers** (limit orders) earn positive returns; **Takers** (market orders) consistently lose
- Kalshi’s maker-taker microstructure *amplifies* this bias compared to double-auction markets

### 2.2 Fee Asymmetry
Kalshi taker fees scale with probability:
- 80% probability contract → ~1.4% fee
- 20% probability contract → ~5.6% fee

This makes **buying cheap longshots as a taker** doubly punitive (bad price + high fee).

### 2.3 Arbitrage Mechanics
- **Intra-market arbitrage**: YES + NO can sum to <$1.00 due to fragmented order books
- **Cross-platform arbitrage**: Kalshi vs. Polymarket divergences exist, though they close in seconds to minutes
- **Correlated-market arbitrage**: Logically linked contracts (e.g., nomination → general election) can diverge

### 2.4 Low-Liquidity Volatility
Niche markets can swing **10-20% on $50K trades**. This creates both risk and opportunity for patient limit-order traders.

---

## 3. Top 3 Edge Opportunities

### 🥇 Edge #1: Systematic Longshot Fading in Niche Categories

**The Play:** Sell YES contracts priced **5¢-20¢** in low-liquidity categories (weather, entertainment, secondary sports, geopolitics) using **limit orders** (zero maker fees).

**Why It Works:**
- Academic research confirms Kalshi exhibits strong **favorite-longshot bias**
- Retail traders overvalue tail-risk outcomes in emotionally salient events ("Will it snow 12+ inches?" "Will [underdog] win Best Picture?")
- Niche categories have **less market-maker attention**, so mispricings persist longer
- Selling as a **maker** avoids taker fees and captures the spread

**Example:**
- Market: "Will NYC see 6+ inches of snow on April 15?" trading at 12¢
- True probability (ensemble weather models): ~4%
- Trade: Sell 1,000 YES contracts at 12¢ as maker
- Expected value: (0.96 × $120) − (0.04 × $880) = **+$80**

**Risk:** Black swan events occur. Requires **diversification across 50+ contracts** for law of large numbers to apply.

---

### 🥈 Edge #2: Economic Data Release Momentum Trading

**The Play:** Trade scheduled macro markets (CPI, Fed funds rate, NFP, GDP) using **pre-release information edge** — nowcasts, survey aggregates, and alternative data.

**Why It Works:**
- Economic markets have **known catalysts** and **official resolution sources**
- Prices often **drift** in the 24-48 hours before release as informed participants position
- Kalshi academic research shows **MAE declines steeply** as markets approach resolution — but the *path* to resolution creates predictable momentum
- These markets attract **less pure sports/gambling retail money** and more **macro tourists** who trade sentiment rather than models

**Execution:**
- 24-48h before release: Compare Kalshi implied probability to high-quality nowcasts (Atlanta Fed, Cleveland Fed, private surveys)
- If divergence > 8-10 percentage points: Enter with limit orders on the "correct" side
- Close immediately post-release or hold to expiration if edge is large

**Example:**
- Market: "Will March CPI YoY exceed 3.0%?" trading at 65¢
- Cleveland Fed Nowcast: 2.8%
- Trade: Sell YES at 65¢, buy NO at 38¢ if YES+NO < $1.03

---

### 🥉 Edge #3: Cross-Platform & Correlated-Market Arbitrage

**The Play:** Exploit pricing divergences between **Kalshi and Polymarket** on identical or closely related events, and hunt for **intra-Kalshi inconsistencies** across correlated contracts.

**Why It Works:**
- Kalshi and Polymarket operate with **different user bases, deposit rails, and market makers**
- Political events in particular show **persistent 2-5¢ spreads** between platforms during high-volatility windows
- Kalshi’s regulated, USD-based order book can lag Polymarket’s crypto-native liquidity by **minutes to hours** on breaking news
- Within Kalshi, logically related markets (e.g., "Will Trump be the 2028 nominee?" vs "Will a Republican win the 2028 presidency?") occasionally violate basic probability constraints

**Execution:**
- Monitor identical events on both platforms using API feeds
- Set alerts for spreads > 3¢ after accounting for fees
- For intra-Kalshi: Build a simple Bayesian constraint checker that flags impossible joint probabilities

**Example:**
- Kalshi: "Will J.D. Vance be the 2028 Republican nominee?" = 37¢
- Kalshi: "Will Republicans win the 2028 presidency?" = 52¢
- If P(nomination) > P(general election win) persists: Arbitrage exists (nomination is a necessary precondition)

---

## 4. Dashboard Integration Recommendations

Since I’ve already built the **Kalshi Trading Dashboard** (v1.0), here are UI features that would surface these edges:

| Edge | Dashboard Feature |
|------|-------------------|
| Longshot Fading | "Longshot Scanner" — filter markets by price <20¢, sort by category liquidity, highlight maker sell opportunities |
| Economic Data | "Economic Calendar" — upcoming releases with implied probabilities vs. consensus forecasts |
| Arbitrage | "Arbitrage Monitor" — side-by-side Kalshi/Polymarket prices for tracked events; correlated-market constraint violations |

---

## 5. Conclusion

Kalshi is not a level playing field — it is a **behavioral market** where retail psychology, fee structure, and liquidity fragmentation create repeatable edges. The three highest-conviction opportunities are:

1. **Sell low-probability longshots in niche categories** (weather, entertainment, secondary sports) as a maker
2. **Trade economic data releases** using pre-release model/nowcast divergence
3. **Arbitrage cross-platform and correlated-market mispricings**

All three edges are **systematic, quantifiable, and compatible with automation** via the Kalshi API.

---

## Sources

- UCD/GWU Working Paper: *"Makers or Takers: The Economics of the Kalshi Prediction Market"* (2025)
- Quantpedia: *"Systematic Edges in Prediction Markets"* (Nov 2025)
- LaikaLabs: *"Kalshi Prediction Market: 7 Proven Strategies to Make Money"* (Feb 2026)
- Kalshi platform data: 3,500+ markets, $22.8B 2025 volume, 75%+ sports concentration
