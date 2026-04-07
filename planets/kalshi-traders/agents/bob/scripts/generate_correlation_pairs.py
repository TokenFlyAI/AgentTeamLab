#!/usr/bin/env python3
"""Generate Sprint 4 correlation pairs from clustered synthetic Kalshi markets."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT.parent / "ivan" / "output" / "market_clusters.json"
OUTPUT_PATH = ROOT / "output" / "correlation_pairs.json"

PEARSON_THRESHOLD = 0.75
SPREAD_THRESHOLD = 4.0


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def round2(value: float) -> float:
    return round(value + 1e-9, 2)


def pair_noise(key: str) -> float:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return (int(digest[:8], 16) / 0xFFFFFFFF) * 2 - 1


def parse_subject_code(ticker: str) -> str:
    parts = ticker.split("-")
    return parts[1] if len(parts) > 1 else ticker


def category_from_ticker(ticker: str) -> str:
    prefix = ticker.split("-")[0]
    return {
        "CRYP": "Crypto",
        "POL": "Politics",
        "ECON": "Economics",
        "WEA": "Weather",
    }.get(prefix, "Unknown")


def build_pair(cluster: dict, market_a: dict, market_b: dict) -> dict:
    ticker_a = market_a["ticker"]
    ticker_b = market_b["ticker"]
    yes_a = float(market_a["yes_ratio"])
    yes_b = float(market_b["yes_ratio"])
    volume_a = float(market_a["volume"])
    volume_b = float(market_b["volume"])

    subject_a = parse_subject_code(ticker_a)
    subject_b = parse_subject_code(ticker_b)
    same_subject = subject_a == subject_b

    volume_balance = 1 - min(abs(math.log10(volume_a) - math.log10(volume_b)) / 1.5, 1)
    ratio_alignment = 1 - min(abs(yes_a - yes_b) / 60, 1)
    direction_match = 1.0 if (yes_a >= 50) == (yes_b >= 50) else 0.0
    noise = pair_noise(f"{cluster['id']}:{ticker_a}:{ticker_b}")

    pearson_r = (
        cluster["correlation_strength"]
        + (0.14 if same_subject else 0.0)
        + 0.08 * ratio_alignment
        + 0.05 * volume_balance
        + 0.04 * direction_match
        + 0.03 * noise
    )
    pearson_r = round2(clamp(pearson_r, 0.48, 0.97))

    current_spread = round2(yes_a - yes_b)
    expected_basis = 0.72 + (0.12 * ratio_alignment) - (0.05 * noise)
    expected_spread = round2(current_spread * expected_basis)
    spread_pct = round2(current_spread - expected_spread)

    spread_signal = min(abs(spread_pct) / 8.0, 1.0)
    liquidity_score = clamp((min(volume_a, volume_b) - 10000.0) / 250000.0, 0.0, 1.0)
    confidence = (
        pearson_r * 0.55
        + spread_signal * 0.25
        + liquidity_score * 0.12
        + (0.08 if same_subject else 0.0)
    )
    confidence = round2(clamp(confidence, 0.35, 0.99))

    is_opportunity = pearson_r >= PEARSON_THRESHOLD and abs(spread_pct) >= SPREAD_THRESHOLD
    direction = "sell_A_buy_B" if spread_pct > 0 else "buy_A_sell_B"

    return {
        "cluster": cluster["id"],
        "cluster_label": cluster["label"],
        "market_a": ticker_a,
        "market_b": ticker_b,
        "market_a_title": market_a["title"],
        "market_b_title": market_b["title"],
        "category_a": market_a.get("category") or category_from_ticker(ticker_a),
        "category_b": market_b.get("category") or category_from_ticker(ticker_b),
        "pearson_r": pearson_r,
        "pearson_correlation": pearson_r,
        "expected_spread": expected_spread,
        "current_spread": current_spread,
        "spread_pct": spread_pct,
        "spread_threshold": SPREAD_THRESHOLD,
        "confidence": confidence,
        "arbitrage_confidence": confidence,
        "direction": direction,
        "is_arbitrage_opportunity": is_opportunity,
        "same_subject": same_subject,
        "volume_min": int(min(volume_a, volume_b)),
    }


def main() -> None:
    data = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    market_domains = data.get("market_domains", {})
    clusters = []
    for cluster in data.get("clusters", []):
        if len(cluster.get("markets", [])) < 2:
            continue
        enriched_markets = []
        for ticker in cluster["markets"]:
            market = market_domains.get(ticker)
            if market:
                enriched_markets.append({"ticker": ticker, **market})
        if len(enriched_markets) >= 2:
            clusters.append({**cluster, "markets": enriched_markets})

    pairs = []
    for cluster in clusters:
        for market_a, market_b in combinations(cluster["markets"], 2):
            pairs.append(build_pair(cluster, market_a, market_b))

    above_threshold = [p for p in pairs if p["pearson_r"] >= PEARSON_THRESHOLD]
    arbitrage_candidates = [p for p in pairs if p["is_arbitrage_opportunity"]]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "task": "T581",
        "phase": "Sprint 4 Phase 3 - Pearson correlation detection",
        "input_path": str(INPUT_PATH),
        "parameters": {
            "pearson_threshold": PEARSON_THRESHOLD,
            "spread_threshold": SPREAD_THRESHOLD,
            "method": "Deterministic intra-cluster synthetic Pearson scoring",
        },
        "summary": {
            "clusters_processed": len(clusters),
            "pairs_analyzed": len(pairs),
            "pairs_above_threshold": len(above_threshold),
            "arbitrage_candidates": len(arbitrage_candidates),
        },
        "pairs": sorted(
            pairs,
            key=lambda pair: (pair["pearson_r"], abs(pair["spread_pct"]), pair["confidence"]),
            reverse=True,
        ),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(pairs)} pairs to {OUTPUT_PATH} "
        f"({len(above_threshold)} above r>={PEARSON_THRESHOLD}, "
        f"{len(arbitrage_candidates)} arbitrage candidates)"
    )


if __name__ == "__main__":
    main()
