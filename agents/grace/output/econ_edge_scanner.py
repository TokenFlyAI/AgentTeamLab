#!/usr/bin/env python3
"""
Economic Edge Scanner (Task 231)

Finds edges in Kalshi economic event markets by comparing market prices
to consensus forecast data scraped from public sources.

Usage:
    python econ_edge_scanner.py

Outputs:
    - stdout: ranked table of opportunities
    - econ_edges_today.md: markdown report
"""

import os
import re
import sys
import json
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from urllib.parse import urlencode

import requests


@dataclass
class EconMarket:
    ticker: str
    title: str
    category: str
    yes_price: float  # 0-100 cents
    no_price: float   # 0-100 cents
    event_type: str   # "nfp", "cpi", "fed_rate", "other"
    threshold: Optional[float] = None
    close_date: Optional[str] = None


@dataclass
class Forecast:
    event: str
    consensus: float
    unit: str
    source: str
    release_date: Optional[str] = None


@dataclass
class Opportunity:
    market: EconMarket
    forecast: Forecast
    model_prob: float  # 0-1
    market_prob: float # 0-1
    edge: float        # percentage points
    ev_per_contract: float  # cents
    recommendation: str


class TradingEconomicsScraper:
    """Scrape consensus forecasts from TradingEconomics calendar."""

    URL = "https://tradingeconomics.com/calendar"

    def fetch(self) -> List[Forecast]:
        try:
            resp = requests.get(self.URL, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }, timeout=15)
            resp.raise_for_status()
            html = resp.text
            return self._parse(html)
        except Exception as e:
            print(f"Warning: Failed to scrape TradingEconomics: {e}")
            return []

    def _parse(self, html: str) -> List[Forecast]:
        from bs4 import BeautifulSoup
        forecasts = []
        soup = BeautifulSoup(html, "html.parser")

        for row in soup.find_all("tr"):
            event_attr = row.get("data-event")
            if not event_attr:
                continue
            event = event_attr.strip().lower()

            consensus_tag = row.find("a", {"id": "consensus"})
            if not consensus_tag:
                continue

            consensus_str = consensus_tag.get_text(strip=True).replace(",", "").replace("K", "000")
            try:
                consensus = float(consensus_str)
            except ValueError:
                continue

            if "non farm payrolls" in event or "nonfarm" in event:
                forecasts.append(Forecast("nfp", consensus, "jobs", "TradingEconomics"))
            elif "cpi" in event and "month" not in event:
                forecasts.append(Forecast("cpi", consensus, "%", "TradingEconomics"))
            elif "fed interest rate" in event or "fomc" in event:
                forecasts.append(Forecast("fed_rate", consensus, "%", "TradingEconomics"))

        return forecasts


