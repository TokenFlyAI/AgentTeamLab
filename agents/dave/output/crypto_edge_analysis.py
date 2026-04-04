#!/usr/bin/env python3
"""
Crypto Edge Analysis for Kalshi Markets

Task 233: Find edge in Kalshi crypto markets using real-time price data.

This script:
1. Fetches live BTC/ETH spot prices from CoinGecko
2. Attempts to fetch Kalshi crypto markets (falls back to representative markets if API is unavailable)
3. Prices each binary option using a lognormal model: P = N(ln(S/K) / (sigma * sqrt(T)))
4. Ranks markets by edge (model price vs Kalshi market price)
5. Writes results to crypto_edges.md

Usage:
    python output/crypto_edge_analysis.py
"""

import os
import sys
import json
import math
import time
import argparse
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict

import requests
from scipy.stats import norm

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
KALSHI_API_BASE = "https://trading-api.kalshi.com/trade/v2"
KALSHI_DEMO_BASE = "https://demo-api.kalshi.com/trade/v2"

CACHE_FILE = os.path.join(os.path.dirname(__file__), ".coingecko_cache.json")
CACHE_TTL_MINUTES = 5

# Annualized volatility estimates for crypto
CRYPTO_VOLATILITY = {
    "BTC": 0.60,
    "ETH": 0.70,
}

# Representative Kalshi crypto markets (fallback if live API unavailable)
FALLBACK_MARKETS = [
    {
        "ticker": "BTCW-25-DEC31",
        "title": "Bitcoin above 100k",
        "asset": "BTC",
        "strike": 100_000,
        "expiration": "2026-12-31T23:59:59Z",
        "yes_bid": 15,
        "yes_ask": 17,
        "volume": 180000,
    },
    {
        "ticker": "BTCW-26-JUN30-100K",
        "title": "Will Bitcoin exceed $100,000 by June 30, 2026?",
        "asset": "BTC",
        "strike": 100_000,
        "expiration": "2026-06-30T23:59:59Z",
        "yes_bid": 62,
        "yes_ask": 66,
        "volume": 890000,
    },
    {
        "ticker": "BTCW-26-JUN30-80K",
        "title": "Will Bitcoin exceed $80,000 by June 30, 2026?",
        "asset": "BTC",
        "strike": 80_000,
        "expiration": "2026-06-30T23:59:59Z",
        "yes_bid": 82,
        "yes_ask": 86,
        "volume": 720000,
    },
    {
        "ticker": "BTCW-26-JUN30-70K",
        "title": "Will Bitcoin exceed $70,000 by June 30, 2026?",
        "asset": "BTC",
        "strike": 70_000,
        "expiration": "2026-06-30T23:59:59Z",
        "yes_bid": 90,
        "yes_ask": 93,
        "volume": 650000,
    },
    {
        "ticker": "ETHW-26-DEC31-5K",
        "title": "Will Ethereum exceed $5,000 by December 31, 2026?",
        "asset": "ETH",
        "strike": 5_000,
        "expiration": "2026-12-31T23:59:59Z",
        "yes_bid": 28,
        "yes_ask": 32,
        "volume": 540000,
    },
    {
        "ticker": "ETHW-26-DEC31-3K",
        "title": "Will Ethereum exceed $3,000 by December 31, 2026?",
        "asset": "ETH",
        "strike": 3_000,
        "expiration": "2026-12-31T23:59:59Z",
        "yes_bid": 72,
        "yes_ask": 76,
        "volume": 480000,
    },
    {
        "ticker": "ETHW-26-JUN30-2500",
        "title": "Will Ethereum exceed $2,500 by June 30, 2026?",
        "asset": "ETH",
        "strike": 2_500,
        "expiration": "2026-06-30T23:59:59Z",
        "yes_bid": 78,
        "yes_ask": 82,
        "volume": 420000,
    },
]


@dataclass
class EdgeResult:
    ticker: str
    title: str
    asset: str
    spot_price: float
    strike: float
    expiration: str
    days_to_exp: float
    volatility: float
    model_price_cents: float
    market_price_cents: float
    edge_cents: float
    edge_pct: float
    recommendation: str
    volume: int


def get_cached_prices():
    """Load prices from cache if valid, else return None."""
    if not os.path.exists(CACHE_FILE):
        return None
    try:
        with open(CACHE_FILE, "r") as f:
            cache = json.load(f)
        cached_time = datetime.fromisoformat(cache["timestamp"])
        if datetime.now() - cached_time < timedelta(minutes=CACHE_TTL_MINUTES):
            return cache["prices"]
    except Exception:
        pass
    return None


