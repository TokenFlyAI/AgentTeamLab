#!/usr/bin/env python3
"""
Sample Data Loader
Populates the NFP pipeline database with realistic synthetic data
so model development can proceed before all API keys are available.
"""

import os
import sys
import random
from datetime import datetime, timedelta
from nfp_pipeline import Database

random.seed(42)


def generate_initial_claims(start_date: datetime, weeks: int = 260):
    rows = []
    val = 220000
    for i in range(weeks):
        date = start_date - timedelta(weeks=i)
        # Random walk with mean reversion
        change = random.gauss(0, 8000)
        val = int(max(150000, min(400000, val + change - 0.1 * (val - 220000))))
        rows.append({
            "week_ending_date": date.strftime("%Y-%m-%d"),
            "value": val,
        })
    # Compute 4-week MA
    for i in range(len(rows)):
        window = rows[i:i+4]
        if len(window) == 4:
            rows[i]["four_week_ma"] = int(sum(r["value"] for r in window) / 4)
        else:
            rows[i]["four_week_ma"] = None
    return rows


def generate_ism_employment(start_date: datetime, months: int = 60):
    rows = []
    val = 50.0
    for i in range(months):
        # Align to first of month
        year = start_date.year
        month = start_date.month - i
        while month <= 0:
            month += 12
            year -= 1
        date = datetime(year, month, 1)
        change = random.gauss(0, 2.5)
        val = round(max(40.0, min(60.0, val + change)), 1)
        rows.append({
            "release_date": date.strftime("%Y-%m-%d"),
            "manufacturing_employment": val,
            "services_employment": round(val + random.gauss(2, 1.5), 1),
        })
    return rows


def generate_adp_employment(start_date: datetime, months: int = 60):
    rows = []
    val = 180000
    for i in range(months):
        # Align to first of month
        year = start_date.year
        month = start_date.month - i
        while month <= 0:
            month += 12
            year -= 1
        date = datetime(year, month, 1)
        change = int(random.gauss(0, 40000))
        val = max(-200000, min(500000, val + change))
        prior = val - int(random.gauss(0, 30000))
        rows.append({
            "release_date": date.strftime("%Y-%m-%d"),
            "value": val,
            "prior_value": prior,
            "change": val - prior,
        })
    return rows


def generate_job_postings(start_date: datetime, days: int = 1825):
    rows = []
    val = 10000000
    for i in range(days):
        date = start_date - timedelta(days=i)
        change = int(random.gauss(0, 50000))
        val = max(8000000, min(12000000, val + change))
        rows.append({
            "date": date.strftime("%Y-%m-%d"),
            "source": "indeed",
            "count": val,
            "change_mom": round(random.gauss(0, 1.0), 2),
        })
    return rows


def generate_credit_card_spending(start_date: datetime, days: int = 1825):
    rows = []
    val = 100.0
    for i in range(days):
        date = start_date - timedelta(days=i)
        change = random.gauss(0, 2.0)
        val = round(max(80.0, min(120.0, val + change)), 2)
        rows.append({
            "date": date.strftime("%Y-%m-%d"),
            "value": val,
            "change_yoy": round(random.gauss(3.0, 2.0), 2),
        })
    return rows


def generate_nfp_releases(start_date: datetime, months: int = 60):
    rows = []
    val = 200000
    for i in range(months):
        date = start_date - timedelta(days=30 * i)
        # First day of month
        release_date = date.replace(day=1)
        change = int(random.gauss(0, 50000))
        val = max(-500000, min(600000, val + change))
        rows.append({
            "release_date": release_date.strftime("%Y-%m-%d"),
            "actual_value": val,
            "consensus_forecast": val + int(random.gauss(0, 25000)),
            "kalshi_implied_mean": round(50 + random.gauss(0, 10), 1),
            "kalshi_implied_mode": round(50 + random.gauss(0, 10), 1),
            "our_model_prediction": val + int(random.gauss(0, 15000)),
        })
    return rows


