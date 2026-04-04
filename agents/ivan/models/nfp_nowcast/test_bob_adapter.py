"""
Test Bob's SignalEngine format compliance
"""

import sys
sys.path.insert(0, str(__file__).rsplit('/', 1)[0])

from bob_signal_adapter import BobSignal, NFPBobAdapter, generate_bob_signals
from features import load_mock_data, NFPFeatureEngineer
from predict import NFPPredictor
import json


def test_bob_format():
    """Test signals match Bob's SignalEngine format exactly"""
    print("\n[Test] Bob's SignalEngine Format Compliance")
    print("-"*60)
    
    # Generate signals
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
    signals = generate_bob_signals(predictions)
    
    assert len(signals) > 0, "No signals generated"
    
    # Required fields per Bob's spec
    required = ['marketId', 'side', 'signalType', 'confidence', 
                'targetPrice', 'currentPrice', 'expectedEdge', 
                'recommendedContracts', 'reason']
    
    passed = 0
    for signal in signals:
        # Check all required fields
        missing = [f for f in required if f not in signal]
        assert not missing, f"Missing fields: {missing}"
        
        # Validate types
        assert isinstance(signal['marketId'], str)
        assert signal['side'] in ['yes', 'no'], f"side must be 'yes' or 'no', got {signal['side']}"
        assert signal['signalType'] in ['entry', 'exit', 'hold']
        assert isinstance(signal['confidence'], (int, float))
        assert isinstance(signal['targetPrice'], int)
        assert isinstance(signal['currentPrice'], int)
        assert isinstance(signal['expectedEdge'], int)
        assert isinstance(signal['recommendedContracts'], int)
        assert isinstance(signal['reason'], str)
        
        # Validate ranges (Bob's rules)
        assert signal['confidence'] >= 0.3, f"confidence {signal['confidence']} < 0.3"
        assert signal['expectedEdge'] >= 2, f"expectedEdge {signal['expectedEdge']} < 2"
        
        # Validate via BobSignal class
        bs = BobSignal(**signal)
        errors = bs.validate()
        assert not errors, f"Validation errors: {errors}"
        
        passed += 1
        print(f"  ✅ {signal['marketId']}: {signal['side']} (edge: {signal['expectedEdge']}c)")
    
    print(f"\n  All {passed} signals pass Bob's validation")
    return True


def test_json_serialization():
    """Test signals can be serialized to JSON"""
    print("\n[Test] JSON Serialization")
    print("-"*60)
    
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
    signals = generate_bob_signals(predictions)
    
    try:
        json_str = json.dumps(signals, indent=2, 
                             default=lambda x: float(x) if hasattr(x, 'item') else x)
        parsed = json.loads(json_str)
        assert len(parsed) == len(signals)
        print(f"  ✅ JSON round-trip successful ({len(json_str)} bytes)")
        return True
    except Exception as e:
        print(f"  ❌ JSON failed: {e}")
        return False


def main():
    print("="*60)
    print("Bob SignalEngine Adapter Tests")
    print("="*60)
    
    tests = [
        ("Bob Format Compliance", test_bob_format),
        ("JSON Serialization", test_json_serialization),
    ]
    
    results = []
    for name, test_fn in tests:
        try:
            test_fn()
            results.append((name, True))
        except AssertionError as e:
            print(f"\n  ❌ {name} failed: {e}")
            results.append((name, False))
        except Exception as e:
            print(f"\n  ❌ {name} error: {e}")
            results.append((name, False))
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {status}: {name}")
    
    passed = sum(1 for _, p in results if p)
    total = len(results)
    print(f"\n  Result: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 Bob adapter ready for integration!")
    
    return passed == total


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
