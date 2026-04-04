#!/usr/bin/env python3
"""
NFP Nowcasting Data Pipeline
Fetches alternative macro data for NFP prediction models.
"""

import os
import sys
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from urllib.parse import urlencode

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


class Database:
    def __init__(self, db_url: Optional[str] = None):
        self.db_url = db_url or os.getenv("DATABASE_URL", "sqlite:///data/nfp_pipeline.db")
        self.is_postgres = self.db_url.startswith("postgresql://") or self.db_url.startswith("postgres://")
        if self.is_postgres:
            import psycopg2
            self.conn = psycopg2.connect(self.db_url)
        else:
            path = self.db_url.replace("sqlite:///", "")
            os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
            self.conn = sqlite3.connect(path)
        self._init_schema()

    def _init_schema(self):
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        with open(schema_path, "r") as f:
            schema = f.read()
        # SQLite/Postgres compat: replace AUTOINCREMENT for Postgres if needed
        if self.is_postgres:
            schema = schema.replace("AUTOINCREMENT", "")
        cur = self.conn.cursor()
        for statement in schema.split(";"):
            stmt = statement.strip()
            if stmt:
                cur.execute(stmt)
        self.conn.commit()
        cur.close()

    def execute(self, sql: str, params: tuple = ()):
        cur = self.conn.cursor()
        cur.execute(sql, params)
        self.conn.commit()
        cur.close()

    def query(self, sql: str, params: tuple = ()) -> List[tuple]:
        cur = self.conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.close()
        return rows

    def close(self):
        self.conn.close()


class FredClient:
    BASE = "https://api.stlouisfed.org/fred/series/observations"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("FRED_API_KEY")

    def fetch(self, series_id: str, limit: int = 52) -> List[Dict[str, Any]]:
        if not self.api_key:
            logger.warning("FRED_API_KEY not set; skipping %s", series_id)
            return []
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": limit,
        }
        url = f"{self.BASE}?{urlencode(params)}"
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            return data.get("observations", [])
        except Exception as e:
            logger.error("FRED fetch failed for %s: %s", series_id, e)
            return []


