"""
End-to-End Integration Test for NFP Nowcasting Pipeline

Tests: pipeline → model → signal → strategy framework format
"""

import sys
from pathlib import Path
import json
import numpy as np

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from features import load_mock_data, NFPFeatureEngineer
from predict import NFPPredictor
from signal_adapter import generate_nfp_signals, NFPSignalAdapter, KalshiMarketClient


def test_feature_engineering():
    """Test 1: Feature engineering produces valid output"""
    print("\n[Test 1] Feature Engineering...")
    
    data = load_mock_data()
    engineer = NFPFeatureEngineer()
    features, targets = engineer.build_feature_matrix(
        nfp_df=data['nfp'],
        adp_df=data['adp'],
        claims_df=data['claims'],
        ism_df=data['ism'],
        postings_df=data['postings']
    )
    
    assert features.shape[0] > 0, "No feature rows generated"
    assert features.shape[1] == 15, f"Expected 15 features, got {features.shape[1]}"
    assert not features.isnull().values.any(), "Features contain NaN values"
    
    print(f"  ✅ Features: {features.shape}")
    print(f"  ✅ Targets: {targets.shape}")
    return features, targets


def test_model_prediction(features):
    """Test 2: Model generates predictions"""
    print("\n[Test 2] Model Prediction...")
    
    predictor = NFPPredictor()
    predictions = predictor.predict(features)
    
    assert predictions.shape[0] > 0, "No predictions generated"
    assert all(col.endswith('_prob') for col in predictions.columns), "Invalid prediction columns"
    assert (predictions >= 0).all().all() and (predictions <= 1).all().all(), "Probabilities out of range"
    
    print(f"  ✅ Predictions: {predictions.shape}")
    print(f"  ✅ Thresholds: {[c for c in predictions.columns]}")
    return predictions


def test_signal_generation(predictions):
    """Test 3: Signal adapter generates valid signals"""
    print("\n[Test 3] Signal Generation...")
    
    signals = generate_nfp_signals(predictions, release_date='260501')
    
    assert isinstance(signals, list), "Signals should be a list"
    assert len(signals) > 0, "No signals generated"
    
    for signal in signals:
        # Required fields
        required = ['marketId', 'direction', 'confidence', 'edge', 'price', 'strategy', 'timestamp']
        for field in required:
            assert field in signal, f"Missing required field: {field}"
        
        # Valid direction
        assert signal['direction'] in ['buy_yes', 'sell_yes', 'buy_no', 'sell_no'], \
            f"Invalid direction: {signal['direction']}"
        
        # Valid ranges
        assert 0 <= signal['confidence'] <= 1, "Confidence out of range"
        assert 0 <= signal['edge'] <= 100, "Edge out of range"
        assert 0 <= signal['price'] <= 100, "Price out of range"
        
        # Dave's strategy name
        assert signal['strategy'] == 'nfp_nowcast', "Wrong strategy name"
    
    print(f"  ✅ Signals generated: {len(signals)}")
    for s in signals:
        print(f"     {s['marketId']}: {s['direction']} (edge: {s['edge']:.1f}c)")
    
    return signals


def test_dave_format_compliance(signals):
    """Test 4: Signals match Dave's strategy framework interface"""
    print("\n[Test 4] Dave's Framework Format Compliance...")
    
    # Expected interface from Dave's design doc:
    # {
    #   marketId: string,
    #   direction: "buy_yes" | "sell_yes" | "buy_no" | "sell_no",
    #   confidence: number,   // 0-1
    #   edge: number,         // in cents (0-100)
    #   price: number,        // current price in cents
    #   strategy: string,
    #   timestamp: Date,
    #   metadata?: object
    # }
    
    for signal in signals:
        # Type checks (handle numpy types)
        assert isinstance(signal['marketId'], str), "marketId must be string"
        assert isinstance(signal['direction'], str), "direction must be string"
        assert isinstance(signal['confidence'], (int, float, np.floating)), "confidence must be number"
        assert isinstance(signal['edge'], (int, float, np.floating)), "edge must be number"
        assert isinstance(signal['price'], (int, float, np.floating)), "price must be number"
        assert isinstance(signal['strategy'], str), "strategy must be string"
        assert isinstance(signal['timestamp'], str), "timestamp must be string"
        assert isinstance(signal['metadata'], dict), "metadata must be object"
    
    print(f"  ✅ All {len(signals)} signals match Dave's interface")
    return True


