#!/usr/bin/env python3
"""
NFP Signal Adapter

Connects Grace's data pipeline → Ivan's ML model → Dave/Bob's strategy framework.

Outputs strategy-compatible Signal objects.
"""

import os
import sys
import json
import math
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd
import numpy as np

# Add Ivan's model path to import his modules
IVAN_MODEL_PATH = Path("../../ivan/models/nfp_nowcast").resolve()
sys.path.insert(0, str(IVAN_MODEL_PATH))

from features import NFPFeatureEngineer
from predict import NFPPredictor

from data_bridge import load_grace_data, align_to_monthly


class KalshiPriceClient:
    """Lightweight client to fetch Kalshi market prices and discover markets."""

    def __init__(self, base_url: Optional[str] = None, demo: bool = True):
        self.base_url = base_url or os.getenv("KALSHI_API_BASE", "https://trading-api.kalshi.com")
        self.demo = demo

    def _get(self, path: str, params: Optional[Dict] = None) -> Optional[Dict]:
        url = f"{self.base_url}/trade-api/v2{path}"
        try:
            resp = requests.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"Warning: API request failed {path}: {e}")
            return None

    def discover_nfp_markets(self, release_date: str) -> Dict[int, str]:
        """
        Discover active NFP threshold markets by querying the KXNF series.
        Returns a mapping of threshold -> ticker.
        Falls back to assumed tickers if API is unavailable.
        """
        date_str = release_date.replace("-", "")
        data = self._get("/markets", {"series_ticker": "KXNF", "status": "active", "limit": 100})
        markets = data.get("markets", []) if data else []

        mapping: Dict[int, str] = {}
        for m in markets:
            ticker = m.get("ticker", "")
            title = m.get("title", "")
            # Try to extract threshold from title (e.g., "Will NFP exceed 100k?" or "100,000")
            threshold = self._extract_threshold(title)
            if threshold is not None:
                mapping[threshold] = ticker

        if mapping:
            print(f"Discovered {len(mapping)} NFP markets from Kalshi API")
            return mapping

        # Fallback: use assumed tickers
        print("Warning: Could not discover NFP markets from API. Using assumed tickers.")
        return {
            0: f"KXNF-{date_str}-T0",
            50000: f"KXNF-{date_str}-T50000",
            100000: f"KXNF-{date_str}-T100000",
            150000: f"KXNF-{date_str}-T150000",
            200000: f"KXNF-{date_str}-T200000",
            250000: f"KXNF-{date_str}-T250000",
            300000: f"KXNF-{date_str}-T300000",
        }

    @staticmethod
    def _extract_threshold(title: str) -> Optional[int]:
        """Extract NFP threshold from market title using common patterns."""
        import re
        # Look for numbers like 100,000 or 100000 or 100k
        patterns = [
            r"(\d{1,3}(?:,\d{3})+)\s*(?:nonfarm|nfp|payrolls)",
            r"(?:exceed|above|greater than|more than)\s*(\d{1,3}(?:,\d{3})+)",
            r"(\d{1,3}(?:,\d{3})+)\s*or\s*more",
            r"(\d{1,3}(?:,\d{3})+)",
            r"(\d+)k\b",
        ]
        for pat in patterns:
            match = re.search(pat, title, re.IGNORECASE)
            if match:
                num_str = match.group(1).replace(",", "")
                try:
                    val = int(num_str)
                    # If pattern was "100k", multiply by 1000
                    if "k" in pat.lower() and val < 1000:
                        val *= 1000
                    return val
                except ValueError:
                    continue
        return None

    def get_market(self, ticker: str) -> Optional[Dict]:
        """Fetch market details from Kalshi API."""
        data = self._get(f"/markets/{ticker}")
        return data.get("market") if data else None

    def get_market_price(self, ticker: str) -> Optional[float]:
        """Get the YES mid price (probability 0-1) for a market."""
        market = self.get_market(ticker)
        if not market:
            return None
        yes_bid = market.get("yes_bid", 0) or market.get("yes_bid", 0)
        yes_ask = market.get("yes_ask", 0) or market.get("yes_ask", 0)
        if yes_bid and yes_ask:
            return (yes_bid + yes_ask) / 200.0  # prices are in cents
        return market.get("last_price", 0) / 100.0


