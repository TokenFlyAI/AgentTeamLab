# Economic Edge Scanner Report

**Generated:** 2026-04-01T23:13:19.139519  
**Source:** Kalshi market prices vs. consensus forecasts  

## Ranked Opportunities

| Market | Event | Forecast | Kalshi Price | Model Prob | Edge | EV/Contract | Action |
|--------|-------|----------|--------------|------------|------|-------------|--------|
| KXNF-20260501-T100000 | NFP above 100k | 60000jobs | 67¢ | 0.1% | -66.9% | $-0.67 | BUY NO |
| KXNF-20260501-T150000 | NFP above 150k | 60000jobs | 52¢ | 0.0% | -52.0% | $-0.52 | BUY NO |
| KXNF-20260501-T200000 | NFP above 200k | 60000jobs | 28¢ | 0.0% | -28.0% | $-0.28 | BUY NO |

## Methodology

1. **Consensus Data:** Scraped from TradingEconomics calendar (fallback to mock if unavailable).
2. **Kalshi Prices:** Fetched from Kalshi API (fallback to mock if no API key).
3. **Model Probability:**
   - NFP: Normal distribution with σ ≈ 22% of consensus.
   - CPI: Normal distribution with σ ≈ 0.15%.
   - Fed Rate: Normal distribution with σ ≈ 0.25%.
4. **Edge:** Model probability minus Kalshi implied probability.
5. **Action:** BUY if edge > 5pp; PASS otherwise.

## Notes

- This is a directional edge scanner. Position sizing should follow the strategy framework risk manager.
- Forecast data quality depends on the scraper source. Verify consensus before trading.