def test_json_serialization(signals):
    """Test 5: Signals can be serialized to JSON"""
    print("\n[Test 5] JSON Serialization...")
    
    try:
        json_output = json.dumps(signals, indent=2, default=lambda x: float(x) if hasattr(x, 'item') else x)
        parsed = json.loads(json_output)
        assert len(parsed) == len(signals), "JSON round-trip failed"
        print(f"  ✅ JSON serialization successful ({len(json_output)} bytes)")
        return True
    except Exception as e:
        print(f"  ❌ JSON serialization failed: {e}")
        return False


def test_market_client():
    """Test 6: Market client fetches data"""
    print("\n[Test 6] Kalshi Market Client...")
    
    client = KalshiMarketClient(demo_mode=True)
    markets = client.get_nfp_markets('260501')
    
    assert len(markets) > 0, "No markets fetched"
    
    for ticker, data in markets.items():
        assert 'yes_bid' in data or 'yes_mid' in data, f"Missing price data for {ticker}"
    
    print(f"  ✅ Markets fetched: {len(markets)}")
    for ticker in markets:
        print(f"     {ticker}")
    
    return markets


def test_edge_calculation():
    """Test 7: Edge calculation is correct"""
    print("\n[Test 7] Edge Calculation...")
    
    adapter = NFPSignalAdapter(edge_threshold=5.0)
    
    # Test case: Model says 70%, market says 60% → 10 cent edge
    model_prob = 0.70
    market_price = 60  # cents
    edge = (model_prob * 100) - market_price
    
    assert edge == 10.0, f"Edge calculation wrong: expected 10, got {edge}"
    
    # Should generate buy_yes signal
    assert edge > adapter.edge_threshold, "Edge should exceed threshold"
    
    print(f"  ✅ Edge calculation correct: {edge:.1f} cents")
    return True


def run_all_tests():
    """Run full integration test suite"""
    print("="*60)
    print("NFP Nowcasting Integration Test Suite")
    print("="*60)
    
    tests = []
    
    try:
        # Test 1: Feature engineering
        features, targets = test_feature_engineering()
        tests.append(("Feature Engineering", True))
        
        # Test 2: Model prediction
        predictions = test_model_prediction(features)
        tests.append(("Model Prediction", True))
        
        # Test 3: Signal generation
        signals = test_signal_generation(predictions)
        tests.append(("Signal Generation", True))
        
        # Test 4: Dave's format compliance
        test_dave_format_compliance(signals)
        tests.append(("Dave's Format", True))
        
        # Test 5: JSON serialization
        test_json_serialization(signals)
        tests.append(("JSON Serialization", True))
        
        # Test 6: Market client
        test_market_client()
        tests.append(("Market Client", True))
        
        # Test 7: Edge calculation
        test_edge_calculation()
        tests.append(("Edge Calculation", True))
        
    except AssertionError as e:
        tests.append(("Test Failed", False, str(e)))
        print(f"\n❌ Test failed: {e}")
        return False
    except Exception as e:
        tests.append(("Error", False, str(e)))
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    
    passed = sum(1 for t in tests if t[1])
    total = len(tests)
    
    for name, result, *args in tests:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}: {name}")
        if not result and args:
            print(f"      {args[0]}")
    
    print("-"*60)
    print(f"Result: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All integration tests passed!")
        print("\nThe NFP pipeline is ready for:")
        print("  - Grace's real data pipeline integration")
        print("  - Bob's Kalshi API client integration")
        print("  - Dave's strategy framework integration")
        return True
    else:
        print("\n⚠️ Some tests failed. Review errors above.")
        return False


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