def build_kalshi_ticker(release_date: str, threshold: int) -> str:
    """
    Build a Kalshi-style ticker for NFP threshold markets.
    Format: KXNF-YYYYMMDD-T{threshold}
    """
    date_str = release_date.replace("-", "")
    return f"KXNF-{date_str}-T{threshold}"


def convert_to_dave_signal(
    recommendation: Dict,
    market_price: Optional[float],
    release_date: str,
) -> Dict:
    """
    Convert Ivan's recommendation to Dave's Signal interface.

    Dave Signal:
    {
      marketId: string,
      direction: "buy_yes" | "sell_yes" | "buy_no" | "sell_no",
      confidence: number,   // 0-1
      edge: number,         // in cents (0-100)
      price: number,        // current price in cents
      strategy: string,
      timestamp: Date,
      metadata?: object
    }
    """
    model_prob = recommendation["model_probability"]
    edge = recommendation["edge"]  # Ivan's edge is already 0-1
    signal_type = recommendation["signal"]  # BUY or SELL
    position = recommendation["recommended_position"]  # YES or NO

    # Direction mapping
    if signal_type == "BUY":
        direction = f"buy_{position.lower()}"
    elif signal_type == "SELL":
        # SELL YES = buy NO, SELL NO = buy YES
        opposite = "no" if position.lower() == "yes" else "yes"
        direction = f"buy_{opposite}"
    else:
        direction = "hold"

    market_price_cents = round((market_price or model_prob) * 100, 1)

    return {
        "marketId": recommendation["market_ticker"],
        "direction": direction,
        "confidence": round(model_prob, 4),
        "edge": round(edge * 100, 2),  # convert to cents
        "price": market_price_cents,
        "strategy": "nfp_nowcast_v1",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "metadata": {
            "release_date": release_date,
            "threshold": recommendation["threshold"],
            "kalshi_ticker": recommendation["market_ticker"],
            "model_confidence": recommendation["confidence"],
        },
    }


def convert_to_bob_signal(
    recommendation: Dict,
    market_price: Optional[float],
    release_date: str,
) -> Dict:
    """
    Convert Ivan's recommendation to Bob's SignalEngine / live_runner format.

    Matches the shape in bob/output/trade_signals.json signals array.
    """
    model_prob = recommendation["model_probability"]
    edge = recommendation["edge"]
    signal_type = recommendation["signal"]
    position = recommendation["recommended_position"]

    if signal_type == "BUY":
        side = position.lower()
        signal_type_bob = "entry"
    elif signal_type == "SELL":
        side = "no" if position.lower() == "yes" else "yes"
        signal_type_bob = "entry"
    else:
        side = position.lower()
        signal_type_bob = "hold"

    market_price_cents = round((market_price or model_prob) * 100, 1)
    # Simple position sizing: $100 per 1% edge, capped at 100 contracts
    recommended_contracts = min(max(int(edge * 100 * 10), 1), 100)
    risk_amount = int(recommended_contracts * market_price_cents)

    return {
        "strategy": "nfp_nowcast_v1",
        "marketId": recommendation["market_ticker"],
        "ticker": recommendation["market_ticker"],
        "side": side,
        "signalType": signal_type_bob,
        "confidence": round(model_prob, 4),
        "targetPrice": market_price_cents,
        "currentPrice": market_price_cents,
        "expectedEdge": round(edge * 100, 2),
        "recommendedContracts": recommended_contracts,
        "riskAmount": risk_amount,
        "reason": f"NFP nowcast: {model_prob:.1%} prob vs {market_price or model_prob:.1%} market price for threshold {recommendation['threshold']}",
    }


