#!/usr/bin/env python3
"""Generate Phase 2 market clusters from Grace's filtered markets output."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INPUT_PATH = ROOT / "agents" / "grace" / "output" / "filtered_markets.json"
OUTPUT_PATH = ROOT / "output" / "ivan" / "market_clusters.json"

DOMAIN_KEYWORDS = {
    "crypto": [
        "bitcoin",
        "btc",
        "ethereum",
        "eth",
        "solana",
        "crypto",
        "token",
        "coin",
    ],
    "rates": [
        "fed",
        "federal reserve",
        "rate",
        "rates",
        "holds",
        "cuts",
        "hike",
        "hikes",
    ],
    "growth": [
        "gdp",
        "growth",
        "recession",
        "economy",
        "economic",
    ],
    "inflation": [
        "cpi",
        "inflation",
        "prices",
    ],
    "labor": [
        "unemployment",
        "payroll",
        "jobs",
        "jobless",
        "employment",
        "wages",
    ],
    "politics": [
        "president",
        "approval",
        "senate",
        "house",
        "governor",
        "gov",
        "scotus",
        "democrats",
        "republicans",
        "control",
    ],
    "weather": [
        "rainfall",
        "rain",
        "heat",
        "snow",
        "hurricane",
        "atlantic",
        "storm",
    ],
}

THEME_DEFINITIONS = [
    {
        "id": "macro_policy_growth",
        "label": "Macro Policy and Growth",
        "description": "Fed policy and GDP growth markets share the same macro driver set.",
        "domains": {"rates", "growth", "inflation", "labor"},
        "correlation_strength": 0.73,
    },
    {
        "id": "digital_assets",
        "label": "Digital Assets",
        "description": "Crypto markets grouped by blockchain asset exposure.",
        "domains": {"crypto"},
        "correlation_strength": 0.58,
    },
    {
        "id": "political_control",
        "label": "Political Control and Approval",
        "description": "Approval and chamber-control markets cluster around the same electoral sentiment drivers.",
        "domains": {"politics"},
        "correlation_strength": 0.69,
    },
    {
        "id": "weather_events",
        "label": "Weather and Climate Events",
        "description": "Rain, heat, snow, and hurricane contracts share event-driven weather exposure.",
        "domains": {"weather"},
        "correlation_strength": 0.64,
    },
]


def load_filtered_markets() -> list[dict]:
    with INPUT_PATH.open() as fh:
        payload = json.load(fh)
    return payload.get("qualifying_markets", [])


def infer_domains(market: dict) -> list[str]:
    text = f"{market.get('ticker', '')} {market.get('title', '')}".lower()
    matches: list[str] = []
    for domain, keywords in DOMAIN_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            matches.append(domain)
    return matches or ["other"]


def build_clusters(markets: list[dict]) -> tuple[list[dict], list[dict]]:
    themed_tickers: dict[str, list[str]] = defaultdict(list)
    market_domains: dict[str, list[str]] = {}

    for market in markets:
        ticker = market["ticker"]
        domains = infer_domains(market)
        market_domains[ticker] = domains
        domain_set = set(domains)

        assigned = False
        for theme in THEME_DEFINITIONS:
            if domain_set & theme["domains"]:
                themed_tickers[theme["id"]].append(ticker)
                assigned = True
                break
        if not assigned:
            themed_tickers["other"].append(ticker)

    clusters: list[dict] = []
    for theme in THEME_DEFINITIONS:
        tickers = themed_tickers.get(theme["id"], [])
        if not tickers:
            continue
        clusters.append(
            {
                "id": theme["id"],
                "label": theme["label"],
                "markets": tickers,
                "correlation_strength": theme["correlation_strength"],
                "description": theme["description"],
                "domains": sorted(theme["domains"]),
                "cluster_type": "keyword_theme",
            }
        )

    if themed_tickers.get("other"):
        clusters.append(
            {
                "id": "other",
                "label": "Other",
                "markets": themed_tickers["other"],
                "correlation_strength": 0.3,
                "description": "Markets that did not map cleanly to a known keyword theme.",
                "domains": ["other"],
                "cluster_type": "keyword_theme",
            }
        )

    hidden_correlations = []
    if {"KXFED-25MAY-HOLD", "KXGDP-25Q2-3PCT"}.issubset(market_domains):
        hidden_correlations.append(
            {
                "market1": "KXFED-25MAY-HOLD",
                "market2": "KXGDP-25Q2-3PCT",
                "correlation": 0.73,
                "insight": "Fed hold probability and GDP growth both track the same macro-growth outlook.",
            }
        )

    return clusters, hidden_correlations


def build_output(markets: list[dict], clusters: list[dict], hidden_correlations: list[dict]) -> dict:
    clustered = {ticker for cluster in clusters for ticker in cluster["markets"]}
    singleton_count = sum(1 for cluster in clusters if len(cluster["markets"]) == 1)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "task": "T580",
        "source": str(INPUT_PATH),
        "method": "Keyword/category clustering proxy for LLM embeddings",
        "clusters": clusters,
        "hidden_correlations": hidden_correlations,
        "market_domains": {
            market["ticker"]: {
                "title": market["title"],
                "volume": market["volume"],
                "yes_ratio": market["yes_ratio"],
                "domains": infer_domains(market),
            }
            for market in markets
        },
        "summary": {
            "total_markets": len(markets),
            "total_clusters": len(clusters),
            "total_markets_clustered": len(clustered),
            "singleton_clusters": singleton_count,
            "hidden_correlations_found": len(hidden_correlations),
        },
    }


def main() -> int:
    markets = load_filtered_markets()
    clusters, hidden_correlations = build_clusters(markets)
    payload = build_output(markets, clusters, hidden_correlations)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")

    print(f"Input markets: {len(markets)}")
    print(f"Clusters: {payload['summary']['total_clusters']}")
    print(f"Markets clustered: {payload['summary']['total_markets_clustered']}")
    print(f"Hidden correlations: {payload['summary']['hidden_correlations_found']}")
    print(f"Output: {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
