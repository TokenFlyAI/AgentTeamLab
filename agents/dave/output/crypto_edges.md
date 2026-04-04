# Crypto Edge Analysis — Kalshi Markets

**Generated:** 2026-04-02 06:13 UTC

## Live Spot Prices (CoinGecko)

- **BTC:** $66,560.00
- **ETH:** $2,046.81

## Market Data Source

> **Note:** Kalshi live API requires authentication (no `KALSHI_API_KEY` set). Using representative crypto markets for demonstration.

## Methodology

Binary option priced with lognormal model:

```
P = N( ln(S/K) / (sigma * sqrt(T)) )
```

Where:
- `S` = live spot price (CoinGecko)
- `K` = strike price (market threshold)
- `sigma` = annualized volatility (BTC 60%, ETH 70%)
- `T` = years to expiration
- `N` = standard normal CDF

## Ranked Edge Table

| Rank | Ticker | Asset | Market | Strike | Exp | Days | Model ¢ | Market ¢ | Edge ¢ | Edge % | Rec | Volume |
|------|--------|-------|--------|--------|-----|------|---------|----------|--------|--------|-----|--------|
| 1 | `BTCW-26-JUN30-80K` | BTC | Will Bitcoin exceed $80,000 by June ... | $80,000 | 2026-06-30 | 90 | 26.8¢ | 84.0¢ | -57.2¢ | -68.1% | BUY NO | 720,000 |
| 2 | `BTCW-26-JUN30-100K` | BTC | Will Bitcoin exceed $100,000 by June... | $100,000 | 2026-06-30 | 90 | 8.6¢ | 64.0¢ | -55.5¢ | -86.6% | BUY NO | 890,000 |
| 3 | `ETHW-26-JUN30-2500` | ETH | Will Ethereum exceed $2,500 by June ... | $2,500 | 2026-06-30 | 90 | 28.2¢ | 80.0¢ | -51.8¢ | -64.7% | BUY NO | 420,000 |
| 4 | `BTCW-26-JUN30-70K` | BTC | Will Bitcoin exceed $70,000 by June ... | $70,000 | 2026-06-30 | 90 | 43.3¢ | 91.5¢ | -48.2¢ | -52.7% | BUY NO | 650,000 |
| 5 | `ETHW-26-DEC31-3K` | ETH | Will Ethereum exceed $3,000 by Decem... | $3,000 | 2026-12-31 | 274 | 26.4¢ | 74.0¢ | -47.6¢ | -64.3% | BUY NO | 480,000 |
| 6 | `ETHW-26-DEC31-5K` | ETH | Will Ethereum exceed $5,000 by Decem... | $5,000 | 2026-12-31 | 274 | 7.0¢ | 30.0¢ | -23.0¢ | -76.6% | BUY NO | 540,000 |
| 7 | `BTCW-25-DEC31` | BTC | Bitcoin above 100k | $100,000 | 2026-12-31 | 274 | 21.7¢ | 16.0¢ | +5.7¢ | +35.4% | BUY YES | 180,000 |

## Interpretation

- **Positive edge (+):** Model says the YES contract is cheaper than it should be → consider buying YES.
- **Negative edge (-):** Model says the YES contract is overpriced → consider buying NO (or selling YES).
- **Edge < 2¢:** Transaction costs and bid-ask spread likely erase any theoretical edge.

## Top Opportunities

1. **`BTCW-26-JUN30-80K`** — BUY NO: model 26.8¢ vs market 84.0¢ (edge -57.2¢, -68.1%)
1. **`BTCW-26-JUN30-100K`** — BUY NO: model 8.6¢ vs market 64.0¢ (edge -55.5¢, -86.6%)
1. **`ETHW-26-JUN30-2500`** — BUY NO: model 28.2¢ vs market 80.0¢ (edge -51.8¢, -64.7%)

---
*Task 233 — Crypto Edge Analysis*