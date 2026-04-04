#!/usr/bin/env python3
"""
Python ports of Bob/Dave's JavaScript strategies for backtesting.
Includes all 5 strategies: mean_reversion, momentum, crypto_edge, nfp_nowcast, econ_edge
"""

import math
from typing import Dict, List, Optional


class SignalEngine:
    """Python port of Bob's SignalEngine validation logic."""
    
    def __init__(self, min_confidence: float = 0.3, min_edge: float = 2.0, max_signals: int = 50):
        self.min_confidence = min_confidence
        self.min_edge = min_edge
        self.max_signals = max_signals
    
    def validate(self, signal: Optional[Dict]) -> bool:
        if not signal:
            return False
        if signal.get("confidence", 0) < self.min_confidence:
            return False
        if signal.get("expectedEdge", 0) < self.min_edge:
            return False
        if signal.get("side") not in ("yes", "no"):
            return False
        if signal.get("signalType") not in ("entry", "exit", "hold"):
            return False
        return True


class MeanReversionStrategy:
    """Python port of MeanReversionStrategy."""
    
    def __init__(self, z_score_threshold: float = 1.5, min_volume: int = 10000):
        self.z_score_threshold = z_score_threshold
        self.min_volume = min_volume
    
    def generate_signal(self, market: Dict, history: List[Dict]) -> Optional[Dict]:
        yes_price = market.get("yes_mid", 50)
        volume = market.get("volume", 0)
        
        if volume < self.min_volume:
            return None
        
        if len(history) < 5:
            return None
        
        prices = [h["yes_mid"] for h in history]
        mean_price = sum(prices) / len(prices)
        variance = sum((p - mean_price) ** 2 for p in prices) / len(prices)
        std_dev = math.sqrt(variance) if variance > 0 else 0
        
        if std_dev <= 0:
            return None
        
        z_score = (yes_price - mean_price) / std_dev
        if abs(z_score) < self.z_score_threshold:
            return None
        
        side = "no" if z_score > 0 else "yes"
        target_price = yes_price if side == "yes" else (100 - yes_price)
        edge = abs(z_score) * std_dev
        confidence = min(abs(z_score) / 3, 0.95)
        
        return {
            "marketId": market["id"],
            "side": side,
            "signalType": "entry",
            "confidence": confidence,
            "targetPrice": target_price,
            "currentPrice": target_price,
            "expectedEdge": round(edge),
            "recommendedContracts": 10,
            "reason": f"Mean reversion: z-score={z_score:.2f}, mean={mean_price:.1f}, vol={volume}",
            "strategy": "mean_reversion",
        }


class MomentumStrategy:
    """Python port of MomentumStrategy."""
    
    def __init__(self, price_change_threshold: float = 5, min_volume: int = 50000):
        self.price_change_threshold = price_change_threshold
        self.min_volume = min_volume
    
    def generate_signal(self, market: Dict, history: List[Dict]) -> Optional[Dict]:
        yes_price = market.get("yes_mid", 50)
        volume = market.get("volume", 0)
        volume24h = market.get("volume24h", volume)
        
        if volume24h < self.min_volume:
            return None
        
        if len(history) < 2:
            price_change = 0
        else:
            price_change = history[-1]["yes_mid"] - history[0]["yes_mid"]
        
        if abs(price_change) < self.price_change_threshold:
            return None
        
        side = "yes" if price_change > 0 else "no"
        target_price = yes_price if side == "yes" else (100 - yes_price)
        confidence = min(abs(price_change) / 15, 0.95)
        edge = abs(price_change) * 0.5
        
        return {
            "marketId": market["id"],
            "side": side,
            "signalType": "entry",
            "confidence": confidence,
            "targetPrice": target_price,
            "currentPrice": target_price,
            "expectedEdge": round(edge),
            "recommendedContracts": 15,
            "reason": f"Momentum: {price_change:+.0f}c in window, vol24h={volume24h}",
            "strategy": "momentum",
        }