class BlsClient:
    BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("BLS_API_KEY")

    def fetch_nfp(self, start_year: Optional[int] = None, end_year: Optional[int] = None) -> List[Dict[str, Any]]:
        if not self.api_key:
            logger.warning("BLS_API_KEY not set; skipping NFP fetch")
            return []
        start_year = start_year or (datetime.now().year - 2)
        end_year = end_year or datetime.now().year
        payload = {
            "seriesid": ["CES0000000001"],  # Total nonfarm employment
            "startyear": str(start_year),
            "endyear": str(end_year),
            "registrationkey": self.api_key,
        }
        try:
            resp = requests.post(self.BASE, json=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            results = data.get("Results", {}).get("series", [])
            if results:
                return results[0].get("data", [])
            return []
        except Exception as e:
            logger.error("BLS fetch failed: %s", e)
            return []


class AdpClient:
    """Stub for ADP National Employment Report API."""

    def fetch(self) -> List[Dict[str, Any]]:
        logger.warning("ADP API not implemented; returning empty list. Replace with real endpoint.")
        return []


class JobPostingsClient:
    """Stub for job postings aggregator (e.g., LinkUp, Indeed)."""

    def fetch(self) -> List[Dict[str, Any]]:
        logger.warning("Job postings API not implemented; returning empty list. Replace with real endpoint.")
        return []


class CreditCardClient:
    """Stub for credit card spending data (e.g., Bloomberg Second Measure, Affinity)."""

    def fetch(self) -> List[Dict[str, Any]]:
        logger.warning("Credit card spending API not implemented; returning empty list. Replace with real endpoint.")
        return []


def insert_initial_claims(db: Database, observations: List[Dict[str, Any]]):
    if not observations:
        return 0
    sql = """
        INSERT INTO initial_claims (week_ending_date, value, four_week_ma)
        VALUES (?, ?, ?)
        ON CONFLICT(week_ending_date) DO UPDATE SET
            value=excluded.value,
            four_week_ma=excluded.four_week_ma,
            fetched_at=CURRENT_TIMESTAMP
    """
    if db.is_postgres:
        sql = sql.replace("?", "%s").replace("ON CONFLICT", "ON CONFLICT")
    count = 0
    for obs in observations:
        date_str = obs.get("date")
        val = obs.get("value")
        if val is None or val == ".":
            continue
        val = int(float(val))
        # Compute 4-week MA from existing data if possible
        ma = None
        try:
            rows = db.query(
                "SELECT value FROM initial_claims WHERE week_ending_date <= ? ORDER BY week_ending_date DESC LIMIT 3",
                (date_str,),
            )
            recent = [r[0] for r in rows if r[0] is not None]
            if len(recent) == 3:
                ma = int((val + sum(recent)) / 4)
        except Exception:
            pass
        db.execute(sql, (date_str, val, ma))
        count += 1
    return count


def insert_ism_employment(db: Database, observations: List[Dict[str, Any]]):
    if not observations:
        return 0
    sql = """
        INSERT INTO ism_employment (release_date, manufacturing_employment)
        VALUES (?, ?)
        ON CONFLICT(release_date) DO UPDATE SET
            manufacturing_employment=excluded.manufacturing_employment,
            fetched_at=CURRENT_TIMESTAMP
    """
    if db.is_postgres:
        sql = sql.replace("?", "%s")
    count = 0
    for obs in observations:
        date_str = obs.get("date")
        val = obs.get("value")
        if val is None or val == ".":
            continue
        db.execute(sql, (date_str, float(val)))
        count += 1
    return count


def insert_nfp_release(db: Database, data: List[Dict[str, Any]]):
    if not data:
        return 0
    sql = """
        INSERT INTO nfp_release (release_date, actual_value)
        VALUES (?, ?)
        ON CONFLICT(release_date) DO UPDATE SET
            actual_value=excluded.actual_value,
            fetched_at=CURRENT_TIMESTAMP
    """
    if db.is_postgres:
        sql = sql.replace("?", "%s")
    count = 0
    for item in data:
        # BLS format: year + period (e.g., M01)
        year = item.get("year")
        period = item.get("period")  # M01..M12
        value = item.get("value")
        if not year or not period or not value:
            continue
        if not period.startswith("M"):
            continue
        month = int(period[1:])
        release_date = f"{year}-{month:02d}-01"
        db.execute(sql, (release_date, int(float(value))))
        count += 1
    return count


def log_run(db: Database, run_type: str, status: str, records: int):
    sql = """
        INSERT INTO pipeline_runs (run_type, status, records_inserted, ended_at)
        VALUES (?, ?, ?, ?)
    """
    if db.is_postgres:
        sql = sql.replace("?", "%s")
    db.execute(sql, (run_type, status, records, datetime.utcnow().isoformat()))


def run_pipeline():
    db = Database()
    fred = FredClient()
    bls = BlsClient()
    adp = AdpClient()
    jobs = JobPostingsClient()
    cc = CreditCardClient()

    total_inserted = 0
    try:
        # 1. Initial claims (FRED: ICSA)
        logger.info("Fetching initial claims from FRED...")
        claims = fred.fetch("ICSA", limit=52)
        n = insert_initial_claims(db, claims)
        logger.info("Inserted/updated %d initial claims records", n)
        total_inserted += n

        # 2. ISM Manufacturing Employment (FRED: NAPMEI)
        logger.info("Fetching ISM manufacturing employment from FRED...")
        ism = fred.fetch("NAPMEI", limit=24)
        n = insert_ism_employment(db, ism)
        logger.info("Inserted/updated %d ISM employment records", n)
        total_inserted += n

        # 3. NFP actuals (BLS)
        logger.info("Fetching NFP releases from BLS...")
        nfp = bls.fetch_nfp()
        n = insert_nfp_release(db, nfp)
        logger.info("Inserted/updated %d NFP release records", n)
        total_inserted += n

        # 4. Stubs
        logger.info("Fetching ADP employment (stub)...")
        adp.fetch()
        logger.info("Fetching job postings (stub)...")
        jobs.fetch()
        logger.info("Fetching credit card spending (stub)...")
        cc.fetch()

        log_run(db, "nfp_full", "success", total_inserted)
        logger.info("Pipeline complete. Total records inserted/updated: %d", total_inserted)
    except Exception as e:
        logger.exception("Pipeline failed: %s", e)
        log_run(db, "nfp_full", "failed", total_inserted)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run_pipeline()
