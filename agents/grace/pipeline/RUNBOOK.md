# NFP Nowcasting Trading Runbook

**Author:** Grace (Data Engineer)  
**Task:** #224 — Integrate NFP Nowcasting with Kalshi Trading Pipeline  
**Last Updated:** 2026-04-01

---

## Overview

This runbook describes how to execute the NFP nowcasting pipeline before each monthly Nonfarm Payrolls release and generate tradeable signals for the Kalshi strategy framework.

---

## Prerequisites

1. **Environment**
   - Python 3.11+
   - `pipeline/requirements.txt` installed
   - Access to Grace's pipeline directory: `agents/grace/pipeline/`

2. **API Keys** (for live data — optional if sample data is acceptable)
   - `FRED_API_KEY` — for initial claims and ISM data
   - `BLS_API_KEY` — for official NFP releases
   - `KALSHI_API_KEY` — for live market prices (set via `KALSHI_API_BASE` and auth headers if needed)

3. **Models**
   - Ivan's trained XGBoost models must exist at:
     `../../ivan/models/nfp_nowcast/output/model_threshold_*.pkl`

---

## Quick Start: One-Command Execution

```bash
cd agents/grace/pipeline
./run.sh
python signal_adapter.py
```

This will:
1. Ingest any available live macro data
2. Backfill missing sources with synthetic data
3. Export model-ready features
4. Run data quality checks
5. Generate strategy-compatible signals

---

## Step-by-Step Execution

### Step 1: Run the Data Pipeline

```bash
python nfp_pipeline.py
```

**What it does:**
- Fetches initial claims from FRED (`ICSA`)
- Fetches ISM manufacturing employment from FRED (`NAPMEI`)
- Fetches NFP actuals from BLS (`CES0000000001`)
- Stubs for ADP, job postings, and credit card spending

**If API keys are missing:** The pipeline logs warnings and continues. Run `sample_data_loader.py` next to backfill.

### Step 2: Load Sample Data (if live APIs unavailable)

```bash
python sample_data_loader.py
```

**What it does:**
- Generates 60 months of realistic synthetic data
- Populates all tables so model development isn't blocked

### Step 3: Verify Data Quality

```bash
python data_quality.py
```

**Expected output:** 11/11 checks passing.

### Step 4: Generate Trading Signals

```bash
python signal_adapter.py
```

**What it does:**
- Loads Grace's pipeline data
- Engineers features via Ivan's `NFPFeatureEngineer`
- Runs Ivan's XGBoost models
- Fetches (or mocks) Kalshi market prices
- Outputs signals in **Dave** and **Bob** strategy formats

**Output location:** Printed to stdout as JSON. Pipe to file:
```bash
python signal_adapter.py > signals_$(date +%Y%m%d).json
```

---

## Signal Formats

### Dave Strategy Framework Format

```json
{
  "marketId": "KXNF-20260501-T100000",
  "direction": "buy_yes",
  "confidence": 0.9527,
  "edge": 9.27,
  "price": 86.0,
  "strategy": "nfp_nowcast_v1",
  "timestamp": "2026-04-02T04:47:44Z",
  "metadata": {
    "release_date": "2026-05-01",
    "threshold": 100000,
    "kalshi_ticker": "KXNF-20260501-T100000",
    "model_confidence": "MEDIUM"
  }
}
```

### Bob SignalEngine Format

```json
{
  "marketId": "KXNF-20260501-T100000",
  "side": "yes",
  "signalType": "entry",
  "confidence": 0.9527,
  "targetPrice": 86.0,
  "currentPrice": 86.0,
  "expectedEdge": 9.27,
  "recommendedContracts": 92,
  "reason": "NFP nowcast: 95.3% prob vs 86.0% market price for threshold 100000"
}
```

---

## Integration Test

Run the full end-to-end test before any live trading:

```bash
python integration_test.py
```

**Tests covered:**
1. Data pipeline produces aligned monthly data
2. Feature engineering generates non-empty feature matrix
3. Model loads and produces predictions
4. Signal adapter outputs valid Dave/Bob signals
5. Full result serializes to JSON

**All tests must pass before signals are considered production-ready.**

---

## Timing: When to Run

| Event | Action | Timing |
|-------|--------|--------|
| ADP Release | Run pipeline, regenerate signals | 2 days before NFP |
| ISM Release | Run pipeline, regenerate signals | 2 days before NFP |
| Initial Claims (Thursday) | Run pipeline, regenerate signals | 1 day before NFP |
| NFP Release (Friday 8:30am ET) | **Execute trades** based on final signals | Market open |
| Post-Release | Close positions or hold to expiration | Same day or later |

---

## Live Price Integration

By default, `signal_adapter.py` uses **mock market prices** for testing.

To enable live Kalshi price fetching:

```bash
export KALSHI_API_BASE="https://trading-api.kalshi.com"
python signal_adapter.py --live
```

*(Note: `--live-prices` requires `KALSHI_API_BASE` to be reachable. No API key is needed for public market data, but rate limits apply.)*

The adapter attempts to fetch prices for tickers like:
- `KXNF-20260501-T100000`
- `KXNF-20260501-T150000`
- `KXNF-20260501-T200000`
- `KXNF-20260501-T250000`

Coordinate with **Bob** if the actual Kalshi ticker format differs.

---

## Position Sizing Logic

The Bob-format signal includes a `recommendedContracts` field computed as:

```
recommendedContracts = min(max(int(edge * 100 * 10), 1), 100)
```

This means:
- 1% edge → 10 contracts
- 5% edge → 50 contracts
- 10% edge → 100 contracts (cap)

**The strategy framework (Dave/Bob) should apply its own Kelly/fixed-fraction sizing on top of this.**

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `FRED_API_KEY not set` | Missing API key | Set env var or run `sample_data_loader.py` |
| `feature_names mismatch` | Model trained with different columns | Ensure `data_bridge.py` produces all expected columns |
| `No trained models found` | Ivan hasn't trained models yet | Run `../../ivan/models/nfp_nowcast/train.py` |
| Empty predictions | All features are NaN | Check that `sample_data_loader.py` generated enough history (≥36 months) |
| No signals generated | Model probabilities align with market prices | Normal — only trade when edge > 5% |

---

## Next Steps / TODO

1. **Bob:** Confirm actual Kalshi ticker format for NFP threshold markets.
2. **Bob:** Provide live API endpoint for fetching NFP market prices.
3. **Dave:** Confirm signal format is accepted by `StrategyRunner` without transformation.
4. **Ivan:** Train models for thresholds `0`, `50000`, `300000` (currently missing).
5. **Grace:** Replace ADP/job postings/credit card stubs with real API integrations.
6. **Team:** Schedule a dry-run paper trade before the next NFP release (early May).

---

## Contact

- **Pipeline issues:** Grace
- **Model issues:** Ivan
- **API/market data issues:** Bob
- **Strategy framework issues:** Dave
