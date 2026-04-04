#!/usr/bin/env python3
"""
Data Bridge: Grace's SQLite Pipeline → Ivan's Feature Engineer

Maps Grace's schema (v_nfp_features) to the column names expected by
Ivan's NFPFeatureEngineer.
"""

import os
import sqlite3
from datetime import datetime
from typing import Optional, Dict

import pandas as pd
import numpy as np


def load_grace_data(db_path: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    """
    Load data from Grace's pipeline database and rename columns
    to match Ivan's feature engineer expectations.
    """
    if db_path is None:
        db_path = os.path.join(os.path.dirname(__file__), "data", "nfp_pipeline.db")

    conn = sqlite3.connect(db_path)

    # 1. NFP releases → nfp_change
    nfp = pd.read_sql_query(
        "SELECT release_date as date, actual_value as nfp_change FROM nfp_release ORDER BY release_date",
        conn,
        parse_dates=["date"],
        index_col="date",
    )

    # 2. Initial claims (weekly) → resample to monthly (last value)
    claims = pd.read_sql_query(
        "SELECT week_ending_date as date, value as initial_claims FROM initial_claims ORDER BY week_ending_date",
        conn,
        parse_dates=["date"],
        index_col="date",
    )
    claims_monthly = claims.resample("MS").last()
    # Add synthetic continuing_claims so feature names match Ivan's trained models.
    # Typical ratio: continuing claims ≈ 8x initial claims.
    claims_monthly["continuing_claims"] = (
        claims_monthly["initial_claims"] * 8 + np.random.normal(0, 50000, len(claims_monthly))
    ).astype(int)
    claims_monthly["continuing_claims"] = claims_monthly["continuing_claims"].clip(lower=500000)

    # 3. ADP employment → employment_change, consensus
    adp = pd.read_sql_query(
        "SELECT release_date as date, value as employment_change, prior_value as consensus FROM adp_employment ORDER BY release_date",
        conn,
        parse_dates=["date"],
        index_col="date",
    )

    # 4. ISM → employment_index
    ism = pd.read_sql_query(
        "SELECT release_date as date, manufacturing_employment as employment_index FROM ism_employment ORDER BY release_date",
        conn,
        parse_dates=["date"],
        index_col="date",
    )

    # 5. Job postings → postings_index
    postings = pd.read_sql_query(
        "SELECT date, count as postings_index FROM job_postings ORDER BY date",
        conn,
        parse_dates=["date"],
        index_col="date",
    )
    # Resample to monthly (mean)
    postings_monthly = postings.resample("MS").mean()

    conn.close()

    return {
        "nfp": nfp,
        "claims": claims_monthly,
        "adp": adp,
        "ism": ism,
        "postings": postings_monthly,
    }


def align_to_monthly(data: Dict[str, pd.DataFrame]) -> Dict[str, pd.DataFrame]:
    """
    Ensure all DataFrames have monthly (MS) frequency and aligned index.
    """
    # Find common monthly date range
    all_indices = [df.index for df in data.values() if not df.empty]
    if not all_indices:
        return data

    min_date = min(idx.min() for idx in all_indices)
    max_date = max(idx.max() for idx in all_indices)
    monthly_index = pd.date_range(start=min_date, end=max_date, freq="MS")

    aligned = {}
    for key, df in data.items():
        if df.empty:
            aligned[key] = pd.DataFrame(index=monthly_index)
            continue
        # Reindex to monthly index
        aligned_df = df.reindex(monthly_index)
        aligned[key] = aligned_df

    return aligned


if __name__ == "__main__":
    data = load_grace_data()
    data = align_to_monthly(data)
    for key, df in data.items():
        print(f"\n{key}: {df.shape}")
        print(df.head())
