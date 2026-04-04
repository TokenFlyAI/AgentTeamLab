#!/usr/bin/env python3
"""
Data Quality Checks for NFP Pipeline
Validates completeness, freshness, and sanity of ingested features.
"""

import sys
from datetime import datetime, timedelta
from nfp_pipeline import Database


class QualityReport:
    def __init__(self):
        self.checks = []
        self.passed = 0
        self.failed = 0

    def check(self, name: str, condition: bool, details: str):
        status = "PASS" if condition else "FAIL"
        self.checks.append((name, status, details))
        if condition:
            self.passed += 1
        else:
            self.failed += 1

    def print_report(self):
        print("\n=== Data Quality Report ===\n")
        for name, status, details in self.checks:
            print(f"[{status}] {name}: {details}")
        print(f"\nTotal: {self.passed} passed, {self.failed} failed")
        return self.failed == 0


def run_checks():
    db = Database()
    report = QualityReport()
    today = datetime.now()

    # 1. Row count in feature view
    row_count = db.query("SELECT COUNT(*) FROM v_nfp_features")[0][0]
    report.check(
        "Feature View Row Count",
        row_count >= 12,
        f"{row_count} rows (need >= 12 months of history)"
    )

    # 2. Null checks on critical columns
    critical_cols = [
        "release_date",
        "actual_value",
        "avg_initial_claims",
        "ism_manufacturing",
        "adp_value",
    ]
    for col in critical_cols:
        null_count = db.query(f"SELECT COUNT(*) FROM v_nfp_features WHERE {col} IS NULL")[0][0]
        report.check(
            f"Null Check: {col}",
            null_count == 0,
            f"{null_count} null values"
        )

    # 3. Date range freshness
    latest_date_str = db.query("SELECT MAX(release_date) FROM v_nfp_features")[0][0]
    latest_date = datetime.strptime(latest_date_str, "%Y-%m-%d") if latest_date_str else None
    report.check(
        "Feature View Freshness",
        latest_date is not None and (today - latest_date).days <= 45,
        f"latest release_date = {latest_date_str}"
    )

    # 4. Sanity: NFP actual_value within historical bounds
    min_nfp, max_nfp = db.query(
        "SELECT MIN(actual_value), MAX(actual_value) FROM v_nfp_features"
    )[0]
    report.check(
        "NFP Value Bounds",
        min_nfp >= -1000000 and max_nfp <= 2000000,
        f"min={min_nfp}, max={max_nfp}"
    )

    # 5. Sanity: initial claims average within reasonable bounds
    claims_min, claims_max = db.query(
        "SELECT MIN(avg_initial_claims), MAX(avg_initial_claims) FROM v_nfp_features"
    )[0]
    report.check(
        "Initial Claims Bounds",
        (claims_min or 0) >= 100000 and (claims_max or 0) <= 800000,
        f"min_avg={claims_min}, max_avg={claims_max}"
    )

    # 6. Pipeline run recency
    latest_run = db.query(
        "SELECT MAX(started_at) FROM pipeline_runs WHERE status = 'success'"
    )[0][0]
    report.check(
        "Pipeline Run Recency",
        latest_run is not None,
        f"latest successful run = {latest_run}"
    )

    # 7. Kalshi price data presence (if any loaded)
    kalshi_count = db.query(
        "SELECT COUNT(*) FROM nfp_release WHERE kalshi_implied_mean IS NOT NULL"
    )[0][0]
    report.check(
        "Kalshi Price Data Presence",
        kalshi_count > 0,
        f"{kalshi_count} records with Kalshi implied prices"
    )

    db.close()
    ok = report.print_report()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    run_checks()
