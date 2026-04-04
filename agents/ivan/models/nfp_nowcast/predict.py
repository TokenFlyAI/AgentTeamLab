"""
NFP Nowcasting Inference

Generate predictions for Kalshi markets.
"""

import pandas as pd
import numpy as np
import pickle
from pathlib import Path
from typing import Dict, List, Optional
import json

from features import NFPFeatureEngineer


class NFPPredictor:
    """Generate NFP predictions for Kalshi markets"""
    
    def __init__(self, models_dir: Optional[Path] = None):
        if models_dir is None:
            models_dir = Path(__file__).parent / 'output'
        self.models_dir = models_dir
        self.models = {}
        self.thresholds = []
        self.feature_engineer = NFPFeatureEngineer()
        
    def load_models(self):
        """Load trained models from disk"""
        model_files = list(self.models_dir.glob('model_threshold_*.pkl'))
        
        for model_file in model_files:
            # Extract threshold from filename
            threshold = int(model_file.stem.split('_')[-1])
            
            with open(model_file, 'rb') as f:
                self.models[threshold] = pickle.load(f)
            
            self.thresholds.append(threshold)
        
        self.thresholds = sorted(self.thresholds)
        print(f"Loaded {len(self.models)} models for thresholds: {self.thresholds}")
        
    def predict(
        self,
        features: pd.DataFrame
    ) -> pd.DataFrame:
        """
        Generate predictions for all thresholds.
        
        Returns:
            DataFrame with columns: [threshold_0_prob, threshold_50000_prob, ...]
        """
        if not self.models:
            self.load_models()
        
        predictions = pd.DataFrame(index=features.index)
        
        for threshold, model in self.models.items():
            col_name = f'threshold_{threshold}_prob'
            predictions[col_name] = model.predict_proba(features)[:, 1]
        
        return predictions
    
    def get_kalshi_signals(
        self,
        predictions: pd.DataFrame,
        market_prices: Optional[Dict[int, float]] = None
    ) -> pd.DataFrame:
        """
        Generate trading signals for Kalshi markets.
        
        Compares model predictions to market prices to find edge.
        
        Args:
            predictions: Output from predict()
            market_prices: Dict of {threshold: market_price} from Kalshi API
        
        Returns:
            DataFrame with signal recommendations
        """
        signals = pd.DataFrame(index=predictions.index)
        
        for threshold in self.thresholds:
            prob_col = f'threshold_{threshold}_prob'
            signal_col = f'threshold_{threshold}_signal'
            edge_col = f'threshold_{threshold}_edge'
            
            model_prob = predictions[prob_col]
            
            if market_prices and threshold in market_prices:
                market_prob = market_prices[threshold]
                edge = model_prob - market_prob
                signals[edge_col] = edge
                
                # Signal: BUY if model > market + threshold, SELL if model < market - threshold
                signals[signal_col] = np.where(
                    edge > 0.05, 'BUY',
                    np.where(edge < -0.05, 'SELL', 'HOLD')
                )
            else:
                # No market price, just show model probability
                signals[edge_col] = 0
                signals[signal_col] = 'NO_MARKET_DATA'
            
            signals[f'threshold_{threshold}_model_prob'] = model_prob
        
        return signals
    
    def format_kalshi_output(
        self,
        signals: pd.DataFrame,
        release_date: str
    ) -> Dict:
        """
        Format output for Kalshi trading system.
        
        Returns:
            Dict with structured recommendations
        """
        latest_signals = signals.iloc[-1]
        
        recommendations = []
        
        for threshold in self.thresholds:
            signal = latest_signals.get(f'threshold_{threshold}_signal', 'HOLD')
            edge = latest_signals.get(f'threshold_{threshold}_edge', 0)
            prob = latest_signals.get(f'threshold_{threshold}_model_prob', 0)
            
            if signal in ['BUY', 'SELL']:
                recommendations.append({
                    'market_ticker': f'KXNF-{release_date.replace("-", "")}-T{threshold}',
                    'threshold': threshold,
                    'signal': signal,
                    'model_probability': round(float(prob), 4),
                    'edge': round(float(edge), 4),
                    'recommended_position': 'YES' if signal == 'BUY' else 'NO',
                    'confidence': 'HIGH' if abs(edge) > 0.1 else 'MEDIUM'
                })
        
        return {
            'release_date': release_date,
            'generated_at': pd.Timestamp.now().isoformat(),
            'n_recommendations': len(recommendations),
            'recommendations': recommendations
        }


def mock_inference_example():
    """Example of running inference with mock data"""
    from features import load_mock_data
    
    print("NFP Nowcasting Inference Example")
    print("="*60)
    
    # Load data
    data = load_mock_data()
    
    # Engineer features
    engineer = NFPFeatureEngineer()
    features, _ = engineer.build_feature_matrix(
        nfp_df=data['nfp'],
        adp_df=data['adp'],
        claims_df=data['claims'],
        ism_df=data['ism'],
        postings_df=data['postings']
    )
    
    # Initialize predictor
    predictor = NFPPredictor()
    
    # Check if models exist
    if not list(predictor.models_dir.glob('model_threshold_*.pkl')):
        print("\nNo trained models found. Run train.py first.")
        return
    
    # Generate predictions
    predictions = predictor.predict(features)
    
    # Mock market prices (would come from Kalshi API)
    mock_market_prices = {
        0: 0.85,      # Market thinks 85% chance NFP > 0
        50000: 0.70,  # 70% chance > 50K
        100000: 0.55, # 55% chance > 100K
        150000: 0.40, # 40% chance > 150K
        200000: 0.25, # 25% chance > 200K
    }
    
    # Generate signals
    signals = predictor.get_kalshi_signals(predictions, mock_market_prices)
    
    # Format output
    output = predictor.format_kalshi_output(signals, '2026-05-01')
    
    print("\nPredictions (latest):")
    print(predictions.iloc[-1])
    
    print("\nSignals (latest):")
    signal_cols = [c for c in signals.columns if '_signal' in c]
    print(signals[signal_cols].iloc[-1])
    
    print("\nKalshi Output:")
    print(json.dumps(output, indent=2))
    
    return output


if __name__ == '__main__':
    mock_inference_example()
