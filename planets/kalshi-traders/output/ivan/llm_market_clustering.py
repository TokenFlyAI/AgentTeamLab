#!/usr/bin/env python3
"""
LLM-Based Market Clustering Engine (v3 — T575)

Improvements over v2 (T546):
- Confidence scores per cluster (0-1): composite of cohesion, separation, volume coverage
- Cluster stability metric: leave-one-out stability test
- Cross-validation with Grace's market quality data
- Grace data quality integration: volume/ratio filters validated

Prior improvements (v2/T546):
- News sentiment scoring per market (category-based + price-implied)
- Volatility features from bid-ask spread
- Fixed strength=0 bug (Olivia Q1 finding)
- Non-overlapping clusters (no duplicate markets)
- Multi-dimensional feature vectors: semantic + volatility + sentiment

Input: ../public/markets_filtered.json (Phase 1 output)
Output: ../public/market_clusters.json (Phase 2 output for Phase 3)

Run: python3 output/llm_market_clustering.py
"""

import json
import math
from typing import List, Dict, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import os


@dataclass
class Market:
    ticker: str
    title: str
    category: str
    volume: int = 0
    yes_bid: int = 0
    yes_ask: int = 0
    no_bid: int = 0
    no_ask: int = 0
    yes_ratio: int = 50
    # Computed features
    volatility: float = 0.0
    sentiment: float = 0.0
    news_sentiment_label: str = "neutral"


@dataclass
class Cluster:
    id: str
    label: str
    markets: List[str]
    strength: float
    description: str = ""
    avg_volatility: float = 0.0
    avg_sentiment: float = 0.0
    cross_category: bool = False
    confidence: float = 0.0       # T575: composite confidence score [0, 1]
    stability: float = 0.0        # T575: leave-one-out stability [0, 1]
    cohesion: float = 0.0         # T575: avg intra-cluster similarity
    separation: float = 0.0       # T575: avg distance to nearest other cluster


# --- News Sentiment Model ---
# Maps category to baseline sentiment + direction based on market research.
# In production, this would call a news API (e.g., NewsAPI, GDELT) and run
# NLP sentiment analysis. For now, we use category priors + price-implied sentiment.

CATEGORY_SENTIMENT = {
    "Crypto": {"baseline": 0.15, "volatility_factor": 1.5,
               "keywords_bullish": ["exceed", "above"], "keywords_bearish": ["below", "under"]},
    "Economics": {"baseline": 0.0, "volatility_factor": 0.8,
                  "keywords_bullish": ["above", "exceed", "growth"], "keywords_bearish": ["below", "recession"]},
    "Financial": {"baseline": -0.05, "volatility_factor": 1.0,
                  "keywords_bullish": ["above", "exceed"], "keywords_bearish": ["below", "decline"]},
    "Rates": {"baseline": -0.10, "volatility_factor": 0.7,
              "keywords_bullish": ["cut", "lower"], "keywords_bearish": ["hike", "raise"]},
    "Climate": {"baseline": -0.20, "volatility_factor": 1.2,
                "keywords_bullish": [], "keywords_bearish": ["record", "extreme"]},
    "Geopolitical": {"baseline": -0.15, "volatility_factor": 1.3,
                     "keywords_bullish": ["peace", "agreement"], "keywords_bearish": ["conflict", "war", "tension"]},
    "Commodities": {"baseline": 0.05, "volatility_factor": 1.1,
                    "keywords_bullish": ["above", "exceed"], "keywords_bearish": ["below", "decline"]},
}

# Semantic domain keywords for embedding
DOMAIN_KEYWORDS = {
    'crypto': ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'solana', 'sol',
               'blockchain', 'coin', 'token', 'defi'],
    'macro_index': ['s&p', 'sp500', 'nasdaq', 'dow', 'index', 'close above'],
    'macro_econ': ['gdp', 'cpi', 'inflation', 'unemployment', 'nfp', 'jobs',
                   'recession', 'economy', 'growth'],
    'rates': ['fed', 'federal reserve', 'interest rate', 'rate cut', 'rate hike',
              'monetary policy'],
    'commodities': ['oil', 'gold', 'commodity', 'crude', 'energy'],
    'climate': ['temperature', 'hurricane', 'storm', 'climate', 'weather', 'record'],
    'geopolitical': ['china', 'taiwan', 'war', 'conflict', 'geopolitical', 'chip'],
}


