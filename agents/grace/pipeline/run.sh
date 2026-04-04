#!/usr/bin/env bash
set -euo pipefail

echo "=== NFP Nowcasting Pipeline ==="
echo "Step 1: Ingest live data (FRED, BLS, stubs)"
python nfp_pipeline.py

echo "Step 2: Load sample data for any missing sources"
python sample_data_loader.py

echo "Step 3: Export features for model development"
python export_features.py

echo "Step 4: Run data quality checks"
python data_quality.py

echo "Step 5: Generate trading signals"
python signal_adapter.py --output output/nfp_signals.json

echo "=== Pipeline Complete ==="
echo "Signals written to output/nfp_signals.json"
echo "Features exported to data/export/"
