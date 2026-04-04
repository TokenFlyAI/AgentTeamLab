"""
NFP Signal Adapter for Bob's Strategy Framework

Matches Bob's SignalEngine interface exactly.
Reference: Dave's clarification + Bob's signal_engine.js
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime
import json


@dataclass
class BobSignal:
    """
    Signal format matching Bob's SignalEngine exactly.
    
    Reference: agents/bob/backend/strategies/signal_engine.js
    """
    marketId: str           # market UUID or ticker
    side: str              # "yes" | "no" (exactly)
    signalType: str         # "entry" | "exit" | "hold"
    confidence: float       # 0.0 - 1.0 (min 0.3 to pass validation)
    targetPrice: int        # suggested price in cents
    currentPrice: int       # current market price in cents
    expectedEdge: int       # expected profit edge in cents (min 2)
    recommendedContracts: int  # position size suggestion
    reason: str             # human-readable explanation
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'marketId': self.marketId,
            'side': self.side,
            'signalType': self.signalType,
            'confidence': round(self.confidence, 4),
            'targetPrice': self.targetPrice,
            'currentPrice': self.currentPrice,
            'expectedEdge': self.expectedEdge,
            'recommendedContracts': self.recommendedContracts,
            'reason': self.reason
        }
    
    def validate(self) -> List[str]:
        """Validate signal against Bob's rules"""
        errors = []
        
        if self.confidence < 0.3:
            errors.append(f"confidence {self.confidence} < 0.3 minimum")
        
        if self.expectedEdge < 2:
            errors.append(f"expectedEdge {self.expectedEdge} < 2 cent minimum")
        
        if self.side not in ["yes", "no"]:
            errors.append(f"side '{self.side}' must be 'yes' or 'no'")
        
        if self.signalType not in ["entry", "exit", "hold"]:
            errors.append(f"signalType '{self.signalType}' must be 'entry', 'exit', or 'hold'")
        
        return errors


class NFPBobAdapter:
    """
    Adapter that converts NFP model outputs to Bob's SignalEngine format.
    """
    
    def __init__(
        self,
        edge_threshold: int = 5,      # Minimum edge in cents (Bob requires >= 2)
        confidence_threshold: float = 0.55,  # Minimum confidence (Bob requires >= 0.3)
        max_signals: int = 3,
        default_contracts: int = 10   # Default position size
    ):
        self.edge_threshold = edge_threshold
        self.confidence_threshold = confidence_threshold
        self.max_signals = max_signals
        self.default_contracts = default_contracts
        
    def adapt(
        self,
        predictions: pd.DataFrame,
        market_data: Dict[str, Dict]  # ticker -> {yes_bid, yes_ask, yes_mid}
    ) -> List[BobSignal]:
        """
        Convert NFP predictions to Bob's signal format.
        
        Args:
            predictions: DataFrame from NFPPredictor.predict()
            market_data: Dict of market prices from Kalshi API
        
        Returns:
            List of BobSignal objects
        """
        signals = []
        
        # Get latest predictions
        latest = predictions.iloc[-1]
        
        for col in predictions.columns:
            if not col.endswith('_prob'):
                continue
                
            # Extract threshold from column name
            threshold = int(col.split('_')[1])
            model_prob = latest[col]  # 0-1
            
            # Find corresponding market
            market_ticker = f"KXNF-{self._get_release_date()}-T{threshold}"
            
            if market_ticker not in market_data:
                continue
                
            market = market_data[market_ticker]
            current_price = int(market.get('yes_mid', 50))  # cents
            
            # Calculate edge (model - market) in cents
            model_price = int(model_prob * 100)  # Convert to cents
            edge = model_price - current_price
            
            # Determine side and signal type
            if edge >= self.edge_threshold and model_prob >= self.confidence_threshold:
                # Model thinks YES is undervalued
                side = "yes"
                signal_type = "entry"
                confidence = model_prob
                target_price = current_price  # Buy at current price
                
            elif edge <= -self.edge_threshold and (1 - model_prob) >= self.confidence_threshold:
                # Model thinks NO is undervalued (YES overvalued)
                side = "no"
                signal_type = "entry"
                confidence = 1 - model_prob
                edge = abs(edge)  # Edge is positive for signal strength
                target_price = 100 - current_price  # NO price
                
            else:
                continue  # No signal
            
            # Build reason string
            reason = (
                f"NFP nowcast: model prob {model_prob:.0%} vs market {current_price}c "
                f"(threshold: {threshold:,})"
            )
            
            signal = BobSignal(
                marketId=market_ticker,
                side=side,
                signalType=signal_type,
                confidence=confidence,
                targetPrice=target_price,
                currentPrice=current_price,
                expectedEdge=edge,
                recommendedContracts=self.default_contracts,
                reason=reason
            )
            
            # Validate before adding
            errors = signal.validate()
            if not errors:
                signals.append(signal)
            else:
                print(f"Signal validation failed for {market_ticker}: {errors}")
        
        # Sort by expectedEdge (descending) and take top N
        signals.sort(key=lambda s: s.expectedEdge, reverse=True)
        return signals[:self.max_signals]
    
    def adapt_for_bob(
        self,
        predictions: pd.DataFrame,
        market_data: Dict[str, Dict]
    ) -> List[Dict]:
        """
        Generate signals in Bob's exact format (as dicts).
        """
        signals = self.adapt(predictions, market_data)
        return [s.to_dict() for s in signals]
    
    def _get_release_date(self) -> str:
        """Get next NFP release date (simplified)"""
        today = datetime.now()
        if today.month == 12:
            next_month = datetime(today.year + 1, 1, 1)
        else:
            next_month = datetime(today.year, today.month + 1, 1)
        
        from calendar import monthrange
        _, last_day = monthrange(next_month.year, next_month.month)
        for day in range(1, 8):
            date = datetime(next_month.year, next_month.month, day)
            if date.weekday() == 4:  # Friday
                return date.strftime('%y%m%d')
        return '260501'


