#!/usr/bin/env python3
"""
Integration Test: NFP Pipeline → Model → Signal → Strategy Framework

Validates the full end-to-end flow:
1. Grace's data pipeline produces features
2. Ivan's model generates predictions
3. Signal adapter outputs Dave/Bob-compatible signals
4. Signals pass validation checks
"""

import os
import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path

from data_bridge import load_grace_data, align_to_monthly
from signal_adapter import NFPSignalAdapter


def test_data_pipeline():
    """Test 1: Grace's data pipeline produces non-empty aligned data."""
    data = load_grace_data()
    data = align_to_monthly(data)

    assert not data["nfp"].empty, "NFP data is empty"
    assert not data["claims"].empty, "Claims data is empty"
    assert not data["adp"].empty, "ADP data is empty"
    assert not data["ism"].empty, "ISM data is empty"
    assert not data["postings"].empty, "Job postings data is empty"

    print("[PASS] Data pipeline produces aligned monthly data")
    return True


def test_feature_engineering():
    """Test 2: Ivan's feature engineer produces non-empty features."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path("../../ivan/models/nfp_nowcast").resolve()))
    from features import NFPFeatureEngineer

    data = load_grace_data()
    data = align_to_monthly(data)

    engineer = NFPFeatureEngineer()
    features, targets = engineer.build_feature_matrix(
        nfp_df=data["nfp"],
        adp_df=data["adp"],
        claims_df=data["claims"],
        ism_df=data["ism"],
        postings_df=data["postings"],
    )

    assert not features.empty, "Feature matrix is empty"
    assert features.shape[0] >= 12, f"Only {features.shape[0]} feature rows, need >= 12"
    assert len(engineer.feature_names) > 0, "No feature columns generated"

    print(f"[PASS] Feature engineering: {features.shape[0]} rows x {features.shape[1]} cols")
    return True


def test_model_inference():
    """Test 3: Ivan's model loads and produces predictions."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path("../../ivan/models/nfp_nowcast").resolve()))
    from features import NFPFeatureEngineer
    from predict import NFPPredictor

    data = load_grace_data()
    data = align_to_monthly(data)

    engineer = NFPFeatureEngineer()
    features, _ = engineer.build_feature_matrix(
        nfp_df=data["nfp"],
        adp_df=data["adp"],
        claims_df=data["claims"],
        ism_df=data["ism"],
        postings_df=data["postings"],
    )

    predictor = NFPPredictor(models_dir=Path("../../ivan/models/nfp_nowcast/output").resolve())
    predictor.load_models()

    assert len(predictor.models) > 0, "No models loaded"

    predictions = predictor.predict(features)
    assert not predictions.empty, "Predictions are empty"
    assert predictions.shape[1] == len(predictor.thresholds), "Prediction columns mismatch"

    print(f"[PASS] Model inference: {predictions.shape[1]} thresholds predicted")
    return True


def test_signal_adapter():
    """Test 4: Signal adapter outputs valid Dave/Bob signals."""
    from signal_adapter import convert_to_dave_signal, convert_to_bob_signal

    # Test with a controlled recommendation to guarantee structure validation
    rec = {
        "market_ticker": "KXNF-20260501-T100000",
        "threshold": 100000,
        "signal": "BUY",
        "model_probability": 0.85,
        "edge": 0.10,
        "recommended_position": "YES",
        "confidence": "HIGH",
    }

    dave = convert_to_dave_signal(rec, 0.75, "2026-05-01")
    assert dave["direction"] == "buy_yes"
    assert 0 <= dave["confidence"] <= 1
    assert -100 <= dave["edge"] <= 100

    bob = convert_to_bob_signal(rec, 0.75, "2026-05-01")
    assert bob["side"] == "yes"
    assert bob["signalType"] == "entry"
    assert bob["recommendedContracts"] > 0
    assert "riskAmount" in bob

    # Also run full adapter to ensure it doesn't crash
    adapter = NFPSignalAdapter(
        models_dir=Path("../../ivan/models/nfp_nowcast/output").resolve(),
        use_live_prices=False,
    )
    result = adapter.generate_signals("2026-05-01")
    assert result["status"] == "success"
    assert "dave_signals" in result
    assert "bob_signals" in result

    print(f"[PASS] Signal adapter: converters valid, full adapter success ({result['n_recommendations']} signals)")
    return True


def test_end_to_end_json_roundtrip():
    """Test 5: Full result can be serialized to JSON (strategy framework consumption)."""
    adapter = NFPSignalAdapter(
        models_dir=Path("../../ivan/models/nfp_nowcast/output").resolve(),
        use_live_prices=False,
    )
    result = adapter.generate_signals("2026-05-01")

    try:
        serialized = json.dumps(result, indent=2, default=str)
        assert len(serialized) > 0, "Serialized JSON is empty"
    except Exception as e:
        raise AssertionError(f"JSON serialization failed: {e}")

    print("[PASS] JSON roundtrip: full result serializable")
    return True


def test_file_output():
    """Test 6: signal_adapter.py writes valid JSON to a file."""
    import tempfile
    import subprocess

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        tmp_path = f.name

    try:
        result = subprocess.run(
            [sys.executable, "signal_adapter.py", "--release-date", "2026-05-01", "--output", tmp_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"signal_adapter.py failed: {result.stderr}"
        with open(tmp_path, "r") as f:
            data = json.load(f)
        assert data["status"] == "success", "File output status not success"
        assert "dave_signals" in data, "Missing dave_signals in file output"
        assert "bob_signals" in data, "Missing bob_signals in file output"
    finally:
        os.unlink(tmp_path)

    print("[PASS] File output: signal_adapter writes valid JSON to file")
    return True


def run_all_tests():
    print("=" * 60)
    print("NFP Nowcasting Integration Tests")
    print("=" * 60)

    tests = [
        test_data_pipeline,
        test_feature_engineering,
        test_model_inference,
        test_signal_adapter,
        test_end_to_end_json_roundtrip,
        test_file_output,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"[FAIL] {test.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"[ERROR] {test.__name__}: {e}")
            failed += 1

    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)

    if failed > 0:
        sys.exit(1)
    else:
        print("All integration tests passed.")


if __name__ == "__main__":
    run_all_tests()