class NFPSignalAdapter:
    """
    Adapter that runs the full pipeline:
    Grace DB → Ivan model → Kalshi prices → Strategy signals
    """

    def __init__(
        self,
        db_path: Optional[str] = None,
        models_dir: Optional[Path] = None,
        use_live_prices: bool = False,
    ):
        self.db_path = db_path
        self.models_dir = models_dir
        self.use_live_prices = use_live_prices
        self.price_client = KalshiPriceClient()
        self.predictor = NFPPredictor(models_dir=models_dir)

    def generate_signals(
        self,
        release_date: Optional[str] = None,
    ) -> Dict:
        """
        Generate strategy-compatible signals for the given NFP release date.
        If no release_date is provided, uses the first day of next month.
        """
        if release_date is None:
            next_month = datetime.now().replace(day=1) + timedelta(days=32)
            release_date = next_month.replace(day=1).strftime("%Y-%m-%d")

        # 1. Load Grace's data
        data = load_grace_data(self.db_path)
        data = align_to_monthly(data)

        # 2. Engineer features via Ivan's code
        engineer = NFPFeatureEngineer()
        features, _ = engineer.build_feature_matrix(
            nfp_df=data["nfp"],
            adp_df=data["adp"],
            claims_df=data["claims"],
            ism_df=data["ism"],
            postings_df=data["postings"],
        )

        # 3. Load models (or fail gracefully)
        try:
            self.predictor.load_models()
        except Exception as e:
            print(f"Warning: Could not load models: {e}")
            return {
                "release_date": release_date,
                "status": "error",
                "error": str(e),
                "signals": [],
            }

        # 4. Generate predictions
        predictions = self.predictor.predict(features)

        # 5. Discover markets and fetch prices (live or mock)
        market_prices = {}
        ticker_mapping = self.price_client.discover_nfp_markets(release_date)

        if self.use_live_prices:
            for threshold in self.predictor.thresholds:
                ticker = ticker_mapping.get(threshold)
                if not ticker:
                    continue
                price = self.price_client.get_market_price(ticker)
                if price is not None:
                    market_prices[threshold] = price
        else:
            # Mock market prices for testing
            for threshold in self.predictor.thresholds:
                model_prob = predictions[f"threshold_{threshold}_prob"].iloc[-1]
                market_prices[threshold] = round(
                    max(0.01, min(0.99, model_prob + np.random.normal(0, 0.05))), 2
                )
                # Ensure ticker mapping has an entry for mock mode
                if threshold not in ticker_mapping:
                    ticker_mapping[threshold] = build_kalshi_ticker(release_date, threshold)

        # 6. Generate Kalshi signals via Ivan's code
        signals_df = self.predictor.get_kalshi_signals(predictions, market_prices)

        # 7. Format output via Ivan's code
        kalshi_output = self.predictor.format_kalshi_output(signals_df, release_date)

        # 8. Convert to Dave/Bob signal formats
        dave_signals = []
        bob_signals = []

        for rec in kalshi_output["recommendations"]:
            threshold = rec["threshold"]
            # Use discovered ticker if available, else fallback
            ticker = ticker_mapping.get(threshold, build_kalshi_ticker(release_date, threshold))
            rec["market_ticker"] = ticker
            market_price = market_prices.get(threshold)

            dave_signals.append(
                convert_to_dave_signal(rec, market_price, release_date)
            )
            bob_signals.append(
                convert_to_bob_signal(rec, market_price, release_date)
            )

        return {
            "release_date": release_date,
            "status": "success",
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "n_recommendations": len(dave_signals),
            "dave_signals": dave_signals,
            "bob_signals": bob_signals,
            "kalshi_output": kalshi_output,
            "market_prices": {str(k): round(v, 4) for k, v in market_prices.items()},
        }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="NFP Signal Adapter")
    parser.add_argument("--release-date", type=str, default=None, help="NFP release date (YYYY-MM-DD)")
    parser.add_argument("--output", type=str, default="output/nfp_signals.json", help="Output JSON file path")
    parser.add_argument("--live-prices", action="store_true", help="Fetch live prices from Kalshi API")
    args = parser.parse_args()

    adapter = NFPSignalAdapter(
        models_dir=IVAN_MODEL_PATH / "output",
        use_live_prices=args.live_prices,
    )
    result = adapter.generate_signals(release_date=args.release_date)

    # Write to file
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2, default=str)

    print(json.dumps(result, indent=2, default=str))
    print(f"\nWrote signals to {output_path}")


if __name__ == "__main__":
    main()
