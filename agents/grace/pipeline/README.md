# NFP Nowcasting Data Pipeline

**Author:** Grace (Data Engineer)  
**Purpose:** Ingest alternative macro data to support Kalshi NFP prediction models.

---

## Data Sources

| Source | Table | Frequency | Status |
|--------|-------|-----------|--------|
| FRED — Initial Claims (`ICSA`) | `initial_claims` | Weekly | Active (needs `FRED_API_KEY`) |
| FRED — ISM Manufacturing Employment (`NAPMEI`) | `ism_employment` | Monthly | Active (needs `FRED_API_KEY`) |
| BLS — Total Nonfarm Employment (`CES0000000001`) | `nfp_release` | Monthly | Active (needs `BLS_API_KEY`) |
| ADP National Employment Report | `adp_employment` | Monthly | Stubbed |
| Job Postings (LinkUp/Indeed) | `job_postings` | Weekly/Monthly | Stubbed |
| Credit Card Spending | `credit_card_spending` | Weekly/Monthly | Stubbed |

---

## Setup

```bash
cd pipeline
pip install -r requirements.txt
```

Set API keys (optional for local dev; stubs will skip if missing):

```bash
export FRED_API_KEY="your_fred_key"
export BLS_API_KEY="your_bls_key"
export DATABASE_URL="sqlite:///data/nfp_pipeline.db"   # default
```

---

## Run

### Full orchestrated run

```bash
./run.sh
```

This executes:
1. `nfp_pipeline.py` — ingest live data
2. `sample_data_loader.py` — backfill any missing sources with synthetic data
3. `export_features.py` — export model-ready features to CSV/JSON
4. `data_quality.py` — run validation checks

### Generate trading signals

```bash
python signal_adapter.py
```

Outputs strategy-compatible signals in Dave and Bob formats.

### Run integration tests

```bash
python integration_test.py
```

All 5 tests must pass before live trading.

### Individual steps

```bash
python nfp_pipeline.py
python sample_data_loader.py
python export_features.py
python data_quality.py
```

---

## File Reference

| File | Purpose |
|------|---------|
| `nfp_pipeline.py` | Ingest live macro data (FRED, BLS, stubs) |
| `sample_data_loader.py` | Backfill missing sources with synthetic data |
| `export_features.py` | Export model-ready features to CSV/JSON |
| `data_quality.py` | Run validation checks (11 checks) |
| `data_bridge.py` | Map Grace's SQLite schema → Ivan's feature engineer |
| `signal_adapter.py` | Run model + fetch prices → output Dave/Bob signals |
| `integration_test.py` | End-to-end integration test (5 tests) |
| `schema.sql` | Database schema (SQLite/Postgres) |
| `features_view.sql` | Model-ready feature view (`v_nfp_features`) |
| `run.sh` | Full orchestration script |
| `RUNBOOK.md` | Execution runbook for NFP releases |

---

## Schema

See `schema.sql` for full table definitions. Compatible with SQLite and PostgreSQL.

The `v_nfp_features` view joins all sources into a model-ready dataset.

---

## Next Steps

1. Replace stub fetchers with real API endpoints or web scrapers.
2. Add Kalshi implied price ingestion (re-use Bob's `fetch_prices.js`).
3. Coordinate with Bob on actual NFP market ticker formats.
4. Coordinate with Dave on signal ingestion into `StrategyRunner`.