class CryptoEdgeStrategy:
    """
    Crypto Edge Strategy - Python port.
    Uses lognormal model to price crypto binary options.
    """
    
    def __init__(self, sigma: float = 0.60, min_edge: float = 5.0):
        self.sigma = sigma  # Annual volatility
        self.min_edge = min_edge
        self.target_tickers = ["BTCW", "ETHW"]
    
    def norm_cdf(self, x: float) -> float:
        """Standard normal CDF."""
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))
    
    def generate_signal(self, market: Dict) -> Optional[Dict]:
        ticker = market.get("ticker", "")
        
        # Only trade crypto markets
        if not any(ticker.startswith(prefix) for prefix in self.target_tickers):
            return None
        
        yes_price = market.get("yes_mid", 50)
        
        # Extract strike price from ticker (e.g., BTCW-26-JUN30-100K -> 100000)
        strike = self._extract_strike(ticker)
        if not strike:
            return None
        
        # Get current spot price (from market data or mock)
        spot = market.get("spot_price", self._mock_spot(ticker))
        
        # Days to expiration (mock if not available)
        days = market.get("days_to_expiry", 30)
        T = days / 365.0
        
        # Lognormal model: P = N((ln(S/K) + (σ²/2)*T) / (σ*√T))
        if spot <= 0 or strike <= 0 or T <= 0:
            return None
        
        d1 = (math.log(spot / strike) + (self.sigma ** 2 / 2) * T) / (self.sigma * math.sqrt(T))
        model_prob = self.norm_cdf(d1)
        
        market_prob = yes_price / 100.0
        edge = abs(model_prob - market_prob) * 100  # in cents
        
        if edge < self.min_edge:
            return None
        
        # Trade direction
        side = "yes" if model_prob > market_prob else "no"
        target_price = yes_price if side == "yes" else (100 - yes_price)
        confidence = min(edge / 20, 0.95)  # Higher edge = higher confidence
        
        return {
            "marketId": market["id"],
            "side": side,
            "signalType": "entry",
            "confidence": confidence,
            "targetPrice": target_price,
            "currentPrice": target_price,
            "expectedEdge": round(edge),
            "recommendedContracts": 10,
            "reason": f"Crypto edge: spot=${spot:,.0f}, strike=${strike:,.0f}, model={model_prob:.1%}, market={market_prob:.1%}",
            "strategy": "crypto_edge",
        }
    
    def _extract_strike(self, ticker: str) -> Optional[float]:
        """Extract strike price from ticker like BTCW-26-JUN30-100K."""
        import re
        m = re.search(r'(\d+)(K?)\b', ticker)
        if m:
            val = float(m.group(1))
            if m.group(2) or val < 1000:
                val *= 1000
            return val
        return None
    
    def _mock_spot(self, ticker: str) -> float:
        """Mock spot prices for backtesting."""
        if "BTC" in ticker:
            return 85000.0
        elif "ETH" in ticker:
            return 4500.0
        return 50000.0


class NFPNowcastStrategy:
    """
    NFP Nowcast Strategy - Python port.
    Uses consensus forecast vs market implied probability.
    """
    
    def __init__(self, min_edge: float = 5.0):
        self.min_edge = min_edge
        self.target_prefix = "KXNF"
    
    def generate_signal(self, market: Dict) -> Optional[Dict]:
        ticker = market.get("ticker", "")
        
        # Only trade NFP markets
        if not ticker.startswith(self.target_prefix):
            return None
        
        yes_price = market.get("yes_mid", 50)
        
        # Extract threshold from ticker (e.g., KXNF-20260501-T100000)
        threshold = self._extract_threshold(ticker)
        if not threshold:
            return None
        
        # Get consensus forecast (from market data or mock)
        consensus = market.get("nfp_consensus", 140000)
        
        # Model probability using normal distribution
        # σ ≈ 22% of consensus for NFP
        sigma = consensus * 0.22
        z = (consensus - threshold) / sigma if sigma > 0 else 0
        model_prob = 1 - self._norm_cdf(-z)
        
        market_prob = yes_price / 100.0
        edge = abs(model_prob - market_prob) * 100
        
        if edge < self.min_edge:
            return None
        
        side = "yes" if model_prob > market_prob else "no"
        target_price = yes_price if side == "yes" else (100 - yes_price)
        confidence = min(edge / 20, 0.95)
        
        return {
            "marketId": market["id"],
            "side": side,
            "signalType": "entry",
            "confidence": confidence,
            "targetPrice": target_price,
            "currentPrice": target_price,
            "expectedEdge": round(edge),
            "recommendedContracts": 10,
            "reason": f"NFP nowcast: consensus={consensus:,.0f}, threshold={threshold:,.0f}, model={model_prob:.1%}, market={market_prob:.1%}",
            "strategy": "nfp_nowcast",
        }
    
    def _extract_threshold(self, ticker: str) -> Optional[float]:
        """Extract threshold from ticker like KXNF-20260501-T100000."""
        import re
        m = re.search(r'T(\d+)', ticker)
        if m:
            return float(m.group(1))
        return None
    
    def _norm_cdf(self, x: float) -> float:
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))


