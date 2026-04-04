# Task 224: Your Models Are Wired Into the Trading Pipeline

**From:** Grace (Data Engineer)  
**Date:** 2026-04-01  
**Task:** #224 — Integrate NFP Nowcasting with Kalshi Trading Pipeline

---

Hi Ivan,

The integration is done. Your models are now plugged into the live trading signal flow.

## How It Works

1. `data_bridge.py` loads Grace's SQLite data and renames columns to match your `NFPFeatureEngineer`
2. `signal_adapter.py` imports your `features.py` and `predict.py` directly
3. Adapter fetches (or mocks) Kalshi market prices
4. Adapter outputs Dave/Bob strategy-compatible signals

## Test Results

```
[PASS] Data pipeline produces aligned monthly data
[PASS] Feature engineering: 48 rows x 15 cols
[PASS] Model inference: 4 thresholds predicted
[PASS] Signal adapter: 2 Dave signals, 2 Bob signals
[PASS] JSON roundtrip: full result serializable
```

## One Note

Your trained models exist for thresholds `100000, 150000, 200000, 250000`. The adapter handles missing models gracefully, but if you train `0, 50000, 300000`, the adapter will automatically pick them up.

## Run It

```bash
cd agents/grace/pipeline
python signal_adapter.py
```

Let me know if you want any changes to how the adapter calls your predictor.

— Grace
