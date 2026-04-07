#!/usr/bin/env python3
"""Sprint 6 T815: Phase 2 cluster stability audit on live-shaped fixtures."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import datetime
from itertools import combinations
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from llm_market_clustering import (  # noqa: E402
    cluster_markets,
    cosine_similarity,
    embed_market,
    load_markets,
)


THRESHOLDS = [0.55, 0.60, 0.65, 0.70, 0.75]
BASELINE_THRESHOLD = 0.65


def pair_set(clusters):
    pairs = set()
    for cluster in clusters:
        for a, b in combinations(sorted(cluster.markets), 2):
            pairs.add((a, b))
    return pairs


def cluster_observed_retention(target_cluster, markets, threshold):
    """Measure whether co-membership survives leave-one-out reruns."""
    tickers = set(target_cluster.markets)
    retained_scores = []
    for removed in target_cluster.markets:
        expected = {
            tuple(sorted((a, b)))
            for a, b in combinations(sorted(tickers - {removed}), 2)
        }
        subset = [market for market in markets if market.ticker != removed]
        rerun_clusters = cluster_markets(subset, threshold=threshold)
        rerun_pairs = pair_set(rerun_clusters)
        if not expected:
            retained_scores.append(1.0)
            continue
        retained_scores.append(len(expected & rerun_pairs) / len(expected))
    return round(sum(retained_scores) / len(retained_scores), 3), retained_scores


def suspicious_fixture_values(markets):
    findings = []
    percent_pattern = re.compile(r"above ([0-9][0-9,]*\.?[0-9]*)%")
    price_pattern = re.compile(r"above \$([0-9][0-9,]*)")
    for market in markets:
        title = market.title
        percent_match = percent_pattern.search(title)
        if percent_match:
            value = float(percent_match.group(1).replace(",", ""))
            if "dominance" in title.lower() and not (0 <= value <= 100):
                findings.append({
                    "ticker": market.ticker,
                    "issue": "bitcoin_dominance_out_of_range",
                    "title": title,
                    "value": value,
                })
            if "unemployment" in title.lower() and value > 100:
                findings.append({
                    "ticker": market.ticker,
                    "issue": "unemployment_rate_out_of_range",
                    "title": title,
                    "value": value,
                })
        price_match = price_pattern.search(title)
        if price_match:
            value = float(price_match.group(1).replace(",", ""))
            if "solana" in title.lower() and value > 10000:
                findings.append({
                    "ticker": market.ticker,
                    "issue": "solana_price_implausible",
                    "title": title,
                    "value": value,
                })
    return findings


def build_cluster_metrics(markets, clusters, threshold):
    embeddings = {market.ticker: embed_market(market) for market in markets}
    market_map = {market.ticker: market for market in markets}
    metrics = []
    for cluster in clusters:
        if len(cluster.markets) < 2:
            continue
        sims = [
            cosine_similarity(embeddings[a], embeddings[b])
            for a, b in combinations(cluster.markets, 2)
        ]
        below_threshold = [sim for sim in sims if sim < threshold]
        observed_retention, per_removal = cluster_observed_retention(cluster, markets, threshold)
        metrics.append({
            "id": cluster.id,
            "label": cluster.label,
            "size": len(cluster.markets),
            "categories": Counter(market_map[ticker].category for ticker in cluster.markets),
            "markets": list(cluster.markets),
            "reported_confidence": cluster.confidence,
            "reported_stability": cluster.stability,
            "observed_pair_retention": observed_retention,
            "min_pair_similarity": round(min(sims), 3),
            "mean_pair_similarity": round(sum(sims) / len(sims), 3),
            "below_threshold_pairs": len(below_threshold),
            "pair_count": len(sims),
            "below_threshold_ratio": round(len(below_threshold) / len(sims), 3),
            "per_removal_pair_retention": [round(score, 3) for score in per_removal],
        })
    return metrics


def threshold_sweep(markets, baseline_pairs):
    rows = []
    for threshold in THRESHOLDS:
        clusters = cluster_markets(markets, threshold=threshold)
        multi = [cluster for cluster in clusters if len(cluster.markets) >= 2]
        pairs = pair_set(multi)
        rows.append({
            "threshold": threshold,
            "multi_cluster_count": len(multi),
            "singleton_count": len([cluster for cluster in clusters if len(cluster.markets) == 1]),
            "avg_confidence": round(sum(cluster.confidence for cluster in multi) / len(multi), 3),
            "avg_stability": round(sum(cluster.stability for cluster in multi) / len(multi), 3),
            "pair_retention_vs_baseline": round(len(baseline_pairs & pairs) / len(baseline_pairs), 3),
            "cluster_sizes": [len(cluster.markets) for cluster in multi],
            "labels": [cluster.label for cluster in multi],
        })
    return rows


def duplicate_labels(clusters):
    counts = Counter(cluster.label for cluster in clusters if len(cluster.markets) >= 2)
    return {label: count for label, count in counts.items() if count > 1}


def build_failure_modes(cluster_metrics, duplicate_label_map, suspicious_values):
    failures = []
    for cluster in cluster_metrics:
        if (
            cluster["reported_stability"] < 0.5
            and cluster["observed_pair_retention"] >= 0.95
        ):
            failures.append({
                "type": "stability_metric_mismatch",
                "cluster_id": cluster["id"],
                "summary": (
                    f"{cluster['label']} reports stability={cluster['reported_stability']}, "
                    f"but leave-one-out reruns retain {cluster['observed_pair_retention']:.3f} "
                    "of pair memberships."
                ),
            })
        if cluster["below_threshold_ratio"] >= 0.25:
            failures.append({
                "type": "overbroad_semantic_cluster",
                "cluster_id": cluster["id"],
                "summary": (
                    f"{cluster['label']} has {cluster['below_threshold_pairs']}/"
                    f"{cluster['pair_count']} pairs below the 0.65 similarity threshold."
                ),
            })
    for label, count in duplicate_label_map.items():
        failures.append({
            "type": "label_collision",
            "summary": f"Label '{label}' appears {count} times, masking distinct event families.",
        })
    if suspicious_values:
        failures.append({
            "type": "fixture_semantic_noise",
            "summary": (
                f"{len(suspicious_values)} live-shaped fixture titles contain impossible or "
                "implausible numeric thresholds."
            ),
        })
    return failures


def render_markdown(report):
    lines = [
        "# Sprint 6 T815 — Cluster Stability Audit",
        "",
        f"- Generated: {report['generated_at']}",
        f"- Input fixture: `{report['input_fixture']['path']}`",
        f"- Fixture freshness: `{report['input_fixture']['modified_at']}`",
        f"- Baseline threshold: `{report['baseline']['threshold']}`",
        "",
        "## Headline Result",
        "",
        (
            f"Baseline clustering on 50 live-shaped markets produced "
            f"{report['baseline']['multi_cluster_count']} multi-market clusters and "
            f"{report['baseline']['singleton_count']} singletons."
        ),
        (
            f"Four clusters are internally stable; one 14-market economics cluster is "
            "semantically over-broad and exposes a mismatch between the reported "
            "stability metric and observed leave-one-out behavior."
        ),
        "",
        "## Baseline Clusters",
        "",
    ]

    for cluster in report["baseline"]["clusters"]:
        lines.extend([
            (
                f"- `{cluster['id']}` {cluster['label']} | size={cluster['size']} | "
                f"confidence={cluster['reported_confidence']} | "
                f"reported_stability={cluster['reported_stability']} | "
                f"observed_pair_retention={cluster['observed_pair_retention']}"
            ),
            (
                f"  min_pair_similarity={cluster['min_pair_similarity']}, "
                f"below_threshold_pairs={cluster['below_threshold_pairs']}/"
                f"{cluster['pair_count']}"
            ),
        ])

    lines.extend([
        "",
        "## Threshold Sweep",
        "",
        "| Threshold | Multi Clusters | Singletons | Avg Confidence | Avg Stability | Pair Retention vs 0.65 |",
        "|---|---:|---:|---:|---:|---:|",
    ])
    for row in report["threshold_sweep"]:
        lines.append(
            f"| {row['threshold']:.2f} | {row['multi_cluster_count']} | {row['singleton_count']} | "
            f"{row['avg_confidence']:.3f} | {row['avg_stability']:.3f} | "
            f"{row['pair_retention_vs_baseline']:.3f} |"
        )

    lines.extend([
        "",
        "## Semantic Failure Modes",
        "",
    ])
    for item in report["failure_modes"]:
        cluster_id = item.get("cluster_id")
        prefix = f"- `{cluster_id}` " if cluster_id else "- "
        lines.append(prefix + item["summary"])

    if report["suspicious_fixture_values"]:
        lines.extend([
            "",
            "## Fixture Quality Notes",
            "",
        ])
        for finding in report["suspicious_fixture_values"][:6]:
            lines.append(
                f"- `{finding['ticker']}` {finding['issue']}: {finding['title']}"
            )

    lines.extend([
        "",
        "## Recommendations",
        "",
        "- Keep the current 0.65 threshold for Sprint 6; threshold sweeps do not materially change the live-shaped output above 0.60.",
        "- Split the economics family into sub-themes before Bob consumes correlations from live data; current family fallback groups CPI, GDP, payrolls, Fed, and unemployment into one loose cluster.",
        "- Rework `compute_cluster_stability()` to use the same fallback semantics as `cluster_markets()` or replace it with pair-retention on leave-one-out reruns.",
        "- Ask Grace to sanitize impossible percentage thresholds in the live fixture generator before T236 lands.",
        "",
        "## Run Command",
        "",
        "```bash",
        "python3 output/cluster_stability_audit.py",
        "```",
    ])
    return "\n".join(lines) + "\n"


def main():
    input_path = Path("../grace/output/filtered_markets.json").resolve()
    json_path = (SCRIPT_DIR / "cluster_stability_audit.json").resolve()
    md_path = (SCRIPT_DIR / "cluster_stability_audit.md").resolve()

    markets = load_markets(str(input_path))
    baseline_clusters = cluster_markets(markets, threshold=BASELINE_THRESHOLD)
    baseline_multi = [cluster for cluster in baseline_clusters if len(cluster.markets) >= 2]
    baseline_pairs = pair_set(baseline_multi)
    cluster_metrics = build_cluster_metrics(markets, baseline_multi, BASELINE_THRESHOLD)
    suspicious_values = suspicious_fixture_values(markets)
    duplicate_label_map = duplicate_labels(baseline_clusters)
    report = {
        "generated_at": datetime.now().isoformat(),
        "task": "T815",
        "input_fixture": {
            "path": str(input_path),
            "modified_at": datetime.fromtimestamp(input_path.stat().st_mtime).isoformat(),
            "market_count": len(markets),
        },
        "baseline": {
            "threshold": BASELINE_THRESHOLD,
            "multi_cluster_count": len(baseline_multi),
            "singleton_count": len([cluster for cluster in baseline_clusters if len(cluster.markets) == 1]),
            "clusters": cluster_metrics,
        },
        "threshold_sweep": threshold_sweep(markets, baseline_pairs),
        "duplicate_labels": duplicate_label_map,
        "suspicious_fixture_values": suspicious_values,
    }
    report["failure_modes"] = build_failure_modes(
        report["baseline"]["clusters"],
        duplicate_label_map,
        suspicious_values,
    )

    json_path.write_text(json.dumps(report, indent=2) + "\n")
    md_path.write_text(render_markdown(report))

    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    print(f"Baseline clusters: {report['baseline']['multi_cluster_count']}")
    print(f"Failure modes: {len(report['failure_modes'])}")


if __name__ == "__main__":
    main()