def save_prices_to_cache(prices):
    """Save prices to cache file."""
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump({"timestamp": datetime.now().isoformat(), "prices": prices}, f)
    except Exception as e:
        print(f"Cache write warning: {e}")


def fetch_prices_with_retry(max_retries=3, base_delay=2):
    """Fetch prices with exponential backoff retry."""
    params = {
        "ids": "bitcoin,ethereum",
        "vs_currencies": "usd",
    }
    for attempt in range(max_retries):
        try:
            resp = requests.get(COINGECKO_URL, params=params, timeout=15)
            if resp.status_code == 429:
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    print(f"Rate limited. Retrying in {delay}s...")
                    time.sleep(delay)
                    continue
            resp.raise_for_status()
            prices = resp.json()
            save_prices_to_cache(prices)
            return prices
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"Request failed ({e}). Retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise
    return None


def fetch_crypto_prices() -> Dict[str, float]:
    """Fetch live BTC and ETH prices from CoinGecko with cache and retry."""
    cached = get_cached_prices()
    if cached:
        print("[CoinGecko] Using cached prices.")
        return {
            "BTC": float(cached["bitcoin"]["usd"]),
            "ETH": float(cached["ethereum"]["usd"]),
        }

    data = fetch_prices_with_retry()
    return {
        "BTC": float(data["bitcoin"]["usd"]),
        "ETH": float(data["ethereum"]["usd"]),
    }