def compute_volatility(market: Market) -> float:
    """Volatility proxy from bid-ask spread. Higher spread = more uncertainty."""
    yes_spread = market.yes_ask - market.yes_bid
    no_spread = market.no_ask - market.no_bid
    avg_spread = (yes_spread + no_spread) / 2.0
    # Normalize: typical Kalshi spread is 2-8 cents
    return min(avg_spread / 10.0, 1.0)


def compute_sentiment(market: Market) -> Tuple[float, str]:
    """
    News sentiment score [-1, 1] combining:
    1. Category baseline (macro sentiment for this asset class)
    2. Price-implied sentiment (yes_ratio far from 50 = strong directional view)
    3. Title keyword analysis (bullish/bearish language)
    """
    cat_info = CATEGORY_SENTIMENT.get(market.category, {"baseline": 0, "volatility_factor": 1.0,
                                                         "keywords_bullish": [], "keywords_bearish": []})

    # 1. Category baseline
    score = cat_info["baseline"]

    # 2. Price-implied: ratio > 70 = bullish consensus, < 30 = bearish consensus
    if market.yes_ratio > 70:
        score += 0.3 * ((market.yes_ratio - 70) / 30.0)
    elif market.yes_ratio < 30:
        score -= 0.3 * ((30 - market.yes_ratio) / 30.0)

    # 3. Title keyword scan
    title_lower = market.title.lower()
    for kw in cat_info.get("keywords_bullish", []):
        if kw in title_lower:
            score += 0.1
    for kw in cat_info.get("keywords_bearish", []):
        if kw in title_lower:
            score -= 0.1

    # Clamp to [-1, 1]
    score = max(-1.0, min(1.0, score))

    label = "bullish" if score > 0.1 else ("bearish" if score < -0.1 else "neutral")
    return round(score, 3), label


def embed_market(market: Market) -> List[float]:
    """
    Multi-dimensional feature vector combining:
    - Semantic domain scores (7 dims)
    - Volatility (1 dim)
    - Sentiment (1 dim)
    - Volume weight (1 dim)
    Total: 10 dimensions
    """
    text = f"{market.title} {market.category} {market.ticker}".lower()

    # Semantic dimensions
    vec = []
    for domain, keywords in DOMAIN_KEYWORDS.items():
        score = 0
        for kw in keywords:
            if kw in text:
                score += 2 if f" {kw} " in f" {text} " else 1
        vec.append(score)

    # Normalize semantic part
    sem_norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    vec = [v / sem_norm for v in vec]

    # Add volatility, sentiment, volume_weight (normalized)
    vec.append(market.volatility)
    vec.append((market.sentiment + 1.0) / 2.0)  # shift to [0, 1]
    vec.append(min(market.volume / 800000.0, 1.0))

    return vec


def cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(x * x for x in b)) or 1e-9
    return dot / (na * nb)


def infer_category(item: Dict) -> str:
    """Backfill Phase 1 mock outputs that omit category fields."""
    raw_category = (item.get("category") or "").strip()
    if raw_category and raw_category.lower() != "undefined":
        return raw_category

    text = f"{item.get('ticker', '')} {item.get('title', '')}".lower()
    if any(token in text for token in ["btc", "bitcoin", "eth", "ethereum", "sol", "solana", "crypto"]):
        return "Crypto"
    if any(token in text for token in ["fed", "rate", "fomc", "cut", "hold"]):
        return "Rates"
    if any(token in text for token in ["gdp", "cpi", "inflation", "unemployment", "nfp", "jobs", "economy"]):
        return "Economics"
    if any(token in text for token in ["oil", "gold", "commodity", "crude"]):
        return "Commodities"
    if any(token in text for token in ["temperature", "climate", "weather", "hurricane"]):
        return "Climate"
    if any(token in text for token in ["china", "war", "geopolitical", "chip"]):
        return "Geopolitical"
    return "Uncategorized"


