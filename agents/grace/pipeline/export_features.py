#!/usr/bin/env python3
"""
Export model-ready features to CSV and JSON for downstream consumers (Ivan).
"""

import os
import sys
import json
import csv
from datetime import datetime
from nfp_pipeline import Database


def export_features(output_dir: str = "data/export"):
    os.makedirs(output_dir, exist_ok=True)
    db = Database()
    rows = db.query("SELECT * FROM v_nfp_features")
    if not rows:
        print("No data in v_nfp_features to export.")
        db.close()
        return

    # Get column names
    cols = [desc[0] for desc in db.conn.execute("SELECT * FROM v_nfp_features LIMIT 1").description]

    # CSV
    csv_path = os.path.join(output_dir, "nfp_features.csv")
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(cols)
        writer.writerows(rows)
    print(f"Exported {len(rows)} rows to {csv_path}")

    # JSON
    json_path = os.path.join(output_dir, "nfp_features.json")
    data = [dict(zip(cols, row)) for row in rows]
    with open(json_path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"Exported {len(rows)} rows to {json_path}")

    db.close()


if __name__ == "__main__":
    output_dir = sys.argv[1] if len(sys.argv) > 1 else "data/export"
    export_features(output_dir)
