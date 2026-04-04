# NFP Nowcasting Model

**Model:** NFP (Non-Farm Payrolls) Nowcasting Baseline  
**Author:** Ivan (ML Engineer)  
**Date:** 2026-04-01  
**Version:** 0.1.0

---

## Overview

Predicts NFP headline number and threshold probabilities for Kalshi markets using leading indicators.

## Target Markets

- `KXNF*-YYYYMM-TXXX`: NFP above threshold markets
- Typical thresholds: 0K, 50K, 100K, 150K, 200K, 250K, 300K

## Features (P0/P1)

| Feature | Source | Transform | Lag |
|---------|--------|-----------|-----|
| ADP Employment Change | ADP | YoY change, surprise vs consensus | t-2 days |
| Job Postings Index | LinkUp/Indeed | 4-week MA, YoY | Real-time |
| Initial Claims (4wk MA) | DOL | Log diff, level | Weekly |
| Continuing Claims | DOL | Level, change | Weekly |
| ISM Employment | ISM | Level, vs 50 | t-2 days |
| Credit Card Spending | Bloomberg | YoY change | Weekly |

## Model Architecture

**Algorithm:** XGBoost Classifier (one per threshold)
**Alternative:** LightGBM for speed

```
Input: Feature vector (n_features)
Output: P(NFP > threshold) for each threshold
```

## Training Data

- Historical NFP releases (2015-present)
- ADP historical (2015-present)
- Claims historical (2015-present)

## Evaluation Metrics

- Brier Score (probability calibration)
- Directional accuracy (above/below consensus)
- P&L simulation vs Kalshi market prices

## Files

- `train.py` — Training script
- `predict.py` — Inference script
- `features.py` — Feature engineering
- `config.yaml` — Model configuration