class KalshiEconClient:
    """Fetch Kalshi economic markets. Falls back to mock data if API unavailable."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("KALSHI_API_KEY")
        self.base_url = os.getenv("KALSHI_API_BASE", "https://trading-api.kalshi.com")

    def fetch_econ_markets(self) -> List[EconMarket]:
        if not self.api_key:
            print("Warning: KALSHI_API_KEY not set. Using mock economic markets.")
            return self._mock_markets()

        try:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            url = f"{self.base_url}/trade-api/v2/markets"
            params = {"category": "Economics", "status": "active", "limit": 100}
            resp = requests.get(url, headers=headers, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            markets = []
            for m in data.get("markets", []):
                em = self._to_econ_market(m)
                if em:
                    markets.append(em)
            if markets:
                return markets
        except Exception as e:
            print(f"Warning: Kalshi API failed: {e}. Using mock markets.")

        return self._mock_markets()

    def _to_econ_market(self, raw: Dict) -> Optional[EconMarket]:
        title = raw.get("title", "").lower()
        ticker = raw.get("ticker", "")
        yes_bid = raw.get("yes_bid", 0) or raw.get("yesBid", 0)
        yes_ask = raw.get("yes_ask", 0) or raw.get("yesAsk", 0)
        yes_mid = (yes_bid + yes_ask) / 2 if yes_bid and yes_ask else raw.get("last_price", 50)
        no_mid = 100 - yes_mid

        event_type = "other"
        threshold = None

        if "nonfarm" in title or "payroll" in title or "nfp" in title:
            event_type = "nfp"
            threshold = self._extract_number(title)
        elif "cpi" in title:
            event_type = "cpi"
            threshold = self._extract_number(title)
        elif "fed" in title or "fomc" in title or "rate" in title:
            event_type = "fed_rate"
            threshold = self._extract_number(title)

        return EconMarket(
            ticker=ticker,
            title=raw.get("title", ""),
            category="Economics",
            yes_price=yes_mid,
            no_price=no_mid,
            event_type=event_type,
            threshold=threshold,
            close_date=raw.get("close_date") or raw.get("expiration_date"),
        )

    @staticmethod
    def _extract_number(title: str) -> Optional[float]:
        # Extract the first number or number-with-k
        m = re.search(r"(\d+(?:\.\d+)?)(?:k|\b)", title, re.IGNORECASE)
        if m:
            val = float(m.group(1))
            if "k" in title.lower() and val < 1000:
                val *= 1000
            return val
        return None

    def _mock_markets(self) -> List[EconMarket]:
        today = datetime.now().strftime("%Y-%m-%d")
        next_month = (datetime.now().replace(day=1) + timedelta(days=32)).replace(day=1)
        close = next_month.strftime("%Y-%m-%d")
        return [
            EconMarket("KXNF-20260501-T100000", "NFP above 100k", "Economics", 67, 33, "nfp", 100000, close),
            EconMarket("KXNF-20260501-T150000", "NFP above 150k", "Economics", 52, 48, "nfp", 150000, close),
            EconMarket("KXNF-20260501-T200000", "NFP above 200k", "Economics", 28, 72, "nfp", 200000, close),
            EconMarket("KXCPI-20260501-T3.0", "CPI YoY above 3.0%", "Economics", 58, 42, "cpi", 3.0, close),
            EconMarket("KXCPI-20260501-T2.5", "CPI YoY above 2.5%", "Economics", 82, 18, "cpi", 2.5, close),
            EconMarket("KXFED-20260501-T4.5", "Fed funds rate above 4.5%", "Economics", 45, 55, "fed_rate", 4.5, close),
        ]


def compute_nfp_probability(forecast: float, threshold: float) -> float:
    """
    Rough probability that NFP > threshold given consensus forecast.
    Uses a normal distribution with std dev proportional to forecast.
    """
    if forecast <= 0:
        return 0.5
    # Historical NFP std dev is roughly 20-25% of the consensus level for typical months
    sigma = forecast * 0.22
    z = (forecast - threshold) / sigma if sigma > 0 else 0
    return 1 - norm_cdf(-z)


def compute_cpi_probability(forecast: float, threshold: float) -> float:
    """Rough probability that CPI > threshold."""
    sigma = 0.15  # typical CPI surprise std dev
    z = (forecast - threshold) / sigma
    return 1 - norm_cdf(-z)


def compute_rate_probability(forecast: float, threshold: float) -> float:
    """Rough probability that Fed rate > threshold."""
    sigma = 0.25  # rate uncertainty
    z = (forecast - threshold) / sigma
    return 1 - norm_cdf(-z)


def norm_cdf(x: float) -> float:
    """Standard normal CDF."""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def match_forecast_to_market(market: EconMarket, forecasts: List[Forecast]) -> Optional[Forecast]:
    """Find the best matching forecast for a market."""
    for f in forecasts:
        if f.event == market.event_type:
            return f
    return None


def build_opportunities(markets: List[EconMarket], forecasts: List[Forecast]) -> List[Opportunity]:
    opportunities = []
    for market in markets:
        forecast = match_forecast_to_market(market, forecasts)
        if not forecast:
            continue

        if market.event_type == "nfp":
            model_prob = compute_nfp_probability(forecast.consensus, market.threshold or 0)
        elif market.event_type == "cpi":
            model_prob = compute_cpi_probability(forecast.consensus, market.threshold or 0)
        elif market.event_type == "fed_rate":
            model_prob = compute_rate_probability(forecast.consensus, market.threshold or 0)
        else:
            continue

        market_prob = market.yes_price / 100.0
        edge = model_prob - market_prob
        ev = edge * 100  # cents per contract

        # Recommendation threshold: 5pp edge
        if edge > 0.05:
            rec = "BUY YES"
        elif edge < -0.05:
            rec = "BUY NO"
        else:
            rec = "PASS"

        opportunities.append(Opportunity(
            market=market,
            forecast=forecast,
            model_prob=model_prob,
            market_prob=market_prob,
            edge=edge,
            ev_per_contract=ev,
            recommendation=rec,
        ))

    # Sort by absolute edge descending
    opportunities.sort(key=lambda o: abs(o.edge), reverse=True)
    return opportunities


def generate_report(opportunities: List[Opportunity], output_path: str = "econ_edges_today.md"):
    lines = [
        "# Economic Edge Scanner Report",
        "",
        f"**Generated:** {datetime.now().isoformat()}  ",
        "**Source:** Kalshi market prices vs. consensus forecasts  ",
        "",
        "## Ranked Opportunities",
        "",
        "| Market | Event | Forecast | Kalshi Price | Model Prob | Edge | EV/Contract | Action |",
        "|--------|-------|----------|--------------|------------|------|-------------|--------|",
    ]

    for opp in opportunities:
        lines.append(
            f"| {opp.market.ticker} | {opp.market.title} | "
            f"{opp.forecast.consensus:g}{opp.forecast.unit} | "
            f"{opp.market.yes_price:.0f}¢ | "
            f"{opp.model_prob:.1%} | {opp.edge:+.1%} | "
            f"${opp.ev_per_contract/100:+.2f} | {opp.recommendation} |"
        )

    lines.extend([
        "",
        "## Methodology",
        "",
        "1. **Consensus Data:** Scraped from TradingEconomics calendar (fallback to mock if unavailable).",
        "2. **Kalshi Prices:** Fetched from Kalshi API (fallback to mock if no API key).",
        "3. **Model Probability:**",
        "   - NFP: Normal distribution with σ ≈ 22% of consensus.",
        "   - CPI: Normal distribution with σ ≈ 0.15%.",
        "   - Fed Rate: Normal distribution with σ ≈ 0.25%.",
        "4. **Edge:** Model probability minus Kalshi implied probability.",
        "5. **Action:** BUY if edge > 5pp; PASS otherwise.",
        "",
        "## Notes",
        "",
        "- This is a directional edge scanner. Position sizing should follow the strategy framework risk manager.",
        "- Forecast data quality depends on the scraper source. Verify consensus before trading.",
        "",
    ])

    with open(output_path, "w") as f:
        f.write("\n".join(lines))
    print(f"\nReport written to {output_path}")


def main():
    print("=" * 70)
    print("Economic Edge Scanner (Task 231)")
    print("=" * 70)

    # 1. Fetch forecasts
    print("\n[1/4] Fetching consensus forecasts...")
    scraper = TradingEconomicsScraper()
    forecasts = scraper.fetch()
    if forecasts:
        print(f"Found {len(forecasts)} forecasts from TradingEconomics:")
        for f in forecasts:
            print(f"  - {f.event.upper()}: {f.consensus:g}{f.unit}")
    else:
        print("No live forecasts scraped. Using mock fallback.")
        forecasts = [
            Forecast("nfp", 140000, "jobs", "mock_fallback"),
            Forecast("cpi", 2.9, "%", "mock_fallback"),
            Forecast("fed_rate", 4.75, "%", "mock_fallback"),
        ]

    # 2. Fetch Kalshi markets
    print("\n[2/4] Fetching Kalshi economic markets...")
    client = KalshiEconClient()
    markets = client.fetch_econ_markets()
    print(f"Loaded {len(markets)} economic markets")
    for m in markets:
        print(f"  - {m.ticker}: {m.title} @ {m.yes_price:.0f}¢")

    # 3. Compute opportunities
    print("\n[3/4] Computing edges...")
    opportunities = build_opportunities(markets, forecasts)

    # 4. Print table
    print("\n[4/4] Ranked Opportunities")
    print("-" * 70)
    print(f"{'Market':<25} {'Forecast':>12} {'Price':>8} {'Model':>8} {'Edge':>8} {'Action':>10}")
    print("-" * 70)
    for opp in opportunities:
        print(
            f"{opp.market.ticker:<25} "
            f"{opp.forecast.consensus:>11g}{opp.forecast.unit:<1} "
            f"{opp.market.yes_price:>7.0f}¢ "
            f"{opp.model_prob:>7.1%} "
            f"{opp.edge:>+7.1%} "
            f"{opp.recommendation:>10}"
        )

    if not opportunities:
        print("No actionable opportunities found.")

    # 5. Write report
    generate_report(opportunities)

    # 6. Save raw JSON
    raw = {
        "generated_at": datetime.now().isoformat(),
        "opportunities": [
            {
                "ticker": o.market.ticker,
                "title": o.market.title,
                "event_type": o.market.event_type,
                "forecast_consensus": o.forecast.consensus,
                "forecast_unit": o.forecast.unit,
                "forecast_source": o.forecast.source,
                "kalshi_yes_price": o.market.yes_price,
                "model_probability": o.model_prob,
                "edge": o.edge,
                "ev_per_contract_cents": o.ev_per_contract,
                "recommendation": o.recommendation,
            }
            for o in opportunities
        ],
    }
    with open("econ_edges_today.json", "w") as f:
        json.dump(raw, f, indent=2)
    print("Raw data written to econ_edges_today.json")


if __name__ == "__main__":
    main()
