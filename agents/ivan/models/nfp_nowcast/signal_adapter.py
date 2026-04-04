"""
NFP Signal Adapter

Converts NFP model predictions to strategy-compatible signals.
Matches Dave's strategy framework Signal interface.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from datetime import datetime
import json


@dataclass
class StrategySignal:
    """
    Signal format matching Dave's strategy framework.
    
    Reference: backend/strategies/index.js
    """
    marketId: str           # Kalshi ticker (e.g., "KXNF-260501-T150000")
    direction: str          # "buy_yes" | "sell_yes" | "buy_no" | "sell_no"
    confidence: float       # 0-1
    edge: float            # in cents (0-100)
    price: float           # current market price in cents
    strategy: str          # "nfp_nowcast"
    timestamp: str         # ISO 8601
    metadata: Dict         # Additional context
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'marketId': self.marketId,
            'direction': self.direction,
            'confidence': round(self.confidence, 4),
            'edge': round(self.edge, 2),
            'price': round(self.price, 2),
            'strategy': self.strategy,
            'timestamp': self.timestamp,
            'metadata': self.metadata
        }
    
    def to_dave_format(self) -> Dict:
        """Format for Dave's strategy framework"""
        return {
            'marketId': self.marketId,
            'direction': self.direction,
            'confidence': self.confidence,
            'edge': self.edge,
            'price': self.price,
            'strategy': self.strategy,
            'timestamp': self.timestamp,
            'metadata': self.metadata
        }


class NFPSignalAdapter:
    """
    Adapter that converts NFP model outputs to strategy-compatible signals.
    """
    
    def __init__(
        self,
        edge_threshold: float = 5.0,      # Minimum edge in cents to generate signal
        confidence_threshold: float = 0.55, # Minimum model confidence
        max_signals: int = 3               # Max signals per release
    ):
        self.edge_threshold = edge_threshold
        self.confidence_threshold = confidence_threshold
        self.max_signals = max_signals
        self.strategy_name = "nfp_nowcast"
        
    def adapt(
        self,
        predictions: pd.DataFrame,
        market_data: Dict[str, Dict]  # ticker -> {yes_bid, yes_ask, yes_mid}
    ) -> List[StrategySignal]:
        """
        Convert NFP predictions to strategy signals.
        
        Args:
            predictions: DataFrame from NFPPredictor.predict()
            market_data: Dict of market prices from Kalshi API
        
        Returns:
            List of StrategySignal objects
        """
        signals = []
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Get latest predictions
        latest = predictions.iloc[-1]
        
        for col in predictions.columns:
            if not col.endswith('_prob'):
                continue
                
            # Extract threshold from column name
            # e.g., "threshold_150000_prob" -> 150000
            threshold = int(col.split('_')[1])
            model_prob = latest[col]  # 0-1
            
            # Find corresponding market
            market_ticker = f"KXNF-{self._get_release_date()}-T{threshold}"
            
            if market_ticker not in market_data:
                continue
                
            market = market_data[market_ticker]
            market_price = market.get('yes_mid', 50)  # Default to 50 if no price
            
            # Calculate edge (model - market) in cents
            edge = (model_prob * 100) - market_price
            
            # Determine direction
            if edge > self.edge_threshold and model_prob > self.confidence_threshold:
                direction = "buy_yes"
                confidence = model_prob
            elif edge < -self.edge_threshold and (1 - model_prob) > self.confidence_threshold:
                direction = "buy_no"
                confidence = 1 - model_prob
                edge = abs(edge)  # Edge is positive for signal strength
            else:
                continue  # No signal
            
            signal = StrategySignal(
                marketId=market_ticker,
                direction=direction,
                confidence=confidence,
                edge=edge,
                price=market_price,
                strategy=self.strategy_name,
                timestamp=timestamp,
                metadata={
                    'model_probability': round(model_prob, 4),
                    'threshold': threshold,
                    'model_version': 'nfp_nowcast_v1',
                    'features_used': self._get_feature_names()
                }
            )
            signals.append(signal)
        
        # Sort by edge (descending) and take top N
        signals.sort(key=lambda s: s.edge, reverse=True)
        return signals[:self.max_signals]
    
    def adapt_for_dave(
        self,
        predictions: pd.DataFrame,
        market_data: Dict[str, Dict]
    ) -> List[Dict]:
        """
        Generate signals in Dave's exact format.
        """
        signals = self.adapt(predictions, market_data)
        return [s.to_dave_format() for s in signals]
    
    def _get_release_date(self) -> str:
        """Get next NFP release date (simplified)"""
        # In production, this would calculate the actual next release
        # First Friday of next month
        today = datetime.now()
        if today.month == 12:
            next_month = datetime(today.year + 1, 1, 1)
        else:
            next_month = datetime(today.year, today.month + 1, 1)
        
        # Find first Friday
        from calendar import monthrange
        _, last_day = monthrange(next_month.year, next_month.month)
        for day in range(1, 8):
            date = datetime(next_month.year, next_month.month, day)
            if date.weekday() == 4:  # Friday
                return date.strftime('%y%m%d')
        return '260501'  # Default
    
    def _get_feature_names(self) -> List[str]:
        """List of features used by the model"""
        return [
            'adp_level', 'adp_yoy', 'adp_surprise', 'adp_momentum',
            'claims_4wk_ma', 'claims_log_diff', 'claims_trend',
            'continuing_level', 'continuing_change',
            'ism_level', 'ism_vs_50', 'ism_change',
            'postings_4wk_ma', 'postings_yoy', 'postings_momentum'
        ]


