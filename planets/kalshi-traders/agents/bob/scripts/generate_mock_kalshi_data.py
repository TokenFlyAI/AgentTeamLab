#!/usr/bin/env python3
"""Generate realistic mock Kalshi market data for Sprint 4 pipeline validation."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random
from uuid import uuid5, NAMESPACE_URL


OUTPUT_PATH = Path(__file__).resolve().parents[1] / "output" / "mock_kalshi_markets.json"
MARKET_COUNT = 200

CATEGORY_CONFIG = {
    "Crypto": {
        "prefix": "CRYP",
        "event_prefix": "KXCRY",
        "base_volume": 210_000,
        "base_oi": 78_000,
        "subjects": [
            ("BTC", "Bitcoin above ${level} by {deadline}?"),
            ("ETH", "Ethereum above ${level} by {deadline}?"),
            ("SOL", "Solana above ${level} by {deadline}?"),
            ("DOGE", "Dogecoin above ${level} by {deadline}?"),
            ("BTCDOM", "Bitcoin dominance above {level}% by {deadline}?"),
        ],
        "levels": ["0.18", "150", "180", "4,500", "95,000", "68"],
    },
    "Politics": {
        "prefix": "POL",
        "event_prefix": "KXPOL",
        "base_volume": 165_000,
        "base_oi": 61_000,
        "subjects": [
            ("SEN", "Democrats to control the Senate after {deadline}?"),
            ("HOUSE", "Republicans to control the House after {deadline}?"),
            ("APPROVAL", "President approval above {level}% on {deadline}?"),
            ("GOV", "Government shutdown before {deadline}?"),
            ("SCOTUS", "Supreme Court vacancy announced before {deadline}?"),
        ],
        "levels": ["45", "48", "50", "52", "55"],
    },
    "Economics": {
        "prefix": "ECON",
        "event_prefix": "KXECO",
        "base_volume": 240_000,
        "base_oi": 92_000,
        "subjects": [
            ("CPI", "US CPI above {level}% in {deadline}?"),
            ("GDP", "US GDP growth above {level}% in {deadline}?"),
            ("FED", "Fed cuts rates by {level} bps before {deadline}?"),
            ("UNEMP", "US unemployment above {level}% in {deadline}?"),
            ("PAY", "Nonfarm payrolls above {level}k in {deadline}?"),
        ],
        "levels": ["2.4", "2.8", "3.0", "3.4", "175", "225", "250", "50"],
    },
    "Weather": {
        "prefix": "WEA",
        "event_prefix": "KXWTH",
        "base_volume": 95_000,
        "base_oi": 34_000,
        "subjects": [
            ("HURR", "Major hurricane hits Florida before {deadline}?"),
            ("HEAT", "Phoenix records 20 straight days above {level}F by {deadline}?"),
            ("SNOW", "NYC snowfall above {level} inches by {deadline}?"),
            ("RAIN", "LA rainfall above {level} inches in {deadline}?"),
            ("ATL", "Atlantic named storms above {level} in {deadline}?"),
        ],
        "levels": ["8", "12", "18", "24", "110"],
    },
}

MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def market_deadline(index: int) -> tuple[str, str]:
    base = datetime(2026, 5, 15, tzinfo=timezone.utc) + timedelta(days=index * 3)
    code = f"{base.year % 100:02d}{MONTH_CODES[base.month - 1]}{base.day:02d}"
    label = base.strftime("%b %-d, %Y")
    return code, label


def build_market(category: str, index: int, rng: Random) -> dict:
    config = CATEGORY_CONFIG[category]
    code, deadline = market_deadline(index)
    subject_code, title_template = config["subjects"][index % len(config["subjects"])]
    level = config["levels"][rng.randrange(len(config["levels"]))]

    yes_price = clamp(int(rng.triangular(5, 95, 52)), 3, 97)
    spread = rng.randint(1, 4)
    yes_bid = clamp(yes_price - spread // 2, 1, 98)
    yes_ask = clamp(yes_bid + spread, yes_bid + 1, 99)
    no_price = 100 - yes_price
    no_ask = clamp(100 - yes_bid, 1, 99)
    no_bid = clamp(100 - yes_ask, 1, no_ask - 1)

    volume = clamp(int(config["base_volume"] * rng.uniform(0.35, 2.1)), 100, 500_000)
    open_interest = clamp(int(config["base_oi"] * rng.uniform(0.4, 1.8)), 75, volume)
    liquidity = clamp(int(volume * rng.uniform(0.08, 0.35)), 50, 80_000)

    close_time = datetime(2026, 6, 1, tzinfo=timezone.utc) + timedelta(days=index * 2 + rng.randint(5, 120))
    price_updated_at = close_time - timedelta(days=rng.randint(1, 14), hours=rng.randint(0, 23))

    title = title_template.format(level=level, deadline=deadline)
    ticker = f"{config['prefix']}-{subject_code}-{code}-{index + 1:03d}"
    event_ticker = f"{config['event_prefix']}-{code}-{subject_code}"
    uid = str(uuid5(NAMESPACE_URL, f"kalshi-mock:{ticker}"))

    return {
        "id": uid,
        "event_ticker": event_ticker,
        "ticker": ticker,
        "title": title,
        "subtitle": f"Synthetic {category.lower()} event for pipeline validation",
        "category": category,
        "status": "active",
        "market_type": "binary",
        "yes_bid": yes_bid,
        "yes_ask": yes_ask,
        "no_bid": no_bid,
        "no_ask": no_ask,
        "yes_price": yes_price,
        "no_price": no_price,
        "last_price": yes_price,
        "previous_yes_price": clamp(yes_price + rng.randint(-6, 6), 1, 99),
        "volume": volume,
        "open_interest": open_interest,
        "liquidity": liquidity,
        "dollar_volume": volume * rng.randint(55, 140),
        "close_time": close_time.isoformat().replace("+00:00", "Z"),
        "price_updated_at": price_updated_at.isoformat().replace("+00:00", "Z"),
        "strike_type": "greater_than",
        "notional_value": 100,
        "tick_size": 1,
        "result": None,
    }


def main() -> None:
    rng = Random(578)
    categories = list(CATEGORY_CONFIG.keys())
    markets = [build_market(categories[i % len(categories)], i, rng) for i in range(MARKET_COUNT)]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "task": "T578",
        "market_count": len(markets),
        "categories": {category: MARKET_COUNT // len(categories) for category in categories},
        "markets": markets,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(markets)} markets to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
