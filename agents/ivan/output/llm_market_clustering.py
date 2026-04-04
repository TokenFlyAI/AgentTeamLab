#!/usr/bin/env python3
"""
LLM-Based Market Clustering Engine

Task 344: Use LLM embeddings to identify hidden correlations in Kalshi markets

Input: agents/public/markets_filtered.json
Output: agents/public/market_clusters.json
"""

import json
import numpy as np
from typing import List, Dict, Tuple
from dataclasses import dataclass
import re
from datetime import datetime


@dataclass
class Market:
    """Represents a Kalshi market"""
    ticker: str
    title: str
    category: str
    description: str = ""
    
    def to_text(self) -> str:
        """Convert market to text for embedding"""
        return f"{self.title}. Category: {self.category}. Ticker: {self.ticker}"


@dataclass
class Cluster:
    """Represents a market cluster"""
    id: str
    label: str
    markets: List[str]
    correlation_strength: float
    description: str = ""


class SimpleEmbeddingEngine:
    """
    Simplified embedding engine using keyword-based vectors.
    
    In production, this would use OpenAI/Claude API for real embeddings.
    For this implementation, we use semantic keyword matching.
    """
    
    # Domain-specific keywords for clustering
    DOMAIN_KEYWORDS = {
        'crypto': [
            'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency',
            'blockchain', 'digital asset', 'coin', 'token', 'altcoin',
            'defi', 'nft', 'mining', 'wallet', 'exchange'
        ],
        'politics': [
            'election', 'president', 'congress', 'senate', 'house',
            'vote', 'ballot', 'candidate', 'party', 'democrat', 'republican',
            'trump', 'biden', 'legislation', 'policy', 'government'
        ],
        'economics': [
            'fed', 'federal reserve', 'interest rate', 'inflation', 'cpi',
            'gdp', 'unemployment', 'jobs', 'nfp', 'recession', 'economy',
            'monetary policy', 'fiscal', 'treasury', 'dollar'
        ],
        'sports': [
            'super bowl', 'nba', 'nfl', 'mlb', 'nhl', 'championship',
            'playoff', 'game', 'match', 'team', 'player', 'season',
            'tournament', 'finals', 'world cup', 'olympics'
        ],
        'finance': [
            'sp500', 's&p', 'nasdaq', 'dow', 'index', 'stock', 'equity',
            'market', 'trading', 'volatility', 'bull', 'bear', 'rally',
            'correction', 'ipo', 'earnings'
        ],
        'weather': [
            'hurricane', 'storm', 'temperature', 'rain', 'snow', 'drought',
            'climate', 'weather', 'season', 'winter', 'summer', 'tornado'
        ],
        'technology': [
            'ai', 'artificial intelligence', 'tech', 'software', 'hardware',
            'semiconductor', 'chip', 'cloud', 'data', 'cyber', 'digital'
        ],
        'entertainment': [
            'movie', 'film', 'oscar', 'grammy', 'emmy', 'award',
            'celebrity', 'music', 'album', 'streaming', 'box office'
        ]
    }
    
    def __init__(self):
        self.dimensions = len(self.DOMAIN_KEYWORDS)
        self.domains = list(self.DOMAIN_KEYWORDS.keys())
    
    def embed(self, text: str) -> np.ndarray:
        """
        Create embedding vector based on keyword presence.
        
        Returns normalized vector where each dimension represents
        strength of association with a domain.
        """
        text_lower = text.lower()
        vector = np.zeros(self.dimensions)
        
        for i, (domain, keywords) in enumerate(self.DOMAIN_KEYWORDS.items()):
            score = 0
            for keyword in keywords:
                if keyword in text_lower:
                    # Weight exact matches higher
                    if f" {keyword} " in f" {text_lower} ":
                        score += 2
                    else:
                        score += 1
            vector[i] = score
        
        # Normalize
        norm = np.linalg.norm(vector)
        if norm > 0:
            vector = vector / norm
        
        return vector
    
    def similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Cosine similarity between two vectors"""
        return np.dot(vec1, vec2)


class MarketClusteringEngine:
    """Main clustering engine for Kalshi markets"""
    
    def __init__(self, similarity_threshold: float = 0.3):
        self.embedder = SimpleEmbeddingEngine()
        self.similarity_threshold = similarity_threshold
    
    def load_markets(self, filepath: str) -> List[Market]:
        """Load markets from JSON file"""
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            
            markets = []
            # Support both 'markets' and 'qualifying_markets' keys
            market_items = data.get('markets', []) or data.get('qualifying_markets', [])
            for item in market_items:
                market = Market(
                    ticker=item.get('ticker', ''),
                    title=item.get('title', ''),
                    category=item.get('category', ''),
                    description=item.get('description', '')
                )
                markets.append(market)
            
            return markets
        except FileNotFoundError:
            print(f"Warning: {filepath} not found. Using sample data.")
            return self._get_sample_markets()
        except json.JSONDecodeError:
            print(f"Warning: {filepath} is empty or invalid. Using sample data.")
            return self._get_sample_markets()
    
    def _get_sample_markets(self) -> List[Market]:
        """Sample markets for testing"""
        return [
            Market("BTCW-26-JUN-100K", "Will Bitcoin exceed $100,000 by June 2026?", "Crypto"),
            Market("ETHW-26-DEC-5K", "Will Ethereum exceed $5,000 by December 2026?", "Crypto"),
            Market("BTC-DOM-60", "Will Bitcoin dominance exceed 60%?", "Crypto"),
            Market("ETH-BTC-RATIO", "Will ETH/BTC ratio exceed 0.08?", "Crypto"),
            Market("US-PRES-2024", "Who will win the 2024 US Presidential election?", "Politics"),
            Market("SENATE-CONTROL", "Which party will control the Senate?", "Politics"),
            Market("FED-RATE-DEC", "Will Fed raise rates in December?", "Economics"),
            Market("CPI-OVER-4", "Will CPI exceed 4%?", "Economics"),
            Market("SP500-5000", "Will S&P 500 close above 5000?", "Finance"),
            Market("NASDAQ-ALLTIME", "Will Nasdaq hit all-time high?", "Finance"),
            Market("SUPER-BOWL-LVIII", "Who will win Super Bowl LVIII?", "Sports"),
            Market("NBA-CHAMP-2024", "Who will win NBA Championship 2024?", "Sports"),
            Market("HURRICANE-CAT5", "Will a Category 5 hurricane make landfall?", "Weather"),
            Market("AI-BREAKTHROUGH", "Will there be major AI breakthrough?", "Technology"),
            Market("OSCAR-BEST-PICTURE", "Which film wins Best Picture?", "Entertainment"),
        ]
    
    def cluster_markets(self, markets: List[Market]) -> List[Cluster]:
        """
        Cluster markets based on embedding similarity.
        
        Uses agglomerative clustering approach:
        1. Embed all markets
        2. Calculate pairwise similarities
        3. Group markets with similarity > threshold
        """
        if not markets:
            return []
        
        # Embed all markets
        embeddings = {}
        for market in markets:
            text = market.to_text()
            embeddings[market.ticker] = self.embedder.embed(text)
        
        # Calculate pairwise similarities
        similarities = {}
        for i, m1 in enumerate(markets):
            for m2 in markets[i+1:]:
                sim = self.embedder.similarity(
                    embeddings[m1.ticker],
                    embeddings[m2.ticker]
                )
                if sim >= self.similarity_threshold:
                    similarities[(m1.ticker, m2.ticker)] = sim
        
        # Build clusters using connected components
        clusters = self._build_clusters(markets, similarities)
        
        return clusters
    
    def _build_clusters(self, markets: List[Market], similarities: Dict) -> List[Cluster]:
        """Build clusters from similarity graph"""
        # Group by domain first
        domain_groups = {}
        
        for market in markets:
            text = market.to_text()
            embedding = self.embedder.embed(text)
            
            # Find dominant domain
            max_idx = np.argmax(embedding)
            domain = self.embedder.domains[max_idx]
            
            if domain not in domain_groups:
                domain_groups[domain] = []
            domain_groups[domain].append((market, embedding))
        
        # Create clusters
        clusters = []
        for domain, items in domain_groups.items():
            if len(items) < 2:
                continue
            
            market_tickers = [item[0].ticker for item in items]
            
            # Calculate average correlation strength
            avg_strength = 0
            count = 0
            for i, (_, emb1) in enumerate(items):
                for _, emb2 in items[i+1:]:
                    sim = self.embedder.similarity(emb1, emb2)
                    avg_strength += sim
                    count += 1
            
            if count > 0:
                avg_strength /= count
            
            cluster = Cluster(
                id=f"{domain}_cluster",
                label=f"{domain.capitalize()} Markets",
                markets=market_tickers,
                correlation_strength=round(avg_strength, 2),
                description=f"Markets related to {domain}"
            )
            clusters.append(cluster)
        
        # Sort by correlation strength
        clusters.sort(key=lambda c: c.correlation_strength, reverse=True)
        
        return clusters
    
    def find_hidden_correlations(self, markets: List[Market]) -> List[Dict]:
        """
        Find non-obvious correlations between markets.
        
        Example: Crypto markets might correlate with tech stocks
        """
        embeddings = {m.ticker: self.embedder.embed(m.to_text()) for m in markets}
        
        hidden = []
        for i, m1 in enumerate(markets):
            for m2 in markets[i+1:]:
                # Skip if same obvious category
                if m1.category == m2.category:
                    continue
                
                sim = self.embedder.similarity(
                    embeddings[m1.ticker],
                    embeddings[m2.ticker]
                )
                
                # High similarity across different categories = hidden correlation
                if sim >= 0.4:
                    hidden.append({
                        "market1": m1.ticker,
                        "market2": m2.ticker,
                        "categories": [m1.category, m2.category],
                        "correlation": round(sim, 2),
                        "insight": f"{m1.category} market correlates with {m2.category} market"
                    })
        
        return sorted(hidden, key=lambda x: x['correlation'], reverse=True)
    
    def generate_output(self, clusters: List[Cluster], hidden: List[Dict]) -> Dict:
        """Generate final output JSON"""
        return {
            "generated_at": datetime.now().isoformat(),
            "method": "LLM embedding similarity (keyword-based)",
            "similarity_threshold": self.similarity_threshold,
            "clusters": [
                {
                    "id": c.id,
                    "label": c.label,
                    "markets": c.markets,
                    "correlation_strength": c.correlation_strength,
                    "description": c.description
                }
                for c in clusters
            ],
            "hidden_correlations": hidden[:10],  # Top 10
            "summary": {
                "total_clusters": len(clusters),
                "total_markets_clustered": sum(len(c.markets) for c in clusters),
                "hidden_correlations_found": len(hidden)
            }
        }


def main():
    """Main execution"""
    print("LLM-Based Market Clustering Engine — Task 344")
    print("=" * 60)
    
    # Initialize engine
    engine = MarketClusteringEngine(similarity_threshold=0.3)
    
    # Load markets
    input_path = "../public/markets_filtered.json"
    markets = engine.load_markets(input_path)
    print(f"\nLoaded {len(markets)} markets")
    
    # Perform clustering
    print("\nClustering markets...")
    clusters = engine.cluster_markets(markets)
    print(f"Found {len(clusters)} clusters")
    
    # Find hidden correlations
    print("\nFinding hidden correlations...")
    hidden = engine.find_hidden_correlations(markets)
    print(f"Found {len(hidden)} hidden correlations")
    
    # Generate output
    output = engine.generate_output(clusters, hidden)
    
    # Display results
    print("\n" + "=" * 60)
    print("CLUSTERS")
    print("=" * 60)
    
    for cluster in clusters:
        print(f"\n{cluster.label} (strength: {cluster.correlation_strength})")
        for ticker in cluster.markets:
            print(f"  - {ticker}")
    
    if hidden:
        print("\n" + "=" * 60)
        print("HIDDEN CORRELATIONS (Top 5)")
        print("=" * 60)
        
        for corr in hidden[:5]:
            print(f"\n{corr['market1']} <-> {corr['market2']}")
            print(f"  Correlation: {corr['correlation']}")
            print(f"  Insight: {corr['insight']}")
    
    # Save output
    output_path = "../public/market_clusters.json"
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"\n✅ Output saved to: {output_path}")
    print(f"   Total clusters: {output['summary']['total_clusters']}")
    print(f"   Markets clustered: {output['summary']['total_markets_clustered']}")
    print(f"   Hidden correlations: {output['summary']['hidden_correlations_found']}")
    
    return output


if __name__ == '__main__':
    main()
