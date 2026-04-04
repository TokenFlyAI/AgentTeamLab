#!/usr/bin/env python3
"""
Synthetic Historical Market Data Generator for Backtesting

Generates realistic daily Kalshi market snapshots with price history.
"""

import random
import json
from datetime import datetime, timedelta
from typing import List, Dict
from pathlib import Path

random.seed(42)


MARKET_TEMPLATES = [
    {"ticker": "INXW-25-DEC31", "title": "S&P 500 to close above 5000", "category": "Economics", "base_price": 86, "volatility": 3},
    {"ticker": "BTCW-25-DEC31", "title": "Bitcoin above 100k", "category": "Crypto", "base_price": 16, "volatility": 4},
    {"ticker": "ETHW-25-DEC31", "title": "Ethereum above 5000", "category": "Crypto", "base_price": 34, "volatility": 5},
    {"ticker": "UNEMP-25-MAR", "title": "Unemployment below 4%", "category": "Economics", "base_price": 56, "volatility": 2},
    {"ticker": "SNOW-NYC-25", "title": "NYC sees 6+ inches of snow", "category": "Weather", "base_price": 12, "volatility": 5, "mean_revert": 0.15},
    {"ticker": "OSC-BEST-25", "title": "Movie X wins Best Picture", "category": "Entertainment", "base_price": 18, "volatility": 6, "mean_revert": 0.15},
    {"ticker": "FED-CUT-25", "title": "Fed cuts rates in March", "category": "Economics", "base_price": 45, "volatility": 4},
    {"ticker": "RACE-2028", "title": "Republican wins 2028 presidency", "category": "Politics", "base_price": 52, "volatility": 3},
    {"ticker": "STORM-FL-25", "title": "Florida hurricane makes landfall", "category": "Weather", "base_price": 8, "volatility": 4, "mean_revert": 0.2},
    {"ticker": "GRAMMY-25", "title": "Artist Y wins Album of the Year", "category": "Entertainment", "base_price": 15, "volatility": 5, "mean_revert": 0.15},
    {"ticker": "TARIFF-25", "title": "New China tariffs announced", "category": "Geopolitics", "base_price": 42, "volatility": 4},
    {"ticker": "KXNF-20250307-T200000", "title": "NFP above 200k in March", "category": "Financial", "base_price": 48, "volatility": 4},
    {"ticker": "KXNF-20250404-T200000", "title": "NFP above 200k in April", "category": "Financial", "base_price": 52, "volatility": 4},
    {"ticker": "BTCW-25-JUN", "title": "Bitcoin above 90k in June", "category": "Crypto", "base_price": 62, "volatility": 5},
]


def generate_market_history(days: int = 90) -> List[Dict]:
    """Generate daily snapshots for all markets."""
    end_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=days)

    markets = []
    for template in MARKET_TEMPLATES:
        # Generate a random walk for YES price
        prices = []
        current_price = template["base_price"]
        mean_revert = template.get("mean_revert", 0)
        for i in range(days + 1):
            date = start_date + timedelta(days=i)
            change = random.gauss(0, template["volatility"])
            if mean_revert > 0:
                change += mean_revert * (template["base_price"] - current_price)
            current_price = max(1, min(99, current_price + change))
            
            # Ensure YES + NO ≈ 100 (with small spread)
            spread = random.randint(1, 3)
            yes_bid = max(1, int(current_price - spread))
            yes_ask = min(99, int(current_price + spread))
            no_bid = max(1, 100 - yes_ask - spread)
            no_ask = min(99, 100 - yes_bid + spread)
            
            # Volume varies by category
            base_volume = {
                "Economics": 200000, "Crypto": 150000, "Politics": 300000,
                "Weather": 60000, "Entertainment": 45000
            }.get(template["category"], 100000)
            volume = int(base_volume * random.uniform(0.5, 1.5))
            
            prices.append({
                "date": date.strftime("%Y-%m-%d"),
                "yes_bid": yes_bid,
                "yes_ask": yes_ask,
                "no_bid": no_bid,
                "no_ask": no_ask,
                "yes_mid": int((yes_bid + yes_ask) / 2),
                "no_mid": int((no_bid + no_ask) / 2),
                "volume": volume,
                "open_interest": int(volume * random.uniform(0.02, 0.08)),
            })
        
        markets.append({
            "id": template["ticker"],
            "ticker": template["ticker"],
            "title": template["title"],
            "category": template["category"],
            "history": prices,
        })
    
    return markets


def save_data(markets: List[Dict], output_dir: str = "data"):
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)
    with open(path / "historical_markets.json", "w") as f:
        json.dump(markets, f, indent=2)
    print(f"Generated {len(markets)} markets with {len(markets[0]['history'])} days of history")


if __name__ == "__main__":
    markets = generate_market_history(days=90)
    save_data(markets)