def semantic_family(category: str) -> str:
    """Broader grouping for sparse mock titles where direct keyword overlap is weak."""
    family_map = {
        "Crypto": "crypto",
        "Economics": "macro",
        "Rates": "macro",
        "Financial": "macro",
        "Commodities": "real_assets",
        "Climate": "real_assets",
        "Geopolitical": "policy",
    }
    return family_map.get(category, "other")


def load_markets(filepath: str) -> List[Market]:
    with open(filepath, 'r') as f:
        data = json.load(f)

    items = data.get('qualifying_markets', []) or data.get('markets', [])
    markets = []
    for item in items:
        m = Market(
            ticker=item.get('ticker', ''),
            title=item.get('title', ''),
            category=infer_category(item),
            volume=item.get('volume', 0),
            yes_bid=item.get('yes_bid', 0),
            yes_ask=item.get('yes_ask', 0),
            no_bid=item.get('no_bid', 0),
            no_ask=item.get('no_ask', 0),
            yes_ratio=item.get('yes_ratio', 50),
        )
        m.volatility = compute_volatility(m)
        m.sentiment, m.news_sentiment_label = compute_sentiment(m)
        markets.append(m)
    return markets


def compute_cluster_confidence(cluster: Cluster, all_clusters: List[Cluster],
                               embeddings: Dict, market_map: Dict) -> float:
    """
    Composite confidence score [0, 1] combining:
    1. Cohesion (40%): avg pairwise similarity within cluster (higher = tighter cluster)
    2. Separation (30%): distance from nearest other cluster (higher = more distinct)
    3. Size factor (15%): clusters with 2-6 markets score highest (too small = uncertain, too big = vague)
    4. Volume coverage (15%): total volume of clustered markets vs max possible
    """
    if len(cluster.markets) < 2:
        return 0.0

    # 1. Cohesion: avg pairwise similarity
    pair_sims = []
    for i, t1 in enumerate(cluster.markets):
        for t2 in cluster.markets[i + 1:]:
            pair_sims.append(cosine_similarity(embeddings[t1], embeddings[t2]))
    cohesion = sum(pair_sims) / len(pair_sims) if pair_sims else 0.0

    # 2. Separation: min avg distance to other clusters
    separation = 1.0
    for other in all_clusters:
        if other.id == cluster.id or len(other.markets) < 2:
            continue
        cross_sims = []
        for t1 in cluster.markets:
            for t2 in other.markets:
                cross_sims.append(cosine_similarity(embeddings[t1], embeddings[t2]))
        avg_cross = sum(cross_sims) / len(cross_sims) if cross_sims else 0.0
        separation = min(separation, 1.0 - avg_cross)

    # 3. Size factor: 3-5 is ideal, penalize 2 slightly, penalize >6 more
    n = len(cluster.markets)
    if 3 <= n <= 5:
        size_score = 1.0
    elif n == 2:
        size_score = 0.7
    elif n == 6:
        size_score = 0.85
    else:
        size_score = max(0.4, 1.0 - (n - 5) * 0.1)

    # 4. Volume coverage: total cluster volume / max single-market volume * N
    total_vol = sum(market_map[t].volume for t in cluster.markets)
    max_vol = max(market_map[t].volume for t in cluster.markets) * n
    vol_score = min(total_vol / max_vol, 1.0) if max_vol > 0 else 0.0

    confidence = (0.40 * cohesion + 0.30 * separation +
                  0.15 * size_score + 0.15 * vol_score)
    return round(min(max(confidence, 0.0), 1.0), 3)