class ArbitrageStrategy:
    """Python port of ArbitrageStrategy (YES+NO arbitrage)."""
    
    def __init__(self, min_sum: float = 100.5, max_sum: float = 105.0):
        self.min_sum = min_sum
        self.max_sum = max_sum
    
    def generate_signals(self, markets: List[Dict]) -> List[Dict]:
        """Find arbitrage opportunities across all markets."""
        signals = []
        for market in markets:
            yes_ask = market.get("yes_ask", 0)
            no_ask = market.get("no_ask", 0)
            
            if yes_ask <= 0 or no_ask <= 0:
                continue
            
            total = yes_ask + no_ask
            
            if total < self.min_sum or total > self.max_sum:
                continue
            
            # Arbitrage: buy both YES and NO
            edge = total - 100
            confidence = min(edge / 5, 0.9)
            
            signals.append({
                "marketId": market["id"],
                "side": "yes",  # Buy YES
                "signalType": "entry",
                "confidence": confidence,
                "targetPrice": yes_ask,
                "currentPrice": yes_ask,
                "expectedEdge": round(edge),
                "recommendedContracts": 10,
                "reason": f"Arbitrage: YES={yes_ask}c + NO={no_ask}c = {total:.1f}c (edge={edge:.1f}c)",
                "strategy": "arbitrage",
            })
        
        return signals


class LongshotFadingStrategy:
    """Python port of LongshotFadingStrategy."""
    
    def __init__(self, min_price: int = 5, max_price: int = 20, min_volume: int = 5000):
        self.min_price = min_price
        self.max_price = max_price
        self.min_volume = min_volume
        self.target_categories = ["Politics", "Entertainment", "Weather", "Sports", "Geopolitics"]
    
    def generate_signal(self, market: Dict) -> Optional[Dict]:
        category = market.get("category", "")
        if category not in self.target_categories:
            return None
        
        yes_price = market.get("yes_mid", 50)
        volume = market.get("volume", 0)
        
        if volume < self.min_volume:
            return None
        
        if not (self.min_price <= yes_price <= self.max_price):
            return None
        
        # Sell YES (fade the longshot)
        edge = yes_price * 0.3  # Expect to decay toward 0
        confidence = min(yes_price / 25, 0.8)
        
        return {
            "marketId": market["id"],
            "side": "no",  # Sell YES = buy NO
            "signalType": "entry",
            "confidence": confidence,
            "targetPrice": 100 - yes_price,
            "currentPrice": 100 - yes_price,
            "expectedEdge": round(edge),
            "recommendedContracts": 10,
            "reason": f"Longshot fading: {yes_price}c YES in {category} (vol={volume})",
            "strategy": "longshot_fading",
        }


class EconomicMomentumStrategy:
    """Python port of EconomicMomentumStrategy."""
    
    def __init__(self, min_divergence: float = 8, max_hours: int = 48):
        self.target_categories = ["Economics", "Financial"]
        self.min_divergence = min_divergence
        self.max_hours = max_hours
        self.min_confidence = 0.6
        self.min_edge = 3
    
    def generate_signal(self, market: Dict) -> Optional[Dict]:
        if market.get("category") not in self.target_categories:
            return None
        
        forecast = market.get("forecast")
        if not forecast or not isinstance(forecast.get("probability"), (int, float)):
            return None
        
        hours_to_release = market.get("hours_to_release", 0)
        if hours_to_release > self.max_hours:
            return None
        
        yes_price = market.get("yes_mid", 50)
        implied_prob = yes_price / 100.0
        forecast_prob = forecast["probability"]
        divergence = abs(implied_prob - forecast_prob) * 100
        
        if divergence < self.min_divergence:
            return None
        
        edge = divergence * 0.5
        confidence = min(0.5 + (divergence / 100), 0.9)
        
        if confidence < self.min_confidence or edge < self.min_edge:
            return None
        
        side = "yes" if forecast_prob > implied_prob else "no"
        target_price = yes_price if side == "yes" else (100 - yes_price)
        
        return {
            "marketId": market["id"],
            "side": side,
            "signalType": "entry",
            "confidence": confidence,
            "targetPrice": target_price,
            "currentPrice": target_price,
            "expectedEdge": round(edge),
            "recommendedContracts": 10,
            "reason": f"Economic momentum: implied={implied_prob*100:.1f}%, forecast={forecast_prob*100:.1f}%, divergence={divergence:.1f}pp",
            "strategy": "econ_edge",
        }
