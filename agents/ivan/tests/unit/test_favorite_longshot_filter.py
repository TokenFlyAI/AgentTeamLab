#!/usr/bin/env python3
"""
Unit Tests for Favorite-Longshot Bias Filter

Task: T415
Coverage: Price bucketing, bias scoring, signal generation,
          edge thresholds, boundary conditions, JSON output.
"""

import sys
import os
import json
import tempfile

# Add project root to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../..", "output"))

from favorite_longshot_filter import (
    Market,
    BiasOpportunity,
    FavoriteLongshotFilter,
    fetch_mock_markets,
)


# Test runner
TESTS_RUN = 0
TESTS_PASSED = 0


def test(name, fn):
    global TESTS_RUN, TESTS_PASSED
    TESTS_RUN += 1
    try:
        fn()
        TESTS_PASSED += 1
        print(f"✅ {name}")
    except AssertionError as e:
        print(f"❌ {name}")
        print(f"   AssertionError: {e}")
    except Exception as e:
        print(f"❌ {name}")
        print(f"   Error: {e}")


# ==================== Price Bucketing Tests ====================

print("\n📊 Price Bucketing Tests\n")


def test_bucket_boundaries():
    flf = FavoriteLongshotFilter()
    assert flf.get_price_bucket(5) == "1-10c"
    assert flf.get_price_bucket(10) == "1-10c"
    assert flf.get_price_bucket(11) == "11-20c"
    assert flf.get_price_bucket(20) == "11-20c"
    assert flf.get_price_bucket(21) == "21-30c"
    assert flf.get_price_bucket(50) == "41-50c"
    assert flf.get_price_bucket(51) == "51-60c"
    assert flf.get_price_bucket(90) == "81-90c"
    assert flf.get_price_bucket(91) == "91-99c"
    assert flf.get_price_bucket(99) == "91-99c"


test("Price buckets map correctly at boundaries", test_bucket_boundaries)


# ==================== Bias Scoring Tests ====================

print("\n📈 Bias Scoring Tests\n")


def test_favorite_buy_signal():
    flf = FavoriteLongshotFilter()
    market = Market(
        ticker="KXTEST-01",
        title="Test Favorite",
        category="crypto",
        yes_bid=93,
        yes_ask=95,
        volume=100000,
    )
    opp = flf.score_market(market)
    assert opp.action == "BUY_YES", f"Expected BUY_YES, got {opp.action}"
    assert opp.price_bucket == "91-99c"
    assert opp.bias_score > 0


def test_longshot_sell_signal():
    flf = FavoriteLongshotFilter()
    market = Market(
        ticker="KXTEST-02",
        title="Test Longshot",
        category="economics",
        yes_bid=4,
        yes_ask=6,
        volume=10000,
    )
    opp = flf.score_market(market)
    assert opp.action == "BUY_NO", f"Expected BUY_NO, got {opp.action}"
    assert opp.price_bucket == "1-10c"
    assert opp.bias_score < 0


def test_no_signal_middle_range():
    flf = FavoriteLongshotFilter()
    market = Market(
        ticker="KXTEST-03",
        title="Test Neutral",
        category="politics",
        yes_bid=45,
        yes_ask=47,
        volume=50000,
    )
    opp = flf.score_market(market)
    assert opp.action == "NO_SIGNAL", f"Expected NO_SIGNAL, got {opp.action}"


def test_edge_threshold_favorite():
    flf = FavoriteLongshotFilter()
    # 89c -> 89.5 mid, bucket 81-90c, historical 0.855, calibration +0.010
    # bias = 0.855 - 0.895 + 0.010 = -0.03 -> no signal (not enough positive bias)
    market = Market(
        ticker="KXTEST-04",
        title="Borderline Favorite",
        category="finance",
        yes_bid=88,
        yes_ask=90,
        volume=30000,
    )
    opp = flf.score_market(market)
    # 89.5c is in 81-90c bucket, bias is slightly negative so no BUY_YES
    assert opp.action != "BUY_YES" or opp.edge_pct >= flf.FAVORITE_BUY_THRESHOLD


def test_edge_threshold_longshot():
    flf = FavoriteLongshotFilter()
    # 15c -> 15 mid, bucket 11-20c, historical 0.145, calibration -0.010
    # bias = 0.145 - 0.15 - 0.010 = -0.015 -> may not clear 2% threshold
    market = Market(
        ticker="KXTEST-05",
        title="Borderline Longshot",
        category="weather",
        yes_bid=14,
        yes_ask=16,
        volume=8000,
    )
    opp = flf.score_market(market)
    if opp.action == "BUY_NO":
        assert opp.edge_pct >= flf.LONGSHOT_SELL_THRESHOLD


test("Favorite market generates BUY_YES signal", test_favorite_buy_signal)
test("Longshot market generates BUY_NO signal", test_longshot_sell_signal)
test("Middle-range market generates NO_SIGNAL", test_no_signal_middle_range)
test("Edge threshold respected for favorites", test_edge_threshold_favorite)
test("Edge threshold respected for longshots", test_edge_threshold_longshot)


# ==================== Filter & Output Tests ====================

print("\n🗂️  Filter & Output Tests\n")


def test_filter_returns_only_signals():
    flf = FavoriteLongshotFilter()
    markets = [
        Market(ticker="A", title="A", category="crypto", yes_bid=93, yes_ask=95, volume=1000),
        Market(ticker="B", title="B", category="politics", yes_bid=45, yes_ask=47, volume=1000),
        Market(ticker="C", title="C", category="economics", yes_bid=4, yes_ask=6, volume=1000),
    ]
    opportunities = flf.filter_markets(markets)
    for opp in opportunities:
        assert opp.action in ("BUY_YES", "BUY_NO")
    assert len(opportunities) >= 2  # A and C should signal


def test_json_output_structure():
    flf = FavoriteLongshotFilter()
    markets = fetch_mock_markets()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        temp_path = f.name
    try:
        result = flf.run(markets, temp_path)
        assert "generated_at" in result
        assert "markets_scanned" in result
        assert "opportunities_found" in result
        assert "all_scored" in result
        assert "opportunities" in result
        assert result["markets_scanned"] == len(markets)

        with open(temp_path, "r") as f:
            loaded = json.load(f)
        assert loaded["markets_scanned"] == len(markets)
        assert isinstance(loaded["opportunities"], list)
    finally:
        os.remove(temp_path)


def test_mock_markets_coverage():
    markets = fetch_mock_markets()
    assert len(markets) >= 5
    categories = {m.category for m in markets}
    assert len(categories) >= 3
    # Should have at least one favorite and one longshot
    favorites = [m for m in markets if m.yes_mid >= 90]
    longshots = [m for m in markets if m.yes_mid <= 10]
    assert len(favorites) >= 1
    assert len(longshots) >= 1


test("Filter returns only actionable signals", test_filter_returns_only_signals)
test("JSON output has correct structure", test_json_output_structure)
test("Mock markets provide good coverage", test_mock_markets_coverage)


# ==================== Summary ====================

print(f"\n{'='*50}")
print(f"Tests run: {TESTS_RUN}")
print(f"Tests passed: {TESTS_PASSED}")
print(f"Tests failed: {TESTS_RUN - TESTS_PASSED}")

if TESTS_PASSED < TESTS_RUN:
    sys.exit(1)
else:
    print("\n🎉 All tests passed!")
    sys.exit(0)