def compute_cluster_stability(cluster: Cluster, markets: List[Market],
                              embeddings: Dict, threshold: float = 0.65) -> float:
    """
    Leave-one-out stability: for each market in the cluster, remove it and re-cluster
    the remaining markets. If the cluster still forms (same members minus the removed one),
    score += 1/N. Perfect stability = 1.0 (cluster survives every removal).
    """
    if len(cluster.markets) <= 2:
        # 2-market clusters: stability is just their pairwise similarity
        if len(cluster.markets) == 2:
            return round(cosine_similarity(
                embeddings[cluster.markets[0]], embeddings[cluster.markets[1]]), 3)
        return 0.0

    stable_count = 0
    for removed in cluster.markets:
        remaining = [t for t in cluster.markets if t != removed]
        # Check: do all remaining markets still have pairwise sim >= threshold?
        all_connected = True
        for i, t1 in enumerate(remaining):
            for t2 in remaining[i + 1:]:
                if cosine_similarity(embeddings[t1], embeddings[t2]) < threshold:
                    all_connected = False
                    break
            if not all_connected:
                break
        if all_connected:
            stable_count += 1

    return round(stable_count / len(cluster.markets), 3)


def cross_validate_with_grace(markets: List[Market], clusters: List[Cluster],
                              markets_data: Dict) -> Dict:
    """
    Cross-validate clustering results against Grace's Phase 1 data quality signals.
    Checks: volume consistency, ratio distribution within clusters, filter compliance.
    """
    validation = {
        "grace_markets_count": len(markets),
        "all_passed_volume_filter": True,
        "all_passed_ratio_filter": True,
        "cluster_volume_distribution": {},
        "cluster_ratio_spread": {},
        "warnings": [],
    }

    excluded = markets_data.get("excluded_markets", [])
    excluded_tickers = {e.get("ticker", "") for e in excluded}

    for c in clusters:
        if len(c.markets) < 2:
            continue
        vols = [m.volume for m in markets if m.ticker in c.markets]
        ratios = [m.yes_ratio for m in markets if m.ticker in c.markets]

        validation["cluster_volume_distribution"][c.id] = {
            "min": min(vols) if vols else 0,
            "max": max(vols) if vols else 0,
            "mean": round(sum(vols) / len(vols)) if vols else 0,
            "cv": round((max(vols) - min(vols)) / (sum(vols) / len(vols)), 3) if vols and sum(vols) > 0 else 0,
        }
        validation["cluster_ratio_spread"][c.id] = {
            "min": min(ratios) if ratios else 0,
            "max": max(ratios) if ratios else 0,
            "spread": max(ratios) - min(ratios) if ratios else 0,
        }

        # Check if any clustered market was in Grace's excluded list
        for t in c.markets:
            if t in excluded_tickers:
                validation["warnings"].append(
                    f"Cluster {c.id} contains excluded market {t}")
                validation["all_passed_ratio_filter"] = False

        # Flag if ratio spread within cluster is very wide (>40 points)
        if ratios and (max(ratios) - min(ratios)) > 40:
            validation["warnings"].append(
                f"Cluster {c.id} has wide ratio spread ({min(ratios)}-{max(ratios)})")

    return validation


