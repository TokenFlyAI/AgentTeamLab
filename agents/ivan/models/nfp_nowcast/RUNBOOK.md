# NFP Nowcasting Runbook

**Version:** 1.0  
**Last Updated:** 2026-04-01  
**Owner:** Ivan (ML Engineer)  
**Team:** Grace (Data), Bob (API), Dave (Strategy)

---

## Overview

This runbook describes how to execute the NFP nowcasting pipeline before each Non-Farm Payrolls release.

**NFP Release Schedule:** First Friday of each month, 8:30 AM ET  
**ADP Release:** Wednesday before NFP, 8:15 AM ET (2-day lead)

---

## Prerequisites

### Data Pipeline (Grace)
- [ ] ADP data feed connected
- [ ] Initial claims pipeline running
- [ ] ISM employment index feed active
- [ ] Job postings data (LinkUp/Indeed) flowing

### Model (Ivan)
- [ ] Trained models in `output/` directory
- [ ] Feature engineering tested
- [ ] Signal adapter validated

### Trading Infrastructure (Bob/Dave)
- [ ] Kalshi API client operational
- [ ] Paper trading enabled
- [ ] Strategy framework running
- [ ] Position sizing configured

---

## Execution Timeline

### T-3 Days (Tuesday Before NFP)

**Grace:**
```bash
# Verify data pipelines are current
python nfp_pipeline.py --check-status
# Should show: ADP (pending), Claims (current), ISM (pending)
```

**Ivan:**
```bash
# Verify model is ready
cd models/nfp_nowcast
python integration_test.py
# All 7 tests should pass
```

### T-2 Days (Wednesday) — ADP Release

**Grace:**
```bash
# After 8:15 AM ET ADP release
python nfp_pipeline.py --ingest adp
# Verify ADP data in database
```

**Ivan:**
```bash
# Preliminary model run (optional)
python predict.py --preliminary
# Generates early signals (lower confidence)
```

### T-1 Day (Thursday)

**Grace:**
```bash
# Ingest latest claims data (Thursday morning)
python nfp_pipeline.py --ingest claims

# Verify all features ready
python nfp_pipeline.py --check-features
```

**Bob:**
```bash
# Verify Kalshi NFP markets are live
node kalshi_client.js --list-markets --series KXNF
# Should show markets for upcoming release
```

### T-0 (Friday) — NFP Release Day

#### 8:00 AM ET (30 min before)

**Grace:** Final data check
```bash
python nfp_pipeline.py --export-features --release-date YYYYMMDD
# Outputs: features_YYYYMMDD.csv
```

**Ivan:** Generate signals
```bash
cd models/nfp_nowcast
python -c "
from signal_adapter import generate_nfp_signals
from features import load_mock_data, NFPFeatureEngineer
from predict import NFPPredictor

# Load real data from Grace's pipeline
# (Replace with actual data loading)
features = load_real_features()  
predictor = NFPPredictor()
predictions = predictor.predict(features)
signals = generate_nfp_signals(predictions)

import json
print(json.dumps(signals, indent=2))
" > signals_YYYYMMDD.json
```

#### 8:15 AM ET (15 min before)

**Dave:** Load signals into strategy framework
```javascript
// In strategy runner
const nfpSignals = require('./signals_YYYYMMDD.json');
for (const signal of nfpSignals) {
  await strategyRunner.submitSignal(signal);
}
```

**Review:** Check signals before execution
- [ ] Edge > 5 cents for all signals
- [ ] Confidence > 55% for all signals
- [ ] Max 3 signals (risk concentration)
- [ ] Position sizes within limits

#### 8:30 AM ET — NFP Release

**All:** Monitor
- Kalshi markets will freeze briefly
- Prices will move rapidly
- DO NOT trade after 8:30 AM

#### 8:35 AM ET (Post-release)

**Bob:** Verify settlement
```bash
# Check market settlement
node kalshi_client.js --check-settlement --series KXNF
```

**Dave:** Review P&L
```bash
node report.js --strategy nfp_nowcast --date YYYYMMDD
```

---

## Signal Interpretation

### Example Output

```json
[
  {
    "marketId": "KXNF-260501-T150000",
    "direction": "buy_yes",
    "confidence": 0.72,
    "edge": 12.5,
    "price": 59.5,
    "strategy": "nfp_nowcast",
    "timestamp": "2026-05-01T12:15:00Z",
    "metadata": {
      "model_probability": 0.72,
      "threshold": 150000,
      "model_version": "nfp_nowcast_v1"
    }
  }
]
```

### Decision Rules

| Edge | Confidence | Action |
|------|------------|--------|
| > 10c | > 70% | Full position (Kelly/4) |
| 5-10c | 55-70% | Half position |
| < 5c | Any | No trade |
| Any | < 55% | No trade |

---

## Troubleshooting

### Issue: Model predictions look wrong

**Check:**
```bash
# Verify feature values
python features.py --debug
# Check for extreme values, NaNs
```

**Resolution:**
- If features are stale → Grace to re-run pipeline
- If model outputs extreme probabilities → Check calibration

### Issue: No signals generated

**Check:**
```bash
# Verify edge threshold
python signal_adapter.py --edge-threshold 5.0 --verbose
```

**Common causes:**
- Market prices too close to model probabilities
- Edge threshold too high
- Model confidence too low

### Issue: Kalshi API errors

**Check:**
```bash
# Test API connectivity
node kalshi_client.js --ping
```

**Escalate to:** Bob

### Issue: Missing data

**Check:**
```bash
# Verify data pipeline status
python nfp_pipeline.py --status
```

**Escalate to:** Grace

---

## Rollback Plan

If critical issues arise before NFP release:

1. **Disable NFP strategy:**
   ```bash
   # In strategy runner
   strategyRunner.disable('nfp_nowcast');
   ```

2. **Use fallback:** Trade based on ADP surprise only
   - If ADP > consensus + 50K → Buy YES on high thresholds
   - If ADP < consensus - 50K → Buy NO on low thresholds

3. **Manual override:** Dave can manually submit orders via Kalshi UI

---

## Post-Release Review

### Within 1 Hour

**Ivan:** Log model performance
```bash
python train.py --log-predictions --date YYYYMMDD
```

**Dave:** Generate P&L report
```bash
node report.js --strategy nfp_nowcast --date YYYYMMDD
```

### Within 24 Hours

**Team:** Retrospective
- [ ] Actual NFP vs model prediction
- [ ] Signal accuracy (did we predict direction?)
- [ ] P&L attribution
- [ ] Issues encountered
- [ ] Improvements for next month

---

## Contacts

| Role | Name | Slack | Escalation |
|------|------|-------|------------|
| Model Owner | Ivan | @ivan | Alice |
| Data Pipeline | Grace | @grace | Alice |
| API/Trading | Bob | @bob | Alice |
| Strategy Framework | Dave | @dave | Alice |

---

## Next NFP Release

**Date:** First Friday of May 2026  
**ADP:** Wednesday before  
**Dry Run:** Schedule for Tuesday before

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-01 | Initial runbook |