def load_sample_data():
    db = Database()
    today = datetime.now()

    try:
        # Initial claims
        claims = generate_initial_claims(today)
        for row in claims:
            db.execute(
                """
                INSERT INTO initial_claims (week_ending_date, value, four_week_ma)
                VALUES (?, ?, ?)
                ON CONFLICT(week_ending_date) DO UPDATE SET
                    value=excluded.value,
                    four_week_ma=excluded.four_week_ma,
                    fetched_at=CURRENT_TIMESTAMP
                """,
                (row["week_ending_date"], row["value"], row["four_week_ma"]),
            )
        print(f"Loaded {len(claims)} initial claims records")

        # ISM employment
        ism = generate_ism_employment(today)
        for row in ism:
            db.execute(
                """
                INSERT INTO ism_employment (release_date, manufacturing_employment, services_employment)
                VALUES (?, ?, ?)
                ON CONFLICT(release_date) DO UPDATE SET
                    manufacturing_employment=excluded.manufacturing_employment,
                    services_employment=excluded.services_employment,
                    fetched_at=CURRENT_TIMESTAMP
                """,
                (row["release_date"], row["manufacturing_employment"], row["services_employment"]),
            )
        print(f"Loaded {len(ism)} ISM employment records")

        # ADP employment
        adp = generate_adp_employment(today)
        for row in adp:
            db.execute(
                """
                INSERT INTO adp_employment (release_date, value, prior_value, change)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(release_date) DO UPDATE SET
                    value=excluded.value,
                    prior_value=excluded.prior_value,
                    change=excluded.change,
                    fetched_at=CURRENT_TIMESTAMP
                """,
                (row["release_date"], row["value"], row["prior_value"], row["change"]),
            )
        print(f"Loaded {len(adp)} ADP employment records")

        # Job postings
        jobs = generate_job_postings(today)
        for row in jobs:
            db.execute(
                """
                INSERT INTO job_postings (date, source, count, change_mom)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET
                    source=excluded.source,
                    count=excluded.count,
                    change_mom=excluded.change_mom,
                    fetched_at=CURRENT_TIMESTAMP
                """,
                (row["date"], row["source"], row["count"], row["change_mom"]),
            )
        print(f"Loaded {len(jobs)} job postings records")

        # Credit card spending
        cc = generate_credit_card_spending(today)
        for row in cc:
            db.execute(
                """
                INSERT INTO credit_card_spending (date, value, change_yoy)
                VALUES (?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET
                    value=excluded.value,
                    change_yoy=excluded.change_yoy,
                    fetched_at=CURRENT_TIMESTAMP
                """,
                (row["date"], row["value"], row["change_yoy"]),
            )
        print(f"Loaded {len(cc)} credit card spending records")

        # NFP releases
        nfp = generate_nfp_releases(today)
        for row in nfp:
            db.execute(
                """
                INSERT INTO nfp_release (
                    release_date, actual_value, consensus_forecast,
                    kalshi_implied_mean, kalshi_implied_mode, our_model_prediction
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(release_date) DO UPDATE SET
                    actual_value=excluded.actual_value,
                    consensus_forecast=excluded.consensus_forecast,
                    kalshi_implied_mean=excluded.kalshi_implied_mean,
                    kalshi_implied_mode=excluded.kalshi_implied_mode,
                    our_model_prediction=excluded.our_model_prediction,
                    fetched_at=CURRENT_TIMESTAMP
                """,
                (
                    row["release_date"], row["actual_value"], row["consensus_forecast"],
                    row["kalshi_implied_mean"], row["kalshi_implied_mode"], row["our_model_prediction"],
                ),
            )
        print(f"Loaded {len(nfp)} NFP release records")

        # Log run
        db.execute(
            "INSERT INTO pipeline_runs (run_type, status, records_inserted, ended_at) VALUES (?, ?, ?, ?)",
            ("sample_data_load", "success", len(claims) + len(ism) + len(adp) + len(jobs) + len(cc) + len(nfp), datetime.utcnow().isoformat()),
        )
        print("Sample data load complete.")
    finally:
        db.close()


if __name__ == "__main__":
    load_sample_data()