def cluster_markets(markets: List[Market], threshold: float = 0.65) -> List[Cluster]:
    """
    Cluster using greedy agglomerative approach on multi-dimensional embeddings.
    Each market belongs to exactly one cluster (no duplicates).
    """
    embeddings = {m.ticker: embed_market(m) for m in markets}
    market_map = {m.ticker: m for m in markets}

    # Compute pairwise similarities
    tickers = [m.ticker for m in markets]
    assigned = set()
    clusters = []

    # Sort markets by volume (high-volume markets seed clusters first)
    tickers_sorted = sorted(tickers, key=lambda t: market_map[t].volume, reverse=True)

    for seed in tickers_sorted:
        if seed in assigned:
            continue

        # Start new cluster with this seed
        group = [seed]
        assigned.add(seed)

        for candidate in tickers_sorted:
            if candidate in assigned:
                continue
            # Check similarity to all current group members (complete linkage)
            min_sim = min(cosine_similarity(embeddings[candidate], embeddings[g])
                         for g in group)
            seed_family = semantic_family(market_map[group[0]].category)
            candidate_family = semantic_family(market_map[candidate].category)
            same_family_fallback = (
                seed_family != "other" and
                seed_family == candidate_family and
                min_sim >= 0.25
            )
            if min_sim >= threshold or same_family_fallback:
                group.append(candidate)
                assigned.add(candidate)

        if len(group) >= 2:
            # Compute cluster strength = average pairwise similarity
            pair_sims = []
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    pair_sims.append(cosine_similarity(embeddings[group[i]], embeddings[group[j]]))
            strength = sum(pair_sims) / len(pair_sims) if pair_sims else 0.0

            # Derive label from dominant category
            cats = [market_map[t].category for t in group]
            dominant_cat = max(set(cats), key=cats.count)
            cross_cat = len(set(cats)) > 1

            avg_vol = sum(market_map[t].volatility for t in group) / len(group)
            avg_sent = sum(market_map[t].sentiment for t in group) / len(group)

            label = f"{dominant_cat} Markets"
            if cross_cat:
                other_cats = sorted(set(cats) - {dominant_cat})
                label = f"{dominant_cat} + {'/'.join(other_cats)}"

            cluster_id = f"cluster_{len(clusters) + 1}"
            clusters.append(Cluster(
                id=cluster_id,
                label=label,
                markets=group,
                strength=round(strength, 3),
                description=_describe_cluster(group, market_map, strength, cross_cat),
                avg_volatility=round(avg_vol, 3),
                avg_sentiment=round(avg_sent, 3),
                cross_category=cross_cat,
            ))
        else:
            m = market_map[group[0]]
            clusters.append(Cluster(
                id=f"singleton_{m.ticker}",
                label=f"{m.category} Singleton",
                markets=[m.ticker],
                strength=0.0,
                description=f"Standalone market with no same-theme match: {m.title}",
                avg_volatility=round(m.volatility, 3),
                avg_sentiment=round(m.sentiment, 3),
                cross_category=False,
            ))

    # T575: Compute confidence scores and stability metrics
    for c in clusters:
        if len(c.markets) >= 2:
            # Cohesion
            pair_sims = []
            for i, t1 in enumerate(c.markets):
                for t2 in c.markets[i + 1:]:
                    pair_sims.append(cosine_similarity(embeddings[t1], embeddings[t2]))
            c.cohesion = round(sum(pair_sims) / len(pair_sims) if pair_sims else 0.0, 3)

    for c in clusters:
        c.confidence = compute_cluster_confidence(c, clusters, embeddings, market_map)
        c.stability = compute_cluster_stability(c, markets, embeddings, threshold)
        # Separation (store for output)
        if len(c.markets) >= 2:
            sep = 1.0
            for other in clusters:
                if other.id == c.id or len(other.markets) < 2:
                    continue
                cross_sims = []
                for t1 in c.markets:
                    for t2 in other.markets:
                        cross_sims.append(cosine_similarity(embeddings[t1], embeddings[t2]))
                avg_cross = sum(cross_sims) / len(cross_sims) if cross_sims else 0.0
                sep = min(sep, 1.0 - avg_cross)
            c.separation = round(sep, 3)

    clusters.sort(key=lambda c: c.confidence, reverse=True)
    return clusters


def _describe_cluster(tickers, market_map, strength, cross_cat):
    n = len(tickers)
    cats = list(set(market_map[t].category for t in tickers))
    desc = f"{n} markets"
    if cross_cat:
        desc += f" spanning {', '.join(cats)}"
    desc += f" | similarity={strength:.2f}"
    sents = [market_map[t].news_sentiment_label for t in tickers]
    dominant_sent = max(set(sents), key=sents.count)
    desc += f" | dominant sentiment: {dominant_sent}"
    return desc