class NFPNowcastStrategy:
    """
    Strategy class for Bob's framework.
    
    Usage in Bob's server.js:
    ```js
    const { NFPNowcastStrategy } = require("../strategies/strategies/nfp_nowcast");
    strategyRunner.register("nfp_nowcast", new NFPNowcastStrategy());
    ```
    """
    
    def __init__(self, model_path: str = None):
        self.name = "nfp_nowcast"
        self.model_path = model_path
        self.adapter = NFPBobAdapter()
        
        # Load model (placeholder)
        self.predictor = None  # Will be NFPPredictor()
        
    def generate_signal(self, market: Dict) -> Optional[BobSignal]:
        """
        Generate signal for a single market.
        
        Called by Bob's StrategyRunner for each active market.
        
        Args:
            market: Market dict with 'ticker', 'yes_bid', 'yes_ask', etc.
        
        Returns:
            BobSignal or None if no signal
        """
        ticker = market.get('ticker', '')
        
        # Only process NFP markets
        if not ticker.startswith('KXNF'):
            return None
        
        # In production, run model and generate signal
        # For now, return None (placeholder)
        return None
    
    def generate_all_signals(
        self,
        predictions: pd.DataFrame,
        market_data: Dict[str, Dict]
    ) -> List[Dict]:
        """
        Generate all signals for NFP release.
        
        This is the main entry point for the pipeline.
        """
        return self.adapter.adapt_for_bob(predictions, market_data)


def generate_bob_signals(
    predictions: pd.DataFrame,
    release_date: Optional[str] = None,
    demo_mode: bool = True
) -> List[Dict]:
    """
    End-to-end function: predictions -> Bob's signals.
    
    Main entry point for integration.
    """
    adapter = NFPBobAdapter()
    
    # Mock market data (replace with Bob's API)
    market_data = {
        f'KXNF-{adapter._get_release_date()}-T100000': {
            'yes_bid': 65, 'yes_ask': 67, 'yes_mid': 66,
            'volume': 150000, 'open_interest': 50000
        },
        f'KXNF-{adapter._get_release_date()}-T150000': {
            'yes_bid': 40, 'yes_ask': 42, 'yes_mid': 41,
            'volume': 200000, 'open_interest': 75000
        },
        f'KXNF-{adapter._get_release_date()}-T200000': {
            'yes_bid': 20, 'yes_ask': 22, 'yes_mid': 21,
            'volume': 180000, 'open_interest': 60000
        },
        f'KXNF-{adapter._get_release_date()}-T250000': {
            'yes_bid': 8, 'yes_ask': 10, 'yes_mid': 9,
            'volume': 100000, 'open_interest': 40000
        }
    }
    
    return adapter.adapt_for_bob(predictions, market_data)


def main():
    """Test the Bob adapter"""
    from features import load_mock_data, NFPFeatureEngineer
    from predict import NFPPredictor
    
    print("NFP Bob Signal Adapter Test")
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
    
    # Generate Bob-format signals
    signals = generate_bob_signals(predictions)
    
    print(f"\nGenerated {len(signals)} signals:")
    print("-"*60)
    
    for signal in signals:
        print(f"\nMarket: {signal['marketId']}")
        print(f"  Side: {signal['side']}")
        print(f"  Signal Type: {signal['signalType']}")
        print(f"  Confidence: {signal['confidence']:.2%}")
        print(f"  Expected Edge: {signal['expectedEdge']} cents")
        print(f"  Target Price: {signal['targetPrice']} cents")
        print(f"  Recommended Contracts: {signal['recommendedContracts']}")
        print(f"  Reason: {signal['reason']}")
        
        # Validate
        bs = BobSignal(**signal)
        errors = bs.validate()
        if errors:
            print(f"  ⚠️ Validation errors: {errors}")
        else:
            print(f"  ✅ Valid signal")
    
    # Output as JSON
    print("\n" + "="*60)
    print("JSON Output (for Bob's strategy framework):")
    print(json.dumps(signals, indent=2, default=lambda x: float(x) if hasattr(x, 'item') else x))
    
    return signals


if __name__ == '__main__':
    main()
