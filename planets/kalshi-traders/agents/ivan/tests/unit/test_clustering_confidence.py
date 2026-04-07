#!/usr/bin/env python3
"""Unit tests for T575 clustering confidence scores and stability metrics."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'output'))

from llm_market_clustering import (
    Market, Cluster, compute_volatility, compute_sentiment,
    embed_market, cosine_similarity, cluster_markets, load_markets,
    compute_cluster_confidence, compute_cluster_stability,
    cross_validate_with_grace
)


def make_market(ticker, title, category, volume=100000, yes_ratio=50,
                yes_bid=45, yes_ask=55, no_bid=45, no_ask=55):
    m = Market(ticker=ticker, title=title, category=category, volume=volume,
               yes_bid=yes_bid, yes_ask=yes_ask, no_bid=no_bid, no_ask=no_ask,
               yes_ratio=yes_ratio)
    m.volatility = compute_volatility(m)
    m.sentiment, m.news_sentiment_label = compute_sentiment(m)
    return m


def test_confidence_range():
    """Confidence scores should be in [0, 1]."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 80),
        make_market("BTC2", "Bitcoin above 100K", "Crypto", 400000, 25),
        make_market("ETH1", "Ethereum above 5K", "Crypto", 300000, 30),
        make_market("SP1", "S&P above 6000", "Economics", 200000, 75),
        make_market("SP2", "S&P above 7000", "Economics", 150000, 20),
    ]
    clusters = cluster_markets(markets, threshold=0.5)
    for c in clusters:
        assert 0.0 <= c.confidence <= 1.0, f"Confidence {c.confidence} out of range for {c.id}"
    print("PASS: confidence_range")


def test_stability_range():
    """Stability scores should be in [0, 1]."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 80),
        make_market("BTC2", "Bitcoin above 100K", "Crypto", 400000, 25),
        make_market("ETH1", "Ethereum above 5K", "Crypto", 300000, 30),
    ]
    clusters = cluster_markets(markets, threshold=0.5)
    for c in clusters:
        assert 0.0 <= c.stability <= 1.0, f"Stability {c.stability} out of range for {c.id}"
    print("PASS: stability_range")


def test_singleton_zero_confidence():
    """Singletons should have 0 confidence."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 80),
        make_market("TEMP1", "July hottest month", "Climate", 80000, 30),
    ]
    clusters = cluster_markets(markets, threshold=0.9)  # high threshold → singletons
    singletons = [c for c in clusters if len(c.markets) == 1]
    for c in singletons:
        assert c.confidence == 0.0, f"Singleton {c.id} has non-zero confidence: {c.confidence}"
    print("PASS: singleton_zero_confidence")


def test_tight_cluster_high_confidence():
    """A cluster of very similar markets should have high confidence."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 80),
        make_market("BTC2", "Bitcoin above 100K", "Crypto", 450000, 25),
        make_market("BTC3", "Bitcoin above 120K", "Crypto", 400000, 22),
    ]
    clusters = cluster_markets(markets, threshold=0.5)
    multi = [c for c in clusters if len(c.markets) >= 2]
    assert len(multi) >= 1, "Expected at least 1 cluster"
    assert multi[0].confidence > 0.5, f"Tight cluster confidence too low: {multi[0].confidence}"
    print("PASS: tight_cluster_high_confidence")


def test_stability_leave_one_out():
    """Stable cluster should survive leave-one-out."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 80),
        make_market("BTC2", "Bitcoin above 100K", "Crypto", 450000, 25),
        make_market("ETH1", "Ethereum above 5K", "Crypto", 300000, 30),
    ]
    clusters = cluster_markets(markets, threshold=0.5)
    multi = [c for c in clusters if len(c.markets) >= 2]
    assert len(multi) >= 1, "Expected at least 1 cluster"
    assert multi[0].stability > 0.5, f"Stable cluster has low stability: {multi[0].stability}"
    print("PASS: stability_leave_one_out")


def test_cross_validate_no_warnings():
    """Cross-validation on clean data should produce no warnings about excluded markets."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 25),
        make_market("BTC2", "Bitcoin above 100K", "Crypto", 400000, 22),
    ]
    clusters = cluster_markets(markets, threshold=0.5)
    data = {"qualifying_markets": [], "excluded_markets": []}
    result = cross_validate_with_grace(markets, clusters, data)
    excluded_warnings = [w for w in result["warnings"] if "excluded market" in w]
    assert len(excluded_warnings) == 0, f"Unexpected excluded warnings: {excluded_warnings}"
    print("PASS: cross_validate_no_warnings")


def test_cross_validate_detects_excluded():
    """Cross-validation should flag if a clustered market was in Grace's excluded list."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 25),
        make_market("BAD1", "Bitcoin above 100K", "Crypto", 400000, 22),
    ]
    clusters = cluster_markets(markets, threshold=0.5)
    data = {
        "qualifying_markets": [],
        "excluded_markets": [{"ticker": "BAD1", "reason": "middle_range_excluded"}]
    }
    result = cross_validate_with_grace(markets, clusters, data)
    assert not result["all_passed_ratio_filter"], "Should flag ratio filter failure"
    print("PASS: cross_validate_detects_excluded")


def test_cluster_output_has_new_fields():
    """Cluster output JSON should include confidence, stability, cohesion, separation."""
    markets = [
        make_market("BTC1", "Bitcoin above 80K", "Crypto", 500000, 80),
        make_market("BTC2", "Bitcoin above 100K", "Crypto", 400000, 25),
    ]
    clusters = cluster_markets(markets, threshold=0.5)
    multi = [c for c in clusters if len(c.markets) >= 2]
    assert len(multi) >= 1
    c = multi[0]
    assert hasattr(c, 'confidence'), "Missing confidence field"
    assert hasattr(c, 'stability'), "Missing stability field"
    assert hasattr(c, 'cohesion'), "Missing cohesion field"
    assert hasattr(c, 'separation'), "Missing separation field"
    print("PASS: cluster_output_has_new_fields")


if __name__ == '__main__':
    test_confidence_range()
    test_stability_range()
    test_singleton_zero_confidence()
    test_tight_cluster_high_confidence()
    test_stability_leave_one_out()
    test_cross_validate_no_warnings()
    test_cross_validate_detects_excluded()
    test_cluster_output_has_new_fields()
    print("\nAll 8 tests PASSED ✓")