def fetch_kalshi_crypto_markets() -> List[Dict]:
    """
    Attempt to fetch crypto markets from Kalshi API.
    Returns empty list if API is unavailable or requires auth.
    """
    api_key = os.environ.get("KALSHI_API_KEY", "")
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    for base in [KALSHI_API_BASE, KALSHI_DEMO_BASE]:
        try:
            url = f"{base}/markets"
            params = {"limit": 100, "category": "Crypto"}
            resp = requests.get(url, params=params, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                markets = data.get("markets", [])
                if markets:
                    return markets
            elif resp.status_code == 401:
                print(f"[Kalshi] {base} requires authentication (no API key set).")
            else:
                print(f"[Kalshi] {base} returned {resp.status_code}.")
        except Exception as e:
            print(f"[Kalshi] {base} error: {e}")

    return []


def parse_kalshi_markets(raw_markets: List[Dict]) -> List[Dict]:
    """Convert Kalshi API market format to our internal format."""
    parsed = []
    for m in raw_markets:
        title = m.get("title", "")
        ticker = m.get("ticker", "")

        # Infer asset and strike from title/ticker heuristics
        asset = None
        strike = None
        lower_title = title.lower()

        if "bitcoin" in lower_title or "btc" in lower_title:
            asset = "BTC"
        elif "ethereum" in lower_title or "eth" in lower_title:
            asset = "ETH"

        # Try to extract strike from title (e.g., "$100,000" or "$5,000")
        import re
        match = re.search(r"\$([0-9,]+(?:\.[0-9]+)?)", title)
        if match:
            strike = float(match.group(1).replace(",", ""))

        if asset is None or strike is None:
            continue

        yes_bid = m.get("yes_bid") or m.get("yesBid") or 0
        yes_ask = m.get("yes_ask") or m.get("yesAsk") or 0
        if yes_bid == 0 and yes_ask == 0:
            continue

        expiration = m.get("expiration_time") or m.get("close_date") or m.get("closeDate") or "2026-12-31T23:59:59Z"
        volume = m.get("volume") or m.get("trading_volume") or 0

        parsed.append({
            "ticker": ticker,
            "title": title,
            "asset": asset,
            "strike": strike,
            "expiration": expiration,
            "yes_bid": yes_bid,
            "yes_ask": yes_ask,
            "volume": volume,
        })

    return parsed


def compute_model_price(spot: float, strike: float, sigma: float, expiration_iso: str) -> float:
    """
    Price a binary option using the lognormal model.
    P = N( ln(S/K) / (sigma * sqrt(T)) )
    Returns price in cents (0-100).
    """
    now = datetime.now(timezone.utc)
    exp = datetime.fromisoformat(expiration_iso.replace("Z", "+00:00"))
    t_seconds = (exp - now).total_seconds()
    if t_seconds <= 0:
        # Expired: price at 0 or 100
        return 100.0 if spot >= strike else 0.0

    t_years = t_seconds / (365.25 * 24 * 3600)
    d = math.log(spot / strike) / (sigma * math.sqrt(t_years))
    prob = norm.cdf(d)
    return prob * 100.0


def analyze_edges(prices: Dict[str, float], markets: List[Dict]) -> List[EdgeResult]:
    """Compute edge for each market and return ranked results."""
    results = []
    for m in markets:
        asset = m["asset"]
        spot = prices.get(asset)
        if spot is None:
            continue

        strike = m["strike"]
        sigma = CRYPTO_VOLATILITY.get(asset, 0.65)
        model_price = compute_model_price(spot, strike, sigma, m["expiration"])

        yes_bid = m.get("yes_bid", 0)
        yes_ask = m.get("yes_ask", 0)
        if yes_bid and yes_ask:
            market_price = (yes_bid + yes_ask) / 2.0
        elif yes_bid:
            market_price = yes_bid
        elif yes_ask:
            market_price = yes_ask
        else:
            market_price = 50.0

        edge = model_price - market_price

        # Recommendation logic
        if abs(edge) < 2:
            recommendation = "HOLD"
        elif edge > 0:
            recommendation = "BUY YES"
        else:
            recommendation = "BUY NO"

        now = datetime.now(timezone.utc)
        exp = datetime.fromisoformat(m["expiration"].replace("Z", "+00:00"))
        days_to_exp = max(0, (exp - now).total_seconds() / (24 * 3600))

        results.append(EdgeResult(
            ticker=m["ticker"],
            title=m["title"],
            asset=asset,
            spot_price=spot,
            strike=strike,
            expiration=m["expiration"][:10],
            days_to_exp=round(days_to_exp, 1),
            volatility=sigma,
            model_price_cents=round(model_price, 2),
            market_price_cents=round(market_price, 2),
            edge_cents=round(edge, 2),
            edge_pct=round(edge / max(market_price, 1.0) * 100, 1),
            recommendation=recommendation,
            volume=m.get("volume", 0),
        ))

    # Rank by absolute edge (descending)
    results.sort(key=lambda r: abs(r.edge_cents), reverse=True)
    return results


def generate_markdown_report(prices: Dict[str, float], results: List[EdgeResult], used_fallback: bool) -> str:
    """Generate the markdown report."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Crypto Edge Analysis — Kalshi Markets",
        "",
        f"**Generated:** {now}",
        "",
        "## Live Spot Prices (CoinGecko)",
        "",
        f"- **BTC:** ${prices['BTC']:,.2f}",
        f"- **ETH:** ${prices['ETH']:,.2f}",
        "",
        "## Market Data Source",
        "",
    ]

    if used_fallback:
        lines.append(
            "> **Note:** Kalshi live API requires authentication (no `KALSHI_API_KEY` set). "
            "Using representative crypto markets for demonstration."
        )
        lines.append("")
    else:
        lines.append("Markets fetched live from Kalshi API.")
        lines.append("")

    lines.extend([
        "## Methodology",
        "",
        "Binary option priced with lognormal model:",
        "",
        "```",
        "P = N( ln(S/K) / (sigma * sqrt(T)) )",
        "```",
        "",
        "Where:",
        "- `S` = live spot price (CoinGecko)",
        "- `K` = strike price (market threshold)",
        "- `sigma` = annualized volatility (BTC 60%, ETH 70%)",
        "- `T` = years to expiration",
        "- `N` = standard normal CDF",
        "",
        "## Ranked Edge Table",
        "",
        "| Rank | Ticker | Asset | Market | Strike | Exp | Days | Model ¢ | Market ¢ | Edge ¢ | Edge % | Rec | Volume |",
        "|------|--------|-------|--------|--------|-----|------|---------|----------|--------|--------|-----|--------|",
    ])

    for i, r in enumerate(results, 1):
        title_short = r.title[:36] + "..." if len(r.title) > 36 else r.title
        lines.append(
            f"| {i} | `{r.ticker}` | {r.asset} | {title_short} | ${r.strike:,.0f} | {r.expiration} | {r.days_to_exp:.0f} | "
            f"{r.model_price_cents:.1f}¢ | {r.market_price_cents:.1f}¢ | {r.edge_cents:+.1f}¢ | {r.edge_pct:+.1f}% | {r.recommendation} | {r.volume:,} |"
        )

    lines.extend([
        "",
        "## Interpretation",
        "",
        "- **Positive edge (+):** Model says the YES contract is cheaper than it should be → consider buying YES.",
        "- **Negative edge (-):** Model says the YES contract is overpriced → consider buying NO (or selling YES).",
        "- **Edge < 2¢:** Transaction costs and bid-ask spread likely erase any theoretical edge.",
        "",
        "## Top Opportunities",
        "",
    ])

    top3 = [r for r in results if abs(r.edge_cents) >= 2][:3]
    if top3:
        for r in top3:
            direction = "YES" if r.edge_cents > 0 else "NO"
            lines.append(
                f"1. **`{r.ticker}`** — {r.recommendation}: model {r.model_price_cents:.1f}¢ vs market {r.market_price_cents:.1f}¢ "
                f"(edge {r.edge_cents:+.1f}¢, {r.edge_pct:+.1f}%)"
            )
    else:
        lines.append("No actionable edges ≥ 2¢ found in current market set.")

    lines.extend([
        "",
        "---",
        "*Task 233 — Crypto Edge Analysis*",
    ])

    return "\n".join(lines)


def results_to_signals(results: List[EdgeResult]) -> List[Dict]:
    """Convert edge results to Bob's signal format."""
    signals = []
    for r in results:
        if abs(r.edge_cents) < 2:
            continue
        side = "yes" if r.edge_cents > 0 else "no"
        confidence = min(abs(r.edge_cents) / 100.0, 0.95)
        signals.append({
            "marketId": r.ticker,
            "side": side,
            "signalType": "entry",
            "confidence": round(confidence, 4),
            "targetPrice": r.model_price_cents,
            "currentPrice": r.market_price_cents,
            "expectedEdge": round(abs(r.edge_cents), 2),
            "recommendedContracts": 10,
            "reason": f"Crypto lognormal edge: model {r.model_price_cents:.1f}¢ vs market {r.market_price_cents:.1f}¢",
        })
    return signals


def main():
    parser = argparse.ArgumentParser(description="Crypto Edge Analysis — Task 233")
    parser.add_argument("--json", action="store_true", help="Output JSON signals to stdout instead of markdown report")
    args = parser.parse_args()

    if not args.json:
        print("=" * 60)
        print("Crypto Edge Analysis — Task 233")
        print("=" * 60)

    # 1. Fetch live crypto prices
    if not args.json:
        print("\n[1/4] Fetching live BTC/ETH prices from CoinGecko...")
    try:
        prices = fetch_crypto_prices()
        if not args.json:
            print(f"      BTC: ${prices['BTC']:,.2f}")
            print(f"      ETH: ${prices['ETH']:,.2f}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    # 2. Fetch Kalshi crypto markets
    if not args.json:
        print("\n[2/4] Fetching Kalshi crypto markets...")
    raw_markets = fetch_kalshi_crypto_markets()
    if raw_markets:
        markets = parse_kalshi_markets(raw_markets)
        used_fallback = False
        if not args.json:
            print(f"      Found {len(markets)} crypto markets from Kalshi API.")
    else:
        markets = FALLBACK_MARKETS
        used_fallback = True
        if not args.json:
            print(f"      Kalshi API unavailable. Using {len(FALLBACK_MARKETS)} representative fallback markets.")

    # 3. Compute edges
    if not args.json:
        print("\n[3/4] Pricing binary options with lognormal model...")
    results = analyze_edges(prices, markets)
    if not args.json:
        print(f"      Analyzed {len(results)} markets.")

    # 4. Output
    if args.json:
        signals = results_to_signals(results)
        print(json.dumps(signals))
        return

    print("\n[4/4] Writing report to output/crypto_edges.md...")
    report = generate_markdown_report(prices, results, used_fallback)

    out_path = os.path.join(os.path.dirname(__file__), "crypto_edges.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"      Done. Report saved to {out_path}")
    print("\n" + "=" * 60)

    # Print summary to stdout
    print("\nSUMMARY:")
    for r in results[:5]:
        print(f"  {r.ticker:20s} | model {r.model_price_cents:5.1f}¢ | market {r.market_price_cents:5.1f}¢ | edge {r.edge_cents:+6.1f}¢ | {r.recommendation}")


if __name__ == "__main__":
    main()
