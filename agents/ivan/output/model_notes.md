# Win Probability Scorer — Model Notes

**Task:** 265  
**Author:** Ivan (ML Engineer)  
**Date:** 2026-04-03  
**Algorithm:** Logistic Regression

---

## Overview

This model scores Kalshi trading signals by their probability of success (win probability). It uses logistic regression trained on signal characteristics to predict which trades are most likely to be profitable.

## Files

| File | Description |
|------|-------------|
| `win_probability_scorer.js` | Main implementation with LogisticRegression class |
| `output/scored_signals.json` | Example output with scored signals |

---

## Model Architecture

### Algorithm: Logistic Regression

**Why Logistic Regression?**
- Interpretable coefficients (we can see which features matter)
- Fast training and inference
- Well-suited for binary outcomes (win/loss)
- Works well with small to medium datasets

**Implementation Details:**
- Learning rate: 0.1
- Iterations: 500
- Optimization: Gradient descent
- Output: Probability (0-1)

---

## Features

### Signal Features
| Feature | Description |
|---------|-------------|
| `confidence` | Strategy confidence (0-1) |
| `expectedEdge` | Expected profit edge (cents) |
| `edgeToPriceRatio` | Edge relative to current price |

### Market Features
| Feature | Description |
|---------|-------------|
| `volume` | Trading volume |
| `logVolume` | Log-transformed volume |
| `priceVolatility` | Standard deviation of price history |
| `priceChange24h` | 24-hour price change |
| `priceDeviation` | Z-score of current price vs history |

### Categorical Features
| Feature | Description |
|---------|-------------|
| `isCrypto` | 1 if crypto market |
| `isEconomics` | 1 if economics market |
| `isMeanReversion` | 1 if mean reversion strategy |

### Interaction Features
| Feature | Description |
|---------|-------------|
| `confidenceXEdge` | Confidence × Edge interaction |
| `volumeXEdge` | Volume × Edge interaction |

---

## Training

### Data Source
- Input: `trade_signals.json` from trading pipeline
- Contains: Signals from mean_reversion and other strategies
- Markets: Crypto, Economics, Financial categories

### Synthetic Outcomes
Since we don't have historical outcomes yet, the model uses heuristic win probabilities based on:
- Signal confidence (higher = better)
- Expected edge (higher = better, with diminishing returns)
- Market volume (higher = more reliable)
- Strategy type (mean reversion works better with high deviation)

### Training Results (Example)
```
Samples: 3
Accuracy: 100% (on small synthetic dataset)
```

---

## Scoring

### Output Format
```javascript
{
  signal: { /* original signal */ },
  market: { /* market data */ },
  winProbability: 0.75,      // 0-1 probability of success
  expectedValue: 15.5,       // Expected profit in cents
  recommendation: 'BUY'      // STRONG_BUY, BUY, NEUTRAL, AVOID
}
```

### Recommendation Logic
| Win Probability | Edge | Recommendation |
|-----------------|------|----------------|
| > 70% | > 10c | STRONG_BUY |
| > 60% | > 5c | BUY |
| < 30% | Any | AVOID |
| Other | Any | NEUTRAL |

---

## Feature Importance

Top features by weight (example run):

1. **logVolume** (+5.17) — Higher volume increases win probability
2. **priceChange24h** (-3.21) — Recent price changes affect odds
3. **volumeXEdge** (-1.97) — Interaction between volume and edge
4. **priceDeviation** (-1.46) — Deviation from historical mean
5. **priceVolatility** (+1.42) — Volatility can create opportunities

---

## Usage

### Command Line
```bash
node win_probability_scorer.js
```

### As Module
```javascript
const { WinProbabilityScorer } = require('./win_probability_scorer');

const scorer = new WinProbabilityScorer();
scorer.train(tradeSignals);
const scored = scorer.scoreAll(tradeSignals);
```

---

## Future Improvements

1. **Real Historical Data**
   - Replace synthetic outcomes with actual trade results
   - Track P&L per signal to train on real outcomes

2. **More Sophisticated Models**
   - Gradient Boosting (XGBoost/LightGBM)
   - Neural networks for non-linear patterns
   - Ensemble of multiple models

3. **Additional Features**
   - Time of day/week effects
   - Market regime indicators
   - Cross-market correlations
   - News sentiment

4. **Calibration**
   - Platt scaling for better probability calibration
   - Isotonic regression for non-linear calibration

5. **Online Learning**
   - Update model as new outcomes arrive
   - Decay old data, weight recent results more

---

## Integration

The scorer integrates with:
- **Input:** `agents/bob/output/trade_signals.json`
- **Output:** `agents/ivan/output/scored_signals.json`
- **Dashboard:** Can feed into Kalshi Alpha Dashboard for display

---

## Performance Metrics

Current (synthetic data):
- Training accuracy: ~85-100% (varies by random seed)
- Inference time: <1ms per signal
- Model size: ~1KB (weights only)

Target (with real data):
- Out-of-sample accuracy: >60%
- Calibration error: <0.1
- Sharpe improvement: +0.2 vs unfiltered signals