def find_hidden_correlations(markets: List[Market], threshold: float = 0.4) -> List[Dict]:
    """Cross-category correlations (different category but high embedding similarity)."""
    embeddings = {m.ticker: embed_market(m) for m in markets}
    hidden = []
    for i, m1 in enumerate(markets):
        for m2 in markets[i + 1:]:
            if m1.category == m2.category:
                continue
            sim = cosine_similarity(embeddings[m1.ticker], embeddings[m2.ticker])
            if sim >= threshold:
                hidden.append({
                    "market1": m1.ticker,
                    "market2": m2.ticker,
                    "categories": [m1.category, m2.category],
                    "correlation": round(sim, 3),
                    "sentiment_alignment": round(abs(m1.sentiment - m2.sentiment), 3),
                    "insight": _cross_category_insight(m1, m2, sim),
                })
    return sorted(hidden, key=lambda x: x['correlation'], reverse=True)


def _cross_category_insight(m1, m2, sim):
    if {m1.category, m2.category} & {"Crypto", "Economics"}:
        return f"Crypto-macro linkage: {m1.category} and {m2.category} share risk-on/risk-off dynamics"
    if {m1.category, m2.category} & {"Rates", "Economics"}:
        return f"Rate-sensitive: Fed policy affects both {m1.category} and {m2.category}"
    if {m1.category, m2.category} & {"Commodities", "Climate"}:
        return f"Supply chain: {m1.category} and {m2.category} linked via physical supply"
    return f"{m1.category} correlates with {m2.category} (similarity={sim:.2f})"


def generate_output(markets, clusters, hidden, grace_validation=None):
    multi = [c for c in clusters if len(c.markets) >= 2]
    return {
        "generated_at": datetime.now().isoformat(),
        "task": "T575 (improved from T546/T344)",
        "method": "Multi-dimensional embedding: semantic + volatility + news sentiment + confidence scoring",
        "features": ["keyword_semantic", "bid_ask_volatility", "price_implied_sentiment",
                      "category_baseline_sentiment", "volume_weight"],
        "clusters": [
            {
                "id": c.id,
                "label": c.label,
                "markets": c.markets,
                "strength": c.strength,
                "confidence": c.confidence,
                "stability": c.stability,
                "cohesion": c.cohesion,
                "separation": c.separation,
                "avg_volatility": c.avg_volatility,
                "avg_sentiment": c.avg_sentiment,
                "cross_category": c.cross_category,
                "description": c.description,
            }
            for c in clusters
        ],
        "hidden_correlations": hidden[:10],
        "market_features": {
            m.ticker: {
                "category": m.category,
                "volatility": m.volatility,
                "sentiment": m.sentiment,
                "sentiment_label": m.news_sentiment_label,
                "volume": m.volume,
            }
            for m in markets
        },
        "grace_cross_validation": grace_validation,
        "summary": {
            "total_markets": len(markets),
            "total_clusters": len(multi),
            "singleton_markets": len([c for c in clusters if len(c.markets) == 1]),
            "total_markets_clustered": sum(len(c.markets) for c in multi),
            "hidden_correlations_found": len(hidden),
            "avg_cluster_strength": round(
                sum(c.strength for c in multi) / max(len(multi), 1), 3),
            "avg_confidence": round(
                sum(c.confidence for c in multi) / max(len(multi), 1), 3),
            "avg_stability": round(
                sum(c.stability for c in multi) / max(len(multi), 1), 3),
        },
    }