class KalshiMarketClient:
    """
    Mock client for fetching Kalshi NFP market data.
    In production, this calls Bob's Kalshi API client.
    """
    
    def __init__(self, demo_mode: bool = True):
        self.demo_mode = demo_mode
        
    def get_nfp_markets(self, release_date: str) -> Dict[str, Dict]:
        """
        Fetch NFP markets for a release date.
        
        Returns:
            Dict of {ticker: market_data}
        """
        if self.demo_mode:
            # Return mock data
            return {
                f'KXNF-{release_date}-T100000': {
                    'yes_bid': 65,
                    'yes_ask': 67,
                    'yes_mid': 66,
                    'volume': 150000,
                    'open_interest': 50000
                },
                f'KXNF-{release_date}-T150000': {
                    'yes_bid': 40,
                    'yes_ask': 42,
                    'yes_mid': 41,
                    'volume': 200000,
                    'open_interest': 75000
                },
                f'KXNF-{release_date}-T200000': {
                    'yes_bid': 20,
                    'yes_ask': 22,
                    'yes_mid': 21,
                    'volume': 180000,
                    'open_interest': 60000
                },
                f'KXNF-{release_date}-T250000': {
                    'yes_bid': 8,
                    'yes_ask': 10,
                    'yes_mid': 9,
                    'volume': 100000,
                    'open_interest': 40000
                }
            }
        
        # In production, call Bob's API
        # return kalshi_client.get_markets(series_ticker="KXNF")
        return {}


def generate_nfp_signals(
    predictions: pd.DataFrame,
    release_date: Optional[str] = None,
    demo_mode: bool = True
) -> List[Dict]:
    """
    End-to-end function: predictions -> strategy signals.
    
    This is the main entry point for the integration.
    """
    # Initialize components
    adapter = NFPSignalAdapter()
    market_client = KalshiMarketClient(demo_mode=demo_mode)
    
    # Get market data
    if release_date is None:
        release_date = adapter._get_release_date()
    
    market_data = market_client.get_nfp_markets(release_date)
    
    # Generate signals
    signals = adapter.adapt_for_dave(predictions, market_data)
    
    return signals


def main():
    """Test the signal adapter"""
    from features import load_mock_data
    from features import NFPFeatureEngineer
    from predict import NFPPredictor
    
    print("NFP Signal Adapter Test")
    print("="*60)
    
    # Load data and generate predictions
    data = load_mock_data()
    engineer = NFPFeatureEngineer()
    features, _ = engineer.build_feature_matrix(
        nfp_df=data['nfp'],
        adp_df=data['adp'],
        claims_df=data['claims'],
        ism_df=data['ism'],
        postings_df=data['postings']
    )
    
    predictor = NFPPredictor()
    predictions = predictor.predict(features)
    
    # Generate signals
    signals = generate_nfp_signals(predictions, release_date='260501')
    
    print(f"\nGenerated {len(signals)} signals:")
    print("-"*60)
    
    for signal in signals:
        print(f"\nMarket: {signal['marketId']}")
        print(f"  Direction: {signal['direction']}")
        print(f"  Confidence: {signal['confidence']:.2%}")
        print(f"  Edge: {signal['edge']:.1f} cents")
        print(f"  Price: {signal['price']:.1f} cents")
        print(f"  Metadata: {signal['metadata']}")
    
    # Output as JSON (for piping to Dave's framework)
    print("\n" + "="*60)
    print("JSON Output (for strategy framework):")
    print(json.dumps(signals, indent=2, default=lambda x: float(x) if hasattr(x, 'item') else x))
    
    return signals


if __name__ == '__main__':
    main()