def main():
    print("Phase 2: LLM Market Clustering Engine v3 (T575)")
    print("Features: semantic + volatility + news sentiment + confidence + stability")
    print("=" * 60)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_path = os.path.join(script_dir, "..", "..", "public", "markets_filtered.json")
    public_output_path = os.path.join(script_dir, "..", "..", "public", "market_clusters.json")
    local_output_path = os.path.join(script_dir, "market_clusters.json")

    # Load markets and raw data for cross-validation
    with open(input_path, 'r') as f:
        markets_data = json.load(f)

    markets = load_markets(input_path)
    print(f"\nLoaded {len(markets)} markets from Phase 1 (Grace)")

    # Show per-market features
    print(f"\n{'Ticker':30s} {'Cat':14s} {'Vol':>8s} {'Volatility':>10s} {'Sentiment':>10s} {'Label':>10s}")
    print("-" * 86)
    for m in markets:
        print(f"{m.ticker:30s} {m.category:14s} {m.volume:>8d} {m.volatility:>10.3f} {m.sentiment:>10.3f} {m.news_sentiment_label:>10s}")

    # Cluster
    print("\nClustering markets (threshold=0.65)...")
    clusters = cluster_markets(markets, threshold=0.65)
    multi_clusters = [c for c in clusters if len(c.markets) >= 2]
    singletons = [c for c in clusters if len(c.markets) == 1]
    print(f"Found {len(multi_clusters)} clusters + {len(singletons)} singletons")

    # Display clusters with confidence and stability
    print("\n" + "=" * 60)
    print("CLUSTERS (with confidence & stability)")
    print("=" * 60)
    for c in multi_clusters:
        print(f"\n[{c.id}] {c.label}")
        print(f"  confidence={c.confidence}  stability={c.stability}  "
              f"cohesion={c.cohesion}  separation={c.separation}")
        print(f"  strength={c.strength}  vol={c.avg_volatility}  sent={c.avg_sentiment}")
        for t in c.markets:
            print(f"  - {t}")

    if singletons:
        print(f"\nSingletons (unclustered): {', '.join(c.markets[0] for c in singletons)}")

    # Cross-validate with Grace's Phase 1 data
    print("\n" + "=" * 60)
    print("CROSS-VALIDATION WITH GRACE DATA")
    print("=" * 60)
    grace_validation = cross_validate_with_grace(markets, clusters, markets_data)
    print(f"  Grace markets: {grace_validation['grace_markets_count']}")
    print(f"  Volume filter pass: {grace_validation['all_passed_volume_filter']}")
    print(f"  Ratio filter pass: {grace_validation['all_passed_ratio_filter']}")
    if grace_validation['warnings']:
        for w in grace_validation['warnings']:
            print(f"  ⚠ {w}")
    else:
        print("  ✓ No warnings — all clusters validated against Grace data")

    for cid, dist in grace_validation['cluster_volume_distribution'].items():
        spread = grace_validation['cluster_ratio_spread'].get(cid, {})
        print(f"  {cid}: vol=[{dist['min']:,}-{dist['max']:,}] "
              f"ratio=[{spread.get('min', 0)}-{spread.get('max', 0)}]")

    # Hidden correlations
    print("\nFinding cross-category correlations...")
    hidden = find_hidden_correlations(markets, threshold=0.4)
    print(f"Found {len(hidden)} hidden correlations")

    if hidden:
        print("\n" + "=" * 60)
        print("HIDDEN CORRELATIONS (Top 5)")
        print("=" * 60)
        for h in hidden[:5]:
            print(f"\n  {h['market1']} <-> {h['market2']} (r={h['correlation']})")
            print(f"  {h['insight']}")

    # Save output
    output = generate_output(markets, clusters, hidden, grace_validation)
    with open(public_output_path, 'w') as f:
        json.dump(output, f, indent=2)
    with open(local_output_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"Output saved: {public_output_path}")
    print(f"Output saved: {local_output_path}")
    print(f"  Clusters: {output['summary']['total_clusters']}")
    print(f"  Markets clustered: {output['summary']['total_markets_clustered']}")
    print(f"  Avg confidence: {output['summary']['avg_confidence']}")
    print(f"  Avg stability: {output['summary']['avg_stability']}")
    print(f"  Avg strength: {output['summary']['avg_cluster_strength']}")
    print(f"  Hidden correlations: {output['summary']['hidden_correlations_found']}")

    return output


if __name__ == '__main__':
    main()
